# Bygge beslut #188 — Uppdragsytan S10.9: Påbörja och Godkänn på leverabelkortet (Leveranserna) — två POST-rutter och knap

Datum: 2026-09-28 11:02 · Branch: cto/uppdragsytan-s10-9-p-b-rja-och-godk-nn-p-188 · Overlamning: #300

## Mal
Uppdragsytan S10.9: Påbörja och Godkänn på leverabelkortet (Leveranserna) — två POST-rutter och knappar i vyn, så att NVR:s tolv leverabler kan få sin verkliga status (LOC-419)

## Kravspec (claude-fable-5) — sjalvbarande, med KALLA och ARKITEKTUR
```
Underlaget är verifierat mot dagens kod: mönsterrutten `statusforslag` ligger nu på routes.ts:1761 (inte 1637 som i storyn), `leverabelkort` på 4443, åtgärderna på registry.ts:1903/1929, och två saker i storyn har hunnit bli sanna/falska — statusklartexten finns redan via `statusChip`, medan befintligt testfall "(d) sidan skriver ingenting" och sidtexten "Statusen flyttas aldrig på den här sidan" (routes.ts:4554) står i direkt konflikt med bygget och måste justeras. Här är kravspecen:

---

MAL | Leveranserna får handgreppen Påbörja och Godkänn så att David själv kan sätta NVR:s tolv leverablers verkliga status (LOC-419) — S3.4 (beslut #143) byggde åtgärderna men båda bär kravManniska, så utan knappar i vyn kan ingen människa använda dem.
KALLA | Överlämning #300 (beslut #188, Davids ja 28/9) + styrande story: överlämning #144 (vd→sidoprojektet 7/9, VAD SOM BYGGS 1–6 och UTANFÖR); alla radreferenser nedan verifierade mot koden 28/9.
ARKITEKTUR | Ett flöde, tre ingångar: vyn muterar endast via runViewAction (routes.ts:692) → executeAction med actor human; mönstret är statusforslag-rutten (routes.ts:1761): assertSameOrigin, parseCompanyId/parseApprovalId, fel tillbaka som ?fel= och visade av felNotis (routes.ts:743); JS-fri serverrenderad HTML, zod-strict-scheman i registret återanvänds orörda.
KRAV-1 | Ny rutt POST /c/:companyId/projects/:projectId/leverabel/paborja i vyroutern: läser contract_id, leverabel_kod, valfri nar, valfri notering ur formuläret och kör paborja_leverabel via runViewAction; tomma valfria fält utelämnas ur input — ett tomt formulärfält är inte ett värde.
KRAV-2 | Ny rutt POST .../leverabel/godkann: contract_id, leverabel_kod, kanal, valfri nar, valfri notering; kör godkann_leverabel via runViewAction; samma utelämnanderegel.
KRAV-3 | Tillbakaväg för båda rutterna är uppdragets förstasida /app/c/:companyId/projects/:projectId (samma som statusforslag) — den sidan bär redan felNotis; Leveranserna saknar felNotis och får ingen.
KRAV-4 | Knapparna bor på leverabelkortet i brädan (leverabelkort routes.ts:4443; contractId finns i bradkolumn routes.ts:4454 och skickas ned): status ej_paborjad → formulär Påbörja med dolda contract_id+leverabel_kod, valfritt input type=date name=nar och valfri notering; levererad → formulär Godkänn med samma dolda fält plus select name=kanal med värdena telefon/mejl/mote/protokoll (GODKANNANDEKANALER, uppdragStatus.ts:201) och etiketterna Telefon/Mejl/Möte/Protokoll, valfritt datum, valfri notering; pagar/godkand/avvisad → ingen knapp (en knapp som ger 409 är en knapp som ljuger).
KRAV-5 | Status i klartext på kortet finns redan: statusChip (html.ts:212) bär ord+glyf+färg för alla fem lägena — behålls, byggs inte om.
KRAV-6 | Sidtexten routes.ts:4554 ("Statusen flyttas aldrig på den här sidan …") justeras så den inte ljuger: Påbörja och Godkänn görs numera här, medan pagar→levererad fortsatt bekräftas bland statusförslagen på förstasidan.
KRAV-7 | Ingen ny felhantering eller egen feltext: zod-avvisning → FORM_FEL, tjänstens saknad_mottagare, leverabel_ej_ej_paborjad, leverabel_ej_levererad, framtida_datum, fore_avtalet (uppdragStatus.ts) kommer som ?fel= och visas av befintlig felNotis.
KRAV-8 | Vitest i server/test/uppdragsytan-leveranserna.test.ts utökas med: (a) leverabel i ej_paborjad renderar Påbörja-formuläret och INTE Godkänn; (b) i levererad renderas Godkänn med de fyra kanalvalen och INTE Påbörja; (c) i godkand renderas ingen knapp; (d) POST paborja med giltiga fält flyttar statusen och omdirigerar till uppdragssidan; (e) POST godkann utan kanal avvisas av åtgärdens schema och kommer tillbaka som ?fel=.
KRAV-9 | Befintligt fall "(d) sidan skriver ingenting" (test-filen rad 318) justeras — fortfarande inget skript och inget draggable, men formulär/knapp-förbudet ersätts av att exakt rätt knapp finns per status; resten av sviten hålls grön oförändrad.
KRAV-10 | docs/STATUS.md får en rad i sessionsloggen; docs/MCP_ACTIONS.md rörs inte (åtgärderna står där sedan S3.4).
ACCEPTANS | npm run build och npm test gröna med inklistrad riktig utdata (hela sviten, inte bara nya fallen); diffen rör endast server/src/http/view/routes.ts, server/test/uppdragsytan-leveranserna.test.ts och docs/STATUS.md; granskaren ser att båda rutterna går genom runViewAction (ingen egen SQL, ingen förbigång av executeAction) och att övriga statusar inte fått någon knapp.
AVGRANSNING | Åtgärderna, tjänsten och schemat från S3.4 rörs inte (registry.ts:1903–1952, uppdragStatus.ts, migration 0072); ingen JS, inga nya CSS-klasser, inga emoji, inga nya beroenden; tabelläget får inga knappar; statusarna sätter David själv i vyn — en agent sätter aldrig en leverabels status (kravManniska står orörd).
uteslutet: knapp för bekrafta_statusbyte på Leveranserna — källan kräver det inte
uteslutet: knappar i tabelläget — källan kräver det inte
uteslutet: massåtgärd över flera leverabler — källan kräver det inte
uteslutet: felNotis eller klarNotis på Leveranserna-sidan — källan kräver det inte
uteslutet: bekräftelsenotis efter lyckad POST — källan kräver det inte
uteslutet: ny vy eller egen sida för handgreppen — källan kräver det inte
```

## Utfall
Tester: 142 passed (142) · Granskning: GODKANT | Alla tio krav uppfyllda och verifierade mot omgivande kod: båda rutterna följer `statusforslag`-mönstret exakt (assertSameOrigin → parseCompanyId/parseApprovalId → runViewAction med actor hu · Byggforsok: 1

## Modellkedja (Davids krav 17/8, reservvag 7/9)

* krav: **claude-fable-5**
* utveckling: **claude-opus-5**
* granskning: **claude-fable-5**

Granskaren ar inte forfattaren: claude-fable-5 granskade claude-opus-5s arbete.

Allt pa Davids abonnemang - inga API-tokens.
