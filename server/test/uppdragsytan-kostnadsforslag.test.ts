// Story 5.1: en kostnad får inte nå David utan skäl, ett avslag får inte
// återkomma oförändrat och belopp får inte kopieras till förslaget eller cachen.
// Rena regler och REST/tenant/mandat prövas mot samma produktionsvägar.
import { beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import * as h from './kostnadsforslagHelper.js';

import supertest from 'supertest';
import { withTenantTransaction } from '../src/db/tx.js';
import { ACTIONS } from '../src/actions/registry.js';
import { beslutHash, createApproval, type Approval } from '../src/services/approvals.js';
import { bindSvepetsForslag, type Bindningsdel, type Bindningsdelar } from '../src/services/uppdragKostnad.js';
import { skapaReferens } from '../src/services/uppdragReferens.js';
import type { SvepIndata, Svepsvar } from '../src/services/uppdragSvep.js';
import type { Undantag } from '../src/services/uppdragUndantag.js';
import { LEVERANSKONTRAKT_NVR001 } from './fixtures/leveranskontrakt-nvr-001.js';
import { importeraOchGodkann } from './uppdragImportHelper.js';
import { api, app, createCompany, createFiscalYear, registerUser, withAdmin, type TestUser } from './helpers.js';
import { lasUppdragspengar, lasOplaneradeKostnader } from '../src/services/uppdragPengar.js';
import { saBedomningsrytm } from './bedomningsrytmHelper.js';

import { forslagHash as hHash } from '../src/lib/beslutsunderlag.js';
import { BindaKostnadSchema } from '../src/lib/avtalsdelsfalt.js';
import { LEVERANSKONTRAKT_NVR001_V3 } from './fixtures/leveranskontrakt-nvr-001-v3.js';
describe('F0 förifyllningen och hashregeln (ren)', () => {
  it('F0 a titelträff', h.provaF0a);
  it('F0 b tidigare bindning', h.provaF0b);
  it('F0 c text och ordgränser', h.provaF0c);
  it('F0 d motstridiga leverabler', h.provaF0d);
  it('F0 e ström och uppdrag', h.provaF0e);
  it('F0 f inaktiv kod', h.provaF0f);
  it('F0 g allmän kostnad', h.provaF0g);
  it('F0 h stabil hash', h.provaF0h);
  it('F0 i köstatusar', h.provaF0i);
  it('F0 j märkning', h.provaF0j);
  it('F0 k strikt underlag utan godtyckliga tak', h.provaF0k);
  it('F0 l nivå', h.provaF0l);
  it('F0 m byggaren kastar aldrig', h.provaF0m);
});

interface Bolag { id: string; user: TestUser; agent: Record<string, string> }
interface Uppdrag { contractId: string; projectId: string }
interface Kvittorad { id: string; contract_part_id: string | null; oplanerad: boolean; total_ore: string }
interface Auditrad { entity_id: string; details: Record<string, unknown> }
const auth = (b: Bolag) => ({ Authorization: `Bearer ${b.user.token}` });
const co = (b: Bolag) => `/api/companies/${b.id}`;
async function nyttBolag(namn: string): Promise<Bolag> {
  const user = await registerUser(`kostnad-${namn.replace(/\s+/g, '-')}`);
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

function medUnderlag(receipt: string, part: string, kod = 'L1') {
  const f = h.forifyll();
  const r = h.underlag();
  const { forslag_hash: _, ...bas } = { ...r, receipt_id: receipt, mal: { part_id: part, kod, niva: f.niva }, kallor: [{ typ: 'kvitto' as const, id: receipt }] };
  return { ...bas, forslag_hash: hHash(bas) };
}
let f1: Bolag; let f1u: Uppdrag; let f1delar: Bindningsdelar;
beforeAll(async () => { f1 = await nyttBolag('F1'); f1u = await nyttUppdrag(f1, 'NVR-001'); f1delar = await bindningsdelar(f1, f1u.contractId); });
async function f1kvitto(text: string) {
  const supplier = (await ok(f1, 'create_supplier', { name: text })).id as string;
  return bokatKvitto(f1, '2026-11-05', supplier, text);
}
describe('F1 schema och verkställighet', () => {
  it('F1 a mänskligt förslag väntar utan bindning', async () => {
    const receipt = await f1kvitto('F1 a'); const r = await act(f1, 'binda_kostnad', { receipt_id: receipt, contract_part_id: f1delar.rot.part_id });
    expect(r.status, JSON.stringify(r.body)).toBe(202); expect(r.body.status).toBe('pending_approval'); expect((await kvitton(f1)).get(receipt)?.contract_part_id).toBeNull();
  });
  it('F1 b förifyllt underlag köas bara av svepet', async () => {
    const receipt = await f1kvitto('F1 b'); const part = await delId(f1, f1u, 'L1');
    const fore = (await audit(f1, 'action.approval_requested')).length;
    const r = await act(f1, 'binda_kostnad', { receipt_id: receipt, contract_part_id: part, forslagsunderlag: medUnderlag(receipt, part) });
    expect(r.status, JSON.stringify(r.body)).toBe(409); expect(r.body.error).toBe('koas_av_svepet'); expect(await koposter(f1, receipt)).toEqual([]); expect((await audit(f1, 'action.approval_requested')).length).toBe(fore);
  });
  it('F1 c omvalidering avvisar fel mål före mottagandet', async () => {
    const receipt = await f1kvitto('F1 c'); const part = await delId(f1, f1u, 'L1');
    const q = await withTenantTransaction(f1.user.userId, f1.id, (c) => createApproval(c, f1.id, f1.user.userId, 'agent', 'binda_kostnad', { receipt_id: receipt, contract_part_id: f1delar.rot.part_id, forslagsunderlag: medUnderlag(receipt, part) }));
    const r = await api.post(`${co(f1)}/approvals/${q.id}/approve`).set(auth(f1)).send({}); expect(r.status, JSON.stringify(r.body)).toBe(400);
    expect((await kvitton(f1)).get(receipt)?.contract_part_id).toBeNull();
    expect(await withAdmin(async (c) => (await c.query('SELECT id FROM uppdrag_beslut WHERE company_id=$1 AND approval_id=$2', [f1.id, q.id])).rows)).toEqual([]);
  });
  it('F1 d ja till leverabel märker kostnaden och skriver Davids beslut', async () => {
    const receipt = await f1kvitto('F1 d'); const part = await delId(f1, f1u, 'L1');
    const r = await act(f1, 'binda_kostnad', { receipt_id: receipt, contract_part_id: part }); expect(r.status, JSON.stringify(r.body)).toBe(202); await godkann(f1, r.body.approval.id);
    expect((await kvitton(f1)).get(receipt)).toMatchObject({ contract_part_id: part, oplanerad: true });
    expect(await beslutsrad(f1, r.body.approval.id)).toMatchObject({ utfall: 'ja', beslutad_av: f1.user.userId });
    expect((await audit(f1, 'receipt.contract_part_assigned')).find((a) => a.entity_id === receipt)?.details).toMatchObject({ oplanerad: true });
  });
  it('F1 e ja till ström märker inte kostnaden', async () => { const receipt = await f1kvitto('F1 e'); await okKoad(f1, 'binda_kostnad', { receipt_id: receipt, contract_part_id: f1delar.strommar[0]!.part_id }); expect((await kvitton(f1)).get(receipt)?.oplanerad).toBe(false); });
  it('F1 f flytt till rot tar aldrig bort märkningen', async () => { const receipt = await f1kvitto('F1 f'); await okKoad(f1, 'binda_kostnad', { receipt_id: receipt, contract_part_id: await delId(f1, f1u, 'L1') }); await okKoad(f1, 'binda_kostnad', { receipt_id: receipt, contract_part_id: f1delar.rot.part_id }); expect((await kvitton(f1)).get(receipt)?.oplanerad).toBe(true); });
  it('F1 g samma schemaobjekt och deklarativ svepspärr', () => {
    const a = ACTIONS.find((d) => d.name === 'binda_kostnad')!; expect(a.inputSchema).toBe(BindaKostnadSchema);
    const receipt = h.id(10); const part = h.id(5); const input = { receipt_id: receipt, contract_part_id: part };
    expect(a.koasAvSvepet?.(input as never)).toBe(false); expect(a.koasAvSvepet?.({ ...input, forslagsunderlag: medUnderlag(receipt, part) } as never)).toBe(true);
  });
});

async function rigg(namn: string, text: string, datum = '2026-11-05') {
  const b = await nyttBolag(namn); const u = await nyttUppdrag(b, 'NVR-001');
  const supplier = (await ok(b, 'create_supplier', { name: `Leverantören ${namn}` })).id as string;
  const receipt = await bokatKvitto(b, datum, supplier, text);
  return { b, u, supplier, receipt };
}
function lastUnderlag(q: Approval) { const r = BindaKostnadSchema.parse(q.input).forslagsunderlag; expect(r).toBeDefined(); return r!; }
async function cacheFor(b: Bolag, receipt: string) { return withAdmin(async (c) => (await c.query('SELECT * FROM uppdrag_svepvarde WHERE company_id=$1 AND nyckel=$2', [b.id, `kostnadsforslag:${receipt}`])).rows); }

describe('F2 svepets förifyllning', () => {
  it('F2 a titelns källa följer agentförslaget utan bindning', async () => {
    const { b, u, receipt } = await rigg('F2a', 'Licens');
    const ref = await referens(b, u, '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456', 'Leverantören F2a – underlag L4');
    await svep(b, indata(u, [[ref, 'L4']]));
    const qs = await koposter(b, receipt); expect(qs).toHaveLength(1); const q = qs[0]!; const underlag = lastUnderlag(q);
    expect(q.requested_actor).toBe('agent'); expect(underlag.mal.part_id).toBe(await delId(b, u, 'L4')); expect(underlag.skal.map((s) => s.kod)).toContain('handlingens_titel');
    expect(underlag.kallor.map((k) => k.typ)).toEqual(['kvitto', 'verifikat', 'referens']); expect(underlag.kallor.at(-1)?.id).toBe(ref);
    expect((await kvitton(b)).get(receipt)?.contract_part_id).toBeNull();
  });
  it('F2 b tidigare leverantörsbindning är kandidat utan titel', async () => {
    const { b, u, receipt, supplier } = await rigg('F2b', 'Första kostnaden');
    await okKoad(b, 'binda_kostnad', { receipt_id: receipt, contract_part_id: await delId(b, u, 'L3') });
    const andra = await bokatKvitto(b, '2026-11-06', supplier, 'Andra kostnaden'); await svep(b, indata(u, []));
    const f = lastUnderlag((await koposter(b, andra))[0]!); expect(f.mal.kod).toBe('L3'); expect(f.skal.map((s) => s.kod)).toContain('tidigare_bindning'); expect(f.kallor).toContainEqual({ typ: 'tidigare_kvitto', id: receipt });
  });
  it('F2 c uppdragsnamn och datum ger strömmen', async () => {
    const { b, u, receipt } = await rigg('F2c', 'Resa NVR-001'); await svep(b, indata(u, []));
    const f = lastUnderlag((await koposter(b, receipt))[0]!); expect(f.mal.kod).toBe('S2'); expect(f.oplanerad).toBe(false); expect(f.skal.map((s) => s.kod)).toEqual(['verifikattext_uppdrag', 'datum_i_intervall', 'ingen_leverabel']); expect((await kvitton(b)).get(receipt)?.contract_part_id).toBeNull();
  });
  it('F2 d allmän kostnad ger varken cache eller köpost', async () => {
    const { b, u, receipt } = await rigg('F2d', 'Kontorsmateriel'); const fore = (await kvitton(b)).get(receipt); await svep(b, indata(u, []));
    expect(await koposter(b, receipt)).toEqual([]); expect(await cacheFor(b, receipt)).toEqual([]); expect((await kvitton(b)).get(receipt)).toEqual(fore);
  });
  it('F2 e motstridiga koder ger grövre nivå utan bindning', async () => {
    const { b, u, receipt } = await rigg('F2e', 'NVR-001 L5'); const ref = await referens(b, u, '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456', 'Leverantören F2e'); await svep(b, indata(u, [[ref, 'L4']]));
    const f = lastUnderlag((await koposter(b, receipt))[0]!); expect(f.mal.kod).toBe('S2'); expect(f.skal.map((s) => s.kod)).toContain('flera_leverabler'); expect((await kvitton(b)).get(receipt)?.contract_part_id).toBeNull();
  });
  it('F2 f ändrad hash kan köas efter nej men öppna och äldre mandat spärrar', async () => {
    const { b, u, receipt, supplier } = await rigg('F2f', 'NVR-001'); const data = indata(u, []); await svep(b, data);
    const q = (await koposter(b, receipt))[0]!; const hash = lastUnderlag(q).forslag_hash; await ok(b, 'avboj_beslutsforslag', { approval_id: q.id, skal: 'Gäller ett annat uppdrag' });
    for (let n = 0; n < 3; n++) await svep(b, data); expect(await koposter(b, receipt)).toHaveLength(1);
    const ref = await referens(b, u, '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456', 'Leverantören F2f'); const ny = indata(u, [[ref, 'L5']]); await svep(b, ny);
    let qs = await koposter(b, receipt); expect(qs).toHaveLength(2); expect(lastUnderlag(qs[1]!).mal.kod).toBe('L5'); expect(lastUnderlag(qs[1]!).forslag_hash).not.toBe(hash); await svep(b, ny); expect(await koposter(b, receipt)).toHaveLength(2);
    const aldre = await bokatKvitto(b, '2026-11-05', supplier, 'NVR-001 äldre'); const pending = await bokatKvitto(b, '2026-11-05', supplier, 'NVR-001 väntande');
    const gammal = await act(b, 'binda_kostnad', { receipt_id: aldre, contract_part_id: await delId(b, u, 'L3') }); expect(gammal.status, JSON.stringify(gammal.body)).toBe(202); await ok(b, 'avboj_beslutsforslag', { approval_id: gammal.body.approval.id, skal: 'Nej till äldre förslag' });
    await act(b, 'binda_kostnad', { receipt_id: pending, contract_part_id: await delId(b, u, 'L3') }); await svep(b, ny); expect(await koposter(b, aldre)).toHaveLength(1); expect(await koposter(b, pending)).toHaveLength(1);
    const mottaget = await bokatKvitto(b, '2026-11-05', supplier, 'NVR-001 mottaget'); const delar = await bindningsdelar(b, u.contractId);
    const fore = h.forslagFor({ ...h.kvitto, receipt_id: mottaget }, delar, { titeltraffar: [{ kod: 'L3', referens_id: ref }], tidigare: null, uppdragsnamn: ['NVR-001'] }, h.tid);
    const efter = h.forslagFor({ ...h.kvitto, receipt_id: mottaget }, delar, { titeltraffar: [{ kod: 'L5', referens_id: ref }], tidigare: null, uppdragsnamn: ['NVR-001'] }, h.tid);
    const r = await withTenantTransaction(b.user.userId, b.id, async (c) => {
      const input = { receipt_id: mottaget, contract_part_id: fore.forslagsunderlag.mal.part_id, forslagsunderlag: fore.forslagsunderlag }; const a = await createApproval(c, b.id, b.user.userId, 'agent', 'binda_kostnad', input);
      await c.query("UPDATE action_approvals SET status='rejected', decided_by=$2, decided_at=now(), beslut_hash=$3, beslut_skal='Provets nej' WHERE id=$1 AND company_id=$4", [a.id, b.user.userId, beslutHash(input), b.id]);
      return bindSvepetsForslag(c, b.id, b.user.userId, [efter], delar);
    }); expect(r.koade).toEqual([]); expect(r.redan_koade).toEqual([mottaget]);
  });
  it('F2 g v3 läser pengar levande och duplicerar dem aldrig i cache eller kö', async () => {
    const b = await nyttBolag('F2g'); const projectId = (await ok(b, 'create_project', { name: 'NVR-001' })).id as string;
    const contractId = (await ok(b, 'skapa_uppdrag', { project_id: projectId, name: 'NVR-001', signed_date: '2026-09-03' })).contract_id as string;
    await importeraOchGodkann(b.id, auth(b), { contract_id: contractId, kontraktstext: LEVERANSKONTRAKT_NVR001_V3 }); const u = { projectId, contractId };
    for (const [namn, text, kod] of [['Resebyrån', 'Resa Helsingfors NVR-001 L5', 'L5'], ['Advokatbyrån', 'Specialiststöd jurist NVR-001 L3', 'L3']]) {
      const supplier = (await ok(b, 'create_supplier', { name: namn })).id as string; const receipt = await bokatKvitto(b, '2026-11-05', supplier, text!); await svep(b, indata(u, []));
      const q = (await koposter(b, receipt))[0]!; expect(lastUnderlag(q).mal.kod).toBe(kod); const ore = Number((await kvitton(b)).get(receipt)!.total_ore);
      const p = (await undantag(b)).poster.find((p) => p.id === q.id)!; expect(p.forslag).toMatchObject({ varde: { belopp_ore: ore }, kalla: 'redovisning' });
      for (const c of await cacheFor(b, receipt)) { expect(c.varde).not.toHaveProperty('belopp_ore'); expect(c.varde).not.toHaveProperty('leverantor'); }
      expect(JSON.stringify(q.input)).not.toMatch(/belopp_ore|total_ore|net_ore/); await godkann(b, q.id);
      expect((await kvitton(b)).get(receipt)).toMatchObject({ contract_part_id: await delId(b, u, kod!), oplanerad: true }); expect((await beslutsrad(b, q.id)).underlag.belopp_ore).toBe(ore);
    }
  });
  it('F2 h ogiltigt mål avvisas utan skrivning och nästa förslag köas', async () => {
    const { b, u, receipt, supplier } = await rigg('F2h', 'NVR-001'); const andra = await bokatKvitto(b, '2026-11-05', supplier, 'NVR-001'); const delar = await bindningsdelar(b, u.contractId);
    const skapa = (receipt_id: string) => h.forslagFor({ ...h.kvitto, receipt_id, texter: ['NVR-001'] }, delar, { titeltraffar: [], tidigare: null, uppdragsnamn: ['NVR-001'] }, h.tid);
    const giltig = skapa(receipt); const ogiltig = skapa(andra); const { forslag_hash: _, ...bas } = { ...ogiltig.forslagsunderlag, mal: { ...ogiltig.forslagsunderlag.mal, part_id: h.id(900) } }; ogiltig.forslagsunderlag = { ...bas, forslag_hash: hHash(bas) };
    const r = await withTenantTransaction(b.user.userId, b.id, (c) => bindSvepetsForslag(c, b.id, b.user.userId, [ogiltig, giltig], delar));
    expect(r.koade.map((p) => p.receipt_id)).toEqual([receipt]); expect(r.avvisade).toEqual([{ receipt_id: andra, orsak: 'underlag_ogiltigt' }]); expect(await koposter(b, andra)).toEqual([]); expect((await audit(b, 'action.approval_requested')).filter((a) => a.details.receipt_id === andra)).toEqual([]);
  });
});

describe('F3 underlaget i läsvägen', () => {
  it('F3 a skälens ordning, källa och lästid', h.provaF3a);
  it('F3 b ja beskriver märkningen', h.provaF3b);
  it('F3 c källor var och en en gång', h.provaF3c);
  it('F3 d äldre förslag behåller sin text', h.provaF3d);
  it('F3 e skäl och källor fryses vid nej och ogiltigt underlag hoppas', async () => {
    const { b, u, receipt } = await rigg('F3e', 'NVR-001 L5'); await svep(b, indata(u, []));
    const q = (await koposter(b, receipt))[0]!; const f = lastUnderlag(q); const p = (await undantag(b)).poster.find((p) => p.id === q.id)!;
    expect(p.skal).toMatchObject({ varde: f.skal.map((s) => s.text).join(' '), kalla: 'redovisning', last_nar: f.last_nar });
    expect(p.kallor.varde?.filter((k) => k.typ === 'yta').map((k) => k.typ === 'yta' ? k.etikett : '')).toEqual(['Kvittot', 'Verifikatet']);
    await ok(b, 'avboj_beslutsforslag', { approval_id: q.id, skal: 'Tillhör annan kund' }); const beslut = await beslutsrad(b, q.id); expect(beslut.underlag.indata.forslagsunderlag).toEqual(f); expect(beslut.underlag.skal).toBe(p.skal.varde);
    const fel = await withTenantTransaction(b.user.userId, b.id, (c) => createApproval(c, b.id, b.user.userId, 'agent', 'binda_kostnad', { ...q.input, forslagsunderlag: { ...f, forslag_hash: '0'.repeat(64) } }));
    expect((await undantag(b)).hoppade).toContainEqual(expect.objectContaining({ id: fel.id, orsak: 'underlag_ogiltigt' }));
  });
  it('F3 f alla tolv förifyllda belopp visas oavsett tröskel och nivå', async () => {
    const b = await nyttBolag('F3f'); const u = await nyttUppdrag(b, 'NVR-001');
    for (const [kod, datum, suffix] of [['L5', '2026-11-05', ' L5'], ['S2', '2026-11-05', ''], ['UPPDRAG', '2026-03-05', '']]) {
      const supplier = (await ok(b, 'create_supplier', { name: `F3f ${kod}` })).id as string;
      for (const net of [80, 192000, 1760000, 2400000]) await bokatKvitto(b, datum!, supplier, `NVR-001${suffix}`, net);
    }
    await svep(b, indata(u, [])); const ps = (await undantag(b)).poster.filter((p) => p.slag === 'kostnadsbindning'); expect(ps).toHaveLength(12);
    for (const kod of ['L5', 'S2', 'UPPDRAG']) expect(ps.filter((p) => p.forslag.varde?.till.startsWith(`${kod} · `))).toHaveLength(4);
    expect(ps.map((p) => p.forslag.varde?.belopp_ore).sort((a, b) => a! - b!)).toEqual([100,100,100,240000,240000,240000,2200000,2200000,2200000,3000000,3000000,3000000]);
  });
});

const blank = (s: string) => s.replace(/&nbsp;|&#160;|&#xa0;/gi, ' ').replace(/[\s  ]+/g, ' ');
async function vy(b: Bolag, u: Uppdrag, yta: string) {
  const session = supertest.agent(app);
  const login = await session.post('/app/login').type('form').send({ email: b.user.email, password: 'mycket-hemligt-losen-123' }); expect([302, 303], login.text).toContain(login.status);
  const r = await session.get(`/app/c/${b.id}/projects/${u.projectId}/${yta}`); expect(r.status, r.text).toBe(200); return r.text;
}
async function pengarFor(b: Bolag, u: Uppdrag) { return (await withTenantTransaction(b.user.userId, b.id, (c) => lasUppdragspengar(c, b.id, { project_id: u.projectId }))).avtal[0]!; }
async function obokat(b: Bolag, part: string, datum: string, text: string, status: 'registered' | 'cancelled' = 'registered') {
  const r = await ok(b, 'create_receipt', { receipt_date: datum, description: text, net_ore: 987654, vat_rate: 25, expense_account: 5460 });
  if (status === 'cancelled') await withAdmin((c) => c.query("UPDATE receipts SET status='cancelled' WHERE id=$1 AND company_id=$2", [r.id, b.id]));
  await okKoad(b, 'binda_kostnad', { receipt_id: r.id, contract_part_id: part }); return r.id as string;
}
describe('F4 pengadelen och periodens rapport', () => {
  it('F4 a leverabelns bindning syns med Oplanerad i pengadelen', async () => {
    const { b, u, receipt } = await rigg('F4a', 'NVR-001 L1'); await okKoad(b, 'binda_kostnad', { receipt_id: receipt, contract_part_id: await delId(b, u, 'L1') });
    const sida = await vy(b, u, 'pengarna'); expect(sida).toContain('>Oplanerad<'); expect(sida).toContain('L1');
  });
  let b: Bolag; let u: Uppdrag; let ejBokford: string;
  beforeAll(async () => {
    const r = await rigg('F4bc', 'Bunden'); b = r.b; u = r.u;
    // 3 200 kr netto + moms = 4 000 kr, obundet 800 + moms = 1 000 kr.
    const bound = await bokatKvitto(b, '2026-11-05', r.supplier, 'Bunden 4000', 320000); await okKoad(b, 'binda_kostnad', { receipt_id: bound, contract_part_id: await delId(b, u, 'L1') });
    const unbound = await bokatKvitto(b, '2026-11-05', r.supplier, 'Obunden 1000', 80000); const q = await act(b, 'binda_kostnad', { receipt_id: unbound, contract_part_id: await delId(b, u, 'L1') }); expect(q.status, JSON.stringify(q.body)).toBe(202);
    ejBokford = await obokat(b, await delId(b, u, 'L1'), '2026-11-05', 'Ej bokförd');
  });
  it('F4 b bokfört inkluderar obundet men räknar ej bokförda separat', async () => {
    const a = await pengarFor(b, u); expect(a.kostnadstotal).toMatchObject({ varde: { bokfort_ore: 500000, varav_obundet_ore: 100000, ej_bokforda: 1 }, kalla: 'redovisning', lage: 'last', last_nar: expect.any(String) });
    // Samma regel för annullerat som för registrerat, utan att beloppet räknas.
    await withAdmin((c) => c.query("UPDATE receipts SET status='cancelled' WHERE id=$1 AND company_id=$2", [ejBokford, b.id]));
    expect((await pengarFor(b, u)).kostnadstotal.varde).toEqual({ bokfort_ore: 500000, varav_obundet_ore: 100000, ej_bokforda: 1 });
  });
  it('F4 c totalrad och ej bokförd utan falskt belopp', async () => {
    const sida = blank(await vy(b, u, 'pengarna')); expect(sida).toMatch(/Kostnader totalt, bokfört:.*5 000,00 kr.*varav obundet.*1 000,00 kr/); expect(sida).toContain('1 kostnad är ej bokförd och ingår inte i summan.'); expect(sida).toContain('ej bokförd'); expect(sida).not.toContain('12 345,68 kr');
  });
  it('F4 d periodläsningen filtrerar på märkning och datum, också över tenantgränsen', async () => {
    const { b, u, receipt, supplier } = await rigg('F4d', 'Periodkostnad'); const part = await delId(b, u, 'L1'); await okKoad(b, 'binda_kostnad', { receipt_id: receipt, contract_part_id: part });
    const utanfor = await bokatKvitto(b, '2026-10-01', supplier, 'Utanför period'); await okKoad(b, 'binda_kostnad', { receipt_id: utanfor, contract_part_id: part });
    const plan = await bokatKvitto(b, '2026-11-05', supplier, 'Strömkostnad'); await okKoad(b, 'binda_kostnad', { receipt_id: plan, contract_part_id: (await bindningsdelar(b, u.contractId)).strommar[0]!.part_id });
    const r = await withTenantTransaction(b.user.userId, b.id, (c) => lasOplaneradeKostnader(c, b.id, u.contractId, '2026-11-01', '2026-11-30')); expect(r.varde?.map((k) => k.receipt_id)).toEqual([receipt]); expect(r.kalla).toBe('redovisning');
    const granne = await nyttBolag('F4d granne'); const inga = await withTenantTransaction(granne.user.userId, granne.id, (c) => lasOplaneradeKostnader(c, granne.id, u.contractId, '2026-11-01', '2026-11-30')); expect(inga.varde).toEqual([]);
  });
  it('F4 e rapporten visar märkt kostnad, ej bokfört, tomt och saknat ankare', async () => {
    const b = await nyttBolag('F4e'); const u = await nyttUppdrag(b, 'NVR-001'); const part = await delId(b, u, 'L1');
    expect(await vy(b, u, 'bedomning')).not.toContain('Oplanerade kostnader i perioden');
    const { period } = await saBedomningsrytm(u.contractId); expect(await vy(b, u, 'bedomning')).toContain('Inga oplanerade kostnader i perioden.');
    if (!period.start.startsWith('2026-')) await createFiscalYear(b.id, auth(b), { label: period.start.slice(0, 4), start_date: `${period.start.slice(0, 4)}-01-01`, end_date: `${period.start.slice(0, 4)}-12-31` });
    const supplier = (await ok(b, 'create_supplier', { name: 'Periodens leverantör' })).id as string; const receipt = await bokatKvitto(b, period.start, supplier, 'Resa i perioden'); await okKoad(b, 'binda_kostnad', { receipt_id: receipt, contract_part_id: part });
    for (const status of ['registered', 'cancelled'] as const) await obokat(b, part, period.start, `Periodens ${status}`, status);
    const sida = blank(await vy(b, u, 'bedomning')); const block = sida.slice(sida.indexOf('Oplanerade kostnader i perioden'));
    expect(block).toContain('Periodens leverantör'); expect(block).toContain(period.start); expect(block).toContain('L1'); expect(block).toContain('>Oplanerad<'); expect(block).toContain('5 000,00 kr'); expect(block.match(/ej bokförd/g)).toHaveLength(2); expect(sida).not.toContain('12 345,68 kr');
  });
});

it('F5 dokumentationen speglar förifyllningen och hashregeln', async () => {
  const doc = await readFile(new URL('../../docs/MCP_ACTIONS.md', import.meta.url), 'utf8');
  const rad = doc.split('\n').find((r) => r.startsWith('- `binda_kostnad`'))!;
  expect(rad).toContain('forslagsunderlag'); expect(rad).toContain('koas_av_svepet');
  const stycke = doc.split('\n').find((r) => r.startsWith('- **Idempotent per kvitto'))!;
  expect(stycke).toContain('forslag_hash'); expect(stycke).not.toContain('kommer med Story 5.1');
});
