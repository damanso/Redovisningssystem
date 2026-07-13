-- Fas A6: projekt & tidrapportering. Projekt kan knytas till en kund och har en
-- valfri timtaxa/budget. Tidposter loggas i minuter (heltal) mot ett projekt och
-- kan vara fakturerbara. Belopp beräknas som minuter/60 * timtaxa i ören.

CREATE TABLE projects (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  customer_id      uuid REFERENCES customers(id),
  number           integer NOT NULL,
  name             text NOT NULL,
  status           text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed')),
  hourly_rate_ore  bigint CHECK (hourly_rate_ore IS NULL OR hourly_rate_ore >= 0),
  budget_ore       bigint CHECK (budget_ore IS NULL OR budget_ore >= 0),
  notes            text,
  created_by       uuid REFERENCES users(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT projects_number_uk UNIQUE (company_id, number)
);
CREATE INDEX projects_company_status_idx ON projects (company_id, status);

CREATE TABLE time_entries (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  project_id       uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  work_date        date NOT NULL,
  minutes          integer NOT NULL CHECK (minutes > 0 AND minutes <= 1440),
  description      text NOT NULL,
  hourly_rate_ore  bigint CHECK (hourly_rate_ore IS NULL OR hourly_rate_ore >= 0), -- override av projektets taxa
  billable         boolean NOT NULL DEFAULT true,
  invoiced         boolean NOT NULL DEFAULT false,
  created_by       uuid REFERENCES users(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX time_entries_project_idx ON time_entries (company_id, project_id, work_date);

CREATE TRIGGER projects_set_updated_at
  BEFORE UPDATE ON projects FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER time_entries_set_updated_at
  BEFORE UPDATE ON time_entries FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects FORCE ROW LEVEL SECURITY;
CREATE POLICY projects_select ON projects FOR SELECT USING (app_has_company_access(company_id));
CREATE POLICY projects_insert ON projects FOR INSERT WITH CHECK (app_has_company_access(company_id));
CREATE POLICY projects_update ON projects FOR UPDATE USING (app_has_company_access(company_id)) WITH CHECK (app_has_company_access(company_id));
GRANT SELECT, INSERT, UPDATE ON projects TO app;

ALTER TABLE time_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE time_entries FORCE ROW LEVEL SECURITY;
CREATE POLICY time_entries_select ON time_entries FOR SELECT USING (app_has_company_access(company_id));
CREATE POLICY time_entries_insert ON time_entries FOR INSERT WITH CHECK (app_has_company_access(company_id));
CREATE POLICY time_entries_update ON time_entries FOR UPDATE USING (app_has_company_access(company_id)) WITH CHECK (app_has_company_access(company_id));
GRANT SELECT, INSERT, UPDATE ON time_entries TO app;
