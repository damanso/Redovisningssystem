// Fas E3: ROT/RUT-avdrag (husavdrag) enligt fakturamodellen. Skattereduktionen
// beräknas på arbetskostnaden (inkl. moms), kunden betalar fakturan minus avdraget,
// och den del kunden inte betalar bokförs som fordran på Skatteverket (1513).
// Beräknat underlag — ingen digital begäran till Skatteverket.
import supertest from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { app, api, createCompany, pdfText, registerUser, withAdmin, type TestUser } from './helpers.js';
import { computeHouseworkReduction } from '../src/services/housework.js';

const PASSWORD = 'mycket-hemligt-losen-123';
let user: TestUser;
let companyId: string;
let fiscalYearId: string;
let customerId: string;
const auth = () => ({ Authorization: `Bearer ${user.token}` });
const co = () => `/api/companies/${companyId}`;

async function pdfBuffer(invoiceId: string): Promise<Buffer> {
  const res = await api.post(`${co()}/invoices/${invoiceId}/pdf`).set(auth()).buffer()
    .parse((r, cb) => { const chunks: Buffer[] = []; r.on('data', (c: Buffer) => chunks.push(c)); r.on('end', () => cb(null, Buffer.concat(chunks))); });
  return res.body as Buffer;
}
async function voucherLines(voucherId: string) {
  return withAdmin(async (c) => (await c.query<{ account_number: number; debit_ore: string; credit_ore: string }>(
    'SELECT account_number, debit_ore, credit_ore FROM voucher_lines WHERE voucher_id = $1 ORDER BY account_number', [voucherId])).rows);
}

beforeAll(async () => {
  user = await registerUser('housework');
  companyId = await createCompany(user.token, 'Hantverkarn AB');
  await api.patch(`${co()}`).set(auth()).send({ org_number: '5560123456' });
  const fy = await api.post(`${co()}/accounting/fiscal-years`).set(auth()).send({ label: '2025', start_date: '2025-01-01', end_date: '2025-12-31' });
  fiscalYearId = fy.body.fiscal_year.id;
  const c = await api.post(`${co()}/customers`).set(auth()).send({ name: 'Privatkund', payment_terms: 30 });
  customerId = c.body.customer.id;
});

describe('ROT-beräkning (enhetsfunktion)', () => {
  it('30 % av arbetskostnaden, kapat mot ROT-taket', () => {
    expect(computeHouseworkReduction('rot', 1_000_000, { rot_ore: 0, total_ore: 0 }).reduction_ore).toBe(300_000);
    // Tak 50 000 kr: raw 60 000 kr → kapas till 50 000 kr.
    const capped = computeHouseworkReduction('rot', 20_000_000, { rot_ore: 0, total_ore: 0 });
    expect(capped.reduction_ore).toBe(5_000_000);
    expect(capped.capped).toBe(true);
  });
  it('RUT 50 %, gemensamt tak 75 000 kr', () => {
    expect(computeHouseworkReduction('rut', 1_000_000, { rot_ore: 0, total_ore: 0 }).reduction_ore).toBe(500_000);
    // Redan 70 000 kr använt → bara 5 000 kr kvar av det gemensamma taket.
    const capped = computeHouseworkReduction('rut', 2_000_000, { rot_ore: 0, total_ore: 7_000_000 });
    expect(capped.reduction_ore).toBe(500_000); // 75 000 − 70 000 = 5 000 kr
  });
});

