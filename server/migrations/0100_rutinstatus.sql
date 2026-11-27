-- Story 14.1 (FR-13, Davids svar 2026-10-07: «Det räcker enligt din
-- rekommendation»): ett rutinmässigt statusbyte registreras ur sin källhändelse.
--
-- Rutinvägen är den fjärde skrivvägen in i `uppdrag_leverabel_handelse`. Den
-- registrerar bara det rutinregeln (server/src/lib/rutinregel.ts) medger: ett
-- transmittal ger `levererad`, ett godkännande från avtalets godkännare ger
-- `godkand`. Raden skrivs av regeln, inte av en människa, och får därför ingen
-- mänsklig signatur i `bekraftat_av`. Källans aktör bevaras som källuppgift —
-- handlingen i `referens_id` och, för godkännandet, avtalsparten i `mottagare` —
-- och tillskrivs aldrig registreringen.
--
-- Filen skapar:
--   * `registrerad_av` (manniska | system), NOT NULL med standardvärdet
--     manniska, så att människovägarnas INSERT-satser ger rätt rad utan ändring;
--   * `kallhandelse_typ` (transmittal | godkannande) och `kallhandelse_ref`,
--     källhändelsens stabila nyckel;
--   * villkoret som binder raderna till två former: människan med
--     `bekraftat_av` och utan källhändelse, eller systemet utan `bekraftat_av`
--     och med källhändelse och handling. Villkoret gäller också förbi
--     tjänstelagret, samma skäl som append-only ligger i rättigheterna;
--   * det unika indexet som gör att samma källhändelse aldrig registreras två
--     gånger för samma leverabel;
--   * kolumnkommentarerna, och en ny kommentar på `referens_id`, vars text ur
--     0099 blir osann för rutinvägens godkännande. 0099 ändras inte.
--
-- Befintliga rader får `manniska`, vilket är sant om dem: varje rad tjänsterna
-- skrivit bär `bekraftat_av`. En rad utan det kan bara ha riggats för hand, och
-- då fäller villkoret migrationen högt i stället för att lämna en rad det
-- förbjuder. Inga rader skrivs om, rättigheterna är orörda (app har fortfarande
-- bara SELECT och INSERT) och ingen tabellkommentar ändras. Andra körningen är
-- ett no-op.

ALTER TABLE uppdrag_leverabel_handelse
  ADD COLUMN IF NOT EXISTS registrerad_av text NOT NULL DEFAULT 'manniska';

ALTER TABLE uppdrag_leverabel_handelse
  ADD COLUMN IF NOT EXISTS kallhandelse_typ text;

ALTER TABLE uppdrag_leverabel_handelse
  ADD COLUMN IF NOT EXISTS kallhandelse_ref text;

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
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uppdrag_leverabel_handelse_registrering_check') THEN
    ALTER TABLE uppdrag_leverabel_handelse ADD CONSTRAINT uppdrag_leverabel_handelse_registrering_check
      CHECK (
        (registrerad_av = 'manniska' AND bekraftat_av IS NOT NULL
          AND kallhandelse_typ IS NULL AND kallhandelse_ref IS NULL)
        OR
        (registrerad_av = 'system' AND bekraftat_av IS NULL
          AND kallhandelse_typ IS NOT NULL AND kallhandelse_ref IS NOT NULL AND referens_id IS NOT NULL)
      );
  END IF;
END
$$;

-- Människans rader har NULL i båda kolumnerna och krockar därför aldrig.
CREATE UNIQUE INDEX IF NOT EXISTS uppdrag_leverabel_handelse_kallhandelse_uk
  ON uppdrag_leverabel_handelse (leverabel_id, kallhandelse_typ, kallhandelse_ref);

COMMENT ON COLUMN uppdrag_leverabel_handelse.registrerad_av IS
  'Vem som registrerade raden: manniska (med bekraftat_av) eller system, rutinregeln enligt FR-13 (utan bekraftat_av). Källans aktör tillskrivs aldrig registreringen.';

COMMENT ON COLUMN uppdrag_leverabel_handelse.kallhandelse_typ IS
  'Källhändelsen ur rutinregeln som raden registrerades ur: transmittal eller godkannande. NULL för människans rader.';

COMMENT ON COLUMN uppdrag_leverabel_handelse.kallhandelse_ref IS
  'Källhändelsens stabila nyckel, sort och kanoniskt id (till exempel mejl:<message-id>). Ingen källhändelse registreras två gånger för samma leverabel. NULL för människans rader.';

COMMENT ON COLUMN uppdrag_leverabel_handelse.referens_id IS
  'Handlingen som överlämningen eller returen registrerades ur, som rad i uppdrag_referens. Överlämningsdatumet läses ur referensens händelsedatum och kopieras aldrig hit. Satt för varje rad som rutinvägen registrerat ur en källhändelse, också godkännandet. NULL för påbörjande, människans godkännande, retur utan handling och överlämningar före 0099.';
