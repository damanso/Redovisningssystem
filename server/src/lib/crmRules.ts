// CRM 1.2: jämför mot det visade värdet, så en samtidig synk inte blir ett människobeslut.
import { CustomerNumberSchema, EmailSchema, IsoDateSchema, UuidSchema } from './validation.js';

type CorrectableKind = 'interaction' | 'commitment';
const CORRECTION_FIELDS = {
  interaction: ['summary', 'channel', 'direction', 'occurred_at'],
  commitment: ['body', 'direction', 'due_date', 'occurred_at'],
} as const;

/** UTC-datumet visas tillbaka oförändrat; i dag används nuet så löftet inte hamnar i framtiden. */
export function dateToTimestamp(date: string, now: Date): string {
  // Ett ogiltigt kalenderdatum lämnas åt schemat, före Postgres datumtolkning.
  if (!IsoDateSchema.safeParse(date).success) return date;
  return date === now.toISOString().slice(0, 10) ? now.toISOString() : `${date}T12:00:00Z`;
}

/** Tomt och oförändrat utelämnas; ogiltiga typer lämnas åt åtgärdens synliga validering. */
export function correctedEventFields(kind: CorrectableKind, body: unknown, now: Date): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return {};
  const values = body as Record<string, unknown>;
  const own = (key: string): unknown => Object.hasOwn(values, key) ? values[key] : undefined;
  const patch: Record<string, unknown> = {};
  for (const field of CORRECTION_FIELDS[kind]) {
    const previous = own(`fore_${field}`);
    const before = typeof previous === 'string' ? previous : '';
    if (field === 'due_date' && own('inget_forfallodatum') === 'ja') {
      if (before) patch.due_date = null;
      continue;
    }
    if (!Object.hasOwn(values, field)) continue;
    const value = own(field);
    if (typeof value !== 'string') {
      patch[field] = value;
      continue;
    }
    if (field === 'summary' || field === 'body') {
      const trimmed = value.trim();
      if (trimmed && trimmed !== before.trim()) patch[field] = trimmed;
    } else if (value && value !== before) {
      patch[field] = field === 'occurred_at' ? dateToTimestamp(value, now) : value;
    }
  }
  return patch;
}

const ORGANIZATION_CORRECTION_FIELDS = ['name', 'org_number', 'website', 'status', 'customer_id', 'roll'] as const;

/** Bara ändringar mot det visade blir människobeslut; tomt betyder oförändrat. */
export function correctedOrganizationFields(body: unknown): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return {};
  const values = body as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  for (const field of ORGANIZATION_CORRECTION_FIELDS) {
    if (!Object.hasOwn(values, field)) continue;
    const value = values[field];
    if (typeof value !== 'string') {
      patch[field] = value;
      continue;
    }
    const previous = Object.hasOwn(values, `fore_${field}`) ? values[`fore_${field}`] : undefined;
    const before = typeof previous === 'string' ? previous.trim() : '';
    const trimmed = value.trim();
    if (trimmed && trimmed !== before) patch[field] = trimmed;
  }
  return patch;
}

const OPEN_FORMS = Object.freeze({ uppgifter: 'uppgifter', slaihop: 'slaihop' } as const);
type OpenForm = typeof OPEN_FORMS[keyof typeof OPEN_FORMS];

/** Adressen får bara öppna kända formulär, aldrig ärvda objektnycklar. */
export function parseOpenForm(value: unknown): OpenForm | null {
  return typeof value === 'string' && Object.hasOwn(OPEN_FORMS, value)
    ? OPEN_FORMS[value as keyof typeof OPEN_FORMS] : null;
}

/** Kundregistret äger fakturafälten, kundnumret och en kopplad relations org.nr; relationens identitet och koppling får inte skickas med. */
const CUSTOMER_CORRECTION_FIELDS = ['customer_number', 'org_number', 'email', 'phone', 'address', 'postal_code', 'city', 'vat_number', 'payment_terms'] as const;

/** Fast text håller ogiltig e-post synlig utan att återge formulärets indata. */
export const CUSTOMER_EMAIL_ERROR = 'Fakturamejlet är ingen giltig e-postadress. Inget sparades.';
/** Villkoret måste kunna användas som hela fakturadagar. */
export const CUSTOMER_TERMS_ERROR = 'Betalningsvillkoret anges i hela dagar från 0 till 365. Inget sparades.';
/** Ett kundnummer ska vara ett giltigt heltal även när webbläsarens skydd kringgås. */
export const CUSTOMER_NUMBER_ERROR = 'Kundnumret anges som ett heltal från 1. Inget sparades.';

