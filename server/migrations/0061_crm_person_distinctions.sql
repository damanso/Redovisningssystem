-- Städytan för personer: svaret "det här är INTE samma person".
--
-- crm.people fylls från flera håll, och delade namn uppstår hela tiden. Synken
-- lägger upp "Eva Larsson" utan e-post ur ett kalenderevent, och "Eva Larsson"
-- med e-post finns redan sedan mailindexet. Ibland ÄR de samma person — då slås
-- de ihop (crmMerge.mergePeople). Ibland är de det inte: två människor kan heta
-- likadant. I det verkliga underlaget finns dessutom tolv rader på samma
-- organisation som ALLA fått namnet "david mancilla" men bär tolv OLIKA
-- e-postadresser. Det är tolv personer med fel namn — inte en dubblett.
--
-- Utan den här tabellen har städytan ingen plats att ta emot det svaret. Grupperna
-- räknas fram ur namnet vid varje sidladdning, så en grupp som avfärdats muntligt
-- är tillbaka nästa gång sidan öppnas, och nästa, och nästa. En lista som inte går
-- att beta av är i praktiken ingen lista: den slutar bli läst.
--
-- PARVIS, inte per grupp. Gruppen är ingenting som finns i databasen — den är
-- resultatet av en fråga. Sparade man "gruppen david mancilla är avfärdad" skulle
-- en fjortonde rad med samma namn hamna under ett beslut som fattades utan den,
-- osynligt. Med par gäller beslutet exakt de två rader det fattades om: en ny rad
-- ger nya par, gruppen dyker upp igen, och den som städar får se den. Det är rätt
-- utfall — en ny rad är ny information.
--
-- Samma sorts omdöme som crm.organization_name_aliases (migration 0059), och
-- därmed samma regel: DELETE finns, UPDATE finns inte. Ett omdöme läggs till eller
-- tas tillbaka, det skrivs aldrig om. Raderna följer personerna (CASCADE):
-- försvinner den ena i en sammanslagning finns inget par kvar att avfärda.
--
-- Ingen fritext, inga namn — bara två id:n. Tabellen bär relationsdata och ska
-- kunna gallras och raderas med den (jfr regeln för crm.audit_log, migration 0052).

CREATE TABLE crm.person_distinctions (
  company_id  uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  -- Paret lagras i kanonisk ordning så att (A,B) och (B,A) är samma rad. Utan
  -- ordningen hade primärnyckeln släppt igenom samma beslut två gånger, och
  -- uppslaget hade behövt fråga åt båda hållen.
  person_low  uuid NOT NULL,
  person_high uuid NOT NULL,
  created_by  uuid REFERENCES public.users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT person_distinctions_pk PRIMARY KEY (company_id, person_low, person_high),
  CONSTRAINT person_distinctions_ordning CHECK (person_low < person_high),
  CONSTRAINT person_distinctions_low_fk FOREIGN KEY (person_low, company_id)
    REFERENCES crm.people (id, company_id) ON DELETE CASCADE,
  CONSTRAINT person_distinctions_high_fk FOREIGN KEY (person_high, company_id)
    REFERENCES crm.people (id, company_id) ON DELETE CASCADE
);

-- Uppslaget går alltid "vilka par rör den här personen" när en grupp ritas.
CREATE INDEX person_distinctions_high_idx ON crm.person_distinctions (company_id, person_high);

COMMENT ON TABLE crm.person_distinctions IS
  'Par av personer som en människa bedömt är OLIKA personer trots samma namn. Håller dem borta från dubblettlistan på städytan. Får tas bort — till skillnad från crm.erased_sources bär den ett omdöme, inte en rättslig radering.';

ALTER TABLE crm.person_distinctions ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.person_distinctions FORCE ROW LEVEL SECURITY;
CREATE POLICY person_distinctions_select ON crm.person_distinctions FOR SELECT
  USING (public.app_has_company_access(company_id));
CREATE POLICY person_distinctions_insert ON crm.person_distinctions FOR INSERT
  WITH CHECK (public.app_has_company_access(company_id));
CREATE POLICY person_distinctions_delete ON crm.person_distinctions FOR DELETE
  USING (public.app_has_company_access(company_id));
-- Ingen UPDATE, varken policy eller GRANT: ett par skrivs aldrig om.
GRANT SELECT, INSERT, DELETE ON crm.person_distinctions TO app;
