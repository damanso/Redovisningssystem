# PRD-bygget uppdragsytan 4-4-faktureringsflodet-laser-godkanda-leverabler-som-underlag — PRD uppdragsytan 4-4-faktureringsflodet-laser-godkanda-leverabler-som-underlag: # Story 4.4: Fakture

Datum: 2026-11-27 09:47 · Branch: cto/prd-uppdragsytan-4-4-faktureringsflodet-laser-godkanda-lever-9365 · Kalla: 02-Områden/hermes/uppdragsytan-1c-prd.md (fryst 29/9, Davids beslut #194)

## Mal
PRD uppdragsytan 4-4-faktureringsflodet-laser-godkanda-leverabler-som-underlag: # Story 4.4: Faktureringsflödet läser godkända leverabler som underlag Status: ready-for-dev <!-- Note: Validation is op

## PRD-kravet (ordagrant ur den frysta PRD:n) och astras kodgranskning
```
# Story 4.4: Faktureringsflödet läser godkända leverabler som underlag

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

<!-- Kodbas: redovisning (kedjan cto). Krav: FR-12, NFR-11. Beror på: Story 4.2 (done; migration 0099_overlamningshandling, godkann_leverabel med kanal och byggjournalen finns i kopian). Story key: 4-4-faktureringsflodet-laser-godkanda-leverabler-som-underlag. Skapad av create-story 2026-11-27 i #yolo-läge, mot koden i arbetskatalogens kopia av redovisningen. -->

## Story

As a David,
I want att faktureringsflödet visar vilka leverabler som är godkända,
so that jag ser vad som går att fakturera utan att modulen fakturerar åt mig.

## Förkrav

Blocket räknar upp allt bygget kräver. Varje rad med läget `ändras` eller `läses` finns i arbetskatalogens kopia (kontrollerat med Glob och Grep 2026-11-27). Berättelsen skapar en ny fil, provfilen. Ingen migration skapas.

```förkrav
fil: server/src/services/invoiceFromTime.ts ändras
fil: server/src/actions/registry.ts ändras
fil: server/src/http/view/routes.ts ändras
fil: server/test/uppdragsytan-faktureringsunderlag.test.ts ny
fil: docs/MCP_ACTIONS.md ändras
fil: docs/ARKITEKTUR.md ändras
fil: docs/STATUS.md ändras
fil: docs/byggen/prd-uppdragsytan-4-2-overlamningen-registreras-ur-den-faktiska-handlingen.md läses
fil: server/migrations/0068_uppdragsytan.sql läses
fil: server/migrations/0072_leverabelhandelse_kanal_notering.sql läses
fil: server/migrations/0099_overlamningshandling.sql läses
fil: server/src/services/uppdragRegister.ts läses
fil: server/src/services/uppdragStatus.ts läses
fil: server/src/services/uppdragLage.ts läses
fil: server/src/services/contracts.ts läses
fil: server/src/lib/leverabelfalt.ts läses
fil: server/src/lib/lasvarde.ts läses
fil: server/src/lib/kontraktsluckor.ts läses
fil: server/src/lib/errors.ts läses
fil: server/src/http/view/html.ts läses
fil: server/src/http/view/undantagsvyn.ts läses
fil: server/src/actions/execute.ts läses
fil: server/src/db/tx.ts läses
fil: server/src/config.ts läses
fil: server/test/helpers.ts läses
fil: server/test/env.ts läses
fil: server/test/setup.ts läses
fil: server/test/globalSetup.ts läses
fil: server/test/uppdragImportHelper.ts läses
fil: server/test/fixtures/leveranskontrakt-nvr-001.ts läses
fil: server/test/uppdragsytan-overlamning.test.ts läses
fil: server/test/uppdragsytan-statusbyte.test.ts läses
fil: server/test/uppdragsytan-sparrar.test.ts läses
fil: server/test/uppdragsytan-register.test.ts läses
fil: server/test/uppdragsytan-menyn.test.ts läses
fil: server/test/uppdragsytan-utskick.test.ts läses
fil: server/test/utskickHelper.ts läses
fil: server/test/faktura-ur-tid.test.ts läses
fil: server/test/kund-projekt-tid.test.ts läses
fil: server/test/steering-liquidity.test.ts läses
fil: server/test/statusetiketter.test.ts läses
fil: server/test/crm-sandvag.test.ts läses
fil: server/test/sandvagHelper.ts läses
fil: server/test/vy-kansliga-knappar.test.ts läses
fil: server/test/uppdragsytan-avslut.test.ts ändras
fil: server/test/uppdragsytan-godkannandevag.test.ts läses
fil: server/test/uppdragsytan-undantag.test.ts läses
fil: server/test/entity-links.test.ts läses
fil: server/test/uppdragsytan-markering.test.ts läses
fil: server/vitest.config.ts läses
fil: server/tsconfig.test.json läses
fil: server/package.json läses
fil: server/kontrakt/navigation.v1.json läses
fil: docs/project-context.md läses
fil: CLAUDE.md läses
prov: adresskontraktet berörs GRÖN
prov: bakvag berörs GRÖN
prov: handgrepp berörs GRÖN
prov: manniskosparr berörs GRÖN
prov: svepet berörs GRÖN
tjanst: 127.0.0.1:5433 vitest kör proven mot testdatabasen i Postgres 16
```

Berättelsens egna prov är vitest-filer i `server/test` och står som `fil:`-rader: den nya provfilen har läget `ny`, och regressionsfilerna har läget `läses`. Den enda befintliga provfil som ändras är `server/test/uppdragsytan-avslut.test.ts` (uppgift 3.3): ett sidpåstående avgränsas till avslutspanelen, som det alltid avsett, och dess innebörd ändras inte. `prov:`-raderna är Hermes prov. De läser releasen, källan eller driftens databas och körs av Hermes provvakt på dess eget schema, inte av kedjans `npm test` (Dev Notes, ”Kedjan kontrollerar i drift”).

- **Baslinjen.** Provvaktens senaste bokförda körning (tillståndsfilen i Hermes hemkatalog, körningen 2026-11-27 06.30) lästes 2026-11-27 med fältet `lage` per prov. Källtexten i arbetskatalogens kopia av Hermes prov söktes efter berättelsens moduler som hela ord (invoiceFromTime, registry, routes, MCP_ACTIONS, ARKITEKTUR, STATUS, uppdragRegister och provfilens namn). Tre icke-GRÖNA prov träffar: bmadglidning (RÖD), continuityvakt (KUNDE_INTE) och overlamningsregister_fr6 (RÖD). Därtill står modulprov, som kör `npm test -- uppdragsytan` och alltså också den nya provfilen, som KUNDE_INTE. Raderna står ändå inte i blocket, av samma skäl som i Story 2.3–2.8, 3.3, 3.6 och 4.1–4.3: kodbasen är redovisning, så kedjan cto bygger berättelsen, och förkontrollens K4 fäller varje `prov:`-rad som inte är GRÖN i en annan kedja än hermes (underlaget kedjans-formagor, kedjan cto: nytt_prov_ej_gront nej). Berättelsen gör inte proven röda och ska inte göra dem gröna. continuityvakt läser rubrikstyckets antal åtgärder i `docs/STATUS.md` mot registret; uppgift 2 håller talet lika med registrets antal, så att provet inte får ett nytt skäl att bli rött.
- **De GRÖNA raderna** är prov som läser det berättelsen ändrar, alla GRÖNA i samma körning: adresskontraktet jämför vyns rutter i `server/src/http/view/routes.ts` med `server/kontrakt/navigation.v1.json` (berättelsen lägger inte till och tar inte bort någon rutt); bakvag, manniskosparr och svepet läser åtgärderna i `server/src/actions/registry.ts` (den nya åtgärden är `read` utan `kravManniska` och rör ingen av de spärrade åtgärderna); handgrepp läser ensamma kodspann i avsnittet Uppdragsytan i `docs/MCP_ACTIONS.md` (den nya åtgärden dokumenteras utanför det avsnittet, under ”Faktura ur godkänd tid”).
- **Procentforbud och flerbolag** läser bara filer vars namn börjar på uppdrag i tjänste- och vykatalogerna. Berättelsen skapar ingen sådan fil, så proven läser inget den ändrar och står inte i blocket. NFR-11 och tenantregeln prövas i stället av berättelsens egna fall (4.4-R5, 4.4-V2 och 4.4-A3).
- **Inga `kontrakt:`-rader.** Den nya läsåtgärden är ett nytt namn som ingen annan del läser i dag, och förkontrollens K8 fäller kontraktsrader i kedjan cto när kontraktsprovet inte är ett Hermes-prov i basen. Löftena hålls av fallen i den nya provfilen.
- **Inga `beroende:`-rader**, eftersom inget paket tillkommer. **Inga `kommando:`-rader**, eftersom kedjan cto inte ger byggaren förmågan att köra kommandon som grind (kedjans förmågor, kommando nej). **Inga `kraver:`- eller `namner:`-rader**, eftersom bygget bara skriver filer i kopian och ordregelns fyra ord inte förekommer i berättelsen.
- **Ingen `fil:`-rad för Hermes kod.** Kedjan cto prövar en `läses`-rad mot filen i sitt eget repo, där det inte finns någon katalog hermes/. Berättelsen nämner Hermes filer utan kodformat. Hermes kod ändras inte.

## Acceptance Criteria

Lydelsen i varje **Given/When/Then** är ordagrann ur epics.md (Story 4.4). Raden **Mätbart** under ett kriterium är berättelsens tillägg. Den anger mekanismen som gör ett ”inget”, ”aldrig” eller ”ingen” sant genom konstruktion och den ändliga fallista som provet prövar. Kriteriet ändras inte av den. Varje nytt fall bär sitt id (4.4-R, 4.4-S, 4.4-A, 4.4-V eller 4.4-D) först i titeln. Fallens innehåll står i Dev Notes, ”Fallen”.

1. **Given** `invoiceFromTime`
   **When** faktureringsunderlaget för ett uppdrag visas
   **Then** listas leverabler i `godkand` som underlag, med källan registret
   **And** leverabler i `levererad` visas inte som fakturerbara.

   **Mätbart:** en tillåtelselista och en enda läsväg. (1) `FAKTURERBARA_LAGEN` i `server/src/services/invoiceFromTime.ts` är exakt `['godkand']`; bara en registerrad vars 
```

## Utfall
Tester: 213 passed (213) · Granskning: GODKANT | Alla acceptanskriterier är implementerade, förra varvets samtidighetsfynd är åtgärdat och inga nya fynd kvarstår. · Byggforsok: 2

## Modellkedja (Davids krav 17/8, reservvag 7/9)

* krav: kordes inte
* utveckling: **gpt-6.1-sol**
* granskning: **gpt-6-astra**

Granskaren ar inte forfattaren: gpt-6-astra granskade gpt-6.1-sols arbete.

effort (Davids beslut 20/10): create-story high · validering high — planeringssteg
Allt pa Davids abonnemang - inga API-tokens.
