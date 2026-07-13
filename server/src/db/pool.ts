import pg from 'pg';
import { config } from '../config.js';

// API:t ansluter som den lågprivilegierade rollen "app" (icke-superuser, inte
// tabellägare) — det är förutsättningen för att Row Level Security tvingas.
// Migrationsrunnern använder DATABASE_ADMIN_URL separat (se db/migrate.ts).
export const pool = new pg.Pool({
  connectionString: config.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
});

export async function closePool(): Promise<void> {
  await pool.end();
}
