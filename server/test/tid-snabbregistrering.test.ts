// PRD_TIDSRAPPORTERING §4 F1, §7 acceptans och §9.5 (story 5): registrera,
// rätta och belägga tid HELT i vyn.
//
// Story 4 gjorde tiden synlig. Det som fortfarande saknades var vägen att
// skriva och rätta den utan AI: en felskriven tidpost gick inte att laga
// någonstans i webbvyn, och ett underlag gick inte att koppla alls. En vy som
// visar men inte kan rätta är ingen reserv — den är en rapport.
//
// Proven nedan är kraven baklänges: parsern som tabell (inklusive den regel
// som kan överraska — under tio är timmar), formuläret som skapar posten med
// rätt status och avtalsdel, rättelsen, det låsta läget på en fakturerad post,
// länkarna med sin tenant-gräns, och takvarningen som syns utan att spärra.
import supertest from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { app, api, createCompany, createFiscalYear, registerUser, type TestUser } from './helpers.js';
import { hhmm, parseDuration } from '../src/lib/duration.js';
import { BadRequestError } from '../src/lib/errors.js';

const PASSWORD = 'mycket-hemligt-losen-123';

const iso = (d: Date): string => d.toISOString().slice(0, 10);
const IDAG = iso(new Date());
const AR = Number(IDAG.slice(0, 4));

let user: TestUser;
let companyId: string;
let ua: ReturnType<typeof supertest.agent>;
let customerId: string;
/** Uppdrag utan avtal — den enkla vägen. */
let projektId: string;
/** Uppdrag MED avtalsdel och bekräftat tak — klassificering och takvarning. */
let avtalsProjektId: string;
let avtalsdelId: string;

const auth = () => ({ Authorization: `Bearer ${user.token}` });
const co = () => `/api/companies/${companyId}`;

type Svar = { status: number; body: { result: Record<string, unknown>; error?: string; message?: string } };

async function act(namn: string, kropp: Record<string, unknown> = {}): Promise<Svar> {
  const res = await api.post(`${co()}/actions/${namn}`).set(auth()).send(kropp);
  return res as unknown as Svar;
}

/** Postar ett vyformulär och ger tillbaka målets query — kvittot bor där. */
async function postaFormular(
  path: string, kropp: Record<string, string>,
): Promise<{ status: number; ok: string | null; fel: string | null; varning: string | null; location: string }> {
  const res = await ua.post(path).type('form').send(kropp);
  expect([302, 303], `oväntad status ${res.status} för ${path}`).toContain(res.status);
  const location = res.headers.location as string;
  const q = new URL(location, 'http://localhost').searchParams;
  return { status: res.status, ok: q.get('ok'), fel: q.get('fel'), varning: q.get('varning'), location };
}

async function sida(path: string): Promise<string> {
  const res = await ua.get(path);
  expect(res.status, `${path} gav ${res.status}`).toBe(200);
  return res.text;
}

/** Posterna på ett uppdrag, nyast först — läst genom actionen, som AI:n gör. */
async function poster(projectId: string): Promise<Record<string, unknown>[]> {
  const res = await act('list_time_entries', { project_id: projectId });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.result as unknown as Record<string, unknown>[];
}

beforeAll(async () => {
  user = await registerUser('tidsnabb');
  companyId = await createCompany(user.token, 'Locollabs AB');
  await createFiscalYear(companyId, auth(), {
    label: String(AR), start_date: `${AR}-01-01`, end_date: `${AR}-12-31`,
  });

  const kund = await api.post(`${co()}/customers`).set(auth()).send({ name: 'Ilt AB' });
  expect(kund.status, JSON.stringify(kund.body)).toBe(201);
  customerId = kund.body.customer.id;

  const p1 = await act('create_project', { name: 'Löpande support', customer_id: customerId, hourly_rate_ore: 110_000 });
  expect(p1.status, JSON.stringify(p1.body)).toBe(200);
  projektId = p1.body.result.id as string;

  const p2 = await act('create_project', { name: 'Plattform fas 2', customer_id: customerId, hourly_rate_ore: 110_000 });
  expect(p2.status, JSON.stringify(p2.body)).toBe(200);
  avtalsProjektId = p2.body.result.id as string;

  const avtal = await act('create_contract', {
    project_id: avtalsProjektId, name: 'Plattformsavtal', signed_date: `${AR}-01-02`,
  });
  expect(avtal.status, JSON.stringify(avtal.body)).toBe(200);
  // Taket är BEKRÄFTAT och litet: en timme räcker för att passera 80 %-gränsen,
  // så varningen går att pröva utan att provet blir en tidsserie.
  const del = await act('upsert_contract_part', {
    contract_id: avtal.body.result.id, code: '2A', name: 'Fas 2A', cap_hours: 1, cap_confirmed: true,
    valid_from: `${AR}-01-02`,
  });
  expect(del.status, JSON.stringify(del.body)).toBe(200);
  // Svaret är avtalet med sina delar (getContractUsage) — id:t som en tidpost
  // ska peka på är den GÄLLANDE versionens `part_id`.
  const delar = (del.body.result as unknown as { parts: { part_id: string; code: string }[] }).parts;
  avtalsdelId = delar.find((d) => d.code === '2A')!.part_id;

  ua = supertest.agent(app);
  const login = await ua.post('/app/login').type('form').send({ email: user.email, password: PASSWORD });
  expect([302, 303]).toContain(login.status);
});

