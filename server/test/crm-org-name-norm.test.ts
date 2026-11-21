// FR-14/FR-30 b: två stavningar får samma jämförelsenyckel och en projektkod
// får ingen relation utan kund. Prövar databas, åtgärd, intag och befintlig vy.
import pg from 'pg';
import supertest from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { loadMigrations, migrate, type MigrationFile } from '../src/db/migrate.js';
import { withTenantTransaction } from '../src/db/tx.js';
import { api, app, createCompany, registerUser, withAdmin, type TestUser } from './helpers.js';
import { upsertOrganization, saveOrganizationDistinction } from '../src/services/crmRelations.js';
import { queueNameVariantProposal } from '../src/services/crmIngest.js';
import { explainApproval } from '../src/services/approvalSummary.js';
import { acceptNameVariant, rejectNameVariant } from '../src/services/crmMerge.js';

const PASSWORD = 'mycket-hemligt-losen-123';
let user: TestUser;
let granne: TestUser;
let companyId: string;
let grannbolag: string;
let agentToken: string;
let ua: ReturnType<typeof supertest.agent>;

beforeAll(async () => {
  user = await registerUser('namnnorm');
  companyId = await createCompany(user.token, 'Namnnorm A');
  granne = await registerUser('namnnorm-granne');
  grannbolag = await createCompany(granne.token, 'Namnnorm B');
  ua = supertest.agent(app);
  const login = await ua.post('/app/login').type('form').send({ email: user.email, password: PASSWORD });
  expect(login.status, login.text).toBe(302);
  const token = await api.post(`/api/companies/${companyId}/agent-tokens`)
    .set('Authorization', `Bearer ${user.token}`).send({ name: 'synk' });
  expect(token.status, JSON.stringify(token.body)).toBe(201);
  agentToken = token.body.token;
});

const act = (namn: string, indata: Record<string, unknown>) =>
  api.post(`/api/companies/${companyId}/actions/${namn}`).set('Authorization', `Bearer ${user.token}`).send(indata);
const agentAct = (namn: string, indata: Record<string, unknown>) =>
  api.post(`/api/companies/${companyId}/actions/${namn}`).set('Authorization', `Bearer ${agentToken}`).send(indata);
async function ingest(handelser: Record<string, unknown>[]) {
  const r = await agentAct('ingest_crm_events', { events: handelser });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body.result;
}
const kontaktpunkt = (orgNamn: string, nyckel: string) => ({
  kind: 'interaction', organization: { name: orgNamn }, occurred_at: '2026-08-14T08:00:00Z',
  channel: 'email', direction: 'inbound', summary: 'En kontakt om samarbetet.',
  source_system: 'gmail', source_ref: nyckel,
});
const lofte = (orgNamn: string, person: { name: string; email: string }, nyckel: string) => ({
  kind: 'commitment', organization: { name: orgNamn }, person, occurred_at: '2026-08-14T08:00:00Z',
  source_system: 'linear', source_ref: nyckel, commitment_direction: 'they_owe', body: 'De återkommer med underlaget.',
});
async function normalisera(text: string) {
  return withAdmin(async (db) => (await db.query<{ n: string }>(
    'SELECT crm.normalize_org_name($1) AS n', [text])).rows[0]!.n);
}
async function orgRad(id: string) {
  return withAdmin(async (db) => (await db.query<{ rad: Record<string, unknown> }>(
    'SELECT to_jsonb(o) AS rad FROM crm.organizations o WHERE company_id = $1 AND id = $2',
    [companyId, id])).rows[0]!.rad);
}
async function antal(sql: string, parametrar: unknown[]) {
  return withAdmin(async (db) => (await db.query<{ n: number }>(sql, parametrar)).rows[0]!.n);
}

interface CatalogRow { id: string; definition: unknown }
type Catalog = Record<string, CatalogRow[]>;
/** Åtta slutna kataloglistor. Facit för tillåtna ändringar står i M4. */
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

async function nyMigration(): Promise<MigrationFile> {
  const matches = (await loadMigrations()).filter((m) => m.name === 'crm_org_name_norm');
  expect(matches, 'exakt en migration crm_org_name_norm ska finnas').toHaveLength(1);
  return matches[0]!;
}

