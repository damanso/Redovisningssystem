// FR-31, FR-2 och FR-36 (story 5.2): ett löfte har tre tider — när det gavs
// (löftestiden), när det registrerades (registreringstiden) och när det förfaller
// (förfallodatumet). Blandas de ihop går löftet inte att styrka: ett ärendes
// skapad-datum läses som tidpunkten då löftet gavs, eller en registrering i går
// som ett löfte i går. Och ett löfte som källan stängt får inte se ut som Davids
// eget handgrepp. Provet går genom REST → executeAction → listCommitments →
// Postgres för listan, och genom den inloggade webbvyn (åtagandevyn, tråden och
// Idag) för namnen, märket och texten. Facit är literaler, eller förfallodatum
// räknade ur provets egen klocka, och aldrig hämtade ur koden som prövas.
import { readFile } from 'node:fs/promises';
import supertest from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { api, app, createCompany, registerUser, withAdmin, type TestUser } from './helpers.js';

const PASSWORD = 'mycket-hemligt-losen-123';
const KUND = 'Tidernas kund AB';

let user: TestUser;
let granne: TestUser;
let bolag: string;
let grannbolag: string;
let relation: string;
let agent: ReturnType<typeof supertest.agent>;

/** En åtgärd genom REST; statusen asserteras med kroppen i meddelandet. */
async function atgard(bolagId: string, token: string, namn: string, indata: Record<string, unknown>, status = 200) {
  const r = await api.post(`/api/companies/${bolagId}/actions/${namn}`)
    .set('Authorization', `Bearer ${token}`).send(indata);
  expect(r.status, JSON.stringify(r.body)).toBe(status);
  return r.body;
}

/**
 * UTC-datumet n dagar från provets ögonblick. Klockan läses en gång för hela
 * filen, så fixturen och facit räknar varje datum ur samma ögonblick, också när
 * körningen korsar UTC-midnatt mellan beforeAll och ett fall.
 */
const NU = Date.now();
const dag = (n: number): string => new Date(NU + n * 86_400_000).toISOString().slice(0, 10);

// Förfallodatumen räknas en gång här, och fixturen och facit läser samma konstant.
const SENAST_L1 = dag(60);
const SENAST_G1 = dag(61);
const SENAST_I1 = dag(2);
const SENAST_M1 = dag(62);
const SENAST_AI = dag(63);
const SENAST_SENARE = dag(80);
const SENAST_RATTAT = dag(90);

/** En sida i vyn med den inloggade agenten. */
async function las(sokvag: string): Promise<string> {
  const r = await agent.get(sokvag);
  expect(r.status, r.text).toBe(200);
  return r.text;
}

type Riktning = 'we_owe' | 'they_owe';
type Status = 'open' | 'done' | 'dropped';

/** Ett löfte i intaget. Utan förfallodatum saknas nyckeln, och utan status likaså. */
function loftet(
  sourceSystem: string, sourceRef: string, riktning: Riktning, body: string, occurredAt: string,
  dueDate: string | null, status?: Status, organisation = KUND,
): Record<string, unknown> {
  return {
    kind: 'commitment', organization: { name: organisation }, occurred_at: occurredAt,
    source_system: sourceSystem, source_ref: sourceRef, commitment_direction: riktning, body,
    ...(dueDate !== null ? { due_date: dueDate } : {}), ...(status ? { status } : {}),
  };
}

async function intag(bolagId: string, token: string, events: Record<string, unknown>[]): Promise<void> {
  const r = await atgard(bolagId, token, 'ingest_crm_events', { events });
  expect(r.result.skipped).toEqual([]);
}

/** Löftets id ur källnyckeln, läst som ägare. */
async function loftesId(sourceSystem: string, sourceRef: string): Promise<string> {
  const id = await withAdmin(async (db) => (await db.query<{ id: string }>(
    `SELECT id FROM crm.commitments WHERE company_id = $1 AND source_system = $2 AND source_ref = $3`,
    [bolag, sourceSystem, sourceRef])).rows[0]?.id);
  expect(id, `löftet ${sourceSystem} ${sourceRef}`).toBeDefined();
  return id!;
}

/** Ursprunget för ett av löftets fält, eller null när ursprungsraden saknas. */
async function ursprunget(id: string, falt: string): Promise<string | null> {
  return withAdmin(async (db) => (await db.query<{ source: string }>(
    `SELECT source FROM crm.field_provenance WHERE company_id = $1 AND commitment_id = $2 AND field = $3`,
    [bolag, id, falt])).rows[0]?.source ?? null);
}

