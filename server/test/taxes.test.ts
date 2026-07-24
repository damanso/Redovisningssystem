// Fas B2: skatteskuld & skattekonto. Moms, AGI (skatt + arbetsgivaravgift) och
// uppskattad bolagsskatt ur bokföringen + vägledande deadlines.
import supertest from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { app, api, createCompany, createFiscalYear, registerUser, type TestUser } from './helpers.js';
import { taxDeadlines, CORPORATE_TAX_PERMILLE } from '../src/services/taxes.js';

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
  user = await registerUser('tax');
  companyId = await createCompany(user.token, 'Skatt AB');
  const fy = await createFiscalYear(companyId, auth(), { label: '2025', start_date: '2025-01-01', end_date: '2025-12-31' });
  fiscalYearId = fy.id;

  // Försäljning → utgående moms 25 000 (2611). Kvitto → ingående moms 10 000 (2641).
  const cust = await api.post(`${co()}/customers`).set(auth()).send({ name: 'Kund' });
  const inv = await api.post(`${co()}/actions/create_invoice`).set(auth()).send({
    customer_id: cust.body.customer.id, invoice_date: '2025-02-01', due_date: '2025-02-28',
    lines: [{ description: 'Tjänst', quantity: 1, unit_price_ore: 100000_00, vat_rate: 25 }],
  });
  await approveAction('book_invoice', { invoice_id: inv.body.result.id, fiscal_year_id: fiscalYearId });
  const receipt = await api.post(`${co()}/actions/create_receipt`).set(auth()).send({
    receipt_date: '2025-02-10', description: 'Inköp', net_ore: 40000_00, vat_rate: 25, expense_account: 5460, payment_account: 1930,
  });
  await approveAction('book_receipt', { receipt_id: receipt.body.result.id, fiscal_year_id: fiscalYearId });

  // Lön → personalskatt (2710) + arbetsgivaravgift (2730).
  const emp = await api.post(`${co()}/actions/create_employee`).set(auth()).send({ name: 'Anna', monthly_salary_ore: 3000000, tax_rate: 30 });
  const pay = await api.post(`${co()}/actions/create_payslip`).set(auth()).send({ employee_id: emp.body.result.id, period: '2025-02' });
  await approveAction('book_payslip', { payslip_id: pay.body.result.id, fiscal_year_id: fiscalYearId, payment_date: '2025-02-25' });
});

describe('deadlines (rena funktioner)', () => {
  it('AGI månadsvis: lönemånad → 12:e månaden efter (17:e jan/aug)', () => {
    const ds = taxDeadlines('2025-06-01', 'quarterly', '2025-12-31');
    const agiJul = ds.find((d) => d.type === 'agi' && d.period_label === '2025-06');
    expect(agiJul?.due_date).toBe('2025-07-12');
    const agiAug = ds.find((d) => d.type === 'agi' && d.period_label === '2025-07');
    expect(agiAug?.due_date).toBe('2025-08-17'); // augusti → 17:e
  });
  it('kvartalsmoms: Q1 → 12 maj', () => {
    const ds = taxDeadlines('2025-04-01', 'quarterly', '2025-12-31');
    const q1 = ds.find((d) => d.type === 'vat' && d.period_label === '2025 Q1');
    expect(q1?.due_date).toBe('2025-05-12');
  });
});

describe('skatteöversikt end-to-end', () => {
  it('moms, AGI och uppskattad bolagsskatt beräknas ur bokföringen', async () => {
    const res = await api.post(`${co()}/actions/tax_overview`).set(auth()).send({ as_of: '2025-12-31' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const L = res.body.result.liability;
    // Moms: utgående 25 000 − ingående 10 000 = 15 000.
    expect(L.vat_payable_ore).toBe(15000_00);
    // AGI: personalskatt 30 % av 30 000 = 9 000; arbetsgivaravgift 31,42 % = 9 426.
    expect(L.employee_tax_ore).toBe(9000_00);
    expect(L.employer_contribution_ore).toBe(9426_00);
    expect(L.agi_total_ore).toBe(18426_00);
    // Bolagsskatt: 20,6 % av positivt resultat före skatt.
    expect(L.estimated_corporate_tax_ore).toBe(Math.round(L.result_before_tax_ore * CORPORATE_TAX_PERMILLE / 1000));
    expect(res.body.result.deadlines.length).toBeGreaterThan(0);
  });

  it('momsperiod kan ändras och styr deadline-etiketten', async () => {
    const set = await api.post(`${co()}/actions/set_vat_period`).set(auth()).send({ vat_period: 'monthly' });
    expect(set.status).toBe(200);
    const res = await api.post(`${co()}/actions/tax_overview`).set(auth()).send({ as_of: '2025-06-01' });
    expect(res.body.result.vat_period).toBe('monthly');
    expect(res.body.result.deadlines.some((d: { label: string }) => d.label.includes('månad'))).toBe(true);
  });

  it('skattevyn renderas med förbehåll', async () => {
    const ua = supertest.agent(app);
    await ua.post('/app/login').type('form').send({ email: user.email, password: PASSWORD });
    const res = await ua.get(`/app/c/${companyId}/tax`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Momsredovisningsperiod');
    expect(res.text).toContain('Vägledande');
    expect(res.text).toContain('Kommande deadlines');
  });
});
