// K-5 (tidpost -> ärende) och K-6 (faktura -> projekt), migration 0060.
//
// Proven mäter REGLERNA, inte de rader som råkade finnas i produktion när
// migrationen kördes:
//
//   * Ifyllnadsregeln LÄSES UR MIGRATIONSFILEN och körs mot färsk fixturdata.
//     Därmed finns bara EN kopia av regeln; skrivs migrationen om utan att
//     regeln håller, blir provet rött. En egen SQL-kopia i testet hade varit en
//     andra sanning, och de två hade glidit isär.
//   * Den negativa kontrollen är inbyggd i samma prov: en kund med TVÅ projekt
//     får INTE kopplas. Ett prov som bara visar att åtta fakturor fick ett
//     projekt hade varit grönt även för en regel som gissar.
// Story 3.5 (FR-24, ADR-3, B-16): en fryst nyckel bär läsbarheten när
// ärendeplattformen är nere. En FK över gränsen skulle göra systemen beroende
// av varandra. Provet går genom 0078 som migration, schemat som app, REST,
// pg_constraint och läsvägen, med planterade fel som negativ kontroll.
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadMigrations } from '../src/db/migrate.js';
import { withTenantTransaction } from '../src/db/tx.js';
import { api, createCompany, registerUser, withAdmin, type TestUser } from './helpers.js';

const MIGRATION = new URL('../migrations/0060_arende_och_projektkoppling.sql', import.meta.url);

let user: TestUser;
let companyId: string;
let userId: string;

/** Plockar ut fakturans ifyllnads-UPDATE ur migrationen — regelns enda kopia. */
async function ifyllnadsregeln(): Promise<string> {
  const sql = await readFile(MIGRATION, 'utf8');
  const m = /(UPDATE invoices i\b[\s\S]*?;)/.exec(sql);
  if (!m) throw new Error('hittade inte fakturans UPDATE i migration 0060');
  return m[1] as string;
}

async function nyKund(namn: string, nummer: number): Promise<string> {
  return withAdmin(async (c) => {
    const r = await c.query(
      `INSERT INTO customers (company_id, customer_number, name) VALUES ($1, $2, $3) RETURNING id`,
      [companyId, nummer, namn],
    );
    return r.rows[0].id as string;
  });
}

