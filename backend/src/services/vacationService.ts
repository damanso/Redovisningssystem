/**
 * Vacation Service
 * Handles vacation accrual, tracking, and debt calculations
 * According to Swedish Semesterlagen
 */

import pool from '../config/database.js';
import type { VacationAccrual, VacationAccrualDto } from '../types/employee.types.js';
import { SalaryCalculationService } from './salaryCalculationService.js';

export class VacationService {

  /**
   * Create or update vacation accrual for an employee
   */
  static async upsertVacationAccrual(data: VacationAccrualDto): Promise<VacationAccrual> {
    const {
      employeeId,
      earningYear,
      earnedDays = 0,
      takenDays = 0,
      vacationSalaryBase = 0,
      accruedVacationPay = 0,
      paidVacationPay = 0,
      calculationMethod = 'PERCENTAGE'
    } = data;

    const vacationYear = earningYear + 1; // Vacation is taken the year after earning
    const remainingDays = earnedDays - takenDays;
    const remainingVacationPay = accruedVacationPay - paidVacationPay;

    const query = `
      INSERT INTO vacation_accruals (
        employee_id,
        earning_year,
        vacation_year,
        earned_days,
        taken_days,
        remaining_days,
        vacation_salary_base,
        accrued_vacation_pay,
        paid_vacation_pay,
        remaining_vacation_pay,
        calculation_method
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      ON CONFLICT (employee_id, earning_year)
      DO UPDATE SET
        earned_days = $4,
        taken_days = $5,
        remaining_days = $6,
        vacation_salary_base = $7,
        accrued_vacation_pay = $8,
        paid_vacation_pay = $9,
        remaining_vacation_pay = $10,
        calculation_method = $11,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `;

    const result = await pool.query(query, [
      employeeId,
      earningYear,
      vacationYear,
      earnedDays,
      takenDays,
      remainingDays,
      vacationSalaryBase,
      accruedVacationPay,
      paidVacationPay,
      remainingVacationPay,
      calculationMethod
    ]);

    return this.mapRowToVacationAccrual(result.rows[0]);
  }

  /**
   * Get vacation accrual for employee and year
   */
  static async getVacationAccrual(employeeId: string, earningYear: number): Promise<VacationAccrual | null> {
    const query = `
      SELECT * FROM vacation_accruals
      WHERE employee_id = $1 AND earning_year = $2
    `;

    const result = await pool.query(query, [employeeId, earningYear]);

    if (result.rows.length === 0) {
      return null;
    }

    return this.mapRowToVacationAccrual(result.rows[0]);
  }

  /**
   * Get all vacation accruals for an employee
   */
  static async getEmployeeVacationHistory(employeeId: string): Promise<VacationAccrual[]> {
    const query = `
      SELECT * FROM vacation_accruals
      WHERE employee_id = $1
      ORDER BY earning_year DESC
    `;

    const result = await pool.query(query, [employeeId]);

    return result.rows.map(row => this.mapRowToVacationAccrual(row));
  }

  /**
   * Accrue vacation for a salary period
   * Called when processing monthly salary
   */
  static async accrueVacationForPeriod(
    employeeId: string,
    grossSalary: number,
    periodDate: Date,
    vacationDaysPerYear: number = 25,
    calculationMethod: 'PERCENTAGE' | 'SAME_SALARY' = 'PERCENTAGE'
  ): Promise<VacationAccrual> {

    const earningYear = periodDate.getFullYear();

    // Days earned per month: 25 days / 12 months = 2.083 days per month
    const daysEarnedThisMonth = vacationDaysPerYear / 12;

    // Calculate vacation pay accrued this month
    let vacationPayAccrued = 0;
    if (calculationMethod === 'PERCENTAGE') {
      // 12% of gross salary
      vacationPayAccrued = grossSalary * 0.12;
    } else {
      // Same salary method: 0.43% per vacation day
      vacationPayAccrued = grossSalary * 0.0043 * daysEarnedThisMonth;
    }

    // Get existing accrual or create new
    let existing = await this.getVacationAccrual(employeeId, earningYear);

    if (!existing) {
      // Create new accrual
      return await this.upsertVacationAccrual({
        employeeId,
        earningYear,
        earnedDays: daysEarnedThisMonth,
        takenDays: 0,
        vacationSalaryBase: grossSalary,
        accruedVacationPay: vacationPayAccrued,
        paidVacationPay: 0,
        calculationMethod
      });
    } else {
      // Update existing accrual
      return await this.upsertVacationAccrual({
        employeeId,
        earningYear,
        earnedDays: existing.earnedDays + daysEarnedThisMonth,
        takenDays: existing.takenDays,
        vacationSalaryBase: existing.vacationSalaryBase + grossSalary,
        accruedVacationPay: existing.accruedVacationPay + vacationPayAccrued,
        paidVacationPay: existing.paidVacationPay,
        calculationMethod
      });
    }
  }

