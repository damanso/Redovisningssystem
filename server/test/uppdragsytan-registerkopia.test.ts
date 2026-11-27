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
import { ACTIONS } from '../src/actions/registry.js';
import {
  REGISTERKOPIA_TEXT, renderaRegisterkopia, registerkopiansHash,
  lasLeverabelregister, type Registerkopierad,
} from '../src/services/uppdragRegister.js';
import { KOSTATUSAR, koaRegisterkopia, listaReferenser, rapporteraDriveKopia, skapaReferens, verifieraReferens } from '../src/services/uppdragReferens.js';
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

describe('AI-Review 1–2: bara en skriven kopieversion får verifieras som färdig', () => {
  for (const kostatus of [...KOSTATUSAR.filter((s) => s !== 'skriven'), null]) {
    for (const arvtId of [false, true]) {
      it(`F1 ${kostatus}, ${arvtId ? 'ärvt fil-id' : 'platshållare'}: observationer färdigställer aldrig kopian`, async () => {
        const { contractId } = kostatus === null ? await nyttUppdrag(`F1-aldre-${arvtId}`)
          : await importerat(`F1-${kostatus}-${arvtId}`);
        if (kostatus === null) await withAdmin((c) => c.query(
          `INSERT INTO uppdrag_referens (company_id,contract_id,sort,extern_id,extern_nyckel,extern_kalla)
           VALUES ($1,$2,'drive',$3,'registerkopia','drive:sparrmapp')`,
          [companyId, contractId, `registerkopia:${contractId}`],
        ));
        const post = (await kopieposter(contractId))[0]!;
        await withAdmin((c) => c.query(
          'UPDATE uppdrag_referens SET ko_status=$3, extern_id=$4 WHERE company_id=$1 AND id=$2',
          [companyId, post.id, kostatus, arvtId ? `${DRIVE_ID}-F1` : post.extern_id],
        ));
        for (const lage of [{ finns: true } as const, { finns: true, hash: 'annat-innehall' } as const, { finns: false } as const]) {
          const svar = await tx((c) => verifieraReferens(c, companyId, post.id, lage));
          expect(svar.referens.status).toBe('overifierad');
          expect((await kopieposter(contractId))[0]).toMatchObject({ status: 'overifierad', ko_status: kostatus });
        }
      });
    }
  }
  it('F2 HTTP: version 2 med version 1:s fil-id är overifierad tills den skrivits och verifierats', async () => {
    const { contractId } = await importerat('F2');
    await rapport((await kopieposter(contractId))[0]!.id, `${DRIVE_ID}-F2`);
    await paborja(contractId);
    const post = (await kopieposter(contractId)).find((r) => r.ko_status === 'koad')!;
    expect(post.extern_id).toBe(`${DRIVE_ID}-F2`);
    const svep = () => ok('kor_uppdragssvep', { uppdrag: [{ contract_id: contractId,
      referenser: [{ referens_id: post.id, lage: { finns: true } }],
    }] }, agent());
    await svep();
    expect((await kopieposter(contractId)).find((r) => r.id === post.id)).toMatchObject({ ko_status: 'koad', status: 'overifierad' });
    expect((await tx((c) => listaReferenser(c, companyId, contractId))).find((r) => r.id === post.id)?.status).toBe('overifierad');
    await rapport(post.id, post.extern_id);
    await svep();
    expect((await kopieposter(contractId)).find((r) => r.id === post.id)).toMatchObject({ ko_status: 'skriven', status: 'levande' });
  });
});

