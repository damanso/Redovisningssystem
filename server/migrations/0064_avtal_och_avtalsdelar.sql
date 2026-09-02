-- PRD_TIDSRAPPORTERING §3.2 + §4 F0/F6/F7 (story 3): avtalet och avtalsdelarna
-- som egna tabeller.
--
-- Felet som gör tabellerna nödvändiga (PRD §1 rad 6): ILT-avtalets Fas 2A har
-- ett tak på 32 timmar / 35 200 kr. Taket passerades utan att någon sa något —
-- inte för att ingen läste, utan för att systemet inte hade någonstans att
-- SKRIVA taket. `projects` bär en timtaxa och en budget (0017), men ett uppdrag
-- är inte ett avtal: avtalet har faser, varje fas har sitt eget tak, och ett
-- tilläggsavtal ändrar taket utan att radera det som gällde före.
--
-- Tre regler ur rådslaget 1/9 sitter i SCHEMAT, inte bara i koden:
--
--   * `cap_confirmed` — ett tak är avläst ur avtalshandlingen av en människa.
--     Ett tak som ingen bekräftat får varken varna eller spärra; det redovisas
--     som "vet ej" med förbrukningen bredvid. En varning på ett oläst tal lär
--     mottagaren att strunta i varningar, och då är nästa varning också död.
--   * `valid_from` — ett tilläggsavtal är en NY RAD, aldrig en överskrivning.
--     Taket som gällde i juli ska gå att läsa i oktober. Unik nyckel
--     (contract_id, code, valid_from): samma del, en rad per version.
--   * `manually_edited` — det David skrivit in för hand får inte skrivas över
--     av den automatiska extraktionen ur avtalsfilen (story 6). Samma regel som
--     CRM:ets ursprungsmärkning: människan vinner.
--
-- `time_entries.contract_part_id` är NULLBAR och INGEN befintlig post kopplas
-- här. Kopplingen är ett omdöme om vad arbetet gällde, och det omdömet fattas
-- av en människa via `assign_contract_part` — inte av en UPDATE som gissar på
-- en beskrivningstext.

-- ---------------------------------------------------------------------------
-- 0) Referensnycklar för de sammansatta främmande nycklarna
-- ---------------------------------------------------------------------------
-- Samma mönster som 0011/0053: en FK som bär med sig company_id gör det
-- OMÖJLIGT att hänga ett avtal på en fil eller ett projekt i ett annat bolag.
-- Nycklarna finns redan: projects (id, company_id) sedan 0053, customers sedan
-- 0011 och files sedan 0045 (unikt INDEX, `files_id_company_uk` — det räcker
-- som referens för en främmande nyckel, och namnet är upptaget av indexet).
-- Ingenting behöver läggas till här.

-- ---------------------------------------------------------------------------
-- 1) Avtalet
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS contracts (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  -- NOT NULL: ett avtal utan uppdrag har ingen tid att mäta mot. Uppdraget är
  -- vägen från tidposten till avtalet.
  project_id         uuid NOT NULL,
  customer_id        uuid,
  name               text NOT NULL,
  signed_date        date,
  payment_terms_days integer CHECK (payment_terms_days IS NULL OR (payment_terms_days >= 0 AND payment_terms_days <= 365)),
  -- Avtalets taxa ligger MELLAN avtalsdelens och uppdragets i ordningen (se
  -- services/contracts.ts): post → del → avtal → uppdrag.
  hourly_rate_ore    bigint CHECK (hourly_rate_ore IS NULL OR hourly_rate_ore >= 0),
  -- Avtalshandlingen. Nullbar: avtalet läggs in för hand nu, filen kopplas när
  -- extraktionen finns (story 6).
  source_file_id     uuid,
  notes              text,
  created_by         uuid REFERENCES users(id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contracts_id_company_uk UNIQUE (id, company_id),
  CONSTRAINT contracts_project_fk FOREIGN KEY (project_id, company_id)
    REFERENCES projects (id, company_id),
  CONSTRAINT contracts_customer_fk FOREIGN KEY (customer_id, company_id)
    REFERENCES customers (id, company_id),
  CONSTRAINT contracts_source_file_fk FOREIGN KEY (source_file_id, company_id)
    REFERENCES files (id, company_id)
);
CREATE INDEX IF NOT EXISTS contracts_project_idx ON contracts (company_id, project_id);

-- ---------------------------------------------------------------------------
-- 2) Avtalsdelen — fasen, och fasens tak
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS contract_parts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  contract_id     uuid NOT NULL,
  -- "Fas 2A ingår i Fas 2". Föräldern bär sitt eget tak över barnens
  -- förbrukning (se get_contract_usage).
  parent_part_id  uuid,
  code            text NOT NULL,
  name            text NOT NULL,
  description     text,
  billable        boolean NOT NULL DEFAULT true,
  hourly_rate_ore bigint CHECK (hourly_rate_ore IS NULL OR hourly_rate_ore >= 0),
  -- Taket i TIMMAR med två decimaler (avtalet skriver "32 h", inte "1 920
  -- min"). Taket i KRONOR är ören som allt annat pengavärde i systemet.
  cap_hours       numeric(8,2) CHECK (cap_hours IS NULL OR cap_hours >= 0),
  cap_amount_ore  bigint CHECK (cap_amount_ore IS NULL OR cap_amount_ore >= 0),
  -- Default FALSE med flit (Davids svar 1/9): ett tak som ingen läst i
  -- avtalshandlingen är inte ett tak, det är en anteckning.
  cap_confirmed   boolean NOT NULL DEFAULT false,
  valid_from      date NOT NULL,
  manually_edited boolean NOT NULL DEFAULT false,
  sort_order      integer NOT NULL DEFAULT 0,
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contract_parts_id_company_uk UNIQUE (id, company_id),
  -- Samma del, en rad per version. En ny rad med senare valid_from ersätter
  -- takvärdena framåt; historiken består.
  CONSTRAINT contract_parts_version_uk UNIQUE (contract_id, code, valid_from),
  CONSTRAINT contract_parts_not_own_parent CHECK (parent_part_id IS NULL OR parent_part_id <> id),
  CONSTRAINT contract_parts_contract_fk FOREIGN KEY (contract_id, company_id)
    REFERENCES contracts (id, company_id) ON DELETE CASCADE,
  CONSTRAINT contract_parts_parent_fk FOREIGN KEY (parent_part_id, company_id)
    REFERENCES contract_parts (id, company_id)
);
CREATE INDEX IF NOT EXISTS contract_parts_contract_idx ON contract_parts (company_id, contract_id, sort_order);
CREATE INDEX IF NOT EXISTS contract_parts_parent_idx ON contract_parts (company_id, parent_part_id)
  WHERE parent_part_id IS NOT NULL;

