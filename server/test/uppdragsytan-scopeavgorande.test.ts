// Story 1.9 (B-8, FR-7, FR-41, FR-8): ett scopeavgörande blir en ny rad i
// historiken.
//
// Provet täcker fem risker, i REST, MCP:s väg (agentnyckeln), vyn och SQL:
//   * att ett avgörande skriver över ett tidigare — då går gränsen för
//     åtagandet inte att följa i efterhand (K1, K3, K6);
//   * att en tänd signal inte når David, eller står kvar som fråga efter
//     avgörandet (K4);
//   * att någon annan än en människa avgör (K3 e, K5 g);
//   * att ett tillägg köas två gånger för samma signal (K5 d–e);
//   * att ett avslutat uppdrag tar emot avgöranden (K1 h, K3 h, K4 g).
// De rena reglerna ligger i `scopeavgorandeHelper.ts` och går att köra utan
// databas. Migrationen som migration prövas i `uppdragsytan-migration-0081.test.ts`.
import supertest from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import * as h from './scopeavgorandeHelper.js';
import { app, api, createCompany, createFiscalYear, registerUser, withAdmin, type TestUser } from './helpers.js';
import { withTenantTransaction } from '../src/db/tx.js';
import { actionManifest } from '../src/actions/registry.js';
import { BASELINEKOLUMNER } from '../src/lib/baselinekolumner.js';
import { TILLAGGSORSAK_MAX } from '../src/lib/scopeavgorande.js';
import { beslutHash, createApproval } from '../src/services/approvals.js';

describe('K0 de rena reglerna', () => {
  it('a orsaken får prefixet', h.provaOrsak);
  it('b prefixet står alltid, och texten trimmas', h.provaOrsakTrimmasOchPrefixStarAlltid);
  it('c orsaken ryms alltid i 2000 tecken', h.provaOrsakRymsIGransen);
  it('d utan senaste avgörande är inget upprepat', h.provaUtanSenaste);
  it('e samma val och samma referens är upprepat', h.provaSammaValSammaReferens);
  it('f samma val och båda utan referens är upprepat', h.provaSammaValBadaUtanReferens);
  it('g ett annat val är en rättelse', h.provaAnnatVal);
  it('h samma val på ett annat underlag är en ny rad', h.provaOlikaReferenser);
  it('i samma val där referensen tillkommit är en ny rad', h.provaReferensenTillkom);
});

const PASSWORD = 'mycket-hemligt-losen-123';
const NOLL = '00000000-0000-4000-8000-000000000000';
const MEJL = {
  sort: 'mejl',
  extern_id: 'CAF7v2h9k@mail.gmail.com',
  extern_nyckel: 'rfc822#message-id',
  extern_kalla: 'gmail:david@locollabs.com',
};

interface Bolag { id: string; user: TestUser; agent: Record<string, string>; ua: ReturnType<typeof supertest.agent> }
interface Uppdrag { projectId: string; contractId: string }
interface Avgorandrad {
  id: string; company_id: string; contract_id: string; signal_id: string; lopnummer: number;
  avgorande: string; avgjort_av: string | null; avgjort_nar: string | null;
  underlag_ref_id: string | null; tillagg_approval_id: string | null; overford: boolean; created_at: string;
}
interface Kopost { id: string; status: string; input: Record<string, unknown>; requested_actor: string }
interface Auditrad { entity_type: string | null; entity_id: string | null; details: Record<string, unknown> }

const auth = (b: Bolag) => ({ Authorization: `Bearer ${b.user.token}` });
const co = (b: Bolag) => `/api/companies/${b.id}`;
const fel = <T>(p: Promise<T>) => p.then(() => null, (e: unknown) => e);
const korda = { k1f: 0, k1g: 0, k3eg: 0, k4c: 0, k5status: 0, k5versaler: 0, k6b: 0 };
let statusfall = 0;

let schema: Bolag; let skriv: Bolag; let stangt: Bolag; let las: Bolag;
let tillagg: Bolag; let idempotens: Bolag; let frys: Bolag;
let grannen: TestUser; let grannbolag: string;

async function nyttBolag(namn: string): Promise<Bolag> {
  const user = await registerUser('scopeavgorande');
  const id = await createCompany(user.token, namn);
  const b: Bolag = { id, user, agent: {}, ua: supertest.agent(app) };
  await createFiscalYear(id, auth(b), { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });
  const tok = await api.post(`${co(b)}/agent-tokens`).set(auth(b)).send({ name: 'Hermes' });
  expect(tok.status, JSON.stringify(tok.body)).toBe(201);
  b.agent = { Authorization: `Bearer ${tok.body.token}` };
  const login = await b.ua.post('/app/login').type('form').send({ email: user.email, password: PASSWORD });
  expect([302, 303]).toContain(login.status);
  return b;
}
async function act(b: Bolag, namn: string, input: object, headers: Record<string, string> = auth(b)) {
  return api.post(`${co(b)}/actions/${namn}`).set(headers).send(input);
}
async function ok(b: Bolag, namn: string, input: object): Promise<any> {
  const res = await act(b, namn, input);
  expect(res.status, `${namn}: ${JSON.stringify(res.body)}`).toBe(200);
  return res.body.result;
}
async function godkann(b: Bolag, approvalId: string) {
  const res = await api.post(`${co(b)}/approvals/${approvalId}/approve`).set(auth(b)).send({});
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res;
}
async function koaOchGodkann(b: Bolag, namn: string, input: object) {
  const res = await act(b, namn, input);
  expect(res.status, `${namn}: ${JSON.stringify(res.body)}`).toBe(202);
  return godkann(b, res.body.approval.id as string);
}
/** Ett uppdrag med avtal, och i tilläggsgrupperna också första versionen 2A. */
async function nyttUppdrag(b: Bolag, namn: string, medVersion = false): Promise<Uppdrag> {
  const projectId = (await ok(b, 'create_project', { name: `Uppdrag ${namn}` })).id as string;
  const contractId = (await ok(b, 'create_contract', {
    project_id: projectId, name: namn, signed_date: '2026-01-01',
  })).id as string;
  if (medVersion) {
    await koaOchGodkann(b, 'upsert_contract_part', { change_reason: 'avtal',
      contract_id: contractId, code: '2A', name: 'Fas 2A', cap_hours: 32,
      cap_confirmed: true, valid_from: '2026-01-01' });
  }
  return { projectId, contractId };
}
async function tand(b: Bolag, contractId: string, fras: string, underlag?: typeof MEJL, klausul?: string): Promise<string> {
  return (await ok(b, 'tand_scopesignal', {
    contract_id: contractId, fras, ...(klausul ? { klausul } : {}), ...(underlag ? { underlag } : {}),
  })).id as string;
}
async function rader(signalId: string): Promise<Avgorandrad[]> {
  return withAdmin(async (c) => (await c.query<Avgorandrad>(
    `SELECT *, avgjort_nar::text, created_at::text FROM uppdrag_scopeavgorande
      WHERE signal_id = $1 ORDER BY lopnummer`, [signalId],
  )).rows);
}
async function kolumn(signalId: string): Promise<string | null> {
  return withAdmin(async (c) => (await c.query<{ avgjord: string | null }>(
    'SELECT avgjord FROM uppdrag_scopesignal WHERE id = $1', [signalId],
  )).rows[0]!.avgjord);
}
async function koposter(signalId: string): Promise<Kopost[]> {
  return withAdmin(async (c) => (await c.query<Kopost>(
    `SELECT id, status, input, requested_actor FROM action_approvals
      WHERE action = 'andra_baseline' AND lower(input->>'signal_id') = $1 ORDER BY created_at, id`,
    [signalId.toLowerCase()],
  )).rows);
}
async function audit(b: Bolag, action: string): Promise<Auditrad[]> {
  return withAdmin(async (c) => (await c.query<Auditrad>(
    'SELECT entity_type, entity_id, details FROM audit_log WHERE company_id = $1 AND action = $2 ORDER BY occurred_at, id',
    [b.id, action],
  )).rows);
}
async function auditantal(b: Bolag): Promise<number> {
  return withAdmin(async (c) => (await c.query<{ n: number }>(
    'SELECT count(*)::int AS n FROM audit_log WHERE company_id = $1', [b.id],
  )).rows[0]!.n);
}
async function koantal(b: Bolag): Promise<number> {
  return withAdmin(async (c) => (await c.query<{ n: number }>(
    'SELECT count(*)::int AS n FROM action_approvals WHERE company_id = $1', [b.id],
  )).rows[0]!.n);
}
async function lage(b: Bolag, projectId: string): Promise<any> {
  return ok(b, 'las_uppdragslage', { project_id: projectId });
}
async function undantag(b: Bolag): Promise<any> {
  return ok(b, 'las_undantag', {});
}
async function sida(b: Bolag, path: string): Promise<string> {
  const res = await b.ua.get(path);
  expect(res.status, `${path} gav ${res.status}`).toBe(200);
  return res.text;
}
async function delar(contractId: string) {
  return withAdmin(async (c) => (await c.query<{ id: string; code: string; change_reason: string | null; valid_from: string }>(
    `SELECT id, code, change_reason, valid_from::text FROM contract_parts
      WHERE contract_id = $1 ORDER BY valid_from, code, id`, [contractId],
  )).rows);
}
async function beslutFor(approvalId: string) {
  return withAdmin(async (c) => (await c.query(
    'SELECT * FROM uppdrag_beslut WHERE approval_id = $1', [approvalId],
  )).rows);
}
/** Signalens rad i Läget, var den än står. */
function iLaget(l: any, signalId: string): { oppen: any; historik: any } {
  const avtal = l.avtal as Array<{ oppna_signaler: any[]; signalhistorik: any[] }>;
  return {
    oppen: avtal.flatMap((a) => a.oppna_signaler).find((s) => s.id === signalId),
    historik: avtal.flatMap((a) => a.signalhistorik).find((s) => s.id === signalId),
  };
}
const harPost = (u: any, signalId: string) =>
  (u.poster as Array<{ id: string; slag: string }>).some((p) => p.id === signalId && p.slag === 'scopeavgorande');

