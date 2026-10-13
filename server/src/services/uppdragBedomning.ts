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
//   * **En begäran är obesvarad tills en bedömningsrad bär dess id (Story
//     1.10, FR-40).** `satt_bedomning` besvarar avtalets öppna begäran också
//     utan `begaran_id`, så att samma bedömning aldrig kräver två handlingar.
//     `satt_av` läses ur den inloggade användaren, aldrig ur indata, av samma
//     skäl som `satt_av_manniska`. NULL i `satt_av` betyder "satt före 0082".
import type { PoolClient } from 'pg';
import { ConflictError, NotFoundError } from '../lib/errors.js';
import { getContractUsage, type Delforbrukning } from './contracts.js';
import { arGodkannande, arFakturerad, arIgnorerad, listTimeEntries, type TimeEntryStatus } from './projects.js';
import { listaReferenser, type Referensrad } from './uppdragReferens.js';
import { writeAudit } from './auditService.js';

/** Exakt CHECK-villkorets tre värden i 0068 — ordnade som skalan läses. */
export const BEDOMNINGSLAGEN = ['pa_spar', 'risk', 'ur_spar'] as const;
export type Bedomningslage = (typeof BEDOMNINGSLAGEN)[number];

export interface SattBedomningInput {
  contract_id: string;
  period_start: string;
  period_slut: string;
  lage: Bedomningslage;
  kommentar?: string;
  /** Begäran som bedömningen besvarar (Story 1.10). Utan fältet besvaras avtalets öppna begäran. */
  begaran_id?: string;
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
  /** Människan som satte raden, ur den inloggade användaren. NULL = satt före 0082. */
  satt_av: string | null;
  /** Namnet på `satt_av`, eller NULL när raden saknar det. */
  satt_av_namn: string | null;
  /** Begäran som raden besvarade (Story 1.10). NULL = raden besvarade ingen begäran. */
  begaran_id: string | null;
}

const KOLUMNER = `b.id, b.contract_id, b.period_start::text, b.period_slut::text, b.lage,
                  b.satt_av_manniska, b.kommentar, b.frysta_siffror, b.handelse_ref_ids,
                  b.created_at::text, b.satt_av,
                  COALESCE(NULLIF(btrim(u.name), ''), u.email) AS satt_av_namn, b.begaran_id`;

/**
 * Avtalet måste finnas i BOLAGET, och raden låses. Den sammansatta främmande
 * nyckeln (contract_id, company_id) i 0068 fäller ett främmande avtal ändå, men
 * som ett databasfel — och ett grannbolags avtal ska svara "finns inte", inte
 * "något gick fel". Samma uppslag som `uppdragImport.hamtaAvtal`.
 *
 * Låset (Story 1.10): begäran och bedömningen läser avtalets obesvarade
 * begäranden och skriver sedan. Utan `FOR UPDATE` kunde två samtidiga
 * begäranden båda läsa "ingen öppen" och båda skriva, och två bedömningar båda
 * besvara samma begäran. Låset sitter på avtalet, föräldern, eftersom
 * begäranstabellen är append-only och `FOR UPDATE` kräver UPDATE-rättighet.
 * Samma grepp som projektlåset i `uppdragAvslut.ts`.
 *
 * Id:t i svaret är avtalets id som databasen skriver det, och det är det värde
 * som förs vidare efter låset. Indatats id kan ha versaler, eftersom
 * `UuidSchema` inte gör om dem, och en jämförelse eller auditrad med indatats
 * sträng hade skilt sig från radens.
 */
async function lasAvtalet(
  client: PoolClient, companyId: string, contractId: string,
): Promise<{ id: string; name: string }> {
  const res = await client.query<{ id: string; name: string }>(
    'SELECT id, name FROM contracts WHERE id = $1 AND company_id = $2 FOR UPDATE',
    [contractId, companyId],
  );
  const rad = res.rows[0];
  if (!rad) throw new NotFoundError('contract');
  return rad;
}

