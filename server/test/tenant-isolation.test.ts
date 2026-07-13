// Acceptanskriterium (KICKOFF §4, Fas 0): "ett automatiskt test där användare B
// försöker läsa användare A:s data via A:s company_id returnerar 403/404,
// aldrig 200". Detta var exakt det som var trasigt i den gamla koden — B kunde
// läsa A:s fakturor, kunder och omsättning med HTTP 200.
import jwt from 'jsonwebtoken';
import { beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../src/db/pool.js';
import { api, createCompany, registerUser, type TestUser } from './helpers.js';

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
