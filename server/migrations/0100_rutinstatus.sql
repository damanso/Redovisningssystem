-- Story 14.1 (FR-13, Davids svar 2026-10-07): ett rutinmässigt statusbyte
-- registreras ur sin källhändelse utan fråga.
--
-- Den fjärde skrivvägen (`registrera_rutinstatus`) registrerar ett byte som
-- regeln i lib/rutinregel.ts medger, och då har raden ingen människa som
-- bekräftare. Davids ja på ett förslag som regeln höll tillbaka
-- (`bekrafta_rutinforslag`) bär hans namn och samma källhändelse. Filen gör
-- skillnaden synlig och bindande i databasen, också förbi tjänstelagret:
--
--   1. `registrerad_av` (manniska | system), med standardvärdet manniska;
--   2. `kallhandelse_typ` (transmittal | godkannande);
--   3. `kallhandelse_ref`, källhändelsens stabila nyckel;
--   4. `kallhandelse_aktor`, godkännandets avsändare som källan anger den,
--      satt om och endast om källhändelsen är ett godkännande;
--   5. villkoret `uppdrag_leverabel_handelse_registrering_check` med exakt tre
--      tillåtna former: människan utan källhändelse (de tre människospärrade
--      åtgärderna), människan med källhändelse och referens (Davids ja), och
--      systemet utan bekräftare men med källhändelse och referens (rutinvägen);
--   6. det unika indexet `uppdrag_leverabel_handelse_kallhandelse_uk`, så att
--      samma källhändelse aldrig registreras två gånger för en leverabel;
--   7. kolumnkommentarer, och en omskriven kommentar på `referens_id`.
--
-- Befintliga rader får `manniska`, vilket är sant om dem: bara de tre
-- människospärrade åtgärderna har skrivit i tabellen, och alla tre sätter
-- `bekraftat_av`. Villkoret prövar de befintliga raderna; en rad utan
-- bekräftare kan bara ha riggats för hand, och då fäller migrationen högt i
-- stället för att lämna en rad som villkoret förbjuder. Inga rader skrivs om,
-- ingen tabellkommentar ändras och rättigheterna är orörda: rollen `app` har
-- fortfarande bara SELECT och INSERT (0068).

ALTER TABLE uppdrag_leverabel_handelse ADD COLUMN IF NOT EXISTS registrerad_av text NOT NULL DEFAULT 'manniska';
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
  -- Satt om och endast om källhändelsen är ett godkännande. NULL i typen
  -- kräver NULL i aktören; IS NOT DISTINCT FROM ger aldrig NULL.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uppdrag_leverabel_handelse_kallhandelse_aktor_check') THEN
    ALTER TABLE uppdrag_leverabel_handelse ADD CONSTRAINT uppdrag_leverabel_handelse_kallhandelse_aktor_check
      CHECK ((kallhandelse_typ IS NOT DISTINCT FROM 'godkannande') = (kallhandelse_aktor IS NOT NULL));
  END IF;
  -- Exakt tre former. NULL i bekraftat_av tillåts bara för systemet, och varje
  -- rad med källhändelse bär handlingen som referens.
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

-- Gäller rutinrader och Davids ja gemensamt. Rader utan källhändelse har NULL i
-- båda kolumnerna och krockar därför aldrig.
CREATE UNIQUE INDEX IF NOT EXISTS uppdrag_leverabel_handelse_kallhandelse_uk
  ON uppdrag_leverabel_handelse (leverabel_id, kallhandelse_typ, kallhandelse_ref);

COMMENT ON COLUMN uppdrag_leverabel_handelse.registrerad_av IS
  'Vem som registrerade raden: en människa med bekraftat_av, också när människan sagt ja till en källhändelse, eller rutinregeln (FR-13) utan bekraftat_av. Källans aktör tillskrivs aldrig registreringen.';
COMMENT ON COLUMN uppdrag_leverabel_handelse.kallhandelse_typ IS
  'Vilken källhändelse raden registrerades ur: transmittal eller godkannande. NULL för rader som de tre människospärrade åtgärderna skrivit.';
COMMENT ON COLUMN uppdrag_leverabel_handelse.kallhandelse_ref IS
  'Källhändelsens stabila nyckel, sort och kanoniskt id. Ingen källhändelse registreras två gånger för samma leverabel.';
COMMENT ON COLUMN uppdrag_leverabel_handelse.kallhandelse_aktor IS
  'Godkännandets avsändare som källan anger den. En källuppgift, aldrig en signatur eller mottagare.';

-- 0099 ändras inte (en körd migration ändras aldrig); dess text blir osann för
-- rutinvägens godkännande, som bär handlingen.
COMMENT ON COLUMN uppdrag_leverabel_handelse.referens_id IS
  'Handlingen som överlämningen eller returen registrerades ur, som rad i uppdrag_referens. Överlämningsdatumet läses ur referensens händelsedatum och kopieras aldrig hit. Satt för varje rad som registrerats ur en källhändelse, av rutinvägen eller genom Davids ja, också godkännandet. NULL för påbörjande, godkännande genom godkann_leverabel, retur utan handling och överlämningar före 0099.';
