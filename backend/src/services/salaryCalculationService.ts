/**
 * Swedish Salary Calculation Service
 *
 * Handles all salary calculations according to Swedish law:
 * - Tax calculations (preliminär A-skatt)
 * - Employer contributions (arbetsgivaravgifter)
 * - Pension calculations (ITP1, ITP2, ITPK)
 * - Vacation pay (semesterlön)
 * - Benefits and deductions
 */

import pool from '../config/database.js';
import type {
  EmployerContributionCalculation,
  TaxCalculation,
  VacationPayCalculation,
  SalaryCalculation,
  PersonalNumberValidation
} from '../types/salary.types.js';
import type { Employee, SalaryConfiguration } from '../types/employee.types.js';

/**
 * Swedish Employer Contribution Rates (2025)
 */
const EMPLOYER_CONTRIBUTION_RATES = {
  FULL_RATE: 31.42, // Standard full rate
  SICKNESS_INSURANCE: 3.55,
  PARENTAL_INSURANCE: 2.60,
  OLD_AGE_PENSION: 10.21,
  SURVIVOR_PENSION: 0.60,
  LABOR_MARKET: 2.64,
  OCCUPATIONAL_INJURY: 0.20,
  GENERAL_WAGE_TAX: 11.62,

  // Age-based reduced rate
  AGE_66_67_RATE: 10.21, // Only old-age pension
};

/**
 * Income Base Amount for 2025
 */
const INCOME_BASE_AMOUNT_2025 = 67167; // Inkomstbasbelopp
const BASE_AMOUNT_2025 = 57300; // Prisbasbelopp

/**
 * Vacation rates
 */
const VACATION_RATES = {
  PERCENTAGE: 0.12, // 12% for percentage method
  SAME_SALARY_DAILY: 0.0043, // 0.43% per vacation day
};

export class SalaryCalculationService {

  /**
   * Validate Swedish Personal Number (Personnummer)
   * Format: YYYYMMDD-XXXX or YYMMDD-XXXX
   */
  static validatePersonalNumber(personalNumber: string): PersonalNumberValidation {
    const result: PersonalNumberValidation = {
      isValid: false,
      personalNumber: personalNumber,
      errors: [],
    };

    // Remove any spaces or dashes
    const cleaned = personalNumber.replace(/[\s\-]/g, '');

    // Check length (10 or 12 digits)
    if (cleaned.length !== 10 && cleaned.length !== 12) {
      result.errors?.push('Personal number must be 10 or 12 digits');
      return result;
    }

    // Check if all characters are digits
    if (!/^\d+$/.test(cleaned)) {
      result.errors?.push('Personal number must contain only digits');
      return result;
    }

    // Extract parts
    let year: number;
    let month: number;
    let day: number;
    let controlDigits: string;

    if (cleaned.length === 12) {
      year = parseInt(cleaned.substring(0, 4));
      month = parseInt(cleaned.substring(4, 6));
      day = parseInt(cleaned.substring(6, 8));
      controlDigits = cleaned.substring(8);
    } else {
      const yearShort = parseInt(cleaned.substring(0, 2));
      const currentYear = new Date().getFullYear();
      const currentCentury = Math.floor(currentYear / 100) * 100;
      year = currentCentury + yearShort;

      // Adjust for people born in previous century
      if (year > currentYear) {
        year -= 100;
      }

      month = parseInt(cleaned.substring(2, 4));
      day = parseInt(cleaned.substring(4, 6));
      controlDigits = cleaned.substring(6);
    }

    // Validate month (1-12)
    if (month < 1 || month > 12) {
      result.errors?.push('Invalid month');
      return result;
    }

    // Validate day (1-31, or 61-91 for coordination number)
    const isCoordinationNumber = day > 60;
    const actualDay = isCoordinationNumber ? day - 60 : day;

    if (actualDay < 1 || actualDay > 31) {
      result.errors?.push('Invalid day');
      return result;
    }

    // Create birth date
    try {
      result.birthDate = new Date(year, month - 1, actualDay);
      const today = new Date();
      result.age = today.getFullYear() - year;

      // Adjust age if birthday hasn't occurred this year
      if (today.getMonth() < month - 1 ||
          (today.getMonth() === month - 1 && today.getDate() < actualDay)) {
        result.age--;
      }
    } catch (error) {
      result.errors?.push('Invalid date');
      return result;
    }

    // Determine gender (second-to-last digit: odd = male, even = female)
    const genderDigit = parseInt(controlDigits.charAt(controlDigits.length - 2));
    result.gender = genderDigit % 2 === 0 ? 'FEMALE' : 'MALE';

    // Luhn algorithm validation (checksum)
    const digitsToCheck = cleaned.length === 12 ? cleaned.substring(2, 12) : cleaned;
    let sum = 0;

    for (let i = 0; i < digitsToCheck.length - 1; i++) {
      let digit = parseInt(digitsToCheck.charAt(i));

      // Multiply every other digit by 2
      if (i % 2 === 0) {
        digit *= 2;
        if (digit > 9) {
          digit -= 9;
        }
      }

      sum += digit;
    }

    const calculatedChecksum = (10 - (sum % 10)) % 10;
    const actualChecksum = parseInt(digitsToCheck.charAt(digitsToCheck.length - 1));

    if (calculatedChecksum !== actualChecksum) {
      result.errors?.push('Invalid checksum');
      return result;
    }

    result.isValid = true;
    result.errors = undefined;

    return result;
  }

