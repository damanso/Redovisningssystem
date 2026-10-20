# PRD-bygget redovisningen 3-4-menyn-mats-vid-de-faststallda-fonsterstorlekarna — PRD redovisningen 3-4-menyn-mats-vid-de-faststallda-fonsterstorlekarna: # Story 3.4: Menyn mäts vid 

Datum: 2026-10-20 19:56 · Branch: cto/prd-redovisningen-3-4-menyn-mats-vid-de-faststallda-fonsters-9249 · Kalla: 02-Områden/hermes/prd/redovisningen-1c-prd.md (fryst 29/9, Davids beslut #194)

## Mal
PRD redovisningen 3-4-menyn-mats-vid-de-faststallda-fonsterstorlekarna: # Story 3.4: Menyn mäts vid de fastställda fönsterstorlekarna Status: ready-for-dev <!-- Note: Validation is optional. R

## PRD-kravet (ordagrant ur den frysta PRD:n) och astras kodgranskning
```
# Story 3.4: Menyn mäts vid de fastställda fönsterstorlekarna

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

Som David,
vill jag att menyns "0 px dolt" mäts på samma sätt varje gång,
så att designkontraktet går att bevisa och en framtida ändring som döljer menyinnehåll fälls.

Kodbas: redovisning. Krav: NFR-9 (designkontraktets mätvillkor, fastställt i UX-specifikationen 1D). Beror på: inga.

## Förkrav

```förkrav
fil: server/test/menyn-fonsterstorlekar.test.ts ny
fil: server/test/menymatningRigg.ts ny
fil: server/package.json ändras
fil: package.json ändras
fil: docs/STATUS.md ändras
fil: server/src/http/view/html.ts läses
fil: server/src/http/view/routes.ts läses
fil: server/src/http/app.ts läses
fil: server/test/webbmeny.test.ts läses
fil: server/test/appmenyn-hel.test.ts läses
fil: server/test/navigation.test.ts läses
fil: server/test/uppdragsytan-undantagsvyn-mobil.test.ts läses
fil: server/test/helpers.ts läses
fil: server/test/setup.ts läses
fil: server/test/globalSetup.ts läses
fil: server/test/undantagsvynRigg.ts läses
fil: server/test/kompletteringRigg.ts läses
fil: server/test/uppdragsytan-utskick.test.ts läses
fil: server/kontrakt/navigation.v1.json läses
fil: server/vitest.config.ts läses
fil: server/tsconfig.json läses
fil: server/tsconfig.test.json läses
fil: package-lock.json läses
fil: .github/workflows/ci.yml läses
fil: CLAUDE.md läses
fil: docs/ARKITEKTUR.md läses
fil: docs/project-context.md läses
fil: _bmad-output/planning-artifacts/epics.md läses
fil: _bmad-output/planning-artifacts/prd.md läses
fil: _bmad-output/planning-artifacts/architecture.md läses
fil: _bmad-output/planning-artifacts/ux-design-specification.md läses
fil: _bmad-output/planning-artifacts/underlag/kodgranskning.md läses
fil: _bmad-output/planning-artifacts/underlag/davids-svar.md läses
fil: _bmad-output/planning-artifacts/underlag/kedjans-formagor.md läses
fil: _bmad-output/implementation-artifacts/sprint-status.yaml läses
fil: hermes/skills/appprov.sh läses
fil: hermes/prov/designparitet.py läses
fil: hermes/prov/continuityvakt.py läses
prov: menyn-fonsterstorlekar nytt GRÖN
prov: appmenyn-hel berörs GRÖN
prov: webbmeny berörs GRÖN
prov: navigation berörs GRÖN
prov: uppdragsytan-undantagsvyn-mobil berörs GRÖN
prov: designparitet berörs GRÖN
prov: continuityvakt berörs KUNDE_INTE
beroende: playwright
beroende: vitest
beroende: supertest
beroende: pg
beroende: node:fs
beroende: node:net
beroende: node:http
tjanst: 127.0.0.1:5433 vitest kör alla prov mot den stående testdatabasen, också det nya provets testbolag
kontrakt: redovisningen funktion layout prov menyn-fonsterstorlekar
kontrakt: redovisningen funktion registerUser prov menyn-fonsterstorlekar
kontrakt: redovisningen funktion createCompany prov menyn-fonsterstorlekar
kontrakt: redovisningen funktion createFiscalYear prov menyn-fonsterstorlekar
kontrakt: redovisningen rutt POST /api/auth/register prov menyn-fonsterstorlekar
kontrakt: redovisningen rutt POST /api/companies prov menyn-fonsterstorlekar
kontrakt: redovisningen rutt POST /api/companies/:companyId/accounting/fiscal-years prov menyn-fonsterstorlekar
kontrakt: redovisningen rutt GET /app/login prov menyn-fonsterstorlekar
kontrakt: redovisningen rutt POST /app/login prov menyn-fonsterstorlekar
kontrakt: redovisningen rutt GET /app/c/:companyId prov menyn-fonsterstorlekar
kontrakt: redovisningen fil server/src/http/view/html.ts prov menyn-fonsterstorlekar
kontrakt: redovisningen fil server/package.json prov menyn-fonsterstorlekar
kontrakt: redovisningen fil package.json prov menyn-fonsterstorlekar
kontrakt: redovisningen fil docs/STATUS.md prov continuityvakt
kontrakt: redovisningen funktion fynd nytt menyn-fonsterstorlekar
kontrakt: redovisningen funktion startaWebblasare nytt menyn-fonsterstorlekar
kontrakt: redovisningen funktion kravWebblasare nytt menyn-fonsterstorlekar
kontrakt: redovisningen funktion kontextFor nytt menyn-fonsterstorlekar
kontrakt: redovisningen funktion oppnaVid nytt menyn-fonsterstorlekar
kontrakt: redovisningen funktion matMenyn nytt menyn-fonsterstorlekar
kontrakt: redovisningen funktion planteraMenyposter nytt menyn-fonsterstorlekar
kontrakt: redovisningen funktion planteraBrett nytt menyn-fonsterstorlekar
kommando: git diff --stat HEAD -- server/package.json package.json docs/STATUS.md server/src/http/view/html.ts
kommando: npm run typecheck
kommando: npm run build
kommando: npm test
kommando: npm run test:meny
kommando: npm run test -w server -- test/menyn-fonsterstorlekar.test.ts
kommando: npm run test -w server -- test/menyn-fonsterstorlekar.test.ts -t "F1:|F2:|F3:|F4:|F5:|F6:|F7:|F8:|F9:"
kommando: npm run test -w server -- test/menyn-fonsterstorlekar.test.ts -t "F10:|F11:|F12:|F13:"
kommando: npm run test -w server -- test/menyn-fonsterstorlekar.test.ts -t "F14:|F15:"
kommando: npm run test -w server -- test/menyn-fonsterstorlekar.test.ts -t "F16:"
kommando: npm run test -w server -- test/appmenyn-hel.test.ts
kommando: npm run test -w server -- test/webbmeny.test.ts
kommando: npm run test -w server -- test/navigation.test.ts
kommando: npm run test -w server -- test/uppdragsytan-undantagsvyn-mobil.test.ts
```

## Acceptance Criteria

1. **Given** ett Playwright-prov mot en lokalt startad server med ett inloggat testbolag
   **When** menyn öppnas vid 1280 × 800, 1440 × 900 och 2560 × 1440 CSS-px i zoom 100 %
   **Then** `.navmenu__panel` har `scrollHeight − clientHeight = 0` och sidan har ingen vågrät rullning, vid alla tre storlekarna.
   - **Mätbart:** storlekarna står på ett enda ställe, listan `STORLEKAR` i `server/test/menymatningRigg.ts`, som har exakt fyra poster (F1). Fallen F10, F11 och F12 öppnar menyn vid var sin skrivbordsstorlek och kräver att `fynd(matning, 'skrivbord')` är en tom lista. `fynd` ger ett fynd för varje pixel dolt innehåll (F3) och varje pixel vågrät rullning (F4).

2. **Given** samma prov vid 390 × 844
   **When** menyn öppnas
   **Then** panelen får rulla inuti, men sidan rullar inte i sidled.
   - **Mätbart:** F13 kräver att `fynd(matning, 'telefon')` är en tom lista. I telefonläget räknar `fynd` inte panelens inre rullning (F6), men vågrät rullning räknas i båda lägena (F4).

3. **Given** en negativ kontroll med planterat extra menyinnehåll
   **When** provet körs vid 1280 × 800
   **Then** provet fäller.
   - **Mätbart:** F14 planterar 40 extra menyposter i den öppna panelen, kräver att antalet länkar ökat med exakt 40 och att samma `fynd` som F10 använder ger ett fynd som börjar med "dolt". F15 planterar ett 2 000 px brett element vid 390 × 844 och kräver ett fynd som börjar med "sidled", så att mätningen av sidledsrullning inte heller är tom.

4. **Given** stilmallen i `server/src/http/view/html.ts`
   **When** provet läser den beräknade stilen
   **Then** `.navmenu__panel` har kvar `overflow-y: auto` som skyddsnät.
   - **Mätbart:** `matMenyn` läser `getComputedStyle(panel).overflowY` i webbläsaren, och `fynd` ger ett fynd när värdet inte är `auto` (F5). Kontrollen gäller i F10–F13, alltså vid alla fyra storlekarna.

5. **Given** provets körning
   **When** det startas
   **Then** det har ett eget npm-skript och redovisar "kunde inte köras" med orsak om webbläsaren saknas, aldrig ett grönt utfall utan mätning.
   - **Mätbart, mekanismen:** det finns en enda väg in till webbläsaren. `startaWebblasare` kastar aldrig. Den ger antingen webbläsaren eller orsaken till att den inte startade, och provfilen anropar den på ett enda ställe, i webbläsarblockets `beforeAll`. Varje webbläsarfall (F10–F15) börjar med `kravWebblasare(start)`, som kastar felet `kunde inte köras: {orsak}` när orsaken finns. Fallet blir då rött med orsaken i utdatan och aldrig överhoppat. En mätning av en panel som inte renderades kan heller inte ge noll, eftersom `fynd` ger ett fynd som börjar med "ingen mätning" när panelen inte syns, har höjden 0 eller saknar länkar. Skripten heter `test:meny` i `server/package.json` och 
```

## Utfall
Tester: 168 passed (168) · Granskning: GODKANT | Alla sex acceptanskriterier är implementerade, och kedjans körning bekräftar dem (168 av 168 testfiler gröna, bland dem den nya provfilen med F10–F15 i Chromium); kvar finns bara två LOW-fyn · Byggforsok: 1

## Modellkedja (Davids krav 17/8, reservvag 7/9)

* krav: **claude-opus-5-5**
* utveckling: **claude-opus-5-5**
* granskning: **claude-opus-5-5 (Codex spärrat — Davids regel 12/10; Codex granskar i efterhand)**

Granskaren ar inte forfattaren: claude-opus-5-5 (Codex spärrat — Davids regel 12/10; Codex granskar i efterhand) granskade claude-opus-5-5s arbete.

effort (Davids beslut 20/10): create-story high · validering high · bygg xhigh · granskning xhigh — riskdel redovisningen
Allt pa Davids abonnemang - inga API-tokens.