/** Bara ändrat skickas; äldre orörda mejl får inte hindra en adressrättelse. */
export function correctedCustomerFields(body: unknown):
  { ok: true; fields: Record<string, unknown> } | { ok: false; error: string } {
  const fields: Record<string, unknown> = {};
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return { ok: true, fields };
  const values = body as Record<string, unknown>;
  for (const field of CUSTOMER_CORRECTION_FIELDS) {
    if (!Object.hasOwn(values, field)) continue;
    const value = values[field];
    if (typeof value !== 'string') {
      if (field === 'customer_number') return { ok: false, error: CUSTOMER_NUMBER_ERROR };
      if (field === 'payment_terms') return { ok: false, error: CUSTOMER_TERMS_ERROR };
      fields[field] = value;
      continue;
    }
    const previous = Object.hasOwn(values, `fore_${field}`) ? values[`fore_${field}`] : undefined;
    const before = typeof previous === 'string' ? previous.trim() : '';
    const trimmed = value.trim();
    if (!trimmed || trimmed === before) continue;
    if (field === 'customer_number') {
      const number = CustomerNumberSchema.safeParse(Number(trimmed));
      if (!/^\d{1,10}$/.test(trimmed) || !number.success) return { ok: false, error: CUSTOMER_NUMBER_ERROR };
      if (/^\d{1,10}$/.test(before) && number.data === Number(before)) continue;
      fields[field] = number.data;
    } else if (field === 'email') {
      const email = EmailSchema.safeParse(trimmed);
      if (!email.success) return { ok: false, error: CUSTOMER_EMAIL_ERROR };
      fields[field] = email.data;
    } else if (field === 'payment_terms') {
      if (!/^\d{1,3}$/.test(trimmed) || Number(trimmed) > 365) return { ok: false, error: CUSTOMER_TERMS_ERROR };
      fields[field] = Number(trimmed);
    } else {
      fields[field] = trimmed;
    }
  }
  return { ok: true, fields };
}

/** En sluten mängd hindrar okända handgrepp från att välja en skrivväg. */
const EDIT_TARGETS = Object.freeze({ kundkort: 'kundkort', person: 'person' } as const);

/** Utan grenval bevaras organisations- och händelseformulärens befintliga väg. */
export function parseEditTarget(value: unknown): 'organisation' | 'kundkort' | 'person' | null {
  if (value === undefined) return 'organisation';
  return typeof value === 'string' && Object.hasOwn(EDIT_TARGETS, value)
    ? EDIT_TARGETS[value as keyof typeof EDIT_TARGETS] : null;
}

/** En ny kundkoppling får bara ändra en status som ingen människa bestämt (A-5). */
export function statusAfterLink<S extends string>(current: S, provenance: string | null | undefined): S | 'customer' {
  return current === 'prospect' && provenance !== 'human' ? 'customer' : current;
}

/** Jämförelsen med oskyddat ursprung gör ett stoppat byte synligt utan en andra regel. */
export function linkStatusOutcome<S extends string>(current: S, provenance: string | null | undefined): { status: S | 'customer'; kept: boolean } {
  const status = statusAfterLink(current, provenance);
  return { status, kept: status === current && statusAfterLink(current, null) !== current };
}

/** Kortet och körningen ska räkna samma följd av att kundkopplingen flyttas. */
export function mergeStatusOutcome(
  keep: { status: string; customer_id: string | null }, gone: { customer_id: string | null },
  provenance: string | null | undefined,
): { linkMoves: boolean; from: string; to: string; kept: boolean } {
  const linkMoves = keep.customer_id === null && gone.customer_id !== null;
  const outcome = linkMoves ? linkStatusOutcome(keep.status, provenance) : { status: keep.status, kept: false };
  return { linkMoves, from: keep.status, to: outcome.status, kept: outcome.kept };
}

/**
 * Vad synken får göra med löftets status (A-2). Bara `human` skyddas (A-1), med
 * ett undantag: synken skrev aldrig status före 3.3, så en stängd status utan
 * ursprungsrad sattes av en människa med statusåtgärden och står kvar som hennes,
 * också mot samma värde — annars hade nästa open öppnat Davids avslut.
 */
