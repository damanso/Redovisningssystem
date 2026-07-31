-- LOC-263 del 1b: fakturans BILAGA (sida 2 i husmallen).
--
-- Två varianter finns i Locollabs verkliga fakturor:
--   'time'    — tidsspecifikation per datum (mönster: faktura 0000027),
--               kolumn "Timmar", avslutas med "Summa fakturerbar tid ... 31,42 h".
--   'expense' — utläggsspecifikation per datum (mönster: faktura 0000024),
--               kolumn "SEK", avslutas med summa exkl./moms/inkl. moms.
--
-- Tid lagras som HELTAL MINUTER (aldrig flyttal), samma modell som
-- time_entries.minutes — husmallens "0,42 h" är 25 minuter, och bilagans
-- totalsumma 31,42 h är 1885 minuter. Utlägg lagras som heltal ören.

ALTER TABLE invoices
  ADD COLUMN appendix_kind     text CHECK (appendix_kind IN ('time', 'expense')),
  ADD COLUMN appendix_title    text,
  ADD COLUMN appendix_preamble text,
  ADD COLUMN appendix_notes    text;

CREATE TABLE invoice_appendix_rows (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id  uuid NOT NULL,
  company_id  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  row_no      integer NOT NULL CHECK (row_no > 0),
  entry_date  date NOT NULL,
  description text NOT NULL,
  -- Exakt EN av dessa är satt, styrt av fakturans appendix_kind.
  minutes     integer CHECK (minutes IS NULL OR minutes > 0),
  amount_ore  bigint  CHECK (amount_ore IS NULL OR amount_ore >= 0),
  created_at  timestamptz NOT NULL DEFAULT now(),
  -- Komposit-FK: bilageraden kan aldrig hamna på en faktura i ett annat bolag.
  FOREIGN KEY (invoice_id, company_id) REFERENCES invoices (id, company_id) ON DELETE CASCADE,
  UNIQUE (invoice_id, row_no),
  CONSTRAINT appendix_row_exactly_one_value CHECK ((minutes IS NULL) <> (amount_ore IS NULL))
);
CREATE INDEX invoice_appendix_rows_invoice_idx ON invoice_appendix_rows (invoice_id, row_no);

ALTER TABLE invoice_appendix_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_appendix_rows FORCE ROW LEVEL SECURITY;

CREATE POLICY invoice_appendix_rows_select ON invoice_appendix_rows FOR SELECT
  USING (app_has_company_access(company_id));
CREATE POLICY invoice_appendix_rows_insert ON invoice_appendix_rows FOR INSERT
  WITH CHECK (app_has_company_access(company_id));
-- DELETE tillåts bara för OBOKADE utkast — samma regel som draft-delete (K7):
-- en bokförd fakturas underlag får aldrig försvinna.
CREATE POLICY invoice_appendix_rows_delete ON invoice_appendix_rows FOR DELETE
  USING (
    app_has_company_access(company_id)
    AND EXISTS (
      SELECT 1 FROM invoices i
      WHERE i.id = invoice_appendix_rows.invoice_id
        AND i.company_id = invoice_appendix_rows.company_id
        AND i.voucher_id IS NULL
        AND i.status = 'draft'
    )
  );

GRANT SELECT, INSERT, DELETE ON invoice_appendix_rows TO app;
