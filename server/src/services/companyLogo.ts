// Bolagets logotyp (visas uppe till höger på faktura-PDF:en enligt Locollabs
// mall) och bolagsuppgifterna som mallen behöver. Bilden lagras i dokument-
// arkivet (files) med samma validering som all uppladdning; companies.
// logo_file_id pekar på filen via en tenant-säker komposit-FK (migration
// 0045) — den KAN inte peka på ett annat bolags fil.
import type { PoolClient } from 'pg';
import { BadRequestError } from '../lib/errors.js';
import { buildAllowlistedUpdate } from '../lib/updateBuilder.js';
import { writeAudit } from './auditService.js';
import { removeStoredFile, validateUpload, writeStoredFile } from './fileStorage.js';

// Bolagsuppgifterna som faktura-PDF:en använder — sättbara via action-lagret
// (MCP) så att de kan underhållas konversationellt, inte bara via REST-PATCH.
// Namn/org.nr ingår MEDVETET inte (identitetsändringar går via API:t/vyn).
const SETTINGS_COLUMNS = {
  address: 'address', postal_code: 'postal_code', city: 'city',
  email: 'email', phone: 'phone', vat_number: 'vat_number',
  bankgiro: 'bankgiro', plusgiro: 'plusgiro', bank_account: 'bank_account',
  iban: 'iban', bic: 'bic', website: 'website',
} as const;

export interface CompanySettingsInput {
  address?: string; postal_code?: string; city?: string;
  email?: string; phone?: string; vat_number?: string;
  bankgiro?: string; plusgiro?: string; bank_account?: string;
  iban?: string; bic?: string; website?: string;
}

export async function updateCompanySettings(
  client: PoolClient, companyId: string, userId: string, input: CompanySettingsInput,
): Promise<Record<string, unknown>> {
  const update = buildAllowlistedUpdate(SETTINGS_COLUMNS, input as Record<string, unknown>);
  if (!update) throw new BadRequestError('empty_update', 'inga fält att uppdatera');
  await client.query(
    `UPDATE companies SET ${update.setSql} WHERE id = $${update.values.length + 1}`,
    [...update.values, companyId],
  );
  await writeAudit(client, {
    companyId, userId, action: 'company.updated', entityType: 'company', entityId: companyId,
    details: { fields: Object.keys(input), via: 'action' },
  });
  const row = await client.query(
    `SELECT name, org_number, address, postal_code, city, email, phone, vat_number,
            bankgiro, plusgiro, bank_account, iban, bic, website, approved_for_f_tax
     FROM companies WHERE id = $1`,
    [companyId],
  );
  return row.rows[0] as Record<string, unknown>;
}

export async function setCompanyLogo(
  client: PoolClient, companyId: string, userId: string,
  input: { filename: string; contentBase64: string },
): Promise<{ logo_file_id: string; filename: string; size_bytes: number }> {
  const buffer = Buffer.from(input.contentBase64, 'base64');
  if (buffer.length === 0) throw new BadRequestError('empty_file', 'filen är tom');
  const validated = validateUpload(input.filename, buffer);
  // PDF:er är giltiga bilagor men ingen logotyp — pdfkit bäddar in PNG/JPEG.
  if (!validated.mimeType.startsWith('image/')) {
    throw new BadRequestError('logo_must_be_image', 'logotypen måste vara en bild (png/jpg)');
  }

  await writeStoredFile(companyId, validated.storedName, buffer);
  try {
    const file = await client.query<{ id: string }>(
      `INSERT INTO files (company_id, original_name, stored_name, mime_type, size_bytes, sha256, uploaded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [companyId, input.filename, validated.storedName, validated.mimeType, buffer.length, validated.sha256, userId],
    );
    const fileId = file.rows[0]!.id;
    await client.query('UPDATE companies SET logo_file_id = $1 WHERE id = $2', [fileId, companyId]);
    await writeAudit(client, {
      companyId, userId, action: 'company.logo_set', entityType: 'company', entityId: companyId,
      details: { file_id: fileId, filename: input.filename, size_bytes: buffer.length },
    });
    return { logo_file_id: fileId, filename: input.filename, size_bytes: buffer.length };
  } catch (err) {
    await removeStoredFile(companyId, validated.storedName);
    throw err;
  }
}
