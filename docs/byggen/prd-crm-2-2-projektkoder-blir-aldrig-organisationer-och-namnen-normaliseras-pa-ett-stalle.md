# PRD-bygget crm 2-2-projektkoder-blir-aldrig-organisationer-och-namnen-normaliseras-pa-ett-stalle — PRD crm 2-2-projektkoder-blir-aldrig-organisationer-och-namnen-normaliseras-pa-ett-stalle: # Story 2

Datum: 2026-11-20 08:33 · Branch: cto/prd-crm-2-2-projektkoder-blir-aldrig-organisationer-och-namn-9294 · Kalla: 02-Områden/hermes/prd/crm-1c-prd.md (fryst 29/9, Davids beslut #194)

## Mal
PRD crm 2-2-projektkoder-blir-aldrig-organisationer-och-namnen-normaliseras-pa-ett-stalle: # Story 2.2: Projektkoder blir aldrig organisationer, och namnen normaliseras på ett ställe Status: ready-for-dev <!-- N

## PRD-kravet (ordagrant ur den frysta PRD:n) och astras kodgranskning
```
# Story 2.2: Projektkoder blir aldrig organisationer, och namnen normaliseras på ett ställe

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

Som David,
vill jag att en projektkod som *NVR-001* aldrig blir en relation och att bolagsformsvarianter av samma namn känns igen på ett och samma sätt överallt,
så att styrvyn inte räknar noll för en kund som ligger under fel namn.

Kodbas: redovisning (kedjan cto) · Täcker: FR-14 (projektkodsspärren och normaliseringen mot bolagsform), FR-30 (b) (det normaliserade namnet som provet jämför på) · Beror på: — (1.1–1.6 är i basen; berättelsen bygger på `upsertOrganization` och intagets savepoint men ändrar inget av det de byggde) · Arkitektur: A-4 (`crm.normalize_org_name`, `name_norm`, `isProjectCode`, `project_code_as_name`), Data Architecture (additiv, idempotent migration), Process Patterns (inga tysta utfall: avvisningen står i `skipped` och i vyns notis).

Berättelsen skrevs 2026-11-20 ur epics.md (Story 2.2, kriterierna ordagrant), PRD:ns FR-14 och FR-30, arkitekturens A-4, kodgranskningens fynd för FR-14 och koden i arbetskopian. Bygget lägger en migration (en SQL-funktion, en genererad kolumn och ett index), en ren funktion i lib, en spärr överst i `upsertOrganization`, en ny provfil och tre dokumentstycken. Ingen rutt, ingen åtgärd, inget schema för indata och ingen CSS-klass tillkommer. Bolagsformsvarianten som sammanslagningsförslag (A-4:s andra halva) är berättelse 2.3 och byggs inte här.

## Förkrav

Blocket nedan är berättelsens hela yta. Fyra saker om formen:

- **Inga beroenderader.** Inget paket läggs till. Förkontrollens K5 läser för redovisningen bara manifestet i repots översta katalog, som saknar beroenden, och en `beroende:`-rad blir där RÖD med ursprunget «david» och stoppar bygget (lärdom ur 6.2). Bygget använder pg, express, zod, vitest och supertest som de redan används.
- **Inga kontraktsrader.** Berättelsen läser ingen annan dels rutt, fil eller funktion. `isProjectCode`, `crm.normalize_org_name` och `name_norm` finns inte förrän bygget skapat dem, och ett funktionskontrakt för delen crm ger KUNDE_INTE i förkontrollen. Proven håller i stället löftet: N5 visar att kolumnen bär grupperingen som dataprovet i 2.4 ska använda.
- **Inga kommandon.** Byggaren har bara Read, Glob, Grep, Write, Edit och TodoWrite. Kedjan kör `npm ci`, typkontrollen, bygget, migrationskedjan och hela vitest-sviten efter utvecklarens sista ändring.
- **Proven.** Kedjan cto kör vitest-sviten. Hermes egna prov under hermes/prov körs inte av den kedjan, och därför står inget sådant prov här (Dev Notes, «Baslinjen»). Berörsraderna är de befintliga vitest-filer som skriver organisationer genom åtgärden eller intaget, läser ett ändrat dokument eller bygger egna databaser ur migrationskedjan (Dev Notes, «Regressionsytan»). Migrationens nummer räknas i Uppgift 0 (högsta numret i katalogen plus ett); raden nedan bär därför `<NNNN>`.

```förkrav
fil: server/migrations/<NNNN>_crm_org_name_norm.sql ny
fil: server/test/crm-org-name-norm.test.ts ny
fil: server/src/lib/crmRules.ts ändras
fil: server/src/services/crmRelations.ts ändras
fil: server/test/crm-rules.test.ts ändras
fil: server/test/crm-name-alias.test.ts ändras
fil: docs/MCP_ACTIONS.md ändras
fil: docs/crm/API_KONTRAKT.md ändras
fil: docs/STATUS.md ändras
fil: server/src/services/crmIngest.ts läses
fil: server/src/services/crmMerge.ts läses
fil: server/src/services/crmPrivat.ts läses
fil: server/src/services/crmSfarByte.ts läses
fil: server/src/services/gdpr.ts läses
fil: server/src/actions/registry.ts läses
fil: server/src/actions/execute.ts läses
fil: server/src/http/routes/actions.ts läses
fil: server/src/http/middleware/errorHandler.ts läses
fil: server/src/http/view/routes.ts läses
fil: server/src/db/migrate.ts läses
fil: server/src/db/tx.ts läses
fil: server/src/lib/errors.ts läses
fil: server/migrations/0052_crm_schema.sql läses
fil: server/migrations/0059_crm_name_aliases.sql läses
fil: server/migrations/0087_crm_sfar_och_roll.sql läses
fil: server/migrations/0090_crm_event_provenance.sql läses
fil: server/test/helpers.ts läses
fil: server/test/env.ts läses
fil: server/test/setup.ts läses
fil: server/test/globalSetup.ts läses
fil: server/test/crm-event-provenance.test.ts läses
fil: server/test/crm-status-link.test.ts läses
fil: server/test/crm-views.test.ts läses
fil: server/test/crm-provenance.test.ts läses
fil: server/test/crm-cadence-merge-search.test.ts läses
fil: server/test/crm-schema.test.ts läses
fil: server/test/crm-derivations.test.ts läses
fil: server/test/crm-sfar.test.ts läses
fil: server/test/crm-sfar-3.test.ts läses
fil: server/test/crm-sfar-yta.test.ts läses
fil: server/test/crm-gdpr-replay.test.ts läses
fil: server/test/crm-stadning.test.ts läses
fil: server/test/crm-actions-ui.test.ts läses
fil: server/test/crm-design-parity.test.ts läses
fil: server/test/crm-retention-ui.test.ts läses
fil: server/test/crm-review-fixes.test.ts läses
fil: server/test/crm-finish.test.ts läses
fil: server/test/crm-thread.test.ts läses
fil: server/test/crm-today.test.ts läses
fil: server/test/crm-sandvag.test.ts läses
fil: server/test/entity-links.test.ts läses
fil: server/test/min-sida.test.ts läses
fil: server/test/arende-projektkoppling.test.ts läses
fil: server/test/rls-katalog.test.ts läses
fil: server/test/uppdragsytan-utskick.test.ts läses
fil: server/test/payroll-tax-dublett.test.ts läses
fil: server/test/fakturanummer-samtidighet.test.ts läses
fil: server/test/draft-delete.test.ts läses
fil: server/test/crm-sfar-svep.ts läses
fil: docs/project-context.md läses
fil: docs/ARKITEKTUR.md läses
fil: CLAUDE.md läses
fil: _bmad-output/planning-artifacts/prd.md läses
fil: _bmad-output/planning-artifacts/epics.md läses
fil: _bmad-output/planning-artifacts/architecture.md läses
prov: crm-org-name-norm nytt GRÖN
prov: crm-rules ändras GRÖN
prov: crm-name-alias ändras GRÖN
prov: crm-event-provenance berörs GRÖN
prov: crm-status-link berörs GRÖN
prov: crm-views berörs GRÖN
prov: crm-provenance berörs GRÖN
prov: crm-cadence-merge-search berörs GRÖN
prov: crm-schema berörs GRÖN
prov: crm-derivations berörs GRÖN
prov: crm-sfar berörs GRÖN
prov: crm-sfar-3 berörs GRÖN
prov: crm-sfar-yta berörs GRÖN
prov: crm-gdpr-replay berörs GRÖN
prov: crm-stadning berörs GRÖN
prov: crm-actions-ui berörs GRÖN
prov: crm-design-parity berörs GRÖN
prov: crm-retention-ui berörs GRÖN
prov: crm-review-fixes berörs GRÖN
prov: crm-finish berörs GRÖN
prov: crm-thread berörs GRÖN
prov: crm-today berörs GRÖN
prov: crm-sandvag berörs GRÖN
prov: entity-links berörs GRÖN
prov: min-sida berörs GRÖN
prov: arende-projektkoppling berörs GRÖN
prov: rls-katalog berörs GRÖN
prov: uppdragsytan-utskick berörs GRÖN
prov: payroll-tax-dublett berörs GRÖN
prov: fakturanummer-samtidighet berörs GRÖN
prov: draft-delete berörs GRÖN
tjanst: 127.0.0.1:5433 vitest kör provfilerna och migrationskedjan mot den stående testdatabasen
```

- **Tjänsten** är testdatabasen som kedjan cto kör hela sviten mot, och enligt förteckningen över kedjans förmågor (härledd 2026-11-20 07.35) den enda adress proven får nå. M4 och M5 skapar och tar bort en egen databas på samma server genom underhållsanslutningen, som `server/test/crm-event-provenance.test.ts` redan gör. Utvecklarens sandlåda når ofta inte servern, och det är aldrig ett HALT-skäl (Tasks, «Utan kommandon»).
- **Läsfilerna** utöver de ändrade:
  - `server/src/services/crmIngest.ts` kör varje händelse i en savepoint och lägger `{ index, reason: err.message }` i `skipped` när något kastar (rad 111–191). Organisationen skrivs först (rad 127–144), före personen och händelsen. Filen ändras inte: spärren i `upsertOrganization` ger intaget sitt utfall.
  - `server/src/services/crmMerge.ts`, `server/src/services/crmPrivat.ts`, `server/src/services/crmSfarByte.ts` och `server/src/services/gdpr.ts` är de övriga skrivpunkterna på `crm.organizations`. De läses i skrivpunktskontrollen (4.3) och än
```

## Utfall
Tester: 183 passed (183) · Granskning: GODKANT | Alla fem acceptanskriterier och kryssade uppgifter är uppfyllda; inga konkreta fel hittades och kedjans verifierade testutfall är grönt. · Byggforsok: 1

## Modellkedja (Davids krav 17/8, reservvag 7/9)

* krav: kordes inte
* utveckling: **gpt-6.1-sol**
* granskning: **gpt-6-astra**

Granskaren ar inte forfattaren: gpt-6-astra granskade gpt-6.1-sols arbete.

effort (Davids beslut 20/10): create-story high · validering high — planeringssteg
Allt pa Davids abonnemang - inga API-tokens.
