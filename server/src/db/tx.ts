import type { PoolClient } from 'pg';
import { pool } from './pool.js';
import { NotFoundError } from '../lib/errors.js';

/**
 * Riktig atomicitet: checkar ut EN klient från poolen och kör BEGIN/COMMIT på
 * just den anslutningen. (Den gamla koden körde BEGIN/COMMIT via poolen, så
 * satserna kunde hamna på olika anslutningar — transaktionerna var en illusion.)
 */
export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // anslutningen kan vara trasig — release(err) nedan slänger den
    }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Transaktion med användarkontext för RLS (app.user_id), utan bolagskontext.
 * Används för registrering och "lista mina bolag".
 */
export async function withUserTransaction<T>(
  userId: string,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  return withTransaction(async (client) => {
    await client.query("SELECT set_config('app.user_id', $1, true)", [userId]);
    return fn(client);
  });
}

export type CompanyRole = 'owner' | 'member';

/**
 * Förtroendegränsen för all bolagsdata.
 *
 * 1. Sätter transaktionslokal RLS-kontext (app.user_id + app.company_id).
 * 2. Verifierar medlemskap INNAN någon annan fråga körs — saknas medlemskap
 *    kastas NotFoundError (404, aldrig 200 och aldrig 403 som läcker existens).
 * 3. RLS-policyerna i Postgres är dessutom medlemskapsbaserade, så även om den
 *    här kontrollen skulle kringgås returnerar databasen noll rader.
 *
 * company_id härleds alltså från medlemskapet — aldrig från request-body.
 */
export async function withTenantTransaction<T>(
  userId: string,
  companyId: string,
  fn: (client: PoolClient, role: CompanyRole) => Promise<T>,
): Promise<T> {
  return withTransaction(async (client) => {
    await client.query(
      "SELECT set_config('app.user_id', $1, true), set_config('app.company_id', $2, true)",
      [userId, companyId],
    );
    const membership = await client.query<{ role: CompanyRole }>(
      'SELECT role FROM company_members WHERE user_id = $1 AND company_id = $2',
      [userId, companyId],
    );
    const row = membership.rows[0];
    if (!row) throw new NotFoundError('company');
    return fn(client, row.role);
  });
}
