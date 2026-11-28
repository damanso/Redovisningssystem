// Story 4.4, FR-12: bara godkända leverabler är läst faktureringsunderlag.
// Ren regel, schema, tenantgräns, oförändrat sakläge och projektsidans läsning
// prövas utan mockad databas. Saknade godkännanden får aldrig hittas på.
import supertest from 'supertest';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PoolClient } from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';
import { app, api, createCompany, createFiscalYear, registerUser, withAdmin, type TestUser } from './helpers.js';
import { importeraOchGodkann } from './uppdragImportHelper.js';
import { LEVERANSKONTRAKT_NVR001 } from './fixtures/leveranskontrakt-nvr-001.js';
import { FAKTURERBARA_LAGEN, FAKTURA_TEXT, lasFaktureringsunderlag, valjFakturaunderlag } from '../src/services/invoiceFromTime.js';
import type { Faktureringsunderlag } from '../src/services/invoiceFromTime.js';
import { getAction } from '../src/actions/registry.js';
import type { Leverabelrad } from '../src/services/uppdragRegister.js';
import { faltvarde } from '../src/lib/leverabelfalt.js';
import { LUCKTEXT } from '../src/lib/kontraktsluckor.js';
import { esc } from '../src/http/view/html.js';
import { withTenantTransaction } from '../src/db/tx.js';

const PASSWORD = 'mycket-hemligt-losen-123';
const PARTER = { godkannare: 'Styrgruppen', godkannare_eskalering: 'Eva Larsson (VD)',
  godkannandeform: 'Telefon eller mejl från Eva Larsson räcker och loggas med datum och kanal', kalla: 'leveranskontraktet' };
