// FR-8/FR-26: en människorättelse får inte skrivas över av nästa synk.
// Prövar även påhittat ursprung, kaskad och läckor mellan bolag i migration,
// ursprungstjänst, skrivtjänst, actions, intag och löftets befintliga vy-POST.
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import supertest from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadMigrations, type MigrationFile } from '../src/db/migrate.js';
import { withTenantTransaction } from '../src/db/tx.js';
import { confirmValue, guardHumanFields, readProvenance, recordProvenance } from '../src/services/crmProvenance.js';
import { api, app, createCompany, registerUser, withAdmin, type TestUser } from './helpers.js';

let a: TestUser;
let b: TestUser;
let companyA: string;
let companyB: string;
let agentToken: string;
let session: ReturnType<typeof supertest.agent>;

beforeAll(async () => {
  a = await registerUser('proveniens-a');
  b = await registerUser('proveniens-b');
  companyA = await createCompany(a.token, 'Proveniens A');
  companyB = await createCompany(b.token, 'Proveniens B');
  const token = await api.post(`/api/companies/${companyA}/agent-tokens`)
    .set('Authorization', `Bearer ${a.token}`).send({ name: 'Proveniensagent' });
  expect(token.status, JSON.stringify(token.body)).toBe(201);
  agentToken = token.body.token;
  session = supertest.agent(app);
  const login = await session.post('/app/login').type('form')
    .send({ email: a.email, password: 'mycket-hemligt-losen-123' });
  expect(login.status, JSON.stringify(login.body)).toBe(302);
});

/** Direkta SQL-fixturer: aldrig beroende av tjänstens senare ursprungsskrivning. */
async function seedEvents(db: pg.Client, companyId: string) {
  const org = (await db.query<{ id: string }>(
    'INSERT INTO crm.organizations (company_id, name) VALUES ($1,$2) RETURNING id',
    [companyId, `Prov ${randomUUID()}`])).rows[0]!.id;
  const person = (await db.query<{ id: string }>(
    'INSERT INTO crm.people (company_id, organization_id, name) VALUES ($1,$2,$3) RETURNING id',
    [companyId, org, `Person ${randomUUID()}`])).rows[0]!.id;
  const interaction = (await db.query<{ id: string }>(
    `INSERT INTO crm.interactions (company_id, organization_id, occurred_at, channel, summary, source_system)
     VALUES ($1,$2,'2026-11-01T10:00:00Z','email','Ursprunglig sammanfattning','manual') RETURNING id`,
    [companyId, org])).rows[0]!.id;
  const commitment = (await db.query<{ id: string }>(
    `INSERT INTO crm.commitments (company_id, organization_id, direction, body, occurred_at, source_system)
     VALUES ($1,$2,'we_owe','Ursprungligt löfte','2026-11-01T10:00:00Z','manual') RETURNING id`,
    [companyId, org])).rows[0]!.id;
  return { org, person, interaction, commitment };
}

async function plantInteraction(db: pg.Client, companyId: string, id: string, field = 'summary') {
  await db.query(
    `INSERT INTO crm.field_provenance (company_id, interaction_id, field, source)
     VALUES ($1,$2,$3,'human')`, [companyId, id, field]);
}
async function plantCommitment(db: pg.Client, companyId: string, id: string, field = 'body') {
  await db.query(
    `INSERT INTO crm.field_provenance (company_id, commitment_id, field, source)
     VALUES ($1,$2,$3,'human')`, [companyId, id, field]);
}

interface CatalogRow { id: string; definition: unknown }
type Catalog = Record<string, CatalogRow[]>;
/** Åtta slutna kataloglistor. Facit för tillåtna ändringar står i M7. */
async function catalog(db: pg.Client): Promise<Catalog> {
  const queries: Record<string, string> = {
    constraints: `SELECT c.conname AS id, jsonb_build_object('table', t.relname,
      'definition', pg_get_constraintdef(c.oid)) AS definition FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = 'crm' ORDER BY 1`,
    indexes: `SELECT indexname AS id, jsonb_build_object('table', tablename, 'definition', indexdef) AS definition
      FROM pg_indexes WHERE schemaname = 'crm' ORDER BY 1`,
    columns: `SELECT table_name || '.' || column_name AS id,
      jsonb_build_object('type', data_type, 'nullable', is_nullable) AS definition
      FROM information_schema.columns WHERE table_schema = 'crm' ORDER BY 1`,
    triggers: `SELECT t.relname || '.' || g.tgname AS id, pg_get_triggerdef(g.oid) AS definition
      FROM pg_trigger g JOIN pg_class t ON t.oid = g.tgrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace WHERE n.nspname = 'crm' AND NOT g.tgisinternal ORDER BY 1`,
    policies: `SELECT tablename || '.' || policyname AS id,
      jsonb_build_object('command', cmd, 'qual', qual, 'check', with_check) AS definition
      FROM pg_policies WHERE schemaname = 'crm' ORDER BY 1`,
    functions: `SELECT n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' AS id,
      md5(p.prosrc) AS definition FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname IN ('crm','public') ORDER BY 1`,
    privileges: `SELECT c.relname AS id, c.relacl::text AS definition FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'crm' AND c.relkind IN ('r','p','v','S') ORDER BY 1`,
    schemas: 'SELECT nspname AS id, nspname AS definition FROM pg_namespace ORDER BY 1',
  };
  const out: Catalog = {};
  for (const [name, sql] of Object.entries(queries)) out[name] = (await db.query<CatalogRow>(sql)).rows;
  return out;
}
function catalogDiff(before: Catalog, after: Catalog) {
  return Object.fromEntries(Object.keys(before).map((name) => {
    const old = new Map(before[name]!.map((r) => [r.id, r.definition]));
    const now = new Map(after[name]!.map((r) => [r.id, r.definition]));
    return [name, {
      added: [...now.keys()].filter((id) => !old.has(id)).sort(),
      removed: [...old.keys()].filter((id) => !now.has(id)).sort(),
      changed: [...now.keys()].filter((id) => old.has(id) &&
        JSON.stringify(old.get(id)) !== JSON.stringify(now.get(id))).sort(),
    }];
  }));
}

async function newMigration(): Promise<MigrationFile> {
  const matches = (await loadMigrations()).filter((m) => m.name === 'crm_event_provenance');
  expect(matches, 'exakt en migration crm_event_provenance ska finnas').toHaveLength(1);
  return matches[0]!;
}

describe('Migrationen och isoleringen i den migrerade databasen', () => {
  it('M1 händelsemålen är nullbara uuid-kolumner', async () => {
    const r = await withAdmin((db) => db.query(
      `SELECT column_name, data_type, is_nullable FROM information_schema.columns
       WHERE table_schema = 'crm' AND table_name = 'field_provenance'
         AND column_name IN ('interaction_id','commitment_id') ORDER BY column_name`));
    expect(r.rows).toEqual([
      { column_name: 'commitment_id', data_type: 'uuid', is_nullable: 'YES' },
      { column_name: 'interaction_id', data_type: 'uuid', is_nullable: 'YES' },
    ]);
  });

  it('M2 sammansatta främmande nycklar har kaskad och unika målnycklar', async () => {
    const r = await withAdmin((db) => db.query(
      `SELECT conname, contype, confdeltype, cardinality(conkey) AS columns,
              pg_get_constraintdef(oid) AS definition FROM pg_constraint
       WHERE connamespace = 'crm'::regnamespace AND conname = ANY($1::text[]) ORDER BY conname`,
      [['interactions_id_company_uk', 'commitments_id_company_uk',
        'field_provenance_interaction_fk', 'field_provenance_commitment_fk']]));
    expect(r.rows).toHaveLength(4);
    expect(r.rows).toEqual([
      { conname: 'commitments_id_company_uk', contype: 'u', confdeltype: ' ', columns: 2,
        definition: 'UNIQUE (id, company_id)' },
      { conname: 'field_provenance_commitment_fk', contype: 'f', confdeltype: 'c', columns: 2,
        definition: 'FOREIGN KEY (commitment_id, company_id) REFERENCES crm.commitments(id, company_id) ON DELETE CASCADE' },
      { conname: 'field_provenance_interaction_fk', contype: 'f', confdeltype: 'c', columns: 2,
        definition: 'FOREIGN KEY (interaction_id, company_id) REFERENCES crm.interactions(id, company_id) ON DELETE CASCADE' },
      { conname: 'interactions_id_company_uk', contype: 'u', confdeltype: ' ', columns: 2,
        definition: 'UNIQUE (id, company_id)' },
    ]);
  });

  it('M3 exakt ett av fyra mål krävs', async () => {
    const definition = await withAdmin(async (db) => (await db.query<{ d: string }>(
      `SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint
       WHERE conrelid = 'crm.field_provenance'::regclass AND conname = 'field_provenance_target_ck'`)).rows[0]!.d);
    expect(definition).toContain('num_nonnulls(organization_id, person_id, interaction_id, commitment_id) = 1');
    const f = await withAdmin((db) => seedEvents(db, companyA));
    await expect(withAdmin((db) => db.query(
      `INSERT INTO crm.field_provenance (company_id, organization_id, interaction_id, field, source)
       VALUES ($1,$2,$3,'summary','human')`, [companyA, f.org, f.interaction]))).rejects.toMatchObject({ code: '23514' });
    await expect(withAdmin((db) => db.query(
      "INSERT INTO crm.field_provenance (company_id, field, source) VALUES ($1,'summary','human')",
      [companyA]))).rejects.toMatchObject({ code: '23514' });
  });

  it('M4 de partiella unika indexen har rätt nyckel och predikat', async () => {
    const r = await withAdmin((db) => db.query<{ indexname: string; indexdef: string }>(
      `SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'crm'
       AND indexname IN ('field_provenance_interaction_uk','field_provenance_commitment_uk') ORDER BY indexname`));
    expect(r.rows).toEqual([
      { indexname: 'field_provenance_commitment_uk', indexdef: 'CREATE UNIQUE INDEX field_provenance_commitment_uk ON crm.field_provenance USING btree (company_id, commitment_id, field) WHERE (commitment_id IS NOT NULL)' },
      { indexname: 'field_provenance_interaction_uk', indexdef: 'CREATE UNIQUE INDEX field_provenance_interaction_uk ON crm.field_provenance USING btree (company_id, interaction_id, field) WHERE (interaction_id IS NOT NULL)' },
    ]);
  });

  it('K1 händelsernas ursprung dör genom kaskad och organisationens står kvar', async () => {
    await withAdmin(async (db) => {
      const f = await seedEvents(db, companyA);
      await plantInteraction(db, companyA, f.interaction);
      await plantInteraction(db, companyA, f.interaction, 'channel');
      await plantCommitment(db, companyA, f.commitment);
      await plantCommitment(db, companyA, f.commitment, 'direction');
      await db.query(`INSERT INTO crm.field_provenance (company_id, organization_id, field, source)
        VALUES ($1,$2,'name','human')`, [companyA, f.org]);
      expect((await db.query(`SELECT id FROM crm.field_provenance WHERE company_id = $1
        AND (interaction_id = $2 OR commitment_id = $3)`, [companyA, f.interaction, f.commitment])).rows).toHaveLength(4);
      await db.query('DELETE FROM crm.interactions WHERE company_id = $1 AND id = $2', [companyA, f.interaction]);
      await db.query('DELETE FROM crm.commitments WHERE company_id = $1 AND id = $2', [companyA, f.commitment]);
      expect((await db.query(`SELECT id FROM crm.field_provenance WHERE company_id = $1
        AND (interaction_id = $2 OR commitment_id = $3)`, [companyA, f.interaction, f.commitment])).rows).toEqual([]);
      expect((await db.query('SELECT field FROM crm.field_provenance WHERE company_id = $1 AND organization_id = $2',
        [companyA, f.org])).rows).toEqual([{ field: 'name' }]);
    });
  });

  it('K2 sammansatta FK avvisar ett annat bolags kontaktpunkt och löfte', async () => {
    const f = await withAdmin((db) => seedEvents(db, companyB));
    await expect(withAdmin((db) => plantInteraction(db, companyA, f.interaction))).rejects.toMatchObject({ code: '23503' });
    await expect(withAdmin((db) => plantCommitment(db, companyA, f.commitment))).rejects.toMatchObject({ code: '23503' });
  });

  it('K3 rollen app i bolag B kan varken läsa, skriva eller radera A:s ursprung', async () => {
    const f = await withAdmin((db) => seedEvents(db, companyA));
    await withAdmin((db) => plantInteraction(db, companyA, f.interaction));
    const before = await withAdmin(async (db) => (await db.query(
      'SELECT * FROM crm.field_provenance WHERE company_id = $1 AND interaction_id = $2', [companyA, f.interaction])).rows);
    await withTenantTransaction(b.userId, companyB, async (db) => {
      expect((await db.query('SELECT current_user AS role')).rows).toEqual([{ role: 'app' }]);
      expect((await db.query('SELECT * FROM crm.field_provenance WHERE interaction_id = $1', [f.interaction])).rows).toEqual([]);
      expect((await db.query("UPDATE crm.field_provenance SET source = 'ai' WHERE interaction_id = $1", [f.interaction])).rowCount).toBe(0);
      expect((await db.query('DELETE FROM crm.field_provenance WHERE interaction_id = $1', [f.interaction])).rowCount).toBe(0);
    });
    await expect(withTenantTransaction(b.userId, companyB, (db) => db.query(
      `INSERT INTO crm.field_provenance (company_id, interaction_id, field, source)
       VALUES ($1,$2,'channel','ai')`, [companyA, f.interaction]))).rejects.toMatchObject({ code: '42501' });
    await expect(withTenantTransaction(b.userId, companyB, (db) => db.query(
      `INSERT INTO crm.field_provenance (company_id, interaction_id, field, source)
       VALUES ($1,$2,'channel','ai')`, [companyB, f.interaction]))).rejects.toMatchObject({ code: '23503' });
    expect(await withAdmin(async (db) => (await db.query(
      'SELECT * FROM crm.field_provenance WHERE company_id = $1 AND interaction_id = $2', [companyA, f.interaction])).rows)).toEqual(before);
  });
});

