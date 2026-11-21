-- B-15, FR-10, FR-26 och FR-36: overifierat skiljs fran verifierat,
-- kallhandelsens datum lagras och versionens revision fryses vid lankningen.
-- Bakatkompatibel med koden fore 3.1: skapaReferens skrev 'levande' uttryckligen.

-- Kantkontrollen provar exakt de oppna mejlrader som rattelsen kan skriva om.
DO $$
DECLARE
  antal integer;
  exempel text;
BEGIN
  WITH kanoniska AS (
    SELECT company_id, contract_id,
           CASE WHEN extern_id ~ '^\s*<.*>\s*$'
             THEN btrim(substring(btrim(extern_id) from 2 for length(btrim(extern_id)) - 2))
             ELSE btrim(extern_id) END AS kanoniskt_id
      FROM uppdrag_referens r
     WHERE sort = 'mejl'
       AND NOT EXISTS (SELECT 1 FROM contracts c JOIN projects p ON p.id = c.project_id
                        WHERE c.id = r.contract_id AND p.status = 'closed')
  ), krockar AS (
    SELECT company_id, contract_id, kanoniskt_id
      FROM kanoniska
     WHERE kanoniskt_id ~ '^[^\s<>@]+@[^\s<>@]+$'
     GROUP BY company_id, contract_id, kanoniskt_id HAVING count(*) > 1
  )
  SELECT count(*)::int,
         (SELECT string_agg(x.kanoniskt_id, ', ' ORDER BY x.kanoniskt_id)
            FROM (SELECT kanoniskt_id FROM krockar ORDER BY kanoniskt_id LIMIT 5) x)
    INTO antal, exempel FROM krockar;
  IF antal > 0 THEN
    RAISE EXCEPTION 'driftfel fore 0093: % kollision(er) i uppdrag_referens vid kanoniskt mejl-id (id: %) - driften rattar kollisionerna och kor migrationen igen', antal, exempel;
  END IF;
END
$$;

ALTER TABLE uppdrag_referens DROP CONSTRAINT IF EXISTS uppdrag_referens_status_check;
ALTER TABLE uppdrag_referens ADD CONSTRAINT uppdrag_referens_status_check
  CHECK (status IN ('overifierad', 'levande', 'drift', 'trasig', 'utanfor_sparr'));
ALTER TABLE uppdrag_referens ALTER COLUMN status SET DEFAULT 'overifierad';

ALTER TABLE uppdrag_referens ADD COLUMN IF NOT EXISTS handelse_datum date;
ALTER TABLE uppdrag_referens ADD COLUMN IF NOT EXISTS revision bigint;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'uppdrag_referens'::regclass
                    AND conname = 'uppdrag_referens_revision_bara_drive') THEN
    ALTER TABLE uppdrag_referens ADD CONSTRAINT uppdrag_referens_revision_bara_drive
      CHECK (revision IS NULL OR (sort = 'drive' AND revision >= 0));
  END IF;
END
$$;

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
CREATE TRIGGER uppdrag_referens_fryser_revision BEFORE UPDATE ON uppdrag_referens
  FOR EACH ROW EXECUTE FUNCTION fryser_referensens_revision();

UPDATE uppdrag_referens r SET status = 'overifierad'
 WHERE status = 'levande' AND senast_verifierad IS NULL
   AND NOT EXISTS (SELECT 1 FROM contracts c JOIN projects p ON p.id = c.project_id
                    WHERE c.id = r.contract_id AND p.status = 'closed');

WITH kanoniska AS (
  SELECT id, CASE WHEN extern_id ~ '^\s*<.*>\s*$'
    THEN btrim(substring(btrim(extern_id) from 2 for length(btrim(extern_id)) - 2))
    ELSE btrim(extern_id) END AS kanoniskt_id
    FROM uppdrag_referens r
   WHERE sort = 'mejl'
     AND NOT EXISTS (SELECT 1 FROM contracts c JOIN projects p ON p.id = c.project_id
                      WHERE c.id = r.contract_id AND p.status = 'closed')
)
UPDATE uppdrag_referens r SET extern_id = k.kanoniskt_id FROM kanoniska k
 WHERE r.id = k.id AND r.extern_id IS DISTINCT FROM k.kanoniskt_id
   AND k.kanoniskt_id ~ '^[^\s<>@]+@[^\s<>@]+$';

COMMENT ON COLUMN uppdrag_referens.status IS
  'Overifierad tills svepet sagt annat. Utanfor_sparr kommer ur svepets sparrdom och visas inte som registerdokument.';
COMMENT ON COLUMN uppdrag_referens.handelse_datum IS
  'Kallhandelsens datum ur Hermes lasning, aldrig lankningstiden. NULL betyder datum saknas.';
COMMENT ON COLUMN uppdrag_referens.revision IS
  'Drive-versionens revision vid lankningen, oforanderlig ocksa fran NULL. Annan observerad revision ger drift.';
COMMENT ON TABLE uppdrag_referens IS
  'Kategori: REFERENS. Bara identitet, kalla, datum och status, aldrig kallans innehall eller adress. Ny rad ar overifierad; svepet verifierar. Revision fryses vid lankningen.';
