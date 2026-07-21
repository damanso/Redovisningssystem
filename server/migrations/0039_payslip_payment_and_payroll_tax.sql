-- K2: lönebeskedet får utbetalningsdatum (den 25:e med svensk bankdagsregel,
-- satt av tjänstelagret), valbar semesterersättning (skattepliktig, höjer
-- underlaget) och förberedda men AVSTÄNGDA pensionsfält (beslut 2026-06-30:
-- tjänstepensionspremie 7410/7411 + särskild löneskatt 24,26 % 7533/2514
-- aktiveras inte — kolumnerna finns så datamodellen inte behöver ändras då).
--
-- Dessutom payroll_tax_payments: skattekontobetalningen (kontantmetoden) som
-- egen händelse — 2510 D / 1930 K (skatt + arbetsgivaravgift) vid ~12:e månaden
-- efter löneutbetalningen. UNIQUE (company_id, period) är dubbelbokningsspärren.

ALTER TABLE payslips
  ADD COLUMN payment_date date,
  ADD COLUMN vacation_pay_ore bigint NOT NULL DEFAULT 0 CHECK (vacation_pay_ore >= 0),
  ADD COLUMN pension_premium_ore bigint NOT NULL DEFAULT 0 CHECK (pension_premium_ore >= 0),
  ADD COLUMN pension_salary_tax_ore bigint NOT NULL DEFAULT 0 CHECK (pension_salary_tax_ore >= 0);

CREATE TABLE payroll_tax_payments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  period        text NOT NULL,       -- löneperioden 'YYYY-MM' betalningen avser
  payment_date  date NOT NULL,
  tax_ore       bigint NOT NULL CHECK (tax_ore >= 0),
  employer_contribution_ore bigint NOT NULL CHECK (employer_contribution_ore >= 0),
  amount_ore    bigint NOT NULL CHECK (amount_ore >= 0),  -- bokfört belopp (hela kronor)
  voucher_id    uuid NOT NULL REFERENCES vouchers(id),
  created_by    uuid REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payroll_tax_payments_period_uk UNIQUE (company_id, period)
);

ALTER TABLE payroll_tax_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_tax_payments FORCE ROW LEVEL SECURITY;
CREATE POLICY payroll_tax_payments_select ON payroll_tax_payments FOR SELECT USING (app_has_company_access(company_id));
CREATE POLICY payroll_tax_payments_insert ON payroll_tax_payments FOR INSERT WITH CHECK (app_has_company_access(company_id));
GRANT SELECT, INSERT ON payroll_tax_payments TO app;
