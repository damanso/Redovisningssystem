# PRD-bygget uppdragsytan 3-6-kopians-kopost-bar-sin-frysta-version-och-kvitteras-bara-for-den — PRD uppdragsytan 3-6-kopians-kopost-bar-sin-frysta-version-och-kvitteras-bara-for-den: # Story 3.6: 

Datum: 2026-11-27 03:43 · Branch: cto/prd-uppdragsytan-3-6-kopians-kopost-bar-sin-frysta-version-o-9362 · Kalla: 02-Områden/hermes/uppdragsytan-1c-prd.md (fryst 29/9, Davids beslut #194)

## Mal
PRD uppdragsytan 3-6-kopians-kopost-bar-sin-frysta-version-och-kvitteras-bara-for-den: # Story 3.6: Kopians köpost bär sin frysta version och kvitteras bara för den Status: ready-for-dev <!-- Note: Validatio

## PRD-kravet (ordagrant ur den frysta PRD:n) och astras kodgranskning
```
# Story 3.6: Kopians köpost bär sin frysta version och kvitteras bara för den

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

<!-- Kodbas: redovisning (kedjan cto). Krav: FR-11 (arbetslistan bär versionens frysta underlag, återförsök utan dubbletter), NFR-3, NFR-5, NFR-12 — epics.md, Story 3.6. Beror på: Story 3.3 (done 2026-11-27, migration 0098 och byggjournalen i kopian). Story key: 3-6-kopians-kopost-bar-sin-frysta-version-och-kvitteras-bara-for-den. Skapad av create-story 2026-11-27 i #yolo-läge. Berättelsen delades ur Story 3.3 genom correct-course 2026-11-27 efter bygge #9359; underlaget är avsnittet ”Underlag för Story 3.6” i sprint-change-proposal-3-3 (planeringsartefakterna), prövat här mot koden som 3.3 lämnade efter sitt omtag (F1–F7). Arkitekturens beslut B-10 och B-11 (architecture.md rad 566–606) gäller ordagrant. -->

## Story

As a David,
I want att varje återförsök av registerkopian använder just den versionens lagrade innehåll och att en kvittens bara gäller den version den avser,
so that jag aldrig ser en förväxlad eller ofärdig kopia som färdig och aldrig behöver bevaka kön.

## Förkrav

Blocket räknar upp allt bygget kräver. Varje rad med läget `ändras` eller `läses` finns i arbetskatalogens kopia (kontrollerat med Glob 2026-11-27). Berättelsen skapar ingen ny fil och ingen migration: alla nya fall läggs i 3.3:s provfil, som epics.md föreskriver (”Fallen läggs i 3.3:s provfil … med samma rigg”). Raden för `server/migrations/0098_registerkopia.sql` och byggjournalen för Story 3.3 är ingångens belägg för att beroendet är mergat (uppgift 0.1). Förkontrollens K10 knyter 3.3:s platshållare `<NNNN>_registerkopia.sql` till 0098, eftersom platshållaren står först i namnet.

```förkrav
fil: server/src/services/uppdragReferens.ts ändras
fil: server/src/services/uppdragSvep.ts ändras
fil: server/test/uppdragsytan-registerkopia.test.ts ändras
fil: server/test/uppdragsytan-drive-ko.test.ts ändras
fil: docs/MCP_ACTIONS.md ändras
fil: docs/STATUS.md ändras
fil: docs/byggen/prd-uppdragsytan-3-3-registerkopian-ar-versionsbunden-har-fryst-underlag-och-syns-aldrig-som-kostatus-for-david.md läses
fil: server/migrations/0098_registerkopia.sql läses
fil: server/migrations/0068_uppdragsytan.sql läses
fil: server/migrations/0071_registerkopiako.sql läses
fil: server/src/services/uppdragRegister.ts läses
fil: server/src/services/uppdragStatus.ts läses
fil: server/src/services/uppdragImport.ts läses
fil: server/src/actions/registry.ts läses
fil: server/src/lib/errors.ts läses
fil: server/src/lib/validation.ts läses
fil: server/src/db/tx.ts läses
fil: server/src/http/view/routes.ts läses
fil: server/src/http/view/auth.ts läses
fil: server/src/http/view/html.ts läses
fil: server/src/http/view/kontrakt.ts läses
fil: server/src/http/view/undantagsvyn.ts läses
fil: server/src/http/view/uppdragUppfoljning.ts läses
fil: server/test/helpers.ts läses
fil: server/test/env.ts läses
fil: server/test/setup.ts läses
fil: server/test/globalSetup.ts läses
fil: server/test/uppdragImportHelper.ts läses
fil: server/test/fixtures/leveranskontrakt-nvr-001.ts läses
fil: server/test/uppdragsytan-svep.test.ts läses
fil: server/test/uppdragsytan-referens.test.ts läses
fil: server/test/uppdragsytan-statusbyte.test.ts läses
fil: server/test/uppdragsytan-ovrigt.test.ts läses
fil: server/test/uppdragsytan-utskick.test.ts läses
fil: server/test/uppdragsytan-kontraktsyta.test.ts läses
fil: server/test/uppdragsytan-import.test.ts läses
fil: server/test/uppdragsytan-undantag.test.ts läses
fil: server/test/uppdragsytan-beslut.test.ts läses
fil: server/test/crm-sandvag.test.ts läses
fil: server/test/crm-read-scope.test.ts läses
fil: server/vitest.config.ts läses
fil: server/tsconfig.test.json läses
fil: server/package.json läses
fil: docs/ARKITEKTUR.md läses
fil: docs/DRIFT_VPS.md läses
fil: docs/project-context.md läses
fil: CLAUDE.md läses
prov: svepfarskhet berörs GRÖN
prov: svepet berörs GRÖN
prov: ovrigtforslag berörs GRÖN
prov: handgrepp berörs GRÖN
prov: flerbolag berörs GRÖN
prov: procentforbud berörs GRÖN
prov: kontrollytan berörs GRÖN
prov: modulprov berörs GRÖN
tjanst: 127.0.0.1:5433 vitest kör proven mot testdatabasen i Postgres 16
kontrakt: uppdragsytan fil server/src/services/uppdragSvep.ts prov svepet
kontrakt: uppdragsytan fil server/src/services/uppdragSvep.ts prov ovrigtforslag
kontrakt: uppdragsytan fil server/src/services/uppdragReferens.ts prov flerbolag
kontrakt: uppdragsytan fil docs/MCP_ACTIONS.md prov handgrepp
```

Berättelsens egna prov är vitest-filer i `server/test` och står som `fil:`-rader: 3.3:s provfil, där de nya fallen läggs, och drive-ko-provet, vars kommentar i KRAV-3 blir osann, med läget `ändras`; regressionsfilerna med läget `läses`. H9 läser varje TypeScript-fil under `server/src/http/view`, så alla sex vyfiler står som `läses` (Glob 2026-11-27: `auth.ts`, `html.ts`, `kontrakt.ts`, `routes.ts`, `undantagsvyn.ts` och `uppdragUppfoljning.ts`). `prov:`-raderna är Hermes prov. De läser releasen eller driftens databas och körs av Hermes provvakt på dess eget schema, inte av kedjans `npm test` (Dev Notes, ”Kedjan kontrollerar i drift”).

- **Baslinjen.** Provvaktens senaste bokförda körning (provvaktens tillståndsfil i Hermes hemkatalog, körningen 2026-11-26 06.30) lästes 2026-11-27 med fältet `lage` per prov. Sexton prov stod inte GRÖNA: atagandet_haller, beslutsagare_felvagar, beslutsslutet, bmadglidning, chattvag_fr1 (KUNDE_INTE), insatskon, kartan, maskinlardomar, overlamningsregister_fr6, projektenheter, projektstyrning, rollpassen_fr20_yta, kontexten_kvitton_nfr1, modellstarter_fr8, indexvagar_fr7 och karna_leverans (alla RÖD utom chattvag_fr1). Källtexten i arbetskatalogens kopia av Hermes prov söktes efter berättelsens moduler som hela ord (uppdragReferens, uppdragSvep, MCP_ACTIONS, STATUS, registerkopia och provfilernas namn). Bara overlamningsregister_fr6 (RÖD) träffar, på ordet STATUS i en sökväg i en egen fixtur (rad 386). Raden står ändå inte i blocket, av samma skäl som i Story 2.3, 2.4, 2.6, 2.8 och 3.3: kodbasen är redovisning, så kedjan cto bygger berättelsen, och förkontrollens K4 fäller varje `prov:`-rad som inte är GRÖN när kedjan saknar förmågan nytt_prov_ej_gront (underlaget kedjans-formagor, kedjan cto). Berättelsen gör inte provet rött och ska inte göra det grönt. De femton andra icke-GRÖNA proven nämner ingen modul som berättelsen ändrar.
- **De GRÖNA raderna** är prov som läser det berättelsen ändrar, alla GRÖNA i samma körning: svepfarskhet läser köposterna i koad och fel i driftens databas (svepets frysning gör en gammal köpost `ersatt` och skapar en ny med version); svepet och ovrigtforslag läser `server/src/services/uppdragSvep.ts` (ingen schemaläggare, oförändrade nycklar); handgrepp läser ensamma kodspann i avsnittet Uppdragsytan i `docs/MCP_ACTIONS.md`; flerbolag kräver `company_id` i varje mallsträng mot en `uppdrag_`-tabell i tjänstfilerna; procentforbud läser tjänstfilerna; kontrollytan prövar att en registerkopia aldrig blir en post i undantagsvyn; modulprov kör `npm test -- uppdragsytan`, alltså också de nya fallen. agandegrans står inte med: berättelsen skapar ingen tabell och ändrar ingen kategori.
- **Kontrakten** är filkontrakt, samma fyra som i Story 3.3. Alla fyra proven är GRÖNA.
- **Inga `beroende:`-rader**, eftersom inget paket tillkommer. **Inga `kommando:`-rader**, eftersom kedjan cto inte ger byggaren förmågan att köra kommandon som grind (kedjans förmågor, kommando nej). **Inga `kraver:`- eller `namner:`-rader**, eftersom bygget bara skriver filer i kopian och ordregelns fyra ord inte förekommer i berättelsen utanför undantagna avsnitt.
- **Ingen `fil:`-rad för Hermes kod.** Kedjan cto prövar en `läses`-rad mot filen i sitt eget repo, där det inte finns någon katalog hermes/ (Story 3.3, correct-course 2026-11-26). Berättelsen nämner Hermes filer utan kodformat. Hermes svep (uppdragssvep.py i Hermes skills) ändras inte här; de
```

## Utfall
Tester: 211 passed (211) · Granskning: GODKANT | Alla acceptanskriterier och kryssade implementationsuppgifter är uppfyllda; inga konkreta fynd, och kedjans typkontroll och testsvit är gröna. · Byggforsok: 1

## Modellkedja (Davids krav 17/8, reservvag 7/9)

* krav: kordes inte
* utveckling: **gpt-6.1-sol**
* granskning: **gpt-6-astra**

Granskaren ar inte forfattaren: gpt-6-astra granskade gpt-6.1-sols arbete.

effort (Davids beslut 20/10): create-story high · validering high — planeringssteg
Allt pa Davids abonnemang - inga API-tokens.
