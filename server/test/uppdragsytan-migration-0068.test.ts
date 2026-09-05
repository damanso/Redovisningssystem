// Migration 0068 prövad SOM MIGRATION: kedjan körs till 0067, data läggs in i
// den gamla formen (contracts utan kontrakt_tillstand), och sedan körs
// migrationsfilen — den riktiga filen från disk, inte en kopia av dess logik.
//
// Två saker bevisas, och de hänger ihop:
//   * Kantkontrollen. Ett OSIGNERAT avtal med bekräftade tak går inte att
//     härleda: backfillen skulle lämna kontraktet som 'utkast' med en bekräftad
//     baseline hängande på sig — precis det läge vagrar_baseline_i_utkast()
//     finns för att omöjliggöra. Migrationen vägrar då köra, och INGENTING av
//     den har skrivits (BEGIN/COMMIT per fil i db/migrate.ts).
//   * Backfillen. Ett undertecknat avtal ÄR en överenskommelse och fryses;
//     ett osignerat står kvar som utkast.
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { loadMigrations } from '../src/db/migrate.js';

const skapade: string[] = [];

async function withMaintenance<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: process.env.MAINTENANCE_DATABASE_URL });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

function scratchUrl(namn: string): string {
  const url = new URL(process.env.DATABASE_ADMIN_URL!);
  url.pathname = `/${namn}`;
  return url.toString();
}

async function migration0068(): Promise<string> {
  const alla = await loadMigrations();
  const nr = alla.find((m) => m.version === 68);
  expect(nr, 'migration 0068 saknas i kedjan').toBeTruthy();
  return nr!.sql;
}

/** Färsk databas migrerad till 0067 — exakt Davids läge före den här filen. */
async function databasPa0067(namn: string): Promise<pg.Client> {
  await withMaintenance(async (c) => {
    await c.query(`DROP DATABASE IF EXISTS ${namn} WITH (FORCE)`);
    await c.query(`CREATE DATABASE ${namn}`);
  });
  skapade.push(namn);
  const db = new pg.Client({ connectionString: scratchUrl(namn) });
  await db.connect();
  for (const m of (await loadMigrations()).filter((m) => m.version < 68)) await db.query(m.sql);
  return db;
}

interface Bas { companyId: string; userId: string; projectId: string }

async function seedBas(db: pg.Client): Promise<Bas> {
  const u = await db.query<{ id: string }>(
    "INSERT INTO users (email, password_hash, name) VALUES ('david@exempel.se', 'x', 'David') RETURNING id",
  );
  const userId = u.rows[0]!.id;
  const c = await db.query<{ id: string }>(
    "INSERT INTO companies (name, org_number) VALUES ('Locollabs AB', '556000-0001') RETURNING id",
  );
  const companyId = c.rows[0]!.id;
  await db.query('INSERT INTO company_members (company_id, user_id, role) VALUES ($1, $2, $3)',
    [companyId, userId, 'owner']);
  const k = await db.query<{ id: string }>(
    "INSERT INTO customers (company_id, customer_number, name) VALUES ($1, 1, 'ILT Education AB') RETURNING id",
    [companyId],
  );
  const p = await db.query<{ id: string }>(
    "INSERT INTO projects (company_id, customer_id, number, name) VALUES ($1, $2, 1, 'ILT — Fas 2') RETURNING id",
    [companyId, k.rows[0]!.id],
  );
  return { companyId, userId, projectId: p.rows[0]!.id };
}

