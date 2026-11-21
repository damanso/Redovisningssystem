-- Uppdragsytan Story 2.3 (FR-19, FR-14, B-14): kontraktets del 3 och del 4 får
-- sin plats i baselinen.
--
-- Del 3 säger vad som mäts, hur ofta, var siffran läses och när det larmar. Del
-- 4 säger vem som får rapporten och i vilken rytm. Ingen av dem hade en plats:
-- parsern läste dem inte, och Bedömning föreslog kalendermånaden — en husrytm
-- som avtalet aldrig lovat.
--
-- Filen gör fyra saker, i den här ordningen:
--   1. tabellen `uppdrag_matt` (kategori BASELINE) med sammansatt FK, unik nyckel
--      per avtal och namn och tre namngivna CHECK-villkor;
--   2. kommentaren, RLS och rättigheterna: `app` har SELECT + INSERT, eftersom
--      importen bara lägger till rader (ON CONFLICT DO NOTHING);
--   3. avslutstriggern med 0068:s oförändrade funktion;
--   4. rytmkolumnerna på `contracts`, med namngivna villkor och kommentarer.
--
-- Värdena i villkoren är exakt `MATTLASVAGAR` och `MATTLAGEN` i
-- server/src/lib/leveranskontrakt.ts, och provet härleder schemat ur konstanterna.
-- Ingen kolumn bär en beslutspunkts datum eller läge, och ingen bär en andel:
-- ett utfall som inte härleds står som `harleds_ej`, aldrig som ett gissat tal.
--
-- Inga befintliga rader ändras. Kolumnerna på `contracts` är nullbara, och
-- befintliga avtal får NULL, som villkoren tillåter. Rättigheterna på
-- `contracts`, tabellkommentarerna på de befintliga tabellerna och
-- `uppdrag_leverabel.matt_lasvag` rörs inte. Filen tål att köras igen.

-- ---------------------------------------------------------------------------
-- 1) Tabellen
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS uppdrag_matt (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  -- Triggern `vagrar_skrivning_pa_avslutat()` läser `rad.contract_id`.
  contract_id    uuid NOT NULL,
  -- Kontraktets egna ord, trimmade och utan annan omformatering.
  namn           text NOT NULL,
  hur_ofta       text,
  -- Cellen ”Var siffran läses” som den står: en pekare i kontraktets ord, aldrig
  -- en kopia av källan (FR-26).
  kallreferenser text,
  -- NULL = läsvägen saknas i kontraktet. Den gissas aldrig.
  lasvag         text,
  -- Larmregeln ordagrant ur kontraktet.
  larmregel      text,
  larmregel_lage text NOT NULL,
  utfall_lage    text NOT NULL,
  -- Textens ordning, så att Läget visar måtten som kontraktet räknar upp dem.
  ordning        integer NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  -- Sammansatt FK (0064/0068): ett mått hänger aldrig på ett annat bolags avtal.
  CONSTRAINT uppdrag_matt_contract_fk FOREIGN KEY (contract_id, company_id)
    REFERENCES contracts (id, company_id),
  -- Idempotensen i importen: samma mått skrivs en gång per avtal.
  CONSTRAINT uppdrag_matt_namn_uk UNIQUE (contract_id, namn),
  CONSTRAINT uppdrag_matt_lasvag_check
    CHECK (lasvag IS NULL OR lasvag IN ('redovisning', 'arenden', 'register', 'kalender', 'referens')),
  CONSTRAINT uppdrag_matt_larmregel_lage_check
    CHECK (larmregel_lage IN ('harleds', 'harleds_ej')),
  CONSTRAINT uppdrag_matt_utfall_lage_check
    CHECK (utfall_lage IN ('harleds', 'harleds_ej'))
);

-- ---------------------------------------------------------------------------
-- 2) Kommentaren, RLS och rättigheterna (husmönstret, 0082)
-- ---------------------------------------------------------------------------
-- Kategorin står först: ägandeprovet och Hermes agandegrans läser första ledet.
COMMENT ON TABLE uppdrag_matt IS 'Kategori: BASELINE. Avtalets uppföljningsmått ur kontraktets del 3 — läses ur avtalet, uppfinns aldrig här. Läsvägen NULL betyder saknad i kontraktet.';

ALTER TABLE uppdrag_matt ENABLE ROW LEVEL SECURITY;
ALTER TABLE uppdrag_matt FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS uppdrag_matt_select ON uppdrag_matt;
CREATE POLICY uppdrag_matt_select ON uppdrag_matt FOR SELECT
  USING (app_has_company_access(company_id));

