// Story 4.2, FR-13/FR-26: överlämningen registreras ur handlingen.
// Hela stacken prövas mot Postgres: väntande ytor, skrivspärrar, referens,
// transmittal och formulär. Frånvaro provas mot ett känt befintligt underlag.
import { readFile } from 'node:fs/promises';
import supertest from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { app, api, createCompany, createFiscalYear, registerUser, withAdmin, type TestUser } from './helpers.js';
import { importeraOchGodkann } from './uppdragImportHelper.js';
import { LEVERANSKONTRAKT_NVR001 } from './fixtures/leveranskontrakt-nvr-001.js';
import { withTenantTransaction } from '../src/db/tx.js';
import { upsertSvepvarden } from '../src/services/uppdragSvep.js';
import { POSTSLAG } from '../src/services/uppdragUndantag.js';
import { loadMigrations } from '../src/db/migrate.js';
import { skapaReferens, verifieraReferens } from '../src/services/uppdragReferens.js';
import { getAction } from '../src/actions/registry.js';
import { faltvarde } from '../src/lib/leverabelfalt.js';
import type { Leverabelrad } from '../src/services/uppdragRegister.js';
import { LUCKTEXT, godkannandeformtext } from '../src/lib/kontraktsluckor.js';
import type { Statusbytesutfall } from '../src/services/uppdragStatus.js';
import type { Approval } from '../src/services/approvals.js';

const PASSWORD = 'mycket-hemligt-losen-123';
const PARTER = { godkannare: 'Styrgruppen', godkannare_eskalering: 'Eva Larsson (VD)',
  godkannandeform: 'Telefon eller mejl från Eva Larsson räcker och loggas med datum och kanal', kalla: 'leveranskontraktet' };
const MEJL = { sort: 'mejl', extern_id: '<overlamning-L1@nvr.se>', extern_kalla: 'gmail:locollabs' } as const;
const DOKUMENT = { sort: 'drive', extern_id: '1AbCoverlamningL1', extern_kalla: 'drive:locollabs' } as const;
type Avtal = { projectId: string; contractId: string };
let user: TestUser;
let companyId: string;
let agentToken: string;
let ua: ReturnType<typeof supertest.agent>;
const auth = () => ({ Authorization: `Bearer ${user.token}` });
const co = () => `/api/companies/${companyId}`;
const bas = (a: Avtal) => `/app/c/${companyId}/projects/${a.projectId}`;
async function act(namn: string, kropp: Record<string, unknown>, headers = auth()) {
  return api.post(`${co()}/actions/${namn}`).set(headers).send(kropp);
}
async function ok<T = Record<string, unknown>>(namn: string, kropp: Record<string, unknown>): Promise<T> {
  const res = await act(namn, kropp);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.result as T;
}
async function nyttAvtal(namn: string, parter: typeof PARTER | null = PARTER): Promise<Avtal> {
  const projectId = (await ok('create_project', { name: namn })).id as string;
  const contractId = (await ok('skapa_uppdrag', { project_id: projectId, name: namn, signed_date: '2026-09-03' })).contract_id as string;
  await importeraOchGodkann(companyId, auth(), { contract_id: contractId, kontraktstext: LEVERANSKONTRAKT_NVR001 });
  await withAdmin((c) => c.query(`UPDATE contracts SET godkannare=$1, godkannare_eskalering=$2,
    godkannandeform=$3, godkannare_kalla=$4 WHERE id=$5 AND company_id=$6`,
  [parter?.godkannare ?? null, parter?.godkannare_eskalering ?? null, parter?.godkannandeform ?? null,
    parter?.kalla ?? null, contractId, companyId]));
  return { projectId, contractId };
}
const indata = (a: Avtal, kod: string) => ({ contract_id: a.contractId, leverabel_kod: kod });
const paborja = (a: Avtal, kod: string) => ok('paborja_leverabel', indata(a, kod));
async function sida(path: string) {
  const r = await ua.get(path);
  expect(r.status, r.text).toBe(200);
  return r.text;
}
function huvud(html: string) {
  expect(html).toContain('<main>');
  return html.slice(html.indexOf('<main>'), html.indexOf('</main>'));
}
function kort(main: string, kod: string) {
  const traff = main.split('<li class="leverabelkort">').slice(1)
    .map((b) => b.slice(0, b.indexOf('</li>'))).filter((b) => b.includes(`>${kod}</strong>`));
  expect(traff).toHaveLength(1);
  return traff[0]!;
}
async function handelser(a: Avtal) {
  return withAdmin(async (c) => (await c.query(`SELECT h.*, l.kod,
    to_char(h.bekraftat_nar, 'YYYY-MM-DD') AS dag FROM uppdrag_leverabel_handelse h
    JOIN uppdrag_leverabel l ON l.id=h.leverabel_id AND l.company_id=h.company_id
    WHERE h.company_id=$1 AND h.contract_id=$2 ORDER BY h.created_at, h.id`, [companyId, a.contractId])).rows);
}
async function referens(id: string) {
  return withAdmin(async (c) => (await c.query('SELECT * FROM uppdrag_referens WHERE company_id=$1 AND id=$2', [companyId, id])).rows[0]);
}
async function statusar(a: Avtal) {
  return withAdmin(async (c) => (await c.query('SELECT kod, status FROM uppdrag_leverabel WHERE company_id=$1 AND contract_id=$2 ORDER BY kod', [companyId, a.contractId])).rows);
}
async function sattStatus(a: Avtal, kod: string, status: string) {
  await withAdmin((c) => c.query('UPDATE uppdrag_leverabel SET status=$1 WHERE company_id=$2 AND contract_id=$3 AND kod=$4', [status, companyId, a.contractId, kod]));
}
async function referenser(a: Avtal) {
  return withAdmin(async (c) => (await c.query('SELECT * FROM uppdrag_referens WHERE company_id=$1 AND contract_id=$2 ORDER BY id', [companyId, a.contractId])).rows);
}
async function audit() {
  const res = await api.get(`${co()}/audit`).set(auth());
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.entries;
}
async function godkannanden(): Promise<Approval[]> {
  const res = await api.get(`${co()}/approvals`).set(auth());
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.approvals as Approval[];
}
const overlamna = (a: Avtal, kod: string, tillagg: Record<string, unknown> = {}) =>
  ok<Statusbytesutfall & { referens_id: string }>('bekrafta_statusbyte', {
    ...indata(a, kod), utfall: 'bekraftad', handling: MEJL, ...tillagg,
  });
