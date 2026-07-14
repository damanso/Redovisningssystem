-- Fas B2: momsredovisningsperiod per bolag (styr skatteskuld-aggregering och
-- deadlines/påminnelser). Default kvartal (vanligast för mindre aktiebolag).

ALTER TABLE companies
  ADD COLUMN vat_period text NOT NULL DEFAULT 'quarterly'
    CHECK (vat_period IN ('monthly', 'quarterly', 'yearly'));
