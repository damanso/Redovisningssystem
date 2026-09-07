// Uppdragsytan S10.4, våg 6 (PRD FR-3/FR-5/FR-33, NFR-11, 1D Del 4.4): PENGARNA.
//
// 1D:s fråga är en enda: *hur ligger vi mot ram — i timmar, kronor och enskilda
// kostnader?* Talen fanns redan, men i tre olika hus: takberäkningen i
// `contracts.ts`, prognosen och tröskeln i svepets cache, kostnaderna i
// `receipts`. Den här filen är läsvägen som lägger dem bredvid varandra — och
// gör INGENTING annat. Fyra meningar bär den:
//
//   * **Ingen andra förbrukningsberäkning (FR-25).** Serien byggs ur samma
//     tidposter, samma statuspredikat, samma taxeordning (`gallandeTaxa`) och
//     samma heltalsregel (`timeEntryAmountOre`) som husets ENDA takberäkning.
//     Att den gör det är inte en avsikt utan en konstruktion: gruppnyckeln är
//     `forbrukningPerRad`:s egen (delens rad + de fyra taxekällorna), och det
//     kumulativa beloppet räknas ur den ackumulerade MINUTSUMMAN per grupp. Vid
//     seriens sista punkt är gruppens minutsumma hela dess minutsumma — alltså
//     exakt samma avrundning, alltså exakt rotdelens tal. En serie som summerar
//     till något annat än ramkortet hade varit ett andra svar på samma fråga.
//   * **Svepvärdena HÄMTAS, de härleds aldrig om.** Prognosens två ramdatum
//     (S7.4) och tröskellarmet (S6.2) läses ur `uppdrag_svepvarde` med varje
//     rads EGEN källa och lästidpunkt (FR-35). Bär raden inte den form läsaren
//     väntar sig är svaret `null` — "inget värde läst", aldrig ett tomt värde,
//     för de två betyder olika saker för den som läser (mönstret
//     `troskelutfall` i `uppdragLage.ts`).
//   * **Kostnaderna är bundna, aldrig hittade.** Bindningen kvitto → avtalsdel
//     ägs av svepet och kön (S6.1). Här läses den, med `oplanerad` som den står.
//   * **Utan avtal finns inget uppdrag att läsa.** Ett okänt eller främmande
//     `project_id`, och ett projekt utan ett enda avtal, ger 404 — aldrig en tom
//     yta, som hade sett ut som "uppdraget är tomt" i stället för "det här är
//     inget uppdrag". Samma mönster som `kravUppdrag` i `uppdragLage.ts`.
//
// Inga externa anrop (ADR-4/NFR-6): filen läser bara redan lagrad data.
import type { PoolClient } from 'pg';
import { NotFoundError } from '../lib/errors.js';
import { ROTKOD } from '../lib/leveranskontrakt.js';
import type { Troskelutfall } from '../lib/troskel.js';
import { gallandeTaxa, listContracts, type Delforbrukning } from './contracts.js';
import { arFakturerad, arGodkannande, timeEntryAmountOre, TIME_ENTRY_STATUSES } from './projects.js';
import type { Farskhet } from './uppdragLage.js';
import type { Prognosramar, Ramutfall } from './uppdragSvep.js';

export interface LasUppdragspengarInput {
  project_id: string;
}

/**
 * Statusarna som förbrukar ett tak, härledda ur husets EGNA predikat i stället
 * för skrivna en andra gång.
 *
 * `contracts.FORBRUKANDE_STATUSAR` är privat i sin fil, och att exportera den
 * hade varit en ändring i den fil S7.4/S6.2 äger. `arGodkannande ||
 * arFakturerad` ÄR samma tre statusar ('godkand', 'justerad', 'fakturerad') —
 * och till skillnad från en kopierad lista kan de två aldrig glida isär: ändras
 * livscykeln ändras båda samtidigt. Provet fäller listan om den inte längre är
 * husets tre.
 */
