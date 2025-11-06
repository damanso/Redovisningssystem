/**
 * Swedish Payroll System - Salary & Payslip Types
 * Complete type definitions for salary calculations and payslips
 */

export type SalaryPeriodStatus = 'DRAFT' | 'PROCESSING' | 'APPROVED' | 'PAID' | 'LOCKED';
export type PayslipStatus = 'DRAFT' | 'APPROVED' | 'SENT' | 'PAID';

/**
 * Salary Period (Löneperiod)
 */
export interface SalaryPeriod {
  id: string;
  companyId: string;

  // Period Details
  periodName: string; // e.g., 'Januari 2025'
  periodStart: Date;
  periodEnd: Date;
  paymentDate: Date;

  // Status
  status: SalaryPeriodStatus;

  // Statistics
  totalEmployees: number;
  totalGrossSalary: number;
  totalNetSalary: number;
  totalEmployerCost: number;
  totalTax: number;

  // Audit
  processedAt?: Date;
  processedBy?: string;
  approvedAt?: Date;
  approvedBy?: string;
  lockedAt?: Date;
  lockedBy?: string;

  createdAt: Date;
  updatedAt: Date;
}

/**
 * Create Salary Period DTO
 */
export interface CreateSalaryPeriodDto {
  companyId: string;
  periodName: string;
  periodStart: Date | string;
  periodEnd: Date | string;
  paymentDate: Date | string;
}

/**
 * Update Salary Period DTO
 */
export interface UpdateSalaryPeriodDto {
  periodName?: string;
  periodStart?: Date | string;
  periodEnd?: Date | string;
  paymentDate?: Date | string;
  status?: SalaryPeriodStatus;
}

/**
 * Payslip (Lönespecifikation)
 */
export interface Payslip {
  id: string;
  salaryPeriodId: string;
  employeeId: string;

  // Period Info
  periodStart: Date;
  periodEnd: Date;
  paymentDate: Date;

  // Base Salary
  baseSalary: number;
  hoursWorked?: number;
  hourlyRate?: number;

  // Additional Compensation
  overtimeHours: number;
  overtimePay: number;
  bonus: number;
  commission: number;
  vacationPay: number;
  otherCompensation: number;

  // Benefits (Förmåner)
  carBenefit: number;
  housingBenefit: number;
  otherBenefits: number;
  totalBenefits: number;

  // Gross Salary (Bruttolön)
  totalGrossSalary: number;

  // Employer Contributions (Arbetsgivaravgifter)
  employerSocialFees: number; // 31.42% or age-adjusted
  employerPension: number; // ITP1/ITP2/ITPK
  totalEmployerCost: number;

  // Employee Deductions
  preliminaryTax: number;
  vacationDeduction: number;
  unionFee: number;
  unemploymentInsurance: number;
  otherDeductions: number;
  totalDeductions: number;

  // Net Salary (Nettolön)
  netSalary: number;

  // Vacation Information
  vacationDaysEarned: number;
  vacationDaysTaken: number;
  vacationDaysBalance: number;
  vacationPayAccrued: number;
  vacationPayBalance: number;

  // Tax Information
  taxTable: string;
  taxColumn: number;
  taxableIncome: number;

  // Status
  status: PayslipStatus;

  // PDF & Email
  pdfPath?: string;
  sentAt?: Date;
  sentTo?: string;

  // Notes
  notes?: string;

  // Audit
  createdAt: Date;
  updatedAt: Date;
  approvedAt?: Date;
  approvedBy?: string;
}

/**
 * Create Payslip DTO
 */
export interface CreatePayslipDto {
  salaryPeriodId: string;
  employeeId: string;

  baseSalary: number;
  hoursWorked?: number;
  hourlyRate?: number;

  overtimeHours?: number;
  overtimePay?: number;
  bonus?: number;
  commission?: number;
  vacationPay?: number;
  otherCompensation?: number;

  carBenefit?: number;
  housingBenefit?: number;
  otherBenefits?: number;

  vacationDaysTaken?: number;

  notes?: string;
}

/**
 * Update Payslip DTO
 */
export interface UpdatePayslipDto {
  baseSalary?: number;
  hoursWorked?: number;
  overtimeHours?: number;
  overtimePay?: number;
  bonus?: number;
  commission?: number;
  vacationPay?: number;
  otherCompensation?: number;

  carBenefit?: number;
  housingBenefit?: number;
  otherBenefits?: number;

  vacationDaysTaken?: number;

  notes?: string;
  status?: PayslipStatus;
}

/**
 * Employer Contributions Breakdown
 */
export interface EmployerContributions {
  id: string;
  payslipId: string;

  // Base
  baseAmount: number;

  // Social Fees Breakdown (2025 rates)
  sicknessInsurance: number; // 3.55%
  parentalInsurance: number; // 2.60%
  oldAgePension: number; // 10.21%
  survivorPension: number; // 0.60%
  laborMarketFee: number; // 2.64%
  occupationalInjury: number; // 0.20%
  generalWageTax: number; // 11.62%

