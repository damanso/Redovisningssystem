// FR-24, beslut #156, NFR-6 (story 5.7): Hermes kö ska läsa Davids löften med
// en nyckel som bara kan läsa. En nyckel som kön läser med och som kan skriva är
// en ny identitet med skrivrätt som ingen beslutat om. Provet låser att läs-scopet
// bara har en form (`scope: 'read'` på ett agent-token), att `executeAction`
// avvisar varje skrivande eller känslig åtgärd med 403 `read_only_token` innan
// något skrivs, att de direkta REST-rutterna har en andra försvarslinje, att
// nyckeln är bolagsscopad och att bara en inloggad människa kan minta den under
// *Anslut AI*. Provet går genom autentiseringen, REST, `executeAction`, den
// inloggade vyn och Postgres. Facit är literaler, aldrig hämtade ur koden som
// prövas. Den negativa kontrollen ligger i crm-read-scope-mock.test.ts.
import { randomUUID } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import jwt from 'jsonwebtoken';
import supertest from 'supertest';
import type { Request } from 'express';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { config } from '../src/config.js';
import { signToken } from '../src/lib/jwt.js';
import { UnauthenticatedError } from '../src/lib/errors.js';
import { authenticate, isActionCall, readOnlyFromScope } from '../src/http/middleware/authenticate.js';
import { api, app, createCompany, registerUser, withAdmin, type TestUser } from './helpers.js';

let user: TestUser;
let bolag: string;
let bolag2: string;
let relation: string;
let relation2: string;
let agentnyckel: string;
let lasnyckel: string;
let ua: ReturnType<typeof supertest.agent>;

const PASSWORD = 'mycket-hemligt-losen-123';

/** En åtgärd genom REST; statusen asserteras med kroppen i meddelandet. */
async function atgard(bolagId: string, token: string, namn: string, indata: Record<string, unknown>, status = 200) {
  const r = await api.post(`/api/companies/${bolagId}/actions/${namn}`)
    .set('Authorization', `Bearer ${token}`).send(indata);
  expect(r.status, JSON.stringify(r.body)).toBe(status);
  return r.body;
}

type Metod = 'get' | 'head' | 'post' | 'patch' | 'put' | 'delete';

/** Ett anrop med Bearer-token, utan statusassertion; svaret returneras. */
async function anropa(metod: Metod, sokvag: string, token: string, kropp?: Record<string, unknown>) {
  const r = api[metod](sokvag).set('Authorization', `Bearer ${token}`);
  return kropp === undefined ? r : r.send(kropp);
}

/** Ett token med godtyckliga claims, signerat med husets signerare (de avvisade formerna). */
function signerad(claims: Record<string, unknown>): string {
  return signToken(user.userId, claims, 3600);
}

/** En falsk förfrågan till `authenticate` (A2). */
function forfragan(token: string): Request {
  return { headers: { authorization: `Bearer ${token}` } } as unknown as Request;
}

/** Bolagets tabeller som en skrivning med läsnyckeln skulle röra; namnen är literaler. */
const TABELLER = [
  'audit_log', 'action_approvals', 'crm.interactions', 'crm.commitments',
  'crm.organizations', 'crm.retention_settings', 'customers', 'fiscal_years',
] as const;

/**
 * Bolagets tillstånd, läst som ägare. Räkningen i `audit_log` är den starkaste
 * delen: varje åtgärd som `executeAction` kör eller köar skriver en auditrad,
 * och PATCH av bolaget skriver `company.updated`, så ett oförändrat antal visar
 * att ingen sådan väg kördes. Gallringsperioden läses för sig, eftersom
 * `set_crm_retention` på en befintlig rad uppdaterar i stället för att lägga till.
 */