async function nyttProjekt(namn: string, nummer: number, kundId: string): Promise<string> {
  return withAdmin(async (c) => {
    const r = await c.query(
      `INSERT INTO projects (company_id, number, name, customer_id) VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [companyId, nummer, namn, kundId],
    );
    return r.rows[0].id as string;
  });
}

async function nyFaktura(kundId: string, nummer: number): Promise<string> {
  return withAdmin(async (c) => {
    const r = await c.query(
      `INSERT INTO invoices (company_id, customer_id, invoice_number, invoice_date, due_date,
                             created_by)
       VALUES ($1, $2, $3, current_date, current_date + 30, $4) RETURNING id`,
      [companyId, kundId, nummer, userId],
    );
    return r.rows[0].id as string;
  });
}

beforeAll(async () => {
  user = await registerUser('arendeprojekt');
  companyId = await createCompany(user.token, 'Locollabs AB');
  userId = user.userId;
});

describe('K-6: faktura -> projekt', () => {
  it('kopplar när kunden har exakt ETT projekt — och avstår när hon har två', async () => {
    // Entydig kund: ett projekt.
    const entydig = await nyKund('Entydig Kund AB', 9001);
    const projekt = await nyttProjekt('Entydigt uppdrag', 9001, entydig);
    const fEntydig = await nyFaktura(entydig, 9001);

    // Tvetydig kund: TVÅ projekt. Det är den negativa kontrollen — regeln ska
    // TIGA här, inte välja det ena.
    const tvetydig = await nyKund('Tvetydig Kund AB', 9002);
    await nyttProjekt('Första uppdraget', 9002, tvetydig);
    await nyttProjekt('Andra uppdraget', 9003, tvetydig);
    const fTvetydig = await nyFaktura(tvetydig, 9002);

    // Kund helt utan projekt (Ethos-fallet i produktion).
    const utan = await nyKund('Projektlös Kund AB', 9003);
    const fUtan = await nyFaktura(utan, 9003);

    // Regeln hamtas ur migrationen sjalv - en andra kopia i testet hade
    // blivit en andra sanning.
    const regel = await ifyllnadsregeln();
    await withAdmin((c) => c.query(regel));

    const rader = await withAdmin(async (c) => {
      const r = await c.query(
        'SELECT id, project_id FROM invoices WHERE id = ANY($1::uuid[])',
        [[fEntydig, fTvetydig, fUtan]],
      );
      return new Map(r.rows.map((x) => [x.id as string, x.project_id as string | null]));
    });

    expect(rader.get(fEntydig)).toBe(projekt);
    // Gissar inte. Ett tomt fält är ärligare än ett påhittat.
    expect(rader.get(fTvetydig)).toBeNull();
    expect(rader.get(fUtan)).toBeNull();
  });

  it('en faktura kan inte peka på ett annat bolags projekt', async () => {
    const annatBolag = await createCompany(user.token, 'Annat Bolag AB');
    const kund = await nyKund('Egen Kund AB', 9010);
    const faktura = await nyFaktura(kund, 9010);
    const frammande = await withAdmin(async (c) => {
      const k = await c.query(
        `INSERT INTO customers (company_id, customer_number, name)
         VALUES ($1, 1, 'Främmande Kund AB') RETURNING id`,
        [annatBolag],
      );
      const p = await c.query(
        `INSERT INTO projects (company_id, number, name, customer_id)
         VALUES ($1, 1, 'Främmande uppdrag', $2) RETURNING id`,
        [annatBolag, k.rows[0].id],
      );
      return p.rows[0].id as string;
    });

    // Sammansatt FK (id, company_id): det här ska vara omöjligt, inte bara
    // ogjort. En koppling över bolagsgränsen är alltid ett fel.
    await expect(
      withAdmin((c) =>
        c.query('UPDATE invoices SET project_id = $2 WHERE id = $1', [faktura, frammande]),
      ),
    ).rejects.toThrow(/invoices_project_fk/);
  });
});

describe('K-5: tidpost -> ärende', () => {
  it('ett halvfyllt ärendepar är omöjligt', async () => {
    const kund = await nyKund('Tidkund AB', 9020);
    const projekt = await nyttProjekt('Tiduppdrag', 9020, kund);
    const tid = await withAdmin(async (c) => {
      const r = await c.query(
        // status/billable_minutes är NOT NULL sedan 0062 (livscykeln) — en
        // tidpost utan status finns inte, inte ens i en fixtur.
        `INSERT INTO time_entries (company_id, project_id, work_date, minutes, description,
                                   status, billable_minutes)
         VALUES ($1, $2, current_date, 60, 'Arbete', 'godkand', 60) RETURNING id`,
        [companyId, projekt],
      );
      return r.rows[0].id as string;
    });

    // Id utan källa: ett id vars system är okänt är inte ett id.
    await expect(
      withAdmin((c) =>
        c.query(
          `UPDATE time_entries SET arende_id = gen_random_uuid() WHERE id = $1`,
          [tid],
        ),
      ),
    ).rejects.toThrow(/time_entries_arende_komplett_check/);

    // Nyckel utan id: en läsbar etikett utan identitet är precis den proxy
    // kopplingen finns för att undvika.
    await expect(
      withAdmin((c) =>
        c.query(`UPDATE time_entries SET arende_nyckel = 'LOC-316' WHERE id = $1`, [tid]),
      ),
    ).rejects.toThrow(/time_entries_arende_komplett_check/);

    // Komplett par går in.
    await expect(
      withAdmin((c) =>
        c.query(
          `UPDATE time_entries SET arende_id = gen_random_uuid(), arende_kalla = 'arenden',
                                   arende_nyckel = 'LOC-316' WHERE id = $1`,
          [tid],
        ),
      ),
    ).resolves.toBeTruthy();
  });

  it('ingen främmande nyckel mot ärendeplattformen — systemen ska kunna leva var för sig', async () => {
    const fk = await withAdmin(async (c) => {
      const r = await c.query(
        `SELECT count(*)::int AS n FROM pg_constraint
          WHERE conrelid = 'time_entries'::regclass AND contype = 'f'
            AND pg_get_constraintdef(oid) ILIKE '%arende%'`,
      );
      return r.rows[0].n as number;
    });
    // En FK hade gjort faktureringen beroende av att ärendeplattformen lever.
    expect(fk).toBe(0);
  });
});

/** Samma regelbrott prövar kantkontrollen på 0077 och CHECK som app på 0078. */
const BROTT: readonly { fall: string; nyckel: string | null; kalla: string }[] = [
  { fall: 'nyckeln saknas', nyckel: null, kalla: 'arenden' },
  { fall: 'nyckeln är tom', nyckel: '', kalla: 'arenden' },
  { fall: 'nyckeln är blanktecken', nyckel: '   ', kalla: 'arenden' },
  { fall: 'källan är tom', nyckel: 'LOC-316', kalla: '' },
  { fall: 'källan är blanktecken', nyckel: 'LOC-316', kalla: ' \t' },
];

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
async function databasPa0077(namn: string): Promise<pg.Client> {
  await withMaintenance(async (c) => {
    await c.query(`DROP DATABASE IF EXISTS ${namn} WITH (FORCE)`);
    await c.query(`CREATE DATABASE ${namn}`);
  });
  skapade.push(namn);
  const db = new pg.Client({ connectionString: scratchUrl(namn) });
  await db.connect();
  try {
    for (const m of (await loadMigrations()).filter((x) => x.version < 78)) await db.query(m.sql);
    return db;
  } catch (e) {
    await db.end();
    throw e;
  }
}

interface Bas { companyId: string; userId: string; projectId: string }

async function seedBas(db: pg.Client): Promise<Bas> {
  const u = await db.query<{ id: string }>(
    "INSERT INTO users (email, password_hash, name) VALUES ('arende@exempel.se', 'x', 'Arendeprov') RETURNING id",
  );
  const userId = u.rows[0]!.id;
  const c = await db.query<{ id: string }>(
    "INSERT INTO companies (name, org_number) VALUES ('Locollabs AB', '556000-0001') RETURNING id",
  );
  const companyId = c.rows[0]!.id;
  await db.query("INSERT INTO company_members (company_id, user_id, role) VALUES ($1, $2, 'owner')",
    [companyId, userId]);
  const k = await db.query<{ id: string }>(
    "INSERT INTO customers (company_id, customer_number, name) VALUES ($1, 1, 'Tidkund AB') RETURNING id",
    [companyId],
  );
  const p = await db.query<{ id: string }>(
    "INSERT INTO projects (company_id, customer_id, number, name) VALUES ($1, $2, 1, 'Tiduppdrag') RETURNING id",
    [companyId, k.rows[0]!.id],
  );
  return { companyId, userId, projectId: p.rows[0]!.id };
}

// pg.Client och PoolClient delar query-signaturen; samma fixtur används i båda lagren.
async function nyTid(
  c: Pick<pg.Client, 'query'>, bas: Bas, nyckel: string | null, kalla: string | null,
  arendeId: string | null = randomUUID(),
): Promise<string> {
  const r = await c.query<{ id: string }>(
    `INSERT INTO time_entries (company_id, project_id, work_date, minutes, description, status,
                               billable_minutes, arende_id, arende_nyckel, arende_kalla)
     VALUES ($1, $2, DATE '2026-09-01', 60, 'Arendeprov', 'godkand', 60, $3, $4, $5) RETURNING id`,
    [bas.companyId, bas.projectId, arendeId, nyckel, kalla],
  );
  return r.rows[0]!.id;
}

async function tidrad(c: Pick<pg.Client, 'query'>, id: string): Promise<Record<string, unknown>> {
  const r = await c.query('SELECT * FROM time_entries WHERE id = $1', [id]);
  expect(r.rows).toHaveLength(1);
  return r.rows[0] as Record<string, unknown>;
}

const GRANSKOLUMNER = new Set(['arende_id', 'extern_id', 'source_ref']);

/** Egna scheman härleds ur kedjans kod, så kommentarer inte blir schemaägare. */
async function egnaScheman(): Promise<string[]> {
  const sql = (await loadMigrations()).map((m) => m.sql.replace(/--.*$/gm, '')).join('\n');
  return [...new Set(['public', ...[...sql.matchAll(/CREATE SCHEMA (?:IF NOT EXISTS )?(\w+)/gi)]
    .map((m) => m[1]!)])].sort();
}

/** Hela databasen granskas: mål utanför egna scheman eller FK på extern identitet. */
async function gransbrott(c: pg.Client): Promise<string[]> {
  const egna = await egnaScheman();
  const r = await c.query<{ conname: string; mal_schema: string; kolumner: string[] }>(
    `SELECT con.conname, mn.nspname AS mal_schema,
            array_agg(a.attname::text ORDER BY a.attnum) AS kolumner
       FROM pg_constraint con
       JOIN pg_class mc ON mc.oid = con.confrelid
       JOIN pg_namespace mn ON mn.oid = mc.relnamespace
       JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = ANY (con.conkey)
      WHERE con.contype = 'f'
      GROUP BY con.oid, con.conname, mn.nspname`,
  );
  return r.rows
    .filter((x) => !egna.includes(x.mal_schema) || x.kolumner.some((k) => GRANSKOLUMNER.has(k)))
    .map((x) => x.conname).sort();
}

let kantfallKorda = 0;
let planteradeNycklar = 0;

afterAll(async () => {
  for (const namn of skapade) {
    await withMaintenance((c) => c.query(`DROP DATABASE IF EXISTS ${namn} WITH (FORCE)`));
  }
});

it('P2: 0078 har kantkontroll före NOT VALID och valideras i samma fil', async () => {
  const alla = await loadMigrations();
  expect(alla.find((m) => m.version === 78)).toMatchObject({
    name: 'arendenyckel', filename: '0078_arendenyckel.sql',
  });
  const kod = (await migration(78)).replace(/--.*$/gm, '');
  expect(kod).toMatch(/ADD CONSTRAINT time_entries_arende_nyckel_kravs\s+CHECK[\s\S]*?\)\s*NOT VALID;/);
  expect(kod).toContain('VALIDATE CONSTRAINT time_entries_arende_nyckel_kravs');
  expect(kod.indexOf('RAISE EXCEPTION')).toBeGreaterThanOrEqual(0);
  expect(kod.indexOf('RAISE EXCEPTION')).toBeLessThan(kod.indexOf('ADD CONSTRAINT'));
  expect(kod.indexOf('VALIDATE CONSTRAINT')).toBeLessThan(kod.indexOf('COMMENT ON CONSTRAINT'));
  for (const forbjudet of [/\bINSERT\b/i, /\bUPDATE\b/i, /action_approvals/i]) {
    expect(kod).not.toMatch(forbjudet);
  }
});

describe('P3: 0078 körs från disk mot en databas på 0077', () => {
  let db: pg.Client;
  let bas: Bas;
  let gammaltVillkor: string;
  let godaFore: Record<string, unknown>[];
  const trasiga: string[] = [];

  const villkor = async () => (await db.query(
    `SELECT contype, convalidated FROM pg_constraint
      WHERE conrelid = 'time_entries'::regclass AND conname = 'time_entries_arende_nyckel_kravs'`,
  )).rows;
  const gammalDefinition = async () => (await db.query<{ definition: string }>(
    `SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
      WHERE conrelid = 'time_entries'::regclass AND conname = 'time_entries_arende_komplett_check'`,
  )).rows[0]?.definition;

  beforeAll(async () => {
    db = await databasPa0077('redovisning_test_0078');
    bas = await seedBas(db);
    const definition = await gammalDefinition();
    expect(definition).toBeTypeOf('string');
    gammaltVillkor = definition as string;
    const komplett = await nyTid(db, bas, 'LOC-316', 'arenden');
    const okopplad = await nyTid(db, bas, null, null, null);
    godaFore = [await tidrad(db, komplett), await tidrad(db, okopplad)];
  });

  afterAll(async () => { if (db) await db.end(); });

  it.each(BROTT)('fäller $fall med driftbeskrivning och lämnar raden orörd', async ({ nyckel, kalla }) => {
    const id = await nyTid(db, bas, nyckel, kalla);
    const fore = await tidrad(db, id);
    const e = await fel(db.query(await migration(78)));
    expect(e?.code).toBe('P0001');
    expect(e?.message).toContain('driftfel fore 0078: 1 tidpost(er) har arende_id utan fryst arende_nyckel eller arende_kalla');
    expect(e?.message).toContain(id);
    expect(e?.message).not.toContain('Arendeprov');
    expect(await villkor()).toEqual([]);
    expect(await tidrad(db, id)).toEqual(fore);
    kantfallKorda++;
    // Drift lagar nyckeln; migrationen får aldrig radera eller fylla i rader själv.
    await db.query("UPDATE time_entries SET arende_nyckel = 'LOC-900', arende_kalla = 'arenden' WHERE id = $1", [id]);
  });

  it('rapporterar fem samtidiga regelbrott med alla fem id', async () => {
    for (const b of BROTT) trasiga.push(await nyTid(db, bas, b.nyckel, b.kalla));
    const fore = await Promise.all(trasiga.map((id) => tidrad(db, id)));
    const e = await fel(db.query(await migration(78)));
    expect(e?.code).toBe('P0001');
    expect(e?.message).toContain('driftfel fore 0078: 5 tidpost(er)');
    for (const id of trasiga) expect(e?.message).toContain(id);
    expect(e?.message).toContain([...trasiga].sort().join(', '));
    expect(await villkor()).toEqual([]);
    expect(await Promise.all(trasiga.map((id) => tidrad(db, id)))).toEqual(fore);
  });

  it('går igenom efter lagning, bevarar rader och 0060, och är idempotent', async () => {
    expect(trasiga).toHaveLength(BROTT.length);
    for (const id of trasiga) {
      await db.query("UPDATE time_entries SET arende_nyckel = 'LOC-901', arende_kalla = 'arenden' WHERE id = $1", [id]);
    }
    const fore = (await db.query('SELECT * FROM time_entries ORDER BY id')).rows;
    const sql = await migration(78);
    await db.query(sql);
    expect(await villkor()).toEqual([{ contype: 'c', convalidated: true }]);
    expect(await gammalDefinition()).toBe(gammaltVillkor);
    expect((await db.query('SELECT * FROM time_entries ORDER BY id')).rows).toEqual(fore);
    for (const rad of godaFore) expect(await tidrad(db, rad.id as string)).toEqual(rad);
    await db.query(sql);
    expect(await villkor()).toEqual([{ contype: 'c', convalidated: true }]);
    expect(await gammalDefinition()).toBe(gammaltVillkor);
    expect((await db.query('SELECT * FROM time_entries ORDER BY id')).rows).toEqual(fore);
  });
});

describe('P4–P7: schemat som app och den gemensamma REST-läsvägen', () => {
  let bas: Bas;
  let tid: string;
  let okopplad: string;
  let granne: TestUser;
  let grannbolag: string;

  const antal = async () => withAdmin(async (c) =>
    (await c.query<{ n: number }>('SELECT count(*)::int AS n FROM time_entries WHERE company_id = $1', [companyId])).rows[0]?.n);
  const rad = async () => withAdmin((c) => tidrad(c, tid));
  const anropa = (action: string, input: Record<string, unknown>) => api
    .post(`/api/companies/${companyId}/actions/${action}`)
    .set('Authorization', `Bearer ${user.token}`).send(input);

  beforeAll(async () => {
    const kund = await nyKund('Nyckelprov AB', 9030);
    bas = { companyId, userId, projectId: await nyttProjekt('Nyckeluppdrag', 9030, kund) };
    tid = await withAdmin((c) => nyTid(c, bas, null, null, null));
    okopplad = await withAdmin((c) => nyTid(c, bas, null, null, null));
    granne = await registerUser('arendegranne');
    grannbolag = await createCompany(granne.token, 'Grannbolag AB');
  });

  it('P4: provets tenant-transaktion skriver som rollen app', async () => {
    await withTenantTransaction(userId, companyId, async (c) => {
      const r = await c.query<{ roll: string }>('SELECT current_user AS roll');
      expect(r.rows[0]?.roll).toBe('app');
    });
  });

  const skrivfall = [
    ...BROTT.map((b) => ({ ...b, villkor: 'time_entries_arende_nyckel_kravs' })),
    { fall: 'id utan nyckel och källa', nyckel: null, kalla: null, villkor: 'time_entries_arende_komplett_check' },
    { fall: 'id och nyckel utan källa', nyckel: 'LOC-316', kalla: null, villkor: 'time_entries_arende_komplett_check' },
    { fall: 'nyckeln är tabb och radbrytning', nyckel: '\t\n', kalla: 'arenden', villkor: 'time_entries_arende_nyckel_kravs' },
  ];

  it.each(skrivfall)('P4: UPDATE och INSERT avvisar $fall utan verkan', async ({ nyckel, kalla, villkor }) => {
    const fore = await rad();
    const n = await antal();
    const e = await fel(withTenantTransaction(userId, companyId, (c) => c.query(
      'UPDATE time_entries SET arende_id = $2, arende_nyckel = $3, arende_kalla = $4 WHERE id = $1',
      [tid, randomUUID(), nyckel, kalla],
    )));
    expect(e).toMatchObject({ code: '23514', constraint: villkor });
    expect(await rad()).toEqual(fore);
    const ins = await fel(withTenantTransaction(userId, companyId, (c) => nyTid(c, bas, nyckel, kalla)));
    expect(ins).toMatchObject({ code: '23514', constraint: villkor });
    expect(await antal()).toBe(n);
    expect(await rad()).toEqual(fore);
  });

  it('P4: komplett trippel och tre NULL går in både med INSERT och UPDATE', async () => {
    const arendeId = randomUUID();
    await withTenantTransaction(userId, companyId, async (c) => {
      await nyTid(c, bas, 'LOC-317', 'arenden', arendeId);
      await nyTid(c, bas, null, null, null);
      await c.query("UPDATE time_entries SET arende_id = $2, arende_nyckel = 'LOC-316', arende_kalla = 'arenden' WHERE id = $1", [tid, arendeId]);
      expect(await tidrad(c, tid)).toMatchObject({ arende_id: arendeId, arende_nyckel: 'LOC-316', arende_kalla: 'arenden' });
      await c.query('UPDATE time_entries SET arende_id = NULL, arende_nyckel = NULL, arende_kalla = NULL WHERE id = $1', [tid]);
      expect(await tidrad(c, tid)).toMatchObject({ arende_id: null, arende_nyckel: null, arende_kalla: null });
    });
  });

  it.each([false, true])('P5: REST avvisar ärende-id med nyckel = %s', async (medNyckel) => {
    const fore = await rad();
    const n = await antal();
    const koppling = { arende_id: randomUUID(), ...(medNyckel ? { arende_nyckel: 'LOC-316' } : {}) };
    for (const [action, input] of [
      ['log_time', { project_id: bas.projectId, work_date: '2026-09-01', minutes: 60, description: 'REST-prov', ...koppling }],
      ['update_time_entry', { time_entry_id: tid, description: 'Ska inte sparas', ...koppling }],
    ] as const) {
      const res = await anropa(action, input);
      expect(res.status, JSON.stringify(res.body)).toBe(400);
      expect(res.body.error).toBe('validation_error');
      expect(JSON.stringify(res.body.details)).toContain('arende_id');
      expect(await antal()).toBe(n);
      expect(await rad()).toEqual(fore);
    }
  });

  it('P6: granskar hela schemat och upptäcker tre planterade FK över gränsen', async () => {
    expect(await egnaScheman()).toEqual(['crm', 'public']);
    await withAdmin(async (c) => {
      expect(await gransbrott(c)).toEqual([]);
      const kolumner = await c.query<{ tabell: string; kolumn: string }>(
        `SELECT table_name AS tabell, column_name AS kolumn FROM information_schema.columns
          WHERE table_schema = 'public' AND (table_name, column_name) IN
            (('time_entries', 'arende_id'), ('time_entries', 'source_ref'),
             ('uppdrag_referens', 'extern_id'), ('uppdrag_dokument', 'extern_id'))
          ORDER BY table_name, column_name`,
      );
      expect(kolumner.rows).toEqual([
        { tabell: 'time_entries', kolumn: 'arende_id' },
        { tabell: 'time_entries', kolumn: 'source_ref' },
        { tabell: 'uppdrag_dokument', kolumn: 'extern_id' },
        { tabell: 'uppdrag_referens', kolumn: 'extern_id' },
      ]);
      await c.query('BEGIN');
      try {
        await c.query(`
          CREATE SCHEMA planterad_arendeplattform;
          CREATE TABLE planterad_arendeplattform.issues (id uuid PRIMARY KEY);
          CREATE TABLE public.planterad_arendespegel (id uuid PRIMARY KEY);
          ALTER TABLE time_entries ADD CONSTRAINT planterad_over_gransen
            FOREIGN KEY (arende_id) REFERENCES planterad_arendeplattform.issues (id) NOT VALID;
          ALTER TABLE time_entries ADD CONSTRAINT planterad_spegel
            FOREIGN KEY (arende_id) REFERENCES public.planterad_arendespegel (id) NOT VALID;
          ALTER TABLE time_entries ADD CONSTRAINT planterad_schema
            FOREIGN KEY (project_id) REFERENCES planterad_arendeplattform.issues (id) NOT VALID;
        `);
        const brott = await gransbrott(c);
        expect(brott).toEqual(['planterad_over_gransen', 'planterad_schema', 'planterad_spegel']);
        planteradeNycklar = brott.length;
      } finally {
        await c.query('ROLLBACK');
      }
      expect(await gransbrott(c)).toEqual([]);
    });
  });

  it('P7: läser fryst nyckel och källa utan uppslag, och NULL för en okopplad post', async () => {
    const arendeId = randomUUID();
    await withAdmin((c) => c.query(
      "UPDATE time_entries SET arende_id = $2, arende_nyckel = 'LOC-316', arende_kalla = 'arenden' WHERE id = $1",
      [tid, arendeId],
    ));
    const kalla = await readFile(new URL('../src/services/projects.ts', import.meta.url), 'utf8');
    for (const forbjudet of ['fetch(', 'node:http', 'node:https', 'require(', 'axios']) {
      expect(kalla).not.toContain(forbjudet);
    }
    const riktig = globalThis.fetch;
    globalThis.fetch = (() => { throw new Error('läsvägen ringde ut'); }) as typeof globalThis.fetch;
    try {
      const res = await anropa('list_time_entries', { project_id: bas.projectId });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const rader = res.body.result as Record<string, unknown>[];
      expect(rader.find((r) => r.id === tid)).toMatchObject({
        arende_id: arendeId, arende_nyckel: 'LOC-316', arende_kalla: 'arenden',
      });
      expect(rader.find((r) => r.id === okopplad)).toMatchObject({
        arende_id: null, arende_nyckel: null, arende_kalla: null,
      });
      // update_time_entry använder samma läsväg för sitt svar.
      const uppdaterad = await anropa('update_time_entry', { time_entry_id: tid, description: 'Läsbar också efter rättning' });
      expect(uppdaterad.status, JSON.stringify(uppdaterad.body)).toBe(200);
      expect(uppdaterad.body.result).toMatchObject({
        arende_id: arendeId, arende_nyckel: 'LOC-316', arende_kalla: 'arenden',
      });
    } finally {
      globalThis.fetch = riktig;
    }
    const res = await api.post(`/api/companies/${grannbolag}/actions/list_time_entries`)
      .set('Authorization', `Bearer ${granne.token}`).send({});
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.result).toEqual([]);
    expect(JSON.stringify(res.body.result)).not.toContain('LOC-316');
  });
});

it('P8: alla fem kantfall och den negativa FK-kontrollen har faktiskt körts', () => {
  expect(kantfallKorda).toBe(BROTT.length);
  expect(planteradeNycklar).toBe(3);
});
