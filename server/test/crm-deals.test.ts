// Story 7.1, FR-25: affärerna i ärendeplattformen ska synas i relationsdelen
// utan att redovisningen ringer ut. Hermes skickar en ögonblicksbild av de
// öppna affärerna, och den här sidan tar emot den i en cache.
//
// Risken provet täcker är tre sätt att visa fel affärer: en affär som
// dubbellagras som sanning (en ny ögonblicksbild som läggs till i stället för
// att ersätta den gamla), en gammal ögonblicksbild som visas som aktuell, och
// en cache som överlever att relationen raderas eller GDPR-raderas.
//
// Lagren: katalogen (kolumner, villkor, RLS, policyer, rättigheter och
// kommentar), HTTP genom åtgärderna med supertest och ett agent-token som
// Hermes, tabellerna som rollen app och som ägare, och de rena funktionerna
// (grinden och stilleståndet). Varje negativ kontroll är en ren funktion här i
// filen som får ett planterat fel, aldrig en planterad rad i drift.
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import pg, { type QueryResultRow } from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';
import { migrate } from '../src/db/migrate.js';
import { pool } from '../src/db/pool.js';
import { harStatusEtikett, statusChip } from '../src/http/view/html.js';
import { aheadOfClock, dealSnapshotStatus, idleDays } from '../src/lib/crmRules.js';
import { api, createCompany, createFiscalYear, registerUser, withAdmin, type TestUser } from './helpers.js';

interface Bolag { user: TestUser; id: string; agent: string }
type Lasare = <T extends QueryResultRow>(sql: string, params?: unknown[]) => Promise<{ rows: T[] }>;
interface CacheRad {
  source_ref: string; organization_id: string; organization_name: string; title: string; stage: string | null;
  value_ore: number | null; next_step: string | null; last_activity_at: string; observed_at: string;
}
/** En affär i den form Hermes skickar den. */
type Affar = {
  source_ref: string; title: string; organization: { name: string };
  stage?: string | null; value_ore?: number | null; next_step?: string | null; last_activity_at: string;
};

/** En användare med ett eget bolag och ett agent-token, som Hermes har. */
async function bolag(prefix: string): Promise<Bolag> {
  const user = await registerUser(prefix);
  const id = await createCompany(user.token, `Affärer ${prefix}`);
  const token = await api.post(`/api/companies/${id}/agent-tokens`)
    .set('Authorization', `Bearer ${user.token}`).send({ name: 'synk' });
  expect(token.status, JSON.stringify(token.body)).toBe(201);
  return { user, id, agent: token.body.token as string };
}

const act = (token: string, companyId: string, namn: string, indata: Record<string, unknown>) =>
  api.post(`/api/companies/${companyId}/actions/${namn}`).set('Authorization', `Bearer ${token}`).send(indata);

/** Skickar en ögonblicksbild som Hermes gör och kräver 200. */
async function synk(b: Bolag, observedAt: string, deals: readonly Record<string, unknown>[]) {
  const r = await act(b.agent, b.id, 'sync_crm_deals', { observed_at: observedAt, deals });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body.result;
}

/** Människan godkänner en köpost (202 med approval.id) i sitt bolag. */
async function godkann(b: Bolag, svar: { status: number; body: { approval?: { id?: string } } }) {
  expect(svar.status, JSON.stringify(svar.body)).toBe(202);
  const r = await api.post(`/api/companies/${b.id}/approvals/${svar.body.approval!.id}/approve`)
    .set('Authorization', `Bearer ${b.user.token}`).send({});
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body;
}

/** Läser som rollen app med användarens kontext; transaktionen rullas alltid tillbaka. */
async function asUser<T>(userId: string, bolagsId: string, fn: (las: Lasare) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.user_id', $1, true), set_config('app.company_id', $2, true)",
      [userId, bolagsId]);
    return await fn(<R extends QueryResultRow>(sql: string, params?: unknown[]) => client.query<R>(sql, params));
  } finally {
    try {
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  }
}

/** En ISO-tid timmarSedan bakåt, avrundad nedåt till hel sekund, i läsningens form. */
function tid(timmarSedan: number): string {
  const ms = Math.floor((Date.now() - timmarSedan * 3_600_000) / 1000) * 1000;
  return new Date(ms).toISOString().replace('.000Z', 'Z');
}

/**
 * Stilleståndet som facit, räknat här i provet: hela dygn från aktivitetens
 * UTC-datum till serverns. Servern läser sin klocka någon gång mellan `fore`
 * och `efter`, så facit räknas ur samma klocka. Byter UTC-datumet under
 * anropet är båda värdena rätt; annars är facit ett enda värde.
 */
function stillestand(aktivitet: string, fore: number, efter: number): number[] {
  const dygn = (ms: number) => Math.round((Date.parse(`${new Date(ms).toISOString().slice(0, 10)}T00:00:00Z`)
    - Date.parse(`${aktivitet.slice(0, 10)}T00:00:00Z`)) / 86_400_000);
  return [...new Set([dygn(fore), dygn(efter)])];
}

/** En affär med två dygn gammal aktivitet; det som inte anges utelämnas ur indatat. */
const affar = (ref: string, org: string, over: Partial<Affar> = {}): Affar =>
  ({ source_ref: ref, title: `Affär ${ref}`, organization: { name: org }, last_activity_at: tid(48), ...over });

const TIDSFORM = `'YYYY-MM-DD"T"HH24:MI:SS"Z"'`;

/** Bolagets cache som ägaren ser den, med relationens namn, sorterad på källnyckeln. */
async function cacheRader(companyId: string): Promise<CacheRad[]> {
  return withAdmin(async (db) => (await db.query<CacheRad>(
    `SELECT d.source_ref, d.organization_id, o.name AS organization_name, d.title, d.stage, d.value_ore, d.next_step,
       to_char(d.last_activity_at AT TIME ZONE 'UTC', ${TIDSFORM}) AS last_activity_at,
       to_char(d.observed_at AT TIME ZONE 'UTC', ${TIDSFORM}) AS observed_at
     FROM crm.deal_snapshots d
     JOIN crm.organizations o ON o.id = d.organization_id AND o.company_id = d.company_id
     WHERE d.company_id = $1 ORDER BY d.source_ref`, [companyId])).rows);
}

/** Bolagets observationsrad som ägaren ser den, eller null. */
async function observation(companyId: string): Promise<{ observed_at: string; received: number } | null> {
  return withAdmin(async (db) => (await db.query<{ observed_at: string; received: number }>(
    `SELECT to_char(observed_at AT TIME ZONE 'UTC', ${TIDSFORM}) AS observed_at, received
     FROM crm.deal_snapshot_observations WHERE company_id = $1`, [companyId])).rows[0] ?? null);
}

/** Ägaren lägger en relation direkt i tabellen, förbi åtgärderna. */
async function agarRelation(companyId: string, namn: string): Promise<string> {
  return withAdmin(async (db) => (await db.query<{ id: string }>(
    'INSERT INTO crm.organizations (company_id, name) VALUES ($1, $2) RETURNING id', [companyId, namn])).rows[0]!.id);
}

/** Ägaren lägger en cacherad direkt i tabellen, förbi åtgärderna. */
async function agarCacherad(companyId: string, sourceRef: string, organizationId: string): Promise<void> {
  await withAdmin((db) => db.query(
    `INSERT INTO crm.deal_snapshots (company_id, source_ref, organization_id, title, last_activity_at, observed_at)
     VALUES ($1, $2, $3, 'Planterad affär', now(), now())`, [companyId, sourceRef, organizationId]));
}

/** Villkoren med namn, i Postgres återgivning. De namnlösa FK:erna mot bolaget väljs bort. */
async function villkor(db: pg.Client, tabell: string, namn: readonly string[]): Promise<Record<string, string>> {
  const r = await db.query<{ conname: string; definition: string }>(
    `SELECT conname, pg_get_constraintdef(oid) AS definition FROM pg_constraint
     WHERE conrelid = $1::regclass AND conname = ANY($2::text[])`, [tabell, [...namn]]);
  return Object.fromEntries(r.rows.map((rad) => [rad.conname, rad.definition]));
}

async function rattigheter(db: pg.Client, tabell: string): Promise<Record<string, boolean>> {
  const ut: Record<string, boolean> = {};
  for (const verb of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
    ut[verb] = (await db.query<{ allowed: boolean }>(
      'SELECT has_table_privilege(\'app\', $1::text, $2::text) AS allowed', [tabell, verb])).rows[0]!.allowed;
  }
  return ut;
}

/** En cacherad byggd ur det som skickades, utan databas (för den negativa kontrollen). */
const somRad = (d: Affar, observedAt: string): CacheRad => ({
  source_ref: d.source_ref, organization_id: '00000000-0000-0000-0000-000000000000', organization_name: d.organization.name,
  title: d.title, stage: d.stage ?? null, value_ore: d.value_ore ?? null, next_step: d.next_step ?? null,
  last_activity_at: d.last_activity_at, observed_at: observedAt,
});

const JAMFORDA_FALT = ['title', 'organization_name', 'stage', 'value_ore', 'next_step', 'last_activity_at'] as const;
/**
 * En brist för varje rad i cachen som inte skickades, varje skickad rad som
 * saknas och varje fält som skiljer sig. `skickat` är de rader som inte
 * hoppades över. Rent, ingen databas.
 */