COMMENT ON COLUMN contract_parts.cap_confirmed IS
  'Taket är avläst ur avtalshandlingen av en människa. Ett obekräftat tak varnar aldrig och spärrar aldrig — det redovisas som "vet ej" med förbrukningen bredvid.';
COMMENT ON COLUMN contract_parts.valid_from IS
  'Från när den här VERSIONEN av delens villkor gäller. Ett tilläggsavtal är en ny rad, aldrig en överskrivning.';
COMMENT ON COLUMN contract_parts.manually_edited IS
  'Satt av en människa via upsert_contract_part. Skyddar värdet mot den automatiska extraktionen ur avtalsfilen (story 6).';

-- ---------------------------------------------------------------------------
-- 3) Tidposten pekar på avtalsdelen
-- ---------------------------------------------------------------------------
ALTER TABLE time_entries
  ADD COLUMN IF NOT EXISTS contract_part_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'time_entries_contract_part_fk') THEN
    ALTER TABLE time_entries ADD CONSTRAINT time_entries_contract_part_fk
      FOREIGN KEY (contract_part_id, company_id) REFERENCES contract_parts (id, company_id);
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS time_entries_contract_part_idx
  ON time_entries (company_id, contract_part_id) WHERE contract_part_id IS NOT NULL;

COMMENT ON COLUMN time_entries.contract_part_id IS
  'Avtalsdelen arbetet hör till. Nullbar och aldrig ifylld av en migration: klassificeringen är ett omdöme och görs av en människa (assign_contract_part).';

-- ---------------------------------------------------------------------------
-- 4) updated_at, RLS och GRANT — som 0017
-- ---------------------------------------------------------------------------
CREATE TRIGGER contracts_set_updated_at
  BEFORE UPDATE ON contracts FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER contract_parts_set_updated_at
  BEFORE UPDATE ON contract_parts FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE contracts FORCE ROW LEVEL SECURITY;
CREATE POLICY contracts_select ON contracts FOR SELECT USING (app_has_company_access(company_id));
CREATE POLICY contracts_insert ON contracts FOR INSERT WITH CHECK (app_has_company_access(company_id));
CREATE POLICY contracts_update ON contracts FOR UPDATE USING (app_has_company_access(company_id)) WITH CHECK (app_has_company_access(company_id));
-- Ingen DELETE-policy och ingen DELETE-GRANT: ett avtal avaktiveras, det
-- raderas inte. Samma hållning som resten av registren.
GRANT SELECT, INSERT, UPDATE ON contracts TO app;

ALTER TABLE contract_parts ENABLE ROW LEVEL SECURITY;
ALTER TABLE contract_parts FORCE ROW LEVEL SECURITY;
CREATE POLICY contract_parts_select ON contract_parts FOR SELECT USING (app_has_company_access(company_id));
CREATE POLICY contract_parts_insert ON contract_parts FOR INSERT WITH CHECK (app_has_company_access(company_id));
CREATE POLICY contract_parts_update ON contract_parts FOR UPDATE USING (app_has_company_access(company_id)) WITH CHECK (app_has_company_access(company_id));
GRANT SELECT, INSERT, UPDATE ON contract_parts TO app;
