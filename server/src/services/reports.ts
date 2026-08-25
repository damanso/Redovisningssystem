import type { PoolClient } from 'pg';
import type { Ore } from '../domain/money.js';
import { formatOre } from '../domain/money.js';
// taxes.ts importerar accountSums härifrån. Cykeln är ofarlig i ESM: båda
// modulerna använder varandra först vid ANROP (hoistade funktionsdeklarationer),
// aldrig under modulutvärderingen. Likviditetens statutära källor är samma tal
// som skatteöversikten visar — de får inte räknas fram en andra gång här.
import {
  CORPORATE_TAX_PERMILLE, agiDueDateForPeriod, taxOverview, unpaidPayrollPeriods, type TaxDeadline,
} from './taxes.js';

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
       -- Vid ROT/RUT är KUNDENS skuld total − skattereduktion (resten är fordran
       -- på Skatteverket, inte på kunden) → dra av avdraget ur kundens utestående.
       SELECT i.customer_id, i.due_date,
              (i.total_ore - i.housework_reduction_ore - i.paid_amount_ore) AS outstanding
       FROM invoices i
       WHERE i.company_id = $1 AND i.voucher_id IS NOT NULL
         AND i.status <> 'cancelled' AND (i.total_ore - i.housework_reduction_ore) > i.paid_amount_ore
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

/**
 * Status per källa. Sätts UTESLUTANDE av kod ur frågeresultat — aldrig av en
 * modell, aldrig ur fritext som tolkas i efterhand:
 * - `MODELLERAD`         beloppet ligger i en hink ovan och påverkar prognosen.
 * - `TOM`                källan finns men saknar rader/saldo per `as_of`.
 * - `KAND_EJ_MODELLERAD` beloppet är känt men läggs medvetet inte i någon hink.
 * - `KAND_EJ_DATERAD`    beloppet är känt men saknar förfallodag. Det läggs INTE
 *                        i "Senare" — "Senare" betyder daterad > 90 dagar, och
 *                        ett odaterat belopp där vore falsk precision.
 * - `AVVIKELSE`          två tal om samma sak går isär och måste stämmas av.
 */
export type LiquiditySourceStatus = 'MODELLERAD' | 'TOM' | 'KAND_EJ_MODELLERAD' | 'KAND_EJ_DATERAD' | 'AVVIKELSE';

/** En känd in- eller utflödeskälla och dess plats i (eller utanför) prognosen. */
export interface LiquiditySource {
  id: string;
  side: 'in' | 'out';
  status: LiquiditySourceStatus;
  amount_ore: Ore | null;
  due_date: string | null;
  note: string;
}

export interface Liquidity { as_of: string; cash_ore: Ore; buckets: LiquidityBucket[]; sources: LiquiditySource[] }

/**
 * En del av ett statutärt belopp som har en egen period och en egen förfallodag.
 * Statutära skulder är inte ett belopp med ett datum: AGI:n består av en post per
 * obetald löneperiod, och perioderna kan ha passerat sina förfallodagar. Delarna
 * bucketas var för sig — summan av dem är källans belopp i `sources`.
 */
interface StatutoryPart { period_label: string; amount: Ore; due_date: string | null; label: string }

const LIQUIDITY_BUCKET_LABELS = ['Förfallet / nu', 'Inom 30 dagar', '31–60 dagar', '61–90 dagar', 'Senare'] as const;

/**
 * DUBBELRÄKNINGSREGELN, i kod och inte bara i ett test: de här kontointervallen
 * ingår REDAN i de belopp `taxLiability` räknar fram och som bucketas som moms
 * respektive AGI. Ett saldo i intervallet får därför aldrig samtidigt bli en
 * egen källa ur voucher_lines — varje utflödeskrona hör till exakt EN källa i
 * `sources`. Vakten nedan körs vid varje anrop: den som lägger till en källa som
 * överlappar får ett fel direkt, inte en prognos som är fel åt fel håll.
 */
