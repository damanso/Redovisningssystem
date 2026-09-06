// S2.1: `kravManniska` på ActionDef. Spärren sitter i executeAction — inte i
// transportlagret — så den gäller alla tre ingångarna. Provet går därför via den
// ingång som saknar egen spärr: REST-rutten POST /actions/:action med
// agent-token (samma väg MCP-servern tar).
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { api, createCompany, registerUser, type TestUser } from './helpers.js';
import type { ActionDef } from '../src/actions/registry.js';

const krok = vi.hoisted(() => ({ atgarder: new Map<string, ActionDef<never>>() }));

// Registret har ingen injektionspunkt för teståtgärder, och ingen
// produktionsåtgärd sätter fältet (set_project_status får det i S0.1). De två
// teståtgärderna finns alltså BARA här. Basen är `create_customer` (write), så
// "ingenting skrevs" går att mäta som en kundrad som inte finns.
vi.mock('../src/actions/registry.js', async (importActual) => {
  const actual = await importActual<typeof import('../src/actions/registry.js')>();
  const bas = actual.getAction('create_customer')!;
  krok.atgarder.set('test_kraver_manniska', {
    ...bas, name: 'test_kraver_manniska', title: 'Teståtgärd med kravManniska', kravManniska: true,
  });
  krok.atgarder.set('test_utan_krav', {
    ...bas, name: 'test_utan_krav', title: 'Teståtgärd utan kravManniska',
  });
  return {
    ...actual,
    getAction: (name: string) => krok.atgarder.get(name) ?? actual.getAction(name),
  };
});

let user: TestUser;
let companyId: string;
let agentToken: string;
let kontrollfalletKordes = false;
const human = () => ({ Authorization: `Bearer ${user.token}` });
const agent = () => ({ Authorization: `Bearer ${agentToken}` });
const co = () => `/api/companies/${companyId}`;

async function kundnamn(): Promise<string[]> {
  const res = await api.post(`${co()}/actions/list_customers`).set(human()).send({});
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return (res.body.result as { name: string }[]).map((k) => k.name);
}

async function auditrader(): Promise<string[]> {
  const res = await api.get(`${co()}/audit`).set(human());
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return (res.body.entries as { action: string; entity_id: string | null }[])
    .map((e) => `${e.action}:${e.entity_id ?? ''}`);
}

beforeAll(async () => {
  user = await registerUser('manniskosparr');
  companyId = await createCompany(user.token, 'Människospärr AB');
  const tok = await api.post(`${co()}/agent-tokens`).set(human()).send({ name: 'Cowork' });
  expect(tok.status, JSON.stringify(tok.body)).toBe(201);
  agentToken = tok.body.token;
});

describe('kravManniska: en åtgärd som bara en människa får köra', () => {
  it('negativ: agent avvisas med human_required och ingenting skrivs', async () => {
    const fore = await auditrader();

    const res = await api.post(`${co()}/actions/test_kraver_manniska`).set(agent()).send({ name: 'Agentkund AB' });
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(res.body.error).toBe('human_required');

    // Ingen auditrad — avvisningen sker före withTenantTransaction. (Kontrollen
    // görs FÖRST: varje icke-känslig action, även en läsning, auditloggas.)
    expect(await auditrader()).toEqual(fore);

    // Ingen domänskrivning och ingen godkännandepost.
    expect(await kundnamn()).not.toContain('Agentkund AB');
    const kon = await api.get(`${co()}/approvals`).set(human());
    expect(kon.status).toBe(200);
    expect(kon.body.approvals).toHaveLength(0);
  });

  it('positiv: samma åtgärd som människa körs', async () => {
    const res = await api.post(`${co()}/actions/test_kraver_manniska`).set(human()).send({ name: 'Människokund AB' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(await kundnamn()).toContain('Människokund AB');
    expect(await auditrader()).toContain('action.executed:test_kraver_manniska');
  });

  it('kontroll: en åtgärd UTAN fältet är opåverkad av actor', async () => {
    const somAgent = await api.post(`${co()}/actions/test_utan_krav`).set(agent()).send({ name: 'Utan krav agent AB' });
    expect(somAgent.status, JSON.stringify(somAgent.body)).toBe(200);
    const somManniska = await api.post(`${co()}/actions/test_utan_krav`).set(human()).send({ name: 'Utan krav människa AB' });
    expect(somManniska.status, JSON.stringify(somManniska.body)).toBe(200);

    const namn = await kundnamn();
    expect(namn).toContain('Utan krav agent AB');
    expect(namn).toContain('Utan krav människa AB');
    kontrollfalletKordes = true;
  });

  // Utan den här raden skulle ett bortfallet kontrollfall se ut som en grön
  // svit: spärren kan vara för bred utan att något prov säger till.
  it('kontrollfallet måste ha körts (annars räknas provet som KUNDE_INTE)', () => {
    expect(kontrollfalletKordes).toBe(true);
  });
});
