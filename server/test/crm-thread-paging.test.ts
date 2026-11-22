// Story 4.1 (FR-17): hela kronologin, också fler än 60 händelser.
//
// Risken är tvådelad. Utan läsväg stannar "hela kronologin" vid 60, och det
// äldsta samtalet i en pratsam relation går inte att nå. Och en sidning på
// tiden ensam hoppar över eller dubblerar händelser som delar tidpunkt, eftersom
// ordningen mellan dem inte är bestämd. Provet går genom åtgärden och
// relationssidan mot riktig Postgres, med planterade relationer vars facit är
// literaler, och en negativ kontroll som fäller en sidning på bara tid.
import { readFile } from 'node:fs/promises';
import supertest from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { api, app, createCompany, registerUser, withAdmin, type TestUser } from './helpers.js';

const PASSWORD = 'mycket-hemligt-losen-123';
type Rad = Record<string, unknown>;

let user: TestUser;
let bolag: string;
let orgA: string;
let orgB: string;
let orgC: string;
let orgD: string;
let orgE: string;
let agent: ReturnType<typeof supertest.agent>;

const auth = () => ({ Authorization: `Bearer ${user.token}` });
const act = (name: string, body: Record<string, unknown>) =>
  api.post(`/api/companies/${bolag}/actions/${name}`).set(auth()).send(body);

const nn = (n: number): string => String(n).padStart(2, '0');
/** Den 1 januari 2026 klockan nio UTC plus `plus` dagar. */
const dag = (plus: number): string => new Date(Date.UTC(2026, 0, 1 + plus, 9)).toISOString();

/** Tråden genom åtgärden; svaret ska vara en lista. */
async function trad(org: string, extra: Record<string, unknown> = {}): Promise<Rad[]> {
  const res = await act('get_crm_thread', { organization_id: org, ...extra });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  expect(Array.isArray(res.body.result), JSON.stringify(res.body)).toBe(true);
  return res.body.result as Rad[];
}

/** Markören så som vyn bär den i adressen. */
const nyckel = (rad: Rad): string => `${String(rad.at)}|${String(rad.kind)}|${String(rad.ref_id)}`;
/** Radens identitet: löftet och dess stängning delar `ref_id` men inte slag. */
const id = (rad: Rad): string => `${String(rad.kind)}|${String(rad.ref_id)}`;

/** `before` ur en rad som måste finnas. */
function markorAv(rad: Rad | undefined): Record<string, unknown> {
  expect(rad, 'raden som markören byggs av').toBeDefined();
  return { at: rad?.at, kind: rad?.kind, ref_id: rad?.ref_id };
}

/** Sant bara när sidorna tillsammans innehåller varje rad i `alla` exakt en gång och inget annat. */
function exaktEnGang(alla: Rad[], sidor: Rad[][]): boolean {
  const sammanslagen = sidor.flat().map(id);
  return sammanslagen.length === alla.length
    && alla.every((rad) => sammanslagen.filter((s) => s === id(rad)).length === 1);
}

async function sida(adress: string): Promise<{ status: number; text: string }> {
  const res = await agent.get(adress);
  return { status: res.status, text: res.text };
}
/** Trådens rader, med samma icke-giriga uttryck som crm-views. */
const fragment = (html: string): string[] => html.match(/<li class="thread__ev">[\s\S]*?<\/li>/g) ?? [];
const antalMed = (fragmentlista: string[], text: string): number => fragmentlista.filter((f) => f.includes(text)).length;
const aldreHref = (html: string): string | null =>
  html.match(/href="([^"]*)">Äldre händelser →<\/a>/)?.[1]?.replace(/&amp;/g, '&') ?? null;
const nyasteHref = (html: string): string | null =>
  html.match(/href="([^"]*)">← Nyaste<\/a>/)?.[1]?.replace(/&amp;/g, '&') ?? null;