export const FORBRUKANDE_STATUSAR: string[] =
  TIME_ENTRY_STATUSES.filter((s) => arGodkannande(s) || arFakturerad(s));

/**
 * En dag i den kumulativa förbrukningskurvan.
 *
 * `minuter`/`oren` är DAGENS eget tillskott, `kum_*` summan t.o.m. dagen. Två
 * tal och aldrig en andel: en procentsats döljer vilket av dem som rörde sig
 * (NFR-11).
 */
export interface Forbrukningspunkt {
  work_date: string;
  minuter: number;
  oren: number;
  kum_minuter: number;
  kum_oren: number;
}

/** Rotdelens tak, precis som takvarningen och faktureringsspärren ser det. */
export interface Pengaram {
  /** Taket i hela minuter (`cap_hours` × 60, avrundat) — husets heltalsregel. */
  tak_minuter: number | null;
  tak_ore: number | null;
  /** 'bekraftat' = taket får läsas som en ram. 'vet_ej' = NULL eller oläst. */
  tak_status: 'bekraftat' | 'vet_ej';
}

/**
 * Ett värde ur svepets cache med sin egen färskhet (FR-35).
 *
 * Färskheten sitter på VÄRDET och inte på sidan: två nycklar kan ha skrivits
 * vid olika körningar, och ett tal daterat med en grannyckels lästidpunkt vore
 * precis den lögn FR-35 finns för att stänga.
 */
export interface Svepvarde<T> {
  varde: T;
  farskhet: Farskhet;
}

/** En bunden kostnad, läst ur redovisningen. Bindningen görs aldrig här. */
export interface Kostnadsrad {
  receipt_id: string;
  datum: string;
  /** Kvitton utan leverantör finns (`supplier_id` är nullbar) — då står null. */
  leverantor: string | null;
  total_ore: number;
  status: string;
  /** Avtalsdelens kod, den version kvittot faktiskt är bundet till. */
  kod: string;
  /** Kostnaden fanns inte i baselinen när den bands (0068). */
  oplanerad: boolean;
}

export interface Avtalspengar {
  contract_id: string;
  contract_name: string;
  /** Kumulativt per `work_date`, i datumordning. Tom = ingen förbrukande tid. */
  serie: Forbrukningspunkt[];
  ram: Pengaram;
  /** S7.4:s två ramdatum ur cachen. null = svepet har inte kört (eller okänd form). */
  prognos: Svepvarde<Prognosramar> | null;
  /** S6.2:s redan härledda larm ur cachen. null = samma sak. */
  troskellarm: Svepvarde<Troskelutfall> | null;
  kostnader: Kostnadsrad[];
}

export interface Uppdragspengar {
  uppdrag: {
    project_id: string;
    number: number;
    name: string;
    status: string;
    customer_id: string | null;
    customer_name: string | null;
  };
  avtal: Avtalspengar[];
}

interface Uppdragsrad {
  id: string;
  number: number;
  name: string;
  status: string;
  customer_id: string | null;
  customer_name: string | null;
}

/**
 * Uppdraget måste finnas i BOLAGET. RLS fäller ett grannbolags projekt ändå,
 * men en tom yta hade sett ut som "uppdraget är tomt" i stället för "inte ditt
 * uppdrag". Samma uppslag som `uppdragLage.kravUppdrag`.
 */
async function kravUppdrag(client: PoolClient, companyId: string, projectId: string): Promise<Uppdragsrad> {
  const res = await client.query<Uppdragsrad>(
    `SELECT p.id, p.number, p.name, p.status, p.customer_id, cu.name AS customer_name
       FROM projects p
       LEFT JOIN customers cu ON cu.id = p.customer_id AND cu.company_id = p.company_id
      WHERE p.id = $1 AND p.company_id = $2`,
    [projectId, companyId],
  );
  const rad = res.rows[0];
  if (!rad) throw new NotFoundError('project');
  return rad;
}

