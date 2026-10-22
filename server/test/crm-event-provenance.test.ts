// CRM 1.1: en människorättad händelse får inte skrivas över av nästa synk.
// Prövar migration, tjänstens fältvakt, åtgärdernas aktör och intagets kvitto
// mot riktig Postgres. Negativa kontroller skiljer människobeslut från synk.
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import pg from 'pg';
import supertest from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadMigrations, migrate, type MigrationFile } from '../src/db/migrate.js';
import { pool } from '../src/db/pool.js';
import { setTenantContext, withTenantTransaction } from '../src/db/tx.js';
import { confirmValue, guardHumanFields, readProvenance, recordProvenance } from '../src/services/crmProvenance.js';
import { upsertPerson } from '../src/services/crmRelations.js';
import { api, app, createCompany, registerUser, withAdmin, type TestUser } from './helpers.js';

let user: TestUser;
let other: TestUser;
let companyId: string;
let otherCompany: string;
const action = (name: string, input: Record<string, unknown>, token = user.token, company = companyId) =>
  api.post(`/api/companies/${company}/actions/${name}`).set('Authorization', `Bearer ${token}`).send(input);

async function organization(name: string): Promise<string> {
  const r = await action('upsert_crm_organization', { name });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body.result.id as string;
}

// Plantering med INSERT håller migrations- och tjänsteproven oberoende av
// åtgärdernas proveniens, som byggs först i uppgift 3.
async function seedEvents(name: string, ref?: string) {
  const org = await organization(name);
  return withAdmin(async (c) => {
    const i = await c.query<{ id: string }>(
      `INSERT INTO crm.interactions (company_id, organization_id, occurred_at, channel, summary, source_system, source_ref)
       VALUES ($1,$2,'2026-06-10T09:14:00Z','email','Ursprunglig kontakt','gmail',$3) RETURNING id`,
      [companyId, org, ref ?? null]);
    const k = await c.query<{ id: string }>(
      `INSERT INTO crm.commitments (company_id, organization_id, direction, body, occurred_at, source_system)
       VALUES ($1,$2,'we_owe','Ursprungligt löfte','2026-06-10T09:14:00Z','linear') RETURNING id`,
      [companyId, org]);
    return { org, interaction: i.rows[0]!.id, commitment: k.rows[0]!.id };
  });
}

beforeAll(async () => {
  user = await registerUser('handelseursprung');
  companyId = await createCompany(user.token, 'Ursprungstest AB');
  other = await registerUser('ursprungsgranne');
  otherCompany = await createCompany(other.token, 'Grannens AB');
});

const tenant = <T>(fn: (c: pg.PoolClient) => Promise<T>) => withTenantTransaction(user.userId, companyId, fn);

const SCRATCH_DB = 'redovisning_test_handelseursprung';
function scratchUrl() {
  const url = new URL(process.env.DATABASE_ADMIN_URL!);
  url.pathname = `/${SCRATCH_DB}`;
  return url.toString();
}
async function maintenance(fn: (c: pg.Client) => Promise<unknown>) {
  const c = new pg.Client({ connectionString: process.env.MAINTENANCE_DATABASE_URL });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}
async function scratch<T>(fn: (c: pg.Client) => Promise<T>) {
  const c = new pg.Client({ connectionString: scratchUrl() });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}
async function catalog(c: pg.Client) {
  const columns = await c.query(`SELECT column_name, data_type, is_nullable FROM information_schema.columns
    WHERE table_schema = 'crm' AND table_name = 'field_provenance'
      AND column_name IN ('interaction_id','commitment_id') ORDER BY column_name`);
  const constraints = await c.query(`SELECT conname, confrelid::regclass::text AS target,
      cardinality(conkey) AS keys, confdeltype, pg_get_constraintdef(oid) AS definition
    FROM pg_constraint WHERE conrelid = 'crm.field_provenance'::regclass
      AND conname IN ('field_provenance_interaction_fk','field_provenance_commitment_fk','field_provenance_target_ck')
    ORDER BY conname`);
  const indexes = await c.query(`SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'crm'
    AND indexname IN ('field_provenance_interaction_uk','field_provenance_commitment_uk') ORDER BY indexname`);
  return { columns: columns.rows, constraints: constraints.rows, indexes: indexes.rows };
}

