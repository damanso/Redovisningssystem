// Story 1.10 (B-3, FR-40, FR-15, FR-16, FR-14): en ny bedömning som David
// begär når honom färdig att sätta.
//
// Provet täcker sju risker, i REST, MCP:s väg (agentnyckeln), vyn och SQL:
//   * att två begäranden för samma avtal blir två frågor (K3 b–c);
//   * att en begäran besvaras två gånger (K1 j, K4 b–c);
//   * att någon annan än en människa begär eller sätter en bedömning (K3 e,
//     K4 h–j);
//   * att posten föreslår ett läge (K0 i–l, K5 e);
//   * att underlaget räknas om i stället för att jämföras med de frysta talen
//     (K0 d–h, K5 d);
//   * att en regel skapar poster av sig själv (K5 g, och P8 i
//     `uppdragsytan-undantag.test.ts`);
//   * att ett avslutat uppdrag tar emot en begäran (K1 h, K3 g, K4 k, K5 h, K6 g).
// De rena reglerna ligger i `bedomningsbegaranHelper.ts` och går att köra utan
// databas. Migrationen som migration prövas i `uppdragsytan-migration-0082.test.ts`.
import supertest from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import * as h from './bedomningsbegaranHelper.js';
import { app, api, createCompany, createFiscalYear, registerUser, withAdmin, type TestUser } from './helpers.js';
import { withTenantTransaction } from '../src/db/tx.js';
import { ACTIONS, actionManifest } from '../src/actions/registry.js';
import { BASELINEKOLUMNER } from '../src/lib/baselinekolumner.js';
import { LEVERABELORD, kalendermanad, sammanfattaAndringar } from '../src/lib/bedomningsbegaran.js';
import { BEDOMNINGSLAGEN } from '../src/services/uppdragBedomning.js';
import { BESLUTSRADEN } from '../src/services/uppdragUndantag.js';
import { statusChip } from '../src/http/view/html.js';

describe('K0 de rena reglerna', () => {
  it('a perioden är läsdagens kalendermånad', h.provaKalendermanad);
  it('b februari har sin sista dag, också ett skottår', h.provaKalendermanadFebruari);
  it('c december slutar den 31', h.provaKalendermanadDecember);
  it('d samma mått före och nu är oförändrat, och ramen tas ur nu', h.provaOforandradDel);
  it('e minuterna eller beloppet ändrat är ändrat', h.provaAndradDel);
  it('f utan frysta tal går ingen skillnad att avgöra', h.provaUtanFrystaTal);
  it('g en ny del och en borttagen del är ändrade, i nu:s ordning', h.provaNyOchBorttagenDel);
  it('h ingen andel förs vidare (NFR-11)', h.provaIngenAndel);
  it('i texten utan tidigare bedömning', h.provaTextUtanBedomning);
  it('j texten med förbrukning, leverabel, signal och baseline', h.provaTextMedAndringar);
  it('k texten när ingenting ändrats', h.provaTextUtanAndringar);
  it('l ett okänt leverabelläge blir aldrig råvärdet', h.provaOkantLeverabellage);

  it('m varje leverabelläge i schemat har ett ord, och ordet är vyns etikett', async () => {
    const villkor = await withAdmin(async (c) => (await c.query<{ def: string }>(
      `SELECT pg_get_constraintdef(con.oid) AS def
         FROM pg_constraint con JOIN pg_class rel ON rel.oid = con.conrelid
        WHERE rel.relname = 'uppdrag_leverabel' AND con.contype = 'c'
          AND pg_get_constraintdef(con.oid) LIKE '%status%'`,
    )).rows);
    expect(villkor).toHaveLength(1);
    const lagen = [...villkor[0]!.def.matchAll(/'([^']+)'::text/g)].map((m) => m[1]!);
    // Ett prov som inte hittade något har inte visat något.
    expect(lagen.length, villkor[0]!.def).toBeGreaterThanOrEqual(5);
    for (const lage of lagen) {
      expect(Object.hasOwn(LEVERABELORD, lage), `LEVERABELORD saknar ${lage}`).toBe(true);
      expect(statusChip(lage).value.toLowerCase(), lage).toContain(LEVERABELORD[lage]!);
    }
  });
});

const PASSWORD = 'mycket-hemligt-losen-123';
const NOLL = '00000000-0000-4000-8000-000000000000';
const PERIOD = { period_start: '2026-10-01', period_slut: '2026-10-31' };

interface Bolag { id: string; user: TestUser; agent: Record<string, string>; ua: ReturnType<typeof supertest.agent> }
interface Uppdrag { projectId: string; contractId: string; leverabelId: string }
interface Begaranrad { id: string; contract_id: string; begard_av: string; begard_nar: string; kommentar: string | null }
interface Bedomningrad {
  id: string; begaran_id: string | null; satt_av: string | null; satt_av_manniska: boolean;
  lage: string; kommentar: string | null; created_at: string;
}
interface Auditrad { entity_type: string | null; entity_id: string | null; details: Record<string, unknown> }

const auth = (b: Bolag) => ({ Authorization: `Bearer ${b.user.token}` });
const co = (b: Bolag) => `/api/companies/${b.id}`;
const fel = <T>(p: Promise<T>) => p.then(() => null, (e: unknown) => e);
const korda = { k1f: 0, k1j: 0, k4i: 0, k5e: 0 };

let schema: Bolag; let begaran: Bolag; let satt: Bolag; let las: Bolag; let stangt: Bolag; let vy: Bolag;
let grannen: Bolag;

