import express, { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { approveAction, executeAction, rejectApproval } from '../../actions/execute.js';
import { actionManifest } from '../../actions/registry.js';
import { withTenantTransaction } from '../../db/tx.js';
import { BadRequestError, ForbiddenError } from '../../lib/errors.js';
import { singleFileUpload } from '../../lib/upload.js';
import { safeText } from '../../lib/validation.js';
import { aiOcrReceipt } from '../../services/aiOcr.js';
import { checkApprovalDependency } from '../../actions/dependencies.js';
import { listApprovals } from '../../services/approvals.js';
import { ATTACH_DOCUMENT_BODY_LIMIT_BYTES } from '../../services/documents.js';
import { getActor, getUserId } from '../middleware/authenticate.js';

const ID = z.string().uuid();

/** Åtgärden vars kropp bär ett helt dokument som base64 (FR-18). */
export const ATTACH_DOCUMENT_ACTION = 'attach_document';

const ATTACH_DOCUMENT_PATH = new RegExp(`^/api/companies/[^/]+/actions/${ATTACH_DOCUMENT_ACTION}/?$`);

/**
 * Tillåtelselistan för undantaget från den globala JSON-parsern i app.ts
 * (AD-10): sann bara för POST till åtgärdsrutten för attach_document, med
 * eller utan avslutande snedstreck, skiftlägeskänsligt. Ett anrop som den inte
 * släpper igenom får den globala gränsen på 1 MB, vilket aldrig öppnar något.
 */
export function isAttachDocumentRequest(method: string, path: string): boolean {
  return method === 'POST' && ATTACH_DOCUMENT_PATH.test(path);
}

const ATTACH_DOCUMENT_JSON_PARSER = express.json({ limit: ATTACH_DOCUMENT_BODY_LIMIT_BYTES });

// Den stora parsern bor här och inte i app.ts: actionsRouter nås bara efter
// authenticate och requireCompanyAccess, så en oautentiserad klient eller en
// utan medlemskap i bolaget får aldrig en stor kropp tolkad (FR-18, AD-10).
// Prejudikatet är bilagans express.raw i routes/receiptFiles.ts. Andra
// åtgärder har redan fått sin kropp läst av den globala parsern (1 MB).
// Parametertypen är rutten /actions/:action: en mellanvara på rutten avgör
// typen på req.params också för handlern efter den, och standardtypen hade
// gjort action till string | string[] där.
function attachDocumentBody(req: Request<{ action: string }>, res: Response, next: NextFunction): void {
  if (req.params.action === ATTACH_DOCUMENT_ACTION) {
    ATTACH_DOCUMENT_JSON_PARSER(req, res, next);
    return;
  }
  next();
}

export const actionsRouter = Router({ mergeParams: true });

// Manifest = MCP-tools-listan (namn, titel, känslighet, godkännandekrav).
actionsRouter.get('/actions', async (req, res) => {
  getUserId(req);
  res.json({ actions: actionManifest() });
});

// Kör en action. Känsliga hamnar i godkännandekö (status: pending_approval).
actionsRouter.post('/actions/:action', attachDocumentBody, async (req, res) => {
  const userId = getUserId(req);
  const companyId = req.companyId!;
  const outcome = await executeAction({
    companyId,
    userId,
    actor: getActor(req),
    actionName: req.params.action ?? '',
    input: req.body ?? {},
  });
  res.status(outcome.status === 'pending_approval' ? 202 : 200).json(outcome);
});

actionsRouter.get('/approvals', async (req, res) => {
  const userId = getUserId(req);
  const companyId = req.companyId!;
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  // K4: pending-förslag annoteras med sitt (färskt beräknade) beroende, så
  // kön visar "godkänn X först" i stället för att fela vid godkännandet.
  const approvals = await withTenantTransaction(userId, companyId, async (c) => {
    const rows = await listApprovals(c, companyId, status);
    return Promise.all(rows.map(async (a) => {
      if (a.status !== 'pending') return a;
      const dependency = await checkApprovalDependency(c, companyId, a.action, a.input);
      return dependency ? { ...a, dependency } : a;
    }));
  });
  res.json({ approvals });
});

// Godkänn (och kör). ENDAST en människa — en agent kan aldrig godkänna, inte ens
// sin egen begäran. Detta är människa-i-loopen för pengaflyttande operationer.
actionsRouter.post('/approvals/:id/approve', async (req, res) => {
  const approverId = getUserId(req);
  const companyId = req.companyId!;
  if (getActor(req) !== 'human') throw new ForbiddenError('human_approval_required', 'endast en människa kan godkänna');
  z.object({}).strict().parse(req.body ?? {});
  const id = ID.parse(req.params.id);
  const outcome = await approveAction({ companyId, approverId, approverActor: getActor(req), approvalId: id });
  // Tvåfas: mottaget är inget påstående om en genomförd handling (B-2).
  res.status(outcome.approval.status === 'approved' ? 202 : 200).json(outcome);
});

actionsRouter.post('/approvals/:id/reject', async (req, res) => {
  const approverId = getUserId(req);
  const companyId = req.companyId!;
  if (getActor(req) !== 'human') throw new ForbiddenError('human_approval_required', 'endast en människa kan avslå');
  const { reason } = z.object({ reason: safeText(300).optional() }).strict().parse(req.body ?? {});
  const id = ID.parse(req.params.id);
  const approval = await rejectApproval({ companyId, approverId, approverActor: getActor(req), approvalId: id, skal: reason });
  res.status(approval.beslut_hash !== null && approval.result === null ? 202 : 200).json({ approval });
});

// AI-OCR: läser en kvittofil och returnerar ett FÖRSLAG (kräver mänsklig
// granskning; bokför aldrig något). Kräver medlemskap; ingen auktoritet härleds
// ur filens innehåll.
actionsRouter.post('/ocr/receipt', singleFileUpload(), async (req, res) => {
  getUserId(req);
  if (!req.file) throw new BadRequestError('missing_file', 'ingen fil bifogad (fältnamn: file)');
  const suggestion = await aiOcrReceipt({ mimeType: req.file.mimetype, buffer: req.file.buffer });
  res.json({ suggestion });
});
