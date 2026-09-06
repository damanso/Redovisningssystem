// Uppdragsytan S4.1, våg 2 (PRD FR-14/FR-15/FR-17): bedömningen sätts.
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
//   * **`handelse_ref_ids` och `frysta_siffror` lämnas NULL.** De hör till
//     svepets stories (FR-16/FR-26/FR-32). En kolumn som fylls med en gissning
//     är sämre än en tom kolumn: den ser ut som ett underlag.
import type { PoolClient } from 'pg';
import { NotFoundError } from '../lib/errors.js';

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
  created_at: string;
}

const KOLUMNER = `id, contract_id, period_start::text, period_slut::text, lage,
                  satt_av_manniska, kommentar, created_at::text`;

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

/**
 * Sätter bedömningen för en period. Ingen userId-parameter: raden bär ingen
 * användarkolumn (0068), och auditraden `action.executed` skrivs av
 * `executeAction` i SAMMA transaktion som den här insertningen.
 */
export async function sattBedomning(
  client: PoolClient, companyId: string, input: SattBedomningInput,
): Promise<Bedomningsrad & { contract_name: string }> {
  const contractName = await avtalsnamn(client, companyId, input.contract_id);
  const res = await client.query<Bedomningsrad>(
    `INSERT INTO uppdrag_bedomning
       (company_id, contract_id, period_start, period_slut, lage, satt_av_manniska, kommentar)
     VALUES ($1, $2, $3, $4, $5, true, $6)
     RETURNING ${KOLUMNER}`,
    [companyId, input.contract_id, input.period_start, input.period_slut, input.lage,
      input.kommentar ?? null],
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
