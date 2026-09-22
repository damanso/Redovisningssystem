// Kvittobilagor (beslut #178): trestegsvägen in för originalkvittot.
//
//   1. create_receipt_upload_url  → rad i `receipt_files` + signerad engångs-PUT
//   2. PUT <upload_url>           → rå bytes, UTANFÖR MCP, utan JWT
//   3. confirm_receipt_file       → objektet hashas och raden aktiveras
//
// Poängen med uppdelningen: en kvittobild från en telefon är ~1,3 MB, alltså
// ~1,7 miljoner tecken som base64. Det ryms inte i ett verktygsargument. Bara
// metadata går genom MCP; bytesen går direkt till API:t.
//
// Behörigheten i steg 2 är HMAC-signaturen, inte ett JWT — men tenant-kontexten
// sätts ändå (bolag och användare ligger under signaturen), så RLS prövas på
// exakt samma sätt som för varje annan skrivning i systemet.
import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { withTenantTransaction } from '../db/tx.js';
import { signeraBilagelank, type SignaturInnehall } from '../lib/bilagesignatur.js';
import { BadRequestError, ConflictError, NotFoundError } from '../lib/errors.js';
import { writeAudit } from './auditService.js';
import { matcharMagicBytes } from './fileStorage.js';
import { nyLagringsnyckel, objektlagring } from './objektlagring.js';

// Tak och typer ur kravbilden. Skilt från MAX_UPLOAD_BYTES (multipart-vägens
// gräns) därför att det här är en annan väg med en annan gräns.
export const MAX_BILAGA_BYTES = 25 * 1024 * 1024;
export const TILLATNA_BILAGE_MIME = ['image/jpeg', 'image/png', 'image/heic', 'application/pdf'] as const;
export type BilageMime = (typeof TILLATNA_BILAGE_MIME)[number];
// Object.create(null): ingen prototypkedja, så en mime-sträng som "constructor"
// aldrig kan slå upp något ur Object.prototype (samma hygien som fileStorage.ts).
const ANDELSE_PER_MIME: Record<string, string> = Object.assign(Object.create(null), {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/heic': 'heic',
  'application/pdf': 'pdf',
});

// 15 minuter för uppladdningen (kravbilden), 5 för nedladdningen: en läslänk
// ska räcka för att öppna bilden, inte för att spridas vidare.
const UPPLADDNING_TTL_SEK = 15 * 60;
const NEDLADDNING_TTL_SEK = 5 * 60;

const BILAGE_KOLUMNER = `id, receipt_id, filename, mime_type, size_bytes, sha256, status,
  uploaded_at, uploaded_by, superseded_by, created_at`;

interface BilageRad {
  id: string;
  receipt_id: string;
  company_id: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  sha256: string | null;
  storage_key: string;
  status: 'awaiting_upload' | 'uploaded' | 'active';
  uploaded_at: string | null;
  uploaded_by: string;
  superseded_by: string | null;
}

export interface SkapaUppladdningsLankInput {
  receipt_id: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
}

/**
 * Lat städning av påbörjade men aldrig bekräftade uppladdningar: raden OCH
 * objektet. Redovisningen har ingen scheduler (se docs/ARKITEKTUR.md) — därför
 * städar tjänsten i sina egna anrop i stället för i en cron som inte finns.
 *
 * DELETE-policyn i 0075 är den hårda garantin: en AKTIV bilaga på ett bokfört
 * kvitto kan den här frågan aldrig träffa.
 */
async function stadaObekraftade(client: PoolClient, companyId: string): Promise<number> {
  const utgangna = await client.query<{ id: string; storage_key: string }>(
    `DELETE FROM receipt_files
      WHERE company_id = $1
        AND status <> 'active'
        AND created_at < now() - make_interval(secs => $2::int)
      RETURNING id, storage_key`,
    [companyId, UPPLADDNING_TTL_SEK],
  );
  const lagring = objektlagring();
  for (const rad of utgangna.rows) await lagring.radera(rad.storage_key);
  return utgangna.rowCount ?? 0;
}

