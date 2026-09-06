// Uppdragsytan S0.1, våg 2: bakvägarna till baselinen och till avslutet.
//
// FR-4 säger att en ändrad baseline ska passera en människa. `andra_baseline`
// var köad från dag ett — men taket gick att flytta bredvid den kön: en agent
// kunde köra `upsert_contract_part` och `update_contract` rakt igenom, och
// stänga ett helt uppdrag med `set_project_status`. En spärr som har en väg
// runt sig är ingen spärr, och FR-4 var därmed tom.
//
// Provet är vaktprovet för just det (mall: `manniskosparr.test.ts`):
//   KRAV-3  tre registerkontroller — inga `foresla_*`-åtgärder, och båda
//           vägarna till baselinen är `sensitive`.
//   KRAV-4  samma kontrollogik mot en registerKOPIA där `upsert_contract_part`
//           sänkts till `write` MÅSTE fälla. Utan den kontrollen bevisar en
//           grön rad ovan bara att någon skrev en assertion, inte att den
//           fångar en framtida sänkning.
//   KRAV-5  beteendet: agentens takändring hamnar i kön (och BARA i kön),
//           agentens uppdragsavslut avvisas helt.
//   KRAV-6  godkännandevägen: människans anrop köas också, och först
//           godkännandet skriver raden.
//
// Kontrollen körs mot en kopia i minnet i stället för genom en modulmock:
// mallens `vi.mock` gäller HELA filen, och beteendeproven nedan måste köra mot
// det RIKTIGA registret. En sänkt kopia av `ACTIONS` är samma prövning utan att
// den smittar av sig på dem.
import { beforeAll, describe, expect, it } from 'vitest';
import { api, createCompany, registerUser, withAdmin, type TestUser } from './helpers.js';
import { ACTIONS, type ActionDef, type Sensitivity } from '../src/actions/registry.js';

// ---------------------------------------------------------------------------
// KRAV-3 + KRAV-4: registret
// ---------------------------------------------------------------------------

/** Båda vägarna in till ett avtalstak, plus modulens egen baselineåtgärd. */
const MASTE_VARA_KANSLIGA = ['andra_baseline', 'upsert_contract_part', 'update_contract'] as const;

type Kontroll = 'forslagsatgard' | 'andra_baseline' | 'skrivvag';
interface Brist { kontroll: Kontroll; text: string }

/** Hela kontrollogiken på ett ställe — KRAV-4 kör exakt denna mot en kopia. */
function brister(atgarder: readonly ActionDef<never>[]): Brist[] {
  const funna: Brist[] = [];
  for (const a of atgarder) {
    if (a.name.startsWith('foresla_')) {
      funna.push({ kontroll: 'forslagsatgard', text: `förslagsåtgärd i registret: ${a.name}` });
    }
  }
  for (const namn of MASTE_VARA_KANSLIGA) {
    const kontroll: Kontroll = namn === 'andra_baseline' ? 'andra_baseline' : 'skrivvag';
    const a = atgarder.find((x) => x.name === namn);
    if (!a) {
      funna.push({ kontroll, text: `åtgärden saknas i registret: ${namn}` });
    } else if (a.sensitivity !== 'sensitive') {
      funna.push({ kontroll, text: `${namn} är '${a.sensitivity}', inte 'sensitive'` });
    }
  }
  return funna;
}

const texter = (kontroll: Kontroll): string[] =>
  brister(ACTIONS).filter((b) => b.kontroll === kontroll).map((b) => b.text);

