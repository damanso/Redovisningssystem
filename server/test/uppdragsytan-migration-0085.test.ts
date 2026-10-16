// Story 2.1 (FR-34, B-16): ett datum på en avtalsdel kräver sin precision.
//
// RISKEN: ett datum utan precision tvingar varje vy att gissa hur exakt avtalet
// daterade delen, och gissningen blir en dag som avtalet aldrig nämnt. Regeln
// står därför i två lager, och båda provas här:
//
//   * **Schemat (0085)** — körd från disk mot en databas på 0084, med planterade
//     regelbrott som negativ kontroll: kantkontrollen fäller med en
//     driftbeskrivning och lämnar raderna orörda; efter driftens rättelse går
//     migrationen igenom, validerad och idempotent; som rollen `app` fälls en
//     ny rad av Postgres själv.
//   * **Indatat (zod)** — de tre ingångarna som bär avtalsdelens fält avvisar
//     ett datum utan precision före kön, så att inget förslag kan få Davids ja
//     och sedan falla i verkställigheten.
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadMigrations } from '../src/db/migrate.js';
import { withTenantTransaction } from '../src/db/tx.js';
import { api, createCompany, createFiscalYear, registerUser, withAdmin, type TestUser } from './helpers.js';

const VILLKOR = 'contract_parts_datum_kraver_precision';

const fel = (p: Promise<unknown>) =>
  p.then(() => null, (e: unknown) => e as { code?: string; constraint?: string; message: string });

async function migration(nr: number): Promise<string> {
  const m = (await loadMigrations()).find((x) => x.version === nr);
  expect(m, `migration ${String(nr).padStart(4, '0')} saknas i kedjan`).toBeTruthy();
  if (!m) throw new Error(`migration ${nr} saknas`);
  return m.sql;
}

async function withMaintenance<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = new pg.Client({ connectionString: process.env.MAINTENANCE_DATABASE_URL });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

function scratchUrl(namn: string): string {
  const url = new URL(process.env.DATABASE_ADMIN_URL!);
  url.pathname = `/${namn}`;
  return url.toString();
}

const skapade: string[] = [];

/** Bara provets fasta databasnamn används, aldrig indata från en användare. */
async function databasPa0084(namn: string): Promise<pg.Client> {
  await withMaintenance(async (c) => {
    await c.query(`DROP DATABASE IF EXISTS ${namn} WITH (FORCE)`);
    await c.query(`CREATE DATABASE ${namn}`);
  });
  skapade.push(namn);
  const db = new pg.Client({ connectionString: scratchUrl(namn) });
  await db.connect();
  try {
    for (const m of (await loadMigrations()).filter((x) => x.version < 85)) await db.query(m.sql);
    return db;
  } catch (e) {
    await db.end();
    throw e;
  }
}

interface Bas { companyId: string; userId: string; projectId: string }

async function seedBas(db: pg.Client): Promise<Bas> {
  const u = await db.query<{ id: string }>(
    "INSERT INTO users (email, password_hash, name) VALUES ('precision@exempel.se', 'x', 'Precisionsprov') RETURNING id",
  );
  const userId = u.rows[0]!.id;
  const c = await db.query<{ id: string }>(
    "INSERT INTO companies (name, org_number) VALUES ('Locollabs AB', '556000-0001') RETURNING id",
  );
  const companyId = c.rows[0]!.id;
  await db.query("INSERT INTO company_members (company_id, user_id, role) VALUES ($1, $2, 'owner')",
    [companyId, userId]);
  const k = await db.query<{ id: string }>(
    "INSERT INTO customers (company_id, customer_number, name) VALUES ($1, 1, 'Precisionskund AB') RETURNING id",
    [companyId],
  );
  const p = await db.query<{ id: string }>(
    "INSERT INTO projects (company_id, customer_id, number, name) VALUES ($1, $2, 1, 'Precisionsuppdrag') RETURNING id",
    [companyId, k.rows[0]!.id],
  );
  return { companyId, userId, projectId: p.rows[0]!.id };
}

async function nyttAvtal(db: pg.Client, bas: Bas, namn: string): Promise<string> {
  const res = await db.query<{ id: string }>(
    `INSERT INTO contracts (company_id, project_id, name, signed_date, created_by)
     VALUES ($1, $2, $3, DATE '2026-09-07', $4) RETURNING id`,
    [bas.companyId, bas.projectId, namn, bas.userId],
  );
  return res.rows[0]!.id;
}

