// Story 1.11 (NFR-8, B-3): KANONENS MARKERING på uppdragsytans sidor.
//
// Kanon markerade huvudmenyns post med `aria-current="location"` så snart en
// sida visade ett objekt (Astras matchningsregel 6). Uppdragsytans sidor — de
// som bär uppdragets `.subnav`, undantagsvyn och listan — sätter nu valet
// `markering: 'page'`, så att helmenyn och snabbraden har exakt en
// `aria-current="page"` var. Provet täcker fyra risker:
//
//  * **En modulsida med `location`** — i helmenyn, snabbraden eller någon
//    annanstans på sidan. Det planterade felet i AC 3 (M0 (b)) fäller provet.
//  * **En navigation med noll eller två markeringar.** `aria-current` gäller
//    per navigation (WCAG 2.4.8), så varje meny mäts för sig: helmenyn,
//    snabbraden och varje `.subnav`.
//  * **Markering där den inte hör hemma:** i kontoraden, i brödsmulan eller i
//    resten av huvudmenyn (`nav__omrade`, `nav__here`). Brödsmulans sista led är
//    sidan man står på, alltid `<b>` och aldrig en länk.
//  * **En ändring som läcker till övriga produkter.** Kvitton, en tidpost och
//    ett projekt utan avtal renderas som före ändringen (M4).
//
// Sidorna HÄRLEDS ur den renderade undermenyn på Läget (elva länkar), inte ur
// en handskriven lista (`project-context.md`, "Prov härleds"). Kontrollen
// `markeringsbrister` är en ren funktion av sidan, och den prövas först mot
// planterade fel (M0 (b)–(e)) så att ett grönt svar betyder något.
import supertest from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { LEVERANSKONTRAKT_NVR001 } from './fixtures/leveranskontrakt-nvr-001.js';
import { importeraOchGodkann } from './uppdragImportHelper.js';
import { api, app, createCompany, createFiscalYear, registerUser, type TestUser } from './helpers.js';
import { uppdragsdestination } from './undantagsvynRigg.js';

const PASSWORD = 'mycket-hemligt-losen-123';

let user: TestUser;
let companyId: string;
let projektId: string;
/** Ett projekt UTAN avtal: Projekt-produktens sida, ingen uppdragssida. */
let avtalslostProjekt: string;
let tidpostId: string;
let ua: ReturnType<typeof supertest.agent>;

const auth = () => ({ Authorization: `Bearer ${user.token}` });

async function ok(namn: string, kropp: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await api.post(`/api/companies/${companyId}/actions/${namn}`).set(auth()).send(kropp);
  expect(res.status, `${namn}: ${JSON.stringify(res.body)}`).toBe(200);
  return res.body.result as Record<string, unknown>;
}

/** En inloggad människas sida. */
async function sida(path: string): Promise<string> {
  const res = await ua.get(path);
  expect(res.status, `${path} gav ${res.status}`).toBe(200);
  return res.text;
}

const uppdragsbas = (projekt = projektId): string => `/app/c/${companyId}/projects/${projekt}`;

// --- Kontrollen ---------------------------------------------------------------

/** Ett utsnitt [start, slut) ur sidan, eller null när starten saknas. */
type Utsnitt = { i: number; j: number; text: string };

function utsnitt(html: string, start: string, slut: string, fran = 0): Utsnitt | null {
  const i = html.indexOf(start, fran);
  if (i === -1) return null;
  const j = html.indexOf(slut, i);
  if (j === -1) return null;
  return { i, j: j + slut.length, text: html.slice(i, j + slut.length) };
}

const HELMENYN = ['<details class="navmenu">', '</details>'] as const;
const SNABBRADEN = ['<div class="nav__quick">', '</div>'] as const;
const HUVUDMENYN = ['<nav class="nav" aria-label="Huvudmeny">', '</nav>'] as const;
const KONTORADEN = ['<nav class="nav nav--konto"', '</nav>'] as const;
const SMULAN = ['<nav class="smula"', '</nav>'] as const;
const UNDERMENYN = ['<nav class="subnav"', '</nav>'] as const;

