# PRD-bygget uppdragsytan 5-3-trosklarna-indikerar-avvikelse-men-filtrerar-aldrig-ett-mandat — PRD uppdragsytan 5-3-trosklarna-indikerar-avvikelse-men-filtrerar-aldrig-ett-mandat: # Story 5.3: Tr

Datum: 2026-11-27 18:51 · Branch: cto/prd-uppdragsytan-5-3-trosklarna-indikerar-avvikelse-men-filt-9370 · Kalla: 02-Områden/hermes/uppdragsytan-1c-prd.md (fryst 29/9, Davids beslut #194)

## Mal
PRD uppdragsytan 5-3-trosklarna-indikerar-avvikelse-men-filtrerar-aldrig-ett-mandat: # Story 5.3: Trösklarna indikerar avvikelse men filtrerar aldrig ett mandat Status: ready-for-dev <!-- Validering är fri

## PRD-kravet (ordagrant ur den frysta PRD:n) och astras kodgranskning
```
# Story 5.3: Trösklarna indikerar avvikelse men filtrerar aldrig ett mandat

Status: ready-for-dev

<!-- Validering är frivillig. Kör validate-create-story för kvalitetskontroll före dev-story. -->

## Story

Som David,
vill jag att en avvikelse tänds på samma regel för stora och små poster och att en tröskel aldrig döljer en kostnadsbindning eller baselineändring,
så att larmen betyder något utan att mitt mandat beror på beloppet.

Kodbas: redovisning. Krav: FR-3 (trösklarna och de sex acceptansfallen), FR-4, FR-40, NFR-11. Beror på: Story 5.2 (done, byggjournalen finns i kopian).

## Förkrav

Blocket räknar upp allt bygget kräver. Varje rad med läget `ändras` eller `läses` finns i arbetskatalogens kopia (kontrollerat med Glob och Grep 2026-11-27). Berättelsen skapar tre nya filer: vyfilen för tröskelns texter, provfilen och dess hjälpfil. Ingen migration, ingen rutt och ingen åtgärd tillkommer. `docs/MCP_ACTIONS.md` ändras ändå, eftersom den beskriver värdet `troskellarm` som svepet skriver och `las_uppdragslage` lämnar ut, och det värdet får en nyckel och en ny dagsregel (Task 4.4).

```förkrav
fil: server/src/lib/troskel.ts ändras
fil: server/src/lib/forbrukningsnivaer.ts ändras
fil: server/src/services/uppdragPengar.ts ändras
fil: server/src/http/view/routes.ts ändras
fil: server/src/http/view/uppdragTroskel.ts ny
fil: server/src/lib/uppdragsplan.ts läses
fil: server/src/lib/lasvarde.ts läses
fil: server/src/lib/duration.ts läses
fil: server/src/services/uppdragSvep.ts läses
fil: server/src/services/uppdragLage.ts läses
fil: server/src/services/uppdragUndantag.ts läses
fil: server/src/services/approvals.ts läses
fil: server/src/services/contracts.ts läses
fil: server/src/services/projects.ts läses
fil: server/src/db/tx.ts läses
fil: server/src/actions/registry.ts läses
fil: server/src/http/view/html.ts läses
fil: server/src/http/view/uppdragForbrukning.ts läses
fil: server/migrations/0068_uppdragsytan.sql läses
fil: server/migrations/0099_overlamningshandling.sql läses
fil: docs/byggen/prd-uppdragsytan-5-2-forbrukningen-mot-ram-tar-med-det-som-inte-ar-fordelat.md läses
fil: server/test/troskelHelper.ts ny
fil: server/test/uppdragsytan-troskelmandat.test.ts ny
fil: server/test/uppdragsytan-troskel.test.ts ändras
fil: server/test/uppdragsytan-undantag.test.ts läses
fil: server/test/uppdragsytan-pengarna.test.ts läses
fil: server/test/uppdragsytan-laget.test.ts läses
fil: server/test/uppdragsytan-forbrukning.test.ts läses
fil: server/test/forbrukningsnivaerHelper.ts läses
fil: server/test/uppdragsytan-matt-rytm.test.ts läses
fil: server/test/uppdragsytan-kostnadssparr.test.ts läses
fil: server/test/uppdragsytan-beslut.test.ts läses
fil: server/test/uppdragsytan-menyn.test.ts läses
fil: server/test/uppdragsytan-svep.test.ts läses
fil: server/test/uppdragsytan-utskick.test.ts läses
fil: server/test/utskickHelper.ts läses
fil: server/test/uppdragsytan-faktureringsunderlag.test.ts läses
fil: server/test/helpers.ts läses
fil: server/test/env.ts läses
fil: server/test/setup.ts läses
fil: server/test/globalSetup.ts läses
fil: server/vitest.config.ts läses
fil: server/package.json läses
fil: package.json läses
fil: docs/ARKITEKTUR.md ändras
fil: docs/STATUS.md ändras
fil: docs/MCP_ACTIONS.md ändras
fil: CLAUDE.md läses
prov: adresskontraktet berörs GRÖN
prov: cronvakter_nfr8 berörs GRÖN
prov: designsvep berörs GRÖN
prov: hushallet_fr36 berörs GRÖN
prov: kraschslut_prov berörs GRÖN
prov: procentforbud berörs GRÖN
prov: r5_soktjansten_fr6 berörs GRÖN
prov: redovisning_fortroende_prov berörs GRÖN
prov: resonemangsunderlag berörs GRÖN
prov: rollpassen_fr41 berörs GRÖN
prov: rollpassen_fr43 berörs GRÖN
tjanst: 127.0.0.1:5433 vitest kör proven mot testdatabasen i Postgres 16
```

Berättelsens egna prov är vitest-filer i `server/test` och står som `fil:`-rader: de två nya filerna har läget `ny`, den befintliga provfil som Task 1 skriver om har läget `ändras`, och regressionsfilerna har läget `läses`. `prov:`-raderna är Hermes prov i hermes/prov. De körs av byggslingan och provvakten, inte av kedjans `npm test` (Dev Notes, «Kedjan kontrollerar i drift»).

- **De GRÖNA raderna** är de Hermes-prov direkt under hermes/prov vars källtext nämner en modul som berättelsen ändrar (`troskel`, `uppdragPengar` eller `routes` som helt ord; Grep 2026-11-27) och som var GRÖNA i provvaktens senaste bokförda körning (provvaktens tillståndsfil, körningen 2026-11-27 06.30). Inget prov nämner `forbrukningsnivaer`, den nya modulen `uppdragTroskel` eller de nya provfilerna.
- **procentforbud står också i blocket**, fast det inte nämner en ändrad modul: dess kontroll K2 läser varje vy- och tjänstefil vars namn börjar på uppdrag, alltså också den nya vyfilen, och berättelsen nämner provet (Dev Notes, «Kedjan kontrollerar i drift»). Det var GRÖNT i samma körning.
- **bmadglidning (RÖD sedan 2026-10-13 06.42) står inte i blocket**, fast dess källtext nämner `routes`. Kedjan cto bygger berättelsen, och förkontrollens K4 fäller varje `prov:`-rad som inte är GRÖN i en annan kedja än hermes (underlaget kedjans-formagor, kedjan cto: nytt_prov_ej_gront nej). Samma val gjordes i Story 4.1–4.4, 5.1 och 5.2 (Beslutslogg 15).
- **Inga `beroende:`-, `kontrakt:`-, `kommando:`-, `kraver:`- eller `namner:`-rader.** Inget paket tillkommer, och K5 läser i kedjan cto bara rotens `package.json`, som saknar `dependencies`. Tröskeln är ingen åtgärd och inget svepkontrakt mot Hermes ändras: `kor_uppdragssvep` får samma indata och skriver samma nyckel. Hermes läser `troskellarm.larm` genom `las_uppdragslage` (resonemangsytan läser larmens fält med get), och larmens tre former behåller exakt sina nycklar (T0 d); värdet får bara nyckeln `utan_egen_ram` till, och provet resonemangsunderlag står redan i blocket. Därför ingen `kontrakt:`-rad. Kedjan cto ger inte byggaren förmågan att köra kommandon som grind. Bygget skriver bara filer i kopian, och ordregelns fyra ord förekommer inte i berättelsen.

## Acceptance Criteria

Lydelsen är epics.md:s, ordagrant; bara kodformatet runt filnamnet i kriterium 1 är borttaget, eftersom förkontrollens K1 kräver hela sökvägen för varje kodspann med filändelse (regeln står i `server/src/lib/troskel.ts`). Under de kriterier som lovar att något aldrig sker, gäller alla fall eller har en enda plats står raden «Mätbart» med mekanismen och den ändliga fallistan. Fallens fulla förväntan står i Dev Notes, avsnittet «Fallen».

1. **Given** lib/troskel.ts som enda plats för regeln
   **When** belopps- och timtröskeln prövas
   **Then** tänder den när avvikelsen överstiger både 5 % av nivåns egen ram och absolutgolvet 22 000 kr eller 20 h:
   - 30 000 kr mot 473 000 kr tänder (5 % = 23 650 kr).
   - 2 400 kr (30 %) mot en kostnadsrad med egen ram på 8 000 kr tänder inte, eftersom golvet slår.
   - 30 h mot 430 h tänder (5 % = 21,5 h), medan 18 h inte gör det.
   - **Mätbart:** mekanismen är en tillåtelselista över filer. Regelns ingångar (`passerarTroskel`, `bindandeTroskel`, `heltalstrosklar`) nämns bara i `server/src/lib/troskel.ts`, `harledTroskellarm` bara där och i `server/src/services/uppdragSvep.ts` (den enda anroparen), och avtalets tröskelkolumner bara i samma två filer. Övriga läsare läser det lagrade `troskellarm` och räknar aldrig om. Fallistan: MA2 a–c med planterad negativ kontroll och gränsplantering, och de befintliga fallen KRAV-6 (1), (2) och (4) i `server/test/uppdragsytan-troskel.test.ts`, som prövar de tre exemplen ordagrant.

2. **Given** en kostnadsrad med egen ram i baselinen
   **When** dess avvikelse prövas
   **Then** är procentbasen kostnadsradens egen ram
   **And** en kostnadsrad utan egen ram visar ”ram saknas” och ingen procent.
   - **Mätbart:** mekanismen är en enda väg in. Nivåns ram läses bara genom den nya rena funktionen `egenRam` i `server/src/lib/troskel.ts`, som ger `null` för ett tak som saknas eller är summerat ur barnen (`cap_derived`). Varje mätnivå och enhet utan egen ram blir en post i `utan_egen_ram` (bara `kod` och `enhet`, inga tal), och
```

## Utfall
Tester: 220 passed (220) · Granskning: GODKANT | Samtliga åtta acceptanskriterier är implementerade; inga konkreta fel hittades och kedjans typkontroll och hela testsvit är gröna. · Byggforsok: 1

## Modellkedja (Davids krav 17/8, reservvag 7/9)

* krav: kordes inte
* utveckling: **claude-opus-5-5**
* granskning: **gpt-6-astra**

Granskaren ar inte forfattaren: gpt-6-astra granskade claude-opus-5-5s arbete.

effort (Davids beslut 20/10): create-story high · validering high · bygg xhigh — delen okänd
Allt pa Davids abonnemang - inga API-tokens.
