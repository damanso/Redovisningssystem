/**
 * Payslip Service
 * Handles creation, calculation, and management of payslips (lönespecifikationer)
 */

import pool from '../config/database.js';
import type {
  Payslip,
  CreatePayslipDto,
  UpdatePayslipDto,
  PayslipWithDetails,
  SalaryPeriod,
  CreateSalaryPeriodDto,
  UpdateSalaryPeriodDto,
  EmployerContributions
} from '../types/salary.types.js';
import { EmployeeService } from './employeeService.js';
import { SalaryCalculationService } from './salaryCalculationService.js';
import { VacationService } from './vacationService.js';

export class PayslipService {

  /**
   * Create a new salary period
   */
  static async createSalaryPeriod(data: CreateSalaryPeriodDto): Promise<SalaryPeriod> {
    const query = `
      INSERT INTO salary_periods (
        company_id, period_name, period_start, period_end, payment_date, status
      ) VALUES ($1, $2, $3, $4, $5, 'DRAFT')
      RETURNING *
    `;

    const result = await pool.query(query, [
      data.companyId,
      data.periodName,
      data.periodStart,
      data.periodEnd,
      data.paymentDate
    ]);

    return this.mapRowToSalaryPeriod(result.rows[0]);
  }

  /**
   * Get salary period by ID
   */
  static async getSalaryPeriod(id: string): Promise<SalaryPeriod | null> {
    const query = 'SELECT * FROM salary_periods WHERE id = $1';
    const result = await pool.query(query, [id]);

    if (result.rows.length === 0) {
      return null;
    }

    return this.mapRowToSalaryPeriod(result.rows[0]);
  }

  /**
   * Get all salary periods for a company
   */
  static async getSalaryPeriods(companyId: string): Promise<SalaryPeriod[]> {
    const query = `
      SELECT * FROM salary_periods
      WHERE company_id = $1
      ORDER BY period_start DESC
    `;

    const result = await pool.query(query, [companyId]);
    return result.rows.map(row => this.mapRowToSalaryPeriod(row));
  }

  /**
   * Update salary period
   */
  static async updateSalaryPeriod(
    id: string,
    data: UpdateSalaryPeriodDto
  ): Promise<SalaryPeriod> {
    const updates: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    Object.entries(data).forEach(([key, value]) => {
      if (value !== undefined) {
        const snakeKey = this.camelToSnake(key);
        updates.push(`${snakeKey} = $${paramIndex}`);
        params.push(value);
        paramIndex++;
      }
    });

    if (updates.length === 0) {
      throw new Error('No fields to update');
    }

    params.push(id);

    const query = `
      UPDATE salary_periods
      SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP
      WHERE id = $${paramIndex}
      RETURNING *
    `;

    const result = await pool.query(query, params);

    if (result.rows.length === 0) {
      throw new Error('Salary period not found');
    }

    return this.mapRowToSalaryPeriod(result.rows[0]);
  }

