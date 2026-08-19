// CRM E4 — API-kontraktet och härledningsjobben.
//
// Två saker vaktas här, och de är projektets två största risker:
//
//   1. Synken måste tåla att köras om. Det förra CRM-försöket dog för att
//      ingen process behövde ytan; det NÄSTA dör om varje nattkörning lägger
//      dubbletter. Idempotensen mäts, den antas inte.
//   2. Systemet FÖRESLÅR. Det finns ingen väg härifrån ut till en kund —
//      inget mail, ingen påminnelse. Testet mäter utkorgen efter att förslagen
//      hämtats.
//
// Dessutom: "senaste kontakt" räknas på organisationen OCH dess personer, och
// aldrig ur tidrapportering (spärr 7 i briefen).
import supertest from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { api, app, createCompany, createFiscalYear, registerUser, withAdmin, type TestUser } from './helpers.js';

const PASSWORD = 'mycket-hemligt-losen-123';

let user: TestUser;
let companyId: string;
let customerId: string;
const auth = () => ({ Authorization: `Bearer ${user.token}` });
const co = () => `/api/companies/${companyId}`;
const act = (name: string, body: Record<string, unknown> = {}) =>
  api.post(`${co()}/actions/${name}`).set(auth()).send(body);

const AS_OF = '2026-08-13';

/** En batch som liknar det Hermes skickar: mail, möte och ett löfte. */
const BATCH = {
  events: [
    {
      kind: 'interaction',
      organization: { name: 'Nordic Vision Retail AB' },
      person: { name: 'Eva Larsson', email: 'eva@nvr.example', role_title: 'Ekonomichef' },
      occurred_at: '2026-08-10T09:14:00Z',
      channel: 'email', direction: 'inbound',
      summary: 'Svar om pilotens omfattning.',
      source_system: 'gmail', source_ref: 'gmail:18f2c9a1b7',
    },
    {
      kind: 'commitment',
      organization: { name: 'Nordic Vision Retail AB' },
      person: { name: 'Eva Larsson', email: 'eva@nvr.example' },
      commitment_direction: 'we_owe',
      body: 'Skicka tidplan för pilotens fas 2.',
      due_date: '2026-08-01',
      occurred_at: '2026-08-10T09:20:00Z',
      source_system: 'gmail', source_ref: 'gmail:18f2c9a1b7#commit-1',
    },
    {
      kind: 'interaction',
      organization: { name: 'Tystlåtna Prospektet AB' },
      person: { name: 'Sven Tyst', email: 'sven@tyst.example' },
      occurred_at: '2026-01-15T13:00:00Z',
      channel: 'meeting', direction: 'outbound',
      summary: 'Första och hittills enda mötet.',
      source_system: 'calendar', source_ref: 'cal:abc-1',
    },
  ],
};

beforeAll(async () => {
  user = await registerUser('crmderiv');
  companyId = await createCompany(user.token, 'Locollabs AB');
  await createFiscalYear(companyId, auth(), { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });

  const cust = await api.post(`${co()}/customers`).set(auth()).send({ name: 'Nordic Vision Retail AB' });
  expect(cust.status, JSON.stringify(cust.body)).toBe(201);
  customerId = cust.body.customer.id;
});

