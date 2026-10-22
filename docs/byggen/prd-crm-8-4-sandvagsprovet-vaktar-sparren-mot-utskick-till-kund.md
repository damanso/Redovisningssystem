# PRD-bygget crm 8-4-sandvagsprovet-vaktar-sparren-mot-utskick-till-kund — PRD crm 8-4-sandvagsprovet-vaktar-sparren-mot-utskick-till-kund: # Story 8.4: Sändvägsprovet vaktar 

Datum: 2026-10-22 21:42 · Branch: cto/prd-crm-8-4-sandvagsprovet-vaktar-sparren-mot-utskick-till-k-9270 · Kalla: 02-Områden/hermes/prd/crm-1c-prd.md (fryst 29/9, Davids beslut #194)

## Mal
PRD crm 8-4-sandvagsprovet-vaktar-sparren-mot-utskick-till-kund: # Story 8.4: Sändvägsprovet vaktar spärren mot utskick till kund Status: ready-for-dev <!-- Note: Validation is optional

## PRD-kravet (ordagrant ur den frysta PRD:n) och astras kodgranskning
```
# Story 8.4: Sändvägsprovet vaktar spärren mot utskick till kund

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

Som David,
vill jag att ett prov blir rött om någon CRM-åtgärd någonsin får en väg att skicka något,
så att löftet "ingenting går härifrån ut till en kund" vilar på ett prov och inte på läsning.

Kodbas: redovisning (kedjan cto) · Täcker: FR-23 (spärren är ingen inställning; ett prov blir rött om en sändväg tillkommer) och NFR-4 (sändvägsprovet saknas och ska finnas) · Beror på: — · Arkitektur: P-2 «Sändvägsprovet `server/test/crm-sandvag.test.ts` (FR-23)» och kravkartan «FR-23 | P-2 | Täckt».

## Förkrav

Bygget skriver en ny provfil, en ny hjälpfil med rena kontroller och en rad i sessionsloggen. Ingen källfil i `server/src` ändras, ingen migration, ingen ny åtgärd, inget ändrat schema och ingen ny rutt. Bygget kräver ingen förmåga utöver kedjans: inget kommando, inget nät, inget nytt beroende och ingen ny tjänst. Sökvägarna är relativa kedjans bas (repots topp i /opt/redovisning).

```förkrav
fil: server/test/crm-sandvag.test.ts ny
fil: server/test/sandvagHelper.ts ny
fil: docs/STATUS.md ändras
fil: server/test/utskickHelper.ts läses
fil: server/test/uppdragsytan-utskick.test.ts läses
fil: server/test/crm-today.test.ts läses
fil: server/test/crm-schema.test.ts läses
fil: server/test/helpers.ts läses
fil: server/test/env.ts läses
fil: server/test/setup.ts läses
fil: server/test/globalSetup.ts läses
fil: server/vitest.config.ts läses
fil: server/tsconfig.test.json läses
fil: server/src/actions/registry.ts läses
fil: server/src/actions/execute.ts läses
fil: server/src/services/email.ts läses
fil: server/src/services/notifications.ts läses
fil: server/src/services/crm.ts läses
fil: server/src/services/crmDerivations.ts läses
fil: server/src/services/crmIngest.ts läses
fil: server/src/services/crmMerge.ts läses
fil: server/src/services/crmProvenance.ts läses
fil: server/src/services/crmRelations.ts läses
fil: server/src/services/crmStadning.ts läses
fil: server/src/services/crmThread.ts läses
fil: server/src/services/timeProposals.ts läses
fil: server/src/services/reports.ts läses
fil: server/src/services/taxes.ts läses
fil: server/src/services/approvalSummary.ts läses
fil: server/src/services/uppdragUndantag.ts läses
fil: server/src/lib/validation.ts läses
fil: server/src/http/view/routes.ts läses
fil: server/src/http/view/html.ts läses
fil: server/src/config.ts läses
fil: server/migrations/0021_notifications.sql läses
fil: docs/project-context.md läses
fil: docs/ARKITEKTUR.md läses
fil: docs/MCP_ACTIONS.md läses
fil: docs/crm/API_KONTRAKT.md läses
fil: CLAUDE.md läses
fil: _bmad-output/planning-artifacts/prd.md läses
fil: _bmad-output/planning-artifacts/epics.md läses
fil: _bmad-output/planning-artifacts/architecture.md läses
fil: _bmad-output/planning-artifacts/ux-design-specification.md läses
fil: _bmad-output/planning-artifacts/underlag/kodgranskning.md läses
fil: _bmad-output/planning-artifacts/underlag/davids-svar.md läses
fil: _bmad-output/planning-artifacts/underlag/kedjans-formagor.md läses
fil: _bmad-output/implementation-artifacts/8-3-en-gdpr-raderad-kalla-ateruppstar-inte-provet.md läses
fil: _bmad-output/implementation-artifacts/8-4-sandvagsprovet-vaktar-sparren-mot-utskick-till-kund.lardomar.md läses
prov: continuityvakt berörs GRÖN
prov: bakvag berörs GRÖN
beroende: vitest
beroende: supertest
tjanst: 127.0.0.1:5433 vitest kör provfilen mot den stående testdatabasen, som setup.ts återskapar före filen och där fallet D1 renderar dagsytan
kontrakt: uppdragsytan funktion importer prov uppdragsytan-utskick
kontrakt: uppdragsytan funktion upplos prov uppdragsytan-utskick
```

- **Tjänsten** är testdatabasen som kedjan cto kör hela sviten mot. Proven får nå just den adressen, enligt kedjans förmågor (planeringens förteckning, 2026-10-22): inga kommandon för byggaren, testdatabasen som enda tjänst, och ett nytt prov ska vara grönt. Hela provfilen kräver databasen, också de fall som bara läser källtext, eftersom `server/test/globalSetup.ts` och `server/test/setup.ts` ansluter och återskapar databasen före varje testfil. D1 är det enda fall som använder den. Utvecklarens sandlåda når ofta inte databasen, och det är aldrig ett HALT-skäl (Tasks, «Utan kommandon»).
- **Planeringens källor.** `_bmad-output/planning-artifacts/underlag/kodgranskning.md` och `_bmad-output/planning-artifacts/underlag/kedjans-formagor.md` finns bara i planeringens arbetsyta. Byggets kandidat har i underlag/ bara `_bmad-output/planning-artifacts/underlag/davids-svar.md`. Det som bygget behöver ur de två filerna står i den här berättelsen: kodgranskningens dom över FR-23 under «Kort om uppdraget» och kedjans förmågor i punkten ovan. Saknas de i ditt träd är det inget HALT-skäl (Tasks, «Planeringens källor»).
- **Inga kommandon.** Kedjan cto har ingen kommandoförmåga för byggaren (verktygen är Read, Glob, Grep, Write, Edit och TodoWrite). Kedjan kör själv `npm ci`, typecheck, build och hela testsviten efter din sista ändring, och ett rött test kommer tillbaka som fixrunda. Därför står inga kommandorader i blocket.
- **Berörs-raderna.** Två Hermes-prov läser den fil som bygget ändrar, `docs/STATUS.md`: `continuityvakt` jämför talen före «tester», «sviter» och «actions» i huvudet ovanför «## Sessionslogg» med den senaste körningen och registret, och `bakvag` letar efter S0.1:s rad i den driftsatta releasens STATUS.md. Båda var GRÖNA i provvaktens körning 2026-10-22 06.30, som berättelse 1.2 återger i sitt Förkrav; provvaktens statefil gick inte att läsa från den här sessionen. Bygget skriver bara en rad under «## Sessionslogg» och ändrar varken huvudets tal eller S0.1:s rad, så båda väntas förbli GRÖNA. Huvudets tal (`` `npm test` = N tester i M sviter `` och antalet actions) hålls i fas av Hermes skript `statussiffror.py` efter körningen, inte av bygget; de tolv nya fallen räknas in där. Tre andra prov nämner STATUS.md (`sex_falt`, `avkortad_overlamning`, `overlamningsregister_fr6`), men de skriver en egen fixtur i en tillfällig katalog och läser aldrig repots fil. Inget prov i kopians hermes/prov nämner orden sandvag, sandvagHelper, crm-sandvag eller utskickHelper (grep 2026-10-22: noll träffar). Kedjan cto kör inga Hermes-prov under bygget; raderna är baslinjen för kontrollen efter driftsättningen.
- **Läsfilerna:** registret (`server/src/actions/registry.ts`: importerna, `ACTIONS` och de 27 CRM-blocken), exekveringen (`server/src/actions/execute.ts`, som importerar registret och därför ligger i sändvägsmängden), e-postkön (`server/src/services/email.ts`, `server/src/services/notifications.ts`), filerna som nämner köns tabell (`server/migrations/0021_notifications.sql`, som skapar tabellen, och `server/src/http/view/html.ts`, som har två kommentarer om statusetiketterna), de åtta CRM-tjänsterna och deras grannar (`server/src/services/timeProposals.ts`, `server/src/lib/validation.ts`), naven som för in redovisningens tjänster i mängden (`server/src/services/reports.ts`, `server/src/services/taxes.ts`, `server/src/services/approvalSummary.ts`, `server/src/services/uppdragUndantag.ts`), dagsytans rendering (`server/src/http/view/routes.ts`) och miljöschemat (`server/src/config.ts`). Förlagorna är `server/test/utskickHelper.ts` och `server/test/uppdragsytan-utskick.test.ts` (rena kontroller över källtexten med planterade brott först) och `server/test/crm-today.test.ts` (dagsytan genom en inloggad agent).
- **Kontrakten.** Hjälpfilen importerar läsarna `importer` och `upplos` (och typen `Filer`) ur `server/test/utskickHelper.ts`, som hör till uppdragsytan (Story 1.16). Deras beteende vaktas av uppdragsytans prov `server/test/uppdragsytan-utskick.test.ts` (U0–U3 kör dem över hela `server/src`). Bygget ändrar dem inte. Ändras deras signatur eller de tre specifikationsformerna i `importer` ändras grafens kanter, och då ska sändvägsprovet läsas om. Ingen annan dels rutt eller fil läs
```

## Utfall
Tester: 174 passed (174) · Granskning: GODKANT | Samtliga acceptanskriterier är implementerade; inga belagda fynd, och kedjans verifierade testutfall är 174 passed. · Byggforsok: 1

## Modellkedja (Davids krav 17/8, reservvag 7/9)

* krav: kordes inte
* utveckling: **gpt-6.1-sol**
* granskning: **gpt-6-astra**

Granskaren ar inte forfattaren: gpt-6-astra granskade gpt-6.1-sols arbete.

effort (Davids beslut 20/10): validering high — planeringssteg
Allt pa Davids abonnemang - inga API-tokens.
