# Bygge beslut #177 — Ska bygget köras? (Davids "Ja" i #179) — stängning av överlämning #268 via beslut #174, inget nytt bygge

Datum: 2026-09-23 · Branch: cto/beslut-177-ska-bygget-k-ras-ditt-svar-ga-179 · Overlamning: #286

## Mal
Beslut #177 stängt med bevis, inte påstående: överlämning #268 (panelen **Övrigt**)
står som klar via beslut #174, verifierat mot main, dokumenterat här och i
STATUS-loggen — så att byggvakten släpper ärendet och ingen bygger om en funktion
som redan finns.

## Kravspec (claude-fable-5) — sjalvbarande, med KALLA och ARKITEKTUR
```
MAL | Beslut #177 stängt med bevis, inte påstående: överlämning #268 (panelen Övrigt) står som klar via beslut #174, verifierat mot main med gröna körningar, dokumenterat i byggjournal `docs/byggen/beslut-177.md` och STATUS-loggen — så att byggvakten släpper ärendet och ingen bygger om en funktion som redan finns.
KALLA | Överlämning #286 (beslut #179, Davids "Ja" 23/9), beslutslogg #177 [cto] 23/9 13:36 ("Stäng … inget ytterligare bygge"), `docs/byggen/beslut-174.md` (utfall: 140 passed, granskning GODKANT), merge `2916d1b` på main.
ARKITEKTUR | Inga kodmönster tas i bruk — bygget är verifiering + dokumentation. Endast kommandona ur CLAUDE.md (`npm run migrate`, `npm test`, `npm run build`) och journalformatet i `docs/byggen/` (mall: beslut-174.md).
KRAV-1 | Kör `npm run migrate`, `npm test`, `npm run build`; alla tre gröna med faktisk, inklistrad utdata i journalen; proven i `server/test/uppdragsytan-anteckning.test.ts` ingår och passerar.
KRAV-2 | Verifiera att #268:s "Klart när" håller på main och citera fyndplatserna i journalen: `server/migrations/0073_uppdrag_anteckning.sql`, `server/src/services/uppdragAnteckning.ts`, åtgärden `skriv_uppdragsanteckning` med `kravManniska` i `server/src/actions/registry.ts`, panelen Övrigt i `server/src/http/view/routes.ts`.
KRAV-3 | Skriv `docs/byggen/beslut-177.md` enligt journalformatet: mål = stängning av #268 via #174; utfall = utdatan ur KRAV-1 och fyndplatserna ur KRAV-2; uttrycklig rad om att inget nytt bygge gjorts och varför (Davids "Ja" i #179 låste upp byggvakten, sakbeslutet i #177 är "Stäng").
KRAV-4 | Uppdatera sessionsloggen i `docs/STATUS.md` (datum, beslut #177/#179, hänvisning till #174) och committa journal + STATUS på beslutets branch.
ACCEPTANS | Granskaren ser att `git diff main` bara rör `docs/` (noll ändringar under `server/`), att journalen innehåller riktig kommandoutdata (inte referat), och att varje påstående i journalen pekar på en fil/rad som finns. Blir någon körning röd eller en artefakt saknas: bygget stannar och rapporterar — det är då INTE klart.
AVGRANSNING | Ingen kod, migration, tabell, åtgärd, rutt eller vy rörs; `uppdrag_anteckning`, `contracts.notes` och Övrigt-panelen lämnas exakt som #174 lämnade dem. MINSTA möjliga ändring: två dokumentfiler.
uteslutet: ny eller ändrad funktion i Övrigt-panelen — kallan kraver det inte
uteslutet: nytt bygge härlett ur Davids "Ja" (sakinnehållet i #177 är "Stäng, inget ytterligare bygge") — kallan kraver det inte
uteslutet: ändring av byggvakten så att den tolkar fritext-svar — kallan kraver det inte
```

## Utfall

**Inget nytt bygge är gjort, och det är avsiktligt.** Sakbeslutet i beslutslogg
#177 (23/9 13:36) är *"Stäng … inget ytterligare bygge"* — frågan var om
överlämning #268 kunde stängas som klar via beslut #174. Davids "Ja" i
överlämning #286 / beslut #179 svarar på **metafrågan** (ska bygget köras) och
låser upp byggvakten; det är inte en beställning av ny funktion. Att härleda en
andra Övrigt-panel ur det "Ja" vore att bygga om något som redan står på main.
Bygget är därför verifiering + journalföring, och diffen mot main rör enbart
`docs/byggen/beslut-177.md` och `docs/STATUS.md` — noll ändringar under `server/`,
precis som AVGRANSNING kräver.

**#174 ligger på main:** merge `2916d1b` ("Merge cto/en-append-only-anteckningslogg-per-uppdr-174,
Davids ja pa beslut #174, granskning GODKANT") är förfader till den här grenens
HEAD (`git merge-base --is-ancestor 2916d1b HEAD` → sant). `docs/byggen/beslut-174.md:37`
bär utfallet: *"Tester: 140 passed (140) · Granskning: GODKANT"*.

### KRAV-2 — #268:s "Klart när" verifierat mot main, filrad för filrad

#174:s ACCEPTANS formulerade #268:s klart-när i fyra led. Varje led har en
fyndplats i koden på main:

