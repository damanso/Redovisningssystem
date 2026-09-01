// Fas A6: projekt & tidrapportering. Projekt knyts valfritt till en kund och har
// en valfri timtaxa/budget. Tidposter loggas i minuter mot ett projekt. Belopp
// beräknas i ören som round(minuter/60 * timtaxa), aldrig float i lagring.
import type { PoolClient } from 'pg';
import { BadRequestError, ConflictError, NotFoundError } from '../lib/errors.js';
import { buildAllowlistedUpdate } from '../lib/updateBuilder.js';
import { writeAudit } from './auditService.js';
import { nextDocumentNumber } from './accounting/numbering.js';
import { resolveTimeEntryActor } from './workActors.js';

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
  /** Pris mot kund (override av projektets taxa). */
  hourly_rate_ore?: number;
  billable?: boolean;
  /** Vem som UTFÖRDE arbetet. Utelämnad = den inloggade användarens aktör. */
  performed_by_actor_id?: string;
  /** Vad timmen kostar OSS. Utelämnad = aktörens standardtaxa vid registreringen. */
  cost_rate_ore?: number;
  /** Vad som faktureras. Utelämnad = minutes. Skiljer den sig krävs en orsak. */
  billable_minutes?: number;
  adjustment_reason?: string;
}

export interface UpdateTimeEntryInput {
  time_entry_id: string;
  work_date?: string;
  minutes?: number;
  billable_minutes?: number;
  description?: string;
  status?: TimeEntryStatus;
  adjustment_reason?: string;
}

export interface ListTimeEntriesInput {
  project_id?: string;
  status?: TimeEntryStatus;
  from?: string;
  to?: string;
  performed_by_actor_id?: string;
}

export type TimeEntryStatus = 'forslag' | 'godkand' | 'justerad' | 'ignorerad' | 'fakturerad';

/**
 * Tillåtna statusbyten (PRD §3.1). 'fakturerad' saknas både som mål och som
 * källa, och det är hela poängen: dit tar bara fakturaflödet en post
 * (invoiceAppendix), och därifrån tar bara en kreditering den. Ett byte som
 * inte står här är inte "ännu inte stött" — det är förbjudet.
 *
 * `godkand → ignorerad` finns med trots att kravtexten skriver kedjan som
 * godkand↔justerad↔ignorerad: PRD §1 rad 2 är just fallet "den här godkända
 * posten skulle aldrig faktureras", och att tvinga en omväg via 'justerad'
 * hade gjort spåret otydligare, inte säkrare.
 */
const ALLOWED_TRANSITIONS: Readonly<Record<TimeEntryStatus, readonly TimeEntryStatus[]>> = {
  forslag: ['godkand', 'justerad', 'ignorerad'],
  godkand: ['justerad', 'ignorerad'],
  justerad: ['godkand', 'ignorerad'],
  ignorerad: ['godkand', 'justerad'],
  fakturerad: [],
};

/**
 * De gamla booleanerna härleds ur statusen och skrivs i SAMMA sats som den.
 * De är inte en andra sanning utan en projektion: RLS-policyn i 0053 och sex
 * läsande frågor (projects.ts, steering.ts, crmDerivations.ts, vyn) bygger på
 * dem. Att låta dem glida isär från statusen vore exakt den tysta nolla PRD:n
 * finns för att stänga.
 */
function legacyFlags(status: TimeEntryStatus): { billable: boolean; invoiced: boolean } {
  return { billable: status !== 'ignorerad', invoiced: status === 'fakturerad' };
}

const TIME_ENTRY_COLUMNS = `id, project_id, work_date::text AS work_date, minutes, billable_minutes,
        description, status, source, source_ref, adjustment_reason, approved_by, approved_at,
        invoice_id, billable, invoiced, hourly_rate_ore, cost_rate_ore, performed_by_actor_id`;

