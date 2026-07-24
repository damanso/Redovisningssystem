// Fas E2: F-skatt (företagsinställning + faktura-PDF-text) + omvänd skattskyldighet
// (byggmoms) på utgående fakturor: ingen moms debiteras, intäkt på 3231, lagstadgad
// text på PDF:en och flöde till momsdeklarationens ruta 41. Beräknat underlag.
import supertest from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { app, api, createCompany, createFiscalYear, pdfText, registerUser, type TestUser } from './helpers.js';

const PASSWORD = 'mycket-hemligt-losen-123';

let user: TestUser;
let companyId: string;
let fiscalYearId: string;
let buyerId: string;      // kund med org.nr (kan ta emot omvänd skattskyldighet)
let privateId: string;    // kund utan org.nr/vat-nr
const auth = () => ({ Authorization: `Bearer ${user.token}` });
const co = () => `/api/companies/${companyId}`;

async function pdfBuffer(invoiceId: string): Promise<Buffer> {
  const res = await api.post(`${co()}/invoices/${invoiceId}/pdf`).set(auth()).buffer()
    .parse((r, cb) => { const chunks: Buffer[] = []; r.on('data', (c: Buffer) => chunks.push(c)); r.on('end', () => cb(null, Buffer.concat(chunks))); });
  expect(res.status).toBe(200);
  return res.body as Buffer;
}

beforeAll(async () => {
  user = await registerUser('ftax');
  companyId = await createCompany(user.token, 'Bygg & Co AB');
  await api.patch(`${co()}`).set(auth()).send({ org_number: '5560123456', bankgiro: '1234-5678' });
  const fy = await createFiscalYear(companyId, auth(), { label: '2025', start_date: '2025-01-01', end_date: '2025-12-31' });
  fiscalYearId = fy.id;
  const b = await api.post(`${co()}/customers`).set(auth()).send({ name: 'Underentreprenör AB', org_number: '5569998888', vat_number: 'SE556999888801', payment_terms: 30 });
  buyerId = b.body.customer.id;
  const p = await api.post(`${co()}/customers`).set(auth()).send({ name: 'Privatperson', payment_terms: 30 });
  privateId = p.body.customer.id;
});

describe('F-skatt', () => {
  it('texten "Godkänd för F-skatt" står på PDF:en först när bolaget är godkänt', async () => {
    const inv = await api.post(`${co()}/invoices`).set(auth()).send({ customer_id: buyerId, invoice_date: '2025-02-01', lines: [{ description: 'Konsulttimmar', quantity: 10, unit_price_ore: 100000, vat_rate: 25 }] });
    const before = pdfText(await pdfBuffer(inv.body.invoice.id));
    expect(before).not.toContain('Godkänd för F-skatt');

    const patch = await api.patch(`${co()}`).set(auth()).send({ approved_for_f_tax: true });
    expect(patch.status, JSON.stringify(patch.body)).toBe(200);
    const after = pdfText(await pdfBuffer(inv.body.invoice.id));
    expect(after).toContain('Godkänd för F-skatt');
  });

  it('inställningen kan läsas tillbaka via GET (inte write-only)', async () => {
    const get = await api.get(`${co()}`).set(auth());
    expect(get.status).toBe(200);
    expect(get.body.company.approved_for_f_tax).toBe(true);
  });
});

