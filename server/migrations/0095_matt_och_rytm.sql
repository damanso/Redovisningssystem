-- Uppdragsytan Story 2.3 (FR-19, FR-14, B-14 ”Kontraktets del 3 och del 4 får
-- sin plats i baselinen”): måtten och rytmen ur leveranskontraktet.
--
-- Del 3 säger vad som mäts, hur ofta, var siffran läses och när det larmar.
-- Del 4 säger vem som får rapporten och hur ofta. Före den här filen hade inget
-- av det en plats: måtten fanns bara som fritext på leverablerna och perioden
-- räknades som kalendermånaden, en husrytm som kontraktet aldrig har sagt.
--
-- Filen gör tre saker, i den här ordningen:
--   1. tabellen `uppdrag_matt`, ett mått per rad med läsväg, larmregelns text
--      ordagrant och två lägen som säger om larmregeln och utfallet härleds;
--   2. kommentaren, RLS, rättigheterna (SELECT + INSERT) och avslutstriggern;
--   3. rytmkolumnerna på `contracts`: rytmen ordagrant, intervallet i dagar,
--      ISO-veckodagen, ankardatumet med sin källa och mottagarkretsen.
--
-- Filen är additiv: inga befintliga rader ändras, och de nya kolumnerna är
-- NULL för varje avtal som redan finns, vilket villkoren tillåter. Läsvägarna
-- och lägena är exakt `MATTLASVAGAR` och `MATTLAGEN` i
-- server/src/lib/leveranskontrakt.ts, och provet härleder schemat ur dem.
-- 0068, `uppdrag_leverabel.matt_lasvag` och tabellkommentarerna på befintliga
-- tabeller rörs inte. Filen tål att köras igen.

-- ---------------------------------------------------------------------------
-- 1) Tabellen
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS uppdrag_matt (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  -- Triggern `vagrar_skrivning_pa_avslutat()` läser `rad.contract_id`.
  contract_id    uuid NOT NULL,
  namn           text NOT NULL,
  -- Kontraktets egna celler, trimmade och annars ordagranna. NULL när cellen
  -- är tom i kontraktet, aldrig en utfyllnad.
  hur_ofta       text,
  kallreferenser text,
  -- NULL betyder att kontraktet inte säger var siffran läses. Den gissas inte;
  -- importen redovisar den som saknad.
  lasvag         text,
  larmregel      text,
  -- Om larmregeln och utfallet härleds av modulen. Importen skriver alltid
  -- 'harleds_ej' för larmregeln: ingen larmmekanik finns ännu (Story 5.8).
  larmregel_lage text NOT NULL,
  utfall_lage    text NOT NULL,
  -- Textens ordning, så att måtten visas som kontraktet räknar upp dem.
  ordning        integer NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  -- Sammansatt FK (0064/0068): ett mått hänger aldrig på ett annat bolags avtal.
  CONSTRAINT uppdrag_matt_contract_fk FOREIGN KEY (contract_id, company_id)
    REFERENCES contracts (id, company_id),
  -- Ett mått per namn och avtal: en ny import av samma text skapar inga dubbletter.
  CONSTRAINT uppdrag_matt_namn_uk UNIQUE (contract_id, namn),
  CONSTRAINT uppdrag_matt_lasvag_check
    CHECK (lasvag IS NULL OR lasvag IN ('redovisning', 'arenden', 'register', 'kalender', 'referens')),
  CONSTRAINT uppdrag_matt_larmregel_lage_check
    CHECK (larmregel_lage IN ('harleds', 'harleds_ej')),
  CONSTRAINT uppdrag_matt_utfall_lage_check
    CHECK (utfall_lage IN ('harleds', 'harleds_ej'))
);

-- ---------------------------------------------------------------------------
-- 2) Kommentaren, RLS, rättigheterna och avslutstriggern (husmönstret, 0082)
-- ---------------------------------------------------------------------------
-- Kategorin står först: ägandeprovet och Hermes agandegrans läser första ledet.
COMMENT ON TABLE uppdrag_matt IS
  'Kategori: BASELINE. Avtalets uppföljningsmått ur kontraktets del 3 — läses ur avtalet, uppfinns aldrig här. Läsvägen NULL betyder saknad i kontraktet.';

