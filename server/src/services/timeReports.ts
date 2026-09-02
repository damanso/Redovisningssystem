// PRD_TIDSRAPPORTERING §4 F7, §7 acceptans 10 och §9.4 (story 4): rapporterna.
//
// Story 1 gav tidsposten en livscykel, story 2 gjorde fakturan atomär, story 3
// gav avtalet ett tak. Kvar stod juli- och augustifelet i sin enklaste form:
// **godkänd tid som aldrig fakturerades syntes ingenstans om ingen frågade.**
// Ett fel som bara går att upptäcka genom att ställa rätt fråga är ett fel som
// upptäcks av kunden.
//
// Två saker bär filen:
//
//  1. **EN definition av ofakturerad tid.** Urvalet står i `URVAL` och
//     ingenstans annars, och beloppet går alltid genom `gallandeTaxa` +
//     `timeEntryAmountOre` — samma ordning (post → del → avtal → uppdrag) och
//     samma heltalsregel som fakturan använder. Styrytan hade tidigare en egen,
//     äldre formel (`billable AND NOT invoiced`, utan avtalstaxa) som gav ett
//     ANNAT tal för samma fråga; den är borta och läser nu härifrån. Två tal
//     för samma sak betyder att minst ett av dem är fel, och ingen vet vilket.
//  2. **Nedlagd tid syns, men debiteras inte.** En `ignorerad` post räknas in i
//     REGISTRERADE minuter och aldrig i debiterbara eller i beloppet (Davids
//     svar på öppen fråga 4). Ett `forslag` räknas som ett ANTAL bredvid — AI:ts
//     gissning är inte intjänade pengar, men att den väntar på ett godkännande
//     är i sig något man behöver se.
import type { PoolClient } from 'pg';
import { gallandeTaxa, listContracts, VARNINGSGRANS, type Delforbrukning } from './contracts.js';
import { timeEntryAmountOre } from './projects.js';
import { accountsReceivableAging } from './reports.js';

/**
 * Urvalet: ofakturerad tid t.o.m. `to`. Samma villkor som fakturadraget
 * (TIDPOSTURVAL i invoiceAppendix.ts) med två tillägg som hör rapporten till:
 * statusen `ignorerad` och `forslag` kommer med, eftersom rapporten ska visa
 * vad som ligger nedlagt respektive vad som väntar på ett godkännande. Vilken
 * status som får bära ett BELOPP avgörs i `laggTill`, inte här.
 *
 * `billable_minutes > 0` finns med i fakturadragets predikat men inte här: en
 * godkänd post som debiterar noll minuter har ingen fakturarad att bli, men
 * dess registrerade minuter är nedlagd tid och ska synas. Beloppet blir noll i
 * båda fallen, så talen är fortfarande desamma.
 */
const URVAL = `t.company_id = $1
       AND t.invoice_id IS NULL
       AND t.status IN ('godkand', 'justerad', 'ignorerad', 'forslag')
       AND t.work_date <= $2::date
       AND ($3::uuid IS NULL OR p.customer_id = $3)
       AND ($4::uuid IS NULL OR t.project_id = $4)`;

/** Statusarna som bär pengar. Ett förslag och en ignorerad post gör det aldrig. */
const BELOPPSSTATUSAR: ReadonlySet<string> = new Set(['godkand', 'justerad']);

interface OfaktureradRad {
  customer_id: string | null;
  customer_name: string | null;
  project_id: string;
  project_number: number;
  project_name: string;
  contract_part_id: string | null;
  part_code: string | null;
  part_name: string | null;
  status: string;
  post_taxa: number | null;
  del_taxa: number | null;
  avtal_taxa: number | null;
  projekt_taxa: number | null;
  antal: number;
  minuter: number;
  debiterbara: number;
  aldsta: string | null;
}

