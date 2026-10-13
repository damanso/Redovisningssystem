// Migration 0081 prövad SOM MIGRATION (Story 1.9): kedjan körs till 0080, data
// läggs in i den gamla formen (avgörandet i kolumnen `uppdrag_scopesignal.avgjord`),
// och sedan körs migrationsfilen — den riktiga filen från disk, inte en kopia av
// dess logik.
//
// Tre saker bevisas:
//   * Överföringen. Varje signal med ett svar får en rad med löpnummer 1, märkt
//     överförd och utan vem och när — också på ett avslutat uppdrag och i ett
//     annat bolag. En signal utan svar får ingen rad. En andra körning ändrar
//     ingenting.
//   * Kantkontrollen. En signal som pekar på ett underlag som inte finns vägrar
//     migrationen, och INGENTING av filen har skrivits (en fil är en
//     transaktion, som i db/migrate.ts).
//   * Frysningen. Efter 0081 skrivs kolumnen inte mer, och de överförda
//     värdena står kvar.
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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

async function migration0081(): Promise<string> {
  const nr = (await loadMigrations()).find((m) => m.version === 81);
  expect(nr, 'migration 0081 saknas i kedjan').toBeTruthy();
  return nr!.sql;
}

/** Färsk databas migrerad till 0080 — läget före den här filen. */
async function databasPa0080(namn: string): Promise<pg.Client> {
  await withMaintenance(async (c) => {
    await c.query(`DROP DATABASE IF EXISTS ${namn} WITH (FORCE)`);
    await c.query(`CREATE DATABASE ${namn}`);
  });
  skapade.push(namn);
  const db = new pg.Client({ connectionString: scratchUrl(namn) });
  await db.connect();
  for (const m of (await loadMigrations()).filter((m) => m.version < 81)) await db.query(m.sql);
  return db;
}

interface Bas { companyId: string; userId: string; projectId: string; customerId: string }

async function seedBas(db: pg.Client, nr: number): Promise<Bas> {
  const u = await db.query<{ id: string }>(
    'INSERT INTO users (email, password_hash, name) VALUES ($1, \'x\', \'David\') RETURNING id',
    [`david${nr}@exempel.se`],
  );
  const userId = u.rows[0]!.id;
  const c = await db.query<{ id: string }>(
    'INSERT INTO companies (name, org_number) VALUES ($1, $2) RETURNING id',
    [`Bolag ${nr} AB`, `556000-000${nr}`],
  );
  const companyId = c.rows[0]!.id;
  await db.query('INSERT INTO company_members (company_id, user_id, role) VALUES ($1, $2, $3)',
    [companyId, userId, 'owner']);
  const k = await db.query<{ id: string }>(
    "INSERT INTO customers (company_id, customer_number, name) VALUES ($1, 1, 'ILT Education AB') RETURNING id",
    [companyId],
  );
  const customerId = k.rows[0]!.id;
  const projectId = await nyttProjekt(db, companyId, customerId, 1);
  return { companyId, userId, projectId, customerId };
}

async function nyttProjekt(db: pg.Client, companyId: string, customerId: string, nummer: number): Promise<string> {
  const p = await db.query<{ id: string }>(
    'INSERT INTO projects (company_id, customer_id, number, name) VALUES ($1, $2, $3, $4) RETURNING id',
    [companyId, customerId, nummer, `Uppdrag ${nummer}`],
  );
  return p.rows[0]!.id;
}

async function nyttAvtal(db: pg.Client, bas: Bas, projectId: string, namn: string): Promise<string> {
  const res = await db.query<{ id: string }>(
    `INSERT INTO contracts (company_id, project_id, name, signed_date, created_by)
     VALUES ($1, $2, $3, '2026-01-01', $4) RETURNING id`,
    [bas.companyId, projectId, namn, bas.userId],
  );
  return res.rows[0]!.id;
}

async function nySignal(
  db: pg.Client, companyId: string, contractId: string, avgjord: string | null, underlag: string | null,
): Promise<string> {
  const res = await db.query<{ id: string }>(
    `INSERT INTO uppdrag_scopesignal (company_id, contract_id, fras, avgjord, underlag_ref_id)
     VALUES ($1, $2, 'kan ni även', $3, $4) RETURNING id`,
    [companyId, contractId, avgjord, underlag],
  );
  return res.rows[0]!.id;
}

interface Overford {
  id: string; company_id: string; contract_id: string; signal_id: string; lopnummer: number;
  avgorande: string; overford: boolean; avgjort_av: string | null; avgjort_nar: string | null;
  underlag_ref_id: string | null; tillagg_approval_id: string | null;
}

afterAll(async () => {
  for (const namn of skapade) {
    await withMaintenance((c) => c.query(`DROP DATABASE IF EXISTS ${namn} WITH (FORCE)`));
  }
});