async function sattHandelsedatum(id: string, datum: string) {
  await withTenantTransaction(user.userId, companyId, (c) => verifieraReferens(c, companyId, id,
    { finns: true }, { handelse_datum: datum }));
}
async function register(a: Avtal): Promise<Leverabelrad[]> {
  const res = await act('las_leverabelregister', { contract_id: a.contractId });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.result as Leverabelrad[];
}
beforeAll(async () => {
  user = await registerUser('overlamning');
  companyId = await createCompany(user.token, 'Överlämning AB');
  await createFiscalYear(companyId, auth(), { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });
  ua = supertest.agent(app);
  const login = await ua.post('/app/login').type('form').send({ email: user.email, password: PASSWORD });
  expect([302, 303]).toContain(login.status);
  const tok = await api.post(`${co()}/agent-tokens`).set(auth()).send({ name: 'Överlämningsprov' });
  expect(tok.status, JSON.stringify(tok.body)).toBe(201);
  agentToken = tok.body.token;
});

describe('Story 4.2: inga statusbyten väntar på David', () => {
  let a: Avtal;
  beforeAll(async () => {
    a = await nyttAvtal('4.2 U');
    await paborja(a, 'L1');
    await withTenantTransaction(user.userId, companyId, (c) => upsertSvepvarden(c, companyId, a.contractId,
      [{ nyckel: 'statusforslag:L1', kalla: 'drive', varde: { revision: 9 } }]));
  });
  it('4.2-U1: förstasidan visar inget statusförslag trots cachad observation', async () => {
    const cache = await withAdmin((c) => c.query("SELECT 1 FROM uppdrag_svepvarde WHERE company_id=$1 AND contract_id=$2 AND nyckel='statusforslag:L1'", [companyId, a.contractId]));
    expect(cache.rowCount).toBe(1);
    const lev = await withAdmin((c) => c.query("SELECT status FROM uppdrag_leverabel WHERE company_id=$1 AND contract_id=$2 AND kod='L1'", [companyId, a.contractId]));
    expect(lev.rows[0].status).toBe('pagar');
    const main = huvud(await sida(bas(a)));
    for (const text of ['kan vara levererad', 'Väntar på ditt svar', 'name="utfall"', '/statusforslag"']) expect(main).not.toContain(text);
  });
  it('4.2-U2: Lägets band visar inget statusförslag', async () => {
    const main = huvud(await sida(`${bas(a)}/laget`));
    expect(main).toContain('id="handgrepp"');
    expect(main).not.toContain('kan vara levererad');
    expect(main).not.toContain('>Bekräfta<');
  });
  it('4.2-U3: uppdragets rutter är exakt navigationskontraktets (regression)', async () => {
    const source = await readFile(new URL('../src/http/view/routes.ts', import.meta.url), 'utf8');
    const contract = JSON.parse(await readFile(new URL('../kontrakt/navigation.v1.json', import.meta.url), 'utf8'));
    const prefix = '/c/:companyId/projects/:projectId';
    const actual = [...new Set([...source.matchAll(/viewRouter\.(get|post)\(\s*'(\/c\/:companyId\/projects\/:projectId(?:\/[^']*)?)'/g)]
      .map((m) => `${m[1]!.toUpperCase()} ${m[2]}`))].sort();
    const expected = [...new Set((contract.routes as { service: string; method: string; router_pattern: string }[])
      .filter((r) => r.service === 'redovisning' && (r.router_pattern === prefix || r.router_pattern.startsWith(`${prefix}/`)))
      .map((r) => `${r.method} ${r.router_pattern}`))].sort();
    expect(actual).toContain(`POST ${prefix}/statusforslag`);
    expect(actual).toContain(`POST ${prefix}/leverabel/godkann`);
    expect(actual).toEqual(expected);
    expect([...actual, `POST ${prefix}/leverabel/overlamna`].sort()).not.toEqual(expected);
  });
  it('4.2-U4: undantagsvyn har bara sina sex tillåtna postslag (regression)', async () => {
    expect([...POSTSLAG].sort()).toEqual(['baselineandring', 'kostnadsbindning', 'ovrigt_beslut', 'avslut', 'scopeavgorande', 'ny_bedomning'].sort());
    const res = await act('las_undantag', {});
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    for (const p of res.body.result.poster) expect(POSTSLAG).toContain(p.slag);
    const main = huvud(await sida(`/app/c/${companyId}/uppdrag`));
    expect(main).not.toContain('kan vara levererad');
    expect(main).not.toContain('name="utfall"');
  });
});

