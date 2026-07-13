import type { PoolClient } from 'pg';
import { NotFoundError } from '../lib/errors.js';

// SIE4 — svensk standard för export/import av bokföring (systembyte, revisor).
// Belopp anges i kronor med två decimaler, debet positivt och kredit negativt.
// Summan av transaktionsbeloppen per verifikat ska vara 0.

export interface SieCompany {
  name: string;
  orgNumber: string | null;
}
export interface SieFiscalYear {
  startDate: string; // YYYY-MM-DD
  endDate: string;
}
export interface SieAccount {
  account_number: number;
  name: string;
}
export interface SieVoucherLine {
  account_number: number;
  debit_ore: number;
  credit_ore: number;
}
export interface SieVoucher {
  series: string;
  number: number;
  voucher_date: string; // YYYY-MM-DD
  description: string;
  lines: SieVoucherLine[];
}

export interface SieExportInput {
  company: SieCompany;
  fiscalYear: SieFiscalYear;
  accounts: SieAccount[];
  vouchers: SieVoucher[];
  generatedDate: string; // YYYYMMDD
}

function sieDate(isoDate: string): string {
  return isoDate.replace(/-/g, '');
}

/** Öre → SIE-belopp (kronor, punkt som decimal, debet + / kredit −). */
function sieAmount(debitOre: number, creditOre: number): string {
  const ore = debitOre > 0 ? debitOre : -creditOre;
  const kronor = ore / 100;
  return kronor.toFixed(2);
}

// SIE4 är ett radorienterat postformat. Utöver citattecken MÅSTE CR/LF/tab
// neutraliseras i citerade textfält — annars kan en verifikationsbeskrivning
// (eller konto-/bolagsnamn) med inbäddade radbrytningar bryta ut ur posten och
// injicera fabricerade #VER/#TRANS-rader i den exporterade filen (som lämnas
// till revisor/Skatteverket). safeText tillåter \t\n\r, så det måste ske här.
function quote(value: string): string {
  return `"${value.replace(/[\r\n\t]/g, ' ').replace(/"/g, "'")}"`;
}

/** Ren rendering av SIE4-innehåll (teststbar utan databas). */
export function renderSie4(input: SieExportInput): string {
  const lines: string[] = [];
  lines.push('#FLAGGA 0');
  lines.push('#PROGRAM "Redovisningssystem" 0.1');
  lines.push('#FORMAT PC8');
  lines.push(`#GEN ${input.generatedDate}`);
  lines.push('#SIETYP 4');
  if (input.company.orgNumber) lines.push(`#ORGNR ${input.company.orgNumber}`);
  lines.push(`#FNAMN ${quote(input.company.name)}`);
  lines.push(`#RAR 0 ${sieDate(input.fiscalYear.startDate)} ${sieDate(input.fiscalYear.endDate)}`);

  for (const account of input.accounts) {
    lines.push(`#KONTO ${account.account_number} ${quote(account.name)}`);
  }

  for (const voucher of input.vouchers) {
    // SIE4: serie och verifikationsnummer anges ociterade; endast vertexten citeras.
    lines.push(
      `#VER ${voucher.series} ${voucher.number} ${sieDate(voucher.voucher_date)} ${quote(voucher.description)}`,
    );
    lines.push('{');
    for (const line of voucher.lines) {
      lines.push(`   #TRANS ${line.account_number} {} ${sieAmount(line.debit_ore, line.credit_ore)}`);
    }
    lines.push('}');
  }

  return lines.join('\r\n') + '\r\n';
}