// S1–S4, S9, H1, H2 och L0 gavs samma dag och förfaller långt efter Idags horisont.
const STANGDA_NAR = '2026-09-08T09:00:00Z';
// R1–R4: ärendelöften vars löftesdag eller förfallodatum någon rättat, eller
// vars löftesdag saknar ursprungsrad. Ärendets dag och den rättade dagen.
const ARENDETS_DAG = '2026-09-09T09:00:00Z';
const RATTAD_DAG = '2026-09-01';

let agentnyckel: string;

beforeAll(async () => {
  user = await registerUser('loftestider');
  granne = await registerUser('loftestider-granne');
  bolag = await createCompany(user.token, 'Löftestider AB');
  grannbolag = await createCompany(granne.token, 'Grannbolaget Tider AB');

  // Intag 1 i B. L1 skickas uttryckligen öppet, så att det är öppet och ändå
  // har statusens ursprung sync ur linear (S8 prövar statusvillkoret med det).
  const senare = SENAST_SENARE;
  await intag(bolag, user.token, [
    loftet('linear', 'linear:LOC-5201', 'they_owe', 'Ärendelöftet L1.', '2026-09-02T09:00:00Z', SENAST_L1, 'open'),
    loftet('gmail', 'gmail:5201a1', 'we_owe', 'Mailöftet G1.', '2026-09-03T09:00:00Z', SENAST_G1),
    loftet('calendar', 'calendar:TIDER5201', 'we_owe', 'Kalenderlöftet K1.', '2026-09-04T09:00:00Z', null),
    loftet('gmail', 'gmail:5201b1', 'we_owe', 'Idaglöftet I1.', '2026-09-02T09:00:00Z', SENAST_I1),
    loftet('linear', 'linear:LOC-5202', 'they_owe', 'Stängt ärende S1.', STANGDA_NAR, senare),
    loftet('linear', 'linear:LOC-5203', 'they_owe', 'Avbrutet ärende S2.', STANGDA_NAR, senare),
    loftet('linear', 'linear:LOC-5205', 'they_owe', 'Stängt från början S3.', STANGDA_NAR, senare, 'done'),
    loftet('linear', 'linear:Projekt-S4', 'they_owe', 'Formlöst ärende S4.', STANGDA_NAR, senare, 'done'),
    loftet('linear', 'linear:LOC-5206', 'they_owe', 'Davids klara H1.', STANGDA_NAR, senare),
    loftet('linear', 'linear:LOC-5207', 'they_owe', 'Davids avskrivna H2.', STANGDA_NAR, senare),
    loftet('linear', 'linear:LOC-5208', 'they_owe', 'Gammalt klart L0.', STANGDA_NAR, senare),
    // Samma form som KL42:s B6: nyckeln har ärendets form, källsystemet är ett annat.
    loftet('gmail', 'linear:LOC-5209', 'they_owe', 'Fel källsystem S9.', STANGDA_NAR, senare, 'done'),
    loftet('linear', 'linear:LOC-5210', 'they_owe', 'Davids löftesdag R1.', ARENDETS_DAG, senare),
    loftet('linear', 'linear:LOC-5211', 'they_owe', 'AI:ts löftesdag R2.', ARENDETS_DAG, senare),
    loftet('linear', 'linear:LOC-5212', 'they_owe', 'Davids förfallodatum R3.', ARENDETS_DAG, senare),
    loftet('linear', 'linear:LOC-5213', 'they_owe', 'Löftesdag utan ursprung R4.', ARENDETS_DAG, senare),
  ]);

  const org = await withAdmin(async (db) => (await db.query<{ id: string }>(
    'SELECT id FROM crm.organizations WHERE company_id = $1 AND name = $2', [bolag, KUND])).rows[0]?.id);
  expect(org, `relationen ${KUND}`).toBeDefined();
  relation = org!;

  // M1 för hand, med användarens nyckel.
  await atgard(bolag, user.token, 'record_crm_commitment', {
    organization_id: relation, direction: 'we_owe', body: 'Handlöftet M1.',
    occurred_at: '2026-09-06T09:00:00Z', due_date: SENAST_M1, source_system: 'manual',
  });

  // AI-löftet, med en agentnyckel: fälten får ursprunget ai och visas som gissningar.
  const nyckel = await api.post(`/api/companies/${bolag}/agent-tokens`)
    .set('Authorization', `Bearer ${user.token}`).send({ name: 'Tidsagenten' });
  expect(nyckel.status, JSON.stringify(nyckel.body)).toBe(201);
  agentnyckel = nyckel.body.token as string;
  await atgard(bolag, agentnyckel, 'record_crm_commitment', {
    organization_id: relation, direction: 'we_owe', body: 'AI-löftet T3.',
    occurred_at: '2026-09-07T09:00:00Z', due_date: SENAST_AI, source_system: 'manual',
  });

  // Intag 2 i B: ärendena bakom S1 och S2 stängs i källan.
  await intag(bolag, user.token, [
    loftet('linear', 'linear:LOC-5202', 'they_owe', 'Stängt ärende S1.', STANGDA_NAR, senare, 'done'),
    loftet('linear', 'linear:LOC-5203', 'they_owe', 'Avbrutet ärende S2.', STANGDA_NAR, senare, 'dropped'),
  ]);

  // Registreringstiderna sätts direkt i tabellen, så att «registrerat» inte
  // beror på dagen provet körs.
  await withAdmin(async (db) => {
    const satt = (ts: string, sourceSystem: string, sourceRef: string) => db.query(
      `UPDATE crm.commitments SET created_at = $1
       WHERE company_id = $2 AND source_system = $3 AND source_ref = $4`, [ts, bolag, sourceSystem, sourceRef]);
    await satt('2026-09-05T08:00:00Z', 'linear', 'linear:LOC-5201');
    await satt('2026-09-03T15:00:00Z', 'gmail', 'gmail:5201a1');
    await satt('2026-09-04T12:00:00Z', 'calendar', 'calendar:TIDER5201');
    await db.query(
      `UPDATE crm.commitments SET created_at = $1 WHERE company_id = $2 AND body = $3`,
      ['2026-09-06T20:00:00Z', bolag, 'Handlöftet M1.']);
    // L0 stängt som före A-2: status utan ursprungsrad (intag 1 skickade ingen status).
    await db.query(
      `UPDATE crm.commitments SET status = 'done', completed_at = now()
       WHERE company_id = $1 AND source_system = 'linear' AND source_ref = 'linear:LOC-5208'`, [bolag]);
  });

  agent = supertest.agent(app);
  const inloggning = await agent.post('/app/login').type('form').send({ email: user.email, password: PASSWORD });
  expect(inloggning.status, inloggning.text).toBe(302);

  // Davids handgrepp i vyn: statusens ursprung blir human.
  const tillbaka = `/app/c/${bolag}/commitments?status=open`;
  for (const [ref, handgrepp] of [['linear:LOC-5206', 'done'], ['linear:LOC-5207', 'drop']] as const) {
    const id = await loftesId('linear', ref);
    const r = await agent.post(`/app/c/${bolag}/commitments/${id}/${handgrepp}`).type('form').send({ back: tillbaka });
    expect(r.status, r.text).toBe(302);
  }

  // Löftesdagens eget ursprung, ett fall per sort. R1: David rättar Lovades i
  // formuläret Rätta, och synken skickar sedan ärendets dag igen utan att få
  // skriva över den. R2: AI:t rättar löftesdagen. R3: David rättar bara
  // Senast, så löftesdagen är fortfarande synkens. R4: löftesdagen saknar
  // ursprungsrad, som ett löfte från innan ursprunget började sparas.
  const ratta = async (id: string, falt: Record<string, string>) => {
    const r = await agent.post(`/app/c/${bolag}/relations/${relation}/edit`).type('form')
      .send({ commitment_id: id, back: `/app/c/${bolag}/relations/${relation}`, ...falt });
    expect(r.status, r.text).toBe(302);
    expect(r.headers.location ?? '', 'rättelsen ska inte ge ett fel').not.toContain('fel=');
  };
  await ratta(await loftesId('linear', 'linear:LOC-5210'), {
    occurred_at: RATTAD_DAG, fore_occurred_at: ARENDETS_DAG.slice(0, 10),
  });
  await intag(bolag, user.token, [
    loftet('linear', 'linear:LOC-5210', 'they_owe', 'Davids löftesdag R1.', ARENDETS_DAG, senare),
  ]);
  await atgard(bolag, agentnyckel, 'update_crm_commitment', {
    commitment_id: await loftesId('linear', 'linear:LOC-5211'), occurred_at: `${RATTAD_DAG}T09:00:00Z`,
  });
  await ratta(await loftesId('linear', 'linear:LOC-5212'), { due_date: SENAST_RATTAT, fore_due_date: senare });
  const r4 = await loftesId('linear', 'linear:LOC-5213');
  await withAdmin((db) => db.query(
    `DELETE FROM crm.field_provenance WHERE company_id = $1 AND commitment_id = $2 AND field = 'occurred_at'`, [bolag, r4]));

  // Grannbolagets löfte, med grannens nyckel.
  await intag(grannbolag, granne.token, [
    loftet('gmail', 'gmail:5203aa', 'we_owe', 'Grannens löfte A3.', '2026-09-02T09:00:00Z', null, undefined, 'Grannens kund AB'),
  ]);
});

