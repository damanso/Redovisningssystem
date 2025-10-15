-- Invoice Module Migration
-- Creates tables for invoices and invoice lines

-- Main invoices table
CREATE TABLE invoices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
    invoice_number VARCHAR(50) NOT NULL,
    invoice_date DATE NOT NULL,
    due_date DATE NOT NULL,
    payment_terms INTEGER DEFAULT 30,
    status VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'paid', 'overdue', 'cancelled')),
    currency VARCHAR(3) DEFAULT 'SEK',
    subtotal DECIMAL(12, 2) NOT NULL DEFAULT 0,
    vat_amount DECIMAL(12, 2) NOT NULL DEFAULT 0,
    total_amount DECIMAL(12, 2) NOT NULL DEFAULT 0,
    paid_amount DECIMAL(12, 2) DEFAULT 0,
    paid_date TIMESTAMP,
    sent_date TIMESTAMP,
    reference VARCHAR(255),
    notes TEXT,
    pdf_url TEXT,
    ocr_number VARCHAR(50),
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Invoice lines table
CREATE TABLE invoice_lines (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    article_id UUID REFERENCES articles(id) ON DELETE SET NULL,
    description TEXT NOT NULL,
    quantity DECIMAL(10, 2) NOT NULL,
    unit_price DECIMAL(12, 2) NOT NULL,
    unit VARCHAR(20) DEFAULT 'st',
    vat_rate DECIMAL(5, 2) NOT NULL,
    amount DECIMAL(12, 2) NOT NULL,
    line_order INTEGER NOT NULL
);

-- Indexes for invoices
CREATE INDEX idx_invoices_company ON invoices(company_id);
CREATE INDEX idx_invoices_customer ON invoices(customer_id);
CREATE INDEX idx_invoices_number ON invoices(company_id, invoice_number);
CREATE INDEX idx_invoices_date ON invoices(invoice_date);
CREATE INDEX idx_invoices_due_date ON invoices(due_date);
CREATE INDEX idx_invoices_status ON invoices(status);
CREATE INDEX idx_invoices_created_at ON invoices(created_at DESC);
CREATE INDEX idx_invoices_ocr ON invoices(ocr_number);

-- Unique constraint for invoice number within company
CREATE UNIQUE INDEX idx_invoices_company_number
ON invoices(company_id, invoice_number);

-- Indexes for invoice_lines
CREATE INDEX idx_invoice_lines_invoice ON invoice_lines(invoice_id);
CREATE INDEX idx_invoice_lines_article ON invoice_lines(article_id);
CREATE INDEX idx_invoice_lines_order ON invoice_lines(invoice_id, line_order);

-- Trigger to update updated_at on invoices
CREATE OR REPLACE FUNCTION update_invoice_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_invoice_timestamp
BEFORE UPDATE ON invoices
FOR EACH ROW
EXECUTE FUNCTION update_invoice_updated_at();

-- Function to automatically update overdue invoices
CREATE OR REPLACE FUNCTION update_overdue_invoices()
RETURNS void AS $$
BEGIN
    UPDATE invoices
    SET status = 'overdue'
    WHERE status = 'sent'
    AND due_date < CURRENT_DATE
    AND paid_amount < total_amount;
END;
$$ LANGUAGE plpgsql;

-- Comments for documentation
COMMENT ON TABLE invoices IS 'Main invoices table with all invoice header information';
COMMENT ON TABLE invoice_lines IS 'Invoice line items with product/service details';
COMMENT ON COLUMN invoices.ocr_number IS 'Swedish OCR number for payment reference (Luhn checksum)';
COMMENT ON COLUMN invoices.status IS 'Invoice status: draft, sent, paid, overdue, cancelled';
COMMENT ON COLUMN invoice_lines.line_order IS 'Order of lines in the invoice for display';
