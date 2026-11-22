# PRD-bygget crm 5-1-fangstvagarna-pa-ett-stalle-och-tomlagen-som-bara-lovar-det-som-finns — PRD crm 5-1-fangstvagarna-pa-ett-stalle-och-tomlagen-som-bara-lovar-det-som-finns: # Story 5.1: Fång

Datum: 2026-11-22 15:07 · Branch: cto/prd-crm-5-1-fangstvagarna-pa-ett-stalle-och-tomlagen-som-bar-9331 · Kalla: 02-Områden/hermes/prd/crm-1c-prd.md (fryst 29/9, Davids beslut #194)

## Mal
PRD crm 5-1-fangstvagarna-pa-ett-stalle-och-tomlagen-som-bara-lovar-det-som-finns: # Story 5.1: Fångstvägarna på ett ställe, och tomlägen som bara lovar det som finns Status: ready-for-dev <!-- Note: Val

## PRD-kravet (ordagrant ur den frysta PRD:n) och astras kodgranskning
```
# Story 5.1: Fångstvägarna på ett ställe, och tomlägen som bara lovar det som finns

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

Som David,
vill jag att varje tomläge och varje hint bara nämner de vägar som faktiskt fångar kontakter och löften i dag,
så att en tom lista aldrig får mig att tro att något fångas som inte fångas.

Kodbas: redovisning (kedjan cto) · Täcker: FR-31 (ärligt tomläge, PRD lucka 21) · Beror på: — · Arkitektur: «Fångstvägarna på ett ställe» och mönsterregeln «Tomlägen och utfästelser» · UX: K8 (hinten i *Lova något*), K9 (åtagandevyns tomläge) och mönstret «Tomlägen — bara det som är i drift».

## Förkrav

Bygget lägger en konstant och en ren textbyggare, kopplar fem ytor i webbvyn till dem och skriver två nya provfiler. Ingen migration, ingen ny åtgärd, inget ändrat schema och ingen ny rutt. Det kräver ingen förmåga utöver kedjans: inget kommando, inget nät, inget nytt beroende och ingen ny tjänst. Sökvägarna är relativa kedjans bas (repots rot i /opt/redovisning).

```förkrav
fil: server/src/lib/crmRules.ts ändras
fil: server/src/services/crmDerivations.ts ändras
fil: server/src/http/view/routes.ts ändras
fil: server/test/crm-capture-paths.test.ts ny
fil: server/test/crm-capture-paths-mock.test.ts ny
fil: server/test/crm-finish.test.ts ändras
fil: docs/STATUS.md ändras
fil: server/src/http/view/html.ts läses
fil: server/src/services/crmSfar.ts läses
fil: server/src/services/crmIngest.ts läses
fil: server/src/services/crmMerge.ts läses
fil: server/test/helpers.ts läses
fil: server/test/env.ts läses
fil: server/vitest.config.ts läses
fil: server/tsconfig.test.json läses
fil: server/test/manniskosparr.test.ts läses
fil: server/test/crm-today.test.ts läses
fil: server/test/crm-views.test.ts läses
fil: server/test/crm-rules.test.ts läses
fil: server/test/crm-design-parity.test.ts läses
fil: server/test/radlangd.test.ts läses
fil: docs/project-context.md läses
fil: docs/ARKITEKTUR.md läses
fil: docs/MCP_ACTIONS.md läses
fil: CLAUDE.md läses
fil: _bmad-output/planning-artifacts/prd.md läses
fil: _bmad-output/planning-artifacts/epics.md läses
fil: _bmad-output/planning-artifacts/architecture.md läses
fil: _bmad-output/planning-artifacts/ux-design-specification.md läses
fil: _bmad-output/planning-artifacts/underlag/kodgranskning.md läses
fil: _bmad-output/planning-artifacts/underlag/davids-svar.md läses
fil: _bmad-output/planning-artifacts/underlag/kedjans-formagor.md läses
fil: _bmad-output/implementation-artifacts/4-4-kadensens-regressionsprov.md läses
tjanst: 127.0.0.1:5433 vitest kör provfilerna mot den stående testdatabasen
```

- **Tjänsten** är testdatabasen som kedjan cto kör hela sviten mot (underlaget om kedjans förmågor: proven får nå just den adressen). Utvecklarens sandlåda når den ofta inte; det är aldrig ett HALT-skäl (Tasks, «Utan kommandon»).
- **Inga kommandon.** Kedjan cto har ingen kommandoförmåga för byggaren (verktygen är Read, Glob, Grep, Write, Edit och TodoWrite). Kedjan kör själv `npm ci`, typecheck, build och hela testsviten efter din sista ändring. Därför står inga kommandorader i blocket.
- **Inga beroenderader.** Provfilerna använder vitest och supertest, som server-arbetsytan redan har. Förkontrollen prövar en beroenderad i kedjan cto mot repots rotmanifest, och det listar bara arbetsytan och inga beroenden. En rad för ett paket som redan finns hade därför stoppat bygget som ett nytt beroende. Bygget lägger inget paket.
- **Inga prov-rader.** Förkontrollen fäller i kedjan cto varje prov-rad som inte är GRÖN, och baslinjekontrollen gäller inte där, eftersom kedjan prövar baslinjen i själva bygget. Hermes-proven som nämner modulen `routes` som helt ord (Grep 2026-11-22: åtta prov; `crmDerivations` och `crmRules` i inga) är därför inga grindar för berättelsen. Två av dem stod röda i create-storys läsning av provvakten: adresskontraktet (läser vyns rutter i routes.ts mot navigationskontraktet) och bmadglidning (nämner routes.ts bara i en kommentar). Bygget påverkar ingen av dem: ingen rutt läggs till eller byter sökväg, ingen knappklass tillkommer (designsveps knappräkning) och ingen berättelsefil ändras.
- **Läsfilerna:** `server/src/http/view/html.ts` (`html`-mallen escapar varje interpolerat värde med `esc`, så `&` i en länk blir `&amp;`), `server/src/services/crmSfar.ts` (`SFARFILTER`: `privat`, `foretag`, `alla`), `server/src/services/crmIngest.ts` och `server/src/services/crmMerge.ts` (importerar ur crmRules med den relativa sökvägen som 1.3 återanvänder), `server/test/manniskosparr.test.ts` (förlagan för `vi.hoisted` + `vi.mock` med `importActual` mot en modul som appen laddar), `server/test/crm-today.test.ts` (ett nytt bolag ger en tom dag med «Avbetat för i dag»), `server/test/crm-views.test.ts` (kund skapas med POST `/api/companies/:id/customers` och kundkortet läses med `ua.get`), `server/test/crm-rules.test.ts` (rena fall mot `crmRules`), `server/test/crm-design-parity.test.ts` (fallet «Lova något» läser relationssidan; ändras inte), `server/test/radlangd.test.ts` (15-ordsregeln gäller fritext i tabeller, inte tomlägen; ändras inte).
- **Inget kontrakt.** Berättelsen läser ingen annan dels rutt, fil eller funktion.

## Acceptance Criteria

Lydelsen är epics.md:s (Story 5.1), ordagrant och numrerad. Under varje kriterium står raden *Mätbart*: mekanismen som gör kriteriet sant genom konstruktion och den ändliga listan av fall som visar det. Fallen ligger i `server/test/crm-capture-paths.test.ts` (P-, A-, H-, C-, D- och R-fallen) och `server/test/crm-capture-paths-mock.test.ts` (M-fallen), med namnet först i titeln. Facit står som literaler i fallen, aldrig hämtat ur koden som prövas.

1. **Given** en konstant `CAPTURE_PATHS_IN_OPERATION` i CRM-koden med två listor — vägar för kontakter (i dag mail och ärenden) och vägar för löften (i dag ärenden märkta Väntar-extern och *Lova något* för hand)
   **When** åtagandevyn, relationssidans *Lova något*, Idag, Relationer och kundkortets panel *Åtaganden* renderar sina tomlägen och hintar
   **Then** texterna byggs ur konstanten, så att de bara nämner vägar i drift
   **And** konstanten ändras i samma ändring som en ny väg tas i drift (berättelserna 5.9 och 5.11)
   - *Mätbart (Given/Then):* Mekanismen är **en enda väg in** och **en tillåtelselista**. `CAPTURE_PATHS_IN_OPERATION` i `server/src/services/crmDerivations.ts` är exakt `{ contacts: ['mail', 'issues'], commitments: ['issues_waiting_external', 'promise_form'] }`. Den rena funktionen `captureTexts(paths)` i `server/src/lib/crmRules.ts` är den enda som bygger de sex fångsttexterna, och den tar med en väg bara när vägens nyckel står i `paths` — den går igenom en sluten frastabell (Dev Notes, «Frastabellen») och hoppar över varje nyckel som inte finns i listan. I `server/src/http/view/routes.ts` finns en enda modulkonstant `CAPTURE_TEXTS = captureTexts(CAPTURE_PATHS_IN_OPERATION)`, och de fem ytorna läser sina fångstmeningar bara ur dess sex fält. Fall: **P1** (konstantens innehåll som literal), **P2** (de sex texterna för konstanten, ordagrant), **P7** och **P8** (färre vägar ger färre ord — inget annat kommer med).
   - *Mätbart (And):* Frastabellen täcker redan kalendern (`calendar`, ordet «möten», berättelse 5.9) och AI-samtalet (`ai_conversation`, berättelse 5.11), och tabellerna är typade som `Record` över de slutna nyckeltyperna, så TypeScript fäller en ny nyckel utan fras. En ny väg i drift är därför en ändring av konstanten och inget annat. Fall: **P4** (kalendern tillagd ger 5.9:s texter), **P5** (AI-samtalet tillagt ändrar de tre löftestexterna och inga andra), **P6** (ordningen i konstanten spelar ingen roll).

2. **Given** åtagandevyn med filtret *Öppna* och inga löften
   **When** sidan renderas
   **Then** tomläget säger *"Inga öppna löften. Löften kommer in av sig själva från ärenden märkta Väntar-extern, och du kan lägga till ett under Lova något på en relation."* med länkar till *Klara* och *Id
```

## Utfall
Tester: 195 passed (195) · Granskning: GODKANT | Alla fyra kriterier är implementerade och provade genom hela stacken med en negativ kontroll som verkligen byter konstanten; enda fyndet är en LOW i kommentarerna. · Byggforsok: 1

## Modellkedja (Davids krav 17/8, reservvag 7/9)

* krav: **claude-opus-5-5**
* utveckling: **claude-opus-5-5**
* granskning: **claude-opus-5-5 (Codex spärrat — Davids regel 12/10; Codex granskar i efterhand)**

Granskaren ar inte forfattaren: claude-opus-5-5 (Codex spärrat — Davids regel 12/10; Codex granskar i efterhand) granskade claude-opus-5-5s arbete.

effort (Davids beslut 20/10): create-story high · validering high · bygg xhigh · granskning xhigh — riskdel crm
Allt pa Davids abonnemang - inga API-tokens.
