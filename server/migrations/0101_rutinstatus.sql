-- Story 14.1 (FR-13, Davids svar 2026-10-07: «Det räcker enligt din
-- rekommendation»): ett rutinmässigt statusbyte registreras ur sin källhändelse.
--
-- Händelsetabellen får veta vem som registrerade raden och ur vilken
-- källhändelse. Fram till nu skrevs varje rad av en av de tre
-- människospärrade åtgärderna, och `bekraftat_av` var alltid satt. Rutinvägen
-- (`registrera_rutinstatus`) registrerar det regeln i lib/rutinregel.ts medger
-- utan att någon människa bekräftar, och då finns ingen att skriva i
-- `bekraftat_av`. Källans mänskliga aktör, godkännandets avsändare, är en
-- källuppgift och tillskrivs aldrig registreringen.
--
-- Filen skapar fyra kolumner (`registrerad_av`, `kallhandelse_typ`,
-- `kallhandelse_ref`, `kallhandelse_aktor`), fyra CHECK-villkor och det unika
-- indexet `uppdrag_leverabel_handelse_kallhandelse_uk`, och skriver om
-- kolumnkommentaren på `referens_id`. Registreringsvillkoret har exakt tre
-- tillåtna former och gäller också förbi tjänstelagret:
--   * en människas rad utan källhändelse (de tre människospärrade åtgärderna);
--   * en människas rad med källhändelse och referens (Davids ja på ett förslag);
--   * en systemrad utan `bekraftat_av`, med källhändelse och referens (rutinvägen).
--
-- Befintliga rader får `manniska`, vilket är sant om dem: varje rad som
-- tjänsterna har skrivit bär `bekraftat_av`. En rad utan den kan bara ha
-- riggats för hand, och då fäller villkoret migrationen högt i stället för att
-- lämna en rad som villkoret förbjuder. Inga rader skrivs om, ingen
-- tabellkommentar ändras, och rättigheterna är orörda: `app` har fortfarande
-- bara SELECT och INSERT på tabellen (0068). Andra körningen är ett no-op.

ALTER TABLE uppdrag_leverabel_handelse
  ADD COLUMN IF NOT EXISTS registrerad_av text NOT NULL DEFAULT 'manniska';
ALTER TABLE uppdrag_leverabel_handelse ADD COLUMN IF NOT EXISTS kallhandelse_typ text;
ALTER TABLE uppdrag_leverabel_handelse ADD COLUMN IF NOT EXISTS kallhandelse_ref text;
ALTER TABLE uppdrag_leverabel_handelse ADD COLUMN IF NOT EXISTS kallhandelse_aktor text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uppdrag_leverabel_handelse_registrerad_av_check') THEN
    ALTER TABLE uppdrag_leverabel_handelse ADD CONSTRAINT uppdrag_leverabel_handelse_registrerad_av_check
      CHECK (registrerad_av IN ('manniska', 'system'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uppdrag_leverabel_handelse_kallhandelse_typ_check') THEN
    ALTER TABLE uppdrag_leverabel_handelse ADD CONSTRAINT uppdrag_leverabel_handelse_kallhandelse_typ_check
      CHECK (kallhandelse_typ IS NULL OR kallhandelse_typ IN ('transmittal', 'godkannande'));
  END IF;
  -- Källans aktör finns bara för godkännandet, och där alltid.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uppdrag_leverabel_handelse_kallhandelse_aktor_check') THEN
    ALTER TABLE uppdrag_leverabel_handelse ADD CONSTRAINT uppdrag_leverabel_handelse_kallhandelse_aktor_check
      CHECK ((kallhandelse_typ IS NOT DISTINCT FROM 'godkannande') = (kallhandelse_aktor IS NOT NULL));
  END IF;
  -- NULL i `bekraftat_av` bara för systemet, och systemet bara med källan.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uppdrag_leverabel_handelse_registrering_check') THEN
    ALTER TABLE uppdrag_leverabel_handelse ADD CONSTRAINT uppdrag_leverabel_handelse_registrering_check
      CHECK (
        (registrerad_av = 'manniska' AND bekraftat_av IS NOT NULL
          AND kallhandelse_typ IS NULL AND kallhandelse_ref IS NULL)
        OR (registrerad_av = 'manniska' AND bekraftat_av IS NOT NULL
          AND kallhandelse_typ IS NOT NULL AND kallhandelse_ref IS NOT NULL AND referens_id IS NOT NULL)
        OR (registrerad_av = 'system' AND bekraftat_av IS NULL
          AND kallhandelse_typ IS NOT NULL AND kallhandelse_ref IS NOT NULL AND referens_id IS NOT NULL)
      );
  END IF;
END
$$;

-- Samma källhändelse registreras aldrig två gånger för samma leverabel, oavsett
-- om rutinvägen eller Davids ja skrev raden. Rader utan källhändelse har NULL i
-- båda kolumnerna och krockar därför aldrig.
CREATE UNIQUE INDEX IF NOT EXISTS uppdrag_leverabel_handelse_kallhandelse_uk
  ON uppdrag_leverabel_handelse (leverabel_id, kallhandelse_typ, kallhandelse_ref);

COMMENT ON COLUMN uppdrag_leverabel_handelse.registrerad_av IS
  'Vem som registrerade raden: en människa, med bekraftat_av, också när människan sagt ja till en källhändelse, eller rutinregeln (FR-13), utan bekraftat_av. Källans aktör tillskrivs aldrig registreringen.';
COMMENT ON COLUMN uppdrag_leverabel_handelse.kallhandelse_typ IS
  'Källhändelsen raden registrerades ur: transmittal eller godkannande. NULL för rader som de tre människospärrade åtgärderna skrivit.';
COMMENT ON COLUMN uppdrag_leverabel_handelse.kallhandelse_ref IS
  'Källhändelsens stabila nyckel, sort och kanoniskt id. Ingen källhändelse registreras två gånger för samma leverabel.';
COMMENT ON COLUMN uppdrag_leverabel_handelse.kallhandelse_aktor IS
  'Godkännandets avsändare som källan anger den. En källuppgift, aldrig en signatur eller mottagare.';
COMMENT ON COLUMN uppdrag_leverabel_handelse.referens_id IS
  'Handlingen som överlämningen eller returen registrerades ur, som rad i uppdrag_referens. Överlämningsdatumet läses ur referensens händelsedatum och kopieras aldrig hit. Satt för varje rad som registrerats ur en källhändelse, av rutinvägen eller genom Davids ja, också godkännandet. NULL för påbörjande, godkännande genom godkann_leverabel, retur utan handling och överlämningar före 0099.';