describe('AI-Review 3: spärrdom och återhämtning följer filidentiteten', () => {
  for (const sparrForst of [true, false]) {
    it(`F3 spärr ${sparrForst ? 'före' : 'efter'} nästa version: länken döljs tills verifierad återflytt`, async () => {
      const { contractId, projektId } = await importerat(`F3-${sparrForst}`);
      const fil = `${DRIVE_ID}-F3-${sparrForst}`;
      const gammal = (await kopieposter(contractId))[0]!;
      await rapport(gammal.id, fil);
      // Samma fil-id i ett annat avtal får aldrig ärva den här spärrdomen.
      const granne = await importerat(`F3-annat-${sparrForst}`);
      await rapport((await kopieposter(granne.contractId))[0]!.id, fil);
      const oberord = await kopieposter(granne.contractId);
      const observera = (id: string, kedja?: string[], finns = true) => ok('kor_uppdragssvep', {
        uppdrag: [{ contract_id: contractId, sparrmapp_id: 'F3-sparrmapp', referenser: [{
          referens_id: id, lage: { finns }, ...(kedja === undefined ? {} : { foralderkedja: kedja }),
        }] }],
      }, agent());
      if (sparrForst) await observera(gammal.id, ['F3-annan-mapp']);
      await tx((c) => koaRegisterkopia(c, companyId, contractId));
      if (!sparrForst) await observera(gammal.id, ['F3-annan-mapp']);
      await tx((c) => koaRegisterkopia(c, companyId, contractId));
      const alla = await kopieposter(contractId);
      const senaste = alla[alla.length - 1]!;
      expect(alla).toHaveLength(3);
      expect(alla.every((r) => r.status === 'utanfor_sparr' && r.extern_id === fil)).toBe(true);
      const sy = await ok('las_kontraktsyta', { contract_id: contractId });
      expect(sy.dokument.referenser.some((r: { extern_id: string }) => r.extern_id === fil)).toBe(false);
      expect(sy.dokument.utanfor_sparr).toContain(senaste.id);
      const html = await ua.get(`/app/c/${companyId}/projects/${projektId}/kontraktet`);
      expect(html.status, html.text).toBe(200);
      expect(html.text).not.toContain(`https://drive.google.com/open?id=${fil}`);
      const lista = await ok('kor_uppdragssvep', {}, agent());
      expect(lista.arbetslista.referenser.filter((r: { contract_id: string }) => r.contract_id === contractId)
        .map((r: { referens_id: string }) => r.referens_id)).toContain(senaste.id);
      // Varken en observation utan föräldrar eller en saknad fil häver spärren.
      await observera(senaste.id);
      await observera(senaste.id, undefined, false);
      expect((await kopieposter(contractId)).every((r) => r.status === 'utanfor_sparr')).toBe(true);
      const fore = await kopieposter(contractId);
      const avvisad = await act('rapportera_drive_kopia', { referens_id: senaste.id,
        utfall: { lage: 'skriven', drive_id: fil } }, agent());
      expect(avvisad.status, JSON.stringify(avvisad.body)).toBe(409);
      expect(avvisad.body.error).toBe('utanfor_sparr');
      expect(await kopieposter(contractId)).toEqual(fore);
      await observera(senaste.id, ['F3-sparrmapp']);
      expect((await kopieposter(contractId)).every((r) => r.status !== 'utanfor_sparr')).toBe(true);
      expect((await kopieposter(contractId)).find((r) => r.id === senaste.id)?.status).toBe('overifierad');
      await rapport(senaste.id, fil);
      await observera(senaste.id, ['F3-sparrmapp']);
      expect((await kopieposter(contractId)).find((r) => r.id === senaste.id)?.status).toBe('levande');
      expect(await kopieposter(granne.contractId)).toEqual(oberord);
    });
  }
});

