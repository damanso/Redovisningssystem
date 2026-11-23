-- Uppdragsytan Story 2.4 (FR-13, FR-27, B-14): avtalets parter får sin källa och
-- sin godkännandeform.
--
-- Mottagarparten och godkännaren är samma uppgift (FR-27): den lagras i
-- `contracts.godkannare` med eskaleringen i `godkannare_eskalering` (0068), och
-- transmittalen läser sin mottagare därifrån. Två saker saknades: HUR ett
-- godkännande får ges (NVR-001: per telefon eller mejl från Eva, loggat med
-- datum och kanal) och VARIFRÅN parterna kom — kontraktstexten eller projektets
-- manifest. Utan källan går en godkännare inte att skilja från en gissning.
--
-- Filen gör tre saker, i den här ordningen:
--   1. kolumnerna `godkannandeform` och `godkannare_kalla` på `contracts`,
--      nullbara och utan standard;
--   2. kommentarerna: de fyra partskolumnerna är BASELINE;
--   3. avslutstriggern för de fyra kolumnerna, med en egen funktion: ett
--      avslutat uppdrag tar inga parter (FR-8).
--
-- Inga befintliga rader ändras. Befintliga avtal får NULL i de nya kolumnerna,
-- och ingen källa efterfylls: en källa som ingen läst är ingen källa.
-- Rättigheterna på `contracts` (0064) och RLS rörs inte, och inte heller 0095:s
-- funktion och trigger för rytmen. Filen tål att köras igen.

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
  'BASELINE: avtalets mottagarpart och godkännare (FR-13, FR-27), ur kontraktets fält Godkännare eller Mottagarpart eller ur projektets manifest. NULL = saknas, eller kontraktet är inte inläst.';
COMMENT ON COLUMN contracts.godkannare_eskalering IS
  'BASELINE: vem som har sista ordet när godkännaren inte är enig, från samma källa som godkannare.';
COMMENT ON COLUMN contracts.godkannandeform IS
  'BASELINE: hur ett godkännande får ges, ur projektets manifest. Kontraktstexten har inget fält för den. NULL = saknas.';
COMMENT ON COLUMN contracts.godkannare_kalla IS
  'BASELINE: källan för godkannare, godkannare_eskalering och godkannandeform: manifestets källa eller leveranskontraktet. En källa per avtal. NULL = ingen källa är läst.';

-- ---------------------------------------------------------------------------
-- 3) Ett avslutat uppdrag tar inga parter
-- ---------------------------------------------------------------------------
-- Partskolumnerna är BASELINE, och på ett avslutat uppdrag avvisas skrivförsök
-- mot baselinen (FR-8). Samma form som 0095: en egen funktion, eftersom 0068:s
-- läser `rad.contract_id`, som `contracts` inte har, och triggern lyssnar bara
-- på de fyra kolumnerna (`UPDATE OF`), så att avtalets övriga kolumner skrivs
-- som förut. Godkännandet prövar inte statusen själv; triggern är spärren för
-- varje väg in.
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
