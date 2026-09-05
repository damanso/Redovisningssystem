// Uppdragsytan våg 1 (migration 0068): de sju modultabellernas form.
//
// Rättigheterna prövas åt BÅDA hållen. Ett prov som bara kontrollerar att
// rättigheten finns kan inte se att en rättighet som INTE ska finnas har smugit
// sig in — och hela poängen med uppdrag_bedomning och
// uppdrag_leverabel_handelse är att app-rollen saknar UPDATE och DELETE.
import { beforeAll, describe, expect, it } from 'vitest';
import { api, createCompany, createFiscalYear, registerUser, withAdmin, type TestUser } from './helpers.js';
import { withTenantTransaction } from '../src/db/tx.js';

const TABELLER = [
  'uppdrag_leverabel', 'uppdrag_leverabel_handelse', 'uppdrag_bedomning',
  'uppdrag_scopelinje', 'uppdrag_scopesignal', 'uppdrag_referens', 'uppdrag_svepvarde',
] as const;

// 1E §3.4, ordagrant: bara det som behövs, per tabell.
const RATTIGHETER: Record<string, string[]> = {
  uppdrag_leverabel: ['SELECT', 'INSERT', 'UPDATE'],
  uppdrag_leverabel_handelse: ['SELECT', 'INSERT'],
  uppdrag_bedomning: ['SELECT', 'INSERT'],
  uppdrag_scopelinje: ['SELECT', 'INSERT', 'UPDATE'],
  uppdrag_scopesignal: ['SELECT', 'INSERT', 'UPDATE'],
  uppdrag_referens: ['SELECT', 'INSERT', 'UPDATE'],
  uppdrag_svepvarde: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
};
const ALLA_RATTIGHETER = ['SELECT', 'INSERT', 'UPDATE', 'DELETE'];

let userA: TestUser;
let userB: TestUser;
let companyA = '';
let companyB = '';
let avtalA = '';
let leverabelA = '';

const auth = (u: TestUser) => ({ Authorization: `Bearer ${u.token}` });

async function ok(u: TestUser, company: string, namn: string, kropp: Record<string, unknown>) {
  const res = await api.post(`/api/companies/${company}/actions/${namn}`).set(auth(u)).send(kropp);
  expect(res.status, `${namn}: ${JSON.stringify(res.body)}`).toBe(200);
  return res.body.result as Record<string, unknown>;
}

beforeAll(async () => {
  userA = await registerUser('uppdrag-a');
  companyA = await createCompany(userA.token, 'Locollabs AB');
  await createFiscalYear(companyA, auth(userA), { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });
  const projekt = (await ok(userA, companyA, 'create_project', { name: 'ILT' })).id as string;
  avtalA = (await ok(userA, companyA, 'create_contract', {
    project_id: projekt, name: 'ILT ramavtal', signed_date: '2026-01-01',
  })).id as string;
  leverabelA = await withAdmin(async (c) => (await c.query<{ id: string }>(
    "INSERT INTO uppdrag_leverabel (company_id, contract_id, kod, uppfoljningsmatt, matt_lasvag) " +
    "VALUES ($1, $2, 'L1', 'Antal levererade rapporter', 'redovisning') RETURNING id",
    [companyA, avtalA],
  )).rows[0]!.id);

  userB = await registerUser('uppdrag-b');
  companyB = await createCompany(userB.token, 'Grannbolaget AB');
});

