// FR-38: en känslig vyknapp får aldrig bokföra förbi människans granskning.
// Provet går genom session, vyrouter, åtgärdslager och riktig Postgres och
// mäter både köpost, audit och frånvaron av konton/verifikat före godkännandet.
import { beforeAll, describe, expect, it } from 'vitest';
import supertest from 'supertest';
import { app, createCompany, createFiscalYear, registerUser, withAdmin } from './helpers.js';

const SIE = [
  '#KONTO 1930 "Företagskonto"', '#KONTO 3001 "Försäljning"',
  '#VER A 1 20260201 "Kontantförsäljning"', '{',
  '#TRANS 1930 {} 1250.00', '#TRANS 3001 {} -1250.00', '}',
].join('\n');

describe('Känsliga vyknappar köas (FR-38)', () => {
  let companyId: string;
  let fy: string;
  const view = supertest.agent(app);
  beforeAll(async () => {
    const user = await registerUser('vyknappar');
    companyId = await createCompany(user.token, 'Vyknappar AB');
    fy = (await createFiscalYear(companyId, { Authorization: `Bearer ${user.token}` }, {
      label: '2026', start_date: '2026-01-01', end_date: '2026-12-31',
    })).id;
    const login = await view.post('/app/login').type('form').send({ email: user.email, password: 'mycket-hemligt-losen-123' });
    expect(login.status, login.text).toBe(302);
  }, 120_000);

  // Story 1.12 kan lägga fler vyknappar bredvid denna rad.
  const postfall = [{ route: 'import/sie', action: 'import_sie', fields: () => ({ fiscal_year_id: fy, sie_content: SIE }) }];
  for (const fall of postfall) {
    it(`V1.1 ${fall.route} köar exakt ett förslag och en auditrad utan bokföring`, async () => {
      const snapshot = () => withAdmin(async (c) => {
        const counts = (await c.query(
          `SELECT (SELECT count(*)::int FROM vouchers WHERE company_id = $1) AS vouchers,
            (SELECT count(*)::int FROM accounts WHERE company_id = $1) AS accounts,
            (SELECT coalesce(max(id), 0) FROM audit_log WHERE company_id = $1) AS audit`, [companyId])).rows[0]!;
        const pending = (await c.query(
          "SELECT id, action FROM action_approvals WHERE company_id = $1 AND status = 'pending' ORDER BY created_at, id", [companyId])).rows;
        return { counts, pending };
      });
      const before = await snapshot();
      const res = await view.post(`/app/c/${companyId}/${fall.route}`).type('form').send(fall.fields());
      expect(res.status, res.text).toBe(302);
      expect(res.headers.location).toBe(`/app/c/${companyId}/approvals`);
      const after = await snapshot();
      const added = after.pending.filter((p) => !before.pending.some((b) => b.id === p.id));
      expect(added).toHaveLength(1);
      expect(added[0]!.action).toBe(fall.action);
      expect(after.counts).toMatchObject({ vouchers: before.counts.vouchers, accounts: before.counts.accounts });
      const audit = await withAdmin(async (c) => (await c.query(
        'SELECT action, entity_id FROM audit_log WHERE company_id = $1 AND id > $2 ORDER BY id', [companyId, before.counts.audit])).rows);
      expect(audit).toEqual([{ action: 'action.approval_requested', entity_id: added[0]!.id }]);
    });
  }
});
