-- Överlämning #269 (beslut #58): bilageradens väg TILLBAKA till tidposten.
--
-- Ledet tidpost → faktura finns sedan 0062 (`time_entries.invoice_id`, satt av
-- `lasTidposterTillFaktura` i samma transaktion som låsningen). Det som saknats
-- är motriktningen: en rad på en tidsbilaga är en KOPIA av en tidpost — datum,
-- beskrivning och debiterbara minuter — utan någon pekare tillbaka till raden
-- den kopierades ur. Kedjan kund → projekt → tidpost → faktura går därför bara
-- att sluta genom att gissa på kund och datum, och en gissning som stämmer
-- nästan alltid tiger när den har fel.
--
-- Kolumnen är NULLBAR och backfillas INTE. Räknat med count(*) (aldrig
-- n_live_tup, som är en uppskattning) finns inga rader att fylla i drift, och
-- en härledning ur kund+datum för framtida handskrivna rader vore exakt den
-- gissning kolumnen finns för att slippa.
--
-- Enkel FK, inte husets komposit-FK (0047/0062/0065). `ON DELETE SET NULL` på
-- (time_entry_id, company_id) hade nollställt ÄVEN `company_id`, som är
-- NOT NULL — alltså hade raderingen av en tidpost fällt hela satsen. Tenant-
-- säkerheten bärs i stället av RLS på båda tabellerna plus av att värdet bara
-- kan komma ur `valjOchLasTidposter` inuti samma tenant-transaktion: ingen
-- indata utifrån når fältet (inget action-schema exponerar det).
--
-- IF NOT EXISTS: filen ska gå att köra om utan fel och utan dubbeleffekt.
ALTER TABLE invoice_appendix_rows
  ADD COLUMN IF NOT EXISTS time_entry_id uuid REFERENCES time_entries(id) ON DELETE SET NULL;

COMMENT ON COLUMN invoice_appendix_rows.time_entry_id IS
  'Tidposten raden kopierades ur. Sätts bara av tidsbilagan ur tidrapporteringen (appendixFromTimeEntries / createInvoiceFromTime per_datum). NULL betyder att raden är skriven för hand eller före 0074 — aldrig att kopplingen gått förlorad.';
