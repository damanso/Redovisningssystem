-- FR-14, A-4: Davids nej gäller just paret, så nästa synk inte frågar igen.
-- Namnet kan tillhöra en enskild firma. Det bor här, följer relationen med
-- CASCADE och skrivs aldrig i auditloggen. GDPR kan behålla relationsraden.
CREATE TABLE IF NOT EXISTS crm.organization_distinctions (
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL,
  variant_name text NOT NULL,
  created_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT organization_distinctions_organization_fk FOREIGN KEY (organization_id, company_id)
    REFERENCES crm.organizations (id, company_id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS organization_distinctions_uk
  ON crm.organization_distinctions (company_id, organization_id, lower(variant_name));

COMMENT ON TABLE crm.organization_distinctions IS
  'Kategori: ÄGD — Davids besked att ett namn som bara skiljer sig i bolagsform är ett annat bolag';
COMMENT ON COLUMN crm.organization_distinctions.variant_name IS
  'Namnet kan tillhöra en fysisk person; därför bor det här och aldrig i en auditlogg.';

ALTER TABLE crm.organization_distinctions ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.organization_distinctions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organization_distinctions_select ON crm.organization_distinctions;
CREATE POLICY organization_distinctions_select ON crm.organization_distinctions FOR SELECT
  USING (public.app_has_company_access(company_id));
DROP POLICY IF EXISTS organization_distinctions_insert ON crm.organization_distinctions;
CREATE POLICY organization_distinctions_insert ON crm.organization_distinctions FOR INSERT
  WITH CHECK (public.app_has_company_access(company_id));
-- Ingen UPDATE och ingen DELETE, varken policy eller GRANT. Att ta tillbaka
-- ett besked kräver en egen åtgärd i en senare ändring.
GRANT SELECT, INSERT ON crm.organization_distinctions TO app;
