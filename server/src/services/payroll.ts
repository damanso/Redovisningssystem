// Fas A14 + K1: lön & HR. Anställda + lönebesked. En lönekörning beräknar
// brutto, preliminärskatt och arbetsgivaravgifter, och bokför. Skatten slås
// primärt upp i Skatteverkets tabell 30 (årsversionerad, se domain/taxTable30);
// den anställdas platta tax_rate är fallback utanför tabellintervallet, och en
// manuell jämkning per lönebesked går alltid före. Belopp i heltal ören.
import type { PoolClient } from 'pg';
import { bankDayOnOrBefore, defaultPaymentDate } from '../domain/bankdays.js';
import { historicalTaxOre, table30TaxOre } from '../domain/taxTable30.js';
import { BadRequestError, ConflictError, NotFoundError } from '../lib/errors.js';
import { resolveFiscalYearForDate } from './accounting/fiscalYears.js';
import { postVoucher, type VoucherLineInput } from './accounting/vouchers.js';
import { writeAudit } from './auditService.js';

// Standardkonton (BAS) för lön enligt BRUTTOMETODEN (2026-08-25, överlämning
// #15). Hela BRUTTOLÖNEN är personalkostnaden och kostnadsförs vid
// utbetalningen; de delar som ska vidare till Skatteverket skuldförs i stället
// för att försvinna: källskatten på 2710, arbetsgivaravgiften på 2730 med sin
// kostnad på 7510. Skattekontobetalningen månaden efter BETALAR AV de skulderna
// (2710/2730 debet), den skapar dem inte.
//
// Varför inte kontantmetoden som stod här förut: den debiterade 7010 med NETTOT
// och lade betalningen på 2510. Resultatet var att personalkostnaden var
// understated med exakt skatt + avgift (185 839,80 kr för 2026-03…08), att 7510
// saknades helt i råbalansen, och att K2-årsredovisningen, INK2 och
// likviditetsprognosen läste vidare på de talen. Kontantmetoden är en momsmetod
// (`companies.vat_method`) — den har aldrig gällt lönebokföringen.
const SALARY_EXPENSE = 7010;                   // Löner till tjänstemän (bruttolön)
const EMPLOYER_CONTRIBUTION_EXPENSE = 7510;    // Lagstadgade sociala avgifter (kostnad)
const BANK_ACCOUNT = 1930;                     // Företagskonto
const EMPLOYEE_TAX_LIABILITY = 2710;           // Personalskatt (avdragen källskatt att betala)
const EMPLOYER_CONTRIBUTION_LIABILITY = 2730;  // Lagstadgade sociala avgifter (skuld)

// Arbetsgivaravgift i promille (31,42 % = 3142). En förenkling: full avgift;
// nedsättningar (t.ex. för unga/regionalt) hanteras inte.
export const EMPLOYER_CONTRIBUTION_PERMILLE = 3142;

// Semesterersättning enligt semesterlagens procentregel.
export const VACATION_PAY_PERMILLE = 1200; // 12 %

/**
 * Släpper konteringsrader utan belopp. En jämkning till 0 kr skatt ska inte ge
 * en rad där varken debet eller kredit är positiv — postVoucher avvisar den, och
 * felet skulle vara obegripligt för den som bara godkände en lön.
 */
const nonZero = (lines: VoucherLineInput[]): VoucherLineInput[] =>
  lines.filter((l) => (l.debit_ore ?? 0) > 0 || (l.credit_ore ?? 0) > 0);

export interface CreateEmployeeInput {
  name: string; personnummer?: string; email?: string;
  monthly_salary_ore: number; tax_rate?: number; employment_type?: string;
}

/** Beräknar lönekomponenterna för ett bruttobelopp och en skattesats (%). */
export function computePayroll(grossOre: number, taxRatePercent: number): {
  gross_ore: number; tax_ore: number; net_ore: number; employer_contribution_ore: number;
} {
  const tax = Math.round((grossOre * taxRatePercent) / 100);
  const net = grossOre - tax;
  const employer = Math.round((grossOre * EMPLOYER_CONTRIBUTION_PERMILLE) / 10000);
  return { gross_ore: grossOre, tax_ore: tax, net_ore: net, employer_contribution_ore: employer };
}

