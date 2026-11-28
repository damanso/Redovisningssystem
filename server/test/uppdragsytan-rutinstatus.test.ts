// Story 14.1, FR-13/FR-12/NFR-4: ett rutinmässigt statusbyte registreras ur sin
// källhändelse utan fråga. Riskerna: en maskin flyttar ett läge som kräver
// Davids omdöme, ett godkännande uppfinns av modellen, och en rutinregistrering
// bär en mänsklig signatur. Regeln prövas ren, migrationen i databasen, och
// åtgärderna, förslaget och kortet genom hela stacken mot Postgres.
import { readFile } from 'node:fs/promises';
import supertest from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { app, api, createCompany, createFiscalYear, registerUser, withAdmin, type TestUser } from './helpers.js';
import { importeraOchGodkann } from './uppdragImportHelper.js';
import { LEVERANSKONTRAKT_NVR001 } from './fixtures/leveranskontrakt-nvr-001.js';
import { withTenantTransaction } from '../src/db/tx.js';
import { loadMigrations } from '../src/db/migrate.js';
import { skapaReferens } from '../src/services/uppdragReferens.js';
import { getAction } from '../src/actions/registry.js';
import { FORSLAG_FEL_LAGE, lasRutinforslag } from '../src/services/uppdragStatus.js';
import { RUTINFORSLAGSNYCKEL, upsertSvepvarden } from '../src/services/uppdragSvep.js';
import type { Leverabelrad } from '../src/services/uppdragRegister.js';
import type { Approval } from '../src/services/approvals.js';
import { LUCKTEXT } from '../src/lib/kontraktsluckor.js';
import {
  KALLHANDELSETYPER, OVERGANGAR, RUTINSKAL, RUTINSKALTEXT, provaRutinhandelse,
  type Rutinindata,
} from '../src/lib/rutinregel.js';

const PARTER = { godkannare: 'Styrgruppen', godkannare_eskalering: 'Eva Larsson (VD)',
  godkannandeform: 'Telefon eller mejl från Eva Larsson räcker och loggas med datum och kanal', kalla: 'leveranskontraktet' };
type Avtal = { projectId: string; contractId: string };
let user: TestUser;
let companyId: string;
let agentToken: string;
let ua: ReturnType<typeof supertest.agent>;
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
async function statusar(a: Avtal) {
  return withAdmin(async (c) => (await c.query('SELECT kod, status FROM uppdrag_leverabel WHERE company_id=$1 AND contract_id=$2 ORDER BY kod', [companyId, a.contractId])).rows);
}
async function referenser(a: Avtal) {
  return withAdmin(async (c) => (await c.query('SELECT * FROM uppdrag_referens WHERE company_id=$1 AND contract_id=$2 ORDER BY id', [companyId, a.contractId])).rows);
}
async function svepcache(contractId: string, bolag = companyId) {
  return withAdmin(async (c) => (await c.query('SELECT nyckel, varde FROM uppdrag_svepvarde WHERE company_id=$1 AND contract_id=$2 ORDER BY nyckel', [bolag, contractId])).rows);
}
async function audit() {
  const res = await api.get(`${co()}/audit`).set(auth());
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.entries as Array<{ action: string; entity_id: string; details: Record<string, unknown> }>;
}
/** Godkännandekön: det som väntar på ett mänskligt beslut. */
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
  return (res.body.result.poster as Array<{ identitet: string; id: string }>).map((p) => `${p.identitet}:${p.id}`).sort();
}
const agent = (namn: string, kropp: Record<string, unknown>) => act(namn, kropp, { Authorization: `Bearer ${agentToken}` });
const TROSKLAR = { procent: 5, golv_ore: 0, golv_timmar: 0, dagar: 5 };
async function indikator(a: Avtal, larm: unknown[]) {
  await withTenantTransaction(user.userId, companyId, (c) => upsertSvepvarden(c, companyId, a.contractId,
    [{ nyckel: 'troskellarm', kalla: 'redovisning', varde: { trosklar: TROSKLAR, larm, utan_egen_ram: [] } }]));
}
const friskIndikator = (a: Avtal) => indikator(a, []);
const tandIndikator = (a: Avtal, kod: string) => indikator(a, [{ ram: 'dagar', kod, slutdatum: '2026-09-13',
  precision: null, arvt_fran: null, forsening_dagar: 10, troskel_dagar: 5 }]);
async function foralder(a: Avtal, kod: string): Promise<string> {
  return withAdmin(async (c) => (await c.query<{ code: string }>(`SELECT f.code FROM contract_parts d
    JOIN contract_parts f ON f.id=d.parent_part_id AND f.company_id=d.company_id
    WHERE d.company_id=$1 AND d.contract_id=$2 AND d.code=$3 LIMIT 1`, [companyId, a.contractId, kod])).rows[0]?.code ?? '');
}
const forslag = (a: Avtal) => withTenantTransaction(user.userId, companyId, (c) => lasRutinforslag(c, companyId, a.contractId));
const TRANSMITTAL = (kod: string) => ({ typ: 'transmittal', handling: { sort: 'mejl', extern_id: `<overlamning-${kod}@nvr.se>`, extern_kalla: 'gmail:locollabs' }, handelse_datum: '2026-09-12' });
const GODKANNANDE = (kod: string, godkand_av: string) => ({ typ: 'godkannande',
  handling: { sort: 'mejl', extern_id: `<godkant-${kod}@nvr.se>`, extern_kalla: 'gmail:locollabs' }, handelse_datum: '2026-09-15', godkand_av, kanal: 'mejl' });
const rutin = (a: Avtal, kod: string, kallhandelse: Record<string, unknown>) =>
  agent('registrera_rutinstatus', { ...indata(a, kod), kallhandelse });
async function rutinOk(a: Avtal, kod: string, kallhandelse: Record<string, unknown>) {
  const res = await rutin(a, kod, kallhandelse);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.result as Record<string, unknown>;
}
const overlamna = (a: Avtal, kod: string) => ok('bekrafta_statusbyte', { ...indata(a, kod), utfall: 'bekraftad', handling: TRANSMITTAL(kod).handling });
/** Davids ja på förslaget, som människa, och samma anrop med agentens token. */
const ja = (a: Avtal, kod: string, typ: string) => act('bekrafta_rutinforslag', { ...indata(a, kod), typ });
const agentJa = (a: Avtal, kod: string, typ: string) => agent('bekrafta_rutinforslag', { ...indata(a, kod), typ });
/** Ett eget bolag med egen användare och eget avtal, byggt med grannens token. */
async function grannavtal() {
  const granne = await registerUser('rutinstatus-granne');
  const gAuth = { Authorization: `Bearer ${granne.token}` };
  const bolag = await createCompany(granne.token, 'Grannbolaget AB');
  await createFiscalYear(bolag, gAuth, { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });
  const gAct = async (namn: string, kropp: Record<string, unknown>) => {
    const res = await api.post(`/api/companies/${bolag}/actions/${namn}`).set(gAuth).send(kropp);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body.result as Record<string, unknown>;
  };
  const projectId = (await gAct('create_project', { name: 'Grannens uppdrag' })).id as string;
  const contractId = (await gAct('skapa_uppdrag', { project_id: projectId, name: 'Grannens uppdrag', signed_date: '2026-09-03' })).contract_id as string;
  await importeraOchGodkann(bolag, gAuth, { contract_id: contractId, kontraktstext: LEVERANSKONTRAKT_NVR001 });
  await gAct('paborja_leverabel', { contract_id: contractId, leverabel_kod: 'L1' });
  const lage = () => withAdmin(async (c) => ({
    handelser: (await c.query('SELECT * FROM uppdrag_leverabel_handelse WHERE company_id=$1 AND contract_id=$2 ORDER BY id', [bolag, contractId])).rows,
    referenser: (await c.query('SELECT * FROM uppdrag_referens WHERE company_id=$1 AND contract_id=$2 ORDER BY id', [bolag, contractId])).rows,
    cache: (await c.query('SELECT nyckel, varde FROM uppdrag_svepvarde WHERE company_id=$1 AND contract_id=$2 ORDER BY nyckel', [bolag, contractId])).rows,
  }));
  return { bolag, contractId, lage };
}
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

