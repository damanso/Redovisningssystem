# Bygge beslut #136 — En ny undersida "Leveranserna" på uppdraget som visar leverabelregistret i två likvärdiga, JS-fria l

Datum: 2026-09-07 01:49 · Branch: cto/en-ny-undersida-leveranserna-p-uppdraget-136 · Overlamning: #136

## Mal
En ny undersida "Leveranserna" på uppdraget som visar leverabelregistret i två likvärdiga, JS-fria lägen — brädan (kolumner per läge, brädan först) och tabellen som skärmläsarens primärkälla — läst ur befintliga `lasLeverabelregister` (S3.1/S3.3 med `dagar_i_laget` finns redan, åtgärden `las_leverabelregister` finns i registry.ts:1641).

## Kravspec (claude-fable-5) — sjalvbarande, med KALLA och ARKITEKTUR
```
Underlaget är verifierat mot koden: `lasLeverabelregister` (`server/src/services/uppdragRegister.ts:77`) returnerar `kod, klausul, acceptanskriterium, uppfoljningsmatt, matt_lasvag, status, dagar_i_laget`; `statusChip` i html.ts har alla fem leverabellägena med färg+ikon+ord; `UPPDRAGSSIDOR` ligger i routes.ts:3531; ingen `.brada`-klass finns. 1D:s tabellfält Namn/Rev/Mottagare/Överlämnad finns INTE i tjänstesvaret — de utesluts enligt vågkörarens regel 1 (inget utöver överlämningen). Här är kravspecen:

---

**MAL** | Ny undersida "Leveranserna" på uppdraget som visar leverabelregistret i två likvärdiga, JS-fria lägen — brädan (en kolumn per statusläge, default) och tabellen (skärmläsarens och utskriftens primärkälla) — så att David ser vad som ska levereras, var varje leverabel står och hur länge den stått där (S10.3, FR-12/FR-37/FR-39).
**KALLA** | Överlämning #136 (story S10.3 ur 1F, våg 6) + Davids ja 2026-09-07 till CTO-underlaget; PRD FR-12/FR-37/FR-39; 1D Del 4.3; beroendet S3.1/S3.3 byggt (`lasLeverabelregister` med `dagar_i_laget`, åtgärden `las_leverabelregister` i registry.ts:1641).
**ARKITEKTUR** | Vyn är bara transport: läser via tjänstelagret inuti `withTenantTransaction`, ingen SQL eller affärslogik i http-lagret; JS-fri serverrenderad HTML med kanons klasser ur html.ts (`.panel`, `.chip`, `.table-wrap`, `statusChip`, `.subnav`, `layout`/`page`); vitest+supertest mot riktig Postgres genom hela stacken.
**KRAV-1** | `GET /app/c/:companyId/projects/:projectId/leveranserna` finns; posten `['leveranserna', 'Leveranserna']` läggs i `UPPDRAGSSIDOR` (routes.ts:3531) direkt efter `planen` (1D:s ordning Planen→Leveranserna→Kontraktet); subnaven bär `aria-current="page"` på exakt en post.
**KRAV-2** | Sidan läser per avtal i projektet (`listContracts` + `lasLeverabelregister`, samma mönster som kontraktet-sidan) och renderar BÅDA lägena ur exakt samma tjänstesvar per avtal — vyn räknar, filtrerar och härleder ingenting själv.
**KRAV-3** | Lägesväxling via serverlänk med query-parametern `?lage=tabell`; utan parameter eller med okänt värde visas brädan; båda lägena bär en synlig länk till det andra läget; ingen JavaScript i något läge.
**KRAV-4** | Brädan: per avtal en `.panel` per statusläge i FR-12:s fem lägen och ordning (`ej_paborjad`, `pagar`, `levererad`, `godkand`, `avvisad`, etiketter ur `statusChip`); varje leverabel ligger i sin statuskolumn som kort med kod, klausul, statuschip och "N dagar i läget"; en tom kolumn visas ändå.
**KRAV-5** | Tabellen: per avtal en `.table-wrap`-tabell med en rad per leverabel och samtliga fält ur tjänstesvaret (kod, klausul, acceptanskriterium, uppföljningsmått, mätläsväg, status som `statusChip`, dagar i läget); NULL redovisas som saknat värde, aldrig ifyllt med gissning.
**KRAV-6** | Varje läge bär tre bärare för status: färg (`chip--*`), form (ikonen) och ord (etiketten) — allt via befintliga `statusChip`, inga nya etiketter eller färger.
**KRAV-7** | Ingen drag-and-drop och inga skrivvägar: sidan innehåller varken `draggable`-attribut, `<script>` eller formulär/knappar — ren läsvy.
**KRAV-8** | Tomt register för ett avtal ger 1D:s förklaring (registret är tomt eftersom inget kontrakt importerats) — aldrig en tom bräda som ser färdig ut.
**KRAV-9** | Nya vyprov i `server/test/uppdragsytan-leveranserna.test.ts` (mönster: `uppdragsytan-laget.test.ts`) genom hela stacken: båda lägena svarar 200; samma leverabelkoder i båda lägena; tre bärare per läge; frånvaro av `draggable`/`<script>`/formulär; känd `dagar_i_laget`-rendering; användare i annat bolag når inte sidan.
**KRAV-10** | `docs/STATUS.md` får en rad i sessionsloggen; `docs/MCP_ACTIONS.md` rörs inte (ingen ny åtgärd).
**ACCEPTANS** | `npm run build` och `npm test` gröna med faktisk inklistrad utdata; granskaren ser i renderad HTML att båda lägena bygger på samma tjänstesvar med brädan som default och serverlänk som växel, samt att diffen enbart rör `server/src/http/view/routes.ts`, `server/test/` och `docs/STATUS.md`.
**AVGRANSNING** | Ingen migration, ingen ny eller ändrad åtgärd/tjänst (`lasLeverabelregister` och registry.ts rörs inte), ingen ny CSS eller komponentklass, ingen sensitivity-ändring, inga nya beroenden, ingen ändring av övriga poster i `UPPDRAGSSIDOR`.
uteslutet: en enda sida med dold sr-only-tabell bakom brädan — källan kräver det inte
uteslutet: ny `.brada`-klass med kolumnlayout-CSS — källan kräver det inte
uteslutet: kortknappen "Bekräfta byte →" mot statusbytet (1D 4.3, ägs av S3.2) — källan kräver det inte
uteslutet: tabellkolumnerna Namn/Rev/Mottagare/Överlämnad ur 1D, fält som saknas i tjänstesvaret — källan kräver det inte
uteslutet: filtrering, sortering eller paginering i tabelläget — källan kräver det inte
uteslutet: ny MCP-åtgärd eller REST-rutt för vyn — källan kräver det inte

---

Två medvetna val värda att nämna: placeringen efter `planen` följer 1D:s subnav-ordning (Planen → Leveranserna → Kontraktet), och 1D:s extra tabellfält (Namn, Rev, Mottagare, Överlämnad) är uteslutna eftersom de inte finns i `lasLeverabelregister`-svaret och underlaget uttryckligen förbjuder tjänsteändringar — vågkörarens regel 1 säger bygg exakt överlämningen, inte mer.
```

## Utfall
Tester: 131 passed (131) · Granskning: GODKANT | Bygget följer kravspecen exakt — båda lägena renderas ur samma `lasLeverabelregister`-svar via kontraktssidans mönster inuti `withTenantTransaction`, subnavposten står mellan Planen och Kont · Byggforsok: 1

## Modellkedja (Davids krav 17/8)
Krav+granskning: claude-fable-5 · Utveckling: claude-opus-5 · Claude Code pa Davids abonnemang — inga API-tokens
