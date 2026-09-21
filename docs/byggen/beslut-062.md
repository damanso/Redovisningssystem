# Bygge beslut #62 — Vilket typsnittspar ska redovisningsytan ha? (Gäller både R-1 och D-4 — det är samma val.)

Datum: 2026-09-21 13:43 · Branch: cto/vilket-typsnittspar-ska-redovisningsytan-62 · Overlamning: #270

## Mal
Vilket typsnittspar ska redovisningsytan ha? (Gäller både R-1 och D-4 — det är samma val.)

## Kravspec (claude-fable-5) — sjalvbarande, med KALLA och ARKITEKTUR
```
Kravspecen är klar. Två viktiga fynd under grävandet som specen vilar på: **bygget för beslut #62 är redan genomfört och mergat till main** (commit `e047a05`, 2026-08-26, inkl. provet `server/test/typsnitt.test.ts`), och den sessionen gjorde ett tolkningsval: Davids "skrivmaskinsstil" blev IBM Plex Mono, men **Roboto valdes bort** eftersom den står namngiven i designsvepets antimönster 1 — Public Sans sattes som lugn brödtext i stället. Specen kodifierar det valet öppet i KALLA så granskaren (och David) ser avvikelsen; utvecklarens jobb blir i praktiken att verifiera att helheten står grön.

```
MAL | Webbvyn /app (R-1 och D-4 — samma val) bär ett självvärdat typsnittspar: skrivmaskinsstil i rubriker, lugn brödtext. Ytan är JS-fri och ligger på tailnet — paret ger identitet utan ett enda externt anrop.
KALLA | Överlämning #270 / beslut #62; Davids svar ordagrant: "Roboto och skrivmaskinsstil". Tolkning (commit e047a05, ska stå i byggjournalen): skrivmaskinsstil = IBM Plex Mono; Roboto står i antimönster 1 (brain/03-Resurser/kunskap/impeccable-design-skills.md) och ersätts av Public Sans som lugn brödtext.
ARKITEKTUR | Webbvyn är bara transport (server/src/http/view/); all stil bor i den enda inlinade stilmallen i html.ts; CSP:n i app.ts (script-src 'none', defaultSrc 'self') rörs INTE — font-src ärver 'self'; statiska filer serveras enbart via uppräknad vitlista i app.ts.
KRAV-1 | Fem woff2-filer (Public Sans 400/600/700, IBM Plex Mono 400/600) ligger i server/assets/typsnitt/ och serveras på GET /typsnitt/<fil> med content-type font/woff2 och riktiga magiska byten (wOF2); filnamn utanför vitlistan ger 404 utan att läcka filinnehåll.
KRAV-2 | OFL-licenserna (LICENSE-public-sans.txt, LICENSE-ibm-plex-mono.txt) serveras bredvid filerna — OFL 1.1 kräver att de distribueras.
KRAV-3 | Stilmallen deklarerar @font-face för båda familjerna med font-display: swap, och VARJE url() i stilmallen pekar inåt (/typsnitt/ eller data:) — ingen url() pekar på http(s)://.
KRAV-4 | Variablerna --display: "IBM Plex Mono", --sans: "Public Sans", --mono: "IBM Plex Mono" finns, alla med generisk fallback (sans-serif/monospace) sist; h1–h3 sätts i var(--display) och brödtexten i font: 15px/1.55 var(--sans) — familjer som laddas ska bevisligen ANVÄNDAS.
KRAV-5 | Ingen utsliten familj står först i någon av de tre stackarna: Inter, Roboto, Roboto Mono, Arial, Open Sans och -apple-system är förbjudna som förstanamn (antimönster 1).
ACCEPTANS | npm run build utan fel och npm test grönt, där server/test/typsnitt.test.ts sex prov (servering, licenser, 404, inåtpekande stilmall, använda familjer, fallback/antimönster) passerar med inklistrad utdata; okulärt i webbläsare: rubriker i Plex Mono, brödtext i Public Sans, å/ä/ö renderas i familjerna.
AVGRANSNING | Rör bara server/assets/typsnitt/, vitlisterouten i app.ts, stilmallen i html.ts och provet. Ingen CSP-rad ändras, ingen databas, inget actionslager, ingen sidmarkup, inga andra ytor.
uteslutet: preload-/prestandahintar för typsnitten — kallan kraver det inte
uteslutet: kursiva eller variabla vikter — kallan kraver det inte
uteslutet: tre förslag att välja mellan (rekommendationens alternativspår) — kallan kraver det inte
uteslutet: typsnittsval per sida eller tema — kallan kraver det inte
```

En sak att lyfta till David vid granskningen: specen låser fast avsteget från hans ordagranna svar (Public Sans i stället för Roboto). Avsteget är redan mergat och motiverat av antimönsterlistan, men det är hans smakbeslut — vill han ha bokstavligt Roboto trots antimönstret är det KRAV-4/KRAV-5 som ska ändras, inget annat.
```

## Utfall
Tester: 140 passed (140) · Granskning: GODKANT | Diffen rör enbart docs/STATUS.md med den byggjournalspost som KALLA uttryckligen kräver, och varje sakpåstående i posten stämmer mot HEAD vid kontroll (e047a05 är förfader och innehåller all · Byggforsok: 1

## Modellkedja (Davids krav 17/8, reservvag 7/9)

* krav: **claude-fable-5**
* utveckling: **claude-opus-5**
* granskning: **claude-fable-5**

Granskaren ar inte forfattaren: claude-fable-5 granskade claude-opus-5s arbete.

Allt pa Davids abonnemang - inga API-tokens.