async function nyttBolag(namn: string, prefix = 'bedomningsbegaran'): Promise<Bolag> {
  const user = await registerUser(prefix);
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
async function koaOchGodkann(b: Bolag, namn: string, input: object) {
  const res = await act(b, namn, input);
  expect(res.status, `${namn}: ${JSON.stringify(res.body)}`).toBe(202);
  const godk = await api.post(`${co(b)}/approvals/${res.body.approval.id as string}/approve`).set(auth(b)).send({});
  expect(godk.status, JSON.stringify(godk.body)).toBe(200);
  return godk;
}
/** Ett uppdrag med ett avtal och ingenting annat. */
async function nyttUppdrag(b: Bolag, namn: string): Promise<{ projectId: string; contractId: string }> {
  const projectId = (await ok(b, 'create_project', { name: `Uppdrag ${namn}` })).id as string;
  const contractId = (await ok(b, 'create_contract', {
    project_id: projectId, name: namn, signed_date: '2026-01-01',
  })).id as string;
  return { projectId, contractId };
}
/** Ett uppdrag med taxa, avtalsdelen S1 med bekräftat tak och leverabeln L1 i läget `pagar`. */
async function riggatUppdrag(b: Bolag, namn: string): Promise<Uppdrag> {
  const projectId = (await ok(b, 'create_project', { name: `Uppdrag ${namn}` })).id as string;
  const contractId = (await ok(b, 'create_contract', {
    project_id: projectId, name: namn, signed_date: '2026-01-01', hourly_rate_ore: 120_000,
  })).id as string;
  await koaOchGodkann(b, 'upsert_contract_part', { change_reason: 'avtal',
    contract_id: contractId, code: 'S1', name: 'Fas 1', valid_from: '2026-01-01',
    cap_hours: 10, cap_amount_ore: 1_200_000, cap_confirmed: true,
  });
  const leverabelId = await withAdmin(async (c) => (await c.query<{ id: string }>(
    `INSERT INTO uppdrag_leverabel (company_id, contract_id, kod, status)
     VALUES ($1, $2, 'L1', 'pagar') RETURNING id`,
    [b.id, contractId],
  )).rows[0]!.id);
  return { projectId, contractId, leverabelId };
}
/** Avtalsdelens id ur husets egen läsväg. */
async function delId(b: Bolag, contractId: string, kod: string): Promise<string> {
  const parts = (await ok(b, 'get_contract_usage', { contract_id: contractId })).parts as { part_id: string; code: string }[];
  return parts.find((d) => d.code === kod)!.part_id;
}
async function begaranRader(contractId: string): Promise<Begaranrad[]> {
  return withAdmin(async (c) => (await c.query<Begaranrad>(
    `SELECT id, contract_id, begard_av, begard_nar::text, kommentar FROM uppdrag_bedomningsbegaran
      WHERE contract_id = $1 ORDER BY begard_nar, id`, [contractId],
  )).rows);
}
async function bedomningsrader(contractId: string): Promise<Bedomningrad[]> {
  return withAdmin(async (c) => (await c.query<Bedomningrad>(
    `SELECT id, begaran_id, satt_av, satt_av_manniska, lage, kommentar, created_at::text
       FROM uppdrag_bedomning WHERE contract_id = $1 ORDER BY created_at, id`, [contractId],
  )).rows);
}
/** Avtalets begäranden som ingen bedömningsrad bär. */
async function obesvarade(contractId: string): Promise<string[]> {
  return withAdmin(async (c) => (await c.query<{ id: string }>(
    `SELECT r.id FROM uppdrag_bedomningsbegaran r
      WHERE r.contract_id = $1
        AND NOT EXISTS (SELECT 1 FROM uppdrag_bedomning b WHERE b.begaran_id = r.id)
      ORDER BY r.begard_nar, r.id`, [contractId],
  )).rows.map((r) => r.id));
}
async function audit(b: Bolag, action: string): Promise<Auditrad[]> {
  return withAdmin(async (c) => (await c.query<Auditrad>(
    'SELECT entity_type, entity_id, details FROM audit_log WHERE company_id = $1 AND action = $2 ORDER BY id',
    [b.id, action],
  )).rows);
}
async function hela(b: Bolag): Promise<string[]> {
  return withAdmin(async (c) => (await c.query<{ rad: string }>(
    "SELECT action || ':' || coalesce(entity_id, '') AS rad FROM audit_log WHERE company_id = $1 ORDER BY id",
    [b.id],
  )).rows.map((r) => r.rad));
}
async function koposter(b: Bolag): Promise<number> {
  return withAdmin(async (c) => (await c.query<{ n: number }>(
    'SELECT count(*)::int AS n FROM action_approvals WHERE company_id = $1', [b.id],
  )).rows[0]!.n);
}
async function undantag(b: Bolag): Promise<any> {
  return ok(b, 'las_undantag', {});
}
async function lage(b: Bolag, projectId: string): Promise<any> {
  return ok(b, 'las_uppdragslage', { project_id: projectId });
}
/** En begäran genom åtgärden, som människa. */
async function begar(b: Bolag, contractId: string, kommentar?: string): Promise<any> {
  return ok(b, 'begar_ny_bedomning', { contract_id: contractId, ...(kommentar === undefined ? {} : { kommentar }) });
}

beforeAll(async () => {
  schema = await nyttBolag('Schema AB');
  begaran = await nyttBolag('Begaran AB');
  satt = await nyttBolag('Satt AB');
  las = await nyttBolag('Las AB');
  stangt = await nyttBolag('Stangt AB');
  vy = await nyttBolag('Vy AB');
  // Grannbolaget har en egen användare (lärdom ur 1.6).
  grannen = await nyttBolag('Grannbolaget AB', 'bedomningsbegaran-granne');
});

// ---------------------------------------------------------------------------
// K1 — tabellens form (AC 1 och 9)
// ---------------------------------------------------------------------------

describe('K1 tabellens form', () => {
  let a1: string; let a2: string; let s: { projectId: string; contractId: string }; let g: string;
  const somApp = (b: Bolag, sql: string, varden: unknown[]) =>
    withTenantTransaction(b.user.userId, b.id, (c) => c.query(sql, varden));

  beforeAll(async () => {
    const a = await nyttUppdrag(schema, 'Schema A1');
    a1 = a.contractId;
    a2 = (await ok(schema, 'create_contract', {
      project_id: a.projectId, name: 'Schema A2', signed_date: '2026-01-01',
    })).id as string;
    s = await nyttUppdrag(schema, 'Schema S');
    g = (await nyttUppdrag(grannen, 'Grannens avtal')).contractId;
  });

  it('a kolumnerna och deras NOT NULL, utan baselinekolumner och utan förbjudna ord', async () => {
    const kolumner = await withAdmin(async (c) => (await c.query<{ column_name: string; is_nullable: string }>(
      `SELECT column_name, is_nullable FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'uppdrag_bedomningsbegaran'`,
    )).rows);
    expect(kolumner.map((k) => k.column_name).sort())
      .toEqual(['id', 'company_id', 'contract_id', 'begard_av', 'begard_nar', 'kommentar'].sort());
    expect(kolumner.filter((k) => k.is_nullable === 'YES').map((k) => k.column_name)).toEqual(['kommentar']);
    for (const k of kolumner) {
      expect(BASELINEKOLUMNER as readonly string[]).not.toContain(k.column_name);
      expect(k.column_name).not.toMatch(/procent|percent|progress|fardig/);
      expect(k.column_name.split('_')).not.toContain('andel');
      expect(k.column_name.split('_')).not.toContain('klart');
    }
  });

  it('b kategorin står först i tabellkommentaren', async () => {
    const k = await withAdmin(async (c) => (await c.query<{ k: string }>(
      "SELECT obj_description('uppdrag_bedomningsbegaran'::regclass, 'pg_class') AS k",
    )).rows[0]!.k);
    expect(k).toMatch(/^Kategori: ÄGD[,.;]/);
  });

  it('c RLS, policyer och rättigheter: SELECT och INSERT, ingenting annat', async () => {
    const rls = await withAdmin(async (c) => (await c.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      "SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = 'uppdrag_bedomningsbegaran'::regclass",
    )).rows[0]!);
    expect(rls).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
    const policyer = await withAdmin(async (c) => (await c.query<{ cmd: string; uttryck: string }>(
      `SELECT cmd, coalesce(qual, '') || coalesce(with_check, '') AS uttryck
         FROM pg_policies WHERE tablename = 'uppdrag_bedomningsbegaran'`,
    )).rows);
    expect(policyer.map((p) => p.cmd).sort()).toEqual(['INSERT', 'SELECT']);
    for (const p of policyer) expect(p.uttryck).toContain('app_has_company_access');
    for (const [ratt, vantat] of [['SELECT', true], ['INSERT', true], ['UPDATE', false], ['DELETE', false]] as const) {
      const har = await withAdmin(async (c) => (await c.query<{ har: boolean }>(
        "SELECT has_table_privilege('app', 'uppdrag_bedomningsbegaran', $1) AS har", [ratt],
      )).rows[0]!.har);
      expect(har, ratt).toBe(vantat);
    }
  });

  it('d append-only i praktiken: INSERT går, UPDATE och DELETE fälls som app', async () => {
    const id = await withTenantTransaction(schema.user.userId, schema.id, async (c) => (await c.query<{ id: string }>(
      `INSERT INTO uppdrag_bedomningsbegaran (company_id, contract_id, begard_av, kommentar)
       VALUES ($1, $2, $3, 'B1') RETURNING id`,
      [schema.id, a1, schema.user.userId],
    )).rows[0]!.id);
    const fore = await begaranRader(a1);
    expect(fore.map((r) => r.id)).toContain(id);
    for (const sats of ["UPDATE uppdrag_bedomningsbegaran SET kommentar = 'Ändrad' WHERE id = $1",
      'DELETE FROM uppdrag_bedomningsbegaran WHERE id = $1']) {
      expect(String(await fel(somApp(schema, sats, [id])))).toMatch(/permission denied/);
    }
    expect(await begaranRader(a1)).toEqual(fore);
  });

  it('e nycklarna binder avtalet till bolaget och begäran till en användare', async () => {
    const insert = (contractId: string, begardAv: string) => withAdmin((c) => c.query(
      'INSERT INTO uppdrag_bedomningsbegaran (company_id, contract_id, begard_av) VALUES ($1, $2, $3)',
      [schema.id, contractId, begardAv]));
    expect(String(await fel(insert(g, schema.user.userId)))).toMatch(/uppdrag_bedomningsbegaran_contract_fk/);
    expect(String(await fel(insert(a1, NOLL)))).toMatch(/uppdrag_bedomningsbegaran_begard_av_fkey/);
  });

  it('f CHECK på kommentaren, ett fall per sats', async () => {
    const insert = (kommentar: string | null) => withAdmin((c) => c.query(
      'INSERT INTO uppdrag_bedomningsbegaran (company_id, contract_id, begard_av, kommentar) VALUES ($1, $2, $3, $4)',
      [schema.id, a2, schema.user.userId, kommentar]));
    for (const kommentar of ['   ', 'x'.repeat(2001)]) {
      expect(String(await fel(insert(kommentar)))).toMatch(/uppdrag_bedomningsbegaran_kommentar/);
      korda.k1f++;
    }
    await insert(null);
  });

  it('g bedömningen har två nya nullbara uuid-kolumner, och fortfarande bara SELECT och INSERT', async () => {
    const kolumner = await withAdmin(async (c) => (await c.query<{ column_name: string; data_type: string; is_nullable: string }>(
      `SELECT column_name, data_type, is_nullable FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'uppdrag_bedomning'
          AND column_name IN ('begaran_id', 'satt_av') ORDER BY column_name`,
    )).rows);
    expect(kolumner).toEqual([
      { column_name: 'begaran_id', data_type: 'uuid', is_nullable: 'YES' },
      { column_name: 'satt_av', data_type: 'uuid', is_nullable: 'YES' },
    ]);
    for (const ratt of ['UPDATE', 'DELETE']) {
      const har = await withAdmin(async (c) => (await c.query<{ har: boolean }>(
        "SELECT has_table_privilege('app', 'uppdrag_bedomning', $1) AS har", [ratt],
      )).rows[0]!.har);
      expect(har, ratt).toBe(false);
    }
  });

  it('h avslutat uppdrag: INSERT fälls, den tidigare raden går att läsa', async () => {
    const insert = () => somApp(schema,
      'INSERT INTO uppdrag_bedomningsbegaran (company_id, contract_id, begard_av) VALUES ($1, $2, $3)',
      [schema.id, s.contractId, schema.user.userId]);
    await insert();
    await ok(schema, 'set_project_status', { project_id: s.projectId, status: 'closed' });
    expect(String(await fel(insert()))).toMatch(/uppdraget är avslutat/);
    const lasbara = await withTenantTransaction(schema.user.userId, schema.id, async (c) =>
      (await c.query('SELECT id FROM uppdrag_bedomningsbegaran WHERE contract_id = $1', [s.contractId])).rowCount);
    expect(lasbara).toBe(1);
  });

  it('i grannbolaget ser inga rader och kan inte skriva i vårt bolag', async () => {
    const synliga = await withTenantTransaction(grannen.user.userId, grannen.id, async (c) =>
      (await c.query('SELECT id FROM uppdrag_bedomningsbegaran')).rowCount);
    expect(synliga).toBe(0);
    const e = await fel(somApp(grannen,
      'INSERT INTO uppdrag_bedomningsbegaran (company_id, contract_id, begard_av) VALUES ($1, $2, $3)',
      [schema.id, a1, grannen.user.userId]));
    expect(String(e)).toMatch(/row-level security/);
  });

  it('j bedömningens nya villkor, ett försök per transaktion', async () => {
    const ny = async (kommentar: string) => withAdmin(async (c) => (await c.query<{ id: string }>(
      `INSERT INTO uppdrag_bedomningsbegaran (company_id, contract_id, begard_av, kommentar)
       VALUES ($1, $2, $3, $4) RETURNING id`, [schema.id, a1, schema.user.userId, kommentar],
    )).rows[0]!.id);
    const b1 = await ny('B1 j');
    const b2 = await ny('B2 j');
    const bedom = (contractId: string, begaranId: string | null, manniska: boolean, sattAv: string | null) =>
      withAdmin((c) => c.query(
        `INSERT INTO uppdrag_bedomning
           (company_id, contract_id, period_start, period_slut, lage, satt_av_manniska, begaran_id, satt_av)
         VALUES ($1, $2, '2026-10-01', '2026-10-31', 'risk', $3, $4, $5)`,
        [schema.id, contractId, manniska, begaranId, sattAv]));
    const fall: [() => Promise<unknown>, RegExp][] = [
      [() => bedom(a2, b1, true, null), /uppdrag_bedomning_begaran_fk/],
      [() => bedom(a1, NOLL, true, null), /uppdrag_bedomning_begaran_fk/],
    ];
    for (const [forsok, monster] of fall) {
      expect(String(await fel(forsok()))).toMatch(monster);
      korda.k1j++;
    }
    await bedom(a1, b1, true, null);
    const efter: [() => Promise<unknown>, RegExp][] = [
      [() => bedom(a1, b1, true, null), /uppdrag_bedomning_en_per_begaran/],
      [() => bedom(a1, b2, false, null), /uppdrag_bedomning_begaran_kraver_manniska/],
      [() => bedom(a1, null, false, schema.user.userId), /uppdrag_bedomning_satt_av_kraver_manniska/],
    ];
    for (const [forsok, monster] of efter) {
      expect(String(await fel(forsok()))).toMatch(monster);
      korda.k1j++;
    }
    // Dagens form, utan begäran och utan satt_av, går igenom som förut.
    await withAdmin((c) => c.query(
      `INSERT INTO uppdrag_bedomning
         (company_id, contract_id, period_start, period_slut, lage, satt_av_manniska)
       VALUES ($1, $2, '2026-10-01', '2026-10-31', 'pa_spar', true)`, [schema.id, a1]));
  });

  it('k definitionerna av de sammansatta FK:erna', async () => {
    const def = async (namn: string) => withAdmin(async (c) => (await c.query<{ d: string }>(
      'SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conname = $1', [namn],
    )).rows[0]!.d);
    expect(await def('uppdrag_bedomningsbegaran_contract_fk')).toContain('REFERENCES contracts(id, company_id)');
    expect(await def('uppdrag_bedomning_begaran_fk'))
      .toContain('REFERENCES uppdrag_bedomningsbegaran(id, company_id, contract_id)');
  });
});