beforeAll(async () => {
  schema = await nyttBolag('Schema AB');
  skriv = await nyttBolag('Skriv AB');
  stangt = await nyttBolag('Stangt AB');
  las = await nyttBolag('Las AB');
  tillagg = await nyttBolag('Tillagg AB');
  idempotens = await nyttBolag('Idempotens AB');
  frys = await nyttBolag('Frys AB');
  grannen = await registerUser('scopeavgorande-granne');
  grannbolag = await createCompany(grannen.token, 'Grannbolaget AB');
});

// ---------------------------------------------------------------------------
// K1 — tabellens form (AC 1 och 8)
// ---------------------------------------------------------------------------

describe('K1 tabellens form', () => {
  let a: Uppdrag; let avtalB: string; let sA: string; let sB: string; let refA: string;
  let grannSignal: string;
  const ny = async (namn: string) => withTenantTransaction(schema.user.userId, schema.id, (c) =>
    createApproval(c, schema.id, schema.user.userId, 'human', 'andra_baseline', { namn }));

  beforeAll(async () => {
    a = await nyttUppdrag(schema, 'Schema A');
    avtalB = (await ok(schema, 'create_contract', {
      project_id: a.projectId, name: 'Schema B', signed_date: '2026-01-01',
    })).id as string;
    sA = await tand(schema, a.contractId, 'kan ni även', MEJL);
    sB = await tand(schema, avtalB, 'bara en snabb');
    refA = (await withAdmin((c) => c.query<{ underlag_ref_id: string }>(
      'SELECT underlag_ref_id FROM uppdrag_scopesignal WHERE id = $1', [sA],
    ))).rows[0]!.underlag_ref_id;
    expect(refA).toBeTruthy();
    const grann = { Authorization: `Bearer ${grannen.token}` };
    const gp = await api.post(`/api/companies/${grannbolag}/actions/create_project`).set(grann).send({ name: 'Grannens uppdrag' });
    expect(gp.status, JSON.stringify(gp.body)).toBe(200);
    const gc = await api.post(`/api/companies/${grannbolag}/actions/create_contract`).set(grann)
      .send({ project_id: gp.body.result.id, name: 'Grannens avtal', signed_date: '2026-01-01' });
    expect(gc.status, JSON.stringify(gc.body)).toBe(200);
    const gs = await api.post(`/api/companies/${grannbolag}/actions/tand_scopesignal`).set(grann)
      .send({ contract_id: gc.body.result.id, fras: 'kan ni även' });
    expect(gs.status, JSON.stringify(gs.body)).toBe(200);
    grannSignal = gs.body.result.id as string;
  });

  it('a kolumnerna och deras NOT NULL, utan baselinekolumner', async () => {
    const kolumner = await withAdmin(async (c) => (await c.query<{ column_name: string; is_nullable: string }>(
      `SELECT column_name, is_nullable FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'uppdrag_scopeavgorande'`,
    )).rows);
    expect(kolumner.map((k) => k.column_name).sort()).toEqual([
      'id', 'company_id', 'contract_id', 'signal_id', 'lopnummer', 'avgorande', 'avgjort_av',
      'avgjort_nar', 'underlag_ref_id', 'tillagg_approval_id', 'overford', 'created_at',
    ].sort());
    expect(kolumner.filter((k) => k.is_nullable === 'YES').map((k) => k.column_name).sort())
      .toEqual(['avgjort_av', 'avgjort_nar', 'tillagg_approval_id', 'underlag_ref_id']);
    for (const k of kolumner) expect(BASELINEKOLUMNER as readonly string[]).not.toContain(k.column_name);
  });

  it('b kategorin står först i tabellkommentaren', async () => {
    const r = await withAdmin(async (c) => (await c.query<{ k: string }>(
      "SELECT obj_description('uppdrag_scopeavgorande'::regclass, 'pg_class') AS k",
    )).rows[0]!.k);
    expect(r).toMatch(/^Kategori: BASELINE[,.;]/);
  });

  it('c RLS, policyer och rättigheter: SELECT och INSERT, ingenting annat', async () => {
    const rls = await withAdmin(async (c) => (await c.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      "SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = 'uppdrag_scopeavgorande'::regclass",
    )).rows[0]!);
    expect(rls).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
    const policyer = await withAdmin(async (c) => (await c.query<{ cmd: string; uttryck: string }>(
      `SELECT cmd, coalesce(qual, '') || coalesce(with_check, '') AS uttryck
         FROM pg_policies WHERE tablename = 'uppdrag_scopeavgorande'`,
    )).rows);
    expect(policyer.map((p) => p.cmd).sort()).toEqual(['INSERT', 'SELECT']);
    for (const p of policyer) expect(p.uttryck).toContain('app_has_company_access');
    for (const [ratt, vantat] of [['SELECT', true], ['INSERT', true], ['UPDATE', false], ['DELETE', false]] as const) {
      const har = await withAdmin(async (c) => (await c.query<{ har: boolean }>(
        "SELECT has_table_privilege('app', 'uppdrag_scopeavgorande', $1) AS har", [ratt],
      )).rows[0]!.har);
      expect(har, ratt).toBe(vantat);
    }
  });

  it('d append-only i praktiken: INSERT går, UPDATE och DELETE fälls som app', async () => {
    const id = await withTenantTransaction(schema.user.userId, schema.id, async (c) => (await c.query<{ id: string }>(
      `INSERT INTO uppdrag_scopeavgorande
         (company_id, contract_id, signal_id, lopnummer, avgorande, avgjort_av, avgjort_nar, underlag_ref_id)
       VALUES ($1, $2, $3, 1, 'innanfor', $4, now(), $5) RETURNING id`,
      [schema.id, a.contractId, sA, schema.user.userId, refA],
    )).rows[0]!.id);
    const fore = await rader(sA);
    for (const sats of ["UPDATE uppdrag_scopeavgorande SET avgorande = 'utanfor' WHERE id = $1",
      'DELETE FROM uppdrag_scopeavgorande WHERE id = $1']) {
      const e = await fel(withTenantTransaction(schema.user.userId, schema.id, (c) => c.query(sats, [id])));
      expect(String(e)).toMatch(/permission denied/);
    }
    expect(await rader(sA)).toEqual(fore);
  });

  it('e de sammansatta nycklarna binder signal, avtal, referens och köpost till bolaget', async () => {
    const insert = (varden: unknown[]) => withAdmin((c) => c.query(
      `INSERT INTO uppdrag_scopeavgorande
         (company_id, contract_id, signal_id, lopnummer, avgorande, avgjort_av, avgjort_nar, overford,
          underlag_ref_id, tillagg_approval_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`, varden));
    const vem = [schema.user.userId, new Date().toISOString(), false];
    expect(String(await fel(insert([schema.id, avtalB, sA, 40, 'innanfor', ...vem, null, null]))))
      .toMatch(/uppdrag_scopeavgorande_signal_fk/);
    expect(String(await fel(insert([schema.id, a.contractId, grannSignal, 41, 'innanfor', ...vem, null, null]))))
      .toMatch(/uppdrag_scopeavgorande_signal_fk/);
    expect(String(await fel(insert([schema.id, a.contractId, sA, 42, 'innanfor', ...vem, NOLL, null]))))
      .toMatch(/uppdrag_scopeavgorande_underlag_fk/);
    expect(String(await fel(insert([schema.id, a.contractId, sA, 43, 'utanfor', ...vem, null, NOLL]))))
      .toMatch(/uppdrag_scopeavgorande_tillagg_fk/);
    const def = await withAdmin(async (c) => (await c.query<{ d: string }>(
      "SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conname = 'uppdrag_scopeavgorande_contract_fk'",
    )).rows[0]!.d);
    expect(def).toContain('REFERENCES contracts(id, company_id)');
  });

  it('f CHECK, ett fall per regel', async () => {
    const q = await ny('check');
    const insert = (lopnummer: number, avgorande: string, vem: string | null, nar: boolean, overford: boolean, approval: string | null) =>
      withAdmin((c) => c.query(
        `INSERT INTO uppdrag_scopeavgorande
           (company_id, contract_id, signal_id, lopnummer, avgorande, avgjort_av, avgjort_nar, overford, tillagg_approval_id)
         VALUES ($1, $2, $3, $4, $5, $6, CASE WHEN $7::boolean THEN now() END, $8, $9)`,
        [schema.id, a.contractId, sA, lopnummer, avgorande, vem, nar, overford, approval]));
    const u = schema.user.userId;
    // Varje försök startas först när det prövas, i en egen anslutning.
    const fall: [() => Promise<unknown>, RegExp][] = [
      [() => insert(50, 'kanske', u, true, false, null), /uppdrag_scopeavgorande_avgorande/],
      [() => insert(0, 'innanfor', u, true, false, null), /uppdrag_scopeavgorande_lopnummer"/],
      [() => insert(51, 'innanfor', null, true, false, null), /uppdrag_scopeavgorande_vem_och_nar/],
      [() => insert(52, 'innanfor', u, false, true, null), /uppdrag_scopeavgorande_vem_och_nar/],
      [() => insert(53, 'innanfor', u, true, false, q.id), /uppdrag_scopeavgorande_tillagg_vid_utanfor/],
    ];
    for (const [forsok, monster] of fall) {
      expect(String(await fel(forsok()))).toMatch(monster);
      korda.k1f++;
    }
  });

  it('g de unika nycklarna', async () => {
    const e1 = await fel(withAdmin((c) => c.query(
      `INSERT INTO uppdrag_scopeavgorande (company_id, contract_id, signal_id, lopnummer, avgorande, overford)
       VALUES ($1, $2, $3, 1, 'utanfor', true)`, [schema.id, a.contractId, sA])));
    expect(String(e1)).toMatch(/uppdrag_scopeavgorande_lopnummer_uk/); korda.k1g++;
    const q = await ny('unik');
    const insert = (lopnummer: number) => withAdmin((c) => c.query(
      `INSERT INTO uppdrag_scopeavgorande
         (company_id, contract_id, signal_id, lopnummer, avgorande, avgjort_av, avgjort_nar, tillagg_approval_id)
       VALUES ($1, $2, $3, $4, 'utanfor', $5, now(), $6)`, [schema.id, avtalB, sB, lopnummer, schema.user.userId, q.id]));
    await insert(20);
    expect(String(await fel(insert(21)))).toMatch(/uppdrag_scopeavgorande_tillagg_uk/); korda.k1g++;
  });

  it('h avslutat uppdrag: INSERT fälls, den tidigare raden går att läsa', async () => {
    // Öppet uppdrag: INSERT går igenom.
    await withTenantTransaction(schema.user.userId, schema.id, (c) => c.query(
      `INSERT INTO uppdrag_scopeavgorande
         (company_id, contract_id, signal_id, lopnummer, avgorande, avgjort_av, avgjort_nar)
       VALUES ($1, $2, $3, 1, 'innanfor', $4, now())`, [schema.id, avtalB, sB, schema.user.userId]));
    const v = await nyttUppdrag(schema, 'Schema stangt');
    const sV = await tand(schema, v.contractId, 'en liten sak till');
    const somApp = (lopnummer: number) => withTenantTransaction(schema.user.userId, schema.id, (c) => c.query(
      `INSERT INTO uppdrag_scopeavgorande
         (company_id, contract_id, signal_id, lopnummer, avgorande, avgjort_av, avgjort_nar)
       VALUES ($1, $2, $3, $4, 'innanfor', $5, now())`, [schema.id, v.contractId, sV, lopnummer, schema.user.userId]));
    // `avgorSignal` är inte vägen här: raden skrivs direkt som app.
    await somApp(1);
    await ok(schema, 'set_project_status', { project_id: v.projectId, status: 'closed' });
    expect(String(await fel(somApp(2)))).toMatch(/uppdraget är avslutat/);
    const lasbara = await withTenantTransaction(schema.user.userId, schema.id, async (c) =>
      (await c.query('SELECT id FROM uppdrag_scopeavgorande WHERE signal_id = $1', [sV])).rowCount);
    expect(lasbara).toBe(1);
  });

  it('i grannbolaget ser inga rader och kan inte skriva i vårt bolag', async () => {
    const synliga = await withTenantTransaction(grannen.userId, grannbolag, async (c) =>
      (await c.query('SELECT id FROM uppdrag_scopeavgorande')).rowCount);
    expect(synliga).toBe(0);
    const e = await fel(withTenantTransaction(grannen.userId, grannbolag, (c) => c.query(
      `INSERT INTO uppdrag_scopeavgorande
         (company_id, contract_id, signal_id, lopnummer, avgorande, avgjort_av, avgjort_nar)
       VALUES ($1, $2, $3, 30, 'innanfor', $4, now())`, [schema.id, a.contractId, sA, grannen.userId])));
    expect(String(e)).toMatch(/row-level security/);
  });
});

