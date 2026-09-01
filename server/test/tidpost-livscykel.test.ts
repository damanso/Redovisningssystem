// Tid, story 1/9 (PRD_TIDSRAPPORTERING §9 steg 1): tidspostens livscykel.
//
// Provet är PRD §1 inverterad. Två fel hände på riktigt i juli 2026:
//   rad 1 — fakturan skickades utan att posterna markerades → de kan
//           faktureras en gång till,
//   rad 2 — två poster skulle aldrig faktureras, och det gick inte att SÄGA.
// Sviten kräver att båda är omöjliga efter det här bygget: att en fakturerad
// post varken går att ändra (409) eller plockas av ett nytt fakturaunderlag,
// och att en post går att klassa om med en orsak som går att läsa i efterhand.
//
// Första blocket kör den RIKTIGA migrationskedjan mot en egen databas som
// stannar på 0061, seedar data i den gamla formen (billable/invoiced) och låter
// 0062 möta den. Det är enda sättet att pröva en backfill: mot den värld som
// faktiskt fanns före den.
import { copyFile, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate } from '../src/db/migrate.js';
import { api, createCompany, registerUser, withAdmin, type TestUser } from './helpers.js';

const MIGRATIONS_DIR = fileURLToPath(new URL('../migrations/', import.meta.url));
const SISTA_FORE = 61;
const SCRATCH_DB = 'redovisning_test_tidpost';

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

async function kopieraMigrationer(dir: string, tillOchMed: number): Promise<void> {
  const filer = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql'));
  for (const f of filer) {
    if (Number(f.slice(0, 4)) <= tillOchMed) {
      await copyFile(path.join(MIGRATIONS_DIR, f), path.join(dir, f));
    }
  }
}

/** Datafixens EGET stycke ur migrationsfilen — inte en kopia som kan glida isär. */
async function datafixBlock(): Promise<string> {
  const filer = (await readdir(MIGRATIONS_DIR)).filter((f) => f.startsWith('0062_'));
  expect(filer).toHaveLength(1);
  const sql = await readFile(path.join(MIGRATIONS_DIR, filer[0]!), 'utf8');
  const efter = sql.split('-- >>> DATAFIX_START')[1];
  expect(efter, 'markören DATAFIX_START saknas i 0062').toBeTruthy();
  const block = efter!.split('-- <<< DATAFIX_SLUT')[0];
  expect(block, 'markören DATAFIX_SLUT saknas i 0062').toBeTruthy();
  return block!;
}

