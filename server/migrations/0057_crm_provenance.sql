-- Relationsytan F4: varje uppgift bär sitt ursprung.
--
-- Designens premiss är att AI:t är den huvudsakliga inmatningen. Då uppstår ett
-- problem som inte finns i ett CRM där allt knappas in: samma ruta på skärmen
-- kan innehålla tre helt olika sorters påstående.
--
--   ur bokföringen  — ett FAKTUM. Omsättningen är fakturerad och bokförd.
--   från en människa — ett BESLUT. Någon visste, och skrev.
--   från AI:t        — en GISSNING. Ett organisationsnummer läst ur en
--                      mailsignatur är sannolikt rätt. Sannolikt.
--
-- I dag ser de tre likadana ut. Det är exakt samma felklass som de tysta
-- nollresultaten: raden finns, den ser rimlig ut, ingenting felar — och den kan
-- vara påhittad. Ett CRM där man inte vet vilka uppgifter man kan lita på är
-- värre än inget CRM, för då gissar man i stället för att kontrollera.
--
-- Därför: ursprunget lagras PER FÄLT, inte per rad. En organisation kan ha ett
-- namn någon skrivit själv, ett organisationsnummer AI:t läst ur en signatur och
-- en kundkoppling systemet matchat mot kundregistret. Tre olika sanningsanspråk
-- i samma kort.
--
-- Och en regel som följer direkt ur det: MÄNNISKAN VINNER. En synk får aldrig
-- skriva över ett fält en människa bestämt. Det är inte artighet, det är den
-- enda regel som gör det meningsfullt att rätta något — utan den kommer nästa
-- körning och sätter tillbaka gissningen, tyst.

CREATE TABLE crm.field_provenance (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  -- Exakt en av dessa. Riktiga främmande nycklar (inte entity_type/entity_id)
  -- så att ursprunget försvinner MED raden det beskriver — en gravsten över ett
  -- raderat fält är kvarlämnad persondata.
  organization_id uuid,
  person_id       uuid,
  field           text NOT NULL,
  source          text NOT NULL CHECK (source IN ('human', 'ai', 'sync', 'accounting', 'import')),
  -- Bara meningsfullt för gissningar. Människan har inte 87 % rätt, hon bestämde.
  confidence      numeric(4,3) CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  -- SKÄLET, inte citatet: "matchad på organisationsnummer", "avsändarsignatur".
  -- Samma regel som crm.audit_log.details — fritext om en person här överlever
  -- den gallring den var tänkt att träffas av. Källan pekas ut med source_ref.
  reason          text CHECK (reason IS NULL OR length(reason) <= 200),
  source_system   text,
  source_ref      text,
  recorded_by     uuid REFERENCES public.users(id),
  recorded_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT field_provenance_target_ck CHECK (num_nonnulls(organization_id, person_id) = 1),
  CONSTRAINT field_provenance_organization_fk FOREIGN KEY (organization_id, company_id)
    REFERENCES crm.organizations (id, company_id) ON DELETE CASCADE,
  CONSTRAINT field_provenance_person_fk FOREIGN KEY (person_id, company_id)
    REFERENCES crm.people (id, company_id) ON DELETE CASCADE
);

-- Ett ursprung per fält. Senaste skrivningen ÄR ursprunget — historiken över
-- vem som ändrat vad ligger i crm.audit_log, som är append-only.
CREATE UNIQUE INDEX field_provenance_org_uk ON crm.field_provenance (company_id, organization_id, field)
  WHERE organization_id IS NOT NULL;
CREATE UNIQUE INDEX field_provenance_person_uk ON crm.field_provenance (company_id, person_id, field)
  WHERE person_id IS NOT NULL;

COMMENT ON TABLE crm.field_provenance IS
  'Varifrån ett enskilt fält kommer. Styr både märkningen i vyn och regeln att en synk aldrig skriver över ett människobeslut.';
COMMENT ON COLUMN crm.field_provenance.reason IS
  'Skälet i klartext, max 200 tecken. Aldrig citat ur mail — källan pekas ut med source_system/source_ref.';

ALTER TABLE crm.field_provenance ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.field_provenance FORCE ROW LEVEL SECURITY;
CREATE POLICY field_provenance_select ON crm.field_provenance FOR SELECT
  USING (public.app_has_company_access(company_id));
CREATE POLICY field_provenance_insert ON crm.field_provenance FOR INSERT
  WITH CHECK (public.app_has_company_access(company_id));
CREATE POLICY field_provenance_update ON crm.field_provenance FOR UPDATE
  USING (public.app_has_company_access(company_id))
  WITH CHECK (public.app_has_company_access(company_id));
CREATE POLICY field_provenance_delete ON crm.field_provenance FOR DELETE
  USING (public.app_has_company_access(company_id));
GRANT SELECT, INSERT, UPDATE, DELETE ON crm.field_provenance TO app;

-- ---------------------------------------------------------------------------
-- Befintliga rader: allt som redan står i databasen skrevs innan ursprunget
-- fanns. Det ENDA ärliga är att inte påstå något om dem — de får inget
-- ursprung alls, och vyn visar dem omärkta.
--
-- Ett undantag, och det är ett faktum snarare än en gissning: en organisation
-- som redan pekar på en kund i redovisningen har en koppling som går att
-- verifiera mot kundregistret här och nu. Den märks som härledd ur bokföringen,
-- vilket också gör att en synk inte kan flytta den utan att det syns.
-- ---------------------------------------------------------------------------
INSERT INTO crm.field_provenance (company_id, organization_id, field, source, reason)
SELECT o.company_id, o.id, 'customer_id', 'accounting', 'kopplad till kundregistret'
FROM crm.organizations o
WHERE o.customer_id IS NOT NULL
ON CONFLICT DO NOTHING;
