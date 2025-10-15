-- Create articles table (product/service catalog for invoices)
CREATE TABLE IF NOT EXISTS articles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,

    -- Basic Information
    name VARCHAR(255) NOT NULL,
    description TEXT,
    article_number VARCHAR(100),

    -- Pricing
    price DECIMAL(12, 2) NOT NULL,
    unit VARCHAR(20) DEFAULT 'st',
    vat_rate DECIMAL(5, 2) NOT NULL,

    -- Accounting
    account_number INTEGER,

    -- Categorization
    category VARCHAR(100),

    -- Status
    is_active BOOLEAN DEFAULT true,

    -- Metadata
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_articles_company_id ON articles(company_id);
CREATE INDEX IF NOT EXISTS idx_articles_article_number ON articles(article_number);
CREATE INDEX IF NOT EXISTS idx_articles_category ON articles(category);
CREATE INDEX IF NOT EXISTS idx_articles_is_active ON articles(is_active);
CREATE INDEX IF NOT EXISTS idx_articles_created_at ON articles(created_at DESC);

-- Composite indexes for common queries
CREATE INDEX IF NOT EXISTS idx_articles_company_active ON articles(company_id, is_active);
CREATE INDEX IF NOT EXISTS idx_articles_company_category ON articles(company_id, category);
CREATE INDEX IF NOT EXISTS idx_articles_company_name ON articles(company_id, name);

-- Full text search index
CREATE INDEX IF NOT EXISTS idx_articles_name_trgm ON articles USING gin(name gin_trgm_ops);

-- Unique constraint for article number within company
CREATE UNIQUE INDEX IF NOT EXISTS idx_articles_company_article_number
ON articles(company_id, article_number)
WHERE article_number IS NOT NULL;

-- Comments
COMMENT ON TABLE articles IS 'Product and service catalog for invoices';
COMMENT ON COLUMN articles.unit IS 'Unit of measurement (st, hour, kg, m2, etc.)';
COMMENT ON COLUMN articles.vat_rate IS 'VAT rate as percentage (25, 12, 6, 0)';
COMMENT ON COLUMN articles.account_number IS 'Accounting account number for bookkeeping';
COMMENT ON COLUMN articles.category IS 'Article category (Products, Services, Consulting, etc.)';
