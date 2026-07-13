import { createHash, randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { BadRequestError } from '../lib/errors.js';

// Tillåtna filtyper. Ändelsen valideras mot allowlist OCH innehållets magic
// bytes måste matcha — en .png som inte är en PNG avvisas.
const MAGIC_CHECKS: Readonly<Record<string, (buf: Buffer) => boolean>> = {
  pdf: (b) => b.subarray(0, 5).toString('latin1') === '%PDF-',
  png: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  jpg: (b) => b.length > 2 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  jpeg: (b) => b.length > 2 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
};

const CANONICAL_EXT: Readonly<Record<string, string>> = { jpeg: 'jpg' };
const MIME_BY_EXT: Readonly<Record<string, string>> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
};

// Måste matcha CHECK-villkoret på files.stored_name i migration 0004.
const STORED_NAME_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{1,10}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function uploadRoot(): string {
  return path.resolve(config.UPLOAD_DIR);
}

/**
 * Bygger den absoluta sökvägen för en lagrad fil och bevisar att den ligger
 * kvar under uppladdningsroten. Både companyId och storedName valideras mot
 * strikta mönster INNAN de joinas — och containment-kollen är sista spärren.
 */
export function resolveStoredPath(companyId: string, storedName: string): string {
  if (!UUID_PATTERN.test(companyId)) {
    throw new BadRequestError('invalid_file', 'ogiltigt bolags-id');
  }
  if (!STORED_NAME_PATTERN.test(storedName)) {
    throw new BadRequestError('invalid_file', 'ogiltigt lagrat filnamn');
  }
  const root = uploadRoot();
  const full = path.resolve(root, companyId, storedName);
  if (!full.startsWith(root + path.sep)) {
    throw new BadRequestError('invalid_file', 'sökväg utanför uppladdningskatalogen');
  }
  return full;
}

export interface ValidatedUpload {
  storedName: string;
  extension: string;
  mimeType: string;
  sha256: string;
}

/**
 * Validerar en uppladdning och genererar ett UUID-baserat lagringsnamn.
 * Användarens filnamn används ALDRIG i sökvägen — bara som metadata i databasen.
 */
export function validateUpload(originalName: string, buffer: Buffer): ValidatedUpload {
  const rawExt = path.extname(originalName).slice(1).toLowerCase();
  const check = MAGIC_CHECKS[rawExt];
  if (!check) {
    throw new BadRequestError(
      'invalid_file',
      `filtypen tillåts inte (tillåtna: ${Object.keys(MAGIC_CHECKS).join(', ')})`,
    );
  }
  if (!check(buffer)) {
    throw new BadRequestError('invalid_file', 'filens innehåll matchar inte filändelsen');
  }
  const extension = CANONICAL_EXT[rawExt] ?? rawExt;
  const mime = MIME_BY_EXT[extension];
  if (!mime) throw new BadRequestError('invalid_file');
  return {
    storedName: `${randomUUID()}.${extension}`,
    extension,
    mimeType: mime,
    sha256: createHash('sha256').update(buffer).digest('hex'),
  };
}

export async function writeStoredFile(
  companyId: string,
  storedName: string,
  buffer: Buffer,
): Promise<string> {
  const fullPath = resolveStoredPath(companyId, storedName);
  await mkdir(path.dirname(fullPath), { recursive: true });
  await writeFile(fullPath, buffer, { flag: 'wx' }); // wx: vägra skriva över
  return fullPath;
}

export async function removeStoredFile(companyId: string, storedName: string): Promise<void> {
  try {
    await unlink(resolveStoredPath(companyId, storedName));
  } catch {
    // städning vid rollback — får inte dölja ursprungsfelet
  }
}

/** Content-Disposition-säkert filnamn: inga citattecken, kontrolltecken eller sökvägsdelar. */
export function sanitizeDownloadName(name: string): string {
  const base = path.basename(name).replace(/[^\p{L}\p{N} ._-]/gu, '_');
  return base.length > 0 ? base.slice(0, 128) : 'fil';
}
