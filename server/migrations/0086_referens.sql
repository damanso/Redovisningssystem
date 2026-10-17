-- B-15, FR-10, FR-26, FR-36 (Story 3.1): en referens är overifierad tills
-- svepet sagt annat, och bär händelsedatum och fryst revision.
--
-- 0068 lät en ny referens födas `levande` — ett påstående om den andra änden
-- som ingen kontrollerat. Sedan den här filen är `overifierad` standard, och
-- bara svepets verifiering (`verifieraReferens`) sätter något annat. Svepets
-- spärrdom får ett eget läge, `utanfor_sparr`, så att en fil utanför kundens
-- spärrmapp aldrig visas som registerdokument.
--
-- Två kolumner tillkommer, båda nullbara och utan default:
--   * `handelse_datum` — källhändelsens datum ur Hermes läsning, aldrig ur
--     länkningstiden. Filen fyller den inte: ett datum som ingen läst är ett
--     påhittat datum.
--   * `revision` — kontraktsversionens Drive-revision, fryst vid länkningen.
--     Triggern nedan fäller varje UPDATE av kolumnen, också från NULL och för
--     varje roll, så att den frysta versionen aldrig byts i tysthet.
--
-- Filen är bakåtkompatibel med koden före 3.1: `skapaReferens` skrev
-- `'levande'` uttryckligen, och det värdet är fortsatt giltigt.
--
-- Rättelserna rör bara rader i uppdrag som inte är avslutade: 0068:s trigger
-- fäller en skrivning där, och FR-8 skrivskyddar historiken. Kantkontrollen
-- (samma form som 0078 och 0085) fäller före varje ändring om två mejlrader
-- skulle få samma kanoniska Message-ID. Krocken är driftens arbete — aldrig en
-- fråga till David.

-- 1) Kantkontroll: två mejlrader med samma kanoniska Message-ID i ett öppet uppdrag
DO $$
DECLARE
  antal   integer;
  exempel text;
BEGIN
  WITH kanon AS (
    SELECT r.company_id, r.contract_id, r.extern_id,
           CASE WHEN r.extern_id ~ '^\s*<.*>\s*$'
                THEN btrim(substring(btrim(r.extern_id) from 2 for length(btrim(r.extern_id)) - 2))
                ELSE btrim(r.extern_id) END AS kanoniskt
      FROM uppdrag_referens r
     WHERE r.sort = 'mejl'
       AND NOT EXISTS (SELECT 1 FROM contracts c JOIN projects p ON p.id = c.project_id
                        WHERE c.id = r.contract_id AND p.status = 'closed')
  ), krockar AS (
    SELECT k.extern_id
      FROM kanon k
     WHERE (SELECT count(*) FROM kanon o
             WHERE o.company_id = k.company_id AND o.contract_id = k.contract_id
               AND o.kanoniskt = k.kanoniskt) > 1
  )
  SELECT count(*)::int,
         (SELECT string_agg(x.extern_id, ', ' ORDER BY x.extern_id)
            FROM (SELECT extern_id FROM krockar ORDER BY extern_id LIMIT 5) x)
    INTO antal, exempel
    FROM krockar;
  IF antal > 0 THEN
    RAISE EXCEPTION 'driftfel fore 0086: % mejlrad(er) i uppdrag_referens far samma kanoniska Message-ID (extern_id: %) — driften slar ihop dubbletterna och kor migrationen igen',
      antal, exempel;
  END IF;
END
$$;

-- 2) Statusen: fem lägen, overifierad som standard
ALTER TABLE uppdrag_referens DROP CONSTRAINT IF EXISTS uppdrag_referens_status_check;
ALTER TABLE uppdrag_referens
  ADD CONSTRAINT uppdrag_referens_status_check
  CHECK (status IN ('overifierad', 'levande', 'drift', 'trasig', 'utanfor_sparr'));
ALTER TABLE uppdrag_referens ALTER COLUMN status SET DEFAULT 'overifierad';

