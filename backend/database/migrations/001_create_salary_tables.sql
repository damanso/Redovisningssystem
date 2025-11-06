-- =============================================================================
-- Swedish Payroll System Database Schema
-- Compliant with Swedish tax law, pension regulations, and vacation rules
-- =============================================================================

-- ============================================
-- EMPLOYEES TABLE
-- Core employee information
-- ============================================
CREATE TABLE IF NOT EXISTS employees (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL,

    -- Personal Information
    personal_number VARCHAR(13) NOT NULL UNIQUE, -- YYYYMMDD-XXXX
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    email VARCHAR(255) NOT NULL,
    phone VARCHAR(20),
    address TEXT,
    postal_code VARCHAR(10),
    city VARCHAR(100),

    -- Employment Details
    employment_start_date DATE NOT NULL,
    employment_end_date DATE,
    employment_type VARCHAR(50) NOT NULL, -- 'FULL_TIME', 'PART_TIME', 'TEMPORARY', 'PROBATION'
    position VARCHAR(100) NOT NULL,
    department VARCHAR(100),

    -- Salary Information
    base_salary DECIMAL(15, 2) NOT NULL, -- Monthly gross salary
    hourly_rate DECIMAL(10, 2), -- For hourly employees
    salary_type VARCHAR(20) NOT NULL, -- 'MONTHLY', 'HOURLY'

    -- Tax Information
    tax_table VARCHAR(10) NOT NULL, -- e.g., '30', '31', '32', '33', '34'
    tax_column INTEGER NOT NULL DEFAULT 1, -- 1-6
    municipal_tax_rate DECIMAL(5, 2), -- Custom municipal rate if applicable
    church_tax BOOLEAN DEFAULT false,
    church_tax_rate DECIMAL(5, 2) DEFAULT 0,

    -- Vacation Settings
    vacation_days_per_year INTEGER DEFAULT 25,
    vacation_calculation_method VARCHAR(20) DEFAULT 'PERCENTAGE', -- 'PERCENTAGE' or 'SAME_SALARY'

    -- Banking
    bank_account VARCHAR(50) NOT NULL, -- Swedish bank account
    bank_clearing_number VARCHAR(10),

    -- Status
    is_active BOOLEAN DEFAULT true,

    -- Audit
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by UUID,
    updated_by UUID,

    CONSTRAINT fk_employee_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
);

CREATE INDEX idx_employees_company ON employees(company_id);
CREATE INDEX idx_employees_personal_number ON employees(personal_number);
CREATE INDEX idx_employees_active ON employees(is_active);

-- ============================================
-- SALARY CONFIGURATION TABLE
-- Individual salary configuration per employee
-- ============================================
CREATE TABLE IF NOT EXISTS salary_configurations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL UNIQUE,

    -- Employer Contributions (Arbetsgivaravgifter)
    employer_contribution_rate DECIMAL(5, 2) DEFAULT 31.42, -- Full rate
    uses_age_based_rate BOOLEAN DEFAULT true,

    -- Pension Configuration
    pension_plan VARCHAR(20) DEFAULT 'ITP1', -- 'ITP1', 'ITP2', 'NONE', 'CUSTOM'
    itp1_rate DECIMAL(5, 2) DEFAULT 4.5, -- 4.5% up to 7.5 income base amounts
    itp1_high_rate DECIMAL(5, 2) DEFAULT 30.0, -- 30% above 7.5 income base amounts
    itpk_rate DECIMAL(5, 2) DEFAULT 2.0, -- ITPK 2%
    custom_pension_rate DECIMAL(5, 2),

    -- Additional Benefits
    car_benefit DECIMAL(10, 2) DEFAULT 0, -- Monthly car benefit value
    housing_benefit DECIMAL(10, 2) DEFAULT 0,
    other_benefits DECIMAL(10, 2) DEFAULT 0,

    -- Deductions
    union_fee DECIMAL(10, 2) DEFAULT 0, -- Monthly union fee
    unemployment_insurance DECIMAL(10, 2) DEFAULT 0, -- A-kassa
    other_deductions DECIMAL(10, 2) DEFAULT 0,

    -- Effective dates
    valid_from DATE NOT NULL DEFAULT CURRENT_DATE,
    valid_to DATE,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_salary_config_employee FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
);

