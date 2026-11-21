// FR-14/FR-30 b: två stavningar får samma jämförelsenyckel och en projektkod
// får ingen relation utan kund. Prövar databas, åtgärd, intag och befintlig vy.
import pg from 'pg';
import supertest from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { loadMigrations, migrate, type MigrationFile } from '../src/db/migrate.js';
import { withTenantTransaction } from '../src/db/tx.js';
import { api, app, createCompany, registerUser, withAdmin, type TestUser } from './helpers.js';
import { queueNameVariantProposal } from '../src/services/crmIngest.js';
import { explainApproval } from '../src/services/approvalSummary.js';

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
  let tabellbolag: string;
  beforeAll(async () => {
    const r = await act('upsert_crm_organization', { name: 'Tabellbolaget' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    tabellbolag = r.body.result.id;
  });
  it('BM1 tabellen har exakt kolumner, nycklar, RLS, rättigheter och datakategori', async () => {
    await withAdmin(async (db) => {
      expect((await db.query(`SELECT column_name, data_type, is_nullable FROM information_schema.columns
        WHERE table_schema = 'crm' AND table_name = 'organization_distinctions' ORDER BY ordinal_position`)).rows).toEqual([
        { column_name: 'company_id', data_type: 'uuid', is_nullable: 'NO' },
        { column_name: 'organization_id', data_type: 'uuid', is_nullable: 'NO' },
        { column_name: 'variant_name', data_type: 'text', is_nullable: 'NO' },
        { column_name: 'created_by', data_type: 'uuid', is_nullable: 'YES' },
        { column_name: 'created_at', data_type: 'timestamp with time zone', is_nullable: 'NO' },
      ]);
      expect((await db.query(`SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conrelid = 'crm.organization_distinctions'::regclass AND conname = 'organization_distinctions_organization_fk'`)).rows)
        .toEqual([{ def: 'FOREIGN KEY (organization_id, company_id) REFERENCES crm.organizations(id, company_id) ON DELETE CASCADE' }]);
      expect((await db.query(`SELECT indexdef FROM pg_indexes WHERE schemaname = 'crm' AND indexname = 'organization_distinctions_uk'`)).rows)
        .toEqual([{ indexdef: 'CREATE UNIQUE INDEX organization_distinctions_uk ON crm.organization_distinctions USING btree (company_id, organization_id, lower(variant_name))' }]);
      expect((await db.query(`SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = 'crm.organization_distinctions'::regclass`)).rows)
        .toEqual([{ relrowsecurity: true, relforcerowsecurity: true }]);
      expect((await db.query(`SELECT cmd FROM pg_policies WHERE schemaname = 'crm' AND tablename = 'organization_distinctions' ORDER BY cmd`)).rows)
        .toEqual([{ cmd: 'INSERT' }, { cmd: 'SELECT' }]);
      for (const verb of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
        expect((await db.query("SELECT has_table_privilege('app', 'crm.organization_distinctions', $1) AS allowed", [verb])).rows)
          .toEqual([{ allowed: ['SELECT', 'INSERT'].includes(verb) }]);
      }
      expect((await db.query("SELECT obj_description('crm.organization_distinctions'::regclass, 'pg_class') AS description")).rows)
        .toEqual([{ description: 'Kategori: ÄGD — Davids besked att ett namn som bara skiljer sig i bolagsform är ett annat bolag' }]);
    });
  });
  it('BM2 migrationskedjan igen tillämpar ingenting', async () => {
    expect((await migrate(process.env.DATABASE_ADMIN_URL!)).applied).toEqual([]);
    expect(await antal("SELECT count(*)::int AS n FROM schema_migrations WHERE name = 'crm_organization_distinctions'", [])).toBe(1);
  });
  it('BM3 app får lägga till eget besked men inte ändra, radera eller läsa grannens', async () => {
    await withTenantTransaction(user.userId, companyId, async (c) => {
      const r = await c.query(`INSERT INTO crm.organization_distinctions (company_id, organization_id, variant_name, created_by)
        VALUES ($1,$2,'Tabellbolaget AB',$3)`, [companyId, tabellbolag, user.userId]);
      expect(r.rowCount).toBe(1);
    });
    for (const sql of ["UPDATE crm.organization_distinctions SET variant_name = 'x' WHERE company_id = $1", 'DELETE FROM crm.organization_distinctions WHERE company_id = $1']) {
      await expect(withTenantTransaction(user.userId, companyId, (c) => c.query(sql, [companyId]))).rejects.toMatchObject({ code: '42501' });
    }
    await withTenantTransaction(granne.userId, grannbolag, async (c) => {
      expect((await c.query('SELECT count(*)::int AS n FROM crm.organization_distinctions')).rows).toEqual([{ n: 0 }]);
    });
  });
});