// ---------------------------------------------------------------------------
// Den begärda bedömningen (Story 1.10, B-3, FR-40, FR-15, FR-16)
//
// David begär en ny bedömning när han själv ser skäl till det, och frågan står
// i undantagsvyn tills en mänsklig bedömning besvarar den. Ingen regel skapar
// en begäran av sig själv: den enda INSERT:en i tabellen står här, och den nås
// bara genom `begar_ny_bedomning`, som bär `kravManniska`.
// ---------------------------------------------------------------------------

/** En begäran om ny bedömning, med namnet på den som begärde den. */
export interface Begaransrad {
  id: string;
  contract_id: string;
  begard_av: string;
  begard_av_namn: string;
  /** ISO 8601 ur pg:s Date, samma form som undantagspostens skapad_nar. */
  begard_nar: string;
  kommentar: string | null;
}

/** Svaret på en begäran: `befintlig` säger om den skrevs nu eller redan väntade. */
export interface Begaransvar extends Begaransrad {
  befintlig: boolean;
}

export interface BegarNyBedomningInput {
  contract_id: string;
  kommentar?: string;
}

/**
 * Den enda definitionen av "obesvarad": ingen bedömningsrad bär begärans id.
 * Fragmentet förutsätter aliaset `r` för begäran. Svaret står i data, inte i en
 * jämförelse av tidsstämplar, som hade blivit osäker när två transaktioner
 * överlappar (now() är transaktionens start).
 */
export const OBESVARAD = `NOT EXISTS (SELECT 1 FROM uppdrag_bedomning b
     WHERE b.company_id = r.company_id AND b.begaran_id = r.id)`;

/** Begärans kolumner med namnet ur `users`, samma regel som `FALT` i `uppdragAnteckning.ts`. */
const BEGARANSFALT = `r.id, r.contract_id, r.begard_av,
       COALESCE(NULLIF(btrim(u.name), ''), u.email) AS begard_av_namn,
       r.begard_nar, r.kommentar`;

type Begaransdbrad = Omit<Begaransrad, 'begard_nar'> & { begard_nar: Date };

const tillBegaransrad = (r: Begaransdbrad): Begaransrad => ({
  id: r.id,
  contract_id: r.contract_id,
  begard_av: r.begard_av,
  begard_av_namn: r.begard_av_namn,
  // En tidpunkt med zon, inget kalenderdatum: ingen zon tolkas.
  begard_nar: r.begard_nar.toISOString(),
  kommentar: r.kommentar,
});

/**
 * Obesvarade begäranden i bolaget, eller för de angivna avtalen (`null` = hela
 * bolaget). Äldst först, med id sist så att listan inte byter ordning.
 */
export async function listaObesvaradeBegaranden(
  client: PoolClient, companyId: string, contractIds: readonly string[] | null,
): Promise<Begaransrad[]> {
  const res = await client.query<Begaransdbrad>(
    `SELECT ${BEGARANSFALT}
       FROM uppdrag_bedomningsbegaran r
       JOIN users u ON u.id = r.begard_av
      WHERE r.company_id = $1
        AND ${OBESVARAD}
        AND ($2::uuid[] IS NULL OR r.contract_id = ANY($2::uuid[]))
      ORDER BY r.begard_nar, r.id`,
    [companyId, contractIds],
  );
  return res.rows.map(tillBegaransrad);
}

/** En begäran ur sitt id, för svaret efter INSERT:en. */
async function lasBegaran(client: PoolClient, companyId: string, id: string): Promise<Begaransrad> {
  const res = await client.query<Begaransdbrad>(
    `SELECT ${BEGARANSFALT}
       FROM uppdrag_bedomningsbegaran r
       JOIN users u ON u.id = r.begard_av
      WHERE r.company_id = $1 AND r.id = $2`,
    [companyId, id],
  );
  return tillBegaransrad(res.rows[0]!);
}

