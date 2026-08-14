// Granskningsfixar på Relationsytan F1–F6, före produktion.
//
// Varje test här motsvarar ETT fynd ur granskningen. De ligger samlade i en
// egen fil av samma skäl som förra omgångens: en fix utan ett test som faller
// utan den är ingen fix, den är en förhoppning.
import supertest from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { api, app, createCompany, registerUser, withAdmin, type TestUser } from './helpers.js';

const PASSWORD = 'mycket-hemligt-losen-123';
let user: TestUser;
let companyId: string;
let agentToken: string;
let ua: ReturnType<typeof supertest.agent>;
const auth = () => ({ Authorization: `Bearer ${user.token}` });
const co = () => `/api/companies/${companyId}`;
const act = (name: string, body: Record<string, unknown> = {}) =>
  api.post(`${co()}/actions/${name}`).set(auth()).send(body);
const agentAct = (name: string, body: Record<string, unknown> = {}) =>
  api.post(`${co()}/actions/${name}`).set({ Authorization: `Bearer ${agentToken}` }).send(body);

async function nyOrg(namn: string): Promise<string> {
  const r = await act('upsert_crm_organization', { name: namn });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body.result.id as string;
}

beforeAll(async () => {
  user = await registerUser('granskning6');
  companyId = await createCompany(user.token, 'Locollabs AB');
  // Ett agent-token: samma behörighet, ANNAT sanningsanspråk.
  const t = await api.post(`${co()}/agent-tokens`).set(auth()).send({ name: 'synk' });
  expect(t.status, JSON.stringify(t.body)).toBe(201);
  agentToken = t.body.token;
  ua = supertest.agent(app);
  await ua.post('/app/login').type('form').send({ email: user.email, password: PASSWORD });
});

