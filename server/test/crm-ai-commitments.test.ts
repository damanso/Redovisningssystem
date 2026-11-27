// FR-39 (story 5.5): ett löfte som David nämner för AI:n och som inte märks ser
// ut som hans eget beslut, och en agent som inte vet när verktyget ska anropas
// fångar ingenting. Provet låser att manifestet säger agenten när
// `record_crm_commitment` ska anropas, att agentens löfte är en gissning med
// ursprunget `ai` per fält, att gissningen bär ✦ och *Stämmer* i tråden och
// åtagandevyn tills David bekräftat eller rättat den, och att ingen synk eller
// agent därefter skriver över fälten. Provet går genom REST, `executeAction`,
// den inloggade vyn och Postgres. Facit är literaler, aldrig hämtade ur koden
// som prövas.
import { readFile } from 'node:fs/promises';
import supertest from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { CAPTURE_PATHS_IN_OPERATION } from '../src/services/crmDerivations.js';
import { api, app, createCompany, registerUser, withAdmin, type TestUser } from './helpers.js';

const PASSWORD = 'mycket-hemligt-losen-123';
const TITEL = 'Registrera åtagande (vem lovade vad, var det sades)';
const BESKRIVNING = 'Anropa när David i samtalet nämner ett löfte han gett eller fått. '
  + 'Löftestiden (occurred_at) är den tid han anger, annars samtalets tidpunkt. '
  + 'Källan (source_system) är manual.';

/**
 * UTC-datumet n dagar från provets ögonblick. Klockan läses en gång för hela
 * filen, så fixturen och facit räknar varje datum ur samma ögonblick.
 */
const NU = Date.now();
const dag = (n: number): string => new Date(NU + n * 86_400_000).toISOString().slice(0, 10);

type Rad = Record<string, unknown>;

let user: TestUser;
let granne: TestUser;
let bolag: string;
let grannbolag: string;
let relation: string;
let grannrelation: string;
let agentnyckel: string;
let person: string;
let ua: ReturnType<typeof supertest.agent>;
let ai1: string;
let ai2: string;
let ai3: string;
let ai4: string;
/** Klockan före och efter AI1:s anrop, för registreringstiden. */
let ai1Fore: number;
let ai1Efter: number;

/** En åtgärd genom REST; statusen asserteras med kroppen i meddelandet. */
async function atgard(bolagId: string, token: string, namn: string, indata: Record<string, unknown>, status = 200) {
  const r = await api.post(`/api/companies/${bolagId}/actions/${namn}`)
    .set('Authorization', `Bearer ${token}`).send(indata);
  expect(r.status, JSON.stringify(r.body)).toBe(status);
  return r.body;
}

/** Chattagentens anrop i bolaget B. */
async function agenten(namn: string, indata: Record<string, unknown>, status = 200) {
  return atgard(bolag, agentnyckel, namn, indata, status);
}

/** En sida i vyn med den inloggade användaren. */
async function las(sokvag: string): Promise<string> {
  const r = await ua.get(sokvag);
  expect(r.status, r.text).toBe(200);
  return r.text;
}

/** Texten som den syns: varje tagg blir ett blanksteg, blanktecken slås ihop. */
function synlig(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Första händelsen i tråden som innehåller texten. */
function handelsen(sida: string, text: string): string {
  const del = sida.match(/<li class="thread__ev">[\s\S]*?<\/li>/g)?.find((d) => d.includes(text));
  expect(del, `händelsen ${text}`).toBeDefined();
  return del!;
}

/** Första tabellraden som innehåller texten (samma uttryck som v12TableRow i crm-views). */
function radenMed(sida: string, text: string): string {
  const rad = sida.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/g)?.find((d) => d.includes(text));
  expect(rad, `raden ${text}`).toBeDefined();
  return rad!;
}

/** Fälten som har ett eget Stämmer-formulär mot målet för löftet (förlagan v12Fields). */
function bekraftade(fragment: string, mal: string, id: string): string[] {
  return (fragment.match(/<form\b[\s\S]*?<\/form>/g) ?? [])
    .filter((form) => form.includes(`action="${mal}"`) && form.includes(`name="commitment_id" value="${id}"`))
    .map((form) => form.match(/name="field" value="([^"]+)"/)?.[1])
    .filter((falt): falt is string => falt !== undefined)
    .sort();
}