const markeringar = (s: string): string[] =>
  [...s.matchAll(/aria-current="([^"]*)"/g)].map((m) => m[1]!);

/**
 * Bristerna i sidans markering, en rad per brist. Varje rad namnger
 * navigationen den gäller. Med `modulsida = false` prövas bara antalet,
 * kontoraden, brödsmulan och undermenyerna; värdet på övriga produkters sidor
 * prövar M4 för sig.
 */
function markeringsbrister(html: string, modulsida: boolean): string[] {
  const brister: string[] = [];
  const helmenyn = utsnitt(html, ...HELMENYN);
  const snabbraden = utsnitt(html, ...SNABBRADEN);
  const huvudmenyn = utsnitt(html, ...HUVUDMENYN);
  if (!helmenyn) brister.push('helmenyn saknas');
  if (!snabbraden) brister.push('snabbraden saknas');
  if (!huvudmenyn) brister.push('huvudmenyn saknas');

  for (const [namn, nav] of [['helmenyn', helmenyn], ['snabbraden', snabbraden]] as const) {
    if (!nav) continue;
    const m = markeringar(nav.text);
    if (m.length !== 1) brister.push(`${namn} har ${m.length} aria-current, inte exakt en`);
    if (modulsida && m.some((v) => v !== 'page')) brister.push(`${namn} markerar med ${m.join(', ')}, inte page`);
  }

  if (modulsida && html.includes('aria-current="location"')) {
    brister.push('sidan bär aria-current="location" — en modulsida markerar med page');
  }

  if (modulsida && huvudmenyn) {
    // Resten av huvudmenyn: allt utom helmenyn och snabbraden (nav__omrade, nav__here).
    let rest = huvudmenyn.text;
    for (const nav of [helmenyn, snabbraden]) if (nav) rest = rest.replace(nav.text, '');
    const m = markeringar(rest);
    if (m.length > 0) brister.push(`resten av huvudmenyn (nav__omrade, nav__here) bär ${m.length} aria-current`);
  }

  const kontoraden = utsnitt(html, ...KONTORADEN);
  if (kontoraden && markeringar(kontoraden.text).length > 0) brister.push('kontoraden bär aria-current');

  const smulan = utsnitt(html, ...SMULAN);
  if (!smulan) {
    brister.push('brödsmulan saknas');
  } else {
    if (markeringar(smulan.text).length > 0) brister.push('brödsmulan bär aria-current');
    if (!/<b>[^<]*<\/b>\s*<\/nav>$/.test(smulan.text)) brister.push('brödsmulans sista led är inte <b>');
  }

  let fran = 0;
  for (;;) {
    const sub = utsnitt(html, UNDERMENYN[0], UNDERMENYN[1], fran);
    if (!sub) break;
    const m = markeringar(sub.text);
    if (m.length !== 1 || m[0] !== 'page') {
      brister.push(`en .subnav har ${m.length} aria-current (${m.join(', ')}), inte exakt en page`);
    }
    fran = sub.j;
  }
  return brister;
}

/** Byt ut ett utsnitt i sidan — för de planterade felen. */
function plantera(html: string, nav: readonly [string, string], byt: (s: string) => string): string {
  const u = utsnitt(html, nav[0], nav[1]);
  expect(u, `${nav[0]} saknas — felet kan inte planteras`).not.toBeNull();
  const ny = byt(u!.text);
  expect(ny, `planteringen i ${nav[0]} ändrade ingenting`).not.toBe(u!.text);
  return html.slice(0, u!.i) + ny + html.slice(u!.j);
}