export function syncedCommitmentStatus(
  current: 'open' | 'done' | 'dropped', provenance: string | null | undefined,
  incoming: 'open' | 'done' | 'dropped' | undefined,
): 'omitted' | 'kept_human' | 'write' {
  if (incoming === undefined) return 'omitted';
  if (provenance === 'human') return 'kept_human';
  if ((provenance === null || provenance === undefined) && current !== 'open') return 'kept_human';
  return 'write';
}

const PROJECT_CODE_PATTERN = /^[A-ZÅÄÖ]{2,6}-\d{3}$/;

/** En projektkod är ett uppdrag, ingen motpart; en relation under koden gör att styrvyn räknar noll för kunden. */
export function isProjectCode(name: string): boolean {
  return PROJECT_CODE_PATTERN.test(name.trim());
}


/** Bara namnkrocken leder till sammanslagning; en upptagen kundkoppling bär också ett relations-id. */
export function nameTakenOrganization(error: { code: string; details?: unknown }): string | null {
  if (error.code !== 'name_taken') return null;
  const details = error.details;
  if (typeof details !== 'object' || details === null || Array.isArray(details) || !Object.hasOwn(details, 'organization_id')) return null;
  const id = (details as Record<string, unknown>).organization_id;
  return typeof id === 'string' && UuidSchema.safeParse(id).success ? id.toLowerCase() : null;
}

/** Adressen kan skrivas för hand; bara bolagets andra relationer får förväljas eller visas i notisen. */
export function mergeCandidate(value: unknown, candidateIds: readonly string[]): string | null {
  if (typeof value !== 'string' || !UuidSchema.safeParse(value).success) return null;
  const id = value.toLowerCase();
  return candidateIds.includes(id) ? id : null;
}

/** Bara bolagsformsvarianten ger förslag; namnkrock och kundlås bär också relations-id men betyder annat. */
export function nameVariantOrganization(error: { code: string; details?: unknown }): { organization_id: string; name: string } | null {
  if (error.code !== 'name_variant_of') return null;
  const details = error.details;
  if (typeof details !== 'object' || details === null || Array.isArray(details)
    || !Object.hasOwn(details, 'organization_id') || !Object.hasOwn(details, 'name')) return null;
  const { organization_id: id, name } = details as Record<string, unknown>;
  if (typeof id !== 'string' || !UuidSchema.safeParse(id).success || typeof name !== 'string' || !name.trim()) return null;
  return { organization_id: id.toLowerCase(), name: name.trim() };
}

/** Bolagsformslistan finns bara i SQL; databasens nyckel avgränsar namnets egen stavning. */
export function companyFormSuffix(name: string, nameNorm: string): string | null {
  const normalized = name.trim().replace(/\s+/g, ' ');
  return normalized.toLowerCase().startsWith(`${nameNorm} `)
    ? normalized.slice(nameNorm.length + 1).trim() || null : null;
}

/**
 * Trådens fem slag, en egen sluten tabell så att lib inte beror på trådtjänsten.
 * Unionen är densamma som `ThreadKind`, så rutten som skickar markören vidare
 * fäller typkontrollen om de glider isär (story 4.1).
 */
export const THREAD_CURSOR_KINDS = Object.freeze({
  interaction: 'interaction', commitment: 'commitment', commitment_closed: 'commitment_closed',
  invoice: 'invoice', payment: 'payment',
} as const);
type ThreadCursorKind = typeof THREAD_CURSOR_KINDS[keyof typeof THREAD_CURSOR_KINDS];

/** Exakt den form `toISOString()` ger; allt annat är en handskriven adress. */
const CURSOR_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** Fast text: säger vad som är fel och vad David gör, utan att återge adressen. */
export const THREAD_CURSOR_ERROR = 'Adressens läsposition i tråden går inte att läsa. Öppna relationen igen för att se de nyaste händelserna.';

/**
 * `?fore=<at>|<kind>|<ref_id>` tolkad som tillåtelselista som aldrig kastar
 * (A-7). Tidpunkten måste gå fram och tillbaka genom `toISOString()` och ha ett
 * år från 0001, eftersom Postgres avvisar 2026-02-30 och år 0 och vyns sidor
 * gör ett databasfel till 500. Slaget slås upp med `hasOwn`, inte `in`.
 */
