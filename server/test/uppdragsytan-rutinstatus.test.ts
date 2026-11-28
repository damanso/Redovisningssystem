// Story 14.1 (FR-13, FR-12, NFR-4): ett rutinmässigt statusbyte registreras ur
// sin källhändelse utan fråga. Risken: en maskin flyttar ett läge som kräver
// Davids omdöme, ett godkännande uppfinns, eller en rutinregistrering bär en
// mänsklig signatur. Regeln prövas ren; migrationen, åtgärden och den fällda
// grenen prövas mot Postgres genom hela stacken, med före och efter.
import { readFile } from 'node:fs/promises';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  KALLHANDELSETYPER, OVERGANGAR, RUTINSKAL, RUTINSKALTEXT, provaRutinhandelse, type Rutinindata,
} from '../src/lib/rutinregel.js';
import { api, createCompany, createFiscalYear, registerUser, withAdmin, type TestUser } from './helpers.js';
import { importeraOchGodkann } from './uppdragImportHelper.js';
import { LEVERANSKONTRAKT_NVR001 } from './fixtures/leveranskontrakt-nvr-001.js';
import { withTenantTransaction } from '../src/db/tx.js';
import { loadMigrations } from '../src/db/migrate.js';
import { skapaReferens } from '../src/services/uppdragReferens.js';
import { upsertSvepvarden } from '../src/services/uppdragSvep.js';
import { getAction } from '../src/actions/registry.js';

// ---------------------------------------------------------------------------
// Riggen: egna kopior av 4.2-provets hjälpare, aldrig importerade ur en annan provfil.
// ---------------------------------------------------------------------------

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
// `h.*` bär också registrerad_av, bekraftat_av och de tre källhändelsekolumnerna.
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
async function audit() {
  const res = await api.get(`${co()}/audit`).set(auth());
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.entries as Array<{ action: string; entity_id: string; details: { actor?: string } }>;
}
async function godkannanden() {
  const res = await api.get(`${co()}/approvals`).set(auth());
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.approvals as unknown[];
}
async function register(a: Avtal) {
  return ok<Array<{ kod: string; status: string; revision: number | null; mottagare: string | null }>>(
    'las_leverabelregister', { contract_id: a.contractId });
}
const agent = (namn: string, kropp: Record<string, unknown>) => act(namn, kropp, { Authorization: `Bearer ${agentToken}` });
async function svepcache(a: Avtal) {
  return withAdmin(async (c) => (await c.query('SELECT nyckel, varde FROM uppdrag_svepvarde WHERE company_id=$1 AND contract_id=$2 ORDER BY nyckel', [companyId, a.contractId])).rows);
}
async function koposter() {
  return withAdmin(async (c) => Number((await c.query('SELECT count(*) AS n FROM action_approvals WHERE company_id=$1', [companyId])).rows[0].n));
}
const TROSKLAR = { procent: 5, golv_ore: 0, golv_timmar: 0, dagar: 5 };
async function skrivIndikator(a: Avtal, larm: unknown[]) {
  await withTenantTransaction(user.userId, companyId, (c) => upsertSvepvarden(c, companyId, a.contractId,
    [{ nyckel: 'troskellarm', kalla: 'redovisning', varde: { trosklar: TROSKLAR, larm, utan_egen_ram: [] } }]));
}
const friskIndikator = (a: Avtal) => skrivIndikator(a, []);
const tandIndikator = (a: Avtal, kod: string) => skrivIndikator(a, [{ ram: 'dagar', kod, slutdatum: '2026-09-13', precision: null,
  arvt_fran: null, forsening_dagar: 10, troskel_dagar: 5 }]);
async function foralder(a: Avtal, kod: string): Promise<string> {
  return withAdmin(async (c) => (await c.query(`SELECT f.code FROM contract_parts d
    JOIN contract_parts f ON f.id=d.parent_part_id AND f.company_id=d.company_id
    WHERE d.company_id=$1 AND d.contract_id=$2 AND d.code=$3`, [companyId, a.contractId, kod])).rows[0]?.code ?? '');
}
async function undantag() {
  return (await ok<{ poster: Array<{ id: string }> }>('las_undantag', {})).poster;
}
// Sakläget kring avtalet: det ett fällt anrop aldrig får ändra.
async function ofort(a: Avtal) {
  return {
    statusar: await statusar(a), handelser: await handelser(a), referenser: await referenser(a),
    svepcache: await svepcache(a), koposter: await koposter(), undantag: (await undantag()).map((p) => p.id),
  };
}
const TRANSMITTAL = (kod: string) => ({ typ: 'transmittal', handling: { sort: 'mejl', extern_id: `<overlamning-${kod}@nvr.se>`, extern_kalla: 'gmail:locollabs' },
  handelse_datum: '2026-09-12' });
const GODKANNANDE = (kod: string, godkand_av: string) => ({ typ: 'godkannande', handling: { sort: 'mejl', extern_id: `<godkant-${kod}@nvr.se>`, extern_kalla: 'gmail:locollabs' },
  handelse_datum: '2026-09-15', godkand_av, kanal: 'mejl' });
const rutin = (a: Avtal, kod: string, kallhandelse: Record<string, unknown>) =>
  agent('registrera_rutinstatus', { contract_id: a.contractId, leverabel_kod: kod, kallhandelse });
const overlamna = (a: Avtal, kod: string) =>
  ok('bekrafta_statusbyte', { ...indata(a, kod), utfall: 'bekraftad', handling: TRANSMITTAL(kod).handling });

