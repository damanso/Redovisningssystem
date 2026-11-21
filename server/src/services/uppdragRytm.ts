// Uppdragsytan Story 2.3 (FR-14, FR-19, B-14): bedömningsrytmen och
// uppföljningsmåtten ur avtalet.
//
// Rytmen och måtten är avtalets egna ord (BASELINE). De skrivs av importen
// efter Davids ja och läses här. Ett enda värde skrivs av någon annan än
// importen: ANKARET, det datum rytmens tillfällen räknas från. Kontraktet
// säger ”varannan torsdag” men aldrig vilken, och ett gissat ankare flyttar
// varje period utan att någon ser det. Därför sätter David det, med källa,
// genom den människospärrade `satt_bedomningsankare` — en gång.
//
// Tre regler som filen inte får bryta:
//
//   * **Ankaret skrivs aldrig över.** Radlåset och villkoret i UPDATE:n gör att
//     ett satt ankare ger 409. Ändringen hör till baselineförslaget (Story 2.4).
//   * **Ingen period räknas här.** Varje period kommer ur `bedomningsrytmlage`
//     i `lib/bedomningsrytm.ts`, samma regel som Bedömning och undantagsvyn.
//   * **Ett oläst värde visas som oläst.** `mattvarde` för källans `Lasvarde`
//     vidare oförändrat; ingen inmatning ersätter en läsning (FR-35).
//
// Inga externa anrop (ADR-4/NFR-6): filen läser och skriver bara egna tabeller.
import type { PoolClient } from 'pg';
import {
  ankarkallatext, bedomningsrytmlage, isoVeckodag, type Ankarkalla, type Bedomningsrytm, type Rytmutfall,
} from '../lib/bedomningsrytm.js';
import { BadRequestError, ConflictError, NotFoundError } from '../lib/errors.js';
import { KALLA_REDOVISNING, saknas, type Lasvarde } from '../lib/lasvarde.js';
import { mattlasare, type Uppfoljningsmatt } from '../lib/leveranskontrakt.js';
import { buildAllowlistedUpdate } from '../lib/updateBuilder.js';
import { writeAudit } from './auditService.js';

// ---------------------------------------------------------------------------
// Läsvägen: rytmen och måtten (Story 2.3, uppgift 6)
// ---------------------------------------------------------------------------

/** Avtalets rytmkolumner och perioden ur regeln, för en given dag. */
export interface Avtalsrytm extends Rytmutfall {
  rytm_text: string | null;
  bedomning_intervall_dagar: number | null;
  bedomning_veckodag: number | null;
  rapport_mottagarkrets: string | null;
  bedomning_ankare: string | null;
  bedomning_ankare_kalla: string | null;
}

/** Rytmkolumnerna som regeln läser dem. */
export const tillBedomningsrytm = (r: Pick<Avtalsrytm,
  'bedomning_intervall_dagar' | 'bedomning_veckodag' | 'bedomning_ankare'>): Bedomningsrytm => ({
  intervall_dagar: r.bedomning_intervall_dagar,
  veckodag: r.bedomning_veckodag,
  ankare: r.bedomning_ankare,
});

/**
 * Avtalets bedömningsrytm. `idag` är `YYYY-MM-DD` ur anroparens klocka, så att
 * perioden räknas på samma dag som resten av anroparens svar.
 */
export async function lasBedomningsrytm(
  client: PoolClient, companyId: string, contractId: string, idag: string,
): Promise<Avtalsrytm> {
  const rad = (await client.query<Omit<Avtalsrytm, keyof Rytmutfall>>(
    `SELECT rytm_text, bedomning_intervall_dagar, bedomning_veckodag, rapport_mottagarkrets,
            bedomning_ankare::text, bedomning_ankare_kalla
       FROM contracts WHERE id = $1 AND company_id = $2`,
    [contractId, companyId],
  )).rows[0];
  if (!rad) throw new NotFoundError('contract');
  return { ...rad, ...bedomningsrytmlage(tillBedomningsrytm(rad), idag) };
}

