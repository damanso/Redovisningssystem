/**
 * Swedish Payroll System - Employee Types
 * Complete type definitions for employee management
 */

export type EmploymentType = 'FULL_TIME' | 'PART_TIME' | 'TEMPORARY' | 'PROBATION';
export type SalaryType = 'MONTHLY' | 'HOURLY';
export type VacationCalculationMethod = 'PERCENTAGE' | 'SAME_SALARY';
export type PensionPlan = 'ITP1' | 'ITP2' | 'NONE' | 'CUSTOM';

/**
 * Core Employee Interface
 */
export interface Employee {
  id: string;
  companyId: string;

  // Personal Information
  personalNumber: string; // YYYYMMDD-XXXX format
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  address?: string;
  postalCode?: string;
  city?: string;

  // Employment Details
  employmentStartDate: Date;
  employmentEndDate?: Date;
  employmentType: EmploymentType;
  position: string;
  department?: string;

  // Salary Information
  baseSalary: number; // Monthly gross salary
  hourlyRate?: number;
  salaryType: SalaryType;

  // Tax Information
  taxTable: string; // '30', '31', '32', '33', '34'
  taxColumn: number; // 1-6
  municipalTaxRate?: number;
  churchTax: boolean;
  churchTaxRate: number;

  // Vacation Settings
  vacationDaysPerYear: number; // Usually 25
  vacationCalculationMethod: VacationCalculationMethod;

  // Banking
  bankAccount: string;
  bankClearingNumber?: string;

  // Status
  isActive: boolean;

  // Audit
  createdAt: Date;
  updatedAt: Date;
  createdBy?: string;
  updatedBy?: string;
}

/**
 * Employee Creation DTO
 */
export interface CreateEmployeeDto {
  companyId: string;

  // Personal
  personalNumber: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  address?: string;
  postalCode?: string;
  city?: string;

  // Employment
  employmentStartDate: Date | string;
  employmentType: EmploymentType;
  position: string;
  department?: string;

  // Salary
  baseSalary: number;
  hourlyRate?: number;
  salaryType: SalaryType;

  // Tax
  taxTable: string;
  taxColumn: number;
  municipalTaxRate?: number;
  churchTax?: boolean;
  churchTaxRate?: number;

  // Vacation
  vacationDaysPerYear?: number;
  vacationCalculationMethod?: VacationCalculationMethod;

  // Banking
  bankAccount: string;
  bankClearingNumber?: string;
}

/**
 * Employee Update DTO
 */
export interface UpdateEmployeeDto {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  address?: string;
  postalCode?: string;
  city?: string;

  employmentEndDate?: Date | string;
  employmentType?: EmploymentType;
  position?: string;
  department?: string;

  baseSalary?: number;
  hourlyRate?: number;
  salaryType?: SalaryType;

  taxTable?: string;
  taxColumn?: number;
  municipalTaxRate?: number;
  churchTax?: boolean;
  churchTaxRate?: number;

  vacationDaysPerYear?: number;
  vacationCalculationMethod?: VacationCalculationMethod;

  bankAccount?: string;
  bankClearingNumber?: string;

  isActive?: boolean;
}

/**
 * Salary Configuration for Individual Employee
 */
export interface SalaryConfiguration {
  id: string;
  employeeId: string;

  // Employer Contributions
  employerContributionRate: number; // 31.42% or age-adjusted
  usesAgeBasedRate: boolean;

  // Pension Configuration
  pensionPlan: PensionPlan;
  itp1Rate: number; // 4.5%
  itp1HighRate: number; // 30%
  itpkRate: number; // 2%
  customPensionRate?: number;

  // Benefits
  carBenefit: number;
  housingBenefit: number;
  otherBenefits: number;

  // Deductions
  unionFee: number;
  unemploymentInsurance: number;
  otherDeductions: number;

  // Validity
  validFrom: Date;
  validTo?: Date;

  createdAt: Date;
  updatedAt: Date;
}

/**
 * Create/Update Salary Configuration
 */
export interface SalaryConfigurationDto {
  employeeId: string;

  employerContributionRate?: number;
  usesAgeBasedRate?: boolean;

  pensionPlan?: PensionPlan;
  itp1Rate?: number;
  itp1HighRate?: number;
  itpkRate?: number;
  customPensionRate?: number;

  carBenefit?: number;
  housingBenefit?: number;
  otherBenefits?: number;

  unionFee?: number;
  unemploymentInsurance?: number;
  otherDeductions?: number;

  validFrom?: Date | string;
  validTo?: Date | string;
}

/**
 * Employee with Full Configuration
 */
export interface EmployeeWithConfiguration {
  employee: Employee;
  salaryConfiguration?: SalaryConfiguration;
  currentVacationAccrual?: VacationAccrual;
}

/**
 * Vacation Accrual
 */
export interface VacationAccrual {
  id: string;
  employeeId: string;

  // Periods
  earningYear: number;
  vacationYear: number;

  // Days
  earnedDays: number;
  takenDays: number;
  remainingDays: number;

  // Money
  vacationSalaryBase: number;
  accruedVacationPay: number;
  paidVacationPay: number;
  remainingVacationPay: number;

  calculationMethod: VacationCalculationMethod;

  createdAt: Date;
  updatedAt: Date;
}

/**
 * Vacation Accrual DTO
 */
export interface VacationAccrualDto {
  employeeId: string;
  earningYear: number;
  earnedDays?: number;
  takenDays?: number;
  vacationSalaryBase?: number;
  accruedVacationPay?: number;
  paidVacationPay?: number;
  calculationMethod?: VacationCalculationMethod;
}

/**
 * Employee List Query Parameters
 */
export interface EmployeeListQuery {
  companyId?: string;
  isActive?: boolean;
  department?: string;
  employmentType?: EmploymentType;
  search?: string;
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

/**
 * Employee Statistics
 */
export interface EmployeeStatistics {
  totalEmployees: number;
  activeEmployees: number;
  inactiveEmployees: number;
  byDepartment: { [department: string]: number };
  byEmploymentType: { [type: string]: number };
  totalMonthlySalaryCost: number;
  totalYearlySalaryCost: number;
}