  /**
   * Create a payslip for an employee
   */
  static async createPayslip(data: CreatePayslipDto, userId: string): Promise<Payslip> {
    // Get employee and configuration
    const employeeConfig = await EmployeeService.getEmployeeWithConfiguration(data.employeeId);
    if (!employeeConfig || !employeeConfig.employee) {
      throw new Error('Employee not found');
    }

    const { employee, salaryConfiguration } = employeeConfig;

    if (!salaryConfiguration) {
      throw new Error('Salary configuration not found for employee');
    }

    // Get salary period
    const period = await this.getSalaryPeriod(data.salaryPeriodId);
    if (!period) {
      throw new Error('Salary period not found');
    }

    // Calculate complete salary
    const calculation = await SalaryCalculationService.calculateCompleteSalary(
      employee,
      salaryConfiguration,
      data.salaryPeriodId,
      {
        hoursWorked: data.hoursWorked,
        overtimeHours: data.overtimeHours,
        bonus: data.bonus,
        commission: data.commission,
        otherCompensation: data.otherCompensation,
        vacationDaysTaken: data.vacationDaysTaken
      }
    );

    // Accrue vacation for this period
    const vacationAccrual = await VacationService.accrueVacationForPeriod(
      employee.id,
      calculation.grossSalary,
      new Date(period.periodStart),
      employee.vacationDaysPerYear,
      employee.vacationCalculationMethod
    );

    // Calculate vacation deduction if taking vacation
    let vacationDeduction = 0;
    if (data.vacationDaysTaken && data.vacationDaysTaken > 0) {
      const dailyGross = calculation.grossSalary / 21.67; // Average working days per month
      vacationDeduction = dailyGross * data.vacationDaysTaken;

      // Record vacation taken
      await VacationService.recordVacationTaken(
        employee.id,
        new Date().getFullYear(),
        data.vacationDaysTaken,
        vacationDeduction
      );
    }

    // Create payslip
    const query = `
      INSERT INTO payslips (
        salary_period_id, employee_id, period_start, period_end, payment_date,
        base_salary, hours_worked, hourly_rate,
        overtime_hours, overtime_pay, bonus, commission, vacation_pay, other_compensation,
        car_benefit, housing_benefit, other_benefits, total_benefits,
        total_gross_salary,
        employer_social_fees, employer_pension, total_employer_cost,
        preliminary_tax, vacation_deduction, union_fee, unemployment_insurance,
        other_deductions, total_deductions,
        net_salary,
        vacation_days_earned, vacation_days_taken, vacation_days_balance,
        vacation_pay_accrued, vacation_pay_balance,
        tax_table, tax_column, taxable_income,
        notes, status
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8,
        $9, $10, $11, $12, $13, $14,
        $15, $16, $17, $18,
        $19,
        $20, $21, $22,
        $23, $24, $25, $26, $27, $28,
        $29,
        $30, $31, $32, $33, $34,
        $35, $36, $37,
        $38, 'DRAFT'
      ) RETURNING *
    `;

    const result = await pool.query(query, [
      data.salaryPeriodId,
      data.employeeId,
      period.periodStart,
      period.periodEnd,
      period.paymentDate,
      // Base
      calculation.baseSalary,
      data.hoursWorked || null,
      employee.hourlyRate || null,
      // Additional compensation
      data.overtimeHours || 0,
      calculation.overtime,
      data.bonus || 0,
      data.commission || 0,
      data.vacationPay || 0,
      data.otherCompensation || 0,
      // Benefits
      salaryConfiguration.carBenefit,
      salaryConfiguration.housingBenefit,
      salaryConfiguration.otherBenefits,
      calculation.benefits,
      // Gross
      calculation.grossSalary,
      // Employer costs
      calculation.employerContributions.totalSocialFees,
      calculation.employerContributions.totalPension,
      calculation.totalEmployerCost,
      // Deductions
      calculation.preliminaryTax,
      vacationDeduction,
      salaryConfiguration.unionFee,
      salaryConfiguration.unemploymentInsurance,
      salaryConfiguration.otherDeductions,
      calculation.totalDeductions + vacationDeduction,
      // Net
      calculation.grossSalary - (calculation.totalDeductions + vacationDeduction),
      // Vacation
      vacationAccrual.earnedDays - (vacationAccrual.earnedDays - (25 / 12)),
      data.vacationDaysTaken || 0,
      vacationAccrual.remainingDays,
      vacationAccrual.accruedVacationPay - (vacationAccrual.accruedVacationPay - calculation.vacationCalculation!.totalVacationPay),
      vacationAccrual.remainingVacationPay,
      // Tax info
      employee.taxTable,
      employee.taxColumn,
      calculation.grossSalary,
      // Notes
      data.notes || null
    ]);

    const payslip = this.mapRowToPayslip(result.rows[0]);

    // Create employer contributions breakdown
    await this.createEmployerContributions(payslip.id, calculation.employerContributions);

    return payslip;
  }

