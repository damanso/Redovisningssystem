-- Uppdragsytan, våg 1 (1E §3.1–3.4, story S1.1): hela modulens DATALAGER.
--
-- Varför spärrarna sitter i Postgres och inte i tjänstelagret: tre skrivvägar
-- (REST-API:t, MCP och webbvyn) plus all framtida kod delar de här tabellerna.
-- En regel som bara finns i en applikationskontroll gäller inte för raden som
-- skrevs av nästa väg in — samma filosofi som `cap_confirmed` (0064) och den
-- append-only auditloggen (0003).
--
-- Fyra regler bärs av schemat:
--
--   1. **Baselinen versioneras, den skrivs inte över.** Ett bekräftat tak
--      (`cap_confirmed`) är en överenskommelse med kunden. Ändras det in-place
--      finns det inget kvar som visar vad som gällde före — och ett tak som
--      går att flytta i tysthet är inget tak. Ändringen ska bli en NY rad med
--      `change_reason`. Rader som INTE är bekräftade får ändras fritt: det är
--      utkastarbetet, och `upsertContractPart` (services/contracts.ts) måste
--      fortsätta fungera precis som förut för dem.
--   2. **Ett bekräftat tak kräver ett fryst kontrakt.** Ett tak avläst ur ett
--      avtal som fortfarande är ett utkast är en anteckning, inte en baseline.
--   3. **Ett fryst kontrakt går inte tillbaka till utkast.** Frysningen är
--      hela poängen med baselinen; går den att backa är den en etikett.
--   4. **Ett avslutat uppdrag tar inte emot skrivningar.** Fyra räckvidder,
--      för de fyra vägar som kan röra ett avslutat uppdrags baseline:
--      modultabellerna, avtalsdelarna, kvittots avtalsdelskoppling och
--      tidpostens. `assignContractPart` läser aldrig `projects.status`,
--      därför sitter spärren här.
--
-- Backfillen (den enda i filen) fryser de avtal som redan är UNDERTECKNADE —
-- Davids ja 5/9. Ett undertecknat avtal ÄR en överenskommelse; att lämna det
-- som utkast hade gjort regel 2 verkningslös för allt som redan finns.
-- Kantkontrollen före den vägrar köra om ett OSIGNERAT avtal bär bekräftade
-- tak: det läget går inte att härleda, och en migration som gissar i det
-- läget flyttar en baseline utan att någon ser det.

-- ---------------------------------------------------------------------------
-- 1) Avtalsdelen får sin period och sitt ändringsskäl (1E §3.1)
-- ---------------------------------------------------------------------------
-- Perioden är avtalets, inte kalenderns: avtalstexten skriver "hösten 2026"
-- lika ofta som "2026-09-01". `date_precision` bär hur exakt datumet var i
-- avtalet, så att en uppskattning aldrig läses som ett åtagande på dagen.
ALTER TABLE contract_parts
  ADD COLUMN IF NOT EXISTS start_date     date,
  ADD COLUMN IF NOT EXISTS end_date       date,
  ADD COLUMN IF NOT EXISTS date_precision text
    CHECK (date_precision IS NULL OR date_precision IN ('ar', 'halvar', 'kvartal', 'manad', 'dag')),
  ADD COLUMN IF NOT EXISTS change_reason  text;

COMMENT ON COLUMN contract_parts.date_precision IS
  'Hur exakt perioden stod i avtalet (ar/halvar/kvartal/manad/dag). En uppskattning ska aldrig kunna läsas som ett åtagande på dagen.';
COMMENT ON COLUMN contract_parts.change_reason IS
  'Varför den här VERSIONEN av avtalsdelen skrevs. Krävs av kraver_orsak_vid_ny_version() när det redan finns en annan version av samma (contract_id, code).';