// ---------------------------------------------------------------------------
// K3 — skrivvägen (AC 2, 3, 7 och 8)
// ---------------------------------------------------------------------------

describe('K3 skrivvägen', () => {
  let u: Uppdrag;
  let s: string; let s2: string;
  let forsta: Avgorandrad;
  const TILL = () => ({ contract_id: u.contractId, code: '2B', name: 'Fas 2B', valid_from: '2026-06-01', change_reason: 'Kunden bad om en extra workshop' });
  const avgorAuditFor = async (signalId: string) =>
    (await audit(skriv, 'uppdrag.scope_avgjort')).filter((r) => r.details.signal_id === signalId);

  beforeAll(async () => {
    u = await nyttUppdrag(skriv, 'Skriv');
  });

  it('a första avgörandet är en rad med vem, när och underlag, och en auditrad', async () => {
    s = await tand(skriv, u.contractId, 'kan ni även', MEJL);
    const svar = await ok(skriv, 'avgor_scopesignal', { signal_id: s, avgjord: 'innanfor' });
    expect(svar.avgjord).toBe('innanfor');
    const ref = (await withAdmin((c) => c.query<{ underlag_ref_id: string }>(
      'SELECT underlag_ref_id FROM uppdrag_scopesignal WHERE id = $1', [s]))).rows[0]!.underlag_ref_id;
    expect(ref).toBeTruthy();
    expect(svar.avgorande).toMatchObject({
      signal_id: s, lopnummer: 1, avgorande: 'innanfor', avgjort_av: skriv.user.userId,
      avgjort_av_namn: 'scopeavgorande', underlag_ref_id: ref, tillagg_approval_id: null, overford: false,
    });
    expect(svar.avgorande.avgjort_nar).toEqual(expect.any(String));
    const r = await rader(s);
    expect(r).toHaveLength(1);
    forsta = r[0]!;
    expect(forsta).toMatchObject({ id: svar.avgorande.id, lopnummer: 1, avgorande: 'innanfor',
      avgjort_av: skriv.user.userId, underlag_ref_id: ref, tillagg_approval_id: null, overford: false,
      contract_id: u.contractId, company_id: skriv.id });
    expect(forsta.avgjort_nar).toBe(svar.avgorande.avgjort_nar);
    const a = await avgorAuditFor(s);
    expect(a).toEqual([{ entity_type: 'uppdrag_scopeavgorande', entity_id: forsta.id,
      details: { signal_id: s, avgorande: 'innanfor', lopnummer: 1, tillagg_approval_id: null, tillagg_redan_koad: null } }]);
    expect((await audit(skriv, 'action.executed')).map((x) => x.entity_id)).toContain('avgor_scopesignal');
  });

  it('b rättelsen är en ny rad, och den första står oförändrad', async () => {
    const svar = await ok(skriv, 'avgor_scopesignal', { signal_id: s, avgjord: 'utanfor' });
    expect(svar.avgjord).toBe('utanfor');
    const r = await rader(s);
    expect(r.map((x) => x.lopnummer)).toEqual([1, 2]);
    expect(r[0]).toEqual(forsta);
    expect(r[1]!.avgorande).toBe('utanfor');
    const a = await avgorAuditFor(s);
    expect(a).toHaveLength(2);
    expect(a[1]!.details.lopnummer).toBe(2);
  });

  it('c samma val på samma underlag ger 409 redan_avgjord och ingen ny rad', async () => {
    const fore = (await avgorAuditFor(s)).length;
    const res = await act(skriv, 'avgor_scopesignal', { signal_id: s, avgjord: 'utanfor' });
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(res.body.error).toBe('redan_avgjord');
    expect(await rader(s)).toHaveLength(2);
    expect(await avgorAuditFor(s)).toHaveLength(fore);
    expect(await koposter(s)).toEqual([]);
  });

  it('d upprepningen med tillägg ger 409 och ingen köpost', async () => {
    const res = await act(skriv, 'avgor_scopesignal', { signal_id: s, avgjord: 'utanfor', tillagg: TILL() });
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(res.body.error).toBe('redan_avgjord');
    expect(await rader(s)).toHaveLength(2);
    expect(await koposter(s)).toEqual([]);
  });

  it('e agenten avgör inte: 403 human_required, ingen rad, ingen auditrad, ingen köpost', async () => {
    s2 = await tand(skriv, u.contractId, 'bara en snabb');
    const fore = await auditantal(skriv);
    const res = await act(skriv, 'avgor_scopesignal', { signal_id: s2, avgjord: 'innanfor' }, skriv.agent);
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(res.body.error).toBe('human_required');
    expect(await rader(s2)).toEqual([]);
    expect(await auditantal(skriv)).toBe(fore);
    expect(await koposter(s2)).toEqual([]);
    korda.k3eg++;
  });

  it('f grannbolaget får 404 och skriver ingenting', async () => {
    const res = await api.post(`/api/companies/${grannbolag}/actions/avgor_scopesignal`)
      .set({ Authorization: `Bearer ${grannen.token}` }).send({ signal_id: s2, avgjord: 'innanfor' });
    expect(res.status, JSON.stringify(res.body)).toBe(404);
    expect(res.body.error).toBe('not_found');
    expect(await rader(s2)).toEqual([]);
    korda.k3eg++;
  });

  it('g en okänd signal ger 404', async () => {
    const res = await act(skriv, 'avgor_scopesignal', { signal_id: NOLL, avgjord: 'innanfor' });
    expect(res.status, JSON.stringify(res.body)).toBe(404);
    expect(res.body.error).toBe('not_found');
    expect(await rader(NOLL)).toEqual([]);
    korda.k3eg++;
  });

  it('h avslutat uppdrag: 409 rule_violation, ingen signal, ingen rad och ingen köpost', async () => {
    const v = await nyttUppdrag(stangt, 'Stangt V');
    const t1 = await tand(stangt, v.contractId, 'kan ni även');
    const t2 = await tand(stangt, v.contractId, 'bara en snabb');
    await ok(stangt, 'set_project_status', { project_id: v.projectId, status: 'closed' });
    const antal = async () => withAdmin(async (c) => (await c.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM uppdrag_scopesignal WHERE contract_id = $1', [v.contractId])).rows[0]!.n);
    const fore = await antal();
    const tandres = await act(stangt, 'tand_scopesignal', { contract_id: v.contractId, fras: 'en liten sak till' });
    expect(tandres.status, JSON.stringify(tandres.body)).toBe(409);
    expect(tandres.body.error).toBe('rule_violation');
    expect(await antal()).toBe(fore);
    const r1 = await act(stangt, 'avgor_scopesignal', { signal_id: t1, avgjord: 'innanfor' });
    expect(r1.status, JSON.stringify(r1.body)).toBe(409);
    expect(r1.body.error).toBe('rule_violation');
    expect(await rader(t1)).toEqual([]);
    const r2 = await act(stangt, 'avgor_scopesignal', { signal_id: t2, avgjord: 'utanfor', tillagg: {
      contract_id: v.contractId, code: '2B', name: 'Fas 2B', valid_from: '2026-06-01', change_reason: 'Kunden bad om mer' } });
    expect(r2.status, JSON.stringify(r2.body)).toBe(409);
    expect(r2.body.error).toBe('rule_violation');
    expect(await rader(t2)).toEqual([]);
    // Köposten och raden skrivs i samma transaktion: ingen köpost blev kvar.
    expect(await koposter(t2)).toEqual([]);
  });

  it('i samtidiga avgöranden turas om under radlåset', async () => {
    const s3 = await tand(skriv, u.contractId, 'det borde väl gå att');
    const par = await Promise.all([
      act(skriv, 'avgor_scopesignal', { signal_id: s3, avgjord: 'innanfor' }),
      act(skriv, 'avgor_scopesignal', { signal_id: s3, avgjord: 'utanfor' }),
    ]);
    expect(par.map((r) => r.status), JSON.stringify(par.map((r) => r.body))).toEqual([200, 200]);
    const r3 = await rader(s3);
    expect(r3.map((x) => x.lopnummer)).toEqual([1, 2]);
    expect(r3.map((x) => x.avgorande).sort()).toEqual(['innanfor', 'utanfor']);

    const s4 = await tand(skriv, u.contractId, 'vi antog att det ingick');
    const lika = await Promise.all([
      act(skriv, 'avgor_scopesignal', { signal_id: s4, avgjord: 'innanfor' }),
      act(skriv, 'avgor_scopesignal', { signal_id: s4, avgjord: 'innanfor' }),
    ]);
    expect(lika.map((r) => r.status).sort(), JSON.stringify(lika.map((r) => r.body))).toEqual([200, 409]);
    expect(await rader(s4)).toHaveLength(1);
  });

  it('j utanför med tillägg: köposten på raden och i auditraden, och upprepningen ger 409', async () => {
    const s5 = await tand(skriv, u.contractId, 'medan ni ändå är inne i systemet');
    const svar = await ok(skriv, 'avgor_scopesignal', { signal_id: s5, avgjord: 'utanfor', tillagg: TILL() });
    const k = await koposter(s5);
    expect(k).toHaveLength(1);
    expect(k[0]!.status).toBe('pending');
    const r = await rader(s5);
    expect(r).toHaveLength(1);
    expect(r[0]!.tillagg_approval_id).toBe(k[0]!.id);
    expect(svar.avgorande.tillagg_approval_id).toBe(k[0]!.id);
    expect((await avgorAuditFor(s5))[0]!.details.tillagg_approval_id).toBe(k[0]!.id);
    const igen = await act(skriv, 'avgor_scopesignal', { signal_id: s5, avgjord: 'utanfor', tillagg: TILL() });
    expect(igen.status, JSON.stringify(igen.body)).toBe(409);
    expect(igen.body.error).toBe('redan_avgjord');
    expect(await rader(s5)).toHaveLength(1);
    expect(await koposter(s5)).toHaveLength(1);
  });

  it('k signalsidan: samma POST en gång till landar i ?fel= och ger ingen ny rad', async () => {
    const s6 = await tand(skriv, u.contractId, 'kan ni titta på det här också');
    const vag = `/app/c/${skriv.id}/projects/${u.projectId}/signaler`;
    const forst = await skriv.ua.post(vag).type('form').send({ handling: 'avgor', signal_id: s6, avgjord: 'innanfor' });
    expect(forst.status).toBe(302);
    expect(forst.headers.location).toBe(vag);
    const igen = await skriv.ua.post(vag).type('form').send({ handling: 'avgor', signal_id: s6, avgjord: 'innanfor' });
    expect(igen.status).toBe(302);
    expect(igen.headers.location).toMatch(/\/signaler\?fel=/);
    expect(await rader(s6)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// K4 — läsvägarna (AC 2, 4 och 8)
// ---------------------------------------------------------------------------

describe('K4 läsvägarna', () => {
  let l: Uppdrag; let s: string;
  const c: Record<'tand' | 'innanfor' | 'utanfor' | 'rattad' | 'overford', string> =
    { tand: '', innanfor: '', utanfor: '', rattad: '', overford: '' };

  beforeAll(async () => {
    l = await nyttUppdrag(las, 'Las L');
  });

  it('a posten och b läget före avgörandet', async () => {
    s = await tand(las, l.contractId, 'kan ni även', MEJL, '5.4');
    const u = await undantag(las);
    const post = (u.poster as any[]).find((p) => p.id === s);
    expect(post).toBeDefined();
    expect(post).toMatchObject({ slag: 'scopeavgorande', identitet: 'signal', val: { kod: 'innanfor_utanfor' } });
    expect(post.skal.varde).toContain('”kan ni även”');
    expect(post.skal.varde).toContain('5.4');
    expect(post.kallor.varde).toContainEqual(expect.objectContaining({ typ: 'referens', extern_id: MEJL.extern_id }));
    const { oppen, historik } = iLaget(await lage(las, l.projectId), s);
    expect(oppen).toMatchObject({ id: s, avgjord: null, avgoranden: [] });
    expect(historik).toBeUndefined();
  });

  it('a posten försvinner och b historiken bär båda avgörandena', async () => {
    await ok(las, 'avgor_scopesignal', { signal_id: s, avgjord: 'innanfor' });
    expect(harPost(await undantag(las), s)).toBe(false);
    await ok(las, 'avgor_scopesignal', { signal_id: s, avgjord: 'utanfor' });
    expect(harPost(await undantag(las), s)).toBe(false);
    const l1 = await lage(las, l.projectId);
    const { oppen, historik } = iLaget(l1, s);
    expect(oppen).toBeUndefined();
    expect(historik.avgjord).toBe('utanfor');
    expect(historik.avgoranden.map((a: any) => [a.lopnummer, a.avgorande])).toEqual([[1, 'innanfor'], [2, 'utanfor']]);
    for (const a of historik.avgoranden) {
      expect(a.avgjort_av_namn).toBe('scopeavgorande');
      expect(a.avgjort_nar).toEqual(expect.any(String));
    }
    for (const a of l1.avtal) expect(a.avgjorda_signaler).toBe(a.signalhistorik.length);
  });

  it('c samma svar i båda läsvägarna, fem tillstånd', async () => {
    c.tand = await tand(las, l.contractId, 'fras tänd');
    c.innanfor = await tand(las, l.contractId, 'fras innanför');
    c.utanfor = await tand(las, l.contractId, 'fras utanför');
    c.rattad = await tand(las, l.contractId, 'fras rättad');
    c.overford = await tand(las, l.contractId, 'fras överförd');
    await ok(las, 'avgor_scopesignal', { signal_id: c.innanfor, avgjord: 'innanfor' });
    await ok(las, 'avgor_scopesignal', { signal_id: c.utanfor, avgjord: 'utanfor' });
    await ok(las, 'avgor_scopesignal', { signal_id: c.rattad, avgjord: 'innanfor' });
    await ok(las, 'avgor_scopesignal', { signal_id: c.rattad, avgjord: 'utanfor' });
    await withAdmin((db) => db.query(
      `INSERT INTO uppdrag_scopeavgorande (company_id, contract_id, signal_id, lopnummer, avgorande, overford)
       VALUES ($1, $2, $3, 1, 'innanfor', true)`, [las.id, l.contractId, c.overford]));
    const u = await undantag(las);
    const lg = await lage(las, l.projectId);
    for (const [tillstand, id] of Object.entries(c)) {
      const iOppna = iLaget(lg, id).oppen !== undefined;
      expect(harPost(u, id), tillstand).toBe(iOppna);
      expect(iOppna, tillstand).toBe(tillstand === 'tand');
      korda.k4c++;
    }
  });

  it('f tabellen, inte kolumnen: en överförd rad stänger frågan', async () => {
    expect(await kolumn(c.overford)).toBeNull();
    expect(harPost(await undantag(las), c.overford)).toBe(false);
    const { oppen, historik } = iLaget(await lage(las, l.projectId), c.overford);
    expect(oppen).toBeUndefined();
    expect(historik.avgoranden[0]).toMatchObject({ overford: true, avgjort_av: null });
  });

  it('d Lägets sida visar den tända signalen och släpper den efter avgörandet', async () => {
    const l2 = await nyttUppdrag(las, 'Las L2');
    const sl = await tand(las, l2.contractId, 'läget-fras');
    const vag = `/app/c/${las.id}/projects/${l2.projectId}/laget`;
    expect(await sida(las, vag)).toContain('Scopesignal: ”läget-fras”');
    await ok(las, 'avgor_scopesignal', { signal_id: sl, avgjord: 'innanfor' });
    const efter = await sida(las, vag);
    expect(efter).not.toContain('Scopesignal: ”läget-fras”');
    const kort = efter.split('id="kort-signaler"')[1]?.split('</section>')[0] ?? '';
    expect(kort).toContain('avgjorda står i historiken');
  });

  it('e signalsidan visar vem och när, och de tidigare avgörandena', async () => {
    const html = await sida(las, `/app/c/${las.id}/projects/${l.projectId}/signaler`);
    const raden = html.split('<tr').find((r) => r.includes('”kan ni även”'));
    expect(raden).toBeDefined();
    expect(raden).toContain('Utanför');
    expect(raden).toMatch(/Tidigare:\s*Innanför/);
    const celler = raden!.split('<td');
    const i = celler.findIndex((cell) => cell.includes('Tidigare:'));
    expect(i).toBeGreaterThan(0);
    const avOchNar = celler[i + 1] ?? '';
    const senaste = iLaget(await lage(las, l.projectId), s).historik.avgoranden.at(-1);
    expect(avOchNar).toContain('scopeavgorande');
    expect(avOchNar).toContain((senaste.avgjort_nar as string).slice(0, 16));
    expect(html).toContain('skriver aldrig över det förra');
    const overford = html.split('<tr').find((r) => r.includes('”fras överförd”'));
    expect(overford).toContain('Överfört ur den äldre kolumnen');
  });

  it('g läsbart efter avslutet: Läget och signalsidan', async () => {
    const w = await nyttUppdrag(stangt, 'Stangt W');
    const w1 = await tand(stangt, w.contractId, 'kan ni även');
    await ok(stangt, 'avgor_scopesignal', { signal_id: w1, avgjord: 'innanfor' });
    await ok(stangt, 'avgor_scopesignal', { signal_id: w1, avgjord: 'utanfor' });
    await ok(stangt, 'set_project_status', { project_id: w.projectId, status: 'closed' });
    const { historik } = iLaget(await lage(stangt, w.projectId), w1);
    expect(historik.avgoranden).toHaveLength(2);
    const html = await sida(stangt, `/app/c/${stangt.id}/projects/${w.projectId}/signaler`);
    expect(html).toContain('Utanför');
    expect(html).toMatch(/Tidigare:\s*Innanför/);
  });

  it('h ren beskrivning', h.provaRenBeskrivning);
});

// ---------------------------------------------------------------------------
// K5 — tillägget (AC 5, 6 och 9)
// ---------------------------------------------------------------------------

describe('K5 tillägget', () => {
  let p: Uppdrag;
  const TILLAGG = { code: '2B', name: 'Fas 2B: extra workshop', valid_from: '2026-06-01', change_reason: 'Kunden bad om en extra workshop', cap_hours: 8 };
  let s: string; let kopostA: string;

  beforeAll(async () => {
    p = await nyttUppdrag(tillagg, 'Tillagg P', true);
  });

  it('a köposten bär källan och orsaken ”Tillägg: …”', async () => {
    s = await tand(tillagg, p.contractId, 'kan ni även');
    const svar = await ok(tillagg, 'avgor_scopesignal', { signal_id: s, avgjord: 'utanfor', tillagg: { contract_id: p.contractId, ...TILLAGG } });
    const k = await koposter(s);
    expect(k).toHaveLength(1);
    kopostA = k[0]!.id;
    expect(k[0]).toMatchObject({ status: 'pending', requested_actor: 'human' });
    expect(k[0]!.input.kalla).toEqual({ typ: 'scopesignal', id: s });
    expect(k[0]!.input.signal_id).toBe(s);
    expect(k[0]!.input.change_reason).toBe('Tillägg: Kunden bad om en extra workshop');
    expect((await rader(s))[0]!.tillagg_approval_id).toBe(kopostA);
    expect(svar.tillagg_godkannande).toEqual({ id: kopostA, action: 'andra_baseline', status: 'pending', redan_koad: false });
    expect((await audit(tillagg, 'action.approval_requested')).map((a) => a.entity_id)).toContain(kopostA);
    expect((await delar(p.contractId)).map((d) => d.code)).toEqual(['2A']);
  });

  it('b ja ger den nya versionen, länken och beslutsraden', async () => {
    const fore = await delar(p.contractId);
    await godkann(tillagg, kopostA);
    const efter = await delar(p.contractId);
    expect(efter.filter((d) => d.code === '2A')).toEqual(fore);
    const ny = efter.find((d) => d.code === '2B')!;
    expect(ny.change_reason).toBe('Tillägg: Kunden bad om en extra workshop');
    const lank = (await withAdmin((c) => c.query<{ ledde_till_part_id: string }>(
      'SELECT ledde_till_part_id FROM uppdrag_scopesignal WHERE id = $1', [s]))).rows[0]!.ledde_till_part_id;
    expect(lank).toBe(ny.id);
    const b = await beslutFor(kopostA);
    expect(b).toHaveLength(1);
    expect(b[0]).toMatchObject({ utfall: 'ja', kalla_typ: 'scopesignal', kalla_id: s,
      handling: { typ: 'ny_version', contract_part: { code: '2B' } } });
    const l = await lage(tillagg, p.projectId);
    expect(iLaget(l, s).historik.avgoranden[0].tillagg_approval_id).toBe(kopostA);
    const rad = (l.beslut.registrerade as any[]).find((r) => r.approval_id === kopostA);
    expect(rad.handling.contract_part.code).toBe('2B');
  });

  it('c nej registreras, ingen version skrivs och avgörandet står kvar', async () => {
    const s2 = await tand(tillagg, p.contractId, 'bara en snabb');
    await ok(tillagg, 'avgor_scopesignal', { signal_id: s2, avgjord: 'utanfor', tillagg: { contract_id: p.contractId, ...TILLAGG, code: '2C' } });
    const fore = await rader(s2);
    const q = (await koposter(s2))[0]!.id;
    const nej = await api.post(`${co(tillagg)}/approvals/${q}/reject`).set(auth(tillagg)).send({ reason: 'Provets nej' });
    expect(nej.status, JSON.stringify(nej.body)).toBe(200);
    expect(await beslutFor(q)).toEqual([expect.objectContaining({ utfall: 'nej', skal: 'Provets nej' })]);
    expect((await delar(p.contractId)).map((d) => d.code)).not.toContain('2C');
    expect(await rader(s2)).toEqual(fore);
    expect(fore[0]).toMatchObject({ avgorande: 'utanfor', tillagg_approval_id: q });
  });

  it('d en köpost per källa, i varje status ur CHECK-villkoret, utan svep', async () => {
    const u = await nyttUppdrag(idempotens, 'Idempotens');
    const check = await withAdmin(async (c) => (await c.query<{ villkor: string }>(
      `SELECT pg_get_constraintdef(oid) AS villkor FROM pg_constraint
        WHERE conrelid = 'action_approvals'::regclass AND conname = 'action_approvals_status_check'`,
    )).rows);
    expect(check).toHaveLength(1);
    const statusar = [...check[0]!.villkor.matchAll(/'([^']+)'/g)].map((m) => m[1]!);
    expect([...statusar].sort()).toEqual(['approved', 'executed', 'failed', 'pending', 'rejected']);
    // En köpost per status, plus det äldre avslaget och versalerna.
    const fall = [
      { status: 'pending' }, { status: 'approved', hash: true }, { status: 'rejected', hash: true, skal: 'Provets nej' },
      { status: 'rejected' }, { status: 'executed' }, { status: 'failed', error: 'driftfel' },
      { status: 'pending', versaler: true },
    ] as const;
    statusfall = fall.filter((f) => !('versaler' in f)).length;
    expect(new Set(fall.map((f) => f.status))).toEqual(new Set(statusar));
    const tillaggsindata = { contract_id: u.contractId, code: '2B', name: 'Fas 2B', valid_from: '2026-06-01', change_reason: 'Kunden bad om mer' };
    for (const f of fall) {
      const sig = await tand(idempotens, u.contractId, `status ${f.status}${'versaler' in f ? ' versaler' : ''}${'hash' in f ? ' mottaget' : ''}`);
      const input = { contract_id: u.contractId, code: '2B', name: 'Fas 2B', valid_from: '2026-06-01',
        change_reason: 'Planterad', signal_id: 'versaler' in f ? sig.toUpperCase() : sig };
      const q = await withTenantTransaction(idempotens.user.userId, idempotens.id, (c) =>
        createApproval(c, idempotens.id, idempotens.user.userId, 'agent', 'andra_baseline', input));
      if (f.status !== 'pending') {
        await withAdmin((c) => c.query(
          `UPDATE action_approvals SET status = $2, decided_by = $3, decided_at = now(),
                  beslut_hash = $4, beslut_skal = $5, error = $6 WHERE id = $1`,
          [q.id, f.status, idempotens.user.userId, 'hash' in f ? beslutHash(input) : null,
            'skal' in f ? f.skal : null, 'error' in f ? f.error : null],
        ));
      }
      const svar = await ok(idempotens, 'avgor_scopesignal', { signal_id: sig, avgjord: 'utanfor', tillagg: tillaggsindata });
      expect((await koposter(sig)).map((k) => k.id)).toEqual([q.id]);
      expect(await rader(sig)).toEqual([expect.objectContaining({ avgorande: 'utanfor', tillagg_approval_id: null })]);
      expect(svar.tillagg_godkannande).toEqual({ id: q.id, action: 'andra_baseline', status: f.status, redan_koad: true });
      const a = (await audit(idempotens, 'uppdrag.scope_avgjort')).filter((x) => x.details.signal_id === sig);
      expect(a.map((x) => x.details.tillagg_redan_koad)).toEqual([q.id]);
      if ('versaler' in f) korda.k5versaler++; else korda.k5status++;
    }
    // Kontroll: en signal utan köpost får en ny köpost i samma grupp.
    const kontroll = await tand(idempotens, u.contractId, 'status kontroll');
    const svar = await ok(idempotens, 'avgor_scopesignal', { signal_id: kontroll, avgjord: 'utanfor', tillagg: tillaggsindata });
    const k = await koposter(kontroll);
    expect(k).toHaveLength(1);
    expect(svar.tillagg_godkannande).toEqual({ id: k[0]!.id, action: 'andra_baseline', status: 'pending', redan_koad: false });
  });

  it('e en köpost ur REST räknas också, och flera körningar köar en gång', async () => {
    const sr = await tand(tillagg, p.contractId, 'en liten sak till');
    const rest = await act(tillagg, 'andra_baseline', { contract_id: p.contractId, ...TILLAGG, code: '2D',
      change_reason: 'Tilläggsavtal ur API', signal_id: sr });
    expect(rest.status, JSON.stringify(rest.body)).toBe(202);
    const svar = await ok(tillagg, 'avgor_scopesignal', { signal_id: sr, avgjord: 'utanfor', tillagg: { contract_id: p.contractId, ...TILLAGG, code: '2D' } });
    expect(await koposter(sr)).toHaveLength(1);
    expect(svar.tillagg_godkannande).toMatchObject({ id: rest.body.approval.id, redan_koad: true });

    const sm = await tand(tillagg, p.contractId, 'medan ni ändå är inne i systemet');
    const forsta = await ok(tillagg, 'avgor_scopesignal', { signal_id: sm, avgjord: 'utanfor', tillagg: { contract_id: p.contractId, ...TILLAGG, code: '2I' } });
    expect(forsta.tillagg_godkannande.redan_koad).toBe(false);
    await ok(tillagg, 'avgor_scopesignal', { signal_id: sm, avgjord: 'innanfor' });
    const tredje = await ok(tillagg, 'avgor_scopesignal', { signal_id: sm, avgjord: 'utanfor', tillagg: { contract_id: p.contractId, ...TILLAGG, code: '2J' } });
    const k = await koposter(sm);
    expect(k.map((x) => x.id)).toEqual([forsta.tillagg_godkannande.id]);
    expect(tredje.tillagg_godkannande).toEqual({ id: forsta.tillagg_godkannande.id, action: 'andra_baseline', status: 'pending', redan_koad: true });
    const r = await rader(sm);
    expect(r.map((x) => x.lopnummer)).toEqual([1, 2, 3]);
    expect(r.map((x) => x.tillagg_approval_id)).toEqual([forsta.tillagg_godkannande.id, null, null]);
  });

  it('f schemat: kalla kräver samma signal_id, och orsakens gräns ryms i andra_baseline', async () => {
    const sf = await tand(tillagg, p.contractId, 'vi antog att det ingick');
    const grund = { contract_id: p.contractId, ...TILLAGG, code: '2G' };
    const godtagen = await act(tillagg, 'andra_baseline', { ...grund, signal_id: sf, kalla: { typ: 'scopesignal', id: sf } });
    expect(godtagen.status, JSON.stringify(godtagen.body)).toBe(202);
    const nej = await api.post(`${co(tillagg)}/approvals/${godtagen.body.approval.id}/reject`).set(auth(tillagg)).send({ reason: 'Provets nej' });
    expect(nej.status, JSON.stringify(nej.body)).toBe(200);
    const fore = await koantal(tillagg);
    for (const indata of [
      { ...grund, kalla: { typ: 'scopesignal', id: sf } },
      { ...grund, signal_id: sf, kalla: { typ: 'scopesignal', id: NOLL } },
      { ...grund, signal_id: sf, kalla: { typ: 'anteckning', id: sf } },
    ]) {
      const res = await act(tillagg, 'andra_baseline', indata);
      expect(res.status, JSON.stringify(res.body)).toBe(400);
      expect(res.body.error).toBe('validation_error');
    }
    expect(await koantal(tillagg)).toBe(fore);
    const schemat = actionManifest().find((a) => a.name === 'andra_baseline')!.input_schema;
    expect(Object.keys(schemat.properties as object)).toContain('kalla');

    const sl = await tand(tillagg, p.contractId, 'kan ni titta på det här också');
    const for_lang = await act(tillagg, 'avgor_scopesignal', { signal_id: sl, avgjord: 'utanfor',
      tillagg: { contract_id: p.contractId, ...TILLAGG, code: '2H', change_reason: 'x'.repeat(TILLAGGSORSAK_MAX + 1) } });
    expect(for_lang.status, JSON.stringify(for_lang.body)).toBe(400);
    expect(for_lang.body.error).toBe('validation_error');
    expect(await rader(sl)).toEqual([]);
    const lagom = await ok(tillagg, 'avgor_scopesignal', { signal_id: sl, avgjord: 'utanfor',
      tillagg: { contract_id: p.contractId, ...TILLAGG, code: '2H', change_reason: 'x'.repeat(TILLAGGSORSAK_MAX) } });
    expect(lagom.tillagg_godkannande.redan_koad).toBe(false);
    const k = await koposter(sl);
    expect(k).toHaveLength(1);
    expect((k[0]!.input.change_reason as string).length).toBe(2000);
    await godkann(tillagg, k[0]!.id);
    expect((await delar(p.contractId)).map((d) => d.code)).toContain('2H');
  });

  it('g agentens förslag avgör ingenting', async () => {
    const sg = await tand(tillagg, p.contractId, 'agentens fras');
    const res = await act(tillagg, 'andra_baseline', { contract_id: p.contractId, ...TILLAGG, code: '2E',
      signal_id: sg, kalla: { typ: 'scopesignal', id: sg } }, tillagg.agent);
    expect(res.status, JSON.stringify(res.body)).toBe(202);
    expect(res.body.status).toBe('pending_approval');
    expect(await rader(sg)).toEqual([]);
    const u = await undantag(tillagg);
    expect(harPost(u, sg)).toBe(true);
    expect((u.poster as any[]).some((x) => x.slag === 'baselineandring' && x.id === res.body.approval.id)).toBe(true);
  });

  it('h vyn: orsakens maxlength och köposten ur formuläret', async () => {
    const sv = await tand(tillagg, p.contractId, 'vyns fras');
    const vag = `/app/c/${tillagg.id}/projects/${p.projectId}/signaler`;
    expect(String(TILLAGGSORSAK_MAX)).toBe('1991');
    expect(await sida(tillagg, vag)).toContain('name="tillagg_change_reason" type="text" maxlength="1991"');
    const res = await tillagg.ua.post(vag).type('form').send({
      handling: 'avgor', signal_id: sv, avgjord: 'utanfor', tillagg_contract_id: p.contractId,
      tillagg_code: '2F', tillagg_name: 'Fas 2F', tillagg_valid_from: '2026-06-01',
      tillagg_cap_hours: '8,5', tillagg_change_reason: 'Kunden bad om mer',
    });
    expect(res.status).toBe(302);
    const k = await koposter(sv);
    expect(k).toHaveLength(1);
    expect(k[0]!.input.kalla).toEqual({ typ: 'scopesignal', id: sv });
    expect(k[0]!.input.change_reason).toBe('Tillägg: Kunden bad om mer');
    expect(k[0]!.input.cap_hours).toBe(8.5);
  });
});

// ---------------------------------------------------------------------------
// K6 — kolumnen fryses (AC 1 och 2)
// ---------------------------------------------------------------------------

describe('K6 kolumnen fryses', () => {
  let u: Uppdrag; let s: string;

  beforeAll(async () => {
    u = await nyttUppdrag(frys, 'Frys');
  });

  it('a avgörandet skriver aldrig kolumnen', async () => {
    s = await tand(frys, u.contractId, 'kan ni även');
    await ok(frys, 'avgor_scopesignal', { signal_id: s, avgjord: 'innanfor' });
    expect(await kolumn(s)).toBeNull();
    await ok(frys, 'avgor_scopesignal', { signal_id: s, avgjord: 'utanfor' });
    expect(await kolumn(s)).toBeNull();
    expect(await rader(s)).toHaveLength(2);
  });

  it('b databasen fäller varje skrivning av kolumnen, för varje roll', async () => {
    const somApp = (sql: string, varden: unknown[]) =>
      withTenantTransaction(frys.user.userId, frys.id, (c) => c.query(sql, varden));
    const somAgare = (sql: string, varden: unknown[]) => withAdmin((c) => c.query(sql, varden));
    const uppdatera = "UPDATE uppdrag_scopesignal SET avgjord = 'innanfor' WHERE id = $1";
    expect(String(await fel(somApp(uppdatera, [s])))).toMatch(/skrivs inte sedan 0081/); korda.k6b++;
    expect(String(await fel(somAgare(uppdatera, [s])))).toMatch(/skrivs inte sedan 0081/); korda.k6b++;
    expect(String(await fel(somAgare(
      "INSERT INTO uppdrag_scopesignal (company_id, contract_id, fras, avgjord) VALUES ($1, $2, 'frysfras', 'utanfor')",
      [frys.id, u.contractId],
    )))).toMatch(/skrivs inte sedan 0081/); korda.k6b++;
    // Positiv kontroll: triggern fäller bara kolumnen.
    await expect(somApp('UPDATE uppdrag_scopesignal SET ledde_till_part_id = ledde_till_part_id WHERE id = $1', [s]))
      .resolves.toBeTruthy();
    korda.k6b++;
    expect(await kolumn(s)).toBeNull();
  });
});

it('kontrollvakt: de negativa fallen och samtliga planterade statusar kördes', () => {
  expect(korda.k1f).toBe(5);
  expect(korda.k1g).toBe(2);
  expect(korda.k3eg).toBe(3);
  expect(korda.k4c).toBe(5);
  expect(statusfall).toBe(6);
  expect(korda.k5status).toBe(statusfall);
  expect(korda.k5versaler).toBe(1);
  expect(korda.k6b).toBe(4);
});
