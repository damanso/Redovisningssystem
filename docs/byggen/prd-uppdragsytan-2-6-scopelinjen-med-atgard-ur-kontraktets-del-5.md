# PRD-bygget uppdragsytan 2-6-scopelinjen-med-atgard-ur-kontraktets-del-5 — PRD uppdragsytan 2-6-scopelinjen-med-atgard-ur-kontraktets-del-5: # Story 2.6: Scopelinjen med åtgär

Datum: 2026-11-21 13:31 · Branch: cto/prd-uppdragsytan-2-6-scopelinjen-med-atgard-ur-kontraktets-d-9316 · Kalla: 02-Områden/hermes/uppdragsytan-1c-prd.md (fryst 29/9, Davids beslut #194)

## Mal
PRD uppdragsytan 2-6-scopelinjen-med-atgard-ur-kontraktets-del-5: # Story 2.6: Scopelinjen med åtgärd ur kontraktets del 5 Status: ready-for-dev <!-- Note: Validation is optional. Run va

## PRD-kravet (ordagrant ur den frysta PRD:n) och astras kodgranskning
```
# Story 2.6: Scopelinjen med åtgärd ur kontraktets del 5

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

<!-- Kodbas: redovisning. Krav: FR-6, FR-7 (signalfraserna som underlag), med FR-27 (saknat visas som saknat) och NFR-9 (inloggning) ur kriterierna (epics.md rad 2012–2043, uppmätt 2026-11-21). Beror på: Story 2.1 (done). Story key: 2-6-scopelinjen-med-atgard-ur-kontraktets-del-5. Skapad av create-story 2026-11-21 i #yolo-läge. Migrationen har inget fast nummer: den tar nästa lediga nummer i server/migrations när bygget börjar, uppmätt 2026-11-21 till 0094 (den senaste är 0093_referens.sql). Validerad 2026-11-21 i ny kontext. Rättelserna står i valideringsrapporten bredvid filen. -->

## Story

As a David,
I want att scopelinjen med alla signalfraser och åtgärden när en signal tänds finns i uppdraget,
so that jag kan känna igen en mening kunden faktiskt sagt och se var gränsen går.

## Förkrav

Blocket räknar upp allt bygget kräver: varje fil som berättelsen skriver, ändrar eller läser i redovisningens repo, Hermes prov som läser releasen, testdatabasen och kontrakten mot Hermes prov. Varje rad med läget `ändras` eller `läses` finns i arbetskatalogens kopia 2026-11-21, och varje rad med läget `ny` saknas där. Migrationens nummer står som `<NNNN>` och är nästa lediga nummer när bygget börjar, uppmätt till 0094.

```förkrav
fil: server/src/lib/leveranskontrakt.ts ändras
fil: server/migrations/<NNNN>_scopelinje_atgard.sql ny
fil: server/src/services/uppdragKontrakt.ts ändras
fil: server/src/services/uppdragLage.ts ändras
fil: server/src/services/uppdragBedomning.ts ändras
fil: server/src/http/view/routes.ts ändras
fil: server/test/uppdragsytan-scopelinje.test.ts ny
fil: server/test/uppdragsytan-laget.test.ts ändras
fil: docs/MCP_ACTIONS.md ändras
fil: docs/ARKITEKTUR.md ändras
fil: docs/STATUS.md ändras
fil: server/src/services/uppdragImport.ts läses
fil: server/src/services/contracts.ts läses
fil: server/src/services/uppdragSignal.ts läses
fil: server/src/services/uppdragOvrigt.ts läses
fil: server/src/services/approvalSummary.ts läses
fil: server/src/actions/registry.ts läses
fil: server/src/http/app.ts läses
fil: server/src/http/routes/companies.ts läses
fil: server/src/http/view/auth.ts läses
fil: server/src/http/view/html.ts läses
fil: server/src/http/middleware/authenticate.ts läses
fil: server/src/lib/errors.ts läses
fil: server/src/db/migrate.ts läses
fil: server/src/db/tx.ts läses
fil: server/migrations/0068_uppdragsytan.sql läses
fil: server/migrations/0085_datumprecision.sql läses
fil: server/migrations/0093_referens.sql läses
fil: server/kontrakt/navigation.v1.json läses
fil: server/test/fixtures/leveranskontrakt-nvr-001-v3.ts läses
fil: server/test/fixtures/leveranskontrakt-nvr-001.ts läses
fil: server/test/fixtures/leveranskontrakt-syntetisk-v3form.ts läses
fil: server/test/uppdragImportHelper.ts läses
fil: server/test/helpers.ts läses
fil: server/test/env.ts läses
fil: server/test/globalSetup.ts läses
fil: server/test/setup.ts läses
fil: server/vitest.config.ts läses
fil: server/package.json läses
fil: server/test/uppdragsytan-import.test.ts läses
fil: server/test/uppdragsytan-import-v3.test.ts läses
fil: server/test/uppdragsytan-v3-fixtur.test.ts läses
fil: server/test/uppdragsytan-kontraktsyta.test.ts läses
fil: server/test/uppdragsytan-undantag.test.ts läses
fil: server/test/uppdragsytan-utskick.test.ts läses
fil: server/test/uppdragsytan-schema.test.ts läses
fil: server/test/uppdragsytan-signaler.test.ts läses
fil: server/test/uppdragsytan-bedomning.test.ts läses
fil: server/test/uppdragsytan-mandat.test.ts läses
fil: server/test/uppdragsytan-plan.test.ts läses
fil: server/test/uppdragsytan-baselineorsak.test.ts läses
fil: server/test/uppdragsytan-migration-0093.test.ts läses
fil: server/test/uppdragsytan-scopeavgorande.test.ts läses
fil: server/test/uppdragsytan-markering.test.ts läses
fil: server/test/uppdragsytan-undantagsvyn-mobil.test.ts läses
fil: CLAUDE.md läses
fil: docs/project-context.md läses
fil: docs/DRIFT_VPS.md läses
prov: agandegrans berörs GRÖN
prov: flerbolag berörs GRÖN
prov: handgrepp berörs GRÖN
prov: modulprov berörs GRÖN
prov: designparitet berörs GRÖN
prov: designsvep berörs GRÖN
prov: svepet berörs GRÖN
prov: redovisning_audit_prov berörs GRÖN
prov: kontrollytan berörs GRÖN
tjanst: 127.0.0.1:5433 vitest kör proven mot testdatabasen i Postgres 16
kontrakt: uppdragsytan fil server/migrations/0068_uppdragsytan.sql prov agandegrans
kontrakt: uppdragsytan fil server/migrations/0068_uppdragsytan.sql prov flerbolag
kontrakt: uppdragsytan fil docs/MCP_ACTIONS.md prov handgrepp
kontrakt: uppdragsytan fil server/src/http/view/routes.ts prov designsvep
kontrakt: uppdragsytan fil server/src/http/view/routes.ts prov svepet
kontrakt: uppdragsytan fil server/src/http/view/routes.ts prov designparitet
```

Berättelsens egna prov är vitest-filer i `server/test` och står som `fil:`-rader. Det är den nya provfilen (`ny`) och `server/test/uppdragsytan-laget.test.ts` (`ändras`), vars helsidesräkning av färskhetsrader uppdateras i uppgift 4.4. Till dem kommer de befintliga prov som körs som regression (`läses`). `prov:`-raderna är Hermes prov, som läser releasen och körs av provvakten i drift, inte av kedjans `npm test` (Dev Notes, ”Kedjan kontrollerar i drift”).

- **Baslinjen.** Berättelsen byggs av kedjan cto, eftersom kodbasen är redovisning. För den kedjan gäller förkontrollens K9 inte: kedjan prövar baslinjen i bygget. K4 fäller där varje `prov:`-rad som inte är GRÖN med ”provet kräver nytt_prov_ej_gront”, eftersom kedjan saknar den förmågan. Blocket har därför bara GRÖNA `prov:`-rader. De prov som inte stod GRÖNA i baslinjen och vars källtext nämner STATUS eller routes som helt ord (continuityvakt, bmadglidning, overlamningsregister_fr6 och provvakt_fr24) står inte i blocket. Berättelsen gör dem inte röda och ska inte göra dem gröna.
- **De GRÖNA raderna** är prov som läser det berättelsen ändrar eller det som byggs ovanpå:
  - agandegrans läser tabellkommentaren på `uppdrag_scopelinje` ordagrant ur driftens databas;
  - flerbolag läser tabellens rättigheter (SELECT, INSERT och UPDATE) ur samma databas;
  - handgrepp läser kodspannen i avsnittet Uppdragsytan i `docs/MCP_ACTIONS.md`;
  - modulprov kör `npm test -- uppdragsytan` i drift;
  - designparitet mäter Läget inloggat, alltså sidan som `server/src/http/view/routes.ts` ritar;
  - designsvep läser vyfilen, och svepet läser hela vykatalogen `server/src/http/view/` efter nätanrop;
  - redovisning_audit_prov kör migrationskedjan;
  - kontrollytan mäter ytorna.

  Berättelsen kräver att de står kvar GRÖNA. Deras läge är författarens läsning av provvaktens körning 2026-11-21 06:30. Står ett kontrakts prov inte GRÖNT när bygget startar, ger K8 RÖD med vägen miljö.
- **Kontrakten** binder de GRÖNA proven till filen de läser eller till filen som bär det de läser. Alla är filkontrakt:
  - Tabellkommentaren och rättigheterna skrivs av `server/migrations/0068_uppdragsytan.sql`, och den nya migrationen rör ingen av dem.
  - Handgrepp binds till dokumentets modulavsnitt.
  - Designsvep, svepet och designparitet binds till vyfilen.

  Kontraktsslagen `schema` och `rutt` används inte. K8 godtar bara `json` eller `tabell` med en fil som schemamål, och slår upp rutter i Hermes yta, inte i redovisningens Express-router.
- **Inga `beroende:`-rader**, eftersom inget paket tillkommer. vitest, supertest, pg och zod finns redan i `server/package.json`.
- **Inga `kommando:`-rader**, eftersom kedjan cto saknar förmågan att köra kommandon för utvecklaren (kedjornas förmågor, raden kommando). Raderna Körning i uppgifterna är ingen grind. Kedjan kör själv typecheck, build och test.
- **Inga `kraver:`- eller `namner:`-rader.** Bygget skriver bara filer i kopian, proven når bara testdatabasen, och ordregelns fyra ord förekommer inte i berättelsen.

## Acceptance Criteria

Lydelsen i varje **Given/When/Then** är ordagra
```

## Utfall
Tester: 190 passed (190) · Granskning: GODKANT | Alla fem kriterier och alla kryssade uppgifter finns i koden och prövas i kedjans körda svit (190 av 190 testfiler, den nya provfilen inräknad), och kvar står bara fyra LOW-fynd. · Byggforsok: 1

## Modellkedja (Davids krav 17/8, reservvag 7/9)

* krav: **claude-opus-5-5**
* utveckling: **claude-opus-5-5**
* granskning: **claude-opus-5-5 (Codex spärrat — Davids regel 12/10; Codex granskar i efterhand)**

Granskaren ar inte forfattaren: claude-opus-5-5 (Codex spärrat — Davids regel 12/10; Codex granskar i efterhand) granskade claude-opus-5-5s arbete.

effort (Davids beslut 20/10): create-story high · validering high · bygg xhigh · granskning xhigh — riskdel uppdragsytan
Allt pa Davids abonnemang - inga API-tokens.
