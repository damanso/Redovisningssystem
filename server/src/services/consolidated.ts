// Fas A8: konsoliderad koncernöversikt. Aggregerar nyckeltal ÖVER de bolag som
// användaren faktiskt är medlem i. Varje bolags siffror hämtas i sin EGEN
// tenant-transaktion (RLS tvingas per bolag) — ingen cross-tenant-läcka; vi
// summerar bara resultat användaren redan har rätt att se. Belopp i heltal ören.
import { withTenantTransaction, withUserTransaction } from '../db/tx.js';
import { dashboard } from './reports.js';

export interface ConsolidatedRow {
  company_id: string;
  company_name: string;
  role: string;
  receivables_ore: number;
  payables_ore: number;
  bank_ore: number;
  result_ore: number;
  pending_approvals: number;
}
export interface Consolidated {
  rows: ConsolidatedRow[];
  totals: Omit<ConsolidatedRow, 'company_id' | 'company_name' | 'role'>;
}

async function fiscalPeriod(client: import('pg').PoolClient, companyId: string): Promise<{ from: string; to: string }> {
  const r = await client.query<{ start_date: string; end_date: string }>(
    'SELECT start_date::text, end_date::text FROM fiscal_years WHERE company_id = $1 ORDER BY start_date DESC LIMIT 1',
    [companyId],
  );
  return r.rows[0] ? { from: r.rows[0].start_date, to: r.rows[0].end_date } : { from: '0001-01-01', to: '9999-12-31' };
}

export async function consolidatedOverview(userId: string): Promise<Consolidated> {
  // 1) Bolag användaren är medlem i (i användarkontext, inte bolagskontext).
  const companies = await withUserTransaction(userId, async (client) => {
    const r = await client.query<{ id: string; name: string; role: string }>(
      `SELECT c.id, c.name, m.role FROM companies c JOIN company_members m ON m.company_id = c.id
       WHERE m.user_id = $1 ORDER BY c.name`,
      [userId],
    );
    return r.rows;
  });

  // 2) Per bolag: hämta dashboard-nyckeltal i bolagets egen tenant-transaktion.
  const rows: ConsolidatedRow[] = [];
  for (const co of companies) {
    const d = await withTenantTransaction(userId, co.id, async (client) => {
      const period = await fiscalPeriod(client, co.id);
      return dashboard(client, co.id, period);
    });
    rows.push({
      company_id: co.id,
      company_name: co.name,
      role: co.role,
      receivables_ore: d.receivables_ore,
      payables_ore: d.payables_ore,
      bank_ore: d.bank_ore,
      result_ore: d.result_ore,
      pending_approvals: d.pending_approvals,
    });
  }

  const sum = (k: keyof ConsolidatedRow) => rows.reduce((s, r) => s + (r[k] as number), 0);
  return {
    rows,
    totals: {
      receivables_ore: sum('receivables_ore'),
      payables_ore: sum('payables_ore'),
      bank_ore: sum('bank_ore'),
      result_ore: sum('result_ore'),
      pending_approvals: sum('pending_approvals'),
    },
  };
}
