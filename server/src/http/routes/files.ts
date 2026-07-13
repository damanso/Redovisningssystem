import { Router } from 'express';
import { withTenantTransaction } from '../../db/tx.js';
import { BadRequestError, NotFoundError } from '../../lib/errors.js';
import { singleFileUpload } from '../../lib/upload.js';
import { UuidSchema } from '../../lib/validation.js';
import { writeAudit } from '../../services/auditService.js';
import {
  removeStoredFile,
  resolveStoredPath,
  validateUpload,
  writeStoredFile,
} from '../../services/fileStorage.js';
import { getUserId } from '../middleware/authenticate.js';


interface FileRow {
  id: string;
  original_name: string;
  stored_name: string;
  mime_type: string;
  size_bytes: string;
  sha256: string;
  created_at: string;
}

// mergeParams: routern monteras under /:companyId/files i companies.ts.
export const filesRouter = Router({ mergeParams: true });

filesRouter.post('/', singleFileUpload(), async (req, res) => {
  const userId = getUserId(req);
  const companyId = req.companyId!;
  if (!req.file) throw new BadRequestError('missing_file', 'ingen fil bifogad (fältnamn: file)');

  const { buffer, originalname, size } = req.file;
  const validated = validateUpload(originalname, buffer);

  // Skriv filen till disk FÖRE transaktionen: annars hålls en poolad klient med
  // öppen transaktion under hela diskskrivningen (upp till MAX_UPLOAD_BYTES).
  // wx-flaggan gör att ett redan existerande UUID-namn aldrig skrivs över.
  await writeStoredFile(companyId, validated.storedName, buffer);
  try {
    const file = await withTenantTransaction(userId, companyId, async (client) => {
      const inserted = await client.query<FileRow>(
        `INSERT INTO files (company_id, original_name, stored_name, mime_type, size_bytes, sha256, uploaded_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, created_at`,
        [
          companyId,
          originalname,
          validated.storedName,
          validated.mimeType,
          size,
          validated.sha256,
          userId,
        ],
      );
      const row = inserted.rows[0]!;
      await writeAudit(client, {
        companyId,
        userId,
        action: 'file.uploaded',
        entityType: 'file',
        entityId: row.id,
        details: { original_name: originalname, size_bytes: size, sha256: validated.sha256 },
      });
      return row;
    });

    res.status(201).json({
      file: {
        id: file.id,
        original_name: originalname,
        mime_type: validated.mimeType,
        size_bytes: size,
        sha256: validated.sha256,
        created_at: file.created_at,
      },
    });
  } catch (err) {
    // Transaktionen misslyckades → ta bort den föräldralösa filen från disk.
    await removeStoredFile(companyId, validated.storedName);
    throw err;
  }
});

filesRouter.get('/:fileId', async (req, res) => {
  const userId = getUserId(req);
  const companyId = req.companyId!;
  const parsed = UuidSchema.safeParse(req.params.fileId);
  if (!parsed.success) throw new NotFoundError('file');

  const file = await withTenantTransaction(userId, companyId, async (client) => {
    const result = await client.query<FileRow>(
      `SELECT id, original_name, stored_name, mime_type, size_bytes, sha256, created_at
       FROM files WHERE id = $1 AND company_id = $2`,
      [parsed.data, companyId],
    );
    if (!result.rows[0]) throw new NotFoundError('file');
    return result.rows[0];
  });

  // resolveStoredPath validerar mönster + containment igen (sista spärren).
  const fullPath = resolveStoredPath(companyId, file.stored_name);
  // res.attachment sätter en RFC 6266-korrekt Content-Disposition (inkl.
  // filename*=UTF-8''… för icke-ASCII-namn) — hindrar både header-injektion
  // och ERR_INVALID_CHAR som en handrullad header gav för unicode-namn.
  res.attachment(file.original_name);
  res.type(file.mime_type);
  res.sendFile(fullPath, (err) => {
    if (err && !res.headersSent) {
      res.status(404).json({ error: 'not_found' });
    }
  });
});
