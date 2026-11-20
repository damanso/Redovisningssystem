# PRD-bygget crm 1-5-kundkortets-fakturauppgifter-rattas-fran-relationssidan — PRD crm 1-5-kundkortets-fakturauppgifter-rattas-fran-relationssidan: # Story 1.5: Kundkortets faktur

Datum: 2026-11-20 12:33 · Branch: cto/prd-crm-1-5-kundkortets-fakturauppgifter-rattas-fran-relatio-9297 · Kalla: 02-Områden/hermes/prd/crm-1c-prd.md (fryst 29/9, Davids beslut #194)

## Mal
PRD crm 1-5-kundkortets-fakturauppgifter-rattas-fran-relationssidan: # Story 1.5: Kundkortets fakturauppgifter rättas från relationssidan Status: ready-for-dev <!-- Note: Validation is opti

## PRD-kravet (ordagrant ur den frysta PRD:n) och astras kodgranskning
```
# Story 1.5: Kundkortets fakturauppgifter rättas från relationssidan

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

Som David,
vill jag se och rätta den kopplade kundens fakturauppgifter på relationssidan,
så att jag aldrig behöver öppna kundkortet och uppgifterna ändå bara finns på ett ställe.

Kodbas: redovisning (kedjan cto) · Täcker: FR-10 (kundens fakturauppgifter rättas från relationssidan via `update_customer`, lucka 24), FR-11 (ingen dubbellagring) · Beror på: — (1.3, 1.4 och 1.6 är done och ligger i basen; berättelsen lägger sitt kort bredvid deras och ändrar dem inte) · Arkitektur: «Ett flöde, tre ingångar» (vyn är en klient till samma åtgärd som AI:t), dataägarskapet (`customers` ägs av redovisningen och kopieras aldrig till `crm`), Process Patterns (POST-rutternas ordning, inga tysta utfall) och UX K3 (faktakortet *Kundkortet*).

Berättelsen skrevs 2026-11-20 ur epics.md (Story 1.5, kriterierna ordagrant), PRD:ns FR-10 och FR-11, arkitekturens dataägartabell, UX-specifikationens K3, kodgranskningens rad för FR-10, föregående berättelser 1.4 och 1.6 och koden i arbetskopian. Bygget lägger ingen migration, ingen ny rutt, ingen ny åtgärd, inget schema och ingen CSS-klass. Åtgärden `update_customer` används som den är. Relationssidan får ett nytt faktakort, och den befintliga POST-rutten för *Rätta uppgifter* får en gren som väljs i adressen med `?handgrepp=kundkort`.

## Förkrav

Blocket nedan är berättelsens hela yta. Fem saker om formen:

- **Beroendena.** Raderna `beroende:` nämner paket som redan finns i serverns paketmanifest, och inget paket läggs till. Förkontrollens K5 läser för redovisningen manifestet i repots översta katalog, där bara arbetsytorna finns. Raderna kan därför bli RÖDA med ursprunget «david» fast inget paket är nytt. Det är ett känt utfall och inget stopp; 1.1–1.6 har samma rader.
- **Inga kontraktsrader.** Berättelsen lägger ingen rutt och läser ingen annan dels rutt, fil eller funktion. POST-rutten `/c/:companyId/relations/:id/edit` står redan i `server/kontrakt/navigation.v1.json`. Adresskontraktets prov är RÖTT i basen av skäl utanför berättelsen (Dev Notes, «Baslinjen»), och ett kontrakt som pekar på det provet kan inte bli grönt.
- **Inga kommandon.** Byggaren har bara Read, Glob, Grep, Write, Edit och TodoWrite. Kedjan kör `npm ci`, typkontrollen, bygget och hela vitest-sviten efter utvecklarens sista ändring.
- **Proven.** Byggkedjan för redovisningen kör vitest-sviten. Hermes egna prov under hermes/prov körs inte av den kedjan, och därför står inget sådant prov här (Dev Notes, «Baslinjen»). Berörsraderna är de befintliga vitest-filer som renderar relationssidan, postar till den ändrade rutten eller söker igenom serverns källträd (Dev Notes, «Regressionsytan»).
- **Läsfilerna** förklaras under blocket.

```förkrav
fil: server/src/lib/crmRules.ts ändras
fil: server/src/http/view/routes.ts ändras
fil: server/test/crm-rules.test.ts ändras
fil: server/test/crm-views.test.ts ändras
fil: docs/STATUS.md ändras
fil: server/src/lib/validation.ts läses
fil: server/src/services/parties.ts läses
fil: server/src/actions/registry.ts läses
fil: server/src/actions/execute.ts läses
fil: server/src/services/crmRelations.ts läses
fil: server/src/services/auditService.ts läses
fil: server/src/services/invoices.ts läses
fil: server/src/http/view/html.ts läses
fil: server/src/http/routes/parties.ts läses
fil: server/src/db/tx.ts läses
fil: server/src/lib/errors.ts läses
fil: server/kontrakt/navigation.v1.json läses
fil: server/migrations/0052_crm_schema.sql läses
fil: server/test/helpers.ts läses
fil: server/test/setup.ts läses
fil: server/test/sandvagHelper.ts läses
fil: server/test/utskickHelper.ts läses
fil: server/test/crm-design-parity.test.ts läses
fil: server/test/entity-links.test.ts läses
fil: server/test/radlangd.test.ts läses
fil: server/test/crm-provenance.test.ts läses
fil: server/test/crm-org-name-norm.test.ts läses
fil: server/test/crm-review-fixes.test.ts läses
fil: server/test/crm-thread.test.ts läses
fil: server/test/crm-name-alias.test.ts läses
fil: server/test/crm-cadence-merge-search.test.ts läses
fil: server/test/crm-status-link.test.ts läses
fil: server/test/crm-sfar-3.test.ts läses
fil: server/test/crm-sandvag.test.ts läses
fil: server/test/uppdragsytan-utskick.test.ts läses
fil: server/test/uppdragsytan-beslut.test.ts läses
fil: server/test/uppdragsytan-undantag.test.ts läses
fil: server/test/uppdragsytan-godkannandevag.test.ts läses
fil: server/test/uppdragsytan-baselineorsak.test.ts läses
fil: server/test/vat-declaration.test.ts läses
fil: server/test/kvittobilagor-lagring.test.ts läses
fil: docs/project-context.md läses
fil: docs/MCP_ACTIONS.md läses
fil: docs/crm/API_KONTRAKT.md läses
fil: CLAUDE.md läses
fil: _bmad-output/planning-artifacts/prd.md läses
fil: _bmad-output/planning-artifacts/epics.md läses
fil: _bmad-output/planning-artifacts/architecture.md läses
fil: _bmad-output/planning-artifacts/ux-design-specification.md läses
fil: _bmad-output/planning-artifacts/underlag/davids-svar.md läses
prov: crm-rules ändras GRÖN
prov: crm-views ändras GRÖN
prov: crm-design-parity berörs GRÖN
prov: entity-links berörs GRÖN
prov: radlangd berörs GRÖN
prov: crm-provenance berörs GRÖN
prov: crm-org-name-norm berörs GRÖN
prov: crm-review-fixes berörs GRÖN
prov: crm-thread berörs GRÖN
prov: crm-name-alias berörs GRÖN
prov: crm-cadence-merge-search berörs GRÖN
prov: crm-status-link berörs GRÖN
prov: crm-sfar-3 berörs GRÖN
prov: crm-sandvag berörs GRÖN
prov: uppdragsytan-utskick berörs GRÖN
prov: uppdragsytan-beslut berörs GRÖN
prov: uppdragsytan-undantag berörs GRÖN
prov: uppdragsytan-godkannandevag berörs GRÖN
prov: uppdragsytan-baselineorsak berörs GRÖN
prov: vat-declaration berörs GRÖN
prov: kvittobilagor-lagring berörs GRÖN
beroende: pg
beroende: express
beroende: zod
beroende: vitest
beroende: supertest
tjanst: 127.0.0.1:5433 vitest kör provfilerna mot den stående testdatabasen
```

- **Tjänsten** är testdatabasen som kedjan cto kör hela sviten mot. Enligt förteckningen över kedjans förmågor (härledd 2026-11-20 10.05) är den den enda adress proven får nå. Utvecklarens sandlåda når den ofta inte, och det är aldrig ett HALT-skäl (Tasks, «Utan kommandon»).
- **Läsfilerna** utöver de ändrade:
  - `server/src/lib/validation.ts` ger husets `EmailSchema` (rad 30–35: trim, e-postform, högst 254 tecken, gemener), som den nya rena funktionen prövar fakturamejlet med. Filen ändras inte.
  - `server/src/services/parties.ts` ger `getCustomer` (rad 50–54; kastar `NotFoundError('customer')`), `CUSTOMER_COLUMNS` (rad 12–13) och `updateCustomer` (rad 56–71). Den sistnämnda bygger UPDATE via `buildAllowlistedUpdate(CUSTOMER_UPDATE, …)`, skriver auditraden `customer.updated` med `details.fields` = de skickade fältens namn och returnerar kunden oförändrad, utan auditrad, när inget fält skickas. Filen ändras inte.
  - `server/src/actions/registry.ts` ger åtgärden `update_customer` (rad 1157–1182, `write`, `.strict()`): `customer_id` och de valfria fälten `name`, `org_number`, `vat_number` (högst 20), `email` (högst 254, ingen formkontroll), `phone` (50), `address` (200), `postal_code` (20), `city` (100), `payment_terms` (heltal 0–365) och `is_active`. Den ändras inte; 1.7 utökar den med `customer_number`.
  - `server/src/actions/execute.ts` ger `executeAction`, som `runViewAction` anropar med `actor: 'human'`, och dess auditrad `action.executed` (rad 93–96, `entity_id` = åtgärdens namn), som provets `v15Anrop` räknar. `server/src/db/tx.ts` ger `withTenantTransaction`. `server/src/lib/errors.ts` ger `NotFoundError`.
  - `server/src/services/crmRelations.ts` ger `getOrganization` (rad 645–655; kastar `NotFoundError('organization')` när relationen inte finns i bolaget) och dess fält `customer_id`. Filen ändras inte.
  - `server/src/services/auditService.ts` visar att `writeAudit` skriver i tabellen `audit_log` i det publika schemat, aldrig i `
```

## Utfall
Tester: 184 passed (184) · Granskning: GODKANT | Alla fyra acceptanskriterier är implementerade, auditfrågorna är rättade och kedjans verifierade testkörning är grön. · Byggforsok: 2

## Modellkedja (Davids krav 17/8, reservvag 7/9)

* krav: kordes inte
* utveckling: **gpt-6.1-sol**
* granskning: **gpt-6-astra**

Granskaren ar inte forfattaren: gpt-6-astra granskade gpt-6.1-sols arbete.

effort: ingen Claude-start i den här körningen
Allt pa Davids abonnemang - inga API-tokens.
