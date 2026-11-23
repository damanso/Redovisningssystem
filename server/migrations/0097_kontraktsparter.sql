-- Uppdragsytan Story 2.4 (FR-13, FR-27, FR-8): avtalets parter får sin
-- godkännandeform och sin källa i baselinen.
--
-- Mottagarparten och godkännaren är samma uppgift (beslut B1): `godkannare`
-- och `godkannare_eskalering` (0068) bär dem, och transmittalens mottagare
-- läses därifrån (`saknad_mottagare`). Två saker saknade en plats: HUR ett
-- godkännande ska ges (”per telefon eller mejl från Eva räcker”) och VARIFRÅN
-- parterna kom — manifestet för projektet eller kontraktstexten. Utan källan går
-- en uppgift som ser ifylld ut inte att skilja från en gissning.
--
-- Filen gör tre saker, i den här ordningen:
--   1. kolumnerna `contracts.godkannandeform` och `contracts.godkannare_kalla`,
--      nullbara och utan standardvärde;
--   2. kommentarerna på de fyra partskolumnerna, alla kategori BASELINE;
--   3. avslutstriggern för de fyra kolumnerna med en egen funktion: ett
--      avslutat uppdrag tar inte emot parterna (FR-8).
--
-- Inga befintliga rader ändras. Befintliga avtal får NULL i båda kolumnerna, och
-- ingen källa efterfylls: en källa som ingen läst är en gissning. 0095:s
-- funktion och trigger rörs inte, rättigheterna på `contracts` (0064) och RLS
-- ändras inte. Filen tål att köras igen.

-- ---------------------------------------------------------------------------
-- 1) Kolumnerna
-- ---------------------------------------------------------------------------
ALTER TABLE contracts
  ADD COLUMN IF NOT EXISTS godkannandeform text,
  ADD COLUMN IF NOT EXISTS godkannare_kalla text;

-- ---------------------------------------------------------------------------
-- 2) Kommentarerna
-- ---------------------------------------------------------------------------
COMMENT ON COLUMN contracts.godkannare IS
  'BASELINE: avtalets mottagarpart och godkännare (FR-13, FR-27) — vem som tar emot en leverabel och godkänner den. Ur manifestet för projektet eller kontraktstexten, skrivs av Davids ja på baselineförslaget. NULL = mottagarparten saknas.';
COMMENT ON COLUMN contracts.godkannare_eskalering IS
  'BASELINE: vem som har sista ordet när godkännarna är oense. Samma källa som godkannare, och aldrig blandad med en annan källas värde.';
COMMENT ON COLUMN contracts.godkannandeform IS
  'BASELINE: hur ett godkännande ges och loggas, ur manifestet för projektet. NULL = formen saknas; kontraktstexten har inget fält för den.';
COMMENT ON COLUMN contracts.godkannare_kalla IS
  'BASELINE: varifrån parterna kom — manifestets källa eller leveranskontraktet. NULL = källan saknas; den efterfylls aldrig.';

-- ---------------------------------------------------------------------------
-- 3) Ett avslutat uppdrag tar inte emot parterna
-- ---------------------------------------------------------------------------
-- Samma form som `contracts_rytm_vagrar_avslutat()` i 0095, med ett eget
-- meddelande och en egen trigger, så att 0095:s lista över kolumner står kvar
-- orörd. Triggern lyssnar bara på de fyra kolumnerna (`UPDATE OF`): avtalets
-- övriga kolumner skrivs som förut, också på ett avslutat uppdrag. Importens
-- godkännande prövar inte statusen själv; triggern är spärren för varje väg in.
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
