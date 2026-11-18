-- Privat och företag i samma CRM, steg 3: en privat person ligger aldrig hos kunden.
--
-- Steg 2 lät en privat person ligga på en organisation som är kopplad till
-- kundregistret: kundkortet dolde henne, men hennes kontaktpunkter stod i
-- kundens kronologi (crmThread.ts) och hon raderades med kunden vid en
-- GDPR-radering (gdpr.ts). Granskningen hittade dessutom en väg till: en
-- kontaktpunkt eller ett åtagande som bär kundens organization_id och en privat
-- persons person_id visar henne i kronologin, också när hon inte hör till
-- kunden. Leads beslut 18/11: förbjud det, samma mönster som 0088.
--
-- Regeln, utöver 0087 och 0088: för varje organisation med customer_id gäller
--
--   P1. ingen privat person har den som organization_id;
--   P2. ingen kontaktpunkt eller inget åtagande som bär den som organization_id
--       bär en privat person som person_id.
--
-- Den prövas från varje håll som kan öppna vägen:
--
--   - personen skrivs, flyttas eller blir privat (crm.people);
--   - organisationen kopplas till kundregistret (crm.organizations);
--   - en kontaktpunkt eller ett åtagande skrivs eller flyttas
--     (crm.interactions, crm.commitments).
--
-- Låsordningen (granskningens låga fynd om 0088). 0088 låste personen före
-- hennes organisation, medan mergeOrganizations låser organisationerna FOR
-- UPDATE och sedan flyttar personerna. Samtidigt kunde de låsa varandra (40P01).
-- Här låses organisationerna alltid först, sedan personen. Raden som triggern
-- själv skriver är låst av satsen redan när triggern körs; det går inte att
-- ändra i en trigger, så tjänstelagret låser organisationerna innan det skriver
-- en person eller ett åtagande (crmSfarByte.ts) och håller därmed samma ordning.
--
-- Raderna läses med FOR SHARE och prövas EFTER låset, aldrig med villkoret i
-- WHERE: samma skäl som i 0088.
--
-- Migrationen är additiv: en ny version av funktionen och två nya triggrar,
-- inga kolumner och inga data. Ingen DROP TRIGGER: den tar ACCESS EXCLUSIVE och
-- hade ställt också läsningarna (Min sida, Idag, crm_today) i kö bakom en lång
-- transaktion (granskningens andra låga fynd om 0088). CREATE TRIGGER tar SHARE
-- ROW EXCLUSIVE, som väntar ut pågående skrivningar men släpper igenom
-- läsningar. lock_timeout gör att migrationen hellre fäller än köar: får den
-- inte låset inom fem sekunder avbryts den, ingenting är ändrat, och den körs om.
--
-- Triggern på personen från 0088 (UPDATE OF organization_id) står kvar; den nya
-- på samma tabell fångar INSERT och UPDATE OF sfar. Ändras båda kolumnerna i
-- samma sats körs funktionen två gånger, med samma utfall.
--
-- Befintliga rader prövas inte av migrationen: en trigger slår bara till vid
-- skrivning. Rapporten (BYGGRAPPORT-crm-sfar-3.md) har en läsfråga som visar om
-- driften har någon rad som redan bryter mot P1 eller P2.

SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION crm.privat_utanfor_bokforingen() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  kund uuid;
  personens_org uuid;
  personens_kund uuid;
  personens_sfar text;
  igen uuid;
