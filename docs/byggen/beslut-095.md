# Bygge beslut #95 — Tidsposten får livscykelstatus (förslag/godkänd/justerad/ignorerad/fakturerad) och debiterbara minut

Datum: 2026-09-01 23:47 · Branch: cto/tidsposten-f-r-livscykelstatus-f-rslag-g-95 · Overlamning: #87

## Mal
Tidsposten får livscykelstatus (förslag/godkänd/justerad/ignorerad/fakturerad) och debiterbara minuter skilt från registrerade, med fakturalås via invoice_id — PRD §9 steg 1.

## Kravspec (claude-fable-5) — sjalvbarande, med KALLA och ARKITEKTUR
```
Jag har verifierat underlaget mot koden (0017/0046/0047/0053, `registry.ts:1105`, `projects.ts:86–190`, `invoiceAppendix.ts:141–176`, `execute.ts` actor-begreppet). Kravspecen:

MAL | time_entries bär livscykelstatus och debiterbara minuter skilt från registrerade, med fakturalås via invoice_id — så samma timmar aldrig kan faktureras två gånger och juliposterna kan omklassas (PRD_TIDSRAPPORTERING §9 steg 1; löser julifelet i §1).
KALLA | Överlämning #87 inkl. tillägget 1/9 23:15 (varv 3-kraven), Davids ja 1/9 på CTO-frågan samt hans villkor för datafixen (idempotent, inga hårdkodade uuid:n, spårbar per rad).
ARKITEKTUR | Endast befintliga mönster: numrerad migration i kedjan med komposit-FK som 0047 rad 31, executeAction→registry→tjänstelager, zod `.strict()` ur lib/validation.ts, withTenantTransaction + writeAudit i samma transaktion, buildAllowlistedUpdate för UPDATE, vitest mot riktig Postgres.
KRAV-1 | Migration 0062: time_entries får `status text NOT NULL CHECK IN ('forslag','godkand','justerad','ignorerad','fakturerad')`, `billable_minutes integer NOT NULL CHECK (>=0 AND <=1440)`, `source text NOT NULL DEFAULT 'manuell' CHECK IN ('manuell','kalender','mail','harledd')`, `source_ref text`, `adjustment_reason text`, `approved_by uuid REFERENCES users`, `approved_at timestamptz`, `invoice_id uuid` med komposit-FK `(invoice_id, company_id) → invoices (id, company_id)` som 0047. Kolumnen `minutes` behålls oförändrad (registrerade minuter).
KRAV-2 | Backfill i 0062: invoiced=true → 'fakturerad'; billable=false → 'ignorerad' med billable_minutes=0; övriga → 'godkand' med billable_minutes=minutes. Migrationen är idempotent (kedjan körs om utan fel eller dubbeleffekt).
KRAV-3 | Datafix i 0062 som idempotent datajobb utan hårdkodade uuid:n: julifakturans 20 poster identifieras på projekt + period + fakturan med `effective_invoice_number=27` (kolumn ur 0046) och sätts till 'fakturerad' + invoice_id; de två icke-debiterbara identifieras på beskrivningen (admin resp. supportmatris) och sätts till 'ignorerad' med adjustment_reason. Varje ändrad rad spårbar i efterhand (auditlogg eller migrationens egen loggtabell/kommentar).
KRAV-4 | log_time (`registry.ts:1105` → `createTimeEntry` i `projects.ts:186`): nya valfria fält `billable_minutes` (default = minutes) och `adjustment_reason` (KRÄVS med 400 när billable_minutes ≠ minutes). Status vid skapande: 'godkand' när `ctx.actor` är människa, 'forslag' när agent; approved_by/approved_at sätts när status blir godkand/justerad.
KRAV-5 | Ny action `update_time_entry` (sensitivity write): får ändra work_date, minutes, billable_minutes, description, status, adjustment_reason via buildAllowlistedUpdate på post som INTE är 'fakturerad' (annars 409 `time_entry_locked`). Tillåtna byten: forslag→godkand|justerad|ignorerad, godkand↔justerad↔ignorerad, ignorerad→godkand; aldrig till eller från 'fakturerad'. 'justerad' och 'ignorerad' kräver adjustment_reason. Auditlogg via withTenantTransaction.
KRAV-6 | update_time_entry skriver ALDRIG tyst om debiterbara minuter: ändras `minutes` utan att `billable_minutes` skickas lämnas billable_minutes orörd; skiljer de sig därefter krävs status 'justerad' med adjustment_reason (varv 3, fynd 1).
KRAV-7 | Ny action `list_time_entries` (sensitivity read): filter project_id, status, from, to, actor; returnerar minutes, billable_minutes, status, source, source_ref, invoice_id.
KRAV-8 | `appendixFromTimeEntries` (`invoiceAppendix.ts:141–176`): urvalet blir `status IN ('godkand','justerad') AND invoice_id IS NULL` med `SELECT … FOR UPDATE`; bilagans minuter = billable_minutes; UPDATE till 'fakturerad' + invoice_id (+ invoiced=true) i samma transaktion, villkorad på `invoice_id IS NULL AND status IN ('godkand','justerad')`, och antalet uppdaterade rader måste vara lika med antalet valda — annars rollback med 409 `time_entries_changed` (varv 3, fynd 2).
KRAV-9 | Synk i tjänstelagret i SAMMA transaktion vid varje statusändring: `invoiced = (status='fakturerad')`, `billable = (status<>'ignorerad')` — så läsarna (`projects.ts:86/114/134`, steering.ts, view/routes.ts, crmDerivations.ts, RLS-policyn i 0053) fungerar oförändrade. Statusjämförelser går via hjälpfunktion (`arGodkannande`), inte inline-literaler (typecheck-fällan "no overlap" från varv 3).
KRAV-10 | docs/MCP_ACTIONS.md uppdateras med log_time-ändringen och de två nya actionsen; sessionslogg i docs/STATUS.md.
ACCEPTANS | `npm run migrate` två gånger utan fel; `npm test` och `npm run build` gröna med inklistrad utdata. Tester i server/test/ bevisar: backfillens tre klasser samt julidatafixen (faktura 27, 20+2 poster) körda ur migrationsfilen mot fixturdata; 409 time_entry_locked; varje tillåten och otillåten statusövergång; appendix-urvalet på status + invoice_id; samt två SAMTIDIGA transaktioner som fakturerar samma period där exakt en lyckas och den andra får 409.
AVGRANSNING | Minsta möjliga ändring: `minutes` byter inte namn, billable/invoiced tas inte bort, ingen ändring i de sex befintliga läsarna eller RLS 0053, inga nya beroenden eller mönster, datafixen rör exakt de 22 juliposterna och inget annat.
uteslutet: PRD §5:s rena modell (döpa om minutes, släppa billable/invoiced) — källan kräver det inte
uteslutet: avtalsdel_id och avtalstak — källan kräver det inte (story 3)
uteslutet: atomär fakturaskapning ur tid (create_invoice_from_time) — källan kräver det inte (story 2)
uteslutet: webbvy för att redigera tidposter — källan kräver det inte (senare story)
uteslutet: rapporter/sammanställningar över tid — källan kräver det inte
uteslutet: kalender/mail-genererade förslag (source/source_ref lagras bara som fält) — källan kräver det inte
uteslutet: flera personer eller flera bilagor per faktura — källan kräver det inte
uteslutet: delete_time_entry — källan kräver det inte ('ignorerad' täcker omklassning)
```

## Utfall
Tester: 99 passed (99) · Granskning: GODKANT | Alla tio krav är uppfyllda med minsta möjliga ändring enligt ARKITEKTUR.md (inga nya beroenden, executeAction→registry→tjänstelager, zod-strict, buildAllowlistedUpdate, komposit-FK som 0047, · Byggforsok: 1

## Modellkedja (Davids krav 17/8)
Krav+granskning: claude-fable-5 · Utveckling: claude-opus-5 · Claude Code pa Davids abonnemang — inga API-tokens