  /**
   * Calculate age from personal number
   */
  static calculateAge(personalNumber: string): number {
    const validation = this.validatePersonalNumber(personalNumber);
    return validation.age || 0;
  }

  /**
   * Calculate Employer Contributions (Arbetsgivaravgifter)
   * Based on gross salary and employee age
   */
  static calculateEmployerContributions(
    baseAmount: number,
    age: number,
    usesAgeBasedRate: boolean = true,
    pensionConfig?: {
      pensionPlan: string;
      itp1Rate?: number;
      itp1HighRate?: number;
      itpkRate?: number;
      customPensionRate?: number;
    }
  ): EmployerContributionCalculation {

    const result: EmployerContributionCalculation = {
      baseAmount,
      age,
      usesAgeBasedRate,
      sicknessInsurance: 0,
      parentalInsurance: 0,
      oldAgePension: 0,
      survivorPension: 0,
      laborMarketFee: 0,
      occupationalInjury: 0,
      generalWageTax: 0,
      totalSocialFees: 0,
      itp1Basic: 0,
      itp1High: 0,
      itpk: 0,
      customPension: 0,
      totalPension: 0,
      totalEmployerCost: 0,
      employerCostPercentage: 0,
    };

    // Determine social fee rate based on age
    const useReducedRate = usesAgeBasedRate && age >= 66 && age <= 67;
    const useNoFees = usesAgeBasedRate && age >= 68;

    if (useNoFees) {
      // Born 1957 or earlier - no employer contributions (as of 2026)
      // For 2025, we still apply old-age pension
      result.oldAgePension = baseAmount * (EMPLOYER_CONTRIBUTION_RATES.OLD_AGE_PENSION / 100);
      result.totalSocialFees = result.oldAgePension;
    } else if (useReducedRate) {
      // Age 66-67 - only old-age pension
      result.oldAgePension = baseAmount * (EMPLOYER_CONTRIBUTION_RATES.OLD_AGE_PENSION / 100);
      result.totalSocialFees = result.oldAgePension;
    } else {
      // Full rate - all contributions
      result.sicknessInsurance = baseAmount * (EMPLOYER_CONTRIBUTION_RATES.SICKNESS_INSURANCE / 100);
      result.parentalInsurance = baseAmount * (EMPLOYER_CONTRIBUTION_RATES.PARENTAL_INSURANCE / 100);
      result.oldAgePension = baseAmount * (EMPLOYER_CONTRIBUTION_RATES.OLD_AGE_PENSION / 100);
      result.survivorPension = baseAmount * (EMPLOYER_CONTRIBUTION_RATES.SURVIVOR_PENSION / 100);
      result.laborMarketFee = baseAmount * (EMPLOYER_CONTRIBUTION_RATES.LABOR_MARKET / 100);
      result.occupationalInjury = baseAmount * (EMPLOYER_CONTRIBUTION_RATES.OCCUPATIONAL_INJURY / 100);
      result.generalWageTax = baseAmount * (EMPLOYER_CONTRIBUTION_RATES.GENERAL_WAGE_TAX / 100);

      result.totalSocialFees =
        result.sicknessInsurance +
        result.parentalInsurance +
        result.oldAgePension +
        result.survivorPension +
        result.laborMarketFee +
        result.occupationalInjury +
        result.generalWageTax;
    }

    // Calculate pension contributions if applicable
    if (pensionConfig) {
      if (pensionConfig.pensionPlan === 'ITP1') {
        // ITP1: 4.5% up to 7.5 income base amounts, 30% above
        const threshold = INCOME_BASE_AMOUNT_2025 * 7.5; // Monthly: 503,752.50 / 12
        const monthlyThreshold = threshold / 12;

        if (baseAmount <= monthlyThreshold) {
          result.itp1Basic = baseAmount * ((pensionConfig.itp1Rate || 4.5) / 100);
        } else {
          result.itp1Basic = monthlyThreshold * ((pensionConfig.itp1Rate || 4.5) / 100);
          result.itp1High = (baseAmount - monthlyThreshold) * ((pensionConfig.itp1HighRate || 30) / 100);
        }

        // ITPK: 2% of monthly salary
        result.itpk = baseAmount * ((pensionConfig.itpkRate || 2.0) / 100);

      } else if (pensionConfig.pensionPlan === 'ITP2') {
        // ITP2 is defined benefit, calculated differently
        // For employer cost estimation, we use approximately 4.5%
        result.itp1Basic = baseAmount * 0.045;
        result.itpk = baseAmount * ((pensionConfig.itpkRate || 2.0) / 100);

      } else if (pensionConfig.pensionPlan === 'CUSTOM' && pensionConfig.customPensionRate) {
        result.customPension = baseAmount * (pensionConfig.customPensionRate / 100);
      }

      result.totalPension = result.itp1Basic + result.itp1High + result.itpk + result.customPension;
    }

    // Calculate totals
    result.totalEmployerCost = result.totalSocialFees + result.totalPension;
    result.employerCostPercentage = baseAmount > 0
      ? (result.totalEmployerCost / baseAmount) * 100
      : 0;

    // Round all values to 2 decimals
    Object.keys(result).forEach(key => {
      if (typeof result[key as keyof EmployerContributionCalculation] === 'number') {
        (result as any)[key] = Math.round((result as any)[key] * 100) / 100;
      }
    });

    return result;
  }

