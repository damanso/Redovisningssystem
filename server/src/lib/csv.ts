// Minimal, säker CSV-serialisering för rapportexport. Semikolon-avgränsat och
// komma-decimal, vilket svensk Excel öppnar rätt utan importguide. Fält som
// innehåller avgränsare, citattecken eller radbrytning citeras (RFC 4180-stil).

const DELIMITER = ';';

function escapeField(value: string | number | null | undefined): string {
  const s = String(value ?? '');
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
