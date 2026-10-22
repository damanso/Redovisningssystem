// CRM E5 + E6 — vyerna.
//
// Kontrollytetestet ur briefen: kan beställaren se läget UTAN att fråga? Det är
// skillnaden mellan en kontrollyta och en konversation — en konversation kräver
// att han vet vad han ska fråga om, en yta visar även det han inte tänkte på.
//
// Testerna läser sidorna som en webbläsare gör och kräver att svaren på hans
// fyra frågor faktiskt STÅR där: vad har vi sagt till vem, vem bör kontaktas och
// varför, hur ligger vi till, vem har lovat vad och var det sades.
//
// Och det viktigaste: koncentrationsrisken ska synas, inte döljas.
import supertest from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { api, app, createCompany, createFiscalYear, registerUser, withAdmin, type TestUser } from './helpers.js';

const PASSWORD = 'mycket-hemligt-losen-123';
let user: TestUser;
let companyId: string;
let bigCustomerId: string;
let orgId: string;
let ua: ReturnType<typeof supertest.agent>;
const auth = () => ({ Authorization: `Bearer ${user.token}` });
const co = () => `/api/companies/${companyId}`;
const act = (name: string, body: Record<string, unknown> = {}) =>
  api.post(`${co()}/actions/${name}`).set(auth()).send(body);

async function bookedInvoice(customerId: string, date: string, hours: number): Promise<void> {
  const inv = await act('create_invoice', {
    customer_id: customerId, invoice_date: date, due_date: date,
    lines: [{ description: 'Konsulttid', quantity: hours, unit: 'h', unit_price_ore: 110_000, vat_rate: 25 }],
  });
  expect(inv.status, JSON.stringify(inv.body)).toBe(200);
  const book = await act('book_invoice', { invoice_id: inv.body.result.id });
  expect(book.status).toBe(202);
  const approve = await api.post(`${co()}/approvals/${book.body.approval.id}/approve`).set(auth()).send({});
  expect(approve.status, JSON.stringify(approve.body)).toBe(200);
}

beforeAll(async () => {
  user = await registerUser('crmvy');
  companyId = await createCompany(user.token, 'Locollabs AB');
  await createFiscalYear(companyId, auth(), { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });

  const big = await api.post(`${co()}/customers`).set(auth()).send({ name: 'Nordic Vision Retail AB' });
  bigCustomerId = big.body.customer.id;
  const small = await api.post(`${co()}/customers`).set(auth()).send({ name: 'Lilla Kunden AB' });

  // 75/25 — samma koncentration som i verkligheten hos beställaren.
  await bookedInvoice(bigCustomerId, '2026-06-30', 150);
  await bookedInvoice(small.body.customer.id, '2026-06-30', 50);

  // Relationsdata via API-kontraktet: mail, möte och ett förfallet löfte.
  const ingest = await act('ingest_crm_events', {
    events: [
      {
        kind: 'interaction',
        organization: { name: 'Nordic Vision Retail AB' },
        person: { name: 'Eva Larsson', email: 'eva@nvr.example', role_title: 'Ekonomichef' },
        occurred_at: '2026-08-10T09:14:00Z', channel: 'email', direction: 'inbound',
        summary: 'Svar om pilotens omfattning.', source_system: 'gmail', source_ref: 'gmail:abc',
      },
      {
        kind: 'commitment',
        organization: { name: 'Nordic Vision Retail AB' },
        person: { name: 'Eva Larsson', email: 'eva@nvr.example' },
        commitment_direction: 'we_owe', body: 'Skicka tidplan för fas 2.',
        due_date: '2026-01-15', occurred_at: '2026-01-10T09:20:00Z',
        source_system: 'gmail', source_ref: 'gmail:abc#c1',
      },
      {
        kind: 'interaction',
        organization: { name: 'Tystlåtna Prospektet AB' },
        person: { name: 'Sven Tyst' },
        occurred_at: '2026-01-15T13:00:00Z', channel: 'meeting', direction: 'outbound',
        summary: 'Enda mötet hittills.', source_system: 'calendar', source_ref: 'cal:1',
      },
    ],
  });
  expect(ingest.status, JSON.stringify(ingest.body)).toBe(200);

  // INGEN manuell koppling här. Testet maskerade tidigare buggen genom att
  // kalla upsert_crm_organization med customer_id direkt efter ingesten —
  // vilket ingest-vägen aldrig kan göra, eftersom avsändaren inte känner våra
  // uuid:n. Kopplingen ska uppstå av sig själv, på namnet.
  const orgs = await act('list_crm_organizations', {});
  orgId = orgs.body.result.find((o: { name: string }) => o.name === 'Nordic Vision Retail AB').id;

  ua = supertest.agent(app);
  await ua.post('/app/login').type('form').send({ email: user.email, password: PASSWORD });
});

