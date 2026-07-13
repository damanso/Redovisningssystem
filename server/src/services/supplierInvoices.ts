import type { PoolClient } from 'pg';
import { BadRequestError, ConflictError, NotFoundError } from '../lib/errors.js';
import { assertSafeOre, type Ore } from '../domain/money.js';
import { isVatRate, vatFromNet, type VatRate } from '../domain/vat.js';
import { postExpense, postSupplierPayment } from './accounting/autopost.js';
import { nextDocumentNumber } from './accounting/numbering.js';
import { writeAudit } from './auditService.js';

// Leverantörsfakturor (leverantörsreskontra). En inköpsfaktura bokförs till
// kostnad + ingående moms / kredit 2440, och betalas debet 2440 / kredit bank
// (hel- eller delbetalning). Allt inom tenant-gränsen (RLS).

const COLUMNS = `id, supplier_id, number, supplier_ref, invoice_date::text, due_date::text,
  net_ore, vat_rate, vat_ore, total_ore, paid_amount_ore, expense_account, status, voucher_id, notes`;

export async function createSupplierInvoice(
  client: PoolClient, companyId: string, userId: string,
  input: { supplier_id: string; supplier_ref?: string; invoice_date: string; due_date: string; net_ore: Ore; vat_rate: VatRate; expense_account: number; notes?: string },
): Promise<Record<string, unknown>> {
  if (!isVatRate(input.vat_rate)) throw new BadRequestError('invalid_vat_rate', 'otillåten momssats');
  assertSafeOre(input.net_ore);
  if (input.net_ore <= 0) throw new BadRequestError('invalid_amount', 'nettobelopp måste vara positivt');
  if (input.due_date < input.invoice_date) throw new BadRequestError('invalid_due_date', 'förfallodag kan inte vara före fakturadatum');
  const supplier = await client.query('SELECT 1 FROM suppliers WHERE id = $1 AND company_id = $2', [input.supplier_id, companyId]);
  if (!supplier.rows[0]) throw new NotFoundError('supplier');

  const vat = vatFromNet(input.net_ore, input.vat_rate);
  const total = input.net_ore + vat;
  const number = await nextDocumentNumber(client, companyId, 'supplier_invoice');
  const r = await client.query(
    `INSERT INTO supplier_invoices (company_id, supplier_id, number, supplier_ref, invoice_date, due_date,
       net_ore, vat_rate, vat_ore, total_ore, expense_account, notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING ${COLUMNS}`,
    [companyId, input.supplier_id, number, input.supplier_ref ?? null, input.invoice_date, input.due_date,
      input.net_ore, input.vat_rate, vat, total, input.expense_account, input.notes ?? null, userId],
  );
  await writeAudit(client, { companyId, userId, action: 'supplier_invoice.created', entityType: 'supplier_invoice', entityId: r.rows[0]!.id as string, details: { number, total_ore: total } });
  return r.rows[0]!;
}

export async function listSupplierInvoices(client: PoolClient, companyId: string, opts: { status?: string } = {}): Promise<Record<string, unknown>[]> {
  const r = await client.query(
    `SELECT si.${COLUMNS.replace(/\n\s+/g, ' ')}, s.name AS supplier_name
     FROM supplier_invoices si JOIN suppliers s ON s.id = si.supplier_id
     WHERE si.company_id = $1 AND ($2::text IS NULL OR si.status = $2)
     ORDER BY si.number DESC`,
    [companyId, opts.status ?? null],
  );
  return r.rows;
}

export async function getSupplierInvoice(client: PoolClient, companyId: string, id: string): Promise<Record<string, unknown>> {
  const r = await client.query(`SELECT ${COLUMNS} FROM supplier_invoices WHERE id = $1 AND company_id = $2`, [id, companyId]);
  if (!r.rows[0]) throw new NotFoundError('supplier_invoice');
  return r.rows[0];
}

