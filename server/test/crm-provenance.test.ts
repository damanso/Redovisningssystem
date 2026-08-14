// Relationsytan F4 — ursprung och kvitton.
//
// Premissen i designen är att AI:t är den huvudsakliga inmatningen. Då uppstår
// ett problem som inte finns i ett CRM där allt knappas in: samma ruta kan
// innehålla ett faktum ur bokföringen, ett beslut av en människa eller en
// gissning ur en mailsignatur — och de ser identiska ut.
//
// Testerna mäter tre saker, i stigande ordning av betydelse:
//   1. att ursprunget faktiskt registreras per fält,
//   2. att MÄNNISKAN VINNER — en synk skriver aldrig över ett människobeslut,
//   3. att filtreringen inte sker i tysthet.
//
// (2) är hela poängen. Utan den är märkningen dekoration: man rättar
// organisationsnumret, nästa synkkörning sätter tillbaka gissningen, och
// ingenting säger till.
import supertest from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { api, app, createCompany, createFiscalYear, registerUser, withAdmin, type TestUser } from './helpers.js';

const PASSWORD = 'mycket-hemligt-losen-123';
let user: TestUser;
let companyId: string;
let ua: ReturnType<typeof supertest.agent>;
const auth = () => ({ Authorization: `Bearer ${user.token}` });
const co = () => `/api/companies/${companyId}`;
const act = (name: string, body: Record<string, unknown> = {}) =>
  api.post(`${co()}/actions/${name}`).set(auth()).send(body);

interface Prov { source: string; reason: string | null; source_system: string | null }
const ursprung = async (orgId: string): Promise<Record<string, Prov>> =>
  (await act('get_crm_organization', { organization_id: orgId })).body.result.provenance;

const orgIdFor = async (namn: string): Promise<string> =>
  (await act('list_crm_organizations', {})).body.result.find((o: { name: string }) => o.name === namn).id;

/** Samma väg som en nattlig synk: ingest med ett externt källsystem. */
async function synka(events: Record<string, unknown>[]): Promise<Record<string, unknown>> {
  const r = await act('ingest_crm_events', { events });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body.result;
}

const mail = (org: Record<string, unknown>, person?: Record<string, unknown>) => ({
  kind: 'interaction', organization: org, ...(person ? { person } : {}),
  occurred_at: '2026-06-10T09:14:00Z', channel: 'email', direction: 'inbound',
  summary: 'Om pilotens omfattning.', source_system: 'gmail', source_ref: `gmail:${Math.random()}`,
});

beforeAll(async () => {
  user = await registerUser('ursprung');
  companyId = await createCompany(user.token, 'Locollabs AB');
  ua = supertest.agent(app);
  await ua.post('/app/login').type('form').send({ email: user.email, password: PASSWORD });
});