DROP POLICY IF EXISTS uppdrag_matt_insert ON uppdrag_matt;
CREATE POLICY uppdrag_matt_insert ON uppdrag_matt FOR INSERT
  WITH CHECK (app_has_company_access(company_id));

-- Ingen UPDATE och ingen DELETE: importen lägger bara till rader. Den berättelse
-- som behöver ändra ett mått lägger till den rättighet den behöver.
GRANT SELECT, INSERT ON uppdrag_matt TO app;

-- ---------------------------------------------------------------------------
-- 3) Avslutstriggern
-- ---------------------------------------------------------------------------
-- Samma regel som på 0068:s tabeller: ett avslutat uppdrag tar inte emot ett
-- nytt mått. Funktionen ur 0068 ändras inte.
DROP TRIGGER IF EXISTS uppdrag_matt_vagrar_avslutat ON uppdrag_matt;
CREATE TRIGGER uppdrag_matt_vagrar_avslutat
  BEFORE INSERT OR UPDATE OR DELETE ON uppdrag_matt
  FOR EACH ROW EXECUTE FUNCTION vagrar_skrivning_pa_avslutat();

-- ---------------------------------------------------------------------------
-- 4) Rytmen på contracts (ADR-0: en utvidgning av baselinen)
-- ---------------------------------------------------------------------------
-- ALTER TABLE … ADD COLUMN utlöser inga radtriggrar och ändrar ingen rad.
ALTER TABLE contracts
  ADD COLUMN IF NOT EXISTS rytm_text text,
  ADD COLUMN IF NOT EXISTS bedomning_intervall_dagar integer,
  ADD COLUMN IF NOT EXISTS bedomning_veckodag smallint,
  ADD COLUMN IF NOT EXISTS bedomning_ankare date,
  ADD COLUMN IF NOT EXISTS bedomning_ankare_kalla text,
  ADD COLUMN IF NOT EXISTS rapport_mottagarkrets text;

ALTER TABLE contracts DROP CONSTRAINT IF EXISTS contracts_bedomning_intervall_check;
ALTER TABLE contracts ADD CONSTRAINT contracts_bedomning_intervall_check
  CHECK (bedomning_intervall_dagar IS NULL OR bedomning_intervall_dagar BETWEEN 1 AND 366);

-- ISO-veckodagen: måndag = 1, söndag = 7.
ALTER TABLE contracts DROP CONSTRAINT IF EXISTS contracts_bedomning_veckodag_check;
ALTER TABLE contracts ADD CONSTRAINT contracts_bedomning_veckodag_check
  CHECK (bedomning_veckodag IS NULL OR bedomning_veckodag BETWEEN 1 AND 7);

-- En veckodag utan intervall är ingen rytm.
ALTER TABLE contracts DROP CONSTRAINT IF EXISTS contracts_bedomning_veckodag_kraver_intervall;
ALTER TABLE contracts ADD CONSTRAINT contracts_bedomning_veckodag_kraver_intervall
  CHECK (bedomning_veckodag IS NULL OR bedomning_intervall_dagar IS NOT NULL);

-- Ett ankare utan källa är ett gissat datum (FR-14): båda eller ingen.
ALTER TABLE contracts DROP CONSTRAINT IF EXISTS contracts_bedomning_ankare_kalla_check;
ALTER TABLE contracts ADD CONSTRAINT contracts_bedomning_ankare_kalla_check
  CHECK ((bedomning_ankare IS NULL) = (bedomning_ankare_kalla IS NULL));

COMMENT ON COLUMN contracts.rytm_text IS
  'BASELINE: bedömningsrytmen ordagrant ur leveranskontraktets del 4 (”Hur ofta”). NULL = ingen rytm är inläst.';
COMMENT ON COLUMN contracts.bedomning_intervall_dagar IS
  'BASELINE: rytmens intervall i dagar, läst ur rytm_text. NULL = ingen rytm; då räknas inga perioder.';
COMMENT ON COLUMN contracts.bedomning_veckodag IS
  'BASELINE: rytmens ISO-veckodag (1 = måndag), läst ur rytm_text. NULL = rytmen nämner ingen veckodag.';
COMMENT ON COLUMN contracts.bedomning_ankare IS
  'BASELINE: det första bedömningstillfället, satt av David med satt_bedomningsankare. Ändras bara genom en baselineändring. NULL = datum saknas.';
COMMENT ON COLUMN contracts.bedomning_ankare_kalla IS
  'BASELINE: ankarets källa — Davids uppgift eller en kalenderreferens. Satt om och endast om ankaret är satt.';
COMMENT ON COLUMN contracts.rapport_mottagarkrets IS
  'BASELINE: vem rapporten går till, ur samma rad i del 4 som rytmen.';
