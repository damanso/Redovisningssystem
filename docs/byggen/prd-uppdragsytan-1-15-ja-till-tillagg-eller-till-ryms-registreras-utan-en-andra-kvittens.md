# PRD-bygget uppdragsytan 1-15-ja-till-tillagg-eller-till-ryms-registreras-utan-en-andra-kvittens — PRD uppdragsytan 1-15-ja-till-tillagg-eller-till-ryms-registreras-utan-en-andra-kvittens: # Story 1.

Datum: 2026-10-15 04:14 · Branch: cto/prd-uppdragsytan-1-15-ja-till-tillagg-eller-till-ryms-regist-9212 · Kalla: 02-Områden/hermes/uppdragsytan-1c-prd.md (fryst 29/9, Davids beslut #194)

## Mal
PRD uppdragsytan 1-15-ja-till-tillagg-eller-till-ryms-registreras-utan-en-andra-kvittens: # Story 1.15: Ja till tillägg eller till ”ryms” registreras utan en andra kvittens Status: ready-for-dev <!-- Note: Vali

## PRD-kravet (ordagrant ur den frysta PRD:n) och astras kodgranskning
```
# Story 1.15: Ja till tillägg eller till ”ryms” registreras utan en andra kvittens

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

<!-- Kodbas: redovisning. Epic 1 (Undantagsvyn). Beror på: Story 1.5 (mergad till main) och Story 1.14. 1.14:s kod ska vara mergad till main innan berättelsen byggs. sprint-status.yaml visade 1.14 som done båda gångerna kön släppte den här berättelsen, men koden nådde aldrig main (1.14:s tredje correct-course 2026-10-14). Sedan 2026-10-14 22:39 är 1.14 byggd och mergad: bygge #9210 fick GODKANT med 158 av 158 prov, byggjournalen docs/byggen/prd-uppdragsytan-1-14-ovrigt-raden-blir-en-fraga-med-fardig-berakning.md finns, och arbetskopian bär 1.14:s kod. Byggvillkoren K-8 (1.1) och KRAV-13 (1.2) står i done. En migration (0083), inget nytt paket och ingen ny env. Våg 11 i parallelization-analysis.md rad 418–423, tillsammans med Story 1.17 (hermes), som står done. -->
<!-- Story key: 1-15-ja-till-tillagg-eller-till-ryms-registreras-utan-en-andra-kvittens · Story ID: 1.15 · Skapad 2026-10-14 med BMAD create-story i autonomt läge (YOLO). Arbetskatalogen där berättelsen skrevs stod då på 1.11-nivå, liksom main för modulens kod, och 1.14:s kod beskrevs ur dess berättelsefil. Rättad 2026-10-14 med correct-course efter bygge #9206, som utvecklaren stoppade med HALT, eftersom 1.14:s kod saknades i kopian. Förutsättningen före Task 1 prövar nu att 1.14 är mergad, genom byggjournalen, och att kopian inte bär rester av ett eget bygge. Rättad igen 2026-10-14 med en andra correct-course. Bygget som startade 17:42, efter valideringen, stannade med HALT på förutsättningen, eftersom 1.14 fortfarande inte var mergad. Kriterierna, uppgifterna, fallen och förutsättningen är oförändrade (architecture.md, beslutet om beroendet, punkt 5). Bara texten om läget är ändrad. Förslaget, med båda rättelserna: _bmad-output/planning-artifacts/sprint-change-proposal-1-15-ja-till-tillagg-eller-till-ryms-registreras-utan-en-andra-kvittens.md. Dev Notes → ”Läget i dag” beskriver koden i kopian efter 1.14:s merge, med radnummer därifrån. -->

## Story

As a David,
I want att mitt ja på en Övrigt-fråga registrerar exakt det förslag jag såg, som ett tillägg eller som beslutet att det ryms, och att jag kan fylla i saknade timmar i samma fråga,
so that beslutet blir en handling med källorna kvar utan att jag godkänner samma sak två gånger.

**Krav:** FR-41 punkt (2), (3a), (3b), (4) och (5), FR-2, FR-4, FR-23, NFR-3 och NFR-4. Källan är `epics.md` rad 1303–1388 (Story 1.15).

Arkitekturens grund (`_bmad-output/planning-artifacts/architecture.md`):
- B-2 (rad 401–416), särskilt återförsöket (rad 411), ”Ett mottaget nej” (rad 412) och ”Ersättning är inget beslut (IR-13)” (rad 413);
- åtgärdstabellen (rad 418–433), raderna `registrera_uppdragsbeslut`, `andra_baseline` och `komplettera_beslutsforslag` (rad 422, 423 och 430);
- B-3:s tabell över postslag (rad 470–476, raden `ovrigt_beslut`) och ”Ändrat förslag” (rad 505);
- B-4 punkt 3 och 4 (rad 710–719);
- kommunikationsmönstren (rad 925–939) och processmönstret för fel (rad 961–967);
- besluten ”Redovisningsberättelser i byggkedjan: grindarna före merge” (rad 1361–1374) och ”ett förslag som svepet köar går alltid att avgöra” (rad 1385, med räckvidden efter bygge #9202).

PRD:ns lydelse finns i FR-41 (`prd.md` rad 871–885, kedjan på rad 879), FR-4 (rad 464–468), FR-2 (rad 429–431), FR-23 (rad 728–730), NFR-3 (rad 947–951) och NFR-4 (rad 959–963).

**Läget efter Story 1.14, i en mening.** En Övrigt-rad blir en köpost, `registrera_uppdragsbeslut` för ”ryms” och `andra_baseline` med `kalla = {typ: anteckning}` för tillägg, och posten `ovrigt_beslut` visas med beräkning och Ja och Nej genom kärnans mottagande och verkställighet. Men:
- en post med tomt timfält kan inte kompletteras;
- ingen kolumn skiljer en ersatt köpost från ett avslag;
- posten säger inte när källorna ändrats sedan förslaget.

**Vad berättelsen gör.**
1. **Kolumnen och kärnan (Task 1).** Migration 0083 ger `action_approvals` den nullbara kolumnen `ersatt_av`, med sammansatt FK, unikt index, två CHECK och två nya regler i triggern från Story 1.4. Kärnan får:
   - den enda skrivningen av kolumnen, `ersattGodkannande` i `services/approvals.ts`;
   - kolumnen i `APPROVAL_COLUMNS` och i typen `Approval`, så att REST och MCP läser den;
   - villkoret `ersatt_av IS NULL` i `MOTTAGET_EJ_VERKSTALLT`, som återförsöket och Läget delar.
2. **De rena reglerna (Task 2).** `lib/beslutsunderlag.ts` får `delunderlag` och `egetTakTimmar`, avtalsdelens fält i Övrigt-underlaget, som i dag står inne i 1.14:s förslagssteg. Den får också `andratSedanForslaget`, jämförelsen mellan det frysta underlaget och aktuella källor.
3. **Kompletteringen (Task 3).** 1.14:s förslagssteg i `services/uppdragOvrigt.ts` delas, så att svepet och kompletteringen prövar och bygger köpostens indata med samma funktioner (`provaOvrigtForslag` och `byggOvrigtForslag`). Steg 6:s villkor för en upptagen avtalsdel blir funktionen `avtalsdelUpptagen` i `services/uppdragUndantag.ts`, så att också läsvägen kan pröva det (punkt 4). Den nya åtgärden `komplettera_beslutsforslag` (write, `kravManniska`) anropar `kompletteraForslag` i `services/uppdragBeslut.ts`, där arkitekturens katalogträd placerar den (`architecture.md` rad 1099). Den gör följande i en transaktion:
   - låser den väntande posten;
   - bygger ersättaren med Davids timmar och serverns beräkning;
   - köar ersättaren med `createApproval`;
   - märker den gamla posten ersatt;
   - skriver auditraden `uppdrag.forslag_kompletterat`.
4. **”Ändrat sedan förslaget” i läsvägen (Task 4).** `lasUndantag` räknar om varje Övrigt-posts beräkning ur aktuella källor och lägger skillnaden i `ovrigt.andrat`. Där står också om ett tilläggs kod är upptagen, prövat med samma `avtalsdelUpptagen` som kompletteringen.
5. **Vyn (Task 5).** Övrigt-posten får ett JS-fritt formulär för timmarna, POST-grenen `komplettera` och fältet ”Ändrat sedan förslaget”. Formuläret visas inte när läsvägen visat att avtalsdelen inte längre finns eller att koden är upptagen, eftersom kompletteringen då bara kan ge 409 (`architecture.md` rad 505 och 967, `project-context.md` rad 75). Mobilprovet omfattar kompletteringen.
6. **Dokumentationen (Task 6).** `docs/MCP_ACTIONS.md`, `docs/ARKITEKTUR.md` och `docs/STATUS.md` (sessionsloggen och antalet actions i huvudet, räknat ur registret).

**Det som redan finns provas här som regression** (Story 1.4, 1.5, 1.7 och 1.14):
- `registrera_uppdragsbeslut` står i `MANDATATGARDER` med `tvafas`, `vidAvslag` och sin rad i mandatprovet;
- tilläggets nya version och beslutsraden skrivs i samma verkställighet;
- mottagandet är skilt från verkställigheten, och återförsöket körs i svepets första steg;
- låset ger 409 `not_pending`.

Inget av det skrivs om.

**Vad berättelsen inte gör:**
- inget nej-utkast, ingen `utkast_markor` och ingen `mailto:` (Story 1.16);
- ingen ändring i `hermes/`, och inget nytt i svepkontraktet (Story 1.17 formulerar förslagen);
- ingen ny kö, ingen ny exekveringsväg och ingen ny tabell. Kärnan ändras bara på de punkter Task 1 räknar upp;
- ingen omräkning vid verkställigheten. Ja godkänner alltid det lagrade förslaget (fryst historik, FR-41).

**Bygge och grind.** Byggkedjan bygger berättelsen i en kopia, en gren i redovisningens repo, och driftsätter först efter godkänd code-review (Dev Notes → ”Byggkedjan”).
- **Berättelsen bygger på Story 1.14:s kod, och den ska vara mergad till `main`.** Tidigare 2026-10-14 fanns 1.14:s kod varken på `main` eller i kopian, och två byggen stannade med HALT (Dev Notes → ”Correct-course 2026-10-14, andra gången”). Kl. 22:39 samma dag mergades 1.14 efter bygge #9210, och byggjournalen finns (Dev Notes → ”Läget i dag”). Förutsättningen före Task 1 prövar ändå två saker innan något skrivs: att 1.14 är mergad, belagt med byggjournalen, och att kopian inte bär rester av ett tidigare bygge av den här berättelsen. Ett
```

## Utfall
Tester: 159 passed (159) · Granskning: GODKANT | Alla 15 kriterier finns i koden och prövas av fall som ingår i kedjans körning (159/159), och granskningen gav inga fynd på någon nivå; berättelsen har inget avsnitt «Review Follow-ups (AI)» · Byggforsok: 2

## Modellkedja (Davids krav 17/8, reservvag 7/9)

* krav: kordes inte
* utveckling: **claude-opus-5-5**
* granskning: **claude-opus-5-5 (Codex spärrat — Davids regel 12/10; Codex granskar i efterhand)**

Granskaren ar inte forfattaren: claude-opus-5-5 (Codex spärrat — Davids regel 12/10; Codex granskar i efterhand) granskade claude-opus-5-5s arbete.

Allt pa Davids abonnemang - inga API-tokens.
