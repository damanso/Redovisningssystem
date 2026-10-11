// Story 1.8, B-6: ingen kostnad binds utan Davids ja, inget avslag återkommer
// som ny fråga och ingen föreslagen men obunden kostnad försvinner ur uppdraget.
// Rena regler och verklig REST/tenant/SQL/HTML provas tillsammans.
import { describe, it } from 'vitest';
import * as h from './kostnadssparrHelper.js';
import supertest from 'supertest';
import { beforeAll, expect } from 'vitest';
import { withTenantTransaction } from '../src/db/tx.js';
import { ACTIONS } from '../src/actions/registry.js';
import { ConflictError } from '../src/lib/errors.js';
import { beslutHash, createApproval, type Approval } from '../src/services/approvals.js';
import { bindSvepetsForslag, type Bindningsdel, type Bindningsdelar } from '../src/services/uppdragKostnad.js';
import { skapaReferens } from '../src/services/uppdragReferens.js';
import type { SvepIndata, Svepsvar } from '../src/services/uppdragSvep.js';
import type { Undantag } from '../src/services/uppdragUndantag.js';
import { LEVERANSKONTRAKT_NVR001 } from './fixtures/leveranskontrakt-nvr-001.js';
import { importeraOchGodkann } from './uppdragImportHelper.js';
import { api, app, createCompany, createFiscalYear, registerUser, withAdmin, type TestUser } from './helpers.js';
import { formatOre } from '../src/domain/money.js';
import { lasUppdragspengar } from '../src/services/uppdragPengar.js';

describe('K0 valet av bindningsmål (ren)', () => {
  it('a lövet har företräde', h.provaLov);
  it('b utan aktivt löv väljs strömmen', h.provaStrom);
  it('c utanför strömmen väljs roten', h.provaRot);
  it('d överlapp följer avtalets ordning', h.provaOverlapp);
  it('e ström utan datum täcker ingenting', h.provaDatumSaknas);
  it('f cachens grövre nivå', h.provaCachemal);
});

interface Bolag { id: string; user: TestUser; agent: Record<string, string> }
interface Uppdrag { contractId: string; projectId: string }
interface Kvittorad { id: string; contract_part_id: string | null; oplanerad: boolean; total_ore: string }
interface Auditrad { entity_id: string; details: Record<string, unknown> }
const auth = (b: Bolag) => ({ Authorization: `Bearer ${b.user.token}` });
const co = (b: Bolag) => `/api/companies/${b.id}`;
const fel = <T>(p: Promise<T>) => p.then(() => null, (e: unknown) => e);
const korda = { sparr: 0, status: 0, versaler: 0, pengar: 0 };
let statusfall = 0;
let sparr: Bolag; let idempotens: Bolag; let avslag: Bolag; let belopp: Bolag;
let sparrU: Uppdrag; let sparrData: SvepIndata;
let refL4: string; let axisSen: string; let teliaSen: string; let teliaTidig: string; let allmant: string;
let kontor: string;
const sparrMal = new Map<string, { receipt: string; del: string; kod: string; leverabel: string; approval: string }>();

