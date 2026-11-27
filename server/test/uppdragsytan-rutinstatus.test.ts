// Story 14.1, FR-13/FR-12/NFR-4: ett rutinmässigt statusbyte registreras ur sin
// källhändelse utan fråga. Risken: en maskin flyttar ett läge som kräver Davids
// omdöme, ett godkännande uppfinns, eller en rutinregistrering bär en mänsklig
// signatur. Regeln prövas ren; skrivvägen, förslaget och Davids ja prövas genom
// hela stacken mot Postgres.
import { readFile } from 'node:fs/promises';
import supertest from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { app, api, createCompany, createFiscalYear, registerUser, withAdmin, type TestUser } from './helpers.js';
import { LUCKTEXT } from '../src/lib/kontraktsluckor.js';
import { importeraOchGodkann } from './uppdragImportHelper.js';
import { LEVERANSKONTRAKT_NVR001 } from './fixtures/leveranskontrakt-nvr-001.js';
import { withTenantTransaction } from '../src/db/tx.js';
import { loadMigrations } from '../src/db/migrate.js';
import { skapaReferens } from '../src/services/uppdragReferens.js';
import { RUTINFORSLAGSNYCKEL, upsertSvepvarden } from '../src/services/uppdragSvep.js';
import { FORSLAG_FEL_LAGE, lasRutinforslag } from '../src/services/uppdragStatus.js';
import { getAction } from '../src/actions/registry.js';
import type { Leverabelrad } from '../src/services/uppdragRegister.js';
import type { Approval } from '../src/services/approvals.js';
import type { Undantagspost } from '../src/services/uppdragUndantag.js';
import {
  KALLHANDELSETYPER, OVERGANGAR, RUTINSKAL, RUTINSKALTEXT, provaRutinhandelse,
  type Kallhandelsetyp, type Rutinindata,
} from '../src/lib/rutinregel.js';

const PARTER = { godkannare: 'Styrgruppen', godkannare_eskalering: 'Eva Larsson (VD)',
  godkannandeform: 'Telefon eller mejl från Eva Larsson räcker och loggas med datum och kanal', kalla: 'leveranskontraktet' };
type Avtal = { projectId: string; contractId: string };
let user: TestUser;
let companyId: string;
const auth = () => ({ Authorization: `Bearer ${user.token}` });
const co = () => `/api/companies/${companyId}`;
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
async function handelser(a: Avtal) {
  return withAdmin(async (c) => (await c.query(`SELECT h.*, l.kod,
    to_char(h.bekraftat_nar, 'YYYY-MM-DD') AS dag FROM uppdrag_leverabel_handelse h
    JOIN uppdrag_leverabel l ON l.id=h.leverabel_id AND l.company_id=h.company_id
    WHERE h.company_id=$1 AND h.contract_id=$2 ORDER BY h.created_at, h.id`, [companyId, a.contractId])).rows);
}
let agentToken: string;
const agent = (namn: string, kropp: Record<string, unknown>) => act(namn, kropp, { Authorization: `Bearer ${agentToken}` });
async function statusar(a: Avtal) {
  return withAdmin(async (c) => (await c.query('SELECT kod, status FROM uppdrag_leverabel WHERE company_id=$1 AND contract_id=$2 ORDER BY kod', [companyId, a.contractId])).rows);
}
async function referenser(a: Avtal) {
  return withAdmin(async (c) => (await c.query('SELECT * FROM uppdrag_referens WHERE company_id=$1 AND contract_id=$2 ORDER BY id', [companyId, a.contractId])).rows);
}
async function referens(id: string) {
  return withAdmin(async (c) => (await c.query('SELECT * FROM uppdrag_referens WHERE company_id=$1 AND id=$2', [companyId, id])).rows[0]);
}
async function cache(a: Avtal) {
  return withAdmin(async (c) => (await c.query('SELECT nyckel, varde FROM uppdrag_svepvarde WHERE company_id=$1 AND contract_id=$2 ORDER BY nyckel', [companyId, a.contractId])).rows);
}
async function audit(): Promise<Array<{ action: string; entity_id: string; details: Record<string, unknown> }>> {
  const res = await api.get(`${co()}/audit`).set(auth());
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.entries;
}
/** Godkännandekön: det som väntar på David. Historiken räknas i A1 för sig. */
async function godkannanden(): Promise<Approval[]> {
  const res = await api.get(`${co()}/approvals?status=pending`).set(auth());
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.approvals as Approval[];
}
async function register(a: Avtal): Promise<Leverabelrad[]> {
  const res = await act('las_leverabelregister', { contract_id: a.contractId });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.result as Leverabelrad[];
}
async function undantag(): Promise<string[]> {
  const res = await act('las_undantag', {});
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return (res.body.result.poster as Undantagspost[]).map((p) => `${p.slag}:${p.identitet}:${p.id}`).sort();
}
const TROSKLAR = { procent: 5, golv_ore: 0, golv_timmar: 0, dagar: 5 };
const indikator = (a: Avtal, larm: unknown[]) => withTenantTransaction(user.userId, companyId, (c) => upsertSvepvarden(c, companyId, a.contractId,
  [{ nyckel: 'troskellarm', kalla: 'redovisning', varde: { trosklar: TROSKLAR, larm, utan_egen_ram: [] } }]));
const friskIndikator = (a: Avtal) => indikator(a, []);
const tandIndikator = (a: Avtal, kod: string) => indikator(a, [{ ram: 'dagar', kod, slutdatum: '2026-09-13', precision: null,
  arvt_fran: null, forsening_dagar: 10, troskel_dagar: 5 }]);
async function foralder(a: Avtal, kod: string): Promise<string> {
  return withAdmin(async (c) => (await c.query(`SELECT f.code FROM contract_parts d
    JOIN contract_parts f ON f.id=d.parent_part_id AND f.company_id=d.company_id
    WHERE d.company_id=$1 AND d.contract_id=$2 AND d.code=$3 ORDER BY f.code LIMIT 1`, [companyId, a.contractId, kod])).rows[0]?.code ?? '');
}
const forslag = (a: Avtal) => withTenantTransaction(user.userId, companyId, (c) => lasRutinforslag(c, companyId, a.contractId));
const TRANSMITTAL = (kod: string) => ({ typ: 'transmittal', handling: { sort: 'mejl', extern_id: `<overlamning-${kod}@nvr.se>`,
  extern_kalla: 'gmail:locollabs' }, handelse_datum: '2026-09-12' });
const GODKANNANDE = (kod: string, godkand_av: string) => ({ typ: 'godkannande', handling: { sort: 'mejl', extern_id: `<godkant-${kod}@nvr.se>`,
  extern_kalla: 'gmail:locollabs' }, handelse_datum: '2026-09-15', godkand_av, kanal: 'mejl' });
const rutin = (a: Avtal, kod: string, kallhandelse: Record<string, unknown>) =>
  agent('registrera_rutinstatus', { ...indata(a, kod), kallhandelse });
