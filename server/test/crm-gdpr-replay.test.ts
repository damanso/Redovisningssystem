// FR-43, API-kontraktets regel 4: nästa synk får inte göra en rättsligt
// utförd GDPR-radering ogjord. Provet går genom HTTP, åtgärder och
// godkännandekön och läser tabellerna både som app med RLS och som ägare.
import { beforeAll, describe, expect, it } from 'vitest';
import type { QueryResultRow } from 'pg';
import { pool } from '../src/db/pool.js';
import { api, createCompany, registerUser, withAdmin, type TestUser } from './helpers.js';

const SKAL = 'källan är raderad enligt GDPR och får inte återskapas';
const BATCH_R = {
  events: [
    {
      kind: 'interaction', organization: { name: 'Gravstenen AB' },
      person: { name: 'Greta Gravsten', email: 'greta@gravstenen.example' },
      channel: 'email', direction: 'inbound', summary: 'Mail om offerten.',
      occurred_at: '2026-08-03T09:00:00Z', source_system: 'gmail', source_ref: 'gdpr-r1',
    },
    {
      kind: 'commitment', organization: { name: 'Gravstenen AB' },
      person: { name: 'Greta Gravsten', email: 'greta@gravstenen.example' },
      commitment_direction: 'we_owe', body: 'Skicka offerten.',
      occurred_at: '2026-08-03T09:05:00Z', source_system: 'gmail', source_ref: 'gdpr-r2',
    },
  ],
};
const BATCH_K = {
  events: [
    {
      kind: 'interaction', organization: { name: 'Kontrollkunden AB' },
      person: { name: 'Karl Kontroll', email: 'karl@kontrollkunden.example' },
      channel: 'email', direction: 'inbound', summary: 'Mail om offerten.',
      occurred_at: '2026-08-03T09:00:00Z', source_system: 'gmail', source_ref: 'gdpr-k1',
    },
    {
      kind: 'commitment', organization: { name: 'Kontrollkunden AB' },
      person: { name: 'Karl Kontroll', email: 'karl@kontrollkunden.example' },
      commitment_direction: 'we_owe', body: 'Skicka offerten.',
      occurred_at: '2026-08-03T09:05:00Z', source_system: 'gmail', source_ref: 'gdpr-k2',
    },
  ],
};

type Lasare = <T extends QueryResultRow>(sql: string, params?: unknown[]) => Promise<{ rows: T[] }>;
type Radantal = { organizations: number; people: number; interactions: number; commitments: number };
type Svar = Awaited<ReturnType<typeof act>>;

let user: TestUser;
let companyId: string;
let intag: Svar;
let radering: Awaited<ReturnType<typeof anonymisera>>;
let omsandning: Svar;
let ownerFore: Radantal;
let ownerEfter: Radantal;
let appFore: Radantal;
let appEfter: Radantal;
let negativKordes: boolean = false;
let granne: TestUser;
let grannbolagId: string;

const act = (namn: string, kropp: object) => api
  .post(`/api/companies/${companyId}/actions/${namn}`)
  .set('Authorization', `Bearer ${user.token}`).send(kropp);

async function anonymisera(kundId: string) {
  const begaran = await act('anonymize_party', { party_type: 'customer', party_id: kundId });
  expect(begaran.status, JSON.stringify(begaran.body)).toBe(202);
  expect(begaran.body.status).toBe('pending_approval');
  const godkannande = await api
    .post(`/api/companies/${companyId}/approvals/${begaran.body.approval.id}/approve`)
    .set('Authorization', `Bearer ${user.token}`).send({});
  expect(godkannande.status, JSON.stringify(godkannande.body)).toBe(200);
  return { begaran, godkannande };
}

async function ownerLas<T>(fn: (las: Lasare) => Promise<T>): Promise<T> {
  return withAdmin((client) => fn(<R extends QueryResultRow>(sql: string, params?: unknown[]) => client.query<R>(sql, params)));
}

async function asUser<T>(userId: string, bolagsId: string, fn: (las: Lasare) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.user_id', $1, true), set_config('app.company_id', $2, true)",
      [userId, bolagsId]);
    return await fn(<R extends QueryResultRow>(sql: string, params?: unknown[]) => client.query<R>(sql, params));
  } finally {
    try {
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  }
}

