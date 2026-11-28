# PRD-bygget uppdragsytan 6-3-modulens-tomlagen-sager-vad-tomheten-betyder — PRD uppdragsytan 6-3-modulens-tomlagen-sager-vad-tomheten-betyder: # Story 6.3: Modulens tomlägen sä

Datum: 2026-11-28 19:42 · Branch: cto/prd-uppdragsytan-6-3-modulens-tomlagen-sager-vad-tomheten-be-9384 · Kalla: 02-Områden/hermes/uppdragsytan-1c-prd.md (fryst 29/9, Davids beslut #194)

## Mal
PRD uppdragsytan 6-3-modulens-tomlagen-sager-vad-tomheten-betyder: # Story 6.3: Modulens tomlägen säger vad tomheten betyder Status: ready-for-dev <!-- Validering är frivillig. Kör valida

## PRD-kravet (ordagrant ur den frysta PRD:n) och astras kodgranskning
```
# Story 6.3: Modulens tomlägen säger vad tomheten betyder

Status: ready-for-dev

<!-- Validering är frivillig. Kör validate-create-story för kvalitetskontroll före dev-story. -->

## Story

Som David
vill jag att en tom panel säger vad tomheten betyder och visar en väg vidare som inte ger mig en uppgift,
så att en nolla aldrig får mig att tro att något saknas eller att allt är bra.

Kodbas: redovisning (kedjan cto). Krav: FR-22, NFR-2. Beror på: Story 6.1 (done: läsvärdet `Lasvarde`, `olastEllerSaknas` och färskhetsraderna). Story 6.2 (done) har redan gett mandatdelen och bedömningskortet sina tomlägen i `.tomt`; den här berättelsen rör dem inte.

I dag ritar modulens elva vyer sina tomlägen på fyra sätt: `.empty` med `.big` (nio block: åtta i modulfunktionerna och ett i hjälparen `tomtRegister`), `p.muted` (bland annat genom hjälparna `tomtIKort` och `saknasText`), en klasslös `<p>` och, på ett fåtal ställen, `.tomt`. Flera av dem ber David om handpåläggning: Läget och Leveranserna skickar honom till sidan Avtal för att «läsa in» ett avtal som redan finns, Kontraktet ber honom läsa in avtalet igen för att få en pekare, Planen säger «läs in leveranskontraktet», Bedömning säger att underlag «fästs när en fras tänds under Signaler», uppdragslistan säger «läs in dess avtal» och beslutspanelen skickar honom till Att göra. Ett tomt register säger samma sak oavsett om kontraktet är ett utkast, om förslaget väntar på hans ja eller om inläsningen har misslyckats.

Berättelsen ger modulen en enda ritare för tomlägen, en sluten lista med 39 tomlägen och deras slag, en sluten typ för vägen vidare och en ren regel för varför registret är tomt.

## Förkrav

Blocket räknar upp allt bygget kräver. Varje rad med läget `ändras` eller `läses` finns i arbetskatalogens kopia (kontrollerat med Glob, Grep och Read 2026-11-28). Berättelsen skapar tre nya filer: vyns tomlägesfil, lib-regeln för registrets tomhet och provfilen. Ingen migration, ingen åtgärd, ingen rutt och inget beroende tillkommer.

```förkrav
fil: server/src/http/view/uppdragTomhet.ts ny
fil: server/src/lib/registertomhet.ts ny
fil: server/test/uppdragsytan-tomlagesgrammatik.test.ts ny
fil: server/src/services/uppdragRegister.ts ändras
fil: server/src/services/uppdragLage.ts ändras
fil: server/src/http/view/routes.ts ändras
fil: server/src/http/view/uppdragUppfoljning.ts ändras
fil: server/test/uppdragsytan-lasvarde.test.ts ändras
fil: server/test/uppdragsytan-laget.test.ts ändras
fil: server/test/uppdragsytan-beslut.test.ts ändras
fil: server/test/uppdragsytan-leveranserna.test.ts ändras
fil: server/test/uppdragsytan-rapporterna.test.ts ändras
fil: docs/ARKITEKTUR.md ändras
fil: docs/MCP_ACTIONS.md ändras
fil: docs/STATUS.md ändras
fil: server/src/http/view/html.ts läses
fil: server/src/http/view/undantagsvyn.ts läses
fil: server/src/http/view/uppdragForbrukning.ts läses
fil: server/src/http/view/uppdragTroskel.ts läses
fil: server/src/http/view/uppdragPrognos.ts läses
fil: server/src/lib/lasvarde.ts läses
fil: server/src/lib/kontraktsluckor.ts läses
fil: server/src/lib/nastaLeverans.ts läses
fil: server/src/lib/bedomningsrytm.ts läses
fil: server/src/services/uppdragImport.ts läses
fil: server/src/services/uppdragUndantag.ts läses
fil: server/src/services/uppdragKontrakt.ts läses
fil: server/src/services/uppdragPengar.ts läses
fil: server/src/services/uppdragDokument.ts läses
fil: server/src/services/contracts.ts läses
fil: server/src/services/approvals.ts läses
fil: server/src/actions/registry.ts läses
fil: server/src/db/tx.ts läses
fil: server/migrations/0068_uppdragsytan.sql läses
fil: server/migrations/0069_signering_fryser.sql läses
fil: server/migrations/0101_rutinstatus.sql läses
fil: server/test/helpers.ts läses
fil: server/test/env.ts läses
fil: server/test/setup.ts läses
fil: server/test/globalSetup.ts läses
fil: server/test/undantagsvynRigg.ts läses
fil: server/test/uppdragImportHelper.ts läses
fil: server/test/bedomningsrytmHelper.ts läses
fil: server/test/fixtures/leveranskontrakt-nvr-001.ts läses
fil: server/test/fixtures/leveranskontrakt-nvr-001-v3.ts läses
fil: server/test/sandvagHelper.ts läses
fil: server/test/utskickHelper.ts läses
fil: server/test/troskelHelper.ts läses
fil: server/test/prognosplatsHelper.ts läses
fil: server/test/forbrukningsnivaerHelper.ts läses
fil: server/test/uppdragsytan-lagets-delar.test.ts läses
fil: server/test/uppdragsytan-scopelinje.test.ts läses
fil: server/test/uppdragsytan-matt-rytm.test.ts läses
fil: server/test/uppdragsytan-anteckning.test.ts läses
fil: server/test/uppdragsytan-scopeavgorande.test.ts läses
fil: server/test/uppdragsytan-nasta-leverans.test.ts läses
fil: server/test/uppdragsytan-menyn.test.ts läses
fil: server/test/uppdragsytan-overlamning.test.ts läses
fil: server/test/uppdragsytan-statusbyte.test.ts läses
fil: server/test/uppdragsytan-markering.test.ts läses
fil: server/test/uppdragsytan-larmregel.test.ts läses
fil: server/test/uppdragsytan-troskelmandat.test.ts läses
fil: server/test/uppdragsytan-bedomningsbegaran.test.ts läses
fil: server/test/uppdragsytan-prognosplats.test.ts läses
fil: server/test/uppdragsytan-kontraktsluckor.test.ts läses
fil: server/test/uppdragsytan-register.test.ts läses
fil: server/test/uppdragsytan-kontraktsyta.test.ts läses
fil: server/test/uppdragsytan-plan.test.ts läses
fil: server/test/uppdragsytan-bedomning.test.ts läses
fil: server/test/uppdragsytan-kostnadsforslag.test.ts läses
fil: server/test/uppdragsytan-signaler.test.ts läses
fil: server/test/uppdragsytan-pengarna.test.ts läses
fil: server/test/uppdragsytan-kostnadssparr.test.ts läses
fil: server/test/uppdragsytan-forbrukning.test.ts läses
fil: server/test/uppdragsytan-stromniva.test.ts läses
fil: server/test/uppdragsytan-troskel.test.ts läses
fil: server/test/uppdragsytan-dokumenten.test.ts läses
fil: server/test/uppdragsytan-undantagsvyn.test.ts läses
fil: server/test/uppdragsytan-undantag.test.ts läses
fil: server/test/uppdragsytan-utskick.test.ts läses
fil: server/test/uppdragsytan-faktureringsunderlag.test.ts läses
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
fil: docs/byggen/prd-uppdragsytan-6-2-uppdragsvyn-visar-de-fem-delarna-och-bara-verkliga-mandatfragor.md läses
fil: CLAUDE.md läses
prov: adresskontraktet berörs GRÖN
prov: avkortad_overlamning berörs GRÖN
prov: bakvag berörs GRÖN
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
prov: rollpassen_fr41 berörs GRÖN
prov: rollpassen_fr43 berörs GRÖN
prov: sex_falt berörs GRÖN
prov: svepet berörs GRÖN
tjanst: 127.0.0.1:5433 vitest kör proven mot testdatabasen i Postgres 16
```

Berättelsens egna prov är vitest-filer i `server/test` och står som `fil:`-rader. Den nya provfilen har läget `ny`. De fem provfiler vars påståenden berättelsen skriver om har läget `ändras` (Dev Notes, «Befintliga prov som ändras»). Regressionsfilerna i körningarna och de provfiler och hjälpare som Dev Notes läser har läget `läses`. Beroendenas byggjournaler under docs/byggen står som `läses`, eftersom ingången prövar dem (Task 0.2). `prov:`-raderna är Hermes prov i hermes/prov. De körs av byggslingan och provvakten, inte av kedjans `npm test` (Dev Notes, «Kedjan kontrollerar i drift»).

- **Baslinjen** är provvaktens tillståndsfil under ~/.hermes/state, senaste bokförda körningen 2026-11-28 06.30. Filen gick att lä
```

## Utfall
Tester: 227 passed (227) · Granskning: GODKANT | Alla acceptanskriterier är implementerade, förra varvets fynd är åtgärdade och inga nya fel har belagts. · Byggforsok: 2

## Modellkedja (Davids krav 17/8, reservvag 7/9)

* krav: kordes inte
* utveckling: **claude-opus-5-5**
* granskning: **gpt-6-astra**

Granskaren ar inte forfattaren: gpt-6-astra granskade claude-opus-5-5s arbete.

effort (Davids beslut 20/10): create-story high · validering high · bygg xhigh — delen okänd
Allt pa Davids abonnemang - inga API-tokens.
