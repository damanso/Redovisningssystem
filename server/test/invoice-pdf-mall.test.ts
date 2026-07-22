// Fakturamallen: porterad 1:1 från Locollabs riktiga, skickade faktura
// (0000024, juni 2026) — INTE gamla systemets layout. Testet låser mallens
// kännetecken så layouten inte glider: Från/Fakturaadress-blocken, 7-siffrigt
// fakturanummer, Vår/Er referens, Leveranstidpunkt, "Betalas till", IBAN och
// BIC/Swift, "(N dagar)" på förfallodatum, timpris med enhetssuffix (SEK/h),
// momsrad per sats, sidfotens fyra kolumner samt logotypen (set_company_logo).
import supertest from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { app, api, createCompany, pdfText, registerUser, withAdmin, type TestUser } from './helpers.js';

const PASSWORD = 'mycket-hemligt-losen-123';
let user: TestUser;
let companyId: string;
let customerId: string;
const auth = () => ({ Authorization: `Bearer ${user.token}` });
const co = () => `/api/companies/${companyId}`;

// 1×1-PNG med giltiga magic bytes — räcker för att verifiera inbäddningen.
const TINY_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

const strip = (s: string) => s.replace(/[\s  ]/g, '');

async function pdfBuffer(invoiceId: string): Promise<Buffer> {
  const res = await api.post(`${co()}/invoices/${invoiceId}/pdf`).set(auth()).buffer()
    .parse((r, cb) => { const chunks: Buffer[] = []; r.on('data', (c: Buffer) => chunks.push(c)); r.on('end', () => cb(null, Buffer.concat(chunks))); });
  expect(res.status).toBe(200);
  return res.body as Buffer;
}

// Mallfakturans rader: 91 h à 1 100 kr + 1 st à 14 503 kr → 143 253,75 inkl. moms.
async function mallInvoice(): Promise<{ id: string; number: number }> {
  const inv = await api.post(`${co()}/actions/create_invoice`).set(auth()).send({
    customer_id: customerId, invoice_date: '2026-06-30', due_date: '2026-07-20',
    our_reference: 'David Mancilla', reference: 'Eva Larsson', delivery_period: 'Juni 2026',
    lines: [
      { description: 'Projektledare NVR projekt', quantity: 91, unit: 'h', unit_price_ore: 110_000, vat_rate: 25 },
      { description: 'Vidarefakturerade reseutlägg Dublin/London-resan (se bilaga)', quantity: 1, unit: 'st', unit_price_ore: 1_450_300, vat_rate: 25 },
    ],
  });
  expect(inv.status, JSON.stringify(inv.body)).toBe(200);
  return { id: inv.body.result.id, number: inv.body.result.invoice_number };
}

beforeAll(async () => {
  user = await registerUser('mall');
  companyId = await createCompany(user.token, 'Locollabs AB');
  await api.patch(`${co()}`).set(auth()).send({
    org_number: '5593481111', address: 'Forsbackagatan 55', postal_code: '123 43', city: 'Farsta',
    email: 'faktura@example.se', phone: '+46700000000', vat_number: 'SE559348111101',
    bankgiro: '5776-6446', iban: 'SE5950000000050041022297', bic: 'ESSESESSXXX',
    website: 'www.locollabs.se', approved_for_f_tax: true,
  });
  await api.post(`${co()}/accounting/fiscal-years`).set(auth()).send({ label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });
  const cust = await api.post(`${co()}/customers`).set(auth()).send({
    name: 'Nordic Vision Retail AB', address: 'Finlandsgatan 16', postal_code: '164 74', city: 'Kista',
  });
  customerId = cust.body.customer.id;
});

