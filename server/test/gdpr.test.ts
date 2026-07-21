// Fas E1: GDPR — radering/anonymisering av personuppgifter på en part.
// Rätten till radering (art. 17) vägs mot bokföringslagens bevarandekrav:
//   - CRM-personuppgifter (kontaktpersoner, anteckningar) tas ALLTID bort.
//   - Kontaktuppgifter (e-post, telefon, adress) nollas alltid.
//   - Identiteten (namn, org.nr) raderas bara om parten SAKNAR bokförda transaktioner;
//     annars behålls den (bokföringslagen) och det redovisas i svaret.
// Åtgärden är känslig → människa-i-loopen (begär 202 → godkänn).
import supertest from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { app, api, createCompany, registerUser, withAdmin, type TestUser } from './helpers.js';

const PASSWORD = 'mycket-hemligt-losen-123';

let user: TestUser;
let companyId: string;
let fiscalYearId: string;
const auth = () => ({ Authorization: `Bearer ${user.token}` });
const co = () => `/api/companies/${companyId}`;
const act = (name: string, body: object) => api.post(`${co()}/actions/${name}`).set(auth()).send(body);

// Känslig åtgärd: begär (202 pending) → godkänn. Returnerar approve-svaret ({ approval, result }).
async function anonymize(partyType: 'customer' | 'supplier', partyId: string) {
  const req = await act('anonymize_party', { party_type: partyType, party_id: partyId });
  expect(req.status, JSON.stringify(req.body)).toBe(202);
  return api.post(`${co()}/approvals/${req.body.approval.id}/approve`).set(auth()).send({});
}

async function customerRow(id: string) {
  return withAdmin(async (c) => (await c.query('SELECT name, org_number, vat_number, email, phone, address, tags, is_active FROM customers WHERE id = $1', [id])).rows[0]);
}
async function fileCount(): Promise<number> {
  return withAdmin(async (c) => Number((await c.query('SELECT count(*) FROM files')).rows[0].count));
}
async function countRows(table: string, partyType: string, partyId: string): Promise<number> {
  return withAdmin(async (c) => Number((await c.query(`SELECT count(*) FROM ${table} WHERE company_id = $1 AND party_type = $2 AND party_id = $3`, [companyId, partyType, partyId])).rows[0].count));
}

beforeAll(async () => {
  user = await registerUser('gdpr');
  companyId = await createCompany(user.token, 'GDPR AB');
  const fy = await api.post(`${co()}/accounting/fiscal-years`).set(auth()).send({ label: '2025', start_date: '2025-01-01', end_date: '2025-12-31' });
  fiscalYearId = fy.body.fiscal_year.id;
});

describe('GDPR-anonymisering är känslig (människa-i-loopen)', () => {
  it('en agent kan begära men aldrig direkt köra anonymiseringen', async () => {
    const c = await api.post(`${co()}/customers`).set(auth()).send({ name: 'Direkt', org_number: '5560001111' });
    const req = await act('anonymize_party', { party_type: 'customer', party_id: c.body.customer.id });
    expect(req.status).toBe(202); // hamnar i godkännandekön, körs inte direkt
    expect(req.body.status).toBe('pending_approval');
  });
});