// ---------------------------------------------------------------------------
// Block 1: migrationen mot den gamla världen
// ---------------------------------------------------------------------------
describe('0062 mot en databas på 0061 med data i den gamla formen', () => {
  let dir: string;
  let db: pg.Client;
  // Bolag A = Locollabs form: fakturan bär sitt projekt (0060 satte det).
  const a: Record<string, string> = {};
  // Bolag B = samma fel, men fakturan saknar projekt → kundens enda projekt.
  const b: Record<string, string> = {};

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'tidpost-migrationer-'));
    await kopieraMigrationer(dir, SISTA_FORE);
    await withMaintenance(async (c) => {
      await c.query(`DROP DATABASE IF EXISTS ${SCRATCH_DB} WITH (FORCE)`);
      await c.query(`CREATE DATABASE ${SCRATCH_DB}`);
    });
    await migrate(scratchUrl(), { dir });

    db = new pg.Client({ connectionString: scratchUrl() });
    await db.connect();

    const enkel = async (sql: string, params: unknown[]): Promise<string> =>
      (await db.query<{ id: string }>(sql, params)).rows[0]!.id;

    const userId = await enkel(
      `INSERT INTO users (email, password_hash, name) VALUES ($1, 'x', 'David') RETURNING id`,
      ['tidpost@example.se'],
    );

    for (const [nyckel, bolag] of [['a', a], ['b', b]] as const) {
      bolag.company = await enkel(
        'INSERT INTO companies (name) VALUES ($1) RETURNING id', [`Bolag ${nyckel.toUpperCase()} AB`],
      );
      await db.query('INSERT INTO company_members (company_id, user_id) VALUES ($1, $2)',
        [bolag.company, userId]);
      bolag.customer = await enkel(
        'INSERT INTO customers (company_id, customer_number, name) VALUES ($1, 1, $2) RETURNING id',
        [bolag.company, `Kund ${nyckel.toUpperCase()} AB`],
      );
      bolag.projekt = await enkel(
        'INSERT INTO projects (company_id, customer_id, number, name) VALUES ($1, $2, 1, $3) RETURNING id',
        [bolag.company, bolag.customer, 'Uppdraget'],
      );
    }

    // Bolag A har DESSUTOM ett andra projekt utan kund — där bor de tre
    // backfill-klasserna, så att datafixen (som bara rör fakturans projekt)
    // och backfillen (som rör allt) inte kan förväxlas i utfallet.
    a.ovrigt = await enkel(
      'INSERT INTO projects (company_id, number, name) VALUES ($1, 2, $2) RETURNING id',
      [a.company, 'Övrigt'],
    );

    // Fakturorna: numret kunden fick är 27 i båda fallen (0046:s
    // effective_invoice_number). A bär projektet, B gör det inte.
    a.faktura = await enkel(
      `INSERT INTO invoices (company_id, customer_id, invoice_number, invoice_date, due_date,
                             status, total_ore, created_by, project_id)
       VALUES ($1, $2, 27, DATE '2026-08-01', DATE '2026-08-31', 'sent', 4320250, $3, $4) RETURNING id`,
      [a.company, a.customer, userId, a.projekt],
    );
    b.faktura = await enkel(
      `INSERT INTO invoices (company_id, customer_id, invoice_number, invoice_date, due_date,
                             status, total_ore, created_by)
       VALUES ($1, $2, 27, DATE '2026-08-05', DATE '2026-09-04', 'sent', 1000000, $3) RETURNING id`,
      [b.company, b.customer, userId],
    );

    const tid = async (
      companyId: string, projektId: string, datum: string, minuter: number,
      beskrivning: string, billable: boolean, invoiced: boolean,
    ): Promise<string> => enkel(
      `INSERT INTO time_entries (company_id, project_id, work_date, minutes, description,
                                 billable, invoiced, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [companyId, projektId, datum, minuter, beskrivning, billable, invoiced, userId],
    );

    // Julifakturans poster (bolag A).
    a.juli1 = await tid(a.company!, a.projekt!, '2026-07-01', 180, 'Fas 2A: modellstart', true, false);
    a.juli2 = await tid(a.company!, a.projekt!, '2026-07-10', 25, 'Fas 1A: körplan', true, false);
    a.juli3 = await tid(a.company!, a.projekt!, '2026-07-29', 120, 'Fas 2A: Cockpit v6', true, false);
    a.admin = await tid(a.company!, a.projekt!, '2026-07-15', 60, 'Administration och fakturaunderlag', true, false);
    a.support = await tid(a.company!, a.projekt!, '2026-07-16', 45, 'Supportmatris för kundtjänst', true, false);
    // Arbete UTFÖRT efter att fakturan ställdes ut hör till nästa faktura.
    a.augusti = await tid(a.company!, a.projekt!, '2026-08-15', 30, 'Augustiarbete', true, false);

    // Backfillens tre klasser (bolag A, annat projekt).
    a.klassFakturerad = await tid(a.company!, a.ovrigt!, '2026-05-02', 100, 'Redan fakturerad', true, true);
    a.klassIgnorerad = await tid(a.company!, a.ovrigt!, '2026-05-03', 90, 'Internt möte', false, false);
    a.klassGodkand = await tid(a.company!, a.ovrigt!, '2026-05-04', 60, 'Kundarbete', true, false);

    // Bolag B: två poster i juli, ingen av dem admin/supportmatris.
    b.juli1 = await tid(b.company!, b.projekt!, '2026-07-04', 90, 'Utredning', true, false);
    b.juli2 = await tid(b.company!, b.projekt!, '2026-07-05', 30, 'Avstämning', true, false);

    await copyFile(path.join(MIGRATIONS_DIR, '0062_tidpost_livscykel.sql'),
      path.join(dir, '0062_tidpost_livscykel.sql'));
    const res = await migrate(scratchUrl(), { dir });
    expect(res.applied).toEqual(['0062_tidpost_livscykel.sql']);
  }, 120_000);

  afterAll(async () => {
    await db?.end();
    await withMaintenance((c) => c.query(`DROP DATABASE IF EXISTS ${SCRATCH_DB} WITH (FORCE)`));
    await rm(dir, { recursive: true, force: true });
  });

  async function post(id: string): Promise<{
    status: string; billable_minutes: number; minutes: number; billable: boolean;
    invoiced: boolean; invoice_id: string | null; adjustment_reason: string | null;
  }> {
    const r = await db.query(
      `SELECT status, billable_minutes, minutes, billable, invoiced, invoice_id, adjustment_reason
       FROM time_entries WHERE id = $1`, [id]);
    return r.rows[0];
  }

  it('backfillen ger de tre klasserna var sitt tillstånd — och inget annat', async () => {
    const fakturerad = await post(a.klassFakturerad!);
    expect(fakturerad.status).toBe('fakturerad');
    expect(fakturerad.billable_minutes).toBe(100); // registrerade = debiterbara

    const ignorerad = await post(a.klassIgnorerad!);
    expect(ignorerad.status).toBe('ignorerad');
    expect(ignorerad.billable_minutes).toBe(0);    // bortvald tid debiteras inte
    expect(ignorerad.minutes).toBe(90);            // men den registrerade tiden står kvar

    const godkand = await post(a.klassGodkand!);
    expect(godkand.status).toBe('godkand');
    expect(godkand.billable_minutes).toBe(60);
  });

  it('kolumnen minutes är orörd — registrerad tid är fortfarande registrerad tid', async () => {
    const r = await db.query<{ n: string }>(
      'SELECT sum(minutes)::text AS n FROM time_entries WHERE company_id = $1', [a.company]);
    // 180+25+120+60+45+30 + 100+90+60
    expect(Number(r.rows[0]!.n)).toBe(710);
  });

  it('datafixen låser julifakturans poster med FAKTURANS id (PRD §1 rad 1)', async () => {
    for (const id of [a.juli1!, a.juli2!, a.juli3!]) {
      const p = await post(id);
      expect(p.status).toBe('fakturerad');
      expect(p.invoiced).toBe(true);
      expect(p.invoice_id).toBe(a.faktura);
    }
  });

  it('de två som aldrig skulle faktureras blir ignorerade MED orsak (PRD §1 rad 2)', async () => {
    for (const id of [a.admin!, a.support!]) {
      const p = await post(id);
      expect(p.status).toBe('ignorerad');
      expect(p.billable).toBe(false);
      expect(p.billable_minutes).toBe(0);
      expect(p.invoice_id).toBeNull();
      expect(p.adjustment_reason).toContain('0062');
    }
  });

  it('arbete efter fakturadatumet rörs inte — det hör till nästa faktura', async () => {
    const p = await post(a.augusti!);
    expect(p.status).toBe('godkand');
    expect(p.invoice_id).toBeNull();
  });

  it('fakturan utan projektkoppling hittar kundens enda projekt', async () => {
    for (const id of [b.juli1!, b.juli2!]) {
      const p = await post(id);
      expect(p.status).toBe('fakturerad');
      expect(p.invoice_id).toBe(b.faktura);
    }
  });

  it('varje ändrad rad går att se i efterhand', async () => {
    const r = await db.query<{ time_entry_id: string; from_status: string; to_status: string; reason: string }>(
      `SELECT time_entry_id, from_status, to_status, reason FROM time_entry_datafix_log
       WHERE migration = '0062' ORDER BY to_status, time_entry_id`);
    expect(r.rows).toHaveLength(7); // 3 + 2 i bolag A, 2 i bolag B
    expect(r.rows.filter((x) => x.to_status === 'fakturerad')).toHaveLength(5);
    expect(r.rows.filter((x) => x.to_status === 'ignorerad')).toHaveLength(2);
    expect(new Set(r.rows.map((x) => x.from_status))).toEqual(new Set(['godkand']));
    expect(r.rows.map((x) => x.time_entry_id)).toContain(a.admin);
  });

  it('datajobbet kan köras om utan att ändra en enda rad', async () => {
    const fore = await db.query('SELECT id, status, invoice_id FROM time_entries ORDER BY id');
    await db.query(await datafixBlock());
    const efter = await db.query('SELECT id, status, invoice_id FROM time_entries ORDER BY id');
    expect(efter.rows).toEqual(fore.rows);
    const logg = await db.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM time_entry_datafix_log WHERE migration = '0062'");
    expect(Number(logg.rows[0]!.n)).toBe(7);
  });

  it('en tidpost kan aldrig låsas av ett annat bolags faktura', async () => {
    await expect(
      db.query('UPDATE time_entries SET invoice_id = $2 WHERE id = $1', [a.augusti, b.faktura]),
    ).rejects.toThrow(/time_entries_invoice_fk/);
  });

  it('ingen status utanför livscykeln går in i databasen', async () => {
    await expect(
      db.query("UPDATE time_entries SET status = 'klar' WHERE id = $1", [a.augusti]),
    ).rejects.toThrow(/time_entries_status_check/);
  });
});

// ---------------------------------------------------------------------------
// Block 2: actions-lagret
// ---------------------------------------------------------------------------
let user: TestUser;
let agentToken: string;
let companyId: string;
let customerId: string;
let projectId: string;
const auth = () => ({ Authorization: `Bearer ${user.token}` });
const asAgent = () => ({ Authorization: `Bearer ${agentToken}` });
const co = () => `/api/companies/${companyId}`;

const act = (namn: string, body: Record<string, unknown>) =>
  api.post(`${co()}/actions/${namn}`).set(auth()).send(body);
const agentAct = (namn: string, body: Record<string, unknown>) =>
  api.post(`${co()}/actions/${namn}`).set(asAgent()).send(body);

async function loggaTid(body: Record<string, unknown>): Promise<string> {
  const r = await act('log_time', { project_id: projectId, work_date: '2026-09-01', minutes: 60, description: 'Arbete', ...body });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body.result.id as string;
}

async function rad(id: string): Promise<Record<string, unknown>> {
  return withAdmin(async (c) => (await c.query(
    `SELECT status, minutes, billable_minutes, billable, invoiced, invoice_id, approved_by, adjustment_reason
     FROM time_entries WHERE id = $1`, [id])).rows[0]);
}

beforeAll(async () => {
  user = await registerUser('tidpost');
  companyId = await createCompany(user.token, 'Locollabs AB');
  const t = await api.post(`${co()}/agent-tokens`).set(auth()).send({ name: 'Cowork' });
  expect(t.status, JSON.stringify(t.body)).toBe(201);
  agentToken = t.body.token;
  const k = await api.post(`${co()}/customers`).set(auth()).send({ name: 'ILT Inläsningstjänst AB' });
  customerId = k.body.customer.id;
  const p = await act('create_project', { name: 'ILT-uppdraget', customer_id: customerId, hourly_rate_ore: 110_000 });
  expect(p.status, JSON.stringify(p.body)).toBe(200);
  projectId = p.body.result.id;
});

describe('log_time: vem som skriver avgör tillståndet', () => {
  it('en människa GODKÄNNER direkt, och godkännandet har ett namn', async () => {
    const id = await loggaTid({ minutes: 120, description: 'Modellstart' });
    const r = await rad(id);
    expect(r.status).toBe('godkand');
    expect(r.billable_minutes).toBe(120); // utelämnat = registrerad tid
    expect(r.approved_by).toBe(user.userId);
  });

  it('AI:t FÖRESLÅR — posten är inte godkänd förrän en människa sagt det', async () => {
    const r = await agentAct('log_time', {
      project_id: projectId, work_date: '2026-09-02', minutes: 45, description: 'Ur kalendern',
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const p = await rad(r.body.result.id);
    expect(p.status).toBe('forslag');
    expect(p.approved_by).toBeNull();
  });

  it('debiterbar tid som skiljer sig från registrerad kräver en orsak', async () => {
    const utan = await act('log_time', {
      project_id: projectId, work_date: '2026-09-03', minutes: 120, description: 'Långt möte',
      billable_minutes: 60,
    });
    expect(utan.status).toBe(400);
    expect(utan.body.error).toBe('adjustment_reason_required');

    const id = await loggaTid({
      work_date: '2026-09-03', minutes: 120, description: 'Långt möte',
      billable_minutes: 60, adjustment_reason: 'Halva mötet var vår egen förberedelse',
    });
    const p = await rad(id);
    expect(p.minutes).toBe(120);
    expect(p.billable_minutes).toBe(60);
    expect(p.adjustment_reason).toContain('förberedelse');
  });

  it('den gamla vägens billable:false betyder fortfarande "räkna inte med den"', async () => {
    const id = await loggaTid({ work_date: '2026-09-04', minutes: 90, description: 'Internt', billable: false });
    const p = await rad(id);
    expect(p.status).toBe('ignorerad');
    expect(p.billable).toBe(false);      // synken (KRAV-7) — befintliga läsare stämmer
    expect(p.billable_minutes).toBe(0);
  });
});

describe('update_time_entry: vad som får bli vad', () => {
  it('ett förslag kan godkännas, och godkännandet får en godkännare', async () => {
    const r = await agentAct('log_time', {
      project_id: projectId, work_date: '2026-09-05', minutes: 60, description: 'Förslag att godkänna',
    });
    const id = r.body.result.id as string;
    const ok = await act('update_time_entry', { time_entry_id: id, status: 'godkand' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const p = await rad(id);
    expect(p.status).toBe('godkand');
    expect(p.approved_by).toBe(user.userId);
  });

  it("'justerad' utan orsak avvisas — en avvikelse utan skäl går inte att granska", async () => {
    const id = await loggaTid({ work_date: '2026-09-06', description: 'Att justera' });
    const utan = await act('update_time_entry', { time_entry_id: id, status: 'justerad', billable_minutes: 30 });
    expect(utan.status).toBe(400);
    expect(utan.body.error).toBe('adjustment_reason_required');

    const med = await act('update_time_entry', {
      time_entry_id: id, status: 'justerad', billable_minutes: 30,
      adjustment_reason: 'Halva tiden gick till vår egen felsökning',
    });
    expect(med.status, JSON.stringify(med.body)).toBe(200);
    const p = await rad(id);
    expect(p.status).toBe('justerad');
    expect(p.minutes).toBe(60);
    expect(p.billable_minutes).toBe(30);
  });

  it('booleanerna följer statusen i samma sats — åt båda hållen', async () => {
    const id = await loggaTid({ work_date: '2026-09-07', description: 'Att klassa om' });
    expect((await rad(id)).billable).toBe(true);

    const bort = await act('update_time_entry', {
      time_entry_id: id, status: 'ignorerad', adjustment_reason: 'Ingår i fast pris',
    });
    expect(bort.status, JSON.stringify(bort.body)).toBe(200);
    expect((await rad(id)).billable).toBe(false);

    const tillbaka = await act('update_time_entry', { time_entry_id: id, status: 'godkand' });
    expect(tillbaka.status, JSON.stringify(tillbaka.body)).toBe(200);
    const p = await rad(id);
    expect(p.billable).toBe(true);
    expect(p.invoiced).toBe(false);
  });

  it('bakåt till förslag går inte — ett godkännande tas inte tillbaka i tysthet', async () => {
    const id = await loggaTid({ work_date: '2026-09-08', description: 'Godkänd' });
    const r = await act('update_time_entry', { time_entry_id: id, status: 'forslag' });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe('invalid_status_transition');
  });

  it('ingen kan göra en post fakturerad utan en faktura', async () => {
    const id = await loggaTid({ work_date: '2026-09-09', description: 'Godkänd' });
    const r = await act('update_time_entry', { time_entry_id: id, status: 'fakturerad' });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe('invalid_status_transition');
    expect((await rad(id)).status).toBe('godkand');
  });

  it('list_time_entries visar hela livscykeln och går att filtrera', async () => {
    const alla = await act('list_time_entries', { project_id: projectId });
    expect(alla.status, JSON.stringify(alla.body)).toBe(200);
    const forsta = alla.body.result[0];
    for (const falt of ['minutes', 'billable_minutes', 'status', 'source', 'source_ref', 'invoice_id']) {
      expect(Object.hasOwn(forsta, falt), `fältet ${falt} saknas`).toBe(true);
    }
    expect(forsta.source).toBe('manuell');

    const forslag = await act('list_time_entries', { project_id: projectId, status: 'forslag' });
    expect(forslag.status).toBe(200);
    expect(forslag.body.result.length).toBeGreaterThan(0);
    expect(forslag.body.result.every((r: { status: string }) => r.status === 'forslag')).toBe(true);

    const period = await act('list_time_entries', { from: '2026-09-04', to: '2026-09-04' });
    expect(period.body.result).toHaveLength(1);
  });
});

describe('fakturaunderlaget kan inte ta samma timme två gånger', () => {
  let bilagaProjekt: string;
  let godkandId: string;
  let justeradId: string;

  async function nyFaktura(): Promise<string> {
    const r = await act('create_invoice', {
      customer_id: customerId, invoice_date: '2026-10-31', due_date: '2026-11-30',
      lines: [{ description: 'Konsulttid', quantity: 1, unit: 'h', unit_price_ore: 110_000, vat_rate: 25 }],
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    return r.body.result.id as string;
  }

  beforeAll(async () => {
    const p = await act('create_project', { name: 'Bilageprojektet', customer_id: customerId, hourly_rate_ore: 110_000 });
    expect(p.status, JSON.stringify(p.body)).toBe(200);
    bilagaProjekt = p.body.result.id;
    const logga = async (body: Record<string, unknown>): Promise<string> => {
      const r = await act('log_time', { project_id: bilagaProjekt, ...body });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      return r.body.result.id as string;
    };

    godkandId = await logga({ work_date: '2026-10-01', minutes: 180, description: 'Modellstart' });
    justeradId = await logga({
      work_date: '2026-10-02', minutes: 120, description: 'Möte',
      billable_minutes: 60, adjustment_reason: 'Halva mötet var internt',
    });
    const j = await act('update_time_entry', {
      time_entry_id: justeradId, status: 'justerad', adjustment_reason: 'Halva mötet var internt',
    });
    expect(j.status, JSON.stringify(j.body)).toBe(200);
    // Tre poster som inte får komma med, var och en av sitt eget skäl.
    await logga({ work_date: '2026-10-03', minutes: 45, description: 'Bortvald', billable: false });
    const forslag = await agentAct('log_time', {
      project_id: bilagaProjekt, work_date: '2026-10-04', minutes: 30, description: 'Ogodkänt förslag',
    });
    expect(forslag.status, JSON.stringify(forslag.body)).toBe(200);
    const nollId = await logga({
      work_date: '2026-10-05', minutes: 60, description: 'Godkänd men gratis',
      billable_minutes: 0, adjustment_reason: 'Goodwill — debiteras inte',
    });
    expect((await rad(nollId)).status).toBe('godkand');
  });

  it('bilagan tar godkänd och justerad tid — i DEBITERBARA minuter', async () => {
    const invoiceId = await nyFaktura();
    const r = await act('invoice_appendix_from_time_entries', {
      invoice_id: invoiceId, project_id: bilagaProjekt, from: '2026-10-01', to: '2026-10-31',
      title: 'Bilaga – tidsspecifikation oktober 2026',
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    // 180 (godkänd) + 60 (justerad, av 120 registrerade). Förslaget, den
    // bortvalda och nollposten är inte med.
    expect(r.body.result.rows).toHaveLength(2);
    expect(r.body.result.total_minutes).toBe(240);

    for (const id of [godkandId, justeradId]) {
      const p = await rad(id);
      expect(p.status).toBe('fakturerad');
      expect(p.invoiced).toBe(true);
      expect(p.invoice_id).toBe(invoiceId);
    }
  });

  it('samma timmar kan inte hamna på en andra faktura', async () => {
    const r = await act('invoice_appendix_from_time_entries', {
      invoice_id: await nyFaktura(), project_id: bilagaProjekt, from: '2026-10-01', to: '2026-10-31',
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('no_time_entries');
  });

  it('en fakturerad post är låst — den rättas genom kreditering, inte genom att skrivas om', async () => {
    const r = await act('update_time_entry', { time_entry_id: godkandId, minutes: 30 });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe('time_entry_locked');
    expect((await rad(godkandId)).minutes).toBe(180);

    const omklass = await act('update_time_entry', {
      time_entry_id: godkandId, status: 'ignorerad', adjustment_reason: 'Ångrade mig',
    });
    expect(omklass.status).toBe(409);
    expect(omklass.body.error).toBe('time_entry_locked');
  });
});
