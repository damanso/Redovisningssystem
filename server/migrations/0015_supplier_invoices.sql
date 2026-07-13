-- Fas A4: leverantörsfakturor (leverantörsreskontra). En inköpsfaktura med
-- förfallodag och status; bokförs till kostnad + ingående moms / kredit 2440,
-- betalas debet 2440 / kredit bank (delbetalning stöds via paid_amount_ore).

CREATE TABLE supplier_invoices (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  supplier_id     uuid NOT NULL REFERENCES suppliers(id),
  number          integer NOT NULL,        -- vårt interna löpnummer
  supplier_ref    text,                    -- leverantörens fakturanr/OCR
  invoice_date    date NOT NULL,
  due_date        date NOT NULL,
  net_ore         bigint NOT NULL CHECK (net_ore >= 0),
  vat_rate        smallint NOT NULL,
  vat_ore         bigint NOT NULL CHECK (vat_ore >= 0),
  total_ore       bigint NOT NULL CHECK (total_ore >= 0),
  paid_amount_ore bigint NOT NULL DEFAULT 0 CHECK (paid_amount_ore >= 0 AND paid_amount_ore <= total_ore),
  expense_account integer NOT NULL,
  status          text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'booked', 'paid', 'cancelled')),
  voucher_id      uuid REFERENCES vouchers(id),
  notes           text,
  created_by      uuid REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT supplier_invoices_number_uk UNIQUE (company_id, number),
  CONSTRAINT due_after_invoice CHECK (due_date >= invoice_date)
);
CREATE INDEX supplier_invoices_company_status_idx ON supplier_invoices (company_id, status);
CREATE INDEX supplier_invoices_supplier_idx ON supplier_invoices (company_id, supplier_id);

CREATE TRIGGER supplier_invoices_set_updated_at
  BEFORE UPDATE ON supplier_invoices FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE supplier_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_invoices FORCE ROW LEVEL SECURITY;
CREATE POLICY supplier_invoices_select ON supplier_invoices FOR SELECT USING (app_has_company_access(company_id));
CREATE POLICY supplier_invoices_insert ON supplier_invoices FOR INSERT WITH CHECK (app_has_company_access(company_id));
CREATE POLICY supplier_invoices_update ON supplier_invoices FOR UPDATE USING (app_has_company_access(company_id)) WITH CHECK (app_has_company_access(company_id));
GRANT SELECT, INSERT, UPDATE ON supplier_invoices TO app;