type Rad = Record<string, unknown>;
const raden = (rader: Rad[], body: string): Rad => {
  const rad = rader.find((r) => r.body === body);
  expect(rad, `raden ${body}`).toBeDefined();
  return rad!;
};

describe('löftets tre tider i listan', () => {
  it('A1 varje rad bär löftestiden, registreringstiden och förfallodatumet', async () => {
    const rader = (await atgard(bolag, user.token, 'list_crm_commitments', { status: 'open' })).result as Rad[];
    const l1 = raden(rader, 'Ärendelöftet L1.');
    expect(l1.occurred_at).toBe('2026-09-02T09:00:00.000Z');
    expect(l1.created_at).toBe('2026-09-05T08:00:00.000Z');
    expect(l1.due_date).toBe(SENAST_L1);
    expect(raden(rader, 'Mailöftet G1.').created_at).toBe('2026-09-03T15:00:00.000Z');
    expect(raden(rader, 'Kalenderlöftet K1.').due_date).toBeNull();
  });

  it('A2 svaret är bakåtkompatibelt: de sexton fälten som förut plus created_at och unconfirmed_ai', async () => {
    const NYCKLAR = [
      'body', 'created_at', 'direction', 'due_date', 'id', 'occurred_at', 'organization_id', 'organization_name',
      'organization_roll', 'person_id', 'person_name', 'person_organization_id', 'sfar', 'snoozed_until',
      'source_ref', 'source_system', 'status', 'unconfirmed_ai',
    ];
    expect(NYCKLAR).toHaveLength(18);
    const oppna = (await atgard(bolag, user.token, 'list_crm_commitments', { status: 'open' })).result as Rad[];
    expect(Object.keys(raden(oppna, 'Ärendelöftet L1.')).sort()).toEqual(NYCKLAR);
    const klara = (await atgard(bolag, user.token, 'list_crm_commitments', { status: 'done' })).result as Rad[];
    expect(klara.length).toBeGreaterThan(0);
    for (const rad of klara) expect(Object.keys(rad).sort(), String(rad.body)).toEqual(NYCKLAR);
  });

  it('A3 ett annat bolag ser inga av bolagets löften, också med det nya fältet', async () => {
    const grannens = (await atgard(grannbolag, granne.token, 'list_crm_commitments', {})).result as Rad[];
    expect(grannens).toHaveLength(1);
    expect(grannens[0]!.body).toBe('Grannens löfte A3.');
    expect(Object.hasOwn(grannens[0]!, 'created_at')).toBe(true);
    const bolagets = (await atgard(bolag, user.token, 'list_crm_commitments', {})).result as Rad[];
    expect(bolagets.map((r) => r.body)).not.toContain('Grannens löfte A3.');
    await atgard(grannbolag, user.token, 'list_crm_commitments', {}, 404);
  });

  it('D1 dokumentet beskriver de tre tiderna i ett eget avsnitt efter källraden', async () => {
    const doc = await readFile(new URL('../../docs/MCP_ACTIONS.md', import.meta.url), 'utf8');
    const rubrik = '## Löftets tre tider (crm 5.2)';
    expect(doc.split(rubrik)).toHaveLength(2);
    expect(doc.indexOf(rubrik)).toBeGreaterThan(doc.indexOf('## Källan på varje rad (crm 4.2)'));
    expect(doc.indexOf('## Källan på varje rad (crm 4.2)')).toBeGreaterThan(-1);
    const avsnitt = doc.split(rubrik)[1]!.split(/\n## /)[0]!;
    for (const term of ['list_crm_commitments', 'occurred_at', 'created_at', 'due_date']) {
      expect(avsnitt, term).toContain('`' + term + '`');
    }
    for (const ord of ['Lovat', 'Senast', 'registrerat', 'ärendet skapat', 'stängdes']) expect(avsnitt, ord).toContain(ord);
  });
});

/** Texten som den syns: varje tagg blir ett blanksteg, blanktecken slås ihop. */
function synlig(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Första tabellraden som innehåller texten (samma uttryck som v12TableRow i crm-views). */
function radenMed(sida: string, text: string): string {
  const rad = sida.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/g)?.find((del) => del.includes(text));
  expect(rad, `raden ${text}`).toBeDefined();
  return rad!;
}

const cellUttryck = (etikett: string) => new RegExp(`<td\\b[^>]*\\bdata-etikett="${etikett}"[^>]*>([\\s\\S]*?)<\\/td>`);

/** Innehållet i cellen som staplingen gett etiketten. */
function cellen(rad: string, etikett: string): string {
  const m = cellUttryck(etikett).exec(rad);
  expect(m, `cellen ${etikett}`).not.toBeNull();
  return m![1]!;
}

/** Varje cells etikett i ordning, tom sträng när cellen saknar en. */
function etiketterna(rad: string): string[] {
  return [...rad.matchAll(/<td\b([^>]*)>/g)].map((m) => /\bdata-etikett="([^"]*)"/.exec(m[1]!)?.[1] ?? '');
}