describe('migrationen A-1', () => {
  describe('befintliga rader och omkörning i egen databas', () => {
    let migration: MigrationFile;
    let dir: string;
    let beforeCount: number;
    beforeAll(async () => {
      const all = await loadMigrations();
      const found = all.find((m) => m.name === 'crm_event_provenance');
      expect(found, 'migrationen crm_event_provenance saknas').toBeDefined();
      migration = found!;
      dir = await mkdtemp(path.join(tmpdir(), 'crm-event-migrations-'));
      for (const m of all.filter((m) => m.version < migration.version)) {
        await writeFile(path.join(dir, m.filename), m.sql);
      }
      await maintenance(async (c) => {
        await c.query(`DROP DATABASE IF EXISTS ${SCRATCH_DB} WITH (FORCE)`);
        await c.query(`CREATE DATABASE ${SCRATCH_DB}`);
      });
      await migrate(scratchUrl(), { dir });
      beforeCount = await scratch(async (c) => {
        const co = (await c.query("INSERT INTO companies (name) VALUES ('Gamla rader AB') RETURNING id")).rows[0].id;
        const org = (await c.query("INSERT INTO crm.organizations (company_id,name) VALUES ($1,'Motpart AB') RETURNING id", [co])).rows[0].id;
        const person = (await c.query("INSERT INTO crm.people (company_id,name,email) VALUES ($1,'Person','person@example.se') RETURNING id", [co])).rows[0].id;
        await c.query(`INSERT INTO crm.interactions (company_id,organization_id,occurred_at,channel,summary,source_system)
          VALUES ($1,$2,'2026-06-10T09:14:00Z','email','Kontakt','gmail')`, [co, org]);
        await c.query(`INSERT INTO crm.commitments (company_id,organization_id,occurred_at,direction,body,source_system)
          VALUES ($1,$2,'2026-06-10T09:14:00Z','we_owe','Löfte','linear')`, [co, org]);
        await c.query(`INSERT INTO crm.field_provenance (company_id,organization_id,person_id,field,source)
          VALUES ($1,$2,NULL,'name','human'),($1,NULL,$3,'email','sync')`, [co, org, person]);
        return Number((await c.query('SELECT count(*) FROM crm.field_provenance')).rows[0].count);
      });
      await migrate(scratchUrl());
    });
    afterAll(async () => {
      if (dir) await rm(dir, { recursive: true, force: true });
      if (migration) await maintenance((c) => c.query(`DROP DATABASE IF EXISTS ${SCRATCH_DB} WITH (FORCE)`));
    });
    it('M1 kolumner, sammansatta kaskad-FK, målvillkor och partiella unika index', async () => {
      const got = await scratch(catalog);
      expect(got.columns).toEqual([
        { column_name: 'commitment_id', data_type: 'uuid', is_nullable: 'YES' },
        { column_name: 'interaction_id', data_type: 'uuid', is_nullable: 'YES' },
      ]);
      for (const [name, target, field] of [
        ['field_provenance_commitment_fk', 'crm.commitments', 'commitment_id'],
        ['field_provenance_interaction_fk', 'crm.interactions', 'interaction_id'],
      ]) {
        expect(got.constraints.find((x) => x.conname === name)).toMatchObject({ target, keys: 2, confdeltype: 'c' });
        expect(got.constraints.find((x) => x.conname === name)!.definition)
          .toContain(`FOREIGN KEY (${field}, company_id) REFERENCES ${target}(id, company_id) ON DELETE CASCADE`);
      }
      const ck = got.constraints.find((x) => x.conname === 'field_provenance_target_ck')!.definition;
      expect(ck).toContain('num_nonnulls(organization_id, person_id, interaction_id, commitment_id) = 1');
      expect(got.indexes).toHaveLength(2);
      for (const field of ['commitment_id', 'interaction_id']) {
        expect(got.indexes.find((x) => x.indexname === `field_provenance_${field.replace('_id', '')}_uk`)!.indexdef)
          .toContain(`UNIQUE INDEX`);
        expect(got.indexes.find((x) => x.indexname === `field_provenance_${field.replace('_id', '')}_uk`)!.indexdef)
          .toContain(`(company_id, ${field}, field) WHERE (${field} IS NOT NULL)`);
      }
    });
    it('M2 två gamla ursprungsrader står kvar, ingen bakåtfyllnad', async () => {
      expect(beforeCount).toBe(2);
      const got = await scratch((c) => c.query(`SELECT count(*)::int AS total,
        count(*) FILTER (WHERE interaction_id IS NOT NULL OR commitment_id IS NOT NULL)::int AS events FROM crm.field_provenance`));
      expect(got.rows).toEqual([{ total: 2, events: 0 }]);
    });
    it('M3 hela kedjan och migrationens SQL tål en andra körning', async () => {
      const before = await scratch(catalog);
      expect((await migrate(scratchUrl())).applied).toEqual([]);
      await scratch(async (c) => {
        await c.query('BEGIN');
        try { await c.query(migration.sql); await c.query('COMMIT'); }
        catch (err) { await c.query('ROLLBACK'); throw err; }
      });
      expect(await scratch(catalog)).toEqual(before);
      expect(await scratch(async (c) => Number((await c.query('SELECT count(*) FROM crm.field_provenance')).rows[0].count))).toBe(2);
    });
  });

  it('M4 exakt ett mål: två och noll avvisas med 23514', async () => {
    const ids = await seedEvents('M4 AB');
    for (const targets of [[ids.interaction, ids.commitment], [null, null]]) {
      await withAdmin(async (c) => {
        await c.query('BEGIN');
        try {
          await expect(c.query(`INSERT INTO crm.field_provenance (company_id,interaction_id,commitment_id,field,source)
            VALUES ($1,$2,$3,'summary','sync')`, [companyId, ...targets])).rejects.toMatchObject({ code: '23514' });
        } finally { await c.query('ROLLBACK'); }
      });
    }
  });
  it('M5 kontaktpunktens och löftets ursprung dör med respektive händelse', async () => {
    const ids = await seedEvents('M5 AB');
    await withAdmin(async (c) => {
      await c.query(`INSERT INTO crm.field_provenance (company_id,interaction_id,commitment_id,field,source)
        VALUES ($1,$2,NULL,'summary','sync'),($1,$2,NULL,'channel','sync'),
               ($1,NULL,$3,'body','sync'),($1,NULL,$3,'direction','sync')`, [companyId, ids.interaction, ids.commitment]);
      expect((await c.query('SELECT id FROM crm.field_provenance WHERE interaction_id=$1 OR commitment_id=$2', [ids.interaction, ids.commitment])).rowCount).toBe(4);
      await c.query('DELETE FROM crm.interactions WHERE id=$1', [ids.interaction]);
      await c.query('DELETE FROM crm.commitments WHERE id=$1', [ids.commitment]);
      expect((await c.query('SELECT id FROM crm.field_provenance WHERE interaction_id=$1 OR commitment_id=$2', [ids.interaction, ids.commitment])).rowCount).toBe(0);
    });
  });
  it('M6 sammansatta FK avvisar båda händelsemålen från ett annat bolag', async () => {
    const ids = await seedEvents('M6 AB');
    await withAdmin(async (c) => {
      await expect(c.query(`INSERT INTO crm.field_provenance (company_id,interaction_id,field,source)
        VALUES ($1,$2,'summary','sync')`, [otherCompany, ids.interaction])).rejects.toMatchObject({ code: '23503' });
      await expect(c.query(`INSERT INTO crm.field_provenance (company_id,commitment_id,field,source)
        VALUES ($1,$2,'body','sync')`, [otherCompany, ids.commitment])).rejects.toMatchObject({ code: '23503' });
    });
  });
  it('M7 rollen app i B kan varken läsa, lägga till, ändra eller radera A:s ursprung', async () => {
    const ids = await seedEvents('M7 AB');
    await withAdmin((c) => c.query(`INSERT INTO crm.field_provenance (company_id,interaction_id,commitment_id,field,source)
      VALUES ($1,$2,NULL,'summary','sync'),($1,NULL,$3,'body','sync')`, [companyId, ids.interaction, ids.commitment]));
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.user_id',$1,true),set_config('app.company_id',$2,true)", [other.userId, otherCompany]);
      expect((await c.query('SELECT * FROM crm.field_provenance WHERE company_id=$1', [companyId])).rowCount).toBe(0);
      expect((await c.query("UPDATE crm.field_provenance SET source='human' WHERE company_id=$1", [companyId])).rowCount).toBe(0);
      expect((await c.query('DELETE FROM crm.field_provenance WHERE company_id=$1', [companyId])).rowCount).toBe(0);
      await c.query('SAVEPOINT denied');
      await expect(c.query(`INSERT INTO crm.field_provenance (company_id,interaction_id,field,source)
        VALUES ($1,$2,'channel','sync')`, [companyId, ids.interaction])).rejects.toThrow(/row-level security/);
      await c.query('ROLLBACK TO SAVEPOINT denied');
      await expect(c.query(`INSERT INTO crm.field_provenance (company_id,commitment_id,field,source)
        VALUES ($1,$2,'direction','sync')`, [companyId, ids.commitment])).rejects.toThrow(/row-level security/);
    } finally { await c.query('ROLLBACK'); c.release(); }
  });
});

