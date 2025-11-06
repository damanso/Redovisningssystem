/**
 * Employee Service
 * Handles CRUD operations for employees and salary configurations
 */

import pool from '../config/database.js';
import type {
  Employee,
  CreateEmployeeDto,
  UpdateEmployeeDto,
  SalaryConfiguration,
  SalaryConfigurationDto,
  EmployeeWithConfiguration,
  EmployeeListQuery,
  EmployeeStatistics
} from '../types/employee.types.js';
import { SalaryCalculationService } from './salaryCalculationService.js';
import { VacationService } from './vacationService.js';

export class EmployeeService {

  /**
   * Create a new employee
   */
  static async createEmployee(data: CreateEmployeeDto, userId: string): Promise<Employee> {
    // Validate personal number
    const validation = SalaryCalculationService.validatePersonalNumber(data.personalNumber);
    if (!validation.isValid) {
      throw new Error(`Invalid personal number: ${validation.errors?.join(', ')}`);
    }

    const query = `
      INSERT INTO employees (
        company_id, personal_number, first_name, last_name, email, phone,
        address, postal_code, city, employment_start_date, employment_end_date,
        employment_type, position, department, base_salary, hourly_rate, salary_type,
        tax_table, tax_column, municipal_tax_rate, church_tax, church_tax_rate,
        vacation_days_per_year, vacation_calculation_method, bank_account,
        bank_clearing_number, is_active, created_by
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
        $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28
      ) RETURNING *
    `;

    const result = await pool.query(query, [
      data.companyId,
      data.personalNumber,
      data.firstName,
      data.lastName,
      data.email,
      data.phone || null,
      data.address || null,
      data.postalCode || null,
      data.city || null,
      data.employmentStartDate,
      null, // employment_end_date
      data.employmentType,
      data.position,
      data.department || null,
      data.baseSalary,
      data.hourlyRate || null,
      data.salaryType,
      data.taxTable,
      data.taxColumn,
      data.municipalTaxRate || null,
      data.churchTax || false,
      data.churchTaxRate || 0,
      data.vacationDaysPerYear || 25,
      data.vacationCalculationMethod || 'PERCENTAGE',
      data.bankAccount,
      data.bankClearingNumber || null,
      true, // is_active
      userId
    ]);

    const employee = this.mapRowToEmployee(result.rows[0]);

    // Create default salary configuration
    await this.createDefaultSalaryConfiguration(employee.id, validation.age || 30);

    // Create initial vacation accrual
    const currentYear = new Date().getFullYear();
    await VacationService.upsertVacationAccrual({
      employeeId: employee.id,
      earningYear: currentYear,
      earnedDays: 0,
      vacationSalaryBase: 0,
      accruedVacationPay: 0,
      calculationMethod: employee.vacationCalculationMethod
    });

    return employee;
  }

  /**
   * Get employee by ID
   */
  static async getEmployeeById(id: string): Promise<Employee | null> {
    const query = 'SELECT * FROM employees WHERE id = $1';
    const result = await pool.query(query, [id]);

    if (result.rows.length === 0) {
      return null;
    }

    return this.mapRowToEmployee(result.rows[0]);
  }

  /**
   * Get employee with full configuration
   */
  static async getEmployeeWithConfiguration(id: string): Promise<EmployeeWithConfiguration | null> {
    const employee = await this.getEmployeeById(id);
    if (!employee) {
      return null;
    }

    const salaryConfiguration = await this.getSalaryConfiguration(id);
    const currentYear = new Date().getFullYear();
    const currentVacationAccrual = await VacationService.getVacationAccrual(id, currentYear);

    return {
      employee,
      salaryConfiguration: salaryConfiguration || undefined,
      currentVacationAccrual: currentVacationAccrual || undefined
    };
  }