afterAll(async () => {
  for (const namn of skapade) {
    await withMaintenance((c) => c.query(`DROP DATABASE IF EXISTS ${namn} WITH (FORCE)`));
  }
});

it('(M1) 0085 har kantkontroll före NOT VALID, valideras i samma fil och skriver inga rader', async () => {
  expect((await loadMigrations()).find((m) => m.version === 85)).toMatchObject({
    name: 'datumprecision', filename: '0085_datumprecision.sql',
  });
  const kod = (await migration(85)).replace(/--.*$/gm, '');
  expect(kod).toMatch(new RegExp(`ADD CONSTRAINT ${VILLKOR}\\s+CHECK[\\s\\S]*?\\)\\s*NOT VALID;`));
  expect(kod).toContain(`VALIDATE CONSTRAINT ${VILLKOR}`);
  expect(kod.indexOf('RAISE EXCEPTION')).toBeGreaterThanOrEqual(0);
  expect(kod.indexOf('RAISE EXCEPTION')).toBeLessThan(kod.indexOf('ADD CONSTRAINT'));
  expect(kod.indexOf('VALIDATE CONSTRAINT')).toBeLessThan(kod.indexOf('COMMENT ON CONSTRAINT'));
  for (const forbjudet of [/\bINSERT\b/i, /\bUPDATE\b/i, /action_approvals/i]) {
    expect(kod).not.toMatch(forbjudet);
  }
});

describe('(M2, M3) 0085 körs från disk mot en databas på 0084', () => {
  let db: pg.Client;
  let bas: Bas;
  const planterade: string[] = [];

  const villkor = async () => (await db.query(
    `SELECT contype, convalidated FROM pg_constraint
      WHERE conrelid = 'contract_parts'::regclass AND conname = $1`, [VILLKOR],
  )).rows;
  const delar = async () => (await db.query('SELECT * FROM contract_parts ORDER BY id')).rows;
  const koposter = async () => Number((await db.query('SELECT count(*) AS n FROM action_approvals')).rows[0].n);

  beforeAll(async () => {
    db = await databasPa0084('redovisning_test_0085');
    bas = await seedBas(db);
    const avtal = await nyttAvtal(db, bas, 'Avtal med datum utan precision');
    // Nya koder och obekräftade tak: 0068:s och 0079:s triggrar släpper igenom raderna.
    for (const [code, kolumn] of [['PREC1', 'start_date'], ['PREC2', 'end_date']] as const) {
      const r = await db.query<{ id: string }>(
        `INSERT INTO contract_parts (company_id, contract_id, code, name, valid_from, ${kolumn})
         VALUES ($1, $2, $3, $3, DATE '2026-09-07', DATE '2026-10-31') RETURNING id`,
        [bas.companyId, avtal, code],
      );
      planterade.push(r.rows[0]!.id);
    }
  });

  afterAll(async () => { if (db) await db.end(); });

  it('(M2) fäller med driftbeskrivning, namnger raderna och lämnar allt orört', async () => {
    const fore = await delar();
    const ko = await koposter();
    const e = await fel(db.query(await migration(85)));
    expect(e?.code).toBe('P0001');
    expect(e?.message.startsWith('driftfel fore 0085: 2 avtalsdel(ar)')).toBe(true);
    for (const id of planterade) expect(e?.message).toContain(id);
    expect(await villkor()).toEqual([]);
    expect(await delar()).toEqual(fore);
    expect(await koposter()).toBe(ko);
  });

  it('(M3) driftens rättelse kräver att 0079:s trigger stängs av; sedan går 0085 igenom och är idempotent', async () => {
    // Raderna är frysta av 0079 — också för ägarrollen.
    const fryst = await fel(db.query("UPDATE contract_parts SET date_precision = 'dag' WHERE id = ANY($1::uuid[])", [planterade]));
    expect(fryst?.message).toContain('ändras inte på plats');

    await db.query('BEGIN');
    try {
      await db.query('ALTER TABLE contract_parts DISABLE TRIGGER contract_parts_kraver_orsak');
      await db.query("UPDATE contract_parts SET date_precision = 'dag' WHERE id = ANY($1::uuid[])", [planterade]);
      await db.query('ALTER TABLE contract_parts ENABLE TRIGGER contract_parts_kraver_orsak');
      await db.query('COMMIT');
    } catch (e) {
      await db.query('ROLLBACK');
      throw e;
    }

    const fore = await delar();
    const sql = await migration(85);
    await db.query(sql);
    expect(await villkor()).toEqual([{ contype: 'c', convalidated: true }]);
    expect(await delar()).toEqual(fore);
    await db.query(sql);
    expect(await villkor()).toEqual([{ contype: 'c', convalidated: true }]);
    expect(await delar()).toEqual(fore);
  });
});

