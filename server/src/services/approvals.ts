import type { PoolClient } from 'pg';
import { createHash } from 'node:crypto';
import { BadRequestError, ConflictError, NotFoundError } from '../lib/errors.js';
import type { Actor } from '../http/middleware/authenticate.js';
import { writeAudit } from './auditService.js';

export const APPROVAL_COLUMNS = `id, action, input, status, requested_by, requested_actor,
  decided_by, decided_at, result, error, created_at, beslut_hash, beslut_skal`;

export interface Approval {
  id: string;
  action: string;
  input: Record<string, unknown>;
  status: 'pending' | 'approved' | 'rejected' | 'executed' | 'failed';
  requested_by: string;
  requested_actor: Actor;
  decided_by: string | null;
  decided_at: Date | null;
  created_at: Date;
  result: unknown;
  error: string | null;
  beslut_hash: string | null;
  beslut_skal: string | null;
}

// Sortera objektnycklar på varje nivå; listornas ordning bär indatats innebörd.
function sorteradJson(varde: unknown): string {
  if (Array.isArray(varde)) return `[${varde.map(sorteradJson).join(',')}]`;
  if (varde !== null && typeof varde === 'object') {
    const post = varde as Record<string, unknown>;
    return `{${Object.keys(post).sort().map((k) => `${JSON.stringify(k)}:${sorteradJson(post[k])}`).join(',')}}`;
  }
  return JSON.stringify(varde);
}

/** Låser mandatets lagrade JSON vid en stabil summa, oberoende av jsonb:s nyckelordning. */
export function beslutHash(input: unknown): string {
  return createHash('sha256').update(sorteradJson(input), 'utf8').digest('hex');
}

export async function createApproval(
  client: PoolClient,
  companyId: string,
  requestedBy: string,
  requestedActor: Actor,
  action: string,
  input: unknown,
): Promise<Approval> {
  const result = await client.query<Approval>(
    `INSERT INTO action_approvals (company_id, action, input, requested_by, requested_actor)
     VALUES ($1, $2, $3, $4, $5) RETURNING ${APPROVAL_COLUMNS}`,
    [companyId, action, JSON.stringify(input), requestedBy, requestedActor],
  );
  return result.rows[0]!;
}

export async function listApprovals(
  client: PoolClient,
  companyId: string,
  status?: string,
): Promise<Approval[]> {
  const result = await client.query<Approval>(
    `SELECT ${APPROVAL_COLUMNS} FROM action_approvals
     WHERE company_id = $1 AND ($2::text IS NULL OR status = $2)
     ORDER BY created_at DESC LIMIT 200`,
    [companyId, status ?? null],
  );
  return result.rows;
}

/**
 * De senast AVGJORDA förslagen — kvittot.
 *
 * Ett godkännande som utförts försvinner i dag spårlöst ur kön: man klickar,
 * sidan laddas om, raden är borta. Det är samma tystnad som gjorde de andra
 * felen svåra att se — ingenting säger om det gick vägen, bara att det inte
 * längre väntar. Kvittolistan stänger den slingan, och den är kort med flit:
 * det här är en bekräftelse, inte ett arkiv (hela historiken ligger i
 * revisionsloggen).
 */
export async function listRecentDecisions(
  client: PoolClient, companyId: string, limit = 5,
): Promise<Approval[]> {
  const result = await client.query<Approval>(
    `SELECT ${APPROVAL_COLUMNS} FROM action_approvals
     WHERE company_id = $1 AND decided_at IS NOT NULL
     ORDER BY decided_at DESC LIMIT $2`,
    [companyId, limit],
  );
  return result.rows;
}

export async function getApproval(client: PoolClient, companyId: string, id: string): Promise<Approval> {
  const result = await client.query<Approval>(
    `SELECT ${APPROVAL_COLUMNS} FROM action_approvals WHERE id = $1 AND company_id = $2`,
    [id, companyId],
  );
  if (!result.rows[0]) throw new NotFoundError('approval');
  return result.rows[0];
}

/** Låser en pending-approval (FOR UPDATE) så två godkännare inte kan kapplöpa. */
export async function lockPendingApproval(
  client: PoolClient,
  companyId: string,
  id: string,
): Promise<Approval> {
  const result = await client.query<Approval>(
    `SELECT ${APPROVAL_COLUMNS} FROM action_approvals WHERE id = $1 AND company_id = $2 FOR UPDATE`,
    [id, companyId],
  );
  const row = result.rows[0];
  if (!row) throw new NotFoundError('approval');
  if (row.status !== 'pending') {
    throw new ConflictError('not_pending', `godkännandet är redan ${row.status}`);
  }
  return row;
}

/**
 * Avvisningen utbruten ur rejectApproval (B-2): samma lås och auditrad.
 * Actions-lagret skickar skäl bara för tvafas, eftersom tjänster aldrig
 * importerar registret. Med skäl bevaras ett mottaget nej i samma UPDATE;
 * utan skäl är det dagens avvisning, utan mottaget mandat att verkställa.
 */
export async function avvisaGodkannande(
  client: PoolClient, companyId: string, userId: string, approvalId: string, skal?: string,
): Promise<Approval> {
  const appr = await lockPendingApproval(client, companyId, approvalId);
  const rent = skal?.trim();
  if (skal !== undefined && !rent) {
    throw new BadRequestError('skal_kravs', 'ange skälet till ditt nej — det sparas med beslutet');
  }
  const r = await client.query<Approval>(
    `UPDATE action_approvals
        SET status = 'rejected', decided_by = $1, decided_at = now(), beslut_hash = $2, beslut_skal = $3
      WHERE id = $4 AND company_id = $5
      RETURNING ${APPROVAL_COLUMNS}`,
    [userId, rent ? beslutHash(appr.input) : null, rent ?? null, approvalId, companyId],
  );
  await writeAudit(client, {
    companyId, userId, action: 'action.rejected', entityType: 'approval', entityId: approvalId,
    // Skälet finns bara i köposten, aldrig i auditloggen (lärdom 10).
    ...(rent ? { details: { action: appr.action, tvafas: true } } : {}),
  });
  return r.rows[0]!;
}