describe('ingesten kopplar ihop relationen med redovisningen', () => {
  it('organisationen hittar sin kund på namnet — utan att någon anger ett id', async () => {
    // Buggen: ingest-vägen satte aldrig customer_id, så NVR låg kvar som
    // prospekt med tom koppling. Omsättningen hämtas via just den kopplingen,
    // så styrvyn räknade noll för bolagets största kund — utan felmeddelande.
    const list = await act('list_crm_organizations', {});
    const nvr = list.body.result.find((o: { name: string }) => o.name === 'Nordic Vision Retail AB');
    expect(nvr.customer_id, 'kopplingen ska ha uppstått ur namnet').toBe(bigCustomerId);
    expect(nvr.status).toBe('customer');

    // ...och prospektet utan motsvarighet i kundregistret förblir prospekt.
    const tyst = list.body.result.find((o: { name: string }) => o.name === 'Tystlåtna Prospektet AB');
    expect(tyst.customer_id).toBeNull();
    expect(tyst.status).toBe('prospect');
  });

  it('omsättningen syns för den kopplade kunden — inte en tyst nolla', async () => {
    const state = await act('crm_relation_state', {});
    const nvr = state.body.result.find((r: { name: string }) => r.name === 'Nordic Vision Retail AB');
    expect(nvr.revenue_12m_ore).toBeGreaterThan(0);
    expect(nvr.revenue_share_permille).toBe(750); // 75 %, samma som styrvyn visar
  });

  it('kundkortet visar personerna från relationen — där man letar efter dem', async () => {
    // Personer som kommer in via API-kontraktet hamnar i relationen, inte i
    // kundregistret. Kundkortet läste bara registret, så de var osynliga på
    // precis den sida man öppnar när man undrar vem man pratar med hos kunden.
    const res = await ua.get(`/app/c/${companyId}/customers/${bigCustomerId}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Eva Larsson');
    expect(res.text).toContain('Ekonomichef');
    // Ursprunget syns — de två registren har olika gallring och slås inte ihop.
    expect(res.text).toContain('Från relationen');
    expect(res.text).toContain('Senaste kontakt 2026-08-10');
    expect(res.text).toContain(`/app/c/${companyId}/relations/${orgId}`);
  });

  it('en kund utan relation får ingen extra text på kortet', async () => {
    const ensam = await api.post(`${co()}/customers`).set(auth()).send({ name: 'Utan Relation AB' });
    expect(ensam.status).toBe(201);
    const res = await ua.get(`/app/c/${companyId}/customers/${ensam.body.customer.id}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Inga kontaktpersoner.');
    expect(res.text).not.toContain('Öppna relationen');
  });

  it('en organisation UTAN koppling märks ut i vyn i stället för att visa 0 kr', async () => {
    const res = await ua.get(`/app/c/${companyId}/relations`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Ej i kundregistret');
  });
});

describe('relationsvyn svarar på "vem bör jag kontakta, och varför"', () => {
  it('listar relationer med senaste kontakt, löften och värde', async () => {
    const res = await ua.get(`/app/c/${companyId}/relations`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Nordic Vision Retail AB');
    expect(res.text).toContain('Tystlåtna Prospektet AB');
    expect(res.text).toContain('Prospekt');
    expect(res.text).toContain('Senaste kontakt');
  });

  it('förslagen står högst upp och säger VARFÖR — men skickar ingenting', async () => {
    const res = await ua.get(`/app/c/${companyId}/relations`);
    expect(res.text).toContain('Att höra av sig till');
    expect(res.text, 'skälet ska säga VAD som lovats').toContain('vi lovade: Skicka tidplan');
    expect(res.text).toContain('Eva Larsson');
    expect(res.text).toContain('Systemet skickar aldrig något till en kund');
  });

  it('relationssidan visar personer, löften och vad som sagts — med källa', async () => {
    const res = await ua.get(`/app/c/${companyId}/relations/${orgId}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Eva Larsson');
    expect(res.text).toContain('Ekonomichef');
    expect(res.text).toContain('Skicka tidplan för fas 2.');
    expect(res.text).toContain('Svar om pilotens omfattning.');
    expect(res.text).toContain('gmail:abc'); // källan går att följa tillbaka
    expect(res.text).toContain('2026-08-10'); // datum, inte "Mon Aug 10"
    expect(res.text).toContain(`/app/c/${companyId}/customers/${bigCustomerId}`); // kundkortet, ingen kopia
  });
});

describe('åtagandevyn svarar på "vem har lovat vad, och var sades det"', () => {
  it('visar öppna löften med riktning, datum och källa', async () => {
    const res = await ua.get(`/app/c/${companyId}/commitments`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Vi lovade');
    expect(res.text).toContain('Skicka tidplan för fas 2.');
    expect(res.text).toContain('Förfallet');
    expect(res.text).toContain('gmail');
  });

  it('går att filtrera utan JavaScript (länkar, inte skript)', async () => {
    const res = await ua.get(`/app/c/${companyId}/commitments?status=done`);
    expect(res.status).toBe(200);
    expect(res.text).not.toContain('Skicka tidplan för fas 2.');
    expect(res.text).not.toContain('<script');
  });
});

describe('styrvyn svarar på "hur ligger vi till"', () => {
  it('visar intäktstakt, kostnad per månad och känd täckning', async () => {
    const res = await ua.get(`/app/c/${companyId}/steering`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Intäkt 12 mån');
    expect(res.text).toContain('Takt per månad');
    expect(res.text).toContain('Känd täckning framåt');
    expect(res.text).toContain('Obetalda bokförda fakturor');
  });

  it('koncentrationsrisken SYNS — den är bolagets största risk', async () => {
    const res = await ua.get(`/app/c/${companyId}/steering`);
    expect(res.text).toContain('Koncentrationsrisk');
    expect(res.text).toContain('Nordic Vision Retail AB');
    expect(res.text).toContain('75,0 %');
  });

  it('öppna affärer räknas inte som täckning — de bor i Linear', async () => {
    const res = await ua.get(`/app/c/${companyId}/steering`);
    expect(res.text).toContain('Öppna affärer räknas inte in');
  });
});

describe('vyerna är JS-fria och når varandra från menyn', () => {
  it('inga skript på någon av de nya sidorna', async () => {
    for (const path of ['relations', 'commitments', 'steering']) {
      const res = await ua.get(`/app/c/${companyId}/${path}`);
      expect(res.status, path).toBe(200);
      expect(res.text, path).not.toContain('<script');
      expect(res.text, path).not.toContain('onclick=');
    }
  });

  it('sidorna ligger i menyn', async () => {
    const res = await ua.get(`/app/c/${companyId}/relations`);
    const nav = (() => {
      // Sidan bar tva navrader: Hermes huvudmeny forst, modulens egen
      // efter. Slutmarkoren maste sokas EFTER startmarkoren, annars
      // klipps ett tomt stycke ut. (2026-09-09)
      const i = res.text.indexOf('<nav class="nav"');
      return res.text.slice(i, res.text.indexOf('</nav>', i));
    })();
    expect(nav).toContain(`href="/app/c/${companyId}/relations"`);
    expect(nav).toContain(`href="/app/c/${companyId}/commitments"`);
    expect(nav).toContain(`href="/app/c/${companyId}/steering"`);
  });
});

// Story 1.3: hela HTTP-vägen ska skilja beslut från gissningar och äldre värden.
// Facit är literaler; tomma värden och en oskyddad status är negativa kontroller.
let originAgentToken: string;
let u1Id: string;
let u5Id: string;
let vLinkedId: string;
let vUnlinkedId: string;
let s1Id: string;
let s3Id: string;
const originAgentAct = (name: string, body: Record<string, unknown>) =>
  api.post(`${co()}/actions/${name}`).set('Authorization', `Bearer ${originAgentToken}`).send(body);
const relationPath = (id: string) => `/app/c/${companyId}/relations/${id}`;

function uppgiftskort(markup: string): string {
  const start = markup.indexOf('>Uppgifter</div>');
  const end = markup.indexOf('<details class="rattaform">', start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return markup.slice(start, end);
}

function uppgiftsrad(markup: string, label: string): string {
  const row = uppgiftskort(markup).split('<div class="uppgift">')
    .find((part) => part.includes(`<span class="k">${label}</span>`));
  expect(row, `raden ${label} ska finnas`).toBeDefined();
  return row!;
}

function bekraftelsefalt(markup: string, organizationId: string, personId?: string): string[] {
  return [...markup.matchAll(/<form\b[^>]*>[\s\S]*?<\/form>/g)].flatMap(([form]) => {
    if (!form.includes(`action="${relationPath(organizationId)}/confirm"`)) return [];
    const person = /name="person_id" value="([^"]*)"/.exec(form)?.[1];
    if (person !== personId) return [];
    const field = /name="field" value="([^"]+)"/.exec(form)?.[1];
    expect(field, 'varje bekräftelseformulär ska ha ett fält').toBeDefined();
    expect(form).toContain('type="submit"');
    expect(form).toContain('>Stämmer</button>');
    expect(form).toContain(`name="back" value="${relationPath(organizationId)}"`);
    return [field!];
  }).sort();
}

async function originPage(id: string): Promise<string> {
  const res = await ua.get(relationPath(id));
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.text;
}

async function originOrganization(body: Record<string, unknown>, agent = false): Promise<string> {
  const res = await (agent ? originAgentAct : act)('upsert_crm_organization', body);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.result.id as string;
}

async function organizationOrigin(
  id: string, field: string, source: string | null,
  system: string | null = null, ref: string | null = null, reason: string | null = null,
): Promise<void> {
  await withAdmin(async (client) => {
    if (source === null) {
      await client.query('DELETE FROM crm.field_provenance WHERE company_id = $1 AND organization_id = $2 AND field = $3',
        [companyId, id, field]);
      return;
    }
    await client.query(
      `INSERT INTO crm.field_provenance (company_id, organization_id, field, source, source_system, source_ref, reason)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (company_id, organization_id, field) WHERE organization_id IS NOT NULL
       DO UPDATE SET source = EXCLUDED.source, source_system = EXCLUDED.source_system,
                     source_ref = EXCLUDED.source_ref, reason = EXCLUDED.reason`,
      [companyId, id, field, source, system, ref, reason]);
  });
}

describe('Story 1.3: K1 i Uppgifter och bekräftad status', () => {
  beforeAll(async () => {
    const token = await api.post(`${co()}/agent-tokens`).set(auth()).send({ name: 'ursprungsprovet' });
    expect(token.status, JSON.stringify(token.body)).toBe(201);
    originAgentToken = token.body.token;
    u1Id = await originOrganization({
      name: 'Ursprungsprovet U1 AB', org_number: '556013-0001', website: 'https://u1.example', status: 'partner',
    });
    await organizationOrigin(u1Id, 'org_number', 'accounting', null, null, 'matchad på organisationsnummer');
    await organizationOrigin(u1Id, 'website', 'sync', 'gmail', 'gmail:u3', 'hämtad från gmail');
    await organizationOrigin(u1Id, 'status', 'ai');
    u5Id = await originOrganization({ name: 'Ursprungsprovet U5 AB', website: 'https://u5.example', status: 'partner' });
    await organizationOrigin(u5Id, 'name', 'import', null, null, 'importerad ur kundlistan');
    await organizationOrigin(u5Id, 'website', null);
    await organizationOrigin(u5Id, 'org_number', 'ai');

    const customer = await api.post(`${co()}/customers`).set(auth()).send({ name: 'Vyprovets Kund AB' });
    expect(customer.status, JSON.stringify(customer.body)).toBe(201);
    vLinkedId = await originOrganization({
      name: 'Vyprovet Kopplad AB', website: 'https://linked.example', customer_id: customer.body.customer.id, status: 'customer',
    }, true);
    vUnlinkedId = await originOrganization({
      name: 'Vyprovet Okopplad AB', org_number: '556013-0002', website: 'https://unlinked.example', status: 'prospect',
    }, true);
    s1Id = await originOrganization({ name: 'Statusprovet S1 AB', status: 'partner' }, true);
    s3Id = await originOrganization({ name: 'Statusprovet S3 AB', status: 'partner' }, true);
  });

  it('U1 human står omärkt utan knapp', async () => {
    const row = uppgiftsrad(await originPage(u1Id), 'Namn');
    expect(row).not.toContain('class="prov');
    expect(row).not.toContain('<form');
  });

  it('U2 accounting visas som ur bokföringen utan knapp', async () => {
    const row = uppgiftsrad(await originPage(u1Id), 'Org.nr');
    expect(row).toContain('ur bokföringen');
    expect(row).toContain('prov--fact');
    expect(row).not.toContain('<form');
  });

  it('U3 sync har läsbart märke, källnamn och nyckel före skälet', async () => {
    const row = uppgiftsrad(await originPage(u1Id), 'Webbplats');
    expect(row).toContain('role="img"');
    expect(row).toContain('aria-label="Inte bekräftad av dig"');
    expect(row).toContain('title="Inte bekräftad av dig · Gmail · gmail:u3"');
    expect(row).toContain('>✦</span>');
    expect(row).not.toContain('hämtad från');
    expect(bekraftelsefalt(row, u1Id)).toEqual(['website']);
  });

  it('U4 ai utan källa har sin fasta titel och Stämmer', async () => {
    const row = uppgiftsrad(await originPage(u1Id), 'Status');
    expect(row).toContain('role="img"');
    expect(row).toContain('aria-label="Inte bekräftad av dig"');
    expect(row).toContain('title="Inte bekräftad av dig · AI:ts tolkning"');
    expect(row).toContain('>✦</span>');
    expect(bekraftelsefalt(row, u1Id)).toEqual(['status']);
  });

  it('U5 import visar skälet och Stämmer', async () => {
    const row = uppgiftsrad(await originPage(u5Id), 'Namn');
    expect(row).toContain('role="img"');
    expect(row).toContain('aria-label="Inte bekräftad av dig"');
    expect(row).toContain('title="Inte bekräftad av dig · importerad ur kundlistan"');
    expect(row).toContain('>✦</span>');
    expect(bekraftelsefalt(row, u5Id)).toEqual(['name']);
  });

  it('U6 ett värde utan rad visar ursprung okänt och Stämmer', async () => {
    const row = uppgiftsrad(await originPage(u5Id), 'Webbplats');
    expect(row).toContain('https://u5.example');
    expect(row).toContain('>ursprung okänt</span>');
    expect(row).toContain('title="Skrevs innan ursprung började sparas — inte bekräftat av dig"');
    expect(bekraftelsefalt(row, u5Id)).toEqual(['website']);
  });

  it('U7 tomt värde märks aldrig ens med en planterad ai-rad', async () => {
    const row = uppgiftsrad(await originPage(u5Id), 'Org.nr');
    expect(row).toContain('—');
    expect(row).not.toContain('class="prov');
    expect(row).not.toContain('<form');
  });

  it('U8 Uppgifter har exakt fem rader i rätt ordning och svensk status', async () => {
    const card = uppgiftskort(await originPage(u1Id));
    const labels = [...card.matchAll(/<span class="k">([^<]+)<\/span>/g)].map((m) => m[1]);
    expect(labels).toEqual(['Namn', 'Org.nr', 'Webbplats', 'Status', 'Kund i registret']);
    expect(uppgiftsrad(await originPage(u1Id), 'Status')).toContain('Partner');
  });

  it('V1 varje obekräftat fält har Stämmer på kopplad och okopplad relation', async () => {
    expect(bekraftelsefalt(uppgiftskort(await originPage(vLinkedId)), vLinkedId))
      .toEqual(['customer_id', 'name', 'status', 'website']);
    expect(bekraftelsefalt(uppgiftskort(await originPage(vUnlinkedId)), vUnlinkedId))
      .toEqual(['name', 'org_number', 'status', 'website']);
  });

  it('V2 efter bekräftelser genom vyn är båda korten omärkta utan knappar', async () => {
    for (const [id, fields] of [
      [vLinkedId, ['customer_id', 'name', 'status', 'website']],
      [vUnlinkedId, ['name', 'org_number', 'status', 'website']],
    ] as const) {
      for (const field of fields) {
        const res = await ua.post(`${relationPath(id)}/confirm`).type('form').send({ field });
        expect(res.status, JSON.stringify(res.body)).toBe(302);
        expect(res.headers.location).toBe(relationPath(id));
      }
      const card = uppgiftskort(await originPage(id));
      expect(bekraftelsefalt(card, id)).toEqual([]);
      expect(card).not.toContain('prov--guess');
      expect(card).not.toContain('ursprung okänt');
    }
  });

  it('S1 Stämmer på status skriver human och tar bort märke och knapp', async () => {
    const before = uppgiftsrad(await originPage(s1Id), 'Status');
    expect(before).toContain('>✦</span>');
    expect(bekraftelsefalt(before, s1Id)).toEqual(['status']);
    const res = await ua.post(`${relationPath(s1Id)}/confirm`).type('form').send({ field: 'status' });
    expect(res.status, JSON.stringify(res.body)).toBe(302);
    expect(res.headers.location).toBe(relationPath(s1Id));
    const org = await act('get_crm_organization', { organization_id: s1Id });
    expect(org.status, JSON.stringify(org.body)).toBe(200);
    expect(org.body.result.provenance.status).toMatchObject({ source: 'human', reason: 'bekräftad av människa' });
    const after = uppgiftsrad(await originPage(s1Id), 'Status');
    expect(after).not.toContain('class="prov');
    expect(after).not.toContain('ursprung okänt');
    expect(after).not.toContain('<form');
  });

  it('S2 agentens statusändring stoppas efter människans bekräftelse', async () => {
    const confirm = await ua.post(`${relationPath(s1Id)}/confirm`).type('form').send({ field: 'status' });
    expect(confirm.status, JSON.stringify(confirm.body)).toBe(302);
    expect(confirm.headers.location).toBe(relationPath(s1Id));
    const res = await originAgentAct('upsert_crm_organization', {
      organization_id: s1Id, name: 'Statusprovet S1 AB', status: 'former',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.result.kept_human_fields).toContain('status');
    const row = await withAdmin(async (client) => (await client.query(
      `SELECT o.status, fp.source FROM crm.organizations o JOIN crm.field_provenance fp
       ON fp.organization_id = o.id AND fp.company_id = o.company_id AND fp.field = 'status'
       WHERE o.company_id = $1 AND o.id = $2`, [companyId, s1Id])).rows[0]);
    expect(row).toEqual({ status: 'partner', source: 'human' });
  });

  it('S3 negativ kontroll: en obekräftad status ändras och visas som Tidigare', async () => {
    const res = await originAgentAct('upsert_crm_organization', {
      organization_id: s3Id, name: 'Statusprovet S3 AB', status: 'former',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.result.kept_human_fields).not.toContain('status');
    const row = await withAdmin(async (client) => (await client.query(
      'SELECT status FROM crm.organizations WHERE company_id = $1 AND id = $2', [companyId, s3Id])).rows[0]);
    expect(row).toEqual({ status: 'former' });
    const status = uppgiftsrad(await originPage(s3Id), 'Status');
    expect(status).toContain('Tidigare');
    expect(status).not.toContain('>former<');
  });
});

let personRelationId: string;
let petraId: string;
let olleId: string;
let neighborCompanyId: string;
let neighborOrganizationId: string;
let neighborPersonId: string;

function personMarkup(markup: string, name: string): string {
  const start = markup.indexOf('>Personer</div>');
  const end = markup.indexOf('>Kadens', start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  const person = markup.slice(start, end).split('<div class="person">').find((part) => part.includes(name));
  expect(person, `personen ${name} ska finnas`).toBeDefined();
  return person!;
}

async function personOrigin(
  id: string, field: string, source: string | null,
  system: string | null = null, ref: string | null = null, reason: string | null = null,
): Promise<void> {
  await withAdmin(async (client) => {
    if (source === null) {
      await client.query('DELETE FROM crm.field_provenance WHERE company_id = $1 AND person_id = $2 AND field = $3',
        [companyId, id, field]);
      return;
    }
    await client.query(
      `INSERT INTO crm.field_provenance (company_id, person_id, field, source, source_system, source_ref, reason)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (company_id, person_id, field) WHERE person_id IS NOT NULL
       DO UPDATE SET source = EXCLUDED.source, source_system = EXCLUDED.source_system,
                     source_ref = EXCLUDED.source_ref, reason = EXCLUDED.reason`,
      [companyId, id, field, source, system, ref, reason]);
  });
}

async function personState(id: string, tenantId = companyId) {
  return withAdmin(async (client) => {
    const provenance = await client.query(
      `SELECT field, source, reason, source_system, source_ref, recorded_at::text
       FROM crm.field_provenance WHERE company_id = $1 AND person_id = $2 ORDER BY field`, [tenantId, id]);
    const audit = await client.query(
      `SELECT entity_type, details FROM crm.audit_log
       WHERE company_id = $1 AND entity_id = $2 AND action = 'crm.value_confirmed'
       ORDER BY occurred_at DESC, id DESC`, [tenantId, id]);
    return { provenance: provenance.rows, audit: audit.rows };
  });
}

describe('Story 1.3: K1 och Stämmer för personens egna fält', () => {
  beforeAll(async () => {
    personRelationId = await originOrganization({ name: 'Personprovet AB' });
    const petra = await act('upsert_crm_person', {
      name: 'Petra Prov', email: 'petra@prov.example', phone: '070-000 00 01',
      role_title: 'Inköpschef', organization_id: personRelationId,
    });
    expect(petra.status, JSON.stringify(petra.body)).toBe(200);
    petraId = petra.body.result.id;
    await personOrigin(petraId, 'role_title', 'ai');
    await personOrigin(petraId, 'email', 'sync', 'gmail', 'gmail:p1', 'hämtad från gmail');
    await personOrigin(petraId, 'phone', null);
    const helena = await act('upsert_crm_person', {
      name: 'Helena Människa', email: 'helena@prov.example', phone: '070-000 00 02',
      role_title: 'Ekonomichef', organization_id: personRelationId,
    });
    expect(helena.status, JSON.stringify(helena.body)).toBe(200);
    const otherRelation = await originOrganization({ name: 'Andra Relationen AB' });
    const olle = await act('upsert_crm_person', {
      name: 'Olle Annan', phone: '070-000 00 03', organization_id: otherRelation,
    });
    expect(olle.status, JSON.stringify(olle.body)).toBe(200);
    olleId = olle.body.result.id;

    const neighbor = await registerUser('ursprung-granne');
    neighborCompanyId = await createCompany(neighbor.token, 'Grannbolaget AB');
    const neighborAct = (name: string, body: Record<string, unknown>) =>
      api.post(`/api/companies/${neighborCompanyId}/actions/${name}`)
        .set('Authorization', `Bearer ${neighbor.token}`).send(body);
    const organization = await neighborAct('upsert_crm_organization', { name: 'Grannens Relation AB' });
    expect(organization.status, JSON.stringify(organization.body)).toBe(200);
    neighborOrganizationId = organization.body.result.id;
    const person = await neighborAct('upsert_crm_person', {
      name: 'Grannes Person', phone: '070-000 00 04', organization_id: neighborOrganizationId,
    });
    expect(person.status, JSON.stringify(person.body)).toBe(200);
    neighborPersonId = person.body.result.id;
  });

  it('P1 varje ifyllt personfält har rätt märke och precis de tre obekräftade har Stämmer', async () => {
    const person = personMarkup(await originPage(personRelationId), 'Petra Prov');
    const name = /<span class="person__n">([\s\S]*?)<\/span>/.exec(person)?.[1];
    expect(name).toBe('Petra Prov');
    expect(person.match(/prov--guess/g) ?? []).toHaveLength(2);
    expect(person.match(/ursprung okänt/g) ?? []).toHaveLength(1);
    expect(person).toContain('070-000 00 01');
    expect(person).toContain('Inköpschef');
    expect(person).toContain('petra@prov.example');
    expect(person).toContain('title="Inte bekräftad av dig · Gmail · gmail:p1"');
    expect(bekraftelsefalt(person, personRelationId, petraId)).toEqual(['email', 'phone', 'role_title']);
  });

  it('P2 Stämmer på telefonen skriver human och auditraden, sedan försvinner märket och knappen', async () => {
    const res = await ua.post(`${relationPath(personRelationId)}/confirm`).type('form')
      .send({ person_id: petraId, field: 'phone', back: relationPath(personRelationId) });
    expect(res.status, JSON.stringify(res.body)).toBe(302);
    expect(res.headers.location).toBe(relationPath(personRelationId));
    const state = await personState(petraId);
    expect(state.provenance.find((row) => row.field === 'phone'))
      .toMatchObject({ source: 'human', reason: 'bekräftad av människa' });
    expect(state.audit[0]).toEqual({ entity_type: 'person', details: { field: 'phone' } });
    const person = personMarkup(await originPage(personRelationId), 'Petra Prov');
    expect(person).not.toContain('ursprung okänt');
    expect(bekraftelsefalt(person, personRelationId, petraId)).toEqual(['email', 'role_title']);
  });

  it('P3 fel relation och ogiltigt person-id ger 404 utan ursprungs- eller auditskrivning', async () => {
    const before = await personState(olleId);
    expect(before.provenance.length).toBeGreaterThan(0);
    expect(before.audit).toEqual([]);
    for (const personId of [olleId, 'inte-ett-uuid', '00000000-0000-4000-8000-000000000003']) {
      const res = await ua.post(`${relationPath(personRelationId)}/confirm`).type('form')
        .send({ person_id: personId, field: 'phone' });
      expect(res.status, JSON.stringify(res.body)).toBe(404);
    }
    expect(await personState(olleId)).toEqual(before);
  });

  it('P4 annat bolags relation och person ger 404 genom båda bolagsadresserna', async () => {
    const before = await personState(neighborPersonId, neighborCompanyId);
    expect(before.provenance.length).toBeGreaterThan(0);
    for (const tenant of [neighborCompanyId, companyId]) {
      const res = await ua.post(`/app/c/${tenant}/relations/${neighborOrganizationId}/confirm`).type('form')
        .send({ person_id: neighborPersonId, field: 'phone' });
      expect(res.status, JSON.stringify(res.body)).toBe(404);
    }
    // Även ett giltigt eget relations-id måste avvisa grannens person.
    const ownRelation = await ua.post(`${relationPath(personRelationId)}/confirm`).type('form')
      .send({ person_id: neighborPersonId, field: 'phone' });
    expect(ownRelation.status, JSON.stringify(ownRelation.body)).toBe(404);
    expect(await personState(neighborPersonId, neighborCompanyId)).toEqual(before);
  });

  it('P5 ett fält utanför personens schema ger felnotis utan skrivning', async () => {
    const before = await personState(petraId);
    const res = await ua.post(`${relationPath(personRelationId)}/confirm`).type('form')
      .send({ person_id: petraId, field: 'website', back: relationPath(personRelationId) });
    expect(res.status, JSON.stringify(res.body)).toBe(302);
    expect(res.headers.location).toContain(`${relationPath(personRelationId)}?fel=`);
    const page = await ua.get(res.headers.location as string);
    expect(page.status, JSON.stringify(page.body)).toBe(200);
    expect(page.text).toContain('Något i formuläret gick inte att spara');
    expect(await personState(petraId)).toEqual(before);
  });

  it('P6 en person med fyra human-fält visas helt omärkt utan formulär', async () => {
    const person = personMarkup(await originPage(personRelationId), 'Helena Människa');
    expect(person).toContain('070-000 00 02');
    expect(person).not.toContain('class="prov');
    expect(person).not.toContain('<form');
  });
});

describe('Story 1.3: bara människan kan bekräfta ett fält', () => {
  it('A1 agent-token kan inte bekräfta personens roll eller ändra dess ursprung', async () => {
    const before = await personState(petraId);
    expect(before.provenance.find((row) => row.field === 'role_title')?.source).toBe('ai');
    const res = await originAgentAct('confirm_crm_value', { person_id: petraId, field: 'role_title' });
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(res.body.error).toBe('human_confirmation_required');
    expect(await personState(petraId)).toEqual(before);
  });

  it('A2 agent-token kan inte bekräfta organisationens status eller ändra dess ursprung', async () => {
    const before = await act('get_crm_organization', { organization_id: s3Id });
    expect(before.status, JSON.stringify(before.body)).toBe(200);
    expect(before.body.result.provenance.status.source).toBe('ai');
    const res = await originAgentAct('confirm_crm_value', { organization_id: s3Id, field: 'status' });
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(res.body.error).toBe('human_confirmation_required');
    const after = await act('get_crm_organization', { organization_id: s3Id });
    expect(after.status, JSON.stringify(after.body)).toBe(200);
    expect(after.body.result.provenance).toEqual(before.body.result.provenance);
    expect(after.body.result.provenance.status.source).toBe('ai');
  });
});
