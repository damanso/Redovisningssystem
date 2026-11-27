# PRD-bygget uppdragsytan 3-3-registerkopian-ar-versionsbunden-har-fryst-underlag-och-syns-aldrig-som-kostatus-for-david — PRD uppdragsytan 3-3-registerkopian-ar-versionsbunden-har-fryst-underlag-och-syns-aldrig-som-kostatu

Datum: 2026-11-27 02:44 · Branch: cto/prd-uppdragsytan-3-3-registerkopian-ar-versionsbunden-har-fr-9361 · Kalla: 02-Områden/hermes/uppdragsytan-1c-prd.md (fryst 29/9, Davids beslut #194)

## Mal
PRD uppdragsytan 3-3-registerkopian-ar-versionsbunden-har-fryst-underlag-och-syns-aldrig-som-kostatus-for-david: # Story 3.3: Registerkopian är versionsbunden, har fryst underlag och syns aldrig som köstatus för David Status: ready-f

## PRD-kravet (ordagrant ur den frysta PRD:n) och astras kodgranskning
```
# Story 3.3: Registerkopian är versionsbunden, har fryst underlag och syns aldrig som köstatus för David

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

<!-- Kodbas: redovisning (kedjan cto). Krav: FR-11 (kopian bunden till registerversionen; arbetslistan och den versionsbundna kvittensen bärs av Story 3.6), FR-18 (inga tekniska köposter), NFR-3, NFR-5, NFR-12 (kopieunderlaget är fryst historik) — epics.md, Story 3.3. Beror på: Story 3.1 (done 2026-11-21, migration 0093 i kopian). Story key: 3-3-registerkopian-ar-versionsbunden-har-fryst-underlag-och-syns-aldrig-som-kostatus-for-david. Skapad av create-story 2026-11-26 i #yolo-läge. Arkitekturens beslut B-10 och B-11 (architecture.md rad 566–605) gäller ordagrant; berättelsen säger hur de byggs i dagens kod. Correct-course 2026-11-26 efter förkontrollen (K3, K10): förkravsraden för Hermes ägandeprov borttagen. Correct-course 2026-11-27 efter bygge #9359: berättelsen delad längs kriterierna; kriterierna om arbetslistan, kvittensen, omstarten och hamta_drive_ko bärs av Story 3.6 (Dev Notes, ”Correct-course 2026-11-27”). Correct-course 2026-11-27, andra varvet, efter granskningen av bygget 00.39: kriterium 1, 2 och 5 avgränsade till det bygget kan visa (driftprovet, avslutet, arbetslistan och filen i spärrmappen bärs av drift, Story 8.1, 3.6 och 3.4), och Drive-id:t skrivs under avtalslås (L4, L5; Dev Notes, ”Correct-course 2026-11-27, andra varvet”). -->

## Story

As a David,
I want att varje registerändring går igenom direkt och att kopian till Drive följer just den versionen, med samma innehåll hur många gånger den än tas om,
so that jag aldrig bevakar en kö och aldrig ser en ofärdig eller förväxlad kopia som färdig.

## Förkrav

Blocket räknar upp allt bygget kräver. Varje rad med läget `ändras` eller `läses` finns i arbetskatalogens kopia (kontrollerat med Glob och ls 2026-11-26 och 2026-11-27), och de två raderna med läget `ny` saknas där. Migrationen bär inget fast nummer: `<NNNN>` är det högsta numret i `server/migrations/` plus ett när bygget börjar (uppgift 0.2; architecture.md, ”Rester i kedjans kopia och migrationens nummer”, punkt 3). Uppmätt 2026-11-26 var det högsta 0097, och parallelliseringsanalysens reservation 0091 är redan tagen av en CRM-migration (regel 5 i analysen). Raden för `server/migrations/0097_kontraktsparter.sql` är ingångens belägg för att kopian är färsk ur main, och byggjournalen för Story 3.1 är belägget för att beroendet är mergat (uppgift 0.1).

```förkrav
fil: server/migrations/<NNNN>_registerkopia.sql ny
fil: server/test/uppdragsytan-registerkopia.test.ts ny
fil: server/src/services/uppdragRegister.ts ändras
fil: server/src/services/uppdragReferens.ts ändras
fil: server/src/services/uppdragSvep.ts ändras
fil: server/src/http/view/routes.ts ändras
fil: server/test/uppdragsytan-drive-ko.test.ts ändras
fil: docs/MCP_ACTIONS.md ändras
fil: docs/STATUS.md ändras
fil: docs/ARKITEKTUR.md ändras
fil: docs/byggen/prd-uppdragsytan-3-1-en-referens-ar-overifierad-tills-svepet-sagt-annat-och-bar-handelsedatum-och-fryst-revision.md läses
fil: server/test/uppdragsytan-statusbyte.test.ts läses
fil: server/test/crm-read-scope.test.ts läses
fil: server/src/services/crmRelations.ts läses
fil: server/migrations/0068_uppdragsytan.sql läses
fil: server/migrations/0071_registerkopiako.sql läses
fil: server/migrations/0082_bedomningsbegaran.sql läses
fil: server/migrations/0093_referens.sql läses
fil: server/migrations/0097_kontraktsparter.sql läses
fil: server/src/services/uppdragStatus.ts läses
fil: server/src/services/uppdragImport.ts läses
fil: server/src/services/uppdragKontrakt.ts läses
fil: server/src/services/uppdragLage.ts läses
fil: server/src/services/uppdragBedomning.ts läses
fil: server/src/services/uppdragAvslut.ts läses
fil: server/src/services/uppdragSignal.ts läses
fil: server/src/services/uppdragOvrigt.ts läses
fil: server/src/actions/registry.ts läses
fil: server/src/lib/referens.ts läses
fil: server/src/lib/validation.ts läses
fil: server/src/lib/errors.ts läses
fil: server/src/lib/baselinekolumner.ts läses
fil: server/src/db/tx.ts läses
fil: server/src/db/migrate.ts läses
fil: server/src/http/view/html.ts läses
fil: server/src/http/view/undantagsvyn.ts läses
fil: server/test/helpers.ts läses
fil: server/test/env.ts läses
fil: server/test/setup.ts läses
fil: server/test/globalSetup.ts läses
fil: server/test/uppdragImportHelper.ts läses
fil: server/test/undantagsvynRigg.ts läses
fil: server/test/fixtures/leveranskontrakt-nvr-001.ts läses
fil: server/test/uppdragsytan-svep.test.ts läses
fil: server/test/uppdragsytan-referens.test.ts läses
fil: server/test/uppdragsytan-kontraktsyta.test.ts läses
fil: server/test/uppdragsytan-agandegrans-cache.test.ts läses
fil: server/test/uppdragsytan-migration-0093.test.ts läses
fil: server/test/uppdragsytan-schema.test.ts läses
fil: server/test/rls-katalog.test.ts läses
fil: server/test/uppdragsytan-undantag.test.ts läses
fil: server/test/uppdragsytan-beslut.test.ts läses
fil: server/test/uppdragsytan-register.test.ts läses
fil: server/test/uppdragsytan-undantagsvyn.test.ts läses
fil: server/test/uppdragsytan-laget.test.ts läses
fil: server/test/uppdragsytan-import.test.ts läses
fil: server/test/uppdragsytan-utskick.test.ts läses
fil: server/test/uppdragsytan-matt-rytm.test.ts läses
fil: server/test/uppdragsytan-scopelinje.test.ts läses
fil: server/test/uppdragsytan-ovrigt.test.ts läses
fil: server/test/crm-sandvag.test.ts läses
fil: server/vitest.config.ts läses
fil: server/tsconfig.test.json läses
fil: server/package.json läses
fil: docs/DRIFT_VPS.md läses
fil: docs/project-context.md läses
fil: CLAUDE.md läses
prov: svepfarskhet berörs GRÖN
prov: svepet berörs GRÖN
prov: ovrigtforslag berörs GRÖN
prov: handgrepp berörs GRÖN
prov: flerbolag berörs GRÖN
prov: procentforbud berörs GRÖN
prov: agandegrans berörs GRÖN
prov: kontrollytan berörs GRÖN
prov: modulprov berörs GRÖN
tjanst: 127.0.0.1:5433 vitest kör proven mot testdatabasen i Postgres 16
kontrakt: uppdragsytan fil server/src/services/uppdragSvep.ts prov svepet
kontrakt: uppdragsytan fil server/src/services/uppdragSvep.ts prov ovrigtforslag
kontrakt: uppdragsytan fil server/src/services/uppdragReferens.ts prov flerbolag
kontrakt: uppdragsytan fil docs/MCP_ACTIONS.md prov handgrepp
```

Berättelsens egna prov är vitest-filer i `server/test` och står som `fil:`-rader: den nya provfilen med läget `ny`, den befintliga provfil vars påståenden kriterierna vänder med läget `ändras` (`server/test/uppdragsytan-drive-ko.test.ts`; Dev Notes, ”Befintliga prov som kriterierna vänder”), och regressionsfilerna med läget `läses`. Till regressionsfilerna hör statusbyte-provet, vars kopiefall står kvar oförändrade, och migrationsintervallets prov D2 i `server/test/crm-read-scope.test.ts`, som läser intervallet i `docs/ARKITEKTUR.md` (uppgift 6.3). `prov:`-raderna är Hermes prov. De läser releasen eller driftens databas och körs av Hermes provvakt på dess eget schema, inte av kedjans `npm test` (Dev Notes, ”Kedjan kontrollerar i drift”).

- **Baslinjen.** Provvaktens senaste bokförda körning (provvaktens state-fil i Hermes hemkatalog, körningen 2026-11-26 06.30) lästes med fältet `lage` per prov. Sjutton prov stod inte GRÖNA. Sökningen gällde källtexten i arbetskatalogens kopia av Hermes prov och de moduler som berättelsen ändrar eller skapar (uppdragRegister, uppdragReferens, uppdragSvep, routes, registerkopia, uppdrag_registerkopia, MCP_ACTIONS, STATUS och provfilernas namn) som helt ord. Två av de sjutton nämner en sådan modul: bmadglidning, RÖD (ordet routes), och overlamningsregister_fr6, RÖD (ordet STATUS, en sökväg i en egen fixtur). Raderna står ändå inte i blocket, av samma skäl som i Story 2.3, 2.4, 2.6 och 2.8: kodbasen är redovisning, så kedjan cto bygger berättelsen, och förkontrollens K4 fäller varje `prov:`-rad som inte är GRÖN med ”provet kräver nytt_prov_ej_gront” när kedjan inte är hermes. Kedjornas f
```

## Utfall
Tester: 211 passed (211) · Granskning: GODKANT | Alla fem acceptanskriterier är implementerade inom berättelsens avgränsning, tidigare fynd är åtgärdade och kedjans typkontroll och testsvit är gröna. · Byggforsok: 2

## Modellkedja (Davids krav 17/8, reservvag 7/9)

* krav: kordes inte
* utveckling: **gpt-6.1-sol**
* granskning: **gpt-6-astra**

Granskaren ar inte forfattaren: gpt-6-astra granskade gpt-6.1-sols arbete.

effort (Davids beslut 20/10): validering high — planeringssteg
Allt pa Davids abonnemang - inga API-tokens.
