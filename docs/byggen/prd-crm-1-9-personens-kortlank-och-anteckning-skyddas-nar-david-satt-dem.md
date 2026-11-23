# PRD-bygget crm 1-9-personens-kortlank-och-anteckning-skyddas-nar-david-satt-dem — PRD crm 1-9-personens-kortlank-och-anteckning-skyddas-nar-david-satt-dem: # Story 1.9: Personens kor

Datum: 2026-11-23 10:57 · Branch: cto/prd-crm-1-9-personens-kortlank-och-anteckning-skyddas-nar-da-9344 · Kalla: 02-Områden/hermes/prd/crm-1c-prd.md (fryst 29/9, Davids beslut #194)

## Mal
PRD crm 1-9-personens-kortlank-och-anteckning-skyddas-nar-david-satt-dem: # Story 1.9: Personens kortlänk och anteckning skyddas när David satt dem Status: ready-for-dev <!-- Note: Validation is

## PRD-kravet (ordagrant ur den frysta PRD:n) och astras kodgranskning
```
# Story 1.9: Personens kortlänk och anteckning skyddas när David satt dem

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

Som David,
vill jag att personens kortlänk och anteckning bär sitt ursprung och skyddas när jag satt dem,
så att en rättelse jag gjort på en person aldrig skrivs över av nästa nattsynk.

Kodbas: redovisning (kedjan cto) · Täcker: FR-8 (avsteg 1: personens `external_ref` och `notes` bär ursprung och skyddas) · Beror på: 1.1, som är byggd och finns i basen (migrationen `0090_crm_event_provenance.sql`, provet `server/test/crm-event-provenance.test.ts` och låsmönstret «lås raden före vakten» i `recordInteraction` och `recordCommitment`). · Arkitektur: A-1 med tilläggen (3) och (5) i «Samspel med sfären och migrationsnumret» (architecture.md, Data Architecture). · Utbruten ur 1.1 vid correct-course 2026-11-19, andra varvet, efter att bygget #9286 stoppats. Epics-raden säger att det första kriteriet är 1.1:s, ordagrant.

Berättelsen skrevs 2026-11-23 ur epics.md (Story 1.9, kriterierna ordagrant), PRD:ns FR-8, arkitekturens A-1 (3) och (5), kodgranskningens rad för FR-8, berättelserna 1.1 och 1.8 och koden i arbetskopian. Bygget lägger ingen migration, ingen rutt, ingen åtgärd, inget nytt schemafält och ingen tabell. Det ändrar en lista och en funktion i `server/src/services/crmRelations.ts`, lägger en ny provfil och skriver tre dokument.

## Förkrav

Blocket nedan är berättelsens hela yta. Fyra saker om formen:

- **Beroendena.** Raderna `beroende:` nämner paket som redan finns i serverns paketmanifest, och inget paket läggs till. Förkontrollens K5 läser för redovisningen manifestet i repots översta katalog, där bara arbetsytorna finns. Raderna kan därför bli RÖDA med ursprunget «david», fast inget paket är nytt. Det är ett känt utfall och inget stopp; 1.1–1.8 har samma rader.
- **Inga kontraktsrader.** Berättelsen lägger ingen rutt och läser ingen annan dels rutt, fil eller funktion. Hermes intag skickar personer bara genom `ingest_crm_events`, och svarets form är oförändrad: `kept_human_fields` får en post till av den form som redan finns (`"<personens namn>: <fält>"`), och `skipped` får ett skäl till. Hermes intagsskript läser svaret med get och bara de nycklar det känner.
- **Proven.** Kedjan cto kör vitest-sviten. Hermes egna prov under hermes/prov körs inte av den kedjan, och därför står inget sådant prov här (Dev Notes, «Baslinjen»). Berörsraderna är de befintliga vitest-filerna som anropar `upsert_crm_person` eller `ingest_crm_events` med en person, läser `docs/crm/API_KONTRAKT.md`, `docs/MCP_ACTIONS.md` eller `docs/STATUS.md`, eller söker igenom serverns källträd (Dev Notes, «Regressionsytan»). Deras läge är kedjans senaste gröna svit (efter 3.10, commit fb2494e).
- **Inga kommandon.** Byggaren har Read, Glob, Grep, Write, Edit och TodoWrite. Kedjan kör `npm ci`, typkontrollen, bygget och hela vitest-sviten efter utvecklarens sista ändring.

```förkrav
fil: server/src/services/crmRelations.ts ändras
fil: server/test/crm-person-provenance.test.ts ny
fil: docs/crm/API_KONTRAKT.md ändras
fil: docs/MCP_ACTIONS.md ändras
fil: docs/STATUS.md ändras
fil: server/src/services/crmProvenance.ts läses
fil: server/src/services/crmSfar.ts läses
fil: server/src/services/crmIngest.ts läses
fil: server/src/services/crmMerge.ts läses
fil: server/src/services/crmStadning.ts läses
fil: server/src/services/crmSfarByte.ts läses
fil: server/src/actions/registry.ts läses
fil: server/src/lib/errors.ts läses
fil: server/src/http/middleware/errorHandler.ts läses
fil: server/src/db/tx.ts läses
fil: server/migrations/0057_crm_provenance.sql läses
fil: server/migrations/0089_crm_privat_person_utanfor_kunden.sql läses
fil: server/migrations/0090_crm_event_provenance.sql läses
fil: server/test/helpers.ts läses
fil: server/test/setup.ts läses
fil: server/test/sandvagHelper.ts läses
fil: server/test/crm-event-provenance.test.ts läses
fil: server/test/crm-sfar.test.ts läses
fil: server/test/crm-sfar-3.test.ts läses
fil: server/test/crm-schema.test.ts läses
fil: server/test/crm-status-link.test.ts läses
fil: server/test/crm-views.test.ts läses
fil: server/test/crm-commitment-lifecycle.test.ts läses
fil: server/test/crm-org-name-norm.test.ts läses
fil: server/test/crm-deals.test.ts läses
fil: server/test/crm-stadning.test.ts läses
fil: server/test/crm-cadence-merge-search.test.ts läses
fil: server/test/crm-provenance.test.ts läses
fil: server/test/crm-thread.test.ts läses
fil: server/test/crm-thread-paging.test.ts läses
fil: server/test/crm-design-parity.test.ts läses
fil: server/test/crm-sfar-yta.test.ts läses
fil: server/test/crm-ai-commitments.test.ts läses
fil: server/test/crm-gdpr-replay.test.ts läses
fil: server/test/crm-review-fixes.test.ts läses
fil: server/test/crm-derivations.test.ts läses
fil: server/test/crm-commitment-times.test.ts läses
fil: server/test/crm-read-scope.test.ts läses
fil: server/test/crm-sandvag.test.ts läses
fil: server/test/draft-delete.test.ts läses
fil: server/test/fakturanummer-samtidighet.test.ts läses
fil: server/test/payroll-tax-dublett.test.ts läses
fil: server/test/uppdragsytan-matt-rytm.test.ts läses
fil: server/test/uppdragsytan-scopelinje.test.ts läses
fil: server/test/uppdragsytan-utskick.test.ts läses
fil: server/test/uppdragsytan-laget.test.ts läses
fil: server/test/rls-katalog.test.ts läses
fil: server/test/voucher-links.test.ts läses
fil: server/test/crm-rules.test.ts läses
fil: server/test/crm-ingest-grundnyckel.test.ts läses
fil: docs/project-context.md läses
fil: CLAUDE.md läses
fil: _bmad-output/planning-artifacts/prd.md läses
fil: _bmad-output/planning-artifacts/epics.md läses
fil: _bmad-output/planning-artifacts/architecture.md läses
fil: _bmad-output/implementation-artifacts/1-1-ursprung-per-falt-for-kontaktpunkter-loften-och-personens-alla-falt.md läses
fil: _bmad-output/implementation-artifacts/1-8-kundkortets-org-nr-galler-for-en-kopplad-relation.md läses
prov: crm-person-provenance nytt GRÖN
prov: crm-event-provenance berörs GRÖN
prov: crm-sfar berörs GRÖN
prov: crm-sfar-3 berörs GRÖN
prov: crm-schema berörs GRÖN
prov: crm-status-link berörs GRÖN
prov: crm-views berörs GRÖN
prov: crm-commitment-lifecycle berörs GRÖN
prov: crm-org-name-norm berörs GRÖN
prov: crm-deals berörs GRÖN
prov: crm-stadning berörs GRÖN
prov: crm-cadence-merge-search berörs GRÖN
prov: crm-provenance berörs GRÖN
prov: crm-thread berörs GRÖN
prov: crm-thread-paging berörs GRÖN
prov: crm-design-parity berörs GRÖN
prov: crm-sfar-yta berörs GRÖN
prov: crm-ai-commitments berörs GRÖN
prov: crm-gdpr-replay berörs GRÖN
prov: crm-review-fixes berörs GRÖN
prov: crm-derivations berörs GRÖN
prov: crm-commitment-times berörs GRÖN
prov: crm-read-scope berörs GRÖN
prov: crm-sandvag berörs GRÖN
prov: draft-delete berörs GRÖN
prov: fakturanummer-samtidighet berörs GRÖN
prov: payroll-tax-dublett berörs GRÖN
prov: uppdragsytan-matt-rytm berörs GRÖN
prov: uppdragsytan-scopelinje berörs GRÖN
prov: uppdragsytan-utskick berörs GRÖN
prov: uppdragsytan-laget berörs GRÖN
prov: rls-katalog berörs GRÖN
prov: voucher-links berörs GRÖN
prov: crm-ingest-grundnyckel berörs GRÖN
beroende: pg
beroende: vitest
beroende: supertest
tjanst: 127.0.0.1:5433 vitest kör provfilerna mot den stående testdatabasen
```

- **Tjänsten** är testdatabasen som kedjan cto kör hela sviten mot. Enligt förteckningen över kedjans förmågor (härledd 2026-11-23 09.25) är den den enda adress proven får nå. Utvecklarens sandlåda når den ofta inte, och det är aldrig ett HALT-skäl (Tasks, «Utan kommandon»).
- **Läsfilerna** utöver de ändrade:
  - `server/src/services/crmProvenance.ts`: `guardHumanFields` (rad 139–154) plockar bort varje inskickat fält vars ursprungsrad har `source = 'human'` ur en icke-mänsklig skrivning och lägger fältnamnet i `blocked`. Den läser ALLA ursprungsrader för målet och beror inte på någon fältlista. `recordProvenance` (rad 93–124) skriver en rad per fält med `ON CONFLICT (compan
```

## Utfall
Tester: 206 passed (206) · Granskning: GODKANT | Båda fynden från förra varvet är åtgärdade, så varje kriterium är implementerat och inget HIGH- eller MEDIUM-fynd står kvar. · Byggforsok: 2

## Modellkedja (Davids krav 17/8, reservvag 7/9)

* krav: **claude-opus-5-5**
* utveckling: **claude-opus-5-5**
* granskning: **claude-opus-5-5 (Codex spärrat — Davids regel 12/10; Codex granskar i efterhand)**

Granskaren ar inte forfattaren: claude-opus-5-5 (Codex spärrat — Davids regel 12/10; Codex granskar i efterhand) granskade claude-opus-5-5s arbete.

effort (Davids beslut 20/10): create-story high · validering high · bygg xhigh · granskning xhigh — riskdel crm
Allt pa Davids abonnemang - inga API-tokens.
