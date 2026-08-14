-- Relationsytan F5: kadens per relation.
--
-- Tystnadsgränsen har hittills varit ETT tal för hela bolaget (30 dagar). Det
-- är fel på ett sätt som inte syns förrän man använder ytan på riktigt: en kund
-- på månadsretainer och en kund man gör ett projekt åt vartannat år kan omöjligt
-- dela gräns. Med en gemensam gräns blir listan antingen full av namn som inte
-- borde ligga där, eller tyst om dem som borde.
--
-- Och en lista med brus i är värre än ingen lista: den lär användaren att
-- ignorera den. Dagsytan bygger på att raderna DÄR faktiskt betyder något.
--
-- NULL = använd bolagets standard. Ett tomt fält ska betyda "jag har inte
-- bestämt", aldrig "noll dagar".

ALTER TABLE crm.organizations
  ADD COLUMN cadence_days integer
    CHECK (cadence_days IS NULL OR (cadence_days >= 1 AND cadence_days <= 3650));

COMMENT ON COLUMN crm.organizations.cadence_days IS
  'Hur ofta den här relationen behöver höras av. NULL = bolagets standardgräns. Klockan nollställs av kontakt, aldrig av en inställning.';
