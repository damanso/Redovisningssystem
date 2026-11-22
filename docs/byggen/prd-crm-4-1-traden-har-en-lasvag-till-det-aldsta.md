# PRD-bygget crm 4-1-traden-har-en-lasvag-till-det-aldsta — PRD crm 4-1-traden-har-en-lasvag-till-det-aldsta: # Story 4.1: Tråden har en läsväg till det äldsta 

Datum: 2026-11-22 12:15 · Branch: cto/prd-crm-4-1-traden-har-en-lasvag-till-det-aldsta-9329 · Kalla: 02-Områden/hermes/prd/crm-1c-prd.md (fryst 29/9, Davids beslut #194)

## Mal
PRD crm 4-1-traden-har-en-lasvag-till-det-aldsta: # Story 4.1: Tråden har en läsväg till det äldsta Status: ready-for-dev <!-- Skapad av create-story 2026-11-22 i autonom

## PRD-kravet (ordagrant ur den frysta PRD:n) och astras kodgranskning
```
# Story 4.1: Tråden har en läsväg till det äldsta

Status: ready-for-dev

<!-- Skapad av create-story 2026-11-22 i autonomt läge. Validering i ny kontext är valfri och skrivs bredvid berättelsen (.validering.md). -->

## Story

Som David,
vill jag kunna bläddra bakåt i en relations tråd till den allra första händelsen,
så att "hela kronologin" verkligen är hela och inget äldre samtal saknar läsväg.

Kodbas: redovisning (kedjan cto) · Täcker: FR-17 (hela kronologin, också fler än 60 händelser; `get_crm_thread` returnerar samma kronologi) · Beror på: — (inget; 4.2 är done och i basen, och dess `invoice_id` och `kallrad()` står kvar orörda) · Senare berättelse som bygger på läsvägen: 4.3 (personläget, som lägger `person_id` i samma tjänst och samma provfil) · Arkitektur: A-7 (total ordning, nyckelpaginering med `before`, sidstorlek 60 i vyn och högst 200 via åtgärden), «Tillstånd som adresser» (`?fore=<at>|<kind>|<ref_id>` tolkad av den rena funktionen `parseThreadCursor` med `Object.hasOwn`-vakt, ogiltig markör ger 400-notis, aldrig 500), UX K6.

Berättelsen skrevs 2026-11-22 ur epics.md (Story 4.1), PRD:ns FR-17, UX-specifikationens K6 och Resa 5, arkitekturens A-7 och raden om tillstånd som adresser, vågplanens rad för 4.1, kodgranskningen av FR-17, förteckningen över kedjornas förmågor och koden i arbetskopian. Bygget lägger ingen migration, ingen ny åtgärd, ingen ny rutt, ingen ny CSS-klass, ingen ny importsats och inget beroende. Det ändrar fyra filer i källträdet: `server/src/lib/crmRules.ts` (markörens tolkning och form), `server/src/services/crmThread.ts` (total ordning, markören `before`, millisekundprecision och sidstorleken), `server/src/actions/registry.ts` (`before` i `get_crm_thread`) och `server/src/http/view/routes.ts` (läsvägen under relationssidans tråd och 400-sidan för en ogiltig markör). Proven är en ny `describe` sist i `server/test/crm-rules.test.ts` och den nya filen `server/test/crm-thread-paging.test.ts`. Dokumenten är ett nytt avsnitt sist i `docs/MCP_ACTIONS.md` och sessionsraden i `docs/STATUS.md`.

## Förkrav

Blocket nedan är berättelsens hela yta. Fem saker om formen:

- **Inga beroenderader.** Bygget lägger inte till något paket. Förkontrollens K5 läser för redovisningen manifestet i repots översta katalog, där bara arbetsytorna står, så en `beroende:`-rad hade blivit RÖD fast inget är nytt (samma beslut som 2.3, 3.3 och 4.2).
- **Inga kontraktsrader.** Berättelsen läser ingen annan dels rutt, fil eller funktion. `get_crm_thread` anropas inte av Hermes (Grep över hermes/ ger ingen träff), och åtgärdens svar är fortfarande en lista.
- **Inga kommandon och inga förmågor.** Byggaren har Read, Glob, Grep, Write, Edit och TodoWrite. Kedjan kör `npm ci`, typkontrollen (`npm run typecheck`, som prövar både källträdet och provfilerna) och hela vitest-sviten (`npm test`) efter utvecklarens sista ändring.
- **Proven.** Kedjan cto kör vitest-sviten. Det nya provet `crm-thread-paging` och det ändrade `crm-rules` ska vara GRÖNA. Berörsraderna är de befintliga vitest-filerna som renderar relationssidan, läser `get_crm_thread` eller åtgärdslistan, läser `docs/MCP_ACTIONS.md` eller söker igenom serverns källträd (Dev Notes, «Regressionsytan»). Deras läge är kedjans senaste gröna svit. Hermes egna prov körs inte av kedjan cto (Dev Notes, «Baslinjen»).
- **Läsfilerna** förklaras under blocket.

```förkrav
fil: server/src/lib/crmRules.ts ändras
fil: server/src/services/crmThread.ts ändras
fil: server/src/actions/registry.ts ändras
fil: server/src/http/view/routes.ts ändras
fil: server/test/crm-rules.test.ts ändras
fil: server/test/crm-thread-paging.test.ts ny
fil: docs/MCP_ACTIONS.md ändras
fil: docs/STATUS.md ändras
fil: server/src/http/view/html.ts läses
fil: server/src/http/view/auth.ts läses
fil: server/src/lib/validation.ts läses
fil: server/src/db/pool.ts läses
fil: server/src/http/middleware/errorHandler.ts läses
fil: server/src/actions/execute.ts läses
fil: server/src/services/crmIngest.ts läses
fil: server/migrations/0052_crm_schema.sql läses
fil: server/migrations/0007_vouchers.sql läses
fil: server/migrations/0010_invoices_and_receipts.sql läses
fil: server/test/helpers.ts läses
fil: server/test/setup.ts läses
fil: server/test/env.ts läses
fil: server/test/crm-thread.test.ts läses
fil: server/test/crm-views.test.ts läses
fil: server/test/crm-design-parity.test.ts läses
fil: server/test/entity-links.test.ts läses
fil: server/test/crm-sandvag.test.ts läses
fil: server/test/vy-kansliga-knappar.test.ts läses
fil: docs/project-context.md läses
fil: docs/ARKITEKTUR.md läses
fil: CLAUDE.md läses
prov: crm-thread-paging nytt GRÖN
prov: crm-rules ändras GRÖN
prov: crm-thread berörs GRÖN
prov: crm-views berörs GRÖN
prov: crm-design-parity berörs GRÖN
prov: entity-links berörs GRÖN
prov: crm-name-alias berörs GRÖN
prov: crm-provenance berörs GRÖN
prov: crm-cadence-merge-search berörs GRÖN
prov: crm-review-fixes berörs GRÖN
prov: crm-org-name-norm berörs GRÖN
prov: crm-actions-ui berörs GRÖN
prov: crm-sfar-3 berörs GRÖN
prov: crm-status-link berörs GRÖN
prov: crm-today berörs GRÖN
prov: crm-event-provenance berörs GRÖN
prov: crm-commitment-lifecycle berörs GRÖN
prov: crm-sandvag berörs GRÖN
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

- **Tjänsten** är testdatabasen som kedjan cto kör hela sviten mot. Enligt förteckningen över kedjornas förmågor (härledd 2026-11-22) är den den enda adress proven får nå. Utvecklarens sandlåda når den ofta inte, och det är aldrig ett HALT-skäl (Tasks, «Utan kommandon»).
- **Läsfilerna** utöver de ändrade:
  - `server/src/http/view/html.ts` ger `html` (rad 24–36: escapar varje interpolerat värde, också `&` i en adress till `&amp;`, men lämnar mallens egen literaltext orörd), `raw`, `layout` och `errorPage(status, message)` (rad 1875–1883: husets felsida med rubriken status och meddelandet som ingress). Husets klasser som läsvägen använder finns redan: `.actions` (rad 1082), `.btn--ghost` och `.btn--sm` (rad 1079–1080), `.muted` (rad 598), `.empty` och `.empty .big` (rad 1280), `.thread` (rad 1264). Filen ändras inte.
  - `server/src/http/view/auth.ts` rad 278–290: `page()` renderar varje kastat `AppError` som felsida med texten «Något gick fel.» utom vid 404. En ogiltig markör får därför inte kastas som `BadRequestError`; rutten skickar sin egen 400-sida (Dev Notes, «Relationssidan»). Filen ändras inte.
  - `server/src/lib/validation.ts` rad 37: `UuidSchema` är `z.string().uuid()` och släpper igenom versaler; rad 90–93: `IsoDateTimeSchema` kräver zon och ett tolkningsbart datum. Ändras inte.
  - `server/src/db/pool.ts` rad 10: poolen sätter bara en typtolk för int8. En `timestamptz` kommer därför tillbaka som JS-`Date` med millisekunder, medan Postgres lagrar mikrosekunder. Det är skälet till millisekundavrundningen i trådens fråga (Dev Notes, «Tjänsten»).
  - `server/src/http/middleware/errorHandler.ts` rad 23–29 och 76–94: ett ZodError blir 400 `validation_error`, och Postgres-felen 22007 och 22008 (ogiltigt eller orimligt datum) blir 400 `invalid_input` för åtgärderna (`server/src/actions/execute.ts` rad 101–108 kastar tjänstens fel vidare dit oförändrat). Webbvyns `page()` har ingen sådan översättning: ett databasfel i relationssidans rutt blir 500. Därför får `parseThreadCursor` bara släppa igenom en tidpunkt som Postgres säkert tolkar (Dev N
```

## Utfall
Tester: 193 passed (193) · Granskning: GODKANT | De tre fynden från förra varvet är åtgärdade och prövade, varje acceptanskriterium är implementerat, och det enda nya fyndet är LOW. · Byggforsok: 2

## Modellkedja (Davids krav 17/8, reservvag 7/9)

* krav: **claude-opus-5-5**
* utveckling: **claude-opus-5-5**
* granskning: **claude-opus-5-5 (Codex spärrat — Davids regel 12/10; Codex granskar i efterhand)**

Granskaren ar inte forfattaren: claude-opus-5-5 (Codex spärrat — Davids regel 12/10; Codex granskar i efterhand) granskade claude-opus-5-5s arbete.

effort (Davids beslut 20/10): create-story high · validering high · bygg xhigh · granskning xhigh — riskdel crm
Allt pa Davids abonnemang - inga API-tokens.
