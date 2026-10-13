// Migration 0082 prövad SOM MIGRATION (Story 1.10): kedjan körs till 0081, en
// bedömning läggs in i dagens form (utan begäran och utan `satt_av`), och sedan
// körs migrationsfilen — den riktiga filen från disk, inte en kopia av dess logik.
//
// Två saker bevisas:
//   * Befintliga rader. Bedömningen står kvar som den var, med NULL i de två nya
//     kolumnerna. Vem som satte den gissas inte (0070:s princip).
//   * Idempotensen. En andra körning ger inga dubbla villkor eller policyer, och
//     raden är oförändrad.
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadMigrations } from '../src/db/migrate.js';

const NAMN = 'redovisning_test_0082';
const VILLKOR = [
  'uppdrag_bedomningsbegaran_contract_fk',
  'uppdrag_bedomningsbegaran_kommentar',
  'uppdrag_bedomningsbegaran_nyckel_uk',
  'uppdrag_bedomning_begaran_fk',
  'uppdrag_bedomning_en_per_begaran',
  'uppdrag_bedomning_begaran_kraver_manniska',
  'uppdrag_bedomning_satt_av_kraver_manniska',
];

async function withMaintenance<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: process.env.MAINTENANCE_DATABASE_URL });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

function scratchUrl(namn: string): string {
  const url = new URL(process.env.DATABASE_ADMIN_URL!);
  url.pathname = `/${namn}`;
  return url.toString();
}

async function migration0082(): Promise<string> {
  const nr = (await loadMigrations()).find((m) => m.version === 82);
  expect(nr, 'migration 0082 saknas i kedjan').toBeTruthy();
  return nr!.sql;
}

/** Färsk databas migrerad till 0081 — läget före den här filen. */
async function databasPa0081(namn: string): Promise<pg.Client> {
  await withMaintenance(async (c) => {
    await c.query(`DROP DATABASE IF EXISTS ${namn} WITH (FORCE)`);
    await c.query(`CREATE DATABASE ${namn}`);
  });
  const db = new pg.Client({ connectionString: scratchUrl(namn) });
  await db.connect();
  for (const m of (await loadMigrations()).filter((m) => m.version < 82)) await db.query(m.sql);
  return db;
}

interface Bas { companyId: string; userId: string; contractId: string }

async function seedBas(db: pg.Client): Promise<Bas> {
  const userId = (await db.query<{ id: string }>(
    "INSERT INTO users (email, password_hash, name) VALUES ('david0082@exempel.se', 'x', 'David') RETURNING id",
  )).rows[0]!.id;
  const companyId = (await db.query<{ id: string }>(
    "INSERT INTO companies (name, org_number) VALUES ('Bolag 0082 AB', '556000-0082') RETURNING id",
  )).rows[0]!.id;
  await db.query('INSERT INTO company_members (company_id, user_id, role) VALUES ($1, $2, $3)',
    [companyId, userId, 'owner']);
  const customerId = (await db.query<{ id: string }>(
    "INSERT INTO customers (company_id, customer_number, name) VALUES ($1, 1, 'ILT Education AB') RETURNING id",
    [companyId],
  )).rows[0]!.id;
  const projectId = (await db.query<{ id: string }>(
    "INSERT INTO projects (company_id, customer_id, number, name) VALUES ($1, $2, 1, 'Uppdrag 1') RETURNING id",
    [companyId, customerId],
  )).rows[0]!.id;
  const contractId = (await db.query<{ id: string }>(
    `INSERT INTO contracts (company_id, project_id, name, signed_date, created_by)
     VALUES ($1, $2, 'A1', '2026-01-01', $3) RETURNING id`,
    [companyId, projectId, userId],
  )).rows[0]!.id;
  return { companyId, userId, contractId };
}

describe('0082 befintliga rader och idempotensen', () => {
  let db: pg.Client;
  let bas: Bas;
  let fore: Record<string, unknown>;
  const raden = async (): Promise<Record<string, unknown>> => (await db.query(
    `SELECT id, company_id, contract_id, period_start::text, period_slut::text, lage, satt_av_manniska,
            kommentar, frysta_siffror, handelse_ref_ids, created_at::text
       FROM uppdrag_bedomning WHERE contract_id = $1`, [bas.contractId],
  )).rows[0] as Record<string, unknown>;
  const nyaKolumner = async () => (await db.query<{ begaran_id: string | null; satt_av: string | null }>(
    'SELECT begaran_id, satt_av FROM uppdrag_bedomning WHERE contract_id = $1', [bas.contractId],
  )).rows;

  beforeAll(async () => {
    db = await databasPa0081(NAMN);
    bas = await seedBas(db);
    await db.query(
      `INSERT INTO uppdrag_bedomning
         (company_id, contract_id, period_start, period_slut, lage, satt_av_manniska, kommentar)
       VALUES ($1, $2, '2026-09-01', '2026-09-30', 'risk', true, 'Satt före 0082')`,
      [bas.companyId, bas.contractId],
    );
    fore = await raden();
    await db.query(await migration0082());
  });

  afterAll(async () => {
    await db.end();
    await withMaintenance((c) => c.query(`DROP DATABASE IF EXISTS ${NAMN} WITH (FORCE)`));
  });

  it('a tabellen finns, och den befintliga bedömningen får NULL i begaran_id och satt_av', async () => {
    const tabell = await db.query<{ t: string | null }>("SELECT to_regclass('uppdrag_bedomningsbegaran')::text AS t");
    expect(tabell.rows[0]!.t).toBe('uppdrag_bedomningsbegaran');
    expect(await nyaKolumner()).toEqual([{ begaran_id: null, satt_av: null }]);
    expect(await raden()).toEqual(fore);
  });

  it('b en andra körning ger inga dubbla villkor eller policyer, och raden är oförändrad', async () => {
    await db.query(await migration0082());
    const antal = await db.query<{ conname: string; n: number }>(
      `SELECT conname, count(*)::int AS n FROM pg_constraint
        WHERE conname = ANY($1::text[]) GROUP BY conname ORDER BY conname`, [VILLKOR],
    );
    expect(antal.rows).toEqual([...VILLKOR].sort().map((conname) => ({ conname, n: 1 })));
    const policyer = await db.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM pg_policies WHERE tablename = 'uppdrag_bedomningsbegaran'",
    );
    expect(policyer.rows[0]!.n).toBe(2);
    expect(await nyaKolumner()).toEqual([{ begaran_id: null, satt_av: null }]);
    expect(await raden()).toEqual(fore);
  });
});
