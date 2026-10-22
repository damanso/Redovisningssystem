// Kvittobilagornas lagring (Story 7.2, FR-15). Risken: att någon tror att
// bilagorna ligger någon annanstans än de gör, att tjänstelagret når bytesen
// förbi lagringsgränssnittet, och att ett lagringsfel blir ett namnlöst 500
// eller visar lagringens sökväg. Davids beslut 2026-10-16: bilagorna ligger
// kvar på lokal volym, och valet av lagring är uttryckligt bakom ett gränssnitt.
//
// Lagren: konfigurationen (valet och fabriken), tillåtelselistan över hela
// server/src som en ren kontroll med planterade brott, och tjänstelagret genom
// HTTP mot den riktiga lagringskatalogen för testmiljön — med driftloggens rad
// för varje lagringsfel, eftersom errorHandler inte loggar ett AppError.
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { config } from '../src/config.js';
import { lagringsrot, nyLagringsnyckel, objektlagring } from '../src/services/objektlagring.js';
import { api, createCompany, createFiscalYear, registerUser, withAdmin, type TestUser } from './helpers.js';
import { importer } from './utskickHelper.js';

/** Hela server/src: sökvägen i src (posix) till filens text. */
async function kodbasen(): Promise<Map<string, string>> {
  const dir = fileURLToPath(new URL('../src/', import.meta.url));
  const filer = new Map<string, string>();
  for (const fil of readdirSync(dir, { recursive: true })) {
    if (typeof fil === 'string' && fil.endsWith('.ts')) filer.set(fil.split('\\').join('/'), await readFile(`${dir}/${fil}`, 'utf8'));
  }
  return filer;
}

/** Var namnen som känner lagringen får stå (helt ord, sökvägen i src). */
const LAGRINGSNAMN: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['RECEIPT_FILES_DIR', ['config.ts', 'services/objektlagring.ts']],
  ['lagringsrot', ['services/objektlagring.ts']],
  ['RECEIPT_STORAGE_DRIVER', ['config.ts', 'services/objektlagring.ts']],
];
/** Specifikationerna som tjänstelagret inte får importera: bytesen nås bara genom objektlagring(). */
const FILSYSTEMET = ['fs', 'fs/promises', 'node:fs', 'node:fs/promises', 'path', 'node:path'];

/**
 * Bristerna mot lagringsgränsen: ett lagringsnamn utanför sina filer, eller en
 * import av filsystemet i services/receiptFiles.ts. En tom lista betyder att
 * gränsen håller. Kontrollen är en tillåtelselista över filer, aldrig en
 * sökning efter varje sätt att nå disken.
 */
function lagringsgransbrister(kallor: ReadonlyMap<string, string>): string[] {
  const brister: string[] = [];
  for (const [fil, text] of kallor) {
    for (const [namn, tillatna] of LAGRINGSNAMN) {
      if (new RegExp(`\\b${namn}\\b`).test(text) && !tillatna.includes(fil)) brister.push(`${fil} nämner ${namn}`);
    }
  }
  for (const spec of importer(kallor.get('services/receiptFiles.ts') ?? '')) {
    if (FILSYSTEMET.includes(spec)) brister.push(`services/receiptFiles.ts importerar ${spec}`);
  }
  return brister;
}

describe('7.2 lagringsgränsen (FR-15): bara två filer känner lagringsroten', () => {
  it('7.2 G1 tillåtelselistan håller över server/src, och två planterade brott fälls', async () => {
    const kallor = await kodbasen();
    for (const fil of ['services/receiptFiles.ts', 'services/objektlagring.ts', 'config.ts']) {
      expect(kallor.has(fil), fil).toBe(true);
    }
    expect(lagringsgransbrister(kallor)).toEqual([]);

    // Plantering 1: en ny fil som läser lagringsroten ur konfigurationen.
    const medNyFil = new Map(kallor);
    medNyFil.set('services/planterad.ts', 'const rot = config.RECEIPT_FILES_DIR;\n');
    const brister1 = lagringsgransbrister(medNyFil);
    expect(brister1.length, JSON.stringify(brister1)).toBeGreaterThan(0);
    expect(brister1.some((b) => b.includes('services/planterad.ts')), JSON.stringify(brister1)).toBe(true);

    // Plantering 2: tjänstelagret importerar filsystemet.
    const medFilsystem = new Map(kallor);
    medFilsystem.set(
      'services/receiptFiles.ts',
      `${kallor.get('services/receiptFiles.ts')!}import { readFile } from 'node:fs/promises';\n`,
    );
    const brister2 = lagringsgransbrister(medFilsystem);
    expect(brister2.length, JSON.stringify(brister2)).toBeGreaterThan(0);
    expect(brister2.some((b) => b.includes('services/receiptFiles.ts')), JSON.stringify(brister2)).toBe(true);
  });
});

