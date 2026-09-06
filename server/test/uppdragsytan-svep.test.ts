// Uppdragsytan S7.3, våg 3: SVEPET (PRD FR-5/FR-10/FR-35/FR-36, NFR-6).
//
// Storyns Given är en negativ mening — vyerna får ALDRIG anropa ett grannsystem
// under rendering — och den kan bara hållas om någon läst källsystemen i förväg
// och lagt resultatet i `uppdrag_svepvarde`. Provet prövar därför fyra saker som
// alla kan gå sönder i tysthet:
//
//   (a) **Ordningen.** Verifiering → spärrmapp → prognos. Ordningen syns i
//       svarets `nycklar` (härledningsordningen, inte den sorterade
//       skrivordningen) och i att cachen bär referensernas läge EFTER
//       verifieringen: en cache som skrivits före hade inte kunnat veta att
//       filen driftat.
//   (b) **Låset.** Två samtidiga svep i samma bolag → ett av dem svarar
//       `svep_avstod` och skriver ingenting. En tyst tom retur hade sett ut som
//       ett svep utan fynd.
//   (c) **Stängda uppdrag.** Svepet läser `projects.status` FÖRE varje
//       skrivning, så 0068:s `vagrar_skrivning_pa_avslutat()` aldrig träffas —
//       annars hade ett uppdrag som avslutades i går fällt hela körningen.
//   (d) **Ägandegränsen.** Förslagen är CACHE. Ett svep som rört
//       `uppdrag_leverabel` eller `receipts` har flyttat en sanning, och det ska
//       synas som skillnad — därför jämförs båda tabellerna rad för rad före och
//       efter, och svepets nätverksväg spärras under körningen.
import { readFile } from 'node:fs/promises';
import type { PoolClient } from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';
import { ACTIONS } from '../src/actions/registry.js';
import { withTenantTransaction } from '../src/db/tx.js';
import { skapaReferens } from '../src/services/uppdragReferens.js';
import {
  korUppdragssvep, lasSvepvarden, type SvepIndata, type Svepsvar,
} from '../src/services/uppdragSvep.js';
import { LEVERANSKONTRAKT_NVR001 } from './fixtures/leveranskontrakt-nvr-001.js';
import { api, createCompany, createFiscalYear, registerUser, withAdmin, type TestUser } from './helpers.js';

const KALLA = new URL('../src/services/uppdragSvep.ts', import.meta.url);

/** Kundens spärrmapp i Drive. Ett id, aldrig en sökväg (S7.1). */
const SPARRMAPP = '0AKxSparrmappNordicVisionRetail';
const UTANFOR_MAPP = '0AKxNagonAnnansMapp';
const OKANT_ID = '00000000-0000-4000-8000-000000000000';

let user: TestUser;
let companyId = '';
let agentToken = '';
let granne: TestUser;
let grannbolag = '';

let avtal = '';
let refL3 = '';
let refKalender = '';
let stangtAvtal = '';
let refStangt = '';
let kvittoS1 = '';
let kvittoS2 = '';
let kvittoRot = '';
let kvittoObokat = '';
let delS1 = '';
let delS2 = '';
let delRot = '';

const auth = () => ({ Authorization: `Bearer ${user.token}` });
const agent = () => ({ Authorization: `Bearer ${agentToken}` });
const co = (id = companyId) => `/api/companies/${id}`;

type Svar = { status: number; body: Record<string, unknown> };
type SvepKort = Extract<Svepsvar, { lage: 'svep_kort' }>;
type Cacherad = { nyckel: string; varde: unknown; kalla: string | null };

async function act(namn: string, kropp: Record<string, unknown>, headers = auth()): Promise<Svar> {
  const res = await api.post(`${co()}/actions/${namn}`).set(headers).send(kropp);
  return res as unknown as Svar;
}

async function ok(namn: string, kropp: Record<string, unknown>, headers = auth()): Promise<Record<string, unknown>> {
  const res = await act(namn, kropp, headers);
  expect(res.status, `${namn}: ${JSON.stringify(res.body)}`).toBe(200);
  return res.body.result as Record<string, unknown>;
}