describe('handskapad bolagsformsvariant (story 2.3)', () => {
  let hand: string;
  let bytes: string;
  let byt: string;
  let egen: string;
  async function skapa(name: string) {
    const r = await act('upsert_crm_organization', { name });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    return r.body.result.id as string;
  }
  const namnrader = (name: string) => antal('SELECT count(*)::int AS n FROM crm.organizations WHERE company_id = $1 AND lower(name) = lower($2)', [companyId, name]);
  const besked = () => withAdmin(async (db) => (await db.query(`SELECT organization_id, variant_name FROM crm.organization_distinctions
    WHERE company_id = $1 AND organization_id = $2`, [companyId, hand])).rows);
  beforeAll(async () => {
    hand = await skapa('Handbolaget'); bytes = await skapa('Byteskandidat');
    byt = await skapa('Byt Mig AB'); egen = await skapa('Egenvariant');
  });
  it('BH1 människans variant skapar varken relation eller förslag', async () => {
    const r = await act('upsert_crm_organization', { name: 'Handbolaget AS' });
    expect(r.status, JSON.stringify(r.body)).toBe(400);
    expect(r.body).toEqual({ error: 'name_variant_of', details: { organization_id: hand, name: 'Handbolaget' } });
    expect(await namnrader('Handbolaget AS')).toBe(0);
    expect(await antal("SELECT count(*)::int AS n FROM action_approvals WHERE company_id = $1 AND action = 'merge_crm_name_variant'", [companyId])).toBe(0);
  });
  it('BH2 agentnyckeln får samma fel utan ny relation', async () => {
    const r = await agentAct('upsert_crm_organization', { name: 'HANDBOLAGET AB' });
    expect(r.status, JSON.stringify(r.body)).toBe(400);
    expect(r.body).toEqual({ error: 'name_variant_of', details: { organization_id: hand, name: 'Handbolaget' } });
    expect(await namnrader('HANDBOLAGET AB')).toBe(0);
  });
  it('BH3 människans uttryckliga besked sparar paret och mänskligt ursprung atomärt', async () => {
    const r = await act('upsert_crm_organization', { name: 'Handbolaget AS', distinct_from: hand });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.result.name).toBe('Handbolaget AS');
    await withAdmin(async (db) => {
      expect((await db.query(`SELECT source FROM crm.field_provenance WHERE company_id = $1 AND organization_id = $2 AND field = 'name'`, [companyId, r.body.result.id])).rows)
        .toEqual([{ source: 'human' }]);
      expect((await db.query(`SELECT details FROM crm.audit_log WHERE company_id = $1 AND entity_id = $2 AND action = 'crm.organization_distinction_saved'`, [companyId, hand])).rows)
        .toEqual([{ details: { saved: 1 } }]);
    });
    expect(await besked()).toEqual([{ organization_id: hand, variant_name: 'Handbolaget AS' }]);
  });
  it('BH4 agenten får aldrig säga att två namn är olika bolag', async () => {
    const r = await agentAct('upsert_crm_organization', { name: 'Handbolaget Oy', distinct_from: hand });
    expect(r.status, JSON.stringify(r.body)).toBe(403);
    expect(r.body).toEqual({ error: 'human_required' });
    expect(await namnrader('Handbolaget Oy')).toBe(0);
    expect(await besked()).toHaveLength(1);
  });
  it('BH5 namnbyte till annans variant avvisas orört, egen variant går', async () => {
    const fore = await orgRad(byt);
    const r = await act('upsert_crm_organization', { organization_id: byt, name: 'Byteskandidat AB' });
    expect(r.status, JSON.stringify(r.body)).toBe(400);
    expect(r.body).toEqual({ error: 'name_variant_of', details: { organization_id: bytes, name: 'Byteskandidat' } });
    expect(await orgRad(byt)).toEqual(fore);
    const eget = await act('upsert_crm_organization', { organization_id: egen, name: 'Egenvariant AB' });
    expect(eget.status, JSON.stringify(eget.body)).toBe(200);
    expect((await orgRad(egen)).name).toBe('Egenvariant AB');
  });
  it('BH6 nytt namn går men felaktigt distinct_from avvisas', async () => {
    const nytt = await act('upsert_crm_organization', { name: 'Helt Eget Bolag AB' });
    expect(nytt.status, JSON.stringify(nytt.body)).toBe(200);
    for (const [name, distinct_from, error] of [
      ['Ett Tredje Bolag AB', hand, 'distinct_from_mismatch'], ['Ett Fjärde Bolag AB', 'inte-ett-id', 'validation_error'],
    ]) {
      const r = await act('upsert_crm_organization', { name, distinct_from });
      expect(r.status, JSON.stringify(r.body)).toBe(400);
      expect(r.body.error).toBe(error);
      if (error === 'distinct_from_mismatch') expect(r.body).toEqual({ error });
      expect(await namnrader(name!)).toBe(0);
    }
  });
  it('BH7 relationer och besked i bolag A gäller aldrig grannbolaget', async () => {
    const fore = await orgRad(hand);
    const par = await besked();
    const granneSkapar = (input: Record<string, unknown>) => api.post(`/api/companies/${grannbolag}/actions/upsert_crm_organization`)
      .set('Authorization', `Bearer ${granne.token}`).send(input);
    const r = await granneSkapar({ name: 'Handbolaget Oy' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const fel = await granneSkapar({ name: 'Handbolaget AB', distinct_from: hand });
    expect(fel.status, JSON.stringify(fel.body)).toBe(400);
    expect(fel.body).toEqual({ error: 'distinct_from_mismatch' });
    expect(await orgRad(hand)).toEqual(fore);
    expect(await besked()).toEqual(par);
  });
});

describe('förslaget i Att göra (story 2.3)', () => {
  let g: string;
  let tva: string;
  let tre: string;
  async function koa(id: string, name: string) {
    const r = await act('merge_crm_name_variant', { organization_id: id, name });
    expect(r.status, JSON.stringify(r.body)).toBe(202);
    expect(r.body.approval.status).toBe('pending');
    return r.body.approval.id as string;
  }
  const besluta = (id: string, beslut: string, input = {}, token = user.token) =>
    api.post(`/api/companies/${companyId}/approvals/${id}/${beslut}`).set('Authorization', `Bearer ${token}`).send(input);
  const aliasAntal = (name: string) => antal('SELECT count(*)::int AS n FROM crm.organization_name_aliases WHERE company_id = $1 AND lower(name) = lower($2)', [companyId, name]);
  beforeAll(async () => {
    const ids: string[] = [];
    for (const name of ['Gbolaget', 'Gtvå', 'Gtre']) {
      const r = await act('upsert_crm_organization', { name });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      ids.push(r.body.result.id);
    }
    [g, tva, tre] = ids as [string, string, string];
  });
  it('BG1 validerar före kö och godkänt lägger ett alias med audit först vid verkställighet', async () => {
    for (const input of [{ organization_id: 'inte-ett-id', name: 'Gbolaget AS' }, { organization_id: g, name: '' }]) {
      const r = await act('merge_crm_name_variant', input);
      expect(r.status, JSON.stringify(r.body)).toBe(400);
      expect(r.body.error).toBe('validation_error');
    }
    expect(await antal("SELECT count(*)::int AS n FROM action_approvals WHERE company_id = $1 AND action = 'merge_crm_name_variant' AND input->>'organization_id' = $2", [companyId, g])).toBe(0);
    const id = await koa(g, 'Gbolaget AS');
    expect(await aliasAntal('Gbolaget AS')).toBe(0);
    const r = await besluta(id, 'approve');
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.approval.status).toBe('executed');
    expect(r.body.result).toEqual({ outcome: 'alias_added', organization_id: g });
    expect(await withAdmin(async (db) => (await db.query('SELECT organization_id FROM crm.organization_name_aliases WHERE company_id = $1 AND name = $2', [companyId, 'Gbolaget AS'])).rows))
      .toEqual([{ organization_id: g }]);
    expect(await withAdmin(async (db) => (await db.query("SELECT details FROM crm.audit_log WHERE company_id = $1 AND entity_id = $2 AND action = 'crm.name_variant_accepted'", [companyId, g])).rows))
      .toEqual([{ details: { alias_added: 1 } }]);
  });
  it('BG2 ett nej med skäl sparar besked utan alias', async () => {
    const id = await koa(tva, 'Gtvå Oy');
    const r = await besluta(id, 'reject', { reason: 'Två olika bolag, olika länder.' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const rad = await withAdmin(async (db) => (await db.query('SELECT beslut_skal, result FROM action_approvals WHERE company_id = $1 AND id = $2', [companyId, id])).rows[0]);
    expect(rad).toEqual({ beslut_skal: 'Två olika bolag, olika länder.', result: { vid_avslag: { outcome: 'distinction_saved', organization_id: tva } } });
    expect(await antal('SELECT count(*)::int AS n FROM crm.organization_distinctions WHERE company_id = $1 AND organization_id = $2 AND variant_name = $3', [companyId, tva, 'Gtvå Oy'])).toBe(1);
    expect(await aliasAntal('Gtvå Oy')).toBe(0);
  });
  it('BG3 ett namn som finns och ett befintligt alias ger slutliga utfall utan ny rad', async () => {
    const id = await koa(tre, 'Gtre AB');
    const nytt = await act('upsert_crm_organization', { name: 'Gtre AB', distinct_from: tre });
    expect(nytt.status, JSON.stringify(nytt.body)).toBe(200);
    const r = await besluta(id, 'approve');
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.result).toEqual({ outcome: 'name_exists', organization_id: tre });
    expect(await aliasAntal('Gtre AB')).toBe(0);
    const igen = await besluta(await koa(g, 'Gbolaget AS'), 'approve');
    expect(igen.status, JSON.stringify(igen.body)).toBe(200);
    expect(igen.body.result).toEqual({ outcome: 'already_alias', organization_id: g });
    expect(await aliasAntal('Gbolaget AS')).toBe(1);
    expect(await antal("SELECT count(*)::int AS n FROM crm.audit_log WHERE company_id = $1 AND entity_id = $2 AND action = 'crm.name_variant_accepted'", [companyId, g])).toBe(1);
  });
  it('BG4 agenten kan aldrig besluta och människans nej kräver skäl', async () => {
    const id = await koa(tva, 'Gtvå AB');
    for (const beslut of ['approve', 'reject']) {
      const r = await besluta(id, beslut, { reason: 'Nej.' }, agentToken);
      expect(r.status, JSON.stringify(r.body)).toBe(403);
      expect(r.body.error).toBe('human_approval_required');
    }
    const r = await besluta(id, 'reject');
    expect(r.status, JSON.stringify(r.body)).toBe(400);
    expect(r.body.error).toBe('skal_kravs');
    expect(await withAdmin(async (db) => (await db.query('SELECT status FROM action_approvals WHERE company_id = $1 AND id = $2', [companyId, id])).rows))
      .toEqual([{ status: 'pending' }]);
  });
});

describe('intaget och bolagsformsvarianten (story 2.3)', () => {
  let alliance: string;
  async function skapa(name: string, distinct_from?: string) {
    const r = await act('upsert_crm_organization', { name, ...(distinct_from ? { distinct_from } : {}) });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    return r.body.result.id as string;
  }
  async function forslag(id: string, name: string, bolag = companyId) {
    return withAdmin(async (db) => (await db.query<{ id: string; input: Record<string, unknown>; status: string; requested_actor: string }>(
      `SELECT id, input, status, requested_actor FROM action_approvals WHERE company_id = $1 AND action = 'merge_crm_name_variant'
       AND input->>'organization_id' = $2 AND lower(input->>'name') = lower($3) ORDER BY created_at, id`, [bolag, id, name])).rows);
  }
  const namnantal = (name: string, bolag = companyId) => antal('SELECT count(*)::int AS n FROM crm.organizations WHERE company_id = $1 AND lower(name) = lower($2)', [bolag, name]);
  const skal = (name: string) => `bolagsformsvariant av ${name} — väntar på ditt beslut i Att göra`;
  async function kravBolagsformsforslag(svar: { skipped: unknown[]; merge_proposals?: string[]; organizations_created: number }, index: number, variant: string, befintlig: string) {
    expect(svar.skipped).toContainEqual({ index, reason: skal(befintlig) });
    expect(svar.merge_proposals).toContain(`${variant} → ${befintlig} (bolagsform)`);
    expect(svar.organizations_created).toBe(0);
    expect(await namnantal(variant)).toBe(0);
  }
  beforeAll(async () => { alliance = await skapa('Alliance Optikk'); });
  it('BI1 varianten hoppas över men förslag och namnfri audit står kvar medan batchen fortsätter', async () => {
    const r = await ingest([kontaktpunkt('Alliance Optikk AS', 'gmail:bi1-1'), kontaktpunkt('Intagsgrannen AB', 'gmail:bi1-2')]);
    expect(r.skipped).toEqual([{ index: 0, reason: skal('Alliance Optikk') }]);
    expect(r.merge_proposals).toEqual(['Alliance Optikk AS → Alliance Optikk (bolagsform)']);
    expect(r.organizations_created).toBe(1);
    expect(r.interactions_created).toBe(1);
    expect(await namnantal('Alliance Optikk AS')).toBe(0);
    expect(await antal('SELECT count(*)::int AS n FROM crm.interactions WHERE company_id = $1 AND source_ref = $2', [companyId, 'gmail:bi1-1'])).toBe(0);
    const rows = await forslag(alliance, 'Alliance Optikk AS');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'pending', requested_actor: 'agent', input: { organization_id: alliance, name: 'Alliance Optikk AS' } });
    expect(rows[0]!.input).toEqual({ organization_id: alliance, name: 'Alliance Optikk AS' });
    const audit = await withAdmin(async (db) => (await db.query(`SELECT entity_type, details FROM audit_log
      WHERE company_id = $1 AND action = 'action.approval_requested' AND entity_id = $2`, [companyId, rows[0]!.id])).rows);
    expect(audit).toEqual([{ entity_type: 'approval', details: { action: 'merge_crm_name_variant', actor: 'agent', reason: 'bolagsform' } }]);
    expect(JSON.stringify(audit)).not.toContain('Alliance');
    // Hjälparen gäller en batch utan andra skapelser; samma variant prövas ensam i BI2.
  });
  it('BI2 nästa körning och två varianter i samma batch ger bara ett förslag per par', async () => {
    const r = await ingest([kontaktpunkt('Alliance Optikk AS', 'gmail:bi1-1')]);
    await kravBolagsformsforslag(r, 0, 'Alliance Optikk AS', 'Alliance Optikk');
    expect(r.skipped).toEqual([{ index: 0, reason: skal('Alliance Optikk') }]);
    expect(r.merge_proposals).toEqual(['Alliance Optikk AS → Alliance Optikk (bolagsform)']);
    const tva = await ingest([kontaktpunkt('Alliance Optikk AS', 'gmail:bi2-1'), kontaktpunkt('Alliance Optikk AS', 'gmail:bi2-2')]);
    expect(tva.skipped).toEqual([0, 1].map((index) => ({ index, reason: skal('Alliance Optikk') })));
    expect(tva.merge_proposals).toEqual(['Alliance Optikk AS → Alliance Optikk (bolagsform)']);
    const rows = await forslag(alliance, 'Alliance Optikk AS');
    expect(rows).toHaveLength(1);
    expect(await antal("SELECT count(*)::int AS n FROM audit_log WHERE company_id = $1 AND entity_id = $2 AND action = 'action.approval_requested'", [companyId, rows[0]!.id])).toBe(1);
  });
  it('BI3 en rollback tar bort både förslaget och dess audit i samma savepoint', async () => {
    const id = await skapa('Rollbackbolaget');
    let proposalId = '';
    await withTenantTransaction(user.userId, companyId, async (c) => {
      await c.query('SAVEPOINT bi3');
      const r = await queueNameVariantProposal(c, companyId, user.userId, 'agent', { organization_id: id, name: 'Rollbackbolaget AB' });
      expect(r.queued).toBe(true); proposalId = r.approval_id;
      expect((await c.query('SELECT id FROM action_approvals WHERE company_id = $1 AND id = $2', [companyId, proposalId])).rows).toHaveLength(1);
      await c.query('ROLLBACK TO SAVEPOINT bi3');
      expect((await c.query('SELECT id FROM action_approvals WHERE company_id = $1 AND id = $2', [companyId, proposalId])).rows).toEqual([]);
    });
    expect(await forslag(id, 'Rollbackbolaget AB')).toEqual([]);
    expect(await antal('SELECT count(*)::int AS n FROM audit_log WHERE company_id = $1 AND entity_id = $2', [companyId, proposalId])).toBe(0);
  });
  it('BI4 flera möjliga relationer redovisas utan ny relation eller gissat förslag', async () => {
    const id = await skapa('Nordic Retail'); await skapa('Nordic Retail AB', id);
    const r = await ingest([kontaktpunkt('Nordic Retail Oy', 'gmail:bi4-1')]);
    expect(r.skipped).toEqual([{ index: 0, reason: 'bolagsformsvariant av flera relationer — slå ihop dem först' }]);
    expect(r.merge_proposals).toEqual(['Nordic Retail Oy (flera möjliga)']);
    expect(r.organizations_created).toBe(0);
    expect(await namnantal('Nordic Retail Oy')).toBe(0);
    expect(await antal("SELECT count(*)::int AS n FROM action_approvals WHERE company_id = $1 AND action = 'merge_crm_name_variant' AND lower(input->>'name') = 'nordic retail oy'", [companyId])).toBe(0);
  });
  it('BI5 godkänt förslag styr nästa synk och den överhoppade kontaktpunkten till rätt relation', async () => {
    const id = await skapa('Godkänt Optik');
    const events = [kontaktpunkt('Godkänt Optik AS', 'gmail:bi5-1')];
    await kravBolagsformsforslag(await ingest(events), 0, 'Godkänt Optik AS', 'Godkänt Optik');
    const rows = await forslag(id, 'Godkänt Optik AS'); expect(rows).toHaveLength(1);
    const beslut = await api.post(`/api/companies/${companyId}/approvals/${rows[0]!.id}/approve`).set('Authorization', `Bearer ${user.token}`).send({});
    expect(beslut.status, JSON.stringify(beslut.body)).toBe(200);
    expect(beslut.body.approval.status).toBe('executed'); expect(beslut.body.result.outcome).toBe('alias_added');
    const r = await ingest(events);
    expect(r.skipped).toEqual([]); expect(r.merge_proposals).toEqual([]);
    expect(r.redirected_organizations).toEqual(['Godkänt Optik AS → Godkänt Optik']);
    expect(r.organizations_created).toBe(0); expect(r.interactions_created).toBe(1);
    expect(await withAdmin(async (db) => (await db.query('SELECT organization_id FROM crm.interactions WHERE company_id = $1 AND source_ref = $2', [companyId, 'gmail:bi5-1'])).rows)).toEqual([{ organization_id: id }]);
    expect(await namnantal('Godkänt Optik AS')).toBe(0);
  });
  it('BI6 avvisat förslag låter nästa synk skapa en egen relation utan att fråga igen', async () => {
    const id = await skapa('Optikko Kivinen');
    const events = [kontaktpunkt('Optikko Kivinen Oy', 'gmail:bi6-1')];
    await kravBolagsformsforslag(await ingest(events), 0, 'Optikko Kivinen Oy', 'Optikko Kivinen');
    const rows = await forslag(id, 'Optikko Kivinen Oy'); expect(rows).toHaveLength(1);
    const beslut = await api.post(`/api/companies/${companyId}/approvals/${rows[0]!.id}/reject`).set('Authorization', `Bearer ${user.token}`).send({ reason: 'Eget bolag.' });
    expect(beslut.status, JSON.stringify(beslut.body)).toBe(200);
    const r = await ingest(events);
    expect(r.skipped).toEqual([]); expect(r.merge_proposals).toEqual([]);
    expect(r.organizations_created).toBe(1); expect(r.interactions_created).toBe(1);
    expect(await namnantal('Optikko Kivinen Oy')).toBe(1);
    expect(await withAdmin(async (db) => (await db.query(`SELECT o.name FROM crm.interactions i JOIN crm.organizations o ON o.id = i.organization_id AND o.company_id = i.company_id
      WHERE i.company_id = $1 AND i.source_ref = $2`, [companyId, 'gmail:bi6-1'])).rows)).toEqual([{ name: 'Optikko Kivinen Oy' }]);
    const igen = await ingest([kontaktpunkt('OPTIKKO KIVINEN OY', 'gmail:bi6-2')]);
    expect(igen.skipped).toEqual([]); expect(igen.merge_proposals).toEqual([]); expect(igen.organizations_created).toBe(0);
    const efter = await forslag(id, 'Optikko Kivinen Oy'); expect(efter).toHaveLength(1); expect(efter[0]!.status).not.toBe('pending');
  });
  it('BI7 nytt namn och saknat mål behåller sina egna utfall med tom förslagslista', async () => {
    const r = await ingest([kontaktpunkt('Helt Ny Kund AB', 'gmail:bi7-1')]);
    expect(r.organizations_created).toBe(1); expect(r.skipped).toEqual([]); expect(r.merge_proposals).toEqual([]);
    const { organization: _organization, ...utanMal } = kontaktpunkt('X', 'gmail:bi7-2');
    const fel = await ingest([utanMal]);
    expect(fel.skipped).toEqual([{ index: 0, reason: 'händelsen saknar både organisation och person' }]); expect(fel.merge_proposals).toEqual([]);
  });
  it('BI8 varken väntande förslag, avslag eller alias gäller ett annat bolag', async () => {
    const grannAct = (action: string, input: Record<string, unknown>) => api.post(`/api/companies/${grannbolag}/actions/${action}`).set('Authorization', `Bearer ${granne.token}`).send(input);
    const r = await grannAct('upsert_crm_organization', { name: 'Alliance Optikk' }); expect(r.status, JSON.stringify(r.body)).toBe(200);
    const sync = await grannAct('ingest_crm_events', { events: [kontaktpunkt('Alliance Optikk AS', 'gmail:bi8-1')] });
    expect(sync.status, JSON.stringify(sync.body)).toBe(200);
    expect(sync.body.result.merge_proposals).toEqual(['Alliance Optikk AS → Alliance Optikk (bolagsform)']);
    expect(await forslag(r.body.result.id, 'Alliance Optikk AS', grannbolag)).toHaveLength(1);
    expect(await forslag(alliance, 'Alliance Optikk AS')).toHaveLength(1);
    const optik = await grannAct('upsert_crm_organization', { name: 'Optikko Kivinen' }); expect(optik.status, JSON.stringify(optik.body)).toBe(200);
    const nej = await grannAct('ingest_crm_events', { events: [kontaktpunkt('Optikko Kivinen Oy', 'gmail:bi8-2')] });
    expect(nej.status, JSON.stringify(nej.body)).toBe(200);
    expect(nej.body.result.skipped).toEqual([{ index: 0, reason: skal('Optikko Kivinen') }]);
    expect(await namnantal('Optikko Kivinen Oy', grannbolag)).toBe(0);
    const alias = await grannAct('ingest_crm_events', { events: [kontaktpunkt('Godkänt Optik AS', 'gmail:bi8-3')] });
    expect(alias.status, JSON.stringify(alias.body)).toBe(200);
    expect(alias.body.result.organizations_created).toBe(1); expect(alias.body.result.redirected_organizations).toEqual([]);
  });
  it('BI9 negativ kontroll fäller planterad skapelse och ett verkligt namn som inte normaliseras till variant', async () => {
    await expect(kravBolagsformsforslag({ skipped: [], merge_proposals: [], organizations_created: 1 }, 0, 'Planterad AS', 'Planterad')).rejects.toThrow();
    const r = await ingest([kontaktpunkt('Alliance Optikk Norge', 'gmail:bi9-1')]);
    expect(r.organizations_created).toBe(1);
    await expect(kravBolagsformsforslag(r, 0, 'Alliance Optikk Norge', 'Alliance Optikk')).rejects.toThrow();
  });
});

