// CRM E2 (del 2): vem som är tilldelad vilket uppdrag.
//
// Tilldelningen är det som gör "en underkonsult ska se SINA EGNA uppdrag"
// uttryckbart. Nyckeln är aktören (0051), inte användaren: en underkonsult
// finns som aktör långt innan hen har inloggning, och kopplingen aktör→
// användare sätts först den dagen kontot finns.
//
// Åtkomsten avgörs i databasen (app_has_project_access i migration 0053).
// Tjänstelagret här sätter och läser tilldelningar — det är inte spärren.
import type { PoolClient } from 'pg';
import { ForbiddenError, NotFoundError } from '../lib/errors.js';
import type { CompanyRole } from '../db/tx.js';
import { writeAudit } from './auditService.js';

function assertAdmin(role: CompanyRole): void {
  if (role !== 'owner' && role !== 'admin') {
    throw new ForbiddenError('not_admin', 'endast ägare eller admin kan tilldela uppdrag');
  }
}

export async function assignProjectActor(
  client: PoolClient, companyId: string, userId: string, role: CompanyRole,
  projectId: string, actorId: string,
): Promise<{ project_id: string; actor_id: string; assigned: boolean }> {
  assertAdmin(role);
  const p = await client.query('SELECT 1 FROM projects WHERE id = $1 AND company_id = $2', [projectId, companyId]);
  if (!p.rows[0]) throw new NotFoundError('project');
  const a = await client.query('SELECT 1 FROM work_actors WHERE id = $1 AND company_id = $2', [actorId, companyId]);
  if (!a.rows[0]) throw new NotFoundError('work_actor');

  const r = await client.query(
    `INSERT INTO project_assignments (company_id, project_id, actor_id, created_by)
     VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING project_id`,
    [companyId, projectId, actorId, userId],
  );
  if (r.rows[0]) {
    await writeAudit(client, {
      companyId, userId, action: 'project.actor_assigned', entityType: 'project', entityId: projectId,
      details: { actor_id: actorId },
    });
  }
  return { project_id: projectId, actor_id: actorId, assigned: Boolean(r.rows[0]) };
}

export async function unassignProjectActor(
  client: PoolClient, companyId: string, userId: string, role: CompanyRole,
  projectId: string, actorId: string,
): Promise<{ project_id: string; actor_id: string; removed: boolean }> {
  assertAdmin(role);
  const r = await client.query(
    'DELETE FROM project_assignments WHERE company_id = $1 AND project_id = $2 AND actor_id = $3',
    [companyId, projectId, actorId],
  );
  if (r.rowCount) {
    await writeAudit(client, {
      companyId, userId, action: 'project.actor_unassigned', entityType: 'project', entityId: projectId,
      details: { actor_id: actorId },
    });
  }
  return { project_id: projectId, actor_id: actorId, removed: Boolean(r.rowCount) };
}

export async function listProjectAssignments(
  client: PoolClient, companyId: string, opts: { project_id?: string } = {},
): Promise<Record<string, unknown>[]> {
  const r = await client.query(
    `SELECT pa.project_id, pa.actor_id, p.name AS project_name, p.number AS project_number,
            a.name AS actor_name, a.kind AS actor_kind
     FROM project_assignments pa
     JOIN projects p ON p.id = pa.project_id AND p.company_id = pa.company_id
     JOIN work_actors a ON a.id = pa.actor_id AND a.company_id = pa.company_id
     WHERE pa.company_id = $1 AND ($2::uuid IS NULL OR pa.project_id = $2)
     ORDER BY p.number DESC, a.name`,
    [companyId, opts.project_id ?? null],
  );
  return r.rows;
}
