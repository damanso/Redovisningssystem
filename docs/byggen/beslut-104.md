# Bygge beslut #104 — Batchintaget `propose_time_entries` (idempotent på source_ref, hint-uppslag med Osorterat-fallback),

Datum: 2026-09-02 11:58 · Branch: cto/batchintaget-propose-time-entries-idempo-104 · Overlamning: #97

## Mal
Batchintaget `propose_time_entries` (idempotent på source_ref, hint-uppslag med Osorterat-fallback), batchgodkännandet `approve_time_entries` och förslagskön `/tid/forslag` grupperad per dag — mottagarsidan som Hermes-skillen i story 8 sedan fyller.

## Kravspec (claude-fable-5) — sjalvbarande, med KALLA och ARKITEKTUR
```
Underlaget är på plats — jag har läst ARKITEKTUR.md, 0062/0017, `projects.ts` (TILLATNA_BYTEN, avtalsdelskravet), `crmIngest.ts`-mönstret, gallringen i `crmRelations.ts` och vyns tidsdel. Här är kravspecen:

---

MAL | Mottagarsidan för AI-föreslagen tid: batchintaget `propose_time_entries` (idempotent, tappar aldrig en post), batchgodkännandet `approve_time_entries` och förslagskön `/tid/forslag` där David klarar en dag på under 30 sekunder — så att Hermes-skillen i story 8 bara blir konfiguration mot ett färdigt kontrakt.
KALLA | Överlämning #97 (VD 2026-09-02, LOC-382); Davids svar 1/9: ja, 409 `unsorted_project` för Osorterat-förslag, migration 0066, reasoning-gallring och overlaps_manual enligt överlämningen; rådslagsbeslut 1/9 (minutes 0 för mailspår, ingen ålderströskel, ingen förstasidesräknare, kön grindar aldrig fakturan); PRD_TIDSRAPPORTERING §4 F4–F5, §7 acceptans 5–6, 8.
ARKITEKTUR | Actions-registret (`def`, zod-`.strict()` av delarna i `lib/validation.ts`, `safeText`), tjänstelagret under `withTenantTransaction` med audit i samma transaktion, `buildAllowlistedUpdate`, ingest-mönstret ur `crmIngest.ts` (savepoint per event, räknat svar, trasig rad stoppar inte batchen), övergångsreglerna `TILLATNA_BYTEN`/`updateTimeEntry` i `projects.ts`, vyn som transport via `executeAction` (actor `human`), idempotent migrationskedja, vitest mot riktig Postgres. Inga nya beroenden eller mönster.
KRAV-1 | Migration `0066`: unikt partiellt index på `time_entries (company_id, source_ref) WHERE source_ref IS NOT NULL`; nya kolumner `uncertainty text` CHECK i (`lag`,`medel`,`hog`), `reasoning text`, `overlaps_manual boolean NOT NULL DEFAULT false`; 0017:s CHECK `minutes > 0` ersätts så att `minutes = 0` tillåts ENDAST för status `forslag` (övre gräns 1440 kvarstår). Idempotent, körbar om.
KRAV-2 | Ny action `propose_time_entries` (write, agent- eller människotoken) + ny tjänst: `events[]` med `{project_id | project_hint, contract_part_id | part_hint, work_date, minutes (≥0), description, source ('kalender'|'mail'|'harledd'), source_ref, uncertainty, reasoning (safeText 500)}`; skapar `time_entries` med status `forslag`, `billable_minutes = minutes`, speglingar enligt `speglingar()`; svar `{created, duplicates, unresolved}`; savepoint per event som `ingestCrmEvents`.
KRAV-3 | Idempotens: finns `(company_id, source_ref)` redan hoppas eventet över och rapporteras i `duplicates` — aldrig en uppdatering, aldrig en andra rad.
KRAV-4 | `project_hint` (kundnamn/domän) utan träff → posten sparas ändå på bolagets projekt `Osorterat` (skapas vid behov, exakt en gång per bolag) och hinten rapporteras i `unresolved`; `part_hint` utan träff lämnar `contract_part_id` NULL. Ett förslag får sakna avtalsdel även när projektet har delar — kravet ställs först vid godkännandet (KRAV-6).
KRAV-5 | Dubblettskydd: finns en post med `source = 'manuell'` på samma projekt + `work_date` sätts `overlaps_manual = true` på förslaget, och vyn visar "redan registrerad?" — aldrig en tyst andra rad.
KRAV-6 | Ny action `approve_time_entries` (write): `ids[]` + per id valfritt `{status 'godkand'|'justerad'|'ignorerad', billable_minutes, adjustment_reason, contract_part_id, project_id}`; går genom samma övergångsregler som `update_time_entry` (`TILLATNA_BYTEN`); `ignorerad` kräver orsak; `godkand`/`justerad` kräver `minutes > 0` (en 0-minuters mailmarkering måste få tid satt eller ignoreras); avtalsdel krävs när projektet har aktiva delar (`contract_part_required`).
KRAV-7 | Osorterat-spärren (Davids ja): `godkand`/`justerad` på en post vars projekt är `Osorterat` → 409 `unsorted_project`; `project_id` i samma anrop flyttar posten till riktigt projekt först och godkänner sedan; `ignorerad` går alltid.
KRAV-8 | Vysida `/app/c/:id/tid/forslag` i `http/view/routes.ts`: förslag grupperade per dag, senaste dagen överst, äldre ligger kvar (förfaller aldrig); per rad projekt/avtalsdel (select), registrerad tid, föreslagen debiterbar tid (befintliga parsern i `lib/duration.ts`), beskrivning, `source_ref` + `reasoning`, osäkerhetsmarkering, knappar Godkänn · Justera · Ignorera (orsak) · Byt avtalsdel — allt via `executeAction`, inga extra sidbyten.
KRAV-9 | "Godkänn hela dagen" finns per dag, är aldrig förvald och kräver ett eget bekräftande klick; rubriken på kösidan (och bara där) visar antal obehandlade dagar.
KRAV-10 | Reasoning-gallring: `reasoning` sätts till NULL i samma transaktion som posten blir `fakturerad`, och för `ignorerad`-poster äldre än 90 dagar via utökning av den befintliga gallringsactionen (`purge_crm_data`-mekanismen); `source_ref` behålls som spår.
KRAV-11 | Docs: nytt avsnitt "Tidsförslag" i `docs/MCP_ACTIONS.md` och `docs/crm/API_KONTRAKT.md` (samma form som `ingest_crm_events`), inklusive avsändarregeln: `reasoning` max 500 tecken, ALDRIG ordagrann mailtext eller tredje parts namn utöver kundens organisation — en mening om varför + source_ref. `docs/STATUS.md` sessionslogg uppdateras.
KRAV-12 | Tester (vitest mot riktig Postgres, genom hela stacken): idempotens på source_ref, Osorterat-fallet inkl. engångsskapandet, 409 `unsorted_project` + flytt i samma anrop, batchgodkännande med justering och orsak, ignorerad kräver orsak, minutes 0 tas emot men kan inte godkännas, `overlaps_manual`, ignorerad syns aldrig i unbilled-rapporten men går att lista, dagräknaren, reasoning-gallring vid fakturering och 90 dagar.
ACCEPTANS | `npm run build` och `npm test` gröna med inklistrad utdata; samma batch två gånger ger idel duplicates och noll nya rader; en dag med två förslag klaras i vyn med två klick utan sidbyte däremellan; ett Osorterat-förslag kan inte bli godkänd tid utan flytt; audit-rader finns i samma transaktion för varje skapad/ändrad post; RLS-/tenanttest visar att bolag B varken ser eller godkänner bolag A:s förslag.
AVGRANSNING | Rör inte: kalender-/mailläsningen och förslagsresonemanget (story 8, Hermes), flera personer (story 9), faktureringsflödet (`invoiceFromTime` utöver reasoning-nullningen), rapporten i story 4 utöver befintligt ignorerad-filter, förstasidan/Att göra, `.env`, befintliga övergångsregler i `projects.ts`. Minsta möjliga ändring gäller.
uteslutet: ålderströskel eller förfallodatum på förslag i kön — kallan kraver det inte
uteslutet: räknare för obehandlade förslag på förstasidan — kallan kraver det inte
uteslutet: uppdatering av befintlig post vid återkommet source_ref — kallan kraver det inte
uteslutet: spärr av fakturering så länge kön har obehandlade förslag — kallan kraver det inte
uteslutet: sensitivity `sensitive`/godkännandekö för de två nya actionsen — kallan kraver det inte
uteslutet: egen gallringsperiod-inställning för reasoning (90 dagar är fast) — kallan kraver det inte
```

## Utfall
Tester: 105 passed (105) · Granskning: GODKANT | Kravspecens alla tolv krav är uppfyllda genom husets befintliga mönster (def/zod-strict, savepoint per event som `ingestCrmEvents`, `updateTimeEntry`/`TILLATNA_BYTEN`, `buildAllowlistedUpdat · Byggforsok: 1

## Modellkedja (Davids krav 17/8)
Krav+granskning: claude-fable-5 · Utveckling: claude-opus-5 · Claude Code pa Davids abonnemang — inga API-tokens