async function nyttBolag(namn: string): Promise<Bolag> {
  const user = await registerUser(`kostnad-${namn}`);
  const id = await createCompany(user.token, namn);
  const b: Bolag = { id, user, agent: {} };
  await createFiscalYear(id, auth(b), { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });
  const res = await api.post(`${co(b)}/agent-tokens`).set(auth(b)).send({ name: 'Hermes' });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  b.agent = { Authorization: `Bearer ${res.body.token}` };
  return b;
}
async function act(b: Bolag, namn: string, input: object, headers: Record<string, string> = auth(b)) {
  return api.post(`${co(b)}/actions/${namn}`).set(headers).send(input);
}
async function ok(b: Bolag, namn: string, input: object): Promise<Record<string, unknown>> {
  const res = await act(b, namn, input);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.result;
}
async function godkann(b: Bolag, id: string) {
  const res = await api.post(`${co(b)}/approvals/${id}/approve`).set(auth(b)).send({});
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res;
}
async function okKoad(b: Bolag, namn: string, input: object): Promise<Record<string, unknown>> {
  const res = await act(b, namn, input);
  expect(res.status, JSON.stringify(res.body)).toBe(202);
  return (await godkann(b, res.body.approval.id)).body.result;
}
async function svep(b: Bolag, input: SvepIndata, headers: Record<string, string> = auth(b)) {
  const res = await act(b, 'kor_uppdragssvep', input, headers);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  const svar = res.body.result as Svepsvar;
  expect(svar.lage).toBe('svep_kort');
  if (svar.lage !== 'svep_kort') throw new Error('svepet avstod');
  expect(svar.uppdrag).toHaveLength(1);
  return svar.uppdrag[0]!;
}
async function nyttUppdrag(b: Bolag, namn: string): Promise<Uppdrag> {
  const projectId = (await ok(b, 'create_project', { name: namn })).id as string;
  const contractId = (await ok(b, 'skapa_uppdrag', {
    project_id: projectId, name: `Kontrakt ${namn}`, signed_date: '2026-09-03',
  })).contract_id as string;
  await importeraOchGodkann(b.id, auth(b), { contract_id: contractId, kontraktstext: LEVERANSKONTRAKT_NVR001 });
  return { projectId, contractId };
}
async function referens(b: Bolag, u: Uppdrag, externId: string, titel: string): Promise<string> {
  const r = await withTenantTransaction(b.user.userId, b.id, (c) => skapaReferens(c, b.id, {
    contract_id: u.contractId, sort: 'drive', extern_id: externId, extern_nyckel: 'leverabel-handling',
    extern_kalla: 'drive:locollabs', titel_vid_lankning: titel,
  }));
  return r.id;
}
async function utanL4(b: Bolag, u: Uppdrag) {
  await okKoad(b, 'upsert_contract_part', { contract_id: u.contractId, code: 'L4', name: 'L4',
    valid_from: '2026-09-04', change_reason: 'avtal', active: false });
}
async function bokatKvitto(b: Bolag, datum: string, supplier: string, text: string, net_ore = 400000) {
  const r = await ok(b, 'create_receipt', { supplier_id: supplier, receipt_date: datum, description: text,
    net_ore, vat_rate: 25, expense_account: 5460 });
  await okKoad(b, 'book_receipt', { receipt_id: r.id });
  return r.id as string;
}
async function bindningsdelar(b: Bolag, contractId: string): Promise<Bindningsdelar> {
  const usage = await ok(b, 'get_contract_usage', { contract_id: contractId });
  const aktiva = (usage.parts as Array<{ part_id: string; parent_code: string | null; active: boolean }>).filter((d) => d.active);
  const rader = await withAdmin(async (c) => (await c.query<Bindningsdel>(
    `SELECT id AS part_id, code, parent_part_id, start_date::text, end_date::text FROM contract_parts
     WHERE contract_id=$1 AND company_id=$2 AND id=ANY($3::uuid[]) ORDER BY sort_order, code`,
    [contractId, b.id, aktiva.map((d) => d.part_id)],
  )).rows);
  const rot = rader.find((r) => r.code === 'UPPDRAG')!;
  expect(rot).toBeDefined();
  const stromIds = new Set(aktiva.filter((d) => d.parent_code === rot.code).map((d) => d.part_id));
  return { rot, strommar: rader.filter((r) => stromIds.has(r.part_id)), alla: rader };
}
async function delId(b: Bolag, u: Uppdrag, kod: string) {
  const d = (await bindningsdelar(b, u.contractId)).alla.find((r) => r.code === kod);
  expect(d).toBeDefined();
  return d!.part_id;
}
async function kvitton(b: Bolag) {
  const rows = await withAdmin(async (c) => (await c.query<Kvittorad>(
    'SELECT id, contract_part_id, oplanerad, total_ore::text FROM receipts WHERE company_id=$1', [b.id],
  )).rows);
  return new Map(rows.map((r) => [r.id, r]));
}
async function koposter(b: Bolag, receiptId: string) {
  return withAdmin(async (c) => (await c.query<Approval>(
    `SELECT * FROM action_approvals WHERE company_id=$1 AND action='binda_kostnad'
      AND lower(input->>'receipt_id')=$2 ORDER BY created_at, id`, [b.id, receiptId.toLowerCase()],
  )).rows);
}
async function audit(b: Bolag, action: string) {
  return withAdmin(async (c) => (await c.query<Auditrad>(
    'SELECT entity_id, details FROM audit_log WHERE company_id=$1 AND action=$2 ORDER BY occurred_at, id', [b.id, action],
  )).rows);
}
async function beslutsrad(b: Bolag, approval: string) {
  const rows = await withAdmin(async (c) => (await c.query(
    'SELECT * FROM uppdrag_beslut WHERE company_id=$1 AND approval_id=$2', [b.id, approval],
  )).rows);
  expect(rows).toHaveLength(1);
  return rows[0]!;
}
async function undantag(b: Bolag): Promise<Undantag> {
  return await ok(b, 'las_undantag', {}) as unknown as Undantag;
}
function indata(u: Uppdrag, refs: Array<[string, string]>): SvepIndata {
  return { uppdrag: [{ contract_id: u.contractId,
    referenser: refs.map(([referens_id, leverabel_kod]) => ({ referens_id, leverabel_kod, lage: { finns: true } })) }] };
}