  /**
   * Create employer contributions breakdown
   */
  private static async createEmployerContributions(
    payslipId: string,
    contributions: any
  ): Promise<EmployerContributions> {
    const query = `
      INSERT INTO employer_contributions (
        payslip_id, base_amount,
        sickness_insurance, parental_insurance, old_age_pension, survivor_pension,
        labor_market_fee, occupational_injury, general_wage_tax, total_social_fees,
        itp1_basic, itp1_high, itpk, custom_pension, total_pension,
        total_employer_cost
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16
      ) RETURNING *
    `;

    const result = await pool.query(query, [
      payslipId,
      contributions.baseAmount,
      contributions.sicknessInsurance,
      contributions.parentalInsurance,
      contributions.oldAgePension,
      contributions.survivorPension,
      contributions.laborMarketFee,
      contributions.occupationalInjury,
      contributions.generalWageTax,
      contributions.totalSocialFees,
      contributions.itp1Basic,
      contributions.itp1High,
      contributions.itpk,
      contributions.customPension || 0,
      contributions.totalPension,
      contributions.totalEmployerCost
    ]);

    return this.mapRowToEmployerContributions(result.rows[0]);
  }

  /**
   * Get payslip by ID
   */
  static async getPayslip(id: string): Promise<Payslip | null> {
    const query = 'SELECT * FROM payslips WHERE id = $1';
    const result = await pool.query(query, [id]);

    if (result.rows.length === 0) {
      return null;
    }

    return this.mapRowToPayslip(result.rows[0]);
  }

  /**
   * Get payslip with full details
   */
  static async getPayslipWithDetails(id: string): Promise<PayslipWithDetails | null> {
    const payslip = await this.getPayslip(id);
    if (!payslip) {
      return null;
    }

    const employee = await EmployeeService.getEmployeeById(payslip.employeeId);
    if (!employee) {
      return null;
    }

    const period = await this.getSalaryPeriod(payslip.salaryPeriodId);
    if (!period) {
      return null;
    }

    const contributionsQuery = 'SELECT * FROM employer_contributions WHERE payslip_id = $1';
    const contributionsResult = await pool.query(contributionsQuery, [id]);
    const employerContributions = this.mapRowToEmployerContributions(contributionsResult.rows[0]);

    return {
      payslip,
      employee: {
        id: employee.id,
        personalNumber: employee.personalNumber,
        firstName: employee.firstName,
        lastName: employee.lastName,
        email: employee.email,
        position: employee.position,
        department: employee.department
      },
      employerContributions,
      salaryPeriod: {
        id: period.id,
        periodName: period.periodName,
        paymentDate: period.paymentDate
      }
    };
  }

  /**
   * Get all payslips for a salary period
   */
  static async getPayslipsForPeriod(periodId: string): Promise<Payslip[]> {
    const query = `
      SELECT * FROM payslips
      WHERE salary_period_id = $1
      ORDER BY employee_id
    `;

    const result = await pool.query(query, [periodId]);
    return result.rows.map(row => this.mapRowToPayslip(row));
  }

  /**
   * Get all payslips for an employee
   */
  static async getPayslipsForEmployee(employeeId: string): Promise<Payslip[]> {
    const query = `
      SELECT * FROM payslips
      WHERE employee_id = $1
      ORDER BY period_start DESC
    `;

    const result = await pool.query(query, [employeeId]);
    return result.rows.map(row => this.mapRowToPayslip(row));
  }

  /**
   * Update payslip
   */
  static async updatePayslip(id: string, data: UpdatePayslipDto): Promise<Payslip> {
    // If updating salary amounts, recalculate everything
    const payslip = await this.getPayslip(id);
    if (!payslip) {
      throw new Error('Payslip not found');
    }

    const updates: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    Object.entries(data).forEach(([key, value]) => {
      if (value !== undefined) {
        const snakeKey = this.camelToSnake(key);
        updates.push(`${snakeKey} = $${paramIndex}`);
        params.push(value);
        paramIndex++;
      }
    });

    if (updates.length === 0) {
      return payslip;
    }

    params.push(id);

    const query = `
      UPDATE payslips
      SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP
      WHERE id = $${paramIndex}
      RETURNING *
    `;

    const result = await pool.query(query, params);
    return this.mapRowToPayslip(result.rows[0]);
  }

