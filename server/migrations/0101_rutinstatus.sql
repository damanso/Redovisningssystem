-- Story 14.1 (FR-13, Davids svar 2026-10-07: «Det räcker enligt din
-- rekommendation»): rutinvägen, den fjärde skrivvägen för leverabelns status.
--
-- Ett registrerat transmittal ger `levererad` och ett loggat godkännande från
-- avtalets godkännare ger `godkand`, utan fråga, när rutinregeln
-- (`server/src/lib/rutinregel.ts`) medger det. En sådan rad registreras av
-- regeln och inte av en människa, och det ska synas i raden själv och gälla
-- också förbi tjänstelagret. Därför ligger formen i ett CHECK-villkor och inte
-- bara i koden — samma skäl som 0072:s kanalvillkor.
--
-- Filen skapar fyra nullbara eller förifyllda kolumner på
-- `uppdrag_leverabel_handelse`:
--   * `registrerad_av` — `manniska` eller `system`;
--   * `kallhandelse_typ` — `transmittal` eller `godkannande`;
--   * `kallhandelse_ref` — källhändelsens stabila nyckel, sort och kanoniskt id;
--   * `kallhandelse_aktor` — godkännandets avsändare som källan anger den.
-- Därtill fyra CHECK-villkor (värdet i `registrerad_av`, källhändelsens typ,
-- aktören och registreringens tre tillåtna former), det unika indexet
-- `uppdrag_leverabel_handelse_kallhandelse_uk` och kolumnkommentarer.
--
-- Befintliga rader får `registrerad_av = 'manniska'`, vilket är sant om dem:
-- bara de tre människospärrade åtgärderna har skrivit i tabellen, och de sätter
-- alltid `bekraftat_av`. Inga rader skrivs om, och rättigheterna är orörda
-- (`app` har SELECT + INSERT och ingenting annat, 0068). Villkoret prövar de
-- befintliga raderna: en rad utan `bekraftat_av` kan bara ha riggats för hand,
-- och då fäller migrationen högt i stället för att lämna en rad som villkoret
-- förbjuder. Andra körningen är ett no-op.

-- ---------------------------------------------------------------------------
-- Vem som registrerade raden
-- ---------------------------------------------------------------------------
ALTER TABLE uppdrag_leverabel_handelse
  ADD COLUMN IF NOT EXISTS registrerad_av text NOT NULL DEFAULT 'manniska';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uppdrag_leverabel_handelse_registrerad_av_check') THEN
    ALTER TABLE uppdrag_leverabel_handelse ADD CONSTRAINT uppdrag_leverabel_handelse_registrerad_av_check
      CHECK (registrerad_av IN ('manniska', 'system'));
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- Källhändelsen: typen, nyckeln och källans aktör
-- ---------------------------------------------------------------------------
ALTER TABLE uppdrag_leverabel_handelse
  ADD COLUMN IF NOT EXISTS kallhandelse_typ text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uppdrag_leverabel_handelse_kallhandelse_typ_check') THEN
    ALTER TABLE uppdrag_leverabel_handelse ADD CONSTRAINT uppdrag_leverabel_handelse_kallhandelse_typ_check
      CHECK (kallhandelse_typ IS NULL OR kallhandelse_typ IN ('transmittal', 'godkannande'));
  END IF;
END
$$;

ALTER TABLE uppdrag_leverabel_handelse
  ADD COLUMN IF NOT EXISTS kallhandelse_ref text;

ALTER TABLE uppdrag_leverabel_handelse
  ADD COLUMN IF NOT EXISTS kallhandelse_aktor text;

