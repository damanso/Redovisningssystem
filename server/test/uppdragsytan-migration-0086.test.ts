// Story 3.1: aldrig verifierat får inte visas levande; revisionen får inte
// skrivas över och händelsedatum får inte hittas på. Provar migration och app-roll.
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadMigrations } from '../src/db/migrate.js';
import { withTenantTransaction } from '../src/db/tx.js';
import { kanonisktReferensId, referensFormFel } from '../src/lib/referens.js';
import { api, createCompany, createFiscalYear, registerUser, type TestUser } from './helpers.js';

async function migration(nr: number): Promise<string> {
  const m = (await loadMigrations()).find((x) => x.version === nr);
  expect(m, `migration ${String(nr).padStart(4, '0')} saknas i kedjan`).toBeTruthy();
  if (!m) throw new Error(`migration ${nr} saknas`);
  return m.sql;
}

async function withMaintenance<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = new pg.Client({ connectionString: process.env.MAINTENANCE_DATABASE_URL });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

function scratchUrl(namn: string): string {
  const url = new URL(process.env.DATABASE_ADMIN_URL!);
  url.pathname = `/${namn}`;
  return url.toString();
}

const skapade: string[] = [];

/** Bara provets fasta databasnamn används, aldrig indata från en användare. */
async function databasPa0085(namn: string): Promise<pg.Client> {
  await withMaintenance(async (c) => {
    await c.query(`DROP DATABASE IF EXISTS ${namn} WITH (FORCE)`);
    await c.query(`CREATE DATABASE ${namn}`);
  });
  skapade.push(namn);
  const db = new pg.Client({ connectionString: scratchUrl(namn) });
  await db.connect();
  try {
    for (const m of (await loadMigrations()).filter((x) => x.version < 86)) await db.query(m.sql);
    return db;
  } catch (e) {
    await db.end();
    throw e;
  }
}

interface Bas { companyId: string; userId: string; projectId: string }

async function seedBas(db: pg.Client): Promise<Bas> {
  const u = await db.query<{ id: string }>(
    "INSERT INTO users (email, password_hash, name) VALUES ('precision@exempel.se', 'x', 'Precisionsprov') RETURNING id",
  );
  const userId = u.rows[0]!.id;
  const c = await db.query<{ id: string }>(
    "INSERT INTO companies (name, org_number) VALUES ('Locollabs AB', '556000-0001') RETURNING id",
  );
  const companyId = c.rows[0]!.id;
  await db.query("INSERT INTO company_members (company_id, user_id, role) VALUES ($1, $2, 'owner')",
    [companyId, userId]);
  const k = await db.query<{ id: string }>(
    "INSERT INTO customers (company_id, customer_number, name) VALUES ($1, 1, 'Precisionskund AB') RETURNING id",
    [companyId],
  );
  const p = await db.query<{ id: string }>(
    "INSERT INTO projects (company_id, customer_id, number, name) VALUES ($1, $2, 1, 'Precisionsuppdrag') RETURNING id",
    [companyId, k.rows[0]!.id],
  );
  return { companyId, userId, projectId: p.rows[0]!.id };
}

async function nyttAvtal(db: pg.Client, bas: Bas, namn: string): Promise<string> {
  const res = await db.query<{ id: string }>(
    `INSERT INTO contracts (company_id, project_id, name, signed_date, created_by)
     VALUES ($1, $2, $3, DATE '2026-09-07', $4) RETURNING id`,
    [bas.companyId, bas.projectId, namn, bas.userId],
  );
  return res.rows[0]!.id;
}

afterAll(async () => {
  for (const namn of skapade) {
    await withMaintenance((c) => c.query(`DROP DATABASE IF EXISTS ${namn} WITH (FORCE)`));
  }
});


