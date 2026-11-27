# PRD-bygget uppdragsytan 4-1-bradan-och-tabellen-visar-samma-falt — PRD uppdragsytan 4-1-bradan-och-tabellen-visar-samma-falt: # Story 4.1: Brädan och tabellen visar sa

Datum: 2026-11-27 04:44 · Branch: cto/prd-uppdragsytan-4-1-bradan-och-tabellen-visar-samma-falt-9363 · Kalla: 02-Områden/hermes/uppdragsytan-1c-prd.md (fryst 29/9, Davids beslut #194)

## Mal
PRD uppdragsytan 4-1-bradan-och-tabellen-visar-samma-falt: # Story 4.1: Brädan och tabellen visar samma fält Status: ready-for-dev <!-- Note: Validation is optional. Run validate-

## PRD-kravet (ordagrant ur den frysta PRD:n) och astras kodgranskning
```
# Story 4.1: Brädan och tabellen visar samma fält

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

<!-- Kodbas: redovisning (kedjan cto). Krav: FR-39, FR-27 (saknat som saknat), NFR-2. Regression: FR-37 (åldern ur statushistoriken). Beror på: Story 2.4 (done 2026-11-26, migration 0097, byggjournalen finns i kopian). Story key: 4-1-bradan-och-tabellen-visar-samma-falt. Skapad av create-story 2026-11-27 i #yolo-läge, mot koden i arbetskatalogens kopia av redovisningen. Första berättelsen i Epic 4. -->

## Story

As a David,
I want att brädan och tabellen visar samma uppgifter om varje leverabel,
so that jag ser vad som återstår och vad som lämnats över utan att byta vy för att få hela bilden.

## Förkrav

Blocket räknar upp allt bygget kräver. Varje rad med läget `ändras` eller `läses` finns i arbetskatalogens kopia (kontrollerat med Glob och ls 2026-11-27). Berättelsen skapar en ny fil, den rena modulen för fältlistan, och ingen migration. Raden för byggjournalen för Story 2.4 är ingångens belägg för att beroendet är mergat (uppgift 0.1).

```förkrav
fil: server/src/services/uppdragRegister.ts ändras
fil: server/src/lib/leverabelfalt.ts ny
fil: server/src/http/view/routes.ts ändras
fil: server/test/uppdragsytan-register.test.ts ändras
fil: server/test/uppdragsytan-leveranserna.test.ts ändras
fil: server/test/uppdragsytan-kontraktsluckor.test.ts ändras
fil: docs/MCP_ACTIONS.md ändras
fil: docs/STATUS.md ändras
fil: docs/byggen/prd-uppdragsytan-2-4-saknade-kontraktsfalt-mottagarpart-och-godkannare-visas-arligt.md läses
fil: server/migrations/0068_uppdragsytan.sql läses
fil: server/migrations/0072_leverabelhandelse_kanal_notering.sql läses
fil: server/migrations/0097_kontraktsparter.sql läses
fil: server/src/lib/kontraktsluckor.ts läses
fil: server/src/services/uppdragStatus.ts läses
fil: server/src/services/uppdragReferens.ts läses
fil: server/src/services/uppdragKontrakt.ts läses
fil: server/src/services/uppdragLage.ts läses
fil: server/src/services/uppdragSvep.ts läses
fil: server/src/actions/registry.ts läses
fil: server/src/mcp/server.ts läses
fil: server/src/http/view/html.ts läses
fil: server/src/http/app.ts läses
fil: server/src/db/tx.ts läses
fil: server/test/helpers.ts läses
fil: server/test/env.ts läses
fil: server/test/setup.ts läses
fil: server/test/globalSetup.ts läses
fil: server/test/uppdragImportHelper.ts läses
fil: server/test/fixtures/leveranskontrakt-nvr-001.ts läses
fil: server/test/uppdragsytan-menyn.test.ts läses
fil: server/test/uppdragsytan-registerkopia.test.ts läses
fil: server/test/uppdragsytan-drive-ko.test.ts läses
fil: server/test/uppdragsytan-import.test.ts läses
fil: server/test/uppdragsytan-statusbyte.test.ts läses
fil: server/test/uppdragsytan-utskick.test.ts läses
fil: server/test/utskickHelper.ts läses
fil: server/vitest.config.ts läses
fil: server/tsconfig.test.json läses
fil: server/package.json läses
fil: docs/ARKITEKTUR.md läses
fil: docs/project-context.md läses
fil: CLAUDE.md läses
prov: modulprov berörs GRÖN
prov: flerbolag berörs GRÖN
prov: handgrepp berörs GRÖN
prov: designparitet berörs GRÖN
prov: procentforbud berörs GRÖN
tjanst: 127.0.0.1:5433 vitest kör proven mot testdatabasen i Postgres 16
kontrakt: uppdragsytan fil server/src/services/uppdragRegister.ts prov flerbolag
kontrakt: uppdragsytan fil docs/MCP_ACTIONS.md prov handgrepp
```

Berättelsens egna prov är vitest-filer i `server/test` och står som `fil:`-rader: de tre provfiler som får nya fall eller ändrade påståenden har läget `ändras`, regressionsfilerna läget `läses`. Utskicksprovet (`server/test/uppdragsytan-utskick.test.ts` med `server/test/utskickHelper.ts`) står med eftersom det läser varje fil i `server/src`, alltså också den nya lib-modulen. `prov:`-raderna är Hermes prov. De läser releasen, källan eller driftens databas och körs av Hermes provvakt på dess eget schema, inte av kedjans `npm test` (Dev Notes, ”Kedjan kontrollerar i drift”).

- **Baslinjen.** Provvaktens senaste bokförda körning (provvaktens tillståndsfil i Hermes hemkatalog, körningen 2026-11-26 06.30) lästes 2026-11-27 med fältet `lage` per prov. Sjutton prov stod inte GRÖNA: atagandet_haller, beslutsagare_felvagar, beslutseftersläpning, beslutsslutet, bmadglidning, chattvag_fr1 (KUNDE_INTE), insatskon, kartan, maskinlardomar, overlamningsregister_fr6, projektenheter, projektstyrning, rollpassen_fr20_yta, kontexten_kvitton_nfr1, modellstarter_fr8, indexvagar_fr7 och karna_leverans (alla RÖD utom chattvag_fr1). Källtexten i arbetskatalogens kopia av Hermes prov söktes efter berättelsens moduler som hela ord (uppdragRegister, leverabelfalt, routes, MCP_ACTIONS, STATUS, kontraktsluckor och provfilernas namn). Två av de icke-GRÖNA träffar: bmadglidning (RÖD) på ordet routes i en docstring (rad 56) och overlamningsregister_fr6 (RÖD) på ordet STATUS i en sökväg i en egen fixtur (rad 386). Raderna står ändå inte i blocket, av samma skäl som i Story 2.3, 2.4, 2.6, 2.8, 3.3 och 3.6: kodbasen är redovisning, så kedjan cto bygger berättelsen, och förkontrollens K4 fäller varje `prov:`-rad som inte är GRÖN när kedjan saknar förmågan nytt_prov_ej_gront (underlaget kedjans-formagor, kedjan cto). Berättelsen gör inte proven röda och ska inte göra dem gröna. De femton andra icke-GRÖNA proven nämner ingen modul som berättelsen ändrar.
- **De GRÖNA raderna** är prov som läser det berättelsen ändrar, alla GRÖNA i samma körning: modulprov kör `npm test -- uppdragsytan`, alltså också de nya fallen; flerbolag kräver `company_id` i varje mallsträng mot en `uppdrag_`-tabell i tjänstfilerna (den ändrade frågan i registret); handgrepp läser ensamma kodspann i avsnittet Uppdragsytan i `docs/MCP_ACTIONS.md`; designparitet mäter modulgrammatikens klasser `.brada`, `.brada__kol` och `.leverabelkort` i kanons stilmall; procentforbud läser tjänstfilerna `uppdrag*` och vyfilerna. agandegrans står inte med: berättelsen skapar ingen tabell och ändrar ingen kategori.
- **Kontrakten** är filkontrakt på de två filer vars grannprov är GRÖNA: registrets tjänst (flerbolag) och MCP-dokumentet (handgrepp).
- **Inga `beroende:`-rader**, eftersom inget paket tillkommer (K5 läser rotmanifestet). **Inga `kommando:`-rader**, eftersom kedjan cto inte ger byggaren förmågan att köra kommandon som grind (kedjans förmågor, kommando nej). **Inga `kraver:`- eller `namner:`-rader**, eftersom bygget bara skriver filer i kopian och ordregelns fyra ord inte förekommer i berättelsen.
- **Ingen `fil:`-rad för Hermes kod.** Kedjan cto prövar en `läses`-rad mot filen i sitt eget repo, där det inte finns någon katalog hermes/. Berättelsen nämner Hermes filer utan kodformat. Hermes kod ändras inte.

## Acceptance Criteria

Lydelsen i varje **Given/When/Then** är ordagrann ur epics.md (Story 4.1). Raden **Mätbart** under ett kriterium är berättelsens tillägg. Den anger mekanismen som gör ett ”samma”, ”varje”, ”aldrig” eller ”fullständigt” sant genom konstruktion och den ändliga fallista som provet prövar. Kriteriet ändras inte av den. Varje nytt fall bär sitt id (4.1-R, 4.1-F, 4.1-B eller 4.1-D) först i titeln. Fallens innehåll står i Dev Notes, ”Fallen”.

1. **Given** `lasLeverabelregister`
   **When** registret läses
   **Then** matar samma läsfunktion både brädan och tabellen, och vyn och MCP läser samma funktion.

   **Mätbart:** en enda väg in. Vyns enda läsning av registret är `leveransunderlag` i `server/src/http/view/routes.ts`, som anropar `lasLeverabelregister` en gång per avtal och lämnar samma `Leverabelrad[]` till båda lägena; lägena gör ingen egen fråga och räknar ingenting. Åtgärden `las_leverabelregister` i `server/src/actions/registry.ts` anropar samma funktion. MCP-servern (`server/src/mcp/server.ts`) bygger sina verktyg ur åtgärdsmanifestet och anropar åtgärden över REST, så MCP läser samma funktion genom åtgärden. Fallen: 4.1-R4 (tjänsten, REST med människans token och REST med agentens token ger samma rader, och manifestet listar åtgärden) 
```

## Utfall
Tester: 211 passed (211) · Granskning: GODKANT | Alla sju acceptanskriterier är implementerade, de kryssade uppgifterna har kodbelägg och inga konkreta fynd återstår; kedjans typkontroll och 211 tester är gröna. · Byggforsok: 1

## Modellkedja (Davids krav 17/8, reservvag 7/9)

* krav: kordes inte
* utveckling: **gpt-6.1-sol**
* granskning: **gpt-6-astra**

Granskaren ar inte forfattaren: gpt-6-astra granskade gpt-6.1-sols arbete.

effort (Davids beslut 20/10): create-story high · validering high — planeringssteg
Allt pa Davids abonnemang - inga API-tokens.