describe('F4: AI:t kan inte stämpla sin egen gissning som ett människobeslut', () => {
  it('confirm_crm_value avvisas för en agent', async () => {
    const org = await nyOrg('Agentbolaget AB');
    const res = await agentAct('confirm_crm_value', { organization_id: org, field: 'name' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('human_confirmation_required');

    const full = await act('get_crm_organization', { organization_id: org });
    expect(full.body.result.provenance.name.source, 'ursprunget ska stå orört').toBe('human');
  });

  it('en agents skrivning märks som gissning, inte som beslut', async () => {
    const res = await agentAct('upsert_crm_organization', { name: 'Gissade Bolaget AB', org_number: '556000-1111' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const full = await act('get_crm_organization', { organization_id: res.body.result.id });
    expect(full.body.result.provenance.org_number.source).toBe('ai');
  });
});

describe('tråden: en gäst i adressfältet får inte fälla sidan', () => {
  it('?visa=constructor ger relationssidan, inte ett 500', async () => {
    const org = await nyOrg('Trådbolaget AB');
    for (const visa of ['constructor', '__proto__', 'toString', 'nonsens']) {
      const res = await ua.get(`/app/c/${companyId}/relations/${org}?visa=${encodeURIComponent(visa)}`);
      expect(res.status, `?visa=${visa} svarade ${res.status}`).toBe(200);
      expect(res.text).toContain('Trådbolaget AB');
    }
  });
});

describe('dagsytan är kapad i BÅDA högarna', () => {
  it('tolv förfallna löften ger fem kort, inte tolv', async () => {
    const org = await nyOrg('Löftesberget AB');
    const idag = new Date().toISOString().slice(0, 10);
    for (let i = 1; i <= 12; i += 1) {
      const r = await act('record_crm_commitment', {
        organization_id: org, direction: 'we_owe', body: `Löfte nummer ${i}.`,
        due_date: idag, occurred_at: '2026-08-01T09:00:00Z', source_system: 'manual',
      });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
    }

    const t = await act('crm_today', {});
    expect(t.status, JSON.stringify(t.body)).toBe(200);
    expect(t.body.result.commitments, 'kapet gäller båda högarna — 12 rader är en anklagelse')
      .toHaveLength(5);

    // Alla tolv finns kvar i systemet; det är bara DAGEN som är kapad.
    const alla = (await act('list_crm_commitments', { status: 'open' })).body.result;
    expect(alla.length).toBeGreaterThanOrEqual(12);
  });
});

describe('tystnadsrapporten beskriver den gräns den faktiskt använde', () => {
  it('varje rad bär sin egen tröskel', async () => {
    const org = await nyOrg('Tröskelbolaget AB');
    await act('record_crm_interaction', {
      organization_id: org, occurred_at: new Date(Date.now() - 200 * 86_400_000).toISOString(),
      channel: 'email', direction: 'outbound', summary: 'Gammalt.', source_system: 'manual',
    });
    await act('set_crm_relation_nudge', { organization_id: org, cadence_days: 180 });

    const r = await act('crm_silence_report', {});
    const rad = r.body.result.rows.find((x: { organization_id: string }) => x.organization_id === org);
    expect(rad.threshold_days, 'inte bolagets 30 — radens egna 180').toBe(180);
    expect(r.body.result.silence_days, 'standarden redovisas fortfarande, som standard').toBe(30);
  });
});

describe('inget handgrepp misslyckas i tysthet', () => {
  it('ett fel från relationslistans formulär syns på sidan', async () => {
    const res = await ua.post(`/app/c/${companyId}/relations/create`).type('form').send({ name: '  ' });
    expect(res.status).toBe(302);
    const sida = await ua.get(res.headers.location!);
    // Utan felNotis på just DEN här sidan hamnade ?fel= i adressfältet och
    // ingenting mer — formuläret såg ut att inte ha gjort någonting alls.
    expect(sida.text, 'notisen måste renderas, annars såg klicket ut som ingenting')
      .toContain('class="notice"');
    expect(sida.text).toContain('gick inte att spara');
  });

  it('ett fel från åtagandelistans handgrepp syns också', async () => {
    const sida = await ua.get(`/app/c/${companyId}/commitments?fel=Kunde+inte+utf%C3%B6ras`);
    expect(sida.status).toBe(200);
    expect(sida.text).toContain('class="notice"');
    expect(sida.text).toContain('Kunde inte utföras');
  });

  it('en orimlig kadens avvisas i stället för att radera den som fanns', async () => {
    const org = await nyOrg('Kadensbolaget AB');
    await act('set_crm_relation_nudge', { organization_id: org, cadence_days: 60 });

    const res = await ua.post(`/app/c/${companyId}/relations/${org}/cadence`).type('form')
      .send({ cadence_days: '5000' });
    expect(res.status).toBe(302);
    expect(decodeURIComponent(res.headers.location!)).toContain('fel=');

    const rad = await withAdmin(async (a) => (await a.query(
      'SELECT cadence_days FROM crm.organizations WHERE id = $1', [org])).rows[0]);
    expect(rad.cadence_days, 'den kadens som fanns ska stå kvar').toBe(60);
  });
});

describe('en arkiverad relation är inte en tom relation', () => {
  it('kortet visar sina egna tal och sin kadens', async () => {
    const org = await nyOrg('Arkiverade Bolaget AB');
    await act('set_crm_relation_nudge', { organization_id: org, cadence_days: 45 });
    await act('record_crm_interaction', {
      organization_id: org, occurred_at: '2026-06-01T09:00:00Z', channel: 'email',
      direction: 'outbound', summary: 'Sista kontakten.', source_system: 'manual',
    });
    const a = await act('upsert_crm_organization', { organization_id: org, name: 'Arkiverade Bolaget AB', status: 'archived' });
    expect(a.status, JSON.stringify(a.body)).toBe(200);

    const res = await ua.get(`/app/c/${companyId}/relations/${org}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('2026-06-01');
    // Kadensfältet är förifyllt — annars raderar ett tryck på Spara den.
    expect(res.text).toMatch(/name="cadence_days"[^>]*value="45"/);

    // Listan visar den fortfarande INTE — det är två olika frågor.
    const lista = await ua.get(`/app/c/${companyId}/relations`);
    expect(lista.text).not.toContain('Arkiverade Bolaget AB');
  });

  it('en arkiverad dubblett går fortfarande att slå ihop bort', async () => {
    const kvar = await nyOrg('Sammanslagningsmålet AB');
    const res = await ua.get(`/app/c/${companyId}/relations/${kvar}`);
    expect(res.text, 'arkiverade relationer måste finnas i väljaren').toContain('Arkiverade Bolaget AB');
  });
});

describe('dämpningen går att ångra', () => {
  it('en tystad relation visar sitt läge och kan tystas upp igen', async () => {
    const org = await nyOrg('Ångerbolaget AB');
    await ua.post(`/app/c/${companyId}/relations/${org}/mute`).type('form').send({ muted: 'true' });

    const tyst = await ua.get(`/app/c/${companyId}/relations/${org}`);
    expect(tyst.text).toContain('Tystad');
    expect(tyst.text).toContain('Föreslå igen');

    const res = await ua.post(`/app/c/${companyId}/relations/${org}/mute`).type('form').send({ muted: 'false' });
    expect(res.status).toBe(302);
    const rad = await withAdmin(async (a) => (await a.query(
      'SELECT muted FROM crm.organizations WHERE id = $1', [org])).rows[0]);
    expect(rad.muted).toBe(false);
  });
});

describe('sökträffen på en person öppnar hennes relation', () => {
  it('länken går till organisationen, inte till en ofiltrerad lista', async () => {
    const org = await nyOrg('Sökbolaget AB');
    await act('upsert_crm_person', { name: 'Petra Sök', email: 'petra@sok.example', organization_id: org });

    const res = await ua.get(`/app/c/${companyId}/sok?q=Petra`);
    expect(res.status).toBe(200);
    expect(res.text).toContain(`href="/app/c/${companyId}/relations/${org}"`);
    expect(res.text).not.toContain('?person=');
  });
});

describe('GDPR: ursprunget överlever inte den radering det pekar på', () => {
  it('raderingen tar bort organisationens ursprungsrader', async () => {
    const cust = await api.post(`${co()}/customers`).set(auth())
      .send({ name: 'Raderingskunden AB', org_number: '556000-7777' });
    expect(cust.status).toBe(201);
    const ingest = await act('ingest_crm_events', {
      events: [{
        kind: 'interaction',
        organization: { name: 'Raderingskunden AB', org_number: '556000-7777' },
        person: { name: 'Rune Radering', email: 'rune@rad.example' },
        occurred_at: '2026-06-10T09:00:00Z', channel: 'email', direction: 'inbound',
        summary: 'Ett mail.', source_system: 'gmail', source_ref: 'gmail:radering-1',
      }],
    });
    expect(ingest.status, JSON.stringify(ingest.body)).toBe(200);

    const org = (await act('list_crm_organizations', {})).body.result
      .find((o: { name: string }) => o.name === 'Raderingskunden AB');
    const fore = await withAdmin(async (a) => (await a.query(
      'SELECT count(*)::int AS n FROM crm.field_provenance WHERE organization_id = $1', [org.id])).rows[0].n);
    expect(fore, 'synken satte ursprung med källhänvisning').toBeGreaterThan(0);

    const req = await act('anonymize_party', { party_type: 'customer', party_id: cust.body.customer.id });
    expect(req.status).toBe(202);
    const ok = await api.post(`${co()}/approvals/${req.body.approval.id}/approve`).set(auth()).send({});
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);

    const efter = await withAdmin(async (a) => (await a.query(
      'SELECT count(*)::int AS n FROM crm.field_provenance WHERE organization_id = $1', [org.id])).rows[0].n);
    expect(efter, 'organisationsraden behålls (bokföringslagen) — men inte pekarna till de raderade mailen').toBe(0);
  });

  it('gallringen rensar källhänvisningar till det som gallrats bort', async () => {
    const org = await nyOrg('Gallringsbolaget AB');
    await act('ingest_crm_events', {
      events: [{
        kind: 'interaction', organization: { name: 'Gallringsbolaget AB', website: 'https://gallring.example' },
        occurred_at: '2020-01-15T09:00:00Z', channel: 'email', direction: 'inbound',
        summary: 'Gammalt mail.', source_system: 'gmail', source_ref: 'gmail:gammal-1',
      }],
    });
    void org;

    const id = (await act('list_crm_organizations', {})).body.result
      .find((o: { name: string }) => o.name === 'Gallringsbolaget AB').id;
    const fore = await withAdmin(async (a) => (await a.query(
      `SELECT source_ref FROM crm.field_provenance WHERE organization_id = $1 AND field = 'website'`, [id])).rows[0]);
    expect(fore.source_ref).toBe('gmail:gammal-1');

    const p = await act('purge_crm_data', { older_than_months: 12 });
    expect(p.status, JSON.stringify(p.body)).toBe(202);
    const ok = await api.post(`${co()}/approvals/${p.body.approval.id}/approve`).set(auth()).send({});
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.result.source_refs_cleared).toBeGreaterThan(0);

    const efter = await withAdmin(async (a) => (await a.query(
      `SELECT source_ref, source FROM crm.field_provenance WHERE organization_id = $1 AND field = 'website'`, [id])).rows[0]);
    expect(efter.source_ref, 'pekaren till det gallrade mailet är borta').toBeNull();
    expect(efter.source, 'klassificeringen beskriver värdet som står kvar och behålls').toBe('sync');
  });
});
