// Uppdragsytan, överlämning #268: anteckningsloggen under Övrigt på Läget.
//
// Storyns "Klart när" är en rundtur: en rad skriven under Övrigt står kvar med
// datum efter omladdning, kan inte ändras eller raderas, och *Anteckningar* på
// avtalsformuläret är orört. Risken sitter i fyra lager, och provet är skrivet
// mot alla fyra — för varje lager som saknas är en konvention, inte en spärr:
//
//   (a) **Åtgärdslagret.** `skriv_uppdragsanteckning` bär `kravManniska`, så en
//       agent kan inte skriva en rad. Provet går via REST-rutten POST
//       /actions/:action med agent-token — samma väg MCP-servern tar, och den
//       enda ingång som saknar egen människospärr (mall: `manniskosparr.test.ts`).
//   (b) **Rättigheterna.** `uppdrag_anteckning` har SELECT + INSERT för rollen
//       `app` och ingenting annat (0073). En logg som går att skriva om i
//       efterhand är ingen logg, och det ska gälla även för kod som INTE går
//       genom tjänstelagret. Därför prövas UPDATE och DELETE som `app` rakt mot
//       tabellen.
//   (c) **Tenantgränsen.** Grannbolaget ser ingenting, kan inte skriva något och
//       når inte ytan — varken genom åtgärden, rakt mot tabellen eller i vyn.
//   (d) **Vyn.** Davids egen väg in går genom samma action-lager som AI:n hade
//       använt om den fick (lärdom 5), och raden landar synlig på Läget.
//
// Resten är tomheten och räkningen: en tom text ger 400 och aldrig en tyst tom
// rad, räkningen i panelhuvudet avser flaggade rader TOTALT (någon
// "behandlad"-status finns inte och ska inte finnas), och `contracts.notes` är
// oförändrat efteråt — avtalets egna anteckningar är en annan sak än loggen.
import supertest from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { app, api, createCompany, createFiscalYear, registerUser, withAdmin, type TestUser } from './helpers.js';
import { withTenantTransaction } from '../src/db/tx.js';
import { ACTIONS } from '../src/actions/registry.js';

const PASSWORD = 'mycket-hemligt-losen-123';
const NAMN = 'anteckning-david';
const AVTALSNOTERING = 'Avtalets egna anteckningar — de hör till avtalsformuläret och rörs inte här.';
const RAD_1 = 'Ringde Karin om momskoden på ILT:s tre fakturor.';
const RAD_2 = 'Rättade momskoden. Cirka 40 minuter, inget i avtalet om det.';
const RAD_3 = 'Karin bad om en extra avstämning i oktober.';

let user: TestUser;
let companyId: string;
let agentToken: string;
let projektId: string;
let avtalId: string;
/** Uppdraget där räkningen mäts: tre rader, två bockade. */
let raknProjekt: string;
let raknAvtal: string;
/** Uppdraget utan en enda rad — panelens tomläge. */
let tomtProjekt: string;
/** Uppdraget med TVÅ avtal — formulärets avtalsväljare. */
let fleraProjekt: string;
let grannen: TestUser;
let grannbolag: string;
let grannprojekt: string;
let ua: ReturnType<typeof supertest.agent>;

const auth = () => ({ Authorization: `Bearer ${user.token}` });
const agent = () => ({ Authorization: `Bearer ${agentToken}` });
const co = (id = companyId) => `/api/companies/${id}`;

type Svar = { status: number; body: Record<string, unknown> };

async function act(namn: string, kropp: Record<string, unknown>, headers = auth(), id = companyId): Promise<Svar> {
  const res = await api.post(`${co(id)}/actions/${namn}`).set(headers).send(kropp);
  return res as unknown as Svar;
}

async function ok(namn: string, kropp: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await act(namn, kropp);
  expect(res.status, `${namn}: ${JSON.stringify(res.body)}`).toBe(200);
  return res.body.result as Record<string, unknown>;
}

interface Rad {
  id: string;
  contract_id: string;
  text: string;
  utanfor_avtal: boolean;
  skriven_av: string;
  created_at: string;
}

/** Raderna som de STÅR i tabellen, förbi hela applikationslagret. */
async function rader(contractId: string): Promise<Rad[]> {
  return withAdmin(async (c) => (await c.query<Rad>(
    `SELECT id, contract_id, "text", utanfor_avtal, skriven_av, created_at::text
       FROM uppdrag_anteckning WHERE contract_id = $1 ORDER BY created_at, id`,
    [contractId],
  )).rows);
}

