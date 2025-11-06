-- Google Calendar authentication table
CREATE TABLE IF NOT EXISTS google_calendar_auth (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    access_token TEXT NOT NULL,
    refresh_token TEXT NOT NULL,
    token_expiry TIMESTAMP NOT NULL,
    calendar_id VARCHAR(255) DEFAULT 'primary',
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Calendar events table
CREATE TABLE IF NOT EXISTS calendar_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    google_event_id VARCHAR(255),
    title VARCHAR(500) NOT NULL,
    description TEXT,
    location VARCHAR(500),
    start_time TIMESTAMP NOT NULL,
    end_time TIMESTAMP NOT NULL,
    all_day BOOLEAN DEFAULT false,
    attendees TEXT[],
    reminder_minutes INTEGER,
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'cancelled')),
    sync_to_google BOOLEAN DEFAULT false,
    last_synced_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Calendar reminders table
CREATE TABLE IF NOT EXISTS calendar_reminders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    event_id UUID REFERENCES calendar_events(id) ON DELETE CASCADE,
    google_event_id VARCHAR(255),
    title VARCHAR(500) NOT NULL,
    description TEXT,
    reminder_time TIMESTAMP NOT NULL,
    is_completed BOOLEAN DEFAULT false,
    sync_to_google BOOLEAN DEFAULT false,
    last_synced_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for google_calendar_auth
CREATE INDEX IF NOT EXISTS idx_google_calendar_auth_company ON google_calendar_auth(company_id);
CREATE INDEX IF NOT EXISTS idx_google_calendar_auth_user ON google_calendar_auth(user_id);
CREATE INDEX IF NOT EXISTS idx_google_calendar_auth_active ON google_calendar_auth(is_active);

-- Indexes for calendar_events
CREATE INDEX IF NOT EXISTS idx_calendar_events_company ON calendar_events(company_id);
CREATE INDEX IF NOT EXISTS idx_calendar_events_user ON calendar_events(user_id);
CREATE INDEX IF NOT EXISTS idx_calendar_events_google_id ON calendar_events(google_event_id);
CREATE INDEX IF NOT EXISTS idx_calendar_events_start_time ON calendar_events(start_time);
CREATE INDEX IF NOT EXISTS idx_calendar_events_status ON calendar_events(status);
CREATE INDEX IF NOT EXISTS idx_calendar_events_sync ON calendar_events(sync_to_google);

-- Indexes for calendar_reminders
CREATE INDEX IF NOT EXISTS idx_calendar_reminders_company ON calendar_reminders(company_id);
CREATE INDEX IF NOT EXISTS idx_calendar_reminders_user ON calendar_reminders(user_id);
CREATE INDEX IF NOT EXISTS idx_calendar_reminders_event ON calendar_reminders(event_id);
CREATE INDEX IF NOT EXISTS idx_calendar_reminders_time ON calendar_reminders(reminder_time);
CREATE INDEX IF NOT EXISTS idx_calendar_reminders_completed ON calendar_reminders(is_completed);
CREATE INDEX IF NOT EXISTS idx_calendar_reminders_sync ON calendar_reminders(sync_to_google);

-- Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_calendar_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER calendar_events_updated_at
    BEFORE UPDATE ON calendar_events
    FOR EACH ROW
    EXECUTE FUNCTION update_calendar_updated_at();

CREATE TRIGGER calendar_reminders_updated_at
    BEFORE UPDATE ON calendar_reminders
    FOR EACH ROW
    EXECUTE FUNCTION update_calendar_updated_at();

CREATE TRIGGER google_calendar_auth_updated_at
    BEFORE UPDATE ON google_calendar_auth
    FOR EACH ROW
    EXECUTE FUNCTION update_calendar_updated_at();
