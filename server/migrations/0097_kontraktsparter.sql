-- Uppdragsytan Story 2.4 (FR-13, FR-27, B-14): avtalets parter får sin form
-- och sin källa i baselinen.
--
-- Mottagarparten och godkännaren är samma uppgift (FR-27: Davids svar 2 är
-- också godkännaren), och den bor redan i `contracts.godkannare` med
-- eskaleringen i `godkannare_eskalering` (0068). Två saker saknades: formen för
-- ett godkännande (NVR-001: per telefon eller mejl från Eva, loggat med datum
-- och kanal) och var uppgifterna kom ifrån. Utan källan går ett namn ur
-- projektets manifest inte att skilja från ett namn ur kontraktstexten — eller
-- från ett som någon skrev in för hand.
--
-- Filen gör tre saker, i den här ordningen:
--   1. kolumnerna `godkannandeform` och `godkannare_kalla` på `contracts`,
--      nullbara, utan villkor och utan standard;
--   2. kommentarerna på de fyra partskolumnerna, kategori BASELINE;
--   3. avslutstriggern för de fyra kolumnerna, med en egen funktion: ett
--      avslutat uppdrag tar inte emot nya parter (FR-8).
--
-- Inga befintliga rader ändras. Befintliga avtal får NULL i de nya kolumnerna,
-- och vyn säger då ”källa saknas” — ingen källa efterfylls. 0095:s funktion och
-- trigger rörs inte. Rättigheterna på `contracts` (SELECT, INSERT och UPDATE
-- för `app`, 0064) och RLS ändras inte. Filen tål att köras igen.

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
-- Kategorin står först, som på rytmens kolumner i 0095.
COMMENT ON COLUMN contracts.godkannare IS
  'BASELINE: avtalets mottagarpart och godkännare (FR-13, FR-27) — transmittalens mottagare läses härifrån. NULL = mottagarparten saknas.';
COMMENT ON COLUMN contracts.godkannare_eskalering IS
  'BASELINE: vem som har sista ordet när godkännaren inte är enig. Samma källa som godkännaren.';
COMMENT ON COLUMN contracts.godkannandeform IS
  'BASELINE: hur ett godkännande av en leverabel lämnas och loggas, ur projektets manifest. NULL = formen saknas.';
COMMENT ON COLUMN contracts.godkannare_kalla IS
  'BASELINE: källan för godkännaren, eskaleringen och godkännandeformen — manifestets källa eller leveranskontraktet. NULL = källa saknas.';

-- ---------------------------------------------------------------------------
-- 3) Ett avslutat uppdrag tar inte emot nya parter
-- ---------------------------------------------------------------------------
-- De fyra kolumnerna är BASELINE, och på ett avslutat uppdrag avvisas
-- skrivförsök mot baselinen (FR-8). Samma form som 0095: en egen funktion med
-- ett eget meddelande, och triggern lyssnar bara på de fyra kolumnerna
-- (`UPDATE OF`), så att avtalets övriga kolumner skrivs som förut.
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