async function auditrader(): Promise<string[]> {
  const res = await api.get(`${co()}/audit`).set(auth());
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return (res.body.entries as { action: string; entity_id: string | null }[])
    .map((e) => `${e.action}:${e.entity_id ?? ''}`);
}

async function sida(path: string): Promise<string> {
  const res = await ua.get(path);
  expect(res.status, `${path} gav ${res.status}`).toBe(200);
  return res.text;
}

const lagetsVag = (projectId: string, id = companyId): string => `/app/c/${id}/projects/${projectId}/laget`;

/**
 * Panelens markup — och bara den. Panelen är husets `.panel` med
 * `aria-labelledby`; den kopplingen finns för skärmläsaren och används här för
 * att prova exakt EN panel i taget. Ett prov som läser hela sidan hade kunnat
 * fällas av ett annat korts text.
 */
function panelen(html: string): string {
  const start = html.indexOf('aria-labelledby="kort-ovrigt"');
  expect(start, 'panelen Övrigt saknas på Läget').toBeGreaterThan(-1);
  const slut = html.indexOf('</section>', start);
  expect(slut).toBeGreaterThan(start);
  return html.slice(start, slut);
}

/** Antal flaggade rader i markupen — chipet, inte en räknare vyn skrivit ut. */
const flaggadeChip = (markup: string): number => markup.split('Utanför avtalet</span>').length - 1;

async function nyttUppdrag(namn: string, notes?: string): Promise<{ projektId: string; avtalId: string }> {
  const projekt = (await ok('create_project', { name: namn })).id as string;
  const avtal = (await ok('create_contract', {
    project_id: projekt, name: `Avtal ${namn}`, signed_date: '2026-01-01',
    ...(notes ? { notes } : {}),
  })).id as string;
  return { projektId: projekt, avtalId: avtal };
}

beforeAll(async () => {
  user = await registerUser(NAMN);
  companyId = await createCompany(user.token, 'Locollabs AB');
  await createFiscalYear(companyId, auth(), { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });

  ({ projektId, avtalId } = await nyttUppdrag('ILT förvaltning', AVTALSNOTERING));
  ({ projektId: raknProjekt, avtalId: raknAvtal } = await nyttUppdrag('ILT räkning'));
  ({ projektId: tomtProjekt } = await nyttUppdrag('ILT utan rader'));

  // Två avtal på samma uppdrag: formuläret ska då fråga VILKET avtal raden hör
  // till i stället för att gissa.
  const flera = await nyttUppdrag('ILT två avtal');
  fleraProjekt = flera.projektId;
  await ok('create_contract', { project_id: fleraProjekt, name: 'Tilläggsavtal ILT', signed_date: '2026-02-01' });

  const tok = await api.post(`${co()}/agent-tokens`).set(auth()).send({ name: 'Cowork' });
  expect(tok.status, JSON.stringify(tok.body)).toBe(201);
  agentToken = tok.body.token;

  ua = supertest.agent(app);
  const login = await ua.post('/app/login').type('form').send({ email: user.email, password: PASSWORD });
  expect([302, 303]).toContain(login.status);

  grannen = await registerUser('anteckning-granne');
  grannbolag = await createCompany(grannen.token, 'Grannbolaget AB');
  const grannauth = { Authorization: `Bearer ${grannen.token}` };
  const gp = await api.post(`${co(grannbolag)}/actions/create_project`).set(grannauth).send({ name: 'Grannens uppdrag' });
  expect(gp.status, JSON.stringify(gp.body)).toBe(200);
  grannprojekt = (gp.body.result as { id: string }).id;
  const ga = await api.post(`${co(grannbolag)}/actions/create_contract`).set(grannauth).send({
    project_id: grannprojekt, name: 'Grannens avtal', signed_date: '2026-01-01',
  });
  expect(ga.status, JSON.stringify(ga.body)).toBe(200);
});

// ---------------------------------------------------------------------------
// (a) Åtgärdslagret: människan skriver, agenten avvisas — KRAV-2
// ---------------------------------------------------------------------------

