// Bolagets logotyp (visas uppe till höger på faktura-PDF:en enligt Locollabs
// mall) och bolagsuppgifterna som mallen behöver. Bilden lagras i dokument-
// arkivet (files) med samma validering som all uppladdning; companies.
// logo_file_id pekar på filen via en tenant-säker komposit-FK (migration
// 0045) — den KAN inte peka på ett annat bolags fil.
import { inflateSync } from 'node:zlib';
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
  // Sidfotens "Godkänd för F-skatt" styrs härifrån. Fältet saknades tidigare i
  // action-lagret, så det gick bara att sätta direkt i databasen.
  approved_for_f_tax: 'approved_for_f_tax',
} as const;

export interface CompanySettingsInput {
  address?: string; postal_code?: string; city?: string;
  email?: string; phone?: string; vat_number?: string;
  bankgiro?: string; plusgiro?: string; bank_account?: string;
  iban?: string; bic?: string; website?: string;
  approved_for_f_tax?: boolean;
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

/**
 * Avvisar PNG-filer som pdfkit inte kan bädda in.
 *
 * Bakgrund (2026-09-01): en palett-PNG med transparens sattes som logotyp.
 * pdfkit avkodar PNG med png-js, som inte klarade strömmen och kastade
 * `Z_DATA_ERROR: invalid distance too far back` från zlib — ASYNKRONT, ur en
 * callback. try/catch runt doc.image() fångar därför ingenting: felet blev ett
 * ohanterat undantag som dödade hela node-processen. Varje försök att generera
 * en faktura gav 502 och en omstart av tjänsten.
 *
 * Slutsatsen är att kontrollen måste ske vid UPPLADDNING, där felet går att
 * fånga synkront, inte vid rendering. Här görs tre saker:
 *   1. interlacade PNG:er avvisas (png-js stöder inte Adam7),
 *   2. palett-PNG med tRNS avvisas (exakt kombinationen som kraschade —
 *      pdfkit går då via png-js asynkrona avkodning av alfakanalen),
 *   3. IDAT-strömmen provdekomprimeras med inflateSync, vilket fångar samma
 *      trasiga zlib-ström som annars smäller under rendering.
 * JPEG passerar orört: pdfkit läser JPEG direkt utan png-js.
 */
export function assertRenderableImage(filename: string, mimeType: string, buffer: Buffer): void {
  if (mimeType !== 'image/png') return;

  const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buffer.length < 8 || !buffer.subarray(0, 8).equals(SIGNATURE)) {
    throw new BadRequestError('logo_not_png', 'filen har PNG-ändelse men saknar PNG-signatur');
  }

  let colorType: number | null = null;
  let interlace: number | null = null;
  let hasTrns = false;
  const idat: Buffer[] = [];

  let pos = 8;
  while (pos + 8 <= buffer.length) {
    const len = buffer.readUInt32BE(pos);
    const type = buffer.subarray(pos + 4, pos + 8).toString('latin1');
    const dataStart = pos + 8;
    if (dataStart + len > buffer.length) {
      throw new BadRequestError('logo_png_truncated', 'PNG-filen är trunkerad — chunk sträcker sig utanför filen');
    }
    if (type === 'IHDR') {
      colorType = buffer[dataStart + 9] ?? null;
      interlace = buffer[dataStart + 12] ?? null;
    } else if (type === 'tRNS') {
      hasTrns = true;
    } else if (type === 'IDAT') {
      idat.push(buffer.subarray(dataStart, dataStart + len));
    } else if (type === 'IEND') {
      break;
    }
    pos = dataStart + len + 4; // + CRC
  }

  if (colorType === null) {
    throw new BadRequestError('logo_png_no_ihdr', 'PNG-filen saknar IHDR — den går inte att tolka');
  }
  if (interlace !== 0) {
    throw new BadRequestError(
      'logo_png_interlaced',
      'interlacad PNG stöds inte av PDF-motorn — spara om utan interlace, eller använd JPEG',
    );
  }
  if (colorType === 3 && hasTrns) {
    throw new BadRequestError(
      'logo_png_palette_alpha',
      'palett-PNG med transparens kraschar PDF-motorn — spara om som JPEG eller som PNG utan palett (RGB/RGBA)',
    );
  }
  if (idat.length === 0) {
    throw new BadRequestError('logo_png_no_idat', 'PNG-filen saknar bilddata (IDAT)');
  }
  try {
    inflateSync(Buffer.concat(idat));
  } catch {
    throw new BadRequestError(
      'logo_png_undecodable',
      `bilddatan i ${filename} går inte att packa upp — PDF-motorn skulle krascha på den. Spara om filen, gärna som JPEG`,
    );
  }
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
  // Avvisa bilder som PDF-motorn inte klarar — INNAN de sparas och blir aktiv
  // logotyp. En trasig bild får aldrig nå renderingen (se funktionens kommentar).
  assertRenderableImage(input.filename, validated.mimeType, buffer);

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
