-- KPI Tracking Migration
-- Purpose: Track and calculate Key Performance Indicators

-- KPI definitions (what KPIs to track)
CREATE TABLE IF NOT EXISTS kpi_definitions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    code VARCHAR(50) NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    category VARCHAR(50) NOT NULL CHECK (category IN ('financial', 'operational', 'customer', 'growth')),
    unit VARCHAR(20) NOT NULL CHECK (unit IN ('currency', 'percentage', 'number', 'ratio')),
    calculation_method TEXT,
    target_value DECIMAL(15, 2),
    target_operator VARCHAR(10) CHECK (target_operator IN ('greater_than', 'less_than', 'equals', 'between')),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_kpi_code UNIQUE (company_id, code)
);

-- KPI values (historical tracking of KPI measurements)
CREATE TABLE IF NOT EXISTS kpi_values (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    kpi_definition_id UUID NOT NULL REFERENCES kpi_definitions(id) ON DELETE CASCADE,
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    value DECIMAL(15, 2) NOT NULL,
    calculated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    notes TEXT,
    metadata JSONB DEFAULT '{}',
    CONSTRAINT check_kpi_value_dates CHECK (period_end >= period_start)
);

-- KPI targets (target values for specific periods)
CREATE TABLE IF NOT EXISTS kpi_targets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    kpi_definition_id UUID NOT NULL REFERENCES kpi_definitions(id) ON DELETE CASCADE,
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    target_value DECIMAL(15, 2) NOT NULL,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT check_kpi_target_dates CHECK (period_end >= period_start)
);

-- Indexes for kpi_definitions
CREATE INDEX idx_kpi_definitions_company ON kpi_definitions(company_id);
CREATE INDEX idx_kpi_definitions_category ON kpi_definitions(category);
CREATE INDEX idx_kpi_definitions_active ON kpi_definitions(is_active);

-- Indexes for kpi_values
CREATE INDEX idx_kpi_values_definition ON kpi_values(kpi_definition_id);
CREATE INDEX idx_kpi_values_period ON kpi_values(period_start, period_end);
CREATE INDEX idx_kpi_values_calculated ON kpi_values(calculated_at);

-- Indexes for kpi_targets
CREATE INDEX idx_kpi_targets_definition ON kpi_targets(kpi_definition_id);
CREATE INDEX idx_kpi_targets_period ON kpi_targets(period_start, period_end);

-- Trigger to auto-update updated_at for kpi_definitions
CREATE OR REPLACE FUNCTION update_kpi_definitions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER kpi_definitions_updated_at
    BEFORE UPDATE ON kpi_definitions
    FOR EACH ROW
    EXECUTE FUNCTION update_kpi_definitions_updated_at();

-- Seed default KPIs
INSERT INTO kpi_definitions (company_id, code, name, description, category, unit, calculation_method, target_value, target_operator)
SELECT
    c.id,
    'REVENUE_GROWTH',
    'Revenue Growth Rate',
    'Month-over-month revenue growth percentage',
    'financial',
    'percentage',
    'Compare current month revenue to previous month',
    10.0,
    'greater_than'
FROM companies c
WHERE NOT EXISTS (
    SELECT 1 FROM kpi_definitions WHERE company_id = c.id AND code = 'REVENUE_GROWTH'
);

INSERT INTO kpi_definitions (company_id, code, name, description, category, unit, calculation_method, target_value, target_operator)
SELECT
    c.id,
    'INVOICE_COLLECTION_TIME',
    'Average Invoice Collection Time',
    'Average days to collect payment after invoice due date',
    'operational',
    'number',
    'Average of (paid_date - due_date) for paid invoices',
    30.0,
    'less_than'
FROM companies c
WHERE NOT EXISTS (
    SELECT 1 FROM kpi_definitions WHERE company_id = c.id AND code = 'INVOICE_COLLECTION_TIME'
);

INSERT INTO kpi_definitions (company_id, code, name, description, category, unit, calculation_method, target_value, target_operator)
SELECT
    c.id,
    'OVERDUE_INVOICE_RATIO',
    'Overdue Invoice Ratio',
    'Percentage of invoices that are overdue',
    'operational',
    'percentage',
    '(Count of overdue invoices / Total invoices) * 100',
    5.0,
    'less_than'
