-- Add additional fields to companies table
ALTER TABLE companies
ADD COLUMN IF NOT EXISTS address TEXT,
ADD COLUMN IF NOT EXISTS postal_code VARCHAR(20),
ADD COLUMN IF NOT EXISTS city VARCHAR(100),
ADD COLUMN IF NOT EXISTS country VARCHAR(100) DEFAULT 'Sweden',
ADD COLUMN IF NOT EXISTS phone VARCHAR(50),
ADD COLUMN IF NOT EXISTS email VARCHAR(255),
ADD COLUMN IF NOT EXISTS website VARCHAR(255),
ADD COLUMN IF NOT EXISTS vat_number VARCHAR(50),
ADD COLUMN IF NOT EXISTS fiscal_year_start VARCHAR(5) DEFAULT '01-01',
ADD COLUMN IF NOT EXISTS accounting_method VARCHAR(20) DEFAULT 'accrual',
ADD COLUMN IF NOT EXISTS currency VARCHAR(3) DEFAULT 'SEK',
ADD COLUMN IF NOT EXISTS logo_url TEXT,
ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;

-- Add indexes
CREATE INDEX IF NOT EXISTS idx_companies_is_active ON companies(is_active);
CREATE INDEX IF NOT EXISTS idx_companies_email ON companies(email);

-- Add check constraints
ALTER TABLE companies
ADD CONSTRAINT check_accounting_method
CHECK (accounting_method IN ('accrual', 'cash'));

-- Update user_companies role field to support more roles
ALTER TABLE user_companies
DROP CONSTRAINT IF EXISTS check_user_company_role;

ALTER TABLE user_companies
ADD CONSTRAINT check_user_company_role
CHECK (role IN ('owner', 'admin', 'accountant', 'member', 'viewer'));

-- Add index for better query performance
CREATE INDEX IF NOT EXISTS idx_user_companies_role ON user_companies(role);

COMMENT ON COLUMN companies.fiscal_year_start IS 'Format: MM-DD (e.g., 01-01 for January 1st)';
COMMENT ON COLUMN companies.accounting_method IS 'Either accrual or cash basis accounting';
COMMENT ON COLUMN companies.currency IS 'ISO 4217 currency code (e.g., SEK, EUR, USD)';
