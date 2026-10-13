-- Uppdragsytan Story 1.10 (B-3, FR-40, FR-15, FR-16, FR-14): en ny bedömning
-- som David begär når honom färdig att sätta.
--
-- David begär en ny bedömning av ett avtal när han själv ser skäl till det.
-- Begäran är en fråga till honom i undantagsvyn tills en mänsklig bedömning
-- besvarar den. Svaret står i data: en begäran är obesvarad tills en rad i
-- `uppdrag_bedomning` bär dess id. En jämförelse av tidsstämplar hade blivit
-- osäker när två transaktioner överlappar, eftersom now() är transaktionens
-- start.
--
-- Filen gör sex saker, i den här ordningen:
--   1. tabellen `uppdrag_bedomningsbegaran` med indexet
--      `uppdrag_bedomningsbegaran_avtal_idx` och nyckeln
--      `uppdrag_bedomningsbegaran_nyckel_uk (id, company_id, contract_id)`, som
--      bär den sammansatta FK:n från bedömningen;
--   2. kommentaren, RLS och rättigheterna: append-only, `app` har SELECT + INSERT;
--   3. avslutstriggern `uppdrag_bedomningsbegaran_vagrar_avslutat` med 0068:s
--      oförändrade funktion;
--   4. de två nullbara kolumnerna `begaran_id` och `satt_av` på `uppdrag_bedomning`;
--   5. villkoren på `uppdrag_bedomning`: FK:n `uppdrag_bedomning_begaran_fk`, den
--      unika nyckeln `uppdrag_bedomning_en_per_begaran` och de två CHECK-villkoren
--      `uppdrag_bedomning_begaran_kraver_manniska` och
--      `uppdrag_bedomning_satt_av_kraver_manniska`;
--   6. kolumnkommentarerna.
--
-- Filen är additiv och bakåtkompatibel: den gamla `sattBedomning` skriver rader
-- med NULL i de nya kolumnerna, vilket villkoren tillåter, och en återställning
-- till föregående release lämnar begäranstabellen oanvänd. Befintliga
-- bedömningar får NULL i `satt_av`: vem som satte dem finns inte i underlaget
-- och gissas inte. En gissad stämpel vore värre än ingen (0070:s princip).
-- Tabellkommentaren och rättigheterna på `uppdrag_bedomning` ändras inte. En
-- andra körning ändrar ingenting.

-- ---------------------------------------------------------------------------
-- 1) Tabellen
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS uppdrag_bedomningsbegaran (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  -- Triggern `vagrar_skrivning_pa_avslutat()` läser `rad.contract_id`, och en
  -- bedömning besvarar en begäran för ett avtal, aldrig för ett projekt.
  contract_id uuid NOT NULL,
  -- Den inloggade människan, aldrig ur indata (som `skriven_av` i 0073 och
  -- `avgjort_av` i 0081). Namnet visas genom en läsning.
  begard_av   uuid NOT NULL REFERENCES users(id),
  begard_nar  timestamptz NOT NULL DEFAULT now(),
  -- Davids skäl, frivilligt. NULL när det saknas, aldrig en tom sträng.
  kommentar   text,
  -- Sammansatt FK (0064/0068): begäran hänger aldrig på ett annat bolags avtal.
  CONSTRAINT uppdrag_bedomningsbegaran_contract_fk FOREIGN KEY (contract_id, company_id)
    REFERENCES contracts (id, company_id),
  -- Samma gräns som åtgärdens schema, också för kod som inte går genom det:
  -- en kommentar av bara blanktecken är ingen kommentar.
  CONSTRAINT uppdrag_bedomningsbegaran_kommentar
    CHECK (kommentar IS NULL OR (btrim(kommentar) <> '' AND char_length(kommentar) <= 2000)),
  -- Nyckeln som bedömningens FK pekar på: en bedömning kan bara besvara en
  -- begäran för samma avtal i samma bolag.
  CONSTRAINT uppdrag_bedomningsbegaran_nyckel_uk UNIQUE (id, company_id, contract_id)
);

-- Läsningen är ”avtalets begäranden i den ordning de begärdes”.
CREATE INDEX IF NOT EXISTS uppdrag_bedomningsbegaran_avtal_idx
  ON uppdrag_bedomningsbegaran (company_id, contract_id, begard_nar);

-- ---------------------------------------------------------------------------
-- 2) Kommentaren, RLS och rättigheterna (husmönstret, 0073/0081)
-- ---------------------------------------------------------------------------
-- Kategorin står först: ägandeprovet och Hermes agandegrans.py läser första ledet.
COMMENT ON TABLE uppdrag_bedomningsbegaran IS
  'Kategori: ÄGD, append-only. Davids begäran om en ny bedömning av ett avtal. Den är obesvarad tills en rad i uppdrag_bedomning bär dess id. app har SELECT + INSERT och ingenting annat.';