describe('7.2 lagringsvalet (FR-15): valet står uttryckligen i konfigurationen', () => {
  it('7.2 V1 testmiljön kör den lokala lagringen, och fabriken väljer den ur konfigurationen', () => {
    expect(config.RECEIPT_STORAGE_DRIVER).toBe('lokal');
    expect(objektlagring().namn).toBe('lokal');
  });

  it('7.2 V2 valet nämns i exakt config.ts och services/objektlagring.ts', async () => {
    const kallor = await kodbasen();
    const filerMedValet = [...kallor].filter(([, text]) => /\bRECEIPT_STORAGE_DRIVER\b/.test(text)).map(([fil]) => fil).sort();
    expect(filerMedValet).toEqual(['config.ts', 'services/objektlagring.ts']);
  });
});

// Planteringarna bygger på filtyper (en fil där en katalog ska ligga, en
// katalog där ett objekt ska ligga, en länk till sig själv), inte på
// åtkomstbitar — så fäller fallen likadant för varje användare som kör sviten.
describe('7.2 lagringsfelen (FR-15): varje fel namnger lagringen och visar aldrig sökvägen', () => {
  let user: TestUser;
  let companyId: string;

  const auth = () => ({ Authorization: `Bearer ${user.token}` });
  const co = () => `/api/companies/${companyId}`;

  // Hjälparna är kopior ur kvittobilagor.test.ts: en testfil exporterar inget.
  function jpeg(bytes: number): Buffer {
    const body = Buffer.alloc(bytes, 0x5a);
    body[0] = 0xff; body[1] = 0xd8; body[2] = 0xff; body[3] = 0xe0;
    return body;
  }

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

  /** Steg 1: en uppladdningslänk för en JPEG av given storlek. */
  async function begarLank(receiptId: string, bytes: number): Promise<{ fileId: string; url: string }> {
    const steg1 = await api.post(`${co()}/actions/create_receipt_upload_url`).set(auth())
      .send({ receipt_id: receiptId, filename: 'kvitto.jpg', mime_type: 'image/jpeg', size_bytes: bytes });
    expect(steg1.status, JSON.stringify(steg1.body)).toBe(200);
    return { fileId: steg1.body.result.file_id, url: sokvag(steg1.body.result.upload_url) };
  }

  /** Steg 1 och 2: bytesen ligger i lagringen, raden står som `uploaded`. */
  async function laddaUpp(receiptId: string, bytes: Buffer): Promise<string> {
    const { fileId, url } = await begarLank(receiptId, bytes.length);
    const steg2 = await api.put(url).set('Content-Type', 'image/jpeg').send(bytes);
    expect(steg2.status, JSON.stringify(steg2.body)).toBe(201);
    return fileId;
  }

  /** Hela trestegssekvensen: raden står som `active`. */
  async function bifoga(receiptId: string, bytes: Buffer): Promise<string> {
    const fileId = await laddaUpp(receiptId, bytes);
    const steg3 = await api.post(`${co()}/actions/confirm_receipt_file`).set(auth()).send({ file_id: fileId });
    expect(steg3.status, JSON.stringify(steg3.body)).toBe(200);
    expect(steg3.body.result.status).toBe('active');
    return fileId;
  }

  async function nyckelFor(fileId: string): Promise<string> {
    return withAdmin(async (admin) => (await admin.query<{ storage_key: string }>(
      'SELECT storage_key FROM receipt_files WHERE id = $1', [fileId],
    )).rows[0]!.storage_key);
  }

  async function status(fileId: string): Promise<string | undefined> {
    return withAdmin(async (admin) => (await admin.query<{ status: string }>(
      'SELECT status FROM receipt_files WHERE id = $1', [fileId],
    )).rows[0]?.status);
  }

  /** Provet prövar den lokala drivrutinen och får därför känna katalogens form. */
  const objektsokvag = (nyckel: string) => path.join(lagringsrot(), nyckel);

  type Lagringsfel = Error & { status?: unknown; code?: unknown; details?: unknown };

  /** Felet som ett lagringsanrop kastar; provet faller om anropet lyckas. */
  async function felet(anrop: Promise<unknown>): Promise<Lagringsfel> {
    const fel = await anrop.then(() => null, (err: unknown) => err);
    expect(fel, 'lagringsanropet skulle ha kastat').toBeInstanceOf(Error);
    return fel as Lagringsfel;
  }

  /** get_receipt_file_url (200) och sedan GET mot download_url; svaret på GET. */
  async function hamta(fileId: string) {
    const lank = await api.post(`${co()}/actions/get_receipt_file_url`).set(auth()).send({ file_id: fileId });
    expect(lank.status, JSON.stringify(lank.body)).toBe(200);
    const res = await api.get(sokvag(lank.body.result.download_url));
    return res;
  }

  /** Driftloggens rader (console.error) medan anropet körs; spionen tas alltid bort. */
  async function driftlogg<T>(anrop: () => PromiseLike<T>): Promise<{ svar: T; rader: unknown[][] }> {
    const logg = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const svar = await anrop();
      return { svar, rader: logg.mock.calls.map((rad) => [...rad]) };
    } finally {
      logg.mockRestore();
    }
  }

  /**
   * Exakt en rad i driftloggen, byggd av bara koder: lagringen, operationen,
   * svarets kod och Node-felets kod — aldrig sökvägen eller Node-felets message.
   */
  function enLoggrad(rader: unknown[][], operation: string, kod: string, nodkod: string): void {
    expect(JSON.stringify(rader)).not.toContain(lagringsrot());
    expect(rader).toEqual([['[objektlagring] lagringsfel', 'lokal', operation, kod, nodkod]]);
  }

  beforeAll(async () => {
    user = await registerUser('lagringsfel');
    companyId = await createCompany(user.token, 'Lagringsfel AB');
    await createFiscalYear(companyId, auth(), {
      label: '2026', start_date: '2026-01-01', end_date: '2026-12-31',
    });
  });

  it('7.2 L1 skrivningen blockerad: 503 storage_unavailable (skriv), raden kvar som awaiting_upload, och samma länk fungerar efteråt', async () => {
    const receiptId = await skapaKvitto('L1 blockerad skrivning');
    const { fileId, url } = await begarLank(receiptId, 6_000);
    await mkdir(lagringsrot(), { recursive: true });
    // Bolagets katalog är en vanlig fil: mkdir i skriv kan inte skapa den.
    const blockering = path.join(lagringsrot(), companyId.toLowerCase());
    await writeFile(blockering, 'ingen katalog');
    try {
      const { svar: put, rader: putRader } = await driftlogg(
        () => api.put(url).set('Content-Type', 'image/jpeg').send(jpeg(6_000)),
      );
      expect(put.status, JSON.stringify(put.body)).toBe(503);
      expect(put.body.error).toBe('storage_unavailable');
      expect(put.body.details).toEqual({ lagring: 'lokal', operation: 'skriv' });
      expect(JSON.stringify(put.body)).not.toContain(lagringsrot());
      enLoggrad(putRader, 'skriv', 'storage_unavailable', 'EEXIST');
      expect(await status(fileId)).toBe('awaiting_upload');

      const skriv = await driftlogg(
        () => felet(objektlagring().skriv(nyLagringsnyckel(companyId, randomUUID(), 'jpg'), jpeg(6_000))),
      );
      expect(skriv.svar).toMatchObject({ status: 503, code: 'storage_unavailable' });
      expect(skriv.svar.message).not.toContain(lagringsrot());
      enLoggrad(skriv.rader, 'skriv', 'storage_unavailable', 'EEXIST');

      // Under blockeringen kan objektets plats inte finnas (ENOTDIR). storlek och
      // las svarar då likadant: objektet saknas.
      const underBlockeringen = nyLagringsnyckel(companyId, randomUUID(), 'jpg');
      const storlek = await driftlogg(() => objektlagring().storlek(underBlockeringen));
      expect(storlek.svar).toBeNull();
      expect(storlek.rader).toEqual([]);
      const las = await driftlogg(() => felet(objektlagring().las(underBlockeringen)));
      expect(las.svar).toMatchObject({ status: 409, code: 'object_missing', details: { lagring: 'lokal' } });
      enLoggrad(las.rader, 'las', 'object_missing', 'ENOTDIR');
    } finally {
      await rm(blockering, { force: true });
    }

    const igen = await api.put(url).set('Content-Type', 'image/jpeg').send(jpeg(6_000));
    expect(igen.status, JSON.stringify(igen.body)).toBe(201);
    const bekraftad = await api.post(`${co()}/actions/confirm_receipt_file`).set(auth()).send({ file_id: fileId });
    expect(bekraftad.status, JSON.stringify(bekraftad.body)).toBe(200);
    expect(bekraftad.body.result.status).toBe('active');
  });

  it('7.2 L2 objektet är en katalog vid bekräftelsen: 409 object_missing, raden kvar som uploaded', async () => {
    const receiptId = await skapaKvitto('L2 katalog i stället för objekt');
    const fileId = await laddaUpp(receiptId, jpeg(6_000));
    const objekt = objektsokvag(await nyckelFor(fileId));
    await rm(objekt);
    await mkdir(objekt);

    const { svar: res, rader } = await driftlogg(
      () => api.post(`${co()}/actions/confirm_receipt_file`).set(auth()).send({ file_id: fileId }),
    );
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(res.body.error).toBe('object_missing');
    // Samma form som object_missing ur las: lagringens namn i details.
    expect(res.body.details).toEqual({ lagring: 'lokal' });
    // storlek svarade null utan något Node-fel, så felkoden är tom ('-').
    enLoggrad(rader, 'storlek', 'object_missing', '-');
    expect(await status(fileId)).toBe('uploaded');
  });

  it('7.2 L3 objektet är en katalog vid nedladdningen: 503 storage_unavailable (las) utan sökväg', async () => {
    const receiptId = await skapaKvitto('L3 katalog vid nedladdning');
    const fileId = await bifoga(receiptId, jpeg(6_000));
    const nyckel = await nyckelFor(fileId);
    await rm(objektsokvag(nyckel));
    await mkdir(objektsokvag(nyckel));

    const { svar: res, rader } = await driftlogg(() => hamta(fileId));
    expect(res.status, JSON.stringify(res.body)).toBe(503);
    expect(res.body.error).toBe('storage_unavailable');
    expect(res.body.details).toEqual({ lagring: 'lokal', operation: 'las' });
    expect(JSON.stringify(res.body)).not.toContain(lagringsrot());
    enLoggrad(rader, 'las', 'storage_unavailable', 'EISDIR');

    const las = await driftlogg(() => felet(objektlagring().las(nyckel)));
    expect(las.svar).toMatchObject({ status: 503, code: 'storage_unavailable' });
    expect(las.svar.message).not.toContain(lagringsrot());
    enLoggrad(las.rader, 'las', 'storage_unavailable', 'EISDIR');
  });

  it('7.2 L4 objektet borttaget vid nedladdningen: 409 object_missing som namnger lagringen', async () => {
    const receiptId = await skapaKvitto('L4 borttaget objekt');
    const fileId = await bifoga(receiptId, jpeg(6_000));
    await rm(objektsokvag(await nyckelFor(fileId)));

    // Ett försvunnet objekt för en bekräftad bilaga lämnar ett spår i driften.
    const { svar: res, rader } = await driftlogg(() => hamta(fileId));
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(res.body.error).toBe('object_missing');
    expect(res.body.details).toEqual({ lagring: 'lokal' });
    enLoggrad(rader, 'las', 'object_missing', 'ENOENT');
  });

  it('7.2 L5 ingen överskrivning: andra skrivningen av samma nyckel ger 409 object_exists, och de första bytesen ligger kvar', async () => {
    const nyckel = nyLagringsnyckel(companyId, randomUUID(), 'jpg');
    const a = jpeg(6_000);
    const b = Buffer.alloc(6_000, 0x11);
    await objektlagring().skriv(nyckel, a);

    const { svar: fel, rader } = await driftlogg(() => felet(objektlagring().skriv(nyckel, b)));
    expect(fel).toMatchObject({ status: 409, code: 'object_exists' });
    expect(fel.details).toEqual({ lagring: 'lokal' });
    enLoggrad(rader, 'skriv', 'object_exists', 'EEXIST');
    expect((await objektlagring().las(nyckel)).equals(a)).toBe(true);
  });

  it('7.2 L6 objektet går inte att läsa av vid bekräftelsen: 503 storage_unavailable (storlek), raden kvar som uploaded', async () => {
    const receiptId = await skapaKvitto('L6 länk till sig själv');
    const fileId = await laddaUpp(receiptId, jpeg(6_000));
    const nyckel = await nyckelFor(fileId);
    const objekt = objektsokvag(nyckel);
    await rm(objekt);
    await symlink(objekt, objekt);
    try {
      const { svar: res, rader } = await driftlogg(
        () => api.post(`${co()}/actions/confirm_receipt_file`).set(auth()).send({ file_id: fileId }),
      );
      expect(res.status, JSON.stringify(res.body)).toBe(503);
      expect(res.body.error).toBe('storage_unavailable');
      expect(res.body.details).toEqual({ lagring: 'lokal', operation: 'storlek' });
      expect(JSON.stringify(res.body)).not.toContain(lagringsrot());
      enLoggrad(rader, 'storlek', 'storage_unavailable', 'ELOOP');
      expect(await status(fileId)).toBe('uploaded');

      const storlek = await driftlogg(() => felet(objektlagring().storlek(nyckel)));
      expect(storlek.svar).toMatchObject({ status: 503, code: 'storage_unavailable' });
      expect(storlek.svar.message).not.toContain(lagringsrot());
      enLoggrad(storlek.rader, 'storlek', 'storage_unavailable', 'ELOOP');
    } finally {
      await rm(objekt, { force: true });
    }
  });

  it('7.2 L7 städningen är tyst: radera löser sig för ett saknat objekt och för en katalog (regression)', async () => {
    const saknas = nyLagringsnyckel(companyId, randomUUID(), 'jpg');
    const katalog = nyLagringsnyckel(companyId, randomUUID(), 'jpg');
    await mkdir(objektsokvag(katalog), { recursive: true });

    const { rader } = await driftlogg(async () => {
      await expect(objektlagring().radera(saknas)).resolves.toBeUndefined();
      await expect(objektlagring().radera(katalog)).resolves.toBeUndefined();
    });
    expect(rader).toEqual([]);
  });

  it('7.2 L8 en skrivning som faller mitt i lämnar ingen halv fil: 503 storage_unavailable (skriv), och samma nyckel går att skriva igen', async () => {
    // Full disk eller ett I/O-fel mitt i skrivningen går inte att plantera med
    // filtyper. En datakälla som faller efter första biten tar samma väg genom
    // Node: wx har skapat filen, bytes är skrivna, och sedan faller skrivningen.
    // Felet bär en sökväg i message, som Node-felen gör.
    const a = jpeg(6_000);
    const fall = [
      { nodfel: 'EIO', loggad: 'EIO' },
      // En kod som inte är en felkod (här en sökväg) förs aldrig vidare.
      { nodfel: path.join(lagringsrot(), 'ENOSPC'), loggad: 'okänd' },
    ];
    for (const { nodfel, loggad } of fall) {
      const nyckel = nyLagringsnyckel(companyId, randomUUID(), 'jpg');
      function* fallerMittI(): Generator<Buffer> {
        yield a.subarray(0, 3_000);
        throw Object.assign(new Error(`${nodfel}: write '${objektsokvag(nyckel)}'`), { code: nodfel });
      }

      const { svar: fel, rader } = await driftlogg(
        () => felet(objektlagring().skriv(nyckel, fallerMittI() as unknown as Buffer)),
      );
      expect(fel, nodfel).toMatchObject({ status: 503, code: 'storage_unavailable' });
      expect(fel.details, nodfel).toEqual({ lagring: 'lokal', operation: 'skriv' });
      expect(fel.message, nodfel).not.toContain(lagringsrot());
      enLoggrad(rader, 'skriv', 'storage_unavailable', loggad);
      // Den halva filen är borta, så ett nytt försök vägras inte med object_exists.
      expect(await objektlagring().storlek(nyckel), nodfel).toBeNull();

      await objektlagring().skriv(nyckel, a);
      expect((await objektlagring().las(nyckel)).equals(a), nodfel).toBe(true);
    }
  });
});
