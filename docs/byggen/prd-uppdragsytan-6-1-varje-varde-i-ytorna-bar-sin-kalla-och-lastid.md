# PRD-bygget uppdragsytan 6-1-varje-varde-i-ytorna-bar-sin-kalla-och-lastid — PRD uppdragsytan 6-1-varje-varde-i-ytorna-bar-sin-kalla-och-lastid: # Story 6.1: Varje värde i ytorn

Datum: 2026-11-28 08:47 · Branch: cto/prd-uppdragsytan-6-1-varje-varde-i-ytorna-bar-sin-kalla-och--9379 · Kalla: 02-Områden/hermes/uppdragsytan-1c-prd.md (fryst 29/9, Davids beslut #194)

## Mal
PRD uppdragsytan 6-1-varje-varde-i-ytorna-bar-sin-kalla-och-lastid: # Story 6.1: Varje värde i ytorna bär sin källa och lästid Status: ready-for-dev <!-- Validering är frivillig. Kör valid

## PRD-kravet (ordagrant ur den frysta PRD:n) och astras kodgranskning
```
# Story 6.1: Varje värde i ytorna bär sin källa och lästid

Status: ready-for-dev

<!-- Validering är frivillig. Kör validate-create-story för kvalitetskontroll före dev-story. -->

## Story

Som David
vill jag se varifrån varje tal kommer och när det lästes, vid talet,
så att jag aldrig behöver fråga om det stämmer.

Kodbas: redovisning (kedjan cto). Krav: FR-35, FR-23 (en läsväg per yta), FR-22 (oläst som oläst), NFR-5, NFR-6. Beror på: Story 1.6 (done, `Lasvarde` i `server/src/lib/lasvarde.ts`) och Story 5.2 (done, `Lasvarde` per kostnadsrad på Pengarna). Epic 6 börjar med den här berättelsen.

## Förkrav

Blocket räknar upp allt bygget kräver. Varje rad med läget `ändras` eller `läses` finns i arbetskatalogens kopia (kontrollerat med Glob och Grep 2026-11-28). Berättelsen skapar en enda ny fil, provfilen. Ingen migration, ingen åtgärd, ingen rutt och inget beroende tillkommer.

```förkrav
fil: server/test/uppdragsytan-lasvarde.test.ts ny
fil: server/src/lib/lasvarde.ts ändras
fil: server/src/services/uppdragLage.ts ändras
fil: server/src/services/uppdragRegister.ts ändras
fil: server/src/services/uppdragKontrakt.ts ändras
fil: server/src/services/uppdragPengar.ts ändras
fil: server/src/http/view/routes.ts ändras
fil: server/src/http/view/uppdragForbrukning.ts ändras
fil: server/src/http/view/uppdragTroskel.ts ändras
fil: server/test/uppdragsytan-laget.test.ts ändras
fil: server/test/uppdragsytan-register.test.ts ändras
fil: docs/ARKITEKTUR.md ändras
fil: docs/MCP_ACTIONS.md ändras
fil: docs/STATUS.md ändras
fil: server/src/actions/registry.ts läses
fil: server/src/http/view/html.ts läses
fil: server/src/http/view/uppdragUppfoljning.ts läses
fil: server/src/http/view/uppdragPrognos.ts läses
fil: server/src/lib/prognosplats.ts läses
fil: server/src/lib/nastaLeverans.ts läses
fil: server/src/lib/leverabelfalt.ts läses
fil: server/src/lib/kontraktsluckor.ts läses
fil: server/src/lib/uppdragsplan.ts läses
fil: server/src/services/uppdragUndantag.ts läses
fil: server/src/services/uppdragReferens.ts läses
fil: server/src/services/uppdragBedomning.ts läses
fil: server/src/services/uppdragAnteckning.ts läses
fil: server/src/services/invoiceFromTime.ts läses
fil: server/src/services/uppdragSvep.ts läses
fil: server/src/services/contracts.ts läses
fil: server/src/db/tx.ts läses
fil: server/migrations/0068_uppdragsytan.sql läses
fil: server/migrations/0100_larmregel_enligt_beslut.sql läses
fil: server/test/helpers.ts läses
fil: server/test/env.ts läses
fil: server/test/setup.ts läses
fil: server/test/globalSetup.ts läses
fil: server/test/uppdragImportHelper.ts läses
fil: server/test/troskelHelper.ts läses
fil: server/test/utskickHelper.ts läses
fil: server/test/fixtures/leveranskontrakt-nvr-001-v3.ts läses
fil: server/test/uppdragsytan-matt-rytm.test.ts läses
fil: server/test/uppdragsytan-larmregel.test.ts läses
fil: server/test/uppdragsytan-nasta-leverans.test.ts läses
fil: server/test/uppdragsytan-scopelinje.test.ts läses
fil: server/test/uppdragsytan-prognosplats.test.ts läses
fil: server/test/uppdragsytan-referens.test.ts läses
fil: server/test/uppdragsytan-beslut.test.ts läses
fil: server/test/uppdragsytan-troskelmandat.test.ts läses
fil: server/test/uppdragsytan-troskel.test.ts läses
fil: server/test/uppdragsytan-agandegrans-cache.test.ts läses
fil: server/test/uppdragsytan-leveranserna.test.ts läses
fil: server/test/uppdragsytan-registerkopia.test.ts läses
fil: server/test/uppdragsytan-faktureringsunderlag.test.ts läses
fil: server/test/uppdragsytan-overlamning.test.ts läses
fil: server/test/uppdragsytan-kontraktsluckor.test.ts läses
fil: server/test/uppdragsytan-menyn.test.ts läses
fil: server/test/uppdragsytan-kontraktsyta.test.ts läses
fil: server/test/uppdragsytan-luckunderlag.test.ts läses
fil: server/test/uppdragsytan-plan.test.ts läses
fil: server/test/uppdragsytan-pengarna.test.ts läses
fil: server/test/uppdragsytan-forbrukning.test.ts läses
fil: server/test/uppdragsytan-kostnadssparr.test.ts läses
fil: server/test/uppdragsytan-kostnadsforslag.test.ts läses
fil: server/test/uppdragsytan-stromniva.test.ts läses
fil: server/test/uppdragsytan-undantag.test.ts läses
fil: server/test/uppdragsytan-utskick.test.ts läses
fil: server/test/uppdragsytan-rapporterna.test.ts läses
fil: server/test/crm-sandvag.test.ts läses
fil: server/test/crm-read-scope.test.ts läses
fil: server/test/steering-liquidity.test.ts läses
fil: server/vitest.config.ts läses
fil: server/package.json läses
fil: package.json läses
fil: CLAUDE.md läses
prov: adresskontraktet berörs GRÖN
prov: cto_fr20 berörs GRÖN
prov: cto_fr57 berörs GRÖN
prov: designparitet berörs GRÖN
prov: designsvep berörs GRÖN
prov: filkontrakt_fr35 berörs GRÖN
prov: flerbolag berörs GRÖN
prov: gitvakt_filkontrakt_nfr8 berörs GRÖN
prov: handgrepp berörs GRÖN
prov: hushallet_fr36 berörs GRÖN
prov: ovrigtforslag berörs GRÖN
prov: procentforbud berörs GRÖN
prov: r5_soktjansten_fr6 berörs GRÖN
prov: redovisning_fortroende_prov berörs GRÖN
prov: rollpassen_fr41 berörs GRÖN
prov: rollpassen_fr43 berörs GRÖN
prov: svepet berörs GRÖN
tjanst: 127.0.0.1:5433 vitest kör proven mot testdatabasen i Postgres 16
```

Berättelsens egna prov är vitest-filer i `server/test` och står som `fil:`-rader: den nya provfilen har läget `ny`, de två provfiler vars påståenden berättelsen skriver om har läget `ändras` (Dev Notes, «Befintliga prov som ändras»), och regressionsfilerna har läget `läses`. `prov:`-raderna är Hermes prov i hermes/prov. De körs av byggslingan och provvakten, inte av kedjans `npm test` (Dev Notes, «Kedjan kontrollerar i drift»).

- **Baslinjen** är provvaktens tillståndsfil under ~/.hermes/state, senaste bokförda körningen 2026-11-27 06.30 (filen gick att läsa 2026-11-28, fältet `lage` per prov).
- **De GRÖNA raderna som nämner en ändrad modul som helt ord** (Grep i hermes/prov 2026-11-28, bara filer direkt under katalogen): `lasvarde` ger filkontrakt_fr35 och gitvakt_filkontrakt_nfr8; `routes` ger adresskontraktet, designsvep, hushallet_fr36, r5_soktjansten_fr6, redovisning_fortroende_prov, rollpassen_fr41 och rollpassen_fr43; `MCP_ACTIONS` ger handgrepp och ovrigtforslag; `ARKITEKTUR` ger cto_fr20 och cto_fr57. `uppdragLage`, `uppdragRegister`, `uppdragKontrakt`, `uppdragPengar`, `uppdragForbrukning`, `uppdragTroskel` och provfilens namn nämns av inget prov. Alla var GRÖNA i körningen.
- **Prov som läser en fil som berättelsen ändrar står också i blocket**, fast de inte nämner en ändrad modul som helt ord: designparitet (mäter Läget inloggat; berättelsen inför ingen ny klass), flerbolag (läser varje tjänstefil vars namn börjar på uppdrag efter SQL mot `uppdrag_`-tabeller utan `company_id`; den flyttade frågan i `server/src/services/uppdragLage.ts` bär `company_id`), procentforbud (läser vy- och tjänstefilerna vars namn börjar på uppdrag) och svepet (läser varje ts-fil under vykatalogen efter nätanrop). Alla fyra var GRÖNA i samma körning.
- **bakvag läser också releasens docs/STATUS.md**, men bara efter raden för uppdragsytan S0.1. Berättelsen lägger en rad överst i sessionsloggen och tar ingen bort, så provets utfall kan inte ändras av bygget. Provets läge i baslinjen kontrollerades inte, eftersom tillståndsfilen ligger utanför arbetskatalogen. Därför står bakvag här i prosan och inte som en `prov:`-rad.
- **Icke-GRÖNA prov står i prosan, inte i blocket.** bmadglidning (RÖD) nämner `routes` och scope_grind (RÖD) nämner `ARKITEKTUR`; modulprov (KUNDE_INTE) kör `npm test -- uppdragsytan` och tar alltså med den nya provfilen; continuityvakt (KUNDE_INTE) läser rubrikstycket i `docs/STATUS.md`, som berättelsen inte ändrar. Uppdraget säger att ett berört prov som inte är GRÖNT ska skrivas med sitt läge, men kedjan cto:s förkontroll (K4) fäller varje `prov:`-rad som inte är GRÖN i en annan kedja än hermes (underlaget kedjans-formagor, kedjan cto: nytt_prov_ej_gront nej), och då hade berättelsen inte kunnat byggas. Samma val gjordes i Story 4.1–4.4, 5.1, 5.2, 5.7 och 5.8 (Beslutslogg 11). Proven var inte GRÖNA före 
```

## Utfall
Tester: 224 passed (224) · Granskning: GODKANT | Alla sex acceptanskriterier är implementerade, förra varvets fyra fynd är åtgärdade och inga nya fynd har belagts. · Byggforsok: 2

## Modellkedja (Davids krav 17/8, reservvag 7/9)

* krav: kordes inte
* utveckling: **claude-opus-5-5**
* granskning: **gpt-6-astra**

Granskaren ar inte forfattaren: gpt-6-astra granskade claude-opus-5-5s arbete.

effort (Davids beslut 20/10): bygg xhigh — delen okänd
Allt pa Davids abonnemang - inga API-tokens.
