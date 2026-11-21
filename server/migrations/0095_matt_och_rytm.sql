-- FR-19, FR-14 och B-14 (Story 2.3): kontraktets del 3 och del 4 får sin
-- plats i baselinen.
--
-- Leveranskontraktets del 3 säger vad som mäts, hur ofta, var siffran läses
-- och när det larmar. Del 4 säger vem som får rapporten och i vilken takt.
-- Inget av det hade en plats: måtten fanns bara som en kolumn per leverabel,
-- och bedömningens period gissades ur kalendermånaden. En husrytm är precis
-- den gissning FR-14 förbjuder.
--
-- Filen gör två saker, i den här ordningen:
--   1. tabellen `uppdrag_matt` (BASELINE): ett mått per rad, med läsvägen ur en
--      sluten lista och NULL när listan inte känner kontraktets cell.
--      Larmregeln står ordagrant, och dess läge och utfallets läge är
--      `harleds` eller `harleds_ej`. Ingen kolumn bär en beslutspunkts datum,
--      ett läge eller en andel;
--   2. rytmkolumnerna på `contracts`, som utvidgning av baselinen (ADR-0):
--      rytmen ordagrant, intervallet i dagar, ISO-veckodagen, ankardatumet med
--      sin källa och rapportens mottagarkrets.
--
-- Värdena i CHECK-villkoren är exakt `MATTLASVAGAR` och `MATTLAGEN` i
-- server/src/lib/leveranskontrakt.ts, och provet härleder schemat ur
-- konstanterna. Inga befintliga rader ändras: tabellen är ny, och kolumnerna
-- är nullbara med villkor som NULL uppfyller. Rättigheterna på `contracts`,
-- tabellkommentarerna på de befintliga tabellerna och
-- `uppdrag_leverabel.matt_lasvag` rörs inte. Filen tål att köras igen.

-- ---------------------------------------------------------------------------
-- 1) uppdrag_matt
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS uppdrag_matt (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  -- Triggern `vagrar_skrivning_pa_avslutat()` läser `rad.contract_id`.
  contract_id    uuid NOT NULL,
  namn           text NOT NULL,
  hur_ofta       text,
  -- Kontraktets egna ord om var siffran läses, som de står.
  kallreferenser text,
  -- NULL betyder att ingen läsväg kunde härledas ur kontraktets cell. Ingen gissas.
  lasvag         text,
  -- Larmregeln ordagrant ur kontraktet.
  larmregel      text,
  larmregel_lage text NOT NULL,
  utfall_lage    text NOT NULL,
  ordning        integer NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  -- Sammansatt FK (0064/0068): måttet hänger aldrig på ett annat bolags avtal.
  CONSTRAINT uppdrag_matt_contract_fk FOREIGN KEY (contract_id, company_id)
    REFERENCES contracts (id, company_id),
  -- Importen lägger bara till rader (ON CONFLICT DO NOTHING) på nyckeln.
  CONSTRAINT uppdrag_matt_namn_uk UNIQUE (contract_id, namn),
  CONSTRAINT uppdrag_matt_lasvag_check
    CHECK (lasvag IS NULL OR lasvag IN ('redovisning', 'arenden', 'register', 'kalender', 'referens')),
  CONSTRAINT uppdrag_matt_larmregel_lage_check CHECK (larmregel_lage IN ('harleds', 'harleds_ej')),
  CONSTRAINT uppdrag_matt_utfall_lage_check CHECK (utfall_lage IN ('harleds', 'harleds_ej'))
);

-- Kategorin står först: ägandeprovet och Hermes agandegrans läser första ledet.
COMMENT ON TABLE uppdrag_matt IS 'Kategori: BASELINE. Avtalets uppföljningsmått ur kontraktets del 3 — läses ur avtalet, uppfinns aldrig här. Läsvägen NULL betyder att ingen läsväg kunde härledas ur kontraktets cell.';