/** En känslig åtgärd hela vägen: begäran (202) + godkännande (200). */
async function okKoad(namn: string, kropp: Record<string, unknown>): Promise<Record<string, unknown>> {
  const begaran = await act(namn, kropp);
  expect(begaran.status, `${namn}: ${JSON.stringify(begaran.body)}`).toBe(202);
  const approval = begaran.body.approval as { id: string };
  const svar = await api.post(`${co()}/approvals/${approval.id}/approve`).set(auth()).send({});
  expect(svar.status, `${namn} (godkännande): ${JSON.stringify(svar.body)}`).toBe(200);
  return svar.body.result as Record<string, unknown>;
}

/** Svepet genom hela stacken — samma väg som Hermes går (S7.5). */
async function svep(indata: SvepIndata, headers = auth()): Promise<SvepKort> {
  const res = await ok('kor_uppdragssvep', indata as Record<string, unknown>, headers);
  const svar = res as unknown as Svepsvar;
  expect(svar.lage, 'svepet avstod oväntat').toBe('svep_kort');
  return svar as SvepKort;
}

/** Cachen som den STÅR, förbi hela applikationslagret utom läshjälparen. */
async function cache(contractId = avtal): Promise<Cacherad[]> {
  return withTenantTransaction(user.userId, companyId, (c) => lasSvepvarden(c, companyId, contractId));
}

function varde(rader: Cacherad[], nyckel: string): Record<string, unknown> {
  const rad = rader.find((r) => r.nyckel === nyckel);
  expect(rad, `cachenyckeln ${nyckel} saknas (fanns: ${rader.map((r) => r.nyckel).join(', ')})`).toBeDefined();
  return rad!.varde as Record<string, unknown>;
}

interface Del { part_id: string; code: string }

async function delar(contractId: string): Promise<Del[]> {
  const avtalet = await ok('get_contract_usage', { contract_id: contractId });
  return avtalet.parts as unknown as Del[];
}

function del(alla: Del[], code: string): string {
  const funnen = alla.find((d) => d.code === code);
  expect(funnen, `avtalsdelen ${code} saknas`).toBeDefined();
  return funnen!.part_id;
}

async function nyttUppdrag(namn: string, signerat = '2026-09-03'): Promise<{ projektId: string; contractId: string }> {
  const projekt = (await ok('create_project', { name: namn })).id as string;
  const svar = await ok('skapa_uppdrag', { project_id: projekt, name: `Leveranskontrakt ${namn}`, signed_date: signerat });
  return { projektId: projekt, contractId: svar.contract_id as string };
}

/** En referens skrivs genom S7.1:s tjänst — den har (med flit) ingen åtgärd. */
async function referens(contractId: string, input: {
  sort: 'drive' | 'kalender' | 'mejl';
  extern_id: string;
  extern_nyckel: string;
  extern_kalla: string;
  titel_vid_lankning?: string;
  hash_vid_lankning?: string;
}): Promise<string> {
  const rad = await withTenantTransaction(user.userId, companyId, (c) =>
    skapaReferens(c, companyId, { contract_id: contractId, ...input }));
  return rad.id;
}

async function bokatKvitto(datum: string, leverantorId: string, text: string): Promise<string> {
  const kvitto = await ok('create_receipt', {
    supplier_id: leverantorId,
    receipt_date: datum,
    description: text,
    net_ore: 400000,
    vat_rate: 25,
    expense_account: 5460,
  });
  await okKoad('book_receipt', { receipt_id: kvitto.id as string });
  return kvitto.id as string;
}

