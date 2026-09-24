# Bygge beslut #183 — Följdbygge till #182 — redovisningsappens meny: 13 px dolt på 1440×900 och 26 px på 1280×800 kvar ef

Datum: 2026-09-24 20:15 · Branch: cto/f-ljdbygge-till-182-redovisningsappens-m-183 · Overlamning: #289

## Mal
Följdbygge till #182 — redovisningsappens meny: 13 px dolt på 1440×900 och 26 px på 1280×800 kvar efter deploy; klart-kriteriet 0 px är inte nått

## Kravspec (claude-fable-5) — sjalvbarande, med KALLA och ARKITEKTUR
```
Jag har grävt klart: overlämningens tre mått stämmer mot koden (`server/src/http/view/html.ts:655`, `:669`, `:670–674`, `:688–691` — länken saknar egen line-height och ärver 1.55, gruppen har `margin: 0 0 17px`, hinten `margin-bottom: 7px`, medieregeln `11px`). Viktigt fynd som källan inte nämner: `server/test/appmenyn-hel.test.ts:194` låser fast det GAMLA värdet `margin-bottom: 11px` i medieblocket — det testet måste följa med till 9 px, annars blir bygget rött. `oskarpa.test.ts`/`navigation.test.ts` asserterar inget av de tre måtten och kan stå orörda, precis som källan kräver.

Kravspecen:

```
MAL | Menypanelen i webbvyn (/app) rymmer HELA menyn utan inre rullning även på 1440×900 och 1280×800 — #182:s klart-kriterium (0 px dolt på alla tre skärmarna) nås genom att kanon får samma tre mått som kopiorna (Hermes-ytan, ärendevyn f7b26da) där de bevisat ger 0 px.
KALLA | Överlämning #289 / beslut #183 (följdbygge inom #182:s beställning, Davids ja 24/9 21:34); Hermes mätning efter release 20260924T195938Z-9eea6ae: 13 px dolt på 1440×900, 26 px på 1280×800, 0 px på 2560×1440; underlag ~/brain/02-Områden/hermes/byggen/underlag-appmenyn-2026-09-24.md.
ARKITEKTUR | Webbvyn är JS-fri serverrenderad HTML i server/src/http/view/ (ARKITEKTUR.md); all ändring i CSS-mallsträngen i server/src/http/view/html.ts; .navmenu förblir opositionerad så .topbar är containing block och taket calc(100vh - 100% - 24px) fungerar; tester i vitest som läser den renderade CSS:en (appmenyn-hel.test.ts-mönstret).
KRAV-1 | .navmenu__link (html.ts:670) får line-height: 1.3 (i dag ärvd 1.55 → 33 px rad); beräknad radhöjd ≤34 px.
KRAV-2 | .navmenu__grp (html.ts:655) får margin 0 0 11px (i dag 17px).
KRAV-3 | I medieregeln @media (min-width:1100px) and (max-height:880px) (html.ts:688) får .navmenu__grp margin-bottom: 9px (i dag 11px); hint-döljningen där står kvar.
KRAV-4 | .navmenu__hint (html.ts:669) får margin: 0 0 4px och line-height: 1.35 (i dag margin-bottom: 7px, ärvd line-height).
KRAV-5 | appmenyn-hel.test.ts:194 uppdateras att kräva det NYA värdet margin-bottom: 9px i medieblocket (skärpning till nya mått, ingen försvagning); oskarpa.test.ts och navigation.test.ts ändras inte och passerar.
KRAV-6 | Inga backticks i CSS-kommentarer — stilmallen är en JS-mallsträng (#182 föll på det en gång).
ACCEPTANS | I Chromium på 1280×800, 1440×900 och 2560×1440: menypanelen har 0 px dolt innehåll (scrollHeight = clientHeight) i både ljust och mörkt läge, radhöjd ≤34 px, fortfarande 0 delade rader och bakgrundsalfa 1; npm test grönt utan försvagade tester; deployat via redovisning_update.sh; Hermes mäter efteråt med samma rigg (~/.hermes/ytor-gui/matvy.js, 50 länkar, appens origin).
AVGRANSNING | Minsta möjliga ändring: endast de tre måtten i server/src/http/view/html.ts plus testvärdet i KRAV-5; allt från #182 står orört — taket calc(100vh - 100% - 24px), bredden min(1180px, calc(100vw - 48px)), spalterna 3/2/1, navmenu__grp--spalter-villkoret (>= 12 poster), bakgrunden var(--surface), navrise-animationen; .navmenu förblir opositionerad; ingen JavaScript; inga andra sidor eller selektorer.
uteslutet: sänka kanons sidhuvud (128 px) för att höja taket — kallan kraver det inte
uteslutet: 1 px transparent kant på länkarna som kopiorna har — kallan kraver det inte
uteslutet: gömma hintarna även på höga skärmar — kallan kraver det inte
uteslutet: rättelser i Hermes-ytan eller ärendevyn (redan gröna) — kallan kraver det inte
uteslutet: ny mätrigg eller skärmdumpstester i repot — kallan kraver det inte
```

Specen är självbärande: utvecklaren får exakta radnummer, nuvarande värden, målvärden och det enda test som annars hade fällt bygget, utan att behöva läsa överlämningen eller kopiornas kod.
```

## Utfall
Tester: 142 passed (142) · Granskning: GODKANT | Alla sex krav är uppfyllda exakt på de utpekade raderna (line-height 1.3, margin 0 0 11px, 9px i medieblocket, hintens 0 0 4px/1.35), testvärdet skärpt utan försvagning, inga backticks i mal · Byggforsok: 1

## Modellkedja (Davids krav 17/8, reservvag 7/9)

* krav: **claude-fable-5**
* utveckling: **claude-opus-5**
* granskning: **claude-fable-5**

Granskaren ar inte forfattaren: claude-fable-5 granskade claude-opus-5s arbete.

Allt pa Davids abonnemang - inga API-tokens.
