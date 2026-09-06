// Uppdragsytan S4.1, våg 2: bedömningen sätts (PRD FR-14/FR-15/FR-17).
//
// Risken sitter i tre lager, och provet är skrivet mot alla tre — för varje
// lager som saknas är en konvention, inte en spärr:
//
//   (a) **Åtgärdslagret.** `satt_bedomning` bär `kravManniska`, så en agent kan
//       inte sätta bedömningen. Provet går via REST-rutten POST
//       /actions/:action med agent-token — samma väg MCP-servern tar, och den
//       enda ingång som saknar egen människospärr (mall: `manniskosparr.test.ts`).
//   (b) **Rättigheterna.** `uppdrag_bedomning` har SELECT + INSERT för rollen
//       `app` och ingenting annat (0068). En bedömning som går att skriva om i
//       efterhand är ingen bedömning (FR-17), och det ska gälla även för kod
//       som INTE går genom tjänstelagret. Därför prövas UPDATE och DELETE som
//       `app` rakt mot tabellen.
//   (c) **Vyn.** Davids egen väg in skriver raden med `satt_av_manniska = true`
//       och auditraden `action.executed` — samma action-lager som AI:n hade
//       använt om den fick (lärdom 5).
//
// Vattenmelonskyddet (KRAV-5) är resten: alla tre lägena går att lagra, ett
// fjärde fälls två gånger om, en andra bedömning läggs BREDVID den första i
// stället för över den, och grannbolaget varken ser eller skriver våra rader.
import supertest from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { app, api, createCompany, createFiscalYear, registerUser, withAdmin, type TestUser } from './helpers.js';
import { withTenantTransaction } from '../src/db/tx.js';

const PASSWORD = 'mycket-hemligt-losen-123';

let user: TestUser;
let companyId: string;
let agentToken: string;
let projektId: string;
let avtalId: string;
/** Uppdrag UTAN avtal — vyns tomma läge. */
let avtalslostProjekt: string;
let grannen: TestUser;
let grannbolag: string;
let ua: ReturnType<typeof supertest.agent>;

const auth = () => ({ Authorization: `Bearer ${user.token}` });
const agent = () => ({ Authorization: `Bearer ${agentToken}` });
const co = () => `/api/companies/${companyId}`;

type Svar = { status: number; body: Record<string, unknown> };

async function act(namn: string, kropp: Record<string, unknown>, headers = auth()): Promise<Svar> {
  const res = await api.post(`${co()}/actions/${namn}`).set(headers).send(kropp);
  return res as unknown as Svar;
}

async function ok(namn: string, kropp: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await act(namn, kropp);
  expect(res.status, `${namn}: ${JSON.stringify(res.body)}`).toBe(200);
  return res.body.result as Record<string, unknown>;
}

interface Bedomningsrad {
  id: string;
  contract_id: string;
  period_start: string;
  period_slut: string;
  lage: string;
  satt_av_manniska: boolean;
  kommentar: string | null;
  handelse_ref_ids: string[] | null;
  frysta_siffror: unknown;
  created_at: string;
}

/** Raderna som de STÅR i tabellen, förbi hela applikationslagret. */
async function rader(contractId: string): Promise<Bedomningsrad[]> {
  return withAdmin(async (c) => (await c.query<Bedomningsrad>(
    `SELECT id, contract_id, period_start::text, period_slut::text, lage, satt_av_manniska,
            kommentar, handelse_ref_ids, frysta_siffror, created_at::text
       FROM uppdrag_bedomning WHERE contract_id = $1 ORDER BY created_at`,
    [contractId],
  )).rows);
}

async function auditrader(): Promise<string[]> {
  const res = await api.get(`${co()}/audit`).set(auth());
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return (res.body.entries as { action: string; entity_id: string | null }[])
    .map((e) => `${e.action}:${e.entity_id ?? ''}`);
}

async function nyttUppdrag(namn: string): Promise<{ projektId: string; avtalId: string }> {
  const projekt = (await ok('create_project', { name: `Uppdrag ${namn}` })).id as string;
  const avtal = (await ok('create_contract', {
    project_id: projekt, name: namn, signed_date: '2026-01-01',
  })).id as string;
  return { projektId: projekt, avtalId: avtal };
}

async function nyttAvtal(namn: string): Promise<string> {
  return (await nyttUppdrag(namn)).avtalId;
}

