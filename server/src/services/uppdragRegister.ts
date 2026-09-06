// Uppdragsytan S3.1, våg 3 (PRD FR-9/FR-19): leverabelregistret LÄSES.
//
// S1.2:s import fyller `uppdrag_leverabel` ur den frysta kontraktstexten (steg e
// i `uppdragImport.ts`), men ingen väg fanns tillbaka ut: raderna med klausul,
// acceptanskriterium, uppföljningsmått och läsväg låg i en tabell som varken
// MCP, API:t eller vyn kunde nå. Den här filen är läsvägen — en SELECT, inget
// annat.
//
// Två meningar bär filen:
//
//   * **Radidentiteten är `(contract_id, kod)`** — samma nyckel som
//     `uppdrag_leverabel_kod_uk` bär idempotensen på, och samma kod som står i
//     kontraktstexten. Aldrig `contract_part_id`: avtalsdelen versioneras (en ny
//     baselineversion ger en NY rad i `contract_parts`), men leverabeln L6 är
//     samma leverabel före och efter ett tilläggsavtal.
//   * **`matt_lasvag` får vara NULL i schemat** (CHECK-villkoret i 0068 tillåter
//     det, för de rader vars kontraktstext inte angav någon läsväg). Täckningen
//     bärs därför inte av kolumnen utan av FR-19-provet, som läser just den här
//     funktionens svar. Tjänsten döljer alltså aldrig en lucka och fyller den
//     aldrig med en gissning — den redovisar den som NULL.
import type { PoolClient } from 'pg';
import { NotFoundError } from '../lib/errors.js';

export interface LasLeverabelregisterInput {
  contract_id: string;
}

export interface Leverabelrad {
  contract_id: string;
  kod: string;
  klausul: string | null;
  acceptanskriterium: string | null;
  uppfoljningsmatt: string | null;
  matt_lasvag: string | null;
  status: string;
}

/**
 * Avtalet måste finnas i BOLAGET. RLS och den sammansatta främmande nyckeln gör
 * att ett grannbolags avtal ändå aldrig kan ge rader — men en tom lista vore ett
 * svar som ser ut som "registret är tomt". Ett avtal man inte har tillgång till
 * ska svara "finns inte". Samma uppslag som `uppdragImport.hamtaAvtal`.
 */
async function kravAvtal(client: PoolClient, companyId: string, contractId: string): Promise<void> {
  const res = await client.query(
    'SELECT 1 FROM contracts WHERE id = $1 AND company_id = $2',
    [contractId, companyId],
  );
  if (res.rowCount === 0) throw new NotFoundError('contract');
}

/**
 * Avtalets leverabelregister, sorterat på kod. Ett befintligt avtal utan
 * registerrader ger en TOM lista — det är ett giltigt svar (avtalet kan vara
 * skapat men inte importerat ännu), inte ett fel.
 */
export async function lasLeverabelregister(
  client: PoolClient, companyId: string, input: LasLeverabelregisterInput,
): Promise<Leverabelrad[]> {
  await kravAvtal(client, companyId, input.contract_id);
  const res = await client.query<Leverabelrad>(
    `SELECT contract_id, kod, klausul, acceptanskriterium, uppfoljningsmatt, matt_lasvag, status
       FROM uppdrag_leverabel
      WHERE company_id = $1 AND contract_id = $2
      ORDER BY kod`,
    [companyId, input.contract_id],
  );
  return res.rows;
}