describe('ROT-faktura', () => {
  it('beräknar avdrag, delar upp fordran vid bokföring och visar allt på PDF', async () => {
    // Faktura 12 500 kr (10 000 + 25 % moms), allt arbetskostnad → ROT 30 % av 12 500 = 3 750 kr.
    const inv = await api.post(`${co()}/invoices`).set(auth()).send({
      customer_id: customerId, invoice_date: '2025-03-01',
      housework_type: 'rot', labor_cost_ore: 1_250_000, buyer_personnummer: '199001011234', property_designation: 'Villan 1:2',
      lines: [{ description: 'Renovering', quantity: 1, unit_price_ore: 1_000_000, vat_rate: 25 }],
    });
    expect(inv.status, JSON.stringify(inv.body)).toBe(201);
    const invoice = inv.body.invoice;
    expect(invoice.total_ore).toBe(1_250_000);
    expect(invoice.housework_type).toBe('rot');
    expect(invoice.housework_reduction_ore).toBe(375_000); // 3 750 kr

    const book = await api.post(`${co()}/invoices/${invoice.id}/book`).set(auth()).send({ fiscal_year_id: fiscalYearId });
    expect(book.status, JSON.stringify(book.body)).toBe(200);
    const lines = await voucherLines(book.body.invoice.voucher_id);
    const byAcct = Object.fromEntries(lines.map((l) => [l.account_number, { d: Number(l.debit_ore), c: Number(l.credit_ore) }]));
    expect(byAcct[1510]!.d).toBe(1_250_000 - 375_000); // kundfordran = kundens del (8 750 kr)
    expect(byAcct[1513]!.d).toBe(375_000);             // fordran Skatteverket = avdraget
    expect(byAcct[3001]!.c).toBe(1_000_000);           // intäkt netto
    expect(byAcct[2611]!.c).toBe(250_000);             // utgående moms 25 %
    // Debet = kredit (balanserat verifikat).
    const debit = lines.reduce((s, l) => s + Number(l.debit_ore), 0);
    const credit = lines.reduce((s, l) => s + Number(l.credit_ore), 0);
    expect(debit).toBe(credit);

    const text = pdfText(await pdfBuffer(invoice.id));
    expect(text).toContain('ROT-avdrag');
    expect(text).toContain('199001011234');
    expect(text).toContain('Villan 1:2');
    expect(text).toContain('Husavdrag');

    // Grindfynd: kunden betalar total − avdrag (8 750 kr); den fulla totalen får
    // INTE stå som "Att betala" i betalningsblocket.
    expect(text).toContain('8 750,00'); // 8 750,00 (reducerat att betala)
  });

  it('kunden betalar sin del (total − avdrag) → fakturan markeras betald (grindfynd E3)', async () => {
    const inv = await api.post(`${co()}/invoices`).set(auth()).send({
      customer_id: customerId, invoice_date: '2025-07-01',
      housework_type: 'rot', labor_cost_ore: 1_250_000, buyer_personnummer: '199001011234', property_designation: 'Villan 1:2',
      lines: [{ description: 'Renovering', quantity: 1, unit_price_ore: 1_000_000, vat_rate: 25 }],
    });
    const id = inv.body.invoice.id;
    await api.post(`${co()}/invoices/${id}/book`).set(auth()).send({ fiscal_year_id: fiscalYearId });
    // Kundens del = 1 250 000 − 375 000 = 875 000 ören.
    const req = await api.post(`${co()}/actions/register_invoice_payment`).set(auth()).send({ invoice_id: id, fiscal_year_id: fiscalYearId, payment_date: '2025-07-20' });
    expect(req.status, JSON.stringify(req.body)).toBe(202);
    const done = await api.post(`${co()}/approvals/${req.body.approval.id}/approve`).set(auth()).send({});
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect(done.body.result.paid_amount_ore).toBe(875_000); // default-belopp = kundens återstod
    expect(done.body.result.status).toBe('paid');            // markeras betald när kundens del är betald
  });
});

describe('Årligt tak över flera fakturor', () => {
  it('summerar avdrag per köpare och år och kapar', async () => {
    const c2 = await api.post(`${co()}/customers`).set(auth()).send({ name: 'RUT-kund', payment_terms: 30 });
    const mk = (labor: number) => api.post(`${co()}/invoices`).set(auth()).send({
      customer_id: c2.body.customer.id, invoice_date: '2025-06-01',
      housework_type: 'rut', labor_cost_ore: labor, buyer_personnummer: '198512121212',
      lines: [{ description: 'Städning', quantity: 1, unit_price_ore: labor, vat_rate: 0 }],
    });
    const a = await mk(14_000_000); // RUT 50 % = 70 000 kr (under taket 75 000)
    expect(a.body.invoice.housework_reduction_ore).toBe(7_000_000);
    const b = await mk(14_000_000); // ytterligare 70 000 kr raw → bara 5 000 kr kvar
    expect(b.body.invoice.housework_reduction_ore).toBe(500_000); // kapat till kvarvarande utrymme
  });
});

