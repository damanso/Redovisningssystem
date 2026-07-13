-- Fas A10: team & roller. Utökar rollerna med 'admin', låter medlemmar se sina
-- kollegor i samma bolag, och låter ägare/admin bjuda in, ändra roll och ta bort
-- medlemmar. Behörighetskollen ligger BÅDE i RLS (databasen) och i tjänstelagret.

-- 1) Utöka rolluppsättningen: owner > admin > member.
ALTER TABLE company_members DROP CONSTRAINT company_members_role_check;
ALTER TABLE company_members
  ADD CONSTRAINT company_members_role_check CHECK (role IN ('owner', 'admin', 'member'));

-- 2) SECURITY DEFINER-hjälpare (läser company_members utan RLS → ingen rekursion,
--    search_path låst mot kapning). Speglar app_has_company_access.
CREATE FUNCTION app_company_role(target_company uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT role FROM company_members
  WHERE company_id = target_company AND user_id = app_current_user_id()
$$;

CREATE FUNCTION app_is_company_admin(target_company uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM company_members
    WHERE company_id = target_company AND user_id = app_current_user_id()
      AND role IN ('owner', 'admin')
  )
$$;

-- 3) SELECT: en medlem får se ALLA medlemmar i sitt bolag (tidigare bara sin
--    egen rad). Fortfarande strikt tenant-avgränsat via medlemskapskollen.
DROP POLICY company_members_select ON company_members;
CREATE POLICY company_members_select ON company_members FOR SELECT
  USING (app_has_company_access(company_id));

-- 4) INSERT: bootstrap (skapa eget ägarmedlemskap när bolaget skapas) ELLER en
--    ägare/admin som lägger till någon annan i sitt bolag.
DROP POLICY company_members_insert ON company_members;
CREATE POLICY company_members_insert ON company_members FOR INSERT
  WITH CHECK (
    (user_id = app_current_user_id() AND company_id = app_current_company_id())
    OR app_is_company_admin(company_id)
  );

-- 5) UPDATE/DELETE: endast ägare/admin, och bara inom sitt eget bolag.
CREATE POLICY company_members_update ON company_members FOR UPDATE
  USING (app_is_company_admin(company_id))
  WITH CHECK (app_is_company_admin(company_id));
CREATE POLICY company_members_delete ON company_members FOR DELETE
  USING (app_is_company_admin(company_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON company_members TO app;
