// Story 1.8, B-6: varje kostnadsförslag går genom kön, aldrig en direktbindning.
// Idempotensen gäller alla statusar. Ingen lövvakt behövs när inget mål skrivs
// automatiskt; K0 i kostnadsspärrsprovet prövar valet av löv, ström och rot.
// Kvitton utan förslag och redan bundna kvitton rörs aldrig av svepet.
import supertest from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { withTenantTransaction } from '../src/db/tx.js';
import {
  type Bindningsdel, type Bindningsdelar,
} from '../src/services/uppdragKostnad.js';
import { skapaReferens } from '../src/services/uppdragReferens.js';
import type { SvepIndata, Svepsvar, Uppdragsutfall } from '../src/services/uppdragSvep.js';
import { LEVERANSKONTRAKT_NVR001 } from './fixtures/leveranskontrakt-nvr-001.js';
import { importeraOchGodkann } from './uppdragImportHelper.js';
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
  const usage = await ok('get_contract_usage', { contract_id: contractId });
  const aktiva = (usage.parts as Array<{ part_id: string; parent_code: string | null; active: boolean }>)
    .filter((d) => d.active);
  const rader = await withAdmin(async (c) => (await c.query<Bindningsdel>(
    `SELECT id AS part_id, code, parent_part_id, start_date::text, end_date::text
       FROM contract_parts WHERE contract_id = $1 AND company_id = $2
        AND id = ANY($3::uuid[]) ORDER BY sort_order, code`,
    [contractId, companyId, aktiva.map((d) => d.part_id)],
  )).rows);
  const rot = rader.find((r) => r.code === 'UPPDRAG' && r.parent_part_id === null)!;
  expect(rot, 'rotdelen UPPDRAG saknas').toBeDefined();
  const stromIds = new Set(aktiva.filter((d) => d.parent_code === rot.code).map((d) => d.part_id));
  return { rot, strommar: rader.filter((r) => stromIds.has(r.part_id)), alla: rader };
}