describe('kortet i Att göra (story 2.3)', () => {
  it('BK1 förslagets kort säger exakt vad ja och nej betyder och begär skäl', async () => {
    const rows = await withAdmin(async (db) => (await db.query<{ id: string }>(`SELECT id FROM action_approvals WHERE company_id = $1
      AND action = 'merge_crm_name_variant' AND input->>'name' = 'Alliance Optikk AS'`, [companyId])).rows);
    expect(rows).toHaveLength(1);
    const r = await ua.get(`/app/c/${companyId}/approvals`);
    expect(r.status, r.text).toBe(200);
    const card = [...r.text.matchAll(/<article class="ai-card">([\s\S]*?)<\/article>/g)].find((m) => m[1]!.includes(`/approvals/${rows[0]!.id}/reject`))?.[1];
    expect(card).toBeDefined();
    const text = card!.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
    for (const sentence of [
      'Namnen skiljer sig bara i bolagsform (AS).',
      'Godkänn: Alliance Optikk AS räknas som Alliance Optikk, och kommande händelser med det namnet hamnar där.',
      'Avvisa: det är ett annat bolag — nästa synk skapar en egen relation för Alliance Optikk AS.',
    ]) expect(text).toContain(sentence);
    expect(card).toContain('name="skal"');
  });
  it('BK2 båda bolagsformerna läses ur SQL och ogiltiga eller saknade relationer lämnar transaktionen frisk', async () => {
    const rows = await withAdmin(async (db) => (await db.query<{ id: string; name: string }>(`SELECT id, name FROM crm.organizations
      WHERE company_id = $1 AND name = ANY($2::text[])`, [companyId, ['Nordic Retail', 'Nordic Retail AB']])).rows);
    expect(rows).toHaveLength(2);
    const vanlig = rows.find((r) => r.name === 'Nordic Retail')!.id;
    const ab = rows.find((r) => r.name === 'Nordic Retail AB')!.id;
    const base = `/app/c/${companyId}`;
    await withTenantTransaction(user.userId, companyId, async (c) => {
      const a = await explainApproval(c, companyId, 'merge_crm_name_variant', { organization_id: ab, name: 'Nordic Retail Oy' }, base);
      expect(a.why).toMatch(/^Namnen skiljer sig bara i bolagsform \(Oy, AB\)\./);
      const b = await explainApproval(c, companyId, 'merge_crm_name_variant', { organization_id: vanlig, name: 'Nordic Retail' }, base);
      expect(b.why).toMatch(/^Namnen skiljer sig bara i bolagsform\./);
      expect(b.source).toEqual({ label: 'Öppna relationen', href: `${base}/relations/${vanlig}` });
      for (const input of [
        { organization_id: '9f1c2d3e-4b5a-4c6d-8e7f-0a1b2c3d4e5f', name: 'X AB' },
        { organization_id: 'inte-ett-id', name: 'X AB' }, { organization_id: vanlig, name: '  ' },
      ]) expect(await explainApproval(c, companyId, 'merge_crm_name_variant', input, base)).toEqual({ change: null, why: null, source: null });
      expect((await c.query('SELECT 1 AS n')).rows).toEqual([{ n: 1 }]);
    });
  });
});