describe('Personnummer-kanonisering (grindfynd E3)', () => {
  it('samma person i 12- och 10-siffrigt format aggregeras mot taket', async () => {
    const c = await api.post(`${co()}/customers`).set(auth()).send({ name: 'Mixformat', payment_terms: 30 });
    const cid = c.body.customer.id;
    const mk = (pnr: string, labor: number) => api.post(`${co()}/invoices`).set(auth()).send({
      customer_id: cid, invoice_date: '2025-08-01',
      housework_type: 'rut', labor_cost_ore: labor, buyer_personnummer: pnr,
      lines: [{ description: 'Städ', quantity: 1, unit_price_ore: labor, vat_rate: 0 }],
    });
    // Först 12-siffrigt (färskt personnummer): RUT 50 % av 140 000 = 70 000 kr.
    const a = await mk('198203031234', 14_000_000);
    expect(a.body.invoice.housework_reduction_ore).toBe(7_000_000);
    // Sedan SAMMA person men 10-siffrigt → måste aggregera, bara 5 000 kr kvar.
    const b = await mk('8203031234', 14_000_000);
    expect(b.body.invoice.housework_reduction_ore).toBe(500_000); // taket kringgås inte
  });
});

describe('Valideringar', () => {
  const base = { customer_id: '', invoice_date: '2025-04-01', lines: [{ description: 'X', quantity: 1, unit_price_ore: 1_000_000, vat_rate: 25 }] };
  it('ROT kräver fastighetsbeteckning', async () => {
    const res = await api.post(`${co()}/invoices`).set(auth()).send({ ...base, customer_id: customerId, housework_type: 'rot', labor_cost_ore: 1_000_000, buyer_personnummer: '199001011234' });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain('missing_property_designation');
  });
  it('husavdrag kräver köparens personnummer', async () => {
    const res = await api.post(`${co()}/invoices`).set(auth()).send({ ...base, customer_id: customerId, housework_type: 'rut', labor_cost_ore: 1_000_000 });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain('invalid_buyer_personnummer');
  });
  it('arbetskostnaden får inte överstiga totalen', async () => {
    const res = await api.post(`${co()}/invoices`).set(auth()).send({ ...base, customer_id: customerId, housework_type: 'rut', labor_cost_ore: 9_999_999, buyer_personnummer: '199001011234' });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain('labor_cost_exceeds_total');
  });
  it('ROT/RUT kan inte kombineras med omvänd skattskyldighet', async () => {
    const b = await api.post(`${co()}/customers`).set(auth()).send({ name: 'Bygg', org_number: '5567778899' });
    const res = await api.post(`${co()}/invoices`).set(auth()).send({ customer_id: b.body.customer.id, invoice_date: '2025-04-01', reverse_charge: true, housework_type: 'rot', labor_cost_ore: 100000, buyer_personnummer: '199001011234', property_designation: 'A 1', lines: [{ description: 'X', quantity: 1, unit_price_ore: 1_000_000, vat_rate: 25 }] });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain('housework_and_reverse_charge');
  });
});

describe('ROT/RUT-vy', () => {
  it('fakturalistan märker ROT/RUT', async () => {
    const ua = supertest.agent(app);
    await ua.post('/app/login').type('form').send({ email: user.email, password: PASSWORD });
    const view = await ua.get(`/app/c/${companyId}/invoices`);
    expect(view.status).toBe(200);
    expect(view.text).toContain('ROT');
    // Förbehåll för det beräknade skattereduktionsunderlaget måste visas i vyn
    // (tidigare var HOUSEWORK_DISCLAIMER dead code).
    expect(view.text).toContain('ROT/RUT — beräknat underlag');
    expect(view.text).toContain('Skatteverkets beslut');
  });
});
