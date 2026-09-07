// Uppdragsytan S4.1 (våg 2) + S4.2 (våg 6), PRD FR-14/FR-15/FR-16/FR-17/FR-20:
// bedömningen sätts — och bär underlaget den vilade på.
//
// Bedömningen är uppdragets enda subjektiva tal: står det på spår, är det en
// risk, eller har det glidit? Tre meningar bär filen, och alla tre är
// rättigheter i Postgres snarare än konventioner här:
//
//   * **EN INSERT, och ingenting annat.** `uppdrag_bedomning` har SELECT +
//     INSERT för rollen `app` (0068) — det finns ingen UPDATE att skriva och
//     ingen DELETE. En bedömning som går att skriva om i efterhand är ingen
//     bedömning (FR-17). Rättar man sig sätter man en NY bedömning; den gamla
//     står kvar och visar vad man trodde då.
//   * **`satt_av_manniska` hårdkodas till `true`, det tas ALDRIG som indata.**
//     Kolumnen är svaret på frågan "satte en människa den?", och åtgärden
//     `satt_bedomning` bär `kravManniska` — svaret är alltså per konstruktion
//     ja (FR-15). Ett indatafält hade återinfört exakt den lögnmöjlighet
//     kolumnen finns för att utesluta: en agent som skriver `true` om sig själv.
//   * **`handelse_ref_ids` och `frysta_siffror` fylls av SERVERN, aldrig av
//     indatat (S4.2, FR-16/FR-20/FR-26/FR-32).** Underlaget räknas om i samma
//     transaktion som INSERT:en och fryses där. Fälten står inte i
//     `satt_bedomning`:s schema — `.strict()` fäller dem — för samma skäl som
//     `satt_av_manniska`: ett underlag som anroparen får skriva själv är inget
//     underlag. NULL i kolumnerna betyder därmed entydigt "satt före S4.2".
import type { PoolClient } from 'pg';
import { NotFoundError } from '../lib/errors.js';
import { getContractUsage, type Delforbrukning } from './contracts.js';
import { arGodkannande, arFakturerad, arIgnorerad, listTimeEntries, type TimeEntryStatus } from './projects.js';
import { listaReferenser, type Referensrad } from './uppdragReferens.js';

/** Exakt CHECK-villkorets tre värden i 0068 — ordnade som skalan läses. */
export const BEDOMNINGSLAGEN = ['pa_spar', 'risk', 'ur_spar'] as const;
export type Bedomningslage = (typeof BEDOMNINGSLAGEN)[number];

export interface SattBedomningInput {
  contract_id: string;
  period_start: string;
  period_slut: string;
  lage: Bedomningslage;
  kommentar?: string;
}

export interface Bedomningsrad {
  id: string;
  contract_id: string;
  period_start: string;
  period_slut: string;
  lage: Bedomningslage;
  satt_av_manniska: boolean;
  kommentar: string | null;
  /** Talen som gällde när raden skrevs. NULL = bedömning satt före S4.2. */
  frysta_siffror: FrystaSiffror | null;
  /** Pekare mot `uppdrag_referens` — aldrig kopior (FR-26). */
  handelse_ref_ids: string[] | null;
  created_at: string;
}

const KOLUMNER = `id, contract_id, period_start::text, period_slut::text, lage,
                  satt_av_manniska, kommentar, frysta_siffror, handelse_ref_ids,
                  created_at::text`;

/**
 * Avtalet måste finnas i BOLAGET. Den sammansatta främmande nyckeln
 * (contract_id, company_id) i 0068 fäller ett främmande avtal ändå, men som ett
 * databasfel — och ett grannbolags avtal ska svara "finns inte", inte "något
 * gick fel". Samma uppslag som `uppdragImport.hamtaAvtal`.
 */
async function avtalsnamn(client: PoolClient, companyId: string, contractId: string): Promise<string> {
  const res = await client.query<{ name: string }>(
    'SELECT name FROM contracts WHERE id = $1 AND company_id = $2',
    [contractId, companyId],
  );
  const rad = res.rows[0];
  if (!rad) throw new NotFoundError('contract');
  return rad.name;
}