// Minimal CP437-kodning (PC8) — SIE4 anger #FORMAT PC8. ASCII är identiskt;
// de nordiska/vanligaste tecknen mappas explicit, övriga icke-ASCII → '?'.
const CP437: Record<string, number> = {
  Ç: 0x80, ü: 0x81, é: 0x82, â: 0x83, ä: 0x84, à: 0x85, å: 0x86, ç: 0x87,
  ê: 0x88, ë: 0x89, è: 0x8a, ï: 0x8b, î: 0x8c, ì: 0x8d, Ä: 0x8e, Å: 0x8f,
  É: 0x90, æ: 0x91, Æ: 0x92, ô: 0x93, ö: 0x94, ò: 0x95, û: 0x96, ù: 0x97,
  ÿ: 0x98, Ö: 0x99, Ü: 0x9a, '¢': 0x9b, '£': 0x9c, '¥': 0x9d, ß: 0xe1,
  '°': 0xf8, µ: 0xe6,
};

export function encodeSiePc8(content: string): Buffer {
  const bytes: number[] = [];
  for (const ch of content) {
    const code = ch.codePointAt(0)!;
    if (code < 0x80) bytes.push(code);
    else if (CP437[ch] !== undefined) bytes.push(CP437[ch]!);
    else bytes.push(0x3f); // '?'
  }
  return Buffer.from(bytes);
}

/** Hämtar ett räkenskapsårs bokföring och renderar SIE4. */
export async function exportFiscalYearSie(
  client: PoolClient,
  companyId: string,
  fiscalYearId: string,
  generatedDate: string,
): Promise<{ content: string; buffer: Buffer }> {
  const fy = await client.query<{ start_date: string; end_date: string }>(
    'SELECT start_date::text, end_date::text FROM fiscal_years WHERE id = $1 AND company_id = $2',
    [fiscalYearId, companyId],
  );
  if (!fy.rows[0]) throw new NotFoundError('fiscal_year');

  const company = await client.query<{ name: string; org_number: string | null }>(
    'SELECT name, org_number FROM companies WHERE id = $1',
    [companyId],
  );

  const vouchersRes = await client.query<{
    id: string;
    series: string;
    number: number;
    voucher_date: string;
    description: string;
  }>(
    `SELECT id, series, number, voucher_date::text, description
     FROM vouchers WHERE company_id = $1 AND fiscal_year_id = $2
     ORDER BY series, number`,
    [companyId, fiscalYearId],
  );

  const linesRes = await client.query<{
    voucher_id: string;
    account_number: number;
    debit_ore: number;
    credit_ore: number;
  }>(
    `SELECT vl.voucher_id, vl.account_number, vl.debit_ore, vl.credit_ore
     FROM voucher_lines vl
     JOIN vouchers v ON v.id = vl.voucher_id
     WHERE v.company_id = $1 AND v.fiscal_year_id = $2
     ORDER BY vl.voucher_id, vl.line_no`,
    [companyId, fiscalYearId],
  );

  const linesByVoucher = new Map<string, SieVoucherLine[]>();
  const usedAccounts = new Set<number>();
  for (const l of linesRes.rows) {
    usedAccounts.add(l.account_number);
    const arr = linesByVoucher.get(l.voucher_id) ?? [];
    arr.push({ account_number: l.account_number, debit_ore: l.debit_ore, credit_ore: l.credit_ore });
    linesByVoucher.set(l.voucher_id, arr);
  }

  const accountNames = await client.query<{ account_number: number; name: string }>(
    `SELECT DISTINCT ON (account_number) account_number, name
     FROM accounts
     WHERE account_number = ANY($1::int[]) AND (company_id IS NULL OR company_id = $2)
     ORDER BY account_number, company_id NULLS LAST`,
    [[...usedAccounts], companyId],
  );

  const input: SieExportInput = {
    company: { name: company.rows[0]!.name, orgNumber: company.rows[0]!.org_number },
    fiscalYear: { startDate: fy.rows[0].start_date, endDate: fy.rows[0].end_date },
    accounts: accountNames.rows,
    vouchers: vouchersRes.rows.map((v) => ({
      series: v.series,
      number: v.number,
      voucher_date: v.voucher_date,
      description: v.description,
      lines: linesByVoucher.get(v.id) ?? [],
    })),
    generatedDate,
  };

  const content = renderSie4(input);
  return { content, buffer: encodeSiePc8(content) };
}