export type TaxSource = 'flat_rate' | 'table30' | 'manual' | 'historical';

/**
 * Preliminärskatt för ett lönebesked, i prioritetsordning:
 *   1. Historiskt faktiskt avdrag för perioden (Tillägg 1: perioder som
 *      betalades med ett äldre års tabellvärde ska spegla vad som hände —
 *      bank + huvudbok — och aldrig räknas om retroaktivt).
 *   2. Tabell 30 för utbetalningsårets tabell.
 *   3. Den anställdas platta sats (fallback utanför tabellintervallet).
 */
export function computePayslipTax(
  grossOre: number, year: number, fallbackRatePercent: number, period?: string,
): { tax_ore: number; tax_source: TaxSource } {
  if (period !== undefined) {
    const historical = historicalTaxOre(period, grossOre);
    if (historical !== null) return { tax_ore: historical, tax_source: 'historical' };
  }
  const tableTax = table30TaxOre(year, grossOre);
  if (tableTax !== null) return { tax_ore: tableTax, tax_source: 'table30' };
  return { tax_ore: Math.round((grossOre * fallbackRatePercent) / 100), tax_source: 'flat_rate' };
}

export async function createEmployee(
  client: PoolClient, companyId: string, userId: string, input: CreateEmployeeInput,
): Promise<Record<string, unknown>> {
  if (input.monthly_salary_ore < 0) throw new BadRequestError('invalid_salary', 'lön kan inte vara negativ');
  const r = await client.query<{ id: string }>(
    `INSERT INTO employees (company_id, name, personnummer, email, monthly_salary_ore, tax_rate, employment_type, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [companyId, input.name, input.personnummer ?? null, input.email ?? null,
      input.monthly_salary_ore, input.tax_rate ?? 30, input.employment_type ?? 'tillsvidare', userId],
  );
  const id = r.rows[0]!.id;
  await writeAudit(client, { companyId, userId, action: 'employee.created', entityType: 'employee', entityId: id, details: { name: input.name } });
  return getEmployee(client, companyId, id);
}

export async function getEmployee(client: PoolClient, companyId: string, id: string): Promise<Record<string, unknown>> {
  const r = await client.query(
    `SELECT id, name, personnummer, email, monthly_salary_ore, tax_rate, employment_type, active
     FROM employees WHERE id = $1 AND company_id = $2`, [id, companyId],
  );
  if (!r.rows[0]) throw new NotFoundError('employee');
  return r.rows[0];
}

export async function listEmployees(
  client: PoolClient, companyId: string, opts: { active?: boolean } = {},
): Promise<Record<string, unknown>[]> {
  const r = await client.query(
    `SELECT id, name, email, monthly_salary_ore, tax_rate, employment_type, active
     FROM employees WHERE company_id = $1 AND ($2::boolean IS NULL OR active = $2)
     ORDER BY active DESC, name`,
    [companyId, opts.active ?? null],
  );
  return r.rows;
}

export async function setEmployeeActive(
  client: PoolClient, companyId: string, userId: string, id: string, active: boolean,
): Promise<Record<string, unknown>> {
  const r = await client.query('UPDATE employees SET active = $3 WHERE id = $1 AND company_id = $2 RETURNING id', [id, companyId, active]);
  if (!r.rows[0]) throw new NotFoundError('employee');
  await writeAudit(client, { companyId, userId, action: 'employee.set_active', entityType: 'employee', entityId: id, details: { active } });
  return getEmployee(client, companyId, id);
}

/**
 * Skapar ett lönebesked (utkast) för en anställd och period. Bokför inget.
 * - Utbetalningsdatum: angivet, annars den 25:e i perioden med bankdagsregeln.
 * - Semesterersättning (valbar): include_vacation_pay → 12 % av grundlönen,
 *   eller ett eget kronbelopp via vacation_pay_ore. Skattepliktig — höjer
 *   underlaget för både skatt och arbetsgivaravgift.
 * - Skatten: manuell jämkning (tax_ore) > tabell 30 för utbetalningsårets
 *   tabell > platt sats. Pension är förberedd i datamodellen men avstängd
 *   (beslut 2026-06-30) — ingen beräkning görs.
 */
export async function createPayslip(
  client: PoolClient, companyId: string, userId: string,
  input: {
    employee_id: string; period: string; gross_ore?: number; tax_ore?: number;
    payment_date?: string; vacation_pay_ore?: number; include_vacation_pay?: boolean;
  },
): Promise<Record<string, unknown>> {
  if (!/^\d{4}-\d{2}$/.test(input.period)) throw new BadRequestError('bad_period', 'period ska vara YYYY-MM');
  const emp = await client.query<{ monthly_salary_ore: string; tax_rate: number; active: boolean }>(
    'SELECT monthly_salary_ore, tax_rate, active FROM employees WHERE id = $1 AND company_id = $2', [input.employee_id, companyId],
  );
  if (!emp.rows[0]) throw new NotFoundError('employee');
  const base = input.gross_ore ?? Number(emp.rows[0].monthly_salary_ore);
  if (base <= 0) throw new BadRequestError('no_salary', 'bruttolön saknas');
  const vacation = input.vacation_pay_ore
    ?? (input.include_vacation_pay ? Math.round((base * VACATION_PAY_PERMILLE) / 10000) : 0);
  const gross = base + vacation;
  const paymentDate = input.payment_date ?? defaultPaymentDate(input.period);
  const year = Number(paymentDate.slice(0, 4));
  let taxOre: number;
  let taxSource: TaxSource;
  if (input.tax_ore !== undefined) {
    taxOre = input.tax_ore;
    taxSource = 'manual';
  } else {
    ({ tax_ore: taxOre, tax_source: taxSource } = computePayslipTax(gross, year, emp.rows[0].tax_rate, input.period));
  }
  if (taxOre > gross) throw new BadRequestError('invalid_tax', 'skatten kan inte överstiga bruttolönen');
  const net = gross - taxOre;
  const employer = Math.round((gross * EMPLOYER_CONTRIBUTION_PERMILLE) / 10000);
  let id: string;
  try {
    const r = await client.query<{ id: string }>(
      `INSERT INTO payslips (company_id, employee_id, period, gross_ore, tax_ore, net_ore, employer_contribution_ore, tax_source, payment_date, vacation_pay_ore, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
      [companyId, input.employee_id, input.period, gross, taxOre, net, employer, taxSource, paymentDate, vacation, userId],
    );
    id = r.rows[0]!.id;
  } catch (err) {
    if ((err as { code?: string }).code === '23505') throw new ConflictError('duplicate_payslip', 'lönebesked finns redan för perioden');
    throw err;
  }
  await writeAudit(client, { companyId, userId, action: 'payslip.created', entityType: 'payslip', entityId: id, details: { period: input.period, tax_source: taxSource, payment_date: paymentDate } });
  return getPayslip(client, companyId, id);
}

