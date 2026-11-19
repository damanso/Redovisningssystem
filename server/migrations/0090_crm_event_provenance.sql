-- FR-8 avsteg 3 och 4, A-1: kontaktpunkter och löften delar ursprungstabell
-- med organisationer och personer. En mekanism ger samma vakt per fält,
-- och kaskaden låter ursprunget dö med händelsen. Ingen bakåtfyllnad görs.
SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'interactions_id_company_uk'
                 AND conrelid = 'crm.interactions'::regclass) THEN
    ALTER TABLE crm.interactions ADD CONSTRAINT interactions_id_company_uk UNIQUE (id, company_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'commitments_id_company_uk'
                 AND conrelid = 'crm.commitments'::regclass) THEN
    ALTER TABLE crm.commitments ADD CONSTRAINT commitments_id_company_uk UNIQUE (id, company_id);
  END IF;
END
$$;

ALTER TABLE crm.field_provenance ADD COLUMN IF NOT EXISTS interaction_id uuid;
ALTER TABLE crm.field_provenance ADD COLUMN IF NOT EXISTS commitment_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'field_provenance_interaction_fk'
                 AND conrelid = 'crm.field_provenance'::regclass) THEN
    ALTER TABLE crm.field_provenance ADD CONSTRAINT field_provenance_interaction_fk
      FOREIGN KEY (interaction_id, company_id) REFERENCES crm.interactions (id, company_id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'field_provenance_commitment_fk'
                 AND conrelid = 'crm.field_provenance'::regclass) THEN
    ALTER TABLE crm.field_provenance ADD CONSTRAINT field_provenance_commitment_fk
      FOREIGN KEY (commitment_id, company_id) REFERENCES crm.commitments (id, company_id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'field_provenance_target_ck'
                 AND conrelid = 'crm.field_provenance'::regclass
                 AND pg_get_constraintdef(oid) LIKE '%commitment_id%') THEN
    ALTER TABLE crm.field_provenance DROP CONSTRAINT IF EXISTS field_provenance_target_ck;
    ALTER TABLE crm.field_provenance ADD CONSTRAINT field_provenance_target_ck
      CHECK (num_nonnulls(organization_id, person_id, interaction_id, commitment_id) = 1);
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS field_provenance_interaction_uk
  ON crm.field_provenance (company_id, interaction_id, field) WHERE interaction_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS field_provenance_commitment_uk
  ON crm.field_provenance (company_id, commitment_id, field) WHERE commitment_id IS NOT NULL;

COMMENT ON COLUMN crm.field_provenance.interaction_id IS
  'Kontaktpunktens ursprung: exakt ett mål är satt, raden dör med händelsen.';
COMMENT ON COLUMN crm.field_provenance.commitment_id IS
  'Löftets ursprung: exakt ett mål är satt, raden dör med händelsen.';
