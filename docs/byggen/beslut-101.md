# Bygge beslut #101 — Avtal och avtalsdelar som egna tabeller med tak per del, obligatorisk avtalsdel på tidposten när del

Datum: 2026-09-02 09:34 · Branch: cto/avtal-och-avtalsdelar-som-egna-tabeller-101 · Overlamning: #90

## Mal
Avtal och avtalsdelar som egna tabeller med tak per del, obligatorisk avtalsdel på tidposten när delar finns, 80 %-varning vid registrering, spärr med confirm_over_cap i faktureringen samt bilaga grupperad per avtalsdel — sömmen finns redan förberedd (invoiceFromTime.ts:66 avvisar 'per_avtalsdel' med hänvisning till story 3).

## Kravspec (claude-fable-5) — sjalvbarande, med KALLA och ARKITEKTUR
```
Jag har grävt klart — arkitekturen, sömmen i `invoiceFromTime.ts:66`, bilagemotorns category-variant (0063), tidpostens statuslivscykel (0062) och registrets mönster. Här är kravspecen:

MAL | Avtal och avtalsdelar som egna tabeller så att ILT-avtalets fastak (t.ex. 2A: 32 h/35 200 kr) kan uttryckas: tidposter klassas per avtalsdel, bekräftade tak ger 80 %-varning vid registrering (aldrig spärr) och forcerbar spärr i faktureringen, bilagan kan grupperas per avtalsdel — stänger luckan story 2 lämnade (invoiceFromTime.ts:66 avvisar 'per_avtalsdel').
KALLA | Överlämning #90 (inkl. tillägg 2/9 om 0063) + Davids svar 1/9 (delegerat: assign_contract_part som egen action, ingen koppling i migrationen, cap_confirmed default false, kind category, nästa migration 0064) + rådslagets beslut 1/9 (spärra aldrig registrering, varna aldrig på oläst tal).
ARKITEKTUR | Enbart befintliga mönster: mutation via actions-registret (`def` med zod `.strict()` ur `lib/validation.ts`), tjänstefil som tar `client + companyId` i `withTenantTransaction`, auditlogg i samma transaktion, idempotent migration i kedjan, RLS+GRANT som 0017, `buildAllowlistedUpdate`, belopp i ören-heltal, bilagemotorn `setInvoiceAppendix` kind 'category' (0063).
KRAV-1 | Migration `0064` skapar `contracts` (id, company_id, project_id NOT NULL→projects, customer_id, name, signed_date, payment_terms_days, hourly_rate_ore, source_file_id→files nullbar, notes, created_by, created_at/updated_at) med RLS+GRANT enligt 0017-mönstret.
KRAV-2 | Samma migration: `contract_parts` (id, company_id, contract_id, parent_part_id självreferens nullbar, code, name, description, billable default true, hourly_rate_ore nullbar, cap_hours numeric(8,2) nullbar, cap_amount_ore bigint nullbar, cap_confirmed boolean default false, valid_from date, manually_edited boolean default false, sort_order, active), unik (contract_id, code, valid_from); en ny rad med senare valid_from ersätter takvärdena, historiken består.
KRAV-3 | Samma migration: `time_entries.contract_part_id` uuid nullbar med komposit-FK (company_id, contract_part_id); INGEN befintlig post kopplas i migrationen — kopplingen görs efteråt av människa via actions.
KRAV-4 | Ny tjänstefil `server/src/services/contracts.ts` + sex actions i registry.ts: `create_contract`, `update_contract`, `upsert_contract_part` (sätter manually_edited=true vid ändring), `list_contracts` (med delar och förbrukning), `get_contract_usage`, `assign_contract_part` — sensitivity read/write enligt registrets mönster, auditlogg i samma transaktion.
KRAV-5 | `assign_contract_part` (write) sätter ENBART contract_part_id och tillåts även på status 'fakturerad' — klassificering ändrar varken belopp eller lås; allt annat på en fakturerad post förblir låst (TRANSITIONS i projects.ts rörs inte).
KRAV-6 | `get_contract_usage` räknar per del: billable_minutes och belopp ur poster med status godkand/justerad/fakturerad, andel av tak; föräldradelens förbrukning och tak räknas som summan över barnens.
KRAV-7 | `log_time`/`update_time_entry` tar contract_part_id; har projektet aktiva avtalsdelar KRÄVS den (400 `contract_part_required`). Taxa i fallande ordning: postens override → delens → avtalets → projektets (befintlig botten bevaras).
KRAV-8 | Takutfall efter sparad post: cap_confirmed=true och förbrukning ≥80 % → svaret bär `warning {part, used, cap, share}`; >100 % → varningstext att avtalet kräver skriftligt besked till kunden om ändrad omfattning + överskridandet i auditloggen. Posten sparas ALLTID; NULL eller obekräftat tak redovisas som 'vet ej' med förbrukningen bredvid, utan varning.
KRAV-9 | `create_invoice_from_time`: avvisandet vid rad 66 ersätts — `appendix_layout` 'per_datum' (default, kind 'time' exakt som idag, formatet från faktura 0000027) | 'per_avtalsdel' (kind 'category' från 0063: en rad per del, description = delens namn, minutes = summa, inga datum, ingen entry_date).
KRAV-10 | Fakturaraderna grupperas per avtalsdel (beskrivning = delens code + name, quantity = timmar, taxa enligt KRAV-7; olika taxor inom en del ger som idag skilda rader); poster utan del hamnar under 'Övrigt'; felet `missing_hourly_rate` bevaras.
KRAV-11 | Fakturering som tar en del över sitt BEKRÄFTADE tak: 409 `cap_exceeded` utan `confirm_over_cap: true` i input; med true skapas fakturan och forceringen skrivs i auditloggen. Obekräftat/NULL tak spärrar aldrig.
KRAV-12 | Tester (vitest mot riktig Postgres genom hela stacken): avtalsdel krävs när delar finns, taxaordningen, 80 %-varningen, spärren utan/med confirm_over_cap, föräldratak över barn, historik via valid_from, bilaga per del utan datum, assign_contract_part på fakturerad post. `docs/MCP_ACTIONS.md` + sessionslogg i `docs/STATUS.md` uppdateras.
ACCEPTANS | `npm run build` och `npm test` gröna med faktisk inklistrad utdata; samtliga testfall i KRAV-12 finns och passerar; en per_avtalsdel-faktura ger kind 'category'-bilaga utan datum ur samma låsta urval som fakturaraderna; inget test visar att registrering spärras av tak.
AVGRANSNING | Endast: migration 0064, nya `contracts.ts`, `registry.ts`, `projects.ts` (log_time/update_time_entry), `invoiceFromTime.ts`, tester och docs. Bilagemotorn i `invoiceAppendix.ts` återanvänds oförändrad; inga nya beroenden; inget annat rörs.
uteslutet: automatisk extraktion ur avtalsfil (PDF/DOCX) — kallan kraver det inte
uteslutet: rapportvyer over forbrukning — kallan kraver det inte
uteslutet: redigeringsvy for avtal och delar — kallan kraver det inte
uteslutet: koppling av befintliga ILT-poster i migrationen — kallan kraver det inte
uteslutet: delete-actions for avtal/avtalsdelar — kallan kraver det inte
uteslutet: sparr vid tidsregistrering over tak — kallan kraver det inte
uteslutet: notifiering utanfor action-svaret vid 80 % — kallan kraver det inte
```

## Utfall
Tester: 102 passed (102) · Granskning: GODKANT | Samtliga tolv krav är implementerade enligt repots befintliga mönster (0064 med RLS/GRANT som 0017, komposit-FK:er, actions via def+zod-strict, buildAllowlistedUpdate, ören-heltal, audit i s · Byggforsok: 3

## Modellkedja (Davids krav 17/8)
Krav+granskning: claude-fable-5 · Utveckling: claude-opus-5 · Claude Code pa Davids abonnemang — inga API-tokens
