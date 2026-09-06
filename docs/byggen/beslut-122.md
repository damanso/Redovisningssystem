# Bygge beslut #122 — Två människoåtgärder (`tand_signal`/`avgor_signal`, `kravManniska`) mot befintliga `uppdrag_scopesig

Datum: 2026-09-06 16:08 · Branch: cto/tv-m-nnisko-tg-rder-tand-signal-avgor-si-122 · Overlamning: #122

## Mal
Två människoåtgärder (`tand_signal`/`avgor_signal`, `kravManniska`) mot befintliga `uppdrag_scopesignal`, underlag som referens (Message-ID/event-uid) via referenslagret, signalvy under uppdraget med direkt eskalering utan motiveringskrav, delning loggad genom referenskön (ko_status → Drive-id).

## Kravspec (claude-fable-5) — sjalvbarande, med KALLA och ARKITEKTUR
```
Grävandet är klart: 1E Del 4 ger åtgärdsnamnen `tand_scopesignal`/`avgor_scopesignal` (båda `write` + `kravManniska` — inte underlagets kortnamn), tilläggsskapandet hör till S5.2, huset saknar `.subnav` (S10.7 bygger menyn) så vyn följer S4.1:s bedömningsmönster, och eskaleringsstämpeln saknar kolumn — därav additiv 0070. Här är kravspecen:

---

MAL | När bygget är klart kan David tända en scopesignal ur kontraktets sju fraser, fästa underlaget som referens (Message-ID/event-uid, aldrig kopia), avgöra innanför/utanför och eskalera direkt utan motivering — och det finns ingen kodväg där en signal tänds eller avgörs utan människa. Verktygets mål: uppdragets scopelinje bevakas av en människa med spårbart underlag (FR-6, FR-7, FR-26), inte av en maskin som tänder själv.
KALLA | Överlämning #122 (story S5.1 ur 1F, våg 3); 1E Del 4 (åtgärdstabellen: namn, sensitivity, kravManniska — gäller per Davids regel 4) och Del 7 (FR-6/7-bäraren, `eskalera: true` med tomt motiv giltigt); PRD FR-6/FR-7/FR-26; Davids ja 6/9 via vågköraren med delningsprovet scope-satt till S4.2 (underlagets FRAGA/REKOMMENDATION); Davids beslutsregler 6/9 punkt 1–3 (inget utöver överlämningen, huset vinner, husets mönster vid val).
ARKITEKTUR | Ett flöde, tre ingångar: `executeAction` → `def()`-post i `actions/registry.ts` (`.strict()`-zod ur `lib/validation.ts`, ingen SQL) → tjänstelagret (`client: PoolClient` + `companyId` i `withTenantTransaction`, RLS, `company_id` ur medlemskapet); `kravManniska`-spärren i `execute.ts:56` (S2.1); referenser enbart via `skapaReferens`/`listaReferenser` i `services/uppdragReferens.ts` (S7.1, url/sökvägsspärren sitter där); vyn via `runViewAction` med actor `human` (lärdom 5), mönster `bedomningsSida` (S4.1, `routes.ts:2211–2284`); fel via befintliga `errorHandler.ts`; vitest mot riktig Postgres.
KRAV-1 | Additiv migration `0070_eskaleringsstampel.sql`: enda ändringen är kolumnen `eskalerad_nar timestamptz` (NULL = ej eskalerad) på `uppdrag_scopesignal`; idempotent, ingen backfill, inga andra schemaändringar. Testbart: `npm run migrate` två gånger mot tomt schema; kolumnen finns, allt annat i 0068 orört.
KRAV-2 | Ny tjänst `server/src/services/uppdragSignal.ts` (mönster `uppdragBedomning.ts`): `tandSignal` INSERT:ar fras (obligatorisk) + klausul (valfri), sätter `tand_av` ur inloggad användare (aldrig indata), sätter `eskalerad_nar = now()` vid `eskalera: true`; valfritt underlag `{sort: 'mejl'|'kalender', extern_id, extern_nyckel, extern_kalla}` blir `underlag_ref_id` — befintlig referens med samma `(sort, extern_id)` återanvänds (läsning före skrivning, S1.2-mönstret), annars `skapaReferens`; `avgorSignal` UPDATE:ar `avgjord` till `'innanfor'|'utanfor'`; `listaSignaler` returnerar öppna (avgjord NULL) först (1D). Okänt avtal eller okänd signal, inkl. grannbolagets → `NotFoundError`, som `avtalsnamn`.
KRAV-3 | Två def-poster i `actions/registry.ts`: `tand_scopesignal` och `avgor_scopesignal` — namn, `write` + `kravManniska: true` och handgrepp 3 exakt enligt 1E Del 4:s tabell; agentanrop → 403 `human_required` FÖRE varje skrivning: ingen köpost, ingen auditrad, ingen rad. Inga nya felkoder.
KRAV-4 | Vysida GET+POST `/app/c/:companyId/projects/:projectId/signaler` med knappen **Signaler** i uppdragssidans knappband (`routes.ts:1452`, bredvid Bedömning): fraserna förifylls ur `uppdrag_scopelinje` med `sort='fras'` (läses ur kontraktet, hårdkodas aldrig), varje fras har Tänd-knapp, öppna signaler överst märkta öppna, avgör-knappar innanför/utanför, eskalering utan motiveringsfält; JS-fritt, kanons tokens och befintliga klasser, ingen ny CSS.
KRAV-5 | Ny svit `server/test/uppdragsytan-signaler.test.ts` (mall `manniskosparr.test.ts`/`uppdragsytan-bedomning.test.ts`): agent → 403 för båda åtgärderna med oförändrad databas, kö och auditlogg; människa → 200; underlag med Message-ID ger referensrad + `underlag_ref_id`, url/sökväg som `extern_id` fälls, andra signalen på samma mejl återanvänder raden; tredje avgjord-värde fälls av zod (400) och CHECK; eskalering utan motiv sätter stämpeln; okänt fält 400 (`.strict()`); tenantgräns 404 på åtgärd och vysida.
KRAV-6 | Dokumentation: båda åtgärderna under modulsektionen Uppdragsytan i `docs/MCP_ACTIONS.md`; `docs/STATUS.md` får sin sessionsloggpost.
ACCEPTANS | `npm run build` ren och `npm test` grönt med faktisk inklistrad utdata (grinden körs av körskriptet, utfallet in i STATUS före stängning); sviten bevisar storyns Then — ingen kodväg tänder eller avgör utan människa — med negativ kontroll; rapportrenderingen (innanför/utanför/fraserna) och delningsloggen med datum och Drive-id bevisas i S4.2/S7.5, per Davids ja 6/9 på underlaget.
AVGRANSNING | Rör inte `uppdragReferens.ts`, `uppdragBedomning.ts`, `execute.ts`, `errorHandler.ts`, `html.ts`, befintliga migrationer, någon annan åtgärds sensitivity eller `ko_status`-kolumnen; inga nya beroenden, ingen scheduler, ingen ny felkod, ingen ny CSS-klass.
uteslutet: tilläggsskapandet via `andra_baseline` och `ledde_till_part_id` (S5.2, våg 4) — kallan kraver det inte
uteslutet: `.subnav`-meny (finns inte i kanon; S10.7 bygger menyn) — kallan kraver det inte
uteslutet: motivfält/kommentarkolumn på eskaleringen — kallan kraver det inte
uteslutet: validering att tänd fras måste matcha en scopelinjerad — kallan kraver det inte
uteslutet: spärr mot omavgörande av en redan avgjord signal — kallan kraver det inte
uteslutet: oinloggad delningsvy/länk till Eva (bryter NFR-7/NFR-9, förkastad 5/9) — kallan kraver det inte
uteslutet: egen delningskö-mekanik utöver befintliga `ko_status` (töms av S7.5) — kallan kraver det inte
uteslutet: auditrad vid 403-avvisningen (Davids nej 6/9, S2.1) — kallan kraver det inte

---

Tre vägval värda att känna till: åtgärdsnamnen följer 1E:s tabell (`tand_scopesignal`/`avgor_scopesignal`), inte underlagets kortform, eftersom överlämningen uttryckligen låter 1E bära åtgärdsnamnen. Underlagets `.subnav` ströks med Davids regel 2 — huset saknar klassen och S10.7 äger menyn, så vyn följer S4.1:s knapp-på-uppdragssidan-mönster. Och eskaleringsstämpeln blev den "möjligen additiva 0070" ur underlaget, eftersom `eskalera: true` annars inte hade lagrats någonstans och vyns eskalering blivit en knapp utan spår.
```

## Utfall
Tester: 118 passed (118) · Granskning: GODKANT | Bygget följer kravspecen punkt för punkt (0070 en kolumn, tjänst enligt bedömningsmönstret, två `write`+`kravManniska`-poster, vy enligt S4.1, svit med negativ kontroll och tenantgräns) utan · Byggforsok: 1

## Modellkedja (Davids krav 17/8)
Krav+granskning: claude-fable-5 · Utveckling: claude-opus-5 · Claude Code pa Davids abonnemang — inga API-tokens
