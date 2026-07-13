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
