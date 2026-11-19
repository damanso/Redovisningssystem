// CRM 1.1: en rättelse får inte skrivas över av nästa synk, ett ursprung får
// aldrig hittas på eller läcka mellan bolag. Provar migration, tjänst,
// åtgärder, intag och webbens POST för status mot riktig Postgres.
import pg from 'pg';
import supertest from 'supertest';
import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadMigrations } from '../src/db/migrate.js';
import { confirmValue, guardHumanFields, readProvenance, recordProvenance } from '../src/services/crmProvenance.js';
import { withTenantTransaction } from '../src/db/tx.js';
import { api, app, createCompany, registerUser, withAdmin, type TestUser } from './helpers.js';

let user: TestUser;
let other: TestUser;
let companyId: string;
let otherCompany: string;
let agentToken: string;
let session: ReturnType<typeof supertest.agent>;
beforeAll(async () => {
  user = await registerUser('event-origin-a');
  other = await registerUser('event-origin-b');
  companyId = await createCompany(user.token, 'Ursprungsprovet A');
  otherCompany = await createCompany(other.token, 'Ursprungsprovet B');
  const token = await api.post(`/api/companies/${companyId}/agent-tokens`)
    .set('Authorization', `Bearer ${user.token}`).send({ name: 'ursprungsprovet' });
  expect(token.status, JSON.stringify(token.body)).toBe(201);
  agentToken = token.body.token;
  session = supertest.agent(app);
  const login = await session.post('/app/login').type('form')
    .send({ email: user.email, password: 'mycket-hemligt-losen-123' });
  expect(login.status, login.text).toBe(302);
});

/** Direktplanterade rader saknar ursprung även efter senare skrivvägsändringar. */
async function fixture(company = companyId) {
  return withAdmin(async (c) => {
    const org = (await c.query("INSERT INTO crm.organizations (company_id, name) VALUES ($1, gen_random_uuid()::text) RETURNING id", [company])).rows[0]!.id as string;
    const interaction = (await c.query(`INSERT INTO crm.interactions
      (company_id, organization_id, occurred_at, channel, summary, source_system)
      VALUES ($1,$2,'2026-06-01T09:00:00Z','email','Ursprunglig kontakt','gmail') RETURNING id`, [company, org])).rows[0]!.id as string;
    const commitment = (await c.query(`INSERT INTO crm.commitments
      (company_id, organization_id, direction, body, occurred_at, source_system)
      VALUES ($1,$2,'we_owe','Ursprungligt löfte','2026-06-01T09:00:00Z','linear') RETURNING id`, [company, org])).rows[0]!.id as string;
    return { org, interaction, commitment };
  });
}
async function migration() {
  const matches = (await loadMigrations()).filter((m) => m.name === 'crm_event_provenance');
  expect(matches).toHaveLength(1);
  return matches[0]!;
}
const NAMES = ['interactions_id_company_uk', 'commitments_id_company_uk',
  'field_provenance_interaction_fk', 'field_provenance_commitment_fk',
  'field_provenance_interaction_uk', 'field_provenance_commitment_uk', 'field_provenance_target_ck'];
const SCRATCH = 'redovisning_test_event_origin';
let scratch: pg.Client | undefined;
async function maintenance(sql: string) {
  const c = new pg.Client({ connectionString: process.env.MAINTENANCE_DATABASE_URL });
  await c.connect();
  try { await c.query(sql); } finally { await c.end(); }
}
async function beforeMigration() {
  await maintenance(`DROP DATABASE IF EXISTS ${SCRATCH} WITH (FORCE)`);
  await maintenance(`CREATE DATABASE ${SCRATCH}`);
  const url = new URL(process.env.DATABASE_ADMIN_URL!);
  url.pathname = `/${SCRATCH}`;
  scratch = new pg.Client({ connectionString: url.toString() });
  await scratch.connect();
  const m = await migration();
  for (const previous of (await loadMigrations()).filter((x) => x.version < m.version)) await scratch.query(previous.sql);
  return scratch;
}
afterAll(async () => {
  if (scratch) {
    await scratch.end();
    await maintenance(`DROP DATABASE IF EXISTS ${SCRATCH} WITH (FORCE)`);
  }
});
const snapshot = async (c: pg.Client) => (await c.query(`SELECT id, organization_id, person_id, field, source,
  source_system, source_ref FROM crm.field_provenance ORDER BY id`)).rows;
const objects = async (c: pg.Client) => (await c.query(`SELECT conname AS name, oid::text FROM pg_constraint
  WHERE conname = ANY($1::text[]) UNION ALL SELECT relname AS name, oid::text FROM pg_class
  WHERE relname = ANY($1::text[]) AND relname IN ('field_provenance_interaction_uk','field_provenance_commitment_uk') ORDER BY name`, [NAMES])).rows;

