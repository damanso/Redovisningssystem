import pg from 'pg';
import supertest from 'supertest';
import { expect } from 'vitest';
import { createApp } from '../src/http/app.js';

export const app = createApp();
export const api = supertest(app);

let counter = 0;

export interface TestUser {
  userId: string;
  email: string;
  token: string;
}

export async function registerUser(prefix = 'user'): Promise<TestUser> {
  const email = `${prefix}-${Date.now()}-${counter++}@example.se`;
  const res = await api
    .post('/api/auth/register')
    .send({ email, password: 'mycket-hemligt-losen-123', name: prefix });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return { userId: res.body.user.id, email, token: res.body.token };
}

export async function createCompany(token: string, name: string): Promise<string> {
  const res = await api
    .post('/api/companies')
    .set('Authorization', `Bearer ${token}`)
    .send({ name });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.company.id;
}

export interface FiscalYearBody {
  label: string;
  start_date: string;
  end_date: string;
}

/**
 * Skapar ett räkenskapsår i test-setup OCH asserterar HTTP-statusen (201) med
 * hela svarskroppen i felmeddelandet. Utan denna assertion läser ett `beforeAll`
 * blint `res.body.fiscal_year.id`, och en felkropp (utan `fiscal_year`) ger då
 * ett kryptiskt "Cannot read properties of undefined (reading 'id')" som DÖLJER
 * den verkliga orsaken (status + felkod). Använd i all setup i stället för
 * blinda `.body.fiscal_year.id`-läsningar.
 */
export async function createFiscalYear(
  companyId: string,
  authHeaders: Record<string, string>,
  body: FiscalYearBody,
): Promise<{ id: string; label: string; start_date: string; end_date: string; is_locked: boolean }> {
  const res = await api
    .post(`/api/companies/${companyId}/accounting/fiscal-years`)
    .set(authHeaders)
    .send(body);
  expect(res.status, `fiscal-years setup misslyckades: ${res.status} ${JSON.stringify(res.body)}`).toBe(201);
  return res.body.fiscal_year;
}

/**
 * Extraherar den läsbara texten ur en (okomprimerad) PDFKit-PDF. PDFKit skriver
 * text som hex-strängar i TJ-arrayer (<48616e...> = "Han..."), så en ren grep
 * på bufferten hittar inget — vi avkodar hex-runorna och slår ihop dem.
 */
export function pdfText(buffer: Buffer): string {
  const raw = buffer.toString('latin1');
  let out = '';
  for (const match of raw.matchAll(/<([0-9A-Fa-f]+)>/g)) {
    const hex = match[1]!;
    if (hex.length % 2 !== 0) continue;
    for (let i = 0; i < hex.length; i += 2) {
      out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
    }
  }
  return out;
}

/** Adminanslutning (ägarrollen) för verifieringar som ska gå förbi app-rollen. */
export async function withAdmin<T>(fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: process.env.DATABASE_ADMIN_URL });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}
