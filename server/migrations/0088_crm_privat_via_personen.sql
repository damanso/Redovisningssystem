-- Privat och företag i samma CRM, steg 2: bokföringsgränsen prövar också personen.
--
-- Granskningen av steg 1 hittade en väg förbi spärren i 0087. Ett privat
-- åtagande som bara bär person_id, till en person på en organisation som är
-- kopplad till kundregistret, passerade både tjänstelagret och triggern, som
-- bara läste NEW.organization_id. Kundrelationens kronologi (crmThread.ts) och
-- GDPR-raderingen (gdpr.ts) läser åtagandena också via organisationens
-- personer, så åtagandet hamnade bredvid kundens fakturor och betalningar.
--
-- Regeln blir därför: ett privat åtagande ligger aldrig på en kundkopplad
-- organisation, varken direkt eller via sin person. Den prövas från alla tre
-- håll som kan öppna vägen:
--
--   1. åtagandet skrivs eller flyttas (sfar, organization_id, person_id);
--   2. organisationen kopplas till kundregistret (customer_id), och den eller
--      någon av dess personer har ett privat åtagande;
--   3. personen flyttas till en kundkopplad organisation (organization_id), och
--      personen har ett privat åtagande.
--
-- Raderna läses med FOR SHARE. Utan radlås kunde en samtidig INSERT av ett
-- privat åtagande och en UPDATE av customer_id båda gå igenom under READ
-- COMMITTED, eftersom ingen av dem såg den andras ändring (granskningens
-- låga fynd om 0087). Med låset väntar den senare skrivningen på den förra och
-- prövar sedan mot det som faktiskt blev kvar. Främmande nyckeln tar bara
-- FOR KEY SHARE, som inte krockar med en UPDATE av customer_id; därför låset.
--
-- Rent additiv: inga kolumner, inga data. Driftens åtaganden är alla
-- 'foretag', så ingen befintlig rad prövas annorlunda. Låsen är korta:
-- CREATE OR REPLACE FUNCTION låser ingen tabell, och DROP/CREATE TRIGGER tar
-- ett kort lås på var och en av de två tabellerna crm.commitments och
-- crm.people, utan att skriva om dem.

CREATE OR REPLACE FUNCTION crm.privat_utanfor_bokforingen() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  kund uuid;
  personens_org uuid;
BEGIN
  -- Raderna låses på id och prövas EFTER låset, aldrig med villkoret i WHERE:
  -- en rad vars synliga version inte uppfyller villkoret låses inte alls, och
  -- då väntar ingen på en samtidig transaktion som just håller på att koppla
  -- organisationen. Efter väntan läser FOR SHARE radens senaste version.
  IF TG_TABLE_NAME = 'commitments' THEN
    IF NEW.sfar = 'privat' THEN
      IF NEW.organization_id IS NOT NULL THEN
        SELECT o.customer_id INTO kund FROM crm.organizations o
         WHERE o.id = NEW.organization_id AND o.company_id = NEW.company_id
         FOR SHARE;
        IF kund IS NOT NULL THEN
          RAISE EXCEPTION 'ett privat åtagande kan inte ligga på en organisation som är kopplad till kundregistret';
        END IF;
      END IF;
      -- Personen först, sedan hennes organisation: samma ordning som en flytt
      -- av personen låser dem i (gren 3 nedan).
      IF NEW.person_id IS NOT NULL THEN
        SELECT p.organization_id INTO personens_org FROM crm.people p
         WHERE p.id = NEW.person_id AND p.company_id = NEW.company_id
         FOR SHARE;
        IF personens_org IS NOT NULL THEN
          SELECT o.customer_id INTO kund FROM crm.organizations o
           WHERE o.id = personens_org AND o.company_id = NEW.company_id
           FOR SHARE;
          IF kund IS NOT NULL THEN
            RAISE EXCEPTION 'ett privat åtagande kan inte ligga på en person hos en organisation som är kopplad till kundregistret';
          END IF;
        END IF;
      END IF;
    END IF;
  ELSIF TG_TABLE_NAME = 'organizations' THEN
    IF NEW.customer_id IS NOT NULL AND EXISTS (
         SELECT 1 FROM crm.commitments c
          WHERE c.company_id = NEW.company_id AND c.sfar = 'privat'
            AND (c.organization_id = NEW.id
                 OR c.person_id IN (SELECT p.id FROM crm.people p
                                     WHERE p.company_id = NEW.company_id AND p.organization_id = NEW.id))) THEN
      RAISE EXCEPTION 'en organisation med privata åtaganden kan inte kopplas till kundregistret';
    END IF;
  ELSIF TG_TABLE_NAME = 'people' THEN
    IF NEW.organization_id IS NOT NULL THEN
      SELECT o.customer_id INTO kund FROM crm.organizations o
       WHERE o.id = NEW.organization_id AND o.company_id = NEW.company_id
       FOR SHARE;
      IF kund IS NOT NULL AND EXISTS (
           SELECT 1 FROM crm.commitments c
            WHERE c.company_id = NEW.company_id AND c.person_id = NEW.id AND c.sfar = 'privat') THEN
        RAISE EXCEPTION 'en person med privata åtaganden kan inte flyttas till en organisation som är kopplad till kundregistret';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END
$$;

-- Åtagandet: person_id läggs till bland kolumnerna som triggar.
DROP TRIGGER commitments_privat_utanfor_bokforingen ON crm.commitments;
CREATE TRIGGER commitments_privat_utanfor_bokforingen
  BEFORE INSERT OR UPDATE OF sfar, organization_id, person_id ON crm.commitments
  FOR EACH ROW EXECUTE FUNCTION crm.privat_utanfor_bokforingen();

-- Personen: bara en flytt kan öppna vägen. En ny person har inga åtaganden än.
CREATE TRIGGER people_privat_utanfor_bokforingen
  BEFORE UPDATE OF organization_id ON crm.people
  FOR EACH ROW EXECUTE FUNCTION crm.privat_utanfor_bokforingen();

-- Organisationens trigger (0087) står kvar: den anropar samma funktion, som nu
-- också prövar organisationens personer.
