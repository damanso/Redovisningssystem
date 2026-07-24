// Fas B3: skattestöd. Underskottsavdrag, periodiseringsfond (25 %) och optimerad
// bolagsskatt + momsavdrag-genomgång och avdragschecklista. Beslutsstöd.
import supertest from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { app, api, createCompany, createFiscalYear, registerUser, type TestUser } from './helpers.js';

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
  user = await registerUser('taxplan');
  companyId = await createCompany(user.token, 'Optimering AB');
  const fy = await createFiscalYear(companyId, auth(), { label: '2025', start_date: '2025-01-01', end_date: '2025-12-31' });
  fiscalYearId = fy.id;

  // Vinst: försäljning netto 100 000, kostnad 20 000 → resultat före skatt 80 000.
  const cust = await api.post(`${co()}/customers`).set(auth()).send({ name: 'Kund' });
  const inv = await api.post(`${co()}/actions/create_invoice`).set(auth()).send({
    customer_id: cust.body.customer.id, invoice_date: '2025-03-01', due_date: '2025-03-31',
    lines: [{ description: 'Tjänst', quantity: 1, unit_price_ore: 100000_00, vat_rate: 25 }],
  });
  await approveAction('book_invoice', { invoice_id: inv.body.result.id, fiscal_year_id: fiscalYearId });
  const receipt = await api.post(`${co()}/actions/create_receipt`).set(auth()).send({
    receipt_date: '2025-03-10', description: 'Inköp', net_ore: 20000_00, vat_rate: 25, expense_account: 5460, payment_account: 1930,
  });
  await approveAction('book_receipt', { receipt_id: receipt.body.result.id, fiscal_year_id: fiscalYearId });
});

describe('skattestöd', () => {
  it('optimerad skatt: periodiseringsfond + underskott sänker skatten', async () => {
    // Ange ingående underskott 10 000 kr.
    const setLoss = await api.post(`${co()}/actions/set_opening_tax_loss`).set(auth()).send({ opening_tax_loss_ore: 10000_00 });
    expect(setLoss.status).toBe(200);

    const res = await api.post(`${co()}/actions/tax_planning`).set(auth()).send({ fiscal_year_id: fiscalYearId });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const p = res.body.result;
    expect(p.result_before_tax_ore).toBe(80000_00); // 100 000 − 20 000
    expect(p.loss_carryforward_ore).toBe(10000_00);
    // Periodiseringsfond max = 25 % av 80 000 = 20 000.
    expect(p.periodiseringsfond_max_ore).toBe(20000_00);
    // Skattemässigt: 80 000 − 20 000 (PF) − 10 000 (underskott) = 50 000.
    expect(p.optimized.taxable_income_ore).toBe(50000_00);
    // Skatt 20,6 % av 50 000 = 10 300. Baslinjen nettar OBLIGATORISKT underskott
    // (men ingen PF): 20,6 % av (80 000 − 10 000) = 14 420. Besparingen är alltså
    // enbart PF-effekten: 14 420 − 10 300 = 4 120 (= 20 000 × 20,6 %).
    expect(p.optimized.tax_ore).toBe(10300_00);
    expect(p.baseline_tax_ore).toBe(14420_00);
    expect(p.estimated_saving_ore).toBe(4120_00);
  });

  it('momsavdrag-genomgång och checklista ingår', async () => {
    const res = await api.post(`${co()}/actions/tax_planning`).set(auth()).send({ fiscal_year_id: fiscalYearId });
    const p = res.body.result;
    expect(p.vat_review.input_vat_ore).toBe(5000_00); // 25 % av 20 000
    expect(p.suggestions.length).toBeGreaterThanOrEqual(4);
    expect(p.suggestions.join(' ')).toContain('Periodiseringsfond');
  });

  it('skattestöds-sektionen renderas med förbehåll', async () => {
    const ua = supertest.agent(app);
    await ua.post('/app/login').type('form').send({ email: user.email, password: PASSWORD });
    const res = await ua.get(`/app/c/${companyId}/tax`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Skattestöd');
    expect(res.text).toContain('Beslutsstöd, ej rådgivning');
    expect(res.text).toContain('Avdragschecklista');
  });
});