describe('(a) registret och människospärren', () => {
  it('skriv_uppdragsanteckning är write + kravManniska', () => {
    const def = ACTIONS.find((a) => a.name === 'skriv_uppdragsanteckning');
    expect(def, 'åtgärden saknas i registret').toBeTruthy();
    expect(def!.sensitivity).toBe('write');
    expect(def!.kravManniska).toBe(true);
  });

  it('agentanropet fälls med 403 human_required — ingen rad, ingen auditrad, tom kö', async () => {
    // FÖRST: varje icke-känslig action auditloggas, även en läsning, så
    // jämförelsen måste tas före allt annat i provet.
    const fore = await auditrader();

    const res = await act('skriv_uppdragsanteckning', {
      contract_id: avtalId, text: 'AI:t tyckte att det här borde antecknas.',
    }, agent());
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(res.body.error).toBe('human_required');

    // Avvisningen sker FÖRE withTenantTransaction: ingenting skrivs, och
    // avvisningen loggas inte (beslut #115).
    expect(await auditrader()).toEqual(fore);
    expect(await rader(avtalId)).toHaveLength(0);

    // Och den hamnar inte i kön heller: åtgärden är `write`, inte `sensitive`
    // — det finns ingen köpost att godkänna i efterhand.
    const kon = await api.get(`${co()}/approvals`).set(auth());
    expect(kon.status).toBe(200);
    expect(kon.body.approvals).toHaveLength(0);
  });

  it('samma anrop som människa går igenom — spärren är på actor, inte på indatat', async () => {
    const svar = await ok('skriv_uppdragsanteckning', { contract_id: avtalId, text: RAD_1 });
    expect(svar.text).toBe(RAD_1);
    expect(svar.utanfor_avtal).toBe(false);
    // Avsändaren kommer ur den inloggade användaren, aldrig ur indatat.
    expect(svar.skriven_av).toBe(user.userId);
    expect(svar.skriven_av_namn).toBe(NAMN);
    expect(await rader(avtalId)).toHaveLength(1);
  });

  it('schemat är strikt: avsändaren, ett okänt fält och en saknad text fälls', async () => {
    for (const kropp of [
      { contract_id: avtalId, text: 'x', skriven_av: '00000000-0000-4000-8000-000000000000' },
      { contract_id: avtalId, text: 'x', behandlad: true },
      { contract_id: avtalId },
    ]) {
      const res = await act('skriv_uppdragsanteckning', kropp);
      expect(res.status, JSON.stringify(res.body)).toBe(400);
      expect(res.body.error).toBe('validation_error');
    }
    expect(await rader(avtalId)).toHaveLength(1);
  });

  it('tom och blank text ger 400 — aldrig en tyst tom rad', async () => {
    const tom = await act('skriv_uppdragsanteckning', { contract_id: avtalId, text: '' });
    expect(tom.status, JSON.stringify(tom.body)).toBe(400);
    expect(tom.body.error).toBe('validation_error');

    // Blanktecken passerar zod-schemats min(1) och fälls i tjänsten, med ett
    // begripligt svenskt besked i stället för ett rått databasfel.
    const blank = await act('skriv_uppdragsanteckning', { contract_id: avtalId, text: '   \n\t ' });
    expect(blank.status, JSON.stringify(blank.body)).toBe(400);
    expect(blank.body.error).toBe('tom_anteckning');

    expect(await rader(avtalId)).toHaveLength(1);
  });

  it('`contracts.notes` är oförändrat efter en skrivning', async () => {
    const notering = async (): Promise<string | null> => withAdmin(async (c) =>
      (await c.query<{ notes: string | null }>('SELECT notes FROM contracts WHERE id = $1', [avtalId])).rows[0]!.notes);
    expect(await notering()).toBe(AVTALSNOTERING);
    await ok('skriv_uppdragsanteckning', {
      contract_id: avtalId, text: 'En rad till loggen, inte till avtalet.', utanfor_avtal: true,
    });
    expect(await notering()).toBe(AVTALSNOTERING);
  });
});

// ---------------------------------------------------------------------------
// (b) Rättigheterna: raden går inte att ändra eller ta bort — KRAV-1
// ---------------------------------------------------------------------------

