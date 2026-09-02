// PRD_TIDSRAPPORTERING §3.2 + §4 F0/F6/F7 (story 3): avtalet och avtalsdelarna.
//
// Story 1 gav tidsposten en livscykel, story 2 gjorde fakturan atomär. Kvar
// stod PRD §1 rad 6: ILT-avtalets Fas 2A har ett tak på 32 h / 35 200 kr, och
// taket passerades utan att någon sa något. Det gick inte att säga något,
// eftersom taket inte fanns skrivet någonstans — `projects` bär en timtaxa och
// en budget, men ett uppdrag är inte ett avtal.
//
// Tre beslut styr hela filen:
//
//  1. **Registrering spärras aldrig** (rådslaget 1/9). Tid som ÄR arbetad ska
//     alltid gå att skriva ner. Ett system som vägrar ta emot verkligheten får
//     tillbaka den i ett kalkylark. Taket varnar vid registreringen och SPÄRRAR
//     först vid faktureringen, där pengarna faktiskt flyttar sig.
//  2. **Ett oläst tak varnar aldrig** (`cap_confirmed`). En varning på ett tal
//     ingen bekräftat lär mottagaren att strunta i varningar; nästa varning är
//     då också död. Ett obekräftat eller saknat tak redovisas som "vet ej" med
//     förbrukningen bredvid.
//  3. **Delen är koden, raderna är dess versioner.** Ett tilläggsavtal skriver
//     en ny rad med senare `valid_from`. Förbrukningen summeras över ALLA
//     versioner av koden, taket hämtas ur den version som gäller. Annars hade
//     ett tilläggsavtal nollställt historiken i tysthet.
import type { PoolClient } from 'pg';
import { BadRequestError, ConflictError, NotFoundError } from '../lib/errors.js';
import { buildAllowlistedUpdate } from '../lib/updateBuilder.js';
import { writeAudit } from './auditService.js';
import { timeEntryAmountOre } from './projects.js';

/**
 * Statusarna som räknas som FÖRBRUKAD tid mot ett tak. Ett `forslag` räknas
 * inte: AI:ts gissning ska inte kunna larma om ett avtalstak. En `ignorerad`
 * post räknas inte heller — den debiterar noll.
 */
const FORBRUKANDE_STATUSAR = ['godkand', 'justerad', 'fakturerad'];

/** Andelen av taket där varningen börjar (PRD §4 F0, acceptans 3). */
export const VARNINGSGRANS = 0.8;

export interface AvtalsdelRad {
  id: string;
  contract_id: string;
  parent_part_id: string | null;
  code: string;
  name: string;
  description: string | null;
  billable: boolean;
  hourly_rate_ore: number | null;
  /** numeric(8,2) kommer ur pg som sträng — konverteras i takberäkningen. */
  cap_hours: string | null;
  cap_amount_ore: number | null;
  cap_confirmed: boolean;
  valid_from: string;
  manually_edited: boolean;
  sort_order: number;
  active: boolean;
  /** Avtalets taxa, med från join:en — behövs i taxaordningen. */
  contract_hourly_rate_ore: number | null;
  /** Avtalets uppdrag. Kopplingen tidpost → avtalsdel måste gå via samma uppdrag. */
  project_id: string;
}

const DEL_KOLUMNER = `cp.id, cp.contract_id, cp.parent_part_id, cp.code, cp.name, cp.description,
       cp.billable, cp.hourly_rate_ore, cp.cap_hours::text AS cap_hours, cp.cap_amount_ore,
       cp.cap_confirmed, cp.valid_from::text, cp.manually_edited, cp.sort_order, cp.active,
       c.hourly_rate_ore AS contract_hourly_rate_ore, c.project_id`;

async function hamtaDelar(
  client: PoolClient, companyId: string,
  filter: { contractId?: string; projectId?: string; partId?: string },
): Promise<AvtalsdelRad[]> {
  const res = await client.query<AvtalsdelRad>(
    `SELECT ${DEL_KOLUMNER}
       FROM contract_parts cp
       JOIN contracts c ON c.id = cp.contract_id AND c.company_id = cp.company_id
      WHERE cp.company_id = $1
        AND ($2::uuid IS NULL OR cp.contract_id = $2)
        AND ($3::uuid IS NULL OR c.project_id = $3)
        AND ($4::uuid IS NULL OR cp.id = $4)
      ORDER BY cp.sort_order, cp.code, cp.valid_from`,
    [companyId, filter.contractId ?? null, filter.projectId ?? null, filter.partId ?? null],
  );
  return res.rows;
}