// Tjänstelagret prövas med app-rollen och samma tenant-transaktion som actions.
describe('fyra mål i provenienstjänsten', () => {
  let ids: Awaited<ReturnType<typeof seedEvents>>;
  let personId: string;
  beforeAll(async () => {
    ids = await seedEvents('P1 AB');
    personId = await withAdmin(async (c) => (await c.query<{ id: string }>(
      "INSERT INTO crm.people (company_id,name) VALUES ($1,'P-person') RETURNING id", [companyId])).rows[0]!.id);
  });
  it('P1 kontaktpunktens fält har sync och källpekare', async () => {
    await tenant(async (c) => {
      await recordProvenance(c, companyId, user.userId, { interaction_id: ids.interaction },
        [{ field: 'summary', source: 'sync', source_system: 'gmail', source_ref: 'gmail:p1' }]);
      expect((await readProvenance(c, companyId, { interaction_id: ids.interaction })).get('summary'))
        .toMatchObject({ source: 'sync', source_system: 'gmail', source_ref: 'gmail:p1' });
    });
  });
  it('P2 löftets body har ai', async () => {
    await tenant(async (c) => {
      await recordProvenance(c, companyId, user.userId, { commitment_id: ids.commitment }, [{ field: 'body', source: 'ai' }]);
      expect((await readProvenance(c, companyId, { commitment_id: ids.commitment })).get('body')?.source).toBe('ai');
    });
  });
  it('P3 samma fält uppdaterar sin enda rad', async () => {
    await tenant(async (c) => {
      await recordProvenance(c, companyId, user.userId, { interaction_id: ids.interaction }, [{ field: 'summary', source: 'human' }]);
      const rows = await c.query('SELECT source FROM crm.field_provenance WHERE company_id=$1 AND interaction_id=$2 AND field=$3',
        [companyId, ids.interaction, 'summary']);
      expect(rows.rows).toEqual([{ source: 'human' }]);
    });
  });
  it('P4 vakten tar bara bort människans fält; människans egen skrivning tillåts', async () => {
    await tenant(async (c) => {
      await recordProvenance(c, companyId, user.userId, { interaction_id: ids.interaction }, [{ field: 'channel', source: 'sync' }]);
      const input = { summary: 'Ny text', channel: 'meeting' };
      const guarded = await guardHumanFields(c, companyId, { interaction_id: ids.interaction }, 'sync', input);
      expect(guarded).toEqual({ input: { channel: 'meeting' }, blocked: ['summary'] });
      expect(await guardHumanFields(c, companyId, { interaction_id: ids.interaction }, 'human', input))
        .toEqual({ input, blocked: [] });
    });
  });
  it('P5 läsningarna blandar aldrig mål eller händelser', async () => {
    const empty = await seedEvents('P5 AB');
    await tenant(async (c) => {
      await recordProvenance(c, companyId, user.userId, { organization_id: ids.org }, [{ field: 'name', source: 'human' }]);
      await recordProvenance(c, companyId, user.userId, { person_id: personId }, [{ field: 'email', source: 'sync' }]);
      expect([...(await readProvenance(c, companyId, { organization_id: ids.org })).keys()]).toEqual(['name']);
      expect([...(await readProvenance(c, companyId, { person_id: personId })).keys()]).toEqual(['email']);
      expect((await readProvenance(c, companyId, { interaction_id: empty.interaction })).size).toBe(0);
    });
  });
  it('P6 bekräftelse av löftets status ger human och skäl', async () => {
    await tenant(async (c) => {
      await confirmValue(c, companyId, user.userId, { commitment_id: ids.commitment }, 'status');
      expect((await readProvenance(c, companyId, { commitment_id: ids.commitment })).get('status'))
        .toMatchObject({ source: 'human', reason: 'bekräftad av människa' });
    });
  });
});

