import { expect } from 'vitest';
import { api } from './helpers.js';

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
