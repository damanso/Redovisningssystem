# Tid, story 2/9: faktura ur godkänd tid — atomärt, låsande, med systemägt dokumentnummer (F6+F7)

Överlämning från Hermes-sidan, roll: vd.

## Vad som hittades

KÄLLA: docs/PRD_TIDSRAPPORTERING.md §1 (rad 1, 5), §4 F6+F7, §7 acceptans 9–10, §8 öppen fråga 1, §9.2. Bygger på story 1 (docs/byggen/ senaste beslut: status + billable_minutes + invoice_id på time_entries). Davids beslut 1/9 (delegerat till VD-sessionen): ÖPPEN FRÅGA 1 avgörs så här — dokumentnumret ÄGS av systemet: effective_invoice_number (migration 0046, COALESCE(external, intern), unikt per bolag) är fakturans enda nummer utåt; PDF:en och bilagan ska skriva effective_invoice_number (pdfService.ts rad 191 och 324 använder i dag invoice_number — det är felet bakom den överskrivna filen), och PDF-genereringen får aldrig skriva över en fil som hör till en annan faktura (validera på (company_id, effective_invoice_number) före lagring).

VERKLIGHETEN I KODEN: create_invoice (registry.ts rad 1003) skapar utkast ur fria lines; invoice_appendix_from_time_entries (rad 348) fyller bilagan i ett SEPARAT steg — juli-fakturan gjordes utan steg två och 20 poster blev aldrig stängda. Bilagan lagras i invoice_appendix_rows (0047), kredit finns (credit_ore i lines).

VAD SOM BYGGS (minsta ändring, samma mönster som create_invoice + appendixFromTimeEntries):
1. Ny action create_invoice_from_time (sensitivity write, samma godkännandeväg som create_invoice; bokföringen är fortfarande sensitive via befintligt book_invoice): indata customer_id, project_id, from, to, invoice_date, due_date?, reference?, our_reference?, exclude_entry_ids? (uuid[]), title?, preamble?. I EN transaktion: (a) välj time_entries med status IN ('godkand','justerad') AND invoice_id IS NULL AND project_id AND work_date i perioden, minus exclude_entry_ids (de rör inte status — de ligger kvar ofakturerade); (b) tom mängd → 400 no_time_entries; (c) skapa fakturan via befintlig createInvoice med EN rad per taxa: beskrivning = projektets namn (avtalsdel som kategori kommer i story 3), quantity = summa billable_minutes/60 (2 decimaler), unit_price = hourly_rate_ore (postens override, annars projektets), moms enligt befintlig regel; (d) bilaga kind 'time' ur samma poster (rader per datum som i dag — kategorisering per avtalsdel i story 3); (e) UPDATE time_entries SET status='fakturerad', invoiced=true, invoice_id=<ny faktura> för exakt de valda id:na — i samma transaktion, så att fakturan inte kan existera utan att posterna stängts (acceptans 9). Returnera invoice + antal poster + summa minuter.
2. Altandörren (rådslaget 1/9, KVALITET+CTO): set_invoice_appendix med kind 'time' är i dag en väg att skriva en tidsbilaga förbi tidsposterna. Den får finnas kvar men blir synlig: kräver bypass_time_entries: true + reason (loggas i auditloggen), annars 409 use_create_invoice_from_time med hänvisning. Låsning (F7): update_time_entry (story 1) svarar redan 409 på fakturerad; lägg till att delete_draft_invoice (befintlig) ÅTERÖPPNAR posterna (status tillbaka till godkand/justerad enligt billable_minutes<>minutes, invoice_id NULL, invoiced=false) när ett obokat utkast raderas — annars försvinner tiden när ett utkast slängs. En bokförd faktura ändras aldrig; kreditering går befintlig väg.
3. Dokumentnumret: pdfService använder effective_invoice_number på sida 1 och bilagans sida 2; generateInvoicePdfFile vägrar (409 pdf_number_collision) om en annan faktura i bolaget redan har en fil med samma effective_invoice_number.
4. docs/MCP_ACTIONS.md + STATUS.md sessionslogg. Tester: atomiciteten (fel i bilagesteget rullar tillbaka fakturan och lämnar posterna orörda), exclude-listan, tom period, utkastradering återöppnar, PDF-numret, ingen dubbelfakturering (andra anropet på samma period → no_time_entries).

UTANFÖR: avtalsdelar som kategorier på bilagan (story 3), rapporter (story 4), vyn (story 5).

## Rekommendation

Bygg — steg 2 i PRD §9; gör det omöjligt att upprepa julifelet och stänger öppen fråga 1 med det nummerfält som redan finns (0046).

## Så här är processen tänkt

Den mottagande rollen tar ansvaret, men frågar först David om den ska göra en för- och nackdelsanalys av lösningen som den är föreslagen här, och ta fram ett alternativ tillsammans med vd.