// ---------------------------------------------------------------------------
// Underlaget (S4.2, FR-16/FR-20/FR-25/FR-26/FR-32)
//
// Rapporten är BYGGD ur husets befintliga läsvägar, aldrig ur en egen
// summering: förbrukningen mot tak kommer ur `getContractUsage` (alltså ur den
// ENDA takberäkningen, samma som varningen och faktureringsspärren läser),
// timmarna ur `listTimeEntries` och händelserna ur `listaReferenser`. Ett andra
// svar på "hur mycket är förbrukat?" är ett fel, inte en nyans (FR-25).
// ---------------------------------------------------------------------------

/** Perioden i tid. Ignorerade poster räknas aldrig med (PRD F7). */
export interface Periodtimmar {
  poster: number;
  /** Vad som hände: registrerade minuter. */
  minuter: number;
  /** Vad kunden betalar: debiterbara minuter på godkänd/justerad/fakturerad tid. */
  fakturerbara_minuter: number;
}

/** En avtalsdel mot sitt tak — husets egna tal, hämtade och inte omräknade. */
export interface Delsiffra {
  code: string;
  name: string;
  minuter: number;
  belopp_ore: number;
  tak_timmar: number | null;
  tak_ore: number | null;
  tak_status: 'bekraftat' | 'vet_ej';
  andel: number | null;
}

/** Ett statusbyte på en leverabel inom perioden (S3.2:s händelserad). */
export interface Leverabelrorelse {
  kod: string;
  fran: string | null;
  till: string;
  nar: string;
}

/**
 * Det som fryses i `frysta_siffror`. Bara TAL och koder: händelserna står som
 * id:n i `handelse_ref_ids` och scopelinjen bärs levande i vyn — en kopia av
 * ett mejl eller en avtalsfras här hade gjort bedömningen till en fjärde
 * datamängd (FR-26, NFR-12).
 */
export interface FrystaSiffror {
  period_start: string;
  period_slut: string;
  timmar: Periodtimmar;
  delar: Delsiffra[];
  leverabelrorelser: Leverabelrorelse[];
  /** Antalet händelser; id:n står i `handelse_ref_ids`. */
  handelser: number;
}

export interface Rapportunderlag {
  frysta: FrystaSiffror;
  handelse_ref_ids: string[];
  /** Referensraderna bakom id:na — för vyn, aldrig för frysningen. */
  handelser: Referensrad[];
}

/** Avtalets egna ord om vad som ingår (0068). Läses levande, fryses aldrig. */
export interface Scopelinje {
  sort: 'innanfor' | 'utanfor' | 'fras';
  text: string;
  klausul: string | null;
  ordning: number;
}

/**
 * Periodens händelser. `uppdrag_referens` bär inget eget händelsedatum utöver
 * `created_at` (0068), så perioden mäts på när referensen länkades — och bara
 * kalender och mejl räknas: `drive`-pekarna pekar på avtalshandlingen, inte på
 * något som hände i perioden.
 */
function handelserIPerioden(rader: Referensrad[], start: string, slut: string): Referensrad[] {
  return rader.filter((r) => (r.sort === 'kalender' || r.sort === 'mejl')
    && r.created_at.slice(0, 10) >= start && r.created_at.slice(0, 10) <= slut);
}

/**
 * Rapportunderlaget för (avtal, period) — samma funktion bygger vyns förifyllda
 * rapport och de tal som fryses vid INSERT:en. Två byggare hade betytt att
 * sidan visade ett tal och raden bar ett annat.
 */
