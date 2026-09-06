# Bygge beslut #133 — En JS-fri läsyta "Kontraktet" per uppdrag som visar avtalets livscykel (väg till dokumentet, gälland

Datum: 2026-09-06 23:39 · Branch: cto/en-js-fri-l-syta-kontraktet-per-uppdrag-133 · Overlamning: #133

## Mal
En JS-fri läsyta "Kontraktet" per uppdrag som visar avtalets livscykel (väg till dokumentet, gällande version, tillägg med orsak ur avtalsdelsversionerna, scopelinjen som fraser) plus read-åtgärden `las_kontraktsyta` som bara delegerar till befintliga `list_contracts`/`get_document`.

## Kravspec (claude-fable-5) — sjalvbarande, med KALLA och ARKITEKTUR
```
Kravspecen är klar. Jag har grävt i huset (planen-mönstret `routes.ts:3059`, `listContracts`/`Takversion` i `services/contracts.ts`, 0068:s `uppdrag_scopelinje`/`uppdrag_referens`/`kontrakt_tillstand`, `las_leverabelregister`-mönstret i `registry.ts`) och i 1E Del 4/5 samt PRD FR-38. Två fynd styr kraven: `listContracts` returnerar i dag varken `kontrakt_tillstand` eller versionernas `change_reason` — båda behövs för storyn och läggs till additivt; och Davids analysregel (3) ger husets ruttmönster `/projects/:id/kontraktet`, inte 1E:s `/uppdrag/:kod`.

MAL | En JS-fri läsyta "Kontraktet" per uppdrag plus read-åtgärden `las_kontraktsyta`, så att avtalets livscykel — var dokumentet är, vad som gäller nu, vilka tillägg som gjorts och varför, vad som ingår (scopelinjen) — kan läsas ur EN definition (REST, vy, MCP; FR-23) utan att någon fjärde datamängd skapas: ytan är vägen till dokumentet och registret över läget, aldrig en kopia av innehållet.
KALLA | Överlämning #133 (story S10.6 ur 1F, våg 5), 1E Del 4 (raden `las_kontraktsyta` · read · delegerar till `list_contracts`/`get_document`) och Del 5, PRD FR-6/FR-38 med acceptans (referens aldrig kopia, ingen fjärde ägd datamängd, NFR-6/NFR-12), Davids ja 6/9 med analysregel (3): husets ruttmönster gäller tills S10.7 bygger menyn; beroendet S5.2 är mergat (beslut #127).
ARKITEKTUR | Ett flöde, tre ingångar: `def()` i `registry.ts` med `.strict()`-zod (`UuidSchema`), handlern anropar en tjänstefunktion — ingen SQL i registret; tjänsten tar `client + companyId` under `withTenantTransaction` (RLS); vyn följer planen-mönstret (S10.2, routes.ts:3059): `page()` + `withTenantTransaction` + `layout`, knapp i uppdragssidans knappband (routes.ts:1692); delegering till BEFINTLIGA `listContracts`, `listaReferenser`, läsning av redan lagrad `uppdrag_scopelinje`; vitest mot riktig Postgres.
KRAV-1 | `registry.ts` får `las_kontraktsyta`: `sensitivity: 'read'`, ingen `kravManniska`, `inputSchema: z.object({ contract_id: UuidSchema }).strict()`, handlern anropar endast tjänstefunktionen; dokumenteras som read utan handgrepp (1E Del 4).
KRAV-2 | Ny tjänstefunktion `lasKontraktsyta(client, companyId, { contract_id })` i ny fil `server/src/services/uppdragKontrakt.ts` som komponerar befintlig data: avtalet ur `listContracts({ contract_id })` (tomt → `NotFoundError('contract')` = 404, husets mönster), dokumentpekarna ur `contracts.source_file_id` och `listaReferenser` (sort `drive`), scopelinjen ur `uppdrag_scopelinje` (sort/text/klausul i `ordning`); svaret bär ENDAST id-referenser till dokument — aldrig innehåll (`getDocument`:s `includeContent` används aldrig; behöver anroparen handlingen finns befintliga `get_document`).
KRAV-3 | `services/contracts.ts` utökas ADDITIVT: `c.kontrakt_tillstand` läggs i `AVTAL_KOLUMNER` och `change_reason` i `Takversion`/versionsfrågan; inga befintliga fält ändras eller byter namn (ingen migration — kolumnerna finns i 0064/0068).
KRAV-4 | Vyn `GET /app/c/:companyId/projects/:projectId/kontraktet` renderar per avtal på projektet: tillståndschip (Utkast/Fryst) + `signed_date`, väg till dokumentet som länkar (drive-referensens `extern_id` med `titel_vid_lankning`, samt `source_file_id`), gällande version per delkod (samma gällande-regel som taket: `Delforbrukning.part_id`), tilläggen (versioner utöver den första per kod) med `valid_from` och orsaken `change_reason`, scopelinjen grupperad innanför/utanför/signalfraser med klausul; knappen "Kontraktet" läggs i uppdragssidans knappband efter Planen.
KRAV-5 | Ett avtal i `kontrakt_tillstand='utkast'` renderas SOM utkast, aldrig som gällande; utkastets obesvarade frågor hänvisas som referens till dokumentet (länk/pekare), aldrig som återgiven dokumenttext (NFR-12).
KRAV-6 | Ytan är JS-fri serverrenderad HTML med husets befintliga komponenter och tomlägen (inget avtal → `empty` med länk till "Läs in avtal"); rendering gör inga anrop till Drive eller andra externa system (NFR-6) — bara redan lagrad data.
KRAV-7 | Vitest i `server/test/`: (a) `las_kontraktsyta` svarar för eget bolag och ger 404 för ett grannbolags `contract_id` (tenant-isolering genom stacken); (b) ett tillägg (andra versionen av en kod) bär sin `change_reason` i svaret; (c) kopietestet FÄLLER en kopia: åtgärdssvaret och vyns HTML innehåller aldrig dokumentinnehåll (`content_base64`/kontraktstext) — endast referenser; (d) vyn ger 200 med utkastmarkering för ett utkast och med scopelinjens fraser för ett fryst avtal.
KRAV-8 | `docs/MCP_ACTIONS.md` får raden `las_kontraktsyta` under `## Uppdragsytan`; `docs/STATUS.md` får en sessionsloggrad — båda i samma commit som koden.
ACCEPTANS | `npm test` och `npm run build` gröna med inklistrad utdata; diffen innehåller INGEN migration och inget nytt beroende; åtgärden står i registret som `read` utan `kravManniska`; vyn nås på husets ruttmönster och renderar utan `<script>` och utan externa anrop; kopietestet (KRAV-7c) visas fälla om dokumentinnehåll smygs in i svaret.
AVGRANSNING | Rör ENDAST `registry.ts`, ny `services/uppdragKontrakt.ts`, additiva rader i `services/contracts.ts`, `http/view/routes.ts`, `server/test/`, `MCP_ACTIONS.md`, `STATUS.md`; inga schemaändringar, inga nya beroenden, inga nya felkoder eller errorHandler-ändringar, ingen sensitivity-ändring på någon befintlig åtgärd, ingen skrivväg — ytan och åtgärden läser bara.
uteslutet: `.subnav` och rutten `/uppdrag/:kod/kontraktet` (S10.7 bygger menyn; Davids svar regel 3 ger husets knappband) — kallan kraver det inte
uteslutet: rendering av utkastets frågetexter ur dokumentet — kallan kraver det inte
uteslutet: leveranskartan och rytmen på ytan (FR-38:s fulla NVR-001-acceptans bärs av redan byggda S3.1 och senare stories) — kallan kraver det inte
uteslutet: ny tabell, cache eller svepvärde för kontraktsversioner eller dokumentkopior — kallan kraver det inte
uteslutet: Drive-verifiering eller färskhetskontroll vid rendering (svepet S7.4 äger den) — kallan kraver det inte
uteslutet: auditrad för läsåtgärden (read auditloggas inte i huset) — kallan kraver det inte
uteslutet: `include_content`-flagga på `las_kontraktsyta` — kallan kraver det inte

En anmärkning utanför specen: 1E:s delegeringsrad nämner `get_document`, men `documents.entity_type` saknar i dag `'contract'` och NVR-001:s kontrakt importerades som text — så det finns ingen dokumentpost att hämta. Specen löser det som källan kräver: svaret bär referenser (`source_file_id`, drive-`extern_id`), och `get_document` förblir den befintliga vägen för den som vill ha en handling — ingen ny mekanik byggs.
```

## Utfall
Tester: 129 passed (129) · Granskning: GODKANT | Alla åtta krav är uppfyllda inom avgränsningen (endast tillåtna filer, ingen migration, inga nya beroenden, additiva contracts-rader, husets vy- och registermönster med `.strict()`/`UuidSche · Byggforsok: 2

## Modellkedja (Davids krav 17/8)
Krav+granskning: claude-fable-5 · Utveckling: claude-opus-5 · Claude Code pa Davids abonnemang — inga API-tokens