/**
 * Den version av en del som GÄLLER: den senaste som hunnit träda i kraft. Har
 * ingen version trätt i kraft ännu (bara framtida tilläggsavtal) används den
 * tidigaste — den är det enda villkor som finns, och att svara "inget tak" när
 * ett tak står skrivet vore värre än att svara för tidigt.
 */
function gallandeVersion(versioner: AvtalsdelRad[], idag: string): AvtalsdelRad {
  const sorterade = [...versioner].sort((a, b) => a.valid_from.localeCompare(b.valid_from));
  const ikraft = sorterade.filter((v) => v.valid_from <= idag);
  return (ikraft.length ? ikraft[ikraft.length - 1] : sorterade[0])!;
}

export interface Takversion {
  id: string;
  valid_from: string;
  cap_hours: number | null;
  cap_amount_ore: number | null;
  cap_confirmed: boolean;
  manually_edited: boolean;
  active: boolean;
}

export interface Delforbrukning {
  /** Den gällande versionens id — det id en ny tidpost ska peka på. */
  part_id: string;
  contract_id: string;
  code: string;
  name: string;
  parent_code: string | null;
  billable: boolean;
  active: boolean;
  hourly_rate_ore: number | null;
  /** Delens egen förbrukning, utan barnens. */
  own_billable_minutes: number;
  own_amount_ore: number;
  /** Förbrukningen inklusive alla underliggande delar (KRAV-6). */
  billable_minutes: number;
  amount_ore: number;
  cap_hours: number | null;
  cap_amount_ore: number | null;
  /** Taket kommer från barnens summa (delen har inget eget). */
  cap_derived: boolean;
  cap_confirmed: boolean;
  /** 'bekraftat' = taket får varna och spärra. 'vet_ej' = NULL eller oläst. */
  cap_status: 'bekraftat' | 'vet_ej';
  /** Andel av taket, avrundad till fyra decimaler. null när taket är 'vet_ej'. */
  share: number | null;
  versions: Takversion[];
}

function taltak(v: string | null): number | null {
  return v === null ? null : Number(v);
}

/** Förbrukning per avtalsdel-RAD (alla versioner var för sig). */
async function forbrukningPerRad(
  client: PoolClient, companyId: string, partIds: string[],
): Promise<Map<string, { minutes: number; amount_ore: number }>> {
  const per = new Map<string, { minutes: number; amount_ore: number }>();
  if (partIds.length === 0) return per;
  // Grupperingen sker per (del, de fyra taxekällorna) och beloppet räknas i JS:
  // taxeordningen står i `gallandeTaxa` och ingen annanstans, och heltalsregeln
  // är tidpostens egen (timeEntryAmountOre). Att låta Postgres välja taxa med
  // en COALESCE hade gjort ordningen till en andra kopia, och att dividera med
  // 60 i SQL hade gjort mellanledet till ett flyttal — invarianten "ören i
  // heltal, aldrig float" gäller även härledda belopp.
  const res = await client.query<{
    part_id: string; post_taxa: number | null; del_taxa: number | null;
    avtal_taxa: number | null; projekt_taxa: number | null; minuter: number;
  }>(
    `SELECT t.contract_part_id AS part_id,
            t.hourly_rate_ore AS post_taxa, cp.hourly_rate_ore AS del_taxa,
            c.hourly_rate_ore AS avtal_taxa, p.hourly_rate_ore AS projekt_taxa,
            SUM(t.billable_minutes)::int AS minuter
       FROM time_entries t
       JOIN contract_parts cp ON cp.id = t.contract_part_id AND cp.company_id = t.company_id
       JOIN contracts c ON c.id = cp.contract_id AND c.company_id = cp.company_id
       JOIN projects p ON p.id = t.project_id AND p.company_id = t.company_id
      WHERE t.company_id = $1
        AND t.contract_part_id = ANY($2::uuid[])
        AND t.status = ANY($3::text[])
      GROUP BY 1, 2, 3, 4, 5`,
    [companyId, partIds, FORBRUKANDE_STATUSAR],
  );
  for (const rad of res.rows) {
    const hink = per.get(rad.part_id) ?? { minutes: 0, amount_ore: 0 };
    hink.minutes += rad.minuter;
    hink.amount_ore += timeEntryAmountOre(
      rad.minuter, gallandeTaxa(rad.post_taxa, rad.del_taxa, rad.avtal_taxa, rad.projekt_taxa),
    );
    per.set(rad.part_id, hink);
  }
  return per;
}