let agentToken: string;
beforeAll(async () => {
  user = await registerUser('rutinstatus');
  companyId = await createCompany(user.token, 'Rutinstatus AB');
  await createFiscalYear(companyId, auth(), { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });
  const tok = await api.post(`${co()}/agent-tokens`).set(auth()).send({ name: 'Rutinstatusprov' });
  expect(tok.status, JSON.stringify(tok.body)).toBe(201);
  agentToken = tok.body.token;
});

// ---------------------------------------------------------------------------
// R: rutinregeln, ren
// ---------------------------------------------------------------------------

const NVR = { godkannare: 'Styrgruppen', godkannare_eskalering: 'Eva Larsson (VD)' };
const KEDJA = ['L1', 'STEG1', 'ROT'];
const bas: Omit<Rutinindata, 'typ'> = { status: 'pagar', oppna_signaler: 0, larmkoder: [], leverabelkedja: KEDJA, parter: NVR };
const LAGEN = ['ej_paborjad', 'pagar', 'levererad', 'godkand', 'avvisad'];
const transmittal = (over: Partial<Rutinindata> = {}): Rutinindata => ({ ...bas, typ: 'transmittal', ...over });
const godkannande = (godkand_av: string, over: Partial<Rutinindata> = {}): Rutinindata =>
  ({ ...bas, status: 'levererad', typ: 'godkannande', godkand_av, ...over });
// Kopian fryses, så att `KEDJA` och `NVR` som de andra fallen delar inte rörs.
function djupfrys<T>(v: T): T {
  const fryst = structuredClone(v);
  const frys = (x: unknown) => {
    if (x && typeof x === 'object') {
      for (const y of Object.values(x)) frys(y);
      Object.freeze(x);
    }
  };
  frys(fryst);
  return fryst;
}

