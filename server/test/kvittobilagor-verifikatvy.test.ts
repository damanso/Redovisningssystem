// FR-12 T4: verifikatvyn i webben visar miniatyrer av och länkar till
// kvittots bilagor (0075-bilagorna, inte den äldre file_id-vägen). Bilagorna
// bifogas genom samma trestegsväg som en agent kör — begär länk, PUT utanför
// MCP, bekräfta — och vyn prövas som en inloggad människa ser den: i en riktig
// webbläsare, där miniatyren ska avkodas och synas, inte bara stå i HTML:en.
//
// Länkarna och miniatyrerna är den signerade GET-vägen (get_receipt_file_url)
// mot PUBLIC_API_URL — vyn har ingen egen, osignerad läsväg.
import { createHash } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { chromium, type Browser, type Page } from 'playwright';
import supertest from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, app, createCompany, createFiscalYear, registerUser, type TestUser } from './helpers.js';

const PASSWORD = 'mycket-hemligt-losen-123'; // samma som registerUser använder
const PUBLIK = 'https://redovisning.test'; // test/env.ts:s PUBLIC_API_URL

let user: TestUser;
let annan: TestUser;
let companyId: string;
let fiscalYearId: string;
let agent: ReturnType<typeof supertest.agent>;
let annanAgent: ReturnType<typeof supertest.agent>;
let server: Server;
let bas: string;
let webblasare: Browser;
let jpegBild: Buffer;
let pngBild: Buffer;

const auth = () => ({ Authorization: `Bearer ${user.token}` });
const co = () => `/api/companies/${companyId}`;

const pdf = (): Buffer => Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');

/** Riktiga, avkodningsbara bilder: webbläsaren själv ritar och kodar dem. */
async function riktigBild(typ: 'jpeg' | 'png', farg: string): Promise<Buffer> {
  const page = await webblasare.newPage({ viewport: { width: 160, height: 120 } });
  try {
    await page.setContent(`<body style="margin:0;background:${farg}"><div style="width:160px;height:120px"></div></body>`);
    return await page.screenshot({ type: typ, clip: { x: 0, y: 0, width: 160, height: 120 } });
  } finally {
    await page.close();
  }
}

