// Fas B1: K2-årsredovisning. Resultat- och balansräkning i K2-uppställning + noter
// ur huvudboken. Verifierar att uppställningen stämmer och att balansräkningen går ihop.
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

beforeAll(async () => {
  user = await registerUser('k2');
  companyId = await createCompany(user.token, 'Bokslut AB');
  const fy = await api.post(`${co()}/accounting/fiscal-years`).set(auth()).send({ label: '2025', start_date: '2025-01-01', end_date: '2025-12-31' });
  fiscalYearId = fy.body.fiscal_year.id;

  // Försäljning: faktura netto 100 000, moms 25 % → 3001 kredit 100000, 1510 debet 125000.
  const cust = await api.post(`${co()}/customers`).set(auth()).send({ name: 'Kund AB' });
  const inv = await api.post(`${co()}/actions/create_invoice`).set(auth()).send({
    customer_id: cust.body.customer.id, invoice_date: '2025-03-01', due_date: '2025-03-31',
    lines: [{ description: 'Konsulttjänst', quantity: 1, unit_price_ore: 100000_00, vat_rate: 25 }],
  });
  await approveAction('book_invoice', { invoice_id: inv.body.result.id, fiscal_year_id: fiscalYearId });

  // Kostnad: kvitto netto 40 000 + moms, betalt från bank (1930).
  const receipt = await api.post(`${co()}/actions/create_receipt`).set(auth()).send({
    receipt_date: '2025-03-10', description: 'Inköp material', net_ore: 40000_00, vat_rate: 25,
    expense_account: 5460, payment_account: 1930,
  });
  await approveAction('book_receipt', { receipt_id: receipt.body.result.id, fiscal_year_id: fiscalYearId });
});

describe('K2-årsredovisning', () => {
  it('resultaträkning i K2-uppställning', async () => {
    const res = await api.post(`${co()}/actions/k2_annual_report`).set(auth()).send({ fiscal_year_id: fiscalYearId });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const is = res.body.result.income_statement;
    const netto = is.operating.lines.find((l: { key: string }) => l.key === 'nettoomsattning');
    expect(netto.amount_ore).toBe(100000_00);
    const kostn = is.operating.lines.find((l: { key: string }) => l.key === 'ovriga_externa_kostnader');
    expect(kostn.amount_ore).toBe(-40000_00); // kostnad visas negativt
    expect(is.rorelseresultat_ore).toBe(60000_00);
    expect(is.arets_resultat_ore).toBe(60000_00);
  });

  it('balansräkning går ihop (tillgångar = eget kapital + skulder)', async () => {
    const res = await api.post(`${co()}/actions/k2_annual_report`).set(auth()).send({ fiscal_year_id: fiscalYearId });
    const bs = res.body.result.balance_sheet;
    // Tillgångar: kundfordran 125 000 + bank −50 000 = 75 000.
    expect(bs.total_assets_ore).toBe(75000_00);
    // EK (årets resultat 60 000) + momsskuld (25 000 − 10 000 = 15 000) = 75 000.
    expect(bs.equity.arets_resultat_ore).toBe(60000_00);
    expect(bs.total_equity_liabilities_ore).toBe(75000_00);
    expect(bs.difference_ore).toBe(0); // balanserar
  });

  it('noter innehåller redovisningsprinciper och medelantal anställda', async () => {
    const res = await api.post(`${co()}/actions/k2_annual_report`).set(auth()).send({ fiscal_year_id: fiscalYearId });
    expect(res.body.result.notes.principer.length).toBeGreaterThan(0);
    expect(res.body.result.notes.principer[0]).toContain('K2');
    expect(res.body.result.notes.avg_employees).toBe(0);
  });

  it('årsredovisningsvyn renderas med förbehåll', async () => {
    const ua = supertest.agent(app);
    await ua.post('/app/login').type('form').send({ email: user.email, password: PASSWORD });
    const res = await ua.get(`/app/c/${companyId}/annual`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Årsredovisning 2025');
    expect(res.text).toContain('Resultaträkning');
    expect(res.text).toContain('Balansräkning');
    expect(res.text).toContain('Underlag'); // förbehållet syns
  });

  it('CSV-export levererar en fil', async () => {
    const ua = supertest.agent(app);
    await ua.post('/app/login').type('form').send({ email: user.email, password: PASSWORD });
    const res = await ua.get(`/app/c/${companyId}/annual/export.csv?fy=${fiscalYearId}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toContain('arsredovisning-k2.csv');
    expect(res.text).toContain('Nettoomsättning');
  });
});
