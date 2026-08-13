// CRM E2 — relationsdata i eget schema.
//
// Två krav ur BMAD-underlaget som testerna vaktar, båda strukturella:
//
//   1. Ett prospekt kan inte bo i kundtabellen. Affären FÖRE fakturan saknade
//      hem; nu har den ett, och samma rad följer med när affären vinns så
//      relationshistoriken inte bryts.
//   2. Relationsdata är INTE räkenskapsinformation. Den ska aldrig följa med i
//      SIE-exporten till revisorn, och den ska gå att gallra enligt GDPR — till
//      skillnad från bokföringen, som måste bevaras.
//
// Dessutom: "senaste kontakt" får aldrig härledas ur tidrapportering (två av
// tre aktiva projekt har noll loggade minuter men betalda fakturor).
import supertest from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { ACTIONS } from '../src/actions/registry.js';
import { api, app, createCompany, createFiscalYear, registerUser, withAdmin, type TestUser } from './helpers.js';

const PASSWORD = 'mycket-hemligt-losen-123';
let user: TestUser;
let companyId: string;
let orgId: string;
let personId: string;
const auth = () => ({ Authorization: `Bearer ${user.token}` });
const co = () => `/api/companies/${companyId}`;

const act = (name: string, body: Record<string, unknown> = {}) =>
  api.post(`${co()}/actions/${name}`).set(auth()).send(body);

beforeAll(async () => {
  user = await registerUser('crmschema');
  companyId = await createCompany(user.token, 'Locollabs AB');

  const org = await act('upsert_crm_organization', {
    name: 'Framtida Kund AB', source: 'Möte på konferens', notes: 'Diskuterar pilot.',
  });
  expect(org.status, JSON.stringify(org.body)).toBe(200);
  orgId = org.body.result.id;

  const person = await act('upsert_crm_person', {
    name: 'Mikaela Beslutsfattare', email: 'mikaela@framtida.example',
    role_title: 'CTO', organization_id: orgId,
  });
  expect(person.status, JSON.stringify(person.body)).toBe(200);
  personId = person.body.result.id;
});

describe('prospektet har äntligen ett hem', () => {
  it('ett prospekt kan finnas utan att vara kund i redovisningen', async () => {
    const list = await act('list_crm_organizations', { status: 'prospect' });
    expect(list.status, JSON.stringify(list.body)).toBe(200);
    expect(list.body.result).toHaveLength(1);
    expect(list.body.result[0].customer_id).toBeNull();

    // ...och kundregistret är orört. Prospektet blev inte kund i smyg.
    const customers = await api.get(`${co()}/customers`).set(auth());
    expect(customers.body.customers ?? customers.body.result ?? []).toHaveLength(0);
  });

  it('när affären vinns pekas SAMMA rad mot kunden — historiken bryts inte', async () => {
    await act('record_crm_interaction', {
      organization_id: orgId, person_id: personId, occurred_at: '2026-05-02T09:00:00Z',
      channel: 'meeting', summary: 'Första mötet, före affären.', source_system: 'calendar', source_ref: 'cal-1',
    });

    const cust = await api.post(`${co()}/customers`).set(auth()).send({ name: 'Framtida Kund AB' });
    expect(cust.status, JSON.stringify(cust.body)).toBe(201);
    const updated = await act('upsert_crm_organization', {
      name: 'Framtida Kund AB', customer_id: cust.body.customer.id,
    });
    expect(updated.status, JSON.stringify(updated.body)).toBe(200);
    expect(updated.body.result.created).toBe(false);
    expect(updated.body.result.id).toBe(orgId);
    expect(updated.body.result.status).toBe('customer');

    const full = await act('get_crm_organization', { organization_id: orgId });
    expect(full.body.result.customer_name).toBe('Framtida Kund AB');
    expect(full.body.result.interactions).toHaveLength(1); // mötet från prospekttiden finns kvar
  });

  it('skrivningarna är idempotenta — en synk som körs om ger inga dubbletter', async () => {
    const rows = async () => withAdmin(async (a) => (await a.query(
      'SELECT count(*)::int AS n FROM crm.interactions WHERE company_id = $1', [companyId])).rows[0].n);
    const before = await rows();

    const again = await act('record_crm_interaction', {
      organization_id: orgId, occurred_at: '2026-05-02T09:00:00Z', channel: 'meeting',
      summary: 'Första mötet, före affären.', source_system: 'calendar', source_ref: 'cal-1',
    });
    expect(again.status, JSON.stringify(again.body)).toBe(200);
    expect(again.body.result.created).toBe(false);
    expect(await rows()).toBe(before);

    const person = await act('upsert_crm_person', { name: 'mikaela beslutsfattare', email: 'MIKAELA@framtida.example' });
    expect(person.body.result.created).toBe(false);
    expect(person.body.result.id).toBe(personId);
    // En synk utan uppgifterna får inte nolla det som redan står där.
    expect(person.body.result.role_title).toBe('CTO');
  });

  it('läsningarna är tenant-isolerade', async () => {
    const other = await registerUser('crmschemaannan');
    const otherCo = await createCompany(other.token, 'Annat AB');
    const res = await api.post(`/api/companies/${otherCo}/actions/get_crm_organization`)
      .set({ Authorization: `Bearer ${other.token}` }).send({ organization_id: orgId });
    expect(res.status).toBe(404);
  });
});

