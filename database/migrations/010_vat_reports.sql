-- Migration: VAT Reports and Skatteverket Integration
-- Purpose: Add tables for managing VAT reports, tax periods, and Skatteverket submissions

-- Tax Periods Table
-- Manages reporting periods for VAT declarations (usually monthly or quarterly)
CREATE TABLE IF NOT EXISTS tax_periods (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    period_type VARCHAR(20) NOT NULL CHECK (period_type IN ('monthly', 'quarterly', 'annual')),
    period_year INTEGER NOT NULL,
    period_number INTEGER NOT NULL, -- 1-12 for monthly, 1-4 for quarterly, 1 for annual
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'submitted')),
    due_date DATE, -- Deadline for submitting to Skatteverket
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(company_id, period_year, period_number, period_type)
);

-- VAT Reports Table
-- Stores generated VAT reports with calculated amounts
CREATE TABLE IF NOT EXISTS vat_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    tax_period_id UUID NOT NULL REFERENCES tax_periods(id) ON DELETE CASCADE,
    report_number VARCHAR(50), -- Sequential report number for reference
    report_date DATE NOT NULL DEFAULT CURRENT_DATE,
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,

    -- VAT Amounts (in öre/cents for precision)
    outgoing_vat_25 BIGINT DEFAULT 0, -- Utgående moms 25%
    outgoing_vat_12 BIGINT DEFAULT 0, -- Utgående moms 12%
    outgoing_vat_6 BIGINT DEFAULT 0, -- Utgående moms 6%
    outgoing_vat_0 BIGINT DEFAULT 0, -- Momsfri försäljning
    incoming_vat BIGINT DEFAULT 0, -- Ingående moms

    -- Calculated fields
    total_outgoing_vat BIGINT DEFAULT 0, -- Sum of all outgoing VAT
    net_vat_amount BIGINT DEFAULT 0, -- Net amount to pay/receive (outgoing - incoming)

    -- Status and submission tracking
    status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'submitted', 'rejected', 'archived')),
    approved_by UUID REFERENCES users(id),
    approved_at TIMESTAMP WITH TIME ZONE,

    -- Metadata
    notes TEXT,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    UNIQUE(company_id, report_number)
);

-- VAT Report Lines Table
-- Detailed breakdown of VAT calculations by account and transaction
CREATE TABLE IF NOT EXISTS vat_report_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vat_report_id UUID NOT NULL REFERENCES vat_reports(id) ON DELETE CASCADE,

    -- Transaction reference
    transaction_type VARCHAR(20) NOT NULL CHECK (transaction_type IN ('invoice', 'receipt', 'journal_entry', 'adjustment')),
    transaction_id UUID, -- Reference to invoice_id, receipt_id, or journal_entry_id
    transaction_date DATE NOT NULL,
    transaction_number VARCHAR(100), -- Invoice/receipt number for reference

    -- Account information
    account_number VARCHAR(10) NOT NULL,
    account_name VARCHAR(255),

    -- Amounts (in öre/cents)
    base_amount BIGINT NOT NULL, -- Amount excluding VAT
    vat_rate DECIMAL(5,2), -- VAT percentage (25.00, 12.00, 6.00, 0.00)
    vat_amount BIGINT NOT NULL, -- VAT amount
    total_amount BIGINT NOT NULL, -- Total including VAT

    -- Classification
    vat_type VARCHAR(20) NOT NULL CHECK (vat_type IN ('outgoing', 'incoming')),
    description TEXT,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Skatteverket Submissions Table
