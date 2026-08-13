-- CRM E2: eget schema för relationsdata.
--
-- Två skäl ur BMAD-underlaget, båda tvingande:
--
-- 1. Ett prospekt kan inte bo i kundtabellen. `add_contact`/`add_note` kräver i
--    dag party_type ∈ {customer, supplier}, och regeln "skapa aldrig prospekt
--    som kund före vunnen affär" gör att affären FÖRE fakturan strukturellt
--    saknar plats. Det är det enda som saknar hem i systemlandskapet.
--
-- 2. Relationsdata är inte räkenskapsinformation. Anteckningar om en kunds
--    personal ska inte omfattas av bokföringslagens arkiveringskrav, inte följa
--    med i SIE-export eller revisorsvy, och ska ha egen gallring enligt GDPR.
--    Ett eget schema gör den gränsen till en namnrymd i databasen i stället för
--    en regel någon ska komma ihåg: allt i `crm` är per definition utanför
--    bokföringen, och exporterna läser bara från public.
--
-- Ingen ny sanning: kunder, projekt och fakturor läses från befintliga tabeller.
-- crm.organizations pekar på customers när prospektet blivit kund — men kopierar
-- aldrig kunduppgifterna.
--
-- Alla belopp i heltal ören. Alla tabeller RLS + FORCE, samma mönster som core.

CREATE SCHEMA crm;
GRANT USAGE ON SCHEMA crm TO app;

-- ---------------------------------------------------------------------------
-- Organisationer: motparten. Prospekt först, kund sedan — samma rad hela vägen,
-- så relationshistoriken inte bryts den dag affären vinns.
-- ---------------------------------------------------------------------------
CREATE TABLE crm.organizations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name        text NOT NULL,
  org_number  text,
  website     text,
  -- Kopplingen till redovisningens kundregister. NULL = prospekt utan affär än.
  customer_id uuid,
  status      text NOT NULL DEFAULT 'prospect'
                CHECK (status IN ('prospect', 'customer', 'partner', 'former', 'archived')),
  -- Härledningskälla: var relationen uppstod (mail, möte, hänvisning).
  source      text,
  notes       text,
  created_by  uuid REFERENCES public.users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT organizations_id_company_uk UNIQUE (id, company_id),
  -- Tenant-säker koppling: en organisation i bolag A kan inte peka på en kund
  -- i bolag B ens om någon gissar rätt uuid.
  CONSTRAINT organizations_customer_fk FOREIGN KEY (customer_id, company_id)
    REFERENCES public.customers (id, company_id)
);
-- Dubblettspärr: en synk som körs om ska UPPDATERA, inte lägga en till.
CREATE UNIQUE INDEX organizations_name_uk ON crm.organizations (company_id, lower(name));
CREATE UNIQUE INDEX organizations_customer_uk ON crm.organizations (company_id, customer_id)
  WHERE customer_id IS NOT NULL;
CREATE INDEX organizations_status_idx ON crm.organizations (company_id, status);

-- ---------------------------------------------------------------------------
-- Människor. Skild från party_contacts (som hänger på en kund/leverantör i
-- redovisningen): en person kan finnas i relationen långt innan motparten är
-- kund, och ska inte behöva byta identitet när affären vinns.
-- ---------------------------------------------------------------------------
CREATE TABLE crm.people (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  organization_id uuid,
  name            text NOT NULL,
  email           text,
  phone           text,
  role_title      text,
  -- Härledningskälla: personkortet i brain-vaulten. CRM:et äger inte omdömet,
  -- det pekar på det.
  external_ref    text,
  notes           text,
  created_by      uuid REFERENCES public.users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT people_id_company_uk UNIQUE (id, company_id),
  CONSTRAINT people_organization_fk FOREIGN KEY (organization_id, company_id)
    REFERENCES crm.organizations (id, company_id) ON DELETE SET NULL (organization_id)
);
-- Samma nyckelval som kontakterna i 0050: e-post när den finns, annars namn.
CREATE UNIQUE INDEX people_email_uk ON crm.people (company_id, lower(email)) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX people_name_uk ON crm.people (company_id, lower(name)) WHERE email IS NULL;
CREATE INDEX people_org_idx ON crm.people (company_id, organization_id);

