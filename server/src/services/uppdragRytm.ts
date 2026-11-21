// Uppdragsytan Story 2.3 (FR-14, FR-19, FR-26, FR-35, B-14): bedömningsrytmen
// och uppföljningsmåtten ur avtalet.
//
// Kontraktets del 4 ger rytmen och del 3 måtten; importen skriver dem efter
// Davids ja (`services/uppdragImport.ts`). Den här filen gör två saker till:
//
//   * **David sätter ankardatumet** (`satt_bedomningsankare`, `kravManniska`).
//     Utan ankare räknas inga perioder. Källan är obligatorisk: en
//     kalenderreferens som Hermes har länkat till avtalet, eller Davids egen
//     uppgift. Ankaret sätts en gång; ett satt ankare ändras bara genom en
//     baselineändring med orsak (B6, Story 2.4). Tre spärrar bär det: radlåset
//     och villkoret i UPDATE:n här, `update_contract`:s strikta schema och
//     importens tillåtelselista, som inte nämner ankaret.
//   * **En skrivväg till rytm- och ankarkolumnerna:** `skrivRytmkolumner`, för
//     ankaret och för importens rytm. Den spärrar ett avslutat uppdrag (FR-8)
//     och skriver aldrig under ett satt ankare. `contracts` saknar 0068:s
//     avslutstrigger, så spärren bor här och ärvs av varje skrivare.
//   * **Läget, Bedömning och undantagsvyn läser rytmen och måtten här.** Varje
//     period räknas av den rena `bedomningsrytmlage` (`lib/bedomningsrytm.ts`),
//     och varje måtts värde bär sin källa och lästid (`Lasvarde`, B-12).
//
// Filen ringer aldrig ut (ADR-4, NFR-6): allt läses ur egna tabeller genom
// anroparens tenanttransaktion, och varje sats bär `company_id` också med RLS.
// Fel kastas och fångas aldrig inne i transaktionen (lärdom 2).
import type { PoolClient } from 'pg';
import {
  ankarhinder, ANKARHINDER, ankarkallatext, bedomningsrytmlage, isoVeckodag,
  type Ankarkalla, type Bedomningsrytm, type Rytmutfall,
} from '../lib/bedomningsrytm.js';
import { BadRequestError, ConflictError, NotFoundError } from '../lib/errors.js';
import { KALLA_REDOVISNING, saknas, type Lasvarde } from '../lib/lasvarde.js';
import { mattlasare, type Uppfoljningsmatt } from '../lib/leveranskontrakt.js';
import { buildAllowlistedUpdate } from '../lib/updateBuilder.js';
import { writeAudit } from './auditService.js';

/** ISO-veckodagarnas namn, för felets text. */
const VECKODAGSNAMN = ['måndag', 'tisdag', 'onsdag', 'torsdag', 'fredag', 'lördag', 'söndag'];

/**
 * Kolumnerna ankaråtgärden får skriva. Aldrig ett kolumnnamn ur indata, och
 * ingen annan väg i berättelsen skriver dem.
 */
const ANKARE_UPDATE: Readonly<Record<string, string>> = {
  bedomning_ankare: 'bedomning_ankare',
  bedomning_ankare_kalla: 'bedomning_ankare_kalla',
};

// ---------------------------------------------------------------------------
// Rytmraden: en läsning och en skrivväg
// ---------------------------------------------------------------------------

/**
 * Avtalets rytm- och ankarkolumner och om uppdraget är avslutat. Kolumnerna
 * `contracts` saknar avslutstriggern (0068 lägger den bara på delarna och
 * modulens tabeller), så avslutet läses här och prövas i koden.
 */
export interface Rytmrad {
  rytm_text: string | null;
  bedomning_intervall_dagar: number | null;
  bedomning_veckodag: number | null;
  bedomning_ankare: string | null;
  bedomning_ankare_kalla: string | null;
  rapport_mottagarkrets: string | null;
  uppdrag_avslutat: boolean;
}

/**
 * Den ENDA läsningen av rytmraden — för Läget, Bedömning, undantagsvyn, ankaret
 * och importen. `forSkrivning` tar radlåset på avtalet i anroparens
 * transaktion. Ingen rad (också grannbolagets avtal) ger `undefined`.
 */
export async function lasRytmraden(
  client: PoolClient, companyId: string, contractId: string, forSkrivning = false,
): Promise<Rytmrad | undefined> {
  return (await client.query<Rytmrad>(
    `SELECT c.rytm_text, c.bedomning_intervall_dagar, c.bedomning_veckodag,
            c.bedomning_ankare::text AS bedomning_ankare, c.bedomning_ankare_kalla, c.rapport_mottagarkrets,
            coalesce(p.status = 'closed', false) AS uppdrag_avslutat
       FROM contracts c
       LEFT JOIN projects p ON p.id = c.project_id AND p.company_id = c.company_id
      WHERE c.id = $1 AND c.company_id = $2${forSkrivning ? ' FOR UPDATE OF c' : ''}`,
    [contractId, companyId],
  )).rows[0];
}

