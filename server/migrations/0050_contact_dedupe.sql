-- CRM E1: gör kontaktpersoner idempotenta.
--
-- Problemet (ur BMAD-underlaget): agenten kan SKRIVA kontakter men inte läsa
-- tillbaka dem, och det finns ingen unik-spärr. En nattlig synk som körs om
-- lägger därför dubbletter för alltid. Utan den här spärren är varje
-- härledningsjobb i E4 en dubblettgenerator.
--
-- Nyckel: e-post när den finns (den identifierar en person), annars namnet
-- inom samma part. Båda skiftlägesokänsliga.
--
-- FÖRE indexen samlas befintliga dubbletter ihop UTAN informationsförlust:
-- den äldsta raden behålls och fyller sina tomma fält från de yngre, sedan
-- tas de överflödiga bort. Ingen kontaktuppgift försvinner.

-- 1) Slå ihop dubbletter MED e-post.
WITH ranked AS (
  SELECT id, company_id, party_type, party_id, lower(email) AS key,
         row_number() OVER (PARTITION BY company_id, party_type, party_id, lower(email)
                            ORDER BY created_at, id) AS rn
  FROM party_contacts WHERE email IS NOT NULL
),
survivor AS (SELECT * FROM ranked WHERE rn = 1),
merged AS (
  SELECT s.id AS keep_id,
         min(d.name)  FILTER (WHERE d.name  IS NOT NULL) AS name,
         min(d.phone) FILTER (WHERE d.phone IS NOT NULL) AS phone,
         min(d.role)  FILTER (WHERE d.role  IS NOT NULL) AS role,
         bool_or(d.is_primary) AS is_primary
  FROM survivor s
  JOIN ranked r ON r.company_id = s.company_id AND r.party_type = s.party_type
               AND r.party_id = s.party_id AND r.key = s.key
  JOIN party_contacts d ON d.id = r.id
  GROUP BY s.id
)
UPDATE party_contacts c
SET phone      = COALESCE(c.phone, m.phone),
    role       = COALESCE(c.role, m.role),
    is_primary = c.is_primary OR m.is_primary
FROM merged m WHERE c.id = m.keep_id;

DELETE FROM party_contacts WHERE id IN (
  SELECT id FROM (
    SELECT id, row_number() OVER (PARTITION BY company_id, party_type, party_id, lower(email)
                                  ORDER BY created_at, id) AS rn
    FROM party_contacts WHERE email IS NOT NULL
  ) x WHERE rn > 1
);

-- 2) Samma sak för dubbletter UTAN e-post (nyckel: namnet).
UPDATE party_contacts c
SET phone      = COALESCE(c.phone, m.phone),
    role       = COALESCE(c.role, m.role),
    is_primary = c.is_primary OR m.is_primary
FROM (
  SELECT s.id AS keep_id,
         min(d.phone) FILTER (WHERE d.phone IS NOT NULL) AS phone,
         min(d.role)  FILTER (WHERE d.role  IS NOT NULL) AS role,
         bool_or(d.is_primary) AS is_primary
  FROM (
    SELECT id, company_id, party_type, party_id, lower(name) AS key
    FROM (SELECT *, row_number() OVER (PARTITION BY company_id, party_type, party_id, lower(name)
                                       ORDER BY created_at, id) AS rn
          FROM party_contacts WHERE email IS NULL) r
    WHERE rn = 1
  ) s
  JOIN party_contacts d ON d.company_id = s.company_id AND d.party_type = s.party_type
                       AND d.party_id = s.party_id AND lower(d.name) = s.key AND d.email IS NULL
  GROUP BY s.id
) m WHERE c.id = m.keep_id;

DELETE FROM party_contacts WHERE id IN (
  SELECT id FROM (
    SELECT id, row_number() OVER (PARTITION BY company_id, party_type, party_id, lower(name)
                                  ORDER BY created_at, id) AS rn
    FROM party_contacts WHERE email IS NULL
  ) x WHERE rn > 1
);

-- 3) Spärrarna. Partiella index: e-post när den finns, annars namn.
CREATE UNIQUE INDEX party_contacts_email_uk
  ON party_contacts (company_id, party_type, party_id, lower(email))
  WHERE email IS NOT NULL;
CREATE UNIQUE INDEX party_contacts_name_uk
  ON party_contacts (company_id, party_type, party_id, lower(name))
  WHERE email IS NULL;

-- DELETE behövs för att kunna ersätta en kontakt vid GDPR-radering; app-rollen
-- hade redan det via 0033. Inga nya grants krävs.
