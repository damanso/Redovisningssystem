-- Fas C2: kompletterar standardkontoplanen med de bokslutskonton som saknades för
-- att bokföra bokslutstransaktioner: avsättning/återföring av periodiseringsfond
-- och beräknad inkomstskatt. Standardkonton (company_id IS NULL) delas av alla bolag.

INSERT INTO accounts (account_number, name, account_type) VALUES
  (8811, 'Avsättning till periodiseringsfond', 'expense'),
  (8819, 'Återföring från periodiseringsfond', 'revenue'),
  (2512, 'Beräknad inkomstskatt', 'liability')
ON CONFLICT (account_number) WHERE company_id IS NULL DO NOTHING;
