// Story 4.3, FR-45: nästa leverans följer avtalet och skriver inget tillstånd.
// Ren regel, läsåtgärd och Lägets kort prövas mot samma register; databasfallen
// går genom hela stacken mot Postgres. Frånvaro har positiva och negativa kontroller.
import { readFile } from 'node:fs/promises';
import supertest from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { app, api, createCompany, createFiscalYear, registerUser, withAdmin, type TestUser } from './helpers.js';
import { importeraOchGodkann } from './uppdragImportHelper.js';
import { LEVERANSKONTRAKT_NVR001_V3 } from './fixtures/leveranskontrakt-nvr-001-v3.js';
import type { Leverabelrad } from '../src/services/uppdragRegister.js';
import { visaDatum, type Planrad, type Datumprecision } from '../src/lib/uppdragsplan.js';
import { LUCKTEXT, type Kontraktsmanifest } from '../src/lib/kontraktsluckor.js';
import { faltvarde } from '../src/lib/leverabelfalt.js';
import { nastaLeverans, KANDIDATLAGEN, NASTA_TEXT, type Nastaleverans } from '../src/lib/nastaLeverans.js';
import type { Uppdragslage } from '../src/services/uppdragLage.js';
import { withTenantTransaction } from '../src/db/tx.js';
import { lasKontraktsparter } from '../src/services/uppdragKontrakt.js';
import { loadMigrations } from '../src/db/migrate.js';
import { esc } from '../src/http/view/html.js';

const PARTER = { godkannare: 'Styrgruppen', godkannare_eskalering: 'Eva Larsson (VD)' };
const MANIFEST: Kontraktsmanifest = { kalla: 'projekt.yaml', ...PARTER,
  godkannandeform: 'Telefon eller mejl från Eva Larsson räcker och loggas med datum och kanal' };
type Avtal = { projectId: string; contractId: string };
let user: TestUser;
let companyId: string;
let ua: ReturnType<typeof supertest.agent>;
const auth = () => ({ Authorization: `Bearer ${user.token}` });
const bas = (a: Avtal) => `/app/c/${companyId}/projects/${a.projectId}`;
async function act(namn: string, kropp: Record<string, unknown>) {
  return api.post(`/api/companies/${companyId}/actions/${namn}`).set(auth()).send(kropp);
}
async function ok<T = Record<string, unknown>>(namn: string, kropp: Record<string, unknown>): Promise<T> {
  const r = await act(namn, kropp);
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body.result as T;
}
async function nyttV3(namn: string, manifest: Kontraktsmanifest | null = MANIFEST): Promise<Avtal> {
  const projectId = (await ok('create_project', { name: namn })).id as string;
  const contractId = (await ok('skapa_uppdrag', { project_id: projectId, name: namn, signed_date: '2026-09-07' })).contract_id as string;
  await importeraOchGodkann(companyId, auth(), { contract_id: contractId,
    kontraktstext: LEVERANSKONTRAKT_NVR001_V3, ...(manifest === null ? {} : { manifest }) });
  return { projectId, contractId };
}
const register = (a: Avtal) => ok<Leverabelrad[]>('las_leverabelregister', { contract_id: a.contractId });
async function lage(a: Avtal) {
  const l = await ok<Uppdragslage>('las_uppdragslage', { project_id: a.projectId });
  const avtal = l.avtal.find((v) => v.contract_id === a.contractId);
  expect(avtal).toBeDefined();
  return avtal!;
}
const indata = (a: Avtal) => ({ contract_id: a.contractId, leverabel_kod: 'L1' });
async function overlamna(a: Avtal) {
  await ok('paborja_leverabel', indata(a));
  await ok('bekrafta_statusbyte', { ...indata(a), utfall: 'bekraftad',
    handling: { sort: 'mejl', extern_id: '<nasta-L1@nvr.se>', extern_kalla: 'gmail:locollabs' }, mottagare: 'Pia Berg (inköpschef)' });
}
async function returnera(a: Avtal) {
  await overlamna(a);
  await sattStatus(a, 'L1', 'pagar');
  await ok('bekrafta_statusbyte', { ...indata(a), utfall: 'retur' });
}
async function sattStatus(a: Avtal, kod: string, status: string) {
  await withAdmin((c) => c.query('UPDATE uppdrag_leverabel SET status=$1 WHERE company_id=$2 AND contract_id=$3 AND kod=$4',
    [status, companyId, a.contractId, kod]));
}
function kort(html: string, id = 'kort-leverabler'): string {
  const start = html.indexOf(`aria-labelledby="${id}"`);
  expect(start, `kortet ${id} saknas`).toBeGreaterThan(-1);
  const slut = html.indexOf('</section>', start);
  expect(slut).toBeGreaterThan(start);
  return html.slice(start, slut);
}
function block(kortet: string): string {
  const start = kortet.indexOf('data-nasta-leverans=');
  return start < 0 ? '' : kortet.slice(start, kortet.indexOf('</div>', start));
}
async function laget(a: Avtal) {
  const r = await ua.get(`${bas(a)}/laget`);
  expect(r.status, r.text).toBe(200);
  return { html: r.text, kort: kort(r.text), block: block(kort(r.text)) };
}
beforeAll(async () => {
  user = await registerUser('nastaleverans');
  companyId = await createCompany(user.token, 'Nästa leverans AB');
  await createFiscalYear(companyId, auth(), { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });
  ua = supertest.agent(app);
  const login = await ua.post('/app/login').type('form').send({ email: user.email, password: 'mycket-hemligt-losen-123' });
  expect([302, 303]).toContain(login.status);
});