describe('(b) uppdrag_anteckning är append-only för rollen app', () => {
  it('UPDATE och DELETE fälls med permission denied, och raden står kvar', async () => {
    const { avtalId: eget } = await nyttUppdrag('ILT oföränderlig');
    await ok('skriv_uppdragsanteckning', { contract_id: eget, text: 'Den här raden ska stå kvar ordagrant.' });
    const skriven = (await rader(eget))[0]!;

    // Egen transaktion per försök: ett avvisat UPDATE aborterar transaktionen,
    // och då hade en efterföljande läsning inte gått att göra i samma.
    await expect(withTenantTransaction(user.userId, companyId, (client) => client.query(
      'UPDATE uppdrag_anteckning SET "text" = \'något annat\' WHERE id = $1', [skriven.id],
    ))).rejects.toThrow(/permission denied/);
    await expect(withTenantTransaction(user.userId, companyId, (client) => client.query(
      'UPDATE uppdrag_anteckning SET utanfor_avtal = true WHERE id = $1', [skriven.id],
    ))).rejects.toThrow(/permission denied/);
    await expect(withTenantTransaction(user.userId, companyId, (client) => client.query(
      'DELETE FROM uppdrag_anteckning WHERE id = $1', [skriven.id],
    ))).rejects.toThrow(/permission denied/);

    expect(await rader(eget)).toEqual([skriven]);
  });

  it('CHECK-villkoret fäller en tom rad också förbi tjänstelagret', async () => {
    await expect(withTenantTransaction(user.userId, companyId, (client) => client.query(
      `INSERT INTO uppdrag_anteckning (company_id, contract_id, "text", skriven_av)
       VALUES ($1, $2, '   ', $3)`,
      [companyId, avtalId, user.userId],
    ))).rejects.toThrow(/violates check constraint/);
  });
});

// ---------------------------------------------------------------------------
// (c) Tenantgränsen: grannbolaget ser ingenting och skriver ingenting
// ---------------------------------------------------------------------------

describe('(c) ett annat bolag ser ingenting', () => {
  it('åtgärden svarar 404, RLS fäller den råa skrivningen, och listan är tom', async () => {
    const grannauth = { Authorization: `Bearer ${grannen.token}` };
    // Avtalet härleds ur URL:ens bolag, aldrig ur indatat: vårt contract_id i
    // grannens bolag är ett avtal som inte finns.
    const res = await act('skriv_uppdragsanteckning',
      { contract_id: avtalId, text: 'Grannen skriver i vårt uppdrag.' }, grannauth, grannbolag);
    expect(res.status, JSON.stringify(res.body)).toBe(404);
    expect(res.body.error).toBe('not_found');

    await expect(withTenantTransaction(grannen.userId, grannbolag, (client) => client.query(
      `INSERT INTO uppdrag_anteckning (company_id, contract_id, "text", skriven_av)
       VALUES ($1, $2, 'smugglad rad', $3)`,
      [companyId, avtalId, grannen.userId],
    ))).rejects.toThrow(/row-level security|permission denied/);

    const synliga = await withTenantTransaction(grannen.userId, grannbolag, async (client) =>
      (await client.query('SELECT id FROM uppdrag_anteckning')).rowCount);
    expect(synliga).toBe(0);
    expect((await rader(avtalId)).length).toBeGreaterThan(0);
  });

  it('vyn svarar 404 på ett annat bolags uppdrag — både GET och POST', async () => {
    const grannUa = supertest.agent(app);
    const login = await grannUa.post('/app/login').type('form').send({ email: grannen.email, password: PASSWORD });
    expect([302, 303]).toContain(login.status);

    expect((await grannUa.get(lagetsVag(projektId, grannbolag))).status).toBe(404);
    const post = await grannUa.post(lagetsVag(projektId, grannbolag)).type('form')
      .send({ contract_id: avtalId, text: 'Grannens rad' });
    expect(post.status).toBe(404);

    // Och grannen når sitt EGET uppdrag på sin egen väg.
    const egen = await grannUa.get(lagetsVag(grannprojekt, grannbolag));
    expect(egen.status).toBe(200);
    expect(egen.text).not.toContain(RAD_1);
  });
});

// ---------------------------------------------------------------------------
// (d) Rundturen i vyn: skriv → ladda om → raden kvar — KRAV-3
// ---------------------------------------------------------------------------