describe('Omvänd skattskyldighet (byggmoms)', () => {
  it('fakturan ställs ut utan moms, intäkt på 3231, rätt text på PDF, flödar till ruta 41', async () => {
    const inv = await api.post(`${co()}/invoices`).set(auth()).send({
      customer_id: buyerId, invoice_date: '2025-03-10', reverse_charge: true,
      lines: [{ description: 'Byggtjänst underentreprenad', quantity: 1, unit_price_ore: 5000000, vat_rate: 25 }],
    });
    expect(inv.status, JSON.stringify(inv.body)).toBe(201);
    const invoice = inv.body.invoice;
    expect(invoice.reverse_charge).toBe(true);
    expect(invoice.vat_ore).toBe(0);                 // ingen moms debiteras
    expect(invoice.subtotal_ore).toBe(5000000);
    expect(invoice.total_ore).toBe(5000000);         // total = netto (ingen moms)
    expect(invoice.lines[0].vat_rate).toBe(0);       // momssats tvingas till 0
    expect(invoice.lines[0].revenue_account).toBe(3231); // omvänd skattskyldighet-konto

    // Bokför → intäkt på 3231, ingen utgående moms.
    const book = await api.post(`${co()}/invoices/${invoice.id}/book`).set(auth()).send({ fiscal_year_id: fiscalYearId });
    expect(book.status, JSON.stringify(book.body)).toBe(200);

    // Momsdeklaration: ruta 41 = 50 000 kr (5 000 000 ören), utgående moms 0.
    const vat = await api.post(`${co()}/actions/vat_declaration`).set(auth()).send({ from: '2025-01-01', to: '2025-12-31' });
    expect(vat.status, JSON.stringify(vat.body)).toBe(200);
    const box41 = vat.body.result.exempt_sales.find((b: { code: string }) => b.code === '41');
    expect(box41.amount_ore).toBe(5000000);
    const box10 = vat.body.result.output_vat.find((b: { code: string }) => b.code === '10');
    expect(box10.amount_ore).toBe(0); // ingen utgående moms 25 %

    // PDF: lagstadgad hänvisning + köparens identitet.
    const text = pdfText(await pdfBuffer(invoice.id));
    expect(text).toContain('Omvänd betalningsskyldighet');
    expect(text).toContain('5569998888'); // köparens org.nr
  });

  it('tvingar intäkt till 3231 även när raden kommer från en artikel med vanligt konto (grindfynd E2)', async () => {
    // Artikel med normalt intäktskonto (3001). Vid omvänd skattskyldighet MÅSTE
    // intäkten ändå bokföras på 3231, annars försvinner försäljningen ur ruta 41.
    const art = await api.post(`${co()}/articles`).set(auth()).send({ article_number: 'BYGG-1', name: 'Byggtjänst', unit_price_ore: 300000, vat_rate: 25, revenue_account: 3001 });
    expect(art.status, JSON.stringify(art.body)).toBe(201);
    const inv = await api.post(`${co()}/invoices`).set(auth()).send({
      customer_id: buyerId, invoice_date: '2025-05-10', reverse_charge: true,
      lines: [{ article_id: art.body.article.id, quantity: 2 }],
    });
    expect(inv.status, JSON.stringify(inv.body)).toBe(201);
    expect(inv.body.invoice.lines[0].revenue_account).toBe(3231); // tvingat, inte 3001
    expect(inv.body.invoice.lines[0].vat_rate).toBe(0);
    expect(inv.body.invoice.vat_ore).toBe(0);
    await api.post(`${co()}/invoices/${inv.body.invoice.id}/book`).set(auth()).send({ fiscal_year_id: fiscalYearId });
    const vat = await api.post(`${co()}/actions/vat_declaration`).set(auth()).send({ from: '2025-01-01', to: '2025-12-31' });
    const box41 = vat.body.result.exempt_sales.find((b: { code: string }) => b.code === '41');
    expect(box41.amount_ore).toBe(5000000 + 600000); // tidigare 50 000 + nu 6 000 kr
  });

  it('omvänd skattskyldighet kräver att köparen har org.nr eller vat-nr', async () => {
    const inv = await api.post(`${co()}/invoices`).set(auth()).send({
      customer_id: privateId, invoice_date: '2025-04-01', reverse_charge: true,
      lines: [{ description: 'Tjänst', quantity: 1, unit_price_ore: 100000, vat_rate: 25 }],
    });
    expect(inv.status).toBe(400);
    expect(JSON.stringify(inv.body)).toContain('reverse_charge_requires_buyer_id');
  });

  it('ruta 41 räknas inte samtidigt som export (ruta 36)', async () => {
    const vat = await api.post(`${co()}/actions/vat_declaration`).set(auth()).send({ from: '2025-01-01', to: '2025-12-31' });
    const box36 = vat.body.result.exempt_sales.find((b: { code: string }) => b.code === '36');
    expect(box36.amount_ore).toBe(0); // 3231 hamnar inte i export-rutan
  });

  it('fakturalistan i vyn märker omvänd skattskyldighet', async () => {
    const ua = supertest.agent(app);
    await ua.post('/app/login').type('form').send({ email: user.email, password: PASSWORD });
    const view = await ua.get(`/app/c/${companyId}/invoices`);
    expect(view.status).toBe(200);
    expect(view.text).toContain('Omvänd moms');
  });
});
