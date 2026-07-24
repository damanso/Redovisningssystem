import { rm } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import { migrate } from '../src/db/migrate.js';
import { applyTestEnv, TEST_DB_NAME, TEST_TEMPLATE_DB_NAME } from './env.js';

export default async function globalSetup(): Promise<void> {
  applyTestEnv();

  // Färsk databas varje körning — migrationskedjan bevisas mot ett tomt schema.
  const admin = new pg.Client({ connectionString: process.env.MAINTENANCE_DATABASE_URL });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB_NAME} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${TEST_DB_NAME}`);

  const result = await migrate(process.env.DATABASE_ADMIN_URL!);
  console.log(
    `[globalSetup] färsk databas ${TEST_DB_NAME}: ${result.applied.length} migrationer körda: ${result.applied.join(', ')}`,
  );

  // Ta en ögonblicksbild av den migrerade + seedade databasen som MALL. Varje
  // testfil återskapar TEST_DB_NAME från mallen i sitt beforeAll (test/setup.ts),
  // vilket gör sviten oberoende av filordning: ingen fil kan läcka tillstånd in i
  // nästa. migrate() stänger sin klient i finally, så TEST_DB_NAME har noll
  // anslutningar här och kan användas som mall.
  await admin.query(`DROP DATABASE IF EXISTS ${TEST_TEMPLATE_DB_NAME} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${TEST_TEMPLATE_DB_NAME} TEMPLATE ${TEST_DB_NAME}`);
  await admin.end();

  await rm(path.resolve(process.env.UPLOAD_DIR!), { recursive: true, force: true });
}