  totalSocialFees: number; // Sum of above

  // Pension
  itp1Basic: number; // 4.5%
  itp1High: number; // 30%
  itpk: number; // 2%
  customPension: number;

  totalPension: number;

  // Total
  totalEmployerCost: number;

  createdAt: Date;
}

/**
 * Tax Table Entry
 */
export interface TaxTable {
  id: string;
  tableNumber: string; // '30', '31', '32', '33', '34'
  columnNumber: number; // 1-6
  year: number;

  salaryFrom: number;
  salaryTo: number;
  taxAmount: number;

  validFrom: Date;
  validTo?: Date;

  createdAt: Date;
}

/**
 * Tax Calculation Result
 */
export interface TaxCalculation {
  grossSalary: number;
  taxableIncome: number;
  taxTable: string;
  taxColumn: number;
  preliminaryTax: number;
  municipalTax?: number;
  churchTax?: number;
  effectiveTaxRate: number;
}

/**
 * Employer Contribution Calculation
 */
export interface EmployerContributionCalculation {
  baseAmount: number;
  age: number;
  usesAgeBasedRate: boolean;

  // Social fees
  sicknessInsurance: number;
  parentalInsurance: number;
  oldAgePension: number;
  survivorPension: number;
  laborMarketFee: number;
  occupationalInjury: number;
  generalWageTax: number;
  totalSocialFees: number;

  // Pension
  itp1Basic: number;
  itp1High: number;
  itpk: number;
  customPension: number;
  totalPension: number;

  // Total
  totalEmployerCost: number;
  employerCostPercentage: number;
}

/**
 * Vacation Pay Calculation
 */
export interface VacationPayCalculation {
  method: 'PERCENTAGE' | 'SAME_SALARY';
  earningYear: number;
  baseSalary: number;
  earnedDays: number;

  // Percentage method (12%)
  percentageRate?: number;
  calculatedVacationPay: number;

  // Same salary method (0.43% per day)
  dailyRate?: number;
  vacationSupplement?: number;

  totalVacationPay: number;
}

/**
 * Complete Salary Calculation
 */
export interface SalaryCalculation {
  employeeId: string;
  periodId: string;

  // Input
  baseSalary: number;
  hoursWorked?: number;
  overtime: number;
  benefits: number;
  bonuses: number;

  // Calculations
  grossSalary: number;
  taxCalculation: TaxCalculation;
  employerContributions: EmployerContributionCalculation;
  vacationCalculation?: VacationPayCalculation;

  // Deductions
  preliminaryTax: number;
  unionFee: number;
  unemploymentInsurance: number;
  otherDeductions: number;
  totalDeductions: number;

  // Result
  netSalary: number;
  totalEmployerCost: number;

  // Metadata
  calculatedAt: Date;
}

/**
 * Income Base Amounts (Prisbasbelopp)
 */
export interface IncomeBaseAmount {
  id: string;
  year: number;
  baseAmount: number; // Prisbasbelopp
  incomeBaseAmount: number; // Inkomstbasbelopp
  createdAt: Date;
}

/**
 * Payslip with Full Details
 */
export interface PayslipWithDetails {
  payslip: Payslip;
  employee: {
    id: string;
    personalNumber: string;
    firstName: string;
    lastName: string;
    email: string;
    position: string;
    department?: string;
  };
  employerContributions: EmployerContributions;
  salaryPeriod: {
    id: string;
    periodName: string;
    paymentDate: Date;
  };
}

/**
 * Salary Period Summary
 */
export interface SalaryPeriodSummary {
  period: SalaryPeriod;
  payslips: Payslip[];
  statistics: {
    totalEmployees: number;
    totalGrossSalary: number;
    totalNetSalary: number;
    totalEmployerCost: number;
    totalTax: number;
    totalBenefits: number;
    totalDeductions: number;
    averageGrossSalary: number;
    averageNetSalary: number;
  };
}

/**
 * Personal Number Validation Result
 */
export interface PersonalNumberValidation {
  isValid: boolean;
  personalNumber: string;
  birthDate?: Date;
  age?: number;
  gender?: 'MALE' | 'FEMALE';
  errors?: string[];
}

/**
 * Salary Report Filters
 */
export interface SalaryReportFilters {
  companyId: string;
  startDate: Date | string;
  endDate: Date | string;
  department?: string;
  employeeIds?: string[];
  includeInactive?: boolean;
}

/**
 * Export Format Options
 */
export type ExportFormat = 'CSV' | 'XLSX' | 'PDF';

export interface ExportOptions {
  format: ExportFormat;
  includeDetails: boolean;
  includeEmployerCosts: boolean;
  includeVacationInfo: boolean;
}