describe('vaktprovet: ingen bakväg förbi godkännandet (register)', () => {
  it('ingen `foresla_*`-åtgärd finns i registret', () => {
    // Modulen föreslår ingenting genom en egen åtgärdsfamilj: ett förslag ÄR
    // den känsliga åtgärden, köad. En `foresla_*` bredvid vore en andra
    // uppsättning regler för samma skrivning.
    expect(texter('forslagsatgard')).toEqual([]);
  });

  it('`andra_baseline` är sensitive', () => {
    expect(texter('andra_baseline')).toEqual([]);
  });

  it('`upsert_contract_part` och `update_contract` är sensitive', () => {
    expect(texter('skrivvag')).toEqual([]);
  });

  it('KRAV-4: samma kontroll mot ett sänkt register FÄLLER', () => {
    const sankt = ACTIONS.map((a) => (
      a.name === 'upsert_contract_part' ? { ...a, sensitivity: 'write' as Sensitivity } : a
    ));
    const fynd = brister(sankt);
    expect(fynd.map((b) => b.kontroll)).toContain('skrivvag');
    expect(fynd.map((b) => b.text)).toContain("upsert_contract_part är 'write', inte 'sensitive'");
    // Och det RIKTIGA registret är rent — annars mäter raderna ovan ingenting.
    expect(brister(ACTIONS)).toEqual([]);
  });

  it('avgränsningen: `assign_contract_part` är oförändrat write', () => {
    // Klassificeringen kopplar en tidpost till en avtalsdel. Den flyttar
    // varken tak, belopp eller minuter — att köa den hade lagt tidvägens
    // vardag i Att göra utan att skydda något.
    const a = ACTIONS.find((x) => x.name === 'assign_contract_part');
    expect(a?.sensitivity).toBe('write');
  });
});

// ---------------------------------------------------------------------------
// KRAV-5 + KRAV-6: beteendet genom hela stacken
// ---------------------------------------------------------------------------

let user: TestUser;
let companyId: string;
let agentToken: string;
let projektId: string;
let avtalId: string;

const human = () => ({ Authorization: `Bearer ${user.token}` });
const agent = () => ({ Authorization: `Bearer ${agentToken}` });
const co = () => `/api/companies/${companyId}`;

type Svar = { status: number; body: Record<string, unknown> };

async function act(namn: string, kropp: Record<string, unknown>, headers = human()): Promise<Svar> {
  const res = await api.post(`${co()}/actions/${namn}`).set(headers).send(kropp);
  return res as unknown as Svar;
}

async function ok(namn: string, kropp: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await act(namn, kropp);
  expect(res.status, `${namn}: ${JSON.stringify(res.body)}`).toBe(200);
  return res.body.result as Record<string, unknown>;
}

/** Auditloggen som en jämförbar lista — samma grepp som `manniskosparr.test.ts`. */
async function auditrader(): Promise<string[]> {
  const res = await api.get(`${co()}/audit?limit=200`).set(human());
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return (res.body.entries as { action: string; entity_id: string | null }[])
    .map((e) => `${e.action}:${e.entity_id ?? ''}`);
}

/** Köposterna, lästa direkt ur `action_approvals` — förbi hela läsvägen. */
async function koposter(): Promise<{ action: string; status: string; input: Record<string, unknown> }[]> {
  return withAdmin(async (c) => (await c.query<{ action: string; status: string; input: Record<string, unknown> }>(
    'SELECT action, status, input FROM action_approvals WHERE company_id = $1 ORDER BY created_at',
    [companyId],
  )).rows);
}

/** Avtalsdelarnas koder i tabellen — "ingenting skrevs" mäts här. */
async function delkoder(): Promise<string[]> {
  return withAdmin(async (c) => (await c.query<{ code: string }>(
    'SELECT code FROM contract_parts WHERE contract_id = $1 ORDER BY code', [avtalId],
  )).rows.map((r) => r.code));
}

async function projektstatus(): Promise<string> {
  return withAdmin(async (c) => (await c.query<{ status: string }>(
    'SELECT status FROM projects WHERE id = $1', [projektId],
  )).rows[0]!.status);
}

beforeAll(async () => {
  user = await registerUser('bakvag');
  companyId = await createCompany(user.token, 'Locollabs AB');
  const kund = await api.post(`${co()}/customers`).set(human()).send({ name: 'ILT Education AB' });
  expect(kund.status, JSON.stringify(kund.body)).toBe(201);
  projektId = (await ok('create_project', {
    name: 'ILT — Commercial Cockpit', customer_id: kund.body.customer.id, hourly_rate_ore: 110_000,
  })).id as string;
  avtalId = (await ok('create_contract', {
    project_id: projektId, name: 'ILT ramavtal 2026', signed_date: '2026-01-01',
  })).id as string;
  const tok = await api.post(`${co()}/agent-tokens`).set(human()).send({ name: 'Cowork' });
  expect(tok.status, JSON.stringify(tok.body)).toBe(201);
  agentToken = tok.body.token;
});