async function radantal(las: Lasare, bolagsId: string): Promise<Radantal> {
  const { rows } = await las<Radantal>(`SELECT
    (SELECT count(*)::int FROM crm.organizations WHERE company_id = $1) AS organizations,
    (SELECT count(*)::int FROM crm.people WHERE company_id = $1) AS people,
    (SELECT count(*)::int FROM crm.interactions WHERE company_id = $1) AS interactions,
    (SELECT count(*)::int FROM crm.commitments WHERE company_id = $1) AS commitments`,
  [bolagsId]);
  return rows[0]!;
}

beforeAll(async () => {
  user = await registerUser('gdprreplay');
  companyId = await createCompany(user.token, 'Återuppspelningsprovet AB');
});

describe('omsändningen efter radering (FR-43)', () => {
  beforeAll(async () => {
    const kund = await api.post(`/api/companies/${companyId}/customers`)
      .set('Authorization', `Bearer ${user.token}`).send({ name: 'Gravstenen AB' });
    expect(kund.status, JSON.stringify(kund.body)).toBe(201);
    intag = await act('ingest_crm_events', BATCH_R);
    expect(intag.status, JSON.stringify(intag.body)).toBe(200);
    radering = await anonymisera(kund.body.customer.id);
    ownerFore = await ownerLas((las) => radantal(las, companyId));
    appFore = await asUser(user.userId, companyId, (las) => radantal(las, companyId));
    omsandning = await act('ingest_crm_events', BATCH_R);
    ownerEfter = await ownerLas((las) => radantal(las, companyId));
    appEfter = await asUser(user.userId, companyId, (las) => radantal(las, companyId));
  });

  it('R0: fixturen är kopplad och raderingen går genom godkännandekön', () => {
    expect(intag.status, JSON.stringify(intag.body)).toBe(200);
    expect(intag.body.result).toMatchObject({
      interactions_created: 1, commitments_created: 1, people_created: 1,
      organizations_linked: 1, unlinked_organizations: [], skipped: [],
    });
    expect(radering.begaran.status, JSON.stringify(radering.begaran.body)).toBe(202);
    expect(radering.begaran.body.status).toBe('pending_approval');
    expect(radering.godkannande.status, JSON.stringify(radering.godkannande.body)).toBe(200);
    expect(radering.godkannande.body.result).toMatchObject({
      crm_people_removed: 1, crm_interactions_removed: 1, crm_commitments_removed: 1,
    });
  });

  it('R1: båda raderade händelserna hoppas över med ordagrant skäl och noll räknare', () => {
    expect(omsandning.status, JSON.stringify(omsandning.body)).toBe(200);
    expect(omsandning.body.result.skipped).toEqual([{ index: 0, reason: SKAL }, { index: 1, reason: SKAL }]);
    expect(omsandning.body.result).toMatchObject({
      interactions_created: 0, interactions_unchanged: 0,
      commitments_created: 0, commitments_unchanged: 0, people_created: 0, organizations_created: 0,
    });
  });

  it('R2: den interna felkoden lämnar inte tjänsten i batchsvaret', () => {
    expect(omsandning.status, JSON.stringify(omsandning.body)).toBe(200);
    expect(JSON.stringify(omsandning.body)).not.toContain('erased_source');
    expect(omsandning.body.result.skipped).toEqual([{ index: 0, reason: SKAL }, { index: 1, reason: SKAL }]);
  });

  it('R3: ägaren ser oförändrade radantal och inga raderade personer eller källor', async () => {
    expect(ownerEfter).toEqual(ownerFore);
    expect(ownerEfter.organizations).toBeGreaterThanOrEqual(1);
    const kvar = await withAdmin(async (client) => (await client.query<{
      people: number; interactions: number; commitments: number;
    }>(`SELECT
      (SELECT count(*)::int FROM crm.people WHERE company_id = $1 AND lower(email) = 'greta@gravstenen.example') AS people,
      (SELECT count(*)::int FROM crm.interactions WHERE company_id = $1 AND source_ref = 'gdpr-r1') AS interactions,
      (SELECT count(*)::int FROM crm.commitments WHERE company_id = $1 AND source_ref = 'gdpr-r2') AS commitments`,
    [companyId])).rows[0]!);
    expect(kvar).toEqual({ people: 0, interactions: 0, commitments: 0 });
  });

  it('R4: app med RLS ser samma oförändrade radantal som ägaren', () => {
    expect(appEfter).toEqual(appFore);
    expect(appEfter).toEqual(ownerEfter);
    expect(appEfter.organizations).toBeGreaterThanOrEqual(1);
  });
});

