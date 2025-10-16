-- Accounting Module Migration
-- Purpose: Implement Swedish BAS chart of accounts and journal entries

-- BAS Account Plan (Swedish Standard Chart of Accounts)
CREATE TABLE IF NOT EXISTS bas_accounts (
    account_number INTEGER PRIMARY KEY,
    account_name VARCHAR(255) NOT NULL,
    account_type VARCHAR(50) NOT NULL CHECK (account_type IN ('asset', 'liability', 'equity', 'revenue', 'expense')),
    description TEXT
);

-- Journal entries (huvudbok/verifikationer)
CREATE TABLE IF NOT EXISTS journal_entries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    entry_date DATE NOT NULL,
    description TEXT,
    reference_type VARCHAR(50),  -- 'invoice', 'receipt', 'payment', 'manual'
    reference_id UUID,            -- ID of the referenced document
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Journal entry lines (konteringar - debit/credit)
CREATE TABLE IF NOT EXISTS journal_entry_lines (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    journal_entry_id UUID NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
    account_number INTEGER NOT NULL REFERENCES bas_accounts(account_number),
    debit DECIMAL(15, 2) DEFAULT 0 CHECK (debit >= 0),
    credit DECIMAL(15, 2) DEFAULT 0 CHECK (credit >= 0),
    description TEXT,
    line_order INTEGER NOT NULL,
    CONSTRAINT check_debit_or_credit CHECK (
        (debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0)
    )
);

-- Seed BAS accounts (svensk kontoplan)
INSERT INTO bas_accounts (account_number, account_name, account_type, description) VALUES
-- Tillgångar (1000-1999)
(1510, 'Kundfordringar', 'asset', 'Fordringar på kunder'),
(1630, 'Skattefordringar', 'asset', 'Ingående moms'),
(1910, 'Kassa', 'asset', 'Kontanter'),
(1930, 'Företagskonto', 'asset', 'Bankkonto'),

-- Skulder (2000-2999)
(2440, 'Leverantörsskulder', 'liability', 'Skulder till leverantörer'),
(2610, 'Utgående moms 25%', 'liability', 'Moms att betala till Skatteverket'),
(2640, 'Skatteskulder', 'liability', 'Skatt att betala'),

-- Eget kapital (2000-2999)
(2081, 'Årets resultat', 'equity', 'Årets vinst/förlust'),

-- Intäkter (3000-3999)
(3000, 'Försäljning varor 25% moms', 'revenue', 'Försäljning av varor'),
(3100, 'Försäljning tjänster 25% moms', 'revenue', 'Försäljning av tjänster'),
(3740, 'Öres- och kronutjämning', 'revenue', 'Avrundningar'),

-- Kostnader (4000-7999)
(4000, 'Inköp varor', 'expense', 'Inköp av material och varor'),
(5010, 'Lokalhyra', 'expense', 'Hyra för lokaler'),
(5800, 'Representation', 'expense', 'Representationskostnader'),
(6071, 'Personalkostnader', 'expense', 'Löner och ersättningar'),
(6570, 'Bankkostnader', 'expense', 'Avgifter och kostnader för bank'),
(6980, 'Övriga externa kostnader', 'expense', 'Diverse kostnader')

ON CONFLICT (account_number) DO NOTHING;

-- Indexes for performance
CREATE INDEX idx_journal_entries_company ON journal_entries(company_id);
CREATE INDEX idx_journal_entries_date ON journal_entries(entry_date);
CREATE INDEX idx_journal_entries_reference ON journal_entries(reference_type, reference_id);
CREATE INDEX idx_journal_entry_lines_entry ON journal_entry_lines(journal_entry_id);
CREATE INDEX idx_journal_entry_lines_account ON journal_entry_lines(account_number);

-- Trigger to auto-update updated_at
CREATE OR REPLACE FUNCTION update_journal_entries_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER journal_entries_updated_at
    BEFORE UPDATE ON journal_entries
    FOR EACH ROW
    EXECUTE FUNCTION update_journal_entries_updated_at();

-- Comments
COMMENT ON TABLE bas_accounts IS 'Swedish BAS Chart of Accounts';
COMMENT ON TABLE journal_entries IS 'Journal entries (verifikationer) for double-entry bookkeeping';
COMMENT ON TABLE journal_entry_lines IS 'Journal entry lines (konteringar) - debit and credit entries';
COMMENT ON COLUMN journal_entry_lines.debit IS 'Debit amount (debet)';
COMMENT ON COLUMN journal_entry_lines.credit IS 'Credit amount (kredit)';
