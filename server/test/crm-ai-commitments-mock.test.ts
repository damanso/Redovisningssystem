// Story 5.5, FR-39, kriterium 6: den negativa kontrollen. Idag och kön ska läsa
// samma brytare för obekräftade AI-löften. Läser en av dem sitt eget värde
// glider de isär, och ett löfte AI:n gissat syns på det ena stället men inte på
// det andra. Kontrollen vänder `INCLUDE_UNCONFIRMED_AI_COMMITMENTS` till
// mellanläget (*först efter bekräftelse*) och läser Idag, `crm_today`, listan,
// åtagandevyn och Min sida genom hela stacken (agent-token, executeAction,
// inloggningen, pageFor, tenanttransaktionen och Postgres). `vi.mock` gäller
// hela filen; därför är den här kontrollen en egen fil. Facit är literaler.
import supertest from 'supertest';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { INCLUDE_UNCONFIRMED_AI_COMMITMENTS } from '../src/services/crmDerivations.js';
import { api, app, createCompany, registerUser, type TestUser } from './helpers.js';

// Allt annat i crmDerivations (todayView, relationState, contactSuggestions) är det verkliga.
vi.mock('../src/services/crmDerivations.js', async (importActual) => {
  const actual = await importActual<typeof import('../src/services/crmDerivations.js')>();
  return { ...actual, INCLUDE_UNCONFIRMED_AI_COMMITMENTS: false };
});

const PASSWORD = 'mycket-hemligt-losen-123';

/**
 * UTC-datumet n dagar från provets ögonblick. Inget löfte här får ha passerat
 * sitt förfallodatum: relationskortet på Idag citerar då löftets text som skäl,
 * och den läsningen följer inte brytaren.
 */
const NU = Date.now();
const dag = (n: number): string => new Date(NU + n * 86_400_000).toISOString().slice(0, 10);

type Rad = Record<string, unknown>;

let user: TestUser;
let bolag: string;
let relation: string;
let agentnyckel: string;
let ua: ReturnType<typeof supertest.agent>;

/** En åtgärd genom REST; statusen asserteras med kroppen i meddelandet. */
async function atgard(bolagId: string, token: string, namn: string, indata: Record<string, unknown>, status = 200) {
  const r = await api.post(`/api/companies/${bolagId}/actions/${namn}`)
    .set('Authorization', `Bearer ${token}`).send(indata);
  expect(r.status, JSON.stringify(r.body)).toBe(status);
  return r.body;
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

/** Första tabellraden som innehåller texten (samma uttryck som v12TableRow i crm-views). */
function radenMed(sida: string, text: string): string {
  const rad = sida.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/g)?.find((d) => d.includes(text));
  expect(rad, `raden ${text}`).toBeDefined();
  return rad!;
}

/** Löftenas texter, sorterade. */
function texterna(rader: Rad[]): string[] {
  return rader.map((r) => String(r.body)).sort();
}

beforeAll(async () => {
  user = await registerUser('ailoftenmock');
  bolag = await createCompany(user.token, 'AI-löften Mock AB');
  relation = (await atgard(bolag, user.token, 'upsert_crm_organization', { name: 'Mockens AI-kund AB' })).result.id as string;
  const tok = await api.post(`/api/companies/${bolag}/agent-tokens`)
    .set('Authorization', `Bearer ${user.token}`).send({ name: 'Mockagenten' });
  expect(tok.status, JSON.stringify(tok.body)).toBe(201);
  agentnyckel = tok.body.token as string;
  ua = supertest.agent(app);
  const login = await ua.post('/app/login').type('form').send({ email: user.email, password: PASSWORD });
  expect(login.status, JSON.stringify(login.body)).toBe(302);

  const lofte = (body: string) => ({
    organization_id: relation, direction: 'we_owe', body, due_date: dag(2),
    occurred_at: '2026-11-22T09:00:00Z', source_system: 'manual',
  });
  await atgard(bolag, agentnyckel, 'record_crm_commitment', lofte('Obekräftat mock M.'));
  const aik = (await atgard(bolag, agentnyckel, 'record_crm_commitment', lofte('Bekräftas mock K.'))).result.id as string;
  await atgard(bolag, user.token, 'record_crm_commitment', lofte('Människans mock M.'));
  const sidan = `/app/c/${bolag}/relations/${relation}`;
  const svar = await ua.post(`${sidan}/confirm`).type('form').send({ back: sidan, field: 'body', commitment_id: aik });
  expect(svar.status, svar.text).toBe(302);
  expect(String(svar.headers.location ?? '')).not.toContain('fel=');
});

describe('mellanläget: Idag och listan läser samma brytare (negativ kontroll)', () => {
  it('N0 den utbytta konstanten är den som laddats', () => {
    expect(INCLUDE_UNCONFIRMED_AI_COMMITMENTS).toBe(false);
  });

  it('N1 Idag utesluter det obekräftade AI-löftet; det bekräftade syns som vilket löfte som helst', async () => {
    const sida = synlig(await las(`/app/c/${bolag}/idag`));
    expect(sida).toContain('Människans mock M.');
    expect(sida).toContain('Bekräftas mock K.');
    expect(sida).not.toContain('Obekräftat mock M.');
  });

  it('N2 crm_today utesluter det obekräftade AI-löftet', async () => {
    const idag = (await atgard(bolag, user.token, 'crm_today', {})).result as { commitments: Rad[] };
    expect(texterna(idag.commitments)).toEqual(['Bekräftas mock K.', 'Människans mock M.']);
  });

  it('N3 listan utan val utesluter det obekräftade AI-löftet', async () => {
    const rader = (await atgard(bolag, user.token, 'list_crm_commitments', { status: 'open' })).result as Rad[];
    expect(texterna(rader)).toEqual(['Bekräftas mock K.', 'Människans mock M.']);
    for (const rad of rader) expect(rad.unconfirmed_ai, String(rad.body)).toBe(false);
  });

  it('N4 listan med true tar med det obekräftade AI-löftet, märkt', async () => {
    const rader = (await atgard(bolag, user.token, 'list_crm_commitments', {
      status: 'open', include_unconfirmed_ai: true,
    })).result as Rad[];
    const rad = rader.find((r) => r.body === 'Obekräftat mock M.');
    expect(rad, 'Obekräftat mock M.').toBeDefined();
    expect(rad!.unconfirmed_ai).toBe(true);
  });

  it('N5 åtagandevyn visar det obekräftade AI-löftet med ✦', async () => {
    const rad = radenMed(await las(`/app/c/${bolag}/commitments?status=open`), 'Obekräftat mock M.');
    expect(rad).toContain('role="img"');
    expect(rad).toContain('aria-label="Inte bekräftad av dig"');
  });

  it('N6 Min sida visar det obekräftade AI-löftet', async () => {
    expect(synlig(await las(`/app/c/${bolag}/min-sida`))).toContain('Obekräftat mock M.');
  });
});