beforeAll(async () => {
  user = await registerUser('svep');
  companyId = await createCompany(user.token, 'Locollabs AB');
  await createFiscalYear(companyId, auth(), { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });

  const tok = await api.post(`${co()}/agent-tokens`).set(auth()).send({ name: 'Hermes' });
  expect(tok.status, JSON.stringify(tok.body)).toBe(201);
  agentToken = tok.body.token;

  const uppdrag = await nyttUppdrag('NVR-001');
  avtal = uppdrag.contractId;
  await ok('importera_leveranskontrakt', { contract_id: avtal, kontraktstext: LEVERANSKONTRAKT_NVR001 });
  const alla = await delar(avtal);
  delRot = del(alla, 'UPPDRAG');
  delS1 = del(alla, 'S1');
  delS2 = del(alla, 'S2');

  // L3:s handling i Drive. Titeln bär leverantörens namn — det är den enda
  // tråden mellan ett kvitto i redovisningen och ett dokument i Drive.
  refL3 = await referens(avtal, {
    sort: 'drive',
    extern_id: '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456',
    extern_nyckel: 'leverabel-handling',
    extern_kalla: 'drive:locollabs',
    titel_vid_lankning: 'Offert Axis Communications AB – integrationslagret',
    hash_vid_lankning: 'sha256:abc',
  });
  refKalender = await referens(avtal, {
    sort: 'kalender',
    extern_id: 'evt-styrgrupp-2026-10-01',
    extern_nyckel: 'icalendar#uid',
    extern_kalla: 'kalender:david@locollabs.com',
  });

  const leverantor = (await ok('create_supplier', { name: 'Axis Communications AB' })).id as string;
  const annan = (await ok('create_supplier', { name: 'Telia Sverige AB' })).id as string;
  kvittoS1 = await bokatKvitto('2026-10-15', leverantor, 'Kameralicenser oktober');
  kvittoS2 = await bokatKvitto('2026-11-20', leverantor, 'Integrationshårdvara');
  kvittoRot = await bokatKvitto('2026-03-05', leverantor, 'Förstudiematerial');
  await bokatKvitto('2026-11-21', annan, 'Bredband kontoret');
  kvittoObokat = (await ok('create_receipt', {
    supplier_id: leverantor,
    receipt_date: '2026-11-22',
    description: 'Ej bokfört ännu',
    net_ore: 100000,
    vat_rate: 25,
    expense_account: 5460,
  })).id as string;

  granne = await registerUser('svep-granne');
  grannbolag = await createCompany(granne.token, 'Grannbolaget AB');
});

// ---------------------------------------------------------------------------
// KRAV-8: åtgärden i registret
// ---------------------------------------------------------------------------

describe('KRAV-8: kor_uppdragssvep i registret', () => {
  it('är write, utan kravManniska — svepet härleder, det beslutar ingenting', () => {
    const def = ACTIONS.find((a) => a.name === 'kor_uppdragssvep');
    expect(def, 'åtgärden saknas i registret').toBeDefined();
    expect(def!.sensitivity).toBe('write');
    expect(def!.kravManniska).toBeUndefined();
  });

  it('schemat är strikt: ett okänt fält ger 400 och inget svep körs', async () => {
    const res = await act('kor_uppdragssvep', { uppdrag: [], bolag: companyId });
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect(res.body.error).toBe('validation_error');
  });

  it('ett tomt anrop är giltigt: första svepet har bara en NÄSTA arbetslista', async () => {
    const svar = await svep({});
    expect(svar.uppdrag).toEqual([]);
    expect(svar.hoppade).toEqual([]);
    expect(svar.arbetslista.referenser.length).toBeGreaterThan(0);
  });

  it('agenten kör svepet — kön ska kunna gå utan handpåläggning', async () => {
    const svar = await svep({}, agent());
    expect(svar.lage).toBe('svep_kort');
  });
});

// ---------------------------------------------------------------------------
// KRAV-4: ordningen — verifiering, spärrmapp, prognos
// ---------------------------------------------------------------------------