function rad(kod: string, status = 'ej_paborjad', over: Partial<Leverabelrad> = {}): Leverabelrad {
  return { contract_id: '11111111-1111-4111-8111-111111111111', kod, status, namn: `Leverabel ${kod}`,
    acceptanskriterium: `Kriterium ${kod}`, klausul: null, uppfoljningsmatt: null, matt_lasvag: null,
    revision: null, mottagare: null, overlamnad: null, dagar_i_laget: 0, ...over };
}
function planrad(kod: string, slut: string | null, arvd = true, fran = 'STEG1', precision: Datumprecision = 'dag'): Planrad {
  return { id: kod, contract_id: rad(kod).contract_id, code: kod, name: `Leverabel ${kod}`,
    start_date: null, end_date: null, date_precision: null, stapel: slut === null ? null : {
      start: 1, span: 1, arvd, precision, kalla_kod: fran, start_date: '2026-01-01', end_date: slut,
    } };
}
// Samla även kantfallens faktiska svar, så textkontrollen täcker N1–N7.
const regelsvar: Nastaleverans[] = [];
function berakna(register: Leverabelrad[], plan: Planrad[] = [], parter = PARTER as {
  godkannare: string | null; godkannare_eskalering: string | null;
}) {
  const n = nastaLeverans({ register, plan, parter });
  regelsvar.push(n);
  return n;
}
function nasta(n: Nastaleverans) {
  expect(n.lage).toBe('nasta');
  if (n.lage !== 'nasta') throw new Error('Nästa leverans saknas');
  return n;
}
const arvt = (kod: string) => NASTA_TEXT.arvt.replace('{kod}', kod);
const revisionstext = (n: number) => NASTA_TEXT.nasta_revision.replace('{n}', String(n));
const importlista = (s: string) => [...new Set([...s.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]))].sort();
const tillatnaImporter = ['../services/uppdragRegister.js', './leverabelfalt.js', './kontraktsluckor.js', './uppdragsplan.js'].sort();
const otillatenText = /%|\b(procent|andel|klart)\b/i;