/**
 * K1-migrering (inkl. Tillägg 1): räknar om preliminärskatten på OBOKADE
 * utkast. Två regler: perioder med dokumenterat historiskt avdrag (2026-03…06:
 * 13 360 på 56 500 — vad som faktiskt betalades enligt bank + huvudbok) sätts
 * till de värdena; övriga får tabell 30 för utbetalningsåret (platt sats som
 * fallback). Idempotent — säker att köra flera gånger. Bokförda/annullerade
 * poster och manuella jämkningar rörs aldrig. Returnerar ändrade rader.
 */
export async function recalculateDraftPayslips(
  client: PoolClient, companyId: string, userId: string,
  opts: { from_period?: string; to_period?: string } = {},
): Promise<{ id: string; period: string; old_tax_ore: number; new_tax_ore: number; tax_source: TaxSource }[]> {
  const rows = await client.query<{
    id: string; period: string; gross_ore: string; tax_ore: string; tax_source: string; tax_rate: number; payment_date: string | null;
  }>(
    `SELECT p.id, p.period, p.gross_ore, p.tax_ore, p.tax_source, p.payment_date::text, e.tax_rate
     FROM payslips p JOIN employees e ON e.id = p.employee_id
     WHERE p.company_id = $1 AND p.status = 'draft' AND p.tax_source <> 'manual'
       AND ($2::text IS NULL OR p.period >= $2) AND ($3::text IS NULL OR p.period <= $3)
     ORDER BY p.period, p.id
     FOR UPDATE OF p`,
    [companyId, opts.from_period ?? null, opts.to_period ?? null],
  );
  const changed: { id: string; period: string; old_tax_ore: number; new_tax_ore: number; tax_source: TaxSource }[] = [];
  for (const row of rows.rows) {
    const gross = Number(row.gross_ore);
    const oldTax = Number(row.tax_ore);
    const year = Number((row.payment_date ?? row.period).slice(0, 4));
    const c = computePayslipTax(gross, year, row.tax_rate, row.period);
    if (c.tax_ore === oldTax && c.tax_source === row.tax_source) continue;
    await client.query(
      'UPDATE payslips SET tax_ore = $3, net_ore = $4, tax_source = $5 WHERE id = $1 AND company_id = $2',
      [row.id, companyId, c.tax_ore, gross - c.tax_ore, c.tax_source],
    );
    await writeAudit(client, {
      companyId, userId, action: 'payslip.tax_recalculated', entityType: 'payslip', entityId: row.id,
      details: { period: row.period, old_tax_ore: oldTax, new_tax_ore: c.tax_ore, tax_source: c.tax_source },
    });
    changed.push({ id: row.id, period: row.period, old_tax_ore: oldTax, new_tax_ore: c.tax_ore, tax_source: c.tax_source });
  }
  return changed;
}

