import { rm } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import { migrate } from '../src/db/migrate.js';
import { applyTestEnv, TEST_DB_NAME, TEST_TEMPLATE_DB_NAME } from './env.js';

type Innehavare = {
  pid: number;
  datname: string;
  application_name: string;
  state: string | null;
  alder_s: number;
};

/**
 * Vägrar starta om någon annan redan är inne i testdatabasen.
 *
 * `DROP DATABASE ... WITH (FORCE)` nedan sparkar ut alla andra anslutningar.
 * Två samtidiga körningar betyder därför att den först startade förlorar sin
 * databas mitt i flykten och rapporterar hundratals fel som ser ut som en
 * kodregression men inte är det. Det hände två gånger 2026-08-24 (106 fel,
 * sedan 215 fel); ensam körning direkt efteråt: 737 passed.
 *
 * Vakten dödar ingenting — att döda anslutningar är precis det som orsakade
 * problemet. Den skriver ut vem som håller databasen och låter människan
 * avgöra om det är en pågående körning eller en kvarglömd anslutning.
 */
const VANTAN_MS = 30_000;
const PAUS_MS = 1_000;

async function innehavare(admin: pg.Client): Promise<Innehavare[]> {
  const { rows } = await admin.query<Innehavare>(
    `select pid, datname, coalesce(application_name, '') as application_name, state,
            round(extract(epoch from (now() - backend_start)))::int as alder_s
       from pg_stat_activity
      where datname = any($1::text[])
        and pid <> pg_backend_pid()
      order by backend_start`,
    [[TEST_DB_NAME, TEST_TEMPLATE_DB_NAME]],
  );
  return rows;
}

async function vagraOmNagonAnnanKor(admin: pg.Client): Promise<void> {
  // Vänta ut en anslutning som håller på att släppa i stället för att falla
  // direkt. `state = 'idle'` är en PROXY för "används inte" — den kan inte
  // skilja en körning som vilar mellan frågor från en pool som stänger. Det
  // som skiljer dem är tiden. Samma resonemang som gitlas.sh:s `flock -w`.
  // Ändlig med flit: en oändlig väntan döljer ett hängt jobb.
  let rows = await innehavare(admin);
  const start = Date.now();
  let vantat = 0;
  while (rows.length > 0 && Date.now() - start < VANTAN_MS) {
    await new Promise((r) => setTimeout(r, PAUS_MS));
    vantat = Math.round((Date.now() - start) / 1000);
    rows = await innehavare(admin);
  }
  if (rows.length === 0) {
    if (vantat > 0) {
      console.log(`[globalSetup] väntade ${vantat} s på att testdatabasen skulle släppas`);
    }
    return;
  }

  const rader = rows
    .map(
      (r) =>
        `  pid ${r.pid}  ${r.datname}  ${r.state ?? 'okänt tillstånd'}` +
        `  ${r.alder_s} s gammal` +
        (r.application_name ? `  (${r.application_name})` : ''),
    )
    .join('\n');

  throw new Error(
    `globalSetup vägrar efter ${Math.round(VANTAN_MS / 1000)} s väntan: ` +
      `${rows.length} annan anslutning håller testdatabasen.\n` +
      `${rader}\n\n` +
      `Nästa steg i globalSetup är DROP DATABASE ... WITH (FORCE), som sparkar ut\n` +
      `dem. Om det är en pågående testkörning skulle den då rapportera hundratals\n` +
      `fel som ser ut som en kodregression men inte är det.\n\n` +
      `Kör sviten ensam. Är anslutningarna kvarglömda från en kraschad körning\n` +
      `(hög ålder, tillstånd "idle") kan de avslutas för hand — men gör det\n` +
      `medvetet, inte automatiskt.`,
  );
}

export default async function globalSetup(): Promise<void> {
  applyTestEnv();

  // Färsk databas varje körning — migrationskedjan bevisas mot ett tomt schema.
  const admin = new pg.Client({ connectionString: process.env.MAINTENANCE_DATABASE_URL });
  await admin.connect();
  await vagraOmNagonAnnanKor(admin);
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
