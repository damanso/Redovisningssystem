-- Story 2.4 (FR-13, FR-27): avtalets parter får källa och godkännandeform.
-- 1. Två nullbara textkolumner; 2. BASELINE-kommentarer; 3. avslutsspärr.
-- Inga befintliga rader ändras och ingen källa efterfylls. Filen tål omkörning.
ALTER TABLE contracts
  ADD COLUMN IF NOT EXISTS godkannandeform text,
  ADD COLUMN IF NOT EXISTS godkannare_kalla text;

COMMENT ON COLUMN contracts.godkannare IS
  'BASELINE: avtalets mottagarpart och godkännare (FR-13, FR-27). NULL = ingen angiven.';
COMMENT ON COLUMN contracts.godkannare_eskalering IS
  'BASELINE: avtalets eskalering för godkännandet. NULL = ingen angiven.';
COMMENT ON COLUMN contracts.godkannandeform IS
  'BASELINE: godkännandeformen ur projektets manifest. NULL = ingen angiven.';
COMMENT ON COLUMN contracts.godkannare_kalla IS
  'BASELINE: gemensam källa för godkännare, eskalering och godkännandeform. NULL = källa saknas.';

CREATE OR REPLACE FUNCTION contracts_parter_vagrar_avslutat() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM projects p
     WHERE p.id = NEW.project_id AND p.company_id = NEW.company_id AND p.status = 'closed'
  ) THEN
    RAISE EXCEPTION 'uppdraget är avslutat — avtalets parter på % går inte att skriva', TG_TABLE_NAME;
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS contracts_parter_vagrar_avslutat ON contracts;
CREATE TRIGGER contracts_parter_vagrar_avslutat
  BEFORE UPDATE OF godkannare, godkannare_eskalering, godkannandeform, godkannare_kalla ON contracts
  FOR EACH ROW EXECUTE FUNCTION contracts_parter_vagrar_avslutat();
