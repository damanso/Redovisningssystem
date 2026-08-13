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
import { beforeAll, describe, expect, it } from 'vitest';
import { api, createCompany, createFiscalYear, registerUser, withAdmin, type TestUser } from './helpers.js';

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
    expect(nvr!.reasons.join(' ')).toContain('förfallet åtagande');
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

  it('härledningarna är tenant-isolerade', async () => {
    const other = await registerUser('crmderivannan');
    const otherCo = await createCompany(other.token, 'Annat AB');
    const res = await api.post(`/api/companies/${otherCo}/actions/crm_relation_state`)
      .set({ Authorization: `Bearer ${other.token}` }).send({ as_of: AS_OF });
    expect(res.status).toBe(200);
    expect(res.body.result).toEqual([]);
  });
});