async function rutinOk(a: Avtal, kod: string, kallhandelse: Record<string, unknown>) {
  const res = await rutin(a, kod, kallhandelse);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.result as Record<string, unknown>;
}
const overlamna = (a: Avtal, kod: string) => ok('bekrafta_statusbyte', { ...indata(a, kod), utfall: 'bekraftad', handling: TRANSMITTAL(kod).handling });
/** Ett eget bolag med en egen användare och ett avtal där L1 påbörjats; `nyttAvtal` är bunden till det första bolaget. */
async function grannavtal(): Promise<{ grannbolag: string; gc: string }> {
  const granne = await registerUser('rutinstatus-granne');
  const grannbolag = await createCompany(granne.token, 'Grannen Rutin AB');
  const gh = { Authorization: `Bearer ${granne.token}` };
  await createFiscalYear(grannbolag, gh, { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });
  const gok = async (namn: string, kropp: Record<string, unknown>) => {
    const res = await api.post(`/api/companies/${grannbolag}/actions/${namn}`).set(gh).send(kropp);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body.result as Record<string, unknown>;
  };
  const gp = (await gok('create_project', { name: 'Grannprojekt' })).id as string;
  const gc = (await gok('skapa_uppdrag', { project_id: gp, name: 'Grannavtal', signed_date: '2026-09-03' })).contract_id as string;
  await importeraOchGodkann(grannbolag, gh, { contract_id: gc, kontraktstext: LEVERANSKONTRAKT_NVR001 });
  await gok('paborja_leverabel', { contract_id: gc, leverabel_kod: 'L1' });
  return { grannbolag, gc };
}
/** Davids ja på förslaget: bara avtalet, koden och typen. Källhändelsen läses ur förslaget. */
const ja = (a: Avtal, kod: string, typ: string) => act('bekrafta_rutinforslag', { ...indata(a, kod), typ });
const agentJa = (a: Avtal, kod: string, typ: string) => agent('bekrafta_rutinforslag', { ...indata(a, kod), typ });
let ua: ReturnType<typeof supertest.agent>;
const bas = (a: Avtal) => `/app/c/${companyId}/projects/${a.projectId}`;
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
const tandSignal = async (a: Avtal) => (await ok('tand_scopesignal', { contract_id: a.contractId, fras: 'kan ni även ta' })).id as string;

beforeAll(async () => {
  user = await registerUser('rutinstatus');
  companyId = await createCompany(user.token, 'Rutinstatus AB');
  await createFiscalYear(companyId, auth(), { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });
  const tok = await api.post(`${co()}/agent-tokens`).set(auth()).send({ name: 'Rutinstatusprov' });
  expect(tok.status, JSON.stringify(tok.body)).toBe(201);
  agentToken = tok.body.token;
  ua = supertest.agent(app);
  const login = await ua.post('/app/login').type('form').send({ email: user.email, password: 'mycket-hemligt-losen-123' });
  expect([302, 303]).toContain(login.status);
});

describe('Story 14.1: rutinregeln (ren)', () => {
  const NVR = { godkannare: 'Styrgruppen', godkannare_eskalering: 'Eva Larsson (VD)' };
  const KEDJA = ['L1', 'STEG1', 'ROT'];
  const bas = { status: 'pagar', oppna_signaler: 0, larmkoder: [] as string[] | null, leverabelkedja: KEDJA, parter: NVR };
  const transmittal = (over: Partial<Rutinindata> = {}): Rutinindata => ({ ...bas, typ: 'transmittal', ...over });
  const godkannande = (godkand_av: string, over: Partial<Rutinindata> = {}): Rutinindata =>
    ({ ...bas, status: 'levererad', typ: 'godkannande', godkand_av, ...over });
  const LAGEN = ['ej_paborjad', 'pagar', 'levererad', 'godkand', 'avvisad'];

  it('14.1-R1: fyra steg, två källhändelser, och bara två steg kan tas av rutinvägen', () => {
    expect(OVERGANGAR).toEqual([
      { fran: 'ej_paborjad', till: 'pagar', kallhandelse: null, manniskovag: 'paborja_leverabel' },
      { fran: 'pagar', till: 'levererad', kallhandelse: 'transmittal', manniskovag: 'bekrafta_statusbyte' },
      { fran: 'levererad', till: 'godkand', kallhandelse: 'godkannande', manniskovag: 'godkann_leverabel' },
      { fran: 'pagar', till: 'avvisad', kallhandelse: null, manniskovag: 'bekrafta_statusbyte' },
    ]);
    expect([...KALLHANDELSETYPER]).toEqual(['transmittal', 'godkannande']);
    for (const typ of KALLHANDELSETYPER) expect(OVERGANGAR.filter((o) => o.kallhandelse === typ)).toHaveLength(1);
    const medgivna = new Set<string>();
    for (const status of LAGEN) {
      for (const typ of KALLHANDELSETYPER) {
        const u = provaRutinhandelse(typ === 'transmittal' ? transmittal({ status }) : godkannande('Styrgruppen', { status }));
        if (u.medges) medgivna.add(`${u.fran}->${u.till}`);
      }
    }
    expect(medgivna.size).toBeGreaterThan(0);
    for (const par of medgivna) expect(['pagar->levererad', 'levererad->godkand']).toContain(par);
  });

  it('14.1-R2: transmittalen i pågår medges med avtalets godkännare som mottagare', () => {
    expect(provaRutinhandelse(transmittal())).toEqual({ medges: true, fran: 'pagar', till: 'levererad', mottagare: 'Styrgruppen' });
  });

  it('14.1-R3: godkännandet medges bara från avtalets godkännare eller eskalering, exakt efter normalisering', () => {
    expect(provaRutinhandelse(godkannande('Styrgruppen'))).toEqual({ medges: true, fran: 'levererad', till: 'godkand', mottagare: 'Styrgruppen' });
    expect(provaRutinhandelse(godkannande('  eva   larsson (vd) '))).toEqual({ medges: true, fran: 'levererad', till: 'godkand', mottagare: 'Styrgruppen' });
    expect(provaRutinhandelse(godkannande('Eva Larsson'))).toEqual({ medges: false, skal: ['obehorig_godkannare'] });
    expect(provaRutinhandelse(godkannande('Hermes'))).toEqual({ medges: false, skal: ['obehorig_godkannare'] });
    expect(provaRutinhandelse(godkannande('Styrgruppen', { parter: { godkannare: null, godkannare_eskalering: null } })))
      .toEqual({ medges: false, skal: ['saknad_mottagare', 'obehorig_godkannare'] });
  });

  it('14.1-R4: en obesvarad scopesignal fäller båda typerna', () => {
    expect(provaRutinhandelse(transmittal({ oppna_signaler: 1 }))).toEqual({ medges: false, skal: ['signal_tand'] });
    expect(provaRutinhandelse(godkannande('Styrgruppen', { oppna_signaler: 1 }))).toEqual({ medges: false, skal: ['signal_tand'] });
  });

  it('14.1-R5: ett larm på leverabeln eller en nivå över den fäller, ett syskons gör det inte, och oläst fäller', () => {
    for (const kod of ['L1', 'STEG1', 'ROT']) {
      expect(provaRutinhandelse(transmittal({ larmkoder: [kod] }))).toEqual({ medges: false, skal: ['indikator_tand'] });
    }
    expect(provaRutinhandelse(transmittal({ larmkoder: ['L2'] })).medges).toBe(true);
    expect(provaRutinhandelse(transmittal({ larmkoder: null }))).toEqual({ medges: false, skal: ['indikator_olast'] });
  });

  it('14.1-R6: en källhändelse i fel läge fälls, så påbörjandet och returen nås aldrig', () => {
    for (const status of ['ej_paborjad', 'levererad', 'godkand', 'avvisad']) {
      expect(provaRutinhandelse(transmittal({ status }))).toEqual({ medges: false, skal: ['fel_utgangslage'] });
    }
    for (const status of ['ej_paborjad', 'pagar', 'godkand', 'avvisad']) {
      expect(provaRutinhandelse(godkannande('Styrgruppen', { status }))).toEqual({ medges: false, skal: ['fel_utgangslage'] });
    }
  });

  it('14.1-R7: utan avtalets godkännare fälls båda typerna, också när eskaleringen godkänt', () => {
    const parter = { godkannare: null, godkannare_eskalering: 'Eva Larsson (VD)' };
    expect(provaRutinhandelse(transmittal({ parter }))).toEqual({ medges: false, skal: ['saknad_mottagare'] });
    expect(provaRutinhandelse(godkannande('Eva Larsson (VD)', { parter }))).toEqual({ medges: false, skal: ['saknad_mottagare'] });
  });

  it('14.1-R8: alla skäl samlas i listans ordning, varje skäl har en text, och regeln är ren', () => {
    expect(provaRutinhandelse(transmittal({ status: 'ej_paborjad', oppna_signaler: 2, larmkoder: null })))
      .toEqual({ medges: false, skal: ['fel_utgangslage', 'signal_tand', 'indikator_olast'] });
    expect(new Set(Object.keys(RUTINSKALTEXT))).toEqual(new Set(RUTINSKAL));
    for (const text of Object.values(RUTINSKALTEXT)) expect(text).not.toContain('%');
    const fryst = <T>(v: T): T => {
      if (v && typeof v === 'object') { for (const x of Object.values(v)) fryst(x); Object.freeze(v); }
      return v;
    };
    for (const [typ, indata] of [['transmittal', transmittal({ larmkoder: ['L2'] })], ['godkannande', godkannande('Hermes')]] as const) {
      const f = fryst(structuredClone(indata));
      const forsta = provaRutinhandelse(f);
      expect(provaRutinhandelse(f)).toEqual(forsta);
      expect(f.typ satisfies Kallhandelsetyp).toBe(typ);
    }
  });
});

