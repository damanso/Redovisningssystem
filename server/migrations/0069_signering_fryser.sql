-- Uppdragsytan, våg 2 (story S1.2): ATT SIGNERA ÄR ATT FRYSA.
--
-- 0068 gav `contracts` sitt tillstånd (utkast|fryst), backfillade de redan
-- undertecknade avtalen till 'fryst' och spärrade bekräftade tak på utkast
-- (`vagrar_baseline_i_utkast`). Men vägen TILL fryst saknades: `create_contract`
-- skapar alltid ett utkast och ingen åtgärd fryser ett kontrakt. Följden stod
-- i STATUS.md som en pinnad spärr — ett bekräftat tak gick inte att sätta på
-- ett nyskapat avtal, ens när avtalet var undertecknat. Baselinespärren var
-- alltså rätt, men det fanns ingen dörr in i det tillstånd den kräver.
--
-- Regeln är densamma som backfillens, och den skrivs här EN gång som trigger i
-- stället för som en ny åtgärdsyta: ett undertecknat avtal ÄR en
-- överenskommelse. `update_contract` med `signed_date` räcker därmed; någon
-- egen frys-åtgärd behövs inte, och kan inte heller glömmas bort av nästa
-- skrivväg in (API, MCP, vyn) — samma skäl som resten av 0068 sitter i
-- Postgres och inte i tjänstelagret.
--
-- Filen är ADDITIV: ingen ny tabell, ingen ny kolumn, ingen backfill (0068 har
-- redan fryst allt som var undertecknat). Andra körningen är ett no-op.

-- ---------------------------------------------------------------------------
-- 1) Triggerfunktionen
-- ---------------------------------------------------------------------------
-- Två regler, samma riktning:
--
--   * Finns ett undertecknandedatum ÄR kontraktet fryst. Tillståndet härleds,
--     det anges inte — då kan det heller aldrig stå i strid med datumet.
--   * Datumet går inte att ta bort igen. Utan den raden vore frysningen en
--     etikett man klickar bort i två steg (nolla `signed_date`, sätt
--     `kontrakt_tillstand`), och `vagrar_avfrysning` (0068) hade skyddat bara
--     det andra steget. Samma mönster, samma RAISE — och P0001 når klienten
--     som 409 `rule_violation` via befintliga errorHandler, aldrig som 500.
CREATE OR REPLACE FUNCTION signering_fryser_kontraktet() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.signed_date IS NOT NULL
     AND NEW.signed_date IS NULL
     AND OLD.kontrakt_tillstand = 'fryst' THEN
    RAISE EXCEPTION
      'ett fryst kontrakt behåller sitt undertecknandedatum — signeringen är frysningen';
  END IF;

  IF NEW.signed_date IS NOT NULL THEN
    NEW.kontrakt_tillstand := 'fryst';
  END IF;

  RETURN NEW;
END
$$;

-- ---------------------------------------------------------------------------
-- 2) Triggern
-- ---------------------------------------------------------------------------
-- `UPDATE OF signed_date` med flit, inte ett rent `UPDATE`: en UPDATE som bara
-- rör `kontrakt_tillstand` ska fortsätta falla på `vagrar_avfrysning` (0068)
-- med dess RAISE. BEFORE-triggrar körs i bokstavsordning på namnet, så en
-- trigger som körde på ALLA uppdateringar hade hunnit skriva tillbaka 'fryst'
-- innan `contracts_vagrar_avfrysning` läste raden — och en spärr som tyst
-- rättar i stället för att säga nej är ingen spärr. Invarianten består ändå:
-- ett utkast med undertecknandedatum kan aldrig uppstå, eftersom varje
-- skrivning av `signed_date` passerar här.
DROP TRIGGER IF EXISTS contracts_signering_fryser ON contracts;
CREATE TRIGGER contracts_signering_fryser
  BEFORE INSERT OR UPDATE OF signed_date ON contracts
  FOR EACH ROW EXECUTE FUNCTION signering_fryser_kontraktet();
