-- Receipt Management Migration
-- Purpose: Store uploaded receipts with file references and OCR data

CREATE TABLE IF NOT EXISTS receipts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL,
    receipt_date DATE NOT NULL,
    amount DECIMAL(15, 2) NOT NULL,
    vat_amount DECIMAL(15, 2),
    total_amount DECIMAL(15, 2) NOT NULL,
    category VARCHAR(100),
    description TEXT,
    file_url TEXT NOT NULL,
    file_type VARCHAR(50) NOT NULL,
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'processed', 'booked')),
    ocr_data JSONB,
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX idx_receipts_company ON receipts(company_id);
CREATE INDEX idx_receipts_supplier ON receipts(supplier_id);
CREATE INDEX idx_receipts_date ON receipts(receipt_date);
CREATE INDEX idx_receipts_status ON receipts(status);
CREATE INDEX idx_receipts_category ON receipts(category);
CREATE INDEX idx_receipts_created_by ON receipts(created_by);
CREATE INDEX idx_receipts_created_at ON receipts(created_at);

-- GIN index for JSONB OCR data search
CREATE INDEX idx_receipts_ocr_data ON receipts USING GIN (ocr_data);

-- Trigger to auto-update updated_at
CREATE OR REPLACE FUNCTION update_receipts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER receipts_updated_at
    BEFORE UPDATE ON receipts
    FOR EACH ROW
    EXECUTE FUNCTION update_receipts_updated_at();

-- Comments
COMMENT ON TABLE receipts IS 'Stores receipt/expense records with file references';
COMMENT ON COLUMN receipts.status IS 'pending: uploaded but not processed; processed: OCR completed; booked: added to accounting';
COMMENT ON COLUMN receipts.ocr_data IS 'Stores OCR extracted data from receipt image/PDF';