export interface UnbilledBucket {
  /** Poster i status godkand/justerad/ignorerad. Förslagen räknas för sig. */
  entries: number;
  /** REGISTRERAD tid — vad klockan visade, inklusive den ignorerade. */
  minutes: number;
  /** Vad kunden ska betala för. Aldrig ignorerad tid. */
  billable_minutes: number;
  amount_ore: number;
  /** Äldsta posten som bär belopp — det är den som väntat på en faktura. */
  oldest_work_date: string | null;
}

export interface UnbilledPart extends UnbilledBucket {
  contract_part_id: string | null;
  code: string | null;
  name: string | null;
}

export interface UnbilledProject extends UnbilledBucket {
  project_id: string;
  project_number: number;
  project_name: string;
  /** Poster som AI:n lagt fram och ingen godkänt. Ingår aldrig i beloppet. */
  proposal_entries: number;
  parts: UnbilledPart[];
}

export interface UnbilledCustomer extends UnbilledBucket {
  customer_id: string | null;
  customer_name: string;
  proposal_entries: number;
  /** Betalningsdimensionen (CFO:ns tre kolumner bredvid varandra). */
  unbilled_ore: number;
  invoiced_unpaid_ore: number;
  invoiced_unpaid_buckets: {
    not_due_ore: number; d1_30_ore: number; d31_60_ore: number; d61_90_ore: number; d90_plus_ore: number;
  };
  paid_in_period_ore: number;
  projects: UnbilledProject[];
}

export interface IdleProject {
  project_id: string;
  project_number: number;
  project_name: string;
  customer_id: string | null;
  customer_name: string | null;
  last_work_date: string | null;
  days_idle: number | null;
}

export interface UnbilledTimeReport {
  to: string;
  /** Betalningsperioden: första dagen i `to`:s kalendermånad t.o.m. `to`. */
  period_from: string;
  customers: UnbilledCustomer[];
  totals: UnbilledBucket & {
    proposal_entries: number;
    invoiced_unpaid_ore: number;
    paid_in_period_ore: number;
  };
  /** Stillhetsdimensionen (CHRO:ns bevakning). Rapporterar ATT, aldrig VARFÖR. */
  idle: IdleProject[];
}

export interface UnbilledTimeFilter {
  customer_id?: string;
  project_id?: string;
  /** Skärdatum, default idag. */
  to?: string;
}