describe('senaste kontakt härleds ur mail och möten — aldrig ur tidrapporter', () => {
  it('tidrapportering är inte en giltig källa (avvisas av API:t)', async () => {
    const res = await act('record_crm_interaction', {
      organization_id: orgId, occurred_at: '2026-06-01T08:00:00Z', channel: 'note',
      summary: 'Loggade tid', source_system: 'time_entries',
    });
    expect(res.status).toBe(400);
  });

  it('...och databasen släpper inte igenom den heller', async () => {
    await expect(withAdmin(async (a) => a.query(
      `INSERT INTO crm.interactions (company_id, organization_id, occurred_at, channel, summary, source_system)
       VALUES ($1, $2, now(), 'note', 'Loggade tid', 'time_entries')`, [companyId, orgId],
    ))).rejects.toThrow(/interactions_source_system_check/);
  });

  it('senaste kontakt kommer ur kontaktpunkterna', async () => {
    await act('record_crm_interaction', {
      person_id: personId, occurred_at: '2026-07-15T13:30:00Z', channel: 'email', direction: 'inbound',
      summary: 'Svar om pilotens omfattning.', source_system: 'gmail', source_ref: 'mail-42',
    });
    const list = await act('list_crm_organizations', {});
    const org = list.body.result.find((o: { id: string }) => o.id === orgId);
    // Mailet gick till Mikaela, inte till organisationen — men ett mail till
    // kundens beställare ÄR kontakt med kunden. Räknades bara kontaktpunkter
    // som hänger direkt på organisationen skulle en kund se övergiven ut fast
    // all dialog gått via personen.
    expect(new Date(org.last_contact_at as string).toISOString()).toBe('2026-07-15T13:30:00.000Z');

    const people = await act('list_crm_people', {});
    const p = people.body.result.find((x: { id: string }) => x.id === personId);
    expect(new Date(p.last_contact_at as string).toISOString()).toBe('2026-07-15T13:30:00.000Z');
  });
});

describe('åtaganden: vem lovade vad, och var det sades', () => {
  it('registreras med källa och kan stängas', async () => {
    const c = await act('record_crm_commitment', {
      organization_id: orgId, person_id: personId, direction: 'we_owe',
      body: 'Skicka pilotens tidplan.', due_date: '2026-07-31',
      occurred_at: '2026-07-15T13:35:00Z', source_system: 'gmail', source_ref: 'mail-42',
    });
    expect(c.status, JSON.stringify(c.body)).toBe(200);
    expect(c.body.result.status).toBe('open');

    const open = await act('list_crm_commitments', { status: 'open' });
    expect(open.body.result).toHaveLength(1);
    expect(open.body.result[0].source_ref).toBe('mail-42'); // källan går att följa

    const done = await act('set_crm_commitment_status', { commitment_id: c.body.result.id, status: 'done' });
    expect(done.body.result.status).toBe('done');
    expect((await act('list_crm_commitments', { status: 'open' })).body.result).toHaveLength(0);
  });
});

