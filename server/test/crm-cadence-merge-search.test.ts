// Relationsytan F5 — kadens, sammanslagning och sökning.
//
// De tre sakerna hänger ihop mer än de ser ut att göra: alla tre handlar om att
// ytan ska tåla verkligheten över tid.
//
//   Kadens      — en gemensam tystnadsgräns fyller dagsytan med brus, och en
//                 lista med brus i lär användaren att ignorera den.
//   Sammanslagning — dubbletter är ingen bugg i synken utan en följd av att data
//                 kommer från flera håll. Utan sammanslagning delas historiken,
//                 och kortet ser komplett ut fast hälften saknas.
//   Sökning     — man ska slippa VETA var något ligger.
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

async function nyOrg(namn: string): Promise<string> {
  const r = await act('upsert_crm_organization', { name: namn });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body.result.id as string;
}

/** Registrerar en kontaktpunkt så många dagar tillbaka i tiden. */
async function kontaktFor(orgId: string, dagarSedan: number): Promise<void> {
  const when = new Date(Date.now() - dagarSedan * 86_400_000).toISOString();
  const r = await act('record_crm_interaction', {
    organization_id: orgId, occurred_at: when, channel: 'email', direction: 'outbound',
    summary: 'Avstämning.', source_system: 'manual',
  });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
}

const forslag = async (): Promise<{ organization: string; reasons: string[] }[]> =>
  (await act('crm_contact_suggestions', {})).body.result.suggestions;

/** Godkänner ett känsligt förslag direkt — sammanslagning går genom kön. */
async function utfor(res: { status: number; body: { approval?: { id: string } } }): Promise<Record<string, unknown>> {
  expect(res.status, JSON.stringify(res.body)).toBe(202);
  const ok = await api.post(`${co()}/approvals/${res.body.approval!.id}/approve`).set(auth()).send({});
  expect(ok.status, JSON.stringify(ok.body)).toBe(200);
  return ok.body.result as Record<string, unknown>;
}

beforeAll(async () => {
  user = await registerUser('kadens');
  companyId = await createCompany(user.token, 'Locollabs AB');
  ua = supertest.agent(app);
  await ua.post('/app/login').type('form').send({ email: user.email, password: PASSWORD });
});

describe('kadens: en gemensam gräns passar ingen', () => {
  it('en relation med lång kadens tiger fast standarden hade knackat på', async () => {
    const org = await nyOrg('Sällankunden AB');
    await kontaktFor(org, 45); // över standardens 30 dagar

    expect((await forslag()).map((s) => s.organization), 'standarden vill höra av sig')
      .toContain('Sällankunden AB');

    const satt = await act('set_crm_relation_nudge', { organization_id: org, cadence_days: 180 });
    expect(satt.status, JSON.stringify(satt.body)).toBe(200);

    expect((await forslag()).map((s) => s.organization), 'kadensen är 180 dagar — 45 är ingenting')
      .not.toContain('Sällankunden AB');
  });

  it('en relation med kort kadens knackar på tidigare än standarden', async () => {
    const org = await nyOrg('Retainerkunden AB');
    await kontaktFor(org, 10); // under standardens 30 dagar

    expect((await forslag()).map((s) => s.organization)).not.toContain('Retainerkunden AB');

    await act('set_crm_relation_nudge', { organization_id: org, cadence_days: 7 });
    const s = (await forslag()).find((x) => x.organization === 'Retainerkunden AB');
    expect(s, 'sju dagars kadens och tio dagars tystnad').toBeDefined();
    expect(s!.reasons.join(' ')).toContain('kadensen är 7');
  });

  it('kadensen nollställs inte av inställningen — bara av kontakt', async () => {
    const org = await nyOrg('Klockkunden AB');
    await kontaktFor(org, 40);
    await act('set_crm_relation_nudge', { organization_id: org, cadence_days: 20 });

    const rad = (await act('crm_relation_state', {})).body.result
      .find((r: { organization_id: string }) => r.organization_id === org);
    expect(rad.days_silent, 'tystnaden räknas från kontakten, inte från inställningen').toBe(40);
  });

  it('tomt fält i vyn återgår till bolagets standard', async () => {
    const org = await nyOrg('Standardkunden AB');
    await act('set_crm_relation_nudge', { organization_id: org, cadence_days: 90 });

    const res = await ua.post(`/app/c/${companyId}/relations/${org}/cadence`).type('form').send({ cadence_days: '' });
    expect(res.status).toBe(302);

    const rad = await withAdmin(async (a) => (await a.query(
      'SELECT cadence_days FROM crm.organizations WHERE id = $1', [org])).rows[0]);
    expect(rad.cadence_days).toBeNull();
  });
});

