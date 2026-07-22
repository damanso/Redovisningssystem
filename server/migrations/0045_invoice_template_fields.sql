-- Fakturamallen: fälten som Locollabs riktiga, skickade fakturor innehåller
-- (porterad från faktura 0000024) men som saknades i schemat.
--
-- Bolaget: BIC/Swift och hemsida (metadatakolumnen resp. sidfoten på PDF:en)
-- samt logotyp (bild uppe till höger). Fakturan: "Vår referens" (Er referens
-- är sedan tidigare kolumnen reference) och "Leveranstidpunkt" (fritext,
-- t.ex. "Juni 2026").

ALTER TABLE companies
  ADD COLUMN bic          text,
  ADD COLUMN website      text,
  ADD COLUMN logo_file_id uuid;

-- Tenant-säker logotypkoppling: komposit-FK:n (logo_file_id, id) ->
-- files (id, company_id) gör det OMÖJLIGT att peka på en fil i ett annat
-- bolag, oavsett vad API-lagret släpper igenom. Raderas filen nollställs
-- enbart logo_file_id (kolumnlistan på SET NULL), aldrig companies.id.
CREATE UNIQUE INDEX files_id_company_uk ON files (id, company_id);
ALTER TABLE companies
  ADD CONSTRAINT companies_logo_file_fk
  FOREIGN KEY (logo_file_id, id) REFERENCES files (id, company_id)
  ON DELETE SET NULL (logo_file_id);

ALTER TABLE invoices
  ADD COLUMN our_reference   text,
  ADD COLUMN delivery_period text;
