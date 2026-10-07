# PRD-bygget uppdragsytan 1-4-godkannandevagen-bevarar-ett-mottaget-beslut-och-verkstaller-det-utan-ny-kvittens — PRD uppdragsytan 1-4-godkannandevagen-bevarar-ett-mottaget-beslut-och-verkstaller-det-utan-ny-kvitte

Datum: 2026-10-07 09:41 · Branch: cto/prd-uppdragsytan-1-4-godkannandevagen-bevarar-ett-mottaget-b-9165 · Kalla: 02-Områden/hermes/uppdragsytan-1c-prd.md (fryst 29/9, Davids beslut #194)

## Mal
PRD uppdragsytan 1-4-godkannandevagen-bevarar-ett-mottaget-beslut-och-verkstaller-det-utan-ny-kvittens: # Story 1.4: Godkännandevägen bevarar ett mottaget beslut och verkställer det utan ny kvittens Status: ready-for-dev <!-

## PRD-kravet (ordagrant ur den frysta PRD:n) och astras kodgranskning
```
# Story 1.4: Godkännandevägen bevarar ett mottaget beslut och verkställer det utan ny kvittens

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

<!-- Kodbas: redovisning. Epic 1 (Undantagsvyn). Beror på: Story 1.2 (done). Byggvillkoren K-8 (1.1) och KRAV-13 (1.2) står i done. Våg 3 i parallelization-analysis.md (rad 352–360) tillsammans med 1.3, 3.5, 10.1 och 11.1. Migrationsnumret 0077 är reserverat för berättelsen (rad 357; regel 5, rad 654). -->
<!-- Story key: 1-4-godkannandevagen-bevarar-ett-mottaget-beslut-och-verkstaller-det-utan-ny-kvittens · Story ID: 1.4 · Skapad 2026-10-06 med BMAD create-story i autonomt läge (YOLO). -->

## Story

As a David,
I want att mitt ja eller nej sparas i samma ögonblick som jag ger det, skilt från verkställigheten,
so that ett tekniskt fel aldrig tappar ett beslut jag redan fattat och aldrig ber mig svara igen.

**Krav:** FR-41 (handlingen registreras med ja eller nej; ett tekniskt fel blir aldrig en ny fråga och kräver ingen ny beslutskvittens), FR-4, NFR-3, NFR-4 och NFR-7 (`epics.md` rad 561–636). Arkitekturens grund är B-2 punkt 1–3 (`architecture.md` rad 401–416) och B-1, ”Mottagandet skilt från verkställigheten” (rad 288–291).

**Vad berättelsen gör.** Tre additiva ändringar i kärnan, i B-2:s ordning:
1. `ActionContext` får det valfria fältet `approvalId`, som `approveAction` sätter när handlern körs.
2. Kroppen i `rejectApproval` bryts ut till `avvisaGodkannande(client, companyId, userId, approvalId, skal?)` i `server/src/services/approvals.ts`.
3. En åtgärd kan få det nya valfria fältet `tvafas: true`. För en sådan åtgärd skiljs mottagandet från verkställigheten:
   - **Mottagandet** sker i transaktion 1: låset, `approved` eller `rejected`, `decided_by`, `decided_at`, `beslut_hash` och vid nej `beslut_skal`, och därefter auditraden. Sedan committas transaktionen.
   - **Verkställigheten** sker i transaktion 2, genom `verkstallBeslut`.
   - **Ett misslyckat försök** tas om av `verkstallMottagnaBeslut`, utan nytt ja eller nej.

**Vad berättelsen inte gör:**
- **Ingen produktionsåtgärd får `tvafas` här.** Följande hör till senare berättelser:
  - Story 1.7: listan `MANDATATGARDER`, `uppdrag_beslut`, `avboj_beslutsforslag` och svepets steg för mottagna beslut;
  - Story 1.15: `ersatt_av`;
  - Story 1.13: driftprovet `beslutsverkstallning.py`.
- **Tvåfasvägen prövas med en syntetisk teståtgärd.** Den finns bara i provfilen och använder samma `vi.mock`-grepp som `server/test/manniskosparr.test.ts`.
- **Befintliga åtgärder beter sig i drift som i dag.** Allt sker i en transaktion, och vid fel står köposten kvar som `pending`.

**Bygge och grind.** Byggkedjan bygger berättelsen i en kopia, en gren i redovisningens repo, och driftsätter först efter godkänd code-review (Dev Notes → ”Byggkedjan”). Varje uppgift och varje acceptanskriterium prövas i kopian, före driftsättningen, med provet `server/test/uppdragsytan-godkannandevag.test.ts`.

## Acceptance Criteria

Kriterierna 1–13 är ordagranna ur `epics.md` (Story 1.4, rad 571–636). Raderna under *Mätbart* anger hur kriteriet prövas i den här kodbasen och lägger inte till några krav. Allt prövas i kopian med provfilen `server/test/uppdragsytan-godkannandevag.test.ts`. P-numren står i Dev Notes → ”Prov och verifiering”.

1. **Handlern vet vilken köpost den verkställer.**
   **Given** en `sensitive` åtgärd i kön
   **When** en människa godkänner den via `approveAction`
   **Then** körs handlern med `ctx.approvalId` satt till köpostens id
   **And** åtgärder som inte läser fältet beter sig som förut, eftersom fältet är valfritt.
   - *Mätbart:* `ActionContext` i `server/src/actions/registry.ts` (rad 105–118) får `approvalId?: string`. Den syntetiska handlern antecknar `ctx.approvalId`. Efter godkännandet är värdet köpostens id, både för `test_tvafas` och för `test_utan_tvafas` (P3, P10). `executeAction` sätter inte fältet.
   - *Mätbart:* `npm run typecheck` ger exit 0, och ingen befintlig `def({...})` har ändrats. De befintliga sviterna med godkännanden är gröna i kedjans `npm test`, bland annat:
     - `ai-markning.test.ts` och `crm-provenance.test.ts`;
     - `approval-dependencies.test.ts`;
     - `bakvag.test.ts`, `manniskosparr.test.ts` och `bokslut.test.ts`.

2. **Mottagandets kolumner och deras oföränderlighet.**
   **Given** nästa lediga migration
   **When** `action_approvals` utökas
   **Then** får tabellen de additiva, nullbara kolumnerna `beslut_hash` och `beslut_skal`, och inget nytt statusvärde (de befintliga `approved` och `rejected` bär det mottagna beslutet)
   **And** en trigger fäller varje ändring av `decided_by`, `decided_at`, `beslut_hash` och `beslut_skal` när de väl är satta.
   - *Mätbart:* migrationen heter `server/migrations/0077_beslut_mottaget.sql`. Numret är reserverat i vågplanen.
   - *Mätbart:* `information_schema.columns` visar båda kolumnerna med `data_type = 'text'` och `is_nullable = 'YES'`. Statusvillkoret ur 0012, med `pending`, `approved`, `rejected`, `executed` och `failed`, är oförändrat enligt `pg_get_constraintdef` (P2).
   - *Mätbart:* rollen `app` (`withTenantTransaction` ur `server/src/db/tx.ts`) försöker ändra vart och ett av de fyra fälten på en post där fältet är satt.
     - Varje försök fälls med SQLSTATE `P0001`, och raden är oförändrad efteråt.
     - Den positiva kontrollen: när beslutet tas emot går fälten från NULL till ett värde utan fel (P2, P3, P5).

3. **Ja tas emot först och verkställs sedan.**
   **Given** det nya valfria fältet `tvafas: true` på en åtgärdsdefinition (i provet en syntetisk åtgärd)
   **When** en människa godkänner en köpost för åtgärden via `approveAction`
   **Then** bevaras mottagandet först i en egen transaktion: köposten låses med `lockPendingApproval`, sätts till `approved` med `decided_by`, `decided_at` och `beslut_hash` (sha256 av det lagrade indatat med sorterade nycklar), auditraden `action.approved` skrivs med id och koder, och transaktionen committas
   **And** verkställigheten körs därefter i en egen transaktion av `verkstallBeslut(client, companyId, approvalId)`, som kör handlern med `ctx.approvalId` och sätter `executed` med resultatet.
   - *Mätbart:* indatat `{ phone, name, email }` ger `beslut_hash` = sha256 av strängen `{"email":"…","name":"…","phone":"…"}` (P3).
     - Strängen står som literal i provet, och summan räknas där med `node:crypto`, inte med funktionen som prövas.
     - Utan sortering ger jsonb ordningen `name, email, phone`, och då blir provet rött.
   - *Mätbart:* auditloggen för köposten har i ordning `action.approval_requested`, `action.approved` och `action.approved_executed`.
     - `details` bär bara id och koder, aldrig fritext.
     - `decided_at` är samma före och efter verkställigheten.
     - Köposten står i `executed` med handlerns resultat (P3).

4. **Avvisningen bryts ut och bär skälet.**
   **Given** dagens `rejectApproval`
   **When** kroppen bryts ut till `avvisaGodkannande(client, companyId, userId, approvalId, skal?)` i `services/approvals.ts`
   **Then** används samma lås (`lockPendingApproval`) och samma auditrad `action.rejected`, och köposten får `rejected`, `decided_by`, `decided_at`, `beslut_hash` och skälet
   **And** `rejectApproval` anropar funktionen i sin egen transaktion som i dag
   **And** för en `tvafas`-åtgärd kör `verkstallBeslut` därefter åtgärdens valfria `vidAvslag` i en egen transaktion och sätter `result`.
   - *Mätbart:* för `test_tvafas` ger avvisningen med skälet `"  Fel kund  "` följande (P4):
     - raden står i `rejected` med `beslut_hash` (samma härledning som i AC 3) och `beslut_skal = 'Fel kund'`;
     - `vidAvslag` har därefter körts en gång, och `result` är `{"vid_avslag": …}`;
     - auditloggen har `action.rejected` och sedan `action.rejected_executed`.
   - *Mätbart:* för en åtgärd utan `tvafas` är avvisningen som i dag: `rejected`, `decided_by` och `decided_at` (P10).
     - `beslut_hash`, `beslut_skal` och `result` förblir 
```

## Utfall
Tester: 145 passed (145) · Granskning: GODKANT | Alla acceptanskriterier är implementerade, föregående loggläckage är åtgärdat och inga kvarstående fynd har identifierats med kedjans verifierade testutfall 145 passed (145). · Byggforsok: 2

## Modellkedja (Davids krav 17/8, reservvag 7/9)

* krav: kordes inte
* utveckling: **gpt-6.1-sol**
* granskning: **gpt-6-astra**

Granskaren ar inte forfattaren: gpt-6-astra granskade gpt-6.1-sols arbete.

Allt pa Davids abonnemang - inga API-tokens.
