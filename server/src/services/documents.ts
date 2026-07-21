// K3: generell dokumentkoppling. En fil (dokumentarkivet) kopplas till en
// registerpost — lönebesked, faktura, kvitto, leverantörsfaktura eller
// verifikat. attach_document tar filinnehållet som base64 så en agent kan
// bilägga underlag via enbart action-lagret; samma validering (ändelse +
// magic bytes, UUID-lagringsnamn) som vanlig uppladdning. Posten som kopplas
// måste finnas i bolaget — entitetskontrollen görs server-side.
import { readFile } from 'node:fs/promises';
import type { PoolClient } from 'pg';
import { BadRequestError, NotFoundError } from '../lib/errors.js';
import { writeAudit } from './auditService.js';
import { removeStoredFile, resolveStoredPath, validateUpload, writeStoredFile } from './fileStorage.js';

export type DocumentEntityType = 'payslip' | 'invoice' | 'receipt' | 'supplier_invoice' | 'voucher';

// Allowlist: entitetstyp → tabell. Aldrig tabellnamn från indata.
const ENTITY_TABLES: Record<DocumentEntityType, string> = {
  payslip: 'payslips',
  invoice: 'invoices',
  receipt: 'receipts',
  supplier_invoice: 'supplier_invoices',
  voucher: 'vouchers',
};

export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024; // 10 MB — samma som uppladdningsgränsen

async function assertEntityExists(
  client: PoolClient, companyId: string, entityType: DocumentEntityType, entityId: string,
): Promise<void> {
  const table = ENTITY_TABLES[entityType];
  if (!table) throw new BadRequestError('invalid_entity_type');
  const r = await client.query(`SELECT 1 FROM ${table} WHERE id = $1 AND company_id = $2`, [entityId, companyId]);
  if (!r.rows[0]) throw new NotFoundError(entityType);
}

export interface AttachedDocument {
  id: string;
  entity_type: DocumentEntityType;
  entity_id: string;
  title: string | null;
  file_id: string;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  sha256: string;
  created_at: string;
}

/** Kopplar en redan lagrad fil (files.id) till en registerpost. */
export async function linkDocument(
  client: PoolClient, companyId: string, userId: string,
  input: { fileId: string; entityType: DocumentEntityType; entityId: string; title?: string },
): Promise<AttachedDocument> {
  await assertEntityExists(client, companyId, input.entityType, input.entityId);
  const file = await client.query('SELECT 1 FROM files WHERE id = $1 AND company_id = $2', [input.fileId, companyId]);
  if (!file.rows[0]) throw new NotFoundError('file');
  // Idempotent: samma fil mot samma post är ingen ny koppling (rollen app har
  // bara SELECT/INSERT på documents, därför DO NOTHING + återläsning).
  const r = await client.query<{ id: string }>(
    `INSERT INTO documents (company_id, file_id, entity_type, entity_id, title, created_by)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT ON CONSTRAINT documents_link_uk DO NOTHING
     RETURNING id`,
    [companyId, input.fileId, input.entityType, input.entityId, input.title ?? null, userId],
  );
  const id = r.rows[0]?.id ?? (await client.query<{ id: string }>(
    'SELECT id FROM documents WHERE company_id = $1 AND file_id = $2 AND entity_type = $3 AND entity_id = $4',
    [companyId, input.fileId, input.entityType, input.entityId],
  )).rows[0]!.id;
  await writeAudit(client, {
    companyId, userId, action: 'document.attached', entityType: input.entityType, entityId: input.entityId,
    details: { document_id: id, file_id: input.fileId, title: input.title ?? null },
  });
  return getDocument(client, companyId, id);
}

/**
 * Tar emot filinnehåll (base64), validerar och lagrar det i dokumentarkivet och
 * kopplar det till en registerpost — i EN transaktion (disk städas vid fel).
 */
export async function attachDocument(
  client: PoolClient, companyId: string, userId: string,
  input: { entityType: DocumentEntityType; entityId: string; filename: string; contentBase64: string; title?: string },
): Promise<AttachedDocument> {
  await assertEntityExists(client, companyId, input.entityType, input.entityId);
  let buffer: Buffer;
  try {
    buffer = Buffer.from(input.contentBase64, 'base64');
  } catch {
    throw new BadRequestError('invalid_content', 'content_base64 är inte giltig base64');
  }
  if (buffer.length === 0) throw new BadRequestError('invalid_content', 'tomt filinnehåll');
  if (buffer.length > MAX_DOCUMENT_BYTES) {
    throw new BadRequestError('too_large', `filen överstiger ${MAX_DOCUMENT_BYTES} byte`);
  }
  const validated = validateUpload(input.filename, buffer);
  await writeStoredFile(companyId, validated.storedName, buffer);
  try {
    const file = await client.query<{ id: string }>(
      `INSERT INTO files (company_id, original_name, stored_name, mime_type, size_bytes, sha256, uploaded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [companyId, input.filename, validated.storedName, validated.mimeType, buffer.length, validated.sha256, userId],
    );
    return await linkDocument(client, companyId, userId, {
      fileId: file.rows[0]!.id, entityType: input.entityType, entityId: input.entityId, title: input.title,
    });
  } catch (err) {
    // Transaktionen rullas tillbaka av anroparen — städa diskfilen så den inte
    // blir föräldralös.
    await removeStoredFile(companyId, validated.storedName);
    throw err;
  }
}

export async function listDocuments(
  client: PoolClient, companyId: string,
  opts: { entityType?: DocumentEntityType; entityId?: string } = {},
): Promise<AttachedDocument[]> {
  const r = await client.query<AttachedDocument>(
    `SELECT d.id, d.entity_type, d.entity_id, d.title, d.file_id,
            f.original_name, f.mime_type, f.size_bytes, f.sha256, d.created_at::text
     FROM documents d JOIN files f ON f.id = d.file_id
     WHERE d.company_id = $1
       AND ($2::text IS NULL OR d.entity_type = $2)
       AND ($3::uuid IS NULL OR d.entity_id = $3)
     ORDER BY d.created_at DESC
     LIMIT 500`,
    [companyId, opts.entityType ?? null, opts.entityId ?? null],
  );
  return r.rows;
}

export async function getDocument(
  client: PoolClient, companyId: string, documentId: string, opts: { includeContent?: boolean } = {},
): Promise<AttachedDocument & { content_base64?: string }> {
  const r = await client.query<AttachedDocument & { stored_name: string }>(
    `SELECT d.id, d.entity_type, d.entity_id, d.title, d.file_id,
            f.original_name, f.mime_type, f.size_bytes, f.sha256, f.stored_name, d.created_at::text
     FROM documents d JOIN files f ON f.id = d.file_id
     WHERE d.id = $1 AND d.company_id = $2`,
    [documentId, companyId],
  );
  const row = r.rows[0];
  if (!row) throw new NotFoundError('document');
  const { stored_name, ...doc } = row;
  if (!opts.includeContent) return doc;
  const content = await readFile(resolveStoredPath(companyId, stored_name));
  return { ...doc, content_base64: content.toString('base64') };
}
