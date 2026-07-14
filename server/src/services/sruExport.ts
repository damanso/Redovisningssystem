// Fas C6: SRU-filgenerering för INK2 (Inkomstdeklaration 2). Skatteverkets
// filöverföring använder två filer: INFO.SRU (avsändaruppgifter) och BLANKETTER.SRU
// (själva deklarationsblanketterna med fältkoder). Denna modul BYGGER filerna ur
// bokföringen (INK2R räkenskapsschema + INK2S skattemässiga justeringar). Den LÄMNAR
// INTE in något digitalt — användaren laddar upp filerna själv i Skatteverkets
// e-tjänst. Belopp rapporteras i hela kronor (öre avrundas).
//
// Fältkoderna nedan fylls från Skatteverkets specifikation (SKV 269 / fältkoder).
// Se SRU_FIELD_CODES. Blankett-id:t bär inkomståret (t.ex. INK2R-2023P4).
import type { PoolClient } from 'pg';
import { ink2rReport, ink2sReport } from './ink2.js';

// Ett fält i en SRU-blankett: fältkod (4 siffror) + belopp i hela kronor.
export interface SruField { kod: string; value: number }
export interface SruBlankett { id: string; fields: SruField[] }

// Avsändaruppgifter till INFO.SRU.
export interface SruSender {
  orgnr: string;      // 10 siffror (ÅÅMMDD-XXXX utan bindestreck), eller org.nr
  name: string;
  address?: string;
  postnr?: string;
  postort?: string;
  email?: string;
  program?: string;   // programnamn som skapade filen
}

// Ören → hela kronor (SRU rapporterar heltal kronor, avrundat).
function toKronor(ore: number): number {
  return Math.round(ore / 100);
}

// SRU tillåter inte godtyckliga tecken i textfält; håll dem enkla (ta bort CR/LF och
// klipp längd). Fältvärden i #UPPGIFT är heltal och behöver ingen escaping.
function sruText(s: string, max = 250): string {
  return s.replace(/[\r\n\t]+/g, ' ').trim().slice(0, max);
}

/**
 * Bygger INFO.SRU. Innehåller en #DATABESKRIVNING (vilken fil som hör ihop) och en
 * #MEDIELEV-sektion med avsändarens org.nr, namn och adress. Radslut är CRLF.
 */
export function buildInfoSru(sender: SruSender, createdIso: string): string {
  const lines: string[] = [
    '#DATABESKRIVNING_START',
    '#PRODUKT SRU',
    '#FILNAMN BLANKETTER.SRU',
    `#DATUM ${createdIso.replace(/-/g, '')}`,
    '#DATABESKRIVNING_SLUT',
    '#MEDIELEV_START',
    `#ORGNR ${sruText(sender.orgnr, 12)}`,
    `#NAMN ${sruText(sender.name)}`,
  ];
  if (sender.address) lines.push(`#ADRESS ${sruText(sender.address)}`);
  if (sender.postnr) lines.push(`#POSTNR ${sruText(sender.postnr, 6)}`);
  if (sender.postort) lines.push(`#POSTORT ${sruText(sender.postort)}`);
  if (sender.email) lines.push(`#EMAIL ${sruText(sender.email)}`);
  lines.push('#MEDIELEV_SLUT');
  return lines.join('\r\n') + '\r\n';
}

/**
 * Bygger BLANKETTER.SRU. Varje blankett inleds med #BLANKETT <id>, en #IDENTITET-rad
 * (org.nr + skapandetidpunkt), #NAMN, sedan en #UPPGIFT-rad per fält, och avslutas
 * med #BLANKETTSLUT. Filen avslutas med #FIL_SLUT. Fält med värde 0 utelämnas.
 */
export function buildBlanketterSru(
  sender: SruSender, blanketter: SruBlankett[], createdDate: string, createdTime: string,
): string {
  const stamp = `${createdDate.replace(/-/g, '')} ${createdTime.replace(/:/g, '')}`;
  const lines: string[] = [];
  for (const b of blanketter) {
    lines.push(`#BLANKETT ${b.id}`);
    lines.push(`#IDENTITET ${sruText(sender.orgnr, 12)} ${stamp}`);
    lines.push(`#NAMN ${sruText(sender.name)}`);
    for (const f of b.fields) {
      if (f.value === 0) continue; // tomma fält skickas inte
      lines.push(`#UPPGIFT ${f.kod} ${f.value}`);
    }
    lines.push('#BLANKETTSLUT');
  }
  lines.push('#FIL_SLUT');
  return lines.join('\r\n') + '\r\n';
}

export interface SruExport {
  info_sru: string;
  blanketter_sru: string;
  income_year: number;
  blankett_ids: string[];
  disclaimer: string;
}

// Blankett-id för inkomståret. Skatteverket namnger blanketterna med inkomstår och
// en periodmarkör (P4 = hela beskattningsåret för juridisk person).
function blankettId(form: 'INK2R' | 'INK2S' | 'INK2', incomeYear: number): string {
  return `${form}-${incomeYear}P4`;
}

/**
 * Genererar SRU-filerna för ett räkenskapsårs INK2 (räkenskapsschema INK2R +
 * skattemässiga justeringar INK2S). Inkomståret = räkenskapsårets slutår.
 */
export async function generateInk2Sru(client: PoolClient, companyId: string, fiscalYearId: string, createdDate: string, createdTime: string): Promise<SruExport> {
  const r = await ink2rReport(client, companyId, fiscalYearId);
  const s = await ink2sReport(client, companyId, fiscalYearId);
  const incomeYear = Number(r.fiscal_year.end.slice(0, 4));

  const company = await client.query<{ name: string; org_number: string | null; email: string | null }>(
    'SELECT name, org_number, email FROM companies WHERE id = $1', [companyId],
  );
  const c = company.rows[0]!;
  const sender: SruSender = {
    orgnr: (c.org_number ?? '').replace(/\D/g, '') || '0000000000',
    name: c.name,
    email: c.email ?? undefined,
    program: 'Redovisningssystem',
  };

  const ink2rFields = mapInk2rFields(r);
  const ink2sFields = mapInk2sFields(s);
  const blanketter: SruBlankett[] = [
    { id: blankettId('INK2R', incomeYear), fields: ink2rFields },
    { id: blankettId('INK2S', incomeYear), fields: ink2sFields },
  ];

  return {
    info_sru: buildInfoSru(sender, createdDate),
    blanketter_sru: buildBlanketterSru(sender, blanketter, createdDate, createdTime),
    income_year: incomeYear,
    blankett_ids: blanketter.map((b) => b.id),
    disclaimer: 'Beräknade SRU-filer (INK2R + INK2S) ur bokföringen. Ingen digital inlämning sker — ladda upp filerna själv i Skatteverkets e-tjänst efter granskning. Kontrollera fältkoderna mot Skatteverkets specifikation för inkomståret.',
  };
}

// --- Fältkodsmappning (SKV 269). Fylls efter research; se SRU_FIELD_CODES. ---
// Placeholders tas bort när de riktiga koderna är bekräftade.
function mapInk2rFields(_r: Awaited<ReturnType<typeof ink2rReport>>): SruField[] {
  return [];
}
function mapInk2sFields(_s: Awaited<ReturnType<typeof ink2sReport>>): SruField[] {
  return [];
}

export { toKronor };
