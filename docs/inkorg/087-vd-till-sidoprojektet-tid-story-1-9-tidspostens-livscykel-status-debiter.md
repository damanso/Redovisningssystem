# Tid, story 1/9: tidspostens livscykel (status) + debiterbara minuter skilt från registrerade

Överlämning från Hermes-sidan, roll: vd.

## Vad som hittades

KÄLLA: docs/PRD_TIDSRAPPORTERING.md (i repot, §1, §3.1, §5, §9.1) — Davids PRD 1/9 med uppdraget: bygg hela PRD:n via CTO-kedjan, story för story i §9-ordningen. Davids beslut 1/9: han har delegerat ja/nej på byggfrågorna till VD-sessionen; svaret på CTO:s fråga är ja om bygget håller sig inom PRD:n och docs/ARKITEKTUR.md.

VERKLIGHETEN I KODEN: time_entries (migration 0017) har bara billable/invoiced (boolean) och minutes. invoiceAppendix.appendixFromTimeEntries (rad 141–170) plockar billable=true AND invoiced=false och sätter invoiced=true. Julifelet (PRD §1 rad 1–2): fakturan skapades utan den vägen, 20 poster ligger kvar ofakturerade, och två poster som inte skulle faktureras går inte att omklassa.

VAD SOM BYGGS (minsta ändring, samma mönster som 0051/0060):
1. Migration: time_entries får status text NOT NULL CHECK IN ('forslag','godkand','justerad','ignorerad','fakturerad'), billable_minutes integer NOT NULL CHECK (>=0 AND <=1440), source text NOT NULL DEFAULT 'manuell' CHECK IN ('manuell','kalender','mail','harledd'), source_ref text, adjustment_reason text, approved_by uuid REFERENCES users, approved_at timestamptz, invoice_id uuid (komposit-FK till invoices(id,company_id) som 0047). Kolumnen minutes BEHÅLLS som registrerade minuter (byt inte namn). Backfill: invoiced=true → 'fakturerad'; billable=false → 'ignorerad' (billable_minutes 0); annars 'godkand' med billable_minutes=minutes. invoiced/billable behålls och hålls i synk i tjänstelagret (invoiced = status='fakturerad', billable = status<>'ignorerad') så befintliga läsare (projects.ts rad 89/114, RLS 0053) inte går sönder.
2. log_time: ny valfri billable_minutes (default = minutes) och adjustment_reason (KRÄVS när billable_minutes<>minutes). Status vid skapande: 'godkand' när ctx.actor är människa, 'forslag' när actor är agent (samma actor-begrepp som executeAction redan bär). approved_by/approved_at sätts när status blir godkand/justerad.
3. Ny action update_time_entry (sensitivity write): får ändra work_date, minutes, billable_minutes, description, status, adjustment_reason på en post som INTE är 'fakturerad' (annars 409 time_entry_locked). Tillåtna statusbyten: forslag→godkand|justerad|ignorerad, godkand↔justerad↔ignorerad, ignorerad→godkand. Aldrig till eller från fakturerad (det gör bara fakturaflödet). 'justerad' kräver adjustment_reason; ignorerad kräver orsak i adjustment_reason. Auditlogg via befintlig withTenantTransaction-väg.
4. Ny action list_time_entries (read): filter project_id, status, from, to, actor; returnerar minutes, billable_minutes, status, source, source_ref, invoice_id.
5. appendixFromTimeEntries: urvalet blir status IN ('godkand','justerad') AND invoice_id IS NULL, bilagans minuter = billable_minutes, och posterna sätts till status 'fakturerad' + invoice_id (+ invoiced=true) i samma transaktion.
6. MCP-manifest/docs: docs/MCP_ACTIONS.md + STATUS.md sessionslogg. Tester i server/test/: backfillen (tre klasser), låsningen (409), statusövergångarna, appendix-urvalet på status.

UTANFÖR DENNA STORY (kommer i story 2–9): atomär fakturaskapning ur tid, avtalsdel/tak, rapporter, webbvyn för redigering, bilagor, kalender/mail-förslag, flera personer.

## Rekommendation

Bygg — det är steg 1 i PRD §9 och löser juliproblemet direkt; ingen ny arkitektur, inga nya beroenden, en migration i den befintliga kedjan.

## Så här är processen tänkt

Den mottagande rollen tar ansvaret, men frågar först David om den ska göra en för- och nackdelsanalys av lösningen som den är föreslagen här, och ta fram ett alternativ tillsammans med vd.
