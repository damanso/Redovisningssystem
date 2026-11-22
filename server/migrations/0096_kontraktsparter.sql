-- Uppdragsytan Story 2.4 (FR-13, FR-27, B-14): avtalets parter får sin form
-- och sin källa i baselinen.
--
-- Mottagarparten och godkännaren är samma uppgift (FR-27, Davids svar 2):
-- `contracts.godkannare` bär den, och `godkann_leverabel` läser transmittalens
-- mottagare därifrån. Två saker saknade plats: HUR ett godkännande får lämnas
-- (godkännandeformen ur projektets manifest, svar 9) och VARIFRÅN parterna kom
-- (manifestet eller leveranskontraktets text). Utan källan går ett förifyllt
-- värde inte att skilja från ett gissat.
--
-- Filen gör tre saker, i den här ordningen:
--   1. kolumnerna `godkannandeform` och `godkannare_kalla` på `contracts`,
--      nullbara och utan standardvärde;
--   2. kommentarerna: de fyra partskolumnerna är BASELINE;
--   3. avslutstriggern för de fyra kolumnerna, med en egen funktion: ett
--      avslutat uppdrag tar inte avtalets parter (FR-8).
--
-- Inga befintliga rader ändras. Befintliga avtal får NULL i de nya kolumnerna,
-- och vyn skriver då att källan saknas — ingen källa efterfylls. Rättigheterna
-- på `contracts` (SELECT, INSERT, UPDATE för `app`, 0064) och RLS rörs inte,
-- och 0095:s funktion och trigger rörs inte. Filen tål att köras igen.

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
  'BASELINE: avtalets mottagarpart och godkännare (FR-13, FR-27) — vem som godkänner en leverabel och tar emot transmittalen. Skrivs av importens godkännande ur manifestet eller kontraktstexten. NULL = mottagarparten saknas.';
COMMENT ON COLUMN contracts.godkannare_eskalering IS
  'BASELINE: vem som har sista ordet när godkännaren inte är enig, ur samma källa som godkannare.';
COMMENT ON COLUMN contracts.godkannandeform IS
  'BASELINE: hur ett godkännande får lämnas, ur projektets manifest (FR-13). NULL = formen är inte angiven; kontraktstexten har inget fält för den.';
COMMENT ON COLUMN contracts.godkannare_kalla IS
  'BASELINE: varifrån de tre partsfälten kom — manifestets källa eller leveranskontraktet. NULL = källan saknas, och ingen källa efterfylls.';

-- ---------------------------------------------------------------------------
-- 3) Ett avslutat uppdrag tar inte avtalets parter
-- ---------------------------------------------------------------------------
-- De fyra kolumnerna är BASELINE, och på ett avslutat uppdrag avvisas
-- skrivförsök mot baselinen (FR-8). Samma form som 0095:s
-- `contracts_rytm_vagrar_avslutat`, men en egen funktion med ett eget
-- meddelande, så att 0095 inte ändras. Triggern lyssnar bara på de fyra
-- kolumnerna (`UPDATE OF`): avtalets övriga kolumner skrivs som förut.
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
