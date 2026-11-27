// Story 3.3 (FR-11/FR-18): fryst underlag, versionskö och vyer utan tekniska köfel.
import { createHash } from 'node:crypto';
import pg from 'pg';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import supertest from 'supertest';
import { loadMigrations } from '../src/db/migrate.js';
import { withTenantTransaction } from '../src/db/tx.js';
import { koaRegisterkopia, listaReferenser, skapaReferens } from '../src/services/uppdragReferens.js';
import { BASELINEKOLUMNER } from '../src/lib/baselinekolumner.js';
import { LEVERANSKONTRAKT_NVR001 } from './fixtures/leveranskontrakt-nvr-001.js';
import { importeraOchGodkann } from './uppdragImportHelper.js';
import { api, app, registerUser, createCompany, createFiscalYear, withAdmin, type TestUser } from './helpers.js';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  REGISTERKOPIA_TEXT, renderaRegisterkopia, registerkopiansHash, lasLeverabelregister, type Registerkopierad,
} from '../src/services/uppdragRegister.js';

const PASSWORD = 'mycket-hemligt-losen-123';
const DRIVE_ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456';
let user: TestUser;
let companyId: string;
let agentToken: string;
let grannen: TestUser;
let grannbolag: string;
let ua: ReturnType<typeof supertest.agent>;
const auth = () => ({ Authorization: `Bearer ${user.token}` });
const agent = () => ({ Authorization: `Bearer ${agentToken}` });
const tx = <T>(fn: (c: pg.PoolClient) => Promise<T>) => withTenantTransaction(user.userId, companyId, fn);
async function act(namn: string, kropp: Record<string, unknown>, headers = auth()) {
  return api.post(`/api/companies/${companyId}/actions/${namn}`).set(headers).send(kropp);
}
async function ok(namn: string, kropp: Record<string, unknown>, headers = auth()): Promise<Record<string, unknown>> {
  const res = await act(namn, kropp, headers);
  expect(res.status, `${namn}: ${JSON.stringify(res.body)}`).toBe(200);
  return res.body.result as Record<string, unknown>;
}
async function nyttUppdrag(namn: string) {
  const projektId = (await ok('create_project', { name: `Uppdrag ${namn}` })).id as string;
  const contractId = (await ok('skapa_uppdrag', {
    project_id: projektId, name: `Leveranskontrakt ${namn}`, signed_date: '2026-09-03',
  })).contract_id as string;
  return { projektId, contractId };
}
async function importerat(namn: string) {
  const u = await nyttUppdrag(namn);
  await importeraOchGodkann(companyId, auth(), { contract_id: u.contractId, kontraktstext: LEVERANSKONTRAKT_NVR001 });
  return u;
}
async function kopieposter(contractId: string) {
  return withAdmin(async (c) => (await c.query(
    `SELECT * FROM uppdrag_referens WHERE company_id = $1 AND contract_id = $2
      AND extern_nyckel = 'registerkopia' ORDER BY created_at, id`, [companyId, contractId],
  )).rows);
}
async function versioner(contractId: string) {
  return withAdmin(async (c) => (await c.query(
    `SELECT *, to_char(skapad_nar AT TIME ZONE 'Europe/Stockholm', 'YYYY-MM-DD HH24:MI') AS fryst
       FROM uppdrag_registerkopia WHERE company_id = $1 AND contract_id = $2 ORDER BY registerversion`,
    [companyId, contractId],
  )).rows);
}
async function skrivVersion(contractId: string, n = 1) {
  const innehall = renderaRegisterkopia({ ...INDATA, registerversion: n });
  return withAdmin(async (c) => (await c.query(
    `INSERT INTO uppdrag_registerkopia (company_id, contract_id, registerversion, innehall, rader, registerhash)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6) RETURNING *`,
    [companyId, contractId, n, innehall, JSON.stringify(RADER), registerkopiansHash(innehall)],
  )).rows[0]!);
}
async function skrivKopost(contractId: string, versionId: string | null, hash: string | null, externId = DRIVE_ID) {
  return withAdmin(async (c) => (await c.query(
    `INSERT INTO uppdrag_referens (company_id, contract_id, sort, extern_id, extern_nyckel, extern_kalla, registerkopia_id, registerhash, ko_status)
     VALUES ($1, $2, 'drive', $3, 'registerkopia', 'drive:sparrmapp', $4, $5, 'koad') RETURNING *`,
    [companyId, contractId, externId, versionId, hash],
  )).rows[0]!);
}
beforeAll(async () => {
  user = await registerUser('registerkopia');
  companyId = await createCompany(user.token, 'Registerkopia AB');
  await createFiscalYear(companyId, auth(), { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });
  const tok = await api.post(`/api/companies/${companyId}/agent-tokens`).set(auth()).send({ name: 'Kopieprov' });
  expect(tok.status, JSON.stringify(tok.body)).toBe(201);
  agentToken = tok.body.token;
  ua = supertest.agent(app);
  const login = await ua.post('/app/login').type('form').send({ email: user.email, password: PASSWORD });
  expect([302, 303]).toContain(login.status);
  grannen = await registerUser('registerkopia-granne');
  grannbolag = await createCompany(grannen.token, 'Grannbolaget AB');
});

