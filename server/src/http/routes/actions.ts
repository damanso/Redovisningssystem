import { Router } from 'express';
import { z } from 'zod';
import { approveAction, executeAction, rejectApproval } from '../../actions/execute.js';
import { actionManifest } from '../../actions/registry.js';
import { withTenantTransaction } from '../../db/tx.js';
import { BadRequestError, ForbiddenError } from '../../lib/errors.js';
import { singleFileUpload } from '../../lib/upload.js';
import { safeText } from '../../lib/validation.js';
import { aiOcrReceipt } from '../../services/aiOcr.js';
import { listApprovals } from '../../services/approvals.js';
import { getActor, getUserId } from '../middleware/authenticate.js';

const ID = z.string().uuid();

export const actionsRouter = Router({ mergeParams: true });

// Manifest = MCP-tools-listan (namn, titel, känslighet, godkännandekrav).
actionsRouter.get('/actions', async (req, res) => {
  getUserId(req);
  res.json({ actions: actionManifest() });
});

// Kör en action. Känsliga hamnar i godkännandekö (status: pending_approval).
actionsRouter.post('/actions/:action', async (req, res) => {
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
  const approvals = await withTenantTransaction(userId, companyId, (c) => listApprovals(c, companyId, status));
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
  res.json(outcome);
});

actionsRouter.post('/approvals/:id/reject', async (req, res) => {
  const approverId = getUserId(req);
  const companyId = req.companyId!;
  if (getActor(req) !== 'human') throw new ForbiddenError('human_approval_required', 'endast en människa kan avslå');
  z.object({ reason: safeText(300).optional() }).strict().parse(req.body ?? {});
  const id = ID.parse(req.params.id);
  const approval = await rejectApproval({ companyId, approverId, approvalId: id });
  res.json({ approval });
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