/** Den markerade länken i en navigation: dess värde och destinations-id. */
function markerad(html: string, nav: readonly [string, string]): { varde: string; id: string }[] {
  const u = utsnitt(html, nav[0], nav[1]);
  expect(u, `${nav[0]} saknas`).not.toBeNull();
  return [...u!.text.matchAll(/aria-current="(page|location)" data-destination-id="([^"]+)"/g)]
    .map((m) => ({ varde: m[1]!, id: m[2]! }));
}

// --- Riggen (samma som uppdragsytan-menyn.test.ts) --------------------------

beforeAll(async () => {
  user = await registerUser('markering');
  companyId = await createCompany(user.token, 'Locollabs AB');
  await createFiscalYear(companyId, auth(), { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });

  projektId = (await ok('create_project', { name: 'NVR-001 Fas 2' })).id as string;
  const avtalId = (await ok('skapa_uppdrag', {
    project_id: projektId, name: 'Leveranskontrakt NVR-001', signed_date: '2026-09-03',
  })).contract_id as string;
  await importeraOchGodkann(companyId, auth(), { contract_id: avtalId, kontraktstext: LEVERANSKONTRAKT_NVR001 });

  avtalslostProjekt = (await ok('create_project', { name: 'Bara ett projekt' })).id as string;
  tidpostId = (await ok('log_time', {
    project_id: avtalslostProjekt, work_date: '2026-09-01', minutes: 60, description: 'Markeringsprov',
  })).id as string;

  ua = supertest.agent(app);
  const login = await ua.post('/app/login').type('form').send({ email: user.email, password: PASSWORD });
  expect([302, 303]).toContain(login.status);
});

// ---------------------------------------------------------------------------
// M0: kontrollen själv — mot en riktig sida och mot planterade fel
// ---------------------------------------------------------------------------

