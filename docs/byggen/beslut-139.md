# Bygge beslut #139 — Sista storyn S10.7: uppdragsytan sist i `.nav__quick`, 1D:s elva komponentklassnamn som riktiga CSS-

Datum: 2026-09-07 04:21 · Branch: cto/sista-storyn-s10-7-uppdragsytan-sist-i-n-139 · Overlamning: #139

## Mal
Sista storyn S10.7: uppdragsytan sist i `.nav__quick`, 1D:s elva komponentklassnamn som riktiga CSS-regler i vyerna, samt en GET-endast läsväg så designparitet.py kan läsa uppdragsvyn med agent-token — subnaven med sex länkar och en `aria-current` per nav finns redan byggd (routes.ts:3572).

## Kravspec (claude-fable-5) — sjalvbarande, med KALLA och ARKITEKTUR
```
Faktabilden är komplett. Verkligheten avviker från överlämningen på två punkter som specen förankrar i huset: subnaven har i dag **nio** poster (inte sex — Avtal, Bedömning, Signaler ligger också där, routes.ts:3549), och husets tenant-spärr ger **404, aldrig 403** (companyAccess.ts:9–31, "läcker inte existens"). Brädan i Leveranserna är i dag byggd med inline-style utan klass alls (routes.ts:4157). Här är kravspecen:

---

MAL | Uppdragsytan nås sist i huvudmenyns snabbrad, 1D:s elva komponentklassnamn finns som riktiga CSS-regler som vyerna S10.1–S10.6 använder, och uppdragsvyn kan läsas med agent-token — S10.7 är mätpunkten som gör våg 1–7 verifierbara för designparitet.py.
KALLA | Överlämning #139 (story S10.7 ur 1F, 1E FR-21/FR-38/FR-39, 1D Del 5), Davids ja 2026-09-07, mandat 3/9 och 5/9, 1G godkänd 2026-09-05, Linear LOC-413.
ARKITEKTUR | Webbvyn (`server/src/http/view/`) är transport med JS-fri HTML; tenant-spärren speglar API:ts `requireCompanyAccess` (companyAccess.ts:30 — agentens `scopedCompanyId`, gemener, mot URL:ens bolag; fel bolag → 404, aldrig 403); vitest+supertest mot riktig Postgres; inga nya beroenden.
KRAV-1 | `'projects'` läggs SIST i `NAV_QUICK` (html.ts:422, efter `'receipts'`); de fem befintliga posterna orörda i oförändrad ordning. Etiketten "Projekt" finns redan i `NAV_GROUPS` (html.ts:378) — ingen ny etikett, inga emoji, ingen ny stil.
KRAV-2 | Exakt EN `aria-current="page"` per navigation: `.nav` sätter den redan via `link()` (html.ts:1480) och `.subnav` via `subnav()` (routes.ts:3576) — verifieras med test, byggs inte om.
KRAV-3 | De sju saknade klassnamnen `.handgrepp` `.stapel--baseline` `.milstolpe` `.brada` `.brada__kol` `.leverabelkort` `.harledning` införs som riktiga CSS-regler i html.ts med kanons tokens (inga tomma alias-regler); `.tidslinje` `.stapel` `.pengarad` `.farskhet` finns redan (html.ts:864, 897, 1304, 1315).
KRAV-4 | Vyernas befintliga element får 1D-namnen: Leveransernas bräda/kolumner/kort (`bradlage`/`bradkolumn`, routes.ts:4157 — i dag inline-style utan klass) → `.brada`/`.brada__kol`/`.leverabelkort`; Planens baselinestapel och milstolpar → `.stapel--baseline`/`.milstolpe`; Lägets handgreppsband (routes.ts:3635) → `.handgrepp`; Pengarnas härledningsrad → `.harledning`. Gammalt namn behålls bara där något annat i huset redan använder det. `.stapel[data-arvd]` med `data-precision` förblir attribut, ingen klass.
KRAV-5 | GET-läsväg i view/auth.ts: giltig `Authorization: Bearer` agent-token (samma JWT som API:t) ger rendering av uppdragsytans GET-sidor under `/app/c/:companyId/projects/...` när tokenens `scopedCompanyId` (gemener) är URL:ens bolag; annat bolag → 404; ingen cookie sätts någonsin; POST-rutter nås aldrig som agent; ogiltig/saknad token → inloggningsomdirigering exakt som i dag (auth.ts:128–151). Minsta läsande variant (viewAuth avvisar agent i dag, auth.ts:140); vägvalet dokumenteras i docs/STATUS.md.
KRAV-6 | Vitest: (a) `.nav__quick` renderar med uppdragsytan sist och `.subnav` innehåller de sex S10-länkarna Läget/Planen/Leveranserna/Pengarna/Rapporterna/Kontraktet med exakt en `aria-current` per nav; (b) alla elva selektorer finns i den levererade stilmallen (samma räkning som designparitet.py: selektorn förekommer i CSS:en); (c) GET på Läget med agent-token → 200 med `<nav class="nav"` och `<nav class="subnav"`, utan token → inloggningssidan, med annat bolags id → 404.
KRAV-7 | Utanför repot, samma våg, av sessionen (inte motorn): designparitet.py (~/.hermes/prov/) får mätpunkten med agent-token, per-nav-mätning och de elva klassnamnen; klassnamnen skrivs in i designkontraktet i vaulten.
ACCEPTANS | `npm run build` och `npm test` gröna med inklistrad utdata; KRAV-6:s tre tester finns och passerar; alla elva selektorer greppbara i html.ts och inga kvarlämnade dubbletter av utbytta namn i S10-vyerna; en rad i docs/STATUS.md:s sessionslogg; committat och pushat.
AVGRANSNING | Inga nya vyer, åtgärder, migrationer eller beroenden; ingen JS; de tre husens gemensamma tokens orörda; docs/MCP_ACTIONS.md orörd; API-autentiseringen (`authenticate.ts`) orörd; subnavens nio befintliga poster (även Avtal/Bedömning/Signaler, routes.ts:3549) står kvar i sin ordning.
uteslutet: krympa subnaven till exakt sex poster — källan kräver det inte
uteslutet: auditrad för agent-läsning i vyn — källan kräver det inte
uteslutet: återanvända API:ts authenticate-mellanvara rakt av — källan kräver det inte (JSON-fel i stället för omdirigering, ingen tenantkoppling i vyn)
uteslutet: agent-läsning av andra vysidor än uppdragsytans — källan kräver det inte
uteslutet: 403-svar vid fel bolag — källan kräver det inte (huset svarar 404 för att inte läcka existens, companyAccess.ts:9)

---

Tre medvetna förankringar mot verkligheten, där överlämningen och koden skilde sig: subnaven har redan nio länkar så testet kräver att de sex S10-länkarna *finns*, inte att de är ensamma (Davids regel 1 — bygg inte mer, dvs. riv inte heller); "404/403" ur överlämningen blev enbart 404 (Davids regel 2 — huset gäller); och `.brada`-familjen är inte ett namnbyte utan ett förstagångsnamn, eftersom brädan i dag saknar klass helt.
```

## Utfall
Tester: 134 passed (134) · Granskning: GODKANT | Bygget håller sig exakt inom kravspecen — `'projects'` sist i `NAV_QUICK`, de sju klassreglerna med husets tokens, 1D-namnen på befintliga element utan kvarlämnad inline-stil, och agentens l · Byggforsok: 1

## Modellkedja (Davids krav 17/8)
Krav+granskning: claude-fable-5 · Utveckling: claude-opus-5 · Claude Code pa Davids abonnemang — inga API-tokens
