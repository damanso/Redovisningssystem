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
export function buildInfoSru(sender: SruSender, createdDate: string, createdTime: string): string {
  const stamp = `${createdDate.replace(/-/g, '')} ${createdTime.replace(/:/g, '')}`;
  const lines: string[] = [
    '#DATABESKRIVNING_START',
    '#PRODUKT SRU',
    `#SKAPAD ${stamp}`,
    `#PROGRAM ${sruText(sender.program ?? 'Redovisningssystem', 60)} 1.0`,
    '#FILNAMN blanketter.sru',
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
    info_sru: buildInfoSru(sender, createdDate, createdTime),
    blanketter_sru: buildBlanketterSru(sender, blanketter, createdDate, createdTime),
    income_year: incomeYear,
    blankett_ids: blanketter.map((b) => b.id),
    disclaimer: 'Beräknade SRU-filer (INK2R + INK2S) ur bokföringen. Ingen digital inlämning sker — ladda upp filerna själv i Skatteverkets e-tjänst efter granskning. Kontrollera fältkoderna mot Skatteverkets specifikation för inkomståret.',
  };
}

// --- Fältkodsmappning (Skatteverkets SKV 269). Koderna är stabila mellan år; endast
// blankett-id:t bär inkomståret. Belopp i hela kronor, positiva i sin egen fältkod. ---

// INK2R-vyns fältkoder → SRU-kod. 'income' = intäkt (kredit−debet, positiv),
// 'cost' = kostnad (debet−kredit, positiv). Flera vyfält kan peka på samma SRU-kod
// (summeras). Bokslutsdispositioner (3.20) och årets resultat hanteras separat.
const INK2R_INCOME_KODER: Record<string, { kod: string; kind: 'income' | 'cost' }> = {
  '3.1': { kod: '7410', kind: 'income' },  // Nettoomsättning
  '3.4': { kod: '7413', kind: 'income' },  // Övriga rörelseintäkter
  '3.5': { kod: '7511', kind: 'cost' },    // Råvaror, förnödenheter och handelsvaror
  '3.7': { kod: '7513', kind: 'cost' },    // Övriga externa kostnader
  '3.8': { kod: '7514', kind: 'cost' },    // Personalkostnader
  '3.9': { kod: '7515', kind: 'cost' },    // Av- och nedskrivningar
  '3.10': { kod: '7517', kind: 'cost' },   // Övriga rörelsekostnader
  '3.13': { kod: '7414', kind: 'income' }, // Resultat från andelar i koncernföretag
  '3.16': { kod: '7417', kind: 'income' }, // Övriga ränteintäkter
  '3.18': { kod: '7522', kind: 'cost' },   // Räntekostnader
  '3.24': { kod: '7528', kind: 'cost' },   // Skatt på årets resultat
};
// INK2R-balansfält → SRU-kod. Tillgångar (debet−kredit) och EK/skulder (kredit−debet)
// är redan positiva i vyn. Flera fält kan peka på samma kod (summeras).
const INK2R_BALANCE_KODER: Record<string, string> = {
  '2.1': '7201',   // Immateriella anläggningstillgångar
  '2.4': '7214',   // Byggnader och mark
  '2.5': '7215',   // Maskiner och inventarier
  '2.6': '7233',   // Finansiella anläggningstillgångar (andra långfr. värdepapper)
  '2.14': '7243',  // Varulager (färdiga varor och handelsvaror)
  '2.20': '7251',  // Kundfordringar
  '2.22': '7261',  // Övriga fordringar
  '2.24': '7263',  // Förutbetalda kostnader och upplupna intäkter
  '2.26': '7271',  // Kortfristiga placeringar
  '2.27': '7281',  // Kassa, bank och redovisningsmedel
  '2.28': '7301',  // Bundet eget kapital
  '2.30': '7301',  // Övrigt bundet eget kapital (summeras med 2.28)
  '2.29': '7302',  // Fritt eget kapital (kan vara negativt)
  '2.31': '7321',  // Obeskattade reserver (periodiseringsfonder)
  '2.32': '7333',  // Övriga avsättningar
  '2.33': '7354',  // Långfristiga skulder (övriga)
  '2.40': '7365',  // Leverantörsskulder
  '2.41': '7368',  // Skatteskulder
  '2.42': '7369',  // Moms → övriga kortfristiga skulder
  '2.44': '7369',  // Övriga kortfristiga skulder (summeras)
  '2.45': '7369',  // Personalens källskatt/avgifter → övriga skulder (summeras)
  '2.47': '7370',  // Upplupna kostnader och förutbetalda intäkter
};