describe('tre sorters påstående, tre sorters märkning', () => {
  it('synkens uppgifter märks som hämtade, inte som beslutade', async () => {
    await synka([mail({ name: 'Synkade Bolaget AB', org_number: '556000-1111', website: 'https://synk.example' })]);
    const p = await ursprung(await orgIdFor('Synkade Bolaget AB'));

    expect(p.org_number.source).toBe('sync');
    expect(p.org_number.source_system).toBe('gmail');
    expect(p.website.source).toBe('sync');
  });

  it('en människas skrivning är ett beslut', async () => {
    const r = await act('upsert_crm_organization', { name: 'Handskrivna AB', org_number: '556000-2222' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const p = await ursprung(r.body.result.id);
    expect(p.org_number.source, 'API-token utan agent-aktör är en människa').toBe('human');
  });

  it('kundkopplingen märks som härledd ur bokföringen — med skälet', async () => {
    const cust = await api.post(`${co()}/customers`).set(auth())
      .send({ name: 'Kopplade Kunden AB', org_number: '556000-3333' });
    expect(cust.status).toBe(201);

    await synka([mail({ name: 'Kopplade Kunden AB', org_number: '556000-3333' })]);
    const orgId = await orgIdFor('Kopplade Kunden AB');
    const p = await ursprung(orgId);

    expect(p.customer_id.source, 'uppslaget är ingen bedömning — det är en jämförelse').toBe('accounting');
    expect(p.customer_id.reason).toBe('matchad på organisationsnummer');
  });
});

describe('människan vinner — annars är märkningen bara dekoration', () => {
  it('synken skriver INTE över ett organisationsnummer en människa rättat', async () => {
    // Synken gissar fel ur en mailsignatur.
    await synka([mail({ name: 'Rättade Bolaget AB', org_number: '556000-9999' })]);
    const orgId = await orgIdFor('Rättade Bolaget AB');

    // Människan rättar i vyn.
    const fix = await ua.post(`/app/c/${companyId}/relations/${orgId}/edit`).type('form')
      .send({ name: 'Rättade Bolaget AB', org_number: '556000-4444' });
    expect(fix.status).toBe(302);
    expect((await ursprung(orgId)).org_number.source).toBe('human');

    // Synken kör igen med sin gamla gissning.
    const res = await synka([mail({ name: 'Rättade Bolaget AB', org_number: '556000-9999' })]);

    const rad = await withAdmin(async (a) => (await a.query(
      'SELECT org_number FROM crm.organizations WHERE id = $1', [orgId])).rows[0]);
    expect(rad.org_number, 'det rättade värdet ska stå kvar').toBe('556000-4444');
    // ...och det ska INTE ha skett i tysthet.
    expect(res.kept_human_fields).toContain('Rättade Bolaget AB: org_number');
  });

  it('ett fält människan inte rört uppdateras fortfarande', async () => {
    const orgId = await orgIdFor('Rättade Bolaget AB');
    await synka([mail({ name: 'Rättade Bolaget AB', website: 'https://ny.example' })]);
    const rad = await withAdmin(async (a) => (await a.query(
      'SELECT website FROM crm.organizations WHERE id = $1', [orgId])).rows[0]);
    expect(rad.website, 'skyddet gäller fältet, inte hela raden').toBe('https://ny.example');
  });

  it('"Stämmer" gör en gissning till ett beslut — ett klick, ingen AI', async () => {
    await synka([mail({ name: 'Bekräftade Bolaget AB', org_number: '556000-5555' })]);
    const orgId = await orgIdFor('Bekräftade Bolaget AB');
    expect((await ursprung(orgId)).org_number.source).toBe('sync');

    const res = await ua.post(`/app/c/${companyId}/relations/${orgId}/confirm`).type('form')
      .send({ field: 'org_number' });
    expect(res.status).toBe(302);

    const p = await ursprung(orgId);
    expect(p.org_number.source).toBe('human');
    expect(p.org_number.reason).toBe('bekräftad av människa');

    // Och därefter biter synken inte på det.
    await synka([mail({ name: 'Bekräftade Bolaget AB', org_number: '556000-0000' })]);
    const rad = await withAdmin(async (a) => (await a.query(
      'SELECT org_number FROM crm.organizations WHERE id = $1', [orgId])).rows[0]);
    expect(rad.org_number).toBe('556000-5555');
  });

  it('skyddet gäller personer också — en rättad titel överlever synken', async () => {
    await synka([mail({ name: 'Personbolaget AB' }, { name: 'Eva Larsson', email: 'eva@person.example', role_title: 'Inköp' })]);
    const person = (await act('list_crm_people', {})).body.result
      .find((p: { email: string }) => p.email === 'eva@person.example');

    const r = await act('upsert_crm_person', { name: 'Eva Larsson', email: 'eva@person.example', role_title: 'Inköpschef' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);

    await synka([mail({ name: 'Personbolaget AB' }, { name: 'Eva Larsson', email: 'eva@person.example', role_title: 'Inköp' })]);
    const rad = await withAdmin(async (a) => (await a.query(
      'SELECT role_title FROM crm.people WHERE id = $1', [person.id])).rows[0]);
    expect(rad.role_title).toBe('Inköpschef');
  });
});

describe('rättning för hand är ett riktigt handgrepp', () => {
  it('namnet går att rätta utan att en ny organisation dyker upp bredvid', async () => {
    const r = await act('upsert_crm_organization', { name: 'Felstavade Bolgaet AB' });
    const orgId = r.body.result.id;

    const fix = await ua.post(`/app/c/${companyId}/relations/${orgId}/edit`).type('form')
      .send({ name: 'Felstavade Bolaget AB', status: 'prospect' });
    expect(fix.status).toBe(302);

    const alla = (await act('list_crm_organizations', {})).body.result.map((o: { name: string }) => o.name);
    expect(alla).toContain('Felstavade Bolaget AB');
    expect(alla, 'den gamla stavningen ska vara borta, inte kvar som dubblett').not.toContain('Felstavade Bolgaet AB');
  });

  it('ett namn som redan finns pekar mot sammanslagning i stället för att krascha', async () => {
    await act('upsert_crm_organization', { name: 'Krockande Ett AB' });
    const tva = await act('upsert_crm_organization', { name: 'Krockande Två AB' });

    const res = await ua.post(`/app/c/${companyId}/relations/${tva.body.result.id}/edit`).type('form')
      .send({ name: 'Krockande Ett AB' });
    expect(res.status).toBe(302);
    expect(decodeURIComponent(res.headers.location)).toContain('slå ihop');
  });
});

describe('relationssidan visar ursprunget utan att skrika', () => {
  it('gissningen märks och kan bekräftas, beslutet står omärkt', async () => {
    await synka([mail({ name: 'Visade Bolaget AB', org_number: '556000-7777' })]);
    const orgId = await orgIdFor('Visade Bolaget AB');

    const res = await ua.get(`/app/c/${companyId}/relations/${orgId}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Uppgifter');
    expect(res.text).toContain('prov--guess');
    expect(res.text).toContain('Stämmer');
    expect(res.text).toContain('Rätta uppgifter');
    expect(res.text).not.toContain('<script');

    // Märket sitter PER FÄLT: efter bekräftelsen försvinner ett märke, inte
    // alla. Namnet kom också från synken och är fortfarande obekräftat — det
    // ska det synas att det är.
    const fore = (res.text.match(/prov--guess/g) ?? []).length;
    expect(fore).toBeGreaterThan(1);

    await ua.post(`/app/c/${companyId}/relations/${orgId}/confirm`).type('form').send({ field: 'org_number' });
    const efter = await ua.get(`/app/c/${companyId}/relations/${orgId}`);
    expect((efter.text.match(/prov--guess/g) ?? []).length).toBe(fore - 1);
    expect(efter.text, 'namnet är fortfarande synkens ord').toContain('prov--guess');
  });

  it('en kundkoppling visas som faktum, inte som gissning', async () => {
    const orgId = await orgIdFor('Kopplade Kunden AB');
    const res = await ua.get(`/app/c/${companyId}/relations/${orgId}`);
    expect(res.text).toContain('prov--fact');
    expect(res.text).toContain('ur bokföringen');
  });
});

describe('kvittot: ett avgjort förslag försvinner inte spårlöst', () => {
  it('godkänd åtgärd hamnar i "Nyss avgjort" med vad den gällde', async () => {
    await createFiscalYear(companyId, auth(), { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });
    const cust = await api.post(`${co()}/customers`).set(auth()).send({ name: 'Kvittokunden AB' });
    const inv = await act('create_invoice', {
      customer_id: cust.body.customer.id, invoice_date: '2026-06-30', due_date: '2026-07-20',
      lines: [{ description: 'Arbete', quantity: 1, unit: 'st', unit_price_ore: 100_000, vat_rate: 25 }],
    });
    const book = await act('book_invoice', { invoice_id: inv.body.result.id });
    expect(book.status).toBe(202);

    const tom = await ua.get(`/app/c/${companyId}/approvals`);
    expect(tom.text, 'inget avgjort ännu').not.toContain('Nyss avgjort');

    const ok = await ua.post(`/app/c/${companyId}/approvals/${book.body.approval.id}/approve`).type('form').send({});
    expect(ok.status).toBe(302);

    const res = await ua.get(`/app/c/${companyId}/approvals`);
    expect(res.text).toContain('Nyss avgjort');
    expect(res.text).toContain('Bokför faktura');
    expect(res.text).toContain('Kvittokunden AB');
    expect(res.text).toContain('revisionsloggen');
  });

  it('avvisat syns också — annars vet man inte att man avvisade', async () => {
    const cust = (await act('list_customers', {})).body.result
      .find((c: { name: string }) => c.name === 'Kvittokunden AB');
    const inv = await act('create_invoice', {
      customer_id: cust.id, invoice_date: '2026-07-01', due_date: '2026-07-21',
      lines: [{ description: 'Fel underlag', quantity: 1, unit: 'st', unit_price_ore: 50_000, vat_rate: 25 }],
    });
    const book = await act('book_invoice', { invoice_id: inv.body.result.id });
    await ua.post(`/app/c/${companyId}/approvals/${book.body.approval.id}/reject`).type('form').send({});

    const res = await ua.get(`/app/c/${companyId}/approvals`);
    expect(res.text).toContain('Avvisad');
  });
});
