// Ops-skript: sätter lösenord + minimala rättigheter på den lågprivilegierade
// rollen "app" i en managed Postgres (t.ex. Railway) där lösenordsinloggning krävs.
//
// Körs av docker/start.sh EFTER migreringarna (som skapar rollen `app` via
// migration 0001) och FÖRE serverstart. Idempotent — kan köras vid varje deploy.
//
// Precis som migrate.ts läser det env DIREKT (DATABASE_ADMIN_URL + APP_DB_PASSWORD)
// och importerar INTE config.ts, eftersom det inte får kräva JWT_SECRET.
//
// Rollen `app` är avsiktligt icke-superuser och icke-ägare — det är förutsättningen
// för att Row Level Security tvingas (se assertAppRoleEnforcesRls i pool.ts).
import 'dotenv/config';
import pg from 'pg';

const adminUrl = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
const password = process.env.APP_DB_PASSWORD;

if (!adminUrl) {
  console.error('FATAL: DATABASE_ADMIN_URL (eller DATABASE_URL) måste vara satt');
  process.exit(1);
}
if (!password || password.length < 16) {
  console.error(
    'FATAL: APP_DB_PASSWORD måste vara satt och minst 16 tecken ' +
      '(generera: openssl rand -hex 24)',
  );
  process.exit(1);
}

const client = new pg.Client({ connectionString: adminUrl });
await client.connect();
try {
  const db = (await client.query<{ db: string }>('SELECT current_database() AS db')).rows[0]!.db;
  // escapeLiteral/escapeIdentifier: säker escaping av godtyckliga värden i DDL
  // (DDL kan inte parametriseras med $1). pg quotar och escapar korrekt.
  await client.query(`ALTER ROLE app WITH LOGIN PASSWORD ${client.escapeLiteral(password)}`);
  await client.query(`GRANT CONNECT ON DATABASE ${client.escapeIdentifier(db)} TO app`);
  await client.query('GRANT USAGE ON SCHEMA public TO app');
  console.log('OK: app-rollen provisionerad (lösenord + connect + usage).');
} finally {
  await client.end();
}
