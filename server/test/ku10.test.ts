// Fas D3: KU10 — kontrolluppgift (kontant bruttolön per anställd och inkomstår) + XML
// enligt Skatteverkets schema (blankett 2300). KU10 innehåller INTE avdragen skatt (den
// redovisas via AGI). Beräknat underlag; ingen digital inlämning.
import supertest from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { app, api, createCompany, registerUser, type TestUser } from './helpers.js';

const PASSWORD = 'mycket-hemligt-losen-123';
let user: TestUser;
let companyId: string;
const auth = () => ({ Authorization: `Bearer ${user.token}` });
const co = () => `/api/companies/${companyId}`;

beforeAll(async () => {
  user = await registerUser('ku10');
  companyId = await createCompany(user.token, 'KU10 AB');
  await api.patch(`${co()}`).set(auth()).send({ org_number: '5560123456' });
  const e = await api.post(`${co()}/actions/create_employee`).set(auth()).send({ name: 'Kalle', personnummer: '195111232079', monthly_salary_ore: 3000000, tax_rate: 30 });
  // Två lönebesked 2024 → årsbrutto 60 000 kr.
  await api.post(`${co()}/actions/create_payslip`).set(auth()).send({ employee_id: e.body.result.id, period: '2024-01' });
  await api.post(`${co()}/actions/create_payslip`).set(auth()).send({ employee_id: e.body.result.id, period: '2024-02' });
});

describe('KU10-beräkning', () => {
  it('aggregerar årets bruttolön och skatt per anställd', async () => {
    const res = await api.post(`${co()}/actions/ku10_report`).set(auth()).send({ income_year: 2024 });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const r = res.body.result;
    expect(r.recipients).toHaveLength(1);
    expect(r.recipients[0].gross_ore).toBe(6000000); // 60 000 kr
    expect(r.total_gross_ore).toBe(6000000);
    expect(r.recipients[0].tax_ore).toBe(1800000);    // info (ingår ej i KU10-filen)
  });
});

describe('KU10-XML', () => {
  async function file(year = 2024, over: Record<string, unknown> = {}) {
    return api.post(`${co()}/actions/generate_ku10_file`).set(auth()).send({ income_year: year, ...over });
  }
  it('har Skatteverkets kuvert och KU10-blankett med rätt faltkoder, utan skattefält', async () => {
    const res = await file();
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const x = res.body.result.xml as string;
    expect(x).toContain('omrade="Kontrolluppgifter"');
    expect(x).toContain('infoForBeskattning/10.0'); // inkomstår 2024 → schema 10.0
    expect(x).toContain('<ku:Blankett nummer="2300">');
    expect(x).toContain('<ku:KontantBruttolonMm faltkod="011">60000</ku:KontantBruttolonMm>');
    expect(x).toContain('<ku:Inkomstar faltkod="203">2024</ku:Inkomstar>');
    expect(x).toContain('<ku:Inkomsttagare faltkod="215">195111232079</ku:Inkomsttagare>');
    expect(x).toContain('<ku:UppgiftslamnarId faltkod="201">165560123456</ku:UppgiftslamnarId>');
    // KU10 har inget avdragen-skatt-fält.
    expect(x).not.toContain('AvdragenSkatt');
    expect(x).not.toContain('faltkod="001"');
    expect(res.body.result.filename).toBe('KU10_5560123456_2024.xml');
  });
  it('sätter FK093 socialavgiftsavtal när flaggat', async () => {
    const res = await file(2024, { social_avgiftsavtal: true });
    expect(res.body.result.xml).toContain('<ku:SocialAvgiftsAvtal faltkod="093">1</ku:SocialAvgiftsAvtal>');
  });
  it('vägrar utan organisationsnummer', async () => {
    const c2 = await createCompany(user.token, 'Utan orgnr KU AB');
    const e = await api.post(`/api/companies/${c2}/actions/create_employee`).set(auth()).send({ name: 'X', personnummer: '195111232079', monthly_salary_ore: 1000000, tax_rate: 30 });
    await api.post(`/api/companies/${c2}/actions/create_payslip`).set(auth()).send({ employee_id: e.body.result.id, period: '2024-01' });
    const res = await api.post(`/api/companies/${c2}/actions/generate_ku10_file`).set(auth()).send({ income_year: 2024 });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain('missing_org_number');
  });
});

describe('KU10-vy och nedladdning', () => {
  it('lönevyn erbjuder KU10-nedladdning per år', async () => {
    const ua = supertest.agent(app);
    await ua.post('/app/login').type('form').send({ email: user.email, password: PASSWORD });
    const view = await ua.get(`/app/c/${companyId}/payroll`);
    expect(view.text).toContain('KU10');
    const dl = await ua.get(`/app/c/${companyId}/payroll/ku10.xml?year=2024`);
    expect(dl.status).toBe(200);
    expect(dl.headers['content-type']).toContain('application/xml');
    expect(dl.text).toContain('<ku:KU10>');
  });
});