describe('Story 4.2: överlämningen och handlingen', () => {
  it('4.2-S1: migrationen är additiv, idempotent och binder referensen till samma avtal', async () => {
    const migration = (await loadMigrations()).find((m) => m.name === 'overlamningshandling');
    expect(migration).toBeDefined();
    await withAdmin(async (c) => {
      await c.query(migration!.sql); await c.query(migration!.sql);
      const col = await c.query("SELECT data_type, is_nullable FROM information_schema.columns WHERE table_name='uppdrag_leverabel_handelse' AND column_name='referens_id'");
      expect(col.rows).toEqual([{ data_type: 'uuid', is_nullable: 'YES' }]);
      const keys = await c.query("SELECT conname, pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conname=ANY($1::text[])",
        [['uppdrag_referens_id_company_contract_uk', 'uppdrag_leverabel_handelse_referens_fk']]);
      expect(keys.rows).toHaveLength(2);
      expect(keys.rows.find((r) => r.conname.endsWith('referens_fk'))!.definition).toContain('FOREIGN KEY (referens_id, company_id, contract_id) REFERENCES uppdrag_referens');
    });
    const a = await nyttAvtal('4.2 S1 A'); const b = await nyttAvtal('4.2 S1 B');
    const ref = await withTenantTransaction(user.userId, companyId, (c) => skapaReferens(c, companyId,
      { contract_id: b.contractId, ...MEJL, extern_nyckel: 'rfc822#message-id' }));
    const before = await handelser(a);
    await expect(withAdmin((c) => c.query(`INSERT INTO uppdrag_leverabel_handelse
      (company_id, contract_id, leverabel_id, fran, till, referens_id, bekraftat_av)
      SELECT company_id, contract_id, id, 'pagar', 'levererad', $3, 'riggning' FROM uppdrag_leverabel
      WHERE company_id=$1 AND contract_id=$2 AND kod='L1'`, [companyId, a.contractId, ref.id]))).rejects.toMatchObject({ code: '23503' });
    expect(await handelser(a)).toEqual(before);
  });
  it('4.2-S2: mejlet blir handlingens kanoniska referens utan svepförslag', async () => {
    const a = await nyttAvtal('4.2 S2'); await paborja(a, 'L1');
    const cache = await withAdmin((c) => c.query("SELECT 1 FROM uppdrag_svepvarde WHERE company_id=$1 AND contract_id=$2 AND nyckel LIKE 'statusforslag:%'", [companyId, a.contractId]));
    expect(cache.rowCount).toBe(0);
    const r = await overlamna(a, 'L1', { mottagare: 'Eva Larsson (VD)' });
    expect(r).toMatchObject({ status: 'levererad', revision: 1, mottagare: 'Eva Larsson (VD)', referens_id: expect.any(String) });
    expect((await handelser(a)).at(-1)).toMatchObject({ referens_id: r.referens_id, bekraftat_av: user.userId });
    expect(await referens(r.referens_id)).toMatchObject({ sort: 'mejl', extern_id: 'overlamning-L1@nvr.se', extern_nyckel: 'rfc822#message-id', extern_kalla: MEJL.extern_kalla, status: 'overifierad', handelse_datum: null });
  });
  it('4.2-S3: mottagaren förifylls, kan anges och får aldrig gissas', async () => {
    const a = await nyttAvtal('4.2 S3'); const b = await nyttAvtal('4.2 S3 utan parter', null);
    for (const x of [a, b]) for (const kod of ['L1', 'L2']) await paborja(x, kod);
    expect((await overlamna(a, 'L1')).mottagare).toBe('Styrgruppen');
    let before = await handelser(a);
    const blank = await act('bekrafta_statusbyte', { ...indata(a, 'L2'), utfall: 'bekraftad', handling: MEJL, mottagare: '   ' });
    expect(blank.status, JSON.stringify(blank.body)).toBe(400); expect(blank.body.error).toBe('validation_error');
    expect(await handelser(a)).toEqual(before); expect(await statusar(a)).toContainEqual({ kod: 'L2', status: 'pagar' });
    before = await handelser(b);
    const saknad = await act('bekrafta_statusbyte', { ...indata(b, 'L1'), utfall: 'bekraftad', handling: MEJL });
    expect(saknad.status, JSON.stringify(saknad.body)).toBe(409); expect(saknad.body.error).toBe('saknad_mottagare');
    expect(await handelser(b)).toEqual(before);
    expect((await overlamna(b, 'L2', { mottagare: '  Annan Part AB  ' })).mottagare).toBe('Annan Part AB');
  });
  it('4.2-S4: saknad, ogiltig och spärrad handling skriver inget; referenser återanvänds, aldrig kopieposter', async () => {
    const a = await nyttAvtal('4.2 S4'); for (const kod of ['L1', 'L2']) await paborja(a, kod);
    const before = await handelser(a); const refs = await referenser(a);
    for (const [handling, status, error] of [[undefined, 400, 'handling_saknas'], [{ ...MEJL, extern_id: 'https://mail.google.com/x' }, 400, 'validation_error']] as const) {
      const r = await act('bekrafta_statusbyte', { ...indata(a, 'L1'), utfall: 'bekraftad', ...(handling ? { handling } : {}) });
      expect(r.status, JSON.stringify(r.body)).toBe(status); expect(r.body.error).toBe(error);
      expect(await handelser(a)).toEqual(before); expect(await referenser(a)).toEqual(refs);
      expect(await statusar(a)).toContainEqual({ kod: 'L1', status: 'pagar' });
    }
    await withTenantTransaction(user.userId, companyId, async (c) => {
      const r = await skapaReferens(c, companyId, { contract_id: a.contractId, ...DOKUMENT, extern_nyckel: 'drive#file' });
      await verifieraReferens(c, companyId, r.id, { finns: true }, { sparr: 'utanfor' });
    });
    const sparrad = await act('bekrafta_statusbyte', { ...indata(a, 'L1'), utfall: 'bekraftad', handling: DOKUMENT });
    expect(sparrad.status, JSON.stringify(sparrad.body)).toBe(409); expect(sparrad.body.error).toBe('utanfor_sparr');
    expect(await handelser(a)).toEqual(before);
    const r1 = await overlamna(a, 'L1'); const r2 = await overlamna(a, 'L2');
    expect(r1.referens_id).toBe(r2.referens_id);
    expect((await referenser(a)).filter((r) => r.extern_id === 'overlamning-L1@nvr.se')).toHaveLength(1);
    const b = await nyttAvtal('4.2 S4 kopiepost'); await paborja(b, 'L1');
    await withAdmin((c) => c.query(`INSERT INTO uppdrag_referens
      (company_id, contract_id, sort, extern_id, extern_nyckel, extern_kalla, ko_status)
      VALUES ($1,$2,'drive','1AbCkopiaL1','registerkopia','drive:sparrmapp','koad')`, [companyId, b.contractId]));
    const beforeB = await handelser(b);
    const kopia = await act('bekrafta_statusbyte', { ...indata(b, 'L1'), utfall: 'bekraftad', handling: { ...DOKUMENT, extern_id: '1AbCkopiaL1' } });
    expect(kopia.status, JSON.stringify(kopia.body)).toBe(409); expect(kopia.body.error).toBe('referens_finns_redan');
    expect(await handelser(b)).toEqual(beforeB); expect(await statusar(b)).toContainEqual({ kod: 'L1', status: 'pagar' });
    expect((await overlamna(b, 'L1', { handling: { ...DOKUMENT, extern_id: '1AbCannanL1' } })).status).toBe('levererad');
  });
  it('4.2-S5: varje överlämning räknas, returens historik räknas aldrig', async () => {
    const a = await nyttAvtal('4.2 S5'); for (const kod of ['L1', 'L2', 'L3', 'L4']) await paborja(a, kod);
    const r1 = await overlamna(a, 'L1'); expect(r1.revision).toBe(1);
    await sattStatus(a, 'L1', 'pagar');
    const r2 = await overlamna(a, 'L1', { handling: DOKUMENT }); expect(r2.revision).toBe(2); expect(r2.referens_id).not.toBe(r1.referens_id);
    const retur = await ok('bekrafta_statusbyte', { ...indata(a, 'L2'), utfall: 'retur' });
    expect(retur).toMatchObject({ status: 'avvisad', revision: null, mottagare: null, referens_id: null });
    const returMed = await ok('bekrafta_statusbyte', { ...indata(a, 'L3'), utfall: 'retur', handling: MEJL });
    expect(returMed).toMatchObject({ status: 'avvisad', revision: null, referens_id: r1.referens_id });
    expect((await handelser(a)).filter((h) => h.till === 'avvisad')).toHaveLength(2);
    const before = await handelser(a);
    const fel = await act('bekrafta_statusbyte', { ...indata(a, 'L4'), utfall: 'retur', mottagare: 'Någon' });
    expect(fel.status, JSON.stringify(fel.body)).toBe(400); expect(fel.body.error).toBe('validation_error'); expect(await handelser(a)).toEqual(before);
    await sattStatus(a, 'L2', 'pagar'); expect((await overlamna(a, 'L2')).revision).toBe(1);
  });
  it('4.2-S6: överlämningen skapar bara handlingen, historiken och registerkopians kö', async () => {
    const a = await nyttAvtal('4.2 S6'); await paborja(a, 'L1');
    const antal = () => withAdmin(async (c) => (await c.query(`SELECT
      (SELECT count(*)::int FROM action_approvals WHERE company_id=$1) AS approvals,
      (SELECT count(*)::int FROM uppdrag_beslut WHERE company_id=$1 AND contract_id=$2) AS beslut`, [companyId, a.contractId])).rows[0]);
    const before = await antal(); const ids = new Set((await referenser(a)).map((r) => r.id));
    const r = await overlamna(a, 'L1'); expect(await antal()).toEqual(before);
    const nya = (await referenser(a)).filter((x) => !ids.has(x.id));
    expect(nya).toContainEqual(expect.objectContaining({ id: r.referens_id, sort: 'mejl', extern_id: 'overlamning-L1@nvr.se' }));
    expect(nya).toContainEqual(expect.objectContaining({ extern_nyckel: 'registerkopia', ko_status: 'koad' }));
    expect(nya.every((x) => x.id === r.referens_id || x.extern_nyckel === 'registerkopia')).toBe(true);
  });
  it.each([false, true])('4.2-S7: de tre människospärrarna fäller agenten före varje skrivning (väntande förslag: %s)', async (vantande) => {
    const a = await nyttAvtal(`4.2 S7 ${vantande}`); await paborja(a, 'L2'); await sattStatus(a, 'L3', 'levererad');
    const historik = await godkannanden();
    expect(historik).toContainEqual(expect.objectContaining({
      action: 'satt_baseline', status: 'executed', input: expect.objectContaining({ contract_id: a.contractId }),
    }));
    if (vantande) {
      // En legitim köskrivning måste synas i jämförelsen. Det väntande förslaget
      // ska sedan bevaras lika strikt som den redan verkställda importhistoriken.
      const forslag = await act('update_contract', { contract_id: a.contractId, name: 'Väntande namnförslag' });
      expect(forslag.status, JSON.stringify(forslag.body)).toBe(202);
      const ko = await godkannanden();
      expect(ko).not.toEqual(historik);
      expect(ko).toContainEqual(expect.objectContaining({ id: forslag.body.approval.id, status: 'pending' }));
    }
    // GET /approvals omfattar också historik. Spärren ska lämna hela kön
    // oförändrad, oavsett vilka legitima poster som redan finns där.
    const konFore = await godkannanden();
    const before = await handelser(a); const states = await statusar(a); const log = await audit(); const refs = await referenser(a);
    for (const [namn, input] of [
      ['paborja_leverabel', indata(a, 'L1')],
      ['bekrafta_statusbyte', { ...indata(a, 'L2'), utfall: 'bekraftad', handling: MEJL, mottagare: 'Styrgruppen' }],
      ['godkann_leverabel', { ...indata(a, 'L3'), kanal: 'mejl' }],
    ] as const) {
      expect(getAction(namn)).toMatchObject({ kravManniska: true, sensitivity: 'write' });
      const res = await act(namn, input, { Authorization: `Bearer ${agentToken}` });
      expect(res.status, JSON.stringify(res.body)).toBe(403); expect(res.body.error).toBe('human_required');
      expect(await handelser(a)).toEqual(before);
      expect(await statusar(a)).toEqual(states);
      expect(await referenser(a)).toEqual(refs);
      expect(await audit()).toEqual(log);
      expect(await godkannanden()).toEqual(konFore);
    }
  });
});