/** Steg 1: reservera raden och ge tillbaka den signerade engångslänken. */
export async function skapaUppladdningsLank(
  client: PoolClient, companyId: string, userId: string, input: SkapaUppladdningsLankInput,
): Promise<Record<string, unknown>> {
  const andelse = ANDELSE_PER_MIME[input.mime_type];
  if (!andelse) {
    throw new BadRequestError(
      'invalid_file',
      `filtypen tillåts inte (tillåtna: ${TILLATNA_BILAGE_MIME.join(', ')})`,
    );
  }
  if (!Number.isInteger(input.size_bytes) || input.size_bytes <= 0 || input.size_bytes > MAX_BILAGA_BYTES) {
    throw new BadRequestError('file_too_large', `bilagan får vara högst ${MAX_BILAGA_BYTES} bytes`);
  }

  const kvitto = await client.query<{ id: string }>(
    'SELECT id FROM receipts WHERE id = $1 AND company_id = $2',
    [input.receipt_id, companyId],
  );
  if (!kvitto.rows[0]) throw new NotFoundError('receipt');

  await stadaObekraftade(client, companyId);

  const storageKey = nyLagringsnyckel(companyId, randomUUID(), andelse);
  const rad = await client.query<BilageRad>(
    `INSERT INTO receipt_files (company_id, receipt_id, filename, mime_type, size_bytes, storage_key, uploaded_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING ${BILAGE_KOLUMNER}`,
    [companyId, input.receipt_id, input.filename, input.mime_type, input.size_bytes, storageKey, userId],
  );
  const bilaga = rad.rows[0]!;

  // Länken signeras FÖRE auditraden men EFTER insert: saknas PUBLIC_API_URL
  // rullas hela transaktionen tillbaka, så ingen halvfödd rad blir kvar.
  const lank = signeraBilagelank({
    op: 'put', fileId: bilaga.id, companyId, userId, ttlSekunder: UPPLADDNING_TTL_SEK,
  });

  await writeAudit(client, {
    companyId, userId, action: 'receipt.file_upload_requested', entityType: 'receipt',
    entityId: input.receipt_id,
    details: { file_id: bilaga.id, filename: input.filename, mime_type: input.mime_type, size_bytes: input.size_bytes },
  });

  return {
    file_id: bilaga.id,
    receipt_id: bilaga.receipt_id,
    upload_url: lank.url,
    expires_at: lank.expires_at,
    status: bilaga.status,
    // Sekvensen skriven i svaret: en agent som bara läser resultatet ska ändå
    // veta att steg 2 är en PUT utanför MCP.
    instruktion:
      'Steg 2 (utanför MCP): PUT de råa filbytesen till upload_url med ' +
      `Content-Type: ${input.mime_type}. Kör därefter confirm_receipt_file(file_id).`,
  };
}

/**
 * Steg 2: tar emot bytesen. Egen transaktion (anropas ur den osignerade
 * PUT-routen, som inte har någon action-kontext).
 *
 * Ordningen är medveten: raden låses och statusen flyttas fram FÖRE
 * diskskrivningen. Faller skrivningen rullas statusen tillbaka; lyckas den men
 * faller committen ligger objektet kvar som skräp med en obekräftad rad — och
 * städas av stadaObekraftade när TTL:n gått ut. `wx`-flaggan i lagringen är
 * andra spärren mot att samma signatur används två gånger.
 */
export async function taEmotBilageUppladdning(
  fileId: string, innehall: SignaturInnehall, contentType: string | undefined, bytes: Buffer,
): Promise<{ file_id: string; size_bytes: number; status: string }> {
  return withTenantTransaction(innehall.userId, innehall.companyId, async (client) => {
    const rad = await client.query<BilageRad>(
      `SELECT ${BILAGE_KOLUMNER}, company_id, storage_key FROM receipt_files
        WHERE id = $1 AND company_id = $2 FOR UPDATE`,
      [fileId, innehall.companyId],
    );
    const bilaga = rad.rows[0];
    if (!bilaga) throw new NotFoundError('receipt_file');
    if (bilaga.status !== 'awaiting_upload') {
      throw new ConflictError('upload_already_used', 'uppladdningslänken är förbrukad — begär en ny');
    }
    // Content-Type får vara utelämnad eller octet-stream (många klienter sätter
    // inget vettigt), men ALDRIG en annan typ än den som begärdes. Innehållets
    // magic bytes är den hårda kontrollen.
    const angivenTyp = contentType?.split(';')[0]?.trim().toLowerCase();
    if (angivenTyp && angivenTyp !== 'application/octet-stream' && angivenTyp !== bilaga.mime_type) {
      throw new BadRequestError('mime_mismatch', `filtypen skiljer sig från den begärda (${bilaga.mime_type})`);
    }
    if (bytes.length !== bilaga.size_bytes) {
      throw new BadRequestError(
        'size_mismatch',
        `storleken skiljer sig från den begärda (${bilaga.size_bytes} bytes)`,
      );
    }
    if (!matcharMagicBytes(bilaga.mime_type, bytes)) {
      throw new BadRequestError('invalid_file', 'filens innehåll matchar inte den angivna filtypen');
    }

    await client.query("UPDATE receipt_files SET status = 'uploaded' WHERE id = $1 AND company_id = $2", [
      fileId, innehall.companyId,
    ]);
    await objektlagring().skriv(bilaga.storage_key, bytes);
    await writeAudit(client, {
      companyId: innehall.companyId, userId: innehall.userId, action: 'receipt.file_uploaded',
      entityType: 'receipt', entityId: bilaga.receipt_id,
      details: { file_id: fileId, size_bytes: bytes.length },
    });
    return { file_id: fileId, size_bytes: bytes.length, status: 'uploaded' };
  });
}

