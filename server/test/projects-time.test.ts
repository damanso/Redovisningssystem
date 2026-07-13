// Fas A6: projekt & tidrapportering. Projekt med timtaxa, tidposter i minuter,
// fakturerbart belopp = minuter/60 * taxa (avrundat i ören).
import supertest from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { app, api, createCompany, registerUser, type TestUser } from './helpers.js';
import { timeEntryAmountOre } from '../src/services/projects.js';

const PASSWORD = 'mycket-hemligt-losen-123';
let user: TestUser;
let companyId: string;
let customerId: string;
const auth = () => ({ Authorization: `Bearer ${user.token}` });
const co = () => `/api/companies/${companyId}`;

beforeAll(async () => {
  user = await registerUser('proj');
  companyId = await createCompany(user.token, 'Konsult AB');
  const c = await api.post(`${co()}/customers`).set(auth()).send({ name: 'Uppdragsgivare AB' });
  customerId = c.body.customer.id;
});

describe('timeEntryAmountOre', () => {
  it('räknar minuter mot timtaxa i ören', () => {
    expect(timeEntryAmountOre(60, 100000)).toBe(100000); // 1 h * 1000 kr
    expect(timeEntryAmountOre(90, 100000)).toBe(150000); // 1,5 h
    expect(timeEntryAmountOre(30, 100000)).toBe(50000);  // 0,5 h
    expect(timeEntryAmountOre(45, 133333)).toBe(100000); // avrundning
    expect(timeEntryAmountOre(60, null)).toBe(0);        // ingen taxa
  });
});

describe('projekt & tid', () => {
  let projectId: string;

  it('skapar projekt med timtaxa', async () => {
    const res = await api.post(`${co()}/actions/create_project`).set(auth()).send({
      name: 'Webbplattform', customer_id: customerId, hourly_rate_ore: 120000, budget_ore: 5000000,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    projectId = res.body.result.id;
    expect(res.body.result.number).toBeGreaterThan(0);
  });

  it('loggar tid och summerar fakturerbart belopp', async () => {
    await api.post(`${co()}/actions/log_time`).set(auth()).send({
      project_id: projectId, work_date: '2025-06-01', minutes: 120, description: 'Arkitektur',
    });
    await api.post(`${co()}/actions/log_time`).set(auth()).send({
      project_id: projectId, work_date: '2025-06-02', minutes: 90, description: 'Möte', billable: false,
    });
    await api.post(`${co()}/actions/log_time`).set(auth()).send({
      project_id: projectId, work_date: '2025-06-03', minutes: 30, description: 'Extra', hourly_rate_ore: 200000,
    });

    const res = await api.post(`${co()}/actions/get_project`).set(auth()).send({ project_id: projectId });
    expect(res.status).toBe(200);
    const s = res.body.result.summary;
    expect(s.total_minutes).toBe(240);      // 120 + 90 + 30
    expect(s.billable_minutes).toBe(150);   // 120 + 30 (90 ej fakturerbar)
    // 120 min @ 1200 kr = 240000; 30 min @ 2000 kr (override) = 100000 → 340000
    expect(s.billable_amount_ore).toBe(340000);
  });

  it('avvisar tid på stängt projekt', async () => {
    await api.post(`${co()}/actions/set_project_status`).set(auth()).send({ project_id: projectId, status: 'closed' });
    const res = await api.post(`${co()}/actions/log_time`).set(auth()).send({
      project_id: projectId, work_date: '2025-06-04', minutes: 60, description: 'Efter stängning',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('project_closed');
  });

  it('listar projekt med upparbetad tid', async () => {
    const res = await api.post(`${co()}/actions/list_projects`).set(auth()).send({});
    expect(res.status).toBe(200);
    const p = res.body.result.find((r: { id: string }) => r.id === projectId);
    expect(p.total_minutes).toBe(240);
    expect(p.billable_minutes).toBe(150);
  });

  it('projektvyn renderas med tidposter', async () => {
    const ua = supertest.agent(app);
    await ua.post('/app/login').type('form').send({ email: user.email, password: PASSWORD });
    const list = await ua.get(`/app/c/${companyId}/projects`);
    expect(list.status).toBe(200);
    expect(list.text).toContain('Webbplattform');
    const detail = await ua.get(`/app/c/${companyId}/projects/${projectId}`);
    expect(detail.status).toBe(200);
    expect(detail.text).toContain('Arkitektur');
  });
});