/** Provets egen kontroll: sant bara när cellen Lovat finns och dess text börjar med dagen. Fäller aldrig själv. */
function lovatVisar(rad: string, dagen: string): boolean {
  const m = cellUttryck('Lovat').exec(rad);
  return m !== null && synlig(m[1]!).startsWith(dagen);
}

const KOLUMNER = ['Riktning', 'Sfär', 'Vad', 'Vem', 'Lovat', 'Senast', 'Källa', ''];
const atagandevyn = (status: Status) => las(`/app/c/${bolag}/commitments?status=${status}`);

describe('åtagandevyns tider', () => {
  it('V1 rubrikraden är Riktning, Sfär, Vad, Vem, Lovat, Senast, Källa och handgreppen', async () => {
    for (const status of ['open', 'done'] as const) {
      const sida = await atagandevyn(status);
      const thead = /<thead\b[^>]*>([\s\S]*?)<\/thead>/.exec(sida);
      expect(thead, `rubrikraden på ${status}`).not.toBeNull();
      const rubriker = [...thead![1]!.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/g)].map((m) => synlig(m[1]!));
      expect(rubriker, status).toEqual(KOLUMNER);
    }
  });

  it('V2 ärendelöftet: löftesdagen, märket ärendet skapat och registreringsdagen', async () => {
    const lovat = cellen(radenMed(await atagandevyn('open'), 'Ärendelöftet L1.'), 'Lovat');
    expect(lovat).toContain('2026-09-02 <span class="muted">ärendet skapat</span>');
    expect(lovat).toContain('<span class="muted">registrerat 2026-09-05</span>');
    expect(synlig(lovat)).toBe('2026-09-02 ärendet skapat registrerat 2026-09-05');
  });

  it('V3 samma dag: ingen registrerat-rad och inget märke för ett mail', async () => {
    const lovat = cellen(radenMed(await atagandevyn('open'), 'Mailöftet G1.'), 'Lovat');
    expect(synlig(lovat)).toBe('2026-09-03');
    expect(lovat).not.toContain('registrerat');
    expect(lovat).not.toContain('ärendet skapat');
  });

  it('V4 kalendern, handvägen, AI-löftet och mailet bär inget märke', async () => {
    const sida = await atagandevyn('open');
    const k1 = cellen(radenMed(sida, 'Kalenderlöftet K1.'), 'Lovat');
    const m1 = cellen(radenMed(sida, 'Handlöftet M1.'), 'Lovat');
    const ai = cellen(radenMed(sida, 'AI-löftet T3.'), 'Lovat');
    const i1 = cellen(radenMed(sida, 'Idaglöftet I1.'), 'Lovat');
    expect(synlig(k1)).toBe('2026-09-04');
    expect(synlig(m1)).toBe('2026-09-06');
    // Registreringen är dagens, så raden registrerat följer efter löftesdagen.
    expect(synlig(ai).startsWith('2026-09-07')).toBe(true);
    expect(synlig(i1).startsWith('2026-09-02')).toBe(true);
    for (const cell of [k1, m1, ai, i1]) expect(cell).not.toContain('ärendet skapat');
  });

  it('V5 Senast bär förfallodatumet och Lovat inte', async () => {
    const sida = await atagandevyn('open');
    const l1 = radenMed(sida, 'Ärendelöftet L1.');
    expect(synlig(cellen(l1, 'Senast')).startsWith(SENAST_L1)).toBe(true);
    expect(cellen(l1, 'Lovat')).not.toContain(SENAST_L1);
    expect(synlig(cellen(radenMed(sida, 'Kalenderlöftet K1.'), 'Senast'))).toBe('—');
  });

  it('V6 filterlänken för det aktiva filtret bär aria-current="page", och bara den', async () => {
    const FILTER: Array<[Status, string]> = [['open', 'Öppna'], ['done', 'Klara'], ['dropped', 'Avskrivna']];
    for (const [status, etikett] of FILTER) {
      const sida = await atagandevyn(status);
      for (const [, annan] of FILTER) {
        const markerad = sida.includes(`aria-current="page">${annan}</a>`);
        expect(markerad, `${status}: ${annan}`).toBe(annan === etikett);
      }
    }
  });

  it('V7 på telefonbredd står varje värde med sin kolumnrubrik, och ingen staplingsregel döljer en cell', async () => {
    for (const status of ['open', 'done'] as const) {
      const sida = await atagandevyn(status);
      expect(sida, status).toContain('<table data-staplas');
      const tbody = /<tbody\b[^>]*>([\s\S]*?)<\/tbody>/.exec(sida);
      expect(tbody, `tabellkroppen på ${status}`).not.toBeNull();
      const rader = tbody![1]!.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/g) ?? [];
      expect(rader.length, status).toBeGreaterThan(0);
      for (const rad of rader) expect(etiketterna(rad), `${status}: ${synlig(rad).slice(0, 60)}`).toEqual(KOLUMNER);
      if (status === 'open') {
        const l1 = radenMed(sida, 'Ärendelöftet L1.');
        expect(cellen(l1, 'Lovat')).toContain('2026-09-02');
        expect(cellen(l1, 'Lovat')).toContain('2026-09-05');
        expect(cellen(l1, 'Senast')).toContain(SENAST_L1);
      }
      expect(sida).toContain('table[data-staplas] > tbody > tr > td[data-etikett]::before');
      expect(sida).toContain('content: attr(data-etikett)');
      const regler = sida.match(/^\s*table\[data-staplas\][^{]*\{[^}]*\}/gm) ?? [];
      expect(regler.length).toBeGreaterThanOrEqual(8);
      for (const regel of regler) {
        expect(regel).not.toContain('display: none');
        expect(regel).not.toContain('visibility: hidden');
      }
    }
  });

  it('N1 negativ kontroll: provets kontroll fäller en rad där Lovat visar förfallodatumet', async () => {
    const rad = radenMed(await atagandevyn('open'), 'Ärendelöftet L1.');
    expect(lovatVisar(rad, '2026-09-02')).toBe(true);
    const lovat = cellen(rad, 'Lovat');
    const senast = cellen(rad, 'Senast');
    expect(lovat).not.toBe(senast);
    const forfallodatumetILovat = rad.replace(lovat, senast);
    expect(forfallodatumetILovat).not.toBe(rad);
    expect(lovatVisar(forfallodatumetILovat, '2026-09-02')).toBe(false);
    const utanLovat = rad.replace(cellUttryck('Lovat'), '');
    expect(utanLovat).not.toBe(rad);
    expect(lovatVisar(utanLovat, '2026-09-02')).toBe(false);
  });
});

