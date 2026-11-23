// Story 5.9, FR-31, kriterium 3: en yta som skriver «möten» för hand säger det
// också när kalendern inte är i drift, och då läses en tom lista som avbetad
// fast mötena aldrig lästs. Den negativa kontrollen byter
// `CAPTURE_PATHS_IN_OPERATION` mot konstanten utan kalendern och läser Idag och
// Relationer genom hela stacken (inloggning, pageFor, tenanttransaktionen,
// Postgres): ytorna ska säga de gamla meningarna och inte de nya, så att de
// följer konstanten och inte har någon egen mening om möten. `vi.mock` gäller
// hela filen; därför är kontrollen en egen fil. Facit är literaler ur Dev Notes.
import supertest from 'supertest';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { CapturePaths } from '../src/lib/crmRules.js';
import { CAPTURE_PATHS_IN_OPERATION } from '../src/services/crmDerivations.js';
import { app, createCompany, registerUser, type TestUser } from './helpers.js';

// `vi.mock` lyfts före importerna, så värdet som fabriken använder skapas här.
const { UTAN_KALENDERN } = vi.hoisted(() => {
  const UTAN_KALENDERN: CapturePaths = {
    contacts: ['mail', 'issues'],
    commitments: ['issues_waiting_external', 'promise_form'],
  };
  return { UTAN_KALENDERN };
});

// Allt annat i crmDerivations (todayView, relationState, contactSuggestions) är det verkliga.
vi.mock('../src/services/crmDerivations.js', async (importActual) => {
  const actual = await importActual<typeof import('../src/services/crmDerivations.js')>();
  return { ...actual, CAPTURE_PATHS_IN_OPERATION: UTAN_KALENDERN };
});

const PASSWORD = 'mycket-hemligt-losen-123';
/** Idags mening med kalendern i drift (5.9), som inte får stå när konstanten saknar den. */
const IDAG_TEXT = 'Kommer något in via mail, möten eller ärenden dyker det upp av sig självt.';

/** Texten som den syns: varje tagg blir ett blanksteg, så en mening över `<div class="big">` läses hel. */
function synlig(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
}

let user: TestUser;
/** Bolaget får aldrig en relation: Idag är avbetad och Relationer visar sitt tomläge bara då. */
let tomt: string;
let ua: ReturnType<typeof supertest.agent>;

async function las(sokvag: string): Promise<string> {
  const r = await ua.get(sokvag);
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return synlig(r.text);
}

beforeAll(async () => {
  user = await registerUser('kalendermock');
  tomt = await createCompany(user.token, 'Kalendermock AB');
  ua = supertest.agent(app);
  const login = await ua.post('/app/login').type('form').send({ email: user.email, password: PASSWORD });
  expect(login.status, JSON.stringify(login.body)).toBe(302);
});

describe('Idag och Relationer följer konstanten utan kalendern (negativ kontroll, 5.9)', () => {
  it('N0 den utbytta konstanten är den som laddats', () => {
    expect(CAPTURE_PATHS_IN_OPERATION).toEqual(UTAN_KALENDERN);
  });

  it('N1 Idag avbetad säger mail och ärenden och inte möten', async () => {
    const sida = await las(`/app/c/${tomt}/idag`);
    expect(sida).toContain('Avbetat för i dag');
    expect(sida).toContain('Kommer något in via mail eller ärenden dyker det upp av sig självt.');
    expect(sida).not.toContain(IDAG_TEXT);
  });

  it('N2 Relationers ingress och tomläge säger mail och ärenden och inte möten', async () => {
    const sida = await las(`/app/c/${tomt}/relations`);
    expect(sida).toContain('härlett ur mail, ärenden och bokförda fakturor');
    expect(sida).toContain('De flesta dyker upp av sig själva när mail och ärenden kommer in.');
    expect(sida).not.toContain('härlett ur mail, möten');
    expect(sida).not.toContain('när mail, möten och ärenden');
  });
});
