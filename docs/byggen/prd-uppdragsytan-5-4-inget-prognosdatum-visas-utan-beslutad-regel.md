# PRD-bygget uppdragsytan 5-4-inget-prognosdatum-visas-utan-beslutad-regel — PRD uppdragsytan 5-4-inget-prognosdatum-visas-utan-beslutad-regel: # Story 5.4: Inget prognosdatum v

Datum: 2026-11-27 22:06 · Branch: cto/prd-uppdragsytan-5-4-inget-prognosdatum-visas-utan-beslutad--9372 · Kalla: 02-Områden/hermes/uppdragsytan-1c-prd.md (fryst 29/9, Davids beslut #194)

## Mal
PRD uppdragsytan 5-4-inget-prognosdatum-visas-utan-beslutad-regel: # Story 5.4: Inget prognosdatum visas utan beslutad regel Status: ready-for-dev <!-- Validering är frivillig. Kör valida

## PRD-kravet (ordagrant ur den frysta PRD:n) och astras kodgranskning
```
# Story 5.4: Inget prognosdatum visas utan beslutad regel

Status: ready-for-dev

<!-- Validering är frivillig. Kör validate-create-story för kvalitetskontroll före dev-story. -->

## Story

Som David,
vill jag att pengarna visar varför ett slutdatum inte kan härledas i stället för ett gissat datum,
så att jag aldrig planerar efter en siffra som ingen regel bär.

Kodbas: redovisning. Krav: FR-5 (det beslutade fallet och att inget gissas), FR-35, NFR-6. Beror på: Story 5.2 (done). Story 5.3 (done) är det senaste bygget i pengarnas filer och svepets tröskelsteg.

## Förkrav

Blocket räknar upp allt bygget kräver. Varje rad med läget `ändras` eller `läses` finns i arbetskatalogens kopia (kontrollerat med Glob och Grep 2026-11-27). Berättelsen skapar fyra nya filer: platsens regel i lib, platsens vyfil, provfilen och dess hjälpfil. Ingen migration, ingen rutt, ingen åtgärd och inget nytt indatafält tillkommer. `docs/MCP_ACTIONS.md` ändras ändå, eftersom den beskriver cachevärdet `prognos` som svepet skriver och `las_uppdragslage` lämnar ut, och båda får ny form (Task 5.4).

```förkrav
fil: server/src/lib/prognosplats.ts ny
fil: server/src/http/view/uppdragPrognos.ts ny
fil: server/src/services/uppdragSvep.ts ändras
fil: server/src/services/uppdragPengar.ts ändras
fil: server/src/services/uppdragLage.ts ändras
fil: server/src/http/view/routes.ts ändras
fil: server/src/http/view/html.ts läses
fil: server/src/lib/lasvarde.ts läses
fil: server/src/lib/troskel.ts läses
fil: server/src/services/contracts.ts läses
fil: server/src/services/projects.ts läses
fil: server/src/actions/registry.ts läses
fil: server/src/db/tx.ts läses
fil: server/src/http/view/uppdragTroskel.ts läses
fil: server/src/http/view/uppdragUppfoljning.ts läses
fil: server/migrations/0068_uppdragsytan.sql läses
fil: server/migrations/0099_overlamningshandling.sql läses
fil: docs/byggen/prd-uppdragsytan-5-3-trosklarna-indikerar-avvikelse-men-filtrerar-aldrig-ett-mandat.md läses
fil: server/test/prognosplatsHelper.ts ny
fil: server/test/uppdragsytan-prognosplats.test.ts ny
fil: server/test/uppdragsytan-prognos.test.ts ändras
fil: server/test/uppdragsytan-svep.test.ts ändras
fil: server/test/uppdragsytan-pengarna.test.ts ändras
fil: server/test/troskelHelper.ts läses
fil: server/test/uppdragsytan-troskel.test.ts läses
fil: server/test/uppdragsytan-troskelmandat.test.ts läses
fil: server/test/uppdragsytan-laget.test.ts läses
fil: server/test/uppdragsytan-menyn.test.ts läses
fil: server/test/uppdragsytan-kostnadssparr.test.ts läses
fil: server/test/uppdragsytan-forbrukning.test.ts läses
fil: server/test/uppdragsytan-matt-rytm.test.ts läses
fil: server/test/uppdragsytan-scopelinje.test.ts läses
fil: server/test/uppdragsytan-nasta-leverans.test.ts läses
fil: server/test/uppdragsytan-undantag.test.ts läses
fil: server/test/uppdragsytan-agandegrans-cache.test.ts läses
fil: server/test/uppdragsytan-import-v3.test.ts läses
fil: server/test/uppdragsytan-registerkopia.test.ts läses
fil: server/test/uppdragsytan-overlamning.test.ts läses
fil: server/test/uppdragsytan-kontraktsluckor.test.ts läses
fil: server/test/uppdragsytan-faktureringsunderlag.test.ts läses
fil: server/test/uppdragsytan-utskick.test.ts läses
fil: server/test/utskickHelper.ts läses
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
prov: adresskontraktet berörs GRÖN
prov: designsvep berörs GRÖN
prov: hushallet_fr36 berörs GRÖN
prov: ovrigtforslag berörs GRÖN
prov: procentforbud berörs GRÖN
prov: r5_soktjansten_fr6 berörs GRÖN
prov: redovisning_fortroende_prov berörs GRÖN
prov: resonemangsunderlag berörs GRÖN
prov: rollpassen_fr41 berörs GRÖN
prov: rollpassen_fr43 berörs GRÖN
prov: svepet berörs GRÖN
tjanst: 127.0.0.1:5433 vitest kör proven mot testdatabasen i Postgres 16
```

Berättelsens egna prov är vitest-filer i `server/test` och står som `fil:`-rader: de två nya filerna har läget `ny`, de tre befintliga provfiler som uppgifterna skriver om har läget `ändras`, och regressionsfilerna har läget `läses`. `prov:`-raderna är Hermes prov i hermes/prov. De körs av byggslingan och provvakten, inte av kedjans `npm test` (Dev Notes, «Kedjan kontrollerar i drift»).

- **De GRÖNA raderna** är de Hermes-prov direkt under hermes/prov vars källtext nämner en modul som berättelsen ändrar eller skapar som helt ord (`uppdragSvep`, `uppdragPengar`, `uppdragLage`, `routes`, `prognosplats` eller `uppdragPrognos`; Grep 2026-11-27) och som var GRÖNA i provvaktens senaste bokförda körning (provvaktens tillståndsfil, körningen 2026-11-27 06.30). Inget prov nämner de nya modulerna eller de nya provfilerna.
- **html-modulen läses bara.** Berättelsen ändrar ingenting i `server/src/http/view/html.ts`, inte ens en kommentar (anteckningen om att `ramkurva` saknar anropare står i routes-modulens kommentarsblock «PENGARNA», Task 4.4). Därför berörs inte designparitet, som mäter kanons stilmall i html-modulen; designsvep, rollpassen_fr41 och rollpassen_fr43 läser den också men står redan i blocket för `routes`.
- **handgrepp står inte i blocket**, fast det läser avsnittet `## Uppdragsytan` i `docs/MCP_ACTIONS.md`, som Task 5.4 ändrar. Provet fäller en åtgärd som modulens tabell inte känner. Berättelsen lägger ingen åtgärd och inget nytt ensamt kodspann i avsnittet (Task 5.4, PF6 b), så provets utfall ändras inte; samma val som i Story 5.3, som också ändrade avsnittet.
- **procentforbud och resonemangsunderlag står också i blocket**, fast de inte nämner en ändrad modul som ord. procentforbud läser varje vy- och tjänstefil vars namn börjar på uppdrag, alltså också den nya vyfilen; resonemangsunderlag läser `las_uppdragslage`, som får fältet `prognos` per avtal. Båda var GRÖNA i samma körning.
- **bmadglidning (RÖD sedan 2026-10-13 06.42) står inte i blocket**, fast dess källtext nämner `routes`. Kedjan cto bygger berättelsen, och förkontrollens K4 fäller varje `prov:`-rad som inte är GRÖN i en annan kedja än hermes (underlaget kedjans-formagor, kedjan cto: nytt_prov_ej_gront nej). Samma val gjordes i Story 4.1–4.4 och 5.1–5.3 (Beslutslogg 15).
- **Inga `beroende:`-, `kontrakt:`-, `kommando:`-, `kraver:`- eller `namner:`-rader.** Inget paket tillkommer, och K5 läser i kedjan cto bara rotens `package.json`, som saknar `dependencies`. Svepets indataschema (`SvepIndataSchema`) ändras inte: Hermes skickar samma anrop som i dag, och en utelämnad lista `kalenderhandelser` får bara en ärligare betydelse (Beslutslogg 6). Cachevärdet och läsåtgärdens värde får nya nycklar men inga borttagna som Hermes läser, och de prov som läser dem står redan i blocket. Kedjan cto ger inte byggaren förmågan att köra kommandon som grind. Bygget skriver bara filer i kopian.

## Acceptance Criteria

Lydelsen i kriterium 1–6 är epics.md:s, ordagrant; bara kodformatet runt filnamnet i kriterium 1 är borttaget, eftersom förkontrollens K1 kräver hela sökvägen för varje kodspann med filändelse. Kriterium 7 är tillagt av create-story ur Davids svar 2026-10-23 (Beslutslogg 2). Under de kriterier som lovar att något aldrig sker eller gäller alla fall står raden «Mätbart» med mekanismen och den ändliga fallistan. Fallens fulla förväntan står i Dev Notes, avsnittet «Fallen».

1. **Given** dagens extrapolering av ett ramdatum efter sista bokningen
   **When** pengarna och Läget renderas
   **Then** visas inget sådant datum och ingen kurva, eftersom extrapoleringen tagits bort ur visningen (uppdragSvep.ts).
   - **Mätbart:** mekanismen är ett fält som aldrig förs vidare. Svepets förlängningsgren i `ramdatum` tas bort, så att bokningar som inte når ramen ger villkoret `ingen bokad framtid`. Cachevärdets `ram_timmar` och `ram_kronor` står kvar som cache, men platsens enda läsare, `prognosplats` i `server/src/lib/prognosplats.ts`,
```

## Utfall
Tester: 221 passed (221) · Granskning: GODKANT | Samtliga acceptanskriterier och kryssade koduppgifter är implementerade; inga belagda fynd. · Byggforsok: 1

## Modellkedja (Davids krav 17/8, reservvag 7/9)

* krav: kordes inte
* utveckling: **gpt-6.1-sol** (RESERVVAG - forstahandsvalet hade natt sitt tak)
* granskning: **gpt-6-astra**

Granskaren ar inte forfattaren: gpt-6-astra granskade claude-opus-5-5 och gpt-6.1-sols arbete.

effort (Davids beslut 20/10): create-story high · validering high · bygg xhigh — delen okänd
Allt pa Davids abonnemang - inga API-tokens.
