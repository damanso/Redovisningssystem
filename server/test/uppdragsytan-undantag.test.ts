// Story 1.6, B-3: falskt tomt, rutin- och driftposter, köns fönster,
// främmande bolag och anrop ut. REST prövas genom hela stacken, lästjänsten
// direkt och utfalls-/beskrivningsreglerna som rena funktioner.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { api, createCompany, createFiscalYear, registerUser, withAdmin, type TestUser } from './helpers.js';
import { withTenantTransaction } from '../src/db/tx.js';
import { ACTIONS, actionManifest } from '../src/actions/registry.js';
import { createApproval, listApprovals, listaVantandeKoposter, beslutHash } from '../src/services/approvals.js';
import { upsertSvepvarden, type Svepsvar } from '../src/services/uppdragSvep.js';
import { skapaReferens, verifieraReferens } from '../src/services/uppdragReferens.js';
import { explainApproval } from '../src/services/approvalSummary.js';
import { last, olast, saknas, KALLA_REDOVISNING } from '../src/lib/lasvarde.js';
import {
  POSTSLAG, KOBURNA_SLAG, UNDANTAG_ATGARDER, MANDATKALLOR, TACKNING_MAX_ALDER_MIN,
  lasUndantag, kalltackning, tackningspost, bedomUndantag,
  beskrivBaselineandring, beskrivKostnadsbindning, beskrivAvslut, beskrivScopeavgorande,
  type Undantag, type Undantagspost, type Mandatkalla,
} from '../src/services/uppdragUndantag.js';
import { importeraOchGodkann } from './uppdragImportHelper.js';
import { LEVERANSKONTRAKT_NVR001 } from './fixtures/leveranskontrakt-nvr-001.js';
import { provaScheman, provaAllaDelfalt, provaLasbaraFalt, provaMal, provaVerkan, provaDatum } from './undantagBeskrivningHelper.js';

let user: TestUser;
let granne: TestUser;
let grannbolag: string;
let grannuppdrag: Uppdrag;
let agentToken: string;
const bolag: Record<string, string> = {};
const korda = { p8: 0, p11: 0, p14: 0 };
interface Uppdrag { projektId: string; contractId: string }
let a: Uppdrag;
let b: Uppdrag;
let c: Uppdrag;
const postId: Record<string, string> = {};
const auth = (u = user) => ({ Authorization: `Bearer ${u.token}` });
const co = (id: string) => `/api/companies/${id}`;
const fel = <T>(p: Promise<T>) => p.then(() => null, (e: unknown) => e);