describe('Story 14.1: migrationen', () => {
  const VILLKOR = ['uppdrag_leverabel_handelse_registrerad_av_check', 'uppdrag_leverabel_handelse_kallhandelse_typ_check',
    'uppdrag_leverabel_handelse_kallhandelse_aktor_check', 'uppdrag_leverabel_handelse_registrering_check'];
  const INDEX = 'uppdrag_leverabel_handelse_kallhandelse_uk';
  let a: Avtal;
  let refId: string;
  beforeAll(async () => {
    a = await nyttAvtal('14.1 M');
    for (const kod of ['L1', 'L2']) await paborja(a, kod);
    refId = (await withTenantTransaction(user.userId, companyId, (c) => skapaReferens(c, companyId,
      { contract_id: a.contractId, sort: 'mejl', extern_id: '<migrationen@nvr.se>', extern_nyckel: 'rfc822#message-id', extern_kalla: 'gmail:locollabs' }))).id;
  });
  /** En rad på leverabeln med de fält som anges; allt annat ur en tillåten form. */
  type Rad = { bekraftat_av: string | null; registrerad_av: string; typ: string | null; ref: string | null; aktor: string | null; referens: boolean };
  const skriv = (kod: string, r: Rad) => withAdmin((c) => c.query(`INSERT INTO uppdrag_leverabel_handelse
      (company_id, contract_id, leverabel_id, fran, till, bekraftat_av, registrerad_av, kallhandelse_typ, kallhandelse_ref, kallhandelse_aktor, referens_id)
    SELECT company_id, contract_id, id, 'pagar', 'levererad', $4, $5, $6, $7, $8, $9 FROM uppdrag_leverabel
     WHERE company_id=$1 AND contract_id=$2 AND kod=$3`,
  [companyId, a.contractId, kod, r.bekraftat_av, r.registrerad_av, r.typ, r.ref, r.aktor, r.referens ? refId : null]));

  it('14.1-M1: kolumnerna, villkoren och indexet finns, och migrationen är idempotent', async () => {
    const migration = (await loadMigrations()).find((m) => m.name === 'rutinstatus');
    expect(migration).toBeDefined();
    const las = () => withAdmin(async (c) => ({
      kolumner: (await c.query(`SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns
        WHERE table_name='uppdrag_leverabel_handelse' AND column_name=ANY($1::text[]) ORDER BY column_name`,
      [['registrerad_av', 'kallhandelse_typ', 'kallhandelse_ref', 'kallhandelse_aktor']])).rows,
      villkor: (await c.query('SELECT conname FROM pg_constraint WHERE conname=ANY($1::text[]) ORDER BY conname', [VILLKOR])).rows,
      index: (await c.query('SELECT indexdef FROM pg_indexes WHERE indexname=$1', [INDEX])).rows,
    }));
    const fore = await las();
    expect(fore.kolumner).toEqual([
      { column_name: 'kallhandelse_aktor', data_type: 'text', is_nullable: 'YES', column_default: null },
      { column_name: 'kallhandelse_ref', data_type: 'text', is_nullable: 'YES', column_default: null },
      { column_name: 'kallhandelse_typ', data_type: 'text', is_nullable: 'YES', column_default: null },
      { column_name: 'registrerad_av', data_type: 'text', is_nullable: 'NO', column_default: expect.stringContaining('manniska') },
    ]);
    expect(fore.villkor.map((r) => r.conname)).toEqual([...VILLKOR].sort());
    expect(fore.index).toHaveLength(1);
    expect(fore.index[0].indexdef).toContain('UNIQUE');
    expect(fore.index[0].indexdef).toContain('leverabel_id, kallhandelse_typ, kallhandelse_ref');
    await withAdmin(async (c) => { await c.query(migration!.sql); await c.query(migration!.sql); });
    expect(await las()).toEqual(fore);
    const kommentar = await withAdmin(async (c) => (await c.query(`SELECT col_description('uppdrag_leverabel_handelse'::regclass, a.attnum) AS text
      FROM pg_attribute a WHERE a.attrelid='uppdrag_leverabel_handelse'::regclass AND a.attname='referens_id'`)).rows[0].text as string);
    expect(kommentar.startsWith('Handlingen som överlämningen eller returen registrerades ur, som rad i uppdrag_referens.')).toBe(true);
    expect(kommentar).toContain('källhändelse');
  });

  it('14.1-M2: elva otillåtna radformer fälls av villkoren, tre tillåtna går igenom', async () => {
    const fore = (await handelser(a)).filter((h) => h.kod === 'L1');
    expect(fore).toHaveLength(1);
    const fall: Array<[string, Rad]> = [
      ['a', { bekraftat_av: null, registrerad_av: 'manniska', typ: null, ref: null, aktor: null, referens: false }],
      ['b', { bekraftat_av: 'riggning', registrerad_av: 'system', typ: 'transmittal', ref: 'mejl:m2-b', aktor: null, referens: true }],
      ['c', { bekraftat_av: null, registrerad_av: 'system', typ: null, ref: 'mejl:m2-c', aktor: null, referens: true }],
      ['d', { bekraftat_av: null, registrerad_av: 'system', typ: 'transmittal', ref: null, aktor: null, referens: true }],
      ['e', { bekraftat_av: null, registrerad_av: 'system', typ: 'transmittal', ref: 'mejl:m2-e', aktor: null, referens: false }],
      ['f', { bekraftat_av: 'riggning', registrerad_av: 'manniska', typ: 'transmittal', ref: null, aktor: null, referens: true }],
      ['g', { bekraftat_av: 'riggning', registrerad_av: 'manniska', typ: 'transmittal', ref: 'mejl:m2-g', aktor: null, referens: false }],
      ['h', { bekraftat_av: 'riggning', registrerad_av: 'agent', typ: null, ref: null, aktor: null, referens: false }],
      ['i', { bekraftat_av: null, registrerad_av: 'system', typ: 'retur', ref: 'mejl:m2-i', aktor: null, referens: true }],
      ['j', { bekraftat_av: null, registrerad_av: 'system', typ: 'godkannande', ref: 'mejl:m2-j', aktor: null, referens: true }],
      ['k', { bekraftat_av: null, registrerad_av: 'system', typ: 'transmittal', ref: 'mejl:m2-k', aktor: 'Styrgruppen', referens: true }],
    ];
    expect(fall).toHaveLength(11);
    for (const [namn, rad] of fall) {
      await expect(skriv('L1', rad), namn).rejects.toMatchObject({ code: '23514' });
    }
    expect((await handelser(a)).filter((h) => h.kod === 'L1')).toEqual(fore);
    await skriv('L1', { bekraftat_av: 'riggning', registrerad_av: 'manniska', typ: null, ref: null, aktor: null, referens: false });
    await skriv('L1', { bekraftat_av: 'riggning', registrerad_av: 'manniska', typ: 'godkannande', ref: 'mejl:m2-manniska', aktor: 'Eva Larsson', referens: true });
    await skriv('L1', { bekraftat_av: null, registrerad_av: 'system', typ: 'transmittal', ref: 'mejl:m2-system', aktor: null, referens: true });
    const efter = (await handelser(a)).filter((h) => h.kod === 'L1');
    expect(efter).toHaveLength(4);
    expect(efter.slice(1).map((h) => [h.registrerad_av, h.kallhandelse_ref])).toEqual([
      ['manniska', null], ['manniska', 'mejl:m2-manniska'], ['system', 'mejl:m2-system'],
    ]);
  });

  it('14.1-M3: samma källhändelse på samma leverabel fälls av det unika indexet', async () => {
    const rad: Rad = { bekraftat_av: null, registrerad_av: 'system', typ: 'transmittal', ref: 'mejl:m3', aktor: null, referens: true };
    await skriv('L1', rad);
    await expect(skriv('L1', rad)).rejects.toMatchObject({ code: '23505', constraint: INDEX });
    await skriv('L2', rad);
    expect((await handelser(a)).filter((h) => h.kallhandelse_ref === 'mejl:m3').map((h) => h.kod)).toEqual(['L1', 'L2']);
  });
});

