# PRD-bygget crm 1-6-en-manniskosatt-status-star-kvar-nar-kundkopplingen-tillkommer-eller-flyttas — PRD crm 1-6-en-manniskosatt-status-star-kvar-nar-kundkopplingen-tillkommer-eller-flyttas: # Story 1.

Datum: 2026-11-20 06:54 · Branch: cto/prd-crm-1-6-en-manniskosatt-status-star-kvar-nar-kundkopplin-9292 · Kalla: 02-Områden/hermes/prd/crm-1c-prd.md (fryst 29/9, Davids beslut #194)

## Mal
PRD crm 1-6-en-manniskosatt-status-star-kvar-nar-kundkopplingen-tillkommer-eller-flyttas: # Story 1.6: En människosatt status står kvar när kundkopplingen tillkommer eller flyttas Status: ready-for-dev <!-- Not

## PRD-kravet (ordagrant ur den frysta PRD:n) och astras kodgranskning
```
# Story 1.6: En människosatt status står kvar när kundkopplingen tillkommer eller flyttas

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

Som David,
vill jag att en status jag satt eller bekräftat står kvar när systemet kopplar relationen till en kund eller när två relationer slås ihop — och att Att göra säger vad som händer med statusen innan jag godkänner,
så att varken synken eller en sammanslagning ändrar mitt beslut i det tysta.

Kodbas: redovisning (kedjan cto) · Täcker: FR-12 (statusen och de ifyllda fälten står kvar vid sammanslagning), FR-8 (automatisk kundkoppling ändrar inte en människosatt status) · Beror på: — (1.4 är done och i basen; berättelsen bygger på dess `assertCustomerFree` och dess fall men ändrar dem inte) · Arkitektur: A-5 (`statusAfterLink`, samma regel i körning och förhandsvisning), A-1 (ursprung per fält, «människan vinner»), Process Patterns (radlås före människovakten, inga tysta utfall) och UX K13 (godkännandekortet för sammanslagning).

Berättelsen skrevs 2026-11-20 ur epics.md (Story 1.6, kriterierna ordagrant), PRD:ns FR-12 och FR-8, arkitekturens A-5, kodgranskningens fynd för FR-8 och FR-12, föregående berättelse 1.4 och koden i arbetskopian. Bygget lägger ingen migration, ingen rutt, ingen åtgärd, inget schema och ingen CSS-klass. Det byter två statusregler i SQL (`CASE WHEN … status = 'prospect' THEN 'customer'`) mot en ren funktion i TypeScript och låter Att göra-kortet läsa samma funktion.

## Förkrav

Blocket nedan är berättelsens hela yta. Fyra saker om formen:

- **Beroendena.** Raderna `beroende:` nämner paket som redan finns i serverns paketmanifest; inget paket läggs till. Förkontrollens K5 läser för redovisningen manifestet i repots översta katalog, och där finns bara arbetsytor. Raderna kan därför bli RÖDA med ursprunget «david», fast inget paket är nytt. Det är ett känt utfall och inget stopp; 1.1–1.4 och 6.2 har samma rader.
- **Inga kontraktsrader.** Berättelsen läser ingen annan dels rutt, fil eller funktion. `statusAfterLink`, `linkStatusOutcome` och `mergeStatusOutcome` finns inte förrän bygget skapat dem, och ett funktionskontrakt för delen crm ger KUNDE_INTE i förkontrollen. Proven håller i stället löftet: C1 visar att kortet och körningen ger samma utfall.
- **Inga kommandon.** Byggaren har bara Read, Glob, Grep, Write, Edit och TodoWrite. Kedjan kör `npm ci`, typkontrollen, bygget och hela vitest-sviten efter utvecklarens sista ändring.
- **Proven.** Byggkedjan för redovisningen kör vitest-sviten. Hermes egna prov under hermes/prov körs inte av den kedjan, och därför står inget sådant prov här (Dev Notes, «Baslinjen»). Berörsraderna är de befintliga vitest-filer som läser en ändrad fil, ett ändrat beteende eller ett ändrat dokument (Dev Notes, «Regressionsytan»).

```förkrav
fil: server/test/crm-status-link.test.ts ny
fil: server/src/lib/crmRules.ts ändras
fil: server/src/services/crmRelations.ts ändras
fil: server/src/services/crmMerge.ts ändras
fil: server/src/services/approvalSummary.ts ändras
fil: server/src/http/view/routes.ts ändras
fil: server/test/crm-rules.test.ts ändras
fil: docs/MCP_ACTIONS.md ändras
fil: docs/crm/API_KONTRAKT.md ändras
fil: docs/STATUS.md ändras
fil: server/src/services/crmProvenance.ts läses
fil: server/src/services/crmIngest.ts läses
fil: server/src/services/crmSfar.ts läses
fil: server/src/actions/registry.ts läses
fil: server/src/actions/execute.ts läses
fil: server/src/db/tx.ts läses
fil: server/src/lib/errors.ts läses
fil: server/src/http/view/html.ts läses
fil: server/src/services/crmStadning.ts läses
fil: server/src/services/crmPrivat.ts läses
fil: server/src/services/gdpr.ts läses
fil: server/kontrakt/navigation.v1.json läses
fil: server/migrations/0052_crm_schema.sql läses
fil: server/migrations/0057_crm_provenance.sql läses
fil: server/migrations/0087_crm_sfar_och_roll.sql läses
fil: server/test/helpers.ts läses
fil: server/test/env.ts läses
fil: server/test/setup.ts läses
fil: server/test/crm-views.test.ts läses
fil: server/test/crm-cadence-merge-search.test.ts läses
fil: server/test/crm-provenance.test.ts läses
fil: server/test/crm-event-provenance.test.ts läses
fil: server/test/crm-name-alias.test.ts läses
fil: server/test/crm-sfar.test.ts läses
fil: server/test/crm-sfar-3.test.ts läses
fil: server/test/crm-schema.test.ts läses
fil: server/test/crm-derivations.test.ts läses
fil: server/test/crm-design-parity.test.ts läses
fil: server/test/crm-retention-ui.test.ts läses
fil: server/test/crm-sandvag.test.ts läses
fil: server/test/sandvagHelper.ts läses
fil: server/test/uppdragsytan-utskick.test.ts läses
fil: server/test/uppdragsytan-import.test.ts läses
fil: server/test/uppdragsytan-undantag.test.ts läses
fil: server/test/payroll-tax-dublett.test.ts läses
fil: server/test/fakturanummer-samtidighet.test.ts läses
fil: server/test/draft-delete.test.ts läses
fil: docs/project-context.md läses
fil: docs/ARKITEKTUR.md läses
fil: CLAUDE.md läses
fil: _bmad-output/planning-artifacts/prd.md läses
fil: _bmad-output/planning-artifacts/epics.md läses
fil: _bmad-output/planning-artifacts/architecture.md läses
fil: _bmad-output/planning-artifacts/ux-design-specification.md läses
fil: _bmad-output/planning-artifacts/underlag/davids-svar.md läses
prov: crm-status-link nytt GRÖN
prov: crm-rules ändras GRÖN
prov: crm-views berörs GRÖN
prov: crm-cadence-merge-search berörs GRÖN
prov: crm-provenance berörs GRÖN
prov: crm-event-provenance berörs GRÖN
prov: crm-name-alias berörs GRÖN
prov: crm-sfar berörs GRÖN
prov: crm-sfar-3 berörs GRÖN
prov: crm-schema berörs GRÖN
prov: crm-derivations berörs GRÖN
prov: crm-design-parity berörs GRÖN
prov: crm-retention-ui berörs GRÖN
prov: crm-sandvag berörs GRÖN
prov: uppdragsytan-utskick berörs GRÖN
prov: uppdragsytan-import berörs GRÖN
prov: uppdragsytan-undantag berörs GRÖN
prov: payroll-tax-dublett berörs GRÖN
prov: fakturanummer-samtidighet berörs GRÖN
prov: draft-delete berörs GRÖN
beroende: pg
beroende: express
beroende: vitest
beroende: supertest
tjanst: 127.0.0.1:5433 vitest kör provfilerna mot den stående testdatabasen
```

- **Tjänsten** är testdatabasen som kedjan cto kör hela sviten mot, och enligt förteckningen över kedjans förmågor (härledd 2026-11-20 05.55) den enda adress proven får nå. Utvecklarens sandlåda når den ofta inte, och det är aldrig ett HALT-skäl (Tasks, «Utan kommandon»).
- **Läsfilerna** utöver de ändrade:
  - `server/src/services/crmProvenance.ts` ger `readProvenance` (ursprunget per fält som en `Map`), `guardHumanFields` (plockar bort människans fält ur en icke-mänsklig skrivning och returnerar `blocked`), `recordProvenance` och `confirmValue`. `server/src/services/crmIngest.ts` anropar `upsertOrganization` med namn, org.nr och webbplats och prefixar varje fält i `kept_human_fields` med organisationens namn (rad 136). `server/src/services/crmSfar.ts` ger sfärens gränsfel, som berättelsen inte rör. `server/src/services/crmPrivat.ts` (sfär och roll, rad 111 och 581) och `server/src/services/gdpr.ts` (anonymiseringen, rad 120–127, `status = 'archived'`) är de övriga skrivpunkterna på `crm.organizations`; de läses bara i skrivpunktskontrollen (5.3) och ändras inte.
  - Beroendena `pg` (typen `PoolClient` i tjänsterna och i I6:s grind) och `express` (routes.ts) används som i dag; ingen import av ett nytt paket.
  - `server/src/actions/registry.ts` (åtgärderna `merge_crm_organizations` rad 2939–2946, `confirm_crm_value` rad 2724– och `upsert_crm_organization`) ändras inte. `server/src/actions/execute.ts` ger `executeAction`; en `sensitive` åtgärd köas och körs med omvaliderat indata först vid godkännandet. `server/src/db/tx.ts` ger `withTenantTransaction`. `server/src/lib/errors.ts` ger `NotFoundError`. `server/src/http/view/html.ts` ger `html`-mallen som escapar kortets text.
  - Migrationen 0052 ger statusens CHECK-lista (`prospect`, `customer`, `partner`, `former`, `archived`), 0057 ger `crm.field_provenance` med dess 
```

## Utfall
Tester: 182 passed (182) · Granskning: GODKANT | Alla fem acceptanskriterier och kryssade uppgifter är implementerade; inga konkreta fel hittades, och kedjans typkontroll och testsvit är gröna. · Byggforsok: 1

## Modellkedja (Davids krav 17/8, reservvag 7/9)

* krav: kordes inte
* utveckling: **gpt-6.1-sol**
* granskning: **gpt-6-astra**

Granskaren ar inte forfattaren: gpt-6-astra granskade gpt-6.1-sols arbete.

effort (Davids beslut 20/10): create-story high · validering high — planeringssteg
Allt pa Davids abonnemang - inga API-tokens.
