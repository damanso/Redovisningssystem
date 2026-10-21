# PRD-bygget redovisningen 4-3-agenten-kan-bifoga-dokument-upp-till-10-mb — PRD redovisningen 4-3-agenten-kan-bifoga-dokument-upp-till-10-mb: # Story 4.3: Agenten kan bifoga do

Datum: 2026-10-21 01:05 · Branch: cto/prd-redovisningen-4-3-agenten-kan-bifoga-dokument-upp-till-1-9251 · Kalla: 02-Områden/hermes/prd/redovisningen-1c-prd.md (fryst 29/9, Davids beslut #194)

## Mal
PRD redovisningen 4-3-agenten-kan-bifoga-dokument-upp-till-10-mb: # Story 4.3: Agenten kan bifoga dokument upp till 10 MB Status: ready-for-dev <!-- Note: Validation is optional. Run val

## PRD-kravet (ordagrant ur den frysta PRD:n) och astras kodgranskning
```
# Story 4.3: Agenten kan bifoga dokument upp till 10 MB

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

Som David,
vill jag att agenten kan bifoga ett dokument på upp till 10 MB till en post,
så att giltiga PDF:er inte stoppas av en teknisk gräns innan systemet ens prövat dem.

**Kodbas:** redovisning. **Krav:** FR-18 (dokumentkopplingen K3, hela lydelsen). **Arkitektur:** AD-10. **Beror på:** inga. Bygget behöver inget svar från David.

**Läget i dag, i tre meningar** (läst 2026-10-21 i kopian av main):
- Tjänsten tar redan emot 10 MB: `attachDocument` i `server/src/services/documents.ts` (rad 80–112) avvisar en fil över `MAX_DOCUMENT_BYTES` (rad 24, 10 485 760 byte) med 400 `too_large`, och registrets schema för `attach_document` släpper igenom base64 upp till 15 000 000 tecken (`server/src/actions/registry.ts` rad 528–546).
- Men HTTP-lagret läser varje JSON-kropp med den globala parsern `express.json({ limit: '1mb' })` (`server/src/http/app.ts` rad 54) innan autentiseringen, så en fil större än omkring 770 kB (1 MB base64) får 413 och når aldrig tjänsten (kodgranskningen, FR-18).
- Bygget låter just åtgärdsrutten för `attach_document` hoppa över den globala parsern och ger den en egen parser, vars gräns räknas ur `MAX_DOCUMENT_BYTES` och som monteras först efter autentisering och bolagsåtkomst. Allt annat behåller 1 MB.

## Förkrav

```förkrav
fil: server/src/services/documents.ts ändras
fil: server/src/http/routes/actions.ts ändras
fil: server/src/http/app.ts ändras
fil: server/test/documents.test.ts ändras
fil: docs/MCP_ACTIONS.md ändras
fil: docs/STATUS.md ändras
fil: server/src/http/routes/companies.ts läses
fil: server/src/http/routes/receiptFiles.ts läses
fil: server/src/http/routes/auth.ts läses
fil: server/src/http/middleware/companyAccess.ts läses
fil: server/src/http/middleware/authenticate.ts läses
fil: server/src/http/middleware/errorHandler.ts läses
fil: server/src/http/view/routes.ts läses
fil: server/src/actions/registry.ts läses
fil: server/src/actions/execute.ts läses
fil: server/src/services/fileStorage.ts läses
fil: server/src/lib/validation.ts läses
fil: server/src/lib/errors.ts läses
fil: server/src/lib/upload.ts läses
fil: server/src/mcp/server.ts läses
fil: server/src/config.ts läses
fil: server/src/db/pool.ts läses
fil: server/test/helpers.ts läses
fil: server/test/env.ts läses
fil: server/test/setup.ts läses
fil: server/test/globalSetup.ts läses
fil: server/test/draft-delete.test.ts läses
fil: server/test/non-deductible-accounts.test.ts läses
fil: server/test/allowlist.test.ts läses
fil: server/test/upload.test.ts läses
fil: server/test/actions.test.ts läses
fil: server/test/tenant-isolation.test.ts läses
fil: server/test/uppdragsytan-utskick.test.ts läses
fil: server/test/utskickHelper.ts läses
fil: server/test/uppdragsytan-undantag.test.ts läses
fil: server/test/uppdragsytan-beslut.test.ts läses
fil: server/test/uppdragsytan-godkannandevag.test.ts läses
fil: server/test/uppdragsytan-baselineorsak.test.ts läses
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
fil: _bmad-output/planning-artifacts/underlag/kedjans-formagor.md läses
fil: _bmad-output/implementation-artifacts/sprint-status.yaml läses
fil: _bmad-output/implementation-artifacts/4-3-agenten-kan-bifoga-dokument-upp-till-10-mb.lardomar.md läses
fil: _bmad-output/implementation-artifacts/4-2-lonespecen-visar-alla-fem-ackumulerade-belopp.md läses
fil: _bmad/bmm/workflows/4-implementation/create-story/checklist.md läses
fil: hermes/skills/cto_utveckling.py läses
fil: hermes/skills/bmad_story.py läses
prov: documents ändras GRÖN
prov: allowlist berörs GRÖN
prov: upload berörs GRÖN
prov: actions berörs GRÖN
prov: tenant-isolation berörs GRÖN
prov: draft-delete berörs GRÖN
prov: non-deductible-accounts berörs GRÖN
prov: uppdragsytan-utskick berörs GRÖN
prov: uppdragsytan-undantag berörs GRÖN
prov: uppdragsytan-beslut berörs GRÖN
prov: uppdragsytan-godkannandevag berörs GRÖN
prov: uppdragsytan-baselineorsak berörs GRÖN
prov: adresskontraktet berörs RÖD
prov: brieflankar berörs KUNDE_INTE
prov: continuityvakt berörs KUNDE_INTE
prov: crmintag berörs RÖD
prov: kartan berörs KUNDE_INTE
prov: redovisning_fortroende berörs KUNDE_INTE
prov: startsida_prov berörs KUNDE_INTE
beroende: express
beroende: zod
beroende: pg
beroende: vitest
beroende: supertest
tjanst: 127.0.0.1:5433 vitest kör alla prov mot den stående testdatabasen redovisning-vitest-pg
kontrakt: redovisningen rutt POST /api/companies/:companyId/actions/attach_document prov documents
kontrakt: redovisningen rutt POST /api/companies/:companyId/actions/list_documents prov documents
kontrakt: redovisningen rutt POST /api/companies/:companyId/actions/get_document prov documents
kontrakt: redovisningen rutt POST /api/companies/:companyId/actions/set_company_logo nytt documents
kontrakt: redovisningen rutt PATCH /api/companies/:companyId prov allowlist
kontrakt: redovisningen rutt PATCH /api/companies/:companyId prov documents
kontrakt: redovisningen rutt POST /api/auth/login nytt documents
kontrakt: redovisningen rutt POST /api/auth/register prov documents
kontrakt: redovisningen rutt POST /api/companies prov documents
kontrakt: redovisningen rutt POST /api/companies/:companyId/agent-tokens prov documents
kontrakt: redovisningen rutt POST /api/companies/:companyId/actions/create_employee prov documents
kontrakt: redovisningen rutt POST /api/companies/:companyId/actions/create_payslip prov documents
kontrakt: redovisningen rutt POST /api/companies/:companyId/accounting/fiscal-years prov draft-delete
kontrakt: redovisningen rutt POST /api/companies/:companyId/actions/create_customer prov draft-delete
kontrakt: redovisningen rutt POST /api/companies/:companyId/actions/create_invoice prov draft-delete
kontrakt: redovisningen rutt POST /api/companies/:companyId/actions/create_receipt prov draft-delete
kontrakt: redovisningen rutt POST /api/companies/:companyId/actions/create_supplier prov draft-delete
kontrakt: redovisningen rutt POST /api/companies/:companyId/actions/create_supplier_invoice prov draft-delete
kontrakt: redovisningen rutt POST /api/companies/:companyId/actions/post_voucher prov non-deductible-accounts
kontrakt: redovisningen rutt POST /api/companies/:companyId/approvals/:id/approve prov non-deductible-accounts
kontrakt: redovisningen funktion attachDocument prov documents
kontrakt: redovisningen funktion executeAction prov actions
kontrakt: redovisningen funktion validateUpload prov documents
kontrakt: redovisningen funktion isAttachDocumentRequest nytt documents
kontrakt: redovisningen funktion authenticate prov tenant-isolation
kontrakt: redovisningen funktion requireCompanyAccess prov tenant-isolation
kontrakt: redovisningen funktion errorHandler prov allowlist
kontrakt: redovisningen funktion registerUser prov documents
kontrakt: redovisningen funktion createCompany prov documents
kontrakt: redovisningen funktion createFiscalYear prov draft-delete
kontrakt: redovisningen funktion withAdmin prov draft-delete
kontrakt: redovisningen schema documents prov documents
kontrakt: redovisningen schema files prov documents
kontrakt: redovisningen schema audit_log prov documents
kontrakt: redovisningen schema vouchers prov non-deductible-accounts
kontrakt: redovisningen schema p
```

## Utfall
Tester: 169 passed (169) · Granskning: GODKANT | Alla sju acceptanskriterier finns i koden med prov som kedjans gröna körning omfattar (typecheck och 169 av 169), och jag hittade inga fynd av någon allvarlighetsgrad. Berättelsen hade inga  · Byggforsok: 2

## Modellkedja (Davids krav 17/8, reservvag 7/9)

* krav: **claude-opus-5-5**
* utveckling: **claude-opus-5-5**
* granskning: **claude-opus-5-5 (Codex spärrat — Davids regel 12/10; Codex granskar i efterhand)**

Granskaren ar inte forfattaren: claude-opus-5-5 (Codex spärrat — Davids regel 12/10; Codex granskar i efterhand) granskade claude-opus-5-5s arbete.

effort (Davids beslut 20/10): create-story high · validering high · bygg xhigh · granskning xhigh — riskdel redovisningen
Allt pa Davids abonnemang - inga API-tokens.