describe('Part UTAN bokförda transaktioner — full anonymisering', () => {
  it('namn/org.nr/vat-nr anonymiseras, taggar rensas, PDF + återkommande rensas', async () => {
    const c = await api.post(`${co()}/customers`).set(auth()).send({ name: 'Privatkund Anna', org_number: '5560002222', vat_number: 'SE556000222201', email: 'anna@example.se', phone: '070-1234567', address: 'Gatan 1', payment_terms: 30 });
    const id = c.body.customer.id;
    await act('add_contact', { party_type: 'customer', party_id: id, name: 'Anna Privat', email: 'anna@example.se' });
    await act('add_note', { party_type: 'customer', party_id: id, body: 'Känslig anteckning' });
    await act('set_tags', { party_type: 'customer', party_id: id, tags: ['Anna Svensson privat', 'VIP'] });
    // OBOKFÖRD faktura + genererad PDF (bär namn/adress → ska rensas).
    const inv = await api.post(`${co()}/invoices`).set(auth()).send({ customer_id: id, invoice_date: '2025-05-01', lines: [{ description: 'X', quantity: 1, unit_price_ore: 100000, vat_rate: 25 }] });
    const pdf = await api.post(`${co()}/invoices/${inv.body.invoice.id}/pdf`).set(auth()).send({});
    expect(pdf.status, JSON.stringify(pdf.body)).toBe(200);
    // Aktiv återkommande faktura → ska stängas av.
    await act('create_recurring_invoice', { customer_id: id, title: 'Anna Svensson – städning', interval: 'monthly', next_run_date: '2025-06-01', lines: [{ description: 'Städ', quantity: 1, unit_price_ore: 200000, vat_rate: 25 }] });
    expect(await countRows('party_contacts', 'customer', id)).toBe(1);
    const filesBefore = await fileCount();

    const res = await anonymize('customer', id);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.result.accounting_identity_retained).toBe(false);
    expect(res.body.result.contacts_removed).toBe(1);
    expect(res.body.result.notes_removed).toBe(1);
    expect(res.body.result.pdfs_removed).toBe(1);
    expect(res.body.result.recurring_deactivated).toBe(1);

    const row = await customerRow(id);
    expect(row.name).toBe('Raderad (GDPR)');
    expect(row.org_number).toBeNull();
    expect(row.vat_number).toBeNull();
    expect(row.email).toBeNull();
    expect(row.phone).toBeNull();
    expect(row.address).toBeNull();
    expect(row.tags).toEqual([]);
    expect(row.is_active).toBe(false);
    expect(await countRows('party_contacts', 'customer', id)).toBe(0);
    expect(await countRows('party_notes', 'customer', id)).toBe(0);
    expect(await fileCount()).toBe(filesBefore - 1); // PDF-filraden borttagen
    const rec = await withAdmin(async (cl) => (await cl.query('SELECT active, title FROM recurring_invoices WHERE customer_id = $1', [id])).rows[0]);
    expect(rec.active).toBe(false);
    expect(rec.title).toBe('Raderad (GDPR)'); // fritext som bar kundens namn rensad
  });
});

describe('Part MED bokförda transaktioner — identitet behålls (bokföringslagen)', () => {
  it('kontaktuppgifter nollas och kontakter raderas, men namn/org.nr behålls', async () => {
    const c = await api.post(`${co()}/customers`).set(auth()).send({ name: 'Storkund AB', org_number: '5560003333', vat_number: 'SE556000333301', email: 'kontakt@storkund.se', payment_terms: 0 });
    const id = c.body.customer.id;
    // Bokför en faktura → parten har en bokförd affärshändelse.
    const inv = await api.post(`${co()}/invoices`).set(auth()).send({ customer_id: id, invoice_date: '2025-03-01', lines: [{ description: 'Tjänst', quantity: 1, unit_price_ore: 100000, vat_rate: 25 }] });
    await api.post(`${co()}/invoices/${inv.body.invoice.id}/book`).set(auth()).send({ fiscal_year_id: fiscalYearId });
    const pdf = await api.post(`${co()}/invoices/${inv.body.invoice.id}/pdf`).set(auth()).send({}); // bokförd fakturas PDF = räkenskapsinformation
    expect(pdf.status).toBe(200);
    await act('set_tags', { party_type: 'customer', party_id: id, tags: ['storkund', 'VIP'] });
    await act('add_contact', { party_type: 'customer', party_id: id, name: 'Bertil Boss', email: 'bertil@storkund.se' });
    const filesBefore = await fileCount();

    const res = await anonymize('customer', id);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.result.accounting_identity_retained).toBe(true);
    expect(res.body.result.contacts_removed).toBe(1);
    expect(res.body.result.pdfs_removed).toBe(0); // bokförd fakturas PDF behålls
    expect(res.body.result.disclaimer).toContain('bokföringslagen');

    const row = await customerRow(id);
    expect(row.name).toBe('Storkund AB');      // identiteten behålls
    expect(row.org_number).toBe('5560003333'); // för att verifikatets motpart ska kunna identifieras
    expect(row.vat_number).toBe('SE556000333301'); // vat-nr behålls — periodisk sammanställning läser det live
    expect(row.email).toBeNull();              // men kontaktuppgifterna nollas
    expect(row.tags).toEqual([]);              // taggar rensas
    expect(row.is_active).toBe(false);
    expect(await countRows('party_contacts', 'customer', id)).toBe(0);
    expect(await fileCount()).toBe(filesBefore); // bokförd fakturas PDF finns kvar
  });
});

