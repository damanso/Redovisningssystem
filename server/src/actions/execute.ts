import { withTenantTransaction } from '../db/tx.js';
import { AppError, ForbiddenError, NotFoundError } from '../lib/errors.js';
import type { Actor } from '../http/middleware/authenticate.js';
import { writeAudit } from '../services/auditService.js';
import {
  createApproval,
  getApproval,
  lockPendingApproval,
  type Approval,
} from '../services/approvals.js';
import { getAction } from './registry.js';

export type ActionResult =
  | { status: 'ok'; action: string; result: unknown }
  | { status: 'pending_approval'; action: string; approval: Approval };

/**
 * Kör en action mot kärnan. Icke-känsliga kör direkt (med tenant/RLS/audit).
 * Känsliga (pengaflyttande/periodlåsande) skapar i stället en pending approval —
 * de körs ALDRIG förrän en människa godkänt (se approveAction).
 *
 * VIKTIGT (prompt injection): all auktoritet kommer från companyId + userId
 * (förtroendegränsen), aldrig från indata. Indata schemavalideras strikt, så
 * ett kvitto/mejl som AI:n läst kan inte "be" systemet att köra en annan action,
 * höja behörighet eller kringgå godkännandekravet.
 */
export async function executeAction(params: {
  companyId: string;
  userId: string;
  actor: Actor;
  actionName: string;
  input: unknown;
}): Promise<ActionResult> {
  const action = getAction(params.actionName);
  if (!action) throw new NotFoundError('action');
  const input = action.inputSchema.parse(params.input);

  if (action.sensitivity === 'sensitive') {
    const approval = await withTenantTransaction(params.userId, params.companyId, async (client) => {
      const created = await createApproval(
        client,
        params.companyId,
        params.userId,
        params.actor,
        action.name,
        input,
      );
      await writeAudit(client, {
        companyId: params.companyId,
        userId: params.userId,
        action: 'action.approval_requested',
        entityType: 'approval',
        entityId: created.id,
        details: { action: action.name, actor: params.actor },
      });
      return created;
    });
    return { status: 'pending_approval', action: action.name, approval };
  }

  const result = await withTenantTransaction(params.userId, params.companyId, async (client) => {
    const value = await action.handler({ client, companyId: params.companyId, userId: params.userId }, input as never);
    await writeAudit(client, {
      companyId: params.companyId,
      userId: params.userId,
      action: 'action.executed',
      entityType: 'action',
      entityId: action.name,
      details: { sensitivity: action.sensitivity, actor: params.actor },
    });
    return value;
  });
  return { status: 'ok', action: action.name, result };
}

/**
 * Godkänner och kör en pending action. Endast en människa får godkänna
 * (kontrolleras i routen) — en agent kan aldrig godkänna sin egen begäran.
 */
export async function approveAction(params: {
  companyId: string;
  approverId: string;
  approvalId: string;
}): Promise<{ approval: Approval; result: unknown }> {
  // Steg 1: gör anspråk på godkännandet (pending → approved), serialiserat.
  await withTenantTransaction(params.approverId, params.companyId, async (client) => {
    const appr = await lockPendingApproval(client, params.companyId, params.approvalId);
    if (!getAction(appr.action)) throw new NotFoundError('action');
    await client.query(
      "UPDATE action_approvals SET status = 'approved', decided_by = $1, decided_at = now() WHERE id = $2",
      [params.approverId, params.approvalId],
    );
  });

  // Steg 2: kör i egen transaktion (ett DB-fel abortera transaktionen, så
  // markeringen 'failed' måste ske i en separat transaktion).
  try {
    return await withTenantTransaction(params.approverId, params.companyId, async (client) => {
      const appr = await getApproval(client, params.companyId, params.approvalId);
      const action = getAction(appr.action)!;
      const result = await action.handler(
        { client, companyId: params.companyId, userId: params.approverId },
        appr.input as never,
      );
      await client.query("UPDATE action_approvals SET status = 'executed', result = $1 WHERE id = $2", [
        JSON.stringify(result ?? null),
        params.approvalId,
      ]);
      await writeAudit(client, {
        companyId: params.companyId,
        userId: params.approverId,
        action: 'action.approved_executed',
        entityType: 'approval',
        entityId: params.approvalId,
        details: { action: appr.action, requested_by: appr.requested_by },
      });
      return { approval: await getApproval(client, params.companyId, params.approvalId), result };
    });
  } catch (err) {
    const code = err instanceof AppError ? err.code : 'internal_error';
    await withTenantTransaction(params.approverId, params.companyId, (client) =>
      client.query("UPDATE action_approvals SET status = 'failed', error = $1 WHERE id = $2", [
        code,
        params.approvalId,
      ]),
    );
    throw err;
  }
}

export async function rejectApproval(params: {
  companyId: string;
  approverId: string;
  approvalId: string;
}): Promise<Approval> {
  return withTenantTransaction(params.approverId, params.companyId, async (client) => {
    await lockPendingApproval(client, params.companyId, params.approvalId);
    await client.query(
      "UPDATE action_approvals SET status = 'rejected', decided_by = $1, decided_at = now() WHERE id = $2",
      [params.approverId, params.approvalId],
    );
    await writeAudit(client, {
      companyId: params.companyId,
      userId: params.approverId,
      action: 'action.rejected',
      entityType: 'approval',
      entityId: params.approvalId,
    });
    return getApproval(client, params.companyId, params.approvalId);
  });
}

// ForbiddenError re-exporteras för routelagret (agent får inte godkänna).
export { ForbiddenError };