/** Taket i hela minuter. `cap_hours` är numeric(8,2) — omräkningen sker EN gång. */
function takminuter(capHours: number | null): number | null {
  return capHours === null ? null : Math.round(capHours * 60);
}

/**
 * Rotdelens nod: `UPPDRAG` utan förälder. Barnens tid är redan upprullad där
 * (`byggForbrukning` i contracts.ts), så uppdragets ram är EN rad.
 */
function rotdel(delar: Delforbrukning[]): Delforbrukning | null {
  return delar.find((d) => d.code === ROTKOD && d.parent_code === null) ?? null;
}

/**
 * Alla avtalsdelsRADER (alla versioner) i rotdelens träd.
 *
 * Serien ska summera till rotdelens tal, alltså måste den mätas på exakt de
 * rader rotdelen rullade upp — varken fler eller färre. Trädet är husets eget
 * (`parent_code` ur `forbrukningForAvtal`); `sedda` gör att en cykel i
 * föräldrakedjan ger ett ofullständigt urval i stället för en oändlig loop,
 * samma försiktighet som uppräkningen i `byggForbrukning`.
 */
function versionerITradet(delar: Delforbrukning[], rot: Delforbrukning): string[] {
  const barn = new Map<string, Delforbrukning[]>();
  for (const d of delar) {
    if (d.parent_code === null) continue;
    barn.set(d.parent_code, [...(barn.get(d.parent_code) ?? []), d]);
  }
  const ids: string[] = [];
  const sedda = new Set<string>();
  const stack: Delforbrukning[] = [rot];
  while (stack.length > 0) {
    const nod = stack.pop()!;
    if (sedda.has(nod.code)) continue;
    sedda.add(nod.code);
    for (const v of nod.versions) ids.push(v.id);
    for (const b of barn.get(nod.code) ?? []) stack.push(b);
  }
  return ids;
}

interface Tidrad {
  work_date: string;
  part_id: string;
  post_taxa: number | null;
  del_taxa: number | null;
  avtal_taxa: number | null;
  projekt_taxa: number | null;
  minuter: number;
}

/**
 * Den kumulativa serien per `work_date`.
 *
 * Grupperingen är `forbrukningPerRad`:s egen — delens rad plus de fyra
 * taxekällorna — och beloppet räknas i JS med husets taxeordning och
 * heltalsregel. Att dividera med 60 i SQL hade gjort mellanledet till ett
 * flyttal, och att låta Postgres välja taxa med en COALESCE hade gjort
 * ordningen till en andra kopia.
 *
 * Det kumulativa beloppet räknas ur den ackumulerade MINUTSUMMAN per grupp och
 * aldrig som en summa av dagsbelopp: bara då är sista punktens öretal exakt
 * `Math.round(minuter × taxa / 60)` per grupp — alltså exakt rotdelens
 * `amount_ore`, utan en avrundningsdrift ingen kan se.
 */
async function byggSerie(
  client: PoolClient, companyId: string, versionsIds: string[],
): Promise<Forbrukningspunkt[]> {
  if (versionsIds.length === 0) return [];
  const res = await client.query<Tidrad>(
    `SELECT t.work_date::text AS work_date,
            t.contract_part_id AS part_id,
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
      GROUP BY 1, 2, 3, 4, 5, 6
      ORDER BY 1`,
    [companyId, versionsIds, FORBRUKANDE_STATUSAR],
  );

  const kumPerGrupp = new Map<string, { taxa: number | null; minuter: number }>();
  const serie: Forbrukningspunkt[] = [];
  let forraMinuter = 0;
  let forraOren = 0;
  let i = 0;
  while (i < res.rows.length) {
    const datum = res.rows[i]!.work_date;
    while (i < res.rows.length && res.rows[i]!.work_date === datum) {
      const rad = res.rows[i]!;
      const nyckel = `${rad.part_id}|${String(rad.post_taxa)}|${String(rad.del_taxa)}|${String(rad.avtal_taxa)}|${String(rad.projekt_taxa)}`;
      const hink = kumPerGrupp.get(nyckel)
        ?? { taxa: gallandeTaxa(rad.post_taxa, rad.del_taxa, rad.avtal_taxa, rad.projekt_taxa), minuter: 0 };
      hink.minuter += rad.minuter;
      kumPerGrupp.set(nyckel, hink);
      i += 1;
    }
    let kumMinuter = 0;
    let kumOren = 0;
    for (const hink of kumPerGrupp.values()) {
      kumMinuter += hink.minuter;
      kumOren += timeEntryAmountOre(hink.minuter, hink.taxa);
    }
    serie.push({
      work_date: datum,
      minuter: kumMinuter - forraMinuter,
      oren: kumOren - forraOren,
      kum_minuter: kumMinuter,
      kum_oren: kumOren,
    });
    forraMinuter = kumMinuter;
    forraOren = kumOren;
  }
  return serie;
}