const NVR = { godkannare: 'Styrgruppen', godkannare_eskalering: 'Eva Larsson (VD)' };
const KEDJA = ['L1', 'STEG1', 'ROT'];
const LAGEN = ['ej_paborjad', 'pagar', 'levererad', 'godkand', 'avvisad'] as const;
const regelbas = { status: 'pagar', oppna_signaler: 0, larmkoder: [] as string[], leverabelkedja: KEDJA, parter: NVR };
const transmittal = (over: Partial<Rutinindata> = {}): Rutinindata => ({ ...regelbas, typ: 'transmittal', ...over });
const godkannande = (godkand_av: string, over: Partial<Rutinindata> = {}): Rutinindata =>
  ({ ...regelbas, status: 'levererad', typ: 'godkannande', godkand_av, ...over });
function djupfryst<T>(v: T): T {
  if (v && typeof v === 'object') {
    for (const x of Object.values(v)) djupfryst(x);
    Object.freeze(v);
  }
  return v;
}

describe('Story 14.1: rutinregeln (ren)', () => {
  it('14.1-R1: fyra steg, två källhändelser, och ingen källhändelse når påbörjandet eller returen', () => {
    expect(OVERGANGAR).toEqual([
      { fran: 'ej_paborjad', till: 'pagar', kallhandelse: null, manniskovag: 'paborja_leverabel' },
      { fran: 'pagar', till: 'levererad', kallhandelse: 'transmittal', manniskovag: 'bekrafta_statusbyte' },
      { fran: 'levererad', till: 'godkand', kallhandelse: 'godkannande', manniskovag: 'godkann_leverabel' },
      { fran: 'pagar', till: 'avvisad', kallhandelse: null, manniskovag: 'bekrafta_statusbyte' },
    ]);
    expect([...KALLHANDELSETYPER]).toEqual(['transmittal', 'godkannande']);
    for (const typ of KALLHANDELSETYPER) expect(OVERGANGAR.filter((s) => s.kallhandelse === typ)).toHaveLength(1);
    const medgivna = new Set<string>();
    for (const status of LAGEN) {
      for (const indata of [transmittal({ status }), godkannande('Styrgruppen', { status })]) {
        const u = provaRutinhandelse(indata);
        if (u.medges) medgivna.add(`${u.fran}->${u.till}`);
      }
    }
    expect(medgivna.size).toBeGreaterThan(0);
    for (const par of medgivna) expect(['pagar->levererad', 'levererad->godkand']).toContain(par);
  });
  it('14.1-R2: transmittalen medges från pågår till levererad med avtalets godkännare som mottagare', () => {
    expect(provaRutinhandelse(transmittal())).toEqual({ medges: true, fran: 'pagar', till: 'levererad', mottagare: 'Styrgruppen' });
  });
  it('14.1-R3: bara avtalets godkännare eller eskalering, exakt efter normalisering', () => {
    expect(provaRutinhandelse(godkannande('Styrgruppen'))).toEqual({ medges: true, fran: 'levererad', till: 'godkand', mottagare: 'Styrgruppen' });
    expect(provaRutinhandelse(godkannande('  eva   larsson (vd) '))).toEqual({ medges: true, fran: 'levererad', till: 'godkand', mottagare: 'Styrgruppen' });
    for (const avsandare of ['Eva Larsson', 'Hermes']) {
      expect(provaRutinhandelse(godkannande(avsandare))).toEqual({ medges: false, skal: ['obehorig_godkannare'] });
    }
    expect(provaRutinhandelse(godkannande('Styrgruppen', { parter: { godkannare: null, godkannare_eskalering: null } })))
      .toEqual({ medges: false, skal: ['saknad_mottagare', 'obehorig_godkannare'] });
  });
  it('14.1-R4: en öppen scopesignal fäller båda typerna', () => {
    expect(provaRutinhandelse(transmittal({ oppna_signaler: 1 }))).toEqual({ medges: false, skal: ['signal_tand'] });
    expect(provaRutinhandelse(godkannande('Styrgruppen', { oppna_signaler: 1 }))).toEqual({ medges: false, skal: ['signal_tand'] });
  });
  it('14.1-R5: indikatorn för leverabeln eller en nivå över den fäller, ett syskons gör det inte, oläst fäller', () => {
    for (const kod of KEDJA) {
      expect(provaRutinhandelse(transmittal({ larmkoder: [kod] }))).toEqual({ medges: false, skal: ['indikator_tand'] });
    }
    expect(provaRutinhandelse(transmittal({ larmkoder: ['L2'] })).medges).toBe(true);
    expect(provaRutinhandelse(transmittal({ larmkoder: null }))).toEqual({ medges: false, skal: ['indikator_olast'] });
  });
  it('14.1-R6: en källhändelse i fel läge fälls', () => {
    for (const status of ['ej_paborjad', 'levererad', 'godkand', 'avvisad']) {
      expect(provaRutinhandelse(transmittal({ status }))).toEqual({ medges: false, skal: ['fel_utgangslage'] });
    }
    for (const status of ['ej_paborjad', 'pagar', 'godkand', 'avvisad']) {
      expect(provaRutinhandelse(godkannande('Styrgruppen', { status }))).toEqual({ medges: false, skal: ['fel_utgangslage'] });
    }
  });
  it('14.1-R7: utan avtalets godkännare fälls båda typerna, också från eskaleringen', () => {
    const parter = { godkannare: null, godkannare_eskalering: 'Eva Larsson (VD)' };
    expect(provaRutinhandelse(transmittal({ parter }))).toEqual({ medges: false, skal: ['saknad_mottagare'] });
    expect(provaRutinhandelse(godkannande('Eva Larsson (VD)', { parter }))).toEqual({ medges: false, skal: ['saknad_mottagare'] });
  });
  it('14.1-R8: alla skäl i ordning, varje skäl har text, och indata muteras aldrig', () => {
    expect(provaRutinhandelse(transmittal({ status: 'ej_paborjad', oppna_signaler: 2, larmkoder: null })))
      .toEqual({ medges: false, skal: ['fel_utgangslage', 'signal_tand', 'indikator_olast'] });
    expect(new Set(Object.keys(RUTINSKALTEXT))).toEqual(new Set(RUTINSKAL));
    const fryst = djupfryst(godkannande('Eva Larsson (VD)', { larmkoder: ['L2'] }));
    const forsta = provaRutinhandelse(fryst);
    expect(provaRutinhandelse(fryst)).toEqual(forsta);
    expect(forsta.medges).toBe(true);
  });
});

