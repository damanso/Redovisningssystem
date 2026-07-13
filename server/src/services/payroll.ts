// Fas A14: lön & HR (utan AGI/KU-10). Anställda + lönebesked. En lönekörning
// beräknar brutto, preliminärskatt (platt sats per anställd — förenkling) och
// arbetsgivaravgifter, och bokför. Ingen arbetsgivardeklaration lämnas till
// Skatteverket — det är uttryckligen UTANFÖR scope. Belopp i heltal ören.
import type { PoolClient } from 'pg';
import { BadRequestError, ConflictError, NotFoundError } from '../lib/errors.js';
import { postVoucher } from './accounting/vouchers.js';
import { writeAudit } from './auditService.js';

// Standardkonton (BAS) för lön. Alla finns i standardkontoplanen (0006).
const SALARY_EXPENSE = 7210;         // Löner till tjänstemän
const TAX_LIABILITY = 2710;          // Personalskatt (källskatt)
const BANK_ACCOUNT = 1930;           // Företagskonto
const EMPLOYER_CONTRIB_EXPENSE = 7510; // Lagstadgade sociala avgifter (kostnad)
const EMPLOYER_CONTRIB_LIABILITY = 2730; // Sociala avgifter (skuld)

// Arbetsgivaravgift i promille (31,42 % = 3142). En förenkling: full avgift;
// nedsättningar (t.ex. för unga/regionalt) hanteras inte.
export const EMPLOYER_CONTRIBUTION_PERMILLE = 3142;

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

/** Skapar ett lönebesked (utkast) för en anställd och period. Bokför inget. */
export async function createPayslip(
  client: PoolClient, companyId: string, userId: string,
  input: { employee_id: string; period: string; gross_ore?: number },
): Promise<Record<string, unknown>> {
  if (!/^\d{4}-\d{2}$/.test(input.period)) throw new BadRequestError('bad_period', 'period ska vara YYYY-MM');
  const emp = await client.query<{ monthly_salary_ore: string; tax_rate: number; active: boolean }>(
    'SELECT monthly_salary_ore, tax_rate, active FROM employees WHERE id = $1 AND company_id = $2', [input.employee_id, companyId],
  );
  if (!emp.rows[0]) throw new NotFoundError('employee');
  const gross = input.gross_ore ?? Number(emp.rows[0].monthly_salary_ore);
  if (gross <= 0) throw new BadRequestError('no_salary', 'bruttolön saknas');
  const c = computePayroll(gross, emp.rows[0].tax_rate);
  let id: string;
  try {
    const r = await client.query<{ id: string }>(
      `INSERT INTO payslips (company_id, employee_id, period, gross_ore, tax_ore, net_ore, employer_contribution_ore, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [companyId, input.employee_id, input.period, c.gross_ore, c.tax_ore, c.net_ore, c.employer_contribution_ore, userId],
    );
    id = r.rows[0]!.id;
  } catch (err) {
    if ((err as { code?: string }).code === '23505') throw new ConflictError('duplicate_payslip', 'lönebesked finns redan för perioden');
    throw err;
  }
  await writeAudit(client, { companyId, userId, action: 'payslip.created', entityType: 'payslip', entityId: id, details: { period: input.period } });
  return getPayslip(client, companyId, id);
}

export async function getPayslip(client: PoolClient, companyId: string, id: string): Promise<Record<string, unknown>> {
  const r = await client.query(
    `SELECT p.id, p.employee_id, e.name AS employee_name, p.period, p.gross_ore, p.tax_ore, p.net_ore,
            p.employer_contribution_ore, p.status, p.voucher_id
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
            p.employer_contribution_ore, p.status
     FROM payslips p JOIN employees e ON e.id = p.employee_id
     WHERE p.company_id = $1 AND ($2::text IS NULL OR p.period = $2)
     ORDER BY p.period DESC, e.name`,
    [companyId, opts.period ?? null],
  );
  return r.rows;
}

/**
 * Bokför ett lönebesked. Kontering (BAS):
 *   Debet 7210 brutto                     (lönekostnad)
 *   Kredit 2710 skatt                     (personalens källskatt)
 *   Kredit 1930 netto                     (utbetalning)
 *   Debet 7510 arbetsgivaravgift          (kostnad)
 *   Kredit 2730 arbetsgivaravgift         (skuld till Skatteverket)
 * Balans: debet (brutto+avgift) = kredit (skatt+netto+avgift). Låser raden.
 */
export async function bookPayslip(
  client: PoolClient, companyId: string, userId: string, id: string, fiscalYearId: string, paymentDate: string,
): Promise<Record<string, unknown>> {
  const locked = await client.query<{ gross_ore: string; tax_ore: string; net_ore: string; employer_contribution_ore: string; status: string; voucher_id: string | null; period: string; employee_id: string }>(
    `SELECT gross_ore, tax_ore, net_ore, employer_contribution_ore, status, voucher_id, period, employee_id
     FROM payslips WHERE id = $1 AND company_id = $2 FOR UPDATE`, [id, companyId],
  );
  const p = locked.rows[0];
  if (!p) throw new NotFoundError('payslip');
  if (p.voucher_id || p.status === 'booked') throw new ConflictError('already_booked', 'lönebeskedet är redan bokfört');
  if (p.status === 'cancelled') throw new ConflictError('cancelled', 'ett annullerat lönebesked kan inte bokföras');

  const gross = Number(p.gross_ore), tax = Number(p.tax_ore), net = Number(p.net_ore), employer = Number(p.employer_contribution_ore);
  const voucher = await postVoucher(client, companyId, userId, {
    fiscalYearId,
    voucherDate: paymentDate,
    description: `Lön ${p.period}`,
    sourceType: 'payslip',
    sourceId: id,
    lines: [
      { account_number: SALARY_EXPENSE, debit_ore: gross, description: 'Bruttolön' },
      { account_number: TAX_LIABILITY, credit_ore: tax, description: 'Personalskatt' },
      { account_number: BANK_ACCOUNT, credit_ore: net, description: 'Nettolön' },
      { account_number: EMPLOYER_CONTRIB_EXPENSE, debit_ore: employer, description: 'Arbetsgivaravgift' },
      { account_number: EMPLOYER_CONTRIB_LIABILITY, credit_ore: employer, description: 'Arbetsgivaravgift' },
    ],
  });
  await client.query("UPDATE payslips SET status = 'booked', voucher_id = $1 WHERE id = $2 AND company_id = $3 AND voucher_id IS NULL", [voucher.id, id, companyId]);
  await writeAudit(client, { companyId, userId, action: 'payslip.booked', entityType: 'payslip', entityId: id, details: { voucher_id: voucher.id } });
  return getPayslip(client, companyId, id);
}