CREATE INDEX idx_salary_config_employee ON salary_configurations(employee_id);

-- ============================================
-- VACATION ACCRUAL TABLE
-- Tracks vacation earning and debt (Semesterintjäning och skuld)
-- ============================================
CREATE TABLE IF NOT EXISTS vacation_accruals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL,

    -- Accrual Period (Intjänandeår)
    earning_year INTEGER NOT NULL, -- Year when vacation is earned
    vacation_year INTEGER NOT NULL, -- Year when vacation can be taken (earning_year + 1)

    -- Days
    earned_days DECIMAL(5, 2) DEFAULT 0, -- Earned vacation days
    taken_days DECIMAL(5, 2) DEFAULT 0, -- Taken vacation days
    remaining_days DECIMAL(5, 2) DEFAULT 0, -- Remaining days

    -- Monetary Values
    vacation_salary_base DECIMAL(15, 2) DEFAULT 0, -- Base for calculating vacation pay
    accrued_vacation_pay DECIMAL(15, 2) DEFAULT 0, -- 12% of salary (Semesterlöneskuld)
    paid_vacation_pay DECIMAL(15, 2) DEFAULT 0, -- Already paid out
    remaining_vacation_pay DECIMAL(15, 2) DEFAULT 0, -- Remaining debt

    -- Calculations
    calculation_method VARCHAR(20) DEFAULT 'PERCENTAGE', -- 'PERCENTAGE' (12%) or 'SAME_SALARY'

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_vacation_employee FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
    CONSTRAINT unique_vacation_year UNIQUE (employee_id, earning_year)
);

CREATE INDEX idx_vacation_employee ON vacation_accruals(employee_id);
CREATE INDEX idx_vacation_year ON vacation_accruals(earning_year, vacation_year);

-- ============================================
-- TAX TABLES
-- Swedish tax tables from Skatteverket
-- ============================================
CREATE TABLE IF NOT EXISTS tax_tables (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Table identification
    table_number VARCHAR(10) NOT NULL, -- '30', '31', '32', '33', '34'
    column_number INTEGER NOT NULL, -- 1-6
    year INTEGER NOT NULL,

    -- Salary range
    salary_from DECIMAL(15, 2) NOT NULL,
    salary_to DECIMAL(15, 2) NOT NULL,

    -- Tax amount or percentage
    tax_amount DECIMAL(15, 2) NOT NULL,

    -- Metadata
    valid_from DATE NOT NULL,
    valid_to DATE,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT unique_tax_table_entry UNIQUE (table_number, column_number, year, salary_from)
);

CREATE INDEX idx_tax_tables_lookup ON tax_tables(table_number, column_number, year, salary_from, salary_to);

-- ============================================
-- SALARY PERIODS
-- Monthly salary periods for processing payroll
-- ============================================
CREATE TABLE IF NOT EXISTS salary_periods (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL,

    -- Period Details
    period_name VARCHAR(50) NOT NULL, -- e.g., 'Januari 2025'
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    payment_date DATE NOT NULL,

    -- Status
    status VARCHAR(20) DEFAULT 'DRAFT', -- 'DRAFT', 'PROCESSING', 'APPROVED', 'PAID', 'LOCKED'

    -- Statistics
    total_employees INTEGER DEFAULT 0,
    total_gross_salary DECIMAL(15, 2) DEFAULT 0,
    total_net_salary DECIMAL(15, 2) DEFAULT 0,
    total_employer_cost DECIMAL(15, 2) DEFAULT 0,
    total_tax DECIMAL(15, 2) DEFAULT 0,

    -- Audit
    processed_at TIMESTAMP,
    processed_by UUID,
    approved_at TIMESTAMP,
    approved_by UUID,
    locked_at TIMESTAMP,
    locked_by UUID,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_salary_period_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
    CONSTRAINT unique_period UNIQUE (company_id, period_start, period_end)
);

CREATE INDEX idx_salary_periods_company ON salary_periods(company_id);
CREATE INDEX idx_salary_periods_dates ON salary_periods(period_start, period_end);
CREATE INDEX idx_salary_periods_status ON salary_periods(status);

