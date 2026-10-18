-- B-15, FR-10, FR-26 och FR-36: en referens ar overifierad tills svepet
-- sagt annat; kallhandelsens datum och revision skiljs fran lankningstiden.
-- Bakatkompatibel med koden fore 3.1, som skrev 'levande' uttryckligen.

DO $$
DECLARE
  antal integer;
  exempel text;
BEGIN
  WITH kanoniska AS (
    SELECT company_id, contract_id,
           CASE WHEN extern_id ~ '^\s*<.*>\s*$'
             THEN btrim(substring(btrim(extern_id) from 2 for length(btrim(extern_id)) - 2))
             ELSE btrim(extern_id) END AS k
      FROM uppdrag_referens r
     WHERE sort = 'mejl'
       AND NOT EXISTS (SELECT 1 FROM contracts c JOIN projects p ON p.id = c.project_id
                        WHERE c.id = r.contract_id AND p.status = 'closed')
  ), krockar AS (
    SELECT company_id, contract_id, k FROM kanoniska
     WHERE k ~ '^[^\s<>@]+@[^\s<>@]+$'
     GROUP BY company_id, contract_id, k HAVING count(*) > 1
  )
  SELECT count(*)::int,
         (SELECT string_agg(x.k, ', ' ORDER BY x.k)
            FROM (SELECT k FROM krockar ORDER BY k LIMIT 5) x)
    INTO antal, exempel FROM krockar;
  IF antal > 0 THEN
    RAISE EXCEPTION 'driftfel fore 0086: % kollision(er) i uppdrag_referens efter kanonisering (id: %) - ratta mejlreferenserna och kor igen', antal, exempel;
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
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uppdrag_referens_revision_bara_drive'
                   AND conrelid = 'uppdrag_referens'::regclass) THEN
    ALTER TABLE uppdrag_referens ADD CONSTRAINT uppdrag_referens_revision_bara_drive
      CHECK (revision IS NULL OR (sort = 'drive' AND revision >= 0));
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION fryser_referensens_revision() RETURNS trigger LANGUAGE plpgsql AS $$
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
    ELSE btrim(extern_id) END AS k
    FROM uppdrag_referens r
   WHERE sort = 'mejl'
     AND NOT EXISTS (SELECT 1 FROM contracts c JOIN projects p ON p.id = c.project_id
                      WHERE c.id = r.contract_id AND p.status = 'closed')
)
UPDATE uppdrag_referens r SET extern_id = k.k FROM kanoniska k
 WHERE r.id = k.id AND r.extern_id IS DISTINCT FROM k.k AND k.k ~ '^[^\s<>@]+@[^\s<>@]+$';

COMMENT ON COLUMN uppdrag_referens.status IS 'Svepets senast kanda utfall; overifierad tills referensen har observerats.';
COMMENT ON COLUMN uppdrag_referens.handelse_datum IS 'Kallhandelsens datum ur Hermes lasning, aldrig lankningstiden.';
COMMENT ON COLUMN uppdrag_referens.revision IS 'Drive-revision fryst vid lankningen; skrivs aldrig over, inte heller fran NULL.';
COMMENT ON TABLE uppdrag_referens IS 'Kategori: REFERENS. Identitet, kalla, datum och status for filer, kalenderposter och mejl; aldrig innehall eller URL. Overifierad tills svepet sagt annat. Utanfor sparrmappen visas inte som registerdokument; revision fryses vid lankningen.';