FROM companies c
WHERE NOT EXISTS (
    SELECT 1 FROM kpi_definitions WHERE company_id = c.id AND code = 'OVERDUE_INVOICE_RATIO'
);

INSERT INTO kpi_definitions (company_id, code, name, description, category, unit, calculation_method, target_value, target_operator)
SELECT
    c.id,
    'REVENUE_PER_CUSTOMER',
    'Average Revenue per Customer',
    'Average revenue generated per active customer',
    'customer',
    'currency',
    'Total revenue / Count of active customers',
    50000.0,
    'greater_than'
FROM companies c
WHERE NOT EXISTS (
    SELECT 1 FROM kpi_definitions WHERE company_id = c.id AND code = 'REVENUE_PER_CUSTOMER'
);

INSERT INTO kpi_definitions (company_id, code, name, description, category, unit, calculation_method, target_value, target_operator)
SELECT
    c.id,
    'GROSS_MARGIN',
    'Gross Margin',
    'Gross profit as percentage of revenue',
    'financial',
    'percentage',
    '((Revenue - Cost of Goods Sold) / Revenue) * 100',
    40.0,
    'greater_than'
FROM companies c
WHERE NOT EXISTS (
    SELECT 1 FROM kpi_definitions WHERE company_id = c.id AND code = 'GROSS_MARGIN'
);

-- Function to calculate revenue growth KPI
CREATE OR REPLACE FUNCTION calculate_revenue_growth_kpi(
    p_company_id UUID,
    p_start_date DATE,
    p_end_date DATE
)
RETURNS DECIMAL(15, 2) AS $$
DECLARE
    current_revenue DECIMAL(15, 2);
    previous_revenue DECIMAL(15, 2);
    growth_rate DECIMAL(15, 2);
BEGIN
    -- Get revenue for current period
    SELECT COALESCE(SUM(total_amount), 0)
    INTO current_revenue
    FROM invoices
    WHERE company_id = p_company_id
    AND status != 'cancelled'
    AND invoice_date BETWEEN p_start_date AND p_end_date;

    -- Get revenue for previous period (same length)
    SELECT COALESCE(SUM(total_amount), 0)
    INTO previous_revenue
    FROM invoices
    WHERE company_id = p_company_id
    AND status != 'cancelled'
    AND invoice_date BETWEEN (p_start_date - (p_end_date - p_start_date)) AND (p_start_date - 1);

    -- Calculate growth rate
    IF previous_revenue > 0 THEN
        growth_rate := ((current_revenue - previous_revenue) / previous_revenue) * 100;
    ELSE
        growth_rate := 0;
    END IF;

    RETURN ROUND(growth_rate, 2);
END;
$$ LANGUAGE plpgsql;

-- Function to calculate invoice collection time KPI
CREATE OR REPLACE FUNCTION calculate_collection_time_kpi(
    p_company_id UUID,
    p_start_date DATE,
    p_end_date DATE
)
RETURNS DECIMAL(15, 2) AS $$
DECLARE
    avg_collection_time DECIMAL(15, 2);
BEGIN
    SELECT COALESCE(AVG(EXTRACT(DAY FROM (paid_date - due_date))), 0)
    INTO avg_collection_time
    FROM invoices
    WHERE company_id = p_company_id
    AND status = 'paid'
    AND paid_date BETWEEN p_start_date AND p_end_date
    AND paid_date IS NOT NULL;

    RETURN ROUND(avg_collection_time, 2);
END;
$$ LANGUAGE plpgsql;

-- Function to calculate overdue invoice ratio KPI
CREATE OR REPLACE FUNCTION calculate_overdue_ratio_kpi(
    p_company_id UUID,
    p_start_date DATE,
    p_end_date DATE
)
RETURNS DECIMAL(15, 2) AS $$
DECLARE
    overdue_count INTEGER;
    total_count INTEGER;
    overdue_ratio DECIMAL(15, 2);
