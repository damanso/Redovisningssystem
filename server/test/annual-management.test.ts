// Fas C3: komplett årsredovisning. Förvaltningsberättelse (flerårsöversikt,
// förändring eget kapital, resultatdisposition), anläggningsnot, fastställelseintyg.
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
  user = await registerUser('mgmt');
  companyId = await createCompany(user.token, 'Årsredovisning AB');
  const fy = await createFiscalYear(companyId, auth(), { label: '2025', start_date: '2025-01-01', end_date: '2025-12-31' });
  fiscalYearId = fy.id;
  // Vinst 80 000 + en anläggningstillgång.
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
  await api.post(`${co()}/actions/create_fixed_asset`).set(auth()).send({
    name: 'Servrar', acquisition_date: '2025-01-01', acquisition_cost_ore: 60000_00, useful_life_months: 60,
  });
});

describe('förvaltningsberättelse', () => {
  it('flerårsöversikt, förändring eget kapital och resultatdisposition beräknas', async () => {
    const res = await api.post(`${co()}/actions/k2_management_report`).set(auth()).send({ fiscal_year_id: fiscalYearId });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const m = res.body.result;
    expect(m.flerarsoversikt.length).toBeGreaterThanOrEqual(1);
    expect(m.flerarsoversikt[0].net_revenue_ore).toBe(100000_00);
    expect(m.flerarsoversikt[0].result_after_financial_ore).toBe(80000_00);
    // Årets resultat i förändring eget kapital = 80 000 (före skatt/bokslut).
    expect(m.equity_changes.arets_resultat_ore).toBe(80000_00);
    // Resultatdisposition = balanserat (0) + årets resultat (80 000).
    expect(m.resultatdisposition.total_ore).toBe(80000_00);
    // Anläggningsnot finns.
    expect(m.fixed_assets_note.acquisition_cost_ore).toBe(60000_00);
    expect(m.fixed_assets_note.count).toBe(1);
  });

  it('verksamhetsbeskrivning kan sparas och visas', async () => {
    const set = await api.post(`${co()}/actions/set_business_description`).set(auth()).send({ business_description: 'Bolaget bedriver IT-konsultverksamhet.' });
    expect(set.status).toBe(200);
    const res = await api.post(`${co()}/actions/k2_management_report`).set(auth()).send({ fiscal_year_id: fiscalYearId });
    expect(res.body.result.business_description).toContain('IT-konsult');
  });

  it('årsredovisningsvyn visar förvaltningsberättelse och underskriftssida', async () => {
    const ua = supertest.agent(app);
    await ua.post('/app/login').type('form').send({ email: user.email, password: PASSWORD });
    const res = await ua.get(`/app/c/${companyId}/annual`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Förvaltningsberättelse');
    expect(res.text).toContain('Flerårsöversikt');
    expect(res.text).toContain('Resultatdisposition');
    expect(res.text).toContain('Fastställelseintyg');
    expect(res.text).toContain('IT-konsult'); // sparad verksamhetstext
  });
});
