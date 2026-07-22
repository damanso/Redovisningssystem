// Acceptanstester för Fas 2 (KICKOFF §4): affärsobjekt bakom förtroendegränsen,
// standardlistning visar aktiva, PDF med Bankgiro, ladda upp → hämta fil.
import { beforeAll, describe, expect, it } from 'vitest';
import { api, createCompany, pdfText, registerUser, type TestUser } from './helpers.js';

let user: TestUser;
let other: TestUser;
let companyId: string;
let fiscalYearId: string;
const auth = () => ({ Authorization: `Bearer ${user.token}` });
const otherAuth = () => ({ Authorization: `Bearer ${other.token}` });
const co = () => `/api/companies/${companyId}`;

beforeAll(async () => {
  user = await registerUser('agare');
  other = await registerUser('utomstaende');
  companyId = await createCompany(user.token, 'Handel AB');
  // Fyll i bolagets betaluppgifter (för faktura-PDF).
  await api.patch(co()).set(auth()).send({
    org_number: '5566778899', address: 'Storgatan 1', postal_code: '11122', city: 'Stockholm',
    bankgiro: '5555-6666', bank_account: '1234-5678', email: 'faktura@handel.se',
  });
  const fy = await api
    .post(`${co()}/accounting/fiscal-years`)
    .set(auth())
    .send({ label: '2025', start_date: '2025-01-01', end_date: '2025-12-31' });
  fiscalYearId = fy.body.fiscal_year.id;
});

describe('standardlistning visar AKTIVA poster (regression mot gamla is_active-buggen)', () => {
  it('kunder: default listar aktiva; inaktiverad kund göms', async () => {
    const a = await api.post(`${co()}/customers`).set(auth()).send({ name: 'Aktiv Kund AB' });
    const b = await api.post(`${co()}/customers`).set(auth()).send({ name: 'Inaktiv Kund AB' });
    expect(a.status).toBe(201);
    await api.patch(`${co()}/customers/${b.body.customer.id}`).set(auth()).send({ is_active: false });

    const list = await api.get(`${co()}/customers`).set(auth());
    expect(list.status).toBe(200);
    const names = list.body.customers.map((c: { name: string }) => c.name);
    expect(names).toContain('Aktiv Kund AB');
    expect(names).not.toContain('Inaktiv Kund AB'); // exakt den gamla buggen

    const all = await api.get(`${co()}/customers?include_inactive=true`).set(auth());
    expect(all.body.customers.map((c: { name: string }) => c.name)).toContain('Inaktiv Kund AB');
  });

  it('artiklar och leverantörer: samma default-aktiv-beteende', async () => {
    await api.post(`${co()}/articles`).set(auth()).send({ article_number: 'A1', name: 'Aktiv artikel', unit_price_ore: 10000, vat_rate: 25 });
    const inactive = await api.post(`${co()}/articles`).set(auth()).send({ article_number: 'A2', name: 'Inaktiv artikel', unit_price_ore: 5000, vat_rate: 25 });
    await api.patch(`${co()}/articles/${inactive.body.article.id}`).set(auth()).send({ is_active: false });
    const list = await api.get(`${co()}/articles`).set(auth());
    const numbers = list.body.articles.map((a: { article_number: string }) => a.article_number);
    expect(numbers).toContain('A1');
    expect(numbers).not.toContain('A2');
  });
});

describe('tenant-isolering på affärsobjekt', () => {
  it('utomstående får 404 på kunder/fakturor/kvitton', async () => {
    for (const path of ['customers', 'suppliers', 'articles', 'invoices', 'receipts']) {
      const res = await api.get(`${co()}/${path}`).set(otherAuth());
      expect(res.status, path).toBe(404);
    }
  });
});