describe('Story 14.1: rutinvägen', () => {
  it('14.1-A1: transmittalen registreras utan fråga, med handlingen och utan mänsklig signatur', async () => {
    const a = await nyttAvtal('14.1 A1'); await friskIndikator(a); await paborja(a, 'L1');
    const antal = () => withAdmin(async (c) => (await c.query(`SELECT
      (SELECT count(*)::int FROM action_approvals WHERE company_id=$1) AS approvals,
      (SELECT count(*)::int FROM uppdrag_beslut WHERE company_id=$1 AND contract_id=$2) AS beslut`, [companyId, a.contractId])).rows[0]);
    const fore = await antal(); const poster = await undantag(); const ids = new Set((await referenser(a)).map((r) => r.id));
    const r = await rutinOk(a, 'L1', TRANSMITTAL('L1'));
    expect(r).toMatchObject({ utfall: 'registrerad', leverabel_kod: 'L1', fran: 'pagar', status: 'levererad', revision: 1,
      mottagare: 'Styrgruppen', registrerad_av: 'system', kallhandelse_typ: 'transmittal',
      kallhandelse_ref: 'mejl:overlamning-L1@nvr.se', kallhandelse_aktor: null, referens_id: expect.any(String) });
    const h = (await handelser(a)).find((x) => x.id === r.handelse_id)!;
    expect(h).toMatchObject({ fran: 'pagar', till: 'levererad', registrerad_av: 'system', bekraftat_av: null,
      kallhandelse_typ: 'transmittal', kallhandelse_ref: r.kallhandelse_ref, referens_id: r.referens_id, dag: '2026-09-12',
      kanal: null, notering: null, kallhandelse_aktor: null, mottagare: 'Styrgruppen' });
    expect(await referens(r.referens_id as string)).toMatchObject({ sort: 'mejl', extern_id: 'overlamning-L1@nvr.se',
      extern_nyckel: 'rfc822#message-id', extern_kalla: 'gmail:locollabs' });
    expect(await antal()).toEqual(fore);
    expect(await undantag()).toEqual(poster);
    expect(await godkannanden()).toEqual([]);
    expect((await audit()).find((x) => x.action === 'action.executed' && x.entity_id === 'registrera_rutinstatus')?.details)
      .toMatchObject({ actor: 'agent', sensitivity: 'write' });
    expect((await referenser(a)).filter((x) => !ids.has(x.id)))
      .toContainEqual(expect.objectContaining({ extern_nyckel: 'registerkopia', ko_status: 'koad' }));
    expect((await register(a)).find((x) => x.kod === 'L1')).toMatchObject({ status: 'levererad', revision: 1, mottagare: 'Styrgruppen' });
    // Append-only i samma form som schemaprovet: var sin transaktion, raden oförändrad efteråt.
    for (const sats of ["UPDATE uppdrag_leverabel_handelse SET till = 'godkand' WHERE id = $1", 'DELETE FROM uppdrag_leverabel_handelse WHERE id = $1']) {
      await expect(withTenantTransaction(user.userId, companyId, (c) => c.query(sats, [h.id]))).rejects.toThrow(/permission denied/);
    }
    expect((await handelser(a)).find((x) => x.id === h.id)).toEqual(h);
  });

  it('14.1-A2: godkännandet från eskaleringen registreras, med avsändaren som källuppgift och avtalets godkännare som mottagare', async () => {
    const a = await nyttAvtal('14.1 A2'); await friskIndikator(a); await paborja(a, 'L2'); await overlamna(a, 'L2');
    const r = await rutinOk(a, 'L2', GODKANNANDE('L2', 'Eva Larsson (VD)'));
    expect(r).toMatchObject({ utfall: 'registrerad', fran: 'levererad', status: 'godkand', revision: null, mottagare: 'Styrgruppen',
      registrerad_av: 'system', kallhandelse_typ: 'godkannande', kallhandelse_ref: 'mejl:godkant-L2@nvr.se', kallhandelse_aktor: 'Eva Larsson (VD)' });
    const rader = (await handelser(a)).filter((x) => x.kod === 'L2');
    expect(rader.find((x) => x.id === r.handelse_id)).toMatchObject({ till: 'godkand', registrerad_av: 'system', bekraftat_av: null,
      mottagare: 'Styrgruppen', kallhandelse_aktor: 'Eva Larsson (VD)', kanal: 'mejl', dag: '2026-09-15', referens_id: expect.any(String) });
    expect(rader.find((x) => x.till === 'levererad')).toMatchObject({ registrerad_av: 'manniska', bekraftat_av: user.userId,
      kallhandelse_typ: null, kallhandelse_ref: null, kallhandelse_aktor: null });
    expect((await register(a)).find((x) => x.kod === 'L2')).toMatchObject({ status: 'godkand', revision: 1, mottagare: 'Styrgruppen' });
  });

  it('14.1-A3: ett målläge, en okänd källhändelse eller en url i handlingen ger 400 utan skrivning', async () => {
    const a = await nyttAvtal('14.1 A3'); await friskIndikator(a); await paborja(a, 'L1');
    const fore = await handelser(a); const refs = await referenser(a);
    expect(fore).toHaveLength(1);
    const giltig = { ...indata(a, 'L1'), kallhandelse: TRANSMITTAL('L1') };
    for (const kropp of [
      {},
      { ...giltig, till: 'levererad' },
      { ...giltig, status: 'godkand' },
      { ...giltig, kallhandelse: { ...TRANSMITTAL('L1'), typ: 'paborjande' } },
      { ...giltig, kallhandelse: { ...TRANSMITTAL('L1'), typ: 'retur' } },
      { ...giltig, kallhandelse: { ...TRANSMITTAL('L1'), handling: { ...TRANSMITTAL('L1').handling, extern_id: 'https://mail.google.com/x' } } },
    ]) {
      const res = await agent('registrera_rutinstatus', kropp);
      expect(res.status, JSON.stringify(res.body)).toBe(400); expect(res.body.error).toBe('validation_error');
    }
    expect(await handelser(a)).toEqual(fore);
    expect(await statusar(a)).toContainEqual({ kod: 'L1', status: 'pagar' });
    expect(await referenser(a)).toEqual(refs);
    // Positiv kontroll: samma indata utan det otillåtna går igenom.
    expect((await rutinOk(a, 'L1', TRANSMITTAL('L1'))).utfall).toBe('registrerad');
  });

  it('14.1-A4: samma källhändelse igen registrerar ingenting en andra gång', async () => {
    const a = await nyttAvtal('14.1 A4'); await friskIndikator(a);
    await paborja(a, 'L1'); await paborja(a, 'L2'); await overlamna(a, 'L2');
    for (const [kod, kallhandelse, status] of [
      ['L1', TRANSMITTAL('L1'), 'levererad'], ['L2', GODKANNANDE('L2', 'Eva Larsson (VD)'), 'godkand'],
    ] as const) {
      const forsta = await rutinOk(a, kod, kallhandelse);
      expect(forsta.utfall).toBe('registrerad');
      const refs = (await referenser(a)).length;
      expect(await rutinOk(a, kod, kallhandelse)).toEqual({ utfall: 'redan_registrerad', handelse_id: forsta.handelse_id, leverabel_kod: kod, status });
      expect((await handelser(a)).filter((h) => h.kallhandelse_ref === forsta.kallhandelse_ref)).toHaveLength(1);
      expect((await referenser(a)).length).toBe(refs);
    }
  });

  it('14.1-A5: en källhändelse i framtiden eller före avtalet ger 400 utan skrivning', async () => {
    const a = await nyttAvtal('14.1 A5'); await friskIndikator(a); await paborja(a, 'L1');
    const fore = await handelser(a); const refs = await referenser(a);
    for (const [datum, fel] of [['2099-01-01', 'framtida_datum'], ['2026-09-01', 'fore_avtalet']] as const) {
      const res = await rutin(a, 'L1', { ...TRANSMITTAL('L1'), handelse_datum: datum });
      expect(res.status, JSON.stringify(res.body)).toBe(400); expect(res.body.error).toBe(fel);
      expect(await handelser(a)).toEqual(fore); expect(await referenser(a)).toEqual(refs);
    }
    // Positiv kontroll: signeringsdagen ligger inom fönstret.
    expect((await rutinOk(a, 'L1', { ...TRANSMITTAL('L1'), handelse_datum: '2026-09-03' })).utfall).toBe('registrerad');
  });

  it('14.1-A6: grannbolagets avtal och en okänd leverabel ger 404 utan skrivning i något bolag', async () => {
    const { grannbolag, gc } = await grannavtal();
    const grannlage = () => withAdmin(async (c) => ({
      handelser: (await c.query('SELECT * FROM uppdrag_leverabel_handelse WHERE company_id=$1 ORDER BY id', [grannbolag])).rows,
      referenser: (await c.query('SELECT * FROM uppdrag_referens WHERE company_id=$1 ORDER BY id', [grannbolag])).rows,
      cache: (await c.query('SELECT nyckel, varde FROM uppdrag_svepvarde WHERE company_id=$1 ORDER BY contract_id, nyckel', [grannbolag])).rows,
    }));
    const a = await nyttAvtal('14.1 A6'); await friskIndikator(a); await paborja(a, 'L1');
    const fore = { granne: await grannlage(), handelser: await handelser(a), referenser: await referenser(a), cache: await cache(a) };
    expect(fore.granne.handelser).toHaveLength(1);
    const fel = await agent('registrera_rutinstatus', { contract_id: gc, leverabel_kod: 'L1', kallhandelse: TRANSMITTAL('L1') });
    expect(fel.status, JSON.stringify(fel.body)).toBe(404);
    const okand = await rutin(a, 'L99', TRANSMITTAL('L99'));
    expect(okand.status, JSON.stringify(okand.body)).toBe(404);
    expect({ granne: await grannlage(), handelser: await handelser(a), referenser: await referenser(a), cache: await cache(a) }).toEqual(fore);
  });

  it('14.1-A7: de tre spärrarna står kvar, och rutinvägen är write utan spärr och utan kö (delvis regression)', async () => {
    const a = await nyttAvtal('14.1 A7'); await friskIndikator(a); await paborja(a, 'L1'); await paborja(a, 'L2');
    for (const namn of ['paborja_leverabel', 'bekrafta_statusbyte', 'godkann_leverabel']) {
      expect(getAction(namn)).toMatchObject({ kravManniska: true, sensitivity: 'write' });
    }
    const fore = await handelser(a);
    const nej = await agent('bekrafta_statusbyte', { ...indata(a, 'L1'), utfall: 'bekraftad', handling: TRANSMITTAL('L1').handling });
    expect(nej.status, JSON.stringify(nej.body)).toBe(403); expect(nej.body.error).toBe('human_required');
    expect(await handelser(a)).toEqual(fore);
    const rutinvagen = getAction('registrera_rutinstatus');
    expect(rutinvagen).toMatchObject({ sensitivity: 'write' });
    expect(rutinvagen!.kravManniska).toBeFalsy(); expect(rutinvagen!.koasForAgent).toBeFalsy();
    expect(rutinvagen!.description?.trim()).toBeTruthy();
    const m = await overlamna(a, 'L2');
    expect((await handelser(a)).find((h) => h.id === m.handelse_id)).toMatchObject({ registrerad_av: 'manniska', bekraftat_av: user.userId,
      kallhandelse_typ: null, kallhandelse_ref: null, kallhandelse_aktor: null });
  });
});

