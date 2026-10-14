-- B-2, IR-13 och Story 1.15: en komplettering ersätter en väntande köpost.
-- Den gamla posten får `rejected` som tekniskt slutläge och `ersatt_av`, utan
-- beslutsfält. Den är inget mottaget beslut och verkställs aldrig.
ALTER TABLE action_approvals ADD COLUMN IF NOT EXISTS ersatt_av uuid;

-- Ersättaren finns i samma bolag (sammansatt FK mot 0080:s nyckel), varje
-- köpost ersätter högst en annan, och en ersatt post bär aldrig ett beslut.
-- Befintliga rader har NULL och klarar varje villkor.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'action_approvals_ersatt_av_fk') THEN
    ALTER TABLE action_approvals ADD CONSTRAINT action_approvals_ersatt_av_fk
      FOREIGN KEY (ersatt_av, company_id) REFERENCES action_approvals (id, company_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'action_approvals_ersatt_av_uk') THEN
    ALTER TABLE action_approvals ADD CONSTRAINT action_approvals_ersatt_av_uk UNIQUE (ersatt_av);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'action_approvals_ersatt_utan_beslut') THEN
    ALTER TABLE action_approvals ADD CONSTRAINT action_approvals_ersatt_utan_beslut
      CHECK (ersatt_av IS NULL OR (status = 'rejected' AND decided_by IS NULL AND decided_at IS NULL
        AND beslut_hash IS NULL AND beslut_skal IS NULL));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'action_approvals_ersatt_inte_sig_sjalv') THEN
    ALTER TABLE action_approvals ADD CONSTRAINT action_approvals_ersatt_inte_sig_sjalv
      CHECK (ersatt_av IS NULL OR ersatt_av <> id);
  END IF;
END
$$;

COMMENT ON COLUMN action_approvals.ersatt_av IS
  'Story 1.15 (B-2, IR-13): ersättaren efter en komplettering. Inget mottaget beslut — decided_by, decided_at, beslut_hash och beslut_skal är tomma.';

-- 0077:s triggerfunktion med sina tre regler ordagrant och två nya. En körd
-- migration ändras aldrig, så funktionen ersätts här. Triggern
-- action_approvals_mottaget_oforanderligt finns sedan 0077 och skapas inte igen.
CREATE OR REPLACE FUNCTION mottaget_beslut_ar_oforanderligt() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- Det som väl är satt ändras aldrig (AC 2).
  IF (OLD.decided_by  IS NOT NULL AND NEW.decided_by  IS DISTINCT FROM OLD.decided_by)
  OR (OLD.decided_at  IS NOT NULL AND NEW.decided_at  IS DISTINCT FROM OLD.decided_at)
  OR (OLD.beslut_hash IS NOT NULL AND NEW.beslut_hash IS DISTINCT FROM OLD.beslut_hash)
  OR (OLD.beslut_skal IS NOT NULL AND NEW.beslut_skal IS DISTINCT FROM OLD.beslut_skal) THEN
    RAISE EXCEPTION 'köpost %: ett mottaget beslut ändras aldrig', OLD.id;
  END IF;
  -- Ett äldre avslag blir aldrig ett mottaget nej i efterhand (AC 7).
  IF OLD.beslut_hash IS NULL AND NEW.beslut_hash IS NOT NULL AND OLD.status <> 'pending' THEN
    RAISE EXCEPTION 'köpost %: ett beslut tas bara emot från en väntande post', OLD.id;
  END IF;
  -- Mandatet blir aldrig en obesvarad fråga igen (AC 6).
  IF OLD.beslut_hash IS NOT NULL AND NEW.status = 'pending' THEN
    RAISE EXCEPTION 'köpost %: ett mottaget beslut blir aldrig en obesvarad fråga igen', OLD.id;
  END IF;
  -- Story 1.15: bara en väntande post kan ersättas.
  IF NEW.ersatt_av IS NOT NULL AND OLD.ersatt_av IS NULL AND OLD.status <> 'pending' THEN
    RAISE EXCEPTION 'köpost %: bara en väntande post kan ersättas', OLD.id;
  END IF;
  -- Story 1.15: en ersättning ändras aldrig, och den tas aldrig bort.
  IF OLD.ersatt_av IS NOT NULL AND NEW.ersatt_av IS DISTINCT FROM OLD.ersatt_av THEN
    RAISE EXCEPTION 'köpost %: en ersättning ändras aldrig', OLD.id;
  END IF;
  RETURN NEW;
END
$$;
