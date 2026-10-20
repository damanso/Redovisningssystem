# PRD-bygget redovisningen 1-9-tva-fakturor-kan-aldrig-visa-samma-nummer — PRD redovisningen 1-9-tva-fakturor-kan-aldrig-visa-samma-nummer: # Story 1.9: Två fakturor kan aldri

Datum: 2026-10-20 10:57 · Branch: cto/prd-redovisningen-1-9-tva-fakturor-kan-aldrig-visa-samma-num-9246 · Kalla: 02-Områden/hermes/prd/redovisningen-1c-prd.md (fryst 29/9, Davids beslut #194)

## Mal
PRD redovisningen 1-9-tva-fakturor-kan-aldrig-visa-samma-nummer: # Story 1.9: Två fakturor kan aldrig visa samma nummer Status: ready-for-dev <!-- Note: Validation is optional. Run vali

## PRD-kravet (ordagrant ur den frysta PRD:n) och astras kodgranskning
```
# Story 1.9: Två fakturor kan aldrig visa samma nummer

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

Som David,
vill jag att varje faktura får ett eget nummer, även när räknaren flyttas eller kundens nummer tilldelas samtidigt som en faktura skapas,
så att två fakturor aldrig bär samma nummer.

**Kodbas:** redovisning. **Krav:** FR-6 (hela lydelsen), genomfört enligt LOC-263-beslutet (David 2026-07-31: en serie framåt). **Beror på:** inga. Bygget behöver inget svar från David.

**Läget efter bygget 2026-10-20, i tre meningar:**
- Serverdelen gick i drift i commit `d70954573069`. Den består av uppslaget i `setExternalInvoiceNumbers`, som avvisar ett upptaget kundnummer med 409 `number_already_in_use` före första skrivningen, den nya provfilen `server/test/fakturanummer-samtidighet.test.ts` med R1, G1–G4, B1, E1, V1 och M1, och S1 i `server/test/invoice-series-appendix.test.ts`.
- De två dokumenten kom inte med. Avsnittet «Fakturaserien och bilagan (LOC-263)» i `docs/MCP_ACTIONS.md` saknar felkoderna och notisen, och `docs/STATUS.md` saknar punkten för 1.9, så M1 är rött mot main.
- Det här bygget skriver bara de två dokumenten, så att de når main och M1 blir grönt. Serverdelen står kvar i drift och byggs inte om.

## Förkrav

```förkrav
fil: docs/MCP_ACTIONS.md ändras
fil: docs/STATUS.md ändras
fil: server/src/services/invoiceNumbering.ts läses
fil: server/test/fakturanummer-samtidighet.test.ts läses
fil: server/test/invoice-series-appendix.test.ts läses
fil: server/src/services/payroll.ts läses
fil: server/src/services/invoices.ts läses
fil: server/src/services/accounting/numbering.ts läses
fil: server/src/services/approvals.ts läses
fil: server/src/services/approvalSummary.ts läses
fil: server/src/services/auditService.ts läses
fil: server/src/services/pdfService.ts läses
fil: server/src/services/draftDelete.ts läses
fil: server/src/services/recurringInvoices.ts läses
fil: server/src/services/invoiceFromTime.ts läses
fil: server/src/services/projects.ts läses
fil: server/src/services/parties.ts läses
fil: server/src/services/supplierInvoices.ts läses
fil: server/src/services/receipts.ts läses
fil: server/src/services/uppdragBeslut.ts läses
fil: server/src/domain/ocr.ts läses
fil: server/src/domain/luhn.ts läses
fil: server/src/actions/registry.ts läses
fil: server/src/actions/execute.ts läses
fil: server/src/http/routes/actions.ts läses
fil: server/src/http/routes/invoices.ts läses
fil: server/src/http/view/routes.ts läses
fil: server/src/http/view/auth.ts läses
fil: server/src/http/view/html.ts läses
fil: server/src/http/middleware/errorHandler.ts läses
fil: server/src/lib/errors.ts läses
fil: server/src/db/tx.ts läses
fil: server/src/db/pool.ts läses
fil: server/migrations/0003_audit_log.sql läses
fil: server/migrations/0010_invoices_and_receipts.sql läses
fil: server/migrations/0046_invoice_external_number.sql läses
fil: server/migrations/0053_contractor_role.sql läses
fil: server/test/domain.test.ts läses
fil: server/test/invoice-pdf-mall.test.ts läses
fil: server/test/view.test.ts läses
fil: server/test/actions.test.ts läses
fil: server/test/draft-delete.test.ts läses
fil: server/test/helpers.ts läses
fil: server/test/env.ts läses
fil: server/test/setup.ts läses
fil: server/test/utskickHelper.ts läses
fil: server/test/uppdragsytan-utskick.test.ts läses
fil: server/test/uppdragsytan-godkannandevag.test.ts läses
fil: server/test/uppdragsytan-beslut.test.ts läses
fil: server/test/uppdragsytan-baselineorsak.test.ts läses
fil: server/test/uppdragsytan-undantag.test.ts läses
fil: server/vitest.config.ts läses
fil: server/tsconfig.json läses
fil: server/tsconfig.test.json läses
fil: server/package.json läses
fil: package.json läses
fil: CLAUDE.md läses
fil: docs/ARKITEKTUR.md läses
fil: docs/project-context.md läses
fil: docs/ACCEPTANS.md läses
fil: docs/byggen/prd-redovisningen-fr-6.md läses
fil: _bmad-output/planning-artifacts/epics.md läses
fil: _bmad-output/planning-artifacts/architecture.md läses
fil: _bmad-output/planning-artifacts/prd.md läses
fil: _bmad-output/planning-artifacts/ux-design-specification.md läses
fil: _bmad-output/planning-artifacts/parallelization-analysis.md läses
fil: _bmad-output/planning-artifacts/implementation-readiness-report-2026-10-13.md läses
fil: _bmad-output/planning-artifacts/underlag/kodgranskning.md läses
fil: _bmad-output/planning-artifacts/underlag/davids-svar.md läses
fil: _bmad-output/planning-artifacts/underlag/kedjans-formagor.md läses
fil: _bmad-output/planning-artifacts/sprint-change-proposal-1-9-tva-fakturor-kan-aldrig-visa-samma-nummer.md läses
fil: _bmad-output/planning-artifacts/sprint-change-proposal-1-8-dubbel-skattebetalning-ger-ratt-besked.md läses
fil: _bmad-output/implementation-artifacts/1-8-dubbel-skattebetalning-ger-ratt-besked.md läses
fil: _bmad-output/implementation-artifacts/sprint-status.yaml läses
fil: _bmad/bmm/workflows/4-implementation/create-story/checklist.md läses
fil: _bmad/bmm/workflows/4-implementation/dev-story/instructions.xml läses
fil: _bmad/bmm/workflows/4-implementation/correct-course/workflow.yaml läses
fil: _bmad/core/tasks/workflow.xml läses
fil: hermes/skills/cto_utveckling.py läses
fil: hermes/skills/bmad_story.py läses
fil: hermes/skills/hermes_bygg.py läses
fil: hermes/skills/forkontroll.py läses
fil: hermes/prov/continuityvakt.py läses
fil: hermes/prov/handgrepp.py läses
fil: hermes/prov/ovrigtforslag.py läses
prov: fakturanummer-samtidighet berörs GRÖN
prov: invoice-series-appendix berörs GRÖN
prov: domain berörs GRÖN
prov: invoice-pdf-mall berörs GRÖN
prov: view berörs GRÖN
prov: actions berörs GRÖN
prov: draft-delete berörs GRÖN
prov: uppdragsytan-utskick berörs GRÖN
prov: uppdragsytan-godkannandevag berörs GRÖN
prov: uppdragsytan-beslut berörs GRÖN
prov: uppdragsytan-baselineorsak berörs GRÖN
prov: uppdragsytan-undantag berörs GRÖN
prov: handgrepp berörs GRÖN
prov: ovrigtforslag berörs GRÖN
prov: continuityvakt berörs KUNDE_INTE
beroende: pg
beroende: express
beroende: vitest
beroende: supertest
beroende: node:fs/promises
tjanst: 127.0.0.1:5433 vitest kör alla prov mot den stående testdatabasen redovisning-vitest-pg
kontrakt: redovisningen funktion setExternalInvoiceNumbers prov invoice-series-appendix
kontrakt: redovisningen funktion setInvoiceNumberSeries prov invoice-series-appendix
kontrakt: redovisningen funktion lockSequence prov invoice-series-appendix
kontrakt: redovisningen funktion nextDocumentNumber prov invoice-series-appendix
kontrakt: redovisningen funktion createInvoice prov invoice-series-appendix
kontrakt: redovisningen funktion generateOcr prov domain
kontrakt: redovisningen funktion approveAction prov view
kontrakt: redovisningen funktion decideApproval prov view
kontrakt: redovisningen funktion felNotis prov fakturanummer-samtidighet
kontrakt: redovisningen funktion errorHandler prov invoice-series-appendix
kontrakt: redovisningen funktion getAction prov fakturanummer-samtidighet
kontrakt: redovisningen funktion withAdmin prov invoice-series-appendix
kontrakt: redovisningen funktion createCompany prov invoice-series-appendix
kontrakt: redovisningen funktion app_has_company_access prov fakturanummer-samtidighet
kontrakt: redovisningen schema pg_stat_activity prov invoice-series-appendix
kontrakt: redovisningen rutt POST /api/companies prov invoice-series-appendix
kontrakt: redovisningen rutt POST /api/companies/:companyId/accounting/fiscal-years prov invoice-series-appendix
kontrakt: redovisningen rutt POST /api/companies/:companyId/actions/set_invoice_number_series prov invoice-series-appendix
kontrakt: redovisningen rutt POST /api/companies/:companyId/actions/set_external_invoice_numbers prov invoice-series-appendix
kontrakt: redovisningen rutt POST /api/companies/:companyId/actions/get_invoice_number_series prov invoice-series-appendix
kontrakt: redovisningen rutt POST /api/companies/:companyId/actions/create_invoice prov invoice-series-appendix
ko
```

## Utfall
Tester: 165 passed (165) · Granskning: GODKANT | Diffen innehåller precis de två dokument som File List anger: de fyra punkterna stämmer med koden, sessionsloggens punkt ligger under rubriken, och kedjans körning (165 av 165 testfiler, med · Byggforsok: 2

## Modellkedja (Davids krav 17/8, reservvag 7/9)

* krav: **claude-opus-5-5**
* utveckling: **claude-opus-5-5**
* granskning: **claude-opus-5-5 (Codex spärrat — Davids regel 12/10; Codex granskar i efterhand)**

Granskaren ar inte forfattaren: claude-opus-5-5 (Codex spärrat — Davids regel 12/10; Codex granskar i efterhand) granskade claude-opus-5-5s arbete.

Allt pa Davids abonnemang - inga API-tokens.
