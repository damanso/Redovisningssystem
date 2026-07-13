import type { PoolClient } from 'pg';
import { ConflictError, NotFoundError } from '../lib/errors.js';
import type { Actor } from '../http/middleware/authenticate.js';

const COLUMNS = `id, action, input, status, requested_by, requested_actor,
  decided_by, decided_at, result, error, created_at`;

export interface Approval {
  id: string;
  action: string;
  input: Record<string, unknown>;
  status: 'pending' | 'approved' | 'rejected' | 'executed' | 'failed';
  requested_by: string;
  requested_actor: Actor;
  decided_by: string | null;
  result: unknown;
  error: string | null;
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
     VALUES ($1, $2, $3, $4, $5) RETURNING ${COLUMNS}`,
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
    `SELECT ${COLUMNS} FROM action_approvals
     WHERE company_id = $1 AND ($2::text IS NULL OR status = $2)
     ORDER BY created_at DESC LIMIT 200`,
    [companyId, status ?? null],
  );
  return result.rows;
}

export async function getApproval(client: PoolClient, companyId: string, id: string): Promise<Approval> {
  const result = await client.query<Approval>(
    `SELECT ${COLUMNS} FROM action_approvals WHERE id = $1 AND company_id = $2`,
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
    `SELECT ${COLUMNS} FROM action_approvals WHERE id = $1 AND company_id = $2 FOR UPDATE`,
    [id, companyId],
  );
  const row = result.rows[0];
  if (!row) throw new NotFoundError('approval');
  if (row.status !== 'pending') {
    throw new ConflictError('not_pending', `godkännandet är redan ${row.status}`);
  }
  return row;
}
