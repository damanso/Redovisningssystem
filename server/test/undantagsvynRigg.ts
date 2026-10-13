// Story 1.11: den delade riggen för undantagsvyns prov — bolagen, posterna,
// läsarna och REST-anropen. Tre provfiler importerar den: supertestprovet,
// webbläsarprovet och, för `uppdragsdestination()`, markeringsprovet.
//
// Riggen står i en egen fil, eftersom en provfil som importerar en annan
// provfil också registrerar dess fall. Den importerar ALDRIG vyn
// (`undantagsvyn.ts`): då laddas markeringsprovet också innan vyn finns, och
// de rena fallen i `undantagsvynHelper.ts` går att köra utan databas.
//
// Formen följer `uppdragsytan-undantag.test.ts` (rad 42–92) och
// `uppdragsytan-scopeavgorande.test.ts` (rad 65–112), med en skillnad: varje
// hjälpare tar BOLAGET, eftersom varje bolag har sin egen användare. Svepets
// första steg gäller hela bolaget, så varje grupp av fall får ett eget bolag.
import { readFileSync } from 'node:fs';
import supertest from 'supertest';
import { expect } from 'vitest';
import { api, app, createCompany, createFiscalYear, registerUser, withAdmin, type TestUser } from './helpers.js';
import { importeraOchGodkann } from './uppdragImportHelper.js';
import { LEVERANSKONTRAKT_NVR001 } from './fixtures/leveranskontrakt-nvr-001.js';
import { withTenantTransaction } from '../src/db/tx.js';
import { createApproval } from '../src/services/approvals.js';

export const PASSWORD = 'mycket-hemligt-losen-123';

/** Ett bolag med egen användare, agentens token och en inloggad webbsession. */
export interface Bolag {
  id: string;
  user: TestUser;
  auth: Record<string, string>;
  agent: Record<string, string>;
  ua: ReturnType<typeof supertest.agent>;
}
export interface Uppdrag { projektId: string; contractId: string }

export async function nyttBolag(namn: string): Promise<Bolag> {
  const user = await registerUser('undantagsvyn');
  const id = await createCompany(user.token, namn);
  const auth = { Authorization: `Bearer ${user.token}` };
  await createFiscalYear(id, auth, { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });
  const tok = await api.post(`/api/companies/${id}/agent-tokens`).set(auth).send({ name: 'Hermes' });
  expect(tok.status, JSON.stringify(tok.body)).toBe(201);
  const ua = supertest.agent(app);
  const login = await ua.post('/app/login').type('form').send({ email: user.email, password: PASSWORD });
  expect([302, 303]).toContain(login.status);
  return { id, user, auth, agent: { Authorization: `Bearer ${tok.body.token as string}` }, ua };
}