  /**
   * Approve payslip
   */
  static async approvePayslip(id: string, userId: string): Promise<Payslip> {
    const query = `
      UPDATE payslips
      SET status = 'APPROVED', approved_at = CURRENT_TIMESTAMP, approved_by = $1
      WHERE id = $2
      RETURNING *
    `;

    const result = await pool.query(query, [userId, id]);

    if (result.rows.length === 0) {
      throw new Error('Payslip not found');
    }

    return this.mapRowToPayslip(result.rows[0]);
  }

  /**
   * Mark payslip as sent
   */
  static async markPayslipSent(id: string, sentTo: string): Promise<Payslip> {
    const query = `
      UPDATE payslips
      SET status = 'SENT', sent_at = CURRENT_TIMESTAMP, sent_to = $1
      WHERE id = $2
      RETURNING *
    `;

    const result = await pool.query(query, [sentTo, id]);

    if (result.rows.length === 0) {
      throw new Error('Payslip not found');
    }

    return this.mapRowToPayslip(result.rows[0]);
  }

  /**
   * Generate payslips for all active employees in a period
   */
  static async generatePayslipsForPeriod(
    periodId: string,
    companyId: string,
    userId: string
  ): Promise<Payslip[]> {
    // Get all active employees
    const { employees } = await EmployeeService.getEmployees({
      companyId,
      isActive: true
    });

    const payslips: Payslip[] = [];

    for (const employee of employees) {
      try {
        const payslip = await this.createPayslip({
          salaryPeriodId: periodId,
          employeeId: employee.id,
          baseSalary: employee.baseSalary,
          hoursWorked: employee.salaryType === 'HOURLY' ? 168 : undefined // Assume 168 hours per month
        }, userId);

        payslips.push(payslip);
      } catch (error) {
        console.error(`Error creating payslip for employee ${employee.id}:`, error);
      }
    }

    // Update period statistics
    await this.updatePeriodStatistics(periodId);

    return payslips;
  }

  /**
   * Update salary period statistics
   */
  static async updatePeriodStatistics(periodId: string): Promise<void> {
    const query = `
      UPDATE salary_periods
      SET
        total_employees = (SELECT COUNT(*) FROM payslips WHERE salary_period_id = $1),
        total_gross_salary = (SELECT COALESCE(SUM(total_gross_salary), 0) FROM payslips WHERE salary_period_id = $1),
        total_net_salary = (SELECT COALESCE(SUM(net_salary), 0) FROM payslips WHERE salary_period_id = $1),
        total_employer_cost = (SELECT COALESCE(SUM(total_employer_cost), 0) FROM payslips WHERE salary_period_id = $1),
        total_tax = (SELECT COALESCE(SUM(preliminary_tax), 0) FROM payslips WHERE salary_period_id = $1)
      WHERE id = $1
    `;

    await pool.query(query, [periodId]);
  }