-- ---------------------------------------------------------------------------
-- 2) Kontraktet får sitt tillstånd, sina trösklar och sina godkännare (1E §3.1)
-- ---------------------------------------------------------------------------
ALTER TABLE contracts
  ADD COLUMN IF NOT EXISTS kontrakt_tillstand text NOT NULL DEFAULT 'utkast'
    CHECK (kontrakt_tillstand IN ('utkast', 'fryst')),
  -- Vad som stod öppet när uppdraget avslutades. Inget avslut utan lista:
  -- det som inte skrivs ner vid avslutet finns inte vid nästa avstämning.
  ADD COLUMN IF NOT EXISTS avslutat_med_oppna text[],
  -- Trösklarna för när en avvikelse ska SÄGAS, inte bara mätas. Golvet finns
  -- för att en procentsats på ett litet tak larmar om ingenting.
  ADD COLUMN IF NOT EXISTS troskel_procent numeric(5,2) NOT NULL DEFAULT 5.00,
  ADD COLUMN IF NOT EXISTS troskel_golv_ore bigint NOT NULL DEFAULT 2200000,
  ADD COLUMN IF NOT EXISTS troskel_golv_timmar numeric(8,2) NOT NULL DEFAULT 20.00,
  ADD COLUMN IF NOT EXISTS troskel_dagar integer NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS godkannare text,
  ADD COLUMN IF NOT EXISTS godkannare_eskalering text;

COMMENT ON COLUMN contracts.kontrakt_tillstand IS
  'utkast = arbetsmaterial, fryst = baseline. Ett bekräftat tak kräver fryst kontrakt, och fryst går aldrig tillbaka till utkast.';
COMMENT ON COLUMN contracts.troskel_golv_ore IS
  'Beloppsgolv i ÖREN (22 000,00 kr) under vilket en procentuell avvikelse inte larmar. Heltal som allt annat pengavärde i systemet.';

-- ---------------------------------------------------------------------------
-- 3) Kvittot pekar på avtalsdelen (1E §3.1)
-- ---------------------------------------------------------------------------
-- `oplanerad`: kostnaden fanns inte i baselinen. Den ska synas som just det,
-- inte tyst blandas in i avtalsdelens planerade utfall.
ALTER TABLE receipts
  ADD COLUMN IF NOT EXISTS contract_part_id uuid,
  ADD COLUMN IF NOT EXISTS oplanerad boolean NOT NULL DEFAULT false;

DO $$
BEGIN
  -- Sammansatt FK (mönstret från 0064): nyckeln bär med sig company_id, så ett
  -- kvitto kan aldrig hänga på en avtalsdel i ett annat bolag. Ingen
  -- ON DELETE-klausul — en avtalsdel raderas inte, den avaktiveras.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'receipts_contract_part_fk') THEN
    ALTER TABLE receipts ADD CONSTRAINT receipts_contract_part_fk
      FOREIGN KEY (contract_part_id, company_id) REFERENCES contract_parts (id, company_id);
  END IF;
END
$$;

COMMENT ON COLUMN receipts.oplanerad IS
  'Kostnaden fanns inte i baselinen när avtalsdelen frystes. Redovisas separat — aldrig tyst inblandad i det planerade utfallet.';

-- ---------------------------------------------------------------------------
-- 4) Modultabellerna (1E §3.2)
-- ---------------------------------------------------------------------------
-- Fyra kategorier, utskrivna i tabellkommentarerna: ÄGD (modulens egen sanning),
-- BASELINE (det frysta avtalsinnehållet), REFERENS (pekare ut till källsystem)
-- och CACHE (omräkningsbart). Bara ÄGD och BASELINE är sanning; referenserna
-- pekar och cachen får kastas. Pengar, ärenden och filer duplicerar vi aldrig.