export async function getPayslip(client: PoolClient, companyId: string, id: string): Promise<Record<string, unknown>> {
  const r = await client.query(
    `SELECT p.id, p.employee_id, e.name AS employee_name, p.period, p.gross_ore, p.tax_ore, p.net_ore,
            p.employer_contribution_ore, p.tax_source, p.payment_date::text, p.vacation_pay_ore, p.status, p.voucher_id
     FROM payslips p JOIN employees e ON e.id = p.employee_id
     WHERE p.id = $1 AND p.company_id = $2`, [id, companyId],
  );
  if (!r.rows[0]) throw new NotFoundError('payslip');
  return r.rows[0];
}

export async function listPayslips(
  client: PoolClient, companyId: string, opts: { period?: string } = {},
): Promise<Record<string, unknown>[]> {
  const r = await client.query(
    `SELECT p.id, e.name AS employee_name, p.period, p.gross_ore, p.tax_ore, p.net_ore,
            p.employer_contribution_ore, p.tax_source, p.payment_date::text, p.vacation_pay_ore, p.status
     FROM payslips p JOIN employees e ON e.id = p.employee_id
     WHERE p.company_id = $1 AND ($2::text IS NULL OR p.period = $2)
     ORDER BY p.period DESC, e.name`,
    [companyId, opts.period ?? null],
  );
  return r.rows;
}

/**
 * Bokför ett lönebesked enligt BRUTTOMETODEN — hela lönehändelsen i ETT
 * verifikat på utbetalningsdatumet:
 *
 *   Debet  7010  bruttolön                (personalkostnaden)
 *   Kredit 2710  avdragen källskatt       (skuld till Skatteverket)
 *   Kredit 1930  nettolön                 (det som lämnar banken)
 *   Debet  7510  arbetsgivaravgift        (personalkostnaden)
 *   Kredit 2730  arbetsgivaravgift        (skuld till Skatteverket)
 *
 * Verifikatet balanserar per konstruktion: netto = brutto − skatt, så
 * debet (brutto + avgift) = kredit (skatt + netto + avgift). Skulderna på
 * 2710/2730 betalas av vid skattekontobetalningen (`bookPayrollTax`).
 *
 * Nollrader utelämnas (en jämkning till 0 kr skatt ska inte ge en rad utan
 * belopp — postVoucher avvisar den). Låser raden; dubbelbokning spärras via
 * verifikatets källkoppling (payslip + id).
 */
