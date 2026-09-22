// Kvittobilagor (beslut #178): hela trestegsvägen genom riktiga HTTP-anrop mot
// en riktig Postgres — begär länk, PUT:a bytesen utanför MCP, bekräfta.
//
// Provet bär kravbildens "klart-när"-lista punkt för punkt: 1,3 MB JPEG utan
// att bytesen passerar ett MCP-anrop, bilaga före OCH efter book_receipt,
// oföränderlighet på bokfört kvitto, sha256 som matchar vid nedladdning, flera
// bilagor, tenant-isolering, utgången och återanvänd signatur.
import { createHash } from 'node:crypto';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { api, createCompany, createFiscalYear, registerUser, withAdmin, type TestUser } from './helpers.js';
import { publikApiBas, signeraBilagelank } from '../src/lib/bilagesignatur.js';

let user: TestUser;
let companyId: string;
let fiscalYearId: string;
let annanAnvandare: TestUser;
let annatBolag: string;

const auth = () => ({ Authorization: `Bearer ${user.token}` });
const co = () => `/api/companies/${companyId}`;

/** En riktig (om än enfärgad) JPEG: magic bytes + fyllnad. 1,3 MB som Davids kvittobild. */
function jpeg(bytes = 1_300_000): Buffer {
  const body = Buffer.alloc(bytes, 0x5a);
  body[0] = 0xff; body[1] = 0xd8; body[2] = 0xff; body[3] = 0xe0;
  return body;
}

function heic(bytes = 2048): Buffer {
  const body = Buffer.alloc(bytes, 0x11);
  body.write('ftypheic', 4, 'latin1');
  return body;
}

