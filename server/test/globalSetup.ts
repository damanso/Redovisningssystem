import { rm } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import { migrate } from '../src/db/migrate.js';
import { applyTestEnv, TEST_DB_NAME } from './env.js';

export default async function globalSetup(): Promise<void> {
  applyTestEnv();

  // Färsk databas varje körning — migrationskedjan bevisas mot ett tomt schema.
  const admin = new pg.Client({ connectionString: process.env.MAINTENANCE_DATABASE_URL });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB_NAME} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${TEST_DB_NAME}`);
  await admin.end();

  const result = await migrate(process.env.DATABASE_ADMIN_URL!);
  console.log(
    `[globalSetup] färsk databas ${TEST_DB_NAME}: ${result.applied.length} migrationer körda: ${result.applied.join(', ')}`,
  );

  await rm(path.resolve(process.env.UPLOAD_DIR!), { recursive: true, force: true });
}
