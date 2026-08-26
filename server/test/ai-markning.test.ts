// #63: kantremsan på AI-kortet bytte bärare. Remsan (3px) var dekor enligt
// designsvepets antimönster 7 — men den BAR AI-märkningen, och märkningen är
// ett regulatoriskt krav (AI-förordningen art. 50), inte pynt.
//
// Provet visar BÅDA halvorna på SAMMA renderade sida, och det är hela poängen:
// ett prov som bara letar efter remsan blir grönt också om någon tar bort hela
// märkningen, och ett prov som bara letar efter märkningen blir grönt med
// remsan kvar. Var för sig mäter de en proxy för "bytet gjordes". Ihop mäter
// de bytet.
//
// Allt läses ur den RENDERADE sidan (HTML + den inbäddade stilmallen), aldrig
// ur källfilen och aldrig ur en statuskod.
import supertest from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { api, app, createCompany, createFiscalYear, registerUser, type TestUser } from './helpers.js';

const PASSWORD = 'mycket-hemligt-losen-123';
let user: TestUser;
let companyId: string;
let customerId: string;
let agentToken: string;
let ua: ReturnType<typeof supertest.agent>;
let agentGodkannandeId: string;
const human = () => ({ Authorization: `Bearer ${user.token}` });
const agent = () => ({ Authorization: `Bearer ${agentToken}` });
const co = () => `/api/companies/${companyId}`;

/** En faktura att föreslå bokföring av. create_invoice är inte känsligt → 200. */
async function nyFaktura(): Promise<string> {
  const inv = await api.post(`${co()}/actions/create_invoice`).set(human()).send({
    customer_id: customerId, invoice_date: '2026-03-01', due_date: '2026-03-31',
    lines: [{ description: 'Tjänst', quantity: 1, unit: 'st', unit_price_ore: 100_000, vat_rate: 25 }],
  });
  expect(inv.status, JSON.stringify(inv.body)).toBe(200);
  return inv.body.result.id;
}

/**
 * Korten på den renderade sidan, ett per <article class="ai-card">.
 *
 * Assertionen inuti är inte pynt: `grep 'class="innehall"'` gav 0 träffar i ett
 * annat pass där sanningen var 2, för attributet skrevs utan citattecken. En
 * sökning som inte hittar sitt eget ankare måste bli RÖD, inte tom.
 */
function kort(sidtext: string): string[] {
  expect(sidtext, 'sidan innehåller inget ai-card — då mäter provet ingenting')
    .toContain('<article class="ai-card">');
  return sidtext
    .split('<article class="ai-card">')
    .slice(1)
    .map((s) => s.slice(0, s.indexOf('</article>')));
}

/** Den inbäddade stilmallen ur den renderade sidan. */
function stilmall(sidtext: string): string {
  const start = sidtext.indexOf('<style>');
  const slut = sidtext.indexOf('</style>');
  expect(start >= 0 && slut > start, 'ingen <style> i den renderade sidan').toBe(true);
  return sidtext.slice(start + '<style>'.length, slut);
}

/** Regeln .ai-card { ... } ur stilmallen. */
function aiCardRegel(css: string): string {
  const i = css.indexOf('.ai-card {');
  expect(i, 'regeln .ai-card saknas i stilmallen — kontrollen skulle bli tom').toBeGreaterThan(-1);
  return css.slice(i, css.indexOf('}', i) + 1);
}

beforeAll(async () => {
  user = await registerUser('aimark');
  companyId = await createCompany(user.token, 'Märkning AB');
  await createFiscalYear(companyId, human(), {
    label: '2026', start_date: '2026-01-01', end_date: '2026-12-31',
  });
  const cust = await api.post(`${co()}/actions/create_customer`).set(human()).send({ name: 'Kund AB' });
  expect(cust.status, JSON.stringify(cust.body)).toBe(200);
  customerId = cust.body.result.id;
  const tok = await api.post(`${co()}/agent-tokens`).set(human()).send({ name: 'Cowork' });
  expect(tok.status, JSON.stringify(tok.body)).toBe(201);
  agentToken = tok.body.token;
  ua = supertest.agent(app);
  const inl = await ua.post('/app/login').type('form').send({ email: user.email, password: PASSWORD });
  expect(inl.status, 'inloggningen till vyn misslyckades').toBe(302);
});

describe('#63 AI-kortet: remsan bort, märkningen kvar', () => {
  it('samma renderade sida: ingen remsa över 1px OCH en läsbar AI-märkning', async () => {
    const faktura = await nyFaktura();
    const forslag = await api.post(`${co()}/actions/book_invoice`).set(agent())
      .send({ invoice_id: faktura });
    expect(forslag.status, JSON.stringify(forslag.body)).toBe(202);
    agentGodkannandeId = forslag.body.approval.id;

    const sida = await ua.get(`/app/c/${companyId}/approvals`);
    expect(sida.status).toBe(200);
    const korten = kort(sida.text);
    expect(korten, 'ett väntande förslag → exakt ett kort').toHaveLength(1);

    // HALVA 1 — bäraren är borttagen. Läst ur den stilmall som faktiskt
    // levererades till webbläsaren, inte ur src/.
    const css = stilmall(sida.text);
    expect(aiCardRegel(css), 'kantremsan sitter kvar på .ai-card').not.toContain('border-left');
    expect(css, 'någon remsa över 1px finns kvar i stilmallen').not.toMatch(/border-(left|right):\s*[2-9]px/);

    // HALVA 2 — märkningen finns kvar, och den är LÄSBAR text. En färg räcker
    // inte: den går inte att läsa högt, inte att söka efter och syns inte i
    // svartvitt. Därför krävs orden, inte bara klassnamnet.
    const kortet = korten[0];
    expect(kortet, 'AI-märkningen saknas helt på kortet').toContain('ai-markning');
    expect(kortet, 'märkningen har ingen synlig text').toMatch(/>AI-genererat förslag</);
    expect(kortet, 'märkningen saknar sin rättsliga grund').toContain('AI-förordningen artikel 50');
  });

  // Negativ kontroll. Utan den betyder märkningen ingenting: en etikett som
  // sitter på ALLT säger inget om något. Remsan hade precis det felet — den satt
  // på varje ai-card, även på förslag en människa köat, och kunde därför inte
  // ensam vara AI-märkningen.
  it('ett förslag från en människa bär INTE AI-märkningen', async () => {
    const avvisa = await ua.post(`/app/c/${companyId}/approvals/${agentGodkannandeId}/reject`)
      .type('form').send({});
    expect(avvisa.status, 'kunde inte tömma kön').toBe(302);

    const faktura = await nyFaktura();
    const forslag = await api.post(`${co()}/actions/book_invoice`).set(human())
      .send({ invoice_id: faktura });
    expect(forslag.status, JSON.stringify(forslag.body)).toBe(202);

    const sida = await ua.get(`/app/c/${companyId}/approvals`);
    const korten = kort(sida.text);
    expect(korten, 'ett väntande förslag → exakt ett kort').toHaveLength(1);
    expect(korten[0], 'människans förslag märktes som AI-genererat').not.toContain('ai-markning');
    expect(korten[0], 'kortet tappade sin egen etikett').toContain('Förslag');
  });
});
