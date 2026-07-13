// Acceptanskriterium (KICKOFF §4, Fas 0): "Immutabel, append-only revisionslogg
// finns och skrivs vid en skrivoperation. Bevis: utför en åtgärd, visa
// loggraden; visa att ett UPDATE/DELETE på loggen avvisas."
import { beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../src/db/pool.js';
import { api, createCompany, registerUser, withAdmin, type TestUser } from './helpers.js';

let user: TestUser;
let companyId: string;

beforeAll(async () => {
  user = await registerUser('auditor');
  companyId = await createCompany(user.token, 'Granskat AB');
});

describe('revisionsloggen skrivs vid skrivoperationer', () => {
  it('company.created loggades när bolaget skapades', async () => {
    const res = await api
      .get(`/api/companies/${companyId}/audit`)
      .set('Authorization', `Bearer ${user.token}`);
    expect(res.status).toBe(200);
    const created = res.body.entries.find(
      (e: { action: string }) => e.action === 'company.created',
    );
    expect(created).toBeDefined();
    expect(created.user_id).toBe(user.userId);
    expect(created.entity_id).toBe(companyId);
  });

  it('company.updated loggas i samma transaktion som mutationen', async () => {
    await api
      .patch(`/api/companies/${companyId}`)
      .set('Authorization', `Bearer ${user.token}`)
      .send({ name: 'Granskat Igen AB' });
    const res = await api
      .get(`/api/companies/${companyId}/audit`)
      .set('Authorization', `Bearer ${user.token}`);
    const updated = res.body.entries.find(
      (e: { action: string }) => e.action === 'company.updated',
    );
    expect(updated).toBeDefined();
    expect(updated.details.fields).toContain('name');
  });
});

describe('loggen är append-only', () => {
  it('UPDATE avvisas även för tabellägaren (trigger)', async () => {
    await expect(
      withAdmin((c) => c.query("UPDATE audit_log SET action = 'manipulerad'")),
    ).rejects.toThrow(/append-only/);
  });

  it('DELETE avvisas även för tabellägaren (trigger)', async () => {
    await expect(withAdmin((c) => c.query('DELETE FROM audit_log'))).rejects.toThrow(
      /append-only/,
    );
  });

  it('TRUNCATE avvisas även för tabellägaren (trigger)', async () => {
    await expect(withAdmin((c) => c.query('TRUNCATE audit_log'))).rejects.toThrow(/append-only/);
  });

  it('UPDATE/DELETE som app-rollen: permission denied (grant saknas)', async () => {
    await expect(pool.query("UPDATE audit_log SET action = 'x'")).rejects.toThrow(
      /permission denied/,
    );
    await expect(pool.query('DELETE FROM audit_log')).rejects.toThrow(/permission denied/);
  });
});