export function parseThreadCursor(value: unknown): { at: string; kind: ThreadCursorKind; ref_id: string } | null {
  if (typeof value !== 'string' || value.length > 100) return null;
  const parts = value.split('|');
  if (parts.length !== 3) return null;
  const [at, kind, refId] = parts as [string, string, string];
  if (!CURSOR_TIME_PATTERN.test(at) || at.startsWith('0000')) return null;
  const time = new Date(at);
  if (Number.isNaN(time.getTime()) || time.toISOString() !== at) return null;
  if (!Object.hasOwn(THREAD_CURSOR_KINDS, kind) || !UuidSchema.safeParse(refId).success) return null;
  return { at, kind: THREAD_CURSOR_KINDS[kind as keyof typeof THREAD_CURSOR_KINDS], ref_id: refId.toLowerCase() };
}

/**
 * Markören ur en visad rad, och bara om `parseThreadCursor` läser den: formen är
 * då densamma åt båda hållen. Trådens `at` är en `Date` vid körning; ett ogiltigt
 * datum ger null innan `toISOString()` hinner kasta, så vyn aldrig visar en
 * trasig länk.
 */
export function formatThreadCursor(row: { at: unknown; kind: string; ref_id: string | null }): string | null {
  const time = row.at instanceof Date ? row.at : typeof row.at === 'string' ? new Date(row.at) : null;
  if (time === null || Number.isNaN(time.getTime()) || row.ref_id === null) return null;
  const cursor = `${time.toISOString()}|${row.kind}|${row.ref_id.toLowerCase()}`;
  return parseThreadCursor(cursor) ? cursor : null;
}

/** Fast text: säger vad som är fel och vad David gör, utan att återge adressen (story 4.3). */
export const PERSON_PARAM_ERROR = 'Adressens person går inte att läsa. Öppna relationen igen och välj personen under Personer.';

/**
 * `?person=<uuid>` tolkad som tillåtelselista som aldrig kastar (A-7): en tom,
 * upprepad eller handskriven parameter blir null, och vyn svarar då med en
 * 400-sida i stället för att låta Postgres fälla id:t som 500. Gemener, eftersom
 * vyn jämför id:t med personernas `id` som text.
 */
export function parsePersonParam(value: unknown): string | null {
  return typeof value === 'string' && UuidSchema.safeParse(value).success ? value.toLowerCase() : null;
}

/** Personhuvudet rättar namn, roll och telefon; e-posten är personens nyckel och rättas inte här. */
const PERSON_CORRECTION_FIELDS = Object.freeze(['name', 'role_title', 'phone'] as const);

/** Samma regel som organisationens rättelse: bara ändringar mot det visade blir människobeslut, och tomt är oförändrat. */
export function correctedPersonFields(body: unknown): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return {};
  const values = body as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  for (const field of PERSON_CORRECTION_FIELDS) {
    if (!Object.hasOwn(values, field)) continue;
    const value = values[field];
    if (typeof value !== 'string') {
      patch[field] = value;
      continue;
    }
    const previous = Object.hasOwn(values, `fore_${field}`) ? values[`fore_${field}`] : undefined;
    const before = typeof previous === 'string' ? previous.trim() : '';
    const trimmed = value.trim();
    if (trimmed && trimmed !== before) patch[field] = trimmed;
  }
  return patch;
}

/**
 * Hela dygn från `day` till `today`, båda kalenderdatum räknade som UTC-midnatt,
 * så att personhuvudets «N d sedan» inte beror på serverns zon. Ett datum som
 * inte finns ger null i stället för NaN på sidan.
 */
export function daysSince(day: string, today: string): number | null {
  if (!IsoDateSchema.safeParse(day).success || !IsoDateSchema.safeParse(today).success) return null;
  return Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) / 86_400_000);
}

/**
 * Hur länge en ögonblicksbild av affärerna räknas som aktuell: en natt och
 * marginalen för en sen körning (arkitekturens K-2). Äldre än så visas den
 * aldrig som aktuell.
 */
export const DEAL_SNAPSHOT_MAX_AGE_HOURS = 26;

/**
 * Hur långt före vår klocka avsändarens tidpunkt får ligga. Två klockor går
 * aldrig exakt lika, men en tid längre fram än så är ett fel hos avsändaren.
 */
export const DEAL_CLOCK_SKEW_MINUTES = 5;

/**
 * Ligger tidpunkten mer än klockmarginalen före `now`? En ögonblicksbild från
 * framtiden hade räknats som aktuell långt efter att nattjobbet slutat gå, och
 * en aktivitet från framtiden hade dolt stilleståndet. Samma regel avvisar
 * båda i mottagningen och fäller ögonblicksbilden i grinden. En tid som inte
 * går att läsa räknas inte här; den fångas av sin egen regel.
 */
