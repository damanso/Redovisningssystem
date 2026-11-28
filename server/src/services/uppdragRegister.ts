// Uppdragsytan S3.1, våg 3 (PRD FR-9/FR-19): leverabelregistret LÄSES.
//
// S1.2:s import fyller `uppdrag_leverabel` ur den frysta kontraktstexten (steg e
// i `uppdragImport.ts`), men ingen väg fanns tillbaka ut: raderna med klausul,
// acceptanskriterium, uppföljningsmått och läsväg låg i en tabell som varken
// MCP, API:t eller vyn kunde nå. Den här filen är läsvägen — en SELECT, inget
// annat.
//
// Namnet läses ur avtalsdelens första version: senare beslut ändrar inte vad kontraktet angav.
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
//   * Transmittalfälten läses ur senaste överlämningen (händelsen med revision),
//     förs aldrig in i den frysta kopian, och datumet läses ur handlingens referens,
//     aldrig ur bekräftelsens tid.
import type { PoolClient } from 'pg';
import { createHash } from 'node:crypto';
import { NotFoundError } from '../lib/errors.js';
import { KALLA_REDOVISNING, last, type Lasvarde } from '../lib/lasvarde.js';
import { registertomhet, type Registertomhet } from '../lib/registertomhet.js';

/** Bara registrets innehåll fryses; den härledda åldern hör till lästillfället. */
export type Registerkopierad = Pick<Leverabelrad,
  'kod' | 'namn' | 'status' | 'klausul' | 'acceptanskriterium' | 'uppfoljningsmatt' | 'matt_lasvag'>;

export const REGISTERKOPIA_TEXT = {
  rubrik: 'Leverabelregister — {projekt}',
  derivat: 'Derivat ur redovisningens leverabelregister (Uppdragsytan FR-11). Redigeras aldrig för hand.',
  version: 'Registerversion {n}, fryst {tid}.',
  kolumner: ['Kod', 'Status', 'Klausul', 'Acceptanskriterium', 'Uppföljningsmått', 'Läsväg'],
} as const;

/** Renderar utan klocka eller databas, så återförsök kan använda samma text. */
export function renderaRegisterkopia(input: {
  projektnamn: string; registerversion: number; fryst: string; rader: readonly Registerkopierad[];
}): string {
  const cell = (v: string | null) => (v ?? '').replace(/\|/g, '\\|').replace(/\r\n|\r|\n/g, ' ');
  return [
    `# ${REGISTERKOPIA_TEXT.rubrik.replace('{projekt}', input.projektnamn)}`,
    '',
    `> ${REGISTERKOPIA_TEXT.derivat}`,
    `> ${REGISTERKOPIA_TEXT.version.replace('{n}', String(input.registerversion)).replace('{tid}', input.fryst)}`,
    '',
    `| ${REGISTERKOPIA_TEXT.kolumner.join(' | ')} |`,
    '|---|---|---|---|---|---|',
    ...input.rader.map((r) => `| ${[r.kod, r.status, r.klausul, r.acceptanskriterium,
      r.uppfoljningsmatt, r.matt_lasvag].map(cell).join(' | ')} |`),
    '',
  ].join('\n');
}