BEGIN
  IF TG_TABLE_NAME IN ('commitments', 'interactions') THEN
    -- 1. Radens organisation.
    IF NEW.organization_id IS NOT NULL THEN
      SELECT o.customer_id INTO kund FROM crm.organizations o
       WHERE o.id = NEW.organization_id AND o.company_id = NEW.company_id
       FOR SHARE;
    END IF;
    -- 2. Personens organisation, sedan personen. Flyttas personen mellan
    --    läsningen och låset börjar vi om med den nya organisationen.
    IF NEW.person_id IS NOT NULL THEN
      LOOP
        SELECT p.organization_id INTO personens_org FROM crm.people p
         WHERE p.id = NEW.person_id AND p.company_id = NEW.company_id;
        personens_kund := NULL;
        IF personens_org IS NOT NULL THEN
          SELECT o.customer_id INTO personens_kund FROM crm.organizations o
           WHERE o.id = personens_org AND o.company_id = NEW.company_id
           FOR SHARE;
        END IF;
        SELECT p.organization_id, p.sfar INTO igen, personens_sfar FROM crm.people p
         WHERE p.id = NEW.person_id AND p.company_id = NEW.company_id
         FOR SHARE;
        EXIT WHEN igen IS NOT DISTINCT FROM personens_org;
      END LOOP;
    END IF;

    -- Två nivåer med flit: PL/pgSQL utvärderar NEW.sfar också när första ledet
    -- i ett AND är falskt, och kontaktpunkten har ingen sfär.
    IF TG_TABLE_NAME = 'commitments' THEN
      IF NEW.sfar = 'privat' THEN
        IF kund IS NOT NULL THEN
          RAISE EXCEPTION 'ett privat åtagande kan inte ligga på en organisation som är kopplad till kundregistret';
        END IF;
        IF personens_kund IS NOT NULL THEN
          RAISE EXCEPTION 'ett privat åtagande kan inte ligga på en person hos en organisation som är kopplad till kundregistret';
        END IF;
      END IF;
    END IF;
    -- P2: en privat person på en post hos kunden.
    IF personens_sfar = 'privat' AND kund IS NOT NULL THEN
      RAISE EXCEPTION 'en privat person kan inte stå på en post hos en organisation som är kopplad till kundregistret';
    END IF;

  ELSIF TG_TABLE_NAME = 'organizations' THEN
    -- Raden är låst av satsen. De som skriver personer, kontaktpunkter och
    -- åtaganden på den låser den FOR SHARE, så de väntar på varandra.
    IF NEW.customer_id IS NOT NULL THEN
      IF EXISTS (
           SELECT 1 FROM crm.commitments c
            WHERE c.company_id = NEW.company_id AND c.sfar = 'privat'
              AND (c.organization_id = NEW.id
                   OR c.person_id IN (SELECT p.id FROM crm.people p
                                       WHERE p.company_id = NEW.company_id AND p.organization_id = NEW.id))) THEN
        RAISE EXCEPTION 'en organisation med privata åtaganden kan inte kopplas till kundregistret';
      END IF;
      -- P1 och P2.
      IF EXISTS (
           SELECT 1 FROM crm.people p
            WHERE p.company_id = NEW.company_id AND p.sfar = 'privat'
              AND (p.organization_id = NEW.id
                   OR p.id IN (SELECT i.person_id FROM crm.interactions i
                                WHERE i.company_id = NEW.company_id AND i.organization_id = NEW.id)
                   OR p.id IN (SELECT c.person_id FROM crm.commitments c
                                WHERE c.company_id = NEW.company_id AND c.organization_id = NEW.id))) THEN
        RAISE EXCEPTION 'en organisation med privata personer kan inte kopplas till kundregistret';
      END IF;
    END IF;

  ELSIF TG_TABLE_NAME = 'people' THEN
    IF NEW.organization_id IS NOT NULL THEN
      SELECT o.customer_id INTO kund FROM crm.organizations o
       WHERE o.id = NEW.organization_id AND o.company_id = NEW.company_id
       FOR SHARE;
      IF kund IS NOT NULL THEN
        -- P1.
        IF NEW.sfar = 'privat' THEN
          RAISE EXCEPTION 'en privat person kan inte ligga på en organisation som är kopplad till kundregistret';
        END IF;
        -- 0088: personens privata åtaganden följer med henne.
        IF TG_OP = 'UPDATE' AND EXISTS (
             SELECT 1 FROM crm.commitments c
              WHERE c.company_id = NEW.company_id AND c.person_id = NEW.id AND c.sfar = 'privat') THEN
          RAISE EXCEPTION 'en person med privata åtaganden kan inte flyttas till en organisation som är kopplad till kundregistret';
        END IF;
      END IF;
    END IF;
    -- P2: personen blir privat och står redan på en post hos en kund. En ny
    -- person har inga poster än. Organisationerna låses i id-ordning innan de
    -- prövas, så att en samtidig kundkoppling av någon av dem väntar.
    IF TG_OP = 'UPDATE' AND NEW.sfar = 'privat' AND OLD.sfar IS DISTINCT FROM 'privat' THEN
      PERFORM 1 FROM crm.organizations o
       WHERE o.company_id = NEW.company_id
         AND o.id IN (SELECT i.organization_id FROM crm.interactions i
                       WHERE i.company_id = NEW.company_id AND i.person_id = NEW.id
                      UNION
                      SELECT c.organization_id FROM crm.commitments c
                       WHERE c.company_id = NEW.company_id AND c.person_id = NEW.id)
       ORDER BY o.id
       FOR SHARE OF o;
      IF EXISTS (
           SELECT 1 FROM crm.organizations o
            WHERE o.company_id = NEW.company_id AND o.customer_id IS NOT NULL
              AND o.id IN (SELECT i.organization_id FROM crm.interactions i
                            WHERE i.company_id = NEW.company_id AND i.person_id = NEW.id
                           UNION
                           SELECT c.organization_id FROM crm.commitments c
                            WHERE c.company_id = NEW.company_id AND c.person_id = NEW.id)) THEN
        RAISE EXCEPTION 'personen står på poster hos en organisation som är kopplad till kundregistret och kan därför inte bli privat';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END
$$;

-- Personen: ny, eller bytt sfär. Flytten (UPDATE OF organization_id) fångas av
-- triggern från 0088, som anropar samma funktion.
CREATE TRIGGER people_sfar_privat_utanfor_bokforingen
  BEFORE INSERT OR UPDATE OF sfar ON crm.people
  FOR EACH ROW EXECUTE FUNCTION crm.privat_utanfor_bokforingen();

-- Kontaktpunkten: en privat person på en post hos kunden (P2).
CREATE TRIGGER interactions_privat_utanfor_bokforingen
  BEFORE INSERT OR UPDATE OF organization_id, person_id ON crm.interactions
  FOR EACH ROW EXECUTE FUNCTION crm.privat_utanfor_bokforingen();

-- Åtagandets och organisationens triggrar (0087, 0088) står kvar: de anropar
-- samma funktion, som nu också prövar P1 och P2.
