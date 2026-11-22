# PRD-bygget crm 4-2-kallan-pa-varje-rad-ar-en-lank — PRD crm 4-2-kallan-pa-varje-rad-ar-en-lank: # Story 4.2: Källan på varje rad är en länk Status: read

Datum: 2026-11-22 10:25 · Branch: cto/prd-crm-4-2-kallan-pa-varje-rad-ar-en-lank-9328 · Kalla: 02-Områden/hermes/prd/crm-1c-prd.md (fryst 29/9, Davids beslut #194)

## Mal
PRD crm 4-2-kallan-pa-varje-rad-ar-en-lank: # Story 4.2: Källan på varje rad är en länk Status: ready-for-dev <!-- Skapad av create-story 2026-11-22 i autonomt läge

## PRD-kravet (ordagrant ur den frysta PRD:n) och astras kodgranskning
```
# Story 4.2: Källan på varje rad är en länk

Status: ready-for-dev

<!-- Skapad av create-story 2026-11-22 i autonomt läge. Validering i ny kontext är valfri och skrivs bredvid berättelsen (.validering.md). -->

## Story

Som David,
vill jag nå mailet, ärendet eller fakturan bakom en rad med ett klick, med nyckeln kvar som säker identifierare,
så att jag kan styrka var något sades.

Kodbas: redovisning (kedjan cto) · Täcker: FR-17 (länk till källan på varje rad), FR-31 («var det sades» som länk) · Beror på: 1.2 (done och i basen: `rattadAvDig`, `getEventFields` och tillägget *· rättad av dig*) · Senare berättelser som bygger på källraden: 5.2 (löftets tre tider och «Ärendet … stängdes»), 5.9 (kalenderlänken) och 4.1/4.3 (trådens läsväg och personläget, som också ändrar `server/src/services/crmThread.ts`) · Arkitektur: «En hjälpfunktion per återkommande form» (`kallrad()` bredvid `ursprungsMark` i routes.ts), «Vyn → externa sidor: bara länkar», UX K5.

Berättelsen skrevs 2026-11-22 ur epics.md (Story 4.2), PRD:ns FR-17 och FR-31, UX-specifikationens K5, arkitekturens rad om `kallrad()`, kodgranskningen av FR-17 och FR-31, förteckningen över kedjornas förmågor och koden i arbetskopian. Bygget lägger ingen migration, ingen ny åtgärd, ingen ny rutt, ingen ny CSS-klass och inget beroende. Det ändrar två filer i källträdet: `server/src/http/view/routes.ts` (en källrad i en funktion, använd av tråden, åtagandevyn och Idag) och `server/src/services/crmThread.ts` (ett nytt fält `invoice_id` på trådens rader, så att betalningsraden bär fakturans id). Proven är en ny `describe` sist i `server/test/crm-views.test.ts`. Dokumenten är ett nytt avsnitt sist i `docs/MCP_ACTIONS.md` och sessionsraden i `docs/STATUS.md`.

## Förkrav

Blocket nedan är berättelsens hela yta. Fem saker om formen:

- **Inga beroenderader.** Bygget lägger inte till något paket. Förkontrollens K5 läser för redovisningen manifestet i repots översta katalog, där bara arbetsytorna står, så en `beroende:`-rad hade blivit RÖD fast inget är nytt (samma beslut som 2.3 och 3.3).
- **Inga kontraktsrader.** Berättelsen läser ingen annan dels rutt, fil eller funktion. Länken till ärendet är en sträng som vyn skriver ut; adressen `/vy/arende/:identifier` står i navigationskontraktet `server/kontrakt/navigation.v1.json`, som läses men inte ändras. Gmail nås aldrig av servern; länken öppnas i Davids webbläsare.
- **Inga kommandon och inga förmågor.** Byggaren har Read, Glob, Grep, Write, Edit och TodoWrite. Kedjan kör `npm ci`, typkontrollen (`npm run typecheck`, som prövar både källträdet och provfilerna) och hela vitest-sviten (`npm test`) efter utvecklarens sista ändring; den kör inte `npm run build`.
- **Proven.** Kedjan cto kör vitest-sviten. Det ändrade provet `crm-views` ska vara GRÖNT. Berörsraderna är de befintliga vitest-filerna som renderar tråden, åtagandevyn eller Idag, läser `get_crm_thread`, läser `docs/MCP_ACTIONS.md` eller söker igenom serverns källträd (Dev Notes, «Regressionsytan»). Deras läge är kedjans senaste gröna svit. Hermes egna prov körs inte av kedjan cto (Dev Notes, «Baslinjen»).
- **Läsfilerna** förklaras under blocket.

```förkrav
fil: server/src/http/view/routes.ts ändras
fil: server/src/services/crmThread.ts ändras
fil: server/test/crm-views.test.ts ändras
fil: docs/MCP_ACTIONS.md ändras
fil: docs/STATUS.md ändras
fil: server/src/http/view/html.ts läses
fil: server/src/services/crmRelations.ts läses
fil: server/src/services/crmDerivations.ts läses
fil: server/src/actions/registry.ts läses
fil: server/src/lib/referens.ts läses
fil: server/migrations/0052_crm_schema.sql läses
fil: server/kontrakt/navigation.v1.json läses
fil: server/test/helpers.ts läses
fil: server/test/setup.ts läses
fil: server/test/env.ts läses
fil: server/test/crm-thread.test.ts läses
fil: server/test/crm-design-parity.test.ts läses
fil: server/test/entity-links.test.ts läses
fil: server/test/crm-today.test.ts läses
fil: server/test/crm-commitment-lifecycle.test.ts läses
fil: server/test/crm-sandvag.test.ts läses
fil: server/test/uppdragsytan-utskick.test.ts läses
fil: server/test/min-sida.test.ts läses
fil: docs/project-context.md läses
fil: docs/ARKITEKTUR.md läses
fil: CLAUDE.md läses
prov: crm-views ändras GRÖN
prov: crm-thread berörs GRÖN
prov: crm-design-parity berörs GRÖN
prov: crm-today berörs GRÖN
prov: entity-links berörs GRÖN
prov: crm-provenance berörs GRÖN
prov: crm-sfar-3 berörs GRÖN
prov: crm-sfar-yta berörs GRÖN
prov: crm-review-fixes berörs GRÖN
prov: crm-actions-ui berörs GRÖN
prov: crm-org-name-norm berörs GRÖN
prov: crm-cadence-merge-search berörs GRÖN
prov: crm-finish berörs GRÖN
prov: crm-name-alias berörs GRÖN
prov: crm-status-link berörs GRÖN
prov: crm-event-provenance berörs GRÖN
prov: crm-commitment-lifecycle berörs GRÖN
prov: crm-sandvag berörs GRÖN
prov: min-sida berörs GRÖN
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
  - `server/src/http/view/html.ts` ger `html` (escapar varje interpolerat värde, rad 30–36), `esc`, `raw`, `chip` och `entityLink` (rad 173–187, förebilden för hur en adress byggs med `encodeURIComponent` och skrivs med `esc`). CSS-klasserna `.thread__src` och `.thread__ref` står på rad 1271–1272; `.thread__ref` (maskinstil) är inte bunden till tråden och används här också i åtagandevyn och på Idag. Filen ändras inte.
  - `server/src/services/crmRelations.ts` ger `getEventFields` (rad 674–705: innehåll och ursprung per händelse i två samlade frågor) och `EventFields` (rad 668–672) samt `listCommitments` (rad 1533–1555, som redan väljer `source_system` och `source_ref`). `server/src/services/crmDerivations.ts` ger `todayView`, vars löftesfråga (rad 404–421) redan väljer `source_system` och `source_ref`, kapar på fem och sorterar på förfallodatum. Ingen av dem ändras.
  - `server/src/actions/registry.ts` rad 3174–3187: `get_crm_thread` returnerar `relationThread` rakt av, så trådens nya fält följer med i svaret utan ändring i registret. Rad 2870, 2888 och 3153: `source_system` är `z.enum(['gmail', 'calendar', 'linear', 'manual'])` och `source_ref` är `safeText(300)`, som släpper igenom `<`, `"`, blanksteg och kolon. Ändras inte.
  - `server/migrations/0052_crm_schema.sql` rad 131 och 166: samma fyra källsystem som CHECK på kontaktpunkter och löften. Det är skälet till att namntabellen är sluten.
  - `server/src/lib/referens.ts` är uppdragsytans referensmodul: `oppningsvag` bygger en Gmail-sökning på ett RFC 822 Message-ID (`#search/rfc822msgid…`). CRM:s nyckel bär Gmail-API:ts meddelande-id, inte ett Message-ID, så modulen återanvänds inte och ändras inte (uppdragsytan är spärrad i CLAUDE.md).
  - `server/kontrakt/navigation.v1.json` bär `/vy/arende/:identifier` (ägare `cases_all`) och `/app/c/…/invoices/…` på samma värd; det är genererat och redigeras aldrig för hand (docs/project-context.md rad 76).
  - `server/test/helpers.ts`, `server/test/setup.ts` och `server/test/env.ts`: `api`, `app`, `registerUser`, `createCompany`, `createFiscalYear` och `withAdmin`; databasen återskapas ur mallen före varje provfil.
  - `serve
```

## Utfall
Tester: 192 passed (192) · Granskning: GODKANT | Alla fem acceptanskriterier är implementerade och täcks av KL1–KL13 i kedjans gröna körning, varje kryssad uppgift finns i koden, filförteckningen stämmer med diffen och inget HIGH- eller ME · Byggforsok: 1

## Modellkedja (Davids krav 17/8, reservvag 7/9)

* krav: **claude-opus-5-5**
* utveckling: **claude-opus-5-5**
* granskning: **claude-opus-5-5 (Codex spärrat — Davids regel 12/10; Codex granskar i efterhand)**

Granskaren ar inte forfattaren: claude-opus-5-5 (Codex spärrat — Davids regel 12/10; Codex granskar i efterhand) granskade claude-opus-5-5s arbete.

effort (Davids beslut 20/10): validering high · bygg xhigh · granskning xhigh — riskdel crm
Allt pa Davids abonnemang - inga API-tokens.
