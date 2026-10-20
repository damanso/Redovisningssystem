# PRD-bygget redovisningen 1-8-dubbel-skattebetalning-ger-ratt-besked — PRD redovisningen 1-8-dubbel-skattebetalning-ger-ratt-besked: # Story 1.8: Dubbel skattebetalning ge

Datum: 2026-10-20 14:43 · Branch: cto/prd-redovisningen-1-8-dubbel-skattebetalning-ger-ratt-besked-9247 · Kalla: 02-Områden/hermes/prd/redovisningen-1c-prd.md (fryst 29/9, Davids beslut #194)

## Mal
PRD redovisningen 1-8-dubbel-skattebetalning-ger-ratt-besked: # Story 1.8: Dubbel skattebetalning ger rätt besked Status: ready-for-dev <!-- Note: Validation is optional. Run validat

## PRD-kravet (ordagrant ur den frysta PRD:n) och astras kodgranskning
```
# Story 1.8: Dubbel skattebetalning ger rätt besked

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

Som David,
vill jag att ett andra försök att bokföra samma löneperiods skattebetalning stoppas med beskedet att den redan är bokförd,
så att jag förstår vad som hänt och ingen betalning bokförs två gånger.

**Kodbas:** redovisning. **Krav:** FR-37 (hela lydelsen), genomfört enligt AD-14. **Beror på:** inga i kravet. Bygget förutsätter ändå att Story 1.9 är done och att dess punkter står i main, eftersom kedjans `npm test` annars är röd redan före bygget (uppgift 1.0, Baslinjen). Båda stämmer i kopian 2026-10-20: `sprint-status.yaml` rad 67 säger done, och punkterna står i «Fakturaserien och bilagan (LOC-263)» på rad 337–346 i `docs/MCP_ACTIONS.md`. Bygget behöver inget svar från David. En fråga som inte spärrar bygget står sist.

**Hålet i dag, i en mening:** `bookPayrollTax` bokför verifikatet först och letar efter dubbletten först efteråt. Därför stoppas den andra bokningen av en period redan i `postVoucher` med `already_posted` («källdokumentet är redan bokfört»), ett låst år ger `period_locked`, och två samtidiga godkännanden ger också `already_posted`. Den egna fångsten av unik-krocken, som skulle ge `already_booked`, nås bara när perioden har en betalningsrad utan ett verifikat från `bookPayrollTax`, och då fångar den krocken inne i transaktionen (kodgranskningen 29/9, FR-37; lärdom 2).

**Läget efter bygge 9243 (correct-course 2026-10-20):** berättelsen stod som done och i drift, men bygget ändrade ingen kod. Driftens `bookPayrollTax` är den som beskrivs ovan. Ingen av berättelsens ändringar finns i drift, och den nya provfilen saknas där helt (andra granskningen efter drift, post 230). Hela ändringen byggs i det här bygget. Skälet och skyddet mot en upprepning står i Dev Notes → Varför bygge 9243 blev done utan kod.

**Läget efter bygge 9245 (andra correct-course 2026-10-20):** bygget stannade med dev-story HALT inom några minuter, troligen i uppgift 1.0, på filer som ett tidigare varv lämnat oincheckade i kedjans arbetskopia. `havera()` checkade in dem på byggets gren som utkast och gick tillbaka till main, så nästa bygge börjar från main. Main hade då en röd baslinje: M1 i `server/test/fakturanummer-samtidighet.test.ts` (Story 1.9) krävde punkter i `docs/MCP_ACTIONS.md` som inte hade nått main. Story 1.9 har sedan byggts om med dokumenten och står done, och 1.9:s punkt står överst i sessionsloggen (`docs/STATUS.md` rad 156). Uppgift 1.0 prövar ändå baslinjen, och 1.0:s sökning i `docs/STATUS.md` är entydig. Skälen står i Dev Notes → Varför bygge 9245 stannade.

## Förkrav

```förkrav
fil: server/src/services/payroll.ts ändras
fil: server/test/payroll-tax-dublett.test.ts ny
fil: server/test/payroll-payment.test.ts ändras
fil: server/test/autopost-vat-sie.test.ts ändras
fil: server/test/business.test.ts ändras
fil: docs/MCP_ACTIONS.md ändras
fil: docs/STATUS.md ändras
fil: server/src/services/accounting/vouchers.ts läses
fil: server/src/services/accounting/numbering.ts läses
fil: server/src/services/accounting/fiscalYears.ts läses
fil: server/src/services/accounting/autopost.ts läses
fil: server/src/services/invoices.ts läses
fil: server/src/services/bokslut.ts läses
fil: server/src/services/taxes.ts läses
fil: server/src/services/reports.ts läses
fil: server/src/services/uppdragSvep.ts läses
fil: server/src/services/approvals.ts läses
fil: server/src/services/sieImport.ts läses
fil: server/src/actions/registry.ts läses
fil: server/src/actions/execute.ts läses
fil: server/src/actions/dependencies.ts läses
fil: server/src/http/routes/actions.ts läses
fil: server/src/http/routes/accounting.ts läses
fil: server/src/http/view/routes.ts läses
fil: server/src/http/view/html.ts läses
fil: server/src/http/view/auth.ts läses
fil: server/src/http/middleware/errorHandler.ts läses
fil: server/src/lib/errors.ts läses
fil: server/src/db/tx.ts läses
fil: server/src/db/pool.ts läses
fil: server/src/db/migrate.ts läses
fil: server/migrations/0007_vouchers.sql läses
fil: server/migrations/0014_partial_payments.sql läses
fil: server/migrations/0039_payslip_payment_and_payroll_tax.sql läses
fil: server/migrations/0053_contractor_role.sql läses
fil: server/test/invoice-series-appendix.test.ts läses
fil: server/test/view.test.ts läses
fil: server/test/crm-review-fixes.test.ts läses
fil: server/test/voucher-links.test.ts läses
fil: server/test/fiscal-year-derivation.test.ts läses
fil: server/test/liquiditySources.test.ts läses
fil: server/test/approval-dependencies.test.ts läses
fil: server/test/uppdragsytan-beslut.test.ts läses
fil: server/test/uppdragsytan-baselineorsak.test.ts läses
fil: server/test/uppdragsytan-undantag.test.ts läses
fil: server/test/fakturanummer-samtidighet.test.ts läses
fil: server/test/draft-delete.test.ts läses
fil: server/test/uppdragsytan-utskick.test.ts läses
fil: server/test/utskickHelper.ts läses
fil: server/test/uppdragsytan-godkannandevag.test.ts läses
fil: server/test/helpers.ts läses
fil: server/test/env.ts läses
fil: server/test/setup.ts läses
fil: server/vitest.config.ts läses
fil: server/tsconfig.json läses
fil: server/tsconfig.test.json läses
fil: server/package.json läses
fil: package.json läses
fil: CLAUDE.md läses
fil: docs/ARKITEKTUR.md läses
fil: docs/project-context.md läses
fil: docs/ACCEPTANS.md läses
fil: _bmad-output/planning-artifacts/epics.md läses
fil: _bmad-output/planning-artifacts/architecture.md läses
fil: _bmad-output/planning-artifacts/prd.md läses
fil: _bmad-output/planning-artifacts/parallelization-analysis.md läses
fil: _bmad-output/planning-artifacts/implementation-readiness-report-2026-10-13.md läses
fil: _bmad-output/planning-artifacts/underlag/kodgranskning.md läses
fil: _bmad-output/planning-artifacts/underlag/davids-svar.md läses
fil: _bmad-output/planning-artifacts/underlag/kedjans-formagor.md läses
fil: _bmad-output/planning-artifacts/sprint-change-proposal-1-8-dubbel-skattebetalning-ger-ratt-besked.md läses
fil: _bmad-output/implementation-artifacts/1-8-dubbel-skattebetalning-ger-ratt-besked.lardomar.md läses
fil: _bmad-output/implementation-artifacts/1-7-en-gang-baklankad-post-kan-aldrig-raderas.md läses
fil: _bmad-output/implementation-artifacts/1-9-tva-fakturor-kan-aldrig-visa-samma-nummer.md läses
fil: docs/byggen/prd-redovisningen-1-9-tva-fakturor-kan-aldrig-visa-samma-nummer.md läses
fil: _bmad-output/implementation-artifacts/sprint-status.yaml läses
fil: _bmad/bmm/workflows/4-implementation/create-story/checklist.md läses
fil: _bmad/bmm/workflows/4-implementation/dev-story/instructions.xml läses
fil: hermes/skills/cto_utveckling.py läses
fil: hermes/skills/bmad_story.py läses
fil: hermes/skills/hermes_bygg.py läses
fil: hermes/skills/forkontroll.py läses
fil: hermes/prov/continuityvakt.py läses
prov: payroll-tax-dublett nytt GRÖN
prov: payroll-payment ändras GRÖN
prov: autopost-vat-sie ändras GRÖN
prov: business ändras GRÖN
prov: liquiditySources berörs GRÖN
prov: view berörs GRÖN
prov: invoice-series-appendix berörs GRÖN
prov: voucher-links berörs GRÖN
prov: fiscal-year-derivation berörs GRÖN
prov: crm-review-fixes berörs GRÖN
prov: approval-dependencies berörs GRÖN
prov: uppdragsytan-utskick berörs GRÖN
prov: uppdragsytan-godkannandevag berörs GRÖN
prov: uppdragsytan-beslut berörs GRÖN
prov: uppdragsytan-baselineorsak berörs GRÖN
prov: uppdragsytan-undantag berörs GRÖN
prov: fakturanummer-samtidighet berörs GRÖN
prov: draft-delete berörs GRÖN
prov: continuityvakt berörs KUNDE_INTE
beroende: pg
beroende: express
beroende: vitest
beroende: supertest
beroende: node:fs/promises
tjanst: 127.0.0.1:5433 vitest kör alla prov mot den stående testdatabasen redovisning-vitest-pg
kontrakt: redovisningen funktion bookPayrollTax prov payroll-payment
kontrakt: redovisningen funktion lockPayrollTaxPeriod nytt payroll-tax-dublett
kontrakt: redovisningen funktion resolveFiscalYearForDate prov fiscal-year-derivation
kon
```

## Utfall
Tester: 166 passed (166) · Granskning: GODKANT | Låset, uppslaget före verifikatet och den borttagna fångsten finns i koden, varje kryssad uppgift är gjord, och varje föreskrivet prov finns i diffen och ingår i kedjans körning (166 passed) · Byggforsok: 1

## Modellkedja (Davids krav 17/8, reservvag 7/9)

* krav: **claude-opus-5-5**
* utveckling: **claude-opus-5-5**
* granskning: **claude-opus-5-5 (Codex spärrat — Davids regel 12/10; Codex granskar i efterhand)**

Granskaren ar inte forfattaren: claude-opus-5-5 (Codex spärrat — Davids regel 12/10; Codex granskar i efterhand) granskade claude-opus-5-5s arbete.

Allt pa Davids abonnemang - inga API-tokens.