beforeAll(async () => {
  sparr = await nyttBolag('sparr'); idempotens = await nyttBolag('idempotens');
  avslag = await nyttBolag('avslag'); belopp = await nyttBolag('belopp');
  sparrU = await nyttUppdrag(sparr, 'NVR-001'); await utanL4(sparr, sparrU);
  const refL3 = await referens(sparr, sparrU, '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456', 'Offert Axis Communications AB – integrationslagret');
  refL4 = await referens(sparr, sparrU, '1ZyXwVuTsRqPoNmLkJiHgFeDcBa9876543', 'Ramavtal Telia Sverige AB – migrering av produktdata');
  sparrData = indata(sparrU, [[refL3, 'L3'], [refL4, 'L4']]);
  const axis = (await ok(sparr, 'create_supplier', { name: 'Axis Communications AB' })).id as string;
  const telia = (await ok(sparr, 'create_supplier', { name: 'Telia Sverige AB' })).id as string;
  kontor = (await ok(sparr, 'create_supplier', { name: 'Kontorsgiganten AB' })).id as string;
  axisSen = await bokatKvitto(sparr, '2026-11-20', axis, 'Integrationshårdvara');
  teliaSen = await bokatKvitto(sparr, '2026-11-20', telia, 'Datamigreringslicenser');
  teliaTidig = await bokatKvitto(sparr, '2026-03-05', telia, 'Uppkoppling testmiljö');
  allmant = await bokatKvitto(sparr, '2026-11-21', kontor, 'Kontorsmateriel');
  for (const [receipt, kod, leverabel] of [[axisSen, 'L3', 'L3'], [teliaSen, 'S2', 'L4'], [teliaTidig, 'UPPDRAG', 'L4']]) {
    sparrMal.set(receipt!, { receipt: receipt!, kod: kod!, leverabel: leverabel!, del: await delId(sparr, sparrU, kod!), approval: '' });
  }
});

describe('K1 svepet köar alla nivåer med agentens aktör', () => {
  it('a–f exakta köposter och audit, inga kvittoskrivningar', async () => {
    const u = await svep(sparr, sparrData);
    expect(Object.keys(u.bindningar).sort()).toEqual(['automatiska', 'koade', 'redan_koade']);
    expect(u.bindningar.automatiska).toEqual([]); expect(u.bindningar.redan_koade).toEqual([]);
    expect(u.bindningar.koade).toHaveLength(3);
    for (const m of sparrMal.values()) {
      const q = await koposter(sparr, m.receipt); expect(q).toHaveLength(1);
      m.approval = q[0]!.id;
      expect(q[0]).toMatchObject({ status: 'pending', requested_actor: 'agent', requested_by: sparr.user.userId });
      expect(q[0]!.input).toEqual({ receipt_id: m.receipt, contract_part_id: m.del });
      expect(u.bindningar.koade).toContainEqual({ receipt_id: m.receipt, contract_part_id: m.del, approval_id: m.approval });
    }
    expect(await audit(sparr, 'receipt.contract_part_assigned')).toEqual([]);
    for (const r of (await kvitton(sparr)).values()) expect(r).toMatchObject({ contract_part_id: null, oplanerad: false });
    const log = (await audit(sparr, 'action.approval_requested')).filter((r) => r.details.action === 'binda_kostnad');
    expect(log).toHaveLength(3);
    for (const m of sparrMal.values()) expect(log).toContainEqual({ entity_id: m.approval,
      details: { action: 'binda_kostnad', actor: 'agent', receipt_id: m.receipt, leverabel_kod: m.leverabel } });
    expect(u.bindningar.koade.map((r) => r.receipt_id)).not.toContain(allmant);
  });
});