describe('bolagsformsvarianten i vyn (story 2.3)', () => {
  let vybolag: string;
  let omdop: string;
  let annan: string;
  let gamma: string;
  let L: string;
  let S: string;
  const feltext = 'Namnet skiljer sig bara i bolagsform från Vybolaget.';
  async function skapa(name: string) {
    const r = await act('upsert_crm_organization', { name }); expect(r.status, JSON.stringify(r.body)).toBe(200);
    return r.body.result.id as string;
  }
  function variantnotis(markup: string) {
    return (markup.match(/<p class="notice">([\s\S]*?)<\/p>/)?.[1] ?? '')
      .replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
  }
  function ompostForm(markup: string) {
    const efter = markup.slice(markup.indexOf('<p class="notice">')).split('</p>')[1] ?? '';
    return efter.slice(efter.indexOf('<form method="post" action="')).split('</form>')[0]!;
  }
  beforeAll(async () => {
    L = `/app/c/${companyId}/relations`;
    vybolag = await skapa('Vybolaget'); omdop = await skapa('Omdöpbolaget'); annan = await skapa('Annat Namn AB');
    S = `${L}/${annan}`;
    const r = await api.post(`/api/companies/${grannbolag}/actions/upsert_crm_organization`)
      .set('Authorization', `Bearer ${granne.token}`).send({ name: 'Gamma Variant' });
    expect(r.status, JSON.stringify(r.body)).toBe(200); gamma = r.body.result.id;
  });
  it('BV1 Ny relation leder till en enda notis, Öppna och ompostningsformulär', async () => {
    const r = await ua.post(`${L}/create`).type('form').send({ name: 'Vybolaget AB' });
    expect(r.status, r.text).toBe(302);
    const url = new URL(r.headers.location!, 'http://localhost');
    expect(url.pathname).toBe(L); expect(url.searchParams.get('fel')).toBe(feltext);
    expect(url.searchParams.get('variant')).toBe(vybolag); expect(url.searchParams.get('namn')).toBe('Vybolaget AB');
    expect(await antal('SELECT count(*)::int AS n FROM crm.organizations WHERE company_id = $1 AND name = $2', [companyId, 'Vybolaget AB'])).toBe(0);
    const vy = await ua.get(r.headers.location!); expect(vy.status, vy.text).toBe(200);
    expect(vy.text.match(/<p class="notice">/g)).toHaveLength(1);
    expect(variantnotis(vy.text)).toBe(`${feltext} Öppna Vybolaget`);
    expect(vy.text).toContain(`<a class="btn btn--ghost btn--sm" href="${L}/${vybolag}">Öppna Vybolaget</a>`);
    const form = ompostForm(vy.text);
    expect(form).toContain(`action="${L}/create"`);
    expect(form).toContain('<input type="hidden" name="name" value="Vybolaget AB">');
    expect(form).toContain(`<input type="hidden" name="distinct_from" value="${vybolag}">`);
    expect(form).toContain('<button class="btn btn--ghost btn--sm" type="submit">Det är ett annat bolag</button>');
  });
  it('BV2 Det är ett annat bolag skapar egen relation med mänskligt ursprung och besked', async () => {
    const r = await ua.post(`${L}/create`).type('form').send({ name: 'Vybolaget AB', distinct_from: vybolag });
    expect(r.status, r.text).toBe(302); expect(r.headers.location).toBe(L);
    await withAdmin(async (db) => {
      expect((await db.query(`SELECT p.source FROM crm.field_provenance p JOIN crm.organizations o ON o.company_id = p.company_id AND o.id = p.organization_id
        WHERE o.company_id = $1 AND o.name = 'Vybolaget AB' AND p.field = 'name'`, [companyId])).rows).toEqual([{ source: 'human' }]);
      expect((await db.query(`SELECT variant_name FROM crm.organization_distinctions WHERE company_id = $1 AND organization_id = $2`, [companyId, vybolag])).rows).toEqual([{ variant_name: 'Vybolaget AB' }]);
    });
  });
  it('BV3 namnbyte visar ompostning med rätt före-värde och lämnar raden orörd', async () => {
    const fore = await orgRad(annan);
    const r = await ua.post(`${S}/edit`).type('form').send({ name: 'Omdöpbolaget AB', fore_name: 'Annat Namn AB' });
    expect(r.status, r.text).toBe(302);
    const url = new URL(r.headers.location!, 'http://localhost');
    expect(url.pathname).toBe(S); expect(url.searchParams.get('variant')).toBe(omdop); expect(url.searchParams.get('namn')).toBe('Omdöpbolaget AB');
    const vy = await ua.get(r.headers.location!); expect(vy.status, vy.text).toBe(200);
    expect(vy.text.match(/<p class="notice">/g)).toHaveLength(1);
    expect(variantnotis(vy.text)).toBe('Namnet skiljer sig bara i bolagsform från Omdöpbolaget. Öppna Omdöpbolaget');
    const form = ompostForm(vy.text); expect(form).toContain(`action="${S}/edit"`);
    for (const [name, value] of Object.entries({ back: S, name: 'Omdöpbolaget AB', fore_name: 'Annat Namn AB', distinct_from: omdop })) {
      expect(form).toContain(`<input type="hidden" name="${name}" value="${value}">`);
    }
    expect(await orgRad(annan)).toEqual(fore);
  });
  it('BV4 uttrycklig ompostning rättar namnet och sparar paret', async () => {
    const r = await ua.post(`${S}/edit`).type('form').send({ back: S, name: 'Omdöpbolaget AB', fore_name: 'Annat Namn AB', distinct_from: omdop });
    expect(r.status, r.text).toBe(302); expect(r.headers.location).toBe(S);
    expect((await orgRad(annan)).name).toBe('Omdöpbolaget AB');
    expect(await antal('SELECT count(*)::int AS n FROM crm.organization_distinctions WHERE company_id = $1 AND organization_id = $2 AND variant_name = $3', [companyId, omdop, 'Omdöpbolaget AB'])).toBe(1);
  });
  it.each(['text', 'granne', 'saknas', 'tomt', 'dubbelt', 'utan-namn', 'blankt-namn', 'langt-namn'])('BV5 adressens tillåtelselistor avvisar %s utan 500 eller ompostning', async (fall) => {
    const fragor: Record<string, string> = {
      text: 'variant=inte-ett-id&namn=X%20AB', granne: `variant=${gamma}&namn=X%20AB`,
      saknas: 'variant=9f1c2d3e-4b5a-4c6d-8e7f-0a1b2c3d4e5f&namn=X%20AB', tomt: 'variant=&namn=X%20AB',
      dubbelt: `variant=${vybolag}&variant=${vybolag}&namn=X%20AB`, 'utan-namn': `variant=${vybolag}`,
      'blankt-namn': `variant=${vybolag}&namn=%20%20`, 'langt-namn': `variant=${vybolag}&namn=${'a'.repeat(201)}`,
    };
    const r = await ua.get(`${L}?fel=${encodeURIComponent(feltext)}&${fragor[fall]}`);
    expect(r.status, r.text).toBe(200); expect(r.text.match(/<p class="notice">/g)).toHaveLength(1);
    expect(variantnotis(r.text)).toBe(feltext); expect(r.text).not.toContain('Det är ett annat bolag');
    const eget = await ua.get(`${L}/${vybolag}?fel=${encodeURIComponent(feltext)}&variant=${vybolag.toUpperCase()}&namn=X%20AB`);
    expect(eget.status, eget.text).toBe(200); expect(eget.text).not.toContain('Det är ett annat bolag');
  });
  it('BV6 vanligt läge saknar notis, namnkrocken vinner och sidorna förblir utan JavaScript', async () => {
    for (const path of [L, `${L}/${vybolag}`]) {
      const r = await ua.get(path); expect(r.status, r.text).toBe(200);
      expect(r.text).not.toContain('Det är ett annat bolag'); expect(r.text).not.toContain('<script'); expect(r.text).not.toContain('onclick=');
    }
    const r = await ua.get(`${S}?fel=${encodeURIComponent(feltext)}&krock=${omdop}&variant=${omdop}&namn=X%20AB`);
    expect(r.status, r.text).toBe(200); expect(r.text.match(/<p class="notice">/g)).toHaveLength(1);
    expect(variantnotis(r.text)).toContain('Namnet bärs redan av'); expect(r.text).not.toContain('Det är ett annat bolag');
    expect(r.text).not.toContain('<script'); expect(r.text).not.toContain('onclick=');
  });
});

