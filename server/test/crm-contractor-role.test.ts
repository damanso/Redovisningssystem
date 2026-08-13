// CRM E2 (del 2) — rollmodellen för underkonsulter.
//
// Beslut B3: den första underkonsulten kommer inom sex månader och ska se SINA
// EGNA uppdrag, inte hela bolaget. UI:t byggs i E7b — men datamodellen ska bära
// det nu, och den ska bära det FAIL-CLOSED.
//
// Det farliga vore att bara lägga till en roll: alla befintliga RLS-policyer
// frågar app_has_company_access, så en ny roll hade fått läsa fakturor, löner
// och bokföring från dag ett. Testerna nedan mäter i DATABASEN, med rollens
// egen identitet i RLS-kontexten — inte bara genom API:t, som redan har ett
// eget lager. Går RLS sönder ska det synas här.
import supertest from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../src/db/pool.js';
import { api, app, createCompany, registerUser, type TestUser } from './helpers.js';

const PASSWORD = 'mycket-hemligt-losen-123';
let owner: TestUser;
let contractor: TestUser;
let colleague: TestUser;
let companyId: string;
let assignedProject: string;
let secretProject: string;
let contractorActorId: string;
let ownActorId: string;

const auth = () => ({ Authorization: `Bearer ${owner.token}` });
const co = () => `/api/companies/${companyId}`;
const act = (name: string, body: Record<string, unknown> = {}) =>
  api.post(`${co()}/actions/${name}`).set(auth()).send(body);

/** Kör en fråga som app-rollen MED en viss användares RLS-kontext. */
async function asUser<T>(userId: string, fn: (q: (sql: string, params?: unknown[]) => Promise<{ rows: T[]; rowCount: number | null }>) => Promise<void>): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.user_id', $1, true), set_config('app.company_id', $2, true)",
      [userId, companyId]);
    await fn((sql, params) => client.query(sql, params) as never);
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
}

async function invite(email: string, role: string): Promise<void> {
  const ua = supertest.agent(app);
  await ua.post('/app/login').type('form').send({ email: owner.email, password: PASSWORD });
  const res = await ua.post(`/app/c/${companyId}/team/invite`).type('form').send({ email, role });
  expect(res.status, `inbjudan misslyckades: ${res.status}`).toBe(302);
}

beforeAll(async () => {
  owner = await registerUser('agare');
  contractor = await registerUser('underkonsult');
  colleague = await registerUser('kollega');
  companyId = await createCompany(owner.token, 'Locollabs AB');

  const cust = await api.post(`${co()}/customers`).set(auth()).send({ name: 'Nordic Vision Retail AB' });
  expect(cust.status).toBe(201);

  const p1 = await act('create_project', { name: 'Uppdraget hen fått', hourly_rate_ore: 110_000 });
  assignedProject = p1.body.result.id;
  const p2 = await act('create_project', { name: 'Hemliga projektet', hourly_rate_ore: 150_000 });
  secretProject = p2.body.result.id;

  // Ägarens egen tid på det tilldelade projektet (aktören skapas automatiskt).
  const own = await act('log_time', {
    project_id: assignedProject, work_date: '2026-08-01', minutes: 60, description: 'Ägarens egen tid',
  });
  ownActorId = own.body.result.performed_by_actor_id;

  const a = await act('upsert_work_actor', { name: 'Kim Underkonsult', kind: 'subcontractor', cost_rate_ore: 60_000 });
  contractorActorId = a.body.result.id;
  await act('log_time', {
    project_id: assignedProject, work_date: '2026-08-02', minutes: 120,
    description: 'Underkonsultens tid', performed_by_actor_id: contractorActorId,
  });
  await act('log_time', {
    project_id: secretProject, work_date: '2026-08-03', minutes: 45, description: 'Tid i hemliga projektet',
  });

  await invite(contractor.email, 'contractor');
  await invite(colleague.email, 'member');

  // Kopplingen aktör→användare finns inte förrän kontot gör det. Ägaren gör den
  // efter inbjudan; tjänstelagret kräver att målanvändaren ÄR medlem.
  const link = await act('set_work_actor_user', { actor_id: contractorActorId, user_id: contractor.userId });
  expect(link.status, JSON.stringify(link.body)).toBe(200);
  const assign = await act('assign_project_actor', { project_id: assignedProject, actor_id: contractorActorId });
  expect(assign.status, JSON.stringify(assign.body)).toBe(200);
});