/** Förbrukningen mot ram som läsvärde — det enda utfall ett mått kan ha i dag. */
export type Forbrukningsvarde = Lasvarde<{ minuter: number; tak_minuter: number | null }>;

/** Ett mått som Läget visar det: kontraktets ord, ordningen och utfallet. */
export interface Mattrad extends Uppfoljningsmatt {
  ordning: number;
  /** NULL = utfallet härleds inte (”utfall HÄRLEDS EJ”). */
  varde: Forbrukningsvarde | null;
}

/** Avtalets mått i kontraktets ordning, som de lagrades vid Davids ja. */
export async function lasUppfoljningsmatt(
  client: PoolClient, companyId: string, contractId: string,
): Promise<Array<Uppfoljningsmatt & { ordning: number }>> {
  return (await client.query<Uppfoljningsmatt & { ordning: number }>(
    `SELECT namn, hur_ofta, kallreferenser, lasvag, larmregel, larmregel_lage, utfall_lage, ordning
       FROM uppdrag_matt WHERE company_id = $1 AND contract_id = $2
      ORDER BY ordning, id`,
    [companyId, contractId],
  )).rows;
}

/**
 * Måttets utfall. REN. Bara en läsare finns (`mattlasare`): tid mot ram, som är
 * avtalets förbrukning, och då förs källans läsvärde vidare OFÖRÄNDRAT — samma
 * läge, källa och lästid. Ett oläst värde blir aldrig ett tomt eller ett
 * inmatat. `harleds_ej` ger NULL, och en härledd rad utan läsare har inget
 * värde i underlaget (`saknas`).
 */
export function mattvarde(
  matt: Pick<Uppfoljningsmatt, 'namn' | 'lasvag' | 'utfall_lage'>, forbrukning: Forbrukningsvarde,
): Forbrukningsvarde | null {
  if (matt.utfall_lage === 'harleds_ej') return null;
  if (mattlasare(matt.namn, matt.lasvag) === 'tid_mot_ram') return forbrukning;
  return saknas(KALLA_REDOVISNING, forbrukning.last_nar);
}

// ---------------------------------------------------------------------------
// satt_bedomningsankare
// ---------------------------------------------------------------------------

export interface SattBedomningsankareInput {
  contract_id: string;
  ankare: string;
  kalla: Ankarkalla;
}

/** Kolumnerna åtgärden får skriva. Aldrig ett kolumnnamn ur indata. */
const ANKARE_UPDATE: Readonly<Record<string, string>> = {
  bedomning_ankare: 'bedomning_ankare',
  bedomning_ankare_kalla: 'bedomning_ankare_kalla',
};

/** Svaret när ankaret redan står. Vyn visar texten i sin notis. */
export const ANKARE_REDAN_SATT = 'Ankardatumet är redan satt. Det ändras bara genom en baselineändring med orsak.';

const VECKODAGAR = ['måndag', 'tisdag', 'onsdag', 'torsdag', 'fredag', 'lördag', 'söndag'];

/**
 * Davids ankare för avtalets bedömningsrytm, med obligatorisk källa (FR-14).
 * Körs i åtgärdens transaktion; inget fel fångas här (lärdom 2).
 */