ALTER TABLE uppdrag_matt ENABLE ROW LEVEL SECURITY;
ALTER TABLE uppdrag_matt FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS uppdrag_matt_select ON uppdrag_matt;
CREATE POLICY uppdrag_matt_select ON uppdrag_matt FOR SELECT
  USING (app_has_company_access(company_id));

DROP POLICY IF EXISTS uppdrag_matt_insert ON uppdrag_matt;
CREATE POLICY uppdrag_matt_insert ON uppdrag_matt FOR INSERT
  WITH CHECK (app_has_company_access(company_id));

-- Importen lägger bara till rader (ON CONFLICT DO NOTHING). Story 5.8 lägger
-- till den rättighet larmregeln behöver; det som aldrig beviljats finns inte,
-- så ingen REVOKE behövs (0003).
GRANT SELECT, INSERT ON uppdrag_matt TO app;

-- Samma regel som på 0068:s tabeller, med 0068:s oförändrade funktion: ett
-- avslutat uppdrag tar inte emot ett nytt mått.
DROP TRIGGER IF EXISTS uppdrag_matt_vagrar_avslutat ON uppdrag_matt;
CREATE TRIGGER uppdrag_matt_vagrar_avslutat
  BEFORE INSERT OR UPDATE OR DELETE ON uppdrag_matt
  FOR EACH ROW EXECUTE FUNCTION vagrar_skrivning_pa_avslutat();

-- ---------------------------------------------------------------------------
-- 3) Rytmkolumnerna på contracts (ADR-0: en utvidgning av baselinen)
-- ---------------------------------------------------------------------------
-- ALTER TABLE … ADD COLUMN utlöser inga radtriggrar. Befintliga avtal får NULL,
-- och NULL är ”rytm saknas” respektive ”datum saknas”, aldrig en husrytm.
-- Rättigheterna på contracts ändras inte.
ALTER TABLE contracts
  ADD COLUMN IF NOT EXISTS rytm_text text,
  ADD COLUMN IF NOT EXISTS bedomning_intervall_dagar integer,
  ADD COLUMN IF NOT EXISTS bedomning_veckodag smallint,
  ADD COLUMN IF NOT EXISTS bedomning_ankare date,
  ADD COLUMN IF NOT EXISTS bedomning_ankare_kalla text,
  ADD COLUMN IF NOT EXISTS rapport_mottagarkrets text;

-- Ett intervall är minst en dag och högst ett år.
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

-- Ankardatumet har alltid en källa: en kalenderreferens eller Davids uppgift.
ALTER TABLE contracts DROP CONSTRAINT IF EXISTS contracts_bedomning_ankare_kalla_check;
ALTER TABLE contracts ADD CONSTRAINT contracts_bedomning_ankare_kalla_check
  CHECK ((bedomning_ankare IS NULL) = (bedomning_ankare_kalla IS NULL));

COMMENT ON COLUMN contracts.rytm_text IS
  'BASELINE: bedömningsrytmen ordagrant ur kontraktets del 4. NULL betyder att kontraktet inte anger någon.';
COMMENT ON COLUMN contracts.bedomning_intervall_dagar IS
  'BASELINE: rytmens intervall i dagar, härlett ur rytm_text. NULL betyder rytm saknas; ingen husrytm finns.';
COMMENT ON COLUMN contracts.bedomning_veckodag IS
  'BASELINE: rytmens ISO-veckodag (måndag = 1), härledd ur rytm_text. NULL när rytmen inte nämner en dag.';
COMMENT ON COLUMN contracts.bedomning_ankare IS
  'BASELINE: det första bedömningstillfället, satt av David med satt_bedomningsankare. NULL betyder datum saknas, och då räknas inga perioder.';
COMMENT ON COLUMN contracts.bedomning_ankare_kalla IS
  'BASELINE: ankardatumets källa, en kalenderreferens eller Davids uppgift. Satt exakt när ankaret är satt.';
COMMENT ON COLUMN contracts.rapport_mottagarkrets IS
  'BASELINE: vem som får rapporten i rytmen, ordagrant ur samma rad i kontraktets del 4.';