describe('gravstenarna', () => {
  it('G1: tabellens tillåtna kolumner kan bara bära källnycklar och metadata', async () => {
    const kolumner = await withAdmin(async (client) => (await client.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'crm' AND table_name = 'erased_sources'`,
    )).rows.map((rad) => rad.column_name));
    expect(kolumner.sort()).toEqual(['company_id', 'erased_at', 'source_ref', 'source_system']);
  });

  it('G2: exakt de två raderade källparen finns som gravstenar i bolaget', async () => {
    const gravstenar = await withAdmin(async (client) => (await client.query(
      `SELECT source_system, source_ref FROM crm.erased_sources
       WHERE company_id = $1 ORDER BY source_ref`, [companyId],
    )).rows);
    expect(gravstenar).toEqual([
      { source_system: 'gmail', source_ref: 'gdpr-r1' },
      { source_system: 'gmail', source_ref: 'gdpr-r2' },
    ]);
  });

  it('G3: app får varken radera eller skriva om gravstenarna', async () => {
    // Separata transaktioner: det första nekade kommandot avbryter sin transaktion.
    await expect(asUser(user.userId, companyId, (las) => las(
      'delete from crm.erased_sources WHERE company_id = $1', [companyId],
    ))).rejects.toThrow(/permission denied/);
    await expect(asUser(user.userId, companyId, (las) => las(
      'UPDATE crm.erased_sources SET source_ref = source_ref WHERE company_id = $1', [companyId],
    ))).rejects.toThrow(/permission denied/);
    const kvar = await withAdmin(async (client) => (await client.query(
      `SELECT source_system, source_ref FROM crm.erased_sources
       WHERE company_id = $1 ORDER BY source_ref`, [companyId],
    )).rows);
    expect(kvar).toEqual([
      { source_system: 'gmail', source_ref: 'gdpr-r1' },
      { source_system: 'gmail', source_ref: 'gdpr-r2' },
    ]);
  });
});

describe('nya källnycklar', () => {
  it('N1: en ny källnyckel skapar kontaktpunkten efter raderingen', async () => {
    const res = await act('ingest_crm_events', {
      events: [{
        kind: 'interaction', organization: { name: 'Gravstenen AB' },
        person: { name: 'Greta Gravsten', email: 'greta@gravstenen.example' },
        channel: 'email', direction: 'inbound', summary: 'Nytt mail efter raderingen.',
        occurred_at: '2026-09-01T09:00:00Z', source_system: 'gmail', source_ref: 'gdpr-ny-1',
      }],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.result.interactions_created).toBe(1);
    expect(res.body.result.skipped).toEqual([]);
    const rader = await withAdmin(async (client) => (await client.query(
      `SELECT source_system, source_ref FROM crm.interactions
       WHERE company_id = $1 AND source_system = 'gmail' AND source_ref = 'gdpr-ny-1'`, [companyId],
    )).rows);
    expect(rader).toEqual([{ source_system: 'gmail', source_ref: 'gdpr-ny-1' }]);
  });

  it('N2: samma källnyckel från ett annat källsystem avvisas inte', async () => {
    const res = await act('ingest_crm_events', {
      events: [{
        kind: 'interaction', organization: { name: 'Gravstenen AB' },
        channel: 'meeting', summary: 'Möte.', occurred_at: '2026-09-02T10:00:00Z',
        source_system: 'calendar', source_ref: 'gdpr-r1',
      }],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.result.interactions_created).toBe(1);
    expect(res.body.result.skipped).toEqual([]);
    const rader = await withAdmin(async (client) => (await client.query(
      `SELECT source_system, source_ref FROM crm.interactions
       WHERE company_id = $1 AND source_ref = 'gdpr-r1' ORDER BY source_system`, [companyId],
    )).rows);
    expect(rader).toEqual([{ source_system: 'calendar', source_ref: 'gdpr-r1' }]);
  });

  it('N3: den raderade batchen förblir spärrad också efter de nya händelserna', async () => {
    const res = await act('ingest_crm_events', BATCH_R);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.result.skipped).toEqual([{ index: 0, reason: SKAL }, { index: 1, reason: SKAL }]);
    expect(res.body.result.interactions_created).toBe(0);
    expect(res.body.result.commitments_created).toBe(0);
  });
});

describe('negativ kontroll: utan gravsten återuppstår personen', () => {
  beforeAll(async () => {
    const kund = await api.post(`/api/companies/${companyId}/customers`)
      .set('Authorization', `Bearer ${user.token}`).send({ name: 'Kontrollkunden AB' });
    expect(kund.status, JSON.stringify(kund.body)).toBe(201);
    const res = await act('ingest_crm_events', BATCH_K);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.result).toMatchObject({
      people_created: 1, interactions_created: 1, commitments_created: 1,
      organizations_linked: 1, skipped: [],
    });
    const raderad = await anonymisera(kund.body.customer.id);
    expect(raderad.godkannande.body.result).toMatchObject({
      crm_people_removed: 1, crm_interactions_removed: 1, crm_commitments_removed: 1,
    });
  });

  it('K: utan gravsten skapar samma batch personen och båda händelserna igen', async () => {
    // Enda skrivningen som ägare: plantera den saknade spärren för just K.
    const borttagna = await withAdmin((client) => client.query(
      `DELETE FROM crm.erased_sources
       WHERE company_id = $1 AND source_system = 'gmail' AND source_ref IN ('gdpr-k1', 'gdpr-k2')`,
      [companyId],
    ));
    expect(borttagna.rowCount, 'den negativa kontrollen måste ta bort exakt K:s två gravstenar').toBe(2);
    const res = await act('ingest_crm_events', BATCH_K);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.result.skipped).toEqual([]);
    expect(res.body.result.people_created).toBe(1);
    expect(res.body.result.interactions_created).toBe(1);
    expect(res.body.result.commitments_created).toBe(1);
    const personer = await withAdmin(async (client) => (await client.query(
      `SELECT id FROM crm.people
       WHERE company_id = $1 AND lower(email) = 'karl@kontrollkunden.example'`, [companyId],
    )).rows);
    expect(personer).toHaveLength(1);
    negativKordes = true;
  });

  it('KV: den negativa kontrollen kördes till slut', () => {
    expect(negativKordes).toBe(true);
  });
});

describe('tenant-isolering', () => {
  beforeAll(async () => {
    granne = await registerUser('gdprgranne');
    grannbolagId = await createCompany(granne.token, 'Grannbolaget GDPR AB');
  });

  it('T1: vårt bolags gravstenar spärrar inte samma källpar hos grannen', async () => {
    const res = await api.post(`/api/companies/${grannbolagId}/actions/ingest_crm_events`)
      .set('Authorization', `Bearer ${granne.token}`).send(BATCH_R);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.result.interactions_created).toBe(1);
    expect(res.body.result.commitments_created).toBe(1);
    expect(res.body.result.skipped).toEqual([]);
  });

  it('T2: app med grannens identitet ser inga gravstenar i vårt forcerade bolag', async () => {
    const egna = await asUser(user.userId, companyId, (las) => las(
      'SELECT source_system, source_ref FROM crm.erased_sources WHERE company_id = $1', [companyId],
    ));
    expect(egna.rows).toEqual(expect.arrayContaining([
      { source_system: 'gmail', source_ref: 'gdpr-r1' },
      { source_system: 'gmail', source_ref: 'gdpr-r2' },
    ]));
    const andras = await asUser(granne.userId, companyId, (las) => las(
      'SELECT source_system, source_ref FROM crm.erased_sources WHERE company_id = $1', [companyId],
    ));
    expect(andras.rows).toEqual([]);
  });

  it('T3: grannens intag under vårt bolag ger 404 och ändrar inga radantal', async () => {
    const fore = await ownerLas((las) => radantal(las, companyId));
    const res = await api.post(`/api/companies/${companyId}/actions/ingest_crm_events`)
      .set('Authorization', `Bearer ${granne.token}`).send(BATCH_K);
    expect(res.status, JSON.stringify(res.body)).toBe(404);
    const efter = await ownerLas((las) => radantal(las, companyId));
    expect(efter).toEqual(fore);
  });
});
