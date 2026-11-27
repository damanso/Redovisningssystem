-- Story 3.3 (FR-11, B-11): frys kopieunderlaget i registerändringens transaktion.
-- 1) Fryst historik med avtalets versionsnummer och textens hash.
-- 2) Kommentar, RLS, minsta rättigheter och husets avslutstrigger.
-- 3) Köpostens versionspekare, hash, försöksräknare och sammansatta FK.
-- 4) Köläget ersatt samt partiell unikhet för vanliga referenser.
-- Additiv och idempotent: inga befintliga rader skrivs om. Gamla köposter
-- behåller NULL-version tills en registerändring eller svepet fryser en kopia.
CREATE TABLE IF NOT EXISTS uppdrag_registerkopia (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  contract_id uuid NOT NULL,
  registerversion integer NOT NULL CHECK (registerversion >= 1),
  innehall text NOT NULL CHECK (innehall <> ''),
  rader jsonb NOT NULL CHECK (jsonb_typeof(rader) = 'array'),
  registerhash text NOT NULL CHECK (registerhash ~ '^[0-9a-f]{64}$'),
  skapad_nar timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uppdrag_registerkopia_contract_fk FOREIGN KEY (contract_id, company_id)
    REFERENCES contracts (id, company_id),
  CONSTRAINT uppdrag_registerkopia_version_uk UNIQUE (company_id, contract_id, registerversion),
  CONSTRAINT uppdrag_registerkopia_nyckel_uk UNIQUE (id, company_id, contract_id, registerhash)
);
COMMENT ON TABLE uppdrag_registerkopia IS
  'Kategori: FRYST HISTORIK, append-only. Underlaget fryses i samma transaktion som registerändringen. Det töms aldrig och räknas aldrig om. app har SELECT och INSERT och ingenting annat.';
ALTER TABLE uppdrag_registerkopia ENABLE ROW LEVEL SECURITY;
ALTER TABLE uppdrag_registerkopia FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS uppdrag_registerkopia_select ON uppdrag_registerkopia;
CREATE POLICY uppdrag_registerkopia_select ON uppdrag_registerkopia FOR SELECT
  USING (app_has_company_access(company_id));
DROP POLICY IF EXISTS uppdrag_registerkopia_insert ON uppdrag_registerkopia;
CREATE POLICY uppdrag_registerkopia_insert ON uppdrag_registerkopia FOR INSERT
  WITH CHECK (app_has_company_access(company_id));
GRANT SELECT, INSERT ON uppdrag_registerkopia TO app;
DROP TRIGGER IF EXISTS uppdrag_registerkopia_vagrar_avslutat ON uppdrag_registerkopia;
CREATE TRIGGER uppdrag_registerkopia_vagrar_avslutat
  BEFORE INSERT OR UPDATE OR DELETE ON uppdrag_registerkopia
  FOR EACH ROW EXECUTE FUNCTION vagrar_skrivning_pa_avslutat();

ALTER TABLE uppdrag_referens
  ADD COLUMN IF NOT EXISTS registerkopia_id uuid,
  ADD COLUMN IF NOT EXISTS registerhash text,
  ADD COLUMN IF NOT EXISTS forsok integer NOT NULL DEFAULT 0;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uppdrag_referens_forsok_check') THEN
    ALTER TABLE uppdrag_referens ADD CONSTRAINT uppdrag_referens_forsok_check CHECK (forsok >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uppdrag_referens_kopia_par') THEN
    ALTER TABLE uppdrag_referens ADD CONSTRAINT uppdrag_referens_kopia_par
      CHECK ((registerkopia_id IS NULL) = (registerhash IS NULL));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uppdrag_referens_kopia_form') THEN
    ALTER TABLE uppdrag_referens ADD CONSTRAINT uppdrag_referens_kopia_form
      CHECK (registerkopia_id IS NULL OR (sort = 'drive' AND extern_nyckel = 'registerkopia' AND ko_status IS NOT NULL));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uppdrag_referens_registerkopia_fk') THEN
    ALTER TABLE uppdrag_referens ADD CONSTRAINT uppdrag_referens_registerkopia_fk
      FOREIGN KEY (registerkopia_id, company_id, contract_id, registerhash)
      REFERENCES uppdrag_registerkopia (id, company_id, contract_id, registerhash);
  END IF;
END
$$;
CREATE UNIQUE INDEX IF NOT EXISTS uppdrag_referens_en_kopost_per_version
  ON uppdrag_referens (registerkopia_id) WHERE registerkopia_id IS NOT NULL;
ALTER TABLE uppdrag_referens DROP CONSTRAINT IF EXISTS uppdrag_referens_ko_status_check;
ALTER TABLE uppdrag_referens ADD CONSTRAINT uppdrag_referens_ko_status_check
  CHECK (ko_status IS NULL OR ko_status IN ('koad', 'skriven', 'fel', 'ersatt'));
ALTER TABLE uppdrag_referens DROP CONSTRAINT IF EXISTS uppdrag_referens_uk;
CREATE UNIQUE INDEX IF NOT EXISTS uppdrag_referens_uk
  ON uppdrag_referens (company_id, contract_id, sort, extern_id) WHERE registerkopia_id IS NULL;
COMMENT ON COLUMN uppdrag_referens.registerkopia_id IS
  'Versionens frysta underlag. NULL för vanliga referenser och köposter från före 0098.';
COMMENT ON COLUMN uppdrag_referens.registerhash IS
  'SHA-256 av versionens innehall, bunden till samma avtal, bolag och version genom den sammansatta främmande nyckeln.';
COMMENT ON COLUMN uppdrag_referens.forsok IS
  'Antal mottagna utfall för den öppna köposten, utan tak för återförsök.';
COMMENT ON COLUMN uppdrag_referens.ko_status IS
  'NULL = ingen köpost. koad = väntar, skriven = kvitterad, fel = senaste försöket misslyckades, ersatt = en senare version har kvitterats eller frusits för en gammal köpost utan version; innehållet står kvar i uppdrag_registerkopia.';
