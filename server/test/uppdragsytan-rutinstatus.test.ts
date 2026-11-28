// Story 14.1, FR-13: ett rutinmässigt statusbyte registreras ur sin källhändelse.
// Risken: en maskin flyttar ett läge som kräver Davids omdöme, ett godkännande
// uppfinns, eller en rutinregistrering bär en mänsklig signatur. Regeln prövas
// ren; migrationen, åtgärden och det fällda prövas genom hela stacken mot Postgres.
import { readFile } from 'node:fs/promises';
import { beforeAll, describe, expect, it } from 'vitest';
import { api, createCompany, createFiscalYear, registerUser, withAdmin, type TestUser } from './helpers.js';
import { importeraOchGodkann } from './uppdragImportHelper.js';
import { LEVERANSKONTRAKT_NVR001 } from './fixtures/leveranskontrakt-nvr-001.js';
import { withTenantTransaction } from '../src/db/tx.js';
import { loadMigrations } from '../src/db/migrate.js';
import { skapaReferens } from '../src/services/uppdragReferens.js';
import { upsertSvepvarden } from '../src/services/uppdragSvep.js';
import { getAction } from '../src/actions/registry.js';
import type { Approval } from '../src/services/approvals.js';
import type { Leverabelrad } from '../src/services/uppdragRegister.js';
import {
  KALLHANDELSETYPER, OVERGANGAR, RUTINSKAL, RUTINSKALTEXT, provaRutinhandelse, type Rutinindata,
} from '../src/lib/rutinregel.js';

const LAGEN = ['ej_paborjad', 'pagar', 'levererad', 'godkand', 'avvisad'] as const;
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
async function register(a: Avtal): Promise<Leverabelrad[]> {
  const res = await act('las_leverabelregister', { contract_id: a.contractId });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.result as Leverabelrad[];
}
async function svepcache(a: Avtal) {
  return withAdmin(async (c) => (await c.query('SELECT nyckel, varde FROM uppdrag_svepvarde WHERE company_id=$1 AND contract_id=$2 ORDER BY nyckel', [companyId, a.contractId])).rows);
}
async function koposter() {
  return withAdmin(async (c) => (await c.query('SELECT count(*)::int AS n FROM action_approvals WHERE company_id=$1', [companyId])).rows[0].n as number);
}
const TROSKLAR = { procent: 5, golv_ore: 0, golv_timmar: 0, dagar: 5 };
async function indikator(a: Avtal, larm: unknown[]) {
  await withTenantTransaction(user.userId, companyId, (c) => upsertSvepvarden(c, companyId, a.contractId,
    [{ nyckel: 'troskellarm', kalla: 'redovisning', varde: { trosklar: TROSKLAR, larm, utan_egen_ram: [] } }]));
}
const friskIndikator = (a: Avtal) => indikator(a, []);
const tandIndikator = (a: Avtal, kod: string) => indikator(a, [{ ram: 'dagar', kod, slutdatum: '2026-09-13', precision: null,
  arvt_fran: null, forsening_dagar: 10, troskel_dagar: 5 }]);
async function foralder(a: Avtal, kod: string): Promise<string> {
  return withAdmin(async (c) => (await c.query(`SELECT f.code FROM contract_parts p
    JOIN contract_parts f ON f.id=p.parent_part_id AND f.company_id=p.company_id
    WHERE p.company_id=$1 AND p.contract_id=$2 AND p.code=$3 ORDER BY p.valid_from DESC LIMIT 1`, [companyId, a.contractId, kod])).rows[0]?.code ?? '');
}
async function undantag(): Promise<string[]> {
  const res = await act('las_undantag', {});
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return (res.body.result.poster as { slag: string; id: string }[]).map((p) => `${p.slag}:${p.id}`).sort();
}
// Sakläget före och efter ett fällt anrop: det fällda får inte ändra något av det här.
async function ofort(a: Avtal) {
  return { statusar: await statusar(a), handelser: await handelser(a), referenser: await referenser(a),
    svepcache: await svepcache(a), koposter: await koposter(), undantag: await undantag() };
}
const TRANSMITTAL = (kod: string) => ({ typ: 'transmittal', handling: { sort: 'mejl', extern_id: `<overlamning-${kod}@nvr.se>`, extern_kalla: 'gmail:locollabs' },
  handelse_datum: '2026-09-12' });
const GODKANNANDE = (kod: string, godkand_av: string) => ({ typ: 'godkannande', handling: { sort: 'mejl', extern_id: `<godkant-${kod}@nvr.se>`, extern_kalla: 'gmail:locollabs' },
  handelse_datum: '2026-09-15', godkand_av, kanal: 'mejl' });
const rutin = (a: Avtal, kod: string, kallhandelse: Record<string, unknown>) =>
  agent('registrera_rutinstatus', { contract_id: a.contractId, leverabel_kod: kod, kallhandelse });
