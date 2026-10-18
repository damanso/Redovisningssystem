// Story 3.1: aldrig verifierade rader får inte kallas levande, en fryst
// revision får inte ändras och ett händelsedatum får aldrig hittas på.
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadMigrations } from '../src/db/migrate.js';
import { withTenantTransaction } from '../src/db/tx.js';
import { kanonisktReferensId, referensFormFel } from '../src/lib/referens.js';
import { api, createCompany, createFiscalYear, registerUser, type TestUser } from './helpers.js';

const fel = (p: Promise<unknown>) => p.then(() => null, (e: unknown) => e as { message: string; code: string; constraint?: string });
async function migration(): Promise<string> {
  const m = (await loadMigrations()).find((x) => x.version === 86);
  expect(m, 'migration 0086 saknas').toBeDefined();
  if (!m) throw new Error('migration 0086 saknas');
  return m.sql;
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

// Båda databaserna provas: äldre rader rättas och appens framtida skrivningar spärras.
describe('Story 3.1 · migration 0086', () => {
  const namn = 'redovisning_test_0086';
  let db: pg.Client;
  let companyId: string;
  let a1: string;
  let a2: string;
  let user: TestUser;
  let appCompany: string;
  let appContract: string;
  const rader = new Map<string, string>();
  const foreMejl = new Map<string, { id: string; oppet: boolean }>();
  const snapshot = async () => (await db.query('SELECT * FROM uppdrag_referens ORDER BY id')).rows;
  const tx = <T>(fn: (c: pg.PoolClient) => Promise<T>) => withTenantTransaction(user.userId, appCompany, fn);
  const skriv = (sort: string, revision: number | null = null, status?: string) => tx(async (c) => {
    const res = await c.query(`INSERT INTO uppdrag_referens (company_id, contract_id, sort, extern_id, revision${status ? ', status' : ''})
      VALUES ($1,$2,$3,$4,$5${status ? ',$6' : ''}) RETURNING id, status, revision`,
    [appCompany, appContract, sort, randomUUID(), revision, ...(status ? [status] : [])]);
    return res.rows[0]!;
  });
  beforeAll(async () => {
    await withMaintenance(async (c) => {
      await c.query(`DROP DATABASE IF EXISTS ${namn} WITH (FORCE)`);
      await c.query(`CREATE DATABASE ${namn}`);
    });
    db = new pg.Client({ connectionString: scratchUrl(namn) });
    await db.connect();
    for (const m of (await loadMigrations()).filter((x) => x.version < 86)) await db.query(m.sql);
    const uid = (await db.query("INSERT INTO users (email,password_hash,name) VALUES ('referens0086@exempel.se','x','Referensprov') RETURNING id")).rows[0]!.id;
    companyId = (await db.query("INSERT INTO companies (name,org_number) VALUES ('Referens AB','556000-0001') RETURNING id")).rows[0]!.id;
    await db.query("INSERT INTO company_members (company_id,user_id,role) VALUES ($1,$2,'owner')", [companyId, uid]);
    const kund = (await db.query("INSERT INTO customers (company_id,customer_number,name) VALUES ($1,1,'Referenskund') RETURNING id", [companyId])).rows[0]!.id;
    const avtal: string[] = [];
    const projekt: string[] = [];
    for (let nr = 1; nr <= 2; nr++) {
      const pid = (await db.query('INSERT INTO projects (company_id,customer_id,number,name) VALUES ($1,$2,$3,$4) RETURNING id', [companyId, kund, nr, `P${nr}`])).rows[0]!.id;
      projekt.push(pid);
      avtal.push((await db.query("INSERT INTO contracts (company_id,project_id,name,signed_date,created_by) VALUES ($1,$2,$3,'2026-09-07',$4) RETURNING id", [companyId, pid, `A${nr}`, uid])).rows[0]!.id);
    }
    [a1, a2] = avtal as [string, string];
    const seed: Array<[string, string, string, string, string | null]> = [
      ['r1',a1,'drive','fil-1',null], ['r2',a1,'drive','fil-2','2026-09-01 08:00+02'],
      ['r4',a2,'drive','fil-4',null], ['r5',a1,'mejl','<m5@ilt.example>',null],
      ['r6',a1,'mejl','m6@ilt.example','2026-09-02 08:00+02'], ['r7',a2,'mejl','<m7@ilt.example>',null],
      ['r8',a1,'mejl','ej-ett-message-id',null], ['k1',a1,'mejl','<kollision@ilt.example>',null], ['k2',a1,'mejl','kollision@ilt.example',null],
    ];
    for (const [namnRad, contract, sort, externId, tid] of seed) {
      const id = (await db.query("INSERT INTO uppdrag_referens (company_id,contract_id,sort,extern_id,status,senast_verifierad) VALUES ($1,$2,$3,$4,'levande',$5) RETURNING id", [companyId,contract,sort,externId,tid])).rows[0]!.id as string;
      rader.set(namnRad, id);
      if (sort === 'mejl' && namnRad !== 'k2') foreMejl.set(id, { id: externId, oppet: contract === a1 });
    }
    await db.query("UPDATE projects SET status='closed' WHERE id=$1", [projekt[1]]);
    user = await registerUser('referens0086');
    appCompany = await createCompany(user.token, 'Referens0086 AB');
    const auth = { Authorization: `Bearer ${user.token}` };
    await createFiscalYear(appCompany, auth, { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });
    const act = async (action: string, data: Record<string, unknown>) => {
      const res = await api.post(`/api/companies/${appCompany}/actions/${action}`).set(auth).send(data);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      return res.body.result;
    };
    const p = await act('create_project', { name: 'App-referenser' });
    appContract = (await act('skapa_uppdrag', { project_id: p.id, name: 'Avtal', signed_date: '2026-09-07' })).contract_id;
  });
  afterAll(async () => {
    if (db) await db.end();
    await withMaintenance((c) => c.query(`DROP DATABASE IF EXISTS ${namn} WITH (FORCE)`));
  });
  it('M1 kantkontrollen namnger kollisionen och lämnar hela databasen orörd', async () => {
    const fore = await snapshot();
    const e = await fel(db.query(await migration()));
    expect(e?.message).toMatch(/uppdrag_referens/);
    expect(e?.message).toMatch(/kollision/);
    expect(await snapshot()).toEqual(fore);
    expect((await db.query("SELECT column_name FROM information_schema.columns WHERE table_name='uppdrag_referens' AND column_name='handelse_datum'")).rows).toEqual([]);
  });
  it('M2 rättar bara öppna aldrig verifierade rader och kanoniska mejl', async () => {
    await db.query('DELETE FROM uppdrag_referens WHERE id=$1', [rader.get('k2')]);
    await db.query(await migration());
    const efter = await snapshot();
    const rad = (n: string) => efter.find((r) => r.id === rader.get(n))!;
    for (const n of ['r1','r5','r8','k1']) expect(rad(n).status, n).toBe('overifierad');
    for (const n of ['r2','r4','r6','r7']) expect(rad(n).status, n).toBe('levande');
    expect(rad('r5').extern_id).toBe('m5@ilt.example');
    expect(rad('r6').extern_id).toBe('m6@ilt.example');
    expect(rad('r7').extern_id).toBe('<m7@ilt.example>');
    expect(rad('r8').extern_id).toBe('ej-ett-message-id');
    expect(rad('k1').extern_id).toBe('kollision@ilt.example');
    for (const [id, fore] of foreMejl) {
      const k = kanonisktReferensId('mejl', fore.id);
      expect(efter.find((r) => r.id === id)!.extern_id).toBe(fore.oppet && referensFormFel('mejl', k) === null ? k : fore.id);
    }
  });
  it('M3 en andra körning ändrar ingenting', async () => {
    const fore = await snapshot();
    await db.query(await migration());
    expect(await snapshot()).toEqual(fore);
  });
  it('M4 kolumner, standardstatus, fem statusar och kategorin är exakta', async () => {
    const cols = (await db.query("SELECT column_name,data_type,column_default FROM information_schema.columns WHERE table_name='uppdrag_referens' ORDER BY ordinal_position")).rows;
    expect(Object.fromEntries(cols.map((c) => [c.column_name,c.data_type]))).toEqual({
      id:'uuid',company_id:'uuid',contract_id:'uuid',sort:'text',extern_id:'text',extern_nyckel:'text',extern_kalla:'text',titel_vid_lankning:'text',hash_vid_lankning:'text',senast_verifierad:'timestamp with time zone',status:'text',ko_status:'text',created_at:'timestamp with time zone',ko_fel:'text',handelse_datum:'date',revision:'bigint',
    });
    expect(cols.find((c) => c.column_name === 'status')!.column_default).toContain("'overifierad'");
    for (const col of cols) expect(['bytea','json','jsonb']).not.toContain(col.data_type);
    for (const name of ['handelse_datum','revision']) expect(cols.find((c) => c.column_name === name)!.column_default).toBeNull();
    const check = (await db.query("SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname='uppdrag_referens_status_check'")).rows[0]!.def as string;
    expect([...check.matchAll(/'([^']+)'/g)].map((m) => m[1])).toEqual(['overifierad','levande','drift','trasig','utanfor_sparr']);
    expect((await db.query("SELECT obj_description('uppdrag_referens'::regclass) AS text")).rows[0]!.text).toMatch(/^Kategori: REFERENS\./);
  });
  it('M5 app får standardstatus och spärras av status- och revisionsvillkoren', async () => {
    await tx(async (c) => expect((await c.query('SELECT current_user AS roll')).rows[0]!.roll).toBe('app'));
    expect((await skriv('drive')).status).toBe('overifierad');
    expect((await skriv('drive',null,'utanfor_sparr')).status).toBe('utanfor_sparr');
    expect(await fel(skriv('drive',null,'okand'))).toMatchObject({ constraint: 'uppdrag_referens_status_check' });
    expect(await fel(skriv('mejl',3))).toMatchObject({ constraint: 'uppdrag_referens_revision_bara_drive' });
    expect(await fel(skriv('drive',-1))).toMatchObject({ constraint: 'uppdrag_referens_revision_bara_drive' });
  });
  it('M6 app får ändra läget men aldrig revisionen, inte heller från NULL', async () => {
    for (const revision of [3,null]) {
      const r = await skriv('drive', revision);
      const e = await fel(tx((c) => c.query('UPDATE uppdrag_referens SET revision=$3 WHERE company_id=$1 AND id=$2', [appCompany,r.id,revision === null ? 3 : 4])));
      expect(e?.message).toMatch(/revision/);
      await tx((c) => c.query("UPDATE uppdrag_referens SET status='drift' WHERE company_id=$1 AND id=$2", [appCompany,r.id]));
    }
  });
  it('M7 migrationen hämtar aldrig datum ur created_at', async () => {
    for (const r of await snapshot()) expect(r.handelse_datum).toBeNull();
  });
});
