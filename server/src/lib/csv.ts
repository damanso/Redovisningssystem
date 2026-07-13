// Minimal, säker CSV-serialisering för rapportexport. Semikolon-avgränsat och
// komma-decimal, vilket svensk Excel öppnar rätt utan importguide. Fält som
// innehåller avgränsare, citattecken eller radbrytning citeras (RFC 4180-stil).

const DELIMITER = ';';

// Formelinjektionsskydd: ett fält som börjar med = + - @ (eller tab/CR) kan
// tolkas som en formel av Excel/Sheets (t.ex. "=cmd|...", "@SUM", DDE). Rena tal
// (inkl. negativa belopp som "-50,00") ska INTE röras — bara text som skulle bli
// en formel prefixas med en apostrof så cellen blir ofarlig text.
function needsFormulaGuard(s: string): boolean {
  if (s === '') return false;
  const c = s[0]!;
  if (c === '=' || c === '@' || c === '\t' || c === '\r') return true;
  if (c === '+' || c === '-') return !/^[+-]?\d+([.,]\d+)?$/.test(s); // tillåt rena tal
  return false;
}

function escapeField(value: string | number | null | undefined): string {
  let s = String(value ?? '');
  if (needsFormulaGuard(s)) s = `'${s}`;
  if (s.includes('"') || s.includes(DELIMITER) || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/** Serialiserar rader (array av kolumner) till en CSV-sträng med CRLF-radslut. */
export function toCsv(rows: readonly (readonly (string | number | null | undefined)[])[]): string {
  return rows.map((row) => row.map(escapeField).join(DELIMITER)).join('\r\n') + '\r\n';
}

/** Ören → kronor med svensk komma-decimal och UTAN tusentalsavgränsare (Excel-vänligt). */
export function csvKronor(ore: number): string {
  return (ore / 100).toFixed(2).replace('.', ',');
}
