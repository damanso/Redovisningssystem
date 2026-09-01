// Migration 0062 prövad som migration: kedjan körs till 0061, data läggs in i
// den GAMLA formen (billable/invoiced, ingen status), och sedan körs
// migrationsfilen — den riktiga filen från disk, inte en kopia av dess logik.
//
// Två saker bevisas: backfillens tre klasser, och julidatafixen (faktura 27,
// 20 + 2 poster). Plus Davids villkor: filen körs TVÅ gånger och den andra
// körningen får varken ändra ett värde eller lägga en enda auditrad till.
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadMigrations } from '../src/db/migrate.js';

const SCRATCH_DB = 'redovisning_test_0062';

function scratchUrl(): string {
  const url = new URL(process.env.DATABASE_ADMIN_URL!);
  url.pathname = `/${SCRATCH_DB}`;
  return url.toString();
}

async function withMaintenance<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: process.env.MAINTENANCE_DATABASE_URL });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

interface TidRad {
  id: string;
  description: string;
  minutes: number;
  billable_minutes: number;
  status: string;
  source: string;
  billable: boolean;
  invoiced: boolean;
  invoice_id: string | null;
  adjustment_reason: string | null;
}

let db: pg.Client;
let migration0062 = '';
let fakturaId = '';
const JULI_ARBETE = 20;

async function tidposter(): Promise<Map<string, TidRad>> {
  const res = await db.query<TidRad>(
    `SELECT id, description, minutes, billable_minutes, status, source, billable, invoiced,
            invoice_id, adjustment_reason
       FROM time_entries ORDER BY description`,
  );
  return new Map(res.rows.map((r) => [r.description, r]));
}

async function auditrader(): Promise<{ entity_id: string; details: Record<string, unknown> }[]> {
  const res = await db.query<{ entity_id: string; details: Record<string, unknown> }>(
    "SELECT entity_id, details FROM audit_log WHERE action = 'time_entry.migrated_0062' ORDER BY entity_id",
  );
  return res.rows;
}

