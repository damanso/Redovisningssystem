# PRD-bygget crm 5-11-ai-samtalet-blir-en-fangstvag-i-ytan — PRD crm 5-11-ai-samtalet-blir-en-fangstvag-i-ytan: # Story 5.11: AI-samtalet blir en fångstväg i yta

Datum: 2026-11-27 12:27 · Branch: cto/prd-crm-5-11-ai-samtalet-blir-en-fangstvag-i-ytan-9367 · Kalla: 02-Områden/hermes/prd/crm-1c-prd.md (fryst 29/9, Davids beslut #194)

## Mal
PRD crm 5-11-ai-samtalet-blir-en-fangstvag-i-ytan: # Story 5.11: AI-samtalet blir en fångstväg i ytan Status: ready-for-dev <!-- Note: Validation is optional. Run validate

## PRD-kravet (ordagrant ur den frysta PRD:n) och astras kodgranskning
```
# Story 5.11: AI-samtalet blir en fångstväg i ytan

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

Som David,
vill jag att ytan säger att löften fångas när jag nämner dem för AI:n — men först när det faktiskt sker,
så att ett tomläge aldrig lovar en väg som inte är i drift.

Kodbas: redovisning (kedjan cto) · Täcker: FR-31 (tomlägen och hintar nämner fångsten i AI-samtalet först när den är i drift), FR-39 (fångstvägen syns för David) · Beror på: 5.1, 5.5 och 5.10 (alla done i sprint-status; 5.10 ska dessutom vara driftsatt och aktiverad, se Dev Notes, «Kedjan kontrollerar i drift») · Arkitektur: K-6 («Fångstvägen läggs i `CAPTURE_PATHS_IN_OPERATION` först när den är i drift (epics 5.11)»), «Fångstvägarna på ett ställe», mönsterregeln «Tomlägen och utfästelser» · UX: K8 (hinten: «När fångsten i AI-samtalet (FR-39) är i drift läggs *"…eller när du nämner det för AI:n"* till»), K9 (åtagandevyns tomläge; «Fångstvägarna i texten hämtas från **ett** ställe i koden som uppdateras i samma ändring som en väg tas i drift (FR-3, FR-39)»).

## Förkrav

Bygget har ingen ingång som väntar på något utanför kopian. Att 5.10 är driftsatt och att dess provs valvrad säger *avsnittet finns* är ett förkrav i drift som kontrolleras innan berättelsen startas (Dev Notes, «Kedjan kontrollerar i drift»); kedjan cto kan varken läsa valvet eller köra något efter driftsättningen, så ingen deluppgift läser det, och det är aldrig ett HALT-skäl. Bygget lägger AI-samtalet i konstanten för fångstvägar, ger hinten i *Lova något* den form UX K8 föreskriver, skriver två nya provfiler, uppdaterar facit i fem befintliga provfiler, rättar ett stycke i `docs/MCP_ACTIONS.md` och skriver en sessionsrad i `docs/STATUS.md`. Ingen migration, ingen ny rutt, ingen ny åtgärd, inget ändrat schema, ingen ny CSS-klass, ingen ny import och inget nytt beroende. `server/src/http/view/routes.ts` ändras inte: de tre ytorna läser redan sina meningar ur `CAPTURE_TEXTS`. Sökvägarna är relativa kedjans bas (repots katalog /opt/redovisning).

```förkrav
fil: server/src/lib/crmRules.ts ändras
fil: server/src/services/crmDerivations.ts ändras
fil: server/test/crm-ai-capture.test.ts ny
fil: server/test/crm-ai-capture-mock.test.ts ny
fil: server/test/crm-capture-paths.test.ts ändras
fil: server/test/crm-capture-paths-mock.test.ts ändras
fil: server/test/crm-ai-commitments.test.ts ändras
fil: server/test/crm-calendar-capture.test.ts ändras
fil: server/test/crm-commitment-form.test.ts ändras
fil: docs/MCP_ACTIONS.md ändras
fil: docs/STATUS.md ändras
fil: server/src/http/view/routes.ts läses
fil: server/test/crm-calendar-capture-mock.test.ts läses
fil: server/test/crm-ai-commitments-mock.test.ts läses
fil: server/test/crm-commitment-form-mock.test.ts läses
fil: server/test/crm-finish.test.ts läses
fil: server/test/crm-views.test.ts läses
fil: server/test/crm-sandvag.test.ts läses
fil: server/test/crm-sfar-3.test.ts läses
fil: server/test/uppdragsytan-utskick.test.ts läses
fil: server/test/uppdragsytan-faktureringsunderlag.test.ts läses
fil: server/test/vat-declaration.test.ts läses
fil: server/test/helpers.ts läses
fil: server/test/env.ts läses
fil: server/vitest.config.ts läses
fil: server/tsconfig.test.json läses
fil: docs/crm/API_KONTRAKT.md läses
fil: docs/project-context.md läses
fil: CLAUDE.md läses
tjanst: 127.0.0.1:5433 vitest kör provfilerna mot den stående testdatabasen
```

- **Tjänsten** är testdatabasen som kedjan cto kör hela sviten mot. Underlaget om kedjans förmågor säger att proven får nå just den adressen. Utvecklarens sandlåda når den ofta inte, och det är aldrig ett HALT-skäl (Tasks, «Utan kommandon»).
- **Inga kommandon.** Kedjan cto ger byggaren verktygen Read, Glob, Grep, Write, Edit och TodoWrite och ingen kommandoförmåga, så blocket har inga kommando-rader. Kedjan kör själv `npm ci`, typkontrollen (båda tsconfig-filerna) och hela testsviten efter din sista ändring; grindarna före merge står i Dev Notes («Testerna i den här kodbasen»).
- **Inga beroenderader.** Provfilerna använder vitest och supertest, som server-arbetsytan redan har. Bygget lägger inget paket.
- **Inga prov-rader.** Byggslingans urval drar in varje Hermes-prov direkt under prov/ vars källtext nämner en ändrad eller ny modul som helt ord. De ändrade modulerna är `crmRules` och `crmDerivations`; en sökning efter dem som hela ord under hermes/prov i kopian gav ingen träff (`routes`, som åtta prov nämner, ändras inte). Regeln ger alltså inga rader. Dev Notes, «Baslinjen».
- **Inget kontrakt.** Berättelsen läser ingen annan dels rutt, fil eller funktion. 5.10:s avsnittsfil och prov hör till kodbasen hermes; bygget läser dem inte, och de står därför utan kodformat (References).
- **Planeringsfilerna står inte i blocket.** Berättelsen läser epics.md, prd.md, architecture.md, ux-design-specification.md, parallelization-analysis.md, underlagen kodgranskning.md, davids-svar.md och kedjans-formagor.md, och berättelserna 5.1, 5.5, 5.9 och 5.10, alla under _bmad-output/. Den katalogen finns inte i kedjans bas, så de står utan kodformat under References.

## Acceptance Criteria

Lydelsen är epics.md:s (Story 5.11), ordagrant och numrerad. Under varje kriterium står raden *Mätbart*: mekanismen som gör kriteriet sant genom konstruktion och den ändliga listan av fall som visar det. Fallen S1–S6 och Y1–Y5 ligger i den nya `server/test/crm-ai-capture.test.ts` och U0–U3 i den nya `server/test/crm-ai-capture-mock.test.ts`, med namnet först i titeln. De uppdaterade fallen i 5.1:s, 5.4:s, 5.5:s och 5.9:s provfiler står under varje kriterium. Facit står som literaler i fallen, aldrig hämtat ur koden som prövas.

1. **Given** konstanten för fångstvägar (berättelse 5.1)
   **When** den här berättelsen byggs (efter att 5.10 driftsatts och dess provs valvrad sagt *avsnittet finns* om valvets `CLAUDE.md`)
   **Then** löftesvägarna får *när du nämner det för AI:n*, och hinten i *Lova något* och åtagandevyns tomläge säger det
   **And** ingen text påstår att löften fångas ur mail eller mötens innehåll
   - *When-ledet:* villkoret är ett förkrav i drift och inget startvillkor i kopian. Kedjan cto kan inte läsa valvet (kedjans förmåga valvläsning: nej), så ingen deluppgift prövar det och det ger aldrig HALT. Det kontrolleras innan berättelsen startas (parallelization-analysis.md, regel 7 och raden «Driftsatt före start»). Dev Notes, «Kedjan kontrollerar i drift», anger vad som lästs.
   - *Mätbart (Then):* Mekanismen är 5.1:s **en enda väg in och en tillåtelselista**: `CAPTURE_PATHS_IN_OPERATION` i `server/src/services/crmDerivations.ts` blir exakt `{ contacts: ['mail', 'calendar', 'issues'], commitments: ['issues_waiting_external', 'ai_conversation', 'promise_form'] }`, och ytorna läser sina meningar bara ur `CAPTURE_TEXTS = captureTexts(CAPTURE_PATHS_IN_OPERATION)` i `server/src/http/view/routes.ts` (oförändrad). Frasen *när du nämner det för AI:n* står på ett enda ställe, raden `ai_conversation` i frastabellen `COMMITMENT_PATH_PHRASES` i `server/src/lib/crmRules.ts`. Hinten får UX K8:s form: frasen läggs efter källorna med «, eller» i stället för som en ur-form före «kommer in av sig själva» (Dev Notes, «Hintens form»). Fall: **S1** (konstanten exakt och fryst), **S2** (de tre löftestexterna ordagrant, var och en med *när du nämner det för AI:n*), **S6** (hintens fyra former), **Y1** (åtagandevyns tomläge), **Y2** (hinten i *Lova något*), **Y3** (kundkortets tomma *Åtaganden*), och de uppdaterade eller följande **P1, P2, P4, P5, A1, H1, C1** i `server/test/crm-capture-paths.test.ts`, **M2** i `server/test/crm-capture-paths-mock.test.ts`, **C1, C2** i `server/test/crm-ai-commitments.test.ts`, **F1, F2, F3** i `server/test/crm-calendar-capture.test.ts` och **F2** i `server/test/crm-commitment-form.test.ts`.
   - *Mätbart (And):* Mekanismen är **en sluten nyckeltyp**: löftesvägarnas typ `CommitmentCapturePath` är `'issues_waiting_external' | 'ai_conversation' | 'promise
```

## Utfall
Tester: 216 passed (216) · Granskning: GODKANT | Båda acceptanskriterierna och samtliga kryssade uppgifter är implementerade; inga konkreta fel hittades. · Byggforsok: 1

## Modellkedja (Davids krav 17/8, reservvag 7/9)

* krav: kordes inte
* utveckling: **gpt-6.1-sol**
* granskning: **gpt-6-astra**

Granskaren ar inte forfattaren: gpt-6-astra granskade gpt-6.1-sols arbete.

effort (Davids beslut 20/10): create-story high · validering high — planeringssteg
Allt pa Davids abonnemang - inga API-tokens.
