# PRD-bygget uppdragsytan 5-2-forbrukningen-mot-ram-tar-med-det-som-inte-ar-fordelat — PRD uppdragsytan 5-2-forbrukningen-mot-ram-tar-med-det-som-inte-ar-fordelat: # Story 5.2: Förbruknin

Datum: 2026-11-27 16:33 · Branch: cto/prd-uppdragsytan-5-2-forbrukningen-mot-ram-tar-med-det-som-i-9369 · Kalla: 02-Områden/hermes/uppdragsytan-1c-prd.md (fryst 29/9, Davids beslut #194)

## Mal
PRD uppdragsytan 5-2-forbrukningen-mot-ram-tar-med-det-som-inte-ar-fordelat: # Story 5.2: Förbrukningen mot ram tar med det som inte är fördelat Status: ready-for-dev <!-- Validering är frivillig. 

## PRD-kravet (ordagrant ur den frysta PRD:n) och astras kodgranskning
```
# Story 5.2: Förbrukningen mot ram tar med det som inte är fördelat

Status: ready-for-dev

<!-- Validering är frivillig. Kör validate-create-story för kvalitetskontroll före dev-story. -->

## Story

Som David,
vill jag se förbrukningen mot ram i timmar och kronor där allt som hör till uppdraget räknas, och ofördelat syns som ofördelat,
så att jag kan lita på talen utan att räkna om dem.

Kodbas: redovisning. Krav: FR-3 (nivåerna och totalen), FR-31, FR-33 (obundna i totalen), FR-35 (per kostnadsrad), NFR-11. Beror på: Story 5.1 (done, byggjournalen finns i kopian).

## Förkrav

Blocket räknar upp allt bygget kräver. Varje rad med läget `ändras` eller `läses` finns i arbetskatalogens kopia (kontrollerat med Glob och Grep 2026-11-27). Berättelsen skapar fyra nya filer: regelfilen i `lib/`, vyfilen för panelen, provfilen och dess hjälpfil. Ingen migration skapas.

```förkrav
fil: server/src/lib/forbrukningsnivaer.ts ny
fil: server/src/http/view/uppdragForbrukning.ts ny
fil: server/src/services/uppdragPengar.ts ändras
fil: server/src/http/view/routes.ts ändras
fil: server/src/services/contracts.ts läses
fil: server/src/services/projects.ts läses
fil: server/src/services/uppdragRegister.ts läses
fil: server/src/services/uppdragLage.ts läses
fil: server/src/services/uppdragSvep.ts läses
fil: server/src/services/uppdragUndantag.ts läses
fil: server/src/services/uppdragBedomning.ts läses
fil: server/src/services/uppdragImport.ts läses
fil: server/src/actions/execute.ts läses
fil: server/src/actions/registry.ts läses
fil: server/src/lib/lasvarde.ts läses
fil: server/src/lib/leveranskontrakt.ts läses
fil: server/src/lib/troskel.ts läses
fil: server/src/lib/duration.ts läses
fil: server/src/domain/money.ts läses
fil: server/src/db/tx.ts läses
fil: server/src/http/view/html.ts läses
fil: server/src/http/view/uppdragUppfoljning.ts läses
fil: server/migrations/0062_tidpost_livscykel.sql läses
fil: server/migrations/0068_uppdragsytan.sql läses
fil: server/migrations/0099_overlamningshandling.sql läses
fil: docs/byggen/prd-uppdragsytan-5-1-varje-kostnadsbindning-nar-david-som-forifyllt-forslag.md läses
fil: server/test/forbrukningsnivaerHelper.ts ny
fil: server/test/uppdragsytan-forbrukning.test.ts ny
fil: server/test/uppdragsytan-pengarna.test.ts ändras
fil: server/test/uppdragsytan-kostnadssparr.test.ts ändras
fil: server/test/uppdragsytan-kostnadsforslag.test.ts läses
fil: server/test/uppdragsytan-menyn.test.ts läses
fil: server/test/uppdragsytan-laget.test.ts läses
fil: server/test/uppdragsytan-matt-rytm.test.ts läses
fil: server/test/uppdragsytan-troskel.test.ts läses
fil: server/test/uppdragsytan-utskick.test.ts läses
fil: server/test/utskickHelper.ts läses
fil: server/test/uppdragsytan-faktureringsunderlag.test.ts läses
fil: server/test/kostnadsforslagHelper.ts läses
fil: server/test/uppdragImportHelper.ts läses
fil: server/test/helpers.ts läses
fil: server/test/env.ts läses
fil: server/test/setup.ts läses
fil: server/test/globalSetup.ts läses
fil: server/test/fixtures/leveranskontrakt-nvr-001-v3.ts läses
fil: server/vitest.config.ts läses
fil: server/package.json läses
fil: package.json läses
fil: docs/ARKITEKTUR.md ändras
fil: docs/STATUS.md ändras
fil: docs/MCP_ACTIONS.md läses
fil: docs/project-context.md läses
fil: CLAUDE.md läses
prov: adresskontraktet berörs GRÖN
prov: designsvep berörs GRÖN
prov: hushallet_fr36 berörs GRÖN
prov: r5_soktjansten_fr6 berörs GRÖN
prov: redovisning_fortroende_prov berörs GRÖN
prov: rollpassen_fr41 berörs GRÖN
prov: rollpassen_fr43 berörs GRÖN
tjanst: 127.0.0.1:5433 vitest kör proven mot testdatabasen i Postgres 16
```

Berättelsens egna prov är vitest-filer i `server/test` och står som `fil:`-rader: de två nya filerna har läget `ny`, de två befintliga provfiler som uppgifterna skriver om har läget `ändras`, och regressionsfilerna har läget `läses`. `prov:`-raderna är Hermes prov i hermes/prov. De läser releasen eller källan och körs av byggslingan och provvakten, inte av kedjans `npm test` (Dev Notes, «Kedjan kontrollerar i drift»).

- **De GRÖNA raderna** är de Hermes-prov vars källtext nämner en modul som berättelsen ändrar (`uppdragPengar` eller `routes` som helt ord; Grep i hermes/prov 2026-11-27) och som var GRÖNA i provvaktens senaste bokförda körning (provvaktens tillståndsfil, körningen 2026-11-27 06:30). Inget prov nämner de nya modulerna `forbrukningsnivaer` eller `uppdragForbrukning`.
- **bmadglidning (RÖD) står inte i blocket**, fast dess källtext nämner `routes`. Kodbasen är redovisning, så kedjan cto bygger berättelsen, och förkontrollens K4 fäller varje `prov:`-rad som inte är GRÖN i en annan kedja än hermes (Hermes förkontroll, funktionen `_k4`; underlaget kedjans-formagor, kedjan cto: nytt_prov_ej_gront nej). Samma val gjordes i Story 4.1–4.4 och 5.1. Provet var RÖTT redan vid sådden 2026-10-13 och prövar inte den här berättelsens beteende (Beslutslogg 14).
- **Inga `beroende:`-rader.** Inget paket tillkommer. K5 läser i kedjan cto bara rotens `package.json`, som saknar `dependencies`, och fäller därför varje beroenderad.
- **Inga `kontrakt:`-rader.** Pengarnas läsväg är ingen åtgärd och inget svepkontrakt; den nås bara av vyn. Inget kontrakt mot Hermes eller MCP ändras.
- **Inga `kommando:`-rader.** Kedjan cto ger inte byggaren förmågan att köra kommandon som grind (kedjans förmågor, kommando nej). Körningarna i Tasks är inga rutor.
- **Inga `kraver:`- eller `namner:`-rader.** Bygget skriver bara filer i kopian, och ordregelns fyra ord förekommer inte i berättelsen.

## Acceptance Criteria

Lydelsen är epics.md:s, ordagrant. Under de kriterier som lovar att något aldrig sker eller gäller alla fall står raden «Mätbart» med mekanismen och den ändliga fallistan. Fallens fulla förväntan står i Dev Notes, avsnittet «Fallen». «Uppdragets total» och «förbrukningen visas» betyder i berättelsen fältet `forbrukning` per avtal i `lasUppdragspengar` och panelen «Förbrukning per nivå» på uppdragets sida Pengarna (Beslutslogg 3).

1. **Given** tidposter för projektet utan `contract_part_id`
   **When** uppdragets total räknas
   **Then** ingår de som en uttrycklig rad ”ofördelad” och gissas aldrig till en leverabel
   **And** ingen vy, åtgärd eller svep ber om en märkning till, och ingen städkö för ofördelad tid skapas.
   - **Mätbart:** mekanismen är en enda väg in och ett fält som aldrig förs vidare. Ofördelad tid läses bara av `lasOfordeladTid` i `server/src/services/uppdragPengar.ts` (villkoret `contract_part_id IS NULL` och husets förbrukande statusar) och når uppdragets total bara genom den rena funktionen `forbrukningsnivaer` i `server/src/lib/forbrukningsnivaer.ts`, där den står i fältet `ofordelad` och läggs till uppdragsnivån men aldrig till en post i `leverabler`. Att ingen märkning begärs är sant genom konstruktion: berättelsen lägger ingen åtgärd i `ACTIONS`, inget svepsteg, ingen köpost och inget formulär till, och pengasidan förblir en ren läsvy. Fallistan: N0 a, N0 b, F1 a, F1 b, V0 d, V1 a och A1 a–b, samt pengaprovets befintliga fall (f) «varken progress, procenttal, skript, formulär eller knapp».

2. **Given** fördelningen per leverabel
   **When** den räknas
   **Then** läses den ur `time_entries.contract_part_id` som sattes vid registreringen.

3. **Given** härledning av avtalsdel ur `arende_id` (BÖR)
   **When** version 1 byggs
   **Then** byggs den inte. Byggs den senare är den ett förslag där tidposten ändå registreras, aldrig en tyst märkning och aldrig en egen kö.
   - **Mätbart:** mekanismen är ett fält som aldrig förs vidare. `forbrukningsnivaer` tar bara avtalsdelarnas förbrukning, registrets leverabelkoder och den ofördelade summan som indata, och ingen av berättelsens läsningar väljer `arende_id`. Fallistan: A1 c, som prövar att namnet `arende_id` saknas i de tre filer berättelsen skriver regler och läsningar i (`server/src/lib/forbrukningsnivaer.ts`, `server/src/http/view/uppdragForbrukning.ts` och `server/src/services/uppdragPengar.ts`), med en planterad text som negativ kontroll. K
```

## Utfall
Tester: 219 passed (219) · Granskning: GODKANT | Alla acceptanskriterier är implementerade, föregående fynd är åtgärdat och inga nya fynd har belagts. · Byggforsok: 2

## Modellkedja (Davids krav 17/8, reservvag 7/9)

* krav: kordes inte
* utveckling: **gpt-6.1-sol**
* granskning: **gpt-6-astra**

Granskaren ar inte forfattaren: gpt-6-astra granskade gpt-6.1-sols arbete.

effort (Davids beslut 20/10): create-story high · validering high — planeringssteg
Allt pa Davids abonnemang - inga API-tokens.
