# PRD-bygget uppdragsytan 1-16-nej-ger-ett-svarsutkast-som-david-sjalv-skickar — PRD uppdragsytan 1-16-nej-ger-ett-svarsutkast-som-david-sjalv-skickar: # Story 1.16: Nej ger ett sva

Datum: 2026-10-15 19:10 · Branch: cto/prd-uppdragsytan-1-16-nej-ger-ett-svarsutkast-som-david-sjal-9215 · Kalla: 02-Områden/hermes/uppdragsytan-1c-prd.md (fryst 29/9, Davids beslut #194)

## Mal
PRD uppdragsytan 1-16-nej-ger-ett-svarsutkast-som-david-sjalv-skickar: # Story 1.16: Nej ger ett svarsutkast som David själv skickar Status: ready-for-dev <!-- Note: Validation is optional. R

## PRD-kravet (ordagrant ur den frysta PRD:n) och astras kodgranskning
```
# Story 1.16: Nej ger ett svarsutkast som David själv skickar

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

<!-- Kodbas: redovisning. Epic 1 (Undantagsvyn). Beror på: Story 1.15, som är mergad till main (byggjournalen docs/byggen/prd-uppdragsytan-1-15-ja-till-tillagg-eller-till-ryms-registreras-utan-en-andra-kvittens.md finns, och 0083 och 1.15:s namn finns i arbetskopian). Byggvillkoren K-8 (1.1) och KRAV-13 (1.2) står i done. En migration (0084), inget nytt paket, ingen ny env, ingen ny åtgärd och ingen ny tjänst. Våg 12 i parallelization-analysis.md rad 425–429. -->
<!-- Story key: 1-16-nej-ger-ett-svarsutkast-som-david-sjalv-skickar · Story ID: 1.16 · Skapad 2026-10-15 med BMAD create-story i autonomt läge (YOLO). Arbetskatalogen bar 1.15:s kod; radnumren i Dev Notes → ”Läget i dag” är lästa där. -->
<!-- Correct-course 2026-10-15 efter bygge #9213, som stoppades. Skälet och granskarens fynd syns inte i utlösaren, och kopian bar driftkoden utan kandidaten. Förutsättningen och Dev Notes prövades om mot driftkoden och höll. Ändrat: kriterium 8 prövas nu för hela server/src med tre tillåtelselistor i stället för modulens importslutna mängd, kriterium 6 har fått en räckvidd för Davids egen text, och en ny teknisk regel förbjuder orden fetch, WebSocket och EventSource i src. Kriterierna 1–9 är ordagranna. Uppgifterna 1–4 och 6 och fallen M, C, N, L och D är oförändrade. Förslaget: _bmad-output/planning-artifacts/sprint-change-proposal-1-16-nej-ger-ett-svarsutkast-som-david-sjalv-skickar.md. Dev Notes → ”Correct-course 2026-10-15”. -->

## Story

As a David,
I want att mitt nej på en kundförfrågan sparar skälet och ekonomin och ger mig ett färdigt svarsutkast som jag själv läser och skickar,
so that jag varken skriver svaret från noll eller riskerar att något går till kunden utan mig.

**Krav:** FR-41 punkt (3c) och (4), FR-42 (utskicksgränsen och nej-utkastet) och FR-26. Källan är `epics.md` rad 1390–1452 (Story 1.16, med raden *Mätbart* från correct-course 2026-10-15 på rad 1447–1452).

Arkitekturens grund (`_bmad-output/planning-artifacts/architecture.md`):
- B-1 (rad 274–294): `uppdrag_beslut` med `utkast jsonb` och `utkast_markor` (rad 285);
- B-2 (rad 401–416), särskilt ”Ett mottaget nej” (rad 412) och ”Ersättning är inget beslut” (rad 413);
- åtgärdstabellen, raden `avboj_beslutsforslag` (rad 426): ”utkast när källan är en kundförfrågan (B-5)”;
- B-4 punkt 3 och 4 (rad 710–719);
- B-5 (rad 721–738): utkastet i beslutsraden, mottagaren ur kundens kontaktuppgift, panelen ”Beslut och utkast”, `mailto:`, korrelationsmarkören och utskicksgränsen;
- katalogträdet (rad 1072, 1099–1100, 1108, 1132 och 1147–1148);
- besluten under Utvecklingsflödet om byggkedjan (rad 1361–1374), om diffen och om att beroendet ska vara mergat (rad 1387–1388).

PRD:ns lydelse finns i FR-41 (`prd.md` rad 871–885, kedjan (3c) och (4) på rad 879), FR-42 (rad 887–897) och FR-26 (rad 786).

**Davids svar 2026-10-07 om FR-42** (`underlag/davids-svar.md`): ”Lägger utkast i gmails utkastfolder”. Svaret gäller som beslut. Att lägga utkastet i Gmails utkastmapp är Hermes arbete, med en ny skrivbehörighet mot Gmail, och redovisningen ringer aldrig ut (ADR-4). Den här berättelsen är en redovisningsberättelse och bygger det som Gmail-placeringen behöver: ett fryst utkast med mottagare, ämne med markör och text, läsbart för Hermes genom `las_uppdragslage`. `mailto:`-länken, som kriterium 6 kräver ordagrant, står kvar som Davids egen skickhandling i panelen. Gmail-placeringen saknas som berättelse i `epics.md` (Beslutslogg punkt 2, Frågor till David).

**Läget efter Story 1.15, i en mening.** Ett nej på en Övrigt-fråga går genom `avboj_beslutsforslag` → kärnans `rejectApproval` → `verkstallBeslut` → `vidAvslag` → `registreraNej`, och beslutsraden skrivs med skäl, källa och fryst ekonomi. Men:
- `uppdrag_beslut.utkast` skrivs aldrig, och kolumnen `utkast_markor` finns inte;
- panelen på Läget heter ”Beslut” och har inget utkast och ingen skickhandling;
- provet ”Davids utskick” finns inte i redovisningen.

**Vad berättelsen gör.**
1. **De rena reglerna (Task 1).** Den nya filen `server/src/lib/utkast.ts` bygger markören, ämnet, texten och mottagaren och Davids skickhandling (`mailtoLank`). Den har ingen databas, ingen klocka och inga anrop.
2. **Kolumnen (Task 2).** Migration `0084_utkast_markor.sql` lägger `utkast_markor` på `uppdrag_beslut` med unikt index per bolag och fyra CHECK. Tabellen är redan append-only.
3. **Nejet skriver utkastet (Task 3).** `registreraNej` i `services/uppdragBeslut.ts` bygger utkastet när källan är en Övrigt-rad, efter att ha prövat raden med 1.14:s `provaOvrigtKalla`, som ja-vägarna använder. Utkastet och markören skrivs i samma INSERT som beslutsraden, i verkställigheten efter mottagandet. Löpnumret tas ur husets nummerserie (`nextDocumentNumber`) i samma transaktion.
4. **Läget (Task 4).** `las_uppdragslage` bär utkastet och markören på varje registrerad beslutsrad. Panelen heter ”Beslut och utkast” och visar utkastet med en `mailto:`-länk under det registrerade nejet.
5. **Provet ”Davids utskick” (Task 5).** Den nya provfilen `uppdragsytan-utskick.test.ts` prövar utskicksgränsen i hela `server/src`. Den har tre tillåtelselistor: e-postköns importörer, nätets utgångar och klassningen av paketlistan. Den kör också ett förlopp.
6. **Dokumentationen (Task 6).** `docs/MCP_ACTIONS.md`, `docs/ARKITEKTUR.md` och sessionsloggen i `docs/STATUS.md`.

**Det som redan finns provas här som regression** (Story 1.4, 1.7, 1.14 och 1.15):
- nejet tas emot på köposten och verkställs i en egen transaktion, med återförsök i svepets första steg;
- en `rejected` köpost utan `beslut_hash`, också en ersatt post, verkställs aldrig;
- en Övrigt-rad med köpost i någon status eller med beslutsrad blir aldrig kandidat igen;
- låset ger 409 `not_pending`, och `UNIQUE (approval_id)` ger exakt en beslutsrad.

Inget av det skrivs om.

**Vad berättelsen inte gör:**
- ingen ny åtgärd och ingen ändring i registret, i `actions/execute.ts` eller i `services/approvals.ts`;
- ingen ändring i `hermes/`, i svepkontraktet (`SvepIndataSchema`) eller i undantagsvyn;
- ingen Gmail-placering, ingen utskickstjänst och ingen ny behörighet (Davids svar ovan, Beslutslogg punkt 2);
- inget utfall för skickat utkast, ingen text ”sparat, inte verifierat skickat”, ingen `oppna_utkast[]` och inga utskicksreferenser (Story 12.5 och 12.6);
- inget utkast för scopesignalens eskalering (Story 7.1) eller för kundrapporten (Story 12.4).

**Bygge och grind.** Byggkedjan bygger berättelsen i en kopia, en gren i redovisningens repo, och driftsätter först efter godkänd code-review (Dev Notes → ”Byggkedjan”).
- Berättelsen bygger på Story 1.15:s kod. Förutsättningen före Task 1 prövar att 1.15 är mergad, belagt med byggjournalen, och att kopian inte bär rester av ett tidigare bygge av den här berättelsen.
- Varje uppgift och varje acceptanskriterium prövas i kopian före driftsättningen, med fallen i Dev Notes → ”Prov och verifiering”.
- Varje uppgift skriver sina egna fall. Fallen beläggs röda innan koden skrivs och gröna efteråt.
- Med skal görs det med vitest och inklistrad utdata. Utan skal skriver du ”inte kört i sessionen: <skälet>” och det förutsagda utfallet i Debug Log och lämnar uppgiften till granskning utan HALT (`architecture.md` rad 1361–1374, punkt 3).
- Grindarna `npm run typecheck` och `npm test` kör kedjan efter dig och före granskningen, och deployen kör bygget. Ingen ruta ber dig köra en grind.

## Acceptance Criteria

Kriterierna 1–9 är ordagranna ur `epics.md` (Story 1.16, rad 1400–1445). Raderna under *Mätbart* anger hur kriteriet prövas i den här kodbasen och lägger inte till några krav. Två slags rader förekommer:
- **Mekanism:** det som gör ett ”aldrig”, ett ”ingen”, ett ”bara” eller ett ”först” sant genom konstruktion, till exempel en enda skrivväg, en CHECK, en fast mall eller en tillåtelselista.
- **Fallista:** de
```

## Utfall
Tester: 161 passed (161) · Granskning: GODKANT | Alla nio acceptanskriterier och alla kryssade uppgifter finns i koden och i proven som kedjan körde (161 av 161 gröna), och det finns inga HIGH- eller MEDIUM-fynd. · Byggforsok: 1

## Modellkedja (Davids krav 17/8, reservvag 7/9)

* krav: **claude-opus-5-5**
* utveckling: **claude-opus-5-5**
* granskning: **claude-opus-5-5 (Codex spärrat — Davids regel 12/10; Codex granskar i efterhand)**

Granskaren ar inte forfattaren: claude-opus-5-5 (Codex spärrat — Davids regel 12/10; Codex granskar i efterhand) granskade claude-opus-5-5s arbete.

Allt pa Davids abonnemang - inga API-tokens.
