-- Story 4.2 (FR-13, FR-26): överlämningen bär sin handling som referens.
-- Additiv koppling inom samma bolag och avtal. Inga befintliga rader skrivs
-- om: äldre överlämningar behåller NULL och visar att handlingen saknas.
ALTER TABLE uppdrag_leverabel_handelse ADD COLUMN IF NOT EXISTS referens_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uppdrag_referens_id_company_contract_uk') THEN
    ALTER TABLE uppdrag_referens ADD CONSTRAINT uppdrag_referens_id_company_contract_uk
      UNIQUE (id, company_id, contract_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uppdrag_leverabel_handelse_referens_fk') THEN
    ALTER TABLE uppdrag_leverabel_handelse ADD CONSTRAINT uppdrag_leverabel_handelse_referens_fk
      FOREIGN KEY (referens_id, company_id, contract_id)
      REFERENCES uppdrag_referens (id, company_id, contract_id);
  END IF;
END
$$;

COMMENT ON COLUMN uppdrag_leverabel_handelse.referens_id IS
  'Handlingen som överlämningen eller returen registrerades ur, som rad i uppdrag_referens. Överlämningsdatumet läses ur referensens händelsedatum och kopieras aldrig hit. NULL för påbörjande, godkännande, retur utan handling och överlämningar före migrationen.';
