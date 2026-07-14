// Fas C7: iXBRL-generering för K2-årsredovisning (Bolagsverket). Ett XHTML-dokument
// med XBRL-fakta taggade inline (se-gen-base:* för poster, se-cd-base:* för
// företagsinfo). Beräknat underlag; ingen digital inlämning.
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

beforeAll(async () => {
  user = await registerUser('ixbrl');
  companyId = await createCompany(user.token, 'iXBRL AB');
  const fy = await api.post(`${co()}/accounting/fiscal-years`).set(auth()).send({ label: '2025', start_date: '2025-01-01', end_date: '2025-12-31' });
  fiscalYearId = fy.body.fiscal_year.id;
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
  await approveAction('book_periodiseringsfond', { fiscal_year_id: fiscalYearId, type: 'avsattning', amount_ore: 20000_00 });
  await approveAction('book_corporate_tax', { fiscal_year_id: fiscalYearId, amount_ore: 12360_00 });
});

async function ixbrl(): Promise<{ doc: string; balanced: boolean; label: string }> {
  const res = await api.post(`${co()}/actions/generate_k2_ixbrl`).set(auth()).send({ fiscal_year_id: fiscalYearId });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return { doc: res.body.result.ixbrl, balanced: res.body.result.balanced, label: res.body.result.fiscal_year.label };
}

describe('iXBRL-dokumentstruktur', () => {
  it('har schemaRef, kontext, SEK-enhet och företagsinfo', async () => {
    const { doc } = await ixbrl();
    expect(doc.startsWith('<?xml')).toBe(true);
    expect(doc).toContain('xmlns:ix="http://www.xbrl.org/2013/inlineXBRL"');
    expect(doc).toContain('se-k2-risbs-2021-10-31.xsd');
    expect(doc).toContain('<xbrli:context id="period">');
    expect(doc).toContain('<xbrli:context id="balans">');
    expect(doc).toContain('<xbrli:measure>iso4217:SEK</xbrli:measure>');
    expect(doc).toContain('scheme="http://www.bolagsverket.se"');
    expect(doc).toContain('se-cd-base:ForetagetsNamn');
    expect(doc).toContain('se-cd-base:RakenskapsarSistaDag');
  });

  it('taggar resultat- och balansposter med rätt koncept och belopp', async () => {
    const { doc, balanced } = await ixbrl();
    expect(balanced).toBe(true);
    // Nettoomsättning 100 000.
    expect(doc).toMatch(/<ix:nonFraction name="se-gen-base:Nettoomsattning"[^>]*>100 000<\/ix:nonFraction>/);
    // Årets resultat 47 640 (100 000 − 20 000 − 20 000 PF − 12 360 skatt).
    expect(doc).toMatch(/<ix:nonFraction name="se-gen-base:AretsResultat"[^>]*>47 640<\/ix:nonFraction>/);
    // Summa tillgångar och summa eget kapital och skulder finns.
    expect(doc).toContain('se-gen-base:Tillgangar');
    expect(doc).toContain('se-gen-base:EgetKapitalSkulder');
  });

  it('negativa belopp bär sign="-" och absolutbelopp', async () => {
    const { doc } = await ixbrl();
    // Skatt på årets resultat är en kostnad (negativt i K2) → sign="-" och 12 360.
    expect(doc).toMatch(/<ix:nonFraction name="se-gen-base:SkattAretsResultat"[^>]*sign="-"[^>]*>12 360<\/ix:nonFraction>/);
  });
});

describe('iXBRL-nedladdning', () => {
  it('vyn erbjuder nedladdning och rutten svarar med xhtml', async () => {
    const ua = supertest.agent(app);
    await ua.post('/app/login').type('form').send({ email: user.email, password: PASSWORD });
    const view = await ua.get(`/app/c/${companyId}/annual?fy=${fiscalYearId}`);
    expect(view.text).toContain('Ladda ner iXBRL');
    const file = await ua.get(`/app/c/${companyId}/annual/arsredovisning.xhtml?fy=${fiscalYearId}`);
    expect(file.status).toBe(200);
    expect(file.headers['content-type']).toContain('application/xhtml+xml');
    expect(file.headers['content-disposition']).toContain('arsredovisning-2025.xhtml');
    expect(file.text).toContain('se-gen-base:Nettoomsattning');
  });
});
