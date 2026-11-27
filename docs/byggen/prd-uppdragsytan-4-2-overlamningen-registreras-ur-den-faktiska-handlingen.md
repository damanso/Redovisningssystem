# PRD-bygget uppdragsytan 4-2-overlamningen-registreras-ur-den-faktiska-handlingen — PRD uppdragsytan 4-2-overlamningen-registreras-ur-den-faktiska-handlingen: # Story 4.2: Överlämninge

Datum: 2026-11-27 07:39 · Branch: cto/prd-uppdragsytan-4-2-overlamningen-registreras-ur-den-faktis-9364 · Kalla: 02-Områden/hermes/uppdragsytan-1c-prd.md (fryst 29/9, Davids beslut #194)

## Mal
PRD uppdragsytan 4-2-overlamningen-registreras-ur-den-faktiska-handlingen: # Story 4.2: Överlämningen registreras ur den faktiska handlingen Status: ready-for-dev <!-- Note: Validation is optiona

## PRD-kravet (ordagrant ur den frysta PRD:n) och astras kodgranskning
```
# Story 4.2: Överlämningen registreras ur den faktiska handlingen

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

<!-- Kodbas: redovisning (kedjan cto). Krav: FR-13 (transmittalen och de tre människospärrarna), FR-9, FR-12 (returen), FR-26, FR-42 (ingen överlämning ger utskick). Beror på: Story 3.1 (done, migration 0093, byggjournalen finns i kopian) och Story 4.1 (done 2026-11-27, byggjournalen finns i kopian). Story key: 4-2-overlamningen-registreras-ur-den-faktiska-handlingen. Skapad av create-story 2026-11-27 i #yolo-läge, mot koden i arbetskatalogens kopia av redovisningen. -->

## Story

As a David,
I want att en överlämning får sitt datum ur själva handlingen, sin revision uppräknad och mottagaren förifylld ur kontraktet,
so that jag inte skriver transmittalen för hand och inte bekräftar rutinbyten.

## Förkrav

Blocket räknar upp allt bygget kräver. Varje rad med läget `ändras` eller `läses` finns i arbetskatalogens kopia (kontrollerat med Glob och ls 2026-11-27). Berättelsen skapar två nya filer: migrationen och provfilen för 4.2-fallen. Migrationens nummer räknas i ingången (uppgift 0.2) och står därför som platshållare; förkontrollens K10 knyter den till filen när en senare berättelse beror på 4.2.

```förkrav
fil: server/migrations/<NNNN>_overlamningshandling.sql ny
fil: server/test/uppdragsytan-overlamning.test.ts ny
fil: server/src/services/uppdragStatus.ts ändras
fil: server/src/services/uppdragRegister.ts ändras
fil: server/src/actions/registry.ts ändras
fil: server/src/http/view/routes.ts ändras
fil: server/test/uppdragsytan-statusbyte.test.ts ändras
fil: server/test/uppdragsytan-leveranserna.test.ts ändras
fil: docs/ARKITEKTUR.md ändras
fil: docs/MCP_ACTIONS.md ändras
fil: docs/STATUS.md ändras
fil: docs/byggen/prd-uppdragsytan-3-1-en-referens-ar-overifierad-tills-svepet-sagt-annat-och-bar-handelsedatum-och-fryst-revision.md läses
fil: docs/byggen/prd-uppdragsytan-4-1-bradan-och-tabellen-visar-samma-falt.md läses
fil: server/migrations/0068_uppdragsytan.sql läses
fil: server/migrations/0072_leverabelhandelse_kanal_notering.sql läses
fil: server/migrations/0081_scopeavgorande.sql läses
fil: server/migrations/0093_referens.sql läses
fil: server/migrations/0097_kontraktsparter.sql läses
fil: server/migrations/0098_registerkopia.sql läses
fil: server/src/services/uppdragReferens.ts läses
fil: server/src/services/uppdragSignal.ts läses
fil: server/src/services/uppdragKontrakt.ts läses
fil: server/src/services/uppdragUndantag.ts läses
fil: server/src/services/uppdragSvep.ts läses
fil: server/src/services/uppdragLage.ts läses
fil: server/src/services/profile.ts läses
fil: server/src/config.ts läses
fil: server/src/http/view/html.ts läses
fil: server/src/lib/referens.ts läses
fil: server/src/lib/leverabelfalt.ts läses
fil: server/src/lib/kontraktsluckor.ts läses
fil: server/src/lib/validation.ts läses
fil: server/src/lib/errors.ts läses
fil: server/src/actions/execute.ts läses
fil: server/src/db/migrate.ts läses
fil: server/src/db/tx.ts läses
fil: server/src/http/app.ts läses
fil: server/src/mcp/server.ts läses
fil: server/test/helpers.ts läses
fil: server/test/env.ts läses
fil: server/test/setup.ts läses
fil: server/test/globalSetup.ts läses
fil: server/test/uppdragImportHelper.ts läses
fil: server/test/fixtures/leveranskontrakt-nvr-001.ts läses
fil: server/test/uppdragsytan-register.test.ts läses
fil: server/test/uppdragsytan-kontraktsluckor.test.ts läses
fil: server/test/uppdragsytan-undantag.test.ts läses
fil: server/test/uppdragsytan-laget.test.ts läses
fil: server/test/uppdragsytan-menyn.test.ts läses
fil: server/test/uppdragsytan-registerkopia.test.ts läses
fil: server/test/uppdragsytan-svep.test.ts läses
fil: server/test/uppdragsytan-agandegrans-cache.test.ts läses
fil: server/test/uppdragsytan-utskick.test.ts läses
fil: server/test/utskickHelper.ts läses
fil: server/vitest.config.ts läses
fil: server/tsconfig.test.json läses
fil: server/package.json läses
fil: server/kontrakt/navigation.v1.json läses
fil: docs/project-context.md läses
fil: CLAUDE.md läses
prov: adresskontraktet berörs GRÖN
prov: modulprov berörs GRÖN
prov: flerbolag berörs GRÖN
prov: handgrepp berörs GRÖN
prov: manniskosparr berörs GRÖN
prov: agandegrans berörs GRÖN
prov: procentforbud berörs GRÖN
tjanst: 127.0.0.1:5433 vitest kör proven mot testdatabasen i Postgres 16
```

Berättelsens egna prov är vitest-filer i `server/test` och står som `fil:`-rader: den nya provfilen har läget `ny`, de två provfiler där befintliga påståenden ändras läget `ändras` och regressionsfilerna läget `läses`. Utskicksprovet (`server/test/uppdragsytan-utskick.test.ts` med `server/test/utskickHelper.ts`) står med eftersom det läser varje fil i `server/src`, alltså också de ändrade filerna. `prov:`-raderna är Hermes prov. De läser releasen, källan eller driftens databas och körs av Hermes provvakt på dess eget schema, inte av kedjans `npm test` (Dev Notes, ”Kedjan kontrollerar i drift”).

- **Baslinjen.** Provvaktens senaste bokförda körning (provvaktens tillståndsfil i Hermes hemkatalog, körningen 2026-11-26 06.30, samma körning som Story 4.1 läste) lästes 2026-11-27 med fältet `lage` per prov. Källtexten i arbetskatalogens kopia av Hermes prov söktes efter berättelsens moduler som hela ord (uppdragStatus, uppdragRegister, registry, routes, MCP_ACTIONS, ARKITEKTUR, STATUS och provfilernas namn). Två icke-GRÖNA prov träffar: bmadglidning (RÖD) på ordet routes och overlamningsregister_fr6 (RÖD) på ordet STATUS, samma två träffar som Story 4.1 redovisade. Raderna står ändå inte i blocket, av samma skäl som i Story 2.3, 2.4, 2.6, 2.8, 3.3, 3.6 och 4.1: kodbasen är redovisning, så kedjan cto bygger berättelsen, och förkontrollens K4 fäller varje `prov:`-rad som inte är GRÖN i en annan kedja än hermes (underlaget kedjans-formagor, kedjan cto: nytt_prov_ej_gront nej). Berättelsen gör inte proven röda och ska inte göra dem gröna. Övriga träffar (bakvag, continuityvakt, cto_fr20, cto_fr57, crmintag, designsvep, hushallet_fr36, ovrigtforslag, r5_soktjansten_fr6, redovisning_fortroende_prov, registreringsurval, rollpassen_fr41, rollpassen_fr43, scope_grind, svepet) är GRÖNA och läser ingenting som berättelsen ändrar på ett sätt som rör dem; de står inte i blocket.
- **De GRÖNA raderna** är prov som läser det berättelsen ändrar, alla GRÖNA i samma körning: adresskontraktet jämför vyns rutter i `server/src/http/view/routes.ts` med `server/kontrakt/navigation.v1.json` åt båda hållen (K2), och berättelsen håller ruttmängden oförändrad (beslut B14, fallet 4.2-U3), eftersom kontraktet bara synkas genom generatorn i Davids valv, som kedjan cto inte når; modulprov kör `npm test -- uppdragsytan`, alltså också den nya provfilen; flerbolag kräver `company_id` i varje mallsträng mot en `uppdrag_`-tabell i tjänstfilerna (de nya frågorna i `server/src/services/uppdragStatus.ts` och underfrågan i `server/src/services/uppdragRegister.ts`); handgrepp läser registret och ensamma kodspann i avsnittet Uppdragsytan i `docs/MCP_ACTIONS.md`; manniskosparr kräver att `bekrafta_statusbyte` fortfarande bär `kravManniska`; agandegrans läser kategorin i tabellkommentarerna (migrationen lägger en kolumn och ändrar ingen tabellkommentar); procentforbud läser kolumnnamnen i `uppdrag_*` (den nya kolumnen `referens_id`) och vy- och tjänstfilerna.
- **Inga `kontrakt:`-rader.** Berättelsen kräver inget kontrakt: den ändrar inget namn som en annan del läser (vyns rutter står kvar exakt som navigationskontraktet räknar upp dem), och förkontrollens K8 fäller kontraktsrader i kedjan cto när kontraktsprovet inte är ett Hermes-prov i basen. Löftena hålls av fallen i den nya provfilen.
- **Inga `beroende:`-rader**, eftersom inget paket tillkommer (K5 läser rotmanifestet). **Inga `kommando:`-rader**, eftersom kedjan cto inte ger byggaren förmågan att köra kommandon som grind (kedjans förmågor, kommando nej). **Inga `kraver:`- eller `namner:`-rader**, eftersom by
```

## Utfall
Tester: 212 passed (212) · Granskning: GODKANT | Alla nio acceptanskriterier är implementerade; inga belagda kvarstående fel hittades och kedjans typkontroll och hela testsvit är gröna. · Byggforsok: 3

## Modellkedja (Davids krav 17/8, reservvag 7/9)

* krav: kordes inte
* utveckling: **gpt-6.1-sol**
* granskning: **gpt-6-astra**

Granskaren ar inte forfattaren: gpt-6-astra granskade gpt-6.1-sols arbete.

effort (Davids beslut 20/10): create-story high · validering high — planeringssteg
Allt pa Davids abonnemang - inga API-tokens.