/**
 * Steg 3: bekräfta. Storleken läses och sha256 beräknas ur det LAGRADE
 * objektet — aldrig ur något klienten påstår. `ersatter_file_id` är
 * rättelsevägen på ett bokfört kvitto, där varken radering eller överskrivning
 * finns: den felaktiga bilagan pekas ut med superseded_by och ligger kvar.
 */
export async function bekraftaBilaga(
  client: PoolClient, companyId: string, userId: string,
  input: { file_id: string; ersatter_file_id?: string },
): Promise<Record<string, unknown>> {
  await stadaObekraftade(client, companyId);

  const rad = await client.query<BilageRad>(
    `SELECT ${BILAGE_KOLUMNER}, company_id, storage_key FROM receipt_files
      WHERE id = $1 AND company_id = $2 FOR UPDATE`,
    [input.file_id, companyId],
  );
  const bilaga = rad.rows[0];
  if (!bilaga) throw new NotFoundError('receipt_file');
  if (bilaga.status === 'active') {
    throw new ConflictError('already_confirmed', 'bilagan är redan bekräftad — en bilaga bekräftas en gång');
  }
  if (bilaga.status !== 'uploaded') {
    throw new ConflictError('upload_missing', 'bytesen är inte uppladdade ännu (steg 2: PUT mot upload_url)');
  }

  const lagring = objektlagring();
  const storlek = await lagring.storlek(bilaga.storage_key);
  if (storlek === null) throw new ConflictError('object_missing', 'objektet saknas i lagringen');
  if (storlek !== bilaga.size_bytes) {
    throw new ConflictError('size_mismatch', 'objektets storlek stämmer inte med den begärda');
  }
  const sha256 = createHash('sha256').update(await lagring.las(bilaga.storage_key)).digest('hex');

  const uppdaterad = await client.query<BilageRad>(
    `UPDATE receipt_files SET status = 'active', sha256 = $3, uploaded_at = now()
      WHERE id = $1 AND company_id = $2 RETURNING ${BILAGE_KOLUMNER}`,
    [input.file_id, companyId, sha256],
  );

  await writeAudit(client, {
    companyId, userId, action: 'receipt.file_attached', entityType: 'receipt', entityId: bilaga.receipt_id,
    details: {
      file_id: input.file_id, filename: bilaga.filename, sha256,
      size_bytes: storlek, uploaded_by: userId,
    },
  });

  if (input.ersatter_file_id) {
    if (input.ersatter_file_id === input.file_id) {
      throw new BadRequestError('invalid_supersede', 'en bilaga kan inte ersätta sig själv');
    }
    const ersatt = await client.query<BilageRad>(
      `UPDATE receipt_files SET superseded_by = $3
        WHERE id = $1 AND company_id = $2 AND receipt_id = $4
          AND status = 'active' AND superseded_by IS NULL
        RETURNING ${BILAGE_KOLUMNER}`,
      [input.ersatter_file_id, companyId, input.file_id, bilaga.receipt_id],
    );
    if (!ersatt.rows[0]) {
      throw new ConflictError(
        'invalid_supersede',
        'den ersatta bilagan finns inte på samma kvitto, är inte aktiv eller är redan ersatt',
      );
    }
    await writeAudit(client, {
      companyId, userId, action: 'receipt.file_superseded', entityType: 'receipt', entityId: bilaga.receipt_id,
      details: { file_id: input.ersatter_file_id, superseded_by: input.file_id },
    });
  }

  const aktiv = uppdaterad.rows[0]!;
  return {
    file_id: aktiv.id,
    receipt_id: aktiv.receipt_id,
    filename: aktiv.filename,
    mime_type: aktiv.mime_type,
    size_bytes: aktiv.size_bytes,
    sha256: aktiv.sha256,
    status: aktiv.status,
    uploaded_at: aktiv.uploaded_at,
    uploaded_by: aktiv.uploaded_by,
    superseded_by: aktiv.superseded_by,
    ersatte_file_id: input.ersatter_file_id ?? null,
  };
}

