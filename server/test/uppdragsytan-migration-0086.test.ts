// Story 3.1 (B-15, FR-10, FR-26, FR-36): 0086 ger referensen läget
// `overifierad` som standard, läget `utanfor_sparr`, händelsedatumet och den
// frysta revisionen.
//
// RISKEN: en referens som aldrig verifierats fortsätter visas som levande, en
// fryst revision kan skrivas om så att en utbytt kontraktsversion ser ut som
// den länkade, eller ett händelsedatum hittas på ur länkningstiden. Alla tre ser
// ut som säkra uppgifter och är det inte. Provet har två lager:
//
//   * **Migrationen** körs från disk mot en egen databas på 0085, med en
//     planterad krock som negativ kontroll: kantkontrollen fäller och lämnar
//     raderna orörda; efter driftens rättelse går 0086 igenom, rättar de rader
//     den ska och inga andra, och är idempotent.
//   * **Schemat som rollen `app` ser det** i testdatabasen, som redan bär 0086:
//     standardläget, CHECK-villkoren och frysningen av revisionen.
import pg, { type PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadMigrations } from '../src/db/migrate.js';
import { withTenantTransaction } from '../src/db/tx.js';
import { kanonisktReferensId, referensFormFel } from '../src/lib/referens.js';
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
  /** Radernas id per namn i berättelsens tabell. */
  const r: Record<string, string> = {};
  let A1 = '';
  let A2 = '';

  const rader = async () => (await db.query('SELECT * FROM uppdrag_referens ORDER BY id')).rows;
  const rad = async (id: string) =>
    (await db.query<{ extern_id: string; status: string }>(
      'SELECT extern_id, status FROM uppdrag_referens WHERE id = $1', [id],
    )).rows[0]!;
  const kolumner = async () => (await db.query<{ column_name: string; data_type: string }>(
    `SELECT column_name, data_type FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'uppdrag_referens' ORDER BY column_name`,
  )).rows;

  beforeAll(async () => {
    db = await databasPa0085('redovisning_test_0086');
    const u = await db.query<{ id: string }>(
      "INSERT INTO users (email, password_hash, name) VALUES ('referens0086@exempel.se', 'x', 'Referensprov') RETURNING id",
    );
    const userId = u.rows[0]!.id;
    const c = await db.query<{ id: string }>(
      "INSERT INTO companies (name, org_number) VALUES ('Locollabs AB', '556000-0001') RETURNING id",
    );
    const companyId = c.rows[0]!.id;
    await db.query("INSERT INTO company_members (company_id, user_id, role) VALUES ($1, $2, 'owner')",
      [companyId, userId]);
    const k = await db.query<{ id: string }>(
      "INSERT INTO customers (company_id, customer_number, name) VALUES ($1, 1, 'Referenskund AB') RETURNING id",
      [companyId],
    );
    const projekt = async (nr: number, namn: string) => (await db.query<{ id: string }>(
      'INSERT INTO projects (company_id, customer_id, number, name) VALUES ($1, $2, $3, $4) RETURNING id',
      [companyId, k.rows[0]!.id, nr, namn],
    )).rows[0]!.id;
    const P1 = await projekt(1, 'Öppet uppdrag');
    const P2 = await projekt(2, 'Avslutat uppdrag');
    const avtal = async (projectId: string, namn: string) => (await db.query<{ id: string }>(
      `INSERT INTO contracts (company_id, project_id, name, signed_date, created_by)
       VALUES ($1, $2, $3, DATE '2026-09-07', $4) RETURNING id`,
      [companyId, projectId, namn, userId],
    )).rows[0]!.id;
    A1 = await avtal(P1, 'A1');
    A2 = await avtal(P2, 'A2');

    const PLANTERADE: Array<[string, string, 'drive' | 'mejl', string, string | null]> = [
      ['r1', A1, 'drive', 'fil-1', null],
      ['r2', A1, 'drive', 'fil-2', '2026-09-01 08:00+02'],
      ['r4', A2, 'drive', 'fil-4', null],
      ['r5', A1, 'mejl', '<m5@ilt.example>', null],
      ['r6', A1, 'mejl', 'm6@ilt.example', '2026-09-02 08:00+02'],
      ['r7', A2, 'mejl', '<m7@ilt.example>', null],
      ['r8', A1, 'mejl', 'ej-ett-message-id', null],
      ['krock1', A1, 'mejl', '<kollision@ilt.example>', null],
      ['krock2', A1, 'mejl', 'kollision@ilt.example', null],
    ];
    for (const [namn, contractId, sort, externId, verifierad] of PLANTERADE) {
      r[namn] = (await db.query<{ id: string }>(
        `INSERT INTO uppdrag_referens
           (company_id, contract_id, sort, extern_id, extern_nyckel, extern_kalla, status, senast_verifierad)
         VALUES ($1, $2, $3, $4, $5, 'prov:0086', 'levande', $6::timestamptz) RETURNING id`,
        [companyId, contractId, sort, externId, sort === 'mejl' ? 'rfc822#message-id' : 'drive#file', verifierad],
      )).rows[0]!.id;
    }
    // Stängs EFTER skrivningen: 0068:s trigger fäller varje skrivning på ett avslutat uppdrag.
    await db.query("UPDATE projects SET status = 'closed' WHERE id = $1", [P2]);
  });

  afterAll(async () => { if (db) await db.end(); });

  it('(M1) kantkontrollen fäller en krock som rättelsen hade orsakat, och lämnar allt orört', async () => {
    const fore = await rader();
    const e = await fel(db.query(await migration(86)));
    expect(e, 'migrationen borde ha fällts').not.toBeNull();
    expect(e?.message).toContain('uppdrag_referens');
    expect(e?.message).toContain('kollision');
    expect(await rader()).toEqual(fore);
    expect((await kolumner()).map((k) => k.column_name)).not.toContain('handelse_datum');
  });

  it('(M2) efter driftens rättelse går 0086 igenom och rättar bara aldrig verifierade och omslutna id i öppna uppdrag', async () => {
    await db.query('DELETE FROM uppdrag_referens WHERE id = $1', [r.krock2]);
    const mejl = ['r5', 'r6', 'r7', 'r8', 'krock1'];
    const oppna = new Set(['r5', 'r6', 'r8', 'krock1']);
    const fore = Object.fromEntries(await Promise.all(mejl.map(async (n) => [n, (await rad(r[n]!)).extern_id] as const)));

    await db.query(await migration(86));

    expect(await rad(r.r1!)).toEqual({ extern_id: 'fil-1', status: 'overifierad' });
    expect(await rad(r.r2!)).toEqual({ extern_id: 'fil-2', status: 'levande' });
    expect(await rad(r.r4!)).toEqual({ extern_id: 'fil-4', status: 'levande' });
    expect(await rad(r.r5!)).toEqual({ extern_id: 'm5@ilt.example', status: 'overifierad' });
    expect(await rad(r.r6!)).toEqual({ extern_id: 'm6@ilt.example', status: 'levande' });
    expect(await rad(r.r7!)).toEqual({ extern_id: '<m7@ilt.example>', status: 'levande' });
    expect(await rad(r.r8!)).toEqual({ extern_id: 'ej-ett-message-id', status: 'overifierad' });
    expect((await rad(r.krock1!)).extern_id).toBe('kollision@ilt.example');

    // Förväntan härledd ur regeln i lib/referens.ts, så att migrationens
    // SQL-uttryck och kanonisktReferensId inte kan glida isär.
    for (const n of mejl) {
      const forut = fore[n]!;
      const kanon = kanonisktReferensId('mejl', forut);
      const vantat = oppna.has(n) && referensFormFel('mejl', kanon) === null ? kanon : forut;
      expect((await rad(r[n]!)).extern_id, n).toBe(vantat);
    }
  });

  it('(M3) en andra körning ändrar ingenting', async () => {
    const fore = await rader();
    await db.query(await migration(86));
    expect(await rader()).toEqual(fore);
  });

  it('(M4) schemat efter 0086: en sluten kolumnlista utan innehåll, fem lägen och kategorin', async () => {
    // Ett objekt per kolumn: jämförelsen är exakt och beror inte på sorteringen.
    expect(Object.fromEntries((await kolumner()).map((k) => [k.column_name, k.data_type]))).toEqual({
      id: 'uuid', company_id: 'uuid', contract_id: 'uuid', sort: 'text', extern_id: 'text',
      extern_nyckel: 'text', extern_kalla: 'text', titel_vid_lankning: 'text', hash_vid_lankning: 'text',
      senast_verifierad: 'timestamp with time zone', status: 'text', ko_status: 'text', ko_fel: 'text',
      created_at: 'timestamp with time zone', handelse_datum: 'date', revision: 'bigint',
    });
    expect((await kolumner()).filter((k) => ['bytea', 'json', 'jsonb'].includes(k.data_type))).toEqual([]);

    const standard = (await db.query<{ column_default: string | null }>(
      `SELECT column_default FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'uppdrag_referens' AND column_name = 'status'`,
    )).rows[0]!.column_default;
    expect(standard).toContain("'overifierad'");

    const villkor = (await db.query<{ def: string }>(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conrelid = 'uppdrag_referens'::regclass AND conname = 'uppdrag_referens_status_check'`,
    )).rows[0]!.def;
    expect([...villkor.matchAll(/'([^']+)'::text/g)].map((m) => m[1])).toEqual(STATUSAR);

    const kommentar = (await db.query<{ k: string | null }>(
      "SELECT obj_description('uppdrag_referens'::regclass, 'pg_class') AS k",
    )).rows[0]!.k;
    expect(kommentar?.startsWith('Kategori: REFERENS.')).toBe(true);
  });

  it('(M7) inget händelsedatum hittas på: varje rad har handelse_datum NULL efter 0086', async () => {
    const satta = (await db.query('SELECT id FROM uppdrag_referens WHERE handelse_datum IS NOT NULL')).rows;
    expect(satta).toEqual([]);
    expect(Number((await db.query('SELECT count(*) AS n FROM uppdrag_referens')).rows[0].n)).toBeGreaterThan(0);
  });
});

describe('(M5, M6) schemat som rollen app ser det', () => {
  let user: TestUser;
  let companyId = '';
  let contractId = '';

  const auth = () => ({ Authorization: `Bearer ${user.token}` });
  const act = (namn: string, kropp: Record<string, unknown>) =>
    api.post(`/api/companies/${companyId}/actions/${namn}`).set(auth()).send(kropp);
  const iBolaget = <T>(fn: (c: PoolClient) => Promise<T>): Promise<T> =>
    withTenantTransaction(user.userId, companyId, fn);
  const skriv = (sort: string, externId: string, extra: Record<string, unknown> = {}) => iBolaget(async (c) => {
    const kol = ['company_id', 'contract_id', 'sort', 'extern_id', 'extern_nyckel', 'extern_kalla', ...Object.keys(extra)];
    const varden = [companyId, contractId, sort, externId, 'prov#nyckel', 'prov:0086', ...Object.values(extra)];
    const res = await c.query<{ id: string; status: string; revision: number | null }>(
      `INSERT INTO uppdrag_referens (${kol.join(', ')})
       VALUES (${kol.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id, status, revision`,
      varden,
    );
    return res.rows[0]!;
  });
  const andra = (id: string, kolumn: 'revision' | 'status', varde: unknown) => iBolaget((c) =>
    c.query(`UPDATE uppdrag_referens SET ${kolumn} = $3 WHERE id = $1 AND company_id = $2`, [id, companyId, varde]));

  beforeAll(async () => {
    user = await registerUser('referens-0086');
    companyId = await createCompany(user.token, 'Referens 0086 AB');
    await createFiscalYear(companyId, auth(), { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });
    const projekt = await act('create_project', { name: 'Referensprov 0086' });
    expect(projekt.status, JSON.stringify(projekt.body)).toBe(200);
    const avtal = await act('skapa_uppdrag', { project_id: projekt.body.result.id, name: 'Avtal', signed_date: '2026-09-07' });
    expect(avtal.status, JSON.stringify(avtal.body)).toBe(200);
    contractId = avtal.body.result.contract_id;
  });

  it('(M5) en ny rad föds overifierad, och CHECK-villkoren fäller okänt läge och revision utanför Drive', async () => {
    await iBolaget(async (c) => {
      expect((await c.query<{ roll: string }>('SELECT current_user AS roll')).rows[0]?.roll).toBe('app');
    });
    expect((await skriv('drive', 'm5-utan-status')).status).toBe('overifierad');
    expect((await skriv('drive', 'm5-utanfor', { status: 'utanfor_sparr' })).status).toBe('utanfor_sparr');
    expect(await fel(skriv('drive', 'm5-okand', { status: 'okand' })))
      .toMatchObject({ code: '23514', constraint: 'uppdrag_referens_status_check' });
    expect(await fel(skriv('mejl', 'm5@ilt.example', { revision: 3 })))
      .toMatchObject({ code: '23514', constraint: 'uppdrag_referens_revision_bara_drive' });
    expect(await fel(skriv('drive', 'm5-negativ', { revision: -1 })))
      .toMatchObject({ code: '23514', constraint: 'uppdrag_referens_revision_bara_drive' });
  });

  it('(M6) revisionen är fryst vid skrivningen, också från NULL, medan läget får ändras', async () => {
    const fryst = await skriv('drive', 'm6-fryst', { revision: 3 });
    expect(fryst.revision).toBe(3);
    const utan = await skriv('drive', 'm6-utan');
    expect(utan.revision).toBeNull();

    expect((await fel(andra(fryst.id, 'revision', 4)))?.message).toContain('revision');
    expect((await fel(andra(utan.id, 'revision', 3)))?.message).toContain('revision');
    expect(await fel(andra(fryst.id, 'status', 'drift'))).toBeNull();
    expect(await fel(andra(utan.id, 'status', 'drift'))).toBeNull();

    const efter = await iBolaget(async (c) => (await c.query<{ id: string; revision: number | null; status: string }>(
      'SELECT id, revision, status FROM uppdrag_referens WHERE company_id = $1 AND id = ANY($2::uuid[]) ORDER BY extern_id',
      [companyId, [fryst.id, utan.id]],
    )).rows);
    expect(efter).toEqual([
      { id: fryst.id, revision: 3, status: 'drift' },
      { id: utan.id, revision: null, status: 'drift' },
    ]);
  });
});
