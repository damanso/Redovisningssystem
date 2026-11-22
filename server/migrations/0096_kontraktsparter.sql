-- Uppdragsytan Story 2.4 (FR-13, FR-27, FR-8): avtalets parter får sin form och
-- sin källa i baselinen.
--
-- Mottagarparten och godkännaren är samma uppgift (FR-27) och lagras redan i
-- `contracts.godkannare` med eskaleringen i `godkannare_eskalering` (0068). Två
-- saker saknades: HUR godkännandet får lämnas (godkännandeformen ur projektets
-- manifest, FR-13) och VARIFRÅN parterna kommer. Ett värde utan källa går inte
-- att skilja från en gissning.
--
-- Filen gör tre saker, i den här ordningen:
--   1. kolumnerna `godkannandeform` och `godkannare_kalla` på `contracts`,
--      nullbara och utan standard;
--   2. kommentarerna på de fyra partskolumnerna, alla med kategorin BASELINE;
--   3. avslutstriggern för de fyra kolumnerna med en egen funktion: ett
--      avslutat uppdrag tar inte emot avtalets parter (FR-8).
--
-- Inga befintliga rader ändras. Befintliga avtal får NULL i de två nya
-- kolumnerna, och vyn skriver då ”källa saknas” — ingen källa efterfylls.
-- 0095:s funktion `contracts_rytm_vagrar_avslutat` och dess trigger rörs inte.
-- Rättigheterna på `contracts` (SELECT, INSERT, UPDATE för `app`, 0064) och RLS
-- ändras inte. Filen tål att köras igen.

-- ---------------------------------------------------------------------------
-- 1) Kolumnerna (ADR-0: en utvidgning av baselinen)
-- ---------------------------------------------------------------------------
-- ALTER TABLE … ADD COLUMN utlöser inga radtriggrar och ändrar ingen rad.
ALTER TABLE contracts
  ADD COLUMN IF NOT EXISTS godkannandeform text,
  ADD COLUMN IF NOT EXISTS godkannare_kalla text;

-- ---------------------------------------------------------------------------
-- 2) Kommentarerna
-- ---------------------------------------------------------------------------
COMMENT ON COLUMN contracts.godkannare IS
  'BASELINE: avtalets mottagarpart och godkännare — samma uppgift (FR-13, FR-27). Läses ur kontraktets fält Godkännare eller Mottagarpart, eller ur projektets manifest. NULL = saknas.';
COMMENT ON COLUMN contracts.godkannare_eskalering IS
  'BASELINE: vem som har sista ordet när godkännaren inte är enig, ur samma källa som godkännaren.';
COMMENT ON COLUMN contracts.godkannandeform IS
  'BASELINE: hur ett godkännande får lämnas, ordagrant ur projektets manifest (FR-13). NULL = formen är inte angiven.';
COMMENT ON COLUMN contracts.godkannare_kalla IS
  'BASELINE: källan till de tre partsfälten — manifestets källa eller leveranskontraktet. NULL = källa saknas.';

-- ---------------------------------------------------------------------------
-- 3) Ett avslutat uppdrag tar inte emot avtalets parter
-- ---------------------------------------------------------------------------
-- Samma form som 0095: en egen funktion, eftersom 0068:s läser `rad.contract_id`
-- som `contracts` inte har, och triggern lyssnar bara på de fyra kolumnerna
-- (`UPDATE OF`). Avtalets övriga kolumner skrivs som förut, också på ett
-- avslutat uppdrag. Tjänsterna prövar statusen först; triggern är spärren bakom
-- dem, för varje väg in.
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