-- 4.1 Leverabeln — vad som ska levereras, och hur man vet att det är levererat
CREATE TABLE IF NOT EXISTS uppdrag_leverabel (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  contract_id        uuid NOT NULL,
  kod                text NOT NULL,
  klausul            text,
  acceptanskriterium text,
  uppfoljningsmatt   text,
  -- Var måttet LÄSES. Modulen räknar aldrig om ett tal som redan finns i ett
  -- källsystem — den säger var det står.
  matt_lasvag        text CHECK (matt_lasvag IS NULL OR matt_lasvag IN ('redovisning', 'arenden', 'register', 'kalender')),
  status             text NOT NULL DEFAULT 'ej_paborjad'
                       CHECK (status IN ('ej_paborjad', 'pagar', 'levererad', 'godkand', 'avvisad')),
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uppdrag_leverabel_id_company_uk UNIQUE (id, company_id),
  CONSTRAINT uppdrag_leverabel_kod_uk UNIQUE (contract_id, kod),
  CONSTRAINT uppdrag_leverabel_contract_fk FOREIGN KEY (contract_id, company_id)
    REFERENCES contracts (id, company_id)
);
COMMENT ON TABLE uppdrag_leverabel IS
  'Kategori: ÄGD. Leverablerna är modulens egen sanning — de finns inte i något källsystem.';

-- 4.2 Leverabelns händelser — append-only, för status utan historik är en gissning
CREATE TABLE IF NOT EXISTS uppdrag_leverabel_handelse (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  contract_id   uuid NOT NULL,
  leverabel_id  uuid NOT NULL,
  fran          text,
  till          text NOT NULL,
  bekraftat_av  text,
  bekraftat_nar timestamptz,
  revision      integer,
  mottagare     text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uppdrag_leverabel_handelse_contract_fk FOREIGN KEY (contract_id, company_id)
    REFERENCES contracts (id, company_id),
  CONSTRAINT uppdrag_leverabel_handelse_leverabel_fk FOREIGN KEY (leverabel_id, company_id)
    REFERENCES uppdrag_leverabel (id, company_id)
);
COMMENT ON TABLE uppdrag_leverabel_handelse IS
  'Kategori: ÄGD, append-only. app har SELECT + INSERT och ingenting annat — samma tre försvarslinjer som audit_log (0003): en historik som går att skriva om är ingen historik.';

-- 4.3 Bedömningen — oföränderlig, och alltid satt av en människa
CREATE TABLE IF NOT EXISTS uppdrag_bedomning (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  contract_id       uuid NOT NULL,
  period_start      date NOT NULL,
  period_slut       date NOT NULL,
  -- Vilka händelser bedömningen vilade på. Pekare, aldrig kopior.
  handelse_ref_ids  uuid[],
  lage              text NOT NULL CHECK (lage IN ('pa_spar', 'risk', 'ur_spar')),
  -- NOT NULL med flit: en bedömning utan ett svar på "satte en människa den?"
  -- är en maskins omdöme med en människas auktoritet.
  satt_av_manniska  boolean NOT NULL,
  kommentar         text,
  -- Talen som gällde NÄR bedömningen sattes. Räknas de om i efterhand kan
  -- ingen längre se vad bedömningen faktiskt grundades på.
  frysta_siffror    jsonb,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uppdrag_bedomning_contract_fk FOREIGN KEY (contract_id, company_id)
    REFERENCES contracts (id, company_id)
);
COMMENT ON TABLE uppdrag_bedomning IS
  'Kategori: ÄGD, oföränderlig. app har SELECT + INSERT och ingenting annat: en bedömning som går att skriva om i efterhand är ingen bedömning.';

-- 4.4 Scopelinjerna — vad som är innanför och utanför uppdraget
CREATE TABLE IF NOT EXISTS uppdrag_scopelinje (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  contract_id uuid NOT NULL,
  -- 'fras' = en formulering att lyssna efter, inte en gräns i sig.
  sort        text NOT NULL CHECK (sort IN ('innanfor', 'utanfor', 'fras')),
  text        text NOT NULL,
  klausul     text,
  ordning     integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uppdrag_scopelinje_contract_fk FOREIGN KEY (contract_id, company_id)
    REFERENCES contracts (id, company_id)
);
COMMENT ON TABLE uppdrag_scopelinje IS
  'Kategori: BASELINE. Avtalets egna ord om vad som ingår — läses ur avtalet, uppfinns aldrig här.';

