-- Fas A12: notiser & e-post. In-app-notiser fungerar fullt ut. E-post ligger i en
-- outbox som markeras 'sent' ENDAST om en riktig SMTP-transport skickat den;
-- utan SMTP-config blir status 'skipped_no_smtp' (aldrig fejkad leverans).

-- In-app-notiser knutna till en användare (valfritt även ett bolag för kontext).
CREATE TABLE notifications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_id  uuid REFERENCES companies(id) ON DELETE CASCADE,
  kind        text NOT NULL,
  title       text NOT NULL,
  body        text,
  link        text,                 -- valfri relativ länk (t.ex. /app/c/<id>/approvals)
  read_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_idx ON notifications (user_id, read_at, created_at DESC);

-- E-post-outbox: varje rad är ett e-postmeddelande som SKULLE skickas. Status
-- speglar verkligheten — ingen rad markeras 'sent' utan en faktisk transport.
CREATE TABLE email_outbox (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid REFERENCES users(id) ON DELETE SET NULL,
  to_email    text NOT NULL,
  subject     text NOT NULL,
  body        text NOT NULL,
  status      text NOT NULL DEFAULT 'queued'
                CHECK (status IN ('queued', 'sent', 'skipped_no_smtp', 'failed')),
  error       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);
CREATE INDEX email_outbox_status_idx ON email_outbox (status, created_at);

-- notifications: RLS så en användare bara ser SINA egna notiser.
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications FORCE ROW LEVEL SECURITY;
CREATE POLICY notifications_select ON notifications FOR SELECT USING (user_id = app_current_user_id());
CREATE POLICY notifications_insert ON notifications FOR INSERT WITH CHECK (true);
CREATE POLICY notifications_update ON notifications FOR UPDATE USING (user_id = app_current_user_id()) WITH CHECK (user_id = app_current_user_id());
GRANT SELECT, INSERT, UPDATE ON notifications TO app;

-- email_outbox: en användare får se SINA egna utskick (status), inte andras.
-- Bearbetning/markering till 'sent' sker av en riktig SMTP-transport (ägarroll/
-- worker) — app-rollen får bara INSERT + SELECT på egna rader.
ALTER TABLE email_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_outbox FORCE ROW LEVEL SECURITY;
CREATE POLICY email_outbox_select ON email_outbox FOR SELECT USING (user_id = app_current_user_id());
CREATE POLICY email_outbox_insert ON email_outbox FOR INSERT WITH CHECK (true);
GRANT SELECT, INSERT ON email_outbox TO app;
