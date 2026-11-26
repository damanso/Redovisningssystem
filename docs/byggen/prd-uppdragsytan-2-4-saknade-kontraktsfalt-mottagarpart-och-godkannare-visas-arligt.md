# PRD-bygget uppdragsytan 2-4-saknade-kontraktsfalt-mottagarpart-och-godkannare-visas-arligt — PRD uppdragsytan 2-4-saknade-kontraktsfalt-mottagarpart-och-godkannare-visas-arligt: # Story 2.4: Sa

Datum: 2026-11-26 18:04 · Branch: cto/prd-uppdragsytan-2-4-saknade-kontraktsfalt-mottagarpart-och--9357 · Kalla: 02-Områden/hermes/uppdragsytan-1c-prd.md (fryst 29/9, Davids beslut #194)

## Mal
PRD uppdragsytan 2-4-saknade-kontraktsfalt-mottagarpart-och-godkannare-visas-arligt: # Story 2.4: Saknade kontraktsfält, mottagarpart och godkännare visas ärligt Status: ready-for-dev <!-- Note: Validation

## PRD-kravet (ordagrant ur den frysta PRD:n) och astras kodgranskning
```
# Story 2.4: Saknade kontraktsfält, mottagarpart och godkännare visas ärligt

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

<!-- Kodbas: redovisning (kedjan cto). Krav: FR-27, FR-9 (tomma transmittalfält är giltiga), FR-13 (mottagare och godkännare), FR-14 (ankardatumet ur Davids uppgift, lagrat på baselinen med källa) (epics.md rad 1914–1973, uppmätt 2026-11-21). Beror på: Story 2.1 (done) och Story 2.3 (done, kolumnerna bedomning_ankare och bedomning_ankare_kalla). Story key: 2-4-saknade-kontraktsfalt-mottagarpart-och-godkannare-visas-arligt. Skapad av create-story 2026-11-21 i #yolo-läge. Migrationen har inget fast nummer. Den tar nästa lediga nummer i server/migrations när bygget börjar, uppmätt 2026-11-23 till 0097 (den senaste är 0096_crm_deal_snapshots.sql, som crm tog efter 2026-11-21; dubbelnummer fälls av loadMigrations och av project-context). Delad 2026-11-23 av correct-course efter tre byggförsök utan done: förslagets underlag i undantagsvyn (förut uppgift 7, fallen U1–U5, kriterium 7 och underlagsdelen av kriterium 6) är Story 2.8 (2-8-forslagets-underlag-visar-luckorna-parterna-och-ankaret), som beror på den här. -->

## Story

As a David,
I want att ett fält som saknas i kontraktet visas som saknat och att godkännaren kommer ur projektets manifest,
so that ingenting gissas och ingen lucka upptäcks först vid leveransen.

## Förkrav

Blocket räknar upp allt som bygget kräver: varje fil som berättelsen skriver, ändrar eller läser i redovisningens repo, Hermes prov som läser releasen, testdatabasen och kontrakten mot Hermes prov. Varje rad med läget `ändras` eller `läses` finns i arbetskatalogens kopia (kontrollerat med ls 2026-11-23), och varje rad med läget `ny` saknas där. Migrationens nummer står som `<NNNN>`. Det är nästa lediga nummer när bygget börjar, uppmätt 2026-11-23 till 0097. Numret 0096 är taget av crm:s 0096_crm_deal_snapshots.sql, och `docs/project-context.md` förbjuder dubbelnummer.

```förkrav
fil: server/migrations/<NNNN>_kontraktsparter.sql ny
fil: server/src/lib/kontraktsluckor.ts ny
fil: server/test/uppdragsytan-kontraktsluckor.test.ts ny
fil: server/src/lib/leveranskontrakt.ts ändras
fil: server/src/services/uppdragImport.ts ändras
fil: server/src/actions/registry.ts ändras
fil: server/src/services/uppdragRegister.ts ändras
fil: server/src/services/uppdragKontrakt.ts ändras
fil: server/src/services/approvalSummary.ts ändras
fil: server/src/http/view/routes.ts ändras
fil: server/test/uppdragsytan-import.test.ts ändras
fil: server/test/uppdragsytan-register.test.ts ändras
fil: docs/MCP_ACTIONS.md ändras
fil: docs/ARKITEKTUR.md ändras
fil: docs/STATUS.md ändras
fil: server/src/lib/bedomningsrytm.ts läses
fil: server/src/lib/validation.ts läses
fil: server/src/lib/updateBuilder.ts läses
fil: server/src/lib/errors.ts läses
fil: server/src/lib/avtalsdelsfalt.ts läses
fil: server/src/lib/baselinekolumner.ts läses
fil: server/src/services/contracts.ts läses
fil: server/src/services/uppdragStatus.ts läses
fil: server/src/services/uppdragBedomning.ts läses
fil: server/src/services/uppdragBeslut.ts läses
fil: server/src/services/uppdragUndantag.ts läses
fil: server/src/services/uppdragSvep.ts läses
fil: server/src/services/approvals.ts läses
fil: server/src/services/auditService.ts läses
fil: server/src/actions/execute.ts läses
fil: server/src/http/view/html.ts läses
fil: server/src/http/routes/actions.ts läses
fil: server/src/mcp/server.ts läses
fil: server/src/db/migrate.ts läses
fil: server/src/db/tx.ts läses
fil: server/migrations/0064_avtal_och_avtalsdelar.sql läses
fil: server/migrations/0068_uppdragsytan.sql läses
fil: server/migrations/0095_matt_och_rytm.sql läses
fil: server/migrations/0096_crm_deal_snapshots.sql läses
fil: server/test/fixtures/leveranskontrakt-nvr-001-v3.ts läses
fil: server/test/fixtures/leveranskontrakt-nvr-001.ts läses
fil: server/test/fixtures/leveranskontrakt-syntetisk-v3form.ts läses
fil: server/test/uppdragImportHelper.ts läses
fil: server/test/helpers.ts läses
fil: server/test/env.ts läses
fil: server/test/globalSetup.ts läses
fil: server/test/setup.ts läses
fil: server/vitest.config.ts läses
fil: server/tsconfig.test.json läses
fil: server/package.json läses
fil: server/test/uppdragsytan-import-v3.test.ts läses
fil: server/test/uppdragsytan-matt-rytm.test.ts läses
fil: server/test/uppdragsytan-statusbyte.test.ts läses
fil: server/test/uppdragsytan-leveranserna.test.ts läses
fil: server/test/uppdragsytan-kontraktsyta.test.ts läses
fil: server/test/uppdragsytan-undantag.test.ts läses
fil: server/test/uppdragsytan-undantagsvyn.test.ts läses
fil: server/test/uppdragsytan-baselineversion.test.ts läses
fil: server/test/uppdragsytan-baselineorsak.test.ts läses
fil: server/test/uppdragsytan-mandat.test.ts läses
fil: server/test/uppdragsytan-drive-ko.test.ts läses
fil: server/test/uppdragsytan-scopelinje.test.ts läses
fil: server/test/uppdragsytan-beslut.test.ts läses
fil: server/test/uppdragsytan-sparrar.test.ts läses
fil: server/test/uppdragsytan-schema.test.ts läses
fil: server/test/rls-katalog.test.ts läses
fil: server/test/forslagskort-klartext.test.ts läses
fil: server/test/actions.test.ts läses
fil: server/test/mcp.test.ts läses
fil: server/src/services/uppdragReferens.ts läses
fil: server/src/services/uppdragLage.ts läses
fil: server/test/uppdragsytan-laget.test.ts läses
fil: server/test/uppdragsytan-svep.test.ts läses
fil: server/test/crm-sandvag.test.ts läses
fil: server/test/sandvagHelper.ts läses
fil: server/test/uppdragsytan-utskick.test.ts läses
fil: server/test/uppdragsytan-plan.test.ts läses
fil: server/test/crm-read-scope.test.ts läses
fil: server/test/uppdragsytan-godkannandevag.test.ts läses
fil: server/test/vy-kansliga-knappar.test.ts läses
fil: CLAUDE.md läses
fil: docs/project-context.md läses
fil: docs/DRIFT_VPS.md läses
prov: flerbolag berörs GRÖN
prov: procentforbud berörs GRÖN
prov: handgrepp berörs GRÖN
prov: manniskosparr berörs GRÖN
prov: modulprov berörs GRÖN
prov: designparitet berörs GRÖN
prov: designsvep berörs GRÖN
prov: svepet berörs GRÖN
prov: redovisning_audit_prov berörs GRÖN
tjanst: 127.0.0.1:5433 vitest kör proven mot testdatabasen i Postgres 16
kontrakt: uppdragsytan fil server/migrations/0068_uppdragsytan.sql prov flerbolag
kontrakt: uppdragsytan fil server/migrations/0068_uppdragsytan.sql prov procentforbud
kontrakt: uppdragsytan fil docs/MCP_ACTIONS.md prov handgrepp
kontrakt: uppdragsytan fil server/src/actions/registry.ts prov manniskosparr
kontrakt: uppdragsytan fil server/src/http/view/routes.ts prov designparitet
kontrakt: uppdragsytan fil server/src/http/view/routes.ts prov designsvep
kontrakt: uppdragsytan fil server/src/http/view/routes.ts prov svepet
```

Berättelsens egna prov är vitest-filer i `server/test`, och de står som `fil:`-rader. Den nya provfilen har läget `ny`. De två befintliga provfiler vars assertioner uppdateras i samma ändring som koden har läget `ändras`, och regressionsfilerna har läget `läses`. Till regressionsfilerna hör också sändvägsprovet och utskicksprovet, som läser hela `server/src` som en importgraf, Läget- och svepprovet, som läser registrets rader genom `lasLeverabelregister`, de prov som läser hela `server/src` som text (godkännandevägens P12 och vyns känsliga knappar) och migrationsintervallets prov D2 i `server/test/crm-read-scope.test.ts` (Dev Notes, ”Befintliga prov som rör ändringen”). Raden för `server/migrations/0096_crm_deal_snapshots.sql` är ingångens belägg för att kopian är färsk ur main (uppgift 0). `prov:`-raderna är Hermes prov. De läser releasen och körs av Hermes provvakt på dess eget schema, inte av kedjans `npm test`. Kedjan cto kör inga prov efter driftsättningen (underlaget kedjans-formagor: korning_efter_drift nej; Dev Notes, ”Provvakten i drift”).

- **Baslinjen.** Provvaktens senaste bokförda körning (provvaktens state-fil i Hermes hemkatalog, läst 2026-11-21) lästes med fältet `lage` per prov. Nitton prov stod inte
```

## Utfall
Tester: 209 passed (209) · Granskning: GODKANT | Samtliga tillämpliga acceptanskriterier är implementerade, omtagets rättelser håller och inga HIGH- eller MEDIUM-fynd kvarstår. · Byggforsok: 2

## Modellkedja (Davids krav 17/8, reservvag 7/9)

* krav: kordes inte
* utveckling: **gpt-6.1-sol**
* granskning: **gpt-6-astra**

Granskaren ar inte forfattaren: gpt-6-astra granskade gpt-6.1-sols arbete.

effort: ingen Claude-start i den här körningen
Allt pa Davids abonnemang - inga API-tokens.