describe('Story 14.1: migrationen', () => {
  const VILLKOR = ['uppdrag_leverabel_handelse_registrerad_av_check', 'uppdrag_leverabel_handelse_kallhandelse_typ_check',
    'uppdrag_leverabel_handelse_kallhandelse_aktor_check', 'uppdrag_leverabel_handelse_registrering_check'];
  const INDEX = 'uppdrag_leverabel_handelse_kallhandelse_uk';
  let a: Avtal;
  let referensId: string;
  // En rad direkt som ägarrollen, förbi tjänsten: villkoret ska gälla också där.
  async function rigga(kod: string, rad: Record<string, unknown>) {
    const kolumner = Object.keys(rad);
    return withAdmin((c) => c.query(`INSERT INTO uppdrag_leverabel_handelse
      (company_id, contract_id, leverabel_id, fran, till${kolumner.map((k) => `, ${k}`).join('')})
      SELECT company_id, contract_id, id, 'pagar', 'levererad'${kolumner.map((_, i) => `, $${i + 4}`).join('')}
        FROM uppdrag_leverabel WHERE company_id=$1 AND contract_id=$2 AND kod=$3`,
    [companyId, a.contractId, kod, ...Object.values(rad)]));
  }
  beforeAll(async () => {
    a = await nyttAvtal('14.1 M');
    for (const kod of ['L1', 'L2']) await paborja(a, kod);
    referensId = (await withTenantTransaction(user.userId, companyId, (c) => skapaReferens(c, companyId, {
      contract_id: a.contractId, sort: 'mejl', extern_id: 'm-rutinstatus@nvr.se', extern_nyckel: 'rfc822#message-id', extern_kalla: 'gmail:locollabs',
    }))).id;
  });
  it('14.1-M1: fyra kolumner, fyra villkor och ett unikt index, idempotent, och referensens kommentar följer', async () => {
    const migration = (await loadMigrations()).find((m) => m.name === 'rutinstatus');
    expect(migration).toBeDefined();
    await withAdmin(async (c) => {
      await c.query(migration!.sql); await c.query(migration!.sql);
      const kol = await c.query(`SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns
        WHERE table_name='uppdrag_leverabel_handelse' AND column_name = ANY($1::text[]) ORDER BY column_name`,
      [['registrerad_av', 'kallhandelse_typ', 'kallhandelse_ref', 'kallhandelse_aktor']]);
      expect(kol.rows.map((r) => [r.column_name, r.data_type, r.is_nullable])).toEqual([
        ['kallhandelse_aktor', 'text', 'YES'], ['kallhandelse_ref', 'text', 'YES'], ['kallhandelse_typ', 'text', 'YES'],
        ['registrerad_av', 'text', 'NO'],
      ]);
      expect(kol.rows.find((r) => r.column_name === 'registrerad_av')!.column_default).toContain('manniska');
      const villkor = await c.query('SELECT conname FROM pg_constraint WHERE conname = ANY($1::text[]) ORDER BY conname', [VILLKOR]);
      expect(villkor.rows.map((r) => r.conname)).toEqual([...VILLKOR].sort());
      const index = await c.query('SELECT indexdef FROM pg_indexes WHERE indexname=$1', [INDEX]);
      expect(index.rows).toHaveLength(1);
      expect(index.rows[0].indexdef).toContain('UNIQUE');
      expect(index.rows[0].indexdef).toContain('leverabel_id, kallhandelse_typ, kallhandelse_ref');
      const kommentar = await c.query(`SELECT col_description(attrelid, attnum) AS text FROM pg_attribute
        WHERE attrelid='uppdrag_leverabel_handelse'::regclass AND attname='referens_id'`);
      expect(kommentar.rows[0].text.startsWith('Handlingen som överlämningen eller returen registrerades ur, som rad i uppdrag_referens.')).toBe(true);
      expect(kommentar.rows[0].text).toContain('källhändelse');
    });
  });
  it('14.1-M2: elva otillåtna radformer fälls av villkoren, tre tillåtna går igenom', async () => {
    const fore = (await handelser(a)).filter((h) => h.kod === 'L1');
    expect(fore).toHaveLength(1);
    const kallhandelse = (ref: string) => ({ kallhandelse_typ: 'transmittal', kallhandelse_ref: ref, referens_id: referensId });
    const otillatna: Record<string, Record<string, unknown>> = {
      a: { registrerad_av: 'manniska' },
      b: { registrerad_av: 'system', bekraftat_av: 'riggning', ...kallhandelse('mejl:m2-b@nvr.se') },
      c: { registrerad_av: 'system', kallhandelse_ref: 'mejl:m2-c@nvr.se', referens_id: referensId },
      d: { registrerad_av: 'system', kallhandelse_typ: 'transmittal', referens_id: referensId },
      e: { registrerad_av: 'system', kallhandelse_typ: 'transmittal', kallhandelse_ref: 'mejl:m2-e@nvr.se' },
      f: { registrerad_av: 'manniska', bekraftat_av: 'riggning', kallhandelse_typ: 'transmittal', referens_id: referensId },
      g: { registrerad_av: 'manniska', bekraftat_av: 'riggning', kallhandelse_typ: 'transmittal', kallhandelse_ref: 'mejl:m2-g@nvr.se' },
      h: { registrerad_av: 'agent', bekraftat_av: 'riggning' },
      i: { registrerad_av: 'system', ...kallhandelse('mejl:m2-i@nvr.se'), kallhandelse_typ: 'retur' },
      j: { registrerad_av: 'system', ...kallhandelse('mejl:m2-j@nvr.se'), kallhandelse_typ: 'godkannande' },
      k: { registrerad_av: 'system', ...kallhandelse('mejl:m2-k@nvr.se'), kallhandelse_aktor: 'Styrgruppen' },
    };
    for (const [form, rad] of Object.entries(otillatna)) {
      await expect(rigga('L1', rad), `form (${form})`).rejects.toMatchObject({ code: '23514' });
    }
    expect((await handelser(a)).filter((h) => h.kod === 'L1')).toEqual(fore);
    await rigga('L1', { registrerad_av: 'manniska', bekraftat_av: 'riggning' });
    await rigga('L1', { registrerad_av: 'manniska', bekraftat_av: 'riggning', ...kallhandelse('mejl:m2-ja@nvr.se') });
    await rigga('L1', { registrerad_av: 'system', ...kallhandelse('mejl:m2-system@nvr.se'),
      kallhandelse_typ: 'godkannande', kallhandelse_aktor: 'Eva Larsson (VD)' });
    const efter = (await handelser(a)).filter((h) => h.kod === 'L1');
    expect(efter).toHaveLength(4);
    expect(efter.slice(1).map((h) => [h.registrerad_av, h.kallhandelse_ref])).toEqual([
      ['manniska', null], ['manniska', 'mejl:m2-ja@nvr.se'], ['system', 'mejl:m2-system@nvr.se'],
    ]);
  });
  it('14.1-M3: samma källhändelse på samma leverabel fälls av det unika indexet', async () => {
    const rad = { registrerad_av: 'system', kallhandelse_typ: 'transmittal', kallhandelse_ref: 'mejl:m3-dubbel@nvr.se', referens_id: referensId };
    await rigga('L1', rad);
    await expect(rigga('L1', rad)).rejects.toMatchObject({ code: '23505' });
    await rigga('L2', rad);
    expect((await handelser(a)).filter((h) => h.kallhandelse_ref === 'mejl:m3-dubbel@nvr.se').map((h) => h.kod)).toEqual(['L1', 'L2']);
  });
});

