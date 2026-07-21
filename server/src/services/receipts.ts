import type { PoolClient } from 'pg';
import { BadRequestError, ConflictError, NotFoundError } from '../lib/errors.js';
import { assertSafeOre, type Ore } from '../domain/money.js';
import { isVatRate, vatFromNet, type VatRate } from '../domain/vat.js';
import { assertAccountsExist } from './accounting/accounts.js';
import { resolveFiscalYearForDate } from './accounting/fiscalYears.js';
import { postExpense } from './accounting/autopost.js';
import { writeAudit } from './auditService.js';
import { nextDocumentNumber } from './accounting/numbering.js';
import { removeStoredFile, validateUpload, writeStoredFile } from './fileStorage.js';
import { withTenantTransaction } from '../db/tx.js';

export interface CreateReceiptInput {
  supplier_id?: string;
  receipt_date: string;
  description: string;
  net_ore: Ore;
  vat_rate: VatRate;
  expense_account: number;
  payment_account?: number;
}

const RECEIPT_COLUMNS = `id, receipt_number, receipt_date::text, description, net_ore, vat_ore,
  total_ore, vat_rate, expense_account, payment_account, status, supplier_id, file_id, voucher_id`;

export async function createReceipt(
  client: PoolClient, companyId: string, userId: string, input: CreateReceiptInput,
): Promise<Record<string, unknown>> {
  if (!isVatRate(input.vat_rate)) throw new BadRequestError('invalid_vat_rate', 'otillåten momssats');
  assertSafeOre(input.net_ore);
  // Positivt netto krävs — ett nollkvitto går ändå inte att bokföra (postExpense
  // kräver netto > 0), så vi avvisar det direkt i stället för att skapa ett
  // dokument som fastnar obokfört.
  if (input.net_ore <= 0) throw new BadRequestError('invalid_amount', 'nettobelopp måste vara positivt');
  if (input.supplier_id) {
    const s = await client.query('SELECT 1 FROM suppliers WHERE id = $1 AND company_id = $2', [input.supplier_id, companyId]);
    if (!s.rows[0]) throw new NotFoundError('supplier');
  }
  // Validera konton tidigt (fail-fast) i stället för först vid bokföring.
  await assertAccountsExist(client, companyId, [input.expense_account, input.payment_account ?? 2440]);
  const vat = vatFromNet(input.net_ore, input.vat_rate);
  const total = assertSafeOre(input.net_ore + vat);
  const number = await nextDocumentNumber(client, companyId, 'receipt');

  const result = await client.query(
    `INSERT INTO receipts (company_id, supplier_id, receipt_number, receipt_date, description,
        net_ore, vat_ore, total_ore, vat_rate, expense_account, payment_account, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING ${RECEIPT_COLUMNS}`,
    [companyId, input.supplier_id ?? null, number, input.receipt_date, input.description,
      input.net_ore, vat, total, input.vat_rate, input.expense_account, input.payment_account ?? 2440, userId],
  );
  const row = result.rows[0]!;
  await writeAudit(client, { companyId, userId, action: 'receipt.created', entityType: 'receipt', entityId: row.id, details: { receipt_number: number, total_ore: total } });
  return row;
}

export async function getReceipt(client: PoolClient, companyId: string, id: string): Promise<Record<string, unknown>> {
  const result = await client.query(`SELECT ${RECEIPT_COLUMNS} FROM receipts WHERE id = $1 AND company_id = $2`, [id, companyId]);
  if (!result.rows[0]) throw new NotFoundError('receipt');
  return result.rows[0];
}

export async function listReceipts(
  client: PoolClient, companyId: string, opts: { status?: string } = {},
): Promise<Record<string, unknown>[]> {
  const result = await client.query(
    `SELECT ${RECEIPT_COLUMNS} FROM receipts
     WHERE company_id = $1 AND ($2::text IS NULL OR status = $2) ORDER BY receipt_number DESC`,
    [companyId, opts.status ?? null],
  );
  return result.rows;
}

/**
 * Bifogar en fil (kvittobild/PDF) och lagrar den i dokumentarkivet. Diskskrivning
 * utanför transaktionen + städning vid rollback (samma mönster som files.ts).
 */
export async function attachReceiptFile(
  companyId: string, userId: string, id: string, originalName: string, buffer: Buffer,
): Promise<Record<string, unknown>> {
  const validated = validateUpload(originalName, buffer);
  await withTenantTransaction(userId, companyId, async (client) => {
    const receipt = await client.query('SELECT id FROM receipts WHERE id = $1 AND company_id = $2', [id, companyId]);
    if (!receipt.rows[0]) throw new NotFoundError('receipt');
  });
  await writeStoredFile(companyId, validated.storedName, buffer);
  try {
    return await withTenantTransaction(userId, companyId, async (client) => {
      const file = await client.query<{ id: string }>(
        `INSERT INTO files (company_id, original_name, stored_name, mime_type, size_bytes, sha256, uploaded_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [companyId, originalName, validated.storedName, validated.mimeType, buffer.length, validated.sha256, userId],
      );
      const fileId = file.rows[0]!.id;
      const updated = await client.query('UPDATE receipts SET file_id = $1 WHERE id = $2 AND company_id = $3', [fileId, id, companyId]);
      if (updated.rowCount === 0) throw new NotFoundError('receipt');
      await writeAudit(client, { companyId, userId, action: 'receipt.file_attached', entityType: 'receipt', entityId: id, details: { file_id: fileId } });
      return getReceipt(client, companyId, id);
    });
  } catch (err) {
    await removeStoredFile(companyId, validated.storedName);
    throw err;
  }
}

/** Bokför kvittot (automatkontering). Dubbelbokningsspärr via source. */
export async function bookReceipt(
  client: PoolClient, companyId: string, userId: string, id: string, fiscalYearId?: string,
): Promise<Record<string, unknown>> {
  const receipt = await getReceipt(client, companyId, id);
  if (receipt.voucher_id) throw new ConflictError('already_booked', 'kvittot är redan bokfört');
  if (receipt.status === 'cancelled') throw new ConflictError('cancelled', 'ett annullerat kvitto kan inte bokföras');

  const fyId = fiscalYearId ?? (await resolveFiscalYearForDate(client, companyId, receipt.receipt_date as string)).id;
  const voucher = await postExpense(client, companyId, userId, {
    fiscalYearId: fyId,
    voucherDate: receipt.receipt_date as string,
    sourceId: id,
    description: `Kvitto ${receipt.receipt_number}`,
    sourceType: 'receipt',
    paymentAccount: receipt.payment_account as number,
    lines: [{ netOre: receipt.net_ore as number, vatRate: receipt.vat_rate as VatRate, account: receipt.expense_account as number }],
  });

  await client.query(
    "UPDATE receipts SET voucher_id = $1, status = 'booked' WHERE id = $2 AND company_id = $3",
    [voucher.id, id, companyId],
  );
  await writeAudit(client, { companyId, userId, action: 'receipt.booked', entityType: 'receipt', entityId: id, details: { voucher_id: voucher.id } });
  return getReceipt(client, companyId, id);
}