describe('M0 markeringsbrister', () => {
  it('(a) Läget, en modulsida MED objekt, har inga brister', async () => {
    expect(markeringsbrister(await sida(`${uppdragsbas()}/laget`), true)).toEqual([]);
  });

  it('(b)–(e) fäller varje planterat fel och namnger navigationen', async () => {
    // Leveranserna går genom pageFor utan objekt och har page redan före
    // ändringen: den är kontrollen som visar att utgångsläget är rent.
    const ren = await sida(`${uppdragsbas()}/leveranserna`);
    expect(markeringsbrister(ren, true)).toEqual([]);

    // (b) AC 3:s planterade fel: helmenyns page utbytt mot location.
    const b = plantera(ren, HELMENYN, (s) => s.replace('aria-current="page"', 'aria-current="location"'));
    const bb = markeringsbrister(b, true);
    expect(bb.length).toBeGreaterThan(0);
    expect(bb.some((r) => r.startsWith('helmenyn')), bb.join(' | ')).toBe(true);

    // (c) Snabbraden utan markering.
    const c = plantera(ren, SNABBRADEN, (s) => s.replace(' aria-current="page"', ''));
    const bc = markeringsbrister(c, true);
    expect(bc.some((r) => r.startsWith('snabbraden')), bc.join(' | ')).toBe(true);

    // (d) En markering i brödsmulan.
    const d = plantera(ren, SMULAN, (s) =>
      s.replace('aria-label="Var du är">', 'aria-label="Var du är"><a href="#" aria-current="page">x</a>'));
    const bd = markeringsbrister(d, true);
    expect(bd.some((r) => r.startsWith('brödsmulan')), bd.join(' | ')).toBe(true);

    // (e) En andra page i undermenyn.
    const e = plantera(ren, UNDERMENYN, (s) => s.replace('<a href=', '<a aria-current="page" href='));
    const be = markeringsbrister(e, true);
    expect(be.some((r) => r.startsWith('en .subnav')), be.join(' | ')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// M1: varje befintlig objektsida i modulen, härledd ur undermenyn
// ---------------------------------------------------------------------------

describe('M1 modulens objektsidor', () => {
  it('varje sida i Lägets undermeny har page i helmenyn och snabbraden, och inga brister', async () => {
    const laget = await sida(`${uppdragsbas()}/laget`);
    const sub = utsnitt(laget, ...UNDERMENYN);
    expect(sub, 'Läget saknar undermeny').not.toBeNull();
    const vagar = [...sub!.text.matchAll(/href="([^"]+)"/g)].map((m) => m[1]!);
    expect(vagar).toHaveLength(11);
    for (const vag of vagar) {
      const html = await sida(vag);
      expect(markeringsbrister(html, true), vag).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------
// M2: Avtals två POST-omritningar
// ---------------------------------------------------------------------------

describe('M2 Avtals omritningar', () => {
  it('las-in utan fil ritar om sidan med page', async () => {
    const res = await ua.post(`${uppdragsbas()}/avtal/las-in`).type('form').send({});
    expect(res.status, res.text.slice(0, 300)).toBe(200);
    expect(res.text).toContain('Ingen fil bifogad.');
    expect(markeringsbrister(res.text, true)).toEqual([]);
  });

  it('skapa med en halv fasrad ritar om sidan med page', async () => {
    const res = await ua.post(`${uppdragsbas()}/avtal/skapa`).type('form')
      .send({ name: 'Avtal M2', part_code: 'F1', part_name: '' });
    expect(res.status, res.text.slice(0, 300)).toBe(200);
    expect(res.text).toContain('Varje fas behöver både en kod och ett namn');
    expect(markeringsbrister(res.text, true)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// M3: undantagsvyn och listan markerar kontraktets ägare till rutten
// ---------------------------------------------------------------------------

describe('M3 ingången', () => {
  it('/uppdrag och /uppdrag/lista markerar kontraktets ägare till GET /c/:companyId/uppdrag med page', async () => {
    // Läst ur kontraktsfilen av provet självt: projects_list före synken,
    // ingångens egen destination efter den (K-e).
    const agare = uppdragsdestination();
    const vyn = await sida(`/app/c/${companyId}/uppdrag`);
    const listan = await sida(`/app/c/${companyId}/uppdrag/lista`);
    for (const [vag, html] of [['/uppdrag', vyn], ['/uppdrag/lista', listan]] as const) {
      expect(markeringsbrister(html, true), vag).toEqual([]);
      expect(markerad(html, HELMENYN), vag).toEqual([{ varde: 'page', id: agare }]);
      expect(markerad(html, SNABBRADEN), vag).toEqual([{ varde: 'page', id: agare }]);
    }
    // Ägaren står i snabbraden, så ingen "var är jag"-rad behövs.
    expect(vyn).not.toContain('class="nav__here"');
    // Listan är ett objekt under ägaren: brödsmulan slutar på listans namn.
    expect(utsnitt(listan, ...SMULAN)!.text).toMatch(/<b>Uppdragens läge<\/b><\/nav>$/);
  });
});

// ---------------------------------------------------------------------------
// M4: övriga produkter renderas som före ändringen
// ---------------------------------------------------------------------------

describe('M4 övriga produkter', () => {
  it.each([
    { namn: 'kvitton', vag: () => `/app/c/${companyId}/receipts`, varde: 'page', id: 'receipts' },
    { namn: 'en tidpost', vag: () => `/app/c/${companyId}/tid/${tidpostId}`, varde: 'location', id: 'time' },
    { namn: 'projektsidan utan avtal', vag: () => uppdragsbas(avtalslostProjekt), varde: 'location', id: 'projects_list' },
    { namn: 'Avtal utan avtal', vag: () => `${uppdragsbas(avtalslostProjekt)}/avtal`, varde: 'location', id: 'projects_list' },
  ])('$namn: $varde på $id', async ({ vag, varde, id }) => {
    const html = await sida(vag());
    expect(markeringsbrister(html, false)).toEqual([]);
    expect(markerad(html, HELMENYN)).toEqual([{ varde, id }]);
    expect(markerad(html, SNABBRADEN)).toEqual([{ varde, id }]);
    expect(html).not.toContain('class="subnav"');
  });
});