describe('Migrationen på befintliga rader i en egen databas', () => {
  const database = 'redovisning_test_event_provenance';
  let db: pg.Client | undefined;
  let migration: MigrationFile;
  let beforeCatalog: Catalog;
  let afterCatalog: Catalog;
  let beforeData: Record<string, unknown>;
  let ownCompany: string;
  async function maintenance(sql: string) {
    const c = new pg.Client({ connectionString: process.env.MAINTENANCE_DATABASE_URL });
    await c.connect();
    try { await c.query(sql); } finally { await c.end(); }
  }
  async function data() {
    const provenance = (await db!.query(`SELECT id, company_id, organization_id, person_id, field, source,
      confidence, reason, source_system, source_ref, recorded_by, recorded_at
      FROM crm.field_provenance WHERE company_id = $1 ORDER BY id`, [ownCompany])).rows;
    const interactions = (await db!.query('SELECT * FROM crm.interactions WHERE company_id = $1 ORDER BY id', [ownCompany])).rows;
    const commitments = (await db!.query('SELECT * FROM crm.commitments WHERE company_id = $1 ORDER BY id', [ownCompany])).rows;
    return { provenance, interactions, commitments };
  }
  async function apply(sql: string) {
    await db!.query('BEGIN');
    try { await db!.query(sql); await db!.query('COMMIT'); }
    catch (err) { await db!.query('ROLLBACK'); throw err; }
  }
  async function objectIds() {
    return (await db!.query(`SELECT conname AS name, oid::text AS oid FROM pg_constraint
      WHERE connamespace = 'crm'::regnamespace AND conname IN ('interactions_id_company_uk',
        'commitments_id_company_uk','field_provenance_interaction_fk','field_provenance_commitment_fk','field_provenance_target_ck')
      UNION ALL SELECT relname AS name, oid::text AS oid FROM pg_class WHERE relnamespace = 'crm'::regnamespace
        AND relname IN ('field_provenance_interaction_uk','field_provenance_commitment_uk') ORDER BY name`)).rows;
  }
  beforeAll(async () => {
    migration = await newMigration();
    await maintenance(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
    await maintenance(`CREATE DATABASE ${database}`);
    const url = new URL(process.env.DATABASE_ADMIN_URL!);
    url.pathname = `/${database}`;
    db = new pg.Client({ connectionString: url.toString() });
    await db.connect();
    for (const m of (await loadMigrations()).filter((m) => m.version < migration.version)) await apply(m.sql);
    ownCompany = (await db.query<{ id: string }>("INSERT INTO companies (name) VALUES ('Migrationens bolag') RETURNING id")).rows[0]!.id;
    const f = await seedEvents(db, ownCompany);
    await db.query(`INSERT INTO crm.field_provenance (company_id, organization_id, person_id, field, source, source_system, source_ref)
      VALUES ($1,$2,NULL,'name','human',NULL,NULL), ($1,$2,NULL,'website','sync','gmail','gmail:m5'),
             ($1,NULL,$3,'name','ai',NULL,NULL), ($1,NULL,$3,'email','sync','gmail','gmail:m5')`,
    [ownCompany, f.org, f.person]);
    beforeData = await data();
    beforeCatalog = await catalog(db);
    await apply(migration.sql);
    afterCatalog = await catalog(db);
  });
  afterAll(async () => {
    if (db) await db.end();
    await maintenance(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
  });

  it('M5 ingen bakåtfyllnad och alla befintliga värden står kvar', async () => {
    expect(beforeData.provenance).toHaveLength(4);
    expect(await data()).toEqual(beforeData);
    expect((await db!.query(`SELECT id FROM crm.field_provenance
      WHERE interaction_id IS NOT NULL OR commitment_id IS NOT NULL`)).rows).toEqual([]);
  });

  it('M6 en andra körning behåller sju objekts oid och samma fyra rader', async () => {
    const before = await objectIds();
    expect(before.map((r) => r.name)).toEqual([
      'commitments_id_company_uk', 'field_provenance_commitment_fk', 'field_provenance_commitment_uk',
      'field_provenance_interaction_fk', 'field_provenance_interaction_uk', 'field_provenance_target_ck', 'interactions_id_company_uk',
    ]);
    await apply(migration.sql);
    expect(await objectIds()).toEqual(before);
    expect(await catalog(db!)).toEqual(afterCatalog);
    expect(await data()).toEqual(beforeData);
    expect((await data()).provenance).toHaveLength(4);
  });

  it('M7 katalogens skillnad är exakt tillåtelselistan och upptäcker en extra trigger', async () => {
    expect((await newMigration()).filename).toMatch(/_crm_event_provenance\.sql$/);
    const unchanged = { added: [], removed: [], changed: [] };
    const expected = {
      constraints: { added: ['commitments_id_company_uk', 'field_provenance_commitment_fk',
        'field_provenance_interaction_fk', 'interactions_id_company_uk'], removed: [], changed: ['field_provenance_target_ck'] },
      indexes: { added: ['commitments_id_company_uk', 'field_provenance_commitment_uk',
        'field_provenance_interaction_uk', 'interactions_id_company_uk'], removed: [], changed: [] },
      columns: { added: ['field_provenance.commitment_id', 'field_provenance.interaction_id'], removed: [], changed: [] },
      triggers: unchanged, policies: unchanged, functions: unchanged, privileges: unchanged, schemas: unchanged,
    };
    expect(catalogDiff(beforeCatalog, afterCatalog)).toEqual(expected);
    expect(afterCatalog.columns!.filter((r) => ['field_provenance.commitment_id', 'field_provenance.interaction_id'].includes(r.id)))
      .toEqual([
        { id: 'field_provenance.commitment_id', definition: { type: 'uuid', nullable: 'YES' } },
        { id: 'field_provenance.interaction_id', definition: { type: 'uuid', nullable: 'YES' } },
      ]);
    expect(afterCatalog.constraints!.find((r) => r.id === 'field_provenance_target_ck')!.definition).toEqual({
      table: 'field_provenance', definition: 'CHECK ((num_nonnulls(organization_id, person_id, interaction_id, commitment_id) = 1))',
    });
    const corrupted = { ...afterCatalog, triggers: [...afterCatalog.triggers!, { id: 'interactions.extra', definition: 'extra trigger' }] };
    expect(catalogDiff(beforeCatalog, corrupted)).not.toEqual(expected);
    expect(catalogDiff(afterCatalog, corrupted).triggers).toEqual({ added: ['interactions.extra'], removed: [], changed: [] });
  });
});

describe('Fyra mål i ursprungsmodulen', () => {
  it('P1 kontaktpunktens ursprung har eget mål och rätt källa', async () => {
    const f = await withAdmin((db) => seedEvents(db, companyA));
    await withTenantTransaction(a.userId, companyA, async (db) => {
      await recordProvenance(db, companyA, a.userId, { interaction_id: f.interaction }, [
        { field: 'summary', source: 'ai' },
        { field: 'channel', source: 'sync', source_system: 'gmail', source_ref: 'gmail:p1' },
      ]);
      const read = await readProvenance(db, companyA, { interaction_id: f.interaction });
      expect([...read.keys()].sort()).toEqual(['channel', 'summary']);
      expect(read.get('summary')!.source).toBe('ai');
      expect(read.get('channel')).toMatchObject({ source: 'sync', source_system: 'gmail', source_ref: 'gmail:p1' });
      expect((await db.query(`SELECT organization_id, person_id, interaction_id, commitment_id
        FROM crm.field_provenance WHERE company_id = $1 AND interaction_id = $2`, [companyA, f.interaction])).rows).toEqual([
        { organization_id: null, person_id: null, interaction_id: f.interaction, commitment_id: null },
        { organization_id: null, person_id: null, interaction_id: f.interaction, commitment_id: null },
      ]);
    });
  });

  it('P2 löftets ursprung har eget mål och rätt källa', async () => {
    const f = await withAdmin((db) => seedEvents(db, companyA));
    await withTenantTransaction(a.userId, companyA, async (db) => {
      await recordProvenance(db, companyA, a.userId, { commitment_id: f.commitment }, [
        { field: 'body', source: 'ai' },
        { field: 'due_date', source: 'sync', source_system: 'gmail', source_ref: 'gmail:p2' },
      ]);
      const read = await readProvenance(db, companyA, { commitment_id: f.commitment });
      expect([...read.keys()].sort()).toEqual(['body', 'due_date']);
      expect(read.get('body')!.source).toBe('ai');
      expect(read.get('due_date')).toMatchObject({ source: 'sync', source_system: 'gmail', source_ref: 'gmail:p2' });
      expect((await db.query(`SELECT organization_id, person_id, interaction_id, commitment_id
        FROM crm.field_provenance WHERE company_id = $1 AND commitment_id = $2`, [companyA, f.commitment])).rows).toEqual([
        { organization_id: null, person_id: null, interaction_id: null, commitment_id: f.commitment },
        { organization_id: null, person_id: null, interaction_id: null, commitment_id: f.commitment },
      ]);
    });
  });

  it('P3 samma fält skrivs om utan dubblett', async () => {
    const f = await withAdmin((db) => seedEvents(db, companyA));
    await withTenantTransaction(a.userId, companyA, async (db) => {
      await recordProvenance(db, companyA, a.userId, { interaction_id: f.interaction }, [{ field: 'summary', source: 'ai' }]);
      await recordProvenance(db, companyA, a.userId, { interaction_id: f.interaction }, [{ field: 'summary', source: 'human' }]);
      expect((await db.query('SELECT field, source FROM crm.field_provenance WHERE company_id = $1 AND interaction_id = $2',
        [companyA, f.interaction])).rows).toEqual([{ field: 'summary', source: 'human' }]);
    });
  });

  it('P4 vakten skyddar bara sitt löftes människofält och tillåter människan', async () => {
    const f = await withAdmin((db) => seedEvents(db, companyA));
    const other = await withAdmin((db) => seedEvents(db, companyA));
    await withAdmin(async (db) => {
      await plantCommitment(db, companyA, f.commitment);
      await plantCommitment(db, companyA, other.commitment, 'direction');
    });
    await withTenantTransaction(a.userId, companyA, async (db) => {
      expect(await guardHumanFields(db, companyA, { commitment_id: f.commitment }, 'sync',
        { body: 'Ny text', direction: 'they_owe' })).toEqual({ input: { direction: 'they_owe' }, blocked: ['body'] });
      expect(await guardHumanFields(db, companyA, { commitment_id: f.commitment }, 'human',
        { body: 'Ny text', direction: 'they_owe' })).toEqual({ input: { body: 'Ny text', direction: 'they_owe' }, blocked: [] });
    });
  });

  it('P5 bekräftelse skriver människoursprung utan att ändra riktningen', async () => {
    const f = await withAdmin((db) => seedEvents(db, companyA));
    await withTenantTransaction(a.userId, companyA, async (db) => {
      await confirmValue(db, companyA, a.userId, { commitment_id: f.commitment }, 'direction');
      const read = await readProvenance(db, companyA, { commitment_id: f.commitment });
      expect([...read.keys()]).toEqual(['direction']);
      expect(read.get('direction')).toMatchObject({ source: 'human', reason: 'bekräftad av människa' });
      expect((await db.query('SELECT direction FROM crm.commitments WHERE company_id = $1 AND id = $2',
        [companyA, f.commitment])).rows).toEqual([{ direction: 'we_owe' }]);
    });
  });

  it('P6 läsningen isolerar alla fyra mål även mellan händelser i samma organisation', async () => {
    const f = await withAdmin((db) => seedEvents(db, companyA));
    const x2 = await withAdmin(async (db) => (await db.query<{ id: string }>(
      `INSERT INTO crm.interactions (company_id, organization_id, occurred_at, channel, summary, source_system)
       VALUES ($1,$2,'2026-11-01T10:00:00Z','email','Andra kontakten','manual') RETURNING id`, [companyA, f.org])).rows[0]!.id);
    await withTenantTransaction(a.userId, companyA, async (db) => {
      await recordProvenance(db, companyA, a.userId, { interaction_id: f.interaction }, [{ field: 'summary', source: 'ai' }]);
      await recordProvenance(db, companyA, a.userId, { interaction_id: x2 }, [{ field: 'summary', source: 'human' }]);
      await recordProvenance(db, companyA, a.userId, { commitment_id: f.commitment }, [{ field: 'body', source: 'sync' }]);
      await recordProvenance(db, companyA, a.userId, { organization_id: f.org }, [{ field: 'name', source: 'human' }]);
      await recordProvenance(db, companyA, a.userId, { person_id: f.person }, [{ field: 'email', source: 'ai' }]);
      const x = await readProvenance(db, companyA, { interaction_id: f.interaction });
      expect([...x.keys()]).toEqual(['summary']);
      expect(x.get('summary')!.source).toBe('ai');
      expect([...(await readProvenance(db, companyA, { commitment_id: f.commitment })).keys()]).toEqual(['body']);
      expect([...(await readProvenance(db, companyA, { organization_id: f.org })).keys()]).toEqual(['name']);
      expect([...(await readProvenance(db, companyA, { person_id: f.person })).keys()]).toEqual(['email']);
    });
  });
});

const NAR = '2026-11-01T10:00:00.000Z';
const NY_TID = '2026-11-02T11:00:00.000Z';
const action = (name: string, input: Record<string, unknown>, token = a.token) =>
  api.post(`/api/companies/${companyA}/actions/${name}`).set('Authorization', `Bearer ${token}`).send(input);
async function act(name: string, input: Record<string, unknown>, token = a.token) {
  const r = await action(name, input, token);
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body.result;
}
async function ingest(event: Record<string, unknown>) {
  const r = await act('ingest_crm_events', { events: [event] });
  expect(r.skipped).toEqual([]);
  return r;
}
const interactionEvent = (sourceRef: string, name: string) => ({
  kind: 'interaction', organization: { name }, occurred_at: NAR, source_system: 'gmail',
  source_ref: sourceRef, channel: 'email', direction: 'inbound', summary: 'Ursprunglig sammanfattning',
});
const commitmentEvent = (sourceRef: string, name: string) => ({
  kind: 'commitment', organization: { name }, occurred_at: NAR, source_system: 'linear',
  source_ref: sourceRef, commitment_direction: 'we_owe', body: 'Ursprungligt löfte', due_date: '2026-12-01',
});
async function interactionRow(ref: string) {
  return withAdmin(async (db) => (await db.query(
    `SELECT id, summary, channel, direction, occurred_at FROM crm.interactions
     WHERE company_id = $1 AND source_ref = $2`, [companyA, ref])).rows[0]!);
}
async function commitmentRow(ref: string) {
  return withAdmin(async (db) => (await db.query(
    `SELECT id, body, direction, due_date::text, status, occurred_at, sfar FROM crm.commitments
     WHERE company_id = $1 AND source_ref = $2`, [companyA, ref])).rows[0]!);
}
async function interactionProvenance(id: string) {
  return withAdmin(async (db) => (await db.query(
    `SELECT field, source, source_system, source_ref, reason FROM crm.field_provenance
     WHERE company_id = $1 AND interaction_id = $2 ORDER BY field`, [companyA, id])).rows);
}
async function commitmentProvenance(id: string) {
  return withAdmin(async (db) => (await db.query(
    `SELECT field, source, source_system, source_ref, reason FROM crm.field_provenance
     WHERE company_id = $1 AND commitment_id = $2 ORDER BY field`, [companyA, id])).rows);
}
async function humanInteraction(id: string, field: string) {
  await withTenantTransaction(a.userId, companyA, (db) => recordProvenance(db, companyA, a.userId,
    { interaction_id: id }, [{ field, source: 'human' }]));
}
async function humanCommitment(id: string, field: string) {
  await withTenantTransaction(a.userId, companyA, (db) => recordProvenance(db, companyA, a.userId,
    { commitment_id: id }, [{ field, source: 'human' }]));
}
async function auditDetails(name: string, id: string) {
  return withAdmin(async (db) => (await db.query(
    `SELECT details FROM crm.audit_log WHERE company_id = $1 AND action = $2 AND entity_id = $3
     ORDER BY id DESC LIMIT 1`, [companyA, name, id])).rows[0]!.details);
}

/** Samma ändring av fyra fält, med ett eget bokstavligt facit för varje fält. */
async function protectedCommitment(field: string, ref: string, name: string, expected: Record<string, unknown>) {
  const event = commitmentEvent(ref, name);
  await ingest(event);
  const row = await commitmentRow(ref);
  await humanCommitment(row.id, field);
  const replay = await ingest({ ...event, body: 'Ny text', commitment_direction: 'they_owe',
    due_date: '2026-12-02', occurred_at: NY_TID });
  expect(replay.commitments_unchanged).toBe(1);
  expect(replay.kept_human_fields.filter((s: string) => s.includes(`: ${ref} `))).toEqual([`${name}: ${ref} ${field}`]);
  const after = await commitmentRow(ref);
  expect({ body: after.body, direction: after.direction, due_date: after.due_date,
    occurred_at: after.occurred_at.toISOString() }).toEqual(expected);
  const provenance = await commitmentProvenance(row.id);
  expect(provenance.map((r) => [r.field, r.source])).toEqual([
    ['body', field === 'body' ? 'human' : 'sync'],
    ['direction', field === 'direction' ? 'human' : 'sync'],
    ['due_date', field === 'due_date' ? 'human' : 'sync'],
    ['occurred_at', field === 'occurred_at' ? 'human' : 'sync'],
  ]);
}

describe('Händelsernas skrivvägar, intagets poster och sfärens tillfällen', () => {
  it('H1 intagets kontaktpunkt har fyra sync-rader med källa och skäl', async () => {
    await ingest(interactionEvent('gmail:h1', 'H1 Bolaget AB'));
    const row = await interactionRow('gmail:h1');
    expect(await interactionProvenance(row.id)).toEqual(['channel', 'direction', 'occurred_at', 'summary'].map((field) => ({
      field, source: 'sync', source_system: 'gmail', source_ref: 'gmail:h1', reason: 'hämtad från gmail',
    })));
  });

  it('H2 intagets löfte med förfallodatum har fyra sync-rader utan status och sfär', async () => {
    await ingest(commitmentEvent('linear:LOC-H2', 'H2 Bolaget AB'));
    const row = await commitmentRow('linear:LOC-H2');
    expect(await commitmentProvenance(row.id)).toEqual(['body', 'direction', 'due_date', 'occurred_at'].map((field) => ({
      field, source: 'sync', source_system: 'linear', source_ref: 'linear:LOC-H2', reason: 'hämtad från linear',
    })));
  });

  it('H3 ett löfte utan förfallodatum får inget påhittat ursprung för due_date', async () => {
    const { due_date: _due, ...event } = commitmentEvent('linear:LOC-H3', 'H3 Bolaget AB');
    await ingest(event);
    const row = await commitmentRow('linear:LOC-H3');
    expect(row.due_date).toBeNull();
    expect(await commitmentProvenance(row.id)).toEqual(['body', 'direction', 'occurred_at'].map((field) => ({
      field, source: 'sync', source_system: 'linear', source_ref: 'linear:LOC-H3', reason: 'hämtad från linear',
    })));
  });

  it('H4 människans sammanfattning står medan tre fält följer omsändningen', async () => {
    const event = interactionEvent('gmail:x', 'H4 Bolaget AB');
    await ingest(event);
    const row = await interactionRow('gmail:x');
    await humanInteraction(row.id, 'summary');
    const replay = await ingest({ ...event, summary: 'Ny sammanfattning', channel: 'meeting', direction: 'outbound', occurred_at: NY_TID });
    expect(replay.interactions_unchanged).toBe(1);
    expect(replay.kept_human_fields.filter((s: string) => s.includes(': gmail:x '))).toEqual(['H4 Bolaget AB: gmail:x summary']);
    const after = await interactionRow('gmail:x');
    expect({ summary: after.summary, channel: after.channel, direction: after.direction, occurred_at: after.occurred_at.toISOString() })
      .toEqual({ summary: 'Ursprunglig sammanfattning', channel: 'meeting', direction: 'outbound', occurred_at: NY_TID });
    expect((await interactionProvenance(row.id)).map((r) => [r.field, r.source])).toEqual([
      ['channel', 'sync'], ['direction', 'sync'], ['occurred_at', 'sync'], ['summary', 'human'],
    ]);
    expect((await auditDetails('crm.interaction_updated', row.id)).kept_human_fields).toEqual(['summary']);
  });

  it('H5 människans löftestext skyddas ensam', async () => {
    await protectedCommitment('body', 'linear:LOC-1', 'Löftesbolaget AB', {
      body: 'Ursprungligt löfte', direction: 'they_owe', due_date: '2026-12-02', occurred_at: NY_TID,
    });
  });
  it('H6 människans löftesriktning skyddas ensam', async () => {
    await protectedCommitment('direction', 'linear:LOC-2', 'H6 Bolaget AB', {
      body: 'Ny text', direction: 'we_owe', due_date: '2026-12-02', occurred_at: NY_TID,
    });
  });
  it('H7 människans förfallodatum skyddas ensamt', async () => {
    await protectedCommitment('due_date', 'linear:LOC-3', 'H7 Bolaget AB', {
      body: 'Ny text', direction: 'they_owe', due_date: '2026-12-01', occurred_at: NY_TID,
    });
  });
  it('H8 människans löftestid skyddas ensam', async () => {
    await protectedCommitment('occurred_at', 'linear:LOC-4', 'H8 Bolaget AB', {
      body: 'Ny text', direction: 'they_owe', due_date: '2026-12-02', occurred_at: NAR,
    });
  });

  it('H9 vyns Klar-POST skriver statusens ursprung human', async () => {
    await ingest(commitmentEvent('linear:LOC-H9', 'H9 Bolaget AB'));
    const row = await commitmentRow('linear:LOC-H9');
    const res = await session.post(`/app/c/${companyA}/commitments/${row.id}/done`).type('form').send({});
    expect(res.status, JSON.stringify(res.body)).toBe(302);
    expect((await commitmentRow('linear:LOC-H9')).status).toBe('done');
    expect((await commitmentProvenance(row.id)).find((p) => p.field === 'status')!.source).toBe('human');
  });

  it('H10 agentens status är ai och kan inte öppna människans avslutade löfte', async () => {
    await ingest(commitmentEvent('linear:LOC-H10a', 'H10a Bolaget AB'));
    await ingest(commitmentEvent('linear:LOC-H10b', 'H10b Bolaget AB'));
    const first = await commitmentRow('linear:LOC-H10a');
    const second = await commitmentRow('linear:LOC-H10b');
    const agent = await act('set_crm_commitment_status', { commitment_id: first.id, status: 'done' }, agentToken);
    expect(agent.kept_human_fields).toEqual([]);
    expect((await commitmentProvenance(first.id)).find((p) => p.field === 'status')!.source).toBe('ai');
    await act('set_crm_commitment_status', { commitment_id: second.id, status: 'done' });
    const before = await withAdmin(async (db) => (await db.query('SELECT completed_at FROM crm.commitments WHERE id = $1', [second.id])).rows);
    const replay = await act('set_crm_commitment_status', { commitment_id: second.id, status: 'open' }, agentToken);
    expect(replay.kept_human_fields).toEqual(['status']);
    expect((await commitmentRow('linear:LOC-H10b')).status).toBe('done');
    expect((await commitmentProvenance(second.id)).find((p) => p.field === 'status')!.source).toBe('human');
    expect(await withAdmin(async (db) => (await db.query('SELECT completed_at FROM crm.commitments WHERE id = $1', [second.id])).rows)).toEqual(before);
    expect(await auditDetails('crm.commitment_status_set', second.id)).toEqual({ status: 'open', kept_human_fields: ['status'] });
  });

  it('H11 record_crm_interaction skriver aktörens ursprung på alla fyra fält', async () => {
    const f = await withAdmin((db) => seedEvents(db, companyA));
    for (const [token, source] of [[a.token, 'human'], [agentToken, 'ai']]) {
      const r = await act('record_crm_interaction', { organization_id: f.org, occurred_at: NAR,
        channel: 'call', summary: 'Samtal', source_system: 'manual' }, token);
      expect(r.kept_human_fields).toEqual([]);
      expect((await interactionProvenance(r.id)).map((p) => [p.field, p.source])).toEqual([
        ['channel', source], ['direction', source], ['occurred_at', source], ['summary', source],
      ]);
    }
  });

  it('H12 record_crm_commitment skriver aktörens ursprung på de fyra skrivna fälten', async () => {
    const f = await withAdmin((db) => seedEvents(db, companyA));
    for (const [token, source] of [[a.token, 'human'], [agentToken, 'ai']]) {
      const r = await act('record_crm_commitment', { organization_id: f.org, occurred_at: NAR,
        direction: 'we_owe', body: 'Ring på måndag', due_date: '2026-12-01', source_system: 'manual' }, token);
      expect(r.kept_human_fields).toEqual([]);
      expect((await commitmentProvenance(r.id)).map((p) => [p.field, p.source])).toEqual([
        ['body', source], ['direction', source], ['due_date', source], ['occurred_at', source],
      ]);
    }
  });

  it('H13 log_contact ger human respektive ai per fält och en ny kontakt varje gång', async () => {
    const f = await withAdmin((db) => seedEvents(db, companyA));
    const ids: string[] = [];
    for (const [token, source] of [[a.token, 'human'], [agentToken, 'ai']]) {
      const r = await act('log_contact', { organization_id: f.org }, token);
      expect(r.created).toBe(true);
      ids.push(r.id);
      expect((await interactionProvenance(r.id)).map((p) => [p.field, p.source])).toEqual([
        ['channel', source], ['direction', source], ['occurred_at', source], ['summary', source],
      ]);
    }
    expect(new Set(ids).size).toBe(2);
  });

  it('H14 agentens omsändning skyddar människans text och redovisar auditspåret', async () => {
    const f = await withAdmin((db) => seedEvents(db, companyA));
    const input = { organization_id: f.org, direction: 'we_owe', body: 'Människans löfte',
      occurred_at: NAR, source_system: 'gmail', source_ref: 'gmail:h14' };
    const first = await act('record_crm_commitment', input);
    await withTenantTransaction(a.userId, companyA, (db) => recordProvenance(db, companyA, a.userId,
      { commitment_id: first.id }, [{ field: 'direction', source: 'sync' }, { field: 'occurred_at', source: 'sync' }]));
    const replay = await act('record_crm_commitment', { ...input, body: 'Agentens text', direction: 'they_owe', occurred_at: NY_TID }, agentToken);
    expect(replay.kept_human_fields).toEqual(['body']);
    expect(replay).toMatchObject({ body: 'Människans löfte', direction: 'they_owe', occurred_at: NY_TID, created: false });
    expect((await commitmentProvenance(first.id)).map((p) => [p.field, p.source])).toEqual([
      ['body', 'human'], ['direction', 'ai'], ['occurred_at', 'ai'],
    ]);
    expect((await auditDetails('crm.commitment_updated', first.id)).kept_human_fields).toEqual(['body']);
  });

  it('H15 äldre värde utan ursprung är oskyddat och får sync när det skrivs', async () => {
    const event = interactionEvent('gmail:h15', 'H15 Bolaget AB');
    await ingest(event);
    const row = await interactionRow('gmail:h15');
    await withAdmin((db) => db.query('DELETE FROM crm.field_provenance WHERE company_id = $1 AND interaction_id = $2', [companyA, row.id]));
    expect(await interactionProvenance(row.id)).toEqual([]);
    const replay = await ingest({ ...event, summary: 'Ny sammanfattning' });
    expect((await interactionRow('gmail:h15')).summary).toBe('Ny sammanfattning');
    expect(replay.kept_human_fields.filter((s: string) => s.includes(': gmail:h15 '))).toEqual([]);
    expect((await interactionProvenance(row.id)).find((p) => p.field === 'summary')).toMatchObject({ source: 'sync', source_ref: 'gmail:h15' });
  });

  it('E1 händelsen utan organisation använder personens namn som prefix', async () => {
    const { organization: _org, ...event } = interactionEvent('gmail:e1', 'Används inte');
    const personEvent = { ...event, person: { name: 'Ensam Person', email: 'ensam@prov.example' } };
    await ingest(personEvent);
    const row = await interactionRow('gmail:e1');
    await humanInteraction(row.id, 'summary');
    const replay = await ingest({ ...personEvent, summary: 'Ny sammanfattning' });
    expect(replay.kept_human_fields.filter((s: string) => s.includes(': gmail:e1 '))).toEqual(['Ensam Person: gmail:e1 summary']);
    expect((await interactionRow('gmail:e1')).summary).toBe('Ursprunglig sammanfattning');
  });

  it('E2 samtidig människorättelse vinner genom radlåset före vakten', async () => {
    const event = commitmentEvent('linear:LOC-E2', 'E2 Bolaget AB');
    await ingest(event);
    const row = await commitmentRow('linear:LOC-E2');
    const t1 = new pg.Client({ connectionString: process.env.DATABASE_ADMIN_URL });
    await t1.connect();
    let pending: Promise<unknown> | undefined;
    try {
      await t1.query('BEGIN');
      const pid = (await t1.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid;
      await t1.query('SELECT id FROM crm.commitments WHERE company_id = $1 AND id = $2 FOR UPDATE', [companyA, row.id]);
      await t1.query(`UPDATE crm.field_provenance SET source = 'human'
        WHERE company_id = $1 AND commitment_id = $2 AND field = 'body'`, [companyA, row.id]);
      // .then startar supertest-anropet nu, så att det faktiskt når radlåset.
      const request = action('ingest_crm_events', { events: [{ ...event, body: 'Ny text' }] }).then((r) => r);
      pending = request;
      let blocked = false;
      for (let i = 0; i < 100; i++) {
        blocked = await withAdmin(async (db) => (await db.query<{ blocked: boolean }>(
          'SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE $1::int = ANY(pg_blocking_pids(pid))) AS blocked', [pid])).rows[0]!.blocked);
        if (blocked) break;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      await t1.query('COMMIT');
      const result = await request;
      expect(blocked, 'omsändningen måste ha väntat på T1').toBe(true);
      expect(result.status, JSON.stringify(result.body)).toBe(200);
      expect(result.body.result.skipped).toEqual([]);
      expect(result.body.result.kept_human_fields).toContain('E2 Bolaget AB: linear:LOC-E2 body');
      expect((await commitmentRow('linear:LOC-E2')).body).toBe('Ursprungligt löfte');
    } finally {
      await t1.query('ROLLBACK');
      await pending?.catch(() => undefined);
      await t1.end();
    }
  });

  it('S1 kontaktpunktens omsändning når sfärtriggerns kolumner i SET', async () => {
    await withAdmin((db) => db.query(`CREATE TABLE public.prov_s1_logg (rad uuid NOT NULL);
      GRANT INSERT ON public.prov_s1_logg TO app;
      CREATE FUNCTION public.prov_s1_logga() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN INSERT INTO public.prov_s1_logg (rad) VALUES (NEW.id); RETURN NEW; END $$;
      CREATE TRIGGER prov_s1 BEFORE UPDATE OF organization_id, person_id ON crm.interactions
      FOR EACH ROW EXECUTE FUNCTION public.prov_s1_logga()`));
    const event = interactionEvent('gmail:s1', 'S1 Bolaget AB');
    await ingest(event);
    const row = await interactionRow('gmail:s1');
    await ingest({ ...event, summary: 'Ny text' });
    const logs = () => withAdmin(async (db) => (await db.query('SELECT rad FROM public.prov_s1_logg WHERE rad = $1', [row.id])).rows);
    expect(await logs()).toEqual([{ rad: row.id }]);
    await withAdmin((db) => db.query("UPDATE crm.interactions SET summary = 'Bara summary' WHERE company_id = $1 AND id = $2", [companyA, row.id]));
    expect(await logs(), 'en sats utan målkolumner ska inte ge en loggrad').toEqual([{ rad: row.id }]);
  });

  it('S2 löftets omsändning når sfärtriggern och sfär är inget skyddat fält', async () => {
    await withAdmin((db) => db.query(`CREATE TABLE public.prov_s2_logg (rad uuid NOT NULL);
      GRANT INSERT ON public.prov_s2_logg TO app;
      CREATE FUNCTION public.prov_s2_logga() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN INSERT INTO public.prov_s2_logg (rad) VALUES (NEW.id); RETURN NEW; END $$;
      CREATE TRIGGER prov_s2 BEFORE UPDATE OF sfar, organization_id, person_id ON crm.commitments
      FOR EACH ROW EXECUTE FUNCTION public.prov_s2_logga()`));
    const event = commitmentEvent('linear:LOC-S2', 'S2 Bolaget AB');
    await ingest(event);
    const row = await commitmentRow('linear:LOC-S2');
    await humanCommitment(row.id, 'body');
    await ingest({ ...event, body: 'Ny text' });
    expect(await withAdmin(async (db) => (await db.query('SELECT rad FROM public.prov_s2_logg WHERE rad = $1', [row.id])).rows)).toEqual([{ rad: row.id }]);
    expect(await commitmentRow('linear:LOC-S2')).toMatchObject({ body: 'Ursprungligt löfte', sfar: 'foretag' });
    expect((await commitmentProvenance(row.id)).some((p) => p.field === 'sfar')).toBe(false);
  });
});

describe('Idempotensen, människospärren och dokumentens kontrakt', () => {
  it('I1 identisk batch ger idel unchanged och samma antal unika ursprungsrader', async () => {
    const batch = { events: [
      { ...interactionEvent('gmail:i1', 'I1 Bolaget AB'), person: { name: 'I1 Person', email: 'i1@prov.example' } },
      commitmentEvent('linear:LOC-I1', 'I1 Bolaget AB'),
    ] };
    const first = await act('ingest_crm_events', batch);
    expect(first.skipped).toEqual([]);
    expect(first).toMatchObject({ interactions_created: 1, commitments_created: 1, organizations_created: 1, people_created: 1 });
    const count = () => withAdmin(async (db) => (await db.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM crm.field_provenance WHERE company_id = $1', [companyA])).rows[0]!.n);
    const before = await count();
    const second = await act('ingest_crm_events', batch);
    expect(second).toMatchObject({ interactions_unchanged: 1, commitments_unchanged: 1,
      interactions_created: 0, commitments_created: 0, organizations_created: 0, people_created: 0,
      kept_human_fields: [], skipped: [] });
    expect(await count()).toBe(before);
    expect(await withAdmin(async (db) => (await db.query(
      `SELECT organization_id, person_id, interaction_id, commitment_id, field, count(*)::int AS n
       FROM crm.field_provenance WHERE company_id = $1
       GROUP BY organization_id, person_id, interaction_id, commitment_id, field HAVING count(*) > 1`, [companyA])).rows)).toEqual([]);
  });

  it('I2 agenten kan fortfarande inte bekräfta en organisations uppgift', async () => {
    const org = await act('upsert_crm_organization', { name: 'I2 Bolaget AB' });
    const before = await withTenantTransaction(a.userId, companyA, (db) => readProvenance(db, companyA, { organization_id: org.id }));
    const res = await action('confirm_crm_value', { organization_id: org.id, field: 'name' }, agentToken);
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(res.body.error).toBe('human_confirmation_required');
    expect(await withTenantTransaction(a.userId, companyA, (db) => readProvenance(db, companyA, { organization_id: org.id }))).toEqual(before);
    expect(before.get('name')!.source).toBe('human');
  });

  it('I3 intagskontraktet beskriver fälten och den exakta postformen', async () => {
    const doc = await readFile(new URL('../../docs/crm/API_KONTRAKT.md', import.meta.url), 'utf8');
    const heading = '## Människan vinner\n';
    expect(doc).toContain(heading);
    const section = doc.split(heading)[1]!.split('\n## ')[0]!;
    expect(section).toContain('<organisation>: <källnyckel> <fält>');
    expect(section).toContain('Löftesbolaget AB: linear:LOC-1 body');
    for (const field of ['occurred_at', 'channel', 'direction', 'summary', 'body', 'due_date', 'status']) {
      expect(section).toContain(`\`${field}\``);
    }
    expect(section).toContain('personens namn');
  });

  it('I4 åtgärdsdokumentet har ett eget avsnitt med alla fyra skrivvägar och blockerade fält', async () => {
    const doc = await readFile(new URL('../../docs/MCP_ACTIONS.md', import.meta.url), 'utf8');
    const heading = '## Händelsernas ursprung (crm 1.1)\n';
    expect(doc.split(heading)).toHaveLength(2);
    expect(doc.indexOf(heading)).toBeGreaterThan(doc.indexOf('## Uppdragsytan'));
    const section = doc.split(heading)[1]!.split('\n## ')[0]!;
    for (const name of ['record_crm_interaction', 'record_crm_commitment', 'log_contact', 'set_crm_commitment_status', 'kept_human_fields']) {
      expect(section).toContain(`\`${name}\``);
    }
    expect(section).not.toMatch(/^### /m);
    expect(section).toContain('`human`');
    expect(section).toContain('`ai`');
  });
});

// Story 1.2: rättelser och bekräftelser genom action-lagret, med egna fixturer.
describe('1.2 rätta och bekräfta händelser', () => {
  let r12User: TestUser;
  let r12Neighbor: TestUser;
  let r12Company: string;
  let r12OtherCompany: string;
  let r12Agent: string;
  const r12Call = (name: string, input: Record<string, unknown>, token = r12User.token, company = r12Company) =>
    api.post(`/api/companies/${company}/actions/${name}`).set('Authorization', `Bearer ${token}`).send(input);
  async function r12Ok(name: string, input: Record<string, unknown>, token = r12User.token) {
    const response = await r12Call(name, input, token);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return response.body.result;
  }
  async function r12Ingest(event: Record<string, unknown>) {
    const result = await r12Ok('ingest_crm_events', { events: [event] });
    expect(result.skipped).toEqual([]);
    return result;
  }
  const r12Interaction = (n: string) => ({
    kind: 'interaction', organization: { name: 'Rättelseprovet R AB' },
    person: { name: 'Rättelsepersonen R', email: 'ratta-r@example.test' },
    occurred_at: '2026-09-01T09:00:00Z', channel: 'email', direction: 'inbound',
    summary: `Synkens sammanfattning R${n}.`, source_system: 'gmail', source_ref: `gmail:r${n}`,
  });
  async function r12Row(kind: 'interaction' | 'commitment', ref: string, company = r12Company) {
    return withAdmin(async (db) => (await db.query(kind === 'interaction'
      ? `SELECT id, organization_id, person_id, summary, channel, direction, occurred_at::text,
          source_system, source_ref FROM crm.interactions WHERE company_id = $1 AND source_ref = $2`
      : `SELECT id, organization_id, person_id, body, direction, due_date::text, status,
          occurred_at::text, source_system, source_ref, sfar FROM crm.commitments WHERE company_id = $1 AND source_ref = $2`,
    [company, ref])).rows[0]!);
  }
  async function r12Provenance(kind: 'interaction' | 'commitment', id: string, company = r12Company) {
    return withAdmin(async (db) => (await db.query(kind === 'interaction'
      ? `SELECT field, source, reason, source_system, source_ref FROM crm.field_provenance
          WHERE company_id = $1 AND interaction_id = $2 ORDER BY field`
      : `SELECT field, source, reason, source_system, source_ref FROM crm.field_provenance
          WHERE company_id = $1 AND commitment_id = $2 ORDER BY field`, [company, id])).rows);
  }
  async function r12Audit(name: string, id: string) {
    return withAdmin(async (db) => (await db.query(
      `SELECT entity_type, details FROM crm.audit_log WHERE company_id = $1 AND action = $2 AND entity_id = $3
       ORDER BY id DESC LIMIT 1`, [r12Company, name, id])).rows[0]);
  }
  beforeAll(async () => {
    r12User = await registerUser('ratta12');
    r12Neighbor = await registerUser('ratta12-granne');
    r12Company = await createCompany(r12User.token, 'Rättelsebolaget AB');
    r12OtherCompany = await createCompany(r12Neighbor.token, 'Grannbolaget R AB');
    const token = await api.post(`/api/companies/${r12Company}/agent-tokens`)
      .set('Authorization', `Bearer ${r12User.token}`).send({ name: 'Rättelseagenten' });
    expect(token.status, JSON.stringify(token.body)).toBe(201);
    r12Agent = token.body.token;
    for (const n of ['1', '2', '3', '4', '5', '6']) await r12Ingest(r12Interaction(n));
  });
  describe('kontaktpunkten', () => {
    it('R1 bara sammanfattningen rättas, får human och audit med enbart fältnamn', async () => {
      const before = await r12Row('interaction', 'gmail:r1');
      const result = await r12Ok('update_crm_interaction', { interaction_id: before.id, summary: 'Davids sammanfattning R1.' });
      expect(await r12Row('interaction', 'gmail:r1')).toEqual({ ...before, summary: 'Davids sammanfattning R1.' });
      const prov = await r12Provenance('interaction', before.id);
      expect(prov.find((p) => p.field === 'summary')?.source).toBe('human');
      expect(prov.filter((p) => p.field !== 'summary').map((p) => [p.field, p.source, p.source_ref]))
        .toEqual([['channel', 'sync', 'gmail:r1'], ['direction', 'sync', 'gmail:r1'], ['occurred_at', 'sync', 'gmail:r1']]);
      expect((await r12Audit('crm.interaction_corrected', before.id))?.details).toEqual({ fields: ['summary'] });
      expect(result.kept_human_fields).toEqual([]);
    });
    it('R2 agentens kanal får ai medan övriga fält behåller sync', async () => {
      const row = await r12Row('interaction', 'gmail:r2');
      await r12Ok('update_crm_interaction', { interaction_id: row.id, channel: 'call' }, r12Agent);
      expect((await r12Row('interaction', 'gmail:r2')).channel).toBe('call');
      expect((await r12Provenance('interaction', row.id)).map((p) => [p.field, p.source]))
        .toEqual([['channel', 'ai'], ['direction', 'sync'], ['occurred_at', 'sync'], ['summary', 'sync']]);
    });
    it('R3 okänt fält, blank text, tom rättelse och målkolumn avvisas utan verkan', async () => {
      const row = await r12Row('interaction', 'gmail:r3');
      const prov = await r12Provenance('interaction', row.id);
      for (const patch of [{ source_ref: 'x' }, { summary: '   ' }, {}, { organization_id: row.organization_id, summary: 'Flytt R3.' }]) {
        const response = await r12Call('update_crm_interaction', { interaction_id: row.id, ...patch });
        expect(response.status, JSON.stringify(response.body)).toBe(400);
        if (!Object.keys(patch).length) expect(response.body.error).toBe('nothing_to_update');
      }
      expect(await r12Row('interaction', 'gmail:r3')).toEqual(row);
      expect(await r12Provenance('interaction', row.id)).toEqual(prov);
      expect(await r12Audit('crm.interaction_corrected', row.id)).toBeUndefined();
    });
    it('R4 grannbolagets rättelse ger 404 men det egna bolagets går igenom', async () => {
      const row = await r12Row('interaction', 'gmail:r4');
      const prov = await r12Provenance('interaction', row.id);
      const response = await r12Call('update_crm_interaction', { interaction_id: row.id, summary: 'Grannens text' }, r12Neighbor.token, r12OtherCompany);
      expect(response.status, JSON.stringify(response.body)).toBe(404);
      expect(await r12Row('interaction', 'gmail:r4')).toEqual(row);
      expect(await r12Provenance('interaction', row.id)).toEqual(prov);
      await r12Ok('update_crm_interaction', { interaction_id: row.id, summary: 'Egen text R4.' });
    });
    it('R5 agenten stoppas efter människans rättelse och stoppet auditeras', async () => {
      const row = await r12Row('interaction', 'gmail:r5');
      await r12Ok('update_crm_interaction', { interaction_id: row.id, summary: 'Människans R5.' });
      const result = await r12Ok('update_crm_interaction', { interaction_id: row.id, summary: 'Agentens R5.' }, r12Agent);
      expect((await r12Row('interaction', 'gmail:r5')).summary).toBe('Människans R5.');
      expect((await r12Provenance('interaction', row.id)).find((p) => p.field === 'summary')?.source).toBe('human');
      expect(result.kept_human_fields).toEqual(['summary']);
      expect((await r12Audit('crm.interaction_corrected', row.id))?.details).toEqual({ fields: [], kept_human_fields: ['summary'] });
    });
    it('R6 negativ kontroll: agenten får rätta ett sync-fält', async () => {
      const row = await r12Row('interaction', 'gmail:r6');
      const result = await r12Ok('update_crm_interaction', { interaction_id: row.id, summary: 'Agentens R6.' }, r12Agent);
      expect((await r12Row('interaction', 'gmail:r6')).summary).toBe('Agentens R6.');
      expect((await r12Provenance('interaction', row.id)).find((p) => p.field === 'summary')?.source).toBe('ai');
      expect(result.kept_human_fields).toEqual([]);
    });
  });

  const r12Commitment = (n: string) => ({
    kind: 'commitment', organization: { name: 'Rättelseprovet L AB' }, commitment_direction: 'we_owe',
    body: `Ärendets text L${n}.`, due_date: '2026-10-30', occurred_at: '2026-09-02T09:00:00Z',
    source_system: 'linear', source_ref: `linear:LOC-L${n}`,
  });
  describe('löftet', () => {
    beforeAll(async () => {
      for (const n of ['1', '2', '3', '4', '5', '6', '6b', '7']) await r12Ingest(r12Commitment(n));
    });
    it('L1 ett uttryckligt null tar bort datumet med human och audit', async () => {
      const row = await r12Row('commitment', 'linear:LOC-L1');
      await r12Ok('update_crm_commitment', { commitment_id: row.id, due_date: null });
      expect(await r12Row('commitment', 'linear:LOC-L1')).toEqual({ ...row, due_date: null });
      expect((await r12Provenance('commitment', row.id)).map((p) => [p.field, p.source]))
        .toEqual([['body', 'sync'], ['direction', 'sync'], ['due_date', 'human'], ['occurred_at', 'sync']]);
      expect((await r12Audit('crm.commitment_corrected', row.id))?.details).toEqual({ fields: ['due_date'] });
    });
    it('L2 bara texten rättas; datum, mål och sfär lämnas orörda', async () => {
      const row = await r12Row('commitment', 'linear:LOC-L2');
      const result = await r12Ok('update_crm_commitment', { commitment_id: row.id, body: 'Davids text L2.' });
      expect(await r12Row('commitment', 'linear:LOC-L2')).toEqual({ ...row, body: 'Davids text L2.' });
      expect(result.sfar).toBe('foretag');
      expect((await r12Provenance('commitment', row.id)).find((p) => p.field === 'due_date'))
        .toMatchObject({ source: 'sync', source_ref: 'linear:LOC-L2' });
    });
    it('L3 framtid, status, tom rättelse, annat bolag och sfär avvisas utan verkan', async () => {
      const row = await r12Row('commitment', 'linear:LOC-L3');
      const prov = await r12Provenance('commitment', row.id);
      const future = await r12Call('update_crm_commitment', { commitment_id: row.id, occurred_at: '2099-01-01T12:00:00Z' });
      expect(future.status, JSON.stringify(future.body)).toBe(400);
      expect(future.body).toMatchObject({ error: 'occurred_at_in_future' });
      for (const patch of [{ status: 'done' }, {}, { sfar: 'privat', body: 'Privat L3.' }]) {
        const response = await r12Call('update_crm_commitment', { commitment_id: row.id, ...patch });
        expect(response.status, JSON.stringify(response.body)).toBe(400);
        if (!Object.keys(patch).length) expect(response.body.error).toBe('nothing_to_update');
      }
      const other = await r12Call('update_crm_commitment', { commitment_id: row.id, body: 'Grannens' }, r12Neighbor.token, r12OtherCompany);
      expect(other.status, JSON.stringify(other.body)).toBe(404);
      expect(await r12Row('commitment', 'linear:LOC-L3')).toEqual(row);
      expect(await r12Provenance('commitment', row.id)).toEqual(prov);
      expect(await r12Audit('crm.commitment_corrected', row.id)).toBeUndefined();
    });
    it('L4 rättad text och deadline står medan övriga fält följer intaget', async () => {
      const row = await r12Row('commitment', 'linear:LOC-L4');
      await r12Ok('update_crm_commitment', { commitment_id: row.id, body: 'Davids text L4.', due_date: '2026-11-15' });
      const result = await r12Ingest({ ...r12Commitment('4'), body: 'Ärendets nya text L4.', due_date: '2026-12-01',
        commitment_direction: 'they_owe', occurred_at: '2026-09-05T09:00:00Z' });
      expect(await r12Row('commitment', 'linear:LOC-L4')).toMatchObject({ body: 'Davids text L4.', due_date: '2026-11-15', direction: 'they_owe' });
      expect(new Date((await r12Row('commitment', 'linear:LOC-L4')).occurred_at).toISOString()).toBe('2026-09-05T09:00:00.000Z');
      expect(result.kept_human_fields.filter((v: string) => v.includes(': linear:LOC-L4 ')).sort())
        .toEqual(['Rättelseprovet L AB: linear:LOC-L4 body', 'Rättelseprovet L AB: linear:LOC-L4 due_date']);
    });
    it('L5 negativ kontroll: en rättelse märkt sync skrivs över av nästa intag', async () => {
      const row = await r12Row('commitment', 'linear:LOC-L5');
      await r12Ok('update_crm_commitment', { commitment_id: row.id, body: 'Davids text L5.', due_date: '2026-11-15' });
      await withAdmin((db) => db.query(`UPDATE crm.field_provenance SET source = 'sync', source_system = 'linear', source_ref = 'linear:LOC-L5'
        WHERE company_id = $1 AND commitment_id = $2 AND field IN ('body', 'due_date')`, [r12Company, row.id]));
      const result = await r12Ingest({ ...r12Commitment('5'), body: 'Ärendets nya text L5.', due_date: '2026-12-01', commitment_direction: 'they_owe' });
      expect(await r12Row('commitment', 'linear:LOC-L5')).toMatchObject({ body: 'Ärendets nya text L5.', due_date: '2026-12-01' });
      expect(result.kept_human_fields.filter((v: string) => v.includes(': linear:LOC-L5 '))).toEqual([]);
    });
    it('L6 agentens null stoppas på human men tar bort ett sync-datum med ai', async () => {
      const row = await r12Row('commitment', 'linear:LOC-L6');
      await r12Ok('update_crm_commitment', { commitment_id: row.id, due_date: '2026-11-20' });
      const result = await r12Ok('update_crm_commitment', { commitment_id: row.id, due_date: null }, r12Agent);
      expect(result.kept_human_fields).toEqual(['due_date']);
      expect((await r12Row('commitment', 'linear:LOC-L6')).due_date).toBe('2026-11-20');
      expect((await r12Provenance('commitment', row.id)).find((p) => p.field === 'due_date')?.source).toBe('human');
      const sync = await r12Row('commitment', 'linear:LOC-L6b');
      const changed = await r12Ok('update_crm_commitment', { commitment_id: sync.id, due_date: null }, r12Agent);
      expect(changed.kept_human_fields).toEqual([]);
      expect((await r12Row('commitment', 'linear:LOC-L6b')).due_date).toBeNull();
      expect((await r12Provenance('commitment', sync.id)).find((p) => p.field === 'due_date')?.source).toBe('ai');
    });
    it('L7 radlåset låter människans samtidiga rättelse vinna före vakten', async () => {
      const { updateCommitment } = await import('../src/services/crmRelations.js');
      const row = await r12Row('commitment', 'linear:LOC-L7');
      let release!: () => void;
      let ready!: (pid: number) => void;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      const locked = new Promise<number>((resolve) => { ready = resolve; });
      const first = withTenantTransaction(r12User.userId, r12Company, async (db) => {
        const pid = (await db.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid;
        await updateCommitment(db, r12Company, r12User.userId, { commitment_id: row.id, body: 'Människans text L7.' }, { source: 'human' });
        ready(pid);
        await gate;
      });
      let second: Promise<unknown> | undefined;
      try {
        const pid = await Promise.race([locked, first.then(() => { throw new Error('T1 avslutades före grinden'); })]);
        const agentWrite = withTenantTransaction(r12User.userId, r12Company, (db) =>
          updateCommitment(db, r12Company, r12User.userId, { commitment_id: row.id, body: 'Agentens text L7.' }, { source: 'ai' }));
        second = agentWrite;
        let blocked = false;
        for (let i = 0; i < 100; i++) {
          blocked = await withAdmin(async (db) => (await db.query<{ blocked: boolean }>(
            'SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE $1::int = ANY(pg_blocking_pids(pid))) AS blocked', [pid])).rows[0]!.blocked);
          if (blocked) break;
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        release();
        await first;
        const result = await agentWrite;
        expect(blocked, 'agenten måste vänta på människans radlås').toBe(true);
        expect(result.kept_human_fields).toEqual(['body']);
        expect((await r12Row('commitment', 'linear:LOC-L7')).body).toBe('Människans text L7.');
        expect((await r12Provenance('commitment', row.id)).find((p) => p.field === 'body')?.source).toBe('human');
      } finally {
        release();
        await Promise.allSettled([first, second]);
      }
    });
  });

  describe('bekräftelsen', () => {
    let r12BInteraction: string;
    let r12BCommitment: string;
    let r12BOrg: string;
    let r12BPerson: string;
    let r12ForeignInteraction: string;
    beforeAll(async () => {
      r12BOrg = (await r12Ok('upsert_crm_organization', { name: 'Bekräftelseprovet AB' })).id;
      r12BPerson = (await r12Ok('upsert_crm_person', { name: 'Bekräftelsepersonen B', organization_id: r12BOrg })).id;
      r12BInteraction = (await r12Ok('record_crm_interaction', {
        organization_id: r12BOrg, occurred_at: '2026-09-04T10:00:00Z', channel: 'note', direction: 'outbound',
        summary: 'AI:ts anteckning B.', source_system: 'manual',
      }, r12Agent)).id;
      r12BCommitment = (await r12Ok('record_crm_commitment', {
        organization_id: r12BOrg, direction: 'we_owe', body: 'AI:ts löfte B.', due_date: '2026-11-01',
        occurred_at: '2026-09-04T10:05:00Z', source_system: 'manual',
      }, r12Agent)).id;
      const neighbor = await r12Call('ingest_crm_events', { events: [{ ...r12Interaction('b-granne'),
        organization: { name: 'Grannens Relation B AB' }, source_ref: 'gmail:b-granne' }] }, r12Neighbor.token, r12OtherCompany);
      expect(neighbor.status, JSON.stringify(neighbor.body)).toBe(200);
      expect(neighbor.body.result.skipped).toEqual([]);
      r12ForeignInteraction = (await r12Row('interaction', 'gmail:b-granne', r12OtherCompany)).id;
    });
    it('B1 kontaktpunktens kanal bekräftas utan att värdet ändras', async () => {
      await r12Ok('confirm_crm_value', { interaction_id: r12BInteraction, field: 'channel' });
      expect((await r12Provenance('interaction', r12BInteraction)).map((p) => [p.field, p.source, p.reason]))
        .toEqual([['channel', 'human', 'bekräftad av människa'], ['direction', 'ai', null], ['occurred_at', 'ai', null], ['summary', 'ai', null]]);
      const value = await withAdmin(async (db) => (await db.query('SELECT channel FROM crm.interactions WHERE company_id = $1 AND id = $2', [r12Company, r12BInteraction])).rows[0]);
      expect(value?.channel).toBe('note');
      expect(await r12Audit('crm.value_confirmed', r12BInteraction)).toMatchObject({ entity_type: 'interaction', details: { field: 'channel' } });
    });
    it('B2 löftets datum och status bekräftas utan att värdena ändras', async () => {
      for (const field of ['due_date', 'status']) await r12Ok('confirm_crm_value', { commitment_id: r12BCommitment, field });
      expect((await r12Provenance('commitment', r12BCommitment)).filter((p) => ['due_date', 'status'].includes(p.field)).map((p) => [p.field, p.source, p.reason]))
        .toEqual([['due_date', 'human', 'bekräftad av människa'], ['status', 'human', 'bekräftad av människa']]);
      const value = await withAdmin(async (db) => (await db.query('SELECT due_date::text, status FROM crm.commitments WHERE company_id = $1 AND id = $2', [r12Company, r12BCommitment])).rows[0]);
      expect(value).toEqual({ due_date: '2026-11-01', status: 'open' });
      expect(await r12Audit('crm.value_confirmed', r12BCommitment)).toMatchObject({ entity_type: 'commitment', details: { field: 'status' } });
    });
    it('B3 flera mål och fält utanför målets lista avvisas', async () => {
      const beforeI = await r12Provenance('interaction', r12BInteraction);
      const beforeC = await r12Provenance('commitment', r12BCommitment);
      for (const input of [
        { interaction_id: r12BInteraction, commitment_id: r12BCommitment, field: 'direction' },
        { interaction_id: r12BInteraction, field: 'body' }, { commitment_id: r12BCommitment, field: 'channel' },
        { organization_id: r12BOrg, field: 'summary' }, { person_id: r12BPerson, field: 'due_date' },
      ]) {
        const response = await r12Call('confirm_crm_value', input);
        expect(response.status, JSON.stringify(response.body)).toBe(400);
      }
      expect(await r12Provenance('interaction', r12BInteraction)).toEqual(beforeI);
      expect(await r12Provenance('commitment', r12BCommitment)).toEqual(beforeC);
    });
    it('B4 agenten får aldrig bekräfta sin egen gissning', async () => {
      const response = await r12Call('confirm_crm_value', { commitment_id: r12BCommitment, field: 'body' }, r12Agent);
      expect(response.status, JSON.stringify(response.body)).toBe(403);
      expect(response.body.error).toBe('human_confirmation_required');
      expect((await r12Provenance('commitment', r12BCommitment)).find((p) => p.field === 'body')?.source).toBe('ai');
    });
    it('B5 bekräftelse av grannbolagets händelse ger 404 utan ändring', async () => {
      const before = await r12Provenance('interaction', r12ForeignInteraction, r12OtherCompany);
      const response = await r12Call('confirm_crm_value', { interaction_id: r12ForeignInteraction, field: 'summary' });
      expect(response.status, JSON.stringify(response.body)).toBe(404);
      expect(await r12Provenance('interaction', r12ForeignInteraction, r12OtherCompany)).toEqual(before);
    });
    it('B6 MCP-manifestet har ett objekt med båda händelsemålen', async () => {
      const response = await api.get(`/api/companies/${r12Company}/actions`).set('Authorization', `Bearer ${r12User.token}`);
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      const schema = response.body.actions.find((entry: { name: string }) => entry.name === 'confirm_crm_value').input_schema;
      expect(schema.type).toBe('object');
      expect(schema.properties).toHaveProperty('interaction_id');
      expect(schema.properties).toHaveProperty('commitment_id');
      expect(schema).not.toHaveProperty('anyOf');
    });

    // En grind håller T1 öppen. Det räcker inte att T2 väntar på ursprungsraden:
    // utan händelsens lås kan vakten redan ha läst det gamla ursprunget.
    async function r12DuringConfirmation<T>(
      hold: (db: pg.PoolClient) => Promise<void>, compete: () => Promise<T>,
    ): Promise<{ blocked: boolean; result: T }> {
      let release!: () => void;
      let ready!: (pid: number) => void;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      const locked = new Promise<number>((resolve) => { ready = resolve; });
      const first = withTenantTransaction(r12User.userId, r12Company, async (db) => {
        await hold(db);
        ready((await db.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid);
        await gate;
      });
      let second: Promise<T> | undefined;
      try {
        const pid = await Promise.race([locked, first.then(() => { throw new Error('T1 avslutades före grinden'); })]);
        second = compete();
        // Avvisningar observeras direkt, också om de kommer under låspollningen.
        void second.catch(() => {});
        let blocked = false;
        for (let i = 0; i < 100; i++) {
          blocked = await withAdmin(async (db) => (await db.query<{ blocked: boolean }>(
            'SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE $1::int = ANY(pg_blocking_pids(pid))) AS blocked',
            [pid])).rows[0]!.blocked);
          if (blocked) break;
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        release();
        await first;
        return { blocked, result: await second };
      } finally {
        release();
        await Promise.allSettled([first, second]);
      }
    }

    it.each(['interaction', 'commitment'] as const)(
      'B7 %s: bekräftelsen väntar på händelsens pågående skrivning', async (kind) => {
        const ref = kind === 'interaction' ? 'gmail:rB7' : 'linear:LOC-LB7';
        await r12Ingest(kind === 'interaction' ? r12Interaction('B7') : r12Commitment('B7'));
        const before = await r12Row(kind, ref);
        const target = kind === 'interaction' ? { interaction_id: before.id } : { commitment_id: before.id };
        const field = kind === 'interaction' ? 'summary' : 'body';
        const { blocked } = await r12DuringConfirmation(async (db) => {
          await db.query(kind === 'interaction'
            ? 'SELECT id FROM crm.interactions WHERE company_id = $1 AND id = $2 FOR UPDATE'
            : 'SELECT id FROM crm.commitments WHERE company_id = $1 AND id = $2 FOR UPDATE', [r12Company, before.id]);
        }, () => r12Ok('confirm_crm_value', { ...target, field }));
        expect(blocked, 'bekräftelsen måste vänta innan den skriver human').toBe(true);
        expect(await r12Row(kind, ref)).toEqual(before);
        expect((await r12Provenance(kind, before.id)).find((p) => p.field === field))
          .toMatchObject({ source: 'human', reason: 'bekräftad av människa' });
      },
    );

    const r12ConfirmationFields = [
      { kind: 'interaction', field: 'summary', value: 'Agentens nya sammanfattning B8.' },
      { kind: 'interaction', field: 'channel', value: 'call' },
      { kind: 'interaction', field: 'direction', value: 'outbound' },
      { kind: 'interaction', field: 'occurred_at', value: '2026-09-08T12:00:00Z' },
      { kind: 'commitment', field: 'body', value: 'Agentens nya text B8.' },
      { kind: 'commitment', field: 'direction', value: 'they_owe' },
      { kind: 'commitment', field: 'due_date', value: null },
      { kind: 'commitment', field: 'occurred_at', value: '2026-09-08T12:00:00Z' },
      { kind: 'commitment', field: 'status', value: 'done' },
    ] as const;
    it.each(r12ConfirmationFields.flatMap((entry) => ['sync', 'ai'].map((source) => ({ ...entry, source }))))(
      'B8 $kind.$field ($source): en öppen bekräftelse skyddar bara sitt fält mot agenten',
      async ({ kind, field, value, source }) => {
        const { confirmCrmValue } = await import('../src/services/crmRelations.js');
        const n = `B8-${field}-${source}`;
        const ref = kind === 'interaction' ? `gmail:r${n}` : `linear:LOC-L${n}`;
        const event = kind === 'interaction' ? r12Interaction(n) : r12Commitment(n);
        await r12Ingest(event);
        const before = await r12Row(kind, ref);
        const target = kind === 'interaction' ? { interaction_id: before.id } : { commitment_id: before.id };
        const action = kind === 'interaction' ? 'update_crm_interaction' : 'update_crm_commitment';
        const otherField = kind === 'interaction'
          ? field === 'summary' ? 'direction' : 'summary'
          : field === 'body' ? 'direction' : 'body';
        const otherValue = otherField === 'summary' || otherField === 'body'
          ? 'Obekräftat fält B8.' : kind === 'interaction' ? 'internal' : 'they_owe';
        if (source === 'ai') {
          // Skriv samma värde via agenten så att startursprunget blir ai, utan
          // att återanvända de värden som ska försöka skriva över bekräftelsen.
          await r12Ok(field === 'status' ? 'set_crm_commitment_status' : action,
            { ...target, [field]: field === 'occurred_at' ? new Date(before[field]).toISOString() : before[field] }, r12Agent);
        }
        expect((await r12Provenance(kind, before.id)).find((p) => p.field === field)?.source)
          .toBe(field === 'status' && source === 'sync' ? undefined : source);
        const { blocked, result } = await r12DuringConfirmation(async (db) => {
          await confirmCrmValue(db, r12Company, r12User.userId, 'human', target, field);
          expect((await readProvenance(db, r12Company, target)).get(field)?.source).toBe('human');
        }, () => r12Ok(field === 'status' ? 'set_crm_commitment_status' : action,
          { ...target, [field]: value, ...(field === 'status' ? {} : { [otherField]: otherValue }) }, r12Agent));
        expect(blocked, 'agenten måste vänta tills människans bekräftelse committats').toBe(true);
        expect(result.kept_human_fields).toEqual([field]);
        const after = await r12Row(kind, ref);
        expect(after[field]).toEqual(before[field]);
        expect((await r12Provenance(kind, before.id)).find((p) => p.field === field))
          .toMatchObject({ source: 'human', reason: 'bekräftad av människa' });
        expect(await r12Audit('crm.value_confirmed', before.id))
          .toMatchObject({ entity_type: kind, details: { field } });
        if (field !== 'status') {
          expect(after[otherField], 'negativ kontroll: obekräftade fält följer fortfarande agenten').toBe(otherValue);
          expect((await r12Provenance(kind, before.id)).find((p) => p.field === otherField)?.source).toBe('ai');
          expect(await r12Audit(`crm.${kind}_corrected`, before.id))
            .toMatchObject({ details: { fields: [otherField], kept_human_fields: [field] } });
        }
      },
    );

    it.each(['interaction', 'commitment'] as const)(
      'B9 %s: en samtidig omsändning behåller bekräftelsen och följer källan för resten', async (kind) => {
        const { confirmCrmValue } = await import('../src/services/crmRelations.js');
        const event = kind === 'interaction' ? r12Interaction('B9') : r12Commitment('B9');
        const ref = kind === 'interaction' ? 'gmail:rB9' : 'linear:LOC-LB9';
        await r12Ingest(event);
        const before = await r12Row(kind, ref);
        const target = kind === 'interaction' ? { interaction_id: before.id } : { commitment_id: before.id };
        const field = kind === 'interaction' ? 'summary' : 'body';
        const { blocked, result } = await r12DuringConfirmation(
          async (db) => { await confirmCrmValue(db, r12Company, r12User.userId, 'human', target, field); },
          () => r12Ingest({ ...event, [field]: 'Källans nya text B9.',
            ...(kind === 'interaction' ? { direction: 'outbound' } : { commitment_direction: 'they_owe' }) }),
        );
        expect(blocked, 'synken måste vänta på bekräftelsen före vakten').toBe(true);
        expect(result.kept_human_fields).toEqual([
          `${kind === 'interaction' ? 'Rättelseprovet R AB' : 'Rättelseprovet L AB'}: ${ref} ${field}`,
        ]);
        const after = await r12Row(kind, ref);
        expect(after[field]).toEqual(before[field]);
        expect(after.direction).toBe(kind === 'interaction' ? 'outbound' : 'they_owe');
        const provenance = await r12Provenance(kind, before.id);
        expect(provenance.find((p) => p.field === field)).toMatchObject({ source: 'human', reason: 'bekräftad av människa' });
        expect(provenance.find((p) => p.field === 'direction')?.source).toBe('sync');
      },
    );
  });

  it('D1 dokumentet beskriver rättelser, händelsemål och felkoder i ett eget avsnitt', async () => {
    const document = await readFile(new URL('../../docs/MCP_ACTIONS.md', import.meta.url), 'utf8');
    const heading = '## Rätta och bekräfta händelser (crm 1.2)';
    const start = document.indexOf(heading);
    expect(start, 'avsnittet crm 1.2 saknas').toBeGreaterThanOrEqual(0);
    const rest = document.slice(start + heading.length);
    const next = rest.search(/^#{2,3} /m);
    const section = next < 0 ? rest : rest.slice(0, next);
    for (const term of ['update_crm_interaction', 'update_crm_commitment', 'interaction_id', 'commitment_id',
      'due_date: null', 'kept_human_fields', 'occurred_at_in_future', 'nothing_to_update']) {
      expect(section, term).toContain(term);
    }
  });
});