describe('Story 14.1: det fällda blir ett förslag', () => {
  it('14.1-F1: en tänd signal fäller transmittalen till ett förslag, och efter avgörandet medges samma källhändelse', async () => {
    const a = await nyttAvtal('14.1 F1'); await friskIndikator(a); await paborja(a, 'L1');
    const signal = await tandSignal(a);
    const lage = async () => ({ statusar: await statusar(a), handelser: await handelser(a), referenser: await referenser(a), poster: await undantag() });
    const fore = await lage();
    expect(fore.poster.some((p) => p.endsWith(`:${signal}`))).toBe(true);
    const r = await rutinOk(a, 'L1', TRANSMITTAL('L1'));
    const regel = provaRutinhandelse({ typ: 'transmittal', status: 'pagar', oppna_signaler: 1, larmkoder: [], leverabelkedja: ['L1', 'S1', 'UPPDRAG'], parter: PARTER });
    expect(regel.medges).toBe(false);
    expect(r).toEqual({ utfall: 'falld', leverabel_kod: 'L1', status: 'pagar', skal: ['signal_tand'] });
    expect(r.skal).toEqual(regel.medges ? null : regel.skal);
    expect(r).not.toHaveProperty('forslag_atgard');
    expect(await lage()).toEqual(fore);
    expect(await godkannanden()).toEqual([]);
    expect(await forslag(a)).toEqual([{ leverabel_kod: 'L1', skal: ['signal_tand'], kallhandelse: { typ: 'transmittal',
      handling: { sort: 'mejl', extern_id: 'overlamning-L1@nvr.se', extern_kalla: 'gmail:locollabs' }, handelse_datum: '2026-09-12' } }]);
    await ok('avgor_scopesignal', { signal_id: signal, avgjord: 'innanfor' });
    expect((await rutinOk(a, 'L1', TRANSMITTAL('L1'))).utfall).toBe('registrerad');
    expect(await forslag(a)).toEqual([]);
    expect((await cache(a)).map((x) => x.nyckel)).not.toContain(RUTINFORSLAGSNYCKEL);
  });

  it('14.1-F2: indikatorn fäller för leverabeln och varje nivå över den, inte för ett syskon, och oläst fäller', async () => {
    const a = await nyttAvtal('14.1 F2 a'); const b = await nyttAvtal('14.1 F2 b');
    const c = await nyttAvtal('14.1 F2 c'); const d = await nyttAvtal('14.1 F2 d');
    for (const x of [a, b, c, d]) await paborja(x, 'L1');
    await tandIndikator(a, 'L1'); await tandIndikator(b, 'L2');
    expect(await rutinOk(a, 'L1', TRANSMITTAL('L1'))).toMatchObject({ utfall: 'falld', skal: ['indikator_tand'] });
    expect(await rutinOk(b, 'L1', TRANSMITTAL('L1'))).toMatchObject({ utfall: 'registrerad' });
    expect((await cache(c)).map((x) => x.nyckel)).not.toContain('troskellarm');
    expect(await rutinOk(c, 'L1', TRANSMITTAL('L1'))).toMatchObject({ utfall: 'falld', skal: ['indikator_olast'] });
    const over = await foralder(d, 'L1');
    expect(over).not.toBe(''); expect(over).not.toBe('L1');
    await tandIndikator(d, over);
    expect(await rutinOk(d, 'L1', TRANSMITTAL('L1'))).toMatchObject({ utfall: 'falld', skal: ['indikator_tand'] });
    await tandIndikator(d, 'UPPDRAG');
    expect(await rutinOk(d, 'L1', TRANSMITTAL('L1'))).toMatchObject({ utfall: 'falld', skal: ['indikator_tand'] });
  });

  it('14.1-F3: ett godkännande från en obehörig avsändare blir ett förslag, aldrig ett godkännande', async () => {
    const a = await nyttAvtal('14.1 F3'); await friskIndikator(a); await paborja(a, 'L1'); await overlamna(a, 'L1');
    const fore = await handelser(a);
    expect(await rutinOk(a, 'L1', GODKANNANDE('L1', 'Hermes'))).toEqual({ utfall: 'falld', leverabel_kod: 'L1', status: 'levererad', skal: ['obehorig_godkannare'] });
    expect(await statusar(a)).toContainEqual({ kod: 'L1', status: 'levererad' });
    expect(await handelser(a)).toEqual(fore);
    expect(fore.filter((h) => h.till === 'godkand')).toEqual([]);
    expect(await forslag(a)).toEqual([{ leverabel_kod: 'L1', skal: ['obehorig_godkannare'], kallhandelse: { typ: 'godkannande',
      handling: { sort: 'mejl', extern_id: 'godkant-L1@nvr.se', extern_kalla: 'gmail:locollabs' }, handelse_datum: '2026-09-15',
      godkand_av: 'Hermes', kanal: 'mejl' } }]);
    expect(await rutinOk(a, 'L1', GODKANNANDE('L1', 'Styrgruppen'))).toMatchObject({ utfall: 'registrerad', status: 'godkand' });
  });

  it('14.1-F4: förslaget överlever svepet, och bara dess eget omfång skriver nyckeln', async () => {
    const a = await nyttAvtal('14.1 F4'); await friskIndikator(a); await paborja(a, 'L1'); await tandSignal(a);
    expect((await rutinOk(a, 'L1', TRANSMITTAL('L1'))).utfall).toBe('falld');
    const fore = (await cache(a)).find((x) => x.nyckel === RUTINFORSLAGSNYCKEL);
    expect(fore).toBeDefined();
    await withTenantTransaction(user.userId, companyId, (c) => upsertSvepvarden(c, companyId, a.contractId, [{ nyckel: 'prognos', varde: {} }]));
    const efter = await cache(a);
    // Negativ kontroll: standardomfånget tog bort troskellarm, men inte förslaget.
    expect(efter.map((x) => x.nyckel)).toEqual(['prognos', RUTINFORSLAGSNYCKEL]);
    expect(efter.find((x) => x.nyckel === RUTINFORSLAGSNYCKEL)).toEqual(fore);
    for (const [omfang, nyckel] of [['svep', RUTINFORSLAGSNYCKEL], ['rutinforslag', 'prognos']] as const) {
      await expect(withTenantTransaction(user.userId, companyId, (c) => upsertSvepvarden(c, companyId, a.contractId, [{ nyckel, varde: {} }], omfang)),
        `${omfang}/${nyckel}`).rejects.toBeInstanceOf(Error);
    }
    expect(await cache(a)).toEqual(efter);
  });

  it('14.1-F5: ett påbörjande tas aldrig av rutinvägen', async () => {
    const a = await nyttAvtal('14.1 F5'); await friskIndikator(a);
    expect(await statusar(a)).toContainEqual({ kod: 'L3', status: 'ej_paborjad' });
    const fore = await handelser(a);
    expect(await rutinOk(a, 'L3', TRANSMITTAL('L3'))).toEqual({ utfall: 'falld', leverabel_kod: 'L3', status: 'ej_paborjad', skal: ['fel_utgangslage'] });
    expect(await statusar(a)).toContainEqual({ kod: 'L3', status: 'ej_paborjad' });
    expect(await handelser(a)).toEqual(fore);
  });
});

