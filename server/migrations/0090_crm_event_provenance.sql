-- FR-8 avsteg 3 och 4, A-1: även kontaktpunkter och löften bär ursprung per fält.
-- Samma tabell som organisationer och personer ger en mekanism och en vakt.
-- Ursprunget dör med händelsen genom kaskad. Ingen bakåtfyllnad: äldre värdens
-- ursprung är okänt tills de faktiskt skrivs på nytt eller bekräftas.

-- 1. Hellre avbruten migration än kö bakom en lång läsning.
SET LOCAL lock_timeout = '5s';

-- 2. Sammansatta målnycklar för bolagssäkra främmande nycklar.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
      WHERE conrelid = 'crm.interactions'::regclass AND conname = 'interactions_id_company_uk') THEN
    ALTER TABLE crm.interactions ADD CONSTRAINT interactions_id_company_uk UNIQUE (id, company_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
      WHERE conrelid = 'crm.commitments'::regclass AND conname = 'commitments_id_company_uk') THEN
    ALTER TABLE crm.commitments ADD CONSTRAINT commitments_id_company_uk UNIQUE (id, company_id);
  END IF;
END
$$;

-- 3. Nya mål, tomma på alla befintliga rader.
ALTER TABLE crm.field_provenance ADD COLUMN IF NOT EXISTS interaction_id uuid;
ALTER TABLE crm.field_provenance ADD COLUMN IF NOT EXISTS commitment_id uuid;

-- 4. Ett ursprung kan bara beskriva en händelse i samma bolag.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
      WHERE conrelid = 'crm.field_provenance'::regclass AND conname = 'field_provenance_interaction_fk') THEN
    ALTER TABLE crm.field_provenance ADD CONSTRAINT field_provenance_interaction_fk
      FOREIGN KEY (interaction_id, company_id) REFERENCES crm.interactions (id, company_id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
      WHERE conrelid = 'crm.field_provenance'::regclass AND conname = 'field_provenance_commitment_fk') THEN
    ALTER TABLE crm.field_provenance ADD CONSTRAINT field_provenance_commitment_fk
      FOREIGN KEY (commitment_id, company_id) REFERENCES crm.commitments (id, company_id) ON DELETE CASCADE;
  END IF;
END
$$;

-- 5. Byt bara det gamla målvillkoret; en omkörning behåller dess oid.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
      WHERE conrelid = 'crm.field_provenance'::regclass AND conname = 'field_provenance_target_ck'
        AND pg_get_constraintdef(oid) LIKE '%commitment_id%') THEN
    ALTER TABLE crm.field_provenance DROP CONSTRAINT IF EXISTS field_provenance_target_ck;
    ALTER TABLE crm.field_provenance ADD CONSTRAINT field_provenance_target_ck
      CHECK (num_nonnulls(organization_id, person_id, interaction_id, commitment_id) = 1);
  END IF;
END
$$;

-- 6. Precis en rad per händelse och fält.
CREATE UNIQUE INDEX IF NOT EXISTS field_provenance_interaction_uk
  ON crm.field_provenance (company_id, interaction_id, field) WHERE interaction_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS field_provenance_commitment_uk
  ON crm.field_provenance (company_id, commitment_id, field) WHERE commitment_id IS NOT NULL;

-- 7. Samma målregel och livslängd för båda händelseslagen.
COMMENT ON COLUMN crm.field_provenance.interaction_id IS
  'Exakt ett av fyra mål är satt. Ursprungsraden dör med kontaktpunkten genom kaskad.';
COMMENT ON COLUMN crm.field_provenance.commitment_id IS
  'Exakt ett av fyra mål är satt. Ursprungsraden dör med löftet genom kaskad.';
