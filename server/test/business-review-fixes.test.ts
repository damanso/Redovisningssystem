// Regressionstester för de verifierade fynden i Fas 2-kodgranskningen.
import { beforeAll, describe, expect, it } from 'vitest';
import { api, createCompany, registerUser, type TestUser } from './helpers.js';

let user: TestUser;
let companyId: string;
let fiscalYearId: string;
let customerId: string;
const auth = () => ({ Authorization: `Bearer ${user.token}` });
const co = () => `/api/companies/${companyId}`;

beforeAll(async () => {
  user = await registerUser('brf');
  companyId = await createCompany(user.token, 'Belopp AB');
  const fy = await api.post(`${co()}/accounting/fiscal-years`).set(auth())
    .send({ label: '2025', start_date: '2025-01-01', end_date: '2025-12-31' });
  fiscalYearId = fy.body.fiscal_year.id;
  const c = await api.post(`${co()}/customers`).set(auth()).send({ name: 'Storkund AB' });
  customerId = c.body.customer.id;
});

describe('fynd (HIGH): stora belopp över 2^31 ören kapas inte längre (::int-buggen)', () => {
  it('faktura på 100 MSEK skapas, läses och bokförs korrekt', async () => {
    // 100 000 tim × 1000 kr = 100 000 000 kr netto = 10 000 000 000 ören,
    // vilket är > 2 147 483 647 (int32) → hade tidigare gett 500.
    const res = await api.post(`${co()}/invoices`).set(auth()).send({
      customer_id: customerId, invoice_date: '2025-06-01',
      lines: [{ description: 'Stort uppdrag', quantity: 100000, unit_price_ore: 100000, vat_rate: 25 }],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.invoice.subtotal_ore).toBe(10_000_000_000);
    expect(res.body.invoice.vat_ore).toBe(2_500_000_000);
    expect(res.body.invoice.total_ore).toBe(12_500_000_000);

    // Läsning tillbaka (getInvoice) fungerar (::int hade kastat här).
    const get = await api.get(`${co()}/invoices/${res.body.invoice.id}`).set(auth());
    expect(get.status).toBe(200);
    expect(get.body.invoice.total_ore).toBe(12_500_000_000);

    const book = await api.post(`${co()}/invoices/${res.body.invoice.id}/book`).set(auth()).send({ fiscal_year_id: fiscalYearId });
    expect(book.status, JSON.stringify(book.body)).toBe(200);
    expect(book.body.invoice.voucher_id).toBeTruthy();
  });
});

describe('fynd: robusthet vid fakturaskapande', () => {
  it('ogiltigt kalenderdatum → 400', async () => {
    const res = await api.post(`${co()}/invoices`).set(auth()).send({
      customer_id: customerId, invoice_date: '2025-02-30',
      lines: [{ description: 'x', quantity: 1, unit_price_ore: 1000, vat_rate: 25 }],
    });
    expect(res.status).toBe(400);
  });

  it('kvantitet finare än 3 decimaler avvisas rent (400, inte 500)', async () => {
    const res = await api.post(`${co()}/invoices`).set(auth()).send({
      customer_id: customerId, invoice_date: '2025-06-02',
      lines: [{ description: 'x', quantity: 0.0004, unit_price_ore: 1000, vat_rate: 25 }],
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_line');
  });

  it('förfallodatum före fakturadatum → 400', async () => {
    const res = await api.post(`${co()}/invoices`).set(auth()).send({
      customer_id: customerId, invoice_date: '2025-06-10', due_date: '2025-06-01',
      lines: [{ description: 'x', quantity: 1, unit_price_ore: 1000, vat_rate: 25 }],
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_due_date');
  });

  it('okänt intäktskonto avvisas redan vid skapande (fail-fast)', async () => {
    const res = await api.post(`${co()}/invoices`).set(auth()).send({
      customer_id: customerId, invoice_date: '2025-06-03',
      lines: [{ description: 'x', quantity: 1, unit_price_ore: 1000, vat_rate: 25, revenue_account: 9998 }],
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('unknown_account');
  });
});

describe('fynd: bokföringsspärrar', () => {
  it('gratisrad (0 kr) blockerar inte bokföringen av övriga rader', async () => {
    const res = await api.post(`${co()}/invoices`).set(auth()).send({
      customer_id: customerId, invoice_date: '2025-06-04',
      lines: [
        { description: 'Betald tjänst', quantity: 1, unit_price_ore: 100000, vat_rate: 25 },
        { description: 'Gratis frakt', quantity: 1, unit_price_ore: 0, vat_rate: 25 },
      ],
    });
    expect(res.status).toBe(201);
    const book = await api.post(`${co()}/invoices/${res.body.invoice.id}/book`).set(auth()).send({ fiscal_year_id: fiscalYearId });
    expect(book.status, JSON.stringify(book.body)).toBe(200); // hade fastnat på 400 tidigare
  });

  it('kvitto med nollbelopp avvisas vid skapande', async () => {
    const res = await api.post(`${co()}/receipts`).set(auth()).send({
      receipt_date: '2025-06-05', description: 'noll', net_ore: 0, vat_rate: 25, expense_account: 4010,
    });
    expect(res.status).toBe(400);
  });

  it('okänt kostnadskonto på kvitto avvisas vid skapande', async () => {
    const res = await api.post(`${co()}/receipts`).set(auth()).send({
      receipt_date: '2025-06-05', description: 'x', net_ore: 1000, vat_rate: 25, expense_account: 9997,
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('unknown_account');
  });
});
