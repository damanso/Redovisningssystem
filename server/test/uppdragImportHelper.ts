import { expect, vi } from 'vitest';
import { api, withAdmin } from './helpers.js';
import { withTenantTransaction } from '../src/db/tx.js';
import { verkstallMottagnaBeslut } from '../src/actions/execute.js';

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

/** Story 1.7: ett affärsfel efter mottaget ja är ingen obesvarad köpost.
 * Domänens ögonblicksbild prövas där anropet görs; här prövas mandat, frånvaro
 * av beslutsrad, driftloggens kod och ett nytt återförsök i ny transaktion. */
export async function provaMottagetFel(companyId: string, auth: Record<string, string>, approvalId: string, kod: string) {
  const logg = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const r = await api.post(`/api/companies/${companyId}/approvals/${approvalId}/approve`).set(auth).send({});
    expect(r.status, JSON.stringify(r.body)).toBe(202);
    expect(r.body.approval.status).toBe('approved'); expect(r.body.result).toBeNull();
    const q = await withAdmin(async (c) => (await c.query('SELECT * FROM action_approvals WHERE company_id=$1 AND id=$2', [companyId, approvalId])).rows[0]);
    expect(q.status).toBe('approved'); expect(q.beslut_hash).toMatch(/^[0-9a-f]{64}$/); expect(q.result).toBeNull();
    expect(logg.mock.calls).toContainEqual(['[verkställighet] mottaget beslut ej verkställt — köpost', approvalId, q.action, kod]);
    const pending = await api.get(`/api/companies/${companyId}/approvals?status=pending`).set(auth);
    expect(pending.status, JSON.stringify(pending.body)).toBe(200); expect(pending.body.approvals.map((q: { id: string }) => q.id)).not.toContain(approvalId);
    const retry = await withTenantTransaction(q.decided_by as string, companyId, (c) => verkstallMottagnaBeslut(c, companyId));
    expect(retry.kvar).toContain(approvalId);
    const beslut = await withAdmin((c) => c.query('SELECT id FROM uppdrag_beslut WHERE approval_id=$1', [approvalId]));
    expect(beslut.rows).toEqual([]);
    return r;
  } finally { logg.mockRestore(); }
}
