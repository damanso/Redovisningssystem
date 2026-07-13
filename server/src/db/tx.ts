import type { Pool, PoolClient } from 'pg';
import { pool } from './pool.js';
import { NotFoundError } from '../lib/errors.js';

export type Queryable = Pool | PoolClient;
export type CompanyRole = 'owner' | 'member';

/**
 * Sätter transaktionslokal RLS-kontext (app.user_id + valfritt app.company_id).
 * En enda plats för GUC-namnen — den gamla koden hade dem inlinade på flera
 * ställen, så en namnändring kunde missas i en kopia.
 */
export async function setTenantContext(
  client: PoolClient,
  userId: string,
  companyId?: string,
): Promise<void> {
  await client.query(
    "SELECT set_config('app.user_id', $1, true), set_config('app.company_id', $2, true)",
    [userId, companyId ?? ''],
  );
}

/** Slår upp medlemskapet. En enda plats för medlemskapsfrågan (lager 1 + 1b). */
export async function fetchMembership(
  client: PoolClient,
  userId: string,
  companyId: string,
): Promise<{ role: CompanyRole } | null> {
  const result = await client.query<{ role: CompanyRole }>(
    'SELECT role FROM company_members WHERE user_id = $1 AND company_id = $2',
    [userId, companyId],
  );
  return result.rows[0] ?? null;
}

/**
 * Riktig atomicitet: checkar ut EN klient från poolen och kör BEGIN/COMMIT på
 * just den anslutningen. (Den gamla koden körde BEGIN/COMMIT via poolen, så
 * satserna kunde hamna på olika anslutningar — transaktionerna var en illusion.)
 */
export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  let rollbackFailed = false;
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Anslutningen är trasig/aborterad — markera så att den förstörs nedan
      // i stället för att återlämnas till poolen och förgifta nästa request.
      rollbackFailed = true;
    }
    throw err;
  } finally {
    // release(true) förstör klienten i stället för att återanvända den.
    client.release(rollbackFailed);
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
    await setTenantContext(client, userId);
    return fn(client);
  });
}

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
    await setTenantContext(client, userId, companyId);
    const membership = await fetchMembership(client, userId, companyId);
    if (!membership) throw new NotFoundError('company');
    return fn(client, membership.role);
  });
}