describe('K2 endast ett mänskligt ja binder', () => {
  it('a upprepade svep med båda aktörerna lämnar kvittona obundna', async () => {
    for (const headers of [auth(sparr), sparr.agent, auth(sparr)]) {
      const u = await svep(sparr, sparrData, headers);
      expect(u.bindningar.redan_koade.sort()).toEqual([...sparrMal.keys()].sort());
      expect(u.bindningar.koade).toEqual([]);
      for (const id of sparrMal.keys()) {
        expect(await koposter(sparr, id)).toHaveLength(1);
        expect((await kvitton(sparr)).get(id)!.contract_part_id).toBeNull();
      }
      expect(await audit(sparr, 'receipt.contract_part_assigned')).toEqual([]);
    }
  });
  it('b–f REST köar, direkt handler och agentens ja fälls, människans ja verkställs', async () => {
    const rest = await bokatKvitto(sparr, '2026-11-21', kontor, 'REST-kontroll');
    const del = sparrMal.get(teliaSen)!.del;
    const input = { receipt_id: rest, contract_part_id: del };
    let qid = '';
    for (const headers of [sparr.agent, auth(sparr)]) {
      const r = await act(sparr, 'binda_kostnad', input, headers);
      expect(r.status, JSON.stringify(r.body)).toBe(202); expect(r.body.status).toBe('pending_approval');
      qid = r.body.approval.id;
      expect((await kvitton(sparr)).get(rest)!.contract_part_id).toBeNull(); korda.sparr++;
    }
    const handler = ACTIONS.find((a) => a.name === 'binda_kostnad')!.handler;
    for (const approvalId of [undefined, qid]) {
      const e = await fel(withTenantTransaction(sparr.user.userId, sparr.id, (client, role) => handler({
        client, role, companyId: sparr.id, userId: sparr.user.userId, actor: 'human',
        ...(approvalId ? { approvalId } : {}),
      }, input as never)));
      expect(e).toBeInstanceOf(ConflictError); expect(e).toMatchObject({ code: 'beslut_ej_mottaget' });
      expect((await kvitton(sparr)).get(rest)!.contract_part_id).toBeNull(); korda.sparr++;
    }
    expect(await withAdmin(async (c) => (await c.query('SELECT id FROM uppdrag_beslut WHERE approval_id=$1', [qid])).rows)).toEqual([]);
    const nej = await api.post(`${co(sparr)}/approvals/${qid}/approve`).set(sparr.agent).send({});
    expect(nej.status, JSON.stringify(nej.body)).toBe(403); expect(nej.body.error).toBe('human_approval_required');
    expect((await kvitton(sparr)).get(rest)!.contract_part_id).toBeNull(); korda.sparr++;
    await godkann(sparr, qid);
    expect((await kvitton(sparr)).get(rest)!.contract_part_id).toBe(del);
    const log = (await audit(sparr, 'receipt.contract_part_assigned')).filter((r) => r.entity_id === rest);
    expect(log).toHaveLength(1); expect(log[0]!.details).toMatchObject({ fran_contract_part_id: null, till_contract_part_id: del });
    expect(log[0]!.details).not.toHaveProperty('bindning');
    expect((await beslutsrad(sparr, qid)).utfall).toBe('ja');
  });
});

