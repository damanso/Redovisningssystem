// Story 3.3 (FR-11, FR-18, B-11): fryst registertext, versionsbunden kö och
// kvittens genom samma transaktioner och åtgärder som produkten. Riktigt schema.
import { createHash, randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { ACTIONS } from '../src/actions/registry.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import type { PoolClient } from 'pg';
import supertest from 'supertest';
import { loadMigrations } from '../src/db/migrate.js';
import { withTenantTransaction } from '../src/db/tx.js';
import { BASELINEKOLUMNER } from '../src/lib/baselinekolumner.js';
import { app, api, registerUser, createCompany, createFiscalYear, withAdmin, type TestUser } from './helpers.js';
import { importeraOchGodkann } from './uppdragImportHelper.js';
import { LEVERANSKONTRAKT_NVR001 } from './fixtures/leveranskontrakt-nvr-001.js';
import {
  REGISTERKOPIA_TEXT, renderaRegisterkopia, registerkopiansHash, lasLeverabelregister, type Registerkopierad,
} from '../src/services/uppdragRegister.js';

import { koaRegisterkopia, listaReferenser, skapaReferens } from '../src/services/uppdragReferens.js';

const FRYST = '2026-11-26 21:30';
const RADER: Registerkopierad[] = [
  { kod: 'L1', namn: 'Första', status: 'ej_paborjad', klausul: 'Ord | ord\nNästa',
    acceptanskriterium: 'Klart', uppfoljningsmatt: 'Antal', matt_lasvag: 'Registret' },
  { kod: 'L2', namn: null, status: 'pagar', klausul: null,
    acceptanskriterium: null, uppfoljningsmatt: null, matt_lasvag: null },
];
const INDATA = { projektnamn: 'Testprojekt', registerversion: 3, fryst: FRYST, rader: RADER };

describe('Kopians text och hash', () => {
  it('R1 samma indata ger samma text och sha256 i UTF-8', () => {
    const text = renderaRegisterkopia(INDATA);
    expect(renderaRegisterkopia(INDATA)).toBe(text);
    expect(registerkopiansHash(text)).toBe(createHash('sha256').update(text, 'utf8').digest('hex'));
    expect(registerkopiansHash(text)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('R2 huvud, frystid, celler och ordning utan skrivtid', () => {
    const text = renderaRegisterkopia(INDATA);
    expect(text.startsWith(`# ${REGISTERKOPIA_TEXT.rubrik.replace('{projekt}', INDATA.projektnamn)}\n`)).toBe(true);
    expect(text).toContain(`> ${REGISTERKOPIA_TEXT.derivat}\n`);
    expect(text).toContain(`> ${REGISTERKOPIA_TEXT.version.replace('{n}', '3').replace('{tid}', FRYST)}\n`);
    const rader = text.trimEnd().split('\n');
    expect(rader.slice(-4)).toEqual([
      `| ${REGISTERKOPIA_TEXT.kolumner.join(' | ')} |`,
      '|---|---|---|---|---|---|',
      '| L1 | ej_paborjad | Ord \\| ord Nästa | Klart | Antal | Registret |',
      '| L2 | pagar |  |  |  |  |',
    ]);
    expect(text.endsWith('\n')).toBe(true);
    expect(text).not.toContain('Skriven');
  });

  it('R3 status och version ingår i hashen', () => {
    const hash = registerkopiansHash(renderaRegisterkopia(INDATA));
    expect(registerkopiansHash(renderaRegisterkopia({ ...INDATA, registerversion: 4 }))).not.toBe(hash);
    expect(registerkopiansHash(renderaRegisterkopia({ ...INDATA,
      rader: [{ ...RADER[0]!, status: 'pagar' }, RADER[1]!] }))).not.toBe(hash);
  });
});

const DRIVE_ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456';
let user: TestUser;
let companyId: string;
let agentToken: string;
let ua: ReturnType<typeof supertest.agent>;
const auth = () => ({ Authorization: `Bearer ${user.token}` });
const agent = () => ({ Authorization: `Bearer ${agentToken}` });
const co = () => `/api/companies/${companyId}`;
const tx = <T>(fn: (c: PoolClient) => Promise<T>) => withTenantTransaction(user.userId, companyId, fn);
async function act(namn: string, kropp: Record<string, unknown>, headers = auth()) {
  return api.post(`${co()}/actions/${namn}`).set(headers).send(kropp);
}
async function ok(namn: string, kropp: Record<string, unknown>, headers = auth()) {
  const r = await act(namn, kropp, headers);
  expect(r.status, `${namn}: ${JSON.stringify(r.body)}`).toBe(200);
  return r.body.result;
}
async function nyttUppdrag(namn: string) {
  const projekt = await ok('create_project', { name: `Uppdrag ${namn}` });
  const svar = await ok('skapa_uppdrag', { project_id: projekt.id,
    name: `Leveranskontrakt ${namn}`, signed_date: '2026-09-03' });
  return { projektId: projekt.id as string, contractId: svar.contract_id as string, projektnamn: `Uppdrag ${namn}` };
}
async function importerat(namn: string) {
  const u = await nyttUppdrag(namn);
  await importeraOchGodkann(companyId, auth(), { contract_id: u.contractId, kontraktstext: LEVERANSKONTRAKT_NVR001 });
  return u;
}
interface Version {
  id: string; company_id: string; contract_id: string; registerversion: number;
  innehall: string; rader: Registerkopierad[]; registerhash: string; skapad_nar: Date; fryst: string;
}
interface KoRad {
  id: string; contract_id: string; extern_id: string; ko_status: string | null; ko_fel: string | null;
  registerkopia_id: string | null; registerhash: string | null; forsok: number; status: string;
}
const kopieposter = (avtal: string) => withAdmin(async (c) => (await c.query<KoRad>(
  "SELECT * FROM uppdrag_referens WHERE company_id=$1 AND contract_id=$2 AND extern_nyckel='registerkopia' ORDER BY created_at, id",
  [companyId, avtal],
)).rows);
const versioner = (avtal: string) => withAdmin(async (c) => (await c.query<Version>(
  `SELECT *, to_char(skapad_nar AT TIME ZONE 'Europe/Stockholm', 'YYYY-MM-DD HH24:MI') AS fryst
     FROM uppdrag_registerkopia WHERE company_id=$1 AND contract_id=$2 ORDER BY registerversion`, [companyId, avtal],
)).rows);
async function frysDirekt(avtal: string, version = 1) {
  return withAdmin(async (c) => (await c.query<Version>(
    `INSERT INTO uppdrag_registerkopia (company_id, contract_id, registerversion, innehall, rader, registerhash)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6) RETURNING *`,
    [companyId, avtal, version, 'Fryst text', JSON.stringify(RADER), registerkopiansHash('Fryst text')],
  )).rows[0]!);
}
async function kopostDirekt(avtal: string, version: Version | null, id = DRIVE_ID,
  hash: string | null = version?.registerhash ?? null, status = 'koad') {
  return withAdmin(async (c) => (await c.query<KoRad>(
    `INSERT INTO uppdrag_referens (company_id, contract_id, sort, extern_id, extern_nyckel, extern_kalla,
      registerkopia_id, registerhash, ko_status, ko_fel) VALUES ($1,$2,'drive',$3,'registerkopia','drive:sparrmapp',$4,$5,$6,$7) RETURNING *`,
    [companyId, avtal, id, version?.id ?? null, hash, status, status === 'fel' ? 'gammalt fel' : null],
  )).rows[0]!);
}
beforeAll(async () => {
  user = await registerUser('registerkopia');
  companyId = await createCompany(user.token, 'Registerkopian AB');
  await createFiscalYear(companyId, auth(), { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });
  const tok = await api.post(`${co()}/agent-tokens`).set(auth()).send({ name: 'Svepet' });
  expect(tok.status, JSON.stringify(tok.body)).toBe(201);
  agentToken = tok.body.token;
  ua = supertest.agent(app);
  const login = await ua.post('/app/login').type('form').send({ email: user.email, password: 'mycket-hemligt-losen-123' });
  expect([302, 303]).toContain(login.status);
});

describe('Migrationens skydd', () => {
  it('M1 kolumner, typer och försökens standard', async () => {
    const kol = await withAdmin(async (c) => (await c.query(
      `SELECT table_name, column_name, data_type, is_nullable, column_default FROM information_schema.columns
        WHERE table_schema='public' AND table_name IN ('uppdrag_registerkopia','uppdrag_referens')`,
    )).rows);
    for (const [column_name, data_type] of Object.entries({ id: 'uuid', company_id: 'uuid', contract_id: 'uuid', registerversion: 'integer', innehall: 'text',
      rader: 'jsonb', registerhash: 'text', skapad_nar: 'timestamp with time zone' })) {
      expect(kol).toContainEqual(expect.objectContaining({ table_name: 'uppdrag_registerkopia', column_name, data_type, is_nullable: 'NO' }));
    }
    for (const [column_name, data_type] of Object.entries({ registerkopia_id: 'uuid', registerhash: 'text', forsok: 'integer' })) {
      expect(kol).toContainEqual(expect.objectContaining({ table_name: 'uppdrag_referens', column_name, data_type }));
    }
    expect(kol.find((k) => k.table_name === 'uppdrag_referens' && k.column_name === 'forsok'))
      .toMatchObject({ is_nullable: 'NO', column_default: '0' });
  });
  it('M2 fryst historik utan baselinekolumner', async () => {
    const r = await withAdmin(async (c) => ({
      kommentar: (await c.query("SELECT obj_description('uppdrag_registerkopia'::regclass) AS text")).rows[0].text,
      kol: (await c.query("SELECT column_name FROM information_schema.columns WHERE table_name='uppdrag_registerkopia'")).rows.map((r) => r.column_name),
    }));
    expect(r.kommentar).toMatch(/^Kategori: FRYST HISTORIK[,.;]/);
    expect(r.kol).toContain('innehall');
    expect(r.kol.filter((k) => (BASELINEKOLUMNER as readonly string[]).includes(k))).toEqual([]);
  });
  it('M3 append-only, RLS, FK och avslutstrigger', async () => {
    const skydd = await withAdmin(async (c) => ({
      verb: (await c.query(`SELECT v, has_table_privilege('app','uppdrag_registerkopia',v) AS tillatet
        FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE']) v`)).rows,
      rls: (await c.query("SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid='uppdrag_registerkopia'::regclass")).rows[0],
      policy: (await c.query("SELECT cmd, qual, with_check FROM pg_policies WHERE tablename='uppdrag_registerkopia' ORDER BY cmd")).rows,
      trigger: (await c.query("SELECT tgname FROM pg_trigger WHERE tgrelid='uppdrag_registerkopia'::regclass AND NOT tgisinternal")).rows,
      fk: (await c.query("SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid='uppdrag_registerkopia'::regclass AND conname='uppdrag_registerkopia_contract_fk'")).rows[0],
    }));
    expect(skydd.verb).toEqual([{ v: 'SELECT', tillatet: true }, { v: 'INSERT', tillatet: true },
      { v: 'UPDATE', tillatet: false }, { v: 'DELETE', tillatet: false }]);
    expect(skydd.rls).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
    expect(skydd.policy.map((p) => p.cmd)).toEqual(['INSERT', 'SELECT']);
    for (const p of skydd.policy) expect(p.qual ?? p.with_check).toContain('app_has_company_access(company_id)');
    expect(skydd.trigger).toContainEqual({ tgname: 'uppdrag_registerkopia_vagrar_avslutat' });
    expect(skydd.fk.def).toContain('FOREIGN KEY (contract_id, company_id) REFERENCES contracts(id, company_id)');
    const u = await nyttUppdrag('M3');
    await frysDirekt(u.contractId);
    const fore = await versioner(u.contractId);
    await expect(tx((c) => c.query("UPDATE uppdrag_registerkopia SET innehall='Annat' WHERE company_id=$1 AND contract_id=$2", [companyId, u.contractId]))).rejects.toThrow(/permission denied/);
    await expect(tx((c) => c.query('DELETE FROM uppdrag_registerkopia WHERE company_id=$1 AND contract_id=$2', [companyId, u.contractId]))).rejects.toThrow(/permission denied/);
    expect(await versioner(u.contractId)).toEqual(fore);
    const granne = await registerUser('registerkopia-granne');
    const bolag = await createCompany(granne.token, 'Grannen AB');
    expect(await withTenantTransaction(granne.userId, bolag, async (c) =>
      (await c.query('SELECT id FROM uppdrag_registerkopia WHERE company_id=$1', [companyId])).rows)).toEqual([]);
    await withAdmin((c) => c.query("UPDATE projects SET status='closed' WHERE id=$1 AND company_id=$2", [u.projektId, companyId]));
    await expect(frysDirekt(u.contractId, 2)).rejects.toThrow(/avslutat/);
  });
  it('M4 version, hashkoppling, par, form, försök och köläge bärs av databasen', async () => {
    const u = await nyttUppdrag('M4');
    const v = await frysDirekt(u.contractId);
    await expect(frysDirekt(u.contractId)).rejects.toThrow(/uppdrag_registerkopia_version_uk/);
    await expect(kopostDirekt(u.contractId, v, DRIVE_ID, 'b'.repeat(64))).rejects.toThrow(/uppdrag_referens_registerkopia_fk/);
    await expect(kopostDirekt(u.contractId, v, DRIVE_ID, null)).rejects.toThrow(/uppdrag_referens_kopia_par/);
    const k = await kopostDirekt(u.contractId, v);
    await expect(kopostDirekt(u.contractId, v)).rejects.toThrow(/uppdrag_referens_en_kopost_per_version/);
    await withAdmin((c) => c.query("UPDATE uppdrag_referens SET ko_status='ersatt' WHERE id=$1", [k.id]));
    await expect(withAdmin((c) => c.query("UPDATE uppdrag_referens SET ko_status='kanske' WHERE id=$1", [k.id]))).rejects.toThrow(/uppdrag_referens_ko_status_check/);
    await expect(withAdmin((c) => c.query('UPDATE uppdrag_referens SET forsok=-1 WHERE id=$1', [k.id]))).rejects.toThrow(/uppdrag_referens_forsok_check/);
    await expect(withAdmin((c) => c.query("UPDATE uppdrag_referens SET sort='mejl' WHERE id=$1", [k.id]))).rejects.toThrow(/uppdrag_referens_kopia_form/);
  });
  it('M6 samma fil i flera versioner, men vanliga referenser är fortfarande unika', async () => {
    const u = await nyttUppdrag('M6');
    const vanlig = () => withAdmin((c) => c.query(`INSERT INTO uppdrag_referens (company_id,contract_id,sort,extern_id)
      VALUES ($1,$2,'drive','vanlig-fil')`, [companyId, u.contractId]));
    await vanlig();
    await expect(vanlig()).rejects.toThrow(/uppdrag_referens_uk/);
    for (const nr of [1, 2]) await kopostDirekt(u.contractId, await frysDirekt(u.contractId, nr));
    expect((await kopieposter(u.contractId)).map((k) => k.extern_id)).toEqual([DRIVE_ID, DRIVE_ID]);
  });
});

describe('M5 migrationen på befintliga rader', () => {
  let db: pg.Client | undefined;
  let skapad = false;
  const maintenance = async (sql: string) => {
    const c = new pg.Client({ connectionString: process.env.MAINTENANCE_DATABASE_URL });
    await c.connect();
    try { await c.query(sql); } finally { await c.end(); }
  };
  afterAll(async () => {
    if (db) await db.end();
    if (skapad) await maintenance('DROP DATABASE IF EXISTS redovisning_test_registerkopia WITH (FORCE)');
  });
  it('M5 bevarar alla gamla värden och är idempotent', async () => {
    const kedja = await loadMigrations();
    const migration = kedja.find((m) => m.name === 'registerkopia');
    expect(migration, 'migration registerkopia saknas').toBeDefined();
    if (!migration) throw new Error('migration registerkopia saknas');
    await maintenance('DROP DATABASE IF EXISTS redovisning_test_registerkopia WITH (FORCE)');
    await maintenance('CREATE DATABASE redovisning_test_registerkopia');
    skapad = true;
    const url = new URL(process.env.DATABASE_ADMIN_URL!);
    url.pathname = '/redovisning_test_registerkopia';
    db = new pg.Client({ connectionString: url.toString() });
    await db.connect();
    for (const m of kedja.filter((m) => m.version < migration.version)) await db.query(m.sql);
    const uid = (await db.query("INSERT INTO users (email,password_hash,name) VALUES ('kopia@exempel.se','x','Kopia') RETURNING id")).rows[0].id;
    const cid = (await db.query("INSERT INTO companies (name,org_number) VALUES ('Kopia AB','556000-0001') RETURNING id")).rows[0].id;
    const kund = (await db.query("INSERT INTO customers (company_id,customer_number,name) VALUES ($1,1,'Kunden') RETURNING id", [cid])).rows[0].id;
    for (const nr of [1, 2, 3]) {
      const pid = (await db.query('INSERT INTO projects (company_id,customer_id,number,name) VALUES ($1,$2,$3,$4) RETURNING id', [cid, kund, nr, `P${nr}`])).rows[0].id;
      const aid = (await db.query("INSERT INTO contracts (company_id,project_id,name,created_by) VALUES ($1,$2,'Avtal',$3) RETURNING id", [cid, pid, uid])).rows[0].id;
      await db.query(`INSERT INTO uppdrag_referens (company_id,contract_id,sort,extern_id,extern_nyckel,ko_status,ko_fel)
        VALUES ($1,$2,'drive',$3,$4,$5,$6)`, [cid, aid, nr === 1 ? `registerkopia:${aid}` : `${DRIVE_ID}-${nr}`,
        nr < 3 ? 'registerkopia' : 'fil', nr === 1 ? 'fel' : nr === 2 ? 'skriven' : null, nr === 1 ? 'gammalt fel' : null]);
    }
    const fore = (await db.query('SELECT * FROM uppdrag_referens ORDER BY id')).rows;
    const katalog = async () => ({
      villkor: (await db!.query("SELECT conname,pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid IN ('uppdrag_registerkopia'::regclass,'uppdrag_referens'::regclass) ORDER BY conname")).rows,
      index: (await db!.query("SELECT indexname,indexdef FROM pg_indexes WHERE tablename IN ('uppdrag_registerkopia','uppdrag_referens') ORDER BY indexname")).rows,
    });
    await db.query(migration.sql);
    const efter = (await db.query('SELECT * FROM uppdrag_referens ORDER BY id')).rows;
    expect(efter).toEqual(fore.map((r) => ({ ...r, registerkopia_id: null, registerhash: null, forsok: 0 })));
    const skydd = await katalog();
    await db.query(migration.sql);
    expect((await db.query('SELECT * FROM uppdrag_referens ORDER BY id')).rows).toEqual(efter);
    expect(await katalog()).toEqual(skydd);
  }, 60_000);
});

const paborja = (avtal: string) => ok('paborja_leverabel', { contract_id: avtal, leverabel_kod: 'L1' });
const rapport = (post: KoRad, utfall: Record<string, unknown>) => ok('rapportera_drive_kopia', { referens_id: post.id, utfall });
async function gammalKo(namn: string) {
  const u = await nyttUppdrag(namn);
  await withAdmin((c) => c.query(`INSERT INTO uppdrag_leverabel (company_id,contract_id,kod,uppfoljningsmatt,matt_lasvag)
    VALUES ($1,$2,'L1','Antal','redovisning')`, [companyId, u.contractId]));
  const k = await kopostDirekt(u.contractId, null, `registerkopia:${u.contractId}`, null, 'fel');
  return { ...u, k };
}

describe('Köningen fryser ändringen', () => {
  it('K1 importens första version, text, hash och referens i samma transaktion', async () => {
    const u = await importerat('K1');
    const v = await versioner(u.contractId);
    expect(v).toHaveLength(1);
    const rad = v[0]!;
    const register = await tx((c) => lasLeverabelregister(c, companyId, { contract_id: u.contractId }));
    const frysta = register.map(({ kod, namn, status, klausul, acceptanskriterium, uppfoljningsmatt, matt_lasvag }) =>
      ({ kod, namn, status, klausul, acceptanskriterium, uppfoljningsmatt, matt_lasvag }));
    expect(rad.rader).toEqual(frysta);
    expect(rad.rader).toHaveLength(6);
    expect(rad.innehall).toBe(renderaRegisterkopia({ projektnamn: u.projektnamn, registerversion: 1, fryst: rad.fryst, rader: frysta }));
    expect(rad.registerhash).toBe(registerkopiansHash(rad.innehall));
    expect(await kopieposter(u.contractId)).toEqual([expect.objectContaining({ registerkopia_id: rad.id,
      registerhash: rad.registerhash, forsok: 0, ko_status: 'koad', status: 'overifierad', extern_id: `registerkopia:${u.contractId}` })]);
  });
  it('K2 ändring ger ny version och lämnar hela föregångaren orörd', async () => {
    const u = await importerat('K2');
    const fore = await versioner(u.contractId);
    const ko = await kopieposter(u.contractId);
    await paborja(u.contractId);
    const efter = await versioner(u.contractId);
    expect(efter.map((v) => v.registerversion)).toEqual([1, 2]);
    expect(efter[0]).toEqual(fore[0]);
    expect((await kopieposter(u.contractId)).find((k) => k.id === ko[0]!.id)).toEqual(ko[0]);
    expect(efter[0]!.rader.find((r) => r.kod === 'L1')!.status).toBe('ej_paborjad');
    expect(efter[1]!.rader.find((r) => r.kod === 'L1')!.status).toBe('pagar');
  });
  it('K3 avvisad import fryser inget, lyckad import fryser en version', async () => {
    const p = await ok('create_project', { name: 'Utan signatur K3' });
    const a = await ok('create_contract', { project_id: p.id, name: 'Utkast' });
    const res = await act('importera_leveranskontrakt', { contract_id: a.id, kontraktstext: LEVERANSKONTRAKT_NVR001 });
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect(res.body.error).toBe('valid_from_required');
    expect(await versioner(a.id)).toEqual([]);
    expect(await kopieposter(a.id)).toEqual([]);
    const u = await importerat('K3 kontroll');
    const v = await versioner(u.contractId);
    expect(v).toHaveLength(1);
    expect(await kopieposter(u.contractId)).toEqual([expect.objectContaining({ registerkopia_id: v[0]!.id })]);
  });
  it('K4 samtidiga köningar efter delade FK-lås ger två löpnummer utan dödläge', async () => {
    const u = await importerat('K4');
    let antal = 0;
    let slapp!: () => void;
    const bada = new Promise<void>((resolve) => { slapp = resolve; });
    const kor = () => tx(async (c) => {
      await c.query('SELECT 1 FROM contracts WHERE id=$1 AND company_id=$2 FOR KEY SHARE', [u.contractId, companyId]);
      if (++antal === 2) slapp();
      await bada;
      return koaRegisterkopia(c, companyId, u.contractId);
    });
    await Promise.all([kor(), kor()]);
    expect((await versioner(u.contractId)).map((v) => v.registerversion)).toEqual([1, 2, 3]);
    expect(await kopieposter(u.contractId)).toHaveLength(3);
  });
  it('K5 ny köpost ärver Drive-id och lämnar den skrivna kvar', async () => {
    const u = await importerat('K5');
    const a = (await kopieposter(u.contractId))[0]!;
    expect(a.extern_id).toBe(`registerkopia:${u.contractId}`);
    await rapport(a, { lage: 'skriven', drive_id: DRIVE_ID });
    await paborja(u.contractId);
    const ko = await kopieposter(u.contractId);
    expect(ko).toHaveLength(2);
    expect(ko.find((k) => k.id === a.id)).toMatchObject({ extern_id: DRIVE_ID, ko_status: 'skriven' });
    expect(ko.find((k) => k.id !== a.id)).toMatchObject({ extern_id: DRIVE_ID, ko_status: 'koad' });
    expect((await versioner(u.contractId)).map((v) => v.id).sort()).toEqual(ko.map((k) => k.registerkopia_id).sort());
  });
  it('K6 gammal kö utan version ersätts med felet bevarat vid nästa ändring', async () => {
    const u = await gammalKo('K6');
    await paborja(u.contractId);
    const v = await versioner(u.contractId);
    expect(v.map((r) => r.registerversion)).toEqual([1]);
    const ko = await kopieposter(u.contractId);
    expect(ko.find((k) => k.id === u.k.id)).toMatchObject({ ko_status: 'ersatt', ko_fel: u.k.ko_fel });
    expect(ko.find((k) => k.registerkopia_id === v[0]!.id)).toMatchObject({ ko_status: 'koad' });
  });
});

interface Arbetskopost {
  referens_id: string; contract_id: string; extern_id: string; ko_status: string; ko_fel: string | null;
  forsok: number; registerkopia_id: string; registerversion: number; registerhash: string;
  registertext: string; innehall: Registerkopierad[];
}
const ko = async (avtal: string): Promise<Arbetskopost[]> =>
  (await ok('hamta_drive_ko', {}, agent()) as Arbetskopost[]).filter((k) => k.contract_id === avtal);
const svep = () => ok('kor_uppdragssvep', {});

describe('Arbetslistan läser den frysta versionen', () => {
  it('H1 åtgärdens exakta fält och lagrade text, hash och rader', async () => {
    const u = await importerat('H1');
    const v = (await versioner(u.contractId))[0]!;
    const poster = await ko(u.contractId);
    expect(poster).toHaveLength(1);
    expect(Object.keys(poster[0]!).sort()).toEqual(['referens_id', 'contract_id', 'extern_id', 'ko_status', 'ko_fel',
      'forsok', 'registerkopia_id', 'registerversion', 'registerhash', 'registertext', 'innehall'].sort());
    expect(poster[0]).toMatchObject({ registerkopia_id: v.id, registerversion: v.registerversion,
      registerhash: v.registerhash, registertext: v.innehall, innehall: v.rader, forsok: 0 });
  });
  it('H2 en ändring förbi köningen påverkar registret men aldrig kopieunderlaget', async () => {
    const u = await importerat('H2');
    const fore = await ko(u.contractId);
    await withAdmin((c) => c.query("UPDATE uppdrag_leverabel SET status='pagar' WHERE company_id=$1 AND contract_id=$2 AND kod='L1'", [companyId, u.contractId]));
    const register = await ok('las_leverabelregister', { contract_id: u.contractId });
    expect(register.find((r: Registerkopierad) => r.kod === 'L1').status).toBe('pagar');
    expect(fore[0]!.innehall.find((r) => r.kod === 'L1')!.status).toBe('ej_paborjad');
    expect(await ko(u.contractId)).toEqual(fore);
  });
  it('H3 endast öppna versioner delas ut, aldrig gamla köposter utan version', async () => {
    const oppen = await importerat('H3 koad');
    const fel = await importerat('H3 fel');
    const skriven = await importerat('H3 skriven');
    const ersatt = await importerat('H3 ersatt');
    const gammal = await gammalKo('H3 gammal');
    await rapport((await kopieposter(fel.contractId))[0]!, { lage: 'fel', fel: 'H3 fel' });
    await rapport((await kopieposter(skriven.contractId))[0]!, { lage: 'skriven', drive_id: DRIVE_ID });
    const e = (await kopieposter(ersatt.contractId))[0]!;
    await withAdmin((c) => c.query("UPDATE uppdrag_referens SET ko_status='ersatt' WHERE id=$1", [e.id]));
    expect((await kopieposter(gammal.contractId))[0]).toMatchObject({ ko_status: 'fel', registerkopia_id: null });
    expect((await ko(oppen.contractId))[0]!.ko_status).toBe('koad');
    expect((await ko(fel.contractId))[0]!.ko_status).toBe('fel');
    for (const u of [skriven, ersatt, gammal]) expect(await ko(u.contractId)).toEqual([]);
  });
  it('H4 nya transaktioner efter fel A och ändring B behåller båda versionerna i ordning', async () => {
    const u = await importerat('H4');
    const a = (await versioner(u.contractId))[0]!;
    await rapport((await kopieposter(u.contractId))[0]!, { lage: 'fel', fel: 'A misslyckades' });
    await paborja(u.contractId);
    const s = await svep();
    const poster = (s.arbetslista.drive_ko as Arbetskopost[]).filter((k) => k.contract_id === u.contractId);
    expect(poster.map((k) => k.registerversion)).toEqual([1, 2]);
    expect(poster[0]).toMatchObject({ registertext: a.innehall, registerhash: a.registerhash, ko_status: 'fel' });
    expect(poster[0]!.innehall.find((r) => r.kod === 'L1')!.status).toBe('ej_paborjad');
    expect(poster[1]!.innehall.find((r) => r.kod === 'L1')!.status).toBe('pagar');
    expect(poster[1]!.registerhash).not.toBe(a.registerhash);
  });
  it('H5 regression: cachetömning och svep bevarar historik och versionskoppling', async () => {
    const u = await importerat('H5');
    await rapport((await kopieposter(u.contractId))[0]!, { lage: 'fel', fel: 'A misslyckades' });
    await paborja(u.contractId);
    await svep(); // Fryser också H3:s gamla köpost, före jämförelsen.
    const las = () => withAdmin(async (c) => ({
      versioner: (await c.query('SELECT * FROM uppdrag_registerkopia WHERE company_id=$1 ORDER BY id', [companyId])).rows,
      koppling: (await c.query('SELECT id,registerkopia_id,registerhash,contract_id FROM uppdrag_referens WHERE company_id=$1 ORDER BY id', [companyId])).rows,
      gamla: (await c.query("SELECT id FROM uppdrag_referens WHERE company_id=$1 AND extern_nyckel='registerkopia' AND registerkopia_id IS NULL AND ko_status IN ('koad','fel')", [companyId])).rows,
    }));
    const fore = await las();
    expect(fore.gamla).toEqual([]);
    expect(fore.versioner.length).toBeGreaterThan(0);
    const tabeller = await withAdmin(async (c) => (await c.query<{ namn: string }>(
      `SELECT relname AS namn FROM pg_class WHERE relnamespace='public'::regnamespace
        AND relname LIKE 'uppdrag_%' AND obj_description(oid) LIKE 'Kategori: CACHE%' ORDER BY relname`,
    )).rows.map((r) => r.namn));
    expect(tabeller).toEqual(['uppdrag_dokument', 'uppdrag_dokumentrot', 'uppdrag_svepvarde']);
    await tx(async (c) => {
      for (const tabell of tabeller) {
        expect(tabell).toMatch(/^uppdrag_[a-z_]+$/);
        await c.query(`DELETE FROM "${tabell}" WHERE company_id=$1`, [companyId]);
      }
    });
    await svep();
    expect(await las()).toEqual(fore);
  });
  it('H7 svepet fryser gammal kö en gång och delar ut den nya versionen', async () => {
    const u = await gammalKo('H7');
    expect(await versioner(u.contractId)).toEqual([]);
    const s = await svep();
    expect((await kopieposter(u.contractId)).find((k) => k.id === u.k.id)).toMatchObject({ ko_status: 'ersatt', ko_fel: 'gammalt fel' });
    const v = await versioner(u.contractId);
    expect(v).toHaveLength(1);
    expect(v[0]!.innehall).toContain('L1');
    const poster = (s.arbetslista.drive_ko as Arbetskopost[]).filter((k) => k.contract_id === u.contractId);
    expect(poster).toHaveLength(1);
    expect(poster[0]!.registerkopia_id).toBe(v[0]!.id);
    expect(poster.map((k) => k.referens_id)).not.toContain(u.k.id);
    await svep();
    expect(await versioner(u.contractId)).toEqual(v);
  });
  it('H8 bara den senaste kopieposten listas, och en oskriven verifieras aldrig', async () => {
    const u = await importerat('H8');
    const a = (await kopieposter(u.contractId))[0]!;
    await rapport(a, { lage: 'skriven', drive_id: DRIVE_ID });
    await paborja(u.contractId);
    const b = (await ko(u.contractId))[0]!;
    const ref = await tx((c) => listaReferenser(c, companyId, u.contractId));
    expect(ref.filter((r) => r.extern_nyckel === 'registerkopia')).toEqual([
      expect.objectContaining({ id: b.referens_id, status: 'overifierad' }),
    ]);
    const referenser = (s: Awaited<ReturnType<typeof svep>>) =>
      (s.arbetslista.referenser as { referens_id: string; contract_id: string }[]).filter((r) => r.contract_id === u.contractId);
    expect(referenser(await svep())).toEqual([]);
    await ok('rapportera_drive_kopia', { referens_id: b.referens_id, utfall: { lage: 'skriven', drive_id: DRIVE_ID } });
    expect(referenser(await svep()).map((r) => r.referens_id)).toEqual([b.referens_id]);
  });
  it('H9 regression: stängd lista av åtgärder och ingen driftsida', async () => {
    const namn = ACTIONS.map((a) => a.name);
    const drive = (lista: string[]) => lista.filter((n) => n.includes('drive')).sort();
    expect(drive(namn)).toEqual(['hamta_drive_ko', 'rapportera_drive_kopia']);
    expect(drive([...namn, 'las_drive_ko'])).not.toEqual(drive(namn));
    const text = await readFile(new URL('../src/http/view/routes.ts', import.meta.url), 'utf8');
    const drift = /\.get\(\s*['`][^'`]*\/drift['`]/;
    expect(drift.test(text)).toBe(false);
    expect(drift.test("viewRouter.get('/c/:companyId/drift', x)")).toBe(true);
  });
});

async function versionsrapport(avtal: string, nr: number, utfall: Record<string, unknown>, tillagg: Record<string, unknown> = {}) {
  const v = (await versioner(avtal)).find((v) => v.registerversion === nr)!;
  const k = (await kopieposter(avtal)).find((k) => k.registerkopia_id === v.id)!;
  return act('rapportera_drive_kopia', { referens_id: k.id, registerversion: nr, registerhash: v.registerhash, utfall, ...tillagg });
}
const status = (r: { status: number; body: unknown }, expected: number) => expect(r.status, JSON.stringify(r.body)).toBe(expected);
async function tvaVersioner(namn: string) {
  const u = await importerat(namn);
  await paborja(u.contractId);
  const v = await versioner(u.contractId);
  const k = await kopieposter(u.contractId);
  return { ...u, v, a: k.find((k) => k.registerkopia_id === v[0]!.id)!, b: k.find((k) => k.registerkopia_id === v[1]!.id)! };
}

describe('Kvittensen är versionsbunden och idempotent', () => {
  it('Q1 bara rätt version och hash kvitteras, försöket räknas', async () => {
    const u = await importerat('Q1');
    const res = await versionsrapport(u.contractId, 1, { lage: 'skriven', drive_id: DRIVE_ID });
    status(res, 200);
    expect(res.body.result).toMatchObject({ registerversion: 1, registerhash: (await versioner(u.contractId))[0]!.registerhash, forsok: 1 });
    expect((await kopieposter(u.contractId))[0]).toMatchObject({ extern_id: DRIVE_ID, ko_status: 'skriven', forsok: 1 });
  });
  it('Q2 fel version eller hash ger 409 och lämnar hela köposten orörd', async () => {
    const u = await importerat('Q2');
    const fore = await kopieposter(u.contractId);
    for (const tillagg of [{ registerversion: 2 }, { registerhash: 'c'.repeat(64) }]) {
      const r = await versionsrapport(u.contractId, 1, { lage: 'skriven', drive_id: DRIVE_ID }, tillagg);
      status(r, 409); expect(r.body.error).toBe('kvittens_annan_version');
      expect(await kopieposter(u.contractId)).toEqual(fore);
    }
  });
  it('Q3 kvittens för A lämnar B köad och i arbetslistan', async () => {
    const u = await tvaVersioner('Q3');
    status(await versionsrapport(u.contractId, 1, { lage: 'skriven', drive_id: DRIVE_ID }), 200);
    const k = await kopieposter(u.contractId);
    expect(k.find((k) => k.id === u.a.id)).toMatchObject({ ko_status: 'skriven' });
    expect(k.find((k) => k.id === u.b.id)).toEqual(u.b);
    expect((await ko(u.contractId)).map((k) => k.referens_id)).toEqual([u.b.id]);
  });
  it('Q4 kvittens för B ersätter felad A, bevarar historik och feltext', async () => {
    const u = await tvaVersioner('Q4');
    status(await versionsrapport(u.contractId, 1, { lage: 'fel', fel: 'A misslyckades' }), 200);
    const fore = await versioner(u.contractId);
    status(await versionsrapport(u.contractId, 2, { lage: 'skriven', drive_id: DRIVE_ID }), 200);
    const k = await kopieposter(u.contractId);
    expect(k.find((k) => k.id === u.a.id)).toMatchObject({ ko_status: 'ersatt', ko_fel: 'A misslyckades', forsok: 1 });
    expect(k.find((k) => k.id === u.b.id)).toMatchObject({ ko_status: 'skriven', forsok: 1 });
    expect(await versioner(u.contractId)).toEqual(fore);
    expect(await ko(u.contractId)).toEqual([]);
  });
  it('Q5 upprepad kvittens ändrar inget och kan skickas i svepet', async () => {
    const u = await importerat('Q5');
    const v = (await versioner(u.contractId))[0]!;
    const k = (await kopieposter(u.contractId))[0]!;
    const body = { referens_id: k.id, registerversion: v.registerversion, registerhash: v.registerhash,
      utfall: { lage: 'skriven', drive_id: DRIVE_ID } };
    status(await act('rapportera_drive_kopia', body), 200);
    const fore = await kopieposter(u.contractId);
    status(await act('rapportera_drive_kopia', body), 200);
    expect(await kopieposter(u.contractId)).toEqual(fore);
    const s = await ok('kor_uppdragssvep', { drive_kopior: [body] });
    expect(s.lage).toBe('svep_kort');
    expect(await kopieposter(u.contractId)).toEqual(fore);
  });
  it('Q6 utfall mot ersatt är ofarliga, fel mot skriven fälls utan ändring', async () => {
    const u = await tvaVersioner('Q6');
    status(await versionsrapport(u.contractId, 1, { lage: 'fel', fel: 'A misslyckades' }), 200);
    status(await versionsrapport(u.contractId, 2, { lage: 'skriven', drive_id: DRIVE_ID }), 200);
    const fore = await kopieposter(u.contractId);
    for (const utfall of [{ lage: 'skriven', drive_id: DRIVE_ID }, { lage: 'fel', fel: 'Sent fel' }]) {
      status(await versionsrapport(u.contractId, 1, utfall), 200);
      expect(await kopieposter(u.contractId)).toEqual(fore);
    }
    const r = await versionsrapport(u.contractId, 2, { lage: 'fel', fel: 'Sent fel' });
    status(r, 409); expect(r.body.error).toBe('ingen_oppen_kopost');
    expect(await kopieposter(u.contractId)).toEqual(fore);
  });
  it('Q7 upprepade fel står kvar utan tak, skriven räknar upp och nollställer felet', async () => {
    const u = await importerat('Q7');
    for (const n of [1, 2, 3]) status(await versionsrapport(u.contractId, 1, { lage: 'fel', fel: `Fel ${n}` }), 200);
    expect((await ko(u.contractId))[0]).toMatchObject({ ko_status: 'fel', forsok: 3, ko_fel: 'Fel 3' });
    status(await versionsrapport(u.contractId, 1, { lage: 'skriven', drive_id: DRIVE_ID }), 200);
    expect((await kopieposter(u.contractId))[0]).toMatchObject({ ko_status: 'skriven', forsok: 4, ko_fel: null });
  });
  it('Q8 ofullständiga fält och vanlig referens med samma Drive-id fälls', async () => {
    const u = await importerat('Q8');
    const k = (await kopieposter(u.contractId))[0]!;
    const v = (await versioner(u.contractId))[0]!;
    const fore = await kopieposter(u.contractId);
    for (const tillagg of [{ registerversion: 1 }, { registerhash: v.registerhash }]) {
      const r = await act('rapportera_drive_kopia', { referens_id: k.id, utfall: { lage: 'skriven', drive_id: DRIVE_ID }, ...tillagg });
      status(r, 400); expect(r.body.error).toBe('kvittens_ofullstandig');
      expect(await kopieposter(u.contractId)).toEqual(fore);
    }
    await tx((c) => skapaReferens(c, companyId, { contract_id: u.contractId, sort: 'drive', extern_id: DRIVE_ID,
      extern_nyckel: 'fil', extern_kalla: 'drive:prov' }));
    const r = await versionsrapport(u.contractId, 1, { lage: 'skriven', drive_id: DRIVE_ID });
    status(r, 409); expect(r.body.error).toBe('referens_finns_redan');
    expect(await kopieposter(u.contractId)).toEqual(fore);
  });
});

describe('Köstatusen lämnar Davids vyer', () => {
  let u: Awaited<ReturnType<typeof importerat>>;
  let markor: string;
  let pagarFore: number;
  const antal = (svar: { avtal: { contract_id: string; leverabler: { lage: string; antal: number }[] }[] }) =>
    svar.avtal.find((a) => a.contract_id === u.contractId)!.leverabler.find((l) => l.lage === 'pagar')!.antal;
  beforeAll(async () => {
    u = await importerat('V1 V2');
    pagarFore = antal(await ok('las_uppdragslage', { project_id: u.projektId }));
    markor = `Drive svarade 403: MARKOR-${randomUUID()}`;
    await rapport((await kopieposter(u.contractId))[0]!, { lage: 'fel', fel: markor });
    await paborja(u.contractId);
  });
  it('V1 tre sidor och hela vykällan saknar köstatus och Drive-fel', async () => {
    expect((await ko(u.contractId)).some((k) => k.ko_fel === markor)).toBe(true);
    for (const path of [`/projects/${u.projektId}`, `/projects/${u.projektId}/laget`, '/uppdrag']) {
      const r = await ua.get(`/app/c/${companyId}${path}`);
      expect(r.status, `${path}: ${r.text}`).toBe(200);
      for (const text of [markor, 'Kopia köad', 'Kopian kunde inte skrivas']) expect(r.text).not.toContain(text);
    }
    const forbjudet = /\b(?:hamtaDriveKo|ko_status|ko_fel)\b/;
    expect(forbjudet.test('const kopior = hamtaDriveKo(client)')).toBe(true);
    async function lasKatalog(url: URL): Promise<void> {
      for (const entry of await readdir(url, { withFileTypes: true })) {
        const child = new URL(entry.name + (entry.isDirectory() ? '/' : ''), url);
        if (entry.isDirectory()) await lasKatalog(child);
        else if (entry.name.endsWith('.ts')) expect(await readFile(child, 'utf8'), entry.name).not.toMatch(forbjudet);
      }
    }
    await lasKatalog(new URL('../src/http/view/', import.meta.url));
  });
  it('V2 regression: Läget använder registrets gällande databaspost', async () => {
    expect(antal(await ok('las_uppdragslage', { project_id: u.projektId }))).toBe(pagarFore + 1);
  });
});

it('D1 dokumentationen beskriver versioner och innehåller inga gamla löften eller nya åtgärdsspann', async () => {
  const text = await readFile(new URL('../../docs/MCP_ACTIONS.md', import.meta.url), 'utf8');
  const start = text.search(/^## Uppdragsytan\b/m);
  expect(start).toBeGreaterThanOrEqual(0);
  const resten = text.slice(start);
  const nasta = resten.slice(1).search(/^## /m);
  const avsnitt = nasta < 0 ? resten : resten.slice(0, nasta + 1);
  const rubrik = '- **Versionsbunden kopia (Story 3.3).**';
  const plats = avsnitt.indexOf(rubrik);
  expect(plats).toBeGreaterThanOrEqual(0);
  const punkt = avsnitt.slice(plats).split('\n\n')[0]!;
  for (const ord of ['registerversion', 'registerhash', 'ersatt', 'registertext']) expect(punkt).toContain(ord);
  const gamla = ['ENA kopiereferens', 'härledda vid hämtningen', 'ingen försöksräknare', 'visar den öppna köposten'];
  const gamlaFraser = (t: string) => gamla.filter((fras) => t.replace(/\s+/g, ' ').includes(fras));
  expect(gamlaFraser(avsnitt)).toEqual([]);
  for (const fras of gamla) expect(gamlaFraser(fras.replace(' ', '\n'))).toEqual([fras]);
  const nya = ['uppdrag_registerkopia', 'registerkopia_id', 'kvittens_annan_version', 'kvittens_ofullstandig'];
  const spann = (t: string) => [...t.matchAll(/`([^`]+)`/g)].map((m) => m[1]!).filter((s) => nya.includes(s));
  expect(spann(avsnitt)).toEqual([]);
  expect(spann(punkt + '\n`uppdrag_registerkopia`')).toEqual(['uppdrag_registerkopia']);
});