describe('migrationen och bolagsisoleringen', () => {
  it('M1 målkolumnerna är nullbara uuid', async () => {
    const rows = await withAdmin(async (c) => (await c.query(`SELECT column_name, data_type, is_nullable
      FROM information_schema.columns WHERE table_schema = 'crm' AND table_name = 'field_provenance'
      AND column_name IN ('interaction_id','commitment_id') ORDER BY column_name`)).rows);
    expect(rows).toEqual([
      { column_name: 'commitment_id', data_type: 'uuid', is_nullable: 'YES' },
      { column_name: 'interaction_id', data_type: 'uuid', is_nullable: 'YES' },
    ]);
  });
  it('M2 sammansatta främmande nycklar med kaskad och unika föräldrar', async () => {
    const rows = await withAdmin(async (c) => (await c.query(`SELECT conname, contype, confdeltype,
      cardinality(conkey) AS n, pg_get_constraintdef(oid) AS def FROM pg_constraint
      WHERE conname = ANY($1::text[])`, [NAMES.slice(0, 4)])).rows);
    expect(rows).toHaveLength(4);
    for (const name of NAMES.slice(0, 2)) expect(rows.find((r) => r.conname === name)).toMatchObject({ contype: 'u', n: 2 });
    for (const [name, target] of [['field_provenance_interaction_fk', 'interactions'], ['field_provenance_commitment_fk', 'commitments']]) {
      const row = rows.find((r) => r.conname === name);
      expect(row).toMatchObject({ contype: 'f', confdeltype: 'c', n: 2 });
      expect(row!.def).toContain(`REFERENCES crm.${target}(id, company_id)`);
    }
  });
  it('M3 exakt ett av fyra mål, också negativ kontroll utan mål', async () => {
    const f = await fixture();
    const def = await withAdmin(async (c) => (await c.query("SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'field_provenance_target_ck'")).rows[0]!.def);
    for (const col of ['organization_id', 'person_id', 'interaction_id', 'commitment_id']) expect(def).toContain(col);
    for (const org of [f.org, null]) {
      await expect(withAdmin((c) => c.query(`INSERT INTO crm.field_provenance
        (company_id, organization_id, interaction_id, field, source) VALUES ($1,$2,$3,'summary','sync')`,
      [companyId, org, org ? f.interaction : null]))).rejects.toMatchObject({ code: '23514' });
    }
  });
  it('M4 partiella unika index för händelserna', async () => {
    const rows = await withAdmin(async (c) => (await c.query(`SELECT indexname, indexdef FROM pg_indexes
      WHERE schemaname = 'crm' AND tablename = 'field_provenance'`)).rows);
    for (const [name, col] of [['field_provenance_interaction_uk', 'interaction_id'], ['field_provenance_commitment_uk', 'commitment_id']]) {
      const row = rows.find((r) => r.indexname === name);
      expect(row).toBeDefined();
      expect(row!.indexdef).toContain(`UNIQUE INDEX ${name}`);
      expect(row!.indexdef).toContain(`(company_id, ${col}, field) WHERE (${col} IS NOT NULL)`);
    }
  });
  it('M5 migrationen bevarar fyra gamla ursprung och bakåtfyller inga händelser', async () => {
    const c = await beforeMigration();
    const co = (await c.query("INSERT INTO companies (name) VALUES ('Äldre ursprung') RETURNING id")).rows[0]!.id;
    const org = (await c.query("INSERT INTO crm.organizations (company_id,name) VALUES ($1,'Äldre organisation') RETURNING id", [co])).rows[0]!.id;
    const person = (await c.query("INSERT INTO crm.people (company_id,name,organization_id) VALUES ($1,'Äldre person',$2) RETURNING id", [co, org])).rows[0]!.id;
    await c.query(`INSERT INTO crm.interactions (company_id,organization_id,occurred_at,channel,summary,source_system)
      VALUES ($1,$2,now(),'email','Äldre kontakt','gmail')`, [co, org]);
    await c.query(`INSERT INTO crm.commitments (company_id,organization_id,occurred_at,direction,body,source_system)
      VALUES ($1,$2,now(),'we_owe','Äldre löfte','linear')`, [co, org]);
    await c.query(`INSERT INTO crm.field_provenance (company_id,organization_id,person_id,field,source)
      VALUES ($1,$2,NULL,'name','human'),($1,$2,NULL,'website','sync'),
             ($1,NULL,$3,'name','human'),($1,NULL,$3,'email','sync')`, [co, org, person]);
    const before = await snapshot(c);
    expect(before).toHaveLength(4);
    await c.query('BEGIN');
    await c.query((await migration()).sql);
    await c.query('COMMIT');
    expect(await snapshot(c)).toEqual(before);
    expect((await c.query('SELECT * FROM crm.field_provenance WHERE interaction_id IS NOT NULL OR commitment_id IS NOT NULL')).rows).toEqual([]);
  });
  it('M6 en andra körning bevarar sju objekt och deras oid samt raderna', async () => {
    expect(scratch).toBeDefined();
    const c = scratch!;
    const before = await snapshot(c);
    const catalog = await objects(c);
    expect(catalog.map((x) => x.name)).toEqual([...NAMES].sort());
    await c.query('BEGIN');
    await c.query((await migration()).sql);
    await c.query('COMMIT');
    expect(await objects(c)).toEqual(catalog);
    expect(await snapshot(c)).toEqual(before);
    expect(before).toHaveLength(4);
  });
  it('M7 en enda additiv migration utan data eller ändringar av sfärens mekanismer', async () => {
    const m = await migration();
    expect(m.filename).toMatch(/_crm_event_provenance\.sql$/);
    const sql = m.sql.replace(/--[^\n]*/g, '');
    expect(sql).toContain("SET LOCAL lock_timeout = '5s';");
    for (const forbidden of ['sfar', 'privat', 'email_outbox', 'TRIGGER', 'FUNCTION', 'POLICY', 'GRANT', 'SCHEMA', 'INSERT INTO', 'UPDATE crm', 'DELETE FROM']) expect(sql).not.toContain(forbidden);
    expect(sql.match(/DROP[^;]+/g)).toEqual(['DROP CONSTRAINT IF EXISTS field_provenance_target_ck']);
  });
  it('K1 händelsens ursprung dör genom kaskad, organisationens står kvar', async () => {
    const f = await fixture();
    await withAdmin(async (c) => {
      await c.query(`INSERT INTO crm.field_provenance (company_id,interaction_id,field,source)
        VALUES ($1,$2,'summary','sync'),($1,$2,'channel','sync')`, [companyId, f.interaction]);
      await c.query(`INSERT INTO crm.field_provenance (company_id,commitment_id,field,source)
        VALUES ($1,$2,'body','sync'),($1,$2,'direction','sync')`, [companyId, f.commitment]);
      await c.query("INSERT INTO crm.field_provenance (company_id,organization_id,field,source) VALUES ($1,$2,'name','human')", [companyId, f.org]);
      await c.query('DELETE FROM crm.interactions WHERE id = $1', [f.interaction]);
      await c.query('DELETE FROM crm.commitments WHERE id = $1', [f.commitment]);
      expect((await c.query('SELECT field FROM crm.field_provenance WHERE interaction_id = $1 OR commitment_id = $2', [f.interaction, f.commitment])).rows).toEqual([]);
      expect((await c.query('SELECT field FROM crm.field_provenance WHERE organization_id = $1', [f.org])).rows).toEqual([{ field: 'name' }]);
    });
  });
  it('K2 sammansatta FK avvisar båda händelsetyperna från ett annat bolag', async () => {
    const f = await fixture(otherCompany);
    await expect(withAdmin((c) => c.query("INSERT INTO crm.field_provenance (company_id,interaction_id,field,source) VALUES ($1,$2,'summary','ai')", [companyId, f.interaction]))).rejects.toMatchObject({ code: '23503' });
    await expect(withAdmin((c) => c.query("INSERT INTO crm.field_provenance (company_id,commitment_id,field,source) VALUES ($1,$2,'body','ai')", [companyId, f.commitment]))).rejects.toMatchObject({ code: '23503' });
  });
  it('K3 app i B kan varken läsa, infoga, ändra eller radera A:s ursprung', async () => {
    const f = await fixture();
    const id = await withAdmin(async (c) => (await c.query(`INSERT INTO crm.field_provenance
      (company_id,interaction_id,field,source) VALUES ($1,$2,'summary','human') RETURNING id`, [companyId, f.interaction])).rows[0]!.id);
    const inB = <T>(fn: (c: pg.PoolClient) => Promise<T>) => withTenantTransaction(other.userId, otherCompany, fn);
    expect(await inB(async (c) => (await c.query('SELECT * FROM crm.field_provenance WHERE id = $1', [id])).rows)).toEqual([]);
    await expect(inB((c) => c.query("INSERT INTO crm.field_provenance (company_id,interaction_id,field,source) VALUES ($1,$2,'channel','ai')", [companyId, f.interaction]))).rejects.toMatchObject({ code: '42501' });
    await expect(inB((c) => c.query("INSERT INTO crm.field_provenance (company_id,interaction_id,field,source) VALUES ($1,$2,'channel','ai')", [otherCompany, f.interaction]))).rejects.toMatchObject({ code: '23503' });
    expect(await inB(async (c) => (await c.query("UPDATE crm.field_provenance SET source = 'ai' WHERE id = $1", [id])).rowCount)).toBe(0);
    expect(await inB(async (c) => (await c.query('DELETE FROM crm.field_provenance WHERE id = $1', [id])).rowCount)).toBe(0);
    expect(await withAdmin(async (c) => (await c.query('SELECT source FROM crm.field_provenance WHERE id = $1', [id])).rows)).toEqual([{ source: 'human' }]);
  });
});

