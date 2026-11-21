// Story 3.1 (B-15): aldrig verifierade referenser får inte leva vidare som
// verifierade, en fryst revision får inte skrivas om och datum får inte hittas på.
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadMigrations } from '../src/db/migrate.js';
import { withTenantTransaction } from '../src/db/tx.js';
import { kanonisktReferensId, referensFormFel } from '../src/lib/referens.js';
import { nyttBolag, nyttUppdrag, type Bolag } from './undantagsvynRigg.js';

const fel = (p: Promise<unknown>) =>
  p.then(() => null, (e: unknown) => e as { code?: string; constraint?: string; message: string });

async function migration() {
  const m = (await loadMigrations()).find((x) => x.name === 'referens');
  expect(m, 'migrationen 0093_referens.sql saknas i kedjan').toBeTruthy();
  if (!m) throw new Error('migrationen referens saknas');
  return m;
}

async function withMaintenance<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = new pg.Client({ connectionString: process.env.MAINTENANCE_DATABASE_URL });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}

function scratchUrl(namn: string): string {
  const url = new URL(process.env.DATABASE_ADMIN_URL!);
  url.pathname = `/${namn}`;
  return url.toString();
}

// Kantkontrollen måste köra före varje ändring och tåla en omkörning.
describe('Story 3.1 · migrationen på befintliga rader', () => {
  let db: pg.Client;
  let skapad = false;
  let companyId: string;
  let a1: string;
  let a2: string;
  const ids: Record<string, string> = {};
  const rader = async () => (await db.query('SELECT * FROM uppdrag_referens ORDER BY id')).rows;
  const kolumner = async () => (await db.query<{ column_name: string; data_type: string; column_default: string | null }>(
    "SELECT column_name, data_type, column_default FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'uppdrag_referens' ORDER BY ordinal_position",
  )).rows;

  beforeAll(async () => {
    const m = await migration();
    await withMaintenance(async (c) => {
      await c.query('DROP DATABASE IF EXISTS redovisning_test_0093 WITH (FORCE)');
      await c.query('CREATE DATABASE redovisning_test_0093');
    });
    skapad = true;
    db = new pg.Client({ connectionString: scratchUrl('redovisning_test_0093') });
    await db.connect();
    for (const tidigare of (await loadMigrations()).filter((x) => x.version < m.version)) await db.query(tidigare.sql);
    const userId = (await db.query("INSERT INTO users (email, password_hash, name) VALUES ('referens@exempel.se', 'x', 'Referensprov') RETURNING id")).rows[0].id as string;
    companyId = (await db.query("INSERT INTO companies (name, org_number) VALUES ('Referens AB', '556000-0001') RETURNING id")).rows[0].id as string;
    await db.query("INSERT INTO company_members (company_id, user_id, role) VALUES ($1, $2, 'owner')", [companyId, userId]);
    const kund = (await db.query("INSERT INTO customers (company_id, customer_number, name) VALUES ($1, 1, 'Kunden AB') RETURNING id", [companyId])).rows[0].id as string;
    const projekt: string[] = [];
    const avtal: string[] = [];
    for (const nr of [1, 2]) {
      const p = (await db.query('INSERT INTO projects (company_id, customer_id, number, name) VALUES ($1, $2, $3, $4) RETURNING id', [companyId, kund, nr, `P${nr}`])).rows[0].id as string;
      projekt.push(p);
      avtal.push((await db.query("INSERT INTO contracts (company_id, project_id, name, signed_date, created_by) VALUES ($1, $2, $3, DATE '2026-09-07', $4) RETURNING id", [companyId, p, `A${nr}`, userId])).rows[0].id as string);
    }
    a1 = avtal[0]!; a2 = avtal[1]!;
    for (const [namn, contract, sort, id, tid] of [
      ['r1', a1, 'drive', 'fil-1', null],
      ['r2', a1, 'drive', 'fil-2', '2026-09-01 08:00+02'],
      ['r4', a2, 'drive', 'fil-4', null],
      ['r5', a1, 'mejl', '<m5@ilt.example>', null],
      ['r6', a1, 'mejl', 'm6@ilt.example', '2026-09-02 08:00+02'],
      ['r7', a2, 'mejl', '<m7@ilt.example>', null],
      ['r8', a1, 'mejl', 'ej-ett-message-id', null],
      ['krock1', a1, 'mejl', '<kollision@ilt.example>', null],
      ['krock2', a1, 'mejl', 'kollision@ilt.example', null],
    ] as const) {
      ids[namn] = (await db.query("INSERT INTO uppdrag_referens (company_id, contract_id, sort, extern_id, status, senast_verifierad) VALUES ($1, $2, $3, $4, 'levande', $5) RETURNING id", [companyId, contract, sort, id, tid])).rows[0].id as string;
    }
    await db.query("UPDATE projects SET status = 'closed' WHERE id = $1", [projekt[1]]);
  }, 60_000);

  afterAll(async () => {
    if (db) await db.end();
    if (skapad) await withMaintenance((c) => c.query('DROP DATABASE IF EXISTS redovisning_test_0093 WITH (FORCE)'));
  });

  it('M1 kollision fäller före ändring och lämnar även schemat orört', async () => {
    const fore = await rader();
    const e = await fel(db.query((await migration()).sql));
    expect(e?.message).toContain('uppdrag_referens');
    expect(e?.message).toContain('kollision');
    expect(await rader()).toEqual(fore);
    expect((await kolumner()).some((k) => k.column_name === 'handelse_datum')).toBe(false);
  });

  it('M2 rättar bara öppna uppdrag och binder SQL-uttrycket till den rena regeln', async () => {
    await db.query('DELETE FROM uppdrag_referens WHERE id = $1', [ids.krock2]);
    const fore = await rader();
    await db.query((await migration()).sql);
    const efter = await rader();
    for (const [namn, status, extern_id] of [
      ['r1', 'overifierad', 'fil-1'], ['r2', 'levande', 'fil-2'], ['r4', 'levande', 'fil-4'],
      ['r5', 'overifierad', 'm5@ilt.example'], ['r6', 'levande', 'm6@ilt.example'],
      ['r7', 'levande', '<m7@ilt.example>'], ['r8', 'overifierad', 'ej-ett-message-id'],
      ['krock1', 'overifierad', 'kollision@ilt.example'],
    ]) expect(efter.find((r) => r.id === ids[namn!])).toMatchObject({ status, extern_id });
    for (const r of fore.filter((r) => r.sort === 'mejl')) {
      const k = kanonisktReferensId('mejl', r.extern_id as string);
      const forvantat = r.contract_id === a1 && referensFormFel('mejl', k) === null ? k : r.extern_id;
      expect(efter.find((x) => x.id === r.id)?.extern_id).toBe(forvantat);
    }
  });

  it('M3 en andra körning lämnar samma rader', async () => {
    const fore = await rader();
    await db.query((await migration()).sql);
    expect(await rader()).toEqual(fore);
  });

  it('M4 schemat rymmer bara identitet, källa, datum och status', async () => {
    const k = await kolumner();
    expect(Object.fromEntries(k.map((r) => [r.column_name, r.data_type]))).toEqual({
      id: 'uuid', company_id: 'uuid', contract_id: 'uuid', sort: 'text', extern_id: 'text', extern_nyckel: 'text', extern_kalla: 'text',
      titel_vid_lankning: 'text', hash_vid_lankning: 'text', senast_verifierad: 'timestamp with time zone', status: 'text',
      ko_status: 'text', ko_fel: 'text', created_at: 'timestamp with time zone', handelse_datum: 'date', revision: 'bigint',
    });
    expect(k.some((r) => ['bytea', 'json', 'jsonb'].includes(r.data_type))).toBe(false);
    expect(k.find((r) => r.column_name === 'status')?.column_default).toContain("'overifierad'");
    const check = (await db.query("SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid = 'uppdrag_referens'::regclass AND conname = 'uppdrag_referens_status_check'")).rows[0].def as string;
    expect([...check.matchAll(/'([^']+)'/g)].map((m) => m[1])).toEqual(['overifierad', 'levande', 'drift', 'trasig', 'utanfor_sparr']);
    expect((await db.query("SELECT obj_description('uppdrag_referens'::regclass) AS text")).rows[0].text).toMatch(/^Kategori: REFERENS\./);
  });

  it('M7 händelsedatum fylls aldrig ur länkningstiden', async () => {
    expect((await rader()).every((r) => r.handelse_datum === null)).toBe(true);
  });
});

// Databasens sista försvarslinje provas med den verkliga app-rollen.
describe('Story 3.1 · app-rollens status och frysta revision', () => {
  let b: Bolag;
  let contractId: string;
  const tx = <T>(fn: (c: pg.PoolClient) => Promise<T>) => withTenantTransaction(b.user.userId, b.id, fn);
  const skriv = (id: string, sort: string, revision: number | null = null, status?: string) => tx((c) => c.query<{ id: string; status: string }>(
    `INSERT INTO uppdrag_referens (company_id, contract_id, sort, extern_id, revision${status === undefined ? '' : ', status'})
     VALUES ($1, $2, $3, $4, $5${status === undefined ? '' : ', $6'}) RETURNING id, status`,
    status === undefined ? [b.id, contractId, sort, id, revision] : [b.id, contractId, sort, id, revision, status],
  ));

  beforeAll(async () => {
    b = await nyttBolag('Migration referens AB');
    contractId = (await nyttUppdrag(b, 'Referensprov')).contractId;
    expect((await tx((c) => c.query('SELECT current_user AS roll'))).rows[0].roll).toBe('app');
  });

  it('M5 default, tillåtna statusar och revisionsvillkor gäller även rå SQL', async () => {
    expect((await skriv('m5-default', 'drive')).rows[0]?.status).toBe('overifierad');
    expect((await skriv('m5-utanfor', 'drive', null, 'utanfor_sparr')).rows[0]?.status).toBe('utanfor_sparr');
    expect(await fel(skriv('m5-okand', 'drive', null, 'okand'))).toMatchObject({ code: '23514' });
    for (const [id, sort, revision] of [['m5@ilt.example', 'mejl', 3], ['m5-negativ', 'drive', -1]] as const) {
      expect(await fel(skriv(id, sort, revision))).toMatchObject({ code: '23514', constraint: 'uppdrag_referens_revision_bara_drive' });
    }
  });

  it('M6 revisionen fryses också från null men status kan ändras', async () => {
    for (const revision of [3, null]) {
      const id = (await skriv(`m6-${revision ?? 'null'}`, 'drive', revision)).rows[0]!.id;
      const e = await fel(tx((c) => c.query('UPDATE uppdrag_referens SET revision = $3 WHERE company_id = $1 AND id = $2', [b.id, id, revision === null ? 3 : 4])));
      expect(e?.message).toContain('revision');
      expect((await tx((c) => c.query("UPDATE uppdrag_referens SET status = 'drift' WHERE company_id = $1 AND id = $2 RETURNING status", [b.id, id]))).rows[0].status).toBe('drift');
    }
  });
});