function ersattningsbrister(cache: readonly CacheRad[], skickat: readonly Affar[]): string[] {
  const brister: string[] = [];
  // Nyckeln jämförs trimmad, som mottagningen sparar den.
  const skickade = new Set(skickat.map((d) => d.source_ref.trim()));
  for (const rad of cache) {
    if (!skickade.has(rad.source_ref)) brister.push(`${rad.source_ref} ligger i cachen men skickades inte`);
  }
  for (const d of skickat) {
    const rad = cache.find((r) => r.source_ref === d.source_ref.trim());
    if (!rad) {
      brister.push(`${d.source_ref} skickades men saknas i cachen`);
      continue;
    }
    const vantat: Pick<CacheRad, typeof JAMFORDA_FALT[number]> = {
      title: d.title.trim(), organization_name: d.organization.name.trim(), stage: d.stage ?? null,
      value_ore: d.value_ore ?? null, next_step: d.next_step?.trim() || null, last_activity_at: d.last_activity_at,
    };
    for (const falt of JAMFORDA_FALT) {
      if (rad[falt] !== vantat[falt]) {
        brister.push(`${d.source_ref}.${falt} är ${JSON.stringify(rad[falt])}, skickat ${JSON.stringify(vantat[falt])}`);
      }
    }
  }
  return brister;
}

/** Varje ts-fil under server/src, med sökvägen relativt src och `/` som avgränsare. */
async function kallfiler(): Promise<Map<string, string>> {
  const dir = fileURLToPath(new URL('../src/', import.meta.url));
  const filer = new Map<string, string>();
  for (const fil of await readdir(dir, { recursive: true })) {
    if (typeof fil === 'string' && fil.endsWith('.ts')) filer.set(fil.split('\\').join('/'), await readFile(`${dir}/${fil}`, 'utf8'));
  }
  return filer;
}

const CACHENS_FILER: readonly string[] = ['services/crmDeals.ts', 'services/gdpr.ts'];
/**
 * En brist för varje fil som nämner affärscachen utan att stå på
 * tillåtelselistan, och för varje fil som nämner cachen och också
 * affärsobjektet. Rent, ingen databas.
 */
function skrivbrister(filer: ReadonlyMap<string, string>): string[] {
  const brister: string[] = [];
  for (const [fil, text] of filer) {
    if (!text.includes('crm.deal_snapshot')) continue;
    if (!CACHENS_FILER.includes(fil)) brister.push(`${fil} nämner affärscachen utan att stå på listan`);
    // Ordgräns efter «deals»: auditnamnet crm.deals_synced är ingen träff.
    if (/\bcrm\.deals\b/.test(text)) brister.push(`${fil} nämner både affärscachen och affärsobjektet`);
  }
  return brister.sort();
}

/** Skedenas svenska etiketter. Facit står här som literal, aldrig ur koden som prövas. */
const SKEDEN: Readonly<Record<string, string>> = { idea: 'Idé', dialogue: 'Dialog', proposal: 'Offert', negotiation: 'Förhandling' };

/** En brist för varje kod som saknar etikett eller visar en annan än den väntade. */
function etikettbrister(koder: readonly string[], etikettFor: Readonly<Record<string, string>>): string[] {
  const brister: string[] = [];
  for (const kod of koder) {
    const etikett = etikettFor[kod];
    // Etiketten är det sista i chippen, direkt efter glyfen: `…</span>Idé</span>`.
    if (!harStatusEtikett(kod)) {
      brister.push(`${kod} saknar svensk etikett`);
    } else if (etikett === undefined || !statusChip(kod).value.endsWith(`>${etikett}</span>`)) {
      brister.push(`${kod} visar inte etiketten «${etikett ?? '(saknas i facit)'}»`);
    }
  }
  return brister;
}

/**
 * Husets källnyckel för ett ärende (arkitekturen: `<system>:<källans id>`,
 * `linear:LOC-NNN`, valfritt suffix efter `#`). Facit står här som literal.
 */
