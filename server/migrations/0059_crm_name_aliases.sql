-- Relationsytan F5, forts.: gravstenen efter en sammanslagning.
--
-- Sammanslagningen (crmMerge.ts) flyttar historiken och tar bort den inslagna
-- raden. Men NAMNET lever kvar utanför systemet: mailindexet hos Hermes
-- fortsätter skicka "Hermes" som organisationsnamn, och ingesten slår upp
-- organisationen på NAMN innan den ens tittar på source_ref. Nästa nattkörning
-- skapar därför en ny, tom organisation med det gamla namnet — och den är värre
-- än en dubblett: de sex åtagandena ligger kvar på rätt rad, så det som
-- återuppstår är ett skal utan innehåll som förorenar tystnadslistan och
-- dagsytan. Utan den här tabellen får David göra om samma sammanslagning efter
-- varje nattkörning.
--
-- Samma resonemang som crm.erased_sources (migration 0054), med EN avgörande
-- skillnad: GDPR-gravstenen får aldrig tas bort, för den bär en rättslig
-- radering. Den här bär ett OMDÖME — någon bedömde att två rader var samma
-- bolag — och ett omdöme måste gå att ändra. Blir "Hermes" en riktig kund 2027
-- ska aliaset kunna plockas bort, annars hade beslutet från 2026 tyst kapat en
-- verklig relation. Därför finns DELETE, men ingen UPDATE: ett alias skrivs om
-- aldrig, det läggs till eller tas bort.
--
-- Tre spärrar mot att aliaset kapar fel skrivning:
--   1. Namnuppslaget i crm.organizations går FÖRST. Finns organisationen på
--      riktigt styrs ingenting om.
--   2. Bara skrivningar med ursprung 'sync' styrs om. En människas uttryckliga
--      upsert (och därmed även vyns rättningsformulär) träffar alltid den rad
--      hon pekat ut — annars hade gravstenen blivit ett sätt att göra om ett
--      namnbyte till en sammanslagning.
--   3. Varje omstyrning REDOVISAS i ingest-svaret (redirected_organizations).
--      En synk som tyst skickar en skrivning någon annanstans än avsändaren tror
--      är exakt den sortens tysta utfall som resten av kontraktet finns för att
--      undvika.
--
-- Aliaset lever med organisationsraden (CASCADE), inte med händelserna: det är
-- ingen kontaktpunkt och gallras därför inte på tid. Försvinner den kvarvarande
-- organisationen finns ingenting att peka om till.

CREATE TABLE crm.organization_name_aliases (
  company_id      uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  -- Namnet som INTE längre får skapa en egen rad. Lagras som det såg ut;
  -- uppslaget sker på lower(name), samma nyckel som organizations_name_uk.
  name            text NOT NULL,
  -- Raden som överlevde sammanslagningen och som skrivningen ska landa på.
  organization_id uuid NOT NULL,
  created_by      uuid REFERENCES public.users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT organization_name_aliases_organization_fk FOREIGN KEY (organization_id, company_id)
    REFERENCES crm.organizations (id, company_id) ON DELETE CASCADE
);

-- Ett namn kan bara peka åt ETT håll. Samma normalisering som namnindexet på
-- organisationerna, annars hade "hermes" och "Hermes" varit två gravstenar.
CREATE UNIQUE INDEX organization_name_aliases_uk
  ON crm.organization_name_aliases (company_id, lower(name));
CREATE INDEX organization_name_aliases_org_idx
  ON crm.organization_name_aliases (company_id, organization_id);

COMMENT ON TABLE crm.organization_name_aliases IS
  'Tidigare namn på hopslagna organisationer. Styr om synkens namnuppslag så att en sammanslagning inte görs ogjord av nästa nattkörning. Får tas bort av en människa — till skillnad från crm.erased_sources.';
COMMENT ON COLUMN crm.organization_name_aliases.name IS
  'Namnet som slogs in. Ett namn kan tillhöra en enskild firma, alltså en fysisk person — därför bor det här och aldrig i crm.audit_log.';

ALTER TABLE crm.organization_name_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.organization_name_aliases FORCE ROW LEVEL SECURITY;
CREATE POLICY organization_name_aliases_select ON crm.organization_name_aliases FOR SELECT
  USING (public.app_has_company_access(company_id));
CREATE POLICY organization_name_aliases_insert ON crm.organization_name_aliases FOR INSERT
  WITH CHECK (public.app_has_company_access(company_id));
CREATE POLICY organization_name_aliases_delete ON crm.organization_name_aliases FOR DELETE
  USING (public.app_has_company_access(company_id));
-- Ingen UPDATE, varken policy eller GRANT: ett alias ändras aldrig.
GRANT SELECT, INSERT, DELETE ON crm.organization_name_aliases TO app;