export async function bookPayslip(
  client: PoolClient, companyId: string, userId: string, id: string, fiscalYearId?: string, paymentDate?: string,
): Promise<Record<string, unknown>> {
  const locked = await client.query<{ gross_ore: string; tax_ore: string; net_ore: string; employer_contribution_ore: string; status: string; voucher_id: string | null; period: string; employee_id: string; payment_date: string | null }>(
    `SELECT gross_ore, tax_ore, net_ore, employer_contribution_ore, status, voucher_id, period, employee_id, payment_date::text
     FROM payslips WHERE id = $1 AND company_id = $2 FOR UPDATE`, [id, companyId],
  );
  const p = locked.rows[0];
  if (!p) throw new NotFoundError('payslip');
  if (p.voucher_id || p.status === 'booked') throw new ConflictError('already_booked', 'lönebeskedet är redan bokfört');
  if (p.status === 'cancelled') throw new ConflictError('cancelled', 'ett annullerat lönebesked kan inte bokföras');

  const gross = Number(p.gross_ore);
  const tax = Number(p.tax_ore);
  const net = Number(p.net_ore);
  const employer = Number(p.employer_contribution_ore);
  // Balansen vilar på att nettot ÄR brutto − skatt. Går de isär är lönebeskedet
  // internt motsägelsefullt, och då ska felet sägas rakt ut här i stället för att
  // dyka upp som ett obalanserat verifikat två lager ned.
  if (gross - tax !== net) {
    throw new BadRequestError('inconsistent_payslip', 'lönebeskedets netto stämmer inte med brutto − skatt');
  }
  const date = paymentDate ?? p.payment_date ?? defaultPaymentDate(p.period);
  const fyId = fiscalYearId ?? (await resolveFiscalYearForDate(client, companyId, date)).id;
  const lines: VoucherLineInput[] = [
    { account_number: SALARY_EXPENSE, debit_ore: gross, description: 'Bruttolön' },
    { account_number: EMPLOYEE_TAX_LIABILITY, credit_ore: tax, description: 'Avdragen preliminärskatt' },
    { account_number: BANK_ACCOUNT, credit_ore: net, description: 'Nettolön' },
    { account_number: EMPLOYER_CONTRIBUTION_EXPENSE, debit_ore: employer, description: 'Arbetsgivaravgift' },
    { account_number: EMPLOYER_CONTRIBUTION_LIABILITY, credit_ore: employer, description: 'Arbetsgivaravgift att betala' },
  ];
  const voucher = await postVoucher(client, companyId, userId, {
    fiscalYearId: fyId,
    voucherDate: date,
    description: `Lön ${p.period}`,
    sourceType: 'payslip',
    sourceId: id,
    lines: nonZero(lines),
  });
  await client.query("UPDATE payslips SET status = 'booked', voucher_id = $1, payment_date = $4 WHERE id = $2 AND company_id = $3 AND voucher_id IS NULL", [voucher.id, id, companyId, date]);
  await writeAudit(client, {
    companyId, userId, action: 'payslip.booked', entityType: 'payslip', entityId: id,
    details: { voucher_id: voucher.id, payment_date: date, gross_ore: gross, tax_ore: tax, net_ore: net, employer_contribution_ore: employer },
  });
  return getPayslip(client, companyId, id);
}

