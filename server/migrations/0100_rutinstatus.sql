-- Story 14.1 (FR-13, Davids svar 2026-10-07: «Det räcker enligt din
-- rekommendation»): ett rutinmässigt statusbyte registreras ur sin
-- källhändelse utan fråga.
--
-- Historiken får fyra kolumner: vem som registrerade raden (`registrerad_av`,
-- en människa eller rutinregeln), vilken källhändelse den registrerades ur
-- (`kallhandelse_typ`), källhändelsens stabila nyckel (`kallhandelse_ref`) och
-- godkännandets avsändare som källan anger den (`kallhandelse_aktor`). Ett
-- villkor binder dem till tre tillåtna former, så att en rutinrad aldrig bär en
-- mänsklig signatur och en människorad aldrig saknar en, också förbi
-- tjänstelagret. Ett unikt index gör att samma källhändelse aldrig
-- registreras två gånger för samma leverabel.
--
-- Befintliga rader får `manniska`, vilket är sant om dem: varje rad som
-- tjänsterna skrivit bär `bekraftat_av`. Inga rader skrivs om, och
-- rättigheterna är orörda (rollen `app` har fortfarande bara SELECT och INSERT
-- på tabellen, 0068). En rad utan `bekraftat_av` kan bara ha riggats för hand;
-- då fäller villkoret migrationen högt i stället för att lämna en rad det
-- förbjuder.

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
  -- Källans aktör finns om och endast om källhändelsen är ett godkännande.
  -- NULL i typen kräver alltså NULL i aktören.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uppdrag_leverabel_handelse_kallhandelse_aktor_check') THEN
    ALTER TABLE uppdrag_leverabel_handelse ADD CONSTRAINT uppdrag_leverabel_handelse_kallhandelse_aktor_check
      CHECK ((kallhandelse_typ IS NOT DISTINCT FROM 'godkannande') = (kallhandelse_aktor IS NOT NULL));
  END IF;
  -- Exakt tre former: de tre människospärrade åtgärderna, Davids ja på ett
  -- förslag (källhändelsen och handlingen kvar), och rutinvägen.
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

-- Gäller rutinrader och Davids ja gemensamt. Människorader utan källhändelse
-- har NULL i båda kolumnerna och krockar därför aldrig.
CREATE UNIQUE INDEX IF NOT EXISTS uppdrag_leverabel_handelse_kallhandelse_uk
  ON uppdrag_leverabel_handelse (leverabel_id, kallhandelse_typ, kallhandelse_ref);

COMMENT ON COLUMN uppdrag_leverabel_handelse.registrerad_av IS
  'Vem som registrerade raden: en människa (manniska) med bekraftat_av, också när människan sagt ja till en källhändelse, eller rutinregeln (system, FR-13) utan bekraftat_av. Källans aktör tillskrivs aldrig registreringen.';
COMMENT ON COLUMN uppdrag_leverabel_handelse.kallhandelse_typ IS
  'Källhändelsen raden registrerades ur (transmittal eller godkannande). NULL för rader som de tre människospärrade åtgärderna skrivit.';
COMMENT ON COLUMN uppdrag_leverabel_handelse.kallhandelse_ref IS
  'Källhändelsens stabila nyckel, sort och kanoniskt id (till exempel mejl:<message-id>). Ingen källhändelse registreras två gånger för samma leverabel.';
COMMENT ON COLUMN uppdrag_leverabel_handelse.kallhandelse_aktor IS
  'Godkännandets avsändare som källan anger den. En källuppgift, aldrig en signatur eller mottagare. Satt om och endast om kallhandelse_typ är godkannande.';
-- 0099:s text blir osann för rutinvägens godkännande, som bär handlingen. En
-- körd migration ändras aldrig, så kommentaren skrivs om här.
COMMENT ON COLUMN uppdrag_leverabel_handelse.referens_id IS
  'Handlingen som överlämningen eller returen registrerades ur, som rad i uppdrag_referens. Överlämningsdatumet läses ur referensens händelsedatum och kopieras aldrig hit. Satt för varje rad som registrerats ur en källhändelse, av rutinvägen eller genom Davids ja, också godkännandet. NULL för påbörjande, godkännande genom godkann_leverabel, retur utan handling och överlämningar före 0099.';
