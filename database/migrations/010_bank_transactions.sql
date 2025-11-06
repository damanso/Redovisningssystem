-- Migration: Bank Transactions and Cash Flow Management
-- Description: Tables for bank transaction import, cash flow tracking, salary withdrawals, and expense reimbursements

-- Bank Transactions Table
-- Stores all bank transactions (imported from files or API)
CREATE TABLE IF NOT EXISTS bank_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,

    -- Transaction details
    transaction_date DATE NOT NULL,
    booking_date DATE,
    transaction_id VARCHAR(255), -- Bank's unique transaction ID
    reference_number VARCHAR(255), -- OCR, reference, or payment ID

    -- Transaction type and description
    transaction_type VARCHAR(50) NOT NULL, -- 'debit'|'credit'|'fee'|'interest'
    description TEXT NOT NULL,
    category VARCHAR(100), -- Auto-categorized: 'salary'|'rent'|'supplies'|'income'|etc

    -- Amounts
    amount DECIMAL(15,2) NOT NULL, -- Positive for credit, negative for debit
    currency VARCHAR(3) DEFAULT 'SEK',
    balance_after DECIMAL(15,2), -- Account balance after transaction

    -- Linking to existing records
    linked_invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL,
    linked_receipt_id UUID REFERENCES receipts(id) ON DELETE SET NULL,
    linked_expense_id UUID, -- Will reference expense_reimbursements table
    linked_salary_id UUID, -- Will reference salary_withdrawals table

    -- Import tracking
    import_source VARCHAR(50) NOT NULL, -- 'file_upload'|'api_swedbank'|'api_handelsbanken'|'manual'
    import_batch_id UUID, -- Group transactions from same import
    file_name VARCHAR(255), -- Original filename if uploaded

    -- Duplicate detection
    is_duplicate BOOLEAN DEFAULT FALSE,
    duplicate_of_id UUID REFERENCES bank_transactions(id) ON DELETE SET NULL,
    hash VARCHAR(64), -- SHA-256 hash for duplicate detection

    -- Status and reconciliation
    status VARCHAR(50) DEFAULT 'unmatched', -- 'unmatched'|'matched'|'ignored'|'duplicate'
    is_reconciled BOOLEAN DEFAULT FALSE,
    reconciled_at TIMESTAMP,
    reconciled_by UUID REFERENCES users(id) ON DELETE SET NULL,

    -- Audit fields
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    -- Indexes
    CONSTRAINT unique_transaction_hash UNIQUE (company_id, hash)
);

-- Indexes for bank_transactions
CREATE INDEX idx_bank_transactions_company ON bank_transactions(company_id);
CREATE INDEX idx_bank_transactions_date ON bank_transactions(transaction_date);
CREATE INDEX idx_bank_transactions_type ON bank_transactions(transaction_type);
CREATE INDEX idx_bank_transactions_status ON bank_transactions(status);
CREATE INDEX idx_bank_transactions_batch ON bank_transactions(import_batch_id);
CREATE INDEX idx_bank_transactions_hash ON bank_transactions(hash);

-- Planned Expenses Table
-- Track upcoming bills and expenses that haven't been paid yet
CREATE TABLE IF NOT EXISTS planned_expenses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,

    -- Expense details
    name VARCHAR(255) NOT NULL,
    description TEXT,
    category VARCHAR(100), -- 'rent'|'salary'|'insurance'|'tax'|'utilities'|'loan'|etc

    -- Amounts and dates
    amount DECIMAL(15,2) NOT NULL,
    currency VARCHAR(3) DEFAULT 'SEK',
    due_date DATE NOT NULL,

    -- Recurrence
    is_recurring BOOLEAN DEFAULT FALSE,
    recurrence_frequency VARCHAR(50), -- 'monthly'|'quarterly'|'yearly'|null
    recurrence_day INT, -- Day of month (1-31) for recurring expenses

    -- Status
    status VARCHAR(50) DEFAULT 'pending', -- 'pending'|'paid'|'overdue'|'cancelled'
    paid_via_transaction_id UUID REFERENCES bank_transactions(id) ON DELETE SET NULL,
    paid_date DATE,

    -- Supplier/recipient
    supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL,
    recipient_name VARCHAR(255),

    -- Audit fields
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for planned_expenses
CREATE INDEX idx_planned_expenses_company ON planned_expenses(company_id);
CREATE INDEX idx_planned_expenses_due_date ON planned_expenses(due_date);
CREATE INDEX idx_planned_expenses_status ON planned_expenses(status);
CREATE INDEX idx_planned_expenses_category ON planned_expenses(category);