describe('Story 14.1: rutinvägen', () => {
  async function avtal(namn: string) {
    const a = await nyttAvtal(namn);
    await friskIndikator(a);
    return a;
  }
  it('14.1-A1: transmittalen registreras utan fråga, med handlingen som referens och utan mänsklig signatur', async () => {
    const a = await avtal('14.1 A1'); await paborja(a, 'L1');
    const antal = () => withAdmin(async (c) => (await c.query(`SELECT
      (SELECT count(*)::int FROM action_approvals WHERE company_id=$1) AS approvals,
      (SELECT count(*)::int FROM uppdrag_beslut WHERE company_id=$1 AND contract_id=$2) AS beslut`, [companyId, a.contractId])).rows[0]);
    const fore = await antal(); const poster = await undantag();
    const refsFore = new Set((await referenser(a)).map((r) => r.id));
    const r = await rutinOk(a, 'L1', TRANSMITTAL('L1'));
    expect(r).toMatchObject({ utfall: 'registrerad', status: 'levererad', revision: 1, mottagare: 'Styrgruppen',
      kallhandelse_ref: 'mejl:overlamning-L1@nvr.se', referens_id: expect.any(String) });
    const h = (await handelser(a)).find((x) => x.id === r.handelse_id)!;
    expect(h).toMatchObject({ registrerad_av: 'system', bekraftat_av: null, kallhandelse_typ: 'transmittal',
      kallhandelse_ref: 'mejl:overlamning-L1@nvr.se', referens_id: r.referens_id, dag: '2026-09-12',
      kanal: null, notering: null, kallhandelse_aktor: null, fran: 'pagar', till: 'levererad' });
    const nya = (await referenser(a)).filter((x) => !refsFore.has(x.id));
    expect(nya.find((x) => x.id === r.referens_id)).toMatchObject({ sort: 'mejl', extern_nyckel: 'rfc822#message-id', extern_kalla: 'gmail:locollabs' });
    expect(nya).toContainEqual(expect.objectContaining({ extern_nyckel: 'registerkopia', ko_status: 'koad' }));
    expect(await antal()).toEqual(fore);
    expect(await undantag()).toEqual(poster);
    expect(await godkannanden()).toEqual([]);
    expect((await audit()).find((x) => x.action === 'action.executed' && x.entity_id === 'registrera_rutinstatus'))
      .toMatchObject({ details: expect.objectContaining({ actor: 'agent' }) });
    expect((await register(a)).find((x) => x.kod === 'L1')).toMatchObject({ status: 'levererad', revision: 1, mottagare: 'Styrgruppen' });
    // Append-only: rutinraden går inte att skriva om, inte heller av systemet självt.
    await expect(withTenantTransaction(user.userId, companyId, (c) => c.query(
      "UPDATE uppdrag_leverabel_handelse SET bekraftat_av = 'någon' WHERE id = $1", [h.id]))).rejects.toThrow(/permission denied/);
    await expect(withTenantTransaction(user.userId, companyId, (c) => c.query(
      'DELETE FROM uppdrag_leverabel_handelse WHERE id = $1', [h.id]))).rejects.toThrow(/permission denied/);
    expect((await handelser(a)).find((x) => x.id === h.id)).toEqual(h);
  });
  it('14.1-A2: godkännandet från avtalets eskalering registreras, med avsändaren som källans aktör', async () => {
    const a = await avtal('14.1 A2'); await paborja(a, 'L2'); await overlamna(a, 'L2');
    const r = await rutinOk(a, 'L2', GODKANNANDE('L2', 'Eva Larsson (VD)'));
    expect(r).toMatchObject({ utfall: 'registrerad', status: 'godkand', revision: null, mottagare: 'Styrgruppen',
      kallhandelse_aktor: 'Eva Larsson (VD)', registrerad_av: 'system', kallhandelse_typ: 'godkannande' });
    const alla = await handelser(a);
    expect(alla.find((x) => x.id === r.handelse_id)).toMatchObject({ registrerad_av: 'system', bekraftat_av: null,
      mottagare: 'Styrgruppen', kallhandelse_aktor: 'Eva Larsson (VD)', kanal: 'mejl', dag: '2026-09-15',
      referens_id: expect.any(String), fran: 'levererad', till: 'godkand' });
    expect(alla.find((x) => x.kod === 'L2' && x.till === 'levererad')).toMatchObject({ registrerad_av: 'manniska', bekraftat_av: user.userId });
    expect((await register(a)).find((x) => x.kod === 'L2')).toMatchObject({ status: 'godkand', revision: 1, mottagare: 'Styrgruppen' });
  });
  it('14.1-A3: åtgärden tar aldrig emot ett läge och fäller fel form med 400', async () => {
    const a = await avtal('14.1 A3'); await paborja(a, 'L1');
    const fore = await handelser(a); const refs = await referenser(a);
    const t = TRANSMITTAL('L1');
    for (const kropp of [
      {},
      { ...indata(a, 'L1'), kallhandelse: t, till: 'levererad' },
      { ...indata(a, 'L1'), kallhandelse: t, status: 'godkand' },
      { ...indata(a, 'L1'), kallhandelse: { ...t, typ: 'paborjande' } },
      { ...indata(a, 'L1'), kallhandelse: { ...t, typ: 'retur' } },
      { ...indata(a, 'L1'), kallhandelse: { ...t, handling: { ...t.handling, extern_id: 'https://mail.google.com/x' } } },
    ]) {
      const res = await agent('registrera_rutinstatus', kropp);
      expect(res.status, JSON.stringify(res.body)).toBe(400);
      expect(res.body.error).toBe('validation_error');
    }
    expect(await handelser(a)).toEqual(fore);
    expect(await statusar(a)).toContainEqual({ kod: 'L1', status: 'pagar' });
    expect(await referenser(a)).toEqual(refs);
  });
  it('14.1-A4: samma källhändelse igen registreras inte en andra gång', async () => {
    const a = await avtal('14.1 A4'); await paborja(a, 'L1');
    const r = await rutinOk(a, 'L1', TRANSMITTAL('L1'));
    const refs = (await referenser(a)).length;
    expect(await rutinOk(a, 'L1', TRANSMITTAL('L1'))).toEqual({ utfall: 'redan_registrerad', handelse_id: r.handelse_id, leverabel_kod: 'L1', status: 'levererad' });
    expect((await handelser(a)).filter((h) => h.kallhandelse_ref === 'mejl:overlamning-L1@nvr.se')).toHaveLength(1);
    expect(await referenser(a)).toHaveLength(refs);
    await paborja(a, 'L2'); await overlamna(a, 'L2');
    const g = await rutinOk(a, 'L2', GODKANNANDE('L2', 'Eva Larsson (VD)'));
    const refsG = (await referenser(a)).length;
    expect(await rutinOk(a, 'L2', GODKANNANDE('L2', 'Eva Larsson (VD)'))).toEqual({ utfall: 'redan_registrerad', handelse_id: g.handelse_id, leverabel_kod: 'L2', status: 'godkand' });
    expect((await handelser(a)).filter((h) => h.kallhandelse_ref === 'mejl:godkant-L2@nvr.se')).toHaveLength(1);
    expect(await referenser(a)).toHaveLength(refsG);
  });
  it('14.1-A5: datumfönstret är människovägens', async () => {
    const a = await avtal('14.1 A5'); await paborja(a, 'L1');
    const fore = await handelser(a); const refs = await referenser(a);
    for (const [handelse_datum, error] of [['2099-01-01', 'framtida_datum'], ['2026-09-01', 'fore_avtalet']] as const) {
      const res = await rutin(a, 'L1', { ...TRANSMITTAL('L1'), handelse_datum });
      expect(res.status, JSON.stringify(res.body)).toBe(400);
      expect(res.body.error).toBe(error);
    }
    expect(await handelser(a)).toEqual(fore);
    expect(await referenser(a)).toEqual(refs);
  });
  it('14.1-A6: grannbolagets avtal och en okänd leverabel svarar 404 utan skrivning', async () => {
    const g = await grannavtal();
    const a = await avtal('14.1 A6'); await paborja(a, 'L1');
    const fore = await g.lage(); const egna = await handelser(a); const egnaRefs = await referenser(a);
    const grannen = await agent('registrera_rutinstatus', { contract_id: g.contractId, leverabel_kod: 'L1', kallhandelse: TRANSMITTAL('L1') });
    expect(grannen.status, JSON.stringify(grannen.body)).toBe(404);
    const okand = await rutin(a, 'L99', TRANSMITTAL('L99'));
    expect(okand.status, JSON.stringify(okand.body)).toBe(404);
    expect(await g.lage()).toEqual(fore);
    expect(await handelser(a)).toEqual(egna);
    expect(await referenser(a)).toEqual(egnaRefs);
    // Positiv kontroll: samma anrop mot det egna avtalets leverabel registreras.
    expect(await rutinOk(a, 'L1', TRANSMITTAL('L1'))).toMatchObject({ utfall: 'registrerad' });
    expect(await g.lage()).toEqual(fore);
  });
  it('14.1-A7: de tre spärrarna står kvar, och rutinvägen är en write utan människospärr', async () => {
    const a = await avtal('14.1 A7'); await paborja(a, 'L1'); await paborja(a, 'L2');
    for (const namn of ['paborja_leverabel', 'bekrafta_statusbyte', 'godkann_leverabel']) {
      expect(getAction(namn)).toMatchObject({ kravManniska: true, sensitivity: 'write' });
    }
    const fore = await handelser(a);
    const sparrad = await agent('bekrafta_statusbyte', { ...indata(a, 'L1'), utfall: 'bekraftad', handling: TRANSMITTAL('L1').handling });
    expect(sparrad.status, JSON.stringify(sparrad.body)).toBe(403);
    expect(sparrad.body.error).toBe('human_required');
    expect(await handelser(a)).toEqual(fore);
    const rutinvag = getAction('registrera_rutinstatus');
    expect(rutinvag).toBeDefined();
    expect(rutinvag!.sensitivity).toBe('write');
    expect(rutinvag!.kravManniska ?? false).toBe(false);
    expect(rutinvag!.koasForAgent ?? false).toBe(false);
    expect((rutinvag!.description ?? '').trim()).not.toBe('');
    const r = await overlamna(a, 'L2');
    expect((await handelser(a)).find((x) => x.id === r.handelse_id)).toMatchObject({
      registrerad_av: 'manniska', bekraftat_av: user.userId, kallhandelse_typ: null, kallhandelse_ref: null });
  });
});

