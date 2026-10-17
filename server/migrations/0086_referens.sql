-- 0086 — Referensen är overifierad tills svepet sagt annat (Story 3.1).
--
-- B-15, FR-10, FR-26, FR-36. En referens som ingen verifierat är ett påstående,
-- inte ett faktum, och den får aldrig visas som `levande`. Två nya lägen och två
-- nya kolumner:
--
--   * `overifierad` (ny standard) — ingen har ännu sett den andra änden.
--   * `utanfor_sparr` — svepets spärrdom: filens förälderkedja ligger utanför
--     uppdragets spärrmapp. Raden visas aldrig som registerdokument.
--   * `handelse_datum` — källhändelsens datum ur Hermes läsning, aldrig
--     länkningstiden. Ingen default, och filen fyller den inte.
--   * `revision` — kontraktsversionens Drive-revision, fryst vid länkningen.
--     En trigger fäller varje UPDATE av kolumnen, för varje roll.
--
-- Filen är additiv och idempotent, och bakåtkompatibel med koden före 3.1:
-- `skapaReferens` skrev `'levande'` uttryckligen, så den nya standarden ändrar
-- inget för den koden. De två rättelserna nedan rör bara öppna uppdrag — 0068:s
-- trigger fäller en skrivning på ett avslutat, och FR-8 skrivskyddar historiken.

-- ---------------------------------------------------------------------------
-- 1) Kantkontroll — FÖRE allt annat (formen ur 0068, 0081 och 0085)
-- ---------------------------------------------------------------------------
-- Rättelse (b) skriver mejlens id utan vinkelparenteser. Två mejlrader i samma
-- avtal som får samma kanoniska id hade fällt `uppdrag_referens_uk` mitt i
-- filen. Bättre att vägra köra och låta driften slå ihop raderna.
DO $$
DECLARE krockar text;
BEGIN
  SELECT string_agg(kanoniskt, ', ') INTO krockar
    FROM (
      SELECT kanoniskt
        FROM (
          SELECT r.company_id, r.contract_id,
                 CASE WHEN r.extern_id ~ '^\s*<.*>\s*$'
                      THEN btrim(substring(btrim(r.extern_id) from 2 for length(btrim(r.extern_id)) - 2))
                      ELSE btrim(r.extern_id) END AS kanoniskt
            FROM uppdrag_referens r
           WHERE r.sort = 'mejl'
             AND NOT EXISTS (SELECT 1 FROM contracts c JOIN projects p ON p.id = c.project_id
                              WHERE c.id = r.contract_id AND p.status = 'closed')
        ) k
       GROUP BY company_id, contract_id, kanoniskt
      HAVING count(*) > 1
       ORDER BY kanoniskt
       LIMIT 5
    ) d;
  IF krockar IS NOT NULL THEN
    RAISE EXCEPTION 'driftfel fore 0086: uppdrag_referens har mejlrader i samma avtal som far samma kanoniska Message-ID (%) — sla ihop raderna och kor om', krockar;
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 2) Lägena
-- ---------------------------------------------------------------------------
ALTER TABLE uppdrag_referens DROP CONSTRAINT IF EXISTS uppdrag_referens_status_check;
ALTER TABLE uppdrag_referens ADD CONSTRAINT uppdrag_referens_status_check
  CHECK (status IN ('overifierad', 'levande', 'drift', 'trasig', 'utanfor_sparr'));
ALTER TABLE uppdrag_referens ALTER COLUMN status SET DEFAULT 'overifierad';

-- ---------------------------------------------------------------------------
-- 3) Kolumnerna
-- ---------------------------------------------------------------------------
ALTER TABLE uppdrag_referens ADD COLUMN IF NOT EXISTS handelse_datum date;
ALTER TABLE uppdrag_referens ADD COLUMN IF NOT EXISTS revision bigint;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uppdrag_referens_revision_bara_drive') THEN
    ALTER TABLE uppdrag_referens ADD CONSTRAINT uppdrag_referens_revision_bara_drive
      CHECK (revision IS NULL OR (sort = 'drive' AND revision >= 0));
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 4) Frysningen
-- ---------------------------------------------------------------------------
-- Också från NULL: revisionen skrivs en gång, vid länkningen (INSERT). En
-- revision som kunde fyllas i efteråt hade kunnat bli den nya versionens, och
-- då hade den frysta versionsreferensen bytts i tysthet.
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

-- ---------------------------------------------------------------------------
-- 5) Rättelserna av befintliga rader, bara i öppna uppdrag
-- ---------------------------------------------------------------------------
-- (a) En `levande` rad som aldrig verifierats har aldrig verifierats (FR-10).
UPDATE uppdrag_referens r
   SET status = 'overifierad'
 WHERE r.status = 'levande'
   AND r.senast_verifierad IS NULL
   AND NOT EXISTS (SELECT 1 FROM contracts c JOIN projects p ON p.id = c.project_id
                    WHERE c.id = r.contract_id AND p.status = 'closed');

-- (b) Mejlens id i den kanoniska formen, utan vinkelparenteser. Samma regel som
-- `kanonisktReferensId` och `referensFormFel` i `lib/referens.ts`: bara när det
-- kanoniska id:t har formen id-left@id-right.
UPDATE uppdrag_referens r
   SET extern_id = k.kanoniskt
  FROM (
    SELECT id,
           CASE WHEN extern_id ~ '^\s*<.*>\s*$'
                THEN btrim(substring(btrim(extern_id) from 2 for length(btrim(extern_id)) - 2))
                ELSE btrim(extern_id) END AS kanoniskt
      FROM uppdrag_referens
     WHERE sort = 'mejl'
  ) k
 WHERE r.id = k.id
   AND r.extern_id <> k.kanoniskt
   AND k.kanoniskt ~ '^[^\s<>@]+@[^\s<>@]+$'
   AND NOT EXISTS (SELECT 1 FROM contracts c JOIN projects p ON p.id = c.project_id
                    WHERE c.id = r.contract_id AND p.status = 'closed');

-- ---------------------------------------------------------------------------
-- 6) Kommentarerna
-- ---------------------------------------------------------------------------
COMMENT ON COLUMN uppdrag_referens.status IS
  'overifierad tills svepet sagt annat (FR-10). levande/drift/trasig ur svepets jämförelse med värdena vid länkningen, utanfor_sparr ur svepets spärrdom.';
COMMENT ON COLUMN uppdrag_referens.handelse_datum IS
  'Källhändelsens datum ur Hermes läsning (kor_uppdragssvep), aldrig länkningstiden. NULL = datum saknas.';
COMMENT ON COLUMN uppdrag_referens.revision IS
  'Kontraktsversionens Drive-revision, fryst vid länkningen. Skrivs aldrig om (trigger uppdrag_referens_fryser_revision).';
COMMENT ON TABLE uppdrag_referens IS
  'Kategori: REFERENS. Pekare till filer, kalenderposter och mejl i deras källsystem — bara identitet, källa, datum och status; innehållet dupliceras aldrig hit. status overifierad = ingen har sett den andra änden, drift/trasig = den har ändrats eller försvunnit, utanfor_sparr = filen ligger utanför spärrmappen.';