  /**
   * Record vacation taken
   */
  static async recordVacationTaken(
    employeeId: string,
    vacationYear: number,
    daysTaken: number,
    vacationPayPaid: number
  ): Promise<VacationAccrual> {

    const earningYear = vacationYear - 1;

    const existing = await this.getVacationAccrual(employeeId, earningYear);

    if (!existing) {
      throw new Error(`No vacation accrual found for employee ${employeeId} in earning year ${earningYear}`);
    }

    const newTakenDays = existing.takenDays + daysTaken;
    const newPaidVacationPay = existing.paidVacationPay + vacationPayPaid;

    if (newTakenDays > existing.earnedDays) {
      throw new Error(`Cannot take more vacation days (${newTakenDays}) than earned (${existing.earnedDays})`);
    }

    return await this.upsertVacationAccrual({
      employeeId,
      earningYear,
      earnedDays: existing.earnedDays,
      takenDays: newTakenDays,
      vacationSalaryBase: existing.vacationSalaryBase,
      accruedVacationPay: existing.accruedVacationPay,
      paidVacationPay: newPaidVacationPay,
      calculationMethod: existing.calculationMethod
    });
  }

  /**
   * Get current vacation balance for employee
   */
  static async getCurrentVacationBalance(employeeId: string): Promise<{
    totalEarnedDays: number;
    totalTakenDays: number;
    totalRemainingDays: number;
    totalAccruedVacationPay: number;
    totalPaidVacationPay: number;
    totalRemainingVacationPay: number;
    byYear: VacationAccrual[];
  }> {

    const history = await this.getEmployeeVacationHistory(employeeId);

    const summary = {
      totalEarnedDays: 0,
      totalTakenDays: 0,
      totalRemainingDays: 0,
      totalAccruedVacationPay: 0,
      totalPaidVacationPay: 0,
      totalRemainingVacationPay: 0,
      byYear: history
    };

    history.forEach(accrual => {
      summary.totalEarnedDays += accrual.earnedDays;
      summary.totalTakenDays += accrual.takenDays;
      summary.totalRemainingDays += accrual.remainingDays;
      summary.totalAccruedVacationPay += accrual.accruedVacationPay;
      summary.totalPaidVacationPay += accrual.paidVacationPay;
      summary.totalRemainingVacationPay += accrual.remainingVacationPay;
    });

    return summary;
  }

  /**
   * Calculate vacation pay owed on termination (Semesterersättning)
   */
  static async calculateVacationCompensationOnTermination(
    employeeId: string
  ): Promise<number> {

    const balance = await this.getCurrentVacationBalance(employeeId);

    // Return all remaining vacation pay
    return SalaryCalculationService.round(balance.totalRemainingVacationPay);
  }

  /**
   * Map database row to VacationAccrual object
   */
  private static mapRowToVacationAccrual(row: any): VacationAccrual {
    return {
      id: row.id,
      employeeId: row.employee_id,
      earningYear: row.earning_year,
      vacationYear: row.vacation_year,
      earnedDays: parseFloat(row.earned_days),
      takenDays: parseFloat(row.taken_days),
      remainingDays: parseFloat(row.remaining_days),
      vacationSalaryBase: parseFloat(row.vacation_salary_base),
      accruedVacationPay: parseFloat(row.accrued_vacation_pay),
      paidVacationPay: parseFloat(row.paid_vacation_pay),
      remainingVacationPay: parseFloat(row.remaining_vacation_pay),
      calculationMethod: row.calculation_method,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at)
    };
  }
}

export default VacationService;
