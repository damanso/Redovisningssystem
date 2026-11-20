// FR-38: en känslig vyknapp får aldrig skriva bokföring förbi kön.
// Provar vy → åtgärdslager → riktig databas, inklusive audit och ingen verkan.
import supertest from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { app, createCompany, createFiscalYear, registerUser, withAdmin } from './helpers.js';

const SIE = [
  '#KONTO 1930 "Bank"', '#KONTO 3001 "Försäljning"',
  '#VER A 1 20260201 "Försäljning"', '{',
  '#TRANS 1930 {} 100.00', '#TRANS 3001 {} -100.00', '}',
].join('\n');

describe('Känsliga vyknappar köas (FR-38)', () => {
  let companyId: string;
  let fy: string;
  const browser = supertest.agent(app);
  beforeAll(async () => {
    const user = await registerUser('vyknappar');
    companyId = await createCompany(user.token, 'Vyknappar AB');
    fy = (await createFiscalYear(companyId, { Authorization: `Bearer ${user.token}` }, {
      label: '2026', start_date: '2026-01-01', end_date: '2026-12-31',
    })).id;
    const login = await browser.post('/app/login').type('form')
      .send({ email: user.email, password: 'mycket-hemligt-losen-123' });
    expect(login.status, login.text).toBe(302);
  });

  const POSTFALL = [
    { id: 'V1.1', route: 'import/sie', action: 'import_sie', form: () => ({ fiscal_year_id: fy, sie_content: SIE }) },
  ];

  async function bild() {
    return withAdmin(async (client) => ({
      counts: (await client.query(
        `SELECT (SELECT count(*) FROM vouchers WHERE company_id = $1)::int AS vouchers,
                (SELECT count(*) FROM accounts WHERE company_id = $1)::int AS accounts`, [companyId])).rows[0],
      pending: (await client.query<{ id: string; action: string }>(
        "SELECT id, action FROM action_approvals WHERE company_id = $1 AND status = 'pending' ORDER BY created_at, id", [companyId])).rows,
      audit: (await client.query<{ id: string; action: string }>(
        'SELECT id::text, action FROM audit_log WHERE company_id = $1 ORDER BY id', [companyId])).rows,
    }));
  }

  for (const test of POSTFALL) {
    it(`${test.id} ${test.route} leder till Att göra utan bokföring`, async () => {
      const before = await bild();
      const res = await browser.post(`/app/c/${companyId}/${test.route}`).type('form').send(test.form());
      expect(res.status, res.text).toBe(302);
      expect(res.headers.location).toBe(`/app/c/${companyId}/approvals`);
      const after = await bild();
      expect(after.counts).toEqual(before.counts);
      const pendingIds = new Set(before.pending.map((row) => row.id));
      const added = after.pending.filter((row) => !pendingIds.has(row.id));
      expect(added).toEqual([expect.objectContaining({ action: test.action })]);
      const auditIds = new Set(before.audit.map((row) => row.id));
      expect(after.audit.filter((row) => !auditIds.has(row.id)))
        .toEqual([expect.objectContaining({ action: 'action.approval_requested' })]);
    });
  }
});
