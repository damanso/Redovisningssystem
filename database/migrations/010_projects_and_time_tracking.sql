-- Projects and Time Tracking Module Migration
-- Purpose: Implement project management and time tracking functionality

-- Projects table
CREATE TABLE IF NOT EXISTS projects (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    project_number VARCHAR(50),
    status VARCHAR(50) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'completed', 'cancelled')),
    start_date DATE,
    end_date DATE,
    estimated_hours DECIMAL(10, 2),
    budget_amount DECIMAL(15, 2),
    hourly_rate DECIMAL(10, 2),
    fixed_price BOOLEAN DEFAULT false,
    is_billable BOOLEAN DEFAULT true,
    is_active BOOLEAN DEFAULT true,
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Time entries table
CREATE TABLE IF NOT EXISTS time_entries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    description TEXT,
    entry_date DATE NOT NULL,
    hours DECIMAL(10, 2) NOT NULL CHECK (hours > 0),
    hourly_rate DECIMAL(10, 2),
    is_billable BOOLEAN DEFAULT true,
    is_invoiced BOOLEAN DEFAULT false,
    invoice_id UUID,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Project invoices table (links projects to invoices)
CREATE TABLE IF NOT EXISTS project_invoices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    total_hours DECIMAL(10, 2),
    total_amount DECIMAL(15, 2),
    invoice_date DATE NOT NULL,
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(project_id, invoice_id)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_projects_company_id ON projects(company_id);
CREATE INDEX IF NOT EXISTS idx_projects_customer_id ON projects(customer_id);
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
CREATE INDEX IF NOT EXISTS idx_projects_is_active ON projects(is_active);
CREATE INDEX IF NOT EXISTS idx_projects_project_number ON projects(project_number);

CREATE INDEX IF NOT EXISTS idx_time_entries_project_id ON time_entries(project_id);
CREATE INDEX IF NOT EXISTS idx_time_entries_user_id ON time_entries(user_id);
CREATE INDEX IF NOT EXISTS idx_time_entries_company_id ON time_entries(company_id);
CREATE INDEX IF NOT EXISTS idx_time_entries_entry_date ON time_entries(entry_date);
CREATE INDEX IF NOT EXISTS idx_time_entries_is_invoiced ON time_entries(is_invoiced);
CREATE INDEX IF NOT EXISTS idx_time_entries_invoice_id ON time_entries(invoice_id);

CREATE INDEX IF NOT EXISTS idx_project_invoices_project_id ON project_invoices(project_id);
CREATE INDEX IF NOT EXISTS idx_project_invoices_invoice_id ON project_invoices(invoice_id);

-- Triggers to auto-update updated_at
CREATE OR REPLACE FUNCTION update_projects_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER projects_updated_at
    BEFORE UPDATE ON projects
    FOR EACH ROW
    EXECUTE FUNCTION update_projects_updated_at();

CREATE OR REPLACE FUNCTION update_time_entries_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER time_entries_updated_at
    BEFORE UPDATE ON time_entries
    FOR EACH ROW
    EXECUTE FUNCTION update_time_entries_updated_at();

-- Comments
COMMENT ON TABLE projects IS 'Project management data for tracking customer projects';
COMMENT ON TABLE time_entries IS 'Time tracking entries for projects';
COMMENT ON TABLE project_invoices IS 'Links projects to invoices for billing';

COMMENT ON COLUMN projects.project_number IS 'Unique project identifier/code';
COMMENT ON COLUMN projects.status IS 'Project status: active, inactive, completed, cancelled';
COMMENT ON COLUMN projects.fixed_price IS 'Whether project is fixed price or hourly based';
COMMENT ON COLUMN projects.is_billable IS 'Whether project time is billable to customer';

COMMENT ON COLUMN time_entries.hours IS 'Number of hours worked';
COMMENT ON COLUMN time_entries.is_billable IS 'Whether this entry is billable';
COMMENT ON COLUMN time_entries.is_invoiced IS 'Whether this entry has been invoiced';
COMMENT ON COLUMN time_entries.invoice_id IS 'Invoice this entry is associated with';