/** Hashen binder versionen till exakt den frysta UTF-8-texten. */
export function registerkopiansHash(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export interface LasLeverabelregisterInput {
  contract_id: string;
}

export interface Leverabelrad {
  contract_id: string;
  kod: string;
  namn: string | null;
  klausul: string | null;
  acceptanskriterium: string | null;
  uppfoljningsmatt: string | null;
  matt_lasvag: string | null;
  status: string;
  /** Revisionen i senaste överlämningen; första är 1, NULL före överlämning. */
  revision: number | null;
  /** Samma överlämnings mottagare, ordagrant; NULL om saknad, aldrig avtalets godkännare. */
  mottagare: string | null;
  /** ISO-datum ur överlämningshandlingens händelsedatum (Story 4.2); NULL när handlingen saknar datum eller överlämningen saknar handling; aldrig bekräftelsens tid (FR-13). */
  overlamnad: string | null;
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
 * Story 6.1, FR-35: en registerrad som själv är ett `Lasvarde<Leverabelrad>`.
 * Svaret är en lista som Hermes läser som platta objekt, så raden behåller
 * sina tolv fält och bär dessutom `varde`, `kalla`, `last_nar` och `lage`.
 */
export interface Registerrad extends Leverabelrad, Lasvarde<Leverabelrad> {}

/** Radens källa och lästid; `varde` bär exakt de tolv platta fälten. REN funktion. */
export function registerrad(rad: Leverabelrad, lastNar: string): Registerrad {
  return { ...rad, ...last(rad, KALLA_REDOVISNING, lastNar) };
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
 *
 * Story 6.1: lästiden tas en gång per anrop, så alla rader i ett svar bär
 * samma källa och lästid.
 */
export async function lasLeverabelregister(
  client: PoolClient, companyId: string, input: LasLeverabelregisterInput,
): Promise<Registerrad[]> {
  await kravAvtal(client, companyId, input.contract_id);
  const lastNar = new Date().toISOString();
  const res = await client.query<Leverabelrad>(
    `SELECT l.contract_id, l.kod,
            NULLIF((SELECT p.name FROM contract_parts p
              WHERE p.company_id = l.company_id AND p.contract_id = l.contract_id AND p.code = l.kod
              ORDER BY p.valid_from LIMIT 1), l.kod) AS namn,
            l.klausul, l.acceptanskriterium, l.uppfoljningsmatt,
            l.matt_lasvag, l.status, o.revision, o.mottagare, o.overlamnad,
            GREATEST(0, floor(EXTRACT(EPOCH FROM (now() - COALESCE(
              (SELECT max(h.created_at) FROM uppdrag_leverabel_handelse h
                WHERE h.leverabel_id = l.id AND h.company_id = l.company_id),
              l.created_at))) / 86400)::int) AS dagar_i_laget
       FROM uppdrag_leverabel l
       LEFT JOIN LATERAL (
         SELECT h.revision, h.mottagare,
                (SELECT r.handelse_datum::text FROM uppdrag_referens r
                  WHERE r.id = h.referens_id AND r.company_id = h.company_id) AS overlamnad
           FROM uppdrag_leverabel_handelse h
          WHERE h.leverabel_id = l.id AND h.company_id = l.company_id
            AND h.revision IS NOT NULL
          ORDER BY h.revision DESC, h.created_at DESC, h.id DESC LIMIT 1
       ) o ON true
      WHERE l.company_id = $1 AND l.contract_id = $2
      ORDER BY l.kod`,
    [companyId, input.contract_id],
  );
  return res.rows.map((rad) => registerrad(rad, lastNar));
}

/**
 * Story 6.3 (FR-22): varför varje avtals register är tomt, eller null när det
 * har rader — en fråga för alla avtal, och orsaken ur den rena regeln.
 *
 * Underlaget är kontraktets tillstånd, registrets rader och baselineförslagen
 * (`satt_baseline`) för avtalet. Avtals-id jämförs med `lower(...)` som i
 * importens uppslag, eftersom indatats uuid inte normaliseras till gemener.
 * Varje underfråga filtrerar på `company_id`; ett avtal i ett annat bolag ger
 * ingen rad och alltså ingen nyckel. `lasLeverabelregister` och dess svar
 * ändras inte: Läget och Leveranserna läser orsaken härifrån.
 */
export async function lasRegistertomhet(
  client: PoolClient, companyId: string, contractIds: readonly string[],
): Promise<Map<string, Registertomhet | null>> {
  const karta = new Map<string, Registertomhet | null>();
  if (contractIds.length === 0) return karta;
  const res = await client.query<{
    id: string; kontrakt_tillstand: 'utkast' | 'fryst'; har_rader: boolean;
    vantande_forslag: boolean; senaste_forslag: string | null;
  }>(
    `SELECT c.id::text AS id, c.kontrakt_tillstand,
            EXISTS (SELECT 1 FROM uppdrag_leverabel l
                     WHERE l.company_id = c.company_id AND l.contract_id = c.id) AS har_rader,
            EXISTS (SELECT 1 FROM action_approvals q
                     WHERE q.company_id = c.company_id AND q.action = 'satt_baseline' AND q.status = 'pending'
                       AND lower(q.input->>'contract_id') = c.id::text) AS vantande_forslag,
            (SELECT q.status FROM action_approvals q
              WHERE q.company_id = c.company_id AND q.action = 'satt_baseline'
                AND lower(q.input->>'contract_id') = c.id::text
              ORDER BY q.created_at DESC, q.id DESC LIMIT 1) AS senaste_forslag
       FROM contracts c
      WHERE c.company_id = $1 AND c.id = ANY($2::uuid[])`,
    [companyId, contractIds],
  );
  for (const rad of res.rows) {
    karta.set(rad.id, registertomhet({
      kontrakt_tillstand: rad.kontrakt_tillstand, har_rader: rad.har_rader,
      vantande_forslag: rad.vantande_forslag, senaste_forslag: rad.senaste_forslag,
    }));
  }
  return karta;
}
