-- B-15, FR-10, FR-26 och FR-36: skilj overifierat fran verifierat, bevara
-- kallhandelsens datum och frys revisionen vid lankningen. Bakatkompatibel
-- med koden fore 3.1: skapaReferens skrev 'levande' uttryckligen.
-- Kantkontrollen kor fore varje andring. En krock ar driftens arbete.
DO $$
DECLARE
  antal integer;
  exempel text;
BEGIN
  WITH kanoniska AS (
    SELECT r.company_id, r.contract_id,
           CASE WHEN r.extern_id ~ '^\s*<.*>\s*$'
             THEN btrim(substring(btrim(r.extern_id) from 2 for length(btrim(r.extern_id)) - 2))
             ELSE btrim(r.extern_id) END AS mejl_id
      FROM uppdrag_referens r
     WHERE r.sort = 'mejl'
       AND NOT EXISTS (SELECT 1 FROM contracts c JOIN projects p ON p.id = c.project_id
                        WHERE c.id = r.contract_id AND p.status = 'closed')
  ), krockar AS (
    SELECT company_id, contract_id, mejl_id
      FROM kanoniska WHERE mejl_id ~ '^[^\s<>@]+@[^\s<>@]+$'
     GROUP BY company_id, contract_id, mejl_id HAVING count(*) > 1
  )
  SELECT count(*)::int,
         (SELECT string_agg(x.mejl_id, ', ' ORDER BY x.mejl_id)
            FROM (SELECT mejl_id FROM krockar ORDER BY mejl_id LIMIT 5) x)
    INTO antal, exempel FROM krockar;
  IF antal > 0 THEN
    RAISE EXCEPTION 'driftfel fore 0086: % kollision(er) i uppdrag_referens vid kanoniskt mejl-id (id: %) - driften rattar krockarna och kor migrationen igen', antal, exempel;
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

-- Historik i avslutade uppdrag rors aldrig (FR-8).
UPDATE uppdrag_referens r SET status = 'overifierad'
 WHERE r.status = 'levande' AND r.senast_verifierad IS NULL
   AND NOT EXISTS (SELECT 1 FROM contracts c JOIN projects p ON p.id = c.project_id
                    WHERE c.id = r.contract_id AND p.status = 'closed');
WITH kanoniska AS (
  SELECT r.id,
         CASE WHEN r.extern_id ~ '^\s*<.*>\s*$'
           THEN btrim(substring(btrim(r.extern_id) from 2 for length(btrim(r.extern_id)) - 2))
           ELSE btrim(r.extern_id) END AS mejl_id
    FROM uppdrag_referens r
   WHERE r.sort = 'mejl'
     AND NOT EXISTS (SELECT 1 FROM contracts c JOIN projects p ON p.id = c.project_id
                      WHERE c.id = r.contract_id AND p.status = 'closed')
)
UPDATE uppdrag_referens r SET extern_id = k.mejl_id
  FROM kanoniska k WHERE r.id = k.id AND r.extern_id IS DISTINCT FROM k.mejl_id
    AND k.mejl_id ~ '^[^\s<>@]+@[^\s<>@]+$';

COMMENT ON COLUMN uppdrag_referens.status IS 'Overifierad tills svepet bedomt referensen; utanfor_sparr kommer ur svepets sparrdom.';
COMMENT ON COLUMN uppdrag_referens.handelse_datum IS 'Kallhandelsens datum ur Hermes lasning, aldrig lankningstid.';
COMMENT ON COLUMN uppdrag_referens.revision IS 'Drive-revision fryst vid lankningen; andras aldrig, inte heller fran NULL.';
COMMENT ON TABLE uppdrag_referens IS 'Kategori: REFERENS. Id, nyckel och kalla till filer, kalenderposter och mejl; aldrig innehall. Ny referens ar overifierad. Svepet satter lage, lastid och handelse_datum; revision fryses vid lankningen. Utanfor sparrmappen visas aldrig som registerdokument.';