describe('Story 14.1: Davids ja på förslaget', () => {
  const lage = async (a: Avtal) => ({ statusar: await statusar(a), handelser: await handelser(a), referenser: await referenser(a), forslag: await forslag(a) });

  it('14.1-J1: agentens ja fälls, Davids ja registrerar källhändelsen ur förslaget med hans namn och källan kvar', async () => {
    const a = await nyttAvtal('14.1 J1'); await friskIndikator(a); await paborja(a, 'L1');
    const signal = await tandSignal(a);
    expect((await rutinOk(a, 'L1', TRANSMITTAL('L1'))).utfall).toBe('falld');
    const fore = await lage(a);
    expect(fore.forslag).toHaveLength(1);
    const nej = await agentJa(a, 'L1', 'transmittal');
    expect(nej.status, JSON.stringify(nej.body)).toBe(403); expect(nej.body.error).toBe('human_required');
    expect(await lage(a)).toEqual(fore);
    const svar = await ja(a, 'L1', 'transmittal');
    expect(svar.status, JSON.stringify(svar.body)).toBe(200);
    const r = svar.body.result as Record<string, unknown>;
    expect(r).toMatchObject({ utfall: 'registrerad', status: 'levererad', revision: 1, mottagare: 'Styrgruppen', registrerad_av: 'manniska',
      kallhandelse_typ: 'transmittal', kallhandelse_ref: 'mejl:overlamning-L1@nvr.se', referens_id: expect.any(String) });
    expect((await handelser(a)).find((h) => h.id === r.handelse_id)).toMatchObject({ registrerad_av: 'manniska', bekraftat_av: user.userId,
      dag: '2026-09-12', kallhandelse_typ: 'transmittal', kallhandelse_ref: 'mejl:overlamning-L1@nvr.se', kallhandelse_aktor: null });
    expect(await referens(r.referens_id as string)).toMatchObject({ extern_id: 'overlamning-L1@nvr.se', extern_kalla: 'gmail:locollabs' });
    expect(await forslag(a)).toEqual([]);
    expect((await cache(a)).map((x) => x.nyckel)).not.toContain(RUTINFORSLAGSNYCKEL);
    expect((await undantag()).some((p) => p.endsWith(`:${signal}`))).toBe(true);
    expect((await audit()).find((x) => x.action === 'action.executed' && x.entity_id === 'bekrafta_rutinforslag')?.details)
      .toMatchObject({ actor: 'human' });
    expect(await rutinOk(a, 'L1', TRANSMITTAL('L1'))).toEqual({ utfall: 'redan_registrerad', handelse_id: r.handelse_id, leverabel_kod: 'L1', status: 'levererad' });
    expect((await handelser(a)).filter((h) => h.kallhandelse_ref === 'mejl:overlamning-L1@nvr.se')).toHaveLength(1);
  });

  it('14.1-J2: Davids ja på ett godkännande från en okänd avsändare bevarar avsändaren som källuppgift', async () => {
    const a = await nyttAvtal('14.1 J2'); await friskIndikator(a); await paborja(a, 'L2'); await overlamna(a, 'L2');
    expect(await rutinOk(a, 'L2', GODKANNANDE('L2', 'Eva Larsson'))).toMatchObject({ utfall: 'falld', skal: ['obehorig_godkannare'] });
    const svar = await ja(a, 'L2', 'godkannande');
    expect(svar.status, JSON.stringify(svar.body)).toBe(200);
    const r = svar.body.result as Record<string, unknown>;
    expect(r).toMatchObject({ utfall: 'registrerad', status: 'godkand', revision: null, mottagare: 'Styrgruppen', kallhandelse_aktor: 'Eva Larsson' });
    const h = (await handelser(a)).find((x) => x.id === r.handelse_id)!;
    expect(h).toMatchObject({ registrerad_av: 'manniska', bekraftat_av: user.userId, kanal: 'mejl', dag: '2026-09-15',
      kallhandelse_typ: 'godkannande', mottagare: 'Styrgruppen', kallhandelse_aktor: 'Eva Larsson', referens_id: expect.any(String) });
    expect(await referens(h.referens_id)).toMatchObject({ extern_id: 'godkant-L2@nvr.se' });
    expect((await register(a)).find((x) => x.kod === 'L2')).toMatchObject({ status: 'godkand' });
    expect(await godkannanden()).toEqual([]);
  });

  it('14.1-J3: ett ja som inte går att utföra skriver ingenting', async () => {
    const a = await nyttAvtal('14.1 J3'); await friskIndikator(a); await paborja(a, 'L1'); await tandSignal(a);
    expect((await rutinOk(a, 'L1', TRANSMITTAL('L1'))).utfall).toBe('falld');
    let fore = await lage(a);
    expect(fore.forslag).toHaveLength(1);
    for (const kropp of [
      {},
      { ...indata(a, 'L1'), typ: 'retur' },
      { ...indata(a, 'L1'), typ: 'transmittal', handling: TRANSMITTAL('L1').handling },
      { ...indata(a, 'L1'), typ: 'transmittal', godkand_av: 'Styrgruppen' },
    ]) {
      const res = await act('bekrafta_rutinforslag', kropp);
      expect(res.status, JSON.stringify(res.body)).toBe(400); expect(res.body.error).toBe('validation_error');
      expect(await lage(a)).toEqual(fore);
    }
    const utan = await ja(a, 'L3', 'transmittal');
    expect(utan.status, JSON.stringify(utan.body)).toBe(404);
    expect(await lage(a)).toEqual(fore);
    await ok('bekrafta_statusbyte', { ...indata(a, 'L1'), utfall: 'retur' });
    fore = await lage(a);
    expect(fore.statusar).toContainEqual({ kod: 'L1', status: 'avvisad' });
    const fel = await ja(a, 'L1', 'transmittal');
    expect(fel.status, JSON.stringify(fel.body)).toBe(409); expect(fel.body.error).toBe('fel_utgangslage');
    expect(await lage(a)).toEqual(fore);
    expect(fore.forslag).toHaveLength(1);
    const b = await nyttAvtal('14.1 J3 utan parter', null); await friskIndikator(b); await paborja(b, 'L1');
    expect(await rutinOk(b, 'L1', TRANSMITTAL('L1'))).toMatchObject({ utfall: 'falld', skal: ['saknad_mottagare'] });
    const foreB = await lage(b);
    const saknad = await ja(b, 'L1', 'transmittal');
    expect(saknad.status, JSON.stringify(saknad.body)).toBe(409); expect(saknad.body.error).toBe('saknad_mottagare');
    expect(await lage(b)).toEqual(foreB);
    const { gc } = await grannavtal();
    const granne = await act('bekrafta_rutinforslag', { contract_id: gc, leverabel_kod: 'L1', typ: 'transmittal' });
    expect(granne.status, JSON.stringify(granne.body)).toBe(404);
  });

  it('14.1-J4: Davids ja är write med människospärr och har bara avtal, kod och typ (delvis regression)', () => {
    const jaet = getAction('bekrafta_rutinforslag');
    expect(jaet).toMatchObject({ sensitivity: 'write', kravManniska: true });
    expect(jaet!.koasForAgent).toBeFalsy(); expect(jaet!.description?.trim()).toBeTruthy();
    expect(Object.keys((jaet!.inputSchema as unknown as { shape: Record<string, unknown> }).shape).sort())
      .toEqual(['contract_id', 'leverabel_kod', 'typ']);
    for (const namn of ['paborja_leverabel', 'bekrafta_statusbyte', 'godkann_leverabel']) {
      expect(getAction(namn)).toMatchObject({ kravManniska: true, sensitivity: 'write' });
    }
  });
});

