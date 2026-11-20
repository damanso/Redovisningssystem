-- FR-14, A-4: bolagsformslistan finns bara i databasen, så att tjänstens
-- framtida uppslag och dataprovet jämför likadant. Den lagrade genererade
-- kolumnen kan ingen skrivväg glömma; visningsnamnet lämnas orört.

-- 1. Hellre avbruten migration än kö bakom en lång läsning vid tabellomskrivningen.
SET LOCAL lock_timeout = '5s';

-- 2. En avslutande bolagsform, efter gemener och hopslagna blanktecken.
CREATE OR REPLACE FUNCTION crm.normalize_org_name(name text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
  SELECT regexp_replace(
    btrim(regexp_replace(lower(name), '\s+', ' ', 'g')),
    ' (ab \(publ\)|ab|hb|kb|as|asa|a/s|aps|oy|oyj|gmbh|ltd|limited|inc|llc|bv|nv)$',
    ''
  )
$$;

-- 3. Postgres räknar även befintliga rader, utan att ändra deras andra fält.
ALTER TABLE crm.organizations ADD COLUMN IF NOT EXISTS name_norm text
  GENERATED ALWAYS AS (crm.normalize_org_name(name)) STORED;

-- 4. Inte unikt: varianterna ska hittas för beslut och dataprov, inte nekas här.
CREATE INDEX IF NOT EXISTS organizations_name_norm_idx
  ON crm.organizations (company_id, name_norm);

-- 5. Nyckelns syfte och vad en framtida ändring av listan kräver.
COMMENT ON FUNCTION crm.normalize_org_name(text) IS
  'Den enda bolagsformslistan. Ändras listan i en senare migration måste name_norm räknas om: en lagrad genererad kolumn räknas bara vid skrivning.';
COMMENT ON COLUMN crm.organizations.name_norm IS
  'Genererad ur namnet: jämförelsenyckel för bolagsformsvarianter och dataprovets kontroll (b), aldrig ett visningsnamn.';
