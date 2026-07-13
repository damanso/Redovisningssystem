-- Verifikationer (bokföringens hjärta).
--
-- Invarianter som tvingas i databasen (inte bara i appen):
--   * Belopp i heltal ören (bigint) — aldrig float.
--   * Debet = kredit, framtvingat av en DEFERRABLE constraint-trigger vid commit.
--   * Gap-fri löpnummerserie per bolag/räkenskapsår (bokföringslagens obrutna
--     nummerserie): en atomisk räknare i voucher_series, som rullas tillbaka
--     med transaktionen (en råsekvens skulle lämna gap vid rollback).
--   * Oföränderlighet: bokförda verifikat kan inte ändras/raderas (trigger +
--     inga UPDATE/DELETE-grants). Rättelse sker med ett nytt rättelseverifikat.
--   * Periodlås: verifikat i ett låst räkenskapsår, eller med datum utanför
--     årets intervall, avvisas.

-- Löpnummerräknare per serie.
CREATE TABLE voucher_series (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  fiscal_year_id uuid NOT NULL REFERENCES fiscal_years(id) ON DELETE CASCADE,
  series         text NOT NULL CHECK (series ~ '^[A-Z]$'),
  next_number    integer NOT NULL DEFAULT 1 CHECK (next_number >= 1),
  UNIQUE (company_id, fiscal_year_id, series)
);

CREATE TABLE vouchers (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  fiscal_year_id      uuid NOT NULL REFERENCES fiscal_years(id) ON DELETE RESTRICT,
  series              text NOT NULL CHECK (series ~ '^[A-Z]$'),
  number              integer NOT NULL CHECK (number >= 1),
  voucher_date        date NOT NULL,
  description         text NOT NULL,
  source_type         text NOT NULL DEFAULT 'manual',
  source_id           text,
  reverses_voucher_id uuid REFERENCES vouchers(id),
  created_by          uuid NOT NULL REFERENCES users(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, fiscal_year_id, series, number)
);

-- Dubbelbokningsspärr: ett källdokument (t.ex. en faktura) kan bokas EN gång.
-- Rättelseverifikat har source_id = NULL och omfattas inte.
CREATE UNIQUE INDEX vouchers_source_uk
  ON vouchers (company_id, source_type, source_id)
  WHERE source_id IS NOT NULL;

CREATE INDEX vouchers_fiscal_year_idx ON vouchers (company_id, fiscal_year_id);

CREATE TABLE voucher_lines (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  voucher_id     uuid NOT NULL REFERENCES vouchers(id) ON DELETE CASCADE,
  company_id     uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  account_number integer NOT NULL CHECK (account_number BETWEEN 1000 AND 9999),
  debit_ore      bigint NOT NULL DEFAULT 0 CHECK (debit_ore >= 0),
  credit_ore     bigint NOT NULL DEFAULT 0 CHECK (credit_ore >= 0),
  description    text,
  line_no        integer NOT NULL,
  -- Exakt en av debet/kredit är positiv (ingen noll-noll-rad).
  CONSTRAINT voucher_line_debit_xor_credit CHECK (
    (debit_ore > 0 AND credit_ore = 0) OR (credit_ore > 0 AND debit_ore = 0)
  )
);

CREATE INDEX voucher_lines_voucher_idx ON voucher_lines (voucher_id);
CREATE INDEX voucher_lines_account_idx ON voucher_lines (company_id, account_number);

-- Balanskontroll vid commit: debet = kredit och minst två rader. Körs som
-- INVOKER (app) med RLS-kontext satt, så voucher_lines-raderna är synliga.
CREATE FUNCTION voucher_assert_balanced() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  total_debit bigint;
  total_credit bigint;
  line_count integer;
BEGIN
  SELECT COALESCE(sum(debit_ore), 0), COALESCE(sum(credit_ore), 0), count(*)
    INTO total_debit, total_credit, line_count
    FROM voucher_lines WHERE voucher_id = NEW.id;

  IF line_count < 2 THEN
    RAISE EXCEPTION 'verifikat % måste ha minst två konteringsrader (har %)', NEW.id, line_count;
  END IF;
  IF total_debit <> total_credit THEN
    RAISE EXCEPTION 'verifikat % är obalanserat: debet % <> kredit % (ören)',
      NEW.id, total_debit, total_credit;
  END IF;
  IF total_debit = 0 THEN
    RAISE EXCEPTION 'verifikat % har nollbelopp', NEW.id;
  END IF;
  RETURN NULL;
