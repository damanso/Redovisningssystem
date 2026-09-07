# Bygge beslut #142 — Undermenyn `.subnav` renderas via befintliga `subnav()` även på projektsidan, Avtal, Bedömning och S

Datum: 2026-09-07 08:09 · Branch: cto/undermenyn-subnav-renderas-via-befintlig-142 · Overlamning: #142

## Mal
Undermenyn `.subnav` renderas via befintliga `subnav()` även på projektsidan, Avtal, Bedömning och Signaler (villkorat på att projektet har ett uppdrag), med ny första post "Projektet", plus utökade vitest och en STATUS-rad.

## Kravspec (claude-fable-5) — sjalvbarande, med KALLA och ARKITEKTUR
```
Jag har verifierat underlaget mot koden: `subnav()`/UPPDRAGSSIDOR finns på routes.ts:3574/3551, projektsidan (1654), avtal (2129), bedömning (2695) och signaler (2992) anropar den inte, `signalunderlag`/`bedomningsunderlag` läser redan `listContracts` i samma transaktion, och uppdragsytan-signaler.test.ts:443 kräver i dag `not.toContain('class="subnav"')`. Här är kravspecen:

---

MAL | Undermenyn `.subnav` syns på ALLA uppdragets sidor — även projektsidan (ingången från Projekt-listan), Avtal, Bedömning och Signaler — så att vägen Projekt → projektet har en meny också på telefon (≤700 px döljer `.nav__quick`) och de tre äldre sidorna slutar vara återvändsgränder i en meny de själva saknar. Rättelse av S10.7, Davids ord 7/9: "Undermenyn är inte implementerad".
KALLA | Överlämning #142 (S10.8) + Davids ja 2026-09-07 inkl. ja på testfrågan; beslut #139 (S10.7); designkontraktet "subnav på varje uppdragssida, EN aria-current per nav"; Linear LOC-417.
ARKITEKTUR | Uppdragsytan är en modul i samma vyrouter (ARKITEKTUR.md "Uppdragsytan (modul)"); all läsning i sidans befintliga `withTenantTransaction`; befintliga `subnav()`/`UPPDRAGSSIDOR` (server/src/http/view/routes.ts:3574/3551) återanvänds — ingen kopia, inga nya klassnamn (kontraktets elva står).
KRAV-1 | `UPPDRAGSSIDOR` får en ny FÖRSTA post med etikett "Projektet" som pekar på `/app/c/:companyId/projects/:projectId`; de nio befintliga posterna behåller sin ordning efter den. `subnav()` sätter `aria-current="page"` på exakt EN post per rendering.
KRAV-2 | Projektsidan (routes.ts:1654), avtal (2129), bedomning (2695) och signaler (2992) renderar `subnav()` när projektet har minst ett avtal; uppslaget är husets `listContracts(client, companyId, { project_id })` läst i sidans egen transaktion (bedomning/signaler bär redan `avtal` i sitt underlag) — ingen ny tjänst, inget uppslag ur request-body.
KRAV-3 | Ett projekt utan avtal renderar ingen subnav på projektsidan; knappband och övrigt innehåll oförändrade ("länkar som förut").
KRAV-4 | Aria-current sitter på "Projektet" på projektsidan och på respektive post på avtal/bedomning/signaler.
KRAV-5 | `server/test/uppdragsytan-menyn.test.ts` utökas (ingen ny fil): (a) de fyra sidorna renderar för ett projekt med uppdrag `<nav class="subnav"` med exakt en aria-current, på projektsidan posten "Projektet"; (b) projekt utan avtal → ingen subnav på projektsidan; (c) alla tio rutter i UPPDRAGSSIDOR svarar 200 för ett projekt med uppdrag.
KRAV-6 | `server/test/uppdragsytan-signaler.test.ts:443` (`expect(html).not.toContain('class="subnav"')`) ändras öppet till att kräva subnav — det kodifierade S5.1-läget som S10.8 rättar; ändringen redovisas i byggjournalen.
KRAV-7 | docs/STATUS.md får en sessionsloggrad (uppdragsytan S10.8, rättelse av S10.7 — undermenyn på projektsidan och de tre äldre sidorna).
ACCEPTANS | `npm run build` och `npm test` gröna med riktig, inklistrad utdata (inga falska statusrapporter); efter deploy verifierar sessionen med agent-token att GET `/app/c/<bolag>/projects/<id>` bär `class="subnav"` med tio länkar och EN aria-current; docs/MCP_ACTIONS.md orörd.
AVGRANSNING | Endast `server/src/http/view/routes.ts`, `server/test/uppdragsytan-menyn.test.ts`, den öppna raden i `uppdragsytan-signaler.test.ts` samt docs/STATUS.md. Inga migrationer, ingen CSS, ingen JS, inga nya klassnamn, inga emoji i menyn, ingen ändring av `.nav__quick`/helmenyn eller projektsidans innehåll.
uteslutet: villkora subnav på de sex befintliga S10-sidorna — kallan kraver det inte
uteslutet: villkora knappbandet (Läget m.fl.) på har-uppdrag — kallan kraver det inte
uteslutet: egen tjänst eller endpoint för "har projektet ett uppdrag" — kallan kraver det inte
uteslutet: ändring av designparitet.py (mätpunkten är Läget, SUBNAV_MINST 6 håller) — kallan kraver det inte
uteslutet: ny testfil för menytesterna — kallan kraver det inte
uteslutet: extra rotdelsfiltrering utöver husets listContracts-uppslag — kallan kraver det inte
```

## Utfall
Tester: 134 passed (134) · Granskning: GODKANT | Alla sju krav uppfyllda inom avgränsningen — tio poster med "Projektet" först, subnav via befintliga `subnav()`/`listContracts` i sidans transaktion, villkorslös meny på de sex S10-sidorna p · Byggforsok: 2

## Modellkedja (Davids krav 17/8)
Krav+granskning: claude-fable-5 · Utveckling: claude-opus-5 · Claude Code pa Davids abonnemang — inga API-tokens
