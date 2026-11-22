// FR-32 (story 5.4): ett löfte som sades i ett samtal registreras ofta dagen
// efter. Utan fältet Lovades i Lova något får det registreringsdagen som
// löftestid, och tråden påstår då att löftet gavs en dag det inte gavs. Ett
// datum i framtiden vore lika fel åt andra hållet: en förfalskning av när löftet
// gavs. Provet låser regeln som ren funktion med fasta klockor och går sedan
// genom hela stacken (inloggning, vy-POST:en, runViewAction, executeAction,
// tenanttransaktionen, Postgres). Facit är literaler eller provets egna
// avläsningar av klockan, aldrig hämtade ur koden som prövas.
import supertest from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { promisedAtFromForm } from '../src/lib/crmRules.js';
import { api, app, createCompany, registerUser, withAdmin, type TestUser } from './helpers.js';

const PASSWORD = 'mycket-hemligt-losen-123';

/**
 * UTC-datumet n dagar från provets ögonblick. Klockan läses en gång för hela
 * filen, så fixturen och facit räknar varje datum ur samma ögonblick, också när
 * körningen korsar UTC-midnatt mellan beforeAll och ett fall.
 */
const NU = Date.now();
const dag = (n: number): string => new Date(NU + n * 86_400_000).toISOString().slice(0, 10);

/** Löftestiden som postas: alltid bakåt i tiden. */
const LOVADES = '2026-09-15';
const SENAST_S1 = dag(30);
/** Två dagar fram, så att en körning som korsar UTC-midnatt inte gör det till i dag. */
const FRAMTID = dag(2);

let user: TestUser;
let granne: TestUser;
let bolag: string;
let grannbolag: string;
let relation: string;
let grannrelation: string;
let agent: ReturnType<typeof supertest.agent>;

/** En åtgärd genom REST; statusen asserteras med kroppen i meddelandet. */
async function atgard(bolagId: string, token: string, namn: string, indata: Record<string, unknown>, status = 200) {
  const r = await api.post(`/api/companies/${bolagId}/actions/${namn}`)
    .set('Authorization', `Bearer ${token}`).send(indata);
  expect(r.status, JSON.stringify(r.body)).toBe(status);
  return r.body;
}

/** En sida i vyn med den inloggade agenten. */
async function las(sokvag: string): Promise<string> {
  const r = await agent.get(sokvag);
  expect(r.status, r.text).toBe(200);
  return r.text;
}

/** Formuläret Lova något, från öppningstaggen till och med sitt </details>. */
function blocket(sida: string): string {
  const start = sida.indexOf('<details class="loftesform">');
  expect(start, 'formuläret Lova något').toBeGreaterThanOrEqual(0);
  const slut = sida.indexOf('</details>', start);
  expect(slut, 'formulärets </details>').toBeGreaterThan(start);
  return sida.slice(start, slut + '</details>'.length);
}

interface Postning { status: number; location: string; fore: number; efter: number }

/** En POST som formulär med den inloggade agenten, med klockan läst före och efter. */
async function posta(sokvag: string, falt: Record<string, string>): Promise<Postning> {
  const fore = Date.now();
  const r = await agent.post(sokvag).type('form').send(falt);
  const efter = Date.now();
  const location: unknown = r.headers.location;
  return { status: r.status, location: typeof location === 'string' ? location : '', fore, efter };
}

/** Texten som den syns: varje tagg blir ett blanksteg. */
function synlig(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Första händelsen i tråden som innehåller texten (samma uttryck som 5.2:s prov). */
function handelsen(sida: string, text: string): string {
  const fragment = (sida.match(/<li class="thread__ev">[\s\S]*?<\/li>/g) ?? []).find((del) => del.includes(text));
  expect(fragment, `händelsen ${text}`).toBeDefined();
  return fragment!;
}

/** Första tabellraden som innehåller texten. */
function radenMed(sida: string, text: string): string {
  const rad = sida.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/g)?.find((del) => del.includes(text));
  expect(rad, `raden ${text}`).toBeDefined();
  return rad!;
}