const TIME_ENTRY_UPDATE = {
  work_date: 'work_date',
  minutes: 'minutes',
  billable_minutes: 'billable_minutes',
  description: 'description',
  status: 'status',
  adjustment_reason: 'adjustment_reason',
} as const;

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
            p.customer_id, cu.name AS customer_name,
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
  const entries = await client.query<{
    minutes: number; billable: boolean; hourly_rate_ore: number | null;
    cost_rate_ore: number | null; performed_by_actor_id: string | null; performed_by: string | null;
  }>(
    `SELECT t.id, t.work_date::text, t.minutes, t.description, t.billable, t.invoiced, t.hourly_rate_ore,
            t.cost_rate_ore, t.performed_by_actor_id, a.name AS performed_by
     FROM time_entries t
     LEFT JOIN work_actors a ON a.id = t.performed_by_actor_id AND a.company_id = t.company_id
     WHERE t.project_id = $1 AND t.company_id = $2 ORDER BY t.work_date DESC, t.created_at DESC`,
    [id, companyId],
  );
  const projectRate = (project.hourly_rate_ore as number | null) ?? null;
  let totalMinutes = 0, billableMinutes = 0, billableAmountOre = 0, costAmountOre = 0;
  // Beläggning och marginal per aktör (E7a). Intäkten räknas bara på
  // fakturerbar tid; KOSTNADEN räknas på all tid — en timme som inte går att
  // fakturera kostar precis lika mycket, och det är hela poängen med måttet.
  const perActor = new Map<string, {
    actor_id: string | null; name: string;
    minutes: number; billable_minutes: number; amount_ore: number; cost_ore: number; margin_ore: number;
  }>();
  for (const e of entries.rows) {
    totalMinutes += e.minutes;
    const cost = timeEntryAmountOre(e.minutes, e.cost_rate_ore);
    costAmountOre += cost;
    const revenue = e.billable ? timeEntryAmountOre(e.minutes, e.hourly_rate_ore ?? projectRate) : 0;
    if (e.billable) {
      billableMinutes += e.minutes;
      billableAmountOre += revenue;
    }
    const key = e.performed_by_actor_id ?? '';
    const bucket = perActor.get(key) ?? {
      actor_id: e.performed_by_actor_id, name: e.performed_by ?? 'Okänd aktör',
      minutes: 0, billable_minutes: 0, amount_ore: 0, cost_ore: 0, margin_ore: 0,
    };
    bucket.minutes += e.minutes;
    if (e.billable) bucket.billable_minutes += e.minutes;
    bucket.amount_ore += revenue;
    bucket.cost_ore += cost;
    bucket.margin_ore = bucket.amount_ore - bucket.cost_ore;
    perActor.set(key, bucket);
  }
  return {
    ...project,
    entries: entries.rows,
    summary: {
      total_minutes: totalMinutes,
      billable_minutes: billableMinutes,
      billable_amount_ore: billableAmountOre,
      cost_amount_ore: costAmountOre,
      margin_ore: billableAmountOre - costAmountOre,
    },
    by_actor: [...perActor.values()].sort((a, b) => b.minutes - a.minutes),
  };
}

