// Story 5.11, FR-31: en yta som skriver «för AI:n» för hand lovar fångst
// också när den inte är i drift. Byt konstanten och läs de tre löftesytorna
// genom hela stacken. Databasen är verklig; bara fångstkonstanten byts.
import supertest from 'supertest';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { CapturePaths } from '../src/lib/crmRules.js';
import { CAPTURE_PATHS_IN_OPERATION } from '../src/services/crmDerivations.js';
import { api, app, createCompany, registerUser, type TestUser } from './helpers.js';

// `vi.mock` lyfts före importerna, så värdet som fabriken använder skapas här.
const { UTAN_SAMTALET } = vi.hoisted(() => {
  const UTAN_SAMTALET: CapturePaths = {
    contacts: ['mail', 'calendar', 'issues'],
    commitments: ['issues_waiting_external', 'promise_form'],
  };
  return { UTAN_SAMTALET };
});

// Allt annat i crmDerivations (todayView, relationState, contactSuggestions) är det verkliga.
vi.mock('../src/services/crmDerivations.js', async (importActual) => {
  const actual = await importActual<typeof import('../src/services/crmDerivations.js')>();
  return { ...actual, CAPTURE_PATHS_IN_OPERATION: UTAN_SAMTALET };
});

const DRIFT_LOFTEN = {
  commitmentsOpenEmpty: 'Löften kommer in av sig själva från ärenden märkta Väntar-extern och när du nämner det för AI:n, och du kan lägga till ett under Lova något på en relation.',
  promiseFormHint: 'Löften ur ärenden märkta Väntar-extern kommer in av sig själva, eller när du nämner det för AI:n. Det här är för det som sades i ett samtal eller möte.',
  customerCardEmpty: 'Inga öppna löften. Löften kommer från ärenden märkta Väntar-extern, när du nämner det för AI:n och från Lova något på relationen.',
};
const UTAN_SAMTALET_LOFTEN = {
  commitmentsOpenEmpty: 'Löften kommer in av sig själva från ärenden märkta Väntar-extern, och du kan lägga till ett under Lova något på en relation.',
  promiseFormHint: 'Löften ur ärenden märkta Väntar-extern kommer in av sig själva. Det här är för det som sades i ett samtal eller möte.',
  customerCardEmpty: 'Inga öppna löften. Löften kommer från ärenden märkta Väntar-extern och från Lova något på relationen.',
};

/** Texten som den syns: varje tagg blir ett blanksteg, så en mening över `<div class="big">` läses hel. */
function synlig(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
}

const PASSWORD = 'mycket-hemligt-losen-123';
let user: TestUser;
/** Bolaget T får aldrig en relation: Idag är tom och Relationer visar sitt tomläge bara då. */
let tomt: string;
let fullt: string;
let relationId: string;
let kundId: string;
let ua: ReturnType<typeof supertest.agent>;

async function las(sokvag: string): Promise<string> {
  const r = await ua.get(sokvag);
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return synlig(r.text);
}

beforeAll(async () => {
  user = await registerUser('samtalmock');
  tomt = await createCompany(user.token, 'Samtalmock Tomt AB');
  fullt = await createCompany(user.token, 'Samtalmock Fullt AB');
  const auth = { Authorization: `Bearer ${user.token}` };
  const org = await api.post(`/api/companies/${fullt}/actions/upsert_crm_organization`).set(auth)
    .send({ name: 'Samtalmock Relationen AB' });
  expect(org.status, JSON.stringify(org.body)).toBe(200);
  relationId = org.body.result.id as string;
  const kund = await api.post(`/api/companies/${fullt}/customers`).set(auth).send({ name: 'Samtalmock Kund AB' });
  expect(kund.status, JSON.stringify(kund.body)).toBe(201);
  kundId = kund.body.customer.id as string;
  ua = supertest.agent(app);
  const login = await ua.post('/app/login').type('form').send({ email: user.email, password: PASSWORD });
  expect(login.status, JSON.stringify(login.body)).toBe(302);
});

describe('löftesytorna följer konstanten utan AI-samtalet (negativ kontroll, 5.11)', () => {
  it('U0 den utbytta konstanten är den som laddats', () => {
    expect(CAPTURE_PATHS_IN_OPERATION).toEqual(UTAN_SAMTALET);
  });

  it('U1 åtagandevyn följer konstanten utan AI-samtalet', async () => {
    const sida = await las(`/app/c/${tomt}/commitments`);
    expect(sida).toContain(UTAN_SAMTALET_LOFTEN.commitmentsOpenEmpty);
    expect(sida).not.toContain(DRIFT_LOFTEN.commitmentsOpenEmpty);
    expect(sida).not.toContain('för AI:n');
  });

  it('U2 Lova något följer konstanten utan AI-samtalet', async () => {
    const sida = await las(`/app/c/${fullt}/relations/${relationId}`);
    expect(sida).toContain(UTAN_SAMTALET_LOFTEN.promiseFormHint);
    expect(sida).not.toContain(DRIFT_LOFTEN.promiseFormHint);
    expect(sida).not.toContain('för AI:n');
  });

  it('U3 kundkortet följer konstanten utan AI-samtalet', async () => {
    const sida = await las(`/app/c/${fullt}/customers/${kundId}`);
    expect(sida).toContain(UTAN_SAMTALET_LOFTEN.customerCardEmpty);
    expect(sida).not.toContain(DRIFT_LOFTEN.customerCardEmpty);
    expect(sida).not.toContain('för AI:n');
  });
});
