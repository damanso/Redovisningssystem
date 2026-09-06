// Uppdragsytan S6.1, våg 4: svepets BINDNINGSSTEG (PRD FR-33).
//
// Storyn har två grenar och en tystnad, och alla tre kan gå sönder utan att
// någonting ser fel ut:
//
//   * **Gren 1 — förslaget bär ett löv.** Vilket löv en kostnad hör till är ett
//     omdöme. Svepet KÖAR `binda_kostnad` och skriver ingenting; idempotent per
//     kvitto, annars föder varje nattligt svep en ny post om samma kvitto tills
//     kön är oläslig.
//   * **Gren 2 — inget löv kan föreslås.** Då finns inget att fråga om: svepet
//     binder till strömmen vars intervall täcker datumet, annars rotdelen
//     `UPPDRAG`, märker kostnaden `oplanerad` — och köar INGENTING. En köpost
//     här hade varit det femte återkommande handgreppet.
//   * **Tystnaden.** Ett kvitto utan kostnadsförslag är en allmän bolagskostnad.
//     Det ska stå obundet efter svepet, för alltid, tills någon säger annat.
//
// Dessutom lövvakten (KRAV-6, `bakvag.py`:s fjärde kontroll): automatbindningen
// får ALDRIG landa på ett löv. Vakten sitter i skrivvägen, inte bara i valet
// ovanför den, och prövas därför både direkt och i utfallet.
import supertest from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { withTenantTransaction } from '../src/db/tx.js';
import {
  bindSvepetsForslag, kravAutomatmal, type Bindningsdel, type Bindningsdelar,
} from '../src/services/uppdragKostnad.js';
import { skapaReferens } from '../src/services/uppdragReferens.js';
import type { SvepIndata, Svepsvar, Uppdragsutfall } from '../src/services/uppdragSvep.js';
import { LEVERANSKONTRAKT_NVR001 } from './fixtures/leveranskontrakt-nvr-001.js';
import { app, api, createCompany, createFiscalYear, registerUser, withAdmin, type TestUser } from './helpers.js';

const PASSWORD = 'mycket-hemligt-losen-123';

let user: TestUser;
let companyId = '';
let ua: ReturnType<typeof supertest.agent>;

let avtalA = '';
let avtalB = '';
let refA = '';
let refB = '';
let lovL3A = '';
let rotB = '';
let stromS2B = '';

let axisTidig = '';
let axisSen = '';
let teliaTidig = '';
let teliaSen = '';
let allmant = '';

const auth = () => ({ Authorization: `Bearer ${user.token}` });
const co = () => `/api/companies/${companyId}`;

type Svar = { status: number; body: Record<string, unknown> };
type SvepKort = Extract<Svepsvar, { lage: 'svep_kort' }>;

async function act(namn: string, kropp: Record<string, unknown>): Promise<Svar> {
  const res = await api.post(`${co()}/actions/${namn}`).set(auth()).send(kropp);
  return res as unknown as Svar;
}

async function ok(namn: string, kropp: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await act(namn, kropp);
  expect(res.status, `${namn}: ${JSON.stringify(res.body)}`).toBe(200);
  return res.body.result as Record<string, unknown>;
}

/** En känslig åtgärd hela vägen: begäran (202) + godkännande (200). */
async function okKoad(namn: string, kropp: Record<string, unknown>): Promise<Record<string, unknown>> {
  const begaran = await act(namn, kropp);
  expect(begaran.status, `${namn}: ${JSON.stringify(begaran.body)}`).toBe(202);
  const svar = await api.post(`${co()}/approvals/${(begaran.body.approval as { id: string }).id}/approve`)
    .set(auth()).send({});
  expect(svar.status, `${namn} (godkännande): ${JSON.stringify(svar.body)}`).toBe(200);
  return svar.body.result as Record<string, unknown>;
}

/** Svepet genom hela stacken — samma väg som Hermes går (S7.5). */
async function svep(indata: SvepIndata): Promise<Uppdragsutfall> {
  const res = await ok('kor_uppdragssvep', indata as Record<string, unknown>);
  const svar = res as unknown as Svepsvar;
  expect(svar.lage, 'svepet avstod oväntat').toBe('svep_kort');
  const uppdrag = (svar as SvepKort).uppdrag;
  expect(uppdrag).toHaveLength(1);
  return uppdrag[0]!;
}

/** Svepets indata för ETT uppdrag: en handling med sin leverabelkod. */
function indata(contractId: string, referensId: string, kod: string): SvepIndata {
  return { uppdrag: [{ contract_id: contractId, referenser: [{ referens_id: referensId, lage: { finns: true }, leverabel_kod: kod }] }] };
}

interface Kvittorad { id: string; contract_part_id: string | null; oplanerad: boolean; code: string | null }

