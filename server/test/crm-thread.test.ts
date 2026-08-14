// Relationsytan F3 — en enda kronologi.
//
// Den mest citerade kritiken i hela CRM-fältet gäller SuiteCRM: att man "måste
// gå igenom varje underpanel och själv lista ut ordningen". Odoos svar är en
// enda tråd. Vårt svar är samma tråd PLUS det ingen konkurrent kan visa:
// fakturan och betalningen ligger i samma kronologi som mailet, för att
// bokföringen och relationen bor i samma system.
//
// Det är precis den egenskapen testerna nedan mäter.
import supertest from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { api, app, createCompany, createFiscalYear, registerUser, type TestUser } from './helpers.js';

const PASSWORD = 'mycket-hemligt-losen-123';
let user: TestUser;
let companyId: string;
let customerId: string;
let orgId: string;
let ua: ReturnType<typeof supertest.agent>;
const auth = () => ({ Authorization: `Bearer ${user.token}` });
const co = () => `/api/companies/${companyId}`;
const act = (name: string, body: Record<string, unknown> = {}) =>
  api.post(`${co()}/actions/${name}`).set(auth()).send(body);

const trad = async (filter?: string): Promise<Record<string, unknown>[]> =>
  (await act('get_crm_thread', { organization_id: orgId, ...(filter ? { filter } : {}) })).body.result;

beforeAll(async () => {
  user = await registerUser('trad');
  companyId = await createCompany(user.token, 'Locollabs AB');
  await createFiscalYear(companyId, auth(), { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });

  const cust = await api.post(`${co()}/customers`).set(auth()).send({ name: 'Nordic Vision Retail AB' });
  expect(cust.status, JSON.stringify(cust.body)).toBe(201);
  customerId = cust.body.customer.id;

  // Kontaktpunkt och löfte via API-kontraktet.
  const ingest = await act('ingest_crm_events', {
    events: [
      {
        kind: 'interaction',
        organization: { name: 'Nordic Vision Retail AB' },
        person: { name: 'Eva Larsson', email: 'eva@nvr.example' },
        occurred_at: '2026-06-10T09:14:00Z', channel: 'email', direction: 'inbound',
        summary: 'Svar om pilotens omfattning.', source_system: 'gmail', source_ref: 'gmail:abc',
      },
      {
        kind: 'commitment',
        organization: { name: 'Nordic Vision Retail AB' },
        commitment_direction: 'we_owe', body: 'Skicka tidplan för fas 2.',
        due_date: '2026-06-20', occurred_at: '2026-06-11T09:20:00Z',
        source_system: 'gmail', source_ref: 'gmail:abc#c1',
      },
    ],
  });
  expect(ingest.status, JSON.stringify(ingest.body)).toBe(200);
  orgId = (await act('list_crm_organizations', {})).body.result
    .find((o: { name: string }) => o.name === 'Nordic Vision Retail AB').id;

  // Faktura, bokförd och betald — pengaspåret i tråden.
  const inv = await act('create_invoice', {
    customer_id: customerId, invoice_date: '2026-06-30', due_date: '2026-07-20',
    lines: [{ description: 'Projektledning', quantity: 91, unit: 'h', unit_price_ore: 110_000, vat_rate: 25 }],
  });
  expect(inv.status, JSON.stringify(inv.body)).toBe(200);
  const book = await act('book_invoice', { invoice_id: inv.body.result.id });
  const bokad = await api.post(`${co()}/approvals/${book.body.approval.id}/approve`).set(auth()).send({});
  expect(bokad.status, JSON.stringify(bokad.body)).toBe(200);

  const pay = await act('register_invoice_payment', {
    invoice_id: inv.body.result.id, payment_date: '2026-07-12', amount_ore: 12_512_500,
  });
  expect(pay.status, JSON.stringify(pay.body)).toBe(202);
  const betald = await api.post(`${co()}/approvals/${pay.body.approval.id}/approve`).set(auth()).send({});
  expect(betald.status, JSON.stringify(betald.body)).toBe(200);

  ua = supertest.agent(app);
  await ua.post('/app/login').type('form').send({ email: user.email, password: PASSWORD });
});

