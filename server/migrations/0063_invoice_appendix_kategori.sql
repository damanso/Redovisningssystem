-- Tredje bilagevarianten: 'category' — kategoribilaga utan datum.
--
-- Bakgrund. Fakturan till ILT för augusti 2026 skulle visa VAD arbetet gällde,
-- inte vilken dag det utfördes: "Fas 2A — Commercial Cockpit, OKRs Tool,
-- Customer Support", med timmar och belopp per kategori. Den formen fanns inte.
-- 'time' kräver ett datum per rad, så bilagan fick samma påhittade datum
-- (fakturadatumet) upprepat på varje rad — ett datum som inte betydde något
-- och som såg ut som en uppgift. Och eftersom en rad bara fick bära ANTINGEN
-- minuter ELLER ören kunde tidsraderna inte visa sitt belopp.
--
-- Ändringen är avsiktligt smal: datumlösa rader tillåts BARA för kategori-
-- bilagor. 'time' och 'expense' är specifikationer per datum — det är hela
-- deras poäng, och där ska ett saknat datum fortsätta vara ett fel.
--
-- Radtabellen känner inte till fakturans appendix_kind, så villkoret "datum
-- krävs utom för kategori" kan inte uttryckas som en enkel CHECK här. Det
-- villkoret bor i setInvoiceAppendix(). Det som återstår i databasen är den
-- svagare, men fortfarande meningsfulla, garantin att en rad aldrig är tom:
-- den måste bära minst ett värde.

ALTER TABLE invoices
  DROP CONSTRAINT IF EXISTS invoices_appendix_kind_check;
ALTER TABLE invoices
  ADD CONSTRAINT invoices_appendix_kind_check
  CHECK (appendix_kind IN ('time', 'expense', 'category'));

-- Datum blir valfritt i lagret; vilka bilagor som FÅR sakna det avgörs i
-- tjänstelagret (se kommentaren ovan).
ALTER TABLE invoice_appendix_rows
  ALTER COLUMN entry_date DROP NOT NULL;

-- Förut: exakt ett av minutes/amount_ore. Nu: minst ett. En kategorirad bär
-- båda (timmar OCH belopp); en tids- eller utläggsrad bär fortsatt ett,
-- vilket tjänstelagret upprätthåller.
ALTER TABLE invoice_appendix_rows
  DROP CONSTRAINT IF EXISTS appendix_row_exactly_one_value;
ALTER TABLE invoice_appendix_rows
  ADD CONSTRAINT appendix_row_har_varde
  CHECK (minutes IS NOT NULL OR amount_ore IS NOT NULL);