async function nyttUppdrag(namn: string): Promise<string> {
  const projekt = (await ok('create_project', { name: namn })).id as string;
  const avtal = (await ok('skapa_uppdrag', {
    project_id: projekt, name: `Leveranskontrakt ${namn}`, signed_date: '2026-09-03',
  })).contract_id as string;
  await importeraOchGodkann(companyId, auth(), { contract_id: avtal, kontraktstext: LEVERANSKONTRAKT_NVR001 });
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
    expect(bindningar[0]!.details).toMatchObject({ action: 'binda_kostnad', actor: 'agent', leverabel_kod: 'L3' });
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
// Utan aktivt löv köas samma godkännande till strömmen eller roten.
// ---------------------------------------------------------------------------

describe('utan löv köar svepet till strömmen, annars rotdelen', () => {
  it('svepet föreslår per datum, utan bindning eller märkning', async () => {
    await okKoad('upsert_contract_part', { change_reason: 'avtal', contract_id: avtalB, code: 'L4', name: 'L4', valid_from: '2026-09-04', active: false });
    const koFore = await bindningskon();
    const utfall = await svep(indata(avtalB, refB, 'L4'));
    expect(utfall.bindningar.koade).toHaveLength(2);
    expect(utfall.bindningar.automatiska).toEqual([]);
    expect(utfall.bindningar.redan_koade).toEqual([]);
    for (const [receipt, del] of [[teliaSen, stromS2B], [teliaTidig, rotB]]) {
      expect(utfall.bindningar.koade).toContainEqual({ receipt_id: receipt, contract_part_id: del, approval_id: expect.any(String) });
      expect((await kvitton()).get(receipt!)).toMatchObject({ contract_part_id: null, oplanerad: false });
      const post = (await bindningskon()).find((p) => p.input.receipt_id === receipt)!;
      expect(post.input).toEqual({ receipt_id: receipt, contract_part_id: del });
      expect(post).toMatchObject({ requested_actor: 'agent' });
    }
    expect(await bindningskon()).toHaveLength(koFore.length + 2);
  });
  it('bara köningen auditloggas, med agentens aktör', async () => {
    expect(await audit('receipt.contract_part_assigned')).toEqual([]);
    const rader = (await audit('action.approval_requested')).filter((r) => r.details.action === 'binda_kostnad' && r.details.leverabel_kod === 'L4');
    expect(rader).toHaveLength(2);
    for (const r of rader) expect(r.details).toMatchObject({ actor: 'agent', leverabel_kod: 'L4' });
    expect(rader.map((r) => r.entity_id).sort()).toEqual((await bindningskon()).filter((p) => [teliaSen, teliaTidig].includes(p.input.receipt_id as string)).map((p) => p.id).sort());
  });
  it('köposternas mål är rotdelen eller en ström', async () => {
    const delar = await bindningsdelar(avtalB);
    const tillatna = new Set([delar.rot.part_id, ...delar.strommar.map((r) => r.part_id)]);
    for (const q of (await bindningskon()).filter((p) => [teliaSen, teliaTidig].includes(p.input.receipt_id as string))) {
      expect(tillatna.has(q.input.contract_part_id as string)).toBe(true);
    }
  });
  it('kvittolistan visar ingen Oplanerad-märkning', async () => {
    const res = await ua.get(`/app/c/${companyId}/receipts`);
    expect(res.status, res.text).toBe(200); expect(res.text).not.toContain('Oplanerad');
  });
});

// ---------------------------------------------------------------------------
// Tystnaden och redan bundna kvitton
// ---------------------------------------------------------------------------

describe('det svepet aldrig rör', () => {
  it('ett kvitto utan kostnadsförslag står obundet efter varje svep', async () => {
    await svep(indata(avtalA, refA, 'L3'));
    await svep(indata(avtalB, refB, 'L4'));
    // Kontorsgiganten står inte i någon leverabelhandlings titel: kostnaden är
    // bolagets egen, inte uppdragets, och automatiken rör den aldrig.
    expect((await kvitton()).get(allmant)).toMatchObject({ contract_part_id: null, oplanerad: false });
  });

  it('ett bundet kvitto får inget förslag och skrivs inte om', async () => {
    const post = (await bindningskon()).find((p) => p.input.receipt_id === teliaTidig)!;
    const ja = await api.post(`${co()}/approvals/${post.id}/approve`).set(auth()).send({});
    expect(ja.status, JSON.stringify(ja.body)).toBe(200);
    await svep(indata(avtalB, refB, 'L4'));
    expect((await kvitton()).get(teliaTidig)).toMatchObject({ contract_part_id: rotB, code: 'UPPDRAG' });
    const ko = await withAdmin(async (c) => (await c.query("SELECT id FROM action_approvals WHERE company_id=$1 AND action='binda_kostnad' AND input->>'receipt_id'=$2", [companyId, teliaTidig])).rows);
    expect(ko).toHaveLength(1);
    const rader = (await audit('receipt.contract_part_assigned')).filter((r) => r.entity_id === teliaTidig);
    expect(rader).toHaveLength(1); expect(rader[0]!.details).not.toHaveProperty('bindning');
  });
});

// B-7: när inaktivering blir en NY version får läsningen inte återuppliva
// äldre aktiva rader. Prova hela trädet, och därefter en aktiv tredje version.
describe('bindningsmål efter nya baselineversioner', () => {
  it.each(['L1', 'L4', 'S2', 'UPPDRAG'])('%s: senaste versionens active gäller, historiken står kvar', async (kod) => {
    const avtal = await nyttUppdrag(`Versioner ${kod}`);
    const ursprungliga = await bindningsdelar(avtal);
    const del = ursprungliga.alla.find((d) => d.code === kod)!;
    const strom = ursprungliga.strommar.find((d) => d.code === 'S2')!;
    const fore = await withAdmin(async (c) => (await c.query(
      'SELECT * FROM contract_parts WHERE contract_id = $1 ORDER BY id', [avtal],
    )).rows);
    // Utan ett aktivt löv ska ström/rot avgöra förslagets mål även när det är
    // just strömmen eller roten som har fått en inaktiv version.
    if (kod === 'S2' || kod === 'UPPDRAG') {
      await okKoad('upsert_contract_part', {
        contract_id: avtal, code: 'L4', name: 'L4', valid_from: '2026-09-04',
        change_reason: 'Leverabeln utgår ur avtalet', active: false,
      });
    }
    await okKoad('upsert_contract_part', {
      contract_id: avtal, code: kod, name: kod, valid_from: '2026-09-04',
      change_reason: 'Avtalsdelen utgår ur avtalet', active: false,
    });
    const leverantor = `Versionsleverantören ${kod}`;
    const supplierId = (await ok('create_supplier', { name: leverantor })).id as string;
    const ref = await referens(avtal, '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456', `Offert ${leverantor}`);
    const kvitto = await bokatKvitto('2026-11-20', supplierId, 'Versionsprov');
    const leverabel = kod.startsWith('L') ? kod : 'L4';
    const koFore = await bindningskon();
    const utfall = await svep(indata(avtal, ref, leverabel));
    const mal = kod === 'UPPDRAG' ? null : kod === 'S2' ? ursprungliga.rot : strom;
    expect(utfall.bindningar.koade).toEqual(mal === null ? [] : [{
      receipt_id: kvitto, contract_part_id: mal.part_id, approval_id: expect.any(String),
    }]);
    expect(utfall.bindningar.automatiska).toEqual([]);
    expect((await kvitton()).get(kvitto)).toMatchObject({ contract_part_id: null, oplanerad: false });
    expect(await bindningskon()).toHaveLength(koFore.length + (mal === null ? 0 : 1));

    // En ny aktiv version får användas. Barnens lagrade föräldralänkar pekar
    // fortfarande på den äldre versionen; de får inte behöva skrivas om.
    const ny = await okKoad('upsert_contract_part', {
      contract_id: avtal, code: kod, name: kod, valid_from: '2026-09-05',
      change_reason: 'Avtalsdelen återinförs i avtalet', active: true,
      ...(del.parent_part_id === null ? {} : { parent_part_id: del.parent_part_id }),
      ...(del.start_date === null ? {} : { start_date: del.start_date }),
      ...(del.end_date === null ? {} : { end_date: del.end_date }),
    });
    const nyId = (ny.parts as Array<{ code: string; part_id: string }>).find((d) => d.code === kod)!.part_id;
    const kvitto2 = await bokatKvitto('2026-11-20', supplierId, 'Aktiv tredje version');
    const aktivtUtfall = await svep(indata(avtal, ref, leverabel));
    const malId = kod.startsWith('L') || kod === 'S2' ? nyId : strom.part_id;
    expect(aktivtUtfall.bindningar.koade).toEqual((kod === 'UPPDRAG' ? [kvitto, kvitto2] : [kvitto2]).map((receipt_id) => ({
      receipt_id, contract_part_id: malId, approval_id: expect.any(String),
    })));
    expect(aktivtUtfall.bindningar.redan_koade).toEqual(kod === 'UPPDRAG' ? [] : [kvitto]);
    expect(aktivtUtfall.bindningar.automatiska).toEqual([]);
    expect(await withAdmin(async (c) => (await c.query(
      'SELECT * FROM contract_parts WHERE id = ANY($1::uuid[]) ORDER BY id', [fore.map((r) => r.id)],
    )).rows)).toEqual(fore);
  });
});
