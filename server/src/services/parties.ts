import type { PoolClient } from 'pg';
import { ConflictError, NotFoundError } from '../lib/errors.js';
import { buildAllowlistedUpdate } from '../lib/updateBuilder.js';
import { writeAudit } from './auditService.js';
import { assertKanAktiveras } from './gdpr.js';
import { nextDocumentNumber } from './accounting/numbering.js';

// Kund, leverantör och artikel delar mönster. company_id kommer alltid från
// förtroendegränsen; kolumnnamn i UPDATE byggs via allowlist (aldrig från indata).

// ---- Kunder ----
const CUSTOMER_SEQUENCE = 'customer';
const CUSTOMER_COLUMNS = `id, customer_number, name, org_number, vat_number, email, phone,
  address, postal_code, city, payment_terms, is_active, created_at`;
const CUSTOMER_UPDATE = {
  customer_number: 'customer_number',
  name: 'name', org_number: 'org_number', vat_number: 'vat_number', email: 'email', phone: 'phone',
  address: 'address', postal_code: 'postal_code', city: 'city',
  payment_terms: 'payment_terms', is_active: 'is_active',
} as const;

export async function createCustomer(
  client: PoolClient, companyId: string, userId: string, input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const number = await nextDocumentNumber(client, companyId, CUSTOMER_SEQUENCE);
  const result = await client.query(
    `INSERT INTO customers (company_id, customer_number, name, org_number, vat_number, email, phone,
        address, postal_code, city, payment_terms)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING ${CUSTOMER_COLUMNS}`,
    [companyId, number, input.name, input.org_number ?? null, input.vat_number ?? null, input.email ?? null,
      input.phone ?? null, input.address ?? null, input.postal_code ?? null,
      input.city ?? null, input.payment_terms ?? null],
  );
  const row = result.rows[0]!;
  await writeAudit(client, { companyId, userId, action: 'customer.created', entityType: 'customer', entityId: row.id });
  return row;
}

export async function listCustomers(
  client: PoolClient, companyId: string, opts: { includeInactive?: boolean } = {},
): Promise<Record<string, unknown>[]> {
  // Standardlistning visar AKTIVA poster (regression mot den gamla is_active-buggen
  // där utelämnad parameter gav bara INAKTIVA).
  const result = await client.query(
    `SELECT ${CUSTOMER_COLUMNS} FROM customers
     WHERE company_id = $1 AND ($2 OR is_active) ORDER BY customer_number`,
    [companyId, opts.includeInactive ?? false],
  );
  return result.rows;
}

export async function getCustomer(client: PoolClient, companyId: string, id: string): Promise<Record<string, unknown>> {
  const result = await client.query(`SELECT ${CUSTOMER_COLUMNS} FROM customers WHERE id=$1 AND company_id=$2`, [id, companyId]);
  if (!result.rows[0]) throw new NotFoundError('customer');
  return result.rows[0];
}

/** Skapa raden först: ett radlås på en saknad serie skyddar ingenting. */
async function lockCustomerSequence(client: PoolClient, companyId: string): Promise<number> {
  await client.query(
    `INSERT INTO number_sequences (company_id, kind, next_value) VALUES ($1, $2, 1)
     ON CONFLICT (company_id, kind) DO NOTHING`,
    [companyId, CUSTOMER_SEQUENCE],
  );
  const result = await client.query<{ next_value: number }>(
    'SELECT next_value FROM number_sequences WHERE company_id = $1 AND kind = $2 FOR UPDATE',
    [companyId, CUSTOMER_SEQUENCE],
  );
  return result.rows[0]!.next_value;
}

export async function updateCustomer(
  client: PoolClient, companyId: string, userId: string, id: string, input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  // En kund som raderats enligt GDPR aktiveras inte igen (crmsfar3, A).
  await assertKanAktiveras(client, companyId, 'customer', id, input);
  const update = buildAllowlistedUpdate(CUSTOMER_UPDATE, input);
  if (!update) return getCustomer(client, companyId, id);
  const customerNumber = typeof input.customer_number === 'number' ? input.customer_number : undefined;
  let previousNext: number | undefined;
  if (customerNumber !== undefined) {
    // Samma lås som skapandet, före kundens UPDATE, undviker omvänd låsordning.
    previousNext = await lockCustomerSequence(client, companyId);
    const taken = await client.query(
      'SELECT 1 FROM customers WHERE company_id = $1 AND customer_number = $2 AND id <> $3 LIMIT 1',
      [companyId, customerNumber, id],
    );
    if (taken.rows[0]) {
      throw new ConflictError('customer_number_taken',
        `Kundnummer ${customerNumber} används redan av en annan kund i bolaget. Inget sparades.`);
    }
  }
  const result = await client.query(
    `UPDATE customers SET ${update.setSql} WHERE id=$${update.values.length + 1} AND company_id=$${update.values.length + 2}
     RETURNING ${CUSTOMER_COLUMNS}`,
    [...update.values, id, companyId],
  );
  if (!result.rows[0]) throw new NotFoundError('customer');
  if (customerNumber !== undefined && previousNext !== undefined && previousNext <= customerNumber) {
    await client.query(
      'UPDATE number_sequences SET next_value = $3 WHERE company_id = $1 AND kind = $2',
      [companyId, CUSTOMER_SEQUENCE, customerNumber + 1],
    );
    await writeAudit(client, {
      companyId, userId, action: 'customer.number_series_set', entityType: 'company', entityId: companyId,
      details: { from_next_value: previousNext, to_next_value: customerNumber + 1,
        customer_id: id, customer_number: customerNumber },
    });
  }
  await writeAudit(client, { companyId, userId, action: 'customer.updated', entityType: 'customer', entityId: id, details: { fields: Object.keys(input) } });
  return result.rows[0];
}