export async function bookSupplierInvoice(client: PoolClient, companyId: string, userId: string, id: string, fiscalYearId: string): Promise<Record<string, unknown>> {
  const inv = await getSupplierInvoice(client, companyId, id);
  if (inv.voucher_id) throw new ConflictError('already_booked', 'leverantörsfakturan är redan bokförd');
  if (inv.status === 'cancelled') throw new ConflictError('cancelled', 'en annullerad faktura kan inte bokföras');
  const voucher = await postExpense(client, companyId, userId, {
    fiscalYearId,
    voucherDate: inv.invoice_date as string,
    sourceId: id,
    sourceType: 'supplier_invoice',
    description: `Leverantörsfaktura ${inv.number}`,
    lines: [{ netOre: inv.net_ore as number, vatRate: inv.vat_rate as VatRate, account: inv.expense_account as number }],
  });
  await client.query("UPDATE supplier_invoices SET voucher_id = $1, status = 'booked' WHERE id = $2 AND company_id = $3", [voucher.id, id, companyId]);
  await writeAudit(client, { companyId, userId, action: 'supplier_invoice.booked', entityType: 'supplier_invoice', entityId: id, details: { voucher_id: voucher.id } });
  return getSupplierInvoice(client, companyId, id);
}

export async function recordSupplierPayment(
  client: PoolClient, companyId: string, userId: string,
  input: { supplierInvoiceId: string; fiscalYearId: string; paymentDate: string; amountOre?: Ore; bankAccount?: number },
): Promise<Record<string, unknown>> {
  // Lås raden (FOR UPDATE) så samtidiga betalningar serialiseras — samma skydd
  // mot dubbelutbetalning som på kundsidan.
  const locked = await client.query<{ total_ore: string; paid_amount_ore: string; status: string; voucher_id: string | null; number: number }>(
    `SELECT total_ore, paid_amount_ore, status, voucher_id, number
     FROM supplier_invoices WHERE id = $1 AND company_id = $2 FOR UPDATE`,
    [input.supplierInvoiceId, companyId],
  );
  const row = locked.rows[0];
  if (!row) throw new NotFoundError('supplier_invoice');
  if (!row.voucher_id) throw new ConflictError('not_booked', 'leverantörsfakturan måste vara bokförd innan en betalning kan registreras');
  if (row.status === 'paid') throw new ConflictError('already_paid', 'fakturan är redan fullt betald');
  if (row.status === 'cancelled') throw new ConflictError('cancelled', 'en annullerad faktura kan inte betalas');
  const total = Number(row.total_ore);
  const alreadyPaid = Number(row.paid_amount_ore);
  const outstanding = total - alreadyPaid;
  const amountOre = input.amountOre ?? outstanding;
  if (amountOre <= 0) throw new BadRequestError('invalid_amount', 'beloppet måste vara positivt');
  if (amountOre > outstanding) throw new BadRequestError('overpayment', `betalningen överstiger återstående skuld (${outstanding} ören)`);
  const voucher = await postSupplierPayment(client, companyId, userId, {
    fiscalYearId: input.fiscalYearId,
    voucherDate: input.paymentDate,
    sourceId: input.supplierInvoiceId,
    description: `Betalning leverantörsfaktura ${row.number}`,
    amountOre,
    bankAccount: input.bankAccount,
  });
  const newPaid = alreadyPaid + amountOre;
  const fullyPaid = newPaid >= total;
  await client.query(
    `UPDATE supplier_invoices SET paid_amount_ore = $1, status = CASE WHEN $2 THEN 'paid' ELSE status END WHERE id = $3 AND company_id = $4`,
    [newPaid, fullyPaid, input.supplierInvoiceId, companyId],
  );
  await writeAudit(client, { companyId, userId, action: 'supplier_invoice.payment_recorded', entityType: 'supplier_invoice', entityId: input.supplierInvoiceId, details: { voucher_id: voucher.id, amount_ore: amountOre, paid_amount_ore: newPaid, fully_paid: fullyPaid } });
  return getSupplierInvoice(client, companyId, input.supplierInvoiceId);
}
