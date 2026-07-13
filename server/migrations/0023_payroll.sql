-- Fas A14: lön & HR (utan AGI/KU-10 till Skatteverket). Anställda och lönebesked.
-- En lönekörning beräknar brutto, preliminärskatt (platt skattesats per anställd —
-- en förenkling; en riktig skattetabell ligger utanför scope) och arbetsgivar-
-- avgifter, och bokför. INGEN arbetsgivardeklaration lämnas — det är utanför scope.
-- Belopp i heltal ören.

CREATE TABLE employees (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name              text NOT NULL,
  personnummer      text,                       -- valfritt; visas maskerat i UI
  email             text,
  monthly_salary_ore bigint NOT NULL CHECK (monthly_salary_ore >= 0),
  tax_rate          smallint NOT NULL DEFAULT 30 CHECK (tax_rate BETWEEN 0 AND 100),
  employment_type   text NOT NULL DEFAULT 'tillsvidare',
  active            boolean NOT NULL DEFAULT true,
  created_by        uuid REFERENCES users(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX employees_company_active_idx ON employees (company_id, active);

CREATE TABLE payslips (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_id               uuid NOT NULL REFERENCES employees(id),
  period                    text NOT NULL,       -- 'YYYY-MM'
  gross_ore                 bigint NOT NULL CHECK (gross_ore >= 0),
  tax_ore                   bigint NOT NULL CHECK (tax_ore >= 0),
  net_ore                   bigint NOT NULL CHECK (net_ore >= 0),
  employer_contribution_ore bigint NOT NULL CHECK (employer_contribution_ore >= 0),
  status                    text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'booked', 'cancelled')),
  voucher_id                uuid REFERENCES vouchers(id),
  created_by                uuid REFERENCES users(id),
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payslips_period_uk UNIQUE (company_id, employee_id, period)
);
CREATE INDEX payslips_company_period_idx ON payslips (company_id, period);

CREATE TRIGGER employees_set_updated_at BEFORE UPDATE ON employees FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER payslips_set_updated_at BEFORE UPDATE ON payslips FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE employees FORCE ROW LEVEL SECURITY;
CREATE POLICY employees_select ON employees FOR SELECT USING (app_has_company_access(company_id));
CREATE POLICY employees_insert ON employees FOR INSERT WITH CHECK (app_has_company_access(company_id));
CREATE POLICY employees_update ON employees FOR UPDATE USING (app_has_company_access(company_id)) WITH CHECK (app_has_company_access(company_id));
GRANT SELECT, INSERT, UPDATE ON employees TO app;

ALTER TABLE payslips ENABLE ROW LEVEL SECURITY;
ALTER TABLE payslips FORCE ROW LEVEL SECURITY;
CREATE POLICY payslips_select ON payslips FOR SELECT USING (app_has_company_access(company_id));
CREATE POLICY payslips_insert ON payslips FOR INSERT WITH CHECK (app_has_company_access(company_id));
CREATE POLICY payslips_update ON payslips FOR UPDATE USING (app_has_company_access(company_id)) WITH CHECK (app_has_company_access(company_id));
GRANT SELECT, INSERT, UPDATE ON payslips TO app;