const tenant = <T>(fn: (c: pg.PoolClient) => Promise<T>) => withTenantTransaction(user.userId, companyId, fn);
describe('fyra mål i ursprungsmodulen', () => {
  it('P1 kontaktpunkten får bara sina egna två fält', async () => {
    const f = await fixture();
    await tenant(async (c) => {
      await recordProvenance(c, companyId, user.userId, { interaction_id: f.interaction }, [
        { field: 'summary', source: 'ai' }, { field: 'channel', source: 'sync', source_system: 'gmail', source_ref: 'gmail:p1' },
      ]);
      const p = await readProvenance(c, companyId, { interaction_id: f.interaction });
      expect([...p.keys()].sort()).toEqual(['channel', 'summary']);
      expect(p.get('summary')?.source).toBe('ai');
      expect(p.get('channel')).toMatchObject({ source: 'sync', source_system: 'gmail', source_ref: 'gmail:p1' });
      expect((await c.query(`SELECT organization_id, person_id, interaction_id, commitment_id
        FROM crm.field_provenance WHERE company_id = $1 AND interaction_id = $2`, [companyId, f.interaction])).rows)
        .toEqual(Array(2).fill({ organization_id: null, person_id: null, interaction_id: f.interaction, commitment_id: null }));
    });
  });
  it('P2 löftet får bara sina egna två fält', async () => {
    const f = await fixture();
    await tenant(async (c) => {
      await recordProvenance(c, companyId, user.userId, { commitment_id: f.commitment }, [
        { field: 'body', source: 'ai' }, { field: 'due_date', source: 'sync', source_system: 'linear', source_ref: 'linear:p2' },
      ]);
      const p = await readProvenance(c, companyId, { commitment_id: f.commitment });
      expect([...p.keys()].sort()).toEqual(['body', 'due_date']);
      expect(p.get('body')?.source).toBe('ai');
      expect(p.get('due_date')).toMatchObject({ source: 'sync', source_system: 'linear', source_ref: 'linear:p2' });
      expect((await c.query(`SELECT organization_id, person_id, interaction_id, commitment_id
        FROM crm.field_provenance WHERE company_id = $1 AND commitment_id = $2`, [companyId, f.commitment])).rows)
        .toEqual(Array(2).fill({ organization_id: null, person_id: null, interaction_id: null, commitment_id: f.commitment }));
    });
  });
  it('P3 samma mål och fält får en rad med senaste ursprunget', async () => {
    const f = await fixture();
    await tenant(async (c) => {
      for (const source of ['ai', 'human'] as const) await recordProvenance(c, companyId, user.userId,
        { interaction_id: f.interaction }, [{ field: 'summary', source }]);
      expect((await c.query('SELECT field, source FROM crm.field_provenance WHERE company_id = $1 AND interaction_id = $2', [companyId, f.interaction])).rows)
        .toEqual([{ field: 'summary', source: 'human' }]);
    });
  });
  it('P4 vakten skyddar bara målets människofält och släpper människan igenom', async () => {
    const y = await fixture();
    const y2 = await fixture();
    await withAdmin(async (c) => {
      await c.query(`INSERT INTO crm.field_provenance (company_id,commitment_id,field,source)
        VALUES ($1,$2,'body','human'),($1,$3,'direction','human')`, [companyId, y.commitment, y2.commitment]);
    });
    await tenant(async (c) => {
      const input = { body: 'Ny text', direction: 'they_owe' };
      expect(await guardHumanFields(c, companyId, { commitment_id: y.commitment }, 'sync', input))
        .toEqual({ input: { direction: 'they_owe' }, blocked: ['body'] });
      expect(await guardHumanFields(c, companyId, { commitment_id: y.commitment }, 'human', input))
        .toEqual({ input, blocked: [] });
    });
  });
  it('P5 bekräftelse ger människoursprung utan att ändra löftets riktning', async () => {
    const f = await fixture();
    await tenant(async (c) => {
      await confirmValue(c, companyId, user.userId, { commitment_id: f.commitment }, 'direction');
      expect((await readProvenance(c, companyId, { commitment_id: f.commitment })).get('direction'))
        .toMatchObject({ source: 'human', reason: 'bekräftad av människa' });
      expect((await c.query('SELECT direction FROM crm.commitments WHERE company_id = $1 AND id = $2', [companyId, f.commitment])).rows)
        .toEqual([{ direction: 'we_owe' }]);
    });
  });
  it('P6 två kontaktpunkter, ett löfte och en organisation håller isär läsningarna', async () => {
    const f = await fixture();
    const x2 = await withAdmin(async (c) => (await c.query(`INSERT INTO crm.interactions
      (company_id,organization_id,occurred_at,channel,summary,source_system)
      VALUES ($1,$2,now(),'email','Andra kontakten','gmail') RETURNING id`, [companyId, f.org])).rows[0]!.id as string);
    await tenant(async (c) => {
      await recordProvenance(c, companyId, user.userId, { interaction_id: f.interaction }, [{ field: 'summary', source: 'ai' }]);
      await recordProvenance(c, companyId, user.userId, { interaction_id: x2 }, [{ field: 'summary', source: 'human' }]);
      await recordProvenance(c, companyId, user.userId, { commitment_id: f.commitment }, [{ field: 'body', source: 'sync' }]);
      await recordProvenance(c, companyId, user.userId, { organization_id: f.org }, [{ field: 'name', source: 'human' }]);
      const x = await readProvenance(c, companyId, { interaction_id: f.interaction });
      expect([...x.keys()]).toEqual(['summary']);
      expect(x.get('summary')?.source).toBe('ai');
      expect([...(await readProvenance(c, companyId, { commitment_id: f.commitment })).keys()]).toEqual(['body']);
      expect([...(await readProvenance(c, companyId, { organization_id: f.org })).keys()]).toEqual(['name']);
    });
  });
});

