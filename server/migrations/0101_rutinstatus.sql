-- Story 14.1 (FR-13, Davids svar 2026-10-07 «Det räcker enligt din
-- rekommendation»): rutinvägen, den fjärde skrivvägen för leverabelns status.
--
-- Ett statusbyte som följer av en källbelagd handling — ett registrerat
-- transmittal ger levererad, ett godkännande från avtalets godkännare ger
-- godkand — registreras av rutinregeln (server/src/lib/rutinregel.ts) utan att
-- en människa bekräftar det. Raden får då ingen mänsklig signatur. Filen gör
-- händelsetabellen i stånd att skilja de två registreringarna åt:
--   - registrerad_av (manniska | system), NOT NULL med standardvärdet manniska;
--   - kallhandelse_typ (transmittal | godkannande) och kallhandelse_ref, den
--     stabila nyckeln <sort>:<kanoniskt id> ur handlingen;
--   - kallhandelse_aktor, godkännandets avsändare som källan anger den;
--   - fyra CHECK-villkor och det unika indexet på leverabel, typ och nyckel.
--
-- Befintliga rader får manniska, vilket är sant om dem: de tre
-- människospärrade åtgärderna är de enda som skrivit i tabellen, och de sätter
-- alltid bekraftat_av. Inga rader skrivs om, ingen trigger tillkommer och
-- rättigheterna är orörda: app har fortfarande bara SELECT och INSERT, så en
-- rutinrad går lika lite som en människorad att skriva om. Registreringsvillkoret
-- prövar befintliga rader; en rad utan bekraftat_av kan bara ha riggats för
-- hand, och då fäller migrationen högt i stället för att lämna en rad som
-- villkoret förbjuder.

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
-- Källhändelsen: typ, nyckel och källans aktör
-- ---------------------------------------------------------------------------
ALTER TABLE uppdrag_leverabel_handelse ADD COLUMN IF NOT EXISTS kallhandelse_typ text;
ALTER TABLE uppdrag_leverabel_handelse ADD COLUMN IF NOT EXISTS kallhandelse_ref text;
ALTER TABLE uppdrag_leverabel_handelse ADD COLUMN IF NOT EXISTS kallhandelse_aktor text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uppdrag_leverabel_handelse_kallhandelse_typ_check') THEN
    ALTER TABLE uppdrag_leverabel_handelse ADD CONSTRAINT uppdrag_leverabel_handelse_kallhandelse_typ_check
      CHECK (kallhandelse_typ IS NULL OR kallhandelse_typ IN ('transmittal', 'godkannande'));
  END IF;
  -- Källans aktör finns bara för godkännandet, och där alltid: en NULL-typ
  -- kräver en NULL-aktör.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uppdrag_leverabel_handelse_kallhandelse_aktor_check') THEN
    ALTER TABLE uppdrag_leverabel_handelse ADD CONSTRAINT uppdrag_leverabel_handelse_kallhandelse_aktor_check
      CHECK ((kallhandelse_typ IS NOT DISTINCT FROM 'godkannande') = (kallhandelse_aktor IS NOT NULL));
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- Registreringens tre tillåtna former (kriterium 2)
-- ---------------------------------------------------------------------------
-- 1. En människa utan källhändelse: de tre människospärrade åtgärderna.
--    referens_id är fri, eftersom människans överlämning bär handlingen där.
-- 2. En människa med källhändelse och handling: Davids ja på ett fällt byte
--    (Story 14.4). Ingen kod i Story 14.1 skriver formen.
-- 3. Rutinregeln: ingen bekräftare, men alltid källhändelse och handling.
-- bekraftat_av får alltså vara NULL bara när registrerad_av = 'system', och
-- källans aktör tillskrivs aldrig registreringen.
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
-- har NULL i typ och nyckel och krockar därför aldrig. Tjänsten slår upp
-- nyckeln under leverabelns radlås; indexet är sista försvarslinjen.
CREATE UNIQUE INDEX IF NOT EXISTS uppdrag_leverabel_handelse_kallhandelse_uk
  ON uppdrag_leverabel_handelse (leverabel_id, kallhandelse_typ, kallhandelse_ref);

-- ---------------------------------------------------------------------------
-- Kolumnkommentarer
-- ---------------------------------------------------------------------------
COMMENT ON COLUMN uppdrag_leverabel_handelse.registrerad_av IS
  'Vem som registrerade raden: manniska (med bekraftat_av, också när människan sagt ja till en källhändelse) eller system, alltså rutinregeln (FR-13), utan bekraftat_av. Källans aktör tillskrivs aldrig registreringen.';
COMMENT ON COLUMN uppdrag_leverabel_handelse.kallhandelse_typ IS
  'Källhändelsen raden registrerades ur: transmittal eller godkannande. NULL för rader som de tre människospärrade åtgärderna skrivit.';
COMMENT ON COLUMN uppdrag_leverabel_handelse.kallhandelse_ref IS
  'Källhändelsens stabila nyckel, sort och kanoniskt id ur handlingen. Ingen källhändelse registreras två gånger för samma leverabel.';
COMMENT ON COLUMN uppdrag_leverabel_handelse.kallhandelse_aktor IS
  'Godkännandets avsändare som källan anger den. En källuppgift, aldrig en signatur och aldrig en mottagare.';

-- 0099:s text blir osann för rutinvägens godkännande, som bär handlingen. 0099
-- ändras inte (en körd migration ändras aldrig); kommentaren skrivs om här.
COMMENT ON COLUMN uppdrag_leverabel_handelse.referens_id IS
  'Handlingen som överlämningen eller returen registrerades ur, som rad i uppdrag_referens. Överlämningsdatumet läses ur referensens händelsedatum och kopieras aldrig hit. Kolumnen är satt för varje rad som registrerats ur en källhändelse, av rutinvägen eller genom en människas ja på ett förslag, också godkännandet. NULL för påbörjande, godkännande genom godkann_leverabel, retur utan handling och överlämningar före 0099.';
