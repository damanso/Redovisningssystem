# Bygge beslut #114 — Fyra valfria fält (change_reason/start_date/end_date/date_precision) på `upsert_contract_part`, trig

Datum: 2026-09-06 12:10 · Branch: cto/fyra-valfria-f-lt-change-reason-start-da-114 · Overlamning: #115

## Mal
Fyra valfria fält (change_reason/start_date/end_date/date_precision) på `upsert_contract_part`, triggerfel som läsbara 400, ny sensitive-åtgärd `andra_baseline` som via godkännandekön skapar ny baselineversion, plus sex vitest-fall och docs — och tills det finns kan ingen ny avtalsdelsversion skapas alls, inte ens av David.

## Kravspec (claude-fable-5) — sjalvbarande, med KALLA och ARKITEKTUR
```
Verkligheten är verifierad: allowlisten `CONTRACT_PART_UPDATE` (`contracts.ts:571`) saknar de fyra fälten, INSERT sätter fjorton kolumner, `upsert_contract_part` är `write` (`registry.ts:1403`), `errorHandler.ts:95` mappar P0001→409 `rule_violation`, och triggern `kraver_orsak_vid_ny_version` i 0068 kräver `change_reason` vid varje ny version. Här är kravspecen:

---

MAL | Nya avtalsdelsversioner kan skapas igen: sedan 0068 kräver orsakstriggern `change_reason` vid varje ny version av samma (contract_id, code), men skrivvägen saknar fältet — idag kan ingen ny version skapas alls, inte ens av David. Efter bygget tar `upsert_contract_part` emot orsak och period, och den nya sensitive-åtgärden `andra_baseline` skapar ny baselineversion via godkännandekön.
KALLA | Överlämning #115 (vd→sidoprojektet 2026-09-06); Davids ja 6/9 med förtydligande 11:45 (triggerfel = 409 `rule_violation` enligt husregeln, överlämningens 400-koder strukna); BMAD 1G GODKÄND 5/9; story S1.3, våg 1 enligt 1H; Linear LOC-389.
ARKITEKTUR | Endast befintliga mönster: `def({...})` i `ACTIONS` med `.strict()`-zod ur `lib/validation.ts` (`safeText`, `IsoDateSchema`, `UuidSchema`); sensitive-flödet i `execute.ts` (köas via `createApproval` → `pending_approval`, `approveAction` kör handlern med sparad indata); tjänstelager med `withTenantTransaction` + `writeAudit`; `buildAllowlistedUpdate`; `errorHandler.ts` P0001→409 `rule_violation` oförändrad; vitest+supertest mot riktig Postgres.
KRAV-1 | `upsert_contract_part`-schemat (`registry.ts` ~rad 1408) får fyra VALFRIA fält: `change_reason` `safeText(2000).optional()`, `start_date`/`end_date` `IsoDateSchema.optional()`, `date_precision` `z.enum(['ar','halvar','kvartal','manad','dag']).optional()` (exakt DB-CHECK:ens värden ur 0068).
KRAV-2 | `services/contracts.ts`: samma fyra fält i `UpsertContractPartInput`, i allowlisten `CONTRACT_PART_UPDATE` (elva→femton nycklar), i objektet som skickas till `buildAllowlistedUpdate` i UPDATE-grenen, och i INSERT-satsen (fjorton→arton kolumner, utelämnade fält = NULL).
KRAV-3 | Befintliga anrop utan de fyra fälten beter sig exakt som idag — `contractExtraction.ts` och vyn anropar samma `upsertContractPart` och får inte påverkas.
KRAV-4 | Triggerfel hanteras utan ny kod: P0001 ur `kraver_orsak_vid_ny_version` når klienten som 409 `rule_violation` via befintliga `errorHandler.ts` — ingen egen fångst, inga nya felkoder, ingen ny mappning, aldrig 500. Schemavalidering (KRAV-1/5) är primärkontrollen, triggern backstoppet.
KRAV-5 | Ny åtgärd `andra_baseline` i `registry.ts`: `sensitivity: 'sensitive'` (husmönstret från `book_invoice`); indata = `upsert_contract_part`-schemat men med `change_reason` OBLIGATORISK (minst 5 tecken) och `valid_from` OBLIGATORISK; beskrivning "Ny baselineversion av en avtalsdel, med orsak. Köas för godkännande."; handlern anropar tjänstefunktionen `upsertContractPart(ctx.client, ...)` direkt — ingen egen SQL, INTE `executeAction`.
KRAV-6 | Test (a): `andra_baseline` med actor `agent` → `status: 'pending_approval'`, ingen ny rad i `contract_parts`, en rad i `action_approvals`; efter `approveAction` (människa) finns version 2 med `change_reason`, och `get_contract_usage` visar version 2 från dess `valid_from`.
KRAV-7 | Test (b): `upsert_contract_part` med `change_reason` + nytt `valid_from` på en bekräftad del skapar version 2.
KRAV-8 | Test (c): `upsert_contract_part` utan `change_reason` med nytt `valid_from` mot befintlig kod → 409 `rule_violation` (triggern som backstop).
KRAV-9 | Test (d): UPDATE av `cap_hours` på bekräftad rad via `upsert_contract_part` → 409 `rule_violation`.
KRAV-10 | Test (e): `date_precision: 'vecka'` avvisas av zod (husets 400-validering).
KRAV-11 | Test (f): anrop utan de fyra fälten på en obekräftad rad fungerar som idag (regressionsskydd för Davids skarpa flöde).
KRAV-12 | Sex fallen (a)–(f) i EN ny testfil i `server/test/`; docs: `docs/MCP_ACTIONS.md` får NY modulsektion "Uppdragsytan" (första modulåtgärden; `handgrepp.py` läser sektionen) med `andra_baseline` och de fyra fälten på `upsert_contract_part`; `docs/STATUS.md` en rad + sessionslogg.
ACCEPTANS | `npm test` grön (alla sviter inkl. de sex nya) och `npm run build` ren, med inklistrad utdata; (c)/(d) verifierar 409 `rule_violation` genom hela HTTP-stacken; (f) bevisar oförändrat beteende för anrop utan fälten; `git diff` rör bara filerna i KRAV-1–12; MCP_ACTIONS-sektionen finns.
AVGRANSNING | Ingen migration, ingen ny tabell, ingen vy. Rör inte `assign_contract_part`, `update_contract`, `set_project_status`, `get_contract_usage`, `errorHandler.ts` eller sensitivity på någon befintlig åtgärd. Minsta möjliga ändring: `services/contracts.ts`, `actions/registry.ts`, en ny testfil, två docs-filer.
uteslutet: egna 400-felkoder `change_reason_required`/`baseline_frozen` med textmatchning mot triggerns meddelanden — källan kräver det inte
uteslutet: sensitivity-ändring på `upsert_contract_part` (det är S0.1, våg 2) — källan kräver det inte
uteslutet: `andra_baseline` via `executeAction('upsert_contract_part')` i stället för tjänstefunktionen — källan kräver det inte
uteslutet: vyformulär eller MCP-exponering utöver registrets automatiska manifest för de fyra fälten — källan kräver det inte
uteslutet: `change_reason` i `contractExtraction`-flödet — källan kräver det inte

---

Två medvetna avvikelser från överlämningens ordalydelse, båda med stöd i Davids förtydligande 6/9 11:45: testfallen (c) och (d) förväntar 409 `rule_violation` i stället för de strukna 400-koderna, och punkt 2 ("P0001-fångst" ur CTO-underlaget) blev KRAV-4 = ingen kodändring alls i felhanteringen. Specen är självbärande: radnummer, exakta enum-värden ur 0068 och mönsterreferenserna (`book_invoice`, `execute.ts`-flödet) står i texten så att utvecklaren inte behöver leta.
```

## Utfall
Tester: 111 passed (111) · Granskning: GODKANT | Alla krav 1–12 är uppfyllda med husets mönster (delad fältkonstant, `def`+`.strict()`-zod, tjänstelagret via `upsertContractPart`, orörd `errorHandler`/`contractExtraction`, diff exakt inom  · Byggforsok: 1

## Modellkedja (Davids krav 17/8)
Krav+granskning: claude-fable-5 · Utveckling: claude-opus-5 · Claude Code pa Davids abonnemang — inga API-tokens
