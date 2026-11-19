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

// K1 (FR-9/FR-10): HTTP → vy/action → riktig databas. Facit är literaler,
// så samma fel i rendering och förväntan inte kan dölja en saknad knapp.
let k1AgentToken: string;
let statusOrg: string;
let olleId: string;
type Ursprung = {
  source: 'human' | 'accounting' | 'sync' | 'ai' | 'import';
  source_system?: string; source_ref?: string; reason?: string;
};
type Mal = { organization_id: string; companyId?: string } | { person_id: string; companyId?: string };

async function plantera(mal: Mal, falt: string, ursprung: Ursprung | null): Promise<void> {
  await withAdmin(async (client) => {
    const bolag = mal.companyId ?? companyId;
    if ('organization_id' in mal) {
      if (!ursprung) {
        await client.query('DELETE FROM crm.field_provenance WHERE company_id = $1 AND organization_id = $2 AND field = $3',
          [bolag, mal.organization_id, falt]);
      } else {
        await client.query(`INSERT INTO crm.field_provenance
          (company_id, organization_id, field, source, source_system, source_ref, reason)
          VALUES ($1,$2,$3,$4,$5,$6,$7)
          ON CONFLICT (company_id, organization_id, field) WHERE organization_id IS NOT NULL
          DO UPDATE SET source = EXCLUDED.source, source_system = EXCLUDED.source_system,
            source_ref = EXCLUDED.source_ref, reason = EXCLUDED.reason`,
        [bolag, mal.organization_id, falt, ursprung.source, ursprung.source_system ?? null,
          ursprung.source_ref ?? null, ursprung.reason ?? null]);
      }
    } else if (!ursprung) {
      await client.query('DELETE FROM crm.field_provenance WHERE company_id = $1 AND person_id = $2 AND field = $3',
        [bolag, mal.person_id, falt]);
    } else {
      await client.query(`INSERT INTO crm.field_provenance
        (company_id, person_id, field, source, source_system, source_ref, reason)
        VALUES ($1,$2,$3,$4,$5,$6,$7)
        ON CONFLICT (company_id, person_id, field) WHERE person_id IS NOT NULL
        DO UPDATE SET source = EXCLUDED.source, source_system = EXCLUDED.source_system,
          source_ref = EXCLUDED.source_ref, reason = EXCLUDED.reason`,
      [bolag, mal.person_id, falt, ursprung.source, ursprung.source_system ?? null,
        ursprung.source_ref ?? null, ursprung.reason ?? null]);
    }
  });
}

function kort(sida: string, rubrik: string): string {
  const start = sida.indexOf(`<div class="factcard__head">${rubrik}</div>`);
  expect(start, `kortet ${rubrik} saknas`).toBeGreaterThanOrEqual(0);
  const slut = sida.indexOf(rubrik === 'Uppgifter' ? '<details class="rattaform">' : '<div class="factcard__head">', start + 1);
  expect(slut).toBeGreaterThan(start);
  return sida.slice(start, slut);
}

function rad(innehall: string, etikett: string): string {
  const r = [...innehall.matchAll(/<div class="uppgift">[\s\S]*?<\/div>/g)]
    .find((m) => m[0].includes(`<span class="k">${etikett}</span>`))?.[0];
  expect(r, `raden ${etikett} saknas`).toBeDefined();
  return r!;
}

function person(innehall: string, namn: string): string {
  const p = [...innehall.matchAll(/<div class="person">[\s\S]*?<\/div>/g)]
    .find((m) => m[0].includes(namn))?.[0];
  expect(p, `personen ${namn} saknas`).toBeDefined();
  return p!;
}

function stammerFalt(sida: string, relation: string, personId?: string): string[] {
  return [...sida.matchAll(/<form\b[^>]*>[\s\S]*?<\/form>/g)]
    .map((m) => m[0])
    .filter((f) => f.includes(`action="/app/c/${companyId}/relations/${relation}/confirm"`)
      && f.includes('>Stämmer</button>')
      && (personId ? f.includes(`name="person_id" value="${personId}"`) : !f.includes('name="person_id"')))
    .map((f) => {
      const field = /name="field" value="([^"]+)"/.exec(f)?.[1];
      expect(field, f).toBeDefined();
      return field!;
    }).sort();
}