beforeAll(async () => {
  user = await registerUser('tradsidor');
  bolag = await createCompany(user.token, 'Trådsidorna AB');

  const kontakt = (org: string, occurred_at: string, summary: string, source_ref: string) => ({
    kind: 'interaction', organization: { name: org }, occurred_at, channel: 'email', direction: 'inbound',
    summary, source_system: 'gmail', source_ref,
  });
  const events: Array<Record<string, unknown>> = [];
  // A: 61 händelser, den äldsta den 1 januari och den nyaste den 2 mars.
  for (let n = 1; n <= 61; n++) {
    events.push(kontakt('Hela tråden AB', dag(n - 1), n === 1 ? 'TP-A första kontakten.' : `TP-A händelse ${nn(n)}.`, `gmail:aa41${nn(n)}`));
  }
  // B: exakt 60, den nyaste den 1 mars.
  for (let n = 1; n <= 60; n++) {
    events.push(kontakt('Sextio AB', dag(n - 1), `TP-B händelse ${nn(n)}.`, `gmail:ab41${nn(n)}`));
  }
  // C: de tre äldsta delar tidpunkt och hamnar på plats 59–61.
  for (let n = 1; n <= 61; n++) {
    events.push(n <= 3
      ? kontakt('Samma tid AB', '2026-01-01T09:00:00Z', `TP-C samma tid ${n}.`, `gmail:ac41${nn(n)}`)
      : kontakt('Samma tid AB', dag(n - 3), `TP-C händelse ${nn(n)}.`, `gmail:ac41${nn(n)}`));
  }
  // D: tre händelser, vars tider sätts inom samma millisekund nedan.
  for (const [n, text] of [[1, 'TP-D ett.'], [2, 'TP-D två.'], [3, 'TP-D tre.']] as const) {
    events.push(kontakt('Mikrosekund AB', '2026-03-01T09:00:00Z', text, `gmail:ad41${nn(n)}`));
  }
  // E: kontaktpunkter och löften om vartannat.
  events.push(
    kontakt('Blandad AB', '2026-02-01T09:00:00Z', 'TP-E kontakt 1.', 'gmail:ae4101'),
    kontakt('Blandad AB', '2026-02-03T09:00:00Z', 'TP-E kontakt 2.', 'gmail:ae4102'),
    kontakt('Blandad AB', '2026-02-05T09:00:00Z', 'TP-E kontakt 3.', 'gmail:ae4103'),
    {
      kind: 'commitment', organization: { name: 'Blandad AB' }, commitment_direction: 'we_owe', body: 'TP-E löfte 1.',
      occurred_at: '2026-02-02T09:00:00Z', source_system: 'gmail', source_ref: 'gmail:ae41c1',
    },
    {
      kind: 'commitment', organization: { name: 'Blandad AB' }, commitment_direction: 'we_owe', body: 'TP-E löfte 2.',
      occurred_at: '2026-02-04T09:00:00Z', source_system: 'gmail', source_ref: 'gmail:ae41c2',
    },
  );
  expect(events).toHaveLength(190);
  const ingest = await act('ingest_crm_events', { events });
  expect(ingest.status, JSON.stringify(ingest.body)).toBe(200);
  expect(ingest.body.result.skipped, JSON.stringify(ingest.body.result.skipped)).toEqual([]);

  // Intagets schema bär inte mikrosekunder; tiderna sätts direkt i tabellen.
  await withAdmin(async (db) => {
    for (const [ref, tid] of [
      ['gmail:ad4101', '2026-03-01T09:00:00.123456Z'],
      ['gmail:ad4102', '2026-03-01T09:00:00.123400Z'],
      ['gmail:ad4103', '2026-03-01T09:00:00.123900Z'],
    ] as const) {
      const r = await db.query('UPDATE crm.interactions SET occurred_at = $1 WHERE company_id = $2 AND source_ref = $3', [tid, bolag, ref]);
      expect(r.rowCount, ref).toBe(1);
    }
  });

  const orgs = (await act('list_crm_organizations', {})).body.result as Array<{ id: string; name: string }>;
  const orgId = (name: string): string => {
    const org = orgs.find((o) => o.name === name);
    expect(org, name).toBeDefined();
    return org?.id ?? '';
  };
  orgA = orgId('Hela tråden AB');
  orgB = orgId('Sextio AB');
  orgC = orgId('Samma tid AB');
  orgD = orgId('Mikrosekund AB');
  orgE = orgId('Blandad AB');

  agent = supertest.agent(app);
  const login = await agent.post('/app/login').type('form').send({ email: user.email, password: PASSWORD });
  expect(login.status, login.text).toBe(302);
});