const act = (name: string, body: Record<string, unknown>, agent = false) => api
  .post(`/api/companies/${companyId}/actions/${name}`)
  .set('Authorization', `Bearer ${agent ? agentToken : user.token}`).send(body);
async function result(name: string, body: Record<string, unknown>, agent = false) {
  const r = await act(name, body, agent);
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body.result;
}
const mail = (ref: string, name: string) => ({ kind: 'interaction', organization: { name },
  occurred_at: '2026-06-01T09:00:00Z', channel: 'email', direction: 'inbound',
  summary: 'Ursprunglig kontakt', source_system: 'gmail', source_ref: ref });
const promiseEvent = (ref: string, name: string) => ({ kind: 'commitment', organization: { name },
  occurred_at: '2026-06-01T09:00:00Z', commitment_direction: 'we_owe', body: 'Ursprungligt löfte',
  due_date: '2026-06-10', source_system: 'linear', source_ref: ref });
async function ingest(events: Record<string, unknown>[]) {
  const r = await result('ingest_crm_events', { events }, true);
  expect(r.skipped).toEqual([]);
  return r;
}
async function eventRow(kind: 'interaction' | 'commitment', ref: string) {
  return withAdmin(async (c) => (await c.query(kind === 'interaction'
    ? 'SELECT id, summary, channel, direction, occurred_at FROM crm.interactions WHERE company_id = $1 AND source_ref = $2'
    : 'SELECT id, body, direction, due_date::text, occurred_at, status, sfar FROM crm.commitments WHERE company_id = $1 AND source_ref = $2',
  [companyId, ref])).rows[0]!);
}
async function provenance(kind: 'interaction' | 'commitment', id: string) {
  return withAdmin(async (c) => (await c.query(kind === 'interaction'
    ? 'SELECT field, source, source_system, source_ref, reason FROM crm.field_provenance WHERE company_id = $1 AND interaction_id = $2 ORDER BY field'
    : 'SELECT field, source, source_system, source_ref, reason FROM crm.field_provenance WHERE company_id = $1 AND commitment_id = $2 ORDER BY field',
  [companyId, id])).rows);
}
async function humanField(kind: 'interaction' | 'commitment', id: string, field: string) {
  await tenant((c) => recordProvenance(c, companyId, user.userId,
    kind === 'interaction' ? { interaction_id: id } : { commitment_id: id }, [{ field, source: 'human' }]));
}
/** T2 startas med then. Blockeringen observeras i Postgres, aldrig med en gissad paus. */
async function race<T>(setup: (c: pg.Client) => Promise<unknown>, run: () => Promise<T>, unlockedPerson?: string) {
  const t1 = new pg.Client({ connectionString: process.env.DATABASE_ADMIN_URL });
  await t1.connect();
  let pending: Promise<T> | undefined;
  try {
    await t1.query('BEGIN');
    const pid = (await t1.query('SELECT pg_backend_pid() AS pid')).rows[0]!.pid as number;
    await setup(t1);
    pending = run();
    let blocked = false;
    for (let i = 0; i < 100; i++) {
      const waiting = await withAdmin((monitor) => monitor.query(
        'SELECT 1 FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))', [pid]));
      if (waiting.rowCount) { blocked = true; break; }
      await new Promise((done) => setTimeout(done, 20));
    }
    expect(blocked, 'T2 ska vänta på T1:s radlås').toBe(true);
    if (unlockedPerson) await withAdmin(async (third) => {
      await third.query('BEGIN');
      try {
        const r = await third.query('SELECT id FROM crm.people WHERE company_id = $1 AND id = $2 FOR UPDATE NOWAIT', [companyId, unlockedPerson]);
        expect(r.rowCount).toBe(1);
      } finally { await third.query('ROLLBACK'); }
    });
    await t1.query('COMMIT');
    return await pending;
  } finally {
    await t1.query('ROLLBACK');
    await t1.end();
    // Även när låsassertionen faller avslutas den startade begäran före nästa fall.
    if (pending) await pending.catch(() => undefined);
  }
}

