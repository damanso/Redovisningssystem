-- Uppdragsytan Story 2.4 (FR-13, FR-27, FR-8): avtalets parter får sin källa och
-- godkännandets form.
--
-- Mottagarparten och godkännaren är samma uppgift (FR-27: Davids svar 2 ”är
-- också godkännaren”), och den står redan i `contracts.godkannare` med
-- eskaleringen i `godkannare_eskalering`. Det som saknades var två saker: formen
-- för ett godkännande (”per telefon eller mejl från Eva räcker och loggas med
-- datum och kanal”) och varifrån parterna kom. Utan källan går ett värde ur
-- projektets manifest inte att skilja från ett ur kontraktstexten — eller från
-- ett som någon skrivit in för hand.
--
-- Filen gör tre saker, i den här ordningen:
--   1. kolumnerna `godkannandeform` och `godkannare_kalla` på `contracts`;
--   2. kommentarerna på de fyra partskolumnerna, alla med kategorin BASELINE,
--      och på ankarets två kolumner, som nu har två skrivvägar (Story 2.4):
--      kommentaren ur 0095 nämnde bara `satt_bedomningsankare`;
--   3. avslutstriggern för de fyra kolumnerna, med en egen funktion: ett
--      avslutat uppdrag tar inte emot nya parter (FR-8).
--
-- Inga befintliga rader ändras. Kolumnerna är nullbara utan standard, och
-- befintliga avtal får NULL — en källa efterfylls aldrig. 0095:s funktion och
-- trigger rörs inte. Rättigheterna på `contracts` (SELECT, INSERT, UPDATE för
-- `app`, 0064) och RLS ändras inte. Filen tål att köras igen.

-- ---------------------------------------------------------------------------
-- 1) Kolumnerna (ADR-0: en utvidgning av baselinen)
-- ---------------------------------------------------------------------------
-- ALTER TABLE … ADD COLUMN utlöser inga radtriggrar och ändrar ingen rad.
ALTER TABLE contracts
  ADD COLUMN IF NOT EXISTS godkannandeform text,
  ADD COLUMN IF NOT EXISTS godkannare_kalla text;

-- ---------------------------------------------------------------------------
-- 2) Kommentarerna — kategorin står först
-- ---------------------------------------------------------------------------
COMMENT ON COLUMN contracts.godkannare IS
  'BASELINE: avtalets mottagarpart och godkännare (FR-13, FR-27) — ur kontraktets fält Godkännare eller Mottagarpart, eller ur projektets manifest. NULL = mottagarparten saknas.';
COMMENT ON COLUMN contracts.godkannare_eskalering IS
  'BASELINE: vem som har sista ordet när godkännaren inte är enig, ur samma källa som godkannare.';
COMMENT ON COLUMN contracts.godkannandeform IS
  'BASELINE: hur ett godkännande ges och loggas, ur projektets manifest. NULL = formen saknas; kontraktstexten har inget fält för den.';
COMMENT ON COLUMN contracts.godkannare_kalla IS
  'BASELINE: källan för godkannare, godkannare_eskalering och godkannandeform — manifestets namn eller leveranskontraktet. NULL = källa saknas.';
-- Ankaret (0095) har sedan Story 2.4 två skrivvägar, båda Davids egna. Kommentaren
-- säger båda, så att katalogen inte påstår en regel som koden bryter.
COMMENT ON COLUMN contracts.bedomning_ankare IS
  'BASELINE: det första bedömningstillfället. Sätts av David: med satt_bedomningsankare (en gång, när inget ankare är satt) eller genom hans ja på satt_baseline när manifestets ankare står i läget lagras eller andras. Ändras bara genom en baselineändring. NULL = datum saknas.';
COMMENT ON COLUMN contracts.bedomning_ankare_kalla IS
  'BASELINE: ankarets källa — Davids uppgift eller en kalenderreferens (satt_bedomningsankare), eller manifestets egen källtext (satt_baseline). Satt om och endast om ankaret är satt.';

-- ---------------------------------------------------------------------------
-- 3) Ett avslutat uppdrag tar inte emot nya parter
-- ---------------------------------------------------------------------------
-- Samma form som `contracts_rytm_vagrar_avslutat()` i 0095, med ett eget
-- meddelande. Triggern lyssnar bara på de fyra partskolumnerna (`UPDATE OF`):
-- avtalets övriga kolumner skrivs som förut, också på ett avslutat uppdrag.
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