const ARENDENYCKEL = /^linear:[A-Z][A-Z0-9]{1,9}-[0-9]{1,7}(?:#[A-Za-z0-9._-]{1,100})?$/;
/** Något som ser ut som en ärendenyckel, med eller utan systemet framför. */
const NAGON_ARENDENYCKEL = /[A-Z][A-Z0-9]{1,9}-[0-9]{1,7}/;

/**
 * En brist för varje nyckel i avsnittet som inte har husets form — exemplens
 * `"source_ref"` och varje kodformaterad ärendenyckel i texten — och för ett
 * avsnitt som inte säger formen eller inte visar någon nyckel. Mottagaren
 * jämför hela nyckeln, så ett exempel utan systemet ger samma ärende två
 * identiteter, och ett löftes gravsten spärrar då inte affären. Rent.
 */
function nyckelbrister(avsnitt: string): string[] {
  const brister: string[] = [];
  const nycklar = [
    ...[...avsnitt.matchAll(/"source_ref":\s*"([^"]*)"/g)].map((m) => m[1]!),
    ...[...avsnitt.replace(/```[\s\S]*?```/g, '').matchAll(/`([^`\n]+)`/g)].map((m) => m[1]!)
      .filter((kod) => NAGON_ARENDENYCKEL.test(kod)),
  ];
  for (const nyckel of nycklar) {
    if (!ARENDENYCKEL.test(nyckel)) brister.push(`nyckeln «${nyckel}» saknar formen linear:<id>`);
  }
  if (nycklar.length === 0) brister.push('avsnittet visar ingen ärendenyckel');
  if (!avsnitt.includes('`<system>:<id>`')) brister.push('avsnittet säger inte att nyckeln har formen `<system>:<id>`');
  return brister;
}

/** Avsnittets meningar utan kodblock: stycken och punkter för sig, sedan delade vid punkt. */
function meningar(avsnitt: string): string[] {
  return avsnitt.replace(/```[\s\S]*?```/g, '\n\n')
    .split(/\n\s*\n|\n(?=- )/)
    .flatMap((stycke) => stycke.replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s+/))
    .filter((mening) => mening.length > 0);
}

/**
 * En brist för varje fält som läsningen kan ge som `null` utan att avsnittet
 * säger det i någon mening, och för varje mening som lovar fältet «alltid»
 * utan att nämna `null`. En konsument som läser kontraktet ordagrant ska inte
 * kunna ta `null` för ett värde. Rent.
 */
function nullbrister(avsnitt: string, nullbara: readonly string[]): string[] {
  const brister: string[] = [];
  const delar = meningar(avsnitt);
  for (const falt of nullbara) {
    const om = delar.filter((mening) => mening.includes('`' + falt + '`'));
    if (!om.some((mening) => mening.includes('`null`'))) brister.push(`${falt} sägs aldrig kunna vara null`);
    for (const mening of om) {
      if (/\balltid\b/.test(mening) && !mening.includes('`null`')) brister.push(`${falt} lovas alltid: «${mening}»`);
    }
  }
  return brister;
}

/** De två dokumentens avsnitt om affärerna, vart och ett klippt vid nästa rubrik. */
async function affarsavsnitten(): Promise<[string, string][]> {
  const mcp = await readFile(new URL('../../docs/MCP_ACTIONS.md', import.meta.url), 'utf8');
  const kontrakt = await readFile(new URL('../../docs/crm/API_KONTRAKT.md', import.meta.url), 'utf8');
  return [
    ['docs/MCP_ACTIONS.md', mcp.split('## Affärscachen och kontraktet för affärer (crm 7.1)')[1]?.split('\n## ')[0] ?? ''],
    ['docs/crm/API_KONTRAKT.md', kontrakt.split('\n## Affärerna\n')[1]?.split('\n## ')[0] ?? ''],
  ];
}

describe('migrationen och skedena (7.1 M)', () => {
  let vart: Bolag;
  let granne: Bolag;
  beforeAll(async () => {
    vart = await bolag('affar-m');
    granne = await bolag('affar-m-granne');
  });

  it('M1 cachens katalog: kolumner, villkor, index, RLS, policyer, rättigheter och kommentar', async () => {
    await withAdmin(async (db) => {
      expect((await db.query(`SELECT column_name, data_type, is_nullable FROM information_schema.columns
        WHERE table_schema = 'crm' AND table_name = 'deal_snapshots' ORDER BY ordinal_position`)).rows).toEqual([
        { column_name: 'company_id', data_type: 'uuid', is_nullable: 'NO' },
        { column_name: 'source_ref', data_type: 'text', is_nullable: 'NO' },
        { column_name: 'organization_id', data_type: 'uuid', is_nullable: 'NO' },
        { column_name: 'title', data_type: 'text', is_nullable: 'NO' },
        { column_name: 'stage', data_type: 'text', is_nullable: 'YES' },
        { column_name: 'value_ore', data_type: 'bigint', is_nullable: 'YES' },
        { column_name: 'next_step', data_type: 'text', is_nullable: 'YES' },
        { column_name: 'last_activity_at', data_type: 'timestamp with time zone', is_nullable: 'NO' },
        { column_name: 'observed_at', data_type: 'timestamp with time zone', is_nullable: 'NO' },
      ]);
      expect(await villkor(db, 'crm.deal_snapshots', [
        'deal_snapshots_pkey', 'deal_snapshots_organization_fk', 'deal_snapshots_source_ref_len', 'deal_snapshots_title_len',
        'deal_snapshots_stage_ck', 'deal_snapshots_value_ck', 'deal_snapshots_next_step_len',
      ])).toEqual({
        deal_snapshots_pkey: 'PRIMARY KEY (company_id, source_ref)',
        deal_snapshots_organization_fk: 'FOREIGN KEY (organization_id, company_id) REFERENCES crm.organizations(id, company_id) ON DELETE CASCADE',
        deal_snapshots_source_ref_len: 'CHECK (((char_length(source_ref) >= 1) AND (char_length(source_ref) <= 300)))',
        deal_snapshots_title_len: 'CHECK (((char_length(title) >= 1) AND (char_length(title) <= 200)))',
        deal_snapshots_stage_ck: "CHECK ((stage = ANY (ARRAY['idea'::text, 'dialogue'::text, 'proposal'::text, 'negotiation'::text])))",
        deal_snapshots_value_ck: 'CHECK ((value_ore >= 0))',
        deal_snapshots_next_step_len: 'CHECK (((char_length(next_step) >= 1) AND (char_length(next_step) <= 200)))',
      });
      expect((await db.query(`SELECT indexdef FROM pg_indexes WHERE schemaname = 'crm'
        AND indexname = 'deal_snapshots_organization_idx'`)).rows).toEqual([
        { indexdef: 'CREATE INDEX deal_snapshots_organization_idx ON crm.deal_snapshots USING btree (company_id, organization_id)' },
      ]);
      expect((await db.query(`SELECT relrowsecurity, relforcerowsecurity FROM pg_class
        WHERE oid = 'crm.deal_snapshots'::regclass`)).rows).toEqual([{ relrowsecurity: true, relforcerowsecurity: true }]);
      expect((await db.query(`SELECT policyname, cmd, qual, with_check FROM pg_policies
        WHERE schemaname = 'crm' AND tablename = 'deal_snapshots' ORDER BY policyname`)).rows).toEqual([
        { policyname: 'deal_snapshots_delete', cmd: 'DELETE', qual: 'app_has_company_access(company_id)', with_check: null },
        { policyname: 'deal_snapshots_insert', cmd: 'INSERT', qual: null, with_check: 'app_has_company_access(company_id)' },
        { policyname: 'deal_snapshots_select', cmd: 'SELECT', qual: 'app_has_company_access(company_id)', with_check: null },
      ]);
      // Cachen skrivs om, aldrig ändras: ingen UPDATE.
      expect(await rattigheter(db, 'crm.deal_snapshots')).toEqual({ SELECT: true, INSERT: true, UPDATE: false, DELETE: true });
      expect((await db.query(`SELECT obj_description('crm.deal_snapshots'::regclass, 'pg_class') AS comment`)).rows).toEqual([{
        comment: 'Kategori: CACHE — spegel av ärendeplattformens affärsärenden, får tömmas, skrivs bara av sync_crm_deals, redigeras aldrig i vyn',
      }]);
    });
  });

  it('M2 observationsradens katalog: kolumner, villkor, RLS, policyer, rättigheter och kommentar', async () => {
    await withAdmin(async (db) => {
      expect((await db.query(`SELECT column_name, data_type, is_nullable FROM information_schema.columns
        WHERE table_schema = 'crm' AND table_name = 'deal_snapshot_observations' ORDER BY ordinal_position`)).rows).toEqual([
        { column_name: 'company_id', data_type: 'uuid', is_nullable: 'NO' },
        { column_name: 'observed_at', data_type: 'timestamp with time zone', is_nullable: 'NO' },
        { column_name: 'received', data_type: 'integer', is_nullable: 'NO' },
      ]);
      expect(await villkor(db, 'crm.deal_snapshot_observations', [
        'deal_snapshot_observations_pkey', 'deal_snapshot_observations_received_ck',
      ])).toEqual({
        deal_snapshot_observations_pkey: 'PRIMARY KEY (company_id)',
        deal_snapshot_observations_received_ck: 'CHECK (((received >= 0) AND (received <= 500)))',
      });
      expect((await db.query(`SELECT relrowsecurity, relforcerowsecurity FROM pg_class
        WHERE oid = 'crm.deal_snapshot_observations'::regclass`)).rows).toEqual([{ relrowsecurity: true, relforcerowsecurity: true }]);
      expect((await db.query(`SELECT policyname, cmd, qual, with_check FROM pg_policies
        WHERE schemaname = 'crm' AND tablename = 'deal_snapshot_observations' ORDER BY policyname`)).rows).toEqual([
        { policyname: 'deal_snapshot_observations_insert', cmd: 'INSERT', qual: null, with_check: 'app_has_company_access(company_id)' },
        { policyname: 'deal_snapshot_observations_select', cmd: 'SELECT', qual: 'app_has_company_access(company_id)', with_check: null },
        { policyname: 'deal_snapshot_observations_update', cmd: 'UPDATE', qual: 'app_has_company_access(company_id)', with_check: 'app_has_company_access(company_id)' },
      ]);
      // Raden bär inga personuppgifter och dör med bolaget: ingen DELETE.
      expect(await rattigheter(db, 'crm.deal_snapshot_observations')).toEqual({ SELECT: true, INSERT: true, UPDATE: true, DELETE: false });
      expect((await db.query(`SELECT obj_description('crm.deal_snapshot_observations'::regclass, 'pg_class') AS comment`)).rows).toEqual([{
        comment: 'Kategori: CACHE — tidpunkt och antal för bolagets senaste ögonblicksbild av affärerna, också när den var tom, får tömmas, skrivs bara av sync_crm_deals',
      }]);
    });
  });

  it('M3 migrationskedjan igen ändrar ingenting och registrerar namnet en gång', async () => {
    expect((await migrate(process.env.DATABASE_ADMIN_URL!)).applied).toEqual([]);
    expect(await withAdmin(async (db) => (await db.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM schema_migrations WHERE name = 'crm_deal_snapshots'")).rows[0]!.n)).toBe(1);
  });

  it('M4 skedena ur cachens CHECK-villkor har var sin svensk etikett', async () => {
    const rader = await withAdmin(async (db) => (await db.query<{ definition: string }>(
      `SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
       WHERE conrelid = 'crm.deal_snapshots'::regclass AND conname = 'deal_snapshots_stage_ck'`)).rows);
    expect(rader).toHaveLength(1);
    const koder = [...rader[0]!.definition.matchAll(/'([^']+)'::text/g)].map((m) => m[1]!);
    expect(koder).toEqual(['idea', 'dialogue', 'proposal', 'negotiation']);
    expect(etikettbrister(koder, SKEDEN)).toEqual([]);
  });

  it('M5 negativ kontroll: en planterad kod utan etikett och en kod med fel etikett fälls', () => {
    const planterad = { ...SKEDEN, proposal: 'Förhandling', won: 'Vunnen' };
    expect(etikettbrister(['idea', 'dialogue', 'proposal', 'negotiation', 'won'], planterad)).toEqual([
      'proposal visar inte etiketten «Förhandling»',
      'won saknar svensk etikett',
    ]);
  });

  it('M6 en raderad relation tar sina cacherader med sig, en annan relations står kvar', async () => {
    const raderas = await agarRelation(vart.id, 'Kaskad Raderas AB');
    const stannar = await agarRelation(vart.id, 'Kaskad Stannar AB');
    await agarCacherad(vart.id, 'm6-1', raderas);
    await agarCacherad(vart.id, 'm6-2', stannar);
    await withAdmin((db) => db.query('DELETE FROM crm.organizations WHERE company_id = $1 AND id = $2', [vart.id, raderas]));
    expect((await cacheRader(vart.id)).filter((r) => r.source_ref.startsWith('m6-'))
      .map((r) => [r.source_ref, r.organization_id])).toEqual([['m6-2', stannar]]);
  });

  it('M7 som app: bolagets användare ser raderna, grannen med vårt bolag i kontexten ser inga, och cachen går inte att ändra', async () => {
    const org = await agarRelation(vart.id, 'Rls Relation AB');
    await agarCacherad(vart.id, 'm7-1', org);
    await withAdmin((db) => db.query(
      `INSERT INTO crm.deal_snapshot_observations (company_id, observed_at, received) VALUES ($1, now(), 1)
       ON CONFLICT (company_id) DO UPDATE SET observed_at = EXCLUDED.observed_at, received = EXCLUDED.received`, [vart.id]));
    const rakna = async (las: Lasare) => (await las<{ cache: number; obs: number }>(`SELECT
      (SELECT count(*)::int FROM crm.deal_snapshots WHERE company_id = $1 AND source_ref = 'm7-1') AS cache,
      (SELECT count(*)::int FROM crm.deal_snapshot_observations WHERE company_id = $1) AS obs`, [vart.id])).rows[0];
    expect(await asUser(vart.user.userId, vart.id, rakna)).toEqual({ cache: 1, obs: 1 });
    expect(await asUser(granne.user.userId, vart.id, rakna)).toEqual({ cache: 0, obs: 0 });
    await expect(asUser(vart.user.userId, vart.id, (las) => las(
      "UPDATE crm.deal_snapshots SET title = 'Ändrad' WHERE company_id = $1", [vart.id]))).rejects.toThrow(/permission denied/);
    expect((await cacheRader(vart.id)).find((r) => r.source_ref === 'm7-1')?.title).toBe('Planterad affär');
  });
});

describe('ögonblicksbilden ersätter cachen (7.1 S)', () => {
  let vart: Bolag;
  let regler: Bolag;
  let revision: Bolag;
  let tyst: Bolag;
  let granne: Bolag;
  let framtid: Bolag;
  let kant: Bolag;
  beforeAll(async () => {
    vart = await bolag('affar-s');
    regler = await bolag('affar-s-regler');
    revision = await bolag('affar-s-audit');
    tyst = await bolag('affar-s-tyst');
    granne = await bolag('affar-s-granne');
    framtid = await bolag('affar-s-framtid');
    kant = await bolag('affar-s-kant');
  });
  // Mängd A och mängd B: A2 ändras, A4 är ny, A1 och A3 försvinner.
  const A: Affar[] = [
    affar('s1-a1', 'Ersätt Ett AB', { stage: 'idea', value_ore: 100_000, next_step: 'Ring kunden' }),
    affar('s1-a2', 'Ersätt Två AB', { stage: 'dialogue', value_ore: 250_000 }),
    affar('s1-a3', 'Ersätt Ett AB', { stage: 'proposal' }),
  ];
  const B: Affar[] = [
    affar('s1-a2', 'Ersätt Två AB', { stage: 'negotiation', value_ore: 300_000, next_step: 'Skicka avtalet', last_activity_at: tid(24) }),
    // Över 2^31 ören: beloppet får aldrig kapas på vägen.
    affar('s1-a4', 'Ersätt Tre AB', { title: 'Ny affär', value_ore: 5_000_000_000 }),
  ];

  it('S1 en ny mängd ersätter cachen exakt, fält för fält', async () => {
    expect(await synk(vart, tid(5), A)).toMatchObject({ received: 3, cached: 3, skipped: [] });
    const obs = tid(1);
    expect(await synk(vart, obs, B)).toMatchObject({ observed_at: obs, received: 2, cached: 2, skipped: [] });
    const cache = await cacheRader(vart.id);
    expect(ersattningsbrister(cache, B)).toEqual([]);
    expect(cache.map(({ organization_id: _id, ...rad }) => rad)).toEqual([
      {
        source_ref: 's1-a2', organization_name: 'Ersätt Två AB', title: 'Affär s1-a2', stage: 'negotiation',
        value_ore: 300_000, next_step: 'Skicka avtalet', last_activity_at: B[0]!.last_activity_at, observed_at: obs,
      },
      {
        source_ref: 's1-a4', organization_name: 'Ersätt Tre AB', title: 'Ny affär', stage: null,
        value_ore: 5_000_000_000, next_step: null, last_activity_at: B[1]!.last_activity_at, observed_at: obs,
      },
    ]);
    expect(await observation(vart.id)).toEqual({ observed_at: obs, received: 2 });
  });

  it('S2 negativ kontroll: en ögonblicksbild som lagts till i stället för att ersätta fälls', () => {
    const obs = tid(1);
    // A ∪ B, som en synk utan radering hade lämnat cachen.
    const union = [...A.filter((d) => !B.some((n) => n.source_ref === d.source_ref)), ...B]
      .map((d) => somRad(d, obs)).sort((x, y) => (x.source_ref < y.source_ref ? -1 : 1));
    expect(ersattningsbrister(union, B)).toEqual([
      's1-a1 ligger i cachen men skickades inte',
      's1-a3 ligger i cachen men skickades inte',
    ]);
    expect(ersattningsbrister(B.map((d) => somRad(d, obs)), B)).toEqual([]);
  });

  it('S3 en tom mängd tömmer cachen och sparar ändå tidpunkten', async () => {
    await synk(vart, tid(3), [affar('s3-1', 'Tömning AB')]);
    expect((await cacheRader(vart.id)).map((r) => r.source_ref)).toEqual(['s3-1']);
    const obs = tid(1);
    expect(await synk(vart, obs, [])).toEqual({
      observed_at: obs, received: 0, cached: 0, organizations_created: 0, organizations_linked: 0,
      unlinked_organizations: [], redirected_organizations: [], merge_proposals: [], skipped: [],
    });
    expect(await cacheRader(vart.id)).toEqual([]);
    expect(await observation(vart.id)).toEqual({ observed_at: obs, received: 0 });
  });

  it('S4 ogiltigt indata ger 400 och lämnar cachen och observationsraden orörda', async () => {
    const giltig = affar('s4-1', 'Ogiltig Kontroll AB');
    await synk(vart, tid(2), [giltig]);
    const fore = { cache: await cacheRader(vart.id), obs: await observation(vart.id) };
    expect(fore.cache.map((r) => r.source_ref)).toEqual(['s4-1']);
    const fall: [string, Record<string, unknown>][] = [
      ['501 rader', { observed_at: tid(1), deals: Array.from({ length: 501 }, (_, i) => affar(`s4-m${i}`, 'Många AB')) }],
      ['okänd nyckel på affären', { observed_at: tid(1), deals: [{ ...giltig, probability: 50 }] }],
      ['okänd nyckel på toppnivån', { observed_at: tid(1), deals: [giltig], source_system: 'linear' }],
      ['titel på 201 tecken', { observed_at: tid(1), deals: [{ ...giltig, title: 'x'.repeat(201) }] }],
      ['negativt värde', { observed_at: tid(1), deals: [{ ...giltig, value_ore: -1 }] }],
      ['okänt skede', { observed_at: tid(1), deals: [{ ...giltig, stage: 'won' }] }],
      ['tidpunkt utan zon', { observed_at: '2026-11-22T08:00:00', deals: [giltig] }],
      ['saknad senaste aktivitet', {
        observed_at: tid(1), deals: [{ source_ref: 's4-x', title: 'Utan aktivitet', organization: { name: 'Ogiltig Kontroll AB' } }],
      }],
    ];
    for (const [namn, indata] of fall) {
      const r = await act(vart.agent, vart.id, 'sync_crm_deals', indata);
      expect(r.status, `${namn}: ${JSON.stringify(r.body)}`).toBe(400);
      expect(r.body.error, namn).toBe('validation_error');
    }
    expect(await cacheRader(vart.id)).toEqual(fore.cache);
    expect(await observation(vart.id)).toEqual(fore.obs);
  });

  it('S5 en trasig rad stoppar inte resten och redovisas med index och skäl', async () => {
    const r = await synk(regler, tid(1), [
      affar('s5-0', 'Giltig Först AB'),
      affar('s5-1', 'LOC-123'),
      affar('s5-0', 'Dubblett AB'),
      affar('s5-3', 'Blank Titel AB', { title: '   ' }),
      affar('s5-4', 'Giltig Sist AB'),
    ]);
    expect(r).toMatchObject({ received: 5, cached: 2, organizations_created: 2 });
    expect(r.skipped).toEqual([
      { index: 1, reason: '«LOC-123» är en projektkod, inte ett organisationsnamn — skriv bolagets namn.' },
      { index: 2, reason: 'dubblett av rad 0 i ögonblicksbilden' },
      { index: 3, reason: 'affären saknar titel' },
    ]);
    expect((await cacheRader(regler.id)).map((x) => [x.source_ref, x.organization_name]))
      .toEqual([['s5-0', 'Giltig Först AB'], ['s5-4', 'Giltig Sist AB']]);
    for (const namn of ['LOC-123', 'Dubblett AB', 'Blank Titel AB']) {
      expect(await withAdmin(async (db) => (await db.query<{ n: number }>(
        'SELECT count(*)::int AS n FROM crm.organizations WHERE company_id = $1 AND lower(name) = lower($2)',
        [regler.id, namn])).rows[0]!.n), namn).toBe(0);
    }
  });

  it('S6 organisationen kopplas till kunden med samma namn, och en okänd redovisas som okopplad', async () => {
    const kund = await api.post(`/api/companies/${regler.id}/customers`)
      .set('Authorization', `Bearer ${regler.user.token}`).send({ name: 'Kopplad Kund AB' });
    expect(kund.status, JSON.stringify(kund.body)).toBe(201);
    const r = await synk(regler, tid(1), [affar('s6-1', 'Kopplad Kund AB'), affar('s6-2', 'Okopplad AB')]);
    expect(r).toMatchObject({
      received: 2, cached: 2, organizations_created: 2, organizations_linked: 1,
      unlinked_organizations: ['Okopplad AB'], skipped: [],
    });
    expect(await withAdmin(async (db) => (await db.query<{ customer_id: string | null }>(
      "SELECT customer_id FROM crm.organizations WHERE company_id = $1 AND name = 'Kopplad Kund AB'", [regler.id])).rows))
      .toEqual([{ customer_id: kund.body.customer.id }]);
  });

  it('S7 audit: åtgärden i bokföringens logg, en rad per ögonblicksbild i relationsloggen, bara antal', async () => {
    await synk(revision, tid(2), [affar('s7-1', 'Hemlig Revisionsbyrå AB', {
      title: 'Hemlig titel Zeta', next_step: 'Hemligt nästa steg Omega',
    })]);
    await synk(revision, tid(1), []);
    const rader = await withAdmin(async (db) => (await db.query<{ details: Record<string, unknown> }>(
      "SELECT details FROM crm.audit_log WHERE company_id = $1 AND action = 'crm.deals_synced' ORDER BY id", [revision.id])).rows);
    expect(rader.map((r) => r.details)).toEqual([
      { received: 1, cached: 1, organizations_created: 1, linked: 0, unlinked: 1, redirected: 0, skipped: 0, merge_proposals: 0 },
      { received: 0, cached: 0, organizations_created: 0, linked: 0, unlinked: 0, redirected: 0, skipped: 0, merge_proposals: 0 },
    ]);
    for (const rad of rader) {
      expect(Object.keys(rad.details).sort()).toEqual(
        ['cached', 'linked', 'merge_proposals', 'organizations_created', 'received', 'redirected', 'skipped', 'unlinked']);
    }
    const helaLoggen = JSON.stringify(await withAdmin(async (db) => (await db.query(
      'SELECT action, entity_type, entity_id, details FROM crm.audit_log WHERE company_id = $1', [revision.id])).rows));
    for (const planterat of ['Hemlig titel Zeta', 'Hemligt nästa steg Omega', 'Hemlig Revisionsbyrå', 's7-1']) {
      expect(helaLoggen, planterat).not.toContain(planterat);
    }
    const karnan = await withAdmin(async (db) => (await db.query<{ action: string; n: number }>(
      `SELECT action, count(*)::int AS n FROM audit_log WHERE company_id = $1
       AND (entity_id = 'sync_crm_deals' OR action LIKE 'crm.%') GROUP BY action ORDER BY action`, [revision.id])).rows);
    expect(karnan).toEqual([{ action: 'action.executed', n: 2 }]);
  });

  it('S8 grannens ögonblicksbild rör inte vår cache, och grannens token mot vårt bolag ger 404', async () => {
    await synk(vart, tid(2), [affar('s8-1', 'Isolerad AB')]);
    const fore = { cache: await cacheRader(vart.id), obs: await observation(vart.id) };
    expect(fore.cache.map((r) => r.source_ref)).toEqual(['s8-1']);
    expect(await synk(granne, tid(1), [affar('s8-g1', 'Grannens Affär AB')])).toMatchObject({ cached: 1 });
    expect(await cacheRader(vart.id)).toEqual(fore.cache);
    expect((await cacheRader(granne.id)).map((r) => r.source_ref)).toEqual(['s8-g1']);
    const intrang = await act(granne.agent, vart.id, 'sync_crm_deals', { observed_at: tid(1), deals: [] });
    expect(intrang.status, JSON.stringify(intrang.body)).toBe(404);
    expect(await cacheRader(vart.id)).toEqual(fore.cache);
    expect(await observation(vart.id)).toEqual(fore.obs);
  });

  it('S9 en tidpunkt fram i tiden: ögonblicksbilden avvisas hel, en affär hoppas över, och klockmarginalen släpps igenom', async () => {
    await synk(framtid, tid(2), [affar('s9-1', 'Framtid Kontroll AB')]);
    const fore = { cache: await cacheRader(framtid.id), obs: await observation(framtid.id) };
    expect(fore.cache.map((r) => r.source_ref)).toEqual(['s9-1']);
    // En ögonblicksbild från framtiden hade räknats som aktuell långt efter att
    // nattjobbet slutat gå. Den avvisas före varje skrivning.
    for (const [namn, observedAt] of [['en timme fram', tid(-1)], ['en vecka fram', tid(-168)]] as const) {
      const r = await act(framtid.agent, framtid.id, 'sync_crm_deals', { observed_at: observedAt, deals: [affar('s9-2', 'Framtid AB')] });
      expect(r.status, `${namn}: ${JSON.stringify(r.body)}`).toBe(400);
      expect(r.body.error, namn).toBe('observed_at_in_future');
    }
    expect(await cacheRader(framtid.id)).toEqual(fore.cache);
    expect(await observation(framtid.id)).toEqual(fore.obs);
    // En affär vars senaste aktivitet ligger fram i tiden hade dolt sitt stillestånd.
    const r = await synk(framtid, tid(1), [
      affar('s9-3', 'Framtid AB', { last_activity_at: tid(-1) }),
      affar('s9-4', 'Framtid AB', { last_activity_at: tid(-24 * 365) }),
      affar('s9-5', 'Framtid AB'),
    ]);
    expect(r).toMatchObject({ received: 3, cached: 1 });
    expect(r.skipped).toEqual([0, 1].map((index) => ({ index, reason: 'affärens senaste aktivitet ligger i framtiden' })));
    expect((await cacheRader(framtid.id)).map((x) => x.source_ref)).toEqual(['s9-5']);
    // En minut fram ryms i klockmarginalen, för båda tidpunkterna.
    const nara = tid(-1 / 60);
    expect(await synk(framtid, nara, [affar('s9-6', 'Framtid AB', { last_activity_at: nara })]))
      .toMatchObject({ observed_at: nara, cached: 1, skipped: [] });
    expect(await observation(framtid.id)).toEqual({ observed_at: nara, received: 1 });
  });

  it('S10 nyckeln och texten trimmas: en tom nyckel hoppas över och en kantad nyckel är samma nyckel', async () => {
    const r = await synk(kant, tid(1), [
      affar(' s10-1 ', '  Kantad Relation AB  ', { title: '  Kantad titel  ', next_step: '  Ring tillbaka  ' }),
      affar('s10-1', 'Kantad Relation AB', { title: 'Samma nyckel utan kant' }),
      affar('   ', 'Kantad Relation AB', { title: 'Utan nyckel' }),
      affar('\ts10-2\n', 'Kantad Relation AB', { title: 'Andra affären', next_step: '   ' }),
    ]);
    expect(r).toMatchObject({ received: 4, cached: 2, organizations_created: 1, unlinked_organizations: ['Kantad Relation AB'] });
    expect(r.skipped).toEqual([
      { index: 1, reason: 'dubblett av rad 0 i ögonblicksbilden' },
      { index: 2, reason: 'affären saknar källnyckel' },
    ]);
    expect((await cacheRader(kant.id)).map(({ source_ref, organization_name, title, next_step }) =>
      ({ source_ref, organization_name, title, next_step }))).toEqual([
      { source_ref: 's10-1', organization_name: 'Kantad Relation AB', title: 'Kantad titel', next_step: 'Ring tillbaka' },
      { source_ref: 's10-2', organization_name: 'Kantad Relation AB', title: 'Andra affären', next_step: null },
    ]);
    // Nästa ögonblicksbild med nyckeln utan kant ersätter samma rad, ingen andra.
    expect(await synk(kant, tid(0), [affar('s10-1', 'Kantad Relation AB', { title: 'Ny titel' })]))
      .toMatchObject({ cached: 1, skipped: [] });
    expect((await cacheRader(kant.id)).map((x) => [x.source_ref, x.title])).toEqual([['s10-1', 'Ny titel']]);
  });

  it('O0 utan ögonblicksbild är läget okänt, och en okänd nyckel ger 400', async () => {
    const r = await act(tyst.user.token, tyst.id, 'crm_open_deals', {});
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.result).toStrictEqual({ status: 'unknown', observed_at: null, received: null, deals: [] });
    const fel = await act(tyst.user.token, tyst.id, 'crm_open_deals', { since: '2026-11-01' });
    expect(fel.status, JSON.stringify(fel.body)).toBe(400);
    expect(fel.body.error).toBe('validation_error');
  });
});

describe('samma regler som intaget (7.1 V)', () => {
  let v: Bolag;
  beforeAll(async () => { v = await bolag('affar-v'); });
  const skal = (namn: string) => `bolagsformsvariant av ${namn} — väntar på ditt beslut i Att göra`;
  /** Människans relation, genom åtgärden som i vyn. */
  async function relation(namn: string): Promise<string> {
    const r = await act(v.user.token, v.id, 'upsert_crm_organization', { name: namn });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    return r.body.result.id as string;
  }
  type Kopost = { id: string; status: string; input: { organization_id: string; name: string } };
  const koposter = (orgId: string, namn: string) => withAdmin(async (db) => (await db.query<Kopost>(
    `SELECT id, status, input FROM action_approvals WHERE company_id = $1 AND action = 'merge_crm_name_variant'
     AND input->>'organization_id' = $2 AND lower(input->>'name') = lower($3) ORDER BY created_at, id`,
    [v.id, orgId, namn])).rows);
  const relationer = (namn: string) => withAdmin(async (db) => (await db.query<{ n: number }>(
    'SELECT count(*)::int AS n FROM crm.organizations WHERE company_id = $1 AND lower(name) = lower($2)',
    [v.id, namn])).rows[0]!.n);

  it('V1 en bolagsformsvariant hoppas över med intagets skäl och köar ett förslag, ingen ny relation', async () => {
    const org = await relation('Variant Konsult AB');
    const r = await synk(v, tid(1), [affar('v1-1', 'Variant Konsult')]);
    expect(r.skipped).toEqual([{ index: 0, reason: skal('Variant Konsult AB') }]);
    expect(r.merge_proposals).toEqual(['Variant Konsult → Variant Konsult AB (bolagsform)']);
    expect(r).toMatchObject({ cached: 0, organizations_created: 0 });
    expect(await relationer('Variant Konsult')).toBe(0);
    const q = await koposter(org, 'Variant Konsult');
    expect(q).toHaveLength(1);
    expect(q[0]).toMatchObject({ status: 'pending', input: { organization_id: org, name: 'Variant Konsult' } });
    expect(await withAdmin(async (db) => (await db.query(
      "SELECT details FROM audit_log WHERE company_id = $1 AND entity_id = $2 AND action = 'action.approval_requested'",
      [v.id, q[0]!.id])).rows)).toEqual([{ details: { action: 'merge_crm_name_variant', actor: 'agent', reason: 'bolagsform' } }]);
  });

  it('V2 samma variant två gånger och i nästa ögonblicksbild ger fortfarande ett förslag för paret', async () => {
    const org = await relation('Andra Varianten AB');
    const forsta = await synk(v, tid(2), [affar('v2-1', 'Andra Varianten'), affar('v2-2', 'Andra Varianten')]);
    expect(forsta.skipped).toEqual([0, 1].map((index) => ({ index, reason: skal('Andra Varianten AB') })));
    expect(forsta.merge_proposals).toEqual(['Andra Varianten → Andra Varianten AB (bolagsform)']);
    const andra = await synk(v, tid(1), [affar('v2-1', 'Andra Varianten')]);
    expect(andra.merge_proposals).toEqual(['Andra Varianten → Andra Varianten AB (bolagsform)']);
    expect(await koposter(org, 'Andra Varianten')).toHaveLength(1);
  });

  it('V3 intaget återanvänder förslaget som ögonblicksbilden köade', async () => {
    const org = await relation('Tredje Varianten AB');
    await synk(v, tid(1), [affar('v3-1', 'Tredje Varianten')]);
    const q = await koposter(org, 'Tredje Varianten');
    expect(q).toHaveLength(1);
    const ing = await act(v.agent, v.id, 'ingest_crm_events', { events: [{
      kind: 'interaction', organization: { name: 'Tredje Varianten' }, occurred_at: tid(1),
      channel: 'email', direction: 'inbound', summary: 'Ett mail om affären.', source_system: 'gmail', source_ref: 'v3-mail',
    }] });
    expect(ing.status, JSON.stringify(ing.body)).toBe(200);
    expect(ing.body.result.skipped).toEqual([{ index: 0, reason: skal('Tredje Varianten AB') }]);
    expect(ing.body.result.merge_proposals).toEqual(['Tredje Varianten → Tredje Varianten AB (bolagsform)']);
    expect((await koposter(org, 'Tredje Varianten')).map((k) => k.id)).toEqual([q[0]!.id]);
  });

  it('V4 en variant av två relationer redovisas som flera möjliga, utan relation eller köpost', async () => {
    // Ägaren lägger raderna direkt, som intagets motsvarande fall: en handskapad
    // variant kan avvisas av åtgärden när Story 2.5 byggts.
    await agarRelation(v.id, 'Dubbel AB');
    await agarRelation(v.id, 'Dubbel Oy');
    const r = await synk(v, tid(1), [affar('v4-1', 'Dubbel')]);
    expect(r.skipped).toEqual([{ index: 0, reason: 'bolagsformsvariant av flera relationer — slå ihop dem först' }]);
    expect(r.merge_proposals).toEqual(['Dubbel (flera möjliga)']);
    expect(r).toMatchObject({ cached: 0, organizations_created: 0 });
    expect(await relationer('Dubbel')).toBe(0);
    expect(await withAdmin(async (db) => (await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM action_approvals WHERE company_id = $1 AND action = 'merge_crm_name_variant'
       AND lower(input->>'name') = 'dubbel'`, [v.id])).rows[0]!.n)).toBe(0);
  });

  it('V5 ett namn efter en sammanslagning landar på den kvarvarande relationen och redovisas', async () => {
    const gammal = await relation('Gammal Kund AB');
    const ny = await relation('Ny Kund AB');
    await godkann(v, await act(v.user.token, v.id, 'merge_crm_organizations', { keep_id: ny, merge_id: gammal }));
    const r = await synk(v, tid(1), [affar('v5-1', 'Gammal Kund AB')]);
    expect(r.redirected_organizations).toEqual(['Gammal Kund AB → Ny Kund AB']);
    expect(r).toMatchObject({ cached: 1, organizations_created: 0, skipped: [] });
    expect((await cacheRader(v.id)).map((x) => [x.source_ref, x.organization_id, x.organization_name]))
      .toEqual([['v5-1', ny, 'Ny Kund AB']]);
  });
});