/** Den signerade URL:en pekar på PUBLIC_API_URL — supertest kör appen in-process. */
function sokvag(url: string): string {
  const u = new URL(url);
  expect(u.origin).toBe('https://redovisning.test');
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

async function bokfor(receiptId: string): Promise<void> {
  const req = await api.post(`${co()}/actions/book_receipt`).set(auth())
    .send({ receipt_id: receiptId, fiscal_year_id: fiscalYearId });
  expect(req.status, JSON.stringify(req.body)).toBe(202);
  const godkant = await api.post(`${co()}/approvals/${req.body.approval.id}/approve`).set(auth()).send({});
  expect(godkant.status, JSON.stringify(godkant.body)).toBe(200);
}

interface BifogadBilaga { fileId: string; sha256: string; bytes: Buffer }

/** Hela trestegssekvensen, som en agent skulle köra den. */
async function bifoga(
  receiptId: string, bytes: Buffer, filename = 'kvitto.jpg', mime = 'image/jpeg',
): Promise<BifogadBilaga> {
  const steg1 = await api.post(`${co()}/actions/create_receipt_upload_url`).set(auth())
    .send({ receipt_id: receiptId, filename, mime_type: mime, size_bytes: bytes.length });
  expect(steg1.status, JSON.stringify(steg1.body)).toBe(200);

  const steg2 = await api.put(sokvag(steg1.body.result.upload_url))
    .set('Content-Type', mime).send(bytes);
  expect(steg2.status, JSON.stringify(steg2.body)).toBe(201);

  const steg3 = await api.post(`${co()}/actions/confirm_receipt_file`).set(auth())
    .send({ file_id: steg1.body.result.file_id });
  expect(steg3.status, JSON.stringify(steg3.body)).toBe(200);
  expect(steg3.body.result.status).toBe('active');

  return {
    fileId: steg1.body.result.file_id,
    sha256: steg3.body.result.sha256,
    bytes,
  };
}

beforeAll(async () => {
  user = await registerUser('bilaga');
  companyId = await createCompany(user.token, 'Bilage AB');
  const fy = await createFiscalYear(companyId, auth(), {
    label: '2026', start_date: '2026-01-01', end_date: '2026-12-31',
  });
  fiscalYearId = fy.id;
  annanAnvandare = await registerUser('bilaga-annan');
  annatBolag = await createCompany(annanAnvandare.token, 'Annat AB');
});

describe('trestegsvägen in för originalkvittot', () => {
  it('bifogar en 1,3 MB JPEG utan att bytesen passerar ett MCP-anrop', async () => {
    const receiptId = await skapaKvitto('Representation med bilaga');
    const bild = jpeg();

    const steg1 = await api.post(`${co()}/actions/create_receipt_upload_url`).set(auth())
      .send({ receipt_id: receiptId, filename: 'kvitto.jpg', mime_type: 'image/jpeg', size_bytes: bild.length });
    expect(steg1.status, JSON.stringify(steg1.body)).toBe(200);
    expect(steg1.body.result.upload_url).toContain('https://redovisning.test/api/receipt-files/');
    expect(new Date(steg1.body.result.expires_at).getTime()).toBeGreaterThan(Date.now());
    // Poängen med hela bygget: action-svaret bär metadata, inte bytes.
    expect(JSON.stringify(steg1.body).length).toBeLessThan(2_000);

    // Steg 2 ligger UTANFÖR action-lagret: rå PUT, ingen Authorization-header.
    const steg2 = await api.put(sokvag(steg1.body.result.upload_url))
      .set('Content-Type', 'image/jpeg').send(bild);
    expect(steg2.status, JSON.stringify(steg2.body)).toBe(201);
    expect(steg2.body.size_bytes).toBe(1_300_000);

    const steg3 = await api.post(`${co()}/actions/confirm_receipt_file`).set(auth())
      .send({ file_id: steg1.body.result.file_id });
    expect(steg3.status, JSON.stringify(steg3.body)).toBe(200);
    expect(steg3.body.result.sha256).toBe(createHash('sha256').update(bild).digest('hex'));
    expect(JSON.stringify(steg3.body).length).toBeLessThan(2_000);

    // Bifogningen ligger i auditloggen med sha256, uppladdare och tid.
    const audit = await withAdmin(async (admin) => (await admin.query(
      "SELECT user_id, details, created_at FROM audit_log WHERE company_id = $1 AND action = 'receipt.file_attached' AND entity_id = $2",
      [companyId, receiptId],
    )).rows);
    expect(audit).toHaveLength(1);
    expect(audit[0].details.sha256).toBe(steg3.body.result.sha256);
    expect(audit[0].details.uploaded_by).toBe(user.userId);
    expect(audit[0].user_id).toBe(user.userId);
  });

  it('nedladdat innehåll matchar sparad sha256', async () => {
    const receiptId = await skapaKvitto('Kvitto för nedladdning');
    const bilaga = await bifoga(receiptId, jpeg(40_000));

    const lank = await api.post(`${co()}/actions/get_receipt_file_url`).set(auth())
      .send({ file_id: bilaga.fileId });
    expect(lank.status, JSON.stringify(lank.body)).toBe(200);
    expect(lank.body.result.sha256).toBe(bilaga.sha256);

    // responseType('blob') = superagents binärläge i Node: res.body blir en Buffer.
    const hamtad = await api.get(sokvag(lank.body.result.download_url)).responseType('blob');
    expect(hamtad.status).toBe(200);
    expect(Buffer.isBuffer(hamtad.body)).toBe(true);
    expect(createHash('sha256').update(hamtad.body as Buffer).digest('hex')).toBe(bilaga.sha256);
    expect((hamtad.body as Buffer).equals(bilaga.bytes)).toBe(true);
  });

  it('list_receipts bär bilageantal, metadata och primär bilaga', async () => {
    const receiptId = await skapaKvitto('Kvitto med två bilagor');
    const forsta = await bifoga(receiptId, jpeg(20_000), 'nota.jpg');
    const andra = await bifoga(receiptId, heic(), 'deltagarlista.heic', 'image/heic');

    const lista = await api.post(`${co()}/actions/list_receipts`).set(auth()).send({});
    const rad = lista.body.result.find((r: { id: string }) => r.id === receiptId);
    expect(rad.attachment_count).toBe(2);
    expect(rad.primary_attachment_id).toBe(forsta.fileId);
    expect(rad.attachments.map((b: { filename: string }) => b.filename)).toEqual(['nota.jpg', 'deltagarlista.heic']);
    expect(rad.attachments[1].mime_type).toBe('image/heic');
    expect(rad.attachments.map((b: { sha256: string }) => b.sha256)).toEqual([forsta.sha256, andra.sha256]);
  });
});

describe('livscykel och oföränderlighet', () => {
  it('bilaga går att bifoga både före och efter book_receipt', async () => {
    const receiptId = await skapaKvitto('Kvitto som bokförs mitt i');
    const fore = await bifoga(receiptId, jpeg(15_000), 'fore.jpg');
    await bokfor(receiptId);
    const efter = await bifoga(receiptId, jpeg(16_000), 'efter.jpg');

    const lista = await api.post(`${co()}/actions/list_receipts`).set(auth()).send({});
    const rad = lista.body.result.find((r: { id: string }) => r.id === receiptId);
    expect(rad.status).toBe('booked');
    expect(rad.attachment_count).toBe(2);
    expect(rad.attachments.map((b: { file_id: string }) => b.file_id)).toEqual([fore.fileId, efter.fileId]);
  });

  it('en bilaga på ett BOKFÖRT kvitto kan varken skrivas över eller raderas', async () => {
    const receiptId = await skapaKvitto('Bokfört med underlag');
    const bilaga = await bifoga(receiptId, jpeg(12_000), 'original.jpg');
    await bokfor(receiptId);

    // Överskrivning: bekräftelsen är gjord, en andra bekräftelse avvisas.
    const omBekrafta = await api.post(`${co()}/actions/confirm_receipt_file`).set(auth())
      .send({ file_id: bilaga.fileId });
    expect(omBekrafta.status).toBe(409);
    expect(omBekrafta.body.error).toBe('already_confirmed');

    // RLS: raden går inte att radera för app-rollen när kvittot är bokfört.
    const raderade = await withAdmin(async (admin) => {
      await admin.query('BEGIN');
      await admin.query('SET LOCAL ROLE app');
      await admin.query("SELECT set_config('app.user_id', $1, true)", [user.userId]);
      const r = await admin.query('DELETE FROM receipt_files WHERE id = $1', [bilaga.fileId]);
      await admin.query('ROLLBACK');
      return r.rowCount;
    });
    expect(raderade).toBe(0);

    // Triggern: innehållet går inte att skriva om heller.
    const andring = await withAdmin(async (admin) => {
      await admin.query('BEGIN');
      await admin.query('SET LOCAL ROLE app');
      await admin.query("SELECT set_config('app.user_id', $1, true)", [user.userId]);
      try {
        await admin.query("UPDATE receipt_files SET sha256 = repeat('a', 64) WHERE id = $1", [bilaga.fileId]);
        return null;
      } catch (err) {
        return (err as { message: string }).message;
      } finally {
        await admin.query('ROLLBACK');
      }
    });
    expect(andring).toContain('oföränderlig');
  });

  it('rättelse på bokfört kvitto sker genom ny bilaga + superseded_by', async () => {
    const receiptId = await skapaKvitto('Fel bilaga först');
    const fel = await bifoga(receiptId, jpeg(9_000), 'fel.jpg');
    await bokfor(receiptId);

    const steg1 = await api.post(`${co()}/actions/create_receipt_upload_url`).set(auth())
      .send({ receipt_id: receiptId, filename: 'ratt.jpg', mime_type: 'image/jpeg', size_bytes: 9_500 });
    await api.put(sokvag(steg1.body.result.upload_url)).set('Content-Type', 'image/jpeg').send(jpeg(9_500));
    const steg3 = await api.post(`${co()}/actions/confirm_receipt_file`).set(auth())
      .send({ file_id: steg1.body.result.file_id, ersatter_file_id: fel.fileId });
    expect(steg3.status, JSON.stringify(steg3.body)).toBe(200);

    const lista = await api.post(`${co()}/actions/list_receipts`).set(auth()).send({});
    const rad = lista.body.result.find((r: { id: string }) => r.id === receiptId);
    // Den felaktiga bilagan ligger kvar — utpekad, inte raderad.
    expect(rad.attachment_count).toBe(2);
    expect(rad.attachments.find((b: { file_id: string }) => b.file_id === fel.fileId).superseded_by)
      .toBe(steg1.body.result.file_id);
    expect(rad.primary_attachment_id).toBe(steg1.body.result.file_id);
  });

  it('delete_draft_receipt städar utkastets bilagerader OCH objekt', async () => {
    const receiptId = await skapaKvitto('Utkast som raderas');
    const bilaga = await bifoga(receiptId, jpeg(8_000), 'skrot.jpg');
    const nyckel = await withAdmin(async (admin) => (await admin.query<{ storage_key: string }>(
      'SELECT storage_key FROM receipt_files WHERE id = $1', [bilaga.fileId],
    )).rows[0]!.storage_key);
    const full = path.resolve(process.env.RECEIPT_FILES_DIR!, nyckel);
    await expect(access(full)).resolves.toBeUndefined();

    const res = await api.post(`${co()}/actions/delete_draft_receipt`).set(auth()).send({ receipt_id: receiptId });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.result.removed_attachments).toBe(1);

    const kvar = await withAdmin(async (admin) => (await admin.query(
      'SELECT 1 FROM receipt_files WHERE id = $1', [bilaga.fileId],
    )).rowCount);
    expect(kvar).toBe(0);
    await expect(access(full)).rejects.toThrow();
  });
});

