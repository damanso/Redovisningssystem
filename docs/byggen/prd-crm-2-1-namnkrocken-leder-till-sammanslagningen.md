# PRD-bygget crm 2-1-namnkrocken-leder-till-sammanslagningen — PRD crm 2-1-namnkrocken-leder-till-sammanslagningen: # Story 2.1: Namnkrocken leder till sammanslagn

Datum: 2026-11-21 01:23 · Branch: cto/prd-crm-2-1-namnkrocken-leder-till-sammanslagningen-9309 · Kalla: 02-Områden/hermes/prd/crm-1c-prd.md (fryst 29/9, Davids beslut #194)

## Mal
PRD crm 2-1-namnkrocken-leder-till-sammanslagningen: # Story 2.1: Namnkrocken leder till sammanslagningen Status: ready-for-dev <!-- Note: Validation is optional. Run valida

## PRD-kravet (ordagrant ur den frysta PRD:n) och astras kodgranskning
```
# Story 2.1: Namnkrocken leder till sammanslagningen

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

Som David (och som en agent som rättar en relation åt honom),
vill jag att ett namnbyte till ett namn som en annan relation redan bär svarar med vilken relation det är och vägen till sammanslagningen,
så att krocken leder vidare i stället för att lämna dubbletten kvar.

Kodbas: redovisning (kedjan cto) · Täcker: FR-29 · Beror på: — (1.1–1.8 och 2.2 är i basen; berättelsen bygger på `upsertOrganization`, relationssidans *Rätta uppgifter* och *Dubblett?* och åtgärden `merge_crm_organizations`, och ändrar inget av det de byggde utöver det som står här) · Arkitektur: K-8 (`name_taken` behåller 400 och får `details: { organization_id, merge_action: 'merge_crm_organizations' }`), Frontend Architecture (tillstånd som adresser: `?oppna=<formulär>&med=<uuid>`), UX K2 (namnkrockstexten) och Resa 2–3.

Berättelsen skrevs 2026-11-21 ur epics.md (Story 2.1, kriterierna ordagrant), PRD:ns FR-29, arkitekturens K-8, UX-specifikationens K2 och Resa 2–3, kodgranskningens rad för FR-29 och koden i arbetskopian. Bygget ändrar en fråga och ett kast i `upsertOrganization`, lägger två rena funktioner och ett formulärnamn i lib, ger `runViewAction` en valfri parameter, låter relationssidan visa namnkrockens notis och öppna *Dubblett?* med ett förval, skriver ett dokumentavsnitt i `docs/MCP_ACTIONS.md` och lägger en mening om `details` i intagskontraktet `docs/crm/API_KONTRAKT.md`, som redan beskriver `name_taken`. Ingen rutt, ingen åtgärd, inget schema för indata, ingen migration och ingen CSS-klass tillkommer. Bolagsformsvarianten (`name_variant_of`, `distinct_from`, `merge_crm_name_variant`) är berättelse 2.3 och byggs inte här.

## Förkrav

Blocket nedan är berättelsens hela yta. Fyra saker om formen:

- **Inga beroenderader.** Inget paket läggs till. Förkontrollens K5 läser för redovisningen bara manifestet i repots översta katalog, som saknar beroenden, och en `beroende:`-rad blir där RÖD och stoppar bygget (lärdom ur 6.2 och 2.2). Bygget använder express, zod, vitest och supertest som de redan används.
- **Inga kontraktsrader.** Berättelsen läser ingen annan dels rutt, fil eller funktion. Ingen rutt tillkommer: notisen och förvalet är frågeparametrar på relationssidans befintliga rutt, och navigationskontraktet bär rutter, inte frågeparametrar. `details` på ett befintligt fel är ett tillägg i samma del.
- **Inga kommandon.** Byggaren har bara Read, Glob, Grep, Write, Edit och TodoWrite. Kedjan kör `npm ci`, typkontrollen, bygget, migrationskedjan och hela vitest-sviten efter utvecklarens sista ändring.
- **Proven.** Kedjan cto kör vitest-sviten. Hermes egna prov körs inte av den kedjan, och därför står inget sådant prov här (Dev Notes, «Baslinjen»). Berörsraderna är de befintliga vitest-filer som läser relationssidan, `upsertOrganization`, sammanslagningens kö, MCP-serverns felform, vyns anropsställen för `runViewAction`, `docs/MCP_ACTIONS.md` eller `docs/crm/API_KONTRAKT.md` (Dev Notes, «Regressionsytan»).

```förkrav
fil: server/src/services/crmRelations.ts ändras
fil: server/src/lib/crmRules.ts ändras
fil: server/src/http/view/routes.ts ändras
fil: server/test/crm-org-name-norm.test.ts ändras
fil: server/test/crm-rules.test.ts ändras
fil: docs/MCP_ACTIONS.md ändras
fil: docs/crm/API_KONTRAKT.md ändras
fil: docs/STATUS.md ändras
fil: server/src/lib/errors.ts läses
fil: server/src/lib/validation.ts läses
fil: server/src/http/middleware/errorHandler.ts läses
fil: server/src/http/routes/actions.ts läses
fil: server/src/mcp/server.ts läses
fil: server/src/actions/registry.ts läses
fil: server/src/actions/execute.ts läses
fil: server/src/services/crmMerge.ts läses
fil: server/src/db/tx.ts läses
fil: server/test/helpers.ts läses
fil: server/test/env.ts läses
fil: server/test/setup.ts läses
fil: server/test/globalSetup.ts läses
fil: server/test/crm-views.test.ts läses
fil: server/test/mcp-felomslag.test.ts läses
fil: server/test/crm-name-alias.test.ts läses
fil: server/test/crm-status-link.test.ts läses
fil: server/test/crm-event-provenance.test.ts läses
fil: server/test/crm-provenance.test.ts läses
fil: server/test/crm-cadence-merge-search.test.ts läses
fil: server/test/crm-stadning.test.ts läses
fil: server/test/crm-design-parity.test.ts läses
fil: server/test/crm-sfar-yta.test.ts läses
fil: server/test/crm-actions-ui.test.ts läses
fil: server/test/crm-finish.test.ts läses
fil: server/test/crm-review-fixes.test.ts läses
fil: server/test/crm-sandvag.test.ts läses
fil: server/test/voucher-links.test.ts läses
fil: server/test/uppdragsytan-utskick.test.ts läses
fil: server/test/payroll-tax-dublett.test.ts läses
fil: server/test/fakturanummer-samtidighet.test.ts läses
fil: server/test/draft-delete.test.ts läses
fil: server/test/vy-kansliga-knappar.test.ts läses
fil: docs/project-context.md läses
fil: docs/ARKITEKTUR.md läses
fil: CLAUDE.md läses
fil: _bmad-output/planning-artifacts/prd.md läses
fil: _bmad-output/planning-artifacts/epics.md läses
fil: _bmad-output/planning-artifacts/architecture.md läses
fil: _bmad-output/planning-artifacts/ux-design-specification.md läses
prov: crm-org-name-norm ändras GRÖN
prov: crm-rules ändras GRÖN
prov: crm-views berörs GRÖN
prov: mcp-felomslag berörs GRÖN
prov: crm-name-alias berörs GRÖN
prov: crm-status-link berörs GRÖN
prov: crm-event-provenance berörs GRÖN
prov: crm-provenance berörs GRÖN
prov: crm-cadence-merge-search berörs GRÖN
prov: crm-stadning berörs GRÖN
prov: crm-design-parity berörs GRÖN
prov: crm-sfar-yta berörs GRÖN
prov: crm-actions-ui berörs GRÖN
prov: crm-finish berörs GRÖN
prov: crm-review-fixes berörs GRÖN
prov: crm-sandvag berörs GRÖN
prov: voucher-links berörs GRÖN
prov: uppdragsytan-utskick berörs GRÖN
prov: payroll-tax-dublett berörs GRÖN
prov: fakturanummer-samtidighet berörs GRÖN
prov: draft-delete berörs GRÖN
prov: vy-kansliga-knappar berörs GRÖN
tjanst: 127.0.0.1:5433 vitest kör provfilerna och migrationskedjan mot den stående testdatabasen
```

- **Tjänsten** är testdatabasen som kedjan cto kör hela sviten mot, och enligt förteckningen över kedjans förmågor (härledd 2026-11-21 00.05) den enda adress proven får nå. Utvecklarens sandlåda når ofta inte servern (2.2 fick EPERM), och det är aldrig ett HALT-skäl (Tasks, «Utan kommandon»).
- **Läsfilerna** utöver de ändrade:
  - `server/src/lib/errors.ts` ger `BadRequestError(code, message, details?)` med status 400 och `ConflictError(code, message, details?)` med 409. `server/src/http/middleware/errorHandler.ts` gör ett `AppError` till `{ error: code }`, eller `{ error: code, details }` när `details` är satt (rad 30–36); felets text stannar på servern. `server/src/http/routes/actions.ts` fångar inga fel, så felet når felhanteraren oförändrat.
  - `server/src/mcp/server.ts` anropar samma REST-adress med agentnyckeln och lämnar ett fel som texten `Fel (HTTP <status>): <hela kroppen som JSON>` (rad 200–201). Fallet E2 i `server/test/mcp-felomslag.test.ts` (rad 317–324) visar den formen för ett 400 med kropp. Filen ändras inte: `details` följer med i kroppen.
  - `server/src/actions/registry.ts` (åtgärden `upsert_crm_organization`, `write`, rad 2705–) och `server/src/actions/execute.ts` ändras inte. `server/src/services/crmMerge.ts` (sammanslagningen bakom `merge_crm_organizations`, `sensitive`) ändras inte.
  - `server/src/lib/validation.ts` ger `UuidSchema` (rad 37), som både lib och routes redan importerar.
  - `server/src/db/tx.ts` ger `withTenantTransaction`. Provens hjälpare i `server/test/helpers.ts` (`api`, `app`, `registerUser`, `createCompany`, `withAdmin`), och `server/test/env.ts`, `server/test/setup.ts` och `server/test/globalSetup.ts` bär testdatabasen som i 2.2.
  - Provfilerna och dokumenten under «Regressionsytan» är förebilder och regressionsyta.

## Acceptance Criteria

Lydelsen är epics.md:s (Story 2.1), ordagrant och numrerad. En avvikelse i formen, inte i inneh
```

## Utfall
Tester: 187 passed (187) · Granskning: GODKANT | Alla acceptanskriterier är implementerade, båda tidigare HIGH-fynden är åtgärdade och inga nya fynd har identifierats. · Byggforsok: 2

## Modellkedja (Davids krav 17/8, reservvag 7/9)

* krav: kordes inte
* utveckling: **gpt-6.1-sol**
* granskning: **gpt-6-astra**

Granskaren ar inte forfattaren: gpt-6-astra granskade gpt-6.1-sols arbete.

effort (Davids beslut 20/10): create-story high · validering high — planeringssteg
Allt pa Davids abonnemang - inga API-tokens.
