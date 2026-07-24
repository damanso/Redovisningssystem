// Fakturadetalj i vyn: öppna ett utkast i sin helhet, ladda ner PDF:en (för
// mail till kund) och radera ett obokat utkast — det som saknades när bara en
// rad syntes i listan. Bokfört kan aldrig raderas (rättelseverifikat gäller).
import supertest from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { app, api, createCompany, createFiscalYear, pdfText, registerUser, withAdmin, type TestUser } from './helpers.js';

const PASSWORD = 'mycket-hemligt-losen-123';
let user: TestUser;
let companyId: string;
let fiscalYearId: string;
let customerId: string;
let ua: ReturnType<typeof supertest.agent>;
const auth = () => ({ Authorization: `Bearer ${user.token}` });
const co = () => `/api/companies/${companyId}`;

async function newDraft(): Promise<{ id: string; number: number }> {
  const inv = await api.post(`${co()}/actions/create_invoice`).set(auth()).send({
    customer_id: customerId, invoice_date: '2025-03-01', reference: 'Projekt X',
    lines: [
      { description: 'Konsulttjänst', quantity: 2, unit_price_ore: 1_500_000, vat_rate: 25 },
      { description: 'Resa', quantity: 1, unit_price_ore: 740_000, vat_rate: 25 },
    ],
  });
  expect(inv.status, JSON.stringify(inv.body)).toBe(200);
  return { id: inv.body.result.id, number: inv.body.result.invoice_number };
}

async function fileCount(): Promise<number> {
  return withAdmin(async (admin) =>
    (await admin.query('SELECT count(*)::int AS n FROM files WHERE company_id = $1', [companyId])).rows[0].n);
}

beforeAll(async () => {
  user = await registerUser('invdetail');
  companyId = await createCompany(user.token, 'Fakturadetalj AB');
  await api.patch(`${co()}`).set(auth()).send({ org_number: '5561234567', bankgiro: '123-4567' });
  const fy = await createFiscalYear(companyId, auth(), { label: '2025', start_date: '2025-01-01', end_date: '2025-12-31' });
  fiscalYearId = fy.id;
  const cust = await api.post(`${co()}/actions/create_customer`).set(auth()).send({ name: 'Nordic Vision Retail AB' });
  customerId = cust.body.result.id;
  ua = supertest.agent(app);
  await ua.post('/app/login').type('form').send({ email: user.email, password: PASSWORD });
});

describe('fakturadetaljsidan', () => {
  let draft: { id: string; number: number };

  it('utkastet kan öppnas: rader, totaler, OCR och åtgärdsknappar syns', async () => {
    draft = await newDraft();
    const page = await ua.get(`/app/c/${companyId}/invoices/${draft.id}`);
    expect(page.status).toBe(200);
    expect(page.text).toContain(`Faktura ${draft.number} — Nordic Vision Retail AB`);
    expect(page.text).toContain('Konsulttjänst');
    expect(page.text).toContain('Resa');
    expect(page.text).toContain('Projekt X');
    expect(page.text).toContain('OCR-nummer');
    expect(page.text).toContain('Ladda ner PDF');
    expect(page.text).toContain('Radera utkastet');
    expect(page.text).toContain('Bokför…');
    // 2×15 000 + 7 400 = 37 400 netto; +25 % = 46 750 totalt.
    expect(page.text.replace(/[\s  ]/g, '')).toContain('46750,00');
  });

  it('listan länkar till detaljsidan', async () => {
    const list = await ua.get(`/app/c/${companyId}/invoices`);
    expect(list.text).toContain(`/invoices/${draft.id}"`);
    expect(list.text).toContain('Öppna');
  });

  it('PDF:en kan laddas ner och innehåller fakturans uppgifter', async () => {
    const res = await ua.get(`/app/c/${companyId}/invoices/${draft.id}/pdf`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    expect(res.headers['content-disposition']).toContain(`Faktura-${draft.number}.pdf`);
    const text = pdfText(res.body as Buffer);
    expect(text).toContain('Nordic Vision Retail AB');
    expect(text).toContain('Konsulttjänst');
    expect(text.replace(/[\s  ]/g, '')).toContain('46750,00');
  });

  it('andra nedladdningen återanvänder arkivets PDF — ingen ny fil skapas', async () => {
    const before = await fileCount();
    const res = await ua.get(`/app/c/${companyId}/invoices/${draft.id}/pdf`);
    expect(res.status).toBe(200);
    expect(await fileCount()).toBe(before);
  });

  it('Radera utkastet tar bort fakturan och bekräftar i listan', async () => {
    const res = await ua.post(`/app/c/${companyId}/invoices/${draft.id}/delete`).send({});
    expect([302, 303]).toContain(res.status);
    expect(res.headers.location).toContain(`raderad=${draft.number}`);
    const list = await ua.get(res.headers.location!);
    expect(list.text).toContain(`Fakturautkast ${draft.number} raderat`);
    expect(list.text).not.toContain(`/invoices/${draft.id}"`);
  });

  it('bokförd faktura: ingen radera-knapp, och radering vägras med begripligt fel', async () => {
    const booked = await newDraft();
    const req = await api.post(`${co()}/actions/book_invoice`).set(auth()).send({ invoice_id: booked.id, fiscal_year_id: fiscalYearId });
    expect(req.status).toBe(202);
    const ok = await api.post(`${co()}/approvals/${req.body.approval.id}/approve`).set(auth()).send({});
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);

    const page = await ua.get(`/app/c/${companyId}/invoices/${booked.id}`);
    expect(page.text).not.toContain('Radera utkastet');
    expect(page.text).toContain('Registrera betalning…');

    const del = await ua.post(`/app/c/${companyId}/invoices/${booked.id}/delete`).send({});
    expect([302, 303]).toContain(del.status);
    expect(del.headers.location).toContain('fel=');
    const back = await ua.get(del.headers.location!);
    expect(back.text).toContain('rättelseverifikat');
  });
});