/** Kvittona som de STÅR, förbi hela applikationslagret. */
async function kvitton(): Promise<Map<string, Kvittorad>> {
  const rader = await withAdmin(async (c) => (await c.query<Kvittorad>(
    `SELECT r.id, r.contract_part_id, r.oplanerad, cp.code
       FROM receipts r
       LEFT JOIN contract_parts cp ON cp.id = r.contract_part_id
      WHERE r.company_id = $1`,
    [companyId],
  )).rows);
  return new Map(rader.map((r) => [r.id, r]));
}

interface Auditrad { action: string; entity_id: string | null; details: Record<string, unknown> }

async function audit(action: string): Promise<Auditrad[]> {
  return withAdmin(async (c) => (await c.query<Auditrad>(
    `SELECT action, entity_id, details FROM audit_log
      WHERE company_id = $1 AND action = $2 ORDER BY occurred_at, id`,
    [companyId, action],
  )).rows);
}

interface Kopost { id: string; action: string; input: Record<string, unknown> }

async function bindningskon(): Promise<Kopost[]> {
  const res = await api.get(`${co()}/approvals?status=pending`).set(auth());
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return (res.body.approvals as Kopost[]).filter((p) => p.action === 'binda_kostnad');
}

/** Samma form som bindningssteget får ur svepets `bindningsmal`. */
async function bindningsdelar(contractId: string): Promise<Bindningsdelar> {
  const rader = await withAdmin(async (c) => (await c.query<Bindningsdel>(
    `SELECT id AS part_id, code, parent_part_id, start_date::text, end_date::text
       FROM contract_parts WHERE contract_id = $1 AND active ORDER BY sort_order, code`,
    [contractId],
  )).rows);
  const rot = rader.find((r) => r.code === 'UPPDRAG' && r.parent_part_id === null)!;
  expect(rot, 'rotdelen UPPDRAG saknas').toBeDefined();
  return { rot, strommar: rader.filter((r) => r.parent_part_id === rot.part_id), alla: rader };
}

async function nyttUppdrag(namn: string): Promise<string> {
  const projekt = (await ok('create_project', { name: namn })).id as string;
  const avtal = (await ok('skapa_uppdrag', {
    project_id: projekt, name: `Leveranskontrakt ${namn}`, signed_date: '2026-09-03',
  })).contract_id as string;
  await ok('importera_leveranskontrakt', { contract_id: avtal, kontraktstext: LEVERANSKONTRAKT_NVR001 });
  return avtal;
}

/** En referens skrivs genom S7.1:s tjänst — den har (med flit) ingen åtgärd. */
async function referens(contractId: string, externId: string, titel: string): Promise<string> {
  const rad = await withTenantTransaction(user.userId, companyId, (c) => skapaReferens(c, companyId, {
    contract_id: contractId,
    sort: 'drive',
    extern_id: externId,
    extern_nyckel: 'leverabel-handling',
    extern_kalla: 'drive:locollabs',
    titel_vid_lankning: titel,
  }));
  return rad.id;
}

async function bokatKvitto(datum: string, leverantorId: string, text: string): Promise<string> {
  const rad = await ok('create_receipt', {
    supplier_id: leverantorId, receipt_date: datum, description: text,
    net_ore: 400000, vat_rate: 25, expense_account: 5460,
  });
  await okKoad('book_receipt', { receipt_id: rad.id as string });
  return rad.id as string;
}

async function delId(contractId: string, code: string): Promise<string> {
  const delar = await bindningsdelar(contractId);
  const rad = delar.alla.find((d) => d.code === code);
  expect(rad, `avtalsdelen ${code} saknas`).toBeDefined();
  return rad!.part_id;
}