/**
 * Skattekontobetalningen för en löneperiod — under bruttometoden är den en
 * BETALNING AV EN SKULD, inte en ny kostnad:
 *
 *   Debet  2710  periodens avdragna källskatt
 *   Debet  2730  resterande del av beloppet (avgiften inkl. öresavrundning)
 *   Kredit 1930  det som lämnar banken
 *
 * 2510 (skattekonto) används INTE längre av lönebokföringen — det var
 * kontantmetodens konstruktion och den lämnade 2710/2730 orörda för alltid.
 *
 * Beloppet föreslås ur periodens lönebesked (ej makulerade) avrundat till hela
 * kronor, eftersom skattekontot betalas i hela kronor; `amount_ore` kan ange
 * annat. Avrundningen läggs medvetet på 2730 och blir alltså en kvarvarande
 * skuld på några ören per period — ett eget öresavrundningskonto (3740) är ett
 * eget vägval och byggs inte här.
 *
 * `voucher_id` (KRAV-5): en betalning som REDAN är bokförd — t.ex. ett
 * SIE-importerat verifikat — registreras mot sitt befintliga verifikat utan att
 * ett nytt skapas. Utan den raden i `payroll_tax_payments` fortsätter perioden
 * att rapporteras som obetald av `unpaidPayrollPeriods`, och prognosen visar en
 * skuld som faktiskt är betald. Beloppet härleds då ur verifikatets egen
 * bankkreditering (det som verkligen lämnade kontot), inte ur ett antagande.
 *
 * Utbetalningsdatum: angivet, annars verifikatets datum (vid registrering) eller
 * den 12:e månaden efter perioden med bankdagsregeln. UNIQUE (company_id,
 * period) spärrar dubbelbokning.
 */
