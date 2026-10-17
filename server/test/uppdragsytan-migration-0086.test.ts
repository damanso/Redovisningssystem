// Story 3.1 (FR-10, FR-26, FR-36, B-15): en referens är overifierad tills svepet
// sagt annat, och bär händelsedatum och fryst revision.
//
// RISKEN: att en referens som aldrig verifierats fortsätter visas som levande,
// att en fryst revision kan skrivas om så att en utbytt kontraktsversion ser
// oförändrad ut, eller att ett händelsedatum hittas på ur länkningstiden.
// Regeln står i schemat, och den provas här i två lager:
//
//   * **Migrationen (0086)** — körd från disk mot en databas på 0085, med en
//     planterad krock som negativ kontroll: kantkontrollen fäller med en
//     driftbeskrivning och lämnar raderna orörda; efter driftens rättelse går
//     migrationen igenom, rättar de befintliga raderna och är idempotent.
//   * **Det migrerade schemat** — som rollen `app` fäller Postgres själv ett
//     okänt läge, en revision på fel sort och varje ändring av en fryst revision.
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadMigrations } from '../src/db/migrate.js';
import { withTenantTransaction } from '../src/db/tx.js';
import { api, createCompany, createFiscalYear, registerUser, type TestUser } from './helpers.js';

const STATUSAR = ['overifierad', 'levande', 'drift', 'trasig', 'utanfor_sparr'];

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
  const rad: Record<string, string> = {};

  const rader = async () => (await db.query('SELECT * FROM uppdrag_referens ORDER BY id')).rows;
  const lage = async (nyckel: string) => (await db.query<{ extern_id: string; status: string }>(
    'SELECT extern_id, status FROM uppdrag_referens WHERE id = $1', [rad[nyckel]],
  )).rows[0];

  beforeAll(async () => {
    db = await databasPa0085('redovisning_test_0086');
    const u = await db.query<{ id: string }>(
      "INSERT INTO users (email, password_hash, name) VALUES ('referens0086@exempel.se', 'x', 'Referensprov') RETURNING id",
    );
    const c = await db.query<{ id: string }>(
      "INSERT INTO companies (name, org_number) VALUES ('Locollabs AB', '556000-0001') RETURNING id",
    );
    const companyId = c.rows[0]!.id;
    await db.query("INSERT INTO company_members (company_id, user_id, role) VALUES ($1, $2, 'owner')",
      [companyId, u.rows[0]!.id]);
    const k = await db.query<{ id: string }>(
      "INSERT INTO customers (company_id, customer_number, name) VALUES ($1, 1, 'Referenskund AB') RETURNING id",
      [companyId],
    );
    const projekt: string[] = [];
    const avtal: string[] = [];
    for (const nr of [1, 2]) {
      const p = await db.query<{ id: string }>(
        'INSERT INTO projects (company_id, customer_id, number, name) VALUES ($1, $2, $3, $4) RETURNING id',
        [companyId, k.rows[0]!.id, nr, `P${nr}`],
      );
      projekt.push(p.rows[0]!.id);
      const a = await db.query<{ id: string }>(
        `INSERT INTO contracts (company_id, project_id, name, signed_date, created_by)
         VALUES ($1, $2, $3, DATE '2026-09-07', $4) RETURNING id`,
        [companyId, p.rows[0]!.id, `A${nr}`, u.rows[0]!.id],
      );
      avtal.push(a.rows[0]!.id);
    }
    const [a1, a2] = avtal as [string, string];
    const plantera: Array<[string, string, 'drive' | 'mejl', string, string | null]> = [
      ['r1', a1, 'drive', 'fil-1', null],
      ['r2', a1, 'drive', 'fil-2', '2026-09-01 08:00+02'],
      ['r4', a2, 'drive', 'fil-4', null],
      ['r5', a1, 'mejl', '<m5@ilt.example>', null],
      ['r6', a1, 'mejl', 'm6@ilt.example', '2026-09-02 08:00+02'],
      ['r7', a2, 'mejl', '<m7@ilt.example>', null],
      ['r8', a1, 'mejl', 'ej-ett-message-id', null],
      ['k1', a1, 'mejl', '<kollision@ilt.example>', null],
      ['k2', a1, 'mejl', 'kollision@ilt.example', null],
    ];
    for (const [nyckel, contractId, sort, externId, verifierad] of plantera) {
      const r = await db.query<{ id: string }>(
        `INSERT INTO uppdrag_referens
           (company_id, contract_id, sort, extern_id, extern_nyckel, extern_kalla, status, senast_verifierad)
         VALUES ($1, $2, $3, $4, 'prov#id', 'prov:0086', 'levande', $5::timestamptz) RETURNING id`,
        [companyId, contractId, sort, externId, verifierad],
      );
      rad[nyckel] = r.rows[0]!.id;
    }
    // Stängs EFTER raderna: 0068:s trigger fäller varje skrivning på ett avslutat uppdrag.
    await db.query("UPDATE projects SET status = 'closed' WHERE id = $1", [projekt[1]]);
  });

  afterAll(async () => { if (db) await db.end(); });

  it('(M1) kantkontrollen fäller en krock i det kanoniska Message-ID:t och lämnar allt orört', async () => {
    const fore = await rader();
    const e = await fel(db.query(await migration(86)));
    expect(e, 'migrationen gick igenom trots krocken').not.toBeNull();
    expect(e?.message).toContain('uppdrag_referens');
    expect(e?.message).toContain('kollision');
    expect(await rader()).toEqual(fore);
    const kolumn = await db.query(
      "SELECT 1 FROM information_schema.columns WHERE table_name = 'uppdrag_referens' AND column_name = 'handelse_datum'",
    );
    expect(kolumn.rows).toEqual([]);
  });

  it('(M2) efter driftens rättelse går 0086 igenom och rättar de befintliga raderna i öppna uppdrag', async () => {
    await db.query('DELETE FROM uppdrag_referens WHERE id = $1', [rad.k2]);
    await db.query(await migration(86));
    expect(await lage('r1')).toEqual({ extern_id: 'fil-1', status: 'overifierad' });
    expect(await lage('r2')).toEqual({ extern_id: 'fil-2', status: 'levande' });
    expect(await lage('r4')).toEqual({ extern_id: 'fil-4', status: 'levande' });
    expect(await lage('r5')).toEqual({ extern_id: 'm5@ilt.example', status: 'overifierad' });
    expect(await lage('r6')).toEqual({ extern_id: 'm6@ilt.example', status: 'levande' });
    expect(await lage('r7')).toEqual({ extern_id: '<m7@ilt.example>', status: 'levande' });
    expect(await lage('r8')).toEqual({ extern_id: 'ej-ett-message-id', status: 'overifierad' });
    expect((await lage('k1'))?.extern_id).toBe('kollision@ilt.example');
  });

  it('(M3) en andra körning ändrar ingenting', async () => {
    const fore = await rader();
    await db.query(await migration(86));
    expect(await rader()).toEqual(fore);
  });

  it('(M4) schemat bär identitet, källa, datum och status — aldrig innehåll', async () => {
    const kolumner = await db.query<{ column_name: string; data_type: string; column_default: string | null }>(
      `SELECT column_name, data_type, column_default FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'uppdrag_referens' ORDER BY column_name`,
    );
    expect(Object.fromEntries(kolumner.rows.map((k) => [k.column_name, k.data_type]))).toEqual({
      id: 'uuid', company_id: 'uuid', contract_id: 'uuid', sort: 'text', extern_id: 'text',
      extern_nyckel: 'text', extern_kalla: 'text', titel_vid_lankning: 'text', hash_vid_lankning: 'text',
      senast_verifierad: 'timestamp with time zone', status: 'text', ko_status: 'text', ko_fel: 'text',
      created_at: 'timestamp with time zone', handelse_datum: 'date', revision: 'bigint',
    });
    for (const k of kolumner.rows) expect(['bytea', 'json', 'jsonb'], k.column_name).not.toContain(k.data_type);
    expect(kolumner.rows.find((k) => k.column_name === 'status')?.column_default).toContain("'overifierad'");
    const villkor = await db.query<{ def: string }>(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conrelid = 'uppdrag_referens'::regclass AND conname = 'uppdrag_referens_status_check'`,
    );
    expect([...villkor.rows[0]!.def.matchAll(/'([^']+)'::text/g)].map((m) => m[1])).toEqual(STATUSAR);
    const kommentar = await db.query<{ k: string }>("SELECT obj_description('uppdrag_referens'::regclass) AS k");
    expect(kommentar.rows[0]!.k.startsWith('Kategori: REFERENS.')).toBe(true);
  });

  it('(M7) inget händelsedatum hittas på: varje rad har handelse_datum NULL efter migrationen', async () => {
    const r = await db.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM uppdrag_referens WHERE handelse_datum IS NOT NULL',
    );
    expect(r.rows[0]!.n).toBe(0);
    expect((await rader()).length).toBe(8);
  });
});

describe('(M5, M6) regeln i det migrerade schemat, som rollen app', () => {
  let user: TestUser;
  let companyId = '';
  let contractId = '';

  const auth = () => ({ Authorization: `Bearer ${user.token}` });
  const act = (namn: string, kropp: Record<string, unknown>) =>
    api.post(`/api/companies/${companyId}/actions/${namn}`).set(auth()).send(kropp);
  const somApp = <T>(sql: string, varden: unknown[]) =>
    withTenantTransaction(user.userId, companyId, (c) => c.query<T & Record<string, unknown>>(sql, varden));
  const skriv = async (sort: 'drive' | 'mejl', externId: string, kolumner: Record<string, unknown> = {}) => {
    const namn = Object.keys(kolumner);
    const r = await somApp<{ id: string; status: string }>(
      `INSERT INTO uppdrag_referens (company_id, contract_id, sort, extern_id, extern_nyckel, extern_kalla${
        namn.map((n) => `, ${n}`).join('')})
       VALUES ($1, $2, $3, $4, 'prov#id', 'prov:app'${namn.map((_, i) => `, $${i + 5}`).join('')})
       RETURNING id, status`,
      [companyId, contractId, sort, externId, ...Object.values(kolumner)],
    );
    return r.rows[0]!;
  };

  beforeAll(async () => {
    user = await registerUser('referens-0086');
    companyId = await createCompany(user.token, 'Referens 0086 AB');
    await createFiscalYear(companyId, auth(), { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });
    const projekt = await act('create_project', { name: 'Referensprov 0086' });
    expect(projekt.status, JSON.stringify(projekt.body)).toBe(200);
    const avtal = await act('skapa_uppdrag', { project_id: projekt.body.result.id, name: 'Avtal', signed_date: '2026-09-07' });
    expect(avtal.status, JSON.stringify(avtal.body)).toBe(200);
    contractId = avtal.body.result.contract_id;
    await withTenantTransaction(user.userId, companyId, async (c) => {
      expect((await c.query<{ roll: string }>('SELECT current_user AS roll')).rows[0]?.roll).toBe('app');
    });
  });

  it('(M5) en ny rad föds overifierad, och CHECK-villkoren fäller okänt läge och revision på fel rad', async () => {
    expect((await skriv('drive', 'app-utan-status')).status).toBe('overifierad');
    expect((await skriv('drive', 'app-utanfor', { status: 'utanfor_sparr' })).status).toBe('utanfor_sparr');
    expect(await fel(skriv('drive', 'app-okand', { status: 'okand' })))
      .toMatchObject({ code: '23514', constraint: 'uppdrag_referens_status_check' });
    expect(await fel(skriv('mejl', 'rev@ilt.example', { revision: 3 })))
      .toMatchObject({ code: '23514', constraint: 'uppdrag_referens_revision_bara_drive' });
    expect(await fel(skriv('drive', 'app-negativ', { revision: -1 })))
      .toMatchObject({ code: '23514', constraint: 'uppdrag_referens_revision_bara_drive' });
  });

  it('(M6) en fryst revision skrivs aldrig om, inte heller från NULL, men läget kan ändras', async () => {
    const fryst = await skriv('drive', 'app-fryst', { revision: 3 });
    const utan = await skriv('drive', 'app-utan-revision');
    const omskriven = await fel(somApp('UPDATE uppdrag_referens SET revision = 4 WHERE id = $1', [fryst.id]));
    expect(omskriven?.message).toContain('revision');
    const franNull = await fel(somApp('UPDATE uppdrag_referens SET revision = 3 WHERE id = $1', [utan.id]));
    expect(franNull?.message).toContain('revision');
    for (const id of [fryst.id, utan.id]) {
      const r = await somApp<{ status: string; revision: string | null }>(
        "UPDATE uppdrag_referens SET status = 'drift' WHERE id = $1 RETURNING status, revision", [id],
      );
      expect(r.rows[0]?.status).toBe('drift');
    }
    const kvar = await somApp<{ revision: string }>('SELECT revision::text FROM uppdrag_referens WHERE id = $1', [fryst.id]);
    expect(kvar.rows[0]?.revision).toBe('3');
  });
});
