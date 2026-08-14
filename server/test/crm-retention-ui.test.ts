// Gallringen som handgrepp.
//
// Perioden styr det enda i hela relationsdelen som får data att FÖRSVINNA, och
// den gick tidigare bara att sätta via AI eller API. Det är samma strukturella
// brist som resten av ombyggnaden handlade om: ett handgrepp utan knapp.
//
// Två saker testerna låser fast, båda för att de är lätta att tappa:
//   1. gallring körs ALDRIG på en gissad period,
//   2. själva raderingen går genom godkännandekön — ett klick raderar ingenting.
import supertest from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { api, app, createCompany, registerUser, withAdmin, type TestUser } from './helpers.js';

const PASSWORD = 'mycket-hemligt-losen-123';
let user: TestUser;
let companyId: string;
let ua: ReturnType<typeof supertest.agent>;
const auth = () => ({ Authorization: `Bearer ${user.token}` });
const co = () => `/api/companies/${companyId}`;
const act = (name: string, body: Record<string, unknown> = {}) =>
  api.post(`${co()}/actions/${name}`).set(auth()).send(body);

const period = async (): Promise<number | null> =>
  (await act('get_crm_retention', {})).body.result.retention_months;

beforeAll(async () => {
  user = await registerUser('gallring');
  companyId = await createCompany(user.token, 'Locollabs AB');
  ua = supertest.agent(app);
  await ua.post('/app/login').type('form').send({ email: user.email, password: PASSWORD });
});

describe('perioden går att sätta i vyn — ingen AI, inget API', () => {
  it('utan period säger sidan det rakt ut och gallringsknappen är spärrad', async () => {
    const res = await ua.get(`/app/c/${companyId}/relations`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Gallring av relationsdata');
    expect(res.text).toContain('Ingen period satt');
    expect(res.text).toMatch(/Gallra nu…<\/button>/);
    expect(res.text, 'utan period får knappen inte gå att trycka på').toMatch(/disabled[^>]*>Gallra nu/);
  });

  it('sju år sparas och visas som både månader och år', async () => {
    const res = await ua.post(`/app/c/${companyId}/relations/retention`).type('form')
      .send({ retention_months: '84' });
    expect(res.status).toBe(302);
    expect(await period()).toBe(84);

    const sida = await ua.get(`/app/c/${companyId}/relations`);
    expect(sida.text, '"84" säger en människa ingenting').toContain('84 månader (7 år)');
    expect(sida.text).not.toContain('Ingen period satt');
  });

  it('en udda period skrivs ut med både år och månader', async () => {
    await ua.post(`/app/c/${companyId}/relations/retention`).type('form').send({ retention_months: '18' });
    const sida = await ua.get(`/app/c/${companyId}/relations`);
    expect(sida.text).toContain('18 månader (1 år 6 mån)');
  });

  it('ett ogiltigt tal avvisas synligt i stället för att stänga av gallringen', async () => {
    await ua.post(`/app/c/${companyId}/relations/retention`).type('form').send({ retention_months: '84' });
    const res = await ua.post(`/app/c/${companyId}/relations/retention`).type('form')
      .send({ retention_months: '999' });
    expect(res.status).toBe(302);

    const sida = await ua.get(res.headers.location!);
    expect(sida.text).toContain('class="notice"');
    expect(await period(), 'den period som fanns ska stå kvar').toBe(84);
  });

  it('tomt fält stänger av gallringen — det är ett eget, avsiktligt val', async () => {
    const res = await ua.post(`/app/c/${companyId}/relations/retention`).type('form')
      .send({ retention_months: '' });
    expect(res.status).toBe(302);
    expect(await period()).toBeNull();
    await ua.post(`/app/c/${companyId}/relations/retention`).type('form').send({ retention_months: '84' });
  });
});

describe('ett klick raderar ingenting', () => {
  it('"Gallra nu" blir ett förslag i Att göra, inte en radering', async () => {
    // Ett gammalt mail som ligger utanför perioden.
    const org = await act('upsert_crm_organization', { name: 'Gallringskunden AB' });
    await act('record_crm_interaction', {
      organization_id: org.body.result.id, occurred_at: '2015-01-15T09:00:00Z',
      channel: 'email', direction: 'outbound', summary: 'Mycket gammalt.', source_system: 'manual',
    });

    const res = await ua.post(`/app/c/${companyId}/relations/purge`).type('form').send({});
    expect(res.status).toBe(302);
    expect(res.headers.location, 'känsliga åtgärder landar i kön').toBe(`/app/c/${companyId}/approvals`);

    const kvar = await withAdmin(async (a) => (await a.query(
      'SELECT count(*)::int AS n FROM crm.interactions WHERE company_id = $1', [companyId])).rows[0].n);
    expect(kvar, 'ingenting får ha raderats av klicket i sig').toBe(1);

    const ko = (await api.get(`${co()}/approvals?status=pending`).set(auth())).body.approvals;
    const forslag = ko.find((a: { action: string }) => a.action === 'purge_crm_data');
    expect(forslag, 'förslaget ska ligga i kön').toBeDefined();

    const ok = await api.post(`${co()}/approvals/${forslag.id}/approve`).set(auth()).send({});
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.result.older_than_months, 'perioden läses ur policyn, inte ur formuläret').toBe(84);
    expect(ok.body.result.interactions_deleted).toBe(1);
  });

  it('utan satt period vägrar gallringen i stället för att gissa', async () => {
    await act('set_crm_retention', { retention_months: null });
    const res = await act('purge_crm_data', {});
    expect(res.status).toBe(202);
    const godkann = await api.post(`${co()}/approvals/${res.body.approval.id}/approve`).set(auth()).send({});
    expect(godkann.status).toBe(400);
    expect(godkann.body.error).toBe('no_retention_period');
  });
});

describe('ytan är fortfarande JS-fri', () => {
  it('gallringskortet är riktiga formulär, inga skript', async () => {
    const res = await ua.get(`/app/c/${companyId}/relations`);
    expect(res.text).not.toContain('<script');
    expect(res.text).not.toContain('onclick=');
  });

  it('en POST utan eget ursprung avvisas', async () => {
    const res = await ua.post(`/app/c/${companyId}/relations/retention`)
      .set('Origin', 'https://angripare.example').type('form').send({ retention_months: '12' });
    expect(res.status).toBe(403);
  });
});
