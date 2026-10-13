-- Uppdragsytan Story 1.9 (B-8, FR-7, FR-41, FR-8): scopeavgörandet blir en ny
-- rad i historiken.
--
-- Ett avgörande drar gränsen för åtagandet: låg frasen innanför eller utanför
-- uppdraget? Fram till nu stod svaret i kolumnen `uppdrag_scopesignal.avgjord`,
-- och ett nytt avgörande skrev över det förra. Vem som avgjorde och när fanns
-- ingenstans. Ett avgörande som skrivs över går inte att följa i efterhand, och
-- append-only rättas med en ny rad, aldrig med UPDATE (project-context.md).
--
-- Filen gör sju saker, i den här ordningen:
--   1. den här kommentaren;
--   2. kantkontrollen, före allt annat;
--   3. nycklarna för de sammansatta FK:erna;
--   4. tabellen `uppdrag_scopeavgorande`, append-only med löpnummer per signal;
--   5. kommentarer, RLS och rättigheter;
--   6. överföringen av befintliga `avgjord`-värden, och därefter avslutstriggern;
--   7. frysningen av kolumnen `avgjord`.
--
-- De överförda raderna saknar vem och när. Auditraden för de gamla avgörandena
-- är `action.executed` utan signalens id, så vem som avgjorde vilken signal går
-- inte att härleda. Det gissas inte: en gissad stämpel vore värre än ingen
-- (0070:s princip). Raderna märks `overford = true`, och en CHECK binder NULL i
-- vem och när till just den märkningen.
--
-- Det filen skapar: tabellen `uppdrag_scopeavgorande` med indexet
-- `uppdrag_scopeavgorande_avtal_idx`, två unika nycklar på befintliga tabeller
-- (avsnitt 3), funktionen `fryser_scopesignalens_avgjord()` och två triggrar:
-- `uppdrag_scopeavgorande_vagrar_avslutat` (med 0068:s oförändrade funktion) och
-- `uppdrag_scopesignal_fryser_avgjord`. Därtill nya kommentarer på båda
-- tabellerna. Kolumnen `avgjord` tas inte bort och rättigheterna på
-- `uppdrag_scopesignal` är oförändrade. En andra körning skriver inga nya rader.
--
-- Filen är INTE bakåtkompatibel med koden före Story 1.9. Frysningen fäller den
-- gamla `avgorSignal`:s `UPDATE uppdrag_scopesignal SET avgjord` (409
-- rule_violation), och den gamla läsvägen läser den frysta kolumnen, så att
-- avgöranden gjorda efter 0081 visas som öppna igen. En återställning efter att
-- 0081 körts görs därför med en framåträttning, aldrig med föregående release.

-- ---------------------------------------------------------------------------
-- 2) Kantkontroll — FÖRE allt annat (formen ur 0068 avsnitt 8)
-- ---------------------------------------------------------------------------
-- Signalens `underlag_ref_id` har ingen FK (0068), men avgörandets rad knyts
-- till referensen med sammansatt FK. En signal som pekar på ett underlag som
-- inte finns i bolaget hade fällt överföringen, eller ett senare avgörande, med
-- ett FK-fel. Kontrollen gäller alla signaler, eftersom varje signal kan avgöras
-- senare och raden då kopierar underlaget. Bättre att vägra köra och låta en
-- människa avgöra.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM uppdrag_scopesignal s
     WHERE s.underlag_ref_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM uppdrag_referens r
                        WHERE r.id = s.underlag_ref_id AND r.company_id = s.company_id)
  ) THEN
    RAISE EXCEPTION 'scopesignal pekar på ett underlag som inte finns i bolaget — avgör manuellt före 0081';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 3) Nycklarna för de sammansatta FK:erna (formen ur 0080)
