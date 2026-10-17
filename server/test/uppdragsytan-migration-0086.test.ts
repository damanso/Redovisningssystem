// Story 3.1 (FR-10, FR-26, FR-36, B-15): en referens är overifierad tills svepet
// sagt annat, och bär händelsedatum och fryst revision.
//
// RISKEN: en referens som aldrig verifierats fortsätter visas som levande; en
// fryst revision kan skrivas om, så att kontraktsversionen byts i tysthet; eller
// ett händelsedatum hittas på ur länkningstiden. Schemat bär alla tre reglerna,
// och de provas här i två lager:
//
//   * **Migrationen (0086)** körd från disk mot en databas på 0085, med en
//     planterad krock som negativ kontroll: kantkontrollen fäller och lämnar
//     raderna orörda; efter driftens rättelse går migrationen igenom, rättar de
//     befintliga raderna i öppna uppdrag och är idempotent.
//   * **Schemat som rollen `app` ser det** — defaulten, CHECK-villkoren och
//     triggern som fryser revisionen.
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadMigrations } from '../src/db/migrate.js';
import { withTenantTransaction } from '../src/db/tx.js';
import { api, createCompany, createFiscalYear, registerUser, type TestUser } from './helpers.js';

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
async function databasPa0085(namn: string): Promise<pg.Client> {
  await withMaintenance(async (c) => {
    await c.query(`DROP DATABASE IF EXISTS ${namn} WITH (FORCE)`);
    await c.query(`CREATE DATABASE ${namn}`);
  });
  skapade.push(namn);
  const db = new pg.Client({ connectionString: scratchUrl(namn) });
  await db.connect();
  try {
    for (const m of (await loadMigrations()).filter((x) => x.version < 86)) await db.query(m.sql);
    return db;
  } catch (e) {
    await db.end();
    throw e;
  }
}

afterAll(async () => {
  for (const namn of skapade) {
    await withMaintenance((c) => c.query(`DROP DATABASE IF EXISTS ${namn} WITH (FORCE)`));
  }
});