describe('Story 14.1: det fällda blir ett förslag', () => {
  async function avtal(namn: string) {
    const a = await nyttAvtal(namn);
    await friskIndikator(a);
    return a;
  }
  it('14.1-F1: en tänd signal fäller transmittalen till ett förslag utan skrivning, tills signalen avgjorts', async () => {
    const a = await avtal('14.1 F1'); await paborja(a, 'L1');
    const signal = await ok<{ id: string }>('tand_scopesignal', { contract_id: a.contractId, fras: 'kan ni även ta' });
    const fore = { statusar: await statusar(a), handelser: await handelser(a), referenser: await referenser(a), poster: await undantag() };
    const res = await rutin(a, 'L1', TRANSMITTAL('L1'));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const regeln = provaRutinhandelse({ typ: 'transmittal', status: 'pagar', oppna_signaler: 1, larmkoder: [],
      leverabelkedja: ['L1', 'S1', 'UPPDRAG'], parter: { godkannare: PARTER.godkannare, godkannare_eskalering: PARTER.godkannare_eskalering } });
    if (regeln.medges) throw new Error('regeln ska fälla transmittalen med en tänd signal');
    expect(regeln.skal).toEqual(['signal_tand']);
    expect(res.body.result).toEqual({ utfall: 'falld', leverabel_kod: 'L1', status: 'pagar', skal: regeln.skal });
    expect(res.body.result).not.toHaveProperty('forslag_atgard');
    expect({ statusar: await statusar(a), handelser: await handelser(a), referenser: await referenser(a), poster: await undantag() }).toEqual(fore);
    expect(await godkannanden()).toEqual([]);
    expect(await forslag(a)).toEqual([{ leverabel_kod: 'L1', skal: ['signal_tand'], kallhandelse: { typ: 'transmittal',
      handling: { sort: 'mejl', extern_id: 'overlamning-L1@nvr.se', extern_kalla: 'gmail:locollabs' }, handelse_datum: '2026-09-12' } }]);
    await ok('avgor_scopesignal', { signal_id: signal.id, avgjord: 'innanfor' });
    expect((await rutinOk(a, 'L1', TRANSMITTAL('L1'))).utfall).toBe('registrerad');
    expect(await forslag(a)).toEqual([]);
    expect((await svepcache(a.contractId)).map((r) => r.nyckel)).not.toContain(RUTINFORSLAGSNYCKEL);
  });
  it('14.1-F2: indikatorn för leverabeln eller en nivå över den fäller, ett syskons gör det inte, oläst fäller', async () => {
    const [a, b, c, d] = [await avtal('14.1 F2 a'), await avtal('14.1 F2 b'), await nyttAvtal('14.1 F2 c'), await avtal('14.1 F2 d')];
    for (const x of [a, b, c, d]) await paborja(x, 'L1');
    await tandIndikator(a, 'L1');
    expect(await rutinOk(a, 'L1', TRANSMITTAL('L1'))).toMatchObject({ utfall: 'falld', skal: ['indikator_tand'] });
    await tandIndikator(b, 'L2');
    expect(await rutinOk(b, 'L1', TRANSMITTAL('L1'))).toMatchObject({ utfall: 'registrerad', status: 'levererad' });
    expect((await svepcache(c.contractId)).map((r) => r.nyckel)).not.toContain('troskellarm');
    expect(await rutinOk(c, 'L1', TRANSMITTAL('L1'))).toMatchObject({ utfall: 'falld', skal: ['indikator_olast'] });
    const nivan = await foralder(d, 'L1');
    expect(nivan).not.toBe(''); expect(nivan).not.toBe('L1');
    await tandIndikator(d, nivan);
    expect(await rutinOk(d, 'L1', TRANSMITTAL('L1'))).toMatchObject({ utfall: 'falld', skal: ['indikator_tand'] });
    await tandIndikator(d, 'UPPDRAG');
    expect(await rutinOk(d, 'L1', TRANSMITTAL('L1'))).toMatchObject({ utfall: 'falld', skal: ['indikator_tand'] });
    expect(await statusar(d)).toContainEqual({ kod: 'L1', status: 'pagar' });
  });
  it('14.1-F3: en avsändare utanför avtalets parter blir ett förslag; avtalets godkännare registreras', async () => {
    const a = await avtal('14.1 F3'); await paborja(a, 'L1'); await overlamna(a, 'L1');
    expect(await rutinOk(a, 'L1', GODKANNANDE('L1', 'Hermes'))).toMatchObject({ utfall: 'falld', skal: ['obehorig_godkannare'] });
    expect(await statusar(a)).toContainEqual({ kod: 'L1', status: 'levererad' });
    expect((await handelser(a)).filter((h) => h.till === 'godkand')).toEqual([]);
    expect(await forslag(a)).toEqual([expect.objectContaining({ leverabel_kod: 'L1',
      kallhandelse: expect.objectContaining({ typ: 'godkannande', godkand_av: 'Hermes', kanal: 'mejl' }) })]);
    expect(await rutinOk(a, 'L1', GODKANNANDE('L1', 'Styrgruppen'))).toMatchObject({ utfall: 'registrerad', status: 'godkand' });
    expect(await forslag(a)).toEqual([]);
  });
  it('14.1-F4: förslaget överlever svepet och står i ett eget omfång', async () => {
    const a = await avtal('14.1 F4'); await paborja(a, 'L1');
    await ok('tand_scopesignal', { contract_id: a.contractId, fras: 'kan ni även ta' });
    expect(await rutinOk(a, 'L1', TRANSMITTAL('L1'))).toMatchObject({ utfall: 'falld' });
    const fore = (await svepcache(a.contractId)).find((r) => r.nyckel === RUTINFORSLAGSNYCKEL);
    expect(fore).toBeDefined();
    await withTenantTransaction(user.userId, companyId, (c) => upsertSvepvarden(c, companyId, a.contractId, [{ nyckel: 'prognos', varde: {} }]));
    expect((await svepcache(a.contractId)).find((r) => r.nyckel === RUTINFORSLAGSNYCKEL)).toEqual(fore);
    for (const [omfang, nyckel] of [['svep', RUTINFORSLAGSNYCKEL], ['rutinforslag', 'prognos']] as const) {
      await expect(withTenantTransaction(user.userId, companyId, (c) => upsertSvepvarden(c, companyId, a.contractId,
        [{ nyckel, varde: {} }], omfang)), `${omfang}/${nyckel}`).rejects.toBeInstanceOf(Error);
    }
    expect((await svepcache(a.contractId)).find((r) => r.nyckel === RUTINFORSLAGSNYCKEL)).toEqual(fore);
  });
  it('14.1-F5: påbörjandet tas aldrig av rutinvägen', async () => {
    const a = await avtal('14.1 F5');
    expect(await statusar(a)).toContainEqual({ kod: 'L3', status: 'ej_paborjad' });
    expect(await rutinOk(a, 'L3', TRANSMITTAL('L3'))).toMatchObject({ utfall: 'falld', skal: ['fel_utgangslage'] });
    expect(await statusar(a)).toContainEqual({ kod: 'L3', status: 'ej_paborjad' });
    expect((await handelser(a)).filter((h) => h.kod === 'L3')).toEqual([]);
  });
});

