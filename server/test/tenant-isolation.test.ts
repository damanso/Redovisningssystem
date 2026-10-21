// Acceptanskriterium (KICKOFF §4, Fas 0): "ett automatiskt test där användare B
// försöker läsa användare A:s data via A:s company_id returnerar 403/404,
// aldrig 200". Detta var exakt det som var trasigt i den gamla koden — B kunde
// läsa A:s fakturor, kunder och omsättning med HTTP 200.
import jwt from 'jsonwebtoken';
import { beforeAll, describe, expect, it } from 'vitest';
import { assertAppRoleEnforcesRls, pool } from '../src/db/pool.js';
import { api, createCompany, registerUser, type TestUser, withAdmin } from './helpers.js';

let userA: TestUser;
let userB: TestUser;
let companyA: string;
let companyB: string;

beforeAll(async () => {
  userA = await registerUser('anna');
  userB = await registerUser('bjorn');
  companyA = await createCompany(userA.token, 'Annas Bolag AB');
  companyB = await createCompany(userB.token, 'Björns Bolag AB');
});

describe('lager 1: HTTP-förtroendegränsen', () => {
  it('A kan läsa sitt eget bolag (sanity)', async () => {
    const res = await api
      .get(`/api/companies/${companyA}`)
      .set('Authorization', `Bearer ${userA.token}`);
    expect(res.status).toBe(200);
    expect(res.body.company.name).toBe('Annas Bolag AB');
  });

  it('B som läser A:s bolag får 404 — aldrig 200', async () => {
    const res = await api
      .get(`/api/companies/${companyA}`)
      .set('Authorization', `Bearer ${userB.token}`);
    expect(res.status).toBe(404);
    expect(res.body).not.toHaveProperty('company');
  });

  it('B som uppdaterar A:s bolag får 404', async () => {
    const res = await api
      .patch(`/api/companies/${companyA}`)
      .set('Authorization', `Bearer ${userB.token}`)
      .send({ name: 'Kapat AB' });
    expect(res.status).toBe(404);

    const check = await api
      .get(`/api/companies/${companyA}`)
      .set('Authorization', `Bearer ${userA.token}`);
    expect(check.body.company.name).toBe('Annas Bolag AB');
  });

  it('B som läser A:s revisionslogg får 404', async () => {
    const res = await api
      .get(`/api/companies/${companyA}/audit`)
      .set('Authorization', `Bearer ${userB.token}`);
    expect(res.status).toBe(404);
    expect(res.body).not.toHaveProperty('entries');
  });

  it('B som laddar upp fil till A:s bolag får 404', async () => {
    const res = await api
      .post(`/api/companies/${companyA}/files`)
      .set('Authorization', `Bearer ${userB.token}`)
      .attach('file', Buffer.from('%PDF-1.4 test'), 'test.pdf');
    expect(res.status).toBe(404);
  });

  it('B:s bolagslista innehåller inte A:s bolag', async () => {
    const res = await api.get('/api/companies').set('Authorization', `Bearer ${userB.token}`);
    expect(res.status).toBe(200);
    const ids = res.body.companies.map((c: { id: string }) => c.id);
    expect(ids).toContain(companyB);
    expect(ids).not.toContain(companyA);
  });

  it('utan token: 401', async () => {
    const res = await api.get(`/api/companies/${companyA}`);
    expect(res.status).toBe(401);
  });

  it("token signerad med gamla fallback-hemligheten 'your-secret' avvisas", async () => {
    // Regression mot den gamla autentiserings-bypassen: vem som helst kunde
    // signera en egen token eftersom JWT-hemligheten föll tillbaka på 'your-secret'.
    const forged = jwt.sign({}, 'your-secret', { subject: userA.userId, expiresIn: '1h' });
    const res = await api
      .get(`/api/companies/${companyA}`)
      .set('Authorization', `Bearer ${forged}`);
    expect(res.status).toBe(401);
  });
});

