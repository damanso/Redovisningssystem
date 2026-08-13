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
import { api, app, createCompany, createFiscalYear, registerUser, type TestUser } from './helpers.js';

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

  const link = await act('upsert_crm_organization', {
    name: 'Nordic Vision Retail AB', customer_id: bigCustomerId,
  });
  orgId = link.body.result.id;

  ua = supertest.agent(app);
  await ua.post('/app/login').type('form').send({ email: user.email, password: PASSWORD });
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
    expect(res.text).toContain('förfallet åtagande');
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
    const nav = res.text.slice(res.text.indexOf('<nav class="nav"'), res.text.indexOf('</nav>'));
    expect(nav).toContain(`href="/app/c/${companyId}/relations"`);
    expect(nav).toContain(`href="/app/c/${companyId}/commitments"`);
    expect(nav).toContain(`href="/app/c/${companyId}/steering"`);
  });
});
