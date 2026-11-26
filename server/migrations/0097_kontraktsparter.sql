-- Story 2.4 (FR-13/FR-27): mottagarpart, godkännare och godkännandeform hör till
-- baselinen, aldrig till en transmittal före överlämningen.
-- 1. Två nullbara textkolumner, 2. BASELINE-kommentarer, 3. egen avslutsspärr.
-- Inga befintliga rader ändras. Inga värden eller källor efterfylls.
-- Filen tål att köras igen; 0095:s rytmtrigger står kvar oförändrad.
ALTER TABLE contracts
  ADD COLUMN IF NOT EXISTS godkannandeform text,
  ADD COLUMN IF NOT EXISTS godkannare_kalla text;

COMMENT ON COLUMN contracts.godkannare IS
  'BASELINE: avtalets mottagarpart och godkännare (FR-13, FR-27). NULL = inte angiven.';
COMMENT ON COLUMN contracts.godkannare_eskalering IS
  'BASELINE: eskaleringen för avtalets mottagarpart och godkännare.';
COMMENT ON COLUMN contracts.godkannandeform IS
  'BASELINE: formen för godkännandet, ur manifestet för projektet. NULL = inte angiven.';
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
