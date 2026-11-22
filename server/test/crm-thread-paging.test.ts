// Story 4.1 (FR-17): hela kronologin, också fler än 60 händelser.
//
// Risken är tvådelad. Utan läsväg stannar "hela kronologin" vid 60, och det
// äldsta samtalet i en pratsam relation går inte att nå. Och en sidning på
// tiden ensam hoppar över eller dubblerar händelser som delar tidpunkt, eftersom
// ordningen mellan dem inte är bestämd. Provet går genom åtgärden och
// relationssidan mot riktig Postgres, med planterade relationer vars facit är
// literaler, och en negativ kontroll som fäller en sidning på bara tid.
//
// Story 4.3 (FR-40) bygger vidare på samma läsväg: risken är att personläget
// blandar in andra personers händelser eller pengar, att adressen tappar
// personen mellan flikar och sidor, och att en rättelse slås upp på ett namn
// som just ändrats och lägger en ny person i stället för att rätta den gamla.
import { readFile } from 'node:fs/promises';
import supertest from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { api, app, createCompany, createFiscalYear, registerUser, withAdmin, type TestUser } from './helpers.js';
import { daysSince } from '../src/lib/crmRules.js';

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
/** En inkommande kontaktpunkt i intagets form. */
const kontakt = (org: string, occurred_at: string, summary: string, source_ref: string) => ({
  kind: 'interaction', organization: { name: org }, occurred_at, channel: 'email', direction: 'inbound',
  summary, source_system: 'gmail', source_ref,
});

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

