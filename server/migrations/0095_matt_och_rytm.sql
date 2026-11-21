-- FR-19, FR-14 och B-14 (”Kontraktets del 3 och del 4 får sin plats i
-- baselinen”, Story 2.3): uppföljningsmåtten och bedömningsrytmen ur avtalet.
--
-- Leveranskontraktets del 3 säger vad som mäts, hur ofta, var siffran läses och
-- när det larmar. Del 4 säger vem som får rapporten och i vilken takt. Före den
-- här filen hade ingetdera någon plats: måtten blev aldrig data, och perioden
-- för en bedömning gissades som kalendermånaden — en husrytm som inget avtal
-- har sagt.
--
-- Filen gör tre saker, i den här ordningen:
--   1. tabellen `uppdrag_matt`, ett mått per rad i del 3, med läsvägen som
--      NULL när kontraktet inte säger var siffran läses (saknad, aldrig gissad);
--   2. kommentaren, RLS, rättigheterna och avslutstriggern (husmönstret, 0082);
--   3. rytmkolumnerna på `contracts`, en utvidgning av baselinen (ADR-0), med
--      namngivna villkor och kolumnkommentarer.
--
-- Värdena i villkoren på `lasvag`, `larmregel_lage` och `utfall_lage` är exakt
-- `MATTLASVAGAR` och `MATTLAGEN` i server/src/lib/leveranskontrakt.ts, och
-- provet härleder schemat ur konstanterna. Inga befintliga rader ändras:
-- avtalen får NULL i de nya kolumnerna, och villkoren håller för dem.
-- Tabellkommentarerna och rättigheterna på befintliga tabeller rörs inte. Filen
-- tål att köras igen.

-- ---------------------------------------------------------------------------
-- 1) Tabellen
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS uppdrag_matt (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  -- Triggern `vagrar_skrivning_pa_avslutat()` läser `rad.contract_id`.
  contract_id    uuid NOT NULL,
  -- Kontraktets egna ord, cell för cell. En tom cell är NULL, aldrig ''.
  namn           text NOT NULL,
  hur_ofta       text,
  kallreferenser text,
  -- NULL = kontraktet säger inte var siffran läses. Den gissas aldrig.
  lasvag         text,
  larmregel      text,
  larmregel_lage text NOT NULL,
  utfall_lage    text NOT NULL,
  ordning        integer NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  -- Sammansatt FK (0064/0068): måttet hänger aldrig på ett annat bolags avtal.
  CONSTRAINT uppdrag_matt_contract_fk FOREIGN KEY (contract_id, company_id)
    REFERENCES contracts (id, company_id),
  -- Importens idempotens: samma mått i samma avtal skrivs en gång.
  CONSTRAINT uppdrag_matt_namn_uk UNIQUE (contract_id, namn),
  CONSTRAINT uppdrag_matt_lasvag_check
    CHECK (lasvag IS NULL OR lasvag IN ('redovisning', 'arenden', 'register', 'kalender', 'referens')),
  CONSTRAINT uppdrag_matt_larmregel_lage_check CHECK (larmregel_lage IN ('harleds', 'harleds_ej')),
  CONSTRAINT uppdrag_matt_utfall_lage_check CHECK (utfall_lage IN ('harleds', 'harleds_ej'))
);

-- ---------------------------------------------------------------------------
-- 2) Kommentaren, RLS, rättigheterna och avslutstriggern (husmönstret, 0082)
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

-- Importen lägger bara till rader (ON CONFLICT DO NOTHING). Den berättelse som
-- behöver UPDATE lägger till den rättigheten själv. Det som aldrig beviljats
-- finns inte, så ingen REVOKE behövs (0003).
GRANT SELECT, INSERT ON uppdrag_matt TO app;

-- Samma regel som på 0068:s tabeller: ett avslutat uppdrag tar inte emot ett mått.
DROP TRIGGER IF EXISTS uppdrag_matt_vagrar_avslutat ON uppdrag_matt;
CREATE TRIGGER uppdrag_matt_vagrar_avslutat
  BEFORE INSERT OR UPDATE OR DELETE ON uppdrag_matt
  FOR EACH ROW EXECUTE FUNCTION vagrar_skrivning_pa_avslutat();

-- ---------------------------------------------------------------------------
-- 3) Rytmkolumnerna på contracts (utvidgning av baselinen, ADR-0)
-- ---------------------------------------------------------------------------
-- ALTER TABLE … ADD COLUMN utlöser inga radtriggrar. Befintliga avtal får NULL:
-- ingen rytm och inget ankare, alltså inga perioder (FR-14).
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

-- ISO-veckodag: måndag = 1, söndag = 7.
ALTER TABLE contracts DROP CONSTRAINT IF EXISTS contracts_bedomning_veckodag_check;
ALTER TABLE contracts ADD CONSTRAINT contracts_bedomning_veckodag_check
  CHECK (bedomning_veckodag IS NULL OR bedomning_veckodag BETWEEN 1 AND 7);

-- En veckodag utan intervall är ingen rytm.
ALTER TABLE contracts DROP CONSTRAINT IF EXISTS contracts_bedomning_veckodag_kraver_intervall;
ALTER TABLE contracts ADD CONSTRAINT contracts_bedomning_veckodag_kraver_intervall
  CHECK (bedomning_veckodag IS NULL OR bedomning_intervall_dagar IS NOT NULL);

-- Ett ankare utan källa är en gissning (FR-14): båda satta eller båda NULL.
ALTER TABLE contracts DROP CONSTRAINT IF EXISTS contracts_bedomning_ankare_kalla_check;
ALTER TABLE contracts ADD CONSTRAINT contracts_bedomning_ankare_kalla_check
  CHECK ((bedomning_ankare IS NULL) = (bedomning_ankare_kalla IS NULL));

COMMENT ON COLUMN contracts.rytm_text IS
  'BASELINE: rapporteringsrytmen ordagrant ur kontraktets del 4. NULL = rytm saknas i kontraktet.';
COMMENT ON COLUMN contracts.bedomning_intervall_dagar IS
  'BASELINE: dagar mellan bedömningstillfällena, ur rytmen i del 4. NULL = ingen rytm, alltså inga perioder.';
COMMENT ON COLUMN contracts.bedomning_veckodag IS
  'BASELINE: rytmens ISO-veckodag (måndag = 1). NULL = rytmen nämner ingen veckodag.';
COMMENT ON COLUMN contracts.bedomning_ankare IS
  'BASELINE: första bedömningstillfället, satt av David med satt_bedomningsankare. NULL = datum saknas, och inga perioder räknas.';
COMMENT ON COLUMN contracts.bedomning_ankare_kalla IS
  'BASELINE: ankarets källa, Davids uppgift eller en kalenderreferens. Obligatorisk när ankaret är satt.';
COMMENT ON COLUMN contracts.rapport_mottagarkrets IS
  'BASELINE: mottagarkretsen på rytmens rad i kontraktets del 4. NULL = saknas i kontraktet.';
