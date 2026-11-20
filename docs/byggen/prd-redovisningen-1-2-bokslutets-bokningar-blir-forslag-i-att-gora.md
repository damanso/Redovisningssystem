# PRD-bygget redovisningen 1-2-bokslutets-bokningar-blir-forslag-i-att-gora — PRD redovisningen 1-2-bokslutets-bokningar-blir-forslag-i-att-gora: # Story 1.2: Bokslutets bokninga

Datum: 2026-11-20 16:49 · Branch: cto/prd-redovisningen-1-2-bokslutets-bokningar-blir-forslag-i-at-9301 · Kalla: 02-Områden/hermes/prd/redovisningen-1c-prd.md (fryst 29/9, Davids beslut #194)

## Mal
PRD redovisningen 1-2-bokslutets-bokningar-blir-forslag-i-att-gora: # Story 1.2: Bokslutets bokningar blir förslag i Att göra Status: ready-for-dev <!-- Note: Validation is optional. Run v

## PRD-kravet (ordagrant ur den frysta PRD:n) och astras kodgranskning
```
# Story 1.2: Bokslutets bokningar blir förslag i Att göra

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

Som David,
vill jag att "Bokför avsättning", "Bokför skatt" och "Bokför årets resultat" på Bokslut blir förslag som jag godkänner, och att varje fel syns,
så att bokslutet aldrig bokförs förbi min granskning och aldrig misslyckas i tysthet.

**Kodbas:** redovisning. **Krav:** FR-22 (de bokförande stegen), FR-38 (Bokslutets tre bokningar från vyn), FR-3 (utförda åtgärder inklusive verksamhetsbeskrivningen och köade förslag från vyn). Arkitektur: AD-1 och UX K2. **Beror på:** inga. **Utdelat 2026-11-20 (correct-course):** det härledda provet över vyns rutter, importprovet och regeln på ett ställe står i Story 1.12; regressionen för agent, contractor, revisionsloggen och det bokförda verifikatet står i Story 1.13; vyns SIE-import byggs i Story 1.3. **Senare berättelser som bygger på den här:** 1.12 (importprovet förutsätter att bokslutstjänsternas import är borta ur rutten), 1.10 (korttexterna för bokslutets förslag).

## Förkrav

```förkrav
fil: server/src/http/view/routes.ts ändras
fil: server/test/bokslut.test.ts ändras
fil: docs/STATUS.md ändras
fil: server/src/actions/registry.ts läses
fil: server/src/actions/execute.ts läses
fil: server/src/actions/dependencies.ts läses
fil: server/src/services/approvals.ts läses
fil: server/src/services/bokslut.ts läses
fil: server/src/services/sieImport.ts läses
fil: server/src/services/accounting/fiscalYears.ts läses
fil: server/src/services/accounting/vouchers.ts läses
fil: server/src/http/view/html.ts läses
fil: server/src/http/view/auth.ts läses
fil: server/src/http/middleware/authenticate.ts läses
fil: server/src/http/middleware/companyAccess.ts läses
fil: server/src/http/routes/accounting.ts läses
fil: server/src/http/routes/invoices.ts läses
fil: server/src/http/routes/receipts.ts läses
fil: server/src/http/routes/parties.ts läses
fil: server/src/http/routes/actions.ts läses
fil: server/src/lib/errors.ts läses
fil: server/src/db/tx.ts läses
fil: server/test/helpers.ts läses
fil: server/test/actions.test.ts läses
fil: server/test/k2-annual.test.ts läses
fil: server/test/annual-management.test.ts läses
fil: server/test/accounting.test.ts läses
fil: server/test/audit-immutability.test.ts läses
fil: server/test/fixed-assets.test.ts läses
fil: server/test/ink2.test.ts läses
fil: server/test/crm-contractor-role.test.ts läses
fil: server/test/uppdragsytan-godkannandevag.test.ts läses
fil: server/test/forslagskort-klartext.test.ts läses
fil: server/test/view.test.ts läses
fil: server/test/entity-links.test.ts läses
fil: server/test/navigation.test.ts läses
fil: server/test/import.test.ts läses
fil: server/test/setup.ts läses
fil: server/src/mcp/server.ts läses
fil: server/kontrakt/navigation.v1.json läses
fil: server/vitest.config.ts läses
fil: server/tsconfig.json läses
fil: server/package.json läses
fil: package.json läses
fil: CLAUDE.md läses
fil: docs/ARKITEKTUR.md läses
fil: docs/project-context.md läses
fil: docs/MCP_ACTIONS.md läses
prov: bokslut ändras GRÖN
prov: actions berörs GRÖN
prov: k2-annual berörs GRÖN
prov: annual-management berörs GRÖN
prov: accounting berörs GRÖN
prov: audit-immutability berörs GRÖN
prov: fixed-assets berörs GRÖN
prov: ink2 berörs GRÖN
prov: import berörs GRÖN
prov: view berörs GRÖN
prov: forslagskort-klartext berörs GRÖN
prov: entity-links berörs GRÖN
prov: navigation berörs GRÖN
prov: crm-contractor-role berörs GRÖN
prov: manniskosparr berörs GRÖN
prov: uppdragsytan-godkannandevag berörs GRÖN
prov: uppdragsytan-beslut berörs GRÖN
prov: uppdragsytan-utskick berörs GRÖN
prov: crm-sandvag berörs GRÖN
prov: uppdragsytan-undantag berörs GRÖN
prov: statusetiketter berörs GRÖN
tjanst: 127.0.0.1:5433 vitest kör alla prov mot den stående testdatabasen redovisning-vitest-pg
```

Blocket deklarerar filerna i repot, vitest-sviterna och testdatabasen. Tre slag av rader står medvetet inte i blocket, eftersom förkontrollen (`hermes/skills/forkontroll.py`) fäller dem i kedjan cto och berättelsen inte kräver dem:
- **Inga `beroende:`-rader.** K5 läser i kedjan cto bara rotens `package.json`. Den har bara `workspaces` och inga `dependencies` (rad 1241–1250), så varje paketrad blir RÖD. Berättelsen lägger inte till något paket. Paketen den använder (express, zod, pg, vitest och supertest) står redan i `server/package.json`, som raden `fil:` läser.
- **Inga `kommando:`-rader.** K7 godtar bara git-läsformer (rad 1332–1334). Grindarnas körningar (`npm run typecheck`, `npm run build`, `npm test`) görs av kedjan efter utvecklaren. Kedjans utvecklarroll har inget skal (Dev Notes → Körmiljön i kedjans bygge).
- **Inga `kontrakt:`-rader och inga Hermes-prov.** K8 kräver ett Hermes-prov `prov/<namn>.py` för varje kontrakt (rad 1488). En funktion i redovisningen ger KUNDE_INTE (rad 1392), och en rutt läses ur Hermes ytserver (rad 1375–1387). Alla funktioner, rutter och tabeller som fallen förutsätter finns redan i samma repo, och de prövas av vitest-sviterna ovan. K4 ger RÖD för varje `prov:` som inte är GRÖN i en annan kedja än hermes (rad 1189–1190), och K9 gäller inte i kedjan cto (Dev Notes → Baslinjen).

Inget nytt paket, ingen migration, ingen ny rutt, ingen ny åtgärd och ingen ny provfil tillkommer.

## Acceptance Criteria

Kriterierna står ordagrant som i planeringens epics.md (Story 1.2, efter delningen 2026-11-20). Raderna *Mätbart (berättelsen)* lägger till mekanismen och den ändliga fallistan för kriterier som lovar «aldrig», «inga», «varje» eller «ingen». Ingen rad ändrar ett kriteriums innebörd.

1. **Given** ett räkenskapsår och en inloggad människa på Bokslut
   **When** hen skickar "Bokför avsättning…" (`POST /app/c/:companyId/annual/pf`) med ett belopp större än 0, "Bokför skatt…" (`/annual/tax`) eller "Bokför årets resultat…" (`/annual/result`)
   **Then** rutten kör `runViewAction` med `book_periodiseringsfond` (`{ fiscal_year_id, type: 'avsattning', amount_ore }`), `book_corporate_tax` (`{ fiscal_year_id, amount_ore }`) respektive `book_year_result` (`{ fiscal_year_id }`), och användaren skickas till Att göra
   **And** ett väntande förslag med exakt den indatan finns, inget verifikat har skapats och auditraden `action.approval_requested` finns för förslaget

   *Mätbart (berättelsen):* en enda väg in. De tre rutterna anropar bara `runViewAction`, och `executeAction` köar varje `sensitive` åtgärd på rad 81 i `server/src/actions/execute.ts` utan att köra handlern. Importen av `bookPeriodiseringsfond`, `bookCorporateTax` och `bookYearResult` tas bort ur `server/src/http/view/routes.ts` (rad 101), så att rutten inte kan nå tjänsten. Story 1.12:s importprov vaktar den importen framåt. Fallistan: B1.1 (avsättning 20 000 kr), B1.2 (skatt 12 360 kr) och B1.3 (årets resultat).

2. **Given** ett sådant väntande förslag
   **When** en människa godkänner det
   **Then** verifikatet bokförs med samma konton och belopp som tjänsten gav vid direkt bokning (de belopp `bokslut.test.ts` förväntar), och auditraden `action.approved_executed` skrivs
   **And** ett godkännande som tjänsten avvisar (till exempel för ett låst år) rullas tillbaka helt, förslaget står kvar som väntande och felet syns som notis på Att göra

   *Mätbart (berättelsen):* godkännandet går som i dag genom `approveAction` i en transaktion. De tre åtgärderna har ingen `tvafas`, så handlern, statusbytet och auditraden går i samma transaktion (`server/src/actions/execute.ts` rad 158–201), och ett fel rullar tillbaka allt. `decideApproval` i `server/src/http/view/routes.ts` skickar varje fel utom `not_pending` till Att göra som `?fel=` (lärdom 4). Inget i den vägen ändras. Fallistan: B1.4 (de tre förslagen godkända i vyn ger samma tal som `server/test/bokslut.test.ts` rad 42–81) och B1.5 (låst år efter köandet).

3. **Given** "Bokför avsättning…" med beloppet 0
   **When** formuläret skickas
   **Then** inget förslag skapas och Bokslut visar `
```

## Utfall
Tester: 185 passed (185) · Granskning: GODKANT | Samtliga acceptanskriterier och kryssade uppgifter är uppfyllda; inga belagda fynd, och kedjans 185 tester är godkända. · Byggforsok: 1

## Modellkedja (Davids krav 17/8, reservvag 7/9)

* krav: kordes inte
* utveckling: **gpt-6.1-sol**
* granskning: **gpt-6-astra**

Granskaren ar inte forfattaren: gpt-6-astra granskade gpt-6.1-sols arbete.

effort (Davids beslut 20/10): validering high — planeringssteg
Allt pa Davids abonnemang - inga API-tokens.
