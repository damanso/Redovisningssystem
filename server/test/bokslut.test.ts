// Fas C2: bokförda bokslutstransaktioner. Periodiseringsfond (8811/2110), årets
// skatt (8910/2512), överföring av årets resultat (8999/2099), dubbelbokningsspärr
// och lås. Verifieras via K2-rapporten (balansposter) + huvudbok.
import { beforeAll, describe, expect, it } from 'vitest';
import { api, createCompany, registerUser, type TestUser } from './helpers.js';

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
async function k2() {
  const res = await api.post(`${co()}/actions/k2_annual_report`).set(auth()).send({ fiscal_year_id: fiscalYearId });
  return res.body.result;
}

beforeAll(async () => {
  user = await registerUser('bokslut');
  companyId = await createCompany(user.token, 'Bokslut2 AB');
  const fy = await api.post(`${co()}/accounting/fiscal-years`).set(auth()).send({ label: '2025', start_date: '2025-01-01', end_date: '2025-12-31' });
  fiscalYearId = fy.body.fiscal_year.id;
  // Vinst före skatt 80 000: intäkt 100 000, kostnad 20 000.
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

describe('bokförda bokslutstransaktioner', () => {
  it('avsättning periodiseringsfond bokförs till obeskattade reserver (2110)', async () => {
    const res = await approveAction('book_periodiseringsfond', { fiscal_year_id: fiscalYearId, type: 'avsattning', amount_ore: 20000_00 });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.result.amount_ore).toBe(20000_00);
    const r = await k2();
    expect(r.balance_sheet.untaxed.total_ore).toBe(20000_00);
    expect(r.balance_sheet.difference_ore).toBe(0);
    // Resultat före skatt sjönk från 80 000 till 60 000 (PF är en kostnad 8811).
    expect(r.income_statement.arets_resultat_ore).toBe(60000_00);
  });

  it('årets skatt bokförs (8910/2512) och kan inte bokföras två gånger', async () => {
    // 20,6 % av 60 000 = 12 360.
    const res = await approveAction('book_corporate_tax', { fiscal_year_id: fiscalYearId, amount_ore: 12360_00 });
    expect(res.body.result.amount_ore).toBe(12360_00);
    const r = await k2();
    // Skatteskuld 2512 ligger i kortfristiga skulder (skatteskulder 2500–2599).
    const skatt = r.balance_sheet.short_liabilities.lines.find((l: { key: string }) => l.key === 'skatteskulder');
    expect(skatt.amount_ore).toBe(12360_00);
    expect(r.income_statement.arets_resultat_ore).toBe(47640_00); // 60 000 − 12 360

    const dup = await api.post(`${co()}/actions/book_corporate_tax`).set(auth()).send({ fiscal_year_id: fiscalYearId, amount_ore: 12360_00 });
    const done = await api.post(`${co()}/approvals/${dup.body.approval.id}/approve`).set(auth()).send({});
    expect(done.status).toBe(409);
  });

  it('överför årets resultat till eget kapital (2099) — en gång', async () => {
    const res = await approveAction('book_year_result', { fiscal_year_id: fiscalYearId });
    expect(res.body.result.result_ore).toBe(47640_00);
    const r = await k2();
    // Årets resultat är nu flyttat till fritt eget kapital (2099); resultatbäraren
    // 8999 nollar resultaträkningens EK-post i balansräkningen.
    expect(r.balance_sheet.equity.arets_resultat_ore).toBe(0);
    expect(r.balance_sheet.equity.free.total_ore).toBe(47640_00);
    expect(r.balance_sheet.difference_ore).toBe(0);

    const dup = await api.post(`${co()}/actions/book_year_result`).set(auth()).send({ fiscal_year_id: fiscalYearId });
    const done = await api.post(`${co()}/approvals/${dup.body.approval.id}/approve`).set(auth()).send({});
    expect(done.status).toBe(409);
  });

  it('låst räkenskapsår vägrar fler bokslutstransaktioner', async () => {
    await api.patch(`${co()}/accounting/fiscal-years/${fiscalYearId}`).set(auth()).send({ locked: true });
    const req = await api.post(`${co()}/actions/book_periodiseringsfond`).set(auth()).send({ fiscal_year_id: fiscalYearId, type: 'avsattning', amount_ore: 1000_00 });
    const done = await api.post(`${co()}/approvals/${req.body.approval.id}/approve`).set(auth()).send({});
    expect(done.status).toBe(409); // year_locked
  });
});
