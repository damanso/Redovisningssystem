# PRD-bygget redovisningen 1-7-en-gang-baklankad-post-kan-aldrig-raderas — PRD redovisningen 1-7-en-gang-baklankad-post-kan-aldrig-raderas: # Story 1.7: En gång baklänkad post

Datum: 2026-10-19 18:15 · Branch: cto/prd-redovisningen-1-7-en-gang-baklankad-post-kan-aldrig-rade-9241 · Kalla: 02-Områden/hermes/prd/redovisningen-1c-prd.md (fryst 29/9, Davids beslut #194)

## Mal
PRD redovisningen 1-7-en-gang-baklankad-post-kan-aldrig-raderas: # Story 1.7: En gång baklänkad post kan aldrig raderas Status: ready-for-dev <!-- Note: Validation is optional. Run vali

## PRD-kravet (ordagrant ur den frysta PRD:n) och astras kodgranskning
```
# Story 1.7: En gång baklänkad post kan aldrig raderas

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

Som David,
vill jag att en registerpost som någon gång hört till ett bokfört verifikat aldrig kan raderas, inte ens efter att kopplingen tagits bort,
så att räkenskapsinformation och dess underlag finns kvar enligt bokföringslagen.

**Kodbas:** redovisning. **Krav:** FR-41 (hela lydelsen) och FR-12 (radering bara av obokade utkast), genomförda enligt AD-12. **Beror på:** inga. Bygget behöver inget svar från David. Två frågor som inte spärrar bygget står sist.

**Hålet i dag, i en mening:** `link_voucher` sätter `voucher_id`, `unlink_voucher` nollar det och återställer utkaststatusen, och därefter släpper både `deleteDraft` och RLS-policyn i migration 0041 igenom raderingen. Det gäller posten, kvittots bilagor och objekten i lagringen (kodgranskningen 29/9, FR-12 och FR-41).

## Förkrav

```förkrav
fil: server/src/services/draftDelete.ts ändras
fil: server/src/lib/errors.ts ändras
fil: server/src/http/view/routes.ts ändras
fil: server/test/voucherLinkHelper.ts ny
fil: server/test/draft-delete.test.ts ändras
fil: server/test/kvittobilagor.test.ts ändras
fil: server/test/invoice-detail.test.ts ändras
fil: docs/MCP_ACTIONS.md ändras
fil: docs/STATUS.md ändras
fil: server/src/services/voucherLinks.ts läses
fil: server/src/services/receiptFiles.ts läses
fil: server/src/services/objektlagring.ts läses
fil: server/src/services/auditService.ts läses
fil: server/src/services/payroll.ts läses
fil: server/src/services/gdpr.ts läses
fil: server/src/actions/registry.ts läses
fil: server/src/actions/execute.ts läses
fil: server/src/http/middleware/errorHandler.ts läses
fil: server/src/http/view/html.ts läses
fil: server/src/db/tx.ts läses
fil: server/migrations/0003_audit_log.sql läses
fil: server/migrations/0005_force_rls_and_audit_index.sql läses
fil: server/migrations/0023_payroll.sql läses
fil: server/migrations/0041_draft_delete.sql läses
fil: server/migrations/0075_kvittobilagor.sql läses
fil: server/kontrakt/navigation.v1.json läses
fil: server/test/voucher-links.test.ts läses
fil: server/test/faktura-ur-tid.test.ts läses
fil: server/test/supplier-invoices.test.ts läses
fil: server/test/payroll.test.ts läses
fil: server/test/uppdragsytan-svep.test.ts läses
fil: server/test/audit-immutability.test.ts läses
fil: server/test/uppdragsytan-utskick.test.ts läses
fil: server/test/uppdragsytan-godkannandevag.test.ts läses
fil: server/test/utskickHelper.ts läses
fil: server/test/utkastHelper.ts läses
fil: server/test/helpers.ts läses
fil: server/test/accounting.test.ts läses
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
fil: _bmad-output/planning-artifacts/ux-design-specification.md läses
fil: _bmad-output/planning-artifacts/parallelization-analysis.md läses
fil: _bmad-output/planning-artifacts/underlag/kodgranskning.md läses
fil: _bmad-output/planning-artifacts/underlag/davids-svar.md läses
fil: _bmad-output/implementation-artifacts/1-7-en-gang-baklankad-post-kan-aldrig-raderas.validering.md läses
fil: _bmad-output/implementation-artifacts/1-1-forslagskortet-visar-posten-i-klartext-utan-uuid-n.md läses
fil: _bmad-output/implementation-artifacts/sprint-status.yaml läses
fil: _bmad/bmm/workflows/4-implementation/create-story/checklist.md läses
fil: _bmad/bmm/workflows/4-implementation/dev-story/instructions.xml läses
fil: _bmad-output/planning-artifacts/sprint-change-proposal-1-7-en-gang-baklankad-post-kan-aldrig-raderas.md läses
fil: _bmad-output/planning-artifacts/underlag/kedjans-formagor.md läses
fil: hermes/skills/cto_utveckling.py läses
prov: draft-delete ändras GRÖN
prov: kvittobilagor ändras GRÖN
prov: invoice-detail ändras GRÖN
prov: voucher-links berörs GRÖN
prov: faktura-ur-tid berörs GRÖN
prov: supplier-invoices berörs GRÖN
prov: payroll berörs GRÖN
prov: accounting berörs GRÖN
prov: audit-immutability berörs GRÖN
prov: uppdragsytan-utskick berörs GRÖN
prov: uppdragsytan-godkannandevag berörs GRÖN
prov: adresskontraktet berörs RÖD
prov: bmadglidning berörs RÖD
prov: continuityvakt berörs KUNDE_INTE
prov: gitlas_prov berörs RÖD
prov: gmail_kvitton_farskhet berörs RÖD
prov: projektstyrning berörs RÖD
prov: proxysvep berörs RÖD
prov: reindexfarskhet berörs RÖD
prov: skattepaminnelse_farskhet berörs RÖD
beroende: pg
beroende: express
beroende: vitest
beroende: supertest
tjanst: 127.0.0.1:5433 vitest kör alla prov mot den stående testdatabasen redovisning-vitest-pg
kontrakt: redovisningen funktion deleteDraft prov draft-delete
kontrakt: redovisningen funktion hasBeenVoucherLinked nytt draft-delete
kontrakt: redovisningen funktion ConflictError prov draft-delete
kontrakt: redovisningen funktion executeAction prov invoice-detail
kontrakt: redovisningen funktion errorHandler nytt draft-delete
kontrakt: redovisningen funktion felNotis prov invoice-detail
kontrakt: redovisningen funktion linkVoucher prov voucher-links
kontrakt: redovisningen funktion unlinkVoucher prov voucher-links
kontrakt: redovisningen funktion raderaBilagorForUtkast prov kvittobilagor
kontrakt: redovisningen rutt POST /api/companies/:companyId/actions/delete_draft_invoice prov draft-delete
kontrakt: redovisningen rutt POST /api/companies/:companyId/actions/delete_draft_receipt prov draft-delete
kontrakt: redovisningen rutt POST /api/companies/:companyId/actions/delete_draft_supplier_invoice prov draft-delete
kontrakt: redovisningen rutt POST /api/companies/:companyId/actions/delete_draft_payslip prov draft-delete
kontrakt: redovisningen rutt POST /api/companies/:companyId/actions/post_voucher prov voucher-links
kontrakt: redovisningen rutt POST /api/companies/:companyId/actions/link_voucher prov voucher-links
kontrakt: redovisningen rutt POST /api/companies/:companyId/actions/unlink_voucher prov voucher-links
kontrakt: redovisningen rutt POST /api/companies/:companyId/approvals/:approvalId/approve prov voucher-links
kontrakt: redovisningen rutt POST /api/companies/:companyId/actions/reverse_voucher prov accounting
kontrakt: redovisningen rutt POST /api/companies/:companyId/actions/create_invoice prov draft-delete
kontrakt: redovisningen rutt POST /api/companies/:companyId/actions/create_receipt prov draft-delete
kontrakt: redovisningen rutt POST /api/companies/:companyId/actions/create_supplier prov draft-delete
kontrakt: redovisningen rutt POST /api/companies/:companyId/actions/create_supplier_invoice prov draft-delete
kontrakt: redovisningen rutt POST /api/companies/:companyId/actions/create_employee prov draft-delete
kontrakt: redovisningen rutt POST /api/companies/:companyId/actions/create_payslip prov draft-delete
kontrakt: redovisningen rutt POST /api/companies/:companyId/actions/create_receipt_upload_url prov kvittobilagor
kontrakt: redovisningen rutt POST /api/companies/:companyId/actions/confirm_receipt_file prov kvittobilagor
kontrakt: redovisningen rutt POST /api/companies/:companyId/actions/book_invoice prov draft-delete
kontrakt: redovisningen rutt POST /api/companies/:companyId/actions/book_receipt prov kvittobilagor
kontrakt: redovisningen rutt POST /api/companies/:companyId/actions/book_supplier_invoice prov supplier-invoices
kontrakt: redovisningen rutt POST /api/companies/:companyId/actions/book_payslip prov payroll
kontrakt: redovisningen rutt GET /app/c/:companyId/invoices/:invoiceId prov invoice-detail
kontrakt: redovisningen rutt POST /app/c/:companyId/invoices/:invoiceId/delete prov invoice-detail
kontrakt: redovisningen schema audit_log pr
```

## Utfall
Tester: 164 passed (164) · Granskning: GODKANT | Alla sex acceptanskriterier är implementerade enligt AD-12 utan migration, varje kryssad uppgift finns i koden och de tre fynden är LOW. · Byggforsok: 1

## Modellkedja (Davids krav 17/8, reservvag 7/9)

* krav: **claude-opus-5-5**
* utveckling: **claude-opus-5-5**
* granskning: **claude-opus-5-5 (Codex spärrat — Davids regel 12/10; Codex granskar i efterhand)**

Granskaren ar inte forfattaren: claude-opus-5-5 (Codex spärrat — Davids regel 12/10; Codex granskar i efterhand) granskade claude-opus-5-5s arbete.

Allt pa Davids abonnemang - inga API-tokens.