beforeAll(async () => {
  user = await registerUser('svepbind');
  companyId = await createCompany(user.token, 'Locollabs AB');
  await createFiscalYear(companyId, auth(), { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });

  ua = supertest.agent(app);
  const login = await ua.post('/app/login').type('form').send({ email: user.email, password: PASSWORD });
  expect([302, 303]).toContain(login.status);

  // Två uppdrag med samma kontraktsform men olika leverantörer i handlingarnas
  // titlar: det är titeln som binder ett kvitto till en leverabel, så varje
  // uppdrag ser bara sina egna kvitton fastän `receipts` är bolagsgemensam.
  avtalA = await nyttUppdrag('NVR-001');
  avtalB = await nyttUppdrag('NVR-002');
  refA = await referens(avtalA, '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456',
    'Offert Axis Communications AB – integrationslagret');
  refB = await referens(avtalB, '1ZyXwVuTsRqPoNmLkJiHgFeDcBa9876543',
    'Ramavtal Telia Sverige AB – migrering av produktdata');
  lovL3A = await delId(avtalA, 'L3');
  rotB = await delId(avtalB, 'UPPDRAG');
  stromS2B = await delId(avtalB, 'S2');

  const axis = (await ok('create_supplier', { name: 'Axis Communications AB' })).id as string;
  const telia = (await ok('create_supplier', { name: 'Telia Sverige AB' })).id as string;
  const kontor = (await ok('create_supplier', { name: 'Kontorsgiganten AB' })).id as string;

  // 2026-03-05 ligger utanför varje ström (S1 börjar 2026-09), 2026-11-20 ligger
  // i S2 (2026-10 – 2027-02). Samma två datum i båda uppdragen.
  axisTidig = await bokatKvitto('2026-03-05', axis, 'Förstudiematerial');
  axisSen = await bokatKvitto('2026-11-20', axis, 'Integrationshårdvara');
  teliaTidig = await bokatKvitto('2026-03-05', telia, 'Uppkoppling testmiljö');
  teliaSen = await bokatKvitto('2026-11-20', telia, 'Datamigreringslicenser');
  allmant = await bokatKvitto('2026-11-21', kontor, 'Kontorsmateriel');
});

// ---------------------------------------------------------------------------
// Gren 1: förslaget bär ett löv → köpost, ingen skrivning
// ---------------------------------------------------------------------------

describe('gren 1: lövet är ett omdöme och går genom kön', () => {
  it('svepet köar binda_kostnad mot lövet — och rör inte kvittot', async () => {
    const utfall = await svep(indata(avtalA, refA, 'L3'));

    expect(utfall.bindningar.koade.map((k) => k.receipt_id).sort())
      .toEqual([axisTidig, axisSen].sort());
    expect(utfall.bindningar.koade.every((k) => k.contract_part_id === lovL3A)).toBe(true);
    expect(utfall.bindningar.automatiska).toEqual([]);
    expect(utfall.bindningar.redan_koade).toEqual([]);

    const ko = await bindningskon();
    expect(ko).toHaveLength(2);
    expect(ko.map((p) => p.input.contract_part_id)).toEqual([lovL3A, lovL3A]);

    // Det negativa: ingenting skrivet. Kvittot får sin del av godkännandet.
    const rader = await kvitton();
    expect(rader.get(axisTidig)).toMatchObject({ contract_part_id: null, oplanerad: false });
    expect(rader.get(axisSen)).toMatchObject({ contract_part_id: null, oplanerad: false });
    expect(await audit('receipt.contract_part_assigned')).toEqual([]);
  });

  it('köningen auditloggas som varje annan köad känslig åtgärd', async () => {
    const rader = await audit('action.approval_requested');
    const bindningar = rader.filter((r) => r.details.action === 'binda_kostnad');
    expect(bindningar).toHaveLength(2);
    expect(bindningar[0]!.details).toMatchObject({ action: 'binda_kostnad', actor: 'human', leverabel_kod: 'L3' });
    // Raden pekar på köposten, inte på kvittot: det är spåret av att någon BAD
    // om bindningen, inte av bindningen.
    expect((await bindningskon()).map((p) => p.id).sort())
      .toEqual(bindningar.map((r) => r.entity_id).sort());
  });

  it('idempotent per kvitto: ett andra svep ger ingen ny köpost', async () => {
    const utfall = await svep(indata(avtalA, refA, 'L3'));
    expect(utfall.bindningar.koade).toEqual([]);
    expect(utfall.bindningar.redan_koade.sort()).toEqual([axisTidig, axisSen].sort());
    expect(await bindningskon()).toHaveLength(2);
  });

  it('inget kvitto är märkt oplanerat ännu — vyn visar ingen märkning', async () => {
    const res = await ua.get(`/app/c/${companyId}/receipts`);
    expect(res.status).toBe(200);
    expect(res.text).not.toContain('Oplanerad');
  });
});

// ---------------------------------------------------------------------------
// Gren 2: inget löv kan föreslås → automatbindning, ingen köpost
// ---------------------------------------------------------------------------

