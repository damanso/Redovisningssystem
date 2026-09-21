-- Uppdragsytan, överlämning #268: ANTECKNINGSLOGGEN under Övrigt på Läget.
--
-- Davids ord 18/9: småuppdragen (ILT) sägs i förbifarten, görs samma dag och
-- lever sedan i mejl och i huvudet. Det som inte har en plats i systemet finns
-- inte den dag ett tillägg ska skrivas — och då är frågan "gjorde vi det här
-- innanför eller utanför avtalet?" en minnesövning. Tabellen är den platsen: en
-- rad i taget, i människans egna ord.
--
-- Tre regler bärs av schemat, och alla tre av samma skäl som i 0068: tre
-- skrivvägar (REST, MCP och vyn) delar tabellen, och en regel som bara finns i
-- en applikationskontroll gäller inte för raden som skrevs av nästa väg in.
--
--   1. **Append-only.** `app` får SELECT och INSERT och ingenting annat — samma
--      tre försvarslinjer som `audit_log` (0003), `uppdrag_bedomning` och
--      `uppdrag_leverabel_handelse` (0068). En logg som går att skriva om i
--      efterhand är ingen logg, och en anteckning som är underlag för ett
--      tillägg är värdelös om den kan putsas efteråt. Nästa rad rättar.
--   2. **Aldrig en tom rad.** En blank anteckning är ingen anteckning; den ser i
--      listan ut som att något skrevs. CHECK:en är den sista av tre spärrar
--      (zod-schemat, tjänsten, villkoret) och den enda som gäller även för kod
--      som inte går genom tjänstelagret.
--   3. **Raden hör till ETT avtal i ETT bolag.** Sammansatt FK mot
--      `contracts (id, company_id)` — mönstret från 0064/0068: nyckeln bär med
--      sig bolaget, så en anteckning kan aldrig hänga på ett annat bolags avtal
--      ens om `company_id` skrevs fel.
--
-- Filen är ADDITIV: en ny tabell, ett index, RLS och två GRANT. Ingen befintlig
-- tabell, kolumn, trigger eller rättighet rörs — `contracts.notes` och
-- `projects.notes` är orörda, och andra körningen är ett no-op.

CREATE TABLE IF NOT EXISTS uppdrag_anteckning (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  contract_id   uuid NOT NULL,
  -- Människans egna ord (0072:s princip). Taket är samma 2 000 tecken som
  -- bedömningens kommentar: en anteckning, inte ett dokument.
  "text"        text NOT NULL,
  -- Bocken David sätter när raden gäller arbete utanför avtalet. DEFAULT false:
  -- det normala är innanför, och ett obesvarat fält ska aldrig kunna läsas som
  -- en flaggning ingen gjort.
  utanfor_avtal boolean NOT NULL DEFAULT false,
  -- Avsändaren ur den inloggade användaren, aldrig ur indatat — samma regel som
  -- `satt_av_manniska`, `tand_av` och `bekraftat_av`. En avsändare anroparen
  -- skriver in själv är ett påstående, inte ett spår.
  skriven_av    uuid NOT NULL REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uppdrag_anteckning_text_check
    CHECK (btrim("text") <> '' AND char_length("text") <= 2000),
  CONSTRAINT uppdrag_anteckning_contract_fk FOREIGN KEY (contract_id, company_id)
    REFERENCES contracts (id, company_id)
);

COMMENT ON TABLE uppdrag_anteckning IS
  'Kategori: ÄGD, append-only. Anteckningsloggen under Övrigt på Läget — människans egna ord om småuppdrag, aldrig härledda av systemet. app har SELECT + INSERT och ingenting annat: nästa rad rättar, ingen rad skrivs om.';
COMMENT ON COLUMN uppdrag_anteckning.utanfor_avtal IS
  'Raden gäller arbete utanför avtalet — en människas bock, aldrig en härledning. Ingen automatik gör raden till ett tillägg eller en scopesignal.';

-- Läsningen är alltid "det här avtalets rader, nyast överst" — därför exakt de
-- tre kolumnerna i den ordningen.
CREATE INDEX IF NOT EXISTS uppdrag_anteckning_lista_idx
  ON uppdrag_anteckning (company_id, contract_id, created_at);

-- RLS och GRANT — husmönstret (0003/0017/0064/0068). Policyn går alltid via
-- SECURITY DEFINER-funktionen `app_has_company_access`, aldrig current_setting
-- direkt. Ingen UPDATE-policy och ingen DELETE-policy: det som aldrig GRANT:ats
-- finns inte, så ingen REVOKE behövs (0003).
ALTER TABLE uppdrag_anteckning ENABLE ROW LEVEL SECURITY;
ALTER TABLE uppdrag_anteckning FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS uppdrag_anteckning_select ON uppdrag_anteckning;
CREATE POLICY uppdrag_anteckning_select ON uppdrag_anteckning FOR SELECT
  USING (app_has_company_access(company_id));

DROP POLICY IF EXISTS uppdrag_anteckning_insert ON uppdrag_anteckning;
CREATE POLICY uppdrag_anteckning_insert ON uppdrag_anteckning FOR INSERT
  WITH CHECK (app_has_company_access(company_id));

GRANT SELECT, INSERT ON uppdrag_anteckning TO app;
