// Fas A3: riktiga delbetalningar — flera betalningsverifikat per faktura,
// paid_amount räknas upp, aging räknar netto, överbetalning spärras.
import { beforeAll, describe, expect, it } from 'vitest';
import { api, createCompany, registerUser, type TestUser } from './helpers.js';

let user: TestUser;
let companyId: string;
let fiscalYearId: string;
let customerId: string;
const auth = () => ({ Authorization: `Bearer ${user.token}` });
const co = () => `/api/companies/${companyId}`;

async function bookedInvoice(): Promise<string> {
  const inv = await api.post(`${co()}/invoices`).set(auth())
    .send({ customer_id: customerId, invoice_date: '2025-06-01', lines: [{ description: 'X', quantity: 1, unit_price_ore: 100000, vat_rate: 25 }] });
  await api.post(`${co()}/invoices/${inv.body.invoice.id}/book`).set(auth()).send({ fiscal_year_id: fiscalYearId });
  return inv.body.invoice.id; // total 125 000 ören
}
// Betalning är känslig → begär (202 pending) → godkänn. Returnerar approve-svaret.
async function pay(invoiceId: string, amountOre?: number) {
  const body: Record<string, unknown> = { invoice_id: invoiceId, fiscal_year_id: fiscalYearId, payment_date: '2025-06-15' };
  if (amountOre !== undefined) body.amount_ore = amountOre;
  const req = await api.post(`${co()}/actions/register_invoice_payment`).set(auth()).send(body);
  expect(req.status, JSON.stringify(req.body)).toBe(202);
  return api.post(`${co()}/approvals/${req.body.approval.id}/approve`).set(auth()).send({});
}
async function agingTotal(): Promise<number> {
  const res = await api.post(`${co()}/actions/accounts_receivable_aging`).set(auth()).send({ as_of: '2025-07-01' });
  return res.body.result.totals.total_ore;
}

beforeAll(async () => {
  user = await registerUser('partpay');
  companyId = await createCompany(user.token, 'Delbetalning AB');
  const fy = await api.post(`${co()}/accounting/fiscal-years`).set(auth()).send({ label: '2025', start_date: '2025-01-01', end_date: '2025-12-31' });
  fiscalYearId = fy.body.fiscal_year.id;
  const c = await api.post(`${co()}/customers`).set(auth()).send({ name: 'Delkund', payment_terms: 0 });
  customerId = c.body.customer.id;
});

describe('delbetalningar', () => {
  it('två delbetalningar → paid_amount räknas upp, status paid först vid full betalning; aging räknar netto', async () => {
    const inv = await bookedInvoice();
    expect(await agingTotal()).toBe(125_000);

    const p1 = await pay(inv, 50_000);
    expect(p1.status, JSON.stringify(p1.body)).toBe(200);
    let after = await api.get(`${co()}/invoices`).set(auth());
    let row = after.body.invoices.find((i: { id: string }) => i.id === inv);
    expect(row.status).not.toBe('paid');       // delbetald → fortfarande öppen
    expect(await agingTotal()).toBe(75_000);   // netto återstår i reskontran

    const p2 = await pay(inv);                  // inget belopp → återstoden (75 000)
    expect(p2.status, JSON.stringify(p2.body)).toBe(200);
    after = await api.get(`${co()}/invoices`).set(auth());
    row = after.body.invoices.find((i: { id: string }) => i.id === inv);
    expect(row.status).toBe('paid');
    expect(await agingTotal()).toBe(0);
  });

  it('överbetalning avvisas vid godkännandet (får ej överstiga återstoden)', async () => {
    const inv = await bookedInvoice();
    const res = await pay(inv, 200_000); // > 125 000
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('overpayment');
    // Fakturan är orörd och ligger kvar i reskontran.
    const after = await api.get(`${co()}/invoices`).set(auth());
    const row = after.body.invoices.find((i: { id: string }) => i.id === inv);
    expect(row.status).not.toBe('paid');
  });
});