const overlamna = (a: Avtal, kod: string) =>
  ok('bekrafta_statusbyte', { ...indata(a, kod), utfall: 'bekraftad', handling: TRANSMITTAL(kod).handling });
beforeAll(async () => {
  user = await registerUser('rutinstatus');
  companyId = await createCompany(user.token, 'Rutinstatus AB');
  await createFiscalYear(companyId, auth(), { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });
  const tok = await api.post(`${co()}/agent-tokens`).set(auth()).send({ name: 'Rutinstatusprov' });
  expect(tok.status, JSON.stringify(tok.body)).toBe(201);
  agentToken = tok.body.token;
});

describe('Story 14.1: rutinregeln (ren)', () => {
  const NVR = { godkannare: 'Styrgruppen', godkannare_eskalering: 'Eva Larsson (VD)' };
  const KEDJA = ['L1', 'STEG1', 'ROT'];
  const bas: Omit<Rutinindata, 'typ'> = { status: 'pagar', oppna_signaler: 0, larmkoder: [], leverabelkedja: KEDJA, parter: NVR };
  const transmittal = (x: Partial<Rutinindata> = {}): Rutinindata => ({ ...bas, typ: 'transmittal', ...x });
  const godkannande = (godkand_av: string, x: Partial<Rutinindata> = {}): Rutinindata =>
    ({ ...bas, typ: 'godkannande', status: 'levererad', godkand_av, ...x });

  it('14.1-R1: fyra steg i flödets ordning, och källhändelserna når bara leveransen och godkännandet', () => {
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
      for (const indata of [transmittal({ status }), godkannande('Styrgruppen', { status })]) {
        const u = provaRutinhandelse(indata);
        if (u.medges) medgivna.add(`${u.fran}>${u.till}`);
      }
    }
    expect(medgivna.size).toBeGreaterThan(0);
    for (const par of medgivna) expect(['pagar>levererad', 'levererad>godkand']).toContain(par);
  });

  it('14.1-R2: transmittalen medges från pågår till levererad med avtalets godkännare som mottagare', () => {
    expect(provaRutinhandelse(transmittal())).toEqual({ medges: true, fran: 'pagar', till: 'levererad', mottagare: 'Styrgruppen' });
  });

  it('14.1-R3: bara avtalets godkännare eller eskalering, exakt efter normalisering, godkänner', () => {
    const medgiven = { medges: true, fran: 'levererad', till: 'godkand', mottagare: 'Styrgruppen' };
    expect(provaRutinhandelse(godkannande('Styrgruppen'))).toEqual(medgiven);
    expect(provaRutinhandelse(godkannande('  eva   larsson (vd) '))).toEqual(medgiven);
    for (const avsandare of ['Eva Larsson', 'Hermes']) {
      expect(provaRutinhandelse(godkannande(avsandare))).toEqual({ medges: false, skal: ['obehorig_godkannare'] });
    }
    expect(provaRutinhandelse(godkannande('Styrgruppen', { parter: { godkannare: null, godkannare_eskalering: null } })))
      .toEqual({ medges: false, skal: ['saknad_mottagare', 'obehorig_godkannare'] });
  });

  it('14.1-R4: en öppen scopesignal fäller båda källhändelserna', () => {
    expect(provaRutinhandelse(transmittal({ oppna_signaler: 1 }))).toEqual({ medges: false, skal: ['signal_tand'] });
    expect(provaRutinhandelse(godkannande('Styrgruppen', { oppna_signaler: 1 }))).toEqual({ medges: false, skal: ['signal_tand'] });
  });

  it('14.1-R5: ett larm på leverabeln eller en nivå över den fäller, ett oläst larmutfall fäller', () => {
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

  it('14.1-R7: utan avtalets godkännare fälls båda, också ett behörigt godkännande från eskaleringen', () => {
    const parter = { godkannare: null, godkannare_eskalering: 'Eva Larsson (VD)' };
    expect(provaRutinhandelse(transmittal({ parter }))).toEqual({ medges: false, skal: ['saknad_mottagare'] });
    expect(provaRutinhandelse(godkannande('Eva Larsson (VD)', { parter }))).toEqual({ medges: false, skal: ['saknad_mottagare'] });
    expect(provaRutinhandelse(transmittal({ parter: { godkannare: '   ', godkannare_eskalering: null } })))
      .toEqual({ medges: false, skal: ['saknad_mottagare'] });
  });

  it('14.1-R8: alla skäl i listans ordning, en text per skäl, och funktionen är ren', () => {
    expect(provaRutinhandelse(transmittal({ status: 'ej_paborjad', oppna_signaler: 2, larmkoder: null })))
      .toEqual({ medges: false, skal: ['fel_utgangslage', 'signal_tand', 'indikator_olast'] });
    expect(new Set(Object.keys(RUTINSKALTEXT))).toEqual(new Set(RUTINSKAL));
    for (const text of Object.values(RUTINSKALTEXT)) {
      expect(text.trim().length).toBeGreaterThan(0);
      expect(text).not.toContain('%');
    }
    const fryst = transmittal({ leverabelkedja: [...KEDJA], larmkoder: ['L2'], parter: { ...NVR } });
    Object.freeze(fryst.leverabelkedja); Object.freeze(fryst.larmkoder); Object.freeze(fryst.parter); Object.freeze(fryst);
    const forsta = provaRutinhandelse(fryst);
    expect(provaRutinhandelse(fryst)).toEqual(forsta);
    expect(forsta.medges).toBe(true);
  });
});

describe('Story 14.1: migrationen', () => {
  let a: Avtal;
  let referensId: string;
  const MIGRATIONENS_VILLKOR = [
    'uppdrag_leverabel_handelse_registrerad_av_check', 'uppdrag_leverabel_handelse_kallhandelse_typ_check',
    'uppdrag_leverabel_handelse_kallhandelse_aktor_check', 'uppdrag_leverabel_handelse_registrering_check',
  ];
  type Rad = {
    kod?: string; registrerad_av?: string; bekraftat_av?: string | null; typ?: string | null;
    ref?: string | null; aktor?: string | null; referens_id?: string | null;
  };
  // En rad direkt i tabellen som ägarrollen: villkoret gäller också förbi tjänstelagret.
  const infoga = (r: Rad) => withAdmin((c) => c.query(`INSERT INTO uppdrag_leverabel_handelse
    (company_id, contract_id, leverabel_id, fran, till, registrerad_av, bekraftat_av,
     kallhandelse_typ, kallhandelse_ref, kallhandelse_aktor, referens_id)
    SELECT company_id, contract_id, id, 'pagar', 'levererad', $3, $4, $5, $6, $7, $8
      FROM uppdrag_leverabel WHERE company_id=$1 AND contract_id=$2 AND kod=$9`,
  [companyId, a.contractId, r.registrerad_av ?? 'manniska', r.bekraftat_av ?? null, r.typ ?? null,
    r.ref ?? null, r.aktor ?? null, r.referens_id ?? null, r.kod ?? 'L1']));
  beforeAll(async () => {
    a = await nyttAvtal('14.1 M');
    await paborja(a, 'L1'); await paborja(a, 'L2');
    referensId = (await withTenantTransaction(user.userId, companyId, (c) => skapaReferens(c, companyId, {
      contract_id: a.contractId, sort: 'mejl', extern_id: '<m-14-1@nvr.se>', extern_kalla: 'gmail:locollabs', extern_nyckel: 'rfc822#message-id',
    }))).id;
  });

  it('14.1-M1: fyra kolumner, fyra villkor och ett unikt index, idempotent och med sann kolumnkommentar', async () => {
    const migration = (await loadMigrations()).find((m) => m.name === 'rutinstatus');
    expect(migration).toBeDefined();
    await withAdmin(async (c) => {
      await c.query(migration!.sql); await c.query(migration!.sql);
      const kolumner = await c.query(`SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns
        WHERE table_name='uppdrag_leverabel_handelse' AND column_name = ANY($1::text[]) ORDER BY column_name`,
      [['registrerad_av', 'kallhandelse_typ', 'kallhandelse_ref', 'kallhandelse_aktor']]);
      expect(kolumner.rows.map((r) => [r.column_name, r.data_type, r.is_nullable])).toEqual([
        ['kallhandelse_aktor', 'text', 'YES'], ['kallhandelse_ref', 'text', 'YES'],
        ['kallhandelse_typ', 'text', 'YES'], ['registrerad_av', 'text', 'NO'],
      ]);
      expect(kolumner.rows.find((r) => r.column_name === 'registrerad_av')!.column_default).toContain('manniska');
      const villkor = await c.query('SELECT conname FROM pg_constraint WHERE conname = ANY($1::text[]) ORDER BY conname', [MIGRATIONENS_VILLKOR]);
      expect(villkor.rows.map((r) => r.conname)).toEqual([...MIGRATIONENS_VILLKOR].sort());
      const index = await c.query("SELECT indexdef FROM pg_indexes WHERE indexname='uppdrag_leverabel_handelse_kallhandelse_uk'");
      expect(index.rows).toHaveLength(1);
      expect(index.rows[0].indexdef).toContain('UNIQUE');
      expect(index.rows[0].indexdef).toContain('leverabel_id, kallhandelse_typ, kallhandelse_ref');
      // Läses efter de två körningarna: 4.2-S1 kör 0099 två gånger och lägger då
      // tillbaka 0099:s text, och filernas ordning i sviten är inte given.
      const kommentar = (await c.query(`SELECT col_description('uppdrag_leverabel_handelse'::regclass, a.attnum) AS k
        FROM pg_attribute a WHERE a.attrelid='uppdrag_leverabel_handelse'::regclass AND a.attname='referens_id'`)).rows[0].k as string;
      expect(kommentar.startsWith('Handlingen som överlämningen eller returen registrerades ur, som rad i uppdrag_referens.')).toBe(true);
      expect(kommentar).toContain('källhändelse');
    });
  });

  it('14.1-M2: elva otillåtna radformer fälls, de fyra tillåtna går igenom', async () => {
    const fore = await handelser(a);
    const system = { registrerad_av: 'system', typ: 'transmittal', ref: 'mejl:m2-system@nvr.se', referens_id: referensId };
    const manniska = { registrerad_av: 'manniska', bekraftat_av: user.userId };
    const otillatna: Record<string, Rad> = {
      a: { registrerad_av: 'manniska' },
      b: { ...system, bekraftat_av: user.userId },
      c: { ...system, typ: null },
      d: { ...system, ref: null },
      e: { ...system, referens_id: null },
      f: { ...manniska, typ: 'transmittal', referens_id: referensId },
      g: { ...manniska, typ: 'transmittal', ref: 'mejl:m2-g@nvr.se' },
      h: { registrerad_av: 'agent', bekraftat_av: user.userId },
      i: { ...system, typ: 'retur' },
      j: { ...system, typ: 'godkannande' },
      k: { ...system, aktor: 'Eva Larsson (VD)' },
    };
    for (const [fall, rad] of Object.entries(otillatna)) {
      await expect(infoga(rad), `(${fall})`).rejects.toMatchObject({ code: '23514' });
    }
    expect(await handelser(a)).toEqual(fore);
    for (const rad of [
      manniska,
      { ...manniska, referens_id: referensId },
      { ...manniska, typ: 'godkannande', ref: 'mejl:m2-ja@nvr.se', aktor: 'Eva Larsson (VD)', referens_id: referensId },
      system,
    ]) expect((await infoga(rad)).rowCount).toBe(1);
    const l1 = (await handelser(a)).filter((h) => h.kod === 'L1');
    expect(l1).toHaveLength(5);
    expect(l1.filter((h) => h.registrerad_av === 'system')).toEqual([
      expect.objectContaining({ bekraftat_av: null, kallhandelse_typ: 'transmittal', kallhandelse_ref: 'mejl:m2-system@nvr.se', referens_id: referensId }),
    ]);
  });

  it('14.1-M3: samma källhändelse registreras aldrig två gånger för samma leverabel', async () => {
    const rad = { registrerad_av: 'system', typ: 'transmittal', ref: 'mejl:m3@nvr.se', referens_id: referensId };
    expect((await infoga(rad)).rowCount).toBe(1);
    await expect(infoga(rad)).rejects.toMatchObject({ code: '23505' });
    expect((await infoga({ ...rad, kod: 'L2' })).rowCount).toBe(1);
  });
});

describe('Story 14.1: rutinvägen', () => {
  async function avtalMedFriskIndikator(namn: string) {
    const a = await nyttAvtal(namn);
    await friskIndikator(a);
    return a;
  }

  it('14.1-A1: transmittalen registreras utan fråga, med handlingen och utan mänsklig signatur', async () => {
    const a = await avtalMedFriskIndikator('14.1 A1'); await paborja(a, 'L1');
    const antal = () => withAdmin(async (c) => (await c.query(`SELECT
      (SELECT count(*)::int FROM action_approvals WHERE company_id=$1) AS approvals,
      (SELECT count(*)::int FROM uppdrag_beslut WHERE company_id=$1 AND contract_id=$2) AS beslut`, [companyId, a.contractId])).rows[0]);
    const fore = await antal(); const poster = await undantag(); const ko = await godkannanden();
    const ids = new Set((await referenser(a)).map((r) => r.id));
    expect(ko.length).toBeGreaterThan(0);
    const res = await rutin(a, 'L1', TRANSMITTAL('L1'));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const r = res.body.result;
    expect(r).toMatchObject({
      utfall: 'registrerad', leverabel_kod: 'L1', fran: 'pagar', status: 'levererad', revision: 1, mottagare: 'Styrgruppen',
      registrerad_av: 'system', kallhandelse_typ: 'transmittal', kallhandelse_ref: 'mejl:overlamning-L1@nvr.se',
      kallhandelse_aktor: null, referens_id: expect.any(String),
    });
    const h = (await handelser(a)).find((x) => x.id === r.handelse_id);
    expect(h).toMatchObject({
      registrerad_av: 'system', bekraftat_av: null, kallhandelse_typ: 'transmittal', kallhandelse_ref: 'mejl:overlamning-L1@nvr.se',
      referens_id: r.referens_id, dag: '2026-09-12', kanal: null, notering: null, kallhandelse_aktor: null, mottagare: 'Styrgruppen', revision: 1,
    });
    expect(await referens(r.referens_id)).toMatchObject({ sort: 'mejl', extern_id: 'overlamning-L1@nvr.se', extern_nyckel: 'rfc822#message-id', extern_kalla: 'gmail:locollabs' });
    expect(await antal()).toEqual(fore);
    expect(await undantag()).toEqual(poster);
    expect(await godkannanden()).toEqual(ko);
    expect(await audit()).toContainEqual(expect.objectContaining({
      action: 'action.executed', entity_id: 'registrera_rutinstatus', details: expect.objectContaining({ actor: 'agent' }),
    }));
    const nya = (await referenser(a)).filter((x) => !ids.has(x.id));
    expect(nya).toContainEqual(expect.objectContaining({ extern_nyckel: 'registerkopia', ko_status: 'koad' }));
    expect((await register(a)).find((x) => x.kod === 'L1')).toMatchObject({ status: 'levererad', revision: 1, mottagare: 'Styrgruppen' });
    // Append-only i samma form som schemaprovet: en rutinrad går lika lite att skriva om.
    await expect(withTenantTransaction(user.userId, companyId, (c) => c.query(
      "UPDATE uppdrag_leverabel_handelse SET registrerad_av = 'manniska' WHERE id = $1 AND company_id = $2", [r.handelse_id, companyId],
    ))).rejects.toThrow(/permission denied/);
    await expect(withTenantTransaction(user.userId, companyId, (c) => c.query(
      'DELETE FROM uppdrag_leverabel_handelse WHERE id = $1 AND company_id = $2', [r.handelse_id, companyId],
    ))).rejects.toThrow(/permission denied/);
    expect((await handelser(a)).find((x) => x.id === r.handelse_id)).toEqual(h);
  });

  it('14.1-A2: godkännandet bär avsändaren som källuppgift och avtalets godkännare som mottagare', async () => {
    const a = await avtalMedFriskIndikator('14.1 A2'); await paborja(a, 'L2');
    const over = await overlamna(a, 'L2');
    const res = await rutin(a, 'L2', GODKANNANDE('L2', 'Eva Larsson (VD)'));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const r = res.body.result;
    expect(r).toMatchObject({ utfall: 'registrerad', status: 'godkand', revision: null, mottagare: 'Styrgruppen', kallhandelse_aktor: 'Eva Larsson (VD)' });
    const alla = await handelser(a);
    expect(alla.find((x) => x.id === r.handelse_id)).toMatchObject({
      registrerad_av: 'system', bekraftat_av: null, mottagare: 'Styrgruppen', kallhandelse_aktor: 'Eva Larsson (VD)',
      kanal: 'mejl', dag: '2026-09-15', referens_id: expect.any(String), kallhandelse_typ: 'godkannande',
    });
    expect(alla.find((x) => x.id === over.handelse_id)).toMatchObject({ registrerad_av: 'manniska', bekraftat_av: user.userId });
    expect((await register(a)).find((x) => x.kod === 'L2')).toMatchObject({ status: 'godkand', revision: 1, mottagare: 'Styrgruppen' });
  });

  it('14.1-A3: åtgärden tar aldrig emot ett målläge eller en källhändelse utanför listan', async () => {
    const a = await avtalMedFriskIndikator('14.1 A3'); await paborja(a, 'L1');
    const fore = await handelser(a); const refs = await referenser(a);
    const bas = { contract_id: a.contractId, leverabel_kod: 'L1', kallhandelse: TRANSMITTAL('L1') };
    for (const kropp of [
      {},
      { ...bas, till: 'levererad' },
      { ...bas, status: 'godkand' },
      { ...bas, kallhandelse: { ...TRANSMITTAL('L1'), typ: 'paborjande' } },
      { ...bas, kallhandelse: { ...TRANSMITTAL('L1'), typ: 'retur' } },
      { ...bas, kallhandelse: { ...TRANSMITTAL('L1'), handling: { ...TRANSMITTAL('L1').handling, extern_id: 'https://mail.google.com/x' } } },
    ]) {
      const res = await agent('registrera_rutinstatus', kropp);
      expect(res.status, JSON.stringify(res.body)).toBe(400);
      expect(res.body.error).toBe('validation_error');
    }
    expect(await handelser(a)).toEqual(fore);
    expect(fore).toHaveLength(1);
    expect(await statusar(a)).toContainEqual({ kod: 'L1', status: 'pagar' });
    expect(await referenser(a)).toEqual(refs);
  });

  it('14.1-A4: samma källhändelse registreras bara en gång', async () => {
    const a = await avtalMedFriskIndikator('14.1 A4'); await paborja(a, 'L1'); await paborja(a, 'L2');
    for (const [kod, kallhandelse, status] of [['L1', TRANSMITTAL('L1'), 'levererad'], ['L2', GODKANNANDE('L2', 'Eva Larsson (VD)'), 'godkand']] as const) {
      if (kod === 'L2') await overlamna(a, 'L2');
      const forsta = await rutin(a, kod, kallhandelse);
      expect(forsta.status, JSON.stringify(forsta.body)).toBe(200);
      expect(forsta.body.result.utfall).toBe('registrerad');
      const refs = await referenser(a);
      const igen = await rutin(a, kod, kallhandelse);
      expect(igen.status, JSON.stringify(igen.body)).toBe(200);
      expect(igen.body.result).toEqual({ utfall: 'redan_registrerad', handelse_id: forsta.body.result.handelse_id, leverabel_kod: kod, status });
      expect((await handelser(a)).filter((h) => h.kallhandelse_ref === forsta.body.result.kallhandelse_ref)).toHaveLength(1);
      expect(await referenser(a)).toEqual(refs);
    }
  });

  it('14.1-A5: datumfönstret är människovägens', async () => {
    const a = await avtalMedFriskIndikator('14.1 A5'); await paborja(a, 'L1');
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
    const granne = await registerUser('rutinstatus-granne');
    const grannbolag = await createCompany(granne.token, 'Grannbolaget AB');
    const h2 = { Authorization: `Bearer ${granne.token}` };
    const ok2 = async (namn: string, kropp: Record<string, unknown>) => {
      const res = await api.post(`/api/companies/${grannbolag}/actions/${namn}`).set(h2).send(kropp);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      return res.body.result as Record<string, unknown>;
    };
    await createFiscalYear(grannbolag, h2, { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });
    const projectId = (await ok2('create_project', { name: '14.1 A6 granne' })).id as string;
    const contractId = (await ok2('skapa_uppdrag', { project_id: projectId, name: '14.1 A6 granne', signed_date: '2026-09-03' })).contract_id as string;
    await importeraOchGodkann(grannbolag, h2, { contract_id: contractId, kontraktstext: LEVERANSKONTRAKT_NVR001 });
    await ok2('paborja_leverabel', { contract_id: contractId, leverabel_kod: 'L1' });
    const grannlage = () => withAdmin(async (c) => ({
      handelser: (await c.query('SELECT * FROM uppdrag_leverabel_handelse WHERE company_id=$1 AND contract_id=$2 ORDER BY id', [grannbolag, contractId])).rows,
      referenser: (await c.query('SELECT * FROM uppdrag_referens WHERE company_id=$1 AND contract_id=$2 ORDER BY id', [grannbolag, contractId])).rows,
      svepcache: (await c.query('SELECT nyckel, varde FROM uppdrag_svepvarde WHERE company_id=$1 AND contract_id=$2 ORDER BY nyckel', [grannbolag, contractId])).rows,
    }));
    const egen = await avtalMedFriskIndikator('14.1 A6'); await paborja(egen, 'L1');
    const grannFore = await grannlage(); const egenFore = await ofort(egen);
    expect(grannFore.handelser).toHaveLength(1);
    const frammande = await rutin({ projectId, contractId }, 'L1', TRANSMITTAL('L1'));
    expect(frammande.status, JSON.stringify(frammande.body)).toBe(404);
    const okand = await rutin(egen, 'L99', TRANSMITTAL('L99'));
    expect(okand.status, JSON.stringify(okand.body)).toBe(404);
    expect(await grannlage()).toEqual(grannFore);
    expect(await ofort(egen)).toEqual(egenFore);
    // Positiv kontroll: 404 kom ur leverabelns uppslag, inte ur en saknad åtgärd.
    const egenRutin = await rutin(egen, 'L1', TRANSMITTAL('L1'));
    expect(egenRutin.status, JSON.stringify(egenRutin.body)).toBe(200);
    expect(egenRutin.body.result.utfall).toBe('registrerad');
  });

  it('14.1-A7: de tre människospärrarna står kvar, och rutinvägen är en write utan spärr', async () => {
    const a = await avtalMedFriskIndikator('14.1 A7'); await paborja(a, 'L2'); await paborja(a, 'L4');
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
    const rutinvag = getAction('registrera_rutinstatus');
    expect(rutinvag).toBeDefined();
    expect(rutinvag!.sensitivity).toBe('write');
    expect(rutinvag!.kravManniska ?? false).toBe(false);
    expect(rutinvag!.koasForAgent ?? false).toBe(false);
    expect((rutinvag!.description ?? '').trim().length).toBeGreaterThan(0);
    const over = await overlamna(a, 'L4');
    expect((await handelser(a)).find((h) => h.id === over.handelse_id)).toMatchObject({
      registrerad_av: 'manniska', bekraftat_av: user.userId, kallhandelse_typ: null, kallhandelse_ref: null,
    });
  });
});

describe('Story 14.1: det fällda ändrar ingenting', () => {
  it('14.1-F1: en obesvarad scopesignal fäller tills David avgjort den', async () => {
    const a = await nyttAvtal('14.1 F1'); await friskIndikator(a); await paborja(a, 'L1');
    const signal = await ok('tand_scopesignal', { contract_id: a.contractId, fras: 'kan ni även ta' });
    const fore = await ofort(a); const ko = await godkannanden();
    expect(ko.length).toBeGreaterThan(0);
    const res = await rutin(a, 'L1', TRANSMITTAL('L1'));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const regeln = provaRutinhandelse({ typ: 'transmittal', status: 'pagar', oppna_signaler: 1, larmkoder: [], leverabelkedja: ['L1'], parter: PARTER });
    expect(regeln).toEqual({ medges: false, skal: ['signal_tand'] });
    expect(res.body.result).toEqual({ utfall: 'falld', leverabel_kod: 'L1', status: 'pagar', skal: ['signal_tand'] });
    expect(await ofort(a)).toEqual(fore);
    expect(await godkannanden()).toEqual(ko);
    await ok('avgor_scopesignal', { signal_id: signal.id, avgjord: 'innanfor' });
    const igen = await rutin(a, 'L1', TRANSMITTAL('L1'));
    expect(igen.status, JSON.stringify(igen.body)).toBe(200);
    expect(igen.body.result).toMatchObject({ utfall: 'registrerad', status: 'levererad' });
  });

  it('14.1-F2: indikatorn fäller för leverabeln och varje nivå över den, och en oläst indikator fäller', async () => {
    const [a, b, c, d] = [await nyttAvtal('14.1 F2 a'), await nyttAvtal('14.1 F2 b'), await nyttAvtal('14.1 F2 c'), await nyttAvtal('14.1 F2 d')];
    for (const x of [a, b, c, d]) await paborja(x, 'L1');
    await tandIndikator(a, 'L1');
    let fore = await ofort(a);
    let res = await rutin(a, 'L1', TRANSMITTAL('L1'));
    expect(res.body.result, JSON.stringify(res.body)).toEqual({ utfall: 'falld', leverabel_kod: 'L1', status: 'pagar', skal: ['indikator_tand'] });
    expect(await ofort(a)).toEqual(fore);
    await tandIndikator(b, 'L2');
    res = await rutin(b, 'L1', TRANSMITTAL('L1'));
    expect(res.body.result, JSON.stringify(res.body)).toMatchObject({ utfall: 'registrerad', status: 'levererad' });
    fore = await ofort(c);
    expect(fore.svepcache.filter((r) => r.nyckel === 'troskellarm')).toEqual([]);
    res = await rutin(c, 'L1', TRANSMITTAL('L1'));
    expect(res.body.result, JSON.stringify(res.body)).toEqual({ utfall: 'falld', leverabel_kod: 'L1', status: 'pagar', skal: ['indikator_olast'] });
    expect(await ofort(c)).toEqual(fore);
    const niva = await foralder(d, 'L1');
    expect(niva).not.toBe('L1'); expect(niva).not.toBe('');
    for (const kod of [niva, 'UPPDRAG']) {
      await tandIndikator(d, kod);
      fore = await ofort(d);
      res = await rutin(d, 'L1', TRANSMITTAL('L1'));
      expect(res.body.result, `${kod}: ${JSON.stringify(res.body)}`).toEqual({ utfall: 'falld', leverabel_kod: 'L1', status: 'pagar', skal: ['indikator_tand'] });
      expect(await ofort(d)).toEqual(fore);
    }
  });

  it('14.1-F3: ett godkännande från en obehörig avsändare ändrar ingenting', async () => {
    const a = await nyttAvtal('14.1 F3'); await friskIndikator(a); await paborja(a, 'L1'); await overlamna(a, 'L1');
    const fore = await ofort(a);
    const res = await rutin(a, 'L1', GODKANNANDE('L1', 'Hermes'));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.result).toEqual({ utfall: 'falld', leverabel_kod: 'L1', status: 'levererad', skal: ['obehorig_godkannare'] });
    const efter = await ofort(a);
    expect(efter).toEqual(fore);
    expect(efter.statusar).toContainEqual({ kod: 'L1', status: 'levererad' });
    expect(efter.handelser.filter((h) => h.till === 'godkand')).toEqual([]);
    expect(efter.referenser.filter((r) => r.extern_id === 'godkant-L1@nvr.se')).toEqual([]);
    const behorig = await rutin(a, 'L1', GODKANNANDE('L1', 'Styrgruppen'));
    expect(behorig.body.result, JSON.stringify(behorig.body)).toMatchObject({ utfall: 'registrerad', status: 'godkand' });
  });

  it('14.1-F5: ett påbörjande tas aldrig av rutinvägen', async () => {
    const a = await nyttAvtal('14.1 F5'); await friskIndikator(a);
    const fore = await ofort(a);
    expect(fore.statusar).toContainEqual({ kod: 'L3', status: 'ej_paborjad' });
    const res = await rutin(a, 'L3', TRANSMITTAL('L3'));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.result).toEqual({ utfall: 'falld', leverabel_kod: 'L3', status: 'ej_paborjad', skal: ['fel_utgangslage'] });
    expect(await ofort(a)).toEqual(fore);
    expect(fore.handelser.filter((h) => h.kod === 'L3')).toEqual([]);
  });
});