export async function byggRapportunderlag(
  client: PoolClient, companyId: string, contractId: string, periodStart: string, periodSlut: string,
): Promise<Rapportunderlag> {
  const avtal = await getContractUsage(client, companyId, contractId) as unknown as {
    project_id: string; parts: Delforbrukning[];
  };

  // Timmarna: husets egen läsväg med from/to + projekt. Ingen SUM() här — det
  // hade blivit en andra tolkning av vilka poster som räknas.
  const poster = await listTimeEntries(client, companyId, {
    project_id: avtal.project_id, from: periodStart, to: periodSlut,
  }) as unknown as { minutes: number; billable_minutes: number; status: TimeEntryStatus }[];
  const timmar: Periodtimmar = { poster: 0, minuter: 0, fakturerbara_minuter: 0 };
  for (const p of poster) {
    if (arIgnorerad(p.status)) continue;
    timmar.poster += 1;
    timmar.minuter += p.minutes;
    if (arGodkannande(p.status) || arFakturerad(p.status)) timmar.fakturerbara_minuter += p.billable_minutes;
  }

  const rorelser = await client.query<Leverabelrorelse>(
    `SELECT l.kod, h.fran, h.till, h.created_at::text AS nar
       FROM uppdrag_leverabel_handelse h
       JOIN uppdrag_leverabel l ON l.id = h.leverabel_id AND l.company_id = h.company_id
      WHERE h.company_id = $1 AND h.contract_id = $2
        AND h.created_at >= $3::date AND h.created_at < ($4::date + 1)
      ORDER BY h.created_at, l.kod`,
    [companyId, contractId, periodStart, periodSlut],
  );

  const handelser = handelserIPerioden(
    await listaReferenser(client, companyId, contractId), periodStart, periodSlut,
  );

  return {
    frysta: {
      period_start: periodStart,
      period_slut: periodSlut,
      timmar,
      delar: avtal.parts.map((d): Delsiffra => ({
        code: d.code,
        name: d.name,
        minuter: d.billable_minutes,
        belopp_ore: d.amount_ore,
        tak_timmar: d.cap_hours,
        tak_ore: d.cap_amount_ore,
        tak_status: d.cap_status,
        andel: d.share,
      })),
      leverabelrorelser: rorelser.rows,
      handelser: handelser.length,
    },
    handelse_ref_ids: handelser.map((h) => h.id),
    handelser,
  };
}

/**
 * Scopelinjen för avtalet. Läses levande i vyn och fryses ALDRIG: acceptansen
 * säger att rapporten bär den, och avtalets ord står redan i sin egen tabell.
 */
export async function lasScopelinjer(
  client: PoolClient, companyId: string, contractId: string,
): Promise<Scopelinje[]> {
  const res = await client.query<Scopelinje>(
    `SELECT sort, text, klausul, ordning FROM uppdrag_scopelinje
      WHERE company_id = $1 AND contract_id = $2
      ORDER BY ordning, text`,
    [companyId, contractId],
  );
  return res.rows;
}

/**
 * Sätter bedömningen för en period. Ingen userId-parameter: raden bär ingen
 * användarkolumn (0068), och auditraden `action.executed` skrivs av
 * `executeAction` i SAMMA transaktion som den här insertningen.
 *
 * Underlaget räknas om HÄR, i samma transaktion, och fryses med raden. En
 * period helt utan tid och händelser fryser nollor och en TOM händelselista
 * (`{}`, inte NULL) — lägesvalet förblir det enda obligatoriska, och ett
 * giltigt svar spärras aldrig.
 */
export async function sattBedomning(
  client: PoolClient, companyId: string, input: SattBedomningInput,
): Promise<Bedomningsrad & { contract_name: string }> {
  const contractName = await avtalsnamn(client, companyId, input.contract_id);
  const underlag = await byggRapportunderlag(
    client, companyId, input.contract_id, input.period_start, input.period_slut,
  );
  const res = await client.query<Bedomningsrad>(
    `INSERT INTO uppdrag_bedomning
       (company_id, contract_id, period_start, period_slut, lage, satt_av_manniska, kommentar,
        frysta_siffror, handelse_ref_ids)
     VALUES ($1, $2, $3, $4, $5, true, $6, $7::jsonb, $8::uuid[])
     RETURNING ${KOLUMNER}`,
    [companyId, input.contract_id, input.period_start, input.period_slut, input.lage,
      input.kommentar ?? null, JSON.stringify(underlag.frysta), underlag.handelse_ref_ids],
  );
  return { ...res.rows[0]!, contract_name: contractName };
}

/**
 * Avtalets bedömningar i kronologisk ordning — äldst först, så att listan läses
 * som en historik och inte som en tabell. `created_at` bryter lika perioder:
 * två bedömningar av samma period är tillåtna (FR-17 säger att den första inte
 * får ändras, inte att den andra inte får finnas), och då är ordningen mellan
 * dem hela poängen.
 */
export async function listaBedomningar(
  client: PoolClient, companyId: string, contractId: string,
): Promise<Bedomningsrad[]> {
  const res = await client.query<Bedomningsrad>(
    `SELECT ${KOLUMNER}
       FROM uppdrag_bedomning
      WHERE company_id = $1 AND contract_id = $2
      ORDER BY period_start, created_at`,
    [companyId, contractId],
  );
  return res.rows;
}