// ---- Leverantörer ----
const SUPPLIER_COLUMNS = `id, supplier_number, name, org_number, email, phone, bankgiro, plusgiro, is_active, created_at`;
const SUPPLIER_UPDATE = {
  name: 'name', org_number: 'org_number', email: 'email', phone: 'phone',
  bankgiro: 'bankgiro', plusgiro: 'plusgiro', is_active: 'is_active',
} as const;

export async function createSupplier(
  client: PoolClient, companyId: string, userId: string, input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const number = await nextDocumentNumber(client, companyId, 'supplier');
  const result = await client.query(
    `INSERT INTO suppliers (company_id, supplier_number, name, org_number, email, phone, bankgiro, plusgiro)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING ${SUPPLIER_COLUMNS}`,
    [companyId, number, input.name, input.org_number ?? null, input.email ?? null,
      input.phone ?? null, input.bankgiro ?? null, input.plusgiro ?? null],
  );
  const row = result.rows[0]!;
  await writeAudit(client, { companyId, userId, action: 'supplier.created', entityType: 'supplier', entityId: row.id });
  return row;
}

export async function listSuppliers(
  client: PoolClient, companyId: string, opts: { includeInactive?: boolean } = {},
): Promise<Record<string, unknown>[]> {
  const result = await client.query(
    `SELECT ${SUPPLIER_COLUMNS} FROM suppliers WHERE company_id=$1 AND ($2 OR is_active) ORDER BY supplier_number`,
    [companyId, opts.includeInactive ?? false],
  );
  return result.rows;
}

export async function getSupplier(client: PoolClient, companyId: string, id: string): Promise<Record<string, unknown>> {
  const result = await client.query(`SELECT ${SUPPLIER_COLUMNS} FROM suppliers WHERE id=$1 AND company_id=$2`, [id, companyId]);
  if (!result.rows[0]) throw new NotFoundError('supplier');
  return result.rows[0];
}

export async function updateSupplier(
  client: PoolClient, companyId: string, userId: string, id: string, input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  // Samma regel som för kunden: en raderad leverantör aktiveras inte igen.
  await assertKanAktiveras(client, companyId, 'supplier', id, input);
  const update = buildAllowlistedUpdate(SUPPLIER_UPDATE, input);
  if (!update) return getSupplier(client, companyId, id);
  const result = await client.query(
    `UPDATE suppliers SET ${update.setSql} WHERE id=$${update.values.length + 1} AND company_id=$${update.values.length + 2}
     RETURNING ${SUPPLIER_COLUMNS}`,
    [...update.values, id, companyId],
  );
  if (!result.rows[0]) throw new NotFoundError('supplier');
  await writeAudit(client, { companyId, userId, action: 'supplier.updated', entityType: 'supplier', entityId: id, details: { fields: Object.keys(input) } });
  return result.rows[0];
}

// ---- Artiklar ----
const ARTICLE_COLUMNS = `id, article_number, name, unit, unit_price_ore, vat_rate, revenue_account, is_active, created_at`;
const ARTICLE_UPDATE = {
  name: 'name', unit: 'unit', unit_price_ore: 'unit_price_ore', vat_rate: 'vat_rate',
  revenue_account: 'revenue_account', is_active: 'is_active',
} as const;

export async function createArticle(
  client: PoolClient, companyId: string, userId: string, input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  let row;
  try {
    const result = await client.query(
      `INSERT INTO articles (company_id, article_number, name, unit, unit_price_ore, vat_rate, revenue_account)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING ${ARTICLE_COLUMNS}`,
      [companyId, input.article_number, input.name, input.unit ?? 'st',
        input.unit_price_ore ?? 0, input.vat_rate ?? 25, input.revenue_account ?? 3001],
    );
    row = result.rows[0]!;
  } catch (err) {
    if ((err as { code?: string }).code === '23505') throw new ConflictError('article_exists', 'artikelnumret används redan');
    throw err;
  }
  await writeAudit(client, { companyId, userId, action: 'article.created', entityType: 'article', entityId: row.id });
  return row;
}

export async function listArticles(
  client: PoolClient, companyId: string, opts: { includeInactive?: boolean } = {},
): Promise<Record<string, unknown>[]> {
  const result = await client.query(
    `SELECT ${ARTICLE_COLUMNS} FROM articles WHERE company_id=$1 AND ($2 OR is_active) ORDER BY article_number`,
    [companyId, opts.includeInactive ?? false],
  );
  return result.rows;
}

export async function getArticle(client: PoolClient, companyId: string, id: string): Promise<Record<string, unknown>> {
  const result = await client.query(`SELECT ${ARTICLE_COLUMNS} FROM articles WHERE id=$1 AND company_id=$2`, [id, companyId]);
  if (!result.rows[0]) throw new NotFoundError('article');
  return result.rows[0];
}

export async function updateArticle(
  client: PoolClient, companyId: string, userId: string, id: string, input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const update = buildAllowlistedUpdate(ARTICLE_UPDATE, input);
  if (!update) return getArticle(client, companyId, id);
  const result = await client.query(
    `UPDATE articles SET ${update.setSql} WHERE id=$${update.values.length + 1} AND company_id=$${update.values.length + 2}
     RETURNING ${ARTICLE_COLUMNS}`,
    [...update.values, id, companyId],
  );
  if (!result.rows[0]) throw new NotFoundError('article');
  await writeAudit(client, { companyId, userId, action: 'article.updated', entityType: 'article', entityId: id, details: { fields: Object.keys(input) } });
  return result.rows[0];
}