interface OriginRow { field: string; source: string; source_system: string | null; source_ref: string | null; reason: string | null }
const origins = (interaction: string | null, commitment: string | null = null) => withAdmin(async (c) =>
  (await c.query<OriginRow>(`SELECT field,source,source_system,source_ref,reason FROM crm.field_provenance
    WHERE company_id=$1 AND (interaction_id=$2 OR commitment_id=$3) ORDER BY field`, [companyId, interaction, commitment])).rows);
async function eventRow(ref: string, kind: 'interaction' | 'commitment' = 'interaction') {
  return withAdmin(async (c) => (await c.query(kind === 'interaction'
    ? 'SELECT id,summary,channel,direction,occurred_at FROM crm.interactions WHERE company_id=$1 AND source_ref=$2'
    : 'SELECT id,body,direction,due_date::text,status,occurred_at FROM crm.commitments WHERE company_id=$1 AND source_ref=$2',
  [companyId, ref])).rows[0]);
}
const mail = (ref: string, name = `${ref} AB`) => ({
  kind: 'interaction', organization: { name }, occurred_at: '2026-06-10T09:14:00Z',
  channel: 'email', direction: 'inbound', summary: 'Ursprunglig sammanfattning', source_system: 'gmail', source_ref: ref,
});
const promiseEvent = (ref: string, name = `${ref} AB`) => ({
  kind: 'commitment', organization: { name }, occurred_at: '2026-06-10T09:14:00Z',
  commitment_direction: 'we_owe', body: 'Ursprunglig löftestext', due_date: '2026-07-01', source_system: 'linear', source_ref: ref,
});
async function ingest(events: Record<string, unknown>[]) {
  const r = await action('ingest_crm_events', { events });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  expect(r.body.result.skipped).toEqual([]);
  return r.body.result as {
    interactions_created: number; interactions_unchanged: number; commitments_created: number; commitments_unchanged: number;
    organizations_created: number; people_created: number; kept_human_fields: string[];
  };
}
let agentToken: string;
let view: ReturnType<typeof supertest.agent>;
let humanDone: string;
let personH7: string;

