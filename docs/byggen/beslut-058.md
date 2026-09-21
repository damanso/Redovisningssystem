# Bygge beslut #58 — Ska tidposten få veta vilken faktura den hamnade på? Det kräver en migration: en kolumn som pekar ut

Datum: 2026-09-21 13:24 · Branch: cto/ska-tidposten-få-veta-vilken-faktura-den-58 · Overlamning: #269

## Mal
Ska tidposten få veta vilken faktura den hamnade på? Det kräver en migration: en kolumn som pekar ut fakturan som förbrukade timmen — invoice_appendix_rows.time_entry_id, eller motsvarande på time_entries.

## Kravspec (claude-fable-5) — sjalvbarande, med KALLA och ARKITEKTUR
```
Grävningen är klar. Viktigaste fyndet mot överlämningens lägesbild (mätt 25/8): halva kedjan är redan byggd sedan dess — `time_entries.invoice_id` finns (migration 0062), `lasTidposterTillFaktura` sätter den, och tidpostsidan länkar redan till fakturan (`routes.ts:5620`). Det som saknas är exakt det Davids ja gäller: bilageradens väg tillbaka till tidposten. Jag verifierade också att `time_entries` har `UNIQUE (id, company_id)` (0065), att nästa lediga migrationsnummer är 0074, och att `setInvoiceAppendix` är enda INSERT-stället för bilagerader — fältet kan alltså fyllas på en plats.

```
MAL | När bygget är klart bär varje rad i en tidsbilaga skapad ur tidrapporteringen en pekare till tidposten den kopierades ur: invoice_appendix_rows.time_entry_id (nullable, FK mot time_entries, ON DELETE SET NULL), ifylld av appendixFromTimeEntries. Ledet tidpost → faktura finns redan (time_entries.invoice_id, migration 0062; vyn länkar i routes.ts:5620) — det här bygget lägger sista ledet faktura → tidpost, så att kedjan kund → projekt → tidpost → faktura är sluten åt båda håll och R-2:s sista led kan byggas på data i stället för härledning ur kund+datum som stämmer nästan alltid och tiger när den har fel.
KALLA | Överlämning #269 (beslut #58) + Davids svar 2026-09-21 ("Helt enligt din rekommendation") på CTO:ns rekommendation ordagrant. Verifierat mot repot 2026-09-21: server/src/services/invoiceAppendix.ts (appendixFromTimeEntries rad 289 har posternas id ur valjOchLasTidposter men tappar det i setInvoiceAppendix-INSERT:en rad 117), migration 0047 (tabellens form, RLS, GRANT på tabellnivå), 0062 (time_entries.invoice_id finns), 0065 (time_entries_id_company_uk), sista migration i kedjan är 0073.
ARKITEKTUR | Endast befintliga mönster ur docs/ARKITEKTUR.md: numrerad idempotent migrationskedja i server/migrations/ (nästa nummer: 0074, körd som ägarrollen); tjänstelagret med PoolClient + companyId inuti withTenantTransaction; RLS/policies på invoice_appendix_rows (0047) och tabellnivå-GRANT:erna gäller oförändrade och räcker; zod-strict-scheman i actions-registret ändras inte (.strict() fäller redan okända fält); befintliga writeAudit-anrop i samma transaktion räcker; vitest mot riktig Postgres. Inga nya beroenden, inga nya mönster.
KRAV-1 | Migration server/migrations/0074_bilagerad_tidpost.sql: ALTER TABLE invoice_appendix_rows ADD COLUMN IF NOT EXISTS time_entry_id uuid REFERENCES time_entries(id) ON DELETE SET NULL — nullable, ingen backfill (tabellen har 0 rader i drift, räknat med count(*), inte n_live_tup), idempotent skriven som 0062/0065, med COMMENT ON COLUMN som säger att NULL betyder "rad skriven för hand eller före 0074". npm run migrate passerar två gånger i rad.
KRAV-2 | AppendixRowInput i invoiceAppendix.ts får valfritt fält time_entry_id, setInvoiceAppendix-INSERT:en (rad 117) skriver det (NULL när det saknas), och appendixFromTimeEntries sätter det per rad ur valjOchLasTidposter-resultatets e.id i rows-mappningen (rad 303) — samma transaktion som låsningen, båda anropsvägarna (create_invoice_from_time och appendix-ur-tid) får det gratis via den enda funktionen.
KRAV-3 | time_entry_id är ALDRIG indata utifrån: inga zod-scheman i actions-registret ändras, så handskrivna bilagor (setInvoiceAppendixManually, alla kinds) samt expense/category ger rader med time_entry_id NULL — en handskriven bilaga får inte kunna påstå en koppling till en tidpost den aldrig låst.
KRAV-4 | Test (i server/test/faktura-ur-tid.test.ts eller ny fil enligt husets testmönster, mot riktig Postgres): efter faktura ur godkänd tid pekar varje bilagerad på exakt den tidpost den kopierades ur (time_entry_id = postens id) och den tidposten bär samma fakturas id i invoice_id — kedjan sluten åt båda håll; samt att en handskriven tidsbilaga (bypass_time_entries med skäl) ger rader där time_entry_id är NULL.
KRAV-5 | npm test och npm run build passerar utan fel; befintliga sviter (tidpost-livscykel, faktura-ur-tid, tenant-isolering) förblir gröna oförändrade i sina påståenden.
ACCEPTANS | Granskaren kör npm run migrate (två gånger), npm test och npm run build med faktisk inklistrad utdata — inga påståenden utan bevis — och ser i schemat kolumnen med FK + ON DELETE SET NULL, i koden att enda stället som sätter fältet är appendixFromTimeEntries-vägen ur valjOchLasTidposter, att inget action-schema exponerar fältet, och att KRAV-4-testet bevisar båda riktningarna på riktiga rader.
AVGRANSNING | MINSTA möjliga ändring: en migrationsfil + radbygget i server/src/services/invoiceAppendix.ts + test. Rör INTE vyerna (fakturalankSaknas och tidpostlistorna står kvar som de är — R-2:s sista led är ett senare bygge), inte time_entries-schemat, inte getInvoiceAppendix-svaret eller något API/MCP-svar, inte actions-registrets scheman, inte auditloggens actions, inte .env eller driftdata.
uteslutet: backfill av historiska bilagerader — kallan kraver det inte
uteslutet: visning av länken faktura → tidpost i vyerna (R-2:s sista led) — kallan kraver det inte
uteslutet: time_entry_id i getInvoiceAppendix/API-svaret — kallan kraver det inte
uteslutet: komposit-FK (time_entry_id, company_id) mot time_entries — kallan kraver det inte
uteslutet: index på invoice_appendix_rows.time_entry_id — kallan kraver det inte
uteslutet: motsvarande kolumn på time_entries i stället — kallan kraver det inte
uteslutet: härledning av länken ur kund+datum för gamla rader — kallan kraver det inte
```

Två medvetna val i specen som förtjänar en rad utanför den: komposit-FK:n (husets mönster i 0047/0062) är utesluten för att `ON DELETE SET NULL` på en komposit-FK skulle nollställa även `company_id` (NOT NULL) — Davids ja gäller den enkla FK:n, och tenant-säkerheten bärs redan av RLS på båda tabellerna plus att värdet bara kan komma ur `valjOchLasTidposter` i samma tenant-transaktion. Och vyerna lämnas orörda eftersom överlämningens "Klart när" bara kräver kolumnen och ifyllnaden — "sista ledet i R-2 *går att bygga*" är nästa bygge, inte detta.
```

## Utfall
Tester: 140 passed (140) · Granskning: GODKANT | Bygget uppfyller KRAV-1–5 minimalt och enligt husets monster (enda INSERT-stallet, strict-scheman ororda, tabellniva-GRANT/RLS i 0047 tacker nya kolumnen, inga nya beroenden, API/vyer ororda · Byggforsok: 1

## Modellkedja (Davids krav 17/8, reservvag 7/9)

* krav: **claude-fable-5**
* utveckling: **claude-opus-5**
* granskning: **claude-fable-5**

Granskaren ar inte forfattaren: claude-fable-5 granskade claude-opus-5s arbete.

Allt pa Davids abonnemang - inga API-tokens.
