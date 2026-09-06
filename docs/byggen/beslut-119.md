# Bygge beslut #119 — En ny åtgärd `satt_bedomning` (kravManniska) som skriver ett av tre lägen till den redan befintliga,

Datum: 2026-09-06 14:36 · Branch: cto/en-ny-tg-rd-satt-bedomning-kravmanniska-119 · Overlamning: #119

## Mal
En ny åtgärd `satt_bedomning` (kravManniska) som skriver ett av tre lägen till den redan befintliga, oföränderliga tabellen `uppdrag_bedomning` (0068), plus vy och vitest-prov — schemat, rättigheterna och kravManniska-gaten finns redan i main.

## Kravspec (claude-fable-5) — sjalvbarande, med KALLA och ARKITEKTUR
```
Kravspecen är klar. Jag har verifierat underlaget mot koden: `uppdrag_bedomning` finns i 0068 med CHECK på exakt tre lägen och bara SELECT+INSERT för `app` (migrationens rad 153–174 och 483), `kravManniska`-spärren sitter i `execute.ts:53–56`, mönstret `satt_bedomning` = write + kravManniska + handgrepp 1 står i 1E Del 4 (rad 539), och vyn har husmönstret projektundersida (`routes.ts:1852`, `/avtal`). Avgörande fynd för CTO:ns analysfråga: 1E Del 7 säger uttryckligen att FR-14:s rytm i v1 har **ingen lagring och ingen läsare** — den bärs av styrgruppsmötena i Davids kalender. Med Davids regel (1) och (2) faller därmed både datumspärren och "nästa tillfälle"-visningen bort.

---

MAL | Bedömningen för ett uppdrag kan sättas — `pa_spar`/`risk`/`ur_spar` (FR-14), bara av en människa (FR-15), aldrig ändringsbar i efterhand (FR-17): åtgärden `satt_bedomning`, en vy där David sätter läget och läser historiken, och prov som visar att spärrarna är rättigheter, inte konventioner.
KALLA | Överlämning #119 (story S4.1 ur 1F, våg 2), Davids ja 2026-09-06; 1E Del 4 (`satt_bedomning`: write + `kravManniska`, handgrepp 1) och Del 7 (FR-14/15/17, rytmen utan lagring/läsare i v1); beroenden verifierade på main: 0068 `uppdrag_bedomning` (S1.1) och `kravManniska`-spärren i `execute.ts:53` (S2.1, beslut #115).
ARKITEKTUR | Ett flöde, tre ingångar: ny åtgärd i `registry.ts` (zod-strict ur `lib/validation.ts`), handler → ny tjänst i `services/` inuti `withTenantTransaction` (RLS, `company_id` ur medlemskapet); audit `action.executed` skrivs redan av `executeAction` i samma transaktion; vyn anropar `executeAction` med actor human (lärdom 5). Inga nya mönster.
KRAV-1 | `server/src/actions/registry.ts`: `satt_bedomning`, `sensitivity: 'write'`, `kravManniska: true`. Indata: `contract_id` (uuid), `period_start`, `period_slut` (datum), `lage` (zod-enum exakt `pa_spar|risk|ur_spar`), `kommentar` (valfri, safeText). Handlern anropar tjänsten — ingen SQL i registret.
KRAV-2 | Ny tjänst `server/src/services/uppdragBedomning.ts`: EN INSERT i `uppdrag_bedomning` med `satt_av_manniska = true` (spärren i KRAV-1 garanterar människan); `handelse_ref_ids` och `frysta_siffror` lämnas NULL. Plus en läsfunktion: avtalets bedömningar i kronologisk ordning. Ingen UPDATE/DELETE — rättigheten finns inte (0068).
KRAV-3 | Vyform+lista i `server/src/http/view/routes.ts` som undersida till projektsidan enligt `/avtal`-mönstret (routes.ts:1852): GET visar historiken (läge, period, kommentar, satt när) och formuläret (tre lägen, valfri kommentar, period); POST går genom `executeAction` (actor human) med husets redirect+notis. JS-fri serverrenderad HTML, kanons tokens och befintliga klasser — ingen ny stil.
KRAV-4 | Ny svit `server/test/uppdragsytan-bedomning.test.ts` — de tre lagren ur risken: (a) agent-token via REST mot `satt_bedomning` → 403 `human_required`, ingen rad, ingen auditrad, tom godkännandekö (mall `manniskosparr.test.ts`); (b) UPDATE och DELETE som `app` mot en skriven rad fälls av rättigheten; (c) vyformulärets POST som människa skriver raden med `satt_av_manniska = true` och audit `action.executed`.
KRAV-5 | Samma svit: alla tre lägena kan lagras, med och utan kommentar (vattenmelonskyddet); ett fjärde läge avvisas av zod (400) och av CHECK-villkoret; en andra bedömning för samma period läggs till som ny rad och den första är oförändrad (FR-17); tenantgräns: bolag B varken ser eller skriver bolag A:s bedömningar.
KRAV-6 | Dokumentation: `satt_bedomning` under modulsektionen Uppdragsytan i `docs/MCP_ACTIONS.md` (write, kravManniska, handgrepp 1); `docs/STATUS.md` får en sessionsrad.
ACCEPTANS | `npm run build` och `npm test` gröna med faktisk inklistrad utdata; KRAV-4:s tre lager och KRAV-5:s fall passerar; diffen innehåller ingen migration, inget nytt beroende och ingen ändring av någon annan åtgärds sensitivity/kravManniska.
AVGRANSNING | Rör inte 0068/0069 eller någon migration; inga nya felkoder eller mappningar i `errorHandler.ts`; ingen rytm-mekanik alls — FR-14:s rytm bärs i v1 av Davids kalender (1E Del 7); inga 1E Del 5-rutter (`/uppdrag/:kod/...`, `.subnav`, nya komponentklasser) — de hör till S10.x; inga `.py`-prov (byggs av sessionen hos Hermes).
uteslutet: spärr eller varning när bedömningen sätts en annan dag än kontraktets rytm — kallan kraver det inte
uteslutet: visning av "nästa bedömningstillfälle" i vyn (rytmen har ingen lagring och ingen läsare i v1) — kallan kraver det inte
uteslutet: `handelse_ref_ids`/`frysta_siffror` som indata (FR-26/FR-32/FR-16 hör till svepets stories) — kallan kraver det inte
uteslutet: AI-förifyllt förslag av läget i vyn — kallan kraver det inte
uteslutet: unik-spärr mot dubbla bedömningar för samma period — kallan kraver det inte
uteslutet: auditrad vid `human_required`-avvisning (Davids nej 6/9, beslut #115) — kallan kraver det inte

---

Två läsnoteringar till utvecklaren: `satt_av_manniska` hårdkodas till `true` i tjänsten i stället för att tas som indata — kolumnen är svaret på "satte en människa den?", och med `kravManniska` är svaret per konstruktion ja; ett indatafält hade återinfört exakt den lögnmöjlighet kolumnen finns för att utesluta. Och CTO:ns analysfråga är besvarad via Davids regelverk: ingen datumspärr och ingen rytm-visning, eftersom 1E Del 7 uttryckligen lämnar rytmen utan både lagring och läsare i v1 — bedömningen kan sättas vilken dag som helst, och det är avsiktligt.
```

## Utfall
Tester: 115 passed (115) · Granskning: GODKANT | Bygget uppfyller KRAV-1–6 exakt enligt husmönstret (write+kravManniska i registret, EN INSERT-tjänst med hårdkodad `satt_av_manniska`, vy via `runViewAction`/actor human enligt `/avtal`-möns · Byggforsok: 1

## Modellkedja (Davids krav 17/8)
Krav+granskning: claude-fable-5 · Utveckling: claude-opus-5 · Claude Code pa Davids abonnemang — inga API-tokens