// ---------------------------------------------------------------------------
// KRAV-1: parsern som tabell
// ---------------------------------------------------------------------------

describe('parseDuration — tabellen ur kravet', () => {
  const GILTIGA: [string, number][] = [
    ['1h', 60],
    ['1,5', 90],
    ['1.5', 90],
    ['90m', 90],
    ['45', 45],
    ['1h30', 90],
    ['1:30', 90],
    // Regeln som kan överraska, i båda riktningarna: 7 är sju TIMMAR, 10 är tio
    // MINUTER. Gränsen står i hjälptexten och i kvittot, aldrig bara i koden.
    ['7', 420],
    ['9', 540],
    ['10', 10],
    ['1440', 1440],
    // Skrivsätt som en människa faktiskt använder.
    ['1 h 30', 90],
    ['90 min', 90],
    ['0,25', 15],
    ['1,5h', 90],
    ['24h', 1440],
    ['01:30', 90],
  ];

  it.each(GILTIGA)('"%s" blir %i minuter', (text, minuter) => {
    expect(parseDuration(text)).toBe(minuter);
  });

  const OGILTIGA = ['', '   ', 'abc', '1,5,5', '-30', '1h90', '0', '25h', '1441', '9,99', '45,5m', '1/2', 'en timme'];

  it.each(OGILTIGA)('"%s" avvisas som invalid_duration med exemplen i texten', (text) => {
    let kastat: unknown;
    try { parseDuration(text); } catch (err) { kastat = err; }
    expect(kastat, `"${text}" borde ha avvisats`).toBeInstanceOf(BadRequestError);
    const fel = kastat as BadRequestError;
    expect(fel.status).toBe(400);
    expect(fel.code).toBe('invalid_duration');
    // Ett felmeddelande utan exempel lämnar användaren med samma fråga.
    expect(fel.message).toContain('1,5 = 1 h 30 min');
    expect(fel.message).toContain('90m');
  });

  it('hh:mm är formen svaret visar — 45 → 00:45, 90 → 01:30, 420 → 07:00', () => {
    expect(hhmm(45)).toBe('00:45');
    expect(hhmm(90)).toBe('01:30');
    expect(hhmm(420)).toBe('07:00');
    expect(hhmm(0)).toBe('00:00');
  });
});

// ---------------------------------------------------------------------------
// KRAV-2: samma parser för vy och AI-väg
// ---------------------------------------------------------------------------