describe('den signerade länken', () => {
  it('avvisar återanvänd signatur', async () => {
    const receiptId = await skapaKvitto('Engångslänk');
    const bild = jpeg(11_000);
    const steg1 = await api.post(`${co()}/actions/create_receipt_upload_url`).set(auth())
      .send({ receipt_id: receiptId, filename: 'en.jpg', mime_type: 'image/jpeg', size_bytes: bild.length });
    const url = sokvag(steg1.body.result.upload_url);

    expect((await api.put(url).set('Content-Type', 'image/jpeg').send(bild)).status).toBe(201);
    const andra = await api.put(url).set('Content-Type', 'image/jpeg').send(bild);
    expect(andra.status).toBe(409);
    expect(andra.body.error).toBe('upload_already_used');
  });

  it('avvisar utgången signatur och manipulerad signatur', async () => {
    const receiptId = await skapaKvitto('Utgången länk');
    const steg1 = await api.post(`${co()}/actions/create_receipt_upload_url`).set(auth())
      .send({ receipt_id: receiptId, filename: 'sen.jpg', mime_type: 'image/jpeg', size_bytes: 7_000 });
    const fileId = steg1.body.result.file_id;

    // Utgången: en äkta signatur vars giltighetstid redan passerat.
    const utgangen = signeraBilagelank({
      op: 'put', fileId, companyId, userId: user.userId, ttlSekunder: -60,
    });
    const svar = await api.put(sokvag(utgangen.url)).set('Content-Type', 'image/jpeg').send(jpeg(7_000));
    expect(svar.status).toBe(403);
    expect(svar.body.error).toBe('signature_expired');

    // Manipulerad: utgångstiden flyttas fram — signaturen täcker den.
    const url = new URL(steg1.body.result.upload_url);
    url.searchParams.set('exp', String(Date.now() + 86_400_000));
    const flyttad = await api.put(sokvag(url.toString())).set('Content-Type', 'image/jpeg').send(jpeg(7_000));
    expect(flyttad.status).toBe(403);
    expect(flyttad.body.error).toBe('invalid_signature');

    // Och bolaget går inte att byta ut i länken heller.
    const bytt = new URL(steg1.body.result.upload_url);
    bytt.searchParams.set('cid', annatBolag);
    const svarBytt = await api.put(sokvag(bytt.toString())).set('Content-Type', 'image/jpeg').send(jpeg(7_000));
    expect(svarBytt.status).toBe(403);
    expect(svarBytt.body.error).toBe('invalid_signature');
  });

  it('avvisar fel storlek, fel filtyp och innehåll som inte matchar typen', async () => {
    const receiptId = await skapaKvitto('Fel indata');
    const steg1 = await api.post(`${co()}/actions/create_receipt_upload_url`).set(auth())
      .send({ receipt_id: receiptId, filename: 'x.jpg', mime_type: 'image/jpeg', size_bytes: 5_000 });
    const url = sokvag(steg1.body.result.upload_url);

    const felStorlek = await api.put(url).set('Content-Type', 'image/jpeg').send(jpeg(4_000));
    expect(felStorlek.status).toBe(400);
    expect(felStorlek.body.error).toBe('size_mismatch');

    const felTyp = await api.put(url).set('Content-Type', 'application/pdf').send(jpeg(5_000));
    expect(felTyp.status).toBe(400);
    expect(felTyp.body.error).toBe('mime_mismatch');

    const felInnehall = await api.put(url).set('Content-Type', 'image/jpeg').send(Buffer.alloc(5_000, 0x42));
    expect(felInnehall.status).toBe(400);
    expect(felInnehall.body.error).toBe('invalid_file');

    // Raden är fortfarande obrukad — ett avvisat försök förbrukar ingenting.
    expect((await api.put(url).set('Content-Type', 'image/jpeg').send(jpeg(5_000))).status).toBe(201);
  });

  it('otillåten filtyp och för stor fil avvisas redan i steg 1', async () => {
    const receiptId = await skapaKvitto('Otillåtet');
    const typ = await api.post(`${co()}/actions/create_receipt_upload_url`).set(auth())
      .send({ receipt_id: receiptId, filename: 'x.exe', mime_type: 'application/x-msdownload', size_bytes: 10 });
    expect(typ.status).toBe(400);

    const stor = await api.post(`${co()}/actions/create_receipt_upload_url`).set(auth())
      .send({ receipt_id: receiptId, filename: 'x.jpg', mime_type: 'image/jpeg', size_bytes: 26 * 1024 * 1024 });
    expect(stor.status).toBe(400);
  });

  it('utan PUBLIC_API_URL ges ett tydligt fel — aldrig en localhost-URL', () => {
    expect(() => publikApiBas(undefined)).toThrowError(/PUBLIC_API_URL/);
    try {
      publikApiBas(undefined);
    } catch (err) {
      expect((err as { code: string }).code).toBe('public_api_url_saknas');
    }
    expect(publikApiBas('https://exempel.se/')).toBe('https://exempel.se');
  });
});

