// Identifierande rad per förslag i "Att göra".
//
// Utan den här visade kortet bara råa UUID:n ("Invoice ID: 8a1f…"), så
// människan som ska GODKÄNNA inte kunde se vilken faktura/lön/verifikat det
// gällde utan att slå upp den själv. Här löses de ID:n som finns i förslagets
// input upp till något läsbart: "Faktura 27 · ILT Inläsningstjänst AB ·
// 43 202,50 kr".
//
// Rent läsande och felsäker: kan en post inte läsas (raderad, annan tenant)
// utelämnas den — sammanfattningen får aldrig hindra att kön visas.
import type { PoolClient } from 'pg';
import { formatOre } from '../domain/money.js';

const SEP = ' · ';

async function one<T extends Record<string, unknown>>(
  client: PoolClient, sql: string, params: unknown[],
): Promise<T | null> {
  try {
    const r = await client.query<T>(sql, params);
    return r.rows[0] ?? null;
  } catch {
    return null;
  }
}

function asUuid(v: unknown): string | null {
  return typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v) ? v : null;
}

/**
 * Läsbar sammanfattning av vad ett förslag faktiskt rör. null när åtgärden
 * inte pekar på någon post (då räcker kortets fältlista).
 */
export async function describeApproval(
  client: PoolClient, companyId: string, input: Record<string, unknown>,
): Promise<string | null> {
  const parts: string[] = [];

  const invoiceId = asUuid(input.invoice_id);
  if (invoiceId) {
    const row = await one<{ nr: number; customer: string; total_ore: number }>(client,
      `SELECT i.effective_invoice_number AS nr, c.name AS customer, i.total_ore
       FROM invoices i JOIN customers c ON c.id = i.customer_id
       WHERE i.id = $1 AND i.company_id = $2`, [invoiceId, companyId]);
    if (row) parts.push(`Faktura ${row.nr}${SEP}${row.customer}${SEP}${formatOre(row.total_ore, { currency: true })}`);
  }

  const supplierInvoiceId = asUuid(input.supplier_invoice_id);
  if (supplierInvoiceId) {
    const row = await one<{ nr: number; supplier: string; total_ore: number }>(client,
      `SELECT si.number AS nr, s.name AS supplier, si.total_ore
       FROM supplier_invoices si JOIN suppliers s ON s.id = si.supplier_id
       WHERE si.id = $1 AND si.company_id = $2`, [supplierInvoiceId, companyId]);
    if (row) parts.push(`Lev.faktura ${row.nr}${SEP}${row.supplier}${SEP}${formatOre(row.total_ore, { currency: true })}`);
  }

  const receiptId = asUuid(input.receipt_id);
  if (receiptId) {
    const row = await one<{ nr: number; description: string; total_ore: number }>(client,
      'SELECT receipt_number AS nr, description, total_ore FROM receipts WHERE id = $1 AND company_id = $2',
      [receiptId, companyId]);
    if (row) parts.push(`Kvitto ${row.nr}${SEP}${row.description}${SEP}${formatOre(row.total_ore, { currency: true })}`);
  }

  const payslipId = asUuid(input.payslip_id);
  if (payslipId) {
    const row = await one<{ period: string; employee: string; net_ore: number }>(client,
      `SELECT p.period, e.name AS employee, p.net_ore
       FROM payslips p JOIN employees e ON e.id = p.employee_id
       WHERE p.id = $1 AND p.company_id = $2`, [payslipId, companyId]);
    if (row) parts.push(`Lön ${row.period}${SEP}${row.employee}${SEP}netto ${formatOre(row.net_ore, { currency: true })}`);
  }

  const voucherId = asUuid(input.voucher_id);
  if (voucherId) {
    const row = await one<{ series: string; number: number; description: string; voucher_date: string }>(client,
      `SELECT series, number, description, voucher_date::text FROM vouchers
       WHERE id = $1 AND company_id = $2`, [voucherId, companyId]);
    if (row) parts.push(`Verifikat ${row.series}${row.number}${SEP}${row.voucher_date}${SEP}${row.description}`);
  }

  const assetId = asUuid(input.fixed_asset_id);
  if (assetId) {
    const row = await one<{ name: string }>(client,
      'SELECT name FROM fixed_assets WHERE id = $1 AND company_id = $2', [assetId, companyId]);
    if (row) parts.push(`Anläggning: ${row.name}`);
  }

  const partyId = asUuid(input.party_id);
  if (partyId && typeof input.party_type === 'string') {
    const table = input.party_type === 'supplier' ? 'suppliers' : 'customers';
    const row = await one<{ name: string }>(client,
      `SELECT name FROM ${table} WHERE id = $1 AND company_id = $2`, [partyId, companyId]);
    if (row) parts.push(`${input.party_type === 'supplier' ? 'Leverantör' : 'Kund'}: ${row.name}`);
  }

  // post_voucher har ingen post att slå upp — beskriv det som ska bokföras.
  if (parts.length === 0 && typeof input.description === 'string' && Array.isArray(input.lines)) {
    const debit = (input.lines as { debit_ore?: number }[])
      .reduce((s, l) => s + (typeof l.debit_ore === 'number' ? l.debit_ore : 0), 0);
    const date = typeof input.voucher_date === 'string' ? input.voucher_date : null;
    parts.push([date, input.description, debit > 0 ? formatOre(debit, { currency: true }) : null]
      .filter(Boolean).join(SEP));
  }

  // Räkenskapsåret är identifierande för lock_period och liknande.
  const fiscalYearId = asUuid(input.fiscal_year_id);
  if (fiscalYearId) {
    const row = await one<{ label: string }>(client,
      'SELECT label FROM fiscal_years WHERE id = $1 AND company_id = $2', [fiscalYearId, companyId]);
    if (row) parts.push(`Räkenskapsår ${row.label}`);
  }

  // Seriesynken (LOC-263) pekar inte på en post — visa vad som faktiskt ändras.
  if (typeof input.next_invoice_number === 'number') {
    parts.push(`Nästa fakturanummer blir ${input.next_invoice_number}`);
  }
  if (Array.isArray(input.assignments)) {
    const list = (input.assignments as { external_invoice_number?: number }[])
      .map((a) => a.external_invoice_number).filter((n) => typeof n === 'number');
    if (list.length > 0) parts.push(`Kundnummer ${list.join(', ')} (${list.length} fakturor)`);
  }

  if (typeof input.period === 'string' && parts.length === 0) parts.push(`Period ${input.period}`);
  if (typeof input.amount_ore === 'number') parts.push(formatOre(input.amount_ore, { currency: true }));

  return parts.length > 0 ? parts.join(SEP) : null;
}
