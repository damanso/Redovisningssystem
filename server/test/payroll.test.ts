// Fas A14: lön & HR (utan AGI/KU-10). Anställda, lönebesked (brutto/skatt/netto/
// arbetsgivaravgift) och bokföring till 7210/2710/1930/7510/2730.
import supertest from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { app, api, createCompany, registerUser, type TestUser } from './helpers.js';
import { computePayroll, EMPLOYER_CONTRIBUTION_PERMILLE } from '../src/services/payroll.js';

const PASSWORD = 'mycket-hemligt-losen-123';
let user: TestUser;
let companyId: string;
let fiscalYearId: string;
const auth = () => ({ Authorization: `Bearer ${user.token}` });
const co = () => `/api/companies/${companyId}`;

async function approveAction(name: string, body: Record<string, unknown>) {
  const req = await api.post(`${co()}/actions/${name}`).set(auth()).send(body);
  expect(req.status, JSON.stringify(req.body)).toBe(202);
  return api.post(`${co()}/approvals/${req.body.approval.id}/approve`).set(auth()).send({});
}

beforeAll(async () => {
  user = await registerUser('payroll');
  companyId = await createCompany(user.token, 'Lön AB');
  const fy = await api.post(`${co()}/accounting/fiscal-years`).set(auth()).send({ label: '2025', start_date: '2025-01-01', end_date: '2025-12-31' });
  fiscalYearId = fy.body.fiscal_year.id;
});

describe('lönberäkning', () => {
  it('brutto/skatt/netto/arbetsgivaravgift', () => {
    const c = computePayroll(3000000, 30); // 30 000 kr brutto, 30 % skatt
    expect(c.tax_ore).toBe(900000);        // 9 000 kr
    expect(c.net_ore).toBe(2100000);       // 21 000 kr
    // Arbetsgivaravgift 31,42 % av brutto.
    expect(c.employer_contribution_ore).toBe(Math.round(3000000 * EMPLOYER_CONTRIBUTION_PERMILLE / 10000));
    expect(c.employer_contribution_ore).toBe(942600); // 9 426 kr
  });
});

describe('lön & HR end-to-end', () => {
  let employeeId: string;
  let payslipId: string;

  it('lägger till anställd', async () => {
    const res = await api.post(`${co()}/actions/create_employee`).set(auth()).send({
      name: 'Anna Anställd', email: 'anna@lon.se', monthly_salary_ore: 3000000, tax_rate: 30,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    employeeId = res.body.result.id;
  });

  it('skapar lönebesked med beräknade belopp', async () => {
    const res = await api.post(`${co()}/actions/create_payslip`).set(auth()).send({ employee_id: employeeId, period: '2025-06' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    payslipId = res.body.result.id;
    expect(res.body.result.gross_ore).toBe(3000000);
    expect(res.body.result.net_ore).toBe(2100000);
    expect(res.body.result.employer_contribution_ore).toBe(942600);
    expect(res.body.result.status).toBe('draft');
  });

  it('dubblett för samma period avvisas', async () => {
    const res = await api.post(`${co()}/actions/create_payslip`).set(auth()).send({ employee_id: employeeId, period: '2025-06' });
    expect(res.status).toBe(409);
  });

  it('bokför lönebesked → verifikat i balans, status booked', async () => {
    const res = await approveAction('book_payslip', { payslip_id: payslipId, fiscal_year_id: fiscalYearId, payment_date: '2025-06-25' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.result.status).toBe('booked');
    expect(res.body.result.voucher_id).toBeTruthy();
    // Att postVoucher accepterade konteringen bevisar att debet=kredit
    // (brutto+avgift = skatt+netto+avgift) — annars hade den avvisats.

    // Dubbelbokning spärras.
    const again = await api.post(`${co()}/actions/book_payslip`).set(auth()).send({ payslip_id: payslipId, fiscal_year_id: fiscalYearId, payment_date: '2025-06-25' });
    expect(again.status).toBe(202);
    const dup = await api.post(`${co()}/approvals/${again.body.approval.id}/approve`).set(auth()).send({});
    expect(dup.status).toBe(409);
  });

  it('lönevyn renderas', async () => {
    const ua = supertest.agent(app);
    await ua.post('/app/login').type('form').send({ email: user.email, password: PASSWORD });
    const res = await ua.get(`/app/c/${companyId}/payroll`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Lön & personal');
    expect(res.text).toContain('Anna Anställd');
    expect(res.text).toContain('2025-06');
  });
});