describe('fakturamallen (Locollabs riktiga mall)', () => {
  it('mallens kännetecken står på PDF:en: block, referenser, betalinfo och belopp', async () => {
    const inv = await mallInvoice();
    const text = pdfText(await pdfBuffer(inv.id));
    const flat = strip(text);

    // Från- och Fakturaadress-blocken.
    expect(text).toContain('Från');
    expect(text).toContain('Locollabs AB');
    expect(text).toContain('Fakturaadress');
    expect(text).toContain('Nordic Vision Retail AB');
    expect(text).toContain('Finlandsgatan 16');

    // Metadatakolumnen.
    expect(text).toContain('Fakturanummer');
    expect(text).toContain(String(inv.number).padStart(7, '0')); // 7 siffror som mallen
    expect(text).toContain('Förfallodatum');
    expect(text).toContain('(20 dagar)');
    expect(text).toContain('Leveranstidpunkt');
    expect(text).toContain('Juni 2026');
    expect(text).toContain('Betalas till');
    expect(text).toContain('Bankgiro 5776-6446');
    expect(text).toContain('Vår referens');
    expect(text).toContain('David Mancilla');
    expect(text).toContain('Er referens');
    expect(text).toContain('Eva Larsson');
    expect(text).toContain('IBAN');
    expect(text).toContain('SE5950000000050041022297');
    expect(text).toContain('BIC/Swift');

    // Radtabellen: timpris med enhetssuffix och svensk beloppsformatering.
    expect(text).toContain('Kvantitet');
    expect(flat).toContain('91h');
    expect(flat).toContain('1100,00SEK/h');
    expect(flat).toContain('100100,00SEK');
    expect(flat).toContain('14503,00SEK');

    // Summeringen: 114 603,00 + 28 650,75 = 143 253,75 (mallfakturans belopp).
    expect(text).toContain('Exklusive moms');
    expect(flat).toContain('114603,00SEK');
    expect(flat).toContain('Moms(25%)');
    expect(flat).toContain('28650,75SEK');
    expect(text).toContain('Att betala');
    expect(flat).toContain('143253,75SEK');

    // Sidfoten.
    expect(text).toContain('Moms reg. nr.');
    expect(text).toContain('SE559348111101');
    expect(text).toContain('Godkänd för F-skatt');
    expect(text).toContain('Telefon');
    expect(text).toContain('Hemsida');
    expect(text).toContain('www.locollabs.se');
  });

  it('utan logotyp: ingen bild i PDF:en', async () => {
    const inv = await mallInvoice();
    const raw = (await pdfBuffer(inv.id)).toString('latin1');
    expect(raw).not.toContain('/Subtype /Image');
  });

  it('set_company_logo: logotypen lagras, auditloggas och bäddas in på PDF:en', async () => {
    const set = await api.post(`${co()}/actions/set_company_logo`).set(auth()).send({
      filename: 'logga.png', content_base64: TINY_PNG,
    });
    expect(set.status, JSON.stringify(set.body)).toBe(200);
    const fileId = set.body.result.logo_file_id;

    const row = await withAdmin(async (admin) => (await admin.query(
      'SELECT logo_file_id FROM companies WHERE id = $1', [companyId])).rows[0]);
    expect(row.logo_file_id).toBe(fileId);
    const audit = await withAdmin(async (admin) => (await admin.query(
      "SELECT count(*)::int AS n FROM audit_log WHERE company_id = $1 AND action = 'company.logo_set'", [companyId])).rows[0]);
    expect(audit.n).toBe(1);

    const inv = await mallInvoice();
    const raw = (await pdfBuffer(inv.id)).toString('latin1');
    expect(raw).toContain('/Subtype /Image');
  });

  it('update_company_settings via action-lagret: uppgifterna slår igenom på PDF:en', async () => {
    const upd = await api.post(`${co()}/actions/update_company_settings`).set(auth()).send({
      website: 'www.locollabs.example', bic: 'NDEASESSXXX',
    });
    expect(upd.status, JSON.stringify(upd.body)).toBe(200);
    expect(upd.body.result.website).toBe('www.locollabs.example');

    const inv = await mallInvoice();
    const text = pdfText(await pdfBuffer(inv.id));
    expect(text).toContain('www.locollabs.example');
    expect(text).toContain('NDEASESSXXX');

    // Återställ mallvärdena för efterföljande tester.
    await api.post(`${co()}/actions/update_company_settings`).set(auth()).send({
      website: 'www.locollabs.se', bic: 'ESSESESSXXX',
    });
  });

  it('en PDF avvisas som logotyp (bild krävs)', async () => {
    const res = await api.post(`${co()}/actions/set_company_logo`).set(auth()).send({
      filename: 'logga.pdf', content_base64: Buffer.from('%PDF-1.4 inte en bild').toString('base64'),
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('logo_must_be_image');
  });

  it('Generera om PDF i vyn: ny fil arkiveras med senaste mallen, gamla filen finns kvar', async () => {
    const inv = await mallInvoice();
    await pdfBuffer(inv.id); // första generering → pdf_file_id sätts
    const before = await withAdmin(async (admin) => (await admin.query(
      'SELECT count(*)::int AS n FROM files WHERE company_id = $1', [companyId])).rows[0]);

    const ua = supertest.agent(app);
    await ua.post('/app/login').type('form').send({ email: user.email, password: PASSWORD });
    const res = await ua.post(`/app/c/${companyId}/invoices/${inv.id}/pdf/regenerate`).send({});
    expect([302, 303]).toContain(res.status);
    expect(res.headers.location).toContain('pdfny=1');
    const page = await ua.get(res.headers.location!);
    expect(page.text).toContain('omgenererad');

    const after = await withAdmin(async (admin) => (await admin.query(
      'SELECT count(*)::int AS n FROM files WHERE company_id = $1', [companyId])).rows[0]);
    expect(after.n).toBe(before.n + 1); // NY fil — gamla raderas inte
  });
});
