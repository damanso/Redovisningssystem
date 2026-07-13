// Fas A9: avancerad analys. Nyckeltal (marginal/soliditet/likviditet i promille),
// toppkunder efter nettoomsättning, kostnadsfördelning per konto.
import supertest from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { app, api, createCompany, registerUser, type TestUser } from './helpers.js';

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
async function bookInvoice(customerId: string, netOre: number, date: string) {
  const inv = await api.post(`${co()}/actions/create_invoice`).set(auth()).send({
    customer_id: customerId, invoice_date: date, due_date: date,
    lines: [{ description: 'Tjänst', quantity: 1, unit_price_ore: netOre, vat_rate: 25 }],
  });
  await approveAction('book_invoice', { invoice_id: inv.body.result.id, fiscal_year_id: fiscalYearId });
}

beforeAll(async () => {
  user = await registerUser('analys');
  companyId = await createCompany(user.token, 'Analys AB');
  const fy = await api.post(`${co()}/accounting/fiscal-years`).set(auth()).send({ label: '2025', start_date: '2025-01-01', end_date: '2025-12-31' });
  fiscalYearId = fy.body.fiscal_year.id;
  const big = await api.post(`${co()}/suppliers`).set(auth()).send({ name: 'Kostnad AB' });

  const c1 = await api.post(`${co()}/customers`).set(auth()).send({ name: 'Storkund AB' });
  const c2 = await api.post(`${co()}/customers`).set(auth()).send({ name: 'Småkund AB' });
  await bookInvoice(c1.body.customer.id, 1000000, '2025-03-01'); // 10 000 kr netto
  await bookInvoice(c1.body.customer.id, 500000, '2025-04-01');  //  5 000 kr netto
  await bookInvoice(c2.body.customer.id, 200000, '2025-05-01');  //  2 000 kr netto

  // En bokförd kostnad (kvitto) → kostnadskonto för kostnadsfördelningen.
  const receipt = await api.post(`${co()}/actions/create_receipt`).set(auth()).send({
    supplier_id: big.body.supplier.id, receipt_date: '2025-03-10', description: 'Inköp',
    net_ore: 400000, vat_rate: 25, expense_account: 5460,
  });
  await approveAction('book_receipt', { receipt_id: receipt.body.result.id, fiscal_year_id: fiscalYearId });
});

describe('avancerad analys', () => {
  it('toppkunder rankas efter nettoomsättning', async () => {
    const res = await api.post(`${co()}/actions/top_customers`).set(auth()).send({ from: '2025-01-01', to: '2025-12-31' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const rows = res.body.result;
    expect(rows[0].customer_name).toBe('Storkund AB');
    expect(rows[0].net_ore).toBe(1500000); // 10 000 + 5 000
    expect(rows[0].invoice_count).toBe(2);
    expect(rows[1].customer_name).toBe('Småkund AB');
    expect(rows[1].net_ore).toBe(200000);
  });

  it('kostnadsfördelning summerar bokförda kostnader med andel', async () => {
    const res = await api.post(`${co()}/actions/expense_breakdown`).set(auth()).send({ from: '2025-01-01', to: '2025-12-31' });
    expect(res.status).toBe(200);
    expect(res.body.result.total_ore).toBe(400000);
    const slice = res.body.result.slices.find((s: { account_number: number }) => s.account_number === 5460);
    expect(slice.amount_ore).toBe(400000);
    expect(slice.share_permille).toBe(1000); // 100 %
  });

  it('nyckeltal: nettomarginal i promille', async () => {
    const res = await api.post(`${co()}/actions/key_ratios`).set(auth()).send({ from: '2025-01-01', to: '2025-12-31' });
    expect(res.status).toBe(200);
    // Intäkter 17 000 kr, kostnad 4 000 kr → resultat 13 000 kr; marginal 13000/17000 ≈ 765‰.
    expect(res.body.result.revenue_ore).toBe(1700000);
    expect(res.body.result.expense_ore).toBe(400000);
    expect(res.body.result.result_ore).toBe(1300000);
    expect(res.body.result.net_margin_permille).toBe(765);
  });

  it('analysvyn renderas', async () => {
    const ua = supertest.agent(app);
    await ua.post('/app/login').type('form').send({ email: user.email, password: PASSWORD });
    const res = await ua.get(`/app/c/${companyId}/analytics`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Avancerad analys');
    expect(res.text).toContain('Storkund AB');
    expect(res.text).toContain('Nettomarginal');
  });
});
