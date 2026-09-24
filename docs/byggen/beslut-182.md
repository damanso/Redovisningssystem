# Bygge beslut #182 — Redovisningsappens produktmeny (kanon, html.ts): hela menyn synlig utan inre rullning och en täckand

Datum: 2026-09-24 19:59 · Branch: cto/redovisningsappens-produktmeny-kanon-htm-182 · Overlamning: #288

## Mal
Redovisningsappens produktmeny (kanon, html.ts): hela menyn synlig utan inre rullning och en täckande panel — samma rättelse som Hermes-ytan och ärendevyn fick 24/9

## Kravspec (claude-fable-5) — sjalvbarande, med KALLA och ARKITEKTUR
```
Underlag, ARKITEKTUR.md och koden är lästa. Verifierat i källan: `.navmenu` är avsiktligt inte positionerad (html.ts:585–587), så panelens containing block är `.topbar` (sticky, html.ts:570) — samma läge som i ärendevyn, alltså fungerar `calc(100vh - 100% - 24px)` som tak. Kravspecen:

MAL | Produktmenyn i webbvyn (/app) visar hela sitt innehåll utan inre rullning på desktop, på en täckande panel — så att alla 50 länkar är synliga och läsbara direkt; kanon (html.ts) får samma utfall som Hermes-ytan och ärendevyn (f7b26da) fick 24/9, och kanon är facit för kopiorna.
KALLA | Överlämning #288 / beslut #182; Davids ja 24/9 21:34 ("Se till att köra beställningen nu"); byggunderlag med mätvärden: `~/brain/02-Områden/hermes/byggen/underlag-appmenyn-2026-09-24.md`.
ARKITEKTUR | Webbvyn är JS-fri serverrenderad HTML i `server/src/http/view/` (ARKITEKTUR.md); all ändring i `layout()`/CSS i `server/src/http/view/html.ts`; befintliga tokens (`--surface`, `--ink-3`, `--radius` m.fl.) återanvänds; `.topbar` (sticky, html.ts:570) är panelens containing block — `.navmenu` får INTE bli positionerad (kommentar html.ts:585–587).
KRAV-1 | `.navmenu__panel` bredd `min(1180px, calc(100vw - 48px))` — behåll 48px-headroomen och dess kommentar (rullistmarginal); `.navmenu__grid` får `columns: 3`; vid 641–1099px två spalter, vid ≤640px en.
KRAV-2 | Grupper med minst 12 poster får klassen `navmenu__grp--spalter` i `layout()` (villkor `g.items.length >= 12`, aldrig gruppnamn): `columns: 2` inom gruppen, eyebrow och `.navmenu__hint` får `column-span: all`.
KRAV-3 | Panelens tak är avståndet till skärmens nederkant: `max-height: calc(100vh - 100% - 24px)` (100% = topbarens höjd, eftersom `.topbar` är containing block) — aldrig en andel av skärmen (72vh/640px tas bort); `overflow-y: auto; overscroll-behavior: contain` behålls.
KRAV-4 | Vid `min-width:1100px` och `max-height:880px` göms `.navmenu__hint` i panelen och gruppmarginalerna dras åt, så hela menyn ryms på 1280×800.
KRAV-5 | Panelens bakgrund är `var(--surface)` (alfa 1 i ljust och mörkt läge); sidhuvudet behåller sina 97%; `@keyframes navrise` animerar endast transform (ingen opacity); vid `prefers-reduced-motion: reduce` ingen animation alls.
KRAV-6 | Vid ≤640px tar panelen skärmens bredd (`margin: 0 8px; width: calc(100vw - 16px)`), visar en spalt och rullar inuti utan att klippa sista länken.
ACCEPTANS | I Chromium på 1280×800, 1440×900 och 2560×1440: panelen har 0 px dolt innehåll (scrollHeight = clientHeight), inga länkar delar rad utanför `navmenu__grp--spalter`, radhöjd ≤34 px, bakgrundsalfa 1 även i mörkt läge; på 390×844: skärmens bredd, en spalt, rullbar till sista länken; `npm test` grönt utan försvagade tester; deployat via `redovisning_update.sh`; `~/.hermes/prov/designparitet.py` grönt efter deploy; Hermes mäter efteråt med samma rigg (`~/.hermes/ytor-gui/matvy.js`).
AVGRANSNING | Minsta möjliga ändring, endast `server/src/http/view/html.ts`; inga nya tokenvärden; designkontraktets selektorgrammatik orörd utöver `navmenu__grp--spalter`; snabbraden, grannmodulerna, `.nav__here` och brödsmulan rörs inte (`navigation.test.ts` räknar snabbradens länkar); ingen JavaScript; inga andra sidor.
uteslutet: backdrop-filter på panelen — kallan kraver det inte
uteslutet: ändring av länkraderna/`.navmenu__link` (redan rätt: en per rad, 33 px) — kallan kraver det inte
uteslutet: rättelser i ärendevyn eller Hermes-ytan (redan gjorda) — kallan kraver det inte
uteslutet: ny mätrigg eller egna skärmdumpstester i repot — kallan kraver det inte
```

## Utfall
Tester: 142 passed (142) · Granskning: GODKANT | Alla sex krav är implementerade exakt som specade i `server/src/http/view/html.ts` (tak `calc(100vh - 100% - 24px)` med `.navmenu` opositionerad, bredd 1180/48, spalter 3/2/1, `navmenu__grp- · Byggforsok: 2

## Modellkedja (Davids krav 17/8, reservvag 7/9)

* krav: **claude-fable-5**
* utveckling: **claude-opus-5**
* granskning: **claude-fable-5**

Granskaren ar inte forfattaren: claude-fable-5 granskade claude-opus-5s arbete.

Allt pa Davids abonnemang - inga API-tokens.