// ---------------------------------------------------------------------------
// K3 — begäran (AC 2, 7, 9 och 10)
// ---------------------------------------------------------------------------

describe('K3 begäran', () => {
  let u: Uppdrag;
  let forsta: any;
  let grannavtal: string;
  const begardFor = async (b: Bolag, id: string) =>
    (await audit(b, 'uppdrag.bedomning_begard')).filter((r) => r.entity_id === id);

  beforeAll(async () => {
    u = await riggatUppdrag(begaran, 'K3 a');
    grannavtal = (await nyttUppdrag(grannen, 'Granne K3')).contractId;
  });

  it('a första begäran skrivs, med svar, rad och auditrad', async () => {
    forsta = await begar(begaran, u.contractId, 'Kunden flyttade L3 två veckor');
    expect(Object.keys(forsta).sort()).toEqual(
      ['id', 'contract_id', 'begard_av', 'begard_av_namn', 'begard_nar', 'kommentar', 'befintlig'].sort());
    expect(forsta).toMatchObject({
      contract_id: u.contractId, begard_av: begaran.user.userId, begard_av_namn: 'bedomningsbegaran',
      kommentar: 'Kunden flyttade L3 två veckor', befintlig: false,
    });
    expect(forsta.begard_nar).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    const rader = await begaranRader(u.contractId);
    expect(rader).toHaveLength(1);
    expect(rader[0]).toMatchObject({
      id: forsta.id, contract_id: u.contractId, begard_av: begaran.user.userId, kommentar: 'Kunden flyttade L3 två veckor',
    });
    expect(await begardFor(begaran, forsta.id)).toEqual([{
      entity_type: 'uppdrag_bedomningsbegaran', entity_id: forsta.id,
      details: { contract_id: u.contractId, kommentar_finns: true },
    }]);
    expect(await hela(begaran)).toContain('action.executed:begar_ny_bedomning');
  });

  it('b den andra begäran pekar på den första och skriver ingenting', async () => {
    const antal = (await audit(begaran, 'uppdrag.bedomning_begard')).length;
    const andra = await begar(begaran, u.contractId, 'Annan text');
    expect(andra).toMatchObject({ id: forsta.id, befintlig: true, kommentar: 'Kunden flyttade L3 två veckor' });
    expect(await begaranRader(u.contractId)).toHaveLength(1);
    expect(await audit(begaran, 'uppdrag.bedomning_begard')).toHaveLength(antal);
  });

  it('c två samtidiga begäranden blir en rad', async () => {
    const u2 = await riggatUppdrag(begaran, 'K3 c');
    const svar = await Promise.all([1, 2].map(() => act(begaran, 'begar_ny_bedomning', { contract_id: u2.contractId })));
    for (const s of svar) expect(s.status, JSON.stringify(s.body)).toBe(200);
    const [x, y] = svar.map((s) => s.body.result);
    expect(x.id).toBe(y.id);
    expect([x.befintlig, y.befintlig].sort()).toEqual([false, true]);
    expect(await begaranRader(u2.contractId)).toHaveLength(1);
  });

  it('d kommentaren är frivillig och lagras trimmad', async () => {
    const u4 = await riggatUppdrag(begaran, 'K3 d utan');
    const utan = await begar(begaran, u4.contractId);
    expect(utan.kommentar).toBeNull();
    expect((await begardFor(begaran, utan.id))[0]!.details).toEqual({ contract_id: u4.contractId, kommentar_finns: false });

    const u3 = await riggatUppdrag(begaran, 'K3 d trimmad');
    const med = await begar(begaran, u3.contractId, '  Kunden flyttade L3  ');
    expect(med.kommentar).toBe('Kunden flyttade L3');
    expect((await begaranRader(u3.contractId))[0]!.kommentar).toBe('Kunden flyttade L3');
  });

  it('e agenten avvisas med 403 human_required, och ingenting skrivs', async () => {
    const u5 = await riggatUppdrag(begaran, 'K3 e');
    const fore = await hela(begaran);
    const res = await act(begaran, 'begar_ny_bedomning', { contract_id: u5.contractId }, begaran.agent);
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(res.body.error).toBe('human_required');
    expect(await begaranRader(u5.contractId)).toEqual([]);
    expect(await hela(begaran)).toEqual(fore);
  });

  it('f grannbolagets och okända avtal ger 404, och det egna avtalet går igenom', async () => {
    const u6 = await riggatUppdrag(begaran, 'K3 f');
    // Kontrollen: en okänd åtgärd ger också 404, så utan den hade fallet varit grönt i förväg.
    expect((await begar(begaran, u6.contractId)).befintlig).toBe(false);
    const antal = async () => withAdmin(async (c) => (await c.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM uppdrag_bedomningsbegaran WHERE company_id = ANY($1::uuid[])',
      [[begaran.id, grannen.id]],
    )).rows[0]!.n);
    const fore = await antal();
    for (const [b, contractId] of [[grannen, u6.contractId], [begaran, grannavtal], [begaran, NOLL]] as const) {
      const res = await act(b, 'begar_ny_bedomning', { contract_id: contractId });
      expect(res.status, JSON.stringify(res.body)).toBe(404);
      expect(res.body.error).toBe('not_found');
    }
    expect(await antal()).toBe(fore);
    expect(await begaranRader(u6.contractId)).toHaveLength(1);
    expect(await begaranRader(grannavtal)).toEqual([]);
  });

  it('g avslutat uppdrag: ny begäran fälls, och en öppen begäran pekas ut utan att något skrivs', async () => {
    const v = await riggatUppdrag(stangt, 'K3 g stangt');
    await ok(stangt, 'set_project_status', { project_id: v.projectId, status: 'closed' });
    const res = await act(stangt, 'begar_ny_bedomning', { contract_id: v.contractId });
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(res.body.error).toBe('rule_violation');
    expect(await begaranRader(v.contractId)).toEqual([]);

    const v2 = await riggatUppdrag(stangt, 'K3 g oppen');
    const oppen = await begar(stangt, v2.contractId);
    await ok(stangt, 'set_project_status', { project_id: v2.projectId, status: 'closed' });
    const antal = (await audit(stangt, 'uppdrag.bedomning_begard')).length;
    const igen = await begar(stangt, v2.contractId);
    expect(igen).toMatchObject({ id: oppen.id, befintlig: true });
    expect(await begaranRader(v2.contractId)).toHaveLength(1);
    expect(await audit(stangt, 'uppdrag.bedomning_begard')).toHaveLength(antal);
  });

  it('h schemat fäller tomt, extra fält, för lång och blank kommentar', async () => {
    const u7 = await riggatUppdrag(begaran, 'K3 h');
    for (const input of [
      {},
      { contract_id: u7.contractId, begard_av: begaran.user.userId },
      { contract_id: u7.contractId, kommentar: 'x'.repeat(2001) },
      { contract_id: u7.contractId, kommentar: '   ' },
    ]) {
      const res = await act(begaran, 'begar_ny_bedomning', input);
      expect(res.status, JSON.stringify(res.body)).toBe(400);
      expect(res.body.error).toBe('validation_error');
    }
    expect(await begaranRader(u7.contractId)).toEqual([]);
  });

  it('i en definition: write, människospärrad, utan kö och med två fält', () => {
    const m = actionManifest().find((a) => a.name === 'begar_ny_bedomning')!;
    expect(m).toMatchObject({ sensitivity: 'write', requires_approval: false });
    expect(Object.keys(m.input_schema.properties as object).sort()).toEqual(['contract_id', 'kommentar']);
    const def = ACTIONS.find((a) => a.name === 'begar_ny_bedomning')!;
    expect(def.kravManniska).toBe(true);
    expect(def.tvafas).toBeUndefined();
    expect(def.vidAvslag).toBeUndefined();
  });

  it('j en besvarad begäran ger plats för en ny', async () => {
    await withAdmin((c) => c.query(
      `INSERT INTO uppdrag_bedomning
         (company_id, contract_id, period_start, period_slut, lage, satt_av_manniska, begaran_id)
       VALUES ($1, $2, '2026-10-01', '2026-10-31', 'risk', true, $3)`,
      [begaran.id, u.contractId, forsta.id]));
    const ny = await begar(begaran, u.contractId);
    expect(ny.befintlig).toBe(false);
    expect(ny.id).not.toBe(forsta.id);
    expect(await begaranRader(u.contractId)).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// K4 — bedömningen besvarar begäran (AC 4–7)
// ---------------------------------------------------------------------------

describe('K4 bedömningen besvarar begäran', () => {
  const satta = (b: Bolag, contractId: string, lageKod: string, extra: object = {}, headers?: Record<string, string>) =>
    act(b, 'satt_bedomning', { contract_id: contractId, ...PERIOD, lage: lageKod, ...extra }, headers);
  const sattFor = async (b: Bolag, id: string) =>
    (await audit(b, 'uppdrag.bedomning_satt')).filter((r) => r.entity_id === id);

  it('a–b med begaran_id: en rad med människan och begäran, en auditrad, ingen köpost och inget andra svar', async () => {
    const w = await riggatUppdrag(satt, 'K4 a');
    const b = (await begar(satt, w.contractId)).id as string;
    const ko = await koposter(satt);
    const res = await satta(satt, w.contractId, 'risk', { begaran_id: b });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.status).toBe('ok');
    const svar = res.body.result;
    expect(svar).toMatchObject({
      begaran_id: b, satt_av: satt.user.userId, satt_av_namn: 'bedomningsbegaran', satt_av_manniska: true,
      contract_name: 'K4 a', lage: 'risk',
    });
    const rader = await bedomningsrader(w.contractId);
    expect(rader).toHaveLength(1);
    expect(rader[0]).toMatchObject({ id: svar.id, begaran_id: b, satt_av: satt.user.userId, satt_av_manniska: true });
    expect(await sattFor(satt, svar.id)).toEqual([{
      entity_type: 'uppdrag_bedomning', entity_id: svar.id,
      details: { contract_id: w.contractId, lage: 'risk', begaran_id: b },
    }]);
    expect(await koposter(satt)).toBe(ko);

    // b) Samma begäran besvaras inte igen.
    const igen = await satta(satt, w.contractId, 'pa_spar', { begaran_id: b });
    expect(igen.status, JSON.stringify(igen.body)).toBe(409);
    expect(igen.body.error).toBe('begaran_besvarad');
    expect((await bedomningsrader(w.contractId)).filter((r) => r.begaran_id === b)).toHaveLength(1);
  });

  it('c två samtidiga svar på samma begäran: ett 200 och ett 409 begaran_besvarad', async () => {
    const w2 = await riggatUppdrag(satt, 'K4 c');
    const b2 = (await begar(satt, w2.contractId)).id as string;
    const svar = await Promise.all(['pa_spar', 'ur_spar'].map((l) => satta(satt, w2.contractId, l, { begaran_id: b2 })));
    expect(svar.map((s) => s.status).sort()).toEqual([200, 409]);
    expect(svar.find((s) => s.status === 409)!.body.error).toBe('begaran_besvarad');
    const rader = await bedomningsrader(w2.contractId);
    expect(rader).toHaveLength(1);
    expect(rader[0]!.begaran_id).toBe(b2);
  });

  it('d utan begaran_id besvarar bedömningen avtalets öppna begäran', async () => {
    const w3 = await riggatUppdrag(satt, 'K4 d');
    const b3 = (await begar(satt, w3.contractId)).id as string;
    const svar = await ok(satt, 'satt_bedomning', { contract_id: w3.contractId, ...PERIOD, lage: 'pa_spar' });
    expect(svar.begaran_id).toBe(b3);
    expect((await bedomningsrader(w3.contractId))[0]!.begaran_id).toBe(b3);
    expect(await obesvarade(w3.contractId)).toEqual([]);
    const igen = await satta(satt, w3.contractId, 'risk', { begaran_id: b3 });
    expect(igen.status, JSON.stringify(igen.body)).toBe(409);
    expect(igen.body.error).toBe('begaran_besvarad');
  });

  it('e utan begäran skrivs raden som förut, nu med satt_av (FR-15)', async () => {
    const w4 = await riggatUppdrag(satt, 'K4 e');
    const svar = await ok(satt, 'satt_bedomning', { contract_id: w4.contractId, ...PERIOD, lage: 'ur_spar' });
    expect(svar).toMatchObject({ begaran_id: null, satt_av: satt.user.userId, satt_av_manniska: true });
  });

  it('f en begäran för ett annat avtal ger 409 begaran_annat_avtal, och ingenting skrivs', async () => {
    const w5 = await riggatUppdrag(satt, 'K4 f begäran');
    const w6 = await riggatUppdrag(satt, 'K4 f bedömning');
    const b5 = (await begar(satt, w5.contractId)).id as string;
    const res = await satta(satt, w6.contractId, 'risk', { begaran_id: b5 });
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(res.body.error).toBe('begaran_annat_avtal');
    expect(await bedomningsrader(w6.contractId)).toEqual([]);
    expect(await obesvarade(w5.contractId)).toEqual([b5]);
  });

  it('g en okänd eller främmande begäran ger 404, och ingenting skrivs', async () => {
    const w8 = await riggatUppdrag(satt, 'K4 g');
    const g = await nyttUppdrag(grannen, 'Granne K4');
    const grannens = (await begar(grannen, g.contractId)).id as string;
    for (const begaranId of [NOLL, grannens]) {
      const res = await satta(satt, w8.contractId, 'risk', { begaran_id: begaranId });
      expect(res.status, JSON.stringify(res.body)).toBe(404);
      expect(res.body.error).toBe('not_found');
    }
    expect(await bedomningsrader(w8.contractId)).toEqual([]);
    expect(await obesvarade(g.contractId)).toEqual([grannens]);
  });

  it('h agenten avvisas med 403 human_required, och begäran står obesvarad', async () => {
    const w7 = await riggatUppdrag(satt, 'K4 h');
    const b7 = (await begar(satt, w7.contractId)).id as string;
    const fore = await hela(satt);
    const res = await satta(satt, w7.contractId, 'pa_spar', { begaran_id: b7 }, satt.agent);
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(res.body.error).toBe('human_required');
    expect(await bedomningsrader(w7.contractId)).toEqual([]);
    expect(await obesvarade(w7.contractId)).toEqual([b7]);
    expect(await hela(satt)).toEqual(fore);
  });

  it('i de tre lägena har identisk friktion, med och utan kommentar', async () => {
    const nycklar: string[][] = [];
    for (const l of BEDOMNINGSLAGEN) {
      for (const kommentar of [undefined, `Motivering för ${l}`]) {
        const w = await riggatUppdrag(satt, `K4 i ${l} ${kommentar ? 'med' : 'utan'}`);
        const b = (await begar(satt, w.contractId)).id as string;
        const res = await satta(satt, w.contractId, l, { begaran_id: b, ...(kommentar ? { kommentar } : {}) });
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        nycklar.push(Object.keys(res.body.result).sort());
        const rader = await bedomningsrader(w.contractId);
        expect(rader).toHaveLength(1);
        expect(rader[0]).toMatchObject({ satt_av_manniska: true, begaran_id: b, lage: l, kommentar: kommentar ?? null });
        korda.k4i++;
      }
    }
    for (const n of nycklar) expect(n).toEqual(nycklar[0]);
  });

  it('j schemat: varken satt_av, satt_av_manniska eller ett ogiltigt begaran_id', async () => {
    const w9 = await riggatUppdrag(satt, 'K4 j');
    for (const extra of [{ satt_av: satt.user.userId }, { satt_av_manniska: true }, { begaran_id: 'inte-ett-id' }]) {
      const res = await satta(satt, w9.contractId, 'pa_spar', extra);
      expect(res.status, JSON.stringify(res.body)).toBe(400);
      expect(res.body.error).toBe('validation_error');
    }
    expect(await bedomningsrader(w9.contractId)).toEqual([]);
    const egenskaper = Object.keys(actionManifest().find((a) => a.name === 'satt_bedomning')!.input_schema.properties as object);
    expect(egenskaper).toContain('begaran_id');
    expect(egenskaper).not.toContain('satt_av');
    expect(egenskaper).not.toContain('satt_av_manniska');
    expect(ACTIONS.find((a) => a.name === 'satt_bedomning')!.kravManniska).toBe(true);
  });

  it('k avslutat uppdrag: svaret fälls med 409 rule_violation, och begäran står obesvarad', async () => {
    const x = await riggatUppdrag(stangt, 'K4 k');
    const bx = (await begar(stangt, x.contractId)).id as string;
    await ok(stangt, 'set_project_status', { project_id: x.projectId, status: 'closed' });
    const res = await satta(stangt, x.contractId, 'risk', { begaran_id: bx });
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(res.body.error).toBe('rule_violation');
    expect(await bedomningsrader(x.contractId)).toEqual([]);
    expect(await obesvarade(x.contractId)).toEqual([bx]);
  });
});

// ---------------------------------------------------------------------------
// K5 — läsvägarna (AC 3, 4, 6, 8 och 9)
// ---------------------------------------------------------------------------

describe('K5 läsvägarna', () => {
  const POSTNYCKLAR = ['slag', 'id', 'identitet', 'atgard', 'foreslagen_av', 'skapad_nar', 'uppdrag', 'val',
    'varfor_mandat', 'forslag', 'skal', 'kallor', 'ja_registrerar', 'bedomning'];
  const FORBJUDET = ['På spår', 'Risk', 'Ur spår', 'pa_spar', 'ur_spar'];
  const postFor = (svar: any, begaranId: string) =>
    (svar.poster as any[]).find((p) => p.id === begaranId && p.slag === 'ny_bedomning');
  const harPostForAvtal = (svar: any, contractId: string) =>
    (svar.poster as any[]).some((p) => p.slag === 'ny_bedomning' && p.uppdrag.varde?.contract_id === contractId);
  let r1: Uppdrag; let r1Begaran: any; let r1Bedomning: any; let r1b: Uppdrag; let r1bBegaran: any;
  let r2: Uppdrag; let r2Begaran: any;
  let r6a: Uppdrag; let r6b: Uppdrag; let r6aBegaran: string; let r7: Uppdrag;
  let svar: any;

  beforeAll(async () => {
    r1 = await riggatUppdrag(las, 'R1');
    r1Bedomning = await ok(las, 'satt_bedomning', { contract_id: r1.contractId, ...PERIOD, lage: 'risk', kommentar: 'Taket närmar sig.' });
    r1Begaran = await begar(las, r1.contractId, 'Kunden flyttade L3');
    r1b = await riggatUppdrag(las, 'R1b');
    // En rad i dagens form utan `satt_av`, som raderna från före 0082.
    await withAdmin((c) => c.query(
      `INSERT INTO uppdrag_bedomning
         (company_id, contract_id, period_start, period_slut, lage, satt_av_manniska, kommentar)
       VALUES ($1, $2, '2026-09-01', '2026-09-30', 'pa_spar', true, 'Satt före 0082')`,
      [las.id, r1b.contractId]));
    r1bBegaran = await begar(las, r1b.contractId);
    r2 = await riggatUppdrag(las, 'R2');
    r2Begaran = await begar(las, r2.contractId);
    svar = await undantag(las);
  });

  it('a posten bär uppdraget, valet, mandatet, källorna, vad ett val registrerar och underlaget', () => {
    const p = postFor(svar, r1Begaran.id);
    expect(p).toBeDefined();
    expect(p).toMatchObject({
      slag: 'ny_bedomning', identitet: 'begaran', atgard: null, foreslagen_av: 'human', skapad_nar: r1Begaran.begard_nar,
    });
    expect(p.val.kod).toBe('bedomningslage');
    expect(Object.keys(p.val)).toEqual(['kod', 'text']);
    for (const lageText of ['● På spår', '▲ Risk', '■ Ur spår']) expect(p.val.text).toContain(lageText);
    expect(p.varfor_mandat).toContain('Bara du bedömer uppdraget');
    expect(p.varfor_mandat).toContain('FR-15');
    expect(p.ja_registrerar).toContain('ny rad i bedömningshistoriken');
    expect(p.ja_registrerar).toContain('Begäran räknas som besvarad');
    expect(p.ja_registrerar).not.toContain(BESLUTSRADEN);
    const sokvagar = (p.kallor.varde as Array<{ sokvag?: string }>).map((k) => k.sokvag);
    expect(sokvagar).toContain(`/app/c/${las.id}/projects/${r1.projectId}/laget`);
    expect(sokvagar).toContain(`/app/c/${las.id}/projects/${r1.projectId}/bedomning`);
    expect(p.skal.varde).toContain('bedomningsbegaran begärde en ny bedömning');
    expect(p.skal.varde).toContain('Kunden flyttade L3');
    expect(p.uppdrag.varde).toMatchObject({ project_id: r1.projectId, contract_id: r1.contractId });
    for (const v of [p.uppdrag, p.forslag, p.skal, p.kallor, p.bedomning.senaste, p.bedomning.andringar]) {
      expect(v).toMatchObject({ kalla: 'redovisning', last_nar: svar.last_nar });
    }
    expect(p.bedomning.period).toEqual(kalendermanad(svar.last_nar.slice(0, 10)));
    expect(p.bedomning.begaran).toEqual({
      id: r1Begaran.id, begard_av_namn: 'bedomningsbegaran', begard_nar: r1Begaran.begard_nar, kommentar: 'Kunden flyttade L3',
    });
  });

  it('b senaste mänskliga bedömning med läge, datum och vem, och utan namn för en rad från före 0082', async () => {
    const rad = (await bedomningsrader(r1.contractId))[0]!;
    expect(postFor(svar, r1Begaran.id).bedomning.senaste.varde).toEqual({
      id: r1Bedomning.id, lage: 'risk', period_start: PERIOD.period_start, period_slut: PERIOD.period_slut,
      satt_nar: rad.created_at, satt_av_namn: 'bedomningsbegaran', kommentar: 'Taket närmar sig.',
    });
    expect(postFor(svar, r1bBegaran.id).bedomning.senaste.varde.satt_av_namn).toBeNull();
  });

  it('c utan tidigare bedömning: senaste saknas, och förslaget säger det', () => {
    const p = postFor(svar, r2Begaran.id);
    expect(p.bedomning.senaste).toMatchObject({ lage: 'saknas', varde: null });
    expect(p.bedomning.andringar.varde.sedan).toBeNull();
    expect(p.forslag.varde.till.startsWith('Ingen tidigare bedömning att jämföra med.')).toBe(true);
  });

  it('d vad som ändrats sedan bedömningen, ur egna tabeller och jämfört med de frysta talen', async () => {
    const r3 = await riggatUppdrag(las, 'R3');
    const s1 = await delId(las, r3.contractId, 'S1');
    await ok(las, 'log_time', { project_id: r3.projectId, work_date: '2026-09-15', minutes: 120,
      description: 'Före bedömningen', contract_part_id: s1 });
    await ok(las, 'tand_scopesignal', { contract_id: r3.contractId, fras: 'kan ni även före' });
    await withAdmin((c) => c.query(
      `INSERT INTO uppdrag_leverabel_handelse (company_id, contract_id, leverabel_id, fran, till, created_at)
       VALUES ($1, $2, $3, 'ej_paborjad', 'pagar', '2026-01-02T00:00:00Z')`, [las.id, r3.contractId, r3.leverabelId]));
    const bedomd = await ok(las, 'satt_bedomning', { contract_id: r3.contractId, ...PERIOD, lage: 'pa_spar' });
    const frysta = bedomd.frysta_siffror as { delar: Array<{ code: string; minuter: number; belopp_ore: number }> };

    await ok(las, 'log_time', { project_id: r3.projectId, work_date: '2026-09-16', minutes: 60,
      description: 'Efter bedömningen', contract_part_id: s1 });
    await withAdmin((c) => c.query(
      `INSERT INTO uppdrag_leverabel_handelse (company_id, contract_id, leverabel_id, fran, till)
       VALUES ($1, $2, $3, 'pagar', 'avvisad')`, [las.id, r3.contractId, r3.leverabelId]));
    const sEfter = (await ok(las, 'tand_scopesignal', { contract_id: r3.contractId, fras: 'kan ni även efter' })).id as string;
    await koaOchGodkann(las, 'upsert_contract_part', { change_reason: 'Tillägg', contract_id: r3.contractId,
      code: 'S2', name: 'Fas 2', valid_from: '2026-01-01', cap_hours: 5 });
    const b = await begar(las, r3.contractId);

    const p = postFor(await undantag(las), b.id);
    const a = p.bedomning.andringar.varde;
    expect(a.sedan).toBe((await bedomningsrader(r3.contractId))[0]!.created_at);
    const usage = (await ok(las, 'get_contract_usage', { contract_id: r3.contractId })).parts as Array<{
      code: string; billable_minutes: number; amount_ore: number;
    }>;
    const nuS1 = usage.find((d) => d.code === 'S1')!;
    const fryst = frysta.delar.find((d) => d.code === 'S1')!;
    const s1Post = a.forbrukning.find((f: any) => f.code === 'S1');
    expect(s1Post).toMatchObject({
      andrad: true, fore: { minuter: 120, belopp_ore: 240_000 }, nu: { minuter: 180, belopp_ore: 360_000 },
    });
    expect(s1Post.fore).toEqual({ minuter: fryst.minuter, belopp_ore: fryst.belopp_ore });
    expect(s1Post.nu).toEqual({ minuter: nuS1.billable_minutes, belopp_ore: nuS1.amount_ore });
    expect(a.forbrukning.find((f: any) => f.code === 'S2')).toMatchObject({ fore: null, andrad: true });
    for (const f of a.forbrukning) expect(Object.keys(f)).not.toContain('andel');
    expect(a.leverabelrorelser).toEqual([{ kod: 'L1', fran: 'pagar', till: 'avvisad', nar: expect.any(String) }]);
    expect(a.signaler.map((s: any) => ({ id: s.id, oppen: s.oppen }))).toEqual([{ id: sEfter, oppen: true }]);
    expect(a.baselineandringar).toHaveLength(1);
    expect(a.baselineandringar[0]).toMatchObject({ atgard: 'upsert_contract_part', kod: 'S2' });
    expect(p.forslag.varde.till).toBe(sammanfattaAndringar(a));
    for (const del of ['S1 02:00 → 03:00', 'L1 pågår → avvisad', 'scopesignal ”', 'godkänd baselineändring S2']) {
      expect(p.forslag.varde.till).toContain(del);
    }
  });

  it('e inget läge är förvalt och ingen maskin föreslår ett', async () => {
    const begaranden: string[] = [];
    for (const l of BEDOMNINGSLAGEN) {
      const r = await riggatUppdrag(las, `R5 ${l}`);
      await ok(las, 'satt_bedomning', { contract_id: r.contractId, ...PERIOD, lage: l });
      begaranden.push((await begar(las, r.contractId)).id as string);
    }
    const s = await undantag(las);
    for (const id of begaranden) {
      const p = postFor(s, id);
      for (const ord of FORBJUDET) expect(p.forslag.varde.till).not.toContain(ord);
      expect(Object.keys(p).sort()).toEqual([...POSTNYCKLAR].sort());
      expect(p.foreslagen_av).toBe('human');
      korda.k5e++;
    }
  });

  it('f posten försvinner när en bedömning besvarar begäran, med och utan begaran_id', async () => {
    r6a = await riggatUppdrag(las, 'R6a');
    r6aBegaran = (await begar(las, r6a.contractId)).id as string;
    expect(postFor(await undantag(las), r6aBegaran)).toBeDefined();
    await ok(las, 'satt_bedomning', { contract_id: r6a.contractId, ...PERIOD, lage: 'risk', begaran_id: r6aBegaran });
    expect(postFor(await undantag(las), r6aBegaran)).toBeUndefined();
    expect((await lage(las, r6a.projectId)).avtal[0].oppen_begaran).toBeNull();

    r6b = await riggatUppdrag(las, 'R6b');
    const r6bBegaran = (await begar(las, r6b.contractId)).id as string;
    expect(postFor(await undantag(las), r6bBegaran)).toBeDefined();
    await ok(las, 'satt_bedomning', { contract_id: r6b.contractId, ...PERIOD, lage: 'ur_spar' });
    expect(postFor(await undantag(las), r6bBegaran)).toBeUndefined();
    expect((await bedomningsrader(r6b.contractId))[0]!.begaran_id).toBe(r6bBegaran);
  });

  it('g en frisk period utan begäran ger ingen post, inte heller efter svepet', async () => {
    r7 = await riggatUppdrag(las, 'R7');
    await ok(las, 'satt_bedomning', { contract_id: r7.contractId, ...PERIOD, lage: 'pa_spar' });
    await ok(las, 'log_time', { project_id: r7.projectId, work_date: '2026-09-20', minutes: 60,
      description: 'Efter bedömningen', contract_part_id: await delId(las, r7.contractId, 'S1') });
    expect(harPostForAvtal(await undantag(las), r7.contractId)).toBe(false);
    await ok(las, 'kor_uppdragssvep', {});
    expect(harPostForAvtal(await undantag(las), r7.contractId)).toBe(false);
    expect(await begaranRader(r7.contractId)).toEqual([]);
    expect(await bedomningsrader(r7.contractId)).toHaveLength(1);
  });

  it('h avslutat uppdrag: begäran står i hoppade och som öppen i Läget, aldrig som post', async () => {
    const r8 = await riggatUppdrag(stangt, 'R8');
    const b = await begar(stangt, r8.contractId);
    await ok(stangt, 'set_project_status', { project_id: r8.projectId, status: 'closed' });
    const s = await undantag(stangt);
    expect((s.poster as any[]).some((p) => p.id === b.id)).toBe(false);
    expect(s.hoppade).toContainEqual({ id: b.id, identitet: 'begaran', atgard: null, orsak: 'uppdrag_avslutat' });
    expect((await lage(stangt, r8.projectId)).avtal[0].oppen_begaran).toMatchObject({ id: b.id, contract_id: r8.contractId });
  });

  it('i grannbolaget: ingen av dess begäranden hos oss, och ingen av våra hos det', async () => {
    const g = await nyttUppdrag(grannen, 'Granne K5');
    const gb = (await begar(grannen, g.contractId)).id as string;
    const var_ = JSON.stringify(await undantag(las));
    expect(var_).not.toContain(gb);
    expect(var_).not.toContain(g.contractId);
    const deras = await undantag(grannen);
    expect(postFor(deras, gb)).toBeDefined();
    expect(JSON.stringify(deras)).not.toContain(r1Begaran.id);
    expect(JSON.stringify(deras)).not.toContain(r1.contractId);
  });

  it('j Läget visar den öppna begäran och vem som satte bedömningen', async () => {
    const a = (await lage(las, r1.projectId)).avtal[0];
    const { befintlig: _befintlig, ...rad } = r1Begaran;
    expect(a.oppen_begaran).toEqual(rad);
    expect(a.bedomning).toMatchObject({ satt_av_namn: 'bedomningsbegaran', begaran_id: null });
    expect((await lage(las, r6a.projectId)).avtal[0].bedomning.begaran_id).toBe(r6aBegaran);
  });

  it('k samma svar i båda läsvägarna för ett aktivt uppdrag', async () => {
    const s = await undantag(las);
    const oppna: string[] = [];
    for (const r of [r1, r6a, r6b, r7]) {
      const oppen = (await lage(las, r.projectId)).avtal[0].oppen_begaran;
      expect(harPostForAvtal(s, r.contractId), r.contractId).toBe(oppen !== null);
      if (oppen !== null) oppna.push(r.contractId);
    }
    expect(oppna).toEqual([r1.contractId]);
  });

  it('l ren beskrivning utan databas', h.provaRenNyBedomning);
});

// ---------------------------------------------------------------------------
// K6 — vyn (AC 2, 6 och 9)
// ---------------------------------------------------------------------------

describe('K6 vyn', () => {
  let q: Uppdrag;
  const laget = (b: Bolag, u: { projectId: string }) => `/app/c/${b.id}/projects/${u.projectId}/laget`;
  async function sida(b: Bolag, path: string): Promise<string> {
    const res = await b.ua.get(path);
    expect(res.status, `${path} gav ${res.status}`).toBe(200);
    return res.text;
  }
  /** Ett kort ur sidan, i formen av `kort` i `uppdragsytan-laget.test.ts`. */
  function kort(html: string, id: string): string {
    const start = html.indexOf(`aria-labelledby="${id}"`);
    expect(start, `kortet ${id} saknas i sidan`).toBeGreaterThan(-1);
    const slut = html.indexOf('</section>', start);
    expect(slut).toBeGreaterThan(start);
    return html.slice(start, slut);
  }
  /** Notisens text ur en redirect till `?fel=`, avkodad. */
  const notis = (location: string | undefined): string => {
    const kodad = (location ?? '').split('fel=')[1];
    return kodad === undefined ? '' : decodeURIComponent(kodad);
  };
  const posta = (b: Bolag, u: { projectId: string }, kropp: Record<string, string>) =>
    b.ua.post(laget(b, u)).type('form').send(kropp);

  beforeAll(async () => {
    q = await riggatUppdrag(vy, 'Q');
  });

  it('a kortet har knappen för en begäran, och det tomma bandet nämner begäran', async () => {
    const html = await sida(vy, laget(vy, q));
    const k = kort(html, 'kort-bedomning');
    expect(k).toContain(`action="${laget(vy, q)}"`);
    expect(k).toContain('name="handling" value="begar_bedomning"');
    expect(k).toContain(`name="contract_id" value="${q.contractId}"`);
    expect(k).toContain('name="kommentar"');
    expect(k).toContain('Begär ny bedömning');
    const band = kort(html, 'handgrepp');
    expect(band).toContain('ingen begärd bedömning');
    expect(band).toContain('Kön töms bara av medvetna beslut');
  });

  it('b begäran från Läget går genom åtgärden som människa', async () => {
    const res = await posta(vy, q, { handling: 'begar_bedomning', contract_id: q.contractId, kommentar: 'Kunden flyttade L3' });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(laget(vy, q));
    const rader = await begaranRader(q.contractId);
    expect(rader).toHaveLength(1);
    expect(rader[0]).toMatchObject({ begard_av: vy.user.userId, kommentar: 'Kunden flyttade L3' });
  });

  it('c Läget efter: kortet säger att begäran väntar, och bandet har raden', async () => {
    const datum = (await lage(vy, q.projectId)).avtal[0].oppen_begaran.begard_nar.slice(0, 10) as string;
    const html = await sida(vy, laget(vy, q));
    const k = kort(html, 'kort-bedomning');
    expect(k).toContain('Ny bedömning begärd');
    expect(k).toContain(datum);
    expect(k).toContain('bedomningsbegaran');
    expect(k).toContain(`href="/app/c/${vy.id}/projects/${q.projectId}/bedomning"`);
    expect(k).not.toContain('value="begar_bedomning"');
    const band = kort(html, 'handgrepp');
    expect(band).toContain('Ny bedömning begärd');
    expect(band).toContain(`href="/app/c/${vy.id}/projects/${q.projectId}/bedomning"`);
    expect(band).toContain('>Bedöm</a>');
    expect(html).toContain('class="ai-card"');
  });

  it('d ett upprepat POST skapar ingen ny begäran och säger varför', async () => {
    const res = await posta(vy, q, { handling: 'begar_bedomning', contract_id: q.contractId });
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/\/laget\?fel=/);
    expect(notis(res.headers.location)).toContain('väntar redan sedan');
    expect(await begaranRader(q.contractId)).toHaveLength(1);
  });

  it('e Övrigt utan handling är oförändrat', async () => {
    const fore = await begaranRader(q.contractId);
    const res = await posta(vy, q, { contract_id: q.contractId, text: 'En vanlig anteckning' });
    expect(res.status).toBe(302);
    const anteckningar = await withAdmin(async (c) => (await c.query(
      `SELECT 1 FROM uppdrag_anteckning WHERE contract_id = $1 AND "text" = 'En vanlig anteckning'`, [q.contractId],
    )).rowCount);
    expect(anteckningar).toBe(1);
    expect(await begaranRader(q.contractId)).toEqual(fore);
  });

  it('f Bedömning-sidan säger att bedömningen besvarar begäran, och svaret tar bort den', async () => {
    const bedomning = `/app/c/${vy.id}/projects/${q.projectId}/bedomning`;
    const html = await sida(vy, bedomning);
    expect(html).toContain('Ny bedömning begärd');
    expect(html).toContain('besvarar begäran');
    const begaranId = (await begaranRader(q.contractId))[0]!.id;
    const res = await vy.ua.post(bedomning).type('form').send({ contract_id: q.contractId, ...PERIOD, lage: 'pa_spar' });
    expect(res.status).toBe(302);
    expect((await bedomningsrader(q.contractId)).at(-1)!.begaran_id).toBe(begaranId);
    const efter = await sida(vy, laget(vy, q));
    expect(kort(efter, 'kort-bedomning')).toContain('value="begar_bedomning"');
    expect(kort(efter, 'handgrepp')).not.toContain('Ny bedömning begärd');
  });

  it('g stängt uppdrag: kortet säger att begäran inte kan besvaras, och ingen knapp finns', async () => {
    const z = await riggatUppdrag(stangt, 'Z');
    await begar(stangt, z.contractId);
    await ok(stangt, 'set_project_status', { project_id: z.projectId, status: 'closed' });
    const html = await sida(stangt, laget(stangt, z));
    const k = kort(html, 'kort-bedomning');
    expect(k).toContain('kan inte längre besvaras');
    expect(k).not.toContain('value="begar_bedomning"');
    const band = kort(html, 'handgrepp');
    expect(band).not.toContain('Ny bedömning begärd');
    expect(band).not.toContain('>Bedöm</a>');

    const z2 = await riggatUppdrag(stangt, 'Z2');
    await ok(stangt, 'set_project_status', { project_id: z2.projectId, status: 'closed' });
    expect(kort(await sida(stangt, laget(stangt, z2)), 'kort-bedomning')).not.toContain('value="begar_bedomning"');
  });

  it('h Bedömning-sidans period är oförändrad: läsdagens kalendermånad', async () => {
    const { start, slut } = kalendermanad(new Date().toISOString().slice(0, 10));
    const html = await sida(vy, `/app/c/${vy.id}/projects/${q.projectId}/bedomning`);
    expect(html).toContain(`name="period_start" value="${start}"`);
    expect(html).toContain(`name="period_slut" value="${slut}"`);
  });
});

it('kontrollvakt: de negativa fallen kördes', () => {
  expect(korda.k1f).toBe(2);
  expect(korda.k1j).toBe(5);
  expect(korda.k4i).toBe(6);
  expect(korda.k5e).toBe(3);
});