const CLAIMED_BY_TAX_LIABILITY: ReadonlyArray<{ from: number; to: number; source: string }> = [
  { from: 2600, to: 2699, source: 'moms' },
  { from: 2710, to: 2719, source: 'agi' },
  { from: 2730, to: 2739, source: 'agi' },
];

/**
 * Kreditsaldo (kredit − debet) för ett kontointervall, med dubbelräkningsvakt.
 *
 * Exporterad enbart för att vakten ska kunna bevisas direkt i test: den är den
 * mekanism som ska hindra det farligaste felet (samma krona i två källor), och
 * en mekanism som bara skyddas indirekt av en summalikhet är oprövad.
 */
export function unclaimedCreditBalance(
  balance: AccountLine[], from: number, to: number, sourceId: string,
): { amount_ore: Ore; accounts: number[] } {
  const clash = CLAIMED_BY_TAX_LIABILITY.find((c) => from <= c.to && to >= c.from);
  if (clash) {
    throw new Error(
      `liquidityForecast: konto ${from}–${to} (källan "${sourceId}") ingår redan i källan "${clash.source}" — dubbelräkning`,
    );
  }
  const rows = balance.filter((b) => b.account_number >= from && b.account_number <= to);
  return {
    amount_ore: rows.reduce((s, b) => s + (b.credit_ore - b.debit_ore), 0),
    accounts: rows.filter((b) => b.credit_ore !== b.debit_ore).map((b) => b.account_number),
  };
}

/** Hinkindex för en förfallodag — samma gränser som SQL:ens BETWEEN-intervall. */
function liquidityBucketIndex(asOf: string, dueDate: string): number {
  const days = Math.round((Date.parse(`${dueDate}T00:00:00Z`) - Date.parse(`${asOf}T00:00:00Z`)) / 86_400_000);
  if (days <= 0) return 0;
  if (days <= 30) return 1;
  if (days <= 60) return 2;
  if (days <= 90) return 3;
  return 4;
}

// Tolerans för jämförelsen mellan taxLiability.total_ore och komponentbeloppen:
// 1 000 kr. Under den nivån är skillnaden avrundning, över den är den ett fynd.
const TAX_COMPARISON_TOLERANCE_ORE = 100_000;

/**
 * Likviditetsprognos: nuvarande kassa (saldo på 19xx per `asOf`) plus väntade
 * inbetalningar (öppna kundfakturor, ROT/RUT-avdraget avräknat) minus väntade
 * utbetalningar, grupperade i förfalloperioder. Förfallet-/nu-hinken inkluderar
 * allt t.o.m. asOf. Projected = löpande kassa efter varje hink.
 *
 * UTFLÖDESSIDAN ÄR INTE BARA LEVERANTÖRSFAKTUROR. Den hämtades förut enbart ur
 * `supplier_invoices`; i ett bolag som inte registrerar leverantörsfakturor stod
 * hela utflödessidan på noll trots kända skulder i bokföringen. Nu bucketas även
 * de statutära skulderna — momsnetto (26xx) och AGI (saldot på 2710/2730,
 * placerat per obetald löneperiod) — mot sina förfallodagar ur `taxDeadlines`.
 *
 * Svaret bär sin egen källredovisning i `sources`: VARJE känd källa listas med
 * status, belopp och skäl, även när den är tom eller medvetet inte modellerad.
 * En nolla i en hink ska aldrig kunna läsas som "inget att betala" när den i
 * själva verket betyder "den här källan modelleras inte".
 *
 * Detta är en indikation, inte en utfäst prognos.
 */
