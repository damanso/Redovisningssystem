// Fas A4: leverantörsfakturor (leverantörsreskontra) — skapa, bokför (→ 2440),
// betala (debet 2440) och åldersanalys (AP aging).
import supertest from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { app, api, createCompany, createFiscalYear, registerUser, type TestUser } from './helpers.js';

const PASSWORD = 'mycket-hemligt-losen-123';
let user: TestUser;
let companyId: string;
let fiscalYearId: string;
let supplierId: string;
const auth = () => ({ Authorization: `Bearer ${user.token}` });
const co = () => `/api/companies/${companyId}`;

// Känsliga actions → begär (202) + godkänn.
async function approveAction(name: string, body: Record<string, unknown>) {
  const req = await api.post(`${co()}/actions/${name}`).set(auth()).send(body);
  expect(req.status, JSON.stringify(req.body)).toBe(202);
  return api.post(`${co()}/approvals/${req.body.approval.id}/approve`).set(auth()).send({});
}
async function apTotal(): Promise<number> {
  const res = await api.post(`${co()}/actions/accounts_payable_aging`).set(auth()).send({ as_of: '2025-07-01' });
  return res.body.result.totals.total_ore;
}

beforeAll(async () => {
  user = await registerUser('apinv');
  companyId = await createCompany(user.token, 'Inköp AB');
  const fy = await createFiscalYear(companyId, auth(), { label: '2025', start_date: '2025-01-01', end_date: '2025-12-31' });
  fiscalYearId = fy.id;
  const s = await api.post(`${co()}/suppliers`).set(auth()).send({ name: 'Leverantör X AB', bankgiro: '123-4567' });
  supplierId = s.body.supplier.id;
});

describe('leverantörsfakturor + AP-aging', () => {
  let siId: string;

  it('skapar, bokför (→ kredit 2440 / ingående moms) och åldersanalyserar', async () => {
    const create = await api.post(`${co()}/actions/create_supplier_invoice`).set(auth()).send({
      supplier_id: supplierId, supplier_ref: 'F-9001', invoice_date: '2025-05-01', due_date: '2025-05-31',
      net_ore: 100000, vat_rate: 25, expense_account: 6110,
    });
    expect(create.status, JSON.stringify(create.body)).toBe(200);
    siId = create.body.result.id;
    expect(create.body.result.total_ore).toBe(125000); // 1000 + 25% moms

    // Före bokföring finns inget i reskontran (voucher_id saknas).
    expect(await apTotal()).toBe(0);

    const momsBefore = await api.get(`${co()}/accounting/vat-report?from=2025-01-01&to=2025-12-31`).set(auth());
    const book = await approveAction('book_supplier_invoice', { supplier_invoice_id: siId, fiscal_year_id: fiscalYearId });
    expect(book.status, JSON.stringify(book.body)).toBe(200);
    expect(book.body.result.status).toBe('booked');

    // Ingående moms ökade med 25 000 ören (2641) → bevisar konteringen.
    const momsAfter = await api.get(`${co()}/accounting/vat-report?from=2025-01-01&to=2025-12-31`).set(auth());
    expect(momsAfter.body.report.input_vat_ore - momsBefore.body.report.input_vat_ore).toBe(25000);

    // 2025-07-01 − 2025-05-31 = 31 dagar → 31–60-hinken, 125 000 utestående.
    const res = await api.post(`${co()}/actions/accounts_payable_aging`).set(auth()).send({ as_of: '2025-07-01' });
    expect(res.body.result.totals.total_ore).toBe(125000);
    expect(res.body.result.totals.d31_60_ore).toBe(125000);
  });

  it('delbetalning debet 2440 → aging räknar netto; full betalning → paid', async () => {
    const p1 = await approveAction('register_supplier_payment', { supplier_invoice_id: siId, fiscal_year_id: fiscalYearId, payment_date: '2025-06-10', amount_ore: 50000 });
    expect(p1.status, JSON.stringify(p1.body)).toBe(200);
    expect(await apTotal()).toBe(75000);

    const p2 = await approveAction('register_supplier_payment', { supplier_invoice_id: siId, fiscal_year_id: fiscalYearId, payment_date: '2025-06-20' });
    expect(p2.status).toBe(200);
    expect(p2.body.result.status).toBe('paid');
    expect(await apTotal()).toBe(0);
  });

  it('leverantörsreskontra-vyn renderas', async () => {
    const ua = supertest.agent(app);
    await ua.post('/app/login').type('form').send({ email: user.email, password: PASSWORD });
    const res = await ua.get(`/app/c/${companyId}/payables`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Leverantörsreskontra');
    expect(res.text).toContain('Leverantör X AB');
  });
});
