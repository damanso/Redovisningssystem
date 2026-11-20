# PRD-bygget crm 1-8-kundkortets-org-nr-galler-for-en-kopplad-relation — PRD crm 1-8-kundkortets-org-nr-galler-for-en-kopplad-relation: # Story 1.8: Kundkortets org.nr gälle

Datum: 2026-11-20 23:57 · Branch: cto/prd-crm-1-8-kundkortets-org-nr-galler-for-en-kopplad-relatio-9308 · Kalla: 02-Områden/hermes/prd/crm-1c-prd.md (fryst 29/9, Davids beslut #194)

## Mal
PRD crm 1-8-kundkortets-org-nr-galler-for-en-kopplad-relation: # Story 1.8: Kundkortets org.nr gäller för en kopplad relation Status: ready-for-dev <!-- Note: Validation is optional. 

## PRD-kravet (ordagrant ur den frysta PRD:n) och astras kodgranskning
```
# Story 1.8: Kundkortets org.nr gäller för en kopplad relation

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

Som David,
vill jag att relationssidan visar och redigerar kundkortets org.nr för en kopplad relation, och relationens eget bara för ett prospekt utan kundkort,
så att det bara finns en sanning om bolagets organisationsnummer.

Kodbas: redovisning (kedjan cto) · Täcker: FR-11 (Davids svar 2026-10-13 på PRD fråga 7, underlag/davids-svar.md), FR-10 (org.nr rättas från relationssidan) · Beror på: 1.4 och 1.5, båda done och i basen. 1.4 gav kundvalet i *Rätta uppgifter* och regeln att en människas rättelse med `organization_id` inte gör något kunduppslag. 1.5 gav faktakortet *Kundkortet*, grenen `?handgrepp=kundkort` med `rattaKundkortet` och den rena tolkningen `correctedCustomerFields`. 1.7 är också done och la `customer_number` i samma tillåtelselista. · Arkitektur: åtgärdstabellens rad för `upsert_crm_organization` («`org_number` för en kopplad relation avvisas med hänvisning till `update_customer` (FR-11, Davids svar 2026-10-13)»), «Ett flöde, tre ingångar», dataägarskapet (`customers` ägs av redovisningen) och UX K2 («Org.nr när relationen är kopplad: raden visar kundkortets org.nr (`customers.org_number`) utan ✦ och med hinten *Sparas i kundregistret* … Två org.nr visas aldrig bredvid varandra.»).

Berättelsen skrevs 2026-11-20 ur epics.md (Story 1.8, kriterierna ordagrant), PRD:ns FR-10 och FR-11 med fråga 7, Davids svar 2026-10-13, arkitekturens åtgärdstabell, UX-specifikationens K2, berättelserna 1.4, 1.5 och 1.7 och koden i arbetskopian. Bygget lägger ingen migration, ingen ny rutt, ingen ny åtgärd, ingen ny tabell och ingen CSS-klass. `upsertOrganization` får en regel för kopplade relationer. Intagets svar får listan `kept_customer_fields`, så att ett org.nr som intaget inte skrev redovisas i stället för att försvinna tyst. Kundkortets tillåtelselista får `org_number`. Relationssidan visar kundkortets org.nr i *Uppgifter* och får ett litet org.nr-formulär i *Rätta uppgifter*, som postar till 1.5:s befintliga kundkortsgren.

## Förkrav

Blocket nedan är berättelsens hela yta. Fem saker om formen:

- **Beroendena.** Raderna `beroende:` nämner paket som redan finns i serverns paketmanifest, och inget paket läggs till. Förkontrollens K5 läser för redovisningen manifestet i repots översta katalog, där bara arbetsytorna finns. Raderna kan därför bli RÖDA med ursprunget «david» fast inget paket är nytt. Det är ett känt utfall och inget stopp; 1.1–1.7 har samma rader.
- **Inga kontraktsrader.** Berättelsen lägger ingen rutt och läser ingen annan dels rutt, fil eller funktion. Org.nr-formuläret postar till `/c/:companyId/relations/:id/edit?handgrepp=kundkort`, som redan finns (1.5) och redan står i navigationskontraktet. Hermes intag skickar organisationer bara genom `ingest_crm_events`. Regeln lägger en lista till i intagets svar, `kept_customer_fields` (Dev Notes, «Tjänstens regel»). Svaret är redovisningens eget och ingen annan dels yta. Hermes intagsskript läser svaret med get och bara de nycklar det känner (crm_ingest, rad 1608), så en ny nyckel ändrar inget där.
- **Inga kommandon.** Byggaren har bara Read, Glob, Grep, Write, Edit och TodoWrite. Kedjan kör `npm ci`, typkontrollen, bygget och hela vitest-sviten efter utvecklarens sista ändring.
- **Proven.** Byggkedjan för redovisningen kör vitest-sviten. Hermes egna prov under hermes/prov körs inte av den kedjan, och därför står inget sådant prov här (Dev Notes, «Baslinjen»). Berörsraderna är de befintliga vitest-filerna som skriver eller renderar en relations org.nr, anropar `upsert_crm_organization`, `ingest_crm_events` eller `update_customer`, läser de två dokumenten eller söker igenom serverns källträd (Dev Notes, «Regressionsytan»). Deras läge är kedjans senaste gröna svit, efter godkänd granskning av 1.7 (186 passed).
- **Läsfilerna** förklaras under blocket.

```förkrav
fil: server/src/services/crmRelations.ts ändras
fil: server/src/services/crmIngest.ts ändras
fil: server/src/lib/crmRules.ts ändras
fil: server/src/http/view/routes.ts ändras
fil: server/test/crm-views.test.ts ändras
fil: server/test/crm-rules.test.ts ändras
fil: docs/crm/API_KONTRAKT.md ändras
fil: docs/MCP_ACTIONS.md ändras
fil: docs/STATUS.md ändras
fil: server/src/services/crmProvenance.ts läses
fil: server/src/services/crmMerge.ts läses
fil: server/src/services/crmPrivat.ts läses
fil: server/src/services/gdpr.ts läses
fil: server/src/services/parties.ts läses
fil: server/src/actions/registry.ts läses
fil: server/src/actions/execute.ts läses
fil: server/src/lib/errors.ts läses
fil: server/src/lib/validation.ts läses
fil: server/src/http/middleware/errorHandler.ts läses
fil: server/src/http/view/html.ts läses
fil: server/src/db/tx.ts läses
fil: server/kontrakt/navigation.v1.json läses
fil: server/migrations/0003_audit_log.sql läses
fil: server/migrations/0009_settings_and_parties.sql läses
fil: server/migrations/0052_crm_schema.sql läses
fil: server/migrations/0055_link_orgs_to_customers.sql läses
fil: server/test/helpers.ts läses
fil: server/test/setup.ts läses
fil: server/test/sandvagHelper.ts läses
fil: server/test/utskickHelper.ts läses
fil: server/test/crm-provenance.test.ts läses
fil: server/test/crm-design-parity.test.ts läses
fil: server/test/crm-review-fixes.test.ts läses
fil: server/test/crm-finish.test.ts läses
fil: server/test/crm-cadence-merge-search.test.ts läses
fil: server/test/crm-org-name-norm.test.ts läses
fil: server/test/crm-status-link.test.ts läses
fil: server/test/crm-event-provenance.test.ts läses
fil: server/test/crm-sfar.test.ts läses
fil: server/test/crm-sfar-3.test.ts läses
fil: server/test/crm-thread.test.ts läses
fil: server/test/crm-name-alias.test.ts läses
fil: server/test/crm.test.ts läses
fil: server/test/gdpr.test.ts läses
fil: server/test/view-create-flows.test.ts läses
fil: server/test/party-update.test.ts läses
fil: server/test/entity-links.test.ts läses
fil: server/test/radlangd.test.ts läses
fil: server/test/crm-sandvag.test.ts läses
fil: server/test/uppdragsytan-utskick.test.ts läses
fil: server/test/uppdragsytan-beslut.test.ts läses
fil: server/test/uppdragsytan-undantag.test.ts läses
fil: server/test/uppdragsytan-godkannandevag.test.ts läses
fil: server/test/uppdragsytan-baselineorsak.test.ts läses
fil: server/test/vat-declaration.test.ts läses
fil: server/test/kvittobilagor-lagring.test.ts läses
fil: server/test/draft-delete.test.ts läses
fil: server/test/payroll-tax-dublett.test.ts läses
fil: server/test/voucher-links.test.ts läses
fil: server/test/fakturanummer-samtidighet.test.ts läses
fil: server/test/crm-actions-ui.test.ts läses
fil: server/test/crm-derivations.test.ts läses
fil: server/test/crm-gdpr-replay.test.ts läses
fil: server/test/crm-retention-ui.test.ts läses
fil: server/test/crm-schema.test.ts läses
fil: server/test/crm-sfar-yta.test.ts läses
fil: server/test/crm-stadning.test.ts läses
fil: server/test/crm-today.test.ts läses
fil: server/test/forslagskort-klartext.test.ts läses
fil: server/test/min-sida.test.ts läses
fil: server/test/vy-kansliga-knappar.test.ts läses
fil: docs/project-context.md läses
fil: CLAUDE.md läses
fil: _bmad-output/planning-artifacts/prd.md läses
fil: _bmad-output/planning-artifacts/epics.md läses
fil: _bmad-output/planning-artifacts/architecture.md läses
fil: _bmad-output/planning-artifacts/ux-design-specification.md läses
fil: _bmad-output/implementation-artifacts/1-5-kundkortets-fakturauppgifter-rattas-fran-relationssidan.md läses
fil: _bmad-output/implementation-artifacts/1-7-kundnumret-gar-att-ratta-fran-relationssidan.md läses
prov: crm-views ändras GRÖN
prov: crm-rules ändras GRÖN
prov: crm-provenance berörs GRÖN
prov: crm-design-parity berörs GRÖN
prov: crm-review-fixes berörs GRÖN
prov: crm-finish berörs GRÖN
prov: crm-cadence-merge-search berörs GRÖN
prov: crm-org-name-norm berörs GRÖN
prov: crm-status-link berörs GRÖN
prov: crm-
```

## Utfall
Tester: 187 passed (187) · Granskning: GODKANT | Alla fyra acceptanskriterier och kryssade uppgifter är uppfyllda; inga belagda fynd, och kedjans typkontroll och testsvit är gröna. · Byggforsok: 1

## Modellkedja (Davids krav 17/8, reservvag 7/9)

* krav: kordes inte
* utveckling: **gpt-6.1-sol**
* granskning: **gpt-6-astra**

Granskaren ar inte forfattaren: gpt-6-astra granskade gpt-6.1-sols arbete.

effort (Davids beslut 20/10): create-story high · validering high — planeringssteg
Allt pa Davids abonnemang - inga API-tokens.