END
$$;

CREATE CONSTRAINT TRIGGER vouchers_balanced
  AFTER INSERT ON vouchers
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION voucher_assert_balanced();

-- Periodlås + datumintervall. SECURITY DEFINER för att läsa fiscal_years utan
-- att RLS/FORCE ska kunna dölja raden; search_path låst.
CREATE FUNCTION voucher_check_period() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  fy fiscal_years%ROWTYPE;
BEGIN
  SELECT * INTO fy FROM fiscal_years WHERE id = NEW.fiscal_year_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'okänt räkenskapsår %', NEW.fiscal_year_id;
  END IF;
  IF fy.company_id <> NEW.company_id THEN
    RAISE EXCEPTION 'räkenskapsåret tillhör ett annat bolag';
  END IF;
  IF fy.is_locked THEN
    RAISE EXCEPTION 'räkenskapsåret % är låst — inga nya verifikat', fy.label;
  END IF;
  IF NEW.voucher_date < fy.start_date OR NEW.voucher_date > fy.end_date THEN
    RAISE EXCEPTION 'verifikationsdatum % ligger utanför räkenskapsåret %..%',
      NEW.voucher_date, fy.start_date, fy.end_date;
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER vouchers_check_period
  BEFORE INSERT ON vouchers
  FOR EACH ROW EXECUTE FUNCTION voucher_check_period();

-- Oföränderlighet: bokförda verifikat och deras rader kan inte ändras/raderas.
CREATE FUNCTION voucher_block_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'bokförda verifikat är oföränderliga: % tillåts inte (använd rättelseverifikat)', TG_OP;
END
$$;

CREATE TRIGGER vouchers_immutable
  BEFORE UPDATE OR DELETE ON vouchers
  FOR EACH ROW EXECUTE FUNCTION voucher_block_mutation();
CREATE TRIGGER voucher_lines_immutable
  BEFORE UPDATE OR DELETE ON voucher_lines
  FOR EACH ROW EXECUTE FUNCTION voucher_block_mutation();

-- RLS
ALTER TABLE voucher_series ENABLE ROW LEVEL SECURITY;
ALTER TABLE voucher_series FORCE ROW LEVEL SECURITY;
ALTER TABLE vouchers ENABLE ROW LEVEL SECURITY;
ALTER TABLE vouchers FORCE ROW LEVEL SECURITY;
ALTER TABLE voucher_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE voucher_lines FORCE ROW LEVEL SECURITY;

CREATE POLICY voucher_series_all ON voucher_series FOR ALL
  USING (app_has_company_access(company_id))
  WITH CHECK (app_has_company_access(company_id));

CREATE POLICY vouchers_select ON vouchers FOR SELECT
  USING (app_has_company_access(company_id));
CREATE POLICY vouchers_insert ON vouchers FOR INSERT
  WITH CHECK (app_has_company_access(company_id));

CREATE POLICY voucher_lines_select ON voucher_lines FOR SELECT
  USING (app_has_company_access(company_id));
CREATE POLICY voucher_lines_insert ON voucher_lines FOR INSERT
  WITH CHECK (app_has_company_access(company_id));

-- Inga UPDATE/DELETE-grants på vouchers/voucher_lines (oföränderlighet i grants
-- OCH i trigger). voucher_series behöver UPDATE för räknaren.
GRANT SELECT, INSERT, UPDATE ON voucher_series TO app;
GRANT SELECT, INSERT ON vouchers TO app;
GRANT SELECT, INSERT ON voucher_lines TO app;

-- Generiska dokumentnummerserier (t.ex. fakturanummer) — gap-fri räknare per
-- bolag och typ, samma mekanism som verifikationsnumren.
CREATE TABLE number_sequences (
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  kind       text NOT NULL,
  next_value integer NOT NULL DEFAULT 1 CHECK (next_value >= 1),
  PRIMARY KEY (company_id, kind)
);

ALTER TABLE number_sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE number_sequences FORCE ROW LEVEL SECURITY;
CREATE POLICY number_sequences_all ON number_sequences FOR ALL
  USING (app_has_company_access(company_id))
  WITH CHECK (app_has_company_access(company_id));
GRANT SELECT, INSERT, UPDATE ON number_sequences TO app;