/** Läsvägen: signerad GET med kort TTL. Tenant prövas först (404 vid annat bolag). */
export async function hamtaBilagelank(
  client: PoolClient, companyId: string, userId: string, fileId: string,
): Promise<Record<string, unknown>> {
  const rad = await client.query<BilageRad>(
    `SELECT ${BILAGE_KOLUMNER} FROM receipt_files WHERE id = $1 AND company_id = $2`,
    [fileId, companyId],
  );
  const bilaga = rad.rows[0];
  if (!bilaga) throw new NotFoundError('receipt_file');
  if (bilaga.status !== 'active') {
    throw new ConflictError('not_confirmed', 'bilagan är inte bekräftad ännu (confirm_receipt_file)');
  }
  const lank = signeraBilagelank({
    op: 'get', fileId, companyId, userId, ttlSekunder: NEDLADDNING_TTL_SEK,
  });
  return {
    file_id: bilaga.id,
    receipt_id: bilaga.receipt_id,
    filename: bilaga.filename,
    mime_type: bilaga.mime_type,
    size_bytes: bilaga.size_bytes,
    sha256: bilaga.sha256,
    superseded_by: bilaga.superseded_by,
    download_url: lank.url,
    expires_at: lank.expires_at,
  };
}

/** Nedladdningsvägen bakom den signerade GET-länken. Egen transaktion. */
export async function hamtaBilageInnehall(
  fileId: string, innehall: SignaturInnehall,
): Promise<{ filename: string; mimeType: string; bytes: Buffer }> {
  const bilaga = await withTenantTransaction(innehall.userId, innehall.companyId, async (client) => {
    const rad = await client.query<BilageRad>(
      `SELECT ${BILAGE_KOLUMNER}, storage_key FROM receipt_files WHERE id = $1 AND company_id = $2`,
      [fileId, innehall.companyId],
    );
    const funnen = rad.rows[0];
    if (!funnen) throw new NotFoundError('receipt_file');
    if (funnen.status !== 'active') throw new ConflictError('not_confirmed', 'bilagan är inte bekräftad');
    return funnen;
  });
  const bytes = await objektlagring().las(bilaga.storage_key);
  return { filename: bilaga.filename, mimeType: bilaga.mime_type, bytes };
}

/**
 * Bilagorna per kvitto för läsvägen. Superseded rader följer med — en ersatt
 * bilaga försvinner aldrig, den är utpekad.
 */
export async function bilagorForKvitton(
  client: PoolClient, companyId: string, receiptIds: string[],
): Promise<Map<string, Record<string, unknown>[]>> {
  const karta = new Map<string, Record<string, unknown>[]>();
  if (receiptIds.length === 0) return karta;
  const rader = await client.query<BilageRad>(
    `SELECT ${BILAGE_KOLUMNER} FROM receipt_files
      WHERE company_id = $1 AND receipt_id = ANY($2::uuid[]) AND status = 'active'
      ORDER BY uploaded_at, created_at`,
    [companyId, receiptIds],
  );
  for (const rad of rader.rows) {
    const lista = karta.get(rad.receipt_id) ?? [];
    lista.push({
      file_id: rad.id,
      filename: rad.filename,
      mime_type: rad.mime_type,
      size_bytes: rad.size_bytes,
      sha256: rad.sha256,
      uploaded_at: rad.uploaded_at,
      uploaded_by: rad.uploaded_by,
      superseded_by: rad.superseded_by,
    });
    karta.set(rad.receipt_id, lista);
  }
  return karta;
}

/**
 * Bilagerader + objekt för ett OBOKAT kvittoutkast som raderas. Bokförda
 * kvitton når aldrig hit (delete_draft_receipt avvisar dem), och DELETE-policyn
 * i 0075 är den hårda garantin.
 */
export async function raderaBilagorForUtkast(
  client: PoolClient, companyId: string, receiptId: string,
): Promise<{ id: string; storage_key: string }[]> {
  const borttagna = await client.query<{ id: string; storage_key: string }>(
    'DELETE FROM receipt_files WHERE company_id = $1 AND receipt_id = $2 RETURNING id, storage_key',
    [companyId, receiptId],
  );
  return borttagna.rows;
}

/** Objekten städas efter de lyckade DB-stegen (samma mönster som draftDelete). */
export async function raderaBilageObjekt(nycklar: string[]): Promise<void> {
  const lagring = objektlagring();
  for (const nyckel of nycklar) await lagring.radera(nyckel);
}