describe('get_crm_thread med before och limit (story 4.1)', () => {
  it('TP1 två sidor genom åtgärden ger samma lista som en läsning, nyast först', async () => {
    const alla = await trad(orgA, { limit: 200 });
    expect(alla).toHaveLength(61);
    const tider = alla.map((r) => Date.parse(String(r.at)));
    expect([...tider].sort((a, b) => b - a)).toEqual(tider);

    const forsta = await trad(orgA, { limit: 60 });
    expect(forsta.map(id)).toEqual(alla.slice(0, 60).map(id));
    const andra = await trad(orgA, { limit: 60, before: markorAv(forsta.at(-1)) });
    expect(andra).toHaveLength(1);
    expect(andra[0]?.title).toBe('TP-A första kontakten.');
    expect([...forsta, ...andra].map(id)).toEqual(alla.map(id));
  });

  it('TP2 en giltig before ger en lista; limit 201, okänt slag, extra nyckel, saknad ref_id och ett orimligt datum ger 400', async () => {
    const rad60 = markorAv((await trad(orgA, { limit: 200 }))[59]);
    const ok = await act('get_crm_thread', { organization_id: orgA, before: rad60 });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(Array.isArray(ok.body.result), JSON.stringify(ok.body)).toBe(true);

    const ogiltiga: Array<[string, Record<string, unknown>]> = [
      ['limit 201', { organization_id: orgA, limit: 201 }],
      ['slaget constructor', { organization_id: orgA, before: { ...rad60, kind: 'constructor' } }],
      ['extra nyckel offset', { organization_id: orgA, before: { ...rad60, offset: 60 } }],
      ['utan ref_id', { organization_id: orgA, before: { at: rad60.at, kind: rad60.kind } }],
    ];
    for (const [namn, body] of ogiltiga) {
      const res = await act('get_crm_thread', body);
      expect(res.status, `${namn}: ${JSON.stringify(res.body)}`).toBe(400);
      expect(res.body.error, namn).toBe('validation_error');
    }
    // Schemat eller databasen fäller datumet; felkoden asserteras inte, men aldrig 500.
    const orimlig = await act('get_crm_thread', { organization_id: orgA, before: { ...rad60, at: '2026-02-30T09:00:00.000Z' } });
    expect(orimlig.status, JSON.stringify(orimlig.body)).toBe(400);
  });

  it('TP3 en relation i ett annat bolag ger 404, också med en giltig before', async () => {
    const granne = await registerUser('tradsidor-granne');
    const grannbolag = await createCompany(granne.token, 'Grannsidorna AB');
    const rad60 = markorAv((await trad(orgA, { limit: 200 }))[59]);
    const res = await api.post(`/api/companies/${grannbolag}/actions/get_crm_thread`)
      .set({ Authorization: `Bearer ${granne.token}` })
      .send({ organization_id: orgA, before: rad60 });
    expect(res.status, JSON.stringify(res.body)).toBe(404);
  });

  it('TP4 filtren kontakt och loften gäller på varje sida', async () => {
    const kontaktAlla = await trad(orgE, { filter: 'kontakt', limit: 200 });
    expect(kontaktAlla).toHaveLength(3);
    const k1 = await trad(orgE, { filter: 'kontakt', limit: 2 });
    const k2 = await trad(orgE, { filter: 'kontakt', limit: 2, before: markorAv(k1[1]) });
    expect([k1.length, k2.length]).toEqual([2, 1]);
    expect([...k1, ...k2].map((r) => r.kind)).toEqual(['interaction', 'interaction', 'interaction']);
    expect(exaktEnGang(kontaktAlla, [k1, k2])).toBe(true);

    const loftenAlla = await trad(orgE, { filter: 'loften', limit: 200 });
    expect(loftenAlla).toHaveLength(2);
    const l1 = await trad(orgE, { filter: 'loften', limit: 1 });
    const l2 = await trad(orgE, { filter: 'loften', limit: 1, before: markorAv(l1[0]) });
    expect([l1.length, l2.length]).toEqual([1, 1]);
    expect([...l1, ...l2].map((r) => r.kind)).toEqual(['commitment', 'commitment']);
    expect(exaktEnGang(loftenAlla, [l1, l2])).toBe(true);
  });

  it('TP5 tre händelser inom samma millisekund läses två plus en, var och en exakt en gång', async () => {
    const alla = await trad(orgD, { limit: 200 });
    expect(alla).toHaveLength(3);
    const s1 = await trad(orgD, { limit: 2 });
    const s2 = await trad(orgD, { limit: 2, before: markorAv(s1[1]) });
    expect([s1.length, s2.length]).toEqual([2, 1]);
    expect(exaktEnGang(alla, [s1, s2])).toBe(true);
    expect(alla.map((r) => r.at)).toEqual(['2026-03-01T09:00:00.123Z', '2026-03-01T09:00:00.123Z', '2026-03-01T09:00:00.123Z']);
  });

  it('TP6 samma tid över sidgränsen: markören ger 60 plus 1; negativ kontroll: en sidning på bara at hoppar över en händelse', async () => {
    const alla = await trad(orgC, { limit: 200 });
    expect(alla).toHaveLength(61);
    // (a) Den totala ordningen och markören.
    const s1 = await trad(orgC, { limit: 60 });
    const s2 = await trad(orgC, { limit: 60, before: markorAv(s1[59]) });
    expect([s1.length, s2.length]).toEqual([60, 1]);
    expect(exaktEnGang(alla, [s1, s2])).toBe(true);

    // (b) Samma lista sidad på bara tid: den tredje händelsen med samma tid hamnar på ingen sida.
    const rad60 = alla[59];
    expect(rad60).toBeDefined();
    const bara1 = alla.slice(0, 60);
    const bara2 = alla.filter((r) => Date.parse(String(r.at)) < Date.parse(String(rad60?.at)));
    expect(bara2).toHaveLength(0);
    expect(exaktEnGang(alla, [bara1, bara2])).toBe(false);
  });
});