export async function liquidityForecast(client: PoolClient, companyId: string, asOf?: string): Promise<Liquidity> {
  const result = await client.query<{
    cash: string; as_of: string; ar_rows: string; ap_rows: string;
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
       -- Kundens del vid ROT/RUT = total − skattereduktion (resten fås från Skatteverket).
       SELECT i.due_date, (i.total_ore - i.housework_reduction_ore - i.paid_amount_ore) AS amt FROM invoices i
       WHERE i.company_id = $1 AND i.voucher_id IS NOT NULL AND i.status <> 'cancelled'
         AND (i.total_ore - i.housework_reduction_ore) > i.paid_amount_ore
     ),
     ap AS (
       SELECT s.due_date, (s.total_ore - s.paid_amount_ore) AS amt FROM supplier_invoices s
       WHERE s.company_id = $1 AND s.voucher_id IS NOT NULL AND s.status <> 'cancelled' AND s.total_ore > s.paid_amount_ore
     )
     SELECT (SELECT cash FROM cash) AS cash, (SELECT d FROM ref)::text AS as_of,
       -- Antal rader, inte bara summan: en källa med noll RADER (obevakad) ska
       -- gå att skilja från en källa vars rader summerar till noll.
       (SELECT count(*) FROM ar) AS ar_rows, (SELECT count(*) FROM ap) AS ap_rows,
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
  const asOfDate = r.as_of;
  // Inflödessidan är oförändrad (kundfakturor inkl. ROT/RUT-avdrag). Utflödena
  // startar i leverantörsreskontran och fylls på med de statutära källorna nedan.
  const inflows = [Number(r.in_now), Number(r.in_30), Number(r.in_60), Number(r.in_90), Number(r.in_later)];
  const outflows = [Number(r.out_now), Number(r.out_30), Number(r.out_60), Number(r.out_90), Number(r.out_later)];

  const sources: LiquiditySource[] = [];

  // ---- Reskontrakällorna (redan modellerade i SQL:en ovan) ------------------
  const arRows = Number(r.ar_rows);
  const apRows = Number(r.ap_rows);
  sources.push({
    id: 'kundfakturor',
    side: 'in',
    status: arRows === 0 ? 'TOM' : 'MODELLERAD',
    amount_ore: inflows.reduce((s, v) => s + v, 0),
    due_date: null,
    note: arRows === 0
      ? 'Inga öppna kundfakturor per as_of.'
      : `${arRows} öppna kundfakturor, fördelade på hinkarna efter förfallodag (ROT/RUT-avdraget är avräknat — den delen kommer från Skatteverket).`,
  });
  sources.push({
    id: 'leverantorsfakturor',
    side: 'out',
    status: apRows === 0 ? 'TOM' : 'MODELLERAD',
    amount_ore: outflows.reduce((s, v) => s + v, 0),
    due_date: null,
    note: apRows === 0
      ? 'Inga öppna leverantörsfakturor är registrerade. Nollan betyder att underlag saknas — inte att det inte finns något att betala; kända skulder ur bokföringen redovisas som egna källor nedan.'
      : `${apRows} öppna leverantörsfakturor, fördelade på hinkarna efter förfallodag.`,
  });

  // ---- Statutära källor: moms och AGI ur bokföringen ------------------------
  // Samma tal som skatteöversikten visar, bucketade mot förfallodagen för DEN
  // PERIOD beloppet avser — inte mot nästa gemensamma förfallodag. Skillnaden är
  // inte akademisk: fyra obetalda lönebesked mot nästa AGI-datum lägger 124 tkr
  // försenad skatt i "Inom 30 dagar" och lämnar "Förfallet / nu" på noll. En hink
  // som heter "Förfallet / nu" och står på noll ÄR ett besked, och det beskedet
  // vore falskt. En period vars förfallodag passerat hamnar därför i hink 0.
  const tax = await taxOverview(client, companyId, asOfDate);
  const balance = await accountSums(client, companyId, { to: asOfDate });
  const nextDeadline = (type: string): TaxDeadline | undefined =>
    tax.deadlines.find((d) => d.type === type && d.due_date >= asOfDate);

  // AGI: SKULDEN är saldot på 2710/2730 (`agi_total_ore`) — de obetalda
  // lönebeskeden säger bara VAR I TIDEN den ligger. Under bruttometoden skuldför
  // lönen 2710/2730 och skattekontobetalningen betalar av dem, så att lägga
  // periodernas belopp OVANPÅ saldot vore att räkna varje lön två gånger
  // (`taxLiability` gjorde det före 2026-08-25).
  //
  // Fördelningen sker därför UR saldot, i förfallodagsordning (äldst först): en
  // period kan aldrig lägga mer i en hink än vad kontona faktiskt bär. Det som
  // blir över saknar period (SIE-import, manuella verifikat) och läggs mot nästa
  // kommande AGI-förfallodag. Det som saldot INTE räcker till redovisas i noten i
  // stället för att bucketas — en period som lönebeskedet säger är obetald men
  // som kontona inte bär betyder att lönen bokförts utanför bruttometoden eller
  // att en betalning saknar sin `payroll_tax_payments`-rad. Att då lägga ett
  // NEGATIVT belopp i en framtida hink hade tyst kvittat bort en verklig skuld.
  const unpaidPeriods = await unpaidPayrollPeriods(client, companyId, asOfDate);
  const agiParts: StatutoryPart[] = [];
  const agiUnfunded: string[] = [];
  let agiRemaining = Math.max(0, tax.liability.agi_total_ore);
  for (const p of unpaidPeriods) {
    const want = p.tax_ore + p.employer_contribution_ore;
    const take = Math.min(want, agiRemaining);
    agiRemaining -= take;
    if (take > 0) {
      agiParts.push({
        period_label: p.period,
        amount: take,
        due_date: agiDueDateForPeriod(p.period),
        label: 'Arbetsgivardeklaration (skatt + avgifter)',
      });
    }
    if (take < want) agiUnfunded.push(`${p.period}: ${formatOre(want - take, { currency: true })}`);
  }
  if (agiRemaining > 0) {
    const next = nextDeadline('agi');
    agiParts.push({
      period_label: `kontosaldo 2710/2730 utan löneperiod${next ? `, redovisas ${next.period_label}` : ', ingen period'}`,
      amount: agiRemaining,
      due_date: next?.due_date ?? null,
      label: 'Arbetsgivardeklaration (skatt + avgifter)',
    });
  }
  agiParts.sort((a, b) => (a.due_date ?? '9999-12-31').localeCompare(b.due_date ?? '9999-12-31'));
  const AGI_UNFUNDED_NOTE = agiUnfunded.length === 0 ? '' : ` OBS: lönebeskeden för ${agiUnfunded.join('; ')} saknar bokförd skattekontobetalning, men saldot på 2710/2730 räcker inte till dem. Skillnaden bucketas INTE (den skulden syns inte i kontona). Vanligaste orsaken: lönen är bokförd utanför bruttometoden, eller så saknar en redan gjord betalning sin rad i payroll_tax_payments — registrera den med book_payroll_tax mot dess befintliga verifikat.`;

  // MOMS: kan ett momsnetto avse en period vars förfallodag redan passerat?
  // I SAK JA — men systemet kan inte MÄTA vilken del, och därför delas det inte
  // upp. Skälet, så att nästa läsare slipper räkna ut det en gång till: momsnettot
  // är saldot på 26xx, löpande konton utan periodmärkning. Till skillnad från
  // AGI:n finns ingen bokförd avräkning per momsperiod (repot bokför ingen
  // momsredovisning mot 2650 — `vat_report` är en ren läsrapport), så en period
  // som redan är deklarerad och betald hos Skatteverket ser i bokföringen exakt
  // likadan ut som en period som aldrig redovisats. Att dela saldot på
  // verifikatsdatum vore därför en gissning, inte en mätning, och den skulle
  // systematiskt överdriva det förfallna. Linsprincipen (KRAV-3) säger att status
  // sätts ur frågeresultat, aldrig ur en modell: hela nettot läggs mot nästa
  // momsförfallodag och noten säger rakt ut vad det innebär. Den dag en avräkning
  // per period bokförs (2650) kan momsen behandlas precis som AGI:n ovan.
  const vatDeadline = nextDeadline('vat');
  const vatParts: StatutoryPart[] = tax.liability.vat_payable_ore > 0
    ? [{
        period_label: vatDeadline?.period_label ?? 'ingen period inom horisonten',
        amount: tax.liability.vat_payable_ore,
        due_date: vatDeadline?.due_date ?? null,
        label: vatDeadline?.label ?? 'Momsdeklaration',
      }]
    : [];
  const VAT_UNSETTLED_NOTE = ' Momsnettot är ett kontosaldo utan periodmärkning: innehåller det ännu ej redovisade äldre perioder ligger en del av beloppet i praktiken redan förfallet — bokföringen visar inte vilken del, så hela nettot ställs mot nästa förfallodag.';

  // `extra` gäller bara den bucketade texten. `warning` är ett fynd om KÄLLAN
  // och måste följa med i ALLA statuslägen — den behövs som mest när saldot är
  // noll men lönebeskeden säger att något är obetalt.
  const statutory: Array<{ id: string; total: Ore; parts: StatutoryPart[]; what: string; extra: string; warning: string }> = [
    {
      id: 'moms',
      total: tax.liability.vat_payable_ore,
      parts: vatParts,
      what: 'Momsnetto (utgående − ingående moms, konto 26xx)',
      extra: VAT_UNSETTLED_NOTE,
      warning: '',
    },
    {
      id: 'agi',
      total: tax.liability.agi_total_ore,
      parts: agiParts,
      what: 'Personalens källskatt + arbetsgivaravgifter (saldot på konto 2710/2730, placerat per löneperiod)',
      extra: '',
      warning: AGI_UNFUNDED_NOTE,
    },
  ];

  let bucketedStatutoryOre = 0;
  for (const s of statutory) {
    const dated = s.parts.filter((p) => p.due_date !== null);
    const undatedOre = s.parts.filter((p) => p.due_date === null).reduce((sum, p) => sum + p.amount, 0);
    if (s.total === 0) {
      sources.push({ id: s.id, side: 'out', status: 'TOM', amount_ore: 0, due_date: null, note: `${s.what}: inget saldo per as_of.${s.warning}` });
    } else if (s.total < 0) {
      // Ett negativt netto är en FORDRAN. Den läggs medvetet inte som inflöde:
      // återbetalningens tidpunkt bestäms av Skatteverket, inte av oss.
      sources.push({
        id: s.id, side: 'out', status: 'KAND_EJ_MODELLERAD', amount_ore: s.total, due_date: null,
        note: `${s.what}: negativt netto, alltså en fordran på ${formatOre(-s.total, { currency: true })}. Läggs inte som inflöde i någon hink — utbetalningstidpunkten bestäms av Skatteverket.${s.warning}`,
      });
    } else if (dated.length === 0) {
      sources.push({
        id: s.id, side: 'out', status: 'KAND_EJ_DATERAD', amount_ore: s.total, due_date: null,
        note: `${s.what}: ${formatOre(s.total, { currency: true })} att betala, men ingen förfallodag ligger inom prognosens horisont (taxDeadlines, momsperiod "${tax.vat_period}"). Läggs därför inte i någon hink — inte heller i "Senare".${s.warning}`,
      });
    } else {
      // Varje del mot SIN egen förfallodag. Noten redovisar uppdelningen med
      // belopp och datum per period, så att källans belopp går att härleda ur den.
      const placed = dated.map((p) => {
        const idx = liquidityBucketIndex(asOfDate, p.due_date!);
        outflows[idx] = (outflows[idx] ?? 0) + p.amount;
        return { ...p, idx };
      });
      const bucketed = placed.reduce((sum, p) => sum + p.amount, 0);
      bucketedStatutoryOre += bucketed;
      const overdueOre = placed.filter((p) => p.idx === 0).reduce((sum, p) => sum + p.amount, 0);
      const breakdown = placed
        .map((p) => `period ${p.period_label}: ${formatOre(p.amount, { currency: true })} med förfallodag ${p.due_date} → hinken "${LIQUIDITY_BUCKET_LABELS[p.idx]}"`)
        .join('; ');
      const head = placed.length === 1
        ? `${s.what}: ${formatOre(bucketed, { currency: true })} ligger i hinken "${LIQUIDITY_BUCKET_LABELS[placed[0]!.idx]}" mot förfallodagen ${placed[0]!.due_date} (${placed[0]!.label}, period ${placed[0]!.period_label}).`
        : `${s.what}: ${formatOre(bucketed, { currency: true })} fördelat på ${placed.length} perioder, var och en mot SIN EGEN förfallodag. Uppdelning: ${breakdown}.`;
      const overdue = overdueOre > 0
        ? ` Varav ${formatOre(overdueOre, { currency: true })} redan är FÖRFALLET (hinken "Förfallet / nu") — förfallodagen har passerat per as_of.`
        : '';
      const rest = undatedOre !== 0
        ? ` Utöver det ${formatOre(undatedOre, { currency: true })} utan förfallodag inom horisonten — det läggs inte i någon hink och ingår inte i beloppet ovan.`
        : '';
      sources.push({
        id: s.id, side: 'out', status: 'MODELLERAD', amount_ore: bucketed,
        // Fältet bär den TIDIGASTE förfallodagen; hela beloppet förfaller inte
        // nödvändigtvis samtidigt — noten redovisar varje periods datum.
        due_date: placed.map((p) => p.due_date!).sort()[0]!,
        note: `${head}${overdue}${rest}${s.extra}${s.warning}${placed.length > 1 ? ' Fältet due_date är den tidigaste av dem.' : ''} Vägledande datum — helg-/helgdagsförskjutning beräknas inte.`,
      });
    }
  }

  // ---- Kända belopp som medvetet INTE bucketas -----------------------------
  sources.push({
    id: 'bolagsskatt',
    side: 'out',
    status: 'KAND_EJ_MODELLERAD',
    amount_ore: tax.liability.estimated_corporate_tax_ore,
    due_date: null,
    note: `Uppskattad bolagsskatt (${String(CORPORATE_TAX_PERMILLE / 10).replace('.', ',')} % av resultat före skatt ${formatOre(tax.liability.result_before_tax_ore, { currency: true })}). En uppskattning utan fast förfallodag inom horisonten — den bucketas därför inte. Den slutliga skatten fastställs vid deklarationen.`,
  });

  const semester = unclaimedCreditBalance(balance, 2920, 2920, 'semesterloner_2920');
  sources.push({
    id: 'semesterloner_2920',
    side: 'out',
    status: semester.amount_ore === 0 ? 'TOM' : 'KAND_EJ_DATERAD',
    amount_ore: semester.amount_ore,
    due_date: null,
    note: semester.amount_ore === 0
      ? 'Konto 2920 (upplupna semesterlöner) har inget saldo per as_of.'
      : `Upplupna semesterlöner (konto 2920): ${formatOre(semester.amount_ore, { currency: true })}. Skulden är känd men saknar förfallodag — den betalas när semestern tas ut eller vid slutlön. Läggs varken i en hink eller i "Senare".`,
  });

  const other = unclaimedCreditBalance(balance, 2890, 2899, 'ovriga_kortfristiga_2890');
  sources.push({
    id: 'ovriga_kortfristiga_2890',
    side: 'out',
    status: other.amount_ore === 0 ? 'TOM' : 'KAND_EJ_DATERAD',
    amount_ore: other.amount_ore,
    due_date: null,
    note: other.amount_ore === 0
      ? 'Konto 289x (övriga kortfristiga skulder, inkl. 2893) har inget saldo per as_of.'
      : `Övriga kortfristiga skulder, konto ${other.accounts.join(' + ')}: ${formatOre(other.amount_ore, { currency: true })}. Kända belopp utan förfallodag — läggs varken i en hink eller i "Senare".`,
  });

  const skattekonto = unclaimedCreditBalance(balance, 2510, 2510, 'skattekonto_2510');
  sources.push({
    id: 'skattekonto_2510',
    side: 'out',
    status: skattekonto.amount_ore === 0 ? 'TOM' : 'KAND_EJ_MODELLERAD',
    amount_ore: skattekonto.amount_ore,
    due_date: null,
    note: skattekonto.amount_ore === 0
      ? 'Konto 2510 (skattekonto) har inget saldo per as_of.'
      : skattekonto.amount_ore < 0
        ? `Konto 2510 har ett DEBETsaldo på ${formatOre(-skattekonto.amount_ore, { currency: true })} — redan inbetald preliminärskatt, alltså en fordran på Skatteverket. Att bucketa den som utflöde vore dubbelräkning mot källan "bolagsskatt".`
        : `Konto 2510 (skattekonto) har ett kreditsaldo på ${formatOre(skattekonto.amount_ore, { currency: true })}. Bokförda skattekontotransaktioner mäter något annat än den upplupna skulden ovan (moms/AGI/bolagsskatt) och bucketas inte — annars räknas samma krona två gånger.`,
  });

  // ---- Avstämning: hur mycket av skatteskulden ligger utanför hinkarna? -----
  // Avvikelsen mäter INTE att två tal skulle vara felräknade. Den mäter hur
  // mycket av den upplupna skatteskulden (taxLiability.total_ore) som prognosen
  // INTE har modellerat i någon hink. Ett känt men odaterat belopp — helårsmoms
  // vars förfallodag ligger utanför horisonten, t.ex. — ger fullt utslag här
  // trots att båda talen stämmer. Noten måste därför beskriva vad differensen
  // är, inte påstå att talen går isär; annars blir den permanent AVVIKELSE med
  // fel förklaring för varje helårsmomsbolag. Att tyst välja ett av talen vore
  // ändå fel: skillnaden ska synas.
  const componentSumOre = bucketedStatutoryOre + tax.liability.estimated_corporate_tax_ore;
  const deviationOre = tax.liability.total_ore - componentSumOre;
  if (Math.abs(deviationOre) > TAX_COMPARISON_TOLERANCE_ORE) {
    sources.push({
      id: 'skatteskuld_jamforelse',
      side: 'out',
      status: 'AVVIKELSE',
      amount_ore: deviationOre,
      due_date: null,
      note: `Del av skatteskulden som INTE ligger i någon hink: den upplupna skatteskulden taxLiability.total_ore = ${tax.liability.total_ore} öre (${formatOre(tax.liability.total_ore, { currency: true })}), medan de källor prognosen faktiskt MODELLERAR (bucketad moms + AGI) + uppskattad bolagsskatt = ${componentSumOre} öre (${formatOre(componentSumOre, { currency: true })}). Skillnad ${deviationOre} öre (${formatOre(deviationOre, { currency: true })}). Det betyder inte med automatik att något är felräknat: ett belopp som är känt men odaterat (status KAND_EJ_DATERAD ovan) står kvar i skulden utan att ligga i en hink och ger fullt utslag här. Läs raderna ovan för att se vilken källa differensen sitter i. Prognosen räknar vidare på bokföringens komponentbelopp — skillnaden ska stämmas av, inte döljas.`,
    });
  }

  let projected = cash;
  const buckets: LiquidityBucket[] = LIQUIDITY_BUCKET_LABELS.map((label, i) => {
    const inflow = inflows[i]!;
    const outflow = outflows[i]!;
    const net = inflow - outflow;
    projected += net;
    return { label, inflow_ore: inflow, outflow_ore: outflow, net_ore: net, projected_ore: projected };
  });
  return { as_of: asOfDate, cash_ore: cash, buckets, sources };
}