describe('de sju tabellerna finns med husets form', () => {
  it('varje tabell har id, company_id NOT NULL och created_at', async () => {
    const rader = await withAdmin(async (c) => (await c.query<{
      table_name: string; column_name: string; is_nullable: string;
    }>(
      `SELECT table_name::text, column_name::text, is_nullable::text FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name::text = ANY($1::text[])
          AND column_name::text IN ('id', 'company_id', 'contract_id', 'created_at')
        ORDER BY table_name, column_name`,
      [TABELLER],
    )).rows);
    for (const tabell of TABELLER) {
      const egna = rader.filter((r) => r.table_name === tabell);
      expect(egna.map((r) => r.column_name), tabell)
        .toEqual(['company_id', 'contract_id', 'created_at', 'id']);
      expect(egna.find((r) => r.column_name === 'company_id')!.is_nullable, tabell).toBe('NO');
      expect(egna.find((r) => r.column_name === 'contract_id')!.is_nullable, tabell).toBe('NO');
    }
  });

  it('contract_id bär company_id in i den främmande nyckeln (mönstret från 0064)', async () => {
    const fk = await withAdmin(async (c) => (await c.query<{ conrelid: string; def: string }>(
      `SELECT conrelid::regclass::text AS conrelid, pg_get_constraintdef(oid) AS def
         FROM pg_constraint
        WHERE contype = 'f' AND conrelid::regclass::text = ANY($1::text[])
          AND pg_get_constraintdef(oid) LIKE '%REFERENCES contracts(id, company_id)%'`,
      [TABELLER],
    )).rows);
    expect(fk.map((r) => r.conrelid).sort()).toEqual([...TABELLER].sort());
  });

  it('uppdrag_leverabel har ingen status_sedan-kolumn — historiken bor i händelsetabellen', async () => {
    const res = await withAdmin((c) => c.query(
      `SELECT 1 FROM information_schema.columns
        WHERE table_name = 'uppdrag_leverabel' AND column_name = 'status_sedan'`,
    ));
    expect(res.rowCount).toBe(0);
  });

  it('de två unika nycklarna finns: svepvärdets upsertnyckel och referensens', async () => {
    const svep = await withAdmin((c) => c.query(
      "INSERT INTO uppdrag_svepvarde (company_id, contract_id, nyckel, varde) VALUES ($1, $2, 'timmar', '3'::jsonb)",
      [companyA, avtalA],
    ));
    expect(svep.rowCount).toBe(1);
    await expect(withAdmin((c) => c.query(
      "INSERT INTO uppdrag_svepvarde (company_id, contract_id, nyckel, varde) VALUES ($1, $2, 'timmar', '4'::jsonb)",
      [companyA, avtalA],
    ))).rejects.toThrow(/uppdrag_svepvarde_uk/);

    await withAdmin((c) => c.query(
      "INSERT INTO uppdrag_referens (company_id, contract_id, sort, extern_id) VALUES ($1, $2, 'drive', 'fil-1')",
      [companyA, avtalA],
    ));
    await expect(withAdmin((c) => c.query(
      "INSERT INTO uppdrag_referens (company_id, contract_id, sort, extern_id) VALUES ($1, $2, 'drive', 'fil-1')",
      [companyA, avtalA],
    ))).rejects.toThrow(/uppdrag_referens_uk/);
  });

  it('leverabelns kod är unik per avtal', async () => {
    await expect(withAdmin((c) => c.query(
      "INSERT INTO uppdrag_leverabel (company_id, contract_id, kod) VALUES ($1, $2, 'L1')",
      [companyA, avtalA],
    ))).rejects.toThrow(/uppdrag_leverabel_kod_uk/);
  });

  it('CHECK-villkoren låser värdemängderna', async () => {
    await expect(withAdmin((c) => c.query(
      "INSERT INTO uppdrag_leverabel (company_id, contract_id, kod, matt_lasvag) VALUES ($1, $2, 'L9', 'gissning')",
      [companyA, avtalA],
    ))).rejects.toThrow(/matt_lasvag/);
    await expect(withAdmin((c) => c.query(
      "INSERT INTO uppdrag_bedomning (company_id, contract_id, period_start, period_slut, lage, satt_av_manniska)" +
      " VALUES ($1, $2, DATE '2026-01-01', DATE '2026-01-31', 'kanske', true)",
      [companyA, avtalA],
    ))).rejects.toThrow(/lage/);
    await expect(withAdmin((c) => c.query(
      "INSERT INTO uppdrag_referens (company_id, contract_id, sort, extern_id, ko_status)" +
      " VALUES ($1, $2, 'mejl', 'm-1', 'nagot')",
      [companyA, avtalA],
    ))).rejects.toThrow(/ko_status/);
  });
});