/** Trådens händelser, var och en som sitt eget fragment. */
const handelserna = (sida: string): string[] => sida.match(/<li class="thread__ev">[\s\S]*?<\/li>/g) ?? [];

/** Första händelsen i tråden som innehåller texten (samma uttryck som v12Event i crm-views). */
function handelsen(sida: string, text: string): string {
  const fragment = handelserna(sida).find((del) => del.includes(text));
  expect(fragment, `händelsen ${text}`).toBeDefined();
  return fragment!;
}

/** Första kortet på Idag som innehåller texten. */
function kortet(sida: string, text: string): string {
  const fragment = sida.match(/<article class="today__card">[\s\S]*?<\/article>/g)?.find((del) => del.includes(text));
  expect(fragment, `kortet ${text}`).toBeDefined();
  return fragment!;
}

const traden = () => las(`/app/c/${bolag}/relations/${relation}`);

describe('tidernas namn i tråden och på Idag', () => {
  it('T1 ärendelöftets rad i tråden: Lovat, löftesdagen och märket ärendet skapat', async () => {
    expect(handelsen(await traden(), 'Ärendelöftet L1.'))
      .toContain('Lovat 2026-09-02 <span class="muted">ärendet skapat</span></p>');
  });

  it('T2 mailet, kalendern och handvägen: Lovat och löftesdagen, inget märke', async () => {
    const sida = await traden();
    const FALL: Array<[string, string]> = [
      ['Mailöftet G1.', 'Lovat 2026-09-03</p>'],
      ['Kalenderlöftet K1.', 'Lovat 2026-09-04</p>'],
      ['Handlöftet M1.', 'Lovat 2026-09-06</p>'],
    ];
    for (const [text, rad] of FALL) {
      const handelse = handelsen(sida, text);
      expect(handelse, text).toContain(rad);
      expect(handelse, text).not.toContain('ärendet skapat');
    }
  });

  it('T3 gissningsraden säger Lovat och Senast, och formuläret Rätta säger fortfarande Lovades', async () => {
    const handelse = handelsen(await traden(), 'AI-löftet T3.');
    const rad = radenMed(await atagandevyn('open'), 'AI-löftet T3.');
    for (const [yta, fragment] of [['tråden', handelse], ['åtagandevyn', rad]] as const) {
      expect(fragment, yta).toContain('<span class="k">Lovat</span>');
      expect(fragment, yta).toContain('<span class="k">Senast</span>');
      expect(fragment, yta).not.toContain('<span class="k">Lovades</span>');
    }
    expect(handelse).toContain('<label>Lovades<input type="date"');
  });

  it('T4 stängningsraden bär ingen Lovat-rad', async () => {
    const stangning = handelserna(await traden())
      .find((del) => del.includes('Löfte klart') && del.includes('Stängt ärende S1.'));
    expect(stangning, 'stängningsraden för S1').toBeDefined();
    expect(stangning).not.toContain('Lovat');
  });

  it('I1 Idags löfteskort: Senast i chipet och Lovat i stället för sades', async () => {
    const sida = await las(`/app/c/${bolag}/idag`);
    const kort = kortet(sida, 'Idaglöftet I1.');
    expect(kort).toContain('<span class="muted"> · Lovat 2026-09-02 via ');
    expect(kort).toContain(`>Senast ${SENAST_I1}</span>`);
    expect(sida).not.toContain(' · sades ');
  });
});

