-- CRM E2 (del 2): rollmodell för underkonsulter.
--
-- Beslut B3: den första underkonsulten kommer inom sex månader och ska se SINA
-- EGNA uppdrag — inte hela bolaget. UI:t byggs senare (E7b), men datamodellen
-- ska bära det redan nu, och den ska bära det FAIL-CLOSED.
--
-- Det farliga hade varit att bara lägga till rollen. Alla befintliga
-- RLS-policyer frågar `app_has_company_access(company_id)`, som i dag betyder
-- "är medlem i bolaget" — en ny roll hade därmed fått FULL åtkomst till
-- fakturor, löner och bokföring från första dagen. Därför ändras funktionen i
-- stället: 'contractor' räknas inte som bolagsåtkomst. Med en rad stängs varje
-- befintlig tabell, och åtkomst öppnas sedan explicit, en tabell i taget.

-- 1) Rollen.
ALTER TABLE company_members DROP CONSTRAINT company_members_role_check;
ALTER TABLE company_members
  ADD CONSTRAINT company_members_role_check CHECK (role IN ('owner', 'admin', 'member', 'contractor'));

-- 2) Bolagsåtkomst utesluter underkonsulten. Allt som inte uttryckligen öppnas
--    nedan är därmed stängt för rollen — i databasen, inte bara i koden.
CREATE OR REPLACE FUNCTION app_has_company_access(target_company uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM company_members
    WHERE company_id = target_company
      AND user_id = app_current_user_id()
      AND role <> 'contractor'
  )
$$;

-- 3) ...men den egna medlemsraden måste synas, annars kan användaren inte ens
--    identifieras av API:t (medlemskapsuppslaget är förtroendegränsen) och
--    E7b skulle inte ha någon väg in.
DROP POLICY company_members_select ON company_members;
CREATE POLICY company_members_select ON company_members FOR SELECT
  USING (app_has_company_access(company_id) OR user_id = app_current_user_id());

-- 4) Uppdrag: vilken aktör som är tilldelad vilket projekt. Aktören (0051) är
--    nyckeln, inte användaren — en underkonsult finns som aktör långt innan hen
--    har inloggning, och kopplingen aktör→användare sätts först när kontot finns.
ALTER TABLE projects ADD CONSTRAINT projects_id_company_uk UNIQUE (id, company_id);

CREATE TABLE project_assignments (
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  project_id uuid NOT NULL,
  actor_id   uuid NOT NULL,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, project_id, actor_id),
  CONSTRAINT project_assignments_project_fk FOREIGN KEY (project_id, company_id)
    REFERENCES projects (id, company_id) ON DELETE CASCADE,
  CONSTRAINT project_assignments_actor_fk FOREIGN KEY (actor_id, company_id)
    REFERENCES work_actors (id, company_id) ON DELETE CASCADE
);
CREATE INDEX project_assignments_actor_idx ON project_assignments (company_id, actor_id);

-- 5) Hjälpfunktioner. SECURITY DEFINER av samma skäl som app_company_role:
--    de läser tabeller som RLS annars skulle filtrera, vilket gett rekursion.
--    Medlemskapet kollas MED: en aktör vars inbjudan dragits tillbaka ska tappa
--    åtkomsten även om aktörsraden och tilldelningen står kvar.
CREATE FUNCTION app_has_project_access(target_project uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM project_assignments pa
    JOIN work_actors a ON a.id = pa.actor_id AND a.company_id = pa.company_id AND a.active
    JOIN company_members m ON m.company_id = pa.company_id AND m.user_id = a.user_id
    WHERE pa.project_id = target_project
      AND a.user_id = app_current_user_id()
  )
$$;

CREATE FUNCTION app_is_own_actor(target_actor uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM work_actors WHERE id = target_actor AND user_id = app_current_user_id()
  )
$$;

-- 6) Den enda öppningen: sitt eget uppdrag och sin egen tid. Policyer är
--    permissiva (OR), så det här VIDGAR inget för ägare/admin/medlem — de har
--    redan åtkomst via app_has_company_access. Ingen policy läggs på fakturor,
--    kunder, löner eller bokföring: underkonsulten ska inte se dem.
CREATE POLICY projects_select_assigned ON projects FOR SELECT
  USING (app_has_project_access(id));
CREATE POLICY time_entries_select_own ON time_entries FOR SELECT
  USING (app_has_project_access(project_id) AND app_is_own_actor(performed_by_actor_id));
CREATE POLICY work_actors_select_self ON work_actors FOR SELECT
  USING (app_is_own_actor(id));

-- Tilldelningar hanteras av bolaget; underkonsulten får se sina egna.
ALTER TABLE project_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_assignments FORCE ROW LEVEL SECURITY;
CREATE POLICY project_assignments_select ON project_assignments FOR SELECT
  USING (app_has_company_access(company_id) OR app_is_own_actor(actor_id));
CREATE POLICY project_assignments_insert ON project_assignments FOR INSERT
  WITH CHECK (app_is_company_admin(company_id));
CREATE POLICY project_assignments_delete ON project_assignments FOR DELETE
  USING (app_is_company_admin(company_id));
GRANT SELECT, INSERT, DELETE ON project_assignments TO app;