// Risken ligger i befintliga rader: kontrollen måste stoppa före första ändringen.
describe('0086: befintliga referenser', () => {
  let db: pg.Client;
  let bas: Bas;
  let a1: string;
  let a2: string;
  let fore: Array<{ id: string; sort: string; contract_id: string; extern_id: string; senast_verifierad: unknown }>;
  const rader = async () => (await db.query('SELECT * FROM uppdrag_referens ORDER BY id')).rows;
  beforeAll(async () => {
    db = await databasPa0085('redovisning_test_0086');
    bas = await seedBas(db);
    a1 = await nyttAvtal(db, bas, 'Öppet');
    const p2 = await db.query("INSERT INTO projects (company_id, number, name) VALUES ($1, 2, 'Avslutat') RETURNING id", [bas.companyId]);
    a2 = await nyttAvtal(db, { ...bas, projectId: p2.rows[0].id }, 'Avslutat');
    for (const [avtal, sort, id, tid] of [
      [a1, 'drive', 'fil-1', null], [a1, 'drive', 'fil-2', '2026-09-01 08:00+02'],
      [a2, 'drive', 'fil-4', null], [a1, 'mejl', '<m5@ilt.example>', null],
      [a1, 'mejl', 'm6@ilt.example', '2026-09-02 08:00+02'], [a2, 'mejl', '<m7@ilt.example>', null],
      [a1, 'mejl', 'ej-ett-message-id', null], [a1, 'mejl', '<kollision@ilt.example>', null], [a1, 'mejl', 'kollision@ilt.example', null],
    ]) await db.query(`INSERT INTO uppdrag_referens (company_id, contract_id, sort, extern_id, status, senast_verifierad)
      VALUES ($1, $2, $3, $4, 'levande', $5)`, [bas.companyId, avtal, sort, id, tid]);
    await db.query("UPDATE projects SET status = 'closed' WHERE id = $1", [p2.rows[0].id]);
  });
  afterAll(async () => { if (db) await db.end(); });
  it('M1: kollision fäller atomärt före schema och rättelser', async () => {
    const innan = await rader();
    await expect(db.query(await migration(86))).rejects.toThrow(/uppdrag_referens.*kollision/);
    expect(await rader()).toEqual(innan);
    expect((await db.query("SELECT 1 FROM information_schema.columns WHERE table_name = 'uppdrag_referens' AND column_name = 'handelse_datum'")).rows).toEqual([]);
  });
  it('M2: rättar bara öppna uppdrag och kanoniserar samma rader som regeln', async () => {
    await db.query("DELETE FROM uppdrag_referens WHERE contract_id = $1 AND extern_id = 'kollision@ilt.example'", [a1]);
    fore = await rader();
    await db.query(await migration(86));
    const efter = await rader();
    for (const r of fore) {
      const ny = efter.find((x) => x.id === r.id)!;
      expect(ny.status).toBe(r.contract_id === a1 && r.senast_verifierad === null ? 'overifierad' : 'levande');
      const k = kanonisktReferensId('mejl', r.extern_id);
      expect(ny.extern_id).toBe(r.sort === 'mejl' && r.contract_id === a1 && referensFormFel('mejl', k) === null ? k : r.extern_id);
    }
  });
  it('M3: andra körningen lämnar raderna identiska', async () => {
    const innan = await rader(); await db.query(await migration(86)); expect(await rader()).toEqual(innan);
  });
  it('M4: schemat har bara identitet, källa, datum och status', async () => {
    const kol = (await db.query("SELECT column_name, data_type, column_default FROM information_schema.columns WHERE table_name = 'uppdrag_referens' ORDER BY ordinal_position")).rows;
    expect(Object.fromEntries(kol.map((r) => [r.column_name, r.data_type]))).toEqual({
      id: 'uuid', company_id: 'uuid', contract_id: 'uuid', sort: 'text', extern_id: 'text', extern_nyckel: 'text', extern_kalla: 'text',
      titel_vid_lankning: 'text', hash_vid_lankning: 'text', senast_verifierad: 'timestamp with time zone', status: 'text',
      ko_status: 'text', ko_fel: 'text', created_at: 'timestamp with time zone', handelse_datum: 'date', revision: 'bigint',
    });
    expect(kol.find((r) => r.column_name === 'status').column_default).toContain("'overifierad'");
    for (const namn of ['handelse_datum', 'revision']) expect(kol.find((r) => r.column_name === namn).column_default).toBeNull();
    const def = (await db.query("SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conrelid = 'uppdrag_referens'::regclass AND conname = 'uppdrag_referens_status_check'")).rows[0].d as string;
    expect([...def.matchAll(/'([^']+)'/g)].map((x) => x[1])).toEqual(['overifierad', 'levande', 'drift', 'trasig', 'utanfor_sparr']);
    expect((await db.query("SELECT obj_description('uppdrag_referens'::regclass) AS d")).rows[0].d).toMatch(/^Kategori: REFERENS\./);
  });
  it('M7: inget händelsedatum hämtas ur länkningstiden', async () => {
    for (const r of await rader()) expect(r.handelse_datum).toBeNull();
  });
});

// Risken gäller också direkt SQL som app: frysningen får inte vara en konvention.
describe('0086: rollen app', () => {
  let user: TestUser;
  let company: string;
  let avtal: string;
  const tx = <T>(fn: (c: pg.PoolClient) => Promise<T>) => withTenantTransaction(user.userId, company, fn);
  const skriv = (id: string, sort = 'drive', revision: number | null = null) => tx((c) => c.query(
    'INSERT INTO uppdrag_referens (company_id, contract_id, sort, extern_id, revision) VALUES ($1, $2, $3, $4, $5) RETURNING id, status',
    [company, avtal, sort, id, revision]));
  beforeAll(async () => {
    user = await registerUser('referens0086'); company = await createCompany(user.token, 'Referens AB');
    await createFiscalYear(company, { Authorization: `Bearer ${user.token}` }, { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });
    const act = async (namn: string, kropp: object) => {
      const r = await api.post(`/api/companies/${company}/actions/${namn}`).set('Authorization', `Bearer ${user.token}`).send(kropp);
      expect(r.status, JSON.stringify(r.body)).toBe(200); return r.body.result;
    };
    const p = await act('create_project', { name: 'Referens' });
    avtal = (await act('skapa_uppdrag', { project_id: p.id, name: 'Referens', signed_date: '2026-09-07' })).contract_id;
  });
  it('M5: default, statuscheck och Drive-revision tvingas av databasen', async () => {
    expect((await tx((c) => c.query('SELECT current_user AS roll'))).rows[0].roll).toBe('app');
    const r = (await skriv('default-86')).rows[0]; expect(r.status).toBe('overifierad');
    await tx((c) => c.query("UPDATE uppdrag_referens SET status = 'utanfor_sparr' WHERE company_id = $1 AND id = $2", [company, r.id]));
    await expect(tx((c) => c.query("UPDATE uppdrag_referens SET status = 'okand' WHERE company_id = $1 AND id = $2", [company, r.id]))).rejects.toMatchObject({ constraint: 'uppdrag_referens_status_check' });
    await expect(skriv('mail@x', 'mejl', 3)).rejects.toMatchObject({ constraint: 'uppdrag_referens_revision_bara_drive' });
    await expect(skriv('negativ-86', 'drive', -1)).rejects.toMatchObject({ constraint: 'uppdrag_referens_revision_bara_drive' });
  });
  it('M6: revision kan aldrig skrivas om, inte heller från NULL', async () => {
    for (const rev of [3, null]) {
      const id = (await skriv(`fryst-${rev}`, 'drive', rev)).rows[0].id;
      await expect(tx((c) => c.query('UPDATE uppdrag_referens SET revision = $3 WHERE company_id = $1 AND id = $2', [company, id, rev === null ? 3 : 4]))).rejects.toThrow(/revision/);
      await tx((c) => c.query("UPDATE uppdrag_referens SET status = 'drift' WHERE company_id = $1 AND id = $2", [company, id]));
    }
  });
});
