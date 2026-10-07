# PRD-bygget uppdragsytan 1-5-en-lagrad-baselineversion-skrivs-aldrig-over — PRD uppdragsytan 1-5-en-lagrad-baselineversion-skrivs-aldrig-over: # Story 1.5: En lagrad baselineve

Datum: 2026-10-07 12:28 · Branch: cto/prd-uppdragsytan-1-5-en-lagrad-baselineversion-skrivs-aldrig-9167 · Kalla: 02-Områden/hermes/uppdragsytan-1c-prd.md (fryst 29/9, Davids beslut #194)

## Mal
PRD uppdragsytan 1-5-en-lagrad-baselineversion-skrivs-aldrig-over: # Story 1.5: En lagrad baselineversion skrivs aldrig över Status: ready-for-dev <!-- Note: Validation is optional. Run v

## PRD-kravet (ordagrant ur den frysta PRD:n) och astras kodgranskning
```
# Story 1.5: En lagrad baselineversion skrivs aldrig över

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

<!-- Kodbas: redovisning. Epic 1 (Undantagsvyn). Beror på: Story 1.2 (done). Byggvillkoren K-8 (1.1) och KRAV-13 (1.2) står i done. Våg 4 i parallelization-analysis.md (rad 362–368) tillsammans med Hermes-berättelserna 10.2 och 11.2. Migrationsnumret 0079 är reserverat för berättelsen (rad 366; regel 5, rad 654). -->
<!-- Story key: 1-5-en-lagrad-baselineversion-skrivs-aldrig-over · Story ID: 1.5 · Skapad 2026-10-07 med BMAD create-story i autonomt läge (YOLO). -->

## Story

As a David,
I want att varje lagrad version av planen står kvar som den lagrades, bekräftad eller inte,
so that en ändring alltid blir en ny version med orsak och jag kan svara på vad som gällde när vi kom överens.

**Krav:** FR-2 (ingen version skrivs över eller raderas, och en ändring utan orsak avvisas), FR-4 och FR-41 (ett tillägg blir en ny version), ur `epics.md` rad 638–688. Arkitekturens grund är B-7 (`architecture.md` rad 296–307) och IR-04 (rad 100). Förifylld orsak, fyra läsbara versioner och eget leverabeldatum hör till Story 2.2 och byggs inte här.

**Vad berättelsen gör.** Den gör regeln ”en lagrad version ändras aldrig” sann genom konstruktion, på två lager:
1. **Schemat är sista försvarslinjen.** Triggern `kraver_orsak_vid_ny_version()` på `contract_parts` utökas i migrationen `0079_baselineversion.sql`. Den jämför hela raden före och efter mot en **tillåtelselista** med två kolumner: `cap_confirmed`, och bara från `false` till `true`, och `updated_at`, som husets egen trigger sätter. Varje annan skillnad fälls, och varje DELETE fälls. Det gäller varje skrivväg, också direkt SQL.
2. **Tjänsterna har en enda väg in.** `upsertContractPart` i `server/src/services/contracts.ts` förlorar sin gren som uppdaterar på plats. Det blir två funktioner:
   - **`skrivBaselineversion`** gör bara INSERT. En redan lagrad `(contract_id, code, valid_from)` ger 409 `version_finns` före skrivningen. `andra_baseline`, `upsert_contract_part` och `satt_baseline` skriver alla genom den.
   - **`bekraftaTak`** gör det enda tillåtna: `cap_confirmed` från `false` till `true`.
3. **`update_contract` avvisar baselineburna kolumner** (409 `kraver_ny_version`) före köbildningen. Listan står på ett ställe, i `server/src/lib/baselinekolumner.ts`.
4. **`skapa_uppdrag` lagrar ingen avtalsdel längre.** Rotdelen `UPPDRAG` skapas av baseline version 1 (`satt_baseline`). I dag skapar `skapa_uppdrag` en tom rotdel, och `satt_baseline` skriver sedan över den. Det är just den överskrivning som FR-2 förbjuder, och utan ändringen kan ingen baseline sättas alls efter 0079 (Beslutslogg, punkt 2).

**Vad berättelsen inte gör:**
- **Ingen åtgärd får `tvafas`, och ingen `uppdrag_beslut`.** `MANDATATGARDER` och beslutsraden hör till Story 1.7.
- **Ingen förifylld orsak och ingen versionshistorik i vyn.** De hör till Story 2.2.
- **Inget nytt statusvärde, ingen ny tabell, ingen ny kolumn och ingen ny vy.**
- **Ingen ändring av hur en ny version ärver fält ur den förra.** En ny version bär de fält som skickas, precis som `andra_baseline` gör i dag.

**Bygge och grind.** Byggkedjan bygger berättelsen i en kopia, en gren i redovisningens repo, och driftsätter först efter godkänd code-review (Dev Notes → ”Byggkedjan”). Varje uppgift och varje acceptanskriterium prövas i kopian, före driftsättningen, med provet `server/test/uppdragsytan-baselineversion.test.ts` och de befintliga sviter som Task 9 räknar upp.

## Acceptance Criteria

Kriterierna 1–8 är ordagranna ur `epics.md` (Story 1.5, rad 650–688). Raderna under *Mätbart* anger hur kriteriet prövas i den här kodbasen och lägger inte till några krav. Två slags rader förekommer:
- **Mekanism:** det som gör ett ”aldrig” eller ett ”varje” sant genom konstruktion, alltså en enda väg in eller en tillåtelselista.
- **Fallista:** den ändliga lista som provet prövar.

Allt prövas i kopian. P-numren står i Dev Notes → ”Prov och verifiering”.

1. **Triggern fryser varje lagrad rad i uppdragets baseline.**
   **Given** nästa lediga migration
   **When** triggern `kraver_orsak_vid_ny_version()` på `contract_parts` utökas
   **Then** fäller den för avtal med projekt (uppdragets baseline) varje ändring av en lagrad rads innehåll eller orsak (ram, period, förälder, taxa, datum, precision, `change_reason`, `name` och `description`), oavsett om raden är bekräftad eller obekräftad
   **And** den fäller varje DELETE av en sådan rad
   **And** det enda som får ändras på en lagrad rad är bekräftelsemarkeringen, och bara från obekräftad till bekräftad
   **And** avtal utan projekt omfattas inte av modulens regel och beter sig som i dag, provat som regression.
   - *Mätbart:* migrationen heter `server/migrations/0079_baselineversion.sql`, och numret är reserverat i vågplanen. Den byter funktionen med `CREATE OR REPLACE` och lägger om triggern `contract_parts_kraver_orsak` som `BEFORE INSERT OR UPDATE OR DELETE`. Ingen körd migration (0001–0078) ändras.
   - *Mekanism:* för en UPDATE på ett avtal med projekt jämför triggern `to_jsonb(NEW) - ARRAY['cap_confirmed','updated_at']` med motsvarande för `OLD`.
     - Varje skillnad ger `RAISE EXCEPTION` (SQLSTATE `P0001`), likaså `OLD.cap_confirmed AND NOT NEW.cap_confirmed`.
     - Listan är en tillåtelselista. Varje kolumn utanför den är fryst, också kolumner som läggs till senare, så provet behöver inte känna igen ”alla sätt att ändra”.
     - DELETE ger `RAISE EXCEPTION`. Rollen `app` saknar dessutom DELETE-rätt sedan 0064 (rad 164).
     - Triggern sitter i Postgres och gäller därför varje skrivväg: tjänsterna, REST, MCP, vyn, direkt SQL som `app` och som ägarrollen (Dev Notes → ”Migrationen”).
   - *Fallista (P2):* proven körs mot en obekräftad rad (`L1`) och en bekräftad rad (`UPPDRAG`) ur samma importerade baseline. För vardera körs en UPDATE per kolumn i denna ändliga lista:
     - de elva i kriteriet: `cap_hours`, `cap_amount_ore`, `start_date`, `end_date`, `valid_from`, `date_precision`, `parent_part_id`, `hourly_rate_ore`, `change_reason`, `name` och `description`;
     - fem till: `billable`, `sort_order`, `active`, `manually_edited` och `code`;
     - på den bekräftade raden dessutom `cap_confirmed` från `true` till `false`;
     - DELETE.

     Varje försök körs som `app` (`withTenantTransaction`) och fälls: UPDATE med `P0001`, DELETE med `42501`. En UPDATE och en DELETE körs dessutom som ägarrollen (`withAdmin`) och fälls med `P0001`, vilket visar att det är triggern och inte bara rättigheterna som stoppar. Efteråt är båda raderna identiska med ögonblicksbilden, jämförda i sin helhet och också i `updated_at`.
   - *Fallista (P3), den positiva kontrollen:* som `app` går `cap_confirmed` från `false` till `true` på `L1` igenom. Efteråt skiljer sig raden från ögonblicksbilden bara i `cap_confirmed` och `updated_at`.
   - *Fallista (P4), INSERT-grenen är oförändrad:* en andra version av en kod utan `change_reason` fälls med `P0001` och 0068:s meddelande. En andra version med orsak och nytt `valid_from` går igenom, och den första versionen är oförändrad.
   - *Fallista (P5), avtal utan projekt:*
     - **(a) Mängden är tom.** `contracts.project_id` är `NOT NULL` sedan 0064 (rad 47). En INSERT i `contracts` utan `project_id` fälls som ägarrollen med SQLSTATE `23502`. I drift finns alltså inget avtal utan projekt, och varje avtal är uppdragets baseline (Beslutslogg, punkt 1).
     - **(b) Regressionen, i provdatabasen.** Med `withAdmin` släpps `NOT NULL` tillfälligt, på samma sätt som 1.4:s planterade trigger (P9). Därefter läggs ett avtal utan projekt in med en obekräftad och en bekräftad rad. På det avtalet gäller 0068:s regel ordagrant:
       - den obekräftade raden får ny `cap_hours` på plats;
       - den bekräftade raden fälls för `cap_hours` med 0068:s meddelande ”bekräftad baseline för avtalsdel … ändras inte in-place”;
       - den bekräftade rade
```

## Utfall
Tester: 146 passed (146) · Granskning: GODKANT | Alla åtta acceptanskriterier är implementerade, omtagens rättningar håller och inga kvarstående HIGH- eller MEDIUM-fynd har identifierats. · Byggforsok: 3

## Modellkedja (Davids krav 17/8, reservvag 7/9)

* krav: kordes inte
* utveckling: **gpt-6.1-sol**
* granskning: **gpt-6-astra**

Granskaren ar inte forfattaren: gpt-6-astra granskade gpt-6.1-sols arbete.

Allt pa Davids abonnemang - inga API-tokens.
