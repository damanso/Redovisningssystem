-- Fas B4: skattepåminnelser. Registrerar vilka deadlines som redan påmints om, så
-- en körning inte skickar dubbletter. Själva utskicket sker som in-app-notis +
-- (SMTP-gated) e-post. Automatisk avfyrning kräver en extern schemaläggare som
-- anropar run_tax_reminders — den gränsen är flaggad, inget fejkas.

CREATE TABLE tax_reminders (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  deadline_type text NOT NULL,        -- 'vat' | 'agi' | 'income_tax'
  period_label  text NOT NULL,
  due_date      date NOT NULL,
  sent_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tax_reminders_uk UNIQUE (company_id, deadline_type, period_label)
);
CREATE INDEX tax_reminders_company_idx ON tax_reminders (company_id, due_date);

ALTER TABLE tax_reminders ENABLE ROW LEVEL SECURITY;
ALTER TABLE tax_reminders FORCE ROW LEVEL SECURITY;
CREATE POLICY tax_reminders_select ON tax_reminders FOR SELECT USING (app_has_company_access(company_id));
CREATE POLICY tax_reminders_insert ON tax_reminders FOR INSERT WITH CHECK (app_has_company_access(company_id));
GRANT SELECT, INSERT ON tax_reminders TO app;
