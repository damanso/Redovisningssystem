// Fas D4: periodisk sammanställning (EU-moms). EU-försäljning per köpare ur bokförda
// fakturor (3105 varor, 3308 tjänster) + SKV574008-fil. Beräknat underlag.
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
async function euInvoice(customerId: string, revenueAccount: number, netKr: number) {
  const inv = await api.post(`${co()}/actions/create_invoice`).set(auth()).send({
    customer_id: customerId, invoice_date: '2024-05-15', due_date: '2024-06-15',
    lines: [{ description: 'EU', quantity: 1, unit_price_ore: netKr * 100, vat_rate: 0, revenue_account: revenueAccount }],
  });
  expect(inv.status, JSON.stringify(inv.body)).toBe(200);
  await approveAction('book_invoice', { invoice_id: inv.body.result.id, fiscal_year_id: fiscalYearId });
}

let deVatCustomer: string, frCustomer: string, noVatCustomer: string;

beforeAll(async () => {
  user = await registerUser('ecsales');
  companyId = await createCompany(user.token, 'Export AB');
  await api.patch(`${co()}`).set(auth()).send({ org_number: '5560269986' });
  const fy = await api.post(`${co()}/accounting/fiscal-years`).set(auth()).send({ label: '2024', start_date: '2024-01-01', end_date: '2024-12-31' });
  fiscalYearId = fy.body.fiscal_year.id;
  const de = await api.post(`${co()}/actions/create_customer`).set(auth()).send({ name: 'Deutsche GmbH', vat_number: 'DE811234567' });
  deVatCustomer = de.body.result.id;
  const fr = await api.post(`${co()}/actions/create_customer`).set(auth()).send({ name: 'Société FR', vat_number: 'FR12345678901' });
  frCustomer = fr.body.result.id;
  // Varor 50 000 till DE, tjänster 25 000 till FR.
  await euInvoice(deVatCustomer, 3105, 50000);
  await euInvoice(frCustomer, 3308, 25000);
});

async function list(from = '2024-01-01', to = '2024-12-31') {
  const res = await api.post(`${co()}/actions/ec_sales_list`).set(auth()).send({ from, to });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.result;
}

describe('periodisk sammanställning — beräkning', () => {
  it('summerar EU-varor och tjänster per köpare', async () => {
    const d = await list();
    expect(d.total_goods_ore).toBe(5000000);
    expect(d.total_services_ore).toBe(2500000);
    const de = d.rows.find((r: { vat_number: string }) => r.vat_number === 'DE811234567');
    expect(de.goods_ore).toBe(5000000);
    expect(de.services_ore).toBe(0);
    const fr = d.rows.find((r: { vat_number: string }) => r.vat_number === 'FR12345678901');
    expect(fr.services_ore).toBe(2500000);
    expect(d.missing_vat).toHaveLength(0);
  });
});

describe('SKV574008-fil', () => {
  async function file(period: string, over: Record<string, unknown> = {}) {
    return api.post(`${co()}/actions/generate_ec_sales_file`).set(auth()).send({
      period, contact_name: 'Anna Andersson', contact_phone: '08-1234567', contact_email: 'anna@export.se', ...over,
    });
  }
  it('genererar filen med rätt identifierare, huvud och köparrader', async () => {
    const res = await file('2024-05');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const csv = res.body.result.csv as string;
    const lines = csv.trim().split('\r\n');
    expect(lines[0]).toBe('SKV574008;');
    // Huvud: momsnr (org.nr + 01), periodkod YYMM, kontakt.
    expect(lines[1]).toBe('556026998601;2405;Anna Andersson;08-1234567;anna@export.se');
    // Köparrader: köparVAT;varor;trepartshandel;tjänster;
    expect(csv).toContain('DE811234567;50000;;;');
    expect(csv).toContain('FR12345678901;;;25000;');
    expect(res.body.result.filename).toBe('periodisk_sammanstallning_2405.txt');
  });
  it('kvartalsperiod ger periodkod YY-Q', async () => {
    const res = await file('2024-Q2');
    const csv = res.body.result.csv as string;
    expect(csv.split('\r\n')[1]).toContain(';24-2;');
  });
  it('vägrar när en EU-köpare saknar momsnummer', async () => {
    const nv = await api.post(`${co()}/actions/create_customer`).set(auth()).send({ name: 'No VAT Ltd' });
    noVatCustomer = nv.body.result.id;
    await euInvoice(noVatCustomer, 3105, 10000);
    const res = await file('2024-05');
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain('missing_vat_number');
  });
});

describe('EU-moms-vyn', () => {
  it('renderar sammanställning och filformulär', async () => {
    const ua = supertest.agent(app);
    await ua.post('/app/login').type('form').send({ email: user.email, password: PASSWORD });
    const res = await ua.get(`/app/c/${companyId}/ec-sales?from=2024-01-01&to=2024-12-31`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Periodisk sammanställning');
    expect(res.text).toContain('SKV574008');
    expect(res.text).toContain('DE811234567');
  });
});
