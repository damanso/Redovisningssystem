// Story 5.1, FR-31, kriterium 4: en yta som skriver sin fångsttext för hand i
// stället för att läsa `CAPTURE_TEXTS` glider isär från konstanten, och nästa
// väg som tas i drift (kalendern i 5.9, AI-samtalet i 5.11) syns då inte där.
// Den negativa kontrollen byter `CAPTURE_PATHS_IN_OPERATION` mot en utökad
// konstant och läser samma fem ytor genom hela stacken (inloggning, pageFor,
// tenanttransaktionen, Postgres). `vi.mock` gäller hela filen; därför är den
// här kontrollen en egen fil. Facit är literaler ur Dev Notes (P4 och P5).
import supertest from 'supertest';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { CapturePaths } from '../src/lib/crmRules.js';
import { CAPTURE_PATHS_IN_OPERATION } from '../src/services/crmDerivations.js';
import { api, app, createCompany, registerUser, type TestUser } from './helpers.js';

// `vi.mock` lyfts före importerna, så värdet som fabriken använder skapas här.
const { UTOKAD } = vi.hoisted(() => {
  const UTOKAD: CapturePaths = {
    contacts: ['mail', 'calendar', 'issues'],
    commitments: ['issues_waiting_external', 'ai_conversation', 'promise_form'],
  };
  return { UTOKAD };
});

// Allt annat i crmDerivations (todayView, relationState, contactSuggestions) är det verkliga.
vi.mock('../src/services/crmDerivations.js', async (importActual) => {
  const actual = await importActual<typeof import('../src/services/crmDerivations.js')>();
  return { ...actual, CAPTURE_PATHS_IN_OPERATION: UTOKAD };
});

/** Dagens texter (P2), som inte får stå kvar när konstanten är utökad. */
const I_DRIFT = {
  todayQuiet: 'Kommer något in via mail eller ärenden dyker det upp av sig självt.',
  relationsLede: 'härlett ur mail, ärenden och bokförda fakturor',
  relationsEmpty: 'De flesta dyker upp av sig själva när mail och ärenden kommer in.',
  commitmentsOpenEmpty: 'Löften kommer in av sig själva från ärenden märkta Väntar-extern, och du kan lägga till ett under Lova något på en relation.',
  promiseFormHint: 'Löften ur ärenden märkta Väntar-extern kommer in av sig själva. Det här är för det som sades i ett samtal eller möte.',
  customerCardEmpty: 'Inga öppna löften. Löften kommer från ärenden märkta Väntar-extern och från Lova något på relationen.',
};
/** Texterna för den utökade konstanten (P4 och P5). */
const UTOKADE = {
  todayQuiet: 'Kommer något in via mail, möten eller ärenden dyker det upp av sig självt.',
  relationsLede: 'härlett ur mail, möten, ärenden och bokförda fakturor',
  relationsEmpty: 'De flesta dyker upp av sig själva när mail, möten och ärenden kommer in.',
  commitmentsOpenEmpty: 'Löften kommer in av sig själva från ärenden märkta Väntar-extern och när du nämner det för AI:n, och du kan lägga till ett under Lova något på en relation.',
  promiseFormHint: 'Löften ur ärenden märkta Väntar-extern och som du nämner för AI:n kommer in av sig själva. Det här är för det som sades i ett samtal eller möte.',
  customerCardEmpty: 'Inga öppna löften. Löften kommer från ärenden märkta Väntar-extern, när du nämner det för AI:n och från Lova något på relationen.',
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
  user = await registerUser('fangstmock');
  tomt = await createCompany(user.token, 'Fångsttomt AB');
  fullt = await createCompany(user.token, 'Fångstfullt AB');
  const auth = { Authorization: `Bearer ${user.token}` };
  const org = await api.post(`/api/companies/${fullt}/actions/upsert_crm_organization`).set(auth)
    .send({ name: 'Fångstrelationen AB' });
  expect(org.status, JSON.stringify(org.body)).toBe(200);
  relationId = org.body.result.id as string;
  const kund = await api.post(`/api/companies/${fullt}/customers`).set(auth).send({ name: 'Kundkortet Utan Löften AB' });
  expect(kund.status, JSON.stringify(kund.body)).toBe(201);
  kundId = kund.body.customer.id as string;
  ua = supertest.agent(app);
  const login = await ua.post('/app/login').type('form').send({ email: user.email, password: PASSWORD });
  expect(login.status, JSON.stringify(login.body)).toBe(302);
});

describe('fångsttexterna följer konstanten i alla fem ytor (negativ kontroll)', () => {
  it('M0 den utbytta konstanten är den som laddats', () => {
    expect(CAPTURE_PATHS_IN_OPERATION).toEqual(UTOKAD);
  });

  it('M1 åtagandevyn säger AI-samtalet och inte dagens mening', async () => {
    const sida = await las(`/app/c/${tomt}/commitments`);
    expect(sida).toContain(UTOKADE.commitmentsOpenEmpty);
    expect(sida).not.toContain(I_DRIFT.commitmentsOpenEmpty);
  });

  it('M2 hinten i Lova något säger AI-samtalet och inte dagens mening', async () => {
    const sida = await las(`/app/c/${fullt}/relations/${relationId}`);
    expect(sida).toContain(UTOKADE.promiseFormHint);
    expect(sida).not.toContain(I_DRIFT.promiseFormHint);
  });

  it('M3 kundkortets tomma Åtaganden säger AI-samtalet och inte dagens mening', async () => {
    const sida = await las(`/app/c/${fullt}/customers/${kundId}`);
    expect(sida).toContain(UTOKADE.customerCardEmpty);
    expect(sida).not.toContain(I_DRIFT.customerCardEmpty);
  });

  it('M4 Idag säger möten och inte dagens mening', async () => {
    const sida = await las(`/app/c/${tomt}/idag`);
    expect(sida).toContain(UTOKADE.todayQuiet);
    expect(sida).not.toContain(I_DRIFT.todayQuiet);
  });

  it('M5 Relationers ingress och tomläge säger möten och inte dagens meningar', async () => {
    const sida = await las(`/app/c/${tomt}/relations`);
    expect(sida).toContain(UTOKADE.relationsLede);
    expect(sida).toContain(UTOKADE.relationsEmpty);
    expect(sida).not.toContain(I_DRIFT.relationsLede);
    expect(sida).not.toContain(I_DRIFT.relationsEmpty);
  });
});