export function aheadOfClock(at: string, now: string): boolean {
  return Date.parse(at) - Date.parse(now) > DEAL_CLOCK_SKEW_MINUTES * 60_000;
}

/** Affärsläsningens tre utfall, engelska koder som resten av CRM; vyn sätter orden OK, TOMT och OKÄNT. */
export type DealSnapshotStatus = 'ok' | 'empty' | 'unknown';

/**
 * Grinden för affärscachen, på ett ställe. Okänt när ingen ögonblicksbild
 * finns, när tidpunkten inte går att läsa, när den är mer än 26 timmar gammal
 * eller när den ligger längre fram än klockmarginalen; tomt när Hermes skickade
 * en tom mängd; annars ok. Tomt läses ur antalet Hermes skickade, inte ur
 * antalet cachade rader, så en ögonblicksbild där varje rad hoppades över
 * aldrig ser ut som «inga öppna affärer».
 */
export function dealSnapshotStatus(observedAt: string | null, received: number, now: string): DealSnapshotStatus {
  if (observedAt === null) return 'unknown';
  const age = Date.parse(now) - Date.parse(observedAt);
  if (Number.isNaN(age) || age > DEAL_SNAPSHOT_MAX_AGE_HOURS * 3_600_000 || aheadOfClock(observedAt, now)) return 'unknown';
  return received === 0 ? 'empty' : 'ok';
}

/**
 * Hela kalenderdygn sedan affärens senaste aktivitet, räknade som `daysSince`
 * i UTC. Aldrig under noll: en aktivitet i framtiden (avsändarens klocka) eller
 * ett datum som inte går att läsa ger 0 i stället för ett negativt stillestånd.
 */
export function idleDays(lastActivityAt: string, now: string): number {
  return Math.max(0, daysSince(lastActivityAt.slice(0, 10), now.slice(0, 10)) ?? 0);
}

// Skedenas etiketter i affärsskälet. Vyns statusetiketter säger samma sak, men
// regelfilen läser inte vylagret; provet låser att de två är lika.
const DEAL_STAGE_LABELS: Readonly<Record<string, string>> = Object.freeze({
  idea: 'Idé', dialogue: 'Dialog', proposal: 'Offert', negotiation: 'Förhandling',
});

/**
 * Affärsskälet i kontaktförslagen (FR-22): förslagens tredje grund efter
 * löftena och tystnaden. En affär är stillastående när den stått stilla minst
 * relationens tystnadsgräns, samma gräns som tystnadsskälet, så ingen ny
 * konstant behövs. Den som stått stilla längst nämns, den första vid lika, och
 * fler läggs till som antal, som i skälet för förfallna löften: skälet ska gå
 * att läsa som en öppningsreplik. Skedet står alltid med, och allt utanför
 * tabellen blir «skede okänt» i stället för ett rått värde.
 */
export function stalledDealReason(
  deals: readonly { title: string; stage: string | null; idle_days: number }[], thresholdDays: number,
): { reason: string; idle_days: number } | null {
  const stalled = deals.filter((deal) => deal.idle_days >= thresholdDays);
  let longest = stalled[0];
  if (!longest) return null;
  for (const deal of stalled) if (deal.idle_days > longest.idle_days) longest = deal;
  const label = (longest.stage !== null && Object.hasOwn(DEAL_STAGE_LABELS, longest.stage)
    ? DEAL_STAGE_LABELS[longest.stage] : undefined) ?? 'skede okänt';
  const more = stalled.length > 1 ? ` (och ${stalled.length - 1} till)` : '';
  return {
    reason: `affären ${longest.title} (${label}) har stått stilla i ${longest.idle_days} dagar${more}`,
    idle_days: longest.idle_days,
  };
}

/** Vägar som kan fånga kontakter. Sluten: en ny väg kräver en fras i tabellen nedan (story 5.1). */
export type ContactCapturePath = 'mail' | 'calendar' | 'issues';
/** Vägar som kan fånga löften. Sluten av samma skäl. */
export type CommitmentCapturePath = 'issues_waiting_external' | 'ai_conversation' | 'promise_form';

export interface CapturePaths {
  readonly contacts: readonly ContactCapturePath[];
  readonly commitments: readonly CommitmentCapturePath[];
}

export interface CaptureTexts {
  todayQuiet: string;
  relationsLede: string;
  relationsEmpty: string;
  commitmentsOpenEmpty: string;
  promiseFormHint: string;
  customerCardEmpty: string;
}