/**
 * Den ENDA vägen in till rytm- och ankarkolumnerna på `contracts`, för
 * importens rytm och för ankaret. Två spärrar som varje skrivare ärver:
 *
 *   * **ett avslutat uppdrag tar inte emot något** (FR-8): 409
 *     `uppdrag_avslutat` före UPDATE:n, i samma transaktion och efter radlåset;
 *   * **ett satt ankare skrivs aldrig över:** UPDATE:n bär villkoret
 *     `bedomning_ankare IS NULL`, och rytmen under ett satt ankare skrivs inte
 *     heller — då hade ankaret hamnat på fel veckodag i en ny rytm.
 *
 * Kolumnerna kommer ur anroparens fasta tillåtelselista, aldrig ur indata.
 * Svaret är antalet uppdaterade rader: 0 betyder att ankaret redan stod där.
 */
export async function skrivRytmkolumner(
  client: PoolClient, companyId: string, contractId: string,
  tillatna: Readonly<Record<string, string>>, varden: Record<string, unknown>,
): Promise<number> {
  const rad = await lasRytmraden(client, companyId, contractId, true);
  if (!rad) throw new NotFoundError('contract');
  if (rad.uppdrag_avslutat) throw new ConflictError('uppdrag_avslutat', ANKARHINDER.uppdrag_avslutat);
  const update = buildAllowlistedUpdate(tillatna, varden);
  if (!update) return 0;
  const res = await client.query(
    `UPDATE contracts SET ${update.setSql}
      WHERE id = $${update.values.length + 1} AND company_id = $${update.values.length + 2}
        AND bedomning_ankare IS NULL`,
    [...update.values, contractId, companyId],
  );
  return res.rowCount ?? 0;
}

// ---------------------------------------------------------------------------
// satt_bedomningsankare
// ---------------------------------------------------------------------------

export interface SattBedomningsankareInput {
  contract_id: string;
  ankare: string;
  kalla: Ankarkalla;
}

/**
 * David sätter det första bedömningstillfället. I åtgärdens transaktion:
 * radlåset på avtalet, hindren i `ankarhinder` (avslutat uppdrag, rytmen, det
 * redan satta ankaret — samma prövning som avgör om vyn visar formuläret),
 * veckodagen, källan, UPDATE:n genom `skrivRytmkolumner` och auditraden.
 * Auditraden bär bara id, datum och källans sort — ingen fritext (lärdom 10).
 */
export async function sattBedomningsankare(
  client: PoolClient, companyId: string, userId: string, input: SattBedomningsankareInput,
): Promise<Record<string, unknown>> {
  const avtal = await lasRytmraden(client, companyId, input.contract_id, true);
  // Grannbolagets avtal finns inte här: 404, aldrig 403.
  if (!avtal) throw new NotFoundError('contract');
  const hinder = ankarhinder(avtal);
  if (hinder !== null) throw new ConflictError(hinder, ANKARHINDER[hinder]);
  if (avtal.bedomning_veckodag !== null && isoVeckodag(input.ankare) !== avtal.bedomning_veckodag) {
    throw new BadRequestError('fel_veckodag',
      `Ankardatumet ${input.ankare} är ingen ${VECKODAGSNAMN[avtal.bedomning_veckodag - 1] ?? 'dag i rytmen'}, som rytmen säger.`);
  }
  if (input.kalla.typ === 'kalender') {
    // Samma fråga som formulärets lista: en referens som formuläret inte
    // erbjuder — trasig, utanför spärren, en annan sort eller ett annat
    // avtals — kan inte heller bli källan genom REST eller MCP.
    const referens = (await lasKalenderreferenser(client, companyId, input.contract_id, input.kalla.referens_id))[0];
    if (!referens) {
      throw new BadRequestError('okand_kalenderreferens', 'Kalenderreferensen finns inte bland avtalets kalenderposter.');
    }
    if (referens.handelse_datum !== null && referens.handelse_datum !== input.ankare) {
      throw new BadRequestError('kalla_annat_datum',
        `Kalenderposten gäller ${referens.handelse_datum}, inte ankardatumet ${input.ankare}.`);
    }
  }

  const kallatext = ankarkallatext(input.kalla);
  const skrivna = await skrivRytmkolumner(client, companyId, input.contract_id, ANKARE_UPDATE, {
    bedomning_ankare: input.ankare,
    bedomning_ankare_kalla: kallatext,
  });
  // Andra spärren efter radlåset: ingen rad uppdaterad betyder att ankaret redan stod där.
  if (skrivna === 0) throw new ConflictError('ankare_redan_satt', ANKARHINDER.ankare_redan_satt);

  await writeAudit(client, {
    companyId, userId, action: 'uppdrag.bedomningsankare_satt',
    entityType: 'contract', entityId: input.contract_id,
    details: { contract_id: input.contract_id, ankare: input.ankare, kalla_typ: input.kalla.typ },
  });

  // Samma UTC-datum som Bedömning räknar perioden på.
  const idag = new Date().toISOString().slice(0, 10);
  return {
    contract_id: input.contract_id,
    bedomning_ankare: input.ankare,
    bedomning_ankare_kalla: kallatext,
    nasta: bedomningsrytmlage({
      intervall_dagar: avtal.bedomning_intervall_dagar,
      veckodag: avtal.bedomning_veckodag,
      ankare: input.ankare,
    }, idag).nasta,
  };
}