describe('faktura: nummer/OCR, totaler i ören, bokföring, PDF med Bankgiro', () => {
  let customerId: string;
  let invoiceId: string;

  beforeAll(async () => {
    const c = await api.post(`${co()}/customers`).set(auth()).send({
      name: 'Fakturakund AB', address: 'Kundgatan 2', postal_code: '22233', city: 'Göteborg', payment_terms: 30,
    });
    customerId = c.body.customer.id;
  });

  it('skapar faktura med korrekta totaler i ören + OCR', async () => {
    const res = await api.post(`${co()}/invoices`).set(auth()).send({
      customer_id: customerId,
      invoice_date: '2025-03-01',
      lines: [
        { description: 'Konsulttimmar', quantity: 10, unit: 'tim', unit_price_ore: 100000, vat_rate: 25 },
        { description: 'Material', quantity: 2, unit: 'st', unit_price_ore: 25000, vat_rate: 25 },
      ],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const inv = res.body.invoice;
    invoiceId = inv.id;
    // 10*1000 + 2*250 = 10500 kr netto = 1 050 000 ören; moms 25% = 262 500; totalt 1 312 500.
    expect(inv.subtotal_ore).toBe(1_050_000);
    expect(inv.vat_ore).toBe(262_500);
    expect(inv.total_ore).toBe(1_312_500);
    expect(inv.ocr).toMatch(/^\d+$/);
    expect(inv.due_date).toBe('2025-03-31'); // +30 dagar
  });

  it('bokför fakturan → verifikat i huvudboken; dubbelbokning nekas', async () => {
    const book = await api.post(`${co()}/invoices/${invoiceId}/book`).set(auth()).send({ fiscal_year_id: fiscalYearId });
    expect(book.status, JSON.stringify(book.body)).toBe(200);
    expect(book.body.invoice.voucher_id).toBeTruthy();
    expect(book.body.invoice.status).toBe('sent');

    const again = await api.post(`${co()}/invoices/${invoiceId}/book`).set(auth()).send({ fiscal_year_id: fiscalYearId });
    expect(again.status).toBe(409);
    expect(again.body.error).toBe('already_booked');
  });

  it('registrerar betalning via action-lagret (känsligt → godkännande) → faktura betald', async () => {
    // Automatkontering för "betalning" (KICKOFF §4 Fas 1.4), exponerad som en
    // känslig action. Människa begär → hamnar i godkännandekö (bokförs inte
    // automatiskt) → en människa godkänner → betalningen konteras och fakturan
    // markeras betald.
    const req = await api.post(`${co()}/actions/register_invoice_payment`).set(auth())
      .send({ invoice_id: invoiceId, fiscal_year_id: fiscalYearId, payment_date: '2025-04-01' });
    expect(req.status, JSON.stringify(req.body)).toBe(202); // känslig → pending
    const approvalId = req.body.approval.id;

    const notPaidYet = await api.get(`${co()}/invoices`).set(auth());
    expect(notPaidYet.body.invoices.find((i: { id: string }) => i.id === invoiceId).status).not.toBe('paid');

    const approve = await api.post(`${co()}/approvals/${approvalId}/approve`).set(auth()).send({});
    expect(approve.status, JSON.stringify(approve.body)).toBe(200);

    const after = await api.get(`${co()}/invoices`).set(auth());
    expect(after.body.invoices.find((i: { id: string }) => i.id === invoiceId).status).toBe('paid');
  });

  it('genererar PDF som innehåller Bankgiro och OCR', async () => {
    const res = await api
      .post(`${co()}/invoices/${invoiceId}/pdf`)
      .set(auth())
      .buffer()
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    const buf = res.body as Buffer;
    expect(buf.toString('latin1').startsWith('%PDF-')).toBe(true);
    const text = pdfText(buf);
    expect(text).toContain('5555-6666'); // Bankgiro syns på PDF:en
    // Mallen (porterad från Locollabs riktiga faktura) skriver betalmålet som
    // "Betalas till: Bankgiro …" i metadatakolumnen — inte ett eget block.
    expect(text).toContain('Betalas till');
    expect(text).toContain('Handel AB');
  });
});

describe('kvitto: bokföring + filbilaga (ladda upp → hämta)', () => {
  let receiptId: string;

  it('skapar kvitto och bokför det', async () => {
    const create = await api.post(`${co()}/receipts`).set(auth()).send({
      receipt_date: '2025-03-05', description: 'Lunch med kund', net_ore: 40000, vat_rate: 12,
      expense_account: 6071, payment_account: 1930,
    });
    expect(create.status, JSON.stringify(create.body)).toBe(201);
    receiptId = create.body.receipt.id;
    expect(create.body.receipt.vat_ore).toBe(4800); // 12% av 400 kr
    expect(create.body.receipt.total_ore).toBe(44800);

    const book = await api.post(`${co()}/receipts/${receiptId}/book`).set(auth()).send({ fiscal_year_id: fiscalYearId });
    expect(book.status, JSON.stringify(book.body)).toBe(200);
    expect(book.body.receipt.status).toBe('booked');
    expect(book.body.receipt.voucher_id).toBeTruthy();
  });

  it('bifogar en fil och kan hämta den via auth-skyddad endpoint', async () => {
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('kvittobild')]);
    const attach = await api
      .post(`${co()}/receipts/${receiptId}/file`)
      .set(auth())
      .attach('file', png, 'kvitto.png');
    expect(attach.status, JSON.stringify(attach.body)).toBe(201);
    const fileId = attach.body.receipt.file_id;
    expect(fileId).toBeTruthy();

    const download = await api
      .get(`${co()}/files/${fileId}`)
      .set(auth())
      .buffer()
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(download.status).toBe(200);
    expect(Buffer.compare(download.body as Buffer, png)).toBe(0);

    // Utomstående kommer inte åt filen.
    const forbidden = await api.get(`${co()}/files/${fileId}`).set(otherAuth());
    expect(forbidden.status).toBe(404);
  });
});