describe('pengar och samtal i samma kronologi', () => {
  it('tråden innehåller mail, löfte, faktura OCH betalning — i rätt ordning', async () => {
    const t = await trad();
    const kinds = t.map((e) => e.kind);
    expect(kinds).toContain('interaction');
    expect(kinds).toContain('commitment');
    expect(kinds).toContain('invoice');
    expect(kinds).toContain('payment');

    // Nyast först, och betalningen (12 juli) ligger före fakturan (30 juni).
    const datum = t.map((e) => String(e.at));
    expect([...datum].sort().reverse()).toEqual(datum);
    expect(kinds.indexOf('payment')).toBeLessThan(kinds.indexOf('invoice'));
  });

  it('fakturan bär sitt belopp, mailet bär sin källa', async () => {
    const t = await trad();
    const faktura = t.find((e) => e.kind === 'invoice')!;
    expect(faktura.amount_ore).toBe(12_512_500);
    expect(String(faktura.title)).toContain('Faktura 0000');

    const mail = t.find((e) => e.kind === 'interaction')!;
    expect(mail.source_system).toBe('gmail');
    expect(mail.source_ref).toBe('gmail:abc');
    expect(mail.who).toBe('Eva Larsson');
  });

  it('ett stängt löfte ger TVÅ rader — det gavs och det stängdes', async () => {
    const öppna = (await act('list_crm_commitments', { status: 'open' })).body.result;
    const klar = await ua.post(`/app/c/${companyId}/commitments/${öppna[0].id}/done`).type('form').send({});
    expect(klar.status).toBe(302);

    const t = await trad();
    expect(t.filter((e) => String(e.kind).startsWith('commitment'))).toHaveLength(2);
    expect(t.map((e) => e.kind)).toContain('commitment_closed');
  });
});

describe('filtren delar tråden utan att dölja något', () => {
  it('pengar visar bara faktura och betalning', async () => {
    const t = await trad('pengar');
    expect(t.length).toBeGreaterThan(0);
    expect(new Set(t.map((e) => e.kind))).toEqual(new Set(['invoice', 'payment']));
  });

  it('kontakt visar bara kontaktpunkter', async () => {
    const t = await trad('kontakt');
    expect(new Set(t.map((e) => e.kind))).toEqual(new Set(['interaction']));
  });

  it('löften visar båda löfteshändelserna', async () => {
    const t = await trad('loften');
    expect(new Set(t.map((e) => e.kind))).toEqual(new Set(['commitment', 'commitment_closed']));
  });
});

describe('relationssidan renderar tråden', () => {
  it('sex nyckeltal, tråd och filterflikar — allt utan skript', async () => {
    const res = await ua.get(`/app/c/${companyId}/relations/${orgId}`);
    expect(res.status).toBe(200);
    // Nyckeltalen är härledda ur bokföringen, inte inmatade.
    expect(res.text).toContain('Omsättning 12 mån');
    expect(res.text).toContain('Tyst i');
    // Tråden väver ihop de två världarna på samma sida.
    expect(res.text).toContain('Svar om pilotens omfattning.');
    expect(res.text).toContain('Betalning · faktura');
    expect(res.text).toContain('Skicka tidplan för fas 2.');
    // Filterflikarna är länkar.
    expect(res.text).toContain('?visa=pengar');
    expect(res.text).not.toContain('<script');
  });

  it('filterlänken filtrerar den renderade tråden', async () => {
    const res = await ua.get(`/app/c/${companyId}/relations/${orgId}?visa=pengar`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Betalning · faktura');
    expect(res.text).not.toContain('Svar om pilotens omfattning.');
  });

  it('tråden är tenant-isolerad', async () => {
    const other = await registerUser('tradannan');
    const otherCo = await createCompany(other.token, 'Annat AB');
    const res = await api.post(`/api/companies/${otherCo}/actions/get_crm_thread`)
      .set({ Authorization: `Bearer ${other.token}` }).send({ organization_id: orgId });
    expect(res.status).toBe(404);
  });
});