function sokvag(url: string): string {
  const u = new URL(url);
  expect(u.origin).toBe(PUBLIK);
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

/** Bilagans signerade länk i kortet (HTML-escapat &amp; återställt). */
function lankFor(kort: string, filnamn: string): string {
  const m = kort.match(new RegExp(`href="([^"]+)" download="${filnamn.replace(/\./g, '\\.')}"`));
  expect(m, `länk för ${filnamn} saknas`).not.toBeNull();
  return m![1]!.replace(/&amp;/g, '&');
}

/** En webbläsarsida inloggad som användaren; PUBLIC_API_URL dirigeras till testservern. */
async function webbsida(): Promise<Page> {
  const page = await webblasare.newPage();
  await page.route(`${PUBLIK}/**`, async (route) => {
    const svar = await route.fetch({ url: route.request().url().replace(PUBLIK, bas) });
    await route.fulfill({ response: svar });
  });
  await page.goto(`${bas}/app/login`);
  await page.fill('input[name=email]', user.email);
  await page.fill('input[name=password]', PASSWORD);
  await Promise.all([page.waitForNavigation(), page.click('button[type=submit]')]);
  return page;
}

beforeAll(async () => {
  server = app.listen(0);
  await new Promise<void>((klar) => server.once('listening', () => klar()));
  bas = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  webblasare = await chromium.launch();
  jpegBild = await riktigBild('jpeg', '#c0392b');
  pngBild = await riktigBild('png', '#2e86c1');

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
}, 120_000);

afterAll(async () => {
  await webblasare?.close();
  server?.close();
});

describe('verifikatvyn visar kvittots bilagor (T4)', () => {
  it('miniatyrerna för JPEG och PNG avkodas och syns i webbläsaren — bifogade före och efter bokföring', async () => {
    const receiptId = await skapaKvitto('Kvitto med bildbilagor i webbläsaren');
    await bifoga(receiptId, jpegBild, 'kvitto-foto.jpg', 'image/jpeg');
    const voucherId = await bokfor(receiptId);
    await bifoga(receiptId, pngBild, 'kvitto-skarm.png', 'image/png');
    await bifoga(receiptId, pdf(), 'kvitto-original.pdf', 'application/pdf');

    const page = await webbsida();
    try {
      await page.goto(`${bas}/app/c/${companyId}/ledger`);
      const bilder = page.locator(`#v-${voucherId} .bilagor img`);
      expect(await bilder.count()).toBe(2);
      for (let i = 0; i < 2; i++) {
        const bild = bilder.nth(i);
        await bild.scrollIntoViewIfNeeded();
        await expect.poll(
          () => bild.evaluate((el) => (el as HTMLImageElement).complete && (el as HTMLImageElement).naturalWidth),
          { timeout: 10_000 },
        ).toBe(160);
        const matt = await bild.evaluate((el) => ({
          h: (el as HTMLImageElement).naturalHeight,
          src: (el as HTMLImageElement).src,
          synlig: el.getClientRects().length > 0 && (el as HTMLElement).offsetWidth > 0,
        }));
        expect(matt.h).toBe(120);
        expect(matt.synlig).toBe(true);
        expect(matt.src.startsWith(`${PUBLIK}/api/receipt-files/`)).toBe(true);
        expect(matt.src).toMatch(/[?&]sig=[0-9a-f]{64}/);
      }
      // PDF:en har länk men ingen <img>; alla tre bär filnamnet.
      const namn = await page.locator(`#v-${voucherId} .bilaga__namn`).allTextContents();
      expect(namn).toEqual(expect.arrayContaining(['kvitto-foto.jpg', 'kvitto-skarm.png', 'kvitto-original.pdf']));
      const pdfLank = await page.locator(`#v-${voucherId} a[download="kvitto-original.pdf"]`).getAttribute('href');
      expect(pdfLank).toMatch(new RegExp(`^${PUBLIK}/api/receipt-files/[0-9a-f-]{36}/content\\?.*sig=`));
    } finally {
      await page.close();
    }
  }, 60_000);

  it('länken är signerad och kortlivad; nedladdat innehåll matchar sparad sha256; manipulerad signatur avvisas', async () => {
    const receiptId = await skapaKvitto('Kvitto för nedladdning i vyn');
    const bilaga = await bifoga(receiptId, jpegBild, 'hamtas.jpg', 'image/jpeg');
    const voucherId = await bokfor(receiptId);

    const kort = kortet((await agent.get(`/app/c/${companyId}/ledger`)).text, voucherId);
    const lank = lankFor(kort, 'hamtas.jpg');
    const u = new URL(lank);
    expect(u.pathname).toBe(`/api/receipt-files/${bilaga.fileId}/content`);
    const exp = Number(u.searchParams.get('exp'));
    expect(exp - Date.now()).toBeLessThanOrEqual(5 * 60 * 1000);
    expect(exp - Date.now()).toBeGreaterThan(0);

    const dl = await api.get(sokvag(lank)).buffer()
      .parse((r, cb) => { const delar: Buffer[] = []; r.on('data', (d: Buffer) => delar.push(d)); r.on('end', () => cb(null, Buffer.concat(delar))); });
    expect(dl.status).toBe(200);
    expect(dl.headers['content-type']).toContain('image/jpeg');
    expect(dl.headers['cache-control']).toContain('no-store');
    expect(createHash('sha256').update(dl.body as Buffer).digest('hex')).toBe(bilaga.sha256);

    const sig = u.searchParams.get('sig')!;
    u.searchParams.set('sig', `${sig[0] === 'a' ? 'b' : 'a'}${sig.slice(1)}`);
    expect((await api.get(sokvag(u.toString()))).status).toBe(403);
  });

  it('det finns ingen osignerad läsväg i vyn', async () => {
    const receiptId = await skapaKvitto('Kvitto utan osignerad väg');
    const bilaga = await bifoga(receiptId, jpegBild, 'osignerad.jpg', 'image/jpeg');
    const res = await agent.get(`/app/c/${companyId}/kvittobilagor/${bilaga.fileId}`);
    expect(res.status).not.toBe(200);
    const utanSig = await api.get(`/api/receipt-files/${bilaga.fileId}/content`);
    expect(utanSig.status).toBe(403);
  });

  it('en ersatt bilaga ligger kvar i vyn och är märkt', async () => {
    const receiptId = await skapaKvitto('Kvitto med rättad bilaga');
    const fel = await bifoga(receiptId, jpegBild, 'fel-kvitto.jpg', 'image/jpeg');
    const voucherId = await bokfor(receiptId);
    await bifoga(receiptId, pngBild, 'ratt-kvitto.png', 'image/png', fel.fileId);

    const kort = kortet((await agent.get(`/app/c/${companyId}/ledger`)).text, voucherId);
    expect(kort).toContain('ratt-kvitto.png');
    expect(kort).toContain('fel-kvitto.jpg');
    expect(kort).toMatch(/bilaga bilaga--ersatt">\s*<a class="bilaga__lank" href="[^"]*\/api\/receipt-files\/[0-9a-f-]{36}\/content\?[^"]*" download="fel-kvitto\.jpg"/);
  });

  it('RLS håller: ett annat bolags användare når varken huvudboken eller bilagornas länkar', async () => {
    const receiptId = await skapaKvitto('Kvitto som inte ska läcka');
    await bifoga(receiptId, jpegBild, 'hemlig.jpg', 'image/jpeg');
    const voucherId = await bokfor(receiptId);

    const res = await annanAgent.get(`/app/c/${companyId}/ledger`);
    expect(res.status).not.toBe(200);
    expect(res.text).not.toContain('hemlig.jpg');
    expect(res.text).not.toContain(voucherId);
  });

  it('en obekräftad uppladdning visas inte i vyn', async () => {
    const receiptId = await skapaKvitto('Kvitto med halv uppladdning');
    const steg1 = await api.post(`${co()}/actions/create_receipt_upload_url`).set(auth())
      .send({ receipt_id: receiptId, filename: 'halv.jpg', mime_type: 'image/jpeg', size_bytes: 1000 });
    expect(steg1.status).toBe(200);
    const voucherId = await bokfor(receiptId);

    const kort = kortet((await agent.get(`/app/c/${companyId}/ledger`)).text, voucherId);
    expect(kort).not.toContain('halv.jpg');
    expect(kort).not.toContain(steg1.body.result.file_id);
  });
});