async function tillstandet(bolagId: string) {
  return withAdmin(async (c) => {
    const antal: Record<string, number> = {};
    for (const tabell of TABELLER) {
      const r = await c.query<{ n: string }>(`SELECT count(*)::text AS n FROM ${tabell} WHERE company_id = $1`, [bolagId]);
      antal[tabell] = Number(r.rows[0]?.n);
    }
    const namn = await c.query<{ name: string }>('SELECT name FROM companies WHERE id = $1', [bolagId]);
    const gallring = await c.query<{ retention_months: number | null }>(
      'SELECT retention_months FROM crm.retention_settings WHERE company_id = $1', [bolagId]);
    const medlemskap = await c.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM company_members WHERE user_id = $1', [user.userId]);
    return {
      antal,
      namn: namn.rows[0]?.name ?? null,
      retention_months: gallring.rows[0]?.retention_months ?? null,
      medlemskap: Number(medlemskap.rows[0]?.n),
    };
  });
}

/** `details` för bolagets auditrader med den åtgärden och det id:t, i id-ordning, lästa som ägare. */
async function auditen(bolagId: string, action: string, entityId: string): Promise<Record<string, unknown>[]> {
  return withAdmin(async (c) => {
    const r = await c.query<{ details: Record<string, unknown> }>(
      'SELECT details FROM audit_log WHERE company_id = $1 AND action = $2 AND entity_id = $3 ORDER BY id',
      [bolagId, action, entityId],
    );
    return r.rows.map((rad) => rad.details);
  });
}

/** JWT:n på sidan, med samma uttryck som view.test.ts (`eyJ…` i tre delar), eller `undefined`. */
function nyckelnI(html: string): string | undefined {
  return html.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/)?.[0];
}

/** Antalet rader `agent_token.minted` i bolagets auditlogg. */
async function mintningar(bolagId: string): Promise<number> {
  return withAdmin(async (c) => {
    const r = await c.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM audit_log WHERE company_id = $1 AND action = 'agent_token.minted'", [bolagId]);
    return Number(r.rows[0]?.n);
  });
}

beforeAll(async () => {
  // Rad 1: samma ägare i båda bolagen (B1, B2).
  user = await registerUser('lasnyckel');
  bolag = await createCompany(user.token, 'Läsnyckeln AB');
  bolag2 = await createCompany(user.token, 'Läsnyckelns andra bolag AB');
  // Rad 2: två relationer, skapade av människan.
  relation = (await atgard(bolag, user.token, 'upsert_crm_organization', { name: 'Läsnyckelns kund AB' })).result.id as string;
  relation2 = (await atgard(bolag, user.token, 'upsert_crm_organization', { name: 'Läsnyckelns dubblett AB' })).result.id as string;
  // Rad 3: löftet L1.
  await atgard(bolag, user.token, 'record_crm_commitment', {
    organization_id: relation, direction: 'we_owe', body: 'Skicka offerten L1.',
    occurred_at: '2026-11-20T09:00:00Z', source_system: 'manual',
  });
  // Rad 4: ett vanligt AI-token genom REST-vägen.
  const mint = await api.post(`/api/companies/${bolag}/agent-tokens`)
    .set('Authorization', `Bearer ${user.token}`).send({ name: 'Vanligt AI-token' });
  expect(mint.status, JSON.stringify(mint.body)).toBe(201);
  agentnyckel = mint.body.token as string;
  // Rad 5: läsnyckeln, signerad med husets signerare så att uppgifterna 1–3 kan
  // provas innan mintningen finns; T2 visar att den mintade nyckeln bär samma claims.
  lasnyckel = signToken(user.userId, { actor: 'agent', company_id: bolag, scope: 'read' }, config.AI_AGENT_TOKEN_TTL_SECONDS);
  // Rad 7: den inloggade vyn.
  ua = supertest.agent(app);
  const login = await ua.post('/app/login').type('form').send({ email: user.email, password: PASSWORD });
  expect([302, 303], JSON.stringify(login.body)).toContain(login.status);
});

