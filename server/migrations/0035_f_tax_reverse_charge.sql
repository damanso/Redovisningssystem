-- Fas E2: F-skatt + omvänd skattskyldighet (byggmoms) på utgående fakturor.
--   - approved_for_f_tax: bolaget är godkänt för F-skatt → texten "Godkänd för
--     F-skatt" ska stå på fakturan (köparen slipper göra skatteavdrag).
--   - invoices.reverse_charge: fakturan ställs ut UTAN moms; köparen är
--     betalningsskyldig för momsen (omvänd skattskyldighet inom byggsektorn).
--     Intäkten bokförs på konto 3231 och redovisas i momsdeklarationens ruta 41.
ALTER TABLE companies ADD COLUMN approved_for_f_tax boolean NOT NULL DEFAULT false;
ALTER TABLE invoices ADD COLUMN reverse_charge boolean NOT NULL DEFAULT false;

-- Standardkonto (BAS) för försäljning med omvänd skattskyldighet i byggsektorn.
-- Delas av alla bolag (company_id IS NULL). Momsdeklarationens ruta 41 läser det.
INSERT INTO accounts (account_number, name, account_type)
VALUES (3231, 'Försäljning inom byggsektorn, omvänd skattskyldighet', 'revenue')
ON CONFLICT DO NOTHING;