export async function bookPayrollTax(
  client: PoolClient, companyId: string, userId: string,
  input: { period: string; fiscal_year_id?: string; payment_date?: string; amount_ore?: number; voucher_id?: string },
): Promise<Record<string, unknown>> {
  if (!/^\d{4}-\d{2}$/.test(input.period)) throw new BadRequestError('bad_period', 'period ska vara YYYY-MM');
  const sums = await client.query<{ tax_ore: string | null; employer_ore: string | null; n: string }>(
    `SELECT SUM(tax_ore)::text AS tax_ore, SUM(employer_contribution_ore)::text AS employer_ore, COUNT(*)::text AS n
     FROM payslips WHERE company_id = $1 AND period = $2 AND status <> 'cancelled'`,
    [companyId, input.period],
  );
  const row = sums.rows[0]!;
  if (Number(row.n) === 0) throw new NotFoundError('payslip');
  const tax = Number(row.tax_ore ?? 0);
  const employer = Number(row.employer_ore ?? 0);
  const suggested = Math.round((tax + employer) / 100) * 100; // hela kronor

  let date: string;
  let amount: number;
  let voucherId: string;
  const existingVoucherId = input.voucher_id;

  if (existingVoucherId !== undefined) {
    // Registrering mot befintligt verifikat: ingen ny bokföring, ingen ändring
    // av verifikatet (bokförda verifikat är oföränderliga). Endast kvittot i
    // payroll_tax_payments saknades.
    const existing = await client.query<{ voucher_date: string; bank_credit: string | null }>(
      `SELECT v.voucher_date::text,
              (SELECT SUM(l.credit_ore)::text FROM voucher_lines l
                WHERE l.voucher_id = v.id AND l.company_id = v.company_id AND l.account_number = $3) AS bank_credit
       FROM vouchers v WHERE v.id = $1 AND v.company_id = $2`,
      [existingVoucherId, companyId, BANK_ACCOUNT],
    );
    const v = existing.rows[0];
    if (!v) throw new NotFoundError('voucher');
    date = input.payment_date ?? v.voucher_date;
    amount = input.amount_ore ?? Number(v.bank_credit ?? 0);
    if (amount <= 0) {
      throw new BadRequestError(
        'no_amount',
        'verifikatet krediterar inget bankkonto (1930) — ange amount_ore för den betalning som ska registreras',
      );
    }
    voucherId = existingVoucherId;
  } else {
    amount = input.amount_ore ?? suggested;
    if (amount <= 0) throw new BadRequestError('no_amount', 'inget belopp att bokföra för perioden');
    // Betalningen kan aldrig vara mindre än den källskatt som ska bort från
    // 2710 — då vore 2730-raden negativ och verifikatet en gissning.
    if (amount < tax) {
      throw new BadRequestError('amount_below_tax', 'beloppet är lägre än periodens avdragna källskatt');
    }
    const [y, m] = input.period.split('-').map(Number) as [number, number];
    const nextMonth = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
    date = input.payment_date ?? bankDayOnOrBefore(`${nextMonth}-12`);
    const fyId = input.fiscal_year_id ?? (await resolveFiscalYearForDate(client, companyId, date)).id;
    const voucher = await postVoucher(client, companyId, userId, {
      fiscalYearId: fyId,
      voucherDate: date,
      description: `Skatt och arbetsgivaravgift lön ${input.period}`,
      sourceType: 'payroll_tax',
      sourceId: input.period,
      lines: nonZero([
        { account_number: EMPLOYEE_TAX_LIABILITY, debit_ore: tax, description: `Avdragen preliminärskatt ${input.period}` },
        { account_number: EMPLOYER_CONTRIBUTION_LIABILITY, debit_ore: amount - tax, description: `Arbetsgivaravgift ${input.period} (inkl. öresavrundning)` },
        { account_number: BANK_ACCOUNT, credit_ore: amount, description: 'Skattekontobetalning' },
      ]),
    });
    voucherId = voucher.id;
  }

  let paymentId: string;
  try {
    const r = await client.query<{ id: string }>(
      `INSERT INTO payroll_tax_payments (company_id, period, payment_date, tax_ore, employer_contribution_ore, amount_ore, voucher_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [companyId, input.period, date, tax, employer, amount, voucherId, userId],
    );
    paymentId = r.rows[0]!.id;
  } catch (err) {
    if ((err as { code?: string }).code === '23505') throw new ConflictError('already_booked', 'skattebetalningen för perioden är redan bokförd');
    throw err;
  }
  const registeredExisting = existingVoucherId !== undefined;
  await writeAudit(client, {
    companyId, userId,
    action: registeredExisting ? 'payroll_tax.registered' : 'payroll_tax.booked',
    entityType: 'payroll_tax_payment', entityId: paymentId,
    details: { period: input.period, payment_date: date, amount_ore: amount, tax_ore: tax, employer_contribution_ore: employer, voucher_id: voucherId, registered_existing_voucher: registeredExisting },
  });
  return {
    id: paymentId, period: input.period, payment_date: date,
    tax_ore: tax, employer_contribution_ore: employer,
    suggested_amount_ore: suggested, amount_ore: amount, voucher_id: voucherId,
    registered_existing_voucher: registeredExisting,
  };
}

/**
 * Ackumulerat per kalenderår ur systemets lönebesked (ersätter den externa
 * state-filen): totalsummor + rader per lönebesked. Makulerade räknas inte.
 */
export async function payrollYearSummary(
  client: PoolClient, companyId: string, year: number, opts: { employee_id?: string } = {},
): Promise<Record<string, unknown>> {
  const rows = await client.query(
    `SELECT p.id, e.name AS employee_name, p.employee_id, p.period, p.payment_date::text,
            p.gross_ore, p.vacation_pay_ore, p.tax_ore, p.net_ore, p.employer_contribution_ore, p.tax_source, p.status
     FROM payslips p JOIN employees e ON e.id = p.employee_id
     WHERE p.company_id = $1 AND p.period LIKE $2 AND p.status <> 'cancelled'
       AND ($3::uuid IS NULL OR p.employee_id = $3)
     ORDER BY p.period, e.name`,
    [companyId, `${year}-%`, opts.employee_id ?? null],
  );
  const total = (field: string) => rows.rows.reduce((s, r) => s + Number(r[field]), 0);
  return {
    year,
    payslip_count: rows.rows.length,
    gross_total_ore: total('gross_ore'),
    vacation_pay_total_ore: total('vacation_pay_ore'),
    tax_total_ore: total('tax_ore'),
    net_total_ore: total('net_ore'),
    employer_contribution_total_ore: total('employer_contribution_ore'),
    payslips: rows.rows,
  };
}