-- ============================================
-- PAYSLIPS (Lönespecifikationer)
-- Individual salary specifications
-- ============================================
CREATE TABLE IF NOT EXISTS payslips (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    salary_period_id UUID NOT NULL,
    employee_id UUID NOT NULL,

    -- Period Info
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    payment_date DATE NOT NULL,

    -- Base Salary
    base_salary DECIMAL(15, 2) NOT NULL,
    hours_worked DECIMAL(10, 2),
    hourly_rate DECIMAL(10, 2),

    -- Additional Compensation
    overtime_hours DECIMAL(10, 2) DEFAULT 0,
    overtime_pay DECIMAL(15, 2) DEFAULT 0,
    bonus DECIMAL(15, 2) DEFAULT 0,
    commission DECIMAL(15, 2) DEFAULT 0,
    vacation_pay DECIMAL(15, 2) DEFAULT 0, -- Semesterlön
    other_compensation DECIMAL(15, 2) DEFAULT 0,

    -- Benefits (Förmåner)
    car_benefit DECIMAL(10, 2) DEFAULT 0,
    housing_benefit DECIMAL(10, 2) DEFAULT 0,
    other_benefits DECIMAL(10, 2) DEFAULT 0,
    total_benefits DECIMAL(15, 2) DEFAULT 0,

    -- Gross Salary (Bruttolön)
    total_gross_salary DECIMAL(15, 2) NOT NULL,

    -- Employer Contributions (Arbetsgivaravgifter)
    employer_social_fees DECIMAL(15, 2) NOT NULL, -- 31.42% or age-adjusted
    employer_pension DECIMAL(15, 2) DEFAULT 0, -- ITP1/ITP2/ITPK
    total_employer_cost DECIMAL(15, 2) NOT NULL,

    -- Employee Deductions
    preliminary_tax DECIMAL(15, 2) NOT NULL, -- Preliminärskatt
    vacation_deduction DECIMAL(15, 2) DEFAULT 0, -- When taking vacation
    union_fee DECIMAL(15, 2) DEFAULT 0,
    unemployment_insurance DECIMAL(15, 2) DEFAULT 0, -- A-kassa
    other_deductions DECIMAL(15, 2) DEFAULT 0,
    total_deductions DECIMAL(15, 2) NOT NULL,

    -- Net Salary (Nettolön)
    net_salary DECIMAL(15, 2) NOT NULL,

    -- Vacation Information
    vacation_days_earned DECIMAL(5, 2) DEFAULT 0,
    vacation_days_taken DECIMAL(5, 2) DEFAULT 0,
    vacation_days_balance DECIMAL(5, 2) DEFAULT 0,
    vacation_pay_accrued DECIMAL(15, 2) DEFAULT 0,
    vacation_pay_balance DECIMAL(15, 2) DEFAULT 0,

    -- Tax Information
    tax_table VARCHAR(10) NOT NULL,
    tax_column INTEGER NOT NULL,
    taxable_income DECIMAL(15, 2) NOT NULL,

    -- Status
    status VARCHAR(20) DEFAULT 'DRAFT', -- 'DRAFT', 'APPROVED', 'SENT', 'PAID'

    -- PDF & Email
    pdf_path TEXT,
    sent_at TIMESTAMP,
    sent_to VARCHAR(255),

    -- Notes
    notes TEXT,

    -- Audit
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    approved_at TIMESTAMP,
    approved_by UUID,

    CONSTRAINT fk_payslip_period FOREIGN KEY (salary_period_id) REFERENCES salary_periods(id) ON DELETE CASCADE,
    CONSTRAINT fk_payslip_employee FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
    CONSTRAINT unique_payslip UNIQUE (salary_period_id, employee_id)
);

CREATE INDEX idx_payslips_period ON payslips(salary_period_id);
CREATE INDEX idx_payslips_employee ON payslips(employee_id);
CREATE INDEX idx_payslips_status ON payslips(status);
CREATE INDEX idx_payslips_dates ON payslips(period_start, period_end);

