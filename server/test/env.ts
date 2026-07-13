// Gemensamma testmiljö-defaults för globalSetup (huvudprocessen) och
// setup.ts (varje testworker). ??= gör att CI/utvecklare kan peka om via env.
export const TEST_DB_NAME = 'redovisning_test';

const HOST = process.env.TEST_PG_HOST ?? '127.0.0.1';
const PORT = process.env.TEST_PG_PORT ?? '5433';

export function applyTestEnv(): void {
  process.env.NODE_ENV ??= 'test';
  process.env.JWT_SECRET ??= 'test-secret-0123456789abcdef0123456789abcdef0123456789';
  process.env.DATABASE_URL ??= `postgres://app@${HOST}:${PORT}/${TEST_DB_NAME}`;
  process.env.DATABASE_ADMIN_URL ??= `postgres://postgres@${HOST}:${PORT}/${TEST_DB_NAME}`;
  process.env.MAINTENANCE_DATABASE_URL ??= `postgres://postgres@${HOST}:${PORT}/postgres`;
  process.env.UPLOAD_DIR ??= 'data/test-uploads';
}
