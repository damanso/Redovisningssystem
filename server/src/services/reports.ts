import type { PoolClient } from 'pg';
import type { Ore } from '../domain/money.js';

// Read-only rapporter över huvudboken. Allt i heltal ören. Kontotyp resolvas via
// shadow-subquery (företagskonto skuggar standardkonto), samma mönster som
// vatReport, så ett eget konto aldrig dubbelräknas.

// Dagens datum (ISO) som fallback för åldersanalysernas as_of när frågan inte
// returnerar någon rad (t.ex. inga öppna fakturor) — så headern aldrig blir tom.
const todayIso = (): string => new Date().toISOString().slice(0, 10);

export interface AccountLine {
  account_number: number;
  name: string;
  account_type: string;
  debit_ore: number;
  credit_ore: number;
  balance_ore: number; // debet − kredit
}

export async function accountSums(
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
  opts: { fiscalYearId?: string; limit?: number | null } = {},
): Promise<LedgerVoucher[]> {
  // limit === null → ingen gräns (för fullständig CSV-export; en trunkerad
  // huvudbok som ser komplett ut vore ett dataintegritetsfel). Default 100 för vyn.
  const limit = opts.limit === undefined ? 100 : opts.limit;
  const params: unknown[] = [companyId, opts.fiscalYearId ?? null];
  let sql =
    `SELECT id, series, number, voucher_date::text, description
     FROM vouchers
     WHERE company_id = $1 AND ($2::uuid IS NULL OR fiscal_year_id = $2)
     ORDER BY voucher_date DESC, series, number DESC`;
  if (limit !== null) {
    params.push(limit);
    sql += ` LIMIT $3`;
  }
  const heads = await client.query<{
    id: string; series: string; number: number; voucher_date: string; description: string;
  }>(sql, params);
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

export interface ApAgingRow { supplier_id: string; supplier_name: string; not_due_ore: Ore; d1_30_ore: Ore; d31_60_ore: Ore; d61_90_ore: Ore; d90_plus_ore: Ore; total_ore: Ore }
export interface ApAging { as_of: string; rows: ApAgingRow[]; totals: Omit<ApAgingRow, 'supplier_id' | 'supplier_name'> }

/** Leverantörsreskontra med åldersanalys — utestående (bokförda, ej annullerade)
 *  leverantörsfakturor per leverantör och förfalloålder. Belopp = total − betalt. */
export async function accountsPayableAging(client: PoolClient, companyId: string, asOf?: string): Promise<ApAging> {
  const result = await client.query<{
    supplier_id: string; supplier_name: string; not_due: number; d1_30: number; d31_60: number; d61_90: number; d90_plus: number; total: number; as_of: string;
  }>(
    `WITH ref AS (SELECT COALESCE($2::date, CURRENT_DATE) AS d),
     open_si AS (
       SELECT si.supplier_id, si.due_date, (si.total_ore - si.paid_amount_ore) AS outstanding
       FROM supplier_invoices si
       WHERE si.company_id = $1 AND si.voucher_id IS NOT NULL
         AND si.status <> 'cancelled' AND si.total_ore > si.paid_amount_ore
     )
     SELECT o.supplier_id, s.name AS supplier_name,
       sum(CASE WHEN o.due_date >= (SELECT d FROM ref) THEN o.outstanding ELSE 0 END) AS not_due,
       sum(CASE WHEN (SELECT d FROM ref) - o.due_date BETWEEN 1 AND 30 THEN o.outstanding ELSE 0 END) AS d1_30,
       sum(CASE WHEN (SELECT d FROM ref) - o.due_date BETWEEN 31 AND 60 THEN o.outstanding ELSE 0 END) AS d31_60,
       sum(CASE WHEN (SELECT d FROM ref) - o.due_date BETWEEN 61 AND 90 THEN o.outstanding ELSE 0 END) AS d61_90,
       sum(CASE WHEN (SELECT d FROM ref) - o.due_date > 90 THEN o.outstanding ELSE 0 END) AS d90_plus,
       sum(o.outstanding) AS total, (SELECT d FROM ref)::text AS as_of
     FROM open_si o JOIN suppliers s ON s.id = o.supplier_id
     GROUP BY o.supplier_id, s.name
     ORDER BY total DESC, s.name`,
    [companyId, asOf ?? null],
  );
  const rows: ApAgingRow[] = result.rows.map((r) => ({
    supplier_id: r.supplier_id, supplier_name: r.supplier_name,
    not_due_ore: Number(r.not_due), d1_30_ore: Number(r.d1_30), d31_60_ore: Number(r.d31_60),
    d61_90_ore: Number(r.d61_90), d90_plus_ore: Number(r.d90_plus), total_ore: Number(r.total),
  }));
  const sum = (k: keyof ApAgingRow) => rows.reduce((s, r) => s + (r[k] as number), 0);
  return {
    as_of: result.rows[0]?.as_of ?? asOf ?? todayIso(),
    rows,
    totals: { not_due_ore: sum('not_due_ore'), d1_30_ore: sum('d1_30_ore'), d31_60_ore: sum('d31_60_ore'), d61_90_ore: sum('d61_90_ore'), d90_plus_ore: sum('d90_plus_ore'), total_ore: sum('total_ore') },
  };
}

export interface MonthlyPoint { ym: string; revenue_ore: Ore; expense_ore: Ore; result_ore: Ore }

/**
 * Intäkt och kostnad per månad för de senaste 12 månaderna (t.o.m. `asOf`,
 * default idag). Nollfyllda månader via generate_series så diagrammet alltid
 * har 12 punkter. Intäkt = kreditsaldo på intäktskonton, kostnad = debetsaldo
 * på kostnadskonton — samma teckenkonvention som resultaträkningen.
 */
export async function monthlyRevenue(client: PoolClient, companyId: string, asOf?: string): Promise<MonthlyPoint[]> {
  const result = await client.query<{ ym: string; revenue_ore: string; expense_ore: string }>(
    `WITH ref AS (SELECT date_trunc('month', COALESCE($2::date, CURRENT_DATE)) AS m0),
     months AS (
       SELECT to_char((SELECT m0 FROM ref) - (n || ' months')::interval, 'YYYY-MM') AS ym
       FROM generate_series(11, 0, -1) AS n
     ),
     agg AS (
       SELECT to_char(date_trunc('month', v.voucher_date), 'YYYY-MM') AS ym,
              sum(CASE WHEN a.account_type = 'revenue' THEN vl.credit_ore - vl.debit_ore ELSE 0 END) AS revenue_ore,
              sum(CASE WHEN a.account_type = 'expense' THEN vl.debit_ore - vl.credit_ore ELSE 0 END) AS expense_ore
       FROM voucher_lines vl
       JOIN vouchers v ON v.id = vl.voucher_id
       LEFT JOIN LATERAL (
         SELECT account_type FROM accounts
         WHERE account_number = vl.account_number AND (company_id = $1 OR company_id IS NULL)
         ORDER BY company_id NULLS LAST LIMIT 1
       ) a ON true
       WHERE vl.company_id = $1
       GROUP BY 1
     )
     SELECT m.ym, COALESCE(g.revenue_ore, 0) AS revenue_ore, COALESCE(g.expense_ore, 0) AS expense_ore
     FROM months m LEFT JOIN agg g ON g.ym = m.ym
     ORDER BY m.ym`,
    [companyId, asOf ?? null],
  );
  return result.rows.map((r) => {
    const revenue = Number(r.revenue_ore);
    const expense = Number(r.expense_ore);
    return { ym: r.ym, revenue_ore: revenue, expense_ore: expense, result_ore: revenue - expense };
  });
}

export interface ArAgingRow {
  customer_id: string;
  customer_name: string;
  not_due_ore: Ore;
  d1_30_ore: Ore;
  d31_60_ore: Ore;
  d61_90_ore: Ore;
  d90_plus_ore: Ore;
  total_ore: Ore;
}
export interface ArAging {
  as_of: string;
  rows: ArAgingRow[];
  totals: Omit<ArAgingRow, 'customer_id' | 'customer_name'>;
}

/**
 * Kundreskontra med åldersanalys: öppna (bokförda, ej annullerade) kundfakturor
 * med kvarvarande skuld, grupperade per kund och hur långt förbi förfallodagen
 * de är, relativt `asOf` (default dagens datum). Beloppet är UTESTÅENDE skuld
 * (total − betalt), så delbetalningar räknas av. Allt inom tenant-gränsen (RLS).
 */
export async function accountsReceivableAging(
  client: PoolClient,
  companyId: string,
  asOf?: string,
): Promise<ArAging> {
  const result = await client.query<{
    customer_id: string; customer_name: string;
    not_due: number; d1_30: number; d31_60: number; d61_90: number; d90_plus: number; total: number;
    as_of: string;
  }>(
    // Utestående = total − betalt (delbetalningar räknas av). Endast bokförda,
    // ej annullerade fakturor med kvarvarande skuld tas med.
    `WITH ref AS (SELECT COALESCE($2::date, CURRENT_DATE) AS d),
     open_inv AS (
       SELECT i.customer_id, i.due_date, (i.total_ore - i.paid_amount_ore) AS outstanding
       FROM invoices i
       WHERE i.company_id = $1 AND i.voucher_id IS NOT NULL
         AND i.status <> 'cancelled' AND i.total_ore > i.paid_amount_ore
     )
     SELECT o.customer_id, c.name AS customer_name,
       sum(CASE WHEN o.due_date >= (SELECT d FROM ref) THEN o.outstanding ELSE 0 END) AS not_due,
       sum(CASE WHEN (SELECT d FROM ref) - o.due_date BETWEEN 1 AND 30 THEN o.outstanding ELSE 0 END) AS d1_30,
       sum(CASE WHEN (SELECT d FROM ref) - o.due_date BETWEEN 31 AND 60 THEN o.outstanding ELSE 0 END) AS d31_60,
       sum(CASE WHEN (SELECT d FROM ref) - o.due_date BETWEEN 61 AND 90 THEN o.outstanding ELSE 0 END) AS d61_90,
       sum(CASE WHEN (SELECT d FROM ref) - o.due_date > 90 THEN o.outstanding ELSE 0 END) AS d90_plus,
       sum(o.outstanding) AS total,
       (SELECT d FROM ref)::text AS as_of
     FROM open_inv o
     JOIN customers c ON c.id = o.customer_id
     GROUP BY o.customer_id, c.name
     ORDER BY total DESC, c.name`,
    [companyId, asOf ?? null],
  );

  const rows: ArAgingRow[] = result.rows.map((r) => ({
    customer_id: r.customer_id,
    customer_name: r.customer_name,
    not_due_ore: Number(r.not_due),
    d1_30_ore: Number(r.d1_30),
    d31_60_ore: Number(r.d31_60),
    d61_90_ore: Number(r.d61_90),
    d90_plus_ore: Number(r.d90_plus),
    total_ore: Number(r.total),
  }));
  const sum = (k: keyof ArAgingRow) => rows.reduce((s, r) => s + (r[k] as number), 0);
  const asOfDate = result.rows[0]?.as_of ?? asOf ?? todayIso();
  return {
    as_of: asOfDate,
    rows,
    totals: {
      not_due_ore: sum('not_due_ore'),
      d1_30_ore: sum('d1_30_ore'),
      d31_60_ore: sum('d31_60_ore'),
      d61_90_ore: sum('d61_90_ore'),
      d90_plus_ore: sum('d90_plus_ore'),
      total_ore: sum('total_ore'),
    },
  };
}

// Likvida konton enligt BAS: 19xx (kassa och bank). Kassaflödet och likviditeten
// mäts som rörelser/saldo på dessa konton — en tillgång som ökar med debet.
const LIQUID_ACCOUNT_MIN = 1900;
const LIQUID_ACCOUNT_MAX = 1999;

export interface CashFlowMonth { ym: string; inflow_ore: Ore; outflow_ore: Ore; net_ore: Ore; closing_ore: Ore }
export interface CashFlow { opening_ore: Ore; months: CashFlowMonth[] }

/**
 * Kassaflöde per månad de senaste 12 månaderna (t.o.m. `asOf`). In = debet på
 * likvida konton (19xx), ut = kredit. Ingående saldo är nettot på 19xx FÖRE
 * fönstrets första månad; utgående saldo ackumuleras månad för månad. Nollfyllt.
 */
export async function cashFlow(client: PoolClient, companyId: string, asOf?: string): Promise<CashFlow> {
  const result = await client.query<{ ym: string | null; opening: string; inflow: string; outflow: string }>(
    `WITH ref AS (SELECT date_trunc('month', COALESCE($2::date, CURRENT_DATE)) AS m0),
     liquid AS (
       SELECT date_trunc('month', v.voucher_date) AS m, vl.debit_ore, vl.credit_ore
       FROM voucher_lines vl JOIN vouchers v ON v.id = vl.voucher_id
       WHERE vl.company_id = $1 AND vl.account_number BETWEEN ${LIQUID_ACCOUNT_MIN} AND ${LIQUID_ACCOUNT_MAX}
     ),
     opening AS (
       SELECT COALESCE(sum(debit_ore - credit_ore), 0) AS opening
       FROM liquid WHERE m < (SELECT m0 FROM ref) - interval '11 months'
     ),
     months AS (
       SELECT (SELECT m0 FROM ref) - (n || ' months')::interval AS m
       FROM generate_series(11, 0, -1) AS n
     ),
     agg AS (
       SELECT m, sum(debit_ore) AS inflow, sum(credit_ore) AS outflow
       FROM liquid GROUP BY m
     )
     SELECT to_char(mo.m, 'YYYY-MM') AS ym, (SELECT opening FROM opening) AS opening,
            COALESCE(a.inflow, 0) AS inflow, COALESCE(a.outflow, 0) AS outflow
     FROM months mo LEFT JOIN agg a ON a.m = mo.m
     ORDER BY mo.m`,
    [companyId, asOf ?? null],
  );
  const opening = result.rows.length ? Number(result.rows[0]!.opening) : 0;
  let running = opening;
  const months: CashFlowMonth[] = result.rows.map((r) => {
    const inflow = Number(r.inflow);
    const outflow = Number(r.outflow);
    const net = inflow - outflow;
    running += net;
    return { ym: r.ym!, inflow_ore: inflow, outflow_ore: outflow, net_ore: net, closing_ore: running };
  });
  return { opening_ore: opening, months };
}

export interface LiquidityBucket { label: string; inflow_ore: Ore; outflow_ore: Ore; net_ore: Ore; projected_ore: Ore }
export interface Liquidity { as_of: string; cash_ore: Ore; buckets: LiquidityBucket[] }

/**
 * Enkel likviditetsprognos: nuvarande kassa (saldo på 19xx per `asOf`) plus
 * väntade inbetalningar (öppna kundfakturor) minus väntade utbetalningar (öppna
 * leverantörsfakturor), grupperade i förfalloperioder. Förfallet-/nu-hinken
 * inkluderar allt t.o.m. asOf. Projected = löpande kassa efter varje hink.
 * Detta är en indikation, inte en utfäst prognos.
 */
export async function liquidityForecast(client: PoolClient, companyId: string, asOf?: string): Promise<Liquidity> {
  const result = await client.query<{
    cash: string; as_of: string;
    in_now: string; in_30: string; in_60: string; in_90: string; in_later: string;
    out_now: string; out_30: string; out_60: string; out_90: string; out_later: string;
  }>(
    `WITH ref AS (SELECT COALESCE($2::date, CURRENT_DATE) AS d),
     cash AS (
       SELECT COALESCE(sum(vl.debit_ore - vl.credit_ore), 0) AS cash
       FROM voucher_lines vl JOIN vouchers v ON v.id = vl.voucher_id
       WHERE vl.company_id = $1 AND vl.account_number BETWEEN ${LIQUID_ACCOUNT_MIN} AND ${LIQUID_ACCOUNT_MAX}
         AND v.voucher_date <= (SELECT d FROM ref)
     ),
     ar AS (
       SELECT i.due_date, (i.total_ore - i.paid_amount_ore) AS amt FROM invoices i
       WHERE i.company_id = $1 AND i.voucher_id IS NOT NULL AND i.status <> 'cancelled' AND i.total_ore > i.paid_amount_ore
     ),
     ap AS (
       SELECT s.due_date, (s.total_ore - s.paid_amount_ore) AS amt FROM supplier_invoices s
       WHERE s.company_id = $1 AND s.voucher_id IS NOT NULL AND s.status <> 'cancelled' AND s.total_ore > s.paid_amount_ore
     )
     SELECT (SELECT cash FROM cash) AS cash, (SELECT d FROM ref)::text AS as_of,
       COALESCE((SELECT sum(amt) FROM ar WHERE due_date <= (SELECT d FROM ref)), 0) AS in_now,
       COALESCE((SELECT sum(amt) FROM ar WHERE due_date - (SELECT d FROM ref) BETWEEN 1 AND 30), 0) AS in_30,
       COALESCE((SELECT sum(amt) FROM ar WHERE due_date - (SELECT d FROM ref) BETWEEN 31 AND 60), 0) AS in_60,
       COALESCE((SELECT sum(amt) FROM ar WHERE due_date - (SELECT d FROM ref) BETWEEN 61 AND 90), 0) AS in_90,
       COALESCE((SELECT sum(amt) FROM ar WHERE due_date - (SELECT d FROM ref) > 90), 0) AS in_later,
       COALESCE((SELECT sum(amt) FROM ap WHERE due_date <= (SELECT d FROM ref)), 0) AS out_now,
       COALESCE((SELECT sum(amt) FROM ap WHERE due_date - (SELECT d FROM ref) BETWEEN 1 AND 30), 0) AS out_30,
       COALESCE((SELECT sum(amt) FROM ap WHERE due_date - (SELECT d FROM ref) BETWEEN 31 AND 60), 0) AS out_60,
       COALESCE((SELECT sum(amt) FROM ap WHERE due_date - (SELECT d FROM ref) BETWEEN 61 AND 90), 0) AS out_90,
       COALESCE((SELECT sum(amt) FROM ap WHERE due_date - (SELECT d FROM ref) > 90), 0) AS out_later`,
    [companyId, asOf ?? null],
  );
  const r = result.rows[0]!;
  const cash = Number(r.cash);
  const defs: Array<[string, number, number]> = [
    ['Förfallet / nu', Number(r.in_now), Number(r.out_now)],
    ['Inom 30 dagar', Number(r.in_30), Number(r.out_30)],
    ['31–60 dagar', Number(r.in_60), Number(r.out_60)],
    ['61–90 dagar', Number(r.in_90), Number(r.out_90)],
    ['Senare', Number(r.in_later), Number(r.out_later)],
  ];
  let projected = cash;
  const buckets: LiquidityBucket[] = defs.map(([label, inflow, outflow]) => {
    const net = inflow - outflow;
    projected += net;
    return { label, inflow_ore: inflow, outflow_ore: outflow, net_ore: net, projected_ore: projected };
  });
  return { as_of: r.as_of, cash_ore: cash, buckets };
}