describe('K3 alla statusar och versaler är idempotenta', () => {
  it('a–f, versaler och kontroll i ett enda bindningsanrop utan svep', async () => {
    const u = await nyttUppdrag(idempotens, 'NVR-001');
    const delar = await bindningsdelar(idempotens, u.contractId);
    const supplier = (await ok(idempotens, 'create_supplier', { name: 'Statusbolaget AB' })).id as string;
    const statusar = ['pending', 'approved', 'rejected', 'rejected', 'executed', 'failed'] as const;
    const check = await withAdmin(async (c) => (await c.query<{ villkor: string }>(
      `SELECT pg_get_constraintdef(oid) AS villkor FROM pg_constraint WHERE conrelid='action_approvals'::regclass AND conname='action_approvals_status_check'`,
    )).rows);
    expect(check).toHaveLength(1);
    expect([...check[0]!.villkor.matchAll(/'([^']+)'/g)].map((m) => m[1]).sort()).toEqual([...new Set(statusar)].sort());
    statusfall = statusar.length;
    const ids: string[] = [];
    for (let i = 0; i < 8; i++) {
      const id = await bokatKvitto(idempotens, '2026-11-20', supplier, `Status ${i}`); ids.push(id);
      if (i === 7) continue;
      const input = { receipt_id: i === 6 ? id.toUpperCase() : id, contract_part_id: delar.alla.find((d) => d.code === 'L3')!.part_id };
      const q = await withTenantTransaction(idempotens.user.userId, idempotens.id, (c) =>
        createApproval(c, idempotens.id, idempotens.user.userId, 'agent', 'binda_kostnad', input));
      if (i > 0 && i < 6) await withAdmin((c) => c.query(
        `UPDATE action_approvals SET status=$2, decided_by=$3, decided_at=now(), beslut_hash=$4, beslut_skal=$5, error=$6 WHERE id=$1`,
        [q.id, statusar[i], idempotens.user.userId, i === 1 || i === 2 ? beslutHash(input) : null,
          i === 2 ? 'Provets nej' : null, i === 5 ? 'driftfel' : null],
      ));
      if (i === 6) korda.versaler++; else korda.status++;
    }
    const r = await withTenantTransaction(idempotens.user.userId, idempotens.id, (c) => bindSvepetsForslag(
      c, idempotens.id, idempotens.user.userId, ids.map((receipt_id) => ({ receipt_id, datum: '2026-11-20', leverabel_kod: 'L3' })), delar,
    ));
    expect(r.redan_koade).toEqual(ids.slice(0, 7));
    expect(r.koade).toEqual([{ receipt_id: ids[7], contract_part_id: delar.alla.find((d) => d.code === 'L3')!.part_id, approval_id: expect.any(String) }]);
    expect(r.automatiska).toEqual([]);
    for (const id of ids) { expect(await koposter(idempotens, id)).toHaveLength(1); expect((await kvitton(idempotens)).get(id)!.contract_part_id).toBeNull(); }
  });
  it('g–i ett verkligt nej återkommer inte efter tre svep, täckningen står kvar', async () => {
    const u = await nyttUppdrag(avslag, 'NVR-001'); await utanL4(avslag, u);
    const ref = await referens(avslag, u, '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456', 'Avtal Telia Sverige AB');
    const supplier = (await ok(avslag, 'create_supplier', { name: 'Telia Sverige AB' })).id as string;
    const id = await bokatKvitto(avslag, '2026-11-20', supplier, 'Avslag'); const data = indata(u, [[ref, 'L4']]);
    const forsta = await svep(avslag, data); expect(forsta.bindningar.koade).toHaveLength(1);
    await ok(avslag, 'avboj_beslutsforslag', { approval_id: forsta.bindningar.koade[0]!.approval_id, skal: 'Kostnaden hör till ett annat uppdrag' });
    expect((await koposter(avslag, id))[0]).toMatchObject({ status: 'rejected', beslut_hash: expect.stringMatching(/^[0-9a-f]{64}$/) });
    for (let i = 0; i < 3; i++) {
      const r = await svep(avslag, data); expect(r.bindningar.redan_koade).toEqual([id]); expect(r.bindningar.koade).toEqual([]);
      expect(await koposter(avslag, id)).toHaveLength(1); expect((await kvitton(avslag)).get(id)!.contract_part_id).toBeNull();
      const las = await undantag(avslag); expect(las.poster.filter((p) => p.slag === 'kostnadsbindning')).toEqual([]);
      expect(las.tackning.find((t) => t.contract_id === u.contractId && t.kalla === 'kostnader')!.tackning.lage).toBe('last');
    }
  });
});

describe('K4 beloppsprovet på tre nivåer', () => {
  it('tolv svepköade kostnader visas också över höjda trösklar', async () => {
    const u = await nyttUppdrag(belopp, 'NVR-001'); await utanL4(belopp, u);
    const lov = (await ok(belopp, 'create_supplier', { name: 'Leverabelbolaget AB' })).id as string;
    const strom = (await ok(belopp, 'create_supplier', { name: 'Strömbolaget AB' })).id as string;
    const rl = await referens(belopp, u, '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456', 'Offert Leverabelbolaget AB – leverans');
    const rs = await referens(belopp, u, '1ZyXwVuTsRqPoNmLkJiHgFeDcBa9876543', 'Avtal Strömbolaget AB – ström');
    for (const [supplier, datum] of [[lov, '2026-11-20'], [strom, '2026-11-20'], [strom, '2026-03-05']]) {
      for (const net of [80, 192000, 1760000, 2400000]) await bokatKvitto(belopp, datum!, supplier!, 'Beloppsprov', net);
    }
    await svep(belopp, indata(u, [[rl, 'L3'], [rs, 'L4']]));
    const kontrollera = async () => {
      const ps = (await undantag(belopp)).poster.filter((p) => p.slag === 'kostnadsbindning');
      expect(ps).toHaveLength(12);
      expect(ps.map((p) => p.forslag.varde!.belopp_ore).sort((a, b) => a! - b!)).toEqual([100,100,100,240000,240000,240000,2200000,2200000,2200000,3000000,3000000,3000000]);
      for (const kod of ['L3', 'S2', 'UPPDRAG']) expect(ps.filter((p) => p.forslag.varde!.till.startsWith(`${kod} · `))).toHaveLength(4);
    };
    await kontrollera();
    await withAdmin((c) => c.query('UPDATE contracts SET troskel_golv_ore=900000000000, troskel_procent=999.99 WHERE company_id=$1 AND id=$2', [belopp.id, u.contractId]));
    await kontrollera();
  });
});

describe('K5 skälet följer förslaget', () => {
  it('a lövets text är oförändrad', h.provaLovskal);
  it('b strömmens skäl och lästid', h.provaStromskal);
  it('c rotens skäl och datum', h.provaRotskal);
  it('d annan köad del får ingen grövre förklaring', h.provaAnnatMal);
  it('e saknad cache och saknat datum', h.provaSaknatSkal);
  it('f–h läsvägen och det frysta nej-underlaget bär samma skäl och källor', async () => {
    const ps = (await undantag(sparr)).poster;
    for (const [id, text] of [[teliaSen, h.STROMTEXT], [teliaTidig, h.ROTTEXT]]) {
      const m = sparrMal.get(id!)!;
      const p = ps.find((p) => p.id === m.approval)!;
      expect(p).toBeDefined();
      const cache = await withAdmin(async (c) => (await c.query<{ last_nar: Date }>(
        'SELECT last_nar FROM uppdrag_svepvarde WHERE company_id=$1 AND contract_id=$2 AND nyckel=$3',
        [sparr.id, sparrU.contractId, `kostnadsforslag:${id}`],
      )).rows);
      expect(cache).toHaveLength(1);
      expect(p.skal).toMatchObject({ varde: text, kalla: 'redovisning', last_nar: cache[0]!.last_nar.toISOString() });
      expect(p.kallor.varde).toEqual(expect.arrayContaining([
        expect.objectContaining({ typ: 'referens', referens_id: refL4 }),
        expect.objectContaining({ typ: 'yta', sokvag: `/app/c/${sparr.id}/receipts` }),
      ]));
    }
    expect(ps.find((p) => p.id === sparrMal.get(axisSen)!.approval)!.skal.varde)
      .toBe('Svepet kopplade kvittot till L3 genom handlingens titel.');
    const q = sparrMal.get(teliaSen)!.approval;
    await ok(sparr, 'avboj_beslutsforslag', { approval_id: q, skal: 'Kostnaden hör till annat uppdrag' });
    const b = await beslutsrad(sparr, q);
    expect(b.underlag).toMatchObject({ skal: h.STROMTEXT, foreslagen_av: 'agent' });
    expect(b.underlag.kallor).toEqual(expect.arrayContaining([
      { typ: 'kvitto', id: teliaSen }, { typ: 'referens', id: refL4 },
    ]));
  });
});


let janej: Bolag; let grannen: Bolag;
let p1: Uppdrag; let p2: Uppdrag; let p3: Uppdrag; let grannU: Uppdrag;
let ua: ReturnType<typeof supertest.agent>;
let s2Ja: string; let s2Nej: string; let rotJa: string; let rotNej: string; let vantande: string; let janejAllmant: string;
const beslut = new Map<string, { approval: string; del: string; kod: string; skal: string }>();
async function pengar(b: Bolag, u: Uppdrag) {
  const r = await withTenantTransaction(b.user.userId, b.id, (c) => lasUppdragspengar(c, b.id, { project_id: u.projectId }));
  expect(r.avtal).toHaveLength(1);
  const a = r.avtal[0]!;
  expect(a.obundna_kostnader).toMatchObject({ lage: 'last', kalla: 'redovisning', last_nar: expect.any(String) });
  expect(Number.isNaN(Date.parse(a.obundna_kostnader.last_nar!))).toBe(false);
  expect(a.obundna_kostnader.varde).not.toBeNull();
  return a;
}
function huvud(html: string) {
  const a = html.indexOf('<main>'); const b = html.indexOf('</main>', a);
  expect(a).toBeGreaterThan(-1); expect(b).toBeGreaterThan(a);
  return html.slice(a, b);
}
const text = (html: string) => html.replace(/<[^>]*>/g, ' ');
const blank = (s: string) => s.replace(/&nbsp;|&#160;|&#xa0;/gi, ' ').replace(/[\s  ]+/g, ' ');
async function sida(u: Uppdrag) {
  const r = await ua.get(`/app/c/${janej.id}/projects/${u.projectId}/pengarna`);
  expect(r.status, r.text).toBe(200); return huvud(r.text);
}

describe('K6 ja och nej till ström och uppdrag', () => {
  beforeAll(async () => {
    janej = await nyttBolag('janej'); grannen = await nyttBolag('granne');
    p1 = await nyttUppdrag(janej, 'NVR-001'); await utanL4(janej, p1);
    p2 = await nyttUppdrag(janej, 'NVR-002'); p3 = await nyttUppdrag(janej, 'NVR-003');
    grannU = await nyttUppdrag(grannen, 'NVR-001');
    const ref = await referens(janej, p1, '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456', 'Avtal Telia Sverige AB');
    const supplier = (await ok(janej, 'create_supplier', { name: 'Telia Sverige AB' })).id as string;
    const kontorId = (await ok(janej, 'create_supplier', { name: 'Kontorsgiganten AB' })).id as string;
    s2Ja = await bokatKvitto(janej, '2026-11-20', supplier, 'Ström ja');
    s2Nej = await bokatKvitto(janej, '2026-11-20', supplier, 'Ström nej');
    rotJa = await bokatKvitto(janej, '2026-03-05', supplier, 'Uppdrag ja');
    rotNej = await bokatKvitto(janej, '2026-03-05', supplier, 'Uppdrag nej');
    vantande = await bokatKvitto(janej, '2026-11-20', supplier, 'Väntande');
    janejAllmant = await bokatKvitto(janej, '2026-11-21', kontorId, 'Allmänt');
    const r = await svep(janej, indata(p1, [[ref, 'L4']])); expect(r.bindningar.koade).toHaveLength(5);
    for (const [id, kod, skal] of [[s2Ja,'S2',h.STROMTEXT],[s2Nej,'S2',h.STROMTEXT],[rotJa,'UPPDRAG',h.ROTTEXT],[rotNej,'UPPDRAG',h.ROTTEXT],[vantande,'S2',h.STROMTEXT]]) {
      const q = r.bindningar.koade.find((r) => r.receipt_id === id)!;
      expect(q).toBeDefined();
      beslut.set(id!, { approval: q.approval_id, del: await delId(janej, p1, kod!), kod: kod!, skal: skal! });
    }
    ua = supertest.agent(app);
    const login = await ua.post('/app/login').type('form').send({ email: janej.user.email, password: 'mycket-hemligt-losen-123' });
    expect([302,303], login.text).toContain(login.status);
  });
  it.each([
    { namn: 'ström ja', id: () => s2Ja, ja: true }, { namn: 'ström nej', id: () => s2Nej, ja: false },
    { namn: 'uppdrag ja', id: () => rotJa, ja: true }, { namn: 'uppdrag nej', id: () => rotNej, ja: false },
  ])('$namn: sakläge, beslutsrad och kostnadsläsning', async ({ id: hamta, ja }) => {
    const id = hamta(); const q = beslut.get(id)!;
    if (ja) {
      const res = await godkann(janej, q.approval); expect(res.body.approval.status).toBe('executed');
    } else await ok(janej, 'avboj_beslutsforslag', { approval_id: q.approval, skal: 'Kostnaden hör inte till uppdraget' });
    const r = (await kvitton(janej)).get(id)!;
    expect(r).toMatchObject({ contract_part_id: ja ? q.del : null, oplanerad: false });
    const b = await beslutsrad(janej, q.approval);
    expect(b).toMatchObject({ utfall: ja ? 'ja' : 'nej', kalla_typ: 'kvitto', kalla_id: id,
      handling: ja ? { typ: 'kostnad_bunden', receipt_id: id, contract_part_id: q.del, contract_part_code: q.kod } : null });
    expect(b.underlag).toMatchObject({ skal: q.skal, foreslagen_av: 'agent' });
    if (!ja) expect(b.skal).toBe('Kostnaden hör inte till uppdraget');
    const a = await pengar(janej, p1);
    if (ja) {
      expect(a.kostnader).toEqual(expect.arrayContaining([expect.objectContaining({ receipt_id: id, kod: q.kod })]));
      expect(a.obundna_kostnader.varde!.map((r) => r.receipt_id)).not.toContain(id);
    } else {
      expect(a.kostnader.map((r) => r.receipt_id)).not.toContain(id);
      expect(a.obundna_kostnader.varde).toContainEqual({ receipt_id: id, datum: q.kod === 'S2' ? '2026-11-20' : '2026-03-05', leverantor: 'Telia Sverige AB', total_ore: 500000, status: 'booked' });
    }
  });
});

describe('K7 obundna kostnader syns utan beslutad avtalsdel', () => {
  it('a–c väntande och avvisade ingår i datum-/kvittonummerordning, inga allmänna kostnader', async () => {
    const a = await pengar(janej, p1);
    expect(a.obundna_kostnader.varde!.map((r) => r.receipt_id)).toEqual([rotNej, s2Nej, vantande]);
    const rs = await kvitton(janej);
    for (const r of a.obundna_kostnader.varde!) expect(r.total_ore).toBe(Number(rs.get(r.receipt_id)!.total_ore));
    expect(a.kostnader.map((r) => r.receipt_id)).not.toContain(janejAllmant);
    expect(a.obundna_kostnader.varde!.map((r) => r.receipt_id)).not.toContain(janejAllmant); korda.pengar++;
  });
  it('d den senaste köposten placerar kvittot hos exakt ett avtal', async () => {
    const r = await act(janej, 'binda_kostnad', { receipt_id: vantande, contract_part_id: await delId(janej, p2, 'S2') });
    expect(r.status, JSON.stringify(r.body)).toBe(202);
    const a = await pengar(janej, p1); const b = await pengar(janej, p2);
    expect(a.obundna_kostnader.varde!.map((r) => r.receipt_id)).not.toContain(vantande);
    expect(b.obundna_kostnader.varde!.map((r) => r.receipt_id)).toEqual([vantande]);
    expect([...a.obundna_kostnader.varde!, ...b.obundna_kostnader.varde!].filter((r) => r.receipt_id === vantande)).toHaveLength(1); korda.pengar++;
  });
  it('e grannbolagets kvitto och förslag påverkar inte våra pengar', async () => {
    const supplier = (await ok(grannen, 'create_supplier', { name: 'Grannbolag AB' })).id as string;
    const id = await bokatKvitto(grannen, '2026-11-20', supplier, 'Grannens kvitto');
    const r = await act(grannen, 'binda_kostnad', { receipt_id: id, contract_part_id: beslut.get(s2Ja)!.del });
    expect(r.status, JSON.stringify(r.body)).toBe(202);
    const a = await pengar(janej, p1); const b = await pengar(grannen, grannU);
    expect([...a.kostnader,...a.obundna_kostnader.varde!].map((r) => r.receipt_id)).not.toContain(id);
    expect(b.kostnader).toEqual([]); expect(b.obundna_kostnader.varde).toEqual([]); korda.pengar++;
  });
  it('f sidan ritar rader, belopp, Obunden och en färskhetsrad utan föreslagna koder', async () => {
    const a = await pengar(janej, p1); const main = await sida(p1);
    const chip = '<span class="chip chip--muted"><span class="chip__i" aria-hidden="true">○</span>Obunden</span>';
    expect(main.split(chip)).toHaveLength(a.obundna_kostnader.varde!.length + 1);
    expect(blank(text(main))).toContain(blank(`${formatOre(500000)} kr`));
    expect(main).toContain('Obunden = kostnaden är föreslagen för uppdraget');
    expect((main.match(/obundna kostnader läst ur redovisningen/g) ?? [])).toHaveLength(1);
    expect((main.match(/class="pengarad"/g) ?? [])).toHaveLength(a.kostnader.length + a.obundna_kostnader.varde!.length);
    const start = main.indexOf('<div class="table-wrap"'); expect(start).toBeGreaterThan(-1);
    const tabell = main.slice(start, main.indexOf('</table>', start));
    expect((tabell.match(/<span class="code">S2<\/span>/g) ?? [])).toHaveLength(1);
    const obundnaRader = [...tabell.matchAll(/<tr class="pengarad">([\s\S]*?)<\/tr>/g)].filter((m) => m[0].includes(chip));
    for (const rad of obundnaRader) expect(rad[0]).not.toContain('<span class="code">');
  });
  it('g tomläget förklarar kön och visar en fokuserbar väg till kvittona', async () => {
    const main = await sida(p3);
    expect(main).toContain('Ingen kostnad är bunden till avtalet'); expect(main).toContain('Bindningen görs genom kön');
    expect(main).toContain(`<a href="/app/c/${janej.id}/receipts">Öppna kvittona</a>`);
    expect(main).not.toContain('class="pengarad"'); expect(main).not.toContain('class="empty"');
    expect(main).not.toContain('obundna kostnader läst ur');
  });
});

it('kontrollvakt: människospärrar och samtliga planterade statusar kördes', () => {
  expect(korda.sparr).toBe(5); expect(korda.status).toBe(statusfall); expect(statusfall).toBe(6); expect(korda.versaler).toBe(1); expect(korda.pengar).toBe(3);
});