describe('Story 14.1: rutinregeln (ren)', () => {
  it('14.1-R1: fyra steg, två källhändelser, och bara leveransen och godkännandet kan medges', () => {
    expect(OVERGANGAR.map((o) => [o.fran, o.till, o.kallhandelse, o.manniskovag])).toEqual([
      ['ej_paborjad', 'pagar', null, 'paborja_leverabel'],
      ['pagar', 'levererad', 'transmittal', 'bekrafta_statusbyte'],
      ['levererad', 'godkand', 'godkannande', 'godkann_leverabel'],
      ['pagar', 'avvisad', null, 'bekrafta_statusbyte'],
    ]);
    expect([...KALLHANDELSETYPER]).toEqual(['transmittal', 'godkannande']);
    for (const typ of KALLHANDELSETYPER) expect(OVERGANGAR.filter((o) => o.kallhandelse === typ)).toHaveLength(1);
    const medgivna = new Set<string>();
    for (const status of LAGEN) {
      for (const typ of KALLHANDELSETYPER) {
        const u = provaRutinhandelse({ ...bas, status, typ, ...(typ === 'godkannande' ? { godkand_av: 'Styrgruppen' } : {}) });
        if (u.medges) medgivna.add(`${u.fran}->${u.till}`);
      }
    }
    // Negativ kontroll: mängden är inte tom, så delmängdsprovet säger något.
    expect(medgivna.size).toBeGreaterThan(0);
    for (const par of medgivna) expect(['pagar->levererad', 'levererad->godkand']).toContain(par);
  });

  it('14.1-R2: transmittalen ger levererad med avtalets godkännare som mottagare', () => {
    expect(provaRutinhandelse(transmittal())).toEqual({ medges: true, fran: 'pagar', till: 'levererad', mottagare: 'Styrgruppen' });
  });

  it('14.1-R3: bara avtalets godkännare eller eskalering, exakt efter normalisering', () => {
    const medgiven = { medges: true, fran: 'levererad', till: 'godkand', mottagare: 'Styrgruppen' };
    expect(provaRutinhandelse(godkannande('Styrgruppen'))).toEqual(medgiven);
    expect(provaRutinhandelse(godkannande('  eva   larsson (vd) '))).toEqual(medgiven);
    expect(provaRutinhandelse(godkannande('Eva Larsson'))).toEqual({ medges: false, skal: ['obehorig_godkannare'] });
    expect(provaRutinhandelse(godkannande('Hermes'))).toEqual({ medges: false, skal: ['obehorig_godkannare'] });
    expect(provaRutinhandelse(godkannande('Styrgruppen', { parter: { godkannare: null, godkannare_eskalering: null } })))
      .toEqual({ medges: false, skal: ['saknad_mottagare', 'obehorig_godkannare'] });
  });

  it('14.1-R4: en obesvarad scopesignal fäller båda källhändelserna', () => {
    expect(provaRutinhandelse(transmittal({ oppna_signaler: 1 }))).toEqual({ medges: false, skal: ['signal_tand'] });
    expect(provaRutinhandelse(godkannande('Styrgruppen', { oppna_signaler: 1 }))).toEqual({ medges: false, skal: ['signal_tand'] });
  });

  it('14.1-R5: indikatorn för leverabeln eller en nivå över fäller, ett syskon fäller inte, oläst fäller', () => {
    for (const kod of KEDJA) {
      expect(provaRutinhandelse(transmittal({ larmkoder: [kod] }))).toEqual({ medges: false, skal: ['indikator_tand'] });
    }
    expect(provaRutinhandelse(transmittal({ larmkoder: ['L2'] }))).toMatchObject({ medges: true });
    expect(provaRutinhandelse(transmittal({ larmkoder: null }))).toEqual({ medges: false, skal: ['indikator_olast'] });
  });

  it('14.1-R6: fel utgångsläge fäller', () => {
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

  it('14.1-R8: alla skäl i ordning, uttömmande texter, ren funktion', () => {
    expect(provaRutinhandelse(transmittal({ status: 'ej_paborjad', oppna_signaler: 2, larmkoder: null })))
      .toEqual({ medges: false, skal: ['fel_utgangslage', 'signal_tand', 'indikator_olast'] });
    expect(new Set(Object.keys(RUTINSKALTEXT))).toEqual(new Set(RUTINSKAL));
    const fryst = djupfrys(godkannande('  eva   larsson (vd) ', { larmkoder: ['L2'] }));
    const forsta = provaRutinhandelse(fryst);
    expect(provaRutinhandelse(fryst)).toEqual(forsta);
    const frystFalld = djupfrys(transmittal({ status: 'levererad', oppna_signaler: 1, larmkoder: ['ROT'] }));
    expect(() => provaRutinhandelse(frystFalld)).not.toThrow();
    expect(provaRutinhandelse(frystFalld)).toEqual(provaRutinhandelse(frystFalld));
  });
});

// ---------------------------------------------------------------------------
// M: migrationen
// ---------------------------------------------------------------------------

const VILLKOREN = [
  'uppdrag_leverabel_handelse_registrerad_av_check', 'uppdrag_leverabel_handelse_kallhandelse_typ_check',
  'uppdrag_leverabel_handelse_kallhandelse_aktor_check', 'uppdrag_leverabel_handelse_registrering_check',
];

describe('Story 14.1: migrationen', () => {
  let a: Avtal;
  let referensId: string;
  const leverabel: Record<string, string> = {};
  beforeAll(async () => {
    a = await nyttAvtal('14.1 M');
    await paborja(a, 'L1'); await paborja(a, 'L2');
    for (const r of await withAdmin(async (c) => (await c.query(
      "SELECT kod, id FROM uppdrag_leverabel WHERE company_id=$1 AND contract_id=$2 AND kod IN ('L1', 'L2')",
      [companyId, a.contractId])).rows)) leverabel[r.kod] = r.id;
    referensId = (await withTenantTransaction(user.userId, companyId, (c) => skapaReferens(c, companyId,
      { contract_id: a.contractId, sort: 'mejl', extern_id: 'm2-handlingen@nvr.se', extern_kalla: 'gmail:locollabs', extern_nyckel: 'rfc822#message-id' }))).id;
  });
  // Raden skrivs förbi tjänstelagret, som ägarrollen: villkoret ska gälla också där.
  // VALUES och inte INSERT … SELECT, så att parametrarna får kolumnernas typer.
  function infoga(kod: string, kolumner: Record<string, unknown>) {
    const namn = Object.keys(kolumner);
    return withAdmin((c) => c.query(
      `INSERT INTO uppdrag_leverabel_handelse (company_id, contract_id, leverabel_id, fran, till${namn.map((n) => `, ${n}`).join('')})
       VALUES ($1, $2, $3, 'pagar', 'levererad'${namn.map((_, i) => `, $${i + 4}`).join('')})`,
      [companyId, a.contractId, leverabel[kod], ...Object.values(kolumner)]));
  }
  const antal = async (kod: string) => (await handelser(a)).filter((h) => h.kod === kod).length;

  it('14.1-M1: fyra kolumner, fyra villkor och ett unikt index, idempotent', async () => {
    const migration = (await loadMigrations()).find((m) => m.name === 'rutinstatus');
    expect(migration).toBeDefined();
    await withAdmin(async (c) => {
      await c.query(migration!.sql); await c.query(migration!.sql);
      const kol = await c.query(`SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns
        WHERE table_name='uppdrag_leverabel_handelse' AND column_name = ANY($1::text[]) ORDER BY column_name`,
      [['registrerad_av', 'kallhandelse_typ', 'kallhandelse_ref', 'kallhandelse_aktor']]);
      expect(kol.rows.map((r) => [r.column_name, r.data_type, r.is_nullable])).toEqual([
        ['kallhandelse_aktor', 'text', 'YES'], ['kallhandelse_ref', 'text', 'YES'],
        ['kallhandelse_typ', 'text', 'YES'], ['registrerad_av', 'text', 'NO'],
      ]);
      expect(kol.rows.find((r) => r.column_name === 'registrerad_av')!.column_default).toContain('manniska');
      const villkor = await c.query('SELECT conname FROM pg_constraint WHERE conname = ANY($1::text[]) ORDER BY conname', [VILLKOREN]);
      expect(villkor.rows.map((r) => r.conname)).toEqual([...VILLKOREN].sort());
      const index = await c.query("SELECT indexdef FROM pg_indexes WHERE indexname='uppdrag_leverabel_handelse_kallhandelse_uk'");
      expect(index.rows).toHaveLength(1);
      expect(index.rows[0].indexdef).toContain('UNIQUE');
      expect(index.rows[0].indexdef).toContain('leverabel_id, kallhandelse_typ, kallhandelse_ref');
      // Läses efter de två körningarna: 4.2-S1 kör 0099 igen och lägger då tillbaka dess text.
      const kommentar = await c.query(`SELECT col_description('uppdrag_leverabel_handelse'::regclass, attnum) AS text
        FROM pg_attribute WHERE attrelid='uppdrag_leverabel_handelse'::regclass AND attname='referens_id'`);
      expect(kommentar.rows[0].text).toContain('källhändelse');
      expect(kommentar.rows[0].text.startsWith('Handlingen som överlämningen eller returen registrerades ur, som rad i uppdrag_referens.')).toBe(true);
    });
  });

  it('14.1-M2: elva otillåtna radformer fälls, fyra tillåtna går igenom', async () => {
    const system = { registrerad_av: 'system', kallhandelse_typ: 'transmittal', referens_id: referensId };
    const manniska = { registrerad_av: 'manniska', bekraftat_av: user.userId };
    const otillatna: Record<string, Record<string, unknown>> = {
      a: { registrerad_av: 'manniska' },
      b: { ...system, kallhandelse_ref: 'mejl:m2-b@nvr.se', bekraftat_av: user.userId },
      c: { registrerad_av: 'system', kallhandelse_ref: 'mejl:m2-c@nvr.se', referens_id: referensId },
      d: { ...system },
      e: { registrerad_av: 'system', kallhandelse_typ: 'transmittal', kallhandelse_ref: 'mejl:m2-e@nvr.se' },
      f: { ...manniska, kallhandelse_typ: 'transmittal', referens_id: referensId },
      g: { ...manniska, kallhandelse_typ: 'transmittal', kallhandelse_ref: 'mejl:m2-g@nvr.se' },
      h: { ...system, registrerad_av: 'agent', kallhandelse_ref: 'mejl:m2-h@nvr.se' },
      i: { ...system, kallhandelse_typ: 'retur', kallhandelse_ref: 'mejl:m2-i@nvr.se' },
      j: { ...system, kallhandelse_typ: 'godkannande', kallhandelse_ref: 'mejl:m2-j@nvr.se' },
      k: { ...system, kallhandelse_ref: 'mejl:m2-k@nvr.se', kallhandelse_aktor: 'Eva Larsson (VD)' },
    };
    expect(Object.keys(otillatna)).toHaveLength(11);
    expect(await antal('L1')).toBe(1);
    for (const [fall, kolumner] of Object.entries(otillatna)) {
      await expect(infoga('L1', kolumner), `fall ${fall}`).rejects.toMatchObject({ code: '23514' });
    }
    expect(await antal('L1')).toBe(1);
    await infoga('L1', { ...manniska });
    await infoga('L1', { ...manniska, referens_id: referensId });
    await infoga('L1', { ...manniska, kallhandelse_typ: 'godkannande', kallhandelse_ref: 'mejl:m2-ja@nvr.se',
      kallhandelse_aktor: 'Eva Larsson (VD)', referens_id: referensId });
    await infoga('L1', { ...system, kallhandelse_ref: 'mejl:m2-system@nvr.se' });
    const rader = (await handelser(a)).filter((h) => h.kod === 'L1');
    expect(rader).toHaveLength(5);
    expect(rader.map((h) => h.registrerad_av)).toEqual(['manniska', 'manniska', 'manniska', 'manniska', 'system']);
  });

  it('14.1-M3: samma källhändelse två gånger på samma leverabel fälls av det unika indexet', async () => {
    const rad = { registrerad_av: 'system', kallhandelse_typ: 'transmittal', kallhandelse_ref: 'mejl:m3@nvr.se', referens_id: referensId };
    await infoga('L1', rad);
    await expect(infoga('L1', rad)).rejects.toMatchObject({ code: '23505' });
    await infoga('L2', rad);
    expect((await handelser(a)).filter((h) => h.kallhandelse_ref === 'mejl:m3@nvr.se').map((h) => h.kod)).toEqual(['L1', 'L2']);
  });
});

// ---------------------------------------------------------------------------
// A: rutinvägen
// ---------------------------------------------------------------------------

async function rutinavtal(namn: string): Promise<Avtal> {
  const a = await nyttAvtal(namn);
  await friskIndikator(a);
  return a;
}

describe('Story 14.1: rutinvägen', () => {
  it('14.1-A1: transmittalen registreras utan fråga, köpost eller signatur, med handlingen kvar', async () => {
    const a = await rutinavtal('14.1 A1'); await paborja(a, 'L1');
    const beslut = async () => withAdmin(async (c) => Number((await c.query(
      'SELECT count(*) AS n FROM uppdrag_beslut WHERE company_id=$1 AND contract_id=$2', [companyId, a.contractId])).rows[0].n));
    const fore = { koposter: await koposter(), beslut: await beslut(), undantag: (await undantag()).map((p) => p.id),
      godkannanden: await godkannanden(), referenser: await referenser(a) };
    expect(fore.godkannanden.length).toBeGreaterThan(0);

    const res = await rutin(a, 'L1', TRANSMITTAL('L1'));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const r = res.body.result;
    expect(r).toMatchObject({ utfall: 'registrerad', status: 'levererad', revision: 1, mottagare: 'Styrgruppen',
      kallhandelse_ref: 'mejl:overlamning-L1@nvr.se', referens_id: expect.any(String) });
    const rad = (await handelser(a)).at(-1)!;
    expect(rad).toMatchObject({ id: r.handelse_id, kod: 'L1', fran: 'pagar', till: 'levererad', registrerad_av: 'system', bekraftat_av: null,
      kallhandelse_typ: 'transmittal', kallhandelse_ref: 'mejl:overlamning-L1@nvr.se', referens_id: r.referens_id,
      dag: '2026-09-12', kanal: null, notering: null, kallhandelse_aktor: null });
    const nya = (await referenser(a)).filter((x) => !fore.referenser.some((y) => y.id === x.id));
    expect(nya.find((x) => x.id === r.referens_id)).toMatchObject({ sort: 'mejl', extern_id: 'overlamning-L1@nvr.se',
      extern_nyckel: 'rfc822#message-id', extern_kalla: 'gmail:locollabs' });
    expect(nya).toContainEqual(expect.objectContaining({ extern_nyckel: 'registerkopia', ko_status: 'koad' }));

    expect(await koposter()).toBe(fore.koposter);
    expect(await beslut()).toBe(fore.beslut);
    expect((await undantag()).map((p) => p.id)).toEqual(fore.undantag);
    expect(await godkannanden()).toEqual(fore.godkannanden);
    expect((await audit()).find((x) => x.action === 'action.executed' && x.entity_id === 'registrera_rutinstatus'))
      .toMatchObject({ details: { actor: 'agent' } });
    expect((await register(a)).find((x) => x.kod === 'L1')).toMatchObject({ status: 'levererad', revision: 1, mottagare: 'Styrgruppen' });

    // Append-only i samma form som «append-only i praktiken»: var sin transaktion som app.
    await expect(withTenantTransaction(user.userId, companyId, (c) => c.query(
      "UPDATE uppdrag_leverabel_handelse SET bekraftat_av = 'någon' WHERE id = $1", [r.handelse_id],
    ))).rejects.toThrow(/permission denied/);
    await expect(withTenantTransaction(user.userId, companyId, (c) => c.query(
      'DELETE FROM uppdrag_leverabel_handelse WHERE id = $1', [r.handelse_id],
    ))).rejects.toThrow(/permission denied/);
    expect((await handelser(a)).find((h) => h.id === r.handelse_id)).toEqual(rad);
  });

  it('14.1-A2: godkännandet från eskaleringen registreras med källans aktör och avtalets mottagare', async () => {
    const a = await rutinavtal('14.1 A2'); await paborja(a, 'L2'); await overlamna(a, 'L2');
    const res = await rutin(a, 'L2', GODKANNANDE('L2', 'Eva Larsson (VD)'));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.result).toMatchObject({ utfall: 'registrerad', status: 'godkand', revision: null, mottagare: 'Styrgruppen',
      kallhandelse_aktor: 'Eva Larsson (VD)', registrerad_av: 'system' });
    const [manniskans, rutinens] = (await handelser(a)).filter((h) => h.kod === 'L2').slice(-2);
    expect(rutinens).toMatchObject({ till: 'godkand', registrerad_av: 'system', bekraftat_av: null, mottagare: 'Styrgruppen',
      kallhandelse_aktor: 'Eva Larsson (VD)', kanal: 'mejl', dag: '2026-09-15', referens_id: expect.any(String) });
    expect(manniskans).toMatchObject({ till: 'levererad', registrerad_av: 'manniska', bekraftat_av: user.userId });
    expect((await register(a)).find((x) => x.kod === 'L2')).toMatchObject({ status: 'godkand', revision: 1, mottagare: 'Styrgruppen' });
  });

  it('14.1-A3: aldrig ett målläge, aldrig en annan källhändelse, aldrig en adress', async () => {
    const a = await rutinavtal('14.1 A3'); await paborja(a, 'L1');
    const fore = { handelser: await handelser(a), referenser: await referenser(a) };
    const bas = { contract_id: a.contractId, leverabel_kod: 'L1' };
    const t = TRANSMITTAL('L1');
    for (const [namn, kropp] of [
      ['tom', {}],
      ['till', { ...bas, kallhandelse: t, till: 'levererad' }],
      ['status', { ...bas, kallhandelse: t, status: 'godkand' }],
      ['paborjande', { ...bas, kallhandelse: { ...t, typ: 'paborjande' } }],
      ['retur', { ...bas, kallhandelse: { ...t, typ: 'retur' } }],
      ['url', { ...bas, kallhandelse: { ...t, handling: { ...t.handling, extern_id: 'https://mail.google.com/x' } } }],
    ] as const) {
      const res = await agent('registrera_rutinstatus', kropp);
      expect(res.status, `${namn}: ${JSON.stringify(res.body)}`).toBe(400);
      expect(res.body.error, namn).toBe('validation_error');
    }
    expect(await handelser(a)).toEqual(fore.handelser);
    expect(fore.handelser).toHaveLength(1);
    expect((await statusar(a)).find((s) => s.kod === 'L1')!.status).toBe('pagar');
    expect(await referenser(a)).toEqual(fore.referenser);
  });

  it('14.1-A4: samma källhändelse igen registrerar ingenting', async () => {
    const a = await rutinavtal('14.1 A4'); await paborja(a, 'L1'); await paborja(a, 'L2'); await overlamna(a, 'L2');
    for (const [kod, kallhandelse, status] of [
      ['L1', TRANSMITTAL('L1'), 'levererad'], ['L2', GODKANNANDE('L2', 'Styrgruppen'), 'godkand'],
    ] as const) {
      const forsta = await rutin(a, kod, kallhandelse);
      expect(forsta.status, JSON.stringify(forsta.body)).toBe(200);
      expect(forsta.body.result.utfall).toBe('registrerad');
      const antalReferenser = (await referenser(a)).length;
      const andra = await rutin(a, kod, kallhandelse);
      expect(andra.status, JSON.stringify(andra.body)).toBe(200);
      expect(andra.body.result).toEqual({ utfall: 'redan_registrerad', handelse_id: forsta.body.result.handelse_id, leverabel_kod: kod, status });
      expect((await handelser(a)).filter((h) => h.kallhandelse_ref === forsta.body.result.kallhandelse_ref)).toHaveLength(1);
      expect(await referenser(a)).toHaveLength(antalReferenser);
    }
  });

  it('14.1-A5: datumfönstret: aldrig framtid, aldrig före avtalet', async () => {
    const a = await rutinavtal('14.1 A5'); await paborja(a, 'L1');
    const fore = { handelser: await handelser(a), referenser: await referenser(a) };
    for (const [datum, kod] of [['2099-01-01', 'framtida_datum'], ['2026-09-01', 'fore_avtalet']] as const) {
      const res = await rutin(a, 'L1', { ...TRANSMITTAL('L1'), handelse_datum: datum });
      expect(res.status, JSON.stringify(res.body)).toBe(400);
      expect(res.body.error).toBe(kod);
    }
    expect(await handelser(a)).toEqual(fore.handelser);
    expect(await referenser(a)).toEqual(fore.referenser);
  });

  it('14.1-A6: grannbolagets avtal och en okänd leverabel ger 404 utan skrivning', async () => {
    const granne = await registerUser('rutinstatus-granne');
    const grannbolag = await createCompany(granne.token, 'Grannen AB');
    const gauth = { Authorization: `Bearer ${granne.token}` };
    await createFiscalYear(grannbolag, gauth, { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });
    const gok = async (namn: string, kropp: Record<string, unknown>) => {
      const res = await api.post(`/api/companies/${grannbolag}/actions/${namn}`).set(gauth).send(kropp);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      return res.body.result;
    };
    const projectId = (await gok('create_project', { name: '14.1 A6 granne' })).id as string;
    const contractId = (await gok('skapa_uppdrag', { project_id: projectId, name: '14.1 A6 granne', signed_date: '2026-09-03' })).contract_id as string;
    await importeraOchGodkann(grannbolag, gauth, { contract_id: contractId, kontraktstext: LEVERANSKONTRAKT_NVR001 });
    await withAdmin((c) => c.query('UPDATE contracts SET godkannare=$1, godkannare_eskalering=$2 WHERE id=$3 AND company_id=$4',
      [PARTER.godkannare, PARTER.godkannare_eskalering, contractId, grannbolag]));
    await gok('paborja_leverabel', { contract_id: contractId, leverabel_kod: 'L1' });
    const grannlage = () => withAdmin(async (c) => ({
      handelser: (await c.query('SELECT * FROM uppdrag_leverabel_handelse WHERE company_id=$1 ORDER BY id', [grannbolag])).rows,
      referenser: (await c.query('SELECT * FROM uppdrag_referens WHERE company_id=$1 ORDER BY id', [grannbolag])).rows,
      svepcache: (await c.query('SELECT nyckel, varde FROM uppdrag_svepvarde WHERE company_id=$1 ORDER BY nyckel', [grannbolag])).rows,
    }));
    const egen = await rutinavtal('14.1 A6'); await paborja(egen, 'L1');
    const fore = { granne: await grannlage(), egen: await ofort(egen) };
    expect(fore.granne.handelser).toHaveLength(1);

    const frammande = await rutin({ projectId, contractId }, 'L1', TRANSMITTAL('L1'));
    expect(frammande.status, JSON.stringify(frammande.body)).toBe(404);
    expect(frammande.body.error).toBe('not_found');
    const okand = await rutin(egen, 'L99', TRANSMITTAL('L99'));
    expect(okand.status, JSON.stringify(okand.body)).toBe(404);
    expect(okand.body.error).toBe('not_found');
    expect(await grannlage()).toEqual(fore.granne);
    expect(await ofort(egen)).toEqual(fore.egen);
    // Positiv kontroll: åtgärden finns och registrerar i det egna avtalet, så
    // 404 ovan kommer ur bolagsgränsen och leverabeluppslaget, inte ur ett saknat namn.
    const egenRes = await rutin(egen, 'L1', TRANSMITTAL('L1'));
    expect(egenRes.status, JSON.stringify(egenRes.body)).toBe(200);
    expect(egenRes.body.result.utfall).toBe('registrerad');
    expect(await grannlage()).toEqual(fore.granne);
  });

  it('14.1-A7: de tre människospärrarna står kvar, och rutinvägen är write utan spärr', async () => {
    for (const namn of ['paborja_leverabel', 'bekrafta_statusbyte', 'godkann_leverabel']) {
      expect(getAction(namn), namn).toMatchObject({ kravManniska: true, sensitivity: 'write' });
    }
    const rutinatgard = getAction('registrera_rutinstatus');
    expect(rutinatgard).toBeDefined();
    expect(rutinatgard!.sensitivity).toBe('write');
    expect(rutinatgard!.kravManniska).toBeFalsy();
    expect(rutinatgard!.koasForAgent).toBeFalsy();
    expect(rutinatgard!.description?.trim()).toBeTruthy();

    const a = await rutinavtal('14.1 A7'); await paborja(a, 'L1'); await paborja(a, 'L2'); await overlamna(a, 'L2');
    const fore = await handelser(a);
    for (const [namn, kropp] of [
      ['paborja_leverabel', indata(a, 'L3')],
      ['bekrafta_statusbyte', { ...indata(a, 'L1'), utfall: 'bekraftad', handling: TRANSMITTAL('L1').handling }],
      ['godkann_leverabel', { ...indata(a, 'L2'), kanal: 'mejl' }],
    ] as const) {
      const res = await agent(namn, kropp);
      expect(res.status, `${namn}: ${JSON.stringify(res.body)}`).toBe(403);
      expect(res.body.error).toBe('human_required');
    }
    expect(await handelser(a)).toEqual(fore);
    // Människovägens rad: standardvärdet bär den, utan att de tre åtgärderna ändrats.
    const manniskans = fore.filter((h) => h.kod === 'L2').at(-1);
    expect(manniskans).toMatchObject({ till: 'levererad', registrerad_av: 'manniska', bekraftat_av: user.userId,
      kallhandelse_typ: null, kallhandelse_ref: null });
  });
});

// ---------------------------------------------------------------------------
// F: det fällda ändrar ingenting
// ---------------------------------------------------------------------------

const NYCKLAR_FALLD = ['leverabel_kod', 'skal', 'status', 'utfall'];

describe('Story 14.1: det fällda ändrar ingenting', () => {
  it('14.1-F1: en obesvarad scopesignal fäller utan skrivning; efter Davids avgörande registreras samma källhändelse', async () => {
    const a = await rutinavtal('14.1 F1'); await paborja(a, 'L1');
    const signal = await ok<{ id: string }>('tand_scopesignal', { contract_id: a.contractId, fras: 'kan ni även ta' });
    const fore = await ofort(a);
    const godkFore = await godkannanden();
    expect(godkFore.length).toBeGreaterThan(0);

    const res = await rutin(a, 'L1', TRANSMITTAL('L1'));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const forvantat = provaRutinhandelse({ typ: 'transmittal', status: 'pagar', oppna_signaler: 1, larmkoder: [],
      leverabelkedja: ['L1', await foralder(a, 'L1'), 'UPPDRAG'], parter: PARTER });
    expect(forvantat).toEqual({ medges: false, skal: ['signal_tand'] });
    expect(res.body.result).toEqual({ utfall: 'falld', leverabel_kod: 'L1', status: 'pagar', skal: ['signal_tand'] });
    expect(Object.keys(res.body.result).sort()).toEqual(NYCKLAR_FALLD);
    expect(await ofort(a)).toEqual(fore);
    expect(await godkannanden()).toEqual(godkFore);

    // Negativ kontroll: samma indata skriver när regeln medger, så likheten ovan
    // beror på den fällda grenen och inte på riggen.
    await ok('avgor_scopesignal', { signal_id: signal.id, avgjord: 'innanfor' });
    const efter = await rutin(a, 'L1', TRANSMITTAL('L1'));
    expect(efter.status, JSON.stringify(efter.body)).toBe(200);
    expect(efter.body.result).toMatchObject({ utfall: 'registrerad', status: 'levererad' });
  });

  it('14.1-F2: indikatorn för leverabeln eller en nivå över fäller, ett syskon fäller inte, oläst fäller', async () => {
    const a = await nyttAvtal('14.1 F2 a'); await paborja(a, 'L1'); await tandIndikator(a, 'L1');
    const foreA = await ofort(a);
    const resA = await rutin(a, 'L1', TRANSMITTAL('L1'));
    expect(resA.status, JSON.stringify(resA.body)).toBe(200);
    expect(resA.body.result).toEqual({ utfall: 'falld', leverabel_kod: 'L1', status: 'pagar', skal: ['indikator_tand'] });
    expect(await ofort(a)).toEqual(foreA);

    const b = await nyttAvtal('14.1 F2 b'); await paborja(b, 'L1'); await tandIndikator(b, 'L2');
    const resB = await rutin(b, 'L1', TRANSMITTAL('L1'));
    expect(resB.status, JSON.stringify(resB.body)).toBe(200);
    expect(resB.body.result).toMatchObject({ utfall: 'registrerad', status: 'levererad' });

    const c = await nyttAvtal('14.1 F2 c'); await paborja(c, 'L1');
    const foreC = await ofort(c);
    expect(foreC.svepcache.some((r) => r.nyckel === 'troskellarm')).toBe(false);
    const resC = await rutin(c, 'L1', TRANSMITTAL('L1'));
    expect(resC.status, JSON.stringify(resC.body)).toBe(200);
    expect(resC.body.result).toEqual({ utfall: 'falld', leverabel_kod: 'L1', status: 'pagar', skal: ['indikator_olast'] });
    expect(await ofort(c)).toEqual(foreC);

    const d = await nyttAvtal('14.1 F2 d'); await paborja(d, 'L1');
    const nivan = await foralder(d, 'L1');
    expect(nivan).not.toBe('');
    expect(nivan).not.toBe('L1');
    for (const kod of [nivan, 'UPPDRAG']) {
      await tandIndikator(d, kod);
      const foreD = await ofort(d);
      const resD = await rutin(d, 'L1', TRANSMITTAL('L1'));
      expect(resD.status, JSON.stringify(resD.body)).toBe(200);
      expect(resD.body.result, kod).toEqual({ utfall: 'falld', leverabel_kod: 'L1', status: 'pagar', skal: ['indikator_tand'] });
      expect(await ofort(d)).toEqual(foreD);
    }
  });

  it('14.1-F3: ett godkännande från en obehörig avsändare fälls utan skrivning', async () => {
    const a = await rutinavtal('14.1 F3'); await paborja(a, 'L1'); await overlamna(a, 'L1');
    const fore = await ofort(a);
    const res = await rutin(a, 'L1', GODKANNANDE('L1', 'Hermes'));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.result).toEqual({ utfall: 'falld', leverabel_kod: 'L1', status: 'levererad', skal: ['obehorig_godkannare'] });
    const efter = await ofort(a);
    expect(efter).toEqual(fore);
    expect(efter.statusar.find((s) => s.kod === 'L1')!.status).toBe('levererad');
    expect(efter.handelser.some((h) => h.till === 'godkand')).toBe(false);
    expect(efter.referenser.some((r) => r.extern_id === 'godkant-L1@nvr.se')).toBe(false);

    const behorig = await rutin(a, 'L1', GODKANNANDE('L1', 'Styrgruppen'));
    expect(behorig.status, JSON.stringify(behorig.body)).toBe(200);
    expect(behorig.body.result).toMatchObject({ utfall: 'registrerad', status: 'godkand' });
  });

  it('14.1-F5: påbörjandet tas aldrig av rutinvägen', async () => {
    const a = await rutinavtal('14.1 F5');
    const fore = await ofort(a);
    expect(fore.statusar.find((s) => s.kod === 'L3')!.status).toBe('ej_paborjad');
    const res = await rutin(a, 'L3', TRANSMITTAL('L3'));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.result).toEqual({ utfall: 'falld', leverabel_kod: 'L3', status: 'ej_paborjad', skal: ['fel_utgangslage'] });
    const efter = await ofort(a);
    expect(efter).toEqual(fore);
    expect(efter.handelser.filter((h) => h.kod === 'L3')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// D: dokumentationen
// ---------------------------------------------------------------------------

describe('Story 14.1: dokumentationen', () => {
  const normalisera = (s: string) => s.replace(/\s+/g, ' ');
  // Kopia av 4.2-D1:s läsare: slutar vid nästa rubrik på nivå två eller tre.
  function avsnitt(text: string, rubrik: string) {
    const start = text.indexOf(rubrik);
    expect(start, rubrik).toBeGreaterThanOrEqual(0);
    return text.slice(start + rubrik.length).split(/\n#{2,3} /)[0]!;
  }
  // Kopia av 4.4-D1:s läsare: slutar först vid nästa rubrik på nivå två.
  function helaAvsnittet(text: string, rubrik: string, slut: RegExp): string {
    const start = text.indexOf(rubrik);
    expect(start, rubrik).toBeGreaterThanOrEqual(0);
    const resten = text.slice(start + rubrik.length);
    const end = resten.search(slut);
    return rubrik + (end === -1 ? resten : resten.slice(0, end));
  }

  const SPARRADE = ['paborja_leverabel', 'bekrafta_statusbyte', 'godkann_leverabel'];
  function arkitekturbrister(text: string): string[] {
    const brister: string[] = [];
    const norm = normalisera(text);
    if (!/(^|\n)\*\*Rutinvagen \(FR-13, Story 14\.1\)\.\*\*/.test(text)) brister.push('stycket Rutinvagen saknas');
    for (const ord of ['server/src/lib/rutinregel.ts', 'registrera_rutinstatus', 'registrerad_av', 'kallhandelse_ref',
      'kallhandelse_aktor', 'falld', 'transmittal', 'godkannande', 'Story 14.4']) {
      if (!norm.includes(ord)) brister.push(`saknar ${ord}`);
    }
    for (const ord of ['En fjarde, kallbelagd rutinvag', 'FR-13']) if (!norm.includes(ord)) brister.push(`saknar ${ord}`);
    const rad = text.split('\n').find((r) => r.includes('markta `kravManniska`'));
    if (!rad) return [...brister, 'raden med kravManniska saknas'];
    const start = rad.indexOf('markta `kravManniska`');
    const uppraknade = rad.slice(start, rad.indexOf('avvisas', start));
    if (uppraknade.includes('registrera_rutinstatus')) brister.push('rutinvägen räknas som människospärrad');
    for (const namn of SPARRADE) if (!uppraknade.includes(namn)) brister.push(`${namn} saknas bland de spärrade`);
    return brister;
  }

  it('14.1-D1: arkitekturen beskriver den fjärde vägen och räknar den inte som spärrad', async () => {
    const text = avsnitt(await readFile(new URL('../../docs/ARKITEKTUR.md', import.meta.url), 'utf8'), '## Uppdragsytan (modul)');
    expect(arkitekturbrister(text)).toEqual([]);
    // Negativa kontroller: rutinvägen inskjuten bland de spärrade, och en spärrad borttagen.
    const inskjuten = text.replace('`godkann_leverabel`, `avboj_beslutsforslag`', '`godkann_leverabel`, `registrera_rutinstatus`, `avboj_beslutsforslag`');
    expect(inskjuten).not.toBe(text);
    expect(arkitekturbrister(inskjuten)).toContain('rutinvägen räknas som människospärrad');
    const rad = text.split('\n').find((r) => r.includes('markta `kravManniska`'))!;
    const fran = rad.indexOf('markta `kravManniska`');
    const utanGodkann = text.replace(rad, rad.slice(0, fran) + rad.slice(fran).replace('`godkann_leverabel`, ', ''));
    expect(utanGodkann).not.toBe(text);
    expect(arkitekturbrister(utanGodkann)).toContain('godkann_leverabel saknas bland de spärrade');
  });

  // Handgrepp-provets mönster: ett ensamt kodspann av gemener med understreck.
  const ensammaSpann = (text: string) => [...text.matchAll(/`([^`\n]+)`/g)].map((m) => m[1]!)
    .filter((s) => /^[a-z_]+$/.test(s) && s.includes('_'));

  it('14.1-D2: åtgärdsdokumentet har rutinvägen inne i Uppdragsytan, utan ensamma kodspann', async () => {
    const doc = await readFile(new URL('../../docs/MCP_ACTIONS.md', import.meta.url), 'utf8');
    const rubrik = '### Rutinvägen (Story 14.1)';
    const modulStart = doc.search(/^## Uppdragsytan$/m);
    const modulSlut = modulStart + 1 + doc.slice(modulStart + 1).search(/^## /m);
    const rutinStart = doc.indexOf(rubrik);
    expect(modulStart).toBeGreaterThanOrEqual(0);
    expect(rutinStart).toBeGreaterThan(modulStart);
    expect(rutinStart).toBeLessThan(modulSlut);

    const text = avsnitt(doc, rubrik);
    const norm = normalisera(text);
    for (const ord of ['registrera_rutinstatus', 'kallhandelse_aktor', 'transmittal', 'godkannande', 'falld', 'Story 14.4']) {
      expect(norm, ord).toContain(ord);
    }
    expect(ensammaSpann(text)).toEqual([]);
    expect(helaAvsnittet(doc, '## Uppdragsytan', /^## /m)).not.toContain('las_faktureringsunderlag');
    // Negativa kontroller och en positiv.
    expect(ensammaSpann(`${text}\n- \`registrerad_av\``)).toEqual(['registrerad_av']);
    expect(ensammaSpann(`${text}\n- \`datum_saknas\``)).toEqual(['datum_saknas']);
    expect(ensammaSpann(`${text}\n- \`registrerad_av = 'system'\``)).toEqual([]);
  });
});