  /**
   * Get all employees for a company
   */
  static async getEmployees(query: EmployeeListQuery): Promise<{ employees: Employee[]; total: number }> {
    let sql = 'SELECT * FROM employees WHERE 1=1';
    const params: any[] = [];
    let paramIndex = 1;

    if (query.companyId) {
      sql += ` AND company_id = $${paramIndex}`;
      params.push(query.companyId);
      paramIndex++;
    }

    if (query.isActive !== undefined) {
      sql += ` AND is_active = $${paramIndex}`;
      params.push(query.isActive);
      paramIndex++;
    }

    if (query.department) {
      sql += ` AND department = $${paramIndex}`;
      params.push(query.department);
      paramIndex++;
    }

    if (query.employmentType) {
      sql += ` AND employment_type = $${paramIndex}`;
      params.push(query.employmentType);
      paramIndex++;
    }

    if (query.search) {
      sql += ` AND (first_name ILIKE $${paramIndex} OR last_name ILIKE $${paramIndex} OR email ILIKE $${paramIndex})`;
      params.push(`%${query.search}%`);
      paramIndex++;
    }

    // Count total
    const countResult = await pool.query(sql.replace('*', 'COUNT(*)'), params);
    const total = parseInt(countResult.rows[0].count);

    // Add sorting
    const sortBy = query.sortBy || 'created_at';
    const sortOrder = query.sortOrder || 'desc';
    sql += ` ORDER BY ${sortBy} ${sortOrder}`;

    // Add pagination
    const limit = query.limit || 50;
    const page = query.page || 1;
    const offset = (page - 1) * limit;

    sql += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(limit, offset);

    const result = await pool.query(sql, params);

    return {
      employees: result.rows.map(row => this.mapRowToEmployee(row)),
      total
    };
  }

  /**
   * Update employee
   */
  static async updateEmployee(id: string, data: UpdateEmployeeDto, userId: string): Promise<Employee> {
    const updates: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    // Build dynamic UPDATE query
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

    updates.push(`updated_by = $${paramIndex}`);
    params.push(userId);
    paramIndex++;

    params.push(id);

    const query = `
      UPDATE employees
      SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP
      WHERE id = $${paramIndex}
      RETURNING *
    `;

    const result = await pool.query(query, params);

    if (result.rows.length === 0) {
      throw new Error('Employee not found');
    }

    return this.mapRowToEmployee(result.rows[0]);
  }

  /**
   * Delete employee (soft delete)
   */
  static async deleteEmployee(id: string, userId: string): Promise<void> {
    const query = `
      UPDATE employees
      SET is_active = false, updated_by = $1, updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
    `;

    await pool.query(query, [userId, id]);
  }

  /**
   * Get or create salary configuration
   */
  static async getSalaryConfiguration(employeeId: string): Promise<SalaryConfiguration | null> {
    const query = 'SELECT * FROM salary_configurations WHERE employee_id = $1';
    const result = await pool.query(query, [employeeId]);

    if (result.rows.length === 0) {
      return null;
    }

    return this.mapRowToSalaryConfiguration(result.rows[0]);
  }

  /**
   * Create default salary configuration
   */
  static async createDefaultSalaryConfiguration(
    employeeId: string,
    age: number
  ): Promise<SalaryConfiguration> {
    // Determine default pension plan based on age
    // Born 1979 or later = ITP1, earlier = ITP2
    const currentYear = new Date().getFullYear();
    const birthYear = currentYear - age;
    const defaultPensionPlan = birthYear >= 1979 ? 'ITP1' : 'ITP2';

    const query = `
      INSERT INTO salary_configurations (
        employee_id, employer_contribution_rate, uses_age_based_rate,
        pension_plan, itp1_rate, itp1_high_rate, itpk_rate,
        car_benefit, housing_benefit, other_benefits,
        union_fee, unemployment_insurance, other_deductions,
        valid_from
      ) VALUES (
        $1, 31.42, true, $2, 4.5, 30.0, 2.0,
        0, 0, 0, 0, 0, 0, CURRENT_DATE
      ) RETURNING *
    `;

    const result = await pool.query(query, [employeeId, defaultPensionPlan]);
    return this.mapRowToSalaryConfiguration(result.rows[0]);
  }

  /**
   * Update salary configuration
   */
  static async updateSalaryConfiguration(
    employeeId: string,
    data: SalaryConfigurationDto
  ): Promise<SalaryConfiguration> {
    const existing = await this.getSalaryConfiguration(employeeId);

    if (!existing) {
      throw new Error('Salary configuration not found');
    }

    const updates: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    Object.entries(data).forEach(([key, value]) => {
      if (value !== undefined && key !== 'employeeId') {
        const snakeKey = this.camelToSnake(key);
        updates.push(`${snakeKey} = $${paramIndex}`);
        params.push(value);
        paramIndex++;
      }
    });

    if (updates.length === 0) {
      return existing;
    }

    params.push(employeeId);

    const query = `
      UPDATE salary_configurations
      SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP
      WHERE employee_id = $${paramIndex}
      RETURNING *
    `;

    const result = await pool.query(query, params);
    return this.mapRowToSalaryConfiguration(result.rows[0]);
  }

