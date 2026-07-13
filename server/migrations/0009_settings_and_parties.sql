-- Fas 2: företagsinställningar (för fakturor/PDF) + affärsparter.

-- Betal- och adressuppgifter på bolaget. Bankgiro m.m. behövs på faktura-PDF:en
-- och i betalinformationen (gamla schemat saknade bank_account helt → tomt på PDF).
ALTER TABLE companies
  ADD COLUMN address        text,
  ADD COLUMN postal_code    text,
  ADD COLUMN city           text,
  ADD COLUMN email          text,
  ADD COLUMN phone          text,
  ADD COLUMN vat_number     text,
  ADD COLUMN bankgiro       text,
  ADD COLUMN plusgiro       text,
  ADD COLUMN bank_account   text,
  ADD COLUMN iban           text,
  ADD COLUMN payment_terms  integer NOT NULL DEFAULT 30 CHECK (payment_terms >= 0);

-- Gemensam tabell-mall: parterna delar struktur. Belopp/priser i ören.
CREATE TABLE customers (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  customer_number integer NOT NULL,
  name           text NOT NULL,
  org_number     text,
  email          text,
  phone          text,
  address        text,
  postal_code    text,
  city           text,
  payment_terms  integer CHECK (payment_terms IS NULL OR payment_terms >= 0),
  is_active      boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, customer_number)
);
CREATE INDEX customers_company_active_idx ON customers (company_id, is_active);
CREATE TRIGGER customers_set_updated_at
  BEFORE UPDATE ON customers FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE suppliers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  supplier_number integer NOT NULL,
  name            text NOT NULL,
  org_number      text,
  email           text,
  phone           text,
  bankgiro        text,
  plusgiro        text,
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, supplier_number)
);
CREATE INDEX suppliers_company_active_idx ON suppliers (company_id, is_active);
CREATE TRIGGER suppliers_set_updated_at
  BEFORE UPDATE ON suppliers FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE articles (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  article_number  text NOT NULL,
  name            text NOT NULL,
  unit            text NOT NULL DEFAULT 'st',
  unit_price_ore  bigint NOT NULL DEFAULT 0 CHECK (unit_price_ore >= 0),
  vat_rate        integer NOT NULL DEFAULT 25 CHECK (vat_rate IN (0, 6, 12, 25)),
  revenue_account integer NOT NULL DEFAULT 3001 CHECK (revenue_account BETWEEN 1000 AND 9999),
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, article_number)
);
CREATE INDEX articles_company_active_idx ON articles (company_id, is_active);
CREATE TRIGGER articles_set_updated_at
  BEFORE UPDATE ON articles FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- RLS: medlemskapsbaserad, FORCE, som resten av kärnan.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['customers', 'suppliers', 'articles'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I_select ON %I FOR SELECT USING (app_has_company_access(company_id))', t, t);
    EXECUTE format(
      'CREATE POLICY %I_insert ON %I FOR INSERT WITH CHECK (app_has_company_access(company_id))', t, t);
    EXECUTE format(
      'CREATE POLICY %I_update ON %I FOR UPDATE USING (app_has_company_access(company_id)) WITH CHECK (app_has_company_access(company_id))', t, t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON %I TO app', t);
  END LOOP;
END
$$;