ALTER TABLE uppdrag_matt ENABLE ROW LEVEL SECURITY;
ALTER TABLE uppdrag_matt FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS uppdrag_matt_select ON uppdrag_matt;
CREATE POLICY uppdrag_matt_select ON uppdrag_matt FOR SELECT
  USING (app_has_company_access(company_id));

DROP POLICY IF EXISTS uppdrag_matt_insert ON uppdrag_matt;
CREATE POLICY uppdrag_matt_insert ON uppdrag_matt FOR INSERT
  WITH CHECK (app_has_company_access(company_id));

-- SELECT och INSERT och ingenting mer: importen skriver bara nya rader. Den
-- berättelse som behöver ändra ett mått lägger till sin egen rättighet.
GRANT SELECT, INSERT ON uppdrag_matt TO app;

-- Samma regel som på 0068:s tabeller: ett avslutat uppdrag tar inte emot ett
-- mått. Funktionen ur 0068 ändras inte.
DROP TRIGGER IF EXISTS uppdrag_matt_vagrar_avslutat ON uppdrag_matt;
CREATE TRIGGER uppdrag_matt_vagrar_avslutat
  BEFORE INSERT OR UPDATE OR DELETE ON uppdrag_matt
  FOR EACH ROW EXECUTE FUNCTION vagrar_skrivning_pa_avslutat();

-- ---------------------------------------------------------------------------
-- 2) Rytmkolumnerna på contracts
-- ---------------------------------------------------------------------------
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

ALTER TABLE contracts DROP CONSTRAINT IF EXISTS contracts_bedomning_veckodag_check;
ALTER TABLE contracts ADD CONSTRAINT contracts_bedomning_veckodag_check
  CHECK (bedomning_veckodag IS NULL OR bedomning_veckodag BETWEEN 1 AND 7);

-- En veckodag utan intervall är ingen rytm.
ALTER TABLE contracts DROP CONSTRAINT IF EXISTS contracts_bedomning_veckodag_kraver_intervall;
ALTER TABLE contracts ADD CONSTRAINT contracts_bedomning_veckodag_kraver_intervall
  CHECK (bedomning_veckodag IS NULL OR bedomning_intervall_dagar IS NOT NULL);

-- Ett ankare utan källa är en gissning; en källa utan ankare pekar på ingenting.
ALTER TABLE contracts DROP CONSTRAINT IF EXISTS contracts_bedomning_ankare_kalla_check;
ALTER TABLE contracts ADD CONSTRAINT contracts_bedomning_ankare_kalla_check
  CHECK ((bedomning_ankare IS NULL) = (bedomning_ankare_kalla IS NULL));

COMMENT ON COLUMN contracts.rytm_text IS
  'BASELINE: bedömningsrytmen ordagrant ur leveranskontraktets del 4. NULL = ingen rytm är inläst.';
COMMENT ON COLUMN contracts.bedomning_intervall_dagar IS
  'BASELINE: rytmens intervall i dagar, ur rytm_text. NULL = ingen rytm är inläst, och då räknas inga perioder.';
COMMENT ON COLUMN contracts.bedomning_veckodag IS
  'BASELINE: rytmens ISO-veckodag (1 = måndag), ur rytm_text. NULL = rytmen namnger ingen veckodag.';
COMMENT ON COLUMN contracts.bedomning_ankare IS
  'BASELINE: första bedömningstillfället, satt av David med satt_bedomningsankare. Utan ankare räknas inga perioder. Ändras bara genom en baselineändring.';
COMMENT ON COLUMN contracts.bedomning_ankare_kalla IS
  'BASELINE: ankardatumets källa, ”Davids uppgift <datum>” eller ”Kalenderreferens <id>”. Satt precis när ankaret är satt.';
COMMENT ON COLUMN contracts.rapport_mottagarkrets IS
  'BASELINE: rapportens mottagarkrets ur samma rad i del 4 som rytmen.';
