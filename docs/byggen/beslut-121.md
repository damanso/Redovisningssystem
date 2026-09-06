# Bygge beslut #121 — En läsåtgärd `las_leverabelregister` som per kontrakt returnerar registrets rader med klausul, accep

Datum: 2026-09-06 15:33 · Branch: cto/en-l-s-tg-rd-las-leverabelregister-som-p-121 · Overlamning: #121

## Mal
En läsåtgärd `las_leverabelregister` som per kontrakt returnerar registrets rader med klausul, acceptanskriterium, uppföljningsmått och läsväg (fyllnaden finns redan i S1.2:s `uppdragImport.ts`), plus täckningsprovet för FR-19 som vitest.

## Kravspec (claude-fable-5) — sjalvbarande, med KALLA och ARKITEKTUR
```
Underlaget är verifierat mot koden: skrivvägen finns i `uppdragImport.ts:333-347` (steg e), schemat i `0068:109-127` med CHECK som tillåter `matt_lasvag IS NULL` (rad 119) och `uppdrag_leverabel_kod_uk UNIQUE (contract_id, kod)` (rad 124), 1E Del 4 listar `las_leverabelregister` som `read` utan kravManniska, och testfixturen `LEVERANSKONTRAKT_NVR001` saknar med flit läsväg på L6 — det bär den negativa kontrollen. Här är kravspecen:

---

MAL | Åtgärden `las_leverabelregister` som per kontrakt returnerar leverabelregistrets rader med klausul, acceptanskriterium, uppföljningsmått och läsväg, plus täckningsprovet för FR-19 som vitest — så att registret (fyllt av S1.2:s import) går att läsa via alla tre ingångar och ett mått utan läsväg aldrig kan passera tyst.
KALLA | Överlämning #121 (story S3.1 ur 1F, våg 3), CTO-underlaget med Davids ja 2026-09-06, Davids analysregler 6/9 (svar 1: enbart action-lagret, inget utöver), 1E Del 4 (åtgärdstabellen: `read`, ingen kravManniska), PRD FR-9/FR-19, schema `0068_uppdragsytan.sql:109-127`.
ARKITEKTUR | Ett flöde, tre ingångar: `def({...})` i `ACTIONS` (registry.ts) → tjänst i `server/src/services/` → Postgres under `withTenantTransaction`; zod-strict ur `lib/validation.ts` (`UuidSchema`); `company_id` ur medlemskapet, aldrig ur body; `NotFoundError('contract')` som i `hamtaAvtal` (uppdragImport.ts:45-56); vitest mot riktig Postgres via `test/env.ts`. Inga nya mönster, beroenden eller felkoder.
KRAV-1 | Ny fil `server/src/services/uppdragRegister.ts` med `lasLeverabelregister(client, companyId, { contract_id })`: SELECT ur `uppdrag_leverabel` filtrerad på `company_id` + `contract_id`, sorterad på `kod`; varje rad bär `kod`, `klausul`, `acceptanskriterium`, `uppfoljningsmatt`, `matt_lasvag`, `status`. Radidentiteten i svaret är `(contract_id, kod)` — aldrig `contract_part_id`.
KRAV-2 | Kontrakt som inte finns eller tillhör annat bolag → `NotFoundError('contract')` (404); befintligt kontrakt utan registerrader → tom lista (200), inte fel.
KRAV-3 | Registrering i `actions/registry.ts` under Uppdragsytan-kommentaren: `name: 'las_leverabelregister'`, `sensitivity: 'read'`, ingen `kravManniska`, `inputSchema: z.object({ contract_id: UuidSchema }).strict()`; handlern anropar tjänsten — ingen SQL i registret.
KRAV-4 | Täckningsprovet FR-19 som vitest i `server/test/` (mönster `uppdragsytan-import.test.ts`, riktig Postgres): negativ kontroll — efter import av fixturen `LEVERANSKONTRAKT_NVR001` (L6 saknar läsväg med flit) ska en täckningskontroll över åtgärdens svar fälla exakt L6 med `matt_lasvag` null; schemat bär inte täckningen (CHECK 0068:119 tillåter NULL), provet gör det.
KRAV-5 | Positiv kontroll i samma prov: ett andra kontrakt vars kontraktstext ger ALLA mått läsväg importeras, och täckningskontrollen över åtgärdens svar finner noll saknade.
KRAV-6 | Provet verifierar också att raderna bär dom fyra kontraktsburna fälten ur fixturen (FR-9) och att ett annat bolags användare får 404 på kontraktet (tenant-isolering som beteende, inte implementation).
KRAV-7 | `docs/MCP_ACTIONS.md` får en rad under modulsektionen Uppdragsytan; `docs/STATUS.md` får en sessionsrad. Bägge committas med koden.
ACCEPTANS | `npm test` och `npm run build` gröna med inklistrad, faktisk utdata; det nya provet visar både fällning (negativ) och pass (positiv); `git diff` visar att `server/migrations/`, `uppdragImport.ts`, parsern och alla skrivvägar är orörda; `uppdrag_leverabel_kod_uk` står kvar oförändrad.
AVGRANSNING | Endast: ny tjänstefil, en def-post i `registry.ts`, ett nytt prov i `server/test/`, rader i två docs-filer. Schema 0068 och senare migrationer, skrivvägen (steg e i importen), vylagret, `errorHandler.ts` och sensitivity-tabellen rörs inte.
uteslutet: registervy under modulens `.subnav` — Davids svar på beslutsfrågan: enbart action-lagret tills registervyn får en egen story
uteslutet: skriv-/rättelseväg för `matt_lasvag` på befintliga rader — källan kräver det inte
uteslutet: NOT NULL eller skärpt CHECK på `matt_lasvag` i schemat — Davids regel 5: provet bär kravet, schemat ändras inte
uteslutet: flagg-/sammanfattningsfält i svaret (t.ex. `saknar_lasvag`-lista) — källan kräver bara raderna
uteslutet: `matt_lasvag.py` hos Hermes — överlämningens VILLKOR: .py-proven byggs av sessionen, inte i repot
uteslutet: auditrad för läsningen — read-åtgärder auditloggas inte i huset, källan kräver det inte
uteslutet: statusålder/händelser ur `uppdrag_leverabel_handelse` i svaret (FR-37) — annan story

---

Specen är 20 rader och självbärande: utvecklaren får tabellens kolumner, mönsterfilerna, fixturens roll och gränserna utan att behöva gräva själv. Den negativa kontrollen vilar på att fixturen redan saknar L6:s läsväg, vilket jag verifierade i testfilens huvud, så ingen ny fixtur behövs för fällningen — bara en variant med full täckning för det positiva provet.
```

## Utfall
Tester: 117 passed (117) · Granskning: GODKANT | Bygget håller sig exakt inom avgränsningen (ny tjänst, en def-post, ett prov, två docs-rader; inga beroenden, migrationer eller skrivvägar rörda), följer husets mönster (def→tjänst→Postgres, · Byggforsok: 1

## Modellkedja (Davids krav 17/8)
Krav+granskning: claude-fable-5 · Utveckling: claude-opus-5 · Claude Code pa Davids abonnemang — inga API-tokens