async function logTrigger(kind: 'interaction' | 'commitment') {
  await withAdmin(async (c) => {
    if (kind === 'interaction') await c.query(`
      CREATE TABLE crm.origin_interaction_log (id uuid);
      GRANT SELECT, INSERT ON crm.origin_interaction_log TO app;
      CREATE FUNCTION crm.origin_interaction_probe() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN INSERT INTO crm.origin_interaction_log VALUES (NEW.id); RETURN NEW; END $$;
      CREATE TRIGGER origin_interaction_probe BEFORE UPDATE OF organization_id, person_id ON crm.interactions
      FOR EACH ROW EXECUTE FUNCTION crm.origin_interaction_probe()`);
    else await c.query(`
      CREATE TABLE crm.origin_commitment_log (id uuid);
      GRANT SELECT, INSERT ON crm.origin_commitment_log TO app;
      CREATE FUNCTION crm.origin_commitment_probe() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN INSERT INTO crm.origin_commitment_log VALUES (NEW.id); RETURN NEW; END $$;
      CREATE TRIGGER origin_commitment_probe BEFORE UPDATE OF sfar, organization_id, person_id ON crm.commitments
      FOR EACH ROW EXECUTE FUNCTION crm.origin_commitment_probe()`);
  });
}

describe('händelsernas skrivvägar och intagets poster', () => {
  it('H1 kontaktpunktens fyra fält får sync med källnyckeln', async () => {
    await ingest([mail('gmail:h1', 'H1 Bolaget AB')]);
    const row = await eventRow('interaction', 'gmail:h1');
    expect(await provenance('interaction', row.id)).toEqual(['channel', 'direction', 'occurred_at', 'summary'].map((field) =>
      ({ field, source: 'sync', source_system: 'gmail', source_ref: 'gmail:h1', reason: 'hämtad från gmail' })));
  });
  it('H2 löftets fyra skrivna fält får sync, aldrig status eller sfar', async () => {
    await ingest([promiseEvent('linear:LOC-H2', 'H2 Bolaget AB')]);
    const row = await eventRow('commitment', 'linear:LOC-H2');
    expect(await provenance('commitment', row.id)).toEqual(['body', 'direction', 'due_date', 'occurred_at'].map((field) =>
      ({ field, source: 'sync', source_system: 'linear', source_ref: 'linear:LOC-H2', reason: 'hämtad från linear' })));
  });
  it('H3 löfte utan förfallodatum ger inget ursprung för due_date', async () => {
    const { due_date, ...event } = promiseEvent('linear:LOC-H3', 'H3 Bolaget AB');
    await ingest([event]);
    const row = await eventRow('commitment', 'linear:LOC-H3');
    expect((await provenance('commitment', row.id)).map((p) => p.field)).toEqual(['body', 'direction', 'occurred_at']);
  });
  it('H4 människans summary står kvar medan övriga fält följer källan', async () => {
    const event = mail('gmail:x', 'H4 Bolaget AB');
    await ingest([event]);
    const row = await eventRow('interaction', event.source_ref);
    await humanField('interaction', row.id, 'summary');
    const r = await ingest([{ ...event, summary: 'Ny kontakt', channel: 'meeting', direction: 'outbound', occurred_at: '2026-06-02T10:00:00Z' }]);
    expect(r.interactions_unchanged).toBe(1);
    expect(r.kept_human_fields.filter((x: string) => x.includes(': gmail:x '))).toEqual(['H4 Bolaget AB: gmail:x summary']);
    const after = await eventRow('interaction', event.source_ref);
    expect(after).toMatchObject({ summary: 'Ursprunglig kontakt', channel: 'meeting', direction: 'outbound' });
    expect(after.occurred_at.toISOString()).toBe('2026-06-02T10:00:00.000Z');
    expect((await provenance('interaction', row.id)).map((p) => [p.field, p.source])).toEqual([
      ['channel', 'sync'], ['direction', 'sync'], ['occurred_at', 'sync'], ['summary', 'human'],
    ]);
  });
  async function protectedPromise(ref: string, field: string, name = 'Löftesbolaget AB') {
    const event = promiseEvent(ref, name);
    await ingest([event]);
    const row = await eventRow('commitment', ref);
    await humanField('commitment', row.id, field);
    const r = await ingest([{ ...event, body: 'Ny löftestext', commitment_direction: 'they_owe', due_date: '2026-06-20', occurred_at: '2026-06-02T10:00:00Z' }]);
    expect(r.commitments_unchanged).toBe(1);
    expect(r.kept_human_fields.filter((x: string) => x.includes(`: ${ref} `))).toEqual([`${name}: ${ref} ${field}`]);
    const after = await eventRow('commitment', ref);
    expect(after.body).toBe(field === 'body' ? 'Ursprungligt löfte' : 'Ny löftestext');
    expect(after.direction).toBe(field === 'direction' ? 'we_owe' : 'they_owe');
    expect(after.due_date).toBe(field === 'due_date' ? '2026-06-10' : '2026-06-20');
    expect(after.occurred_at.toISOString()).toBe(field === 'occurred_at' ? '2026-06-01T09:00:00.000Z' : '2026-06-02T10:00:00.000Z');
    expect((await provenance('commitment', row.id)).map((p) => [p.field, p.source])).toEqual([
      ['body', field === 'body' ? 'human' : 'sync'], ['direction', field === 'direction' ? 'human' : 'sync'],
      ['due_date', field === 'due_date' ? 'human' : 'sync'], ['occurred_at', field === 'occurred_at' ? 'human' : 'sync'],
    ]);
  }
  it('H5 body skyddas för sig', async () => { await protectedPromise('linear:LOC-1', 'body'); });
  it('H6 direction skyddas för sig', async () => { await protectedPromise('linear:LOC-2', 'direction'); });
  it('H7 due_date skyddas för sig', async () => { await protectedPromise('linear:LOC-3', 'due_date'); });
  it('H8 occurred_at skyddas för sig', async () => { await protectedPromise('linear:LOC-4', 'occurred_at'); });
  it('H9 webbens klarmarkering ger status med human', async () => {
    await ingest([promiseEvent('linear:LOC-H9', 'H9 Bolaget AB')]);
    const row = await eventRow('commitment', 'linear:LOC-H9');
    const r = await session.post(`/app/c/${companyId}/commitments/${row.id}/done`)
      .type('form').send({});
    expect(r.status, r.text).toBe(302);
    expect((await eventRow('commitment', 'linear:LOC-H9')).status).toBe('done');
    expect((await provenance('commitment', row.id)).find((p) => p.field === 'status')?.source).toBe('human');
  });
  it('H10 agentens status får ai men människans status kan inte öppnas av agenten', async () => {
    await ingest([promiseEvent('linear:LOC-H10a', 'H10a Bolaget AB'), promiseEvent('linear:LOC-H10b', 'H10b Bolaget AB')]);
    const a = await eventRow('commitment', 'linear:LOC-H10a');
    const b = await eventRow('commitment', 'linear:LOC-H10b');
    await result('set_crm_commitment_status', { commitment_id: a.id, status: 'done' }, true);
    expect((await provenance('commitment', a.id)).find((p) => p.field === 'status')?.source).toBe('ai');
    await result('set_crm_commitment_status', { commitment_id: b.id, status: 'done' });
    const r = await result('set_crm_commitment_status', { commitment_id: b.id, status: 'open' }, true);
    expect(r.kept_human_fields).toEqual(['status']);
    expect(r.status).toBe('done');
    expect((await provenance('commitment', b.id)).find((p) => p.field === 'status')?.source).toBe('human');
  });
  it('H11 record_crm_interaction skiljer människans och agentens fyra fält', async () => {
    const f = await fixture();
    for (const agent of [false, true]) {
      const r = await result('record_crm_interaction', { organization_id: f.org, occurred_at: '2026-06-01T09:00:00Z', channel: 'call', summary: 'Samtal', source_system: 'manual' }, agent);
      expect((await provenance('interaction', r.id)).map((p) => [p.field, p.source])).toEqual([
        ['channel', agent ? 'ai' : 'human'], ['direction', agent ? 'ai' : 'human'], ['occurred_at', agent ? 'ai' : 'human'], ['summary', agent ? 'ai' : 'human'],
      ]);
    }
  });
  it('H12 record_crm_commitment skiljer människans och agentens fyra fält', async () => {
    const f = await fixture();
    for (const agent of [false, true]) {
      const r = await result('record_crm_commitment', { organization_id: f.org, occurred_at: '2026-06-01T09:00:00Z', direction: 'we_owe', body: 'Leverera underlag', due_date: '2026-06-10', source_system: 'manual' }, agent);
      expect((await provenance('commitment', r.id)).map((p) => [p.field, p.source])).toEqual([
        ['body', agent ? 'ai' : 'human'], ['direction', agent ? 'ai' : 'human'], ['due_date', agent ? 'ai' : 'human'], ['occurred_at', agent ? 'ai' : 'human'],
      ]);
    }
  });
  it('H13 log_contact skriver ursprung för alla fyra fält efter aktören', async () => {
    const f = await fixture();
    for (const agent of [false, true]) {
      const r = await result('log_contact', { organization_id: f.org }, agent);
      expect((await provenance('interaction', r.id)).map((p) => [p.field, p.source])).toEqual([
        ['channel', agent ? 'ai' : 'human'], ['direction', agent ? 'ai' : 'human'], ['occurred_at', agent ? 'ai' : 'human'], ['summary', agent ? 'ai' : 'human'],
      ]);
    }
  });
  it('H14 agentskrivningen behåller människans body och redovisar fältnamnet', async () => {
    const f = await fixture();
    const input = { organization_id: f.org, direction: 'we_owe', body: 'Människans text', occurred_at: '2026-06-01T09:00:00Z', source_system: 'gmail', source_ref: 'gmail:h14' };
    const r = await result('record_crm_commitment', input);
    await tenant((c) => recordProvenance(c, companyId, user.userId, { commitment_id: r.id }, [{ field: 'direction', source: 'sync' }, { field: 'occurred_at', source: 'sync' }]));
    const after = await result('record_crm_commitment', { ...input, body: 'Agentens text', direction: 'they_owe', occurred_at: '2026-06-02T10:00:00Z' }, true);
    expect(after).toMatchObject({ body: 'Människans text', direction: 'they_owe', kept_human_fields: ['body'] });
    expect((await eventRow('commitment', 'gmail:h14')).occurred_at.toISOString()).toBe('2026-06-02T10:00:00.000Z');
  });
  it('H15 äldre värde utan ursprung följer källan och spärras inte retroaktivt', async () => {
    const event = mail('gmail:h15', 'H15 Bolaget AB');
    await ingest([event]);
    const row = await eventRow('interaction', event.source_ref);
    await withAdmin((c) => c.query('DELETE FROM crm.field_provenance WHERE company_id = $1 AND interaction_id = $2', [companyId, row.id]));
    const r = await ingest([{ ...event, summary: 'Ny sammanfattning' }]);
    expect((await eventRow('interaction', event.source_ref)).summary).toBe('Ny sammanfattning');
    expect((await provenance('interaction', row.id)).find((p) => p.field === 'summary')).toMatchObject({ source: 'sync', source_ref: 'gmail:h15' });
    expect(r.kept_human_fields.filter((x: string) => x.includes(': gmail:h15 '))).toEqual([]);
  });
  it('E1 personens namn är prefix när händelsen saknar organisation', async () => {
    const { organization, ...event } = mail('gmail:e1', 'Används inte');
    const input = { ...event, person: { name: 'Ensam Person', email: 'ensam@prov.example' } };
    await ingest([input]);
    const row = await eventRow('interaction', event.source_ref);
    await humanField('interaction', row.id, 'summary');
    const r = await ingest([{ ...input, summary: 'Ny text' }]);
    expect(r.kept_human_fields).toContain('Ensam Person: gmail:e1 summary');
  });
  it('E2 samtidig människorättelse under löftets radlås vinner över synken', async () => {
    const event = promiseEvent('linear:LOC-E2', 'E2 Bolaget AB');
    await ingest([event]);
    const row = await eventRow('commitment', event.source_ref);
    const r = await race(async (c) => {
      await c.query('SELECT id FROM crm.commitments WHERE id = $1 FOR UPDATE', [row.id]);
      await c.query("UPDATE crm.field_provenance SET source = 'human' WHERE company_id = $1 AND commitment_id = $2 AND field = 'body'", [companyId, row.id]);
    }, () => ingest([{ ...event, body: 'Synkens text' }]));
    expect(r.kept_human_fields).toContain('E2 Bolaget AB: linear:LOC-E2 body');
    expect((await eventRow('commitment', event.source_ref)).body).toBe('Ursprungligt löfte');
  });
  it('S1 kontaktpunktens omsändning når UPDATE OF, negativ kontroll utan pekarkolumner', async () => {
    await logTrigger('interaction');
    const event = mail('gmail:s1', 'S1 Bolaget AB');
    await ingest([event]);
    const row = await eventRow('interaction', event.source_ref);
    await ingest([{ ...event, summary: 'Ny text' }]);
    await withAdmin(async (c) => {
      expect((await c.query('SELECT id FROM crm.origin_interaction_log WHERE id = $1', [row.id])).rows).toEqual([{ id: row.id }]);
      await c.query("UPDATE crm.interactions SET summary = 'Bara text' WHERE id = $1", [row.id]);
      expect((await c.query('SELECT id FROM crm.origin_interaction_log WHERE id = $1', [row.id])).rows).toEqual([{ id: row.id }]);
    });
  });
  it('S2 löftets omsändning når UPDATE OF med bevarad body och oskyddad sfar', async () => {
    await logTrigger('commitment');
    const event = promiseEvent('linear:LOC-S2', 'S2 Bolaget AB');
    await ingest([event]);
    const row = await eventRow('commitment', event.source_ref);
    await humanField('commitment', row.id, 'body');
    await ingest([{ ...event, body: 'Ny text' }]);
    expect(await withAdmin(async (c) => (await c.query('SELECT id FROM crm.origin_commitment_log WHERE id = $1', [row.id])).rows)).toEqual([{ id: row.id }]);
    expect(await eventRow('commitment', event.source_ref)).toMatchObject({ body: 'Ursprungligt löfte', sfar: 'foretag' });
    expect((await provenance('commitment', row.id)).some((p) => p.field === 'sfar')).toBe(false);
  });
});

