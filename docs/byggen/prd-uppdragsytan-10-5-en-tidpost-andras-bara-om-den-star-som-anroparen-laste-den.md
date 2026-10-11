# PRD-bygget uppdragsytan 10-5-en-tidpost-andras-bara-om-den-star-som-anroparen-laste-den — PRD uppdragsytan 10-5-en-tidpost-andras-bara-om-den-star-som-anroparen-laste-den: # Story 10.5: En t

Datum: 2026-10-11 04:32 · Branch: cto/prd-uppdragsytan-10-5-en-tidpost-andras-bara-om-den-star-som-9188 · Kalla: 02-Områden/hermes/uppdragsytan-1c-prd.md (fryst 29/9, Davids beslut #194)

## Mal
PRD uppdragsytan 10-5-en-tidpost-andras-bara-om-den-star-som-anroparen-laste-den: # Story 10.5: En tidpost ändras bara om den står som anroparen läste den Status: ready-for-dev <!-- Note: Validation is 

## PRD-kravet (ordagrant ur den frysta PRD:n) och astras kodgranskning
```
# Story 10.5: En tidpost ändras bara om den står som anroparen läste den

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

<!-- Kodbas: redovisning. Epic 10 (Arbetet registreras utan att David minns det). Beror på: Story 1.2 (done). Byggvillkoren K-8 (1.1) och KRAV-13 (1.2) står i done. Våg 3 i parallelization-analysis.md (rad 364–366). Story 10.2 (hermes) beror på den här berättelsen och byggs först när 10.5 är done, alltså i drift. -->
<!-- Story key: 10-5-en-tidpost-andras-bara-om-den-star-som-anroparen-laste-den · Story ID: 10.5 · Skapad 2026-10-08 med BMAD create-story i autonomt läge (YOLO). -->

## Story

As a David,
I want att en agent som uppdaterar en tidpost bara får skriva när posten fortfarande står som agenten läste den,
so that en ändring jag gör mellan agentens läsning och skrivning aldrig skrivs över.

**Krav:** FR-44, kompletteringen: ett obeslutat förslag uppdateras, och ett beslutat förslag ändras aldrig av en agent. NFR-3 gäller också: tysta tekniska fel är förbjudna (`epics.md` rad 3314–3370; `prd.md` FR-44 och NFR-3). Arkitekturens beslut står i B-19 (`architecture.md` rad 606, i radens slut), och tabellraderna 1239 och 1423 pekar hit.

**Varför berättelsen finns.** Story 10.2 lovar att Hermes komplettering bara skriver på ett obeslutat förslag som står som Hermes lämnade det. Två byggen stoppades på det löftet. Bygge h334 underkändes i code-review, och bygge h340 slutade med dev-story HALT. Hermes prövade villkoren på postens värden ur `list_time_entries` och skrev sedan i ett senare anrop till `update_time_entry`. En människa som sparade posten däremellan fick sin ändring överskriven. Ingen kontroll i Hermes kan stänga det fönstret. Kontrollen måste ligga där skrivningen sker, under samma radlås (`sprint-change-proposal-10-2-…md`, avsnitt 1 och checklistans 1.2–1.3).

**Läget i dag, i en mening.** `updateTimeEntry` läser redan `status`, `minutes`, `billable_minutes` och `adjustment_reason` med `SELECT … FOR UPDATE`, i samma transaktion som den enda `UPDATE` (`server/src/services/projects.ts` rad 442–446 och 531–537). Den jämför dem bara inte med något som anroparen läst.

**Vad berättelsen gör:**
1. **Schemat.** `update_time_entry` får det valfria fältet `expected` (`server/src/actions/registry.ts` rad 1346–1369). Fältet är ett `.strict()`-objekt med exakt de fyra obligatoriska nycklarna `minutes`, `billable_minutes`, `adjustment_reason` och `status`.
2. **Tjänsten.** `server/src/services/projects.ts` får:
   - den fasta listan `JAMFORDA_FALT`;
   - typen `ForvantadTidpost`;
   - den rena, exporterade jämförelsen `avvikandeFalt`;
   - en enda gren i `updateTimeEntry` direkt efter låsprövningen (rad 449–454). Grenen kastar `ConflictError('time_entry_changed', …)` när något av de fyra värdena skiljer sig.
3. **Provet.** Ett nytt `describe`-block sist i `server/test/tidpost-livscykel.test.ts` med fallen P1–P9.
4. **Dokumentationen.** `docs/MCP_ACTIONS.md` (punkten `update_time_entry`, rad 395–405) och en post i sessionsloggen i `docs/STATUS.md`.

**Vad berättelsen inte gör:**
- **Ingen migration och ingen versionskolumn.** De fyra fälten finns redan på raden och läses redan under låset.
- **Ingen ändring i vyn.** Vyn skickar aldrig `expected` (`routes.ts` rad 5828–5830 och 6075–6084), och ingen knapp kan ge den nya koden.
- **Ingen ändring i Hermes.** `hermes/skills/projektregistrering.py` börjar skicka `expected` i Story 10.2.
- **Inget skydd för fält som inte jämförs:** `work_date`, `duration`, `description` och `contract_part_id`.
- **Ingen ändring av `approve_time_entries`, `assign_contract_part` eller faktureringen.**

**Bygge och grind.** Byggkedjan bygger berättelsen i en kopia. Den driftsätter först efter godkänd code-review (Dev Notes → ”Byggkedjan”). Varje uppgift och varje acceptanskriterium prövas i kopian före driftsättningen, med provfilen `server/test/tidpost-livscykel.test.ts` och grindarna `npm run typecheck`, `npm run build` och `npm test`.

## Acceptance Criteria

Kriterierna 1–5 är ordagranna ur `epics.md` (Story 10.5, rad 3328–3347). Raderna under *Mätbart* anger hur kriteriet prövas i den här kodbasen och lägger inte till några krav. Mekanismerna M1–M4 och fallen P1–P9 är ordagranna ur `epics.md` rad 3349–3370 och står samlade efter kriterierna. Fallen står i detalj i Dev Notes → ”Provet, fall för fall”.

1. **Given** `update_time_entry` med det nya valfria fältet `expected`, som bär de fyra värden anroparen läste på posten: `minutes`, `billable_minutes`, `adjustment_reason` och `status`
   **When** posten, låst med `SELECT … FOR UPDATE` i `updateTimeEntry`, har exakt de fyra värdena
   **Then** uppdateras den som i dag, med samma regler, samma auditrad `time_entry.updated` och samma svar.
   - *Mätbart:*
     - P1 (människa) och P9 (agenttoken) ger 200, och posten får kroppens värden.
     - I P1 uppdateras två likadana förslag med samma kropp, det ena utan och det andra med `expected`. Svaren är lika utom `id`. Auditraderna `time_entry.updated` har samma `details`, och det finns exakt en per post.
   - *Mekanism:* `expected` förs aldrig vidare till `buildAllowlistedUpdate`, `writeAudit` eller svaret. Fältet läses på exakt ett ställe, i grenen efter låsprövningen (M1). Lika värden ger en tom lista ur `avvikandeFalt`, och då fortsätter funktionen på samma rader som utan fältet.

2. **Given** samma anrop
   **When** något av de fyra värdena på den låsta posten skiljer sig från `expected`
   **Then** blir svaret 409 `time_entry_changed` med ett begripligt svenskt meddelande
   **And** ingenting skrivs: posten är oförändrad, och ingen auditrad tillkommer.
   - *Mätbart:* P2–P5, ett fält i taget. Svaret är 409 med `error: 'time_entry_changed'`. `ogonblick` är lika före och efter. Det är en fast kolumnlista: alla kolumner som `updateTimeEntry` kan skriva (`TIME_ENTRY_UPDATE`, `projects.ts` rad 401–414) plus `invoice_id` och `updated_at`. Antalet auditrader i bolaget är lika före och efter, räknat direkt före och direkt efter anropet som prövas (Dev Notes → ”Provets uppbyggnad”, regeln om auditräkningen). `avvikandeFalt` pekar ut exakt det fält som skiljer sig.
   - *Mätbart, meddelandet:*
     - Meddelandet är `ConflictError`:s svenska text: `tidposten har ändrats sedan den lästes (<fält>) — läs om den och försök igen`, där `<fält>` är `avvikandeFalt` i listans ordning, avgränsade med `, `.
     - REST och MCP får bara kroppen `{ "error": "time_entry_changed" }`, och meddelandet stannar på servern (`errorHandler.ts` rad 30–37, `docs/project-context.md` rad 68). Vyn visar meddelandet för en `ConflictError` (`project-context.md` rad 43, `korTidsAction` i `routes.ts` rad 6020–6023), men vyn skickar aldrig `expected` och kan därför aldrig få koden (AC 5).
     - P8 når felobjektet direkt och prövar texten ordagrant.
   - *Mekanism (”ingenting skrivs”, M3):*
     - Felet kastas före den enda `UPDATE` (rad 531) och före `writeAudit` (rad 545), inne i `executeAction`:s transaktion (`execute.ts` rad 101–116), som då rullas tillbaka. Därmed skrivs ingen domänrad och ingen `action.executed`.
     - Ett `expected` med fel form fälls redan av `inputSchema.parse` (`execute.ts` rad 54), före varje transaktion (P7).
     - Fallistan är P2–P5 och P7. Provet räknar alla auditrader i bolaget, inte en lista över handlingar. `ogonblick` fångar varje committad `UPDATE` på raden, också en som skriver samma värden, eftersom triggern `time_entries_set_updated_at` sätter `updated_at` (`0017_projects_time.sql` rad 33 och 40–41).

3. **Given** en fakturerad post
   **When** `update_time_entry` anropas med `expected`
   **Then** blir svaret 409 `time_entry_locked`, som i dag.
   - *Mätbart:* P6.
     - `expected` har de värden anroparen läste före faktureringen, med `status: 'godkand'`, och skiljer sig alltså från raden. Svaret blir ändå 409 `time_entry_locked`, inte `time_entry_changed`. Det visar att låsprövningen kommer först (M1).
     - Samma sak gäller för 
```

## Utfall
Tester: 147 passed (147) · Granskning: GODKANT | Alla fem acceptanskriterier och kryssade uppgifter är uppfyllda; inga konkreta fynd, och kedjans verifierade testsvit är grön. · Byggforsok: 1

## Modellkedja (Davids krav 17/8, reservvag 7/9)

* krav: kordes inte
* utveckling: **gpt-6.1-sol**
* granskning: **gpt-6-astra**

Granskaren ar inte forfattaren: gpt-6-astra granskade gpt-6.1-sols arbete.

Allt pa Davids abonnemang - inga API-tokens.
