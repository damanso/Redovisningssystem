-- FR-34 (B-16): ett datum på en avtalsdel kräver sin precision.
--
-- `date_precision` (0068) bär hur exakt avtalet daterar delen: ”2026-09” är en
-- månad, inte den första eller sista dagen i den. Ett datum utan precision går
-- inte att visa rätt — varje vy måste då gissa, och gissningen blir en dag som
-- avtalet aldrig nämnt. Därför kräver schemat precisionen så snart ett start-
-- eller slutdatum finns. Regeln sitter i Postgres av samma skäl som i 0068 och
-- 0078: varje skrivväg, också framtida, delar tabellen. Zod-regeln
-- `kravPrecisionVidDatum` (lib/avtalsdelsfalt.ts) är första försvarslinjen.
--
-- Kantkontrollen före villkoret (samma form som 0078): bryter en befintlig rad
-- mot regeln vägrar migrationen köra. Felet är driftens arbete — precisionen
-- läses ur avtalet och sätts av ägarrollen — aldrig en fråga till David. Raden
-- är fryst av 0079, så rättelsen görs i en transaktion med triggern
-- contract_parts_kraver_orsak avstängd. Villkoret läggs NOT VALID och
-- valideras i samma migration (B-16).

-- 1) Kantkontroll
DO $$
DECLARE
  antal   integer;
  exempel text;
BEGIN
  SELECT count(*)::int,
         (SELECT string_agg(x.id::text, ', ' ORDER BY x.id)
            FROM (SELECT id FROM contract_parts
                   WHERE (start_date IS NOT NULL OR end_date IS NOT NULL) AND date_precision IS NULL
                   ORDER BY id LIMIT 5) x)
    INTO antal, exempel
    FROM contract_parts
   WHERE (start_date IS NOT NULL OR end_date IS NOT NULL) AND date_precision IS NULL;
  IF antal > 0 THEN
    RAISE EXCEPTION 'driftfel fore 0085: % avtalsdel(ar) har datum utan date_precision (id: %) — driften sätter precisionen ur avtalet och kör migrationen igen',
      antal, exempel;
  END IF;
END
$$;

-- 2) Villkoret, NOT VALID och idempotent
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'contract_parts'::regclass
                    AND conname = 'contract_parts_datum_kraver_precision') THEN
    ALTER TABLE contract_parts
      ADD CONSTRAINT contract_parts_datum_kraver_precision
      CHECK ((start_date IS NULL AND end_date IS NULL) OR date_precision IS NOT NULL)
      NOT VALID;
  END IF;
END
$$;

-- 3) Valideringen i samma migration. En redan validerad regel valideras utan
--    verkan, så en andra körning är ett no-op.
ALTER TABLE contract_parts VALIDATE CONSTRAINT contract_parts_datum_kraver_precision;

COMMENT ON CONSTRAINT contract_parts_datum_kraver_precision ON contract_parts IS
  'FR-34 och B-16: ett start- eller slutdatum på en avtalsdel kräver date_precision, så att ingen vy behöver gissa hur exakt avtalet daterar delen. Precisionen läses ur avtalet och antas aldrig.';