describe('Story 4.2: transmittalen i registret', () => {
  let a: Avtal;
  beforeAll(async () => {
    a = await nyttAvtal('4.2 R och G');
    for (const kod of ['L1', 'L2', 'L3']) await paborja(a, kod);
  });
  it('4.2-R1: datumet kommer enbart ur handlingen, även när svepet läser den senare', async () => {
    const idag = await withAdmin(async (c) => (await c.query('SELECT current_date::text AS dag')).rows[0].dag);
    expect(idag).not.toBe('2026-09-12');
    const r = await overlamna(a, 'L1');
    const l1 = (await register(a)).find((x) => x.kod === 'L1')!;
    expect(l1).toMatchObject({ revision: 1, mottagare: 'Styrgruppen', overlamnad: null });
    expect(faltvarde(l1, 'overlamnad')).toEqual({ lage: 'saknas', text: 'Datum saknas: överlämningen bär inget datum ur handlingen' });
    await sattHandelsedatum(r.referens_id, '2026-09-12');
    expect((await register(a)).find((x) => x.kod === 'L1')!.overlamnad).toBe('2026-09-12');
    const h = (await handelser(a)).find((x) => x.id === r.handelse_id)!;
    expect(h.dag).toBe(idag); expect(h.dag).not.toBe('2026-09-12');
  });
  it('4.2-R2: före överlämningen saknas alla tre transmittalfälten (regression)', async () => {
    expect((await register(a)).find((x) => x.kod === 'L3')).toMatchObject({ revision: null, mottagare: null, overlamnad: null });
  });
  it('4.2-R3: senaste överlämningen ger revision, mottagare och handlingens nya datum', async () => {
    const r1 = await overlamna(a, 'L2', { handling: DOKUMENT, mottagare: 'Eva Larsson (VD)' });
    await sattHandelsedatum(r1.referens_id, '2026-10-01');
    await sattStatus(a, 'L2', 'pagar');
    const r2 = await overlamna(a, 'L2', { handling: { ...DOKUMENT, extern_id: '1AbCoverlamningL2v2' } });
    await sattHandelsedatum(r2.referens_id, '2026-10-20');
    expect((await register(a)).find((x) => x.kod === 'L2')).toMatchObject({ revision: 2, mottagare: 'Styrgruppen', overlamnad: '2026-10-20' });
  });
  it('4.2-R4: äldre överlämning utan handling behåller saknat datum (regression)', async () => {
    await withAdmin((c) => c.query(`INSERT INTO uppdrag_leverabel_handelse
      (company_id, contract_id, leverabel_id, fran, till, revision, mottagare, bekraftat_av)
      SELECT company_id, contract_id, id, 'pagar', 'levererad', 1, 'Styrgruppen', 'riggning'
      FROM uppdrag_leverabel WHERE company_id=$1 AND contract_id=$2 AND kod='L3'`, [companyId, a.contractId]));
    expect((await register(a)).find((x) => x.kod === 'L3')).toMatchObject({ revision: 1, overlamnad: null });
  });
  it('4.2-G1: godkännandet loggar kanal och dag utan att ändra överlämningens transmittal', async () => {
    const before = (await register(a)).find((x) => x.kod === 'L1')!;
    expect(before.overlamnad).toBe('2026-09-12');
    const r = await ok('godkann_leverabel', { ...indata(a, 'L1'), kanal: 'mejl', nar: '2026-09-15', notering: 'Eva godkände per mejl' });
    expect((await handelser(a)).find((x) => x.id === r.handelse_id)).toMatchObject({ revision: null, referens_id: null, kanal: 'mejl', dag: '2026-09-15', mottagare: 'Styrgruppen' });
    expect((await register(a)).find((x) => x.kod === 'L1')).toMatchObject({ status: 'godkand', revision: before.revision, mottagare: before.mottagare, overlamnad: before.overlamnad });
  });
});

