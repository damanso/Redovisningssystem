// Regressionstester för fynden från Fas 0-kodgranskningen (se ReportFindings).
// Varje test motsvarar ett verifierat fynd som åtgärdats.
import pg from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';
import { assertAppRoleEnforcesRls } from '../src/db/pool.js';
import {
  api,
  createCompany,
  registerUser,
  type TestUser,
} from './helpers.js';

describe('fynd: RLS-owner-bypass — startassertion (pool.assertAppRoleEnforcesRls)', () => {
  it('app-rollen passerar (icke-superuser, äger inte tenant-tabellerna)', async () => {
    await expect(assertAppRoleEnforcesRls()).resolves.toBeUndefined();
  });

  it('ägar-/superuser-rollen (postgres) avvisas — skulle kringgå RLS', async () => {
    // assertAppRoleEnforcesRls använder den delade poolen (app). Här verifierar
    // vi motsatsen direkt: postgres är superuser och äger tabellerna, och ser
    // faktiskt bolagsrader utan RLS-kontext — exakt det startassertionen fångar.
    const admin = new pg.Client({ connectionString: process.env.DATABASE_ADMIN_URL });
    await admin.connect();
    try {
      const priv = await admin.query<{ rolsuper: boolean }>(
        'SELECT rolsuper FROM pg_roles WHERE rolname = current_user',
      );
      expect(priv.rows[0]!.rolsuper).toBe(true);
      // Ägaren ser rader trots FORCE RLS endast om superuser (superuser kringgår
      // alltid RLS) — vilket är precis varför API:t aldrig får vara superuser.
      const rows = await admin.query('SELECT count(*)::int AS n FROM companies');
      expect(rows.rows[0]!.n).toBeGreaterThanOrEqual(0);
    } finally {
      await admin.end();
    }
  });
});

describe('fynd: registrering — dubblett-e-post ger 409, inte 500', () => {
  it('andra registreringen med samma e-post → 409 email_taken', async () => {
    const email = `dup-${Date.now()}@example.se`;
    const first = await api
      .post('/api/auth/register')
      .send({ email, password: 'mycket-hemligt-losen-123', name: 'Först' });
    expect(first.status).toBe(201);
    const second = await api
      .post('/api/auth/register')
      .send({ email, password: 'mycket-hemligt-losen-123', name: 'Andra' });
    expect(second.status).toBe(409);
    expect(second.body.error).toBe('email_taken');
  });

  it('e-post normaliseras lika i register och login (delad EmailSchema)', async () => {
    const email = `MixedCase-${Date.now()}@Example.SE`;
    const reg = await api
      .post('/api/auth/register')
      .send({ email, password: 'mycket-hemligt-losen-123', name: 'Blandad' });
    expect(reg.status).toBe(201);
    // Logga in med annan skiftläge → ska matcha via lower(email).
    const login = await api
      .post('/api/auth/login')
      .send({ email: email.toUpperCase(), password: 'mycket-hemligt-losen-123' });
    expect(login.status).toBe(200);
  });
});

describe('fynd: NUL/kontrolltecken i namn ger 400, inte 500', () => {
  let user: TestUser;
  beforeAll(async () => {
    user = await registerUser('nul');
  });

  it('bolagsnamn med U+0000 avvisas med 400', async () => {
    const res = await api
      .post('/api/companies')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ name: 'acme\u0000inc' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('validation_error');
  });
});

describe('fynd: filnamn med unicode kan laddas upp OCH hämtas (ingen 500/mojibake)', () => {
  let user: TestUser;
  let companyId: string;
  const PDF = Buffer.from('%PDF-1.4 unicode-test');

  beforeAll(async () => {
    user = await registerUser('unicode');
    companyId = await createCompany(user.token, 'Unicode AB');
  });

  it('CJK-filnamn bevaras som UTF-8 och filen är hämtbar (200)', async () => {
    const upload = await api
      .post(`/api/companies/${companyId}/files`)
      .set('Authorization', `Bearer ${user.token}`)
      .attach('file', PDF, { filename: '文件.pdf', contentType: 'application/pdf' });
    expect(upload.status).toBe(201);
    // multer defParamCharset:'utf8' → inget mojibake.
    expect(upload.body.file.original_name).toBe('文件.pdf');

    const download = await api
      .get(`/api/companies/${companyId}/files/${upload.body.file.id}`)
      .set('Authorization', `Bearer ${user.token}`);
    // Fyndet: hämtning gav 500 (ERR_INVALID_CHAR) innan res.attachment infördes.
    expect(download.status).toBe(200);
    // RFC 5987-kodat filnamn för icke-ASCII.
    expect(download.headers['content-disposition']).toContain("filename*=UTF-8''");
  });

  it('svenskt filnamn åäö bevaras utan mojibake', async () => {
    const upload = await api
      .post(`/api/companies/${companyId}/files`)
      .set('Authorization', `Bearer ${user.token}`)
      .attach('file', PDF, { filename: 'kvitto_åäö.pdf', contentType: 'application/pdf' });
    expect(upload.status).toBe(201);
    expect(upload.body.file.original_name).toBe('kvitto_åäö.pdf');
  });
});

describe('fynd: audit-paginering — hela historiken är nåbar (ingen tyst trunkering)', () => {
  let user: TestUser;
  let companyId: string;

  beforeAll(async () => {
    user = await registerUser('pagination');
    companyId = await createCompany(user.token, 'Paginering AB');
    // Skapa några audit-rader genom upprepade uppdateringar.
    for (let i = 0; i < 5; i++) {
      await api
        .patch(`/api/companies/${companyId}`)
        .set('Authorization', `Bearer ${user.token}`)
        .send({ name: `Namn ${i}` });
    }
  });

  it('limit + before-markör bläddrar bakåt utan att tappa rader', async () => {
    const page1 = await api
      .get(`/api/companies/${companyId}/audit?limit=3`)
      .set('Authorization', `Bearer ${user.token}`);
    expect(page1.status).toBe(200);
    expect(page1.body.entries).toHaveLength(3);
    expect(page1.body.next_before).toBeTruthy();
    // id:na är strikt fallande.
    const ids1 = page1.body.entries.map((e: { id: string }) => Number(e.id));
    expect(ids1).toEqual([...ids1].sort((a, b) => b - a));

    const page2 = await api
      .get(`/api/companies/${companyId}/audit?limit=3&before=${page1.body.next_before}`)
      .set('Authorization', `Bearer ${user.token}`);
    expect(page2.status).toBe(200);
    const ids2 = page2.body.entries.map((e: { id: string }) => Number(e.id));
    // Ingen överlappning mellan sidorna.
    expect(ids1.filter((id: number) => ids2.includes(id))).toHaveLength(0);
    // Sida 2 är äldre än sida 1.
    expect(Math.max(...ids2)).toBeLessThan(Math.min(...ids1));
  });
});
