import { rm } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll } from 'vitest';
import pg from 'pg';
import { applyTestEnv, TEST_DB_NAME, TEST_TEMPLATE_DB_NAME } from './env.js';

// Körs i varje worker INNAN testfilens imports — config.ts läser env vid import.
applyTestEnv();

// Testisolering: varje testfil får en PRISTIN, seedad databas. Vi återskapar
// TEST_DB_NAME från mallen (skapad i globalSetup) INNAN filens egna beforeAll
// kör — då kan ingen tidigare fil läcka delat/globalt tillstånd in i nästa, och
// sviten blir oberoende av filordning (det som annars gav order-beroende fel
// som k10:s "Cannot read properties of undefined (reading 'id')").
//
// Säkerhet:
//  - Detta beforeAll registreras av setup.ts (en setupFile) och körs därför före
//    testfilens egna beforeAll — dvs. INNAN app-poolen hunnit ansluta (poolen
//    ansluter först vid första frågan). Ingen aktiv anslutning till TEST_DB_NAME
//    finns alltså när vi släpper/återskapar den.
//  - fileParallelism:false (vitest.config.ts) gör att bara en fil kör i taget →
//    DROP/CREATE DATABASE kapplöper aldrig.
//  - WITH (FORCE) kopplar bort ev. kvarlämnade sessioner (PostgreSQL 13+).
beforeAll(async () => {
  const admin = new pg.Client({ connectionString: process.env.MAINTENANCE_DATABASE_URL });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB_NAME} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${TEST_DB_NAME} TEMPLATE ${TEST_TEMPLATE_DB_NAME}`);
  } finally {
    await admin.end();
  }
  // Nollställ även uppladdningskatalogen så inga filer från en tidigare fil ligger kvar.
  await rm(path.resolve(process.env.UPLOAD_DIR!), { recursive: true, force: true });
});

afterAll(async () => {
  // Dynamisk import så att poolen inte skapas förrän env är satt.
  const { closePool } = await import('../src/db/pool.js');
  await closePool();
});
