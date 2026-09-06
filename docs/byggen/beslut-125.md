# Bygge beslut #125 — Story S10.2: en JS-fri tidslinjevy ("Planen") över uppdragets avtalsdelar, ritad med CSS Grid och se

Datum: 2026-09-06 18:08 · Branch: cto/story-s10-2-en-js-fri-tidslinjevy-planen-125 · Overlamning: #125

## Mal
Story S10.2: en JS-fri tidslinjevy ("Planen") över uppdragets avtalsdelar, ritad med CSS Grid och serverberäknade `--start`/`--span`, ärvda intervall som streckade `.stapel[data-arvd]` med `data-precision`, tabellen som primärkälla och grafiken `aria-hidden`, grupperad datumlista på mobil.

## Kravspec (claude-fable-5) — sjalvbarande, med KALLA och ARKITEKTUR
```
Jag har grävt klart: datamodellen (`contract_parts.start_date/end_date/date_precision` ur 0068, hierarkin `UPPDRAG` → ström → leverabel ur `uppdragImport.ts` där leverabler saknar egna datum), husets vymönster (S4.1/S5.1: knappband på uppdragssidan i `routes.ts:1481`, inte 1E:s `.subnav` — huset vinner per Davids regel 2), precisionslogiken i `lib/leveranskontrakt.ts` och kanons tokens i `html.ts`. Här är kravspecen:

---

MAL | Vyn **Planen** på uppdraget: en JS-fri, serverrenderad tidslinje över uppdragets avtalsdelar (CSS Grid, serverberäknade `--start`/`--span`) så att David ser vad som är avtalat och när det landar (FR-34). Tabellen bär ensam sanningen; grafiken är `aria-hidden`-dekoration som aldrig kan ljuga ensam.
KALLA | Överlämning #125 (`docs/inkorg/125-…planen.md`), story S10.2 ur 1F, våg 3 ur 1H, Davids ja 2026-09-06; 1D §4.2 + komponenttabellen (`.tidslinje`/`.stapel`-grammatiken, mobilens datumlista); FR-34, NFR-2, NFR-8; Linear LOC-399.
ARKITEKTUR | Ren läsvy efter husets mönster (S4.1 Bedömning/S5.1 Signaler i `server/src/http/view/routes.ts`): `page()`+`layout()`, knapp i uppdragets knappband (`routes.ts:1481`) — INTE 1E:s `.subnav`/egen stilmall, huset gäller. Data läses i `withTenantTransaction` (RLS som roll `app`), gällande version per delkod som `gallandeVersion` i `services/contracts.ts`. Gridmatematiken är en REN exporterad funktion utan I/O (mönstret `lib/leveranskontrakt.ts`). Stil = kanons tokens i `html.ts` (`--line`, `--accent`, `--mono`). Inga nya beroenden.
KRAV-1 | `GET /app/c/:companyId/projects/:projectId/planen` renderar sidan; knappen **Planen** läggs i uppdragets befintliga knappband. Fel företag/uppdrag ger samma svar som husets övriga vyer (tenant-isolering via medlemskapet, aldrig request-body).
KRAV-2 | En ren exporterad funktion i `server/src/lib/` beräknar ur delarnas `start_date`/`end_date`/`date_precision` ett månadsbaserat rutnät: `--kolumner` (totala månadsspannet) samt per stapel 1-baserade `--start`/`--span` i hela månader; grövre precision (kvartal/halvår/år) täcker exakt intervallets månader — aldrig ett påhittat dagdatum.
KRAV-3 | Ärvt intervall: en del utan egna datum ärver närmaste förälder med datum (ström, annars roten `UPPDRAG`) och ritas `.stapel[data-arvd]` (streckad per 1D:s grammatik — ingen ny klass) med `data-precision` från källan; en del med egna datum ritas solid med egen `data-precision`. Saknar hela kedjan datum ritas ingen stapel alls.
KRAV-4 | Tabellen är primärkälla och listar alla aktiva delar (gällande version) med kod, namn, start, slut och precision i klartext; saknat värde visas som saknat, aldrig ifyllt. Hela `.tidslinje`-grafiken bär `aria-hidden="true"`.
KRAV-5 | Mobil: via media query döljs tidslinjen och en grupperad datumlista visas i stället (grupperad mot dagens datum: försenat / denna vecka / senare, per 1D §4.2) — samma serverrenderade sida, ingen JavaScript, ingen horisontell rullning.
KRAV-6 | CSS-klasserna `.tidslinje` (grid, `repeat(var(--kolumner),1fr)`, `aria-hidden`) och `.stapel` (`grid-column: var(--start) / span var(--span)`) läggs i `html.ts` med kanons tokens; enda inline-stilen är variablerna `--kolumner`/`--start`/`--span`; ingen stil utanför 1D:s tio komponentklasser.
KRAV-7 | Vitest i `server/test/` (t.ex. `uppdragsytan-plan.test.ts`): gridfunktionen prövas direkt på blandade precisioner (dag/månad/kvartal), ärvt intervall, saknade datum och spannets kanter; vyn prövas genom stacken med supertest — 200, tabellinnehåll, `aria-hidden` på grafiken, ingen `<script>`, samt 404/isolering mot annat företag.
KRAV-8 | `docs/STATUS.md` får en rad i sessionsloggen.
ACCEPTANS | `npm run build` och `npm test` gröna med faktisk inklistrad utdata; supertest-beviset visar att sidan renderar utan JavaScript och att tabellen ensam bär all information som grafiken visar; stapelplacering verifierad av gridtesterna, inte av ögat; inga ändringar utanför de fyra filerna + STATUS.md.
AVGRANSNING | Ingen ny action, ingen migration, ingen sensitivity-ändring, ingen tjänstemutation, ingen ny felkod; `designparitet.py` och designkontraktet rörs inte (paritetsfönstret S10.2→S10.7 är byggregel, dokumenterad i 1G); `docs/MCP_ACTIONS.md` orörd (ingen ny åtgärd); befintliga vyer och rutter orörda utom knappen i knappbandet.
uteslutet: `.stapel--baseline`-skuggstapel med avvikelse i dagar — källan kräver det inte
uteslutet: dagens-linje i `--accent` — källan kräver det inte
uteslutet: `.milstolpe`-markörer — källan kräver det inte
uteslutet: leverabellägen/förbrukning/färskhetsrad i planen — källan kräver det inte
uteslutet: beroendepilar, zoom eller horisontell rullning — källan kräver det inte (1D förbjuder dem)

---

Två grävfynd som bär kraven: (1) leverabler får aldrig egna datum av importen (`uppdragImport.ts` sätter dem bara på strömmar och lämnar roten NULL), så arvskedjan i KRAV-3 är verklighet, inte antagande; (2) 1E:s vyplan (`.subnav`, egen stilmall) avviker från det huset redan byggt i S4.1/S5.1 — per Davids beslutsregel 2 struken till förmån för knappbandet och `html.ts`.
```

## Utfall
Tester: 121 passed (121) · Granskning: GODKANT | Bygget följer huset exakt (knappband, `page()`/`layout()`, `parseCompanyId`/`parseApprovalId`, `withTenantTransaction`, ren lib-funktion enligt `leveranskontrakt.ts`-mönstret, enbart kanons  · Byggforsok: 2

## Modellkedja (Davids krav 17/8)
Krav+granskning: claude-fable-5 · Utveckling: claude-opus-5 · Claude Code pa Davids abonnemang — inga API-tokens
