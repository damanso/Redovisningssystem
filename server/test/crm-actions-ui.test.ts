// Relationsytan F1 — handgreppen.
//
// Diagnosen ur designunderlaget: vyn hade 47 POST-rutter för fakturor och lön
// men NOLL för relationer. Varje handgrepp, även "markera klar", krävde AI
// eller API. Det är den strukturella orsaken till att ytan kändes död.
//
// Testerna nedan mäter det som saknades: att ett klick i webbläsaren räcker,
// att det går genom samma godkännande- och auditkedja som AI-vägen, och att
// uppskjutning ALDRIG skriver om vad som lovades.
import supertest from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { api, app, createCompany, registerUser, withAdmin, type TestUser } from './helpers.js';

const PASSWORD = 'mycket-hemligt-losen-123';
let user: TestUser;
let companyId: string;
let orgId: string;
let ua: ReturnType<typeof supertest.agent>;
const auth = () => ({ Authorization: `Bearer ${user.token}` });
const co = () => `/api/companies/${companyId}`;
const act = (name: string, body: Record<string, unknown> = {}) =>
  api.post(`${co()}/actions/${name}`).set(auth()).send(body);

async function newCommitment(body: string, due: string): Promise<string> {
  const res = await act('record_crm_commitment', {
    organization_id: orgId, direction: 'we_owe', body, due_date: due,
    occurred_at: '2026-08-01T09:00:00Z', source_system: 'manual',
  });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.result.id as string;
}

const openCommitments = async (): Promise<Record<string, unknown>[]> =>
  (await act('list_crm_commitments', { status: 'open' })).body.result;

beforeAll(async () => {
  user = await registerUser('handgrepp');
  companyId = await createCompany(user.token, 'Locollabs AB');
  const org = await act('upsert_crm_organization', { name: 'Nordic Vision Retail AB' });
  expect(org.status, JSON.stringify(org.body)).toBe(200);
  orgId = org.body.result.id;

  ua = supertest.agent(app);
  await ua.post('/app/login').type('form').send({ email: user.email, password: PASSWORD });
});

describe('ett klick räcker — ingen AI, inga tokens', () => {
  it('markerar ett åtagande klart direkt från listan', async () => {
    const id = await newCommitment('Skicka tidplan för fas 2.', '2026-08-20');
    expect(await openCommitments()).toHaveLength(1);

    const res = await ua.post(`/app/c/${companyId}/commitments/${id}/done`).type('form')
      .send({ back: `/app/c/${companyId}/commitments?status=open` });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`/app/c/${companyId}/commitments?status=open`);

    expect(await openCommitments()).toHaveLength(0);
    const done = (await act('list_crm_commitments', { status: 'done' })).body.result;
    expect(done).toHaveLength(1);
  });

  it('öppnar ett stängt åtagande igen', async () => {
    const done = (await act('list_crm_commitments', { status: 'done' })).body.result[0];
    const res = await ua.post(`/app/c/${companyId}/commitments/${done.id}/reopen`).type('form').send({});
    expect(res.status).toBe(302);
    expect(await openCommitments()).toHaveLength(1);
  });

  it('avskriver ett löfte via överflödsmenyn', async () => {
    const id = await newCommitment('Löfte som inte längre gäller.', '2026-09-01');
    const res = await ua.post(`/app/c/${companyId}/commitments/${id}/drop`).type('form').send({});
    expect(res.status).toBe(302);
    const dropped = (await act('list_crm_commitments', { status: 'dropped' })).body.result;
    expect(dropped.map((c: { id: string }) => c.id)).toContain(id);
  });

  it('handgreppet auditloggas precis som AI-vägen', async () => {
    const n = await withAdmin(async (a) => (await a.query(
      `SELECT count(*)::int AS n FROM audit_log
       WHERE company_id = $1 AND action = 'action.executed' AND entity_id = 'set_crm_commitment_status'`,
      [companyId])).rows[0].n);
    expect(n).toBeGreaterThan(0);
  });
});

describe('uppskjutning skriver aldrig om vad som lovades', () => {
  it('skjuter upp raden men lämnar förfallodatumet orört', async () => {
    const id = await newCommitment('Löfte att skjuta upp.', '2026-08-15');
    const res = await ua.post(`/app/c/${companyId}/commitments/${id}/snooze`).type('form').send({ days: '7' });
    expect(res.status).toBe(302);

    const row = await withAdmin(async (a) => (await a.query(
      'SELECT due_date::text, snoozed_until::text, status FROM crm.commitments WHERE id = $1', [id])).rows[0]);
    expect(row.due_date, 'löftet är löftet — datumet får inte flyttas').toBe('2026-08-15');
    expect(row.snoozed_until).toBeTruthy();
    expect(row.status).toBe('open');
  });
});

