import { expect } from 'vitest';
import { api, withAdmin, type TestUser } from './helpers.js';
import { withTenantTransaction } from '../src/db/tx.js';
import { verkstallMottagnaBeslut } from '../src/actions/execute.js';

/** B-2: ett affärsfel efter mottagandet lämnar mandatet beständigt, sakläget provas av anroparen. */
export async function provaMottagetFel(svar: { status: number; body: unknown }, companyId: string, user: TestUser,
  kod: string, logg: { mock: { calls: unknown[][] } }) {
  const body = svar.body as { approval: { id: string; status: string }; result: unknown };
  expect(svar.status, JSON.stringify(body)).toBe(202);
  expect(body.approval.status).toBe('approved'); expect(body.result).toBeNull();
  const q = await withAdmin(async (c) => (await c.query('SELECT * FROM action_approvals WHERE company_id=$1 AND id=$2', [companyId, body.approval.id])).rows[0]);
  expect(q.status).toBe('approved'); expect(q.beslut_hash).toMatch(/^[0-9a-f]{64}$/); expect(q.result).toBeNull();
  const pending = await withAdmin(async (c) => (await c.query("SELECT id FROM action_approvals WHERE company_id=$1 AND status='pending' AND id=$2", [companyId, q.id])).rows);
  expect(pending).toEqual([]);
  const kon = await api.get(`/api/companies/${companyId}/approvals?status=pending`).set('Authorization', `Bearer ${user.token}`);
  expect(kon.status, JSON.stringify(kon.body)).toBe(200);
  expect((kon.body.approvals as { id: string }[]).map((a) => a.id)).not.toContain(q.id);
  expect(await withAdmin(async (c) => (await c.query('SELECT id FROM uppdrag_beslut WHERE company_id=$1 AND approval_id=$2', [companyId, q.id])).rows)).toEqual([]);
  expect(logg.mock.calls).toContainEqual(['[verkställighet] mottaget beslut ej verkställt — köpost', q.id, q.action, kod]);
  const retry = await withTenantTransaction(user.userId, companyId, (c) => verkstallMottagnaBeslut(c, companyId));
  expect(retry.kvar).toContain(q.id);
}

/**
 * `satt_baseline` begärd direkt (202) och godkänd (200, `executed`). Importen
 * köar bara en gång per källa (Story 2.1), så `sattBaseline`:s egen
 * idempotens för samma text mot samma avtal provas den här vägen.
 */
export async function sattBaselineDirekt(
  companyId: string, auth: Record<string, string>, input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const base = `/api/companies/${companyId}`;
  const begaran = await api.post(`${base}/actions/satt_baseline`).set(auth).send(input);
  expect(begaran.status, JSON.stringify(begaran.body)).toBe(202);
  const godkant = await api.post(`${base}/approvals/${begaran.body.approval.id}/approve`).set(auth).send({});
  expect(godkant.status, JSON.stringify(godkant.body)).toBe(200);
  expect(godkant.body.approval.status).toBe('executed');
  return godkant.body.result;
}

/** Så testbaselinen genom samma förslag och mänskliga godkännande som produkten. */
export async function importeraOchGodkann(
  companyId: string, auth: Record<string, string>, input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const base = `/api/companies/${companyId}`;
  const forslag = await api.post(`${base}/actions/importera_leveranskontrakt`).set(auth).send(input);
  expect(forslag.status, JSON.stringify(forslag.body)).toBe(200);
  expect(forslag.body.result.approval_id).toEqual(expect.any(String));
  const godkant = await api.post(`${base}/approvals/${forslag.body.result.approval_id}/approve`).set(auth).send({});
  expect(godkant.status, JSON.stringify(godkant.body)).toBe(200);
  expect(godkant.body.approval.status).toBe('executed');
  return godkant.body.result;
}