-- 4.5 Scopesignalen — en fras tändes, och någon måste avgöra vad den betydde
CREATE TABLE IF NOT EXISTS uppdrag_scopesignal (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  contract_id        uuid NOT NULL,
  fras               text NOT NULL,
  klausul            text,
  tand_av            text,
  tand_nar           timestamptz NOT NULL DEFAULT now(),
  -- NULL = ännu inte avgjord. En obesvarad signal ska synas som obesvarad,
  -- aldrig defaultas till "innanför" — då hade tystnaden blivit ett ja.
  avgjord            text CHECK (avgjord IS NULL OR avgjord IN ('innanfor', 'utanfor')),
  underlag_ref_id    uuid,
  ledde_till_part_id uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uppdrag_scopesignal_contract_fk FOREIGN KEY (contract_id, company_id)
    REFERENCES contracts (id, company_id),
  -- Sammansatt FK som 0064: signalen kan aldrig peka på en avtalsdel i ett
  -- annat bolag.
  CONSTRAINT uppdrag_scopesignal_part_fk FOREIGN KEY (ledde_till_part_id, company_id)
    REFERENCES contract_parts (id, company_id)
);
COMMENT ON TABLE uppdrag_scopesignal IS
  'Kategori: BASELINE. En tänd fras ur scopelinjerna. avgjord = NULL betyder obesvarad — tystnad blir aldrig ett ja.';

-- 4.6 Referensen — pekaren ut till källsystemet
CREATE TABLE IF NOT EXISTS uppdrag_referens (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  contract_id        uuid NOT NULL,
  sort               text NOT NULL CHECK (sort IN ('drive', 'kalender', 'mejl')),
  extern_id          text NOT NULL,
  extern_nyckel      text,
  extern_kalla       text,
  -- Titeln och hashen SOM DE VAR när länken skapades. Utan dem går det inte
  -- att se att den andra änden bytts ut under fötterna på oss.
  titel_vid_lankning text,
  hash_vid_lankning  text,
  senast_verifierad  timestamptz,
  status             text NOT NULL DEFAULT 'levande'
                       CHECK (status IN ('levande', 'drift', 'trasig')),
  -- NULL = inget köat. 'koad'/'skriven' för det som ska ut till källsystemet.
  ko_status          text CHECK (ko_status IS NULL OR ko_status IN ('koad', 'skriven')),
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uppdrag_referens_uk UNIQUE (company_id, contract_id, sort, extern_id),
  CONSTRAINT uppdrag_referens_contract_fk FOREIGN KEY (contract_id, company_id)
    REFERENCES contracts (id, company_id)
);
COMMENT ON TABLE uppdrag_referens IS
  'Kategori: REFERENS. Pekare till filer, kalenderposter och mejl i deras källsystem — innehållet dupliceras aldrig hit. status drift/trasig = den andra änden har ändrats eller försvunnit.';

-- 4.7 Svepvärdet — cache, och ingenting annat
CREATE TABLE IF NOT EXISTS uppdrag_svepvarde (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  contract_id uuid NOT NULL,
  nyckel      text NOT NULL,
  varde       jsonb NOT NULL,
  kalla       text,
  last_nar    timestamptz NOT NULL DEFAULT now(),
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uppdrag_svepvarde_uk UNIQUE (company_id, contract_id, nyckel),
  CONSTRAINT uppdrag_svepvarde_contract_fk FOREIGN KEY (contract_id, company_id)
    REFERENCES contracts (id, company_id)
);
COMMENT ON TABLE uppdrag_svepvarde IS
  'Kategori: CACHE. Varje värde går att räkna om ur källsystemen; tabellen får tömmas. Därför — och bara därför — har app DELETE här.';