describe('authenticate', () => {
  it('A1: readOnlyFromScope godtar exakt tre par och avvisar allt annat', () => {
    expect(readOnlyFromScope('human', undefined)).toBe(false);
    expect(readOnlyFromScope('agent', undefined)).toBe(false);
    expect(readOnlyFromScope('agent', 'read')).toBe(true);
    expect(readOnlyFromScope('human', 'read')).toBeNull();
    expect(readOnlyFromScope('agent', 'write')).toBeNull();
    expect(readOnlyFromScope('agent', 'READ')).toBeNull();
    expect(readOnlyFromScope('agent', '')).toBeNull();
    expect(readOnlyFromScope('agent', null)).toBeNull();
    expect(readOnlyFromScope('agent', ['read'])).toBeNull();
    expect(readOnlyFromScope('agent', true)).toBeNull();
  });

  it('A2: authenticate sätter readOnly för läsnyckeln, false för dagens token och avvisar ett okänt scope', () => {
    const las = forfragan(lasnyckel);
    const nextLas = vi.fn();
    authenticate(las, {} as never, nextLas);
    expect(las.auth).toEqual({ userId: user.userId, actor: 'agent', scopedCompanyId: bolag, readOnly: true });
    expect(nextLas).toHaveBeenCalledTimes(1);

    const ai = forfragan(agentnyckel);
    const nextAi = vi.fn();
    authenticate(ai, {} as never, nextAi);
    expect(ai.auth).toEqual({ userId: user.userId, actor: 'agent', scopedCompanyId: bolag, readOnly: false });
    expect(nextAi).toHaveBeenCalledTimes(1);

    const manniska = forfragan(user.token);
    const nextManniska = vi.fn();
    authenticate(manniska, {} as never, nextManniska);
    expect(manniska.auth).toEqual({ userId: user.userId, actor: 'human', scopedCompanyId: undefined, readOnly: false });
    expect(nextManniska).toHaveBeenCalledTimes(1);

    const okand = forfragan(signerad({ actor: 'agent', company_id: bolag, scope: 'write' }));
    const nextOkand = vi.fn();
    expect(() => authenticate(okand, {} as never, nextOkand)).toThrow(UnauthenticatedError);
    expect(nextOkand).not.toHaveBeenCalled();
  });

  it('A3: genom hela stacken läser läsnyckeln och dagens token, och ett okänt scope ger 401', async () => {
    const las = await anropa('get', `/api/companies/${bolag}`, lasnyckel);
    expect(las.status, JSON.stringify(las.body)).toBe(200);
    for (const scope of ['write', 'READ', '']) {
      const r = await anropa('get', `/api/companies/${bolag}`, signerad({ actor: 'agent', company_id: bolag, scope }));
      expect(r.status, `${scope}: ${JSON.stringify(r.body)}`).toBe(401);
      expect(r.body).toEqual({ error: 'unauthenticated' });
    }
    const manniskaMedScope = await anropa('get', `/api/companies/${bolag}`, signerad({ actor: 'human', scope: 'read' }));
    expect(manniskaMedScope.status, JSON.stringify(manniskaMedScope.body)).toBe(401);
    expect(manniskaMedScope.body).toEqual({ error: 'unauthenticated' });
    const ai = await anropa('get', `/api/companies/${bolag}`, agentnyckel);
    expect(ai.status, JSON.stringify(ai.body)).toBe(200);
    const manniska = await anropa('get', `/api/companies/${bolag}`, user.token);
    expect(manniska.status, JSON.stringify(manniska.body)).toBe(200);
  });
});