describe('Story 14.1: dokumentationen', () => {
  // 4.2-D1:s läsare: slutar vid nästa rubrik på nivå två eller tre.
  function avsnitt(text: string, rubrik: string) {
    const start = text.indexOf(rubrik);
    expect(start).toBeGreaterThanOrEqual(0);
    return text.slice(start + rubrik.length).split(/\n#{2,3} /)[0]!;
  }
  // 4.4-D1:s läsare: slutar först vid nästa rubrik på nivå två.
  function modulavsnitt(text: string, rubrik: string, slut: RegExp): string {
    const start = text.indexOf(rubrik);
    expect(start).toBeGreaterThanOrEqual(0);
    const resten = text.slice(start + rubrik.length);
    const end = resten.search(slut);
    return rubrik + (end === -1 ? resten : resten.slice(0, end));
  }
  const normalisera = (text: string) => text.replace(/\s+/g, ' ');
  const SPARRADE = ['paborja_leverabel', 'bekrafta_statusbyte', 'godkann_leverabel'];
  const SPARRLISTANS_START = 'markta `kravManniska`';
  // Texten från «markta `kravManniska`» till «avvisas» på raden som bär den.
  function sparrlistan(text: string): string | null {
    const rad = text.split('\n').find((r) => r.includes(SPARRLISTANS_START));
    if (!rad) return null;
    const start = rad.indexOf(SPARRLISTANS_START);
    const slut = rad.indexOf('avvisas', start);
    return slut === -1 ? null : rad.slice(start, slut);
  }
  function arkitekturHaller(text: string) {
    const norm = normalisera(text);
    const lista = sparrlistan(text);
    return text.split('\n').some((rad) => rad.startsWith('**Rutinvagen (FR-13, Story 14.1).**'))
      && ['server/src/lib/rutinregel.ts', 'registrera_rutinstatus', 'registrerad_av', 'kallhandelse_ref', 'kallhandelse_aktor',
        'falld', 'transmittal', 'godkannande', 'Story 14.4', 'En fjarde, kallbelagd rutinvag', 'FR-13'].every((n) => norm.includes(n))
      && lista !== null && !lista.includes('registrera_rutinstatus') && SPARRADE.every((n) => lista.includes(n));
  }

  it('14.1-D1: arkitekturen beskriver rutinvägen, och spärrlistan står kvar utan den', async () => {
    const text = avsnitt(await readFile(new URL('../../docs/ARKITEKTUR.md', import.meta.url), 'utf8'), '## Uppdragsytan (modul)');
    expect(arkitekturHaller(text)).toBe(true);
    const lista = sparrlistan(text)!;
    const inskjuten = text.replace(SPARRLISTANS_START + ' (', `${SPARRLISTANS_START} (\`registrera_rutinstatus\`, `);
    expect(arkitekturHaller(inskjuten)).toBe(false);
    const utan = text.replace(lista, lista.replaceAll('godkann_leverabel', ''));
    expect(arkitekturHaller(utan)).toBe(false);
  });

  // Handgrepp-provets mönster: ett ensamt kodspann av gemener med understreck.
  const ensammaSpann = (text: string) => [...text.matchAll(/`([^`\n]+)`/g)].map((m) => m[1]!)
    .filter((s) => /^[a-z_]+$/.test(s) && s.includes('_'));

  it('14.1-D2: åtgärdsdokumentationen har rutinvägen i modulens avsnitt utan ensamma kodspann', async () => {
    const docs = await readFile(new URL('../../docs/MCP_ACTIONS.md', import.meta.url), 'utf8');
    const modul = modulavsnitt(docs, '## Uppdragsytan', /^## /m);
    expect(modul).toContain('### Rutinvägen (Story 14.1)');
    const text = avsnitt(docs, '### Rutinvägen (Story 14.1)');
    const norm = normalisera(text);
    for (const n of ['registrera_rutinstatus', 'kallhandelse_aktor', 'transmittal', 'godkannande', 'falld', 'Story 14.4']) expect(norm).toContain(n);
    expect(ensammaSpann(text)).toEqual([]);
    expect(ensammaSpann(`${text}\n- Kolumnen \`registrerad_av\``)).toEqual(['registrerad_av']);
    expect(ensammaSpann(`${text}\n- Läget \`datum_saknas\``)).toEqual(['datum_saknas']);
    expect(ensammaSpann(`${text}\n- \`registrerad_av = 'system'\``)).toEqual([]);
    expect(modul.includes('las_faktureringsunderlag')).toBe(false);
  });
});