beforeAll(async () => {
  const alla = await loadMigrations();
  const fore = alla.filter((m) => m.version < 62);
  const nr62 = alla.find((m) => m.version === 62);
  expect(nr62, 'migration 0062 saknas i kedjan').toBeTruthy();
  migration0062 = nr62!.sql;

  await withMaintenance(async (c) => {
    await c.query(`DROP DATABASE IF EXISTS ${SCRATCH_DB} WITH (FORCE)`);
    await c.query(`CREATE DATABASE ${SCRATCH_DB}`);
  });
  db = new pg.Client({ connectionString: scratchUrl() });
  await db.connect();
  for (const m of fore) await db.query(m.sql);

  // Databasen står nu på 0061 — exakt Davids läge före den här migrationen.
  const u = await db.query<{ id: string }>(
    `INSERT INTO users (email, password_hash, name) VALUES ('david@exempel.se', 'x', 'David') RETURNING id`,
  );
  const userId = u.rows[0]!.id;
  const c = await db.query<{ id: string }>(
    `INSERT INTO companies (name, org_number) VALUES ('Locollabs AB', '556000-0001') RETURNING id`,
  );
  const companyId = c.rows[0]!.id;
  await db.query(`INSERT INTO company_members (company_id, user_id, role) VALUES ($1, $2, 'owner')`,
    [companyId, userId]);
  const k = await db.query<{ id: string }>(
    `INSERT INTO customers (company_id, customer_number, name) VALUES ($1, 1, 'ILT Education AB') RETURNING id`,
    [companyId],
  );
  const kundId = k.rows[0]!.id;
  const p = await db.query<{ id: string }>(
    `INSERT INTO projects (company_id, customer_id, number, name) VALUES ($1, $2, 1, 'Fas 2A') RETURNING id`,
    [companyId, kundId],
  );
  const projektId = p.rows[0]!.id;
  const p2 = await db.query<{ id: string }>(
    `INSERT INTO projects (company_id, customer_id, number, name) VALUES ($1, $2, 2, 'Annat uppdrag') RETURNING id`,
    [companyId, kundId],
  );
  const annatProjekt = p2.rows[0]!.id;
  // Julifakturan. Numret mot kund är 27 (internnumret här är detsamma, så den
  // genererade effective_invoice_number blir 27) och den är daterad i juli.
  const f = await db.query<{ id: string }>(
    `INSERT INTO invoices (company_id, customer_id, invoice_number, invoice_date, due_date,
                           status, total_ore, created_by, project_id)
     VALUES ($1, $2, 27, DATE '2026-07-31', DATE '2026-08-30', 'paid', 4320250, $3, $4) RETURNING id`,
    [companyId, kundId, userId, projektId],
  );
  fakturaId = f.rows[0]!.id;

  const tid = async (projekt: string, datum: string, minuter: number, text: string,
    billable = true, invoiced = false) => {
    await db.query(
      `INSERT INTO time_entries (company_id, project_id, work_date, minutes, description, billable, invoiced, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [companyId, projekt, datum, minuter, text, billable, invoiced, userId],
    );
  };

  // De 20 posterna som fakturerades men aldrig markerades (PRD §1 rad 1).
  for (let i = 1; i <= JULI_ARBETE; i++) {
    await tid(projektId, `2026-07-${String(i).padStart(2, '0')}`, 60 + i, `Uppdrag juli dag ${i}`);
  }
  // De två som aldrig skulle ha fakturerats (PRD §1 rad 2).
  await tid(projektId, '2026-07-21', 45, 'Egen administration och fakturering');
  await tid(projektId, '2026-07-22', 90, 'Uppdatering av supportmatris');

  // Backfillens tre klasser, utanför juliperioden så datafixen inte rör dem.
  await tid(projektId, '2026-06-01', 120, 'Debiterbar och ofakturerad', true, false);
  await tid(projektId, '2026-06-02', 30, 'Ej debiterbar sedan tidigare', false, false);
  await tid(projektId, '2026-06-03', 60, 'Redan fakturerad sedan tidigare', true, true);

  // Negativ kontroll: samma period, ANNAT uppdrag än fakturans. Ska stå orörd.
  await tid(annatProjekt, '2026-07-10', 75, 'Juli på annat uppdrag');

  await db.query(migration0062);
});

afterAll(async () => {
  await db?.end();
  await withMaintenance((c) => c.query(`DROP DATABASE IF EXISTS ${SCRATCH_DB} WITH (FORCE)`));
});

describe('0062 backfill: tre klasser härledda ur raden själv', () => {
  it('debiterbar och ofakturerad blir godkänd med sina minuter', async () => {
    const rad = (await tidposter()).get('Debiterbar och ofakturerad')!;
    expect(rad.status).toBe('godkand');
    expect(rad.billable_minutes).toBe(120);
    expect(rad.billable).toBe(true);
    expect(rad.invoiced).toBe(false);
    expect(rad.source).toBe('manuell');
  });

  it('ej debiterbar blir ignorerad med noll debiterbara minuter', async () => {
    const rad = (await tidposter()).get('Ej debiterbar sedan tidigare')!;
    expect(rad.status).toBe('ignorerad');
    expect(rad.billable_minutes).toBe(0);
    expect(rad.minutes).toBe(30); // registrerad tid är oförändrad
    expect(rad.billable).toBe(false);
  });

  it('redan fakturerad blir fakturerad', async () => {
    const rad = (await tidposter()).get('Redan fakturerad sedan tidigare')!;
    expect(rad.status).toBe('fakturerad');
    expect(rad.billable_minutes).toBe(60);
    expect(rad.invoiced).toBe(true);
  });

  it('status och debiterbara minuter är NOT NULL, och statusvärdena är låsta', async () => {
    const kolumner = await db.query<{ column_name: string; is_nullable: string; column_default: string | null }>(
      `SELECT column_name, is_nullable, column_default FROM information_schema.columns
        WHERE table_name = 'time_entries' AND column_name IN ('status','billable_minutes','source')
        ORDER BY column_name`,
    );
    expect(kolumner.rows.map((r) => [r.column_name, r.is_nullable])).toEqual([
      ['billable_minutes', 'NO'], ['source', 'NO'], ['status', 'NO'],
    ]);
    expect(kolumner.rows.find((r) => r.column_name === 'source')!.column_default).toContain('manuell');
    await expect(db.query(
      `UPDATE time_entries SET status = 'klar' WHERE description = 'Debiterbar och ofakturerad'`,
    )).rejects.toThrow(/time_entries_status_check/);
  });

  it('låset kan aldrig peka på en annan tenants faktura (komposit-FK som 0047)', async () => {
    const fk = await db.query<{ conname: string }>(
      `SELECT conname FROM pg_constraint
        WHERE conrelid = 'time_entries'::regclass AND conname = 'time_entries_invoice_fk'`,
    );
    expect(fk.rowCount).toBe(1);
  });
});

describe('0062 datafix: julifakturan (faktura 27)', () => {
  it('de 20 posterna låses till fakturan', async () => {
    const rader = [...(await tidposter()).values()].filter((r) => r.description.startsWith('Uppdrag juli'));
    expect(rader).toHaveLength(JULI_ARBETE);
    for (const rad of rader) {
      expect(rad.status, rad.description).toBe('fakturerad');
      expect(rad.invoice_id, rad.description).toBe(fakturaId);
      expect(rad.invoiced).toBe(true);
      expect(rad.billable_minutes).toBe(rad.minutes);
    }
  });

  it('de två icke debiterbara omklassas med skäl i klartext', async () => {
    const alla = await tidposter();
    const adm = alla.get('Egen administration och fakturering')!;
    const matris = alla.get('Uppdatering av supportmatris')!;
    for (const rad of [adm, matris]) {
      expect(rad.status, rad.description).toBe('ignorerad');
      expect(rad.billable_minutes).toBe(0);
      expect(rad.billable).toBe(false);
      expect(rad.invoice_id).toBeNull();
    }
    expect(adm.adjustment_reason).toContain('administration');
    expect(matris.adjustment_reason).toContain('supportmatris');
    // Registrerad tid rörs aldrig — det som hände hände.
    expect(adm.minutes).toBe(45);
    expect(matris.minutes).toBe(90);
  });

  it('samma period på ett annat uppdrag rörs inte', async () => {
    const rad = (await tidposter()).get('Juli på annat uppdrag')!;
    expect(rad.status).toBe('godkand');
    expect(rad.invoice_id).toBeNull();
  });

  it('varje ändrad rad är spårbar per rad i auditloggen', async () => {
    const rader = await auditrader();
    expect(rader).toHaveLength(JULI_ARBETE + 2);
    const till = rader.map((r) => r.details.till_status as string);
    expect(till.filter((s) => s === 'fakturerad')).toHaveLength(JULI_ARBETE);
    expect(till.filter((s) => s === 'ignorerad')).toHaveLength(2);
    for (const r of rader) {
      expect(r.details.migration).toBe('0062_tidpost_livscykel');
      expect(r.details.fran_status).toBe('godkand');
    }
    const ids = new Set(rader.map((r) => r.entity_id));
    expect(ids.size).toBe(JULI_ARBETE + 2); // en rad per tidpost, inte en klumpsumma
  });
});

describe('0062 är idempotent — Davids villkor', () => {
  it('en andra körning ändrar inget värde och lägger ingen auditrad', async () => {
    const fore = await tidposter();
    const foreAudit = await auditrader();

    await db.query(migration0062);

    const efter = await tidposter();
    const efterAudit = await auditrader();
    expect(efterAudit).toHaveLength(foreAudit.length);
    expect([...efter.values()]).toEqual([...fore.values()]);
  });
});