ALTER TABLE uppdrag_bedomningsbegaran ENABLE ROW LEVEL SECURITY;
ALTER TABLE uppdrag_bedomningsbegaran FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS uppdrag_bedomningsbegaran_select ON uppdrag_bedomningsbegaran;
CREATE POLICY uppdrag_bedomningsbegaran_select ON uppdrag_bedomningsbegaran FOR SELECT
  USING (app_has_company_access(company_id));

DROP POLICY IF EXISTS uppdrag_bedomningsbegaran_insert ON uppdrag_bedomningsbegaran;
CREATE POLICY uppdrag_bedomningsbegaran_insert ON uppdrag_bedomningsbegaran FOR INSERT
  WITH CHECK (app_has_company_access(company_id));

-- Ingen UPDATE- eller DELETE-policy och ingen sådan rättighet: en begäran
-- besvaras genom en ny rad i uppdrag_bedomning, aldrig genom en UPDATE av
-- begäran. Det som aldrig beviljats finns inte, så ingen REVOKE behövs (0003).
GRANT SELECT, INSERT ON uppdrag_bedomningsbegaran TO app;

-- ---------------------------------------------------------------------------
-- 3) Avslutstriggern
-- ---------------------------------------------------------------------------
-- Samma regel som på 0068:s tabeller, på ett ställe: ett avslutat uppdrag tar
-- inte emot en begäran. Funktionen ur 0068 ändras inte, och tjänsten gör ingen
-- egen kontroll av projektets status.
DROP TRIGGER IF EXISTS uppdrag_bedomningsbegaran_vagrar_avslutat ON uppdrag_bedomningsbegaran;
CREATE TRIGGER uppdrag_bedomningsbegaran_vagrar_avslutat
  BEFORE INSERT OR UPDATE OR DELETE ON uppdrag_bedomningsbegaran
  FOR EACH ROW EXECUTE FUNCTION vagrar_skrivning_pa_avslutat();

-- ---------------------------------------------------------------------------
-- 4) Kolumnerna på uppdrag_bedomning
-- ---------------------------------------------------------------------------
-- ALTER TABLE … ADD COLUMN utlöser inga radtriggrar, så avslutstriggern på
-- tabellen påverkar inte migrationen. Befintliga rader får NULL i båda.
ALTER TABLE uppdrag_bedomning
  ADD COLUMN IF NOT EXISTS begaran_id uuid,
  ADD COLUMN IF NOT EXISTS satt_av uuid REFERENCES users(id);

-- ---------------------------------------------------------------------------
-- 5) Villkoren på uppdrag_bedomning (formen ur 0080)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  -- Begäran i SAMMA bolag och SAMMA avtal som bedömningen.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uppdrag_bedomning_begaran_fk') THEN
    ALTER TABLE uppdrag_bedomning
      ADD CONSTRAINT uppdrag_bedomning_begaran_fk FOREIGN KEY (begaran_id, company_id, contract_id)
        REFERENCES uppdrag_bedomningsbegaran (id, company_id, contract_id);
  END IF;
  -- En bedömning besvarar högst en begäran, och en begäran besvaras en gång.
  -- Sista försvarslinjen bakom radlåset på avtalet; ingen kod fångar krocken.
  -- NULL räknas som skilda, så bedömningar utan begäran påverkas inte, och två
  -- bedömningar av samma period är fortfarande tillåtna.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uppdrag_bedomning_en_per_begaran') THEN
    ALTER TABLE uppdrag_bedomning
      ADD CONSTRAINT uppdrag_bedomning_en_per_begaran UNIQUE (begaran_id);
  END IF;
  -- Bara en mänsklig bedömning besvarar en begäran (FR-15).
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uppdrag_bedomning_begaran_kraver_manniska') THEN
    ALTER TABLE uppdrag_bedomning
      ADD CONSTRAINT uppdrag_bedomning_begaran_kraver_manniska CHECK (begaran_id IS NULL OR satt_av_manniska);
  END IF;
  -- En rad som inte satts av en människa får aldrig en mänsklig signatur.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uppdrag_bedomning_satt_av_kraver_manniska') THEN
    ALTER TABLE uppdrag_bedomning
      ADD CONSTRAINT uppdrag_bedomning_satt_av_kraver_manniska CHECK (satt_av IS NULL OR satt_av_manniska);
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 6) Kolumnkommentarerna
-- ---------------------------------------------------------------------------
COMMENT ON COLUMN uppdrag_bedomning.begaran_id IS
  'Den begäran (uppdrag_bedomningsbegaran) som raden besvarar. NULL = raden besvarade ingen begäran.';
COMMENT ON COLUMN uppdrag_bedomning.satt_av IS
  'Människan som satte raden, ur den inloggade användaren. NULL för rader satta före 0082: vem som satte dem finns inte i underlaget och gissas inte.';