describe('tenant-isolering', () => {
  it('bolag B når varken metadata eller URL för bolag A:s bilaga', async () => {
    const receiptId = await skapaKvitto('A:s kvitto');
    const bilaga = await bifoga(receiptId, jpeg(6_000), 'a.jpg');
    const bAuth = { Authorization: `Bearer ${annanAnvandare.token}` };

    const url = await api.post(`/api/companies/${annatBolag}/actions/get_receipt_file_url`).set(bAuth)
      .send({ file_id: bilaga.fileId });
    expect(url.status).toBe(404);

    const bekrafta = await api.post(`/api/companies/${annatBolag}/actions/confirm_receipt_file`).set(bAuth)
      .send({ file_id: bilaga.fileId });
    expect(bekrafta.status).toBe(404);

    // B kan inte heller be om en uppladdningslänk mot A:s kvitto.
    const lank = await api.post(`/api/companies/${annatBolag}/actions/create_receipt_upload_url`).set(bAuth)
      .send({ receipt_id: receiptId, filename: 'b.jpg', mime_type: 'image/jpeg', size_bytes: 100 });
    expect(lank.status).toBe(404);

    // Och B:s medlemskap ger ingen SELECT på raden ens direkt i databasen.
    const synliga = await withAdmin(async (admin) => {
      await admin.query('BEGIN');
      await admin.query('SET LOCAL ROLE app');
      await admin.query("SELECT set_config('app.user_id', $1, true)", [annanAnvandare.userId]);
      const r = await admin.query('SELECT 1 FROM receipt_files WHERE id = $1', [bilaga.fileId]);
      await admin.query('ROLLBACK');
      return r.rowCount;
    });
    expect(synliga).toBe(0);
  });
});

