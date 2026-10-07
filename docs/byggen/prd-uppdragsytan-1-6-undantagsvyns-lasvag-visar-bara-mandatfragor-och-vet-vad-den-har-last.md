# PRD-bygget uppdragsytan 1-6-undantagsvyns-lasvag-visar-bara-mandatfragor-och-vet-vad-den-har-last — PRD uppdragsytan 1-6-undantagsvyns-lasvag-visar-bara-mandatfragor-och-vet-vad-den-har-last: # Story 

Datum: 2026-10-07 14:43 · Branch: cto/prd-uppdragsytan-1-6-undantagsvyns-lasvag-visar-bara-mandatf-9168 · Kalla: 02-Områden/hermes/uppdragsytan-1c-prd.md (fryst 29/9, Davids beslut #194)

## Mal
PRD uppdragsytan 1-6-undantagsvyns-lasvag-visar-bara-mandatfragor-och-vet-vad-den-har-last: # Story 1.6: Undantagsvyns läsväg visar bara mandatfrågor och vet vad den har läst Status: ready-for-dev <!-- Note: Vali

## PRD-kravet (ordagrant ur den frysta PRD:n) och astras kodgranskning
```
# Story 1.6: Undantagsvyns läsväg visar bara mandatfrågor och vet vad den har läst

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

<!-- Kodbas: redovisning. Epic 1 (Undantagsvyn). Beror på: Story 1.4 (done). Byggvillkoren K-8 (1.1) och KRAV-13 (1.2) står i done. Våg 5 i parallelization-analysis.md (rad 370–376) tillsammans med Hermes-berättelserna 10.3 och 11.3. Berättelsen behöver ingen migration, och inget nummer är reserverat för den (regel 5, rad 654–655). -->
<!-- Story key: 1-6-undantagsvyns-lasvag-visar-bara-mandatfragor-och-vet-vad-den-har-last · Story ID: 1.6 · Skapad 2026-10-07 med BMAD create-story i autonomt läge (YOLO). -->

## Story

As a David,
I want att en enda läsväg samlar det som kräver mitt mandat över uppdragen och vet vilket underlag den faktiskt läst,
so that jag aldrig får rutin- eller driftfrågor och aldrig ett falskt besked om att inget väntar.

**Krav:** FR-40, FR-22, FR-4 (beloppsregelns acceptansprov), FR-7 (oavgjord signal som post), FR-8 (avslutsförslag som post), FR-13 och FR-14 (frånvaroprovet), FR-23, FR-35, NFR-3, NFR-4 och NFR-6, ur `epics.md` rad 690–773. Arkitekturens grund är B-3 (`architecture.md` rad 446–505), B-12 (rad 518–526), cachestrategin (rad 377) och svepkontraktet (rad 929–933). Genomförandeordningen har berättelsen som punkt 4 (rad 751).

**Läget i dag, i en mening.** Ingen läsväg samlar mandatfrågorna. Läget filtrerar kön med `listApprovals`, som kapar vid 200 poster, och ingenting i koden vet om svepet faktiskt läst de mandatbärande källorna. Kodgranskningen ger FR-40 FÖLJER INTE och FR-22 DELVIS (`underlag/kodgranskning.md` rad 39 och 57).

**Vad berättelsen gör.**
1. **`Lasvarde<T>`** i den nya filen `server/src/lib/lasvarde.ts`. Varje läst värde bär `varde`, `kalla`, `last_nar` och `lage` (`last` | `olast` | `saknas`).
2. **En ny funktion i `server/src/services/approvals.ts`**, `listaVantandeKoposter(client, companyId, atgarder)`. Den läser väntande köposter för en åtgärdslista utan `LIMIT`, i ordningen `created_at, id`. `listApprovals` rörs inte.
3. **Den nya tjänsten `server/src/services/uppdragUndantag.ts`.** Den bär den stängda listan `POSTSLAG`, en ren beskrivningsfunktion per slag, täckningsreglerna och `lasUndantag(client, companyId)`. Läsvägen ger ett av utfallen `poster`, `verifierat_tomt` eller `ofullstandigt`.
4. **Read-åtgärden `las_undantag`** i registret. REST och MCP läser samma svar, och vyn i Story 1.11 anropar samma funktion.
5. **Svepet skriver täckning.** `kor_uppdragssvep` får ett sista steg som skriver cachenyckeln `tackning` i `uppdrag_svepvarde` för varje öppet avtal i bolaget, med de fyra mandatkällorna. Svaret får fältet `tackning`. `upsertSvepvarden` får ett omfång, så att uppdragsstegen och täckningssteget aldrig raderar varandras nycklar.

**Vad berättelsen inte gör:**
- **Ingen vy, ingen rutt och ingen menypost.** Undantagsvyn, rutten `/app/c/:companyId/uppdrag` och formulären hör till Story 1.11.
- **Inga fler postslag.** `ny_bedomning` kommer i Story 1.10 och `ovrigt_beslut` i Story 1.14. Scopeavgörandets historiktabell kommer i Story 1.9. Här läses en oavgjord signal som `avgjord IS NULL`, precis som i dag.
- **Ingen `uppdrag_beslut`, ingen `MANDATATGARDER` och ingen `tvafas` på någon produktionsåtgärd.** Det är Story 1.7. Där får också `ovrigt`-täckningen sin gren för beslutsrader. Där härleds också `MANDATATGARDER` och `UNDANTAG_ATGARDER` ur varandra, eller så prövas de lika, så att de två listorna aldrig glider isär.
- **Ingen ändring av Läget, pengaytan eller Att göra.** `uppdragLage.ts` behåller `listApprovals` tills Story 6.2 flyttar Lägets mandatfrågor till den här läsvägen. Övriga läsvägar får `Lasvarde` i Story 6.1.
- **Inget driftprov och ingen ändring under `hermes/`.** `uppdragstackning.py` byggs i Story 1.13.
- **Ingen migration, ingen ny tabell och ingen ny kö.**

**Bygge och grind.** Byggkedjan bygger berättelsen i en kopia, en gren i redovisningens repo, och driftsätter först efter godkänd code-review (Dev Notes → ”Byggkedjan”). Varje uppgift och varje acceptanskriterium prövas i kopian, före driftsättningen, med provet `server/test/uppdragsytan-undantag.test.ts` och de befintliga sviter som Task 7 räknar upp.

## Acceptance Criteria

Kriterierna 1–15 är ordagranna ur `epics.md` (Story 1.6, rad 702–773). Raderna under *Mätbart* anger hur kriteriet prövas i den här kodbasen och lägger inte till några krav. Två slags rader förekommer:
- **Mekanism:** det som gör ett ”aldrig”, ett ”alla” eller ett ”varje” sant genom konstruktion, alltså en enda väg in, en tillåtelselista eller ett fält som aldrig förs vidare.
- **Fallista:** den ändliga lista som provet prövar.

Allt prövas i kopian. P-numren står i Dev Notes → ”Prov och verifiering”.

1. **`Lasvarde` finns på ett ställe och bär varje läst värde.**
   **Given** `lib/lasvarde.ts`
   **When** typen `Lasvarde<T> = { varde, kalla, last_nar, lage: 'last' | 'olast' | 'saknas' }` definieras
   **Then** finns den på ett enda ställe och används av läsvägen för varje visat värde, också täckningens färskhet.
   - *Mätbart:* filen `server/src/lib/lasvarde.ts` exporterar typen, konstanten `KALLA_REDOVISNING = 'redovisning'` och tre rena hjälpare (Dev Notes → ”`lib/lasvarde.ts`”). Den importerar ingenting.
   - *Mekanism:* typen deklareras bara i `lib/lasvarde.ts`. Svarstyperna `Undantagspost` och `Tackningspost` i `uppdragUndantag.ts` deklarerar sina lästa fält som `Lasvarde<…>`, så `tsc` fäller ett läst fält utan källa och lästid. De lästa fälten är en ändlig lista: `uppdrag`, `forslag`, `skal` och `kallor` i varje post och `tackning` i varje täckningspost. Två slags fält är inga lästa värden, och FR-35 gäller läst värde:
     - postslagets fasta texter (`val`, `varfor_mandat`, `ja_registrerar`), som är etiketter som hör till slaget;
     - identitetsfälten, som namnger posten eller avtalet: `id`, `identitet`, `atgard`, `foreslagen_av` och `skapad_nar` i posten, och `contract_id`, `contract_name`, `project_id`, `project_name` och `kalla` i täckningsposten.
   - *Fallista (P2):*
     - **(a)** En sökning i `server/src` efter deklarationerna `type Lasvarde` och `interface Lasvarde` träffar exakt en fil, `lib/lasvarde.ts`.
     - **(b)** Ett `las_undantag`-svar har minst en post av varje slag och minst en täckningspost i vart och ett av lägena `last`, `olast` och `saknas` (uppställningen står i Dev Notes → ”Provets form”). I svaret är de fem lästa fälten ett objekt med exakt nycklarna `varde`, `kalla`, `last_nar` och `lage`, och `lage` är ett av de tre värdena.
     - **(c)** Ett fält i läget `olast` eller `saknas` har `varde: null`.
     - **(d)** Inget fält i läget `last` har `varde` lika med `''` eller `[]`.

2. **En läsväg, tre ingångar.**
   **Given** `services/uppdragUndantag.ts` med `lasUndantag(client, companyId)`
   **When** läsvägen exponeras som read-åtgärden `las_undantag`
   **Then** ger REST, MCP och vyn samma svar ur samma funktion, utan egen SQL i någon route.
   - *Mekanism:* registret får exakt `def({ name: 'las_undantag', sensitivity: 'read', inputSchema: z.object({}).strict(), handler: (ctx) => lasUndantag(ctx.client, ctx.companyId) })`. Ingen `kravManniska`, eftersom MCP och Hermes kontrollyteprov (Story 1.12) läser med agentnyckel. REST och MCP går genom `executeAction`. MCP-servern är en ren klient av REST-rutten (`server/src/mcp/server.ts` rad 179–200). Vyn i Story 1.11 anropar `lasUndantag` i `withTenantTransaction`, på samma sätt som Läget anropar `lasUppdragslage` (`server/src/http/view/routes.ts` rad 4210–4212). Ingen route i berättelsen skriver SQL för undantagen.
   - *Fallista (P3):*
     - **(a)** Definitionen i `ACTIONS` har `sensitivity: 'read'` och saknar `kravManniska`.
     - **(b)** `actionManifest()` har posten med `requires_approval: false`.
     - **(c)** `POST …/actions/las_undantag` med `{ "extra": 1 }` ger 400 `validation_error`.
     - **(d)** Samma bolag läses på tre vägar: REST med människ
```

## Utfall
Tester: 147 passed (147) · Granskning: GODKANT | Alla 15 acceptanskriterier är implementerade, förra varvets fem fynd är åtgärdade och inga nya fynd kvarstår; kedjans testutfall är 147 passed. · Byggforsok: 2

## Modellkedja (Davids krav 17/8, reservvag 7/9)

* krav: kordes inte
* utveckling: **gpt-6.1-sol**
* granskning: **gpt-6-astra**

Granskaren ar inte forfattaren: gpt-6-astra granskade gpt-6.1-sols arbete.

Allt pa Davids abonnemang - inga API-tokens.
