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

const HOST = process.env.TEST_PG_HOST ?? '127.0.0.1';
const PORT = process.env.TEST_PG_PORT ?? '5433';

export function applyTestEnv(): void {
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET =
    process.env.TEST_JWT_SECRET ?? 'test-secret-0123456789abcdef0123456789abcdef0123456789';
  process.env.DATABASE_URL =
    process.env.TEST_DATABASE_URL ?? `postgres://app@${HOST}:${PORT}/${TEST_DB_NAME}`;
  process.env.DATABASE_ADMIN_URL =
    process.env.TEST_DATABASE_ADMIN_URL ?? `postgres://postgres@${HOST}:${PORT}/${TEST_DB_NAME}`;
  process.env.MAINTENANCE_DATABASE_URL =
    process.env.TEST_MAINTENANCE_DATABASE_URL ?? `postgres://postgres@${HOST}:${PORT}/postgres`;
  process.env.UPLOAD_DIR = process.env.TEST_UPLOAD_DIR ?? 'data/test-uploads';
  process.env.TRUST_PROXY = 'false';
}
