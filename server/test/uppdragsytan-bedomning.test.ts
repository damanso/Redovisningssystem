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
    // S4.2: servern fryser underlaget även när det inte finns något att frysa.
    // Tom array, aldrig NULL — NULL betyder "satt före S4.2" och ingenting annat.
    expect(skrivna[0]!.handelse_ref_ids).toEqual([]);
    expect(skrivna[0]!.frysta_siffror).toMatchObject({
      period_start: '2026-04-01', period_slut: '2026-06-30',
      timmar: { poster: 0, minuter: 0, fakturerbara_minuter: 0 },
      delar: [], leverabelrorelser: [], handelser: 0,
    });

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

// ===========================================================================
// S4.2, våg 6: den förifyllda rapporten (FR-16/FR-20/FR-25/FR-26/FR-32)
//
// Bedömningen ska vara ett UNDERLAG, inte en magkänsla: talen som gällde när
// den sattes fryses med raden, och händelserna följer med som PEKARE. Provet
// är skrivet mot de tre sätt det kan gå sönder på:
//
//   * Talen kommer från fel ställe. Förbrukningen mot tak ska vara husets enda
//     takberäkning (FR-25) och periodens timmar ska vara periodens — därför
//     ligger en tidpost UTANFÖR perioden i riggen: den syns i delens
//     livslånga förbrukning men får aldrig synas i periodens timmar.
//   * Talen räknas om i efterhand. En tidpost som läggs till EFTER bedömningen
//     får inte röra en enda siffra i den frysta raden (FR-20).
//   * Underlaget kommer utifrån. `frysta_siffror`/`handelse_ref_ids` är inte
//     indatafält; `.strict()` fäller dem, precis som `satt_av_manniska`.
// ===========================================================================

async function begar(namn: string, kropp: Record<string, unknown>): Promise<string> {
  const res = await act(namn, kropp);
  expect(res.status, `${namn}: ${JSON.stringify(res.body)}`).toBe(202);
  return (res.body.approval as { id: string }).id;
}

async function okKoad(namn: string, kropp: Record<string, unknown>): Promise<Record<string, unknown>> {
  const id = await begar(namn, kropp);
  const res = await api.post(`${co()}/approvals/${id}/approve`).set(auth()).send({});
  expect(res.status, `${namn} (godkännande): ${JSON.stringify(res.body)}`).toBe(200);
  return res.body.result as Record<string, unknown>;
}

interface FrystaSiffror {
  period_start: string;
  period_slut: string;
  timmar: { poster: number; minuter: number; fakturerbara_minuter: number };
  delar: {
    code: string; name: string; minuter: number; belopp_ore: number;
    tak_timmar: number | null; tak_ore: number | null;
    tak_status: string; andel: number | null;
  }[];
  leverabelrorelser: { kod: string; fran: string | null; till: string; nar: string }[];
  handelser: number;
}

/** Ett uppdrag med taxa, en avtalsdel med BEKRÄFTAT tak och en leverabel. */
async function riggatUppdrag(namn: string, taxaOre: number): Promise<{
  projektId: string; avtalId: string; leverabelId: string;
}> {
  const projektId = (await ok('create_project', { name: `Uppdrag ${namn}` })).id as string;
  const avtalId = (await ok('create_contract', {
    project_id: projektId, name: namn, signed_date: '2026-01-01', hourly_rate_ore: taxaOre,
  })).id as string;
  // Taket är bekräftat — ett oläst tak ger varken andel eller status
  // 'bekraftat', och då hade rapporten inte haft något att visa.
  await okKoad('upsert_contract_part', {
    contract_id: avtalId, code: 'S1', name: 'Fas 1', valid_from: '2026-01-01',
    cap_hours: 10, cap_amount_ore: 1_200_000, cap_confirmed: true,
  });
  const leverabelId = await withAdmin(async (c) => (await c.query<{ id: string }>(
    `INSERT INTO uppdrag_leverabel (company_id, contract_id, kod, status)
     VALUES ($1, $2, 'L1', 'pagar') RETURNING id`,
    [companyId, avtalId],
  )).rows[0]!.id);
  return { projektId, avtalId, leverabelId };
}

/** Avtalsdelens id ur husets egen läsväg — aldrig ur en egen fråga. */
async function delId(contractId: string, kod: string): Promise<string> {
  const parts = (await ok('get_contract_usage', { contract_id: contractId }))
    .parts as unknown as { part_id: string; code: string }[];
  return parts.find((d) => d.code === kod)!.part_id;
}

/**
 * Referenser med ett VALT `created_at`. Riggning av indata: `uppdrag_referens`
 * bär inget eget händelsedatum (0068), så perioden mäts på när referensen
 * länkades — och det datumet går inte att välja genom skrivvägen.
 */
