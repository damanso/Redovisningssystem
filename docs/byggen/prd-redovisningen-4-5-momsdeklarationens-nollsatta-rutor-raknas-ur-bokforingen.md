# PRD-bygget redovisningen 4-5-momsdeklarationens-nollsatta-rutor-raknas-ur-bokforingen — PRD redovisningen 4-5-momsdeklarationens-nollsatta-rutor-raknas-ur-bokforingen: # Story 4.5: Momsdek

Datum: 2026-10-22 02:16 · Branch: cto/prd-redovisningen-4-5-momsdeklarationens-nollsatta-rutor-rak-9260 · Kalla: 02-Områden/hermes/prd/redovisningen-1c-prd.md (fryst 29/9, Davids beslut #194)

## Mal
PRD redovisningen 4-5-momsdeklarationens-nollsatta-rutor-raknas-ur-bokforingen: # Story 4.5: Momsdeklarationens nollsatta rutor räknas ur bokföringen Status: ready-for-dev <!-- Note: Validation is opt

## PRD-kravet (ordagrant ur den frysta PRD:n) och astras kodgranskning
```
# Story 4.5: Momsdeklarationens nollsatta rutor räknas ur bokföringen

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

Som David,
vill jag att varje ruta i momsdeklarationen räknas ur bokföringen, också de som i dag alltid är noll,
så att filen jag lämnar till Skatteverket är komplett.

**Kodbas:** redovisning. **Krav:** FR-19 (alla rutor 05–49 direkt ur bokföringen). **Arkitektur:** AD-15 (beräkningsrättelser i befintliga tjänster), AD-8 (förslagskortets text i `server/src/services/approvalSummary.ts`), AD-13 (RLS med FORCE på varje bolagstabell). **Beror på:** Story 4.4 (done).

**Davids svar gäller som beslut** (`_bmad-output/planning-artifacts/underlag/davids-svar.md`, FR-19, 2026-10-16, «Ja»): Hermes tar fram vilka konton i Locollabs faktiska kontoplan som hör till rutorna 06–08, 20, 22–24, 37–38 och 40, lägger listan till David för ett ja, och David godkänner listan en gång. Rutor som Locollabs inte har affärer i står kvar som noll. Berättelsen bygger alltså **vägen för listan**, inte listan själv: ingen kontolista skrivs in i koden, eftersom bygget sker i en kopia som varken ser Locollabs kontoplan eller bokföring (kedjan cto har «nat: nej» och «sockel: nej» utom testdatabasen, `_bmad-output/planning-artifacts/underlag/kedjans-formagor.md`).

**Läget i dag** (läst 2026-10-21 i kopian av main, `server/src/services/vatDeclaration.ts` med 163 rader och sha256 d352c55520eb…):
- `vatDeclaration` räknar rutorna 10–12, 30–32 och 48 ur momskontona (26xx), ruta 05 och 21 rekonstruerade ur momsen, och rutorna 35, 36, 39, 41 och 42 ur fasta intervall av försäljningskonton (rad 68–120). Rutorna 06, 07, 08, 20, 22, 23, 24, 37, 38 och 40 är hårdkodade till 0 (rad 126–128, 136, 138–140, 150, 151 och 153).
- Allt underlag för omvänd skattskyldighet hamnar i ruta 21, och förbehållet säger det: «Rutorna för omvänd skattskyldighet antar EU-tjänsteinköp (ruta 21)» (rad 9–11 och 161).
- Bygget lägger till en kontolista per bolag (konto → ruta) som bara kan sättas genom en känslig åtgärd i godkännandekön, och låter `vatDeclaration` räkna de tio rutorna, och ruta 21 när fördelningen görs, ur kontona i listan.

## Förkrav

```förkrav
fil: server/migrations/0086_vat_box_accounts.sql ny
fil: server/src/services/vatDeclaration.ts ändras
fil: server/src/actions/registry.ts ändras
fil: server/src/services/approvalSummary.ts ändras
fil: server/test/vat-declaration.test.ts ändras
fil: docs/MCP_ACTIONS.md ändras
fil: docs/STATUS.md ändras
fil: server/src/services/reports.ts läses
fil: server/src/services/accounting/accounts.ts läses
fil: server/src/services/accounting/vouchers.ts läses
fil: server/src/services/auditService.ts läses
fil: server/src/services/ink2.ts läses
fil: server/src/domain/money.ts läses
fil: server/src/lib/validation.ts läses
fil: server/src/lib/errors.ts läses
fil: server/src/actions/execute.ts läses
fil: server/src/services/approvals.ts läses
fil: server/src/http/routes/actions.ts läses
fil: server/src/http/routes/accounting.ts läses
fil: server/src/http/routes/companies.ts läses
fil: server/src/http/view/routes.ts läses
fil: server/src/db/migrate.ts läses
fil: server/src/db/pool.ts läses
fil: server/migrations/0006_chart_of_accounts_and_fiscal_years.sql läses
fil: server/migrations/0042_vat_method.sql läses
fil: server/migrations/0075_kvittobilagor.sql läses
fil: server/migrations/0082_bedomningsbegaran.sql läses
fil: server/migrations/0085_datumprecision.sql läses
fil: server/test/helpers.ts läses
fil: server/test/env.ts läses
fil: server/test/setup.ts läses
fil: server/test/globalSetup.ts läses
fil: server/test/rls-katalog.test.ts läses
fil: server/test/migrate.test.ts läses
fil: server/test/tenant-isolation.test.ts läses
fil: server/test/actions.test.ts läses
fil: server/test/usability-fixes.test.ts läses
fil: server/test/voucher-links.test.ts läses
fil: server/test/f-tax-reverse-charge.test.ts läses
fil: server/test/bakvag.test.ts läses
fil: server/test/uppdragsytan-mandat.test.ts läses
fil: server/test/mcp.test.ts läses
fil: server/test/party-update.test.ts läses
fil: server/test/uppdragsytan-utskick.test.ts läses
fil: server/test/utskickHelper.ts läses
fil: server/test/uppdragsytan-beslut.test.ts läses
fil: server/test/uppdragsytan-undantag.test.ts läses
fil: server/test/uppdragsytan-baselineorsak.test.ts läses
fil: server/test/uppdragsytan-godkannandevag.test.ts läses
fil: server/test/uppdragsytan-bedomningsbegaran.test.ts läses
fil: server/test/draft-delete.test.ts läses
fil: server/test/payroll-tax-dublett.test.ts läses
fil: server/test/fakturanummer-samtidighet.test.ts läses
fil: server/test/statusetiketter.test.ts läses
fil: server/vitest.config.ts läses
fil: server/tsconfig.json läses
fil: server/tsconfig.test.json läses
fil: server/package.json läses
fil: package.json läses
fil: scripts/redovisning-deploy.sh läses
fil: CLAUDE.md läses
fil: docs/ARKITEKTUR.md läses
fil: docs/ACCEPTANS.md läses
fil: docs/project-context.md läses
fil: docs/DRIFT_VPS.md läses
fil: _bmad-output/planning-artifacts/epics.md läses
fil: _bmad-output/planning-artifacts/architecture.md läses
fil: _bmad-output/planning-artifacts/prd.md läses
fil: _bmad-output/planning-artifacts/ux-design-specification.md läses
fil: _bmad-output/planning-artifacts/parallelization-analysis.md läses
fil: _bmad-output/planning-artifacts/sprint-change-proposal-4-5-momsdeklarationens-nollsatta-rutor-raknas-ur-bokforingen.md läses
fil: _bmad-output/planning-artifacts/underlag/kodgranskning.md läses
fil: _bmad-output/planning-artifacts/underlag/davids-svar.md läses
fil: _bmad-output/planning-artifacts/underlag/kedjans-formagor.md läses
fil: _bmad-output/implementation-artifacts/sprint-status.yaml läses
fil: _bmad-output/implementation-artifacts/4-4-momsvakten-varnar-for-varje-inkop-utan-ingaende-moms.md läses
fil: _bmad-output/implementation-artifacts/4-5-momsdeklarationens-nollsatta-rutor-raknas-ur-bokforingen.lardomar.md läses
fil: _bmad/bmm/workflows/4-implementation/create-story/checklist.md läses
fil: hermes/skills/cto_utveckling.py läses
fil: hermes/skills/bmad_story.py läses
prov: vat-declaration ändras GRÖN
prov: rls-katalog berörs GRÖN
prov: migrate berörs GRÖN
prov: tenant-isolation berörs GRÖN
prov: actions berörs GRÖN
prov: usability-fixes berörs GRÖN
prov: voucher-links berörs GRÖN
prov: f-tax-reverse-charge berörs GRÖN
prov: bakvag berörs GRÖN
prov: uppdragsytan-mandat berörs GRÖN
prov: mcp berörs GRÖN
prov: party-update berörs GRÖN
prov: uppdragsytan-utskick berörs GRÖN
prov: uppdragsytan-beslut berörs GRÖN
prov: uppdragsytan-undantag berörs GRÖN
prov: uppdragsytan-baselineorsak berörs GRÖN
prov: uppdragsytan-godkannandevag berörs GRÖN
prov: draft-delete berörs GRÖN
prov: payroll-tax-dublett berörs GRÖN
prov: fakturanummer-samtidighet berörs GRÖN
prov: statusetiketter berörs GRÖN
prov: crmintag berörs RÖD
prov: continuityvakt berörs KUNDE_INTE
prov: handgrepp berörs GRÖN
beroende: pg
beroende: zod
beroende: express
beroende: vitest
beroende: supertest
tjanst: 127.0.0.1:5433 vitest kör alla prov mot den stående testdatabasen redovisning-vitest-pg
kontrakt: redovisningen funktion vatDeclaration prov vat-declaration
kontrakt: redovisningen funktion inputVatCompletenessWarning prov vat-declaration
kontrakt: redovisningen funktion explainApproval nytt vat-declaration
kontrakt: redovisningen funktion assertAccountsExist prov vat-declaration
kontrakt: redovisningen funktion writeAudit prov vat-declaration
kontrakt: redovisningen funktion formatOre prov vat-declaration
kontrakt: redovisningen funktion accountSums prov vat-declaration
kontrakt: redovisningen rutt POST /api/companies/:companyId/actions/vat_declaration prov vat-declaration
kontrakt: redovisningen rutt POST /api/companies/:companyId/actions/post_voucher prov vat-declaration
kontrakt: redovisningen rutt POST /api/companies/:companyId/approvals/:id/approve prov vat-declaration
kontrakt: redovisningen rutt POST /api/companies/:companyId/
```

## Utfall
Tester: 171 passed (171) · Granskning: GODKANT | Alla tre acceptanskriterierna är implementerade, och de fyra fynden från förra varvet är åtgärdade: kortet läser `vatBoxSources` (approvalSummary.ts:340–353, L9a–L9d), låset tas i vatDeclara · Byggforsok: 2

## Modellkedja (Davids krav 17/8, reservvag 7/9)

* krav: kordes inte
* utveckling: **claude-opus-5-5**
* granskning: **claude-opus-5-5 (Codex spärrat — Davids regel 12/10; Codex granskar i efterhand)**

Granskaren ar inte forfattaren: claude-opus-5-5 (Codex spärrat — Davids regel 12/10; Codex granskar i efterhand) granskade claude-opus-5-5s arbete.

effort (Davids beslut 20/10): bygg xhigh · granskning xhigh — riskdel redovisningen
Allt pa Davids abonnemang - inga API-tokens.