  /**
   * Get employee statistics for a company
   */
  static async getEmployeeStatistics(companyId: string): Promise<EmployeeStatistics> {
    const queries = await Promise.all([
      pool.query('SELECT COUNT(*) as count FROM employees WHERE company_id = $1', [companyId]),
      pool.query('SELECT COUNT(*) as count FROM employees WHERE company_id = $1 AND is_active = true', [companyId]),
      pool.query('SELECT COUNT(*) as count FROM employees WHERE company_id = $1 AND is_active = false', [companyId]),
      pool.query('SELECT department, COUNT(*) as count FROM employees WHERE company_id = $1 AND is_active = true GROUP BY department', [companyId]),
      pool.query('SELECT employment_type, COUNT(*) as count FROM employees WHERE company_id = $1 AND is_active = true GROUP BY employment_type', [companyId]),
      pool.query('SELECT SUM(base_salary) as total FROM employees WHERE company_id = $1 AND is_active = true', [companyId])
    ]);

    const byDepartment: { [key: string]: number } = {};
    queries[3].rows.forEach(row => {
      byDepartment[row.department || 'Ingen avdelning'] = parseInt(row.count);
    });

    const byEmploymentType: { [key: string]: number } = {};
    queries[4].rows.forEach(row => {
      byEmploymentType[row.employment_type] = parseInt(row.count);
    });

    const totalMonthlySalaryCost = parseFloat(queries[5].rows[0].total || 0);

    return {
      totalEmployees: parseInt(queries[0].rows[0].count),
      activeEmployees: parseInt(queries[1].rows[0].count),
      inactiveEmployees: parseInt(queries[2].rows[0].count),
      byDepartment,
      byEmploymentType,
      totalMonthlySalaryCost,
      totalYearlySalaryCost: totalMonthlySalaryCost * 12
    };
  }

  /**
   * Map database row to Employee object
   */
  private static mapRowToEmployee(row: any): Employee {
    return {
      id: row.id,
      companyId: row.company_id,
      personalNumber: row.personal_number,
      firstName: row.first_name,
      lastName: row.last_name,
      email: row.email,
      phone: row.phone,
      address: row.address,
      postalCode: row.postal_code,
      city: row.city,
      employmentStartDate: new Date(row.employment_start_date),
      employmentEndDate: row.employment_end_date ? new Date(row.employment_end_date) : undefined,
      employmentType: row.employment_type,
      position: row.position,
      department: row.department,
      baseSalary: parseFloat(row.base_salary),
      hourlyRate: row.hourly_rate ? parseFloat(row.hourly_rate) : undefined,
      salaryType: row.salary_type,
      taxTable: row.tax_table,
      taxColumn: row.tax_column,
      municipalTaxRate: row.municipal_tax_rate ? parseFloat(row.municipal_tax_rate) : undefined,
      churchTax: row.church_tax,
      churchTaxRate: parseFloat(row.church_tax_rate),
      vacationDaysPerYear: row.vacation_days_per_year,
      vacationCalculationMethod: row.vacation_calculation_method,
      bankAccount: row.bank_account,
      bankClearingNumber: row.bank_clearing_number,
      isActive: row.is_active,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
      createdBy: row.created_by,
      updatedBy: row.updated_by
    };
  }

  /**
   * Map database row to SalaryConfiguration object
   */
  private static mapRowToSalaryConfiguration(row: any): SalaryConfiguration {
    return {
      id: row.id,
      employeeId: row.employee_id,
      employerContributionRate: parseFloat(row.employer_contribution_rate),
      usesAgeBasedRate: row.uses_age_based_rate,
      pensionPlan: row.pension_plan,
      itp1Rate: parseFloat(row.itp1_rate),
      itp1HighRate: parseFloat(row.itp1_high_rate),
      itpkRate: parseFloat(row.itpk_rate),
      customPensionRate: row.custom_pension_rate ? parseFloat(row.custom_pension_rate) : undefined,
      carBenefit: parseFloat(row.car_benefit),
      housingBenefit: parseFloat(row.housing_benefit),
      otherBenefits: parseFloat(row.other_benefits),
      unionFee: parseFloat(row.union_fee),
      unemploymentInsurance: parseFloat(row.unemployment_insurance),
      otherDeductions: parseFloat(row.other_deductions),
      validFrom: new Date(row.valid_from),
      validTo: row.valid_to ? new Date(row.valid_to) : undefined,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at)
    };
  }

  /**
   * Convert camelCase to snake_case
   */
  private static camelToSnake(str: string): string {
    return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
  }
}

export default EmployeeService;
