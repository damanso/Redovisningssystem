// K3: generell dokumentkoppling + lönespec-PDF. attach_document (write) tar
// base64-innehåll och kopplar filen till en registerpost; list_documents/
// get_document (read) läser tillbaka; generate_payslip_pdf skapar lönespec-
// PDF:en enligt Locollabs mall och bilägger den på lönebeskedet. Samma
// filvalidering (ändelse + magic bytes) och tenant-gräns som all lagring.
import { createHash, randomBytes } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { api, createCompany, createFiscalYear, pdfText, registerUser, withAdmin, type TestUser } from './helpers.js';
import { config } from '../src/config.js';
import { isAttachDocumentRequest } from '../src/http/routes/actions.js';
import {
  ATTACH_DOCUMENT_BODY_LIMIT_BYTES, DOCUMENT_JSON_ENVELOPE_MARGIN_BYTES, MAX_DOCUMENT_BASE64_CHARS, MAX_DOCUMENT_BYTES,
} from '../src/services/documents.js';

const PNG_1PX = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c626001000000ffff03000006000557bfabd40000000049454e44ae426082',
  'hex',
);

let user: TestUser;
let companyId: string;
let agentToken: string;
let employeeId: string;
let payslipId: string;
const human = () => ({ Authorization: `Bearer ${user.token}` });
const agent = () => ({ Authorization: `Bearer ${agentToken}` });
const co = () => `/api/companies/${companyId}`;

beforeAll(async () => {
  user = await registerUser('docs');
  companyId = await createCompany(user.token, 'Dokument AB');
  await api.patch(`${co()}`).set(human()).send({ org_number: '556123-4567' });
  const tok = await api.post(`${co()}/agent-tokens`).set(human()).send({ name: 'Cowork' });
  agentToken = tok.body.token;
  const emp = await api.post(`${co()}/actions/create_employee`).set(human()).send({
    name: 'David Testson', personnummer: '750301-9155', monthly_salary_ore: 5_650_000, tax_rate: 23,
  });
  employeeId = emp.body.result.id;
  const slip = await api.post(`${co()}/actions/create_payslip`).set(human()).send({ employee_id: employeeId, period: '2026-07' });
  payslipId = slip.body.result.id;
});

