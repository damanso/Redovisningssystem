-- Uppdragsytan S10.10 (överlämning #302, beslut #189): DOKUMENTFÖRTECKNINGEN.
--
-- Davids ord 28/9: "det ska gå att se all dokumentation som inte är raderad som
-- finns med i projektet tillgängligt via projektytan". I dag finns dokumenten
-- bara i Drive och i valvet, och senaste versionen av ett underlag hittas genom
-- att leta. De två tabellerna här är den plats förteckningen får i stället.
--
-- Kategori: CACHE (1E ADR-2). Varje rad går att räkna om ur källsystemen, och
-- tabellerna får tömmas utan att något förloras utom fart — därför har `app`
-- DELETE här, precis som på `uppdrag_svepvarde` (0068 rad 470–487). DELETE är
-- inte en bekvämlighet: det är så "inte raderad" hålls SANT. Hermes pushar hela
-- projektets förteckning, appen ersätter den i en transaktion, och det som
-- flyttats till papperskorgen faller ur vid nästa push. En tabell som bara kunde
-- växa hade visat raderade filer som om de fanns.
--
-- Riktningen är enkelriktad (ADR-4): appen öppnar aldrig Drive eller valvet.
-- Hermes läser och skickar; skrivvägen in är `skriv_dokumentforteckning`.
--
-- Fyra regler bärs av schemat, och alla fyra av samma skäl som i 0068: tre
-- ingångar (REST, MCP och vyn) delar tabellen, och en regel som bara finns i en
-- applikationskontroll gäller inte för raden som skrevs av nästa väg in.
--
--   1. **En källa per rad, ur en sluten uppräkning.** `kalla` är 'drive' eller
--      'valv' och ingenting annat — vyn visar valvet i ett eget avsnitt, och ett
--      tredje värde hade ritats ingenstans.
--   2. **Länken är https:// och inget annat** (mönstret från 0065). Raden renderas
--      som en `<a href>` i vyn; en `javascript:`- eller `data:`-adress hade gjort
--      förteckningen till en angreppsyta, och en http-länk hade gjort underlaget
--      avlyssningsbart. Kontrollen står här OCH i tjänsten.
--   3. **En rad per dokument och källa.** `unique (company_id, project_id, kalla,
--      extern_id)` är upsertens nyckel: samma push två gånger ger samma rader.
--   4. **Raden hör till ETT projekt i ETT bolag.** Sammansatt FK mot
--      `projects (id, company_id)` — mönstret från 0053/0064/0068: nyckeln bär
--      med sig bolaget, så en dokumentrad kan aldrig hänga på ett annat bolags
--      projekt ens om `company_id` skrevs fel.
--
-- Filen är ADDITIV: två nya tabeller, ett index, RLS och GRANT. Ingen befintlig
-- tabell, kolumn, trigger eller rättighet rörs, och andra körningen är ett no-op.

CREATE TABLE IF NOT EXISTS uppdrag_dokument (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  project_id  uuid NOT NULL,
  -- Källsystemet raden lästes ur. Sluten uppräkning, se regel 1.
  kalla       text NOT NULL CHECK (kalla IN ('drive', 'valv')),
  -- Källsystemets eget id (Drive-id, valvets sökväg). Upsertens andra halva.
  extern_id   text NOT NULL CHECK (btrim(extern_id) <> '' AND char_length(extern_id) <= 300),
  namn        text NOT NULL CHECK (btrim(namn) <> '' AND char_length(namn) <= 500),
  mime        text CHECK (char_length(mime) <= 200),
  -- Källsystemets ändringstidpunkt. NULL betyder att källan inte angav någon —
  -- och en sådan rad sorteras SIST, aldrig som om den var nyast (FR-22:s regel
  -- om tomhet gäller också en tom tidsstämpel).
  andrad      timestamptz,
  lank        text NOT NULL CHECK (lank LIKE 'https://%' AND char_length(lank) <= 2000),
  -- Mappvägen relativt roten. '' = roten själv; vyn kallar den "Mappens rot".
  sokvag      text NOT NULL DEFAULT '' CHECK (char_length(sokvag) <= 1000),
  storlek     bigint CHECK (storlek >= 0),
  -- NÄR förteckningen lästes ur källan (FR-35). Inte när dokumentet ändrades.
  last_nar    timestamptz NOT NULL DEFAULT now(),
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uppdrag_dokument_uk UNIQUE (company_id, project_id, kalla, extern_id),
  CONSTRAINT uppdrag_dokument_project_fk FOREIGN KEY (project_id, company_id)
    REFERENCES projects (id, company_id) ON DELETE CASCADE
);

COMMENT ON TABLE uppdrag_dokument IS
  'Kategori: CACHE. Projektets icke-raderade dokument som Hermes läste dem ur Drive och valvet (FR-43) — namn, länk, datum och storlek, aldrig innehåll. Varje rad går att räkna om ur källsystemen; app har DELETE därför att hela förteckningen ERSÄTTS vid varje push, vilket är så "inte raderad" hålls sann.';
COMMENT ON COLUMN uppdrag_dokument.sokvag IS
  'Mappvägen relativt projektets rotmapp. '''' = roten själv. Gruppering och familjeregel (S10.10) räknar sökvägen som en del av identiteten: samma filnamn i två mappar är två familjer.';
COMMENT ON COLUMN uppdrag_dokument.last_nar IS
  'När raden LÄSTES ur källsystemet (FR-35) — aldrig när dokumentet ändrades. .farskhet-raden i vyn bär den.';

CREATE TABLE IF NOT EXISTS uppdrag_dokumentrot (
  company_id  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  project_id  uuid NOT NULL,
  namn        text NOT NULL CHECK (btrim(namn) <> '' AND char_length(namn) <= 300),
  lank        text NOT NULL CHECK (lank LIKE 'https://%' AND char_length(lank) <= 2000),
  last_nar    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, project_id),
  CONSTRAINT uppdrag_dokumentrot_project_fk FOREIGN KEY (project_id, company_id)
    REFERENCES projects (id, company_id) ON DELETE CASCADE
);

COMMENT ON TABLE uppdrag_dokumentrot IS
  'Kategori: CACHE. Projektets rotmapp i Drive — namnet och länken vyn öppnar med "Öppna mappen i Drive", plus lästidpunkten. Rotens närvaro är svaret på om förteckningen HAR lästs: utan rad har den aldrig lästs, med rad och noll dokument är mappen tom.';

-- Läsningen är alltid "det här projektets rader"; sorteringen och grupperingen
-- görs i tjänsten (samma svar till vy, REST och MCP), så indexet behöver bara
-- bära uppslaget.
CREATE INDEX IF NOT EXISTS uppdrag_dokument_projekt_idx
  ON uppdrag_dokument (company_id, project_id);

-- RLS och GRANT — husmönstret (0003/0017/0064/0068), exakt som
-- `uppdrag_svepvarde`: policyn går alltid via SECURITY DEFINER-funktionen
-- `app_has_company_access`, aldrig current_setting direkt. Cachetabeller bär
-- alla fyra rättigheterna; det är kategorins innebörd.
ALTER TABLE uppdrag_dokument ENABLE ROW LEVEL SECURITY;
ALTER TABLE uppdrag_dokument FORCE ROW LEVEL SECURITY;
ALTER TABLE uppdrag_dokumentrot ENABLE ROW LEVEL SECURITY;
ALTER TABLE uppdrag_dokumentrot FORCE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['uppdrag_dokument', 'uppdrag_dokumentrot'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_select', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR SELECT USING (app_has_company_access(company_id))', t || '_select', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_insert', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR INSERT WITH CHECK (app_has_company_access(company_id))', t || '_insert', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_update', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR UPDATE USING (app_has_company_access(company_id)) '
      'WITH CHECK (app_has_company_access(company_id))', t || '_update', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_delete', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR DELETE USING (app_has_company_access(company_id))', t || '_delete', t);
  END LOOP;
END
$$;

GRANT SELECT, INSERT, UPDATE, DELETE ON uppdrag_dokument, uppdrag_dokumentrot TO app;