describe('grinden och stilleståndet (7.1 P)', () => {
  const NU = '2026-11-22T12:00:00.000Z';
  it('P1 utan tidpunkt, eller med en som inte går att läsa, är läget okänt', () => {
    expect(dealSnapshotStatus(null, 3, NU)).toBe('unknown');
    expect(dealSnapshotStatus('inte en tidpunkt', 3, NU)).toBe('unknown');
  });
  it('P2 exakt 26 timmar gammal är fortfarande aktuell', () => {
    expect(dealSnapshotStatus('2026-11-21T10:00:00Z', 3, NU)).toBe('ok');
  });
  it('P3 26 timmar och en sekund gammal är okänd', () => {
    expect(dealSnapshotStatus('2026-11-21T09:59:59Z', 3, NU)).toBe('unknown');
  });
  it('P4 en färsk tom ögonblicksbild är tom', () => {
    expect(dealSnapshotStatus('2026-11-22T11:00:00Z', 0, NU)).toBe('empty');
  });
  it('P5 en gammal tom ögonblicksbild är okänd, aldrig tom', () => {
    expect(dealSnapshotStatus('2026-11-21T09:00:00Z', 0, NU)).toBe('unknown');
  });
  it('P6 stilleståndet räknas i hela kalenderdygn i UTC och aldrig under noll', () => {
    expect(idleDays('2026-11-12T12:00:00Z', NU)).toBe(10);
    expect(idleDays('2026-11-22T00:00:01Z', NU)).toBe(0);
    expect(idleDays('2026-11-23T12:00:00Z', NU)).toBe(0);
    expect(idleDays('2026-11-21T23:59:59Z', '2026-11-22T00:00:01Z')).toBe(1);
    expect(idleDays('inte ett datum', NU)).toBe(0);
  });
  it('P7 en tidpunkt längre fram än klockmarginalen är okänd, aldrig aktuell och aldrig tom', () => {
    // Fem minuter är marginalen för två klockor som inte går exakt lika.
    expect(aheadOfClock('2026-11-22T12:05:00Z', NU)).toBe(false);
    expect(aheadOfClock('2026-11-22T12:05:01Z', NU)).toBe(true);
    expect(aheadOfClock('inte en tidpunkt', NU)).toBe(false);
    expect(dealSnapshotStatus('2026-11-22T12:05:00Z', 3, NU)).toBe('ok');
    expect(dealSnapshotStatus('2026-11-22T12:05:01Z', 3, NU)).toBe('unknown');
    expect(dealSnapshotStatus('2026-11-29T12:00:00Z', 3, NU)).toBe('unknown');
    expect(dealSnapshotStatus('2026-11-29T12:00:00Z', 0, NU)).toBe('unknown');
  });
});