  /**
   * Calculate Preliminary Tax (Preliminärskatt)
   * Uses Swedish tax tables from Skatteverket
   */
  static async calculateTax(
    grossSalary: number,
    taxTable: string,
    taxColumn: number,
    municipalTaxRate?: number,
    churchTax: boolean = false,
    churchTaxRate: number = 0
  ): Promise<TaxCalculation> {

    const result: TaxCalculation = {
      grossSalary,
      taxableIncome: grossSalary,
      taxTable,
      taxColumn,
      preliminaryTax: 0,
      effectiveTaxRate: 0,
    };

    try {
      // Look up tax amount from tax_tables
      const query = `
        SELECT tax_amount
        FROM tax_tables
        WHERE table_number = $1
          AND column_number = $2
          AND year = $3
          AND $4 >= salary_from
          AND $4 < salary_to
        LIMIT 1
      `;

      const currentYear = new Date().getFullYear();
      const queryResult = await pool.query(query, [taxTable, taxColumn, currentYear, grossSalary]);

      if (queryResult.rows.length > 0) {
        result.preliminaryTax = parseFloat(queryResult.rows[0].tax_amount);
      } else {
        // Fallback: Use approximate municipal tax if no table found
        // Average Swedish municipal tax is around 32%
        const fallbackRate = municipalTaxRate || 32.0;
        result.preliminaryTax = grossSalary * (fallbackRate / 100);
        result.municipalTax = result.preliminaryTax;
      }

      // Add church tax if applicable
      if (churchTax && churchTaxRate > 0) {
        result.churchTax = grossSalary * (churchTaxRate / 100);
        result.preliminaryTax += result.churchTax;
      }

      // Calculate effective tax rate
      result.effectiveTaxRate = grossSalary > 0
        ? (result.preliminaryTax / grossSalary) * 100
        : 0;

      // Round to 2 decimals
      result.preliminaryTax = Math.round(result.preliminaryTax * 100) / 100;
      result.effectiveTaxRate = Math.round(result.effectiveTaxRate * 100) / 100;

    } catch (error) {
      console.error('Error calculating tax:', error);
      // Fallback calculation
      result.preliminaryTax = grossSalary * 0.30; // 30% fallback
      result.effectiveTaxRate = 30.0;
    }

    return result;
  }

  /**
   * Calculate Vacation Pay (Semesterlön)
   * Supports both percentage method (12%) and same salary method
   */
  static calculateVacationPay(
    baseSalary: number,
    earnedDays: number,
    method: 'PERCENTAGE' | 'SAME_SALARY' = 'PERCENTAGE',
    earningYear: number = new Date().getFullYear()
  ): VacationPayCalculation {

    const result: VacationPayCalculation = {
      method,
      earningYear,
      baseSalary,
      earnedDays,
      calculatedVacationPay: 0,
      totalVacationPay: 0,
    };

    if (method === 'PERCENTAGE') {
      // Percentage method: 12% of earned salary
      result.percentageRate = VACATION_RATES.PERCENTAGE * 100; // 12%
      result.calculatedVacationPay = baseSalary * VACATION_RATES.PERCENTAGE;
      result.totalVacationPay = result.calculatedVacationPay;

    } else {
      // Same salary method: 0.43% per vacation day
      result.dailyRate = VACATION_RATES.SAME_SALARY_DAILY * 100; // 0.43%
      result.vacationSupplement = baseSalary * VACATION_RATES.SAME_SALARY_DAILY * earnedDays;
      result.calculatedVacationPay = baseSalary; // Employee gets same salary
      result.totalVacationPay = result.calculatedVacationPay + result.vacationSupplement;
    }

    // Round to 2 decimals
    result.calculatedVacationPay = Math.round(result.calculatedVacationPay * 100) / 100;
    result.totalVacationPay = Math.round(result.totalVacationPay * 100) / 100;
    if (result.vacationSupplement) {
      result.vacationSupplement = Math.round(result.vacationSupplement * 100) / 100;
    }

    return result;
  }