describe('relationssidans läsväg (story 4.1)', () => {
  const NAV = '<nav class="actions" aria-label="Trådens sidor">';
  const relation = (org: string): string => `/app/c/${bolag}/relations/${org}`;

  it('TP7 första sidan av 61: de 60 nyaste, Äldre händelser → med markören ur rad 60, och intervallet', async () => {
    const alla = await trad(orgA, { limit: 200 });
    const s = await sida(relation(orgA));
    expect(s.status, s.text).toBe(200);
    expect(fragment(s.text)).toHaveLength(60);
    expect(antalMed(fragment(s.text), 'TP-A första kontakten.')).toBe(0);
    expect(s.text).toContain(NAV);
    expect(s.text.indexOf(NAV)).toBeGreaterThan(s.text.indexOf('<ol class="thread">'));
    const href = aldreHref(s.text);
    expect(href, 'Äldre händelser →').not.toBeNull();
    const url = new URL(href ?? '', 'http://vy.test');
    expect(url.pathname).toBe(relation(orgA));
    expect(url.searchParams.get('visa')).toBe('allt');
    expect(url.searchParams.get('fore')).toBe(nyckel(markorAv(alla[59])));
    expect(s.text).not.toContain('← Nyaste');
    expect(s.text).toContain('<p class="muted">Visar 60 händelser, från 2026-01-02 till 2026-03-02.</p>');
    expect(s.text).not.toContain('Det här är relationens första registrerade händelse.');
  });

  it('TP8 sidan på Äldre händelser → visar den äldsta, texten om den första händelsen och ← Nyaste', async () => {
    const forsta = await sida(relation(orgA));
    const href = aldreHref(forsta.text);
    expect(href, 'Äldre händelser →').not.toBeNull();
    const s = await sida(href ?? '');
    expect(s.status, s.text).toBe(200);
    expect(fragment(s.text)).toHaveLength(1);
    expect(antalMed(fragment(s.text), 'TP-A första kontakten.')).toBe(1);
    expect(s.text).toContain('<p class="muted">Det här är relationens första registrerade händelse.</p>');
    expect(s.text).toContain('<p class="muted">Visar 1 händelse, från 2026-01-01 till 2026-01-01.</p>');
    expect(nyasteHref(s.text)).toBe(`${relation(orgA)}?visa=allt`);
    expect(s.text).not.toContain('Äldre händelser →');
    expect(s.text.split(NAV)).toHaveLength(2);
  });

  it('TP9 ?visa=kontakt följer med åt båda hållen', async () => {
    const alla = await trad(orgA, { limit: 200 });
    const s = await sida(`${relation(orgA)}?visa=kontakt`);
    expect(s.status, s.text).toBe(200);
    const href = aldreHref(s.text);
    expect(href, 'Äldre händelser →').not.toBeNull();
    const url = new URL(href ?? '', 'http://vy.test');
    expect(url.searchParams.get('visa')).toBe('kontakt');
    expect(url.searchParams.get('fore')).toBe(nyckel(markorAv(alla[59])));
    const aldre = await sida(href ?? '');
    expect(aldre.status, aldre.text).toBe(200);
    expect(fragment(aldre.text)).toHaveLength(1);
    expect(antalMed(fragment(aldre.text), 'TP-A första kontakten.')).toBe(1);
    expect(nyasteHref(aldre.text)).toBe(`${relation(orgA)}?visa=kontakt`);
  });

  it('TP10 exakt 60 händelser: ingen läsväg och ingen nav, men intervallet', async () => {
    const s = await sida(relation(orgB));
    expect(s.status, s.text).toBe(200);
    expect(fragment(s.text)).toHaveLength(60);
    expect(s.text).not.toContain('Äldre händelser →');
    expect(s.text).not.toContain('← Nyaste');
    expect(s.text).not.toContain('aria-label="Trådens sidor"');
    expect(s.text).toContain('<p class="muted">Visar 60 händelser, från 2026-01-01 till 2026-03-01.</p>');
  });

  it('TP11 samma tid över sidgränsen på relationssidan: varje händelse exakt en gång', async () => {
    const forsta = await sida(relation(orgC));
    expect(forsta.status, forsta.text).toBe(200);
    const href = aldreHref(forsta.text);
    expect(href, 'Äldre händelser →').not.toBeNull();
    const andra = await sida(href ?? '');
    expect(andra.status, andra.text).toBe(200);
    expect([fragment(forsta.text).length, fragment(andra.text).length]).toEqual([60, 1]);

    const alla = [...fragment(forsta.text), ...fragment(andra.text)];
    const texter = [
      'TP-C samma tid 1.', 'TP-C samma tid 2.', 'TP-C samma tid 3.',
      ...Array.from({ length: 58 }, (_, i) => `TP-C händelse ${nn(i + 4)}.`),
    ];
    expect(texter).toHaveLength(61);
    for (const text of texter) expect(antalMed(alla, text), text).toBe(1);
    const sammaTid = ['TP-C samma tid 1.', 'TP-C samma tid 2.', 'TP-C samma tid 3.'];
    expect(sammaTid.map((t) => antalMed(fragment(forsta.text), t)).reduce((a, b) => a + b, 0)).toBe(2);
    expect(sammaTid.map((t) => antalMed(fragment(andra.text), t)).reduce((a, b) => a + b, 0)).toBe(1);
  });

  it('TP12 ogiltiga markörer ger 400 med den fasta texten; en giltig markör utan äldre rader ger 200 och sitt eget tomläge', async () => {
    const FEL = 'Adressens läsposition i tråden går inte att läsa. Öppna relationen igen för att se de nyaste händelserna.';
    const uuid = '3f2b6c1e-8a4d-4e2f-9b1a-0c5d7e9f1a2b';
    const giltig = `2026-01-02T09:00:00.000Z|interaction|${uuid}`;
    const kod = encodeURIComponent;
    const ogiltiga: Array<[string, string]> = [
      ['V1', `?fore=${kod(`2026-02-30T09:00:00.000Z|interaction|${uuid}`)}`],
      ['V2', `?fore=${kod(`2026-01-02T09:00:00.000Z|constructor|${uuid}`)}`],
      ['V3', `?fore=${kod('2026-01-02T09:00:00.000Z|interaction')}`],
      ['V4', `?fore=${kod(`${giltig}${'0'.repeat(101 - giltig.length)}`)}`],
      ['V5', '?fore='],
      ['V6', `?fore=${kod(giltig)}&fore=${kod(`2026-01-03T09:00:00.000Z|interaction|${uuid}`)}`],
    ];
    for (const [namn, fraga] of ogiltiga) {
      const s = await sida(`${relation(orgA)}${fraga}`);
      expect(s.status, `${namn}: ${s.text}`).toBe(400);
      expect(s.text, namn).toContain(FEL);
      expect(s.text, namn).not.toContain('Något gick fel.');
      expect(fragment(s.text), namn).toHaveLength(0);
    }

    const v7 = await sida(`${relation(orgA)}?fore=${kod(`2000-01-01T09:00:00.000Z|interaction|${uuid}`)}`);
    expect(v7.status, v7.text).toBe(200);
    expect(fragment(v7.text)).toHaveLength(0);
    expect(v7.text).toContain('Inga äldre händelser före den här positionen.');
    expect(nyasteHref(v7.text)).toBe(`${relation(orgA)}?visa=allt`);
    expect(v7.text).not.toContain('Inget har hänt ännu');
  });
});

describe('dokumentet (story 4.1)', () => {
  it('TP13 MCP_ACTIONS.md beskriver before i ett eget avsnitt efter crm 4.2, utan underrubriker', async () => {
    const text = await readFile(new URL('../../docs/MCP_ACTIONS.md', import.meta.url), 'utf8');
    const RUBRIK = '## Trådens läsväg bakåt (crm 4.1)';
    expect(text.split(RUBRIK)).toHaveLength(2);
    const fore = text.indexOf('## Källan på varje rad (crm 4.2)');
    expect(fore).toBeGreaterThan(-1);
    const start = text.indexOf(RUBRIK);
    expect(start).toBeGreaterThan(fore);
    const resten = text.slice(start + RUBRIK.length);
    const slut = resten.indexOf('\n## ');
    const avsnitt = slut === -1 ? resten : resten.slice(0, slut);
    for (const term of ['get_crm_thread', 'before', 'limit', 'at', 'kind', 'ref_id']) {
      expect(avsnitt, term).toContain('`' + term + '`');
    }
    expect(avsnitt.split('\n').filter((rad) => rad.startsWith('### '))).toEqual([]);
  });
});