/** En postning i vyn som formulär; svaret är statusen och vart den leder. */
async function posta(sokvag: string, falt: Record<string, string>): Promise<{ status: number; location: string }> {
  const r = await ua.post(sokvag).type('form').send(falt);
  return { status: r.status, location: String(r.headers.location ?? '') };
}

/** Löftets ursprungsrader som par (fält, ursprung), sorterade på fältet. */
async function ursprungen(id: string): Promise<Array<[string, string]>> {
  return withAdmin(async (db) => (await db.query<{ field: string; source: string }>(
    'SELECT field, source FROM crm.field_provenance WHERE company_id = $1 AND commitment_id = $2 ORDER BY field',
    [bolag, id])).rows.map((r): [string, string] => [r.field, r.source]));
}

/** Detaljerna i bolagets senaste auditrad för åtgärden och löftet. */
async function auditen(action: string, id: string): Promise<Record<string, unknown> | undefined> {
  return withAdmin(async (db) => (await db.query<{ details: Record<string, unknown> }>(
    'SELECT details FROM crm.audit_log WHERE company_id = $1 AND action = $2 AND entity_id = $3 ORDER BY id DESC LIMIT 1',
    [bolag, action, id])).rows[0]?.details);
}

/** Löftenas texter, sorterade. */
function texterna(rader: Rad[]): string[] {
  return rader.map((r) => String(r.body)).sort();
}

/** Löftets text som den står i tabellen, läst som ägare. */
async function textenI(id: string): Promise<string | undefined> {
  return withAdmin(async (db) => (await db.query<{ body: string }>(
    'SELECT body FROM crm.commitments WHERE id = $1', [id])).rows[0]?.body);
}

/** Antalet löften i alla bolag, läst som ägare. */
async function antaletLoften(): Promise<number> {
  return withAdmin(async (db) => Number((await db.query<{ n: string }>(
    'SELECT count(*)::text AS n FROM crm.commitments')).rows[0]!.n));
}

