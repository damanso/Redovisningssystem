# PRD-bygget uppdragsytan 5-7-stromnivan-och-absolutgolvet-enligt-davids-beslut — PRD uppdragsytan 5-7-stromnivan-och-absolutgolvet-enligt-davids-beslut: # Story 5.7: Strömnivån och 

Datum: 2026-11-28 01:37 · Branch: cto/prd-uppdragsytan-5-7-stromnivan-och-absolutgolvet-enligt-dav-9375 · Kalla: 02-Områden/hermes/uppdragsytan-1c-prd.md (fryst 29/9, Davids beslut #194)

## Mal
PRD uppdragsytan 5-7-stromnivan-och-absolutgolvet-enligt-davids-beslut: # Story 5.7: Strömnivån och absolutgolvet enligt Davids beslut Status: ready-for-dev <!-- Validering är frivillig. Kör v

## PRD-kravet (ordagrant ur den frysta PRD:n) och astras kodgranskning
```
# Story 5.7: Strömnivån och absolutgolvet enligt Davids beslut

Status: ready-for-dev

<!-- Validering är frivillig. Kör validate-create-story för kvalitetskontroll före dev-story. -->

## Story

Som David,
vill jag att strömnivån mäts mot summan av stegets leverabelramar och att golvet 22 000 kr och 20 h står som mitt beslut,
så att alla tre nivåerna mäts och inget tal bygger på ett förslag.

Kodbas: redovisning. Krav: FR-3 (strömnivån och absolutgolvet). Davids svar 2026-10-07 15:35 (underlag/davids-svar.md): strömnivån mäts mot «Stegets leverabelramar», och absolutgolvet godkänns («Jag godkänner»). Beror på: Story 5.3 (done, Approve 2026-11-27).

## Förkrav

Blocket räknar upp allt bygget kräver. Varje rad med läget `ändras` eller `läses` finns i arbetskatalogens kopia (kontrollerat med Glob och Grep 2026-11-28). Berättelsen skapar två nya filer: provfilen för strömnivån och dess hjälpfil. Ingen migration, ingen rutt, ingen åtgärd och inget beroende tillkommer.

```förkrav
fil: server/src/lib/troskel.ts ändras
fil: server/src/lib/forbrukningsnivaer.ts ändras
fil: server/src/http/view/uppdragForbrukning.ts ändras
fil: server/src/http/view/uppdragTroskel.ts ändras
fil: server/src/lib/leveranskontrakt.ts läses
fil: server/src/lib/bindningsmal.ts läses
fil: server/src/lib/uppdragsplan.ts läses
fil: server/src/lib/duration.ts läses
fil: server/src/lib/lasvarde.ts läses
fil: server/src/config.ts läses
fil: server/src/services/contracts.ts läses
fil: server/src/services/uppdragSvep.ts läses
fil: server/src/services/uppdragPengar.ts läses
fil: server/src/services/uppdragLage.ts läses
fil: server/src/services/uppdragUndantag.ts läses
fil: server/src/services/approvals.ts läses
fil: server/src/services/projects.ts läses
fil: server/src/http/view/routes.ts läses
fil: server/src/http/view/html.ts läses
fil: server/src/actions/registry.ts läses
fil: server/src/db/tx.ts läses
fil: server/migrations/0068_uppdragsytan.sql läses
fil: server/migrations/0099_overlamningshandling.sql läses
fil: server/test/fixtures/leveranskontrakt-nvr-001-v3.ts läses
fil: server/test/stromnivaHelper.ts ny
fil: server/test/uppdragsytan-stromniva.test.ts ny
fil: server/test/uppdragsytan-troskel.test.ts ändras
fil: server/test/troskelHelper.ts ändras
fil: server/test/uppdragsytan-troskelmandat.test.ts ändras
fil: server/test/forbrukningsnivaerHelper.ts ändras
fil: server/test/uppdragsytan-forbrukning.test.ts ändras
fil: server/test/uppdragImportHelper.ts läses
fil: server/test/uppdragsytan-import-v3.test.ts läses
fil: server/test/uppdragsytan-pengarna.test.ts läses
fil: server/test/uppdragsytan-laget.test.ts läses
fil: server/test/uppdragsytan-matt-rytm.test.ts läses
fil: server/test/uppdragsytan-svep.test.ts läses
fil: server/test/uppdragsytan-undantag.test.ts läses
fil: server/test/uppdragsytan-menyn.test.ts läses
fil: server/test/uppdragsytan-kostnadssparr.test.ts läses
fil: server/test/uppdragsytan-prognosplats.test.ts läses
fil: server/test/uppdragsytan-overlamning.test.ts läses
fil: server/test/uppdragsytan-luckunderlag.test.ts läses
fil: server/test/uppdragsytan-kontraktsluckor.test.ts läses
fil: server/test/uppdragsytan-registerkopia.test.ts läses
fil: server/test/steering-liquidity.test.ts läses
fil: server/test/helpers.ts läses
fil: server/test/env.ts läses
fil: server/test/setup.ts läses
fil: server/test/globalSetup.ts läses
fil: server/vitest.config.ts läses
fil: server/package.json läses
fil: package.json läses
fil: docs/ARKITEKTUR.md ändras
fil: docs/MCP_ACTIONS.md ändras
fil: docs/STATUS.md ändras
fil: CLAUDE.md läses
prov: cronvakter_nfr8 berörs GRÖN
prov: handgrepp berörs GRÖN
prov: kraschslut_prov berörs GRÖN
prov: ovrigtforslag berörs GRÖN
prov: procentforbud berörs GRÖN
prov: resonemangsunderlag berörs GRÖN
prov: svepet berörs GRÖN
tjanst: 127.0.0.1:5433 vitest kör proven mot testdatabasen i Postgres 16
```

Berättelsens egna prov är vitest-filer i `server/test` och står som `fil:`-rader: de två nya filerna har läget `ny`, de befintliga provfiler vars påståenden berättelsen skriver om har läget `ändras` (Dev Notes, «Befintliga prov som ändras»), och regressionsfilerna har läget `läses`. `prov:`-raderna är Hermes prov i hermes/prov. De körs av byggslingan och provvakten, inte av kedjans `npm test` (Dev Notes, «Kedjan kontrollerar i drift»).

- **De GRÖNA raderna** är de Hermes-prov direkt under hermes/prov vars källtext nämner en modul som berättelsen ändrar som helt ord (`troskel`, `forbrukningsnivaer`, `uppdragForbrukning` eller `uppdragTroskel`; Grep 2026-11-28: cronvakter_nfr8, kraschslut_prov och resonemangsunderlag), och som var GRÖNA i provvaktens senaste bokförda körning (provvaktens tillståndsfil, körningen 2026-11-27 06.30–07.27). Inget prov nämner de nya provfilerna.
- **Prov som läser en fil som berättelsen ändrar står också i blocket**, fast de inte nämner en ändrad kodmodul som helt ord. procentforbud (K2) läser varje vy- och tjänstefil vars namn börjar på uppdrag, alltså de två vyfiler berättelsen ändrar. svepet läser varje ts-fil under vykatalogen och fäller ett nätanrop där. handgrepp läser ensamma kodspann i avsnittet Uppdragsytan i `docs/MCP_ACTIONS.md`, och ovrigtforslag läser samma fil efter Övrigt-namnen, som berättelsen inte rör. Alla fyra var GRÖNA i samma körning (handgrepp enligt Story 4.3, 4.4 och 14.1, svepet och ovrigtforslag enligt Story 5.4, som alla läste körningen 2026-11-27 06.30).
- **Icke-GRÖNA prov som träffar dokumentens namn** står inte i blocket. Epikens berättelser räknar MCP_ACTIONS, ARKITEKTUR och STATUS som moduler när dokumenten ändras (Story 4.3, 4.4 och 14.1). I körningen 2026-11-27 06.30 träffar då tre icke-GRÖNA prov: continuityvakt (KUNDE_INTE; läser rubrikstyckets antal åtgärder i `docs/STATUS.md`), overlamningsregister_fr6 (RÖD; ordet STATUS i en fixtur) och scope_grind (RÖD; ordet ARKITEKTUR i en provsträng). Kodbasen är redovisning, så kedjan cto bygger berättelsen, och förkontrollens K4 fäller varje `prov:`-rad som inte är GRÖN i en annan kedja än hermes. Berättelsen gör inte proven röda och ska inte göra dem gröna. Talet över antalet åtgärder i rubrikstycket i `docs/STATUS.md` ändras inte (Task 5.4), så continuityvakt får inget nytt skäl att fälla.
- **Inga `beroende:`-, `kontrakt:`-, `kommando:`-, `kraver:`- eller `namner:`-rader.** Inget paket tillkommer. Ingen åtgärd, inget schema och ingen rutt ändras: svepet skriver samma nyckel `troskellarm` med samma nycklar och samma tre larmformer, och ett larm kan nu bära en strömkod (till exempel STEG2) i fältet `kod`, som redan är en sträng. Hermes resonemangsyta läser larmen generiskt (hermes/skills/resonemang.py, `larm_for` och `larmnyckel`), och provet resonemangsunderlag står redan i blocket. Kedjan cto ger inte byggaren förmågan att köra andra kommandon än `npm run typecheck` och `npm test`.

## Acceptance Criteria

Lydelsen är epics.md:s, ordagrant. Under de kriterier som lovar att något aldrig sker, inte används eller inte ingår står raden «Mätbart» med mekanismen och den ändliga fallistan. Fallens fulla förväntan står i Dev Notes, avsnittet «Fallen».

1. **Given** en ström (ett steg) i baselinen
   **When** strömnivån mäts
   **Then** är strömmens ram summan av ramarna för stegets leverabler: för NVR-001 STEG1 40 h (L1), STEG2 275 h (L2 och L3), STEG3 80 h (L4 och L5) och STEG4 20 h (L6), enligt v3-fixturens placering (`server/test/fixtures/leveranskontrakt-nvr-001-v3.ts`, rad 191–196)
   **And** regeln ligger i en enda ren funktion med källan antecknad (”Davids svar 2026-10-07”), och fasramen (cirka 40 · 185 · 170 · 35 h) används inte som strömram
   **And** de 15 h löpande styrning, som inte är en leverabel, ingår inte i någon ström
   **And** saknar en leverabel i steget egen ram visas strömmens ram som ”ram saknas”, aldrig som en delsumma.
   - **Mätbart:** mekanismen är en enda väg in. En ströms ram avgörs bara i den nya rena funktionen `stromramar` i `server/src/lib/troskel.ts`, med källan i konstanten `STROMRAMENS_KALLA` (”Davids svar 2026-10-07”). F
```

## Utfall
Tester: 222 passed (222) · Granskning: GODKANT | Alla fyra acceptanskriterier är implementerade och inga konkreta fel har identifierats. · Byggforsok: 1

## Modellkedja (Davids krav 17/8, reservvag 7/9)

* krav: kordes inte
* utveckling: **claude-opus-5-5**
* granskning: **gpt-6-astra**

Granskaren ar inte forfattaren: gpt-6-astra granskade claude-opus-5-5s arbete.

effort (Davids beslut 20/10): create-story high · validering high · bygg xhigh — delen okänd
Allt pa Davids abonnemang - inga API-tokens.