describe('sammanslagning: ingenting kastas, tomma fält fylls', () => {
  it('flyttar historik och fyller luckor utan att skriva över', async () => {
    const behall = await act('upsert_crm_organization', { name: 'Nordic Vision Retail AB', org_number: '556000-1234' });
    const dubblett = await act('upsert_crm_organization', { name: 'Nordic Vision Retail', website: 'https://nvr.example' });
    const behallId = behall.body.result.id;
    const dubblettId = dubblett.body.result.id;

    await kontaktFor(dubblettId, 3);
    const person = await act('upsert_crm_person', { name: 'Eva Larsson', email: 'eva@nvr.example', organization_id: dubblettId });
    expect(person.status, JSON.stringify(person.body)).toBe(200);

    const r = await utfor(await act('merge_crm_organizations', { keep_id: behallId, merge_id: dubblettId }));
    expect(r.moved).toMatchObject({ people: 1, interactions: 1 });
    expect(r.filled_fields).toContain('website');

    const kvar = await act('get_crm_organization', { organization_id: behallId });
    expect(kvar.body.result.org_number, 'den ifyllda uppgiften rörs inte').toBe('556000-1234');
    expect(kvar.body.result.website, 'luckan fylls från dubbletten').toBe('https://nvr.example');
    expect(kvar.body.result.people).toHaveLength(1);
    expect(kvar.body.result.interactions).toHaveLength(1);

    const alla = (await act('list_crm_organizations', {})).body.result.map((o: { name: string }) => o.name);
    expect(alla).not.toContain('Nordic Vision Retail');
  });

  it('två OLIKA kunder är inte en dubblett — anropet avvisas', async () => {
    const a = await api.post(`${co()}/customers`).set(auth()).send({ name: 'Kund Ett AB' });
    const b = await api.post(`${co()}/customers`).set(auth()).send({ name: 'Kund Två AB' });
    const orgA = await act('upsert_crm_organization', { name: 'Org Ett AB', customer_id: a.body.customer.id });
    const orgB = await act('upsert_crm_organization', { name: 'Org Två AB', customer_id: b.body.customer.id });

    const res = await act('merge_crm_organizations', { keep_id: orgA.body.result.id, merge_id: orgB.body.result.id });
    expect(res.status).toBe(202);
    const godkann = await api.post(`${co()}/approvals/${res.body.approval.id}/approve`).set(auth()).send({});
    expect(godkann.status).toBe(400);
    expect(godkann.body.error).toBe('customer_conflict');

    // Ingenting fick hända: allt-eller-inget gäller även här.
    const alla = (await act('list_crm_organizations', {})).body.result.map((o: { name: string }) => o.name);
    expect(alla).toContain('Org Ett AB');
    expect(alla).toContain('Org Två AB');
  });

  it('kundkopplingen flyttar med när bara den ena har en', async () => {
    const cust = await api.post(`${co()}/customers`).set(auth()).send({ name: 'Flyttkunden AB' });
    const utan = await nyOrg('Flyttbolaget prospekt');
    const med = await act('upsert_crm_organization', { name: 'Flyttbolaget AB', customer_id: cust.body.customer.id });

    await utfor(await act('merge_crm_organizations', { keep_id: utan, merge_id: med.body.result.id }));

    const kvar = await act('get_crm_organization', { organization_id: utan });
    expect(kvar.body.result.customer_id).toBe(cust.body.customer.id);
    expect(kvar.body.result.status, 'prospektet blev kund i och med kopplingen').toBe('customer');
  });

  it('personer med olika e-post slås inte ihop', async () => {
    const org = await nyOrg('Personbolaget AB');
    const a = await act('upsert_crm_person', { name: 'Anna A', email: 'anna@a.example', organization_id: org });
    const b = await act('upsert_crm_person', { name: 'Anna B', email: 'anna@b.example', organization_id: org });

    const res = await act('merge_crm_people', { keep_id: a.body.result.id, merge_id: b.body.result.id });
    const godkann = await api.post(`${co()}/approvals/${res.body.approval.id}/approve`).set(auth()).send({});
    expect(godkann.status).toBe(400);
    expect(godkann.body.error).toBe('email_conflict');
  });

  it('en person kan inte slås ihop med sig själv', async () => {
    const org = await nyOrg('Självbolaget AB');
    const p = await act('upsert_crm_person', { name: 'Solo Person', organization_id: org });
    const res = await act('merge_crm_people', { keep_id: p.body.result.id, merge_id: p.body.result.id });
    const godkann = await api.post(`${co()}/approvals/${res.body.approval.id}/approve`).set(auth()).send({});
    expect(godkann.status).toBe(400);
  });

  it('kolliderande namnlösa personer slås ihop i stället för att fälla flytten', async () => {
    // Huvudfallet, inte ett kantfall: kalendern lägger upp "Karin Ek" utan
    // e-post på båda raderna. people_name_uk är unikt per organisation för
    // e-postlösa personer — en rak omflyttning hade fällt hela transaktionen.
    const behall = await nyOrg('Krockbolaget AB');
    const dubblett = await nyOrg('Krockbolaget');
    const a = await act('upsert_crm_person', { name: 'Karin Ek', organization_id: behall });
    const b = await act('upsert_crm_person', { name: 'Karin Ek', organization_id: dubblett });
    expect(a.body.result.id).not.toBe(b.body.result.id);

    const r = await utfor(await act('merge_crm_organizations', { keep_id: behall, merge_id: dubblett }));
    expect(r.moved).toMatchObject({ people: 1 });

    const kvar = await act('get_crm_organization', { organization_id: behall });
    expect(kvar.body.result.people).toHaveLength(1);
    expect(kvar.body.result.people[0].name).toBe('Karin Ek');
  });

  it('loggen bär id:n och antal — aldrig namnet på raden som försvann', async () => {
    const rad = await withAdmin(async (a) => (await a.query(
      `SELECT details FROM crm.audit_log
       WHERE company_id = $1 AND action = 'crm.organizations_merged'
       ORDER BY occurred_at LIMIT 1`,
      [companyId])).rows[0]);
    expect(rad.details.merged_id, 'spåret ska finnas').toBeTruthy();
    // crm.audit_log är append-only och nås varken av GDPR-raderingen eller av
    // gallringen. En enskild firma heter som en fysisk person.
    expect(rad.details.merged_name, 'ett namn här hade överlevt sin egen radering').toBeUndefined();
  });
});