describe('KRAV-4: verifiering → spärrmapp → prognos, i den ordningen', () => {
  it('härledningsordningen står i svaret, och varje värde bär källa', async () => {
    const svar = await svep({
      uppdrag: [{
        contract_id: avtal,
        sparrmapp_id: SPARRMAPP,
        referenser: [
          {
            referens_id: refL3,
            lage: { finns: true, hash: 'sha256:abc', titel: 'Offert Axis Communications AB – integrationslagret' },
            foralderkedja: ['0AKxFas2', SPARRMAPP],
          },
          { referens_id: refKalender, lage: { finns: true } },
        ],
        kalenderhandelser: [
          { datum: '2026-10-08', minuter: 60 },
          { datum: '2026-10-01', minuter: 120 },
        ],
      }],
    });

    expect(svar.uppdrag).toHaveLength(1);
    const utfall = svar.uppdrag[0]!;
    expect(utfall.contract_id).toBe(avtal);
    expect(utfall.referenser_verifierade).toBe(2);
    // Ordningen ÄR kravet: referenserna först, spärrmappen på deras kedjor,
    // prognosen sist.
    expect(utfall.nycklar).toEqual([
      'referenser:drive', 'referenser:kalender', 'sparrmapp', 'prognos',
    ]);

    const rader = await cache();
    for (const rad of rader) {
      expect(rad.kalla, `${rad.nyckel} saknar källa`).toBeTruthy();
    }
    expect(rader.find((r) => r.nyckel === 'prognos')!.kalla).toBe('kalender');
    expect(rader.find((r) => r.nyckel === 'sparrmapp')!.kalla).toBe('drive');

    // Prognosen räknas ur indatans kalenderhändelser — minuter som heltal.
    expect(varde(rader, 'prognos')).toEqual({
      handelser: 2, bokade_minuter: 180, forsta: '2026-10-01', sista: '2026-10-08',
    });
    expect(varde(rader, 'sparrmapp')).toEqual({ ok: true, provade: 1, utanfor: [] });
  });

  it('lästidpunkten stämplas: last_nar på cachen och senast_verifierad på referensen', async () => {
    const rader = await withAdmin(async (c) => (await c.query<{ nyckel: string; last_nar: string }>(
      'SELECT nyckel, last_nar::text FROM uppdrag_svepvarde WHERE contract_id = $1', [avtal],
    )).rows);
    expect(rader.length).toBeGreaterThan(0);
    for (const rad of rader) expect(rad.last_nar, `${rad.nyckel} saknar lästidpunkt`).toBeTruthy();

    const ref = await withAdmin(async (c) => (await c.query<{ senast_verifierad: string | null }>(
      'SELECT senast_verifierad::text FROM uppdrag_referens WHERE id = $1', [refL3],
    )).rows[0]!);
    expect(ref.senast_verifierad).toBeTruthy();
  });

  it('cachen bär läget EFTER verifieringen — en drift kan inte ha varit känd före', async () => {
    await svep({
      uppdrag: [{
        contract_id: avtal,
        sparrmapp_id: SPARRMAPP,
        referenser: [
          // Hashen har bytts i Drive: drift, inte trasig (S7.1).
          { referens_id: refL3, lage: { finns: true, hash: 'sha256:NY' }, foralderkedja: [UTANFOR_MAPP] },
        ],
      }],
    });
    const rader = await cache();
    expect(varde(rader, 'referenser:drive')).toMatchObject({
      antal: 1, levande: 0, drift: 1, trasig: 0,
    });
    const avvikande = (varde(rader, 'referenser:drive').avvikande as Array<Record<string, unknown>>);
    expect(avvikande).toHaveLength(1);
    expect(avvikande[0]!.avvikelser).toEqual(['hash']);
    // Spärrmappen prövas på kedjan i samma svep: filen ligger utanför.
    expect(varde(rader, 'sparrmapp')).toEqual({ ok: false, provade: 1, utanfor: [refL3] });
    // Kalenderreferensen kom inte med i det här svepet: cachen speglar det
    // SENASTE svepet, inte en hopsamling av alla.
    expect(rader.map((r) => r.nyckel)).not.toContain('referenser:kalender');
  });

  it('en referens som inte finns fäller hela svepet — ingen halvskriven cache', async () => {
    const fore = await cache();
    const res = await act('kor_uppdragssvep', {
      uppdrag: [{ contract_id: avtal, referenser: [{ referens_id: OKANT_ID, lage: { finns: true } }] }],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(404);
    expect(await cache()).toEqual(fore);
  });

  it('en referens under ett ANNAT uppdrag hör inte hit', async () => {
    const annat = await nyttUppdrag('NVR-002');
    const res = await act('kor_uppdragssvep', {
      uppdrag: [{ contract_id: annat.contractId, referenser: [{ referens_id: refL3, lage: { finns: true } }] }],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// KRAV-2: låset
// ---------------------------------------------------------------------------

describe('KRAV-2: ett svep i taget per bolag', () => {
  it('två samtidiga svep ger ett svep_avstod — aldrig en tyst tom retur', async () => {
    const fore = await cache();
    let slappForsta: () => void = () => {};
    const grind = new Promise<void>((r) => { slappForsta = r; });
    let forstaTogLaset: () => void = () => {};
    const laset = new Promise<void>((r) => { forstaTogLaset = r; });

    const forsta = withTenantTransaction(user.userId, companyId, async (client: PoolClient) => {
      const svar = await korUppdragssvep(client, companyId, user.userId, 'human', { uppdrag: [{ contract_id: avtal }] });
      forstaTogLaset();
      await grind;
      return svar;
    });
    await laset;

    const andra = await withTenantTransaction(user.userId, companyId, (client: PoolClient) =>
      korUppdragssvep(client, companyId, user.userId, 'human', { uppdrag: [{ contract_id: avtal }] }));
    expect(andra).toEqual({ lage: 'svep_avstod' });

    slappForsta();
    expect((await forsta).lage).toBe('svep_kort');

    // Det avstådda svepet skrev ingenting; det som fick låset skrev sin prognos.
    const efter = await cache();
    expect(efter.map((r) => r.nyckel)).toEqual(['prognos']);
    expect(efter).not.toEqual(fore);
  });

  it('ett annat bolags svep hindras inte — låset är per bolag', async () => {
    let slapp: () => void = () => {};
    const grind = new Promise<void>((r) => { slapp = r; });
    let tog: () => void = () => {};
    const laset = new Promise<void>((r) => { tog = r; });

    const vart = withTenantTransaction(user.userId, companyId, async (client: PoolClient) => {
      const svar = await korUppdragssvep(client, companyId, user.userId, 'human', {});
      tog();
      await grind;
      return svar;
    });
    await laset;
    const hosGrannen = await withTenantTransaction(granne.userId, grannbolag, (client: PoolClient) =>
      korUppdragssvep(client, grannbolag, granne.userId, 'human', {}));
    expect(hosGrannen.lage).toBe('svep_kort');
    slapp();
    expect((await vart).lage).toBe('svep_kort');
  });
});

// ---------------------------------------------------------------------------
// KRAV-3: stängda uppdrag hoppas
// ---------------------------------------------------------------------------

describe('KRAV-3: ett avslutat uppdrag rörs inte', () => {
  beforeAll(async () => {
    const stangt = await nyttUppdrag('NVR-Avslutat');
    stangtAvtal = stangt.contractId;
    refStangt = await referens(stangtAvtal, {
      sort: 'drive',
      extern_id: '1ZzYyXxWwVvUuTtSsRrQqPpOoNnMmLlKk',
      extern_nyckel: 'leverabel-handling',
      extern_kalla: 'drive:locollabs',
    });
    // set_project_status kräver en människa (S0.1) — vår token är just det.
    await ok('set_project_status', { project_id: stangt.projektId, status: 'closed' });
  });

  it('svepet hoppar uppdraget, skriver ingen cache och verifierar ingen referens', async () => {
    const svar = await svep({
      uppdrag: [
        { contract_id: stangtAvtal, referenser: [{ referens_id: refStangt, lage: { finns: false } }] },
        { contract_id: avtal, kalenderhandelser: [{ datum: '2026-10-01', minuter: 30 }] },
      ],
    });

    expect(svar.hoppade).toHaveLength(1);
    expect(svar.hoppade[0]).toMatchObject({ contract_id: stangtAvtal, projektstatus: 'closed' });
    expect(svar.uppdrag.map((u) => u.contract_id)).toEqual([avtal]);

    expect(await cache(stangtAvtal)).toEqual([]);
    const ref = await withAdmin(async (c) => (await c.query<{ senast_verifierad: string | null; status: string }>(
      'SELECT senast_verifierad::text, status FROM uppdrag_referens WHERE id = $1', [refStangt],
    )).rows[0]!);
    expect(ref.senast_verifierad).toBeNull();
    expect(ref.status).toBe('levande');
  });

  it('det stängda uppdragets referenser och köposter står inte i arbetslistan', async () => {
    const svar = await svep({});
    expect(svar.arbetslista.referenser.map((r) => r.referens_id)).not.toContain(refStangt);
    expect(svar.arbetslista.drive_ko.map((k) => k.contract_id)).not.toContain(stangtAvtal);
  });

  it('en Drive-rapport mot ett uppdrag som stängts sedan kön delades ut fäller inte svepet', async () => {
    // Kön delas bara ut för öppna uppdrag — men uppdraget kan stängas MELLAN två
    // svep, och då kommer Hermes rapport tillbaka mot ett stängt uppdrag.
    // `rapporteraDriveKopia` gör en UPDATE på `uppdrag_referens`, samma tabell
    // som 0068:s trigger vaktar: en orapporterad rapport hade fällt HELA
    // bolagets svep med ett rått databasfel, och gjort om det vid varje nytt
    // svep så länge köposten stod kvar.
    const sent = await nyttUppdrag('NVR-Stangt-Efter-Ko');
    await ok('importera_leveranskontrakt', { contract_id: sent.contractId, kontraktstext: LEVERANSKONTRAKT_NVR001 });
    const post = (await svep({})).arbetslista.drive_ko.find((k) => k.contract_id === sent.contractId);
    expect(post, 'registerkopian saknas i kön').toBeDefined();

    await ok('set_project_status', { project_id: sent.projektId, status: 'closed' });

    const svar = await svep({
      drive_kopior: [{
        referens_id: post!.referens_id,
        utfall: { lage: 'skriven', drive_id: '1SkRiVeNeFtErAttUppdragetStangts1' },
      }],
      uppdrag: [{ contract_id: avtal, kalenderhandelser: [{ datum: '2026-10-02', minuter: 15 }] }],
    });

    // Rapporten hoppas och REDOVISAS — ett tyst hopp hade sett ut som en tömd kö.
    expect(svar.hoppade_kopior).toEqual([{
      referens_id: post!.referens_id,
      contract_id: sent.contractId,
      project_id: sent.projektId,
      projektstatus: 'closed',
    }]);
    // Resten av bolagets svep gick igenom: en rollback hade lämnat cachen orörd.
    expect(svar.uppdrag.map((u) => u.contract_id)).toEqual([avtal]);
    expect(varde(await cache(), 'prognos')).toMatchObject({ handelser: 1, bokade_minuter: 15 });

    // Köposten står orörd: platshållaren kvar, statusen kvar på koad.
    const rad = await withAdmin(async (c) => (await c.query<{ extern_id: string; ko_status: string | null }>(
      'SELECT extern_id, ko_status FROM uppdrag_referens WHERE id = $1', [post!.referens_id],
    )).rows[0]!);
    expect(rad.ko_status).toBe('koad');
    expect(rad.extern_id).toBe(`registerkopia:${sent.contractId}`);
    // ...och den delas inte ut igen: arbetslistan bär bara öppna uppdrags kö.
    expect(svar.arbetslista.drive_ko.map((k) => k.contract_id)).not.toContain(sent.contractId);
  });
});

// ---------------------------------------------------------------------------
// KRAV-5 + KRAV-6: förslagen
// ---------------------------------------------------------------------------

/** Det riggade indatat som föder båda förslagsraderna. */
function forslagsindata(): SvepIndata {
  return {
    uppdrag: [{
      contract_id: avtal,
      sparrmapp_id: SPARRMAPP,
      referenser: [{
        referens_id: refL3,
        lage: { finns: true, hash: 'sha256:abc' },
        leverabel_kod: 'L3',
        revision: 4,
        foralderkedja: [SPARRMAPP],
      }],
      kalenderhandelser: [{ datum: '2026-10-01', minuter: 120 }],
    }],
  };
}

describe('KRAV-5/6: statusförslaget och kostnadsförslaget', () => {
  it('båda förslagsraderna uppstår ur riggat indata, i härledningsordning', async () => {
    const svar = await svep(forslagsindata());
    const utfall = svar.uppdrag[0]!;
    expect(utfall.nycklar.slice(0, 4)).toEqual(['referenser:drive', 'sparrmapp', 'prognos', 'statusforslag:L3']);
    expect(utfall.nycklar.filter((n) => n.startsWith('kostnadsforslag:'))).toHaveLength(3);
    expect(utfall.okanda_leverabelkoder).toEqual([]);

    const rader = await cache();
    expect(varde(rader, 'statusforslag:L3')).toMatchObject({
      leverabel_kod: 'L3', revision: 4, referens_id: refL3, referensstatus: 'levande', avvikelser: [],
    });
    expect(rader.find((r) => r.nyckel === 'statusforslag:L3')!.kalla).toBe('drive');
  });

  it('FR-33: strömmen vars intervall täcker datumet, annars rotdelen UPPDRAG', async () => {
    const rader = await cache();
    // 2026-11-20 ligger i S2 (2026-10 – 2027-02).
    expect(varde(rader, `kostnadsforslag:${kvittoS2}`)).toMatchObject({
      receipt_id: kvittoS2, datum: '2026-11-20', leverantor: 'Axis Communications AB',
      leverabel_kod: 'L3', forslag_kod: 'S2', forslag_part_id: delS2,
    });
    // 2026-03-05 ligger utanför varje ström → rotdelen, aldrig en leverabel.
    expect(varde(rader, `kostnadsforslag:${kvittoRot}`)).toMatchObject({
      datum: '2026-03-05', forslag_kod: 'UPPDRAG', forslag_part_id: delRot,
    });
    // Oktober täcks av BÅDE S1 och S2 i kontraktet. Valet följer avtalets egen
    // ordning (sort_order) och är därmed detsamma vid varje körning.
    expect(varde(rader, `kostnadsforslag:${kvittoS1}`)).toMatchObject({
      datum: '2026-10-15', forslag_kod: 'S1', forslag_part_id: delS1,
    });
    expect(varde(rader, `kostnadsforslag:${kvittoS2}`).belopp_ore).toBe(500000);
  });

  it('bara bokförda, obundna kvitton med matchande leverantör får förslag', async () => {
    const nycklar = (await cache()).map((r) => r.nyckel);
    // Ej bokfört kvitto: ingen kostnad ännu, alltså inget att binda.
    expect(nycklar).not.toContain(`kostnadsforslag:${kvittoObokat}`);
    // Telia matchar ingen leverabelhandlings titel.
    expect(nycklar.filter((n) => n.startsWith('kostnadsforslag:'))).toHaveLength(3);
  });

  it('en leverabelkod som inte finns i registret ger inget förslag — den redovisas', async () => {
    const svar = await svep({
      uppdrag: [{
        contract_id: avtal,
        referenser: [{
          referens_id: refL3, lage: { finns: true, hash: 'sha256:abc' }, leverabel_kod: 'L9', revision: 2,
        }],
      }],
    });
    expect(svar.uppdrag[0]!.okanda_leverabelkoder).toEqual(['L9']);
    expect((await cache()).map((r) => r.nyckel)).not.toContain('statusforslag:L9');
  });

  it('utan revision i indatat föds inget statusförslag', async () => {
    await svep({
      uppdrag: [{
        contract_id: avtal,
        referenser: [{ referens_id: refL3, lage: { finns: true, hash: 'sha256:abc' }, leverabel_kod: 'L3' }],
      }],
    });
    expect((await cache()).map((r) => r.nyckel)).not.toContain('statusforslag:L3');
  });
});

// ---------------------------------------------------------------------------
// KRAV-9: idempotens och de negativa kontrollerna
// ---------------------------------------------------------------------------

describe('KRAV-9: samma indata två gånger, och ägandegränsen', () => {
  it('samma indata två gånger ger samma rader — cachen är omräkningsbar', async () => {
    const forsta = await svep(forslagsindata());
    const efterForsta = await cache();
    const andra = await svep(forslagsindata());
    const efterAndra = await cache();

    expect(efterAndra).toEqual(efterForsta);
    expect(andra.uppdrag[0]!.nycklar).toEqual(forsta.uppdrag[0]!.nycklar);
    expect(andra.uppdrag[0]!.borttagna).toBe(0);
  });

  // S6.1 gav svepet ETT skrivfall mot `receipts`: ett kostnadsförslag UTAN löv
  // binds automatiskt till strömmen/rotdelen (se uppdragsytan-bindning-svep).
  // Här bär varje förslag sitt löv (L3), och då är kvittot fortfarande orört —
  // lövet är ett omdöme, och det ligger i kön tills en människa svarat.
  it('svepet skriver aldrig i uppdrag_leverabel, och inte i receipts när förslaget bär ett löv', async () => {
    const las = async () => withAdmin(async (c) => ({
      leverabler: (await c.query(
        'SELECT * FROM uppdrag_leverabel WHERE contract_id = $1 ORDER BY kod', [avtal],
      )).rows,
      kvitton: (await c.query(
        'SELECT * FROM receipts WHERE company_id = $1 ORDER BY receipt_number', [companyId],
      )).rows,
    }));

    const fore = await las();
    expect(fore.leverabler).toHaveLength(6);
    expect(fore.kvitton.length).toBeGreaterThan(0);
    await svep(forslagsindata());
    const efter = await las();

    expect(efter.leverabler).toEqual(fore.leverabler);
    // Bindningen är ett FÖRSLAG: kvittots contract_part_id står orört kvar.
    expect(efter.kvitton).toEqual(fore.kvitton);
    for (const kvitto of efter.kvitton as Array<{ contract_part_id: string | null }>) {
      expect(kvitto.contract_part_id).toBeNull();
    }
  });

  it('svepet gör inga nätverksanrop — varken i koden eller under körningen', async () => {
    const kalla = await readFile(KALLA, 'utf8');
    for (const forbjudet of ['fetch(', 'node:http', 'node:https', 'require(', 'axios']) {
      expect(kalla, `svepet får inte innehålla ${forbjudet}`).not.toContain(forbjudet);
    }

    const riktig = globalThis.fetch;
    globalThis.fetch = (() => { throw new Error('svepet ringde ut'); }) as typeof globalThis.fetch;
    try {
      const svar = await svep(forslagsindata());
      expect(svar.uppdrag).toHaveLength(1);
    } finally {
      globalThis.fetch = riktig;
    }
  });
});

// ---------------------------------------------------------------------------
// KRAV-7: svaret är nästa arbetslista
// ---------------------------------------------------------------------------

describe('KRAV-7: nästa arbetslista', () => {
  it('referenserna bär extern_id, extern_kalla och hash_vid_lankning', async () => {
    const svar = await svep({});
    const rad = svar.arbetslista.referenser.find((r) => r.referens_id === refL3);
    expect(rad, 'L3-referensen saknas i arbetslistan').toBeDefined();
    expect(rad!.extern_id).toBe('1AbCdEfGhIjKlMnOpQrStUvWxYz0123456');
    expect(rad!.extern_kalla).toBe('drive:locollabs');
    expect(rad!.hash_vid_lankning).toBe('sha256:abc');
    expect(rad!.sort).toBe('drive');
    expect(svar.arbetslista.referenser.map((r) => r.referens_id)).toContain(refKalender);
  });

  it('Drive-kön kommer ur hamtaDriveKo, och en köad kopia står inte bland referenserna', async () => {
    const svar = await svep({});
    const post = svar.arbetslista.drive_ko.find((k) => k.contract_id === avtal);
    expect(post, 'importens köade registerkopia saknas').toBeDefined();
    expect(post!.ko_status).toBe('koad');
    expect(post!.extern_id).toBe(`registerkopia:${avtal}`);
    expect(post!.innehall).toHaveLength(6);
    // Platshållar-id:t går inte att verifiera i Drive — posten hör till kön.
    expect(svar.arbetslista.referenser.map((r) => r.referens_id)).not.toContain(post!.referens_id);
  });

  it('en rapporterad kopia lämnar kön och blir en referens att verifiera', async () => {
    const fore = await svep({});
    const post = fore.arbetslista.drive_ko.find((k) => k.contract_id === avtal)!;
    const driveId = '1KoPiAnSkRiVeNtIlLdRiVeMaPpEn12345';

    const efter = await svep({
      drive_kopior: [{ referens_id: post.referens_id, utfall: { lage: 'skriven', drive_id: driveId } }],
    });
    expect(efter.arbetslista.drive_ko.map((k) => k.referens_id)).not.toContain(post.referens_id);
    const nu = efter.arbetslista.referenser.find((r) => r.referens_id === post.referens_id);
    expect(nu, 'den skrivna kopian ska gå att verifiera').toBeDefined();
    expect(nu!.extern_id).toBe(driveId);
  });
});

// ---------------------------------------------------------------------------
// Tenantgränsen
// ---------------------------------------------------------------------------

describe('tenantgränsen', () => {
  it('grannbolagets svep ser varken våra uppdrag eller våra referenser', async () => {
    const res = await api.post(`/api/companies/${grannbolag}/actions/kor_uppdragssvep`)
      .set({ Authorization: `Bearer ${granne.token}` }).send({});
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const svar = res.body.result as SvepKort;
    expect(svar.arbetslista.referenser).toEqual([]);
    expect(svar.arbetslista.drive_ko).toEqual([]);
  });

  it('ett grannbolags avtal i indatat ger 404, inte en tyst tom körning', async () => {
    const grannprojekt = await api.post(`/api/companies/${grannbolag}/actions/create_project`)
      .set({ Authorization: `Bearer ${granne.token}` }).send({ name: 'Grannens uppdrag' });
    expect(grannprojekt.status, JSON.stringify(grannprojekt.body)).toBe(200);
    const grannavtal = await api.post(`/api/companies/${grannbolag}/actions/skapa_uppdrag`)
      .set({ Authorization: `Bearer ${granne.token}` })
      .send({ project_id: grannprojekt.body.result.id, name: 'Grannens avtal', signed_date: '2026-09-03' });
    expect(grannavtal.status, JSON.stringify(grannavtal.body)).toBe(200);

    const res = await act('kor_uppdragssvep', {
      uppdrag: [{ contract_id: grannavtal.body.result.contract_id }],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(404);
  });
});