/** A håller avtalet medan B når sin låsväntan. Alla löften avslutas även vid fel. */
async function konkurrera(
  contractId: string, fore: (c: pg.PoolClient) => Promise<unknown>,
  efter: (c: pg.PoolClient) => Promise<unknown>, bSkriv: (c: pg.PoolClient) => Promise<unknown>,
) {
  let redo!: () => void;
  let slapp!: () => void;
  const startad = new Promise<void>((r) => { redo = r; });
  const fortsatt = new Promise<void>((r) => { slapp = r; });
  const a = fel(tx(async (c) => {
    try {
      await c.query('SELECT 1 FROM contracts WHERE id=$1 AND company_id=$2 FOR NO KEY UPDATE', [contractId, companyId]);
      await fore(c);
    } finally { redo(); }
    await fortsatt;
    await efter(c);
  }));
  await startad;
  let pid!: number;
  let avgjord = false;
  let bRedo!: () => void;
  const bStartad = new Promise<void>((r) => { bRedo = r; });
  const b = fel(tx(async (c) => {
    try { pid = (await c.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid; }
    finally { bRedo(); }
    await bSkriv(c);
  })).then((e) => { avgjord = true; return e; });
  let last = false;
  try {
    await bStartad;
    await withAdmin(async (c) => {
      const slut = Date.now() + 5000;
      while (!avgjord && Date.now() < slut) {
        last = (await c.query("SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND pid=$1 AND wait_event_type='Lock'", [pid])).rows.length > 0;
        if (last) break;
        await new Promise((r) => setTimeout(r, 10));
      }
    });
  } finally { slapp(); }
  const [aFel, bFel] = await Promise.all([a, b]);
  expect(aFel).toBeNull();
  expect(last, 'B ska ta samma avtalslås före tillståndskontrollen').toBe(true);
  return bFel;
}

describe('AI-Review 4: tillstånd prövas efter avtalslåset för varje kvittens', () => {
  for (const lage of ['skriven', 'fel'] as const) {
    for (const fran of ['koad', 'fel'] as const) {
      it(`F4 köningen ersätter ${fran} medan ${lage}-kvittensen väntar: hela raden förblir ersatt`, async () => {
        const { contractId } = await nyttUppdrag(`F4-${fran}-${lage}`);
        const gammal = await withAdmin(async (c) => (await c.query(
          `INSERT INTO uppdrag_referens (company_id,contract_id,sort,extern_id,extern_nyckel,extern_kalla,ko_status,ko_fel)
           VALUES ($1,$2,'drive',$3,'registerkopia','drive:sparrmapp',$4,'bevarat fel') RETURNING *`,
          [companyId, contractId, `registerkopia:${contractId}`, fran],
        )).rows[0]!);
        let svar: Awaited<ReturnType<typeof rapporteraDriveKopia>> | undefined;
        const bFel = await konkurrera(contractId, async () => {},
          (c) => koaRegisterkopia(c, companyId, contractId), async (c) => {
            svar = await rapporteraDriveKopia(c, companyId, { referens_id: gammal.id,
              utfall: lage === 'skriven' ? { lage, drive_id: `${DRIVE_ID}-F4` } : { lage, fel: 'ska aldrig skrivas' } });
          });
        expect(bFel).toBeNull();
        expect(svar).toMatchObject({ referens_id: gammal.id, ko_status: 'ersatt', ko_fel: gammal.ko_fel, extern_id: gammal.extern_id });
        expect((await kopieposter(contractId)).find((r) => r.id === gammal.id)).toEqual({ ...gammal, ko_status: 'ersatt' });
      });
    }
    it(`F5 skriven först, samtidig ${lage}-kvittens får inte öppna eller skriva över posten`, async () => {
      const { contractId } = await importerat(`F5-${lage}`);
      const post = (await kopieposter(contractId))[0]!;
      const bFel = await konkurrera(contractId,
        (c) => rapporteraDriveKopia(c, companyId, { referens_id: post.id, utfall: { lage: 'skriven', drive_id: `${DRIVE_ID}-F5` } }),
        async () => {},
        (c) => rapporteraDriveKopia(c, companyId, { referens_id: post.id,
          utfall: lage === 'skriven' ? { lage, drive_id: `${DRIVE_ID}-annat` } : { lage, fel: 'ska aldrig skrivas' } }));
      expect(bFel).toMatchObject({ code: 'ingen_oppen_kopost' });
      expect((await kopieposter(contractId))[0]).toMatchObject({ ko_status: 'skriven', extern_id: `${DRIVE_ID}-F5`, ko_fel: null });
    });
  }
});

it('F6 spärren omfattar målposten själv och följer inte med när filidentiteten byts', async () => {
  const { contractId } = await nyttUppdrag('F6-aldre-kopost');
  const post = await withAdmin(async (c) => (await c.query(
    `INSERT INTO uppdrag_referens (company_id,contract_id,sort,extern_id,extern_nyckel,extern_kalla,ko_status,status)
     VALUES ($1,$2,'drive',$3,'registerkopia','drive:sparrmapp','fel','utanfor_sparr') RETURNING *`,
    [companyId, contractId, `${DRIVE_ID}-F6-sparr`],
  )).rows[0]!);
  const res = await act('rapportera_drive_kopia', { referens_id: post.id,
    utfall: { lage: 'skriven', drive_id: post.extern_id } }, agent());
  expect(res.status, JSON.stringify(res.body)).toBe(409);
  expect(res.body.error).toBe('utanfor_sparr');
  expect((await kopieposter(contractId))[0]).toEqual(post);
  const annat = `${DRIVE_ID}-F6-ny-fil`;
  await rapport(post.id, annat);
  expect((await kopieposter(contractId))[0]).toMatchObject({ ko_status: 'skriven', extern_id: annat, status: 'overifierad' });
  await tx((c) => koaRegisterkopia(c, companyId, contractId));
  expect((await kopieposter(contractId)).at(-1)).toMatchObject({ extern_id: annat, status: 'overifierad' });
});

for (const verifieringForst of [true, false]) {
  it(`F7 ${verifieringForst ? 'verifiering' : 'köning'} först: samtidig spärrdom och versionsbyte följer samma avtalslås`, async () => {
    const { contractId } = await importerat(`F7-${verifieringForst}`);
    const post = (await kopieposter(contractId))[0]!;
    await rapport(post.id, `${DRIVE_ID}-F7`);
    const verifiera = (c: pg.PoolClient) => verifieraReferens(c, companyId, post.id, { finns: true }, { sparr: 'utanfor' });
    const koa = (c: pg.PoolClient) => koaRegisterkopia(c, companyId, contractId);
    const bFel = await konkurrera(contractId, verifieringForst ? verifiera : koa, async () => {}, verifieringForst ? koa : verifiera);
    expect(bFel).toBeNull();
    const poster = await kopieposter(contractId);
    expect(poster).toHaveLength(2);
    expect(poster.every((r) => r.status === 'utanfor_sparr')).toBe(true);
  });
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

// Story 3.6: arbetslistan bär den frysta versionen, även i nya transaktioner.
const kon = async (avtal: string) => {
  const res = await act('hamta_drive_ko', {}, agent());
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return (res.body.result as Record<string, any>[]).filter((r) => r.contract_id === avtal);
};
const kvittera = (id: string, utfall: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  act('rapportera_drive_kopia', { referens_id: id, utfall, ...extra }, agent());

describe('Story 3.6: arbetslistan läser versionen', () => {
  it('H1 svarets exakta form och värden kommer ur versionen', async () => {
    const { contractId } = await importerat('H1');
    const v = (await versioner(contractId))[0]!;
    const poster = await kon(contractId);
    expect(poster).toHaveLength(1);
    const post = poster[0]!;
    expect(Object.keys(post).sort()).toEqual(['contract_id', 'extern_id', 'forsok', 'innehall', 'ko_fel',
      'ko_status', 'referens_id', 'registerhash', 'registerkopia_id', 'registertext', 'registerversion']);
    expect(post).toMatchObject({ registertext: v.innehall, registerhash: v.registerhash,
      registerversion: v.registerversion, registerkopia_id: v.id, innehall: v.rader,
      forsok: 0, extern_id: `registerkopia:${contractId}` });
    expect(v.registerversion).toBe(1);
    expect(post.innehall).toHaveLength(6);
  });
  it('H2 ändrat register utan köning skriver aldrig om arbetslistans innehåll', async () => {
    const { contractId } = await importerat('H2');
    const fore = (await kon(contractId))[0]!;
    await withAdmin((c) => c.query(
      "UPDATE uppdrag_leverabel SET status='pagar' WHERE company_id=$1 AND contract_id=$2 AND kod='L1'",
      [companyId, contractId],
    ));
    const nu = await tx((c) => lasLeverabelregister(c, companyId, { contract_id: contractId }));
    expect(nu.find((r) => r.kod === 'L1')?.status).toBe('pagar');
    const efter = (await kon(contractId))[0]!;
    expect(efter.registertext).toBe(fore.registertext);
    expect(efter.innehall).toEqual(fore.innehall);
    expect(efter.innehall.find((r: Registerkopierad) => r.kod === 'L1')?.status).toBe('ej_paborjad');
  });
  it('H3 bara köade och felade poster med version delas ut', async () => {
    const avtal = await Promise.all(['koad', 'fel', 'skriven', 'ersatt'].map((s) => importerat(`H3-${s}`)));
    const poster = await Promise.all(avtal.map(async (a) => (await kopieposter(a.contractId))[0]!));
    const felad = await kvittera(poster[1]!.id, { lage: 'fel', fel: 'H3 fel' });
    expect(felad.status, JSON.stringify(felad.body)).toBe(200);
    await rapport(poster[2]!.id, `${DRIVE_ID}-H3`);
    await withAdmin((c) => c.query("UPDATE uppdrag_referens SET ko_status='ersatt' WHERE company_id=$1 AND id=$2", [companyId, poster[3]!.id]));
    const gammalt = await nyttUppdrag('H3-utan-version');
    const gammal = await withAdmin(async (c) => (await c.query(
      `INSERT INTO uppdrag_referens (company_id,contract_id,sort,extern_id,extern_nyckel,extern_kalla,ko_status,ko_fel)
       VALUES ($1,$2,'drive',$3,'registerkopia','drive:sparrmapp','fel','gammalt fel') RETURNING *`,
      [companyId, gammalt.contractId, `registerkopia:${gammalt.contractId}`],
    )).rows[0]!);
    expect(gammal).toMatchObject({ ko_status: 'fel', registerkopia_id: null });
    const res = await act('hamta_drive_ko', {}, agent());
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const ids = (res.body.result as { referens_id: string }[]).map((r) => r.referens_id);
    expect(ids).toContain(poster[0]!.id);
    expect(ids).toContain(poster[1]!.id);
    for (const post of [poster[2]!, poster[3]!, gammal]) expect(ids).not.toContain(post.id);
  });
  it('H4 nästa svep behåller A:s felade version före B:s nya version', async () => {
    const { contractId } = await importerat('H4');
    const felad = await kvittera((await kopieposter(contractId))[0]!.id, { lage: 'fel', fel: 'H4 fel' });
    expect(felad.status, JSON.stringify(felad.body)).toBe(200);
    await paborja(contractId);
    const vs = await versioner(contractId);
    const svep = await ok('kor_uppdragssvep', {}, agent());
    const poster = (svep.arbetslista.drive_ko as Record<string, any>[]).filter((r) => r.contract_id === contractId);
    expect(poster).toHaveLength(2);
    for (const [i, post] of poster.entries()) {
      expect(post).toMatchObject({ registerversion: vs[i]!.registerversion,
        registerhash: vs[i]!.registerhash, registertext: vs[i]!.innehall, innehall: vs[i]!.rader });
    }
    expect(poster.map((p) => p.registerversion)).toEqual([1, 2]);
    expect(poster[0]!.registerhash).not.toBe(poster[1]!.registerhash);
    expect(poster[0]!.registertext).not.toBe(poster[1]!.registertext);
    expect(poster[0]!.innehall.find((r: Registerkopierad) => r.kod === 'L1')?.status).toBe('ej_paborjad');
    expect(poster[1]!.innehall.find((r: Registerkopierad) => r.kod === 'L1')?.status).toBe('pagar');
  });
  it('H9 regression: befintlig strikt läsåtgärd och ingen driftrutt', async () => {
    const driveNamn = (namn: string[]) => namn.filter((n) => n.includes('drive')).sort();
    const befintliga = ['hamta_drive_ko', 'rapportera_drive_kopia'];
    expect(driveNamn(ACTIONS.map((a) => a.name))).toEqual(befintliga);
    expect(driveNamn([...befintliga, 'las_drive_ko'])).not.toEqual(befintliga);
    const hamta = ACTIONS.find((a) => a.name === 'hamta_drive_ko')!;
    expect(hamta.sensitivity).toBe('read');
    expect(hamta.inputSchema.safeParse({}).success).toBe(true);
    expect(hamta.inputSchema.safeParse({ x: 1 }).success).toBe(false);
    const drift = /\.get\(\s*['"`][^'"`]*\/drift['"`]/g;
    const texter = await vyfiler();
    expect(texter.length).toBeGreaterThan(0);
    expect(texter.flatMap((text) => text.match(drift) ?? [])).toEqual([]);
    expect("router.get('/app/c/:companyId/drift', handler)".match(drift)).toHaveLength(1);
  });
});

describe('Story 3.6: svepet fryser äldre köposter', () => {
  it('H7 bara öppna avtals köposter utan version fryses, en gång', async () => {
    const oppet = await nyttUppdrag('H7-oppet');
    const stangt = await nyttUppdrag('H7-stangt');
    for (const u of [oppet, stangt]) {
      await withAdmin(async (c) => {
        await c.query("INSERT INTO uppdrag_leverabel (company_id,contract_id,kod) VALUES ($1,$2,'L1')", [companyId, u.contractId]);
        await c.query(
          `INSERT INTO uppdrag_referens (company_id,contract_id,sort,extern_id,extern_nyckel,extern_kalla,ko_status,ko_fel)
           VALUES ($1,$2,'drive',$3,'registerkopia','drive:sparrmapp','fel','gammalt fel')`,
          [companyId, u.contractId, `registerkopia:${u.contractId}`],
        );
      });
      expect(await versioner(u.contractId)).toEqual([]);
    }
    await ok('set_project_status', { project_id: stangt.projektId, status: 'closed' });
    const gammal = (await kopieposter(oppet.contractId))[0]!;
    const stangdFore = await kopieposter(stangt.contractId);
    const svep = await ok('kor_uppdragssvep', {}, agent());
    expect((await kopieposter(oppet.contractId)).find((r) => r.id === gammal.id))
      .toEqual({ ...gammal, ko_status: 'ersatt' });
    const vs = await versioner(oppet.contractId);
    expect(vs).toHaveLength(1);
    expect(vs[0]!.rader).toHaveLength(1);
    expect(vs[0]!.rader[0].kod).toBe('L1');
    expect(vs[0]!.innehall).toContain('| L1 |');
    const poster = (svep.arbetslista.drive_ko as Record<string, any>[]).filter((r) => r.contract_id === oppet.contractId);
    expect(poster).toHaveLength(1);
    expect(poster[0]!.registerkopia_id).toBe(vs[0]!.id);
    expect(poster.map((r) => r.referens_id)).not.toContain(gammal.id);
    expect(await kopieposter(stangt.contractId)).toEqual(stangdFore);
    expect(await versioner(stangt.contractId)).toEqual([]);
    await ok('kor_uppdragssvep', {}, agent());
    expect(await versioner(oppet.contractId)).toEqual(vs);
  });
});

/** Samma A-fel och B-kö för kvittensens återspelningsfall. */
async function foljd(namn: string) {
  const u = await importerat(namn);
  const a = (await kopieposter(u.contractId))[0]!;
  const v = (await versioner(u.contractId))[0]!;
  const svar = await kvittera(a.id, { lage: 'fel', fel: `${namn} A-fel` },
    { registerversion: v.registerversion, registerhash: v.registerhash });
  expect(svar.status, JSON.stringify(svar.body)).toBe(200);
  await paborja(u.contractId);
  const poster = await kopieposter(u.contractId);
  const b = poster.find((r) => r.id !== a.id)!;
  const vs = await versioner(u.contractId);
  return { ...u, a: poster.find((r) => r.id === a.id)!, b, vs };
}

describe('Story 3.6: kvittensen gäller bara sin version', () => {
  it('Q1 skriven bär version och hash, räknar försöket och nollställer felet', async () => {
    const { contractId } = await importerat('Q1');
    const post = (await kopieposter(contractId))[0]!;
    const v = (await versioner(contractId))[0]!;
    const svar = await kvittera(post.id, { lage: 'skriven', drive_id: `${DRIVE_ID}-Q1` },
      { registerversion: v.registerversion, registerhash: v.registerhash });
    expect(svar.status, JSON.stringify(svar.body)).toBe(200);
    expect(svar.body.result).toMatchObject({ registerversion: 1, registerhash: v.registerhash });
    expect((await kopieposter(contractId))[0]).toMatchObject({ ko_status: 'skriven',
      extern_id: `${DRIVE_ID}-Q1`, ko_fel: null, forsok: 1 });
  });
  it('Q2 annan version eller hash fälls utan ändring, också för en köpost utan version', async () => {
    const { contractId } = await importerat('Q2');
    const post = (await kopieposter(contractId))[0]!;
    const v = (await versioner(contractId))[0]!;
    const annanHash = v.registerhash === '0'.repeat(64) ? '1'.repeat(64) : '0'.repeat(64);
    for (const extra of [{ registerversion: 2, registerhash: v.registerhash },
      { registerversion: v.registerversion, registerhash: annanHash }]) {
      const svar = await kvittera(post.id, { lage: 'skriven', drive_id: `${DRIVE_ID}-Q2` }, extra);
      expect(svar.status, JSON.stringify(svar.body)).toBe(409);
      expect(svar.body.error).toBe('kvittens_annan_version');
      expect((await kopieposter(contractId))[0]).toEqual(post);
    }
    const gammalt = await nyttUppdrag('Q2-utan-version');
    const gammal = await withAdmin(async (c) => (await c.query(
      `INSERT INTO uppdrag_referens (company_id,contract_id,sort,extern_id,extern_nyckel,extern_kalla,ko_status,ko_fel)
       VALUES ($1,$2,'drive',$3,'registerkopia','drive:sparrmapp','koad','gammalt fel') RETURNING *`,
      [companyId, gammalt.contractId, `registerkopia:${gammalt.contractId}`],
    )).rows[0]!);
    expect(gammal).toMatchObject({ registerkopia_id: null, ko_status: 'koad' });
    const avvisad = await kvittera(gammal.id, { lage: 'skriven', drive_id: `${DRIVE_ID}-Q2-gammal` },
      { registerversion: 1, registerhash: v.registerhash });
    expect(avvisad.status, JSON.stringify(avvisad.body)).toBe(409);
    expect(avvisad.body.error).toBe('kvittens_annan_version');
    expect((await kopieposter(gammalt.contractId))[0]).toEqual(gammal);
    const godkand = await kvittera(gammal.id, { lage: 'skriven', drive_id: `${DRIVE_ID}-Q2-gammal` });
    expect(godkand.status, JSON.stringify(godkand.body)).toBe(200);
  });
  it('Q3 A kvitteras utan att röra B, och skriven A ersätts aldrig av B', async () => {
    const { contractId } = await importerat('Q3');
    await paborja(contractId);
    const poster = await kopieposter(contractId);
    const vs = await versioner(contractId);
    const a = poster.find((r) => r.registerkopia_id === vs[0]!.id)!;
    const b = poster.find((r) => r.registerkopia_id === vs[1]!.id)!;
    const svarA = await kvittera(a.id, { lage: 'skriven', drive_id: `${DRIVE_ID}-Q3` },
      { registerversion: vs[0]!.registerversion, registerhash: vs[0]!.registerhash });
    expect(svarA.status, JSON.stringify(svarA.body)).toBe(200);
    const skrivenA = (await kopieposter(contractId)).find((r) => r.id === a.id)!;
    expect(skrivenA.ko_status).toBe('skriven');
    expect((await kopieposter(contractId)).find((r) => r.id === b.id)).toEqual(b);
    expect(b.ko_status).toBe('koad');
    expect((await kon(contractId)).map((r) => r.referens_id)).toContain(b.id);
    const svarB = await kvittera(b.id, { lage: 'skriven', drive_id: `${DRIVE_ID}-Q3` },
      { registerversion: vs[1]!.registerversion, registerhash: vs[1]!.registerhash });
    expect(svarB.status, JSON.stringify(svarB.body)).toBe(200);
    expect((await kopieposter(contractId)).find((r) => r.id === b.id)?.ko_status).toBe('skriven');
    expect((await kopieposter(contractId)).find((r) => r.id === a.id)).toEqual(skrivenA);
  });
  it('Q4 B ersätter oskrivna A och C utan version, bevarar deras fel och all historik', async () => {
    const { contractId, a, b, vs } = await foljd('Q4');
    const c = await withAdmin(async (client) => (await client.query(
      `INSERT INTO uppdrag_referens (company_id,contract_id,sort,extern_id,extern_nyckel,extern_kalla,ko_status,ko_fel)
       VALUES ($1,$2,'drive',$3,'registerkopia','drive:sparrmapp','fel','gammalt fel') RETURNING *`,
      [companyId, contractId, `registerkopia:${contractId}`],
    )).rows[0]!);
    expect(a.ko_status).toBe('fel');
    expect(c).toMatchObject({ ko_status: 'fel', registerkopia_id: null });
    expect(await kopieposter(contractId)).toHaveLength(3);
    const svar = await kvittera(b.id, { lage: 'skriven', drive_id: `${DRIVE_ID}-Q4` },
      { registerversion: vs[1]!.registerversion, registerhash: vs[1]!.registerhash });
    expect(svar.status, JSON.stringify(svar.body)).toBe(200);
    const efter = await kopieposter(contractId);
    expect(efter.find((r) => r.id === b.id)?.ko_status).toBe('skriven');
    for (const gammal of [a, c]) expect(efter.find((r) => r.id === gammal.id)).toEqual({ ...gammal, ko_status: 'ersatt' });
    expect(await versioner(contractId)).toEqual(vs);
    expect(await kon(contractId)).toEqual([]);
  });
  it('Q5 upprepad skriven är oförändrad med och utan version samt genom svepet', async () => {
    const { contractId, b, vs } = await foljd('Q5');
    const utfall = { lage: 'skriven', drive_id: `${DRIVE_ID}-Q5` };
    const extra = { registerversion: vs[1]!.registerversion, registerhash: vs[1]!.registerhash };
    const forsta = await kvittera(b.id, utfall, extra);
    expect(forsta.status, JSON.stringify(forsta.body)).toBe(200);
    const fore = (await kopieposter(contractId)).find((r) => r.id === b.id)!;
    expect(fore.ko_status).toBe('skriven');
    for (const falt of [extra, {}]) {
      const svar = await kvittera(b.id, utfall, falt);
      expect(svar.status, JSON.stringify(svar.body)).toBe(200);
      expect((await kopieposter(contractId)).find((r) => r.id === b.id)).toEqual(fore);
    }
    const svep = await act('kor_uppdragssvep', { drive_kopior: [{ referens_id: b.id, utfall, ...extra }] }, agent());
    expect(svep.status, JSON.stringify(svep.body)).toBe(200);
    expect((await kopieposter(contractId)).find((r) => r.id === b.id)).toEqual(fore);
  });
  it('Q6 ersatt är oförändrad för båda utfallen, skriven fäller fel och annat fil-id', async () => {
    const { contractId, a, b, vs } = await foljd('Q6');
    const forsta = await kvittera(b.id, { lage: 'skriven', drive_id: `${DRIVE_ID}-Q6` },
      { registerversion: vs[1]!.registerversion, registerhash: vs[1]!.registerhash });
    expect(forsta.status, JSON.stringify(forsta.body)).toBe(200);
    const fore = await kopieposter(contractId);
    expect(fore.find((r) => r.id === a.id)?.ko_status).toBe('ersatt');
    expect(fore.find((r) => r.id === b.id)?.ko_status).toBe('skriven');
    for (const utfall of [{ lage: 'skriven', drive_id: `${DRIVE_ID}-annat-Q6` }, { lage: 'fel', fel: 'Q6 fel' }]) {
      const ersatt = await kvittera(a.id, utfall,
        { registerversion: vs[0]!.registerversion, registerhash: vs[0]!.registerhash });
      expect(ersatt.status, JSON.stringify(ersatt.body)).toBe(200);
      expect(await kopieposter(contractId)).toEqual(fore);
      const skriven = await kvittera(b.id, utfall,
        { registerversion: vs[1]!.registerversion, registerhash: vs[1]!.registerhash });
      expect(skriven.status, JSON.stringify(skriven.body)).toBe(409);
      expect(skriven.body.error).toBe('ingen_oppen_kopost');
      expect(await kopieposter(contractId)).toEqual(fore);
    }
  });
  it('Q7 senaste felet och försöken saknar tak eller villkor som stänger kön', async () => {
    const { contractId } = await importerat('Q7');
    const post = (await kopieposter(contractId))[0]!;
    const v = (await versioner(contractId))[0]!;
    const extra = { registerversion: v.registerversion, registerhash: v.registerhash };
    for (const feltext of ['första', 'andra', 'tredje']) {
      const svar = await kvittera(post.id, { lage: 'fel', fel: feltext }, extra);
      expect(svar.status, JSON.stringify(svar.body)).toBe(200);
    }
    expect((await kopieposter(contractId))[0]).toMatchObject({ forsok: 3, ko_fel: 'tredje' });
    expect((await kon(contractId))[0]).toMatchObject({ referens_id: post.id, forsok: 3 });
    await withAdmin((c) => c.query('UPDATE uppdrag_referens SET forsok=9999 WHERE company_id=$1 AND id=$2', [companyId, post.id]));
    expect((await kopieposter(contractId))[0]!.forsok).toBe(9999);
    const fjarde = await kvittera(post.id, { lage: 'fel', fel: 'fjärde' }, extra);
    expect(fjarde.status, JSON.stringify(fjarde.body)).toBe(200);
    expect((await kon(contractId))[0]).toMatchObject({ referens_id: post.id, forsok: 10000, ko_fel: 'fjärde' });
    const skriven = await kvittera(post.id, { lage: 'skriven', drive_id: `${DRIVE_ID}-Q7` }, extra);
    expect(skriven.status, JSON.stringify(skriven.body)).toBe(200);
    expect((await kopieposter(contractId))[0]).toMatchObject({ forsok: 10001, ko_fel: null });
    expect(await kon(contractId)).toEqual([]);
    const filer = (await vyfiler(new URL('../src/', import.meta.url))).filter((text) => /\bforsok\b/.test(text));
    expect(filer).toHaveLength(1);
    expect(filer[0]).toContain('export async function rapporteraDriveKopia');
    const villkor = /\bforsok\s*(?:<=?|>=?|<>|!=|=(?!\s*(?:\w+\.)?forsok\s*\+\s*1\b))/;
    expect(filer[0]).not.toMatch(villkor);
    expect('AND r.forsok < 10').toMatch(villkor);
    expect('forsok = 0').toMatch(villkor);
    expect('forsok = forsok + 1').not.toMatch(villkor);
  });
  it('Q8 fullständighet, format och uppslagsordning fälls utan ändring', async () => {
    const { contractId } = await importerat('Q8');
    const post = (await kopieposter(contractId))[0]!;
    const v = (await versioner(contractId))[0]!;
    for (const [extra, kod] of [
      [{ registerversion: v.registerversion }, 'kvittens_ofullstandig'],
      [{ registerhash: v.registerhash }, 'kvittens_ofullstandig'],
      [{ registerversion: 0, registerhash: v.registerhash }, 'validation_error'],
      [{ registerversion: v.registerversion, registerhash: 'xyz' }, 'validation_error'],
    ] as const) {
      const svar = await kvittera(post.id, { lage: 'fel', fel: 'Q8' }, extra);
      expect(svar.status, JSON.stringify(svar.body)).toBe(400);
      expect(svar.body.error).toBe(kod);
      expect((await kopieposter(contractId))[0]).toEqual(post);
    }
    const saknas = await kvittera(randomUUID(), { lage: 'fel', fel: 'Q8' }, { registerversion: 1 });
    expect(saknas.status, JSON.stringify(saknas.body)).toBe(404);
    expect(saknas.body.error).toBe('not_found');
    expect((await kopieposter(contractId))[0]).toEqual(post);
  });
});

it('D3 dokumentationen beskriver fryst arbetslista och kvittens utan nya ensamma åtgärdsnamn', async () => {
  const doc = await readFile(new URL('../../docs/MCP_ACTIONS.md', import.meta.url), 'utf8');
  const sektion = doc.split(/^## Uppdragsytan[^\n]*\n/m)[1]?.split(/^## /m)[0];
  expect(sektion).toBeDefined();
  const punkt = sektion!.split('- **Arbetslistan och kvittensen (Story 3.6).**')[1]?.split(/\n\s*\n/)[0];
  expect(punkt, 'arbetslistans och kvittensens punkt saknas').toBeDefined();
  for (const ord of ['registertext', 'forsok', 'ersatt']) expect(punkt).toContain(ord);
  const gamla = (text: string) => ['härledda vid hämtningen', 'ingen försöksräknare', 'räknar inga försök']
    .filter((fras) => normalisera(text).includes(fras));
  expect(gamla(sektion!)).toEqual([]);
  expect(gamla('härledda vid\nhämtningen; ingen\nförsöksräknare; räknar inga\nförsök'))
    .toEqual(['härledda vid hämtningen', 'ingen försöksräknare', 'räknar inga försök']);
  const namn = ['kvittens_annan_version', 'kvittens_ofullstandig'];
  const ensamma = (text: string) => [...text.matchAll(/`([^`]+)`/g)].map((m) => m[1]!).filter((n) => namn.includes(n));
  expect(ensamma(sektion!)).toEqual([]);
  for (const n of namn) {
    expect(ensamma(`planterat \`${n}\``)).toEqual([n]);
    expect(ensamma(`\`409 ${n}\``)).toEqual([]);
  }
});