describe('Story 4.3: regeln', () => {
  it('4.3-N1: bara kandidatlägen kan väljas, och tomt skiljs från överlämnat', () => {
    expect(KANDIDATLAGEN).toEqual(['ej_paborjad', 'pagar', 'avvisad']);
    for (const status of ['ej_paborjad', 'pagar', 'levererad', 'godkand', 'avvisad', 'okant']) {
      const n = nasta(berakna([rad('L1', status), rad('L2')], [planrad('L1', '2026-09-01'), planrad('L2', '2026-10-01')]));
      expect(n.kod).toBe((KANDIDATLAGEN as readonly string[]).includes(status) ? 'L1' : 'L2');
    }
    expect(berakna([rad('L1', 'levererad'), rad('L2', 'godkand')])).toEqual({ lage: 'ingen', orsak: 'allt_overlamnat', text: NASTA_TEXT.ingen });
    expect(berakna([])).toEqual({ lage: 'ingen', orsak: 'tomt_register', text: '' });
  });
  it('4.3-N2: eget och ärvt intervall jämförs på slut, med stapelns precision', () => {
    const r = [rad('L1'), rad('L2')];
    let n = nasta(berakna(r, [planrad('L1', '2026-10-01', false, 'L1'), planrad('L2', '2026-09-13')]));
    expect(n.kod).toBe('L2');
    expect(n.datum).toMatchObject({ arvd: true, kalla_kod: 'STEG1', precision: 'dag', text: `${visaDatum('2026-09-13', 'dag')}, ${arvt('STEG1')}` });
    n = nasta(berakna(r, [planrad('L1', '2026-09-01', false, 'L1'), planrad('L2', '2026-09-13')]));
    expect(n.kod).toBe('L1');
    expect(n.datum).toMatchObject({ arvd: false, kalla_kod: 'L1', text: visaDatum('2026-09-01', 'dag') });
    n = nasta(berakna([rad('L1')], [planrad('L1', '2026-02-28', true, 'STEG1', 'manad')]));
    expect(n.datum.precision).toBe('manad');
    expect(n.datum.text).toBe(`${visaDatum('2026-02-28', 'manad')}, ${arvt('STEG1')}`);
    expect(n.datum.text).not.toContain('2026-02-28');
  });
  it('4.3-N3: lika slut bryts av numeriskt L-nummer utan mutation', () => {
    for (const koder of [['L3', 'L2'], ['L10', 'L2'], ['L2', 'L10']]) {
      const r = koder.map((kod) => rad(kod));
      const p = koder.map((kod) => planrad(kod, '2026-11-01'));
      const fore = structuredClone({ r, p });
      expect(nasta(berakna(r, p)).kod).toBe('L2');
      expect({ r, p }).toEqual(fore);
    }
  });
  it('4.3-N4: odaterade sist, numrerade före övriga och datum saknas sägs', () => {
    expect(nasta(berakna([rad('L1'), rad('L9')], [planrad('L9', '2026-12-31')])).kod).toBe('L9');
    const n = nasta(berakna([rad('L3'), rad('L2')], [planrad('L3', null), planrad('L2', null)]));
    expect(n.kod).toBe('L2');
    expect(n.datum).toEqual({ slut: null, precision: null, arvd: false, kalla_kod: null, text: NASTA_TEXT.datum_saknas, kalla: 'baselinen' });
    expect(nasta(berakna([rad('STYRNING'), rad('L7')])).kod).toBe('L7');
    expect(nasta(berakna([rad('ÖVRIGT'), rad('ANNAT')])).kod).toBe('ANNAT');
  });
  it('4.3-N5: första mottagaren kommer ur kontraktet, saknat gissas aldrig', () => {
    const n = nasta(berakna([rad('L1')]));
    expect(n.mottagare).toMatchObject({ varde: PARTER.godkannare, eskalering: PARTER.godkannare_eskalering, kalla: 'kontraktet', markning: NASTA_TEXT.ur_kontraktet });
    expect(n.mottagare.text).toContain(PARTER.godkannare);
    expect(n.mottagare.text).toContain(PARTER.godkannare_eskalering);
    expect(n.revision).toEqual({ registrerad: null, nasta: 1, text: revisionstext(1), kalla: 'registret' });
    for (const godkannare of [null, '   ']) {
      expect(nasta(berakna([rad('L1')], [], { godkannare, godkannare_eskalering: null })).mottagare)
        .toMatchObject({ varde: null, text: LUCKTEXT.mottagarpart.vad });
    }
  });
  it('4.3-N6: avvisad visar överlämningens mottagare och nästa revision', () => {
    const r = rad('L1', 'avvisad', { revision: 1, mottagare: 'Pia Berg (inköpschef)' });
    const n = nasta(berakna([r]));
    expect(n.mottagare).toMatchObject({ varde: r.mottagare, kalla: 'overlamningen', eskalering: null,
      markning: NASTA_TEXT.ur_overlamningen.replace('{n}', '1'), text: r.mottagare });
    expect(n.mottagare.text).not.toContain(PARTER.godkannare);
    expect(n.revision).toEqual({ registrerad: 1, nasta: 2, text: revisionstext(2), kalla: 'registret' });
    const saknat = rad('L1', 'avvisad', { revision: 1, mottagare: null });
    const f = faltvarde(saknat, 'mottagare');
    expect(f.lage).toBe('saknas');
    if (f.lage !== 'saknas') throw new Error('Fel förutsättning');
    expect(nasta(berakna([saknat])).mottagare).toMatchObject({ varde: null, text: f.text });
  });
  it('4.3-N7: registerfält är ordagranna eller använder luckornas text', () => {
    for (const kriterium of ['Kriterium & villkor <ordagrant>', '  ', null]) {
      const n = nasta(berakna([rad('L1', 'ej_paborjad', { acceptanskriterium: kriterium })]));
      const v = kriterium?.trim() ? kriterium : null;
      expect(n.acceptanskriterium).toEqual({ varde: v, text: v ?? LUCKTEXT.acceptanskriterium.vad, kalla: 'registret' });
    }
    expect(nasta(berakna([rad('L1', 'ej_paborjad', { namn: null })])).namn)
      .toEqual({ varde: null, text: LUCKTEXT.namn.vad, kalla: 'registret' });
  });
  it('4.3-N8: sluten importlista, ingen klocka och samma svar på samma indata', async () => {
    const s = await readFile(new URL('../src/lib/nastaLeverans.ts', import.meta.url), 'utf8');
    expect(importlista(s)).toEqual(tillatnaImporter);
    expect(s).toMatch(/import type\s*\{\s*Leverabelrad\s*\}\s*from/);
    for (const forbjudet of ['process.env', 'new Date', 'Date.now']) expect(s).not.toContain(forbjudet);
    expect(berakna([rad('L1')])).toEqual(berakna([rad('L1')]));
    expect(importlista(`${s}\nimport { withTenantTransaction } from '../db/tx.js';`)).not.toEqual(tillatnaImporter);
  });
  it('4.3-N9: beskedet använder inga förbjudna lägesuttryck', () => {
    expect(regelsvar.length).toBeGreaterThan(20);
    for (const n of regelsvar) expect(JSON.stringify(n)).not.toMatch(otillatenText);
    for (const t of [...Object.values(NASTA_TEXT).filter((v) => typeof v === 'string'), ...Object.values(NASTA_TEXT.kallor)]) {
      expect(t).not.toMatch(otillatenText);
    }
    expect(NASTA_TEXT.ordning).toContain('ingen prioritering');
    expect('45 % klart').toMatch(otillatenText);
  });
});