beforeAll(async () => {
  // Rad 1–4: användarna, bolagen, relationerna och agentnyckeln.
  user = await registerUser('ailoften');
  granne = await registerUser('ailoften-granne');
  bolag = await createCompany(user.token, 'AI-löftena AB');
  grannbolag = await createCompany(granne.token, 'Grannbolaget AI-löften AB');
  relation = (await atgard(bolag, user.token, 'upsert_crm_organization', { name: 'AI-löftenas kund AB' })).result.id as string;
  grannrelation = (await atgard(grannbolag, granne.token, 'upsert_crm_organization', { name: 'Grannens AI-relation AB' })).result.id as string;
  const tok = await api.post(`/api/companies/${bolag}/agent-tokens`)
    .set('Authorization', `Bearer ${user.token}`).send({ name: 'Chattagenten' });
  expect(tok.status, JSON.stringify(tok.body)).toBe(201);
  agentnyckel = tok.body.token as string;

  // Rad 5: personen i relationen och den inloggade vyn.
  person = (await atgard(bolag, user.token, 'upsert_crm_person', {
    name: 'Eva AI-prov', email: 'eva@ai-loften.example', organization_id: relation,
  })).result.id as string;
  ua = supertest.agent(app);
  const login = await ua.post('/app/login').type('form').send({ email: user.email, password: PASSWORD });
  expect(login.status, JSON.stringify(login.body)).toBe(302);

  // Rad 6: löftena. Agenten om inget annat sägs, källan manual.
  ai1Fore = Date.now();
  ai1 = (await agenten('record_crm_commitment', {
    organization_id: relation, direction: 'we_owe', body: 'Skicka tidplanen AI1.', due_date: dag(3),
    occurred_at: '2026-11-20T09:30:00Z', source_system: 'manual',
  })).result.id as string;
  ai1Efter = Date.now();
  ai2 = (await agenten('record_crm_commitment', {
    person_id: person, direction: 'they_owe', body: 'Underlaget AI2.',
    occurred_at: '2026-11-21T08:00:00Z', source_system: 'manual',
  })).result.id as string;
  ai3 = (await agenten('record_crm_commitment', {
    organization_id: relation, direction: 'we_owe', body: 'Ringa tillbaka AI3.', due_date: dag(4),
    occurred_at: '2026-11-21T10:00:00Z', source_system: 'manual',
  })).result.id as string;
  ai4 = (await agenten('record_crm_commitment', {
    organization_id: relation, direction: 'we_owe', body: 'Offerten AI4.', due_date: dag(30),
    occurred_at: '2026-11-21T11:00:00Z', source_system: 'manual', source_ref: 'samtal:ai4',
  })).result.id as string;
  await agenten('record_crm_commitment', {
    organization_id: relation, direction: 'they_owe', body: 'Obekräftat AI5.', due_date: dag(2),
    occurred_at: '2026-11-22T09:00:00Z', source_system: 'manual',
  });
  await atgard(bolag, user.token, 'record_crm_commitment', {
    organization_id: relation, direction: 'we_owe', body: 'Människans löfte H1.', due_date: dag(2),
    occurred_at: '2026-11-22T09:00:00Z', source_system: 'manual',
  });
  const s1 = await atgard(bolag, user.token, 'ingest_crm_events', {
    events: [{
      kind: 'commitment', organization: { name: 'AI-löftenas kund AB' }, source_system: 'linear',
      source_ref: 'linear:LOC-5501', commitment_direction: 'they_owe', body: 'Ärendelöftet S1.',
      due_date: dag(20), occurred_at: '2026-11-19T09:00:00Z',
    }],
  });
  expect(s1.result.skipped).toEqual([]);
  await atgard(grannbolag, granne.token, 'record_crm_commitment', {
    organization_id: grannrelation, direction: 'we_owe', body: 'Grannens löfte GA.',
    occurred_at: '2026-11-22T09:00:00Z', source_system: 'manual',
  });
});

interface Manifestpost {
  name: string;
  title: string;
  description?: string;
  input_schema: { properties?: Record<string, { enum?: string[] }> };
}

async function manifestet(): Promise<Manifestpost[]> {
  const r = await api.get(`/api/companies/${bolag}/actions`).set('Authorization', `Bearer ${agentnyckel}`);
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body.actions as Manifestpost[];
}

function posten(poster: Manifestpost[], namn: string): Manifestpost {
  const post = poster.find((p) => p.name === namn);
  expect(post, namn).toBeDefined();
  return post!;
}

describe('manifestet', () => {
  it('M1 record_crm_commitment bär titeln och beskrivningen av när den ska anropas', async () => {
    const post = posten(await manifestet(), 'record_crm_commitment');
    expect(post.title).toBe(TITEL);
    expect(post.description).toBe(BESKRIVNING);
  });

  it('M2 källan är fortfarande exakt de fyra (regressionsfall)', async () => {
    const post = posten(await manifestet(), 'record_crm_commitment');
    expect(post.input_schema.properties?.source_system?.enum).toEqual(['gmail', 'calendar', 'linear', 'manual']);
  });

  it('M3 poster utan beskrivning saknar nyckeln (regressionsfall)', async () => {
    const poster = await manifestet();
    for (const namn of ['book_invoice', 'list_crm_commitments']) {
      expect(Object.hasOwn(posten(poster, namn), 'description'), namn).toBe(false);
    }
  });
});