describe('lat städning (ingen scheduler)', () => {
  it('obekräftade rader vars TTL gått ut städas — rad och objekt', async () => {
    const receiptId = await skapaKvitto('Aldrig bekräftad');
    const bild = jpeg(5_500);
    const steg1 = await api.post(`${co()}/actions/create_receipt_upload_url`).set(auth())
      .send({ receipt_id: receiptId, filename: 'glomd.jpg', mime_type: 'image/jpeg', size_bytes: bild.length });
    const fileId = steg1.body.result.file_id;
    await api.put(sokvag(steg1.body.result.upload_url)).set('Content-Type', 'image/jpeg').send(bild);

    const nyckel = await withAdmin(async (admin) => {
      // Åldra raden förbi TTL:n i stället för att vänta 15 minuter.
      await admin.query("UPDATE receipt_files SET created_at = now() - interval '20 minutes' WHERE id = $1", [fileId]);
      return (await admin.query<{ storage_key: string }>(
        'SELECT storage_key FROM receipt_files WHERE id = $1', [fileId],
      )).rows[0]!.storage_key;
    });
    const full = path.resolve(process.env.RECEIPT_FILES_DIR!, nyckel);
    await expect(access(full)).resolves.toBeUndefined();

    // Nästa anrop i tjänsten städar.
    const nasta = await api.post(`${co()}/actions/create_receipt_upload_url`).set(auth())
      .send({ receipt_id: receiptId, filename: 'ny.jpg', mime_type: 'image/jpeg', size_bytes: 3_000 });
    expect(nasta.status, JSON.stringify(nasta.body)).toBe(200);

    const kvar = await withAdmin(async (admin) => (await admin.query(
      'SELECT 1 FROM receipt_files WHERE id = $1', [fileId],
    )).rowCount);
    expect(kvar).toBe(0);
    await expect(access(full)).rejects.toThrow();

    // En bekräftelse på en städad rad är ett rent 404, aldrig ett 500.
    const sent = await api.post(`${co()}/actions/confirm_receipt_file`).set(auth()).send({ file_id: fileId });
    expect(sent.status).toBe(404);
  });
});

describe('action-manifestet', () => {
  it('de tre åtgärderna körs direkt (write), som create_receipt', async () => {
    const manifest = await api.get(`${co()}/actions`).set(auth());
    type ManifestAction = {
      name: string;
      title: string;
      sensitivity: string;
      requires_approval: boolean;
    };
    const byNamn = new Map<string, ManifestAction>(
      (manifest.body.actions as ManifestAction[]).map((a) => [a.name, a] as const),
    );
    for (const namn of ['create_receipt_upload_url', 'confirm_receipt_file', 'get_receipt_file_url']) {
      const post = byNamn.get(namn);
      expect(post, `${namn} saknas i manifestet`).toBeDefined();
      expect(post!.sensitivity).toBe('write');
      expect(post!.requires_approval).toBe(false);
    }
    // Beskrivningen ska förklara sekvensen — inte lämna agenten att gissa.
    expect(byNamn.get('create_receipt_upload_url')!.title).toContain('PUT');
    expect(byNamn.get('create_receipt_upload_url')!.title).toContain('UTANFÖR MCP');
  });
});
