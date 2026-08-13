// CRM E7a: aktörer — vem som UTFÖR arbetet, och vad timmen kostar oss.
//
// Skild från `users` med flit: en underkonsult ska kunna få tid registrerad på
// sig långt innan hen har (eller ska ha) en inloggning. Och skild från
// time_entries.created_by, som betyder "vem registrerade posten" — den
// betydelsen ändras inte här.
//
// Härledningskälla (projektets huvudregel: ingen inmatning får kräva att en
// människa kommer ihåg något): aktören på en tidpost sätts automatiskt till den
// inloggade användarens aktör, som skapas vid första tidposten. Kostnaden
// hämtas från aktörens standardtaxa. Ingen behöver fylla i något.
import type { PoolClient } from 'pg';
import { BadRequestError, NotFoundError } from '../lib/errors.js';
import { writeAudit } from './auditService.js';

export type ActorKind = 'internal' | 'subcontractor';

export interface WorkActor {
  id: string;
  name: string;
  kind: ActorKind;
  user_id: string | null;
  employee_id: string | null;
  supplier_id: string | null;
  cost_rate_ore: number | null;
  active: boolean;
  notes: string | null;
}

const COLUMNS = `id, name, kind, user_id, employee_id, supplier_id, cost_rate_ore, active, notes`;

export interface UpsertWorkActorInput {
  name: string;
  kind?: ActorKind;
  employee_id?: string;
  supplier_id?: string;
  cost_rate_ore?: number;
  active?: boolean;
  notes?: string;
}

async function assertLinks(client: PoolClient, companyId: string, input: UpsertWorkActorInput): Promise<void> {
  if (input.employee_id) {
    const r = await client.query('SELECT 1 FROM employees WHERE id = $1 AND company_id = $2', [input.employee_id, companyId]);
    if (!r.rows[0]) throw new NotFoundError('employee');
  }
  if (input.supplier_id) {
    const r = await client.query('SELECT 1 FROM suppliers WHERE id = $1 AND company_id = $2', [input.supplier_id, companyId]);
    if (!r.rows[0]) throw new NotFoundError('supplier');
  }
}

/**
 * Idempotent skrivning, samma princip som kontakterna i E1: körs synken två
 * gånger ska aktören UPPDATERAS, inte dubbleras. Nyckeln är namnet inom
 * bolaget (skiftlägesokänsligt), och databasens unik-index är sista spärren.
 *
 * Angivna fält skrivs, övriga lämnas — en synk utan kostnadstaxa får inte nolla
 * en taxa någon annan satt.
 *
 * user_id går medvetet INTE att sätta härifrån. Kopplingen aktör→användare
 * kommer att styra åtkomst (E7b), och app-rollen kan enligt RLS bara se sitt
 * EGET medlemskap — den kan alltså inte verifiera att ett inskickat user_id
 * hör till bolaget. Kopplingen sätts därför bara av `ensureActorForUser`, för
 * den inloggade användaren, som per definition är medlem.
 */
export async function upsertWorkActor(
  client: PoolClient, companyId: string, userId: string, input: UpsertWorkActorInput,
): Promise<WorkActor & { created: boolean }> {
  const name = input.name.trim();
  if (!name) throw new BadRequestError('invalid_name', 'namnet får inte vara tomt');
  await assertLinks(client, companyId, input);

  const found = await client.query<{ id: string }>(
    'SELECT id FROM work_actors WHERE company_id = $1 AND lower(name) = lower($2) FOR UPDATE',
    [companyId, name],
  );
  const hit = found.rows[0];

  if (!hit) {
    const r = await client.query<WorkActor>(
      `INSERT INTO work_actors (company_id, name, kind, employee_id, supplier_id, cost_rate_ore, active, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING ${COLUMNS}`,
      [companyId, name, input.kind ?? 'internal', input.employee_id ?? null, input.supplier_id ?? null,
        input.cost_rate_ore ?? null, input.active ?? true, input.notes ?? null, userId],
    );
    await writeAudit(client, {
      companyId, userId, action: 'work_actor.created', entityType: 'work_actor', entityId: r.rows[0]!.id,
      details: { name, kind: r.rows[0]!.kind },
    });
    return { ...r.rows[0]!, created: true };
  }

  const r = await client.query<WorkActor>(
    `UPDATE work_actors SET
       name          = $3,
       kind          = COALESCE($4, kind),
       employee_id   = COALESCE($5, employee_id),
       supplier_id   = COALESCE($6, supplier_id),
       cost_rate_ore = COALESCE($7, cost_rate_ore),
       active        = COALESCE($8, active),
       notes         = COALESCE($9, notes)
     WHERE id = $1 AND company_id = $2 RETURNING ${COLUMNS}`,
    [hit.id, companyId, name, input.kind ?? null, input.employee_id ?? null, input.supplier_id ?? null,
      input.cost_rate_ore ?? null, input.active ?? null, input.notes ?? null],
  );
  await writeAudit(client, {
    companyId, userId, action: 'work_actor.updated', entityType: 'work_actor', entityId: hit.id,
    details: { name },
  });
  return { ...r.rows[0]!, created: false };
}