-- ---------------------------------------------------------------------------
-- Avgörandet ska aldrig kunna hänga på ett annat bolags signal eller referens,
-- och aldrig på en signal i ett annat avtal än raden säger. `action_approvals`
-- fick sin nyckel (id, company_id) i 0080.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uppdrag_scopesignal_id_company_contract_uk') THEN
    ALTER TABLE uppdrag_scopesignal
      ADD CONSTRAINT uppdrag_scopesignal_id_company_contract_uk UNIQUE (id, company_id, contract_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uppdrag_referens_id_company_uk') THEN
    ALTER TABLE uppdrag_referens
      ADD CONSTRAINT uppdrag_referens_id_company_uk UNIQUE (id, company_id);
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 4) Tabellen
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS uppdrag_scopeavgorande (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  -- Triggern `vagrar_skrivning_pa_avslutat()` läser `rad.contract_id`, och
  -- schemaregeln kräver avtalet i den sammansatta nyckeln.
  contract_id         uuid NOT NULL,
  signal_id           uuid NOT NULL,
  -- Löpnummer per signal, räknat under radlåset på signalen. `created_at` hade
  -- kunnat ge en senare väntande transaktion en tidigare stämpel; ”senaste” ska
  -- vara entydigt.
  lopnummer           integer NOT NULL,
  avgorande           text NOT NULL,
  -- Den inloggade användaren, aldrig ur indata. NULL bara för överförda rader.
  avgjort_av          uuid REFERENCES users(id),
  avgjort_nar         timestamptz,
  -- Signalens underlag när avgörandet gjordes, kopierat ur den låsta raden.
  underlag_ref_id     uuid,
  -- Köposten för det tillägg avgörandet köade. Avtalsdelen finns inte när
  -- avgörandet görs, och en append-only rad kan inte fyllas i efteråt.
  tillagg_approval_id uuid,
  overford            boolean NOT NULL DEFAULT false,
  created_at          timestamptz NOT NULL DEFAULT now(),
  -- Sammansatta FK (0064/0068/0080): varje pekare bär med sig bolaget.
  CONSTRAINT uppdrag_scopeavgorande_contract_fk FOREIGN KEY (contract_id, company_id)
    REFERENCES contracts (id, company_id),
  -- Signalen i SAMMA bolag och SAMMA avtal som raden säger.
  CONSTRAINT uppdrag_scopeavgorande_signal_fk FOREIGN KEY (signal_id, company_id, contract_id)
    REFERENCES uppdrag_scopesignal (id, company_id, contract_id),
  CONSTRAINT uppdrag_scopeavgorande_underlag_fk FOREIGN KEY (underlag_ref_id, company_id)
    REFERENCES uppdrag_referens (id, company_id),
  CONSTRAINT uppdrag_scopeavgorande_tillagg_fk FOREIGN KEY (tillagg_approval_id, company_id)
    REFERENCES action_approvals (id, company_id),
  -- Exakt 0068:s två värden. Tystnaden är ingen rad, aldrig ett tredje värde.
  CONSTRAINT uppdrag_scopeavgorande_avgorande CHECK (avgorande IN ('innanfor', 'utanfor')),
  CONSTRAINT uppdrag_scopeavgorande_lopnummer CHECK (lopnummer >= 1),
  -- Vem och när saknas bara på en överförd rad, och en överförd rad har aldrig
  -- en gissad stämpel.
  CONSTRAINT uppdrag_scopeavgorande_vem_och_nar
    CHECK ((avgjort_av IS NULL) = overford AND (avgjort_nar IS NULL) = overford),
  -- Ett tillägg följer bara av ”utanför”, och bara av ett avgörande som gjordes
  -- här (de överförda köade aldrig något ur raden).
  CONSTRAINT uppdrag_scopeavgorande_tillagg_vid_utanfor
    CHECK (tillagg_approval_id IS NULL OR (avgorande = 'utanfor' AND NOT overford)),
  -- Sista försvarslinjen bakom radlåset. Ingen kod fångar krocken.
  CONSTRAINT uppdrag_scopeavgorande_lopnummer_uk UNIQUE (company_id, signal_id, lopnummer),
  -- En köpost hör till högst ett avgörande.
  CONSTRAINT uppdrag_scopeavgorande_tillagg_uk UNIQUE (tillagg_approval_id)
);

-- Läsningen är ”avtalets avgöranden per signal i löpnummerordning”.
CREATE INDEX IF NOT EXISTS uppdrag_scopeavgorande_avtal_idx
  ON uppdrag_scopeavgorande (company_id, contract_id, signal_id, lopnummer);

-- ---------------------------------------------------------------------------
-- 5) Kommentarer, RLS och rättigheter (husmönstret, 0073/0080)
-- ---------------------------------------------------------------------------
-- Kategorin står först: ägandeprovet och Hermes agandegrans.py läser första ledet.
COMMENT ON TABLE uppdrag_scopeavgorande IS
  'Kategori: BASELINE, append-only. Varje avgörande av en scopesignal är en egen rad med löpnummer per signal: innanför eller utanför, vem, när och på vilket underlag. Ett nytt avgörande läggs till och skriver aldrig över det förra. app har SELECT + INSERT och ingenting annat.';
COMMENT ON COLUMN uppdrag_scopeavgorande.overford IS
  'Raden fördes över ur 0068:s kolumn uppdrag_scopesignal.avgjord av migration 0081. Vem och när saknas i underlaget och gissas inte.';
COMMENT ON COLUMN uppdrag_scopeavgorande.underlag_ref_id IS
  'Signalens underlag när avgörandet gjordes.';