/** Innehållet i cellen som staplingen gett etiketten. */
function cellen(rad: string, etikett: string): string {
  const m = new RegExp(`<td\\b[^>]*\\bdata-etikett="${etikett}"[^>]*>([\\s\\S]*?)<\\/td>`).exec(rad);
  expect(m, `cellen ${etikett}`).not.toBeNull();
  return m![1]!;
}

/** Texterna för bolagets alla löften, sorterade, läst som ägare. */
async function bolagetsLoften(bolagId: string): Promise<string[]> {
  return withAdmin(async (db) => (await db.query<{ body: string }>(
    'SELECT body FROM crm.commitments WHERE company_id = $1', [bolagId])).rows.map((r) => r.body).sort());
}

/** Antalet löften i hela tabellen, alla bolag, vars text är någon av texterna. */
async function loftenMedText(texter: string[]): Promise<number> {
  return withAdmin(async (db) => Number((await db.query<{ n: string }>(
    'SELECT count(*) AS n FROM crm.commitments WHERE body = ANY($1::text[])', [texter])).rows[0]?.n));
}

/** Löftets ursprungsrader som (fält, ursprung, källsystem, källnyckel), sorterade på fält. */
async function ursprungen(id: string): Promise<[string, string, string | null, string | null][]> {
  return withAdmin(async (db) => (await db.query<{
    field: string; source: string; source_system: string | null; source_ref: string | null;
  }>(
    'SELECT field, source, source_system, source_ref FROM crm.field_provenance WHERE company_id = $1 AND commitment_id = $2 ORDER BY field',
    [bolag, id])).rows.map((r): [string, string, string | null, string | null] => [r.field, r.source, r.source_system, r.source_ref]));
}

/** Detaljerna i senaste auditraden för löftets registrering. */
async function auditen(id: string): Promise<Record<string, unknown> | undefined> {
  return withAdmin(async (db) => (await db.query<{ details: Record<string, unknown> }>(
    `SELECT details FROM crm.audit_log WHERE company_id = $1 AND entity_id = $2 AND action = 'crm.commitment_recorded'
     ORDER BY id DESC LIMIT 1`, [bolag, id])).rows[0]?.details);
}

beforeAll(async () => {
  user = await registerUser('loftesform');
  granne = await registerUser('loftesform-granne');
  bolag = await createCompany(user.token, 'Löftesformen AB');
  grannbolag = await createCompany(granne.token, 'Grannbolaget Löftesform AB');
  relation = (await atgard(bolag, user.token, 'upsert_crm_organization', { name: 'Löftesformens kund AB' })).result.id as string;
  grannrelation = (await atgard(grannbolag, granne.token, 'upsert_crm_organization', { name: 'Grannens löftesrelation AB' })).result.id as string;
  agent = supertest.agent(app);
  const login = await agent.post('/app/login').type('form').send({ email: user.email, password: PASSWORD });
  expect(login.status, JSON.stringify(login.body)).toBe(302);
});