async function riggaReferens(
  contractId: string, sort: string, externId: string, nar: string,
): Promise<string> {
  return withAdmin(async (c) => (await c.query<{ id: string }>(
    `INSERT INTO uppdrag_referens
       (company_id, contract_id, sort, extern_id, extern_nyckel, extern_kalla,
        titel_vid_lankning, status, created_at)
     VALUES ($1, $2, $3, $4, $5, 'gmail:david@locollabs.com', $6, 'levande', $7)
     RETURNING id`,
    [companyId, contractId, sort, externId, sort === 'mejl' ? 'rfc822#message-id' : 'icalendar#uid',
      `Underlag ${externId}`, nar],
  )).rows[0]!.id);
}

/** Ett statusbyte med valt datum. Tabellen är append-only för `app`. */
async function riggaRorelse(
  contractId: string, leverabelId: string, fran: string, till: string, nar: string,
): Promise<void> {
  await withAdmin((c) => c.query(
    `INSERT INTO uppdrag_leverabel_handelse
       (company_id, contract_id, leverabel_id, fran, till, created_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [companyId, contractId, leverabelId, fran, till, nar],
  ));
}

const PERIOD = { start: '2026-05-01', slut: '2026-05-31' };

describe('(S4.2 a) siffrorna fryses ur serverns egen omräkning', () => {
  let uppdrag: { projektId: string; avtalId: string; leverabelId: string };
  let iPerioden: string[] = [];
  let fryst: FrystaSiffror;
  let refIds: string[] | null = null;

  beforeAll(async () => {
    uppdrag = await riggatUppdrag('Fryst underlag', 120_000);
    const del = await delId(uppdrag.avtalId, 'S1');

    // 2 h i perioden och 1 h efter den. Delens förbrukning mot taket är
    // avtalets hela livslängd (3 h); periodens timmar är periodens (2 h).
    await ok('log_time', {
      project_id: uppdrag.projektId, work_date: '2026-05-12', minutes: 120,
      description: 'Arbete i perioden', contract_part_id: del,
    });
    await ok('log_time', {
      project_id: uppdrag.projektId, work_date: '2026-06-05', minutes: 60,
      description: 'Arbete efter perioden', contract_part_id: del,
    });

    iPerioden = [
      await riggaReferens(uppdrag.avtalId, 'mejl', 'CAF7v2h9k@mail.gmail.com', '2026-05-10T09:00:00Z'),
      await riggaReferens(uppdrag.avtalId, 'kalender', 'styrgrupp-maj@locollabs', '2026-05-20T09:00:00Z'),
    ];
    // Utanför perioden, och fel sort inuti den: ingen av dem får följa med.
    await riggaReferens(uppdrag.avtalId, 'mejl', 'juni@mail.gmail.com', '2026-06-02T09:00:00Z');
    await riggaReferens(uppdrag.avtalId, 'drive', 'drive-fil-1', '2026-05-15T09:00:00Z');

    await riggaRorelse(uppdrag.avtalId, uppdrag.leverabelId, 'ej_paborjad', 'pagar', '2026-05-14T09:00:00Z');
    await riggaRorelse(uppdrag.avtalId, uppdrag.leverabelId, 'pagar', 'levererad', '2026-06-03T09:00:00Z');

    const svar = await ok('satt_bedomning', {
      contract_id: uppdrag.avtalId, period_start: PERIOD.start, period_slut: PERIOD.slut,
      lage: 'risk', kommentar: 'Taket närmar sig.',
    });
    fryst = svar.frysta_siffror as unknown as FrystaSiffror;
    refIds = svar.handelse_ref_ids as string[];
  });

  it('perioden, timmarna och händelseantalet står i raden', () => {
    expect(fryst.period_start).toBe(PERIOD.start);
    expect(fryst.period_slut).toBe(PERIOD.slut);
    // Junipostens 60 minuter ligger UTANFÖR perioden och är inte med.
    expect(fryst.timmar).toEqual({ poster: 1, minuter: 120, fakturerbara_minuter: 120 });
    expect(fryst.handelser).toBe(2);
  });

  it('förbrukningen mot taket är husets tal, inte en egen summering (FR-25)', () => {
    expect(fryst.delar).toHaveLength(1);
    const s1 = fryst.delar[0]!;
    expect(s1.code).toBe('S1');
    // 3 h totalt på delen (2 h + 1 h), värderade med avtalets taxa 1 200 kr/h.
    expect(s1.minuter).toBe(180);
    expect(s1.belopp_ore).toBe(360_000);
    expect(s1.tak_timmar).toBe(10);
    expect(s1.tak_ore).toBe(1_200_000);
    expect(s1.tak_status).toBe('bekraftat');
    expect(s1.andel).toBe(0.3);
  });

  it('bara periodens leverabelrörelse följer med', () => {
    expect(fryst.leverabelrorelser).toHaveLength(1);
    expect(fryst.leverabelrorelser[0]).toMatchObject({ kod: 'L1', fran: 'ej_paborjad', till: 'pagar' });
  });

  it('`handelse_ref_ids` pekar exakt på periodens referenser — inga kopior (FR-26)', () => {
    expect(refIds).toEqual(iPerioden);
  });

  it('raden i tabellen bär samma frysta underlag som svaret', async () => {
    const skrivna = await rader(uppdrag.avtalId);
    expect(skrivna).toHaveLength(1);
    expect(skrivna[0]!.frysta_siffror).toEqual(fryst);
    expect(skrivna[0]!.handelse_ref_ids).toEqual(iPerioden);
  });

  it('en tidpost EFTER bedömningen rör inte en enda siffra i den (FR-20)', async () => {
    await ok('log_time', {
      project_id: uppdrag.projektId, work_date: '2026-05-25', minutes: 240,
      description: 'Registrerad i efterhand', contract_part_id: await delId(uppdrag.avtalId, 'S1'),
    });

    // Källan har ändrats: samma period ger nu ett annat underlag …
    const nyBedomning = await ok('satt_bedomning', {
      contract_id: uppdrag.avtalId, period_start: PERIOD.start, period_slut: PERIOD.slut, lage: 'ur_spar',
    });
    expect((nyBedomning.frysta_siffror as unknown as FrystaSiffror).timmar.minuter).toBe(360);

    // … men den FÖRSTA raden står kvar exakt som den skrevs.
    const skrivna = await rader(uppdrag.avtalId);
    expect(skrivna).toHaveLength(2);
    expect(skrivna[0]!.frysta_siffror).toEqual(fryst);
    expect(skrivna[0]!.handelse_ref_ids).toEqual(iPerioden);
  });
});

describe('(S4.2 b) underlaget är serverns, aldrig anroparens', () => {
  it('`frysta_siffror` som indata fälls av det strikta schemat', async () => {
    const contractId = await nyttAvtal('Medskickat underlag');
    const res = await act('satt_bedomning', {
      contract_id: contractId, period_start: '2026-05-01', period_slut: '2026-05-31', lage: 'pa_spar',
      frysta_siffror: { timmar: { minuter: 0, poster: 0, fakturerbara_minuter: 0 } },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect(res.body.error).toBe('validation_error');
    expect(await rader(contractId)).toHaveLength(0);
  });

  it('`handelse_ref_ids` som indata fälls likadant', async () => {
    const contractId = await nyttAvtal('Medskickade pekare');
    const res = await act('satt_bedomning', {
      contract_id: contractId, period_start: '2026-05-01', period_slut: '2026-05-31', lage: 'pa_spar',
      handelse_ref_ids: ['00000000-0000-0000-0000-000000000001'],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect(res.body.error).toBe('validation_error');
    expect(await rader(contractId)).toHaveLength(0);
  });

  it('agenten avvisas fortfarande med 403 `human_required` (FR-15)', async () => {
    const contractId = await nyttAvtal('Agenten och underlaget');
    const res = await act('satt_bedomning', {
      contract_id: contractId, period_start: '2026-05-01', period_slut: '2026-05-31', lage: 'pa_spar',
    }, agent());
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(res.body.error).toBe('human_required');
    expect(await rader(contractId)).toHaveLength(0);
  });
});

describe('(S4.2 c) en tom period fryser nollor och lyckas', () => {
  it('lägesvalet är fortfarande den enda obligatoriska inmatningen', async () => {
    const contractId = await nyttAvtal('Tom period');
    const svar = await ok('satt_bedomning', {
      contract_id: contractId, period_start: '2026-07-01', period_slut: '2026-07-31', lage: 'pa_spar',
    });
    expect(svar.lage).toBe('pa_spar');
    expect(svar.frysta_siffror).toMatchObject({
      timmar: { poster: 0, minuter: 0, fakturerbara_minuter: 0 },
      delar: [], leverabelrorelser: [], handelser: 0,
    });

    // Tom array, inte NULL: `{}` betyder "inget hände", NULL betyder "satt före
    // S4.2". Ett fält som betyder två saker går inte att lita på.
    const skrivna = await rader(contractId);
    expect(skrivna[0]!.handelse_ref_ids).toEqual([]);
    expect(skrivna[0]!.handelse_ref_ids).not.toBeNull();
    expect(skrivna[0]!.frysta_siffror).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// (S4.2 d) Vyn: rapporten är redan ifylld när sidan öppnas (KRAV-5/KRAV-6)
// ---------------------------------------------------------------------------

describe('(S4.2 d) vyn förifyller rapporten', () => {
  let vy: { projektId: string; avtalId: string; leverabelId: string };
  let manad: { start: string; slut: string };
  let html = '';

  beforeAll(async () => {
    // Sidans förval är innevarande månad, så riggen måste ligga där: rapporten
    // visar den period formuläret faktiskt skulle skicka.
    const nu = new Date();
    const dag = (d: Date): string => d.toISOString().slice(0, 10);
    manad = {
      start: dag(new Date(Date.UTC(nu.getUTCFullYear(), nu.getUTCMonth(), 1))),
      slut: dag(new Date(Date.UTC(nu.getUTCFullYear(), nu.getUTCMonth() + 1, 0))),
    };

    vy = await riggatUppdrag('Vyrapport', 100_000);
    await ok('log_time', {
      project_id: vy.projektId, work_date: dag(nu), minutes: 90,
      description: 'Arbete den här månaden', contract_part_id: await delId(vy.avtalId, 'S1'),
    });
    await riggaReferens(vy.avtalId, 'mejl', 'manadens-mejl@mail.gmail.com', `${manad.start}T08:00:00Z`);
    await riggaRorelse(vy.avtalId, vy.leverabelId, 'ej_paborjad', 'pagar', `${manad.start}T08:00:00Z`);
    await withAdmin(async (c) => {
      for (const [sort, text] of [['innanfor', 'Löpande bokföring och avstämning'],
        ['utanfor', 'Systemimplementation hos tredje part'],
        ['fras', 'kan ni även titta på']] as const) {
        await c.query(
          `INSERT INTO uppdrag_scopelinje (company_id, contract_id, sort, text, klausul)
           VALUES ($1, $2, $3, $4, '§2.1')`,
          [companyId, vy.avtalId, sort, text],
        );
      }
    });
    // En rad utan fryst underlag — så som S4.1 skrev dem. Den ska renderas som
    // i dag, utan siffror, aldrig med en nolla som ser ut som ett underlag.
    await withAdmin((c) => c.query(
      `INSERT INTO uppdrag_bedomning
         (company_id, contract_id, period_start, period_slut, lage, satt_av_manniska, kommentar)
       VALUES ($1, $2, '2026-02-01', '2026-02-28', 'pa_spar', true, 'Satt av S4.1')`,
      [companyId, vy.avtalId],
    ));

    const res = await ua.get(`/app/c/${companyId}/projects/${vy.projektId}/bedomning`);
    expect(res.status, `sidan gav ${res.status}`).toBe(200);
    html = res.text;
  });

  it('rapporten står på sidan med periodens timmar och delen mot sitt tak', () => {
    expect(html).toContain('Underlaget för perioden');
    expect(html).toContain(`${manad.start} – ${manad.slut}`);
    expect(html).toContain('1 h 30 min');
    expect(html).toContain('Förbrukning mot tak');
    expect(html).toContain('S1');
    expect(html).toContain('10 h');
    expect(html).toContain('Bekräftat');
  });

  it('leverabelrörelsen, händelsen och scopelinjen står där — händelsen som referens', () => {
    expect(html).toContain('Leverabelrörelser i perioden');
    expect(html).toContain('Händelser i perioden');
    expect(html).toContain('manadens-mejl@mail.gmail.com');
    expect(html).toContain('Innanför uppdraget');
    expect(html).toContain('Löpande bokföring och avstämning');
    expect(html).toContain('Utanför uppdraget');
    expect(html).toContain('Systemimplementation hos tredje part');
    expect(html).toContain('kan ni även titta på');
  });

  it('formuläret är kvar med sitt förval, och sidan är JS-fri', () => {
    expect(html).toContain(`value="${manad.start}"`);
    expect(html).toContain('name="lage" value="pa_spar"');
    expect(html).not.toContain('<script');
  });

  it('historiken visar den frysta radens tal — och säger ifrån när de saknas', async () => {
    await ok('satt_bedomning', {
      contract_id: vy.avtalId, period_start: manad.start, period_slut: manad.slut,
      lage: 'risk', kommentar: 'Halva taket på en månad.',
    });
    const res = await ua.get(`/app/c/${companyId}/projects/${vy.projektId}/bedomning`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Underlaget då');
    expect(res.text).toContain('Mot taket då');
    // S4.1-raden bär NULL och renderas som just det.
    expect(res.text).toContain('Satt innan underlaget frystes');
    expect(res.text).toContain('Satt av S4.1');
  });

  it('ett uppdrag utan länkade händelser säger det i stället för att gissa (FR-32)', async () => {
    const res = await ua.get(`/app/c/${companyId}/projects/${projektId}/bedomning`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Inga kalenderposter eller mejl är länkade');
    expect(res.text).toContain('Avtalet har inga scopelinjer ännu');
    // Rapporten blockerar aldrig formuläret.
    expect(res.text).toContain('name="lage" value="risk"');
  });
});
