-- Fas 2: fakturor och kvitton. Belopp i heltal ören. Koppling till huvudboken
-- via voucher_id (sätts när dokumentet bokförs — dubbelbokningsspärren i
-- vouchers hindrar dubbel bokföring).

CREATE TABLE invoices (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  customer_id    uuid NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  invoice_number integer NOT NULL,
  ocr            text,
  invoice_date   date NOT NULL,
  due_date       date NOT NULL,
  status         text NOT NULL DEFAULT 'draft'
                   CHECK (status IN ('draft', 'sent', 'paid', 'cancelled')),
  currency       text NOT NULL DEFAULT 'SEK',
  subtotal_ore   bigint NOT NULL DEFAULT 0 CHECK (subtotal_ore >= 0),
  vat_ore        bigint NOT NULL DEFAULT 0 CHECK (vat_ore >= 0),
  total_ore      bigint NOT NULL DEFAULT 0 CHECK (total_ore >= 0),
  reference      text,
  notes          text,
  pdf_file_id    uuid REFERENCES files(id),
  voucher_id     uuid REFERENCES vouchers(id),
  created_by     uuid NOT NULL REFERENCES users(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, invoice_number),
  UNIQUE (id, company_id) -- referens för composite-FK från invoice_lines
);
CREATE INDEX invoices_company_status_idx ON invoices (company_id, status);
CREATE INDEX invoices_customer_idx ON invoices (customer_id);
CREATE TRIGGER invoices_set_updated_at
  BEFORE UPDATE ON invoices FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE invoice_lines (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id      uuid NOT NULL,
  company_id      uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  line_no         integer NOT NULL,
  article_id      uuid REFERENCES articles(id),
  description     text NOT NULL,
  quantity        numeric(14, 3) NOT NULL CHECK (quantity > 0),
  unit            text NOT NULL DEFAULT 'st',
  unit_price_ore  bigint NOT NULL CHECK (unit_price_ore >= 0),
  vat_rate        integer NOT NULL CHECK (vat_rate IN (0, 6, 12, 25)),
  line_net_ore    bigint NOT NULL CHECK (line_net_ore >= 0),
  revenue_account integer NOT NULL CHECK (revenue_account BETWEEN 1000 AND 9999),
  -- Binder radens bolag till fakturans (samma mönster som voucher_lines).
  FOREIGN KEY (invoice_id, company_id) REFERENCES invoices (id, company_id) ON DELETE CASCADE
);
CREATE INDEX invoice_lines_invoice_idx ON invoice_lines (invoice_id);

CREATE TABLE receipts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  supplier_id     uuid REFERENCES suppliers(id),
  receipt_number  integer NOT NULL,
  receipt_date    date NOT NULL,
  description     text NOT NULL,
  net_ore         bigint NOT NULL CHECK (net_ore >= 0),
  vat_ore         bigint NOT NULL CHECK (vat_ore >= 0),
  total_ore       bigint NOT NULL CHECK (total_ore >= 0),
  vat_rate        integer NOT NULL CHECK (vat_rate IN (0, 6, 12, 25)),
  expense_account integer NOT NULL CHECK (expense_account BETWEEN 1000 AND 9999),
  payment_account integer NOT NULL DEFAULT 2440 CHECK (payment_account BETWEEN 1000 AND 9999),
  status          text NOT NULL DEFAULT 'registered'
                    CHECK (status IN ('registered', 'booked', 'cancelled')),
  file_id         uuid REFERENCES files(id),
  voucher_id      uuid REFERENCES vouchers(id),
  created_by      uuid NOT NULL REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, receipt_number)
);
CREATE INDEX receipts_company_status_idx ON receipts (company_id, status);
CREATE TRIGGER receipts_set_updated_at
  BEFORE UPDATE ON receipts FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- RLS
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['invoices', 'invoice_lines', 'receipts'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I_select ON %I FOR SELECT USING (app_has_company_access(company_id))', t, t);
    EXECUTE format(
      'CREATE POLICY %I_insert ON %I FOR INSERT WITH CHECK (app_has_company_access(company_id))', t, t);
  END LOOP;
END
$$;

-- invoices/receipts behöver UPDATE (status, totaler, pdf/voucher-koppling);
-- invoice_lines byts ut atomiskt vid uppdatering (DELETE+INSERT medan utkast).
CREATE POLICY invoices_update ON invoices FOR UPDATE
  USING (app_has_company_access(company_id)) WITH CHECK (app_has_company_access(company_id));
CREATE POLICY receipts_update ON receipts FOR UPDATE
  USING (app_has_company_access(company_id)) WITH CHECK (app_has_company_access(company_id));
CREATE POLICY invoice_lines_delete ON invoice_lines FOR DELETE
  USING (app_has_company_access(company_id));

GRANT SELECT, INSERT, UPDATE ON invoices TO app;
GRANT SELECT, INSERT, DELETE ON invoice_lines TO app;
GRANT SELECT, INSERT, UPDATE ON receipts TO app;