describe('snabbregistrering: kontakt loggad för hand på ett klick', () => {
  it('loggar kontakt och nollställer tystnadsklockan', async () => {
    const före = (await act('crm_relation_state', {})).body.result
      .find((r: { organization_id: string }) => r.organization_id === orgId);
    expect(före.last_contact_at, 'ingen kontakt ännu').toBeNull();

    const res = await ua.post(`/app/c/${companyId}/relations/${orgId}/log`).type('form')
      .send({ channel: 'call', summary: 'Ringde om tidplanen.' });
    expect(res.status).toBe(302);

    const efter = (await act('crm_relation_state', {})).body.result
      .find((r: { organization_id: string }) => r.organization_id === orgId);
    expect(efter.last_contact_at, 'klockan ska ha nollställts').toBeTruthy();
    expect(efter.days_silent).toBe(0);

    const full = await act('get_crm_organization', { organization_id: orgId });
    const senaste = full.body.result.interactions[0];
    expect(senaste.summary).toBe('Ringde om tidplanen.');
    expect(senaste.channel).toBe('call');
    expect(senaste.source_system).toBe('manual');
  });

  it('tom text ger ändå en läsbar rad', async () => {
    const res = await ua.post(`/app/c/${companyId}/relations/${orgId}/log`).type('form')
      .send({ channel: 'note', summary: '   ' });
    expect(res.status).toBe(302);
    const full = await act('get_crm_organization', { organization_id: orgId });
    expect(full.body.result.interactions[0].summary).toBe('Kontakt loggad för hand');
  });
});

describe('dagsytan går att tysta — annars blir listan en anklagelse', () => {
  it('skjuter upp en relation', async () => {
    const res = await ua.post(`/app/c/${companyId}/relations/${orgId}/snooze`).type('form').send({ days: '14' });
    expect(res.status).toBe(302);
    const row = await withAdmin(async (a) => (await a.query(
      'SELECT snoozed_until::text, muted FROM crm.organizations WHERE id = $1', [orgId])).rows[0]);
    expect(row.snoozed_until).toBeTruthy();
    expect(row.muted).toBe(false);
  });

  it('tystar en relation utan att radera den', async () => {
    const res = await ua.post(`/app/c/${companyId}/relations/${orgId}/mute`).type('form').send({ muted: 'true' });
    expect(res.status).toBe(302);
    const row = await withAdmin(async (a) => (await a.query(
      'SELECT muted FROM crm.organizations WHERE id = $1', [orgId])).rows[0]);
    expect(row.muted).toBe(true);

    // Relationen finns kvar i listan — den knackar bara inte på längre.
    const list = await act('list_crm_organizations', {});
    expect(list.body.result.map((o: { id: string }) => o.id)).toContain(orgId);
  });
});

describe('ytan är fortfarande JS-fri och skyddad', () => {
  it('knapparna finns som riktiga formulär, inte skript', async () => {
    const res = await ua.get(`/app/c/${companyId}/commitments`);
    expect(res.status).toBe(200);
    expect(res.text).toContain(`/app/c/${companyId}/commitments/`);
    expect(res.text).toContain('popovertarget');
    expect(res.text).not.toContain('<script');
    expect(res.text).not.toContain('onclick=');
  });

  it('en POST utan eget ursprung avvisas (CSRF-skyddet gäller även här)', async () => {
    const id = await newCommitment('Får inte kunna stängas utifrån.', '2026-09-15');
    const res = await ua.post(`/app/c/${companyId}/commitments/${id}/done`)
      .set('Origin', 'https://angripare.example').type('form').send({});
    expect(res.status).toBe(403);
    const open = await openCommitments();
    expect(open.map((c: { id: string }) => c.id)).toContain(id);
  });

  it('omdirigering kan inte kapas via back-fältet', async () => {
    const id = await newCommitment('Kontroll av omdirigering.', '2026-09-20');
    const res = await ua.post(`/app/c/${companyId}/commitments/${id}/done`).type('form')
      .send({ back: 'https://angripare.example/kapad' });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`/app/c/${companyId}/commitments`);
  });
});
