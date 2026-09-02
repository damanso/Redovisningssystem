# Bygge beslut #100 — En ny action `create_invoice_from_time` som i en transaktion skapar fakturan ur godkänd/justerad tid

Datum: 2026-09-02 08:39 · Branch: cto/en-ny-action-create-invoice-from-time-so-100 · Overlamning: #89

## Mal
En ny action `create_invoice_from_time` som i en transaktion skapar fakturan ur godkänd/justerad tid (en rad per taxa), skriver tidsbilagan och låser posterna, plus synlig altandörr på `set_invoice_appendix`, återöppning vid utkastradering och PDF-kollisionsvakt.

## Kravspec (claude-fable-5) — sjalvbarande, med KALLA och ARKITEKTUR
```
Kravspecen är klar. Jag verifierade underlaget mot koden innan jag skrev: `TIDPOSTURVAL` + FOR UPDATE-låset finns i `invoiceAppendix.ts:148–224`, `createInvoice` defaultar redan konto 3001 (`invoices.ts:133`), PDF:en får redan `effective_invoice_number` (`invoices.ts:399`), `draftDelete.ts` raderar utkast utan att röra tidsposter (det är luckan KRAV-6 stänger), och livscykeln kommer från migration 0062 — inga nya migrationer behövs.

```
MAL | Faktura ur godkänd tid skapas i EN transaktion — rader, tidsbilaga och låsning av posterna — så att julifelet (faktura utan stängda tidsposter) blir strukturellt omöjligt; utkastradering återöppnar tiden och PDF:en kan aldrig skriva över en annan fakturas fil.
KALLA | Överlämning #89 (vd → sidoprojektet 2026-09-02), Davids delegering 1/9 (moms 25 %/konto 3001 som default, aldrig tyst nollpris, behåll story 1-fynden + appendix_layout-flaggan), PRD_TIDSRAPPORTERING §4 F6+F7 + §7 acceptans 9–10, migration 0046/0062.
ARKITEKTUR | Endast befintliga mönster: action i registry.ts (def, .strict()-zod, sensitivity write) → tjänst i services/ under withTenantTransaction; återanvänd createInvoice (invoices.ts) och TIDPOSTURVAL/appendixFromTimeEntries-låset (invoiceAppendix.ts: räkning före lås, FOR UPDATE, radantal = urval); auditlogg i samma transaktion; ören-heltal; company_id ur medlemskapet. Inga nya beroenden, inga nya migrationer.
KRAV-1 | Ny action create_invoice_from_time (sensitivity write): customer_id, project_id, from, to, invoice_date, due_date?, reference?, our_reference?, exclude_entry_ids? (uuid[]), title?, preamble?, appendix_layout? enum('per_datum','per_avtalsdel') default 'per_datum' — värdet 'per_avtalsdel' ger 400 tills story 3.
KRAV-2 | Tjänsten kör allt i EN transaktion: urval enligt TIDPOSTURVAL (status IN ('godkand','justerad'), invoice_id IS NULL, billable_minutes>0, work_date i [from,to], project_id) minus exclude_entry_ids, med story 1-mönstret räkning-före-lås + FOR UPDATE + radantalskontroll (409 time_entries_changed); tom mängd → 400 no_time_entries; exkluderade poster rörs inte alls.
KRAV-3 | Fakturan skapas via befintliga createInvoice med EN rad per taxa: taxa = postens hourly_rate_ore, annars projektets; quantity = summa billable_minutes/60 (2 decimaler); beskrivning = projektets namn; moms 25 % och konto 3001 när ingen annan källa anger annat; taxa saknas på både post och projekt → 400 missing_hourly_rate, aldrig tyst nollpris; invoices.project_id sätts (kolumnen finns, 0060).
KRAV-4 | Tidsbilagan (kind 'time', rader per datum) skrivs ur SAMMA låsta urval och posterna låses (status='fakturerad', invoiced=true, invoice_id=<fakturan>) i samma transaktion — fel i något steg rullar tillbaka helheten. Retur: invoice + antal poster + summa minuter.
KRAV-5 | set_invoice_appendix med kind 'time' kräver bypass_time_entries: true + reason (skrivs i auditloggen), annars 409 use_create_invoice_from_time; kind 'expense' är oförändrad.
KRAV-6 | delete_draft_invoice (draftDelete.ts) återöppnar utkastets tidsposter i samma transaktion som raderingen: status 'justerad' om billable_minutes <> minutes annars 'godkand', invoice_id = NULL, invoiced = false.
KRAV-7 | generateInvoicePdfFile (invoices.ts) vägrar med 409 pdf_number_collision om en annan faktura i bolaget redan har en PDF-fil med samma effective_invoice_number; att PDF:en skriver effective-numret finns redan (rad 399) och ändras inte.
KRAV-8 | docs/MCP_ACTIONS.md dokumenterar nya actionen + bypass-flaggan; docs/STATUS.md sessionslogg uppdateras.
KRAV-9 | Tester (vitest mot riktig Postgres, ~6): atomicitet (framprovocerat fel i bilagesteget lämnar varken faktura eller låsta poster), exclude-listan, tom period → 400, andra anropet på samma period → no_time_entries, utkastradering återöppnar posterna, taxa saknas → 400, PDF-kollision → 409.
ACCEPTANS | npm test + npm run build gröna med inklistrad utdata; testerna visar att fakturabeloppet = Σ(billable_minutes/60 × taxa) över exakt de låsta posterna, att fakturan aldrig kan existera med olåsta poster, och att auditloggen har poster för skapande, bypass och återöppning i samma transaktion som mutationen.
AVGRANSNING | Rör ENDAST registry.ts, en ny tjänstefil ovanpå createInvoice/appendixFromTimeEntries, draftDelete.ts, invoices.ts (kollisionsvakten), docs och tester. Inga migrationer, ingen ändring av book_invoice/kreditering, pdfService-layouten eller update_time_entry (409-låset finns sedan story 1).
uteslutet: avtalsdelskategorisering av bilagans rader (story 3) — kallan kraver det inte
uteslutet: rapporter over fakturerad tid (story 4) — kallan kraver det inte
uteslutet: vy/UI for tidsfakturering (story 5) — kallan kraver det inte
uteslutet: borttagning av set_invoice_appendix kind 'time' — kallan kraver det inte
uteslutet: sensitivity 'sensitive' pa create_invoice_from_time — kallan kraver det inte
uteslutet: automatisk PDF-generering i samma anrop — kallan kraver det inte
uteslutet: ny artikel/prislista for timtaxor — kallan kraver det inte
```

Två medvetna val i specen värda att känna till: `appendix_layout`-flaggan tas in i schemat nu (Davids svar kräver den) men bara `per_datum` implementeras — `per_avtalsdel` avvisas med 400 tills story 3, i linje med överlämningens avgränsning. Och KRAV-7 är medvetet smal eftersom det mesta av punkt 3 redan är byggt: bara kollisionsvakten återstår.
```

## Utfall
Tester: 101 passed (101) · Granskning: GODKANT | Bygget (6f43781) uppfyller KRAV-1–9 exakt med befintliga mönster — TIDPOSTURVAL återanvänds med exclude i predikatet, allt sker i en transaktion via withTenantTransaction, återöppning och PD · Byggforsok: 1

## Modellkedja (Davids krav 17/8)
Krav+granskning: claude-fable-5 · Utveckling: claude-opus-5 · Claude Code pa Davids abonnemang — inga API-tokens