describe('Story 14.1: Davids ja på förslaget', () => {
  async function avtal(namn: string, parter: typeof PARTER | null = PARTER) {
    const a = await nyttAvtal(namn, parter);
    await friskIndikator(a);
    return a;
  }
  const lage = async (a: Avtal) => ({ statusar: await statusar(a), handelser: await handelser(a), referenser: await referenser(a), forslag: await forslag(a) });
  it('14.1-J1: agentens ja fälls, Davids ja registrerar källhändelsen ur förslaget med hans namn och källan kvar', async () => {
    const a = await avtal('14.1 J1'); await paborja(a, 'L1');
    const signal = await ok<{ id: string }>('tand_scopesignal', { contract_id: a.contractId, fras: 'kan ni även ta' });
    expect(await rutinOk(a, 'L1', TRANSMITTAL('L1'))).toMatchObject({ utfall: 'falld' });
    const fore = await lage(a);
    expect(fore.forslag).toHaveLength(1);
    const agentens = await agentJa(a, 'L1', 'transmittal');
    expect(agentens.status, JSON.stringify(agentens.body)).toBe(403);
    expect(agentens.body.error).toBe('human_required');
    expect(await lage(a)).toEqual(fore);
    const res = await ja(a, 'L1', 'transmittal');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const r = res.body.result;
    expect(r).toMatchObject({ utfall: 'registrerad', status: 'levererad', revision: 1, mottagare: 'Styrgruppen', registrerad_av: 'manniska',
      kallhandelse_typ: 'transmittal', kallhandelse_ref: 'mejl:overlamning-L1@nvr.se', referens_id: expect.any(String) });
    const h = (await handelser(a)).find((x) => x.id === r.handelse_id)!;
    expect(h).toMatchObject({ registrerad_av: 'manniska', bekraftat_av: user.userId, dag: '2026-09-12',
      kallhandelse_ref: 'mejl:overlamning-L1@nvr.se', kallhandelse_aktor: null, referens_id: r.referens_id });
    expect((await referenser(a)).find((x) => x.id === r.referens_id)).toMatchObject({ extern_id: 'overlamning-L1@nvr.se', extern_kalla: 'gmail:locollabs' });
    expect(await forslag(a)).toEqual([]);
    expect((await svepcache(a.contractId)).map((x) => x.nyckel)).not.toContain(RUTINFORSLAGSNYCKEL);
    expect(await undantag()).toContain(`signal:${signal.id}`);
    expect((await audit()).find((x) => x.action === 'action.executed' && x.entity_id === 'bekrafta_rutinforslag'))
      .toMatchObject({ details: expect.objectContaining({ actor: 'human' }) });
    expect(await rutinOk(a, 'L1', TRANSMITTAL('L1'))).toMatchObject({ utfall: 'redan_registrerad', handelse_id: r.handelse_id });
    expect((await handelser(a)).filter((x) => x.kallhandelse_ref === 'mejl:overlamning-L1@nvr.se')).toHaveLength(1);
  });
  it('14.1-J2: Davids ja på ett godkännande från en annan avsändare bevarar avsändaren som källans aktör', async () => {
    const a = await avtal('14.1 J2'); await paborja(a, 'L2'); await overlamna(a, 'L2');
    expect(await rutinOk(a, 'L2', GODKANNANDE('L2', 'Eva Larsson'))).toMatchObject({ utfall: 'falld', skal: ['obehorig_godkannare'] });
    const res = await ja(a, 'L2', 'godkannande');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.result).toMatchObject({ utfall: 'registrerad', status: 'godkand', revision: null, mottagare: 'Styrgruppen', kallhandelse_aktor: 'Eva Larsson' });
    const h = (await handelser(a)).find((x) => x.id === res.body.result.handelse_id)!;
    expect(h).toMatchObject({ registrerad_av: 'manniska', bekraftat_av: user.userId, kanal: 'mejl', dag: '2026-09-15',
      kallhandelse_typ: 'godkannande', mottagare: 'Styrgruppen', kallhandelse_aktor: 'Eva Larsson', referens_id: expect.any(String) });
    expect((await referenser(a)).find((x) => x.id === h.referens_id)).toMatchObject({ extern_id: 'godkant-L2@nvr.se' });
    expect((await register(a)).find((x) => x.kod === 'L2')).toMatchObject({ status: 'godkand' });
    expect(await godkannanden()).toEqual([]);
  });
  it('14.1-J3: ett ja som inte går att utföra skriver ingenting', async () => {
    const a = await avtal('14.1 J3'); await paborja(a, 'L1');
    await ok('tand_scopesignal', { contract_id: a.contractId, fras: 'kan ni även ta' });
    expect(await rutinOk(a, 'L1', TRANSMITTAL('L1'))).toMatchObject({ utfall: 'falld' });
    async function fallsUtanSkrivning(x: Avtal, anrop: () => Promise<{ status: number; body: { error?: string } }>, status: number, error?: string) {
      const fore = await lage(x);
      const res = await anrop();
      expect(res.status, JSON.stringify(res.body)).toBe(status);
      if (error) expect(res.body.error).toBe(error);
      expect(await lage(x)).toEqual(fore);
    }
    for (const kropp of [{}, { ...indata(a, 'L1'), typ: 'retur' },
      { ...indata(a, 'L1'), typ: 'transmittal', handling: TRANSMITTAL('L1').handling },
      { ...indata(a, 'L1'), typ: 'transmittal', godkand_av: 'Styrgruppen' }]) {
      await fallsUtanSkrivning(a, () => act('bekrafta_rutinforslag', kropp), 400, 'validation_error');
    }
    await fallsUtanSkrivning(a, () => ja(a, 'L3', 'transmittal'), 404);
    await ok('bekrafta_statusbyte', { ...indata(a, 'L1'), utfall: 'retur' });
    await fallsUtanSkrivning(a, () => ja(a, 'L1', 'transmittal'), 409, 'fel_utgangslage');
    expect(await forslag(a)).toEqual([expect.objectContaining({ leverabel_kod: 'L1' })]);
    const utan = await avtal('14.1 J3 utan parter', null); await paborja(utan, 'L1');
    expect(await rutinOk(utan, 'L1', TRANSMITTAL('L1'))).toMatchObject({ utfall: 'falld', skal: ['saknad_mottagare'] });
    await fallsUtanSkrivning(utan, () => ja(utan, 'L1', 'transmittal'), 409, 'saknad_mottagare');
    const g = await grannavtal();
    const grannFore = await g.lage();
    const grannen = await act('bekrafta_rutinforslag', { contract_id: g.contractId, leverabel_kod: 'L1', typ: 'transmittal' });
    expect(grannen.status, JSON.stringify(grannen.body)).toBe(404);
    expect(await g.lage()).toEqual(grannFore);
  });
  it('14.1-J4: Davids ja är en människospärrad write med exakt tre fält, och de tre spärrarna står kvar', () => {
    const jaet = getAction('bekrafta_rutinforslag');
    expect(jaet).toBeDefined();
    expect(jaet!.sensitivity).toBe('write');
    expect(jaet!.kravManniska).toBe(true);
    expect(jaet!.koasForAgent ?? false).toBe(false);
    expect((jaet!.description ?? '').trim()).not.toBe('');
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
    await overlamna(p, 'L3');
    await ok('tand_scopesignal', { contract_id: p.contractId, fras: 'kan ni även ta' });
    expect(await rutinOk(p, 'L1', TRANSMITTAL('L1'))).toMatchObject({ utfall: 'falld' });
    expect(await rutinOk(p, 'L3', GODKANNANDE('L3', 'Hermes'))).toMatchObject({ utfall: 'falld' });
    // Ett transmittalförslag för en leverabel som redan är levererad.
    expect(await rutinOk(p, 'L3', TRANSMITTAL('L3'))).toMatchObject({ utfall: 'falld' });
    q = await nyttAvtal('14.1 V utan parter', null); await friskIndikator(q);
    await paborja(q, 'L1');
    expect(await rutinOk(q, 'L1', TRANSMITTAL('L1'))).toMatchObject({ utfall: 'falld', skal: ['saknad_mottagare'] });
  });
  it('14.1-V1: det pågående kortet visar förslaget med val, skäl och källa och en knapp för Davids ja, före de oförändrade formulären', async () => {
    const main = huvud(await sida(`${bas(p)}/leveranserna`));
    const k = kort(main, 'L1');
    for (const x of ['Hermes hittade överlämningen i mejlet', 'overlamning-L1@nvr.se', RUTINSKALTEXT.signal_tand,
      'name="forslag_typ" value="transmittal"', 'aria-label="Registrera källhändelsen för leverabel L1"',
      '<option value="mejl">', `name="handling_kalla" maxlength="200" value="${user.email}"`]) expect(k).toContain(x);
    expect(k).not.toContain(RUTINSKALTEXT.fel_utgangslage);
    expect(k).not.toMatch(/<option value="mejl"[^>]*selected/);
    expect(k.split(`action="${bas(p)}/statusforslag"`)).toHaveLength(4);
    expect(k.indexOf('Hermes hittade')).toBeLessThan(k.indexOf('name="handling_id"'));
    const k2 = kort(main, 'L2');
    expect(k2).not.toContain('Hermes hittade');
    expect(k2).not.toContain('forslag_typ');
  });
  it('14.1-V2: förslaget hör till sin typs läge, och utan mottagarpart visas ingen knapp', async () => {
    const k3 = kort(huvud(await sida(`${bas(p)}/leveranserna`)), 'L3');
    for (const x of ['Hermes hittade ett godkännande från Hermes via Mejl den 2026-09-15', RUTINSKALTEXT.obehorig_godkannare,
      'name="forslag_typ" value="godkannande"']) expect(k3).toContain(x);
    const kanalval = k3.match(/<select name="kanal" required>[\s\S]*?<\/select>/)?.[0];
    expect(kanalval).toBeDefined();
    expect(kanalval).not.toContain('selected');
    expect(k3).not.toContain('Hermes hittade överlämningen');
    const kq = kort(huvud(await sida(`${bas(q)}/leveranserna`)), 'L1');
    expect(kq).toContain('Hermes hittade överlämningen');
    expect(kq).toContain(`${LUCKTEXT.mottagarpart.vad}. Registrera själv nedan.`);
    expect(kq).not.toContain('forslag_typ');
    expect(kort(huvud(await sida(`${bas(p)}/leveranserna`)), 'L1')).not.toContain('Registrera själv nedan.');
  });
  it('14.1-V3: knappen registrerar källhändelsen genom action-lagret; ett förslag i fel läge visas som notis utan skrivning', async () => {
    const res = await ua.post(`${bas(p)}/statusforslag`).type('form').send({ contract_id: p.contractId, leverabel_kod: 'L1', forslag_typ: 'transmittal' });
    expect(res.status, res.text).toBe(302);
    expect(res.headers.location).toBe(bas(p));
    expect(await statusar(p)).toContainEqual({ kod: 'L1', status: 'levererad' });
    expect((await handelser(p)).find((h) => h.kod === 'L1' && h.kallhandelse_ref !== null)).toMatchObject({
      registrerad_av: 'manniska', bekraftat_av: user.userId, kallhandelse_ref: 'mejl:overlamning-L1@nvr.se' });
    expect((await audit()).map((x) => `${x.action}:${x.entity_id}`)).toContain('action.executed:bekrafta_rutinforslag');
    expect((await forslag(p)).map((f) => f.leverabel_kod)).not.toContain('L1');
    const fore = await handelser(p);
    const forslagL3 = (await forslag(p)).filter((f) => f.leverabel_kod === 'L3');
    const fel = await ua.post(`${bas(p)}/statusforslag`).type('form').send({ contract_id: p.contractId, leverabel_kod: 'L3', forslag_typ: 'transmittal' });
    expect(fel.status, fel.text).toBe(302);
    expect(fel.headers.location).toContain(`${bas(p)}?fel=`);
    expect(decodeURIComponent(fel.headers.location!)).toContain(FORSLAG_FEL_LAGE);
    expect(await handelser(p)).toEqual(fore);
    expect((await forslag(p)).filter((f) => f.leverabel_kod === 'L3')).toEqual(forslagL3);
  });
  it('14.1-V4: förslaget syns varken på förstasidan, i Läget eller i undantagsvyn (regression)', async () => {
    expect((await forslag(p)).length).toBeGreaterThanOrEqual(2);
    for (const path of [bas(p), `${bas(p)}/laget`, `/app/c/${companyId}/uppdrag`]) {
      expect(await sida(path), path).not.toContain('Hermes hittade');
    }
  });
});