describe('skrivvägarna bär ursprung och skyddar människans fält', () => {
  beforeAll(async () => {
    const t = await api.post(`/api/companies/${companyId}/agent-tokens`)
      .set('Authorization', `Bearer ${user.token}`).send({ name: 'ursprungsagent' });
    expect(t.status, JSON.stringify(t.body)).toBe(201);
    agentToken = t.body.token;
    view = supertest.agent(app);
    const login = await view.post('/app/login').type('form').send({ email: user.email, password: 'mycket-hemligt-losen-123' });
    expect(login.status, JSON.stringify(login.body)).toBe(302);
  });
  it('H1 intagen kontaktpunkt har fyra sync-fält med källa och skäl', async () => {
    await ingest([{ ...mail('gmail:x'), person: { name: 'H1 Person', email: 'h1@example.se' } }]);
    const row = await eventRow('gmail:x');
    expect(await origins(row.id)).toEqual(['channel', 'direction', 'occurred_at', 'summary'].map((field) => ({
      field, source: 'sync', source_system: 'gmail', source_ref: 'gmail:x', reason: 'hämtad från gmail',
    })));
  });
  it('H2 löftet märker bara skrivna fält, aldrig statusens databasstandard', async () => {
    const { due_date: omitted, ...withoutDue } = promiseEvent('linear:LOC-h2b');
    await ingest([promiseEvent('linear:LOC-h2'), withoutDue]);
    const row = await eventRow('linear:LOC-h2', 'commitment');
    expect(await origins(null, row.id)).toEqual(['body', 'direction', 'due_date', 'occurred_at'].map((field) => ({
      field, source: 'sync', source_system: 'linear', source_ref: 'linear:LOC-h2', reason: 'hämtad från linear',
    })));
    const otherRow = await eventRow('linear:LOC-h2b', 'commitment');
    expect((await origins(null, otherRow.id)).map((p) => p.field)).toEqual(['body', 'direction', 'occurred_at']);
    const { due_date: omittedAgain, ...withoutExistingDue } = promiseEvent('linear:LOC-h2');
    await ingest([withoutExistingDue]);
    expect((await eventRow('linear:LOC-h2', 'commitment')).due_date).toBe('2026-07-01');
  });
  it('H3 vyns klart är human, agentens status på ett annat löfte är ai', async () => {
    await ingest([promiseEvent('linear:LOC-h3'), promiseEvent('linear:LOC-h3-agent')]);
    humanDone = (await eventRow('linear:LOC-h3', 'commitment')).id;
    const done = await view.post(`/app/c/${companyId}/commitments/${humanDone}/done`).type('form').send({});
    expect(done.status, JSON.stringify(done.body)).toBe(302);
    expect((await origins(null, humanDone)).find((p) => p.field === 'status')?.source).toBe('human');
    const aiId = (await eventRow('linear:LOC-h3-agent', 'commitment')).id;
    const r = await action('set_crm_commitment_status', { commitment_id: aiId, status: 'done' }, agentToken);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect((await origins(null, aiId)).find((p) => p.field === 'status')?.source).toBe('ai');
  });
  it('H4 agentens status stoppas och redovisas i svar och audit', async () => {
    const r = await action('set_crm_commitment_status', { commitment_id: humanDone, status: 'open' }, agentToken);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.result).toMatchObject({ status: 'done', kept_human_fields: ['status'] });
    expect((await eventRow('linear:LOC-h3', 'commitment')).status).toBe('done');
    expect((await origins(null, humanDone)).find((p) => p.field === 'status')?.source).toBe('human');
    const audit = await withAdmin(async (c) => (await c.query(`SELECT details FROM crm.audit_log
      WHERE company_id=$1 AND entity_id=$2 AND action='crm.commitment_status_set' ORDER BY occurred_at DESC,id DESC LIMIT 1`, [companyId, humanDone])).rows[0]);
    expect(audit.details).toEqual({ status: 'open', kept_human_fields: ['status'] });
  });
  it('H5 kontaktpunkt, löfte och log_contact märker varje skrivet fält med aktören', async () => {
    const org = await organization('H5 AB');
    for (const [token, source] of [[user.token, 'human'], [agentToken, 'ai']]) {
      for (const name of ['record_crm_interaction', 'record_crm_commitment', 'log_contact']) {
        const input = name === 'record_crm_commitment'
          ? { organization_id: org, direction: 'we_owe', body: 'H5 löfte', due_date: '2026-07-01', occurred_at: '2026-06-10T09:14:00Z', source_system: 'manual' }
          : { organization_id: org, channel: 'call', summary: 'H5 kontakt', occurred_at: '2026-06-10T09:14:00Z', ...(name === 'record_crm_interaction' ? { source_system: 'manual' } : {}) };
        const r = await action(name, input, token);
        expect(r.status, JSON.stringify(r.body)).toBe(200);
        const prov = name === 'record_crm_commitment' ? await origins(null, r.body.result.id) : await origins(r.body.result.id);
        expect(prov.map((p) => p.field)).toEqual(name === 'record_crm_commitment'
          ? ['body', 'direction', 'due_date', 'occurred_at'] : ['channel', 'direction', 'occurred_at', 'summary']);
        expect(prov.map((p) => p.source)).toEqual([source, source, source, source]);
      }
    }
  });
  it('H6 agentens omsändning skriver inte över människans löftestext', async () => {
    const org = await organization('H6 AB');
    const input = { organization_id: org, direction: 'we_owe', body: 'Människans text', occurred_at: '2026-06-10T09:14:00Z', source_system: 'gmail', source_ref: 'gmail:h6' };
    const first = await action('record_crm_commitment', input);
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    const r = await action('record_crm_commitment', { ...input, body: 'Agentens text' }, agentToken);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.result.body).toBe('Människans text');
    expect(r.body.result.kept_human_fields).toContain('body');
  });
  it('H7 personens människosatta kortlänk och anteckning står kvar efter synk', async () => {
    const p = await action('upsert_crm_person', { name: 'Kortpersonen H7', email: 'h7@example.se', external_ref: 'kort/A.md', notes: 'Människans anteckning' });
    expect(p.status, JSON.stringify(p.body)).toBe(200);
    personH7 = p.body.result.id;
    const r = await ingest([{ ...mail('gmail:h7'), person: { name: 'Kortpersonen H7', email: 'h7@example.se', external_ref: 'kort/B.md' } }]);
    const row = await withAdmin(async (c) => (await c.query('SELECT external_ref,notes FROM crm.people WHERE id=$1', [personH7])).rows[0]);
    expect(row).toEqual({ external_ref: 'kort/A.md', notes: 'Människans anteckning' });
    expect(r.kept_human_fields).toContain('Kortpersonen H7: external_ref');
  });
  it('H8 agenten kan inte ändra personens människosatta anteckning', async () => {
    const r = await action('upsert_crm_person', { name: 'Kortpersonen H7', email: 'h7@example.se', notes: 'Agentens anteckning' }, agentToken);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.result.notes).toBe('Människans anteckning');
    expect(r.body.result.kept_human_fields).toContain('notes');
  });
  it('H9 synkens kortlänk följer nästa synk och behåller ursprunget sync', async () => {
    const e = { ...mail('gmail:h9'), person: { name: 'Synkpersonen H9', email: 'h9@example.se', external_ref: 'kort/A.md' } };
    await ingest([e]);
    await ingest([{ ...e, person: { ...e.person, external_ref: 'kort/B.md' } }]);
    const row = await withAdmin(async (c) => (await c.query(`SELECT p.external_ref,fp.source FROM crm.people p
      JOIN crm.field_provenance fp ON fp.person_id=p.id AND fp.company_id=p.company_id AND fp.field='external_ref'
      WHERE p.company_id=$1 AND p.email='h9@example.se'`, [companyId])).rows[0]);
    expect(row).toEqual({ external_ref: 'kort/B.md', source: 'sync' });
  });
  it('H10 negativ kontroll: agentens löftestext får ändras av nästa agentanrop', async () => {
    const org = await organization('H10 AB');
    const input = { organization_id: org, direction: 'we_owe', body: 'Första', occurred_at: '2026-06-10T09:14:00Z', source_system: 'gmail', source_ref: 'gmail:h10' };
    const first = await action('record_crm_commitment', input, agentToken);
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    const r = await action('record_crm_commitment', { ...input, body: 'Andra' }, agentToken);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.result).toMatchObject({ body: 'Andra', kept_human_fields: [] });
  });
  it('H11 utelämnad riktning skriver inte över människans inbound med standardvärdet', async () => {
    const e = mail('gmail:h11');
    await ingest([e]);
    const row = await eventRow(e.source_ref);
    await tenant((c) => recordProvenance(c, companyId, user.userId, { interaction_id: row.id }, [{ field: 'direction', source: 'human' }]));
    const { direction: omitted, ...withoutDirection } = e;
    await ingest([withoutDirection]);
    expect((await eventRow(e.source_ref)).direction).toBe('inbound');
  });
  it('H12 äldre kontakt utan ursprung är oskyddad och får fyra sync-rader', async () => {
    const ids = await seedEvents('H12 AB', 'gmail:h12');
    const r = await ingest([{ ...mail('gmail:h12', 'H12 AB'), summary: 'Ny sammanfattning' }]);
    expect((await eventRow('gmail:h12')).summary).toBe('Ny sammanfattning');
    expect((await origins(ids.interaction)).map((p) => p.source)).toEqual(['sync', 'sync', 'sync', 'sync']);
    expect(r.kept_human_fields.filter((s) => s.includes(': gmail:h12 '))).toEqual([]);
  });
  it('H13 samma batch ger idel unchanged och samma antal ursprungsrader utan dubbletter', async () => {
    const events = [{ ...mail('gmail:h13'), person: { name: 'H13 Person', email: 'h13@example.se' } }, promiseEvent('linear:LOC-h13')];
    await ingest(events);
    const i = await eventRow('gmail:h13');
    const k = await eventRow('linear:LOC-h13', 'commitment');
    expect((await origins(i.id)).length + (await origins(null, k.id)).length).toBeGreaterThan(0);
    const count = () => withAdmin(async (c) => Number((await c.query('SELECT count(*) FROM crm.field_provenance WHERE company_id=$1', [companyId])).rows[0].count));
    const before = await count();
    const r = await ingest(events);
    expect(r).toMatchObject({ interactions_created: 0, commitments_created: 0, organizations_created: 0, people_created: 0,
      interactions_unchanged: 1, commitments_unchanged: 1 });
    expect(await count()).toBe(before);
    const duplicates = await withAdmin((c) => c.query(`SELECT organization_id,person_id,interaction_id,commitment_id,field
      FROM crm.field_provenance WHERE company_id=$1 GROUP BY organization_id,person_id,interaction_id,commitment_id,field HAVING count(*)>1`, [companyId]));
    expect(duplicates.rowCount).toBe(0);
  });
  it('H14 negativ kontroll: ett sync-fält skrivs över och redovisas inte som skyddat', async () => {
    const e = mail('gmail:h14', 'Ursprungsbolaget H14 AB');
    await ingest([e]);
    const row = await eventRow(e.source_ref);
    await tenant((c) => recordProvenance(c, companyId, user.userId, { interaction_id: row.id }, [{ field: 'summary', source: 'sync' }]));
    const r = await ingest([{ ...e, summary: 'Synkens nya text', channel: 'meeting', direction: 'outbound', occurred_at: '2026-06-11T10:00:00Z' }]);
    expect((await eventRow(e.source_ref)).summary).toBe('Synkens nya text');
    expect(r.kept_human_fields.filter((s) => s.includes(': gmail:h14 '))).toEqual([]);
  });
  it('H15 bolag B:s statusåtgärd ger 404 och lämnar A:s löfte och ursprung orörda', async () => {
    const e = promiseEvent('linear:LOC-h15');
    await ingest([e]);
    const row = await eventRow(e.source_ref, 'commitment');
    const before = await origins(null, row.id);
    const r = await action('set_crm_commitment_status', { commitment_id: row.id, status: 'dropped' }, other.token, otherCompany);
    expect(r.status, JSON.stringify(r.body)).toBe(404);
    expect((await eventRow(e.source_ref, 'commitment')).status).toBe('open');
    expect(await origins(null, row.id)).toEqual(before);
  });
});