describe('underkonsulten är stängd ute från bolagets data', () => {
  it('rollen räknas inte som bolagsåtkomst — inga kunder, fakturor eller verifikat', async () => {
    await asUser(contractor.userId, async (q) => {
      expect((await q('SELECT id FROM companies WHERE id = $1', [companyId])).rowCount).toBe(0);
      expect((await q('SELECT id FROM customers WHERE company_id = $1', [companyId])).rowCount).toBe(0);
      expect((await q('SELECT id FROM invoices WHERE company_id = $1', [companyId])).rowCount).toBe(0);
      expect((await q('SELECT id FROM vouchers WHERE company_id = $1', [companyId])).rowCount).toBe(0);
      expect((await q('SELECT id FROM employees WHERE company_id = $1', [companyId])).rowCount).toBe(0);
      expect((await q('SELECT id FROM crm.organizations WHERE company_id = $1', [companyId])).rowCount).toBe(0);
    });
  });

  it('en vanlig medlem ser däremot allt som förut — spärren träffar bara rollen', async () => {
    await asUser(colleague.userId, async (q) => {
      expect((await q('SELECT id FROM companies WHERE id = $1', [companyId])).rowCount).toBe(1);
      expect((await q('SELECT id FROM customers WHERE company_id = $1', [companyId])).rowCount).toBe(1);
      expect((await q('SELECT id FROM projects WHERE company_id = $1', [companyId])).rowCount).toBe(2);
    });
  });

  it('men den egna medlemsraden syns — annars finns ingen väg in för E7b', async () => {
    await asUser(contractor.userId, async (q) => {
      const r = await q('SELECT role FROM company_members WHERE company_id = $1 AND user_id = $2',
        [companyId, contractor.userId]);
      expect(r.rowCount).toBe(1);
      expect((r.rows[0] as { role: string }).role).toBe('contractor');
      // ...och bara den egna. Kollegornas medlemskap är inte hens sak.
      expect((await q('SELECT user_id FROM company_members WHERE company_id = $1', [companyId])).rowCount).toBe(1);
    });
  });

  it('webbvyn läcker inget heller — sidorna finns inte för rollen', async () => {
    const cua = supertest.agent(app);
    const login = await cua.post('/app/login').type('form')
      .send({ email: contractor.email, password: PASSWORD });
    expect(login.status).toBe(302); // inloggningen fungerar — rollen finns
    for (const path of ['', 'invoices', 'relations', 'steering']) {
      const res = await cua.get(`/app/c/${companyId}/${path}`);
      // 404, aldrig 200 och aldrig 500: bolaget ska inte ens synas existera.
      expect(res.status, `/${path}`).toBe(404);
    }
  });

  it('inga åtgärder får köras — tydligt 403 i stället för tomma listor', async () => {
    const res = await api.post(`${co()}/actions/list_customers`)
      .set({ Authorization: `Bearer ${contractor.token}` }).send({});
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('contractor_not_permitted');

    const write = await api.post(`${co()}/actions/create_customer`)
      .set({ Authorization: `Bearer ${contractor.token}` }).send({ name: 'Smygkund AB' });
    expect(write.status).toBe(403);
  });
});

describe('...men ser sina egna uppdrag', () => {
  it('det tilldelade projektet syns, det otilldelade inte', async () => {
    await asUser(contractor.userId, async (q) => {
      const rows = await q('SELECT id FROM projects WHERE company_id = $1', [companyId]);
      expect(rows.rowCount).toBe(1);
      expect((rows.rows[0] as { id: string }).id).toBe(assignedProject);
      expect((await q('SELECT id FROM projects WHERE id = $1', [secretProject])).rowCount).toBe(0);
    });
  });

  it('bara sin EGEN tid på uppdraget — inte kollegornas', async () => {
    await asUser(contractor.userId, async (q) => {
      const rows = await q<{ description: string }>('SELECT description FROM time_entries WHERE company_id = $1', [companyId]);
      expect(rows.rowCount).toBe(1);
      expect(rows.rows[0].description).toBe('Underkonsultens tid');
    });
  });

  it('en borttagen tilldelning stänger dörren igen', async () => {
    const off = await act('unassign_project_actor', { project_id: assignedProject, actor_id: contractorActorId });
    expect(off.body.result.removed).toBe(true);
    await asUser(contractor.userId, async (q) => {
      expect((await q('SELECT id FROM projects WHERE company_id = $1', [companyId])).rowCount).toBe(0);
      expect((await q('SELECT id FROM time_entries WHERE company_id = $1', [companyId])).rowCount).toBe(0);
    });
    const on = await act('assign_project_actor', { project_id: assignedProject, actor_id: contractorActorId });
    expect(on.body.result.assigned).toBe(true);
  });

  it('en inaktiverad aktör tappar åtkomsten även med tilldelningen kvar', async () => {
    await act('upsert_work_actor', { name: 'Kim Underkonsult', active: false });
    await asUser(contractor.userId, async (q) => {
      expect((await q('SELECT id FROM projects WHERE company_id = $1', [companyId])).rowCount).toBe(0);
    });
    await act('upsert_work_actor', { name: 'Kim Underkonsult', active: true });
  });
});

describe('tilldelningen är en behörighetsåtgärd', () => {
  it('en vanlig medlem kan inte tilldela uppdrag', async () => {
    const res = await api.post(`${co()}/actions/assign_project_actor`)
      .set({ Authorization: `Bearer ${colleague.token}` })
      .send({ project_id: secretProject, actor_id: ownActorId });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('not_admin');
  });

  it('...och databasen säger nej även om tjänstelagret skulle kringgås', async () => {
    await asUser(colleague.userId, async (q) => {
      await expect(q(
        'INSERT INTO project_assignments (company_id, project_id, actor_id) VALUES ($1,$2,$3)',
        [companyId, secretProject, ownActorId],
      )).rejects.toThrow(/row-level security|policy/i);
    });
  });

  it('ägaren ser tilldelningarna med projekt och aktör', async () => {
    const list = await act('list_project_assignments', {});
    expect(list.status, JSON.stringify(list.body)).toBe(200);
    expect(list.body.result).toHaveLength(1);
    expect(list.body.result[0].actor_name).toBe('Kim Underkonsult');
    expect(list.body.result[0].project_name).toBe('Uppdraget hen fått');
  });
});
