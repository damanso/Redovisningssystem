// Kundreskontra med åldersanalys (🟡-tillägg ovanpå byggd fakturakärna):
// öppna, bokförda, obetalda kundfakturor grupperade per förfalloålder.
import { beforeAll, describe, expect, it } from 'vitest';
import { api, createCompany, registerUser, type TestUser } from './helpers.js';

let user: TestUser;
let companyId: string;
let fiscalYearId: string;
let customerId: string;
const auth = () => ({ Authorization: `Bearer ${user.token}` });
const co = () => `/api/companies/${companyId}`;
const AS_OF = '2025-06-30';

async function invoice(date: string): Promise<string> {
  const res = await api.post(`${co()}/invoices`).set(auth()).send({
    customer_id: customerId, invoice_date: date,
    lines: [{ description: 'Tjänst', quantity: 1, unit_price_ore: 100000, vat_rate: 25 }],
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.invoice.id; // total 125 000 ören (100000 + 25% moms)
}
async function book(id: string) {
  const r = await api.post(`${co()}/invoices/${id}/book`).set(auth()).send({ fiscal_year_id: fiscalYearId });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
}

beforeAll(async () => {
  user = await registerUser('ar');
  companyId = await createCompany(user.token, 'Reskontra AB');
  const fy = await api.post(`${co()}/accounting/fiscal-years`).set(auth())
    .send({ label: '2025', start_date: '2025-01-01', end_date: '2025-12-31' });
  fiscalYearId = fy.body.fiscal_year.id;
  // payment_terms=0 → förfallodag = fakturadatum, så åldern styrs exakt av datumet.
  const c = await api.post(`${co()}/customers`).set(auth()).send({ name: 'Åldrad Kund AB', payment_terms: 0 });
  customerId = c.body.customer.id;
});

describe('kundreskontra åldersanalys', () => {
  it('grupperar öppna bokförda fakturor i rätt förfallohinkar', async () => {
    const notDue = await invoice('2025-07-15'); // förfaller efter AS_OF → ej förfallet
    const d31 = await invoice('2025-05-15');    // 46 dagar → 31–60
    const d90 = await invoice('2025-02-01');    // 149 dagar → >90
    await book(notDue); await book(d31); await book(d90);

    const res = await api.post(`${co()}/actions/accounts_receivable_aging`).set(auth()).send({ as_of: AS_OF });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const aging = res.body.result;
    expect(aging.as_of).toBe(AS_OF);
    expect(aging.rows).toHaveLength(1);
    const t = aging.totals;
    expect(t.not_due_ore).toBe(125_000);
    expect(t.d1_30_ore).toBe(0);
    expect(t.d31_60_ore).toBe(125_000);
    expect(t.d61_90_ore).toBe(0);
    expect(t.d90_plus_ore).toBe(125_000);
    expect(t.total_ore).toBe(375_000);
  });

  it('betalda och ej bokförda (utkast) fakturor räknas INTE som fordran', async () => {
    // En bokförd + betald faktura ska försvinna ur reskontran.
    const paid = await invoice('2025-04-01');
    await book(paid);
    const req = await api.post(`${co()}/actions/register_invoice_payment`).set(auth())
      .send({ invoice_id: paid, fiscal_year_id: fiscalYearId, payment_date: '2025-04-10' });
    const approvalId = req.body.approval.id;
    await api.post(`${co()}/approvals/${approvalId}/approve`).set(auth()).send({});
    // Ett rent utkast (ej bokfört).
    await invoice('2025-04-02');

    const res = await api.post(`${co()}/actions/accounts_receivable_aging`).set(auth()).send({ as_of: AS_OF });
    const t = res.body.result.totals;
    // Fortfarande bara de tre öppna från förra testet (375 000) — betald + utkast exkluderade.
    expect(t.total_ore).toBe(375_000);
  });
});
