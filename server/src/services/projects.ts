// Fas A6: projekt & tidrapportering. Projekt knyts valfritt till en kund och har
// en valfri timtaxa/budget. Tidposter loggas i minuter mot ett projekt. Belopp
// beräknas i ören som round(minuter/60 * timtaxa), aldrig float i lagring.
import type { PoolClient } from 'pg';
import { BadRequestError, NotFoundError } from '../lib/errors.js';
import { writeAudit } from './auditService.js';
import { nextDocumentNumber } from './accounting/numbering.js';

export interface CreateProjectInput {
  name: string;
  customer_id?: string;
  hourly_rate_ore?: number;
  budget_ore?: number;
  notes?: string;
}

export interface CreateTimeEntryInput {
  project_id: string;
  work_date: string;
  minutes: number;
  description: string;
  hourly_rate_ore?: number;
  billable?: boolean;
}

/**
 * Belopp i ören för en tidpost: minuter/60 * gällande timtaxa, avrundat till
 * hela ören. Heltalsmultiplikation FÖRE division (minuter ≤ 1440, taxan bunden
 * av OreSchema) så mellanledet aldrig blir ett flyttal — invarianten "öre i
 * heltal, aldrig float" gäller även härledda belopp.
 */
export function timeEntryAmountOre(minutes: number, rateOre: number | null): number {
  if (!rateOre) return 0;
  return Math.round((minutes * rateOre) / 60);
}

export async function createProject(
  client: PoolClient, companyId: string, userId: string, input: CreateProjectInput,
): Promise<Record<string, unknown>> {
  if (input.customer_id) {
    const c = await client.query('SELECT id FROM customers WHERE id = $1 AND company_id = $2', [input.customer_id, companyId]);
    if (!c.rows[0]) throw new NotFoundError('customer');
  }
  const number = await nextDocumentNumber(client, companyId, 'project');
  const row = await client.query<{ id: string }>(
    `INSERT INTO projects (company_id, customer_id, number, name, hourly_rate_ore, budget_ore, notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [companyId, input.customer_id ?? null, number, input.name,
      input.hourly_rate_ore ?? null, input.budget_ore ?? null, input.notes ?? null, userId],
  );
  const id = row.rows[0]!.id;
  await writeAudit(client, {
    companyId, userId, action: 'project.created', entityType: 'project', entityId: id,
    details: { number, name: input.name },
  });
  return getProject(client, companyId, id);
}

export async function setProjectStatus(
  client: PoolClient, companyId: string, userId: string, id: string, status: 'active' | 'closed',
): Promise<Record<string, unknown>> {
  const res = await client.query(
    'UPDATE projects SET status = $3 WHERE id = $1 AND company_id = $2 RETURNING id',
    [id, companyId, status],
  );
  if (!res.rows[0]) throw new NotFoundError('project');
  await writeAudit(client, {
    companyId, userId, action: 'project.set_status', entityType: 'project', entityId: id, details: { status },
  });
  return getProject(client, companyId, id);
}

export async function listProjects(
  client: PoolClient, companyId: string, opts: { status?: string } = {},
): Promise<Record<string, unknown>[]> {
  const res = await client.query(
    `SELECT p.id, p.number, p.name, p.status, p.hourly_rate_ore, p.budget_ore,
            cu.name AS customer_name,
            COALESCE(SUM(t.minutes), 0)::int AS total_minutes,
            COALESCE(SUM(t.minutes) FILTER (WHERE t.billable), 0)::int AS billable_minutes
     FROM projects p
     LEFT JOIN customers cu ON cu.id = p.customer_id
     LEFT JOIN time_entries t ON t.project_id = p.id
     WHERE p.company_id = $1 AND ($2::text IS NULL OR p.status = $2)
     GROUP BY p.id, cu.name
     ORDER BY p.status ASC, p.number DESC`,
    [companyId, opts.status ?? null],
  );
  return res.rows;
}

export async function getProject(
  client: PoolClient, companyId: string, id: string,
): Promise<Record<string, unknown>> {
  const head = await client.query(
    `SELECT p.id, p.number, p.name, p.status, p.hourly_rate_ore, p.budget_ore, p.notes,
            p.customer_id, cu.name AS customer_name
     FROM projects p LEFT JOIN customers cu ON cu.id = p.customer_id
     WHERE p.id = $1 AND p.company_id = $2`,
    [id, companyId],
  );
  if (!head.rows[0]) throw new NotFoundError('project');
  const project = head.rows[0];
  const entries = await client.query<{ minutes: number; billable: boolean; hourly_rate_ore: number | null }>(
    `SELECT id, work_date::text, minutes, description, billable, invoiced, hourly_rate_ore
     FROM time_entries WHERE project_id = $1 AND company_id = $2 ORDER BY work_date DESC, created_at DESC`,
    [id, companyId],
  );
  const projectRate = (project.hourly_rate_ore as number | null) ?? null;
  let totalMinutes = 0, billableMinutes = 0, billableAmountOre = 0;
  for (const e of entries.rows) {
    totalMinutes += e.minutes;
    if (e.billable) {
      billableMinutes += e.minutes;
      billableAmountOre += timeEntryAmountOre(e.minutes, e.hourly_rate_ore ?? projectRate);
    }
  }
  return {
    ...project,
    entries: entries.rows,
    summary: {
      total_minutes: totalMinutes,
      billable_minutes: billableMinutes,
      billable_amount_ore: billableAmountOre,
    },
  };
}

export async function createTimeEntry(
  client: PoolClient, companyId: string, userId: string, input: CreateTimeEntryInput,
): Promise<Record<string, unknown>> {
  const p = await client.query<{ status: string }>(
    'SELECT status FROM projects WHERE id = $1 AND company_id = $2', [input.project_id, companyId],
  );
  if (!p.rows[0]) throw new NotFoundError('project');
  if (p.rows[0].status === 'closed') throw new BadRequestError('project_closed', 'projektet är stängt');
  if (!Number.isInteger(input.minutes) || input.minutes <= 0 || input.minutes > 1440) {
    throw new BadRequestError('invalid_minutes', 'minuter måste vara 1–1440');
  }
  const row = await client.query<{ id: string }>(
    `INSERT INTO time_entries (company_id, project_id, work_date, minutes, description, hourly_rate_ore, billable, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [companyId, input.project_id, input.work_date, input.minutes, input.description,
      input.hourly_rate_ore ?? null, input.billable ?? true, userId],
  );
  const id = row.rows[0]!.id;
  await writeAudit(client, {
    companyId, userId, action: 'time_entry.created', entityType: 'time_entry', entityId: id,
    details: { project_id: input.project_id, minutes: input.minutes },
  });
  return { id, project_id: input.project_id, minutes: input.minutes };
}
