-- Uppdragsytan S10.10, överlämning #301 (beslut #189): DOKUMENTFÖRTECKNINGEN.
--
-- Davids fråga är en enda: *var ligger underlaget?* Svaret bodde i Drive, och
-- den som skulle hitta rätt version fick leta i en mappstruktur ingen kan
-- överblicka. De här två tabellerna är projektets förteckning över sina
-- dokument — namn, länk, datum, storlek och mappväg, ingenting annat.
--
-- **Kategorin är CACHE, och det är hela avgörandet.** Sanningen bor i Drive och
-- i valvet; varje rad här går att läsa om därifrån och får kastas. Det är —
-- precis som för `uppdrag_svepvarde` (0068 §4.7) — därför och BARA därför som
-- app-rollen har DELETE: skrivvägen ersätter projektets hela förteckning i en
-- transaktion, och rader som inte kom med i senaste läsningen ska försvinna.
-- Utan DELETE hade en raderad fil legat kvar för evigt och sett ut som ett
-- levande underlag.
--
-- Fyra regler bärs av schemat, och alla fyra av samma skäl som i 0068/0073: tre
-- vägar in (REST, MCP och vyn) delar tabellen, och en regel som bara finns i en
-- applikationskontroll gäller inte för raden som skrevs av nästa väg in.
--
--   1. **Inget innehåll, bara pekare.** Ingen kolumn bär dokumentets bytes,
--      ingen bär en kopia av texten. `lank` är adressen dit filen hör hemma —
--      samma hållning som `uppdrag_referens` (0068 §4.6), där innehållet aldrig
--      dupliceras hit.
--   2. **En fil per källa och projekt.** `UNIQUE (company_id, project_id, kalla,
--      extern_id)` är det som gör skrivningen till en upsert i stället för till
--      en växande logg. Samma fil kan finnas i två projekt (den är delad) men
--      aldrig två gånger i ett.
--   3. **Raden hör till ETT projekt i ETT bolag.** Sammansatt FK mot
--      `projects (id, company_id)` — nyckeln finns sedan 0053
--      (`projects_id_company_uk`), och mönstret är 0064/0068/0073:s: nyckeln bär
--      med sig bolaget, så en dokumentrad kan aldrig hänga på ett annat bolags
--      projekt ens om `company_id` skrevs fel.
--   4. **Mappen är en text, inte ett träd.** `sokvag` är mappvägen som Drive
--      själv säger den, och `''` är roten. En egen mapptabell hade varit en
--      andra sanning om en struktur vi inte äger och inte får äga: byter David
--      namn på en mapp i Drive är nästa läsning hela rättelsen.
--
-- Filen är ADDITIV: två nya tabeller, RLS och GRANT. Ingen befintlig tabell,
-- kolumn, trigger eller rättighet rörs, och andra körningen är ett no-op.

CREATE TABLE IF NOT EXISTS uppdrag_dokument (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  project_id  uuid NOT NULL,
  -- Källsystemet raden lästes ur. Drive är mapparna; valvet är husets egen
  -- lagring. Två källor kan bära samma id-rymd, så `kalla` ingår i nyckeln.
  kalla       text NOT NULL CHECK (kalla IN ('drive', 'valv')),
  -- Källsystemets stabila id (Drive-id, valvnyckel). Det överlever att filen
  -- byter namn och flyttas — länken och namnet gör det inte, och därför är det
  -- id:t som är radens identitet (samma skäl som `uppdrag_referens.extern_id`).
  extern_id   text NOT NULL,
  namn        text NOT NULL,
  mime        text,
  -- Källsystemets ändringstidpunkt, INTE vår. NULL betyder att källan inte
  -- angav någon — och en rad utan datum sorteras sist i stället för att gissas
  -- till "nyast" eller "äldst".
  andrad      timestamptz,
  lank        text NOT NULL,
  -- Mappvägen som källan säger den. `''` = roten (regel 4 ovan).
  sokvag      text NOT NULL DEFAULT '',
  storlek     bigint,
  -- NÄR raden lästes ur källan (FR-35). Skiljt från `created_at`: den första
  -- säger hur färsk uppgiften är, den andra när vi först såg filen.
  last_nar    timestamptz NOT NULL DEFAULT now(),
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uppdrag_dokument_uk UNIQUE (company_id, project_id, kalla, extern_id),
  CONSTRAINT uppdrag_dokument_projekt_fk FOREIGN KEY (project_id, company_id)
    REFERENCES projects (id, company_id)
);

COMMENT ON TABLE uppdrag_dokument IS
  'Kategori: CACHE. Projektets dokument som de såg ut vid senaste läsningen ur Drive/valvet — namn, länk, datum, storlek och mappväg, aldrig innehållet. Varje rad går att läsa om ur källan; tabellen får tömmas. Därför — och bara därför — har app DELETE här.';
COMMENT ON COLUMN uppdrag_dokument.sokvag IS
  'Mappvägen i källsystemet, ordagrant. Tom sträng = roten. Ingen mapptabell: strukturen ägs av Drive, och nästa läsning är hela rättelsen.';

-- Roten: mappen förteckningen lästes ur, en per projekt. Egen tabell och inte
-- en kolumn på varje dokumentrad: roten är projektets, inte filens, och 5 000
-- rader med samma länk i sig är fem tusen ställen att glömma uppdatera.
CREATE TABLE IF NOT EXISTS uppdrag_dokumentrot (
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  project_id uuid NOT NULL,
  namn       text NOT NULL,
  lank       text NOT NULL,
  last_nar   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, project_id),
  CONSTRAINT uppdrag_dokumentrot_projekt_fk FOREIGN KEY (project_id, company_id)
    REFERENCES projects (id, company_id)
);

COMMENT ON TABLE uppdrag_dokumentrot IS
  'Kategori: CACHE. Mappen projektets förteckning lästes ur: namnet, länken och lästidpunkten. Raden finns ⇔ förteckningen har lästs minst en gång — och det är skillnaden mellan "inte läst än" och "tom mapp".';

-- RLS och GRANT — husmönstret (0003/0017/0064/0068). Policyn går alltid via
-- SECURITY DEFINER-funktionen `app_has_company_access`, aldrig `current_setting`
-- direkt. Rättigheterna är exakt `uppdrag_svepvarde`:s fyra (0068 §7): båda
-- tabellerna är cache, och skrivvägen ersätter förteckningen — den behöver
-- INSERT, UPDATE och DELETE. Det som aldrig GRANT:ats finns inte, så ingen
-- REVOKE behövs (0003).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['uppdrag_dokument', 'uppdrag_dokumentrot'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);

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
