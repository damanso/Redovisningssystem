-- Relationsytan F1: tillstånd som gör dagsytan avslutbar.
--
-- Designunderlaget: dagsytan ska kunna bli TOM. Då måste det gå att säga "inte
-- nu" och "aldrig" om en rad, annars återkommer samma fem namn i evighet och
-- listan blir en anklagelse i stället för ett arbetspass.
--
-- Två olika saker, med flit åtskilda:
--   snoozed_until — inte nu. Raden kommer tillbaka av sig själv.
--   muted         — sluta föreslå den här relationen. Den finns kvar i listan
--                   och i tråden, den slutar bara knacka på.
--
-- Åtagandets FÖRFALLODATUM rörs aldrig av en uppskjutning. Det är vad som
-- lovades, och det ska stå kvar även när jag väljer att inte agera i dag.

ALTER TABLE crm.commitments
  ADD COLUMN snoozed_until date;

ALTER TABLE crm.organizations
  ADD COLUMN snoozed_until date,
  ADD COLUMN muted boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN crm.commitments.snoozed_until IS
  'Dolt i dagsytan t.o.m. detta datum. Ändrar ALDRIG due_date — löftet är löftet.';
COMMENT ON COLUMN crm.organizations.snoozed_until IS
  'Dolt i dagsytans förslag t.o.m. detta datum.';
COMMENT ON COLUMN crm.organizations.muted IS
  'Föreslå aldrig den här relationen. Relationen finns kvar, den knackar bara inte på.';
