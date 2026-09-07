# Bygge beslut #140 — En sektion "## Uppdragsytan (modul)" införs ordagrant i docs/ARKITEKTUR.md mellan Arkitekturmonster 

Datum: 2026-09-07 05:03 · Branch: cto/en-sektion-uppdragsytan-modul-inf-rs-ord-140 · Overlamning: #140

## Mal
En sektion "## Uppdragsytan (modul)" införs ordagrant i docs/ARKITEKTUR.md mellan Arkitekturmonster och Granser, plus rättning av migrationsraden till 0001–0071 och en STATUS-rad — ingen kod.

## Kravspec (claude-fable-5) — sjalvbarande, med KALLA och ARKITEKTUR
```
Allt är verifierat mot koden: de tolv åtgärdsnamnen finns i `registry.ts` (rad 1497–1887), de sju `uppdrag_*`-tabellerna i `0068_uppdragsytan.sql`, kravManniska-spärren i `execute.ts:56` med felkoden `human_required`, migrationskedjan går 0001–0071, och ARKITEKTUR.md säger idag felaktigt "0001–0059" och nämner inte modulen. Den fullständiga ordagranna sektionstexten (promptens version var avhuggen) finns i `docs/inkorg/140-vd-till-sidoprojektet-uppdragsytan-s11-2-våg-9-modulsektionen-i-arkitekt.md`, rad 14–18. Beslutets nummer i kön är #140.

Här är kravspecen:

```
MAL | docs/ARKITEKTUR.md (lagen) beskriver uppdragsytemodulen — namnrymd, ägandegräns, svepets hemvist — och påstår inget falskt om migrationskedjan, så att kommande sessioner bygger mot ett styrande dokument som stämmer med driftsatt kod.
KALLA | Överlämning #140 (docs/inkorg/140-vd-till-sidoprojektet-uppdragsytan-s11-2-våg-9-modulsektionen-i-arkitekt.md) + Davids ja 2026-09-07; story S11.2 ur 1F, ADR-2/3/4/9; sakpåståenden verifierade 7/9 mot registry.ts, execute.ts:56, migrationerna 0068–0071.
ARKITEKTUR | Andringsregeln: arkitekturändring beslutas av David i beslutskön, aldrig implicit i ett bygge — beslut #140 ÄR den mekanismen. Dokumentets egen röst (utan å/ä/ö, styrande, inga värdeord). Inga nya mönster: bygget är enbart dokumentation.
KRAV-1 | docs/ARKITEKTUR.md får en ny sektion "## Uppdragsytan (modul)" placerad mellan "## Arkitekturmonster" och "## Granser", med överlämningens tre stycken ORDAGRANT (docs/inkorg/140-…, punkt 1, rad 14–18), där #BESLUT ersätts med 140.
KRAV-2 | I punkten Migrationer under Arkitekturmonster ändras "just nu 0001–0059" till "just nu 0001–0071". Ingen annan text i dokumentet ändras.
KRAV-3 | docs/STATUS.md får en sessionsloggrad: uppdragsytan S11.2, våg 9 — modulsektionen i ARKITEKTUR.md införd genom beslut #140.
KRAV-4 | Inbyggd kontroll körs och resultatet klistras in i byggjournalen: alla tolv åtgärdsnamn i sektionen finns i registry.ts; alla sju tabellnamn finns i 0068_uppdragsytan.sql; den nya/ändrade texten innehåller inte å, ä eller ö; npm test och npm run build gröna (noll kodfiler rörs — sviten ska vara oförändrat grön).
ACCEPTANS | Diffen rör exakt två filer (docs/ARKITEKTUR.md, docs/STATUS.md) plus byggjournal; sektionstexten är teckenidentisk med överlämningens med #140 insatt och står mellan Arkitekturmonster och Granser; grep på å/ä/ö i ARKITEKTUR.md ger noll träffar; KRAV-4:s utdata finns inklistrad i journalen.
AVGRANSNING | Ingen kod, ingen migration, inga tester, inga nya åtgärder eller beroenden. Granser, Andringsregel och alla övriga sektioner står ordagrant kvar — ingen omformulering eller extra arkitekturtext "medan man ändå är där".
uteslutet: uppdatering av docs/MCP_ACTIONS.md — kallan kraver det inte
uteslutet: andring av CLAUDE.md — kallan kraver det inte
uteslutet: for- och nackdelsanalys eller alternativ fore bygget — kallan kraver det inte
uteslutet: auditrad eller ny atgard for dokumentandringen — kallan kraver det inte
```

En sak att känna till för granskaren: sektionstexten listar `set_project_status` bland kravManniska-åtgärderna fast den inte är en `uppdrag_*`-åtgärd — det stämmer med koden (registry.ts:1241, en befintlig åtgärd som modulen återanvänder), så det är avsiktligt, inte ett fel att "rätta" vid bygget.
```

## Utfall
Tester: 134 passed (134) · Granskning: GODKANT | Sektionen ar teckenidentisk med overlamningens tre stycken med #140 insatt och star mellan Arkitekturmonster och Granser, migrationsraden ar rattad till 0001–0071 (verifierat: 71 filer) utan · Byggforsok: 1

## Modellkedja (Davids krav 17/8)
Krav+granskning: claude-fable-5 · Utveckling: claude-opus-5 · Claude Code pa Davids abonnemang — inga API-tokens
