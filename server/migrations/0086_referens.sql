-- Uppdragsytan, Story 3.1 (B-15, FR-10, FR-26, FR-36): referensen bär sitt
-- verkliga läge, sitt händelsedatum och sin frysta revision.
--
-- 0068 gav `uppdrag_referens` tre lägen och standardläget 'levande'. Det
-- betyder att en referens som ingen verifierat ser lika säker ut som en som
-- svepet just läst, och FR-10 förbjuder att den behandlas som verifierad.
-- Filen gör fem saker, i den här ordningen:
--
--   1. Kantkontrollen: två mejlrader i samma avtal får aldrig samma kanoniska
--      Message-ID genom rättelsen i punkt 5. Fäller den stannar allt.
--   2. Lägena blir fem: 'overifierad' (ny standard) och 'utanfor_sparr' läggs
--      till. 'utanfor_sparr' sätts bara ur svepets spärrdom.
--   3. Kolumnerna `handelse_datum` (bara ur Hermes läsning av källhändelsen,
--      aldrig ur länkningstiden, och därför utan standardvärde) och `revision`
--      (bara Drive, fryst vid länkningen).
--   4. Frysningen: en trigger fäller varje ändring av `revision`, också från
--      NULL, för varje roll.
--   5. Rättelserna i uppdrag som inte är avslutade: en 'levande' rad som aldrig
--      verifierats blir 'overifierad', och ett mejl-id med vinkelparenteser
--      får sin kanoniska form utan dem (samma regel som `referensFormFel` i
--      `lib/referens.ts`). Avslutade uppdrag rörs inte: 0068:s trigger fäller
--      skrivningen, och historiken är skrivskyddad (FR-8).
--
-- Filen är bakåtkompatibel med koden före Story 3.1: den koden skrev 'levande'
-- uttryckligen vid varje ny referens och läste aldrig de nya kolumnerna.
-- Ingen GRANT och ingen POLICY ändras. Andra körningen ändrar ingenting.

-- ---------------------------------------------------------------------------
-- 1) Kantkontrollen — före allt annat (formen ur 0068, 0081 och 0085)
-- ---------------------------------------------------------------------------
-- Raderna som rättelsen (b) skriver om är mejlrader i öppna uppdrag vars
-- kanoniska id har formen id-left@id-right. Två sådana rader med samma
-- kanoniska id i samma avtal hade fällt uppdrag_referens_uk mitt i rättelsen.
-- Krocken är driftens arbete: ta bort dubbletten och kör om.
DO $$
DECLARE
  krockar text;
BEGIN
  SELECT string_agg(x.kanon, ', ' ORDER BY x.kanon) INTO krockar
    FROM (
      SELECT k.kanon
        FROM (
          SELECT r.company_id, r.contract_id,
                 CASE WHEN r.extern_id ~ '^\s*<.*>\s*$'
                      THEN btrim(substring(btrim(r.extern_id) from 2 for length(btrim(r.extern_id)) - 2))
                      ELSE btrim(r.extern_id) END AS kanon
            FROM uppdrag_referens r
           WHERE r.sort = 'mejl'
             AND NOT EXISTS (SELECT 1 FROM contracts c JOIN projects p ON p.id = c.project_id
                              WHERE c.id = r.contract_id AND p.status = 'closed')
        ) k
       WHERE k.kanon ~ '^[^\s<>@]+@[^\s<>@]+$'
       GROUP BY k.company_id, k.contract_id, k.kanon
      HAVING count(*) > 1
       ORDER BY k.kanon
       LIMIT 5
    ) x;
  IF krockar IS NOT NULL THEN
    RAISE EXCEPTION 'driftfel fore 0086: uppdrag_referens har mejlrader i samma avtal som far samma kanoniska Message-ID (%) - ta bort dubbletten och kor om', krockar;
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 2) Lägena
-- ---------------------------------------------------------------------------
ALTER TABLE uppdrag_referens
  DROP CONSTRAINT IF EXISTS uppdrag_referens_status_check;
