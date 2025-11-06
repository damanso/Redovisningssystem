-- =====================================================
-- FAS 4.1: MULTI-COMPANY MANAGEMENT
-- Migration 005: Company Groups & Cross-Company Transactions
-- =====================================================

-- =====================================================
-- 1. COMPANY GROUPS
-- =====================================================

-- Company groups table for organizing companies
CREATE TABLE IF NOT EXISTS company_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  color VARCHAR(7), -- Hex color code for UI
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Many-to-many relationship: companies can belong to multiple groups
CREATE TABLE IF NOT EXISTS company_group_members (
  group_id UUID NOT NULL REFERENCES company_groups(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  added_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  added_by UUID NOT NULL REFERENCES users(id),
  PRIMARY KEY (group_id, company_id)
);

-- Indexes for company groups
CREATE INDEX IF NOT EXISTS idx_company_groups_created_by ON company_groups(created_by);
CREATE INDEX IF NOT EXISTS idx_company_group_members_group_id ON company_group_members(group_id);
CREATE INDEX IF NOT EXISTS idx_company_group_members_company_id ON company_group_members(company_id);

-- =====================================================
-- 2. CROSS-COMPANY TRANSACTIONS
-- =====================================================

-- Cross-company transactions (e.g., intercompany sales, loans, transfers)
CREATE TABLE IF NOT EXISTS cross_company_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- From/To companies
  from_company_id UUID NOT NULL REFERENCES companies(id),
  to_company_id UUID NOT NULL REFERENCES companies(id),

  -- Transaction details
  transaction_type VARCHAR(50) NOT NULL, -- 'sale', 'purchase', 'loan', 'transfer', 'expense_allocation'
  description TEXT NOT NULL,
  amount DECIMAL(15, 2) NOT NULL,
  currency VARCHAR(3) DEFAULT 'SEK',

  -- Transaction date
  transaction_date DATE NOT NULL,

  -- Status
  status VARCHAR(20) DEFAULT 'pending', -- 'pending', 'approved', 'completed', 'cancelled'

  -- References to invoices/receipts if applicable
  from_invoice_id UUID, -- Could reference invoices table when implemented
  to_invoice_id UUID,

  -- Reconciliation
  is_reconciled BOOLEAN DEFAULT false,
  reconciled_at TIMESTAMP WITH TIME ZONE,
  reconciled_by UUID REFERENCES users(id),

  -- Audit
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

  -- Constraints
  CHECK (from_company_id != to_company_id),
  CHECK (amount > 0),
  CHECK (status IN ('pending', 'approved', 'completed', 'cancelled')),
  CHECK (transaction_type IN ('sale', 'purchase', 'loan', 'transfer', 'expense_allocation', 'other'))
);

-- Indexes for cross-company transactions
CREATE INDEX IF NOT EXISTS idx_cross_company_transactions_from ON cross_company_transactions(from_company_id);
CREATE INDEX IF NOT EXISTS idx_cross_company_transactions_to ON cross_company_transactions(to_company_id);
CREATE INDEX IF NOT EXISTS idx_cross_company_transactions_date ON cross_company_transactions(transaction_date);
CREATE INDEX IF NOT EXISTS idx_cross_company_transactions_status ON cross_company_transactions(status);
CREATE INDEX IF NOT EXISTS idx_cross_company_transactions_type ON cross_company_transactions(transaction_type);
CREATE INDEX IF NOT EXISTS idx_cross_company_transactions_reconciled ON cross_company_transactions(is_reconciled);

-- =====================================================
-- 3. CONSOLIDATED REPORTING METADATA
-- =====================================================

-- Store user preferences for consolidated reports
CREATE TABLE IF NOT EXISTS consolidated_report_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  name VARCHAR(255) NOT NULL,
  description TEXT,

  -- Companies to include (JSON array of company IDs)
  company_ids JSONB NOT NULL,

  -- Groups to include (JSON array of group IDs)
  group_ids JSONB,

  -- Report settings
  report_type VARCHAR(50) NOT NULL, -- 'profit_loss', 'balance_sheet', 'cash_flow', 'custom'
  date_range_start DATE,
  date_range_end DATE,
  currency VARCHAR(3) DEFAULT 'SEK',

  -- Filters and options (flexible JSON structure)
  options JSONB,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

  CHECK (report_type IN ('profit_loss', 'balance_sheet', 'cash_flow', 'custom'))
);

CREATE INDEX IF NOT EXISTS idx_consolidated_report_configs_user ON consolidated_report_configs(user_id);
CREATE INDEX IF NOT EXISTS idx_consolidated_report_configs_type ON consolidated_report_configs(report_type);

-- =====================================================
-- 4. USER PREFERENCES FOR MULTI-COMPANY
-- =====================================================

-- Add active company preference to track which company user is currently working with
ALTER TABLE users
ADD COLUMN IF NOT EXISTS active_company_id UUID REFERENCES companies(id),
ADD COLUMN IF NOT EXISTS last_company_switch TIMESTAMP WITH TIME ZONE;

-- Index for active company
CREATE INDEX IF NOT EXISTS idx_users_active_company ON users(active_company_id);

-- =====================================================
-- 5. TRIGGERS FOR UPDATED_AT
-- =====================================================

-- Trigger function for updating updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply trigger to all new tables
DROP TRIGGER IF EXISTS update_company_groups_updated_at ON company_groups;
CREATE TRIGGER update_company_groups_updated_at
  BEFORE UPDATE ON company_groups
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_cross_company_transactions_updated_at ON cross_company_transactions;
CREATE TRIGGER update_cross_company_transactions_updated_at
  BEFORE UPDATE ON cross_company_transactions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_consolidated_report_configs_updated_at ON consolidated_report_configs;
CREATE TRIGGER update_consolidated_report_configs_updated_at
  BEFORE UPDATE ON consolidated_report_configs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- 6. VIEWS FOR COMMON QUERIES
-- =====================================================

-- View for company group summary
CREATE OR REPLACE VIEW company_group_summary AS
SELECT
  cg.id,
  cg.name,
  cg.description,
  cg.color,
  cg.created_by,
  cg.created_at,
  COUNT(cgm.company_id) as company_count,
  json_agg(
    json_build_object(
      'company_id', cgm.company_id,
      'company_name', c.name,
      'added_at', cgm.added_at
    )
  ) FILTER (WHERE cgm.company_id IS NOT NULL) as companies
FROM company_groups cg
LEFT JOIN company_group_members cgm ON cg.id = cgm.group_id
LEFT JOIN companies c ON cgm.company_id = c.id
GROUP BY cg.id;

-- View for cross-company transaction summary
CREATE OR REPLACE VIEW cross_company_transaction_summary AS
SELECT
  cct.*,
  fc.name as from_company_name,
  tc.name as to_company_name,
  u.name as created_by_name
FROM cross_company_transactions cct
JOIN companies fc ON cct.from_company_id = fc.id
JOIN companies tc ON cct.to_company_id = tc.id
JOIN users u ON cct.created_by = u.id;

-- =====================================================
-- MIGRATION COMPLETE
-- =====================================================

-- Add comment to track migration
COMMENT ON TABLE company_groups IS 'Fas 4.1: Groups for organizing multiple companies';
COMMENT ON TABLE cross_company_transactions IS 'Fas 4.1: Transactions between companies';
COMMENT ON TABLE consolidated_report_configs IS 'Fas 4.1: User configurations for consolidated reports';
