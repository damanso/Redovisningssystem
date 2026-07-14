-- Fas D4: periodisk sammanställning (EU-moms). För att rapportera EU-försäljning per
-- köpare behövs köparens momsregistreringsnummer (VAT-nummer med landskod, t.ex.
-- DE811234567). BAS-kontona räcker inte — momsnumret hör till kunden. Fältet är valfritt
-- (bara EU-kunder har det) och används enbart för den periodiska sammanställningen.

ALTER TABLE customers ADD COLUMN vat_number text;