/**
 * Bygger förbrukningen per DEL (kod), med barnens tid rullad upp i föräldern.
 *
 * Föräldern (t.ex. "Fas 1") får sitt eget tak att gälla över barnens samlade
 * förbrukning. Saknar föräldern eget tak härleds det ur barnens (`cap_derived`)
 * — annars hade en fas med tak per deluppgift saknat totalsiffra helt. Ett
 * härlett tak är bekräftat bara om VARJE tak det byggs av är bekräftat: en
 * summa som innehåller ett oläst tal är själv ett oläst tal.
 */
function byggForbrukning(
  rader: AvtalsdelRad[], perRad: Map<string, { minutes: number; amount_ore: number }>, idag: string,
): Delforbrukning[] {
  const perKod = new Map<string, AvtalsdelRad[]>();
  const kodForRadId = new Map<string, string>();
  for (const rad of rader) {
    const nyckel = `${rad.contract_id}|${rad.code}`;
    kodForRadId.set(rad.id, nyckel);
    const lista = perKod.get(nyckel) ?? [];
    lista.push(rad);
    perKod.set(nyckel, lista);
  }

  const noder = new Map<string, Delforbrukning>();
  const barn = new Map<string, string[]>();
  for (const [nyckel, versioner] of perKod) {
    const gallande = gallandeVersion(versioner, idag);
    let egnaMinuter = 0, egnaOren = 0;
    for (const v of versioner) {
      const f = perRad.get(v.id);
      if (f) { egnaMinuter += f.minutes; egnaOren += f.amount_ore; }
    }
    const foralderNyckel = gallande.parent_part_id ? kodForRadId.get(gallande.parent_part_id) ?? null : null;
    noder.set(nyckel, {
      part_id: gallande.id,
      contract_id: gallande.contract_id,
      code: gallande.code,
      name: gallande.name,
      parent_code: foralderNyckel ? foralderNyckel.split('|').slice(1).join('|') : null,
      billable: gallande.billable,
      active: gallande.active,
      hourly_rate_ore: gallande.hourly_rate_ore,
      own_billable_minutes: egnaMinuter,
      own_amount_ore: egnaOren,
      billable_minutes: egnaMinuter,
      amount_ore: egnaOren,
      cap_hours: taltak(gallande.cap_hours),
      cap_amount_ore: gallande.cap_amount_ore,
      cap_derived: false,
      cap_confirmed: gallande.cap_confirmed,
      cap_status: 'vet_ej',
      share: null,
      versions: versioner.map((v) => ({
        id: v.id, valid_from: v.valid_from, cap_hours: taltak(v.cap_hours),
        cap_amount_ore: v.cap_amount_ore, cap_confirmed: v.cap_confirmed,
        manually_edited: v.manually_edited, active: v.active,
      })),
    });
    if (foralderNyckel) barn.set(foralderNyckel, [...(barn.get(foralderNyckel) ?? []), nyckel]);
  }

  // Rullas upp nedifrån och upp. Djupet begränsas: en cykel i föräldrakedjan
  // ska ge ett trasigt tal, inte en oändlig rekursion.
  const klara = new Set<string>();
  const rulla = (nyckel: string, djup: number): Delforbrukning => {
    const nod = noder.get(nyckel)!;
    if (klara.has(nyckel) || djup > 10) return nod;
    klara.add(nyckel);
    const egnaBarn = (barn.get(nyckel) ?? []).map((b) => rulla(b, djup + 1));
    for (const b of egnaBarn) {
      nod.billable_minutes += b.billable_minutes;
      nod.amount_ore += b.amount_ore;
    }
    if (nod.cap_hours === null && nod.cap_amount_ore === null && egnaBarn.length > 0) {
      const timmar = egnaBarn.filter((b) => b.cap_hours !== null);
      const belopp = egnaBarn.filter((b) => b.cap_amount_ore !== null);
      if (timmar.length || belopp.length) {
        nod.cap_hours = timmar.length ? timmar.reduce((s, b) => s + b.cap_hours!, 0) : null;
        nod.cap_amount_ore = belopp.length ? belopp.reduce((s, b) => s + b.cap_amount_ore!, 0) : null;
        nod.cap_derived = true;
        nod.cap_confirmed = [...timmar, ...belopp].every((b) => b.cap_confirmed);
      }
    }
    return nod;
  };
  for (const nyckel of noder.keys()) rulla(nyckel, 0);

  for (const nod of noder.values()) {
    const andelar: number[] = [];
    if (nod.cap_hours !== null && nod.cap_hours > 0) andelar.push(nod.billable_minutes / (nod.cap_hours * 60));
    if (nod.cap_amount_ore !== null && nod.cap_amount_ore > 0) andelar.push(nod.amount_ore / nod.cap_amount_ore);
    const harTak = nod.cap_hours !== null || nod.cap_amount_ore !== null;
    // Ett oläst tak ger varken andel eller status 'bekraftat' — det är hela
    // skillnaden mellan en varning som betyder något och en som inte gör det.
    nod.cap_status = harTak && nod.cap_confirmed ? 'bekraftat' : 'vet_ej';
    nod.share = nod.cap_status === 'bekraftat' && andelar.length
      ? Math.round(Math.max(...andelar) * 10_000) / 10_000
      : null;
  }

  return [...noder.values()].sort((a, b) => a.code.localeCompare(b.code));
}

