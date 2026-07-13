import pg from 'pg';
import { config } from '../config.js';

// node-pg returnerar bigint (int8, OID 20) som sträng och lämnar den orörd.
// Den gamla lösningen — SELECT ...::int i frågorna — KAPADE alla belopp vid
// 2 147 483 647 ören (~21,47 MSEK) med "integer out of range", vilket motsäger
// öre-designen (bigint, upp till ~90 biljoner kr). Vi parsar i stället int8 till
// ett JS-tal en gång här. Belopp asserteras vara säkra heltal vid skrivning
// (assertSafeOre ≤ 2^53), så läsningen är alltid inom säkert intervall.
pg.types.setTypeParser(20, (value) => (value === null ? null : Number(value)));

// API:t ansluter som den lågprivilegierade rollen "app" (icke-superuser, inte
// tabellägare) — det är förutsättningen för att Row Level Security tvingas.
// Migrationsrunnern använder DATABASE_ADMIN_URL separat (se db/migrate.ts).
export const pool = new pg.Pool({
  connectionString: config.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
});

// Utan denna lyssnare blir ett fel på en VILANDE poolad anslutning (t.ex. när
// Postgres startar om) ett ohanterat 'error'-event som kraschar processen.
// pg återansluter transparent vid nästa fråga; vi loggar bara.
pool.on('error', (err) => {
  console.error('Oväntat fel på vilande DB-anslutning:', err.message);
});

/**
 * Fail-fast-kontroll att API:t verkligen kör som en roll som RLS tvingas för.
 * En superuser eller en roll med BYPASSRLS (eller tabellägaren) kringgår
 * tenant-isoleringens andra lager helt och tyst — planen kräver att detta
 * aldrig kan hända oupptäckt. Kastar om rollen är för privilegierad.
 */
export async function assertAppRoleEnforcesRls(): Promise<void> {
  const { rows } = await pool.query<{
    current_user: string;
    rolsuper: boolean;
    rolbypassrls: boolean;
    owns_tenant_table: boolean;
  }>(`
    SELECT current_user,
           r.rolsuper,
           r.rolbypassrls,
           EXISTS (
             SELECT 1 FROM pg_tables
             WHERE tablename = 'companies' AND tableowner = current_user
           ) AS owns_tenant_table
    FROM pg_roles r
    WHERE r.rolname = current_user
  `);
  const info = rows[0];
  if (!info) throw new Error('kunde inte fastställa databasrollens rättigheter');

  const problems: string[] = [];
  if (info.rolsuper) problems.push('rollen är SUPERUSER');
  if (info.rolbypassrls) problems.push('rollen har BYPASSRLS');
  if (info.owns_tenant_table) problems.push('rollen äger tenant-tabellerna (ägaren kringgår RLS)');

  if (problems.length > 0) {
    throw new Error(
      `DATABASE_URL pekar på rollen "${info.current_user}" som kringgår Row Level Security: ` +
        `${problems.join(', ')}. API:t måste ansluta som den lågprivilegierade rollen "app". ` +
        'Använd DATABASE_ADMIN_URL enbart för migrationer.',
    );
  }
}

export async function closePool(): Promise<void> {
  await pool.end();
}