interface Svepvarderad {
  nyckel: string;
  varde: unknown;
  kalla: string | null;
  /** pg ger timestamptz som Date; svaret bär den som ISO och aldrig som lokaltext. */
  last_nar: Date;
}

const KALLA_REDOVISNING = 'redovisning';

/**
 * Svepets två nycklar MED tidsstämpeln. `lasSvepvarden` utelämnar `last_nar`
 * med flit (den läsvägen finns för att cachen ska gå att räkna om till samma
 * rader i morgon), så färskheten hämtas här — samma grepp som `svepcache` i
 * `uppdragLage.ts`.
 */
async function svepvarden(
  client: PoolClient, companyId: string, contractId: string,
): Promise<Svepvarderad[]> {
  const res = await client.query<Svepvarderad>(
    `SELECT nyckel, varde, kalla, last_nar
       FROM uppdrag_svepvarde
      WHERE company_id = $1 AND contract_id = $2 AND nyckel = ANY($3::text[])`,
    [companyId, contractId, ['prognos', 'troskellarm']],
  );
  return res.rows;
}

/**
 * Ett ramutfall, om raden bär den form S7.4 skriver: ETT datum ELLER ETT
 * villkor, aldrig båda och aldrig något annat. `varde` är fri JSON och lovar
 * ingen form — en cache som bär något annat läses som "inget värde", inte som
 * ett tomt värde.
 */
function ramutfall(varde: unknown): Ramutfall | null {
  if (typeof varde !== 'object' || varde === null) return null;
  const v = varde as { datum?: unknown; villkor?: unknown };
  if (typeof v.datum === 'string') return { datum: v.datum };
  if (typeof v.villkor === 'string') return { villkor: v.villkor };
  return null;
}

/** Prognosens två ramar. Saknar en av dem sin form är hela värdet oläst. */
function prognosramar(varde: unknown): Prognosramar | null {
  if (typeof varde !== 'object' || varde === null) return null;
  const v = varde as { ram_timmar?: unknown; ram_kronor?: unknown };
  const timmar = ramutfall(v.ram_timmar);
  const kronor = ramutfall(v.ram_kronor);
  return timmar === null || kronor === null ? null : { ram_timmar: timmar, ram_kronor: kronor };
}

/** Tröskellarmet, om raden ser ut som ett larmutfall (mönstret `troskelutfall`). */
function troskelutfall(varde: unknown): Troskelutfall | null {
  if (typeof varde !== 'object' || varde === null) return null;
  const v = varde as { larm?: unknown };
  return Array.isArray(v.larm) ? (varde as Troskelutfall) : null;
}

/** Ett cachat värde med sin egen rad-färskhet, eller null om formen inte bär. */
function svept<T>(rad: Svepvarderad | undefined, las: (v: unknown) => T | null): Svepvarde<T> | null {
  if (rad === undefined) return null;
  const varde = las(rad.varde);
  if (varde === null) return null;
  return {
    varde,
    farskhet: { kalla: rad.kalla ?? KALLA_REDOVISNING, last_nar: rad.last_nar.toISOString() },
  };
}

