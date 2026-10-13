# PRD-bygget uppdragsytan 1-10-en-ny-bedomning-som-david-begar-nar-honom-fardig-att-satta — PRD uppdragsytan 1-10-en-ny-bedomning-som-david-begar-nar-honom-fardig-att-satta: # Story 1.10: En n

Datum: 2026-10-13 11:03 · Branch: cto/prd-uppdragsytan-1-10-en-ny-bedomning-som-david-begar-nar-ho-9197 · Kalla: 02-Områden/hermes/uppdragsytan-1c-prd.md (fryst 29/9, Davids beslut #194)

## Mal
PRD uppdragsytan 1-10-en-ny-bedomning-som-david-begar-nar-honom-fardig-att-satta: # Story 1.10: En ny bedömning som David begär når honom färdig att sätta Status: ready-for-dev <!-- Note: Validation is 

## PRD-kravet (ordagrant ur den frysta PRD:n) och astras kodgranskning
```
# Story 1.10: En ny bedömning som David begär når honom färdig att sätta

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->
<!-- Rättad genom correct-course 2026-10-13 efter andra granskningen i drift (post 19 i codex-efterhand, MEDIUM: avtalets id jämfördes skiftlägeskänsligt). Det enda som byggs är Task 8. Task 1–7 är i drift och byggs inte om. Förslaget: _bmad-output/planning-artifacts/sprint-change-proposal-1-10-en-ny-bedomning-som-david-begar-nar-honom-fardig-att-satta.md. -->

<!-- Kodbas: redovisning. Epic 1 (Undantagsvyn). Beror på: Story 1.6 (done enligt sprint-status.yaml). Story 1.7, 1.8 och 1.9 står också i done, och deras kod finns i arbetskopian (0077–0081). Byggvillkoren K-8 (1.1) och KRAV-13 (1.2) står i done. En migration: 0082_bedomningsbegaran.sql (nästa lediga nummer, mätt 2026-10-13: 0001–0081 finns; parallelization-analysis.md rad 403 reserverar namnet). En ny tabell, två nya kolumner, en ny åtgärd och en utökad åtgärd. -->
<!-- Story key: 1-10-en-ny-bedomning-som-david-begar-nar-honom-fardig-att-satta · Story ID: 1.10 · Skapad 2026-10-13 med BMAD create-story i autonomt läge (YOLO). -->

## Story

As a David,
I want kunna begära en ny bedömning av ett uppdrag och få frågan i undantagsvyn med underlaget sammanställt, där jag sätter läget med en enda handling,
so that jag bedömer när jag själv ser skäl till det, utan att sammanställa underlaget och utan att samma bedömning kräver två handlingar.

**Krav:** FR-40 (posten `ny_bedomning` när David själv begär den, PRD avsnitt 6), FR-15 (den mänskliga bedömningen och spärren), FR-16 (underlaget och en enda handling), FR-14 (bara mänskligt satta lägen, ingen vidareföring), FR-23 och NFR-4, ur `epics.md` rad 969–1026. **Regression:** FR-15 (uppfyllt i koden): `satt_bedomning` behåller `kravManniska` och `satt_av_manniska`. Automatisk upptäckt av bedömningsbehov väntar på Davids svar och hör till Epic 14 (Story 14.3). Arkitekturens grund: åtgärdstabellen (`architecture.md` rad 428–429), B-3:s urvalslista och tabellen över postslag (rad 456–476 och 502), kommunikationsmönstret (rad 939), katalogträdet (rad 1074 och 1114) och kategoritabellen (rad 1215–1216). PRD:ns lydelse: FR-14 (`prd.md` rad 616–626), FR-15 (rad 628–636), FR-16 (rad 638–648), FR-40 (rad 850–869), FR-23 (rad 728–732), NFR-4 (rad 959–965) och avsnitt 6 (rad 1045: ”ny bedömning när han själv begär den (FR-15)”).

**Läget före Task 1–7, i en mening.** Läget i koden i drift före Task 8 står i Dev Notes → ”Rättelsen efter andra granskningen i drift” → ”Läget i koden i drift”. Mätt 2026-10-13 före Task 1–7: en bedömning kan bara sättas på Bedömning-sidan eller genom `satt_bedomning`. Det finns ingen begäran, ingen post `ny_bedomning` i undantagsvyns läsväg (`POSTSLAG` har fyra slag, `uppdragUndantag.ts` rad 15), och `uppdrag_bedomning` bär inte vem som satte raden, bara `satt_av_manniska` (0068 rad 153–174; Lägets kort säger det uttryckligen i `routes.ts` rad 4056–4057).

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

**Rättad genom correct-course 2026-10-13, efter andra granskningen i drift.** Berättelsen byggdes, godkändes och driftsattes 2026-10-13 (Task 1–7). En oberoende andra granskning av ändringen i drift (claude-opus-5-5 i Codex ställe, Davids ord 12/10) fann alla tio kriterier implementerade med de föreskrivna proven, men gav UNDERKANT för ett fynd:
- **MEDIUM, avtalets id jämförs skiftlägeskänsligt.** `besvaradBegaran` (`server/src/services/uppdragBedomning.ts` rad 422) jämför avtalets id ur databasen med indatats `contract_id` som rå sträng. `UuidSchema` godtar versaler och gör inte om dem, och Postgres skriver uuid med gemener. `satt_bedomning { contract_id: <W i versaler>, begaran_id: <B på W> }` hittar avtalet och begäran men svarar 409 `begaran_annat_avtal`, och ingen rad skrivs. Det bryter AC 4 för den indatan och gör AC 5:s ”annat avtal” fel. Samma råa sträng hamnar i `details.contract_id` i auditraderna `uppdrag.bedomning_begard` och `uppdrag.bedomning_satt`.

Felet kom ur berättelsen. Dev Notes föreskrev jämförelsen och auditraderna utan att säga var avtalets id kommer ifrån, och `lasAvtalet` föreskrevs läsa bara namnet. Det enda som byggs nu är **Task 8**: `lasAvtalet` läser avtalets id ur den låsta raden, och båda åtgärderna använder det id:t efter låset, i jämförelsen, frågorna, INSERT:en och auditr
```

## Utfall
Tester: 154 passed (154) · Granskning: GODKANT | Task 8 är byggd som berättelsen föreskriver: avtalets id tas ur låsraden och används i allt efter låset, proven K3 (k) och K4 (l) 1–4 ingår i kedjans gröna körning (154 av 154), och granskni · Byggforsok: 1

## Modellkedja (Davids krav 17/8, reservvag 7/9)

* krav: **claude-opus-5-5**
* utveckling: **claude-opus-5-5**
* granskning: **claude-opus-5-5 (Codex spärrat — Davids regel 12/10; Codex granskar i efterhand)**

Granskaren ar inte forfattaren: claude-opus-5-5 (Codex spärrat — Davids regel 12/10; Codex granskar i efterhand) granskade claude-opus-5-5s arbete.

Allt pa Davids abonnemang - inga API-tokens.