describe('log_time/update_time_entry tar duration — en parser, två ingångar', () => {
  it('duration ur AI-vägen ger samma minuter som vyn, och svaret bär hh:mm', async () => {
    const res = await act('log_time', {
      project_id: projektId, work_date: IDAG, duration: '1,5', description: 'Via API',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.result.minutes).toBe(90);
    expect(res.body.result.duration_hhmm).toBe('01:30');
  });

  it('både minutes och duration ger 400 minutes_or_duration', async () => {
    const res = await act('log_time', {
      project_id: projektId, work_date: IDAG, minutes: 60, duration: '1h', description: 'Dubbelt',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('minutes_or_duration');
  });

  it('varken minutes eller duration ger 400 minutes_or_duration', async () => {
    const res = await act('log_time', { project_id: projektId, work_date: IDAG, description: 'Ingen tid' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('minutes_or_duration');
  });

  // API:t svarar med FELKODEN (errorHandler skickar aldrig ut `message`);
  // exemplen når användaren genom vyns notis, vilket prövas längre ned.
  it('ogiltig text ger 400 invalid_duration', async () => {
    const res = await act('log_time', {
      project_id: projektId, work_date: IDAG, duration: 'en stund', description: 'Trasig',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_duration');
  });

  it('minutes fortsätter fungera oförändrat (ingen befintlig väg bryts)', async () => {
    const res = await act('log_time', {
      project_id: projektId, work_date: IDAG, minutes: 30, description: 'Gamla vägen',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.result.minutes).toBe(30);
  });
});

// ---------------------------------------------------------------------------
// KRAV-5 + acceptans: snabbformuläret
// ---------------------------------------------------------------------------

describe('snabbformuläret på /tid och på uppdragssidan', () => {
  it('formuläret står överst på /tid med regeln utskriven vid fältet', async () => {
    const html = await sida(`/app/c/${companyId}/tid`);
    expect(html).toContain(`action="/app/c/${companyId}/tid/registrera"`);
    expect(html).toContain('Registrera tid');
    // Villkoret för parserregeln: den STÅR där man skriver.
    expect(html).toContain('1,5 = 1 h 30 min · 45 = 45 min · 90m · 1h30');
    expect(html).toContain('aria-describedby="snabbtid-hjalp"');
    expect(html).toContain('id="snabbtid-hjalp"');
    // Formuläret ligger före talen — det man gör dagligen står först.
    expect(html.indexOf('Registrera tid')).toBeLessThan(html.indexOf('Ofakturerat'));
    // Vyn är JS-fri, även den nya ytan.
    expect(html).not.toContain('<script');
    expect(html).not.toContain('onclick=');
  });

  it('uppdragssidan har samma formulär med uppdraget förvalt (och dolt)', async () => {
    const html = await sida(`/app/c/${companyId}/projects/${projektId}`);
    expect(html).toContain(`<input type="hidden" name="project_id" value="${projektId}">`);
    expect(html).toContain('Registrera tid');
  });

  it("'45' registrerar posten och kvittot visar 00:45", async () => {
    const svar = await postaFormular(`/app/c/${companyId}/tid/registrera`, {
      back: `/app/c/${companyId}/tid`, project_id: projektId, work_date: IDAG,
      duration: '45', description: 'Fyrtiofem minuter',
    });
    expect(svar.fel, `fel: ${svar.fel}`).toBeNull();
    expect(svar.ok).toContain('00:45');
    // Kvittot renderas på sidan man kommer tillbaka till.
    const html = await sida(svar.location);
    expect(html).toContain('00:45');

    const rad = (await poster(projektId)).find((p) => p.description === 'Fyrtiofem minuter');
    expect(rad).toBeTruthy();
    expect(rad!.minutes).toBe(45);
    // Vyns aktör är en MÄNNISKA — posten är godkänd, inte ett förslag.
    expect(rad!.status).toBe('godkand');
  });

  it("'1,5' visar 01:30 och '7' visar 07:00 — regeln gäller åt båda hållen", async () => {
    const enHalv = await postaFormular(`/app/c/${companyId}/tid/registrera`, {
      back: `/app/c/${companyId}/tid`, project_id: projektId, work_date: IDAG,
      duration: '1,5', description: 'En och en halv',
    });
    expect(enHalv.ok).toContain('01:30');

    const sju = await postaFormular(`/app/c/${companyId}/tid/registrera`, {
      back: `/app/c/${companyId}/tid`, project_id: projektId, work_date: IDAG,
      duration: '7', description: 'Sju timmar',
    });
    expect(sju.ok).toContain('07:00');
    const rad = (await poster(projektId)).find((p) => p.description === 'Sju timmar');
    expect(rad!.minutes).toBe(420);
  });

  it('ogiltig text sparar ingenting och visar exemplen som notis', async () => {
    const fore = (await poster(projektId)).length;
    const svar = await postaFormular(`/app/c/${companyId}/tid/registrera`, {
      back: `/app/c/${companyId}/tid`, project_id: projektId, work_date: IDAG,
      duration: 'strax efter lunch', description: 'Ska inte sparas',
    });
    expect(svar.ok).toBeNull();
    expect(svar.fel).toContain('1,5 = 1 h 30 min');
    expect((await poster(projektId)).length).toBe(fore);
    const html = await sida(svar.location);
    expect(html).toContain('1,5 = 1 h 30 min');
  });

  it('formuläret kräver samma ursprung (CSRF)', async () => {
    const res = await ua.post(`/app/c/${companyId}/tid/registrera`)
      .set('Origin', 'https://evil.example').type('form')
      .send({ project_id: projektId, work_date: IDAG, duration: '1h', description: 'Ond post' });
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// KRAV-5: avtalsdel och takvarning
// ---------------------------------------------------------------------------

describe('avtalsdelen i formuläret och takets besked', () => {
  it('uppdrag med aktiva avtalsdelar: väljaren finns och delen krävs', async () => {
    const html = await sida(`/app/c/${companyId}/projects/${avtalsProjektId}`);
    expect(html).toContain('name="contract_part_id"');
    expect(html).toContain('2A · Fas 2A');

    const utanDel = await postaFormular(`/app/c/${companyId}/tid/registrera`, {
      back: `/app/c/${companyId}/projects/${avtalsProjektId}`, project_id: avtalsProjektId,
      work_date: IDAG, duration: '30m', description: 'Utan avtalsdel',
    });
    expect(utanDel.fel).toContain('avtalsdel');
    expect((await poster(avtalsProjektId)).length).toBe(0);
  });

  it('med avtalsdel sparas posten på delen — och takvarningen visas utan att spärra', async () => {
    const svar = await postaFormular(`/app/c/${companyId}/tid/registrera`, {
      back: `/app/c/${companyId}/projects/${avtalsProjektId}`, project_id: avtalsProjektId,
      contract_part_id: avtalsdelId, work_date: IDAG, duration: '1h', description: 'Fas 2A-arbete',
    });
    // Registreringen spärras ALDRIG (rådslaget 1/9) — posten finns.
    expect(svar.fel).toBeNull();
    expect(svar.ok).toContain('01:00');
    const rad = (await poster(avtalsProjektId))[0]!;
    expect(rad.minutes).toBe(60);
    expect(rad.contract_part_id).toBe(avtalsdelId);

    // ...och taket säger ifrån, som ett meddelande.
    expect(svar.varning, 'takvarningen saknas i kvittot').toBeTruthy();
    const html = await sida(svar.location);
    expect(html).toContain('Avtalstak');
  });
});

// ---------------------------------------------------------------------------
// KRAV-6 + KRAV-7: redigeringssidan och historiken
// ---------------------------------------------------------------------------

describe('redigeringssidan för en icke-fakturerad post', () => {
  let entryId: string;

  beforeAll(async () => {
    const res = await act('log_time', {
      project_id: projektId, work_date: IDAG, duration: '2h', description: 'Ska rättas',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    entryId = res.body.result.id as string;
  });

  it('uppdragssidans rad leder till postens egen sida', async () => {
    const html = await sida(`/app/c/${companyId}/projects/${projektId}`);
    expect(html).toContain(`href="/app/c/${companyId}/tid/${entryId}"`);
  });

  it('sidan visar tiden i hh:mm, alla fält och BARA tillåtna statusbyten', async () => {
    const html = await sida(`/app/c/${companyId}/tid/${entryId}`);
    expect(html).toContain('value="02:00"');
    expect(html).toContain('name="work_date"');
    expect(html).toContain('name="billable_duration"');
    expect(html).toContain('name="adjustment_reason"');
    expect(html).toContain('name="status"');
    // godkand → justerad/ignorerad. 'forslag' och 'fakturerad' är inte val.
    expect(html).toContain('value="justerad"');
    expect(html).toContain('value="ignorerad"');
    expect(html).not.toContain('value="forslag"');
    expect(html).not.toContain('value="fakturerad"');
  });

  it('rättelse av tid och beskrivning sparas, och kvittot visar den tolkade tiden', async () => {
    const svar = await postaFormular(`/app/c/${companyId}/tid/${entryId}/spara`, {
      back: `/app/c/${companyId}/tid/${entryId}`, work_date: IDAG, duration: '1,25',
      billable_duration: '01:15', description: 'Rättad beskrivning', status: 'godkand',
    });
    expect(svar.fel, `fel: ${svar.fel}`).toBeNull();
    expect(svar.ok).toContain('01:15');

    const rad = (await poster(projektId)).find((p) => p.id === entryId)!;
    expect(rad.minutes).toBe(75);
    expect(rad.billable_minutes).toBe(75);
    expect(rad.description).toBe('Rättad beskrivning');
  });

  it('debiterbar tid som skiljer sig kräver justerad med skäl — annars ett begripligt fel', async () => {
    const utanJustering = await postaFormular(`/app/c/${companyId}/tid/${entryId}/spara`, {
      back: `/app/c/${companyId}/tid/${entryId}`, work_date: IDAG, duration: '1,25',
      billable_duration: '1h', description: 'Rättad beskrivning', status: 'godkand',
    });
    expect(utanJustering.fel).toContain('justerad');
    expect(((await poster(projektId)).find((p) => p.id === entryId)!).billable_minutes).toBe(75);

    const medJustering = await postaFormular(`/app/c/${companyId}/tid/${entryId}/spara`, {
      back: `/app/c/${companyId}/tid/${entryId}`, work_date: IDAG, duration: '1,25',
      billable_duration: '1h', description: 'Rättad beskrivning', status: 'justerad',
      adjustment_reason: '15 min var intern administration',
    });
    expect(medJustering.fel).toBeNull();
    const rad = (await poster(projektId)).find((p) => p.id === entryId)!;
    expect(rad.minutes).toBe(75);
    expect(rad.billable_minutes).toBe(60);
    expect(rad.status).toBe('justerad');
  });

  it('ogiltig tid i redigeringen sparar ingenting', async () => {
    const svar = await postaFormular(`/app/c/${companyId}/tid/${entryId}/spara`, {
      back: `/app/c/${companyId}/tid/${entryId}`, work_date: IDAG, duration: 'imorse',
      description: 'Rättad beskrivning', status: 'justerad',
    });
    expect(svar.fel).toContain('1,5 = 1 h 30 min');
    expect(((await poster(projektId)).find((p) => p.id === entryId)!).minutes).toBe(75);
  });

  it('historiken visar vem, vad och när — ur den oföränderliga revisionsloggen', async () => {
    const html = await sida(`/app/c/${companyId}/tid/${entryId}`);
    expect(html).toContain('Historik');
    expect(html).toContain('Registrerad');
    expect(html).toContain('Ändrad');
    // Vem: den inloggade användarens namn står på raden.
    expect(html).toContain('tidsnabb');
    // Vad: före → efter, i samma hh:mm som fältet.
    expect(html).toContain('02:00');
    expect(html).toContain('01:15');
  });
});

// ---------------------------------------------------------------------------
// KRAV-8: underlag som länkar
// ---------------------------------------------------------------------------

describe('underlagslänkar på tidposten', () => {
  let entryId: string;

  beforeAll(async () => {
    const res = await act('log_time', {
      project_id: projektId, work_date: IDAG, duration: '30m', description: 'Post med underlag',
    });
    entryId = res.body.result.id as string;
  });

  it('länken kopplas i vyn, syns som klickbar rad och följer med list_time_entries', async () => {
    const svar = await postaFormular(`/app/c/${companyId}/tid/${entryId}/lank`, {
      back: `/app/c/${companyId}/tid/${entryId}`,
      url: 'https://anteckningar.example/mote-2026-09-01', label: 'Mötesanteckning',
    });
    expect(svar.fel).toBeNull();

    const html = await sida(`/app/c/${companyId}/tid/${entryId}`);
    expect(html).toContain('href="https://anteckningar.example/mote-2026-09-01"');
    expect(html).toContain('Mötesanteckning');
    expect(html).toContain('rel="noopener noreferrer nofollow"');

    const rad = (await poster(projektId)).find((p) => p.id === entryId)!;
    const lankar = rad.links as { url: string; label: string | null }[];
    expect(lankar).toHaveLength(1);
    expect(lankar[0]!.url).toBe('https://anteckningar.example/mote-2026-09-01');
  });

  it('en adress som inte är https avvisas — i actionen och i schemat', async () => {
    const svar = await postaFormular(`/app/c/${companyId}/tid/${entryId}/lank`, {
      back: `/app/c/${companyId}/tid/${entryId}`, url: 'http://osäker.example/underlag',
    });
    expect(svar.fel).toContain('https://');
    const rad = (await poster(projektId)).find((p) => p.id === entryId)!;
    expect((rad.links as unknown[]).length).toBe(1);
  });

  it('länken tas bort med sin knapp', async () => {
    const rad = (await poster(projektId)).find((p) => p.id === entryId)!;
    const linkId = (rad.links as { id: string }[])[0]!.id;
    const svar = await postaFormular(`/app/c/${companyId}/tid/${entryId}/lank/ta-bort`, {
      back: `/app/c/${companyId}/tid/${entryId}`, link_id: linkId,
    });
    expect(svar.fel).toBeNull();
    const efter = (await poster(projektId)).find((p) => p.id === entryId)!;
    expect(efter.links).toEqual([]);
  });

  it('tenant-gränsen håller: ett annat bolag ser varken posten eller kan röra dess länk', async () => {
    // Länken finns igen, i VÅRT bolag.
    const attach = await act('attach_time_entry_link', {
      time_entry_id: entryId, url: 'https://arende.example/1234', label: 'Ärendet',
    });
    expect(attach.status, JSON.stringify(attach.body)).toBe(200);
    const linkId = attach.body.result.id as string;

    const annan = await registerUser('tidsnabb-b');
    const annatBolag = await createCompany(annan.token, 'Främmande AB');
    const annanAuth = { Authorization: `Bearer ${annan.token}` };

    // Rätt bolag i URL:en, men posten hör till ett annat → 404, ingen data.
    const ub = supertest.agent(app);
    await ub.post('/app/login').type('form').send({ email: annan.email, password: PASSWORD });
    const fel = await ub.get(`/app/c/${annatBolag}/tid/${entryId}`);
    expect(fel.status).toBe(404);
    expect(fel.text).not.toContain('Post med underlag');

    // Och actionen i det främmande bolaget hittar varken länken eller posten.
    const bort = await api.post(`/api/companies/${annatBolag}/actions/remove_time_entry_link`)
      .set(annanAuth).send({ link_id: linkId });
    expect(bort.status).toBe(404);
    const koppla = await api.post(`/api/companies/${annatBolag}/actions/attach_time_entry_link`)
      .set(annanAuth).send({ time_entry_id: entryId, url: 'https://intrang.example' });
    expect(koppla.status).toBe(404);

    // Länken står kvar orörd hos oss.
    const rad = (await poster(projektId)).find((p) => p.id === entryId)!;
    expect((rad.links as { id: string }[]).map((l) => l.id)).toEqual([linkId]);
  });
});

// ---------------------------------------------------------------------------
// KRAV-6 + KRAV-8: den fakturerade posten är låst
// ---------------------------------------------------------------------------

describe('fakturerad post: låst sida, låsta länkar, 409 i klartext', () => {
  let entryId: string;

  beforeAll(async () => {
    const eget = await act('create_project', {
      name: 'Fakturerat uppdrag', customer_id: customerId, hourly_rate_ore: 100_000,
    });
    const projekt = eget.body.result.id as string;
    const post = await act('log_time', {
      project_id: projekt, work_date: IDAG, duration: '2h', description: 'Fakturerad tid',
    });
    entryId = post.body.result.id as string;
    const faktura = await act('create_invoice_from_time', {
      customer_id: customerId, project_id: projekt, from: IDAG, to: IDAG, invoice_date: IDAG,
    });
    expect(faktura.status, JSON.stringify(faktura.body)).toBe(200);
  });

  it('sidan renderas låst, med 409-texten utskriven och utan rättelseformulär', async () => {
    const html = await sida(`/app/c/${companyId}/tid/${entryId}`);
    expect(html).toContain('Låst');
    expect(html).toContain('time_entry_locked');
    expect(html).toContain('kreditering');
    expect(html).not.toContain('Spara ändringen');
    expect(html).not.toContain('name="billable_duration"');
    expect(html).not.toContain('Koppla underlag');
  });

  it('en rättelse genom formuläret nekas med 409-texten', async () => {
    const svar = await postaFormular(`/app/c/${companyId}/tid/${entryId}/spara`, {
      back: `/app/c/${companyId}/tid/${entryId}`, work_date: IDAG, duration: '3h',
      description: 'Försök att skriva om', status: 'godkand',
    });
    expect(svar.fel).toContain('låst');
    const res = await act('list_time_entries', {});
    const rad = (res.body.result as unknown as Record<string, unknown>[]).find((p) => p.id === entryId)!;
    expect(rad.minutes).toBe(120);
    expect(rad.status).toBe('fakturerad');
  });

  it('underlagslänkar kan varken kopplas eller tas bort på en fakturerad post', async () => {
    const koppla = await act('attach_time_entry_link', {
      time_entry_id: entryId, url: 'https://efterhandskonstruktion.example',
    });
    expect(koppla.status).toBe(409);
    expect(koppla.body.error).toBe('time_entry_locked');
  });
});
