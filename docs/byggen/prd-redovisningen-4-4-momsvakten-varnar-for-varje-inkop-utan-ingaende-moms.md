# PRD-bygget redovisningen 4-4-momsvakten-varnar-for-varje-inkop-utan-ingaende-moms — PRD redovisningen 4-4-momsvakten-varnar-for-varje-inkop-utan-ingaende-moms: # Story 4.4: Momsvakten 

Datum: 2026-10-21 01:58 · Branch: cto/prd-redovisningen-4-4-momsvakten-varnar-for-varje-inkop-utan-9252 · Kalla: 02-Områden/hermes/prd/redovisningen-1c-prd.md (fryst 29/9, Davids beslut #194)

## Mal
PRD redovisningen 4-4-momsvakten-varnar-for-varje-inkop-utan-ingaende-moms: # Story 4.4: Momsvakten varnar för varje inköp utan ingående moms Status: ready-for-dev <!-- Note: Validation is optiona

## PRD-kravet (ordagrant ur den frysta PRD:n) och astras kodgranskning
```
# Story 4.4: Momsvakten varnar för varje inköp utan ingående moms

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

Som David,
vill jag få en varning så fort ruta 48 är 0 trots inköp på konton 5000–6999, oavsett belopp,
så att en deklaration som underrapporterar avdraget aldrig ser komplett ut.

**Kodbas:** redovisning. **Krav:** FR-19 (kompletthetsvakten; regression för övrig lydelse utom de nollsatta rutorna). **Arkitektur:** AD-15 (beräkningsrättelser i befintliga tjänster). **Beror på:** inga. Bygget behöver inget svar från David.

**Läget i dag, i tre meningar** (läst 2026-10-21 i kopian av main, `server/src/services/vatDeclaration.ts` med sha256 a70d2bba8a76…):
- Kompletthetsvakten finns redan i `vatDeclaration` i `server/src/services/vatDeclaration.ts`: den räknar debetsaldot på konton 5000–6999 (`deductibleCostDebit`, rad 100) och lägger en text i `warnings` när ingående moms (ruta 48, `inVat`) är 0.
- Men den varnar bara när inköpen är minst 5 000 kr, eftersom villkoret på rad 103 jämför med konstanten `INPUT_VAT_ALERT_THRESHOLD_ORE = 5000_00` (rad 102). En period med inköp för 100 kr och ruta 48 = 0 ger alltså ingen varning, vilket kodgranskningen pekar ut för FR-19.
- Bygget lyfter villkoret till en ren, exporterad funktion utan tröskel (varning exakt när ruta 48 är 0 och inköpen är större än 0), låter `vatDeclaration` använda den och tar bort konstanten. Varningen visar beloppet i kronor och ören, så att också ett inköp under en krona syns med sitt belopp.

## Förkrav

```förkrav
fil: server/src/services/vatDeclaration.ts ändras
fil: server/test/vat-declaration.test.ts ändras
fil: docs/MCP_ACTIONS.md ändras
fil: docs/STATUS.md ändras
fil: server/src/domain/money.ts läses
fil: server/src/services/reports.ts läses
fil: server/src/services/accounting/vouchers.ts läses
fil: server/src/actions/registry.ts läses
fil: server/src/http/view/routes.ts läses
fil: server/src/http/routes/actions.ts läses
fil: server/src/actions/execute.ts läses
fil: server/migrations/0042_vat_method.sql läses
fil: server/src/lib/validation.ts läses
fil: server/test/voucher-links.test.ts läses
fil: server/test/f-tax-reverse-charge.test.ts läses
fil: server/test/domain.test.ts läses
fil: server/test/helpers.ts läses
fil: server/test/env.ts läses
fil: server/test/setup.ts läses
fil: server/test/globalSetup.ts läses
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
fil: _bmad-output/implementation-artifacts/4-4-momsvakten-varnar-for-varje-inkop-utan-ingaende-moms.lardomar.md läses
fil: _bmad-output/implementation-artifacts/4-3-agenten-kan-bifoga-dokument-upp-till-10-mb.md läses
fil: _bmad/bmm/workflows/4-implementation/create-story/checklist.md läses
fil: hermes/skills/cto_utveckling.py läses
fil: hermes/skills/bmad_story.py läses
prov: vat-declaration ändras GRÖN
prov: voucher-links berörs GRÖN
prov: f-tax-reverse-charge berörs GRÖN
prov: domain berörs GRÖN
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
kontrakt: redovisningen funktion vatDeclaration prov vat-declaration
kontrakt: redovisningen funktion formatOre prov domain
kontrakt: redovisningen funktion accountSums prov vat-declaration
kontrakt: redovisningen rutt POST /api/companies/:companyId/actions/vat_declaration prov vat-declaration
kontrakt: redovisningen rutt POST /api/companies/:companyId/actions/post_voucher prov vat-declaration
kontrakt: redovisningen rutt POST /api/companies/:companyId/approvals/:id/approve prov vat-declaration
kontrakt: redovisningen rutt POST /api/companies/:companyId/accounting/fiscal-years prov vat-declaration
kontrakt: redovisningen rutt POST /api/companies/:companyId/actions/set_vat_method prov voucher-links
kontrakt: redovisningen rutt GET /app/c/:companyId/vat prov vat-declaration
kontrakt: redovisningen funktion registerUser prov vat-declaration
kontrakt: redovisningen funktion createCompany prov vat-declaration
kontrakt: redovisningen funktion createFiscalYear prov f-tax-reverse-charge
kontrakt: redovisningen funktion withAdmin prov voucher-links
kontrakt: redovisningen schema vouchers prov vat-declaration
kontrakt: redovisningen schema audit_log prov voucher-links
kommando: git status --porcelain -- server/src/services/vatDeclaration.ts server/test/vat-declaration.test.ts docs/MCP_ACTIONS.md docs/STATUS.md
kommando: npm run typecheck
kommando: npm run build
kommando: npm test
kommando: npm run test -w server -- test/vat-declaration.test.ts
kommando: npm run test -w server -- test/voucher-links.test.ts test/f-tax-reverse-charge.test.ts test/domain.test.ts
kommando: npm run test -w server -- test/uppdragsytan-utskick.test.ts test/uppdragsytan-beslut.test.ts test/uppdragsytan-undantag.test.ts test/uppdragsytan-baselineorsak.test.ts test/uppdragsytan-godkannandevag.test.ts
```

## Acceptance Criteria

Kriterierna står ordagrant som i `_bmad-output/planning-artifacts/epics.md` (Story 4.4, rad 1283–1313). Raderna *Mätbart (berättelsen)* säger hur kriteriet uppfylls och visas: mekanismen som gör det sant genom konstruktion och den ändliga listan av fall som proven prövar. Ingen rad ändrar ett kriteriums innebörd. Alla nya fall står i `server/test/vat-declaration.test.ts`, med sitt id först i titeln (F1–F6, V1–V4, K1, R1). Fallistorna står i Dev Notes → Fallistor. Radnummer i provfilen och källfilen gäller filerna **före bygget** (sha256 i Dev Notes); bygget flyttar dem, så ankaret är fallets titel eller funktionens namn.

1. **Given** en momsperiod med inköp på konton 5000–6999 om 100 kr och ruta 48 lika med 0
   **When** `vat_declaration` läses
   **Then** svaret bär varningen om att ingående moms är 0 trots inköp, med beloppet

   *Mätbart (berättelsen):*
   - **Mekanismen är en enda regel.** Villkoret och texten bor i den exporterade rena funktionen `inputVatCompletenessWarning(inputVatOre, purchasesOre)` i `server/src/services/vatDeclaration.ts`. Den ger varningstexten exakt när `inputVatOre` är 0 och `purchasesOre` är större än 0, och annars `null`. `vatDeclaration` anropar den en gång, alltid, med `inVat` och `deductibleCostDebit`, och lägger texten i `warnings` när den inte är `null`. Ingen annan kod i filen lägger något i `warnings`.
   - **Beloppet** skrivs med `formatOre(purchasesOre, { currency: true })` ur `server/src/domain/money.ts`, alltså «100,00 kr» för 100 kr och «0,01 kr» för ett öre. Textens början «Ingående moms (ruta 48) är 0» står kvar som i dag, eftersom det befintliga fallet på rad 177 läser den.
   - **Fallis
```

## Utfall
Tester: 169 passed (169) · Granskning: GODKANT | Alla fem acceptanskriterier är implementerade, varje kryssad uppgift finns i koden, kedjans körning gav 169 av 169 testfiler gröna och det enda fyndet är LOW. · Byggforsok: 1

## Modellkedja (Davids krav 17/8, reservvag 7/9)

* krav: **claude-opus-5-5**
* utveckling: **claude-opus-5-5**
* granskning: **claude-opus-5-5 (Codex spärrat — Davids regel 12/10; Codex granskar i efterhand)**

Granskaren ar inte forfattaren: claude-opus-5-5 (Codex spärrat — Davids regel 12/10; Codex granskar i efterhand) granskade claude-opus-5-5s arbete.

effort (Davids beslut 20/10): create-story high · validering high · bygg xhigh · granskning xhigh — riskdel redovisningen
Allt pa Davids abonnemang - inga API-tokens.