/**
 * De bundna kostnaderna, i datumordning.
 *
 * Bindningen läses mot avtalets delar i ALLA versioner (mönstret
 * `koposterForUppdraget`): ett kvitto kan vara bundet till den version som
 * gällde när bindningen skedde, och en kostnad som försvinner ur listan för att
 * avtalet fick ett tillägg vore en tyst förlust.
 */
async function kostnaderForAvtal(
  client: PoolClient, companyId: string, contractId: string,
): Promise<Kostnadsrad[]> {
  const res = await client.query<{
    receipt_id: string; datum: string; leverantor: string | null;
    total_ore: string; status: string; kod: string; oplanerad: boolean;
  }>(
    `SELECT r.id AS receipt_id, r.receipt_date::text AS datum, s.name AS leverantor,
            r.total_ore::text AS total_ore, r.status, cp.code AS kod, r.oplanerad
       FROM receipts r
       JOIN contract_parts cp ON cp.id = r.contract_part_id AND cp.company_id = r.company_id
       LEFT JOIN suppliers s ON s.id = r.supplier_id AND s.company_id = r.company_id
      WHERE r.company_id = $1 AND cp.contract_id = $2
      ORDER BY r.receipt_date, r.receipt_number`,
    [companyId, contractId],
  );
  return res.rows.map((rad) => ({
    receipt_id: rad.receipt_id,
    datum: rad.datum,
    leverantor: rad.leverantor,
    // bigint kommer ur pg som sträng — ören är heltal hela vägen, aldrig float.
    total_ore: Number(rad.total_ore),
    status: rad.status,
    kod: rad.kod,
    oplanerad: rad.oplanerad,
  }));
}

/**
 * Pengarna för ETT uppdrag: serien, ramen, de två cachade svepvärdena och de
 * bundna kostnaderna — per avtal, allt läst och inget räknat om.
 */
export async function lasUppdragspengar(
  client: PoolClient, companyId: string, input: LasUppdragspengarInput,
): Promise<Uppdragspengar> {
  const uppdrag = await kravUppdrag(client, companyId, input.project_id);
  const avtalsrader = await listContracts(client, companyId, { project_id: input.project_id });
  // Ett projekt utan ett enda avtal är inget uppdrag (1E Del 5): utan avtal
  // finns varken ram, prognos eller bunden kostnad att läsa.
  if (avtalsrader.length === 0) throw new NotFoundError('project');

  const avtal: Avtalspengar[] = [];
  for (const rad of avtalsrader) {
    const contractId = rad.id as string;
    // `listContracts` bär redan husets enda takberäkning per avtal
    // (`forbrukningForAvtal`) — en egen omkörning hade varit samma fråga två
    // gånger, och två svar på den frågan är ett fel.
    const delar = (rad.parts as Delforbrukning[] | undefined) ?? [];
    const rot = rotdel(delar);
    const cache = await svepvarden(client, companyId, contractId);

    avtal.push({
      contract_id: contractId,
      contract_name: String(rad.name ?? ''),
      serie: rot === null ? [] : await byggSerie(client, companyId, versionerITradet(delar, rot)),
      ram: {
        tak_minuter: takminuter(rot?.cap_hours ?? null),
        tak_ore: rot?.cap_amount_ore ?? null,
        tak_status: rot?.cap_status ?? 'vet_ej',
      },
      prognos: svept(cache.find((v) => v.nyckel === 'prognos'), prognosramar),
      troskellarm: svept(cache.find((v) => v.nyckel === 'troskellarm'), troskelutfall),
      kostnader: await kostnaderForAvtal(client, companyId, contractId),
    });
  }

  return {
    uppdrag: {
      project_id: uppdrag.id,
      number: uppdrag.number,
      name: uppdrag.name,
      status: uppdrag.status,
      customer_id: uppdrag.customer_id,
      customer_name: uppdrag.customer_name,
    },
    avtal,
  };
}