beforeAll(async () => {
  user = await registerUser('bedomning');
  companyId = await createCompany(user.token, 'Locollabs AB');
  await createFiscalYear(companyId, auth(), { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });

  projektId = (await ok('create_project', { name: 'NVR' })).id as string;
  avtalId = (await ok('create_contract', {
    project_id: projektId, name: 'NVR-001 leveranskontrakt', signed_date: '2026-09-01',
  })).id as string;
  avtalslostProjekt = (await ok('create_project', { name: 'Uppdrag utan avtal' })).id as string;

  const tok = await api.post(`${co()}/agent-tokens`).set(auth()).send({ name: 'Cowork' });
  expect(tok.status, JSON.stringify(tok.body)).toBe(201);
  agentToken = tok.body.token;

  ua = supertest.agent(app);
  const login = await ua.post('/app/login').type('form').send({ email: user.email, password: PASSWORD });
  expect([302, 303]).toContain(login.status);

  grannen = await registerUser('bedomning-granne');
  grannbolag = await createCompany(grannen.token, 'Grannbolaget AB');
});

// ---------------------------------------------------------------------------
// (a) Lager ett: en agent kan inte sätta bedömningen — FR-15
// ---------------------------------------------------------------------------

describe('(a) kravManniska: agenten avvisas innan något händer', () => {
  it('403 human_required, ingen rad, ingen auditrad, tom godkännandekö', async () => {
    // FÖRST: varje icke-känslig action auditloggas, även en läsning, så
    // jämförelsen måste tas före allt annat i provet.
    const fore = await auditrader();

    const res = await act('satt_bedomning', {
      contract_id: avtalId, period_start: '2026-09-01', period_slut: '2026-09-30',
      lage: 'pa_spar', kommentar: 'Agenten tycker att det går bra.',
    }, agent());
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(res.body.error).toBe('human_required');

    // Avvisningen sker före withTenantTransaction: ingenting skrivs, och
    // avvisningen loggas INTE (Davids nej 6/9, beslut #115).
    expect(await auditrader()).toEqual(fore);
    expect(await rader(avtalId)).toHaveLength(0);

    // Och den hamnar inte heller i kön: `satt_bedomning` är `write`, inte
    // `sensitive` — det finns ingen köpost att godkänna i efterhand.
    const kon = await api.get(`${co()}/approvals`).set(auth());
    expect(kon.status).toBe(200);
    expect(kon.body.approvals).toHaveLength(0);
  });

  it('samma anrop som människa går igenom — spärren är på actor, inte på indatat', async () => {
    const svar = await ok('satt_bedomning', {
      contract_id: avtalId, period_start: '2026-09-01', period_slut: '2026-09-30', lage: 'pa_spar',
    });
    expect(svar.lage).toBe('pa_spar');
    expect(svar.satt_av_manniska).toBe(true);
    expect(await rader(avtalId)).toHaveLength(1);
  });

  it('`satt_av_manniska` går inte att skicka in — schemat är strict', async () => {
    const res = await act('satt_bedomning', {
      contract_id: avtalId, period_start: '2026-10-01', period_slut: '2026-10-31',
      lage: 'pa_spar', satt_av_manniska: false,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect(res.body.error).toBe('validation_error');
    expect(await rader(avtalId)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// (b) Lager två: rättigheten, inte tjänstelagret, gör raden oföränderlig — FR-17
// ---------------------------------------------------------------------------

describe('(b) uppdrag_bedomning är append-only för rollen app', () => {
  it('UPDATE och DELETE fälls med permission denied, och raden står kvar', async () => {
    const contractId = await nyttAvtal('Oföränderlig');
    await ok('satt_bedomning', {
      contract_id: contractId, period_start: '2026-01-01', period_slut: '2026-03-31',
      lage: 'risk', kommentar: 'Leverans L3 ligger nära kanten.',
    });
    const skriven = (await rader(contractId))[0]!;

    // Egen transaktion per försök: ett avvisat UPDATE aborterar transaktionen,
    // och då hade en efterföljande läsning inte gått att göra i samma.
    await expect(withTenantTransaction(user.userId, companyId, (client) => client.query(
      "UPDATE uppdrag_bedomning SET lage = 'pa_spar' WHERE id = $1", [skriven.id],
    ))).rejects.toThrow(/permission denied/);
    await expect(withTenantTransaction(user.userId, companyId, (client) => client.query(
      'DELETE FROM uppdrag_bedomning WHERE id = $1', [skriven.id],
    ))).rejects.toThrow(/permission denied/);

    expect(await rader(contractId)).toEqual([skriven]);
  });
});

// ---------------------------------------------------------------------------
// (c) Lager tre: vyn skriver genom samma action-lager — lärdom 5
// ---------------------------------------------------------------------------

describe('(c) vyn: Davids egen väg in', () => {
  async function sida(path: string): Promise<string> {
    const res = await ua.get(path);
    expect(res.status, `${path} gav ${res.status}`).toBe(200);
    return res.text;
  }

  it('uppdragssidan har vägen in till bedömningen', async () => {
    const html = await sida(`/app/c/${companyId}/projects/${projektId}`);
    expect(html).toContain(`href="/app/c/${companyId}/projects/${projektId}/bedomning"`);
    expect(html).toContain('Bedömning');
  });

  it('sidan visar formulärets tre lägen, historiken och att raden inte går att ändra', async () => {
    const html = await sida(`/app/c/${companyId}/projects/${projektId}/bedomning`);
    expect(html).toContain(`action="/app/c/${companyId}/projects/${projektId}/bedomning"`);
    for (const lage of ['pa_spar', 'risk', 'ur_spar']) {
      expect(html).toContain(`name="lage" value="${lage}"`);
    }
    expect(html).toContain('name="period_start"');
    expect(html).toContain('name="period_slut"');
    expect(html).toContain('name="kommentar"');
    // Oåterkalleligheten står FÖRE knappen, inte som en överraskning efteråt.
    expect(html).toContain('går inte att ändra eller ta bort efteråt');
    // Historiken (raden ur prov (a)) läses på SAMMA sida — perioden som den
    // står i tabellen, inte som formulärets förifyllda datum.
    expect(html).toContain('2026-09-01 – 2026-09-30');
    expect(html).toContain('På spår');
  });

  it('uppdrag utan avtal säger vad man gör i stället för att visa ett formulär som inte kan skriva', async () => {
    const html = await sida(`/app/c/${companyId}/projects/${avtalslostProjekt}/bedomning`);
    expect(html).toContain('Uppdraget har inget avtal ännu');
    expect(html).not.toContain('name="lage"');
  });

  it('POST från formuläret skriver raden som människa och auditloggas', async () => {
    const { projektId: projectId, avtalId: contractId } = await nyttUppdrag('Vyskriven');

    const res = await ua.post(`/app/c/${companyId}/projects/${projectId}/bedomning`).type('form').send({
      contract_id: contractId,
      period_start: '2026-04-01',
      period_slut: '2026-06-30',
      lage: 'ur_spar',
      kommentar: 'Två leverabler har glidit ur kvartalet.',
    });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`/app/c/${companyId}/projects/${projectId}/bedomning`);

    const skrivna = await rader(contractId);
    expect(skrivna).toHaveLength(1);
    expect(skrivna[0]!.lage).toBe('ur_spar');
    expect(skrivna[0]!.satt_av_manniska).toBe(true);
    expect(skrivna[0]!.kommentar).toBe('Två leverabler har glidit ur kvartalet.');
    // Svepets kolumner hör till senare stories och fylls aldrig med en gissning.
    expect(skrivna[0]!.handelse_ref_ids).toBeNull();
    expect(skrivna[0]!.frysta_siffror).toBeNull();

    expect(await auditrader()).toContain('action.executed:satt_bedomning');

    // Och sidan visar den nya raden — kvittot är historiken, inte en text.
    const html = await sida(`/app/c/${companyId}/projects/${projectId}/bedomning`);
    expect(html).toContain('Ur spår');
    expect(html).toContain('Två leverabler har glidit ur kvartalet.');
  });
});

// ---------------------------------------------------------------------------
// KRAV-5: vattenmelonskyddet — tre lägen, inget fjärde, och historiken består
// ---------------------------------------------------------------------------

describe('de tre lägena, och bara de tre', () => {
  it('alla tre går att lagra, med och utan kommentar', async () => {
    const contractId = await nyttAvtal('Tre lägen');
    await ok('satt_bedomning', {
      contract_id: contractId, period_start: '2026-01-01', period_slut: '2026-01-31',
      lage: 'pa_spar', kommentar: 'Allt enligt plan.',
    });
    await ok('satt_bedomning', {
      contract_id: contractId, period_start: '2026-02-01', period_slut: '2026-02-28', lage: 'risk',
    });
    await ok('satt_bedomning', {
      contract_id: contractId, period_start: '2026-03-01', period_slut: '2026-03-31',
      lage: 'ur_spar', kommentar: 'Taket passerat på L2.',
    });

    const skrivna = await rader(contractId);
    expect(skrivna.map((r) => r.lage)).toEqual(['pa_spar', 'risk', 'ur_spar']);
    expect(skrivna.map((r) => r.kommentar)).toEqual(['Allt enligt plan.', null, 'Taket passerat på L2.']);
    expect(skrivna.every((r) => r.satt_av_manniska)).toBe(true);
  });

  it('ett fjärde läge fälls av zod (400) — och av CHECK-villkoret om det ändå nådde fram', async () => {
    const contractId = await nyttAvtal('Fjärde läget');
    const res = await act('satt_bedomning', {
      contract_id: contractId, period_start: '2026-01-01', period_slut: '2026-01-31', lage: 'gult',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect(res.body.error).toBe('validation_error');
    expect(await rader(contractId)).toHaveLength(0);

    // Databasen är backstoppet: samma värde rakt mot tabellen faller på
    // CHECK-villkoret i 0068. Regeln finns alltså på båda ställena, och den
    // gäller även för en framtida skrivväg som inte går genom schemat.
    await expect(withTenantTransaction(user.userId, companyId, (client) => client.query(
      `INSERT INTO uppdrag_bedomning
         (company_id, contract_id, period_start, period_slut, lage, satt_av_manniska)
       VALUES ($1, $2, '2026-01-01', '2026-01-31', 'gult', true)`,
      [companyId, contractId],
    ))).rejects.toThrow(/violates check constraint/);
    expect(await rader(contractId)).toHaveLength(0);
  });

  it('en andra bedömning för samma period läggs BREDVID den första (FR-17)', async () => {
    const contractId = await nyttAvtal('Två om samma period');
    await ok('satt_bedomning', {
      contract_id: contractId, period_start: '2026-09-01', period_slut: '2026-09-30',
      lage: 'pa_spar', kommentar: 'Ser bra ut.',
    });
    const forsta = (await rader(contractId))[0]!;

    await ok('satt_bedomning', {
      contract_id: contractId, period_start: '2026-09-01', period_slut: '2026-09-30',
      lage: 'ur_spar', kommentar: 'Rättelse: L4 var inte levererad.',
    });

    const bada = await rader(contractId);
    expect(bada).toHaveLength(2);
    // Den första raden är IDENTISK med sig själv — det är hela FR-17. Vad man
    // trodde i september går att läsa i oktober, även när man hade fel.
    expect(bada[0]).toEqual(forsta);
    expect(bada[1]!.lage).toBe('ur_spar');
    expect(bada[1]!.id).not.toBe(forsta.id);
  });
});

// ---------------------------------------------------------------------------
// Tenantgränsen
// ---------------------------------------------------------------------------

describe('grannbolaget', () => {
  it('kan varken skriva mot vårt avtal eller läsa våra bedömningar', async () => {
    const grannauth = { Authorization: `Bearer ${grannen.token}` };

    // Avtalet härleds ur URL:ens bolag, aldrig ur indatat: vårt contract_id i
    // grannens bolag är ett avtal som inte finns.
    const res = await api.post(`/api/companies/${grannbolag}/actions/satt_bedomning`)
      .set(grannauth)
      .send({
        contract_id: avtalId, period_start: '2026-09-01', period_slut: '2026-09-30', lage: 'ur_spar',
      });
    expect(res.status, JSON.stringify(res.body)).toBe(404);
    expect(res.body.error).toBe('not_found');

    // RLS fäller samma försök rakt mot tabellen.
    await expect(withTenantTransaction(grannen.userId, grannbolag, (client) => client.query(
      `INSERT INTO uppdrag_bedomning
         (company_id, contract_id, period_start, period_slut, lage, satt_av_manniska)
       VALUES ($1, $2, '2026-09-01', '2026-09-30', 'ur_spar', true)`,
      [companyId, avtalId],
    ))).rejects.toThrow(/row-level security|permission denied/);

    // Och grannen ser ingenting av det vi skrivit.
    const synliga = await withTenantTransaction(grannen.userId, grannbolag, async (client) =>
      (await client.query('SELECT id FROM uppdrag_bedomning')).rowCount);
    expect(synliga).toBe(0);
    expect((await rader(avtalId)).length).toBeGreaterThan(0);
  });

  it('vyn svarar 404 på ett annat bolags uppdrag', async () => {
    const grannUa = supertest.agent(app);
    const login = await grannUa.post('/app/login').type('form').send({ email: grannen.email, password: PASSWORD });
    expect([302, 303]).toContain(login.status);
    const res = await grannUa.get(`/app/c/${grannbolag}/projects/${projektId}/bedomning`);
    expect(res.status).toBe(404);
  });
});