/**
 * Skriver en begäran om ny bedömning, eller pekar på den som redan väntar.
 *
 * En obesvarad begäran per avtal räcker: finns den returneras den med
 * `befintlig: true`, och ingen rad och ingen auditrad skrivs. Det gäller också
 * ett avslutat uppdrag där begäran var öppen före stängningen — ingen INSERT
 * sker, så avslutstriggern körs inte. Annars fäller triggern
 * `vagrar_skrivning_pa_avslutat` INSERT:en på ett avslutat uppdrag (P0001,
 * 409 `rule_violation`); tjänsten gör ingen egen kontroll av projektets status.
 *
 * `begard_av` är den inloggade användaren, aldrig indata. Kommentaren lagras
 * trimmad: schemat har redan fällt en kommentar av bara blanktecken med 400.
 */
export async function begarNyBedomning(
  client: PoolClient, companyId: string, userId: string, input: BegarNyBedomningInput,
): Promise<Begaransvar> {
  const avtal = await lasAvtalet(client, companyId, input.contract_id);
  const oppen = (await listaObesvaradeBegaranden(client, companyId, [avtal.id]))[0];
  if (oppen) return { ...oppen, befintlig: true };

  const kommentar = input.kommentar?.trim() ?? null;
  // Inget try/catch: ett fångat fel förgiftar transaktionen (lärdom 2).
  const res = await client.query<{ id: string }>(
    `INSERT INTO uppdrag_bedomningsbegaran (company_id, contract_id, begard_av, kommentar)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [companyId, avtal.id, userId, kommentar],
  );
  const id = res.rows[0]!.id;
  // Id och koder, ingen fritext: kommentaren står i raden (lärdom 10).
  await writeAudit(client, {
    companyId,
    userId,
    action: 'uppdrag.bedomning_begard',
    entityType: 'uppdrag_bedomningsbegaran',
    entityId: id,
    details: { contract_id: avtal.id, kommentar_finns: kommentar !== null },
  });
  return { ...(await lasBegaran(client, companyId, id)), befintlig: false };
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
 * Avtalsdelarna ur `getContractUsage` som de fryses. En mappning, två läsare:
 * frysningen här och jämförelsen i undantagsvyns post (Story 1.10), så att
 * "då" och "nu" alltid mappas av samma funktion.
 */
export function delsiffror(parts: readonly Delforbrukning[]): Delsiffra[] {
  return parts.map((d): Delsiffra => ({
    code: d.code,
    name: d.name,
    minuter: d.billable_minutes,
    belopp_ore: d.amount_ore,
    tak_timmar: d.cap_hours,
    tak_ore: d.cap_amount_ore,
    tak_status: d.cap_status,
    andel: d.share,
  }));
}

/** Avtalets delsiffror nu, ur husets enda takberäkning (FR-25). Ingenting räknas om här. */
export async function lasDelsiffror(client: PoolClient, companyId: string, contractId: string): Promise<Delsiffra[]> {
  const avtal = await getContractUsage(client, companyId, contractId) as unknown as { parts: Delforbrukning[] };
  return delsiffror(avtal.parts);
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
      delar: delsiffror(avtal.parts),
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
 * Avgör vilken begäran bedömningen besvarar, under avtalslåset. Med
 * `begaranId` måste begäran finnas i bolaget (annars 404), gälla samma avtal
 * (409 `begaran_annat_avtal`) och vara obesvarad (409 `begaran_besvarad`).
 * Utan `begaranId` väljs avtalets obesvarade begäran, om det finns en —
 * låset gör att det finns högst en.
 *
 * `avtalId` är avtalets id ur låsraden, som databasen skriver det. Jämförelsen
 * står därför mellan två värden ur databasen, och de är lika om och endast om
 * de är samma uuid, i vilket skiftläge indatat än skrevs. Svaret är begärans
 * id ur raden, inte indatats.
 */
async function besvaradBegaran(
  client: PoolClient, companyId: string, avtalId: string, begaranId: string | undefined,
): Promise<string | null> {
  if (begaranId === undefined) {
    return (await listaObesvaradeBegaranden(client, companyId, [avtalId]))[0]?.id ?? null;
  }
  const res = await client.query<{ id: string; contract_id: string; obesvarad: boolean }>(
    `SELECT r.id, r.contract_id, ${OBESVARAD} AS obesvarad
       FROM uppdrag_bedomningsbegaran r
      WHERE r.company_id = $1 AND r.id = $2`,
    [companyId, begaranId],
  );
  const rad = res.rows[0];
  if (!rad) throw new NotFoundError('uppdrag_bedomningsbegaran');
  if (rad.contract_id !== avtalId) {
    throw new ConflictError('begaran_annat_avtal', 'Begäran gäller ett annat avtal än bedömningen.');
  }
  if (!rad.obesvarad) {
    throw new ConflictError('begaran_besvarad',
      'Begäran är redan besvarad med en bedömning. Samma begäran besvaras bara en gång.');
  }
  return rad.id;
}

/**
 * Sätter bedömningen för en period. `userId` kommer ur åtgärdskontexten och
 * skrivs i `satt_av` (0082), aldrig ur indata. Auditraden
 * `uppdrag.bedomning_satt` skrivs här och `action.executed` av
 * `executeAction`, båda i SAMMA transaktion som den här insertningen.
 *
 * Bedömningen besvarar en begäran (Story 1.10): den angivna, eller utan
 * `begaran_id` avtalets öppna begäran. Raden och svaret på begäran är samma
 * INSERT — begäran är besvarad därför att raden bär dess id. Avtalslåset
 * serialiserar två samtidiga svar, och `uppdrag_bedomning_en_per_begaran` är
 * sista försvarslinjen, utan try/catch kring krocken (lärdom 2).
 *
 * Underlaget räknas om HÄR, i samma transaktion, och fryses med raden. En
 * period helt utan tid och händelser fryser nollor och en TOM händelselista
 * (`{}`, inte NULL) — lägesvalet förblir det enda obligatoriska, och ett
 * giltigt svar spärras aldrig.
 */
export async function sattBedomning(
  client: PoolClient, companyId: string, userId: string, input: SattBedomningInput,
): Promise<Bedomningsrad & { contract_name: string }> {
  const avtal = await lasAvtalet(client, companyId, input.contract_id);
  const begaranId = await besvaradBegaran(client, companyId, avtal.id, input.begaran_id);
  const underlag = await byggRapportunderlag(
    client, companyId, avtal.id, input.period_start, input.period_slut,
  );
  const res = await client.query<{ id: string }>(
    `INSERT INTO uppdrag_bedomning
       (company_id, contract_id, period_start, period_slut, lage, satt_av_manniska, kommentar,
        frysta_siffror, handelse_ref_ids, satt_av, begaran_id)
     VALUES ($1, $2, $3, $4, $5, true, $6, $7::jsonb, $8::uuid[], $9::uuid, $10::uuid)
     RETURNING id`,
    [companyId, avtal.id, input.period_start, input.period_slut, input.lage,
      input.kommentar ?? null, JSON.stringify(underlag.frysta), underlag.handelse_ref_ids,
      userId, begaranId],
  );
  const id = res.rows[0]!.id;
  // Id och koder, ingen fritext: kommentaren står i raden (lärdom 10).
  await writeAudit(client, {
    companyId,
    userId,
    action: 'uppdrag.bedomning_satt',
    entityType: 'uppdrag_bedomning',
    entityId: id,
    details: { contract_id: avtal.id, lage: input.lage, begaran_id: begaranId },
  });
  const rad = await client.query<Bedomningsrad>(
    `SELECT ${KOLUMNER}
       FROM uppdrag_bedomning b
       LEFT JOIN users u ON u.id = b.satt_av
      WHERE b.company_id = $1 AND b.id = $2`,
    [companyId, id],
  );
  return { ...rad.rows[0]!, contract_name: avtal.name };
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
       FROM uppdrag_bedomning b
       LEFT JOIN users u ON u.id = b.satt_av
      WHERE b.company_id = $1 AND b.contract_id = $2
      ORDER BY b.period_start, b.created_at, b.id`,
    [companyId, contractId],
  );
  return res.rows;
}
