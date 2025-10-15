-- Create suppliers table (similar to customers but for vendors/suppliers)
CREATE TABLE IF NOT EXISTS suppliers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,

    -- Basic Information
    name VARCHAR(255) NOT NULL,
    org_number VARCHAR(50),
    contact_person VARCHAR(255),
    email VARCHAR(255),
    phone VARCHAR(50),
    mobile VARCHAR(50),
    website VARCHAR(255),

    -- Address
    address_street TEXT,
    address_postal_code VARCHAR(20),
    address_city VARCHAR(100),
    address_country VARCHAR(100) DEFAULT 'Sweden',

    -- Business Terms
    payment_terms INTEGER DEFAULT 30,
    discount_percentage DECIMAL(5, 2) DEFAULT 0,
    currency VARCHAR(3) DEFAULT 'SEK',
    vat_number VARCHAR(50),

    -- Metadata
    notes TEXT,
    tags TEXT[],
    category VARCHAR(100),  -- e.g., 'IT', 'Office Supplies', 'Services', etc.
    is_active BOOLEAN DEFAULT true,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Supplier contacts table
CREATE TABLE IF NOT EXISTS supplier_contacts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    supplier_id UUID NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    title VARCHAR(100),
    email VARCHAR(255),
    phone VARCHAR(50),
    mobile VARCHAR(50),
    is_primary BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Supplier notes table
CREATE TABLE IF NOT EXISTS supplier_notes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    supplier_id UUID NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    note TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_suppliers_company_id ON suppliers(company_id);
CREATE INDEX IF NOT EXISTS idx_suppliers_email ON suppliers(email);
CREATE INDEX IF NOT EXISTS idx_suppliers_org_number ON suppliers(org_number);
CREATE INDEX IF NOT EXISTS idx_suppliers_is_active ON suppliers(is_active);
CREATE INDEX IF NOT EXISTS idx_suppliers_category ON suppliers(category);
CREATE INDEX IF NOT EXISTS idx_suppliers_created_at ON suppliers(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_suppliers_tags ON suppliers USING GIN(tags);

CREATE INDEX IF NOT EXISTS idx_supplier_contacts_supplier ON supplier_contacts(supplier_id);
CREATE INDEX IF NOT EXISTS idx_supplier_contacts_primary ON supplier_contacts(supplier_id, is_primary);

CREATE INDEX IF NOT EXISTS idx_supplier_notes_supplier ON supplier_notes(supplier_id);
CREATE INDEX IF NOT EXISTS idx_supplier_notes_created_at ON supplier_notes(created_at DESC);

-- Composite indexes for common queries
CREATE INDEX IF NOT EXISTS idx_suppliers_company_active ON suppliers(company_id, is_active);
CREATE INDEX IF NOT EXISTS idx_suppliers_company_category ON suppliers(company_id, category);
CREATE INDEX IF NOT EXISTS idx_suppliers_company_name ON suppliers(company_id, name);

-- Comments
COMMENT ON TABLE suppliers IS 'Supplier/Vendor management data';
COMMENT ON TABLE supplier_contacts IS 'Multiple contact persons per supplier';
COMMENT ON TABLE supplier_notes IS 'Communication history and notes with suppliers';
COMMENT ON COLUMN suppliers.tags IS 'Array of tags for categorization';
COMMENT ON COLUMN suppliers.category IS 'Supplier category (IT, Office Supplies, Services, etc.)';
COMMENT ON COLUMN suppliers.payment_terms IS 'Payment terms in days';
COMMENT ON COLUMN suppliers.discount_percentage IS 'Default discount percentage from supplier';
