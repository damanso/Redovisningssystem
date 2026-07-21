// K4: action-API:ts luckor. list_fiscal_years/list_vouchers/get_voucher som
// read-actions, och fiscal_year_id valfri i bokförings-/betalningsactions —
// härleds server-side ur datumet och kräver ett OLÅST räkenskapsår. En agent
// ska aldrig behöva gå utanför action-manifestet för att slå upp id:n.
import { beforeAll, describe, expect, it } from 'vitest';
import { api, createCompany, registerUser, type TestUser } from './helpers.js';

let user: TestUser;
let companyId: string;
let agentToken: string;
let fiscalYearId: string;
let customerId: string;
const human = () => ({ Authorization: `Bearer ${user.token}` });
const agent = () => ({ Authorization: `Bearer ${agentToken}` });
const co = () => `/api/companies/${companyId}`;

async function approve(reqBody: { approval: { id: string } }) {
  return api.post(`${co()}/approvals/${reqBody.approval.id}/approve`).set(human()).send({});
}

beforeAll(async () => {
  user = await registerUser('k4');
  companyId = await createCompany(user.token, 'Härledning AB');
  const fy = await api.post(`${co()}/accounting/fiscal-years`).set(human()).send({ label: '2025', start_date: '2025-01-01', end_date: '2025-12-31' });
  fiscalYearId = fy.body.fiscal_year.id;
  const tok = await api.post(`${co()}/agent-tokens`).set(human()).send({ name: 'Cowork' });
  agentToken = tok.body.token;
  const cust = await api.post(`${co()}/actions/create_customer`).set(human()).send({ name: 'Kund AB' });
  customerId = cust.body.result.id;
});

describe('K4: uppslag via enbart action-API:t', () => {
  it('en agent kan lista räkenskapsår via action-lagret', async () => {
    const res = await api.post(`${co()}/actions/list_fiscal_years`).set(agent()).send({});
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.result).toHaveLength(1);
    expect(res.body.result[0].id).toBe(fiscalYearId);
    expect(res.body.result[0].is_locked).toBe(false);
  });

  it('faktura kan bokföras och betalas UTAN fiscal_year_id (härleds ur datumet)', async () => {
    const inv = await api.post(`${co()}/actions/create_invoice`).set(human()).send({
      customer_id: customerId, invoice_date: '2025-03-01',
      lines: [{ description: 'Tjänst', quantity: 1, unit_price_ore: 100_000, vat_rate: 25 }],
    });
    expect(inv.status, JSON.stringify(inv.body)).toBe(200);
    const invoiceId = inv.body.result.id;

    const bookReq = await api.post(`${co()}/actions/book_invoice`).set(human()).send({ invoice_id: invoiceId });
    expect(bookReq.status).toBe(202);
    const booked = await approve(bookReq.body);
    expect(booked.status, JSON.stringify(booked.body)).toBe(200);

    // Agenten begär betalningen utan fiscal_year_id → 202 i kön; människan godkänner.
    const payReq = await api.post(`${co()}/actions/register_invoice_payment`).set(agent()).send({
      invoice_id: invoiceId, payment_date: '2025-03-10',
    });
    expect(payReq.status, JSON.stringify(payReq.body)).toBe(202);
    const paid = await approve(payReq.body);
    expect(paid.status, JSON.stringify(paid.body)).toBe(200);
    expect(paid.body.result.status).toBe('paid');
  });

  it('datum utanför alla räkenskapsår ger tydligt fel — inte 500', async () => {
    const inv = await api.post(`${co()}/actions/create_invoice`).set(human()).send({
      customer_id: customerId, invoice_date: '2025-06-01',
      lines: [{ description: 'X', quantity: 1, unit_price_ore: 100_000, vat_rate: 25 }],
    });
    const bookReq = await api.post(`${co()}/actions/book_invoice`).set(human()).send({ invoice_id: inv.body.result.id });
    const booked = await approve(bookReq.body);
    expect(booked.status).toBe(200);

    const payReq = await api.post(`${co()}/actions/register_invoice_payment`).set(human()).send({
      invoice_id: inv.body.result.id, payment_date: '2030-01-10',
    });
    expect(payReq.status).toBe(202);
    const res = await approve(payReq.body);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('no_fiscal_year');
  });

  it('låst räkenskapsår avvisar härledning', async () => {
    const kvitto = await api.post(`${co()}/actions/create_receipt`).set(human()).send({
      receipt_date: '2025-04-01', description: 'Fika', net_ore: 10_000, vat_rate: 12, expense_account: 5460, payment_account: 1930,
    });
    const lockReq = await api.post(`${co()}/actions/lock_period`).set(human()).send({ fiscal_year_id: fiscalYearId, locked: true });
    expect((await approve(lockReq.body)).status).toBe(200);

    const bookReq = await api.post(`${co()}/actions/book_receipt`).set(human()).send({ receipt_id: kvitto.body.result.id });
    const res = await approve(bookReq.body);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('period_locked');

    const unlockReq = await api.post(`${co()}/actions/lock_period`).set(human()).send({ fiscal_year_id: fiscalYearId, locked: false });
    expect((await approve(unlockReq.body)).status).toBe(200);
  });

  it('list_vouchers/get_voucher stänger uppslagsluckan för reverse_voucher', async () => {
    const list = await api.post(`${co()}/actions/list_vouchers`).set(agent()).send({ source_type: 'invoice' });
    expect(list.status, JSON.stringify(list.body)).toBe(200);
    expect(list.body.result.length).toBeGreaterThan(0);
    const voucherId = list.body.result[0].id;
    const got = await api.post(`${co()}/actions/get_voucher`).set(agent()).send({ voucher_id: voucherId });
    expect(got.status).toBe(200);
    expect(got.body.result.lines.length).toBeGreaterThan(0);
  });
});