function idagsdatum(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Förbrukningen för ett helt avtal, per del. */
async function forbrukningForAvtal(
  client: PoolClient, companyId: string, filter: { contractId?: string; projectId?: string },
): Promise<Delforbrukning[]> {
  const rader = await hamtaDelar(client, companyId, filter);
  const perRad = await forbrukningPerRad(client, companyId, rader.map((r) => r.id));
  return byggForbrukning(rader, perRad, idagsdatum());
}

// ---------------------------------------------------------------------------
// Takutfall — samma beräkning för varningen, spärren och redovisningen
// ---------------------------------------------------------------------------

export interface Takvarning {
  part: { id: string; code: string; name: string };
  used_minutes: number;
  used_amount_ore: number;
  cap_hours: number | null;
  cap_amount_ore: number | null;
  share: number;
  over_cap: boolean;
  message: string;
}

const timtal = (minuter: number): string => (minuter / 60).toFixed(2).replace('.', ',');

function varningstext(del: Delforbrukning, over: boolean): string {
  const tak = del.cap_hours !== null ? `${del.cap_hours.toFixed(2).replace('.', ',')} h` : `${(del.cap_amount_ore! / 100).toFixed(2).replace('.', ',')} kr`;
  const forbrukat = del.cap_hours !== null ? `${timtal(del.billable_minutes)} h` : `${(del.amount_ore / 100).toFixed(2).replace('.', ',')} kr`;
  const inledning = `${del.code} ${del.name}: ${forbrukat} av taket ${tak}`;
  return over
    ? `${inledning} — taket är passerat. Avtalet kräver skriftligt besked till kunden om ändrad omfattning.`
    : `${inledning} (${Math.round(del.share! * 100)} %).`;
}

/**
 * De delar (och deras föräldrar) som en klassificering rör och som passerat
 * varningsgränsen. Bara BEKRÄFTADE tak kommer med — se filens huvud.
 */
async function takutfall(
  client: PoolClient, companyId: string, partIds: string[],
): Promise<{ berorda: Delforbrukning[]; alla: Delforbrukning[] }> {
  const unika = [...new Set(partIds)];
  if (unika.length === 0) return { berorda: [], alla: [] };
  const angivna = await client.query<{ contract_id: string }>(
    'SELECT DISTINCT contract_id FROM contract_parts WHERE company_id = $1 AND id = ANY($2::uuid[])',
    [companyId, unika],
  );

  const alla: Delforbrukning[] = [];
  for (const { contract_id: contractId } of angivna.rows) {
    alla.push(...await forbrukningForAvtal(client, companyId, { contractId }));
  }

  // Föräldrakedjan räknas med: en post på Fas 2A förbrukar också Fas 2:s tak,
  // och det är föräldertaket som är hela poängen med hierarkin.
  const koder = new Set<string>();
  for (const del of alla) {
    if (!unika.some((id) => del.part_id === id || del.versions.some((v) => v.id === id))) continue;
    let nod: Delforbrukning | undefined = del;
    for (let djup = 0; nod !== undefined && djup <= 10; djup += 1) {
      const nuvarande: Delforbrukning = nod;
      koder.add(`${nuvarande.contract_id}|${nuvarande.code}`);
      nod = nuvarande.parent_code === null
        ? undefined
        : alla.find((d) => d.contract_id === nuvarande.contract_id && d.code === nuvarande.parent_code);
    }
  }
  return { berorda: alla.filter((d) => koder.has(`${d.contract_id}|${d.code}`)), alla };
}

/**
 * Takvarningen EFTER en sparad post (KRAV-8). Posten är redan skriven när den
 * här körs — varningen är ett besked, aldrig en spärr. Ett överskridande skrivs
 * dessutom i auditloggen, så att "vi visste inte" aldrig är sant i efterhand.
 */
export async function takvarningEfterSparad(
  client: PoolClient, companyId: string, userId: string, partId: string | null, timeEntryId: string,
): Promise<Takvarning | null> {
  if (!partId) return null;
  const { berorda } = await takutfall(client, companyId, [partId]);
  const traffade = berorda
    .filter((d) => d.cap_status === 'bekraftat' && d.share !== null && d.share >= VARNINGSGRANS)
    .sort((a, b) => b.share! - a.share!);
  const varst = traffade[0];
  if (!varst) return null;

  const over = varst.share! > 1;
  if (over) {
    await writeAudit(client, {
      companyId, userId, action: 'contract_part.cap_exceeded', entityType: 'contract_part', entityId: varst.part_id,
      details: {
        time_entry_id: timeEntryId, code: varst.code,
        billable_minutes: varst.billable_minutes, amount_ore: varst.amount_ore,
        cap_hours: varst.cap_hours, cap_amount_ore: varst.cap_amount_ore, share: varst.share,
      },
    });
  }
  return {
    part: { id: varst.part_id, code: varst.code, name: varst.name },
    used_minutes: varst.billable_minutes,
    used_amount_ore: varst.amount_ore,
    cap_hours: varst.cap_hours,
    cap_amount_ore: varst.cap_amount_ore,
    share: varst.share!,
    over_cap: over,
    message: varningstext(varst, over),
  };
}

/**
 * Spärren vid FAKTURERING (KRAV-11). Här flyttar pengarna sig, och här — men
 * bara här — säger systemet nej. Forceringen finns (`confirm_over_cap`) därför
 * att omfattningen kan ha ändrats muntligt; det som inte får finnas är att den
 * sker utan att någon tar ställning.
 */
export async function delarOverBekraftatTak(
  client: PoolClient, companyId: string, partIds: string[],
): Promise<Delforbrukning[]> {
  const { berorda } = await takutfall(client, companyId, partIds);
  return berorda.filter((d) => d.cap_status === 'bekraftat' && d.share !== null && d.share > 1);
}

// ---------------------------------------------------------------------------
// Kopplingen tidpost → avtalsdel
// ---------------------------------------------------------------------------

/** Finns aktiva avtalsdelar på uppdraget krävs klassificering (KRAV-7). */
export async function harAktivaAvtalsdelar(
  client: PoolClient, companyId: string, projectId: string,
): Promise<boolean> {
  const res = await client.query<{ finns: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM contract_parts cp
         JOIN contracts c ON c.id = cp.contract_id AND c.company_id = cp.company_id
        WHERE cp.company_id = $1 AND c.project_id = $2 AND cp.active
     ) AS finns`,
    [companyId, projectId],
  );
  return res.rows[0]?.finns === true;
}

/**
 * Avtalsdelen måste höra till SAMMA uppdrag som tidposten. Utan den kontrollen
 * hade en post kunnat förbruka taket i ett avtal den inte tillhör — ett tak som
 * går att fylla utifrån är inget tak.
 */
export async function avtalsdelForProjekt(
  client: PoolClient, companyId: string, projectId: string, contractPartId: string,
): Promise<AvtalsdelRad> {
  const rader = await hamtaDelar(client, companyId, { partId: contractPartId });
  const del = rader[0];
  if (!del) throw new NotFoundError('contract_part');
  if (del.project_id !== projectId) {
    throw new BadRequestError(
      'contract_part_project_mismatch',
      'avtalsdelen hör till ett annat uppdrag än tidposten',
    );
  }
  if (!del.active) {
    throw new BadRequestError('contract_part_inactive', 'avtalsdelen är avslutad och tar inte emot ny tid');
  }
  return del;
}

/**
 * Taxan i fallande ordning (KRAV-7): postens override → avtalsdelens →
 * avtalets → uppdragets. Den befintliga botten (post → uppdrag) bevaras exakt
 * för allt som inte har någon avtalsdel.
 */
export function gallandeTaxa(
  postTaxa: number | null, delTaxa: number | null, avtalTaxa: number | null, projektTaxa: number | null,
): number | null {
  return postTaxa ?? delTaxa ?? avtalTaxa ?? projektTaxa;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export interface CreateContractInput {
  project_id: string;
  customer_id?: string;
  name: string;
  signed_date?: string;
  payment_terms_days?: number;
  hourly_rate_ore?: number;
  source_file_id?: string;
  notes?: string;
}

export async function createContract(
  client: PoolClient, companyId: string, userId: string, input: CreateContractInput,
): Promise<Record<string, unknown>> {
  const p = await client.query<{ customer_id: string | null }>(
    'SELECT customer_id FROM projects WHERE id = $1 AND company_id = $2', [input.project_id, companyId],
  );
  const projekt = p.rows[0];
  if (!projekt) throw new NotFoundError('project');
  // Kunden ärvs från uppdraget när den inte anges — avtalet är kundens, och att
  // kräva att den skrivs in två gånger är att be om två olika svar.
  const customerId = input.customer_id ?? projekt.customer_id;
  if (customerId) {
    const c = await client.query('SELECT id FROM customers WHERE id = $1 AND company_id = $2', [customerId, companyId]);
    if (!c.rows[0]) throw new NotFoundError('customer');
  }
  if (input.source_file_id) {
    const f = await client.query('SELECT id FROM files WHERE id = $1 AND company_id = $2', [input.source_file_id, companyId]);
    if (!f.rows[0]) throw new NotFoundError('file');
  }

  const row = await client.query<{ id: string }>(
    `INSERT INTO contracts (company_id, project_id, customer_id, name, signed_date, payment_terms_days,
                            hourly_rate_ore, source_file_id, notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
    [companyId, input.project_id, customerId, input.name, input.signed_date ?? null,
      input.payment_terms_days ?? null, input.hourly_rate_ore ?? null, input.source_file_id ?? null,
      input.notes ?? null, userId],
  );
  const id = row.rows[0]!.id;
  await writeAudit(client, {
    companyId, userId, action: 'contract.created', entityType: 'contract', entityId: id,
    details: { project_id: input.project_id, name: input.name },
  });
  return getContractUsage(client, companyId, id);
}

/** Kolumnerna update_contract får röra. Aldrig ett kolumnnamn ur indata. */
const CONTRACT_UPDATE: Readonly<Record<string, string>> = {
  name: 'name',
  customer_id: 'customer_id',
  signed_date: 'signed_date',
  payment_terms_days: 'payment_terms_days',
  hourly_rate_ore: 'hourly_rate_ore',
  source_file_id: 'source_file_id',
  notes: 'notes',
};

export interface UpdateContractInput {
  contract_id: string;
  name?: string;
  customer_id?: string;
  signed_date?: string;
  payment_terms_days?: number;
  hourly_rate_ore?: number;
  source_file_id?: string;
  notes?: string;
}

export async function updateContract(
  client: PoolClient, companyId: string, userId: string, input: UpdateContractInput,
): Promise<Record<string, unknown>> {
  const { contract_id: contractId, ...falt } = input;
  const update = buildAllowlistedUpdate(CONTRACT_UPDATE, falt);
  if (!update) throw new BadRequestError('no_fields', 'inget att uppdatera');
  const res = await client.query(
    `UPDATE contracts SET ${update.setSql}
      WHERE id = $${update.values.length + 1} AND company_id = $${update.values.length + 2} RETURNING id`,
    [...update.values, contractId, companyId],
  );
  if (!res.rows[0]) throw new NotFoundError('contract');
  await writeAudit(client, {
    companyId, userId, action: 'contract.updated', entityType: 'contract', entityId: contractId,
    details: { falt: Object.keys(falt).filter((k) => falt[k as keyof typeof falt] !== undefined) },
  });
  return getContractUsage(client, companyId, contractId);
}

export interface UpsertContractPartInput {
  contract_id: string;
  code: string;
  name?: string;
  description?: string;
  parent_part_id?: string;
  billable?: boolean;
  hourly_rate_ore?: number;
  cap_hours?: number;
  cap_amount_ore?: number;
  cap_confirmed?: boolean;
  valid_from?: string;
  sort_order?: number;
  active?: boolean;
}

/** Kolumnerna upsert_contract_part får röra på en befintlig version. */
const CONTRACT_PART_UPDATE: Readonly<Record<string, string>> = {
  name: 'name',
  description: 'description',
  parent_part_id: 'parent_part_id',
  billable: 'billable',
  hourly_rate_ore: 'hourly_rate_ore',
  cap_hours: 'cap_hours',
  cap_amount_ore: 'cap_amount_ore',
  cap_confirmed: 'cap_confirmed',
  sort_order: 'sort_order',
  active: 'active',
  manually_edited: 'manually_edited',
};

/**
 * Skapar eller ändrar EN version av en avtalsdel. Nyckeln är
 * (avtal, kod, valid_from): samma `valid_from` ändrar den befintliga raden, ett
 * senare `valid_from` lägger en ny version bredvid den gamla.
 *
 * `manually_edited` sätts vid ÄNDRING, inte vid skapande: flaggan finns för att
 * skydda en människas rättelse mot den automatiska extraktionen ur avtalsfilen
 * (story 6) — samma regel som CRM:ets ursprungsmärkning.
 */
export async function upsertContractPart(
  client: PoolClient, companyId: string, userId: string, input: UpsertContractPartInput,
): Promise<Record<string, unknown>> {
  const avtal = await client.query<{ signed_date: string | null }>(
    'SELECT signed_date::text FROM contracts WHERE id = $1 AND company_id = $2',
    [input.contract_id, companyId],
  );
  const avtalsrad = avtal.rows[0];
  if (!avtalsrad) throw new NotFoundError('contract');

  // Utelämnad `valid_from` betyder "från avtalets början". Finns inget
  // undertecknandedatum finns inget att härleda den ur, och då frågar systemet
  // hellre än gissar: ett felaktigt startdatum flyttar tyst ett tak i tiden.
  const validFrom = input.valid_from ?? avtalsrad.signed_date;
  if (!validFrom) {
    throw new BadRequestError(
      'valid_from_required',
      'avtalet saknar undertecknandedatum — ange valid_from för avtalsdelen',
    );
  }

  if (input.parent_part_id) {
    const f = await client.query<{ contract_id: string }>(
      'SELECT contract_id FROM contract_parts WHERE id = $1 AND company_id = $2',
      [input.parent_part_id, companyId],
    );
    const foralder = f.rows[0];
    if (!foralder) throw new NotFoundError('contract_part');
    if (foralder.contract_id !== input.contract_id) {
      throw new BadRequestError('parent_part_other_contract', 'föräldradelen hör till ett annat avtal');
    }
  }

  const befintlig = await client.query<{ id: string }>(
    `SELECT id FROM contract_parts
      WHERE company_id = $1 AND contract_id = $2 AND code = $3 AND valid_from = $4 FOR UPDATE`,
    [companyId, input.contract_id, input.code, validFrom],
  );

  const befintligRad = befintlig.rows[0];
  if (befintligRad) {
    const update = buildAllowlistedUpdate(CONTRACT_PART_UPDATE, {
      name: input.name,
      description: input.description,
      parent_part_id: input.parent_part_id,
      billable: input.billable,
      hourly_rate_ore: input.hourly_rate_ore,
      cap_hours: input.cap_hours,
      cap_amount_ore: input.cap_amount_ore,
      cap_confirmed: input.cap_confirmed,
      sort_order: input.sort_order,
      active: input.active,
      manually_edited: true,
    });
    const id = befintligRad.id;
    await client.query(
      `UPDATE contract_parts SET ${update!.setSql}
        WHERE id = $${update!.values.length + 1} AND company_id = $${update!.values.length + 2}`,
      [...update!.values, id, companyId],
    );
    await writeAudit(client, {
      companyId, userId, action: 'contract_part.updated', entityType: 'contract_part', entityId: id,
      details: { contract_id: input.contract_id, code: input.code, valid_from: validFrom },
    });
    return getContractUsage(client, companyId, input.contract_id);
  }

  if (!input.name) {
    throw new BadRequestError('name_required', 'en ny avtalsdel behöver ett namn');
  }
  const row = await client.query<{ id: string }>(
    `INSERT INTO contract_parts (company_id, contract_id, parent_part_id, code, name, description, billable,
                                 hourly_rate_ore, cap_hours, cap_amount_ore, cap_confirmed, valid_from,
                                 sort_order, active)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
    [companyId, input.contract_id, input.parent_part_id ?? null, input.code, input.name,
      input.description ?? null, input.billable ?? true, input.hourly_rate_ore ?? null,
      input.cap_hours ?? null, input.cap_amount_ore ?? null, input.cap_confirmed ?? false, validFrom,
      input.sort_order ?? 0, input.active ?? true],
  );
  await writeAudit(client, {
    companyId, userId, action: 'contract_part.created', entityType: 'contract_part', entityId: row.rows[0]!.id,
    details: {
      contract_id: input.contract_id, code: input.code, valid_from: validFrom,
      cap_hours: input.cap_hours ?? null, cap_amount_ore: input.cap_amount_ore ?? null,
      cap_confirmed: input.cap_confirmed ?? false,
    },
  });
  return getContractUsage(client, companyId, input.contract_id);
}

interface ContractRad {
  id: string;
  project_id: string;
  project_name: string;
  customer_id: string | null;
  customer_name: string | null;
  name: string;
  signed_date: string | null;
  payment_terms_days: number | null;
  hourly_rate_ore: number | null;
  source_file_id: string | null;
  notes: string | null;
}

const AVTAL_KOLUMNER = `c.id, c.project_id, p.name AS project_name, c.customer_id, cu.name AS customer_name,
       c.name, c.signed_date::text, c.payment_terms_days, c.hourly_rate_ore, c.source_file_id, c.notes`;

export async function listContracts(
  client: PoolClient, companyId: string, filter: { project_id?: string; contract_id?: string } = {},
): Promise<Record<string, unknown>[]> {
  const res = await client.query<ContractRad>(
    `SELECT ${AVTAL_KOLUMNER}
       FROM contracts c
       JOIN projects p ON p.id = c.project_id AND p.company_id = c.company_id
       LEFT JOIN customers cu ON cu.id = c.customer_id AND cu.company_id = c.company_id
      WHERE c.company_id = $1
        AND ($2::uuid IS NULL OR c.project_id = $2)
        AND ($3::uuid IS NULL OR c.id = $3)
      ORDER BY c.signed_date DESC NULLS LAST, c.name`,
    [companyId, filter.project_id ?? null, filter.contract_id ?? null],
  );
  const delar = await forbrukningForAvtal(client, companyId, {
    contractId: filter.contract_id, projectId: filter.project_id,
  });
  return res.rows.map((avtal) => ({
    ...avtal,
    parts: delar.filter((d) => d.contract_id === avtal.id),
  }));
}

export async function getContractUsage(
  client: PoolClient, companyId: string, contractId: string,
): Promise<Record<string, unknown>> {
  const avtal = await listContracts(client, companyId, { contract_id: contractId });
  const rad = avtal[0];
  if (!rad) throw new NotFoundError('contract');
  return rad;
}

export interface AssignContractPartInput {
  time_entry_id: string;
  contract_part_id: string;
}

/**
 * Klassificerar en tidpost på en avtalsdel — och gör INGENTING annat.
 *
 * Den är därför tillåten även på en FAKTURERAD post, till skillnad från
 * `update_time_entry`. Skälet är att klassificeringen inte rör vad kunden
 * betalar: beloppet, minuterna och låset till fakturan är oförändrade efteråt.
 * Alternativet vore att de 25 juliposterna aldrig gick att hänföra till en
 * avtalsdel — och då hade takbevakningen börjat räkna från noll mitt i ett
 * avtal, vilket är precis vad PRD §1 rad 6 handlar om.
 */
export async function assignContractPart(
  client: PoolClient, companyId: string, userId: string, input: AssignContractPartInput,
): Promise<Record<string, unknown>> {
  const res = await client.query<{ id: string; project_id: string; contract_part_id: string | null; status: string }>(
    `SELECT id, project_id, contract_part_id, status FROM time_entries
      WHERE id = $1 AND company_id = $2 FOR UPDATE`,
    [input.time_entry_id, companyId],
  );
  const post = res.rows[0];
  if (!post) throw new NotFoundError('time_entry');

  const del = await avtalsdelForProjekt(client, companyId, post.project_id, input.contract_part_id);

  const uppdaterad = await client.query(
    'UPDATE time_entries SET contract_part_id = $3 WHERE id = $1 AND company_id = $2 RETURNING id',
    [input.time_entry_id, companyId, input.contract_part_id],
  );
  if (uppdaterad.rowCount !== 1) {
    throw new ConflictError('time_entry_changed', 'tidposten ändrades av en annan skrivning — försök igen');
  }

  await writeAudit(client, {
    companyId, userId, action: 'time_entry.contract_part_assigned', entityType: 'time_entry',
    entityId: input.time_entry_id,
    details: {
      fran_contract_part_id: post.contract_part_id, till_contract_part_id: input.contract_part_id,
      code: del.code, status: post.status,
    },
  });

  const warning = await takvarningEfterSparad(client, companyId, userId, input.contract_part_id, input.time_entry_id);
  return {
    id: input.time_entry_id,
    contract_part_id: input.contract_part_id,
    contract_part_code: del.code,
    status: post.status,
    ...(warning ? { warning } : {}),
  };
}