describe('crm_open_deals (7.1 O)', () => {
  let o: Bolag;
  let granne: Bolag;
  beforeAll(async () => {
    o = await bolag('affar-o');
    granne = await bolag('affar-o-granne');
  });
  async function las(b: Bolag) {
    const r = await act(b.user.token, b.id, 'crm_open_deals', {});
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    return r.body.result;
  }
  const relationsId = (namn: string) => withAdmin(async (db) => (await db.query<{ id: string }>(
    'SELECT id FROM crm.organizations WHERE company_id = $1 AND name = $2', [o.id, namn])).rows[0]!.id);

  it('O1 OK: affärerna med relationen, fälten och stilleståndet, längst stillestånd först', async () => {
    const obs = tid(1);
    const tioDygn = tid(240);
    const treDygn = tid(72);
    await synk(o, obs, [
      affar('o1-b', 'Läsning Två AB', { last_activity_at: treDygn }),
      affar('o1-a', 'Läsning Ett AB', { stage: 'proposal', value_ore: 1_250_000, next_step: 'Boka mötet', last_activity_at: tioDygn }),
    ]);
    const ettId = await relationsId('Läsning Ett AB');
    const tvaId = await relationsId('Läsning Två AB');
    const fore = Date.now();
    const svar = await las(o);
    const efter = Date.now();
    expect(svar).toStrictEqual({
      status: 'ok', observed_at: obs, received: 2,
      deals: [
        {
          source_ref: 'o1-a', title: 'Affär o1-a', organization_id: ettId,
          organization_name: 'Läsning Ett AB', stage: 'proposal', value_ore: 1_250_000, next_step: 'Boka mötet',
          last_activity_at: tioDygn, idle_days: expect.any(Number),
        },
        {
          source_ref: 'o1-b', title: 'Affär o1-b', organization_id: tvaId,
          organization_name: 'Läsning Två AB', stage: null, value_ore: null, next_step: null,
          last_activity_at: treDygn, idle_days: expect.any(Number),
        },
      ],
    });
    // 10 och 3 när UTC-datumet står still under provet; facit räknas ur samma
    // klocka som servern, så fallet håller också över midnatt.
    expect(stillestand(tioDygn, fore, efter)).toContain(svar.deals[0].idle_days);
    expect(stillestand(treDygn, fore, efter)).toContain(svar.deals[1].idle_days);
    expect(stillestand(tioDygn, Date.parse(tioDygn) + 240 * 3_600_000, Date.parse(tioDygn) + 240 * 3_600_000)).toEqual([10]);
  });

  it('O2 TOMT: Hermes skickade en tom mängd', async () => {
    const obs = tid(1);
    await synk(o, obs, []);
    expect(await las(o)).toStrictEqual({ status: 'empty', observed_at: obs, received: 0, deals: [] });
  });

  it('O3 OKÄNT: en ögonblicksbild som är 27 timmar gammal bär tidpunkten men inga affärer', async () => {
    const obs = tid(27);
    await synk(o, obs, [affar('o3-1', 'Gammal Läsning AB')]);
    expect(await las(o)).toStrictEqual({ status: 'unknown', observed_at: obs, received: 1, deals: [] });
  });

  it('O4 OK: en ögonblicksbild som är 25 timmar gammal visas', async () => {
    const obs = tid(25);
    await synk(o, obs, [affar('o4-1', 'Nästan Gammal AB')]);
    const r = await las(o);
    expect(r).toMatchObject({ status: 'ok', observed_at: obs, received: 1 });
    expect(r.deals.map((d: { source_ref: string }) => d.source_ref)).toEqual(['o4-1']);
  });

  it('O5 OK, aldrig TOMT: en ögonblicksbild där varje rad hoppades över', async () => {
    const obs = tid(1);
    expect(await synk(o, obs, [affar('o5-1', 'ABC-123')])).toMatchObject({ received: 1, cached: 0 });
    expect(await las(o)).toStrictEqual({ status: 'ok', observed_at: obs, received: 1, deals: [] });
  });

  it('O6 grannbolaget ser inte våra affärer och når inte vårt bolag', async () => {
    await synk(o, tid(1), [affar('o6-1', 'Bara Vår AB')]);
    expect((await cacheRader(o.id)).map((r) => r.source_ref)).toEqual(['o6-1']);
    expect(await las(granne)).toStrictEqual({ status: 'unknown', observed_at: null, received: null, deals: [] });
    const intrang = await act(granne.user.token, o.id, 'crm_open_deals', {});
    expect(intrang.status, JSON.stringify(intrang.body)).toBe(404);
  });

  it('O7 OK: en ögonblicksbild en minut fram ryms i klockmarginalen och läses som aktuell', async () => {
    const obs = tid(-1 / 60);
    await synk(o, obs, [affar('o7-1', 'Klockmarginal AB')]);
    const r = await las(o);
    expect(r).toMatchObject({ status: 'ok', observed_at: obs, received: 1 });
    expect(r.deals.map((d: { source_ref: string }) => d.source_ref)).toEqual(['o7-1']);
  });
});

