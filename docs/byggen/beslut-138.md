# Bygge beslut #138 — En ny undersida **Rapporterna** i uppdragets subnav som visar bedömningshistoriken som beständiga, s

Datum: 2026-09-07 03:42 · Branch: cto/en-ny-undersida-rapporterna-i-uppdragets-138 · Overlamning: #138

## Mal
En ny undersida **Rapporterna** i uppdragets subnav som visar bedömningshistoriken som beständiga, skannbara poster (FR-20) där varje post bär sina frysta siffror ur `frysta_siffror`, och där dom tre lägena har identisk friktion (FR-17) — allt läst ur befintlig `uppdrag_bedomning`, ingen ny åtgärd, ingen migration.

## Kravspec (claude-fable-5) — sjalvbarande, med KALLA och ARKITEKTUR
```
Underlaget är på plats: jag har läst ARKITEKTUR.md, S4.2:s bedömningsvy (`bedomningsunderlag`, `frystCell`, `bedomningsformular` i `routes.ts`), subnav-mönstret (`UPPDRAGSSIDOR`), 1E Del 5:s ruttlista (`/rapporterna` mellan pengarna och kontraktet), FR-17/FR-20 i PRD:n samt 1D:s friktionsdefinition (rad 277: samma klick, samma storlek, ingen bekräftelseruta på rött som saknas på grönt). Davids svarsregel 1 avgör analysfrågan: Bedömningssidans historiktabell rörs inte.

Kravspecen:

---

MAL | Undersidan **Rapporterna** (`/app/c/:companyId/projects/:projectId/rapporterna`) i uppdragets subnav visar bedömningshistoriken som beständiga, skannbara poster där varje post bär sina frysta siffror (FR-20) och de tre lägena har identisk friktion (FR-17) — historiken får en egen läsyta enligt 1E Del 5:s ruttlista, vilket låser upp paritetsprovet S10.7.
KALLA | Överlämning #138 (story S10.5 ur 1F, våg 7; 1E Del 5), Davids ja 2026-09-07 med svarsregel 1 (bygg exakt överlämningen, inte mer), FR-17/FR-20 ur PRD 1C, friktionsdefinitionen ur UX 1D ("De tre lägena har identisk friktion", rad 277).
ARKITEKTUR | Vyn är transport och räknar inget: läsning i `withTenantTransaction` med `page()`-wrappern som övriga vyrutter i `server/src/http/view/routes.ts`; data via befintliga `bedomningsunderlag`/`listaBedomningar` och `frystCell`/`bedomningsChip`; JS-fri serverrenderad HTML med husets klasser (`.panel`, `.subnav`, `.chip`, `.empty`, `.page-head`) och kanons tokens ur `html.ts`; vitest + supertest mot riktig Postgres.
KRAV-1 | GET `.../projects/:projectId/rapporterna` renderar sidan med husets sidhuvud (eyebrow "Uppdrag", h1 "Rapporterna") och `subnav(..., 'rapporterna')`; okänt uppdrag eller fel tenant ger samma fel som övriga undersidor.
KRAV-2 | `UPPDRAGSSIDOR` får posten `['rapporterna', 'Rapporterna']` mellan `pengarna` och `kontraktet` (1E Del 5:s ordning); `aria-current="page"` sitter på exakt en post.
KRAV-3 | Varje bedömning renderas som en egen skannbar post (inte en tabellrad): period, avtalsnamn när uppdraget har flera avtal, läges-chip via `bedomningsChip`, kommentar, satt-tidpunkt (med varningschip när `satt_av_manniska` är falskt) och frysta tal via `frystCell`; `frysta_siffror = NULL` visar "Satt innan underlaget frystes"; ordningen är kronologisk, samma som Bedömningssidans historik.
KRAV-4 | Rapporterna läser exakt samma historikväg som Bedömningssidan (`bedomningsunderlag`/`listaBedomningar`) och de frysta talen renderas av samma `frystCell` — ingen egen beräkning, ingen dubblerad frysningslogik, så de två hemmen kan inte glida isär.
KRAV-5 | Identisk friktion (FR-17, 1D): vitest bevisar att `bedomningsformular`-markupen för `pa_spar`/`risk`/`ur_spar` genereras ur samma mall och är identisk sånär som på kod, etikett och innebördstext — ingen bekräftelseruta eller extra steg på något läge, sidorna förblir JS-fria.
KRAV-6 | Tom historik ger `.empty` med vad tomheten betyder och en väg till Bedömningssidan (FR-22-mönstret) — aldrig en naken tom lista.
KRAV-7 | Nya vitest i `server/test/`: rutten svarar 200 och visar en post per bedömning; posten bär sina frysta tal och NULL-fallet sin text; friktionsprovet ur KRAV-5; subnav-posten finns med rätt ordning; tenant-isolering (annan tenants uppdrag nås inte).
KRAV-8 | En rad i `docs/STATUS.md`:s sessionslogg, committad med övriga ändringar.
ACCEPTANS | `npm run build` och `npm test` gröna med inklistrad utdata; sidan visar samma historikdata som Bedömningssidan för samma uppdrag; ingen migration, ingen ny åtgärd, ingen ny CSS-klass, ingen JS, ingen ändring av formulärets beteende.
AVGRANSNING | Endast `server/src/http/view/routes.ts`, eventuellt en läsfunktion i `server/src/services/uppdragBedomning.ts`, nya testfiler i `server/test/` och en rad i `docs/STATUS.md` får röras; inga migrationer, inget i actions-registret, `docs/MCP_ACTIONS.md` rörs inte.
uteslutet: ta bort Bedömningssidans historiktabell och länka till Rapporterna i stället — källan kräver det inte (Davids svarsregel 1: exakt överlämningen, inte mer)
uteslutet: formuläret "Sätt bedömningen" på Rapporterna — källan kräver det inte
uteslutet: ny läsåtgärd i registret (t.ex. `las_rapporter`) — källan kräver det inte
uteslutet: filtrering, paginering eller periodval på posterna — källan kräver det inte
uteslutet: `.farskhet`-rad på posterna — källan kräver det inte (talen är frysta vid satt-tillfället, inte lästa nu)
uteslutet: ny komponentklass för postlayouten — källan kräver det inte (designkontraktet stänger nya stilar)

---

Två saker värda att lyfta ur grävandet: analysfrågan i underlaget ("får Rapporterna bli historikens enda hem?") faller på Davids svarsregel 1 — det vore en ändring utöver överlämningen, så Bedömningssidan behåller sin tabell och dubbleringsrisken hanteras med delad läsväg och delad `frystCell` (KRAV-4). Och friktionskravet FR-17 mäts mot formulärmarkupen (som redan finns i `bedomningsformular` och byggs ur `BEDOMNINGSLAGEN.map`), inte mot något nytt formulär på Rapporterna — det är därför KRAV-5 är ett bevis i vitest, inte ny funktionalitet.
```

## Utfall
Tester: 133 passed (133) · Granskning: GODKANT | Bygget följer kravspecen exakt — delad läsväg och delad `frystCell` utan egen beräkning, subnav-posten på rätt plats, enbart befintliga husklasser, alla uteslutningar respekterade, avgränsni · Byggforsok: 1

## Modellkedja (Davids krav 17/8)
Krav+granskning: claude-fable-5 · Utveckling: claude-opus-5 · Claude Code pa Davids abonnemang — inga API-tokens
