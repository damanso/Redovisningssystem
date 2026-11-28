# PRD-bygget uppdragsytan 6-2-uppdragsvyn-visar-de-fem-delarna-och-bara-verkliga-mandatfragor — PRD uppdragsytan 6-2-uppdragsvyn-visar-de-fem-delarna-och-bara-verkliga-mandatfragor: # Story 6.2: U

Datum: 2026-11-28 12:50 · Branch: cto/prd-uppdragsytan-6-2-uppdragsvyn-visar-de-fem-delarna-och-ba-9381 · Kalla: 02-Områden/hermes/uppdragsytan-1c-prd.md (fryst 29/9, Davids beslut #194)

## Mal
PRD uppdragsytan 6-2-uppdragsvyn-visar-de-fem-delarna-och-bara-verkliga-mandatfragor: # Story 6.2: Uppdragsvyn visar de fem delarna och bara verkliga mandatfrågor Status: ready-for-dev <!-- Validering är fr

## PRD-kravet (ordagrant ur den frysta PRD:n) och astras kodgranskning
```
# Story 6.2: Uppdragsvyn visar de fem delarna och bara verkliga mandatfrågor

Status: ready-for-dev

<!-- Validering är frivillig. Kör validate-create-story för kvalitetskontroll före dev-story. -->

## Story

Som David
vill jag se uppdragets hela läge på en sida utan att fråga någon,
så att jag förstår var vi står och vad som väntar på mig utan att gå igenom friska uppdrag.

Kodbas: redovisning (kedjan cto). Krav: FR-18, FR-40 (detaljvyn bakom ingången), FR-22, NFR-3, NFR-4. Beror på: Story 6.1 (done: `Lasvarde` per värde, `varden` i `lasUppdragslage`, färskhetsrad i varje värdeblock) och Story 4.3 (done: nästa leverans i kortet Leverabler per läge). Undantagsvyns läsväg kommer ur Story 1.6 och vyn ur Story 1.11 (båda done).

I dag har Läget ett handgreppsband överst och fem kort, där det femte kortet, Öppna köposter, och bandet läser bolagets kö genom `listApprovals` med `LIMIT 200` och visar varje väntande köpost som rör uppdraget, också sådana som inte är mandatfrågor. Berättelsen ersätter bandet och det femte kortet med en enda del, Frågor som kräver ditt mandat, som är exakt undantagsvyns poster för uppdraget. Den gör också bedömningskortets tomläge ärligt: «Ingen bedömning satt», aldrig grönt och aldrig föregående periods läge.

## Förkrav

Blocket räknar upp allt bygget kräver. Varje rad med läget `ändras` eller `läses` finns i arbetskatalogens kopia (kontrollerat med Glob och ls 2026-11-28). Berättelsen skapar en enda ny fil, provfilen. Ingen migration, ingen åtgärd, ingen rutt och inget beroende tillkommer.

```förkrav
fil: server/test/uppdragsytan-lagets-delar.test.ts ny
fil: server/src/services/uppdragUndantag.ts ändras
fil: server/src/services/uppdragLage.ts ändras
fil: server/src/lib/bedomningsrytm.ts ändras
fil: server/src/http/view/undantagsvyn.ts ändras
fil: server/src/http/view/routes.ts ändras
fil: server/test/uppdragsytan-laget.test.ts ändras
fil: server/test/uppdragsytan-lasvarde.test.ts ändras
fil: server/test/uppdragsytan-scopelinje.test.ts ändras
fil: server/test/uppdragsytan-matt-rytm.test.ts ändras
fil: server/test/uppdragsytan-bedomningsbegaran.test.ts ändras
fil: server/test/uppdragsytan-prognosplats.test.ts ändras
fil: server/test/uppdragsytan-nasta-leverans.test.ts ändras
fil: docs/ARKITEKTUR.md ändras
fil: docs/MCP_ACTIONS.md ändras
fil: docs/STATUS.md ändras
fil: server/src/actions/registry.ts läses
fil: server/src/services/approvals.ts läses
fil: server/src/services/uppdragBedomning.ts läses
fil: server/src/services/uppdragSvep.ts läses
fil: server/src/services/uppdragReferens.ts läses
fil: server/src/lib/lasvarde.ts läses
fil: server/src/http/view/html.ts läses
fil: server/src/http/view/uppdragForbrukning.ts läses
fil: server/src/http/view/uppdragTroskel.ts läses
fil: server/src/db/tx.ts läses
fil: server/migrations/0098_registerkopia.sql läses
fil: server/migrations/0100_larmregel_enligt_beslut.sql läses
fil: server/test/helpers.ts läses
fil: server/test/env.ts läses
fil: server/test/setup.ts läses
fil: server/test/globalSetup.ts läses
fil: server/test/undantagsvynRigg.ts läses
fil: server/test/undantagsvynHelper.ts läses
fil: server/test/uppdragImportHelper.ts läses
fil: server/test/bedomningsrytmHelper.ts läses
fil: server/test/fixtures/leveranskontrakt-nvr-001.ts läses
fil: server/test/sandvagHelper.ts läses
fil: server/test/utskickHelper.ts läses
fil: server/test/uppdragsytan-undantag.test.ts läses
fil: server/test/uppdragsytan-undantagsvyn.test.ts läses
fil: server/test/uppdragsytan-menyn.test.ts läses
fil: server/test/uppdragsytan-overlamning.test.ts läses
fil: server/test/uppdragsytan-statusbyte.test.ts läses
fil: server/test/uppdragsytan-beslut.test.ts läses
fil: server/test/uppdragsytan-rapporterna.test.ts läses
fil: server/test/uppdragsytan-troskelmandat.test.ts läses
fil: server/test/uppdragsytan-utskick.test.ts läses
fil: server/test/uppdragsytan-markering.test.ts läses
fil: server/test/uppdragsytan-bedomning.test.ts läses
fil: server/test/uppdragsytan-register.test.ts läses
fil: server/test/uppdragsytan-larmregel.test.ts läses
fil: server/test/crm-sandvag.test.ts läses
fil: server/test/crm-read-scope.test.ts läses
fil: server/test/steering-liquidity.test.ts läses
fil: server/vitest.config.ts läses
fil: server/tsconfig.json läses
fil: server/tsconfig.test.json läses
fil: server/package.json läses
fil: package.json läses
fil: docs/project-context.md läses
fil: docs/byggen/prd-uppdragsytan-6-1-varje-varde-i-ytorna-bar-sin-kalla-och-lastid.md läses
fil: docs/byggen/prd-uppdragsytan-4-3-uppdragsvyn-visar-nasta-leverans.md läses
fil: docs/byggen/prd-uppdragsytan-1-6-undantagsvyns-lasvag-visar-bara-mandatfragor-och-vet-vad-den-har-last.md läses
fil: docs/byggen/prd-uppdragsytan-1-11-undantagsvyn-ar-modulens-ingang-pa-dator-och-mobil.md läses
fil: CLAUDE.md läses
prov: adresskontraktet berörs GRÖN
prov: avkortad_overlamning berörs GRÖN
prov: bakvag berörs GRÖN
prov: beslutsverkstallning berörs GRÖN
prov: cto_fr20 berörs GRÖN
prov: cto_fr57 berörs GRÖN
prov: designparitet berörs GRÖN
prov: designsvep berörs GRÖN
prov: flerbolag berörs GRÖN
prov: handgrepp berörs GRÖN
prov: hushallet_fr36 berörs GRÖN
prov: kontrollytan berörs GRÖN
prov: ovrigtforslag berörs GRÖN
prov: procentforbud berörs GRÖN
prov: r5_soktjansten_fr6 berörs GRÖN
prov: redovisning_fortroende_prov berörs GRÖN
prov: resonemangsunderlag berörs GRÖN
prov: rollpassen_fr41 berörs GRÖN
prov: rollpassen_fr43 berörs GRÖN
prov: sex_falt berörs GRÖN
prov: svepet berörs GRÖN
prov: uppdragstackning berörs GRÖN
tjanst: 127.0.0.1:5433 vitest kör proven mot testdatabasen i Postgres 16
```

Berättelsens egna prov är vitest-filer i `server/test` och står som `fil:`-rader: den nya provfilen har läget `ny`, de sju provfiler vars påståenden berättelsen skriver om har läget `ändras` (Dev Notes, «Befintliga prov som ändras»), och regressionsfilerna i körningarna har läget `läses`. Beroendenas byggjournaler under docs/byggen står som `läses`, eftersom ingången prövar dem (Task 0.2). `prov:`-raderna är Hermes prov i hermes/prov. De körs av byggslingan och provvakten, inte av kedjans `npm test` (Dev Notes, «Kedjan kontrollerar i drift»).

- **Baslinjen** är provvaktens tillståndsfil under ~/.hermes/state, senaste bokförda körningen 2026-11-28 06.30 (filen gick att läsa 2026-11-28; fältet `lage` per prov).
- **Urvalet** (Grep i hermes/prov 2026-11-28, bara filer direkt under katalogen, hela ord): uppdragUndantag ger uppdragstackning, beslutsverkstallning och kontrollytan; undantagsvyn ger designparitet, uppdragstackning, kontrollytan och resonemangsunderlag; routes ger adresskontraktet, designsvep, hushallet_fr36, r5_soktjansten_fr6, redovisning_fortroende_prov, rollpassen_fr41, rollpassen_fr43 och bmadglidning; MCP_ACTIONS ger handgrepp och ovrigtforslag; ARKITEKTUR ger cto_fr20, cto_fr57 och scope_grind; STATUS.md ger bakvag, avkortad_overlamning, sex_falt, continuityvakt och overlamningsregister_fr6. uppdragLage, bedomningsrytm och de åtta provfilernas namn (den nya och de sju som ändras) nämns av inget prov.
- **Prov som läser en fil som berättelsen ändrar står också i blocket**, fast de inte nämner en ändrad modul som helt ord: flerbolag (läser tjänstefilerna vars namn börjar på uppdrag efter SQL utan `company_id`; berättelsen skriver ingen SQL), procentforbud (läser vy- och tjänstefilerna; ingen procenttext och inget förbjudet namn tillkommer) och svepet (läser ts-filerna under vykatalogen efter nätanrop). Alla tre var GRÖNA.
- **Ordet STATUS** som helt ord träffar 42 filer i hermes/prov. Berättelsen lägger bara en rad överst i sessionsloggen i `docs/STATUS.md` och tar ingen bort, samma ingrepp som Story 6.1. De fem som nämner filnamnet står ovan; av de övriga 37 var alla GRÖNA i körningen, och de står inte som rader (samma val som Story 6.1).
- **Icke-GRÖNA prov står i prosan, inte i blocket.** bmadglidning (RÖD) nämner routes, scope_grind (RÖD) nämner ARKITEKTUR, overlamningsregister_fr6 (RÖD) och continuityvakt (KUNDE_INTE) nämner STATUS.md, och modulprov (KUNDE
```

## Utfall
Tester: 225 passed (225) · Granskning: GODKANT | Samtliga acceptanskriterier är implementerade; inga belagda fynd, och kedjans typkontroll och hela testsvit är gröna. · Byggforsok: 1

## Modellkedja (Davids krav 17/8, reservvag 7/9)

* krav: kordes inte
* utveckling: **claude-opus-5-5**
* granskning: **gpt-6-astra**

Granskaren ar inte forfattaren: gpt-6-astra granskade claude-opus-5-5s arbete.

effort (Davids beslut 20/10): create-story high · validering high · bygg xhigh — delen okänd
Allt pa Davids abonnemang - inga API-tokens.
