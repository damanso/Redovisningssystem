import type { PoolClient } from 'pg';
import type { Ore } from '../domain/money.js';

// Read-only rapporter över huvudboken. Allt i heltal ören. Kontotyp resolvas via
// shadow-subquery (företagskonto skuggar standardkonto), samma mönster som
// vatReport, så ett eget konto aldrig dubbelräknas.

export interface AccountLine {
  account_number: number;
  name: string;
  account_type: string;
  debit_ore: number;
  credit_ore: number;
  balance_ore: number; // debet − kredit
}

async function accountSums(
  client: PoolClient,
  companyId: string,
  opts: { from?: string; to?: string },
): Promise<AccountLine[]> {
  const result = await client.query<{
    account_number: number;
    name: string;
    account_type: string | null;
    debit_ore: string;
    credit_ore: string;
  }>(
    // account_type lämnas NULL om kontot saknar kontoplandefinition — vi defaultar
    // INTE till 'asset', för det skulle dölja ett obokfört/feldefinierat konto i
    // tillgångssumman. Ett oklassificerat saldo ska synas som en avvikelse.
    `SELECT vl.account_number,
            COALESCE(a.name, '') AS name,
            a.account_type AS account_type,
            sum(vl.debit_ore)  AS debit_ore,
            sum(vl.credit_ore) AS credit_ore
     FROM voucher_lines vl
     JOIN vouchers v ON v.id = vl.voucher_id
     LEFT JOIN LATERAL (
       SELECT name, account_type FROM accounts
       WHERE account_number = vl.account_number AND (company_id = $1 OR company_id IS NULL)
       ORDER BY company_id NULLS LAST LIMIT 1
     ) a ON true
     WHERE vl.company_id = $1
       AND ($2::date IS NULL OR v.voucher_date >= $2)
       AND ($3::date IS NULL OR v.voucher_date <= $3)
     GROUP BY vl.account_number, a.name, a.account_type
     ORDER BY vl.account_number`,
    [companyId, opts.from ?? null, opts.to ?? null],
  );
  return result.rows.map((r) => {
    const debit = Number(r.debit_ore);
    const credit = Number(r.credit_ore);
    return {
      account_number: r.account_number,
      name: r.name,
      // Konto utan kontoplandefinition hamnar i en egen 'unclassified'-hink och
      // räknas därmed inte som tillgång/skuld/resultat — det fångas av balanskontrollen.
      account_type: r.account_type ?? 'unclassified',
      debit_ore: debit,
      credit_ore: credit,
      balance_ore: debit - credit,
    };
  });
}

export interface IncomeStatement {
  from: string;
  to: string;
  revenue: AccountLine[];
  expense: AccountLine[];
  total_revenue_ore: Ore;
  total_expense_ore: Ore;
  result_ore: Ore; // intäkter − kostnader (positivt = vinst)
}

export async function incomeStatement(
  client: PoolClient,
  companyId: string,
  from: string,
  to: string,
): Promise<IncomeStatement> {
  const rows = await accountSums(client, companyId, { from, to });
  // Intäkt: kreditsaldo (kredit − debet). Kostnad: debetsaldo (debet − kredit).
  const revenue = rows
    .filter((r) => r.account_type === 'revenue')
    .map((r) => ({ ...r, balance_ore: r.credit_ore - r.debit_ore }));
  const expense = rows
    .filter((r) => r.account_type === 'expense')
    .map((r) => ({ ...r, balance_ore: r.debit_ore - r.credit_ore }));
  const totalRevenue = revenue.reduce((s, r) => s + r.balance_ore, 0);
  const totalExpense = expense.reduce((s, r) => s + r.balance_ore, 0);
  return {
    from,
    to,
    revenue,
    expense,
    total_revenue_ore: totalRevenue,
    total_expense_ore: totalExpense,
    result_ore: totalRevenue - totalExpense,
  };
}

export interface BalanceSheet {
  as_of: string;
  assets: AccountLine[];
  liabilities: AccountLine[];
  equity: AccountLine[];
  // Konton som saknar kontoplandefinition (account_type okänd). I ett friskt
  // system är detta tomt; icke-tomt = ett saldo som inte kunnat klassificeras.
  unclassified: AccountLine[];
  total_assets_ore: Ore;
  total_liabilities_ore: Ore;
  total_equity_ore: Ore;
  result_ore: Ore; // årets resultat (intäkter − kostnader hittills)
  // Balanskontroll = tillgångar − (skulder + eget kapital + resultat). Eftersom
  // varje verifikat är balanserat (CHECK i 0007) är summan av ALLA klassificerade
  // konton noll; det som kan göra kontrollen ≠ 0 är just oklassificerade saldon
  // (konton utan kontotyp). Kontrollen är alltså INTE vacuös: den fångar konton
  // som bokförts utan giltig kontoplandefinition. (Ett konto med FEL men giltig
  // kontotyp fångas dock inte av aritmetiken — det förutsätter en korrekt
  // seedad BAS-kontoplan.)
  difference_ore: Ore;
}

