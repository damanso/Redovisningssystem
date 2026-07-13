// Fas A7: kassaflöde & likviditet. Kassarörelse på 19xx per månad + enkel
// likviditetsprognos från öppna kund-/leverantörsfakturors förfallodag.
import supertest from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { app, api, createCompany, registerUser, type TestUser } from './helpers.js';

const PASSWORD = 'mycket-hemligt-losen-123';
let user: TestUser;
let companyId: string;
let fiscalYearId: string;
let customerId: string;
const auth = () => ({ Authorization: `Bearer ${user.token}` });
const co = () => `/api/companies/${companyId}`;

async function approveAction(name: string, body: Record<string, unknown>) {
  const req = await api.post(`${co()}/actions/${name}`).set(auth()).send(body);
  expect(req.status, JSON.stringify(req.body)).toBe(202);
  return api.post(`${co()}/approvals/${req.body.approval.id}/approve`).set(auth()).send({});
}

beforeAll(async () => {
  user = await registerUser('cash');
  companyId = await createCompany(user.token, 'Likvid AB');
  const fy = await api.post(`${co()}/accounting/fiscal-years`).set(auth()).send({ label: '2025', start_date: '2025-01-01', end_date: '2025-12-31' });
  fiscalYearId = fy.body.fiscal_year.id;
  const c = await api.post(`${co()}/customers`).set(auth()).send({ name: 'Betalare AB', payment_terms: 30 });
  customerId = c.body.customer.id;

  // En faktura, bokförd och betald → skapar kassarörelse på 1930 (debet vid betalning).
  const inv = await api.post(`${co()}/actions/create_invoice`).set(auth()).send({
    customer_id: customerId, invoice_date: '2025-03-01', due_date: '2025-03-31',
    lines: [{ description: 'Tjänst', quantity: 1, unit_price_ore: 1000000, vat_rate: 25 }],
  });
  const invoiceId = inv.body.result.id;
  await approveAction('book_invoice', { invoice_id: invoiceId, fiscal_year_id: fiscalYearId });
  await approveAction('register_invoice_payment', { invoice_id: invoiceId, fiscal_year_id: fiscalYearId, payment_date: '2025-03-15' });

  // En obetald faktura med framtida förfallodag → väntad inbetalning i prognosen.
  const inv2 = await api.post(`${co()}/actions/create_invoice`).set(auth()).send({
    customer_id: customerId, invoice_date: '2025-06-01', due_date: '2025-06-20',
    lines: [{ description: 'Framtida', quantity: 1, unit_price_ore: 500000, vat_rate: 25 }],
  });
  await approveAction('book_invoice', { invoice_id: inv2.body.result.id, fiscal_year_id: fiscalYearId });
});

describe('kassaflöde & likviditet', () => {
  it('kassaflöde visar 12 månader och registrerar inbetalningen som inflöde', async () => {
    const res = await api.post(`${co()}/actions/cash_flow`).set(auth()).send({ as_of: '2025-12-31' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.result.months.length).toBe(12);
    const march = res.body.result.months.find((m: { ym: string }) => m.ym === '2025-03');
    // Betalning 12 500 kr (10 000 + 25% moms) debiterades 1930 i mars.
    expect(march.inflow_ore).toBe(1250000);
    expect(march.net_ore).toBe(1250000);
    // Utgående kassa ackumuleras och håller sig positiv efter mars.
    expect(march.closing_ore).toBe(1250000);
  });

  it('likviditetsprognos: kassa + väntad inbetalning från öppen faktura', async () => {
    // as_of 2025-06-01 → obetald faktura (förfaller 2025-06-20) hamnar i 1–30-hinken.
    const res = await api.post(`${co()}/actions/liquidity_forecast`).set(auth()).send({ as_of: '2025-06-01' });
    expect(res.status).toBe(200);
    expect(res.body.result.cash_ore).toBe(1250000); // marsbetalningen
    const b30 = res.body.result.buckets.find((b: { label: string }) => b.label === 'Inom 30 dagar');
    expect(b30.inflow_ore).toBe(625000); // 5 000 + 25% moms
    expect(b30.projected_ore).toBe(1875000); // 12 500 + 6 250
  });

  it('kassaflödesvyn renderas', async () => {
    const ua = supertest.agent(app);
    await ua.post('/app/login').type('form').send({ email: user.email, password: PASSWORD });
    const res = await ua.get(`/app/c/${companyId}/cashflow`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Kassaflöde per månad');
    expect(res.text).toContain('Likviditetsprognos');
  });
});