async function act(id: string, namn: string, kropp: Record<string, unknown>, headers = auth()) {
  return api.post(`${co(id)}/actions/${namn}`).set(headers).send(kropp);
}
async function ok(id: string, namn: string, kropp: Record<string, unknown>, headers = auth()): Promise<Record<string, unknown>> {
  const res = await act(id, namn, kropp, headers);
  expect(res.status, `${namn}: ${JSON.stringify(res.body)}`).toBe(200);
  return res.body.result as Record<string, unknown>;
}
async function koa(id: string, namn: string, kropp: Record<string, unknown>) {
  const res = await act(id, namn, kropp);
  expect(res.status, JSON.stringify(res.body)).toBe(202);
  return res.body.approval.id as string;
}
async function besluta(id: string, approvalId: string, beslut: 'approve' | 'reject', reason?: string) {
  const res = await api.post(`${co(id)}/approvals/${approvalId}/${beslut}`).set(auth()).send(reason ? { reason } : {});
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body;
}
async function aldreAvslag(id: string, approvalId: string) {
  await withAdmin((db) => db.query(
    `UPDATE action_approvals SET status='rejected', decided_by=$3, decided_at=now() WHERE company_id=$1 AND id=$2`,
    [id, approvalId, user.userId]));
}
async function undantag(id: string, headers = auth()): Promise<Undantag> {
  return await ok(id, 'las_undantag', {}, headers) as unknown as Undantag;
}
async function svep(id: string, indata: Record<string, unknown> = {}) {
  const res = await ok(id, 'kor_uppdragssvep', indata) as unknown as Svepsvar;
  expect(res.lage).toBe('svep_kort');
  return res as Extract<Svepsvar, { lage: 'svep_kort' }>;
}
async function nyttUppdrag(id: string, namn: string, headers = auth()): Promise<Uppdrag> {
  const projektId = (await ok(id, 'create_project', { name: namn }, headers)).id as string;
  const contractId = (await ok(id, 'skapa_uppdrag', { project_id: projektId, name: `Avtal ${namn}`, signed_date: '2026-09-03' }, headers)).contract_id as string;
  return { projektId, contractId };
}
async function frisktUppdrag(id: string, namn: string): Promise<Uppdrag> {
  const u = await nyttUppdrag(id, namn);
  await importeraOchGodkann(id, auth(), { contract_id: u.contractId, kontraktstext: LEVERANSKONTRAKT_NVR001 });
  return u;
}
const andring = (contractId: string, code = 'NY') => ({ contract_id: contractId, code, name: 'Ny avtalsdel', valid_from: '2026-10-01', change_reason: 'Kunden bad om mer underlag' });
async function plantera(id: string, action: string, input: Record<string, unknown>) {
  return withTenantTransaction(user.userId, id, async (db) => (await createApproval(db, id, user.userId, 'agent', action, input)).id);
}
async function del(id: string, contractId: string, code = 'L1'): Promise<string> {
  const r = await ok(id, 'get_contract_usage', { contract_id: contractId });
  const p = (r.parts as { part_id: string; code: string }[]).find((p) => p.code === code);
  expect(p, `delen ${code}`).toBeDefined();
  return p!.part_id;
}
async function kvitto(id: string, belopp = 100): Promise<string> {
  return (await ok(id, 'create_receipt', { receipt_date: '2026-09-15', description: 'Underlag', net_ore: belopp, vat_rate: 0, expense_account: 5460 })).id as string;
}
async function cache(id: string, contractId: string, nyckel: string, varde: unknown, kalla = 'redovisning') {
  await withAdmin((db) => db.query(`INSERT INTO uppdrag_svepvarde (company_id, contract_id, nyckel, varde, kalla)
    VALUES ($1,$2,$3,$4::jsonb,$5) ON CONFLICT ON CONSTRAINT uppdrag_svepvarde_uk DO UPDATE SET varde=EXCLUDED.varde, kalla=EXCLUDED.kalla, last_nar=now()`,
  [id, contractId, nyckel, JSON.stringify(varde), kalla]));
}
async function aldra(id: string, contractId: string, minuter: number) {
  await withAdmin((db) => db.query(`UPDATE uppdrag_svepvarde SET last_nar=now()-make_interval(mins => $3)
    WHERE company_id=$1 AND contract_id=$2 AND nyckel='tackning'`, [id, contractId, minuter]));
}
async function mottaget(id: string, input: Record<string, unknown>) {
  const q = await plantera(id, 'andra_baseline', input);
  await withAdmin((db) => db.query(`UPDATE action_approvals SET status='approved', decided_by=$3, decided_at=now(), beslut_hash=$4
    WHERE company_id=$1 AND id=$2`, [id, q, user.userId, beslutHash(input)]));
  return q;
}
async function antal(id: string) {
  return withAdmin(async (db) => (await db.query(`SELECT
    (SELECT count(*)::int FROM action_approvals WHERE company_id=$1) AS ko,
    (SELECT count(*)::int FROM uppdrag_svepvarde WHERE company_id=$1) AS cache`, [id])).rows[0]);
}
function utanLastid(svar: Undantag): Undantag {
  const kopia = structuredClone(svar);
  kopia.last_nar = 'X';
  for (const p of kopia.poster) for (const v of [p.uppdrag, p.forslag, p.skal, p.kallor]) {
    if (v.kalla === 'redovisning') v.last_nar = 'X';
  }
  return kopia;
}
function arLasvarde(v: { varde: unknown; kalla: string; last_nar: string | null; lage: string }) {
  expect(Object.keys(v).sort()).toEqual(['kalla', 'lage', 'last_nar', 'varde']);
  expect(['last', 'olast', 'saknas']).toContain(v.lage);
  if (v.lage !== 'last') expect(v.varde).toBeNull();
  else { expect(v.varde).not.toBe(''); expect(v.varde).not.toEqual([]); }
}
async function kallsokning(monster: RegExp) {
  const dir = fileURLToPath(new URL('../src/', import.meta.url));
  const funna: string[] = [];
  for (const fil of readdirSync(dir, { recursive: true })) {
    if (typeof fil === 'string' && fil.endsWith('.ts') && monster.test(await readFile(`${dir}/${fil}`, 'utf8'))) funna.push(fil);
  }
  return funna;
}
function importer(text: string) {
  return [...text.matchAll(/\bfrom\s*['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]/g)].map((m) => m[1] ?? m[2]!);
}

beforeAll(async () => {
  user = await registerUser('undantag');
  for (const namn of ['poster', 'ko', 'belopp', 'franvaro', 'skala', 'tackning', 'ovrigt', 'tomt', 'ofullst', 'beskrivning']) {
    const id = await createCompany(user.token, `Undantag ${namn}`);
    bolag[namn] = id;
    await createFiscalYear(id, auth(), { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });
  }
  const tok = await api.post(`${co(bolag.poster!)}/agent-tokens`).set(auth()).send({ name: 'Hermes' });
  expect(tok.status, JSON.stringify(tok.body)).toBe(201);
  agentToken = tok.body.token;
  a = await frisktUppdrag(bolag.poster!, 'A');
  b = await frisktUppdrag(bolag.poster!, 'B');
  await svep(bolag.poster!);
  await withAdmin((db) => db.query(`UPDATE uppdrag_svepvarde SET varde=varde-'ovrigt'
    WHERE company_id=$1 AND contract_id=$2 AND nyckel='tackning'`, [bolag.poster!, b.contractId]));
  c = await nyttUppdrag(bolag.poster!, 'C');
  const imp = await ok(bolag.poster!, 'importera_leveranskontrakt', { contract_id: c.contractId, kontraktstext: LEVERANSKONTRAKT_NVR001 });
  postId.satt_baseline = imp.approval_id as string;
  for (const action of ['andra_baseline', 'upsert_contract_part', 'update_contract']) {
    postId[action] = await koa(bolag.poster!, action, action === 'update_contract' ? { contract_id: a.contractId, name: 'Avtal A nytt namn' } : andring(a.contractId, action));
  }
  postId.binda_kostnad = await koa(bolag.poster!, 'binda_kostnad', { receipt_id: await kvitto(bolag.poster!), contract_part_id: await del(bolag.poster!, a.contractId) });
  postId.avsluta_uppdrag = await koa(bolag.poster!, 'avsluta_uppdrag', { project_id: a.projektId });
  postId.scopeavgorande = (await ok(bolag.poster!, 'tand_scopesignal', { contract_id: a.contractId, fras: 'kan ni även', klausul: '5.4', underlag: {
    sort: 'mejl', extern_id: 'undantag@mail.example.se', extern_nyckel: 'rfc822#message-id', extern_kalla: 'gmail:prov',
  } })).id as string;
  granne = await registerUser('undantag-granne');
  grannbolag = await createCompany(granne.token, 'Grannens hemliga bolag');
  await createFiscalYear(grannbolag, auth(granne), { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });
  grannuppdrag = await nyttUppdrag(grannbolag, 'Grannens hemliga uppdrag', auth(granne));
  await ok(grannbolag, 'importera_leveranskontrakt', { contract_id: grannuppdrag.contractId, kontraktstext: LEVERANSKONTRAKT_NVR001 }, auth(granne));
  const q = await act(grannbolag, 'andra_baseline', andring(grannuppdrag.contractId), auth(granne));
  expect(q.status, JSON.stringify(q.body)).toBe(202);
  await ok(grannbolag, 'tand_scopesignal', { contract_id: grannuppdrag.contractId, fras: 'kan ni även' }, auth(granne));
  await ok(grannbolag, 'kor_uppdragssvep', {}, auth(granne));
}, 60_000);

describe('P2–P4/P6: lästa värden, ingångar och den stängda listan', () => {
  it('P2: typen är ensam och varje läst fält bär ursprung, också alla täckningslägen', async () => {
    // Sök deklarationer, så en namngiven typimport inte räknas som en typ.
    expect(await kallsokning(/^\s*(?:export\s+)?(?:type|interface)\s+Lasvarde\b/m)).toEqual(['lib/lasvarde.ts']);
    const svar = await undantag(bolag.poster!);
    expect(new Set(svar.poster.map((p) => p.slag))).toEqual(new Set(POSTSLAG));
    for (const p of svar.poster) for (const v of [p.uppdrag, p.forslag, p.skal, p.kallor]) arLasvarde(v);
    for (const t of svar.tackning) arLasvarde(t.tackning);
    expect(new Set(svar.tackning.map((t) => t.tackning.lage))).toEqual(new Set(['last', 'olast', 'saknas']));
  });
  it('P3: read utan människospärr, strikt tomt schema, tre lika ingångar', async () => {
    const action = ACTIONS.find((a) => a.name === 'las_undantag')!;
    expect(action.sensitivity).toBe('read');
    expect(action.kravManniska).toBeUndefined();
    expect(actionManifest().find((a) => a.name === 'las_undantag')?.requires_approval).toBe(false);
    const ogiltig = await act(bolag.poster!, 'las_undantag', { extra: 1 });
    expect(ogiltig.status).toBe(400); expect(ogiltig.body.error).toBe('validation_error');
    const direkt = await withTenantTransaction(user.userId, bolag.poster!, (db) => lasUndantag(db, bolag.poster!));
    expect(utanLastid(await undantag(bolag.poster!))).toEqual(utanLastid(direkt));
    expect(utanLastid(await undantag(bolag.poster!, { Authorization: `Bearer ${agentToken}` }))).toEqual(utanLastid(direkt));
  });
  it('P4: exakt fyra slag och sju källor; avgjort och övrig kö blir inga poster; läsningen skriver inte', async () => {
    expect(POSTSLAG).toEqual(['baselineandring', 'kostnadsbindning', 'avslut', 'scopeavgorande']);
    expect(KOBURNA_SLAG).toEqual({ baselineandring: ['satt_baseline', 'andra_baseline', 'upsert_contract_part', 'update_contract'], kostnadsbindning: ['binda_kostnad'], avslut: ['avsluta_uppdrag'] });
    const svar = await undantag(bolag.poster!);
    expect(svar.poster).toHaveLength(7);
    for (const [action, id] of Object.entries(postId)) {
      const p = svar.poster.find((p) => p.id === id)!;
      expect(p.identitet).toBe(action === 'scopeavgorande' ? 'signal' : 'kopost');
      expect(p.slag).toBe(action === 'scopeavgorande' ? 'scopeavgorande' : action === 'binda_kostnad' ? 'kostnadsbindning' : action === 'avsluta_uppdrag' ? 'avslut' : 'baselineandring');
    }
    await koa(bolag.poster!, 'book_receipt', { receipt_id: await kvitto(bolag.poster!) });
    const ja = await koa(bolag.poster!, 'andra_baseline', andring(a.contractId, 'JA'));
    await besluta(bolag.poster!, ja, 'approve');
    const nej = await koa(bolag.poster!, 'andra_baseline', andring(a.contractId, 'NEJ'));
    await aldreAvslag(bolag.poster!, nej);
    const mottagetId = await mottaget(bolag.poster!, andring(a.contractId, 'MOTTAGET'));
    expect((await undantag(bolag.poster!)).poster).toHaveLength(7);
    const fore = await antal(bolag.poster!);
    for (let i = 0; i < 3; i++) await undantag(bolag.poster!);
    expect(await antal(bolag.poster!)).toEqual(fore);
    expect((await svep(bolag.poster!)).mottagna_beslut).toEqual({ verkstallda: 1, kvar: 0 });
    expect(await withAdmin(async (db) => (await db.query('SELECT utfall FROM uppdrag_beslut WHERE approval_id=$1', [mottagetId])).rows)).toEqual([{ utfall: 'ja' }]);
  });
  it('P6: varje slag beskriver mandatet och saknat blir aldrig utfyllnad', async () => {
    const svar = await undantag(bolag.poster!);
    for (const p of svar.poster) {
      expect(p.uppdrag.varde?.number).toEqual(expect.any(Number));
      expect(p.uppdrag.varde?.name).toEqual(expect.any(String));
      for (const text of [p.val.kod, p.val.text, p.varfor_mandat, p.ja_registrerar]) expect(text.length).toBeGreaterThan(0);
      expect(p.kallor.varde!.length).toBeGreaterThan(0);
      for (const k of p.kallor.varde!) if (k.typ === 'yta') expect(k.sokvag.startsWith(`/app/c/${bolag.poster!}/`)).toBe(true);
    }
    const baseline = svar.poster.find((p) => p.atgard === 'satt_baseline')!;
    const forkl = await withTenantTransaction(user.userId, bolag.poster!, (db) => explainApproval(db, bolag.poster!, 'satt_baseline', { contract_id: c.contractId, kontraktstext: LEVERANSKONTRAKT_NVR001 }, `/app/c/${bolag.poster!}`));
    expect(baseline.forslag.varde).toEqual({ fran: forkl.change!.from, till: forkl.change!.to, belopp_ore: null });
    expect(svar.poster.find((p) => p.atgard === 'andra_baseline')!.skal.varde).toBe('Kunden bad om mer underlag');
    for (const action of ['update_contract', 'avsluta_uppdrag', 'binda_kostnad']) expect(svar.poster.find((p) => p.atgard === action)!.skal).toMatchObject({ lage: 'saknas', varde: null });
    const signal = svar.poster.find((p) => p.slag === 'scopeavgorande')!;
    expect(signal.forslag).toMatchObject({ lage: 'saknas', varde: null });
    expect(signal.kallor.varde).toContainEqual(expect.objectContaining({ typ: 'referens', extern_id: 'undantag@mail.example.se' }));
    const tom = await plantera(bolag.poster!, 'update_contract', { contract_id: a.contractId });
    expect((await undantag(bolag.poster!)).poster.find((p) => p.id === tom)!.forslag).toMatchObject({ lage: 'saknas', varde: null });
    const q = await withAdmin(async (db) => (await db.query(`SELECT input FROM action_approvals WHERE company_id=$1 AND id=$2`, [bolag.poster!, postId.binda_kostnad])).rows[0]!.input as { receipt_id: string });
    const ref = await withTenantTransaction(user.userId, bolag.poster!, (db) => skapaReferens(db, bolag.poster!, { contract_id: a.contractId, sort: 'drive', extern_id: 'handling-1', extern_nyckel: 'file-id', extern_kalla: 'drive:prov' }));
    await cache(bolag.poster!, a.contractId, `kostnadsforslag:${q.receipt_id}`, { receipt_id: q.receipt_id, leverabel_kod: 'L1', referens_id: ref.id }, 'drive');
    const rad = await withAdmin(async (db) => (await db.query(`SELECT last_nar FROM uppdrag_svepvarde WHERE company_id=$1 AND contract_id=$2 AND nyckel=$3`, [bolag.poster!, a.contractId, `kostnadsforslag:${q.receipt_id}`])).rows[0]!);
    const kostnad = (await undantag(bolag.poster!)).poster.find((p) => p.id === postId.binda_kostnad)!;
    expect(kostnad.skal).toMatchObject({ kalla: 'drive', last_nar: rad.last_nar.toISOString(), lage: 'last' });
    expect(kostnad.kallor).toMatchObject({ kalla: 'drive', last_nar: rad.last_nar.toISOString() });
    expect(kostnad.kallor.varde).toContainEqual(expect.objectContaining({ referens_id: ref.id }));
  });
});

it('P5: 230 mandatposter i SQL-ordning, medan listApprovals behåller 200 nyaste', async () => {
  const id = bolag.ko!;
  const u = await frisktUppdrag(id, 'Kön');
  await withTenantTransaction(user.userId, id, async (db) => {
    for (let i = 0; i < 230; i++) await createApproval(db, id, user.userId, 'agent', 'andra_baseline', andring(u.contractId, `K${i}`));
  });
  await withTenantTransaction(user.userId, id, async (db) => {
    for (let i = 0; i < 30; i++) await createApproval(db, id, user.userId, 'agent', 'book_receipt', {});
  });
  const vantade = await withAdmin(async (db) => (await db.query(`SELECT id FROM action_approvals WHERE company_id=$1 AND status='pending'
    AND action=ANY($2::text[]) ORDER BY created_at,id`, [id, UNDANTAG_ATGARDER])).rows.map((r) => r.id));
  const svar = await undantag(id);
  expect(svar.poster).toHaveLength(230); expect(svar.poster.map((p) => p.id)).toEqual(vantade);
  const begransad = await withTenantTransaction(user.userId, id, (db) => listApprovals(db, id, 'pending'));
  expect(begransad).toHaveLength(200);
  expect(begransad.slice(0, 30).every((p) => p.action === 'book_receipt')).toBe(true);
  expect(begransad.map((p) => p.created_at.getTime())).toEqual(begransad.map((p) => p.created_at.getTime()).sort((a, b) => b - a));
  expect((await withTenantTransaction(user.userId, id, (db) => listaVantandeKoposter(db, id, UNDANTAG_ATGARDER))).map((q) => q.id)).toEqual(vantade);
});

it('P7: alla fyra beloppen två gånger, även under avvikelsens trösklar', async () => {
  const id = bolag.belopp!; const u = await frisktUppdrag(id, 'Beloppen'); const part = await del(id, u.contractId);
  for (const ore of [100, 240000, 2200000, 3000000]) {
    await koa(id, 'binda_kostnad', { receipt_id: await kvitto(id, ore), contract_part_id: part });
    await koa(id, 'andra_baseline', { ...andring(u.contractId, `B${ore}`), cap_amount_ore: ore });
  }
  const vantat = [100, 100, 240000, 240000, 2200000, 2200000, 3000000, 3000000];
  expect((await undantag(id)).poster.map((p) => p.forslag.varde!.belopp_ore).sort((a, b) => a! - b!)).toEqual(vantat);
  await withAdmin((db) => db.query('UPDATE contracts SET troskel_golv_ore=900000000000,troskel_procent=999.99 WHERE company_id=$1 AND id=$2', [id, u.contractId]));
  expect((await undantag(id)).poster.map((p) => p.forslag.varde!.belopp_ore).sort((a, b) => a! - b!)).toEqual(vantat);
  const res = await act(id, 'las_undantag', { min_belopp_ore: 1 });
  expect(res.status).toBe(400); expect(res.body.error).toBe('validation_error');
});

it('P8: tio rutin-/driftfall ger noll poster, riktig mandatpost ger en', async () => {
  const id = bolag.franvaro!; const u = await frisktUppdrag(id, 'Frånvaro'); const u2 = await frisktUppdrag(id, 'Frånvaro 2');
  await ok(id, 'paborja_leverabel', { contract_id: u.contractId, leverabel_kod: 'L1' });
  await cache(id, u.contractId, 'statusforslag:L3', { fran: 'ej_paborjad', till: 'pagar' });
  await ok(id, 'satt_bedomning', { contract_id: u.contractId, period_start: '2026-09-03', period_slut: '2026-09-17', lage: 'pa_spar' });
  const q = await plantera(id, 'andra_baseline', andring(u.contractId));
  await withAdmin((db) => db.query(`UPDATE action_approvals SET status='failed',error='driftfel' WHERE company_id=$1 AND id=$2`, [id, q]));
  const refs: string[] = [];
  for (const namn of ['ko', 'drift', 'trasig']) {
    const r = await withTenantTransaction(user.userId, id, (db) => skapaReferens(db, id, { contract_id: u.contractId, sort: 'drive', extern_id: `franvaro-${namn}`, extern_nyckel: 'file-id', extern_kalla: 'drive:prov', titel_vid_lankning: 'före' }));
    refs.push(r.id);
  }
  await withAdmin((db) => db.query(`UPDATE uppdrag_referens SET ko_status='fel',ko_fel='driftfel' WHERE company_id=$1 AND id=$2`, [id, refs[0]]));
  await withTenantTransaction(user.userId, id, async (db) => {
    await verifieraReferens(db, id, refs[1]!, { finns: true, titel: 'efter' });
    await verifieraReferens(db, id, refs[2]!, { finns: false });
  });
  await svep(id);
  await cache(id, u.contractId, 'tackning', Object.fromEntries(MANDATKALLOR.map((k) => [k, { lage: k === 'kostnader' ? 'fel' : 'last', saknas: [] }])));
  await aldra(id, u.contractId, TACKNING_MAX_ALDER_MIN + 1);
  await cache(id, u.contractId, 'troskellarm', { larm: [{ kod: 'L1' }] });
  await cache(id, u2.contractId, 'prognos', { villkor: 'ingen bokad framtid' });
  const vakter = await withAdmin(async (db) => {
    const exists = async (sql: string, param: unknown[] = [id, u.contractId]) => (await db.query(sql, param)).rowCount! > 0;
    return [
      await exists('SELECT 1 FROM uppdrag_leverabel_handelse WHERE company_id=$1 AND contract_id=$2'),
      await exists("SELECT 1 FROM uppdrag_svepvarde WHERE company_id=$1 AND contract_id=$2 AND nyckel='statusforslag:L3'"),
      await exists("SELECT 1 FROM uppdrag_bedomning WHERE company_id=$1 AND contract_id=$2 AND lage='pa_spar'"),
      await exists("SELECT 1 FROM action_approvals WHERE company_id=$1 AND id=$2 AND status='failed' AND error IS NOT NULL", [id, q]),
      await exists("SELECT 1 FROM uppdrag_referens WHERE company_id=$1 AND id=$2 AND ko_status='fel' AND ko_fel IS NOT NULL", [id, refs[0]]),
      await exists("SELECT 1 FROM uppdrag_svepvarde WHERE company_id=$1 AND contract_id=$2 AND nyckel='tackning' AND varde->'kostnader'->>'lage'='fel'"),
      await exists("SELECT 1 FROM uppdrag_svepvarde WHERE company_id=$1 AND contract_id=$2 AND nyckel='tackning' AND last_nar<now()-interval '60 minutes'"),
      await exists("SELECT 1 FROM uppdrag_svepvarde WHERE company_id=$1 AND contract_id=$2 AND nyckel='troskellarm' AND jsonb_array_length(varde->'larm')>0"),
      await exists("SELECT 1 FROM uppdrag_referens WHERE company_id=$1 AND id=ANY($2::uuid[]) AND status IN ('drift','trasig') GROUP BY company_id HAVING count(*)=2", [id, refs.slice(1)]),
      await exists("SELECT 1 FROM uppdrag_svepvarde WHERE company_id=$1 AND contract_id=$2 AND nyckel='prognos' AND varde->>'villkor'='ingen bokad framtid' AND NOT EXISTS (SELECT 1 FROM uppdrag_svepvarde WHERE company_id=$1 AND contract_id=$2 AND nyckel='troskellarm')", [id, u2.contractId]),
    ];
  });
  for (const vakt of vakter) { expect(vakt).toBe(true); korda.p8++; }
  expect((await undantag(id)).poster).toEqual([]);
  await koa(id, 'andra_baseline', andring(u.contractId, 'MANDAT'));
  expect((await undantag(id)).poster).toHaveLength(1);
});

it('P9: tre gånger så många friska uppdrag döljer inga verkliga poster', async () => {
  const id = bolag.skala!;
  const frisk = async (namn: string) => {
    const u = await frisktUppdrag(id, namn);
    await ok(id, 'satt_bedomning', { contract_id: u.contractId, period_start: '2026-09-03', period_slut: '2026-09-17', lage: 'pa_spar' });
    await ok(id, 'paborja_leverabel', { contract_id: u.contractId, leverabel_kod: 'L1' });
    await svep(id); return u;
  };
  const u = await frisk('Skala A'); await koa(id, 'andra_baseline', andring(u.contractId));
  expect((await undantag(id)).poster).toHaveLength(1);
  const u2 = await frisk('Skala B'); const u3 = await frisk('Skala C');
  expect((await undantag(id)).poster).toHaveLength(1);
  await koa(id, 'binda_kostnad', { receipt_id: await kvitto(id), contract_part_id: await del(id, u2.contractId) });
  await koa(id, 'avsluta_uppdrag', { project_id: u3.projektId });
  await ok(id, 'tand_scopesignal', { contract_id: u2.contractId, fras: 'kan ni även' });
  expect((await undantag(id)).poster).toHaveLength(4);
});

it('P10/P11: alla öppna avtal, två skrivomfång och tretton täckningsfall', async () => {
  const id = bolag.tackning!;
  const stangt = await frisktUppdrag(id, 'Stängt');
  await ok(id, 'set_project_status', { project_id: stangt.projektId, status: 'closed' });
  const u = await frisktUppdrag(id, 'Täckning A'); const u2 = await frisktUppdrag(id, 'Täckning B');
  const utanBaseline = await nyttUppdrag(id, 'Utan baseline');
  const projekt = (await ok(id, 'create_project', { name: 'Utkast' })).id;
  const utkast = (await ok(id, 'create_contract', { project_id: projekt, name: 'Utkastsavtal' })).id as string;
  const first = await svep(id);
  expect(first.tackning).toHaveLength(16);
  expect(first.tackning.some((t) => t.contract_id === stangt.contractId)).toBe(false);
  const rader = await withAdmin(async (db) => (await db.query(`SELECT contract_id,kalla,last_nar,varde FROM uppdrag_svepvarde WHERE company_id=$1 AND nyckel='tackning'`, [id])).rows);
  expect(rader).toHaveLength(4);
  for (const rad of rader) { expect(rad.kalla).toBe('redovisning'); expect(rad.last_nar).toBeInstanceOf(Date); expect(Object.keys(rad.varde).sort()).toEqual([...MANDATKALLOR].sort()); }
  const indata = { uppdrag: [{ contract_id: u.contractId }] };
  await svep(id, indata);
  const andra = await svep(id, indata);
  expect(andra.uppdrag[0]!.borttagna).toBe(0);
  expect((await undantag(id)).tackning.filter((t) => t.contract_id === u.contractId)).toHaveLength(4);
  const fore = await withAdmin(async (db) => (await db.query('SELECT * FROM uppdrag_svepvarde WHERE company_id=$1 ORDER BY id', [id])).rows);
  for (const [omfang, nyckel] of [['svep', 'tackning'], ['tackning', 'prognos']] as const) {
    expect(await fel(withTenantTransaction(user.userId, id, (db) => upsertSvepvarden(db, id, u.contractId, [{ nyckel, varde: {} }], omfang)))).toBeInstanceOf(Error);
  }
  expect(await withAdmin(async (db) => (await db.query('SELECT * FROM uppdrag_svepvarde WHERE company_id=$1 ORDER BY id', [id])).rows)).toEqual(fore);
  const kontroll = async (contractId: string, kalla: Mandatkalla, lage: 'last' | 'fel', saknade: string[] = []) => {
    const s = await svep(id); const t = s.tackning.find((t) => t.contract_id === contractId && t.kalla === kalla)!;
    expect(t).toMatchObject({ lage, saknas: saknade }); korda.p11++;
  };
  await kontroll(u.contractId, 'godkannandekon', 'last');
  const receiptId = await kvitto(id);
  await cache(id, u.contractId, `kostnadsforslag:${receiptId}`, { receipt_id: receiptId });
  await kontroll(u.contractId, 'kostnader', 'fel', [receiptId]);
  await koa(id, 'binda_kostnad', { receipt_id: receiptId, contract_part_id: await del(id, u2.contractId) });
  await kontroll(u.contractId, 'kostnader', 'fel', [receiptId]);
  const bindning = await koa(id, 'binda_kostnad', { receipt_id: receiptId, contract_part_id: await del(id, u.contractId) });
  await kontroll(u.contractId, 'kostnader', 'last');
  await aldreAvslag(id, bindning);
  await kontroll(u.contractId, 'kostnader', 'last');
  await kontroll(utanBaseline.contractId, 'baselineforslag', 'fel', [utanBaseline.contractId]);
  await ok(id, 'importera_leveranskontrakt', { contract_id: utanBaseline.contractId, kontraktstext: LEVERANSKONTRAKT_NVR001 });
  await kontroll(utanBaseline.contractId, 'baselineforslag', 'last');
  await kontroll(utkast, 'baselineforslag', 'last');
  const rad = (await ok(id, 'skriv_uppdragsanteckning', { contract_id: u.contractId, text: 'Kunden ber om extra material', utanfor_avtal: true })).id as string;
  await kontroll(u.contractId, 'ovrigt', 'fel', [rad]);
  const input = { ...andring(u.contractId, 'OVRIGT'), kalla: { typ: 'anteckning', id: rad } };
  const ko = await plantera(id, 'andra_baseline', input);
  await kontroll(u.contractId, 'ovrigt', 'last');
  await aldreAvslag(id, ko); await kontroll(u.contractId, 'ovrigt', 'fel', [rad]);
  const mottagetId = await mottaget(id, input); await kontroll(u.contractId, 'ovrigt', 'last');
  expect((await svep(id)).mottagna_beslut).toEqual({ verkstallda: 0, kvar: 1 });
  expect(await withAdmin(async (db) => (await db.query('SELECT status,result FROM action_approvals WHERE id=$1', [mottagetId])).rows)).toEqual([{ status: 'approved', result: null }]);
  await ok(id, 'skriv_uppdragsanteckning', { contract_id: u.contractId, text: 'En vanlig anteckning', utanfor_avtal: false });
  await kontroll(u.contractId, 'ovrigt', 'last');
});

it('P12: en nyupptäckt Övrigt-rad gör underlaget ofullständigt utan ny fråga', async () => {
  const id = bolag.ovrigt!; const u = await frisktUppdrag(id, 'Övrigt');
  await svep(id); expect((await undantag(id)).utfall).toBe('verifierat_tomt');
  const antalFore = (await antal(id)).ko;
  const rad = (await ok(id, 'skriv_uppdragsanteckning', { contract_id: u.contractId, text: 'Nytt underlag utanför avtalet', utanfor_avtal: true })).id;
  await svep(id); const s = await undantag(id);
  expect(s.utfall).toBe('ofullstandigt'); expect(s.poster).toEqual([]);
  expect(s.ofullstandig_tackning).toHaveLength(1);
  expect(s.ofullstandig_tackning[0]).toMatchObject({ kalla: 'ovrigt', contract_id: u.contractId, contract_name: 'Avtal Övrigt', orsak: 'fel', tackning: { varde: { saknas: [rad] } } });
  expect((await antal(id)).ko).toBe(antalFore);
});

it('P13: verifierat tomt bär äldsta cachetid, 59 minuter är färskt', async () => {
  const id = bolag.tomt!; const u = await frisktUppdrag(id, 'Tomt'); await svep(id);
  const s = await undantag(id); expect(s.utfall).toBe('verifierat_tomt');
  const tid = await withAdmin(async (db) => (await db.query(`SELECT last_nar FROM uppdrag_svepvarde WHERE company_id=$1 AND contract_id=$2 AND nyckel='tackning'`, [id, u.contractId])).rows[0]!.last_nar.toISOString());
  expect(s.aldsta_tackning).toBe(tid);
  await aldra(id, u.contractId, 59); expect((await undantag(id)).utfall).toBe('verifierat_tomt');
  expect(await kallsokning(/\bTACKNING_MAX_ALDER_MIN\s*=/)).toEqual(['services/uppdragUndantag.ts']);
});

it('P14: sju ofullständiga lägen, posterna finns kvar vid gammal täckning', async () => {
  const id = bolag.ofullst!; const u = await frisktUppdrag(id, 'Ofullständigt');
  const kontroll = async (orsak: string, contractId = u.contractId, kallor: readonly string[] = MANDATKALLOR) => {
    const s = await undantag(id); expect(s.utfall).toBe('ofullstandigt');
    const t = s.ofullstandig_tackning.filter((t) => t.contract_id === contractId);
    expect(t.map((t) => t.kalla)).toEqual(kallor);
    for (const p of t) { expect(p.orsak).toBe(orsak); expect(p.contract_name.length).toBeGreaterThan(0); arLasvarde(p.tackning); }
    korda.p14++; return s;
  };
  await kontroll('saknas');
  await svep(id); await withAdmin((db) => db.query(`UPDATE uppdrag_svepvarde SET varde=jsonb_set(varde,'{kostnader,lage}','"fel"') WHERE company_id=$1 AND contract_id=$2 AND nyckel='tackning'`, [id, u.contractId])); await kontroll('fel', u.contractId, ['kostnader']);
  await svep(id); await aldra(id, u.contractId, 61); await kontroll('gammal');
  await svep(id); await withTenantTransaction(user.userId, id, (db) => db.query('DELETE FROM uppdrag_svepvarde WHERE company_id=$1', [id])); await kontroll('saknas');
  await svep(id); await withAdmin((db) => db.query(`UPDATE uppdrag_svepvarde SET varde='{}'::jsonb WHERE company_id=$1 AND contract_id=$2 AND nyckel='tackning'`, [id, u.contractId])); await kontroll('olast');
  await svep(id); await aldra(id, u.contractId, 61); const q = await koa(id, 'andra_baseline', andring(u.contractId));
  const s = await kontroll('gammal'); expect(s.poster.map((p) => p.id)).toContain(q);
  await svep(id); const nytt = await nyttUppdrag(id, 'Nytt efter svepet'); await kontroll('saknas', nytt.contractId);
  expect((await undantag(id)).tackning.filter((t) => t.contract_id === u.contractId).every((t) => t.farsk)).toBe(true);
});

it('P15: grannbolaget syns inte, och ogiltiga uuid förgiftar inte transaktionen', async () => {
  const id = bolag.poster!;
  const fore = JSON.stringify(await undantag(id));
  expect(fore).not.toContain(grannuppdrag.contractId); expect(fore).not.toContain(grannuppdrag.projektId); expect(fore).not.toContain('Grannens hemliga');
  const q = await plantera(id, 'update_contract', { contract_id: grannuppdrag.contractId });
  const ogiltig = await plantera(id, 'update_contract', { contract_id: '-'.repeat(36) });
  const s = await undantag(id);
  for (const id of [q, ogiltig]) expect(s.hoppade).toContainEqual({ id, identitet: 'kopost', atgard: 'update_contract', orsak: 'uppdrag_saknas' });
  expect(JSON.stringify(s)).not.toContain('Grannens hemliga');
  const res = await act(grannbolag, 'las_undantag', {}); expect(res.status).toBe(404);
  // Äldre avtalsdelar är fortfarande giltiga uppslagsnycklar, även inaktiva.
  const aldre = await del(id, a.contractId);
  const input = { ...andring(a.contractId, 'L1'), valid_from: '2026-10-06', active: false };
  const ny = await koa(id, 'andra_baseline', input); await besluta(id, ny, 'approve');
  const bind = await koa(id, 'binda_kostnad', { receipt_id: await kvitto(id), contract_part_id: aldre });
  expect((await undantag(id)).poster.map((p) => p.id)).toContain(bind);
  const stangt = await frisktUppdrag(id, 'Avslutat');
  const stangKo = await koa(id, 'avsluta_uppdrag', { project_id: stangt.projektId });
  const signal = (await ok(id, 'tand_scopesignal', { contract_id: stangt.contractId, fras: 'kan ni även' })).id;
  await ok(id, 'set_project_status', { project_id: stangt.projektId, status: 'closed' });
  const sista = await undantag(id);
  for (const identitet of ['kopost', 'signal']) expect(sista.hoppade).toContainEqual(expect.objectContaining({ id: identitet === 'kopost' ? stangKo : signal, identitet, orsak: 'uppdrag_avslutat' }));
});

it('P16: importsökningen fångar planterad nätverksimport, och läsvägen anropar aldrig fetch', async () => {
  expect(importer("import x from 'node:http'; import('node:https')")).toEqual(['node:http', 'node:https']);
  const tillatna = ['pg', '../lib/lasvarde.js', '../domain/money.js', './approvals.js', './approvalSummary.js', '../http/middleware/authenticate.js'];
  for (const fil of ['../src/services/uppdragUndantag.ts', '../src/lib/lasvarde.ts']) {
    const text = await readFile(new URL(fil, import.meta.url), 'utf8');
    expect(importer(text).filter((i) => !tillatna.includes(i))).toEqual([]);
  }
  const stub = vi.fn(() => { throw new Error('nätverksanrop under läsningen'); });
  vi.stubGlobal('fetch', stub);
  try { expect((await act(bolag.poster!, 'las_undantag', {})).status).toBe(200); expect(stub).not.toHaveBeenCalled(); }
  finally { vi.unstubAllGlobals(); }
});

it('AI-Review: mål läses inom bolaget, främmande och ogiltiga mål blir saknat utan förgiftad transaktion', async () => {
  const id = bolag.beskrivning!;
  const u = await frisktUppdrag(id, 'Beslutsunderlag');
  const annat = await frisktUppdrag(id, 'Annat avtal');
  const fil = async (companyId: string, userId: string, namn: string, hash: string) => withAdmin(async (db) => {
    const r = await db.query(`INSERT INTO files (company_id,original_name,stored_name,mime_type,size_bytes,sha256,uploaded_by)
      VALUES ($1,$2,gen_random_uuid()::text || '.pdf','application/pdf',10,$3,$4) RETURNING id`, [companyId, namn, hash, userId]);
    return r.rows[0]!.id as string;
  });
  const kunder: string[] = [], filer: string[] = [], delar: string[] = [];
  for (const [nummer, kod] of [[1, 'L1'], [2, 'L2']] as const) {
    kunder.push((await ok(id, 'create_customer', { name: `Målkund ${nummer}` })).id as string);
    filer.push(await fil(id, user.userId, `Målhandling ${nummer}.pdf`, String(nummer).repeat(64)));
    delar.push(await del(id, u.contractId, kod));
  }
  for (const [falt, action, mal] of [
    ['customer_id', 'update_contract', kunder], ['source_file_id', 'update_contract', filer],
    ['parent_part_id', 'andra_baseline', delar], ['parent_part_id', 'upsert_contract_part', delar],
  ] as const) {
    const svar: Undantagspost[] = [];
    for (const target of mal) {
      const input = action === 'update_contract' ? { contract_id: u.contractId, [falt]: target } : { ...andring(u.contractId), [falt]: target };
      const q = await koa(id, action, input);
      const p = (await undantag(id)).poster.find((p) => p.id === q)!;
      const v = p.forslag.varde!.mal![falt]!;
      arLasvarde(v); expect(v.lage).toBe('last'); expect(v.varde!.id).toBe(target);
      expect(p.forslag.varde!.till).toContain(Reflect.get(v.varde!, falt === 'customer_id' ? 'name' : falt === 'source_file_id' ? 'original_name' : 'code'));
      svar.push(p);
      if (falt !== 'parent_part_id') expect(p.kallor.varde).toContainEqual(expect.objectContaining({ typ: 'yta', sokvag: falt === 'customer_id'
        ? `/app/c/${id}/customers/${target}` : `/app/c/${id}/documents/${target}/download` }));
    }
    expect(svar[0]!.forslag).not.toEqual(svar[1]!.forslag);
  }
  const grannkund = (await ok(grannbolag, 'create_customer', { name: 'Hemlig målkund' }, auth(granne))).id as string;
  const grannfil = await fil(grannbolag, granne.userId, 'Hemlig målhandling.pdf', 'f'.repeat(64));
  // Egen användare tillhör flera bolag; uttryckligt company_id behövs även där RLS släpper igenom.
  const egetAnnatBolagKund = (await ok(bolag.poster!, 'create_customer', { name: 'Mål i annat medlemsbolag' })).id as string;
  const egetAnnatBolagFil = await fil(bolag.poster!, user.userId, 'Handling i annat medlemsbolag.pdf', 'e'.repeat(64));
  const egetAnnatBolagDel = await del(bolag.poster!, a.contractId, 'L2');
  for (const [falt, action, frammande] of [
    ['customer_id', 'update_contract', [grannkund, egetAnnatBolagKund]],
    ['source_file_id', 'update_contract', [grannfil, egetAnnatBolagFil]],
    ['parent_part_id', 'andra_baseline', [egetAnnatBolagDel, await del(id, annat.contractId)]],
    ['parent_part_id', 'upsert_contract_part', [egetAnnatBolagDel, await del(id, annat.contractId)]],
  ] as const) for (const target of [...frammande, '11111111-1111-1111-1111-111111111111', '-'.repeat(36)]) {
    const q = await plantera(id, action, { ...andring(u.contractId), [falt]: target });
    const p = (await undantag(id)).poster.find((p) => p.id === q)!;
    expect(p.forslag.varde!.mal![falt]).toMatchObject({ lage: 'saknas', varde: null });
    expect(p.forslag.varde!.till).toContain('saknas i underlaget');
    expect(JSON.stringify(p)).not.toMatch(/Hemlig mål|annat medlemsbolag/);
  }
});

it('AI-Review: ja till ren bekräftelse ändrar bara takflaggan; ja till version skapar en rad', async () => {
  const id = bolag.beskrivning!;
  const u = await frisktUppdrag(id, 'Verkan');
  const rader = () => withAdmin(async (db) => (await db.query(
    `SELECT id,code,valid_from::text,cap_confirmed,name,description,billable,active,
            cap_hours,cap_amount_ore,hourly_rate_ore,parent_part_id,sort_order,start_date::text,end_date::text,date_precision
       FROM contract_parts WHERE company_id=$1 AND contract_id=$2 ORDER BY id`, [id, u.contractId],
  )).rows);
  for (const code of ['TAK-A', 'TAK-B']) {
    const obekraftad = await koa(id, 'upsert_contract_part', { ...andring(u.contractId, code), cap_hours: 12, cap_confirmed: false });
    await besluta(id, obekraftad, 'approve');
    const fore = await rader();
    const rad = fore.find((r) => r.code === code)!;
    expect(rad.cap_confirmed).toBe(false);
    const q = await koa(id, 'upsert_contract_part', { contract_id: u.contractId, code, valid_from: rad.valid_from, cap_confirmed: true });
    const p = (await undantag(id)).poster.find((p) => p.id === q)!;
    expect(p.ja_registrerar).toContain('befintlig version');
    expect(p.ja_registrerar).toContain(rad.valid_from);
    await besluta(id, q, 'approve');
    expect(await rader()).toEqual(fore.map((r) => r.id === rad.id ? { ...r, cap_confirmed: true } : r));
  }
  for (const [index, action] of ['upsert_contract_part', 'andra_baseline'].entries()) {
    const fore = await rader();
    const code = `NY-${index}`;
    const q = await koa(id, action, { ...andring(u.contractId, code), cap_confirmed: true, billable: false, active: false });
    const p = (await undantag(id)).poster.find((p) => p.id === q)!;
    expect(p.ja_registrerar).toContain('En ny version');
    await besluta(id, q, 'approve');
    const efter = await rader();
    expect(efter.filter((r) => r.code !== code)).toEqual(fore);
    expect(efter.filter((r) => r.code === code)).toEqual([expect.objectContaining({ cap_confirmed: true, billable: false, active: false, valid_from: '2026-10-01' })]);
  }
});

it('AI-Review: utan valid_from visas och skrivs signed_date, explicit datum vinner och saknat förblir saknat', async () => {
  const id = bolag.beskrivning!;
  for (const signed_date of ['2026-09-03', '2027-01-12', undefined]) {
    const projektId = (await ok(id, 'create_project', { name: `Datum ${signed_date ?? 'saknas'}` })).id as string;
    // create_contract accepterar även osignerat utkast; skapa_uppdrag kräver datum.
    const contractId = (await ok(id, 'create_contract', { project_id: projektId, name: 'Datumavtal', signed_date })).id as string;
    const lagrade = () => withAdmin(async (db) => (await db.query(
      'SELECT code,valid_from::text,cap_confirmed FROM contract_parts WHERE company_id=$1 AND contract_id=$2 ORDER BY code', [id, contractId],
    )).rows);
    for (const [code, valid_from] of [['ARVT', undefined], ['EXPLICIT', '2027-03-04']] as const) {
      const q = await koa(id, 'upsert_contract_part', { ...andring(contractId, code), valid_from });
      const p = (await undantag(id)).poster.find((p) => p.id === q)!;
      const datum = valid_from ?? signed_date;
      if (datum === undefined) {
        expect(p.ja_registrerar).toContain('datum saknas');
        expect(p.forslag.varde!.till).not.toMatch(/från \d{4}-\d{2}-\d{2}/);
        await besluta(id, q, 'reject', 'Datum saknas');
        expect(await lagrade()).toEqual([]);
        continue;
      }
      expect(p.ja_registrerar).toContain(`från ${datum}`);
      expect(p.forslag.varde!.till).toContain(`från ${datum}`);
      await besluta(id, q, 'approve');
      expect((await lagrade()).find((r) => r.code === code)).toEqual({ code, valid_from: datum, cap_confirmed: false });
      // Ett utkast får inte bekräftat tak. Datumprovet ändrar inte den spärren.
      if (signed_date === undefined) continue;
      const bekräftelse = await koa(id, 'upsert_contract_part', { contract_id: contractId, code, valid_from, cap_confirmed: true });
      const b = (await undantag(id)).poster.find((p) => p.id === bekräftelse)!;
      expect(b.ja_registrerar).toContain(`från ${datum}`);
      expect(b.ja_registrerar).toContain('befintlig version');
      await besluta(id, bekräftelse, 'approve');
      expect((await lagrade()).find((r) => r.code === code)).toEqual({ code, valid_from: datum, cap_confirmed: true });
    }
  }
});

describe('Rena regler och beskrivningar utan klocka eller databas', () => {
  it('AI-Review: effektivt giltighetsdatum visas för version och bekräftelse; saknat datum gissas aldrig', provaDatum);
  it('AI-Review: verkan stämmer med skrivvägens bekräftelseklassificering för alla fält', provaVerkan);
  it('AI-Review: identifierade mål skiljer förslag åt och saknade mål visas ärligt', provaMal);
  it('AI-Review: alla precisioner och angivna intervallgränser beskriver det konkreta valet', provaLasbaraFalt);
  it('AI-Review: varje giltigt verksamhetsfält särskiljer beslutsunderlaget på båda versionsvägarna', () => {
    provaScheman();
    provaAllaDelfalt();
  });
  it('Lasvarde, sorterad täckning och gränsen 60 minuter inklusive', () => {
    expect(last(100, 'redovisning', '2026-10-07T12:00:00.000Z')).toEqual({ varde: 100, kalla: 'redovisning', last_nar: '2026-10-07T12:00:00.000Z', lage: 'last' });
    for (const f of [olast, saknas]) expect(f('redovisning', null).varde).toBeNull();
    expect(KALLA_REDOVISNING).toBe('redovisning'); expect(TACKNING_MAX_ALDER_MIN).toBe(60);
    expect(kalltackning(['b', 'a'])).toEqual({ lage: 'fel', saknas: ['a', 'b'] });
    expect(kalltackning([])).toEqual({ lage: 'last', saknas: [] });
    const avtal = { contract_id: 'a', contract_name: 'A', project_id: 'p', project_name: 'P' };
    const rad = { varde: { godkannandekon: { lage: 'last', saknas: [] } }, last_nar: new Date('2026-10-07T11:00:00Z') };
    const farsk = tackningspost(avtal, 'godkannandekon', rad, new Date('2026-10-07T12:00:00Z'));
    expect(farsk.farsk).toBe(true); expect(bedomUndantag([], [farsk]).utfall).toBe('verifierat_tomt');
    const gammal = tackningspost(avtal, 'godkannandekon', rad, new Date('2026-10-07T12:00:01Z'));
    expect(gammal.orsak).toBe('gammal'); expect(bedomUndantag([], [gammal]).utfall).toBe('ofullstandigt');
    for (const varde of [null, [], {}, { godkannandekon: null }, { godkannandekon: { lage: 'last', saknas: 'fel' } }, Object.create({ godkannandekon: { lage: 'last', saknas: [] } })]) {
      expect(tackningspost(avtal, 'godkannandekon', { ...rad, varde }, new Date('2026-10-07T12:00:00Z')).orsak).toBe('olast');
    }
    expect(tackningspost(avtal, 'ovrigt', undefined, new Date('2026-10-07T12:00:00Z')).tackning).toEqual(saknas('redovisning', null));
    expect(bedomUndantag([], []).aldsta_tackning).toBeNull();
    expect(bedomUndantag([{} as Undantagspost], [farsk]).utfall).toBe('poster');
    expect(bedomUndantag([{} as Undantagspost], [gammal]).utfall).toBe('ofullstandigt');
  });
  it('en ren beskrivning per slag, inklusive saknade skäl och förslag', () => {
    const tid = '2026-10-07T12:00:00.000Z'; const bas = '/app/c/bolag';
    const uppdrag = { project_id: 'p', number: 1, name: 'P', contract_id: 'c', contract_name: 'C' };
    const kopost = { id: 'q', action: 'andra_baseline', input: { ...andring('c'), cap_amount_ore: 100 }, created_at: new Date(tid), requested_actor: 'agent' as const };
    const baseline = beskrivBaselineandring({ kopost, uppdrag }, bas, tid);
    expect(baseline.forslag.varde!.belopp_ore).toBe(100); expect(baseline.skal.varde).toBe('Kunden bad om mer underlag');
    const kostnad = beskrivKostnadsbindning({ kopost: { ...kopost, action: 'binda_kostnad' }, uppdrag, del: { code: 'L1', name: 'Leverans' }, kvitto: { total_ore: 100, nuvarande_del: null }, sammanfattning: null }, bas, tid);
    expect(kostnad.forslag.varde).toEqual({ fran: 'obunden', till: 'L1 · Leverans', belopp_ore: 100 }); expect(kostnad.skal.lage).toBe('saknas');
    const avslut = beskrivAvslut({ kopost: { ...kopost, action: 'avsluta_uppdrag' }, uppdrag, oppnaLeverabler: [{ contract_name: 'C', code: 'L1' }] }, bas, tid);
    expect(avslut.forslag.varde!.till).toContain('L1'); expect(avslut.skal.lage).toBe('saknas');
    const signal = beskrivScopeavgorande({ signal: { id: 's', fras: 'kan ni även', klausul: null, tand_av: null, tand_nar: new Date(tid) }, uppdrag }, bas, tid);
    expect(signal.forslag.lage).toBe('saknas'); expect(signal.skal.varde).toContain('av okänd');
    for (const p of [baseline, kostnad, avslut, signal]) for (const v of [p.uppdrag, p.forslag, p.skal, p.kallor]) arLasvarde(v);
  });
});

it('kontrollvakt: alla negativa fall och täckningsregler kördes', () => {
  expect(korda.p8).toBeGreaterThanOrEqual(10);
  expect(korda.p11).toBeGreaterThanOrEqual(13);
  expect(korda.p14).toBeGreaterThanOrEqual(7);
});
