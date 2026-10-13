# PRD-bygget uppdragsytan 1-9-ett-scopeavgorande-blir-en-ny-rad-i-historiken — PRD uppdragsytan 1-9-ett-scopeavgorande-blir-en-ny-rad-i-historiken: # Story 1.9: Ett scopeavgörande

Datum: 2026-10-13 06:54 · Branch: cto/prd-uppdragsytan-1-9-ett-scopeavgorande-blir-en-ny-rad-i-his-9195 · Kalla: 02-Områden/hermes/uppdragsytan-1c-prd.md (fryst 29/9, Davids beslut #194)

## Mal
PRD uppdragsytan 1-9-ett-scopeavgorande-blir-en-ny-rad-i-historiken: # Story 1.9: Ett scopeavgörande blir en ny rad i historiken Status: ready-for-dev <!-- Note: Validation is optional. Run

## PRD-kravet (ordagrant ur den frysta PRD:n) och astras kodgranskning
```
# Story 1.9: Ett scopeavgörande blir en ny rad i historiken

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->
<!-- Rättad genom correct-course 2026-10-13 två gånger: efter andra granskningen i drift (post 10 i codex-efterhand), som gav Task 8, och efter bygge #9194, som strök grinddeluppgifterna ur Task 8 och flyttade avtalsprövningen efter 409-prövningen. Det enda som byggs är Task 8. Förslaget: _bmad-output/planning-artifacts/sprint-change-proposal-1-9-ett-scopeavgorande-blir-en-ny-rad-i-historiken.md. -->

<!-- Kodbas: redovisning. Epic 1 (Undantagsvyn). Beror på: Story 1.7 (done enligt sprint-status.yaml) och därmed 1.1–1.6. Story 1.8 står också i done. Byggvillkoren K-8 (1.1) och KRAV-13 (1.2) står i done. En migration: 0081_scopeavgorande.sql (nästa lediga nummer, mätt 2026-10-12: 0001–0080 finns). En ny tabell, ingen ny åtgärd. -->
<!-- Story key: 1-9-ett-scopeavgorande-blir-en-ny-rad-i-historiken · Story ID: 1.9 · Skapad 2026-10-12 med BMAD create-story i autonomt läge (YOLO). Berättelsen hette tidigare Story 7.1 (epics.md rad 97). -->

## Story

As a David,
I want att varje avgörande jag gör om en signal sparas som en egen rad och aldrig skriver över ett tidigare, och att en tänd signal når mig som fråga,
so that gränsen för åtagandet går att följa i efterhand och ingen tänd signal blir liggande.

**Krav:** FR-7 (bara David tänder och avgör, posten i undantagsvyn och avgörandet som registrerad handling), FR-41 (avgörandet registreras), FR-8 (signaler i den skrivskyddade historiken) och NFR-7, ur `epics.md` rad 917–967. Scopeavgörande som David tänt är en beslutad posttyp i första leveransen (PRD avsnitt 6, `prd.md` rad 1045). Arkitekturens grund är B-8 (`architecture.md` rad 309–318), åtgärdstabellen (rad 427), B-3:s tabeller (rad 458–476 och 502), kommunikationsmönstret för scopeavgörandet (rad 939), idempotensnyckeln (rad 941–944), auditnamnen (rad 948) och felexemplet `UPDATE uppdrag_scopesignal SET avgjord = …` (rad 1026). Genomförandeordningen har berättelsen som punkt 7 (rad 777). PRD:ns lydelse: Resa 4 (`prd.md` rad 384–391), FR-7 (rad 498–508), FR-8 (rad 510–518) och FR-41 (rad 871–885).

**Läget före Task 1–7 (mätt 2026-10-12), i en mening.** Läget i koden i drift före Task 8 står i Dev Notes → ”Rättelsen efter andra granskningen i drift” → ”Läget i koden i drift”. `avgorSignal` (`server/src/services/uppdragSignal.ts` rad 226–259) skriver över signalens svar med `UPDATE uppdrag_scopesignal SET avgjord = $3` (rad 229–234). Ett nytt avgörande raderar alltså det förra, och vem som avgjorde och när finns ingenstans. Ett ”utanför” med tillägg köar en ny `andra_baseline` vid varje anrop, utan dubblettkontroll (rad 242–257). Kodgranskningen ger FR-7 DELVIS: ”Bevara tidigare avgöranden; nu skriver ett nytt avgörande över signalens `avgjord`” (`underlag/kodgranskning.md` rad 24). Undantagsvyns läsväg från Story 1.6 bygger redan posten `scopeavgorande`, men ur kolumnen (`uppdragUndantag.ts` rad 529–547, `s.avgjord IS NULL`).

**Vad berättelsen gör.**
1. **Ny tabell `uppdrag_scopeavgorande`** (migration 0081), kategori BASELINE, append-only, med RLS, sammansatta FK och triggern `vagrar_skrivning_pa_avslutat`. Varje avgörande är en rad med löpnummer per signal. Migrationen för över befintliga `avgjord`-värden som överförda rader, och en trigger fryser kolumnen `uppdrag_scopesignal.avgjord`.
2. **Skrivvägen blir en ny rad.** `avgorSignal` låser signalraden, läser senaste avgörandet, svarar 409 `redan_avgjord` på samma val med samma underlag och skriver annars en ny rad med auditraden `uppdrag.scope_avgjort`.
3. **Läsvägarna tar senaste avgörandet ur tabellen.** `listaSignaler` (Läget, signalsidan och `las_uppdragslage`) och `signalposter` (`las_undantag`) läser tabellen. Tidigare avgöranden går att läsa i `las_uppdragslage` (`signalhistorik`) och på signalsidan.
4. **Tillägget följer B-8.** Ett ”utanför” med tillägg köar `andra_baseline` med orsaken ”Tillägg: …” och `kalla = { typ: 'scopesignal', id }` i samma transaktion som raden, och bara om ingen köpost för signalen finns i någon status.
5. **Dokumentationen och de befintliga proven följer med.**

**Vad berättelsen inte gör:**
- **Inget val av underlag bland länkade referenser, ingen veckorytm, ingen eskalering och inget händelsedatum vid valet.** Det är Story 7.1 (`epics.md` rad 2858–2895). Avgörandets underlag är signalens eget `underlag_ref_id` när avgörandet görs.
- **Ingen undantagsvy, inga knappar för posten och ingen ny rutt.** Vyn är Story 1.11 (`epics.md` rad 1093–1096).
- **Ingen förifylld orsak ur signalens fras.** Story 2.2 förifyller orsaken (`epics.md` rad 1615–1618) och bygger på den rena funktionen `tillaggsorsak` som den här berättelsen inför.
- **Ingen ändring av importens köning.** B-8:s andra halva (”importen köar bara om ingen köpost för samma källa finns”) hör till Epic 2 (`architecture.md` rad 1106).
- **Ingen automatisk scopedetektion.** Detektionsregeln är ÖPPEN i PRD:n, och i version 1 tänder bara David (`prd.md` rad 504).
- **Ingen knapp för att ändra ett redan avgjort svar på signalsidan.** En rättelse med annat val går genom åtgärden (REST eller MCP). Samma val ger 409, och en knapp som bara kan ge 409 visas inte (`project-context.md` rad 75).
- **Inget tillbakadragande av ett väntande tillägg när avgörandet ändras.** Frågan står under ”Frågor till David”.
- **Ingenting under `hermes/`**, ingen ny åtgärd och ingen ändring av `server/kontrakt/navigation.v1.json`.
- **Ingen ändring av `andra_baseline`:s direkta väg** (correct-course 2026-10-13). En människa som köar `andra_baseline` med en signal på ett annat avtal får sin köpost, och verkställigheten fäller den med 400 `signal_annat_avtal`. Det är S5.2:s beteende, prövat i `uppdragsytan-tillagg.test.ts` (d) och i drift. Task 8 rör bara köposten som avgörandet skapar.
- **Ingen förhandsprövning av versionsreglerna i avgörandet.** Task 8 gör bara avtalsregeln omöjlig för en köpost som avgörandet skapar. Verkställigheten kan fortfarande fälla en sådan köpost på regler som gäller varje `andra_baseline` lika: `version_finns`, `name_required` och `parent_part_other_contract` i `skrivBaselineversion` (`contracts.ts` rad 665–690), och avslutstriggern på `contract_parts` (0068 rad 410–413). De ligger utanför granskningens fynd (Beslutslogg punkt 34).

**Bygge och grind.** Byggkedjan bygger berättelsen i en kopia, en gren i redovisningens repo, och driftsätter först efter godkänd code-review (Dev Notes → ”Byggkedjan”). Varje uppgift och varje acceptanskriterium prövas i kopian, före driftsättningen, med proven K0–K6 i Dev Notes → ”Prov och verifiering”. Varje uppgift skriver sina egna fall och belägger dem röda innan koden skrivs och gröna efteråt. Har sessionen ett skal görs det med vitest och inklistrad utdata. Saknas skal skrivs ”inte kört i sessionen”, skälet och det förutsagda utfallet i Debug Log, och uppgiften lämnas till granskning utan HALT (arkitekturens beslut om grindarna i byggkedjan, punkt 3). Grindarna `npm run typecheck` och `npm test` kör kedjan efter utvecklaren och före granskningen, och bygget kör deployen (Dev Notes → ”Byggrinden”).

**Rättad genom correct-course 2026-10-13, efter andra granskningen i drift.** Berättelsen byggdes, fick ett omtag efter code-review, godkändes och driftsattes 2026-10-13 (Task 1–7 och fem uppföljningar). En oberoende andra granskning av ändringen i drift (claude-opus-5-5 i Codex ställe, Davids ord 12/10) fann två fynd:
1. **HIGH, byggrinden.** Task 7.2 var kryssad, men `npm run build` kördes aldrig. Sandlådan nekade varje kommando, och kedjan kör inte bygget före merge.
2. **MEDIUM, tilläggets avtal.** `avgorSignal` köade tillägget med `contract_id` ur indata och prövade det aldrig mot signalens avtal. En köpost på ett annat avtal än signalens fälls i varje verkställighet (`lankaTillaggetTillSignal`, 400 `signal_annat_avtal`) och står kvar som mottagen. Genom AC 6 spärrar den sedan signalens tilläg
```

## Utfall
Tester: 152 passed (152) · Granskning: GODKANT | Task 8 är byggd som berättelsen föreskriver: avtalsprövningen står efter 409-prövningen och före varje skrivning, köposten tar avtalet ur den låsta signalraden, och K5 (j) 1–6 och kontrollva · Byggforsok: 1

## Modellkedja (Davids krav 17/8, reservvag 7/9)

* krav: **claude-opus-5-5**
* utveckling: **claude-opus-5-5**
* granskning: **claude-opus-5-5 (Codex spärrat — Davids regel 12/10; Codex granskar i efterhand)**

Granskaren ar inte forfattaren: claude-opus-5-5 (Codex spärrat — Davids regel 12/10; Codex granskar i efterhand) granskade claude-opus-5-5s arbete.

Allt pa Davids abonnemang - inga API-tokens.
