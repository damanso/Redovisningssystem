// Relationsytan F2 — dagsytan.
//
// Designens viktigaste beslut sitter här och det är psykologiskt, inte
// tekniskt: listan är KAPAD och visar aldrig totalen. "412 kontakter
// försenade" förvandlar verktyget från assistent till anklagelse; en lista som
// kan nå noll skapar ett arbetspass med början och slut.
//
// Testerna mäter tre saker: att kapet håller, att uppskjutet och tystat
// faktiskt försvinner, och att sidan KAN bli tom.
import supertest from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { api, app, createCompany, registerUser, type TestUser } from './helpers.js';

const PASSWORD = 'mycket-hemligt-losen-123';
let user: TestUser;
let companyId: string;
let ua: ReturnType<typeof supertest.agent>;
const auth = () => ({ Authorization: `Bearer ${user.token}` });
const co = () => `/api/companies/${companyId}`;
const act = (name: string, body: Record<string, unknown> = {}) =>
  api.post(`${co()}/actions/${name}`).set(auth()).send(body);

async function tystRelation(namn: string): Promise<string> {
  const org = await act('upsert_crm_organization', { name: namn });
  expect(org.status, JSON.stringify(org.body)).toBe(200);
  return org.body.result.id as string;
}

beforeAll(async () => {
  user = await registerUser('idag');
  companyId = await createCompany(user.token, 'Locollabs AB');
  ua = supertest.agent(app);
  await ua.post('/app/login').type('form').send({ email: user.email, password: PASSWORD });
});

describe('dagsytan kan bli tom — det är hela poängen', () => {
  it('en tom dag säger att det är avbetat, inte att systemet är trasigt', async () => {
    const res = await ua.get(`/app/c/${companyId}/idag`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Avbetat för i dag');
    expect(res.text).toContain('Inget väntar');
  });
});

describe('kapet håller — totalen visas aldrig', () => {
  it('åtta tysta relationer ger fem kort, inte åtta och ingen totalsiffra', async () => {
    for (let i = 1; i <= 8; i += 1) await tystRelation(`Tyst Bolag ${i} AB`);

    const t = await act('crm_relation_state', {});
    expect(t.body.result).toHaveLength(8); // alla finns kvar i systemet...

    const res = await ua.get(`/app/c/${companyId}/idag`);
    expect(res.status).toBe(200);
    // ...men dagsytan visar fem.
    const kort = res.text.match(/class="today__card"/g) ?? [];
    expect(kort).toHaveLength(5);
    expect(res.text, 'ingen backlogg-siffra får läcka ut').not.toContain('8 saker');
    expect(res.text).toContain('dagens lista, inte alla relationer');
  });

  it('varje kort bär sitt skäl — skälet är både rangordning och öppningsreplik', async () => {
    const res = await ua.get(`/app/c/${companyId}/idag`);
    expect(res.text).toContain('ingen registrerad kontakt alls');
  });
});

describe('uppskjutet och tystat försvinner från dagen', () => {
  it('en uppskjuten relation lämnar dagsytan men finns kvar i listan', async () => {
    const id = await tystRelation('Uppskjutna Bolaget AB');
    // Gör den till dagens mest angelägna genom att den saknar kontakt helt.
    await ua.post(`/app/c/${companyId}/relations/${id}/snooze`).type('form').send({ days: '30' });

    const idag = await ua.get(`/app/c/${companyId}/idag`);
    expect(idag.text).not.toContain('Uppskjutna Bolaget AB');

    const alla = await ua.get(`/app/c/${companyId}/relations`);
    expect(alla.text, 'relationen finns kvar — den är bara tyst').toContain('Uppskjutna Bolaget AB');
  });

  it('en tystad relation föreslås aldrig igen', async () => {
    const id = await tystRelation('Tystade Bolaget AB');
    await ua.post(`/app/c/${companyId}/relations/${id}/mute`).type('form').send({ muted: 'true' });

    const idag = await ua.get(`/app/c/${companyId}/idag`);
    expect(idag.text).not.toContain('Tystade Bolaget AB');
    const alla = await ua.get(`/app/c/${companyId}/relations`);
    expect(alla.text).toContain('Tystade Bolaget AB');
  });
});

describe('löften som förfaller', () => {
  it('förfallna och nära förestående löften hamnar på dagen — avlägsna gör det inte', async () => {
    const org = await tystRelation('Löftesbolaget AB');
    const idag = new Date().toISOString().slice(0, 10);
    const langtFram = new Date(Date.now() + 90 * 86_400_000).toISOString().slice(0, 10);

    const nara = await act('record_crm_commitment', {
      organization_id: org, direction: 'we_owe', body: 'Skicka underlaget.',
      due_date: idag, occurred_at: '2026-08-01T09:00:00Z', source_system: 'manual',
    });
    expect(nara.status, JSON.stringify(nara.body)).toBe(200);
    await act('record_crm_commitment', {
      organization_id: org, direction: 'we_owe', body: 'Något långt fram i tiden.',
      due_date: langtFram, occurred_at: '2026-08-01T09:00:00Z', source_system: 'manual',
    });

    const res = await ua.get(`/app/c/${companyId}/idag`);
    expect(res.text).toContain('Skicka underlaget.');
    expect(res.text, 'horisonten är sju dagar — resten är inte dagens sak')
      .not.toContain('Något långt fram i tiden.');

    // Ett klick stänger löftet och det lämnar dagen.
    const klar = await ua.post(`/app/c/${companyId}/commitments/${nara.body.result.id}/done`)
      .type('form').send({ back: `/app/c/${companyId}/idag` });
    expect(klar.status).toBe(302);
    const efter = await ua.get(`/app/c/${companyId}/idag`);
    expect(efter.text).not.toContain('Skicka underlaget.');
  });

  it('ett uppskjutet löfte lämnar dagen utan att förfallodatumet ändras', async () => {
    const org = await tystRelation('Uppskjutna Löftet AB');
    const idag = new Date().toISOString().slice(0, 10);
    const c = await act('record_crm_commitment', {
      organization_id: org, direction: 'we_owe', body: 'Uppskjutet underlag.',
      due_date: idag, occurred_at: '2026-08-01T09:00:00Z', source_system: 'manual',
    });
    await ua.post(`/app/c/${companyId}/commitments/${c.body.result.id}/snooze`)
      .type('form').send({ days: '10' });

    const res = await ua.get(`/app/c/${companyId}/idag`);
    expect(res.text).not.toContain('Uppskjutet underlag.');

    const kvar = (await act('list_crm_commitments', { status: 'open' })).body.result
      .find((x: { id: string }) => x.id === c.body.result.id);
    expect(kvar.due_date, 'löftet är löftet').toBe(idag);
  });
});

describe('dagsytan är JS-fri och skickar ingenting', () => {
  it('inga skript, och spärren står utskriven', async () => {
    const res = await ua.get(`/app/c/${companyId}/idag`);
    expect(res.text).not.toContain('<script');
    expect(res.text).not.toContain('onclick=');
    expect(res.text).toContain('Ingenting går härifrån ut till en kund');
  });

  it('sidan ligger i snabbraden — den ska öppnas dagligen', async () => {
    const res = await ua.get(`/app/c/${companyId}/idag`);
    const nav = res.text.slice(res.text.indexOf('<nav class="nav"'), res.text.indexOf('</nav>'));
    expect(nav).toContain(`href="/app/c/${companyId}/idag"`);
  });
});
