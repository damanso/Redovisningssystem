// CRM 1.2: jämför mot det visade värdet, så en samtidig synk inte blir ett människobeslut.
import { IsoDateSchema } from './validation.js';

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

const OPEN_FORMS = Object.freeze({ uppgifter: 'uppgifter' } as const);
type OpenForm = typeof OPEN_FORMS[keyof typeof OPEN_FORMS];

/** Adressen får bara öppna kända formulär, aldrig ärvda objektnycklar. */
export function parseOpenForm(value: unknown): OpenForm | null {
  return typeof value === 'string' && Object.hasOwn(OPEN_FORMS, value)
    ? OPEN_FORMS[value as keyof typeof OPEN_FORMS] : null;
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

const PROJECT_CODE_PATTERN = /^[A-ZÅÄÖ]{2,6}-\d{3}$/;

/** En projektkod är ett uppdrag, ingen motpart; en relation under koden gör att styrvyn räknar noll för kunden. */
export function isProjectCode(name: string): boolean {
  return PROJECT_CODE_PATTERN.test(name.trim());
}
