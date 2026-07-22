-- Tillägg 2 (T2.3 + T2.4): persisterade K10-beräkningar per inkomstår + ägar-
-- uppgifter i bolagsinställningarna.
--
-- k10_computations: en sparad beräkning per bolag och inkomstår, så "sparat
-- utdelningsutrymme f.å." autofylls ur föregående års beräkning i stället för
-- manuell inmatning. source='manual_opening' är engångsinmatningen av historiskt
-- sparat utrymme per 2025-12-31 (från senast lämnade K10) — beräknat enligt
-- gamla regler, förs över nominellt (ingen uppräkning fr.o.m. 2026).
--
-- companies: ägarandel (inget ägarregister finns — fältet ligger i bolags-
-- inställningarna per T2.4) och aktiekapital (default 25 000 kr) som default
-- för K10:ns omkostnadsbelopp.

CREATE TABLE k10_computations (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id             uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  income_year            int NOT NULL CHECK (income_year BETWEEN 2000 AND 2100),
  source                 text NOT NULL DEFAULT 'computed' CHECK (source IN ('computed', 'manual_opening')),
  input                  jsonb NOT NULL,
  result                 jsonb NOT NULL,
  saved_to_next_year_ore bigint NOT NULL CHECK (saved_to_next_year_ore >= 0),
  created_by             uuid REFERENCES users(id),
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT k10_computations_year_uk UNIQUE (company_id, income_year)
);
CREATE TRIGGER k10_computations_set_updated_at BEFORE UPDATE ON k10_computations FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE k10_computations ENABLE ROW LEVEL SECURITY;
ALTER TABLE k10_computations FORCE ROW LEVEL SECURITY;
CREATE POLICY k10_computations_select ON k10_computations FOR SELECT USING (app_has_company_access(company_id));
CREATE POLICY k10_computations_insert ON k10_computations FOR INSERT WITH CHECK (app_has_company_access(company_id));
CREATE POLICY k10_computations_update ON k10_computations FOR UPDATE USING (app_has_company_access(company_id)) WITH CHECK (app_has_company_access(company_id));
GRANT SELECT, INSERT, UPDATE ON k10_computations TO app;

ALTER TABLE companies
  ADD COLUMN owner_share_permille smallint NOT NULL DEFAULT 1000
    CHECK (owner_share_permille BETWEEN 1 AND 1000),
  ADD COLUMN share_capital_ore bigint NOT NULL DEFAULT 2500000
    CHECK (share_capital_ore >= 0);

-- Standardkonton som utdelnings-/EK-flödet behöver: utdelningsbeslut bokförs
-- 2091 D / 2898 K (autofyllet läser 2898-krediter), och fritt eget kapital
-- summeras 2091–2099 (2097/2098 kompletterar intervallet).
INSERT INTO accounts (account_number, name, account_type) VALUES
  (2097, 'Fri överkursfond', 'equity'),
  (2098, 'Vinst eller förlust från föregående år', 'equity'),
  (2898, 'Outtagen vinstutdelning', 'liability');