describe('spärren i executeAction', () => {
  it('S1: de fyra namngivna skrivningarna ger 403 read_only_token och bolaget är orört', async () => {
    const fore = await tillstandet(bolag);
    const skrivningar: [string, Record<string, unknown>][] = [
      ['log_contact', { organization_id: relation, summary: 'Läsnyckelns kontakt S1' }],
      ['set_crm_retention', { retention_months: 12 }],
      ['record_crm_commitment', {
        organization_id: relation, direction: 'we_owe', body: 'Läsnyckelns löfte S1.',
        occurred_at: '2026-11-21T09:00:00Z', source_system: 'manual',
      }],
      ['merge_crm_organizations', { keep_id: relation, merge_id: relation2 }],
    ];
    for (const [namn, indata] of skrivningar) {
      const svar = await atgard(bolag, lasnyckel, namn, indata, 403);
      expect(svar, namn).toEqual({ error: 'read_only_token' });
    }
    expect(await tillstandet(bolag)).toEqual(fore);
  });

  it('S2: varje skrivande och känslig åtgärd i manifestet ger 403 read_only_token med tom indata', async () => {
    const manifest = await anropa('get', `/api/companies/${bolag}/actions`, lasnyckel);
    expect(manifest.status, JSON.stringify(manifest.body)).toBe(200);
    const skrivande = (manifest.body.actions as { name: string; sensitivity: string }[])
      .filter((a) => a.sensitivity !== 'read')
      .map((a) => a.name);
    expect(skrivande.length).toBeGreaterThanOrEqual(100);
    expect(skrivande).toEqual(expect.arrayContaining(
      ['log_contact', 'set_crm_retention', 'record_crm_commitment', 'merge_crm_organizations']));
    const fore = await tillstandet(bolag);
    const avvikande: { namn: string; status: number }[] = [];
    for (const namn of skrivande) {
      const r = await anropa('post', `/api/companies/${bolag}/actions/${namn}`, lasnyckel, {});
      if (r.status !== 403 || r.body?.error !== 'read_only_token') avvikande.push({ namn, status: r.status });
    }
    expect(avvikande).toEqual([]);
    expect(await tillstandet(bolag)).toEqual(fore);
  });

  it('S3: läsåtgärderna fungerar med läsnyckeln', async () => {
    const loften = await atgard(bolag, lasnyckel, 'list_crm_commitments', { status: 'open' });
    expect((loften.result as { body: string }[]).map((l) => l.body)).toContain('Skicka offerten L1.');
    const gallring = await atgard(bolag, lasnyckel, 'get_crm_retention', {});
    expect(gallring.result.retention_months).toBeNull();
  });

  it('S4: auditraden för en läsning bär scope read med läsnyckeln och inget scope utan den', async () => {
    const medNyckeln = (await auditen(bolag, 'action.executed', 'list_crm_commitments')).at(-1);
    expect(medNyckeln).toEqual({ sensitivity: 'read', actor: 'agent', scope: 'read' });
    await atgard(bolag, agentnyckel, 'list_crm_commitments', {});
    const utan = (await auditen(bolag, 'action.executed', 'list_crm_commitments')).at(-1);
    expect(utan).toEqual({ sensitivity: 'read', actor: 'agent' });
    expect(Object.hasOwn(utan!, 'scope')).toBe(false);
  });

  it('S5: kontrollen — ett vanligt AI-token loggar en kontakt, så 403 beror på scopet', async () => {
    const fore = await tillstandet(bolag);
    await atgard(bolag, agentnyckel, 'log_contact', { organization_id: relation, summary: 'Agentens kontakt S5' });
    const efter = await tillstandet(bolag);
    expect(efter.antal['crm.interactions']).toBe(fore.antal['crm.interactions']! + 1);
  });
});

