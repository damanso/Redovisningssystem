-- K6: momsmetod som bolagsinställning (komplement till vat_period i 0025).
--   invoice = fakturametoden (kundfordran 15xx vid fakturering; beslut
--             2026-07-21: gäller för kundfakturor fr.o.m. #24)
--   cash    = kontantmetoden (bokför vid betalning)
-- Systemet varnar (notis + audit) när ett nytt verifikat bryter mot vald
-- metod — det blockerar inte (metoden kan behöva överskridas medvetet).

ALTER TABLE companies
  ADD COLUMN vat_method text NOT NULL DEFAULT 'invoice'
    CHECK (vat_method IN ('invoice', 'cash'));