describe('(d) panelen Övrigt på Läget', () => {
  it('rundturen: raden skrivs i formuläret och står kvar med datum och markering', async () => {
    const { projektId: p, avtalId: a } = await nyttUppdrag('ILT rundtur');

    const post = await ua.post(lagetsVag(p)).type('form')
      .send({ contract_id: a, text: RAD_2, utanfor_avtal: 'ja' });
    expect([302, 303]).toContain(post.status);
    // Tillbaka till Läget, inte till kön: åtgärden är `write`, inte `sensitive`.
    expect(post.headers.location).toBe(lagetsVag(p));

    const skriven = (await rader(a))[0]!;
    expect(skriven.utanfor_avtal).toBe(true);
    expect(skriven.skriven_av).toBe(user.userId);

    const markup = panelen(await sida(lagetsVag(p)));
    expect(markup).toContain(RAD_2);
    expect(markup).toContain(skriven.created_at.slice(0, 16));
    expect(markup).toContain(NAMN);
    expect(flaggadeChip(markup)).toBe(1);

    // Omladdningen är hela storyns "Klart när": raden ska stå kvar, byte för
    // byte, utan att något skrivits emellan.
    expect(panelen(await sida(lagetsVag(p)))).toBe(markup);
  });

  it('nyast överst, och räkningen i panelhuvudet avser flaggade rader totalt', async () => {
    for (const [text, utanfor] of [[RAD_1, false], [RAD_2, true], [RAD_3, true]] as const) {
      await ok('skriv_uppdragsanteckning', { contract_id: raknAvtal, text, ...(utanfor ? { utanfor_avtal: true } : {}) });
    }
    const markup = panelen(await sida(lagetsVag(raknProjekt)));

    // Nyast överst: den sist skrivna raden står först i markupen.
    expect(markup.indexOf(RAD_3)).toBeLessThan(markup.indexOf(RAD_2));
    expect(markup.indexOf(RAD_2)).toBeLessThan(markup.indexOf(RAD_1));

    // Räkningen står i ord i panelhuvudet — och den räknar de FLAGGADE, inte
    // alla tre. Någon "behandlad"-status finns inte: loggen är append-only.
    expect(markup).toContain('2 rader gäller arbete utanför avtalet');
    expect(flaggadeChip(markup)).toBe(2);
    expect(markup).not.toMatch(/behandlad|åtgärdad/i);
  });

  it('en ensam obockad rad ger ingen markering och ingen räkning', async () => {
    const { projektId: p, avtalId: a } = await nyttUppdrag('ILT obockad');
    await ok('skriv_uppdragsanteckning', { contract_id: a, text: RAD_1 });
    const markup = panelen(await sida(lagetsVag(p)));
    expect(markup).toContain(RAD_1);
    expect(flaggadeChip(markup)).toBe(0);
    expect(markup).toContain('Ingen rad gäller arbete utanför avtalet');
  });

  it('panelen finns även tom — med vad tomheten betyder, och med formuläret kvar', async () => {
    const markup = panelen(await sida(lagetsVag(tomtProjekt)));
    expect(markup).toContain('Ingen anteckning är skriven ännu');
    expect(markup).toContain('Ingen rad gäller arbete utanför avtalet');
    expect(markup).toContain('<textarea name="text"');
    expect(flaggadeChip(markup)).toBe(0);
  });

  it('fälten står FÖRE knappen, och panelen är JS-fri', async () => {
    const markup = panelen(await sida(lagetsVag(tomtProjekt)));
    const textarea = markup.indexOf('<textarea name="text"');
    const bock = markup.indexOf('name="utanfor_avtal"');
    const oatergangligt = markup.indexOf('går inte att ändra eller ta bort');
    const knapp = markup.indexOf('type="submit"');
    expect(textarea).toBeGreaterThan(-1);
    expect(bock).toBeGreaterThan(textarea);
    expect(oatergangligt).toBeGreaterThan(bock);
    expect(knapp).toBeGreaterThan(oatergangligt);
    expect(markup).not.toContain('<script');
    expect(markup).not.toContain('onclick');
  });

  it('ett uppdrag med två avtal frågar VILKET avtal raden hör till', async () => {
    expect(panelen(await sida(lagetsVag(fleraProjekt)))).toContain('<select name="contract_id"');
    // Med ett enda avtal finns inget att välja — då står avtalet som dolt fält.
    expect(panelen(await sida(lagetsVag(tomtProjekt)))).toContain('<input type="hidden" name="contract_id"');
  });

  it('en blank rad i formuläret ger en synlig notis på Läget, och ingen rad', async () => {
    const { projektId: p, avtalId: a } = await nyttUppdrag('ILT blank');
    const post = await ua.post(lagetsVag(p)).type('form').send({ contract_id: a, text: '    ' });
    expect([302, 303]).toContain(post.status);
    expect(post.headers.location).toContain('fel=');

    const sidan = await sida(String(post.headers.location));
    expect(sidan).toContain('anteckningen är tom');
    expect(await rader(a)).toHaveLength(0);
  });
});
