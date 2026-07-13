// Fas A1: dashboard 12-mån intäkts-/kostnadsdiagram (JS-fri inline-SVG) +
// monthly_revenue-läs-action.
import supertest from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { app, api, createCompany, registerUser, type TestUser } from './helpers.js';

const PASSWORD = 'mycket-hemligt-losen-123';
let user: TestUser;
let companyId: string;
const auth = () => ({ Authorization: `Bearer ${user.token}` });

beforeAll(async () => {
  user = await registerUser('chart');
  companyId = await createCompany(user.token, 'Diagram AB');
  const fy = await api.post(`/api/companies/${companyId}/accounting/fiscal-years`).set(auth())
    .send({ label: '2025', start_date: '2025-01-01', end_date: '2025-12-31' });
  const cust = await api.post(`/api/companies/${companyId}/customers`).set(auth()).send({ name: 'Diagramkund' });
  const inv = await api.post(`/api/companies/${companyId}/invoices`).set(auth())
    .send({ customer_id: cust.body.customer.id, invoice_date: '2025-03-10', lines: [{ description: 'X', quantity: 1, unit_price_ore: 100000, vat_rate: 25 }] });
  await api.post(`/api/companies/${companyId}/invoices/${inv.body.invoice.id}/book`).set(auth())
    .send({ fiscal_year_id: fy.body.fiscal_year.id });
});

describe('månadsintäkter', () => {
  it('monthly_revenue ger 12 nollfyllda månader med intäkt i rätt månad', async () => {
    const res = await api.post(`/api/companies/${companyId}/actions/monthly_revenue`).set(auth()).send({ as_of: '2025-03-31' });
    expect(res.status).toBe(200);
    const points = res.body.result as { ym: string; revenue_ore: number; expense_ore: number }[];
    expect(points).toHaveLength(12);
    expect(points[points.length - 1]!.ym).toBe('2025-03'); // fönstret slutar på as_of-månaden
    const march = points.find((p) => p.ym === '2025-03')!;
    expect(march.revenue_ore).toBe(100000); // 1000 kr netto (moms räknas inte som intäkt)
    // Övriga månader är noll (fakturan ligger i mars).
    expect(points.filter((p) => p.revenue_ore !== 0)).toHaveLength(1);
  });

  it('dashboarden renderar diagrammet som ren SVG (inget script)', async () => {
    const ua = supertest.agent(app);
    await ua.post('/app/login').type('form').send({ email: user.email, password: PASSWORD });
    const res = await ua.get(`/app/c/${companyId}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Intäkter och kostnader');
    expect(res.text).toContain('<svg class="chart"');
    expect(res.text).not.toContain('<script'); // JS-fritt
  });
});
