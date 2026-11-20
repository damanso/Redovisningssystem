# PRD-bygget crm 1-7-kundnumret-gar-att-ratta-fran-relationssidan — PRD crm 1-7-kundnumret-gar-att-ratta-fran-relationssidan: # Story 1.7: Kundnumret går att rätta från

Datum: 2026-11-20 20:32 · Branch: cto/prd-crm-1-7-kundnumret-gar-att-ratta-fran-relationssidan-9305 · Kalla: 02-Områden/hermes/prd/crm-1c-prd.md (fryst 29/9, Davids beslut #194)

## Mal
PRD crm 1-7-kundnumret-gar-att-ratta-fran-relationssidan: # Story 1.7: Kundnumret går att rätta från relationssidan Status: ready-for-dev <!-- Note: Validation is optional. Run v

## PRD-kravet (ordagrant ur den frysta PRD:n) och astras kodgranskning
```
# Story 1.7: Kundnumret går att rätta från relationssidan

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

Som David,
vill jag kunna rätta den kopplade kundens kundnummer från relationssidan,
så att inget av kundkortets fält kräver att jag öppnar kundkortet.

Kodbas: redovisning (kedjan cto) · Täcker: FR-10 (kundnumret rättas från relationssidan via `update_customer`; PRD fråga 8 är struken) · Beror på: 1.5 (done och i basen: faktakortet *Kundkortet*, formuläret *Rätta fakturauppgifter*, grenen `?handgrepp=kundkort` och de rena funktionerna `correctedCustomerFields` och `parseEditTarget`) · Arkitektur: åtgärdstabellens rad för `update_customer` (valfritt `customer_number`, heltal ≥ 1, unikt per bolag; serien `number_sequences` med `kind = 'customer'` flyttas förbi det satta numret i samma transaktion; `write` oförändrat), «Ett flöde, tre ingångar», dataägarskapet (`customers` ägs av redovisningen och kopieras aldrig till `crm`) och UX K3 («Kundnumret: rättas i *Rätta fakturauppgifter* via `update_customer`, utökad med `customer_number`»).

Berättelsen skrevs 2026-11-20 ur epics.md (Story 1.7, kriterierna ordagrant), PRD:ns FR-10, arkitekturens åtgärdstabell, UX-specifikationens K3, föregående berättelser 1.5 och 1.6 och koden i arbetskopian. Bygget lägger ingen migration, ingen ny rutt, ingen ny åtgärd, ingen ny tabell och ingen CSS-klass. Åtgärden `update_customer` får ett nytt valfritt fält, tjänsten `updateCustomer` flyttar kundserien, den rena tolkningen av formuläret får fältet, och formuläret *Rätta fakturauppgifter* får en inmatning för kundnumret.

## Förkrav

Blocket nedan är berättelsens hela yta. Fem saker om formen:

- **Beroendena.** Raderna `beroende:` nämner paket som redan finns i serverns paketmanifest, och inget paket läggs till. Förkontrollens K5 läser för redovisningen manifestet i repots översta katalog, där bara arbetsytorna finns. Raderna kan därför bli RÖDA med ursprunget «david» fast inget paket är nytt. Det är ett känt utfall och inget stopp; 1.1–1.6 har samma rader.
- **Inga kontraktsrader.** Berättelsen lägger ingen rutt och läser ingen annan dels rutt, fil eller funktion. POST-rutten `/c/:companyId/relations/:id/edit` står redan i navigationskontraktet. Hermes anropar inte `update_customer` för att skriva: intagets läsväg avvisar åtgärden (hermes/prov/crmintag.py fall N4), och ett nytt valfritt fält ändrar inget för den som inte skickar det.
- **Inga kommandon.** Byggaren har bara Read, Glob, Grep, Write, Edit och TodoWrite. Kedjan kör `npm ci`, typkontrollen, bygget och hela vitest-sviten efter utvecklarens sista ändring.
- **Proven.** Byggkedjan för redovisningen kör vitest-sviten. Hermes egna prov under hermes/prov körs inte av den kedjan, och därför står inget sådant prov här (Dev Notes, «Baslinjen»). Berörsraderna är de befintliga vitest-filer som renderar relationssidan, anropar `update_customer`, läser `docs/MCP_ACTIONS.md`, låser nummerserier eller söker igenom serverns källträd (Dev Notes, «Regressionsytan»). Deras läge är kedjans senaste gröna svit, efter godkänd granskning av 1.5.
- **Läsfilerna** förklaras under blocket.

```förkrav
fil: server/src/lib/validation.ts ändras
fil: server/src/actions/registry.ts ändras
fil: server/src/services/parties.ts ändras
fil: server/src/lib/crmRules.ts ändras
fil: server/src/http/view/routes.ts ändras
fil: server/test/crm-views.test.ts ändras
fil: server/test/crm-rules.test.ts ändras
fil: docs/MCP_ACTIONS.md ändras
fil: docs/STATUS.md ändras
fil: server/src/services/accounting/numbering.ts läses
fil: server/src/services/invoiceNumbering.ts läses
fil: server/src/services/invoices.ts läses
fil: server/src/services/pdfService.ts läses
fil: server/src/lib/errors.ts läses
fil: server/src/lib/updateBuilder.ts läses
fil: server/src/services/auditService.ts läses
fil: server/src/services/gdpr.ts läses
fil: server/src/actions/execute.ts läses
fil: server/src/http/middleware/errorHandler.ts läses
fil: server/src/http/routes/parties.ts läses
fil: server/src/db/tx.ts läses
fil: server/src/services/crmRelations.ts läses
fil: server/kontrakt/navigation.v1.json läses
fil: server/migrations/0003_audit_log.sql läses
fil: server/migrations/0007_vouchers.sql läses
fil: server/migrations/0009_settings_and_parties.sql läses
fil: server/migrations/0011_party_company_fk.sql läses
fil: server/test/helpers.ts läses
fil: server/test/setup.ts läses
fil: server/test/sandvagHelper.ts läses
fil: server/test/utskickHelper.ts läses
fil: server/test/party-update.test.ts läses
fil: server/test/fakturanummer-samtidighet.test.ts läses
fil: server/test/crm-event-provenance.test.ts läses
fil: server/test/payroll-tax-dublett.test.ts läses
fil: server/test/voucher-links.test.ts läses
fil: server/test/allowlist.test.ts läses
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
fil: server/test/draft-delete.test.ts läses
fil: hermes/prov/crmintag.py läses
fil: docs/project-context.md läses
fil: docs/crm/API_KONTRAKT.md läses
fil: CLAUDE.md läses
fil: _bmad-output/planning-artifacts/prd.md läses
fil: _bmad-output/planning-artifacts/epics.md läses
fil: _bmad-output/planning-artifacts/architecture.md läses
fil: _bmad-output/planning-artifacts/ux-design-specification.md läses
fil: _bmad-output/implementation-artifacts/1-5-kundkortets-fakturauppgifter-rattas-fran-relationssidan.md läses
prov: crm-views ändras GRÖN
prov: crm-rules ändras GRÖN
prov: party-update berörs GRÖN
prov: fakturanummer-samtidighet berörs GRÖN
prov: crm-event-provenance berörs GRÖN
prov: payroll-tax-dublett berörs GRÖN
prov: voucher-links berörs GRÖN
prov: allowlist berörs GRÖN
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
prov: draft-delete berörs GRÖN
beroende: pg
beroende: express
beroende: zod
beroende: vitest
beroende: supertest
tjanst: 127.0.0.1:5433 vitest kör provfilerna mot den stående testdatabasen
```

- **Tjänsten** är testdatabasen som kedjan cto kör hela sviten mot. Enligt förteckningen över kedjans förmågor (härledd 2026-11-20 19.35) är den den enda adress proven får nå. Utvecklarens sandlåda når den ofta inte, och det är aldrig ett HALT-skäl (Tasks, «Utan kommandon»).
- **Läsfilerna** utöver de ändrade:
  - `server/src/services/accounting/numbering.ts` ger `nextDocumentNumber` (rad 30–44): en upsert på `number_sequences` som tar radlåset, sätter `next_value` till 2 första gången och annars ökar den med 1, och returnerar det tidigare värdet. `next_value` är alltså alltid 
```

## Utfall
Tester: 186 passed (186) · Granskning: GODKANT | Alla fyra acceptanskriterier är implementerade och inga konkreta fel hittades; kedjans verifierade testutfall är 186 passed. · Byggforsok: 1

## Modellkedja (Davids krav 17/8, reservvag 7/9)

* krav: kordes inte
* utveckling: **gpt-6.1-sol**
* granskning: **gpt-6-astra**

Granskaren ar inte forfattaren: gpt-6-astra granskade gpt-6.1-sols arbete.

effort (Davids beslut 20/10): create-story high · validering high — planeringssteg
Allt pa Davids abonnemang - inga API-tokens.