-- Salary Withdrawals Table
-- Track salary payment requests and approvals
CREATE TABLE IF NOT EXISTS salary_withdrawals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,

    -- Request details
    requested_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    requested_amount DECIMAL(15,2) NOT NULL,
    requested_date DATE NOT NULL,

    -- Approval workflow
    status VARCHAR(50) DEFAULT 'pending', -- 'pending'|'approved'|'rejected'|'paid'|'cancelled'
    approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
    approved_at TIMESTAMP,
    approved_amount DECIMAL(15,2), -- May differ from requested
    rejection_reason TEXT,

    -- Payment details
    payment_date DATE,
    paid_via_transaction_id UUID REFERENCES bank_transactions(id) ON DELETE SET NULL,

    -- Tax and deductions
    gross_amount DECIMAL(15,2),
    tax_amount DECIMAL(15,2),
    net_amount DECIMAL(15,2),

    -- Notes
    notes TEXT,

    -- Audit fields
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for salary_withdrawals
CREATE INDEX idx_salary_withdrawals_company ON salary_withdrawals(company_id);
CREATE INDEX idx_salary_withdrawals_requested_by ON salary_withdrawals(requested_by);
CREATE INDEX idx_salary_withdrawals_status ON salary_withdrawals(status);
CREATE INDEX idx_salary_withdrawals_date ON salary_withdrawals(requested_date);

-- Expense Reimbursements Table
-- Track employee expense claims for reimbursement
CREATE TABLE IF NOT EXISTS expense_reimbursements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,

    -- Claimant details
    claimed_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    claim_date DATE NOT NULL,

    -- Expense details
    expense_date DATE NOT NULL,
    description TEXT NOT NULL,
    category VARCHAR(100), -- 'travel'|'meals'|'supplies'|'equipment'|etc
    amount DECIMAL(15,2) NOT NULL,
    currency VARCHAR(3) DEFAULT 'SEK',

    -- Supporting documentation
    receipt_id UUID REFERENCES receipts(id) ON DELETE SET NULL,
    additional_receipts JSONB, -- Array of file URLs

    -- Approval workflow
    status VARCHAR(50) DEFAULT 'pending', -- 'pending'|'approved'|'rejected'|'paid'|'cancelled'
    approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
    approved_at TIMESTAMP,
    approved_amount DECIMAL(15,2), -- May differ from claimed amount
    rejection_reason TEXT,

    -- Payment details
    payment_date DATE,
    paid_via_transaction_id UUID REFERENCES bank_transactions(id) ON DELETE SET NULL,

    -- Notes
    notes TEXT,

    -- Audit fields
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for expense_reimbursements
CREATE INDEX idx_expense_reimbursements_company ON expense_reimbursements(company_id);
CREATE INDEX idx_expense_reimbursements_claimed_by ON expense_reimbursements(claimed_by);
CREATE INDEX idx_expense_reimbursements_status ON expense_reimbursements(status);
CREATE INDEX idx_expense_reimbursements_date ON expense_reimbursements(expense_date);

-- Cash Flow Settings Table
-- Store cash flow calculation rules and safety margins per company
CREATE TABLE IF NOT EXISTS cash_flow_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,

    -- Safety margins (percentage of total expenses to keep as buffer)
    minimum_balance_amount DECIMAL(15,2) DEFAULT 0, -- Absolute minimum balance
    safety_margin_percentage DECIMAL(5,2) DEFAULT 20.00, -- 20% safety margin

    -- Days to look ahead for planned expenses
    planning_horizon_days INT DEFAULT 90, -- Look 90 days ahead

    -- Auto-categorization rules
    auto_categorization_enabled BOOLEAN DEFAULT TRUE,

    -- Notifications
    low_balance_alert_enabled BOOLEAN DEFAULT TRUE,
    low_balance_threshold DECIMAL(15,2),

    -- Audit fields
    updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    UNIQUE(company_id)
);

-- Add foreign key constraints for linked records
ALTER TABLE bank_transactions
ADD CONSTRAINT fk_linked_expense
FOREIGN KEY (linked_expense_id)
REFERENCES expense_reimbursements(id) ON DELETE SET NULL;

ALTER TABLE bank_transactions
ADD CONSTRAINT fk_linked_salary
FOREIGN KEY (linked_salary_id)
REFERENCES salary_withdrawals(id) ON DELETE SET NULL;

-- Update trigger for updated_at timestamps
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_bank_transactions_updated_at
BEFORE UPDATE ON bank_transactions
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_planned_expenses_updated_at
BEFORE UPDATE ON planned_expenses
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_salary_withdrawals_updated_at
BEFORE UPDATE ON salary_withdrawals
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_expense_reimbursements_updated_at
BEFORE UPDATE ON expense_reimbursements
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_cash_flow_settings_updated_at
BEFORE UPDATE ON cash_flow_settings
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- Comments for documentation
COMMENT ON TABLE bank_transactions IS 'Stores all bank transactions imported from files or API integrations';
COMMENT ON TABLE planned_expenses IS 'Tracks upcoming bills and expenses for cash flow planning';
COMMENT ON TABLE salary_withdrawals IS 'Manages salary payment requests and approvals';
COMMENT ON TABLE expense_reimbursements IS 'Tracks employee expense claims for reimbursement';
COMMENT ON TABLE cash_flow_settings IS 'Company-specific settings for cash flow calculations';