describe('Story 14.1: förslaget på kortet', () => {
  let p: Avtal; let q: Avtal;
  beforeAll(async () => {
    p = await nyttAvtal('14.1 V med parter'); await friskIndikator(p);
    for (const kod of ['L1', 'L2', 'L3']) await paborja(p, kod);
    await overlamna(p, 'L3'); await tandSignal(p);
    for (const [kod, kallhandelse] of [['L1', TRANSMITTAL('L1')], ['L3', GODKANNANDE('L3', 'Hermes')], ['L3', TRANSMITTAL('L3')]] as const) {
      expect((await rutinOk(p, kod, kallhandelse)).utfall).toBe('falld');
    }
    q = await nyttAvtal('14.1 V utan parter', null); await friskIndikator(q); await paborja(q, 'L1');
    expect(await rutinOk(q, 'L1', TRANSMITTAL('L1'))).toMatchObject({ utfall: 'falld', skal: ['saknad_mottagare'] });
  });

  it('14.1-V1: transmittalens förslag står först på kortet i pågår, med en knapp för Davids ja och formulären orörda', async () => {
    const main = huvud(await sida(`${bas(p)}/leveranserna`)); const k = kort(main, 'L1');
    for (const x of ['Hermes hittade överlämningen i mejlet', 'overlamning-L1@nvr.se', RUTINSKALTEXT.signal_tand,
      'name="forslag_typ" value="transmittal"', 'aria-label="Registrera källhändelsen för leverabel L1"',
      '<option value="mejl">', `name="handling_kalla" maxlength="200" value="${user.email}"`]) expect(k).toContain(x);
    expect(k).not.toContain(RUTINSKALTEXT.fel_utgangslage);
    expect(k).not.toMatch(/<option[^>]*selected/);
    expect(k.split(`action="${bas(p)}/statusforslag"`)).toHaveLength(4);
    expect(k.indexOf('Hermes hittade')).toBeLessThan(k.indexOf('name="handling_id"'));
    const l2 = kort(main, 'L2');
    expect(l2).toContain('name="handling_id"');
    expect(l2).not.toContain('Hermes hittade'); expect(l2).not.toContain('forslag_typ');
  });

  it('14.1-V2: godkännandets förslag står bara i levererad, och utan mottagarpart visas raden utan knapp', async () => {
    const l3 = kort(huvud(await sida(`${bas(p)}/leveranserna`)), 'L3');
    expect(l3).toContain('Hermes hittade ett godkännande från Hermes via Mejl den 2026-09-15');
    expect(l3).toContain(RUTINSKALTEXT.obehorig_godkannare);
    expect(l3).toContain('name="forslag_typ" value="godkannande"');
    expect(l3).toContain('<select name="kanal" required>'); expect(l3).not.toMatch(/<option[^>]*selected/);
    expect(l3).not.toContain('Hermes hittade överlämningen');
    const kq = kort(huvud(await sida(`${bas(q)}/leveranserna`)), 'L1');
    expect(kq).toContain('Hermes hittade överlämningen');
    expect(kq).toContain(`${LUCKTEXT.mottagarpart.vad}. Registrera själv nedan.`);
    expect(kq).not.toContain('forslag_typ');
    expect(kort(huvud(await sida(`${bas(p)}/leveranserna`)), 'L1')).not.toContain('Registrera själv nedan.');
  });

  it('14.1-V3: knappen registrerar källhändelsen genom action-lagret, och ett ja i fel läge visas som notis utan skrivning', async () => {
    const res = await ua.post(`${bas(p)}/statusforslag`).type('form').send({ contract_id: p.contractId, leverabel_kod: 'L1', forslag_typ: 'transmittal' });
    expect(res.status, res.text).toBe(302); expect(res.headers.location).toBe(bas(p));
    expect(await statusar(p)).toContainEqual({ kod: 'L1', status: 'levererad' });
    expect((await handelser(p)).filter((h) => h.kod === 'L1').at(-1)).toMatchObject({ registrerad_av: 'manniska', bekraftat_av: user.userId,
      kallhandelse_ref: 'mejl:overlamning-L1@nvr.se' });
    expect((await audit()).map((x) => `${x.action}:${x.entity_id}`)).toContain('action.executed:bekrafta_rutinforslag');
    expect((await forslag(p)).map((f) => f.leverabel_kod)).not.toContain('L1');
    const fore = { handelser: await handelser(p), forslag: (await forslag(p)).filter((f) => f.leverabel_kod === 'L3') };
    expect(fore.forslag.map((f) => f.kallhandelse.typ)).toContain('transmittal');
    const fel = await ua.post(`${bas(p)}/statusforslag`).type('form').send({ contract_id: p.contractId, leverabel_kod: 'L3', forslag_typ: 'transmittal' });
    expect(fel.status, fel.text).toBe(302); expect(fel.headers.location).toContain(`${bas(p)}?fel=`);
    expect(decodeURIComponent(fel.headers.location!)).toContain(FORSLAG_FEL_LAGE);
    expect({ handelser: await handelser(p), forslag: (await forslag(p)).filter((f) => f.leverabel_kod === 'L3') }).toEqual(fore);
  });

  it('14.1-V4: förslaget står inte på förstasidan, i Läget eller i undantagsvyn (regression)', async () => {
    expect((await forslag(p)).length).toBeGreaterThanOrEqual(2);
    for (const path of [bas(p), `${bas(p)}/laget`, `/app/c/${companyId}/uppdrag`]) {
      expect(huvud(await sida(path)), path).not.toContain('Hermes hittade');
    }
  });
});