describe('Story 4.3: läsvägen', () => {
  it('4.3-A1: NVR-001 börjar med L1, kontraktsmottagare och källa per värde', async () => {
    const a = await nyttV3('A1');
    const r = await register(a);
    expect(r).toHaveLength(6);
    expect(r.every((v) => v.status === 'ej_paborjad')).toBe(true);
    const l = await ok<Uppdragslage>('las_uppdragslage', { project_id: a.projectId });
    const last = l.avtal[0]!.nasta_leverans;
    expect(last).toMatchObject({ lage: 'last', kalla: 'redovisning' });
    expect(Number.isNaN(Date.parse(last.last_nar!))).toBe(false);
    expect(l.farskhet.nasta_leverans).toEqual({ kalla: 'redovisning', last_nar: last.last_nar });
    const n = nasta(last.varde!);
    expect(n).toMatchObject({ kod: 'L1', status: 'ej_paborjad',
      datum: { slut: '2026-09-13', precision: 'dag', arvd: true, kalla_kod: 'STEG1', kalla: 'baselinen' },
      acceptanskriterium: { varde: r.find((v) => v.kod === 'L1')!.acceptanskriterium, kalla: 'registret' },
      mottagare: { varde: PARTER.godkannare, eskalering: PARTER.godkannare_eskalering, kalla: 'kontraktet', markning: NASTA_TEXT.ur_kontraktet },
      revision: { registrerad: null, nasta: 1, kalla: 'registret' }, namn: { kalla: 'registret' } });
    const kallor = [n.namn.kalla, n.acceptanskriterium.kalla, n.datum.kalla, n.mottagare.kalla, n.revision.kalla];
    for (const k of kallor) expect(['registret', 'baselinen', 'kontraktet', 'overlamningen']).toContain(k);
  });
  it('4.3-A2: godkänd L1 ger L2 före L3 vid samma slut', async () => {
    const a = await nyttV3('A2');
    await sattStatus(a, 'L1', 'godkand');
    expect(nasta((await lage(a)).nasta_leverans.varde!)).toMatchObject({ kod: 'L2', datum: { slut: '2026-11-01', kalla_kod: 'STEG2' } });
    await sattStatus(a, 'L2', 'godkand');
    expect(nasta((await lage(a)).nasta_leverans.varde!)).toMatchObject({ kod: 'L3', datum: { slut: '2026-11-01', kalla_kod: 'STEG2' } });
  }, 120_000);
  it('4.3-A3: returnerad L1 bär den faktiska överlämningen och nästa revision', async () => {
    const a = await nyttV3('A3');
    await returnera(a);
    expect((await register(a)).find((v) => v.kod === 'L1')).toMatchObject({ revision: 1, mottagare: 'Pia Berg (inköpschef)', status: 'avvisad' });
    expect(nasta((await lage(a)).nasta_leverans.varde!)).toMatchObject({ kod: 'L1', status: 'avvisad',
      mottagare: { varde: 'Pia Berg (inköpschef)', kalla: 'overlamningen' },
      revision: { registrerad: 1, nasta: 2, text: revisionstext(2) } });
  }, 120_000);
  it('4.3-A4: levererad L1 läcker inte sin mottagare eller revision till L2', async () => {
    const a = await nyttV3('A4');
    await overlamna(a);
    expect((await register(a)).find((v) => v.kod === 'L1')).toMatchObject({ revision: 1, mottagare: 'Pia Berg (inköpschef)', status: 'levererad' });
    const n = nasta((await lage(a)).nasta_leverans.varde!);
    expect(n).toMatchObject({ kod: 'L2', mottagare: { kalla: 'kontraktet' } });
    expect(JSON.stringify(n)).not.toContain('Pia Berg');
    expect(JSON.stringify(n)).not.toContain('revision 2');
  }, 120_000);
  it('4.3-A5: upprepad läsning skriver inget tillstånd, kolumn eller migration', async () => {
    const a = await nyttV3('A5');
    const l = await ok<Uppdragslage>('las_uppdragslage', { project_id: a.projectId });
    expect(l.farskhet.nasta_leverans).toBeDefined();
    const snapshot = () => withAdmin(async (c) => ({
      approvals: (await c.query('SELECT count(*) FROM action_approvals WHERE company_id=$1', [companyId])).rows,
      handelser: (await c.query('SELECT count(*) FROM uppdrag_leverabel_handelse WHERE company_id=$1 AND contract_id=$2', [companyId, a.contractId])).rows,
      leverabler: (await c.query('SELECT kod,status FROM uppdrag_leverabel WHERE company_id=$1 AND contract_id=$2 ORDER BY kod', [companyId, a.contractId])).rows,
      cache: (await c.query('SELECT nyckel FROM uppdrag_svepvarde WHERE company_id=$1 AND contract_id=$2 ORDER BY nyckel', [companyId, a.contractId])).rows,
    }));
    const fore = await snapshot();
    await lage(a); await lage(a); await laget(a);
    expect(await snapshot()).toEqual(fore);
    const columns = await withAdmin(async (c) => (await c.query<{ table_name: string; column_name: string }>(
      'SELECT table_name,column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name=ANY($2::text[])',
      ['public', ['uppdrag_leverabel', 'uppdrag_leverabel_handelse', 'contracts', 'contract_parts']],
    )).rows);
    expect(columns).toContainEqual({ table_name: 'uppdrag_leverabel', column_name: 'status' });
    expect(columns.filter((v) => v.column_name.includes('nasta'))).toEqual([]);
    const migrations = await loadMigrations();
    expect(migrations.length).toBeGreaterThan(0);
    expect(migrations.filter((v) => v.filename.includes('nasta'))).toEqual([]);
  });
  it('4.3-A6: kontrakt utan manifest har en uttryckligt saknad mottagarpart', async () => {
    const a = await nyttV3('A6', null);
    const parter = await withTenantTransaction(user.userId, companyId, (c) => lasKontraktsparter(c, companyId, a.contractId));
    expect(parter.godkannare).toBeNull();
    expect(nasta((await lage(a)).nasta_leverans.varde!).mottagare)
      .toMatchObject({ varde: null, kalla: 'kontraktet', text: LUCKTEXT.mottagarpart.vad });
  });
  it('4.3-A7: tomt register och allt överlämnat är skilda besked', async () => {
    const projectId = (await ok('create_project', { name: 'A7 tomt' })).id as string;
    const contractId = (await ok('skapa_uppdrag', { project_id: projectId, name: 'A7 tomt', signed_date: '2026-09-07' })).contract_id as string;
    expect((await lage({ projectId, contractId })).nasta_leverans.varde).toMatchObject({ lage: 'ingen', orsak: 'tomt_register' });
    const a = await nyttV3('A7 överlämnat');
    const r = await register(a);
    expect(r).toHaveLength(6);
    for (const [i, v] of r.entries()) await sattStatus(a, v.kod, i < 3 ? 'levererad' : 'godkand');
    expect((await lage(a)).nasta_leverans.varde).toMatchObject({ lage: 'ingen', orsak: 'allt_overlamnat' });
  }, 120_000);
});