-- ---------------------------------------------------------------------------
-- 5) Triggerfunktionerna — alla fyra definierade FÖRE sina triggrar
-- ---------------------------------------------------------------------------

-- 5.1 Baselinen versioneras
--
-- INSERT: finns det redan en annan version av samma (contract_id, code) är den
-- nya raden per definition en ÄNDRING av något som redan är sagt, och en
-- ändring utan skäl är en tyst överskrivning med ett nytt datum på.
--
-- UPDATE: en BEKRÄFTAD rad har sin ram fryst — taken, perioden, föräldern och
-- taxan. Etiketterna (name/description/sort_order/active) får alltid ändras:
-- ett stavfel i ett namn är inte en ändrad överenskommelse. En OBEKRÄFTAD rad
-- får ändras fritt — det är utkastarbetet, och `upsertContractPart`
-- (services/contracts.ts) uppdaterar just sådana rader in-place.
CREATE OR REPLACE FUNCTION kraver_orsak_vid_ny_version() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF (NEW.change_reason IS NULL OR btrim(NEW.change_reason) = '')
       AND EXISTS (
         SELECT 1 FROM contract_parts
          WHERE contract_id = NEW.contract_id
            AND code = NEW.code
            AND id <> NEW.id
       ) THEN
      RAISE EXCEPTION
        'ny version av avtalsdel % kräver change_reason — en ändring utan skäl är en tyst överskrivning',
        NEW.code;
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.cap_confirmed AND (
       NEW.cap_hours       IS DISTINCT FROM OLD.cap_hours
    OR NEW.cap_amount_ore  IS DISTINCT FROM OLD.cap_amount_ore
    OR NEW.valid_from      IS DISTINCT FROM OLD.valid_from
    OR NEW.start_date      IS DISTINCT FROM OLD.start_date
    OR NEW.end_date        IS DISTINCT FROM OLD.end_date
    OR NEW.date_precision  IS DISTINCT FROM OLD.date_precision
    OR NEW.parent_part_id  IS DISTINCT FROM OLD.parent_part_id
    OR NEW.hourly_rate_ore IS DISTINCT FROM OLD.hourly_rate_ore
    OR NOT NEW.cap_confirmed
  ) THEN
    RAISE EXCEPTION
      'bekräftad baseline för avtalsdel % ändras inte in-place — skriv en ny version med change_reason',
      OLD.code;
  END IF;

  RETURN NEW;
END
$$;

-- 5.2 Ett bekräftat tak kräver ett fryst kontrakt
CREATE OR REPLACE FUNCTION vagrar_baseline_i_utkast() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.cap_confirmed AND EXISTS (
    SELECT 1 FROM contracts
     WHERE id = NEW.contract_id
       AND company_id = NEW.company_id
       AND kontrakt_tillstand = 'utkast'
  ) THEN
    RAISE EXCEPTION 'bekräftat tak kräver fryst kontrakt';
  END IF;
  RETURN NEW;
END
$$;

-- 5.3 Frysningen går inte att backa
CREATE OR REPLACE FUNCTION vagrar_avfrysning() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.kontrakt_tillstand = 'fryst' AND NEW.kontrakt_tillstand = 'utkast' THEN
    RAISE EXCEPTION 'ett fryst kontrakt går inte tillbaka till utkast';
  END IF;
  RETURN NEW;
END
$$;