/** 4.2:s källrad för ett ärende, skriven som facit och inte hämtad ur koden. */
const KALLA = (id: string): string =>
  `Ärende · <span class="thread__ref">linear:${id}</span> · <a href="/vy/arende/${id}" target="_blank" rel="noopener" aria-label="Öppna ärendet i ärendeplattformen (ny flik)">Öppna ↗</a>`;

const kallcellen = (sida: string, text: string) => cellen(radenMed(sida, text), 'Källa');

describe('löften som stängts av källan', () => {
  it('S1 ett ärende som synken stängt står under Klara med «Ärendet LOC-5202 stängdes»', async () => {
    expect(kallcellen(await atagandevyn('done'), 'Stängt ärende S1.')).toBe(`${KALLA('LOC-5202')} · Ärendet LOC-5202 stängdes`);
  });

  it('S2 ett ärende som synken avbrutit står under Avskrivna med texten', async () => {
    expect(kallcellen(await atagandevyn('dropped'), 'Avbrutet ärende S2.')).toBe(`${KALLA('LOC-5203')} · Ärendet LOC-5203 stängdes`);
  });

  it('S3 ett ärende som kom in stängt bär texten', async () => {
    expect(kallcellen(await atagandevyn('done'), 'Stängt från början S3.')).toBe(`${KALLA('LOC-5205')} · Ärendet LOC-5205 stängdes`);
  });

  it('S4 en nyckel utan ärendets form ger ingen text', async () => {
    expect(kallcellen(await atagandevyn('done'), 'Formlöst ärende S4.')).toBe('Ärende · <span class="thread__ref">linear:Projekt-S4</span>');
  });

  it('S5 ett löfte David markerat klart får ingen text, bara tillägget rättad av dig', async () => {
    expect(kallcellen(await atagandevyn('done'), 'Davids klara H1.')).toBe(`${KALLA('LOC-5206')} · rättad av dig`);
  });

  it('S6 ett löfte David skrivit av får ingen text', async () => {
    expect(kallcellen(await atagandevyn('dropped'), 'Davids avskrivna H2.')).toBe(`${KALLA('LOC-5207')} · rättad av dig`);
  });

  it('S7 ett ärendelöfte stängt utan statusens ursprungsrad, som före A-2, får ingen text', async () => {
    expect(kallcellen(await atagandevyn('done'), 'Gammalt klart L0.')).toBe(KALLA('LOC-5208'));
  });

  it('S8 texten står bara under Klara och Avskrivna, och inget stängt löfte står under Öppna', async () => {
    const antal = (sida: string) => sida.split('stängdes').length - 1;
    expect(antal(await atagandevyn('done'))).toBe(2);
    expect(antal(await atagandevyn('dropped'))).toBe(1);
    const oppna = await atagandevyn('open');
    // L1 är öppet med statusens ursprung sync ur linear: statusvillkoret fäller det.
    expect(oppna).toContain('Ärendelöftet L1.');
    expect(antal(oppna)).toBe(0);
    for (const text of [
      'Stängt ärende S1.', 'Avbrutet ärende S2.', 'Stängt från början S3.', 'Formlöst ärende S4.', 'Fel källsystem S9.',
      'Davids klara H1.', 'Davids avskrivna H2.', 'Gammalt klart L0.',
    ]) expect(oppna, text).not.toContain(text);
  });

  it('S9 stängt av synken med en nyckel i ärendets form men källsystemet gmail får ingen text', async () => {
    expect(kallcellen(await atagandevyn('done'), 'Fel källsystem S9.')).toBe('Gmail · <span class="thread__ref">linear:LOC-5209</span>');
  });
});

