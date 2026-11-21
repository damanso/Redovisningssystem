# PRD-bygget uppdragsytan 2-3-matten-och-rytmen-ur-kontraktets-del-3-och-del-4 — PRD uppdragsytan 2-3-matten-och-rytmen-ur-kontraktets-del-3-och-del-4: # Story 2.3: Måtten och rytme

Datum: 2026-11-21 23:15 · Branch: cto/prd-uppdragsytan-2-3-matten-och-rytmen-ur-kontraktets-del-3--9322 · Kalla: 02-Områden/hermes/uppdragsytan-1c-prd.md (fryst 29/9, Davids beslut #194)

## Mal
PRD uppdragsytan 2-3-matten-och-rytmen-ur-kontraktets-del-3-och-del-4: # Story 2.3: Måtten och rytmen ur kontraktets del 3 och del 4 Status: ready-for-dev <!-- Note: Validation is optional. R

## PRD-kravet (ordagrant ur den frysta PRD:n) och astras kodgranskning
```
# Story 2.3: Måtten och rytmen ur kontraktets del 3 och del 4

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

<!-- Kodbas: redovisning. Krav: FR-19, FR-14 (rytm, ankardatum, ”datum saknas”), FR-26 (beslutspunkternas källor), FR-35, NFR-11 (epics.md rad 1854–1910, uppmätt 2026-11-21). Beror på: Story 2.1 (done). Story key: 2-3-matten-och-rytmen-ur-kontraktets-del-3-och-del-4. Skapad av create-story 2026-11-21 i #yolo-läge. Migrationen har inget fast nummer. Den tar nästa lediga nummer i server/migrations när bygget börjar, uppmätt 2026-11-21 till 0095 (den senaste är 0094_scopelinje_atgard.sql). Validerad i ny kontext 2026-11-21 (validate-create-story, autonomt läge); rättelserna står i 2-3-matten-och-rytmen-ur-kontraktets-del-3-och-del-4.validering.md. Correct-course 2026-11-21 efter tre byggförsök utan done: varför ingen period räknas har en enda källa (`Rytmutfall` och `INGEN_PERIOD` i server/src/lib/bedomningsrytm.ts, fem lägen) som Läget, Bedömning och undantagsvyn ritar med samma ord, och ingen vy påstår vad kontraktet säger; kedjans röda grannfall i uppdragsytan-baseline har en regel. Förslaget står i _bmad-output/planning-artifacts/sprint-change-proposal-2-3-matten-och-rytmen-ur-kontraktets-del-3-och-del-4.md. Validerad på nytt i ny kontext 2026-11-21 efter correct-course: tjänstedelen bor där arkitekturen lägger kraven (uppdragBedomning.ts och uppdragLage.ts), båda lägena utan ankare säger ”datum saknas”, och undantagsvyprovets fall (c) sås; rapporten står i samma valideringsfil. -->

## Story

As a David,
I want att varje uppföljningsmått bär sin läsväg och att bedömningsrytmen kommer ur avtalet,
so that jag ser om jag ligger rätt ur egna källor och aldrig får en gissad period eller en förbjuden andel.

## Förkrav

Blocket räknar upp allt som bygget kräver: varje fil som berättelsen skriver, ändrar eller läser i redovisningens repo, Hermes prov som läser releasen, testdatabasen och kontrakten mot Hermes prov. Varje rad med läget `ändras` eller `läses` finns i arbetskatalogens kopia 2026-11-21, och varje rad med läget `ny` saknas där. Migrationens nummer står som `<NNNN>`. Det är nästa lediga nummer när bygget börjar, uppmätt till 0095.

```förkrav
fil: server/migrations/<NNNN>_matt_och_rytm.sql ny
fil: server/src/lib/bedomningsrytm.ts ny
fil: server/src/http/view/uppdragUppfoljning.ts ny
fil: server/test/uppdragsytan-matt-rytm.test.ts ny
fil: server/test/bedomningsrytmHelper.ts ny
fil: server/src/lib/leveranskontrakt.ts ändras
fil: server/src/services/uppdragImport.ts ändras
fil: server/src/actions/registry.ts ändras
fil: server/src/services/uppdragLage.ts ändras
fil: server/src/services/uppdragBedomning.ts ändras
fil: server/src/services/uppdragUndantag.ts ändras
fil: server/src/http/view/routes.ts ändras
fil: server/src/http/view/undantagsvyn.ts ändras
fil: server/test/uppdragsytan-import-v3.test.ts ändras
fil: server/test/uppdragsytan-laget.test.ts ändras
fil: server/test/uppdragsytan-undantag.test.ts ändras
fil: server/test/uppdragsytan-bedomning.test.ts ändras
fil: server/test/uppdragsytan-bedomningsbegaran.test.ts ändras
fil: server/test/bedomningsbegaranHelper.ts ändras
fil: server/test/uppdragsytan-sparrar.test.ts ändras
fil: server/test/uppdragsytan-undantagsvyn.test.ts ändras
fil: server/test/uppdragsytan-undantagsvyn-mobil.test.ts ändras
fil: server/test/uppdragsytan-beslut.test.ts ändras
fil: server/test/uppdragsytan-referens.test.ts ändras
fil: server/test/undantagsvynHelper.ts ändras
fil: docs/MCP_ACTIONS.md ändras
fil: docs/ARKITEKTUR.md ändras
fil: docs/STATUS.md ändras
fil: server/src/lib/lasvarde.ts läses
fil: server/src/lib/bedomningsbegaran.ts läses
fil: server/src/lib/baselinekolumner.ts läses
fil: server/src/lib/updateBuilder.ts läses
fil: server/src/lib/errors.ts läses
fil: server/src/lib/validation.ts läses
fil: server/src/lib/referens.ts läses
fil: server/src/actions/execute.ts läses
fil: server/src/services/contracts.ts läses
fil: server/src/services/uppdragReferens.ts läses
fil: server/src/services/uppdragKontrakt.ts läses
fil: server/src/services/auditService.ts läses
fil: server/src/http/view/html.ts läses
fil: server/src/http/app.ts läses
fil: server/src/http/routes/actions.ts läses
fil: server/src/mcp/server.ts läses
fil: server/src/db/migrate.ts läses
fil: server/src/db/tx.ts läses
fil: server/migrations/0064_avtal_och_avtalsdelar.sql läses
fil: server/migrations/0068_uppdragsytan.sql läses
fil: server/migrations/0082_bedomningsbegaran.sql läses
fil: server/migrations/0093_referens.sql läses
fil: server/migrations/0094_scopelinje_atgard.sql läses
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
fil: server/test/uppdragsytan-v3-fixtur.test.ts läses
fil: server/test/uppdragsytan-baselineversion.test.ts läses
fil: server/test/uppdragsytan-baseline.test.ts läses
fil: server/test/uppdragsytan-scopelinje.test.ts läses
fil: server/test/uppdragsytan-utskick.test.ts läses
fil: server/test/uppdragsytan-agandegrans-cache.test.ts läses
fil: server/test/rls-katalog.test.ts läses
fil: server/test/uppdragsytan-schema.test.ts läses
fil: server/test/uppdragsytan-register.test.ts läses
fil: server/test/undantagsvynRigg.ts läses
fil: server/test/kedjaRigg.ts läses
fil: server/test/uppdragsytan-rapporterna.test.ts läses
fil: server/test/uppdragsytan-tillagg.test.ts läses
fil: server/test/manniskosparr.test.ts läses
fil: server/test/forslagskort-beslut.test.ts läses
fil: server/test/uppdragsytan-komplettering.test.ts läses
fil: server/test/uppdragsytan-migration-0082.test.ts läses
fil: server/test/uppdragsytan-plan.test.ts läses
fil: server/test/uppdragsytan-baselineorsak.test.ts läses
fil: server/test/uppdragsytan-mandat.test.ts läses
fil: server/test/uppdragsytan-markering.test.ts läses
fil: server/test/actions.test.ts läses
fil: server/test/mcp.test.ts läses
fil: server/test/uppdragsytan-kontraktsyta.test.ts läses
fil: server/test/uppdragsytan-pengarna.test.ts läses
fil: server/src/http/view/kontrakt.ts läses
fil: CLAUDE.md läses
fil: docs/project-context.md läses
fil: docs/DRIFT_VPS.md läses
prov: agandegrans berörs GRÖN
prov: flerbolag berörs GRÖN
prov: procentforbud berörs GRÖN
prov: handgrepp berörs GRÖN
prov: manniskosparr berörs GRÖN
prov: modulprov berörs GRÖN
prov: designparitet berörs GRÖN
prov: designsvep berörs GRÖN
prov: svepet berörs GRÖN
prov: redovisning_audit_prov berörs GRÖN
prov: kontrollytan berörs GRÖN
prov: adresskontraktet berörs GRÖN
tjanst: 127.0.0.1:5433 vitest kör proven mot testdatabasen i Postgres 16
kontrakt: uppdragsytan fil server/migrations/0068_uppdragsytan.sql prov agandegrans
kontrakt: uppdragsytan fil server/migrations/0068_uppdragsytan.sql prov flerbolag
kontrakt: uppdragsytan fil server/migrations/0068_uppdragsytan.sql prov procentforbud
kontrakt: uppdragsytan fil docs/MCP_ACTIONS.md prov handgrepp
kontrakt: uppdragsytan fil server/src/actions/registry.ts prov manniskosparr
kontrakt: uppdragsytan fil server/src/http/view/routes.ts prov designsvep
kontrakt: uppdragsytan fil server/src/http/view/routes.ts prov svepet
kontrakt: uppdragsytan fil server/src/http/view/routes.ts prov designparitet
```

Berättelsens egna prov är vitest-filer i `server/test`, och de står som `fil:`-rader. Den nya provfilen och den nya provhjälparen har läget `ny`. Befintliga provfiler vars assertioner eller rigg uppdateras i samma ändring som koden har läget `ändras`, och regressionsfilerna har läget `läses`. `prov:`-raderna är Hermes prov. De läser releasen oc
```

## Utfall
Tester: 192 passed (192) · Granskning: GODKANT | Alla fem fynd från förra varvet är åtgärdade och prövade (M6, A9, A10, V7, B8), varje AC är implementerat och ingen HIGH eller MEDIUM återstår. · Byggforsok: 2

## Modellkedja (Davids krav 17/8, reservvag 7/9)

* krav: kordes inte
* utveckling: **claude-opus-5-5**
* granskning: **claude-opus-5-5 (Codex spärrat — Davids regel 12/10; Codex granskar i efterhand)**

Granskaren ar inte forfattaren: claude-opus-5-5 (Codex spärrat — Davids regel 12/10; Codex granskar i efterhand) granskade claude-opus-5-5s arbete.

effort (Davids beslut 20/10): bygg xhigh · granskning xhigh — riskdel uppdragsytan
Allt pa Davids abonnemang - inga API-tokens.
