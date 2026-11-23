// Story 5.7, FR-24, kriterium 5: den negativa kontrollen. Spärren i
// `executeAction` är det enda som hindrar läsnyckeln från att köra en skrivande
// åtgärd; tas den bort ska det synas. Kontrollen byter `assertNotReadOnly`, så
// som `executeAction` ser den, mot en funktion som inte gör något, och visar
// genom hela stacken (REST, `executeAction`, Postgres) att `log_contact` då
// lyckas med läsnyckeln, medan den andra försvarslinjen (`rejectReadOnlyWrites`,
// som anropar modulens egen funktion) står kvar. `vi.mock` gäller hela filen;
// därför är den här kontrollen en egen fil. Facit är literaler.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { config } from '../src/config.js';
import { signToken } from '../src/lib/jwt.js';
import { assertNotReadOnly } from '../src/http/middleware/authenticate.js';
import { api, createCompany, registerUser, withAdmin, type TestUser } from './helpers.js';

// Allt annat i authenticate-modulen (authenticate, rejectReadOnlyWrites, isReadOnly) är det verkliga.
vi.mock('../src/http/middleware/authenticate.js', async (importActual) => {
  const actual = await importActual<typeof import('../src/http/middleware/authenticate.js')>();
  return { ...actual, assertNotReadOnly: () => {} };
});

let user: TestUser;
let bolag: string;
let relation: string;
let lasnyckel: string;

/** En åtgärd genom REST; statusen asserteras med kroppen i meddelandet. */
async function atgard(bolagId: string, token: string, namn: string, indata: Record<string, unknown>, status = 200) {
  const r = await api.post(`/api/companies/${bolagId}/actions/${namn}`)
    .set('Authorization', `Bearer ${token}`).send(indata);
  expect(r.status, JSON.stringify(r.body)).toBe(status);
  return r.body;
}

beforeAll(async () => {
  // Rad 1: en användare och ett bolag.
  user = await registerUser('lasnyckelmock');
  bolag = await createCompany(user.token, 'Läsnyckelns kontroll AB');
  // Rad 2: en relation, skapad av människan.
  relation = (await atgard(bolag, user.token, 'upsert_crm_organization', { name: 'Kontrollens kund AB' })).result.id as string;
  // Rad 5: läsnyckeln, signerad med husets signerare.
  lasnyckel = signToken(user.userId, { actor: 'agent', company_id: bolag, scope: 'read' }, config.AI_AGENT_TOKEN_TTL_SECONDS);
});

describe('den negativa kontrollen: spärren i executeAction borttagen', () => {
  it('N0: den utbytta funktionen är laddad', () => {
    expect(() => assertNotReadOnly(true)).not.toThrow();
  });

  it('N1: log_contact lyckas med läsnyckeln och kontaktpunkten finns', async () => {
    await atgard(bolag, lasnyckel, 'log_contact', { organization_id: relation, summary: 'Spärren borta N1' });
    const rader = await withAdmin((c) => c.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM crm.interactions WHERE company_id = $1 AND summary = $2', [bolag, 'Spärren borta N1']));
    expect(Number(rader.rows[0]?.n)).toBe(1);
  });

  it('N2: den andra försvarslinjen fäller fortfarande PATCH av bolaget', async () => {
    const r = await api.patch(`/api/companies/${bolag}`)
      .set('Authorization', `Bearer ${lasnyckel}`).send({ name: 'Omdöpt N2' });
    expect(r.status, JSON.stringify(r.body)).toBe(403);
    expect(r.body).toEqual({ error: 'read_only_token' });
    const namn = await withAdmin((c) => c.query<{ name: string }>('SELECT name FROM companies WHERE id = $1', [bolag]));
    expect(namn.rows[0]?.name).toBe('Läsnyckelns kontroll AB');
  });
});
