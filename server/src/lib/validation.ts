import { z } from 'zod';

// Fritext som ska in i Postgres text/jsonb: NUL-tecknet (U+0000) är förbjudet i
// både text och jsonb och skulle annars ge ett omappat DatabaseError → 500.
// Vi avvisar NUL och andra C0-kontrolltecken (utom \t \n \r) redan vid
// valideringen så klienten får ett tydligt 400.
function hasForbiddenControlChar(value: string): boolean {
  for (const ch of value) {
    const code = ch.codePointAt(0)!;
    if (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) return true;
    if (code === 0x7f) return true;
  }
  return false;
}

export function safeText(max: number): z.ZodEffects<z.ZodString, string, string> {
  return z
    .string()
    .min(1)
    .max(max)
    .refine((v) => !hasForbiddenControlChar(v), {
      message: 'texten innehåller otillåtna kontrolltecken',
    });
}

// En delad e-postschema — normaliseringen (lowercase) är lastbärande eftersom
// inloggning matchar på lower(email). Två divergerande kopior kunde annars göra
// att en användare registrerar sig men aldrig kan logga in.
export const EmailSchema = z
  .string()
  .trim()
  .email()
  .max(254)
  .transform((v) => v.toLowerCase());

export const UuidSchema = z.string().uuid();

// Datum måste vara ett verkligt kalenderdatum — enbart regexen släpper igenom
// t.ex. 2026-02-30, som annars blir ett Postgres-fel (22008) → 500.
export const IsoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'datum anges som YYYY-MM-DD')
  .refine((v) => {
    const d = new Date(`${v}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
  }, 'ogiltigt kalenderdatum');
