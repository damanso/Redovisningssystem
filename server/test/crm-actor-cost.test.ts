// CRM E7a — aktör på tidrapport + inköpskostnad.
//
// Beslut B3 i BMAD-underlaget: underkonsulter kommer inom sex månader. Utan
// aktör på tidposten går varken attribuering, beläggning per person, marginal
// eller utbetalning att räkna. Testerna vaktar fyra saker som lätt går sönder:
//
//   1. Aktören HÄRLEDS — ingen människa ska behöva komma ihåg att fylla i den.
//   2. created_by (vem som registrerade) byter INTE betydelse.
//   3. Inköpskostnaden fryses vid registreringen — historiska marginaler
//      ändras inte för att en taxa höjs i morgon.
//   4. Kostnad och aktör läcker ALDRIG ut på kundens faktura.
import supertest from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { app, api, createCompany, pdfText, registerUser, withAdmin, type TestUser } from './helpers.js';

const PASSWORD = 'mycket-hemligt-losen-123';
let user: TestUser;
let companyId: string;
let customerId: string;
let projectId: string;
const auth = () => ({ Authorization: `Bearer ${user.token}` });
const co = () => `/api/companies/${companyId}`;

const act = (name: string, body: Record<string, unknown>) =>
  api.post(`${co()}/actions/${name}`).set(auth()).send(body);

async function newProject(name: string, rateOre: number): Promise<string> {
  const res = await act('create_project', { name, customer_id: customerId, hourly_rate_ore: rateOre });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.result.id as string;
}

beforeAll(async () => {
  user = await registerUser('aktor');
  companyId = await createCompany(user.token, 'Locollabs AB');
  const c = await api.post(`${co()}/customers`).set(auth()).send({ name: 'Nordic Vision Retail AB' });
  expect(c.status, JSON.stringify(c.body)).toBe(201);
  customerId = c.body.customer.id;
  projectId = await newProject('NVR-plattformen', 110_000); // 1 100 kr/h mot kund
});