ALTER TABLE uppdrag_referens
  ADD CONSTRAINT uppdrag_referens_status_check
  CHECK (status IN ('overifierad', 'levande', 'drift', 'trasig', 'utanfor_sparr'));
ALTER TABLE uppdrag_referens
  ALTER COLUMN status SET DEFAULT 'overifierad';

-- ---------------------------------------------------------------------------
-- 3) Kolumnerna
-- ---------------------------------------------------------------------------
ALTER TABLE uppdrag_referens
  ADD COLUMN IF NOT EXISTS handelse_datum date;
ALTER TABLE uppdrag_referens
  ADD COLUMN IF NOT EXISTS revision bigint;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uppdrag_referens_revision_bara_drive') THEN
    ALTER TABLE uppdrag_referens
      ADD CONSTRAINT uppdrag_referens_revision_bara_drive
      CHECK (revision IS NULL OR (sort = 'drive' AND revision >= 0));
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 4) Frysningen av revisionen
-- ---------------------------------------------------------------------------
-- Revisionen skrivs en gång, vid länkningen. En revision som gick att skriva
-- om hade låtit en utbytt kontraktsversion se ut som den länkade.
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
-- 5) Rättelserna, bara i uppdrag som inte är avslutade
-- ---------------------------------------------------------------------------
-- (a) En rad som aldrig verifierats har aldrig verifierats (beslut 4).
UPDATE uppdrag_referens r
   SET status = 'overifierad'
 WHERE r.status = 'levande'
   AND r.senast_verifierad IS NULL
   AND NOT EXISTS (SELECT 1 FROM contracts c JOIN projects p ON p.id = c.project_id
                    WHERE c.id = r.contract_id AND p.status = 'closed');

-- (b) Ett Message-ID lagras utan vinkelparenteser (beslut 3 och 5). Bara när
-- det kanoniska id:t har formen; annars står raden kvar som den är.
UPDATE uppdrag_referens r
   SET extern_id = k.kanon
  FROM (
    SELECT id,
           CASE WHEN extern_id ~ '^\s*<.*>\s*$'
                THEN btrim(substring(btrim(extern_id) from 2 for length(btrim(extern_id)) - 2))
                ELSE btrim(extern_id) END AS kanon
      FROM uppdrag_referens
     WHERE sort = 'mejl'
  ) k
 WHERE r.id = k.id
   AND r.sort = 'mejl'
   AND r.extern_id <> k.kanon
   AND k.kanon ~ '^[^\s<>@]+@[^\s<>@]+$'
   AND NOT EXISTS (SELECT 1 FROM contracts c JOIN projects p ON p.id = c.project_id
                    WHERE c.id = r.contract_id AND p.status = 'closed');

-- ---------------------------------------------------------------------------
-- 6) Kommentarerna
-- ---------------------------------------------------------------------------
COMMENT ON COLUMN uppdrag_referens.status IS
  'overifierad = ingen har verifierat referensen sedan den skrevs (standard, FR-10). levande = svepet såg änden oförändrad. drift = titel, hash eller revision skiljer sig från länkningen. trasig = änden har försvunnit. utanfor_sparr = svepets spärrdom: filens förälderkedja ligger utanför uppdragets spärrmapp; läget står kvar tills en dom innanför kommer.';

COMMENT ON COLUMN uppdrag_referens.handelse_datum IS
  'Källhändelsens datum ur Hermes läsning av källan (mejlets datum, mötets dag, filens version). Aldrig länkningstiden. NULL = datum saknas.';

COMMENT ON COLUMN uppdrag_referens.revision IS
  'Drive-revisionen som länkades, fryst vid skrivningen: triggern uppdrag_referens_fryser_revision fäller varje ändring. En annan rapporterad revision ger drift, aldrig en överskrivning. Bara för Drive.';

COMMENT ON TABLE uppdrag_referens IS
  'Kategori: REFERENS. Pekare till filer, kalenderposter och mejl i deras källsystem — innehållet dupliceras aldrig hit. En ny referens är overifierad tills svepet sagt annat; drift/trasig = den andra änden har ändrats eller försvunnit, utanfor_sparr = filen ligger utanför uppdragets spärrmapp.';