describe('(M4, M5) regeln i det migrerade schemat och i indatat', () => {
  let user: TestUser;
  let companyId: string;
  let contractId: string;

  const auth = () => ({ Authorization: `Bearer ${user.token}` });
  const act = (namn: string, kropp: Record<string, unknown>) =>
    api.post(`/api/companies/${companyId}/actions/${namn}`).set(auth()).send(kropp);
  const koposter = async () => withAdmin(async (c) => Number((await c.query(
    'SELECT count(*) AS n FROM action_approvals WHERE company_id = $1', [companyId],
  )).rows[0].n));

  beforeAll(async () => {
    user = await registerUser('datumprecision');
    companyId = await createCompany(user.token, 'Precision AB');
    await createFiscalYear(companyId, auth(), { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });
    const projekt = await act('create_project', { name: 'Precisionsprov' });
    expect(projekt.status, JSON.stringify(projekt.body)).toBe(200);
    const avtal = await act('skapa_uppdrag', { project_id: projekt.body.result.id, name: 'Avtal', signed_date: '2026-09-07' });
    expect(avtal.status, JSON.stringify(avtal.body)).toBe(200);
    contractId = avtal.body.result.contract_id;
  });

  it('(M4) som rollen app fälls ett datum utan precision av villkoret', async () => {
    await withTenantTransaction(user.userId, companyId, async (c) => {
      expect((await c.query<{ roll: string }>('SELECT current_user AS roll')).rows[0]?.roll).toBe('app');
    });
    const e = await fel(withTenantTransaction(user.userId, companyId, (c) => c.query(
      `INSERT INTO contract_parts (company_id, contract_id, code, name, valid_from, start_date)
       VALUES ($1, $2, 'PRECAPP', 'Utan precision', DATE '2026-09-07', DATE '2026-10-01')`,
      [companyId, contractId],
    )));
    expect(e).toMatchObject({ code: '23514', constraint: VILLKOR });
    const rader = await withAdmin(async (c) => (await c.query(
      "SELECT id FROM contract_parts WHERE contract_id = $1 AND code = 'PRECAPP'", [contractId],
    )).rows);
    expect(rader).toEqual([]);
  });

  const del = { contract_id: randomUUID(), code: 'PRECNY', name: 'Ny avtalsdel', valid_from: '2026-10-01', change_reason: 'Tillägg ur provet' };
  type Datum = Partial<Record<'start_date' | 'end_date', string>>;
  const utanPrecision: Datum[] = [
    { start_date: '2026-10-01' },
    { end_date: '2026-12-31' },
    { start_date: '2026-10-01', end_date: '2026-12-31' },
  ];
  const ingangar: Array<[string, (datum: Datum) => Record<string, unknown>]> = [
    ['upsert_contract_part', (datum) => ({ ...del, ...datum })],
    ['andra_baseline', (datum) => ({ ...del, ...datum })],
    ['avgor_scopesignal', (datum) => ({ signal_id: randomUUID(), avgjord: 'utanfor', tillagg: { ...del, ...datum } })],
  ];

  it.each(ingangar)('(M5) %s avvisar ett datum utan precision före kön', async (namn, indata) => {
    const ko = await koposter();
    for (const datum of utanPrecision) {
      const r = await act(namn, indata(datum));
      expect(r.status, `${namn} ${JSON.stringify(datum)}: ${JSON.stringify(r.body)}`).toBe(400);
      expect(r.body.error).toBe('validation_error');
    }
    expect(await koposter()).toBe(ko);
  });
});