describe('gränsen mot bokföringen', () => {
  it('relationsdata följer INTE med i SIE-exporten till revisorn', async () => {
    const fy = await createFiscalYear(companyId, auth(), {
      label: '2026', start_date: '2026-01-01', end_date: '2026-12-31',
    });
    const ua = supertest.agent(app);
    await ua.post('/app/login').type('form').send({ email: user.email, password: PASSWORD });
    const sie = await ua.get(`/app/c/${companyId}/annual/export.sie?fy=${fy.id}`).buffer()
      .parse((r, cb) => { const chunks: Buffer[] = []; r.on('data', (c: Buffer) => chunks.push(c)); r.on('end', () => cb(null, Buffer.concat(chunks))); });
    expect(sie.status).toBe(200);
    const text = (sie.body as Buffer).toString('latin1');
    expect(text).toContain('#FLAGGA'); // det ÄR en SIE-fil
    expect(text).not.toContain('Mikaela');
    expect(text).not.toContain('pilot');
    expect(text).not.toContain('Möte på konferens');
  });

  it('crm.audit_log är append-only och skild från bokföringens logg', async () => {
    const rows = await withAdmin(async (a) => (await a.query(
      `SELECT action FROM crm.audit_log WHERE company_id = $1 ORDER BY id`, [companyId])).rows);
    expect(rows.map((r) => r.action)).toContain('crm.organization_created');

    await expect(withAdmin(async (a) => a.query(
      `UPDATE crm.audit_log SET action = 'förfalskad' WHERE company_id = $1`, [companyId],
    ))).rejects.toThrow(/append-only/);
    await expect(withAdmin(async (a) => a.query(
      `DELETE FROM crm.audit_log WHERE company_id = $1`, [companyId],
    ))).rejects.toThrow(/append-only/);

    // Bokföringens logg blandas inte med relationsdatan.
    const core = await withAdmin(async (a) => (await a.query(
      `SELECT count(*)::int AS n FROM audit_log WHERE company_id = $1 AND action LIKE 'crm.%'`, [companyId])).rows[0].n);
    expect(core).toBe(0);
  });

  it('affärsobjektet (E3) är förberett men obyggt — tabellen står tom', async () => {
    const n = await withAdmin(async (a) => (await a.query('SELECT count(*)::int AS n FROM crm.deals')).rows[0].n);
    expect(n).toBe(0);
    expect(ACTIONS.filter((a) => a.name.includes('deal'))).toHaveLength(0);
  });
});

describe('gallring enligt GDPR — men aldrig på en gissad period', () => {
  it('gallring utan angiven period vägrar', async () => {
    const res = await act('purge_crm_data', {});
    expect(res.status).toBe(202); // känslig åtgärd → godkännandekö
    const approve = await api.post(`${co()}/approvals/${res.body.approval.id}/approve`).set(auth()).send({});
    expect(approve.status).toBe(400);
    expect(approve.body.error).toBe('no_retention_period');
  });

  it('med period gallras gammalt — öppna åtaganden och färsk historik står kvar', async () => {
    await act('record_crm_interaction', {
      organization_id: orgId, occurred_at: '2019-01-01T10:00:00Z', channel: 'email',
      summary: 'Uråldrig kontakt.', source_system: 'gmail', source_ref: 'mail-gammal',
    });
    await act('record_crm_commitment', {
      organization_id: orgId, direction: 'they_owe', body: 'Gammalt löfte som fortfarande gäller.',
      occurred_at: '2019-01-02T10:00:00Z', source_system: 'gmail', source_ref: 'mail-gammal-2',
    });

    const set = await act('set_crm_retention', { retention_months: 24 });
    expect(set.status, JSON.stringify(set.body)).toBe(200);

    const res = await act('purge_crm_data', {});
    expect(res.status).toBe(202);
    const approve = await api.post(`${co()}/approvals/${res.body.approval.id}/approve`).set(auth()).send({});
    expect(approve.status, JSON.stringify(approve.body)).toBe(200);
    expect(approve.body.result.interactions_deleted).toBe(1);
    expect(approve.body.result.commitments_deleted).toBe(0); // öppet åtagande gallras inte

    const kvar = await act('get_crm_organization', { organization_id: orgId });
    expect((kvar.body.result.interactions as unknown[]).length).toBeGreaterThan(0);
    expect(JSON.stringify(kvar.body.result.interactions)).not.toContain('Uråldrig');
  });
});