-- 5.4 Ett avslutat uppdrag tar inte emot skrivningar — fyra räckvidder
--
-- Vägen till `projects.status` skiljer sig åt per tabell, och TG_TABLE_NAME är
-- det som avgör vilken väg som gäller:
--   * de sju uppdrag_*-tabellerna och contract_parts bär contract_id direkt,
--   * receipts och time_entries bär contract_part_id och når avtalet via
--     avtalsdelen.
-- På receipts/time_entries prövas vid UPDATE BÅDA kopplingarna — den gamla och
-- den nya — och skrivningen fälls om någon av dem når ett avslutat uppdrag. Det
-- är det som gör att en post varken kan föras IN i eller lyftas BORT från ett
-- avslutat uppdrag i tysthet; prövades bara den nya kopplingen skulle en
-- ompekning från avslutat till öppet släppa igenom.
CREATE OR REPLACE FUNCTION vagrar_skrivning_pa_avslutat() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  rad       record;
  avtal_ids uuid[];
  stangt    boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN rad := OLD; ELSE rad := NEW; END IF;

  IF TG_TABLE_NAME IN ('receipts', 'time_entries') THEN
    IF TG_OP = 'UPDATE' THEN
      SELECT array_agg(cp.contract_id) INTO avtal_ids
        FROM contract_parts cp
       WHERE cp.id IN (NEW.contract_part_id, OLD.contract_part_id);
    ELSE
      SELECT array_agg(cp.contract_id) INTO avtal_ids
        FROM contract_parts cp
       WHERE cp.id = rad.contract_part_id;
    END IF;
  ELSE
    -- contract_parts + de sju uppdrag_*-tabellerna
    avtal_ids := ARRAY[rad.contract_id];
  END IF;

  IF avtal_ids IS NULL OR array_length(avtal_ids, 1) IS NULL THEN
    RETURN rad;
  END IF;

  SELECT EXISTS (
    SELECT 1
      FROM contracts c
      JOIN projects p ON p.id = c.project_id
     WHERE c.id = ANY (avtal_ids)
       AND p.status = 'closed'
  ) INTO stangt;

  IF COALESCE(stangt, false) THEN
    RAISE EXCEPTION 'uppdraget är avslutat — % på % går inte att skriva', TG_OP, TG_TABLE_NAME;
  END IF;

  RETURN rad;
END
$$;

-- ---------------------------------------------------------------------------
-- 6) Triggrarna
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS contract_parts_kraver_orsak ON contract_parts;
CREATE TRIGGER contract_parts_kraver_orsak
  BEFORE INSERT OR UPDATE ON contract_parts
  FOR EACH ROW EXECUTE FUNCTION kraver_orsak_vid_ny_version();

DROP TRIGGER IF EXISTS contract_parts_vagrar_baseline_i_utkast ON contract_parts;
CREATE TRIGGER contract_parts_vagrar_baseline_i_utkast
  BEFORE INSERT OR UPDATE ON contract_parts
  FOR EACH ROW EXECUTE FUNCTION vagrar_baseline_i_utkast();

DROP TRIGGER IF EXISTS contract_parts_vagrar_avslutat ON contract_parts;
CREATE TRIGGER contract_parts_vagrar_avslutat
  BEFORE INSERT OR UPDATE ON contract_parts
  FOR EACH ROW EXECUTE FUNCTION vagrar_skrivning_pa_avslutat();

DROP TRIGGER IF EXISTS contracts_vagrar_avfrysning ON contracts;
CREATE TRIGGER contracts_vagrar_avfrysning
  BEFORE UPDATE ON contracts
  FOR EACH ROW EXECUTE FUNCTION vagrar_avfrysning();

DROP TRIGGER IF EXISTS receipts_vagrar_avslutat ON receipts;
CREATE TRIGGER receipts_vagrar_avslutat
  BEFORE UPDATE OF contract_part_id ON receipts
  FOR EACH ROW EXECUTE FUNCTION vagrar_skrivning_pa_avslutat();

