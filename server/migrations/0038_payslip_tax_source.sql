-- K1: preliminärskatt enligt Skatteverkets tabell 30 (årsversionerad) ersätter
-- platt tax_rate som primär beräkning. Varje lönebesked märks med hur skatten
-- togs fram, så AGI-underlaget kan skilja tabellskatt från schablon och en
-- manuell jämkning aldrig skrivs över av en omräkning.
--   flat_rate = platt sats per anställd (fallback utanför tabellintervallet)
--   table30   = uppslag i tabell 30 kolumn 1 för lönebeskedets år
--   manual    = manuellt angiven skatt (jämkning) — rörs aldrig av omräkning

ALTER TABLE payslips
  ADD COLUMN tax_source text NOT NULL DEFAULT 'flat_rate'
    CHECK (tax_source IN ('flat_rate', 'table30', 'manual'));