COMMENT ON COLUMN uppdrag_scopeavgorande.tillagg_approval_id IS
  'Köposten för det tillägg avgörandet köade. Den nya versionen nås genom köpostens beslutsrad.';

ALTER TABLE uppdrag_scopeavgorande ENABLE ROW LEVEL SECURITY;
ALTER TABLE uppdrag_scopeavgorande FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS uppdrag_scopeavgorande_select ON uppdrag_scopeavgorande;
CREATE POLICY uppdrag_scopeavgorande_select ON uppdrag_scopeavgorande FOR SELECT
  USING (app_has_company_access(company_id));

DROP POLICY IF EXISTS uppdrag_scopeavgorande_insert ON uppdrag_scopeavgorande;
CREATE POLICY uppdrag_scopeavgorande_insert ON uppdrag_scopeavgorande FOR INSERT
  WITH CHECK (app_has_company_access(company_id));

-- Ingen UPDATE- eller DELETE-policy och ingen sådan rättighet: det som aldrig
-- beviljats finns inte, så ingen REVOKE behövs (0003).
GRANT SELECT, INSERT ON uppdrag_scopeavgorande TO app;

-- ---------------------------------------------------------------------------
-- 6) Överföringen, och därefter avslutstriggern
-- ---------------------------------------------------------------------------
-- Överföringen kommer FÖRE triggern, så att också ett avslutat uppdrags
-- avgörande förs över. En signal utan svar får ingen rad. En andra körning
-- skriver inga nya rader (NOT EXISTS).
INSERT INTO uppdrag_scopeavgorande
  (company_id, contract_id, signal_id, lopnummer, avgorande, underlag_ref_id, overford)
SELECT s.company_id, s.contract_id, s.id, 1, s.avgjord, s.underlag_ref_id, true
  FROM uppdrag_scopesignal s
 WHERE s.avgjord IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM uppdrag_scopeavgorande a
                    WHERE a.company_id = s.company_id AND a.signal_id = s.id);

-- Samma regel som på 0068:s tabeller, på ett ställe: ett avslutat uppdrag tar
-- inte emot avgöranden. Funktionen ur 0068 ändras inte.
DROP TRIGGER IF EXISTS uppdrag_scopeavgorande_vagrar_avslutat ON uppdrag_scopeavgorande;
CREATE TRIGGER uppdrag_scopeavgorande_vagrar_avslutat
  BEFORE INSERT OR UPDATE OR DELETE ON uppdrag_scopeavgorande
  FOR EACH ROW EXECUTE FUNCTION vagrar_skrivning_pa_avslutat();

-- ---------------------------------------------------------------------------
-- 7) Frysningen av kolumnen `avgjord`
-- ---------------------------------------------------------------------------
-- B-8: ”därefter skrivs kolumnen inte mer”. En trigger och inte rättigheter:
-- kolumnrättigheter hade krävt REVOKE UPDATE på hela tabellen, och
-- `lankaTillaggetTillSignal` behöver sin UPDATE av `ledde_till_part_id`.
-- Triggern gäller varje roll och varje väg, också ägarrollen.
CREATE OR REPLACE FUNCTION fryser_scopesignalens_avgjord() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (TG_OP = 'INSERT' AND NEW.avgjord IS NOT NULL)
     OR (TG_OP = 'UPDATE' AND NEW.avgjord IS DISTINCT FROM OLD.avgjord) THEN
    RAISE EXCEPTION 'uppdrag_scopesignal.avgjord skrivs inte sedan 0081 — ett avgörande är en ny rad i uppdrag_scopeavgorande';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS uppdrag_scopesignal_fryser_avgjord ON uppdrag_scopesignal;
CREATE TRIGGER uppdrag_scopesignal_fryser_avgjord
  BEFORE INSERT OR UPDATE ON uppdrag_scopesignal
  FOR EACH ROW EXECUTE FUNCTION fryser_scopesignalens_avgjord();

-- Den gamla tabellkommentaren (”avgjord = NULL betyder obesvarad”) är inte
-- längre sann. Kategorin står fortfarande först.
COMMENT ON TABLE uppdrag_scopesignal IS
  'Kategori: BASELINE. En tänd fras ur scopelinjerna. Avgörandena står i uppdrag_scopeavgorande; en signal utan avgörande är obesvarad — tystnad blir aldrig ett ja.';
COMMENT ON COLUMN uppdrag_scopesignal.avgjord IS
  'Fryst sedan 0081: värdet fördes över till uppdrag_scopeavgorande och skrivs inte mer. Läs avgörandet ur den tabellen.';
