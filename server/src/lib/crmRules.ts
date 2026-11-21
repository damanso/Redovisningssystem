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
const EDIT_TARGETS = Object.freeze({ kundkort: 'kundkort' } as const);

/** Utan grenval bevaras organisations- och händelseformulärens befintliga väg. */
export function parseEditTarget(value: unknown): 'organisation' | 'kundkort' | null {
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