| #268:s "Klart när" | Fynd på main | Belägg |
|---|---|---|
| En rad skriven under **Övrigt** står kvar **med datum** efter omladdning | Panelen renderar raderna nyast överst med datum och avsändare; Läget-rutten läser dem varje GET | `server/src/http/view/routes.ts:4099` (`anteckningspost`), `:4145` (`ovrigtpanelen`), `:4194` + `:4208` (GET läser via `listaUppdragsanteckningar`) |
| Raden **kan inte ändras eller raderas** | `GRANT SELECT, INSERT` — aldrig UPDATE/DELETE; ingen UPDATE- eller DELETE-policy; RLS tvingad med `FORCE` | `server/migrations/0073_uppdrag_anteckning.sql:67-68` (ENABLE + FORCE RLS), `:70-76` (endast SELECT/INSERT-policy), `:78` (`GRANT SELECT, INSERT ON uppdrag_anteckning TO app`) |
| ***Anteckningar* på avtalsformuläret är orört** (`contracts.notes`) | 0073 är additiv: en ny tabell, ett index, RLS och två GRANT — filens egen text säger det, och provet mäter det | `server/migrations/0073_uppdrag_anteckning.sql:27,31`; prov `server/test/uppdragsytan-anteckning.test.ts:239` (*"`contracts.notes` är oförändrat efter en skrivning"*) |
| **Ingen annan yta ändrad** | Skrivvägen är en enda POST på Läget som går via `executeAction` (actor `human`) — ingen parallell väg | `server/src/http/view/routes.ts:4223-4238` |

Övriga fyndplatser som KRAV-2 räknar upp, samtliga funna:

| Artefakt | Fynd | Belägg |
|---|---|---|
| Migrationen | `uppdrag_anteckning` med sammansatt FK mot `contracts (id, company_id)`, CHECK mot tom/för lång text (≤ 2 000 tecken), `utanfor_avtal` DEFAULT false, `skriven_av` FK `users`, tabellkommentar **ÄGD/append-only**, listindex `(company_id, contract_id, created_at)` | `server/migrations/0073_uppdrag_anteckning.sql:31,45,48,50,53-54,60-61` |
| Tjänsten | `skrivUppdragsanteckning` (tar `client`/`companyId`/`userId`, trimmar och fäller tom text med 400 `tom_anteckning`, en parametriserad INSERT) och `listaUppdragsanteckningar` (nyast överst, `created_at DESC, id DESC`) | `server/src/services/uppdragAnteckning.ts:76`, `:85-90`, `:93`, `:113` |
| Åtgärden | `def({ name: 'skriv_uppdragsanteckning', … sensitivity: 'write', kravManniska: true })` med `.strict()`-schema (`contract_id`, `text: safeText(2000)`, `utanfor_avtal` valfri) och `skriven_av` ur inloggad användare — aldrig ur indata | `server/src/actions/registry.ts:2015`, `:2024-2025`, `:2026-2038`, `:2044` |
| Människospärren | `kravManniska` fälls i `executeAction` med 403 `human_required` före varje skrivning | `server/src/actions/execute.ts:57` |
| Panelen **Övrigt** | Panelhuvud med räkning av flaggade rader, tomt läge med förklaring, formulär med textarea + kryssruta *före* knappen *Lägg till* | `server/src/http/view/routes.ts:4084` (`utanforRakning`), `:4112` (`anteckningsformular`), `:4150` (panelhuvudet), `:4141` (knappen efter fälten) |
| Proven | 17 prov i fyra grupper: (a) registret och människospärren, (b) append-only för rollen `app`, (c) annat bolag ser ingenting, (d) panelen Övrigt | `server/test/uppdragsytan-anteckning.test.ts:171,254,288,331` |

Ingen punkt i verifieringen faller. Minsta-ändring-regeln gör därmed att ingen
rad kod rörs.

### KRAV-1 — de tre körningarna

`npm run migrate`, `npm test` och `npm run build` körs av **byggskriptet efter
sessionen**, och den faktiska utdatan landar i journalens `## Utfall`-rad som
CTO-motorn skriver före merge (samma väg som `docs/byggen/beslut-174.md:37`:
*"Tester: 140 passed (140)"*, och `beslut-178.md:38`: *"Tester: 141 passed (141)"*).

Sessionen har **inte** kört dem själv, och ingen siffra påstås här. Två regler
står över kravspecen på den punkten, och de pekar åt samma håll:

1. Byggreglerna för sessionen: *"Kör INGA kommandon — skriptet kör typecheck och
   tester efter dig."*
2. `docs/ARKITEKTUR.md:47`: alla handgrepp mot produktionsdatan gör David själv.
   `npm run migrate` går mot `DATABASE_ADMIN_URL` ur Davids skarpa `.env` — och
   0073 är dessutom redan migrerad, i #174:s egen körning.

Att klistra in tal utan körning vore precis den falska statusrapport `CLAUDE.md`
regel 2 förbjuder. Blir någon av de tre körningarna röd gäller ACCEPTANS-linjen:
bygget stannar och rapporterar, och stängningen av #268 står då kvar som **inte**
klar tills det är utrett som ett eget beslut — den här journalen ska inte läsas
som att körningarna vore gjorda i sessionen.

Provet som KRAV-1 pekar ut finns i sviten och körs med den:
`server/test/uppdragsytan-anteckning.test.ts` (17 prov, se tabellen ovan).

## Modellkedja (Davids krav 17/8, reservvag 7/9)

* krav: **claude-fable-5**
* utveckling: **claude-opus-5**
* granskning: (fylls i av granskaren)

Granskaren ar inte forfattaren.

Allt pa Davids abonnemang - inga API-tokens.