describe('löftestiden ur formuläret', () => {
  const KL = new Date('2026-11-22T10:15:00.000Z');
  const FORE_MIDNATT = new Date('2026-11-22T23:59:59.000Z');
  const MIDNATT = new Date('2026-11-23T00:00:00.000Z');
  const FRAMTIDSFEL = { ok: false, code: 'occurred_at_in_future', message: 'Ett löfte kan inte ha getts i framtiden.' };

  it('L1 tomt, blanktecken, utelämnat och null ger anropstillfället', () => {
    for (const varde of [undefined, null, '', '   ']) {
      expect(promisedAtFromForm(varde, KL), JSON.stringify(varde)).toEqual({ ok: true, occurred_at: '2026-11-22T10:15:00.000Z' });
    }
  });

  it('L2 ett datum bakåt i tiden blir kl. 12.00 UTC samma dag, också med blanktecken runt', () => {
    expect(promisedAtFromForm('2026-09-15', KL)).toEqual({ ok: true, occurred_at: '2026-09-15T12:00:00Z' });
    expect(promisedAtFromForm(' 2026-09-15 ', KL)).toEqual({ ok: true, occurred_at: '2026-09-15T12:00:00Z' });
    expect(promisedAtFromForm('2026-11-21', KL)).toEqual({ ok: true, occurred_at: '2026-11-21T12:00:00Z' });
  });

  it('L3 dagens datum ger nuet, så att löftet inte hamnar senare i dag', () => {
    expect(promisedAtFromForm('2026-11-22', KL)).toEqual({ ok: true, occurred_at: '2026-11-22T10:15:00.000Z' });
  });

  it('L4 ett datum efter i dag avvisas med formulärets text', () => {
    expect(promisedAtFromForm('2026-11-23', KL)).toEqual(FRAMTIDSFEL);
    expect(promisedAtFromForm('2099-01-01', KL)).toEqual(FRAMTIDSFEL);
    // En handskriven tidpunkt med zon klarar åtgärdens schema och får inte kringgå spärren.
    expect(promisedAtFromForm('2099-01-01T00:00:00Z', KL)).toEqual(FRAMTIDSFEL);
  });

  it('L5 ett ogiltigt datum och en ogiltig typ lämnas åt åtgärdens schema', () => {
    expect(promisedAtFromForm('2026-02-30', KL)).toEqual({ ok: true, occurred_at: '2026-02-30' });
    expect(promisedAtFromForm(['2026-09-15'], KL)).toEqual({ ok: true, occurred_at: ['2026-09-15'] });
  });

  it('L6 i dag är UTC-dagen: dagen efter avvisas en sekund före midnatt och godtas vid midnatt', () => {
    expect(promisedAtFromForm('2026-11-23', FORE_MIDNATT)).toEqual(FRAMTIDSFEL);
    expect(promisedAtFromForm('2026-11-23', MIDNATT)).toEqual({ ok: true, occurred_at: '2026-11-23T00:00:00.000Z' });
  });
});

describe('formuläret Lova något', () => {
  it('F1 Vad, Vem lovar, Senast och det valfria fältet Lovades med max i dag, i den ordningen', async () => {
    const fore = new Date().toISOString().slice(0, 10);
    const sida = await las(`/app/c/${bolag}/relations/${relation}`);
    const efter = new Date().toISOString().slice(0, 10);
    const form = blocket(sida);
    // Den exakta markupen utesluter required och ett förifyllt värde på fältet.
    expect(form.match(/name="occurred_at"/g) ?? [], form).toHaveLength(1);
    const vad = form.indexOf('<label>Vad<input type="text" name="body"');
    const vem = form.indexOf('<label>Vem lovar<select name="direction">');
    const senast = form.indexOf('<label>Senast<input type="date" name="due_date"></label>');
    const lovades = [fore, efter]
      .map((d) => form.indexOf(`<label>Lovades<input type="date" name="occurred_at" max="${d}"></label>`))
      .find((i) => i >= 0) ?? -1;
    const knapp = form.indexOf('Spara löftet');
    expect(vad, form).toBeGreaterThanOrEqual(0);
    expect(vem, form).toBeGreaterThan(vad);
    expect(senast, form).toBeGreaterThan(vem);
    expect(lovades, form).toBeGreaterThan(senast);
    expect(knapp, form).toBeGreaterThan(lovades);
  });

  it('F2 formulärets mål, hint och knapp är oförändrade', async () => {
    const form = blocket(await las(`/app/c/${bolag}/relations/${relation}`));
    expect(form).toContain(`action="/app/c/${bolag}/relations/${relation}/commit"`);
    expect(form).toContain('<input type="hidden" name="back"');
    expect(form).toContain('<button class="btn btn--primary btn--sm" type="submit">Spara löftet</button>');
    expect(form).toContain('<p class="hint">Löften ur ärenden märkta Väntar-extern kommer in av sig själva. Det här är för det som sades i ett samtal eller möte.</p>');
  });
});