describe('aktören härleds — ingen ombeds fylla i den', () => {
  it('första tidposten skapar den inloggades aktör och kopplar posten till den', async () => {
    const res = await act('log_time', {
      project_id: projectId, work_date: '2026-06-01', minutes: 120, description: 'Arkitektur',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.result.performed_by_actor_id).toBeTruthy();
    expect(res.body.result.performed_by_name).toBe('aktor'); // profilnamnet från registreringen

    const actors = await act('list_work_actors', {});
    expect(actors.status, JSON.stringify(actors.body)).toBe(200);
    expect(actors.body.result).toHaveLength(1);
    expect(actors.body.result[0].kind).toBe('internal');
  });

  it('nästa tidpost återanvänder samma aktör i stället för att skapa en ny', async () => {
    await act('log_time', { project_id: projectId, work_date: '2026-06-02', minutes: 60, description: 'Möte' });
    const actors = await act('list_work_actors', {});
    expect(actors.body.result).toHaveLength(1);
  });

  it('created_by betyder fortfarande VEM SOM REGISTRERADE, inte vem som utförde', async () => {
    const sub = await act('upsert_work_actor', {
      name: 'Underkonsulten Kim', kind: 'subcontractor', cost_rate_ore: 60_000,
    });
    expect(sub.status, JSON.stringify(sub.body)).toBe(200);

    const entry = await act('log_time', {
      project_id: projectId, work_date: '2026-06-03', minutes: 60,
      description: 'Integration', performed_by_actor_id: sub.body.result.id,
    });
    expect(entry.status, JSON.stringify(entry.body)).toBe(200);

    const row = await withAdmin(async (a) => (await a.query(
      'SELECT created_by, performed_by_actor_id FROM time_entries WHERE id = $1', [entry.body.result.id])).rows[0]);
    expect(row.created_by).toBe(user.userId);                       // registrerad av David
    expect(row.performed_by_actor_id).toBe(sub.body.result.id);     // utförd av Kim
    expect(row.performed_by_actor_id).not.toBe(row.created_by);
  });

  it('varje tidpost får en aktör — inga tysta nollor i beläggningen', async () => {
    const missing = await withAdmin(async (a) => (await a.query(
      'SELECT count(*)::int AS n FROM time_entries WHERE company_id = $1 AND performed_by_actor_id IS NULL',
      [companyId])).rows[0].n);
    expect(missing).toBe(0);
  });
});

describe('aktörsregistret är idempotent och tenant-isolerat', () => {
  it('samma synk två gånger ger EN aktör, inte två', async () => {
    const before = (await act('list_work_actors', {})).body.result.length;
    const first = await act('upsert_work_actor', { name: 'Anna Konsult', kind: 'subcontractor', cost_rate_ore: 55_000 });
    expect(first.body.result.created).toBe(true);
    const second = await act('upsert_work_actor', { name: 'anna konsult', kind: 'subcontractor' });
    expect(second.body.result.created).toBe(false);
    expect(second.body.result.id).toBe(first.body.result.id);
    // En synk utan kostnadstaxa får inte nolla den som redan finns.
    expect(second.body.result.cost_rate_ore).toBe(55_000);
    expect((await act('list_work_actors', {})).body.result.length).toBe(before + 1);
  });

  it('databasen är sista spärren mot dubbletter', async () => {
    await expect(withAdmin(async (a) => a.query(
      `INSERT INTO work_actors (company_id, name) VALUES ($1, 'ANNA KONSULT')`, [companyId],
    ))).rejects.toThrow(/work_actors_name_uk/);
  });

  it('en aktör i ett annat bolag går inte att sätta på en tidpost', async () => {
    const other = await registerUser('aktorannan');
    const otherCo = await createCompany(other.token, 'Annat AB');
    const foreign = await api.post(`/api/companies/${otherCo}/actions/upsert_work_actor`)
      .set({ Authorization: `Bearer ${other.token}` }).send({ name: 'Främmande Aktör' });
    expect(foreign.status, JSON.stringify(foreign.body)).toBe(200);

    const res = await act('log_time', {
      project_id: projectId, work_date: '2026-06-04', minutes: 30,
      description: 'Försök', performed_by_actor_id: foreign.body.result.id,
    });
    expect(res.status).toBe(404);
  });

  it('inaktiverad aktör kan inte få ny tid i tysthet', async () => {
    const a = await act('upsert_work_actor', { name: 'Slutad Konsult', active: false });
    expect(a.body.result.active).toBe(false);
    const res = await act('log_time', {
      project_id: projectId, work_date: '2026-06-05', minutes: 30,
      description: 'Efter avslut', performed_by_actor_id: a.body.result.id,
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('actor_inactive');
  });

  it('...inte heller via den HÄRLEDDA vägen', async () => {
    // Granskningsfynd: spärren låg bara på den uttryckligen angivna aktören. Den
    // som loggade tid utan att ange någon fick sin egen aktör tillbaka — även
    // inaktiverad — och via 0053:s policyer öppnades projektåtkomsten igen.
    const mig = (await act('list_work_actors', {})).body.result
      .find((x: { name: string }) => x.name === 'aktor');
    expect(mig, 'den inloggades egen aktör').toBeTruthy();
    await act('upsert_work_actor', { name: 'aktor', active: false });

    const res = await act('log_time', {
      project_id: projectId, work_date: '2026-06-06', minutes: 30, description: 'Utan angiven aktör',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('actor_inactive');

    await act('upsert_work_actor', { name: 'aktor', active: true });
  });
});

describe('inköpskostnad och marginal', () => {
  let p: string;
  let kimId: string;

  beforeAll(async () => {
    p = await newProject('Marginalprojektet', 100_000); // 1 000 kr/h mot kund
    const kim = await act('upsert_work_actor', { name: 'Kim Marginal', kind: 'subcontractor', cost_rate_ore: 60_000 });
    kimId = kim.body.result.id;
  });

  it('kostnaden fryses vid registreringen — en höjd taxa ändrar inte historiken', async () => {
    const first = await act('log_time', {
      project_id: p, work_date: '2026-07-01', minutes: 60, description: 'Sprint 1',
      performed_by_actor_id: kimId,
    });
    expect(first.body.result.cost_rate_ore).toBe(60_000);

    await act('upsert_work_actor', { name: 'Kim Marginal', cost_rate_ore: 90_000 });
    const second = await act('log_time', {
      project_id: p, work_date: '2026-07-02', minutes: 60, description: 'Sprint 2',
      performed_by_actor_id: kimId,
    });
    expect(second.body.result.cost_rate_ore).toBe(90_000);

    const stored = await withAdmin(async (a) => (await a.query(
      'SELECT cost_rate_ore FROM time_entries WHERE id = $1', [first.body.result.id])).rows[0].cost_rate_ore);
    expect(stored).toBe(60_000); // oförändrad
  });

  it('marginal = fakturerbar intäkt − kostnad för ALL tid, även ofakturerbar', async () => {
    // En timme som inte går att fakturera kostar precis lika mycket. Räknades
    // kostnaden bara på fakturerbar tid vore marginalen systematiskt för hög.
    await act('log_time', {
      project_id: p, work_date: '2026-07-03', minutes: 60, description: 'Omtag utan debitering',
      performed_by_actor_id: kimId, billable: false, cost_rate_ore: 60_000,
    });

    const res = await act('get_project', { project_id: p });
    const s = res.body.result.summary;
    expect(s.total_minutes).toBe(180);
    expect(s.billable_minutes).toBe(120);
    expect(s.billable_amount_ore).toBe(200_000);          // 2 h à 1 000 kr
    expect(s.cost_amount_ore).toBe(60_000 + 90_000 + 60_000);
    expect(s.margin_ore).toBe(200_000 - 210_000);         // negativ, och det ska synas
  });

  it('beläggning och marginal går att läsa per utförare', async () => {
    const res = await act('get_project', { project_id: p });
    const kim = (res.body.result.by_actor as Array<{ name: string; minutes: number; margin_ore: number }>)
      .find((x) => x.name === 'Kim Marginal');
    expect(kim).toBeTruthy();
    expect(kim!.minutes).toBe(180);
    expect(kim!.margin_ore).toBe(-10_000);
  });

  it('projektvyn visar utförare och marginal', async () => {
    const ua = supertest.agent(app);
    await ua.post('/app/login').type('form').send({ email: user.email, password: PASSWORD });
    const detail = await ua.get(`/app/c/${companyId}/projects/${p}`);
    expect(detail.status).toBe(200);
    expect(detail.text).toContain('Kim Marginal');
    expect(detail.text).toContain('Marginal');
    expect(detail.text).toContain('Inköpskostnad');
  });
});

describe('kundens faktura ser aldrig vår inköpskostnad', () => {
  it('tidsbilagan tar med timmarna men varken aktör eller kostnad', async () => {
    const p = await newProject('Bilageprojektet', 110_000);
    const kim = await act('upsert_work_actor', { name: 'Hemlig Underkonsult', kind: 'subcontractor', cost_rate_ore: 45_000 });
    await act('log_time', {
      project_id: p, work_date: '2026-08-03', minutes: 25, description: 'Avstämning och plan',
      performed_by_actor_id: kim.body.result.id,
    });
    await api.post(`${co()}/accounting/fiscal-years`).set(auth())
      .send({ label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });

    const inv = await act('create_invoice', {
      customer_id: customerId, invoice_date: '2026-08-31', due_date: '2026-09-20',
      lines: [{ description: 'Konsulttid augusti', quantity: 1, unit: 'h', unit_price_ore: 110_000, vat_rate: 25 }],
    });
    expect(inv.status, JSON.stringify(inv.body)).toBe(200);

    const appendix = await act('invoice_appendix_from_time_entries', {
      invoice_id: inv.body.result.id, project_id: p, from: '2026-08-01', to: '2026-08-31',
    });
    expect(appendix.status, JSON.stringify(appendix.body)).toBe(200);
    expect(JSON.stringify(appendix.body.result)).not.toContain('Hemlig Underkonsult');

    const res = await api.post(`${co()}/invoices/${inv.body.result.id}/pdf`).set(auth()).buffer()
      .parse((r, cb) => { const chunks: Buffer[] = []; r.on('data', (c: Buffer) => chunks.push(c)); r.on('end', () => cb(null, Buffer.concat(chunks))); });
    expect(res.status).toBe(200);
    const text = pdfText(res.body as Buffer);
    expect(text).toContain('Avstämning och plan'); // bilagan finns med
    expect(text).not.toContain('Hemlig Underkonsult');
    expect(text).not.toContain('450'); // 45 000 öre = 450 kr — kostnaden syns inte
  });
});