describe('0081 överföringen, idempotensen och frysningen', () => {
  let db: pg.Client;
  const signal: Record<'S1' | 'S2' | 'S3' | 'S4' | 'S5', { id: string; company: string; contract: string; avgjord: string | null; ref: string | null }> = {} as never;
  const raderna = async () => (await db.query<Overford>(
    `SELECT id, company_id, contract_id, signal_id, lopnummer, avgorande, overford, avgjort_av,
            avgjort_nar::text, underlag_ref_id, tillagg_approval_id
       FROM uppdrag_scopeavgorande ORDER BY signal_id`,
  )).rows;
  const kolumnen = async () => Object.fromEntries((await db.query<{ id: string; avgjord: string | null }>(
    'SELECT id, avgjord FROM uppdrag_scopesignal',
  )).rows.map((r) => [r.id, r.avgjord]));

  beforeAll(async () => {
    db = await databasPa0080('redovisning_test_0081_overforing');
    const b1 = await seedBas(db, 1);
    const a1 = await nyttAvtal(db, b1, b1.projectId, 'A1');
    const r1 = (await db.query<{ id: string }>(
      "INSERT INTO uppdrag_referens (company_id, contract_id, sort, extern_id) VALUES ($1, $2, 'mejl', 'CAF1@mail.gmail.com') RETURNING id",
      [b1.companyId, a1],
    )).rows[0]!.id;
    const p2 = await nyttProjekt(db, b1.companyId, b1.customerId, 2);
    const a2 = await nyttAvtal(db, b1, p2, 'A2');
    signal.S1 = { id: await nySignal(db, b1.companyId, a1, 'innanfor', r1), company: b1.companyId, contract: a1, avgjord: 'innanfor', ref: r1 };
    signal.S2 = { id: await nySignal(db, b1.companyId, a1, 'utanfor', null), company: b1.companyId, contract: a1, avgjord: 'utanfor', ref: null };
    signal.S3 = { id: await nySignal(db, b1.companyId, a1, null, null), company: b1.companyId, contract: a1, avgjord: null, ref: null };
    signal.S4 = { id: await nySignal(db, b1.companyId, a2, 'innanfor', null), company: b1.companyId, contract: a2, avgjord: 'innanfor', ref: null };
    // Det andra uppdraget stängs efter signalen: dess avgörande ska ändå föras över.
    await db.query("UPDATE projects SET status = 'closed' WHERE id = $1", [p2]);
    const b2 = await seedBas(db, 2);
    const a3 = await nyttAvtal(db, b2, b2.projectId, 'B1');
    signal.S5 = { id: await nySignal(db, b2.companyId, a3, 'utanfor', null), company: b2.companyId, contract: a3, avgjord: 'utanfor', ref: null };
    await db.query(await migration0081());
  });

  afterAll(async () => {
    await db.end();
  });

  it('a varje signal med svar får en överförd rad utan vem och när; utan svar ingen rad', async () => {
    const r = await raderna();
    const vantade = (['S1', 'S2', 'S4', 'S5'] as const).map((k) => signal[k]);
    expect(r).toHaveLength(4);
    for (const s of vantade) {
      const rad = r.find((x) => x.signal_id === s.id);
      expect(rad, s.id).toMatchObject({
        company_id: s.company, contract_id: s.contract, underlag_ref_id: s.ref, lopnummer: 1,
        avgorande: s.avgjord, overford: true, avgjort_av: null, avgjort_nar: null, tillagg_approval_id: null,
      });
    }
    expect(r.find((x) => x.signal_id === signal.S3.id)).toBeUndefined();
    const kol = await kolumnen();
    for (const s of Object.values(signal)) expect(kol[s.id]).toBe(s.avgjord);
  });

  it('b en andra körning ger samma rader', async () => {
    const fore = await raderna();
    await db.query(await migration0081());
    expect(await raderna()).toEqual(fore);
  });

  it('K6 c efter 0081 fälls en skrivning av kolumnen, och de överförda värdena står kvar', async () => {
    const fore = await kolumnen();
    await expect(db.query("UPDATE uppdrag_scopesignal SET avgjord = 'utanfor' WHERE id = $1", [signal.S1.id]))
      .rejects.toThrow(/skrivs inte sedan 0081/);
    expect(await kolumnen()).toEqual(fore);
    expect(fore[signal.S1.id]).toBe('innanfor');
  });
});

describe('0081 kantkontroll: en signal pekar på ett underlag som inte finns', () => {
  it('vägrar köra, och lämnar ingenting halvgjort', async () => {
    const db = await databasPa0080('redovisning_test_0081_kant');
    try {
      const bas = await seedBas(db, 1);
      const avtal = await nyttAvtal(db, bas, bas.projectId, 'Kant');
      await nySignal(db, bas.companyId, avtal, 'innanfor', '00000000-0000-4000-8000-000000000000');

      await expect(db.query(await migration0081())).rejects.toThrow(/avgör manuellt före 0081/);

      const tabell = await db.query<{ t: string | null }>("SELECT to_regclass('uppdrag_scopeavgorande')::text AS t");
      expect(tabell.rows[0]!.t).toBeNull();
      const nyckel = await db.query(
        "SELECT 1 FROM pg_constraint WHERE conname = 'uppdrag_scopesignal_id_company_contract_uk'",
      );
      expect(nyckel.rowCount).toBe(0);
    } finally {
      await db.end();
    }
  });
});
