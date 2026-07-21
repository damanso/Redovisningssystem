// K3: generell dokumentkoppling + lönespec-PDF. attach_document (write) tar
// base64-innehåll och kopplar filen till en registerpost; list_documents/
// get_document (read) läser tillbaka; generate_payslip_pdf skapar lönespec-
// PDF:en enligt Locollabs mall och bilägger den på lönebeskedet. Samma
// filvalidering (ändelse + magic bytes) och tenant-gräns som all lagring.
import { beforeAll, describe, expect, it } from 'vitest';
import { api, createCompany, pdfText, registerUser, type TestUser } from './helpers.js';

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