describe('KRAV-5: agentens väg till baselinen går genom kön — eller ingenstans', () => {
  it('upsert_contract_part som agent köas, auditloggas och skriver INGEN rad', async () => {
    const foreKo = await koposter();

    const res = await act('upsert_contract_part', {
      contract_id: avtalId, code: 'AGENT', name: 'Fas som agenten föreslog',
      cap_hours: 8, valid_from: '2026-01-01',
    }, agent());
    expect(res.status, JSON.stringify(res.body)).toBe(202);
    expect(res.body.status).toBe('pending_approval');
    expect(res.body.action).toBe('upsert_contract_part');

    // Kö + audit i samma transaktion är RÄTT här — det är skrivningen som ska
    // vänta, inte spåret av att någon bad om den.
    const ko = await koposter();
    expect(ko).toHaveLength(foreKo.length + 1);
    const post = ko[ko.length - 1]!;
    expect(post.action).toBe('upsert_contract_part');
    expect(post.status).toBe('pending');
    expect(post.input.code).toBe('AGENT');
    const koId = (res.body.approval as { id: string }).id;
    expect(await auditrader()).toContain(`action.approval_requested:${koId}`);

    // Och taket finns inte: förslaget är ett påstående, inte en avtalsdel.
    expect(await delkoder()).not.toContain('AGENT');
  });

  it('set_project_status som agent avvisas helt — ingen köpost, ingen auditrad', async () => {
    const foreKo = await koposter();
    const foreAudit = await auditrader();

    const res = await act('set_project_status', { project_id: projektId, status: 'closed' }, agent());
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(res.body.error).toBe('human_required');

    // `kravManniska` avvisar FÖRE varje transaktion: till skillnad från en
    // känslig åtgärd blir det varken ett förslag att godkänna eller ett spår.
    expect(await koposter()).toHaveLength(foreKo.length);
    expect(await auditrader()).toEqual(foreAudit);
    expect(await projektstatus()).toBe('active');
  });

  it('samma avslut som människa går igenom', async () => {
    // Ett EGET uppdrag: ett avslut stänger all skrivning mot uppdraget (0068),
    // och KRAV-6 nedan skriver mot avtalet på det andra.
    const eget = (await ok('create_project', { name: 'Uppdrag som ska avslutas' })).id as string;
    const res = await act('set_project_status', { project_id: eget, status: 'closed' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(await withAdmin(async (c) => (await c.query<{ status: string }>(
      'SELECT status FROM projects WHERE id = $1', [eget],
    )).rows[0]!.status)).toBe('closed');
    // Uppdraget som agenten INTE fick stänga står kvar öppet.
    expect(await projektstatus()).toBe('active');
  });
});

describe('KRAV-6: godkännandet är det som skriver', () => {
  it('människans takändring köas och skrivs först när den godkänts', async () => {
    const begaran = await act('upsert_contract_part', {
      contract_id: avtalId, code: '2A', name: 'Fas 2A — Commercial Cockpit',
      cap_hours: 32, valid_from: '2026-01-01',
    });
    expect(begaran.status, JSON.stringify(begaran.body)).toBe(202);
    expect(begaran.body.status).toBe('pending_approval');
    // Ingen rad ännu — köad är inte skriven, inte ens för David.
    expect(await delkoder()).not.toContain('2A');

    const id = (begaran.body.approval as { id: string }).id;
    const godkant = await api.post(`${co()}/approvals/${id}/approve`).set(human()).send({});
    expect(godkant.status, JSON.stringify(godkant.body)).toBe(200);

    expect(await delkoder()).toContain('2A');
    const avtal = await ok('get_contract_usage', { contract_id: avtalId });
    const del = (avtal.parts as { code: string; cap_hours: number | null }[]).find((d) => d.code === '2A');
    expect(del, JSON.stringify(avtal.parts)).toBeTruthy();
    expect(del!.cap_hours).toBe(32);
  });
});
