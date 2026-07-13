// Acceptanskriterium (KICKOFF §4, Fas 0): "En migrationsrunner med versions-
// tabell kör hela kedjan på en TOM databas utan fel; extensions skapas i
// första migrationen." Plus skydd mot gamla repots buggar: dubbelnumrering
// och tyst schema-drift.
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadMigrations, migrate } from '../src/db/migrate.js';

const SCRATCH_DB = 'redovisning_test_runner';

function scratchUrl(): string {
  const url = new URL(process.env.DATABASE_ADMIN_URL!);
  url.pathname = `/${SCRATCH_DB}`;
  return url.toString();
}

async function withMaintenance<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: process.env.MAINTENANCE_DATABASE_URL });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

describe('migrationsrunnern mot en tom databas', () => {
  beforeAll(async () => {
    await withMaintenance(async (c) => {
      await c.query(`DROP DATABASE IF EXISTS ${SCRATCH_DB} WITH (FORCE)`);
      await c.query(`CREATE DATABASE ${SCRATCH_DB}`);
    });
  });

  afterAll(async () => {
    await withMaintenance((c) => c.query(`DROP DATABASE IF EXISTS ${SCRATCH_DB} WITH (FORCE)`));
  });

  it('kör hela kedjan utan fel och registrerar versionerna', async () => {
    const result = await migrate(scratchUrl());
    expect(result.applied).toEqual([
      '0001_extensions.sql',
      '0002_identity_and_tenancy.sql',
      '0003_audit_log.sql',
      '0004_files.sql',
    ]);

    const client = new pg.Client({ connectionString: scratchUrl() });
    await client.connect();
    try {
      const extensions = await client.query(
        "SELECT extname FROM pg_extension WHERE extname IN ('uuid-ossp', 'pg_trgm') ORDER BY extname",
      );
      expect(extensions.rows.map((r) => r.extname)).toEqual(['pg_trgm', 'uuid-ossp']);
      const versions = await client.query('SELECT version FROM schema_migrations ORDER BY version');
      expect(versions.rows.map((r) => r.version)).toEqual([1, 2, 3, 4]);
    } finally {
      await client.end();
    }
  });

  it('omkörning är idempotent', async () => {
    const result = await migrate(scratchUrl());
    expect(result.applied).toEqual([]);
    expect(result.alreadyApplied).toBe(4);
  });
});

describe('skydd mot gamla repots migrationsbuggar', () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'migrations-'));
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('vägrar dubbelnumrerade migrationer', async () => {
    await writeFile(path.join(dir, '0001_first.sql'), 'SELECT 1;');
    await writeFile(path.join(dir, '0001_second.sql'), 'SELECT 2;');
    await expect(loadMigrations(dir)).rejects.toThrow(/Dubbelnumrerade/);
  });

  it('vägrar ogiltiga filnamn', async () => {
    const badDir = await mkdtemp(path.join(tmpdir(), 'migrations-bad-'));
    await writeFile(path.join(badDir, 'setup.sql'), 'SELECT 1;');
    await expect(loadMigrations(badDir)).rejects.toThrow(/Ogiltigt migrationsfilnamn/);
    await rm(badDir, { recursive: true, force: true });
  });

  it('vägrar när en redan körd migration har ändrats (checksumma)', async () => {
    const driftDb = 'redovisning_test_drift';
    const driftDir = await mkdtemp(path.join(tmpdir(), 'migrations-drift-'));
    const file = path.join(driftDir, '0001_init.sql');
    await writeFile(file, 'CREATE TABLE t (id int);');

    const url = new URL(process.env.DATABASE_ADMIN_URL!);
    url.pathname = `/${driftDb}`;

    await withMaintenance(async (c) => {
      await c.query(`DROP DATABASE IF EXISTS ${driftDb} WITH (FORCE)`);
      await c.query(`CREATE DATABASE ${driftDb}`);
    });
    try {
      await migrate(url.toString(), { dir: driftDir });
      await writeFile(file, 'CREATE TABLE t (id int, smygkolumn text);');
      await expect(migrate(url.toString(), { dir: driftDir })).rejects.toThrow(/[Cc]hecksumma/);
    } finally {
      await withMaintenance((c) => c.query(`DROP DATABASE IF EXISTS ${driftDb} WITH (FORCE)`));
      await rm(driftDir, { recursive: true, force: true });
    }
  });
});
