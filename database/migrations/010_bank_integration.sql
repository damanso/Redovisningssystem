-- Bank Integration Migration
-- Purpose: Implement Open Banking integration with Tink for transaction import and reconciliation

-- Add bank fields to companies table
ALTER TABLE companies
ADD COLUMN IF NOT EXISTS bank_account VARCHAR(50),
ADD COLUMN IF NOT EXISTS bank_clearing VARCHAR(10),
ADD COLUMN IF NOT EXISTS bank_name VARCHAR(100);

-- Bank connections (Tink/Open Banking connections)
CREATE TABLE IF NOT EXISTS bank_connections (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    provider VARCHAR(50) NOT NULL DEFAULT 'tink', -- 'tink', 'nordigen', etc.
    provider_connection_id VARCHAR(255) NOT NULL, -- External connection ID
    bank_name VARCHAR(255),
    status VARCHAR(50) NOT NULL CHECK (status IN ('active', 'expired', 'revoked', 'error')),
    access_token TEXT,
    refresh_token TEXT,
    token_expires_at TIMESTAMP,
    last_sync_at TIMESTAMP,
    error_message TEXT,
    metadata JSONB, -- Additional provider-specific data
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(company_id, provider_connection_id)
);

-- Bank accounts (individual accounts from bank)
CREATE TABLE IF NOT EXISTS bank_accounts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    bank_connection_id UUID NOT NULL REFERENCES bank_connections(id) ON DELETE CASCADE,
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    provider_account_id VARCHAR(255) NOT NULL, -- External account ID
    account_number VARCHAR(50),
    clearing_number VARCHAR(10),
    account_name VARCHAR(255) NOT NULL,
    account_type VARCHAR(50), -- 'checking', 'savings', etc.
    currency VARCHAR(3) DEFAULT 'SEK',
    balance DECIMAL(15, 2),
    available_balance DECIMAL(15, 2),
    last_synced_at TIMESTAMP,
    is_active BOOLEAN DEFAULT true,
    bas_account_number INTEGER REFERENCES bas_accounts(account_number), -- Link to accounting
    metadata JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(bank_connection_id, provider_account_id)
);

-- Bank transactions (imported from bank)
CREATE TABLE IF NOT EXISTS bank_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    bank_account_id UUID NOT NULL REFERENCES bank_accounts(id) ON DELETE CASCADE,
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    provider_transaction_id VARCHAR(255), -- External transaction ID
    transaction_date DATE NOT NULL,
    booking_date DATE,
    amount DECIMAL(15, 2) NOT NULL,
    currency VARCHAR(3) DEFAULT 'SEK',
    description TEXT,
    counterparty_name VARCHAR(255),
    counterparty_account VARCHAR(50),
    reference VARCHAR(255),
    category VARCHAR(100),
    status VARCHAR(50) NOT NULL DEFAULT 'unmatched' CHECK (status IN ('unmatched', 'matched', 'reconciled', 'ignored')),
    is_reconciled BOOLEAN DEFAULT false,
    reconciled_at TIMESTAMP,
    reconciled_by UUID REFERENCES users(id) ON DELETE SET NULL,
    journal_entry_id UUID REFERENCES journal_entries(id) ON DELETE SET NULL,
    metadata JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(bank_account_id, provider_transaction_id)
);

-- Transaction matches (link bank transactions to invoices/receipts)
CREATE TABLE IF NOT EXISTS transaction_matches (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    bank_transaction_id UUID NOT NULL REFERENCES bank_transactions(id) ON DELETE CASCADE,
    match_type VARCHAR(50) NOT NULL CHECK (match_type IN ('invoice', 'receipt', 'manual')),
    match_id UUID NOT NULL, -- ID of invoice or receipt
    matched_amount DECIMAL(15, 2) NOT NULL,
    confidence_score DECIMAL(3, 2), -- 0.00 to 1.00 for automatic matching confidence
    match_method VARCHAR(50), -- 'automatic', 'manual', 'suggested'
    notes TEXT,
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(bank_transaction_id, match_type, match_id)
);

-- Bank sync logs (track synchronization history)
CREATE TABLE IF NOT EXISTS bank_sync_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    bank_connection_id UUID NOT NULL REFERENCES bank_connections(id) ON DELETE CASCADE,
    sync_type VARCHAR(50) NOT NULL CHECK (sync_type IN ('full', 'incremental', 'manual')),
    status VARCHAR(50) NOT NULL CHECK (status IN ('started', 'completed', 'failed')),
    transactions_imported INTEGER DEFAULT 0,
    transactions_matched INTEGER DEFAULT 0,
    error_message TEXT,
    started_at TIMESTAMP NOT NULL,
    completed_at TIMESTAMP,
    metadata JSONB
);

-- Indexes for performance
CREATE INDEX idx_bank_connections_company ON bank_connections(company_id);
CREATE INDEX idx_bank_connections_status ON bank_connections(status);
CREATE INDEX idx_bank_accounts_connection ON bank_accounts(bank_connection_id);
CREATE INDEX idx_bank_accounts_company ON bank_accounts(company_id);
CREATE INDEX idx_bank_accounts_active ON bank_accounts(is_active);
CREATE INDEX idx_bank_transactions_account ON bank_transactions(bank_account_id);
CREATE INDEX idx_bank_transactions_company ON bank_transactions(company_id);
CREATE INDEX idx_bank_transactions_date ON bank_transactions(transaction_date);
CREATE INDEX idx_bank_transactions_status ON bank_transactions(status);
CREATE INDEX idx_bank_transactions_reconciled ON bank_transactions(is_reconciled);
CREATE INDEX idx_transaction_matches_bank_transaction ON transaction_matches(bank_transaction_id);
CREATE INDEX idx_transaction_matches_match ON transaction_matches(match_type, match_id);
CREATE INDEX idx_bank_sync_logs_connection ON bank_sync_logs(bank_connection_id);

-- Triggers to auto-update updated_at
CREATE OR REPLACE FUNCTION update_bank_tables_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER bank_connections_updated_at
    BEFORE UPDATE ON bank_connections
    FOR EACH ROW
    EXECUTE FUNCTION update_bank_tables_updated_at();

CREATE TRIGGER bank_accounts_updated_at
    BEFORE UPDATE ON bank_accounts
    FOR EACH ROW
    EXECUTE FUNCTION update_bank_tables_updated_at();

CREATE TRIGGER bank_transactions_updated_at
    BEFORE UPDATE ON bank_transactions
    FOR EACH ROW
    EXECUTE FUNCTION update_bank_tables_updated_at();

-- Comments
COMMENT ON TABLE bank_connections IS 'Open Banking connections (Tink/Nordigen) for companies';
COMMENT ON TABLE bank_accounts IS 'Bank accounts linked from Open Banking providers';
COMMENT ON TABLE bank_transactions IS 'Imported bank transactions for reconciliation';
COMMENT ON TABLE transaction_matches IS 'Matches between bank transactions and invoices/receipts';
COMMENT ON TABLE bank_sync_logs IS 'History of bank synchronization operations';
COMMENT ON COLUMN bank_transactions.status IS 'Transaction matching status: unmatched, matched, reconciled, ignored';
COMMENT ON COLUMN transaction_matches.confidence_score IS 'Automatic matching confidence (0.00-1.00)';
COMMENT ON COLUMN transaction_matches.match_method IS 'How the match was created: automatic, manual, suggested';
