-- CRM A-1: även kontaktpunkter och löften bär ursprung per fält, så att en
-- människas rättelse överlever nästa synk. Samma tabell och samma fältvakt;
-- äldre värden får inget påhittat ursprung. Ursprunget dör med händelsen.
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

ALTER TABLE crm.field_provenance ADD COLUMN IF NOT EXISTS interaction_id uuid;
ALTER TABLE crm.field_provenance ADD COLUMN IF NOT EXISTS commitment_id uuid;

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

ALTER TABLE crm.field_provenance DROP CONSTRAINT IF EXISTS field_provenance_target_ck;
ALTER TABLE crm.field_provenance ADD CONSTRAINT field_provenance_target_ck
  CHECK (num_nonnulls(organization_id, person_id, interaction_id, commitment_id) = 1);

CREATE UNIQUE INDEX IF NOT EXISTS field_provenance_interaction_uk
  ON crm.field_provenance (company_id, interaction_id, field) WHERE interaction_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS field_provenance_commitment_uk
  ON crm.field_provenance (company_id, commitment_id, field) WHERE commitment_id IS NOT NULL;

COMMENT ON COLUMN crm.field_provenance.interaction_id IS
  'Kontaktpunkten vars fält bär ursprunget. Sammansatt bolagsnyckel; ursprunget dör med kontaktpunkten.';
COMMENT ON COLUMN crm.field_provenance.commitment_id IS
  'Löftet vars fält bär ursprunget. Sammansatt bolagsnyckel; ursprunget dör med löftet.';
COMMENT ON CONSTRAINT field_provenance_target_ck ON crm.field_provenance IS
  'Exakt ett mål: organisation, person, kontaktpunkt eller löfte. Ursprunget följer målets livstid.';