describe('API-kontraktet: en batch in, naturliga nycklar, idempotent', () => {
  it('skapar organisation, person, kontaktpunkt och åtagande på en gång', async () => {
    const res = await act('ingest_crm_events', BATCH);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const r = res.body.result;
    expect(r.received).toBe(3);
    expect(r.organizations_created).toBe(2);
    expect(r.people_created).toBe(2);
    expect(r.interactions_created).toBe(2);
    expect(r.commitments_created).toBe(1);
    expect(r.skipped).toEqual([]);
  });

  it('kopplar organisationen till kundregistret — och SÄGER vilka som inte gick', async () => {
    // Buggen: ingest-vägen satte aldrig customer_id (avsändaren känner inte
    // våra uuid:n), så omsättningen blev blind medan allt såg rätt ut. Nu slås
    // kunden upp på namn/org.nr, och det som INTE gick att koppla rapporteras —
    // annars vore en tom koppling återigen ett tyst nollresultat.
    const list = await act('list_crm_organizations', {});
    const nvr = list.body.result.find((o: { name: string }) => o.name === 'Nordic Vision Retail AB');
    expect(nvr.customer_id, 'kunden finns i registret med exakt samma namn').toBe(customerId);
    expect(nvr.status).toBe('customer');

    const res = await act('ingest_crm_events', BATCH);
    expect(res.body.result.organizations_linked).toBe(1);
    expect(res.body.result.unlinked_organizations).toEqual(['Tystlåtna Prospektet AB']);
  });

  it('två kunder med samma namn ger INGEN koppling — en gissning är värre', async () => {
    for (const n of ['Tvillingen AB', 'Tvillingen AB']) {
      const c = await api.post(`${co()}/customers`).set(auth()).send({ name: n });
      expect(c.status).toBe(201);
    }
    const res = await act('ingest_crm_events', {
      events: [{
        kind: 'interaction', organization: { name: 'Tvillingen AB' },
        occurred_at: '2026-08-12T09:00:00Z', channel: 'call',
        summary: 'Vilken av dem?', source_system: 'manual', source_ref: 'tvilling-1',
      }],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.result.unlinked_organizations).toContain('Tvillingen AB');

    const list = await act('list_crm_organizations', {});
    const org = list.body.result.find((o: { name: string }) => o.name === 'Tvillingen AB');
    expect(org.customer_id, 'tvetydigt → lämnas tomt, men syns i svaret').toBeNull();
  });

  it('samma batch en gång till ändrar ingenting — annars vore synken en dubblettgenerator', async () => {
    const before = await withAdmin(async (a) => (await a.query(
      `SELECT (SELECT count(*)::int FROM crm.interactions WHERE company_id = $1) AS i,
              (SELECT count(*)::int FROM crm.commitments WHERE company_id = $1) AS c,
              (SELECT count(*)::int FROM crm.people WHERE company_id = $1) AS p,
              (SELECT count(*)::int FROM crm.organizations WHERE company_id = $1) AS o`,
      [companyId])).rows[0]);

    const res = await act('ingest_crm_events', BATCH);
    expect(res.status).toBe(200);
    expect(res.body.result.interactions_created).toBe(0);
    expect(res.body.result.interactions_unchanged).toBe(2);
    expect(res.body.result.commitments_unchanged).toBe(1);
    expect(res.body.result.organizations_created).toBe(0);
    expect(res.body.result.people_created).toBe(0);

    const after = await withAdmin(async (a) => (await a.query(
      `SELECT (SELECT count(*)::int FROM crm.interactions WHERE company_id = $1) AS i,
              (SELECT count(*)::int FROM crm.commitments WHERE company_id = $1) AS c,
              (SELECT count(*)::int FROM crm.people WHERE company_id = $1) AS p,
              (SELECT count(*)::int FROM crm.organizations WHERE company_id = $1) AS o`,
      [companyId])).rows[0]);
    expect(after).toEqual(before);
  });

  it('räknarna ljuger inte när en händelse rullas tillbaka', async () => {
    // Granskningsfynd: organisationen räknades som skapad innan händelsen kunde
    // falla. Savepointen rullade tillbaka raden, men svaret och auditloggen
    // påstod ändå att den skapats — och mottagarens avstämning ("idel unchanged
    // är kvittot") såg spökskapelser vid varje omkörning av en trasig händelse.
    const res = await act('ingest_crm_events', {
      events: [{
        kind: 'interaction', organization: { name: 'Spöket AB' },
        person: { name: 'Spök Person' },
        occurred_at: '2026-08-12T10:00:00Z', channel: 'call',
        // summary saknas → händelsen faller EFTER att org och person hunnit skapas
        source_system: 'manual', source_ref: 'spoke-1',
      }],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.result.skipped).toHaveLength(1);
    expect(res.body.result.organizations_created, 'inget skapades — allt rullades tillbaka').toBe(0);
    expect(res.body.result.people_created).toBe(0);

    const finns = await withAdmin(async (a) => (await a.query(
      `SELECT count(*)::int AS n FROM crm.organizations WHERE company_id = $1 AND name = 'Spöket AB'`,
      [companyId])).rows[0].n);
    expect(finns).toBe(0);
  });

  it('en trasig händelse stoppar inte batchen — den rapporteras', async () => {
    const res = await act('ingest_crm_events', {
      events: [
        {
          kind: 'interaction', organization: { name: 'Fungerande AB' },
          occurred_at: '2026-08-11T10:00:00Z', channel: 'call',
          summary: 'Kort avstämning.', source_system: 'manual', source_ref: 'ok-1',
        },
        {
          // Saknar summary → kontaktpunkten kan inte skapas.
          kind: 'interaction', organization: { name: 'Trasig AB' },
          occurred_at: '2026-08-11T11:00:00Z', channel: 'call',
          source_system: 'manual', source_ref: 'trasig-1',
        },
      ],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.result.interactions_created).toBe(1);
    expect(res.body.result.skipped).toHaveLength(1);
    expect(res.body.result.skipped[0].index).toBe(1);

    // Den fungerande raden ligger kvar — transaktionen förgiftades inte.
    const orgs = await act('list_crm_organizations', {});
    expect(orgs.body.result.map((o: { name: string }) => o.name)).toContain('Fungerande AB');
  });

  it('tidrapportering avvisas som källa även i batchen', async () => {
    const res = await act('ingest_crm_events', {
      events: [{
        kind: 'interaction', organization: { name: 'NVR' }, occurred_at: '2026-08-11T10:00:00Z',
        channel: 'note', summary: 'Loggade tid', source_system: 'time_entries', source_ref: 'x',
      }],
    });
    expect(res.status).toBe(400);
  });
});

describe('härledningarna räknas fram, de matas inte in', () => {
  beforeAll(async () => {
    // Bokförd faktura → omsättning och koncentration blir mätbara.
    const inv = await act('create_invoice', {
      customer_id: customerId, invoice_date: '2026-07-01', due_date: '2026-07-31',
      lines: [{ description: 'Konsulttid juni', quantity: 100, unit: 'h', unit_price_ore: 110_000, vat_rate: 25 }],
    });
    expect(inv.status, JSON.stringify(inv.body)).toBe(200);
    const book = await act('book_invoice', { invoice_id: inv.body.result.id });
    expect(book.status).toBe(202);
    const approve = await api.post(`${co()}/approvals/${book.body.approval.id}/approve`).set(auth()).send({});
    expect(approve.status, JSON.stringify(approve.body)).toBe(200);

    // Organisationen knyts till kunden — samma rad, ingen kopia.
    const link = await act('upsert_crm_organization', {
      name: 'Nordic Vision Retail AB', customer_id: customerId,
    });
    expect(link.body.result.status).toBe('customer');
  });

  it('senaste kontakt räknas även via organisationens personer', async () => {
    const state = await act('crm_relation_state', { as_of: AS_OF });
    expect(state.status, JSON.stringify(state.body)).toBe(200);
    const nvr = state.body.result.find((r: { name: string }) => r.name === 'Nordic Vision Retail AB');
    // Mailet gick till Eva, inte till organisationen — men det ÄR kontakt med kunden.
    expect(new Date(nvr.last_contact_at).toISOString()).toBe('2026-08-10T09:14:00.000Z');
    expect(nvr.days_silent).toBe(3);
  });

  it('omsättning och koncentration kommer ur BOKFÖRDA fakturor', async () => {
    const state = await act('crm_relation_state', { as_of: AS_OF });
    const nvr = state.body.result.find((r: { name: string }) => r.name === 'Nordic Vision Retail AB');
    expect(nvr.revenue_12m_ore).toBe(11_000_000); // 100 h à 1 100 kr, exkl. moms
    expect(nvr.revenue_share_permille).toBe(1000); // enda kunden → 100 %
  });

  it('tystnaden listar den som varit tyst för länge, inte den vi nyss talat med', async () => {
    const rep = await act('crm_silence_report', { as_of: AS_OF, silence_days: 30 });
    expect(rep.status, JSON.stringify(rep.body)).toBe(200);
    const names = rep.body.result.rows.map((r: { name: string }) => r.name);
    expect(names).toContain('Tystlåtna Prospektet AB'); // senaste kontakt i januari
    expect(names).not.toContain('Nordic Vision Retail AB'); // hördes av för tre dagar sedan
  });

  it('förslagen säger VARFÖR, och det förfallna löftet väger tyngst', async () => {
    const res = await act('crm_contact_suggestions', { as_of: AS_OF, silence_days: 30 });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const s = res.body.result.suggestions as Array<{
      organization: string; reasons: string[]; person: { name: string } | null; overdue_commitments: number;
    }>;

    const nvr = s.find((x) => x.organization === 'Nordic Vision Retail AB');
    expect(nvr, 'kunden med förfallet åtagande ska föreslås').toBeTruthy();
    expect(nvr!.overdue_commitments).toBe(1);
    // Skälet ska gå att läsa som en öppningsreplik: VAD som lovats och när det
    // förföll. "1 förfallet åtagande" säger vad systemet vet, inte vad man ska
    // skriva i mailet — och det senare är vad raden är till för.
    expect(nvr!.reasons.join(' ')).toContain('vi lovade: Skicka tidplan för pilotens fas 2.');
    expect(nvr!.reasons.join(' ')).toMatch(/förföll \d{4}-\d{2}-\d{2}/);
    expect(nvr!.reasons.join(' ')).toContain('% av omsättningen'); // koncentrationen döljs inte
    expect(nvr!.person?.name).toBe('Eva Larsson');
    expect(s[0]!.organization).toBe('Nordic Vision Retail AB'); // högst prioritet

    const tyst = s.find((x) => x.organization === 'Tystlåtna Prospektet AB');
    expect(tyst!.reasons.join(' ')).toContain('tyst i');
    expect(tyst!.reasons.join(' ')).toContain('prospekt');
  });

  it('att hämta förslag skickar ingenting — utkorgen är orörd', async () => {
    const before = await withAdmin(async (a) => (await a.query(
      'SELECT count(*)::int AS n FROM email_outbox')).rows[0].n);
    await act('crm_contact_suggestions', { as_of: AS_OF });
    await act('crm_silence_report', { as_of: AS_OF });
    const after = await withAdmin(async (a) => (await a.query(
      'SELECT count(*)::int AS n FROM email_outbox')).rows[0].n);
    expect(after).toBe(before);
  });

  it('artikelprissatta abonnemang räknas med i täckningen', async () => {
    // Granskningsfynd: täckningen läste bara uttryckligt satt pris. En
    // abonnemangsrad som prissätts via en artikel blev en tyst nolla, och
    // styrvyn underskattade precis den siffra den finns för att visa.
    const art = await api.post(`${co()}/articles`).set(auth()).send({
      article_number: 'AB-1', name: 'Månadsabonnemang', unit_price_ore: 500_000, vat_rate: 25,
    });
    expect(art.status, JSON.stringify(art.body)).toBe(201);

    const before = (await act('crm_relation_state', {})).status; // sanity: API:t svarar
    expect(before).toBe(200);

    const rec = await act('create_recurring_invoice', {
      customer_id: customerId, title: 'Drift och förvaltning', interval: 'monthly',
      next_run_date: '2026-09-01',
      lines: [{ article_id: art.body.article.id, quantity: 1 }],
    });
    expect(rec.status, JSON.stringify(rec.body)).toBe(200);

    const ua = supertest.agent(app);
    await ua.post('/app/login').type('form').send({ email: user.email, password: PASSWORD });
    const sida = await ua.get(`/app/c/${companyId}/steering`);
    expect(sida.status).toBe(200);
    // 500 000 öre = 5 000,00 kr per månad — inte noll.
    expect(sida.text.replace(/[\s\u00A0\u202F]/g, '')).toContain('5000,00');
  });

  it('härledningarna är tenant-isolerade', async () => {
    const other = await registerUser('crmderivannan');
    const otherCo = await createCompany(other.token, 'Annat AB');
    const res = await api.post(`/api/companies/${otherCo}/actions/crm_relation_state`)
      .set({ Authorization: `Bearer ${other.token}` }).send({ as_of: AS_OF });
    expect(res.status).toBe(200);
    expect(res.body.result).toEqual([]);
  });
});
