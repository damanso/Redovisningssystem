// Relationsytan F5, forts. — gravstenen över ett hopslaget namn.
//
// Felet som testerna är skrivna ur är Davids, från den skarpa ingesten 13/8:
// tre organisationer skapades med PROJEKTnamn i stället för företagsnamn
// (Hermes, ILT-Education, NVR-001). Sammanslagningen finns sedan F5 och flyttar
// historiken rätt — men källan utanför systemet vet ingenting om det, och
// `ingestCrmEvents` slår upp organisationen på NAMN innan `source_ref` ens
// konsulteras. Nästa nattkörning skapade därför raden igen.
//
// Det som återuppstod var värre än en dubblett: åtagandena låg kvar på rätt rad,
// så det som kom tillbaka var ett TOMT skal — som ändå syntes i tystnadslistan
// och på dagsytan. Utan gravstenen fick David göra om samma sammanslagning efter
// varje nattkörning.
//
// Risken åt andra hållet är att aliaset tyst kapar en framtida ÄKTA organisation
// med samma namn. Den bärs av tre spärrar, en test var: den riktiga
// organisationen slås upp först, bara synken styrs om, och varje omstyrning
// redovisas i svaret.
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

interface IngestSvar {
  organizations_created: number;
  interactions_created: number;
  interactions_unchanged: number;
  redirected_organizations: string[];
  skipped: { index: number; reason: string }[];
}

/** En nattkörning: samma batch, om och om igen. */
const ingest = async (events: Record<string, unknown>[]): Promise<IngestSvar> => {
  const r = await act('ingest_crm_events', { events });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body.result;
};

const mailFran = (orgNamn: string, ref: string): Record<string, unknown> => ({
  kind: 'interaction',
  organization: { name: orgNamn },
  occurred_at: '2026-08-13T19:05:00Z',
  channel: 'email',
  direction: 'inbound',
  summary: 'Avstämning om piloten.',
  source_system: 'gmail',
  source_ref: ref,
});

async function nyOrg(namn: string): Promise<string> {
  const r = await act('upsert_crm_organization', { name: namn });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body.result.id as string;
}

/** Sammanslagningen är känslig — den går genom godkännandekön. */
async function slaIhop(keepId: string, mergeId: string): Promise<Record<string, unknown>> {
  const res = await act('merge_crm_organizations', { keep_id: keepId, merge_id: mergeId });
  expect(res.status, JSON.stringify(res.body)).toBe(202);
  const ok = await api.post(`${co()}/approvals/${res.body.approval.id}/approve`).set(auth()).send({});
  expect(ok.status, JSON.stringify(ok.body)).toBe(200);
  return ok.body.result as Record<string, unknown>;
}

const orgNamn = async (): Promise<string[]> =>
  (await act('list_crm_organizations', {})).body.result.map((o: { name: string }) => o.name);

beforeAll(async () => {
  user = await registerUser('gravsten');
  companyId = await createCompany(user.token, 'Locollabs AB');
  ua = supertest.agent(app);
  await ua.post('/app/login').type('form').send({ email: user.email, password: PASSWORD });
});