describe('(M1–M4, M7) 0086 körs från disk mot en databas på 0085', () => {
  let db: pg.Client;
  const r: Record<string, string> = {};

  const rader = async () => (await db.query('SELECT * FROM uppdrag_referens ORDER BY id')).rows;
  const rad = async (id: string) => (await db.query<{ extern_id: string; status: string }>(
    'SELECT extern_id, status FROM uppdrag_referens WHERE id = $1', [id],
  )).rows[0]!;
  const harKolumn = async (kolumn: string) => (await db.query(
    `SELECT 1 FROM information_schema.columns WHERE table_name = 'uppdrag_referens' AND column_name = $1`, [kolumn],
  )).rows.length > 0;

  beforeAll(async () => {
    db = await databasPa0085('redovisning_test_0086');
    const u = await db.query<{ id: string }>(
      "INSERT INTO users (email, password_hash, name) VALUES ('referens@exempel.se', 'x', 'Referensprov') RETURNING id",
    );
    const userId = u.rows[0]!.id;
    const c = await db.query<{ id: string }>(
      "INSERT INTO companies (name, org_number) VALUES ('Locollabs AB', '556000-0001') RETURNING id",
    );
    const companyId = c.rows[0]!.id;
    await db.query("INSERT INTO company_members (company_id, user_id, role) VALUES ($1, $2, 'owner')", [companyId, userId]);
    const k = await db.query<{ id: string }>(
      "INSERT INTO customers (company_id, customer_number, name) VALUES ($1, 1, 'Referenskund AB') RETURNING id",
      [companyId],
    );
    const avtal: Record<'A1' | 'A2', string> = { A1: '', A2: '' };
    const projekt: Record<'P1' | 'P2', string> = { P1: '', P2: '' };
    for (const [nr, p, a] of [[1, 'P1', 'A1'], [2, 'P2', 'A2']] as const) {
      const pr = await db.query<{ id: string }>(
        'INSERT INTO projects (company_id, customer_id, number, name) VALUES ($1, $2, $3, $4) RETURNING id',
        [companyId, k.rows[0]!.id, nr, `Uppdrag ${p}`],
      );
      projekt[p] = pr.rows[0]!.id;
      const av = await db.query<{ id: string }>(
        `INSERT INTO contracts (company_id, project_id, name, signed_date, created_by)
         VALUES ($1, $2, $3, DATE '2026-09-07', $4) RETURNING id`,
        [companyId, projekt[p], `Avtal ${a}`, userId],
      );
      avtal[a] = av.rows[0]!.id;
    }
    const PLANTERADE: Array<[string, 'A1' | 'A2', 'drive' | 'mejl', string, string | null]> = [
      ['r1', 'A1', 'drive', 'fil-1', null],
      ['r2', 'A1', 'drive', 'fil-2', '2026-09-01 08:00+02'],
      ['r4', 'A2', 'drive', 'fil-4', null],
      ['r5', 'A1', 'mejl', '<m5@ilt.example>', null],
      ['r6', 'A1', 'mejl', 'm6@ilt.example', '2026-09-02 08:00+02'],
      ['r7', 'A2', 'mejl', '<m7@ilt.example>', null],
      ['r8', 'A1', 'mejl', 'ej-ett-message-id', null],
      ['k1', 'A1', 'mejl', '<kollision@ilt.example>', null],
      ['k2', 'A1', 'mejl', 'kollision@ilt.example', null],
    ];
    for (const [namn, a, sort, externId, verifierad] of PLANTERADE) {
      const ny = await db.query<{ id: string }>(
        `INSERT INTO uppdrag_referens (company_id, contract_id, sort, extern_id, status, senast_verifierad)
         VALUES ($1, $2, $3, $4, 'levande', $5::timestamptz) RETURNING id`,
        [companyId, avtal[a], sort, externId, verifierad],
      );
      r[namn] = ny.rows[0]!.id;
    }
    // Stängs EFTER raderna: 0068:s trigger fäller en skrivning på ett stängt uppdrag.
    await db.query("UPDATE projects SET status = 'closed' WHERE id = $1", [projekt.P2]);
  });

  afterAll(async () => { if (db) await db.end(); });

  it('(M1) kantkontrollen fäller en krock av kanoniska Message-ID och lämnar allt orört', async () => {
    const fore = await rader();
    const e = await fel(db.query(await migration(86)));
    expect(e).not.toBeNull();
    expect(e?.message).toContain('uppdrag_referens');
    expect(e?.message).toContain('kollision');
    expect(await rader()).toEqual(fore);
    expect(await harKolumn('handelse_datum')).toBe(false);
  });

  it('(M2) efter driftens rättelse går 0086 igenom och rättar raderna i öppna uppdrag', async () => {
    await db.query('DELETE FROM uppdrag_referens WHERE id = $1', [r.k2]);
    await db.query(await migration(86));
    expect(await rad(r.r1!)).toEqual({ extern_id: 'fil-1', status: 'overifierad' });
    expect(await rad(r.r2!)).toEqual({ extern_id: 'fil-2', status: 'levande' });
    // Avslutat uppdrag: raden rörs inte.
    expect(await rad(r.r4!)).toEqual({ extern_id: 'fil-4', status: 'levande' });
    expect(await rad(r.r5!)).toEqual({ extern_id: 'm5@ilt.example', status: 'overifierad' });
    expect(await rad(r.r6!)).toEqual({ extern_id: 'm6@ilt.example', status: 'levande' });
    expect(await rad(r.r7!)).toEqual({ extern_id: '<m7@ilt.example>', status: 'levande' });
    expect(await rad(r.r8!)).toEqual({ extern_id: 'ej-ett-message-id', status: 'overifierad' });
    expect((await rad(r.k1!)).extern_id).toBe('kollision@ilt.example');
  });

  it('(M3) en andra körning ändrar ingenting', async () => {
    const fore = await rader();
    await db.query(await migration(86));
    expect(await rader()).toEqual(fore);
  });

  it('(M4) schemat: en sluten kolumnlista utan innehållskolumner, fem statusvärden och kategorin', async () => {
    const kolumner = (await db.query<{ column_name: string; data_type: string }>(
      `SELECT column_name, data_type FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'uppdrag_referens' ORDER BY column_name`,
    )).rows;
    expect(Object.fromEntries(kolumner.map((k) => [k.column_name, k.data_type]))).toEqual({
      id: 'uuid', company_id: 'uuid', contract_id: 'uuid', sort: 'text', extern_id: 'text',
      extern_nyckel: 'text', extern_kalla: 'text', titel_vid_lankning: 'text', hash_vid_lankning: 'text',
      senast_verifierad: 'timestamp with time zone', status: 'text', ko_status: 'text', ko_fel: 'text',
      created_at: 'timestamp with time zone', handelse_datum: 'date', revision: 'bigint',
    });
    for (const k of kolumner) expect(['bytea', 'json', 'jsonb']).not.toContain(k.data_type);
    const standard = (await db.query<{ column_default: string }>(
      `SELECT column_default FROM information_schema.columns
        WHERE table_name = 'uppdrag_referens' AND column_name = 'status'`,
    )).rows[0]!.column_default;
    expect(standard).toContain("'overifierad'");
    const villkor = (await db.query<{ def: string }>(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conrelid = 'uppdrag_referens'::regclass AND conname = 'uppdrag_referens_status_check'`,
    )).rows[0]!.def;
    expect([...villkor.matchAll(/'([^']+)'::text/g)].map((m) => m[1])).toEqual(
      ['overifierad', 'levande', 'drift', 'trasig', 'utanfor_sparr'],
    );
    const kommentar = (await db.query<{ k: string }>(
      "SELECT obj_description('uppdrag_referens'::regclass) AS k",
    )).rows[0]!.k;
    expect(kommentar.startsWith('Kategori: REFERENS.')).toBe(true);
  });

  it('(M7) inget händelsedatum hittas på — ingenting hämtas ur created_at', async () => {
    const satta = (await db.query('SELECT id FROM uppdrag_referens WHERE handelse_datum IS NOT NULL')).rows;
    expect(satta).toEqual([]);
  });
});

describe('(M5, M6) schemat som rollen app ser det', () => {
  let user: TestUser;
  let companyId: string;
  let contractId: string;

  const auth = () => ({ Authorization: `Bearer ${user.token}` });
  const act = (namn: string, kropp: Record<string, unknown>) =>
    api.post(`/api/companies/${companyId}/actions/${namn}`).set(auth()).send(kropp);
  const somApp = <T extends pg.QueryResultRow = pg.QueryResultRow>(sql: string, varden: unknown[]) =>
    withTenantTransaction(user.userId, companyId, async (c) => (await c.query<T>(sql, varden)).rows);
  const ny = async (sort: string, externId: string, revision: number | null = null) =>
    (await somApp<{ id: string; status: string }>(
      `INSERT INTO uppdrag_referens (company_id, contract_id, sort, extern_id, revision)
       VALUES ($1, $2, $3, $4, $5) RETURNING id, status`,
      [companyId, contractId, sort, externId, revision],
    ))[0]!;

  beforeAll(async () => {
    user = await registerUser('referens-0086');
    companyId = await createCompany(user.token, 'Referens AB');
    await createFiscalYear(companyId, auth(), { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });
    const projekt = await act('create_project', { name: 'Referensprov' });
    expect(projekt.status, JSON.stringify(projekt.body)).toBe(200);
    const avtal = await act('skapa_uppdrag', { project_id: projekt.body.result.id, name: 'Avtal', signed_date: '2026-09-07' });
    expect(avtal.status, JSON.stringify(avtal.body)).toBe(200);
    contractId = avtal.body.result.contract_id;
  });

  it('(M5) en ny rad är overifierad; statusvärdena och revisionens villkor håller', async () => {
    await withTenantTransaction(user.userId, companyId, async (c) => {
      expect((await c.query<{ roll: string }>('SELECT current_user AS roll')).rows[0]?.roll).toBe('app');
    });
    expect((await ny('drive', 'm5-utan-status')).status).toBe('overifierad');
    const utanfor = await somApp<{ status: string }>(
      `INSERT INTO uppdrag_referens (company_id, contract_id, sort, extern_id, status)
       VALUES ($1, $2, 'drive', 'm5-utanfor', 'utanfor_sparr') RETURNING status`,
      [companyId, contractId],
    );
    expect(utanfor).toEqual([{ status: 'utanfor_sparr' }]);
    expect(await fel(somApp(
      `INSERT INTO uppdrag_referens (company_id, contract_id, sort, extern_id, status)
       VALUES ($1, $2, 'drive', 'm5-okand', 'okand')`, [companyId, contractId],
    ))).toMatchObject({ code: '23514', constraint: 'uppdrag_referens_status_check' });
    expect(await fel(ny('mejl', 'm5@ilt.example', 3)))
      .toMatchObject({ code: '23514', constraint: 'uppdrag_referens_revision_bara_drive' });
    expect(await fel(ny('drive', 'm5-negativ', -1)))
      .toMatchObject({ code: '23514', constraint: 'uppdrag_referens_revision_bara_drive' });
  });

  it('(M6) revisionen är fryst vid länkningen — också från NULL — men statusen kan ändras', async () => {
    const fryst = await ny('drive', 'm6-fryst', 3);
    const utan = await ny('drive', 'm6-utan');
    const omskriven = await fel(somApp('UPDATE uppdrag_referens SET revision = 4 WHERE id = $1', [fryst.id]));
    expect(omskriven?.message).toContain('revision');
    const satt = await fel(somApp('UPDATE uppdrag_referens SET revision = 3 WHERE id = $1', [utan.id]));
    expect(satt?.message).toContain('revision');
    for (const id of [fryst.id, utan.id]) {
      expect(await somApp<{ status: string; revision: string | null }>(
        "UPDATE uppdrag_referens SET status = 'drift' WHERE id = $1 RETURNING status, revision::text", [id],
      )).toEqual([{ status: 'drift', revision: id === fryst.id ? '3' : null }]);
    }
  });
});
