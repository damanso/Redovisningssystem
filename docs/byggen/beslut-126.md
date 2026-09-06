# Bygge beslut #126 — Åtgärden `bekrafta_statusbyte`: David bekräftar svepets `statusforslag:<kod>` ur cachen, systemet fy

Datum: 2026-09-06 18:58 · Branch: cto/tg-rden-bekrafta-statusbyte-david-bekr-126 · Overlamning: #126

## Mal
Åtgärden `bekrafta_statusbyte`: David bekräftar svepets `statusforslag:<kod>` ur cachen, systemet fyller överlämningsdatum, uppräknad revision och mottagare ur kontraktets `godkannare` (spärr `saknad mottagare` vid NULL), skriver append-only-händelse och flyttar `uppdrag_leverabel.status`; retur ger `avvisad`-post.

## Kravspec (claude-fable-5) — sjalvbarande, med KALLA och ARKITEKTUR
```
Kravspecen är klar. Innan den: tre lägesfynd ur koden som styrde vägvalen — (1) schemat är verifierat klart: 0068 har status-CHECK med `avvisad`, `uppdrag_leverabel_handelse` med `revision`/`mottagare` och append-only-rättigheter (SELECT+INSERT), och `contracts.godkannare` finns; ingen kodväg skriver `uppdrag_leverabel.status` i dag. (2) Någon registervy finns inte i vylagret ännu (den uteslöts uttryckligen i bygge #121), så vy-biten läggs på uppdragssidan enligt husets S4.1/S5.1-mönster. (3) `koaRegisterkopia` har ett eget kodkontrakt ("anropas i SAMMA transaktion som registerändringen"), och ett statusbyte är en registerändring — det kravet är huset, inte ett tillägg. Analysfrågan om revisionen faller under Davids regel 1: systemets uppräknade revision gäller (den härleds ur historiken enligt överlämningen), men avvikelseloggen är ett tillägg och byggs inte.

---

MAL | Åtgärden `bekrafta_statusbyte` som enda kodväg till `uppdrag_leverabel.status`: David bekräftar svepets cacheförslag och systemet fyller transmittalfälten (överlämningsdatum, uppräknad revision, mottagare) utan någon inmatning, eller registrerar en retur som `avvisad`-post — så att statusbytet förblir ett mänskligt handgrepp med spårbar append-only-historik och ingen maskin någonsin flyttar en leverabels status (FR-12, FR-13, NFR-4).
KALLA | Överlämning #126 (story S3.2 ur 1F, våg 4), CTO-underlag med Davids ja 2026-09-06 (analysregel 1: exakt överlämningen, inget mer), 1E Del 4 (`write` + `kravManniska`, handgrepp 4, "förslaget är ingen åtgärd"), PRD FR-12/FR-13/NFR-4, schema `0068_uppdragsytan.sql` (status-CHECK rad 121, `_handelse` rad 132–148, `godkannare` rad 68).
ARKITEKTUR | `def({...})` i ACTIONS (`registry.ts`) → tjänst i `server/src/services/` → Postgres under `withTenantTransaction`; `kravManniska`-spärren i `execute.ts:56` (finns, fäller agenter före varje skrivning); zod-strict ur `lib/validation.ts`; `NotFoundError`/`ConflictError` ur `lib/errors.ts` — inga nya felkoder; auditraden skrivs centralt av `executeAction`; append-only via 0068:s GRANT SELECT,INSERT på `_handelse`; vyn via `runViewAction` (actor `human`) + `felNotis`, mönster S4.1/S5.1; `koaRegisterkopia` (`uppdragReferens.ts:382`).
KRAV-1 | Ny tjänst `server/src/services/uppdragStatus.ts`: `bekraftaStatusbyte(client, companyId, userId, { contract_id, leverabel_kod, utfall })` med utfall `'bekraftad' | 'retur'`; förslaget läses ur `uppdrag_svepvarde` med nyckel `statusforslag:<leverabel_kod>` — saknas det: `NotFoundError('statusforslag')`; leverabeln slås upp på `(contract_id, kod)` och måste stå i `pagar`, annars `ConflictError`.
KRAV-2 | Bekräftelse: mottagaren läses ur `contracts.godkannare`; NULL/tom → `ConflictError` med texten `saknad mottagare` och ingenting skrivs — fältet gissas aldrig (FR-13). Revisionen = 1 + högsta `revision` i leverabelns `uppdrag_leverabel_handelse`-rader (första överlämningen = 1) — härledd ur historiken, aldrig ur indata; Drive-revisionen i förslaget deltar aldrig i räkningen.
KRAV-3 | Bekräftelsen skriver i EN transaktion: händelsepost (`fran` `pagar`, `till` `levererad`, `bekraftat_av` = userId ur åtgärdskontexten, `bekraftat_nar` = now(), `revision`, `mottagare`) + UPDATE `uppdrag_leverabel.status` → `levererad`.
KRAV-4 | Retur: händelsepost (`fran` `pagar`, `till` `avvisad`, `bekraftat_av`/`bekraftat_nar` satta, `revision` och `mottagare` NULL) + status → `avvisad` — aldrig en tyst flytt bakåt; mottagarspärren gäller inte returen.
KRAV-5 | Båda utfallen anropar `koaRegisterkopia` i samma transaktion — funktionens eget kontrakt ("anropas i SAMMA transaktion som registerändringen", FR-11); kopians innehåll bär status via `lasLeverabelregister`.
KRAV-6 | `registry.ts` under Uppdragsytan: `name: 'bekrafta_statusbyte'`, `sensitivity: 'write'`, `kravManniska: true`, `inputSchema: z.object({ contract_id: UuidSchema, leverabel_kod: safeText(50), utfall: z.enum(['bekraftad','retur']) }).strict()`; handlern anropar tjänsten — ingen SQL i registret, och målstatusen härleds ur utfallet: indata bär aldrig ett fritt statusfält (det vore en andra skrivväg).
KRAV-7 | Vy-bit på uppdragssidan (`/c/:companyId/projects/:projectId` i `view/routes.ts`): öppna `statusforslag:*` ur cachen för leverabler i `pagar` visas med `--ai`-markering (`aiMarkning` i `html.ts`) och sitt underlag (leverabelkod, Drive-revision, referens), med knapparna Bekräfta och Retur som POST:ar via `runViewAction` till åtgärden; befintliga komponentklasser, ingen ny CSS, JS-fritt; `saknad mottagare` syns via `felNotis`.
KRAV-8 | Ny vitest `server/test/uppdragsytan-statusbyte.test.ts` (mönster `uppdragsytan-bedomning.test.ts`, riktig Postgres): (a) bekräftelsen flyttar status och händelsen bär revision 1, mottagaren ur kontraktet och datum — inget ur indata; (b) andra överlämningen ger revision 2 fast förslaget bär en annan Drive-revision; (c) syntetiskt kontrakt utan `godkannare` → `saknad mottagare`, status orörd, ingen händelse; (d) retur → `avvisad`-post; (e) `executeAction` med actor `agent` fälls med `human_required` före varje skrivning; (f) saknat förslag → 404; (g) annat bolags användare → 404; (h) UPDATE/DELETE på `uppdrag_leverabel_handelse` fälls (append-only).
KRAV-9 | Docs: en rad i `docs/MCP_ACTIONS.md` under modulsektionen Uppdragsytan och en sessionsrad i `docs/STATUS.md`; committas med koden.
ACCEPTANS | `npm test` och `npm run build` gröna med inklistrad faktisk utdata; provets åtta fall passerar synligt; `git diff` visar ingen migration och att `uppdragSvep.ts`:s skrivvägar, `execute.ts`, `errorHandler.ts` och sensitivity på befintliga åtgärder är orörda; en sökning i `server/src` visar att `uppdrag_leverabel.status` skrivs enbart i `uppdragStatus.ts`.
AVGRANSNING | Endast: ny tjänstefil, en def-post i `registry.ts`, vy-biten på uppdragssidan, ett nytt prov, två docs-rader. Schema 0068 och senare migrationer, svepets förslagsskrivning, godkännandekön och alla befintliga åtgärder rörs inte.
uteslutet: ändringsbart mottagarfält vid bekräftelsen — kallan kraver det inte
uteslutet: avvikelselogg system- kontra Drive-revision i händelseposten — kallan kraver det inte
uteslutet: radering av cacheförslaget vid bekräftelse/retur (självrensande vid nästa svep) — kallan kraver det inte
uteslutet: registervyn bräda/tabell (FR-39) och byten ej_paborjad→pagar eller levererad→godkand — kallan kraver det inte
uteslutet: användning av godkannare_eskalering i händelseposten — kallan kraver det inte
uteslutet: .py-prov hos Hermes — kallan kraver det inte (överlämningens VILLKOR: byggs av sessionen)

---

Specen är 20 rader och självbärande: utvecklaren får tabell- och kolumnnamnen, felklasserna, mönsterfilerna och gränserna utan att gräva. De två punkter en granskare kan vilja syna är KRAV-5 (registerkopian — motiverad av husets befintliga kodkontrakt, inte av överlämningen) och KRAV-7:s placering på uppdragssidan (registervyn finns inte ännu; husets mönster gäller per Davids regel 3).
```

## Utfall
Tester: 122 passed (122) · Granskning: GODKANT | Bygget uppfyller KRAV-1–9 exakt (enda skrivvägen till `uppdrag_leverabel.status` verifierad via sökning — importen INSERT:ar utan status), följer husets mönster (def/kravManniska som `satt_b · Byggforsok: 1

## Modellkedja (Davids krav 17/8)
Krav+granskning: claude-fable-5 · Utveckling: claude-opus-5 · Claude Code pa Davids abonnemang — inga API-tokens
