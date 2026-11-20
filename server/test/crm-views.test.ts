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
import { readFile } from 'node:fs/promises';
import supertest from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { api, app, createCompany, createFiscalYear, registerUser, withAdmin, type TestUser } from './helpers.js';
import { staplabaraTabeller } from '../src/http/view/html.js';

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

// Story 1.2: händelsernas ursprung och rättelser, efter styrvyns omsättningsprov.
describe('1.2 händelser i tråden och åtagandevyn', () => {
  let v12Agent: string;
  let v12Neighbor: TestUser;
  let v12OtherCompany: string;
  let v12Org: string;
  let v12OtherOrg: string;
  let v12AIInteraction: string;
  let v12AICommitment: string;
  let v12OtherCommitment: string;
  let v12Orphan: string;
  let v12Foreign: string;
  const v12Base = () => `/app/c/${companyId}`;
  const v12Relation = () => `${v12Base()}/relations/${v12Org}`;
  async function v12Action(name: string, input: Record<string, unknown>, agent = false) {
    const response = await api.post(`${co()}/actions/${name}`)
      .set('Authorization', `Bearer ${agent ? v12Agent : user.token}`).send(input);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return response.body.result;
  }
  async function v12Ingest(events: Record<string, unknown>[]) {
    const result = await v12Action('ingest_crm_events', { events });
    expect(result.skipped).toEqual([]);
  }
  const v12IEvent = (ref: string, summary: string, name = 'Händelseprovet AB') => ({
    kind: 'interaction', organization: { name }, occurred_at: '2026-09-06T09:00:00Z',
    channel: 'email', direction: 'inbound', summary, source_system: 'gmail', source_ref: ref,
  });
  const v12CEvent = (ref: string, body: string, name = 'Händelseprovet AB') => ({
    kind: 'commitment', organization: { name }, occurred_at: '2026-09-06T09:05:00Z',
    commitment_direction: 'we_owe', body, due_date: '2026-10-30', source_system: 'linear', source_ref: ref,
  });
  async function v12Find(kind: 'interaction' | 'commitment', ref: string, company = companyId) {
    return withAdmin(async (db) => (await db.query(kind === 'interaction'
      ? 'SELECT id, summary, channel, direction, occurred_at::text FROM crm.interactions WHERE company_id = $1 AND source_ref = $2'
      : 'SELECT id, body, direction, due_date::text, occurred_at::text FROM crm.commitments WHERE company_id = $1 AND source_ref = $2',
    [company, ref])).rows[0]!);
  }
  async function v12Prov(kind: 'interaction' | 'commitment', id: string, company = companyId) {
    return withAdmin(async (db) => (await db.query(kind === 'interaction'
      ? 'SELECT field, source, reason, source_system, source_ref FROM crm.field_provenance WHERE company_id = $1 AND interaction_id = $2 ORDER BY field'
      : 'SELECT field, source, reason, source_system, source_ref FROM crm.field_provenance WHERE company_id = $1 AND commitment_id = $2 ORDER BY field', [company, id])).rows);
  }
  async function v12Audit(actionName: string, id: string) {
    return withAdmin(async (db) => (await db.query(
      'SELECT entity_type, details FROM crm.audit_log WHERE company_id = $1 AND entity_id = $2 AND action = $3 ORDER BY id DESC LIMIT 1',
      [companyId, id, actionName])).rows[0]);
  }
  async function v12Page(path: string) {
    const response = await ua.get(path);
    expect(response.status, response.text).toBe(200);
    return response.text;
  }
  function v12Event(pageText: string, text: string) {
    const fragment = pageText.match(/<li class="thread__ev">[\s\S]*?<\/li>/g)?.find((part) => part.includes(text));
    expect(fragment, `händelsen ${text}`).toBeDefined();
    return fragment!;
  }
  function v12TableRow(pageText: string, text: string) {
    // Husets tabellrendering lägger till radroller; attribut ändrar inte radens identitet.
    const fragment = pageText.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/g)?.find((part) => part.includes(text));
    expect(fragment, `raden ${text}`).toBeDefined();
    return fragment!;
  }
  describe('radval i åtagandeproven', () => {
    it.each(['', ' role="row"', ' class="vald"', ' data-id="lofte" role="row"'])('hittar rätt rad med attribut %s, före och efter husets tabellrendering', (attributes) => {
      const rows = [
        `<tr${attributes}><td>Vi lovade</td><td>Företag</td><td>Första löftet</td><td>Stämmer</td></tr>`,
        `<tr${attributes}><td>De lovade</td><td>Privat</td><td>Andra löftet</td><td>Rätta</td></tr>`,
      ];
      const table = `<table><thead><tr><th>Riktning</th><th>Sfär</th><th>Vad</th><th>Handling</th></tr></thead><tbody>${rows.join('')}</tbody></table>`;
      for (const render of [(value: string) => value, staplabaraTabeller]) {
        const pageText = render(table);
        for (const [index, text] of ['Första löftet', 'Andra löftet'].entries()) {
          // Rendera även facitraden, så cellernas etiketter och roller måste bevaras.
          const expected = render(`<table><thead><tr><th>Riktning</th><th>Sfär</th><th>Vad</th><th>Handling</th></tr></thead><tbody>${rows[index]}</tbody></table>`)
            .match(/<tbody\b[^>]*>([\s\S]*?)<\/tbody>/)![1];
          expect(v12TableRow(pageText, text)).toBe(expected);
        }
        expect(() => v12TableRow(pageText, 'Saknat löfte')).toThrow('raden Saknat löfte');
      }
    });
  });
  function v12Fields(fragment: string, actionPath: string, key?: string, id?: string) {
    return (fragment.match(/<form\b[\s\S]*?<\/form>/g) ?? []).filter((form) =>
      form.includes(`action="${actionPath}"`) && (!key || form.includes(`name="${key}" value="${id}"`)))
      .map((form) => form.match(/name="field" value="([^"]+)"/)?.[1]).filter(Boolean).sort();
  }
  const v12Confirm = (input: Record<string, unknown>, relation = v12Org, company = companyId) =>
    ua.post(`/app/c/${company}/relations/${relation}/confirm`).type('form').send(input);
  beforeAll(async () => {
    const token = await api.post(`${co()}/agent-tokens`).set(auth()).send({ name: 'Händelseagenten' });
    expect(token.status, JSON.stringify(token.body)).toBe(201);
    v12Agent = token.body.token;
    v12Neighbor = await registerUser('handelse-granne');
    v12OtherCompany = await createCompany(v12Neighbor.token, 'Grannbolaget K AB');
    await v12Ingest([
      v12IEvent('gmail:k-sync', 'Synkat mail K.'), v12IEvent('gmail:k-tom', 'Mail utan ursprung K.'),
      v12IEvent('gmail:k-ratt', 'Synkat mail som rättas K.'), v12IEvent('gmail:k-en', 'Synkat mail med en gissning K.'),
      v12CEvent('linear:LOC-K1', 'Synkat löfte K1.'), v12CEvent('linear:LOC-K2', 'Synkat löfte som rättas K2.'),
      v12CEvent('linear:LOC-K3', 'Synkat löfte utan datum K3.'),
    ]);
    v12Org = (await v12Action('upsert_crm_organization', { name: 'Händelseprovet AB' })).id;
    const missing = await v12Find('interaction', 'gmail:k-tom');
    const one = await v12Find('interaction', 'gmail:k-en');
    await withAdmin(async (db) => {
      await db.query('DELETE FROM crm.field_provenance WHERE company_id = $1 AND interaction_id = $2', [companyId, missing.id]);
      await db.query(`UPDATE crm.field_provenance SET source = 'ai', reason = NULL, source_system = NULL, source_ref = NULL
        WHERE company_id = $1 AND interaction_id = $2 AND field = 'summary'`, [companyId, one.id]);
    });
    const noDate = await v12Find('commitment', 'linear:LOC-K3');
    await v12Action('update_crm_commitment', { commitment_id: noDate.id, due_date: null }, true);
    v12AIInteraction = (await v12Action('record_crm_interaction', {
      organization_id: v12Org, occurred_at: '2026-09-06T10:00:00Z', channel: 'note', direction: 'outbound',
      summary: 'AI:ts anteckning K.', source_system: 'manual',
    }, true)).id;
    v12AICommitment = (await v12Action('record_crm_commitment', {
      organization_id: v12Org, occurred_at: '2026-09-06T10:05:00Z', direction: 'we_owe',
      body: 'AI:ts löfte K.', due_date: '2026-11-02', source_system: 'manual',
    }, true)).id;
    await v12Action('log_contact', { organization_id: v12Org, channel: 'call', summary: 'Handloggat samtal K.' });
    v12OtherOrg = (await v12Action('upsert_crm_organization', { name: 'Annan Händelserelation AB' })).id;
    v12OtherCommitment = (await v12Action('record_crm_commitment', {
      organization_id: v12OtherOrg, occurred_at: '2026-09-06T10:10:00Z', direction: 'we_owe', body: 'Annat AI-löfte K.', source_system: 'manual',
    }, true)).id;
    const orphanPerson = (await v12Action('upsert_crm_person', { name: 'Relationslös Person K', email: 'relationslos@k.example' }, true)).id;
    v12Orphan = (await v12Action('record_crm_commitment', {
      person_id: orphanPerson, occurred_at: '2026-09-06T10:15:00Z', direction: 'we_owe',
      body: 'Relationslöst AI-löfte K.', due_date: '2026-11-02', source_system: 'manual',
    }, true)).id;
    const foreign = await api.post(`/api/companies/${v12OtherCompany}/actions/ingest_crm_events`)
      .set('Authorization', `Bearer ${v12Neighbor.token}`).send({ events: [v12IEvent('gmail:k-granne', 'Grannens mail K.', 'Grannens Händelserelation AB')] });
    expect(foreign.status, JSON.stringify(foreign.body)).toBe(200);
    expect(foreign.body.result.skipped).toEqual([]);
    v12Foreign = (await v12Find('interaction', 'gmail:k-granne', v12OtherCompany)).id;
  });
  describe('märket på händelser', () => {
    it('K1 varje AI-fält har tillgängligt märke och eget bekräftelseformulär i tråden', async () => {
      const pageText = await v12Page(v12Relation());
      const interaction = v12Event(pageText, 'AI:ts anteckning K.');
      const commitment = v12Event(pageText, 'AI:ts löfte K.');
      for (const fragment of [interaction, commitment]) {
        expect(fragment).toContain('role="img"');
        expect(fragment).toContain('aria-label="Inte bekräftad av dig"');
      }
      expect(v12Fields(interaction, `${v12Relation()}/confirm`, 'interaction_id', v12AIInteraction)).toEqual(['channel', 'direction', 'occurred_at', 'summary']);
      expect(v12Fields(commitment, `${v12Relation()}/confirm`, 'commitment_id', v12AICommitment)).toEqual(['body', 'direction', 'due_date', 'occurred_at']);
    });
    it('K2 negativ kontroll: sync och saknat ursprung ger inga gissningsmärken', async () => {
      const pageText = await v12Page(v12Relation());
      for (const [kind, ref, text] of [
        ['interaction', 'gmail:k-sync', 'Synkat mail K.'], ['commitment', 'linear:LOC-K1', 'Synkat löfte K1.'],
        ['interaction', 'gmail:k-tom', 'Mail utan ursprung K.'],
      ] as const) {
        const fragment = v12Event(pageText, text);
        expect(fragment).not.toContain('prov--guess');
        expect(fragment).not.toContain('ursprung okänt');
        expect(v12Fields(fragment, `${v12Relation()}/confirm`, `${kind}_id`, (await v12Find(kind, ref)).id)).toEqual([]);
      }
    });
    it('K3 åtagandevyn visar bara gissningar på AI-löften', async () => {
      const pageText = await v12Page(`${v12Base()}/commitments?status=open`);
      const ai = v12TableRow(pageText, 'AI:ts löfte K.');
      expect(ai).toContain('prov--guess');
      expect(v12Fields(ai, `${v12Relation()}/confirm`, 'commitment_id', v12AICommitment)).toEqual(['body', 'direction', 'due_date', 'occurred_at']);
      const sync = v12TableRow(pageText, 'Synkat löfte K1.');
      expect(sync).not.toContain('prov--guess');
      expect(v12Fields(sync, `${v12Relation()}/confirm`)).toEqual([]);
    });
    it('K4 Stämmer bekräftar bara valt fält, auditerar och återgår till samma läge', async () => {
      const response = await v12Confirm({ commitment_id: v12AICommitment, field: 'body', back: v12Relation() });
      expect(response.status, response.text).toBe(302);
      expect(response.headers.location).toBe(v12Relation());
      expect((await v12Prov('commitment', v12AICommitment)).find((p) => p.field === 'body')).toMatchObject({ source: 'human', reason: 'bekräftad av människa' });
      expect(await v12Audit('crm.value_confirmed', v12AICommitment)).toMatchObject({ entity_type: 'commitment', details: { field: 'body' } });
      const fragment = v12Event(await v12Page(v12Relation()), 'AI:ts löfte K.');
      expect(v12Fields(fragment, `${v12Relation()}/confirm`, 'commitment_id', v12AICommitment)).toEqual(['direction', 'due_date', 'occurred_at']);
    });
    it('K5 fel relation, bolag, id och flera mål ändrar inget ursprung', async () => {
      const before = await v12Prov('commitment', v12OtherCommitment);
      const own = await v12Prov('interaction', v12AIInteraction);
      const foreign = await v12Prov('interaction', v12Foreign, v12OtherCompany);
      for (const response of [
        await v12Confirm({ commitment_id: v12OtherCommitment, field: 'body' }),
        await v12Confirm({ interaction_id: v12AIInteraction, field: 'summary' }, v12Org, v12OtherCompany),
        await v12Confirm({ interaction_id: v12Foreign, field: 'summary' }),
        await v12Confirm({ interaction_id: 'inte-ett-id', field: 'summary' }),
      ]) expect(response.status, response.text).toBe(404);
      const multiple = await v12Confirm({ interaction_id: v12AIInteraction, commitment_id: v12OtherCommitment, field: 'direction' });
      expect(multiple.status, multiple.text).toBe(302);
      expect(multiple.headers.location).toContain('fel=');
      expect(await v12Prov('commitment', v12OtherCommitment)).toEqual(before);
      expect(await v12Prov('interaction', v12AIInteraction)).toEqual(own);
      expect(await v12Prov('interaction', v12Foreign, v12OtherCompany)).toEqual(foreign);
    });
    it('K6 en rättad källhändelse får rättad av dig, handloggade och orörda får det inte', async () => {
      const interaction = await v12Find('interaction', 'gmail:k-ratt');
      const commitment = await v12Find('commitment', 'linear:LOC-K2');
      await v12Action('update_crm_interaction', { interaction_id: interaction.id, summary: 'Rättad av David K.' });
      await v12Action('update_crm_commitment', { commitment_id: commitment.id, body: 'Rättat löfte K2.' });
      const pageText = await v12Page(v12Relation());
      const source = (fragment: string) => fragment.match(/<div class="thread__src">([\s\S]*?)<\/div>/)?.[1] ?? '';
      expect(source(v12Event(pageText, 'Rättad av David K.'))).toContain('· rättad av dig');
      expect(source(v12Event(pageText, 'Synkat mail K.'))).not.toContain('rättad av dig');
      expect(source(v12Event(pageText, 'Handloggat samtal K.'))).not.toContain('rättad av dig');
      const list = await v12Page(`${v12Base()}/commitments?status=open`);
      expect(v12TableRow(list, 'Rättat löfte K2.')).toContain('rättad av dig');
      expect(v12TableRow(list, 'Synkat löfte K1.')).not.toContain('rättad av dig');
    });
    it('K7 ett AI-fält ger exakt ett märke, också när agenten tog bort datumet', async () => {
      const pageText = await v12Page(v12Relation());
      const one = v12Event(pageText, 'Synkat mail med en gissning K.');
      expect(one.match(/prov--guess/g)).toHaveLength(1);
      expect(v12Fields(one, `${v12Relation()}/confirm`, 'interaction_id', (await v12Find('interaction', 'gmail:k-en')).id)).toEqual(['summary']);
      const noDate = v12Event(pageText, 'Synkat löfte utan datum K3.');
      expect(noDate.match(/prov--guess/g)).toHaveLength(1);
      expect(v12Fields(noDate, `${v12Relation()}/confirm`, 'commitment_id', (await v12Find('commitment', 'linear:LOC-K3')).id)).toEqual(['due_date']);
      expect(noDate).toContain('<span class="k">Senast</span><span class="v">—');
    });
    it('K8 relationslösa löften har egen Stämmer, tenant-isolering och ingen Rätta', async () => {
      const back = `${v12Base()}/commitments?status=open`;
      const path = `${v12Base()}/commitments/${v12Orphan}/confirm`;
      const fragment = v12TableRow(await v12Page(back), 'Relationslöst AI-löfte K.');
      expect(fragment).toContain('prov--guess');
      expect(fragment).toContain('role="img"');
      expect(v12Fields(fragment, path)).toEqual(['body', 'direction', 'due_date', 'occurred_at']);
      expect(fragment).not.toMatch(/<form[^>]*action="[^"]*\/relations\//);
      expect(fragment).not.toContain('rattaform');
      const response = await ua.post(path).type('form').send({ field: 'body', back });
      expect(response.status, response.text).toBe(302);
      expect(response.headers.location).toBe(back);
      expect((await v12Prov('commitment', v12Orphan)).find((p) => p.field === 'body')).toMatchObject({ source: 'human', reason: 'bekräftad av människa' });
      expect(await v12Audit('crm.value_confirmed', v12Orphan)).toMatchObject({ entity_type: 'commitment', details: { field: 'body' } });
      expect(v12Fields(v12TableRow(await v12Page(back), 'Relationslöst AI-löfte K.'), path)).toEqual(['direction', 'due_date', 'occurred_at']);
      const before = await v12Prov('commitment', v12Orphan);
      const other = await ua.post(`/app/c/${v12OtherCompany}/commitments/${v12Orphan}/confirm`).type('form').send({ field: 'direction' });
      expect(other.status, other.text).toBe(404);
      const invalidField = await ua.post(path).type('form').send({ field: 'summary', back });
      expect(invalidField.status, invalidField.text).toBe(302);
      expect(invalidField.headers.location).toContain('fel=');
      const invalidId = await ua.post(`${v12Base()}/commitments/inte-ett-id/confirm`).type('form').send({ field: 'body' });
      expect(invalidId.status, invalidId.text).toBe(404);
      expect(await v12Prov('commitment', v12Orphan)).toEqual(before);
    });
  });

  describe('Rätta händelser', () => {
    let v12FOrg: string;
    let v12F9: string;
    const v12FRelation = () => `${v12Base()}/relations/${v12FOrg}`;
    const v12Edit = (input: Record<string, unknown>, relation = v12FOrg, company = companyId) =>
      ua.post(`/app/c/${company}/relations/${relation}/edit`).type('form').send(input);
    const v12FForm = (body: string, dueDate = '2026-10-30') => ({
      body, fore_body: body, direction: 'we_owe', fore_direction: 'we_owe', due_date: dueDate, fore_due_date: dueDate,
      occurred_at: '2026-09-07', fore_occurred_at: '2026-09-07',
    });
    beforeAll(async () => {
      const customer = await api.post(`${co()}/customers`).set(auth()).send({ name: 'Rättaprovet AB' });
      expect(customer.status, JSON.stringify(customer.body)).toBe(201);
      const customerId = customer.body.customer.id;
      await v12Ingest([
        { ...v12IEvent('gmail:f1', 'Synkat mail F1.', 'Rättaprovet AB'), occurred_at: '2026-09-07T09:00:00Z' },
        { ...v12IEvent('gmail:f7', 'Synkat mail F7.', 'Rättaprovet AB'), occurred_at: '2026-09-07T09:00:00Z' },
        ...[
          ['1', 'Synkat löfte F1.'], ['2', 'Löfte som blir klart F2.'], ['3', 'Löfte vars datum tas bort F3.'],
          ['5', 'Löfte med framtida löftestid F5.'], ['6', 'Löfte lovat i dag F6.'], ['8', 'Oförändrat löfte F8.'], ['10', 'Löfte utan fore F10.'],
        ].map(([n, text]) => ({ ...v12CEvent(`linear:LOC-F${n}`, text!, 'Rättaprovet AB'),
          occurred_at: '2026-09-07T09:05:00Z', due_date: n === '3' ? '2026-10-31' : '2026-10-30' })),
        v12CEvent('linear:LOC-F9', 'Annat löfte F9.', 'Annan Rättarelation AB'),
      ]);
      v12FOrg = (await v12Action('upsert_crm_organization', { name: 'Rättaprovet AB' })).id;
      v12F9 = (await v12Find('commitment', 'linear:LOC-F9')).id;
      const done = await ua.post(`${v12Base()}/commitments/${(await v12Find('commitment', 'linear:LOC-F2')).id}/done`).type('form').send({});
      expect(done.status, done.text).toBe(302);
      await bookedInvoice(customerId, '2026-09-07', 1);
      const invoiceId = await withAdmin(async (db) => {
        const invoices = await db.query('SELECT id FROM invoices WHERE company_id = $1 AND customer_id = $2', [companyId, customerId]);
        expect(invoices.rows).toHaveLength(1);
        return invoices.rows[0]!.id;
      });
      const payment = await act('register_invoice_payment', { invoice_id: invoiceId, payment_date: '2026-09-08' });
      expect(payment.status, JSON.stringify(payment.body)).toBe(202);
      const approved = await api.post(`${co()}/approvals/${payment.body.approval.id}/approve`).set(auth()).send({});
      expect(approved.status, JSON.stringify(approved.body)).toBe(200);
    });
    it('F1 bara kontaktpunkten och löftet får hopfälld Rätta med etiketter och hint', async () => {
      const pageText = await v12Page(v12FRelation());
      const interaction = v12Event(pageText, 'Synkat mail F1.');
      const commitment = v12Event(pageText, 'Synkat löfte F1.');
      for (const [fragment, key, id] of [
        [interaction, 'interaction_id', (await v12Find('interaction', 'gmail:f1')).id],
        [commitment, 'commitment_id', (await v12Find('commitment', 'linear:LOC-F1')).id],
      ]) {
        expect(fragment.match(/<details class="rattaform">/g)).toHaveLength(1);
        expect(fragment).toContain('<summary>Rätta</summary>');
        expect(fragment).toContain(`action="${v12FRelation()}/edit"`);
        expect(fragment).toContain(`name="${key}" value="${id}"`);
        expect(fragment).toContain('Det du sparar här räknas som ditt beslut. Fält du inte ändrar fortsätter följa källan.');
      }
      for (const label of ['<label>Vad hände<input', '<label>Kanal<select', '<label>Riktning<select', '<label>Datum<input type="date"']) expect(interaction).toContain(label);
      for (const label of ['<label>Vad<input', '<label>Vem lovar<select', '<label>Senast<input type="date"', 'Inget förfallodatum', '<label>Lovades<input type="date"']) expect(commitment).toContain(label);
      const events = pageText.match(/<li class="thread__ev">[\s\S]*?<\/li>/g) ?? [];
      const closed = events.find((fragment) => fragment.includes('Löfte klart') && fragment.includes('Löfte som blir klart F2.'));
      expect(closed).toBeDefined();
      expect(closed).not.toContain('rattaform');
      expect(closed).not.toContain('rättad av dig');
      for (const text of ['Faktura ', 'Betalning · faktura']) expect(v12Event(pageText, text)).not.toContain('rattaform');
    });
    it('F2 Rätta finns i åtagandevyn under både Öppna och Klara', async () => {
      for (const [status, text, ref] of [['open', 'Synkat löfte F1.', 'linear:LOC-F1'], ['done', 'Löfte som blir klart F2.', 'linear:LOC-F2']]) {
        const fragment = v12TableRow(await v12Page(`${v12Base()}/commitments?status=${status}`), text!);
        expect(fragment).toContain('<details class="rattaform">');
        expect(fragment).toContain(`action="${v12FRelation()}/edit"`);
        expect(fragment).toContain(`name="commitment_id" value="${(await v12Find('commitment', ref!)).id}"`);
      }
    });
    it('F3 bara ändrad text skickas och back behåller trådens filter', async () => {
      const row = await v12Find('commitment', 'linear:LOC-F1');
      const back = `${v12FRelation()}?visa=loften`;
      const response = await v12Edit({ ...v12FForm('Synkat löfte F1.'), body: 'Davids text F3.', commitment_id: row.id, back });
      expect(response.status, response.text).toBe(302);
      expect(response.headers.location).toBe(back);
      expect(await v12Find('commitment', 'linear:LOC-F1')).toEqual({ ...row, body: 'Davids text F3.' });
      expect((await v12Prov('commitment', row.id)).map((p) => [p.field, p.source, p.source_ref]))
        .toEqual([['body', 'human', null], ['direction', 'sync', 'linear:LOC-F1'], ['due_date', 'sync', 'linear:LOC-F1'], ['occurred_at', 'sync', 'linear:LOC-F1']]);
      expect((await v12Audit('crm.commitment_corrected', row.id))?.details.fields).toEqual(['body']);
    });
    it('F4 Inget förfallodatum är ett uttryckligt beslut om bara datumet', async () => {
      const row = await v12Find('commitment', 'linear:LOC-F3');
      const response = await v12Edit({ ...v12FForm('Löfte vars datum tas bort F3.', '2026-10-31'), commitment_id: row.id, inget_forfallodatum: 'ja' });
      expect(response.status, response.text).toBe(302);
      expect(response.headers.location).not.toContain('fel=');
      expect((await v12Find('commitment', 'linear:LOC-F3')).due_date).toBeNull();
      expect((await v12Prov('commitment', row.id)).find((p) => p.field === 'due_date')?.source).toBe('human');
      expect((await v12Audit('crm.commitment_corrected', row.id))?.details.fields).toEqual(['due_date']);
    });
    it('F5 framtida löftestid ger svensk notis före första formuläret', async () => {
      const row = await v12Find('commitment', 'linear:LOC-F5');
      const back = `${v12Base()}/commitments?status=open`;
      const response = await v12Edit({ commitment_id: row.id, occurred_at: '2099-01-01', fore_occurred_at: '2026-09-07', back });
      expect(response.status, response.text).toBe(302);
      expect(response.headers.location?.startsWith(back)).toBe(true);
      expect(decodeURIComponent(response.headers.location ?? '')).toContain('Ett löfte kan inte ha getts i framtiden.');
      const pageText = await v12Page(response.headers.location ?? '');
      expect(pageText).toContain('<p class="notice">Ett löfte kan inte ha getts i framtiden.</p>');
      expect(pageText.indexOf('<p class="notice">')).toBeLessThan(pageText.indexOf('<details class="rattaform">'));
      expect(await v12Find('commitment', 'linear:LOC-F5')).toEqual(row);
    });
    it('F6 löftestid i dag godtas och ligger inte efter nuet', async () => {
      const row = await v12Find('commitment', 'linear:LOC-F6');
      const today = new Date().toISOString().slice(0, 10);
      const response = await v12Edit({ commitment_id: row.id, occurred_at: today, fore_occurred_at: '2026-09-07' });
      expect(response.status, response.text).toBe(302);
      expect(response.headers.location).not.toContain('fel=');
      const timestamp = new Date((await v12Find('commitment', 'linear:LOC-F6')).occurred_at);
      expect(timestamp.toISOString().slice(0, 10)).toBe(today);
      expect(timestamp.getTime()).toBeLessThanOrEqual(Date.now());
      expect((await v12Prov('commitment', row.id)).find((p) => p.field === 'occurred_at')?.source).toBe('human');
    });
    it('F7 bara kontaktpunktens kanal blir ett människobeslut', async () => {
      const row = await v12Find('interaction', 'gmail:f7');
      const response = await v12Edit({ interaction_id: row.id, summary: 'Synkat mail F7.', fore_summary: 'Synkat mail F7.',
        channel: 'call', fore_channel: 'email', direction: 'inbound', fore_direction: 'inbound', occurred_at: '2026-09-07', fore_occurred_at: '2026-09-07' });
      expect(response.status, response.text).toBe(302);
      expect(response.headers.location).not.toContain('fel=');
      expect(await v12Find('interaction', 'gmail:f7')).toEqual({ ...row, channel: 'call' });
      expect((await v12Prov('interaction', row.id)).map((p) => [p.field, p.source]))
        .toEqual([['channel', 'human'], ['direction', 'sync'], ['occurred_at', 'sync'], ['summary', 'sync']]);
      expect((await v12Audit('crm.interaction_corrected', row.id))?.details.fields).toEqual(['channel']);
    });
    it('F8 oförändrat formulär ger notis utan audit eller nytt ursprung', async () => {
      const row = await v12Find('commitment', 'linear:LOC-F8');
      const before = await v12Prov('commitment', row.id);
      const response = await v12Edit({ ...v12FForm('Oförändrat löfte F8.'), commitment_id: row.id });
      expect(response.status, response.text).toBe(302);
      expect(decodeURIComponent(response.headers.location ?? '')).toContain('Inget att rätta: inget fält ändrades.');
      expect(await v12Prov('commitment', row.id)).toEqual(before);
      expect(await v12Audit('crm.commitment_corrected', row.id)).toBeUndefined();
    });
    it('F9 fel relation, bolag, id, flera mål och främmande Origin ger ingen skrivning', async () => {
      const row = await v12Find('commitment', 'linear:LOC-F9');
      const before = await v12Prov('commitment', v12F9);
      for (const response of [
        await v12Edit({ commitment_id: v12F9, body: 'Fel relation' }),
        await v12Edit({ commitment_id: v12F9, body: 'Fel bolag' }, v12FOrg, v12OtherCompany),
        await v12Edit({ commitment_id: 'inte-ett-id', body: 'Fel id' }),
      ]) expect(response.status, response.text).toBe(404);
      const two = await v12Edit({ commitment_id: v12F9, interaction_id: v12AIInteraction, body: 'Två mål' });
      expect(two.status, two.text).toBe(302);
      expect(two.headers.location).toContain('fel=');
      const own = await v12Find('commitment', 'linear:LOC-F1');
      const ownProv = await v12Prov('commitment', own.id);
      const csrf = await ua.post(`${v12FRelation()}/edit`).set('Origin', 'https://angripare.example').type('form')
        .send({ ...v12FForm('Davids text F3.'), commitment_id: own.id, body: 'Angriparens text' });
      expect(csrf.status, csrf.text).toBe(403);
      expect(await v12Find('commitment', 'linear:LOC-F9')).toEqual(row);
      expect(await v12Prov('commitment', v12F9)).toEqual(before);
      expect(await v12Find('commitment', 'linear:LOC-F1')).toEqual(own);
      expect(await v12Prov('commitment', own.id)).toEqual(ownProv);
    });
    it('F10 negativ kontroll: utan fore-fälten skickas alla fyra fält', async () => {
      const row = await v12Find('commitment', 'linear:LOC-F10');
      const response = await v12Edit({ commitment_id: row.id, body: 'Löfte utan fore F10.', direction: 'we_owe', due_date: '2026-10-30', occurred_at: '2026-09-07' });
      expect(response.status, response.text).toBe(302);
      expect(response.headers.location).not.toContain('fel=');
      expect((await v12Prov('commitment', row.id)).map((p) => [p.field, p.source]))
        .toEqual([['body', 'human'], ['direction', 'human'], ['due_date', 'human'], ['occurred_at', 'human']]);
      expect((await v12Audit('crm.commitment_corrected', row.id))?.details.fields).toEqual(['body', 'direction', 'due_date', 'occurred_at']);
    });
  });
});