describe('lager 2: RLS i Postgres (simulerar att app-koden glömt medlemskapskollen)', () => {
  it('forcerad app.company_id utan medlemskap ger 0 rader', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // B:s identitet men A:s bolag i kontexten — som om en bugg satt fel bolag.
      await client.query(
        "SELECT set_config('app.user_id', $1, true), set_config('app.company_id', $2, true)",
        [userB.userId, companyA],
      );
      const companies = await client.query('SELECT * FROM companies WHERE id = $1', [companyA]);
      expect(companies.rowCount).toBe(0);
      const audit = await client.query('SELECT * FROM audit_log WHERE company_id = $1', [
        companyA,
      ]);
      expect(audit.rowCount).toBe(0);
      const files = await client.query('SELECT * FROM files WHERE company_id = $1', [companyA]);
      expect(files.rowCount).toBe(0);
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  it('forcerad INSERT i A:s bolag avvisas av RLS-policyn', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        "SELECT set_config('app.user_id', $1, true), set_config('app.company_id', $2, true)",
        [userB.userId, companyA],
      );
      await expect(
        client.query(
          `INSERT INTO files (company_id, original_name, stored_name, mime_type, size_bytes, sha256, uploaded_by)
           VALUES ($1, 'x.pdf', '00000000-0000-4000-8000-000000000000.pdf', 'application/pdf', 1, 'x', $2)`,
          [companyA, userB.userId],
        ),
      ).rejects.toThrow(/row-level security/);
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  it('helt utan kontext: SELECT på companies ger 0 rader', async () => {
    const result = await pool.query('SELECT * FROM companies');
    expect(result.rowCount).toBe(0);
  });
});

// FR-26 (Story 5.4): varje bolagsrutt går genom requireCompanyAccess, som är
// registrerad före alla rutter under /:companyId i
// server/src/http/routes/companies.ts. Blocket prövar varje monteringspunkt
// där för läsning och skrivning. A:s eget anrop är kontrollen att rutten
// finns: appens fångstrutt svarar 404 för varje okänd adress, så en 404 utan
// kontroll bevisar ingenting.
describe('5.4 varje bolagsrutt kräver medlemskap', () => {
  let userC: TestUser;
  let userD: TestUser;
  let companyC: string;
  let companyD: string;

  const bearer = (u: TestUser): Record<string, string> => ({ Authorization: `Bearer ${u.token}` });

  // Läsrutterna R1–R7, med monteringspunkten i companies.ts.
  const reads = [
    { id: 'R1', path: '/accounting/accounts' }, // rad 223
    { id: 'R2', path: '/accounting/fiscal-years' }, // rad 223
    { id: 'R3', path: '/invoices' }, // rad 224
    { id: 'R4', path: '/receipts' }, // rad 225
    { id: 'R5', path: '/actions' }, // rad 226
    { id: 'R6', path: '/approvals' }, // rad 226
    { id: 'R7', path: '/customers' }, // rad 227
  ];

  // Skrivrutterna W1–W6. En tom kropp får ge 400 för A; det som prövas är att
  // B aldrig når hanteraren och att A:s rutt finns.
  const writes = [
    {
      id: 'W1',
      path: '/accounting/fiscal-years', // rad 223
      body: { label: '2025', start_date: '2025-01-01', end_date: '2025-12-31' },
    },
    { id: 'W2', path: '/invoices', body: {} }, // rad 224
    { id: 'W3', path: '/receipts', body: {} }, // rad 225
    { id: 'W4', path: '/actions/create_customer', body: { name: 'Kapad AB' } }, // rad 226
    { id: 'W5', path: '/customers', body: { name: 'Kapad AB' } }, // rad 227
    { id: 'W6', path: '/agent-tokens', body: {} }, // rad 200
  ];

  beforeAll(async () => {
    userC = await registerUser('cora');
    userD = await registerUser('dan');
    companyC = await createCompany(userC.token, 'Coras Bolag AB');
    // Dan är ägare till ett eget bolag: spärren prövas mot en riktig medlem
    // av ett annat bolag, inte mot en användare utan bolag.
    companyD = await createCompany(userD.token, 'Dans Bolag AB');
  });

  it('T0 API:t ansluter som app, utan superuser och utan BYPASSRLS', async () => {
    const { rows } = await pool.query<{ anvandare: string; rolsuper: boolean; rolbypassrls: boolean }>(
      'SELECT current_user AS anvandare, r.rolsuper, r.rolbypassrls FROM pg_roles r WHERE r.rolname = current_user',
    );
    expect(rows[0]).toEqual({ anvandare: 'app', rolsuper: false, rolbypassrls: false });
    await expect(assertAppRoleEnforcesRls()).resolves.toBeUndefined();
  });

  it('T1 B:s läsning i A:s bolag ger 403 eller 404 på varje läsrutt, A:s egen ger 200', async () => {
    for (const r of reads) {
      const url = `/api/companies/${companyC}${r.path}`;
      const dan = await api.get(url).set(bearer(userD));
      expect([403, 404], `${r.id} GET ${r.path}: ${dan.status} ${JSON.stringify(dan.body)}`).toContain(
        dan.status,
      );
      const cora = await api.get(url).set(bearer(userC));
      expect(cora.status, `${r.id} GET ${r.path}: ${JSON.stringify(cora.body)}`).toBe(200);
    }
  });

  it('T2 B:s skrivning i A:s bolag ger 403 eller 404 på varje skrivrutt, och ingen rad skrivs', async () => {
    for (const w of writes) {
      const res = await api
        .post(`/api/companies/${companyC}${w.path}`)
        .set(bearer(userD))
        .send(w.body);
      expect([403, 404], `${w.id} POST ${w.path}: ${res.status} ${JSON.stringify(res.body)}`).toContain(
        res.status,
      );
    }

    // Ägarrollen ser alla rader, så en nolla här betyder att ingen skrivning skedde.
    const antal = await withAdmin(async (client) => {
      const rakna = async (sql: string): Promise<number | undefined> =>
        (await client.query<{ n: number }>(sql, [companyC])).rows[0]?.n;
      return {
        customers: await rakna('SELECT count(*)::int AS n FROM customers WHERE company_id = $1'),
        fiscal_years: await rakna('SELECT count(*)::int AS n FROM fiscal_years WHERE company_id = $1'),
        invoices: await rakna('SELECT count(*)::int AS n FROM invoices WHERE company_id = $1'),
        receipts: await rakna('SELECT count(*)::int AS n FROM receipts WHERE company_id = $1'),
        agent_token_minted: await rakna(
          "SELECT count(*)::int AS n FROM audit_log WHERE company_id = $1 AND action = 'agent_token.minted'",
        ),
      };
    });
    expect(antal).toEqual({ customers: 0, fiscal_years: 0, invoices: 0, receipts: 0, agent_token_minted: 0 });
  });

  // Står efter T2, så att T2:s räkning inte ser A:s egna rader.
  it('T3 A:s egna skrivanrop når rutten: varken 404 eller 5xx', async () => {
    for (const w of writes) {
      const res = await api
        .post(`/api/companies/${companyC}${w.path}`)
        .set(bearer(userC))
        .send(w.body);
      const msg = `${w.id} POST ${w.path}: ${res.status} ${JSON.stringify(res.body)}`;
      expect(res.status, msg).not.toBe(404);
      expect(res.status, msg).toBeLessThan(500);
    }
  });
});