async function personRow(id: string) {
  return withAdmin(async (c) => (await c.query('SELECT id, name, organization_id, sfar, external_ref, notes FROM crm.people WHERE company_id = $1 AND id = $2', [companyId, id])).rows[0]!);
}
async function personProvenance(id: string) {
  return withAdmin(async (c) => (await c.query(`SELECT field, source, source_system, source_ref
    FROM crm.field_provenance WHERE company_id = $1 AND person_id = $2 ORDER BY field`, [companyId, id])).rows);
}
describe('personens alla fält och radlås', () => {
  it('H16a en samtidig människas external_ref under personlåset står kvar', async () => {
    const org = await result('upsert_crm_organization', { name: 'H16 Bolaget AB' });
    const person = { name: 'Hedda Lås', email: 'hedda@prov.example' };
    const p = await result('upsert_crm_person', { ...person, organization_id: org.id });
    const event = { ...mail('gmail:h16a-1', 'H16 Bolaget AB'), person: { ...person, external_ref: 'valv:hedda-1' } };
    await ingest([event]);
    const r = await race(async (c) => {
      await c.query('SELECT id FROM crm.people WHERE company_id = $1 AND id = $2 FOR UPDATE', [companyId, p.id]);
      await c.query("UPDATE crm.people SET external_ref = 'valv:hedda-manniska' WHERE company_id = $1 AND id = $2", [companyId, p.id]);
      await c.query(`INSERT INTO crm.field_provenance (company_id,person_id,field,source)
        VALUES ($1,$2,'external_ref','human') ON CONFLICT (company_id,person_id,field)
        WHERE person_id IS NOT NULL DO UPDATE SET source = 'human'`, [companyId, p.id]);
    }, () => ingest([{ ...event, source_ref: 'gmail:h16a-2', person: { ...person, external_ref: 'valv:hedda-2' } }]));
    expect((await personRow(p.id)).external_ref).toBe('valv:hedda-manniska');
    expect((await personProvenance(p.id)).find((x) => x.field === 'external_ref')?.source).toBe('human');
    expect(r.kept_human_fields).toContain('Hedda Lås: external_ref');
  });
  it('H16b organisationen låses före personen också för agentens upsert', async () => {
    const org = await result('upsert_crm_organization', { name: 'H16b Bolaget AB' });
    const input = { name: 'Hilda Ordning', email: 'hilda@prov.example', organization_id: org.id };
    const p = await result('upsert_crm_person', input);
    const r = await race((c) => c.query('SELECT id FROM crm.organizations WHERE id = $1 FOR UPDATE', [org.id]),
      () => act('upsert_crm_person', { ...input, role_title: 'Kontaktperson' }, true).then((r) => r), p.id);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
  });
  it('H16c också organisationen personen lämnar låses före personen', async () => {
    const a = await result('upsert_crm_organization', { name: 'H16c A Bolaget AB' });
    const b = await result('upsert_crm_organization', { name: 'H16c B Bolaget AB' });
    const input = { name: 'Hugo Flytt', email: 'hugo@prov.example', organization_id: a.id };
    const p = await result('upsert_crm_person', input);
    const r = await race((c) => c.query('SELECT id FROM crm.organizations WHERE id = $1 FOR UPDATE', [a.id]),
      () => act('upsert_crm_person', { ...input, organization_id: b.id }).then((r) => r), p.id);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect((await personRow(p.id)).organization_id).toBe(b.id);
  });
  it('H16d agentens sfärbyte avvisas utan ändrad person eller ursprung', async () => {
    const input = { name: 'Hanna Sfär', email: 'hanna@prov.example' };
    const p = await result('upsert_crm_person', input);
    const before = await personRow(p.id);
    const origins = await personProvenance(p.id);
    const r = await act('upsert_crm_person', { ...input, sfar: 'privat' }, true);
    expect(r.status, JSON.stringify(r.body)).toBe(409);
    expect(r.body.error).toBe('byt_med_set_crm_sfar');
    expect(await personRow(p.id)).toEqual(before);
    expect(await personProvenance(p.id)).toEqual(origins);
  });
  it('H17 external_ref och notes skyddas, medan ett synkat external_ref följer källan', async () => {
    const anna = { name: 'Anna Ankare', email: 'anna@prov.example' };
    const p = await result('upsert_crm_person', { ...anna, external_ref: 'valv:anna', notes: 'Föredrar mail' });
    const { organization, ...event } = mail('gmail:h17a', 'Används inte');
    const r = await ingest([{ ...event, person: { ...anna, external_ref: 'valv:annan' } }]);
    expect(await personRow(p.id)).toMatchObject({ external_ref: 'valv:anna', notes: 'Föredrar mail' });
    const origins = await personProvenance(p.id);
    expect(origins.find((x) => x.field === 'external_ref')?.source).toBe('human');
    expect(origins.find((x) => x.field === 'notes')?.source).toBe('human');
    expect(r.kept_human_fields).toContain('Anna Ankare: external_ref');
    const bo = { name: 'Bo Berg', email: 'bo@prov.example', external_ref: 'valv:bo-1' };
    await ingest([{ ...event, source_ref: 'gmail:h17b', person: bo }]);
    const second = await ingest([{ ...event, source_ref: 'gmail:h17b', person: { ...bo, external_ref: 'valv:bo-2' } }]);
    const row = await withAdmin(async (c) => (await c.query("SELECT id, external_ref FROM crm.people WHERE company_id = $1 AND email = 'bo@prov.example'", [companyId])).rows[0]!);
    expect(row.external_ref).toBe('valv:bo-2');
    expect((await personProvenance(row.id)).find((x) => x.field === 'external_ref')).toMatchObject({ source: 'sync', source_system: 'gmail' });
    expect(second.kept_human_fields.filter((x: string) => x.includes('Bo Berg'))).toEqual([]);
  });
});

