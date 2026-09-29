// FR-12 T4: verifikatvyn i webben visar miniatyrer av och länkar till
// kvittots bilagor (0075-bilagorna, inte den äldre file_id-vägen). Bilagorna
// bifogas genom samma trestegsväg som en agent kör — begär länk, PUT utanför
// MCP, bekräfta — och vyn prövas som en inloggad människa ser den.
import { createHash } from 'node:crypto';
import supertest from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { api, app, createCompany, createFiscalYear, registerUser, type TestUser } from './helpers.js';

const PASSWORD = 'mycket-hemligt-losen-123'; // samma som registerUser använder

let user: TestUser;
let annan: TestUser;
let companyId: string;
let fiscalYearId: string;
let agent: ReturnType<typeof supertest.agent>;
let annanAgent: ReturnType<typeof supertest.agent>;

const auth = () => ({ Authorization: `Bearer ${user.token}` });
const co = () => `/api/companies/${companyId}`;

function jpeg(bytes = 40_000): Buffer {
  const body = Buffer.alloc(bytes, 0x5a);
  body[0] = 0xff; body[1] = 0xd8; body[2] = 0xff; body[3] = 0xe0;
  return body;
}

const pdf = (): Buffer => Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');

function sokvag(url: string): string {
  const u = new URL(url);
  return `${u.pathname}${u.search}`;
}