function accumulate(map: Map<string, number>, kod: string, value: number): void {
  if (value === 0) return;
  map.set(kod, (map.get(kod) ?? 0) + value);
}

function mapInk2rFields(r: Awaited<ReturnType<typeof ink2rReport>>): SruField[] {
  const acc = new Map<string, number>();
  for (const f of r.income_statement.fields) {
    if (f.code === '3.20') {
      // Bokslutsdispositioner: positivt netto = återföring PF (7420), negativt = avsättning (7525).
      const kr = toKronor(f.amount_ore);
      if (kr > 0) accumulate(acc, '7420', kr);
      else if (kr < 0) accumulate(acc, '7525', -kr);
      continue;
    }
    const m = INK2R_INCOME_KODER[f.code];
    if (!m) continue;
    const kr = toKronor(f.amount_ore);
    if (m.kind === 'income' && kr > 0) accumulate(acc, m.kod, kr);
    else if (m.kind === 'cost' && kr < 0) accumulate(acc, m.kod, -kr);
  }
  // Årets resultat: vinst 7450 / förlust 7550.
  const resKr = toKronor(r.income_statement.arets_resultat_ore);
  if (resKr > 0) accumulate(acc, '7450', resKr);
  else if (resKr < 0) accumulate(acc, '7550', -resKr);

  for (const f of r.balance_sheet.assets) {
    const kod = INK2R_BALANCE_KODER[f.code];
    if (kod) accumulate(acc, kod, toKronor(f.amount_ore));
  }
  for (const f of r.balance_sheet.equity_liabilities) {
    const kod = INK2R_BALANCE_KODER[f.code];
    if (kod) accumulate(acc, kod, toKronor(f.amount_ore));
  }
  return [...acc.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([kod, value]) => ({ kod, value }));
}

function mapInk2sFields(s: Awaited<ReturnType<typeof ink2sReport>>): SruField[] {
  const fields: SruField[] = [];
  const bokfort = toKronor(s.bokfort_resultat_ore);
  if (bokfort >= 0) fields.push({ kod: '7650', value: bokfort });       // 4.1 vinst
  else fields.push({ kod: '7750', value: -bokfort });                    // 4.2 förlust
  const tax = toKronor(s.tax_addback_ore);
  if (tax > 0) fields.push({ kod: '7651', value: tax });                 // 4.3a skatt (ej avdragsgill)
  const nonDed = toKronor(s.non_deductible_ore);
  if (nonDed > 0) fields.push({ kod: '7653', value: nonDed });           // 4.3c andra ej avdragsgilla kostnader
  const nonTax = toKronor(s.non_taxable_ore);
  if (nonTax > 0) fields.push({ kod: '7754', value: nonTax });           // 4.5c bokförda intäkter ej skattepliktiga
  const loss = toKronor(s.loss_used_ore);
  if (loss > 0) fields.push({ kod: '7763', value: loss });               // 4.14a outnyttjat underskott
  const taxable = toKronor(s.taxable_result_ore);
  if (taxable >= 0) fields.push({ kod: '7670', value: taxable });        // 4.15 överskott
  else fields.push({ kod: '7770', value: -taxable });                    // 4.16 underskott
  return fields;
}

export { toKronor };