describe('Lova något genom hela stacken', () => {
  interface Loftesrad {
    id: string; body: string; direction: string; due_date: string | null; occurred_at: string; created_at: string;
    source_system: string; source_ref: string | null; organization_id: string | null;
  }

  /** Raden i bolagets öppna löften, genom REST → list_crm_commitments. */
  async function loftet(text: string): Promise<Loftesrad> {
    const rader = (await atgard(bolag, user.token, 'list_crm_commitments', { status: 'open' })).result as Loftesrad[];
    const rad = rader.find((c) => c.body === text);
    expect(rad, `löftet ${text}`).toBeDefined();
    return rad!;
  }

  let postA: Postning;
  let postB: Postning;
  let postC: Postning;
  let postD: Postning;
  let postE: Postning;
  let postF: Postning;
  let postG: Postning;
  let postH: Postning;
  let postI: Postning;
  let antalForeF: number;
  let antalEfterG: number;

  beforeAll(async () => {
    const back = `/app/c/${bolag}/relations/${relation}`;
    const commit = `${back}/commit`;
    postA = await posta(commit, { back, body: 'Skicka tidplanen S1.', direction: 'we_owe', due_date: SENAST_S1, occurred_at: LOVADES });
    postB = await posta(commit, { back, body: 'Tomt fält S3a.', direction: 'they_owe', occurred_at: '' });
    postC = await posta(commit, { back, body: 'Utelämnat fält S3b.', direction: 'we_owe' });
    // Ingen max följer med en POST: webbläsarens spärr är kringgången.
    postD = await posta(commit, { back, body: 'Framtida löfte S4a.', direction: 'we_owe', occurred_at: FRAMTID });
    postE = await posta(commit, { back, body: 'Framtida löfte S4b.', direction: 'we_owe', occurred_at: '2099-01-01' });
    antalForeF = (await bolagetsLoften(bolag)).length;
    postF = await posta(commit, { back, body: '', direction: 'we_owe', occurred_at: LOVADES });
    postG = await posta(commit, { back, body: '   ', direction: 'we_owe' });
    antalEfterG = (await bolagetsLoften(bolag)).length;
    postH = await posta(`/app/c/${bolag}/relations/${grannrelation}/commit`, { body: 'Fel bolag S7a.', direction: 'we_owe' });
    postI = await posta(`/app/c/${grannbolag}/relations/${grannrelation}/commit`, { body: 'Fel bolag S7b.', direction: 'we_owe' });
  });

  it('S1 ett datum bakåt blir löftestiden kl. 12.00 UTC, källan manual och registreringstiden databasens', async () => {
    expect(postA.status).toBe(302);
    expect(postA.location).toBe(`/app/c/${bolag}/relations/${relation}`);
    const rad = await loftet('Skicka tidplanen S1.');
    expect(rad.occurred_at).toBe('2026-09-15T12:00:00.000Z');
    expect(rad.due_date).toBe(SENAST_S1);
    expect(rad.direction).toBe('we_owe');
    expect(rad.source_system).toBe('manual');
    expect(rad.source_ref).toBeNull();
    expect(rad.organization_id).toBe(relation);
    // En sekunds marginal: databasen och provet läser var sin klocka.
    const registrerad = Date.parse(rad.created_at);
    expect(registrerad).toBeGreaterThanOrEqual(postA.fore - 1000);
    expect(registrerad).toBeLessThanOrEqual(postA.efter + 1000);
  });

  it('S2 Lovat visar samma datum i tråden och i åtagandevyn, med registreringsdagen under', async () => {
    const registrerad = (await loftet('Skicka tidplanen S1.')).created_at.slice(0, 10);
    const traden = await las(`/app/c/${bolag}/relations/${relation}`);
    expect(handelsen(traden, 'Skicka tidplanen S1.')).toContain('Lovat 2026-09-15</p>');
    const vyn = await las(`/app/c/${bolag}/commitments?status=open`);
    const cell = synlig(cellen(radenMed(vyn, 'Skicka tidplanen S1.'), 'Lovat'));
    expect(cell.startsWith('2026-09-15'), cell).toBe(true);
    expect(cell).toContain(`registrerat ${registrerad}`);
    expect(cell).not.toContain('ärendet skapat');
  });

  it('S3 tomt och utelämnat Lovades ger postningens tidpunkt', async () => {
    for (const p of [postB, postC]) {
      expect(p.status).toBe(302);
      expect(p.location).not.toContain('fel=');
    }
    const tomt = await loftet('Tomt fält S3a.');
    const utelamnat = await loftet('Utelämnat fält S3b.');
    for (const [rad, p] of [[tomt, postB], [utelamnat, postC]] as const) {
      const lovad = Date.parse(rad.occurred_at);
      expect(lovad, rad.body).toBeGreaterThanOrEqual(p.fore - 1000);
      expect(lovad, rad.body).toBeLessThanOrEqual(p.efter + 1000);
    }
    expect(tomt.direction).toBe('they_owe');
    expect(utelamnat.due_date).toBeNull();
  });

  it('S4 ett datum efter i dag avvisas med notisen före formuläret, och inget löfte skapas', async () => {
    for (const p of [postD, postE]) {
      expect(p.status).toBe(302);
      expect(p.location.startsWith(`/app/c/${bolag}/relations/${relation}`), p.location).toBe(true);
      expect(decodeURIComponent(p.location)).toContain('fel=Ett löfte kan inte ha getts i framtiden.');
    }
    const sida = await las(postD.location);
    const notis = sida.indexOf('<p class="notice">Ett löfte kan inte ha getts i framtiden.</p>');
    expect(notis, 'notisen').toBeGreaterThanOrEqual(0);
    expect(notis).toBeLessThan(sida.indexOf('<details class="loftesform">'));
    expect(await loftenMedText(['Framtida löfte S4a.', 'Framtida löfte S4b.'])).toBe(0);
    expect(await bolagetsLoften(bolag)).toEqual(['Skicka tidplanen S1.', 'Tomt fält S3a.', 'Utelämnat fält S3b.']);
  });

  it('S5 tom text och bara blanktecken avvisas med formulärnotisen, och inget löfte skapas', async () => {
    const FORMULARNOTIS = 'Något i formuläret gick inte att spara — kontrollera fälten (belopp med siffror, t.ex. 1234,50) och försök igen.';
    for (const p of [postF, postG]) {
      expect(p.status).toBe(302);
      expect(decodeURIComponent(p.location)).toContain(FORMULARNOTIS);
    }
    expect(await las(postF.location)).toContain(`<p class="notice">${FORMULARNOTIS}`);
    expect(antalEfterG).toBe(antalForeF);
  });

  it('S6 varje fält löftet får har ursprunget human, och auditraden bär källan manual', async () => {
    const s1 = await loftet('Skicka tidplanen S1.');
    const s3b = await loftet('Utelämnat fält S3b.');
    expect(await ursprungen(s1.id)).toEqual([
      ['body', 'human', null, null], ['direction', 'human', null, null],
      ['due_date', 'human', null, null], ['occurred_at', 'human', null, null],
    ]);
    expect(await ursprungen(s3b.id)).toEqual([
      ['body', 'human', null, null], ['direction', 'human', null, null], ['occurred_at', 'human', null, null],
    ]);
    expect((await auditen(s1.id))?.source_system).toBe('manual');
  });

  it('S7 en relation i grannbolaget ger 404 under båda adresserna, och inget löfte skapas', async () => {
    expect(postH.status).toBe(404);
    expect(postI.status).toBe(404);
    expect(await loftenMedText(['Fel bolag S7a.', 'Fel bolag S7b.'])).toBe(0);
    expect((await atgard(grannbolag, granne.token, 'list_crm_commitments', { status: 'open' })).result).toEqual([]);
  });
});
