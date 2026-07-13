/**
 * Bygger en parametriserad UPDATE ... SET-lista från en allowlist.
 *
 * Kolumnnamnen kommer ENBART från `allowed`-mappens värden — literaler i vår
 * egen kod. Nycklar i `input` som inte finns i allowlisten ignoreras (och ska
 * dessutom redan ha stoppats av zod .strict() vid endpointen). Alla värden
 * parametriseras. (Gamla koden interpolerade req.body-nycklar rakt in i SQL →
 * SQL-injektion via kolumnnamn.)
 */
export function buildAllowlistedUpdate(
  allowed: Readonly<Record<string, string>>,
  input: Record<string, unknown>,
): { setSql: string; values: unknown[] } | null {
  const sets: string[] = [];
  const values: unknown[] = [];

  for (const [inputKey, column] of Object.entries(allowed)) {
    if (Object.prototype.hasOwnProperty.call(input, inputKey) && input[inputKey] !== undefined) {
      values.push(input[inputKey]);
      sets.push(`${column} = $${values.length}`);
    }
  }

  if (sets.length === 0) return null;
  return { setSql: sets.join(', '), values };
}
