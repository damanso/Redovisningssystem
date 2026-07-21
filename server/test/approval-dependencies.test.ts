// K4: beroendemedveten godkännandekö. En betalning som köas före sin faktura-
// bokning ska visa beroendet ("godkänn Bokför faktura X först") i 202-svaret,
// i kölistningen och i Att göra-vyn — aldrig ett rött fel som första upptäckt.
// Composite-actionen book_invoice_and_register_payment köar båda stegen som
// EN godkännandepost och kör dem atomiskt.
import supertest from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { api, app, createCompany, registerUser, type TestUser } from './helpers.js';

const PASSWORD = 'mycket-hemligt-losen-123';
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

async function newInvoice(): Promise<string> {
  const inv = await api.post(`${co()}/actions/create_invoice`).set(human()).send({
    customer_id: customerId, invoice_date: '2025-03-01',
    lines: [{ description: 'Tjänst', quantity: 1, unit_price_ore: 100_000, vat_rate: 25 }],
  });
  expect(inv.status, JSON.stringify(inv.body)).toBe(200);
  return inv.body.result.id;
}

beforeAll(async () => {
  user = await registerUser('deps');
  companyId = await createCompany(user.token, 'Beroende AB');
  const fy = await api.post(`${co()}/accounting/fiscal-years`).set(human()).send({ label: '2025', start_date: '2025-01-01', end_date: '2025-12-31' });
  fiscalYearId = fy.body.fiscal_year.id;
  const tok = await api.post(`${co()}/agent-tokens`).set(human()).send({ name: 'Cowork' });
  agentToken = tok.body.token;
  const cust = await api.post(`${co()}/actions/create_customer`).set(human()).send({ name: 'Kund AB' });
  customerId = cust.body.result.id;
});

describe('beroende i godkännandekön', () => {
  let invoiceId: string;
  let paymentApprovalId: string;

  it('betalning köad före bokning: 202-svaret bär beroendet direkt', async () => {
    invoiceId = await newInvoice();
    const res = await api.post(`${co()}/actions/register_invoice_payment`).set(agent()).send({
      invoice_id: invoiceId, payment_date: '2025-03-10',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(202);
    paymentApprovalId = res.body.approval.id;
    expect(res.body.dependency).toBeTruthy();
    expect(res.body.dependency.satisfied).toBe(false);
    expect(res.body.dependency.depends_on_action).toBe('book_invoice');
    expect(res.body.dependency.message).toMatch(/inte bokförd/);
  });

  it('kölistningen annoterar beroendet och pekar på bokningsförslaget när det köats', async () => {
    // Innan bokningen köats: vägledning att köa book_invoice först.
    const before = await api.get(`${co()}/approvals?status=pending`).set(human());
    const payBefore = before.body.approvals.find((a: { id: string }) => a.id === paymentApprovalId);
    expect(payBefore.dependency.message).toMatch(/book_invoice/);
    expect(payBefore.dependency.pending_approval_id).toBeUndefined();

    // Köa bokningen — nu ska betalningens beroende peka på det förslaget.
    const bookReq = await api.post(`${co()}/actions/book_invoice`).set(agent()).send({ invoice_id: invoiceId });
    expect(bookReq.status).toBe(202);
    const after = await api.get(`${co()}/approvals?status=pending`).set(human());
    const payAfter = after.body.approvals.find((a: { id: string }) => a.id === paymentApprovalId);
    expect(payAfter.dependency.pending_approval_id).toBe(bookReq.body.approval.id);
    expect(payAfter.dependency.message).toMatch(/godkänn förslaget/);

    // Att göra-vyn visar ordningen för människan.
    const ua = supertest.agent(app);
    await ua.post('/app/login').type('form').send({ email: user.email, password: PASSWORD });
    const page = await ua.get(`/app/c/${companyId}/approvals`);
    expect(page.status).toBe(200);
    expect(page.text).toContain('inte bokförd');

    // Godkänn i rätt ordning: bokningen först, sedan betalningen — grönt.
    expect((await approve(bookReq.body)).status).toBe(200);
    const clean = await api.get(`${co()}/approvals?status=pending`).set(human());
    const payClean = clean.body.approvals.find((a: { id: string }) => a.id === paymentApprovalId);
    expect(payClean.dependency).toBeUndefined(); // beroendet är uppfyllt → ingen varning
    const paid = await api.post(`${co()}/approvals/${paymentApprovalId}/approve`).set(human()).send({});
    expect(paid.status, JSON.stringify(paid.body)).toBe(200);
    expect(paid.body.result.status).toBe('paid');
  });
});

describe('composite: book_invoice_and_register_payment', () => {
  it('köas som EN godkännandepost och bokför + betalar atomiskt', async () => {
    const invoiceId = await newInvoice();
    const res = await api.post(`${co()}/actions/book_invoice_and_register_payment`).set(agent()).send({
      invoice_id: invoiceId, payment_date: '2025-03-15',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(202);
    expect(res.body.dependency).toBeUndefined(); // composite har inget yttre beroende

    const ok = await approve(res.body);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.result.booked_now).toBe(true);
    expect(ok.body.result.invoice.status).toBe('paid');
    expect(ok.body.result.invoice.voucher_id).toBeTruthy();
  });

  it('tolererar redan bokförd faktura — registrerar bara betalningen', async () => {
    const invoiceId = await newInvoice();
    const bookReq = await api.post(`${co()}/actions/book_invoice`).set(human()).send({ invoice_id: invoiceId, fiscal_year_id: fiscalYearId });
    expect((await approve(bookReq.body)).status).toBe(200);

    const res = await api.post(`${co()}/actions/book_invoice_and_register_payment`).set(human()).send({
      invoice_id: invoiceId, payment_date: '2025-03-20',
    });
    const ok = await approve(res.body);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.result.booked_now).toBe(false);
    expect(ok.body.result.invoice.status).toBe('paid');
  });
});
