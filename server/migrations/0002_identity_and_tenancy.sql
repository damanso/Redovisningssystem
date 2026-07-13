-- Identitet och tenant-gräns: users, companies, company_members + RLS.
--
-- Säkerhetsmodellen (två lager, se GRANSKNING_OCH_OMSTARTSPLAN.md §4):
--   Lager 1: withTenantTransaction i API:t verifierar medlemskap innan frågor körs.
--   Lager 2: RLS-policyerna här nedanför — MEDLEMSKAPSBASERADE, inte bara
--            "company_id = kontext". Även om applikationskoden skulle sätta en
--            forcerad app.company_id utan medlemskap returnerar databasen 0 rader.

CREATE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END
$$;

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL,
  password_hash text NOT NULL,
  name          text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_key ON users (lower(email));
CREATE TRIGGER users_set_updated_at
  BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE companies (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  org_number text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER companies_set_updated_at
  BEFORE UPDATE ON companies FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE company_members (
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       text NOT NULL DEFAULT 'owner' CHECK (role IN ('owner', 'member')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, user_id)
);
CREATE INDEX company_members_user_idx ON company_members (user_id);

-- Transaktionslokal kontext, satt av API:t via set_config(..., true).
-- nullif(..., '') gör att osatt kontext blir NULL (=> ingen åtkomst) i stället
-- för ett cast-fel.
CREATE FUNCTION app_current_user_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.user_id', true), '')::uuid
$$;

CREATE FUNCTION app_current_company_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.company_id', true), '')::uuid
$$;

-- SECURITY DEFINER (ägaren är migrationsrollen) så att medlemskapskollen läser
-- company_members utan att själv filtreras av RLS — annars uppstår rekursion.
-- search_path låses för att förhindra kapning via objekt i andra scheman.
CREATE FUNCTION app_has_company_access(target_company uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM company_members
    WHERE company_id = target_company
      AND user_id = app_current_user_id()
  )
$$;

-- users: ingen RLS. Motivering: inloggning måste kunna slå upp e-post innan
-- någon identitet finns i kontexten, och tabellen innehåller ingen bolagsdata.
-- All åtkomst går via explicita nyckelfiltrerade frågor i authService.

ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY companies_select ON companies FOR SELECT
  USING (app_has_company_access(id));
-- INSERT: bolaget skapas med i förväg genererat id som satts i kontexten;
-- medlemskapet skapas i samma transaktion (se companyService).
CREATE POLICY companies_insert ON companies FOR INSERT
  WITH CHECK (id = app_current_company_id());
CREATE POLICY companies_update ON companies FOR UPDATE
  USING (app_has_company_access(id))
  WITH CHECK (app_has_company_access(id));
-- Ingen DELETE-policy: bolag kan inte raderas via app-rollen.

CREATE POLICY company_members_select ON company_members FOR SELECT
  USING (user_id = app_current_user_id());
CREATE POLICY company_members_insert ON company_members FOR INSERT
  WITH CHECK (user_id = app_current_user_id() AND company_id = app_current_company_id());

GRANT SELECT, INSERT, UPDATE ON users TO app;
GRANT SELECT, INSERT, UPDATE ON companies TO app;
GRANT SELECT, INSERT ON company_members TO app;
