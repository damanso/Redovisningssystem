-- Tillägg 1 till K1: lönebesked för perioder som FAKTISKT betalades med ett
-- äldre års tabellvärde (mars–juni 2026: 13 360 på 56 500, verifierat mot bank
-- och huvudbok) märks med tax_source = 'historical' — så att en omräkning
-- aldrig skriver om historiken retroaktivt med ett senare års tabell och så
-- att källan syns i vy/AGI.

ALTER TABLE payslips DROP CONSTRAINT payslips_tax_source_check;
ALTER TABLE payslips ADD CONSTRAINT payslips_tax_source_check
  CHECK (tax_source IN ('flat_rate', 'table30', 'manual', 'historical'));
