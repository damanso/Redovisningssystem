# PRD-bygget uppdragsytan 1-9-ett-scopeavgorande-blir-en-ny-rad-i-historiken — PRD uppdragsytan 1-9-ett-scopeavgorande-blir-en-ny-rad-i-historiken: # Story 1.9: Ett scopeavgörande

Datum: 2026-10-13 01:54 · Branch: cto/prd-uppdragsytan-1-9-ett-scopeavgorande-blir-en-ny-rad-i-his-9192 · Kalla: 02-Områden/hermes/uppdragsytan-1c-prd.md (fryst 29/9, Davids beslut #194)

## Mal
PRD uppdragsytan 1-9-ett-scopeavgorande-blir-en-ny-rad-i-historiken: # Story 1.9: Ett scopeavgörande blir en ny rad i historiken Status: ready-for-dev <!-- Note: Validation is optional. Run

## PRD-kravet (ordagrant ur den frysta PRD:n) och astras kodgranskning
```
# Story 1.9: Ett scopeavgörande blir en ny rad i historiken

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

<!-- Kodbas: redovisning. Epic 1 (Undantagsvyn). Beror på: Story 1.7 (done enligt sprint-status.yaml) och därmed 1.1–1.6. Story 1.8 står också i done. Byggvillkoren K-8 (1.1) och KRAV-13 (1.2) står i done. En migration: 0081_scopeavgorande.sql (nästa lediga nummer, mätt 2026-10-12: 0001–0080 finns). En ny tabell, ingen ny åtgärd. -->
<!-- Story key: 1-9-ett-scopeavgorande-blir-en-ny-rad-i-historiken · Story ID: 1.9 · Skapad 2026-10-12 med BMAD create-story i autonomt läge (YOLO). Berättelsen hette tidigare Story 7.1 (epics.md rad 97). -->

## Story

As a David,
I want att varje avgörande jag gör om en signal sparas som en egen rad och aldrig skriver över ett tidigare, och att en tänd signal når mig som fråga,
so that gränsen för åtagandet går att följa i efterhand och ingen tänd signal blir liggande.

**Krav:** FR-7 (bara David tänder och avgör, posten i undantagsvyn och avgörandet som registrerad handling), FR-41 (avgörandet registreras), FR-8 (signaler i den skrivskyddade historiken) och NFR-7, ur `epics.md` rad 917–967. Scopeavgörande som David tänt är en beslutad posttyp i första leveransen (PRD avsnitt 6, `prd.md` rad 1045). Arkitekturens grund är B-8 (`architecture.md` rad 309–318), åtgärdstabellen (rad 427), B-3:s tabeller (rad 458–476 och 502), kommunikationsmönstret för scopeavgörandet (rad 939), idempotensnyckeln (rad 941–944), auditnamnen (rad 948) och felexemplet `UPDATE uppdrag_scopesignal SET avgjord = …` (rad 1026). Genomförandeordningen har berättelsen som punkt 7 (rad 777). PRD:ns lydelse: Resa 4 (`prd.md` rad 384–391), FR-7 (rad 498–508), FR-8 (rad 510–518) och FR-41 (rad 871–885).

**Läget i dag, i en mening.** `avgorSignal` (`server/src/services/uppdragSignal.ts` rad 226–259) skriver över signalens svar med `UPDATE uppdrag_scopesignal SET avgjord = $3` (rad 229–234). Ett nytt avgörande raderar alltså det förra, och vem som avgjorde och när finns ingenstans. Ett ”utanför” med tillägg köar en ny `andra_baseline` vid varje anrop, utan dubblettkontroll (rad 242–257). Kodgranskningen ger FR-7 DELVIS: ”Bevara tidigare avgöranden; nu skriver ett nytt avgörande över signalens `avgjord`” (`underlag/kodgranskning.md` rad 24). Undantagsvyns läsväg från Story 1.6 bygger redan posten `scopeavgorande`, men ur kolumnen (`uppdragUndantag.ts` rad 529–547, `s.avgjord IS NULL`).

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

**Bygge och grind.** Byggkedjan bygger berättelsen i en kopia, en gren i redovisningens repo, och driftsätter först efter godkänd code-review (Dev Notes → ”Byggkedjan”). Varje uppgift och varje acceptanskriterium prövas i kopian, före driftsättningen, med proven K0–K6 i Dev Notes → ”Prov och verifiering”. Varje uppgift skriver sina egna fall och visar dem röda innan koden skrivs. Den lämnas först när fallen är gröna.

## Acceptance Criteria

Kriterierna 1–9 är ordagranna ur `epics.md` (Story 1.9, rad 929–967). Raderna under *Mätbart* anger hur kriteriet prövas i den här kodbasen och lägger inte till några krav. Två slags rader förekommer:
- **Mekanism:** det som gör ett ”aldrig”, ett ”ingen” eller ett ”bara” sant genom konstruktion, alltså en enda väg in, en rättighet som saknas, en trigger eller ett lås.
- **Fallista:** den ändliga lista som provet prövar. Inget prov letar efter ”varje skrivning” eller ”varje form” i koden.

Allt prövas i kopian. K-numren står i Dev Notes → ”Prov och verifiering”.

1. **Tabellen och överföringen.**
   **Given** nästa lediga migration
   **When** `uppdrag_scopeavgorande` skapas
   **Then** har den kategorin BASELINE, är append-only (`SELECT, INSERT`), har RLS, sammansatt FK och triggern `vagrar_skrivning_pa_avslutat`, och bär signal, avgörande (`innanfor` | `utanfor`), avgjort av, tidpunkt, underlagsreferens och eventuell tilläggsdel
   **And** migrationen för över befintliga `avgjord`-värden, och kolumnen skrivs inte mer.
   - *Mätbart:*
     - **Nästa lediga migration** är `server/migrations/0081_scopeavgorande.sql` (`parallelization-analysis.md` rad 396 reserverar namnet).
     - **Kolumnerna:** signal = `signal_id`, avgörande = `avgorande` (CHECK `innanfor` | `utanfor`), avgjort av = `avgjort_av` (uuid mot `users`), tidpunkt = `avgjort_nar`, underlagsreferens = `underlag_ref_id` (signalens referens när avgörandet gjordes), eventuell tilläggsdel = `tillagg_approval_id` (köposten för tillägget, se Dev Notes → Beslutslogg punkt 4). Därtill `id`, `company_id`, `contract_id` (som triggern `vagrar_skrivning_pa_avslutat` läser), `lopnummer`, `overford` och `created_at`.
     - **Kategorin** står som första led i `COMMENT ON TABLE`: `'Kategori: BASELINE, append-only. …'`, så att `agandebrister` (`uppdragsytan-agandegrans-cache.test.ts` rad 18–35) och Hermes `agandegrans.py` godtar tabellen. Ingen kolumn heter som någon i `BASELINEKOLUMNER` (`lib/baselinekolumner.ts`).
     - **Sammansatt FK:** `(contract_id, company_id)` mot `contracts`, `(signal_id, company_id, contract_id)` mot `uppdrag_scopesignal`, `(underlag_ref_id, company_id)` mot `uppdrag_referens` och `(tillagg_approval_id, company_id)` mot `action_approvals`.
     - **Överföringen:** varje signal med `avgjord IS NOT NULL` får en rad med `lopnummer = 1`, `avgorande` = kolumnens värde, signalens `contract_id` och `underlag_ref_id`, `overford = true` och `avgjort_av`/`avgjort_nar` = NULL. Vem och när finns inte i underlaget (Beslutslogg punkt 6), och de gissas inte. En signal utan svar 
```

## Utfall
Tester: 152 passed (152) · Granskning: GODKANT | Alla fem uppföljningar från förra varvet är åtgärdade och styrkta med prov, varje AC är implementerat, och bara två LOW-fynd finns kvar. · Byggforsok: 2

## Modellkedja (Davids krav 17/8, reservvag 7/9)

* krav: kordes inte
* utveckling: **claude-opus-5-5**
* granskning: **claude-opus-5-5 (Codex spärrat — Davids regel 12/10; Codex granskar i efterhand)**

Granskaren ar inte forfattaren: claude-opus-5-5 (Codex spärrat — Davids regel 12/10; Codex granskar i efterhand) granskade claude-opus-5-5s arbete.

Allt pa Davids abonnemang - inga API-tokens.
