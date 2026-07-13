-- Fas A5: återkommande fakturor. En mall knuten till en kund med sparade rader
-- (jsonb, samma form som InvoiceLineInput). Vid varje förfallodatum genereras en
-- riktig faktura via createInvoice och next_run_date flyttas fram enligt intervall.
-- Mallen bokför inget själv; den skapar utkastsfakturor som vanligt.

CREATE TABLE recurring_invoices (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  customer_id       uuid NOT NULL REFERENCES customers(id),
  title             text NOT NULL,
  interval          text NOT NULL CHECK (interval IN ('monthly', 'quarterly', 'yearly')),
  next_run_date     date NOT NULL,
  end_date          date,                       -- valfritt slutdatum (inklusive)
  payment_terms     integer,                    -- override; annars kundens/30
  reference         text,
  notes             text,
  lines             jsonb NOT NULL,             -- [{article_id?,description?,quantity,...}]
  active            boolean NOT NULL DEFAULT true,
  last_generated_at date,                       -- fakturadatum för senast genererade
  generated_count   integer NOT NULL DEFAULT 0,
  created_by        uuid REFERENCES users(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
  -- Ingen CHECK end_date >= next_run_date: next_run_date flyttas fram över tid
  -- (och kan passera end_date när mallen deaktiveras). Skapandet validerar i
  -- tjänstelagret att end_date inte ligger före startdatum.
);
CREATE INDEX recurring_invoices_company_active_idx ON recurring_invoices (company_id, active, next_run_date);
CREATE INDEX recurring_invoices_customer_idx ON recurring_invoices (company_id, customer_id);

CREATE TRIGGER recurring_invoices_set_updated_at
  BEFORE UPDATE ON recurring_invoices FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE recurring_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE recurring_invoices FORCE ROW LEVEL SECURITY;
CREATE POLICY recurring_invoices_select ON recurring_invoices FOR SELECT USING (app_has_company_access(company_id));
CREATE POLICY recurring_invoices_insert ON recurring_invoices FOR INSERT WITH CHECK (app_has_company_access(company_id));
CREATE POLICY recurring_invoices_update ON recurring_invoices FOR UPDATE USING (app_has_company_access(company_id)) WITH CHECK (app_has_company_access(company_id));
GRANT SELECT, INSERT, UPDATE ON recurring_invoices TO app;