describe('GDPR: raderingen når ÄVEN relationsdatan', () => {
  // Regressionen som granskningen fann: anonymize_party rensade party_contacts
  // och party_notes men kände inte till schemat `crm`. En raderingsbegäran hade
  // därmed lämnat kvar personer, mailsammanfattningar och löften. Att datan
  // ligger i ett eget schema är skälet till att den GÅR att radera — inte en
  // ursäkt för att låta bli.
  it('personer, kontaktpunkter och åtaganden försvinner när kunden anonymiseras', async () => {
    const cust = await api.post(`${co()}/customers`).set(auth()).send({ name: 'Raderingskund AB' });
    expect(cust.status).toBe(201);
    const customerId = cust.body.customer.id;

    const org = await act('upsert_crm_organization', {
      name: 'Raderingskund AB', customer_id: customerId, notes: 'Känslig anteckning om personen.',
    });
    const organizationId = org.body.result.id;
    const person = await act('upsert_crm_person', {
      name: 'Petra Personuppgift', email: 'petra@radering.example', organization_id: organizationId,
    });
    expect(person.status, JSON.stringify(person.body)).toBe(200);
    await act('record_crm_interaction', {
      person_id: person.body.result.id, occurred_at: '2026-08-01T10:00:00Z', channel: 'email',
      summary: 'Personligt mail som ska bort.', source_system: 'gmail', source_ref: 'radera-1',
    });
    await act('record_crm_commitment', {
      organization_id: organizationId, direction: 'we_owe', body: 'Löfte som ska bort.',
      occurred_at: '2026-08-01T10:05:00Z', source_system: 'gmail', source_ref: 'radera-2',
    });

    const req = await act('anonymize_party', { party_type: 'customer', party_id: customerId });
    expect(req.status).toBe(202); // känslig → godkännandekö
    const done = await api.post(`${co()}/approvals/${req.body.approval.id}/approve`).set(auth()).send({});
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect(done.body.result.crm_people_removed).toBe(1);
    expect(done.body.result.crm_interactions_removed).toBe(1);
    expect(done.body.result.crm_commitments_removed).toBe(1);

    const kvar = await withAdmin(async (a) => (await a.query(
      `SELECT (SELECT count(*)::int FROM crm.people WHERE organization_id = $1) AS people,
              (SELECT count(*)::int FROM crm.interactions WHERE company_id = $2 AND summary LIKE 'Personligt%') AS inter,
              (SELECT count(*)::int FROM crm.commitments WHERE organization_id = $1) AS commits,
              (SELECT notes FROM crm.organizations WHERE id = $1) AS notes,
              (SELECT status FROM crm.organizations WHERE id = $1) AS status`,
      [organizationId, companyId])).rows[0]);
    expect(kvar.people).toBe(0);
    expect(kvar.inter).toBe(0);
    expect(kvar.commits).toBe(0);
    expect(kvar.notes).toBeNull();
    expect(kvar.status).toBe('archived');
  });
});