export async function balanceSheet(
  client: PoolClient,
  companyId: string,
  asOf: string,
): Promise<BalanceSheet> {
  const rows = await accountSums(client, companyId, { to: asOf });
  // Tillgång: debetsaldo. Skuld/EK: kreditsaldo.
  const assets = rows
    .filter((r) => r.account_type === 'asset')
    .map((r) => ({ ...r, balance_ore: r.debit_ore - r.credit_ore }));
  const liabilities = rows
    .filter((r) => r.account_type === 'liability')
    .map((r) => ({ ...r, balance_ore: r.credit_ore - r.debit_ore }));
  const equity = rows
    .filter((r) => r.account_type === 'equity')
    .map((r) => ({ ...r, balance_ore: r.credit_ore - r.debit_ore }));
  // Bara konton utan giltig kontotyp — dessa ska normalt inte finnas.
  const unclassified = rows.filter((r) => r.account_type === 'unclassified');
  const result =
    rows.filter((r) => r.account_type === 'revenue').reduce((s, r) => s + (r.credit_ore - r.debit_ore), 0) -
    rows.filter((r) => r.account_type === 'expense').reduce((s, r) => s + (r.debit_ore - r.credit_ore), 0);
  const totalAssets = assets.reduce((s, r) => s + r.balance_ore, 0);
  const totalLiabilities = liabilities.reduce((s, r) => s + r.balance_ore, 0);
  const totalEquity = equity.reduce((s, r) => s + r.balance_ore, 0);
  return {
    as_of: asOf,
    assets,
    liabilities,
    equity,
    unclassified,
    total_assets_ore: totalAssets,
    total_liabilities_ore: totalLiabilities,
    total_equity_ore: totalEquity,
    result_ore: result,
    difference_ore: totalAssets - (totalLiabilities + totalEquity + result),
  };
}

export interface LedgerVoucher {
  id: string;
  series: string;
  number: number;
  voucher_date: string;
  description: string;
  lines: { account_number: number; debit_ore: number; credit_ore: number; description: string | null }[];
}

/** Huvudbok / verifikationslista: verifikat med rader, senaste först. */
export async function generalLedger(
  client: PoolClient,
  companyId: string,
  opts: { fiscalYearId?: string; limit?: number } = {},
): Promise<LedgerVoucher[]> {
  const heads = await client.query<{
    id: string; series: string; number: number; voucher_date: string; description: string;
  }>(
    `SELECT id, series, number, voucher_date::text, description
     FROM vouchers
     WHERE company_id = $1 AND ($2::uuid IS NULL OR fiscal_year_id = $2)
     ORDER BY voucher_date DESC, series, number DESC
     LIMIT $3`,
    [companyId, opts.fiscalYearId ?? null, opts.limit ?? 100],
  );
  if (heads.rows.length === 0) return [];
  const ids = heads.rows.map((h) => h.id);
  const lines = await client.query<{
    voucher_id: string; account_number: number; debit_ore: number; credit_ore: number; description: string | null; line_no: number;
  }>(
    `SELECT voucher_id, account_number, debit_ore, credit_ore, description, line_no
     FROM voucher_lines WHERE voucher_id = ANY($1::uuid[]) ORDER BY voucher_id, line_no`,
    [ids],
  );
  const byVoucher = new Map<string, LedgerVoucher['lines']>();
  for (const l of lines.rows) {
    const arr = byVoucher.get(l.voucher_id) ?? [];
    arr.push({ account_number: l.account_number, debit_ore: l.debit_ore, credit_ore: l.credit_ore, description: l.description });
    byVoucher.set(l.voucher_id, arr);
  }
  return heads.rows.map((h) => ({ ...h, lines: byVoucher.get(h.id) ?? [] }));
}

export interface Dashboard {
  receivables_ore: Ore; // kundfordringar (1510)
  payables_ore: Ore; // leverantörsskulder (2440)
  bank_ore: Ore; // 1910 + 1920 + 1930 + 1940
  result_ore: Ore; // årets resultat
  invoice_count: number;
  receipt_count: number;
  voucher_count: number;
  pending_approvals: number;
}

/** Nyckeltal för dashboarden. year = räkenskapsårets intervall (för resultat). */
export async function dashboard(
  client: PoolClient,
  companyId: string,
  period: { from: string; to: string },
): Promise<Dashboard> {
  const rows = await accountSums(client, companyId, {});
  const bal = (n: number) => rows.find((r) => r.account_number === n)?.balance_ore ?? 0;
  const bankAccounts = [1910, 1920, 1930, 1940];
  const bank = rows.filter((r) => bankAccounts.includes(r.account_number)).reduce((s, r) => s + r.balance_ore, 0);

  const period_rows = await accountSums(client, companyId, period);
  const result =
    period_rows.filter((r) => r.account_type === 'revenue').reduce((s, r) => s + (r.credit_ore - r.debit_ore), 0) -
    period_rows.filter((r) => r.account_type === 'expense').reduce((s, r) => s + (r.debit_ore - r.credit_ore), 0);

  const counts = await client.query<{ invoices: string; receipts: string; vouchers: string; approvals: string }>(
    `SELECT
       (SELECT count(*) FROM invoices WHERE company_id = $1) AS invoices,
       (SELECT count(*) FROM receipts WHERE company_id = $1) AS receipts,
       (SELECT count(*) FROM vouchers WHERE company_id = $1) AS vouchers,
       (SELECT count(*) FROM action_approvals WHERE company_id = $1 AND status = 'pending') AS approvals`,
    [companyId],
  );
  const c = counts.rows[0]!;
  return {
    receivables_ore: bal(1510),
    payables_ore: -bal(2440), // skuld = kreditsaldo → visa positivt
    bank_ore: bank,
    result_ore: result,
    invoice_count: Number(c.invoices),
    receipt_count: Number(c.receipts),
    voucher_count: Number(c.vouchers),
    pending_approvals: Number(c.approvals),
  };
}
