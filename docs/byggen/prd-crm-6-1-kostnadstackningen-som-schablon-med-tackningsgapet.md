# PRD-bygget crm 6-1-kostnadstackningen-som-schablon-med-tackningsgapet — PRD crm 6-1-kostnadstackningen-som-schablon-med-tackningsgapet: # Story 6.1: Kostnadstäckningen som 

Datum: 2026-11-28 03:39 · Branch: cto/prd-crm-6-1-kostnadstackningen-som-schablon-med-tackningsgap-9376 · Kalla: 02-Områden/hermes/prd/crm-1c-prd.md (fryst 29/9, Davids beslut #194)

## Mal
PRD crm 6-1-kostnadstackningen-som-schablon-med-tackningsgapet: # Story 6.1: Kostnadstäckningen som schablon, med täckningsgapet Status: ready-for-dev <!-- Skapad av create-story (BMAD

## PRD-kravet (ordagrant ur den frysta PRD:n) och astras kodgranskning
```
# Story 6.1: Kostnadstäckningen som schablon, med täckningsgapet

Status: ready-for-dev

<!-- Skapad av create-story (BMAD v6.0.1) i autonomt läge 2026-11-28. Kodbas: redovisning. Täcker: FR-20 (schablonmärkningen; övriga tal oförändrade) och FR-41 (täckningsgapet med tecken, märkt som schablon). Beror på: —. Validering är frivillig: kör validate-create-story före dev-story för en kvalitetskontroll. -->

## Story

Som David,
vill jag se täckningen märkt för vad den är — en schablon — och i kronor vad som saknas mot tre månaders kostnad,
så att ett periodlöst tal aldrig läses som täckning de närmaste tre månaderna.

Kodbas: redovisning (projektroten, `server/` och `docs/`). Berättelsen gör tre saker. Styrvyns tjänst `steeringOverview` får fältet `coverage.gap_ore` ur en ny ren funktion. En ny vymodul ritar kostnadstäckningen (UX K10). Styrvyns rutt byter tabellen *Känd täckning framåt* och Linear-stycket mot den modulen. Ingen migration, ingen åtgärd, ingen tabell och inget nytt beroende tillkommer.

## Förkrav

Blocket nedan är berättelsens hela yta. Formen följer 6.5 och 6.6, som passerat förkontrollen:

- **Inga beroenderader.** Berättelsen lägger inte till något paket. vitest, supertest och pg finns redan i serverns manifest.
- **Inga kontraktsrader.** Ett funktionskontrakt för en annan kodbas än hermes ger KUNDE_INTE. Fallen K1–K5, V1–V6 och S1–S3 håller löftena i stället.
- **Inga kommandon och inga förmågor.** Byggaren har bara läs- och skrivverktyg (kedjans förmågor i underlaget: kommando nej). Kedjan kör typkontrollen (båda tsconfig), bygget och hela vitest-sviten efter utvecklarens sista ändring.
- **Proven.** Varje `prov:`-rad är ett vitest-prov och GRÖN. Kedjan cto lämnar aldrig ett prov ogrönt, och förkontrollens K4 fäller där varje rad som inte är GRÖN. Berörsraderna är de befintliga proven som läser en fil som ändras eller skapas här: tjänsten (import), styrvyns sida (HTTP) och källtextproven som läser varje fil under `server/src` (Dev Notes, «Regressionsytan»). Hermes egna prov körs inte av den här kedjan; se Dev Notes, «Baslinjen».

```förkrav
fil: server/src/services/steering.ts ändras
fil: server/src/http/view/kostnadstackning.ts ny
fil: server/src/http/view/routes.ts ändras
fil: server/test/steering-liquidity.test.ts ändras
fil: server/test/crm-views.test.ts ändras
fil: docs/STATUS.md ändras
fil: server/src/http/view/html.ts läses
fil: server/src/http/view/uppdragPrognos.ts läses
fil: server/src/services/reports.ts läses
fil: server/src/services/timeReports.ts läses
fil: server/src/domain/money.ts läses
fil: server/src/actions/registry.ts läses
fil: server/test/helpers.ts läses
fil: server/test/crm-derivations.test.ts läses
fil: server/test/crm-commitment-times.test.ts läses
fil: server/test/sandvagHelper.ts läses
fil: server/test/utskickHelper.ts läses
fil: server/test/stromnivaHelper.ts läses
fil: docs/project-context.md läses
fil: docs/ARKITEKTUR.md läses
fil: docs/MCP_ACTIONS.md läses
fil: docs/crm/API_KONTRAKT.md läses
fil: CLAUDE.md läses
prov: steering-liquidity ändras GRÖN
prov: crm-views ändras GRÖN
prov: tid-rapporter berörs GRÖN
prov: crm-derivations berörs GRÖN
prov: entity-links berörs GRÖN
prov: crm-contractor-role berörs GRÖN
prov: radlangd berörs GRÖN
prov: crm-deals berörs GRÖN
prov: crm-sandvag berörs GRÖN
prov: crm-calendar-capture berörs GRÖN
prov: crm-sfar-3 berörs GRÖN
prov: vy-kansliga-knappar berörs GRÖN
prov: vat-declaration berörs GRÖN
prov: kvittobilagor-lagring berörs GRÖN
prov: uppdragsytan-utskick berörs GRÖN
prov: uppdragsytan-prognosplats berörs GRÖN
prov: uppdragsytan-registerkopia berörs GRÖN
prov: uppdragsytan-faktureringsunderlag berörs GRÖN
prov: uppdragsytan-baselineorsak berörs GRÖN
prov: uppdragsytan-godkannandevag berörs GRÖN
prov: uppdragsytan-beslut berörs GRÖN
prov: uppdragsytan-troskelmandat berörs GRÖN
prov: uppdragsytan-troskel berörs GRÖN
prov: uppdragsytan-stromniva berörs GRÖN
prov: uppdragsytan-undantag berörs GRÖN
prov: uppdragsytan-overlamning berörs GRÖN
tjanst: 127.0.0.1:5433 vitest-sviten återskapar testdatabasen ur mallen före varje fil och kör tjänsten och styrvyns sida mot riktig Postgres
```

## Acceptance Criteria

Kriterierna står som i epics.md (Story 6.1). Formen skiljer sig på två punkter, men innehållet är detsamma: provfilens kortform är utskriven från projektroten, och varje kriterium som lovar *aldrig*, *inte någonstans* eller *samma som i dag* bär raden **Mätbart** med mekanismen och den ändliga fallistan. Fallens id (K, V, S) står i Dev Notes, «Fallen» och «Fall → uppgift».

1. **Given** `steeringOverview`
   **When** den räknar
   **Then** svaret bär `coverage.gap_ore = known_next_3_months_ore − 3 × cost.avg_month_ore` i den ordningen, som heltal i ören; positivt är överskott och negativt är vad som saknas
   **And** befintliga fält har samma namn och värden som i dag, och utan bokförda kostnader är gapet `null` (okänt) — aldrig ett överskott räknat mot noll.
   **Mätbart — mekanism:** *En enda väg in.* `gap_ore` sätts på exakt ett ställe, i `steeringOverview`, med värdet ur den nya rena funktionen `coverageGapOre(known3, avgCostOre)` i samma fil. Funktionen returnerar `null` när `avgCostOre ≤ 0`, alltså samma villkor som `months_covered` redan har (`avgCost > 0`). Annars returnerar den `known3 − 3 × avgCostOre`, prövat med `assertSafeOre`. Vyn räknar aldrig gapet själv. Den läser bara `coverage.gap_ore` (Uppgift 2), så ett gap mot noll kan inte uppstå i vyn heller. *Samma fält som i dag* bärs av en additiv ändring: gränssnittet `SteeringOverview` får exakt en ny nyckel, `coverage.gap_ore: number | null`, och ingen befintlig rad i beräkningen ändras (Uppgift 1.4 jämför, läst). **Fallista:**
   - K1: `coverageGapOre` på sex par: (2 100 000, 100 000) → 1 800 000; (500 000, 500 000) → −1 000 000; (0, 1) → −3; (500 000, 0) → `null`; (0, 0) → `null`; (100, −5) → `null`. Ett icke-heltal (1,5, 1) kastar.
   - K2: Täckning AB per `2026-11-20`. `cost` och `coverage` är `toStrictEqual` med literaler som räknats för hand ur dagens formel, plus `gap_ore` 1 800 000. Toppnivåns nycklar är exakt `as_of`, `revenue`, `cost`, `concentration` och `coverage`, och intäkterna och koncentrationen har sina literaler.
   - K3: Underskott AB: `gap_ore` −1 000 000 och `months_covered` 1.
   - K4: Kostnadslöst AB: `gap_ore` `null`, `months_covered` `null` och `known_next_3_months_ore` 500 000.
   - K5: den rena kontrollen `gapBrister` ger `[]` på K2–K4. Med omvänt tecken (K2 och K3) och med gapet räknat mot noll (K4) ger kopiorna var för sig minst en brist.
   - 6.5:s R1 (`known_next_3_months_ore` 900 000) och `tid-rapporter` (`unbilled_time_ore`) står kvar gröna.

2. **Given** styrvyn
   **When** den renderas
   **Then** tabellen *Känd täckning framåt* är ersatt av **Kostnadstäckning (schablon)** med raderna *Obetalda bokförda fakturor* (*Fakturerat men ej betalt — utan hänsyn till förfallodatum*), *Ofakturerad fakturerbar tid* (*Utfört arbete till i dag*), *Abonnemang × 3* (*{belopp} per månad × 3 — tre månader av varje aktivt abonnemang, även de som slutar tidigare*), **Schablon** (*Inte belagd täckning under en period — se Likviditet nedan*), *Kostnad tre månader* (*Bokförd kostnad 12 mån ÷ 12 × 3*, med minustecken) och **Överskott** eller **Saknas** med beloppet med tecken som text
   **And** under tabellen står härledningsraden *"Räknat ur bokförda verifikat, obetalda fakturor, aktiva abonnemang och ofakturerad tid per {datum}. Räcker till ca N månaders kostnader."*
   **Mätbart — mekanism:** en enda renderare, `kostnadstackning(s)` i den nya modulen `server/src/http/view/kostnadstackning.ts`, ritar hela avsnittet ur tjänstens svar. Rutten anropar den och ritar inget eget om täckningen. **Fallista:** V1 (överskott), V2 (saknas), V3 (okänt), V4 (N med decimal) på literala svar, och S1 (sidan visar exakt renderarens fragment för tjänstens svar samma dag).

3. **Given** styrvyns renderade HTML
   **When** provet söker efter de gamla formuleringarna
   **Then** *"Känt de närmaste 3 må
```

## Utfall
Tester: 222 passed (222) · Granskning: GODKANT | Samtliga acceptanskriterier och kryssade uppgifter är implementerade; inga konkreta fel har identifierats. · Byggforsok: 1

## Modellkedja (Davids krav 17/8, reservvag 7/9)

* krav: kordes inte
* utveckling: **claude-opus-5-5**
* granskning: **gpt-6-astra**

Granskaren ar inte forfattaren: gpt-6-astra granskade claude-opus-5-5s arbete.

effort (Davids beslut 20/10): create-story high · validering high · bygg xhigh — delen okänd
Allt pa Davids abonnemang - inga API-tokens.