describe('gren 2: utan löv binder svepet till strömmen, annars rotdelen', () => {
  it('svepet binder per datum, märker oplanerad — och köar ingenting', async () => {
    // Leverabeln finns kvar i registret men har ingen AKTIV avtalsdel: då finns
    // inget löv att föreslå, och det är gren 2 som gäller. (Samma versionsregel
    // som `bindningsmal` — en inaktiv version är inte ett bindningsmål.)
    await okKoad('upsert_contract_part', { contract_id: avtalB, code: 'L4', active: false });
    const koFore = await bindningskon();

    const utfall = await svep(indata(avtalB, refB, 'L4'));

    expect(utfall.bindningar.koade).toEqual([]);
    expect(utfall.bindningar.redan_koade).toEqual([]);
    const per = new Map(utfall.bindningar.automatiska.map((a) => [a.receipt_id, a]));
    // 2026-11-20 täcks av S2; 2026-03-05 av ingen ström → rotdelen UPPDRAG.
    expect(per.get(teliaSen)).toEqual({ receipt_id: teliaSen, contract_part_id: stromS2B, kod: 'S2' });
    expect(per.get(teliaTidig)).toEqual({ receipt_id: teliaTidig, contract_part_id: rotB, kod: 'UPPDRAG' });

    const rader = await kvitton();
    expect(rader.get(teliaSen)).toMatchObject({ contract_part_id: stromS2B, code: 'S2', oplanerad: true });
    expect(rader.get(teliaTidig)).toMatchObject({ contract_part_id: rotB, code: 'UPPDRAG', oplanerad: true });

    // Kön är orörd: automatbindningen är inget beslut att fatta.
    expect(await bindningskon()).toEqual(koFore);
  });

  it('auditraden säger att ingen människa svarade: `bindning: automatisk`', async () => {
    const rader = await audit('receipt.contract_part_assigned');
    expect(rader.map((r) => r.entity_id).sort()).toEqual([teliaSen, teliaTidig].sort());
    for (const rad of rader) {
      expect(rad.details).toMatchObject({
        fran_contract_part_id: null, bindning: 'automatisk', oplanerad: true,
      });
    }
  });

  it('aldrig till ett löv: varje automatbindning landade på rotdelen eller en ström', async () => {
    const delar = await bindningsdelar(avtalB);
    const tillatna = new Set([delar.rot.part_id, ...delar.strommar.map((s) => s.part_id)]);
    const rader = await kvitton();
    for (const id of [teliaSen, teliaTidig]) {
      expect(tillatna.has(rader.get(id)!.contract_part_id!)).toBe(true);
    }
  });

  it('vyn märker de bundna kvittona som oplanerade', async () => {
    const res = await ua.get(`/app/c/${companyId}/receipts`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Oplanerad');
    // Märkningen bär sitt eget svar — en chip ingen kan tyda är ingen märkning.
    expect(res.text).toContain('fanns inte i uppdragets avtalade omfattning');
  });
});

// ---------------------------------------------------------------------------
// Tystnaden, flyttspärren och lövvakten
// ---------------------------------------------------------------------------

describe('det svepet aldrig rör', () => {
  it('ett kvitto utan kostnadsförslag står obundet efter varje svep', async () => {
    await svep(indata(avtalA, refA, 'L3'));
    await svep(indata(avtalB, refB, 'L4'));
    // Kontorsgiganten står inte i någon leverabelhandlings titel: kostnaden är
    // bolagets egen, inte uppdragets, och automatiken rör den aldrig.
    expect((await kvitton()).get(allmant)).toMatchObject({ contract_part_id: null, oplanerad: false });
  });

  it('automatbindningen är aldrig en flytt: ett bundet kvitto skrivs inte om', async () => {
    // Ett riggat förslag utan löv om ett kvitto som REDAN är bundet — precis
    // det fallet `WHERE contract_part_id IS NULL` finns för. Svepets egen väg
    // kommer inte hit (bundna kvitton får inget förslag), och därför prövas
    // spärren där den sitter.
    const fore = await audit('receipt.contract_part_assigned');
    const delar = await bindningsdelar(avtalB);
    const utfall = await withTenantTransaction(user.userId, companyId, (c) => bindSvepetsForslag(
      c, companyId, user.userId, 'human',
      [{ receipt_id: teliaSen, datum: '2026-03-05' }], delar,
    ));
    expect(utfall.automatiska).toEqual([]);
    expect((await kvitton()).get(teliaSen)).toMatchObject({ contract_part_id: stromS2B, code: 'S2' });
    expect(await audit('receipt.contract_part_assigned')).toEqual(fore);
  });

  it('lövvakten fäller varje automatmål som inte är rotdelen eller en ström', async () => {
    const delar = await bindningsdelar(avtalB);
    const lov = delar.alla.find((d) => d.code === 'L1')!;
    expect(lov, 'leverabeln L1 saknas').toBeDefined();
    // Vakten är den sista raden före skrivningen, inte valet ovanför den: den
    // ska fälla ett löv även den dag valet ändras. Det är `bakvag.py`:s fjärde
    // kontroll, i vitest-form.
    expect(() => kravAutomatmal(delar, lov.part_id)).toThrow(/löv/);
    expect(() => kravAutomatmal(delar, delar.rot.part_id)).not.toThrow();
    expect(() => kravAutomatmal(delar, delar.strommar[0]!.part_id)).not.toThrow();
  });
});
