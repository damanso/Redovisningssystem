// FR-14/FR-30 b: två stavningar får samma jämförelsenyckel och en projektkod
// får ingen relation utan kund. Prövar databas, åtgärd, intag och befintlig vy.
import pg from 'pg';
import supertest from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { loadMigrations, migrate, type MigrationFile } from '../src/db/migrate.js';
import { withTenantTransaction } from '../src/db/tx.js';
import { api, app, createCompany, registerUser, withAdmin, type TestUser } from './helpers.js';

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
