-- Budget Management Migration
-- Purpose: Implement budget planning and budget vs actual tracking

-- Budgets table (overall budget periods)
CREATE TABLE IF NOT EXISTS budgets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    status VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'closed', 'archived')),
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT check_budget_dates CHECK (end_date > start_date)
);

-- Budget lines (budget allocations per account and period)
CREATE TABLE IF NOT EXISTS budget_lines (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    budget_id UUID NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
    account_number INTEGER NOT NULL REFERENCES bas_accounts(account_number),
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    budgeted_amount DECIMAL(15, 2) NOT NULL,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT check_budget_line_dates CHECK (period_end >= period_start)
);

-- Budget revisions (track changes to budgets over time)
CREATE TABLE IF NOT EXISTS budget_revisions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    budget_id UUID NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
    revision_number INTEGER NOT NULL,
    revised_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    revision_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    reason TEXT,
    changes JSONB NOT NULL DEFAULT '{}',
    CONSTRAINT unique_budget_revision UNIQUE (budget_id, revision_number)
);

-- Indexes for budgets
CREATE INDEX idx_budgets_company ON budgets(company_id);
CREATE INDEX idx_budgets_status ON budgets(status);
CREATE INDEX idx_budgets_dates ON budgets(start_date, end_date);

-- Indexes for budget_lines
CREATE INDEX idx_budget_lines_budget ON budget_lines(budget_id);
CREATE INDEX idx_budget_lines_account ON budget_lines(account_number);
CREATE INDEX idx_budget_lines_period ON budget_lines(period_start, period_end);

-- Indexes for budget_revisions
CREATE INDEX idx_budget_revisions_budget ON budget_revisions(budget_id);
CREATE INDEX idx_budget_revisions_date ON budget_revisions(revision_date);

-- Trigger to auto-update updated_at for budgets
CREATE OR REPLACE FUNCTION update_budgets_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER budgets_updated_at
    BEFORE UPDATE ON budgets
    FOR EACH ROW
    EXECUTE FUNCTION update_budgets_updated_at();

-- Trigger to auto-update updated_at for budget_lines
CREATE OR REPLACE FUNCTION update_budget_lines_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER budget_lines_updated_at
    BEFORE UPDATE ON budget_lines
    FOR EACH ROW
    EXECUTE FUNCTION update_budget_lines_updated_at();

-- Function to get budget vs actual comparison
CREATE OR REPLACE FUNCTION get_budget_vs_actual(
    p_budget_id UUID,
    p_start_date DATE,
    p_end_date DATE
)
RETURNS TABLE (
    account_number INTEGER,
    account_name VARCHAR(255),
    account_type VARCHAR(50),
    budgeted_amount DECIMAL(15, 2),
    actual_amount DECIMAL(15, 2),
    variance DECIMAL(15, 2),
    variance_percentage DECIMAL(5, 2)
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        ba.account_number,
        ba.account_name,
        ba.account_type,
        COALESCE(SUM(bl.budgeted_amount), 0) as budgeted_amount,
        COALESCE(SUM(
            CASE
                WHEN ba.account_type IN ('revenue', 'liability', 'equity') THEN jel.credit - jel.debit
                ELSE jel.debit - jel.credit
            END
        ), 0) as actual_amount,
        COALESCE(SUM(
            CASE
                WHEN ba.account_type IN ('revenue', 'liability', 'equity') THEN (jel.credit - jel.debit) - bl.budgeted_amount
                ELSE (jel.debit - jel.credit) - bl.budgeted_amount
            END
        ), 0) as variance,
        CASE
            WHEN COALESCE(SUM(bl.budgeted_amount), 0) = 0 THEN 0
            ELSE ROUND(
                (COALESCE(SUM(
                    CASE
                        WHEN ba.account_type IN ('revenue', 'liability', 'equity') THEN (jel.credit - jel.debit) - bl.budgeted_amount
                        ELSE (jel.debit - jel.credit) - bl.budgeted_amount
                    END
                ), 0) / NULLIF(SUM(bl.budgeted_amount), 0)) * 100,
                2
            )
        END as variance_percentage
    FROM
        bas_accounts ba
    LEFT JOIN
        budget_lines bl ON ba.account_number = bl.account_number
        AND bl.budget_id = p_budget_id
        AND bl.period_start <= p_end_date
        AND bl.period_end >= p_start_date
    LEFT JOIN
        journal_entry_lines jel ON ba.account_number = jel.account_number
    LEFT JOIN
        journal_entries je ON jel.journal_entry_id = je.id
        AND je.entry_date BETWEEN p_start_date AND p_end_date
    WHERE
        bl.id IS NOT NULL OR jel.id IS NOT NULL
    GROUP BY
        ba.account_number, ba.account_name, ba.account_type
    ORDER BY
        ba.account_number;
END;
$$ LANGUAGE plpgsql;

-- Comments
COMMENT ON TABLE budgets IS 'Budget periods for financial planning';
COMMENT ON TABLE budget_lines IS 'Budget allocations per account and period';
COMMENT ON TABLE budget_revisions IS 'Track changes to budgets over time';
COMMENT ON FUNCTION get_budget_vs_actual IS 'Compare budgeted amounts to actual spending/revenue';
