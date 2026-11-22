-- Uppdragsytan Story 2.4 (FR-27, FR-13): avtalets parter får sin form och sin
-- källa.
--
-- Mottagarparten och godkännaren är samma uppgift (FR-27): den står i
-- `contracts.godkannare`, med eskaleringen i `godkannare_eskalering`, och
-- transmittalen läser mottagaren därifrån först vid överlämningen (FR-13). Det
-- som saknades var HUR ett godkännande ges (NVR-001: per telefon eller mejl från
-- Eva, loggat med datum och kanal) och VARIFRÅN parterna kom — kontraktstexten
-- eller projektets manifest. Utan källan går det inte att skilja en uppgift ur
-- kontraktet från en som någon skrivit in.
--
-- Filen gör tre saker, i den här ordningen:
--   1. kolumnerna `godkannandeform` och `godkannare_kalla` på `contracts`;
--   2. kommentarerna: de fyra partskolumnerna är BASELINE;
--   3. avslutstriggern för de fyra kolumnerna, med en egen funktion: ett
--      avslutat uppdrag tar inte emot parterna (FR-8).
--
-- Inga befintliga rader ändras. Kolumnerna är nullbara utan standardvärde, så
-- befintliga avtal får NULL, och vyn säger då att källan saknas — ingen källa
-- efterfylls. 0095:s funktion och trigger rörs inte, och rättigheterna på
-- `contracts` är redan SELECT, INSERT och UPDATE för `app` (0064). Filen tål att
-- köras igen.

-- ---------------------------------------------------------------------------
-- 1) Kolumnerna (ADR-0: en utvidgning av baselinen)
-- ---------------------------------------------------------------------------
-- ALTER TABLE … ADD COLUMN utlöser inga radtriggrar och ändrar ingen rad.
ALTER TABLE contracts
  ADD COLUMN IF NOT EXISTS godkannandeform text,
  ADD COLUMN IF NOT EXISTS godkannare_kalla text;

-- ---------------------------------------------------------------------------
-- 2) Kommentarerna. Kategorin står först: ägandeprovet läser första ledet.
-- ---------------------------------------------------------------------------
COMMENT ON COLUMN contracts.godkannare IS
  'BASELINE: avtalets mottagarpart och godkännare (FR-13, FR-27) — ur kontraktstexten eller projektets manifest. Transmittalens mottagare läses härifrån vid överlämningen. NULL = mottagarparten saknas.';
COMMENT ON COLUMN contracts.godkannare_eskalering IS
  'BASELINE: vem som har sista ordet när mottagarparten är oenig. Samma källa som godkannare.';
COMMENT ON COLUMN contracts.godkannandeform IS
  'BASELINE: hur ett godkännande ges, ur projektets manifest. Kontraktstexten har inget fält för den. NULL = formen saknas.';
COMMENT ON COLUMN contracts.godkannare_kalla IS
  'BASELINE: källan för godkannare, godkannare_eskalering och godkannandeform — manifestets källa eller leveranskontraktet. NULL = källan saknas.';

-- ---------------------------------------------------------------------------
-- 3) Ett avslutat uppdrag tar inte emot parterna
-- ---------------------------------------------------------------------------
-- De fyra kolumnerna är BASELINE, och på ett avslutat uppdrag avvisas
-- skrivförsök mot baselinen (FR-8). Samma form som 0095:s
-- `contracts_rytm_vagrar_avslutat`, men en egen funktion med ett eget
-- meddelande, så att felet säger vilken del av avtalet som vägrades. Triggern
-- lyssnar bara på de fyra kolumnerna (`UPDATE OF`): avtalets övriga kolumner
-- skrivs som förut, också på ett avslutat uppdrag.
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