BEGIN
    SELECT COUNT(*) FILTER (WHERE status = 'overdue'),
           COUNT(*)
    INTO overdue_count, total_count
    FROM invoices
    WHERE company_id = p_company_id
    AND status IN ('sent', 'overdue')
    AND invoice_date BETWEEN p_start_date AND p_end_date;

    IF total_count > 0 THEN
        overdue_ratio := (overdue_count::DECIMAL / total_count) * 100;
    ELSE
        overdue_ratio := 0;
    END IF;

    RETURN ROUND(overdue_ratio, 2);
END;
$$ LANGUAGE plpgsql;

-- Function to calculate revenue per customer KPI
CREATE OR REPLACE FUNCTION calculate_revenue_per_customer_kpi(
    p_company_id UUID,
    p_start_date DATE,
    p_end_date DATE
)
RETURNS DECIMAL(15, 2) AS $$
DECLARE
    total_revenue DECIMAL(15, 2);
    customer_count INTEGER;
    revenue_per_customer DECIMAL(15, 2);
BEGIN
    SELECT COALESCE(SUM(total_amount), 0)
    INTO total_revenue
    FROM invoices
    WHERE company_id = p_company_id
    AND status != 'cancelled'
    AND invoice_date BETWEEN p_start_date AND p_end_date;

    SELECT COUNT(DISTINCT customer_id)
    INTO customer_count
    FROM invoices
    WHERE company_id = p_company_id
    AND status != 'cancelled'
    AND invoice_date BETWEEN p_start_date AND p_end_date;

    IF customer_count > 0 THEN
        revenue_per_customer := total_revenue / customer_count;
    ELSE
        revenue_per_customer := 0;
    END IF;

    RETURN ROUND(revenue_per_customer, 2);
END;
$$ LANGUAGE plpgsql;

-- Function to calculate gross margin KPI
CREATE OR REPLACE FUNCTION calculate_gross_margin_kpi(
    p_company_id UUID,
    p_start_date DATE,
    p_end_date DATE
)
RETURNS DECIMAL(15, 2) AS $$
DECLARE
    total_revenue DECIMAL(15, 2);
    total_cogs DECIMAL(15, 2);
    gross_margin DECIMAL(15, 2);
BEGIN
    -- Get total revenue (credit on revenue accounts)
    SELECT COALESCE(SUM(jel.credit - jel.debit), 0)
    INTO total_revenue
    FROM journal_entry_lines jel
    JOIN journal_entries je ON jel.journal_entry_id = je.id
    JOIN bas_accounts ba ON jel.account_number = ba.account_number
    WHERE je.company_id = p_company_id
    AND ba.account_type = 'revenue'
    AND je.entry_date BETWEEN p_start_date AND p_end_date;

    -- Get cost of goods sold (debit on expense accounts 4000-4999)
    SELECT COALESCE(SUM(jel.debit - jel.credit), 0)
    INTO total_cogs
    FROM journal_entry_lines jel
    JOIN journal_entries je ON jel.journal_entry_id = je.id
    WHERE je.company_id = p_company_id
    AND jel.account_number BETWEEN 4000 AND 4999
    AND je.entry_date BETWEEN p_start_date AND p_end_date;

    IF total_revenue > 0 THEN
        gross_margin := ((total_revenue - total_cogs) / total_revenue) * 100;
    ELSE
        gross_margin := 0;
    END IF;

    RETURN ROUND(gross_margin, 2);
END;
$$ LANGUAGE plpgsql;

-- Comments
COMMENT ON TABLE kpi_definitions IS 'Definitions of KPIs to track for each company';
COMMENT ON TABLE kpi_values IS 'Historical KPI measurements and calculations';
COMMENT ON TABLE kpi_targets IS 'Target values for KPIs in specific periods';
COMMENT ON FUNCTION calculate_revenue_growth_kpi IS 'Calculate revenue growth rate for a period';
COMMENT ON FUNCTION calculate_collection_time_kpi IS 'Calculate average invoice collection time';
COMMENT ON FUNCTION calculate_overdue_ratio_kpi IS 'Calculate percentage of overdue invoices';
COMMENT ON FUNCTION calculate_revenue_per_customer_kpi IS 'Calculate average revenue per customer';
COMMENT ON FUNCTION calculate_gross_margin_kpi IS 'Calculate gross profit margin percentage';
