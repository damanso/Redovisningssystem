// Fas D1: arbetsgivardeklaration på individnivå (AGI). Sammanställer en periods
// lönebesked till huvuduppgift (HU) + individuppgifter (IU) och genererar Skatteverkets
// AGI-XML (schema 1.1, faltkoder). Beräknat underlag; ingen digital inlämning.
import supertest from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { app, api, createCompany, registerUser, type TestUser } from './helpers.js';

const PASSWORD = 'mycket-hemligt-losen-123';
let user: TestUser;
let companyId: string;
const auth = () => ({ Authorization: `Bearer ${user.token}` });
const co = () => `/api/companies/${companyId}`;

async function payslip(employeeId: string, period: string) {
  const res = await api.post(`${co()}/actions/create_payslip`).set(auth()).send({ employee_id: employeeId, period });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
}

beforeAll(async () => {
  user = await registerUser('agi');
  companyId = await createCompany(user.token, 'AGI AB');
  await api.patch(`${co()}`).set(auth()).send({ org_number: '5560269986' });
  const a = await api.post(`${co()}/actions/create_employee`).set(auth()).send({
    name: 'Anna Anställd', personnummer: '198202252386', monthly_salary_ore: 3000000, tax_rate: 30,
  });
  const b = await api.post(`${co()}/actions/create_employee`).set(auth()).send({
    name: 'Bertil Bagare', personnummer: '19750101-1234', monthly_salary_ore: 2000000, tax_rate: 30,
  });
  await payslip(a.body.result.id, '2024-01');
  await payslip(b.body.result.id, '2024-01');
});

async function agi(period = '2024-01') {
  const res = await api.post(`${co()}/actions/agi_declaration`).set(auth()).send({ period });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.result;
}
async function agiFile(period = '2024-01') {
  const res = await api.post(`${co()}/actions/generate_agi_file`).set(auth()).send({ period });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.result;
}

describe('AGI-beräkning', () => {
  it('huvuduppgift summerar skatt och arbetsgivaravgifter, en individuppgift per anställd', async () => {
    const d = await agi();
    expect(d.period_yyyymm).toBe('202401');
    expect(d.summary.employee_count).toBe(2);
    // Brutto 30 000 + 20 000 = 50 000; skatt 30 % = 15 000; arb.avgift 31,42 % = 15 710.
    expect(d.summary.gross_total_ore).toBe(5000000);
    expect(d.summary.employee_tax_total_ore).toBe(1500000);
    expect(d.summary.employer_contribution_total_ore).toBe(Math.round(5000000 * 3142 / 10000));
    expect(d.summary.to_pay_total_ore).toBe(d.summary.employee_tax_total_ore + d.summary.employer_contribution_total_ore);
    expect(d.individuals).toHaveLength(2);
    expect(d.individuals[0].spec_no).toBe(1);
  });
});

describe('AGI-XML', () => {
  it('har Skatteverkets kuvert, HU och en IU per anställd med rätt faltkoder', async () => {
    const f = await agiFile();
    const x = f.xml as string;
    expect(x.startsWith('<?xml')).toBe(true);
    expect(x).toContain('omrade="Arbetsgivardeklaration"');
    expect(x).toContain('http://xmls.skatteverket.se/se/skatteverket/da/instans/schema/1.1');
    // AgRegistreradId = 16 + org.nr.
    expect(x).toContain('<agd:AgRegistreradId faltkod="201">165560269986</agd:AgRegistreradId>');
    // HU: period + summor i hela kronor.
    expect(x).toContain('<agd:RedovisningsPeriod faltkod="006">202401</agd:RedovisningsPeriod>');
    expect(x).toContain('<agd:SummaSkatteavdr faltkod="497">15000</agd:SummaSkatteavdr>');
    expect(x).toContain('<agd:SummaArbAvgSlf faltkod="487">15710</agd:SummaArbAvgSlf>');
    // IU: personnummer (12 siffror), kontant ersättning + avdragen skatt i kronor.
    expect(x).toContain('<agd:BetalningsmottagarId faltkod="215">198202252386</agd:BetalningsmottagarId>');
    expect(x).toContain('<agd:BetalningsmottagarId faltkod="215">197501011234</agd:BetalningsmottagarId>'); // 10→12 siffror
    expect(x).toContain('<agd:KontantErsattningUlagAG faltkod="011">30000</agd:KontantErsattningUlagAG>');
    expect(x).toContain('<agd:AvdrPrelSkatt faltkod="001">9000</agd:AvdrPrelSkatt>');
    expect(x).toContain('<agd:Specifikationsnummer faltkod="570">001</agd:Specifikationsnummer>');
    // Två IU-block.
    expect((x.match(/<agd:IU>/g) ?? []).length).toBe(2);
    expect(f.filename).toBe('AGD_5560269986_202401.xml');
  });

  it('vägrar utan organisationsnummer och utan personnummer (grind)', async () => {
    // Utan org.nr.
    const noorg = await createCompany(user.token, 'Utan orgnr AB');
    const emp = await api.post(`/api/companies/${noorg}/actions/create_employee`).set(auth()).send({
      name: 'X', personnummer: '198202252386', monthly_salary_ore: 1000000, tax_rate: 30,
    });
    await api.post(`/api/companies/${noorg}/actions/create_payslip`).set(auth()).send({ employee_id: emp.body.result.id, period: '2024-01' });
    const r1 = await api.post(`/api/companies/${noorg}/actions/generate_agi_file`).set(auth()).send({ period: '2024-01' });
    expect(r1.status).toBe(400);
    expect(JSON.stringify(r1.body)).toContain('missing_org_number');

    // Med org.nr men anställd utan personnummer.
    const c2 = await createCompany(user.token, 'AGI2 AB');
    await api.patch(`/api/companies/${c2}`).set(auth()).send({ org_number: '5560269986' });
    const emp2 = await api.post(`/api/companies/${c2}/actions/create_employee`).set(auth()).send({ name: 'Utan pnr', monthly_salary_ore: 1000000, tax_rate: 30 });
    await api.post(`/api/companies/${c2}/actions/create_payslip`).set(auth()).send({ employee_id: emp2.body.result.id, period: '2024-01' });
    const r2 = await api.post(`/api/companies/${c2}/actions/generate_agi_file`).set(auth()).send({ period: '2024-01' });
    expect(r2.status).toBe(400);
    expect(JSON.stringify(r2.body)).toContain('missing_personnummer');
  });
});

describe('AGI-vy och nedladdning', () => {
  it('lönevyn visar AGI och erbjuder filnedladdning', async () => {
    const ua = supertest.agent(app);
    await ua.post('/app/login').type('form').send({ email: user.email, password: PASSWORD });
    const view = await ua.get(`/app/c/${companyId}/payroll`);
    expect(view.text).toContain('Arbetsgivardeklaration (AGI)');
    const file = await ua.get(`/app/c/${companyId}/payroll/agi.xml?period=2024-01`);
    expect(file.status).toBe(200);
    expect(file.headers['content-type']).toContain('application/xml');
    expect(file.headers['content-disposition']).toContain('AGD_5560269986_202401.xml');
    expect(file.text).toContain('<agd:HU>');
  });
});