const FRYST = '2026-11-26 21:30';
const RADER: Registerkopierad[] = [
  { kod: 'L1', namn: 'Första', status: 'ej_paborjad', klausul: 'A|B\nC', acceptanskriterium: 'Klart', uppfoljningsmatt: 'Antal', matt_lasvag: 'Registret' },
  { kod: 'L2', namn: null, status: 'pagar', klausul: null, acceptanskriterium: null, uppfoljningsmatt: null, matt_lasvag: null },
];
const INDATA = { projektnamn: 'NVR', registerversion: 3, fryst: FRYST, rader: RADER };

describe('Registerkopians rena text och hash', () => {
  it('R1 samma underlag ger samma text och sha256 i UTF-8', () => {
    const text = renderaRegisterkopia(INDATA);
    expect(renderaRegisterkopia(INDATA)).toBe(text);
    expect(registerkopiansHash(text)).toBe(createHash('sha256').update(text, 'utf8').digest('hex'));
    expect(registerkopiansHash(text)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('R2 huvud, derivat och tabell följer textkällan och behåller radordningen', () => {
    const text = renderaRegisterkopia(INDATA);
    const rader = text.split('\n');
    expect(rader[0]).toBe(`# ${REGISTERKOPIA_TEXT.rubrik.replace('{projekt}', INDATA.projektnamn)}`);
    expect(rader[2]).toBe(`> ${REGISTERKOPIA_TEXT.derivat}`);
    expect(rader[3]).toBe(`> ${REGISTERKOPIA_TEXT.version.replace('{n}', '3').replace('{tid}', FRYST)}`);
    expect(rader[5]).toBe(`| ${REGISTERKOPIA_TEXT.kolumner.join(' | ')} |`);
    expect(rader[6]).toBe('|---|---|---|---|---|---|');
    expect(rader.slice(7, -1)).toEqual(RADER.map((r) => {
      const cell = (s: string | null) => (s ?? '').replace(/\|/g, '\\|').replace(/\r\n|\r|\n/g, ' ');
      return `| ${[r.kod, r.status, r.klausul, r.acceptanskriterium, r.uppfoljningsmatt, r.matt_lasvag].map(cell).join(' | ')} |`;
    }));
    expect(text).toContain('A\\|B C');
    expect(text.endsWith('\n')).toBe(true);
    expect(text).not.toContain('Skriven');
  });

  it('R3 både status och registerversion ingår i hashen', () => {
    const hash = registerkopiansHash(renderaRegisterkopia(INDATA));
    expect(registerkopiansHash(renderaRegisterkopia({ ...INDATA, registerversion: 4 }))).not.toBe(hash);
    expect(registerkopiansHash(renderaRegisterkopia({ ...INDATA, rader: [{ ...RADER[0]!, status: 'pagar' }, RADER[1]!] }))).not.toBe(hash);
  });
});

describe('Registerkopians migration', () => {
  it('M1 kolumnerna har rätt typer, nullbarhet och standardvärde', async () => {
    const kolumner = await withAdmin(async (c) => (await c.query(
      `SELECT table_name, column_name, data_type, is_nullable, column_default FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name IN ('uppdrag_registerkopia', 'uppdrag_referens')`,
    )).rows);
    for (const [namn, typ] of Object.entries({ registerversion: 'integer', innehall: 'text', rader: 'jsonb', registerhash: 'text', skapad_nar: 'timestamp with time zone' })) {
      expect(kolumner.find((r) => r.table_name === 'uppdrag_registerkopia' && r.column_name === namn)).toMatchObject({ data_type: typ, is_nullable: 'NO' });
    }
    for (const [namn, typ] of Object.entries({ registerkopia_id: 'uuid', registerhash: 'text', forsok: 'integer' })) {
      expect(kolumner.find((r) => r.table_name === 'uppdrag_referens' && r.column_name === namn)?.data_type).toBe(typ);
    }
    expect(kolumner.find((r) => r.table_name === 'uppdrag_referens' && r.column_name === 'forsok')).toMatchObject({ is_nullable: 'NO', column_default: '0' });
  });

  it('M2 fryst historik utan baselinekolumner', async () => {
    const kommentar = await withAdmin(async (c) => (await c.query("SELECT obj_description('uppdrag_registerkopia'::regclass) AS text")).rows[0]!.text);
    expect(kommentar).toMatch(/^Kategori: FRYST HISTORIK[,.;]/);
    const kolumner = await withAdmin(async (c) => (await c.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'uppdrag_registerkopia'")).rows.map((r) => r.column_name));
    for (const namn of BASELINEKOLUMNER) expect(kolumner).not.toContain(namn);
  });

  it('M3 append-only, RLS, sammansatt FK och avslutsspärr gäller som app', async () => {
    const { contractId } = await nyttUppdrag('M3');
    const rad = await skrivVersion(contractId);
    await withAdmin(async (c) => {
      for (const verb of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
        expect((await c.query("SELECT has_table_privilege('app', 'uppdrag_registerkopia', $1) AS ok", [verb])).rows[0]!.ok).toBe(['SELECT', 'INSERT'].includes(verb));
      }
      expect((await c.query("SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = 'uppdrag_registerkopia'::regclass")).rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
      const policies = (await c.query("SELECT cmd, qual, with_check FROM pg_policies WHERE tablename = 'uppdrag_registerkopia' ORDER BY cmd")).rows;
      expect(policies.map((p) => p.cmd)).toEqual(['INSERT', 'SELECT']);
      for (const p of policies) expect(p.qual ?? p.with_check).toContain('app_has_company_access(company_id)');
      expect((await c.query("SELECT tgname FROM pg_trigger WHERE tgrelid = 'uppdrag_registerkopia'::regclass AND tgname = 'uppdrag_registerkopia_vagrar_avslutat'")).rowCount).toBe(1);
      const fk = (await c.query("SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'uppdrag_registerkopia_contract_fk'")).rows[0]!.def;
      expect(fk).toContain('FOREIGN KEY (contract_id, company_id) REFERENCES contracts(id, company_id)');
    });
    for (const sql of ['UPDATE uppdrag_registerkopia SET innehall = $3 WHERE company_id = $1 AND id = $2', 'DELETE FROM uppdrag_registerkopia WHERE company_id = $1 AND id = $2']) {
      await expect(tx((c) => c.query(sql, sql.startsWith('UPDATE') ? [companyId, rad.id, 'ändrat'] : [companyId, rad.id]))).rejects.toThrow(/permission denied/);
    }
    expect((await versioner(contractId))[0]).toMatchObject(rad);
    const select = (c: pg.PoolClient) => c.query('SELECT id FROM uppdrag_registerkopia WHERE contract_id = $1', [contractId]);
    expect((await tx(select)).rows).toEqual([{ id: rad.id }]);
    expect((await withTenantTransaction(grannen.userId, grannbolag, select)).rows).toEqual([]);
    await expect(withTenantTransaction(grannen.userId, grannbolag, (c) => c.query(
      `INSERT INTO uppdrag_registerkopia (company_id, contract_id, registerversion, innehall, rader, registerhash)
       VALUES ($1, $2, 2, 'x', '[]', $3)`, [companyId, contractId, rad.registerhash],
    ))).rejects.toThrow(/row-level security/);
  });

  it('M4 unika versioner, kopplingens hash och kölägen skyddas i databasen', async () => {
    const { contractId } = await nyttUppdrag('M4');
    const v = await skrivVersion(contractId);
    await expect(skrivVersion(contractId)).rejects.toThrow(/uppdrag_registerkopia_version_uk/);
    await expect(skrivKopost(contractId, v.id, 'f'.repeat(64))).rejects.toThrow(/uppdrag_referens_registerkopia_fk/);
    await expect(skrivKopost(contractId, v.id, null)).rejects.toThrow(/uppdrag_referens_kopia_par/);
    const k = await skrivKopost(contractId, v.id, v.registerhash);
    await expect(skrivKopost(contractId, v.id, v.registerhash)).rejects.toThrow(/uppdrag_referens_en_kopost_per_version/);
    await withAdmin((c) => c.query("UPDATE uppdrag_referens SET ko_status = 'ersatt' WHERE company_id = $1 AND id = $2", [companyId, k.id]));
    expect((await kopieposter(contractId))[0]!.ko_status).toBe('ersatt');
    await expect(withAdmin((c) => c.query("UPDATE uppdrag_referens SET ko_status = 'kanske' WHERE company_id = $1 AND id = $2", [companyId, k.id]))).rejects.toThrow(/uppdrag_referens_ko_status_check/);
  });

  it('M5 migrationen bevarar gamla rader och kan köras två gånger', async () => {
    const migrationer = await loadMigrations();
    const m = migrationer.find((r) => r.name === 'registerkopia');
    expect(m, 'migrationen registerkopia saknas').toBeDefined();
    if (!m) throw new Error('migrationen registerkopia saknas');
    const maintenance = new pg.Client({ connectionString: process.env.MAINTENANCE_DATABASE_URL });
    await maintenance.connect();
    let db: pg.Client | undefined;
    let skapad = false;
    try {
      await maintenance.query('DROP DATABASE IF EXISTS redovisning_test_registerkopia WITH (FORCE)');
      await maintenance.query('CREATE DATABASE redovisning_test_registerkopia');
      skapad = true;
      const url = new URL(process.env.DATABASE_ADMIN_URL!);
      url.pathname = '/redovisning_test_registerkopia';
      db = new pg.Client({ connectionString: url.toString() });
      await db.connect();
      for (const tidigare of migrationer.filter((r) => r.version < m.version)) await db.query(tidigare.sql);
      const uid = (await db.query("INSERT INTO users (email, password_hash, name) VALUES ('kopia@example.se', 'x', 'Kopia') RETURNING id")).rows[0]!.id;
      const cid = (await db.query("INSERT INTO companies (name, org_number) VALUES ('Kopia AB', '556000-0001') RETURNING id")).rows[0]!.id;
      const pid = (await db.query("INSERT INTO projects (company_id, number, name) VALUES ($1, 1, 'Kopia') RETURNING id", [cid])).rows[0]!.id;
      const aid = (await db.query("INSERT INTO contracts (company_id, project_id, name, signed_date, created_by) VALUES ($1, $2, 'Kopia', '2026-09-03', $3) RETURNING id", [cid, pid, uid])).rows[0]!.id;
      for (const [id, nyckel, lage, fel] of [['gammal-fel', 'registerkopia', 'fel', 'gammalt fel'], ['gammal-skriven', 'registerkopia', 'skriven', null], ['vanlig', 'drive#file', null, null]]) {
        await db.query("INSERT INTO uppdrag_referens (company_id, contract_id, sort, extern_id, extern_nyckel, extern_kalla, ko_status, ko_fel) VALUES ($1, $2, 'drive', $3, $4, 'drive:sparrmapp', $5, $6)", [cid, aid, id, nyckel, lage, fel]);
      }
      const fore = (await db.query('SELECT * FROM uppdrag_referens ORDER BY id')).rows;
      const struktur = async () => ({
        constraints: (await db!.query("SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid IN ('uppdrag_referens'::regclass, 'uppdrag_registerkopia'::regclass) ORDER BY conname")).rows,
        index: (await db!.query("SELECT indexname, indexdef FROM pg_indexes WHERE tablename IN ('uppdrag_referens', 'uppdrag_registerkopia') ORDER BY indexname")).rows,
      });
      await db.query(m.sql);
      const efter = (await db.query('SELECT * FROM uppdrag_referens ORDER BY id')).rows;
      expect(efter).toEqual(fore.map((r) => ({ ...r, registerkopia_id: null, registerhash: null, forsok: 0 })));
      const schema = await struktur();
      await db.query(m.sql);
      expect((await db.query('SELECT * FROM uppdrag_referens ORDER BY id')).rows).toEqual(efter);
      expect(await struktur()).toEqual(schema);
    } finally {
      if (db) await db.end();
      if (skapad) await maintenance.query('DROP DATABASE IF EXISTS redovisning_test_registerkopia WITH (FORCE)');
      await maintenance.end();
    }
  }, 60_000);

  it('M6 vanliga referenser är unika medan versioner får dela fil', async () => {
    const { contractId } = await nyttUppdrag('M6');
    const vanlig = () => withAdmin((c) => c.query("INSERT INTO uppdrag_referens (company_id, contract_id, sort, extern_id) VALUES ($1, $2, 'drive', 'vanlig-fil')", [companyId, contractId]));
    await vanlig();
    await expect(vanlig()).rejects.toThrow(/uppdrag_referens_uk/);
    for (const n of [1, 2]) {
      const v = await skrivVersion(contractId, n);
      await skrivKopost(contractId, v.id, v.registerhash);
    }
    expect((await kopieposter(contractId)).map((r) => r.extern_id)).toEqual([DRIVE_ID, DRIVE_ID]);
  });
});

const paborja = (contractId: string) => ok('paborja_leverabel', { contract_id: contractId, leverabel_kod: 'L1' });
const frystaRader = (rader: Awaited<ReturnType<typeof lasLeverabelregister>>): Registerkopierad[] =>
  rader.map(({ kod, namn, status, klausul, acceptanskriterium, uppfoljningsmatt, matt_lasvag }) =>
    ({ kod, namn, status, klausul, acceptanskriterium, uppfoljningsmatt, matt_lasvag }));

describe('Varje registerändring fryser en ny version', () => {
  it('K1 importen binder text, rader, hash och en overifierad köpost i samma transaktion', async () => {
    const { projektId, contractId } = await importerat('K1');
    const v = await versioner(contractId);
    expect(v).toHaveLength(1);
    const rader = await tx((c) => lasLeverabelregister(c, companyId, { contract_id: contractId }));
    const projektnamn = await withAdmin(async (c) => (await c.query('SELECT name FROM projects WHERE company_id = $1 AND id = $2', [companyId, projektId])).rows[0]!.name as string);
    expect(v[0]!.innehall).toBe(renderaRegisterkopia({ projektnamn, registerversion: 1, fryst: v[0]!.fryst, rader: frystaRader(rader) }));
    expect(v[0]!.registerhash).toBe(registerkopiansHash(v[0]!.innehall));
    expect(v[0]!.rader).toEqual(frystaRader(rader));
    expect(v[0]!.rader).toHaveLength((LEVERANSKONTRAKT_NVR001.match(/^### L\d+\b/gm) ?? []).length);
    const poster = await kopieposter(contractId);
    expect(poster).toHaveLength(1);
    expect(poster[0]).toMatchObject({ registerkopia_id: v[0]!.id, registerhash: v[0]!.registerhash, forsok: 0, ko_status: 'koad', extern_id: `registerkopia:${contractId}`, status: 'overifierad' });
  });

  it('K2 statusbytet skapar version 2 och lämnar hela version 1 och dess köpost orörda', async () => {
    const { contractId } = await importerat('K2');
    const fore = await versioner(contractId);
    const koFore = await kopieposter(contractId);
    await paborja(contractId);
    const efter = await versioner(contractId);
    const koEfter = await kopieposter(contractId);
    expect(efter.map((r) => r.registerversion)).toEqual([1, 2]);
    expect(efter[0]).toEqual(fore[0]);
    expect(koEfter.find((r) => r.id === koFore[0]!.id)).toEqual(koFore[0]);
    expect(koEfter).toHaveLength(2);
    expect(koEfter.find((r) => r.id !== koFore[0]!.id)?.registerkopia_id).toBe(efter[1]!.id);
    expect(efter[0]!.rader.find((r: Registerkopierad) => r.kod === 'L1').status).toBe('ej_paborjad');
    expect(efter[1]!.rader.find((r: Registerkopierad) => r.kod === 'L1').status).toBe('pagar');
  });

  it('K3 en fälld import lämnar ingen version eller köpost; lyckad import skriver båda', async () => {
    const projektId = (await ok('create_project', { name: 'K3 osignerat' })).id as string;
    const contractId = (await ok('create_contract', { project_id: projektId, name: 'Osignerat' })).id as string;
    const res = await act('importera_leveranskontrakt', { contract_id: contractId, kontraktstext: LEVERANSKONTRAKT_NVR001 });
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect(res.body.error).toBe('valid_from_required');
    expect(await versioner(contractId)).toEqual([]);
    expect(await kopieposter(contractId)).toEqual([]);
    const lyckat = await importerat('K3 signerat');
    const v = await versioner(lyckat.contractId);
    const k = await kopieposter(lyckat.contractId);
    expect(v).toHaveLength(1);
    expect(k).toHaveLength(1);
    expect(k[0]!.registerkopia_id).toBe(v[0]!.id);
  });

  it('K4 två samtidiga köningar efter KEY SHARE ger två löpnummer utan dödläge', async () => {
    const { contractId } = await nyttUppdrag('K4');
    let anlanda = 0;
    let bada!: () => void;
    const grind = new Promise<void>((resolve) => { bada = resolve; });
    const koa = () => tx(async (c) => {
      await c.query('SELECT 1 FROM contracts WHERE id = $1 AND company_id = $2 FOR KEY SHARE', [contractId, companyId]);
      if (++anlanda === 2) bada();
      await grind;
      return koaRegisterkopia(c, companyId, contractId);
    });
    const resultat = await Promise.all([koa(), koa()]);
    expect(new Set(resultat.map((r) => r.referens_id)).size).toBe(2);
    expect((await versioner(contractId)).map((r) => r.registerversion)).toEqual([1, 2]);
    expect(await kopieposter(contractId)).toHaveLength(2);
  });

  it('K5 nästa köpost ärver filens id medan föregående står kvar skriven', async () => {
    const { contractId } = await importerat('K5');
    const forsta = (await kopieposter(contractId))[0]!;
    await ok('rapportera_drive_kopia', { referens_id: forsta.id, utfall: { lage: 'skriven', drive_id: DRIVE_ID } }, agent());
    const skriven = (await kopieposter(contractId))[0]!;
    await paborja(contractId);
    const poster = await kopieposter(contractId);
    expect(poster.find((r) => r.id === skriven.id)).toEqual(skriven);
    const ny = poster.find((r) => r.id !== skriven.id)!;
    expect(ny).toMatchObject({ extern_id: DRIVE_ID, ko_status: 'koad' });
    expect(ny.registerkopia_id).toBe((await versioner(contractId))[1]!.id);
    const utanFil = await importerat('K5 ingen fil');
    expect((await kopieposter(utanFil.contractId))[0]!.extern_id).toBe(`registerkopia:${utanFil.contractId}`);
  });

  it('K6 en gammal köpost utan version ersätts och båda kvittenserna ger 200 utan ändring', async () => {
    const { contractId } = await nyttUppdrag('K6');
    await withAdmin((c) => c.query(
      "INSERT INTO uppdrag_leverabel (company_id, contract_id, kod, uppfoljningsmatt, matt_lasvag) VALUES ($1, $2, 'L1', 'Antal', 'redovisning')", [companyId, contractId],
    ));
    const gammal = await skrivKopost(contractId, null, null, `registerkopia:${contractId}`);
    await withAdmin((c) => c.query("UPDATE uppdrag_referens SET ko_status = 'fel', ko_fel = 'gammalt fel' WHERE company_id = $1 AND id = $2", [companyId, gammal.id]));
    await paborja(contractId);
    expect((await versioner(contractId)).map((r) => r.registerversion)).toEqual([1]);
    const fore = (await kopieposter(contractId)).find((r) => r.id === gammal.id)!;
    expect(fore).toMatchObject({ ko_status: 'ersatt', ko_fel: 'gammalt fel', registerkopia_id: null });
    await ok('rapportera_drive_kopia', { referens_id: gammal.id, utfall: { lage: 'fel', fel: 'förra arbetslistan' } }, agent());
    expect((await kopieposter(contractId)).find((r) => r.id === gammal.id)).toEqual(fore);
    await ok('kor_uppdragssvep', { drive_kopior: [{ referens_id: gammal.id, utfall: { lage: 'skriven', drive_id: DRIVE_ID } }] }, agent());
    expect((await kopieposter(contractId)).find((r) => r.id === gammal.id)).toEqual(fore);
  });
});

interface Arbetsreferens { referens_id: string; contract_id: string; extern_nyckel: string | null }
async function verifieringslista() {
  const svar = await ok('kor_uppdragssvep', {}, agent());
  return (svar.arbetslista as { referenser: Arbetsreferens[] }).referenser;
}

describe('Senaste kopieposten och kvittensens dubblettskydd', () => {
  it('L1 listorna visar bara senaste kopieposten och verifierar den först när den är skriven', async () => {
    const { contractId } = await importerat('L1');
    const ett = (await kopieposter(contractId))[0]!;
    await ok('rapportera_drive_kopia', { referens_id: ett.id, utfall: { lage: 'skriven', drive_id: DRIVE_ID } });
    await paborja(contractId);
    const tva = (await kopieposter(contractId)).find((r) => r.id !== ett.id)!;
    expect(tva).toMatchObject({ ko_status: 'koad', extern_id: DRIVE_ID });
    const lista = await tx((c) => listaReferenser(c, companyId, contractId));
    expect(lista.filter((r) => r.extern_nyckel === 'registerkopia').map((r) => ({ id: r.id, status: r.status })))
      .toEqual([{ id: tva.id, status: 'overifierad' }]);
    const fore = (await verifieringslista()).filter((r) => r.contract_id === contractId && r.extern_nyckel === 'registerkopia');
    expect(fore).toEqual([]);
    await ok('rapportera_drive_kopia', { referens_id: tva.id, utfall: { lage: 'skriven', drive_id: DRIVE_ID } });
    const efter = (await verifieringslista()).filter((r) => r.contract_id === contractId && r.extern_nyckel === 'registerkopia');
    expect(efter.map((r) => r.referens_id)).toEqual([tva.id]);
    expect(efter.map((r) => r.referens_id)).not.toContain(ett.id);
  });

  it('L2 ett vanligt dokument-id ger 409 utan mutation, ett annat id godtas', async () => {
    const { contractId } = await importerat('L2');
    const fore = (await kopieposter(contractId))[0]!;
    const dokumentId = `${DRIVE_ID}-E`;
    await tx((c) => skapaReferens(c, companyId, {
      contract_id: contractId, sort: 'drive', extern_id: dokumentId,
      extern_nyckel: 'drive#file', extern_kalla: 'drive:sparrmapp',
    }));
    const res = await act('rapportera_drive_kopia', { referens_id: fore.id, utfall: { lage: 'skriven', drive_id: dokumentId } });
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(res.body.error).toBe('referens_finns_redan');
    expect((await kopieposter(contractId))[0]).toEqual(fore);
    await ok('rapportera_drive_kopia', { referens_id: fore.id, utfall: { lage: 'skriven', drive_id: `${DRIVE_ID}-F` } });
    expect((await kopieposter(contractId))[0]!.extern_id).toBe(`${DRIVE_ID}-F`);
  });

  it('L3 regression: cachetömning och svep lämnar historik och versionskopplingar orörda', async () => {
    const { contractId } = await importerat('L3');
    await paborja(contractId);
    const oppnaUtanVersion = await withAdmin(async (c) => (await c.query(
      "SELECT id FROM uppdrag_referens WHERE company_id = $1 AND extern_nyckel = 'registerkopia' AND registerkopia_id IS NULL AND ko_status IN ('koad', 'fel')", [companyId],
    )).rows);
    expect(oppnaUtanVersion).toEqual([]);
    const las = () => withAdmin(async (c) => ({
      historik: (await c.query('SELECT * FROM uppdrag_registerkopia WHERE company_id = $1 ORDER BY contract_id, registerversion', [companyId])).rows,
      kopplingar: (await c.query("SELECT id, registerkopia_id, registerhash, contract_id FROM uppdrag_referens WHERE company_id = $1 AND contract_id = $2 AND extern_nyckel = 'registerkopia' ORDER BY id", [companyId, contractId])).rows,
    }));
    const fore = await las();
    expect(fore.historik.length).toBeGreaterThan(0);
    expect(fore.kopplingar).toHaveLength(2);
    const tabeller = await withAdmin(async (c) => (await c.query(
      "SELECT relname, obj_description(oid, 'pg_class') AS kommentar FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'r' AND relname LIKE 'uppdrag%' ORDER BY relname",
    )).rows.filter((r) => r.kommentar?.toLowerCase().match(/^\s*kategori:\s*([^.,;]*)/)?.[1]?.trim() === 'cache').map((r) => r.relname as string));
    expect(tabeller).toEqual(['uppdrag_dokument', 'uppdrag_dokumentrot', 'uppdrag_svepvarde']);
    await tx(async (c) => {
      for (const tabell of tabeller) await c.query(`DELETE FROM "${tabell.replace(/"/g, '""')}" WHERE company_id = $1`, [companyId]);
    });
    await ok('kor_uppdragssvep', {}, agent());
    expect(await las()).toEqual(fore);
  });
});

interface Lage { avtal: Array<{ contract_id: string; leverabler: Array<{ lage: string; antal: number }> }> }
async function pagarAntal(projektId: string, contractId: string) {
  const svar = await ok('las_uppdragslage', { project_id: projektId }) as unknown as Lage;
  const avtal = svar.avtal.find((r) => r.contract_id === contractId);
  expect(avtal).toBeDefined();
  return avtal!.leverabler.find((r) => r.lage === 'pagar')!.antal;
}
async function vykallor(rot: URL): Promise<string[]> {
  const filer: string[] = [];
  for (const entry of await readdir(rot, { withFileTypes: true })) {
    const url = new URL(entry.name + (entry.isDirectory() ? '/' : ''), rot);
    if (entry.isDirectory()) filer.push(...await vykallor(url));
    else if (entry.name.endsWith('.ts')) filer.push(await readFile(url, 'utf8'));
  }
  return filer;
}

describe('Vyerna läser sakläget utan tekniska köuppgifter', () => {
  let projektId: string;
  let contractId: string;
  let markor: string;
  let fore: number;
  beforeAll(async () => {
    ({ projektId, contractId } = await importerat('V'));
    markor = `Drive svarade 403: MARKOR-${randomUUID()}`;
    await ok('rapportera_drive_kopia', { referens_id: (await kopieposter(contractId))[0]!.id, utfall: { lage: 'fel', fel: markor } });
    fore = await pagarAntal(projektId, contractId);
    await paborja(contractId);
  });

  it('V1 tre sidor och hela vykällan saknar köstatus, köfel och Drive-fel', async () => {
    const ko = await ok('hamta_drive_ko', {}) as unknown as Array<{ contract_id: string; ko_fel: string | null }>;
    expect(ko.filter((r) => r.contract_id === contractId).some((r) => r.ko_fel === markor)).toBe(true);
    for (const path of [`/app/c/${companyId}/projects/${projektId}`, `/app/c/${companyId}/projects/${projektId}/laget`, `/app/c/${companyId}/uppdrag`]) {
      const res = await ua.get(path);
      expect(res.status, `${path}: ${res.text}`).toBe(200);
      for (const dold of [markor, 'Kopia köad', 'Kopian kunde inte skrivas']) expect(res.text).not.toContain(dold);
    }
    const harKouppgifter = (text: string) => /\b(?:hamtaDriveKo|ko_status|ko_fel)\b/.test(text);
    expect(harKouppgifter('const kopior = hamtaDriveKo(client, companyId);')).toBe(true);
    const kallor = await vykallor(new URL('../src/http/view/', import.meta.url));
    expect(kallor.length).toBeGreaterThan(0);
    for (const text of kallor) expect(harKouppgifter(text)).toBe(false);
  });

  it('V2 regression: Läget räknar den gällande registerposten efter ändringen', async () => {
    expect(await pagarAntal(projektId, contractId)).toBe(fore + 1);
  });
});

describe('Dokumentspeglingen', () => {
  it('D1 versionskopian beskrivs utan gamla vylöften eller nya ensamma åtgärdsnamn', async () => {
    const docs = await readFile(new URL('../../docs/MCP_ACTIONS.md', import.meta.url), 'utf8');
    const avsnitt = docs.match(/^## Uppdragsytan\b[^]*?(?=^## |$(?![^]))/m)?.[0];
    expect(avsnitt, 'avsnittet Uppdragsytan saknas').toBeDefined();
    const text = avsnitt!;
    const punkt = text.match(/^- \*\*Versionsbunden kopia \(Story 3\.3\)\.\*\*[^]*?(?=\n\s*\n|$(?![^]))/m)?.[0];
    expect(punkt, 'versionskopians dokumentpunkt saknas').toBeDefined();
    for (const ord of ['registerversion', 'registerhash', 'ersatt']) expect(punkt).toContain(ord);
    const gamlaLoften = (s: string) => ['ENA kopiereferens', 'visar den öppna köposten'].filter((fras) => s.replace(/\s+/g, ' ').includes(fras));
    expect(gamlaLoften(text)).toEqual([]);
    expect(gamlaLoften('ENA\n kopiereferens; visar den öppna\n köposten')).toHaveLength(2);
    const ensammaNyaNamn = (s: string) => [...s.matchAll(/`([^`\n]+)`/g)].map((m) => m[1]).filter((namn) => ['uppdrag_registerkopia', 'registerkopia_id'].includes(namn!));
    expect(ensammaNyaNamn(text)).toEqual([]);
    expect(ensammaNyaNamn(`${punkt}\n\`uppdrag_registerkopia\``)).toEqual(['uppdrag_registerkopia']);
  });
});
