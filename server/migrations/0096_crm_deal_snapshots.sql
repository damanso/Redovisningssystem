-- Story 7.1, FR-25: de öppna affärerna syns i relationsdelen, via kontraktet.
--
-- Affärerna bor i ärendeplattformen, som ärenden med affärsetiketten. Det här
-- systemet ringer aldrig ut (ADR-4), så arkitekturens K-2 låter Hermes skicka
-- en ögonblicksbild av de öppna affärerna hit varje natt, genom åtgärden
-- sync_crm_deals. Tabellerna här är mottagarsidan; läsningen är crm_open_deals.
--
-- Kategori: CACHE. Husets regel är att data ur ett källsystem läses ur källan
-- och aldrig dupliceras. Cachen är det uttryckliga undantaget, som
-- uppdrag_svepvarde: den får tömmas, den skrivs om i sin helhet vid varje
-- ögonblicksbild, och den är aldrig sanningen om en affär — ärendet är det.
-- Därför har app SELECT, INSERT och DELETE men aldrig UPDATE på cachen. En
-- affär som inte finns i den nya mängden kan då inte överleva genom att en rad
-- skrivs om på plats.
--
-- Den andra tabellen bär tidpunkten och antalet för bolagets senaste
-- ögonblicksbild, också när den var tom. En tom mängd ger inga cacherader som
-- kan bära tidpunkten, och läsningen måste skilja «Hermes skickade inga öppna
-- affärer» från «ingen ögonblicksbild har kommit, eller den är för gammal».
--
-- Affärsobjektet E3 lämnas orört: cachen är en spegel, inget affärsobjekt.
--
-- Cacheraden dör med relationen genom den sammansatta FK:n (ON DELETE CASCADE).
-- En GDPR-raderad relation behålls av bokföringsskäl och raderas aldrig, så
-- GDPR-rensningen tar relationens cacherader uttryckligen (services/gdpr.ts):
-- en affärs titel och nästa steg kan bära namn.
--
-- Filen är ADDITIV: två nya tabeller, ett index, RLS och GRANT. Ingen befintlig
-- tabell rörs, och andra körningen är ett no-op.

-- Hellre avbruten migration än kö bakom en lång läsning.
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS crm.deal_snapshots (
  company_id       uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  -- Ärendets nyckel i ärendeplattformen, unik per bolag.
  source_ref       text NOT NULL
                     CONSTRAINT deal_snapshots_source_ref_len CHECK (char_length(source_ref) BETWEEN 1 AND 300),
  organization_id  uuid NOT NULL,
  title            text NOT NULL
                     CONSTRAINT deal_snapshots_title_len CHECK (char_length(title) BETWEEN 1 AND 200),
  stage            text
                     CONSTRAINT deal_snapshots_stage_ck CHECK (stage IN ('idea', 'dialogue', 'proposal', 'negotiation')),
  value_ore        bigint
                     CONSTRAINT deal_snapshots_value_ck CHECK (value_ore >= 0),
  next_step        text
                     CONSTRAINT deal_snapshots_next_step_len CHECK (char_length(next_step) BETWEEN 1 AND 200),
  last_activity_at timestamptz NOT NULL,
  -- Ögonblicksbildens tidpunkt, samma på varje rad.
  observed_at      timestamptz NOT NULL,
  CONSTRAINT deal_snapshots_pkey PRIMARY KEY (company_id, source_ref),
  CONSTRAINT deal_snapshots_organization_fk FOREIGN KEY (organization_id, company_id)
    REFERENCES crm.organizations (id, company_id) ON DELETE CASCADE
);

-- Kaskaden och GDPR-rensningen slår upp raderna på relationen.
CREATE INDEX IF NOT EXISTS deal_snapshots_organization_idx
  ON crm.deal_snapshots (company_id, organization_id);

COMMENT ON TABLE crm.deal_snapshots IS
  'Kategori: CACHE — spegel av ärendeplattformens affärsärenden, får tömmas, skrivs bara av sync_crm_deals, redigeras aldrig i vyn';

ALTER TABLE crm.deal_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.deal_snapshots FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS deal_snapshots_select ON crm.deal_snapshots;
CREATE POLICY deal_snapshots_select ON crm.deal_snapshots FOR SELECT
  USING (public.app_has_company_access(company_id));
DROP POLICY IF EXISTS deal_snapshots_insert ON crm.deal_snapshots;
CREATE POLICY deal_snapshots_insert ON crm.deal_snapshots FOR INSERT
  WITH CHECK (public.app_has_company_access(company_id));
DROP POLICY IF EXISTS deal_snapshots_delete ON crm.deal_snapshots;
CREATE POLICY deal_snapshots_delete ON crm.deal_snapshots FOR DELETE
  USING (public.app_has_company_access(company_id));
-- Ingen policy och ingen rättighet för att ändra en rad: cachen skrivs om.
GRANT SELECT, INSERT, DELETE ON crm.deal_snapshots TO app;

CREATE TABLE IF NOT EXISTS crm.deal_snapshot_observations (
  company_id  uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  observed_at timestamptz NOT NULL,
  -- Hur många affärer Hermes skickade, också de som hoppades över. Noll betyder
  -- att Hermes skickade en tom mängd, inte att varje rad föll.
  received    integer NOT NULL
                CONSTRAINT deal_snapshot_observations_received_ck CHECK (received BETWEEN 0 AND 500),
  CONSTRAINT deal_snapshot_observations_pkey PRIMARY KEY (company_id)
);

COMMENT ON TABLE crm.deal_snapshot_observations IS
  'Kategori: CACHE — tidpunkt och antal för bolagets senaste ögonblicksbild av affärerna, också när den var tom, får tömmas, skrivs bara av sync_crm_deals';

ALTER TABLE crm.deal_snapshot_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.deal_snapshot_observations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS deal_snapshot_observations_select ON crm.deal_snapshot_observations;
CREATE POLICY deal_snapshot_observations_select ON crm.deal_snapshot_observations FOR SELECT
  USING (public.app_has_company_access(company_id));
DROP POLICY IF EXISTS deal_snapshot_observations_insert ON crm.deal_snapshot_observations;
CREATE POLICY deal_snapshot_observations_insert ON crm.deal_snapshot_observations FOR INSERT
  WITH CHECK (public.app_has_company_access(company_id));
DROP POLICY IF EXISTS deal_snapshot_observations_update ON crm.deal_snapshot_observations;
CREATE POLICY deal_snapshot_observations_update ON crm.deal_snapshot_observations FOR UPDATE
  USING (public.app_has_company_access(company_id))
  WITH CHECK (public.app_has_company_access(company_id));
-- Ingen DELETE: raden bär inga personuppgifter och dör med bolaget.
GRANT SELECT, INSERT, UPDATE ON crm.deal_snapshot_observations TO app;