describe('radering och affärsobjektet (7.1 G/E)', () => {
  let g: Bolag;
  let gs: Bolag;
  beforeAll(async () => {
    g = await bolag('affar-g');
    gs = await bolag('affar-g-gravsten');
  });
  const organisationsId = (namn: string) => withAdmin(async (db) => (await db.query<{ id: string }>(
    'SELECT id FROM crm.organizations WHERE company_id = $1 AND name = $2', [g.id, namn])).rows[0]!.id);

  it('G1 en GDPR-raderad kunds cacherader försvinner, en annan relations står kvar, och relationen arkiveras', async () => {
    const kund = await api.post(`/api/companies/${g.id}/customers`)
      .set('Authorization', `Bearer ${g.user.token}`).send({ name: 'Raderas AB' });
    expect(kund.status, JSON.stringify(kund.body)).toBe(201);
    const r = await synk(g, tid(1), [
      affar('g1-1', 'Raderas AB', { title: 'Avtalet med Raderas', next_step: 'Ring Raderas' }),
      affar('g1-2', 'Stannar AB'),
    ]);
    expect(r).toMatchObject({ cached: 2, organizations_linked: 1 });
    const raderas = await organisationsId('Raderas AB');
    await godkann(g, await act(g.user.token, g.id, 'anonymize_party', { party_type: 'customer', party_id: kund.body.customer.id }));
    expect((await cacheRader(g.id)).map((x) => x.source_ref)).toEqual(['g1-2']);
    expect(await withAdmin(async (db) => (await db.query<{ status: string }>(
      'SELECT status FROM crm.organizations WHERE company_id = $1 AND id = $2', [g.id, raderas])).rows)).toEqual([{ status: 'archived' }]);
  });

  it('G2 en sammanslagning tar förlorarens cacherader med sig och läsningen står kvar', async () => {
    await synk(g, tid(2), [affar('g2-1', 'Behålls AB'), affar('g2-2', 'Försvinner AB')]);
    const behalls = await organisationsId('Behålls AB');
    const forsvinner = await organisationsId('Försvinner AB');
    await godkann(g, await act(g.user.token, g.id, 'merge_crm_organizations', { keep_id: behalls, merge_id: forsvinner }));
    expect((await cacheRader(g.id)).map((x) => [x.source_ref, x.organization_id])).toEqual([['g2-1', behalls]]);
    const r = await act(g.user.token, g.id, 'crm_open_deals', {});
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.result).toMatchObject({ status: 'ok', received: 2 });
    expect(r.body.result.deals.map((d: { source_ref: string }) => d.source_ref)).toEqual(['g2-1']);
  });

  it('G3 en GDPR-raderad kunds affärer kommer inte tillbaka med nästa ögonblicksbild, med eller utan behållen identitet', async () => {
    // FR-43 och API-kontraktets regel 4: samma källnyckel avvisas, en ny släpps igenom.
    const SKAL = 'källan är raderad enligt GDPR och får inte återskapas';
    const auth = { Authorization: `Bearer ${gs.user.token}` };
    const kund = async (namn: string) => {
      const r = await api.post(`/api/companies/${gs.id}/customers`).set(auth).send({ name: namn });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      return r.body.customer.id as string;
    };
    const relationer = (namn: string) => withAdmin(async (db) => (await db.query<{ status: string }>(
      'SELECT status FROM crm.organizations WHERE company_id = $1 AND lower(name) = lower($2)', [gs.id, namn])).rows);
    // Kunden utan bokförd affär förlorar namnet; kunden med en bokförd faktura
    // behåller det (bokföringslagen), och då träffar namnet samma relation igen.
    const raderad = await kund('Gravsten Raderad AB');
    const behallen = await kund('Gravsten Behållen AB');
    const ar = await createFiscalYear(gs.id, auth, { label: '2025', start_date: '2025-01-01', end_date: '2025-12-31' });
    const faktura = await api.post(`/api/companies/${gs.id}/invoices`).set(auth).send({
      customer_id: behallen, invoice_date: '2025-03-01',
      lines: [{ description: 'Tjänst', quantity: 1, unit_price_ore: 100000, vat_rate: 25 }],
    });
    expect(faktura.status, JSON.stringify(faktura.body)).toBe(201);
    const bokford = await api.post(`/api/companies/${gs.id}/invoices/${faktura.body.invoice.id}/book`)
      .set(auth).send({ fiscal_year_id: ar.id });
    expect(bokford.status, JSON.stringify(bokford.body)).toBe(200);

    const natten = [
      affar('g3-r1', 'Gravsten Raderad AB', { title: 'Avtalet med Gravsten', next_step: 'Ring Gravsten' }),
      affar('g3-r2', 'Gravsten Raderad AB'),
      affar('g3-b1', 'Gravsten Behållen AB'),
      affar('g3-k1', 'Gravsten Kontroll AB'),
    ];
    expect(await synk(gs, tid(3), natten)).toMatchObject({ cached: 4, organizations_linked: 2, skipped: [] });
    for (const [id, behalls] of [[raderad, false], [behallen, true]] as const) {
      const svar = await godkann(gs, await act(gs.user.token, gs.id, 'anonymize_party', { party_type: 'customer', party_id: id }));
      expect(svar.result.accounting_identity_retained, id).toBe(behalls);
    }
    expect((await cacheRader(gs.id)).map((x) => x.source_ref)).toEqual(['g3-k1']);
    // Gravstenarna bär bara källnycklarna för de raderade kundernas affärer.
    const gravstenar = () => withAdmin(async (db) => (await db.query(
      'SELECT source_system, source_ref FROM crm.erased_sources WHERE company_id = $1 ORDER BY source_ref', [gs.id])).rows);
    const vantade = ['g3-b1', 'g3-r1', 'g3-r2'].map((ref) => ({ source_system: 'linear', source_ref: ref }));
    expect(await gravstenar()).toEqual(vantade);
    const antal = async () => withAdmin(async (db) => (await db.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM crm.organizations WHERE company_id = $1', [gs.id])).rows[0]!.n);
    const relationerFore = await antal();

    // Nästa natt skickar Hermes samma ärenden igen, ett av dem med blanktecken runt nyckeln.
    const omsandning = await act(gs.agent, gs.id, 'sync_crm_deals', {
      observed_at: tid(1), deals: [natten[0], { ...natten[1]!, source_ref: '  g3-r2 ' }, natten[2], natten[3]],
    });
    expect(omsandning.status, JSON.stringify(omsandning.body)).toBe(200);
    expect(omsandning.body.result).toMatchObject({ received: 4, cached: 1, organizations_created: 0 });
    expect(omsandning.body.result.skipped).toEqual([0, 1, 2].map((index) => ({ index, reason: SKAL })));
    // Den interna felkoden lämnar inte tjänsten, som i intagets svar.
    expect(JSON.stringify(omsandning.body)).not.toContain('erased_source');
    expect((await cacheRader(gs.id)).map((x) => x.source_ref)).toEqual(['g3-k1']);
    expect(await antal()).toBe(relationerFore);
    expect(await relationer('Gravsten Raderad AB')).toEqual([]);
    expect(await relationer('Gravsten Behållen AB')).toEqual([{ status: 'archived' }]);
    expect(await gravstenar()).toEqual(vantade);

    // En ny källnyckel är ny behandling med ny grund och släpps igenom.
    expect(await synk(gs, tid(0), [affar('g3-b2', 'Gravsten Behållen AB'), affar('g3-k1', 'Gravsten Kontroll AB')]))
      .toMatchObject({ received: 2, cached: 2, skipped: [] });
    expect((await cacheRader(gs.id)).map((x) => x.source_ref)).toEqual(['g3-b2', 'g3-k1']);
  });

  it('G4 ett löftes gravsten spärrar affären med samma källnyckel: ett ärende har en identitet', async () => {
    // Arkitekturen: källnyckeln är `<system>:<källans id>` i händelserna och i
    // affärerna, och källidentiteten är paret (source_system, source_ref).
    // Samma ärende ger därför en gravsten, inte två, och den spärrar affären.
    const SKAL = 'källan är raderad enligt GDPR och får inte återskapas';
    const gl = await bolag('affar-g-lofte');
    const kund = await api.post(`/api/companies/${gl.id}/customers`)
      .set('Authorization', `Bearer ${gl.user.token}`).send({ name: 'Löftesgrav AB' });
    expect(kund.status, JSON.stringify(kund.body)).toBe(201);
    const intag = await act(gl.agent, gl.id, 'ingest_crm_events', {
      events: [{
        kind: 'commitment', organization: { name: 'Löftesgrav AB' }, commitment_direction: 'we_owe',
        body: 'Skicka offerten för piloten.', occurred_at: tid(30), source_system: 'linear', source_ref: 'linear:LOC-7201',
      }],
    });
    expect(intag.status, JSON.stringify(intag.body)).toBe(200);
    expect(intag.body.result).toMatchObject({ commitments_created: 1, skipped: [] });
    await godkann(gl, await act(gl.user.token, gl.id, 'anonymize_party', { party_type: 'customer', party_id: kund.body.customer.id }));
    const gravstenar = () => withAdmin(async (db) => (await db.query(
      'SELECT source_system, source_ref FROM crm.erased_sources WHERE company_id = $1 ORDER BY source_ref', [gl.id])).rows);
    expect(await gravstenar()).toEqual([{ source_system: 'linear', source_ref: 'linear:LOC-7201' }]);

    // Hermes skickar ärendet som affär, under en annan organisation, och ett nytt ärende.
    const r = await synk(gl, tid(1), [
      affar('linear:LOC-7201', 'Spärrad Ägare AB'),
      affar('linear:LOC-7202', 'Släppt Ägare AB'),
    ]);
    expect(r).toMatchObject({ received: 2, cached: 1, organizations_created: 1, skipped: [{ index: 0, reason: SKAL }] });
    expect((await cacheRader(gl.id)).map((x) => [x.source_ref, x.organization_name]))
      .toEqual([['linear:LOC-7202', 'Släppt Ägare AB']]);
    expect(await withAdmin(async (db) => (await db.query(
      "SELECT 1 FROM crm.organizations WHERE company_id = $1 AND name = 'Spärrad Ägare AB'", [gl.id])).rows)).toEqual([]);
    // Ingen andra identitet för ärendet: fortfarande en gravsten.
    expect(await gravstenar()).toEqual([{ source_system: 'linear', source_ref: 'linear:LOC-7201' }]);
  });

  it('E1 bara två filer under server/src nämner cachen, ingen av dem affärsobjektet, och affärsobjektet står tomt', async () => {
    const filer = await kallfiler();
    expect(filer.has('services/crmDeals.ts')).toBe(true);
    const namner = [...filer].filter(([, text]) => text.includes('crm.deal_snapshot')).map(([fil]) => fil).sort();
    expect(namner).toEqual(['services/crmDeals.ts', 'services/gdpr.ts']);
    for (const fil of namner) expect(filer.get(fil)!, fil).not.toMatch(/\bcrm\.deals\b/);
    expect(skrivbrister(filer)).toEqual([]);
    expect(await withAdmin(async (db) => (await db.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM crm.deals')).rows[0]!.n)).toBe(0);
  });

  it('E2 negativ kontroll: en tredje skrivare och en tjänstefil som skriver affärsobjektet fälls', () => {
    expect(skrivbrister(new Map([
      ['services/annan.ts', "await client.query('DELETE FROM crm.deal_snapshots WHERE company_id = $1', [companyId]);"],
    ]))).toEqual(['services/annan.ts nämner affärscachen utan att stå på listan']);
    expect(skrivbrister(new Map([
      ['services/crmDeals.ts', "INSERT INTO crm.deal_snapshots (company_id) VALUES ($1); UPDATE crm.deals SET stage = 'won';"],
    ]))).toEqual(['services/crmDeals.ts nämner både affärscachen och affärsobjektet']);
    // Auditnamnet är ingen träff: bokstaven efter «deals» är ett ordtecken.
    expect(skrivbrister(new Map([
      ['services/crmDeals.ts', "INSERT INTO crm.deal_snapshots (company_id) VALUES ($1); action: 'crm.deals_synced'"],
    ]))).toEqual([]);
  });
});

describe('dokumenten (7.1 D)', () => {
  it('D1 åtgärdsdokumentet beskriver båda åtgärderna i ett eget avsnitt efter crm 4.3', async () => {
    const doc = await readFile(new URL('../../docs/MCP_ACTIONS.md', import.meta.url), 'utf8');
    const rubrik = '## Affärscachen och kontraktet för affärer (crm 7.1)';
    expect(doc.split(rubrik)).toHaveLength(2);
    const foregaende = doc.indexOf('## Personperspektivet i tråden (crm 4.3)');
    expect(foregaende).toBeGreaterThan(-1);
    expect(doc.indexOf(rubrik)).toBeGreaterThan(foregaende);
    const avsnitt = doc.split(rubrik)[1]!.split('\n## ')[0]!;
    expect(avsnitt).not.toMatch(/^###/m);
    for (const term of [
      'sync_crm_deals', 'crm_open_deals', 'observed_at', 'deals', 'source_ref', 'last_activity_at', 'received', 'cached',
      'skipped', 'merge_proposals', 'unlinked_organizations', 'redirected_organizations', 'idle_days',
      'crm.deal_snapshots', 'crm.deal_snapshot_observations', 'crm.erased_sources', 'observed_at_in_future',
    ]) expect(avsnitt, term).toContain('`' + term + '`');
    expect(avsnitt).toContain('fem minuter');
    // Beslut #24: affärerna bor i ärendeplattformen, som ersatt Linear.
    expect(avsnitt).not.toMatch(/\bLinear\b/);
    expect(avsnitt).toContain('ärendeplattformen');
    // Nyckeln har husets form, så händelserna och affärerna delar identitet.
    expect(nyckelbrister(avsnitt)).toEqual([]);
  });

  it('D2 API-kontraktet har avsnittet Affärerna före Gallring, och de befintliga rubrikerna står en gång var', async () => {
    const kontrakt = await readFile(new URL('../../docs/crm/API_KONTRAKT.md', import.meta.url), 'utf8');
    expect(kontrakt.match(/^## Affärerna$/gm)).toHaveLength(1);
    const gallring = kontrakt.indexOf('\n## Gallring\n');
    expect(gallring).toBeGreaterThan(-1);
    expect(kontrakt.indexOf('\n## Affärerna\n')).toBeLessThan(gallring);
    const avsnitt = kontrakt.split('\n## Affärerna\n')[1]!.split('\n## ')[0]!;
    expect(avsnitt).not.toMatch(/^###/m);
    for (const term of [
      'sync_crm_deals', 'crm_open_deals', 'observed_at', 'source_ref', 'last_activity_at', 'skipped', 'merge_proposals',
      'unlinked_organizations', 'crm.deals', 'observed_at_in_future',
    ]) expect(avsnitt, term).toContain('`' + term + '`');
    expect(avsnitt).toContain('26 timmar');
    // Regel 4 gäller också affärerna, och klockmarginalen står i klartext.
    expect(avsnitt).toContain('raderad enligt GDPR');
    expect(avsnitt).toContain('fem minuter');
    // Beslut #24: affärerna bor i ärendeplattformen, som ersatt Linear.
    expect(avsnitt).not.toMatch(/\bLinear\b/);
    expect(avsnitt).toContain('ärendeplattformen');
    // Exemplet och texten visar nyckeln i husets form, som intagets exempel.
    expect(nyckelbrister(avsnitt)).toEqual([]);
    for (const heading of ['De fyra reglerna', 'Svaret', 'Människan vinner', 'Kadens, dubbletter och sökning']) {
      expect(kontrakt.match(new RegExp('^## ' + heading + '$', 'gm')), heading).toHaveLength(1);
    }
  });

  it('D3 båda dokumenten säger när läsningens fält är null, och fälten är de som läsningen faktiskt ger som null', async () => {
    // Facit som literal: fälten som crm_open_deals kan ge som null.
    const NULLBARA = ['next_step', 'observed_at', 'received', 'stage', 'value_ore'];
    const d = await bolag('affar-d');
    const nullfalt = (o: Record<string, unknown>) => Object.keys(o).filter((k) => o[k] === null);
    const tom = await act(d.user.token, d.id, 'crm_open_deals', {});
    expect(tom.status, JSON.stringify(tom.body)).toBe(200);
    // Svaret på ögonblicksbilden har inga null-fält.
    expect(nullfalt(await synk(d, tid(1), [affar('linear:LOC-7301', 'Nullfält AB')]))).toEqual([]);
    const las = await act(d.user.token, d.id, 'crm_open_deals', {});
    expect(las.status, JSON.stringify(las.body)).toBe(200);
    expect(las.body.result).toMatchObject({ status: 'ok', received: 1 });
    expect(las.body.result.deals).toHaveLength(1);
    const verkliga = [...new Set([
      ...nullfalt(tom.body.result), ...nullfalt(las.body.result), ...nullfalt(las.body.result.deals[0]),
    ])].sort();
    expect(verkliga).toEqual(NULLBARA);
    for (const [fil, avsnitt] of await affarsavsnitten()) {
      expect(avsnitt.length, fil).toBeGreaterThan(0);
      expect(nullbrister(avsnitt, NULLBARA), fil).toEqual([]);
    }
  });

  it('D4 negativ kontroll: en nyckel utan systemet och ett null som lovas alltid finnas fälls', () => {
    // Ett exempel utan systemet, en kodformaterad nyckel utan systemet och ingen form i texten.
    expect(nyckelbrister('```jsonc\n{ "source_ref": "LOC-412" }\n```\n\nNyckeln är `LOC-413`.')).toEqual([
      'nyckeln «LOC-412» saknar formen linear:<id>',
      'nyckeln «LOC-413» saknar formen linear:<id>',
      'avsnittet säger inte att nyckeln har formen `<system>:<id>`',
    ]);
    expect(nyckelbrister('Nyckeln är ärendets.')).toEqual([
      'avsnittet visar ingen ärendenyckel',
      'avsnittet säger inte att nyckeln har formen `<system>:<id>`',
    ]);
    expect(nyckelbrister('```jsonc\n{ "source_ref": "linear:LOC-412" }\n```\n\nFormen är `<system>:<id>`, som `linear:LOC-413#2`.'))
      .toEqual([]);
    // Granskarens exempel: «alltid `observed_at`», och ett fält som aldrig sägs vara null.
    expect(nullbrister(
      'Läsningen är `crm_open_deals`, med ett av tre utfall och alltid\n`observed_at`.\n\n`received` är antalet Hermes skickade.',
      ['observed_at', 'received'],
    )).toEqual([
      'observed_at sägs aldrig kunna vara null',
      'observed_at lovas alltid: «Läsningen är `crm_open_deals`, med ett av tre utfall och alltid `observed_at`.»',
      'received sägs aldrig kunna vara null',
    ]);
    // Ett fält som sägs vara null i en mening men lovas alltid i en annan fälls också.
    expect(nullbrister('- `ok` — `stage` finns alltid.\n- `stage` är `null` när skedet saknas.', ['stage']))
      .toEqual(['stage lovas alltid: «- `ok` — `stage` finns alltid.»']);
    expect(nullbrister('`observed_at` och `received` är `null` när ingen ögonblicksbild har kommit.', ['observed_at', 'received']))
      .toEqual([]);
  });
});