-- ---------------------------------------------------------------------------
-- Affären (E3). BYGGS INTE NU — beslut B2: öppna affärer bor kvar i Linear och
-- märks med en etikett; ytan renderar dem via API-kontraktet. Tabellen finns
-- enbart för att datamodellen ska ha PLATS för affärsobjektet utan ombyggnad
-- den dag beslutet omprövas. Ingen action skriver till den, den står tom.
-- ---------------------------------------------------------------------------
CREATE TABLE crm.deals (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  organization_id uuid,
  title           text NOT NULL,
  stage           text NOT NULL DEFAULT 'idea'
                    CHECK (stage IN ('idea', 'dialogue', 'proposal', 'negotiation', 'won', 'lost')),
  value_ore       bigint CHECK (value_ore IS NULL OR value_ore >= 0),
  expected_close  date,
  -- Linear-ärendet/etiketten som i dag ÄR affären. Referens, ingen kopia.
  external_ref    text,
  created_by      uuid REFERENCES public.users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT deals_id_company_uk UNIQUE (id, company_id),
  CONSTRAINT deals_organization_fk FOREIGN KEY (organization_id, company_id)
    REFERENCES crm.organizations (id, company_id) ON DELETE SET NULL (organization_id)
);
CREATE INDEX deals_stage_idx ON crm.deals (company_id, stage);

-- ---------------------------------------------------------------------------
-- Kontaktpunkter. "Senaste kontakt" härleds HÄRIFRÅN — aldrig ur tidrapporter.
-- Uppmätt i underlaget: två av tre aktiva projekt har noll loggade minuter men
-- betalda fakturor, så en vy byggd på tidrapportering hade visat den största
-- kunden som kontaktlös. Därför tillåter CHECK-villkoret bara källor med en
-- EXTERN tvingfunktion: mail skickas ändå, möten hålls ändå, ärenden skapas
-- ändå. 'time_entries' är medvetet inte en giltig källa.
-- ---------------------------------------------------------------------------
CREATE TABLE crm.interactions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  person_id       uuid,
  organization_id uuid,
  deal_id         uuid,
  occurred_at     timestamptz NOT NULL,
  channel         text NOT NULL CHECK (channel IN ('email', 'meeting', 'call', 'issue', 'note')),
  direction       text NOT NULL DEFAULT 'outbound' CHECK (direction IN ('inbound', 'outbound', 'internal')),
  summary         text NOT NULL,
  source_system   text NOT NULL CHECK (source_system IN ('gmail', 'calendar', 'linear', 'manual')),
  -- Extern nyckel hos källan (mail-id, kalenderhändelse, ärendenyckel).
  source_ref      text,
  created_by      uuid REFERENCES public.users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT interactions_target_ck CHECK (person_id IS NOT NULL OR organization_id IS NOT NULL),
  CONSTRAINT interactions_person_fk FOREIGN KEY (person_id, company_id)
    REFERENCES crm.people (id, company_id) ON DELETE CASCADE,
  CONSTRAINT interactions_organization_fk FOREIGN KEY (organization_id, company_id)
    REFERENCES crm.organizations (id, company_id) ON DELETE CASCADE,
  CONSTRAINT interactions_deal_fk FOREIGN KEY (deal_id, company_id)
    REFERENCES crm.deals (id, company_id) ON DELETE SET NULL (deal_id)
);
-- Idempotent synk: samma mail två gånger ger EN kontaktpunkt.
CREATE UNIQUE INDEX interactions_source_uk
  ON crm.interactions (company_id, source_system, source_ref) WHERE source_ref IS NOT NULL;
CREATE INDEX interactions_person_idx ON crm.interactions (company_id, person_id, occurred_at DESC);
CREATE INDEX interactions_org_idx ON crm.interactions (company_id, organization_id, occurred_at DESC);

-- ---------------------------------------------------------------------------
-- Åtaganden: vem har lovat vad till vem, när det sades och VAR det sades.
-- Källhänvisningen är inte dekoration — utan den går löftet inte att styrka.
-- ---------------------------------------------------------------------------
CREATE TABLE crm.commitments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  person_id       uuid,
  organization_id uuid,
  deal_id         uuid,
  -- Riktning: vi är skyldiga dem, eller de oss.
  direction       text NOT NULL CHECK (direction IN ('we_owe', 'they_owe')),
  body            text NOT NULL,
  due_date        date,
  status          text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done', 'dropped')),
  occurred_at     timestamptz NOT NULL,
  source_system   text NOT NULL CHECK (source_system IN ('gmail', 'calendar', 'linear', 'manual')),
  source_ref      text,
  completed_at    timestamptz,
  created_by      uuid REFERENCES public.users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT commitments_target_ck CHECK (person_id IS NOT NULL OR organization_id IS NOT NULL),
  CONSTRAINT commitments_person_fk FOREIGN KEY (person_id, company_id)
    REFERENCES crm.people (id, company_id) ON DELETE CASCADE,
  CONSTRAINT commitments_organization_fk FOREIGN KEY (organization_id, company_id)
    REFERENCES crm.organizations (id, company_id) ON DELETE CASCADE,
  CONSTRAINT commitments_deal_fk FOREIGN KEY (deal_id, company_id)
    REFERENCES crm.deals (id, company_id) ON DELETE SET NULL (deal_id)
);
CREATE UNIQUE INDEX commitments_source_uk
  ON crm.commitments (company_id, source_system, source_ref) WHERE source_ref IS NOT NULL;