describe('agentens löfte', () => {
  it('A1 löftet på organisationen: källan manual, ursprunget ai per fält, registreringstiden ur databasen och auditraden', async () => {
    const rader = (await atgard(bolag, user.token, 'list_crm_commitments', { status: 'open' })).result as Rad[];
    const rad = rader.find((r) => r.id === ai1);
    expect(rad, 'AI1').toBeDefined();
    expect(rad!.source_system).toBe('manual');
    expect(rad!.source_ref).toBeNull();
    expect(rad!.organization_id).toBe(relation);
    expect(rad!.direction).toBe('we_owe');
    expect(rad!.due_date).toBe(dag(3));
    expect(rad!.occurred_at).toBe('2026-11-20T09:30:00.000Z');
    const registrerad = Date.parse(String(rad!.created_at));
    expect(registrerad).toBeGreaterThanOrEqual(ai1Fore - 1000);
    expect(registrerad).toBeLessThanOrEqual(ai1Efter + 1000);
    // Läst före V-blocket: describe-ordningen ger det.
    expect(await ursprungen(ai1)).toEqual([
      ['body', 'ai'], ['direction', 'ai'], ['due_date', 'ai'], ['occurred_at', 'ai'],
    ]);
    expect((await auditen('crm.commitment_recorded', ai1))?.source_system).toBe('manual');
  });

  it('A2 löftet på personen: utan organisation, källan manual och ursprunget ai för de ifyllda fälten', async () => {
    const rader = (await atgard(bolag, user.token, 'list_crm_commitments', { status: 'open' })).result as Rad[];
    const rad = rader.find((r) => r.id === ai2);
    expect(rad, 'AI2').toBeDefined();
    expect(rad!.person_id).toBe(person);
    expect(rad!.organization_id).toBeNull();
    expect(rad!.source_system).toBe('manual');
    expect(await ursprungen(ai2)).toEqual([['body', 'ai'], ['direction', 'ai'], ['occurred_at', 'ai']]);
  });

  it('A3 utan organisation och person avvisas med 400 och ingen rad skrivs', async () => {
    const fore = await antaletLoften();
    const svar = await agenten('record_crm_commitment', {
      direction: 'we_owe', body: 'Utan mål A3.', occurred_at: '2026-11-22T09:00:00Z', source_system: 'manual',
    }, 400);
    expect(svar.error).toBe('missing_target');
    expect(await antaletLoften()).toBe(fore);
  });

  it('A4 grannbolagets organisation ger 404 och inget löfte i något bolag', async () => {
    const fore = await antaletLoften();
    await agenten('record_crm_commitment', {
      organization_id: grannrelation, direction: 'we_owe', body: 'Fel bolag A4.',
      occurred_at: '2026-11-22T09:00:00Z', source_system: 'manual',
    }, 404);
    expect(await antaletLoften()).toBe(fore);
    const traffar = await withAdmin(async (db) => (await db.query(
      'SELECT 1 FROM crm.commitments WHERE body = $1', ['Fel bolag A4.'])).rows.length);
    expect(traffar).toBe(0);
  });
});

