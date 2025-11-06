-- Cash Flow Forecasting Migration
-- Purpose: Predict future cash positions based on historical data and expected transactions

-- Cash flow forecasts (overall forecast scenarios)
CREATE TABLE IF NOT EXISTS cash_flow_forecasts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    forecast_type VARCHAR(20) NOT NULL CHECK (forecast_type IN ('conservative', 'realistic', 'optimistic')),
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    opening_balance DECIMAL(15, 2) NOT NULL DEFAULT 0,
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT check_forecast_dates CHECK (end_date > start_date)
);

-- Cash flow forecast lines (projected cash inflows and outflows)
CREATE TABLE IF NOT EXISTS cash_flow_forecast_lines (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    forecast_id UUID NOT NULL REFERENCES cash_flow_forecasts(id) ON DELETE CASCADE,
    transaction_date DATE NOT NULL,
    category VARCHAR(50) NOT NULL CHECK (category IN ('receivables', 'payables', 'revenue', 'expense', 'other')),
    description TEXT,
    amount DECIMAL(15, 2) NOT NULL,
    confidence_level DECIMAL(5, 2) DEFAULT 100.0 CHECK (confidence_level BETWEEN 0 AND 100),
    source_type VARCHAR(50),  -- 'invoice', 'receipt', 'recurring', 'manual'
    source_id UUID,
    is_recurring BOOLEAN DEFAULT false,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Cash flow patterns (historical patterns for forecasting)
CREATE TABLE IF NOT EXISTS cash_flow_patterns (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    pattern_type VARCHAR(50) NOT NULL CHECK (pattern_type IN ('seasonal', 'weekly', 'monthly', 'quarterly')),
    category VARCHAR(50) NOT NULL CHECK (category IN ('receivables', 'payables', 'revenue', 'expense')),
    period_identifier VARCHAR(50) NOT NULL,  -- 'Q1', 'January', 'Week1', etc.
    average_amount DECIMAL(15, 2) NOT NULL,
    std_deviation DECIMAL(15, 2),
    sample_size INTEGER NOT NULL,
    last_calculated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_pattern UNIQUE (company_id, pattern_type, category, period_identifier)
);

-- Cash flow scenarios (what-if analysis)
CREATE TABLE IF NOT EXISTS cash_flow_scenarios (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    base_forecast_id UUID REFERENCES cash_flow_forecasts(id) ON DELETE SET NULL,
    assumptions JSONB NOT NULL DEFAULT '{}',
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for cash_flow_forecasts
CREATE INDEX idx_cash_flow_forecasts_company ON cash_flow_forecasts(company_id);
CREATE INDEX idx_cash_flow_forecasts_dates ON cash_flow_forecasts(start_date, end_date);
CREATE INDEX idx_cash_flow_forecasts_type ON cash_flow_forecasts(forecast_type);

-- Indexes for cash_flow_forecast_lines
CREATE INDEX idx_cash_flow_lines_forecast ON cash_flow_forecast_lines(forecast_id);
CREATE INDEX idx_cash_flow_lines_date ON cash_flow_forecast_lines(transaction_date);
CREATE INDEX idx_cash_flow_lines_category ON cash_flow_forecast_lines(category);
CREATE INDEX idx_cash_flow_lines_source ON cash_flow_forecast_lines(source_type, source_id);

-- Indexes for cash_flow_patterns
CREATE INDEX idx_cash_flow_patterns_company ON cash_flow_patterns(company_id);
CREATE INDEX idx_cash_flow_patterns_type ON cash_flow_patterns(pattern_type, category);

-- Indexes for cash_flow_scenarios
CREATE INDEX idx_cash_flow_scenarios_company ON cash_flow_scenarios(company_id);
CREATE INDEX idx_cash_flow_scenarios_base ON cash_flow_scenarios(base_forecast_id);

-- Trigger to auto-update updated_at for cash_flow_forecasts
CREATE OR REPLACE FUNCTION update_cash_flow_forecasts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER cash_flow_forecasts_updated_at
    BEFORE UPDATE ON cash_flow_forecasts
    FOR EACH ROW
    EXECUTE FUNCTION update_cash_flow_forecasts_updated_at();

-- Trigger to auto-update updated_at for cash_flow_scenarios
CREATE OR REPLACE FUNCTION update_cash_flow_scenarios_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER cash_flow_scenarios_updated_at
    BEFORE UPDATE ON cash_flow_scenarios
    FOR EACH ROW
    EXECUTE FUNCTION update_cash_flow_scenarios_updated_at();

-- Function to calculate historical payment patterns
CREATE OR REPLACE FUNCTION calculate_payment_patterns(p_company_id UUID)
RETURNS void AS $$
BEGIN
    -- Delete old patterns
    DELETE FROM cash_flow_patterns WHERE company_id = p_company_id;

    -- Monthly receivables pattern
    INSERT INTO cash_flow_patterns (company_id, pattern_type, category, period_identifier, average_amount, std_deviation, sample_size)
    SELECT
        p_company_id,
        'monthly',
        'receivables',
        TO_CHAR(paid_date, 'Month'),
        AVG(total_amount),
        STDDEV(total_amount),
        COUNT(*)
    FROM invoices
    WHERE company_id = p_company_id
    AND status = 'paid'
    AND paid_date IS NOT NULL
    AND paid_date >= CURRENT_DATE - INTERVAL '2 years'
    GROUP BY TO_CHAR(paid_date, 'Month')
    HAVING COUNT(*) >= 3;

    -- Quarterly receivables pattern
    INSERT INTO cash_flow_patterns (company_id, pattern_type, category, period_identifier, average_amount, std_deviation, sample_size)
    SELECT
        p_company_id,
        'quarterly',
        'receivables',
        'Q' || EXTRACT(QUARTER FROM paid_date)::TEXT,
        AVG(total_amount),
        STDDEV(total_amount),
        COUNT(*)
    FROM invoices
    WHERE company_id = p_company_id
    AND status = 'paid'
    AND paid_date IS NOT NULL
    AND paid_date >= CURRENT_DATE - INTERVAL '2 years'
    GROUP BY EXTRACT(QUARTER FROM paid_date)
    HAVING COUNT(*) >= 3;

    -- Monthly expenses pattern
    INSERT INTO cash_flow_patterns (company_id, pattern_type, category, period_identifier, average_amount, std_deviation, sample_size)
    SELECT
        p_company_id,
        'monthly',
        'expense',
        TO_CHAR(r.created_at, 'Month'),
        AVG(r.total_amount),
        STDDEV(r.total_amount),
        COUNT(*)
    FROM receipts r
    WHERE r.company_id = p_company_id
    AND r.status = 'booked'
    AND r.created_at >= CURRENT_DATE - INTERVAL '2 years'
    GROUP BY TO_CHAR(r.created_at, 'Month')
    HAVING COUNT(*) >= 3;

END;
$$ LANGUAGE plpgsql;

-- Function to generate cash flow forecast
CREATE OR REPLACE FUNCTION generate_cash_flow_forecast(
    p_company_id UUID,
    p_forecast_id UUID,
    p_start_date DATE,
    p_end_date DATE,
    p_forecast_type VARCHAR(20)
)
RETURNS void AS $$
DECLARE
    confidence_multiplier DECIMAL(5, 2);
    v_date DATE;
    expected_receivables DECIMAL(15, 2);
    expected_payables DECIMAL(15, 2);
BEGIN
    -- Set confidence multiplier based on forecast type
    confidence_multiplier := CASE p_forecast_type
        WHEN 'conservative' THEN 0.75
        WHEN 'realistic' THEN 1.0
        WHEN 'optimistic' THEN 1.25
        ELSE 1.0
    END;

    -- Delete existing forecast lines
    DELETE FROM cash_flow_forecast_lines WHERE forecast_id = p_forecast_id;

    -- Add unpaid invoices (expected receivables)
    INSERT INTO cash_flow_forecast_lines (
        forecast_id, transaction_date, category, description, amount,
        confidence_level, source_type, source_id
    )
    SELECT
        p_forecast_id,
        CASE
            WHEN due_date < p_start_date THEN p_start_date
            WHEN due_date > p_end_date THEN p_end_date
            ELSE due_date
        END,
        'receivables',
        'Expected payment: Invoice #' || invoice_number,
        (total_amount - COALESCE(paid_amount, 0)) * confidence_multiplier,
        CASE
            WHEN status = 'overdue' THEN 60.0
            WHEN status = 'sent' THEN 85.0
            ELSE 95.0
        END,
        'invoice',
        id
    FROM invoices
    WHERE company_id = p_company_id
    AND status IN ('sent', 'overdue')
    AND COALESCE(paid_amount, 0) < total_amount
    AND due_date <= p_end_date + INTERVAL '30 days';

    -- Add pending receipts (expected payables)
    INSERT INTO cash_flow_forecast_lines (
        forecast_id, transaction_date, category, description, amount,
        confidence_level, source_type, source_id
    )
    SELECT
        p_forecast_id,
        GREATEST(p_start_date, created_at::DATE),
        'payables',
        'Expected payment: ' || COALESCE(supplier, 'Receipt'),
        -1 * total_amount,
        80.0,
        'receipt',
        id
    FROM receipts
    WHERE company_id = p_company_id
    AND status = 'pending'
    AND created_at::DATE <= p_end_date;

    -- Add projected revenue based on patterns
    FOR v_date IN
        SELECT generate_series(
            p_start_date,
            p_end_date,
            '1 month'::INTERVAL
        )::DATE
    LOOP
        SELECT COALESCE(average_amount, 0) * confidence_multiplier
        INTO expected_receivables
        FROM cash_flow_patterns
        WHERE company_id = p_company_id
        AND pattern_type = 'monthly'
        AND category = 'receivables'
        AND period_identifier = TO_CHAR(v_date, 'Month')
        LIMIT 1;

        IF expected_receivables > 0 THEN
            INSERT INTO cash_flow_forecast_lines (
                forecast_id, transaction_date, category, description,
                amount, confidence_level, source_type
            )
            VALUES (
                p_forecast_id,
                v_date,
                'revenue',
                'Projected revenue for ' || TO_CHAR(v_date, 'Month YYYY'),
                expected_receivables,
                70.0,
                'recurring'
            );
        END IF;

        -- Add projected expenses
        SELECT COALESCE(average_amount, 0)
        INTO expected_payables
        FROM cash_flow_patterns
        WHERE company_id = p_company_id
        AND pattern_type = 'monthly'
        AND category = 'expense'
        AND period_identifier = TO_CHAR(v_date, 'Month')
        LIMIT 1;

        IF expected_payables > 0 THEN
            INSERT INTO cash_flow_forecast_lines (
                forecast_id, transaction_date, category, description,
                amount, confidence_level, source_type
            )
            VALUES (
                p_forecast_id,
                v_date,
                'expense',
                'Projected expenses for ' || TO_CHAR(v_date, 'Month YYYY'),
                -1 * expected_payables,
                65.0,
                'recurring'
            );
        END IF;
    END LOOP;

END;
$$ LANGUAGE plpgsql;

-- Function to get cash flow projection summary
CREATE OR REPLACE FUNCTION get_cash_flow_projection(
    p_forecast_id UUID
)
RETURNS TABLE (
    projection_date DATE,
    inflows DECIMAL(15, 2),
    outflows DECIMAL(15, 2),
    net_flow DECIMAL(15, 2),
    running_balance DECIMAL(15, 2)
) AS $$
DECLARE
    opening_bal DECIMAL(15, 2);
BEGIN
    -- Get opening balance
    SELECT opening_balance INTO opening_bal
    FROM cash_flow_forecasts
    WHERE id = p_forecast_id;

    RETURN QUERY
    WITH daily_flows AS (
        SELECT
            transaction_date,
            SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END) as inflows,
            SUM(CASE WHEN amount < 0 THEN ABS(amount) ELSE 0 END) as outflows,
            SUM(amount) as net_flow
        FROM cash_flow_forecast_lines
        WHERE forecast_id = p_forecast_id
        GROUP BY transaction_date
        ORDER BY transaction_date
    )
    SELECT
        df.transaction_date,
        df.inflows,
        df.outflows,
        df.net_flow,
        opening_bal + SUM(df.net_flow) OVER (ORDER BY df.transaction_date) as running_balance
    FROM daily_flows df;
END;
$$ LANGUAGE plpgsql;

-- Comments
COMMENT ON TABLE cash_flow_forecasts IS 'Cash flow forecast scenarios';
COMMENT ON TABLE cash_flow_forecast_lines IS 'Projected cash inflows and outflows';
COMMENT ON TABLE cash_flow_patterns IS 'Historical patterns for forecasting';
COMMENT ON TABLE cash_flow_scenarios IS 'What-if scenarios for cash flow analysis';
COMMENT ON FUNCTION calculate_payment_patterns IS 'Analyze historical payment patterns for forecasting';
COMMENT ON FUNCTION generate_cash_flow_forecast IS 'Generate cash flow projections based on invoices and patterns';
COMMENT ON FUNCTION get_cash_flow_projection IS 'Get running cash flow projection with balances';
