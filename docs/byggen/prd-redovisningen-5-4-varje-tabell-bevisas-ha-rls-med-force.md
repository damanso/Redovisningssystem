# PRD-bygget redovisningen 5-4-varje-tabell-bevisas-ha-rls-med-force — PRD redovisningen 5-4-varje-tabell-bevisas-ha-rls-med-force: # Story 5.4: Varje tabell bevisas ha RL

Datum: 2026-10-21 07:00 · Branch: cto/prd-redovisningen-5-4-varje-tabell-bevisas-ha-rls-med-force-9254 · Kalla: 02-Områden/hermes/prd/redovisningen-1c-prd.md (fryst 29/9, Davids beslut #194)

## Mal
PRD redovisningen 5-4-varje-tabell-bevisas-ha-rls-med-force: # Story 5.4: Varje tabell bevisas ha RLS med FORCE Status: ready-for-dev <!-- Note: Validation is optional. Run validate

## PRD-kravet (ordagrant ur den frysta PRD:n) och astras kodgranskning
```
# Story 5.4: Varje tabell bevisas ha RLS med FORCE

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

Som David,
vill jag att ett prov fäller varje tabell utan RLS med FORCE,
så att garantin att ett annat bolags data aldrig går att nå gäller även för nästa migration.

**Kodbas:** redovisning. **Krav:** FR-26 (RLS med FORCE, medlemskap, 404 mellan bolag). **Arkitektur:** AD-13 (RLS-garantin som härlett prov över katalogen, med negativ kontroll). **Beror på:** inga. Bygget behöver inget svar från David. Story 5.5 (RLS och FORCE på `users` och migrationsregistret) bygger på det här provet och tömmer dess lista; David godkände mönstret för 5.5 den 2026-10-16.

**Läget i dag, i tre meningar** (läst 2026-10-21 i kopian av main):
- Inget prov läser katalogen över alla tabeller. Tre prov läser `relrowsecurity` och `relforcerowsecurity` för var sin egen tabell (`server/test/uppdragsytan-beslut.test.ts`, `server/test/uppdragsytan-scopeavgorande.test.ts`, `server/test/uppdragsytan-bedomningsbegaran.test.ts`), så en ny migration som glömmer `FORCE ROW LEVEL SECURITY` fälls inte av något prov.
- Migrationskedjan 0001–0085 skapar 68 tabeller i `public` och `crm` (inventerat ur `CREATE TABLE` i varje migration och ur `server/src/db/migrate.ts`). 64 har en kolumn `company_id` och alla dessa har `ENABLE` och `FORCE`. Av de fyra utan `company_id` har `companies` och `email_outbox` RLS med FORCE och egna policyer, medan `users` (0002, kommentaren på rad 73–75) och migrationsregistret `schema_migrations` (skapat av `migrate()`) saknar RLS helt.
- Bygget skriver ett nytt katalogprov, `server/test/rls-katalog.test.ts`, med en sluten regeluppsättning, en lista över de övriga tabellerna med policy och skäl, listan «saknar RLS och FORCE — åtgärdas i Story 5.5» och planterade negativa kontroller. Det kompletterar `server/test/tenant-isolation.test.ts` med ett block som prövar varje monterad bolagsrutt för läsning och skrivning och appens roll. Ingen fil under `server/src/` eller `server/migrations/` ändras.

## Förkrav

```förkrav
fil: server/test/rls-katalog.test.ts ny
fil: server/test/tenant-isolation.test.ts ändras
fil: docs/STATUS.md ändras
fil: server/test/helpers.ts läses
fil: server/test/env.ts läses
fil: server/test/setup.ts läses
fil: server/test/globalSetup.ts läses
fil: server/test/review-fixes.test.ts läses
fil: server/test/view.test.ts läses
fil: server/test/uppdragsytan-schema.test.ts läses
fil: server/test/uppdragsytan-beslut.test.ts läses
fil: server/test/uppdragsytan-scopeavgorande.test.ts läses
fil: server/test/uppdragsytan-bedomningsbegaran.test.ts läses
fil: server/vitest.config.ts läses
fil: server/tsconfig.json läses
fil: server/tsconfig.test.json läses
fil: server/package.json läses
fil: package.json läses
fil: server/src/db/pool.ts läses
fil: server/src/db/migrate.ts läses
fil: server/src/db/tx.ts läses
fil: server/src/http/app.ts läses
fil: server/src/http/middleware/companyAccess.ts läses
fil: server/src/http/routes/companies.ts läses
fil: server/src/http/routes/files.ts läses
fil: server/src/http/routes/accounting.ts läses
fil: server/src/http/routes/invoices.ts läses
fil: server/src/http/routes/receipts.ts läses
fil: server/src/http/routes/actions.ts läses
fil: server/src/http/routes/parties.ts läses
fil: server/src/http/routes/receiptFiles.ts läses
fil: server/src/http/view/routes.ts läses
fil: server/src/actions/registry.ts läses
fil: server/src/actions/execute.ts läses
fil: server/src/services/companies.ts läses
fil: server/src/http/middleware/errorHandler.ts läses
fil: server/src/mcp/server.ts läses
fil: server/migrations/0002_identity_and_tenancy.sql läses
fil: server/migrations/0005_force_rls_and_audit_index.sql läses
fil: server/migrations/0021_notifications.sql läses
fil: server/migrations/0052_crm_schema.sql läses
fil: server/migrations/0068_uppdragsytan.sql läses
fil: CLAUDE.md läses
fil: docs/ARKITEKTUR.md läses
fil: docs/project-context.md läses
fil: docs/ACCEPTANS.md läses
fil: docs/SPÅRBARHET.md läses
fil: docs/MCP_ACTIONS.md läses
fil: _bmad-output/planning-artifacts/epics.md läses
fil: _bmad-output/planning-artifacts/architecture.md läses
fil: _bmad-output/planning-artifacts/prd.md läses
fil: _bmad-output/planning-artifacts/parallelization-analysis.md läses
fil: _bmad-output/planning-artifacts/implementation-readiness-report-2026-10-13.md läses
fil: _bmad-output/planning-artifacts/underlag/kodgranskning.md läses
fil: _bmad-output/planning-artifacts/underlag/davids-svar.md läses
fil: _bmad-output/planning-artifacts/underlag/kedjans-formagor.md läses
fil: _bmad-output/implementation-artifacts/sprint-status.yaml läses
fil: _bmad-output/implementation-artifacts/5-4-varje-tabell-bevisas-ha-rls-med-force.lardomar.md läses
fil: _bmad-output/implementation-artifacts/4-7-leverantorsreskontran-stammer-for-ett-historiskt-datum.md läses
fil: _bmad/bmm/workflows/4-implementation/create-story/checklist.md läses
fil: hermes/skills/cto_utveckling.py läses
fil: hermes/skills/bmad_story.py läses
prov: rls-katalog nytt GRÖN
prov: tenant-isolation ändras GRÖN
prov: review-fixes berörs GRÖN
prov: view berörs GRÖN
prov: continuityvakt berörs KUNDE_INTE
beroende: pg
beroende: vitest
beroende: supertest
tjanst: 127.0.0.1:5433 vitest kör proven mot den stående testdatabasen redovisning-vitest-pg, och katalogprovet planterar tabeller där i transaktioner som rullas tillbaka
kontrakt: redovisningen schema pg_class prov rls-katalog
kontrakt: redovisningen schema pg_attribute prov rls-katalog
kontrakt: redovisningen schema pg_policy prov rls-katalog
kontrakt: redovisningen schema pg_namespace prov rls-katalog
kontrakt: redovisningen schema companies prov rls-katalog
kontrakt: redovisningen schema email_outbox prov rls-katalog
kontrakt: redovisningen schema users prov rls-katalog
kontrakt: redovisningen schema schema_migrations prov rls-katalog
kontrakt: redovisningen schema public.vouchers prov rls-katalog
kontrakt: redovisningen schema public.audit_log prov rls-katalog
kontrakt: redovisningen schema crm.organizations prov rls-katalog
kontrakt: redovisningen schema crm.audit_log prov rls-katalog
kontrakt: redovisningen funktion withAdmin prov rls-katalog
kontrakt: redovisningen schema pg_roles prov tenant-isolation
kontrakt: redovisningen schema customers prov tenant-isolation
kontrakt: redovisningen schema fiscal_years prov tenant-isolation
kontrakt: redovisningen schema invoices prov tenant-isolation
kontrakt: redovisningen schema receipts prov tenant-isolation
kontrakt: redovisningen schema audit_log prov tenant-isolation
kontrakt: redovisningen funktion assertAppRoleEnforcesRls prov tenant-isolation
kontrakt: redovisningen funktion requireCompanyAccess prov tenant-isolation
kontrakt: redovisningen funktion registerUser prov tenant-isolation
kontrakt: redovisningen funktion createCompany prov tenant-isolation
kontrakt: redovisningen funktion createOwnedCompany prov tenant-isolation
kontrakt: redovisningen funktion executeAction prov tenant-isolation
kontrakt: redovisningen funktion errorHandler prov tenant-isolation
kontrakt: redovisningen funktion withAdmin prov tenant-isolation
kontrakt: redovisningen rutt GET /api/companies/:companyId/accounting/accounts prov tenant-isolation
kontrakt: redovisningen rutt GET /api/companies/:companyId/accounting/fiscal-years prov tenant-isolation
kontrakt: redovisningen rutt POST /api/companies/:companyId/accounting/fiscal-years prov tenant-isolation
kontrakt: redovisningen rutt GET /api/companies/:companyId/invoices prov tenant-isolation
kontrakt: redovisningen rutt POST /api/companies/:companyId/invoices prov tenant-isolation
kontrakt: redovisningen rutt GET /api/companies/:companyId/receipts prov tenant-isolation
kontrakt: redovisningen rutt POST /api/companies/:companyId/receipts prov tenant-isolation
kontrakt: redovisningen rutt GET /api/companies/:companyId/actions prov tenant-isolation
kontrakt: redovisningen rutt POST /api/compani
```

## Utfall
Tester: 170 passed (170) · Granskning: GODKANT | Alla tre acceptanskriterier och varje kryssad uppgift finns i koden, kedjans körning är grön (170 passed), och fynden nedan är bara LOW. · Byggforsok: 1

## Modellkedja (Davids krav 17/8, reservvag 7/9)

* krav: **claude-opus-5-5**
* utveckling: **claude-opus-5-5**
* granskning: **claude-opus-5-5 (Codex spärrat — Davids regel 12/10; Codex granskar i efterhand)**

Granskaren ar inte forfattaren: claude-opus-5-5 (Codex spärrat — Davids regel 12/10; Codex granskar i efterhand) granskade claude-opus-5-5s arbete.

effort (Davids beslut 20/10): create-story high · validering high · bygg xhigh · granskning xhigh — riskdel redovisningen
Allt pa Davids abonnemang - inga API-tokens.
