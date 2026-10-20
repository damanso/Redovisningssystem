# PRD-bygget redovisningen 2-5-kravfilen-sager-bruttometod-fran-september-2026 — PRD redovisningen 2-5-kravfilen-sager-bruttometod-fran-september-2026: # Story 2.5: Kravfilen säger 

Datum: 2026-10-20 15:27 · Branch: cto/prd-redovisningen-2-5-kravfilen-sager-bruttometod-fran-septe-9248 · Kalla: 02-Områden/hermes/prd/redovisningen-1c-prd.md (fryst 29/9, Davids beslut #194)

## Mal
PRD redovisningen 2-5-kravfilen-sager-bruttometod-fran-september-2026: # Story 2.5: Kravfilen säger bruttometod från september 2026 Status: ready-for-dev <!-- Note: Validation is optional. Ru

## PRD-kravet (ordagrant ur den frysta PRD:n) och astras kodgranskning
```
# Story 2.5: Kravfilen säger bruttometod från september 2026

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

Som David,
vill jag att kravfilen beskriver lönebokföringen som koden faktiskt gör den,
så att nästa läsare som bara läser ACCEPTANS inte får fel svar.

**Kodbas:** redovisning. **Krav:** FR-17 (PRD §6 lucka 2: rättelseuppdraget för ACCEPTANS K2). **Beror på:** inga. Bygget behöver inget svar från David.

**Hålet i dag, i en mening:** raden K2 i `docs/ACCEPTANS.md` (rad 126) står som grindad och godkänd acceptans med «book_payslip kontantmetod 7010 D / 1930 K = verkligt netto» och «book_payroll_tax 2510 D / 1930 K», medan koden sedan beslut #107 (LOC-355, i drift sedan 2026-09-03) bokför perioder från och med 2026-09 med bruttometoden och skuldkontona 2710 och 2731 (`GROSS_METHOD_FROM_PERIOD` och `usesGrossMethod` i `server/src/services/payroll.ts` rad 37–42; grenarna i `bookPayslip` rad 315 och `bookPayrollTax` rad 411).

**Vad bygget gör:** ett nytt namngivet testfall i payroll-sviten prövar båda grenarna i ett och samma fall, K2-raden skrivs om och pekar på just det fallet, och ett nytt dokumentprov fäller den gamla radtexten. Ingen produktionskod ändras.

## Förkrav

```förkrav
fil: docs/ACCEPTANS.md ändras
fil: server/test/payroll-payment.test.ts ändras
fil: server/test/acceptans-k2.test.ts ny
fil: docs/STATUS.md ändras
fil: server/src/services/payroll.ts läses
fil: server/src/domain/bankdays.ts läses
fil: server/test/helpers.ts läses
fil: server/test/env.ts läses
fil: server/test/setup.ts läses
fil: server/test/globalSetup.ts läses
fil: server/test/payroll-tax-dublett.test.ts läses
fil: server/test/fakturanummer-samtidighet.test.ts läses
fil: server/test/draft-delete.test.ts läses
fil: server/test/payroll.test.ts läses
fil: server/test/payroll-historical.test.ts läses
fil: server/test/payroll-tax.test.ts läses
fil: server/vitest.config.ts läses
fil: server/tsconfig.json läses
fil: server/tsconfig.test.json läses
fil: server/package.json läses
fil: package.json läses
fil: CLAUDE.md läses
fil: docs/ARKITEKTUR.md läses
fil: docs/project-context.md läses
fil: docs/MCP_ACTIONS.md läses
fil: hermes/prov/continuityvakt.py läses
fil: hermes/skills/statussiffror.py läses
fil: hermes/skills/cto_utveckling.py läses
prov: payroll-payment ändras GRÖN
prov: acceptans-k2 nytt GRÖN
prov: payroll-tax-dublett berörs GRÖN
prov: fakturanummer-samtidighet berörs GRÖN
prov: draft-delete berörs GRÖN
prov: payroll berörs GRÖN
prov: payroll-historical berörs GRÖN
prov: payroll-tax berörs GRÖN
prov: continuityvakt berörs KUNDE_INTE
beroende: vitest
beroende: supertest
beroende: pg
beroende: node:fs/promises
tjanst: 127.0.0.1:5433 vitest kör proven mot den stående testdatabasen redovisning-vitest-pg
kontrakt: redovisningen fil docs/ACCEPTANS.md nytt acceptans-k2
kontrakt: redovisningen fil server/test/payroll-payment.test.ts nytt acceptans-k2
kontrakt: redovisningen fil docs/ACCEPTANS.md prov continuityvakt
kontrakt: redovisningen fil docs/STATUS.md prov continuityvakt
kontrakt: redovisningen funktion bookPayslip prov payroll-payment
kontrakt: redovisningen funktion bookPayrollTax prov payroll-payment
kontrakt: redovisningen funktion usesGrossMethod prov payroll-payment
kontrakt: redovisningen funktion registerUser prov payroll-payment
kontrakt: redovisningen funktion createCompany prov payroll-payment
kontrakt: redovisningen funktion createFiscalYear prov payroll-payment
kontrakt: redovisningen funktion withAdmin prov payroll-payment
kontrakt: redovisningen rutt POST /api/companies prov payroll-payment
kontrakt: redovisningen rutt POST /api/companies/:companyId/accounting/fiscal-years prov payroll-payment
kontrakt: redovisningen rutt POST /api/companies/:companyId/actions/create_employee prov payroll-payment
kontrakt: redovisningen rutt POST /api/companies/:companyId/actions/create_payslip prov payroll-payment
kontrakt: redovisningen rutt POST /api/companies/:companyId/actions/book_payslip prov payroll-payment
kontrakt: redovisningen rutt POST /api/companies/:companyId/actions/book_payroll_tax prov payroll-payment
kontrakt: redovisningen rutt POST /api/companies/:companyId/approvals/:id/approve prov payroll-payment
kontrakt: redovisningen schema voucher_lines prov payroll-payment
kommando: npm run typecheck
kommando: npm run build
kommando: npm test
kommando: npm run test -w server -- test/payroll-payment.test.ts
kommando: npm run test -w server -- test/acceptans-k2.test.ts
```

## Acceptance Criteria

Kriterierna står ordagrant som i epics.md (Story 2.5). Raderna *Mätbart (berättelsen)* säger hur kriteriet uppfylls och visas: mekanismen som gör det sant genom konstruktion och den ändliga listan av fall som proven prövar. Ingen rad ändrar ett kriteriums innebörd. Fallens id (B1, A1–A3) står först i provens titlar, utom B1, vars titel är det namn K2-raden citerar (Dev Notes → Testkrav).

1. **Given** raden K2 i `docs/ACCEPTANS.md` (i dag "book_payslip kontantmetod 7010 D / 1930 K = verkligt netto")
   **When** raden skrivs om
   **Then** den anger bruttometod med skuldkonton (2710 skatt, 2731 arbetsgivaravgift) för perioder från och med 2026-09 och kontantmetod (7010 D / 1930 K = verkligt netto) för tidigare perioder, med beslut #107 som källa och testsviten som prövar båda grenarna
   **And** övriga rader i ACCEPTANS ändras inte

   *Mätbart (berättelsen):*
   - **Innehållet** prövas av den rena funktionen `k2Brister(rad, payrollKalla)` i `server/test/acceptans-k2.test.ts`. Den returnerar i fast ordning namnen på de delar som saknas ur en ändlig lista om nio: `bruttometod`, `2026-09`, `2710`, `2731`, `kontantmetod`, `7010 D / 1930 K = verkligt netto`, `#107`, `` `payroll-payment` `` och `testfallet`. Den sista delen kräver exakt ett citat «…» i raden och att källtexten till `server/test/payroll-payment.test.ts` innehåller `it('` direkt följt av citatets text och ett `'`.
   - **«Övriga rader ändras inte» är sant genom konstruktion, en enda väg in:** ändringen görs med en enda Edit vars gamla text är hela den gamla K2-raden (en rad, unik i filen) och vars nya text är en rad. Ingen annan rad i filen redigeras, och ingen formatering eller städning görs i förbifarten. Det visas på två sätt: fall A1 kräver att exakt en rad i filen börjar med `| K2 |` och att den gamla radtexten inte längre finns i filen, och diffen för `docs/ACCEPTANS.md` från merge-basen till bygget (`git diff main...{grenen} -- docs/ACCEPTANS.md`, tre punkter) har exakt en borttagen och en tillagd rad, som granskningen prövar mot diffen. Tre punkter, eftersom Hermes skript `hermes/skills/statussiffror.py` kan committa en ny rad 8 (testantalet) på main medan bygget pågår; den ändringen hör inte till bygget. Proven söker inte igenom filen efter andra ändringar.
   - **Fallistan:** A1 (den verkliga filen ger inga brister och har exakt en K2-rad), A2 (den gamla radtexten ger exakt bristerna `bruttometod`, `2026-09`, `2710`, `2731`, `#107` och `testfallet`) och A3 (en rad med rätt text men ett citat som inte är ett testfall i sviten ger exakt bristen `testfallet`).

2. **Given** payroll-sviten
   **When** `npm test` körs
   **Then** ett namngivet testfall visar att period 2026-08 bokförs med kontantmetoden och period 2026-09 med bruttometoden, och det är det testfall K2-raden pekar på

   *Mätbart (berättelsen):*
   - **Fallet** är B1 i `server/test/payroll-payment.test.ts`, med titeln ordagrant «K2 brytpunkten: 2026-08 bokförs med kontantmetoden och 2026-09 med bruttometoden». Det står i ett eget `describe` sist i filen, med ett eget bolag, så att det inte beror på eller påverkar filens övriga fall.
   - **Vad fallet visar**, med exakta rader i varje verifikat: lönen för 2026-08 bokförs med två rader (7010 D netto, 1930 K netto), skattekontobetalningen för 2026-08 med 2510 D och 1930 K, lönen för 2026-09 med fem rader (7010 D brutto, 7510 D avgift, 2710 K skatt, 2731 K avgift, 1930 K netto) och skattekontobetalning
```

## Utfall
Tester: 167 passed (167) · Granskning: GODKANT | Alla tre kriterier är implementerade och ingår i kedjans gröna körning (167/167), och granskningen hittade inget HIGH eller MEDIUM, bara ett LOW. · Byggforsok: 1

## Modellkedja (Davids krav 17/8, reservvag 7/9)

* krav: **claude-opus-5-5**
* utveckling: **claude-opus-5-5**
* granskning: **claude-opus-5-5 (Codex spärrat — Davids regel 12/10; Codex granskar i efterhand)**

Granskaren ar inte forfattaren: claude-opus-5-5 (Codex spärrat — Davids regel 12/10; Codex granskar i efterhand) granskade claude-opus-5-5s arbete.

effort (Davids beslut 20/10): create-story high · validering high · bygg xhigh · granskning xhigh — riskdel redovisningen
Allt pa Davids abonnemang - inga API-tokens.