describe('gravstenen: en hopslagen organisation återuppstår inte vid nästa synk', () => {
  it('slå ihop, kör om ingesten — ingen ny rad', async () => {
    // Så här såg det ut hos David: mailindexet skickar projektnamnet.
    const forsta = await ingest([mailFran('Hermes', 'gmail:hermes-1')]);
    expect(forsta.organizations_created).toBe(1);
    const skal = (await act('list_crm_organizations', {})).body.result
      .find((o: { name: string }) => o.name === 'Hermes');
    const riktig = await nyOrg('Hermes Bevakning AB');

    const merge = await slaIhop(riktig, skal.id);
    expect(merge.aliases_kept, 'namnet som försvann blir en gravsten').toBe(1);
    expect(await orgNamn()).not.toContain('Hermes');

    // Nattkörningen igen — exakt samma batch. Före gravstenen skapades "Hermes"
    // på nytt här, som ett tomt skal i tystnadslistan.
    const andra = await ingest([mailFran('Hermes', 'gmail:hermes-1')]);
    expect(andra.organizations_created, 'ingen ny rad').toBe(0);
    expect(andra.interactions_unchanged, 'idempotensen är orörd').toBe(1);
    expect(await orgNamn()).not.toContain('Hermes');

    // Och den kvarvarande raden har inte döpts om till det gamla namnet — då
    // hade gravstenen gjort precis det den finns för att förhindra, fast tvärtom.
    const kvar = await act('get_crm_organization', { organization_id: riktig });
    expect(kvar.body.result.name).toBe('Hermes Bevakning AB');
  });

  it('nya mail med det gamla namnet landar på den kvarvarande relationen', async () => {
    // Poängen är inte bara att slippa raden: kontakten ska räknas som kontakt
    // med det bolag den faktiskt gäller, annars ligger den kvar som tyst.
    const ny = await ingest([mailFran('Hermes', 'gmail:hermes-2')]);
    expect(ny.interactions_created).toBe(1);
    expect(ny.organizations_created).toBe(0);

    const kvar = (await act('list_crm_organizations', {})).body.result
      .find((o: { name: string }) => o.name === 'Hermes Bevakning AB');
    const kort = await act('get_crm_organization', { organization_id: kvar.id });
    expect(kort.body.result.interactions).toHaveLength(2);
  });

  it('omstyrningen REDOVISAS — en tyst omdirigering vore ett tyst utfall', async () => {
    const r = await ingest([mailFran('Hermes', 'gmail:hermes-3')]);
    expect(r.redirected_organizations).toEqual(['Hermes → Hermes Bevakning AB']);
  });

  it('kedjan håller: A slås in i B, B in i C — "A" leder hela vägen till C', async () => {
    await ingest([mailFran('NVR-001', 'gmail:nvr-1')]);
    const a = (await act('list_crm_organizations', {})).body.result
      .find((o: { name: string }) => o.name === 'NVR-001');
    const b = await nyOrg('Nordic Vision Retail');
    const c = await nyOrg('Nordic Vision Retail AB');

    await slaIhop(b, a.id);
    const andra = await slaIhop(c, b);
    expect(andra.aliases_kept, 'både "Nordic Vision Retail" och det ärvda "NVR-001"').toBe(2);

    const r = await ingest([mailFran('NVR-001', 'gmail:nvr-2')]);
    expect(r.organizations_created, 'utan arvet hade NVR-001 återuppstått').toBe(0);
    expect(r.redirected_organizations).toEqual(['NVR-001 → Nordic Vision Retail AB']);
    expect(await orgNamn()).not.toContain('NVR-001');
  });
});

describe('spärrarna mot att aliaset kapar ett riktigt bolag', () => {
  it('en människas uttryckliga upsert styrs ALDRIG om', async () => {
    // Hermes blir en riktig kund. En människa som skriver namnet menar namnet —
    // annars hade gravstenen blivit ett sätt att göra om ett namnbyte till en
    // sammanslagning, tvärtemot regeln att människan vinner (F4).
    const egen = await act('upsert_crm_organization', { name: 'Hermes', notes: 'Blev kund på riktigt.' });
    expect(egen.status, JSON.stringify(egen.body)).toBe(200);
    expect(egen.body.result.created).toBe(true);
    expect(await orgNamn()).toContain('Hermes');

    // …och nu när namnet finns på riktigt går synkens uppslag dit, inte till
    // aliaset: den riktiga organisationen slås upp först.
    const r = await ingest([mailFran('Hermes', 'gmail:hermes-4')]);
    expect(r.redirected_organizations).toEqual([]);
    const kort = await act('get_crm_organization', { organization_id: egen.body.result.id });
    expect(kort.body.result.interactions).toHaveLength(1);
  });

  it('aliaset går att ta bort — en sammanslagning är ett omdöme, inte en radering', async () => {
    await ingest([mailFran('ILT-Education', 'gmail:ilt-1')]);
    const skal = (await act('list_crm_organizations', {})).body.result
      .find((o: { name: string }) => o.name === 'ILT-Education');
    const riktig = await nyOrg('ILT Inläsningstjänst AB');
    await slaIhop(riktig, skal.id);

    // Aliaset syns på kortet: en spärr man inte kan läsa går inte att ångra.
    const kort = await act('get_crm_organization', { organization_id: riktig });
    expect((kort.body.result.name_aliases as { name: string }[]).map((a) => a.name))
      .toContain('ILT-Education');

    const bort = await act('remove_crm_name_alias', { name: 'ILT-Education' });
    expect(bort.status, JSON.stringify(bort.body)).toBe(200);
    expect(bort.body.result.organization_id).toBe(riktig);

    // Efteråt får namnet en egen rad igen — det är precis vad man bad om.
    const r = await ingest([mailFran('ILT-Education', 'gmail:ilt-2')]);
    expect(r.organizations_created).toBe(1);
    expect(r.redirected_organizations).toEqual([]);
    expect(await orgNamn()).toContain('ILT-Education');
  });

  it('ett alias som inte finns är ett tydligt fel, inte en tyst nolla', async () => {
    const r = await act('remove_crm_name_alias', { name: 'Aldrig hopslagen AB' });
    expect(r.status).toBe(404);
  });

  it('loggen bär antal, aldrig namnet på det som slogs ihop', async () => {
    const rader = await withAdmin(async (a) => (await a.query(
      `SELECT details FROM crm.audit_log
       WHERE company_id = $1 AND action IN ('crm.organizations_merged', 'crm.name_alias_removed')`,
      [companyId])).rows as { details: Record<string, unknown> }[]);
    expect(rader.length).toBeGreaterThan(0);
    for (const rad of rader) {
      // crm.audit_log är append-only och nås varken av gallringen eller av
      // GDPR-raderingen. En organisation kan vara en enskild firma.
      expect(JSON.stringify(rad.details)).not.toContain('Hermes');
      expect(JSON.stringify(rad.details)).not.toContain('ILT');
    }
  });
});

