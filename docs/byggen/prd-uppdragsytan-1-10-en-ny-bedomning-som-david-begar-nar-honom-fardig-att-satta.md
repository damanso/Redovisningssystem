# PRD-bygget uppdragsytan 1-10-en-ny-bedomning-som-david-begar-nar-honom-fardig-att-satta — PRD uppdragsytan 1-10-en-ny-bedomning-som-david-begar-nar-honom-fardig-att-satta: # Story 1.10: En n

Datum: 2026-10-13 08:21 · Branch: cto/prd-uppdragsytan-1-10-en-ny-bedomning-som-david-begar-nar-ho-9196 · Kalla: 02-Områden/hermes/uppdragsytan-1c-prd.md (fryst 29/9, Davids beslut #194)

## Mal
PRD uppdragsytan 1-10-en-ny-bedomning-som-david-begar-nar-honom-fardig-att-satta: # Story 1.10: En ny bedömning som David begär når honom färdig att sätta Status: ready-for-dev <!-- Note: Validation is 

## PRD-kravet (ordagrant ur den frysta PRD:n) och astras kodgranskning
```
# Story 1.10: En ny bedömning som David begär når honom färdig att sätta

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

<!-- Kodbas: redovisning. Epic 1 (Undantagsvyn). Beror på: Story 1.6 (done enligt sprint-status.yaml). Story 1.7, 1.8 och 1.9 står också i done, och deras kod finns i arbetskopian (0077–0081). Byggvillkoren K-8 (1.1) och KRAV-13 (1.2) står i done. En migration: 0082_bedomningsbegaran.sql (nästa lediga nummer, mätt 2026-10-13: 0001–0081 finns; parallelization-analysis.md rad 403 reserverar namnet). En ny tabell, två nya kolumner, en ny åtgärd och en utökad åtgärd. -->
<!-- Story key: 1-10-en-ny-bedomning-som-david-begar-nar-honom-fardig-att-satta · Story ID: 1.10 · Skapad 2026-10-13 med BMAD create-story i autonomt läge (YOLO). -->

## Story

As a David,
I want kunna begära en ny bedömning av ett uppdrag och få frågan i undantagsvyn med underlaget sammanställt, där jag sätter läget med en enda handling,
so that jag bedömer när jag själv ser skäl till det, utan att sammanställa underlaget och utan att samma bedömning kräver två handlingar.

**Krav:** FR-40 (posten `ny_bedomning` när David själv begär den, PRD avsnitt 6), FR-15 (den mänskliga bedömningen och spärren), FR-16 (underlaget och en enda handling), FR-14 (bara mänskligt satta lägen, ingen vidareföring), FR-23 och NFR-4, ur `epics.md` rad 969–1026. **Regression:** FR-15 (uppfyllt i koden): `satt_bedomning` behåller `kravManniska` och `satt_av_manniska`. Automatisk upptäckt av bedömningsbehov väntar på Davids svar och hör till Epic 14 (Story 14.3). Arkitekturens grund: åtgärdstabellen (`architecture.md` rad 428–429), B-3:s urvalslista och tabellen över postslag (rad 456–476 och 502), kommunikationsmönstret (rad 939), katalogträdet (rad 1074 och 1114) och kategoritabellen (rad 1215–1216). PRD:ns lydelse: FR-14 (`prd.md` rad 616–626), FR-15 (rad 628–636), FR-16 (rad 638–648), FR-40 (rad 850–869), FR-23 (rad 728–732), NFR-4 (rad 959–965) och avsnitt 6 (rad 1045: ”ny bedömning när han själv begär den (FR-15)”).

**Läget i dag, i en mening.** En bedömning kan bara sättas på Bedömning-sidan eller genom `satt_bedomning`. Det finns ingen begäran, ingen post `ny_bedomning` i undantagsvyns läsväg (`POSTSLAG` har fyra slag, `uppdragUndantag.ts` rad 15), och `uppdrag_bedomning` bär inte vem som satte raden, bara `satt_av_manniska` (0068 rad 153–174; Lägets kort säger det uttryckligen i `routes.ts` rad 4056–4057).

**Vad berättelsen gör.**
1. **Migration 0082.** Ny tabell `uppdrag_bedomningsbegaran` (ÄGD, append-only, RLS, sammansatt FK, avslutstriggern). `uppdrag_bedomning` får de nullbara kolumnerna `begaran_id` (sammansatt FK till begäran i samma avtal) och `satt_av` (vem som satte raden). En bedömning besvarar högst en begäran.
2. **Begäran.** Den nya åtgärden `begar_ny_bedomning` (write, `kravManniska`) skriver en begäran. Finns en obesvarad begäran för avtalet skapas ingen andra, och svaret pekar på den befintliga.
3. **Bedömningen besvarar begäran.** `satt_bedomning` får det valfria fältet `begaran_id`. Raden får `satt_av` ur den inloggade användaren. En bedömning utan `begaran_id` besvarar avtalets obesvarade begäran, om det finns en. En redan besvarad begäran ger 409 `begaran_besvarad`.
4. **Posten.** `las_undantag` bygger en post `ny_bedomning` per obesvarad begäran. Posten har senaste mänskliga bedömning med läge, datum och vem, vad som ändrats sedan dess med källa och lästid, och vad ett val registrerar. Inget läge är förvalt, och ingen maskin föreslår ett läge. `las_uppdragslage` visar avtalets öppna begäran.
5. **Vyn.** På ett aktivt uppdrag får Läget knappen *Begär ny bedömning* i kortet *Senaste bedömning* och en rad i bandet *Väntar på dig* när en begäran är öppen. På ett stängt uppdrag säger kortet att en öppen begäran inte längre kan besvaras. Bedömning-sidan säger att bedömningen besvarar begäran.
6. **Dokumentationen och de befintliga proven följer med.**

**Vad berättelsen inte gör:**
- **Ingen undantagsvy, ingen ny rutt och inga knappar för posten.** Vyn med de tre lägena och mobilproven är Story 1.11 (`epics.md` rad 1098–1101). Här finns posten i läsvägen (REST och MCP), och Läget får begärans knapp. `architecture.md` rad 468 kräver att ett nytt slag får sitt formulär och sina mobilprov i samma ändring. Undantagsvyn finns inte ännu, och Story 1.11 bygger den med alla fem slag och tabellens rad för `ny_bedomning` (`epics.md` rad 1073–1081), så här finns inget vyformulär att ändra. Raden i arkitekturens tabell finns redan (rad 475).
- **Ingen automatisk upptäckt av bedömningsbehov och ingen vidareföring.** Det är Story 14.3 (`epics.md` rad 3980–4027). Davids svar om vilka förändringar som kräver ny bedömning (`underlag/davids-svar.md` rad 21–23) används inte här.
- **Ingen rytm och inget ankardatum.** Det är Story 2.3. Postens förslag på period är samma kalendermånad som Bedömning-sidans formulär redan förvalt.
- **Ingen rapportpost.** `uppdrag_rapport` och ”Ingen bedömning satt” i rapporten är Story 12.1.
- **Inget tillbakadragande av en begäran.** Frågan står under ”Frågor till David”.
- **Ingenting under `hermes/`**, ingen ändring av `server/kontrakt/navigation.v1.json` och ingen ny vyrutt.

**Bygge och grind.** Byggkedjan bygger berättelsen i en kopia, en gren i redovisningens repo, och driftsätter först efter godkänd code-review (Dev Notes → ”Byggkedjan”). Varje uppgift och varje acceptanskriterium prövas i kopian före driftsättningen, med proven K0–K6 i Dev Notes → ”Prov och verifiering”. Varje uppgift skriver sina egna fall och belägger dem röda innan koden skrivs och gröna efteråt. Har sessionen ett skal görs det med vitest och inklistrad utdata. Saknas skal skrivs ”inte kört i sessionen: <skälet>” och det förutsagda utfallet i Debug Log, och uppgiften lämnas till granskning utan HALT (`architecture.md` rad 1361–1374, ”Redovisningsberättelser i byggkedjan: grindarna före merge”, punkt 3). Grindarna `npm run typecheck` och `npm test` kör kedjan efter dig och före granskningen, och bygget kör deployen. Ingen ruta ber dig köra en grind (Dev Notes → ”Byggrinden”).

## Acceptance Criteria

Kriterierna 1–10 är ordagranna ur `epics.md` (Story 1.10, rad 982–1026). Raderna under *Mätbart* anger hur kriteriet prövas i den här kodbasen och lägger inte till några krav. Två slags rader förekommer:
- **Mekanism:** det som gör ett ”aldrig”, ett ”ingen” eller ett ”bara” sant genom konstruktion, alltså en enda väg in, en rättighet som saknas, en trigger, ett lås eller ett fält som aldrig förs vidare.
- **Fallista:** den ändliga lista som provet prövar. Inget prov letar efter ”varje skrivning” eller ”varje form” i koden.

Allt prövas i kopian. K-numren står i Dev Notes → ”Prov och verifiering”.

1. **Tabellen och kolumnen.**
   **Given** nästa lediga migration
   **When** `uppdrag_bedomningsbegaran` skapas
   **Then** har tabellen kategorin ÄGD, är append-only (`SELECT, INSERT`), har RLS via `app_has_company_access`, sammansatt FK till `contracts` och triggern `vagrar_skrivning_pa_avslutat`, och bär avtal, `begard_av`, `begard_nar` och en frivillig kommentar
   **And** `uppdrag_bedomning` får den nullbara kolumnen `begaran_id` med sammansatt FK.
   - *Mätbart:*
     - **Nästa lediga migration** är `server/migrations/0082_bedomningsbegaran.sql` (`parallelization-analysis.md` rad 403).
     - **Kolumnerna** är exakt `id`, `company_id`, `contract_id` (avtal), `begard_av` (uuid mot `users`), `begard_nar` (timestamptz) och `kommentar` (text, NULL när den saknas). Alla utom `kommentar` är `NOT NULL`.
     - **Kategorin** står som första led i `COMMENT ON TABLE`: `'Kategori: ÄGD, append-only. …'`, med det förkomponerade tecknet Ä. Annars fäller `agandebrister` (`uppdragsytan-agandegrans-cache.test.ts` rad 18–35) och Hermes `agandegrans.py` tabellen.
     - **Sammansatt FK:** `(contract_id, company_id)` mot `contracts (id, company_id)`. Begärans nyckel `UNIQUE (id, company_id, contract_id)` bär FK:n från `u
```

## Utfall
Tester: 154 passed (154) · Granskning: GODKANT | Alla tio acceptanskriterier finns i koden med prov som ingår i kedjans gröna körning (154 av 154), och granskningen hittade inga HIGH- eller MEDIUM-fynd. · Byggforsok: 1

## Modellkedja (Davids krav 17/8, reservvag 7/9)

* krav: **claude-opus-5-5**
* utveckling: **claude-opus-5-5**
* granskning: **claude-opus-5-5 (Codex spärrat — Davids regel 12/10; Codex granskar i efterhand)**

Granskaren ar inte forfattaren: claude-opus-5-5 (Codex spärrat — Davids regel 12/10; Codex granskar i efterhand) granskade claude-opus-5-5s arbete.

Allt pa Davids abonnemang - inga API-tokens.
