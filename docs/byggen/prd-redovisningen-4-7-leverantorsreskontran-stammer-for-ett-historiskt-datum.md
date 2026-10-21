# PRD-bygget redovisningen 4-7-leverantorsreskontran-stammer-for-ett-historiskt-datum — PRD redovisningen 4-7-leverantorsreskontran-stammer-for-ett-historiskt-datum: # Story 4.7: Leverantö

Datum: 2026-10-21 05:55 · Branch: cto/prd-redovisningen-4-7-leverantorsreskontran-stammer-for-ett--9253 · Kalla: 02-Områden/hermes/prd/redovisningen-1c-prd.md (fryst 29/9, Davids beslut #194)

## Mal
PRD redovisningen 4-7-leverantorsreskontran-stammer-for-ett-historiskt-datum: # Story 4.7: Leverantörsreskontran stämmer för ett historiskt datum Status: ready-for-dev <!-- Note: Validation is optio

## PRD-kravet (ordagrant ur den frysta PRD:n) och astras kodgranskning
```
# Story 4.7: Leverantörsreskontran stämmer för ett historiskt datum

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

Som David,
vill jag att leverantörsreskontran för ett visst datum visar exakt vad bolaget var skyldigt den dagen,
så att jag kan stämma av mot ett äldre kontoutdrag eller en bokslutsdag.

**Kodbas:** redovisning. **Krav:** FR-29 (åldersanalys per `as_of`; regression för övrig lydelse utom baklänkning). **Arkitektur:** AD-15 (beräkningsrättelser i befintliga tjänster: «leverantörsreskontrans `as_of` avgränsar både fakturor och betalningar till datumet»). **Beror på:** inga. Bygget behöver inget svar från David.

**Läget i dag, i tre meningar** (läst 2026-10-21 i kopian av main, `server/src/services/reports.ts` med sha256 4fad62630d00…):
- `accountsPayableAging(client, companyId, asOf?)` i `server/src/services/reports.ts` (rad 286–325) väljer varje bokförd, ej annullerad leverantörsfaktura med `total_ore > paid_amount_ore` och räknar återstoden som `total_ore − paid_amount_ore`, alltså med **dagens** betalda belopp.
- `as_of` styr bara åldersindelningen (rad 295 och 303–307): en faktura som bokförts efter `as_of` kommer ändå med, och en faktura som betalats efter `as_of` saknas eller står med för lite, vilket kodgranskningen pekar ut för FR-29.
- Bygget avgränsar i samma fråga först fakturorna till dem vars verifikat är daterat senast `as_of` (uppgift 1) och lägger sedan tillbaka de betalningar vars betalningsverifikat är daterat efter `as_of` (uppgift 2). Båda villkoren är neutrala när `as_of` saknas, så dagens utfall står kvar genom konstruktion.

## Förkrav

```förkrav
fil: server/src/services/reports.ts ändras
fil: server/test/supplier-invoices.test.ts ändras
fil: docs/MCP_ACTIONS.md ändras
fil: docs/STATUS.md ändras
fil: server/src/services/supplierInvoices.ts läses
fil: server/src/services/voucherLinks.ts läses
fil: server/src/services/accounting/autopost.ts läses
fil: server/src/services/accounting/vouchers.ts läses
fil: server/src/services/timeReports.ts läses
fil: server/src/domain/money.ts läses
fil: server/src/actions/registry.ts läses
fil: server/src/actions/execute.ts läses
fil: server/src/http/routes/actions.ts läses
fil: server/src/http/view/routes.ts läses
fil: server/src/lib/validation.ts läses
fil: server/migrations/0006_chart_of_accounts_and_fiscal_years.sql läses
fil: server/migrations/0007_vouchers.sql läses
fil: server/migrations/0014_partial_payments.sql läses
fil: server/migrations/0015_supplier_invoices.sql läses
fil: server/test/helpers.ts läses
fil: server/test/env.ts läses
fil: server/test/setup.ts läses
fil: server/test/globalSetup.ts läses
fil: server/test/hem-landningar.test.ts läses
fil: server/test/voucher-links.test.ts läses
fil: server/test/draft-delete.test.ts läses
fil: server/test/entity-links.test.ts läses
fil: server/test/liquidityGuard.test.ts läses
fil: server/test/payroll-tax-dublett.test.ts läses
fil: server/test/fakturanummer-samtidighet.test.ts läses
fil: server/test/uppdragsytan-utskick.test.ts läses
fil: server/test/utskickHelper.ts läses
fil: server/test/uppdragsytan-beslut.test.ts läses
fil: server/test/uppdragsytan-undantag.test.ts läses
fil: server/test/uppdragsytan-baselineorsak.test.ts läses
fil: server/test/uppdragsytan-godkannandevag.test.ts läses
fil: server/vitest.config.ts läses
fil: server/tsconfig.json läses
fil: server/tsconfig.test.json läses
fil: server/package.json läses
fil: package.json läses
fil: CLAUDE.md läses
fil: docs/ARKITEKTUR.md läses
fil: docs/ACCEPTANS.md läses
fil: docs/project-context.md läses
fil: _bmad-output/planning-artifacts/epics.md läses
fil: _bmad-output/planning-artifacts/architecture.md läses
fil: _bmad-output/planning-artifacts/prd.md läses
fil: _bmad-output/planning-artifacts/ux-design-specification.md läses
fil: _bmad-output/planning-artifacts/parallelization-analysis.md läses
fil: _bmad-output/planning-artifacts/underlag/kodgranskning.md läses
fil: _bmad-output/planning-artifacts/underlag/davids-svar.md läses
fil: _bmad-output/planning-artifacts/underlag/kedjans-formagor.md läses
fil: _bmad-output/implementation-artifacts/sprint-status.yaml läses
fil: _bmad-output/implementation-artifacts/4-7-leverantorsreskontran-stammer-for-ett-historiskt-datum.lardomar.md läses
fil: _bmad-output/implementation-artifacts/4-4-momsvakten-varnar-for-varje-inkop-utan-ingaende-moms.md läses
fil: _bmad/bmm/workflows/4-implementation/create-story/checklist.md läses
fil: hermes/skills/cto_utveckling.py läses
fil: hermes/skills/bmad_story.py läses
fil: hermes/skills/omradeslaget.py läses
fil: hermes/skills/morgonbrief.py läses
prov: supplier-invoices ändras GRÖN
prov: hem-landningar berörs GRÖN
prov: voucher-links berörs GRÖN
prov: draft-delete berörs GRÖN
prov: entity-links berörs GRÖN
prov: liquidityGuard berörs GRÖN
prov: payroll-tax-dublett berörs GRÖN
prov: fakturanummer-samtidighet berörs GRÖN
prov: uppdragsytan-utskick berörs GRÖN
prov: uppdragsytan-beslut berörs GRÖN
prov: uppdragsytan-undantag berörs GRÖN
prov: uppdragsytan-baselineorsak berörs GRÖN
prov: uppdragsytan-godkannandevag berörs GRÖN
prov: continuityvakt berörs KUNDE_INTE
beroende: pg
beroende: zod
beroende: express
beroende: vitest
beroende: supertest
tjanst: 127.0.0.1:5433 vitest kör alla prov mot den stående testdatabasen redovisning-vitest-pg
kontrakt: redovisningen funktion accountsPayableAging prov supplier-invoices
kontrakt: redovisningen funktion recordSupplierPayment prov supplier-invoices
kontrakt: redovisningen funktion postSupplierPayment prov supplier-invoices
kontrakt: redovisningen funktion linkVoucher prov supplier-invoices
kontrakt: redovisningen rutt POST /api/companies/:companyId/actions/accounts_payable_aging prov supplier-invoices
kontrakt: redovisningen rutt POST /api/companies/:companyId/actions/create_supplier_invoice prov supplier-invoices
kontrakt: redovisningen rutt POST /api/companies/:companyId/actions/book_supplier_invoice prov supplier-invoices
kontrakt: redovisningen rutt POST /api/companies/:companyId/actions/register_supplier_payment prov supplier-invoices
kontrakt: redovisningen rutt POST /api/companies/:companyId/actions/link_voucher prov supplier-invoices
kontrakt: redovisningen rutt POST /api/companies/:companyId/actions/post_voucher prov supplier-invoices
kontrakt: redovisningen rutt POST /api/companies/:companyId/approvals/:id/approve prov supplier-invoices
kontrakt: redovisningen rutt POST /api/companies/:companyId/actions/create_supplier prov supplier-invoices
kontrakt: redovisningen rutt POST /api/companies/:companyId/actions/delete_draft_supplier_invoice prov draft-delete
kontrakt: redovisningen rutt GET /app/c/:companyId/payables prov hem-landningar
kontrakt: redovisningen funktion registerUser prov supplier-invoices
kontrakt: redovisningen funktion createCompany prov supplier-invoices
kontrakt: redovisningen funktion createFiscalYear prov supplier-invoices
kontrakt: redovisningen funktion withAdmin prov supplier-invoices
kontrakt: redovisningen funktion unclaimedCreditBalance prov liquidityGuard
kontrakt: redovisningen funktion unlinkVoucher prov voucher-links
kontrakt: redovisningen fil docs/MCP_ACTIONS.md prov draft-delete
kontrakt: redovisningen schema supplier_invoices prov supplier-invoices
kontrakt: redovisningen schema vouchers prov supplier-invoices
kontrakt: redovisningen schema voucher_lines prov supplier-invoices
kommando: git status --porcelain -- server/src/services/reports.ts server/test/supplier-invoices.test.ts docs/MCP_ACTIONS.md docs/STATUS.md
kommando: npm run typecheck
kommando: npm run build
kommando: npm test
kommando: npm run test -w server -- test/supplier-invoices.test.ts
kommando: npm run test -w server -- test/hem-landningar.test.ts test/voucher-links.test.ts test/draft-delete.test.ts test/entity-links.test.ts test/liquidityGuard.test.ts
kommando: npm run test -w server -- test/payroll-tax-dublett.test.ts test/fakturanummer-samtidighet.test.
```

## Utfall
Tester: 169 passed (169) · Granskning: GODKANT | Alla tre acceptanskriterierna är implementerade och prövas av H1–H4, P1–P5 och de befintliga fallen i kedjans gröna körning (169/169); de två fynden är LOW och gäller ovanliga kantfall i åte · Byggforsok: 1

## Modellkedja (Davids krav 17/8, reservvag 7/9)

* krav: **claude-opus-5-5**
* utveckling: **claude-opus-5-5**
* granskning: **claude-opus-5-5 (Codex spärrat — Davids regel 12/10; Codex granskar i efterhand)**

Granskaren ar inte forfattaren: claude-opus-5-5 (Codex spärrat — Davids regel 12/10; Codex granskar i efterhand) granskade claude-opus-5-5s arbete.

effort (Davids beslut 20/10): create-story high · validering high · bygg xhigh · granskning xhigh — riskdel redovisningen
Allt pa Davids abonnemang - inga API-tokens.
