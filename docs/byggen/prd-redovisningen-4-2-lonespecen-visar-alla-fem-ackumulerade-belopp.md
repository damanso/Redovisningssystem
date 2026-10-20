# PRD-bygget redovisningen 4-2-lonespecen-visar-alla-fem-ackumulerade-belopp — PRD redovisningen 4-2-lonespecen-visar-alla-fem-ackumulerade-belopp: # Story 4.2: Lönespecen visar a

Datum: 2026-10-20 20:55 · Branch: cto/prd-redovisningen-4-2-lonespecen-visar-alla-fem-ackumulerade-9250 · Kalla: 02-Områden/hermes/prd/redovisningen-1c-prd.md (fryst 29/9, Davids beslut #194)

## Mal
PRD redovisningen 4-2-lonespecen-visar-alla-fem-ackumulerade-belopp: # Story 4.2: Lönespecen visar alla fem ackumulerade belopp Status: ready-for-dev <!-- Note: Validation is optional. Run 

## PRD-kravet (ordagrant ur den frysta PRD:n) och astras kodgranskning
```
# Story 4.2: Lönespecen visar alla fem ackumulerade belopp

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

Som David,
vill jag att lönespecen visar ackumulerad bruttolön, skatt, nettolön, arbetsgivaravgift och semesterersättning för kalenderåret,
så att dokumentet jag sparar stämmer med systemets lönebesked.

**Kodbas:** redovisning. **Krav:** FR-16 (ackumulerad lön på lönespecen och via `payroll_year_summary`), FR-18 (lönespecens PDF). **Beror på:** inga. Bygget behöver inget svar från David.

**Läget i dag, i tre meningar** (läst 2026-10-20 i kopian av main):
- `payroll_year_summary` ger redan alla fem årssummorna ur lönebeskeden (`payrollYearSummary` i `server/src/services/payroll.ts` rad 452–479).
- Lönespecens PDF räknar ackumuleringen med en egen SQL-fråga som bara summerar brutto och skatt (`generateAndAttachPayslipPdf` i `server/src/services/payslipPdf.ts` rad 176–184), och mallen ritar bara «Ack. Bruttolön», «Ack. Förmån» (alltid 0) och «Ack. Skatt» (rad 133–139). Ett block med rubriken «Ackumulerat {år}» finns inte.
- Bygget låter specen läsa sina belopp ur samma funktion som `payroll_year_summary` och ritar alla fem under rubriken «Ackumulerat {år}».

## Förkrav

```förkrav
fil: server/src/services/payslipPdf.ts ändras
fil: server/src/services/payroll.ts ändras
fil: server/test/payslip-ackumulerat.test.ts ny
fil: docs/MCP_ACTIONS.md ändras
fil: docs/STATUS.md ändras
fil: server/src/actions/registry.ts läses
fil: server/src/actions/execute.ts läses
fil: server/src/services/documents.ts läses
fil: server/src/services/fileStorage.ts läses
fil: server/src/services/auditService.ts läses
fil: server/src/services/agi.ts läses
fil: server/src/domain/taxTable30.ts läses
fil: server/src/domain/bankdays.ts läses
fil: server/src/lib/errors.ts läses
fil: server/test/documents.test.ts läses
fil: server/test/agi.test.ts läses
fil: server/test/payroll-payment.test.ts läses
fil: server/test/payroll.test.ts läses
fil: server/test/payroll-tax.test.ts läses
fil: server/test/payroll-historical.test.ts läses
fil: server/test/payroll-tax-dublett.test.ts läses
fil: server/test/helpers.ts läses
fil: server/test/env.ts läses
fil: server/test/setup.ts läses
fil: server/test/globalSetup.ts läses
fil: server/test/utskickHelper.ts läses
fil: server/test/uppdragsytan-utskick.test.ts läses
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
fil: server/test/acceptans-k2.test.ts läses
fil: _bmad-output/planning-artifacts/epics.md läses
fil: _bmad-output/planning-artifacts/architecture.md läses
fil: _bmad-output/planning-artifacts/prd.md läses
fil: _bmad-output/planning-artifacts/ux-design-specification.md läses
fil: _bmad-output/planning-artifacts/parallelization-analysis.md läses
fil: _bmad-output/planning-artifacts/implementation-readiness-report-2026-10-13.md läses
fil: _bmad-output/planning-artifacts/underlag/kodgranskning.md läses
fil: _bmad-output/planning-artifacts/underlag/davids-svar.md läses
fil: _bmad-output/planning-artifacts/underlag/kedjans-formagor.md läses
fil: _bmad-output/implementation-artifacts/sprint-status.yaml läses
fil: _bmad-output/implementation-artifacts/4-2-lonespecen-visar-alla-fem-ackumulerade-belopp.lardomar.md läses
fil: _bmad-output/implementation-artifacts/1-9-tva-fakturor-kan-aldrig-visa-samma-nummer.md läses
fil: _bmad/bmm/workflows/4-implementation/create-story/checklist.md läses
fil: _bmad/bmm/workflows/4-implementation/dev-story/instructions.xml läses
fil: hermes/skills/cto_utveckling.py läses
fil: hermes/skills/bmad_story.py läses
fil: hermes/prov/continuityvakt.py läses
prov: payslip-ackumulerat nytt GRÖN
prov: documents berörs GRÖN
prov: agi berörs GRÖN
prov: payroll-payment berörs GRÖN
prov: payroll berörs GRÖN
prov: payroll-tax berörs GRÖN
prov: payroll-historical berörs GRÖN
prov: payroll-tax-dublett berörs GRÖN
prov: uppdragsytan-utskick berörs GRÖN
prov: uppdragsytan-undantag berörs GRÖN
prov: uppdragsytan-beslut berörs GRÖN
prov: uppdragsytan-godkannandevag berörs GRÖN
prov: uppdragsytan-baselineorsak berörs GRÖN
prov: continuityvakt berörs KUNDE_INTE
beroende: pg
beroende: pdfkit
beroende: vitest
beroende: supertest
tjanst: 127.0.0.1:5433 vitest kör alla prov mot den stående testdatabasen redovisning-vitest-pg
kontrakt: redovisningen funktion payrollYearSummary prov payroll-payment
kontrakt: redovisningen funktion payrollYearSummary nytt payslip-ackumulerat
kontrakt: redovisningen funktion generatePayslipPdf nytt payslip-ackumulerat
kontrakt: redovisningen funktion generateAndAttachPayslipPdf prov documents
kontrakt: redovisningen funktion generateAndAttachPayslipPdf nytt payslip-ackumulerat
kontrakt: redovisningen funktion pdfText prov documents
kontrakt: redovisningen funktion registerUser prov documents
kontrakt: redovisningen funktion createCompany prov documents
kontrakt: redovisningen rutt POST /api/auth/register prov documents
kontrakt: redovisningen rutt POST /api/companies prov documents
kontrakt: redovisningen rutt POST /api/companies/:companyId/actions/generate_payslip_pdf prov documents
kontrakt: redovisningen rutt POST /api/companies/:companyId/actions/payroll_year_summary prov payroll-payment
kontrakt: redovisningen rutt POST /api/companies/:companyId/actions/create_employee prov documents
kontrakt: redovisningen rutt POST /api/companies/:companyId/actions/create_payslip prov payroll-payment
kontrakt: redovisningen rutt POST /api/companies/:companyId/actions/get_document prov documents
kontrakt: redovisningen rutt POST /api/companies/:companyId/actions/list_payslips prov documents
kontrakt: redovisningen rutt POST /app/login prov documents
kontrakt: redovisningen rutt GET /app/c/:companyId/payroll prov documents
kontrakt: redovisningen schema payslips prov payroll-payment
kontrakt: redovisningen schema documents prov documents
kommando: git status --porcelain -- server/src/services/payslipPdf.ts server/src/services/payroll.ts server/test/payslip-ackumulerat.test.ts docs/MCP_ACTIONS.md docs/STATUS.md
kommando: npm run typecheck
kommando: npm run build
kommando: npm test
kommando: npm run test -w server -- test/payslip-ackumulerat.test.ts
kommando: npm run test -w server -- test/documents.test.ts
kommando: npm run test -w server -- test/agi.test.ts
kommando: npm run test -w server -- test/payroll-payment.test.ts
kommando: npm run test -w server -- test/payroll.test.ts test/payroll-tax.test.ts test/payroll-historical.test.ts test/payroll-tax-dublett.test.ts
```

## Acceptance Criteria

Kriterierna står ordagrant som i `_bmad-output/planning-artifacts/epics.md` (Story 4.2, rad 1219–1241). Raderna *Mätbart (berättelsen)* säger hur kriteriet uppfylls och visas: mekanismen som gör det sant genom konstruktion och den ändliga listan av fall som proven prövar. Ingen rad ändrar ett kriteriums innebörd. Fallens id (P1, A1, A2, A3, B1) står först i titlarna i den nya provfilen `server/test/payslip-ackumulerat.test.ts`. Facit står i Dev Notes → Facit.

1. **Given** tre lönebesked för 2026 med semesterersättning i två av dem
   **When** lönespecens PDF för det tredje genereras
   **Then** blocket "Ackumulerat 2026" visar brutto 181 280 kr, skatt 12 943 + 16 343 + 15 443 kr, semesterersättning 6 780 + 5 000 kr, och netto och arbetsgivaravgift som summan av årets lönebesked till och med det aktuella
   **And** samma fem belopp ger `payroll_year_summary` för 2026

   *Mätbart (berättelsen):*
   - **Mekanismen är en enda väg in till beloppen.** Efter bygget räknas lönespecens ackumulering bara i `payrollYe
```

## Utfall
Tester: 169 passed (169) · Granskning: GODKANT | Alla tre acceptanskriterier är implementerade och varje kryssad uppgift finns i koden; enda fyndet är LOW och gäller en text som lovar mer än koden håller. · Byggforsok: 1

## Modellkedja (Davids krav 17/8, reservvag 7/9)

* krav: **claude-opus-5-5**
* utveckling: **claude-opus-5-5**
* granskning: **claude-opus-5-5 (Codex spärrat — Davids regel 12/10; Codex granskar i efterhand)**

Granskaren ar inte forfattaren: claude-opus-5-5 (Codex spärrat — Davids regel 12/10; Codex granskar i efterhand) granskade claude-opus-5-5s arbete.

effort (Davids beslut 20/10): create-story high · validering high · bygg xhigh · granskning xhigh — riskdel redovisningen
Allt pa Davids abonnemang - inga API-tokens.
