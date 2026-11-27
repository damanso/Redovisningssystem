# PRD-bygget uppdragsytan 4-3-uppdragsvyn-visar-nasta-leverans — PRD uppdragsytan 4-3-uppdragsvyn-visar-nasta-leverans: # Story 4.3: Uppdragsvyn visar nästa leverans

Datum: 2026-11-27 11:01 · Branch: cto/prd-uppdragsytan-4-3-uppdragsvyn-visar-nasta-leverans-9366 · Kalla: 02-Områden/hermes/uppdragsytan-1c-prd.md (fryst 29/9, Davids beslut #194)

## Mal
PRD uppdragsytan 4-3-uppdragsvyn-visar-nasta-leverans: # Story 4.3: Uppdragsvyn visar nästa leverans Status: ready-for-dev <!-- Note: Validation is optional. Run validate-crea

## PRD-kravet (ordagrant ur den frysta PRD:n) och astras kodgranskning
```
# Story 4.3: Uppdragsvyn visar nästa leverans

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

<!-- Kodbas: redovisning (kedjan cto). Krav: FR-45, FR-35, FR-22. Beror på: Story 4.2 (done; migration 0099_overlamningshandling och byggjournalen finns i kopian). Story key: 4-3-uppdragsvyn-visar-nasta-leverans. Skapad av create-story 2026-11-27 i #yolo-läge, mot koden i arbetskatalogens kopia av redovisningen. -->

## Story

As a David,
I want se vilken leverans som står närmast i tur, med mottagare, acceptanskriterium, revision och datum,
so that jag vet vad som ska lämnas över utan att leta i registret.

## Förkrav

Blocket räknar upp allt bygget kräver. Varje rad med läget `ändras` eller `läses` finns i arbetskatalogens kopia (kontrollerat med Glob och Grep 2026-11-27). Berättelsen skapar två nya filer: den rena regeln och provfilen. Ingen migration skapas.

```förkrav
fil: server/src/lib/nastaLeverans.ts ny
fil: server/test/uppdragsytan-nasta-leverans.test.ts ny
fil: server/src/services/uppdragLage.ts ändras
fil: server/src/http/view/routes.ts ändras
fil: docs/MCP_ACTIONS.md ändras
fil: docs/STATUS.md ändras
fil: docs/byggen/prd-uppdragsytan-4-2-overlamningen-registreras-ur-den-faktiska-handlingen.md läses
fil: server/migrations/0068_uppdragsytan.sql läses
fil: server/migrations/0099_overlamningshandling.sql läses
fil: server/src/services/uppdragRegister.ts läses
fil: server/src/services/uppdragKontrakt.ts läses
fil: server/src/services/uppdragSvep.ts läses
fil: server/src/services/uppdragStatus.ts läses
fil: server/src/lib/leverabelfalt.ts läses
fil: server/src/lib/uppdragsplan.ts läses
fil: server/src/lib/kontraktsluckor.ts läses
fil: server/src/lib/lasvarde.ts läses
fil: server/src/lib/troskel.ts läses
fil: server/src/http/view/html.ts läses
fil: server/src/actions/registry.ts läses
fil: server/src/db/migrate.ts läses
fil: server/src/db/tx.ts läses
fil: server/src/config.ts läses
fil: server/test/helpers.ts läses
fil: server/test/env.ts läses
fil: server/test/setup.ts läses
fil: server/test/globalSetup.ts läses
fil: server/test/uppdragImportHelper.ts läses
fil: server/test/fixtures/leveranskontrakt-nvr-001-v3.ts läses
fil: server/test/uppdragsytan-laget.test.ts läses
fil: server/test/uppdragsytan-overlamning.test.ts läses
fil: server/test/uppdragsytan-plan.test.ts läses
fil: server/test/uppdragsytan-register.test.ts läses
fil: server/test/uppdragsytan-leveranserna.test.ts läses
fil: server/test/uppdragsytan-kontraktsluckor.test.ts läses
fil: server/test/uppdragsytan-matt-rytm.test.ts läses
fil: server/test/uppdragsytan-scopelinje.test.ts läses
fil: server/test/uppdragsytan-agandegrans-cache.test.ts läses
fil: server/test/uppdragsytan-utskick.test.ts läses
fil: server/test/uppdragsytan-registerkopia.test.ts läses
fil: server/test/utskickHelper.ts läses
fil: server/vitest.config.ts läses
fil: server/tsconfig.test.json läses
fil: server/package.json läses
fil: server/kontrakt/navigation.v1.json läses
fil: docs/project-context.md läses
fil: docs/ARKITEKTUR.md läses
fil: CLAUDE.md läses
prov: adresskontraktet berörs GRÖN
prov: designparitet berörs GRÖN
prov: flerbolag berörs GRÖN
prov: handgrepp berörs GRÖN
prov: procentforbud berörs GRÖN
tjanst: 127.0.0.1:5433 vitest kör proven mot testdatabasen i Postgres 16
```

Berättelsens egna prov är vitest-filer i `server/test` och står som `fil:`-rader: den nya provfilen har läget `ny`, och regressionsfilerna har läget `läses`. Ingen befintlig provfil ändras. `prov:`-raderna är Hermes prov. De läser releasen, källan eller driftens databas och körs av Hermes provvakt på dess eget schema, inte av kedjans `npm test` (Dev Notes, ”Kedjan kontrollerar i drift”).

- **Baslinjen.** Provvaktens senaste bokförda körning (tillståndsfilen i Hermes hemkatalog, körningen 2026-11-27 06.30–07.38) lästes 2026-11-27 med fältet `lage` per prov. Källtexten i arbetskatalogens kopia av Hermes prov söktes efter berättelsens moduler som hela ord (nastaLeverans, uppdragLage, routes, MCP_ACTIONS, STATUS och provfilens namn). Fyra icke-GRÖNA prov träffar: bmadglidning (RÖD), continuityvakt (KUNDE_INTE), overlamningsregister_fr6 (RÖD) och scope_grind (RÖD). Därtill står modulprov, som kör `npm test -- uppdragsytan` och alltså också den nya provfilen, som KUNDE_INTE sedan 2026-11-27 07.38. Raderna står ändå inte i blocket, av samma skäl som i Story 2.3–2.8, 3.3, 3.6, 4.1 och 4.2: kodbasen är redovisning, så kedjan cto bygger berättelsen, och förkontrollens K4 fäller varje `prov:`-rad som inte är GRÖN i en annan kedja än hermes (underlaget kedjans-formagor, kedjan cto: nytt_prov_ej_gront nej). Berättelsen gör inte proven röda och ska inte göra dem gröna. Övriga träffar är GRÖNA och läser ingenting som berättelsen ändrar på ett sätt som rör dem.
- **De GRÖNA raderna** är prov som läser det berättelsen ändrar, alla GRÖNA i samma körning: adresskontraktet jämför vyns rutter i `server/src/http/view/routes.ts` med `server/kontrakt/navigation.v1.json` (berättelsen lägger inte till och tar inte bort någon rutt); designparitet mäter Läget inloggat (berättelsen inför ingen ny klass); flerbolag kräver `company_id` i varje mallsträng mot en `uppdrag_`-tabell i tjänstfilerna (den nya frågan i `server/src/services/uppdragLage.ts`); handgrepp läser ensamma kodspann i avsnittet Uppdragsytan i `docs/MCP_ACTIONS.md`; procentforbud läser vy- och tjänstfilerna efter procent som uttryck för läge.
- **Inga `kontrakt:`-rader.** Berättelsen ändrar inget namn som en annan del läser: `las_uppdragslage` får ett nytt fält, ingen rutt och ingen åtgärd tillkommer, och förkontrollens K8 fäller kontraktsrader i kedjan cto när kontraktsprovet inte är ett Hermes-prov i basen. Löftena hålls av fallen i den nya provfilen.
- **Inga `beroende:`-rader**, eftersom inget paket tillkommer. **Inga `kommando:`-rader**, eftersom kedjan cto inte ger byggaren förmågan att köra kommandon som grind (kedjans förmågor, kommando nej). Körningarna i uppgifterna (`npm run typecheck`, `npm run build` och `npm test`) körs bara om sessionen har ett skal, och ingen ruta kräver dem. Kedjans egen `npm ci`, typkontroll och `npm test` är grindens belägg. **Inga `kraver:`- eller `namner:`-rader**, eftersom bygget bara skriver filer i kopian och ordregelns fyra ord inte förekommer i berättelsen.
- **Ingen `fil:`-rad för Hermes kod.** Kedjan cto prövar en `läses`-rad mot filen i sitt eget repo, där det inte finns någon katalog hermes/. Berättelsen nämner Hermes filer utan kodformat. Hermes kod ändras inte.

## Acceptance Criteria

Lydelsen i varje **Given/When/Then** är ordagrann ur epics.md (Story 4.3). Raden **Mätbart** under ett kriterium är berättelsens tillägg. Den anger mekanismen som gör ett ”inget”, ”aldrig” eller ”ingen” sant genom konstruktion och den ändliga fallista som provet prövar. Kriteriet ändras inte av den. Varje nytt fall bär sitt id (4.3-N, 4.3-A, 4.3-V eller 4.3-D) först i titeln. Fallens innehåll står i Dev Notes, ”Fallen”. I kriterium 1 står sökvägen lib/nastaLeverans.ts utan kodformat: förkontrollen läser varje kodformaterad sökväg mot Förkrav, och filen heter där `server/src/lib/nastaLeverans.ts`. Orden är ordagranna.

1. **Given** den rena funktionen lib/nastaLeverans.ts
   **When** nästa leverans härleds
   **Then** utesluts leverabler i `levererad` och `godkand`
   **And** resten sorteras på tidigaste slut av eget eller ärvt intervall, vid lika på lägsta L-nummer räknat numeriskt (L2 före L10)
   **And** en leverabel utan intervall sorteras sist och visas med ”datum saknas”
   **And** inget statusfält och ingen kolumn läggs till.

   **Mätbart:** tre mekanismer. (1) En tillåtelselista: bara lägena i `KANDIDATLAGEN` (`ej_paborjad`, `pagar`, `avvisad`) kan bli nästa leverans, så `levererad`, `godkand` och varje okänt läge är uteslutna utan att någon uteslutning behöver räknas upp. (2) En regel, en plats: intervallets slut läses bara ur `byggPlan` i `server/src/lib/uppdragsplan.ts` (stapelns `end_dat
```

## Utfall
Tester: 214 passed (214) · Granskning: GODKANT | Alla sju acceptanskriterier är implementerade, D1:s avgränsningsfel är rättat och inga kvarstående fynd har identifierats med kedjans gröna testutfall. · Byggforsok: 2

## Modellkedja (Davids krav 17/8, reservvag 7/9)

* krav: kordes inte
* utveckling: **gpt-6.1-sol**
* granskning: **gpt-6-astra**

Granskaren ar inte forfattaren: gpt-6-astra granskade gpt-6.1-sols arbete.

effort (Davids beslut 20/10): validering high — planeringssteg
Allt pa Davids abonnemang - inga API-tokens.
