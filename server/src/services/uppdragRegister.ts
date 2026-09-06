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
//   * **`dagar_i_laget` HÄRLEDS, den lagras aldrig** (FR-37). Åldern räknas i
//     SELECT:en ur den append-only historiken (`uppdrag_leverabel_handelse`,
//     0068:132 — "status utan historik är en gissning"). En `status_sedan`-kolumn
//     hade varit ett andra ställe där samma sanning står, och den dag en skrivväg
//     glömmer den driftar kolumnen ifrån historiken utan att någon ser det.
//     Härledningen kan per definition inte drifta.
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
  /**
   * Hela dagar (avrundat nedåt) sedan leverabelns SENASTE händelse — alltså hur
   * länge den stått still i sitt nuvarande läge (FR-37). Aldrig NULL: en
   * leverabel som importen skapat och som aldrig statusbytts har ingen händelse,
   * och räknas då från sin egen `created_at` (0068:122). Ett hårdkodat 0 där
   * hade sett ut som "nyss bytt", vilket är motsatsen till sanningen.
   */
  dagar_i_laget: number;
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
 *
 * Åldersundersökningen filtrerar på BÅDA leden (`h.leverabel_id = l.id AND
 * h.company_id = l.company_id`) — husets sammansatta `company_id`-filter i varje
 * join, samma nyckel som den främmande nyckeln i 0068 bär. RLS räcker, men en
 * subquery som bara matchar på id vore ett ställe där den dagen någon stänger av
 * RLS blir en tyst tenantläcka i stället för ett fel.
 */
export async function lasLeverabelregister(
  client: PoolClient, companyId: string, input: LasLeverabelregisterInput,
): Promise<Leverabelrad[]> {
  await kravAvtal(client, companyId, input.contract_id);
  const res = await client.query<Leverabelrad>(
    `SELECT l.contract_id, l.kod, l.klausul, l.acceptanskriterium, l.uppfoljningsmatt,
            l.matt_lasvag, l.status,
            GREATEST(0, floor(EXTRACT(EPOCH FROM (now() - COALESCE(
              (SELECT max(h.created_at) FROM uppdrag_leverabel_handelse h
                WHERE h.leverabel_id = l.id AND h.company_id = l.company_id),
              l.created_at))) / 86400)::int) AS dagar_i_laget
       FROM uppdrag_leverabel l
      WHERE l.company_id = $1 AND l.contract_id = $2
      ORDER BY l.kod`,
    [companyId, input.contract_id],
  );
  return res.rows;
}