-- 3) Kolumnerna
ALTER TABLE uppdrag_referens ADD COLUMN IF NOT EXISTS handelse_datum date;
ALTER TABLE uppdrag_referens ADD COLUMN IF NOT EXISTS revision bigint;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uppdrag_referens_revision_bara_drive') THEN
    ALTER TABLE uppdrag_referens
      ADD CONSTRAINT uppdrag_referens_revision_bara_drive
      CHECK (revision IS NULL OR (sort = 'drive' AND revision >= 0));
  END IF;
END
$$;

-- 4) Frysningen: revisionen skrivs vid länkningen och aldrig igen
CREATE OR REPLACE FUNCTION fryser_referensens_revision() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.revision IS DISTINCT FROM OLD.revision THEN
    RAISE EXCEPTION 'revision pa uppdrag_referens ar fryst vid lankningen och skrivs aldrig om';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS uppdrag_referens_fryser_revision ON uppdrag_referens;
CREATE TRIGGER uppdrag_referens_fryser_revision
  BEFORE UPDATE ON uppdrag_referens
  FOR EACH ROW EXECUTE FUNCTION fryser_referensens_revision();

-- 5) Rättelserna av befintliga rader, bara i uppdrag som inte är avslutade
-- (a) En levande rad som aldrig verifierats har aldrig varit verifierad (FR-10).
UPDATE uppdrag_referens r
   SET status = 'overifierad'
 WHERE r.status = 'levande' AND r.senast_verifierad IS NULL
   AND NOT EXISTS (SELECT 1 FROM contracts c JOIN projects p ON p.id = c.project_id
                    WHERE c.id = r.contract_id AND p.status = 'closed');

-- (b) Ett Message-ID lagras utan vinkelparenteser, samma regel som
--     `kanonisktReferensId` och `referensFormFel` i lib/referens.ts.
UPDATE uppdrag_referens r
   SET extern_id = k.kanoniskt
  FROM (SELECT id,
               CASE WHEN extern_id ~ '^\s*<.*>\s*$'
                    THEN btrim(substring(btrim(extern_id) from 2 for length(btrim(extern_id)) - 2))
                    ELSE btrim(extern_id) END AS kanoniskt
          FROM uppdrag_referens WHERE sort = 'mejl') k
 WHERE r.id = k.id
   AND r.sort = 'mejl'
   AND r.extern_id <> k.kanoniskt
   AND k.kanoniskt ~ '^[^\s<>@]+@[^\s<>@]+$'
   AND NOT EXISTS (SELECT 1 FROM contracts c JOIN projects p ON p.id = c.project_id
                    WHERE c.id = r.contract_id AND p.status = 'closed');

-- 6) Kommentarerna
COMMENT ON COLUMN uppdrag_referens.status IS
  'overifierad = ingen verifiering ännu (standard). levande = svepet såg änden oförändrad. drift = titel, hash eller revision skiljer sig från länkningen. trasig = änden har försvunnit. utanfor_sparr = svepets dom: filen ligger utanför uppdragets spärrmapp, och läget står kvar tills en dom innanför kommer. Sätts bara av svepets verifiering.';

COMMENT ON COLUMN uppdrag_referens.handelse_datum IS
  'Källhändelsens datum ur Hermes läsning av mejlet, kalenderposten eller filen — aldrig länkningstiden. NULL = datum saknas, och vyn säger det.';

COMMENT ON COLUMN uppdrag_referens.revision IS
  'Kontraktsversionens Drive-revision, fryst vid länkningen. Bara för drive. Triggern uppdrag_referens_fryser_revision fäller varje ändring; en annan revision i svepet ger drift, aldrig en tyst omskrivning.';

COMMENT ON TABLE uppdrag_referens IS
  'Kategori: REFERENS. Pekare till filer, kalenderposter och mejl i deras källsystem — bara identitet, källa, datum och status; innehållet dupliceras aldrig hit. En ny referens är overifierad tills svepet sagt annat; drift/trasig = den andra änden har ändrats eller försvunnit; utanfor_sparr = svepets spärrdom.';