/** En kalenderpost som ankaret kan hämta sin källa ur. Titeln är den som gällde vid länkningen. */
export interface Kalenderreferens {
  id: string;
  titel_vid_lankning: string | null;
  handelse_datum: string | null;
}

/**
 * Avtalets användbara kalenderreferenser: de Hermes har länkat, utom de som är
 * trasiga eller står utanför spärren. Den ENDA frågan — formulärets lista och
 * åtgärdens kontroll (med `id`) läser samma villkor, så att det formuläret inte
 * erbjuder inte heller går att posta. Händelsedatumet först, och `id` sist så
 * att listan inte byter ordning mellan omladdningar.
 */
async function lasKalenderreferenser(
  client: PoolClient, companyId: string, contractId: string, id: string | null = null,
): Promise<Kalenderreferens[]> {
  return (await client.query<Kalenderreferens>(
    `SELECT id, titel_vid_lankning, handelse_datum::text AS handelse_datum
       FROM uppdrag_referens
      WHERE company_id = $1 AND contract_id = $2 AND sort = 'kalender'
        AND status NOT IN ('trasig', 'utanfor_sparr')
        AND ($3::uuid IS NULL OR id = $3::uuid)
      ORDER BY handelse_datum NULLS LAST, id`,
    [companyId, contractId, id],
  )).rows;
}

/** Avtalets kalenderreferenser för ankarformuläret. */
export async function kalenderreferenser(
  client: PoolClient, companyId: string, contractId: string,
): Promise<Kalenderreferens[]> {
  return lasKalenderreferenser(client, companyId, contractId);
}

// ---------------------------------------------------------------------------
// Läsvägen: rytmen
// ---------------------------------------------------------------------------

/** Avtalets rytm som Läget, Bedömning och undantagsvyn visar den. */
export type Avtalsrytm = Rytmrad & Rytmutfall;

/** Rytmkolumnerna i den form den rena rytmregeln tar dem. */
export const rytmen = (a: Pick<Rytmrad, 'bedomning_intervall_dagar' | 'bedomning_veckodag' | 'bedomning_ankare'>): Bedomningsrytm => ({
  intervall_dagar: a.bedomning_intervall_dagar,
  veckodag: a.bedomning_veckodag,
  ankare: a.bedomning_ankare,
});

/**
 * Avtalets rytm med läget för `idag` (`YYYY-MM-DD`). Anroparen ger dagen, så
 * att perioden räknas på samma klocka som resten av ytan.
 */
export async function lasBedomningsrytm(
  client: PoolClient, companyId: string, contractId: string, idag: string,
): Promise<Avtalsrytm> {
  const rad = await lasRytmraden(client, companyId, contractId);
  if (!rad) throw new NotFoundError('contract');
  return { ...rad, ...bedomningsrytmlage(rytmen(rad), idag) };
}

// ---------------------------------------------------------------------------
// Läsvägen: måtten
// ---------------------------------------------------------------------------

/** Tid mot ram: två tal, aldrig en kvot (NFR-11). */
export interface Tidmotram {
  minuter: number;
  tak_minuter: number | null;
}

/** Ett lagrat mått med sitt värde. `varde` är NULL när utfallet inte härleds. */
export interface Mattrad extends Uppfoljningsmatt {
  ordning: number;
  varde: Lasvarde<Tidmotram> | null;
}

/** Avtalets mått ur del 3, i kontraktets ordning. */
export async function lasUppfoljningsmatt(
  client: PoolClient, companyId: string, contractId: string,
): Promise<Array<Uppfoljningsmatt & { ordning: number }>> {
  return (await client.query<Uppfoljningsmatt & { ordning: number }>(
    `SELECT namn, hur_ofta, kallreferenser, lasvag, larmregel, larmregel_lage, utfall_lage, ordning
       FROM uppdrag_matt
      WHERE company_id = $1 AND contract_id = $2
      ORDER BY ordning, namn`,
    [companyId, contractId],
  )).rows;
}

/**
 * Måttets värde. Ett utfall som inte härleds har inget värde (NULL), och vyn
 * skriver det. Den enda läsaren, tid mot ram, för förbrukningens `Lasvarde`
 * vidare oförändrat — samma läge, källa och lästid, så att en oläst källa
 * aldrig blir ett färskt värde här. Ett härlett utfall utan läsare saknas i
 * underlaget; ingen siffra hittas på.
 */
export function mattvarde(
  matt: Pick<Uppfoljningsmatt, 'namn' | 'lasvag' | 'utfall_lage'>, forbrukning: Lasvarde<Tidmotram>,
): Lasvarde<Tidmotram> | null {
  if (matt.utfall_lage === 'harleds_ej') return null;
  if (mattlasare(matt.namn, matt.lasvag) === 'tid_mot_ram') return forbrukning;
  return saknas(KALLA_REDOVISNING, forbrukning.last_nar);
}