/** Varje sida i ett filter, med `before` ur föregående sidas sista rad, tills en sida inte är full. */
async function allaSidor(org: string, filter: string, limit: number): Promise<Rad[][]> {
  const sidor: Rad[][] = [];
  let before: Record<string, unknown> | undefined;
  for (let varv = 0; varv < 50; varv++) {
    const s = await trad(org, { filter, limit, ...(before ? { before } : {}) });
    sidor.push(s);
    if (s.length < limit) return sidor;
    before = markorAv(s.at(-1));
  }
  throw new Error(`${filter} med ${limit} per sida tar inte slut efter 50 sidor`);
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

  it('TP2 en giltig before ger en lista; limit 201, okänt slag, extra nyckel, saknad ref_id, ett orimligt datum och en tidpunkt utanför trådens form ger 400', async () => {
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

    // `before.at` godtas bara i trådens egen form (granskningen): zonerna över
    // ±15:59 släpper Date.parse igenom men Postgres avvisar med 22009, som annars
    // blir 500. Samma lista som vyns markör i crm-rules TC6.
    for (const at of [
      '2026-01-02T09:00:00.000+16:00', '2026-01-02T09:00:00.000-16:00', '2026-01-02T09:00:00.000+23:59',
      '2026-01-02T09:00:00+1600', '2026-01-02T09:00:00.000+01:00', '2026-01-02T09:00:00Z',
      '0000-01-01T00:00:00.000Z', '+012026-01-02T09:00:00.000Z', '2026-02-30T09:00:00.000Z',
      '2025-02-29T09:00:00.000Z', '2026-01-02T24:00:00.000Z',
    ]) {
      const res = await act('get_crm_thread', { organization_id: orgA, before: { ...rad60, at } });
      expect(res.status, `${at}: ${JSON.stringify(res.body)}`).toBe(400);
      expect(res.body.error, at).toBe('validation_error');
    }
    const egenForm = await act('get_crm_thread', { organization_id: orgA, before: { ...rad60, at: '2026-01-02T09:00:00.000Z' } });
    expect(egenForm.status, JSON.stringify(egenForm.body)).toBe(200);
    expect(Array.isArray(egenForm.body.result), JSON.stringify(egenForm.body)).toBe(true);
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

  it('TP4b samma ögonblick under alla fyra filtren: fakturor, betalning, kontakter och löften exakt en gång vid varje sidstorlek', async () => {
    // F: två fakturor och en betalning samma dag delar `at` (datumet som tidpunkt
    // ger midnatt), som de gör i drift. Kontakterna och löftena flyttas till samma
    // ögonblick, så att ordningen avgörs av `kind` och `ref_id` på varje sidgräns.
    const NAMN = 'Pengadagen AB';
    await createFiscalYear(bolag, auth(), { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });
    const kund = await api.post(`/api/companies/${bolag}/customers`).set(auth()).send({ name: NAMN });
    expect(kund.status, JSON.stringify(kund.body)).toBe(201);
    const ingest = await act('ingest_crm_events', {
      events: [
        kontakt(NAMN, '2026-04-01T09:00:00Z', 'TP-F kontakt 1.', 'gmail:af4101'),
        kontakt(NAMN, '2026-04-02T09:00:00Z', 'TP-F kontakt 2.', 'gmail:af4102'),
        ...['1', '2'].map((n) => ({
          kind: 'commitment', organization: { name: NAMN }, commitment_direction: 'we_owe', body: `TP-F löfte ${n}.`,
          occurred_at: '2026-04-03T09:00:00Z', source_system: 'gmail', source_ref: `gmail:af41c${n}`,
        })),
      ],
    });
    expect(ingest.status, JSON.stringify(ingest.body)).toBe(200);
    expect(ingest.body.result.skipped, JSON.stringify(ingest.body.result.skipped)).toEqual([]);
    const orgF = ((await act('list_crm_organizations', {})).body.result as Array<{ id: string; name: string }>)
      .find((o) => o.name === NAMN)?.id;
    expect(orgF, NAMN).toBeDefined();

    const godkann = async (svar: { status: number; body: { approval?: { id?: string } } }) => {
      expect(svar.status, JSON.stringify(svar.body)).toBe(202);
      const ok = await api.post(`/api/companies/${bolag}/approvals/${svar.body.approval?.id}/approve`).set(auth()).send({});
      expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    };
    const fakturor: string[] = [];
    for (const rad of ['TP-F arbete 1', 'TP-F arbete 2']) {
      const inv = await act('create_invoice', {
        customer_id: kund.body.customer.id, invoice_date: '2026-04-10', due_date: '2026-05-10',
        lines: [{ description: rad, quantity: 1, unit: 'h', unit_price_ore: 100_000, vat_rate: 25 }],
      });
      expect(inv.status, JSON.stringify(inv.body)).toBe(200);
      await godkann(await act('book_invoice', { invoice_id: inv.body.result.id }));
      fakturor.push(inv.body.result.id as string);
    }
    await godkann(await act('register_invoice_payment', { invoice_id: fakturor[0], payment_date: '2026-04-10' }));

    const pengar = await trad(orgF ?? '', { filter: 'pengar', limit: 200 });
    expect(pengar.map((r) => r.kind)).toEqual(['payment', 'invoice', 'invoice']);
    const at = pengar[0]?.at;
    expect(pengar.map((r) => r.at)).toEqual([at, at, at]);
    await withAdmin(async (db) => {
      const k = await db.query('UPDATE crm.interactions SET occurred_at = $1 WHERE company_id = $2 AND source_ref = ANY($3)',
        [at, bolag, ['gmail:af4101', 'gmail:af4102']]);
      expect(k.rowCount, 'kontakterna').toBe(2);
      const l = await db.query('UPDATE crm.commitments SET occurred_at = $1 WHERE company_id = $2 AND source_ref = ANY($3)',
        [at, bolag, ['gmail:af41c1', 'gmail:af41c2']]);
      expect(l.rowCount, 'löftena').toBe(2);
    });

    for (const [filter, antal] of [['allt', 7], ['kontakt', 2], ['pengar', 3], ['loften', 2]] as const) {
      const alla = await trad(orgF ?? '', { filter, limit: 200 });
      expect(alla, filter).toHaveLength(antal);
      expect(alla.every((r) => r.at === at), `${filter}: samma at`).toBe(true);
      for (let storlek = 1; storlek <= antal; storlek++) {
        const sidor = await allaSidor(orgF ?? '', filter, storlek);
        expect(exaktEnGang(alla, sidor), `${filter}, ${storlek} per sida`).toBe(true);
        expect(sidor.flat().map(id), `${filter}, ${storlek} per sida`).toEqual(alla.map(id));
      }
    }
    // Negativ kontroll: på bara tid når ingen andra sida förbi det gemensamma ögonblicket.
    const tidEnsam = pengar.filter((r) => Date.parse(String(r.at)) < Date.parse(String(at)));
    expect(exaktEnGang(pengar, [pengar.slice(0, 1), tidEnsam])).toBe(false);
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

  it('TP8b äldre rader som markören inte kan peka på: ingen länk, inget påstående om första händelsen, och sidan säger varför', async () => {
    const FORSTA = 'Det här är relationens första registrerade händelse.';
    const SPARRAD = '<p class="muted">Det finns äldre händelser, men läsvägen når dem inte: den äldsta visade händelsen har en tidpunkt utanför åren 1–9999. Rätta tidpunkten för att bläddra vidare.</p>';
    // G: 61 händelser, där de två äldsta flyttas före vår tideräkning (rad 60 får
    // året 0000 i JavaScript, rad 61 året -1). H: 61 händelser, där de 60 nyaste
    // flyttas förbi år 9999. Postgres lagrar båda; markörens form bär ingen av dem.
    const events: Array<Record<string, unknown>> = [];
    for (let n = 1; n <= 61; n++) {
      events.push(kontakt('Före vår tid AB', dag(n - 1), `TP-G händelse ${nn(n)}.`, `gmail:ag41${nn(n)}`));
      events.push(kontakt('Långt fram AB', dag(n - 1), `TP-H händelse ${nn(n)}.`, `gmail:ah41${nn(n)}`));
    }
    const ingest = await act('ingest_crm_events', { events });
    expect(ingest.status, JSON.stringify(ingest.body)).toBe(200);
    expect(ingest.body.result.skipped, JSON.stringify(ingest.body.result.skipped)).toEqual([]);
    await withAdmin(async (db) => {
      for (const [ref, ar] of [['gmail:ag4101', 2027], ['gmail:ag4102', 2026]] as const) {
        const r = await db.query('UPDATE crm.interactions SET occurred_at = occurred_at - make_interval(years => $1::int) WHERE company_id = $2 AND source_ref = $3',
          [ar, bolag, ref]);
        expect(r.rowCount, ref).toBe(1);
      }
      const h = await db.query("UPDATE crm.interactions SET occurred_at = occurred_at + interval '10000 years' WHERE company_id = $1 AND source_ref = ANY($2)",
        [bolag, Array.from({ length: 60 }, (_, i) => `gmail:ah41${nn(i + 2)}`)]);
      expect(h.rowCount, 'H').toBe(60);
    });
    const orgs = (await act('list_crm_organizations', {})).body.result as Array<{ id: string; name: string }>;
    const orgG = orgs.find((o) => o.name === 'Före vår tid AB')?.id;
    const orgH = orgs.find((o) => o.name === 'Långt fram AB')?.id;
    expect([orgG, orgH].every(Boolean), 'G och H').toBe(true);

    // En giltig läsposition som är nyare än allt i G: alla 61 ligger före den.
    const nyare = encodeURIComponent('2027-01-01T00:00:00.000Z|payment|ffffffff-ffff-4fff-bfff-ffffffffffff');
    const sparrade: Array<[string, string, boolean]> = [
      ['G utan fore', relation(orgG ?? ''), false],
      ['G med fore', `${relation(orgG ?? '')}?fore=${nyare}`, true],
      ['H utan fore', relation(orgH ?? ''), false],
    ];
    for (const [namn, adress, medFore] of sparrade) {
      const s = await sida(adress);
      expect(s.status, `${namn}: ${s.text}`).toBe(200);
      expect(fragment(s.text), namn).toHaveLength(60);
      expect(s.text, namn).not.toContain('Äldre händelser →');
      expect(s.text, namn).not.toContain(FORSTA);
      expect(s.text, namn).toContain(SPARRAD);
      expect(nyasteHref(s.text), namn).toBe(medFore ? `${relation(orgG ?? '')}?visa=allt` : null);
    }

    // Kontrollerna: med en markör visas länken, och utan äldre rader står texten om början.
    const forsta = await sida(relation(orgA));
    expect(aldreHref(forsta.text), 'A, första sidan').not.toBeNull();
    expect(forsta.text, 'A, första sidan').not.toContain(SPARRAD);
    const sista = await sida(aldreHref(forsta.text) ?? '');
    expect(sista.text, 'A, sista sidan').toContain(FORSTA);
    expect(sista.text, 'A, sista sidan').not.toContain(SPARRAD);
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

// ---------------------------------------------------------------------------
// Story 4.3: personläget. Ett eget bolag, eftersom TP4b lägger räkenskapsåret
// 2026 i filens första och personläget behöver en bokförd faktura för att visa
// att pengar inte ingår.
// ---------------------------------------------------------------------------
let pbolag: string;
let orgP: string;
let orgL: string;
let orgG: string;
let anna: string;
let bertil: string;
let cecilia: string;
let doris: string;
let olle: string;
let lena: string;
let fria: string;

const actP = (name: string, body: Record<string, unknown>) =>
  api.post(`/api/companies/${pbolag}/actions/${name}`).set(auth()).send(body);

/** Tråden i personbolaget genom åtgärden; svaret ska vara en lista. */
async function tradP(org: string, extra: Record<string, unknown> = {}): Promise<Rad[]> {
  const res = await actP('get_crm_thread', { organization_id: org, ...extra });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  expect(Array.isArray(res.body.result), JSON.stringify(res.body)).toBe(true);
  return res.body.result as Rad[];
}

const relationP = (org: string): string => `/app/c/${pbolag}/relations/${org}`;

const PERSONHUVUD = '<section class="factcard" aria-labelledby="personhuvud-rubrik">';
/** Personhuvudet till och med dess första `</section>`, eller tom sträng. */
function personhuvudet(html: string): string {
  const start = html.indexOf(PERSONHUVUD);
  if (start === -1) return '';
  const slut = html.indexOf('</section>', start);
  return slut === -1 ? '' : html.slice(start, slut + '</section>'.length);
}

/** Sant bara när listan inte är tom, varje rad är personens och ingen rad är pengar. */
const baraPerson = (rader: Rad[], namn: string): boolean =>
  rader.length > 0 && rader.every((r) => r.who === namn && r.kind !== 'invoice' && r.kind !== 'payment');

/** Sant bara när listan inte är tom, varje fragment nämner personen och inget nämner någon av de andra texterna. */
const baraPersonens = (fragmentlista: string[], namn: string, andra: string[]): boolean =>
  fragmentlista.length > 0 && fragmentlista.every((f) => f.includes(namn) && !andra.some((a) => f.includes(a)));

/** TP4b:s godkännande, mot personbolaget. */
async function godkannP(svar: { status: number; body: { approval?: { id?: string } } }): Promise<void> {
  expect(svar.status, JSON.stringify(svar.body)).toBe(202);
  const ok = await api.post(`/api/companies/${pbolag}/approvals/${svar.body.approval?.id}/approve`).set(auth()).send({});
  expect(ok.status, JSON.stringify(ok.body)).toBe(200);
}

/** Annas lista, nyast först: (slag, rubrik). */
const ANNAS_LISTA: Array<[string, string]> = [
  ['commitment_closed', 'TP-P Annas löfte.'],
  ['interaction', 'TP-P Anna 3.'],
  ['interaction', 'TP-P Anna 2.'],
  ['commitment', 'TP-P Annas löfte.'],
  ['interaction', 'TP-P Anna 1.'],
];
const slagOchRubrik = (rader: Rad[]): Array<[unknown, unknown]> => rader.map((r) => [r.kind, r.title]);

beforeAll(async () => {
  pbolag = await createCompany(user.token, 'Personläget AB');
  await createFiscalYear(pbolag, auth(), { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });
  const P = 'Personbolaget AB';
  const L = 'Långa samtal AB';
  // Kunden finns före intaget, så att intaget kopplar relationen till den på namnet.
  const kund = await api.post(`/api/companies/${pbolag}/customers`).set(auth()).send({ name: P });
  expect(kund.status, JSON.stringify(kund.body)).toBe(201);

  const ANNA = { name: 'Anna Andersson', email: 'anna@personbolaget.example' };
  const BERTIL = { name: 'Bertil Berg', email: 'bertil@personbolaget.example' };
  const LENA = { name: 'Lena Lång', email: 'lena@langasamtal.example' };
  const lofte = (body: string, riktning: string, occurred_at: string, source_ref: string, person: Record<string, unknown>) => ({
    kind: 'commitment', organization: { name: P }, commitment_direction: riktning, body,
    occurred_at, source_system: 'gmail', source_ref, person,
  });
  const events: Array<Record<string, unknown>> = [
    { ...kontakt(P, '2026-02-01T09:00:00Z', 'TP-P Anna 1.', 'gmail:bp4101'), person: { ...ANNA, role_title: 'Beställare' } },
    { ...kontakt(P, '2026-02-03T09:00:00Z', 'TP-P Bertil 1.', 'gmail:bp4102'), person: BERTIL },
    { ...kontakt(P, '2026-02-10T09:00:00Z', 'TP-P Anna 2.', 'gmail:bp4103'), person: ANNA },
    { ...kontakt(P, '2026-02-12T09:00:00Z', 'TP-P Bertil 2.', 'gmail:bp4104'), person: BERTIL },
    kontakt(P, '2026-02-15T09:00:00Z', 'TP-P utan person.', 'gmail:bp4105'),
    { ...kontakt(P, '2026-02-20T09:00:00Z', 'TP-P Anna 3.', 'gmail:bp4106'), person: ANNA },
    lofte('TP-P Annas löfte.', 'they_owe', '2026-02-05T09:00:00Z', 'gmail:bp41c1', ANNA),
    lofte('TP-P Bertils löfte.', 'we_owe', '2026-02-07T09:00:00Z', 'gmail:bp41c2', BERTIL),
  ];
  // L: 61 samtal med Lena, det äldsta den 1 januari och det nyaste den 2 mars,
  // och ett utan person mitt i.
  for (let n = 1; n <= 61; n++) {
    events.push({
      ...kontakt(L, dag(n - 1), n === 1 ? 'TP-L första samtalet.' : `TP-L samtal ${nn(n)}.`, `gmail:bl41${nn(n)}`),
      person: LENA,
    });
  }
  events.push(kontakt(L, '2026-01-15T09:00:00Z', 'TP-L utan person.', 'gmail:bl41x1'));
  expect(events).toHaveLength(70);
  const ingest = await actP('ingest_crm_events', { events });
  expect(ingest.status, JSON.stringify(ingest.body)).toBe(200);
  expect(ingest.body.result.skipped, JSON.stringify(ingest.body.result.skipped)).toEqual([]);

  const orgs = (await actP('list_crm_organizations', {})).body.result as Array<{ id: string; name: string }>;
  const orgId = (name: string): string => {
    const org = orgs.find((o) => o.name === name);
    expect(org, name).toBeDefined();
    return org?.id ?? '';
  };
  orgP = orgId(P);
  orgL = orgId(L);
  const granne = await actP('upsert_crm_organization', { name: 'Grannrelationen AB' });
  expect(granne.status, JSON.stringify(granne.body)).toBe(200);
  orgG = granne.body.result.id as string;

  const personId = async (org: string, name: string): Promise<string> => {
    const res = await actP('list_crm_people', { organization_id: org });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const person = (res.body.result as Array<{ id: string; name: string }>).find((p) => p.name === name);
    expect(person, name).toBeDefined();
    return person?.id ?? '';
  };
  anna = await personId(orgP, 'Anna Andersson');
  bertil = await personId(orgP, 'Bertil Berg');
  lena = await personId(orgL, 'Lena Lång');
  const nyPerson = async (body: Record<string, unknown>): Promise<string> => {
    const res = await actP('upsert_crm_person', body);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body.result.id as string;
  };
  cecilia = await nyPerson({ name: 'Cecilia Ceder', organization_id: orgP, role_title: 'Ekonomichef', phone: '0701112233' });
  doris = await nyPerson({ name: 'Doris Dahl', organization_id: orgP });
  olle = await nyPerson({ name: 'Olle Granne', organization_id: orgG });
  fria = await nyPerson({ name: 'Fria Fransson' });

  // Annas löfte stängs, och stängningens tid blir en literal.
  const loften = (await actP('list_crm_commitments', {})).body.result as Rad[];
  const l1 = loften.find((c) => c.body === 'TP-P Annas löfte.');
  expect(l1, 'TP-P Annas löfte.').toBeDefined();
  const klar = await actP('set_crm_commitment_status', { commitment_id: l1?.id, status: 'done' });
  expect(klar.status, JSON.stringify(klar.body)).toBe(200);
  await withAdmin(async (db) => {
    const r = await db.query('UPDATE crm.commitments SET completed_at = $1 WHERE company_id = $2 AND id = $3',
      ['2026-02-22T09:00:00Z', pbolag, l1?.id]);
    expect(r.rowCount, 'stängningen').toBe(1);
  });

  // En bokförd faktura till kunden, utan betalning.
  const inv = await actP('create_invoice', {
    customer_id: kund.body.customer.id, invoice_date: '2026-02-25', due_date: '2026-03-25',
    lines: [{ description: 'TP-P arbete', quantity: 1, unit: 'h', unit_price_ore: 100_000, vat_rate: 25 }],
  });
  expect(inv.status, JSON.stringify(inv.body)).toBe(200);
  await godkannP(await actP('book_invoice', { invoice_id: inv.body.result.id }));

  // Frias löfte: en person utan organisation.
  const fritt = await actP('record_crm_commitment', {
    person_id: fria, direction: 'we_owe', body: 'TP-P fritt löfte.', due_date: '2026-03-01',
    occurred_at: '2026-02-26T09:00:00Z', source_system: 'manual',
  });
  expect(fritt.status, JSON.stringify(fritt.body)).toBe(200);
});

describe('personläget genom get_crm_thread (story 4.3)', () => {
  it('PP1 Anna och Bertil får var sin lista; relationen har alla tio, och predikatet «bara personens» fäller den', async () => {
    const annas = await tradP(orgP, { person_id: anna, limit: 200 });
    expect(slagOchRubrik(annas)).toEqual(ANNAS_LISTA);
    expect(baraPerson(annas, 'Anna Andersson')).toBe(true);

    const bertils = await tradP(orgP, { person_id: bertil, limit: 200 });
    expect(slagOchRubrik(bertils)).toEqual([
      ['interaction', 'TP-P Bertil 2.'], ['commitment', 'TP-P Bertils löfte.'], ['interaction', 'TP-P Bertil 1.'],
    ]);
    expect(baraPerson(bertils, 'Bertil Berg')).toBe(true);

    const relationen = await tradP(orgP, { limit: 200 });
    expect(relationen).toHaveLength(10);
    expect(relationen.filter((r) => r.kind === 'invoice')).toHaveLength(1);
    expect(relationen.filter((r) => r.title === 'TP-P utan person.')).toHaveLength(1);
    // Negativ kontroll: utan personfiltret står Bertils, den personlösa och fakturan där.
    expect(baraPerson(relationen, 'Anna Andersson')).toBe(false);
  });

  it('PP2 filtren i personläget: kontakt 3, löften 2 och pengar en tom lista, medan relationens pengar har fakturan', async () => {
    const kontakter = await tradP(orgP, { person_id: anna, filter: 'kontakt', limit: 200 });
    expect(kontakter.map((r) => r.kind)).toEqual(['interaction', 'interaction', 'interaction']);
    const loften = await tradP(orgP, { person_id: anna, filter: 'loften', limit: 200 });
    expect(loften.map((r) => r.kind)).toEqual(['commitment_closed', 'commitment']);
    const pengar = await tradP(orgP, { person_id: anna, filter: 'pengar', limit: 200 });
    expect(Array.isArray(pengar)).toBe(true);
    expect(pengar).toHaveLength(0);
    const relationensPengar = await tradP(orgP, { filter: 'pengar', limit: 200 });
    expect(relationensPengar.map((r) => r.kind)).toEqual(['invoice']);
  });

  it('PP3 Annas tråd i sidor om två med before: 2 + 2 + 1, varje rad exakt en gång och i samma ordning', async () => {
    const alla = await tradP(orgP, { person_id: anna, limit: 200 });
    const sidor: Rad[][] = [];
    let before: Record<string, unknown> | undefined;
    for (let varv = 0; varv < 10; varv++) {
      const s = await tradP(orgP, { person_id: anna, limit: 2, ...(before ? { before } : {}) });
      sidor.push(s);
      if (s.length < 2) break;
      before = markorAv(s.at(-1));
    }
    expect(sidor.map((s) => s.length)).toEqual([2, 2, 1]);
    expect(exaktEnGang(alla, sidor)).toBe(true);
    expect(sidor.flat().map(id)).toEqual(alla.map(id));
  });

  it('PP4 en annan relations person, en okänd uuid och en person i ett annat bolag ger 404; ett ogiltigt id 400; versaler samma rader', async () => {
    const fel: Array<[string, string]> = [
      ['en annan relations person', olle],
      ['en okänd uuid', '00000000-0000-4000-8000-000000000000'],
    ];
    for (const [namn, personId] of fel) {
      const res = await actP('get_crm_thread', { organization_id: orgP, person_id: personId });
      expect(res.status, `${namn}: ${JSON.stringify(res.body)}`).toBe(404);
    }
    const ogiltig = await actP('get_crm_thread', { organization_id: orgP, person_id: 'inte-ett-id' });
    expect(ogiltig.status, JSON.stringify(ogiltig.body)).toBe(400);
    expect(ogiltig.body.error).toBe('validation_error');
    // Filens första bolag: relationen finns där, men Anna hör till personbolaget.
    const annatBolag = await act('get_crm_thread', { organization_id: orgA, person_id: anna });
    expect(annatBolag.status, JSON.stringify(annatBolag.body)).toBe(404);

    const gemener = await tradP(orgP, { person_id: anna, limit: 200 });
    const versaler = await tradP(orgP, { person_id: anna.toUpperCase(), limit: 200 });
    expect(gemener).toHaveLength(5);
    expect(versaler.map(id)).toEqual(gemener.map(id));
  });
});

describe('upsert_crm_person med person_id (story 4.3)', () => {
  it('PA1 med person_id och utan namn rättas samma rad: rollen ändras, namnet står kvar och ingen ny person läggs upp', async () => {
    const res = await actP('upsert_crm_person', { person_id: fria, role_title: 'Frilansare' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.result.id).toBe(fria);
    expect(res.body.result.created).toBe(false);
    expect(res.body.result.name).toBe('Fria Fransson');
    expect(res.body.result.role_title).toBe('Frilansare');
    const folk = await actP('list_crm_people', {});
    expect(folk.status, JSON.stringify(folk.body)).toBe(200);
    expect((folk.body.result as Rad[]).filter((p) => p.name === 'Fria Fransson')).toHaveLength(1);
  });

  it('PA2 ett person_id i ett annat bolag ger 404 och rör ingenting; utan både namn och person_id, ett ogiltigt id och ett tomt namn ger 400', async () => {
    const frammande = await act('upsert_crm_person', { person_id: anna, role_title: 'Främmande' });
    expect(frammande.status, JSON.stringify(frammande.body)).toBe(404);
    const relationen = await actP('get_crm_organization', { organization_id: orgP });
    expect(relationen.status, JSON.stringify(relationen.body)).toBe(200);
    const annaNu = (relationen.body.result.people as Rad[]).find((p) => p.id === anna);
    expect(annaNu?.role_title).toBe('Beställare');

    for (const [namn, body] of [
      ['varken name eller person_id', { role_title: 'Utan namn' }],
      ['ett ogiltigt person_id', { person_id: 'inte-ett-id', phone: '1' }],
    ] as const) {
      const res = await actP('upsert_crm_person', body);
      expect(res.status, `${namn}: ${JSON.stringify(res.body)}`).toBe(400);
      expect(res.body.error, namn).toBe('validation_error');
    }
    // Schemat eller tjänsten fäller det tomma namnet; felkoden asserteras inte.
    const tomt = await actP('upsert_crm_person', { person_id: fria, name: '   ' });
    expect(tomt.status, JSON.stringify(tomt.body)).toBe(400);
  });
});

describe('personläget på relationssidan (story 4.3)', () => {
  it('PV1 utan person är varje namn i Personer en länk som behåller ?visa=, inget är valt och tråden är hela relationen', async () => {
    const s = await sida(relationP(orgP));
    expect(s.status, s.text).toBe(200);
    for (const person of [anna, bertil, cecilia, doris]) {
      expect(s.text, person).toContain(`href="${relationP(orgP)}?visa=allt&amp;person=${person}"`);
    }
    expect(s.text).not.toContain('aria-current="true"');
    expect(s.text).not.toContain('personhuvud-rubrik');
    expect(fragment(s.text)).toHaveLength(10);

    const kontaktfliken = await sida(`${relationP(orgP)}?visa=kontakt`);
    expect(kontaktfliken.status, kontaktfliken.text).toBe(200);
    expect(kontaktfliken.text).toContain(`href="${relationP(orgP)}?visa=kontakt&amp;person=${anna}"`);
  });

  it('PV2 Annas sida: hon är vald, personhuvudet står först i tråden med ursprung, och tråden är hennes fem händelser', async () => {
    const s = await sida(`${relationP(orgP)}?person=${anna}`);
    expect(s.status, s.text).toBe(200);
    expect(s.text.split('aria-current="true"')).toHaveLength(2);
    expect(s.text).toContain(`<a href="${relationP(orgP)}?visa=allt&amp;person=${anna}" class="threadtab is-active" aria-current="true">Anna Andersson</a>`);

    const huvud = personhuvudet(s.text);
    expect(huvud).not.toBe('');
    expect(huvud).toContain('<h2 class="factcard__head" id="personhuvud-rubrik" style="margin:0">Anna Andersson</h2>');
    expect(huvud).toContain('<span class="k">Roll</span>');
    expect(huvud).toMatch(/Beställare <span class="prov prov--guess"[^>]*>✦<\/span>/);
    expect(huvud).toContain('name="field" value="role_title"');
    expect(huvud).toContain(`name="person_id" value="${anna}"`);
    expect(huvud).toContain('<span class="k">E-post</span>');
    expect(huvud).toContain('anna@personbolaget.example');
    expect(huvud).toContain('<span class="k">Telefon</span><span class="v">—</span>');
    const idag = new Date().toISOString().slice(0, 10);
    expect(huvud).toContain(`<span class="k">Senaste kontakt</span><span class="v">2026-02-20 · ${String(daysSince('2026-02-20', idag))} d sedan</span>`);
    expect(huvud).toContain(`<a href="${relationP(orgP)}?visa=allt">← Hela relationen</a>`);
    expect(s.text.indexOf(PERSONHUVUD)).toBeLessThan(s.text.indexOf('class="quickcapture"'));

    const f = fragment(s.text);
    expect(f).toHaveLength(5);
    ANNAS_LISTA.forEach(([, rubrik], i) => expect(f[i], `rad ${i + 1}`).toContain(rubrik));
    expect(s.text).toContain('<p class="muted">Visar 5 händelser, från 2026-02-01 till 2026-02-22.</p>');
    // Rätta i tråden leder tillbaka till personläget.
    expect(f.some((rad) => rad.includes(`name="back" value="${relationP(orgP)}?visa=allt&amp;person=${anna}"`))).toBe(true);
  });

  it('PV3 flikarna behåller personen; kontakt 3, löften 2, och pengar säger i ord att de hör till relationen', async () => {
    const s = await sida(`${relationP(orgP)}?person=${anna}`);
    expect(s.status, s.text).toBe(200);
    for (const flik of ['allt', 'kontakt', 'pengar', 'loften']) {
      expect(s.text, flik).toContain(`href="${relationP(orgP)}?visa=${flik}&amp;person=${anna}"`);
    }

    const kontakter = await sida(`${relationP(orgP)}?visa=kontakt&person=${anna}`);
    expect(kontakter.status, kontakter.text).toBe(200);
    const kf = fragment(kontakter.text);
    expect(kf).toHaveLength(3);
    ['TP-P Anna 3.', 'TP-P Anna 2.', 'TP-P Anna 1.'].forEach((rubrik, i) => expect(kf[i], rubrik).toContain(rubrik));

    const loften = await sida(`${relationP(orgP)}?visa=loften&person=${anna}`);
    expect(loften.status, loften.text).toBe(200);
    expect(fragment(loften.text)).toHaveLength(2);

    const pengar = await sida(`${relationP(orgP)}?visa=pengar&person=${anna}`);
    expect(pengar.status, pengar.text).toBe(200);
    expect(fragment(pengar.text)).toHaveLength(0);
    expect(pengar.text).toContain('Pengar hör till relationen och inte till en person.');
    expect(pengar.text).toContain('Fakturor och betalningar visas i hela relationens tråd.');
    expect(pengar.text).not.toContain('Inget har hänt ännu');
  });

  it('PV4 en person utan kontaktpunkter: huvudet säger det i ord, och personlägets tomläge nämner henne', async () => {
    const s = await sida(`${relationP(orgP)}?person=${cecilia}`);
    expect(s.status, s.text).toBe(200);
    const huvud = personhuvudet(s.text);
    expect(huvud).toContain('id="personhuvud-rubrik" style="margin:0">Cecilia Ceder</h2>');
    expect(huvud).toContain('Ekonomichef');
    expect(huvud).toContain('0701112233');
    expect(huvud).toContain('<span class="k">E-post</span><span class="v">—</span>');
    expect(huvud).toContain('<span class="v">Ingen registrerad kontakt med Cecilia Ceder ännu.</span>');
    // Huvudet, inte sidan: relationens eget faktakort skriver relationens dagar.
    expect(huvud).not.toContain(' d sedan');
    expect(fragment(s.text)).toHaveLength(0);
    expect(s.text).toContain('Inget registrerat med Cecilia Ceder under den här fliken ännu.');
    expect(s.text).not.toContain('Inget har hänt ännu');
  });

  it('PV5 läsvägen bakåt i personläget: 60 + 1, personen följer med åt båda hållen', async () => {
    const lenas = await tradP(orgL, { person_id: lena, limit: 200 });
    expect(lenas).toHaveLength(61);
    const s = await sida(`${relationP(orgL)}?person=${lena}`);
    expect(s.status, s.text).toBe(200);
    expect(fragment(s.text)).toHaveLength(60);
    expect(antalMed(fragment(s.text), 'TP-L första samtalet.')).toBe(0);
    expect(antalMed(fragment(s.text), 'TP-L utan person.')).toBe(0);
    const href = aldreHref(s.text);
    expect(href, 'Äldre händelser →').not.toBeNull();
    const url = new URL(href ?? '', 'http://vy.test');
    expect(url.pathname).toBe(relationP(orgL));
    expect(url.searchParams.get('visa')).toBe('allt');
    expect(url.searchParams.get('person')).toBe(lena);
    expect(url.searchParams.get('fore')).toBe(nyckel(markorAv(lenas[59])));
    expect(s.text).toContain('<p class="muted">Visar 60 händelser, från 2026-01-02 till 2026-03-02.</p>');

    const aldre = await sida(href ?? '');
    expect(aldre.status, aldre.text).toBe(200);
    expect(fragment(aldre.text)).toHaveLength(1);
    expect(antalMed(fragment(aldre.text), 'TP-L första samtalet.')).toBe(1);
    expect(aldre.text).toContain('<p class="muted">Det här är relationens första registrerade händelse.</p>');
    expect(nyasteHref(aldre.text)).toBe(`${relationP(orgL)}?visa=allt&person=${lena}`);
  });

  it('PV6 ogiltig ?person= ger 400 med den fasta texten; en person utanför relationen 404; versaler väljer Anna — aldrig 500', async () => {
    const FEL = 'Adressens person går inte att läsa. Öppna relationen igen och välj personen under Personer.';
    const ogiltiga: Array<[string, string]> = [
      ['V1', `${relationP(orgP)}?person=inte-ett-id`],
      ['V2', `${relationP(orgP)}?person=`],
      ['V3', `${relationP(orgP)}?person=${anna}&person=${anna}`],
    ];
    for (const [namn, adress] of ogiltiga) {
      const s = await sida(adress);
      expect(s.status, `${namn}: ${s.text}`).toBe(400);
      expect(s.text, namn).toContain(FEL);
      expect(s.text, namn).not.toContain('Något gick fel.');
      expect(fragment(s.text), namn).toHaveLength(0);
    }
    const utanfor: Array<[string, string]> = [
      ['V4', `${relationP(orgP)}?person=${olle}`],
      ['V5', `/app/c/${bolag}/relations/${orgA}?person=${anna}`],
      ['V6', `${relationP(orgP)}?person=00000000-0000-4000-8000-000000000000`],
    ];
    for (const [namn, adress] of utanfor) {
      const s = await sida(adress);
      expect(s.status, `${namn}: ${s.text}`).toBe(404);
      expect(s.text, namn).toContain('Hittades inte eller ingen åtkomst.');
    }
    const v7 = await sida(`${relationP(orgP)}?person=${anna.toUpperCase()}`);
    expect(v7.status, v7.text).toBe(200);
    expect(v7.text).toContain(`<a href="${relationP(orgP)}?visa=allt&amp;person=${anna}" class="threadtab is-active" aria-current="true">Anna Andersson</a>`);
  });

  it('PV7 negativ kontroll: «bara personens» håller på Bertils sida och fäller relationssidan utan person', async () => {
    const ANDRA = ['TP-P Anna', 'TP-P utan person.', 'Faktura '];
    const bertils = await sida(`${relationP(orgP)}?person=${bertil}`);
    expect(bertils.status, bertils.text).toBe(200);
    expect(baraPersonens(fragment(bertils.text), 'Bertil Berg', ANDRA)).toBe(true);
    const relationen = await sida(relationP(orgP));
    expect(relationen.status, relationen.text).toBe(200);
    expect(baraPersonens(fragment(relationen.text), 'Bertil Berg', ANDRA)).toBe(false);
  });
});

describe('Rätta personen (story 4.3)', () => {
  const RATTA = (): string => `${relationP(orgP)}/edit?handgrepp=person`;
  const rattaPerson = (body: Record<string, string>) => agent.post(RATTA()).type('form').send(body);
  /** Personens rad ur relationen, med ursprung per fält. */
  async function personrad(org: string, person: string): Promise<{ rad: Rad | undefined; antal: number }> {
    const res = await actP('get_crm_organization', { organization_id: org });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const folk = res.body.result.people as Rad[];
    return { rad: folk.find((p) => p.id === person), antal: folk.length };
  }
  const ursprung = (rad: Rad | undefined, falt: string): unknown =>
    ((rad?.provenance as Record<string, { source?: string }> | undefined)?.[falt])?.source;
  async function auditrader(person: string, matchadPa?: string): Promise<number> {
    return withAdmin(async (db) => Number((await db.query(
      `SELECT count(*)::int AS n FROM crm.audit_log
       WHERE company_id = $1 AND action = 'crm.person_updated' AND entity_id = $2
         AND ($3::text IS NULL OR details->>'matched_on' = $3)`,
      [pbolag, person, matchadPa ?? null])).rows[0]?.n));
  }

  it('PR1 formuläret i huvudet rättar rollen på personens id; rollen blir människans, namnet följer fortfarande källan', async () => {
    const s = await sida(`${relationP(orgP)}?person=${bertil}`);
    expect(s.status, s.text).toBe(200);
    const huvud = personhuvudet(s.text);
    expect(huvud).toContain(`<form method="post" action="${RATTA()}">`);
    expect(huvud).toContain(`name="person_id" value="${bertil}"`);
    expect(huvud).toContain('name="fore_role_title" value=""');

    const back = `${relationP(orgP)}?visa=allt&person=${bertil}`;
    const res = await rattaPerson({
      back, person_id: bertil, name: 'Bertil Berg', fore_name: 'Bertil Berg',
      role_title: 'Projektledare', fore_role_title: '', phone: '', fore_phone: '',
    });
    expect(res.status, res.text).toBe(302);
    expect(res.headers.location).toBe(back);

    const { rad, antal } = await personrad(orgP, bertil);
    expect(rad?.role_title).toBe('Projektledare');
    expect(ursprung(rad, 'role_title')).toBe('human');
    expect(ursprung(rad, 'name')).toBe('sync');
    expect(rad?.email).toBe('bertil@personbolaget.example');
    expect(antal).toBe(4);
    expect(await auditrader(bertil, 'id')).toBe(1);
  });

  it('PR2 ett namnbyte på en person utan e-post ändrar samma rad; negativ kontroll: utan person_id blir ett nytt namn en ny person', async () => {
    const res = await rattaPerson({
      back: `${relationP(orgP)}?visa=allt&person=${doris}`, person_id: doris,
      name: 'Doris Dahlberg', fore_name: 'Doris Dahl', role_title: '', fore_role_title: '', phone: '', fore_phone: '',
    });
    expect(res.status, res.text).toBe(302);
    const { rad, antal } = await personrad(orgP, doris);
    expect(antal).toBe(4);
    expect(rad?.name).toBe('Doris Dahlberg');
    expect(ursprung(rad, 'name')).toBe('human');

    const medId = await actP('upsert_crm_person', { person_id: olle, name: 'Olle Granne Två' });
    expect(medId.status, JSON.stringify(medId.body)).toBe(200);
    expect(medId.body.result.created).toBe(false);
    expect(medId.body.result.id).toBe(olle);
    const utanId = await actP('upsert_crm_person', { name: 'Olle Granne Tre', organization_id: orgG });
    expect(utanId.status, JSON.stringify(utanId.body)).toBe(200);
    expect(utanId.body.result.created).toBe(true);
    expect(utanId.body.result.id).not.toBe(olle);
  });

  it('PR3 en tom roll ändrar ingenting: notisen säger det, raden och auditloggen står still', async () => {
    const fore = await personrad(orgP, bertil);
    const roll = String(fore.rad?.role_title ?? '');
    const auditFore = await auditrader(bertil);
    const back = `${relationP(orgP)}?visa=allt&person=${bertil}`;
    const res = await rattaPerson({
      back, person_id: bertil, name: 'Bertil Berg', fore_name: 'Bertil Berg',
      role_title: '', fore_role_title: roll, phone: '', fore_phone: '',
    });
    expect(res.status, res.text).toBe(302);
    const location = String(res.headers.location ?? '');
    expect(location.startsWith(`${back}&fel=`), location).toBe(true);
    const notis = await sida(location);
    expect(notis.status, notis.text).toBe(200);
    expect(notis.text).toContain('class="notice"');
    expect(notis.text).toContain('Inget att rätta: inget fält ändrades.');

    const efter = await personrad(orgP, bertil);
    expect(efter.rad?.role_title).toBe(fore.rad?.role_title);
    expect(efter.rad?.provenance).toEqual(fore.rad?.provenance);
    expect(await auditrader(bertil)).toBe(auditFore);
  });

  it('PR4 en annan relations person, ett ogiltigt id och ett saknat id ger 404, och ingen rad ändras', async () => {
    const fore = await personrad(orgG, olle);
    expect(fore.rad).toBeDefined();
    const fall: Array<[string, Record<string, string>]> = [
      ['en annan relations person', { person_id: olle }],
      ['ett ogiltigt id', { person_id: 'inte-ett-id' }],
      ['utan person_id', {}],
    ];
    for (const [namn, mal] of fall) {
      const res = await rattaPerson({
        back: relationP(orgP), ...mal, role_title: 'Inkräktare', fore_role_title: '', name: 'Olle Granne', fore_name: 'Olle Granne',
      });
      expect(res.status, `${namn}: ${res.text}`).toBe(404);
    }
    const efter = await personrad(orgG, olle);
    expect(efter.rad?.name).toBe(fore.rad?.name);
    expect(efter.rad?.role_title).toBe(fore.rad?.role_title);
  });
});

describe('vägarna in till personen (story 4.3)', () => {
  /**
   * Det första elementet `tagg` (med klassen, när den anges) som innehåller
   * texten. Öppningstaggen får bära vilka attribut som helst: layouten sätter i
   * efterhand ut roller och etiketter på tabellernas rader (`staplabaraTabeller`
   * i html.ts), så ett mönster på en naken tagg hittar ingenting. Saknas
   * elementet fälls provet här, så att ingen negativ assertion prövas mot en
   * tom sträng.
   */
  function delMed(html: string, tagg: string, text: string, klass?: string): string {
    const oppning = klass === undefined
      ? `<${tagg}\\b[^>]*>`
      : `<${tagg}\\b[^>]*\\bclass="(?:[^"]*\\s)?${klass}(?:\\s[^"]*)?"[^>]*>`;
    const del = (html.match(new RegExp(`${oppning}[\\s\\S]*?</${tagg}>`, 'g')) ?? []).find((f) => f.includes(text));
    expect(del, `<${tagg}${klass === undefined ? '' : `.${klass}`}> med «${text}»`).toBeDefined();
    return del ?? '';
  }

  it('PL1 åtagandevyns Vem leder till personen i hennes relation; en person utan organisation står som text', async () => {
    const s = await sida(`/app/c/${pbolag}/commitments`);
    expect(s.status, s.text).toBe(200);
    // Layoutens tabellrader bär role="row": raden söks på taggen, inte på en naken <tr>.
    expect(s.text).toContain('<tr role="row">');
    const bertils = delMed(s.text, 'tr', 'TP-P Bertils löfte.');
    expect(bertils).toContain(`<a href="/app/c/${pbolag}/relations/${orgP}?person=${bertil}" class="entity">Bertil Berg</a>`);
    const frias = delMed(s.text, 'tr', 'TP-P fritt löfte.');
    expect(frias).toContain('Fria Fransson');
    expect(frias).not.toContain('?person=');

    const res = await actP('list_crm_commitments', { status: 'open' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const rader = res.body.result as Rad[];
    const l2 = rader.find((c) => c.body === 'TP-P Bertils löfte.');
    expect([l2?.person_id, l2?.person_organization_id]).toEqual([bertil, orgP]);
    const fritt = rader.find((c) => c.body === 'TP-P fritt löfte.');
    expect([fritt?.person_id, fritt?.person_organization_id]).toEqual([fria, null]);
  });

  it('PL2 sökträffen på en person leder till personläget; utan organisation är namnet text utan länk', async () => {
    const bertils = await sida(`/app/c/${pbolag}/sok?q=Bertil`);
    expect(bertils.status, bertils.text).toBe(200);
    expect(bertils.text).toContain(`<a href="/app/c/${pbolag}/relations/${orgP}?person=${bertil}" class="sok__t entity">Bertil Berg</a>`);
    const frias = await sida(`/app/c/${pbolag}/sok?q=Fria`);
    expect(frias.status, frias.text).toBe(200);
    const rad = delMed(frias.text, 'li', 'Fria Fransson', 'sok__rad');
    expect(rad).toContain('<span class="sok__t">Fria Fransson</span>');
    expect(rad).not.toContain('href=');
  });

  it('PL3 Idag: kontaktpersonen leder till personläget; ett löfte vars person saknar organisation har namnet som text', async () => {
    const s = await sida(`/app/c/${pbolag}/idag`);
    expect(s.status, s.text).toBe(200);
    // Anna har relationens senaste kontakt (20 februari), och relationen är tyst sedan dess.
    expect(s.text).toContain(`— kontakt: <a href="/app/c/${pbolag}/relations/${orgP}?person=${anna}" class="entity">Anna Andersson</a>`);
    const kort = delMed(s.text, 'article', 'TP-P fritt löfte.', 'today__card');
    expect(kort).toContain('<span class="today__who">Fria Fransson</span>');
    expect(kort).not.toContain('?person=');

    const res = await actP('crm_today', {});
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const fritt = (res.body.result.commitments as Rad[]).find((c) => c.body === 'TP-P fritt löfte.');
    expect([fritt?.person_id, fritt?.person_organization_id]).toEqual([fria, null]);
  });
});

describe('dokumentet (story 4.3)', () => {
  it('PD1 MCP_ACTIONS.md beskriver personläget i ett eget avsnitt efter crm 4.1, utan underrubriker', async () => {
    const text = await readFile(new URL('../../docs/MCP_ACTIONS.md', import.meta.url), 'utf8');
    const RUBRIK = '## Personperspektivet i tråden (crm 4.3)';
    expect(text.split(RUBRIK)).toHaveLength(2);
    const fore = text.indexOf('## Trådens läsväg bakåt (crm 4.1)');
    expect(fore).toBeGreaterThan(-1);
    const start = text.indexOf(RUBRIK);
    expect(start).toBeGreaterThan(fore);
    const resten = text.slice(start + RUBRIK.length);
    const slut = resten.indexOf('\n## ');
    const avsnitt = slut === -1 ? resten : resten.slice(0, slut);
    for (const term of ['get_crm_thread', 'person_id', 'upsert_crm_person', 'name', 'list_crm_commitments', 'crm_today', 'person_organization_id']) {
      expect(avsnitt, term).toContain('`' + term + '`');
    }
    expect(avsnitt.split('\n').filter((rad) => rad.startsWith('### '))).toEqual([]);
  });
});