CREATE INDEX commitments_open_idx ON crm.commitments (company_id, status, due_date);

-- ---------------------------------------------------------------------------
-- Egen auditlogg för relationsdata. Skild från public.audit_log med flit:
-- bokföringens logg ska ALDRIG gallras, relationsdatan ska kunna gallras enligt
-- GDPR. Blandas de kan inte det ena göras utan att skada det andra.
-- Append-only med samma tre försvarslinjer som public.audit_log.
--
-- Regel för innehållet: details får bara bära id:n och antal — aldrig fritext
-- om en person. Annars överlever personuppgiften den gallring den skulle träffas av.
-- ---------------------------------------------------------------------------
CREATE TABLE crm.audit_log (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  company_id  uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id     uuid REFERENCES public.users(id),
  action      text NOT NULL,
  entity_type text,
  entity_id   text,
  details     jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX crm_audit_log_company_idx ON crm.audit_log (company_id, occurred_at DESC);

CREATE FUNCTION crm.audit_log_block_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'crm.audit_log är append-only: % tillåts inte', TG_OP;
END
$$;
CREATE TRIGGER crm_audit_log_no_update_delete
  BEFORE UPDATE OR DELETE ON crm.audit_log
  FOR EACH ROW EXECUTE FUNCTION crm.audit_log_block_mutation();
CREATE TRIGGER crm_audit_log_no_truncate
  BEFORE TRUNCATE ON crm.audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION crm.audit_log_block_mutation();

-- ---------------------------------------------------------------------------
-- Gallringspolicy. Perioden är ett VÄGVAL för beställaren — den gissas inte
-- här. NULL = ingen automatisk gallring, och gallring körs bara med en
-- uttrycklig period som en människa godkänner.
-- ---------------------------------------------------------------------------
CREATE TABLE crm.retention_settings (
  company_id        uuid PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
  retention_months  integer CHECK (retention_months IS NULL OR retention_months BETWEEN 1 AND 240),
  updated_by        uuid REFERENCES public.users(id),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- updated_at-triggrar (funktionen finns i public sedan 0002).
-- ---------------------------------------------------------------------------
CREATE TRIGGER organizations_set_updated_at BEFORE UPDATE ON crm.organizations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER people_set_updated_at BEFORE UPDATE ON crm.people
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER deals_set_updated_at BEFORE UPDATE ON crm.deals
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER commitments_set_updated_at BEFORE UPDATE ON crm.commitments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS. Samma mönster som core: FORCE (gäller även ägarrollen) och
-- medlemskapskoll via app_has_company_access.
--
-- Skillnad mot core: DELETE är tillåtet på relationsdatan. Det är inte en
-- lucka utan ett krav — GDPR ger rätt till radering, och relationsdata är inte
-- räkenskapsinformation som måste bevaras i sju år.
-- ---------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['organizations', 'people', 'deals', 'interactions', 'commitments', 'retention_settings']
  LOOP
    EXECUTE format('ALTER TABLE crm.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE crm.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON crm.%I FOR SELECT USING (public.app_has_company_access(company_id))', t || '_select', t);
    EXECUTE format('CREATE POLICY %I ON crm.%I FOR INSERT WITH CHECK (public.app_has_company_access(company_id))', t || '_insert', t);
    EXECUTE format('CREATE POLICY %I ON crm.%I FOR UPDATE USING (public.app_has_company_access(company_id)) WITH CHECK (public.app_has_company_access(company_id))', t || '_update', t);
    EXECUTE format('CREATE POLICY %I ON crm.%I FOR DELETE USING (public.app_has_company_access(company_id))', t || '_delete', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON crm.%I TO app', t);
  END LOOP;
END
$$;

ALTER TABLE crm.audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.audit_log FORCE ROW LEVEL SECURITY;
CREATE POLICY crm_audit_log_select ON crm.audit_log FOR SELECT
  USING (public.app_has_company_access(company_id));
CREATE POLICY crm_audit_log_insert ON crm.audit_log FOR INSERT
  WITH CHECK (public.app_has_company_access(company_id));
-- Ingen UPDATE/DELETE-policy och inga sådana grants: append-only.
GRANT SELECT, INSERT ON crm.audit_log TO app;