describe('dokumenten (story 2.3)', () => {
  it('BD1 åtgärden, svarsfältet och människans besked beskrivs i avgränsade avsnitt', async () => {
    const doc = await readFile(new URL('../../docs/MCP_ACTIONS.md', import.meta.url), 'utf8');
    const rubrik = '## Bolagsformsvarianten blir ett sammanslagningsförslag (crm 2.3)';
    expect(doc.split(rubrik)).toHaveLength(2);
    expect(doc.indexOf(rubrik)).toBeGreaterThan(doc.indexOf('## Namnkrocken leder till sammanslagningen (crm 2.1)'));
    const avsnitt = doc.split(rubrik)[1]!.split('\n## ')[0]!;
    expect(avsnitt).not.toMatch(/^### /m);
    for (const term of ['merge_crm_name_variant', 'merge_proposals', 'skipped', 'name_variant_of', 'name_variant_ambiguous', 'distinct_from',
      'distinct_from_mismatch', 'human_required', 'ingest_crm_events', 'upsert_crm_organization', 'crm.organization_distinctions', 'tvafas']) {
      expect(avsnitt, term).toContain('`' + term + '`');
    }
    const kontrakt = await readFile(new URL('../../docs/crm/API_KONTRAKT.md', import.meta.url), 'utf8');
    const regler = kontrakt.split('## De fyra reglerna\n')[1]!.split('\n## ')[0]!;
    expect(regler).toContain('**8. En bolagsformsvariant blir ett sammanslagningsförslag, inte en ny relation.**');
    for (const term of ['merge_proposals', 'name_variant_of', 'distinct_from', 'skipped', 'merge_crm_name_variant']) expect(regler, term).toContain('`' + term + '`');
    const svar = kontrakt.split('## Svaret\n')[1]!.split('\n## ')[0]!;
    expect(svar).toContain('"merge_proposals": []'); expect(svar).toContain('`merge_proposals`');
    for (const heading of ['De fyra reglerna', 'Svaret', 'Människan vinner', 'Kadens, dubbletter och sökning']) {
      expect(kontrakt.split('\n').filter((rad) => rad === '## ' + heading)).toHaveLength(1);
    }
  });
});