describe('Story 14.1: dokumentationen', () => {
  /** 4.2-D1:s läsare: till nästa rubrik på nivå två eller tre. */
  function avsnitt(text: string, rubrik: string) {
    const start = text.indexOf(rubrik);
    expect(start).toBeGreaterThanOrEqual(0);
    return text.slice(start + rubrik.length).split(/\n#{2,3} /)[0]!;
  }
  /** 4.4-D1:s läsare: till nästa rubrik på nivå två. */
  function helaAvsnittet(text: string, rubrik: string, slut: RegExp): string {
    const start = text.indexOf(rubrik);
    expect(start).toBeGreaterThanOrEqual(0);
    const resten = text.slice(start + rubrik.length);
    const end = resten.search(slut);
    return rubrik + (end === -1 ? resten : resten.slice(0, end));
  }
  const normalisera = (s: string) => s.replace(/\s+/g, ' ');
  /** Uppräkningen av de spärrade åtgärderna, från «markta `kravManniska`» till «avvisas». */
  function sparrlista(text: string): string | null {
    const rad = text.split('\n').find((r) => r.includes('markta `kravManniska`'));
    if (!rad) return null;
    const start = rad.indexOf('markta `kravManniska`');
    return rad.slice(start, rad.indexOf('avvisas', start));
  }
  const sparrHaller = (text: string) => {
    const lista = sparrlista(text);
    return lista !== null && lista.includes('bekrafta_rutinforslag') && !lista.includes('registrera_rutinstatus');
  };
  /** Handgrepp-provets mönster: ett ensamt kodspann av gemener med understreck. */
  const ensammaSpann = (text: string) => [...text.matchAll(/`([^`\n]+)`/g)].map((m) => m[1]!)
    .filter((s) => /^[a-z_]+$/.test(s) && s.includes('_'));

  it('14.1-D1: arkitekturen beskriver rutinvägen, och bara Davids ja står bland de spärrade åtgärderna', async () => {
    const text = avsnitt(await readFile(new URL('../../docs/ARKITEKTUR.md', import.meta.url), 'utf8'), '## Uppdragsytan (modul)');
    const norm = normalisera(text);
    expect(text.split('\n').some((rad) => rad.startsWith('**Rutinvagen (FR-13, Story 14.1).**'))).toBe(true);
    for (const n of ['server/src/lib/rutinregel.ts', 'registrera_rutinstatus', 'bekrafta_rutinforslag', 'registrerad_av',
      'kallhandelse_ref', 'kallhandelse_aktor', 'rutinforslag', 'transmittal', 'godkannande',
      'En fjarde, kallbelagd rutinvag', 'FR-13']) expect(norm).toContain(n);
    expect(sparrHaller(text)).toBe(true);
    const fore = '`godkann_leverabel`, `bekrafta_rutinforslag`';
    expect(text).toContain(fore);
    expect(sparrHaller(text.replace(fore, '`godkann_leverabel`, `registrera_rutinstatus`, `bekrafta_rutinforslag`'))).toBe(false);
    expect(sparrHaller(text.replace(fore, '`godkann_leverabel`'))).toBe(false);
  });

  it('14.1-D2: åtgärdsdokumentet har rutinvägen inne i Uppdragsytan, utan ensamma kodspann med understreck', async () => {
    const docs = await readFile(new URL('../../docs/MCP_ACTIONS.md', import.meta.url), 'utf8');
    const rubrik = '### Rutinvägen (Story 14.1)';
    const modulStart = docs.indexOf('## Uppdragsytan');
    const modulSlut = modulStart + docs.slice(modulStart + 1).search(/^## /m) + 1;
    expect(docs.indexOf(rubrik)).toBeGreaterThan(modulStart);
    expect(docs.indexOf(rubrik)).toBeLessThan(modulSlut);
    const text = avsnitt(docs, rubrik);
    const norm = normalisera(text);
    for (const n of ['registrera_rutinstatus', 'bekrafta_rutinforslag', 'kallhandelse_aktor', 'transmittal', 'godkannande', 'rutinforslag']) {
      expect(norm).toContain(n);
    }
    expect(ensammaSpann(text)).toEqual([]);
    expect(ensammaSpann(`${text}\n- \`registrerad_av\``)).toEqual(['registrerad_av']);
    expect(ensammaSpann(`${text}\n- \`datum_saknas\``)).toEqual(['datum_saknas']);
    expect(ensammaSpann("- `registrerad_av = 'system'`")).toEqual([]);
    expect(helaAvsnittet(docs, '## Uppdragsytan', /^## /m)).not.toContain('las_faktureringsunderlag');
  });
});