  /**
   * Map database row to SalaryPeriod object
   */
  private static mapRowToSalaryPeriod(row: any): SalaryPeriod {
    return {
      id: row.id,
      companyId: row.company_id,
      periodName: row.period_name,
      periodStart: new Date(row.period_start),
      periodEnd: new Date(row.period_end),
      paymentDate: new Date(row.payment_date),
      status: row.status,
      totalEmployees: row.total_employees || 0,
      totalGrossSalary: parseFloat(row.total_gross_salary || 0),
      totalNetSalary: parseFloat(row.total_net_salary || 0),
      totalEmployerCost: parseFloat(row.total_employer_cost || 0),
      totalTax: parseFloat(row.total_tax || 0),
      processedAt: row.processed_at ? new Date(row.processed_at) : undefined,
      processedBy: row.processed_by,
      approvedAt: row.approved_at ? new Date(row.approved_at) : undefined,
      approvedBy: row.approved_by,
      lockedAt: row.locked_at ? new Date(row.locked_at) : undefined,
      lockedBy: row.locked_by,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at)
    };
  }

  /**
   * Map database row to Payslip object
   */
  private static mapRowToPayslip(row: any): Payslip {
    return {
      id: row.id,
      salaryPeriodId: row.salary_period_id,
      employeeId: row.employee_id,
      periodStart: new Date(row.period_start),
      periodEnd: new Date(row.period_end),
      paymentDate: new Date(row.payment_date),
      baseSalary: parseFloat(row.base_salary),
      hoursWorked: row.hours_worked ? parseFloat(row.hours_worked) : undefined,
      hourlyRate: row.hourly_rate ? parseFloat(row.hourly_rate) : undefined,
      overtimeHours: parseFloat(row.overtime_hours),
      overtimePay: parseFloat(row.overtime_pay),
      bonus: parseFloat(row.bonus),
      commission: parseFloat(row.commission),
      vacationPay: parseFloat(row.vacation_pay),
      otherCompensation: parseFloat(row.other_compensation),
      carBenefit: parseFloat(row.car_benefit),
      housingBenefit: parseFloat(row.housing_benefit),
      otherBenefits: parseFloat(row.other_benefits),
      totalBenefits: parseFloat(row.total_benefits),
      totalGrossSalary: parseFloat(row.total_gross_salary),
      employerSocialFees: parseFloat(row.employer_social_fees),
      employerPension: parseFloat(row.employer_pension),
      totalEmployerCost: parseFloat(row.total_employer_cost),
      preliminaryTax: parseFloat(row.preliminary_tax),
      vacationDeduction: parseFloat(row.vacation_deduction),
      unionFee: parseFloat(row.union_fee),
      unemploymentInsurance: parseFloat(row.unemployment_insurance),
      otherDeductions: parseFloat(row.other_deductions),
      totalDeductions: parseFloat(row.total_deductions),
      netSalary: parseFloat(row.net_salary),
      vacationDaysEarned: parseFloat(row.vacation_days_earned),
      vacationDaysTaken: parseFloat(row.vacation_days_taken),
      vacationDaysBalance: parseFloat(row.vacation_days_balance),
      vacationPayAccrued: parseFloat(row.vacation_pay_accrued),
      vacationPayBalance: parseFloat(row.vacation_pay_balance),
      taxTable: row.tax_table,
      taxColumn: row.tax_column,
      taxableIncome: parseFloat(row.taxable_income),
      status: row.status,
      pdfPath: row.pdf_path,
      sentAt: row.sent_at ? new Date(row.sent_at) : undefined,
      sentTo: row.sent_to,
      notes: row.notes,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
      approvedAt: row.approved_at ? new Date(row.approved_at) : undefined,
      approvedBy: row.approved_by
    };
  }

  /**
   * Map database row to EmployerContributions object
   */
  private static mapRowToEmployerContributions(row: any): EmployerContributions {
    return {
      id: row.id,
      payslipId: row.payslip_id,
      baseAmount: parseFloat(row.base_amount),
      sicknessInsurance: parseFloat(row.sickness_insurance),
      parentalInsurance: parseFloat(row.parental_insurance),
      oldAgePension: parseFloat(row.old_age_pension),
      survivorPension: parseFloat(row.survivor_pension),
      laborMarketFee: parseFloat(row.labor_market_fee),
      occupationalInjury: parseFloat(row.occupational_injury),
      generalWageTax: parseFloat(row.general_wage_tax),
      totalSocialFees: parseFloat(row.total_social_fees),
      itp1Basic: parseFloat(row.itp1_basic),
      itp1High: parseFloat(row.itp1_high),
      itpk: parseFloat(row.itpk),
      customPension: parseFloat(row.custom_pension),
      totalPension: parseFloat(row.total_pension),
      totalEmployerCost: parseFloat(row.total_employer_cost),
      createdAt: new Date(row.created_at)
    };
  }

  /**
   * Convert camelCase to snake_case
   */
  private static camelToSnake(str: string): string {
    return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
  }
}

export default PayslipService;
