# PRD-bygget redovisningen 1-9-tva-fakturor-kan-aldrig-visa-samma-nummer — PRD redovisningen 1-9-tva-fakturor-kan-aldrig-visa-samma-nummer: # Story 1.9: Två fakturor kan aldri

Datum: 2026-10-20 04:59 · Branch: cto/prd-redovisningen-1-9-tva-fakturor-kan-aldrig-visa-samma-num-9244 · Kalla: 02-Områden/hermes/prd/redovisningen-1c-prd.md (fryst 29/9, Davids beslut #194)

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

**Läget i dag, i två meningar:** Serialiseringen som FR-6-bygget lade in 29/9 (`lockSequence` med `FOR UPDATE` i `server/src/services/invoiceNumbering.ts`) finns och är prövad i tjänsten, men inget prov visar den genom godkännandet, alltså genom Att göra och `POST …/approvals/:id/approve`, och inget prov visar att agentens anrop köas. Ett kundnummer som redan visas på en annan faktura stoppas i dag bara av den uppskjutna unika nyckeln vid COMMIT: API:t svarar då 409 `conflict`, och vyn ritar felsidan «Något gick fel.» med status 500 i stället för en notis på Att göra (lärdom 4). Båda följderna är lästa ur koden 2026-10-20 och inte körda.

## Förkrav

```förkrav
fil: server/src/services/invoiceNumbering.ts ändras
fil: server/test/fakturanummer-samtidighet.test.ts ny
fil: server/test/invoice-series-appendix.test.ts ändras
fil: docs/MCP_ACTIONS.md ändras
fil: docs/STATUS.md ändras
fil: server/src/services/invoices.ts läses
fil: server/src/services/accounting/numbering.ts läses
fil: server/src/services/approvals.ts läses
fil: server/src/services/approvalSummary.ts läses
fil: server/src/services/auditService.ts läses
fil: server/src/services/pdfService.ts läses
fil: server/src/services/draftDelete.ts läses
fil: server/src/services/recurringInvoices.ts läses
fil: server/src/services/invoiceFromTime.ts läses
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
fil: server/test/helpers.ts läses
fil: server/test/env.ts läses
fil: server/test/setup.ts läses
fil: server/test/utskickHelper.ts läses
fil: server/test/uppdragsytan-utskick.test.ts läses
fil: server/test/uppdragsytan-godkannandevag.test.ts läses
fil: server/test/uppdragsytan-beslut.test.ts läses
fil: server/test/uppdragsytan-baselineorsak.test.ts läses
fil: server/test/uppdragsytan-undantag.test.ts läses
fil: server/test/uppdragsytan-svep.test.ts läses
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
fil: _bmad-output/implementation-artifacts/1-8-dubbel-skattebetalning-ger-ratt-besked.md läses
fil: _bmad-output/implementation-artifacts/sprint-status.yaml läses
fil: _bmad/bmm/workflows/4-implementation/create-story/checklist.md läses
fil: hermes/skills/cto_utveckling.py läses
fil: hermes/skills/hermes_bygg.py läses
fil: hermes/skills/forkontroll.py läses
fil: hermes/prov/continuityvakt.py läses
fil: hermes/prov/handgrepp.py läses
fil: hermes/prov/ovrigtforslag.py läses
prov: fakturanummer-samtidighet nytt GRÖN
prov: invoice-series-appendix ändras GRÖN
prov: domain berörs GRÖN
prov: invoice-pdf-mall berörs GRÖN
prov: view berörs GRÖN
prov: actions berörs GRÖN
prov: uppdragsytan-utskick berörs GRÖN
prov: uppdragsytan-godkannandevag berörs GRÖN
prov: uppdragsytan-beslut berörs GRÖN
prov: uppdragsytan-baselineorsak berörs GRÖN
prov: uppdragsytan-undantag berörs GRÖN
prov: continuityvakt berörs KUNDE_INTE
beroende: pg
beroende: express
beroende: vitest
beroende: supertest
tjanst: 127.0.0.1:5433 vitest kör alla prov mot den stående testdatabasen redovisning-vitest-pg
kontrakt: redovisningen funktion setExternalInvoiceNumbers prov invoice-series-appendix
kontrakt: redovisningen funktion setInvoiceNumberSeries prov invoice-series-appendix
kontrakt: redovisningen funktion lockSequence prov invoice-series-appendix
kontrakt: redovisningen funktion nextDocumentNumber prov invoice-series-appendix
kontrakt: redovisningen funktion createInvoice prov invoice-series-appendix
kontrakt: redovisningen funktion generateOcr prov domain
kontrakt: redovisningen funktion approveAction prov view
kontrakt: redovisningen funktion decideApproval prov view
kontrakt: redovisningen funktion felNotis nytt fakturanummer-samtidighet
kontrakt: redovisningen funktion errorHandler prov invoice-series-appendix
kontrakt: redovisningen funktion getAction nytt fakturanummer-samtidighet
kontrakt: redovisningen funktion withAdmin prov invoice-series-appendix
kontrakt: redovisningen funktion createCompany prov invoice-series-appendix
kontrakt: redovisningen funktion app_has_company_access nytt fakturanummer-samtidighet
kontrakt: redovisningen schema pg_stat_activity prov invoice-series-appendix
kontrakt: redovisningen rutt POST /api/companies prov invoice-series-appendix
kontrakt: redovisningen rutt POST /api/companies/:companyId/accounting/fiscal-years prov invoice-series-appendix
kontrakt: redovisningen rutt POST /api/companies/:companyId/actions/set_invoice_number_series prov invoice-series-appendix
kontrakt: redovisningen rutt POST /api/companies/:companyId/actions/set_external_invoice_numbers prov invoice-series-appendix
kontrakt: redovisningen rutt POST /api/companies/:companyId/actions/get_invoice_number_series prov invoice-series-appendix
kontrakt: redovisningen rutt POST /api/companies/:companyId/actions/create_invoice prov invoice-series-appendix
kontrakt: redovisningen rutt POST /api/companies/:companyId/actions/get_invoice prov invoice-series-appendix
kontrakt: redovisningen rutt POST /api/companies/:companyId/customers prov invoice-series-appendix
kontrakt: redovisningen rutt POST /api/companies/:companyId/agent-tokens prov actions
kontrakt: redovisningen rutt POST /api/companies/:companyId/approvals/:id/approve prov invoice-series-appendix
kontrakt: redovisningen rutt GET /api/companies/:companyId/approvals prov view
kontrakt: redovisningen rutt POST /app/login prov view
kontrakt: redovisningen rutt GET /app/c/:companyId/approvals prov view
kontrakt: redovisningen rutt POST /app/c/:companyId/approvals/:id/approve prov view
kontrakt: redovisningen schema invoices prov invoice-series-appendix
kontrakt: redovisningen schema number_sequences prov invoice-series-appendix
kontrakt: redovisningen schema audit_log prov invoice-series-appendix
kontrakt: redovisningen fil docs/MCP_AC
```

## Utfall
Tester: 166 passed (166) · Granskning: GODKANT | Varje AC är implementerat och prövat, och kedjans körning (166 av 166) omfattar den nya sviten; berättelsen saknar «Review Follow-ups (AI)» från förra varvet, så det fanns inga fynd att pröv · Byggforsok: 2

## Modellkedja (Davids krav 17/8, reservvag 7/9)

* krav: **claude-opus-5-5**
* utveckling: **claude-opus-5-5**
* granskning: **claude-opus-5-5 (Codex spärrat — Davids regel 12/10; Codex granskar i efterhand)**

Granskaren ar inte forfattaren: claude-opus-5-5 (Codex spärrat — Davids regel 12/10; Codex granskar i efterhand) granskade claude-opus-5-5s arbete.

Allt pa Davids abonnemang - inga API-tokens.