describe('Story 4.3: Läget', () => {
  let p: Avtal, q: Avtal, r: Avtal, s: Avtal, t: Avtal;
  beforeAll(async () => {
    p = await nyttV3('V P');
    q = await nyttV3('V Q'); await sattStatus(q, 'L1', 'godkand');
    r = await nyttV3('V R'); await returnera(r);
    s = await nyttV3('V S', null);
    t = await nyttV3('V T');
    for (const v of await register(t)) await sattStatus(t, v.kod, 'godkand');
  }, 120_000);
  it('4.3-V1: kortet visar L1 med datum, registerfält och första mottagaren', async () => {
    const v = await laget(p);
    const l1 = (await register(p)).find((v) => v.kod === 'L1')!;
    expect(v.kort.match(/data-nasta-leverans=/g)).toHaveLength(1);
    for (const text of [NASTA_TEXT.rubrik, '>L1<', esc(l1.namn!), '2026-09-13', 'STEG1',
      esc(l1.acceptanskriterium!), esc(PARTER.godkannare), esc(PARTER.godkannare_eskalering), NASTA_TEXT.ur_kontraktet, revisionstext(1)]) {
      expect(v.block).toContain(text);
    }
  });
  it('4.3-V2: godkänd L1 ger L2 med ärvt STEG2-intervall', async () => {
    const v = await laget(q);
    for (const text of ['>L2<', '2026-11-01', arvt('STEG2')]) expect(v.block).toContain(text);
    expect(v.block).not.toContain('>L1<');
  });
  it('4.3-V3: avvisad L1 visar överlämningens mottagare och revision', async () => {
    const v = await laget(r);
    for (const text of ['>L1<', esc('Pia Berg (inköpschef)'), 'revision 1', revisionstext(2)]) expect(v.block).toContain(text);
    expect(v.block).not.toContain(NASTA_TEXT.ur_kontraktet);
  });
  it('4.3-V4: beskedet är läsning med källor och befintlig kortstruktur', async () => {
    const v = await laget(p);
    for (const text of [NASTA_TEXT.ordning, NASTA_TEXT.kallor.registret, NASTA_TEXT.kallor.baselinen, NASTA_TEXT.kallor.kontraktet]) expect(v.block).toContain(text);
    expect(v.block.length).toBeGreaterThan(0);
    for (const text of ['<form', '<button', '<input', '<select', '<section', 'id=', '%']) expect(v.block).not.toContain(text);
    expect(v.kort.match(/class="farskhet"/g)).toHaveLength(1);
    const farskhet = v.kort.slice(v.kort.indexOf('class="farskhet"'));
    expect(farskhet).toContain('nästa leverans');
    expect(farskhet).toContain('läst ur redovisningen');
    expect(v.html.match(/id="handgrepp"/g)).toHaveLength(1);
    const start = v.html.indexOf('id="handgrepp"');
    const band = v.html.slice(start, v.html.indexOf('</section>', start));
    expect(band).not.toContain(NASTA_TEXT.rubrik);
    expect(band).not.toContain('>L1<');
    for (const id of ['kort-ram', 'kort-leverabler', 'kort-bedomning', 'kort-signaler', 'kort-koposter']) expect(v.html).toContain(`aria-labelledby="${id}"`);
  });
  it('4.3-V5: saknad mottagarpart och allt överlämnat får tydliga tomlägen', async () => {
    const saknad = await laget(s);
    expect(saknad.block).toContain(LUCKTEXT.mottagarpart.vad);
    expect(saknad.block).toContain(NASTA_TEXT.ur_kontraktet);
    const ingen = await laget(t);
    expect(ingen.kort).toContain(NASTA_TEXT.ingen);
    expect(ingen.kort).toContain(`href="${bas(t)}/leveranserna"`);
    expect(ingen.block.length).toBeGreaterThan(0);
    expect(ingen.block).not.toContain('>L1<');
    const nakenNolla = (html: string) => /\b0\b/.test(html.replace(/<[^>]*>/g, ' '));
    expect(nakenNolla(ingen.block)).toBe(false);
    expect(nakenNolla('<p>Leverabler: <strong>0</strong></p>')).toBe(true);
  });
});