const relationsadress = (id: string) => `/app/c/${companyId}/relations/${id}`;
async function sida(id: string): Promise<string> {
  const r = await ua.get(relationsadress(id));
  expect(r.status, r.text).toBe(200);
  return r.text;
}
async function nyK1Org(name: string, input: Record<string, unknown> = {}): Promise<string> {
  const r = await act('upsert_crm_organization', { name, status: 'prospect', ...input });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body.result.id as string;
}
async function lasK1Org(id: string) {
  const r = await act('get_crm_organization', { organization_id: id });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body.result;
}
const bekrafta = (id: string, input: Record<string, unknown>) =>
  ua.post(`${relationsadress(id)}/confirm`).type('form').send({ ...input, back: relationsadress(id) });
const k1AgentAct = (name: string, input: Record<string, unknown>) =>
  api.post(`${co()}/actions/${name}`).set('Authorization', `Bearer ${k1AgentToken}`).send(input);

describe('K1: ursprunget i Uppgifter (story 1.3)', () => {
  let u: string;
  let t: string;
  let k: string;
  let o: string;
  let f: string;
  beforeAll(async () => {
    u = await nyK1Org('Ursprungsbolaget AB', { org_number: '556113-4301', website: 'https://ursprung.example' });
    t = await nyK1Org('Tomma Bolaget AB');
    const kund = await api.post(`${co()}/customers`).set(auth()).send({ name: 'Kopplade Vybolaget AB' });
    expect(kund.status, JSON.stringify(kund.body)).toBe(201);
    k = await nyK1Org('Kopplade Vybolaget AB', { customer_id: kund.body.customer.id, website: 'https://kopplad.example' });
    o = await nyK1Org('Okopplade Vybolaget AB', { org_number: '556113-4319', website: 'https://okopplad.example' });
    statusOrg = await nyK1Org('Statusbolaget AB');
    f = await nyK1Org('Förra Bolaget AB', { status: 'former' });
    const token = await api.post(`${co()}/agent-tokens`).set(auth()).send({ name: 'synk' });
    expect(token.status, JSON.stringify(token.body)).toBe(201);
    k1AgentToken = token.body.token;
  });

  it('U1 human är omärkt och saknar Stämmer', async () => {
    await plantera({ organization_id: u }, 'name', { source: 'human' });
    const html = await sida(u);
    expect(rad(kort(html, 'Uppgifter'), 'Namn')).not.toContain('class="prov');
    expect(stammerFalt(html, u)).not.toContain('name');
  });
  it('U2 accounting visar ur bokföringen utan Stämmer', async () => {
    await plantera({ organization_id: u }, 'website', { source: 'accounting', reason: 'kundregistret' });
    const html = await sida(u);
    expect(rad(kort(html, 'Uppgifter'), 'Webbplats')).toContain('>ur bokföringen</span>');
    expect(stammerFalt(html, u)).not.toContain('website');
  });
  it('U3 sync visar tillgängligt märke med källans namn och nyckel', async () => {
    await plantera({ organization_id: u }, 'name', { source: 'sync', source_system: 'gmail', source_ref: 'gmail:u3', reason: 'hämtad från gmail' });
    const html = await sida(u);
    expect(rad(kort(html, 'Uppgifter'), 'Namn')).toContain(' <span class="prov prov--guess" role="img" aria-label="Inte bekräftad av dig" title="Inte bekräftad av dig · Gmail · gmail:u3">✦</span>');
    expect(stammerFalt(html, u)).toContain('name');
    expect(html).not.toContain('· gmail ·');
  });
  it('U4 ai utan källa eller skäl använder den fasta texten', async () => {
    await plantera({ organization_id: u }, 'website', { source: 'ai' });
    const html = await sida(u);
    const r = rad(kort(html, 'Uppgifter'), 'Webbplats');
    expect(r).toContain('title="Inte bekräftad av dig · AI:ts tolkning"');
    expect(r).toContain('role="img"');
    expect(stammerFalt(html, u)).toContain('website');
  });
  it('U5 import visar skälet när källsystem saknas', async () => {
    await plantera({ organization_id: u }, 'org_number', { source: 'import', reason: 'importerad ur kundlistan' });
    const html = await sida(u);
    const r = rad(kort(html, 'Uppgifter'), 'Org.nr');
    expect(r).toContain('title="Inte bekräftad av dig · importerad ur kundlistan"');
    expect(r).toContain('role="img"');
    expect(stammerFalt(html, u)).toContain('org_number');
  });
  it('U6 ett värde utan ursprungsrad märks okänt och kan bekräftas', async () => {
    await plantera({ organization_id: u }, 'website', null);
    const html = await sida(u);
    const r = rad(kort(html, 'Uppgifter'), 'Webbplats');
    expect(r).toContain(' <span class="prov prov--fact" title="Skrevs innan ursprung började sparas — inte bekräftat av dig">ursprung okänt</span>');
    expect(r).not.toContain('✦');
    expect(stammerFalt(html, u)).toContain('website');
  });
  it('U7 ett tomt värde med ursprungsrad saknar märke och knapp', async () => {
    await plantera({ organization_id: t }, 'org_number', { source: 'sync' });
    const html = await sida(t);
    const r = rad(kort(html, 'Uppgifter'), 'Org.nr');
    expect(r).toContain('—');
    expect(r).not.toContain('class="prov');
    expect(stammerFalt(html, t)).not.toContain('org_number');
  });
  it('U8 tomma värden utan rad får varken okänt ursprung eller knapp', async () => {
    for (const field of ['website', 'customer_id']) await plantera({ organization_id: t }, field, null);
    const html = await sida(t);
    for (const label of ['Webbplats', 'Kund i registret']) {
      const r = rad(kort(html, 'Uppgifter'), label);
      expect(r).not.toContain('class="prov');
      expect(r).not.toContain('ursprung okänt');
    }
    expect(stammerFalt(html, t)).not.toContain('website');
    expect(stammerFalt(html, t)).not.toContain('customer_id');
  });
  it('Y1 Sfär och Roll står kvar efter Status och saknar Stämmer', async () => {
    await plantera({ organization_id: u }, 'sfar', { source: 'ai' });
    const html = await sida(u);
    const card = kort(html, 'Uppgifter');
    expect(rad(card, 'Sfär')).toContain('role="img"');
    expect(rad(card, 'Sfär')).toContain('✦');
    expect(rad(card, 'Sfär')).not.toContain('<form');
    expect(rad(card, 'Roll')).not.toContain('<form');
    expect(stammerFalt(html, u)).not.toContain('sfar');
    expect(stammerFalt(html, u)).not.toContain('roll');
    expect(card.indexOf(rad(card, 'Status'))).toBeLessThan(card.indexOf(rad(card, 'Sfär')));
  });
  it('S1 status från sync bär märke och Stämmer', async () => {
    await plantera({ organization_id: statusOrg }, 'status', { source: 'sync', source_system: 'gmail', source_ref: 'gmail:s1' });
    const html = await sida(statusOrg);
    const r = rad(kort(html, 'Uppgifter'), 'Status');
    expect(r).toContain('>Prospekt<');
    expect(r).toContain('role="img"');
    expect(r).toContain('title="Inte bekräftad av dig · Gmail · gmail:s1"');
    expect(stammerFalt(html, statusOrg)).toContain('status');
  });
  it('S2 bekräftad status är human och visas omärkt utan knapp', async () => {
    await plantera({ organization_id: statusOrg }, 'status', { source: 'sync', source_system: 'gmail', source_ref: 'gmail:s1' });
    const res = await bekrafta(statusOrg, { field: 'status' });
    expect(res.status, res.text).toBe(302);
    expect(res.headers.location).toBe(relationsadress(statusOrg));
    const html = await sida(statusOrg);
    expect(rad(kort(html, 'Uppgifter'), 'Status')).not.toContain('class="prov');
    expect(stammerFalt(html, statusOrg)).not.toContain('status');
    expect((await lasK1Org(statusOrg)).provenance.status).toMatchObject({ source: 'human', reason: 'bekräftad av människa' });
  });
  it('S3 agentens försök att skriva över bekräftad status redovisas', async () => {
    await plantera({ organization_id: statusOrg }, 'status', { source: 'sync' });
    const post = await bekrafta(statusOrg, { field: 'status' });
    expect(post.status, post.text).toBe(302);
    expect(post.headers.location).toBe(relationsadress(statusOrg));
    const res = await k1AgentAct('upsert_crm_organization', { organization_id: statusOrg, name: 'Statusbolaget AB', status: 'partner' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.result.kept_human_fields).toContain('status');
    const org = await lasK1Org(statusOrg);
    expect(org.status).toBe('prospect');
    expect(org.provenance.status.source).toBe('human');
  });
  it('S4 former visas som Tidigare på statusraden', async () => {
    const r = rad(kort(await sida(f), 'Uppgifter'), 'Status');
    expect(r).toContain('>Tidigare<');
    expect(r).not.toContain('>former<');
  });
  it('V1 kopplad relation har exakt fyra knappar och inga efter human', async () => {
    for (const [field, source] of [['name', 'sync'], ['website', 'ai'], ['customer_id', 'sync'], ['status', 'ai']] as const) {
      await plantera({ organization_id: k }, field, { source });
    }
    expect(stammerFalt(await sida(k), k)).toEqual(['customer_id', 'name', 'status', 'website']);
    for (const field of ['name', 'website', 'customer_id', 'status']) await plantera({ organization_id: k }, field, { source: 'human' });
    expect(stammerFalt(await sida(k), k)).toEqual([]);
  });
  it('V2 okopplad relation har exakt fyra knappar och inga efter human', async () => {
    for (const [field, source] of [['name', 'sync'], ['org_number', 'ai'], ['website', 'sync'], ['status', 'ai']] as const) {
      await plantera({ organization_id: o }, field, { source });
    }
    expect(stammerFalt(await sida(o), o)).toEqual(['name', 'org_number', 'status', 'website']);
    for (const field of ['name', 'org_number', 'website', 'status']) await plantera({ organization_id: o }, field, { source: 'human' });
    expect(stammerFalt(await sida(o), o)).toEqual([]);
  });
});

// Persongrenen prövas genom samma vy som organisationsbekräftelsen, så ett
// manipulerat person-id inte tyst kan bekräfta relationens namn i stället.
describe('K1: personerna (story 1.3)', () => {
  let r: string;
  let q: string;
  let piaId: string;
  let torId: string;
  let grannbolag: string;
  let gunnId: string;
  async function nyPerson(bolag: string, organization_id: string, name: string, input: Record<string, unknown> = {}) {
    const res = await api.post(`/api/companies/${bolag}/actions/upsert_crm_person`).set(auth())
      .send({ organization_id, name, ...input });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body.result.id as string;
  }
  async function piaUrsprung(): Promise<void> {
    await plantera({ person_id: piaId }, 'name', { source: 'sync', source_system: 'gmail', source_ref: 'gmail:p1' });
    await plantera({ person_id: piaId }, 'role_title', { source: 'ai' });
    await plantera({ person_id: piaId }, 'email', { source: 'human' });
    await plantera({ person_id: piaId }, 'phone', null);
  }
  const lasPia = async () => (await lasK1Org(r)).people.find((p: { id: string }) => p.id === piaId);

  beforeAll(async () => {
    r = await nyK1Org('Personbolaget AB', { website: 'https://personbolag.example' });
    q = await nyK1Org('Andra Personbolaget AB');
    piaId = await nyPerson(companyId, r, 'Pia Person', { role_title: 'Beställare', email: 'pia@personbolag.example', phone: '0701234567' });
    torId = await nyPerson(companyId, r, 'Tor Telefon', { phone: '0707654321' });
    olleId = await nyPerson(companyId, q, 'Olle Annan');
    grannbolag = await createCompany(user.token, 'Grannbolaget AB');
    const org = await api.post(`/api/companies/${grannbolag}/actions/upsert_crm_organization`).set(auth())
      .send({ name: 'Grannrelationen AB' });
    expect(org.status, JSON.stringify(org.body)).toBe(200);
    gunnId = await nyPerson(grannbolag, org.body.result.id, 'Gunn Granne');
  });

  it('P1 personens fyra fält har ursprung och exakt rätt Stämmer-formulär', async () => {
    await piaUrsprung();
    const html = await sida(r);
    const p = person(kort(html, 'Personer'), 'Pia Person');
    const namn = /<span class="person__n">[\s\S]*?<\/span>/.exec(p)?.[0];
    expect(namn).toContain('✦');
    expect(namn).toContain('title="Inte bekräftad av dig · Gmail · gmail:p1"');
    expect(/<span class="person__r">[\s\S]*?<\/span>/.exec(p)?.[0]).toContain('role="img"');
    const epost = /<span class="person__e">pia@personbolag.example[\s\S]*?<\/span>/.exec(p)?.[0];
    expect(epost).toBeDefined();
    expect(epost).not.toContain('class="prov');
    expect(p).toContain('0701234567 <span class="prov prov--fact"');
    expect(p).toContain('>ursprung okänt</span>');
    expect(stammerFalt(html, r, piaId)).toEqual(['name', 'phone', 'role_title']);
    const forms = [...p.matchAll(/<form\b[^>]*>[\s\S]*?<\/form>/g)].map((m) => m[0]);
    expect(forms).toHaveLength(3);
    for (const form of forms) {
      expect(form).toContain(`action="${relationsadress(r)}/confirm"`);
      expect(form).toContain(`name="person_id" value="${piaId}"`);
    }
  });
  it('P2 bekräftelsen skriver human och auditrad för personen', async () => {
    await piaUrsprung();
    const res = await bekrafta(r, { person_id: piaId, field: 'role_title' });
    expect(res.status, res.text).toBe(302);
    expect(res.headers.location).toBe(relationsadress(r));
    expect((await lasPia()).provenance.role_title.source).toBe('human');
    expect(stammerFalt(await sida(r), r, piaId)).not.toContain('role_title');
    const audit = await withAdmin(async (client) => (await client.query(
      `SELECT entity_type, entity_id, details FROM crm.audit_log
       WHERE company_id = $1 AND action = 'crm.value_confirmed' AND entity_type = 'person'
         AND entity_id = $2 AND details->>'field' = 'role_title'`, [companyId, piaId])).rows);
    expect(audit).toContainEqual({ entity_type: 'person', entity_id: piaId, details: { field: 'role_title' } });
  });
  it('P3 person i en annan relation ger 404 och orört ursprung', async () => {
    await plantera({ person_id: olleId }, 'name', { source: 'sync' });
    const res = await bekrafta(r, { person_id: olleId, field: 'name' });
    expect(res.status, res.text).toBe(404);
    const org = await lasK1Org(q);
    expect(org.people.find((p: { id: string }) => p.id === olleId).provenance.name.source).toBe('sync');
  });
  it('P4 person i annat bolag ger 404 och orört ursprung', async () => {
    await plantera({ person_id: gunnId, companyId: grannbolag }, 'name', { source: 'sync' });
    const res = await bekrafta(r, { person_id: gunnId, field: 'name' });
    expect(res.status, res.text).toBe(404);
    const prov = await withAdmin(async (client) => (await client.query(
      `SELECT source FROM crm.field_provenance WHERE company_id = $1 AND person_id = $2 AND field = 'name'`,
      [grannbolag, gunnId])).rows);
    expect(prov).toEqual([{ source: 'sync' }]);
  });
  it('P5 ogiltigt eller tomt person-id och fel fält ändrar inget ursprung', async () => {
    await piaUrsprung();
    await plantera({ organization_id: r }, 'name', { source: 'sync' });
    const fore = await lasK1Org(r);
    const piaFore = (await lasPia()).provenance;
    for (const person_id of ['inte-ett-id', '']) {
      const res = await bekrafta(r, { person_id, field: 'name' });
      expect(res.status, res.text).toBe(404);
      expect((await lasK1Org(r)).provenance.name.source).toBe('sync');
    }
    const fel = await bekrafta(r, { person_id: piaId, field: 'website' });
    expect(fel.status, fel.text).toBe(302);
    expect(fel.headers.location).toContain(`${relationsadress(r)}?fel=`);
    const notis = await ua.get(String(fel.headers.location));
    expect(notis.status, notis.text).toBe(200);
    expect(notis.text).toContain('class="notice"');
    const efter = await lasK1Org(r);
    expect(efter.provenance.website).toEqual(fore.provenance.website);
    const piaEfter = (await lasPia()).provenance;
    expect(piaEfter.website).toBeUndefined();
    expect(piaEfter).toEqual(piaFore);
  });
  it('P6 telefonen visas med källa och tomma fält skapar inga märken eller knappar', async () => {
    await plantera({ person_id: torId }, 'name', { source: 'human' });
    await plantera({ person_id: torId }, 'phone', { source: 'sync', source_system: 'calendar', source_ref: 'calendar:p6' });
    const html = await sida(r);
    const p = person(kort(html, 'Personer'), 'Tor Telefon');
    expect(p).toContain('0707654321');
    expect(p).toContain('title="Inte bekräftad av dig · Kalender · calendar:p6"');
    expect(p).not.toContain('person__r');
    expect(p).not.toContain('ursprung okänt');
    expect(stammerFalt(html, r, torId)).toEqual(['phone']);
  });
});

describe('K1: bara en människa bekräftar (story 1.3)', () => {
  it('A1 agenten kan inte bekräfta personens namn eller ändra ursprunget', async () => {
    await plantera({ person_id: olleId }, 'name', { source: 'sync' });
    const res = await k1AgentAct('confirm_crm_value', { person_id: olleId, field: 'name' });
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(res.body.error).toBe('human_confirmation_required');
    const prov = await withAdmin(async (client) => (await client.query(
      `SELECT source FROM crm.field_provenance WHERE company_id = $1 AND person_id = $2 AND field = 'name'`,
      [companyId, olleId])).rows);
    expect(prov).toEqual([{ source: 'sync' }]);
  });
  it('A2 agenten kan inte bekräfta organisationens status eller ändra ursprunget', async () => {
    await plantera({ organization_id: statusOrg }, 'status', { source: 'ai' });
    const res = await k1AgentAct('confirm_crm_value', { organization_id: statusOrg, field: 'status' });
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(res.body.error).toBe('human_confirmation_required');
    expect((await lasK1Org(statusOrg)).provenance.status.source).toBe('ai');
  });
});