describe('vyn: handgreppet finns där relationen finns', () => {
  it('tidigare namn visas på relationssidan och går att ta bort där', async () => {
    await ingest([mailFran('Kortnamnet', 'gmail:kort-1')]);
    const skal = (await act('list_crm_organizations', {})).body.result
      .find((o: { name: string }) => o.name === 'Kortnamnet');
    const riktig = await nyOrg('Kortnamnet Bolag AB');
    await slaIhop(riktig, skal.id);

    const sida = await ua.get(`/app/c/${companyId}/relations/${riktig}`);
    expect(sida.status).toBe(200);
    expect(sida.text).toContain('Tidigare namn');
    expect(sida.text).toContain('Kortnamnet');

    const bort = await ua.post(`/app/c/${companyId}/relations/${riktig}/alias/remove`)
      .type('form').send({ name: 'Kortnamnet', back: `/app/c/${companyId}/relations/${riktig}` });
    expect(bort.status).toBe(302);

    const kvar = await withAdmin(async (a) => (await a.query(
      'SELECT count(*)::int AS n FROM crm.organization_name_aliases WHERE company_id = $1 AND lower(name) = $2',
      [companyId, 'kortnamnet'])).rows[0].n);
    expect(kvar).toBe(0);
  });
});

describe('GDPR: gravstenen över ett namn överlever inte en radering', () => {
  it('tidigare namn försvinner när kunden anonymiseras', async () => {
    const cust = await api.post(`${co()}/customers`).set(auth()).send({ name: 'Gravstenskund AB' });
    expect(cust.status).toBe(201);
    const customerId = cust.body.customer.id;

    const riktig = await act('upsert_crm_organization', { name: 'Gravstenskund AB', customer_id: customerId });
    const gammal = await nyOrg('Gravstenskunden (projektnamn)');
    await slaIhop(riktig.body.result.id, gammal);

    const req = await act('anonymize_party', { party_type: 'customer', party_id: customerId });
    expect(req.status).toBe(202);
    const done = await api.post(`${co()}/approvals/${req.body.approval.id}/approve`).set(auth()).send({});
    expect(done.status, JSON.stringify(done.body)).toBe(200);

    // Bokföringslagen kräver motpartens identitet i affären — inte varje
    // stavning mailindexet råkat använda. Ett namn kan vara en enskild firma.
    const kvar = await withAdmin(async (a) => (await a.query(
      'SELECT count(*)::int AS n FROM crm.organization_name_aliases WHERE company_id = $1 AND organization_id = $2',
      [companyId, riktig.body.result.id])).rows[0].n);
    expect(kvar).toBe(0);
  });
});