describe('märket och skyddet', () => {
  const sidan = () => `/app/c/${bolag}/relations/${relation}`;
  const stammer = () => `${sidan()}/confirm`;
  const vyn = () => `/app/c/${bolag}/commitments?status=open`;

  it('V1 tråden: AI-löftets text bär ✦, Stämmer för varje fält och Rätta', async () => {
    const del = handelsen(await las(sidan()), 'Skicka tidplanen AI1.');
    expect(del).toContain('role="img"');
    expect(del).toContain('aria-label="Inte bekräftad av dig"');
    expect(del).toContain('<span class="k">Vad</span>');
    expect(del).toContain('<details class="rattaform"><summary>Rätta</summary>');
    expect(bekraftade(del, stammer(), ai1)).toEqual(['body', 'direction', 'due_date', 'occurred_at']);
  });

  it('V2 åtagandevyn: samma märke, Stämmer och Rätta; människans löfte utan märke', async () => {
    const sida = await las(vyn());
    const rad = radenMed(sida, 'Skicka tidplanen AI1.');
    expect(rad).toContain('role="img"');
    expect(rad).toContain('aria-label="Inte bekräftad av dig"');
    expect(rad).toContain('Stämmer');
    expect(rad).toContain('<details class="rattaform">');
    expect(bekraftade(rad, stammer(), ai1)).toEqual(['body', 'direction', 'due_date', 'occurred_at']);
    expect(radenMed(sida, 'Människans löfte H1.')).not.toContain('role="img"');
  });

  it('V3 Stämmer på alla fyra fälten gör dem human, tar bort märket och auditloggas', async () => {
    for (const falt of ['body', 'direction', 'due_date', 'occurred_at']) {
      const svar = await posta(stammer(), { back: sidan(), commitment_id: ai1, field: falt });
      expect(svar.status, svar.location).toBe(302);
      expect(svar.location, falt).not.toContain('fel=');
    }
    expect(await ursprungen(ai1)).toEqual([
      ['body', 'human'], ['direction', 'human'], ['due_date', 'human'], ['occurred_at', 'human'],
    ]);
    const del = handelsen(await las(sidan()), 'Skicka tidplanen AI1.');
    const rad = radenMed(await las(vyn()), 'Skicka tidplanen AI1.');
    for (const fragment of [del, rad]) {
      expect(fragment).not.toContain('role="img"');
      expect(fragment).not.toContain('Stämmer');
    }
    expect((await auditen('crm.value_confirmed', ai1))?.field).toBe('occurred_at');
  });

  it('V4 Rätta av texten gör bara texten human; övriga fält är kvar som gissningar', async () => {
    const svar = await posta(`${sidan()}/edit`, {
      back: sidan(), commitment_id: ai3, body: 'Ringa tillbaka i morgon AI3.', fore_body: 'Ringa tillbaka AI3.',
    });
    expect(svar.status, svar.location).toBe(302);
    expect(svar.location).not.toContain('fel=');
    expect(await ursprungen(ai3)).toEqual([
      ['body', 'human'], ['direction', 'ai'], ['due_date', 'ai'], ['occurred_at', 'ai'],
    ]);
    const del = handelsen(await las(sidan()), 'Ringa tillbaka i morgon AI3.');
    expect(bekraftade(del, stammer(), ai3)).toEqual(['direction', 'due_date', 'occurred_at']);
  });

  it('V5 agentens rättelse av en bekräftad text stoppas och redovisas (väg a)', async () => {
    const svar = await agenten('update_crm_commitment', { commitment_id: ai1, body: 'Agentens nya text V5.' });
    expect(svar.result.kept_human_fields).toEqual(['body']);
    expect(await textenI(ai1)).toBe('Skicka tidplanen AI1.');
    expect(await auditen('crm.commitment_corrected', ai1)).toEqual({ fields: [], kept_human_fields: ['body'] });
  });

  it('V6 agentens omsändning och intaget med samma källnyckel stoppas på den bekräftade texten (väg b och c)', async () => {
    const bekraftelse = await posta(stammer(), { back: sidan(), commitment_id: ai4, field: 'body' });
    expect(bekraftelse.status, bekraftelse.location).toBe(302);
    expect(bekraftelse.location).not.toContain('fel=');

    const omsandning = await agenten('record_crm_commitment', {
      organization_id: relation, direction: 'we_owe', body: 'Agentens omsändning V6.',
      occurred_at: '2026-11-21T11:00:00Z', source_system: 'manual', source_ref: 'samtal:ai4',
    });
    expect(omsandning.result.created).toBe(false);
    expect(omsandning.result.kept_human_fields).toContain('body');
    expect(await textenI(ai4)).toBe('Offerten AI4.');

    const intaget = await atgard(bolag, user.token, 'ingest_crm_events', {
      events: [{
        kind: 'commitment', organization: { name: 'AI-löftenas kund AB' }, source_system: 'manual',
        source_ref: 'samtal:ai4', commitment_direction: 'we_owe', body: 'Synkens omsändning V6.',
        occurred_at: '2026-11-21T11:00:00Z',
      }],
    });
    expect(intaget.result.skipped).toEqual([]);
    const behallna = intaget.result.kept_human_fields as string[];
    expect(behallna.some((post) => post.endsWith('samtal:ai4 body')), JSON.stringify(behallna)).toBe(true);
    expect(await textenI(ai4)).toBe('Offerten AI4.');
  });
});

