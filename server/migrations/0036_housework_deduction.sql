-- Fas E3: ROT/RUT-avdrag (husavdrag) på utgående fakturor enligt fakturamodellen.
-- Kunden (privatperson) betalar fakturan MINUS skattereduktionen; utföraren begär
-- resten från Skatteverket. Ingen digital begäran görs här — detta är underlaget.
--   housework_type:            'rot' (30 %) eller 'rut' (50 %) av arbetskostnaden
--   labor_cost_ore:            arbetskostnad INKL. moms (underlag för avdraget)
--   housework_reduction_ore:   beräknad skattereduktion (kapad mot årets tak)
--   buyer_personnummer:        köparens personnummer (avdraget är personligt)
--   property_designation:      fastighetsbeteckning (ROT) / BRF-lägenhet
ALTER TABLE invoices ADD COLUMN housework_type text CHECK (housework_type IN ('rot', 'rut'));
ALTER TABLE invoices ADD COLUMN labor_cost_ore bigint CHECK (labor_cost_ore IS NULL OR labor_cost_ore >= 0);
ALTER TABLE invoices ADD COLUMN housework_reduction_ore bigint NOT NULL DEFAULT 0 CHECK (housework_reduction_ore >= 0);
ALTER TABLE invoices ADD COLUMN buyer_personnummer text;
ALTER TABLE invoices ADD COLUMN property_designation text;

-- BAS 1513 "Kundfordringar – delad faktura": fordran på Skatteverket för den del av
-- fakturan som köparen inte betalar (husavdraget). Standardkonto (delas av alla bolag).
INSERT INTO accounts (account_number, name, account_type)
VALUES (1513, 'Kundfordringar delad faktura (ROT/RUT-avdrag)', 'asset')
ON CONFLICT DO NOTHING;
