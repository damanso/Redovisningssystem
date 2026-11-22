# PRD-bygget crm 7-1-affarscachen-och-kontraktet-for-affarer — PRD crm 7-1-affarscachen-och-kontraktet-for-affarer: # Story 7.1: Affärscachen och kontraktet för af

Datum: 2026-11-22 17:40 · Branch: cto/prd-crm-7-1-affarscachen-och-kontraktet-for-affarer-9332 · Kalla: 02-Områden/hermes/prd/crm-1c-prd.md (fryst 29/9, Davids beslut #194)

## Mal
PRD crm 7-1-affarscachen-och-kontraktet-for-affarer: # Story 7.1: Affärscachen och kontraktet för affärer Status: ready-for-dev <!-- Note: Validation is optional. Run valida

## PRD-kravet (ordagrant ur den frysta PRD:n) och astras kodgranskning
```
# Story 7.1: Affärscachen och kontraktet för affärer

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

Kodbas: redovisning · Täcker: FR-25 (mottagarsidan: affärerna renderas via kontraktet, redovisningen ringer aldrig ut) · Beror på: 2.2 (projektkodsspärren) och 2.3 (bolagsformsregeln), båda `done` och byggda i kopian (Uppgift 0 prövar det).

## Story

Som David
vill jag att relationsdelen kan ta emot en ögonblicksbild av de öppna affärerna i ärendeplattformen,
så att affärerna kan visas utan att redovisningen ringer ut och utan att någon affär dubbellagras som sanning.

## Förkrav

Blocket nedan är berättelsens hela yta. Sökvägarna är relativa kedjans bas (redovisningens repo). Fem saker om formen:

- **Inga beroenderader.** Förkontrollens K5 läser för redovisningen bara manifestet i repots översta katalog, där inga paket står; varje `beroende:`-rad blev RÖD och stoppade bygge #9291 (lärdom ur 6.2). Berättelsen lägger inget paket till: zod, pg, vitest och supertest finns redan i serverns manifest.
- **Inga kontraktsrader.** Berättelsen läser ingen annan dels rutt, fil eller funktion. Den skapar två nya åtgärder som Story 7.2 (hermes) senare anropar, men förkontrollen prövar kontrakt mot det som finns i dag, och åtgärderna finns inte förrän det här bygget gjort dem. Löftet hålls av det nya provet och av avsnitten i `docs/crm/API_KONTRAKT.md` och `docs/MCP_ACTIONS.md`.
- **Inga kommandon.** Byggaren har bara Read, Glob, Grep, Write, Edit och TodoWrite (underlaget om kedjans förmågor: kedjan cto kan inte köra kommandon). Kedjan kör typkontrollen, bygget och hela vitest-sviten efter utvecklarens sista ändring, och ett rött prov kommer tillbaka som fixrunda.
- **Proven.** Raderna `prov:` är vitest-filer i `server/test/`. Det nya provet och den ändrade E3-kontrollen ska bli GRÖNA; de berörda läser antingen en ändrad fil, sveper registret eller katalogen, eller läser källtext under `server/src` (Dev Notes, «Regressionsytan»). Inga berörs-rader för Hermes prov (Dev Notes, «Baslinjen»).
- **Tjänsten** är testdatabasen som kedjan cto kör sviten mot; proven får nå just den adressen.

```förkrav
fil: server/migrations/0096_crm_deal_snapshots.sql ny
fil: server/src/services/crmDeals.ts ny
fil: server/test/crm-deals.test.ts ny
fil: server/src/actions/registry.ts ändras
fil: server/src/lib/crmRules.ts ändras
fil: server/src/http/view/html.ts ändras
fil: server/src/services/gdpr.ts ändras
fil: server/test/crm-schema.test.ts ändras
fil: docs/crm/API_KONTRAKT.md ändras
fil: docs/MCP_ACTIONS.md ändras
fil: docs/STATUS.md ändras
fil: server/src/services/crmIngest.ts läses
fil: server/src/services/crmRelations.ts läses
fil: server/src/services/crmMerge.ts läses
fil: server/src/services/approvals.ts läses
fil: server/src/actions/execute.ts läses
fil: server/src/lib/validation.ts läses
fil: server/src/lib/errors.ts läses
fil: server/src/http/middleware/authenticate.ts läses
fil: server/src/db/migrate.ts läses
fil: server/src/db/tx.ts läses
fil: server/src/db/pool.ts läses
fil: server/migrations/0052_crm_schema.sql läses
fil: server/migrations/0076_uppdrag_dokument.sql läses
fil: server/migrations/0091_crm_org_name_norm.sql läses
fil: server/migrations/0092_crm_organization_distinctions.sql läses
fil: server/test/helpers.ts läses
fil: server/test/env.ts läses
fil: server/test/setup.ts läses
fil: server/test/globalSetup.ts läses
fil: server/vitest.config.ts läses
fil: server/test/crm-org-name-norm.test.ts läses
fil: server/test/crm-gdpr-replay.test.ts läses
fil: server/test/crm-cadence-merge-search.test.ts läses
fil: server/test/statusetiketter.test.ts läses
fil: server/test/sandvagHelper.ts läses
fil: server/test/utskickHelper.ts läses
fil: server/test/rls-katalog.test.ts läses
fil: server/test/crm-views.test.ts läses
fil: server/test/crm-sandvag.test.ts läses
fil: server/test/party-update.test.ts läses
fil: server/test/uppdragsytan-mandat.test.ts läses
fil: server/test/forslagskort-beslut.test.ts läses
fil: server/test/vy-kansliga-knappar.test.ts läses
fil: server/test/uppdragsytan-bedomningsbegaran.test.ts läses
fil: server/test/uppdragsytan-utskick.test.ts läses
fil: server/test/gdpr.test.ts läses
fil: server/test/crm-review-fixes.test.ts läses
fil: server/test/crm-commitment-lifecycle.test.ts läses
fil: server/test/crm-thread-paging.test.ts läses
fil: server/test/crm-event-provenance.test.ts läses
fil: server/test/crm-status-link.test.ts läses
fil: server/src/http/view/routes.ts läses
fil: server/src/services/email.ts läses
fil: docs/project-context.md läses
fil: docs/ARKITEKTUR.md läses
fil: CLAUDE.md läses
fil: _bmad-output/planning-artifacts/prd.md läses
fil: _bmad-output/planning-artifacts/epics.md läses
fil: _bmad-output/planning-artifacts/architecture.md läses
fil: _bmad-output/planning-artifacts/underlag/kodgranskning.md läses
fil: _bmad-output/planning-artifacts/underlag/davids-svar.md läses
fil: _bmad-output/planning-artifacts/underlag/kedjans-formagor.md läses
fil: _bmad-output/implementation-artifacts/2-3-en-bolagsformsvariant-blir-ett-sammanslagningsforslag-i-stallet-for-en-ny-post.md läses
prov: crm-deals nytt GRÖN
prov: crm-schema ändras GRÖN
prov: statusetiketter berörs GRÖN
prov: rls-katalog berörs GRÖN
prov: crm-sandvag berörs GRÖN
prov: crm-views berörs GRÖN
prov: gdpr berörs GRÖN
prov: crm-gdpr-replay berörs GRÖN
prov: crm-review-fixes berörs GRÖN
prov: crm-org-name-norm berörs GRÖN
prov: crm-cadence-merge-search berörs GRÖN
prov: crm-commitment-lifecycle berörs GRÖN
prov: crm-thread-paging berörs GRÖN
prov: crm-event-provenance berörs GRÖN
prov: crm-status-link berörs GRÖN
prov: fakturanummer-samtidighet berörs GRÖN
prov: draft-delete berörs GRÖN
prov: payroll-tax-dublett berörs GRÖN
prov: voucher-links berörs GRÖN
prov: uppdragsytan-matt-rytm berörs GRÖN
prov: uppdragsytan-scopelinje berörs GRÖN
prov: party-update berörs GRÖN
prov: uppdragsytan-mandat berörs GRÖN
prov: forslagskort-beslut berörs GRÖN
prov: uppdragsytan-bedomningsbegaran berörs GRÖN
prov: vy-kansliga-knappar berörs GRÖN
prov: uppdragsytan-utskick berörs GRÖN
prov: crm-sfar-3 berörs GRÖN
prov: kvittobilagor-lagring berörs GRÖN
prov: uppdragsytan-baselineorsak berörs GRÖN
prov: uppdragsytan-beslut berörs GRÖN
prov: uppdragsytan-godkannandevag berörs GRÖN
prov: uppdragsytan-undantag berörs GRÖN
prov: vat-declaration berörs GRÖN
tjanst: 127.0.0.1:5433 vitest-sviten återskapar testdatabasen ur mallen före varje fil och kör migrationerna, åtgärderna och tjänsterna mot riktig Postgres
```

## Acceptance Criteria

Lydelsen är epics.md:s (Story 7.1), ordagrant och numrerad; provfilen står med full sökväg. Under varje kriterium står raden *Mätbart*: mekanismen som gör kriteriet sant genom konstruktion och den ändliga listan av fall i `server/test/crm-deals.test.ts` (eller den ändrade `server/test/crm-schema.test.ts`) som visar det. Fallens namn står först i titeln (M1, S1, V1 …); Dev Notes, «Fallen», beskriver varje fall. Facit står i fallen som literaler, aldrig importerat ur koden som prövas.

1. **Given** en ny, additiv migration
   **When** den körs, och kedjan körs igen
   **Then** tabellen `crm.deal_snapshots` finns med `company_id`, `source_ref` (unikt per bolag), `organization_id` (sammansatt FK, `ON DELETE CASCADE`), `title` (högst 200), `stage` (nullbar, CHECK `idea`/`dialogue`/`proposal`/`negotiation`), `value_ore` (nullbar, heltal ≥ 0), `next_step` (nullbar, högst 200), `last_activity_at` och `observed_at`, med ENABLE + FORCE RLS, uttryckliga GRANT och tabellkommentaren *Kategori: CACHE — spegel av ärendeplattformens affärsärenden, får tömmas, skrivs bara av `sync_crm_deals`, redigeras aldrig i vyn*
   **And** skedena har svenska etiketter i `statusChip` (*Idé*, *Dialog*, *Offert*, *Förhandling*) och statusetikettprovet är grönt
   - *Mätbart (Then):* Migrationen `server/migrations/0096_crm_deal_snapshots.sql` är additiv och idempotent (`CREATE TABLE IF NOT EXISTS`, `DROP POLICY IF EXISTS` före varje `CR
```

## Utfall
Tester: 196 passed (196) · Granskning: GODKANT | Båda fynden från förra varvet är åtgärdade, alla fem acceptanskriterier är implementerade, sedan förra varvet har bara dokument, kommentarer och prov ändrats (inget beteende), och kvar finns · Byggforsok: 3

## Modellkedja (Davids krav 17/8, reservvag 7/9)

* krav: **claude-opus-5-5**
* utveckling: **claude-opus-5-5**
* granskning: **claude-opus-5-5 (Codex spärrat — Davids regel 12/10; Codex granskar i efterhand)**

Granskaren ar inte forfattaren: claude-opus-5-5 (Codex spärrat — Davids regel 12/10; Codex granskar i efterhand) granskade claude-opus-5-5s arbete.

effort (Davids beslut 20/10): create-story high · validering high · bygg xhigh · granskning xhigh — riskdel crm
Allt pa Davids abonnemang - inga API-tokens.