function dokumentavsnitt(s: string, rubrik: string): string {
  const rader = s.split(/\r?\n/);
  const start = rader.indexOf(rubrik);
  expect(start, `Rubriken saknas: ${rubrik}`).toBeGreaterThan(-1);
  // Sök först EFTER hela öppningsraden. En underrubrik hör till avsnittet;
  // nästa rubrik på samma eller högre nivå avslutar det.
  const grans = new RegExp(`^#{1,${rubrik.indexOf(' ')}} `);
  const slut = rader.findIndex((rad, index) => index > start && grans.test(rad));
  return rader.slice(start, slut < 0 ? undefined : slut).join('\n');
}

describe('Story 4.3: dokumentationen', () => {
  it('4.3-D1: Lägets läsåtgärd beskriver beskedet utan falska åtgärdsnamn', async () => {
    // Samma avgränsning för delavsnittet och hela Uppdragsytan. Text i en
    // granne får varken uppfylla ett innehållskrav eller utlösa en falsk brist.
    for (const rubrik of ['## Uppdragsytan', '### Läget (S10.1, våg 6)']) {
      for (const radslut of ['\n', '\r\n']) {
        const innehall = [rubrik, 'Beskedet', `#${rubrik} — detaljer`, 'Egen text'];
        for (const granne of ['# Nästa dokument', '## Nästa område', '### Nästa yta', '']) {
          if (rubrik.startsWith('## ') && granne.startsWith('### ')) continue;
          const text = [`Se ${rubrik}`, `${rubrik} — annan rubrik`, 'Föregående text',
            ...innehall, ...(granne ? [granne, 'Grannens text'] : [])].join(radslut);
          const avsnitt = dokumentavsnitt(text, rubrik).replace(/\r/g, '').trimEnd();
          expect(avsnitt).toBe(innehall.join('\n'));
          expect(avsnitt).not.toContain('Grannens text');
        }
      }
    }
    const s = await readFile(new URL('../../docs/MCP_ACTIONS.md', import.meta.url), 'utf8');
    const laget = dokumentavsnitt(s, '### Läget (S10.1, våg 6)').replace(/\s+/g, ' ');
    for (const text of ['Nästa leverans (Story 4.3, FR-45)', 'nastaLeverans', 'avtal[].nasta_leverans',
      'ur kontraktet, ingen överlämning ännu', 'nästa överlämning blir revision 1']) expect(laget).toContain(text);
    const uppdrag = dokumentavsnitt(s, '## Uppdragsytan');
    const namn = ['nasta_leverans', 'tomt_register', 'allt_overlamnat', 'datum_saknas',
      'ur_kontraktet', 'ur_overlamningen', 'nasta_revision', 'kalla_kod'];
    const ensammaSpann = (s: string) => new Set([...s.matchAll(/`([a-z]+(?:_[a-z]+)+)`/g)].map((m) => m[1]!));
    const brister = (s: string) => namn.filter((n) => ensammaSpann(s).has(n));
    expect(ensammaSpann(uppdrag).size).toBeGreaterThan(0);
    expect(brister(uppdrag)).toEqual([]);
    expect(brister(`${uppdrag}\n\`nasta_leverans\``)).toContain('nasta_leverans');
    expect(brister(`${uppdrag}\n\`kalla_kod\``)).toContain('kalla_kod');
  });
});