-- Aktören är satt om och endast om källhändelsen är ett godkännande. NULL i
-- typen kräver alltså NULL i aktören; uttrycket blir aldrig NULL självt.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uppdrag_leverabel_handelse_kallhandelse_aktor_check') THEN
    ALTER TABLE uppdrag_leverabel_handelse ADD CONSTRAINT uppdrag_leverabel_handelse_kallhandelse_aktor_check
      CHECK ((kallhandelse_typ IS NOT DISTINCT FROM 'godkannande') = (kallhandelse_aktor IS NOT NULL));
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- Registreringens tre tillåtna former (kriterium 2)
-- ---------------------------------------------------------------------------
--   1. En människa utan källhändelse: de tre människospärrade åtgärderna.
--      `referens_id` är fri, eftersom människans överlämning bär handlingen där.
--   2. En människa med källhändelse och referens: Davids ja på ett fällt
--      förslag (Story 14.4). Ingen kod i Story 14.1 skriver formen.
--   3. Systemet med källhändelse och referens, utan `bekraftat_av`: rutinvägen.
-- `bekraftat_av` får alltså vara NULL bara när `registrerad_av = 'system'`.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uppdrag_leverabel_handelse_registrering_check') THEN
    ALTER TABLE uppdrag_leverabel_handelse ADD CONSTRAINT uppdrag_leverabel_handelse_registrering_check
      CHECK (
        (registrerad_av = 'manniska' AND bekraftat_av IS NOT NULL
          AND kallhandelse_typ IS NULL AND kallhandelse_ref IS NULL AND kallhandelse_aktor IS NULL)
        OR (registrerad_av = 'manniska' AND bekraftat_av IS NOT NULL
          AND kallhandelse_typ IS NOT NULL AND kallhandelse_ref IS NOT NULL AND referens_id IS NOT NULL)
        OR (registrerad_av = 'system' AND bekraftat_av IS NULL
          AND kallhandelse_typ IS NOT NULL AND kallhandelse_ref IS NOT NULL AND referens_id IS NOT NULL)
      );
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- Samma källhändelse registreras aldrig två gånger för samma leverabel
-- ---------------------------------------------------------------------------
-- Gäller rutinrader och Davids ja gemensamt. Människorader utan källhändelse
-- har NULL i båda kolumnerna och krockar därför aldrig. Tjänsten slår upp
-- nyckeln under leverabelns radlås först; indexet är sista försvarslinjen.
CREATE UNIQUE INDEX IF NOT EXISTS uppdrag_leverabel_handelse_kallhandelse_uk
  ON uppdrag_leverabel_handelse (leverabel_id, kallhandelse_typ, kallhandelse_ref);

-- ---------------------------------------------------------------------------
-- Kommentarer
-- ---------------------------------------------------------------------------
COMMENT ON COLUMN uppdrag_leverabel_handelse.registrerad_av IS
  'Vem som registrerade raden: manniska med bekraftat_av, också när människan sagt ja till en källhändelse, eller system när rutinregeln (FR-13) medgav bytet, då utan bekraftat_av. Källans aktör tillskrivs aldrig registreringen.';

COMMENT ON COLUMN uppdrag_leverabel_handelse.kallhandelse_typ IS
  'Vilken källhändelse raden registrerades ur: transmittal eller godkannande. NULL för rader som de tre människospärrade åtgärderna skrivit.';

COMMENT ON COLUMN uppdrag_leverabel_handelse.kallhandelse_ref IS
  'Källhändelsens stabila nyckel, sort och kanoniskt id (till exempel mejl:<Message-ID>). Ingen källhändelse registreras två gånger för samma leverabel.';

COMMENT ON COLUMN uppdrag_leverabel_handelse.kallhandelse_aktor IS
  'Godkännandets avsändare som källan anger den, trimmad. En källuppgift och aldrig en signatur eller mottagare. Satt om och endast om kallhandelse_typ är godkannande.';

-- 0099:s text blir osann för rutinvägens godkännande, som bär handlingen. 0099
-- ändras inte (en körd migration ändras aldrig); texten skrivs om här.
COMMENT ON COLUMN uppdrag_leverabel_handelse.referens_id IS
  'Handlingen som överlämningen eller returen registrerades ur, som rad i uppdrag_referens. Överlämningsdatumet läses ur referensens händelsedatum och kopieras aldrig hit. Satt för varje rad som registrerats ur en källhändelse, av rutinvägen eller genom en människas ja på ett förslag, också godkännandet. NULL för påbörjande, godkännande genom godkann_leverabel, retur utan handling och överlämningar före 0099.';