// Story 1.4: riktiga vy- och actionanrop, med separata relationer per skrivfall.
describe('1.4 kundkopplingen på relationssidan', () => {
  let ett: string, tva: string, tre: string, fyra: string, fem: string, sex: string;
  let vilande: string, avslutad: string, match: string, grannkund: string, grannrelation: string;
  let N: string, N2: string, N3: string, B: string, B2: string, U: string, V: string;
  let P: string, M: string, C: string, E: string, X: string, Y: string, R: string;

  async function v14Kund(name: string): Promise<string> {
    const r = await api.post(`${co()}/customers`).set(auth()).send({ name });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    return r.body.customer.id as string;
  }
  async function v14Form(id: string): Promise<Record<string, string>> {
    const o = await lasK1Org(id);
    const form: Record<string, string> = {};
    for (const field of ['name', 'org_number', 'website', 'status', 'customer_id', 'roll']) {
      form[field] = o[field] ?? '';
      form[`fore_${field}`] = o[field] ?? '';
    }
    return form;
  }
  const v14Edit = (id: string, falt: Record<string, unknown>, bolag = companyId) =>
    ua.post(`/app/c/${bolag}/relations/${id}/edit`).type('form')
      .send({ ...falt, back: `/app/c/${bolag}/relations/${id}` });
  const v14Audit = (id: string) => withAdmin(async (client) => {
    const r = await client.query(`SELECT count(*)::int AS n FROM crm.audit_log
      WHERE company_id = $1 AND entity_id = $2 AND action = 'crm.organization_updated'`, [companyId, id]);
    return r.rows[0]!.n as number;
  });
  function v14Val(sidan: string): string {
    const val = /<select name="customer_id">[\s\S]*?<\/select>/.exec(sidan)?.[0];
    expect(val, 'kundvalet saknas').toBeDefined();
    return val!;
  }
  function v14Alternativ(val: string): Array<{ value: string; selected: boolean; text: string }> {
    return [...val.matchAll(/<option value="([^"]*)"([^>]*)>([\s\S]*?)<\/option>/g)]
      .map((m) => ({ value: m[1]!, selected: /\bselected\b/.test(m[2]!), text: m[3]! }));
  }
  const v14Facit = (nuvarande: string | null) => withAdmin(async (client) => {
    const r = await client.query<{ id: string }>(`SELECT id FROM customers
      WHERE company_id = $1 AND (is_active OR id = $2) ORDER BY customer_number`, [companyId, nuvarande]);
    return r.rows.map((c) => c.id);
  });

  beforeAll(async () => {
    ett = await v14Kund('Kund Ett 14 AB');
    tva = await v14Kund('Kund Två 14 AB');
    tre = await v14Kund('Kund Tre 14 AB');
    fyra = await v14Kund('Kund Fyra 14 AB');
    fem = await v14Kund('Kund Fem 14 AB');
    sex = await v14Kund('Kund Sex 14 AB');
    vilande = await v14Kund('Vilande Kund 14 AB');
    avslutad = await v14Kund('Avslutad Kund 14 AB');
    N = await nyK1Org('Nykoppling 14 AB');
    N2 = await nyK1Org('Okopplad 14 AB');
    N3 = await nyK1Org('Huvudet 14 AB');
    B = await nyK1Org('Bytesbolaget 14 AB', { customer_id: ett });
    B2 = await nyK1Org('Bytes Två 14 AB', { customer_id: fem });
    U = await nyK1Org('Upptagna 14 AB', { customer_id: tre });
    V = await nyK1Org('Vilande 14 AB', { customer_id: vilande });
    P = await nyK1Org('Privata 14', { sfar: 'privat' });
    M = await nyK1Org('Namnbolaget 14 AB', { org_number: '556914-0001', website: 'https://namn14.example' });
    C = await nyK1Org('Kontrollbolaget 14 AB');
    E = await nyK1Org('Oförändrade 14 AB');
    X = await nyK1Org('Utan Namn 14 AB');
    Y = await nyK1Org('Ledig Relation 14 AB');
    R = await nyK1Org('Matchkund 14 AB');
    for (const customer_id of [vilande, avslutad]) {
      const r = await act('update_customer', { customer_id, is_active: false });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
    }
    match = await v14Kund('Matchkund 14 AB');
    const granne = await createCompany(user.token, 'Grannbolaget 14 AB');
    const kund = await api.post(`/api/companies/${granne}/customers`).set(auth()).send({ name: 'Grannkund 14 AB' });
    expect(kund.status, JSON.stringify(kund.body)).toBe(201);
    grannkund = kund.body.customer.id as string;
    const relation = await api.post(`/api/companies/${granne}/actions/upsert_crm_organization`)
      .set(auth()).send({ name: 'Grannrelation 14 AB' });
    expect(relation.status, JSON.stringify(relation.body)).toBe(200);
    grannrelation = relation.body.result.id as string;
  });

  describe('åtgärden (story 1.4)', () => {
    it('A1 status utan namn ändrar inte namnets ursprung', async () => {
      await plantera({ organization_id: X }, 'name', { source: 'sync', source_system: 'gmail', source_ref: 'gmail:a1' });
      const r = await act('upsert_crm_organization', { organization_id: X, status: 'partner' });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(r.body.result.name).toBe('Utan Namn 14 AB');
      const o = await lasK1Org(X);
      expect(o.status).toBe('partner');
      expect(o.provenance.status.source).toBe('human');
      expect(o.provenance.name).toMatchObject({ source: 'sync', source_ref: 'gmail:a1' });
    });
    it('A2 tom rättelse ger nothing_to_update utan ursprungs- eller auditrad', async () => {
      const fore = await lasK1Org(X), audit = await v14Audit(X);
      const r = await act('upsert_crm_organization', { organization_id: X });
      expect(r.status, JSON.stringify(r.body)).toBe(400);
      expect(r.body.error).toBe('nothing_to_update');
      expect((await lasK1Org(X)).provenance).toEqual(fore.provenance);
      expect(await v14Audit(X)).toBe(audit);
    });
    it('A3 namn krävs vid skapande och blankt namn avvisas även med id', async () => {
      for (const input of [{}, { organization_id: X, name: '   ' }]) {
        const r = await act('upsert_crm_organization', input);
        expect(r.status, JSON.stringify(r.body)).toBe(400);
        expect(r.body.error).toBe('invalid_name');
      }
      expect((await lasK1Org(X)).name).toBe('Utan Namn 14 AB');
    });
    it('A4 ett uttryckligt kundval med matchande namn får human', async () => {
      const r = await act('upsert_crm_organization', { organization_id: R, name: 'Matchkund 14 AB', customer_id: match });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      const o = await lasK1Org(R);
      expect(o.customer_id).toBe(match);
      expect(o.provenance.customer_id.source).toBe('human');
    });
    it('A5 upptagen kund avvisas med relationens id och utan skrivning', async () => {
      const audit = await v14Audit(Y);
      const r = await act('upsert_crm_organization', { organization_id: Y, name: 'Ledig Relation 14 AB', customer_id: tre });
      expect(r.status, JSON.stringify(r.body)).toBe(409);
      expect(r.body).toEqual({ error: 'customer_already_linked', details: { organization_id: U } });
      expect((await lasK1Org(Y)).customer_id).toBeNull();
      expect(await v14Audit(Y)).toBe(audit);
    });
    it('A6 grannbolagets kund ger 404 utan koppling', async () => {
      const r = await act('upsert_crm_organization', { organization_id: Y, name: 'Ledig Relation 14 AB', customer_id: grannkund });
      expect(r.status, JSON.stringify(r.body)).toBe(404);
      expect((await lasK1Org(Y)).customer_id).toBeNull();
    });
    it('A7 upptagen kund kan inte skapa en ny relation', async () => {
      const r = await act('upsert_crm_organization', { name: 'Ny Relation 14 AB', customer_id: tre });
      expect(r.status, JSON.stringify(r.body)).toBe(409);
      expect(r.body.error).toBe('customer_already_linked');
      await withAdmin(async (client) => {
        const found = await client.query('SELECT id FROM crm.organizations WHERE company_id = $1 AND name = $2', [companyId, 'Ny Relation 14 AB']);
        expect(found.rows).toEqual([]);
      });
    });
    it('A8 ändrat actionkontrakt dokumenteras i eget avsnitt och Människan vinner', async () => {
      const actions = await readFile(new URL('../../docs/MCP_ACTIONS.md', import.meta.url), 'utf8');
      const rubrik = '## Kundkopplingen på relationssidan (crm 1.4)';
      expect(actions.split(rubrik)).toHaveLength(2);
      expect(actions.indexOf(rubrik)).toBeGreaterThan(actions.indexOf('## Rätta och bekräfta händelser (crm 1.2)'));
      const avsnitt = actions.split(rubrik)[1]!.split(/\n## /)[0]!;
      for (const namn of ['upsert_crm_organization', 'organization_id', 'customer_id', 'nothing_to_update', 'customer_already_linked', 'human']) {
        expect(avsnitt).toContain('`' + namn + '`');
      }
      expect(avsnitt).not.toMatch(/^### /m);
      const kontrakt = await readFile(new URL('../../docs/crm/API_KONTRAKT.md', import.meta.url), 'utf8');
      expect(kontrakt.split('## Människan vinner')[1]!.split(/\n## /)[0]).toContain('customer_already_linked');
    });

    it.each([
      { field: 'name', value: 'Rättat matchnamn 14 AB' },
      { field: 'org_number', value: '556914-0091' },
      { field: 'website', value: 'https://rattat14.example' },
      { field: 'status', value: 'partner' },
      { field: 'roll', value: 'kund' },
    ])('A9 manuell rättelse av $field lämnar utelämnad kundkoppling och övriga fält orörda', async ({ field, value }) => {
      const id = await nyK1Org(`Rättelse ${field} 14 AB`);
      // Kunden tillkommer efter relationen: en ofarlig rättelse får inte börja
      // koppla bara för att registret har ändrats sedan relationen skapades.
      const customer = await api.post(`${co()}/customers`).set(auth()).send({
        name: field === 'name' ? value : `Rättelse ${field} 14 AB`,
        ...(field === 'org_number' ? { name: 'Nummermatch 14 AB', org_number: value } : {}),
      });
      expect(customer.status, JSON.stringify(customer.body)).toBe(201);
      for (const f of ['name', 'status']) await plantera({ organization_id: id }, f,
        { source: 'sync', source_system: 'gmail', source_ref: `gmail:a9:${field}` });
      const fore = await lasK1Org(id);
      const r = await act('upsert_crm_organization', { organization_id: id, [field]: value });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      const efter = await lasK1Org(id);
      expect(efter[field]).toBe(value);
      expect(efter.provenance[field].source).toBe('human');
      for (const untouched of ['name', 'org_number', 'website', 'status', 'customer_id', 'roll'].filter((f) => f !== field)) {
        expect(efter[untouched], untouched).toBe(fore[untouched]);
        expect(efter.provenance[untouched], untouched).toEqual(fore.provenance[untouched]);
      }
      expect(efter.customer_id).toBeNull();
    });

    it.each([
      { key: 'namn', existing: false, org_number: undefined },
      { key: 'orgnr', existing: false, org_number: '556914-0092' },
      { key: 'namn', existing: true, org_number: undefined },
      { key: 'orgnr', existing: true, org_number: '556914-0093' },
    ])('A10 synken matchar fortfarande $key (befintlig relation: $existing)', async ({ key, existing, org_number }) => {
      const name = `Synk ${key} ${existing ? 'befintlig' : 'ny'} 14 AB`;
      const id = existing ? await nyK1Org(name) : undefined;
      if (id) await plantera({ organization_id: id }, 'status', { source: 'sync' });
      const customer = await api.post(`${co()}/customers`).set(auth()).send({
        name: org_number ? `Nummerkund ${org_number} 14 AB` : name,
        ...(org_number ? { org_number } : {}),
      });
      expect(customer.status, JSON.stringify(customer.body)).toBe(201);
      const r = await act('ingest_crm_events', { events: [{
        kind: 'interaction', organization: { name, ...(org_number ? { org_number } : {}) },
        occurred_at: '2026-06-10T09:14:00Z', channel: 'email', direction: 'inbound',
        summary: 'Synkens kunduppslag.', source_system: 'gmail', source_ref: `gmail:a10:${key}:${existing}`,
      }] });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      const rows = await withAdmin(async (client) => (await client.query<{ id: string }>(
        'SELECT id FROM crm.organizations WHERE company_id = $1 AND name = $2', [companyId, name],
      )).rows);
      expect(rows).toHaveLength(1);
      if (id) expect(rows[0]!.id).toBe(id);
      const o = await lasK1Org(rows[0]!.id);
      expect(o.customer_id).toBe(customer.body.customer.id);
      expect(o.status).toBe('customer');
      expect(o.provenance.customer_id).toMatchObject({
        source: 'accounting', reason: org_number ? 'matchad på organisationsnummer' : 'matchad på namn i kundregistret',
      });
    });
  });

  describe('vyn (story 1.4)', () => {
    it('K1 kundvalets ordning, förval, inaktiv nuvarande kund och okopplat läge', async () => {
      const kopplad = await sida(U);
      const alternativ = v14Alternativ(v14Val(kopplad));
      expect(alternativ.map((a) => a.value)).toEqual(await v14Facit(tre));
      expect(alternativ.filter((a) => a.selected).map((a) => a.value)).toEqual([tre]);
      expect(alternativ.map((a) => a.value)).not.toContain('');
      expect(alternativ.map((a) => a.value)).not.toContain(avslutad);
      expect(alternativ.map((a) => a.value)).not.toContain(grannkund);
      expect(alternativ.findIndex((a) => a.value === ett)).toBeLessThan(alternativ.findIndex((a) => a.value === tva));
      expect(alternativ.findIndex((a) => a.value === tva)).toBeLessThan(alternativ.findIndex((a) => a.value === tre));
      expect(alternativ.find((a) => a.value === ett)?.text).toContain('Kund Ett 14 AB');
      expect(kopplad).toContain(`name="fore_customer_id" value="${tre}"`);
      const form = kopplad.split('<summary>Rätta uppgifter</summary>')[1]!.split('</form>')[0]!;
      expect(form).toContain('Det du sparar här räknas som ditt beslut. Fält du inte ändrar fortsätter följa källan.');
      expect(kopplad).not.toContain('Ingen synk skriver över det efteråt');
      expect(form).toContain('<label>Kund i registret<select name="customer_id">');
      expect(form).not.toMatch(/name="name"[^>]*required/);

      const inaktiv = v14Alternativ(v14Val(await sida(V)));
      expect(inaktiv.map((a) => a.value)).toEqual(await v14Facit(vilande));
      expect(inaktiv.filter((a) => a.selected)).toEqual([{ value: vilande, selected: true, text: expect.stringContaining('Vilande Kund 14 AB (inaktiv)') }]);
      expect(inaktiv.map((a) => a.value)).not.toContain(avslutad);
      const okopplad = await sida(N3), val = v14Val(okopplad);
      expect(val).toMatch(/<select name="customer_id">\s*<option value="" selected>Ingen koppling<\/option>/);
      const utan = v14Alternativ(val);
      expect(utan[0]).toEqual({ value: '', selected: true, text: 'Ingen koppling' });
      expect(utan.slice(1).map((a) => a.value)).toEqual(await v14Facit(null));
      expect(okopplad).toContain('name="fore_customer_id" value=""');
    });
    it('K2 vald kund kopplas med human och raden visas utan gissningsmärke', async () => {
      for (const field of ['name', 'status']) await plantera({ organization_id: N }, field,
        { source: 'sync', source_system: 'gmail', source_ref: 'gmail:k2' });
      const r = await v14Edit(N, { ...await v14Form(N), customer_id: fyra });
      expect(r.status, r.text).toBe(302);
      expect(r.headers.location).toBe(relationsadress(N));
      const o = await lasK1Org(N);
      expect(o.customer_id).toBe(fyra);
      expect(o.provenance.customer_id.source).toBe('human');
      expect(o.provenance.name.source).toBe('sync');
      expect(o.status).toBe('customer');
      const sidan = await sida(N), kundrad = rad(kort(sidan, 'Uppgifter'), 'Kund i registret');
      expect(kundrad).toContain('Kund Fyra 14 AB');
      expect(kundrad).not.toContain('class="prov');
      expect(stammerFalt(sidan, N)).not.toContain('customer_id');
    });
    it('K3 kundkrock syns som notis; främmande kund och relation ger 404 utan ändringar', async () => {
      const fore = await lasK1Org(N2), form = await v14Form(N2);
      const krock = await v14Edit(N2, { ...form, customer_id: tre });
      expect(krock.status, krock.text).toBe(302);
      expect(decodeURIComponent(krock.headers.location ?? '')).toContain('kunden är redan kopplad till relationen Upptagna 14 AB');
      const notis = await ua.get(krock.headers.location!);
      expect(notis.status, notis.text).toBe(200);
      expect(notis.text).toMatch(/<p class="notice">kunden är redan kopplad till relationen Upptagna 14 AB/);
      const kund = await v14Edit(N2, { ...form, customer_id: grannkund });
      expect(kund.status, kund.text).toBe(404);
      const relation = await v14Edit(grannrelation, { name: 'Kapad 14 AB', fore_name: 'Grannrelation 14 AB' });
      expect(relation.status, relation.text).toBe(404);
      const efter = await lasK1Org(N2);
      expect(efter.customer_id).toBeNull();
      expect(efter.provenance).toEqual(fore.provenance);
      await withAdmin(async (client) => {
        const r = await client.query('SELECT name FROM crm.organizations WHERE id = $1', [grannrelation]);
        expect(r.rows[0]!.name).toBe('Grannrelation 14 AB');
      });
    });
    it('K4 byte från A till B har samma statusväg som en ny koppling', async () => {
      await plantera({ organization_id: B }, 'status', { source: 'sync', source_system: 'gmail', source_ref: 'gmail:k4' });
      const r = await v14Edit(B, { ...await v14Form(B), customer_id: tva });
      expect(r.status, r.text).toBe(302);
      expect(r.headers.location).toBe(relationsadress(B));
      const o = await lasK1Org(B);
      expect(o.customer_id).toBe(tva);
      expect(o.provenance.customer_id.source).toBe('human');
      expect(o.status).toBe('customer');
      const kundrad = rad(kort(await sida(B), 'Uppgifter'), 'Kund i registret');
      expect(kundrad).toContain('Kund Två 14 AB');
      expect(kundrad).not.toContain('class="prov');
    });
    it('K5 upptagen B lämnar kopplingen till A och dess ursprung kvar', async () => {
      const fore = await lasK1Org(B2);
      const r = await v14Edit(B2, { ...await v14Form(B2), customer_id: tre });
      expect(r.status, r.text).toBe(302);
      expect(decodeURIComponent(r.headers.location ?? '')).toContain('kunden är redan kopplad till relationen Upptagna 14 AB');
      const efter = await lasK1Org(B2);
      expect(efter.customer_id).toBe(fem);
      expect(efter.provenance).toEqual(fore.provenance);
    });
    it('K6 bara ändrat namn blir human; orörda värden och ursprung står kvar', async () => {
      await v14Kund('Namnbolaget 14 Ny AB');
      for (const field of ['name', 'org_number', 'status']) await plantera({ organization_id: M }, field,
        { source: 'sync', source_system: 'gmail', source_ref: 'gmail:k6' });
      await plantera({ organization_id: M }, 'website', { source: 'ai' });
      const fore = await lasK1Org(M);
      const r = await v14Edit(M, { ...await v14Form(M), name: 'Namnbolaget 14 Ny AB' });
      expect(r.status, r.text).toBe(302);
      expect(r.headers.location).toBe(relationsadress(M));
      const efter = await lasK1Org(M);
      expect(efter.name).toBe('Namnbolaget 14 Ny AB');
      expect(efter.provenance.name.source).toBe('human');
      for (const field of ['org_number', 'website', 'status', 'customer_id']) expect(efter[field]).toBe(fore[field]);
      for (const field of ['org_number', 'website', 'status']) expect(efter.provenance[field]).toEqual(fore.provenance[field]);
      expect(efter.provenance.status.source).toBe('sync');
      expect(efter.provenance.customer_id).toBeUndefined();
      expect(efter.provenance.roll).toBeUndefined();
    });
    it('K7 privat relation avvisas av sfärgränsen utan koppling', async () => {
      const r = await v14Edit(P, { ...await v14Form(P), customer_id: sex });
      expect(r.status, r.text).toBe(302);
      expect(decodeURIComponent(r.headers.location ?? '')).toContain('en privat organisation kan inte kopplas till kundregistret');
      expect((await lasK1Org(P)).customer_id).toBeNull();
    });
    it('K8 negativ kontroll: utan fore-fält blir den orörda statusen human', async () => {
      await plantera({ organization_id: C }, 'status', { source: 'sync', source_system: 'gmail', source_ref: 'gmail:k8' });
      const r = await v14Edit(C, { name: 'Kontrollbolaget 14 AB', status: 'prospect' });
      expect(r.status, r.text).toBe(302);
      expect(r.headers.location).toBe(relationsadress(C));
      expect((await lasK1Org(C)).provenance.status.source).toBe('human');
    });
    it('K9 oförändrat formulär ger begriplig notis utan ursprung eller auditrad', async () => {
      const fore = await lasK1Org(E), audit = await v14Audit(E);
      const r = await v14Edit(E, await v14Form(E));
      expect(r.status, r.text).toBe(302);
      expect(decodeURIComponent(r.headers.location ?? '')).toContain('Inget att rätta: inget fält ändrades.');
      expect((await lasK1Org(E)).provenance).toEqual(fore.provenance);
      expect(await v14Audit(E)).toBe(audit);
    });
  });

  describe('sidhuvudet och adressen (story 1.4)', () => {
    it('O1 sidhuvudets länk öppnar bara Rätta uppgifter via adressen', async () => {
      const stangd = await sida(N3);
      const lank = `<a href="${relationsadress(N3)}?oppna=uppgifter">`;
      expect(stangd).toContain(lank);
      expect(stangd.split(lank)[1]!.split('</a>')[0]).toContain('Ej i kundregistret');
      expect(stangd).not.toContain('<details class="rattaform" open>');
      const oppen = await ua.get(`${relationsadress(N3)}?oppna=uppgifter`);
      expect(oppen.status, oppen.text).toBe(200);
      expect(oppen.text.split('<details class="rattaform" open>')).toHaveLength(2);
      const form = oppen.text.split('<details class="rattaform" open>')[1]!.split('</details>')[0]!;
      expect(form).toContain(`action="${relationsadress(N3)}/edit"`);
      expect(form).toContain('name="fore_customer_id"');
    });
    it('O2 kopplad relation har ingen Ej i kundregistret-länk', async () => {
      const sidan = await sida(U);
      expect(sidan).not.toContain('?oppna=uppgifter');
      expect(sidan).not.toContain('Ej i kundregistret');
    });
    it('O3 nio okända adresser ger 200 och ett stängt formulär', async () => {
      for (const fraga of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'dubblett', '', 'UPPGIFTER', 'uppgifter%20', 'uppgifter&oppna=uppgifter']) {
        const r = await ua.get(`${relationsadress(N3)}?oppna=${fraga}`);
        expect(r.status, r.text).toBe(200);
        expect(r.text, fraga).not.toContain('<details class="rattaform" open>');
      }
    });
  });
});