DROP TRIGGER IF EXISTS time_entries_vagrar_avslutat ON time_entries;
CREATE TRIGGER time_entries_vagrar_avslutat
  BEFORE UPDATE OF contract_part_id ON time_entries
  FOR EACH ROW EXECUTE FUNCTION vagrar_skrivning_pa_avslutat();

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['uppdrag_leverabel', 'uppdrag_leverabel_handelse', 'uppdrag_bedomning',
                           'uppdrag_scopelinje', 'uppdrag_scopesignal', 'uppdrag_referens',
                           'uppdrag_svepvarde'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', t || '_vagrar_avslutat', t);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE INSERT OR UPDATE OR DELETE ON %I '
      'FOR EACH ROW EXECUTE FUNCTION vagrar_skrivning_pa_avslutat()', t || '_vagrar_avslutat', t);
  END LOOP;
END
$$;

-- ---------------------------------------------------------------------------
-- 7) RLS och GRANT — husmönstret (0003/0017/0064)
-- ---------------------------------------------------------------------------
-- Policyn är alltid USING (app_has_company_access(company_id)) via
-- SECURITY DEFINER-funktionen från 0002/0053 — aldrig current_setting direkt.
-- Rättigheterna GRANT:as per tabell, exakt de som behövs; det som aldrig
-- GRANT:ats finns inte, så ingen REVOKE behövs (0003).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['uppdrag_leverabel', 'uppdrag_leverabel_handelse', 'uppdrag_bedomning',
                           'uppdrag_scopelinje', 'uppdrag_scopesignal', 'uppdrag_referens',
                           'uppdrag_svepvarde'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_select', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR SELECT USING (app_has_company_access(company_id))', t || '_select', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_insert', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR INSERT WITH CHECK (app_has_company_access(company_id))', t || '_insert', t);
  END LOOP;

  -- UPDATE bara där rättigheten finns. uppdrag_bedomning och
  -- uppdrag_leverabel_handelse saknar den med flit.
  FOREACH t IN ARRAY ARRAY['uppdrag_leverabel', 'uppdrag_scopelinje', 'uppdrag_scopesignal',
                           'uppdrag_referens', 'uppdrag_svepvarde'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_update', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR UPDATE USING (app_has_company_access(company_id)) '
      'WITH CHECK (app_has_company_access(company_id))', t || '_update', t);
  END LOOP;
END
$$;

DROP POLICY IF EXISTS uppdrag_svepvarde_delete ON uppdrag_svepvarde;
CREATE POLICY uppdrag_svepvarde_delete ON uppdrag_svepvarde FOR DELETE
  USING (app_has_company_access(company_id));

GRANT SELECT, INSERT ON uppdrag_bedomning, uppdrag_leverabel_handelse TO app;
GRANT SELECT, INSERT, UPDATE ON uppdrag_leverabel, uppdrag_scopelinje, uppdrag_scopesignal,
                                uppdrag_referens TO app;
GRANT SELECT, INSERT, UPDATE, DELETE ON uppdrag_svepvarde TO app;

-- ---------------------------------------------------------------------------
-- 8) Kantkontroll — FÖRE backfillen
-- ---------------------------------------------------------------------------
-- Ett osignerat avtal med bekräftade tak är ett läge migrationen inte kan
-- härleda: backfillen skulle lämna kontraktet som 'utkast' med en bekräftad
-- baseline hängande på sig, alltså precis det läge regel 2 finns för att
-- omöjliggöra. Då är det bättre att vägra köra och låta en människa avgöra.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM contract_parts p
      JOIN contracts c ON c.id = p.contract_id
     WHERE p.cap_confirmed AND c.signed_date IS NULL
  ) THEN
    RAISE EXCEPTION 'osignerat avtal har bekraftade tak — avgor manuellt fore 0068';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 9) Backfillen — den enda i filen
-- ---------------------------------------------------------------------------
-- Ett undertecknat avtal ÄR överenskommelsen. Davids ja 5/9: de fryses direkt.
-- utkast → fryst är den tillåtna riktningen, så vagrar_avfrysning() släpper
-- igenom satsen; körs filen om är den ett no-op.
UPDATE contracts SET kontrakt_tillstand = 'fryst'
 WHERE signed_date IS NOT NULL AND kontrakt_tillstand <> 'fryst';
