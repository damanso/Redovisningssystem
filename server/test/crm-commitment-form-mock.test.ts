// Story 5.4, FR-32, kriterium 4: den negativa kontrollen. En server som
// ignorerar Lovades ger varje löfte postningens tidpunkt och släpper igenom ett
// datum i framtiden. Filen byter `promisedAtFromForm` mot en funktion som
// bortser från fältet och alltid ger nuet, och postar genom hela stacken
// (inloggning, vy-POST:en, runViewAction, tenanttransaktionen, Postgres). Då
// hade S1:s och S4:s facit fallit, och anropsloggen visar att vy-POST:en läser
// fältet genom funktionen. `vi.mock` gäller hela filen; därför en egen fil.
import supertest from 'supertest';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { promisedAtFromForm } from '../src/lib/crmRules.js';
import { api, app, createCompany, registerUser, type TestUser } from './helpers.js';

// `vi.mock` lyfts före importerna, så loggen som fabriken skriver i skapas här.
const { anrop } = vi.hoisted(() => ({ anrop: [] as unknown[] }));

// Allt annat i crmRules (dateToTimestamp, correctedEventFields, captureTexts …) är det verkliga.
vi.mock('../src/lib/crmRules.js', async (importActual) => {
  const actual = await importActual<typeof import('../src/lib/crmRules.js')>();
  return {
    ...actual,
    promisedAtFromForm: (value: unknown, now: Date) => {
      anrop.push(value);
      return { ok: true as const, occurred_at: now.toISOString() };
    },
  };
});

const PASSWORD = 'mycket-hemligt-losen-123';
const LOVADES = '2026-09-15';

let user: TestUser;
let bolag: string;
let relation: string;
let agent: ReturnType<typeof supertest.agent>;

interface Postning { status: number; location: string; fore: number; efter: number }
let ignorerat: Postning;
let utanVakt: Postning;
/** Anropsloggen som den var efter postningarna, innan N0 lägger till sitt eget anrop. */
let loggen: unknown[];

/** En åtgärd genom REST; statusen asserteras med kroppen i meddelandet. */
async function atgard(bolagId: string, token: string, namn: string, indata: Record<string, unknown>, status = 200) {
  const r = await api.post(`/api/companies/${bolagId}/actions/${namn}`)
    .set('Authorization', `Bearer ${token}`).send(indata);
  expect(r.status, JSON.stringify(r.body)).toBe(status);
  return r.body;
}

/** En POST som formulär med den inloggade agenten, med klockan läst före och efter. */
async function posta(sokvag: string, falt: Record<string, string>): Promise<Postning> {
  const fore = Date.now();
  const r = await agent.post(sokvag).type('form').send(falt);
  const efter = Date.now();
  const location: unknown = r.headers.location;
  return { status: r.status, location: typeof location === 'string' ? location : '', fore, efter };
}

/** Bolagets öppna löften genom REST → list_crm_commitments. */
async function oppnaLoften(): Promise<{ body: string; occurred_at: string }[]> {
  return (await atgard(bolag, user.token, 'list_crm_commitments', { status: 'open' })).result as { body: string; occurred_at: string }[];
}

beforeAll(async () => {
  user = await registerUser('loftesformmock');
  bolag = await createCompany(user.token, 'Löftesformen Mock AB');
  relation = (await atgard(bolag, user.token, 'upsert_crm_organization', { name: 'Mockens kund AB' })).result.id as string;
  agent = supertest.agent(app);
  const login = await agent.post('/app/login').type('form').send({ email: user.email, password: PASSWORD });
  expect(login.status, JSON.stringify(login.body)).toBe(302);
  const back = `/app/c/${bolag}/relations/${relation}`;
  ignorerat = await posta(`${back}/commit`, { back, body: 'Ignorerat datum N1.', direction: 'we_owe', occurred_at: LOVADES });
  utanVakt = await posta(`${back}/commit`, { back, body: 'Framtid utan vakt N2.', direction: 'we_owe', occurred_at: '2099-01-01' });
  loggen = [...anrop];
});

describe('en server som ignorerar Lovades fäller provet (negativ kontroll)', () => {
  it('N0 den utbytta funktionen är den som laddats', () => {
    expect(promisedAtFromForm('2026-09-15', new Date('2026-11-22T10:15:00.000Z')))
      .toEqual({ ok: true, occurred_at: '2026-11-22T10:15:00.000Z' });
  });

  it('N1 ett datum bakåt blir postningens tidpunkt, så S1:s facit hade fallit', async () => {
    expect(ignorerat.status).toBe(302);
    expect(ignorerat.location).not.toContain('fel=');
    const rad = (await oppnaLoften()).find((c) => c.body === 'Ignorerat datum N1.');
    expect(rad, 'löftet Ignorerat datum N1.').toBeDefined();
    expect(rad!.occurred_at).not.toBe('2026-09-15T12:00:00.000Z');
    const lovad = Date.parse(rad!.occurred_at);
    expect(lovad).toBeGreaterThanOrEqual(ignorerat.fore - 1000);
    expect(lovad).toBeLessThanOrEqual(ignorerat.efter + 1000);
  });

  it('N2 ett datum i framtiden skapar ett löfte, så S4:s facit hade fallit', async () => {
    expect(utanVakt.status).toBe(302);
    expect(utanVakt.location).not.toContain('fel=');
    expect((await oppnaLoften()).map((c) => c.body)).toContain('Framtid utan vakt N2.');
  });

  it('N3 vy-POST:en läser fältet genom funktionen, en gång per postning, med fältets råa värde', () => {
    expect(loggen).toEqual(['2026-09-15', '2099-01-01']);
  });
});
