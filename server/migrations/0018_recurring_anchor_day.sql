-- Fas A5-fix (grindfynd): återkommande fakturor tappade sin fakturadag efter en
-- kort månad. En mall med förfallodag den 30:e klampades till 28 feb och fastnade
-- sedan på den 28:e för all framtid, eftersom next_run_date (det klampade datumet)
-- användes som ny ankardag. Vi lagrar därför den ursprungliga dagen separat och
-- beräknar varje ny period från ankaret, klampat till målmånadens längd.

ALTER TABLE recurring_invoices
  ADD COLUMN anchor_day smallint NOT NULL DEFAULT 1 CHECK (anchor_day BETWEEN 1 AND 31);

-- Sätt ankardagen till dagen i nuvarande next_run_date för befintliga mallar.
UPDATE recurring_invoices SET anchor_day = EXTRACT(DAY FROM next_run_date)::smallint;