/**
 * Frastabellerna. Nyckelordningen är den kanoniska: texterna följer den och inte
 * konstantens ordning. `Record` över de slutna nyckeltyperna gör att en ny väg
 * utan fras fäller typkontrollen. Kalendern (5.9) och AI-samtalet (5.11) står
 * här redan, så att en väg som tas i drift bara ändrar konstanten; AI-samtalets
 * fraser är provisoriska och ägs av 5.11.
 */
const CONTACT_PATH_WORDS: Readonly<Record<ContactCapturePath, string>> = Object.freeze({
  mail: 'mail',
  calendar: 'möten',
  issues: 'ärenden',
} as const);

/** `outOf` är ur-formen i hinten, `from` från-formen i tomlägena; bara automatiska vägar har en ur-form. */
type CommitmentPhrase =
  | { readonly automatic: true; readonly outOf: string; readonly from: string }
  | { readonly automatic: false; readonly from: string };

const COMMITMENT_PATH_PHRASES: Readonly<Record<CommitmentCapturePath, CommitmentPhrase>> = Object.freeze({
  issues_waiting_external: { automatic: true, outOf: 'ur ärenden märkta Väntar-extern', from: 'från ärenden märkta Väntar-extern' },
  ai_conversation: { automatic: true, outOf: 'som du nämner för AI:n', from: 'när du nämner det för AI:n' },
  promise_form: { automatic: false, from: 'från Lova något på relationen' },
} as const);

/** Tabellens rader i tabellens ordning, bara de vars nyckel står i listan; dubbletter i listan ger ingen dubbeltext. */
function inOperation<K extends string, V>(table: Readonly<Record<K, V>>, paths: readonly K[]): V[] {
  return (Object.entries(table) as [K, V][]).filter(([key]) => paths.includes(key)).map(([, value]) => value);
}

/** «a», «a och b», «a, b och c». */
function joinList(items: readonly string[], conjunction: 'och' | 'eller'): string {
  const head = items.slice(0, -1);
  const last = items.slice(-1).join('');
  return head.length === 0 ? last : `${head.join(', ')} ${conjunction} ${last}`;
}
const andList = (items: readonly string[]): string => joinList(items, 'och');
const orList = (items: readonly string[]): string => joinList(items, 'eller');

/**
 * De sex fångstmeningarna i Idag, Relationer, åtagandevyn, *Lova något* och
 * kundkortet (FR-31, PRD lucka 21). Ett tomläge får bara nämna vägar i drift:
 * annars läses en tom lista som avbetad fast den bara är oläst. Funktionen läser
 * aldrig konstanten själv, så att vyn och proven ger den samma lista.
 */
export function captureTexts(paths: CapturePaths): CaptureTexts {
  const contactWords = inOperation(CONTACT_PATH_WORDS, paths.contacts);
  const commitmentPhrases = inOperation(COMMITMENT_PATH_PHRASES, paths.commitments);
  const automatic = commitmentPhrases.filter((p): p is Extract<CommitmentPhrase, { automatic: true }> => p.automatic);
  const byHand = paths.commitments.includes('promise_form');
  const saidInPerson = 'Det här är för det som sades i ett samtal eller möte.';
  return {
    todayQuiet: contactWords.length > 0
      ? `Kommer något in via ${orList(contactWords)} dyker det upp av sig självt.` : '',
    relationsLede: `Senaste kontakt, öppna löften och vad relationen är värd — härlett ur ${
      andList([...contactWords, 'bokförda fakturor'])}. Ingen inmatning krävs.`,
    relationsEmpty: contactWords.length > 0
      ? `De flesta dyker upp av sig själva när ${andList(contactWords)} kommer in.` : '',
    commitmentsOpenEmpty: automatic.length > 0
      ? `Löften kommer in av sig själva ${andList(automatic.map((p) => p.from))}${
        byHand ? ', och du kan lägga till ett under Lova något på en relation.' : '.'}`
      : byHand ? 'Du kan lägga till ett under Lova något på en relation.' : '',
    promiseFormHint: automatic.length > 0
      ? `Löften ${andList(automatic.map((p) => p.outOf))} kommer in av sig själva. ${saidInPerson}` : saidInPerson,
    customerCardEmpty: commitmentPhrases.length > 0
      ? `Inga öppna löften. Löften kommer ${andList(commitmentPhrases.map((p) => p.from))}.` : 'Inga öppna löften.',
  };
}