export async function createTimeEntry(
  client: PoolClient, companyId: string, userId: string, input: CreateTimeEntryInput,
  actorKind: 'human' | 'agent' = 'human',
): Promise<Record<string, unknown>> {
  const p = await client.query<{ status: string }>(
    'SELECT status FROM projects WHERE id = $1 AND company_id = $2', [input.project_id, companyId],
  );
  if (!p.rows[0]) throw new NotFoundError('project');
  if (p.rows[0].status === 'closed') throw new BadRequestError('project_closed', 'projektet är stängt');
  if (!Number.isInteger(input.minutes) || input.minutes <= 0 || input.minutes > 1440) {
    throw new BadRequestError('invalid_minutes', 'minuter måste vara 1–1440');
  }
  // Aktören härleds ur den inloggade användaren när den inte anges — ingen ska
  // behöva komma ihåg att fylla i vem som utförde arbetet. created_by (vem som
  // REGISTRERADE posten) sätts oförändrat vid sidan om.
  const actor = await resolveTimeEntryActor(client, companyId, userId, input.performed_by_actor_id);
  // Kostnaden fryses vid registreringen. Att i stället läsa aktörens taxa vid
  // rapporttillfället hade ändrat historiska marginaler — och det vi är skyldiga
  // en underkonsult för utfört arbete ändras inte för att taxan höjs i morgon.
  const costRate = input.cost_rate_ore ?? actor.cost_rate_ore ?? null;

  // Sanningsanspråket avgör tillståndet: AI:t FÖRESLÅR, en människa GODKÄNNER.
  // Samma actor-begrepp som ursprungsmärkningen i CRM (F4) — behörigheten är
  // densamma, påståendet är det inte.
  //
  // `billable: false` är den gamla vägens sätt att säga "den här ska inte
  // faktureras", och det är exakt vad 'ignorerad' betyder. Att låta den skriva
  // 'godkand' hade fått synken i legacyFlags() att sätta tillbaka billable=true
  // i samma sats — en tyst omtolkning av det anroparen bad om.
  const status: TimeEntryStatus =
    input.billable === false ? 'ignorerad' : actorKind === 'human' ? 'godkand' : 'forslag';
  const billableMinutes = status === 'ignorerad' ? 0 : input.billable_minutes ?? input.minutes;
  if (input.billable_minutes !== undefined
      && input.billable_minutes !== input.minutes
      && !input.adjustment_reason) {
    throw new BadRequestError(
      'adjustment_reason_required',
      'debiterbara minuter skiljer sig från registrerade — ange adjustment_reason',
    );
  }
  const flags = legacyFlags(status);
  const approved = status === 'godkand' || status === 'justerad';

  const row = await client.query<{ id: string }>(
    `INSERT INTO time_entries (company_id, project_id, work_date, minutes, billable_minutes, description,
                               hourly_rate_ore, billable, invoiced, status, adjustment_reason,
                               approved_by, approved_at, performed_by_actor_id, cost_rate_ore, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,
             CASE WHEN $12::uuid IS NULL THEN NULL ELSE now() END,
             $13,$14,$15) RETURNING id`,
    [companyId, input.project_id, input.work_date, input.minutes, billableMinutes, input.description,
      input.hourly_rate_ore ?? null, flags.billable, flags.invoiced, status,
      input.adjustment_reason ?? null, approved ? userId : null,
      actor.id, costRate, userId],
  );
  const id = row.rows[0]!.id;
  await writeAudit(client, {
    companyId, userId, action: 'time_entry.created', entityType: 'time_entry', entityId: id,
    details: {
      project_id: input.project_id, minutes: input.minutes, billable_minutes: billableMinutes,
      status, actor: actorKind, performed_by: actor.id,
    },
  });
  return {
    id, project_id: input.project_id, minutes: input.minutes, billable_minutes: billableMinutes,
    status, performed_by_actor_id: actor.id, performed_by_name: actor.name, cost_rate_ore: costRate,
  };
}

export async function getTimeEntry(
  client: PoolClient, companyId: string, id: string,
): Promise<Record<string, unknown>> {
  const res = await client.query(
    `SELECT ${TIME_ENTRY_COLUMNS} FROM time_entries WHERE id = $1 AND company_id = $2`,
    [id, companyId],
  );
  if (!res.rows[0]) throw new NotFoundError('time_entry');
  return res.rows[0];
}

/**
 * Ändrar en tidpost som ännu inte är fakturerad.
 *
 * Låsningen är det viktiga: en fakturerad post är underlag till ett skickat
 * dokument. Den ändras inte, den krediteras. Därför 409 i stället för att tyst
 * ignorera fältet — ett tyst nej ser ut som ett ja.
 */
