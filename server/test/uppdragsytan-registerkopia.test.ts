// Story 3.3: fryst registerhistorik, versionskoppling och tekniska fel utanför
// Davids vyer. Provas från rena regler genom app-rollen och HTTP till schemat.
import { createHash, randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import pg from 'pg';
import supertest from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { withTenantTransaction } from '../src/db/tx.js';
import { loadMigrations } from '../src/db/migrate.js';
import { BASELINEKOLUMNER } from '../src/lib/baselinekolumner.js';
import {
  REGISTERKOPIA_TEXT, renderaRegisterkopia, registerkopiansHash,
  lasLeverabelregister, type Registerkopierad,
} from '../src/services/uppdragRegister.js';
import { koaRegisterkopia, listaReferenser, rapporteraDriveKopia, skapaReferens } from '../src/services/uppdragReferens.js';
import { app, api, createCompany, createFiscalYear, registerUser, withAdmin, type TestUser } from './helpers.js';
import { importeraOchGodkann } from './uppdragImportHelper.js';
import { LEVERANSKONTRAKT_NVR001 } from './fixtures/leveranskontrakt-nvr-001.js';

const PASSWORD = 'mycket-hemligt-losen-123';
const DRIVE_ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456';
const FRYST = '2026-11-26 21:30';
const RADER: Registerkopierad[] = [
  { kod: 'L1', namn: 'Första', status: 'ej_paborjad', klausul: '2|1\nandra raden',
    acceptanskriterium: 'Godkänt', uppfoljningsmatt: 'Antal', matt_lasvag: 'arenden' },
  { kod: 'L2', namn: null, status: 'pagar', klausul: null,
    acceptanskriterium: null, uppfoljningsmatt: null, matt_lasvag: null },
];

describe('Kopians rena text och hash', () => {
  const indata = { projektnamn: 'Projektet', registerversion: 3, fryst: FRYST, rader: RADER };
  it('R1 samma indata ger samma text och sha256 i UTF-8', () => {
    const text = renderaRegisterkopia(indata);
    expect(renderaRegisterkopia(indata)).toBe(text);
    expect(registerkopiansHash(text)).toBe(createHash('sha256').update(text, 'utf8').digest('hex'));
    expect(registerkopiansHash(text)).toMatch(/^[0-9a-f]{64}$/);
  });
  it('R2 huvud, derivat och sex celler med escaping och given ordning', () => {
    const text = renderaRegisterkopia(indata);
    expect(text.startsWith(`# ${REGISTERKOPIA_TEXT.rubrik.replace('{projekt}', indata.projektnamn)}\n\n`)).toBe(true);
    expect(text).toContain(`> ${REGISTERKOPIA_TEXT.derivat}\n`);
    expect(text).toContain(`> ${REGISTERKOPIA_TEXT.version.replace('{n}', '3').replace('{tid}', FRYST)}\n`);
    const tabell = text.split('\n').filter((r) => r.startsWith('|'));
    expect(tabell).toEqual([
      `| ${REGISTERKOPIA_TEXT.kolumner.join(' | ')} |`,
      '|---|---|---|---|---|---|',
      '| L1 | ej_paborjad | 2\\|1 andra raden | Godkänt | Antal | arenden |',
      '| L2 | pagar |  |  |  |  |',
    ]);
    expect(text.endsWith('\n')).toBe(true);
    expect(text).not.toContain('Skriven');
  });
  it('R3 både ändrad status och version ändrar hashen', () => {
    const hash = registerkopiansHash(renderaRegisterkopia(indata));
    expect(registerkopiansHash(renderaRegisterkopia({ ...indata, registerversion: 4 }))).not.toBe(hash);
    expect(registerkopiansHash(renderaRegisterkopia({ ...indata,
      rader: [{ ...RADER[0]!, status: 'pagar' }, RADER[1]!] }))).not.toBe(hash);
  });
});

let user: TestUser;
let companyId: string;
let grannen: TestUser;
let grannbolag: string;
let agentToken: string;
let ua: ReturnType<typeof supertest.agent>;
const auth = () => ({ Authorization: `Bearer ${user.token}` });
const agent = () => ({ Authorization: `Bearer ${agentToken}` });
const tx = <T>(fn: (c: pg.PoolClient) => Promise<T>) => withTenantTransaction(user.userId, companyId, fn);
async function act(namn: string, kropp: Record<string, unknown>, headers = auth()) {
  return api.post(`/api/companies/${companyId}/actions/${namn}`).set(headers).send(kropp);
}
async function ok(namn: string, kropp: Record<string, unknown>, headers = auth()): Promise<Record<string, any>> {
  const res = await act(namn, kropp, headers);
  expect(res.status, `${namn}: ${JSON.stringify(res.body)}`).toBe(200);
  return res.body.result;
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
const kopieposter = (avtal: string) => withAdmin(async (c) => (await c.query(
  "SELECT * FROM uppdrag_referens WHERE company_id=$1 AND contract_id=$2 AND extern_nyckel='registerkopia' ORDER BY created_at, id",
  [companyId, avtal],
)).rows);
const versioner = (avtal: string) => withAdmin(async (c) => (await c.query(
  `SELECT *, to_char(skapad_nar AT TIME ZONE 'Europe/Stockholm', 'YYYY-MM-DD HH24:MI') AS fryst
     FROM uppdrag_registerkopia WHERE company_id=$1 AND contract_id=$2 ORDER BY registerversion`, [companyId, avtal],
)).rows);
const fel = (p: Promise<unknown>) => p.then(() => null,
  (e: unknown) => e as { code?: string; constraint?: string; message: string });

beforeAll(async () => {
  user = await registerUser('registerkopia');
  companyId = await createCompany(user.token, 'Locollabs AB');
  await createFiscalYear(companyId, auth(), { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });
  grannen = await registerUser('registerkopia-granne');
  grannbolag = await createCompany(grannen.token, 'Grannbolaget AB');
  const tok = await api.post(`/api/companies/${companyId}/agent-tokens`).set(auth()).send({ name: 'Svepet' });
  expect(tok.status, JSON.stringify(tok.body)).toBe(201);
  agentToken = tok.body.token;
  ua = supertest.agent(app);
  const login = await ua.post('/app/login').type('form').send({ email: user.email, password: PASSWORD });
  expect([302, 303]).toContain(login.status);
});

async function migration() {
  const m = (await loadMigrations()).find((x) => x.name === 'registerkopia');
  expect(m, 'migrationen registerkopia saknas').toBeDefined();
  return m!;
}
async function adminversion(avtal: string, n = 1) {
  return withAdmin(async (c) => (await c.query(
    `INSERT INTO uppdrag_registerkopia (company_id, contract_id, registerversion, innehall, rader, registerhash)
     VALUES ($1,$2,$3,'fryst text','[]',$4) RETURNING *`, [companyId, avtal, n, registerkopiansHash('fryst text')],
  )).rows[0]!);
}
async function adminkopost(avtal: string, v: Record<string, any>, externId = DRIVE_ID, hash: string | null = v.registerhash) {
  return withAdmin((c) => c.query(
    `INSERT INTO uppdrag_referens (company_id,contract_id,sort,extern_id,extern_nyckel,ko_status,registerkopia_id,registerhash)
     VALUES ($1,$2,'drive',$3,'registerkopia','koad',$4,$5) RETURNING *`, [companyId, avtal, externId, v.id, hash],
  ));
}

describe('Migrationens frysta historik och sista försvarslinjer', () => {
  it('M1 tabellens typer och köpostens tre nya kolumner', async () => {
    const cols = await withAdmin(async (c) => (await c.query(
      "SELECT table_name,column_name,data_type,is_nullable,column_default FROM information_schema.columns WHERE table_schema='public' AND table_name=ANY($1::text[])",
      [['uppdrag_registerkopia', 'uppdrag_referens']],
    )).rows);
    const typer = Object.fromEntries(cols.filter((r) => r.table_name === 'uppdrag_registerkopia').map((r) => [r.column_name, r.data_type]));
    expect(typer).toEqual({ id: 'uuid', company_id: 'uuid', contract_id: 'uuid', registerversion: 'integer',
      innehall: 'text', rader: 'jsonb', registerhash: 'text', skapad_nar: 'timestamp with time zone' });
    for (const [namn, typ] of [['registerkopia_id', 'uuid'], ['registerhash', 'text'], ['forsok', 'integer']]) {
      expect(cols.find((r) => r.table_name === 'uppdrag_referens' && r.column_name === namn)?.data_type).toBe(typ);
    }
    expect(cols.find((r) => r.table_name === 'uppdrag_referens' && r.column_name === 'forsok')).toMatchObject({ is_nullable: 'NO', column_default: '0' });
  });
  it('M2 kategorin är FRYST HISTORIK utan baselinekolumner', async () => {
    const kommentar = await withAdmin(async (c) => (await c.query("SELECT obj_description('uppdrag_registerkopia'::regclass) AS text")).rows[0]!.text);
    expect(kommentar).toMatch(/^Kategori: FRYST HISTORIK[,.;]/);
    const cols = await withAdmin(async (c) => (await c.query("SELECT column_name FROM information_schema.columns WHERE table_name='uppdrag_registerkopia'")).rows.map((r) => r.column_name));
    expect(BASELINEKOLUMNER.filter((k) => cols.includes(k))).toEqual([]);
  });
  it('M3 app kan bara läsa och lägga till, RLS isolerar och avslutstriggern finns', async () => {
    const katalog = await withAdmin(async (c) => ({
      ratt: (await c.query(`SELECT has_table_privilege('app','uppdrag_registerkopia','SELECT') AS las,
        has_table_privilege('app','uppdrag_registerkopia','INSERT') AS skriv,
        has_table_privilege('app','uppdrag_registerkopia','UPDATE') AS andra,
        has_table_privilege('app','uppdrag_registerkopia','DELETE') AS radera`)).rows[0],
      rls: (await c.query("SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid='uppdrag_registerkopia'::regclass")).rows[0],
      policies: (await c.query("SELECT cmd,qual,with_check FROM pg_policies WHERE tablename='uppdrag_registerkopia' ORDER BY cmd")).rows,
      trigger: (await c.query("SELECT tgname FROM pg_trigger WHERE tgrelid='uppdrag_registerkopia'::regclass AND NOT tgisinternal")).rows,
      fk: (await c.query("SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname='uppdrag_registerkopia_contract_fk'")).rows,
    }));
    expect(katalog.ratt).toEqual({ las: true, skriv: true, andra: false, radera: false });
    expect(katalog.rls).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
    expect(katalog.policies.map((p) => p.cmd)).toEqual(['INSERT', 'SELECT']);
    for (const p of katalog.policies) expect(p.qual ?? p.with_check).toContain('app_has_company_access(company_id)');
    expect(katalog.trigger.map((t) => t.tgname)).toContain('uppdrag_registerkopia_vagrar_avslutat');
    expect(katalog.fk[0]?.def).toContain('FOREIGN KEY (contract_id, company_id) REFERENCES contracts(id, company_id)');
    const { contractId } = await nyttUppdrag('M3');
    const rad = await adminversion(contractId);
    const las = () => tx(async (c) => (await c.query('SELECT * FROM uppdrag_registerkopia WHERE contract_id=$1', [contractId])).rows);
    expect(await las()).toEqual([rad]);
    await expect(tx((c) => c.query("UPDATE uppdrag_registerkopia SET innehall='nytt' WHERE id=$1", [rad.id]))).rejects.toThrow(/permission denied/);
    await expect(tx((c) => c.query('DELETE FROM uppdrag_registerkopia WHERE id=$1', [rad.id]))).rejects.toThrow(/permission denied/);
    expect(await las()).toEqual([rad]);
    expect(await withTenantTransaction(grannen.userId, grannbolag, async (c) => (await c.query('SELECT * FROM uppdrag_registerkopia WHERE contract_id=$1', [contractId])).rows)).toEqual([]);
    await expect(withTenantTransaction(grannen.userId, grannbolag, (c) => c.query(
      "INSERT INTO uppdrag_registerkopia (company_id,contract_id,registerversion,innehall,rader,registerhash) VALUES ($1,$2,2,'x','[]',$3)",
      [companyId, contractId, rad.registerhash],
    ))).rejects.toThrow(/row-level security/);
  });
  it('M4 version, hashpar, främmande nyckel och en köpost per version hålls av databasen', async () => {
    const { contractId } = await nyttUppdrag('M4');
    const v = await adminversion(contractId);
    expect(await fel(adminversion(contractId))).toMatchObject({ constraint: 'uppdrag_registerkopia_version_uk' });
    expect(await fel(adminkopost(contractId, v, DRIVE_ID, '0'.repeat(64)))).toMatchObject({ constraint: 'uppdrag_referens_registerkopia_fk' });
    expect(await fel(adminkopost(contractId, v, DRIVE_ID, null))).toMatchObject({ constraint: 'uppdrag_referens_kopia_par' });
    const post = (await adminkopost(contractId, v)).rows[0]!;
    expect(await fel(adminkopost(contractId, v))).toMatchObject({ constraint: 'uppdrag_referens_en_kopost_per_version' });
    await withAdmin((c) => c.query("UPDATE uppdrag_referens SET ko_status='ersatt' WHERE id=$1", [post.id]));
    expect((await kopieposter(contractId))[0]!.ko_status).toBe('ersatt');
    expect(await fel(withAdmin((c) => c.query("UPDATE uppdrag_referens SET ko_status='kanske' WHERE id=$1", [post.id])))).toMatchObject({ constraint: 'uppdrag_referens_ko_status_check' });
  });
  it('M5 befintliga rader bevaras och migrationen tål två körningar', async () => {
    const m = await migration();
    const maintenance = new pg.Client({ connectionString: process.env.MAINTENANCE_DATABASE_URL });
    const url = new URL(process.env.DATABASE_ADMIN_URL!);
    url.pathname = '/redovisning_test_registerkopia';
    const db = new pg.Client({ connectionString: url.toString() });
    let ansluten = false;
    await maintenance.connect();
    try {
      await maintenance.query('DROP DATABASE IF EXISTS redovisning_test_registerkopia WITH (FORCE)');
      await maintenance.query('CREATE DATABASE redovisning_test_registerkopia');
      await db.connect(); ansluten = true;
      for (const tidigare of (await loadMigrations()).filter((x) => x.version < m.version)) await db.query(tidigare.sql);
      const uid = (await db.query("INSERT INTO users (email,password_hash,name) VALUES ('kopia@example.se','x','Kopieprov') RETURNING id")).rows[0].id;
      const bolag = (await db.query("INSERT INTO companies (name,org_number) VALUES ('Kopieprov AB','556000-0001') RETURNING id")).rows[0].id;
      const p = (await db.query("INSERT INTO projects (company_id,number,name) VALUES ($1,1,'Kopieprojekt') RETURNING id", [bolag])).rows[0].id;
      const a = (await db.query("INSERT INTO contracts (company_id,project_id,name,created_by) VALUES ($1,$2,'Kopieavtal',$3) RETURNING id", [bolag,p,uid])).rows[0].id;
      for (const [externId, nyckel, status, koFel] of [['gammalt-fel','registerkopia','fel','feltext'], [DRIVE_ID,'registerkopia','skriven',null], ['vanlig-fil','dokument',null,null]]) {
        await db.query("INSERT INTO uppdrag_referens (company_id,contract_id,sort,extern_id,extern_nyckel,ko_status,ko_fel) VALUES ($1,$2,'drive',$3,$4,$5,$6)", [bolag,a,externId,nyckel,status,koFel]);
      }
      const las = async () => (await db.query('SELECT * FROM uppdrag_referens ORDER BY id')).rows;
      const fore = await las();
      await db.query(m.sql);
      const efter = await las();
      expect(efter).toEqual(fore.map((r) => ({ ...r, registerkopia_id: null, registerhash: null, forsok: 0 })));
      const villkor = async () => ({
        constraints: (await db.query("SELECT conname,pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid=ANY(ARRAY['uppdrag_referens'::regclass,'uppdrag_registerkopia'::regclass]) ORDER BY conname")).rows,
        index: (await db.query("SELECT indexname,indexdef FROM pg_indexes WHERE tablename IN ('uppdrag_referens','uppdrag_registerkopia') ORDER BY indexname")).rows,
      });
      const schema = await villkor();
      await db.query(m.sql);
      expect(await las()).toEqual(efter);
      expect(await villkor()).toEqual(schema);
    } finally {
      if (ansluten) await db.end();
      await maintenance.query('DROP DATABASE IF EXISTS redovisning_test_registerkopia WITH (FORCE)');
      await maintenance.end();
    }
  }, 60_000);
  it('M6 vanliga dubbletter fälls men versioner får dela Drive-id', async () => {
    const { contractId } = await nyttUppdrag('M6');
    const vanlig = () => withAdmin((c) => c.query("INSERT INTO uppdrag_referens (company_id,contract_id,sort,extern_id) VALUES ($1,$2,'drive',$3)", [companyId,contractId,DRIVE_ID]));
    await vanlig();
    expect(await fel(vanlig())).toMatchObject({ constraint: 'uppdrag_referens_uk' });
    const annat = await nyttUppdrag('M6-versioner');
    for (const n of [1,2]) await adminkopost(annat.contractId, await adminversion(annat.contractId, n));
    expect((await kopieposter(annat.contractId)).map((r) => r.extern_id)).toEqual([DRIVE_ID,DRIVE_ID]);
  });
});

// Köningens väg in används också av statusbytena; ingen ny åtgärd införs.
const paborja = (avtal: string) => ok('paborja_leverabel', { contract_id: avtal, leverabel_kod: 'L1' });
const rapport = (id: string, driveId: string) => ok('rapportera_drive_kopia', { referens_id: id, utfall: { lage: 'skriven', drive_id: driveId } }, agent());
const frystaRader = (rader: Awaited<ReturnType<typeof lasLeverabelregister>>): Registerkopierad[] => rader.map(
  ({ kod, namn, status, klausul, acceptanskriterium, uppfoljningsmatt, matt_lasvag }) =>
    ({ kod, namn, status, klausul, acceptanskriterium, uppfoljningsmatt, matt_lasvag }),
);

describe('Köningen binder ändringen till en fryst version', () => {
  it('K1 importen fryser exakt text, rader, tid och hash i version 1', async () => {
    const { contractId } = await importerat('K1');
    const vs = await versioner(contractId);
    expect(vs).toHaveLength(1);
    const v = vs[0]!;
    const rader = frystaRader(await tx((c) => lasLeverabelregister(c, companyId, { contract_id: contractId })));
    expect(v).toMatchObject({ registerversion: 1, rader });
    expect(v.rader).toHaveLength(6);
    expect(v.innehall).toBe(renderaRegisterkopia({ projektnamn: 'Uppdrag K1', registerversion: 1, fryst: v.fryst, rader }));
    expect(v.innehall).toContain(REGISTERKOPIA_TEXT.derivat);
    expect(v.registerhash).toBe(registerkopiansHash(v.innehall));
    const poster = await kopieposter(contractId);
    expect(poster).toHaveLength(1);
    expect(poster[0]).toMatchObject({ registerkopia_id: v.id, registerhash: v.registerhash, forsok: 0,
      ko_status: 'koad', extern_id: `registerkopia:${contractId}`, status: 'overifierad' });
  });
  it('K2 statusändringen får version 2 medan hela version 1 och köposten står kvar', async () => {
    const { contractId } = await importerat('K2');
    const fore = (await versioner(contractId))[0]!;
    const post = (await kopieposter(contractId))[0]!;
    await paborja(contractId);
    const efter = await versioner(contractId);
    expect(efter).toHaveLength(2);
    expect(efter[0]).toEqual(fore);
    expect((await kopieposter(contractId)).find((r) => r.id === post.id)).toEqual(post);
    expect(efter[0]!.rader.find((r: Registerkopierad) => r.kod === 'L1').status).toBe('ej_paborjad');
    expect(efter[1]!.rader.find((r: Registerkopierad) => r.kod === 'L1').status).toBe('pagar');
    expect(efter[1]!.registerversion).toBe(2);
    expect(await kopieposter(contractId)).toHaveLength(2);
  });
  it('K3 fälld import lämnar inget, lyckad import ger version och kopplad köpost', async () => {
    const p = (await ok('create_project', { name: 'Osignerat K3' })).id as string;
    const a = (await ok('create_contract', { project_id: p, name: 'Utkast K3' })).id as string;
    const res = await act('importera_leveranskontrakt', { contract_id: a, kontraktstext: LEVERANSKONTRAKT_NVR001 });
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect(res.body.error).toBe('valid_from_required');
    expect(await versioner(a)).toEqual([]);
    expect(await kopieposter(a)).toEqual([]);
    const u = await importerat('K3-kontroll');
    const vs = await versioner(u.contractId);
    const poster = await kopieposter(u.contractId);
    expect(vs).toHaveLength(1);
    expect(poster).toHaveLength(1);
    expect(poster[0]!.registerkopia_id).toBe(vs[0]!.id);
  });
  it('K4 samtidiga ändringar med FK-lås får varsitt löpnummer utan dödläge', async () => {
    const { contractId } = await importerat('K4');
    const n = (await versioner(contractId)).at(-1)!.registerversion as number;
    let antal = 0;
    let slapp!: () => void;
    const bada = new Promise<void>((r) => { slapp = r; });
    const koa = () => tx(async (c) => {
      await c.query('SELECT 1 FROM contracts WHERE id=$1 AND company_id=$2 FOR KEY SHARE', [contractId,companyId]);
      if (++antal === 2) slapp();
      await bada;
      return koaRegisterkopia(c, companyId, contractId);
    });
    const kopior = await Promise.all([koa(), koa()]);
    expect(new Set(kopior.map((r) => r.referens_id)).size).toBe(2);
    expect((await versioner(contractId)).map((r) => r.registerversion)).toEqual([n,n+1,n+2]);
    expect(await kopieposter(contractId)).toHaveLength(3);
  });
  it('K5 ny version ärver Drive-id och den skrivna versionens köpost står kvar', async () => {
    const { contractId } = await importerat('K5');
    const post = (await kopieposter(contractId))[0]!;
    await rapport(post.id, DRIVE_ID);
    const fore = (await kopieposter(contractId))[0]!;
    await paborja(contractId);
    const poster = await kopieposter(contractId);
    expect(poster).toHaveLength(2);
    expect(poster.find((r) => r.id === post.id)).toEqual(fore);
    const ny = poster.find((r) => r.id !== post.id)!;
    expect(ny).toMatchObject({ extern_id: DRIVE_ID, ko_status: 'koad' });
    expect(ny.registerkopia_id).toBe((await versioner(contractId))[1]!.id);
  });
  it('K6 köpost utan version ersätts och båda gamla utfallen ger 200 utan ändring', async () => {
    const { contractId } = await nyttUppdrag('K6');
    const gammal = await withAdmin(async (c) => {
      await c.query("INSERT INTO uppdrag_leverabel (company_id,contract_id,kod,status) VALUES ($1,$2,'L1','ej_paborjad')", [companyId,contractId]);
      return (await c.query(`INSERT INTO uppdrag_referens
        (company_id,contract_id,sort,extern_id,extern_nyckel,extern_kalla,ko_status,ko_fel)
        VALUES ($1,$2,'drive',$3,'registerkopia','drive:sparrmapp','fel','gammalt fel') RETURNING *`,
      [companyId,contractId,`registerkopia:${contractId}`])).rows[0]!;
    });
    await paborja(contractId);
    expect(await versioner(contractId)).toHaveLength(1);
    const ersatt = (await kopieposter(contractId)).find((r) => r.id === gammal.id)!;
    expect(ersatt).toMatchObject({ ko_status: 'ersatt', ko_fel: 'gammalt fel', registerkopia_id: null });
    await ok('rapportera_drive_kopia', { referens_id: gammal.id, utfall: { lage: 'fel', fel: 'nytt gammalt fel' } }, agent());
    expect((await kopieposter(contractId)).find((r) => r.id === gammal.id)).toEqual(ersatt);
    await ok('kor_uppdragssvep', { drive_kopior: [{ referens_id: gammal.id, utfall: { lage: 'skriven', drive_id: DRIVE_ID } }] }, agent());
    expect((await kopieposter(contractId)).find((r) => r.id === gammal.id)).toEqual(ersatt);
  });
});

const vanligReferens = (c: pg.PoolClient, avtal: string, id: string) => skapaReferens(c, companyId, {
  contract_id: avtal, sort: 'drive', extern_id: id, extern_nyckel: 'dokument', extern_kalla: 'drive:sparrmapp',
});

describe('Referenslistor, cache och Drive-id under avtalslåset', () => {
  it('L1 bara senaste kopieposten visas och bara den skrivna senaste verifieras', async () => {
    const { contractId } = await importerat('L1');
    const gammal = (await kopieposter(contractId))[0]!;
    await rapport(gammal.id, DRIVE_ID);
    await paborja(contractId);
    const ny = (await kopieposter(contractId)).find((r) => r.id !== gammal.id)!;
    expect(ny).toMatchObject({ ko_status: 'koad', extern_id: DRIVE_ID, status: 'overifierad' });
    const synliga = (await tx((c) => listaReferenser(c, companyId, contractId))).filter((r) => r.extern_nyckel === 'registerkopia');
    expect(synliga).toHaveLength(1);
    expect(synliga[0]).toMatchObject({ id: ny.id, status: 'overifierad' });
    const lista = (svar: Record<string, any>) => svar.arbetslista.referenser.filter((r: { contract_id: string; extern_nyckel: string }) =>
      r.contract_id === contractId && r.extern_nyckel === 'registerkopia');
    expect(lista(await ok('kor_uppdragssvep', {}, agent()))).toEqual([]);
    await rapport(ny.id, DRIVE_ID);
    expect(lista(await ok('kor_uppdragssvep', {}, agent())).map((r: { referens_id: string }) => r.referens_id)).toEqual([ny.id]);
  });
  it('L2 kvittens med vanlig referens id ger 409 utan ändring, annat id går igenom', async () => {
    const { contractId } = await importerat('L2');
    const post = (await kopieposter(contractId))[0]!;
    const id = `${DRIVE_ID}-E`;
    await tx((c) => vanligReferens(c, contractId, id));
    const res = await act('rapportera_drive_kopia', { referens_id: post.id, utfall: { lage: 'skriven', drive_id: id } }, agent());
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(res.body.error).toBe('referens_finns_redan');
    expect((await kopieposter(contractId))[0]).toEqual(post);
    await rapport(post.id, `${DRIVE_ID}-F`);
    expect((await kopieposter(contractId))[0]!.extern_id).toBe(`${DRIVE_ID}-F`);
  });
  it('L4 kvittensen först: vanlig referens väntar och fälls efter commit', async () => {
    await samtidigKrock('L4', true);
  });
  it('L5 vanlig referens först: kvittensen väntar och lämnar köposten orörd', async () => {
    await samtidigKrock('L5', false);
  });
  it('L3 cachetömning och svep lämnar historik och versionskopplingar orörda', async () => {
    const { contractId } = await importerat('L3');
    await paborja(contractId);
    const oppnaUtanVersion = await withAdmin(async (c) => (await c.query(
      "SELECT id FROM uppdrag_referens WHERE company_id=$1 AND extern_nyckel='registerkopia' AND registerkopia_id IS NULL AND ko_status IN ('koad','fel')", [companyId],
    )).rows);
    expect(oppnaUtanVersion).toEqual([]);
    const las = () => withAdmin(async (c) => ({
      historik: (await c.query('SELECT * FROM uppdrag_registerkopia WHERE company_id=$1 ORDER BY id', [companyId])).rows,
      koppling: (await c.query("SELECT id,registerkopia_id,registerhash,contract_id FROM uppdrag_referens WHERE company_id=$1 AND contract_id=$2 AND extern_nyckel='registerkopia' ORDER BY id", [companyId,contractId])).rows,
    }));
    const fore = await las();
    expect(fore.historik.length).toBeGreaterThan(0);
    expect(fore.koppling).toHaveLength(2);
    const cache = await withAdmin(async (c) => (await c.query(
      "SELECT relname,obj_description(oid,'pg_class') AS kommentar FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind='r' AND relname LIKE 'uppdrag%' ORDER BY relname",
    )).rows.filter((r) => r.kommentar?.toLowerCase().match(/^\s*kategori:\s*([^.,;]*)/)?.[1]?.trim() === 'cache').map((r) => r.relname as string));
    expect(cache).toEqual(['uppdrag_dokument','uppdrag_dokumentrot','uppdrag_svepvarde']);
    await tx(async (c) => { for (const tabell of cache) await c.query(`DELETE FROM ${tabell} WHERE company_id=$1`, [companyId]); });
    await ok('kor_uppdragssvep', {}, agent());
    expect(await las()).toEqual(fore);
  });
});

/** Två verkliga transaktioner; låsväntan avgörs ur katalogen, aldrig av sovtid. */
async function samtidigKrock(namn: string, kvittensForst: boolean) {
  const { contractId } = await importerat(namn);
  const post = (await kopieposter(contractId))[0]!;
  const id = `${DRIVE_ID}-${namn}`;
  const kvittera = (c: pg.PoolClient) => rapporteraDriveKopia(c, companyId, {
    referens_id: post.id, utfall: { lage: 'skriven', drive_id: id },
  });
  let slapp!: () => void;
  const fortsatta = new Promise<void>((r) => { slapp = r; });
  let redo!: () => void;
  const skrivit = new Promise<void>((r) => { redo = r; });
  const a = tx(async (c) => {
    try {
      if (kvittensForst) await kvittera(c); else await vanligReferens(c, contractId, id);
    } finally { redo(); }
    await fortsatta;
  });
  // Koppla felhanteraren direkt, så ett fel i A inte ger ett osett avslag.
  const aUtfall = fel(a);
  await skrivit;
  let avgjord = false;
  let pid!: number;
  let bRedo!: () => void;
  const bStartad = new Promise<void>((r) => { bRedo = r; });
  const b = fel(tx(async (c) => {
    pid = (await c.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid;
    bRedo();
    if (kvittensForst) await vanligReferens(c, contractId, id); else await kvittera(c);
  })).then((e) => { avgjord = true; return e; });
  let last = false;
  try {
    await bStartad;
    const slut = Date.now() + 5000;
    await withAdmin(async (c) => {
      while (!avgjord && Date.now() < slut) {
        last = (await c.query("SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND pid=$1 AND wait_event_type='Lock'", [pid])).rows.length > 0;
        if (last) break;
        await new Promise((r) => setTimeout(r, 10));
      }
    });
  } finally { slapp(); }
  expect(await aUtfall).toBeNull();
  const bFel = await b;
  expect(last, 'B ska vänta på avtalslåset innan A committas').toBe(true);
  expect(bFel).toMatchObject({ code: 'referens_finns_redan' });
  const rader = await withAdmin(async (c) => (await c.query(
    "SELECT id FROM uppdrag_referens WHERE company_id=$1 AND contract_id=$2 AND sort='drive' AND extern_id=$3", [companyId,contractId,id],
  )).rows);
  expect(rader).toHaveLength(1);
  if (kvittensForst) expect(rader[0]!.id).toBe(post.id);
  else expect((await kopieposter(contractId))[0]).toEqual(post);
}

function koord(text: string) { return text.match(/\b(?:hamtaDriveKo|ko_status|ko_fel)\b/g) ?? []; }
async function vyfiler(dir = new URL('../src/http/view/', import.meta.url)): Promise<string[]> {
  const texter: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = new URL(entry.name + (entry.isDirectory() ? '/' : ''), dir);
    if (entry.isDirectory()) texter.push(...await vyfiler(path));
    else if (entry.name.endsWith('.ts')) texter.push(await readFile(path, 'utf8'));
  }
  return texter;
}

describe('Davids vyer läser registret och visar aldrig tekniska köposter', () => {
  let u: Awaited<ReturnType<typeof importerat>>;
  let markor: string;
  let fore: number;
  const pagar = async () => {
    const lage = await ok('las_uppdragslage', { project_id: u.projektId });
    const avtal = lage.avtal.find((r: { contract_id: string }) => r.contract_id === u.contractId);
    expect(avtal).toBeDefined();
    return avtal.leverabler.find((r: { lage: string }) => r.lage === 'pagar').antal as number;
  };
  beforeAll(async () => {
    u = await importerat('V1-V2');
    markor = `MARKOR-${randomUUID()}`;
    await ok('rapportera_drive_kopia', { referens_id: (await kopieposter(u.contractId))[0]!.id,
      utfall: { lage: 'fel', fel: `Drive svarade 403: ${markor}` } }, agent());
    fore = await pagar();
    await paborja(u.contractId);
  });
  it('V1 felmarkören finns i kön men inte på projektsidan, Läget, undantagsvyn eller i vykällan', async () => {
    const ko = await ok('hamta_drive_ko', {}, agent()) as unknown as { ko_fel: string | null }[];
    expect(ko.some((k) => k.ko_fel?.includes(markor))).toBe(true);
    for (const path of [`projects/${u.projektId}`, `projects/${u.projektId}/laget`, 'uppdrag']) {
      const res = await ua.get(`/app/c/${companyId}/${path}`);
      expect(res.status, `${path}: ${res.text}`).toBe(200);
      for (const text of [markor, 'Kopia köad', 'Kopian kunde inte skrivas']) expect(res.text).not.toContain(text);
    }
    const filer = await vyfiler();
    expect(filer.length).toBeGreaterThan(0);
    expect(filer.flatMap(koord)).toEqual([]);
    expect(koord('planterat hamtaDriveKo(')).toEqual(['hamtaDriveKo']);
  });
  it('V2 Läget visar statusändringen direkt ur den gällande databasposten', async () => {
    expect(await pagar()).toBe(fore + 1);
  });
});

const DOKUMENTPUNKT = '- **Versionsbunden kopia (Story 3.3).**';
const NYA_NAMN = ['uppdrag_registerkopia', 'registerkopia_id', 'referens_finns_redan'];
const normalisera = (text: string) => text.replace(/\s+/g, ' ');
function gamlaFraser(text: string) {
  return ['ENA kopiereferens', 'visar den öppna köposten'].filter((fras) => normalisera(text).includes(fras));
}
function ensammaNamn(text: string) {
  return [...text.matchAll(/`([^`]+)`/g)].map((m) => m[1]!).filter((namn) => NYA_NAMN.includes(namn));
}
it('D1 dokumentationen beskriver versionsbunden kopia och håller handgreppens namnrymd', async () => {
  const doc = await readFile(new URL('../../docs/MCP_ACTIONS.md', import.meta.url), 'utf8');
  const sektion = doc.split(/^## Uppdragsytan[^\n]*\n/m)[1]?.split(/^## /m)[0];
  expect(sektion).toBeDefined();
  const punkt = sektion!.split(DOKUMENTPUNKT)[1]?.split(/\n\s*\n/)[0];
  expect(punkt, 'den versionsbundna kopians punkt saknas').toBeDefined();
  for (const ord of ['registerversion','registerhash','ersatt']) expect(punkt).toContain(ord);
  expect(gamlaFraser(sektion!)).toEqual([]);
  expect(gamlaFraser('ENA\nkopiereferens; visar den öppna\nköposten')).toEqual(['ENA kopiereferens','visar den öppna köposten']);
  expect(ensammaNamn(sektion!)).toEqual([]);
  for (const namn of NYA_NAMN) expect(ensammaNamn(`${DOKUMENTPUNKT} planterat \`${namn}\``)).toEqual([namn]);
  expect(ensammaNamn('`409 referens_finns_redan`')).toEqual([]);
});