describe('Leverantör och felfall', () => {
  it('leverantör utan bokförda transaktioner anonymiseras', async () => {
    const s = await api.post(`${co()}/suppliers`).set(auth()).send({ name: 'Konsult Kalle', org_number: '5560004444', email: 'kalle@k.se', bankgiro: '123-4567' });
    const id = s.body.supplier.id;
    const res = await anonymize('supplier', id);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.result.accounting_identity_retained).toBe(false);
    const row = await withAdmin(async (cl) => (await cl.query('SELECT name, org_number, email, bankgiro, is_active FROM suppliers WHERE id = $1', [id])).rows[0]);
    expect(row.name).toBe('Raderad (GDPR)');
    expect(row.org_number).toBeNull();
    expect(row.email).toBeNull();
    expect(row.bankgiro).toBeNull();
  });

  it('leverantör med enbart bokfört KVITTO behåller identiteten (grindfynd E1)', async () => {
    // Ett bokfört kvitto (receipts.supplier_id) är ett verifikat lika mycket som en
    // leverantörsfaktura — identiteten måste bevaras även om ingen lev.faktura finns.
    const s = await api.post(`${co()}/suppliers`).set(auth()).send({ name: 'Kvitto Leverantör', org_number: '5560006666' });
    const id = s.body.supplier.id;
    const create = await api.post(`${co()}/receipts`).set(auth()).send({ supplier_id: id, receipt_date: '2025-04-10', description: 'Material', net_ore: 20000, vat_rate: 25, expense_account: 6071, payment_account: 1930 });
    expect(create.status, JSON.stringify(create.body)).toBe(201);
    await api.post(`${co()}/receipts/${create.body.receipt.id}/book`).set(auth()).send({ fiscal_year_id: fiscalYearId });

    const res = await anonymize('supplier', id);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.result.accounting_identity_retained).toBe(true);
    const row = await withAdmin(async (cl) => (await cl.query('SELECT name, org_number FROM suppliers WHERE id = $1', [id])).rows[0]);
    expect(row.name).toBe('Kvitto Leverantör');
    expect(row.org_number).toBe('5560006666');
  });

  it('okänt part-id ger 404 vid godkännande', async () => {
    const req = await act('anonymize_party', { party_type: 'customer', party_id: '00000000-0000-0000-0000-000000000000' });
    expect(req.status).toBe(202); // begäran skapas
    const res = await api.post(`${co()}/approvals/${req.body.approval.id}/approve`).set(auth()).send({});
    expect(res.status).toBe(404); // men körningen misslyckas — parten finns inte
  });
});

describe('GDPR-vy (webb)', () => {
  it('kunddetaljvyn erbjuder anonymisering och POST lägger den i godkännandekön', async () => {
    const c = await api.post(`${co()}/customers`).set(auth()).send({ name: 'Vy Kund', org_number: '5560005555' });
    const id = c.body.customer.id;
    const ua = supertest.agent(app);
    await ua.post('/app/login').type('form').send({ email: user.email, password: PASSWORD });
    const detail = await ua.get(`/app/c/${companyId}/customers/${id}`);
    expect(detail.status).toBe(200);
    expect(detail.text).toContain('Dataskydd (GDPR)');
    expect(detail.text).toContain('Begär anonymisering');

    const post = await ua.post(`/app/c/${companyId}/customers/${id}/gdpr-anonymize`).type('form').send({});
    expect(post.status).toBe(303);
    expect(post.headers.location).toContain('/approvals');
    // Ligger som pending i kön — inte utförd förrän en människa godkänner.
    const before = await customerRow(id);
    expect(before.name).toBe('Vy Kund');
  });
});