// Fallen läser tillståndet efter V-blocket: AI1 bekräftad i V3, AI3:s text rättad
// i V4 och AI4:s text bekräftad i V6.
describe('brytaren och listan', () => {
  const lista = async (indata: Record<string, unknown>) =>
    (await atgard(bolag, user.token, 'list_crm_commitments', indata)).result as Rad[];

  it('B1 varje rad bär unconfirmed_ai, sant bara när textens ursprung är ai', async () => {
    const rader = await lista({ status: 'open' });
    for (const rad of rader) {
      expect(Object.hasOwn(rad, 'unconfirmed_ai'), String(rad.body)).toBe(true);
      expect(typeof rad.unconfirmed_ai, String(rad.body)).toBe('boolean');
    }
    const facit: Record<string, boolean> = {
      'Underlaget AI2.': true,
      'Obekräftat AI5.': true,
      'Skicka tidplanen AI1.': false,
      'Ringa tillbaka i morgon AI3.': false,
      'Offerten AI4.': false,
      'Människans löfte H1.': false,
      'Ärendelöftet S1.': false,
    };
    expect(Object.fromEntries(rader.map((r) => [String(r.body), r.unconfirmed_ai]))).toEqual(facit);
  });

  it('B2 utan val gäller Davids besked (direkt); false utesluter gissningarna och true tar med dem', async () => {
    const alla = [
      'Människans löfte H1.', 'Obekräftat AI5.', 'Offerten AI4.', 'Ringa tillbaka i morgon AI3.',
      'Skicka tidplanen AI1.', 'Underlaget AI2.', 'Ärendelöftet S1.',
    ];
    expect(texterna(await lista({ status: 'open' }))).toEqual(alla);
    expect(texterna(await lista({ status: 'open', include_unconfirmed_ai: false }))).toEqual([
      'Människans löfte H1.', 'Offerten AI4.', 'Ringa tillbaka i morgon AI3.',
      'Skicka tidplanen AI1.', 'Ärendelöftet S1.',
    ]);
    expect(texterna(await lista({ status: 'open', include_unconfirmed_ai: true }))).toEqual(alla);
  });

  it('B3 ett ogiltigt val ger 400 (regressionsfall)', async () => {
    const svar = await atgard(bolag, user.token, 'list_crm_commitments', { include_unconfirmed_ai: 'ja' }, 400);
    expect(svar.error).toBe('validation_error');
  });

  it('B4 åtagandevyn visar det obekräftade AI-löftet med ✦ och Stämmer', async () => {
    const sida = await las(`/app/c/${bolag}/commitments?status=open`);
    const rad = radenMed(sida, 'Obekräftat AI5.');
    expect(rad).toContain('role="img"');
    expect(rad).toContain('Stämmer');
    expect(radenMed(sida, 'Människans löfte H1.')).not.toContain('role="img"');
  });

  it('B5 grannbolaget ser bara sitt eget löfte, också med valet', async () => {
    const grannens = (await atgard(grannbolag, granne.token, 'list_crm_commitments', { include_unconfirmed_ai: true })).result as Rad[];
    expect(texterna(grannens)).toEqual(['Grannens löfte GA.']);
    expect(texterna(await lista({ include_unconfirmed_ai: true }))).not.toContain('Grannens löfte GA.');
  });

  it('B6 Min sida visar de obekräftade AI-löftena (regressionsfall)', async () => {
    const sida = synlig(await las(`/app/c/${bolag}/min-sida`));
    expect(sida).toContain('Obekräftat AI5.');
    expect(sida).toContain('Underlaget AI2.');
  });
});

describe('Idag med Davids besked', () => {
  it('I1 Idag och crm_today tar med det obekräftade AI-löftet (direkt)', async () => {
    const sida = synlig(await las(`/app/c/${bolag}/idag`));
    expect(sida).toContain('Obekräftat AI5.');
    expect(sida).toContain('Människans löfte H1.');
    const idag = (await atgard(bolag, user.token, 'crm_today', {})).result as { commitments: Rad[] };
    expect(texterna(idag.commitments)).toContain('Obekräftat AI5.');
  });
});