describe('idempotensen, människospärren och dokumenten', () => {
  it('I1 omsänd batch ger bara unchanged och samma antal unika ursprungsrader', async () => {
    const events = [
      { ...mail('gmail:i1', 'I1 Bolaget AB'), person: { name: 'Ida Idempotens', email: 'ida@prov.example' } },
      promiseEvent('linear:LOC-I1', 'I1 Löftesbolaget AB'),
    ];
    const count = async () => withAdmin(async (c) => (await c.query('SELECT count(*)::int AS n FROM crm.field_provenance WHERE company_id = $1', [companyId])).rows[0]!.n);
    await ingest(events);
    const before = await count();
    const r = await ingest(events);
    expect(r).toMatchObject({ interactions_unchanged: 1, commitments_unchanged: 1,
      interactions_created: 0, commitments_created: 0, organizations_created: 0, people_created: 0, kept_human_fields: [] });
    expect(await count()).toBe(before);
    expect(await withAdmin(async (c) => (await c.query(`SELECT count(*) FROM crm.field_provenance
      WHERE company_id = $1 GROUP BY organization_id,person_id,interaction_id,commitment_id,field
      HAVING count(*) > 1`, [companyId])).rows)).toEqual([]);
  });
  it('I2 agentens confirm_crm_value förblir förbjudet och ursprunget står kvar', async () => {
    const org = await result('upsert_crm_organization', { name: 'I2 Bolaget AB' });
    const before = await tenant((c) => readProvenance(c, companyId, { organization_id: org.id }));
    const r = await act('confirm_crm_value', { organization_id: org.id, field: 'name' }, true);
    expect(r.status, JSON.stringify(r.body)).toBe(403);
    expect(r.body.error).toBe('human_confirmation_required');
    expect(await tenant((c) => readProvenance(c, companyId, { organization_id: org.id }))).toEqual(before);
  });
  it('I3 kontraktets Människan vinner beskriver händelseformen och alla skyddade fält', async () => {
    const text = await readFile(new URL('../../docs/crm/API_KONTRAKT.md', import.meta.url), 'utf8');
    const section = text.split('## Människan vinner\n')[1]?.split('\n## ')[0];
    expect(section).toBeDefined();
    expect(section).toContain('<organisation>: <källnyckel> <fält>');
    for (const field of ['occurred_at', 'channel', 'direction', 'summary', 'body', 'due_date', 'status', 'external_ref', 'notes']) expect(section).toContain(`\`${field}\``);
  });
  it('I4 åtgärdsdokumentet beskriver blockerade fält på de fem skrivvägarna', async () => {
    const text = await readFile(new URL('../../docs/MCP_ACTIONS.md', import.meta.url), 'utf8');
    const heading = '## Händelsernas ursprung (crm 1.1)';
    expect(text.split(heading)).toHaveLength(2);
    const section = text.split(heading)[1]!.split('\n## ')[0]!;
    expect(section).not.toContain('\n### ');
    for (const name of ['record_crm_interaction', 'record_crm_commitment', 'log_contact', 'set_crm_commitment_status', 'upsert_crm_person', 'kept_human_fields']) expect(section).toContain(`\`${name}\``);
  });
});