export async function updateTimeEntry(
  client: PoolClient, companyId: string, userId: string, input: UpdateTimeEntryInput,
): Promise<Record<string, unknown>> {
  const { time_entry_id: id, ...fields } = input;
  // FOR UPDATE: statusen läses och skrivs i samma transaktion, så två samtidiga
  // ändringar kan inte båda tro att posten var 'godkand'.
  const cur = await client.query<{ status: TimeEntryStatus; adjustment_reason: string | null }>(
    'SELECT status, adjustment_reason FROM time_entries WHERE id = $1 AND company_id = $2 FOR UPDATE',
    [id, companyId],
  );
  const row = cur.rows[0];
  if (!row) throw new NotFoundError('time_entry');
  if (row.status === 'fakturerad') {
    throw new ConflictError(
      'time_entry_locked',
      'posten är fakturerad och kan inte ändras — en fakturerad timme rättas genom kreditering',
    );
  }

  const next = fields.status ?? row.status;
  if (fields.status && fields.status !== row.status
      && !ALLOWED_TRANSITIONS[row.status].includes(fields.status)) {
    throw new ConflictError(
      'invalid_status_transition',
      `${row.status} → ${fields.status} är inte ett tillåtet byte` +
        (fields.status === 'fakturerad' ? ' — posten blir fakturerad först när den kommer med på en faktura' : ''),
    );
  }
  const reason = fields.adjustment_reason ?? row.adjustment_reason;
  if ((next === 'justerad' || next === 'ignorerad') && !reason) {
    throw new BadRequestError(
      'adjustment_reason_required',
      `status '${next}' kräver adjustment_reason — en avvikelse utan skäl går inte att granska i efterhand`,
    );
  }

  const update = buildAllowlistedUpdate(TIME_ENTRY_UPDATE, fields as Record<string, unknown>);
  if (!update) return getTimeEntry(client, companyId, id);

  // Kolumnnamnen nedan är literaler i vår egen kod (allowlist-invarianten);
  // synken av de gamla booleanerna läggs på som parametrar i SAMMA sats, aldrig
  // som en andra UPDATE som kan misslyckas för sig.
  const flags = legacyFlags(next);
  const values: unknown[] = [...update.values, flags.billable, flags.invoiced];
  let setSql = `${update.setSql}, billable = $${values.length - 1}, invoiced = $${values.length}`;
  if ((next === 'godkand' || next === 'justerad') && next !== row.status) {
    values.push(userId);
    setSql += `, approved_by = $${values.length}, approved_at = now()`;
  }
  values.push(id, companyId);
  const res = await client.query(
    `UPDATE time_entries SET ${setSql}
      WHERE id = $${values.length - 1} AND company_id = $${values.length}
      RETURNING ${TIME_ENTRY_COLUMNS}`,
    values,
  );
  if (!res.rows[0]) throw new NotFoundError('time_entry');

  await writeAudit(client, {
    companyId, userId, action: 'time_entry.updated', entityType: 'time_entry', entityId: id,
    details: { fields: Object.keys(fields), from_status: row.status, to_status: next },
  });
  return res.rows[0];
}

export async function listTimeEntries(
  client: PoolClient, companyId: string, opts: ListTimeEntriesInput = {},
): Promise<Record<string, unknown>[]> {
  const res = await client.query(
    `SELECT t.id, t.project_id, p.name AS project_name, t.work_date::text AS work_date,
            t.minutes, t.billable_minutes, t.description, t.status, t.source, t.source_ref,
            t.adjustment_reason, t.approved_by, t.approved_at, t.invoice_id,
            t.billable, t.invoiced, t.hourly_rate_ore, t.cost_rate_ore,
            t.performed_by_actor_id, a.name AS performed_by
     FROM time_entries t
     JOIN projects p ON p.id = t.project_id AND p.company_id = t.company_id
     LEFT JOIN work_actors a ON a.id = t.performed_by_actor_id AND a.company_id = t.company_id
     WHERE t.company_id = $1
       AND ($2::uuid IS NULL OR t.project_id = $2)
       AND ($3::text IS NULL OR t.status = $3)
       AND ($4::date IS NULL OR t.work_date >= $4)
       AND ($5::date IS NULL OR t.work_date <= $5)
       AND ($6::uuid IS NULL OR t.performed_by_actor_id = $6)
     ORDER BY t.work_date DESC, t.created_at DESC`,
    [companyId, opts.project_id ?? null, opts.status ?? null,
      opts.from ?? null, opts.to ?? null, opts.performed_by_actor_id ?? null],
  );
  return res.rows;
}