/**
 * Lovat för samma löfte i åtagandevyn och i tråden: dagen, och märket «ärendet
 * skapat» efter den bara när `markt` är sant. Båda ytorna prövas varje gång.
 */
async function lovatPaBadaYtorna(text: string, dagen: string, markt: boolean): Promise<void> {
  const cell = cellen(radenMed(await atagandevyn('open'), text), 'Lovat');
  expect(synlig(cell).startsWith(markt ? `${dagen} ärendet skapat` : dagen), `åtagandevyn: ${synlig(cell)}`).toBe(true);
  expect(cell.includes('ärendet skapat'), `åtagandevyn, märket: ${text}`).toBe(markt);
  const handelse = handelsen(await traden(), text);
  expect(handelse, `tråden: ${text}`)
    .toContain(markt ? `Lovat ${dagen} <span class="muted">ärendet skapat</span></p>` : `Lovat ${dagen}</p>`);
  expect(handelse.includes('ärendet skapat'), `tråden, märket: ${text}`).toBe(markt);
}

// Märket säger att dagen är ärendets skapad-datum. Det står när löftesdagens
// ursprung är synken, eller när dagen saknar ursprungsrad och därför räknas
// som ärendets. En dag som David eller AI:t skrivit är inte ärendets.
describe('märket följer löftesdagens eget ursprung', () => {
  it('U1 David rättade Lovades på ett ärendelöfte: hans dag står utan märket, också efter nästa synk', async () => {
    const id = await loftesId('linear', 'linear:LOC-5210');
    expect(await ursprunget(id, 'occurred_at')).toBe('human');
    await lovatPaBadaYtorna('Davids löftesdag R1.', '2026-09-01', false);
    expect(kallcellen(await atagandevyn('open'), 'Davids löftesdag R1.')).toBe(`${KALLA('LOC-5210')} · rättad av dig`);
  });

  it('U2 AI:t rättade löftesdagen på ett ärendelöfte: ingen märkning som ärendets dag', async () => {
    expect(await ursprunget(await loftesId('linear', 'linear:LOC-5211'), 'occurred_at')).toBe('ai');
    await lovatPaBadaYtorna('AI:ts löftesdag R2.', '2026-09-01', false);
  });

  it('U3 David rättade bara Senast: löftesdagen är fortfarande ärendets och bär märket', async () => {
    const id = await loftesId('linear', 'linear:LOC-5212');
    expect(await ursprunget(id, 'occurred_at')).toBe('sync');
    expect(await ursprunget(id, 'due_date')).toBe('human');
    await lovatPaBadaYtorna('Davids förfallodatum R3.', '2026-09-09', true);
    expect(kallcellen(await atagandevyn('open'), 'Davids förfallodatum R3.')).toBe(`${KALLA('LOC-5212')} · rättad av dig`);
  });

  it('U4 löftesdagen saknar ursprungsrad, som före ursprungen: märket står', async () => {
    expect(await ursprunget(await loftesId('linear', 'linear:LOC-5213'), 'occurred_at')).toBeNull();
    await lovatPaBadaYtorna('Löftesdag utan ursprung R4.', '2026-09-09', true);
  });

  it('U5 löftesdagen är synkens: märket står', async () => {
    expect(await ursprunget(await loftesId('linear', 'linear:LOC-5201'), 'occurred_at')).toBe('sync');
    await lovatPaBadaYtorna('Ärendelöftet L1.', '2026-09-02', true);
  });
});