describe('Story 4.2: överlämningen på kortet', () => {
  let p: Avtal; let q: Avtal;
  beforeAll(async () => {
    p = await nyttAvtal('4.2 V med parter'); q = await nyttAvtal('4.2 V utan parter', null);
    for (const kod of ['L1', 'L2', 'L3']) await paborja(p, kod);
    await overlamna(p, 'L3');
    for (const kod of ['L1', 'L2']) await paborja(q, kod);
    await overlamna(q, 'L2', { mottagare: 'Annan Part AB' });
  });
  it('4.2-V1: pågår bär överlämning och retur med synlig handling och namngivna handgrepp', async () => {
    const main = huvud(await sida(`${bas(p)}/leveranserna`)); const k = kort(main, 'L1');
    expect(k.split(`action="${bas(p)}/statusforslag"`)).toHaveLength(3);
    for (const x of ['name="utfall" value="bekraftad"', 'name="leverabel_kod" value="L1"', 'name="handling_sort"',
      '<option value="mejl">', '<option value="drive">', `name="handling_kalla" maxlength="200" value="${user.email}"`,
      'name="mottagare" maxlength="200" value="Styrgruppen"', 'Eva Larsson (VD)',
      'aria-label="Registrera överlämning av leverabel L1"', 'name="utfall" value="retur"', 'aria-label="Registrera retur för leverabel L1"']) expect(k).toContain(x);
    expect(k).toMatch(/<input[^>]*name="handling_id"[^>]*required/);
    const detaljer = [...k.matchAll(/<details[\s\S]*?<\/details>/g)].map((m) => m[0]).join('');
    expect(detaljer).not.toContain('required');
    expect(k.indexOf('name="handling_id"')).toBeLessThan(k.indexOf('Registrera överlämning av'));
    expect(k).not.toContain('/leverabel/paborja'); expect(k).not.toContain('/leverabel/godkann'); expect(main).not.toContain('<script');
  });
  it('4.2-V2: saknad mottagarpart ger tom ruta och begriplig saknastext', async () => {
    const k = kort(huvud(await sida(`${bas(q)}/leveranserna`)), 'L1');
    const input = k.match(/<input[^>]*name="mottagare"[^>]*>/)?.[0]; expect(input).toBeDefined();
    expect(input!.replace('value=""', '')).not.toContain('value='); expect(k).toContain(LUCKTEXT.mottagarpart.vad);
    expect(kort(huvud(await sida(`${bas(p)}/leveranserna`)), 'L1')).toContain('value="Styrgruppen"');
  });
  it('4.2-V3: formuläret skickar handling och ändrad mottagare genom action-lagret', async () => {
    const res = await ua.post(`${bas(p)}/statusforslag`).type('form').send({ ...indata(p, 'L1'), utfall: 'bekraftad',
      handling_sort: 'mejl', handling_id: '<kortet-L1@nvr.se>', handling_kalla: 'gmail:locollabs', mottagare: 'Eva Larsson (VD)' });
    expect(res.status, res.text).toBe(302); expect(res.headers.location).toBe(bas(p));
    expect((await register(p)).find((x) => x.kod === 'L1')).toMatchObject({ status: 'levererad', revision: 1, mottagare: 'Eva Larsson (VD)' });
    const h = (await handelser(p)).find((x) => x.kod === 'L1' && x.revision === 1)!;
    expect(await referens(h.referens_id)).toMatchObject({ extern_id: 'kortet-L1@nvr.se' });
    expect((await audit()).map((x: { action: string; entity_id: string }) => `${x.action}:${x.entity_id}`)).toContain('action.executed:bekrafta_statusbyte');
  });
  it('4.2-V4: saknad handling och mottagare visas som notis utan skrivning', async () => {
    for (const [a, kod, handling_id, text] of [[p, 'L2', '', 'ange mejlets Message-ID'], [q, 'L1', 'kortet-Q1@nvr.se', 'saknad mottagare']] as const) {
      const before = await handelser(a); const refs = await referenser(a);
      const res = await ua.post(`${bas(a)}/statusforslag`).type('form').send({ ...indata(a, kod), utfall: 'bekraftad', handling_sort: 'mejl', handling_id, handling_kalla: 'gmail:locollabs', mottagare: '' });
      expect(res.status, res.text).toBe(302); expect(res.headers.location).toContain(`${bas(a)}?fel=`);
      expect(decodeURIComponent(res.headers.location!)).toContain(text);
      expect(huvud(await sida(res.headers.location!))).toContain(text);
      expect(await handelser(a)).toEqual(before); expect(await referenser(a)).toEqual(refs);
      expect(await statusar(a)).toContainEqual({ kod, status: 'pagar' });
    }
  });
  it('4.2-V5: retur på kortet ger en historikpost utan revision eller mottagare', async () => {
    const res = await ua.post(`${bas(p)}/statusforslag`).type('form').send({ ...indata(p, 'L2'), utfall: 'retur' });
    expect(res.status, res.text).toBe(302); expect(res.headers.location).toBe(bas(p));
    expect(await statusar(p)).toContainEqual({ kod: 'L2', status: 'avvisad' });
    expect((await handelser(p)).filter((x) => x.kod === 'L2').at(-1)).toMatchObject({ till: 'avvisad', revision: null, mottagare: null });
  });
  it('4.2-V6: Godkänn visar avtalets godkännare och godkännandeform, även luckorna', async () => {
    const kp = kort(huvud(await sida(`${bas(p)}/leveranserna`)), 'L3');
    const kq = kort(huvud(await sida(`${bas(q)}/leveranserna`)), 'L2');
    expect(kp).toContain('Styrgruppen'); expect(kp).toContain(godkannandeformtext(PARTER.godkannandeform));
    expect(kq).toContain(LUCKTEXT.mottagarpart.vad); expect(kq).toContain(godkannandeformtext(null));
    for (const k of [kp, kq]) expect(k).toContain('<select name="kanal" required>');
  });
});

