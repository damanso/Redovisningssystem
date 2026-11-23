# PRD-bygget crm 5-7-en-nyckel-som-bara-kan-lasa — PRD crm 5-7-en-nyckel-som-bara-kan-lasa: # Story 5.7: En nyckel som bara kan läsa Status: ready-for-

Datum: 2026-11-23 08:47 · Branch: cto/prd-crm-5-7-en-nyckel-som-bara-kan-lasa-9342 · Kalla: 02-Områden/hermes/prd/crm-1c-prd.md (fryst 29/9, Davids beslut #194)

## Mal
PRD crm 5-7-en-nyckel-som-bara-kan-lasa: # Story 5.7: En nyckel som bara kan läsa Status: ready-for-dev <!-- Note: Validation is optional. Run validate-create-st

## PRD-kravet (ordagrant ur den frysta PRD:n) och astras kodgranskning
```
# Story 5.7: En nyckel som bara kan läsa

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

Som David,
vill jag kunna skapa en läsnyckel åt Hermes som bara kan läsa,
så att kön kan visa mina löften utan att en ny identitet får skrivrätt.

Kodbas: redovisning (kedjan cto) · Täcker: FR-24 (tredje utfallet: läsidentiteten kan bara läsa), NFR-6 · Beror på: — · Arkitektur: S-1 (läs-scope i agent-token, `AuthContext.readOnly`, 403 `read_only_token` i `executeAction` före varje skrivning, andra försvarslinjen `rejectReadOnlyWrites` på `/api/companies`, *Anslut AI* med valet *Läsnyckel — kan bara läsa*, `docs/ARKITEKTUR.md` med hänvisning till #156), felkoden `read_only_token` (403) under «Felkoder som tillkommer», «Ingen ny miljövariabel och ingen ny tjänst» · PRD: FR-24 (acceptansens tredje utfall), NFR-6 · Kodgranskningen: FR-24 DELVIS («ingen tokenklass utan skrivrätt finns i redovisningen», PRD:ns lucka 18) · Nästa berättelse: 5.8 (Hermes `loften()` läser med nyckeln; David mintar den efter driftsättningen).

## Förkrav

Bygget lägger läs-scopet i autentiseringen, en spärr i `executeAction`, en mellanvara på `/api/companies`, valet *Läsnyckel — kan bara läsa* under *Anslut AI* i vyn, två nya provfiler, ett avsnitt i `docs/MCP_ACTIONS.md`, ett stycke och ett rättat migrationsintervall i `docs/ARKITEKTUR.md` och en sessionsrad i `docs/STATUS.md`. Ingen migration, ingen ny rutt, ingen ny åtgärd, ingen ny miljövariabel, ingen ny CSS-klass och inget nytt beroende. Bygget kräver ingen förmåga utöver kedjans: inget kommando, inget nät och ingen ny tjänst. Sökvägarna är relativa kedjans bas (repots rot i /opt/redovisning).

```förkrav
fil: server/src/http/middleware/authenticate.ts ändras
fil: server/src/actions/execute.ts ändras
fil: server/src/http/app.ts ändras
fil: server/src/http/routes/actions.ts ändras
fil: server/src/http/view/routes.ts ändras
fil: server/test/crm-read-scope.test.ts ny
fil: server/test/crm-read-scope-mock.test.ts ny
fil: docs/ARKITEKTUR.md ändras
fil: docs/MCP_ACTIONS.md ändras
fil: docs/STATUS.md ändras
fil: server/src/lib/jwt.ts läses
fil: server/src/config.ts läses
fil: server/src/lib/errors.ts läses
fil: server/src/http/middleware/companyAccess.ts läses
fil: server/src/http/middleware/errorHandler.ts läses
fil: server/src/http/routes/companies.ts läses
fil: server/src/http/routes/accounting.ts läses
fil: server/src/http/routes/parties.ts läses
fil: server/src/http/routes/files.ts läses
fil: server/src/http/routes/auth.ts läses
fil: server/src/http/view/auth.ts läses
fil: server/src/actions/registry.ts läses
fil: server/src/mcp/server.ts läses
fil: server/src/services/crmRelations.ts läses
fil: server/src/services/auditService.ts läses
fil: server/src/db/tx.ts läses
fil: server/test/helpers.ts läses
fil: server/test/env.ts läses
fil: server/test/setup.ts läses
fil: server/vitest.config.ts läses
fil: server/tsconfig.json läses
fil: server/tsconfig.test.json läses
fil: server/test/view.test.ts läses
fil: server/test/manniskosparr.test.ts läses
fil: server/test/actions.test.ts läses
fil: server/test/tenant-isolation.test.ts läses
fil: server/test/mcp.test.ts läses
fil: server/test/mcp-felomslag.test.ts läses
fil: server/test/crm-ai-commitments.test.ts läses
fil: server/test/crm-capture-paths-mock.test.ts läses
fil: server/test/vy-kansliga-knappar.test.ts läses
fil: server/test/crm-sandvag.test.ts läses
fil: server/test/sandvagHelper.ts läses
fil: server/test/utskickHelper.ts läses
fil: server/test/uppdragsytan-beslut.test.ts läses
fil: server/test/uppdragsytan-undantag.test.ts läses
fil: server/test/uppdragsytan-godkannandevag.test.ts läses
fil: server/test/uppdragsytan-utskick.test.ts läses
fil: server/test/uppdragsytan-menyn.test.ts läses
fil: server/test/entity-links.test.ts läses
fil: server/test/crm-sfar-3.test.ts läses
fil: server/test/kvittobilagor-lagring.test.ts läses
fil: server/test/vat-declaration.test.ts läses
fil: server/test/uppdragsytan-baselineorsak.test.ts läses
fil: server/test/crm-deals.test.ts läses
fil: docs/project-context.md läses
fil: CLAUDE.md läses
tjanst: 127.0.0.1:5433 vitest kör provfilerna mot den stående testdatabasen
```

- **Tjänsten** är testdatabasen som kedjan cto kör hela sviten mot. Underlaget om kedjans förmågor säger att proven får nå just den adressen. Utvecklarens sandlåda når den ofta inte, och det är aldrig ett HALT-skäl (Tasks, «Utan kommandon»).
- **Inga kommandon.** Kedjan cto ger byggaren verktygen Read, Glob, Grep, Write, Edit och TodoWrite och ingen kommandoförmåga. Kedjan kör själv `npm ci`, typecheck och hela testsviten efter din sista ändring.
- **Inga beroenderader.** Provfilerna använder vitest, supertest och jsonwebtoken, som server-arbetsytan redan har (jsonwebtoken importeras redan av `server/test/tenant-isolation.test.ts`). Bygget lägger inget paket.
- **Inga prov-rader, och baslinjen.** Fem Hermes-prov som nämner en ändrad modul som helt ord är inte GRÖNA i provvaktens senaste körning (Dev Notes, «Baslinjen»). Raderna står inte i blocket, med samma skäl som i 5.1, 5.2, 5.4 och 5.5: förkontrollens K4 (forkontroll.py under hermes/skills, rad 1186–1191) fäller i varje kedja utom hermes varje prov-rad som inte är GRÖN, och K9 gäller inte i kedjan cto. Att skriva raderna hade gjort planeringen RÖD utan att skydda något.
- **Planeringsfilerna står inte i blocket.** Berättelsen läser epics.md, prd.md, architecture.md, ux-design-specification.md, underlagen kodgranskning.md, davids-svar.md och kedjans-formagor.md, lärdomsfilen för 5.7 och 5.5:s berättelse, alla under _bmad-output/. Den katalogen finns inte i kedjans bas, så en läses-rad blir RÖD i förkontrollens K3. Sökvägarna står därför utan kodformat i References. Hermes-proven som nämns under «Baslinjen» och «Kedjan kontrollerar i drift» hör till en annan kodbas och står som namn utan kodformat.
- **Läsfilerna** och vad de används till står under Dev Notes, «Kopians läge» och «Regressionsytan». `server/src/lib/jwt.ts` och `server/src/config.ts` läses men ändras inte (Dev Notes, «Avvikelser mot arkitekturens filträd»).
- **Inget kontrakt.** Berättelsen läser ingen annan dels rutt, fil eller funktion. Hermes `loften()` (5.8) blir den första läsaren av läsnyckeln och prövas i 5.8.

## Acceptance Criteria

Lydelsen är epics.md:s (Story 5.7), ordagrant och numrerad. Under varje kriterium står raden *Mätbart* med mekanismen som gör kriteriet sant genom konstruktion och den ändliga listan av fall som visar det. Fallen A1–A3, S1–S5, R1–R4, B1–B2, T1–T6 och D1–D3 ligger i den nya provfilen `server/test/crm-read-scope.test.ts` och N0–N2 i den nya `server/test/crm-read-scope-mock.test.ts`, med fallets namn först i titeln. Facit står som literaler i fallen, aldrig hämtat ur koden som prövas. Livslängden jämförs mot `config.AI_AGENT_TOKEN_TTL_SECONDS` både för läsnyckeln (T2) och för ett vanligt AI-token (T4), eftersom kriteriet säger «samma livslängd som agent-token». T4 beror därmed inte på att T2 gått igenom.

1. **Given** *Anslut AI* i webbvyn
   **When** David (inloggad människa) väljer *Läsnyckel — kan bara läsa*
   **Then** ett token signeras med `{ actor: 'agent', company_id, scope: 'read' }` och samma livslängd som agent-token (`AI_AGENT_TOKEN_TTL_SECONDS`)
   **And** bara en människas session kan minta det; ingen ny miljövariabel och ingen fallback-hemlighet tillkommer
   - *Mätbart:* Mekanismen är **en enda väg in och en tillåtelselista för valet**. Läsnyckeln mintas bara i vyns POST `/app/c/:companyId/connect/token`, som går genom `viewAuth` (cookie-sessionen, där ett token med `actor: 'agent'` avvisas och en Bearer-header aldrig autentiserar en POST) och kräver rollen ägare. Formulärets fält `scope` har exakt två godtagna värden: tomt eller utelämnat ger ett vanligt AI-token som i dag, och `read` ger läsnyckeln. Varje annat värde ger 400 innan något signeras eller auditloggas. REST-vägen POST `/api/companies/:companyId/agent-tokens` får inget sc
```

## Utfall
Tester: 205 passed (205) · Granskning: GODKANT | Alla fem acceptanskriterier är byggda och prövade genom hela stacken, varje kryssad uppgift finns i koden, och kvar står bara två LOW-fynd i dokumenten. · Byggforsok: 1

## Modellkedja (Davids krav 17/8, reservvag 7/9)

* krav: **claude-opus-5-5**
* utveckling: **claude-opus-5-5**
* granskning: **claude-opus-5-5 (Codex spärrat — Davids regel 12/10; Codex granskar i efterhand)**

Granskaren ar inte forfattaren: claude-opus-5-5 (Codex spärrat — Davids regel 12/10; Codex granskar i efterhand) granskade claude-opus-5-5s arbete.

effort (Davids beslut 20/10): create-story high · validering high · bygg xhigh · granskning xhigh — riskdel crm
Allt pa Davids abonnemang - inga API-tokens.