type Avtal = { projectId: string; contractId: string };
let user: TestUser;
let companyId: string;
let agentToken: string;
let ua: ReturnType<typeof supertest.agent>;
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
async function nyttAvtal(namn: string, parter: typeof PARTER | null = PARTER, projekt?: string): Promise<Avtal> {
  const projectId = projekt ?? (await ok('create_project', { name: namn })).id as string;
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
const overlamna = (a: Avtal, kod: string, tillagg: Record<string, unknown> = {}) => ok('bekrafta_statusbyte', {
  ...indata(a, kod), utfall: 'bekraftad',
  handling: { sort: 'mejl', extern_id: `<faktura-${a.contractId}-${kod}@nvr.se>`, extern_kalla: 'gmail:locollabs' },
  ...tillagg,
});
const godkann = (a: Avtal, kod: string, tillagg: Record<string, unknown> = {}) => ok('godkann_leverabel', {
  ...indata(a, kod), kanal: 'telefon', nar: '2026-09-20', ...tillagg,
});
async function sattStatus(a: Avtal, kod: string, status: string) {
  await withAdmin((c) => c.query('UPDATE uppdrag_leverabel SET status=$1 WHERE company_id=$2 AND contract_id=$3 AND kod=$4',
    [status, companyId, a.contractId, kod]));
}
const register = (a: Avtal) => ok<Leverabelrad[]>('las_leverabelregister', { contract_id: a.contractId });
async function underlag(projectId: string, headers = auth()): Promise<Faktureringsunderlag> {
  const res = await act('las_faktureringsunderlag', { project_id: projectId }, headers);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.result as Faktureringsunderlag;
}
async function raknare() {
  return withAdmin(async (c) => {
    const antal = await c.query(`SELECT
      (SELECT count(*) FROM invoices WHERE company_id=$1)::int AS fakturor,
      (SELECT count(*) FROM invoice_lines l JOIN invoices i ON i.id=l.invoice_id AND i.company_id=l.company_id WHERE i.company_id=$1)::int AS rader,
      (SELECT count(*) FROM invoice_appendix_rows r JOIN invoices i ON i.id=r.invoice_id AND i.company_id=r.company_id WHERE i.company_id=$1)::int AS bilagor,
      (SELECT count(*) FROM time_entries WHERE company_id=$1 AND invoiced=true)::int AS tid,
      (SELECT count(*) FROM action_approvals WHERE company_id=$1)::int AS ko,
      (SELECT count(*) FROM uppdrag_leverabel_handelse WHERE company_id=$1)::int AS handelser`, [companyId]);
    const lagen = await c.query('SELECT contract_id, kod, status FROM uppdrag_leverabel WHERE company_id=$1 ORDER BY contract_id, kod', [companyId]);
    return { ...antal.rows[0], lagen: lagen.rows };
  });
}
async function projektsida(projectId: string) {
  const res = await ua.get(`/app/c/${companyId}/projects/${projectId}`);
  expect(res.status, res.text).toBe(200);
  return res.text;
}
function block(html: string): string {
  const start = html.indexOf('data-faktureringsunderlag');
  return start === -1 ? '' : html.slice(start, html.indexOf('</section>', start));
}
const rad = (kod: string, status: string, over: Partial<Leverabelrad> = {}): Leverabelrad => ({
  contract_id: '11111111-1111-4111-8111-111111111111', kod, status, namn: `Namn ${kod}`, klausul: null,
  acceptanskriterium: `Kriterium ${kod}`, uppfoljningsmatt: null, matt_lasvag: null,
  revision: null, mottagare: null, overlamnad: null, dagar_i_laget: 0, ...over,
});
const handelse = (kod: string, over: Partial<{ dag: string | null; kanal: string | null; mottagare: string | null }> = {}) => ({
  kod, dag: '2026-09-20', kanal: 'telefon', mottagare: 'Styrgruppen', ...over,
});
const procentbrister = (text: string) => text.match(/%|\b(?:procent|andel|klart)\b/gi) ?? [];

beforeAll(async () => {
  user = await registerUser('faktureringsunderlag');
  companyId = await createCompany(user.token, 'Faktureringsunderlag AB');
  await createFiscalYear(companyId, auth(), { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });
  ua = supertest.agent(app);
  const login = await ua.post('/app/login').type('form').send({ email: user.email, password: PASSWORD });
  expect([302, 303]).toContain(login.status);
  const tok = await api.post(`${co()}/agent-tokens`).set(auth()).send({ name: 'Underlagsprov' });
  expect(tok.status, JSON.stringify(tok.body)).toBe(201);
  agentToken = tok.body.token;
});

describe('Story 4.4: regeln', () => {
  const alla = () => ['ej_paborjad', 'pagar', 'levererad', 'godkand', 'avvisad', 'okant'].map((s, i) => rad(`L${i + 1}`, s));
  it('4.4-R1 väljer bara godkand och bevarar registrets ordning', () => {
    expect(FAKTURERBARA_LAGEN).toEqual(['godkand']);
    expect(valjFakturaunderlag(alla(), []).map((r) => r.kod)).toEqual(['L4']);
    const fler = alla().map((r) => ['L3', 'L5'].includes(r.kod) ? { ...r, status: 'godkand' } : r);
    expect(valjFakturaunderlag(fler, []).map((r) => r.kod)).toEqual(['L3', 'L4', 'L5']);
  });
  it('4.4-R2 har slutna fält utan ekonomidata och muterar inga indata', () => {
    const register = alla(); const h = [handelse('L4')];
    const fore = structuredClone({ register, h });
    const svar = valjFakturaunderlag(register, h);
    expect(svar).toHaveLength(1);
    expect(Object.keys(svar[0]!).sort()).toEqual(['acceptanskriterium', 'contract_id', 'godkannande', 'kalla', 'kod', 'namn', 'overlamnad', 'revision']);
    expect(svar[0]!.kalla).toBe('registret');
    function ekonominycklar(v: unknown): string[] {
      if (!v || typeof v !== 'object') return [];
      return Object.entries(v).flatMap(([k, x]) => [/(?:_ore$|minuter|timmar|belopp)/i.test(k) ? k : '', ...ekonominycklar(x)]).filter(Boolean);
    }
    expect(ekonominycklar(svar)).toEqual([]);
    expect({ register, h }).toEqual(fore);
  });
  it('4.4-R3 läser godkännandet ur händelsen och hittar aldrig på ett', () => {
    const r = [rad('L4', 'godkand')];
    const g = valjFakturaunderlag(r, [handelse('L4')])[0]!.godkannande;
    expect(g).toMatchObject({ dag: '2026-09-20', kanal: 'telefon', mottagare: 'Styrgruppen' });
    for (const v of ['2026-09-20', 'telefon', 'Styrgruppen']) expect(g.text).toContain(v);
    expect(valjFakturaunderlag(r, [])[0]!.godkannande).toEqual({
      dag: null, kanal: null, mottagare: null, text: FAKTURA_TEXT.godkannande_saknas,
    });
    expect(valjFakturaunderlag([rad('L3', 'levererad')], [handelse('L3')])).toEqual([]);
    expect(valjFakturaunderlag(r, [handelse('L4', { dag: null, kanal: null, mottagare: null })])[0]!.godkannande)
      .toEqual({ dag: null, kanal: null, mottagare: null, text: 'saknas, saknas' });
  });
  it('4.4-R4 visar angivna värden ordagrant och saknade fält genom faltvarde', () => {
    const r = rad('L4', 'godkand', { namn: null, acceptanskriterium: '  ', revision: 1 });
    const u = valjFakturaunderlag([r], [])[0]!;
    expect(u.namn).toEqual({ varde: null, text: LUCKTEXT.namn.vad });
    expect(u.acceptanskriterium).toEqual({ varde: null, text: LUCKTEXT.acceptanskriterium.vad });
    expect(u.revision).toEqual({ varde: 1, text: '1' });
    const saknat = faltvarde(r, 'overlamnad');
    expect(saknat.lage).toBe('saknas');
    expect(u.overlamnad).toEqual({ varde: null, text: saknat.lage === 'saknas' ? saknat.text : '' });
    const datum = '2026-09-19';
    expect(valjFakturaunderlag([{ ...r, overlamnad: datum }], [])[0]!.overlamnad).toEqual({ varde: datum, text: datum });
    const utanRevision = { ...r, revision: null };
    const rev = faltvarde(utanRevision, 'revision');
    expect(rev.lage).toBe('saknas');
    expect(valjFakturaunderlag([utanRevision], [])[0]!.revision).toEqual({ varde: null, text: rev.lage === 'saknas' ? rev.text : '' });
  });
  it('4.4-R5 saknar procent och procentord i texter och regelns svar', () => {
    expect(procentbrister('45 % klart')).not.toEqual([]);
    expect(procentbrister('andel klara leverabler')).not.toEqual([]);
    for (const text of Object.values(FAKTURA_TEXT)) expect(procentbrister(text)).toEqual([]);
    for (const r of [alla(), [rad('L4', 'godkand')], [rad('L4', 'godkand', { namn: null, acceptanskriterium: '  ', revision: 1 })]]) {
      for (const h of [[], [handelse('L4')]]) expect(procentbrister(JSON.stringify(valjFakturaunderlag(r, h)))).toEqual([]);
    }
  });
  it('4.4-R6 ger tomt underlag för tomt register och enbart levererade', () => {
    expect(valjFakturaunderlag([], [])).toEqual([]);
    expect(valjFakturaunderlag([rad('L1', 'levererad')], [])).toEqual([]);
  });
});

describe('Story 4.4: schemat (regression)', () => {
  let a: Avtal;
  beforeAll(async () => { a = await nyttAvtal('Schema'); });
  it('4.4-S1 fäller åtta otillåtna värden och godtar exakt de fem lägena', async () => {
    for (const s of ['fakturerad', 'fakturerbar', 'klar', '50%', '100', 'GODKAND', 'godkänd', '']) {
      await expect(sattStatus(a, 'L1', s)).rejects.toMatchObject({ code: '23514' });
    }
    for (const s of ['ej_paborjad', 'pagar', 'levererad', 'godkand', 'avvisad']) await sattStatus(a, 'L1', s);
    await sattStatus(a, 'L1', 'ej_paborjad');
    expect((await register(a)).find((r) => r.kod === 'L1')!.status).toBe('ej_paborjad');
  });
  it('4.4-S2 har fem lägen i CHECK och tio kolumner utan procentfält', async () => {
    await withAdmin(async (c) => {
      const constraints = await c.query<{ def: string }>("SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid='uppdrag_leverabel'::regclass AND contype='c'");
      const status = constraints.rows.find((r) => /\bstatus\b/.test(r.def));
      expect(status).toBeDefined();
      expect([...status!.def.matchAll(/'([^']*)'/g)].map((m) => m[1]).sort()).toEqual(['avvisad', 'ej_paborjad', 'godkand', 'levererad', 'pagar']);
      const cols = await c.query<{ column_name: string }>("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='uppdrag_leverabel' ORDER BY ordinal_position");
      const names = cols.rows.map((r) => r.column_name);
      expect(names).toContain('status');
      expect(names).toEqual(['id', 'company_id', 'contract_id', 'kod', 'klausul', 'acceptanskriterium', 'uppfoljningsmatt', 'matt_lasvag', 'status', 'created_at']);
    });
  });
});

// Importgrafen inkluderar typimporter och transitiva vägar under hela src.
const src = fileURLToPath(new URL('../src/', import.meta.url));
async function kallor(): Promise<Map<string, string>> {
  const filer = (await readdir(src, { recursive: true })).filter((f) => f.endsWith('.ts'));
  return new Map(await Promise.all(filer.map(async (f) => [f, await readFile(new URL(f, new URL('../src/', import.meta.url)), 'utf8')] as const)));
}
function importgraf(karta: Map<string, string>): Map<string, string[]> {
  return new Map([...karta].map(([fil, text]) => [fil, [...text.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)]
    .map((m) => m[1]!).filter((s) => s.startsWith('.'))
    .map((s) => posix.normalize(posix.join(posix.dirname(fil), s)).replace(/\.js$/, '.ts'))]));
}
function riktningsbrister(karta: Map<string, string>): string[] {
  const graf = importgraf(karta);
  const forbjudna = ['services/invoices.ts', 'services/invoiceFromTime.ts', 'services/invoiceAppendix.ts', 'services/recurringInvoices.ts'];
  return [...karta.keys()].filter((f) => /^services\/uppdrag[^/]*\.ts$/.test(f)).flatMap((start) => {
    const sedda = new Set<string>(); const ko = [start]; const brister: string[] = [];
    if (/\b(?:import|require)\s*\(/.test(karta.get(start)!)) brister.push(`${start}: dynamisk import`);
    while (ko.length) {
      const fil = ko.pop()!;
      if (sedda.has(fil)) continue;
      sedda.add(fil);
      if (forbjudna.includes(fil)) brister.push(`${start} når ${fil}`);
      ko.push(...graf.get(fil) ?? []);
    }
    return brister;
  });
}
function skrivbrister(karta: Map<string, string>): string[] {
  const uppdateringar = [...karta].flatMap(([f, t]) => [...t.matchAll(/\bUPDATE\s+uppdrag_leverabel\s/gi)].map(() => f));
  const infogningar = [...karta].flatMap(([f, t]) => [...t.matchAll(/\bINSERT\s+INTO\s+uppdrag_leverabel\s([\s\S]*?)\bVALUES\b/gi)].map((m) => ({ fil: f, kolumner: m[1]! })));
  const brister: string[] = [];
  if (uppdateringar.length !== 3 || uppdateringar.some((f) => f !== 'services/uppdragStatus.ts')) brister.push('annan statusuppdatering');
  if (infogningar.length !== 1 || infogningar[0]?.fil !== 'services/uppdragImport.ts' || /\bstatus\b/i.test(infogningar[0]?.kolumner ?? '')) brister.push('annan registerimport');
  if ((karta.get('services/uppdragStatus.ts')!.match(/'godkand'/g) ?? []).length !== 1) brister.push('annat godkännandesteg');
  return brister;
}

describe('Story 4.4: läsvägen', () => {
  async function godkandOchLevererad(namn: string) {
    const a = await nyttAvtal(namn);
    await paborja(a, 'L1'); await overlamna(a, 'L1'); await godkann(a, 'L1');
    await paborja(a, 'L2'); await overlamna(a, 'L2');
    return a;
  }
  it('4.4-A1 visar endast godkända med registerfält, händelse, källa och lästid', async () => {
    const a = await godkandOchLevererad('P'); await paborja(a, 'L3');
    const reg = await register(a);
    for (const [kod, status] of [['L1', 'godkand'], ['L2', 'levererad'], ['L3', 'pagar']]) expect(reg.find((r) => r.kod === kod)!.status).toBe(status);
    const u = await underlag(a.projectId);
    expect(u.project_id).toBe(a.projectId); expect(u.regel).toBe(FAKTURA_TEXT.regel); expect(u.ingen_faktura).toBe(FAKTURA_TEXT.ingen_faktura);
    expect(u.avtal).toHaveLength(1); expect(u.avtal[0]!.contract_id).toBe(a.contractId);
    const last = u.avtal[0]!.underlag;
    expect(last).toMatchObject({ lage: 'last', kalla: 'redovisning' });
    expect(Number.isNaN(Date.parse(last.last_nar!))).toBe(false);
    expect(last.varde).toHaveLength(1);
    const r = last.varde![0]!; const l1 = reg.find((r) => r.kod === 'L1')!;
    expect(r).toMatchObject({ kod: 'L1', kalla: 'registret', revision: { varde: 1 },
      overlamnad: { varde: l1.overlamnad }, acceptanskriterium: { varde: l1.acceptanskriterium },
      godkannande: { dag: '2026-09-20', kanal: 'telefon', mottagare: 'Styrgruppen' } });
    expect(JSON.stringify(u)).not.toContain('"L2"');
    expect(procentbrister(JSON.stringify(u))).toEqual([]);
  }, 120_000);
  it('4.4-A2 visar saknat godkännande när läget saknar händelse', async () => {
    const a = await nyttAvtal('Q'); await sattStatus(a, 'L4', 'godkand');
    const h = await withAdmin(async (c) => (await c.query("SELECT id FROM uppdrag_leverabel_handelse WHERE company_id=$1 AND contract_id=$2 AND till='godkand'", [companyId, a.contractId])).rows);
    expect(h).toEqual([]);
    const r = (await underlag(a.projectId)).avtal[0]!.underlag.varde!;
    expect(r).toHaveLength(1); expect(r[0]!.kod).toBe('L4');
    expect(r[0]!.godkannande).toEqual({ dag: null, kanal: null, mottagare: null, text: FAKTURA_TEXT.godkannande_saknas });
  });
  it('4.4-A3 håller isär avtal, tomt projekt, okänt projekt och grannbolag', async () => {
    const a = await nyttAvtal('Z-avtal'); const b = await nyttAvtal('A-avtal', PARTER, a.projectId);
    await paborja(b, 'L1'); await overlamna(b, 'L1'); await godkann(b, 'L1');
    const u = await underlag(a.projectId);
    expect(u.avtal.map((r) => r.contract_id)).toEqual([b.contractId, a.contractId]);
    expect(u.avtal.find((r) => r.contract_id === a.contractId)!.underlag.varde).toEqual([]);
    expect(u.avtal.find((r) => r.contract_id === b.contractId)!.underlag.varde!.map((r) => r.kod)).toEqual(['L1']);
    const tom = await ok('create_project', { name: 'Utan avtal' });
    expect((await underlag(tom.id as string)).avtal).toEqual([]);
    const okant = await act('las_faktureringsunderlag', { project_id: randomUUID() });
    expect(okant.status, JSON.stringify(okant.body)).toBe(404);
    const granne = await registerUser('underlag-granne'); const grannbolag = await createCompany(granne.token, 'Grannen AB');
    const headers = { Authorization: `Bearer ${granne.token}` };
    const gp = await api.post(`/api/companies/${grannbolag}/actions/create_project`).set(headers).send({ name: 'Grannprojekt' });
    expect(gp.status, JSON.stringify(gp.body)).toBe(200);
    const finns = await api.post(`/api/companies/${grannbolag}/actions/get_project`).set(headers).send({ project_id: gp.body.result.id });
    expect(finns.status, JSON.stringify(finns.body)).toBe(200);
    const fel = await act('las_faktureringsunderlag', { project_id: gp.body.result.id });
    expect(fel.status, JSON.stringify(fel.body)).toBe(404);
  }, 120_000);
  it('4.4-A4 läsningarna ändrar varken ekonomi, kö, historik eller lägen', async () => {
    const a = await godkandOchLevererad('P4'); const fore = await raknare();
    expect(fore.handelser).toBeGreaterThan(0);
    await underlag(a.projectId); await underlag(a.projectId); await projektsida(a.projectId);
    expect(await raknare()).toEqual(fore);
  }, 120_000);
  it('4.4-A5 är läsbar för agenten medan betalning fortfarande kräver kön (K5)', async () => {
    const action = getAction('las_faktureringsunderlag');
    expect(action).toBeDefined(); expect(action!.sensitivity).toBe('read'); expect(action!.kravManniska).not.toBe(true);
    const a = await nyttAvtal('Agentläsning');
    const utanLastid = (u: Faktureringsunderlag) => ({ ...u, avtal: u.avtal.map((a) => ({ ...a, underlag: { ...a.underlag, last_nar: null } })) });
    expect(utanLastid(await underlag(a.projectId, { Authorization: `Bearer ${agentToken}` }))).toEqual(utanLastid(await underlag(a.projectId)));
    expect(getAction('create_invoice_from_time')!.sensitivity).toBe('write');
    for (const namn of ['register_invoice_payment', 'book_invoice_and_register_payment', 'link_voucher_and_mark_paid', 'unlink_voucher_and_reset_payment', 'register_supplier_payment']) {
      expect(getAction(namn)).toBeDefined(); expect(getAction(namn)!.sensitivity).toBe('sensitive');
    }
    for (const kropp of [{}, { project_id: a.projectId, company_id: companyId }, { project_id: 'fel' }]) {
      const fel = await act('las_faktureringsunderlag', kropp);
      expect(fel.status, JSON.stringify(fel.body)).toBe(400);
    }
  });
  it('4.4-A6 regression: ingen uppdragstjänst når faktureringen direkt eller transitivt', async () => {
    const karta = await kallor(); const graf = importgraf(karta);
    expect(karta.has('services/uppdragRegister.ts')).toBe(true); expect(karta.has('services/uppdragStatus.ts')).toBe(true);
    expect(graf.get('services/uppdragLage.ts')).toContain('services/contracts.ts');
    expect(graf.get('services/invoiceFromTime.ts')).toContain('services/uppdragRegister.ts');
    expect(riktningsbrister(karta)).toEqual([]);
    const transitiv = new Map(karta); transitiv.set('services/contracts.ts', `${transitiv.get('services/contracts.ts')}\nimport { createInvoiceFromTime } from './invoiceFromTime.js';`);
    expect(riktningsbrister(transitiv)).not.toEqual([]);
    const dynamisk = new Map(karta); dynamisk.set('services/uppdragLage.ts', `${dynamisk.get('services/uppdragLage.ts')}\nawait import('./invoices.js');`);
    expect(riktningsbrister(dynamisk)).not.toEqual([]);
  });
  it('4.4-A7 kräver människa, kanal och avtalets godkännare i den enda skrivvägen', async () => {
    const a = await nyttAvtal('R'); await paborja(a, 'L2'); await overlamna(a, 'L2');
    const forsok = [
      { kropp: { ...indata(a, 'L2'), kanal: 'telefon' }, headers: { Authorization: `Bearer ${agentToken}` }, status: 403, error: 'human_required' },
      { kropp: indata(a, 'L2'), headers: auth(), status: 400, error: 'validation_error' },
    ];
    for (const f of forsok) {
      const res = await act('godkann_leverabel', f.kropp, f.headers);
      expect(res.status, JSON.stringify(res.body)).toBe(f.status); expect(res.body.error).toBe(f.error);
      expect((await register(a)).find((r) => r.kod === 'L2')!.status).toBe('levererad');
      expect((await underlag(a.projectId)).avtal[0]!.underlag.varde).toEqual([]);
    }
    const b = await nyttAvtal('S', null); await paborja(b, 'L1'); await overlamna(b, 'L1', { mottagare: 'Pia Berg (inköpschef)' });
    const saknas = await act('godkann_leverabel', { ...indata(b, 'L1'), kanal: 'telefon' });
    expect(saknas.status, JSON.stringify(saknas.body)).toBe(409); expect(saknas.body.error).toBe('saknad_mottagare');
    expect((await register(b)).find((r) => r.kod === 'L1')!.status).toBe('levererad');
    expect((await underlag(b.projectId)).avtal[0]!.underlag.varde).toEqual([]);
    await godkann(a, 'L2', { kanal: 'mejl' });
    expect((await underlag(a.projectId)).avtal[0]!.underlag.varde![0]).toMatchObject({ kod: 'L2', godkannande: { kanal: 'mejl', mottagare: 'Styrgruppen' } });
    const karta = await kallor(); expect(skrivbrister(karta)).toEqual([]);
    const planterad = new Map(karta); planterad.set('services/uppdragLage.ts', `${planterad.get('services/uppdragLage.ts')}\nUPDATE uppdrag_leverabel SET status = 'godkand'`);
    expect(skrivbrister(planterad)).not.toEqual([]);
  }, 120_000);
  it.each([
    { namn: 'ett avtal, efter historiken', antal: 1, grans: 'efter_historik' },
    { namn: 'flera avtal, efter historiken', antal: 3, grans: 'efter_historik' },
    { namn: 'flera avtal, före sista registret', antal: 3, grans: 'fore_sista_register' },
    { namn: 'flera avtal, efter sista registret', antal: 3, grans: 'efter_sista_register' },
  ])('4.4-A8 samtidiga godkännanden ger ingen falsk saknasvarning: $namn', async ({ antal, grans }) => {
    const avtal: Avtal[] = [];
    for (let i = 0; i < antal; i++) {
      avtal.push(await nyttAvtal(`Samtidighet ${i}`, PARTER, avtal[0]?.projectId));
    }
    // Samma kod i olika avtal och en annan kod i det sista prövar även att
    // historiken binds till rätt avtal. L4 är godkänd redan före läsningen.
    const mal = avtal.map((a, i) => ({ a, kod: i === 2 ? 'L2' : 'L1' }));
    for (const { a, kod } of mal) { await paborja(a, kod); await overlamna(a, kod); }
    await paborja(avtal[0]!, 'L4'); await overlamna(avtal[0]!, 'L4'); await godkann(avtal[0]!, 'L4');
    for (const { a, kod } of mal) expect((await register(a)).find((r) => r.kod === kod)!.status).toBe('levererad');

    let committat = false;
    let historikfragor = 0;
    const lastaRegister = new Map<string, string[]>();
    async function godkannUnderLasningen() {
      expect(committat).toBe(false);
      for (const { a, kod } of mal) await godkann(a, kod);
      committat = true;
    }
    const u = await withTenantTransaction(user.userId, companyId, async (client) => {
      expect((await client.query('SHOW transaction_isolation')).rows[0].transaction_isolation).toBe('read committed');
      // Samma klientomslag som atomicitetsprovet i faktura-ur-tid: alla
      // frågor och svar går till Postgres. Omslaget pausar bara läsningen
      // medan riktiga HTTP-godkännanden committar på en annan anslutning.
      const synkroniserad = new Proxy(client, {
        get(riktig, prop) {
          if (prop === 'query') return async (text: string, params?: unknown[]) => {
            const arRegister = text.includes('SELECT l.contract_id, l.kod,');
            const arHistorik = text.includes('SELECT DISTINCT ON (h.contract_id, l.kod)');
            if (arRegister && grans === 'fore_sista_register' && lastaRegister.size === antal - 1) {
              await godkannUnderLasningen();
            }
            const svar = await riktig.query(text, params);
            if (arRegister) {
              lastaRegister.set(params![1] as string, (svar.rows as Leverabelrad[])
                .filter((r) => r.status === 'godkand').map((r) => r.kod));
              if (grans === 'efter_sista_register' && lastaRegister.size === antal) await godkannUnderLasningen();
            }
            if (arHistorik) {
              historikfragor++;
              expect(params![1]).toEqual(avtal.map((a) => a.contractId));
              if (grans === 'efter_historik') await godkannUnderLasningen();
            }
            return svar;
          };
          const varde = Reflect.get(riktig, prop) as unknown;
          return typeof varde === 'function' ? varde.bind(riktig) : varde;
        },
      }) as PoolClient;
      return lasFaktureringsunderlag(synkroniserad, companyId, avtal[0]!.projectId);
    });
    expect(committat).toBe(true);
    expect(historikfragor).toBe(1);
    expect(lastaRegister.size).toBe(antal);
    expect(u.avtal).toHaveLength(antal);
    expect(u.avtal.find((a) => a.contract_id === avtal[0]!.contractId)!.underlag.varde!.map((r) => r.kod)).toContain('L4');
    for (const a of u.avtal) {
      // Bara det godkända läge som registerfrågan faktiskt såg får listas.
      // Varje sådan rad ska ha den redan committade godkännandehändelsen.
      expect(a.underlag.varde!.map((r) => r.kod)).toEqual(lastaRegister.get(a.contract_id));
      for (const r of a.underlag.varde!) expect(r.godkannande).toMatchObject({
        dag: '2026-09-20', kanal: 'telefon', mottagare: PARTER.godkannare,
      });
    }
    const efter = await underlag(avtal[0]!.projectId);
    for (const { a, kod } of mal) {
      expect(efter.avtal.find((x) => x.contract_id === a.contractId)!.underlag.varde)
        .toEqual(expect.arrayContaining([expect.objectContaining({ kod, godkannande: expect.objectContaining({ kanal: 'telefon' }) })]));
    }
    const b = block(await projektsida(avtal[0]!.projectId));
    expect(b).toContain('>L4<');
    expect(b).not.toContain(esc(FAKTURA_TEXT.godkannande_saknas));
  }, 120_000);
});

describe('Story 4.4: projektsidan', () => {
  let v1: Avtal; let v2: Avtal; let v3: string; let v4: Avtal;
  beforeAll(async () => {
    v1 = await nyttAvtal('V1');
    await paborja(v1, 'L1'); await overlamna(v1, 'L1'); await godkann(v1, 'L1');
    await paborja(v1, 'L2'); await overlamna(v1, 'L2');
    v2 = await nyttAvtal('V2');
    v3 = (await ok('create_project', { name: 'V3 utan avtal' })).id as string;
    v4 = await nyttAvtal('V4'); await sattStatus(v4, 'L4', 'godkand');
  }, 120_000);
  it('4.4-V1 visar ett block med godkända registervärden, godkännande och färskhet', async () => {
    const sida = await projektsida(v1.projectId); const b = block(sida);
    expect(sida.match(/data-faktureringsunderlag/g)).toHaveLength(1);
    const r = (await underlag(v1.projectId)).avtal[0]!.underlag.varde![0]!;
    expect(r.kod).toBe('L1');
    for (const text of [FAKTURA_TEXT.rubrik, FAKTURA_TEXT.regel, r.namn.text, '2026-09-20', 'telefon', 'Styrgruppen', FAKTURA_TEXT.kalla]) expect(b).toContain(esc(text));
    expect(b).toContain('>L1<'); expect(b).not.toContain('>L2<');
    expect(b).toContain('class="farskhet"'); expect(b).toContain('läst ur redovisningen');
    expect(sida).toContain('aria-labelledby="faktureringsunderlag"');
    expect(b).toContain('id="faktureringsunderlag"');
    expect(b).toMatch(/class="table-wrap"[^>]*tabindex="0"/);
  });
  it('4.4-V2 förklarar att ingen faktura skapas och har inga formulär eller procenttal', async () => {
    const sida = await projektsida(v1.projectId); const b = block(sida);
    expect(b).toContain(esc(FAKTURA_TEXT.ingen_faktura));
    expect(b).not.toMatch(/<(?:form|button|input|select)\b|%/i);
    expect(procentbrister(b.replace(/<[^>]*>/g, ' '))).toEqual([]);
    expect(sida).toContain('>Tidposter</h2>');
  });
  it('4.4-V3 visar ett ärligt tomläge för avtal men inget block utan avtal', async () => {
    const b = block(await projektsida(v2.projectId));
    expect(b).toContain(esc(FAKTURA_TEXT.inga)); expect(b).not.toContain('<table');
    const sida = await projektsida(v3);
    expect(sida).toContain('>Tidposter</h2>'); expect(sida).not.toContain('data-faktureringsunderlag');
  });
  it('4.4-V4 varnar när ett godkänt läge saknar godkännandehändelse', async () => {
    const b = block(await projektsida(v4.projectId));
    expect(b).toContain('>L4<'); expect(b).toContain(esc(FAKTURA_TEXT.godkannande_saknas));
    expect(b).toContain('chip--warn');
  });
});

describe('Story 4.4: dokumentationen', () => {
  const normalisera = (s: string) => s.replace(/\s+/g, ' ');
  function avsnitt(text: string, rubrik: string, slut: RegExp): string {
    const start = text.indexOf(rubrik);
    expect(start).toBeGreaterThanOrEqual(0);
    const resten = text.slice(start + rubrik.length);
    const end = resten.search(slut);
    return rubrik + (end === -1 ? resten : resten.slice(0, end));
  }
  const modulbrister = (s: string) => s.includes('las_faktureringsunderlag');
  it('4.4-D1 dokumenterar läsningen vid fakturan och utanför modulens handgrepp', async () => {
    const docs = await readFile(new URL('../../docs/MCP_ACTIONS.md', import.meta.url), 'utf8');
    const faktura = normalisera(avsnitt(docs, '### Faktura ur godkänd tid', /^#{2,3} /m));
    for (const text of ['`las_faktureringsunderlag` (read)', 'Story 4.4', 'fakturerar aldrig', 'Godkännandet saknas i historiken', 'K5']) expect(faktura).toContain(text);
    const modul = avsnitt(docs, '## Uppdragsytan', /^## /m);
    expect(modul).toContain('godkann_leverabel');
    expect(modulbrister(modul)).toBe(false);
    expect(modulbrister(`${modul}\n- \`las_faktureringsunderlag\``)).toBe(true);
  });
  it('4.4-D2 beskriver läsriktningen och den kvarstående betalningsspärren', async () => {
    const docs = await readFile(new URL('../../docs/ARKITEKTUR.md', import.meta.url), 'utf8');
    const modul = normalisera(avsnitt(docs, '## Uppdragsytan (modul)', /^## /m));
    expect(modul).toContain('Statusflodet (FR-12, FR-13, Story 4.2)');
    for (const text of ['Faktureringsunderlaget (FR-12, Story 4.4)', 'las_faktureringsunderlag', 'fakturerar aldrig', 'K5']) expect(modul).toContain(text);
  });
});
