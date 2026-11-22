# PRD-bygget crm 4-3-personperspektivet-i-relationens-trad — PRD crm 4-3-personperspektivet-i-relationens-trad: # Story 4.3: Personperspektivet i relationens trå

Datum: 2026-11-22 14:05 · Branch: cto/prd-crm-4-3-personperspektivet-i-relationens-trad-9330 · Kalla: 02-Områden/hermes/prd/crm-1c-prd.md (fryst 29/9, Davids beslut #194)

## Mal
PRD crm 4-3-personperspektivet-i-relationens-trad: # Story 4.3: Personperspektivet i relationens tråd Status: ready-for-dev <!-- Skapad av create-story 2026-11-22 i autono

## PRD-kravet (ordagrant ur den frysta PRD:n) och astras kodgranskning
```
# Story 4.3: Personperspektivet i relationens tråd

Status: ready-for-dev

<!-- Skapad av create-story 2026-11-22 i autonomt läge. Validering i ny kontext är valfri och skrivs bredvid berättelsen (.validering.md). -->

## Story

Som David,
vill jag välja en person på relationssidan och se hennes roll, senaste kontakt, vad som sagts och vad som lovats,
så att jag kan följa en människa och inte bara ett bolag.

Kodbas: redovisning (kedjan cto) · Täcker: FR-40 (personperspektivet), FR-31 (*Vem* leder till personen), FR-9 (personhuvudets fält med ursprung) · Beror på: 4.1 (done: total ordning, markören `before`, läsvägen och `tradensSidor` står i basen) och 1.3 (done: ursprungsmärket och *Stämmer* för personens fält står i basen) · Arkitektur: A-7 (personavgränsningen: `person_id` begränsar kontaktpunkter och löften, personen måste höra till organisationen, annars 404, pengar visas inte i personläget), «Tillstånd som adresser» (`?person=<uuid>`), UX K4 (personval och personhuvud), K9 (*Vem* som väg).

Berättelsen skrevs 2026-11-22 ur epics.md (Story 4.3), PRD:ns FR-40, UX-specifikationens K4 och K9, arkitekturens A-7, vågplanens rader för 4.3, kodgranskningen av FR-40, förteckningen över kedjornas förmågor och koden i arbetskopian. Bygget lägger ingen migration, ingen ny åtgärd, ingen ny rutt, ingen ny CSS-klass, ingen ny importsats i källträdet och inget beroende (provfilen crm-thread-paging får en importrad för `daysSince`, Dev Notes, «Provfilen»). Det ändrar sex filer i källträdet: `server/src/lib/crmRules.ts` (personens adress, personformulärets rättelser, dagar sedan ett datum och grenvalet `person`), `server/src/services/crmThread.ts` (`person_id` i tråden), `server/src/services/crmRelations.ts` (`person_id` i `upsertPerson` och två nya fält i `listCommitments`), `server/src/services/crmDerivations.ts` (två nya fält på dagsytans löften), `server/src/actions/registry.ts` (`person_id` i `get_crm_thread` och `upsert_crm_person`) och `server/src/http/view/routes.ts` (personvalet, personhuvudet, *Rätta personen*, personläget i tråden och vägarna in). Proven är en ny `describe` sist i `server/test/crm-rules.test.ts` och nya `describe` sist i `server/test/crm-thread-paging.test.ts`; två befintliga assertioner skrivs om, eftersom de kräver ett beteende som berättelsen avskaffar (Dev Notes, «Regressionsytan»). Dokumenten är ett nytt avsnitt sist i `docs/MCP_ACTIONS.md` och sessionsraden i `docs/STATUS.md`.

## Förkrav

Blocket nedan är berättelsens hela yta. Sex saker om formen:

- **Inga beroenderader.** Bygget lägger inte till något paket. Förkontrollens K5 läser för redovisningen manifestet i repots översta katalog, där bara arbetsytorna står, så en `beroende:`-rad hade blivit RÖD fast inget är nytt (samma beslut som 2.3, 3.3, 4.1 och 4.2).
- **Inga kontraktsrader.** Berättelsen läser ingen annan dels rutt, fil eller funktion. Hermes läser `list_crm_commitments` och `crm_today`, men det är redovisningens egna svar; de får två nya valfria fält och behåller alla befintliga (Dev Notes, «Hermes läser svaren»). `get_crm_thread` och `upsert_crm_person` anropas inte av Hermes (Grep över hermes/skills och hermes/services ger ingen träff).
- **Inga kommandon och inga förmågor.** Byggaren har Read, Glob, Grep, Write, Edit och TodoWrite. Kedjan kör `npm ci`, typkontrollen (`npm run typecheck`, som prövar både källträdet och provfilerna) och hela vitest-sviten (`npm test`) efter utvecklarens sista ändring.
- **Proven.** Kedjan cto kör vitest-sviten. De fyra ändrade proven ska vara GRÖNA: `crm-thread-paging` och `crm-rules` (nya fall), `crm-review-fixes` och `crm-design-parity` (en assertion var skrivs om). Berörsraderna är de befintliga vitest-filerna som renderar relationssidan, åtagandevyn, Idag eller sökningen, läser `get_crm_thread`, `upsert_crm_person`, `list_crm_commitments`, `crm_today` eller åtgärdslistan, läser `docs/MCP_ACTIONS.md` eller söker igenom serverns källträd (Dev Notes, «Regressionsytan»). Deras läge är kedjans senaste gröna svit. Hermes egna prov körs inte av kedjan cto (Dev Notes, «Baslinjen»).
- **Tjänsten** är testdatabasen som kedjan cto kör hela sviten mot. Enligt förteckningen över kedjornas förmågor (härledd 2026-11-22) är den den enda adress proven får nå. Utvecklarens sandlåda når den ofta inte, och det är aldrig ett HALT-skäl (Tasks, «Utan kommandon»).
- **Läsfilerna** förklaras under blocket.

```förkrav
fil: server/src/lib/crmRules.ts ändras
fil: server/src/services/crmThread.ts ändras
fil: server/src/services/crmRelations.ts ändras
fil: server/src/services/crmDerivations.ts ändras
fil: server/src/actions/registry.ts ändras
fil: server/src/http/view/routes.ts ändras
fil: server/test/crm-rules.test.ts ändras
fil: server/test/crm-thread-paging.test.ts ändras
fil: server/test/crm-review-fixes.test.ts ändras
fil: server/test/crm-design-parity.test.ts ändras
fil: docs/MCP_ACTIONS.md ändras
fil: docs/STATUS.md ändras
fil: server/src/http/view/html.ts läses
fil: server/src/http/view/auth.ts läses
fil: server/src/lib/validation.ts läses
fil: server/src/http/middleware/errorHandler.ts läses
fil: server/src/services/crmIngest.ts läses
fil: server/src/services/crmMerge.ts läses
fil: server/src/services/crmProvenance.ts läses
fil: server/migrations/0052_crm_schema.sql läses
fil: server/migrations/0054_crm_review_fixes.sql läses
fil: server/test/helpers.ts läses
fil: server/test/setup.ts läses
fil: server/test/env.ts läses
fil: server/test/crm-views.test.ts läses
fil: server/test/crm-thread.test.ts läses
fil: server/test/entity-links.test.ts läses
fil: server/test/crm-sandvag.test.ts läses
fil: server/test/vy-kansliga-knappar.test.ts läses
fil: docs/project-context.md läses
fil: docs/ARKITEKTUR.md läses
fil: CLAUDE.md läses
prov: crm-thread-paging ändras GRÖN
prov: crm-rules ändras GRÖN
prov: crm-review-fixes ändras GRÖN
prov: crm-design-parity ändras GRÖN
prov: crm-thread berörs GRÖN
prov: crm-views berörs GRÖN
prov: entity-links berörs GRÖN
prov: crm-name-alias berörs GRÖN
prov: crm-provenance berörs GRÖN
prov: crm-cadence-merge-search berörs GRÖN
prov: crm-org-name-norm berörs GRÖN
prov: crm-actions-ui berörs GRÖN
prov: crm-sfar-3 berörs GRÖN
prov: crm-sfar berörs GRÖN
prov: crm-sfar-yta berörs GRÖN
prov: crm-status-link berörs GRÖN
prov: crm-today berörs GRÖN
prov: crm-finish berörs GRÖN
prov: crm-schema berörs GRÖN
prov: crm-stadning berörs GRÖN
prov: crm-event-provenance berörs GRÖN
prov: crm-commitment-lifecycle berörs GRÖN
prov: crm-sandvag berörs GRÖN
prov: forslagskort-klartext berörs GRÖN
prov: min-sida berörs GRÖN
prov: navigation berörs GRÖN
prov: webbmeny berörs GRÖN
prov: mcp berörs GRÖN
prov: vy-kansliga-knappar berörs GRÖN
prov: session-vem berörs GRÖN
prov: uppdragsytan-menyn berörs GRÖN
prov: uppdragsytan-utskick berörs GRÖN
prov: uppdragsytan-matt-rytm berörs GRÖN
prov: uppdragsytan-scopelinje berörs GRÖN
prov: draft-delete berörs GRÖN
prov: fakturanummer-samtidighet berörs GRÖN
prov: payroll-tax-dublett berörs GRÖN
prov: voucher-links berörs GRÖN
prov: kvittobilagor-lagring berörs GRÖN
prov: vat-declaration berörs GRÖN
prov: uppdragsytan-baselineorsak berörs GRÖN
prov: uppdragsytan-beslut berörs GRÖN
prov: uppdragsytan-godkannandevag berörs GRÖN
prov: uppdragsytan-undantag berörs GRÖN
tjanst: 127.0.0.1:5433 vitest kör provfilerna mot den stående testdatabasen
```

- **Läsfilerna** utöver de ändrade:
  - `server/src/http/view/html.ts` ger `html` (escapar varje interpolerat värde, också `&` i en adress till `&amp;`, men lämnar mallens egen literaltext orörd), `raw`, `esc`, `entityLink` (rad 173–187: förebilden för personlänken — en länk bara med ett id, annars text; med en klass blir texten ett `span` med klassen) och `errorPage(status, message)`. Husets klasser som berättelsen använder finns redan: `.factcard` och `.factcard__head` (rad 1161–1166), `.uppgift` med `.k` och `.v` (rad 1181–1185), `.threadtab.is-active` (rad 1260), `.rattaform`, `.muted`, `.empty`, `.big` och `.entity`. Global `h2` har marginalen `30px 0 10px` (
```

## Utfall
Tester: 193 passed (193) · Granskning: GODKANT | Alla sex kriterier är implementerade och täckta av fall i kedjans gröna svit. Berättelsen har inget avsnitt «Review Follow-ups (AI)» från förra varvet att pröva. Omtagets `delMed` är en rikt · Byggforsok: 2

## Modellkedja (Davids krav 17/8, reservvag 7/9)

* krav: **claude-opus-5-5**
* utveckling: **claude-opus-5-5**
* granskning: **claude-opus-5-5 (Codex spärrat — Davids regel 12/10; Codex granskar i efterhand)**

Granskaren ar inte forfattaren: claude-opus-5-5 (Codex spärrat — Davids regel 12/10; Codex granskar i efterhand) granskade claude-opus-5-5s arbete.

effort (Davids beslut 20/10): create-story high · validering high · bygg xhigh · granskning xhigh — riskdel crm
Allt pa Davids abonnemang - inga API-tokens.