describe('granskningsfixar: fynden som hittades före produktionssläppet', () => {
  // Varje test nedan är skrivet som FELET såg ut, inte som fixen. Faller ett av
  // dem är regressionen tillbaka.

  async function anonymize(customerId: string): Promise<Record<string, number>> {
    const req = await act('anonymize_party', { party_type: 'customer', party_id: customerId });
    expect(req.status, JSON.stringify(req.body)).toBe(202);
    const done = await api.post(`${co()}/approvals/${req.body.approval.id}/approve`).set(auth()).send({});
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    return done.body.result as Record<string, number>;
  }

  it('TVÅ raderingar i samma bolag går igenom — namnet krockar inte', async () => {
    // Fyndet: organisationen döptes om till exakt "Raderad (GDPR)", som är
    // unikt per bolag. Andra raderingen kraschade → en raderingsbegäran som
    // inte gick att uppfylla.
    for (const namn of ['Radering Ett AB', 'Radering Två AB']) {
      const c = await api.post(`${co()}/customers`).set(auth()).send({ name: namn });
      expect(c.status).toBe(201);
      await act('upsert_crm_organization', { name: namn, customer_id: c.body.customer.id });
      const res = await anonymize(c.body.customer.id);
      expect(res.crm_people_removed).toBe(0);
    }
    const namn = await withAdmin(async (a) => (await a.query<{ name: string }>(
      `SELECT name FROM crm.organizations
       WHERE company_id = $1 AND status = 'archived' AND name LIKE 'Raderad (GDPR)%'`,
      [companyId])).rows.map((r) => r.name));
    expect(namn.length).toBeGreaterThanOrEqual(2);
    // Egenskapen som saknades: namnen är UNIKA. Var de identiska föll andra
    // raderingen på unik-indexet i stället för att gå igenom.
    expect(new Set(namn).size).toBe(namn.length);
  });

  it('en raderad källa kan INTE återuppspelas av nästa synk', async () => {
    // Fyndet: raderingen tog bort kontaktpunkterna — och därmed nycklarna som
    // gör synken idempotent. Nästa nattkörning återskapade personen, e-posten
    // och mailsammanfattningen. En utförd radering gjord ogjord, i tysthet.
    const c = await api.post(`${co()}/customers`).set(auth()).send({ name: 'Återuppstånden AB' });
    const customerId = c.body.customer.id;
    const batch = {
      events: [{
        kind: 'interaction',
        organization: { name: 'Återuppstånden AB' },
        person: { name: 'Rebecka Radering', email: 'rebecka@ater.example' },
        occurred_at: '2026-08-01T10:00:00Z', channel: 'email',
        summary: 'Mail som ska kunna raderas för gott.',
        source_system: 'gmail', source_ref: 'gmail:ater-1',
      }],
    };
    expect((await act('ingest_crm_events', batch)).status).toBe(200);
    await act('upsert_crm_organization', { name: 'Återuppstånden AB', customer_id: customerId });

    const res = await anonymize(customerId);
    expect(res.crm_people_removed).toBe(1);
    expect(res.crm_interactions_removed).toBe(1);

    // Hermes skickar om exakt samma historiska batch.
    const replay = await act('ingest_crm_events', batch);
    expect(replay.status, JSON.stringify(replay.body)).toBe(200);
    expect(replay.body.result.interactions_created).toBe(0);
    expect(replay.body.result.skipped).toHaveLength(1);
    expect(replay.body.result.skipped[0].reason).toContain('GDPR');

    const kvar = await withAdmin(async (a) => (await a.query(
      `SELECT count(*)::int AS n FROM crm.people WHERE company_id = $1 AND lower(email) = 'rebecka@ater.example'`,
      [companyId])).rows[0].n);
    expect(kvar, 'personen får inte återuppstå').toBe(0);
  });

  it('två personer med samma namn på OLIKA företag slås inte ihop', async () => {
    // Fyndet: namnuppslaget var bolagsbrett, så "Anna Andersson" på företag B
    // kapade Anna Andersson på företag A — och flyttade hennes historik dit.
    const a = await act('upsert_crm_organization', { name: 'Namnkrock A AB' });
    const b = await act('upsert_crm_organization', { name: 'Namnkrock B AB' });
    const p1 = await act('upsert_crm_person', { name: 'Anna Andersson', organization_id: a.body.result.id });
    expect(p1.body.result.created).toBe(true);
    const p2 = await act('upsert_crm_person', { name: 'Anna Andersson', organization_id: b.body.result.id });
    expect(p2.body.result.created, 'ny person hos nytt företag').toBe(true);
    expect(p2.body.result.id).not.toBe(p1.body.result.id);

    // ...men samma namn hos SAMMA företag är samma person.
    const p3 = await act('upsert_crm_person', { name: 'anna andersson', organization_id: a.body.result.id });
    expect(p3.body.result.created).toBe(false);
    expect(p3.body.result.id).toBe(p1.body.result.id);
  });

  it('en händelse utan e-post matchar en person som redan har en', async () => {
    // Fyndet: namnuppslaget krävde att den lagrade raden saknade e-post, så ett
    // kalenderevent (som sällan bär adressen) lade en dubblett bredvid personen.
    const org = await act('upsert_crm_organization', { name: 'Kalenderfallet AB' });
    const med = await act('upsert_crm_person', {
      name: 'Kalle Kalender', email: 'kalle@kalender.example', organization_id: org.body.result.id,
    });
    expect(med.body.result.created).toBe(true);
    const utan = await act('upsert_crm_person', { name: 'Kalle Kalender', organization_id: org.body.result.id });
    expect(utan.body.result.created, 'ingen dubblett från ett möte utan adress').toBe(false);
    expect(utan.body.result.id).toBe(med.body.result.id);
    expect(utan.body.result.email).toBe('kalle@kalender.example'); // e-posten står kvar
  });

  it('uppdatering av en befintlig kontaktpunkt auditloggas också', async () => {
    // Fyndet: bara nyskapade rader auditloggades. En omsänd händelse med ändrad
    // text kunde skriva om historiken utan spår.
    const org = await act('upsert_crm_organization', { name: 'Auditfallet AB' });
    const first = {
      organization_id: org.body.result.id, occurred_at: '2026-08-05T10:00:00Z', channel: 'email' as const,
      summary: 'Ursprunglig text.', source_system: 'gmail' as const, source_ref: 'gmail:audit-1',
    };
    await act('record_crm_interaction', first);
    await act('record_crm_interaction', { ...first, summary: 'Omskriven text.' });

    const rader = await withAdmin(async (a) => (await a.query(
      `SELECT action FROM crm.audit_log WHERE company_id = $1 AND action = 'crm.interaction_updated'`,
      [companyId])).rows);
    expect(rader.length).toBeGreaterThan(0);
  });
});
