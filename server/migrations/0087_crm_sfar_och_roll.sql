-- Privat och företag i samma CRM (Davids order 9/11, steg 1: data och MCP).
--
-- Allt David ska göra, som företagsledare och som privatperson, i ett och samma
-- system. Varje organisation, person och åtagande hör därför till en sfär:
-- 'foretag' eller 'privat'. Standardvärdet är 'foretag', så att inget befintligt
-- flyttas av misstag: ADD COLUMN med DEFAULT sätter värdet på varje rad som redan
-- finns. Vilka rader som ska bli privata avgör David i steg 3, inte en gissning
-- här.
--
-- Rollen är skild från statusen. Statusen beskriver relationens läge (prospekt,
-- kund, partner, före detta, arkiverad); rollen beskriver vad organisationen ÄR
-- för oss. Leverantör saknades helt, och Svealands Elbolag fick därför ligga som
-- 'partner' med en markering i anteckningen. Rollen är valfri: NULL betyder "inte
-- angiven", aldrig en gissad standard.
--
-- Bokföringsgränsen. Relationsdatan ligger redan i ett eget schema, och den enda
-- vägen härifrån in i bokföringen är kopplingen crm.organizations.customer_id
-- mot kundregistret. Kundkortet läser åtagandena via just den kopplingen. Två
-- spärrar stänger vägen för det privata:
--
--   1. En privat organisation har ingen koppling till kundregistret och kan inte
--      ha statusen 'customer' (CHECK-villkoret nedan).
--   2. Ett privat åtagande kan inte ligga på en organisation som är kopplad till
--      kundregistret, och en organisation med privata åtaganden kan inte kopplas
--      dit (triggern nedan, åt båda hållen).
--
-- Tjänstelagret fångar båda fallen först och svarar med ett tydligt fel
-- (privat_bokforingsgrans). Databasen är den yttersta garanten, också mot en
-- framtida kodväg som glömmer regeln.

ALTER TABLE crm.organizations
  ADD COLUMN sfar text NOT NULL DEFAULT 'foretag' CHECK (sfar IN ('foretag', 'privat')),
  ADD COLUMN roll text CHECK (roll IS NULL OR roll IN ('kund', 'leverantor', 'partner', 'myndighet', 'intern'));

ALTER TABLE crm.people
  ADD COLUMN sfar text NOT NULL DEFAULT 'foretag' CHECK (sfar IN ('foretag', 'privat'));

-- Åtagandet ärver sfär från sin organisation eller person när ingen anges, men
-- arvet sker när raden skrivs (tjänstelagret). Kolumnen bär sedan sitt eget
-- värde, så att ett åtagande kan sättas separat från sin motpart.
ALTER TABLE crm.commitments
  ADD COLUMN sfar text NOT NULL DEFAULT 'foretag' CHECK (sfar IN ('foretag', 'privat'));

ALTER TABLE crm.organizations
  ADD CONSTRAINT organizations_privat_utanfor_bokforingen_ck
    CHECK (sfar = 'foretag' OR (customer_id IS NULL AND status <> 'customer'));

COMMENT ON COLUMN crm.organizations.sfar IS
  'foretag eller privat. En privat organisation når aldrig bokföringen: ingen koppling till kundregistret, aldrig status customer.';
COMMENT ON COLUMN crm.organizations.roll IS
  'Vad organisationen är för oss (kund, leverantor, partner, myndighet, intern). Skild från status. NULL = inte angiven.';
COMMENT ON COLUMN crm.people.sfar IS 'foretag eller privat.';
COMMENT ON COLUMN crm.commitments.sfar IS
  'foretag eller privat. Ärvs från organisationen eller personen när åtagandet skrivs utan sfär; kan sättas separat.';

-- Spärr 2, åt båda hållen. Bara de kolumner som kan öppna vägen triggar den.
-- RAISE utan egen felkod ger P0001, samma klass som husets övriga
-- affärsregeltriggrar (felhanteraren svarar 409 rule_violation).
CREATE FUNCTION crm.privat_utanfor_bokforingen() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'commitments' THEN
    IF NEW.sfar = 'privat' AND NEW.organization_id IS NOT NULL AND EXISTS (
         SELECT 1 FROM crm.organizations o
          WHERE o.id = NEW.organization_id AND o.company_id = NEW.company_id
            AND o.customer_id IS NOT NULL) THEN
      RAISE EXCEPTION 'ett privat åtagande kan inte ligga på en organisation som är kopplad till kundregistret';
    END IF;
  ELSIF NEW.customer_id IS NOT NULL AND EXISTS (
         SELECT 1 FROM crm.commitments c
          WHERE c.organization_id = NEW.id AND c.company_id = NEW.company_id
            AND c.sfar = 'privat') THEN
    RAISE EXCEPTION 'en organisation med privata åtaganden kan inte kopplas till kundregistret';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER commitments_privat_utanfor_bokforingen
  BEFORE INSERT OR UPDATE OF sfar, organization_id ON crm.commitments
  FOR EACH ROW EXECUTE FUNCTION crm.privat_utanfor_bokforingen();
CREATE TRIGGER organizations_privat_utanfor_bokforingen
  BEFORE INSERT OR UPDATE OF customer_id ON crm.organizations
  FOR EACH ROW EXECUTE FUNCTION crm.privat_utanfor_bokforingen();