  /**
   * Complete Salary Calculation
   * Combines all calculations into one comprehensive result
   */
  static async calculateCompleteSalary(
    employee: Employee,
    salaryConfig: SalaryConfiguration,
    periodId: string,
    additionalInput?: {
      hoursWorked?: number;
      overtimeHours?: number;
      bonus?: number;
      commission?: number;
      otherCompensation?: number;
      vacationDaysTaken?: number;
    }
  ): Promise<SalaryCalculation> {

    // Calculate base salary (monthly or hourly)
    let baseSalary = employee.baseSalary;
    let hoursWorked = additionalInput?.hoursWorked;

    if (employee.salaryType === 'HOURLY' && hoursWorked && employee.hourlyRate) {
      baseSalary = employee.hourlyRate * hoursWorked;
    }

    // Calculate overtime
    const overtimeHours = additionalInput?.overtimeHours || 0;
    const overtimePay = overtimeHours > 0 && employee.hourlyRate
      ? employee.hourlyRate * overtimeHours * 1.5 // 50% overtime premium
      : 0;

    // Calculate benefits
    const benefits =
      salaryConfig.carBenefit +
      salaryConfig.housingBenefit +
      salaryConfig.otherBenefits;

    // Calculate bonuses
    const bonuses =
      (additionalInput?.bonus || 0) +
      (additionalInput?.commission || 0) +
      (additionalInput?.otherCompensation || 0);

    // Calculate gross salary
    const grossSalary = baseSalary + overtimePay + benefits + bonuses;

    // Calculate employer contributions
    const age = this.calculateAge(employee.personalNumber);
    const employerContributions = this.calculateEmployerContributions(
      grossSalary,
      age,
      salaryConfig.usesAgeBasedRate,
      {
        pensionPlan: salaryConfig.pensionPlan,
        itp1Rate: salaryConfig.itp1Rate,
        itp1HighRate: salaryConfig.itp1HighRate,
        itpkRate: salaryConfig.itpkRate,
        customPensionRate: salaryConfig.customPensionRate,
      }
    );

    // Calculate tax
    const taxCalculation = await this.calculateTax(
      grossSalary,
      employee.taxTable,
      employee.taxColumn,
      employee.municipalTaxRate,
      employee.churchTax,
      employee.churchTaxRate
    );

    // Calculate vacation
    const vacationCalculation = this.calculateVacationPay(
      baseSalary,
      25, // Standard 25 days
      employee.vacationCalculationMethod
    );

    // Calculate deductions
    const unionFee = salaryConfig.unionFee;
    const unemploymentInsurance = salaryConfig.unemploymentInsurance;
    const otherDeductions = salaryConfig.otherDeductions;
    const totalDeductions =
      taxCalculation.preliminaryTax +
      unionFee +
      unemploymentInsurance +
      otherDeductions;

    // Calculate net salary
    const netSalary = grossSalary - totalDeductions;

    // Calculate total employer cost
    const totalEmployerCost = grossSalary + employerContributions.totalEmployerCost;

    const result: SalaryCalculation = {
      employeeId: employee.id,
      periodId,
      baseSalary,
      hoursWorked,
      overtime: overtimePay,
      benefits,
      bonuses,
      grossSalary,
      taxCalculation,
      employerContributions,
      vacationCalculation,
      preliminaryTax: taxCalculation.preliminaryTax,
      unionFee,
      unemploymentInsurance,
      otherDeductions,
      totalDeductions,
      netSalary,
      totalEmployerCost,
      calculatedAt: new Date(),
    };

    return result;
  }

  /**
   * Get current income base amount for year
   */
  static async getIncomeBaseAmount(year: number = new Date().getFullYear()): Promise<number> {
    try {
      const query = 'SELECT income_base_amount FROM income_base_amounts WHERE year = $1';
      const result = await pool.query(query, [year]);

      if (result.rows.length > 0) {
        return parseFloat(result.rows[0].income_base_amount);
      }

      // Fallback to 2025 value
      return INCOME_BASE_AMOUNT_2025;
    } catch (error) {
      console.error('Error fetching income base amount:', error);
      return INCOME_BASE_AMOUNT_2025;
    }
  }

  /**
   * Helper: Round to 2 decimals
   */
  static round(value: number): number {
    return Math.round(value * 100) / 100;
  }
}

export default SalaryCalculationService;