export async function act(b: Bolag, namn: string, kropp: Record<string, unknown>, headers = b.auth) {
  return api.post(`/api/companies/${b.id}/actions/${namn}`).set(headers).send(kropp);
}
export async function ok(b: Bolag, namn: string, kropp: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await act(b, namn, kropp);
  expect(res.status, `${namn}: ${JSON.stringify(res.body)}`).toBe(200);
  return res.body.result as Record<string, unknown>;
}
/** En sensitive åtgärd som lämnas i kön: 202, och köpostens id. */
export async function koa(b: Bolag, namn: string, kropp: Record<string, unknown>): Promise<string> {
  const res = await act(b, namn, kropp);
  expect(res.status, `${namn}: ${JSON.stringify(res.body)}`).toBe(202);
  return res.body.approval.id as string;
}
export async function godkann(b: Bolag, approvalId: string): Promise<void> {
  const res = await api.post(`/api/companies/${b.id}/approvals/${approvalId}/approve`).set(b.auth).send({});
  expect(res.status, JSON.stringify(res.body)).toBe(200);
}
export async function svep(b: Bolag): Promise<void> {
  const res = await ok(b, 'kor_uppdragssvep', {});
  expect(res.lage).toBe('svep_kort');
}
export async function nyttUppdrag(b: Bolag, namn: string): Promise<Uppdrag> {
  const projektId = (await ok(b, 'create_project', { name: namn })).id as string;
  const contractId = (await ok(b, 'skapa_uppdrag', {
    project_id: projektId, name: `Avtal ${namn}`, signed_date: '2026-09-03',
  })).contract_id as string;
  return { projektId, contractId };
}
/** Ett uppdrag med satt baseline: avtalsdelarna finns och inget väntar. */
export async function frisktUppdrag(b: Bolag, namn: string): Promise<Uppdrag> {
  const u = await nyttUppdrag(b, namn);
  await importeraOchGodkann(b.id, b.auth, { contract_id: u.contractId, kontraktstext: LEVERANSKONTRAKT_NVR001 });
  return u;
}
export const andring = (contractId: string, code = 'NY') => ({
  contract_id: contractId, code, name: 'Ny avtalsdel', valid_from: '2026-10-01', change_reason: 'Kunden bad om mer underlag',
});
/** En köpost lagd direkt i kön, som förlagan — aldrig ett beslut för hand. */
export async function plantera(b: Bolag, action: string, input: Record<string, unknown>): Promise<string> {
  return withTenantTransaction(b.user.userId, b.id, async (db) =>
    (await createApproval(db, b.id, b.user.userId, 'agent', action, input)).id);
}
export async function del(b: Bolag, contractId: string, code = 'L1'): Promise<string> {
  const r = await ok(b, 'get_contract_usage', { contract_id: contractId });
  const p = (r.parts as { part_id: string; code: string }[]).find((x) => x.code === code);
  expect(p, `delen ${code}`).toBeDefined();
  return p!.part_id;
}
export async function kvitto(b: Bolag, belopp = 100): Promise<string> {
  return (await ok(b, 'create_receipt', {
    receipt_date: '2026-09-15', description: 'Underlag', net_ore: belopp, vat_rate: 0, expense_account: 5460,
  })).id as string;
}
/** Ett bokfört kvitto, så att en bindning går att verkställa (`uppdragsytan-mandat.test.ts` rad 76–88). */
export async function bokfortKvitto(b: Bolag): Promise<string> {
  const id = (await ok(b, 'create_receipt', {
    receipt_date: '2026-11-20', description: 'Provets kvitto', net_ore: 400000, vat_rate: 25, expense_account: 5460,
  })).id as string;
  await godkann(b, await koa(b, 'book_receipt', { receipt_id: id }));
  return id;
}

/** Postid:n för de fem slagen i ett bolag. */
export interface FemSlag {
  a: Uppdrag;
  b: Uppdrag;
  baselineandring: string;
  kostnadsbindning: string;
  avslut: string;
  scopeavgorande: string;
  ny_bedomning: string;
}
/**
 * En post av varje slag, i formen av `uppdragsytan-undantag.test.ts` rad
 * 151–167: två friska uppdrag, en baselineändring, en kostnadsbindning och en
 * scopesignal på A, och avslutet och den begärda bedömningen på B. Svepet körs
 * sist, så att täckningen gäller underlaget som det står.
 */
export async function femSlag(bolag: Bolag): Promise<FemSlag> {
  const a = await frisktUppdrag(bolag, 'Uppdrag A');
  const b = await frisktUppdrag(bolag, 'Uppdrag B');
  const baselineandring = await koa(bolag, 'andra_baseline', andring(a.contractId));
  const kostnadsbindning = await koa(bolag, 'binda_kostnad', {
    receipt_id: await kvitto(bolag), contract_part_id: await del(bolag, a.contractId),
  });
  const avslut = await koa(bolag, 'avsluta_uppdrag', { project_id: b.projektId });
  const scopeavgorande = (await ok(bolag, 'tand_scopesignal', {
    contract_id: a.contractId, fras: 'kan ni även', klausul: '5.4',
  })).id as string;
  const ny_bedomning = (await ok(bolag, 'begar_ny_bedomning', { contract_id: b.contractId })).id as string;
  await svep(bolag);
  return { a, b, baselineandring, kostnadsbindning, avslut, scopeavgorande, ny_bedomning };
}

// --- Vyn --------------------------------------------------------------------

export const vy = (b: Bolag): string => `/app/c/${b.id}/uppdrag`;