export async function sattBedomningsankare(
  client: PoolClient, companyId: string, userId: string, input: SattBedomningsankareInput,
): Promise<Record<string, unknown>> {
  // Radlåset först: två samtidiga ankare för samma avtal köas, och det andra
  // ser det första.
  const avtal = (await client.query<{
    bedomning_intervall_dagar: number | null; bedomning_veckodag: number | null; bedomning_ankare: string | null;
  }>(
    `SELECT bedomning_intervall_dagar, bedomning_veckodag, bedomning_ankare::text
       FROM contracts WHERE id = $1 AND company_id = $2 FOR UPDATE`,
    [input.contract_id, companyId],
  )).rows[0];
  if (!avtal) throw new NotFoundError('contract');
  if (avtal.bedomning_intervall_dagar === null) {
    throw new ConflictError('rytm_saknas',
      'Avtalet har ingen rytm ur kontraktets del 4, så det finns inga bedömningstillfällen att räkna från.');
  }
  if (avtal.bedomning_ankare !== null) throw new ConflictError('ankare_redan_satt', ANKARE_REDAN_SATT);
  const veckodag = avtal.bedomning_veckodag;
  if (veckodag !== null && isoVeckodag(input.ankare) !== veckodag) {
    throw new BadRequestError('fel_veckodag',
      `Ankardatumet ${input.ankare} är en ${VECKODAGAR[isoVeckodag(input.ankare) - 1]!}, `
      + `men avtalets rytm går på ${VECKODAGAR[veckodag - 1] ?? 'en annan dag'}.`);
  }
  if (input.kalla.typ === 'kalender') {
    const referens = (await client.query<{ sort: string; handelse_datum: string | null }>(
      `SELECT sort, handelse_datum::text FROM uppdrag_referens
        WHERE id = $1 AND company_id = $2 AND contract_id = $3`,
      [input.kalla.referens_id, companyId, input.contract_id],
    )).rows[0];
    if (!referens || referens.sort !== 'kalender') {
      throw new BadRequestError('okand_kalenderreferens', 'Kalenderreferensen finns inte bland avtalets kalenderposter.');
    }
    if (referens.handelse_datum !== null && referens.handelse_datum !== input.ankare) {
      throw new BadRequestError('kalla_annat_datum',
        `Kalenderposten är daterad ${referens.handelse_datum}, inte ${input.ankare}.`);
    }
  }

  const kalla = ankarkallatext(input.kalla);
  const update = buildAllowlistedUpdate(ANKARE_UPDATE, { bedomning_ankare: input.ankare, bedomning_ankare_kalla: kalla })!;
  const n = update.values.length;
  // Villkoret är den andra spärren efter radlåset: ett ankare som någon hann
  // sätta skrivs aldrig över.
  const res = await client.query(
    `UPDATE contracts SET ${update.setSql}
      WHERE id = $${n + 1} AND company_id = $${n + 2} AND bedomning_ankare IS NULL`,
    [...update.values, input.contract_id, companyId],
  );
  if ((res.rowCount ?? 0) === 0) throw new ConflictError('ankare_redan_satt', ANKARE_REDAN_SATT);

  // Ingen fritext i auditraden (lärdom 10): källans typ, aldrig dess text.
  await writeAudit(client, {
    companyId, userId, action: 'uppdrag.bedomningsankare_satt',
    entityType: 'contract', entityId: input.contract_id,
    details: { contract_id: input.contract_id, ankare: input.ankare, kalla_typ: input.kalla.typ },
  });

  const idag = new Date().toISOString().slice(0, 10);
  return {
    contract_id: input.contract_id,
    bedomning_ankare: input.ankare,
    bedomning_ankare_kalla: kalla,
    nasta: bedomningsrytmlage({
      intervall_dagar: avtal.bedomning_intervall_dagar, veckodag, ankare: input.ankare,
    }, idag).nasta,
  };
}

/** En av avtalets kalenderposter, som ankarformuläret erbjuder den. */
export interface Kalenderreferens {
  id: string;
  titel_vid_lankning: string | null;
  handelse_datum: string | null;
}

/**
 * Avtalets kalenderreferenser som går att peka på: inte trasiga och inte
 * utanför spärren. Bara pekare — innehållet ligger kvar i kalendern (FR-26).
 */
export async function kalenderreferenser(
  client: PoolClient, companyId: string, contractId: string,
): Promise<Kalenderreferens[]> {
  return (await client.query<Kalenderreferens>(
    `SELECT id, titel_vid_lankning, handelse_datum::text FROM uppdrag_referens
      WHERE company_id = $1 AND contract_id = $2 AND sort = 'kalender'
        AND status NOT IN ('trasig', 'utanfor_sparr')
      ORDER BY handelse_datum NULLS LAST, id`,
    [companyId, contractId],
  )).rows;
}