describe('personens fältvakt vid överlappande transaktioner (AC 7, AI-Review)', () => {
  // Två skrivtransaktioner som app, med verklig låsväntan före commit.
  // Ingen tidsbaserad gissning om huruvida den andra skrivningen har startat.
  async function overlappingPersonWrite(
    match: 'email' | 'name', field: 'external_ref' | 'notes', source: 'sync' | 'ai',
    firstSource: 'human' | 'sync',
  ) {
    const key = `${match}-${field}-${source}-${firstSource}`;
    const name = `Samtidig ${key}`;
    const identity = match === 'email' ? { email: `${key}@example.se` } : {};
    const seeded = await tenant((c) => upsertPerson(c, companyId, user.userId,
      { name, ...identity, [field]: 'Ursprungligt värde', phone: '111' }, { source: 'sync' }));
    const firstName = match === 'email' ? `Rättad ${name}` : name;
    const first = await pool.connect();
    const second = await pool.connect();
    let pending: Promise<Awaited<ReturnType<typeof upsertPerson>>> | undefined;
    try {
      const firstPid = (await first.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid;
      const secondPid = (await second.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid;
      await first.query('BEGIN');
      await setTenantContext(first, user.userId, companyId);
      await upsertPerson(first, companyId, user.userId,
        { name: firstName, ...identity, [field]: 'Första skrivarens värde' }, { source: firstSource });
      await second.query('BEGIN');
      await setTenantContext(second, user.userId, companyId);
      pending = upsertPerson(second, companyId, user.userId,
        { name, ...identity, [field]: 'Nästa skrivarens värde', phone: '222' }, { source });
      // Hantera även ett tidigt fel utan ohanterad promise-rejection; felet
      // kastas fortfarande när resultatet inväntas nedan.
      void pending.catch(() => {});
      await withAdmin(async (admin) => {
        for (let attempt = 0; attempt < 200; attempt++) {
          const waiting = await admin.query<{ blocked: boolean }>(
            'SELECT $1::int = ANY(pg_blocking_pids($2::int)) AS blocked', [firstPid, secondPid]);
          if (waiting.rows[0]?.blocked) return;
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        throw new Error('den andra personskrivningen väntade aldrig på den första transaktionen');
      });
      await first.query('COMMIT');
      const result = await pending;
      await second.query('COMMIT');

      const blocked = firstSource === 'human'
        ? (match === 'email' ? ['email', field, 'name'] : [field, 'name']).sort()
        : [];
      expect(result).toMatchObject({
        id: seeded.id, created: false, phone: '222',
        name: firstSource === 'human' ? firstName : name,
        [field]: firstSource === 'human' ? 'Första skrivarens värde' : 'Nästa skrivarens värde',
        kept_human_fields: blocked,
      });
      const after = await tenant((c) => readProvenance(c, companyId, { person_id: seeded.id }));
      expect(after.get(field)?.source).toBe(firstSource === 'human' ? 'human' : source);
      expect(after.get('name')?.source).toBe(firstSource === 'human' ? 'human' : source);
      expect(after.get('phone')?.source).toBe(source);
      const stored = await withAdmin(async (c) => (await c.query(
        'SELECT name, external_ref, notes, phone FROM crm.people WHERE company_id=$1 AND id=$2',
        [companyId, seeded.id])).rows[0]);
      expect(stored).toMatchObject({ name: result.name, [field]: result[field], phone: '222' });
      const audit = await withAdmin(async (c) => (await c.query(`SELECT details FROM crm.audit_log
        WHERE company_id=$1 AND entity_id=$2 AND action='crm.person_updated'
          AND details->>'source'=$3 ORDER BY occurred_at DESC,id DESC LIMIT 1`,
      [companyId, seeded.id, source])).rows[0]);
      expect(audit.details).toEqual({
        matched_on: match, source, ...(blocked.length ? { kept_human_fields: blocked } : {}),
      });
    } finally {
      // Släpp hållarens lås även om synkroniseringen/assertionerna faller,
      // och invänta den andra skrivningen före återlämning av anslutningarna.
      await first.query('ROLLBACK');
      await pending?.catch(() => {});
      await second.query('ROLLBACK');
      first.release();
      second.release();
    }
  }

  for (const match of ['email', 'name'] as const) {
    for (const field of ['external_ref', 'notes'] as const) {
      for (const source of ['sync', 'ai'] as const) {
        it(`H16 ${match}: människans ${field} och ursprung överlever överlappande ${source}`, async () => {
          await overlappingPersonWrite(match, field, source, 'human');
        });
      }
    }
  }
  for (const field of ['external_ref', 'notes'] as const) {
    it(`H17 negativ kontroll: överlappande agent får ändra synkens ${field}`, async () => {
      await overlappingPersonWrite('email', field, 'ai', 'sync');
    });
  }
});

describe('intagets kvitto för skyddade händelsefält', () => {
  it('I1 människans sammanfattning står, tre andra fält följer källan och bara summary redovisas', async () => {
    const e = mail('gmail:i1', 'Ursprungsbolaget I1 AB');
    await ingest([e]);
    const row = await eventRow(e.source_ref);
    await tenant((c) => recordProvenance(c, companyId, user.userId, { interaction_id: row.id }, [{ field: 'summary', source: 'human' }]));
    const r = await ingest([{ ...e, summary: 'Ny sammanfattning från källan', channel: 'meeting', direction: 'outbound', occurred_at: '2026-06-11T10:00:00Z' }]);
    const after = await eventRow(e.source_ref);
    expect(after).toMatchObject({ summary: 'Ursprunglig sammanfattning', channel: 'meeting', direction: 'outbound' });
    expect(new Date(after.occurred_at).toISOString()).toBe('2026-06-11T10:00:00.000Z');
    expect(r.interactions_unchanged).toBe(1);
    expect(r.kept_human_fields.filter((s) => s.includes(': gmail:i1 '))).toEqual(['Ursprungsbolaget I1 AB: gmail:i1 summary']);
    expect((await origins(row.id)).find((p) => p.field === 'summary')?.source).toBe('human');
    const audit = await withAdmin(async (c) => (await c.query(`SELECT details FROM crm.audit_log
      WHERE company_id=$1 AND entity_id=$2 AND action='crm.interaction_updated' ORDER BY occurred_at DESC,id DESC LIMIT 1`, [companyId, row.id])).rows[0]);
    expect(audit.details).toEqual({ source_system: 'gmail', kept_human_fields: ['summary'] });
  });

  it('I1a utan organisation använder båda händelseslagen personens namn som prefix', async () => {
    for (const [ref, kind, field] of [
      ['gmail:i1-person', 'interaction', 'summary'], ['linear:LOC-i1-person', 'commitment', 'body'],
    ] as const) {
      const e = kind === 'interaction' ? mail(ref) : promiseEvent(ref);
      const { organization: omitted, ...withoutOrg } = e;
      const input = { ...withoutOrg, person: { name: 'Ensam I1', email: 'ensam-i1@example.se' } };
      await ingest([input]);
      const row = await eventRow(ref, kind);
      await tenant((c) => recordProvenance(c, companyId, user.userId,
        kind === 'interaction' ? { interaction_id: row.id } : { commitment_id: row.id }, [{ field, source: 'human' }]));
      const r = await ingest([{ ...input, [field]: 'Källans nya text' }]);
      expect(r.kept_human_fields.filter((x) => x.includes(`: ${ref} `))).toEqual([`Ensam I1: ${ref} ${field}`]);
    }
  });
  it('I1b efter aliasomstyrning kommer prefixet från organisationen som tog emot skrivningen', async () => {
    const org = await organization('Kvarvarande I1 AB');
    await withAdmin((c) => c.query(`INSERT INTO crm.organization_name_aliases (company_id,name,organization_id)
      VALUES ($1,'Tidigare I1 AB',$2)`, [companyId, org]));
    const e = mail('gmail:i1-alias', 'Tidigare I1 AB');
    await ingest([e]);
    const row = await eventRow(e.source_ref);
    await tenant((c) => recordProvenance(c, companyId, user.userId, { interaction_id: row.id }, [{ field: 'summary', source: 'human' }]));
    const r = await ingest([{ ...e, summary: 'Ny text från det gamla namnet' }]);
    expect(r.kept_human_fields.filter((x) => x.includes(': gmail:i1-alias ')))
      .toEqual(['Kvarvarande I1 AB: gmail:i1-alias summary']);
  });

  // Literalerna är facit: det skyddade fältet står kvar medan exakt de tre
  // andra följer källan. Varken fältlistor eller förväntan hämtas ur tjänsten.
  async function protectedPromise(ref: string, field: 'body' | 'direction' | 'due_date' | 'occurred_at') {
    const e = promiseEvent(ref, 'Ursprungsbolaget I2 AB');
    await ingest([e]);
    const row = await eventRow(ref, 'commitment');
    await tenant((c) => recordProvenance(c, companyId, user.userId, { commitment_id: row.id }, [{ field, source: 'human' }]));
    const r = await ingest([{ ...e, body: 'Ny löftestext', commitment_direction: 'they_owe', due_date: '2026-08-02', occurred_at: '2026-06-11T10:00:00Z' }]);
    const after = await eventRow(ref, 'commitment');
    expect({ body: after.body, direction: after.direction, due_date: after.due_date, occurred_at: new Date(after.occurred_at).toISOString() })
      .toEqual({
        body: field === 'body' ? 'Ursprunglig löftestext' : 'Ny löftestext',
        direction: field === 'direction' ? 'we_owe' : 'they_owe',
        due_date: field === 'due_date' ? '2026-07-01' : '2026-08-02',
        occurred_at: field === 'occurred_at' ? '2026-06-10T09:14:00.000Z' : '2026-06-11T10:00:00.000Z',
      });
    expect(r.commitments_unchanged).toBe(1);
    expect(r.kept_human_fields.filter((s) => s.includes(`: ${ref} `))).toEqual([`Ursprungsbolaget I2 AB: ${ref} ${field}`]);
    expect((await origins(null, row.id)).find((p) => p.field === field)?.source).toBe('human');
  }
  it('I2 löftets body skyddas för sig', async () => { await protectedPromise('linear:LOC-1', 'body'); });
  it('I3 löftets direction skyddas för sig', async () => { await protectedPromise('linear:LOC-2', 'direction'); });
  it('I4 löftets due_date skyddas för sig', async () => { await protectedPromise('linear:LOC-3', 'due_date'); });
  it('I5 löftets occurred_at skyddas för sig', async () => { await protectedPromise('linear:LOC-4', 'occurred_at'); });
  it('I6 agenten får fortfarande inte bekräfta ett organisationsfält', async () => {
    const org = await organization('I6 AB');
    const before = await tenant((c) => readProvenance(c, companyId, { organization_id: org }));
    const r = await action('confirm_crm_value', { organization_id: org, field: 'name' }, agentToken);
    expect(r.status, JSON.stringify(r.body)).toBe(403);
    expect(r.body.error).toBe('human_confirmation_required');
    expect(await tenant((c) => readProvenance(c, companyId, { organization_id: org }))).toEqual(before);
  });
});
