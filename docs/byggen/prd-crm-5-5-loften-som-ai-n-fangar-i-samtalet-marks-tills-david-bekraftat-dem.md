# PRD-bygget crm 5-5-loften-som-ai-n-fangar-i-samtalet-marks-tills-david-bekraftat-dem — PRD crm 5-5-loften-som-ai-n-fangar-i-samtalet-marks-tills-david-bekraftat-dem: # Story 5.5: Löften s

Datum: 2026-11-23 07:26 · Branch: cto/prd-crm-5-5-loften-som-ai-n-fangar-i-samtalet-marks-tills-da-9341 · Kalla: 02-Områden/hermes/prd/crm-1c-prd.md (fryst 29/9, Davids beslut #194)

## Mal
PRD crm 5-5-loften-som-ai-n-fangar-i-samtalet-marks-tills-david-bekraftat-dem: # Story 5.5: Löften som AI:n fångar i samtalet märks tills David bekräftat dem Status: ready-for-dev <!-- Note: Validati

## PRD-kravet (ordagrant ur den frysta PRD:n) och astras kodgranskning
```
# Story 5.5: Löften som AI:n fångar i samtalet märks tills David bekräftat dem

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

Som David,
vill jag att ett löfte jag nämner för AI:n registreras på rätt relation och syns som en gissning tills jag bekräftat det,
så att det som inte kan härledas fångas när jag ändå pratar om det — utan att ett formulär måste fyllas i.

Kodbas: redovisning (kedjan cto) · Täcker: FR-39 (agentens registrering, ursprung `ai`, ✦ i tråden och åtagandevyn, bekräftelse och skydd efteråt), FR-24 (kön läser samma brytare som Idag, och varje rad bär `unconfirmed_ai` så att kön kan märka en gissning) · Beror på: 1.1, 1.2, 5.1 och 5.2, alla done · Arkitektur: K-6 (AI-fångst av löften: «Åtgärdens titel och beskrivning i manifestet säger när den ska anropas», en enda konstant i `crmDerivations.ts` som `todayView` och `list_crm_commitments` läser), A-1 (ursprung per händelsefält), tabellen över åtgärder (`list_crm_commitments` returnerar `unconfirmed_ai` och tar `include_unconfirmed_ai`), «Åtagandevyn och K-6-konstanten» · UX: K1 (`ai` på löfte: ✦ och *Stämmer*), K7 (*Rätta*), K9 (åtagandevyns *Vad* med K1), Resa 6 · Kodgranskningen: FR-39 FÖLJER INTE («Löften behöver ursprung `ai`, ✦ i båda vyerna samt bekräftelse och skydd per fält … Tidpunkten för införande i dagens lista och kön är beslutsberoende») · Davids besked: svaret 2026-10-16 13:22 på PRD fråga 13 b, «Ja» till att visa obekräftade AI-löften direkt (Dev Notes, «Davids besked och mellanläget»).

## Förkrav

Bygget lägger ett valfritt fält `description` på åtgärdsdefinitionen och en beskrivning på `record_crm_commitment`, låter MCP-servern föra beskrivningen vidare, lägger fältet `unconfirmed_ai` och valet `include_unconfirmed_ai` på `list_crm_commitments`, en konstant i `server/src/services/crmDerivations.ts` som Idag och listan läser, två nya provfiler, ett nytt fall i MCP-provet, en uppdaterad nyckellista i 5.2:s prov, ett avsnitt i `docs/MCP_ACTIONS.md` och en sessionsrad i `docs/STATUS.md`. Ingen migration, ingen ny rutt, ingen ny CSS, ingen ny åtgärd och inget nytt beroende. Bygget kräver ingen förmåga utöver kedjans: inget kommando, inget nät och ingen ny tjänst. Sökvägarna är relativa kedjans bas (repots rot i /opt/redovisning).

```förkrav
fil: server/src/actions/registry.ts ändras
fil: server/src/mcp/server.ts ändras
fil: server/src/services/crmRelations.ts ändras
fil: server/src/services/crmDerivations.ts ändras
fil: server/src/http/view/routes.ts ändras
fil: server/test/crm-ai-commitments.test.ts ny
fil: server/test/crm-ai-commitments-mock.test.ts ny
fil: server/test/crm-commitment-times.test.ts ändras
fil: server/test/mcp.test.ts ändras
fil: docs/MCP_ACTIONS.md ändras
fil: docs/STATUS.md ändras
fil: server/src/services/crmProvenance.ts läses
fil: server/src/services/crmIngest.ts läses
fil: server/src/services/crmDeals.ts läses
fil: server/src/services/crmMerge.ts läses
fil: server/src/services/crmPrivat.ts läses
fil: server/src/actions/execute.ts läses
fil: server/src/http/routes/actions.ts läses
fil: server/src/lib/crmRules.ts läses
fil: server/src/lib/validation.ts läses
fil: server/src/db/tx.ts läses
fil: server/src/http/view/html.ts läses
fil: server/migrations/0052_crm_schema.sql läses
fil: server/migrations/0090_crm_event_provenance.sql läses
fil: server/test/helpers.ts läses
fil: server/test/env.ts läses
fil: server/test/setup.ts läses
fil: server/vitest.config.ts läses
fil: server/tsconfig.json läses
fil: server/tsconfig.test.json läses
fil: server/test/crm-views.test.ts läses
fil: server/test/crm-event-provenance.test.ts läses
fil: server/test/crm-capture-paths.test.ts läses
fil: server/test/crm-capture-paths-mock.test.ts läses
fil: server/test/crm-commitment-form.test.ts läses
fil: server/test/crm-today.test.ts läses
fil: server/test/crm-sandvag.test.ts läses
fil: server/test/sandvagHelper.ts läses
fil: server/test/actions.test.ts läses
fil: server/test/mcp-felomslag.test.ts läses
fil: server/test/min-sida.test.ts läses
fil: server/test/crm-schema.test.ts läses
fil: server/test/crm-commitment-lifecycle.test.ts läses
fil: server/test/crm-deals.test.ts läses
fil: server/test/crm-org-name-norm.test.ts läses
fil: docs/crm/API_KONTRAKT.md läses
fil: docs/project-context.md läses
fil: docs/ARKITEKTUR.md läses
fil: CLAUDE.md läses
tjanst: 127.0.0.1:5433 vitest kör provfilerna mot den stående testdatabasen
```

- **Tjänsten** är testdatabasen som kedjan cto kör hela sviten mot. Underlaget om kedjans förmågor säger att proven får nå just den adressen. Utvecklarens sandlåda når den ofta inte, och det är aldrig ett HALT-skäl (Tasks, «Utan kommandon»).
- **Inga kommandon.** Kedjan cto ger byggaren verktygen Read, Glob, Grep, Write, Edit och TodoWrite och ingen kommandoförmåga. Kedjan kör själv `npm ci`, typecheck, build och hela testsviten efter din sista ändring. MCP-provet `server/test/mcp.test.ts` startar MCP-servern som barnprocess genom tsx; det gör det redan i dag i kedjans svit, så det nya fallet där kräver ingen ny förmåga.
- **Inga beroenderader.** Provfilerna använder vitest och supertest, som server-arbetsytan redan har. Bygget lägger inget paket.
- **Inga prov-rader, och baslinjen.** Raderna saknas med samma skäl som i 5.1, 5.2 och 5.4: förkontrollens K4 (forkontroll.py under hermes/skills, rad 1186–1191) fäller i varje kedja utom hermes varje prov-rad som inte är GRÖN, och K9 gäller inte i kedjan cto. Baslinjen är ändå läst och antecknad under Dev Notes, «Baslinjen».
- **Planeringsfilerna står inte i blocket.** Berättelsen läser epics.md, prd.md, architecture.md, ux-design-specification.md, underlagen kodgranskning.md, davids-svar.md och kedjans-formagor.md, lärdomsfilen för 5.5 och 5.4:s berättelse, alla under _bmad-output/. Den katalogen finns inte i kedjans bas, så en läses-rad för den blir RÖD i förkontrollens K3. Sökvägarna står därför utan kodformat i References. Samma gäller Hermes-filen dagslisterader.py under hermes/skills, som berättelsen läser för beslutet om konstantens värde: den hör till en annan kodbas och står utan kodformat.
- **Läsfilerna** och vad de används till står under Dev Notes, «Kopians läge». `docs/crm/API_KONTRAKT.md` rörs inte: intagets kontrakt är oförändrat.
- **Inget kontrakt.** Berättelsen läser ingen annan dels rutt, fil eller funktion. Fältet `unconfirmed_ai` är ett tillägg i redovisningens eget svar, och standardurvalet för Hermes läsare är oförändrat (Dev Notes, «Davids besked och mellanläget»).

## Acceptance Criteria

Lydelsen är epics.md:s (Story 5.5), ordagrant och numrerad, med ett undantag: kriterium 4 och den negativa kontrollen i kriterium 6 följer Davids besked 2026-10-16 om konstantens värde. Ändringen är markerad i kriteriet och motiverad under Dev Notes, «Davids besked och mellanläget». Under varje kriterium står raden *Mätbart* med mekanismen som gör kriteriet sant genom konstruktion och den ändliga listan av fall som visar det. Fallen M1–M3, A1–A4, V1–V6, B1–B6, I1, C1–C2 och D1 ligger i den nya provfilen `server/test/crm-ai-commitments.test.ts`, M4 i `server/test/mcp.test.ts` och N0–N6 i den nya `server/test/crm-ai-commitments-mock.test.ts`, med namnet först i titeln. Facit står som literaler i fallen, aldrig hämtat ur koden som prövas.

1. **Given** manifestet för MCP-verktyget `record_crm_commitment`
   **When** verktygen listas
   **Then** titeln och beskrivningen säger när verktyget ska anropas (när David i samtalet nämner ett löfte han gett eller fått), att löftestiden är den han anger och annars samtalets tidpunkt, och att källan är `manual`
   **And** schemat tillåter fortfarande bara `gmail`, `calendar`, `linear` och `manual` som källa
   - *Mätbart:* Mekanismen är **ett fält som förs vidare på en enda väg**. Åtgärdsdefinitionen får ett valfritt fält `description`. `actionManifest` i `server/src/actions/registry.ts` är manifestets enda källa (REST-rutten `GET /api/companies/:id/actions` returnerar den), och
```

## Utfall
Tester: 203 passed (203) · Granskning: GODKANT | Alla sex acceptanskriterier är implementerade och prövade genom REST, executeAction, vyn och Postgres. Inget fynd är HIGH eller MEDIUM, och de två LOW-fynden nedan blockerar inte. · Byggforsok: 1

## Modellkedja (Davids krav 17/8, reservvag 7/9)

* krav: **claude-opus-5-5**
* utveckling: **claude-opus-5-5**
* granskning: **claude-opus-5-5 (Codex spärrat — Davids regel 12/10; Codex granskar i efterhand)**

Granskaren ar inte forfattaren: claude-opus-5-5 (Codex spärrat — Davids regel 12/10; Codex granskar i efterhand) granskade claude-opus-5-5s arbete.

effort (Davids beslut 20/10): create-story high · validering high · bygg xhigh · granskning xhigh — riskdel crm
Allt pa Davids abonnemang - inga API-tokens.
