// Story 14.1, FR-13/FR-12/NFR-4: ett rutinmässigt statusbyte registreras ur sin
// källhändelse utan fråga. Risken: en maskin flyttar ett läge som kräver Davids
// omdöme, ett godkännande uppfinns, eller en rutinregistrering bär en mänsklig
// signatur. Regeln prövas ren; skrivvägen, villkoren och kortet prövas genom
// hela stacken mot Postgres.
import { readFile } from 'node:fs/promises';
import supertest from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { app, api, createCompany, createFiscalYear, registerUser, withAdmin, type TestUser } from './helpers.js';
import { importeraOchGodkann } from './uppdragImportHelper.js';
import { LEVERANSKONTRAKT_NVR001 } from './fixtures/leveranskontrakt-nvr-001.js';
import { withTenantTransaction } from '../src/db/tx.js';
import { loadMigrations } from '../src/db/migrate.js';
import { skapaReferens } from '../src/services/uppdragReferens.js';
import { lasRutinforslag, type Rutinforslag, type Rutinstatusutfall } from '../src/services/uppdragStatus.js';
import { RUTINFORSLAGSNYCKEL, upsertSvepvarden } from '../src/services/uppdragSvep.js';
import { getAction } from '../src/actions/registry.js';
import type { Leverabelrad } from '../src/services/uppdragRegister.js';
import type { Approval } from '../src/services/approvals.js';
import {
  KALLHANDELSETYPER, OVERGANGAR, RUTINSKAL, RUTINSKALTEXT, provaRutinhandelse, type Rutinindata,
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
  return withAdmin(async (c) => (await c.query(`SELECT h.*, l.kod, h.registrerad_av, h.kallhandelse_typ, h.kallhandelse_ref,
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
async function audit() {
  const res = await api.get(`${co()}/audit`).set(auth());
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.entries as Array<{ action: string; entity_id: string; details: Record<string, unknown> }>;
}
/** Köposterna som väntar på David. Historiken (importens godkända baseline) räknas inte. */
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
const agent = (namn: string, kropp: Record<string, unknown>) => act(namn, kropp, { Authorization: `Bearer ${agentToken}` });
type Kallhandelse = Record<string, unknown> & { handling: { sort: string; extern_id: string; extern_kalla: string } };
const TRANSMITTAL = (kod: string): Kallhandelse => ({ typ: 'transmittal',
  handling: { sort: 'mejl', extern_id: `<overlamning-${kod}@nvr.se>`, extern_kalla: 'gmail:locollabs' }, handelse_datum: '2026-09-12' });
const GODKANNANDE = (kod: string, godkand_av: string): Kallhandelse => ({ typ: 'godkannande',
  handling: { sort: 'mejl', extern_id: `<godkant-${kod}@nvr.se>`, extern_kalla: 'gmail:locollabs' }, handelse_datum: '2026-09-15', godkand_av, kanal: 'mejl' });
const rutin = (a: Avtal, kod: string, kallhandelse: Record<string, unknown>) =>
  agent('registrera_rutinstatus', { contract_id: a.contractId, leverabel_kod: kod, kallhandelse });
/** Rutinvägens svar; varje anrop i fallen väntas ge 200. */
async function rutinOk(a: Avtal, kod: string, kallhandelse: Record<string, unknown>): Promise<Rutinstatusutfall> {
  const res = await rutin(a, kod, kallhandelse);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.result as Rutinstatusutfall;
}
/** Människans överlämning ur samma handling som transmittalen. */
const overlamna = (a: Avtal, kod: string) =>
  ok('bekrafta_statusbyte', { ...indata(a, kod), utfall: 'bekraftad', handling: TRANSMITTAL(kod).handling });
const TROSKLAR = { procent: 5, golv_ore: 0, golv_timmar: 0, dagar: 5 };
const troskellarm = (a: Avtal, larm: unknown[]) => withTenantTransaction(user.userId, companyId, (c) =>
  upsertSvepvarden(c, companyId, a.contractId, [{ nyckel: 'troskellarm', kalla: 'redovisning', varde: { trosklar: TROSKLAR, larm, utan_egen_ram: [] } }]));
const friskIndikator = (a: Avtal) => troskellarm(a, []);
/** Ett eget avtal med NVR-001:s parter, en läst och frisk indikator och de påbörjade leverablerna. */
async function friskt(namn: string, paborjade: string[] = ['L1']): Promise<Avtal> {
  const a = await nyttAvtal(namn);
  await friskIndikator(a);
  for (const kod of paborjade) await paborja(a, kod);
  return a;
}
const tandIndikator = (a: Avtal, kod: string) => troskellarm(a, [{ ram: 'dagar', kod, slutdatum: '2026-09-13',
  precision: null, arvt_fran: null, forsening_dagar: 10, troskel_dagar: 5 }]);
async function foralder(a: Avtal, kod: string): Promise<string> {
  return withAdmin(async (c) => (await c.query(`SELECT f.code FROM contract_parts d
    JOIN contract_parts f ON f.id=d.parent_part_id AND f.company_id=d.company_id
    WHERE d.company_id=$1 AND d.contract_id=$2 AND d.code=$3 ORDER BY d.valid_from DESC LIMIT 1`, [companyId, a.contractId, kod])).rows[0]?.code ?? '');
}
const forslag = (a: Avtal): Promise<Rutinforslag[]> =>
  withTenantTransaction(user.userId, companyId, (c) => lasRutinforslag(c, companyId, a.contractId));
async function undantag(): Promise<string[]> {
  const r = await ok<{ poster: Array<{ slag: string; id: string }> }>('las_undantag', {});
  return r.poster.map((p) => `${p.slag}:${p.id}`).sort();
}
async function svepcache(a: Avtal) {
  return withAdmin(async (c) => (await c.query('SELECT nyckel, varde FROM uppdrag_svepvarde WHERE company_id=$1 AND contract_id=$2 ORDER BY nyckel', [companyId, a.contractId])).rows);
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

describe('Story 14.1: rutinregeln (ren)', () => {
  const NVR = { godkannare: 'Styrgruppen', godkannare_eskalering: 'Eva Larsson (VD)' };
  const KEDJA = ['L1', 'STEG1', 'ROT'];
  const bas = { status: 'pagar', oppna_signaler: 0, larmkoder: [] as string[], leverabelkedja: KEDJA, parter: NVR };
  const LAGEN = ['ej_paborjad', 'pagar', 'levererad', 'godkand', 'avvisad'];
  const transmittal = (x: Partial<Rutinindata> = {}): Rutinindata => ({ ...bas, typ: 'transmittal', ...x });
  const godkannande = (godkand_av: string, x: Partial<Rutinindata> = {}): Rutinindata =>
    ({ ...bas, status: 'levererad', typ: 'godkannande', godkand_av, ...x });

  it('14.1-R1: fyra steg, två källhändelser, och bara leveransen och godkännandet kan medges', () => {
    expect(OVERGANGAR).toEqual([
      { fran: 'ej_paborjad', till: 'pagar', kallhandelse: null, manniskovag: 'paborja_leverabel' },
      { fran: 'pagar', till: 'levererad', kallhandelse: 'transmittal', manniskovag: 'bekrafta_statusbyte' },
      { fran: 'levererad', till: 'godkand', kallhandelse: 'godkannande', manniskovag: 'godkann_leverabel' },
      { fran: 'pagar', till: 'avvisad', kallhandelse: null, manniskovag: 'bekrafta_statusbyte' },
    ]);
    expect([...KALLHANDELSETYPER]).toEqual(['transmittal', 'godkannande']);
    for (const typ of KALLHANDELSETYPER) expect(OVERGANGAR.filter((o) => o.kallhandelse === typ)).toHaveLength(1);
    const tillatna = new Set(['pagar>levererad', 'levererad>godkand']);
    const medgivna = new Set<string>();
    for (const status of LAGEN) {
      for (const indata of [transmittal({ status }), godkannande('Styrgruppen', { status })]) {
        const u = provaRutinhandelse(indata);
        if (u.medges) medgivna.add(`${u.fran}>${u.till}`);
      }
    }
    expect(medgivna.size).toBeGreaterThan(0);
    for (const par of medgivna) expect(tillatna.has(par), par).toBe(true);
  });

  it('14.1-R2: transmittalen medges från pågår till levererad med avtalets mottagare', () => {
    expect(provaRutinhandelse(transmittal())).toEqual({ medges: true, fran: 'pagar', till: 'levererad', mottagare: 'Styrgruppen' });
  });

  it('14.1-R3: bara avtalets godkännare eller eskalering medges, exakt efter normalisering', () => {
    expect(provaRutinhandelse(godkannande('Styrgruppen')))
      .toEqual({ medges: true, fran: 'levererad', till: 'godkand', mottagare: 'Styrgruppen' });
    expect(provaRutinhandelse(godkannande('  eva   larsson (vd) ')))
      .toEqual({ medges: true, fran: 'levererad', till: 'godkand', mottagare: 'Eva Larsson (VD)' });
    for (const avsandare of ['Eva Larsson', 'Hermes']) {
      expect(provaRutinhandelse(godkannande(avsandare))).toEqual({ medges: false, skal: ['obehorig_godkannare'] });
    }
    expect(provaRutinhandelse(godkannande('Styrgruppen', { parter: { godkannare: null, godkannare_eskalering: null } })))
      .toEqual({ medges: false, skal: ['obehorig_godkannare'] });
  });

  it('14.1-R4: en obesvarad scopesignal fäller båda källhändelserna', () => {
    expect(provaRutinhandelse(transmittal({ oppna_signaler: 1 }))).toEqual({ medges: false, skal: ['signal_tand'] });
    expect(provaRutinhandelse(godkannande('Styrgruppen', { oppna_signaler: 1 }))).toEqual({ medges: false, skal: ['signal_tand'] });
  });

  it('14.1-R5: indikatorn fäller för leverabeln och varje nivå över den, och oläst fäller', () => {
    for (const kod of ['L1', 'STEG1', 'ROT']) {
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

  it('14.1-R7: transmittalen utan avtalets mottagarpart fälls', () => {
    expect(provaRutinhandelse(transmittal({ parter: { godkannare: null, godkannare_eskalering: 'Eva Larsson (VD)' } })))
      .toEqual({ medges: false, skal: ['saknad_mottagare'] });
  });

  it('14.1-R8: alla skäl i listans ordning, en text per skäl, och regeln är ren', () => {
    expect(provaRutinhandelse(transmittal({ status: 'ej_paborjad', oppna_signaler: 2, larmkoder: null })))
      .toEqual({ medges: false, skal: ['fel_utgangslage', 'signal_tand', 'indikator_olast'] });
    expect(new Set(Object.keys(RUTINSKALTEXT))).toEqual(new Set(RUTINSKAL));
    const fryst = Object.freeze({
      ...godkannande('Styrgruppen'),
      leverabelkedja: Object.freeze([...KEDJA]),
      larmkoder: Object.freeze(['L2']),
      parter: Object.freeze({ ...NVR }),
    }) as unknown as Rutinindata;
    const forsta = provaRutinhandelse(fryst);
    expect(provaRutinhandelse(fryst)).toEqual(forsta);
    expect(forsta.medges).toBe(true);
  });
});

describe('Story 14.1: migrationen', () => {
  let a: Avtal;
  let refId: string;
  const MEJL = { sort: 'mejl', extern_id: '<riggning-M@nvr.se>', extern_kalla: 'gmail:locollabs' } as const;
  type Rad = { bekraftat_av?: string | null; registrerad_av?: string; kallhandelse_typ?: string | null;
    kallhandelse_ref?: string | null; referens_id?: string | null };
  /** En rad direkt i tabellen som ägarrollen; varje anrop är sin egen transaktion. */
  const rigga = (kod: string, r: Rad) => withAdmin((c) => c.query(`INSERT INTO uppdrag_leverabel_handelse
      (company_id, contract_id, leverabel_id, fran, till, bekraftat_av, registrerad_av, kallhandelse_typ, kallhandelse_ref, referens_id)
    SELECT company_id, contract_id, id, 'pagar', 'levererad', $4::text, $5::text, $6::text, $7::text, $8::uuid
      FROM uppdrag_leverabel WHERE company_id=$1 AND contract_id=$2 AND kod=$3`,
  [companyId, a.contractId, kod, r.bekraftat_av ?? null, r.registrerad_av ?? 'manniska', r.kallhandelse_typ ?? null,
    r.kallhandelse_ref ?? null, r.referens_id ?? null]));
  const system = (x: Rad = {}): Rad => ({ registrerad_av: 'system', kallhandelse_typ: 'transmittal',
    kallhandelse_ref: 'mejl:riggning-M@nvr.se', referens_id: refId, ...x });
  beforeAll(async () => {
    a = await nyttAvtal('14.1 M');
    for (const kod of ['L1', 'L2']) await paborja(a, kod);
    refId = (await withTenantTransaction(user.userId, companyId, (c) => skapaReferens(c, companyId,
      { contract_id: a.contractId, ...MEJL, extern_nyckel: 'rfc822#message-id' }))).id;
  });

  it('14.1-M1: tre kolumner, tre villkor och ett unikt index, idempotent och med sann kolumnkommentar', async () => {
    const migration = (await loadMigrations()).find((m) => m.name === 'rutinstatus');
    expect(migration).toBeDefined();
    const VILLKOR = ['uppdrag_leverabel_handelse_registrerad_av_check', 'uppdrag_leverabel_handelse_kallhandelse_typ_check',
      'uppdrag_leverabel_handelse_registrering_check'];
    const las = () => withAdmin(async (c) => ({
      kolumner: (await c.query(`SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns
        WHERE table_name='uppdrag_leverabel_handelse' AND column_name = ANY($1::text[]) ORDER BY column_name`,
      [['registrerad_av', 'kallhandelse_typ', 'kallhandelse_ref']])).rows,
      villkor: (await c.query('SELECT conname FROM pg_constraint WHERE conname = ANY($1::text[]) ORDER BY conname', [VILLKOR])).rows,
      index: (await c.query("SELECT indexdef FROM pg_indexes WHERE indexname='uppdrag_leverabel_handelse_kallhandelse_uk'")).rows,
      kommentar: (await c.query(`SELECT col_description('uppdrag_leverabel_handelse'::regclass,
        (SELECT attnum FROM pg_attribute WHERE attrelid='uppdrag_leverabel_handelse'::regclass AND attname='referens_id')) AS text`)).rows[0].text as string,
    }));
    const fore = await las();
    expect(fore.kolumner).toEqual([
      { column_name: 'kallhandelse_ref', data_type: 'text', is_nullable: 'YES', column_default: null },
      { column_name: 'kallhandelse_typ', data_type: 'text', is_nullable: 'YES', column_default: null },
      expect.objectContaining({ column_name: 'registrerad_av', data_type: 'text', is_nullable: 'NO', column_default: expect.stringContaining('manniska') }),
    ]);
    expect(fore.villkor.map((r) => r.conname)).toEqual([...VILLKOR].sort());
    expect(fore.index).toHaveLength(1);
    expect(fore.index[0].indexdef).toContain('UNIQUE');
    expect(fore.index[0].indexdef).toContain('leverabel_id, kallhandelse_typ, kallhandelse_ref');
    expect(fore.kommentar.startsWith('Handlingen som överlämningen eller returen registrerades ur, som rad i uppdrag_referens.')).toBe(true);
    expect(fore.kommentar).toContain('källhändelse');
    await withAdmin(async (c) => { await c.query(migration!.sql); await c.query(migration!.sql); });
    expect(await las()).toEqual(fore);
  });

  it('14.1-M2: åtta otillåtna radformer fälls och två tillåtna går igenom', async () => {
    const fore = (await handelser(a)).filter((h) => h.kod === 'L1');
    const otillatna: Array<[string, Rad]> = [
      ['(a) manniska utan bekraftat_av', { registrerad_av: 'manniska' }],
      ['(b) system med bekraftat_av', system({ bekraftat_av: user.userId })],
      ['(c) system utan kallhandelse_typ', system({ kallhandelse_typ: null })],
      ['(d) system utan kallhandelse_ref', system({ kallhandelse_ref: null })],
      ['(e) system utan referens_id', system({ referens_id: null })],
      ['(f) manniska med kallhandelse_typ', { bekraftat_av: user.userId, kallhandelse_typ: 'transmittal' }],
      ['(g) registrerad_av agent', { bekraftat_av: user.userId, registrerad_av: 'agent' }],
      ['(h) kallhandelse_typ retur', system({ kallhandelse_typ: 'retur' })],
    ];
    for (const [namn, rad] of otillatna) {
      await expect(rigga('L1', rad), namn).rejects.toMatchObject({ code: '23514' });
    }
    expect((await handelser(a)).filter((h) => h.kod === 'L1')).toEqual(fore);
    await rigga('L1', { bekraftat_av: user.userId });
    await rigga('L1', system());
    const nya = (await handelser(a)).filter((h) => h.kod === 'L1').slice(fore.length);
    expect(nya).toHaveLength(2);
    expect(nya.map((h) => [h.registrerad_av, h.bekraftat_av, h.kallhandelse_typ])).toEqual([
      ['manniska', user.userId, null], ['system', null, 'transmittal'],
    ]);
  });

  it('14.1-M3: samma källhändelse kan inte registreras två gånger för samma leverabel', async () => {
    const nyckel = { kallhandelse_ref: 'mejl:dubblett-M3@nvr.se' };
    await rigga('L1', system(nyckel));
    await expect(rigga('L1', system(nyckel))).rejects.toMatchObject({ code: '23505' });
    await expect(rigga('L2', system(nyckel))).resolves.toBeTruthy();
  });
});

describe('Story 14.1: rutinvägen', () => {
  it('14.1-A1: transmittalen registreras utan fråga, med handlingen, och raden går inte att skriva om', async () => {
    const a = await friskt('14.1 A1');
    const antal = () => withAdmin(async (c) => (await c.query(`SELECT
      (SELECT count(*)::int FROM action_approvals WHERE company_id=$1) AS approvals,
      (SELECT count(*)::int FROM uppdrag_beslut WHERE company_id=$1 AND contract_id=$2) AS beslut`, [companyId, a.contractId])).rows[0]);
    const fore = await antal(); const poster = await undantag(); const refsFore = new Set((await referenser(a)).map((r) => r.id));
    const r = await rutinOk(a, 'L1', TRANSMITTAL('L1'));
    expect(r).toMatchObject({ utfall: 'registrerad', leverabel_kod: 'L1', fran: 'pagar', status: 'levererad', revision: 1,
      mottagare: 'Styrgruppen', kallhandelse_typ: 'transmittal', kallhandelse_ref: 'mejl:overlamning-L1@nvr.se', referens_id: expect.any(String) });
    if (r.utfall !== 'registrerad') throw new Error('väntade registrerad');
    const h = (await handelser(a)).find((x) => x.id === r.handelse_id);
    expect(h).toMatchObject({ fran: 'pagar', till: 'levererad', registrerad_av: 'system', bekraftat_av: null,
      kallhandelse_typ: 'transmittal', kallhandelse_ref: 'mejl:overlamning-L1@nvr.se', referens_id: r.referens_id,
      dag: '2026-09-12', kanal: null, notering: null, revision: 1, mottagare: 'Styrgruppen' });
    const nya = (await referenser(a)).filter((x) => !refsFore.has(x.id));
    expect(nya.find((x) => x.id === r.referens_id)).toMatchObject({ sort: 'mejl', extern_id: 'overlamning-L1@nvr.se',
      extern_nyckel: 'rfc822#message-id', extern_kalla: 'gmail:locollabs' });
    expect(nya).toContainEqual(expect.objectContaining({ extern_nyckel: 'registerkopia', ko_status: 'koad' }));
    expect(nya.every((x) => x.id === r.referens_id || x.extern_nyckel === 'registerkopia')).toBe(true);
    expect(await antal()).toEqual(fore);
    expect(await undantag()).toEqual(poster);
    expect(await godkannanden()).toEqual([]);
    expect((await audit()).find((x) => x.action === 'action.executed' && x.entity_id === 'registrera_rutinstatus'))
      .toMatchObject({ details: expect.objectContaining({ actor: 'agent', sensitivity: 'write' }) });
    expect((await register(a)).find((x) => x.kod === 'L1')).toMatchObject({ status: 'levererad', revision: 1, mottagare: 'Styrgruppen' });
    // Append-only i praktiken: rollen app kan varken skriva om eller ta bort rutinraden.
    await expect(withTenantTransaction(user.userId, companyId, (c) => c.query(
      "UPDATE uppdrag_leverabel_handelse SET bekraftat_av = 'någon' WHERE id = $1", [r.handelse_id],
    ))).rejects.toThrow(/permission denied/);
    await expect(withTenantTransaction(user.userId, companyId, (c) => c.query(
      'DELETE FROM uppdrag_leverabel_handelse WHERE id = $1', [r.handelse_id],
    ))).rejects.toThrow(/permission denied/);
    expect((await handelser(a)).find((x) => x.id === r.handelse_id)).toEqual(h);
  });

  it('14.1-A2: godkännandet från avtalets eskalering registreras med avsändarens part som mottagare', async () => {
    const a = await friskt('14.1 A2', ['L2']);
    const manniskan = await overlamna(a, 'L2');
    const r = await rutinOk(a, 'L2', GODKANNANDE('L2', 'Eva Larsson (VD)'));
    expect(r).toMatchObject({ utfall: 'registrerad', fran: 'levererad', status: 'godkand', revision: null,
      mottagare: 'Eva Larsson (VD)', kallhandelse_typ: 'godkannande', kallhandelse_ref: 'mejl:godkant-L2@nvr.se' });
    if (r.utfall !== 'registrerad') throw new Error('väntade registrerad');
    const alla = await handelser(a);
    expect(alla.find((x) => x.id === r.handelse_id)).toMatchObject({ till: 'godkand', registrerad_av: 'system', bekraftat_av: null,
      kanal: 'mejl', dag: '2026-09-15', referens_id: r.referens_id, mottagare: 'Eva Larsson (VD)' });
    expect(r.referens_id).toEqual(expect.any(String));
    expect(alla.find((x) => x.id === manniskan.handelse_id)).toMatchObject({ registrerad_av: 'manniska', bekraftat_av: user.userId,
      kallhandelse_typ: null, kallhandelse_ref: null });
    expect((await register(a)).find((x) => x.kod === 'L2')).toMatchObject({ status: 'godkand', revision: 1, mottagare: 'Styrgruppen' });
  });

  it('14.1-A3: åtgärden tar aldrig emot ett målläge och fäller fel form med 400', async () => {
    const a = await friskt('14.1 A3');
    const fore = await handelser(a); const refs = await referenser(a);
    const t = TRANSMITTAL('L1');
    for (const [namn, kropp] of [
      ['tom indata', {}],
      ['till', { ...indata(a, 'L1'), kallhandelse: t, till: 'levererad' }],
      ['status', { ...indata(a, 'L1'), kallhandelse: t, status: 'godkand' }],
      ['paborjande', { ...indata(a, 'L1'), kallhandelse: { ...t, typ: 'paborjande' } }],
      ['retur', { ...indata(a, 'L1'), kallhandelse: { ...t, typ: 'retur' } }],
      ['url', { ...indata(a, 'L1'), kallhandelse: { ...t, handling: { ...t.handling, extern_id: 'https://mail.google.com/x' } } }],
    ] as const) {
      const res = await agent('registrera_rutinstatus', kropp);
      expect(res.status, `${namn}: ${JSON.stringify(res.body)}`).toBe(400);
      expect(res.body.error, namn).toBe('validation_error');
    }
    expect(await handelser(a)).toEqual(fore);
    expect(fore.map((h) => h.till)).toEqual(['pagar']);
    expect(await statusar(a)).toContainEqual({ kod: 'L1', status: 'pagar' });
    expect(await referenser(a)).toEqual(refs);
  });

  it('14.1-A4: samma källhändelse registreras aldrig en andra gång', async () => {
    const a = await friskt('14.1 A4', ['L1', 'L2']);
    const forsta = await rutinOk(a, 'L1', TRANSMITTAL('L1'));
    if (forsta.utfall !== 'registrerad') throw new Error('väntade registrerad');
    const refs = (await referenser(a)).length;
    expect(await rutinOk(a, 'L1', TRANSMITTAL('L1')))
      .toEqual({ utfall: 'redan_registrerad', handelse_id: forsta.handelse_id, leverabel_kod: 'L1', status: 'levererad' });
    expect((await handelser(a)).filter((h) => h.kallhandelse_ref === 'mejl:overlamning-L1@nvr.se')).toHaveLength(1);
    expect((await referenser(a)).length).toBe(refs);
    await overlamna(a, 'L2');
    const godkant = await rutinOk(a, 'L2', GODKANNANDE('L2', 'Eva Larsson (VD)'));
    if (godkant.utfall !== 'registrerad') throw new Error('väntade registrerad');
    const refs2 = (await referenser(a)).length;
    expect(await rutinOk(a, 'L2', GODKANNANDE('L2', 'Eva Larsson (VD)')))
      .toEqual({ utfall: 'redan_registrerad', handelse_id: godkant.handelse_id, leverabel_kod: 'L2', status: 'godkand' });
    expect((await handelser(a)).filter((h) => h.kallhandelse_ref === 'mejl:godkant-L2@nvr.se')).toHaveLength(1);
    expect((await referenser(a)).length).toBe(refs2);
  });

  it('14.1-A5: människovägens datumfönster gäller också källhändelsen', async () => {
    const a = await friskt('14.1 A5');
    const fore = await handelser(a); const refs = await referenser(a);
    for (const [datum, fel] of [['2099-01-01', 'framtida_datum'], ['2026-09-01', 'fore_avtalet']] as const) {
      const res = await rutin(a, 'L1', { ...TRANSMITTAL('L1'), handelse_datum: datum });
      expect(res.status, JSON.stringify(res.body)).toBe(400);
      expect(res.body.error).toBe(fel);
    }
    expect(await handelser(a)).toEqual(fore);
    expect(await referenser(a)).toEqual(refs);
  });

  it('14.1-A6: ett grannbolags avtal och en okänd leverabel svarar 404 utan skrivning', async () => {
    // Förutsättning: åtgärden finns, så att 404 nedan är grannskapet och inte ett okänt namn.
    expect(getAction('registrera_rutinstatus')).toBeDefined();
    const granne = await registerUser('rutinstatus-granne');
    const gBolag = await createCompany(granne.token, 'Grannen Rutin AB');
    const gAuth = { Authorization: `Bearer ${granne.token}` };
    await createFiscalYear(gBolag, gAuth, { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });
    const gOk = async (namn: string, kropp: Record<string, unknown>) => {
      const res = await api.post(`/api/companies/${gBolag}/actions/${namn}`).set(gAuth).send(kropp);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      return res.body.result as Record<string, unknown>;
    };
    const projectId = (await gOk('create_project', { name: '14.1 A6 granne' })).id as string;
    const contractId = (await gOk('skapa_uppdrag', { project_id: projectId, name: '14.1 A6 granne', signed_date: '2026-09-03' })).contract_id as string;
    await importeraOchGodkann(gBolag, gAuth, { contract_id: contractId, kontraktstext: LEVERANSKONTRAKT_NVR001 });
    await gOk('paborja_leverabel', { contract_id: contractId, leverabel_kod: 'L1' });
    const grannensLage = () => withAdmin(async (c) => ({
      handelser: (await c.query('SELECT * FROM uppdrag_leverabel_handelse WHERE company_id=$1 ORDER BY id', [gBolag])).rows,
      referenser: (await c.query('SELECT * FROM uppdrag_referens WHERE company_id=$1 ORDER BY id', [gBolag])).rows,
      cache: (await c.query('SELECT nyckel, varde FROM uppdrag_svepvarde WHERE company_id=$1 ORDER BY contract_id, nyckel', [gBolag])).rows,
    }));
    const fore = await grannensLage();
    expect(fore.handelser).toHaveLength(1);
    const res = await rutin({ projectId, contractId }, 'L1', TRANSMITTAL('L1'));
    expect(res.status, JSON.stringify(res.body)).toBe(404);
    const a = await friskt('14.1 A6 eget');
    const egetFore = { h: await handelser(a), r: await referenser(a), c: await svepcache(a) };
    const okand = await rutin(a, 'L99', TRANSMITTAL('L99'));
    expect(okand.status, JSON.stringify(okand.body)).toBe(404);
    expect(await grannensLage()).toEqual(fore);
    expect({ h: await handelser(a), r: await referenser(a), c: await svepcache(a) }).toEqual(egetFore);
    // Positiv kontroll: samma källhändelse på det egna avtalets L1 registreras.
    expect(await rutinOk(a, 'L1', TRANSMITTAL('L1'))).toMatchObject({ utfall: 'registrerad' });
  });

  it('14.1-A7: de tre människospärrarna står kvar, och rutinvägen är write utan spärr och utan kö', async () => {
    const a = await friskt('14.1 A7', ['L2']);
    await withAdmin((c) => c.query("UPDATE uppdrag_leverabel SET status='levererad' WHERE company_id=$1 AND contract_id=$2 AND kod='L3'", [companyId, a.contractId]));
    const fore = await handelser(a); const states = await statusar(a);
    for (const [namn, kropp] of [
      ['paborja_leverabel', indata(a, 'L1')],
      ['bekrafta_statusbyte', { ...indata(a, 'L2'), utfall: 'bekraftad', handling: TRANSMITTAL('L2').handling }],
      ['godkann_leverabel', { ...indata(a, 'L3'), kanal: 'mejl' }],
    ] as const) {
      expect(getAction(namn)).toMatchObject({ kravManniska: true, sensitivity: 'write' });
      const res = await agent(namn, kropp);
      expect(res.status, JSON.stringify(res.body)).toBe(403);
      expect(res.body.error).toBe('human_required');
      expect(await handelser(a)).toEqual(fore);
      expect(await statusar(a)).toEqual(states);
    }
    const rutinvagen = getAction('registrera_rutinstatus');
    expect(rutinvagen).toBeDefined();
    expect(rutinvagen!.sensitivity).toBe('write');
    expect(rutinvagen!.kravManniska ?? false).toBe(false);
    expect(rutinvagen!.koasForAgent ?? false).toBe(false);
    expect((rutinvagen!.description ?? '').trim()).not.toBe('');
    const manniskan = await overlamna(a, 'L2');
    expect((await handelser(a)).find((x) => x.id === manniskan.handelse_id)).toMatchObject({
      registrerad_av: 'manniska', bekraftat_av: user.userId, kallhandelse_typ: null, kallhandelse_ref: null,
    });
  });
});

describe('Story 14.1: det fällda blir ett förslag', () => {
  const tandSignal = async (a: Avtal) => (await ok('tand_scopesignal', { contract_id: a.contractId, fras: 'kan ni även ta' })).id as string;

  it('14.1-F1: en tänd signal fäller bytet till ett förslag som inte ändrar något förrän signalen avgjorts', async () => {
    const a = await friskt('14.1 F1');
    const signalId = await tandSignal(a);
    const fore = { s: await statusar(a), h: await handelser(a), r: await referenser(a), u: await undantag() };
    const r = await rutinOk(a, 'L1', TRANSMITTAL('L1'));
    const regeln = provaRutinhandelse({ typ: 'transmittal', status: 'pagar', oppna_signaler: 1, larmkoder: [],
      leverabelkedja: ['L1'], parter: { godkannare: 'Styrgruppen', godkannare_eskalering: 'Eva Larsson (VD)' } });
    expect(regeln.medges).toBe(false);
    expect(r).toEqual({ utfall: 'falld', leverabel_kod: 'L1', status: 'pagar', skal: ['signal_tand'], forslag_atgard: 'bekrafta_statusbyte' });
    if (r.utfall !== 'falld' || regeln.medges) throw new Error('väntade falld');
    expect(r.skal).toEqual(regeln.skal);
    expect({ s: await statusar(a), h: await handelser(a), r: await referenser(a), u: await undantag() }).toEqual(fore);
    expect(await godkannanden()).toEqual([]);
    const f = await forslag(a);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ leverabel_kod: 'L1', skal: ['signal_tand'], forslag_atgard: 'bekrafta_statusbyte',
      kallhandelse: { typ: 'transmittal', handelse_datum: '2026-09-12',
        handling: { sort: 'mejl', extern_id: 'overlamning-L1@nvr.se', extern_kalla: 'gmail:locollabs' } } });
    await ok('avgor_scopesignal', { signal_id: signalId, avgjord: 'innanfor' });
    expect(await rutinOk(a, 'L1', TRANSMITTAL('L1'))).toMatchObject({ utfall: 'registrerad', status: 'levererad' });
    expect(await forslag(a)).toEqual([]);
    expect((await svepcache(a)).map((x) => x.nyckel)).not.toContain(RUTINFORSLAGSNYCKEL);
  });

  it('14.1-F2: indikatorn fäller för leverabeln och nivåerna över den, och oläst fäller', async () => {
    const [a, b, c, d] = [await friskt('14.1 F2 a'), await friskt('14.1 F2 b'), await nyttAvtal('14.1 F2 c'), await friskt('14.1 F2 d')];
    await paborja(c, 'L1');
    await tandIndikator(a, 'L1');
    expect(await rutinOk(a, 'L1', TRANSMITTAL('L1'))).toMatchObject({ utfall: 'falld', skal: ['indikator_tand'] });
    await tandIndikator(b, 'L2');
    expect(await rutinOk(b, 'L1', TRANSMITTAL('L1'))).toMatchObject({ utfall: 'registrerad', status: 'levererad' });
    expect((await svepcache(c)).map((x) => x.nyckel)).not.toContain('troskellarm');
    expect(await rutinOk(c, 'L1', TRANSMITTAL('L1'))).toMatchObject({ utfall: 'falld', skal: ['indikator_olast'] });
    const over = await foralder(d, 'L1');
    expect(over).not.toBe('');
    expect(over).not.toBe('L1');
    await tandIndikator(d, over);
    expect(await rutinOk(d, 'L1', TRANSMITTAL('L1'))).toMatchObject({ utfall: 'falld', skal: ['indikator_tand'] });
    await tandIndikator(d, 'UPPDRAG');
    expect(await rutinOk(d, 'L1', TRANSMITTAL('L1'))).toMatchObject({ utfall: 'falld', skal: ['indikator_tand'] });
    expect(await statusar(d)).toContainEqual({ kod: 'L1', status: 'pagar' });
  });

  it('14.1-F3: ett godkännande från någon annan än avtalets parter fälls; modellen godkänner aldrig själv', async () => {
    const a = await friskt('14.1 F3');
    await overlamna(a, 'L1');
    expect(await rutinOk(a, 'L1', GODKANNANDE('L1', 'Hermes')))
      .toMatchObject({ utfall: 'falld', status: 'levererad', skal: ['obehorig_godkannare'], forslag_atgard: 'godkann_leverabel' });
    expect(await statusar(a)).toContainEqual({ kod: 'L1', status: 'levererad' });
    expect((await handelser(a)).filter((h) => h.till === 'godkand')).toEqual([]);
    expect(await rutinOk(a, 'L1', GODKANNANDE('L1', 'Styrgruppen'))).toMatchObject({ utfall: 'registrerad', status: 'godkand' });
  });

  it('14.1-F4: förslaget överlever svepet, och bara rutinvägens omfång skriver det', async () => {
    const a = await friskt('14.1 F4');
    await tandSignal(a);
    expect(await rutinOk(a, 'L1', TRANSMITTAL('L1'))).toMatchObject({ utfall: 'falld' });
    const fore = await forslag(a);
    expect(fore).toHaveLength(1);
    await withTenantTransaction(user.userId, companyId, (c) => upsertSvepvarden(c, companyId, a.contractId, [{ nyckel: 'prognos', varde: {} }]));
    expect(await forslag(a)).toEqual(fore);
    for (const [omfang, nyckel] of [['svep', RUTINFORSLAGSNYCKEL], ['rutinforslag', 'prognos']] as const) {
      await expect(withTenantTransaction(user.userId, companyId, (c) => upsertSvepvarden(c, companyId, a.contractId,
        [{ nyckel, varde: {} }], omfang)), `${omfang}/${nyckel}`).rejects.toBeInstanceOf(Error);
    }
    expect(await forslag(a)).toEqual(fore);
  });

  it('14.1-F5: ett påbörjande tas aldrig av rutinvägen', async () => {
    const a = await friskt('14.1 F5', []);
    expect(await statusar(a)).toContainEqual({ kod: 'L3', status: 'ej_paborjad' });
    expect(await rutinOk(a, 'L3', TRANSMITTAL('L3')))
      .toEqual({ utfall: 'falld', leverabel_kod: 'L3', status: 'ej_paborjad', skal: ['fel_utgangslage'], forslag_atgard: 'bekrafta_statusbyte' });
    expect(await statusar(a)).toContainEqual({ kod: 'L3', status: 'ej_paborjad' });
    expect((await handelser(a)).filter((h) => h.kod === 'L3')).toEqual([]);
  });
});

describe('Story 14.1: förslaget på kortet', () => {
  let p: Avtal;
  beforeAll(async () => {
    p = await friskt('14.1 V', ['L1', 'L2', 'L3']);
    await overlamna(p, 'L3');
    await ok('tand_scopesignal', { contract_id: p.contractId, fras: 'kan ni även ta' });
    for (const [kod, kallhandelse] of [['L1', TRANSMITTAL('L1')], ['L3', GODKANNANDE('L3', 'Hermes')], ['L3', TRANSMITTAL('L3')]] as const) {
      expect(await rutinOk(p, kod, kallhandelse)).toMatchObject({ utfall: 'falld' });
    }
  });
  const leveranser = async () => huvud(await sida(`${bas(p)}/leveranserna`));

  it('14.1-V1: pågår bär transmittalförslaget förifyllt i överlämningens formulär', async () => {
    const main = await leveranser();
    const k = kort(main, 'L1');
    for (const text of ['Hermes hittade överlämningen i mejlet', 'overlamning-L1@nvr.se', RUTINSKALTEXT.signal_tand,
      '<option value="mejl" selected>']) expect(k).toContain(text);
    expect(k).not.toContain(RUTINSKALTEXT.fel_utgangslage);
    expect(k).toMatch(/<input[^>]*name="handling_id"[^>]*value="overlamning-L1@nvr\.se"/);
    expect(k).toMatch(/<input[^>]*name="handling_kalla"[^>]*value="gmail:locollabs"/);
    expect(k.split(`action="${bas(p)}/statusforslag"`)).toHaveLength(3);
    // Positiv kontroll: ett kort utan förslag är som förut.
    const k2 = kort(main, 'L2');
    expect(k2).not.toContain('Hermes hittade');
    expect(k2).not.toContain('selected');
    expect(k2).toMatch(new RegExp(`<input[^>]*name="handling_kalla"[^>]*value="${user.email.replace(/[.+]/g, '\\$&')}"`));
  });

  it('14.1-V2: levererad bär godkännandeförslaget med kanal och dag, aldrig transmittalförslaget', async () => {
    const k = kort(await leveranser(), 'L3');
    for (const text of ['Hermes hittade ett godkännande från Hermes via Mejl den 2026-09-15', RUTINSKALTEXT.obehorig_godkannare]) {
      expect(k).toContain(text);
    }
    const kanalval = k.match(/<select name="kanal" required>[\s\S]*?<\/select>/)?.[0] ?? '';
    expect(kanalval).toContain('<option value="mejl" selected>');
    expect(k).toMatch(/<input[^>]*name="nar"[^>]*value="2026-09-15"/);
    expect(k).not.toContain('Hermes hittade överlämningen');
  });

  it('14.1-V3: förslaget syns aldrig på förstasidan, i Läget eller i undantagsvyn (regression)', async () => {
    const f = await forslag(p);
    expect(f.map((x) => `${x.leverabel_kod}:${x.kallhandelse.typ}`).sort()).toEqual(['L1:transmittal', 'L3:godkannande', 'L3:transmittal']);
    for (const path of [bas(p), `${bas(p)}/laget`, `/app/c/${companyId}/uppdrag`]) {
      expect(huvud(await sida(path)), path).not.toContain('Hermes hittade');
    }
  });
});

describe('Story 14.1: dokumentationen', () => {
  /** Avsnittet efter rubriken, fram till nästa rubrik på nivå två eller tre (som 4.2-D1). */
  function avsnitt(text: string, rubrik: string) {
    const start = text.indexOf(rubrik);
    expect(start).toBeGreaterThanOrEqual(0);
    return text.slice(start + rubrik.length).split(/\n#{2,3} /)[0]!;
  }
  const normalisera = (s: string) => s.replace(/\s+/g, ' ');
  const RUBRIK = '**Rutinvagen (FR-13, Story 14.1).**';
  function arkitekturbrister(text: string): string[] {
    const stycke = text.split('\n\n').map((s) => s.trim()).find((s) => s.startsWith(RUBRIK));
    if (!stycke) return ['stycket om rutinvägen saknas'];
    const norm = normalisera(stycke);
    const brister = ['server/src/lib/rutinregel.ts', 'registrera_rutinstatus', 'registrerad_av', 'kallhandelse_ref',
      'rutinforslag', 'transmittal', 'godkannande'].filter((n) => !norm.includes(n));
    const hela = normalisera(text);
    for (const n of ['En fjarde, kallbelagd rutinvag', 'FR-13']) if (!hela.includes(n)) brister.push(`«${n}» saknas`);
    const sparrad = text.split('\n').filter((rad) => rad.includes('markta `kravManniska`'))
      .map((rad) => { const i = rad.indexOf('markta `kravManniska`'); return rad.slice(i, rad.indexOf('avvisas', i)); })
      .filter((s) => s.includes('registrera_rutinstatus'));
    if (sparrad.length > 0) brister.push('registrera_rutinstatus står bland de människospärrade');
    return brister;
  }
  it('14.1-D1: arkitekturen beskriver rutinvägen och räknar den aldrig som människospärrad', async () => {
    const text = avsnitt(await readFile(new URL('../../docs/ARKITEKTUR.md', import.meta.url), 'utf8'), '## Uppdragsytan (modul)');
    expect(arkitekturbrister(text)).toEqual([]);
    // Negativ kontroll: rutinvägen inskjuten i uppräkningen av människospärrade åtgärder fälls.
    const planterad = text.replace('markta `kravManniska` (', 'markta `kravManniska` (`registrera_rutinstatus`, ');
    expect(planterad).not.toBe(text);
    expect(arkitekturbrister(planterad)).toEqual(['registrera_rutinstatus står bland de människospärrade']);
  });

  /** Handgrepp-provets mönster: ett ensamt kodspann av gemener med understreck läses som en åtgärd. */
  const ensamma = (text: string) => [...text.matchAll(/`([^`\n]+)`/g)].map((m) => m[1]!)
    .filter((s) => /^[a-z_]+$/.test(s) && s.includes('_'));
  it('14.1-D2: åtgärdsdokumentet har rutinvägen i avsnittet Uppdragsytan utan ensamma kodspann', async () => {
    const doc = await readFile(new URL('../../docs/MCP_ACTIONS.md', import.meta.url), 'utf8');
    const rubrik = '### Rutinvägen (Story 14.1)';
    const uppdrag = doc.indexOf('\n## Uppdragsytan\n');
    const nasta = doc.indexOf('\n## ', uppdrag + 1);
    const start = doc.indexOf(rubrik);
    expect(uppdrag).toBeGreaterThanOrEqual(0);
    expect(start).toBeGreaterThan(uppdrag);
    expect(start).toBeLessThan(nasta);
    const text = avsnitt(doc, rubrik);
    const norm = normalisera(text);
    for (const n of ['registrera_rutinstatus', 'transmittal', 'godkannande', 'rutinforslag']) expect(norm, n).toContain(n);
    expect(ensamma(text)).toEqual([]);
    expect(doc.slice(uppdrag, nasta)).not.toContain('las_faktureringsunderlag');
    // Negativa kontroller och en positiv: samma mönster fäller ett planterat ensamt spann.
    expect(ensamma(`${text}\n- \`registrerad_av\``)).toEqual(['registrerad_av']);
    expect(ensamma(`${text}\n- \`datum_saknas\``)).toEqual(['datum_saknas']);
    expect(ensamma(`${text}\n- \`registrerad_av = 'system'\``)).toEqual([]);
  });
});
