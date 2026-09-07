# Bygge beslut #135 — Sista storyn i våg 6: läsåtgärden `las_uppdragslage` (delegerar till befintliga `get_contract_usage`

Datum: 2026-09-07 01:13 · Branch: cto/sista-storyn-i-v-g-6-l-s-tg-rden-las-upp-135 · Overlamning: #135

## Mal
Sista storyn i våg 6: läsåtgärden `las_uppdragslage` (delegerar till befintliga `get_contract_usage`/`list_time_entries`) plus två JS-fria vyer — uppdragslistan `/app/c/:id/uppdrag` och Läget-sidan med handgreppsband och fem faktakort med `.farskhet`-rad.

## Kravspec (claude-fable-5) — sjalvbarande, med KALLA och ARKITEKTUR
```
Jag har nu grävt igenom ARKITEKTUR.md, STATUS.md, registry.ts, routes.ts, html.ts, tjänstelagret samt 1C/1D/1E och designkontraktet i vaulten. Nyckelfynd som styr specen: modulens undersidor ligger i huset under `/c/:companyId/projects/:projectId/*` (inte 1E:s `/uppdrag/:kod`), rytm-mekaniken (FR-14) saknar lagring och läsare i repot, `.farskhet`/`.subnav` finns inte i html.ts, och överlämningen namnger exakt två nya klasser — alltså byggs handgreppsbandet med husets befintliga komponenter. Här är kravspecen:

---

MAL | Ett uppdrags läge syns utan att David frågar (FR-18): listvyn `/app/c/:id/uppdrag` och Läget-sidan (handgreppsband + fem faktakort med `.farskhet`), allt härlett ur befintliga källor, plus `las_uppdragslage` som ytans enda läsväg för MCP/REST — våg 6:s slutsten.
KALLA | Överlämning #135 (S10.1 ur 1F, detaljer ur 1E Del 4/5), Davids ja 2026-09-07; FR-18/FR-22/FR-35 ur PRD 1C; 1D §4.1; designkontraktets menygrammatik; beroenden byggda i beslut #119, #122, #123, #124, #126, #132.
ARKITEKTUR | Read-action via `def()` i `actions/registry.ts` med `.strict()`-zod (`UuidSchema`); tjänst i `services/` som tar `client: PoolClient` + `companyId` och körs i `withTenantTransaction`; vyer i `http/view/routes.ts` via `page`/`pageFor`, JS-fri HTML med kanons tokens ur `html.ts`; vitest+supertest mot riktig Postgres. Ingen migration, inget nytt beroende, ingen SQL i registret.
KRAV-1 | Ny tjänst `server/src/services/uppdragLage.ts`: `lasUppdragslage(client, companyId, { project_id })` returnerar FR-18:s fem delar genom BEFINTLIGA tjänster — förbrukning mot ram via `getContractUsage` (contracts.ts) och tidsunderlag via `list_time_entries`-tjänsten (modulen räknar aldrig om ramen själv), leverabelregistret räknat per läge via `lasLeverabelregister`, senaste bedömning via `listaBedomningar`, signaler via `listaSignaler`, väntande köposter som rör uppdragets avtal via `listApprovals` (filtrerade i tjänsten). Okänt/grannbolags `project_id` eller projekt utan avtal → 404 genom hela stacken (samma mönster som `kravAvtal`).
KRAV-2 | `registry.ts` får EN ny action: `def({ name: 'las_uppdragslage', sensitivity: 'read', inputSchema: z.object({ project_id: UuidSchema }).strict(), handler → tjänsten })`. Ingen `kravManniska` (1E Del 4:s tabell, rad `las_uppdragslage`).
KRAV-3 | Listvyn `viewRouter.get('/c/:companyId/uppdrag', …)`: ett uppdrag per rad (uppdrag = projekt med ≥ 1 avtal, härlett via `listContracts` som i `registerkopiaKo`), med namn/kund, läge ur senaste bedömningen (`pa_spar`/`risk`/`ur_spar`, saknas → texten *saknad*, aldrig grön default), färskhet (senaste `last_nar` ur uppdragets svepvärden; inget svep → förklarande text) och länk till Läget. Tom lista → `.tomt`-grammatik: vad tomheten betyder + väg vidare.
KRAV-4 | Läget-sidan `viewRouter.get('/c/:companyId/projects/:projectId/laget', …)`: överst handgreppsbandet med det som väntar på en människa, härlett ur befintliga källor — väntande köposter, öppna signaler utan avgörande, öppna statusförslag (`statusforslag:*` ur `lasSvepvarden`, återanvänd `statusforslag()`-hjälparen i routes.ts) — byggt med husets befintliga komponenter (`.ai-card`, chip, knappband). Tomt band visar en mening om vad tomheten betyder plus en väg vidare, aldrig "0".
KRAV-5 | Därunder exakt fem faktakort = FR-18:s innehållsdelar: (1) förbrukning mot ram med tröskel — två tal, aldrig en kvot; (2) leverabelregistret räknat per läge — uppräknade tillstånd, aldrig procent; (3) senaste bedömning — läge + datum + vem + första meningen, saknas → *saknad*, aldrig grön; (4) tända scopesignaler, öppna först; (5) öppna köposter. Datat kommer ur `lasUppdragslage` (KRAV-1) — vyn gör inga egna beräkningar.
KRAV-6 | Varje kort bär en `.farskhet`-rad (FR-35): källa + lästidpunkt vid värdet, aldrig en global sidstämpel. Svepta värden läser `kalla`/`last_nar` ur `uppdrag_svepvarde` (aldrig ur grannsystemet); direktlästa värden bär "läst ur redovisningen HH:MM". En del vars källa inte gick att läsa visar DET — aldrig ett gammalt värde som färskt.
KRAV-7 | `html.ts` får två nya komponentklasser enligt designkontraktet: `.farskhet` (12 px `--mono`, dämpad, sist i kortet) och `.subnav` (menygrammatikens fyrkantiga form, "en nivå ner", `aria-current="page"` på exakt en post, JS-fritt). Läget bär `.subnav` till uppdragets befintliga undersidor (avtal, bedomning, signaler, planen, kontraktet). Ingen annan ny stil.
KRAV-8 | Saknas en innehållsdel renderas kortet ändå, med `.tomt`-förklaring (FR-22) — aldrig en naken nolla (lärdom 7 i STATUS: en tyst nolla ser ut som ett sant svar). Alla fem korten finns alltid i sidans HTML.
KRAV-9 | Vitest i `server/test/` genom hela stacken: (a) `las_uppdragslage` returnerar alla fem delar för ett uppdrag med data; (b) tenant-isolering — grannbolags `project_id` → 404; (c) TOMFALLET bevisat: nytt uppdrag utan bedömning/signaler/köposter ger fem kort med tomtext och ingen naken "0" i något kort; (d) listvyn tom respektive med rader; (e) `.farskhet`-rad finns per kort och tomt handgreppsband bär sin förklaring.
KRAV-10 | `docs/MCP_ACTIONS.md` (modulsektionen Uppdragsytan) får `las_uppdragslage`; `docs/STATUS.md` sessionslogg får en rad.
ACCEPTANS | `npm test` och `npm run build` gröna med inklistrad utdata; Läget svarar "var står vi" på en skärm: band överst, sedan fem kort med var sin `.farskhet`-rad; tomfallstesten går röda om ett kort visar en naken nolla; diffen rör bara filerna i AVGRANSNING och innehåller ingen migration och inget nytt paket.
AVGRANSNING | Endast: `services/uppdragLage.ts` (ny), `actions/registry.ts` (en def), `http/view/routes.ts` (två vyer), `http/view/html.ts` (två klasser), `server/test/` (nya tester), `docs/MCP_ACTIONS.md`, `docs/STATUS.md`. Inga schemaändringar, inga ändringar i befintliga åtgärder/tjänster/`execute.ts`, ingen sensitivity-ändring, `.env` rörs aldrig.
uteslutet: post i huvudnavigationen/`.nav__quick` för uppdragslistan (FR-21) — kallan kraver det inte
uteslutet: kortet "Nästa datum"/prognosrad ur 1D:s korttabell (FR-5) — kallan kraver det inte
uteslutet: rytm-mekanik och förfallodatum för bedömningen i bandet (FR-14 saknar lagring och läsare i repot) — kallan kraver det inte
uteslutet: ny `.handgrepp`-klass i html.ts (bandet byggs med husets befintliga komponenter; överlämningen namnger bara `.farskhet`/`.subnav`) — kallan kraver det inte
uteslutet: `.subnav` retroaktivt på modulens befintliga undersidor — kallan kraver det inte
uteslutet: övriga åtta 1D-klasser (`.tidslinje`, `.brada`, `.leverabelkort` m.fl.) — kallan kraver det inte
uteslutet: ändring av `designparitet.py`/övriga .py-prov (byggs hos Hermes, inte här) — kallan kraver det inte
uteslutet: auditloggning av läsningen (read-actions auditloggas inte i huset) — kallan kraver det inte

---

Två vägval jag gjorde med stöd i Davids svarsregler, så granskaren ser dem: Läget lades på `/projects/:projectId/laget` eftersom huset redan bär modulens undersidor där (regel 2/3: huset vinner över 1E:s `/uppdrag/:kod`), och bandet byggs utan `.handgrepp`-klass eftersom överlämningen uttryckligen bara namnger `.farskhet`/`.subnav` som nya klasser (regel 1: exakt överlämningen, inte mer).
```

## Utfall
Tester: 130 passed (130) · Granskning: GODKANT eller UNDERKANT — här är min bedömning efter genomläsning av ARKITEKTUR.md, hela `uppdragLage.ts`, testsviten och de återanvända tjänsterna (`listContracts`/`getContractUsage`, `listTimeEntrie · Byggforsok: 2

## Modellkedja (Davids krav 17/8)
Krav+granskning: claude-fable-5 · Utveckling: claude-opus-5 · Claude Code pa Davids abonnemang — inga API-tokens
