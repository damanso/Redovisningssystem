-- Backfill: knyt redan inlästa organisationer till kundregistret.
--
-- Buggen som gjorde migreringen nödvändig: ingest-vägen — API-kontraktets
-- primära producent — kunde aldrig sätta customer_id, eftersom avsändaren inte
-- känner våra uuid:n. Organisationerna landade som prospekt med tom koppling,
-- och eftersom omsättningen hämtas via just den kopplingen räknade styr- och
-- relationsvyerna NOLL för de största kunderna. Raden fanns, namnet stämde,
-- inget fel returnerades.
--
-- Tjänstelagret slår nu upp kunden på org.nr eller namn vid varje skrivning.
-- Den här migreringen gör samma uppslag EN gång för det som redan ligger inne.
--
-- Samma två spärrar som i koden, av samma skäl — en gissning är värre än en tom
-- koppling: bara när uppslaget ger EXAKT en kund, och bara när den kunden inte
-- redan hör till en annan organisation.

-- 1) Organisationsnummer (den starkare nyckeln, jämfört på siffror).
UPDATE crm.organizations o
SET customer_id = m.customer_id,
    status = CASE WHEN o.status = 'prospect' THEN 'customer' ELSE o.status END
FROM (
  SELECT o.id AS org_id, min(c.id::text)::uuid AS customer_id
  FROM crm.organizations o
  JOIN customers c
    ON c.company_id = o.company_id
   AND length(regexp_replace(COALESCE(o.org_number, ''), '\D', '', 'g')) >= 10
   AND regexp_replace(COALESCE(c.org_number, ''), '\D', '', 'g')
     = regexp_replace(COALESCE(o.org_number, ''), '\D', '', 'g')
  WHERE o.customer_id IS NULL
    AND NOT EXISTS (SELECT 1 FROM crm.organizations x
                     WHERE x.company_id = o.company_id AND x.customer_id = c.id)
  GROUP BY o.id
  HAVING count(*) = 1          -- exakt en kandidat, annars ingen gissning
) m
WHERE o.id = m.org_id;

-- 2) Namn (skiftlägesokänsligt, trimmat) för det som blev kvar.
UPDATE crm.organizations o
SET customer_id = m.customer_id,
    status = CASE WHEN o.status = 'prospect' THEN 'customer' ELSE o.status END
FROM (
  SELECT o.id AS org_id, min(c.id::text)::uuid AS customer_id
  FROM crm.organizations o
  JOIN customers c
    ON c.company_id = o.company_id
   AND lower(btrim(c.name)) = lower(btrim(o.name))
  WHERE o.customer_id IS NULL
    AND NOT EXISTS (SELECT 1 FROM crm.organizations x
                     WHERE x.company_id = o.company_id AND x.customer_id = c.id)
  GROUP BY o.id
  HAVING count(*) = 1
) m
WHERE o.id = m.org_id;