describe('attach_document / list_documents / get_document', () => {
  let documentId: string;

  it('en agent kan bilägga ett dokument (base64) på ett lönebesked via action-lagret', async () => {
    const res = await api.post(`${co()}/actions/attach_document`).set(agent()).send({
      entity_type: 'payslip', entity_id: payslipId,
      filename: 'underlag.png', content_base64: PNG_1PX.toString('base64'), title: 'Underlag juli',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    documentId = res.body.result.id;
    expect(res.body.result.entity_type).toBe('payslip');
    expect(res.body.result.original_name).toBe('underlag.png');
    expect(res.body.result.mime_type).toBe('image/png');
  });

  it('list_documents filtrerar på post; get_document returnerar innehållet', async () => {
    const list = await api.post(`${co()}/actions/list_documents`).set(agent()).send({ entity_type: 'payslip', entity_id: payslipId });
    expect(list.status).toBe(200);
    expect(list.body.result.some((d: { id: string }) => d.id === documentId)).toBe(true);

    const got = await api.post(`${co()}/actions/get_document`).set(agent()).send({ document_id: documentId, include_content: true });
    expect(got.status).toBe(200);
    expect(Buffer.from(got.body.result.content_base64, 'base64').equals(PNG_1PX)).toBe(true);
  });

  it('innehåll som inte matchar ändelsen avvisas (magic bytes)', async () => {
    const res = await api.post(`${co()}/actions/attach_document`).set(human()).send({
      entity_type: 'payslip', entity_id: payslipId,
      filename: 'skript.pdf', content_base64: Buffer.from('#!/bin/sh\necho hej').toString('base64'),
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_file');
  });

  it('koppling till en post som inte finns i bolaget ger 404 — aldrig läckage', async () => {
    const other = await registerUser('docs-other');
    const otherCompany = await createCompany(other.token, 'Annat AB');
    const otherEmp = await api.post(`/api/companies/${otherCompany}/actions/create_employee`)
      .set({ Authorization: `Bearer ${other.token}` }).send({ name: 'Annan', monthly_salary_ore: 3_000_000 });
    const otherSlip = await api.post(`/api/companies/${otherCompany}/actions/create_payslip`)
      .set({ Authorization: `Bearer ${other.token}` }).send({ employee_id: otherEmp.body.result.id, period: '2026-07' });

    const res = await api.post(`${co()}/actions/attach_document`).set(human()).send({
      entity_type: 'payslip', entity_id: otherSlip.body.result.id,
      filename: 'x.png', content_base64: PNG_1PX.toString('base64'),
    });
    expect(res.status).toBe(404);
  });
});

describe('generate_payslip_pdf (Locollabs mall)', () => {
  it('genererar PDF:en, lagrar och kopplar den till lönebeskedet', async () => {
    const res = await api.post(`${co()}/actions/generate_payslip_pdf`).set(human()).send({ payslip_id: payslipId });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.result.entity_type).toBe('payslip');
    expect(res.body.result.mime_type).toBe('application/pdf');
    expect(res.body.result.title).toBe('Lönespecifikation 2026-07');

    // Hämta innehållet och verifiera mallens uppgifter i PDF-texten.
    const got = await api.post(`${co()}/actions/get_document`).set(human()).send({
      document_id: res.body.result.id, include_content: true,
    });
    const text = pdfText(Buffer.from(got.body.result.content_base64, 'base64'));
    expect(text).toContain('LÖNESPECIFIKATION');
    expect(text).toContain('David Testson');
    expect(text).toContain('Månadslön');
    expect(text).toContain('Prel skatt tabell');
    expect(text).toContain('56 500,000');   // brutto
    expect(text).toContain('-12 943,000');  // tabell 30-skatten
    expect(text).toContain('43 557,000');   // netto
    expect(text).toContain('20260724');     // utbetalningsdatum (bankdagsregeln)
    expect(text).toContain('750301-9155');
  });

  it('ackumulerat brutto/skatt på specen räknas ur årets lönebesked', async () => {
    await api.post(`${co()}/actions/create_payslip`).set(human()).send({ employee_id: employeeId, period: '2026-08' });
    const slips = await api.post(`${co()}/actions/list_payslips`).set(human()).send({ period: '2026-08' });
    const res = await api.post(`${co()}/actions/generate_payslip_pdf`).set(human()).send({ payslip_id: slips.body.result[0].id });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const got = await api.post(`${co()}/actions/get_document`).set(human()).send({ document_id: res.body.result.id, include_content: true });
    const text = pdfText(Buffer.from(got.body.result.content_base64, 'base64'));
    expect(text).toContain('113 000,000'); // ack. brutto = 2 × 56 500
    expect(text).toContain('25 886,000');  // ack. skatt = 2 × 12 943
  });

  it('lönevyn visar det bilagda dokumentet på lönebeskedsraden', async () => {
    const supertest = (await import('supertest')).default;
    const { app } = await import('./helpers.js');
    const ua = supertest.agent(app);
    await ua.post('/app/login').type('form').send({ email: user.email, password: 'mycket-hemligt-losen-123' });
    const res = await ua.get(`/app/c/${companyId}/payroll`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('documents/');
    expect(res.text).toContain('📎 PDF');
  });

  it('dokumentvyn visar kopplingen och erbjuder uppladdning med koppling', async () => {
    const supertest = (await import('supertest')).default;
    const { app } = await import('./helpers.js');
    const ua = supertest.agent(app);
    await ua.post('/app/login').type('form').send({ email: user.email, password: 'mycket-hemligt-losen-123' });
    const page = await ua.get(`/app/c/${companyId}/documents`);
    expect(page.status).toBe(200);
    expect(page.text).toContain('Kopplad till');
    expect(page.text).toContain('Lönebesked');

    // Manuell uppladdning kopplad till lönebeskedet via formuläret.
    const up = await ua.post(`/app/c/${companyId}/documents/upload`)
      .field('entity_type', 'payslip').field('entity_id', payslipId)
      .attach('file', PNG_1PX, 'manuell.png');
    expect([302, 303]).toContain(up.status);
    expect(up.headers.location).not.toContain('fel=');
    const list = await api.post(`${co()}/actions/list_documents`).set(human()).send({ entity_id: payslipId });
    expect(list.body.result.some((d: { original_name: string }) => d.original_name === 'manuell.png')).toBe(true);
  });
});

// Story 4.3, AC 7 (And-satsen): inget tidigare fall bilade något annat än PNG
// på ett lönebesked. Tillåtelselistan ENTITY_TABLES och ändelselistan i
// validateUpload är mekanismen; raderna nedan prövar varje posttyp och varje
// filtyp minst en gång, och två negativa kontroller visar att fallet kan fälla.
describe('4.3 R2 attach_document tar PDF, PNG och JPG och kopplar till alla fem posttyper (regression, FR-18)', () => {
  const PDF_LITEN = Buffer.from('%PDF-1.4\n%%EOF', 'latin1');
  const JPG_LITEN = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00]);
  let invoiceId: string;
  let receiptId: string;
  let supplierInvoiceId: string;
  let voucherId: string;

  beforeAll(async () => {
    const fy = await createFiscalYear(companyId, human(), { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });
    const cust = await api.post(`${co()}/actions/create_customer`).set(human()).send({ name: 'Dokumentkund AB' });
    expect(cust.status, JSON.stringify(cust.body)).toBe(200);
    const inv = await api.post(`${co()}/actions/create_invoice`).set(human()).send({
      customer_id: cust.body.result.id, invoice_date: '2026-04-01',
      lines: [{ description: 'Dokumentprov', quantity: 1, unit_price_ore: 100_000, vat_rate: 25 }],
    });
    expect(inv.status, JSON.stringify(inv.body)).toBe(200);
    invoiceId = inv.body.result.id;
    const rec = await api.post(`${co()}/actions/create_receipt`).set(human()).send({
      receipt_date: '2026-04-01', description: 'Dokumentprov', net_ore: 10_000, vat_rate: 25, expense_account: 5460, payment_account: 1930,
    });
    expect(rec.status, JSON.stringify(rec.body)).toBe(200);
    receiptId = rec.body.result.id;
    const supp = await api.post(`${co()}/actions/create_supplier`).set(human()).send({ name: 'Dokumentleverantör AB' });
    expect(supp.status, JSON.stringify(supp.body)).toBe(200);
    const sinv = await api.post(`${co()}/actions/create_supplier_invoice`).set(human()).send({
      supplier_id: supp.body.result.id, invoice_date: '2026-04-01', due_date: '2026-04-30',
      net_ore: 50_000, vat_rate: 25, expense_account: 5460,
    });
    expect(sinv.status, JSON.stringify(sinv.body)).toBe(200);
    supplierInvoiceId = sinv.body.result.id;
    const ver = await api.post(`${co()}/actions/post_voucher`).set(human()).send({
      fiscal_year_id: fy.id, voucher_date: '2026-04-15', description: 'Dokumentprov 4.3',
      lines: [
        { account_number: 1930, debit_ore: 1_250_000 },
        { account_number: 3001, credit_ore: 1_000_000 },
        { account_number: 2611, credit_ore: 250_000 },
      ],
    });
    expect(ver.status, JSON.stringify(ver.body)).toBe(202);
    const ok = await api.post(`${co()}/approvals/${ver.body.approval.id}/approve`).set(human()).send({});
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const rad = await withAdmin((c) => c.query<{ id: string }>(
      'SELECT id FROM vouchers WHERE company_id = $1 AND description = $2', [companyId, 'Dokumentprov 4.3'],
    ));
    expect(rad.rows.length, JSON.stringify(rad.rows)).toBe(1);
    voucherId = rad.rows[0]!.id;
  });

  it('4.3 R2 attach_document tar PDF, PNG och JPG och kopplar till lönebesked, faktura, kvitto, leverantörsfaktura och verifikat', async () => {
    const rader = [
      { entity_type: 'payslip', entity_id: payslipId, filename: 'r2.jpg', bytes: JPG_LITEN, mime_type: 'image/jpeg' },
      { entity_type: 'invoice', entity_id: invoiceId, filename: 'r2.pdf', bytes: PDF_LITEN, mime_type: 'application/pdf' },
      { entity_type: 'receipt', entity_id: receiptId, filename: 'r2.png', bytes: PNG_1PX, mime_type: 'image/png' },
      { entity_type: 'supplier_invoice', entity_id: supplierInvoiceId, filename: 'r2.jpeg', bytes: JPG_LITEN, mime_type: 'image/jpeg' },
      { entity_type: 'voucher', entity_id: voucherId, filename: 'r2-verifikat.pdf', bytes: PDF_LITEN, mime_type: 'application/pdf' },
    ];
    for (const rad of rader) {
      const vad = `${rad.entity_type} ${rad.filename}`;
      const res = await api.post(`${co()}/actions/attach_document`).set(agent()).send({
        entity_type: rad.entity_type, entity_id: rad.entity_id,
        filename: rad.filename, content_base64: rad.bytes.toString('base64'),
      });
      expect(res.status, `${vad}: ${JSON.stringify(res.body)}`).toBe(200);
      expect(res.body.result.entity_type, vad).toBe(rad.entity_type);
      expect(res.body.result.entity_id, vad).toBe(rad.entity_id);
      expect(res.body.result.mime_type, vad).toBe(rad.mime_type);
      const documentId: string = res.body.result.id;

      const list = await api.post(`${co()}/actions/list_documents`).set(agent())
        .send({ entity_type: rad.entity_type, entity_id: rad.entity_id });
      expect(list.status, `${vad}: ${JSON.stringify(list.body)}`).toBe(200);
      expect(list.body.result.some((d: { id: string }) => d.id === documentId), vad).toBe(true);

      const got = await api.post(`${co()}/actions/get_document`).set(agent())
        .send({ document_id: documentId, include_content: true });
      expect(got.status, `${vad}: ${JSON.stringify(got.body)}`).toBe(200);
      expect(Buffer.from(got.body.result.content_base64, 'base64').equals(rad.bytes), vad).toBe(true);
    }

    // Negativa kontroller: en posttyp utanför tillåtelselistan och en ändelse
    // utanför ändelselistan avvisas, så raderna ovan kan fälla.
    const felTyp = await api.post(`${co()}/actions/attach_document`).set(agent()).send({
      entity_type: 'employee', entity_id: payslipId, filename: 'r2.png', content_base64: PNG_1PX.toString('base64'),
    });
    expect(felTyp.status, JSON.stringify(felTyp.body)).toBe(400);
    expect(felTyp.body.error).toBe('validation_error');
    const felAndelse = await api.post(`${co()}/actions/attach_document`).set(agent()).send({
      entity_type: 'payslip', entity_id: payslipId, filename: 'anteckning.txt', content_base64: PNG_1PX.toString('base64'),
    });
    expect(felAndelse.status, JSON.stringify(felAndelse.body)).toBe(400);
    expect(felAndelse.body.error).toBe('invalid_file');
  });
});

// Story 4.3, AC 6: åtgärdsruttens kroppsgräns får inte glida isär från
// tjänstens 10 MB, så den räknas ur MAX_DOCUMENT_BYTES och inte ur ett eget tal.
describe('4.3 K1 kroppsgränsen räknas ur MAX_DOCUMENT_BYTES (AC 6)', () => {
  it('4.3 K1 ATTACH_DOCUMENT_BODY_LIMIT_BYTES är base64-storleken av MAX_DOCUMENT_BYTES plus kuvertets marginal', () => {
    expect(MAX_DOCUMENT_BYTES).toBe(10_485_760);
    // 4 × ceil(10 485 760 / 3) = 13 981 016 tecken base64 med utfyllnad.
    expect(MAX_DOCUMENT_BASE64_CHARS).toBe(4 * Math.ceil(MAX_DOCUMENT_BYTES / 3));
    // 13 981 016 + 16 384 = 13 997 400 byte.
    expect(ATTACH_DOCUMENT_BODY_LIMIT_BYTES).toBe(MAX_DOCUMENT_BASE64_CHARS + DOCUMENT_JSON_ENVELOPE_MARGIN_BYTES);
    expect(DOCUMENT_JSON_ENVELOPE_MARGIN_BYTES).toBeGreaterThanOrEqual(4_096);
    expect(DOCUMENT_JSON_ENVELOPE_MARGIN_BYTES).toBeLessThanOrEqual(65_536);
  });
});

// Story 4.3, AC 1–5: base64 för 10 MB ryms inte i den globala gränsen på 1 MB.
// Åtgärdsrutten för attach_document hoppar därför över den globala parsern och
// får en egen med gränsen ur tjänsten, men först efter authenticate och
// requireCompanyAccess. Allt annat har kvar 1 MB.
describe('4.3 attach_document tar en kropp upp till kroppsgränsen, först efter bolagsåtkomsten, och allt annat har kvar 1 MB (FR-18, AD-10)', () => {
  // Kroppen i meddelandet, kapad: ett lyckat get_document bär 14 MB base64.
  const kort = (body: unknown) => String(JSON.stringify(body)).slice(0, 500);
  /** Skickar en färdig JSON-sträng till attach_document, byte för byte som den är. */
  const skicka = (auth: Record<string, string>, kropp: string) =>
    api.post(`${co()}/actions/attach_document`).set(auth).set('Content-Type', 'application/json').send(kropp);
  const jsonKropp = (objekt: Record<string, unknown>) => JSON.stringify(objekt);
  // Öppen sträng utan avslut: tolkad av någon JSON-parser ger den ett fel
  // (413 av den globala, 400 invalid_body av den stora). 401 och 404 betyder
  // alltså att ingen parser tolkat den.
  const trasig2mb = `{"x":"${'a'.repeat(2_097_152)}`;

  /** Bolagets lager: rader i files, documents och audit_log, och filer i uppladdningskatalogen. */
  async function lagerlage(): Promise<{ files: number; documents: number; audit_log: number; diskfiler: number }> {
    const tabeller = await withAdmin(async (c) => (await c.query<{ files: number; documents: number; audit_log: number }>(
      `SELECT (SELECT count(*) FROM files WHERE company_id = $1) AS files,
              (SELECT count(*) FROM documents WHERE company_id = $1) AS documents,
              (SELECT count(*) FROM audit_log WHERE company_id = $1) AS audit_log`,
      [companyId],
    )).rows[0]!);
    // Samma upplösning som fileStorage: UPLOAD_DIR/{bolag}. En katalog som
    // saknas har inga filer; varje annat läsfel fäller provet.
    let diskfiler = 0;
    try {
      diskfiler = (await readdir(path.resolve(config.UPLOAD_DIR, companyId))).length;
    } catch (err) {
      if ((err as { code?: unknown }).code !== 'ENOENT') throw err;
    }
    return { ...tabeller, diskfiler };
  }

  /** En PDF på exakt n byte: rätt magic bytes, i övrigt slumpbytes. */
  function pdfBytes(n: number): Buffer {
    const huvud = Buffer.from('%PDF-1.7\n', 'latin1');
    return Buffer.concat([huvud, randomBytes(n - huvud.length)]);
  }

  /** En JSON-kropp på exakt `byte` byte, utfylld med «A» i base64-fältet. */
  function exaktKropp(byte: number): string {
    const kuvert = { entity_type: 'payslip', entity_id: payslipId, filename: 'grans.pdf' };
    const tom = Buffer.byteLength(JSON.stringify({ ...kuvert, content_base64: '' }));
    return JSON.stringify({ ...kuvert, content_base64: 'A'.repeat(byte - tom) });
  }

  it('4.3 F1 tillåtelselistan är exakt åtgärdsrutten för attach_document', () => {
    const id = '7b0c2e4a-1d3f-4a5b-9c6d-8e7f6a5b4c3d';
    const sann = `/api/companies/${id}/actions/attach_document`;
    expect(isAttachDocumentRequest('POST', sann)).toBe(true);
    expect(isAttachDocumentRequest('POST', `${sann}/`)).toBe(true);
    const falska: Array<[string, string]> = [
      ['GET', sann],
      ['PUT', sann],
      ['POST', `/api/companies/${id}/actions/attach_documents`],
      ['POST', `/api/companies/${id}/actions/list_documents`],
      ['POST', `/api/companies/${id}/actions/attach_document/x`],
      ['POST', `/api/companies/${id}/actions/ATTACH_DOCUMENT`],
      ['POST', `/api/companies/${id}/x/actions/attach_document`],
      ['POST', '/api/companies//actions/attach_document'],
    ];
    expect(falska).toHaveLength(8);
    for (const [metod, sokvag] of falska) {
      expect(isAttachDocumentRequest(metod, sokvag), `${metod} ${sokvag}`).toBe(false);
    }
  });

  it('4.3 A1 en PDF på 9,9 MB sparas och kommer tillbaka byte för byte', async () => {
    const fil = pdfBytes(10_380_902); // 9,9 × 1 048 576, nedrundat
    const kropp = jsonKropp({
      entity_type: 'payslip', entity_id: payslipId, filename: 'stor.pdf', content_base64: fil.toString('base64'),
    });
    // Över den globala gränsen: fallet prövar verkligen undantaget.
    expect(Buffer.byteLength(kropp)).toBeGreaterThan(1_048_576);
    const res = await skicka(agent(), kropp);
    expect(res.status, kort(res.body)).toBe(200);
    expect(res.body.result.entity_type).toBe('payslip');
    expect(res.body.result.entity_id).toBe(payslipId);
    expect(res.body.result.size_bytes).toBe(10_380_902);
    expect(res.body.result.sha256).toBe(createHash('sha256').update(fil).digest('hex'));

    const got = await api.post(`${co()}/actions/get_document`).set(agent())
      .send({ document_id: res.body.result.id, include_content: true });
    expect(got.status, kort(got.body)).toBe(200);
    expect(Buffer.from(got.body.result.content_base64, 'base64').equals(fil)).toBe(true);
  }, 120_000);

  it('4.3 A2 10 MB + 1 byte ger 400 too_large och ingenting sparas', async () => {
    const kropp = jsonKropp({
      entity_type: 'payslip', entity_id: payslipId, filename: 'for-stor.pdf',
      content_base64: pdfBytes(10_485_761).toString('base64'), // 10 MB + 1 byte
    });
    // Inom kroppsgränsen: 400 kommer från tjänsten, inte från parsern.
    expect(Buffer.byteLength(kropp)).toBeLessThanOrEqual(ATTACH_DOCUMENT_BODY_LIMIT_BYTES);
    const fore = await lagerlage();
    const res = await skicka(human(), kropp);
    expect(res.status, kort(res.body)).toBe(400);
    expect(res.body.error).toBe('too_large');
    expect(await lagerlage()).toEqual(fore);
  }, 120_000);

  it('4.3 A3 parserns gräns är konstanten', async () => {
    const fore = await lagerlage();
    // (a) Exakt vid gränsen: parsern tar emot kroppen, och tjänsten avgör.
    const vidGransen = exaktKropp(ATTACH_DOCUMENT_BODY_LIMIT_BYTES);
    expect(Buffer.byteLength(vidGransen)).toBe(ATTACH_DOCUMENT_BODY_LIMIT_BYTES);
    const a = await skicka(human(), vidGransen);
    expect(a.status, kort(a.body)).toBe(400);
    expect(a.body.error).toBe('too_large');
    // (b) En byte till: parsern avvisar, och tjänsten anropas aldrig.
    const overGransen = exaktKropp(ATTACH_DOCUMENT_BODY_LIMIT_BYTES + 1);
    expect(Buffer.byteLength(overGransen)).toBe(ATTACH_DOCUMENT_BODY_LIMIT_BYTES + 1);
    const b = await skicka(human(), overGransen);
    expect(b.status, kort(b.body)).toBe(413);
    expect(b.body.error).toBe('invalid_body');
    expect(await lagerlage()).toEqual(fore);
  }, 120_000);

  it('4.3 A4 kroppen tolkas inte före autentisering och bolagsåtkomst', async () => {
    const u1 = await skicka({}, trasig2mb);
    expect(u1.status, `U1: ${kort(u1.body)}`).toBe(401);
    const u2 = await skicka({ Authorization: 'Bearer ogiltig' }, trasig2mb);
    expect(u2.status, `U2: ${kort(u2.body)}`).toBe(401);

    const utanBolag = await registerUser('docs-a4-utan');
    const m1 = await skicka({ Authorization: `Bearer ${utanBolag.token}` }, trasig2mb);
    expect(m1.status, `M1: ${kort(m1.body)}`).toBe(404);

    const annan = await registerUser('docs-a4-annan');
    const annatBolag = await createCompany(annan.token, 'A4 Annat AB');
    const tok = await api.post(`/api/companies/${annatBolag}/agent-tokens`)
      .set({ Authorization: `Bearer ${annan.token}` }).send({ name: 'A4' });
    expect(tok.status, JSON.stringify(tok.body)).toBe(201);
    const m2 = await skicka({ Authorization: `Bearer ${tok.body.token}` }, trasig2mb);
    expect(m2.status, `M2: ${kort(m2.body)}`).toBe(404);

    // Kontrollen K-A4: med bolagets eget token tolkas samma kropp och fäller.
    const kontroll = await skicka(human(), trasig2mb);
    expect(kontroll.status, `K-A4: ${kort(kontroll.body)}`).toBe(400);
    expect(kontroll.body.error).toBe('invalid_body');
  });

  it('4.3 A5 alla andra rutter har kvar 1 MB', async () => {
    // Giltig JSON på 2 MB, skickad som objekt så att supertest sätter
    // Content-Type: application/json och den globala parsern läser den.
    const stor = 'a'.repeat(2_097_152);
    const g1 = await api.post(`${co()}/actions/list_documents`).set(human()).send({ name: stor });
    const g2 = await api.post(`${co()}/actions/set_company_logo`).set(human()).send({ filename: 'logo.png', content_base64: stor });
    const g3 = await api.patch(co()).set(human()).send({ name: stor });
    const g4 = await api.post('/api/auth/login').send({ name: stor });
    for (const [id, res] of [['G1', g1], ['G2', g2], ['G3', g3], ['G4', g4]] as const) {
      expect(res.status, `${id}: ${kort(res.body)}`).toBe(413);
      expect(res.body.error, id).toBe('invalid_body');
    }
  });
});
