import { createHash, randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { BadRequestError } from '../lib/errors.js';

// Tillåtna filtyper. Ändelsen valideras mot allowlist OCH innehållets magic
// bytes måste matcha — en .png som inte är en PNG avvisas.
const isJpeg = (b: Buffer): boolean => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;

// Object.create(null): ingen prototypkedja, så en fil döpt "x.constructor" inte
// kan slå upp Object.prototype.constructor och råka passera magic-kontrollen.
const MAGIC_CHECKS: Record<string, (buf: Buffer) => boolean> = Object.assign(Object.create(null), {
  pdf: (b: Buffer) => b.subarray(0, 5).toString('latin1') === '%PDF-',
  png: (b: Buffer) =>
    b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  jpg: isJpeg,
  jpeg: isJpeg,
});

// HEIC (iPhone-kvittot) är en ISO-BMFF-container: bytes 4–8 är 'ftyp' och
// varumärket därefter säger vilken sort. Listan är de varumärken som betyder
// HEIF-bild — 'mif1'/'msf1' ingår eftersom iOS skriver dem för enkel- och
// sekvensbilder.
const HEIC_VARUMARKEN = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1']);
const isHeic = (b: Buffer): boolean =>
  b.length >= 12 &&
  b.subarray(4, 8).toString('latin1') === 'ftyp' &&
  HEIC_VARUMARKEN.has(b.subarray(8, 12).toString('latin1'));

/**
 * Magic-kontroll nycklad på MIME-TYP — för vägar som får typen ur en begäran
 * i stället för ur ett filnamn (kvittobilagornas signerade PUT, 0075). Samma
 * primitiver som ändelse-allowlisten ovan, så de kan aldrig drifta isär.
 *
 * `image/heic` finns ENBART här: multipart-vägens ändelse-allowlist är
 * oförändrad och släpper fortfarande bara in pdf/png/jpg.
 */
const MAGIC_PER_MIME: Record<string, (buf: Buffer) => boolean> = Object.assign(Object.create(null), {
  'application/pdf': MAGIC_CHECKS.pdf!,
  'image/png': MAGIC_CHECKS.png!,
  'image/jpeg': isJpeg,
  'image/heic': isHeic,
});

/** Matchar innehållets magic bytes den uppgivna MIME-typen? Okänd typ = nej. */
export function matcharMagicBytes(mimeType: string, buffer: Buffer): boolean {
  const kontroll = MAGIC_PER_MIME[mimeType];
  return kontroll ? kontroll(buffer) : false;
}

const CANONICAL_EXT: Record<string, string> = Object.assign(Object.create(null), { jpeg: 'jpg' });
const MIME_BY_EXT: Record<string, string> = Object.assign(Object.create(null), {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
});

// UUID-källa; STORED_NAME_PATTERN återanvänder den så mönstren aldrig kan drifta
// isär, och den speglar CHECK-villkoret på files.stored_name i migration 0004.
const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const STORED_NAME_PATTERN = new RegExp(`^${UUID_SOURCE}\\.[a-z0-9]{1,10}$`);
const UUID_PATTERN = new RegExp(`^${UUID_SOURCE}$`);

export function uploadRoot(): string {
  return path.resolve(config.UPLOAD_DIR);
}

/**
 * Bygger den absoluta sökvägen för en lagrad fil och bevisar att den ligger
 * kvar under uppladdningsroten. Både companyId och storedName valideras mot
 * strikta mönster INNAN de joinas — och containment-kollen är sista spärren.
 */
export function resolveStoredPath(companyId: string, storedName: string): string {
  const normalizedCompany = companyId.toLowerCase();
  if (!UUID_PATTERN.test(normalizedCompany)) {
    throw new BadRequestError('invalid_file', 'ogiltigt bolags-id');
  }
  if (!STORED_NAME_PATTERN.test(storedName)) {
    throw new BadRequestError('invalid_file', 'ogiltigt lagrat filnamn');
  }
  const root = uploadRoot();
  const full = path.resolve(root, normalizedCompany, storedName);
  if (!full.startsWith(root + path.sep)) {
    throw new BadRequestError('invalid_file', 'sökväg utanför uppladdningskatalogen');
  }
  return full;
}

export interface ValidatedUpload {
  storedName: string;
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