-- Audit trail for submissions to Skatteverket API
CREATE TABLE IF NOT EXISTS skatteverket_submissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vat_report_id UUID NOT NULL REFERENCES vat_reports(id) ON DELETE CASCADE,
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,

    -- Submission details
    submission_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    submission_method VARCHAR(50) DEFAULT 'api', -- 'api', 'manual', 'file_export'

    -- API response tracking
    api_request_id VARCHAR(255), -- Skatteverket's request ID
    api_response_status VARCHAR(50), -- 'pending', 'accepted', 'rejected', 'error'
    api_response_message TEXT,
    api_response_data JSONB, -- Full API response for audit

    -- File export tracking (if submitted manually)
    export_file_path VARCHAR(500),
    export_format VARCHAR(20), -- 'xml', 'json', 'pdf'

    -- Authentication used
    certificate_thumbprint VARCHAR(255), -- For certificate-based auth

    -- Status
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'submitted', 'accepted', 'rejected', 'failed')),

    -- Audit
    submitted_by UUID REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX idx_tax_periods_company ON tax_periods(company_id);
CREATE INDEX idx_tax_periods_dates ON tax_periods(start_date, end_date);
CREATE INDEX idx_tax_periods_status ON tax_periods(status);

CREATE INDEX idx_vat_reports_company ON vat_reports(company_id);
CREATE INDEX idx_vat_reports_tax_period ON vat_reports(tax_period_id);
CREATE INDEX idx_vat_reports_dates ON vat_reports(period_start, period_end);
CREATE INDEX idx_vat_reports_status ON vat_reports(status);
CREATE INDEX idx_vat_reports_number ON vat_reports(report_number);

CREATE INDEX idx_vat_report_lines_report ON vat_report_lines(vat_report_id);
CREATE INDEX idx_vat_report_lines_transaction ON vat_report_lines(transaction_type, transaction_id);
CREATE INDEX idx_vat_report_lines_date ON vat_report_lines(transaction_date);

CREATE INDEX idx_skatteverket_submissions_report ON skatteverket_submissions(vat_report_id);
CREATE INDEX idx_skatteverket_submissions_company ON skatteverket_submissions(company_id);
CREATE INDEX idx_skatteverket_submissions_date ON skatteverket_submissions(submission_date);
CREATE INDEX idx_skatteverket_submissions_status ON skatteverket_submissions(status);

-- Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_vat_reports_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER vat_reports_updated_at
    BEFORE UPDATE ON vat_reports
    FOR EACH ROW
    EXECUTE FUNCTION update_vat_reports_updated_at();

CREATE TRIGGER tax_periods_updated_at
    BEFORE UPDATE ON tax_periods
    FOR EACH ROW
    EXECUTE FUNCTION update_vat_reports_updated_at();

CREATE TRIGGER skatteverket_submissions_updated_at
    BEFORE UPDATE ON skatteverket_submissions
    FOR EACH ROW
    EXECUTE FUNCTION update_vat_reports_updated_at();

-- Comments for documentation
COMMENT ON TABLE tax_periods IS 'Manages VAT reporting periods (monthly/quarterly/annual)';
COMMENT ON TABLE vat_reports IS 'Generated VAT reports with calculated amounts for Skatteverket';
COMMENT ON TABLE vat_report_lines IS 'Detailed breakdown of VAT calculations by transaction';
COMMENT ON TABLE skatteverket_submissions IS 'Audit trail for VAT report submissions to Skatteverket API';

COMMENT ON COLUMN vat_reports.outgoing_vat_25 IS 'Outgoing VAT at 25% rate (standard)';
COMMENT ON COLUMN vat_reports.outgoing_vat_12 IS 'Outgoing VAT at 12% rate (food, hotels)';
COMMENT ON COLUMN vat_reports.outgoing_vat_6 IS 'Outgoing VAT at 6% rate (newspapers, cultural events)';
COMMENT ON COLUMN vat_reports.outgoing_vat_0 IS 'VAT-exempt sales (exports, certain services)';
COMMENT ON COLUMN vat_reports.incoming_vat IS 'Deductible incoming VAT on purchases';
COMMENT ON COLUMN vat_reports.net_vat_amount IS 'Net VAT to pay (positive) or receive (negative)';