describe('fångstvägarna och dokumentet', () => {
  /** Bolaget T får aldrig en relation eller ett löfte: Idag och Relationer visar då sina tomlägen. */
  let tomt: string;
  let kundkortet: string;

  beforeAll(async () => {
    // Rad 8: det tomma bolaget och kundkortet (ett kundkort skapar ingen CRM-organisation).
    tomt = await createCompany(user.token, 'AI-tomt AB');
    const kund = await api.post(`/api/companies/${tomt}/customers`)
      .set('Authorization', `Bearer ${user.token}`).send({ name: 'Kundkort AI-tomt AB' });
    expect(kund.status, JSON.stringify(kund.body)).toBe(201);
    kundkortet = kund.body.customer.id as string;
  });

  it('C1 konstanten för fångstvägar har kalendern (5.9) och AI-samtalet (5.11)', () => {
    expect(CAPTURE_PATHS_IN_OPERATION).toEqual({
      contacts: ['mail', 'calendar', 'issues'],
      commitments: ['issues_waiting_external', 'ai_conversation', 'promise_form'],
    });
  });

  it('C2 löftesytorna nämner AI-samtalet (5.11), och Idag och Relationer gör det inte', async () => {
    const loftesytor: Array<[string, string[]]> = [
      [`/app/c/${tomt}/commitments`, [
        'Inga öppna löften.',
        'Löften kommer in av sig själva från ärenden märkta Väntar-extern och när du nämner det för AI:n, och du kan lägga till ett under Lova något på en relation.',
      ]],
      [`/app/c/${tomt}/customers/${kundkortet}`, [
        'Inga öppna löften. Löften kommer från ärenden märkta Väntar-extern, när du nämner det för AI:n och från Lova något på relationen.',
      ]],
      [`/app/c/${bolag}/relations/${relation}`, [
        'Löften ur ärenden märkta Väntar-extern kommer in av sig själva, eller när du nämner det för AI:n. Det här är för det som sades i ett samtal eller möte.',
      ]],
    ];
    const kontaktytor: Array<[string, string[]]> = [
      [`/app/c/${tomt}/idag`, [
        'Avbetat för i dag',
        'Kommer något in via mail, möten eller ärenden dyker det upp av sig självt.',
      ]],
      [`/app/c/${tomt}/relations`, [
        'härlett ur mail, möten, ärenden och bokförda fakturor',
        'De flesta dyker upp av sig själva när mail, möten och ärenden kommer in.',
      ]],
    ];
    for (const [sokvag, texter] of loftesytor) {
      const sida = synlig(await las(sokvag));
      for (const text of texter) expect(sida, sokvag).toContain(text);
      expect(sida, sokvag).toContain('för AI:n');
    }
    for (const [sokvag, texter] of kontaktytor) {
      const sida = synlig(await las(sokvag));
      // Ytans egen text först, så att frånvaron inte går igenom utan ytan.
      for (const text of texter) expect(sida, sokvag).toContain(text);
      expect(sida, sokvag).not.toContain('för AI:n');
    }
  });

  it('D1 dokumentet beskriver beskrivningen och brytaren i ett eget avsnitt efter löftets tre tider', async () => {
    const doc = await readFile(new URL('../../docs/MCP_ACTIONS.md', import.meta.url), 'utf8');
    const rubrik = '## Löften som AI:n fångar i samtalet (crm 5.5)';
    expect(doc.split(rubrik)).toHaveLength(2);
    expect(doc.indexOf('## Löftets tre tider (crm 5.2)')).toBeGreaterThan(-1);
    expect(doc.indexOf(rubrik)).toBeGreaterThan(doc.indexOf('## Löftets tre tider (crm 5.2)'));
    const avsnitt = doc.split(rubrik)[1]!.split(/\n## /)[0]!;
    for (const term of [
      'description', 'record_crm_commitment', 'unconfirmed_ai', 'include_unconfirmed_ai',
      'INCLUDE_UNCONFIRMED_AI_COMMITMENTS', 'crm_today', 'Davids besked 2026-10-16', '5.10', '5.11',
    ]) {
      expect(avsnitt, term).toContain(term);
    }
    expect(avsnitt).not.toMatch(/^###/m);
  });
});
