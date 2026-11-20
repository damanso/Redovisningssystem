# PRD-bygget redovisningen 1-5-betalmarkering-och-aterstallning-via-baklankning-kraver-davids-ja — PRD redovisningen 1-5-betalmarkering-och-aterstallning-via-baklankning-kraver-davids-ja: # Story 1.5

Datum: 2026-11-20 16:13 · Branch: cto/prd-redovisningen-1-5-betalmarkering-och-aterstallning-via-b-9300 · Kalla: 02-Områden/hermes/prd/redovisningen-1c-prd.md (fryst 29/9, Davids beslut #194)

## Mal
PRD redovisningen 1-5-betalmarkering-och-aterstallning-via-baklankning-kraver-davids-ja: # Story 1.5: Betalmarkering och återställning via baklänkning kräver Davids ja Status: ready-for-dev <!-- Note: Validati

## PRD-kravet (ordagrant ur den frysta PRD:n) och astras kodgranskning
```
# Story 1.5: Betalmarkering och återställning via baklänkning kräver Davids ja

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

Som David,
vill jag att en faktura bara kan markeras som betald, eller få sin betalmarkering borttagen, genom ett förslag jag godkänner, även när det sker genom en baklänkning,
så att registrering av betalning alltid är min bekräftelse (K5), åt båda hållen.

**Kodbas:** redovisning. **Krav:** FR-35 (betalmarkering, återställning och övrig lydelse) och FR-29 (betalmarkering av leverantörsfaktura). FR-8 är redan uppfyllt i koden och står här bara som regressionskrav. Genomförs enligt AD-2 i `_bmad-output/planning-artifacts/architecture.md`. **Beror på:** Story 1.1 (done: förslagskortets etiketter och det härledda etikettprovet finns i kopian). Bygget behöver inget svar från David. En följdfråga som inte spärrar bygget står sist.

**Hålet i dag, i en mening:** `link_voucher` och `unlink_voucher` är vanliga skrivåtgärder (`write`), så en agent kan betalmarkera en kund- eller leverantörsfaktura genom `link_voucher` med `mark_paid: true` och nollställa betalmarkeringen genom `unlink_voucher`, utan att något förslag går genom Att göra (kodgranskningen, FR-35; PRD fråga 10 del 1).

**Lösningen, i en mening:** känsligheten förblir en fast egenskap per åtgärd. Två nya känsliga åtgärder, `link_voucher_and_mark_paid` och `unlink_voucher_and_reset_payment`, bär betalfakta genom kön, medan `link_voucher` avvisar `mark_paid: true` och `unlink_voucher` avvisar en betalmarkerad faktura med felkoden `payment_requires_approval` och en hänvisning i `details` (AD-2).

## Förkrav

```förkrav
fil: server/src/services/voucherLinks.ts ändras
fil: server/src/actions/registry.ts ändras
fil: server/src/services/approvalSummary.ts ändras
fil: server/test/voucher-links.test.ts ändras
fil: server/test/supplier-invoices.test.ts ändras
fil: server/test/forslagskort-klartext.test.ts ändras
fil: server/test/mcp.test.ts ändras
fil: docs/MCP_ACTIONS.md ändras
fil: docs/STATUS.md ändras
fil: server/src/actions/execute.ts läses
fil: server/src/actions/dependencies.ts läses
fil: server/src/lib/errors.ts läses
fil: server/src/lib/validation.ts läses
fil: server/src/http/middleware/errorHandler.ts läses
fil: server/src/http/routes/actions.ts läses
fil: server/src/http/view/routes.ts läses
fil: docs/ACCEPTANS.md läses
fil: server/src/mcp/server.ts läses
fil: server/src/services/draftDelete.ts läses
fil: server/src/services/auditService.ts läses
fil: server/src/services/approvals.ts läses
fil: server/src/domain/money.ts läses
fil: server/migrations/0007_vouchers.sql läses
fil: server/test/actions.test.ts läses
fil: server/test/draft-delete.test.ts läses
fil: server/test/kvittobilagor.test.ts läses
fil: server/test/invoice-detail.test.ts läses
fil: server/test/voucherLinkHelper.ts läses
fil: server/test/uppdragsytan-godkannandevag.test.ts läses
fil: server/test/uppdragsytan-utskick.test.ts läses
fil: server/test/utskickHelper.ts läses
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
fil: _bmad-output/planning-artifacts/epics.md läses
fil: _bmad-output/planning-artifacts/prd.md läses
fil: _bmad-output/planning-artifacts/architecture.md läses
fil: _bmad-output/planning-artifacts/ux-design-specification.md läses
fil: _bmad-output/planning-artifacts/parallelization-analysis.md läses
fil: _bmad-output/planning-artifacts/underlag/kodgranskning.md läses
fil: _bmad-output/planning-artifacts/underlag/davids-svar.md läses
fil: _bmad-output/planning-artifacts/underlag/kedjans-formagor.md läses
fil: _bmad-output/implementation-artifacts/1-1-forslagskortet-visar-posten-i-klartext-utan-uuid-n.md läses
fil: _bmad-output/implementation-artifacts/1-7-en-gang-baklankad-post-kan-aldrig-raderas.md läses
fil: _bmad-output/implementation-artifacts/sprint-status.yaml läses
fil: _bmad/bmm/workflows/4-implementation/dev-story/instructions.xml läses
fil: hermes/skills/cto_utveckling.py läses
fil: hermes/prov/handgrepp.py läses
fil: hermes/prov/continuityvakt.py läses
fil: hermes/prov/overlamningsregister_fr6.py läses
fil: hermes/prov/chattvag_fr1.py läses
fil: hermes/prov/adresskontraktet.py läses
prov: voucher-links ändras GRÖN
prov: supplier-invoices ändras GRÖN
prov: forslagskort-klartext ändras GRÖN
prov: mcp ändras GRÖN
prov: actions berörs GRÖN
prov: draft-delete berörs GRÖN
prov: kvittobilagor berörs GRÖN
prov: invoice-detail berörs GRÖN
prov: uppdragsytan-godkannandevag berörs GRÖN
prov: uppdragsytan-utskick berörs GRÖN
prov: crm-status-link berörs GRÖN
prov: crm-event-provenance berörs GRÖN
prov: crm-views berörs GRÖN
prov: crm-org-name-norm berörs GRÖN
prov: fakturanummer-samtidighet berörs GRÖN
prov: payroll-tax-dublett berörs GRÖN
prov: handgrepp berörs GRÖN
prov: manniskosparr berörs GRÖN
prov: bakvag berörs GRÖN
prov: registreringsurval berörs GRÖN
prov: ovrigtforslag berörs GRÖN
prov: crmintag berörs GRÖN
prov: svepet berörs GRÖN
prov: adresskontraktet berörs RÖD
prov: chattvag_fr1 berörs KUNDE_INTE
prov: continuityvakt berörs KUNDE_INTE
prov: overlamningsregister_fr6 berörs RÖD
beroende: pg
beroende: express
beroende: zod
beroende: zod-to-json-schema
beroende: vitest
beroende: supertest
beroende: tsx
beroende: @modelcontextprotocol/sdk
tjanst: 127.0.0.1:5433 vitest kör alla prov mot den stående testdatabasen redovisning-vitest-pg
kontrakt: redovisningen funktion linkVoucher prov voucher-links
kontrakt: redovisningen funktion unlinkVoucher prov voucher-links
kontrakt: redovisningen funktion rejectPaymentMark nytt voucher-links
kontrakt: redovisningen funktion suggestVoucherLinks prov voucher-links
kontrakt: redovisningen funktion executeAction prov actions
kontrakt: redovisningen funktion approveAction prov voucher-links
kontrakt: redovisningen funktion actionManifest prov actions
kontrakt: redovisningen funktion describeApproval prov forslagskort-klartext
kontrakt: redovisningen funktion explainApproval prov forslagskort-klartext
kontrakt: redovisningen funktion describeFields prov forslagskort-klartext
kontrakt: redovisningen funktion forslagskort prov forslagskort-klartext
kontrakt: redovisningen rutt POST /api/companies/:companyId/actions/link_voucher prov voucher-links
kontrakt: redovisningen rutt POST /api/companies/:companyId/actions/unlink_voucher prov voucher-links
kontrakt: redovisningen rutt POST /api/companies/:companyId/actions/link_voucher_and_mark_paid nytt voucher-links
kontrakt: redovisningen rutt POST /api/companies/:companyId/actions/unlink_voucher_and_reset_payment nytt voucher-links
kontrakt: redovisningen rutt POST /api/companies/:companyId/actions/suggest_voucher_links prov voucher-links
kontrakt: redovisningen rutt POST /api/companies/:companyId/actions/post_voucher prov voucher-links
kontrakt: redovisningen rutt POST /api/companies/:companyId/actions/book_invoice prov voucher-links
kontrakt: redovisningen rutt POST /api/companies/:companyId/actions/register_invoice_payment nytt voucher-links
kontrakt: redovisningen rutt POST /api/companies/:companyId/actions/book_invoice_and_register_payment nytt voucher-links
kontrakt: redovisningen rutt POST /api/companies/:companyId/actions/book_supplier_invoice nytt supplier-invoices
kontrakt: redovisningen rutt POST /api/companies/:companyId/actions/register_supplier_payment nytt supplier-invoices
kontrakt: redovisningen rutt POST /api/companies/:companyId/approvals/:approvalId/approve prov voucher-links
kontrakt: redovisningen rutt POST /api/companies/:companyId/agent-tokens prov actions
kontrakt: redovisningen rutt POST /api/companies/:companyId/invoices/:invoiceId/book prov actions
kontrakt: redovisningen rutt GET /api/companies/:companyId/
```

## Utfall
Tester: 185 passed (185) · Granskning: GODKANT | Alla åtta acceptanskriterier och kryssade uppgifter är implementerade; inga konkreta fynd, och kedjans kontroller är gröna. · Byggforsok: 1

## Modellkedja (Davids krav 17/8, reservvag 7/9)

* krav: kordes inte
* utveckling: **gpt-6.1-sol**
* granskning: **gpt-6-astra**

Granskaren ar inte forfattaren: gpt-6-astra granskade gpt-6.1-sols arbete.

effort (Davids beslut 20/10): create-story high · validering high — planeringssteg
Allt pa Davids abonnemang - inga API-tokens.