describe('Story 4.2: dokumentationen', () => {
  function avsnitt(text: string, rubrik: string) {
    const start = text.indexOf(rubrik);
    expect(start).toBeGreaterThanOrEqual(0);
    return text.slice(start + rubrik.length).split(/\n#{2,3} /)[0]!;
  }
  function arkitekturHaller(text: string) {
    const norm = text.replace(/\s+/g, ' ');
    return text.split('\n').some((rad) => ['kravManniska', 'paborja_leverabel', 'bekrafta_statusbyte', 'godkann_leverabel'].every((n) => rad.includes(n)))
      && ['ej_paborjad -> pagar -> levererad -> godkand', 'pagar -> avvisad', 'En fjarde, kallbelagd rutinvag', 'FR-13'].every((n) => norm.includes(n));
  }
  it('4.2-D1: arkitekturen räknar upp alla tre spärrarna och den uppskjutna fjärde vägen', async () => {
    const text = avsnitt(await readFile(new URL('../../docs/ARKITEKTUR.md', import.meta.url), 'utf8'), '## Uppdragsytan (modul)');
    expect(arkitekturHaller(text)).toBe(true);
    const trasig = text.split('\n').map((rad) => rad.includes('kravManniska') ? rad.replaceAll('godkann_leverabel', '') : rad).join('\n');
    expect(arkitekturHaller(trasig)).toBe(false);
  });
  const nyaNamn = ['handling_saknas', 'utanfor_sparr', 'referens_id', 'handelse_datum'];
  const ensammaNamn = (text: string) => nyaNamn.filter((n) => text.includes(`\`${n}\``));
  it('4.2-D2: handgreppets dokumentation beskriver handling och mottagare utan förslagskrav eller falskt datum', async () => {
    const text = avsnitt(await readFile(new URL('../../docs/MCP_ACTIONS.md', import.meta.url), 'utf8'), '### Statusbytet med transmittal (S3.2, våg 4)');
    const norm = text.replace(/\s+/g, ' ');
    expect(norm).toContain('handling'); expect(norm).toContain('mottagare');
    expect(norm).not.toContain('Förslaget måste finnas'); expect(norm).not.toContain('Överlämningsdatumet är `now()`');
    expect(ensammaNamn(text)).toEqual([]);
    expect(ensammaNamn(`${text}\n- Fel: \`handling_saknas\``)).toEqual(['handling_saknas']);
  });
});