async function nyttAvtal(
  db: pg.Client, bas: Bas, namn: string, signeratDatum: string | null,
): Promise<string> {
  const res = await db.query<{ id: string }>(
    `INSERT INTO contracts (company_id, project_id, name, signed_date, created_by)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [bas.companyId, bas.projectId, namn, signeratDatum, bas.userId],
  );
  return res.rows[0]!.id;
}

async function nyDel(
  db: pg.Client, bas: Bas, avtal: string, code: string, bekraftat: boolean,
): Promise<string> {
  const res = await db.query<{ id: string }>(
    `INSERT INTO contract_parts (company_id, contract_id, code, name, cap_hours, cap_confirmed, valid_from)
     VALUES ($1, $2, $3, $3, 32, $4, DATE '2026-01-01') RETURNING id`,
    [bas.companyId, avtal, code, bekraftat],
  );
  return res.rows[0]!.id;
}

afterAll(async () => {
  for (const namn of skapade) {
    await withMaintenance((c) => c.query(`DROP DATABASE IF EXISTS ${namn} WITH (FORCE)`));
  }
});

describe('0068 kantkontroll: osignerat avtal med bekräftade tak', () => {
  it('vägrar köra, och lämnar ingenting halvgjort', async () => {
    const db = await databasPa0067('redovisning_test_0068_kant');
    try {
      const bas = await seedBas(db);
      const osignerat = await nyttAvtal(db, bas, 'Avtal utan underskrift', null);
      await nyDel(db, bas, osignerat, '2A', true);

      await expect(db.query(await migration0068()))
        .rejects.toThrow(/osignerat avtal har bekraftade tak — avgor manuellt fore 0068/);

      // Filen körs i en transaktion (db/migrate.ts) — alltså finns varken
      // kolumnerna eller tabellerna kvar efter det avbrutna försöket.
      const kolumn = await db.query(
        "SELECT 1 FROM information_schema.columns WHERE table_name = 'contracts' AND column_name = 'kontrakt_tillstand'",
      );
      expect(kolumn.rowCount).toBe(0);
      const tabell = await db.query(
        "SELECT 1 FROM information_schema.tables WHERE table_name = 'uppdrag_leverabel'",
      );
      expect(tabell.rowCount).toBe(0);
    } finally {
      await db.end();
    }
  });
});

describe('0068 backfill: undertecknade avtal fryses', () => {
  it('signerat blir fryst, osignerat står kvar som utkast — och en andra körning ändrar inget', async () => {
    const db = await databasPa0067('redovisning_test_0068_backfill');
    try {
      const bas = await seedBas(db);
      const signerat = await nyttAvtal(db, bas, 'ILT ramavtal 2026', '2026-01-01');
      const osignerat = await nyttAvtal(db, bas, 'Utkast till nytt avtal', null);
      // Bekräftat tak på det SIGNERADE avtalet: det är det läget backfillen
      // finns för — efter frysningen är taket en giltig baseline.
      await nyDel(db, bas, signerat, '2A', true);
      await nyDel(db, bas, osignerat, '1', false);

      const sql = await migration0068();
      await db.query(sql);

      const tillstand = async () => Object.fromEntries((await db.query<{ id: string; t: string }>(
        'SELECT id, kontrakt_tillstand AS t FROM contracts',
      )).rows.map((r) => [r.id, r.t]));
      expect(await tillstand()).toEqual({ [signerat]: 'fryst', [osignerat]: 'utkast' });

      // Det bekräftade taket överlevde: backfillen rör aldrig contract_parts.
      const del = await db.query<{ cap_confirmed: boolean; change_reason: string | null }>(
        "SELECT cap_confirmed, change_reason FROM contract_parts WHERE contract_id = $1", [signerat],
      );
      expect(del.rows[0]).toEqual({ cap_confirmed: true, change_reason: null });

      // Andra körningen: samma tillstånd, inga nya rader, inget fel.
      await db.query(sql);
      expect(await tillstand()).toEqual({ [signerat]: 'fryst', [osignerat]: 'utkast' });
      expect((await db.query('SELECT count(*)::int AS n FROM contract_parts')).rows[0]).toEqual({ n: 2 });
    } finally {
      await db.end();
    }
  });

  it('efter backfillen gäller spärrarna: utkastet får inget bekräftat tak, frysningen backas inte', async () => {
    const db = await databasPa0067('redovisning_test_0068_efter');
    try {
      const bas = await seedBas(db);
      const signerat = await nyttAvtal(db, bas, 'Signerat', '2026-01-01');
      const osignerat = await nyttAvtal(db, bas, 'Osignerat', null);
      await db.query(await migration0068());

      await expect(nyDel(db, bas, osignerat, 'X', true))
        .rejects.toThrow(/bekräftat tak kräver fryst kontrakt/);
      await expect(db.query(
        "UPDATE contracts SET kontrakt_tillstand = 'utkast' WHERE id = $1", [signerat],
      )).rejects.toThrow(/ett fryst kontrakt går inte tillbaka till utkast/);
      // Och på det frysta avtalet går taket att bekräfta.
      await expect(nyDel(db, bas, signerat, 'Y', true)).resolves.toBeTruthy();
    } finally {
      await db.end();
    }
  });
});