function idagsdatum(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * De ofakturerade posterna, grupperade per (kund, uppdrag, avtalsdel, status,
 * de fyra taxekällorna). Taxan väljs i JS av `gallandeTaxa` och beloppet räknas
 * av `timeEntryAmountOre` — precis som i `forbrukningPerRad`: en COALESCE i SQL
 * hade gjort taxaordningen till en andra kopia, och en division med 60 i SQL
 * hade gjort mellanledet till ett flyttal.
 */
async function ofaktureradeRader(
  client: PoolClient, companyId: string, to: string, filter: UnbilledTimeFilter,
): Promise<OfaktureradRad[]> {
  const res = await client.query<OfaktureradRad>(
    `SELECT p.customer_id, cu.name AS customer_name,
            t.project_id, p.number AS project_number, p.name AS project_name,
            t.contract_part_id, cp.code AS part_code, cp.name AS part_name,
            t.status,
            t.hourly_rate_ore AS post_taxa, cp.hourly_rate_ore AS del_taxa,
            c.hourly_rate_ore AS avtal_taxa, p.hourly_rate_ore AS projekt_taxa,
            count(*)::int AS antal,
            COALESCE(sum(t.minutes), 0)::int AS minuter,
            COALESCE(sum(t.billable_minutes), 0)::int AS debiterbara,
            min(t.work_date)::text AS aldsta
       FROM time_entries t
       JOIN projects p ON p.id = t.project_id AND p.company_id = t.company_id
       LEFT JOIN customers cu ON cu.id = p.customer_id AND cu.company_id = p.company_id
       LEFT JOIN contract_parts cp ON cp.id = t.contract_part_id AND cp.company_id = t.company_id
       LEFT JOIN contracts c ON c.id = cp.contract_id AND c.company_id = cp.company_id
      WHERE ${URVAL}
      GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13`,
    [companyId, to, filter.customer_id ?? null, filter.project_id ?? null],
  );
  return res.rows;
}

function tomHink(): UnbilledBucket {
  return { entries: 0, minutes: 0, billable_minutes: 0, amount_ore: 0, oldest_work_date: null };
}

/**
 * Lägger EN grupperad rad i en hink. Hela KRAV-2 bor här: registrerade minuter
 * omfattar den ignorerade tiden, beloppet gör det aldrig. Anropas med samma rad
 * på varje nivå (del, uppdrag, kund, totalt), så nivåernas summor är per
 * definition varandras delsummor.
 */
function laggTill(hink: UnbilledBucket, rad: OfaktureradRad): void {
  hink.entries += rad.antal;
  hink.minutes += rad.minuter;
  if (!BELOPPSSTATUSAR.has(rad.status)) return;
  hink.billable_minutes += rad.debiterbara;
  hink.amount_ore += timeEntryAmountOre(
    rad.debiterbara, gallandeTaxa(rad.post_taxa, rad.del_taxa, rad.avtal_taxa, rad.projekt_taxa),
  );
  if (rad.aldsta !== null && (hink.oldest_work_date === null || rad.aldsta < hink.oldest_work_date)) {
    hink.oldest_work_date = rad.aldsta;
  }
}

interface ProjektBygge {
  rad: UnbilledProject;
  delar: Map<string, UnbilledPart>;
}
interface KundBygge {
  rad: UnbilledCustomer;
  projekt: Map<string, ProjektBygge>;
}

const UTAN_KUND = 'Utan kund';

/** Kund → uppdrag → avtalsdel, med summorna på varje nivå. */
function byggKundtrad(rader: OfaktureradRad[]): KundBygge[] {
  const kunder = new Map<string, KundBygge>();
  for (const rad of rader) {
    const kundNyckel = rad.customer_id ?? '';
    let kund = kunder.get(kundNyckel);
    if (!kund) {
      kund = {
        rad: {
          ...tomHink(),
          customer_id: rad.customer_id,
          customer_name: rad.customer_name ?? UTAN_KUND,
          proposal_entries: 0,
          unbilled_ore: 0,
          invoiced_unpaid_ore: 0,
          invoiced_unpaid_buckets: { not_due_ore: 0, d1_30_ore: 0, d31_60_ore: 0, d61_90_ore: 0, d90_plus_ore: 0 },
          paid_in_period_ore: 0,
          projects: [],
        },
        projekt: new Map(),
      };
      kunder.set(kundNyckel, kund);
    }
    let projekt = kund.projekt.get(rad.project_id);
    if (!projekt) {
      projekt = {
        rad: {
          ...tomHink(),
          project_id: rad.project_id,
          project_number: rad.project_number,
          project_name: rad.project_name,
          proposal_entries: 0,
          parts: [],
        },
        delar: new Map(),
      };
      kund.projekt.set(rad.project_id, projekt);
    }

    // Förslaget är en RÄKNARE och inget annat: varken minuter eller belopp.
    if (rad.status === 'forslag') {
      kund.rad.proposal_entries += rad.antal;
      projekt.rad.proposal_entries += rad.antal;
      continue;
    }

    const delNyckel = rad.contract_part_id ?? '';
    let del = projekt.delar.get(delNyckel);
    if (!del) {
      del = {
        ...tomHink(),
        contract_part_id: rad.contract_part_id,
        code: rad.part_code,
        name: rad.part_name,
      };
      projekt.delar.set(delNyckel, del);
    }
    laggTill(del, rad);
    laggTill(projekt.rad, rad);
    laggTill(kund.rad, rad);
  }
  return [...kunder.values()];
}

/** Äldst först när beloppen är lika — den som väntat längst ska stå överst. */
function sorteraEfterBelopp<T extends UnbilledBucket>(a: T, b: T): number {
  if (b.amount_ore !== a.amount_ore) return b.amount_ore - a.amount_ore;
  return (a.oldest_work_date ?? '9999-12-31').localeCompare(b.oldest_work_date ?? '9999-12-31');
}

/** Avtalsdelarna i kodordning; tid utan avtalsdel sist (den är en restpost). */
function sorteraDelar(a: UnbilledPart, b: UnbilledPart): number {
  if ((a.code === null) !== (b.code === null)) return a.code === null ? 1 : -1;
  return (a.code ?? '').localeCompare(b.code ?? '', 'sv');
}

/**
 * Inbetalningarna i perioden, per kund. Ingen ny betalningsmodell: det som
 * räknas är de betalningsverifikat systemet redan skriver
 * (`source_type = 'payment'`, `source_id` = fakturans id), summerade på
 * verifikatets debetsida. Jämförelsen sker som TEXT eftersom `source_id` är en
 * textkolumn som andra källtyper fyller med annat än uuid:n.
 */
async function betaltIPerioden(
  client: PoolClient, companyId: string, from: string, to: string,
): Promise<Map<string, number>> {
  const res = await client.query<{ customer_id: string; ore: number }>(
    `SELECT i.customer_id, COALESCE(sum(vl.debit_ore), 0)::bigint AS ore
       FROM vouchers v
       JOIN invoices i ON i.id::text = v.source_id AND i.company_id = v.company_id
       JOIN voucher_lines vl ON vl.voucher_id = v.id AND vl.company_id = v.company_id
      WHERE v.company_id = $1 AND v.source_type = 'payment' AND i.customer_id IS NOT NULL
        AND v.voucher_date >= $2::date AND v.voucher_date <= $3::date
      GROUP BY i.customer_id`,
    [companyId, from, to],
  );
  return new Map(res.rows.map((r) => [r.customer_id, Number(r.ore)]));
}

/**
 * Uppdrag som ligger still: status `active` utan EN ENDA tidpost — i någon
 * status — de senaste `days` dagarna. Rapporten säger ATT det ligger still och
 * aldrig varför; ett orsaksfält hade bara blivit en gissning med auktoritet.
 * Ett uppdrag som aldrig fått en tidpost räknas som stilla från början
 * (`last_work_date: null`) — annars vore det tystaste fallet det enda osynliga.
 */
export async function idleProjectsReport(
  client: PoolClient, companyId: string, opts: { days?: number } = {},
): Promise<IdleProject[]> {
  const days = opts.days ?? 7;
  const res = await client.query<{
    project_id: string; project_number: number; project_name: string;
    customer_id: string | null; customer_name: string | null;
    last_work_date: string | null; days_idle: number | null;
  }>(
    `SELECT p.id AS project_id, p.number AS project_number, p.name AS project_name,
            p.customer_id, cu.name AS customer_name,
            max(t.work_date)::text AS last_work_date,
            (CURRENT_DATE - max(t.work_date))::int AS days_idle
       FROM projects p
       LEFT JOIN customers cu ON cu.id = p.customer_id AND cu.company_id = p.company_id
       LEFT JOIN time_entries t ON t.project_id = p.id AND t.company_id = p.company_id
      WHERE p.company_id = $1 AND p.status = 'active'
      GROUP BY p.id, p.number, p.name, p.customer_id, cu.name
     HAVING max(t.work_date) IS NULL OR max(t.work_date) <= CURRENT_DATE - $2::int
      ORDER BY max(t.work_date) ASC NULLS FIRST, p.number`,
    [companyId, days],
  );
  return res.rows;
}

/**
 * Ofakturerad godkänd tid per kund → uppdrag → avtalsdel, med betalnings- och
 * stillhetsdimensionen bredvid. Kunder UTAN ofakturerad tid står inte här —
 * deras obetalda fakturor bor i kundreskontran, och en rapport om ofakturerad
 * tid som listar alla kunder med nollor döljer det den finns för.
 */
export async function unbilledTimeReport(
  client: PoolClient, companyId: string, filter: UnbilledTimeFilter = {},
): Promise<UnbilledTimeReport> {
  const to = filter.to ?? idagsdatum();
  const periodFrom = `${to.slice(0, 7)}-01`;

  const rader = await ofaktureradeRader(client, companyId, to, filter);
  const bygge = byggKundtrad(rader);

  // Betalningsdimensionen ur de BEFINTLIGA funktionerna. Ingen ny aging-, ingen
  // ny betalningsberäkning: två tal för samma fråga är ett tal för mycket.
  const aging = await accountsReceivableAging(client, companyId, to);
  const betalt = await betaltIPerioden(client, companyId, periodFrom, to);

  const customers: UnbilledCustomer[] = bygge.map((k) => {
    const kund = k.rad;
    kund.unbilled_ore = kund.amount_ore;
    const agingRad = kund.customer_id ? aging.rows.find((r) => r.customer_id === kund.customer_id) : undefined;
    if (agingRad) {
      kund.invoiced_unpaid_ore = agingRad.total_ore;
      kund.invoiced_unpaid_buckets = {
        not_due_ore: agingRad.not_due_ore,
        d1_30_ore: agingRad.d1_30_ore,
        d31_60_ore: agingRad.d31_60_ore,
        d61_90_ore: agingRad.d61_90_ore,
        d90_plus_ore: agingRad.d90_plus_ore,
      };
    }
    kund.paid_in_period_ore = (kund.customer_id ? betalt.get(kund.customer_id) : undefined) ?? 0;
    kund.projects = [...k.projekt.values()]
      .map((p) => ({
        ...p.rad,
        parts: [...p.delar.values()].sort(sorteraDelar),
      }))
      .sort(sorteraEfterBelopp);
    return kund;
  }).sort(sorteraEfterBelopp);

  const totals = { ...tomHink(), proposal_entries: 0, invoiced_unpaid_ore: 0, paid_in_period_ore: 0 };
  for (const k of customers) {
    totals.entries += k.entries;
    totals.minutes += k.minutes;
    totals.billable_minutes += k.billable_minutes;
    totals.amount_ore += k.amount_ore;
    totals.proposal_entries += k.proposal_entries;
    totals.invoiced_unpaid_ore += k.invoiced_unpaid_ore;
    totals.paid_in_period_ore += k.paid_in_period_ore;
    if (k.oldest_work_date !== null
      && (totals.oldest_work_date === null || k.oldest_work_date < totals.oldest_work_date)) {
      totals.oldest_work_date = k.oldest_work_date;
    }
  }

  return { to, period_from: periodFrom, customers, totals, idle: await idleProjectsReport(client, companyId) };
}

// ---------------------------------------------------------------------------
// Avtalsförbrukning mot tak
// ---------------------------------------------------------------------------

export type CapStatusLabel = 'under 80 %' | '80–100 %' | 'över tak' | 'vet ej';

export interface ContractUsageRow {
  contract_id: string;
  contract_name: string;
  project_id: string;
  project_name: string;
  customer_id: string | null;
  customer_name: string | null;
  part_id: string;
  code: string;
  name: string;
  parent_code: string | null;
  billable_minutes: number;
  /** Förbrukade timmar med två decimaler — avtalet talar i timmar. */
  used_hours: number;
  amount_ore: number;
  cap_hours: number | null;
  cap_amount_ore: number | null;
  cap_derived: boolean;
  cap_status: Delforbrukning['cap_status'];
  share: number | null;
  status: CapStatusLabel;
  /** Ofakturerat INOM delen, ur samma urval som rapporten ovan. */
  unbilled_billable_minutes: number;
  unbilled_amount_ore: number;
}

/**
 * Statusetiketten härleds ur `share` och `cap_status` — aldrig ur en egen
 * jämförelse mot taket. Ett obekräftat eller saknat tak ger 'vet ej' och aldrig
 * en varning: en varning på ett tal ingen läst lär mottagaren att strunta i
 * varningar (story 3, regel 2).
 */
function takstatus(del: Delforbrukning): CapStatusLabel {
  if (del.cap_status !== 'bekraftat' || del.share === null) return 'vet ej';
  if (del.share > 1) return 'över tak';
  return del.share >= VARNINGSGRANS ? '80–100 %' : 'under 80 %';
}

const timmar = (minuter: number): number => Math.round((minuter / 60) * 100) / 100;

/**
 * Förbrukningen för bolagets alla avtal, med ofakturerat inom varje del.
 *
 * Förbrukningen kommer i sin helhet ur `listContracts` (som i sin tur går via
 * `forbrukningForAvtal`) — ingen ny takberäkning byggs här. Det ofakturerade
 * rullas däremot upp i föräldern på samma sätt som förbrukningen redan gör,
 * annars hade en fas visat barnens förbrukning bredvid sitt eget tomma
 * ofakturerade och sett ut att vara i fas.
 */
export async function contractUsageReport(
  client: PoolClient, companyId: string,
): Promise<ContractUsageRow[]> {
  const avtal = await listContracts(client, companyId, {}) as unknown as Array<{
    id: string; name: string; project_id: string; project_name: string;
    customer_id: string | null; customer_name: string | null; parts: Delforbrukning[];
  }>;

  const rader = await ofaktureradeRader(client, companyId, idagsdatum(), {});
  const perRadId = new Map<string, UnbilledBucket>();
  for (const rad of rader) {
    if (rad.contract_part_id === null || rad.status === 'forslag') continue;
    const hink = perRadId.get(rad.contract_part_id) ?? tomHink();
    laggTill(hink, rad);
    perRadId.set(rad.contract_part_id, hink);
  }

  const ut: ContractUsageRow[] = [];
  for (const a of avtal) {
    // Egen summa per kod (alla versioner av delen), därefter uppåt i
    // föräldrakedjan — samma upprullning som taket redan gör.
    const eget = new Map<string, UnbilledBucket>();
    for (const del of a.parts) {
      const hink = tomHink();
      for (const v of del.versions) {
        const f = perRadId.get(v.id);
        if (!f) continue;
        hink.billable_minutes += f.billable_minutes;
        hink.amount_ore += f.amount_ore;
      }
      eget.set(del.code, hink);
    }
    const barn = new Map<string, string[]>();
    for (const del of a.parts) {
      if (del.parent_code !== null) barn.set(del.parent_code, [...(barn.get(del.parent_code) ?? []), del.code]);
    }
    const rullat = new Map<string, UnbilledBucket>();
    // Djupet begränsas och summan sätts FÖRE rekursionen: en cykel i
    // föräldrakedjan ska ge ett trasigt tal, inte en oändlig rekursion.
    const rulla = (code: string, djup: number): UnbilledBucket => {
      const klar = rullat.get(code);
      if (klar) return klar;
      const summa = { ...eget.get(code)! };
      rullat.set(code, summa);
      if (djup <= 10) {
        for (const barnkod of barn.get(code) ?? []) {
          const b = rulla(barnkod, djup + 1);
          summa.billable_minutes += b.billable_minutes;
          summa.amount_ore += b.amount_ore;
        }
      }
      return summa;
    };
    for (const del of a.parts) rulla(del.code, 0);

    for (const del of a.parts) {
      const ofakturerat = rullat.get(del.code)!;
      ut.push({
        contract_id: a.id,
        contract_name: a.name,
        project_id: a.project_id,
        project_name: a.project_name,
        customer_id: a.customer_id,
        customer_name: a.customer_name,
        part_id: del.part_id,
        code: del.code,
        name: del.name,
        parent_code: del.parent_code,
        billable_minutes: del.billable_minutes,
        used_hours: timmar(del.billable_minutes),
        amount_ore: del.amount_ore,
        cap_hours: del.cap_hours,
        cap_amount_ore: del.cap_amount_ore,
        cap_derived: del.cap_derived,
        cap_status: del.cap_status,
        share: del.share,
        status: takstatus(del),
        unbilled_billable_minutes: ofakturerat.billable_minutes,
        unbilled_amount_ore: ofakturerat.amount_ore,
      });
    }
  }
  return ut;
}
