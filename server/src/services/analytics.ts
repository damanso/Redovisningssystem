// Fas A9: avancerad analys. Läsande nyckeltal och nedbrytningar över huvudboken
// och reskontran. Allt i heltal ören; nyckeltal returneras som promille (0–1000)
// för att undvika flyttal i transporten (t.ex. margin_permille 250 = 25,0 %).
import type { PoolClient } from 'pg';
import type { Ore } from '../domain/money.js';
import { balanceSheet, incomeStatement } from './reports.js';

/** Heltalspromille av del/helt (0–1000). 0 om helt är 0. */
function permille(part: number, whole: number): number {
  if (whole === 0) return 0;
  return Math.round((part / whole) * 1000);
}

export interface TopCustomer { customer_id: string; customer_name: string; net_ore: Ore; invoice_count: number }

/** Toppkunder efter nettoomsättning (bokförda, ej annullerade fakturor i perioden). */
export async function topCustomers(
  client: PoolClient, companyId: string, from: string, to: string, limit = 10,
): Promise<TopCustomer[]> {
  const r = await client.query<{ customer_id: string; customer_name: string; net_ore: string; invoice_count: string }>(
    `SELECT i.customer_id, c.name AS customer_name,
            sum(i.subtotal_ore) AS net_ore, count(*) AS invoice_count
     FROM invoices i JOIN customers c ON c.id = i.customer_id
     WHERE i.company_id = $1 AND i.voucher_id IS NOT NULL AND i.status <> 'cancelled'
       AND i.invoice_date BETWEEN $2 AND $3
     GROUP BY i.customer_id, c.name
     ORDER BY sum(i.subtotal_ore) DESC, c.name
     LIMIT $4`,
    [companyId, from, to, limit],
  );
  return r.rows.map((x) => ({
    customer_id: x.customer_id, customer_name: x.customer_name,
    net_ore: Number(x.net_ore), invoice_count: Number(x.invoice_count),
  }));
}

export interface ExpenseSlice { account_number: number; name: string; amount_ore: Ore; share_permille: number }
export interface ExpenseBreakdown { total_ore: Ore; slices: ExpenseSlice[] }

/** Kostnader per konto i perioden, med andel av total (promille). */
export async function expenseBreakdown(
  client: PoolClient, companyId: string, from: string, to: string,
): Promise<ExpenseBreakdown> {
  const r = await client.query<{ account_number: number; name: string; amount_ore: string }>(
    `SELECT vl.account_number, COALESCE(a.name, '') AS name,
            sum(vl.debit_ore - vl.credit_ore) AS amount_ore
     FROM voucher_lines vl
     JOIN vouchers v ON v.id = vl.voucher_id
     JOIN LATERAL (
       SELECT name, account_type FROM accounts
       WHERE account_number = vl.account_number AND (company_id = $1 OR company_id IS NULL)
       ORDER BY company_id NULLS LAST LIMIT 1
     ) a ON true
     WHERE vl.company_id = $1 AND a.account_type = 'expense'
       AND v.voucher_date BETWEEN $2 AND $3
     GROUP BY vl.account_number, a.name
     HAVING sum(vl.debit_ore - vl.credit_ore) <> 0
     ORDER BY sum(vl.debit_ore - vl.credit_ore) DESC`,
    [companyId, from, to],
  );
  const slices = r.rows.map((x) => ({ account_number: x.account_number, name: x.name, amount_ore: Number(x.amount_ore) }));
  const total = slices.reduce((s, x) => s + x.amount_ore, 0);
  return {
    total_ore: total,
    slices: slices.map((x) => ({ ...x, share_permille: permille(x.amount_ore, total) })),
  };
}

export interface KeyRatios {
  from: string;
  to: string;
  revenue_ore: Ore;
  expense_ore: Ore;
  result_ore: Ore;
  net_margin_permille: number;   // resultat / intäkter
  equity_ratio_permille: number; // eget kapital / totala tillgångar (soliditet)
  current_ratio_permille: number; // omsättningstillgångar / kortfristiga skulder
  total_assets_ore: Ore;
  equity_ore: Ore;
}

/**
 * Nyckeltal: nettomarginal (resultat/intäkter), soliditet (EK/tillgångar) och
 * kassalikviditet (omsättningstillgångar 14xx–19xx / kortfristiga skulder 24xx–29xx).
 * Klassningen av kort-/långfristigt är en approximation efter BAS-kontointervall.
 */
export async function keyRatios(
  client: PoolClient, companyId: string, from: string, to: string,
): Promise<KeyRatios> {
  const is = await incomeStatement(client, companyId, from, to);
  const bs = await balanceSheet(client, companyId, to);

  const currentAssets = bs.assets
    .filter((a) => a.account_number >= 1400 && a.account_number <= 1999)
    .reduce((s, a) => s + a.balance_ore, 0);
  const currentLiabilities = bs.liabilities
    .filter((a) => a.account_number >= 2400 && a.account_number <= 2999)
    .reduce((s, a) => s + a.balance_ore, 0);
  const equity = bs.total_equity_ore + bs.result_ore; // inkl. årets resultat

  return {
    from, to,
    revenue_ore: is.total_revenue_ore,
    expense_ore: is.total_expense_ore,
    result_ore: is.result_ore,
    net_margin_permille: permille(is.result_ore, is.total_revenue_ore),
    equity_ratio_permille: permille(equity, bs.total_assets_ore),
    current_ratio_permille: permille(currentAssets, currentLiabilities),
    total_assets_ore: bs.total_assets_ore,
    equity_ore: equity,
  };
}