export async function listWorkActors(
  client: PoolClient, companyId: string, opts: { active?: boolean } = {},
): Promise<WorkActor[]> {
  const r = await client.query<WorkActor>(
    `SELECT ${COLUMNS} FROM work_actors
     WHERE company_id = $1 AND ($2::boolean IS NULL OR active = $2)
     ORDER BY active DESC, name`,
    [companyId, opts.active ?? null],
  );
  return r.rows;
}

export async function getWorkActor(client: PoolClient, companyId: string, id: string): Promise<WorkActor> {
  const r = await client.query<WorkActor>(
    `SELECT ${COLUMNS} FROM work_actors WHERE id = $1 AND company_id = $2`, [id, companyId],
  );
  if (!r.rows[0]) throw new NotFoundError('work_actor');
  return r.rows[0];
}

/**
 * Aktören för den inloggade användaren — skapas vid behov. Det här är
 * tvingfunktionen: varje tidpost får en aktör utan att någon ombeds fylla i
 * den. Namnet tas från användarprofilen; krockar det med en befintlig aktör
 * (två personer med samma namn) används e-posten, som är unik per användare.
 */
export async function ensureActorForUser(
  client: PoolClient, companyId: string, userId: string,
): Promise<WorkActor> {
  const existing = await client.query<WorkActor>(
    `SELECT ${COLUMNS} FROM work_actors WHERE company_id = $1 AND user_id = $2`, [companyId, userId],
  );
  if (existing.rows[0]) return existing.rows[0];

  const u = await client.query<{ name: string | null; email: string }>(
    'SELECT name, email FROM users WHERE id = $1', [userId],
  );
  if (!u.rows[0]) throw new NotFoundError('user');
  const profileName = u.rows[0].name?.trim();
  const candidates = profileName ? [profileName, u.rows[0].email] : [u.rows[0].email];

  for (const candidate of candidates) {
    const r = await client.query<WorkActor>(
      `INSERT INTO work_actors (company_id, name, kind, user_id, created_by)
       VALUES ($1, $2, 'internal', $3, $3)
       ON CONFLICT DO NOTHING RETURNING ${COLUMNS}`,
      [companyId, candidate, userId],
    );
    if (r.rows[0]) {
      await writeAudit(client, {
        companyId, userId, action: 'work_actor.created', entityType: 'work_actor', entityId: r.rows[0].id,
        details: { name: candidate, kind: 'internal', derived_from: 'user' },
      });
      return r.rows[0];
    }
    // Krocken kan bero på namnet ELLER på att en samtidig transaktion hann
    // skapa användarens aktör. Läs om innan nästa kandidat provas.
    const again = await client.query<WorkActor>(
      `SELECT ${COLUMNS} FROM work_actors WHERE company_id = $1 AND user_id = $2`, [companyId, userId],
    );
    if (again.rows[0]) return again.rows[0];
  }
  throw new BadRequestError(
    'actor_name_conflict',
    'kunde inte skapa en aktör för användaren — namnet är redan upptaget av en annan aktör',
  );
}

/**
 * Aktören som ska stå på en tidpost: den explicit angivna, annars den
 * inloggade användarens. En explicit aktör måste finnas i bolaget och vara
 * aktiv — annars hade inaktiverade aktörer kunnat få ny tid i tysthet.
 */
export async function resolveTimeEntryActor(
  client: PoolClient, companyId: string, userId: string, actorId?: string,
): Promise<WorkActor> {
  if (!actorId) return ensureActorForUser(client, companyId, userId);
  const actor = await getWorkActor(client, companyId, actorId);
  if (!actor.active) throw new BadRequestError('actor_inactive', 'aktören är inaktiverad');
  return actor;
}
