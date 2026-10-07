-- B-2 punkt 3, FR-41 punkt 4 och NFR-3: mottagandet bevaras före
-- verkställigheten. Efter ett processfel får ett redan avgjort förslag aldrig
-- förväxlas med en obesvarad fråga och kräva ett nytt ja eller nej.
ALTER TABLE action_approvals
  ADD COLUMN IF NOT EXISTS beslut_hash text,
  ADD COLUMN IF NOT EXISTS beslut_skal text;

-- Befintliga rader har NULL i båda kolumnerna och klarar alla villkor.
ALTER TABLE action_approvals
  ADD CONSTRAINT action_approvals_beslut_hash_form
    CHECK (beslut_hash IS NULL OR beslut_hash ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT action_approvals_beslut_har_beslutsfattare
    CHECK (beslut_hash IS NULL OR (decided_by IS NOT NULL AND decided_at IS NOT NULL)),
  ADD CONSTRAINT action_approvals_beslut_status
    CHECK (beslut_hash IS NULL OR status IN ('approved', 'executed', 'rejected')),
  ADD CONSTRAINT action_approvals_skal_bara_vid_nej
    CHECK (beslut_skal IS NULL OR (status = 'rejected' AND beslut_hash IS NOT NULL AND btrim(beslut_skal) <> '')),
  ADD CONSTRAINT action_approvals_mottaget_nej_har_skal
    CHECK (status <> 'rejected' OR beslut_hash IS NULL OR beslut_skal IS NOT NULL);

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
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS action_approvals_mottaget_oforanderligt ON action_approvals;
CREATE TRIGGER action_approvals_mottaget_oforanderligt
  BEFORE UPDATE ON action_approvals
  FOR EACH ROW EXECUTE FUNCTION mottaget_beslut_ar_oforanderligt();
