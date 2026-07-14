-- Fas C1: anläggningsregister + avskrivningar. Varje anläggningstillgång har ett
-- anskaffningsvärde, nyttjandeperiod och planenlig (linjär) avskrivning. Bokförd
-- avskrivning skapar ett verifikat (debet avskrivningskostnad / kredit ack.
-- avskrivningar) och registreras per period så samma period inte bokförs två gånger.
-- Belopp i heltal ören.

CREATE TABLE fixed_assets (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name                      text NOT NULL,
  acquisition_date          date NOT NULL,
  acquisition_cost_ore      bigint NOT NULL CHECK (acquisition_cost_ore >= 0),
  residual_value_ore        bigint NOT NULL DEFAULT 0 CHECK (residual_value_ore >= 0),
  useful_life_months        integer NOT NULL CHECK (useful_life_months > 0 AND useful_life_months <= 1200),
  method                    text NOT NULL DEFAULT 'linear' CHECK (method IN ('linear')),
  asset_account             integer NOT NULL DEFAULT 1220,  -- anskaffning (t.ex. 1220 inventarier)
  accumulated_depr_account  integer NOT NULL DEFAULT 1229,  -- ack. avskrivningar (t.ex. 1229)
  depreciation_expense_account integer NOT NULL DEFAULT 7830, -- avskrivningskostnad (t.ex. 7830)
  depreciated_through       date,                          -- t.o.m. vilket datum avskrivning bokförts
  status                    text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disposed')),
  disposal_date             date,
  disposal_voucher_id       uuid REFERENCES vouchers(id),
  notes                     text,
  created_by                uuid REFERENCES users(id),
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT residual_not_above_cost CHECK (residual_value_ore <= acquisition_cost_ore)
);
CREATE INDEX fixed_assets_company_idx ON fixed_assets (company_id, status);

CREATE TABLE fixed_asset_depreciations (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  fixed_asset_id uuid NOT NULL REFERENCES fixed_assets(id) ON DELETE CASCADE,
  period_end     date NOT NULL,
  amount_ore     bigint NOT NULL CHECK (amount_ore >= 0),
  voucher_id     uuid REFERENCES vouchers(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fixed_asset_depr_uk UNIQUE (fixed_asset_id, period_end)
);
CREATE INDEX fixed_asset_depr_asset_idx ON fixed_asset_depreciations (company_id, fixed_asset_id);

CREATE TRIGGER fixed_assets_set_updated_at BEFORE UPDATE ON fixed_assets FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE fixed_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE fixed_assets FORCE ROW LEVEL SECURITY;
CREATE POLICY fixed_assets_select ON fixed_assets FOR SELECT USING (app_has_company_access(company_id));
CREATE POLICY fixed_assets_insert ON fixed_assets FOR INSERT WITH CHECK (app_has_company_access(company_id));
CREATE POLICY fixed_assets_update ON fixed_assets FOR UPDATE USING (app_has_company_access(company_id)) WITH CHECK (app_has_company_access(company_id));
GRANT SELECT, INSERT, UPDATE ON fixed_assets TO app;

ALTER TABLE fixed_asset_depreciations ENABLE ROW LEVEL SECURITY;
ALTER TABLE fixed_asset_depreciations FORCE ROW LEVEL SECURITY;
CREATE POLICY fixed_asset_depr_select ON fixed_asset_depreciations FOR SELECT USING (app_has_company_access(company_id));
CREATE POLICY fixed_asset_depr_insert ON fixed_asset_depreciations FOR INSERT WITH CHECK (app_has_company_access(company_id));
GRANT SELECT, INSERT ON fixed_asset_depreciations TO app;