describe('den andra försvarslinjen', () => {
  it('R1: tio direkta skrivande anrop ger 403 read_only_token och bolaget är orört', async () => {
    const fore = await tillstandet(bolag);
    const anrop: [Metod, string, Record<string, unknown>?][] = [
      ['patch', `/api/companies/${bolag}`, { name: 'Omdöpt R1' }],
      ['post', `/api/companies/${bolag}/customers`, { name: 'Läsnyckelns kund R1' }],
      ['post', `/api/companies/${bolag}/accounting/fiscal-years`, { label: '2027', start_date: '2027-01-01', end_date: '2027-12-31' }],
      ['post', `/api/companies/${bolag}/approvals/${randomUUID()}/approve`, {}],
      ['post', `/api/companies/${bolag}/agent-tokens`, { name: 'R1' }],
      ['post', '/api/companies', { name: 'Nytt bolag R1' }],
      ['put', `/api/companies/${bolag}`, {}],
      ['delete', `/api/companies/${bolag}/customers/${randomUUID()}`],
      ['post', `/api/companies/${bolag}/actions`, {}],
      ['post', `/api/companies/${bolag}/actions/log_contact/extra`, {}],
    ];
    for (const [metod, sokvag, kropp] of anrop) {
      const r = await anropa(metod, sokvag, lasnyckel, kropp);
      expect(r.status, `${metod} ${sokvag}: ${JSON.stringify(r.body)}`).toBe(403);
      expect(r.body, `${metod} ${sokvag}`).toEqual({ error: 'read_only_token' });
    }
    expect(await tillstandet(bolag)).toEqual(fore);
  });

  it('R2: sex läsningar fungerar med läsnyckeln', async () => {
    const anrop: [Metod, string, Record<string, unknown>?][] = [
      ['get', `/api/companies/${bolag}`],
      ['get', `/api/companies/${bolag}/audit`],
      ['head', `/api/companies/${bolag}`],
      ['get', `/api/companies/${bolag}/actions`],
      ['get', `/api/companies/${bolag}/customers`],
      ['post', `/api/companies/${bolag}/actions/list_customers`, {}],
    ];
    for (const [metod, sokvag, kropp] of anrop) {
      const r = await anropa(metod, sokvag, lasnyckel, kropp);
      expect(r.status, `${metod} ${sokvag}: ${JSON.stringify(r.body)}`).toBe(200);
    }
  });

  it('R3: kontrollen — ett vanligt AI-token skapar en kund, så 403 i R1 är den andra linjen', async () => {
    const r = await anropa('post', `/api/companies/${bolag}/customers`, agentnyckel, { name: 'Agentens kund R3' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
  });

  it('R4: isActionCall släpper bara POST till exakt bolaget, actions och ett namn', () => {
    expect(isActionCall('POST', '/b1/actions/log_contact')).toBe(true);
    expect(isActionCall('POST', '/b1/actions/log_contact/')).toBe(true);
    expect(isActionCall('POST', '/b1/actions')).toBe(false);
    expect(isActionCall('POST', '/b1/actions/')).toBe(false);
    expect(isActionCall('POST', '/b1/actions/a/b')).toBe(false);
    expect(isActionCall('POST', '/b1/approvals/x/approve')).toBe(false);
    expect(isActionCall('PATCH', '/b1/actions/log_contact')).toBe(false);
    expect(isActionCall('GET', '/b1/actions/log_contact')).toBe(false);
    expect(isActionCall('POST', '/actions/log_contact')).toBe(false);
  });
});

describe('bolagsgränsen', () => {
  it('B1: läsnyckeln för bolaget når inte ägarens andra bolag', async () => {
    const las = await anropa('get', `/api/companies/${bolag2}`, lasnyckel);
    expect(las.status, JSON.stringify(las.body)).toBe(404);
    expect(las.body).toEqual({ error: 'not_found' });
    const atgarden = await anropa('post', `/api/companies/${bolag2}/actions/list_crm_commitments`, lasnyckel, {});
    expect(atgarden.status, JSON.stringify(atgarden.body)).toBe(404);
    expect(atgarden.body).toEqual({ error: 'not_found' });
  });

  it('B2: en skrivning mot ett annat bolag fälls av den andra linjen utan att avslöja om bolaget finns', async () => {
    const annat = await anropa('post', `/api/companies/${bolag2}/customers`, lasnyckel, { name: 'Fel bolag B2' });
    const pahittat = await anropa('post', `/api/companies/${randomUUID()}/customers`, lasnyckel, { name: 'Fel bolag B2' });
    expect(annat.status, JSON.stringify(annat.body)).toBe(403);
    expect(annat.body).toEqual({ error: 'read_only_token' });
    expect(pahittat.status, JSON.stringify(pahittat.body)).toBe(403);
    expect(pahittat.body).toEqual(annat.body);
    const kunder = await withAdmin((c) =>
      c.query<{ n: string }>('SELECT count(*)::text AS n FROM customers WHERE company_id = $1', [bolag2]));
    expect(Number(kunder.rows[0]?.n)).toBe(0);
  });
});

describe('mintningen under Anslut AI', () => {
  it('T1: formuläret har valet Läsnyckel — kan bara läsa', async () => {
    const r = await ua.get(`/app/c/${bolag}/connect`);
    expect(r.status, r.text).toBe(200);
    expect(r.text).toContain(`action="/app/c/${bolag}/connect/token"`);
    expect(r.text).toContain('<select name="scope">');
    expect(r.text).toContain('<option value="" selected>AI-token — kan föreslå och begära åtgärder</option>');
    expect(r.text).toContain('<option value="read">Läsnyckel — kan bara läsa</option>');
    expect(r.text).toContain('Läsnyckeln är för Hermes kö: den kan bara läsa, och varje försök att skriva avvisas.');
  });

  it('T2: läsnyckeln signeras med scope read och AI-tokenets livslängd, och den kan bara läsa', async () => {
    const r = await ua.post(`/app/c/${bolag}/connect/token`).type('form').send({ name: 'Hermes kö', scope: 'read' });
    expect(r.status, r.text).toBe(200);
    expect(r.text).toContain('Läsnyckel skapad');
    expect(r.text).toContain('redovisning-lasnyckel');
    expect(r.text).not.toContain('mcpServers');
    const nyckel = nyckelnI(r.text);
    expect(nyckel).toBeDefined();
    const payload = jwt.verify(nyckel!, config.JWT_SECRET, { algorithms: ['HS256'] });
    if (typeof payload === 'string') throw new Error('payloaden är en sträng');
    expect(payload.sub).toBe(user.userId);
    expect(payload.actor).toBe('agent');
    expect(payload.company_id).toBe(bolag);
    expect(payload.scope).toBe('read');
    expect(payload.exp! - payload.iat!).toBe(config.AI_AGENT_TOKEN_TTL_SECONDS);
    const skrivning = await atgard(bolag, nyckel!, 'log_contact', { organization_id: relation, summary: 'Mintad nyckel T2' }, 403);
    expect(skrivning).toEqual({ error: 'read_only_token' });
    await atgard(bolag, nyckel!, 'list_crm_commitments', {});
  });

  it('T3: auditraden för mintningen bär scope read', async () => {
    const sista = (await auditen(bolag, 'agent_token.minted', bolag)).at(-1);
    expect(sista).toEqual({ name: 'Hermes kö', via: 'web', scope: 'read' });
  });

  it('T4: ett vanligt AI-token utan scope mintas som i dag, med samma livslängd', async () => {
    const r = await ua.post(`/app/c/${bolag}/connect/token`).type('form').send({ name: 'Claude Desktop' });
    expect(r.status, r.text).toBe(200);
    expect(r.text).toContain('mcpServers');
    const nyckel = nyckelnI(r.text);
    expect(nyckel).toBeDefined();
    const payload = jwt.verify(nyckel!, config.JWT_SECRET, { algorithms: ['HS256'] });
    if (typeof payload === 'string') throw new Error('payloaden är en sträng');
    expect(Object.hasOwn(payload, 'scope')).toBe(false);
    expect(payload.exp! - payload.iat!).toBe(config.AI_AGENT_TOKEN_TTL_SECONDS);
    const sista = (await auditen(bolag, 'agent_token.minted', bolag)).at(-1);
    expect(sista).toEqual({ name: 'Claude Desktop', via: 'web' });
  });

  it('T5: ett okänt val ger 400 och mintar inget', async () => {
    const fore = await mintningar(bolag);
    for (const scope of ['write', 'READ']) {
      const r = await ua.post(`/app/c/${bolag}/connect/token`).type('form').send({ scope });
      expect(r.status, `${scope}: ${r.text}`).toBe(400);
      expect(nyckelnI(r.text), scope).toBeUndefined();
    }
    expect(await mintningar(bolag)).toBe(fore);
  });

  it('T6: bara en människas session mintar — REST tar inget scope, och läsnyckeln öppnar inte vyns POST', async () => {
    const fore = await mintningar(bolag);
    const rest = await api.post(`/api/companies/${bolag}/agent-tokens`)
      .set('Authorization', `Bearer ${user.token}`).send({ name: 'REST', scope: 'read' });
    expect(rest.status, JSON.stringify(rest.body)).toBe(400);
    expect(rest.body.error).toBe('validation_error');
    const kaka = await api.post(`/app/c/${bolag}/connect/token`)
      .set('Cookie', `session=${lasnyckel}`).type('form').send({ scope: 'read' });
    expect([302, 303], kaka.text).toContain(kaka.status);
    expect(kaka.headers.location).toBe('/app/login');
    const bearer = await api.post(`/app/c/${bolag}/connect/token`)
      .set('Authorization', `Bearer ${lasnyckel}`).type('form').send({ scope: 'read' });
    expect([302, 303], bearer.text).toContain(bearer.status);
    expect(bearer.headers.location).toBe('/app/login');
    expect(await mintningar(bolag)).toBe(fore);
  });
});

/** Avsnittet från rubriken till nästa «\n## » eller filens slut. */
function avsnittet(text: string, rubrik: string): string {
  const start = text.indexOf(rubrik);
  expect(start, rubrik).toBeGreaterThanOrEqual(0);
  const slut = text.indexOf('\n## ', start + rubrik.length);
  return text.slice(start, slut === -1 ? undefined : slut);
}

describe('dokumenten', () => {
  it('D1: docs/ARKITEKTUR.md beskriver läs-scopet med beslut #156 i Arkitekturmonster', async () => {
    const doc = await readFile(new URL('../../docs/ARKITEKTUR.md', import.meta.url), 'utf8');
    const avsnitt = avsnittet(doc, '## Arkitekturmonster');
    for (const del of ['#156', 'read_only_token', "scope: 'read'", 'AuthContext.readOnly', 'rejectReadOnlyWrites']) {
      expect(avsnitt, del).toContain(del);
    }
  });

  it('D2: migrationsintervallet når minst 0096, och den migrationen finns', async () => {
    const doc = await readFile(new URL('../../docs/ARKITEKTUR.md', import.meta.url), 'utf8');
    const hogsta = /just nu 0001–(\d{4})\)/.exec(doc)?.[1];
    expect(hogsta, 'migrationsintervallet').toBeDefined();
    expect(Number(hogsta)).toBeGreaterThanOrEqual(96);
    const filer = readdirSync(new URL('../migrations/', import.meta.url));
    expect(filer.some((fil) => fil.startsWith(`${hogsta}_`)), `${hogsta}_`).toBe(true);
  });

  it('D3: docs/MCP_ACTIONS.md beskriver läsnyckeln och read_only_token', async () => {
    const doc = await readFile(new URL('../../docs/MCP_ACTIONS.md', import.meta.url), 'utf8');
    const rubrik = '## Läsnyckeln (crm 5.7)';
    expect(doc.split(rubrik)).toHaveLength(2);
    const avsnitt = avsnittet(doc, rubrik);
    for (const del of [
      'read_only_token', '403', "scope: 'read'", 'Läsnyckel — kan bara läsa', 'GET', 'HEAD',
      'POST /api/companies/:companyId/actions/:action',
    ]) {
      expect(avsnitt, del).toContain(del);
    }
  });
});