-- ============================================
-- EMPLOYER CONTRIBUTIONS BREAKDOWN
-- Detailed breakdown of employer contributions per payslip
-- ============================================
CREATE TABLE IF NOT EXISTS employer_contributions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payslip_id UUID NOT NULL UNIQUE,

    -- Contribution Breakdown (2025 rates)
    base_amount DECIMAL(15, 2) NOT NULL, -- Gross salary + benefits

    -- Social Fees (Socialavgifter)
    sickness_insurance DECIMAL(15, 2) DEFAULT 0, -- 3.55%
    parental_insurance DECIMAL(15, 2) DEFAULT 0, -- 2.60%
    old_age_pension DECIMAL(15, 2) DEFAULT 0, -- 10.21%
    survivor_pension DECIMAL(15, 2) DEFAULT 0, -- 0.60%
    labor_market_fee DECIMAL(15, 2) DEFAULT 0, -- 2.64%
    occupational_injury DECIMAL(15, 2) DEFAULT 0, -- 0.20%
    general_wage_tax DECIMAL(15, 2) DEFAULT 0, -- 11.62%

    total_social_fees DECIMAL(15, 2) NOT NULL, -- Sum of above

    -- Pension (Tjänstepension)
    itp1_basic DECIMAL(15, 2) DEFAULT 0, -- 4.5%
    itp1_high DECIMAL(15, 2) DEFAULT 0, -- 30%
    itpk DECIMAL(15, 2) DEFAULT 0, -- 2%
    custom_pension DECIMAL(15, 2) DEFAULT 0,

    total_pension DECIMAL(15, 2) NOT NULL,

    -- Total
    total_employer_cost DECIMAL(15, 2) NOT NULL,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_employer_contrib_payslip FOREIGN KEY (payslip_id) REFERENCES payslips(id) ON DELETE CASCADE
);

CREATE INDEX idx_employer_contrib_payslip ON employer_contributions(payslip_id);

-- ============================================
-- INCOME BASE AMOUNTS (Prisbasbelopp)
-- Used for pension calculations
-- ============================================
CREATE TABLE IF NOT EXISTS income_base_amounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    year INTEGER NOT NULL UNIQUE,
    base_amount DECIMAL(15, 2) NOT NULL, -- Prisbasbelopp
    income_base_amount DECIMAL(15, 2) NOT NULL, -- Inkomstbasbelopp

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insert 2025 values
INSERT INTO income_base_amounts (year, base_amount, income_base_amount)
VALUES (2025, 57300, 67167) ON CONFLICT (year) DO NOTHING;

-- ============================================
-- AUDIT LOG FOR SALARY OPERATIONS
-- Track all changes to salary data
-- ============================================
CREATE TABLE IF NOT EXISTS salary_audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    entity_type VARCHAR(50) NOT NULL, -- 'EMPLOYEE', 'PAYSLIP', 'SALARY_PERIOD', etc.
    entity_id UUID NOT NULL,
    action VARCHAR(50) NOT NULL, -- 'CREATE', 'UPDATE', 'DELETE', 'APPROVE', 'SEND', 'PAY'

    old_values JSONB,
    new_values JSONB,

    user_id UUID NOT NULL,
    ip_address VARCHAR(45),

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_salary_audit_entity ON salary_audit_log(entity_type, entity_id);
CREATE INDEX idx_salary_audit_user ON salary_audit_log(user_id);
CREATE INDEX idx_salary_audit_created ON salary_audit_log(created_at);

-- ============================================
-- TRIGGER FUNCTIONS FOR UPDATED_AT
-- ============================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply triggers
CREATE TRIGGER update_employees_updated_at BEFORE UPDATE ON employees
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_salary_configurations_updated_at BEFORE UPDATE ON salary_configurations
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_vacation_accruals_updated_at BEFORE UPDATE ON vacation_accruals
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_salary_periods_updated_at BEFORE UPDATE ON salary_periods
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_payslips_updated_at BEFORE UPDATE ON payslips
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE employees IS 'Core employee information with Swedish tax and salary settings';
COMMENT ON TABLE salary_configurations IS 'Individual salary configuration including pension and benefits';
COMMENT ON TABLE vacation_accruals IS 'Vacation earning and debt tracking per Swedish law';
COMMENT ON TABLE tax_tables IS 'Swedish tax tables from Skatteverket';
COMMENT ON TABLE salary_periods IS 'Monthly salary periods for payroll processing';
COMMENT ON TABLE payslips IS 'Individual salary specifications (lönespecifikationer)';
COMMENT ON TABLE employer_contributions IS 'Detailed breakdown of employer contributions';
COMMENT ON TABLE income_base_amounts IS 'Yearly income base amounts for pension calculations';
COMMENT ON TABLE salary_audit_log IS 'Audit trail for all salary system operations';
