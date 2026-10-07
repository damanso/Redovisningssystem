-- FR-24 (B-16, ADR-3): en ärendekoppling kräver sin frysta nyckel.
--
-- 0060 krävde källan när ett ärende-id finns, men inte nyckeln. En kopplad
-- tidpost med bara id är en pekare som bara går att läsa genom att slå upp
-- den i ärendeplattformen — och den ska gå att läsa när plattformen är nere
-- (FR-24, NFR-5). Därför kräver schemat nu den frysta, läsbara nyckeln
-- ("LOC-316") och källan, båda med minst ett tecken som inte är blanktecken
-- (btrim tar bara bort mellanslag, därför ~). Regeln sitter i Postgres av samma skäl
-- som i 0068: varje skrivväg, också framtida, delar tabellen.
--
-- Kantkontrollen före villkoret (samma form som 0068 avsnitt 8): bryter en
-- befintlig rad mot regeln vägrar migrationen köra. Felet är driftens arbete —
-- nyckeln kompletteras ur ärendeplattformen — aldrig en fråga till David.
-- Villkoret läggs NOT VALID och valideras i samma migration (B-16).

-- 1) Kantkontroll
DO $$
DECLARE
  antal   integer;
  exempel text;
BEGIN
  SELECT count(*)::int,
         (SELECT string_agg(x.id::text, ', ' ORDER BY x.id)
            FROM (SELECT id FROM time_entries
                   WHERE NOT (arende_id IS NULL
                              OR (arende_nyckel IS NOT NULL AND arende_nyckel ~ '[^[:space:]]'
                                  AND arende_kalla IS NOT NULL AND arende_kalla ~ '[^[:space:]]'))
                   ORDER BY id LIMIT 5) x)
    INTO antal, exempel
    FROM time_entries
   WHERE NOT (arende_id IS NULL
              OR (arende_nyckel IS NOT NULL AND arende_nyckel ~ '[^[:space:]]'
                  AND arende_kalla IS NOT NULL AND arende_kalla ~ '[^[:space:]]'));
  IF antal > 0 THEN
    RAISE EXCEPTION 'driftfel fore 0078: % tidpost(er) har arende_id utan fryst arende_nyckel eller arende_kalla (id: %) — komplettera nyckeln ur arendeplattformen och kor migrationen igen',
      antal, exempel;
  END IF;
END
$$;

-- 2) Villkoret, NOT VALID och idempotent
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'time_entries'::regclass
                    AND conname = 'time_entries_arende_nyckel_kravs') THEN
    ALTER TABLE time_entries
      ADD CONSTRAINT time_entries_arende_nyckel_kravs
      CHECK (arende_id IS NULL
             OR (arende_nyckel IS NOT NULL AND arende_nyckel ~ '[^[:space:]]'
                 AND arende_kalla IS NOT NULL AND arende_kalla ~ '[^[:space:]]'))
      NOT VALID;
  END IF;
END
$$;

-- 3) Valideringen i samma migration. En redan validerad regel valideras utan
--    verkan, så en andra körning är ett no-op.
ALTER TABLE time_entries VALIDATE CONSTRAINT time_entries_arende_nyckel_kravs;

COMMENT ON CONSTRAINT time_entries_arende_nyckel_kravs ON time_entries IS
  'FR-24: ett ärende-id kräver den frysta läsbara nyckeln och källan, var och en med minst ett tecken som inte är blanktecken, så att posten går att läsa när ärendeplattformen är nere. Villkoret från 0060 står kvar.';
