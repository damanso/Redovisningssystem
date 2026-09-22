// De två signerade vägarna för kvittobilagornas BYTES — den enda delen av
// API:t som medvetet saknar JWT.
//
// Behörigheten är HMAC-signaturen i länken: den binder operation, fil, bolag,
// användare och utgångstid. Routern gör inget mer än att pröva signaturen och
// lämna över till tjänsten; tenant-kontexten sätts där, så RLS gäller precis
// som för varje annan skrivning. Routern ligger UTANFÖR /api/companies (som
// kräver authenticate) just därför att uppladdaren inte har någon session —
// den sitter i en helt annan maskin än MCP-servern.
import express, { Router } from 'express';
import { verifieraBilagelank } from '../../lib/bilagesignatur.js';
import { UuidSchema } from '../../lib/validation.js';
import { NotFoundError } from '../../lib/errors.js';
import {
  hamtaBilageInnehall, MAX_BILAGA_BYTES, taEmotBilageUppladdning,
} from '../../services/receiptFiles.js';

export const receiptFilesRouter = Router();

// raw med `type: () => true`: kroppen är råa bytes oavsett vilken Content-Type
// laddaren sätter. Gränsen är bilagetaket — express.json ovanför rör bara
// application/json och når aldrig hit.
receiptFilesRouter.put('/:fileId/content', express.raw({ type: () => true, limit: MAX_BILAGA_BYTES }), async (req, res) => {
  const fileId = UuidSchema.safeParse(req.params.fileId);
  if (!fileId.success) throw new NotFoundError('receipt_file');
  const innehall = verifieraBilagelank({ op: 'put', fileId: fileId.data, query: req.query });
  const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  const resultat = await taEmotBilageUppladdning(fileId.data, innehall, req.get('content-type'), bytes);
  res.status(201).json(resultat);
});

receiptFilesRouter.get('/:fileId/content', async (req, res) => {
  const fileId = UuidSchema.safeParse(req.params.fileId);
  if (!fileId.success) throw new NotFoundError('receipt_file');
  const innehall = verifieraBilagelank({ op: 'get', fileId: fileId.data, query: req.query });
  const bilaga = await hamtaBilageInnehall(fileId.data, innehall);
  // res.attachment sätter en RFC 6266-korrekt Content-Disposition även för
  // icke-ASCII-namn (samma skäl som i routes/files.ts).
  res.attachment(bilaga.filename);
  res.type(bilaga.mimeType);
  // En signerad länk är kortlivad och personlig — den får aldrig cachas.
  res.setHeader('Cache-Control', 'no-store');
  res.send(bilaga.bytes);
});
