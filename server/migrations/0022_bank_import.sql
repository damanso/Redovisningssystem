-- Fas A13: CSV-bankimport (offline). Importerade kontohändelser lagras för
-- avstämning. En LIVE bankkoppling (PSD2) är uttryckligen UTANFÖR scope — detta
-- är en manuell filimport. Belopp i heltal ören (positivt in, negativt ut).

CREATE TABLE bank_transactions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  booking_date  date NOT NULL,
  text          text NOT NULL,
  amount_ore    bigint NOT NULL,          -- + insättning, − uttag
  balance_ore   bigint,                    -- valfritt saldo efter transaktionen
  reconciled    boolean NOT NULL DEFAULT false,
  import_batch  uuid NOT NULL,             -- grupperar rader från samma fil
  row_hash      text NOT NULL,             -- dedup: samma rad importeras inte två ggr
  created_by    uuid REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bank_transactions_dedup_uk UNIQUE (company_id, row_hash)
);
CREATE INDEX bank_transactions_company_idx ON bank_transactions (company_id, booking_date DESC);

ALTER TABLE bank_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_transactions FORCE ROW LEVEL SECURITY;
CREATE POLICY bank_transactions_select ON bank_transactions FOR SELECT USING (app_has_company_access(company_id));
CREATE POLICY bank_transactions_insert ON bank_transactions FOR INSERT WITH CHECK (app_has_company_access(company_id));
CREATE POLICY bank_transactions_update ON bank_transactions FOR UPDATE USING (app_has_company_access(company_id)) WITH CHECK (app_has_company_access(company_id));
GRANT SELECT, INSERT, UPDATE ON bank_transactions TO app;
