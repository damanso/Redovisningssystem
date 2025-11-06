-- Recurring Invoices Module Migration
-- Creates table for managing recurring invoice templates and schedules

-- Recurring invoices table
CREATE TABLE recurring_invoices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,

    -- Template information
    template_name VARCHAR(255) NOT NULL,

    -- Invoice details
    payment_terms INTEGER DEFAULT 30,
    currency VARCHAR(3) DEFAULT 'SEK',
    reference VARCHAR(255),
    notes TEXT,

    -- Recurrence settings
    frequency VARCHAR(20) NOT NULL CHECK (frequency IN ('daily', 'weekly', 'monthly', 'quarterly', 'yearly')),
    interval_count INTEGER DEFAULT 1, -- e.g., every 2 months = interval_count: 2
    start_date DATE NOT NULL,
    end_date DATE, -- NULL means no end date
    next_generation_date DATE NOT NULL,

    -- Status
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'paused', 'completed', 'cancelled')),

    -- Tracking
    last_generated_date DATE,
    generated_count INTEGER DEFAULT 0,
    max_occurrences INTEGER, -- NULL means unlimited

    -- Metadata
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Recurring invoice lines table (template for invoice lines)
CREATE TABLE recurring_invoice_lines (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    recurring_invoice_id UUID NOT NULL REFERENCES recurring_invoices(id) ON DELETE CASCADE,
    article_id UUID REFERENCES articles(id) ON DELETE SET NULL,
    description TEXT NOT NULL,
    quantity DECIMAL(10, 2) NOT NULL,
    unit_price DECIMAL(12, 2) NOT NULL,
    unit VARCHAR(20) DEFAULT 'st',
    vat_rate DECIMAL(5, 2) NOT NULL,
    line_order INTEGER NOT NULL
);

-- Tracking table for generated invoices from recurring templates
CREATE TABLE recurring_invoice_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    recurring_invoice_id UUID NOT NULL REFERENCES recurring_invoices(id) ON DELETE CASCADE,
    invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    generated_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    period_start DATE,
    period_end DATE
);

-- Indexes for recurring_invoices
CREATE INDEX idx_recurring_invoices_company ON recurring_invoices(company_id);
CREATE INDEX idx_recurring_invoices_customer ON recurring_invoices(customer_id);
CREATE INDEX idx_recurring_invoices_status ON recurring_invoices(status);
CREATE INDEX idx_recurring_invoices_next_date ON recurring_invoices(next_generation_date);
CREATE INDEX idx_recurring_invoices_active ON recurring_invoices(status, next_generation_date)
    WHERE status = 'active';

-- Indexes for recurring_invoice_lines
CREATE INDEX idx_recurring_invoice_lines_recurring ON recurring_invoice_lines(recurring_invoice_id);
CREATE INDEX idx_recurring_invoice_lines_article ON recurring_invoice_lines(article_id);
CREATE INDEX idx_recurring_invoice_lines_order ON recurring_invoice_lines(recurring_invoice_id, line_order);

-- Indexes for history
CREATE INDEX idx_recurring_history_recurring ON recurring_invoice_history(recurring_invoice_id);
CREATE INDEX idx_recurring_history_invoice ON recurring_invoice_history(invoice_id);
CREATE INDEX idx_recurring_history_date ON recurring_invoice_history(generated_date DESC);

-- Trigger to update updated_at on recurring_invoices
CREATE OR REPLACE FUNCTION update_recurring_invoice_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_recurring_invoice_timestamp
BEFORE UPDATE ON recurring_invoices
FOR EACH ROW
EXECUTE FUNCTION update_recurring_invoice_updated_at();

-- Function to calculate next generation date based on frequency
CREATE OR REPLACE FUNCTION calculate_next_generation_date(
    current_date DATE,
    frequency VARCHAR,
    interval_count INTEGER
)
RETURNS DATE AS $$
BEGIN
    CASE frequency
        WHEN 'daily' THEN
            RETURN current_date + (interval_count || ' days')::INTERVAL;
        WHEN 'weekly' THEN
            RETURN current_date + (interval_count || ' weeks')::INTERVAL;
        WHEN 'monthly' THEN
            RETURN current_date + (interval_count || ' months')::INTERVAL;
        WHEN 'quarterly' THEN
            RETURN current_date + (interval_count * 3 || ' months')::INTERVAL;
        WHEN 'yearly' THEN
            RETURN current_date + (interval_count || ' years')::INTERVAL;
        ELSE
            RETURN current_date;
    END CASE;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Comments for documentation
COMMENT ON TABLE recurring_invoices IS 'Recurring invoice templates with scheduling information';
COMMENT ON TABLE recurring_invoice_lines IS 'Template lines for recurring invoices';
COMMENT ON TABLE recurring_invoice_history IS 'History of generated invoices from recurring templates';
COMMENT ON COLUMN recurring_invoices.frequency IS 'How often to generate: daily, weekly, monthly, quarterly, yearly';
COMMENT ON COLUMN recurring_invoices.interval_count IS 'Multiplier for frequency (e.g., every 2 months)';
COMMENT ON COLUMN recurring_invoices.next_generation_date IS 'Next date when an invoice should be generated';
COMMENT ON COLUMN recurring_invoices.max_occurrences IS 'Maximum number of invoices to generate (NULL = unlimited)';
