-- B-7, FR-2 och IR-04: också en obekräftad lagrad version måste stå kvar
-- för att kunna svara på vad som gällde när parterna kom överens.
-- Tillåtelselistan fryser alla andra kolumner, också framtida kolumner.
CREATE OR REPLACE FUNCTION kraver_orsak_vid_ny_version() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  projekt    uuid;
  avtal_syns boolean;
BEGIN
  -- INSERT: oförändrat från 0068. En ny version av en befintlig kod kräver skäl.
  IF TG_OP = 'INSERT' THEN
    IF (NEW.change_reason IS NULL OR btrim(NEW.change_reason) = '')
       AND EXISTS (SELECT 1 FROM contract_parts
                    WHERE contract_id = NEW.contract_id AND code = NEW.code AND id <> NEW.id) THEN
      RAISE EXCEPTION
        'ny version av avtalsdel % kräver change_reason — en ändring utan skäl är en tyst överskrivning',
        NEW.code;
    END IF;
    RETURN NEW;
  END IF;

  SELECT c.project_id INTO projekt
    FROM contracts c
   WHERE c.id = OLD.contract_id AND c.company_id = OLD.company_id;
  avtal_syns := FOUND;

  -- Avtal utan projekt: 0068:s regel ordagrant (B-7 punkt 2). 0064 gör mängden
  -- tom (contracts.project_id NOT NULL); grenen finns för att regeln ska gälla
  -- uppdragets baseline och inget annat om schemat någon gång ändras.
  IF avtal_syns AND projekt IS NULL THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    IF OLD.cap_confirmed AND (
         NEW.cap_hours       IS DISTINCT FROM OLD.cap_hours
      OR NEW.cap_amount_ore  IS DISTINCT FROM OLD.cap_amount_ore
      OR NEW.valid_from      IS DISTINCT FROM OLD.valid_from
      OR NEW.start_date      IS DISTINCT FROM OLD.start_date
      OR NEW.end_date        IS DISTINCT FROM OLD.end_date
      OR NEW.date_precision  IS DISTINCT FROM OLD.date_precision
      OR NEW.parent_part_id  IS DISTINCT FROM OLD.parent_part_id
      OR NEW.hourly_rate_ore IS DISTINCT FROM OLD.hourly_rate_ore
      OR NOT NEW.cap_confirmed
    ) THEN
      RAISE EXCEPTION
        'bekräftad baseline för avtalsdel % ändras inte in-place — skriv en ny version med change_reason',
        OLD.code;
    END IF;
    RETURN NEW;
  END IF;

  -- Uppdragets baseline. Ett avtal som inte syns (raderat i samma sats, till
  -- exempel under en kaskad) räknas hit: hellre fryst än öppen.
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'lagrad baselineversion av avtalsdel % raderas aldrig', OLD.code;
  END IF;
  IF OLD.cap_confirmed AND NOT NEW.cap_confirmed THEN
    RAISE EXCEPTION 'bekräftelsen av avtalsdel % tas aldrig tillbaka', OLD.code;
  END IF;
  -- Tillåtelselistan: bara bekräftelsemarkeringen och husets updated_at får skilja.
  IF (to_jsonb(NEW) - ARRAY['cap_confirmed', 'updated_at'])
       IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['cap_confirmed', 'updated_at']) THEN
    RAISE EXCEPTION
      'lagrad baselineversion av avtalsdel % ändras inte på plats — skriv en ny version med change_reason',
      OLD.code;
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS contract_parts_kraver_orsak ON contract_parts;
CREATE TRIGGER contract_parts_kraver_orsak
  BEFORE INSERT OR UPDATE OR DELETE ON contract_parts
  FOR EACH ROW EXECUTE FUNCTION kraver_orsak_vid_ny_version();