describe('Story 14.1: dokumentationen', () => {
  /** 4.2-D1:s läsare: slutar vid nästa rubrik på nivå två eller tre. */
  function avsnitt(text: string, rubrik: string) {
    const start = text.indexOf(rubrik);
    expect(start).toBeGreaterThanOrEqual(0);
    return text.slice(start + rubrik.length).split(/\n#{2,3} /)[0]!;
  }
  /** 4.4-D1:s läsare: slutar vid slutmönstret, här nästa rubrik på nivå två. */
  function helaAvsnittet(text: string, rubrik: string, slut: RegExp): string {
    const start = text.indexOf(rubrik);
    expect(start).toBeGreaterThanOrEqual(0);
    const resten = text.slice(start + rubrik.length);
    const end = resten.search(slut);
    return rubrik + (end === -1 ? resten : resten.slice(0, end));
  }
  const normalisera = (text: string) => text.replace(/\s+/g, ' ');
  /** Uppräkningen av människospärrade åtgärder: från «markta `kravManniska`» till «avvisas». */
  function kravlista(text: string): string | null {
    const rad = text.split('\n').find((r) => r.includes('markta `kravManniska`'));
    if (rad === undefined) return null;
    const start = rad.indexOf('markta `kravManniska`');
    const slut = rad.indexOf('avvisas', start);
    return slut < 0 ? null : rad.slice(start, slut);
  }
  const kravHaller = (text: string) => {
    const lista = kravlista(text);
    return lista !== null && lista.includes('bekrafta_rutinforslag') && !lista.includes('registrera_rutinstatus');
  };
  /** Handgrepp-provets mönster: ett kodspann med bara gemener och understreck, och minst ett understreck. */
  const ensammaSpann = (text: string) => [...text.matchAll(/`([^`\n]+)`/g)].map((m) => m[1]!)
    .filter((s) => /^[a-z_]+$/.test(s) && s.includes('_'));
  it('14.1-D1: arkitekturen beskriver rutinvägen, behåller den fjärde vägens ord och räknar bara Davids ja som människospärrat', async () => {
    const text = avsnitt(await readFile(new URL('../../docs/ARKITEKTUR.md', import.meta.url), 'utf8'), '## Uppdragsytan (modul)');
    expect(text.split('\n').some((rad) => rad.startsWith('**Rutinvagen (FR-13, Story 14.1).**'))).toBe(true);
    const norm = normalisera(text);
    for (const namn of ['server/src/lib/rutinregel.ts', 'registrera_rutinstatus', 'bekrafta_rutinforslag', 'registrerad_av',
      'kallhandelse_ref', 'kallhandelse_aktor', 'rutinforslag', 'transmittal', 'godkannande', 'En fjarde, kallbelagd rutinvag', 'FR-13']) {
      expect(norm, namn).toContain(namn);
    }
    expect(kravHaller(text)).toBe(true);
    const lista = kravlista(text)!;
    const inskjuten = text.replace(lista, lista.replace('`bekrafta_rutinforslag`', '`bekrafta_rutinforslag`, `registrera_rutinstatus`'));
    const borttagen = text.replace(lista, lista.replace('`bekrafta_rutinforslag`, ', ''));
    expect(inskjuten).not.toBe(text); expect(borttagen).not.toBe(text);
    expect(kravHaller(inskjuten)).toBe(false);
    expect(kravHaller(borttagen)).toBe(false);
  });
  it('14.1-D2: åtgärdsdokumentet har rutinvägen i avsnittet Uppdragsytan, utan nya ensamma kodspann', async () => {
    const docs = await readFile(new URL('../../docs/MCP_ACTIONS.md', import.meta.url), 'utf8');
    const rubrik = '### Rutinvägen (Story 14.1)';
    const modulStart = docs.indexOf('\n## Uppdragsytan');
    const modulSlut = docs.indexOf('\n## ', modulStart + 1);
    const start = docs.indexOf(rubrik);
    expect(modulStart).toBeGreaterThanOrEqual(0);
    expect(start).toBeGreaterThan(modulStart);
    expect(start).toBeLessThan(modulSlut);
    const rutin = avsnitt(docs, rubrik);
    const norm = normalisera(rutin);
    for (const namn of ['registrera_rutinstatus', 'bekrafta_rutinforslag', 'kallhandelse_aktor', 'transmittal', 'godkannande', 'rutinforslag']) {
      expect(norm, namn).toContain(namn);
    }
    expect(ensammaSpann(rutin)).toEqual([]);
    expect(ensammaSpann(`${rutin}\n- \`registrerad_av\``)).toEqual(['registrerad_av']);
    expect(ensammaSpann(`${rutin}\n- \`datum_saknas\``)).toEqual(['datum_saknas']);
    expect(ensammaSpann("`registrerad_av = 'system'`")).toEqual([]);
    const modul = helaAvsnittet(docs, '## Uppdragsytan', /^## /m);
    expect(modul).toContain(rubrik);
    expect(modul.includes('las_faktureringsunderlag')).toBe(false);
  });
});