describe('migrationen och normaliseringen (story 2.2)', () => {
  it('M1 en enda strikt immutable SQL-funktion text till text', async () => {
    const r = await withAdmin((db) => db.query(`SELECT p.provolatile, p.proisstrict, l.lanname,
      format_type(p.prorettype, NULL) AS result, pg_get_function_identity_arguments(p.oid) AS arguments
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      JOIN pg_language l ON l.oid = p.prolang WHERE n.nspname = 'crm' AND p.proname = 'normalize_org_name'`));
    expect(r.rows).toEqual([{ provolatile: 'i', proisstrict: true, lanname: 'sql', result: 'text', arguments: 'name text' }]);
  });

  it('M2 lagrad genererad textkolumn och exakt ett icke-unikt index', async () => {
    await withAdmin(async (db) => {
      const columns = await db.query(`SELECT data_type, is_generated, generation_expression
        FROM information_schema.columns WHERE table_schema = 'crm' AND table_name = 'organizations' AND column_name = 'name_norm'`);
      expect(columns.rows).toHaveLength(1);
      expect(columns.rows[0]).toMatchObject({ data_type: 'text', is_generated: 'ALWAYS' });
      expect(columns.rows[0]!.generation_expression).toContain('normalize_org_name(name)');
      expect((await db.query(`SELECT attgenerated FROM pg_attribute
        WHERE attrelid = 'crm.organizations'::regclass AND attname = 'name_norm'`)).rows).toEqual([{ attgenerated: 's' }]);
      expect((await db.query(`SELECT indexdef FROM pg_indexes WHERE schemaname = 'crm'
        AND indexname = 'organizations_name_norm_idx'`)).rows).toEqual([
        { indexdef: 'CREATE INDEX organizations_name_norm_idx ON crm.organizations USING btree (company_id, name_norm)' },
      ]);
      expect((await db.query(`SELECT indisunique FROM pg_index
        WHERE indexrelid = 'crm.organizations_name_norm_idx'::regclass`)).rows).toEqual([{ indisunique: false }]);
    });
  });

  it('M3 kedjan igen kör ingen migration och registrerar namnet en gång', async () => {
    expect((await migrate(process.env.DATABASE_ADMIN_URL!)).applied).toEqual([]);
    expect(await antal("SELECT count(*)::int AS n FROM schema_migrations WHERE name = 'crm_org_name_norm'", [])).toBe(1);
  });

  describe('befintliga rader i en egen databas', () => {
    const database = 'redovisning_test_org_name_norm';
    let db: pg.Client | undefined;
    let migration: MigrationFile;
    let foreKatalog: Catalog;
    let efterKatalog: Catalog;
    let foreData: { rad: Record<string, unknown> }[];
    let egetBolag: string;
    async function maintenance(sql: string) {
      const client = new pg.Client({ connectionString: process.env.MAINTENANCE_DATABASE_URL });
      await client.connect();
      try { await client.query(sql); } finally { await client.end(); }
    }
    async function apply(sql: string) {
      await db!.query('BEGIN');
      try { await db!.query(sql); await db!.query('COMMIT'); }
      catch (err) { await db!.query('ROLLBACK'); throw err; }
    }
    async function data(utanNorm = false) {
      return (await db!.query<{ rad: Record<string, unknown> }>(
        `SELECT ${utanNorm ? "to_jsonb(o) - 'name_norm'" : 'to_jsonb(o)'} AS rad
         FROM crm.organizations o WHERE company_id = $1 ORDER BY id`, [egetBolag])).rows;
    }
    async function objectIds() {
      return (await db!.query(`SELECT oid::text AS id FROM pg_proc WHERE oid = 'crm.normalize_org_name(text)'::regprocedure
        UNION ALL SELECT oid::text AS id FROM pg_class WHERE oid = 'crm.organizations_name_norm_idx'::regclass
        UNION ALL SELECT attnum::text AS id FROM pg_attribute
        WHERE attrelid = 'crm.organizations'::regclass AND attname = 'name_norm' ORDER BY id`)).rows;
    }
    beforeAll(async () => {
      migration = await nyMigration();
      await maintenance(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
      await maintenance(`CREATE DATABASE ${database}`);
      const url = new URL(process.env.DATABASE_ADMIN_URL!);
      url.pathname = `/${database}`;
      db = new pg.Client({ connectionString: url.toString() });
      await db.connect();
      for (const m of (await loadMigrations()).filter((m) => m.version < migration.version)) await apply(m.sql);
      egetBolag = (await db.query<{ id: string }>("INSERT INTO companies (name) VALUES ('Migrationens bolag') RETURNING id")).rows[0]!.id;
      for (const name of ['Alliance Optikk AS', 'Alliance Optikk', 'LEG-001', 'Bolaget AB (publ)', 'AB Volvo', 'Raderad (GDPR) 1234abcd']) {
        await db.query('INSERT INTO crm.organizations (company_id, name) VALUES ($1,$2)', [egetBolag, name]);
      }
      foreData = await data();
      foreKatalog = await catalog(db);
      await apply(migration.sql);
      efterKatalog = await catalog(db);
    });
    afterAll(async () => {
      if (db) await db.end();
      await maintenance(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
    });

    it('M4 fyller bara jämförelsenyckeln och katalogen följer tillåtelselistan', async () => {
      expect((await db!.query(`SELECT name, name_norm FROM crm.organizations WHERE company_id = $1 ORDER BY name`, [egetBolag])).rows).toEqual([
        { name: 'AB Volvo', name_norm: 'ab volvo' },
        { name: 'Alliance Optikk', name_norm: 'alliance optikk' },
        { name: 'Alliance Optikk AS', name_norm: 'alliance optikk' },
        { name: 'Bolaget AB (publ)', name_norm: 'bolaget' },
        { name: 'LEG-001', name_norm: 'leg-001' },
        { name: 'Raderad (GDPR) 1234abcd', name_norm: 'raderad (gdpr) 1234abcd' },
      ]);
      expect(await data(true)).toEqual(foreData);
      const oforandrad = { added: [], removed: [], changed: [] };
      const facit = {
        functions: { added: ['crm.normalize_org_name(name text)'], removed: [], changed: [] },
        columns: { added: ['organizations.name_norm'], removed: [], changed: [] },
        indexes: { added: ['organizations_name_norm_idx'], removed: [], changed: [] },
        constraints: oforandrad, triggers: oforandrad, policies: oforandrad, privileges: oforandrad, schemas: oforandrad,
      };
      expect(catalogDiff(foreKatalog, efterKatalog)).toEqual(facit);
      expect(efterKatalog.columns!.find((r) => r.id === 'organizations.name_norm'))
        .toEqual({ id: 'organizations.name_norm', definition: { type: 'text', nullable: 'YES' } });
      const planterad = { ...efterKatalog, indexes: [...efterKatalog.indexes!, { id: 'organizations.extra', definition: 'extra' }] };
      expect(catalogDiff(foreKatalog, planterad)).not.toEqual(facit);
      expect(catalogDiff(efterKatalog, planterad).indexes).toEqual({ added: ['organizations.extra'], removed: [], changed: [] });
    });

    it('M5 SQL en andra gång behåller oid, kolumnnummer, katalog och data', async () => {
      const ids = await objectIds();
      expect(ids).toHaveLength(3);
      const rader = await data();
      await apply(migration.sql);
      expect(await objectIds()).toEqual(ids);
      expect(await catalog(db!)).toEqual(efterKatalog);
      expect(await data()).toEqual(rader);
    });
  });

  it('N1 kriteriets sju namn har literalt facit och varianterna är lika', async () => {
    const fall = [
      ['Alliance Optikk AS', 'alliance optikk'], ['alliance  optikk', 'alliance optikk'],
      ['Optikko Kivinen Oy', 'optikko kivinen'], ['Independent Optical Group Nordics ApS', 'independent optical group nordics'],
      ['Bolaget AB (publ)', 'bolaget'], ['Firma A/S', 'firma'], ['Nordic GmbH', 'nordic'],
    ] as const;
    for (const [name, facit] of fall) expect(await normalisera(name), name).toBe(facit);
    expect(await normalisera('Alliance Optikk AS')).toBe(await normalisera('alliance  optikk'));
  });

  it('N2 behåller ord och tar bara sista formen efter hopslagna blanktecken', async () => {
    const fall = [
      ['ABBA', 'abba'], ['Absolut Vodka', 'absolut vodka'], ['AB Volvo', 'ab volvo'], ['Kbab Bygg', 'kbab bygg'],
      ['AB', 'ab'], ['Dubbel AB AB', 'dubbel ab'], ['Optikk ASA', 'optikk'], ['Optikk AS', 'optikk'],
      ['\tAlliance\nOptikk  AS ', 'alliance optikk'],
    ] as const;
    for (const [name, facit] of fall) expect(await normalisera(name), name).toBe(facit);
    const lower = await withAdmin(async (db) => (await db.query<{ n: string }>("SELECT lower('Åkeriet Öst') AS n")).rows[0]!.n);
    expect(await normalisera('Åkeriet Öst AB')).toBe(lower);
  });

  const former = ['AB', 'AB (publ)', 'HB', 'KB', 'AS', 'ASA', 'A/S', 'ApS', 'Oy', 'Oyj', 'GmbH', 'Ltd', 'Limited', 'Inc', 'LLC', 'BV', 'NV'];
  it.each(former)('N3 %s tas bort i två skiftlägen', async (form) => {
    expect(await normalisera(`Formbolaget ${form}`)).toBe('formbolaget');
    expect(await normalisera(`Formbolaget ${form.toUpperCase()}`)).toBe('formbolaget');
  });

  it('N4 kolumnen följer INSERT och UPDATE och kan inte skrivas direkt', async () => {
    const skapad = await act('upsert_crm_organization', { name: 'Kolumnbolaget AS' });
    expect(skapad.status, JSON.stringify(skapad.body)).toBe(200);
    const id = skapad.body.result.id as string;
    expect((await orgRad(id)).name_norm).toBe('kolumnbolaget');
    const andrad = await act('upsert_crm_organization', { organization_id: id, name: 'Kolumnbolaget Nordic AB' });
    expect(andrad.status, JSON.stringify(andrad.body)).toBe(200);
    expect((await orgRad(id)).name_norm).toBe('kolumnbolaget nordic');
    expect(skapad.body.result).not.toHaveProperty('name_norm');
    expect(andrad.body.result).not.toHaveProperty('name_norm');
    await expect(withAdmin((db) => db.query(`INSERT INTO crm.organizations (company_id, name, name_norm)
      VALUES ($1,'Skrivskyddet AS','egen nyckel')`, [companyId]))).rejects.toMatchObject({ code: '428C9' });
  });

  it('N5 grupperar på bolag och normaliserat namn utan att blanda grannen', async () => {
    await withAdmin(async (db) => {
      await db.query(`INSERT INTO crm.organizations (company_id, name) VALUES
        ($1,'Gruppbolaget'), ($1,'Gruppbolaget AS'), ($2,'Gruppbolaget')`, [companyId, grannbolag]);
      expect((await db.query(`SELECT company_id, name_norm, count(*)::int AS n FROM crm.organizations
        WHERE company_id = ANY($1::uuid[]) GROUP BY company_id, name_norm HAVING count(*) > 1`, [[companyId, grannbolag]])).rows)
        .toEqual([{ company_id: companyId, name_norm: 'gruppbolaget', n: 2 }]);
    });
  });

  it('N6 grannen som app kan inte läsa kolumnen i bolag A', async () => {
    await withTenantTransaction(granne.userId, grannbolag, async (db) => {
      expect((await db.query('SELECT current_user AS role')).rows).toEqual([{ role: 'app' }]);
      expect((await db.query('SELECT name_norm FROM crm.organizations WHERE company_id = $1', [companyId])).rows).toEqual([]);
    });
  });
});

const projektkodstext = (name: string) => `«${name}» är en projektkod, inte ett organisationsnamn — skriv bolagets namn.`;
const antalOrganisationer = () => antal('SELECT count(*)::int AS n FROM crm.organizations WHERE company_id = $1', [companyId]);
const antalSkapandeAudit = () => antal("SELECT count(*)::int AS n FROM crm.audit_log WHERE company_id = $1 AND action = 'crm.organization_created'", [companyId]);
async function nyOrganisation(name: string) {
  const r = await act('upsert_crm_organization', { name });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body.result.id as string;
}

describe('projektkodsspärren (story 2.2)', () => {
  it('S1 hoppar över mittlöftet utan organisation, person eller löfte men skriver resten', async () => {
    const r = await ingest([
      kontaktpunkt('Spärrbolaget AB', 'gmail:sparr-0'),
      lofte('NVR-001', { name: 'Spärrperson', email: 'sparr@nvr.example' }, 'linear:SPARR-1'),
      kontaktpunkt('Spärrbolaget AB', 'gmail:sparr-2'),
    ]);
    expect(r.skipped).toEqual([{ index: 1, reason: projektkodstext('NVR-001') }]);
    expect(r).toMatchObject({ interactions_created: 2, commitments_created: 0, organizations_created: 1,
      people_created: 0, unlinked_organizations: ['Spärrbolaget AB'] });
    expect(await antal("SELECT count(*)::int AS n FROM crm.organizations WHERE company_id = $1 AND lower(name) = 'nvr-001'", [companyId])).toBe(0);
    expect(await antal("SELECT count(*)::int AS n FROM crm.people WHERE company_id = $1 AND email = 'sparr@nvr.example'", [companyId])).toBe(0);
    expect(await antal("SELECT count(*)::int AS n FROM crm.commitments WHERE company_id = $1 AND source_ref = 'linear:SPARR-1'", [companyId])).toBe(0);
    expect(await antal(`SELECT count(*)::int AS n FROM crm.interactions i JOIN crm.organizations o
      ON o.id = i.organization_id AND o.company_id = i.company_id WHERE i.company_id = $1 AND o.name = 'Spärrbolaget AB'`, [companyId])).toBe(2);
  });

  const anrop = [
    { actor: 'human', input: { name: 'NVR-001' } },
    { actor: 'agent', input: { name: 'NVR-001' } },
    { actor: 'human', input: { name: '  ÅÄÖ-999  ' } },
    { actor: 'agent', input: { name: 'ILT-123', org_number: '556914-0009' } },
  ] as const;
  it.each(anrop)('S2 $actor avvisas för $input.name utan organisation eller skapandeaudit', async ({ actor, input }) => {
    const orgFore = await antalOrganisationer();
    const auditFore = await antalSkapandeAudit();
    const r = await (actor === 'human' ? act : agentAct)('upsert_crm_organization', input);
    expect(r.status, JSON.stringify(r.body)).toBe(400);
    expect(r.body).toEqual({ error: 'project_code_as_name' });
    expect(await antalOrganisationer()).toBe(orgFore);
    expect(await antalSkapandeAudit()).toBe(auditFore);
  });

  it('S3 Ny relation och Rätta uppgifter visar felet i befintlig notis', async () => {
    const bas = `/app/c/${companyId}/relations`;
    const skapad = await ua.post(`${bas}/create`).type('form').send({ name: 'NVR-001' });
    expect(skapad.status, skapad.text).toBe(302);
    const adress = new URL(skapad.headers.location!, 'http://localhost');
    expect(adress.pathname).toBe(bas);
    expect(adress.searchParams.get('fel')).toBe(projektkodstext('NVR-001'));
    const sidan = await ua.get(skapad.headers.location!);
    expect(sidan.status, sidan.text).toBe(200);
    expect(sidan.text).toMatch(/<p class="notice">[^<]*är en projektkod, inte ett organisationsnamn/);
    expect(await antal("SELECT count(*)::int AS n FROM crm.organizations WHERE company_id = $1 AND name = 'NVR-001'", [companyId])).toBe(0);
    const id = await nyOrganisation('Rättelsebolaget AB');
    const andrad = await ua.post(`${bas}/${id}/edit`).type('form')
      .send({ name: 'NVR-002', fore_name: 'Rättelsebolaget AB' });
    expect(andrad.status, andrad.text).toBe(302);
    const tillbaka = new URL(andrad.headers.location!, 'http://localhost');
    expect(tillbaka.pathname).toBe(`${bas}/${id}`);
    expect(tillbaka.searchParams.get('fel')).toBe(projektkodstext('NVR-002'));
    expect((await orgRad(id)).name).toBe('Rättelsebolaget AB');
  });

  it('S4 en äldre projektkodsrad får rättas och döpas om men får ingen ny händelse eller projektkod', async () => {
    const id = await withAdmin(async (db) => (await db.query<{ id: string }>(
      "INSERT INTO crm.organizations (company_id, name) VALUES ($1,'LEG-001') RETURNING id", [companyId])).rows[0]!.id);
    const fore = await orgRad(id);
    const r = await ingest([kontaktpunkt('LEG-001', 'gmail:leg-1')]);
    expect(r.skipped).toEqual([{ index: 0, reason: projektkodstext('LEG-001') }]);
    expect(await orgRad(id)).toEqual(fore);
    expect(await antal('SELECT count(*)::int AS n FROM crm.interactions WHERE company_id = $1 AND organization_id = $2', [companyId, id])).toBe(0);
    const rattad = await act('upsert_crm_organization', { organization_id: id, org_number: '556914-0010' });
    expect(rattad.status, JSON.stringify(rattad.body)).toBe(200);
    expect(await orgRad(id)).toMatchObject({ name: 'LEG-001', org_number: '556914-0010' });
    const namnbyte = await act('upsert_crm_organization', { organization_id: id, name: 'Legacybolaget AB' });
    expect(namnbyte.status, JSON.stringify(namnbyte.body)).toBe(200);
    expect(await orgRad(id)).toMatchObject({ name: 'Legacybolaget AB', name_norm: 'legacybolaget' });
    const tillbaka = await agentAct('upsert_crm_organization', { organization_id: id, name: 'LEG-001' });
    expect(tillbaka.status, JSON.stringify(tillbaka.body)).toBe(400);
    expect(tillbaka.body).toEqual({ error: 'project_code_as_name' });
    expect((await orgRad(id)).name).toBe('Legacybolaget AB');
  });

  it('S5 spärren går före aliaset och styr inte om händelsen', async () => {
    const id = await nyOrganisation('Aliasbolaget AB');
    await withAdmin((db) => db.query(`INSERT INTO crm.organization_name_aliases (company_id, name, organization_id)
      VALUES ($1,'ALI-001',$2)`, [companyId, id]));
    const r = await ingest([kontaktpunkt('ALI-001', 'gmail:ali-1')]);
    expect(r.skipped).toEqual([{ index: 0, reason: projektkodstext('ALI-001') }]);
    expect(r.redirected_organizations).toEqual([]);
    expect(await antal('SELECT count(*)::int AS n FROM crm.interactions WHERE company_id = $1 AND organization_id = $2', [companyId, id])).toBe(0);
  });

  it('S6 negativ kontroll: namn nära mönstret skrivs som vanligt', async () => {
    const r = await ingest(['NVR-0012', 'nvr-001', 'ILT-Education'].map((name, i) => kontaktpunkt(name, `gmail:negativ-${i}`)));
    expect(r.skipped).toEqual([]);
    expect(r.organizations_created).toBe(3);
    expect(r.interactions_created).toBe(3);
  });
});

describe('dokumenten (story 2.2)', () => {
  it('D1 beskriver avvisningen och jämförelsenyckeln i avgränsade avsnitt', async () => {
    const document = await readFile(new URL('../../docs/MCP_ACTIONS.md', import.meta.url), 'utf8');
    const heading = '## Projektkoder och normaliserat namn (crm 2.2)';
    expect(document.split(heading)).toHaveLength(2);
    const start = document.indexOf(heading);
    expect(start).toBeGreaterThan(document.indexOf('## Statusen vid kundkoppling och sammanslagning (crm 1.6)'));
    const rest = document.slice(start + heading.length);
    const section = rest.split('\n## ')[0]!;
    expect(section).not.toMatch(/^### /m);
    for (const term of ['upsert_crm_organization', 'ingest_crm_events', 'project_code_as_name', 'skipped', 'name_norm', 'crm.normalize_org_name']) {
      expect(section, term).toContain('`' + term + '`');
    }
    const contract = await readFile(new URL('../../docs/crm/API_KONTRAKT.md', import.meta.url), 'utf8');
    const regler = contract.split('## De fyra reglerna\n')[1]?.split('\n## ')[0];
    for (const term of ['project_code_as_name', 'skipped', String.raw`^[A-ZÅÄÖ]{2,6}-\d{3}$`]) expect(regler, term).toContain(term);
    const kadens = contract.split('## Kadens, dubbletter och sökning\n')[1]?.split('\n## ')[0];
    for (const term of ['name_norm', 'crm.normalize_org_name']) expect(kadens, term).toContain(term);
  });
});

describe('namnkrocken i svaret (story 2.1)', () => {
  let alfa: string;
  let beta: string;
  let delta: string;
  let epsilon: string;
  let zeta: string;
  let theta: string;
  let eta: string;
  let kund21: string;
  let kund22: string;
  let gamma: string;
  const saknas = '9f1c2d3e-4b5a-4c6d-8e7f-0a1b2c3d4e5f';
  async function skapaRelation(name: string, customer_id?: string) {
    const r = await act('upsert_crm_organization', { name, ...(customer_id ? { customer_id } : {}) });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    return r.body.result.id as string;
  }
  async function skapaKund(name: string) {
    const r = await act('create_customer', { name });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    return r.body.result.id as string;
  }
  function kravNamnkrock(kropp: unknown, krockId: string) {
    expect(kropp).toEqual({ error: 'name_taken', details: {
      organization_id: krockId, merge_action: 'merge_crm_organizations',
    } });
  }
  beforeAll(async () => {
    alfa = await skapaRelation('Alfa AB');
    beta = await skapaRelation('Beta AB');
    delta = await skapaRelation('Delta AB');
    epsilon = await skapaRelation('Epsilon AB');
    zeta = await skapaRelation('Zeta AB');
    theta = await skapaRelation('Theta AB');
    kund21 = await skapaKund('Kopplingskunden 21 AB');
    kund22 = await skapaKund('Kopplingskunden 22 AB');
    eta = await skapaRelation('Eta AB', kund22);
    const r = await api.post(`/api/companies/${grannbolag}/actions/upsert_crm_organization`)
      .set('Authorization', `Bearer ${granne.token}`).send({ name: 'Gamma AB' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    gamma = r.body.result.id;
  });

  it('K1 människans namnbyte ger exakt krocksvaret och lämnar hela raden orörd', async () => {
    const fore = await orgRad(beta);
    const r = await act('upsert_crm_organization', { organization_id: beta, name: 'alfa ab' });
    expect(r.status, JSON.stringify(r.body)).toBe(400);
    kravNamnkrock(r.body, alfa);
    expect(await orgRad(beta)).toEqual(fore);
  });
  it('K2 agentnyckelns REST-anrop som MCP använder ger samma kropp utan skrivning', async () => {
    const fore = await orgRad(beta);
    const r = await agentAct('upsert_crm_organization', { organization_id: beta, name: 'ALFA AB' });
    expect(r.status, JSON.stringify(r.body)).toBe(400);
    kravNamnkrock(r.body, alfa);
    expect(await orgRad(beta)).toEqual(fore);
  });
  it('K3 andra fel behåller sina egna kroppar och ger ingen sammanslagningsväg', async () => {
    const fore = await Promise.all([beta, eta, theta].map(orgRad));
    const fall = [
      [{ organization_id: beta }, 400, { error: 'nothing_to_update' }],
      [{ organization_id: beta, name: '   ' }, 400, { error: 'invalid_name' }],
      [{ organization_id: saknas, name: 'Alfa AB' }, 404, { error: 'not_found' }],
      [{ organization_id: beta, name: 'ALF-001' }, 400, { error: 'project_code_as_name' }],
      [{ organization_id: beta, okand: 1 }, 400, { error: 'validation_error', details: [
        { path: '', message: "Unrecognized key(s) in object: 'okand'" },
      ] }],
      [{ organization_id: eta, org_number: '556914-2101' }, 400, { error: 'org_number_on_customer',
        details: { customer_id: kund22, update_action: 'update_customer' } }],
      [{ organization_id: theta, customer_id: kund22 }, 409, { error: 'customer_already_linked',
        details: { organization_id: eta } }],
    ] as const;
    for (const [input, status, kropp] of fall) {
      const r = await act('upsert_crm_organization', input);
      expect(r.status, JSON.stringify(r.body)).toBe(status);
      expect(r.body).toEqual(kropp);
      expect(JSON.stringify(r.body)).not.toContain('merge_action');
    }
    expect(await Promise.all([beta, eta, theta].map(orgRad))).toEqual(fore);
  });
  it('K4 ett ledigt namn sparas', async () => {
    const r = await act('upsert_crm_organization', { organization_id: delta, name: 'Delta Nordic AB' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect((await orgRad(delta)).name).toBe('Delta Nordic AB');
  });
  it('K5 kundkoppling utan namnbyte behåller namnet', async () => {
    const r = await act('upsert_crm_organization', { organization_id: epsilon, customer_id: kund21 });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(await orgRad(epsilon)).toMatchObject({ name: 'Epsilon AB', customer_id: kund21 });
  });
  it('K6 grannbolagets namn krockar inte och inget grannid lämnas ut', async () => {
    const r = await act('upsert_crm_organization', { organization_id: zeta, name: 'Gamma AB' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect((await orgRad(zeta)).name).toBe('Gamma AB');
    expect(JSON.stringify(r.body)).not.toContain(gamma);
    const grannrad = await withAdmin((db) => db.query(
      'SELECT name FROM crm.organizations WHERE company_id = $1 AND id = $2', [grannbolag, gamma]));
    expect(grannrad.rows).toEqual([{ name: 'Gamma AB' }]);
  });
  it('K7 negativ kontroll fäller saknade details, saknad åtgärd och fel relation', () => {
    expect(() => kravNamnkrock({ error: 'name_taken' }, alfa)).toThrow();
    expect(() => kravNamnkrock({ error: 'name_taken', details: { organization_id: alfa } }, alfa)).toThrow();
    expect(() => kravNamnkrock({ error: 'name_taken', details: {
      organization_id: beta, merge_action: 'merge_crm_organizations',
    } }, alfa)).toThrow();
    expect(() => kravNamnkrock({ error: 'name_taken', details: {
      organization_id: alfa, merge_action: 'merge_crm_organizations',
    } }, alfa)).not.toThrow();
  });
});

describe('namnkrocken i vyn (story 2.1)', () => {
  let alfaVy: string;
  let betaVy: string;
  let iota: string;
  let gammaVy: string;
  let sidan: string;
  const feltext = 'en annan organisation heter redan så — slå ihop dem i stället';
  async function skapaVyrelation(name: string) {
    const r = await act('upsert_crm_organization', { name });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    return r.body.result.id as string;
  }
  function notistext(markup: string) {
    return (markup.match(/<p class="notice">([\s\S]*?)<\/p>/)?.[1] ?? '')
      .replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
  }
  function ogiltigFraga(parameter: string, fall: string) {
    const varden: Record<string, string> = {
      text: 'inte-ett-id', eget: betaVy, granne: gammaVy,
      saknas: '9f1c2d3e-4b5a-4c6d-8e7f-0a1b2c3d4e5f', tomt: '',
    };
    return fall === 'dubbelt' ? `${parameter}=${alfaVy}&${parameter}=${alfaVy}` : `${parameter}=${varden[fall]}`;
  }
  beforeAll(async () => {
    alfaVy = await skapaVyrelation('Alfa Vy AB');
    betaVy = await skapaVyrelation('Beta Vy AB');
    iota = await skapaVyrelation('Iota AB');
    const r = await api.post(`/api/companies/${grannbolag}/actions/upsert_crm_organization`)
      .set('Authorization', `Bearer ${granne.token}`).send({ name: 'Gamma Vy AB' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    gammaVy = r.body.result.id;
    sidan = `/app/c/${companyId}/relations/${betaVy}`;
  });

  it('V1 rättelsens krock visar en enda namngiven notis med länk och sammanslagningsknapp', async () => {
    const fore = await orgRad(betaVy);
    const r = await ua.post(`${sidan}/edit`).type('form').send({ name: 'Alfa Vy AB', fore_name: 'Beta Vy AB' });
    expect(r.status, r.text).toBe(302);
    const adress = new URL(r.headers.location!, 'http://localhost');
    expect(adress.pathname).toBe(sidan);
    expect(adress.searchParams.get('fel')).toBe(feltext);
    expect(adress.searchParams.get('krock')).toBe(alfaVy);
    const vy = await ua.get(r.headers.location!);
    expect(vy.status, vy.text).toBe(200);
    expect(vy.text.match(/<p class="notice">/g)).toHaveLength(1);
    expect(notistext(vy.text)).toBe('Namnet bärs redan av Alfa Vy AB. Två rader för samma bolag slås ihop i stället för att döpas om. Slå ihop Alfa Vy AB hit…');
    const notis = vy.text.match(/<p class="notice">([\s\S]*?)<\/p>/)?.[1] ?? '';
    expect(notis).toContain(`<a href="/app/c/${companyId}/relations/${alfaVy}">Alfa Vy AB</a>`);
    const knapp = notis.match(/<a class="btn btn--ghost btn--sm" href="([^"]+)">Slå ihop Alfa Vy AB hit…<\/a>/);
    expect(knapp?.[1]?.replace(/&amp;/g, '&')).toBe(`${sidan}?oppna=slaihop&med=${alfaVy}`);
    expect(await orgRad(betaVy)).toEqual(fore);
  });
  it('V2 negativ kontroll utan krock-id och lyckad rättelse ger ingen namnkrocksnotis', async () => {
    const r = await ua.get(`${sidan}?fel=${encodeURIComponent(feltext)}`);
    expect(r.status, r.text).toBe(200);
    expect(r.text.match(/<p class="notice">/g)).toHaveLength(1);
    expect(notistext(r.text)).toBe(feltext);
    expect(r.text).not.toContain('oppna=slaihop');
    expect(r.text).not.toContain('Namnet bärs redan av');
    const iotasida = `/app/c/${companyId}/relations/${iota}`;
    const andrad = await ua.post(`${iotasida}/edit`).type('form').send({ name: 'Iota Nordic AB', fore_name: 'Iota AB' });
    expect(andrad.status, andrad.text).toBe(302);
    const adress = new URL(andrad.headers.location!, 'http://localhost');
    expect(adress.pathname).toBe(iotasida);
    expect(adress.searchParams.has('fel')).toBe(false);
    expect(adress.searchParams.has('krock')).toBe(false);
    const nyVy = await ua.get(andrad.headers.location!);
    expect(nyVy.status, nyVy.text).toBe(200);
    expect(nyVy.text).not.toContain('Namnet bärs redan av');
    expect(nyVy.text).not.toContain('oppna=slaihop');
    expect((await orgRad(iota)).name).toBe('Iota Nordic AB');
  });
  it.each(['text', 'eget', 'granne', 'saknas', 'tomt', 'dubbelt'])('V3 krock=%s ger vanlig felnotis utan 500', async (fall) => {
    const r = await ua.get(`${sidan}?fel=${encodeURIComponent(feltext)}&${ogiltigFraga('krock', fall)}`);
    expect(r.status, r.text).toBe(200);
    expect(r.text.match(/<p class="notice">/g)).toHaveLength(1);
    expect(notistext(r.text)).toBe(feltext);
    expect(r.text).not.toContain('Namnet bärs redan av');
  });

  function dubblettBlock(markup: string) {
    const delar = markup.split('<details class="rattaform" open>');
    expect(delar).toHaveLength(2);
    const block = delar[1]!.split('</details>')[0]!;
    expect(block).toContain(`action="${sidan}/merge"`);
    expect(block).not.toContain(`action="${sidan}/edit"`);
    return block;
  }
  it('V4 adressen öppnar Dubblett med ett enda förval eller med platshållaren', async () => {
    const vald = await ua.get(`${sidan}?oppna=slaihop&med=${alfaVy}`);
    expect(vald.status, vald.text).toBe(200);
    const block = dubblettBlock(vald.text);
    expect(block.match(/ selected/g)).toHaveLength(1);
    expect(block).toContain(`<option value="${alfaVy}" selected>`);
    const tomt = await ua.get(`${sidan}?oppna=slaihop`);
    expect(tomt.status, tomt.text).toBe(200);
    expect(dubblettBlock(tomt.text)).not.toContain(' selected');
  });
  it('V5 Slå ihop köar ett känsligt förslag och lämnar båda raderna kvar', async () => {
    const vantande = () => withAdmin(async (db) => (await db.query<{ id: string; input: Record<string, unknown> }>(
      "SELECT id, input FROM action_approvals WHERE company_id = $1 AND action = 'merge_crm_organizations' AND status = 'pending' ORDER BY created_at, id",
      [companyId])).rows);
    const fore = await vantande();
    const r = await ua.post(`${sidan}/merge`).type('form').send({ merge_id: alfaVy, back: sidan });
    expect(r.status, r.text).toBe(302);
    expect(r.headers.location).toBe(`/app/c/${companyId}/approvals`);
    const vy = await ua.get(r.headers.location!);
    expect(vy.status, vy.text).toBe(200);
    const efter = await vantande();
    expect(efter).toHaveLength(fore.length + 1);
    const nya = efter.filter((rad) => !fore.some((f) => f.id === rad.id));
    expect(nya).toHaveLength(1);
    expect(nya[0]!.input).toEqual({ keep_id: betaVy, merge_id: alfaVy });
    expect((await orgRad(alfaVy)).name).toBe('Alfa Vy AB');
    expect((await orgRad(betaVy)).name).toBe('Beta Vy AB');
  });
  it.each(['text', 'eget', 'granne', 'saknas', 'tomt', 'dubbelt'])('V6 med=%s ger öppet formulär utan förval och utan 500', async (fall) => {
    const r = await ua.get(`${sidan}?oppna=slaihop&${ogiltigFraga('med', fall)}`);
    expect(r.status, r.text).toBe(200);
    expect(dubblettBlock(r.text)).not.toContain(' selected');
    const versaler = await ua.get(`${sidan}?oppna=SLAIHOP&med=${alfaVy}`);
    expect(versaler.status, versaler.text).toBe(200);
    expect(versaler.text).not.toContain('<details class="rattaform" open>');
  });

  // UUID är identiteter: samma relation får aldrig bli kandidat genom en annan stavning i adressen.
  const idFormer = ['gemener', 'versaler', 'blandat'] as const;
  function formateraId(id: string, form: typeof idFormer[number]) {
    if (form === 'gemener') return id;
    if (form === 'versaler') return id.toUpperCase();
    return id.replace(/[a-f]/g, (bokstav, index: number) => index % 2 === 0 ? bokstav.toUpperCase() : bokstav);
  }
  it.each(idFormer)('V7 eget id utesluts ur båda adressvägarna när sidans id har %s', async (sidform) => {
    for (const egetId of [alfaVy, betaVy, iota]) {
      const adress = `/app/c/${companyId}/relations/${formateraId(egetId, sidform)}`;
      for (const form of idFormer) {
        const kandidat = formateraId(egetId, form);
        const med = await ua.get(`${adress}?oppna=slaihop&med=${kandidat}`);
        expect(med.status, med.text).toBe(200);
        const oppna = med.text.split('<details class="rattaform" open>');
        expect(oppna).toHaveLength(2);
        const block = oppna[1]!.split('</details>')[0]!;
        expect(block).toContain(`action="/app/c/${companyId}/relations/${egetId}/merge"`);
        expect(block).not.toContain(' selected');
        expect(block).not.toContain(`<option value="${egetId}"`);
        expect(block).toContain('<option value="">Välj relation…</option>');
        const krock = await ua.get(`${adress}?fel=${encodeURIComponent(feltext)}&krock=${kandidat}`);
        expect(krock.status, krock.text).toBe(200);
        expect(krock.text.match(/<p class="notice">/g)).toHaveLength(1);
        expect(notistext(krock.text)).toBe(feltext);
        expect(krock.text).not.toContain('Namnet bärs redan av');
        expect(krock.text).not.toContain('oppna=slaihop');
        expect(krock.text).not.toContain(`<option value="${egetId}"`);
      }
    }
  });
  it.each(idFormer)('V8 andra relationer fungerar i båda adressvägarna när sidans id har %s', async (sidform) => {
    for (const [egetId, annatId, namn] of [[betaVy, alfaVy, 'Alfa Vy AB'], [alfaVy, betaVy, 'Beta Vy AB']] as const) {
      const adress = `/app/c/${companyId}/relations/${formateraId(egetId, sidform)}`;
      const kanonisk = `/app/c/${companyId}/relations/${egetId}`;
      for (const form of idFormer) {
        const kandidat = formateraId(annatId, form);
        const r = await ua.get(`${adress}?oppna=slaihop&med=${kandidat}&krock=${kandidat}`);
        expect(r.status, r.text).toBe(200);
        expect(r.text.match(/<p class="notice">/g)).toHaveLength(1);
        expect(notistext(r.text)).toBe(`Namnet bärs redan av ${namn}. Två rader för samma bolag slås ihop i stället för att döpas om. Slå ihop ${namn} hit…`);
        expect(r.text.replace(/&amp;/g, '&')).toContain(`href="${kanonisk}?oppna=slaihop&med=${annatId}"`);
        const oppna = r.text.split('<details class="rattaform" open>');
        expect(oppna).toHaveLength(2);
        const block = oppna[1]!.split('</details>')[0]!;
        expect(block.match(/ selected/g)).toHaveLength(1);
        expect(block).toContain(`<option value="${annatId}" selected>`);
        expect(block).not.toContain(`<option value="${egetId}"`);
      }
    }
  });
});

describe('dokumenten (story 2.1)', () => {
  it('D2 namnkrockens detaljer och sammanslagningsväg beskrivs i avgränsade avsnitt', async () => {
    const doc = await readFile(new URL('../../docs/MCP_ACTIONS.md', import.meta.url), 'utf8');
    const rubrik = '## Namnkrocken leder till sammanslagningen (crm 2.1)';
    expect(doc.split(rubrik)).toHaveLength(2);
    expect(doc.indexOf(rubrik)).toBeGreaterThan(doc.indexOf('## Kundkortets org.nr för en kopplad relation (crm 1.8)'));
    const avsnitt = doc.split(rubrik)[1]!.split('\n## ')[0]!;
    expect(avsnitt).not.toMatch(/^### /m);
    for (const term of ['upsert_crm_organization', 'name_taken', 'details', 'organization_id', 'merge_action', 'merge_crm_organizations']) {
      expect(avsnitt, term).toContain('`' + term + '`');
    }
    const kontrakt = await readFile(new URL('../../docs/crm/API_KONTRAKT.md', import.meta.url), 'utf8');
    const manniskan = kontrakt.split('## Människan vinner\n')[1]!.split('\n## ')[0]!;
    expect(manniskan).toContain('`merge_action`');
    expect(kontrakt.match(/^## Människan vinner$/gm)).toHaveLength(1);
    expect(kontrakt.match(/^## Kadens, dubbletter och sökning$/gm)).toHaveLength(1);
  });
});

describe('bolagsformsvariantens tabell (story 2.3)', () => {
  let tabellbolaget: string;
  beforeAll(async () => {
    const r = await act('upsert_crm_organization', { name: 'Tabellbolaget' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    tabellbolaget = r.body.result.id;
  });

  it('BM1 katalogen visar exakt kolumner, FK, index, RLS, policyer och privilegier', async () => {
    await withAdmin(async (db) => {
      expect((await db.query(`SELECT column_name, data_type, is_nullable FROM information_schema.columns
        WHERE table_schema = 'crm' AND table_name = 'organization_distinctions' ORDER BY ordinal_position`)).rows).toEqual([
        { column_name: 'company_id', data_type: 'uuid', is_nullable: 'NO' },
        { column_name: 'organization_id', data_type: 'uuid', is_nullable: 'NO' },
        { column_name: 'variant_name', data_type: 'text', is_nullable: 'NO' },
        { column_name: 'created_by', data_type: 'uuid', is_nullable: 'YES' },
        { column_name: 'created_at', data_type: 'timestamp with time zone', is_nullable: 'NO' },
      ]);
      expect((await db.query(`SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
        WHERE conrelid = 'crm.organization_distinctions'::regclass
        AND conname = 'organization_distinctions_organization_fk'`)).rows).toEqual([
        { definition: 'FOREIGN KEY (organization_id, company_id) REFERENCES crm.organizations(id, company_id) ON DELETE CASCADE' },
      ]);
      expect((await db.query(`SELECT indexdef FROM pg_indexes WHERE schemaname = 'crm'
        AND indexname = 'organization_distinctions_uk'`)).rows).toEqual([
        { indexdef: 'CREATE UNIQUE INDEX organization_distinctions_uk ON crm.organization_distinctions USING btree (company_id, organization_id, lower(variant_name))' },
      ]);
      expect((await db.query(`SELECT relrowsecurity, relforcerowsecurity FROM pg_class
        WHERE oid = 'crm.organization_distinctions'::regclass`)).rows).toEqual([
        { relrowsecurity: true, relforcerowsecurity: true },
      ]);
      expect((await db.query(`SELECT policyname, cmd FROM pg_policies WHERE schemaname = 'crm'
        AND tablename = 'organization_distinctions' ORDER BY policyname`)).rows).toEqual([
        { policyname: 'organization_distinctions_insert', cmd: 'INSERT' },
        { policyname: 'organization_distinctions_select', cmd: 'SELECT' },
      ]);
      for (const [verb, allowed] of [['SELECT', true], ['INSERT', true], ['UPDATE', false], ['DELETE', false]] as const) {
        expect((await db.query(`SELECT has_table_privilege('app', 'crm.organization_distinctions', $1) AS allowed`, [verb])).rows)
          .toEqual([{ allowed }]);
      }
      expect((await db.query(`SELECT obj_description('crm.organization_distinctions'::regclass, 'pg_class') AS comment`)).rows)
        .toEqual([{ comment: 'Kategori: ÄGD — Davids besked att ett namn som bara skiljer sig i bolagsform är ett annat bolag' }]);
    });
  });

  it('BM2 migrationskedjan igen gör ingenting och registrerar namnet en gång', async () => {
    expect((await migrate(process.env.DATABASE_ADMIN_URL!)).applied).toEqual([]);
    expect(await antal("SELECT count(*)::int AS n FROM schema_migrations WHERE name = 'crm_organization_distinctions'", [])).toBe(1);
  });

  it('BM3 app får infoga eget besked men varken ändra, radera eller läsa grannens', async () => {
    await withTenantTransaction(user.userId, companyId, async (c) => {
      const r = await c.query(`INSERT INTO crm.organization_distinctions
        (company_id, organization_id, variant_name, created_by) VALUES ($1,$2,$3,$4)`,
      [companyId, tabellbolaget, 'Tabellbolaget AB', user.userId]);
      expect(r.rowCount).toBe(1);
    });
    for (const sql of [
      "UPDATE crm.organization_distinctions SET variant_name = 'x' WHERE company_id = $1",
      'DELETE FROM crm.organization_distinctions WHERE company_id = $1',
    ]) {
      await expect(withTenantTransaction(user.userId, companyId, (c) => c.query(sql, [companyId])))
        .rejects.toMatchObject({ code: '42501' });
    }
    await withTenantTransaction(granne.userId, grannbolag, async (c) => {
      expect((await c.query('SELECT count(*)::int AS n FROM crm.organization_distinctions')).rows).toEqual([{ n: 0 }]);
    });
  });
});

describe('synkens bolagsformsregel (story 2.3)', () => {
  const SYNK = { source: 'sync' } as const;
  let synkbolaget: string;
  let beskedbolaget: string;
  beforeAll(async () => {
    const ids: string[] = [];
    for (const name of ['Synkbolaget', 'Tvåkandidat', 'Tvåkandidat AB', 'Beskedbolaget']) {
      const r = await act('upsert_crm_organization', { name });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      ids.push(r.body.result.id);
    }
    synkbolaget = ids[0]!;
    beskedbolaget = ids[3]!;
  });
  it('BS1 en kandidat ger exakt variantfel utan att skapa relation', async () => {
    await withTenantTransaction(user.userId, companyId, async (c) => {
      await expect(upsertOrganization(c, companyId, user.userId, { name: 'Synkbolaget AS' }, SYNK))
        .rejects.toMatchObject({ code: 'name_variant_of', status: 400,
          message: 'bolagsformsvariant av Synkbolaget — väntar på ditt beslut i Att göra',
          details: { organization_id: synkbolaget, name: 'Synkbolaget' } });
    });
    expect(await antal('SELECT count(*)::int AS n FROM crm.organizations WHERE company_id = $1 AND lower(name) = $2',
      [companyId, 'synkbolaget as'])).toBe(0);
  });
  it('BS2 flera kandidater ger exakt tvetydighet utan detaljer eller relation', async () => {
    await withTenantTransaction(user.userId, companyId, async (c) => {
      await expect(upsertOrganization(c, companyId, user.userId, { name: 'Tvåkandidat Oy' }, SYNK))
        .rejects.toMatchObject({ code: 'name_variant_ambiguous',
          message: 'bolagsformsvariant av flera relationer — slå ihop dem först', details: undefined });
    });
    expect(await antal('SELECT count(*)::int AS n FROM crm.organizations WHERE company_id = $1 AND name = $2',
      [companyId, 'Tvåkandidat Oy'])).toBe(0);
  });
  it('BS3 ett trimmat besked sparas en gång, auditeras utan namn och släpper nästa synk', async () => {
    await withTenantTransaction(user.userId, companyId, async (c) => {
      expect(await saveOrganizationDistinction(c, companyId, user.userId, beskedbolaget, ' Beskedbolaget Oy ')).toEqual({ saved: 1 });
      expect(await saveOrganizationDistinction(c, companyId, user.userId, beskedbolaget, 'BESKEDBOLAGET OY')).toEqual({ saved: 0 });
      expect(await upsertOrganization(c, companyId, user.userId, { name: 'Beskedbolaget Oy' }, SYNK))
        .toMatchObject({ created: true, name: 'Beskedbolaget Oy' });
    });
    await withAdmin(async (db) => {
      expect((await db.query(`SELECT variant_name FROM crm.organization_distinctions
        WHERE company_id = $1 AND organization_id = $2`, [companyId, beskedbolaget])).rows)
        .toEqual([{ variant_name: 'Beskedbolaget Oy' }]);
      const audit = (await db.query(`SELECT details FROM crm.audit_log WHERE company_id = $1 AND entity_id = $2
        AND action = 'crm.organization_distinction_saved'`, [companyId, beskedbolaget])).rows;
      expect(audit).toHaveLength(2);
      expect(audit.map((r) => r.details)).toEqual(expect.arrayContaining([{ saved: 1 }, { saved: 0 }]));
      expect(JSON.stringify(audit)).not.toContain('Beskedbolaget');
    });
  });
  it('BS4 exakt träff med annat skiftläge blir ingen variant', async () => {
    await withTenantTransaction(user.userId, companyId, async (c) => {
      expect(await upsertOrganization(c, companyId, user.userId, { name: 'SYNKBOLAGET' }, SYNK))
        .toMatchObject({ id: synkbolaget, created: false });
    });
  });
  it('BS5 grannbolaget ser aldrig bolagets kandidat', async () => {
    await withTenantTransaction(granne.userId, grannbolag, async (c) => {
      expect(await upsertOrganization(c, grannbolag, granne.userId, { name: 'Synkbolaget AB' }, SYNK))
        .toMatchObject({ created: true });
    });
    expect(await antal('SELECT count(*)::int AS n FROM crm.organizations WHERE company_id = $1 AND name = $2',
      [companyId, 'Synkbolaget AB'])).toBe(0);
  });
});

describe('förslaget i Att göra (story 2.3)', () => {
  let gbolaget: string;
  let gtva: string;
  let gtre: string;
  const ko = (organization_id: string, name: string) => act('merge_crm_name_variant', { organization_id, name });
  const beslut = (id: string, val: 'approve' | 'reject', reason?: string, bolag = companyId, token = user.token) =>
    api.post(`/api/companies/${bolag}/approvals/${id}/${val}`).set('Authorization', `Bearer ${token}`)
      .send(reason === undefined ? {} : { reason });
  async function aliasAntal(name: string) {
    return antal('SELECT count(*)::int AS n FROM crm.organization_name_aliases WHERE company_id = $1 AND lower(name) = lower($2)', [companyId, name]);
  }
  beforeAll(async () => {
    const ids: string[] = [];
    for (const name of ['Gbolaget', 'Gtvå', 'Gtre']) {
      const r = await act('upsert_crm_organization', { name });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      ids.push(r.body.result.id);
    }
    [gbolaget, gtva, gtre] = [ids[0]!, ids[1]!, ids[2]!];
  });
  it('BG1 validering före kö och godkännande lägger alias med namnfri audit', async () => {
    for (const input of [
      { organization_id: 'inte-ett-id', name: 'Gbolaget AS' },
      { organization_id: gbolaget, name: '' }, { organization_id: gbolaget, name: '   ' },
    ]) {
      const r = await act('merge_crm_name_variant', input);
      expect(r.status, JSON.stringify(r.body)).toBe(400);
      expect(r.body.error).toBe('validation_error');
    }
    expect(await antal(`SELECT count(*)::int AS n FROM action_approvals WHERE company_id = $1
      AND action = 'merge_crm_name_variant' AND input->>'organization_id' = $2`, [companyId, gbolaget])).toBe(0);
    const q = await ko(gbolaget, 'Gbolaget AS');
    expect(q.status, JSON.stringify(q.body)).toBe(202);
    expect(q.body.approval.status).toBe('pending');
    expect(await aliasAntal('Gbolaget AS')).toBe(0);
    const r = await beslut(q.body.approval.id, 'approve');
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.approval.status).toBe('executed');
    expect(r.body.result).toEqual({ outcome: 'alias_added', organization_id: gbolaget });
    await withAdmin(async (db) => {
      expect((await db.query(`SELECT organization_id FROM crm.organization_name_aliases
        WHERE company_id = $1 AND lower(name) = 'gbolaget as'`, [companyId])).rows).toEqual([{ organization_id: gbolaget }]);
      expect((await db.query(`SELECT details FROM crm.audit_log WHERE company_id = $1
        AND entity_id = $2 AND action = 'crm.name_variant_accepted'`, [companyId, gbolaget])).rows)
        .toEqual([{ details: { alias_added: 1 } }]);
    });
  });
  it('BG2 avslag sparar skälet och paret utan alias', async () => {
    const q = await ko(gtva, 'Gtvå Oy');
    expect(q.status, JSON.stringify(q.body)).toBe(202);
    const reason = 'Två olika bolag, olika länder.';
    const r = await beslut(q.body.approval.id, 'reject', reason);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.approval.status).toBe('rejected');
    expect(r.body.approval.beslut_skal).toBe(reason);
    expect(r.body.approval.result).toEqual({ vid_avslag: { outcome: 'distinction_saved', organization_id: gtva } });
    expect(await antal(`SELECT count(*)::int AS n FROM crm.organization_distinctions
      WHERE company_id = $1 AND organization_id = $2 AND variant_name = 'Gtvå Oy'`, [companyId, gtva])).toBe(1);
    expect(await aliasAntal('Gtvå Oy')).toBe(0);
  });
  it('BG3 ändrade affärslägen och grannens id blir slutna utfall utan nya skrivningar', async () => {
    const q = await ko(gtre, 'Gtre AB');
    expect(q.status, JSON.stringify(q.body)).toBe(202);
    const ny = await act('upsert_crm_organization', { name: 'Gtre AB' });
    expect(ny.status, JSON.stringify(ny.body)).toBe(200);
    const r = await beslut(q.body.approval.id, 'approve');
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.result).toEqual({ outcome: 'name_exists', organization_id: gtre });
    expect(await aliasAntal('Gtre AB')).toBe(0);
    for (const [id, outcome] of [[gbolaget, 'already_alias'], [gtre, 'alias_elsewhere']] as const) {
      const queued = await ko(id, 'Gbolaget AS');
      expect(queued.status, JSON.stringify(queued.body)).toBe(202);
      const accepted = await beslut(queued.body.approval.id, 'approve');
      expect(accepted.status, JSON.stringify(accepted.body)).toBe(200);
      expect(accepted.body.result).toEqual({ outcome, organization_id: id });
    }
    expect(await aliasAntal('Gbolaget AS')).toBe(1);
    expect(await antal(`SELECT count(*)::int AS n FROM crm.audit_log WHERE company_id = $1
      AND entity_id = $2 AND action = 'crm.name_variant_accepted'`, [companyId, gbolaget])).toBe(1);
    const again = await ko(gtva, 'Gtvå Oy');
    expect(again.status, JSON.stringify(again.body)).toBe(202);
    const rejected = await beslut(again.body.approval.id, 'reject', 'Fortfarande olika bolag.');
    expect(rejected.status, JSON.stringify(rejected.body)).toBe(200);
    expect(rejected.body.approval.result).toEqual({ vid_avslag: { outcome: 'already_distinct', organization_id: gtva } });
    expect(await antal(`SELECT count(*)::int AS n FROM crm.organization_distinctions
      WHERE company_id = $1 AND organization_id = $2`, [companyId, gtva])).toBe(1);
    for (const [id, name, val] of [[gbolaget, 'Gbolaget Oy', 'approve'], [gtva, 'Gtvå AB', 'reject']] as const) {
      const foreign = await api.post(`/api/companies/${grannbolag}/actions/merge_crm_name_variant`)
        .set('Authorization', `Bearer ${granne.token}`).send({ organization_id: id, name });
      expect(foreign.status, JSON.stringify(foreign.body)).toBe(202);
      const result = await beslut(foreign.body.approval.id, val, val === 'reject' ? 'Finns inte här.' : undefined, grannbolag, granne.token);
      expect(result.status, JSON.stringify(result.body)).toBe(200);
      expect(val === 'approve' ? result.body.result : result.body.approval.result.vid_avslag)
        .toEqual({ outcome: 'organization_missing', organization_id: id });
    }
    expect(await antal(`SELECT count(*)::int AS n FROM crm.organization_name_aliases
      WHERE company_id = ANY($1::uuid[]) AND name = 'Gbolaget Oy'`, [[companyId, grannbolag]])).toBe(0);
    expect(await antal('SELECT count(*)::int AS n FROM crm.organization_distinctions WHERE company_id = $1', [grannbolag])).toBe(0);
    expect(await aliasAntal('Gbolaget AS')).toBe(1);
  });
  it('BG4 bara människan kan avgöra och ett nej kräver skäl', async () => {
    const q = await ko(gtva, 'Gtvå AB');
    expect(q.status, JSON.stringify(q.body)).toBe(202);
    for (const val of ['approve', 'reject'] as const) {
      const r = await beslut(q.body.approval.id, val, undefined, companyId, agentToken);
      expect(r.status, JSON.stringify(r.body)).toBe(403);
      expect(r.body.error).toBe('human_approval_required');
    }
    const r = await beslut(q.body.approval.id, 'reject');
    expect(r.status, JSON.stringify(r.body)).toBe(400);
    expect(r.body.error).toBe('skal_kravs');
    expect(await antal("SELECT count(*)::int AS n FROM action_approvals WHERE company_id = $1 AND id = $2 AND status = 'pending'",
      [companyId, q.body.approval.id])).toBe(1);
  });
});

describe('intaget och bolagsformsvarianten (story 2.3)', () => {
  let alliance: string;
  let godkant: string;
  let optikko: string;
  const text = (name: string) => `bolagsformsvariant av ${name} — väntar på ditt beslut i Att göra`;
  async function nyRelation(name: string) {
    const r = await act('upsert_crm_organization', { name });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    return r.body.result.id as string;
  }
  async function forslag(organizationId: string, name: string, bolag = companyId) {
    return withAdmin(async (db) => (await db.query(`SELECT id, input, status, requested_actor FROM action_approvals
      WHERE company_id = $1 AND action = 'merge_crm_name_variant'
      AND input->>'organization_id' = $2 AND lower(input->>'name') = lower($3) ORDER BY created_at, id`,
    [bolag, organizationId, name])).rows);
  }
  async function audit(id: string) {
    return withAdmin(async (db) => (await db.query(`SELECT entity_type, details FROM audit_log
      WHERE company_id = $1 AND action = 'action.approval_requested' AND entity_id = $2`, [companyId, id])).rows);
  }
  async function kravBolagsformsforslag(
    svar: { skipped: { index: number; reason: string }[]; merge_proposals: string[]; organizations_created: number },
    index: number, variant: string, befintlig: string,
  ) {
    expect(svar.skipped).toContainEqual({ index, reason: text(befintlig) });
    expect(svar.merge_proposals).toContain(`${variant} → ${befintlig} (bolagsform)`);
    expect(svar.organizations_created).toBe(0);
    expect(await antal('SELECT count(*)::int AS n FROM crm.organizations WHERE company_id = $1 AND lower(name) = lower($2)',
      [companyId, variant])).toBe(0);
  }
  beforeAll(async () => { alliance = await nyRelation('Alliance Optikk'); });

  it('BI1 varianten köas med namnfri audit och nästa händelse i batchen skrivs', async () => {
    const r = await ingest([kontaktpunkt('Alliance Optikk AS', 'gmail:bi1-1'), kontaktpunkt('Intagsgrannen AB', 'gmail:bi1-2')]);
    expect(r.skipped).toEqual([{ index: 0, reason: text('Alliance Optikk') }]);
    expect(r.merge_proposals).toEqual(['Alliance Optikk AS → Alliance Optikk (bolagsform)']);
    expect(r.organizations_created).toBe(1);
    expect(r.interactions_created).toBe(1);
    expect(await antal(`SELECT count(*)::int AS n FROM crm.organizations WHERE company_id = $1 AND name = 'Alliance Optikk AS'`, [companyId])).toBe(0);
    expect(await antal(`SELECT count(*)::int AS n FROM crm.interactions WHERE company_id = $1 AND source_ref = 'gmail:bi1-1'`, [companyId])).toBe(0);
    expect(await antal(`SELECT count(*)::int AS n FROM crm.interactions WHERE company_id = $1 AND source_ref = 'gmail:bi1-2'`, [companyId])).toBe(1);
    const rows = await forslag(alliance, 'Alliance Optikk AS');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'pending', requested_actor: 'agent', input: { organization_id: alliance, name: 'Alliance Optikk AS' } });
    const audits = await audit(rows[0]!.id);
    expect(audits).toEqual([{ entity_type: 'approval', details: { action: 'merge_crm_name_variant', actor: 'agent', reason: 'bolagsform' } }]);
    expect(JSON.stringify(audits)).not.toContain('Alliance');
    expect(await antal(`SELECT count(*)::int AS n FROM crm.audit_log WHERE company_id = $1
      AND action = 'crm.ingested' AND details->>'merge_proposals' = '1'`, [companyId])).toBe(1);
    expect(await antal(`SELECT count(*)::int AS n FROM crm.audit_log WHERE company_id = $1
      AND action = 'crm.ingested' AND details::text LIKE '%Alliance%'`, [companyId])).toBe(0);
    // Blandbatchen skapar grannen; hjälparens nollkrav prövas på varianten ensam.
    await kravBolagsformsforslag(await ingest([kontaktpunkt('Alliance Optikk AS', 'gmail:bi1-1')]), 0, 'Alliance Optikk AS', 'Alliance Optikk');
  });
  it('BI2 upprepad synk och två lika namn i batchen återanvänder samma förslag', async () => {
    const a = await ingest([kontaktpunkt('Alliance Optikk AS', 'gmail:bi1-1')]);
    expect(a.skipped).toEqual([{ index: 0, reason: text('Alliance Optikk') }]);
    expect(a.merge_proposals).toEqual(['Alliance Optikk AS → Alliance Optikk (bolagsform)']);
    const b = await ingest([kontaktpunkt('Alliance Optikk AS', 'gmail:bi2-1'), kontaktpunkt('Alliance Optikk AS', 'gmail:bi2-2')]);
    expect(b.skipped).toEqual([{ index: 0, reason: text('Alliance Optikk') }, { index: 1, reason: text('Alliance Optikk') }]);
    expect(b.merge_proposals).toEqual(['Alliance Optikk AS → Alliance Optikk (bolagsform)']);
    const rows = await forslag(alliance, 'Alliance Optikk AS');
    expect(rows).toHaveLength(1);
    expect(await audit(rows[0]!.id)).toHaveLength(1);
  });
  it('BI3 kö och audit försvinner tillsammans vid rollback av savepoint', async () => {
    const id = await nyRelation('Rollbackbolaget');
    let approvalId = '';
    await withTenantTransaction(user.userId, companyId, async (c) => {
      await c.query('SAVEPOINT bi3');
      const q = await queueNameVariantProposal(c, companyId, user.userId, 'agent', { organization_id: id, name: 'Rollbackbolaget AB' });
      expect(q.queued).toBe(true);
      approvalId = q.approval_id;
      expect((await c.query('SELECT id FROM action_approvals WHERE company_id = $1 AND id = $2', [companyId, approvalId])).rows).toEqual([{ id: approvalId }]);
      await c.query('ROLLBACK TO SAVEPOINT bi3');
      expect((await c.query('SELECT id FROM action_approvals WHERE company_id = $1 AND id = $2', [companyId, approvalId])).rows).toEqual([]);
    });
    expect(await forslag(id, 'Rollbackbolaget AB')).toEqual([]);
    expect(await audit(approvalId)).toEqual([]);
  });
  it('BI4 flera kandidater redovisas utan förslag eller relation', async () => {
    await nyRelation('Nordic Retail');
    await nyRelation('Nordic Retail AB');
    const r = await ingest([kontaktpunkt('Nordic Retail Oy', 'gmail:bi4-1')]);
    expect(r.skipped).toEqual([{ index: 0, reason: 'bolagsformsvariant av flera relationer — slå ihop dem först' }]);
    expect(r.merge_proposals).toEqual(['Nordic Retail Oy (flera möjliga)']);
    expect(r.organizations_created).toBe(0);
    expect(await antal(`SELECT count(*)::int AS n FROM crm.organizations WHERE company_id = $1 AND name = 'Nordic Retail Oy'`, [companyId])).toBe(0);
    expect(await antal(`SELECT count(*)::int AS n FROM action_approvals WHERE company_id = $1
      AND action = 'merge_crm_name_variant' AND lower(input->>'name') = 'nordic retail oy'`, [companyId])).toBe(0);
  });
  it('BI5 synk, ja och ny synk skriver kontaktpunkten på relationen via alias', async () => {
    godkant = await nyRelation('Godkänt Optik');
    const events = [kontaktpunkt('Godkänt Optik AS', 'gmail:bi5-1')];
    await kravBolagsformsforslag(await ingest(events), 0, 'Godkänt Optik AS', 'Godkänt Optik');
    const q = await forslag(godkant, 'Godkänt Optik AS');
    expect(q).toHaveLength(1);
    const accepted = await api.post(`/api/companies/${companyId}/approvals/${q[0]!.id}/approve`)
      .set('Authorization', `Bearer ${user.token}`).send({});
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(200);
    expect(accepted.body.approval.status).toBe('executed');
    expect(accepted.body.result.outcome).toBe('alias_added');
    const r = await ingest(events);
    expect(r.skipped).toEqual([]); expect(r.merge_proposals).toEqual([]);
    expect(r.redirected_organizations).toEqual(['Godkänt Optik AS → Godkänt Optik']);
    expect(r.organizations_created).toBe(0); expect(r.interactions_created).toBe(1);
    expect(await antal(`SELECT count(*)::int AS n FROM crm.interactions WHERE company_id = $1
      AND organization_id = $2 AND source_ref = 'gmail:bi5-1'`, [companyId, godkant])).toBe(1);
    expect(await antal(`SELECT count(*)::int AS n FROM crm.organizations WHERE company_id = $1 AND name = 'Godkänt Optik AS'`, [companyId])).toBe(0);
  });
  it('BI6 synk, nej och nya synker skapar en egen relation och frågar aldrig paret igen', async () => {
    optikko = await nyRelation('Optikko Kivinen');
    const events = [kontaktpunkt('Optikko Kivinen Oy', 'gmail:bi6-1')];
    await kravBolagsformsforslag(await ingest(events), 0, 'Optikko Kivinen Oy', 'Optikko Kivinen');
    const q = await forslag(optikko, 'Optikko Kivinen Oy');
    expect(q).toHaveLength(1);
    const rejected = await api.post(`/api/companies/${companyId}/approvals/${q[0]!.id}/reject`)
      .set('Authorization', `Bearer ${user.token}`).send({ reason: 'Två olika bolag.' });
    expect(rejected.status, JSON.stringify(rejected.body)).toBe(200);
    const r = await ingest(events);
    expect(r.skipped).toEqual([]); expect(r.merge_proposals).toEqual([]);
    expect(r.organizations_created).toBe(1); expect(r.interactions_created).toBe(1);
    expect(await antal(`SELECT count(*)::int AS n FROM crm.interactions i JOIN crm.organizations o
      ON o.company_id = i.company_id AND o.id = i.organization_id WHERE i.company_id = $1
      AND o.name = 'Optikko Kivinen Oy' AND i.source_ref = 'gmail:bi6-1'`, [companyId])).toBe(1);
    const again = await ingest([kontaktpunkt('OPTIKKO KIVINEN OY', 'gmail:bi6-2')]);
    expect(again.skipped).toEqual([]); expect(again.merge_proposals).toEqual([]); expect(again.organizations_created).toBe(0);
    const rows = await forslag(optikko, 'Optikko Kivinen Oy');
    expect(rows).toHaveLength(1); expect(rows[0]!.status).toBe('rejected');
  });
  it('BI7 nytt namn och händelse utan mål behåller vanliga utfall med tom förslagslista', async () => {
    const r = await ingest([kontaktpunkt('Helt Ny Kund AB', 'gmail:bi7-1')]);
    expect(r.organizations_created).toBe(1); expect(r.skipped).toEqual([]); expect(r.merge_proposals).toEqual([]);
    const { organization: _organization, ...utanMal } = kontaktpunkt('Saknas', 'gmail:bi7-2');
    const invalid = await ingest([utanMal]);
    expect(invalid.skipped).toEqual([{ index: 0, reason: 'händelsen saknar både organisation och person' }]);
    expect(invalid.merge_proposals).toEqual([]);
  });
  it('BI8 grannen får egna förslag, inget främmande besked och inget främmande alias', async () => {
    const grannAct = (name: string, input: Record<string, unknown>) => api.post(`/api/companies/${grannbolag}/actions/${name}`)
      .set('Authorization', `Bearer ${granne.token}`).send(input);
    const own = await grannAct('upsert_crm_organization', { name: 'Alliance Optikk' });
    expect(own.status, JSON.stringify(own.body)).toBe(200);
    const a = await grannAct('ingest_crm_events', { events: [kontaktpunkt('Alliance Optikk AS', 'gmail:bi8-a')] });
    expect(a.status, JSON.stringify(a.body)).toBe(200);
    expect(a.body.result.merge_proposals).toEqual(['Alliance Optikk AS → Alliance Optikk (bolagsform)']);
    expect(await forslag(own.body.result.id, 'Alliance Optikk AS', grannbolag)).toHaveLength(1);
    expect(await forslag(alliance, 'Alliance Optikk AS')).toHaveLength(1);
    const o = await grannAct('upsert_crm_organization', { name: 'Optikko Kivinen' });
    expect(o.status, JSON.stringify(o.body)).toBe(200);
    const b = await grannAct('ingest_crm_events', { events: [kontaktpunkt('Optikko Kivinen Oy', 'gmail:bi8-b')] });
    expect(b.status, JSON.stringify(b.body)).toBe(200);
    expect(b.body.result.skipped).toEqual([{ index: 0, reason: text('Optikko Kivinen') }]);
    expect(await antal(`SELECT count(*)::int AS n FROM crm.organizations WHERE company_id = $1 AND name = 'Optikko Kivinen Oy'`, [grannbolag])).toBe(0);
    const c = await grannAct('ingest_crm_events', { events: [kontaktpunkt('Godkänt Optik AS', 'gmail:bi8-c')] });
    expect(c.status, JSON.stringify(c.body)).toBe(200);
    expect(c.body.result.organizations_created).toBe(1); expect(c.body.result.redirected_organizations).toEqual([]);
  });
  it('BI9 negativ kontroll fäller planterat svar och verkligt namn som inte är variant', async () => {
    await expect(kravBolagsformsforslag({ skipped: [], merge_proposals: [], organizations_created: 1 }, 0, 'Planterad AS', 'Planterad')).rejects.toThrow();
    const r = await ingest([kontaktpunkt('Alliance Optikk Norge', 'gmail:bi9-1')]);
    expect(r.organizations_created).toBe(1); expect(r.merge_proposals).toEqual([]);
    await expect(kravBolagsformsforslag(r, 0, 'Alliance Optikk Norge', 'Alliance Optikk')).rejects.toThrow();
  });
});

describe('kortet i Att göra (story 2.3)', () => {
  it('BK1 kortets tre meningar och skälfält följer husets Att göra', async () => {
    const rows = await withAdmin(async (db) => (await db.query(`SELECT id FROM action_approvals
      WHERE company_id = $1 AND action = 'merge_crm_name_variant' AND input->>'name' = 'Alliance Optikk AS'`, [companyId])).rows);
    expect(rows).toHaveLength(1);
    const r = await ua.get(`/app/c/${companyId}/approvals`);
    expect(r.status, r.text).toBe(200);
    const cards = r.text.match(/<article class="ai-card">[\s\S]*?<\/article>/g) ?? [];
    const card = cards.find((c) => c.includes(`/approvals/${rows[0]!.id}/reject`));
    expect(card).toBeDefined();
    const text = card!.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    for (const sentence of [
      'Namnen skiljer sig bara i bolagsform (AS).',
      'Godkänn: Alliance Optikk AS räknas som Alliance Optikk, och kommande händelser med det namnet hamnar där.',
      'Avvisa: det är ett annat bolag — nästa synk skapar en egen relation för Alliance Optikk AS.',
    ]) expect(text).toContain(sentence);
    expect(card).toContain('name="skal"');
    expect(card).toContain('required');
    expect(card).toContain('class="btn btn--primary btn--sm"');
    expect(card).toContain('Öppna relationen');
    expect(r.text).toContain(':focus-visible');
  });
  it('BK2 båda namnens former, formlöst namn och saknade eller ogiltiga poster', async () => {
    const rows = await withAdmin(async (db) => (await db.query<{ id: string; name: string }>(`SELECT id, name
      FROM crm.organizations WHERE company_id = $1 AND name IN ('Nordic Retail','Nordic Retail AB')`, [companyId])).rows);
    expect(rows).toHaveLength(2);
    const plain = rows.find((r) => r.name === 'Nordic Retail')!.id;
    const ab = rows.find((r) => r.name === 'Nordic Retail AB')!.id;
    await withTenantTransaction(user.userId, companyId, async (c) => {
      const base = `/app/c/${companyId}`;
      const explain = (input: Record<string, unknown>) => explainApproval(c, companyId, 'merge_crm_name_variant', input, base);
      expect((await explain({ organization_id: ab, name: 'Nordic Retail Oy' })).why)
        .toMatch(/^Namnen skiljer sig bara i bolagsform \(Oy, AB\)\./);
      const noForm = await explain({ organization_id: plain, name: 'Nordic Retail' });
      expect(noForm.why).toMatch(/^Namnen skiljer sig bara i bolagsform\./);
      expect(noForm.source).toEqual({ label: 'Öppna relationen', href: `${base}/relations/${plain}` });
      for (const input of [
        { organization_id: '9f1c2d3e-4b5a-4c6d-8e7f-0a1b2c3d4e5f', name: 'X AB' },
        { organization_id: 'inte-ett-id', name: 'X AB' }, { organization_id: plain, name: '  ' },
      ]) expect(await explain(input)).toEqual({ change: null, why: null, source: null });
      expect((await c.query('SELECT 1 AS n')).rows).toEqual([{ n: 1 }]);
    });
  });
});

describe('dokumenten (story 2.3)', () => {
  it('BD1 åtgärd, svarslista och regel åtta finns i avgränsade dokumentavsnitt', async () => {
    const doc = await readFile(new URL('../../docs/MCP_ACTIONS.md', import.meta.url), 'utf8');
    const heading = '## Bolagsformsvarianten blir ett sammanslagningsförslag (crm 2.3)';
    expect(doc.split(heading)).toHaveLength(2);
    expect(doc.indexOf(heading)).toBeGreaterThan(doc.indexOf('## Namnkrocken leder till sammanslagningen (crm 2.1)'));
    const section = doc.split(heading)[1]!.split('\n## ')[0]!;
    expect(section).not.toMatch(/^### /m);
    for (const term of ['merge_crm_name_variant', 'merge_proposals', 'skipped', 'ingest_crm_events', 'crm.organization_distinctions', 'tvafas']) {
      expect(section, term).toContain('`' + term + '`');
    }
    const contract = await readFile(new URL('../../docs/crm/API_KONTRAKT.md', import.meta.url), 'utf8');
    const rules = contract.split('## De fyra reglerna\n')[1]!.split('\n## ')[0]!;
    expect(rules).toContain('**8. En bolagsformsvariant blir ett sammanslagningsförslag, inte en ny relation.**');
    for (const term of ['merge_proposals', 'skipped', 'merge_crm_name_variant']) expect(rules).toContain('`' + term + '`');
    const answer = contract.split('## Svaret\n')[1]!.split('\n## ')[0]!;
    expect(answer).toContain('"merge_proposals": []'); expect(answer).toContain('`merge_proposals`');
    for (const title of ['De fyra reglerna', 'Svaret', 'Människan vinner', 'Kadens, dubbletter och sökning']) {
      expect(contract.split('\n').filter((line) => line === '## ' + title), title).toHaveLength(1);
    }
  });
});

// Omtag: lagrade förslag ska jämföras som samma par även när transportens
// giltiga stavningar skiljer sig från synkens. Negativa grannar får stå kvar.
describe('granskningens parjämförelse (story 2.3)', () => {
  it.each([
    ['versalt id', 'upper', '', ''],
    ['mellanslag', 'lower', '  ', '  '],
    ['blandat id och radbrytningar', 'mixed', '\t\n', '\r\t'],
    ['Unicode-blanktecken', 'upper', '\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a', '\u2028\u2029\u202f\u205f\u3000\ufeff'],
  ])('R1 återanvänder direktförslag med %s', async (label, casing, left, right) => {
    const name = `Parprov ${label}`;
    const created = await act('upsert_crm_organization', { name });
    expect(created.status, JSON.stringify(created.body)).toBe(200);
    const id: string = created.body.result.id;
    const transportedId = casing === 'upper' ? id.toUpperCase()
      : casing === 'mixed' ? id.slice(0, 18).toUpperCase() + id.slice(18) : id;
    const variant = `${name} AS`;
    const input = { organization_id: transportedId, name: left + variant.toUpperCase() + right };
    const queued = await act('merge_crm_name_variant', input);
    expect(queued.status, JSON.stringify(queued.body)).toBe(202);
    // Samma organisation med annat namn och samma namn med annan organisation
    // får inte räknas som det sökta paret.
    const other = await act('upsert_crm_organization', { name: `Granne ${label}` });
    expect(other.status, JSON.stringify(other.body)).toBe(200);
    for (const distractor of [
      { organization_id: id, name: `${name} Oy` },
      { organization_id: other.body.result.id, name: variant },
    ]) {
      const r = await act('merge_crm_name_variant', distractor);
      expect(r.status, JSON.stringify(r.body)).toBe(202);
    }
    const r = await ingest([kontaktpunkt(variant, `gmail:r1-${casing}-${label}`)]);
    expect(r.skipped).toEqual([{ index: 0, reason: `bolagsformsvariant av ${name} — väntar på ditt beslut i Att göra` }]);
    expect(r.merge_proposals).toEqual([`${variant} → ${name} (bolagsform)`]);
    expect(r.organizations_created).toBe(0);
    const rows = await withAdmin(async (db) => (await db.query(
      `SELECT id, input FROM action_approvals WHERE company_id = $1
       AND action = 'merge_crm_name_variant' AND lower(input->>'organization_id') = $2 ORDER BY created_at, id`,
      [companyId, id])).rows);
    expect(rows).toHaveLength(2);
    expect(rows).toContainEqual({ id: queued.body.approval.id, input });
    expect(await antal(`SELECT count(*)::int AS n FROM audit_log WHERE company_id = $1
      AND action = 'action.approval_requested' AND entity_id = $2`, [companyId, queued.body.approval.id])).toBe(1);
  });
});


// Riktiga överlappande transaktioner: pg_blocking_pids bevisar att den andra
// skrivningen faktiskt väntar före commit; ingen tidsbaserad gissning om ordning.
async function vantaPaLas(pid: number) {
  await withAdmin(async (db) => {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const r = await db.query<{ blocked: boolean }>(
        'SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE $1::int = ANY(pg_blocking_pids(pid))) AS blocked', [pid]);
      if (r.rows[0]!.blocked) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('Ingen överlappande låsväntan observerades');
  });
}

describe('granskningens samtidiga alias (story 2.3)', () => {
  it.each(['samma stavning', 'annat skiftläge', 'trimmat namn'])(
    'R2 samtidiga ja ger slutna utfall vid %s', async (fall) => {
      const ids: string[] = [];
      for (const name of [`Aliasvinnare ${fall}`, `Aliaskonkurrent ${fall}`]) {
        const r = await act('upsert_crm_organization', { name });
        expect(r.status, JSON.stringify(r.body)).toBe(200);
        ids.push(r.body.result.id);
      }
      const name = `Gemensamt alias ${fall} AS`;
      const q = await act('merge_crm_name_variant', {
        organization_id: ids[1]!.toUpperCase(),
        name: fall === 'annat skiftläge' ? name.toUpperCase() : fall === 'trimmat namn' ? `  ${name} \t` : name,
      });
      expect(q.status, JSON.stringify(q.body)).toBe(202);
      let simultaneous: Promise<Awaited<ReturnType<typeof act>>> | undefined;
      try {
        await withTenantTransaction(user.userId, companyId, async (c) => {
          const first = await acceptNameVariant(c, companyId, user.userId, { organization_id: ids[0]!, name });
          expect(first).toEqual({ outcome: 'alias_added', organization_id: ids[0] });
          const pid = (await c.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid;
          // Vinnaren har skrivit aliaset men ännu inte committat. Nästa ja
          // måste möta samma unika namn trots att det låser en annan relation.
          simultaneous = api.post(`/api/companies/${companyId}/approvals/${q.body.approval.id}/approve`)
            .set('Authorization', `Bearer ${user.token}`).send({}).then((r) => r);
          await vantaPaLas(pid);
        });
        const second = await simultaneous!;
        expect(second.status, JSON.stringify(second.body)).toBe(200);
        expect(second.body.approval.status).toBe('executed');
        expect(second.body.result).toEqual({ outcome: 'alias_elsewhere', organization_id: ids[1]!.toUpperCase() });
      } finally {
        // Även ett trasigt prov måste släppa anslutningar före nästa fall.
        if (simultaneous) await Promise.allSettled([simultaneous]);
      }
      expect(await antal(`SELECT count(*)::int AS n FROM crm.organization_name_aliases
        WHERE company_id = $1 AND lower(name) = lower($2) AND organization_id = $3`, [companyId, name, ids[0]])).toBe(1);
      // Auditens generiska entity_id är text även när värdena är organisations-UUID.
      // Blandad id-lista, bara förloraren och tom lista vaktar även typgränsen.
      for (const entityIds of [[...ids, 'audit-utan-uuid'], [ids[1]!], []]) {
        const audits = await withAdmin(async (db) => (await db.query(`SELECT entity_id, details FROM crm.audit_log
          WHERE company_id = $1 AND entity_id = ANY($2::text[]) AND action = 'crm.name_variant_accepted'`, [companyId, entityIds])).rows);
        expect(audits).toEqual(entityIds.includes(ids[0]!)
          ? [{ entity_id: ids[0], details: { alias_added: 1 } }] : []);
      }
    });
});

describe('granskningens beslut efter låsväntan (story 2.3)', () => {
  it.each(['nej', 'ja'] as const)('R3 synken läser om ett samtidigt %s efter låset', async (val) => {
    const name = `Låsväntan ${val}`;
    const variant = `${name} AS`;
    const created = await act('upsert_crm_organization', { name });
    expect(created.status, JSON.stringify(created.body)).toBe(200);
    const id: string = created.body.result.id;
    let syncing: ReturnType<typeof ingest> | undefined;
    try {
      await withTenantTransaction(user.userId, companyId, async (c) => {
        await c.query('SELECT id FROM crm.organizations WHERE company_id = $1 AND id = $2 FOR UPDATE', [companyId, id]);
        const pid = (await c.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid;
        syncing = ingest([kontaktpunkt(variant, `gmail:r3-${val}`)]);
        await vantaPaLas(pid);
        const execute = val === 'nej' ? rejectNameVariant : acceptNameVariant;
        const result = await execute(c, companyId, user.userId, { organization_id: id, name: variant });
        expect(result.outcome).toBe(val === 'nej' ? 'distinction_saved' : 'alias_added');
      });
      const r = await syncing!;
      expect(r.skipped).toEqual([]);
      expect(r.merge_proposals).toEqual([]);
      expect(r.organizations_created).toBe(val === 'nej' ? 1 : 0);
      expect(r.interactions_created).toBe(1);
      expect(r.redirected_organizations).toEqual(val === 'nej' ? [] : [`${variant} → ${name}`]);
      expect(await antal(`SELECT count(*)::int AS n FROM action_approvals WHERE company_id = $1
        AND action = 'merge_crm_name_variant' AND input->>'organization_id' = $2`, [companyId, id])).toBe(0);
      const interactions = await withAdmin(async (db) => (await db.query<{ name: string }>(
        `SELECT o.name FROM crm.interactions i JOIN crm.organizations o
         ON o.company_id = i.company_id AND o.id = i.organization_id
         WHERE i.company_id = $1 AND i.source_ref = $2`, [companyId, `gmail:r3-${val}`])).rows);
      expect(interactions).toEqual([{ name: val === 'nej' ? variant : name }]);
    } finally {
      if (syncing) await Promise.allSettled([syncing]);
    }
  });
});

describe('granskningens flera låsta kandidater (story 2.3)', () => {
  it.each([false, true])('R5 räknar aktuella kandidater efter avslag på båda = %s', async (both) => {
    const name = `Kandidatbesked ${both ? 'båda' : 'en'}`;
    const names = [name, `${name} AB`];
    const ids: string[] = [];
    for (const n of names) {
      const r = await act('upsert_crm_organization', { name: n });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      ids.push(r.body.result.id);
    }
    const variant = `${name} Oy`;
    let syncing: ReturnType<typeof ingest> | undefined;
    try {
      await withTenantTransaction(user.userId, companyId, async (c) => {
        await c.query(`SELECT id FROM crm.organizations WHERE company_id = $1
          AND id = ANY($2::uuid[]) ORDER BY name, id FOR UPDATE`, [companyId, ids]);
        const pid = (await c.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid;
        syncing = ingest([kontaktpunkt(variant, `gmail:r5-${both}`)]);
        await vantaPaLas(pid);
        for (const id of both ? ids : [ids[0]!]) {
          expect((await rejectNameVariant(c, companyId, user.userId, { organization_id: id, name: variant })).outcome)
            .toBe('distinction_saved');
        }
      });
      const r = await syncing!;
      expect(r.organizations_created).toBe(both ? 1 : 0);
      expect(r.interactions_created).toBe(both ? 1 : 0);
      expect(r.skipped).toEqual(both ? [] : [{ index: 0,
        reason: `bolagsformsvariant av ${names[1]} — väntar på ditt beslut i Att göra` }]);
      expect(r.merge_proposals).toEqual(both ? [] : [`${variant} → ${names[1]} (bolagsform)`]);
      const proposals = await withAdmin(async (db) => (await db.query(`SELECT input FROM action_approvals
        WHERE company_id = $1 AND action = 'merge_crm_name_variant'
        AND input->>'organization_id' = ANY($2::text[])`, [companyId, ids])).rows);
      expect(proposals).toEqual(both ? [] : [{ input: { organization_id: ids[1], name: variant } }]);
    } finally {
      if (syncing) await Promise.allSettled([syncing]);
    }
  });
});

describe('granskningens sanningsenliga kort (story 2.3)', () => {
  it.each(['direkt', 'namnbyte'] as const)('R7 visar aktuellt beslutsunderlag för %s förslag', async (fall) => {
    const name = `Kortursprung ${fall}`;
    const variant = fall === 'direkt' ? 'Ett helt annat bolag AS' : `${name} AS`;
    const created = await act('upsert_crm_organization', { name });
    expect(created.status, JSON.stringify(created.body)).toBe(200);
    const id: string = created.body.result.id;
    const queued = await act('merge_crm_name_variant', { organization_id: id, name: variant });
    expect(queued.status, JSON.stringify(queued.body)).toBe(202);
    const base = `/app/c/${companyId}`;
    const explain = () => withTenantTransaction(user.userId, companyId,
      (c) => explainApproval(c, companyId, 'merge_crm_name_variant', queued.body.approval.input, base));
    let current = name;
    if (fall === 'namnbyte') {
      expect((await explain()).why).toContain('Namnen skiljer sig bara i bolagsform (AS).');
      current = 'Omdöpt relationsbolag AB';
      const changed = await act('upsert_crm_organization', { organization_id: id, name: current });
      expect(changed.status, JSON.stringify(changed.body)).toBe(200);
    }
    const expected = 'Namnen skiljer sig i mer än bolagsform. Kontrollera att det är samma bolag.'
      + ` Godkänn: ${variant} räknas som ${current}, och kommande händelser med det namnet hamnar där.`
      + ' Avvisa: beskedet att det är olika bolag sparas för det här namnparet.';
    const summary = await explain();
    expect(summary).toEqual({ change: null, why: expected,
      source: { label: 'Öppna relationen', href: `${base}/relations/${id}` } });
    expect(summary.why).not.toContain('Namnen skiljer sig bara i bolagsform');
    const page = await ua.get(`${base}/approvals`);
    expect(page.status, page.text).toBe(200);
    const card = (page.text.match(/<article class="ai-card">[\s\S]*?<\/article>/g) ?? [])
      .find((c) => c.includes(`/approvals/${queued.body.approval.id}/reject`));
    expect(card).toBeDefined();
    expect(card!.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ')).toContain(expected);
    expect(card).toContain('name="skal"');
    expect(card).toContain('required');
    expect(card).toContain('class="btn btn--primary btn--sm"');
    expect(card).toContain(`${base}/relations/${id}`);
    expect(page.text).toContain(':focus-visible');
  });
});

describe('granskningens ändrade kandidatmängd (story 2.3)', () => {
  it('R5b en kandidat som tillkommer under låsväntan får inte förbises', async () => {
    const name = 'Tillkommande kandidat';
    const variant = `${name} Oy`;
    const created = await act('upsert_crm_organization', { name });
    expect(created.status, JSON.stringify(created.body)).toBe(200);
    let syncing: ReturnType<typeof ingest> | undefined;
    try {
      await withTenantTransaction(user.userId, companyId, async (c) => {
        await c.query('SELECT id FROM crm.organizations WHERE company_id = $1 AND id = $2 FOR UPDATE',
          [companyId, created.body.result.id]);
        const pid = (await c.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid;
        syncing = ingest([kontaktpunkt(variant, 'gmail:r5b')]);
        await vantaPaLas(pid);
        const extra = await act('upsert_crm_organization', { name: `${name} AB` });
        expect(extra.status, JSON.stringify(extra.body)).toBe(200);
      });
      const r = await syncing!;
      expect(r.skipped).toEqual([{ index: 0, reason: 'bolagsformsvariant av flera relationer — slå ihop dem först' }]);
      expect(r.merge_proposals).toEqual([`${variant} (flera möjliga)`]);
      expect(r.organizations_created).toBe(0);
      expect(r.interactions_created).toBe(0);
      expect(await antal(`SELECT count(*)::int AS n FROM action_approvals WHERE company_id = $1
        AND action = 'merge_crm_name_variant' AND input->>'name' = $2`, [companyId, variant])).toBe(0);
    } finally {
      if (syncing) await Promise.allSettled([syncing]);
    }
  });
});
