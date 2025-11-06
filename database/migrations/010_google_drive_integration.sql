-- Google Drive Integration Migration
-- Purpose: Enable document sync with Google Drive for invoices and receipts

-- Table to store Google Drive OAuth credentials per company
CREATE TABLE IF NOT EXISTS google_drive_credentials (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL UNIQUE REFERENCES companies(id) ON DELETE CASCADE,
    access_token TEXT NOT NULL,
    refresh_token TEXT NOT NULL,
    token_expiry TIMESTAMP NOT NULL,
    scope TEXT NOT NULL,
    root_folder_id TEXT,
    root_folder_name TEXT DEFAULT 'Redovisning',
    is_active BOOLEAN DEFAULT true,
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Table to track document sync status
CREATE TABLE IF NOT EXISTS google_drive_sync (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    document_type VARCHAR(50) NOT NULL CHECK (document_type IN ('invoice', 'receipt')),
    document_id UUID NOT NULL,
    drive_file_id TEXT NOT NULL,
    drive_file_name TEXT NOT NULL,
    drive_folder_id TEXT NOT NULL,
    file_size BIGINT,
    mime_type VARCHAR(100),
    web_view_link TEXT,
    last_synced_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    sync_status VARCHAR(20) DEFAULT 'synced' CHECK (sync_status IN ('synced', 'pending', 'failed', 'deleted')),
    error_message TEXT,
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(document_type, document_id)
);

-- Indexes for performance
CREATE INDEX idx_drive_credentials_company ON google_drive_credentials(company_id);
CREATE INDEX idx_drive_credentials_active ON google_drive_credentials(is_active);

CREATE INDEX idx_drive_sync_company ON google_drive_sync(company_id);
CREATE INDEX idx_drive_sync_document ON google_drive_sync(document_type, document_id);
CREATE INDEX idx_drive_sync_status ON google_drive_sync(sync_status);
CREATE INDEX idx_drive_sync_last_synced ON google_drive_sync(last_synced_at);
CREATE INDEX idx_drive_sync_drive_file ON google_drive_sync(drive_file_id);

-- Triggers to auto-update updated_at
CREATE OR REPLACE FUNCTION update_google_drive_credentials_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER google_drive_credentials_updated_at
    BEFORE UPDATE ON google_drive_credentials
    FOR EACH ROW
    EXECUTE FUNCTION update_google_drive_credentials_updated_at();

CREATE OR REPLACE FUNCTION update_google_drive_sync_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER google_drive_sync_updated_at
    BEFORE UPDATE ON google_drive_sync
    FOR EACH ROW
    EXECUTE FUNCTION update_google_drive_sync_updated_at();

-- Comments
COMMENT ON TABLE google_drive_credentials IS 'Stores Google Drive OAuth2 credentials for each company';
COMMENT ON TABLE google_drive_sync IS 'Tracks sync status of documents (invoices/receipts) with Google Drive';
COMMENT ON COLUMN google_drive_credentials.root_folder_id IS 'Main folder ID in Google Drive for company documents';
COMMENT ON COLUMN google_drive_sync.sync_status IS 'synced: successfully synced; pending: waiting to sync; failed: sync error; deleted: file removed from Drive';
