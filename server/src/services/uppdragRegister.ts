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
//   * **`namn` läses ur avtalsdelen, och NULL betyder att kontraktet inte angav
//     något** (Story 2.4, beslut B6). Namnet står i den version av avtalsdelen
//     med samma kod som GÄLLER, med samma regel som `Delforbrukning.part_id`
//     (`gallandeIdag` i contracts.ts) — så att registret, Leveranserna och
//     kontraktsytans "Det som gäller nu" aldrig säger olika, och så att ett
//     tillägg som namnger en namnlös leverabel stänger luckan. Importen skriver
//     koden som namn bara när texten saknar ett, så ett namn som är lika med
//     koden är ett saknat namn. Ingen kolumn på registret: den hade krävt en
//     efterfyllnad som avslutstriggern fäller på avslutade uppdrag.
import type { PoolClient } from 'pg';
import { NotFoundError } from '../lib/errors.js';
import { gallandeIdag } from './contracts.js';

export interface LasLeverabelregisterInput {
  contract_id: string;
}

export interface Leverabelrad {
  contract_id: string;
  kod: string;
  /** Leverabelns namn ur den gällande avtalsdelen. NULL = namnet saknas i kontraktet (beslut B6). */
  namn: string | null;
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
  const res = await client.query<Omit<Leverabelrad, 'namn'>>(
    `SELECT l.contract_id, l.kod,
            l.klausul, l.acceptanskriterium, l.uppfoljningsmatt,
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
  const versioner = await lasDelversioner(client, companyId, input.contract_id);
  return res.rows.map((r) => ({ ...r, namn: gallandeNamn(r.kod, versioner.get(r.kod)) }));
}

/** En version av en avtalsdel: dagen den gäller från och namnet den bär. */
export interface Delversion {
  valid_from: string;
  name: string;
}

/** Avtalets avtalsdelar per kod, med alla versioner. Datumet som text, aldrig som JS-`Date`. */
export async function lasDelversioner(
  client: PoolClient, companyId: string, contractId: string,
): Promise<Map<string, Delversion[]>> {
  const res = await client.query<Delversion & { code: string }>(
    `SELECT code, valid_from::text AS valid_from, name FROM contract_parts
      WHERE company_id = $1 AND contract_id = $2`,
    [companyId, contractId],
  );
  const perKod = new Map<string, Delversion[]>();
  for (const r of res.rows) perKod.set(r.code, [...(perKod.get(r.code) ?? []), { valid_from: r.valid_from, name: r.name }]);
  return perKod;
}

/**
 * Leverabelns namn ur den version som gäller (beslut B6, granskningens fynd 1).
 * Regeln är husets enda (`gallandeIdag`), inte en egen: registrets namn och
 * kontraktsytans gällande del kan därför aldrig peka på olika versioner. NULL
 * när koden saknar avtalsdel eller när namnet är koden — då angav kontraktet
 * inget namn.
 */
export function gallandeNamn(kod: string, versioner: ReadonlyArray<Delversion> | undefined): string | null {
  if (versioner === undefined || versioner.length === 0) return null;
  const namn = gallandeIdag(versioner).name;
  return namn === kod ? null : namn;
}
