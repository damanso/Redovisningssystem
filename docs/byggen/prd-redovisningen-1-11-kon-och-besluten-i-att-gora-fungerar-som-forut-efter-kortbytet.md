# PRD-bygget redovisningen 1-11-kon-och-besluten-i-att-gora-fungerar-som-forut-efter-kortbytet — PRD redovisningen 1-11-kon-och-besluten-i-att-gora-fungerar-som-forut-efter-kortbytet: # Story 1.11:

Datum: 2026-11-20 17:41 · Branch: cto/prd-redovisningen-1-11-kon-och-besluten-i-att-gora-fungerar--9302 · Kalla: 02-Områden/hermes/prd/redovisningen-1c-prd.md (fryst 29/9, Davids beslut #194)

## Mal
PRD redovisningen 1-11-kon-och-besluten-i-att-gora-fungerar-som-forut-efter-kortbytet: # Story 1.11: Kön och besluten i Att göra fungerar som förut efter kortbytet Status: ready-for-dev <!-- Skapad av create

## PRD-kravet (ordagrant ur den frysta PRD:n) och astras kodgranskning
```
# Story 1.11: Kön och besluten i Att göra fungerar som förut efter kortbytet

Status: ready-for-dev

<!-- Skapad av create-story (BMAD v6.0.1, #yolo) 2026-11-20. Validering: checklistan kördes i steg 6, se Dev Notes «Validering». -->

Kodbas: redovisning. Krav: FR-27 (kön nåbar från agentens sida, aktörsgarantin, godkännandet och avvisningen; regressionskriterierna utdelade ur Story 1.1 2026-11-20). Beror på: 1.1 (done).

## Story

As a David (ägare av Locollabs AB och den enda som får säga ja eller nej i Att göra),
I want att agenten fortfarande kan lägga förslag i kön och läsa den men aldrig avgöra ett förslag, och att mitt ja och mitt nej i Att göra fungerar som förut med det nya kortet,
so that kortbytet inte öppnar någon väg förbi mitt beslut.

## Förkrav

```förkrav
fil: server/test/forslagskort-beslut.test.ts ny
fil: docs/STATUS.md ändras
fil: server/test/helpers.ts läses
fil: server/test/mcp.test.ts läses
fil: server/test/actions.test.ts läses
fil: server/test/view.test.ts läses
fil: server/test/view-create-flows.test.ts läses
fil: server/test/forslagskort-klartext.test.ts läses
fil: server/test/uppdragsytan-godkannandevag.test.ts läses
fil: server/test/uppdragsytan-beslut.test.ts läses
fil: server/test/setup.ts läses
fil: server/test/globalSetup.ts läses
fil: server/src/mcp/server.ts läses
fil: server/src/actions/registry.ts läses
fil: server/src/actions/execute.ts läses
fil: server/src/actions/dependencies.ts läses
fil: server/src/lib/beslutsunderlag.ts läses
fil: server/src/services/approvals.ts läses
fil: server/src/services/uppdragBeslut.ts läses
fil: server/src/services/approvalSummary.ts läses
fil: server/src/services/invoices.ts läses
fil: server/src/http/routes/actions.ts läses
fil: server/src/http/view/routes.ts läses
fil: server/src/http/middleware/authenticate.ts läses
fil: server/src/http/middleware/errorHandler.ts läses
fil: server/src/lib/errors.ts läses
fil: server/vitest.config.ts läses
fil: server/tsconfig.test.json läses
fil: server/package.json läses
fil: CLAUDE.md läses
fil: docs/ARKITEKTUR.md läses
fil: docs/project-context.md läses
fil: docs/MCP_ACTIONS.md läses
prov: forslagskort-beslut nytt GRÖN
prov: mcp berörs GRÖN
prov: actions berörs GRÖN
prov: view berörs GRÖN
prov: view-create-flows berörs GRÖN
prov: forslagskort-klartext berörs GRÖN
prov: uppdragsytan-godkannandevag berörs GRÖN
prov: uppdragsytan-beslut berörs GRÖN
tjanst: 127.0.0.1:5433 vitest kör alla prov mot den stående testdatabasen redovisning-vitest-pg
```

Blocket deklarerar bara filer i repot och vitest-sviter, alla GRÖNA. Berättelsen ändrar ingen produktionskod, lägger inte till något paket, ingen migration, ingen rutt och ingen åtgärd. Inga `beroende:`-, `kontrakt:`-, `kommando:`- eller `kraver:`-rader står i blocket, och skälen finns i Dev Notes under «Förkravsblocket och kedjan cto» och, för socklarna i provkörningen, under «Testkrav». Inga `namner:`-rader behövs, eftersom inget av ordregelns ord står i berättelsen. Baslinjen ur provvakten står under «Baslinjen».

## Acceptance Criteria

Kriterierna står ordagrant som i epics.md (Story 1.11). Fallen B1.1–B4.2 finns alla i den nya provfilen `server/test/forslagskort-beslut.test.ts`. Där ett befintligt prov redan visar samma led hänvisas till det under raden «Stöd».

1. **Kön från agentens sida** *(regression)*
   **Given** ett agent-token
   **When** agenten gör ett känsligt anrop genom åtgärdsrutten eller MCP-servern och därefter anropar `list_pending_approvals`
   **Then** svaret på anropet är 202 `{ status: 'pending_approval', approval }` och förslaget finns i listan
   **And** MCP-serverns verktygslista består av manifestets åtgärder plus `list_pending_approvals` och `self_check`, och inget verktyg godkänner eller avvisar ett förslag

   *Mätbart (correct-course 2026-11-20, ordagrant ur epics.md):*
   - **Mekanismen** är att verktygslistan byggs på ett enda ställe, som `manifest.map(toolFor)` plus exakt två extra verktyg (`EXTRA_TOOLS` i `server/src/mcp/server.ts`).
   - **Godkännande** sker bara i `approveAction`, som kräver en mänsklig aktör.
   - **Avvisning** sker bara genom `rejectApproval`, som kräver en mänsklig aktör, eller genom `ersattGodkannande`. Den senare nås bara genom `kompletteraForslag` och verktyget `komplettera_beslutsforslag`.
   - **De två manifestverktyg som når en avvisning** är `komplettera_beslutsforslag` och `avboj_beslutsforslag`. Båda är `kravManniska`, och `executeAction` fäller dem för en agent före varje skrivning.
   - **Fallistan:**
     - verktygslistan jämförs som mängd;
     - agentens godkännande och avvisning prövas över REST;
     - de två `kravManniska`-verktygen, som redan prövas i `uppdragsytan-beslut`.

   *Så mäts det här:*
   - **Kön:** B1.1 går genom åtgärdsrutten och B1.2 genom MCP-servern.
   - **Verktygslistan:**
     - B1.3 jämför listan som mängd mot `actionManifest()` plus de två namnen och kräver att antalet är manifestets plus två, alltså inga dubbletter;
     - B1.5 är motprovet med ett planterat godkännandeverktyg.
   - **De två `kravManniska`-verktygen:** B1.4 anropar dem genom MCP-servern och får 403 `human_required`.
   - **Agentens godkännande och avvisning över REST** mäts i B2.1.

   Stöd: `uppdragsytan-beslut` fall «c (5) agentnyckeln får 403 på ja, nej och kompletteringen» (samma två verktyg över REST), `mcp` fallet «tools/call på en KÄNSLIG action bokför INTE» och `actions` fallet «agent begär bokföring → pending».

2. **Aktörsspärren** *(regression)*
   **Given** ett väntande förslag
   **When** en agent anropar `POST /api/companies/:id/approvals/:approvalId/approve` eller `…/reject`, eller `approveAction` anropas med icke-mänsklig aktör
   **Then** svaret är 403 `human_approval_required`, förslaget är fortfarande väntande och ingenting har bokförts

   *Mätbart:*
   - **Fallen:** B2.1 (REST godkänn, REST avvisa med och utan skäl) och B2.2 (`approveAction` och `rejectApproval` direkt med aktören `'agent'`).
   - **«Ingenting har bokförts»** mäts med en ögonblicksbild före och efter. Bilden har fyra delar:
     - förslagets status;
     - antalet verifikat i bolaget;
     - fakturans `voucher_id`;
     - auditraderna för förslaget.
   - **Motprov:** B2.3 visar att samma ögonblicksbild ändras när en människa godkänner.

   Stöd: `actions` fallet «agent kan INTE godkänna» och `uppdragsytan-godkannandevag` fall P11.

3. **Godkännandet** *(regression)*
   **Given** ett väntande `book_invoice`
   **When** en människa godkänner i vyn eller via `POST /approvals/:id/approve` med mänsklig identitet
   **Then** fakturan bokförs, förslaget står som Utförd under "Nyss avgjort" och auditraden `action.approved_executed` finns
   **And** ett godkännande som misslyckas rullar tillbaka allt, förslaget står kvar som väntande och felet visas som notis på Att göra; bara `not_pending` är tyst

   *Mätbart:*
   - **Mekanismen för «bara `not_pending` är tyst»** är en enda felgren. Vyns två beslutsrutter, `POST /app/c/:companyId/approvals/:id/approve` och `…/reject`, går båda genom `decideApproval` i `server/src/http/view/routes.ts`, som har tre utgångar:
     - `BadRequestError` och `ConflictError` med en annan kod än `not_pending` leder till `?fel=Kunde inte utföras: …`;
     - `not_pending` leder tyst till `beslutsplats` eller till Att göra, och «tyst» betyder en redirect utan `fel=`;
     - alla andra fel kastas vidare, som 404 eller 500, och blir alltså aldrig tysta.
   - **Fallen:**
     - B3.1, godkänt i vyn;
     - B3.2, godkänt över REST;
     - B3.3, ett godkännande som misslyckas med `ConflictError('already_booked')` och ger notisen;
     - B3.4, `not_pending` som är tyst.

     Notisen för `not_booked` visas redan av `view-create-flows`, i fallet «betalning på OBOKFÖRD faktura».
   - **«Rullar tillbaka allt»** mäts med samma ögonblicksbild som i AC 2.

4. **Avvisningen** *(regression)*
   **Given** ett väntande `book_invoice`
   **When** en människa avvisar det i vyn
   **Then** förslaget får status `rejected` och listas under Avvisad, audi
```

## Utfall
Tester: 186 passed (186) · Granskning: GODKANT | Alla fyra acceptanskriterier och kryssade uppgifter är uppfyllda; inga belagda fynd, och kedjans typkontroll och hela testsvit är gröna. · Byggforsok: 1

## Modellkedja (Davids krav 17/8, reservvag 7/9)

* krav: kordes inte
* utveckling: **gpt-6.1-sol**
* granskning: **gpt-6-astra**

Granskaren ar inte forfattaren: gpt-6-astra granskade gpt-6.1-sols arbete.

effort (Davids beslut 20/10): create-story high · validering high — planeringssteg
Allt pa Davids abonnemang - inga API-tokens.
