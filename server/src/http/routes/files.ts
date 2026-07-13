import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { withTenantTransaction } from '../../db/tx.js';
import { BadRequestError, NotFoundError, UnauthenticatedError } from '../../lib/errors.js';
import { writeAudit } from '../../services/auditService.js';
import {
  removeStoredFile,
  resolveStoredPath,
  sanitizeDownloadName,
  validateUpload,
  writeStoredFile,
} from '../../services/fileStorage.js';

// Filer hålls i minnet tills valideringen är klar — vi skriver själva till disk
// med UUID-namn (aldrig användarens filnamn) under en katalog utanför webbroten.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
});

const FileIdSchema = z.string().uuid();

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

filesRouter.post('/', upload.single('file'), async (req, res) => {
  if (!req.auth) throw new UnauthenticatedError();
  const userId = req.auth.userId;
  const companyId = req.companyId!;
  if (!req.file) throw new BadRequestError('missing_file', 'ingen fil bifogad (fältnamn: file)');

  const { buffer, originalname, size } = req.file;
  const validated = validateUpload(originalname, buffer);

  const file = await withTenantTransaction(userId, companyId, async (client) => {
    const inserted = await client.query<FileRow>(
      `INSERT INTO files (company_id, original_name, stored_name, mime_type, size_bytes, sha256, uploaded_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, original_name, stored_name, mime_type, size_bytes, sha256, created_at`,
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
    // Diskskrivningen sker inne i transaktionen: misslyckas den rullas
    // databasraden tillbaka och ingen föräldralös metadata blir kvar.
    try {
      await writeStoredFile(companyId, validated.storedName, buffer);
    } catch (err) {
      await removeStoredFile(companyId, validated.storedName);
      throw err;
    }
    return row;
  });

  res.status(201).json({
    file: {
      id: file.id,
      original_name: file.original_name,
      mime_type: file.mime_type,
      size_bytes: Number(file.size_bytes),
      sha256: file.sha256,
      created_at: file.created_at,
    },
  });
});

filesRouter.get('/:fileId', async (req, res) => {
  if (!req.auth) throw new UnauthenticatedError();
  const userId = req.auth.userId;
  const companyId = req.companyId!;
  const parsed = FileIdSchema.safeParse(req.params.fileId);
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
  res.setHeader('Content-Type', file.mime_type);
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${sanitizeDownloadName(file.original_name)}"`,
  );
  res.sendFile(fullPath, (err) => {
    if (err && !res.headersSent) {
      res.status(404).json({ error: 'not_found' });
    }
  });
});