/** En inloggad människas sida: 200 och texten. */
export async function sida(b: Bolag, path: string): Promise<string> {
  const res = await b.ua.get(path);
  expect(res.status, `${path} gav ${res.status}`).toBe(200);
  return res.text;
}
/** Ett formulärsvar till undantagsvyns POST, som webbläsaren skickar det. */
export const posta = (b: Bolag, kropp: Record<string, string>) => b.ua.post(vy(b)).type('form').send(kropp);

/** Texten i `?fel=` ur en redirect, avkodad. */
export function notis(location: string | undefined): string {
  const i = (location ?? '').indexOf('fel=');
  return i === -1 ? '' : decodeURIComponent((location ?? '').slice(i + 'fel='.length).replace(/\+/g, ' '));
}

/** Postens artikel ur sidan, eller null när den inte finns. */
export function artikel(html: string, id: string): string | null {
  const i = html.search(new RegExp(`<article[^>]*\\bid="post-${id}"`));
  if (i === -1) return null;
  const j = html.indexOf('</article>', i);
  return j === -1 ? null : html.slice(i, j + '</article>'.length);
}

/** REST-vägen: `approvals/<id>/approve` eller `actions/<namn>`. */
export async function rest(b: Bolag, vag: string, kropp: Record<string, unknown> = {}, headers = b.auth) {
  return api.post(`/api/companies/${b.id}/${vag}`).set(headers).send(kropp);
}

// --- Läsarna (ägarrollen, förbi app-rollen) ---------------------------------

export async function kopost(id: string): Promise<{ status: string; beslut_hash: string | null; beslut_skal: string | null }> {
  return withAdmin(async (c) => (await c.query(
    'SELECT status, beslut_hash, beslut_skal FROM action_approvals WHERE id=$1', [id],
  )).rows[0]);
}
export async function beslutsrader(approvalId: string): Promise<{ antal: number; utfall: string[] }> {
  const rader = await withAdmin(async (c) => (await c.query<{ utfall: string }>(
    'SELECT utfall FROM uppdrag_beslut WHERE approval_id=$1 ORDER BY created_at, id', [approvalId],
  )).rows);
  return { antal: rader.length, utfall: rader.map((r) => r.utfall) };
}
export async function avgoranden(signalId: string): Promise<{ avgorande: string; avgjort_av: string | null }[]> {
  return withAdmin(async (c) => (await c.query(
    'SELECT avgorande, avgjort_av FROM uppdrag_scopeavgorande WHERE signal_id=$1 ORDER BY lopnummer', [signalId],
  )).rows);
}
export async function bedomningar(begaranId: string): Promise<{ lage: string; satt_av_manniska: boolean; begaran_id: string; kommentar: string | null }[]> {
  return withAdmin(async (c) => (await c.query(
    'SELECT lage, satt_av_manniska, begaran_id, kommentar FROM uppdrag_bedomning WHERE begaran_id=$1 ORDER BY created_at, id',
    [begaranId],
  )).rows);
}
export async function koposter(bolagId: string): Promise<number> {
  return withAdmin(async (c) => (await c.query<{ n: number }>(
    'SELECT count(*)::int AS n FROM action_approvals WHERE company_id=$1', [bolagId],
  )).rows[0]!.n);
}

/**
 * Den destination som kontraktet anger som ägare till GET /c/:companyId/uppdrag,
 * läst ur filen av provet självt — aldrig genom `ruttensAgare`, så att provet
 * inte mäter sig självt. Före generatorns synk `projects_list`, efter den
 * ingångens egen destination (K-e).
 */
export function uppdragsdestination(): string {
  const k = JSON.parse(readFileSync(new URL('../kontrakt/navigation.v1.json', import.meta.url), 'utf8')) as {
    routes: { service: string; method: string; router_pattern: string; owner_id: string }[];
  };
  const rader = k.routes.filter((r) => r.service === 'redovisning' && r.method === 'GET'
    && r.router_pattern === '/c/:companyId/uppdrag');
  expect(rader, 'kontraktet ska ha exakt en ägare till GET /c/:companyId/uppdrag').toHaveLength(1);
  return rader[0]!.owner_id;
}
