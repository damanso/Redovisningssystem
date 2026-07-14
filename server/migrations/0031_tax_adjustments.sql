-- Fas C4: skattemässiga justeringar (INK2S). Utöver de justeringar som kan HÄRLEDAS
-- ur bokföringen (bokfört resultat, återläggning av bokförd skatt, underskottsavdrag)
-- finns poster som bara företaget/revisorn kan bedöma: ej avdragsgilla kostnader
-- (t.ex. ej avdragsgill representation, förseningsavgifter) och ej skattepliktiga
-- intäkter (t.ex. skattefri utdelning). De registreras manuellt per räkenskapsår och
-- läggs till INK2S-beräkningen. Belopp i heltal ören (> 0). INGET bokförs — detta är
-- rent deklarationsunderlag.

CREATE TABLE tax_adjustments (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  fiscal_year_id uuid NOT NULL REFERENCES fiscal_years(id) ON DELETE CASCADE,
  -- non_deductible = bokförd kostnad som INTE ska dras av (ökar överskottet)
  -- non_taxable    = bokförd intäkt som INTE ska tas upp (minskar överskottet)
  kind           text NOT NULL CHECK (kind IN ('non_deductible', 'non_taxable')),
  label          text NOT NULL,
  amount_ore     bigint NOT NULL CHECK (amount_ore > 0),
  created_by     uuid REFERENCES users(id),
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tax_adjustments_fy_idx ON tax_adjustments (company_id, fiscal_year_id);

ALTER TABLE tax_adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE tax_adjustments FORCE ROW LEVEL SECURITY;
CREATE POLICY tax_adjustments_select ON tax_adjustments FOR SELECT USING (app_has_company_access(company_id));
CREATE POLICY tax_adjustments_insert ON tax_adjustments FOR INSERT WITH CHECK (app_has_company_access(company_id));
CREATE POLICY tax_adjustments_delete ON tax_adjustments FOR DELETE USING (app_has_company_access(company_id));
GRANT SELECT, INSERT, DELETE ON tax_adjustments TO app;
