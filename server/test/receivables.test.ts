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

  it('förfallohinkarnas gränsdagar (0/1/30/31/60/61/90/91) hamnar rätt', async () => {
    // Eget bolag så inga andra fakturor stör. as_of = 2025-06-30.
    const u2 = await registerUser('arb');
    const c2 = await createCompany(u2.token, 'Gränsfall AB');
    const a2 = { Authorization: `Bearer ${u2.token}` };
    const co2 = `/api/companies/${c2}`;
    const fy2 = await api.post(`${co2}/accounting/fiscal-years`).set(a2).send({ label: '2025', start_date: '2025-01-01', end_date: '2025-12-31' });
    const cust = await api.post(`${co2}/customers`).set(a2).send({ name: 'Gräns Kund', payment_terms: 0 });
    // (dagar förbi 2025-06-30 → förväntad hink)
    const cases: [string, 'not_due' | 'd1_30' | 'd31_60' | 'd61_90' | 'd90_plus'][] = [
      ['2025-06-30', 'not_due'],  // 0 dagar (förfaller idag) → ej förfallet
      ['2025-06-29', 'd1_30'],    // 1
      ['2025-05-31', 'd1_30'],    // 30
      ['2025-05-30', 'd31_60'],   // 31
      ['2025-05-01', 'd31_60'],   // 60
      ['2025-04-30', 'd61_90'],   // 61
      ['2025-04-01', 'd61_90'],   // 90
      ['2025-03-31', 'd90_plus'], // 91
    ];
    const counts: Record<string, number> = { not_due: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0 };
    for (const [date, bucket] of cases) {
      const inv = await api.post(`${co2}/invoices`).set(a2).send({ customer_id: cust.body.customer.id, invoice_date: date, lines: [{ description: 'X', quantity: 1, unit_price_ore: 100000, vat_rate: 25 }] });
      await api.post(`${co2}/invoices/${inv.body.invoice.id}/book`).set(a2).send({ fiscal_year_id: fy2.body.fiscal_year.id });
      counts[bucket] = (counts[bucket] ?? 0) + 125_000;
    }
    const res = await api.post(`${co2}/actions/accounts_receivable_aging`).set(a2).send({ as_of: AS_OF });
    const t = res.body.result.totals;
    expect(t.not_due_ore).toBe(counts.not_due);   // 125 000 (1 faktura)
    expect(t.d1_30_ore).toBe(counts.d1_30);       // 250 000 (2)
    expect(t.d31_60_ore).toBe(counts.d31_60);     // 250 000 (2)
    expect(t.d61_90_ore).toBe(counts.d61_90);     // 250 000 (2)
    expect(t.d90_plus_ore).toBe(counts.d90_plus); // 125 000 (1)
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
