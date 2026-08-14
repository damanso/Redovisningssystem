// Relationsytan F6 — finputsen.
//
// Tre saker som var för sig ser kosmetiska ut och tillsammans avgör om ytan
// känns färdig eller halvbyggd:
//
//   Övergångar    — vyn är serverrenderad, och varje klick blänkte till vitt.
//                   En SPA löser det med JavaScript vi inte får ha. Webbläsaren
//                   löser det med två rader CSS.
//   Behållarfrågor — fönstret är inte det som avgör om ett kort får plats; det
//                   gör spalten kortet ligger i. En layout som frågar fönstret
//                   gissar.
//   Tomma tillstånd — ett tomt tillstånd utan nästa steg är en återvändsgränd.
//
// Testerna vaktar att de finns kvar, och framför allt att ingenting av det
// kostade oss JS-friheten.
import supertest from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { api, app, createCompany, registerUser, type TestUser } from './helpers.js';

const PASSWORD = 'mycket-hemligt-losen-123';
let user: TestUser;
let companyId: string;
let ua: ReturnType<typeof supertest.agent>;
const auth = () => ({ Authorization: `Bearer ${user.token}` });
const act = (name: string, body: Record<string, unknown> = {}) =>
  api.post(`/api/companies/${companyId}/actions/${name}`).set(auth()).send(body);

const SIDOR = ['', 'idag', 'relations', 'commitments', 'approvals', 'sok'] as const;

beforeAll(async () => {
  user = await registerUser('finish');
  companyId = await createCompany(user.token, 'Locollabs AB');
  ua = supertest.agent(app);
  await ua.post('/app/login').type('form').send({ email: user.email, password: PASSWORD });
});

describe('övergångar utan en rad JavaScript', () => {
  it('sidbytet är animerat av webbläsaren, inte av ett skript', async () => {
    const res = await ua.get(`/app/c/${companyId}/idag`);
    expect(res.text).toContain('@view-transition');
    expect(res.text).toContain('navigation: auto');
    // Sidhuvudet står still medan innehållet växlar — det är hela skillnaden
    // mellan "sidan laddades om" och "jag gick vidare".
    expect(res.text).toContain('view-transition-name: topbar');
    expect(res.text).not.toContain('<script');
  });

  it('rörelse går att stänga av — och det gäller övergångarna också', async () => {
    const res = await ua.get(`/app/c/${companyId}/idag`);
    const block = res.text.slice(res.text.indexOf('prefers-reduced-motion'));
    expect(block).toContain('::view-transition-group(*)');
    expect(block).toContain('animation: none');
  });
});

describe('layouten frågar sin behållare, inte fönstret', () => {
  it('innehållsytan är en container och relationssidan bryter mot den', async () => {
    const res = await ua.get(`/app/c/${companyId}/relations`);
    expect(res.text).toContain('container-type: inline-size');
    expect(res.text).toContain('@container sida (min-width: 820px)');
    // Dagsytan är den sida som faktiskt öppnas på telefon: knapparna ska ta
    // hela bredden i en smal spalt, inte bli 40 px breda för att det blev över.
    expect(res.text).toContain('@container sida (max-width: 420px)');
  });
});

describe('inget tomt tillstånd är en återvändsgränd', () => {
  it('tom relationslista pekar på nästa steg OCH har formuläret på plats', async () => {
    const res = await ua.get(`/app/c/${companyId}/relations`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Inga relationer ännu');
    expect(res.text).toContain('lägger du upp den första nedan');
    expect(res.text).toContain('Ny relation');
    expect(res.text, 'ett åtgärdsförslag som är ett funktionsnamn hjälper ingen')
      .not.toContain('upsert_crm_organization');
  });

  it('tom åtagandelista leder vidare i stället för att bara konstatera', async () => {
    const res = await ua.get(`/app/c/${companyId}/commitments`);
    expect(res.text).toContain('Inga åtaganden här');
    expect(res.text).toContain(`href="/app/c/${companyId}/idag"`);
  });

  it('tom söksida säger vad som saknas', async () => {
    const res = await ua.get(`/app/c/${companyId}/sok?q=x`);
    expect(res.text).toContain('Skriv minst två tecken');
  });
});

describe('relationen går att skapa för hand — utan AI och utan API-kontrakt', () => {
  it('formuläret skapar relationen och den dyker upp i listan', async () => {
    const res = await ua.post(`/app/c/${companyId}/relations/create`).type('form')
      .send({ name: 'Handlagda Bolaget AB', org_number: '556000-8888' });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`/app/c/${companyId}/relations`);

    const lista = await ua.get(`/app/c/${companyId}/relations`);
    expect(lista.text).toContain('Handlagda Bolaget AB');
    expect(lista.text).not.toContain('Inga relationer ännu');
  });

  it('det som skapats för hand räknas som ett beslut, inte som en gissning', async () => {
    const org = (await act('list_crm_organizations', {})).body.result
      .find((o: { name: string }) => o.name === 'Handlagda Bolaget AB');
    const full = await act('get_crm_organization', { organization_id: org.id });
    expect(full.body.result.provenance.org_number.source).toBe('human');
  });

  it('ett tomt namn ger en läsbar notis, inte en naken felsida', async () => {
    const res = await ua.post(`/app/c/${companyId}/relations/create`).type('form').send({ name: '   ' });
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('fel=');
  });
});

describe('hela ytan är fortfarande JS-fri', () => {
  it('ingen sida i relationsdelen smyger in ett skript', async () => {
    for (const sida of SIDOR) {
      const res = await ua.get(`/app/c/${companyId}/${sida}`);
      expect(res.status, `sidan "${sida}" svarade ${res.status}`).toBe(200);
      expect(res.text, `sidan "${sida}" innehåller ett skript`).not.toContain('<script');
      expect(res.text, `sidan "${sida}" har en inline-hanterare`).not.toContain('onclick=');
    }
  });
});
