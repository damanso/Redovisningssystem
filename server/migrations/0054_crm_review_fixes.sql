-- Granskningsfixar på CRM-bygget, före produktionssläpp.
--
-- Två fynd krävde schemaändringar. Båda handlar om att en spärr satt på fel
-- nivå: den ena för brett, den andra för smalt.

-- ---------------------------------------------------------------------------
-- 1) Personnamn är unikt inom ORGANISATIONEN, inte inom hela bolaget.
--
-- Fyndet: två olika personer som råkar heta likadant på två olika företag slogs
-- ihop till en rad, och personen flyttades till det senaste företaget — med
-- hela sin kontakthistorik. "Anna Andersson" är inte en identitet i ett bolag,
-- den är en identitet hos EN motpart.
--
-- COALESCE mot ett nolluuid gör att även personer UTAN organisation omfattas:
-- NULL i ett unikt index tillåter annars obegränsat många dubbletter, vilket
-- hade lämnat exakt det hål spärren finns för att täppa.
-- ---------------------------------------------------------------------------
DROP INDEX crm.people_name_uk;
CREATE UNIQUE INDEX people_name_uk ON crm.people
  (company_id, COALESCE(organization_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name))
  WHERE email IS NULL;

-- ---------------------------------------------------------------------------
-- 2) Gravstenar efter GDPR-radering.
--
-- Fyndet: raderingen tog bort kontaktpunkterna — och därmed också nycklarna
-- (source_system + source_ref) som gör synken idempotent. Nästa nattkörning
-- som skickade om samma historiska mail återskapade personen, e-posten och
-- mailsammanfattningarna. En rättsligt utförd radering gjordes alltså ogjord,
-- i tysthet, av ett jobb som gjorde precis vad det var byggt för.
--
-- Gravstenen överlever raderingen och gör återskapandet omöjligt. Den bär
-- ENBART källnycklar — inga personuppgifter — så den är i sig inget som
-- behöver gallras.
--
-- Nya händelser (nya source_ref) släpps fortfarande igenom: det är ny
-- behandling med ny grund, och att blockera dem för alltid vore fel åt andra
-- hållet. Det som stoppas är återuppspelning av det som raderats.
-- ---------------------------------------------------------------------------
CREATE TABLE crm.erased_sources (
  company_id    uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  source_system text NOT NULL,
  source_ref    text NOT NULL,
  erased_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, source_system, source_ref)
);

ALTER TABLE crm.erased_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.erased_sources FORCE ROW LEVEL SECURITY;
CREATE POLICY erased_sources_select ON crm.erased_sources FOR SELECT
  USING (public.app_has_company_access(company_id));
CREATE POLICY erased_sources_insert ON crm.erased_sources FOR INSERT
  WITH CHECK (public.app_has_company_access(company_id));
-- Ingen UPDATE/DELETE: en gravsten som går att ta bort är ingen gravsten.
GRANT SELECT, INSERT ON crm.erased_sources TO app;
