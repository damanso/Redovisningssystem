-- B-5, IR-11, FR-42 och Story 1.16: nej-utkastets korrelationsmarkör. Den skrivs
-- i samma INSERT som beslutsraden. Tabellen är append-only (app har bara SELECT
-- och INSERT, 0080), så markören följer raden och ändras aldrig. Formen är
-- uppdragets nummer, B för beslut och bolagets löpnummer ur number_sequences:
-- bara siffror mellan fasta tecken, aldrig en avkortad uuid, fritext eller en
-- personuppgift. Ämnet bär markören, så att ett skickat mejl kan knytas till
-- just det här beslutet (Story 12.5).
ALTER TABLE uppdrag_beslut ADD COLUMN IF NOT EXISTS utkast_markor text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uppdrag_beslut_utkast_markor_uk') THEN
    ALTER TABLE uppdrag_beslut ADD CONSTRAINT uppdrag_beslut_utkast_markor_uk UNIQUE (company_id, utkast_markor);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uppdrag_beslut_utkast_med_markor') THEN
    ALTER TABLE uppdrag_beslut ADD CONSTRAINT uppdrag_beslut_utkast_med_markor
      CHECK ((utkast IS NULL) = (utkast_markor IS NULL));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uppdrag_beslut_utkast_markor_form') THEN
    ALTER TABLE uppdrag_beslut ADD CONSTRAINT uppdrag_beslut_utkast_markor_form
      CHECK (utkast_markor IS NULL OR utkast_markor ~ '^\[ref U[1-9][0-9]*-B[1-9][0-9]*\]$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uppdrag_beslut_utkast_form') THEN
    ALTER TABLE uppdrag_beslut ADD CONSTRAINT uppdrag_beslut_utkast_form
      CHECK (utkast IS NULL OR CASE WHEN jsonb_typeof(utkast) = 'object' THEN
        utkast ?& ARRAY['mottagare', 'amne', 'text']
        AND (utkast - 'mottagare' - 'amne' - 'text') = '{}'::jsonb
        AND jsonb_typeof(utkast -> 'mottagare') IN ('string', 'null')
        AND jsonb_typeof(utkast -> 'amne') = 'string'
        AND jsonb_typeof(utkast -> 'text') = 'string'
      ELSE false END);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uppdrag_beslut_utkast_amne_bar_markor') THEN
    ALTER TABLE uppdrag_beslut ADD CONSTRAINT uppdrag_beslut_utkast_amne_bar_markor
      CHECK (utkast IS NULL OR utkast_markor IS NULL OR strpos(utkast ->> 'amne', utkast_markor) > 0);
  END IF;
END
$$;

COMMENT ON COLUMN uppdrag_beslut.utkast_markor IS
  'Story 1.16 (B-5): nej-utkastets korrelationsmarkör, [ref U<uppdragsnummer>-B<löpnummer>]. Skrivs i samma INSERT som raden och ändras aldrig.';