describe('sökning: man ska slippa veta var något ligger', () => {
  it('hittar relation, person och kund i samma träfflista', async () => {
    const r = await act('search_crm', { query: 'Nordic' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const kinds = r.body.result.map((h: { kind: string }) => h.kind);
    expect(kinds).toContain('organization');

    const eva = await act('search_crm', { query: 'eva@nvr' });
    expect(eva.body.result[0].kind).toBe('person');
    expect(eva.body.result[0].title).toBe('Eva Larsson');
  });

  it('exakt träff hamnar överst', async () => {
    await nyOrg('Alfa');
    await nyOrg('Alfabolaget AB');
    const r = await act('search_crm', { query: 'Alfa' });
    expect(r.body.result[0].title).toBe('Alfa');
  });

  it('en söksträng med jokertecken behandlas som text, inte som mönster', async () => {
    const r = await act('search_crm', { query: '%' });
    expect(r.body.result, 'ett procenttecken är för kort för att söka på').toHaveLength(0);
    const r2 = await act('search_crm', { query: '%%' });
    expect(r2.body.result, 'och som text matchar det ingenting').toHaveLength(0);
  });

  it('sökningen är tenant-isolerad', async () => {
    const other = await registerUser('kadensannan');
    const otherCo = await createCompany(other.token, 'Annat AB');
    const r = await api.post(`/api/companies/${otherCo}/actions/search_crm`)
      .set({ Authorization: `Bearer ${other.token}` }).send({ query: 'Nordic' });
    expect(r.status).toBe(200);
    expect(r.body.result).toHaveLength(0);
  });
});

describe('söksidan och relationskortet i vyn', () => {
  it('sökrutan finns i navraden på varje sida', async () => {
    const res = await ua.get(`/app/c/${companyId}/idag`);
    const nav = res.text.slice(res.text.indexOf('<nav class="nav"'), res.text.indexOf('</nav>'));
    expect(nav).toContain(`action="/app/c/${companyId}/sok"`);
    expect(nav).toContain('type="search"');
  });

  it('söksidan visar träffar med register och länk', async () => {
    const res = await ua.get(`/app/c/${companyId}/sok?q=Nordic`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Nordic Vision Retail AB');
    expect(res.text).toContain('Relation');
    expect(res.text).not.toContain('<script');
  });

  it('en tom sökning ber om fler tecken i stället för att visa allt', async () => {
    const res = await ua.get(`/app/c/${companyId}/sok`);
    expect(res.text).toContain('Skriv minst två tecken');
  });

  it('relationskortet bär kadens och sammanslagning — utan skript', async () => {
    const org = (await act('list_crm_organizations', {})).body.result
      .find((o: { name: string }) => o.name === 'Nordic Vision Retail AB');
    const res = await ua.get(`/app/c/${companyId}/relations/${org.id}`);
    expect(res.text).toContain('Kadens &amp; dämpning');
    expect(res.text).toContain('Hör av mig var');
    expect(res.text).toContain('Slå ihop en annan relation hit');
    expect(res.text).not.toContain('<script');
    expect(res.text).not.toContain('onclick=');
  });
});
