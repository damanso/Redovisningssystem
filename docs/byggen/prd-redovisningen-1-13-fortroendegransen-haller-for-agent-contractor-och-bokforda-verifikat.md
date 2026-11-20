# PRD-bygget redovisningen 1-13-fortroendegransen-haller-for-agent-contractor-och-bokforda-verifikat — PRD redovisningen 1-13-fortroendegransen-haller-for-agent-contractor-och-bokforda-verifikat: # Story

Datum: 2026-11-20 18:31 · Branch: cto/prd-redovisningen-1-13-fortroendegransen-haller-for-agent-co-9303 · Kalla: 02-Områden/hermes/prd/redovisningen-1c-prd.md (fryst 29/9, Davids beslut #194)

## Mal
PRD redovisningen 1-13-fortroendegransen-haller-for-agent-contractor-och-bokforda-verifikat: # Story 1.13: Förtroendegränsen håller för agent, contractor och bokförda verifikat Status: ready-for-dev <!-- Skapad av

## PRD-kravet (ordagrant ur den frysta PRD:n) och astras kodgranskning
```
# Story 1.13: Förtroendegränsen håller för agent, contractor och bokförda verifikat

Status: ready-for-dev

<!-- Skapad av create-story (BMAD v6.0.1, #yolo) 2026-11-20. Validering: checklistan kördes för hand i steg 6, se Dev Notes «Validering». -->

Kodbas: redovisning. Krav: FR-2 (hela lydelsen), FR-3 (avvisningarna och oföränderligheten i testdatabasen), FR-38 (agentens anrop och transportrutterna bakom `requireHuman`; regressionskriterierna utdelade ur Story 1.2 2026-11-20). Beror på: inga.

## Story

As a David (ägare av Locollabs AB och den enda som får säga ja eller nej i Att göra),
I want att agentens känsliga anrop alltid blir förslag, att avvisade anrop inte lämnar några spår och att ett bokfört verifikat bara kan rättas med ett nytt,
so that jag kan lita på att förtroendegränsen håller oavsett vem som anropar.

## Förkrav

```förkrav
fil: server/test/actions.test.ts ändras
fil: docs/STATUS.md ändras
fil: server/test/helpers.ts läses
fil: server/test/setup.ts läses
fil: server/test/globalSetup.ts läses
fil: server/test/env.ts läses
fil: server/test/accounting.test.ts läses
fil: server/test/audit-immutability.test.ts läses
fil: server/test/annual-management.test.ts läses
fil: server/test/k2-annual.test.ts läses
fil: server/test/bokslut.test.ts läses
fil: server/test/crm-contractor-role.test.ts läses
fil: server/test/crm-sfar-svep.ts läses
fil: server/test/mcp-felomslag.test.ts läses
fil: server/src/actions/execute.ts läses
fil: server/src/actions/registry.ts läses
fil: server/src/actions/dependencies.ts läses
fil: server/src/http/middleware/companyAccess.ts läses
fil: server/src/http/middleware/authenticate.ts läses
fil: server/src/http/routes/accounting.ts läses
fil: server/src/http/routes/invoices.ts läses
fil: server/src/http/routes/receipts.ts läses
fil: server/src/http/routes/companies.ts läses
fil: server/src/http/routes/actions.ts läses
fil: server/src/services/accounting/vouchers.ts läses
fil: server/src/services/projects.ts läses
fil: server/vitest.config.ts läses
fil: server/tsconfig.test.json läses
fil: server/package.json läses
fil: CLAUDE.md läses
fil: docs/ARKITEKTUR.md läses
fil: docs/project-context.md läses
fil: docs/MCP_ACTIONS.md läses
prov: actions ändras GRÖN
prov: accounting berörs GRÖN
prov: audit-immutability berörs GRÖN
prov: annual-management berörs GRÖN
prov: k2-annual berörs GRÖN
tjanst: 127.0.0.1:5433 vitest kör alla prov mot den stående testdatabasen redovisning-vitest-pg
```

Blocket deklarerar bara filer i repot och vitest-sviter, alla GRÖNA. Berättelsen ändrar ingen produktionskod. Den lägger inte till något paket, ingen migration, ingen rutt och ingen åtgärd. Inga `beroende:`-, `kontrakt:`-, `kommando:`- eller `kraver:`-rader står i blocket, och skälen står i Dev Notes under «Förkravsblocket och kedjan cto». Inga `namner:`-rader behövs, eftersom inget av ordregelns fyra ord står i berättelsen. Baslinjen ur provvakten står i Dev Notes under «Baslinjen».

## Acceptance Criteria

Kriterierna står ordagrant som i epics.md (Story 1.13), med raden *Mätbart* och noten oförändrade. Under varje kriterium står *Så mäts det här*, med fallen i den här berättelsen och de befintliga fall som redan visar ett led («Stöd»). Alla nya fall skrivs i `server/test/actions.test.ts`, med egen rigg i filen, som noten föreskriver.

1. **Agent och contractor** *(regression)*
   **Given** ett agent-token och en roll `contractor`
   **When** agenten anropar en känslig åtgärd, agenten anropar en kravManniska-åtgärd, och en `contractor` anropar en åtgärd den inte får köra
   **Then** det känsliga anropet ger `pending_approval` med beroendet beräknat vid köandet och en auditrad; kravManniska-anropet ger 403 `human_required`; contractor-anropet ger `contractor_not_permitted`
   **And** de två avvisade anropen har inte skrivit någonting: ingen ny rad i någon tabell och ingen auditrad
   **And** de fem transportrutterna med `requireHuman` (`invoices.ts` `POST /:id/book`, `receipts.ts` `POST /:id/book`, och i `accounting.ts` `PATCH /fiscal-years/:id`, `POST /vouchers` och `POST /vouchers/:id/reverse`) ger agenten 403 (`actions.test.ts`); de två `accounting.ts`-rutter som efter FR-2-bygget kör `lock_period`/`reverse_voucher` via `executeAction` ger människan 202, inte direkt verkan

   *Mätbart (correct-course 2026-11-20, ordagrant ur epics.md):* «ingen ny rad i någon tabell» mäts med en ögonblicksbild av radantalet i varje tabell i schemana `public` och `crm`, med tabellistan härledd ur `pg_tables` i den migrerade testdatabasen. Bilden tas efter förberedelserna (projekt, contractor-användare och inbjudan) och före de två avvisade anropen, och den ska vara lika efteråt. Spärrarna ligger före varje skrivning: `kravManniska` i `executeAction` och contractor-spärren i `requireCompanyAccess` (`server/src/http/middleware/companyAccess.ts`). Fallistan: agentens `register_invoice_payment` för en obokad faktura (202 med beroendet och auditraden), agentens `set_project_status` (403 `human_required`), contractorns `create_customer` (403 `contractor_not_permitted`), ögonblicksbilden, och de fem rutterna med agent-token (403 `human_required` var för sig). Människans 202 visas av befintliga fall i `accounting.test.ts`.

   *Så mäts det här:*
   - **Det känsliga anropet:** R1.1 (agentens `register_invoice_payment` för en obokad faktura).
   - **De två avvisade anropen och ögonblicksbilden:** R1.2. Motprovet R1.4 visar att samma ögonblicksbild ser en skrivning.
   - **De fem rutterna:** A1.1, med en ögonblicksbild över alla fem anropen. Motprovet A1.2 visar att samma fem rutter inte ger 403 för en människa, så att 403 i A1.1 kommer av aktören och inte av en saknad rutt.
   - **Mekanismen** är två spärrar med en enda väg in var, och provet räknar inte upp «alla tänkbara skrivningar» (se Dev Notes, «Invarianter och fallistor»).

   Stöd: `server/test/accounting.test.ts` rad 125 och 141 (människans 202 för återföringen) och rad 181 (människans 202 för låset), samt `server/test/actions.test.ts` fallet «agent nekas bokföring/periodlås/verifikat direkt» (tre av de fem rutterna).

2. **Revisionsloggen** *(regression, FR-3)*
   **Given** testsviterna `actions` och `audit-immutability`
   **When** `npm test` körs
   **Then** en utförd skrivåtgärd ger auditraden `action.executed` och ett köat förslag `action.approval_requested`, i samma transaktion som mutationen
   **And** UPDATE, DELETE och TRUNCATE mot `audit_log` avvisas även för tabellägaren av triggern, och som rollen `app` ger UPDATE och DELETE `permission denied`

   *Så mäts det här:*
   - **`action.approval_requested`:** befintligt fall `server/test/actions.test.ts` rad 157 («audit har både begäran och godkännande») och det nya R1.1, som läser auditraden för förslaget.
   - **`action.executed`:** sviten `actions` saknar i dag ett fall som läser raden. Det skrivs här som R2.1 (agentens `create_customer`), med motprovet R2.2 (en skrivåtgärd som fälls i tjänsten lämnar ingen `action.executed`). Vyns väg visas redan av `server/test/annual-management.test.ts` rad 77.
   - **«I samma transaktion»** bärs av konstruktionen: `writeAudit` anropas med samma klient inuti samma `withTenantTransaction` som handlern (`server/src/actions/execute.ts` rad 84–99) och som köposten (rad 116–138). R2.1 och R2.2 visar utfallen på båda sidor.
   - **Oföränderligheten:** befintliga fall `server/test/audit-immutability.test.ts` rad 47 (UPDATE), 53 (DELETE), 59 (TRUNCATE) och 63 (rollen `app`). Rad 30 visar en auditrad i samma transaktion som en direkt mutation.

3. **Det bokförda verifikatet** *(regression, FR-2)*
   **Given** ett bokfört verifikat
   **When** rollen `app` gör UPDATE på `vouchers`, och tabellägaren gör UPDATE på `vouchers` och DELETE på `voucher_lines`
   **Then** app-rollen får `permission denied`, och triggern stoppar tabellägaren med felet om oföränderlighet (`accounting.test.ts`)
   **And** en godkänd `reverse_voucher` skapar ett nytt verifikat som speglar originalet med `reverses_voucher_id` satt, en andra åter
```

## Utfall
Tester: 186 passed (186) · Granskning: GODKANT | Samtliga acceptanskriterier och kryssade uppgifter är uppfyllda; inga konkreta fel hittades, och kedjans verifierade testutfall är grönt. · Byggforsok: 1

## Modellkedja (Davids krav 17/8, reservvag 7/9)

* krav: kordes inte
* utveckling: **gpt-6.1-sol**
* granskning: **gpt-6-astra**

Granskaren ar inte forfattaren: gpt-6-astra granskade gpt-6.1-sols arbete.

effort (Davids beslut 20/10): create-story high · validering high — planeringssteg
Allt pa Davids abonnemang - inga API-tokens.