describe('RLS och rättigheter', () => {
  it('varje tabell har RLS på och policyer som går genom app_has_company_access', async () => {
    const tabeller = await withAdmin(async (c) => (await c.query<{ relname: string; relrowsecurity: boolean }>(
      `SELECT relname::text, relrowsecurity FROM pg_class WHERE relkind = 'r' AND relname::text = ANY($1::text[])`,
      [TABELLER],
    )).rows);
    for (const t of tabeller) expect(t.relrowsecurity, t.relname).toBe(true);

    const policyer = await withAdmin(async (c) => (await c.query<{ tablename: string; cmd: string; uttryck: string }>(
      `SELECT tablename::text, cmd::text, coalesce(qual, with_check) AS uttryck FROM pg_policies
        WHERE schemaname = 'public' AND tablename::text = ANY($1::text[])`,
      [TABELLER],
    )).rows);
    for (const p of policyer) {
      expect(p.uttryck, `${p.tablename}/${p.cmd}`).toContain('app_has_company_access');
    }
    // Policyerna speglar rättigheterna: ingen UPDATE-policy där app saknar UPDATE.
    for (const tabell of TABELLER) {
      const cmds = policyer.filter((p) => p.tablename === tabell).map((p) => p.cmd).sort();
      expect(cmds, tabell).toEqual([...RATTIGHETER[tabell]!].sort());
    }
  });

  it('app-rollen har exakt de rättigheter 1E §3.4 räknar upp — och inga fler', async () => {
    for (const tabell of TABELLER) {
      for (const ratt of ALLA_RATTIGHETER) {
        const har = await withAdmin(async (c) => (await c.query<{ h: boolean }>(
          'SELECT has_table_privilege($1::text, $2::text, $3::text) AS h', ['app', tabell, ratt],
        )).rows[0]!.h);
        expect(har, `${tabell}: ${ratt}`).toBe(RATTIGHETER[tabell]!.includes(ratt));
      }
    }
  });

  it('append-only i praktiken: app kan skriva en händelse men aldrig ändra den', async () => {
    const id = await withTenantTransaction(userA.userId, companyA, async (client) => {
      const skrivet = await client.query<{ id: string }>(
        "INSERT INTO uppdrag_leverabel_handelse (company_id, contract_id, leverabel_id, fran, till)" +
        " VALUES ($1, $2, $3, 'ej_paborjad', 'pagar') RETURNING id",
        [companyA, avtalA, leverabelA],
      );
      expect(skrivet.rowCount).toBe(1);
      return skrivet.rows[0]!.id;
    });

    // Egen transaktion: ett avvisat UPDATE aborterar den, och då hade en
    // efterföljande läsning i samma transaktion inte gått att göra.
    await expect(withTenantTransaction(userA.userId, companyA, (client) => client.query(
      "UPDATE uppdrag_leverabel_handelse SET till = 'godkand' WHERE id = $1", [id],
    ))).rejects.toThrow(/permission denied/);
    await expect(withTenantTransaction(userA.userId, companyA, (client) => client.query(
      'DELETE FROM uppdrag_leverabel_handelse WHERE id = $1', [id],
    ))).rejects.toThrow(/permission denied/);

    const kvar = await withTenantTransaction(userA.userId, companyA, async (client) =>
      (await client.query('SELECT till FROM uppdrag_leverabel_handelse WHERE id = $1', [id])).rows[0]);
    expect(kvar).toEqual({ till: 'pagar' });
  });

  it('grannbolaget ser ingenting och kan inte skriva in i vårt bolag', async () => {
    const egna = await withTenantTransaction(userA.userId, companyA, async (client) =>
      (await client.query('SELECT id FROM uppdrag_leverabel')).rowCount);
    expect(egna).toBe(1);

    const grannens = await withTenantTransaction(userB.userId, companyB, async (client) =>
      (await client.query('SELECT id FROM uppdrag_leverabel')).rowCount);
    expect(grannens).toBe(0);

    await expect(withTenantTransaction(userB.userId, companyB, (client) => client.query(
      "INSERT INTO uppdrag_leverabel (company_id, contract_id, kod) VALUES ($1, $2, 'STULEN')",
      [companyA, avtalA],
    ))).rejects.toThrow(/row-level security/);
  });
});