async function skapaKvitto(beskrivning: string): Promise<string> {
  const res = await api.post(`${co()}/actions/create_receipt`).set(auth()).send({
    receipt_date: '2026-03-02', description: beskrivning, net_ore: 80_000,
    vat_rate: 25, expense_account: 5410, payment_account: 1930,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.result.id;
}

async function bifoga(
  receiptId: string, bytes: Buffer, filename: string, mime: string, ersatter?: string,
): Promise<{ fileId: string; sha256: string }> {
  const steg1 = await api.post(`${co()}/actions/create_receipt_upload_url`).set(auth())
    .send({ receipt_id: receiptId, filename, mime_type: mime, size_bytes: bytes.length });
  expect(steg1.status, JSON.stringify(steg1.body)).toBe(200);
  const steg2 = await api.put(sokvag(steg1.body.result.upload_url)).set('Content-Type', mime).send(bytes);
  expect(steg2.status, JSON.stringify(steg2.body)).toBe(201);
  const steg3 = await api.post(`${co()}/actions/confirm_receipt_file`).set(auth())
    .send({ file_id: steg1.body.result.file_id, ...(ersatter ? { ersatter_file_id: ersatter } : {}) });
  expect(steg3.status, JSON.stringify(steg3.body)).toBe(200);
  return { fileId: steg1.body.result.file_id, sha256: steg3.body.result.sha256 };
}

async function bokfor(receiptId: string): Promise<string> {
  const req = await api.post(`${co()}/actions/book_receipt`).set(auth())
    .send({ receipt_id: receiptId, fiscal_year_id: fiscalYearId });
  expect(req.status, JSON.stringify(req.body)).toBe(202);
  const godkant = await api.post(`${co()}/approvals/${req.body.approval.id}/approve`).set(auth()).send({});
  expect(godkant.status, JSON.stringify(godkant.body)).toBe(200);
  const kvitton = await api.post(`${co()}/actions/list_receipts`).set(auth()).send({});
  const kvitto = (kvitton.body.result.receipts ?? kvitton.body.result).find(
    (r: { id: string }) => r.id === receiptId,
  );
  expect(kvitto?.voucher_id).toBeTruthy();
  return kvitto.voucher_id as string;
}

async function loggaIn(u: TestUser): Promise<ReturnType<typeof supertest.agent>> {
  const a = supertest.agent(app);
  const login = await a.post('/app/login').type('form').send({ email: u.email, password: PASSWORD });
  expect([302, 303]).toContain(login.status);
  return a;
}

/** Verifikatkortet för ett visst verifikat, ur huvudbokens HTML. */
function kortet(sida: string, voucherId: string): string {
  const start = sida.indexOf(`id="v-${voucherId}"`);
  expect(start, 'verifikatet saknas i huvudboken').toBeGreaterThan(-1);
  const slut = sida.indexOf('</article>', start);
  return sida.slice(start, slut);
}

beforeAll(async () => {
  user = await registerUser('verbilaga');
  annan = await registerUser('verbilaga-annan');
  companyId = await createCompany(user.token, 'Verifikatbilaga AB');
  await createCompany(annan.token, 'Annat Verifikat AB');
  const fy = await createFiscalYear(companyId, auth(), {
    label: '2026', start_date: '2026-01-01', end_date: '2026-12-31',
  });
  fiscalYearId = fy.id;
  agent = await loggaIn(user);
  annanAgent = await loggaIn(annan);
});

describe('verifikatvyn visar kvittots bilagor (T4)', () => {
  it('miniatyr för JPEG, typbricka för PDF, länk till båda — bifogade före och efter bokföring', async () => {
    const receiptId = await skapaKvitto('Kvitto med bilagor i verifikatvyn');
    const fore = await bifoga(receiptId, jpeg(), 'kvitto-foto.jpg', 'image/jpeg');
    const voucherId = await bokfor(receiptId);
    const efter = await bifoga(receiptId, pdf(), 'kvitto-original.pdf', 'application/pdf');

    const sida = await agent.get(`/app/c/${companyId}/ledger`);
    expect(sida.status).toBe(200);
    const kort = kortet(sida.text, voucherId);

    const fotoLank = `/app/c/${companyId}/kvittobilagor/${fore.fileId}`;
    const pdfLank = `/app/c/${companyId}/kvittobilagor/${efter.fileId}`;
    expect(kort).toContain('aria-label="Bilagor"');
    expect(kort).toContain('kvitto-foto.jpg');
    expect(kort).toContain('kvitto-original.pdf');
    expect(kort).toContain(`href="${fotoLank}"`);
    expect(kort).toContain(`href="${pdfLank}"`);
    // Miniatyren är en bild från samma ursprung (CSP img-src 'self').
    expect(kort).toContain(`<img src="${fotoLank}"`);
    expect(kort).not.toContain(`<img src="${pdfLank}"`);
    expect(kort).toMatch(/bilaga__typ">PDF</);
  });

  it('nedladdat innehåll via vyn matchar sparad sha256', async () => {
    const receiptId = await skapaKvitto('Kvitto för nedladdning i vyn');
    const bild = jpeg(55_555);
    const bilaga = await bifoga(receiptId, bild, 'hamtas.jpg', 'image/jpeg');
    await bokfor(receiptId);

    const dl = await agent.get(`/app/c/${companyId}/kvittobilagor/${bilaga.fileId}`).buffer()
      .parse((r, cb) => { const delar: Buffer[] = []; r.on('data', (d: Buffer) => delar.push(d)); r.on('end', () => cb(null, Buffer.concat(delar))); });
    expect(dl.status).toBe(200);
    expect(dl.headers['content-type']).toContain('image/jpeg');
    expect(dl.headers['content-disposition']).toContain('hamtas.jpg');
    expect(dl.headers['cache-control']).toContain('no-store');
    expect(createHash('sha256').update(dl.body as Buffer).digest('hex')).toBe(bilaga.sha256);
  });

  it('en ersatt bilaga ligger kvar i vyn och är märkt', async () => {
    const receiptId = await skapaKvitto('Kvitto med rättad bilaga');
    const fel = await bifoga(receiptId, jpeg(), 'fel-kvitto.jpg', 'image/jpeg');
    const voucherId = await bokfor(receiptId);
    await bifoga(receiptId, jpeg(41_000), 'ratt-kvitto.jpg', 'image/jpeg', fel.fileId);

    const kort = kortet((await agent.get(`/app/c/${companyId}/ledger`)).text, voucherId);
    expect(kort).toContain('ratt-kvitto.jpg');
    expect(kort).toContain('fel-kvitto.jpg');
    expect(kort).toMatch(/bilaga bilaga--ersatt">\s*<a class="bilaga__lank" href="[^"]*\/kvittobilagor\/[0-9a-f-]{36}" download="fel-kvitto\.jpg"/);
  });

  it('RLS håller: ett annat bolags användare får 404 på bilagan', async () => {
    const receiptId = await skapaKvitto('Kvitto som inte ska läcka');
    const bilaga = await bifoga(receiptId, jpeg(), 'hemlig.jpg', 'image/jpeg');

    const res = await annanAgent.get(`/app/c/${companyId}/kvittobilagor/${bilaga.fileId}`);
    expect(res.status).toBe(404);
    const oinloggad = await api.get(`/app/c/${companyId}/kvittobilagor/${bilaga.fileId}`);
    expect([302, 303]).toContain(oinloggad.status);
  });

  it('en obekräftad uppladdning visas inte och kan inte hämtas via vyn', async () => {
    const receiptId = await skapaKvitto('Kvitto med halv uppladdning');
    const steg1 = await api.post(`${co()}/actions/create_receipt_upload_url`).set(auth())
      .send({ receipt_id: receiptId, filename: 'halv.jpg', mime_type: 'image/jpeg', size_bytes: 1000 });
    expect(steg1.status).toBe(200);
    const voucherId = await bokfor(receiptId);

    const kort = kortet((await agent.get(`/app/c/${companyId}/ledger`)).text, voucherId);
    expect(kort).not.toContain('halv.jpg');
    const res = await agent.get(`/app/c/${companyId}/kvittobilagor/${steg1.body.result.file_id}`);
    expect(res.status).not.toBe(200);
  });
});
