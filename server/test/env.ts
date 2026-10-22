// Testmiljö för globalSetup (huvudprocessen) och setup.ts (varje testworker).
//
// VIKTIGT: värdena sätts med `=` (inte `??=`) så att en utvecklares server/.env
// — som migrate.ts:s hoistade `import 'dotenv/config'` hinner ladda innan detta
// körs — ALDRIG kan få testsviten att köra mot en dev-databas. Explicit omval
// sker via TEST_*-variabler, inte via .env.
export const TEST_DB_NAME = process.env.TEST_DB_NAME ?? 'redovisning_test';
// Mall-databas: migreras EN gång i globalSetup och används sedan för att
// återskapa TEST_DB_NAME (färsk + seedad) före varje testfil, så att sviten
// aldrig blir beroende av filordning (se test/setup.ts + globalSetup.ts).
export const TEST_TEMPLATE_DB_NAME = `${TEST_DB_NAME}_template`;

function assertTestDatabaseUrl(name: string, value: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    // URL-felet kan bära hela indatat, inklusive lösenord. Kasta ett eget
    // fel utan cause så att inte heller vitests felutskrift läcker värdet.
    throw new Error(`Testspärr: ${name}: URL:en går inte att tolka`);
  }
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    throw new Error(`Testspärr: ${name}: måste vara en Postgres-URL`);
  }
  // pg låter frågeparametrarna host/port ersätta URL:ens värd/port.
  // Även dessa måste därför ligga inom samma tillåtelselista.
  if (url.hostname !== '127.0.0.1' ||
      url.searchParams.getAll('host').some((host) => host !== '127.0.0.1')) {
    throw new Error(`Testspärr: ${name}: värden måste vara exakt 127.0.0.1`);
  }
  if (url.port !== '5433' ||
      url.searchParams.getAll('port').some((port) => port !== '5433')) {
    throw new Error(`Testspärr: ${name}: porten måste vara exakt 5433`);
  }
}

export function applyTestEnv(): void {
  const host = process.env.TEST_PG_HOST ?? '127.0.0.1';
  const port = process.env.TEST_PG_PORT ?? '5433';
  const databaseUrls = {
    DATABASE_URL: process.env.TEST_DATABASE_URL ?? `postgres://app@${host}:${port}/${TEST_DB_NAME}`,
    DATABASE_ADMIN_URL: process.env.TEST_DATABASE_ADMIN_URL ?? `postgres://postgres@${host}:${port}/${TEST_DB_NAME}`,
    MAINTENANCE_DATABASE_URL: process.env.TEST_MAINTENANCE_DATABASE_URL ?? `postgres://postgres@${host}:${port}/postgres`,
  };
  // Lös först upp ALLA tre adresser och pröva dem före första tilldelningen
  // eller pg-anslutningen i globalSetup/setup/migrate.
  for (const [name, value] of Object.entries(databaseUrls)) {
    assertTestDatabaseUrl(name, value);
  }

  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET =
    process.env.TEST_JWT_SECRET ?? 'test-secret-0123456789abcdef0123456789abcdef0123456789';
  process.env.DATABASE_URL = databaseUrls.DATABASE_URL;
  process.env.DATABASE_ADMIN_URL = databaseUrls.DATABASE_ADMIN_URL;
  process.env.MAINTENANCE_DATABASE_URL = databaseUrls.MAINTENANCE_DATABASE_URL;
  process.env.UPLOAD_DIR = process.env.TEST_UPLOAD_DIR ?? 'data/test-uploads';
  // Kvittobilagornas objektlagring + den publika basen för de signerade
  // länkarna. Basen måste vara satt i test eftersom supertest kör appen utan
  // lyssnande port — vi plockar isär URL:en och kör sökvägen genom supertest.
  // Att den SAKNAS prövas mot publikApiBas() i kvittobilagor.test.ts.
  process.env.RECEIPT_FILES_DIR = process.env.TEST_RECEIPT_FILES_DIR ?? 'data/test-receipt-files';
  process.env.PUBLIC_API_URL = process.env.TEST_PUBLIC_API_URL ?? 'https://redovisning.test';
  process.env.TRUST_PROXY = 'false';
}
