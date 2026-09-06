# Bygge beslut #131 — Registerläsningen får en härledd kolumn "dagar i läget" beräknad ur senaste raden i append-only-tabe

Datum: 2026-09-06 22:14 · Branch: cto/registerl-sningen-f-r-en-h-rledd-kolumn-131 · Overlamning: #131

## Mal
Registerläsningen får en härledd kolumn "dagar i läget" beräknad ur senaste raden i append-only-tabellen `uppdrag_leverabel_handelse` — ingen ny lagring.

## Kravspec (claude-fable-5) — sjalvbarande, med KALLA och ARKITEKTUR
```
Underlaget stämmer mot koden med ett viktigt undantag som jag verifierat: **registervyn i `http/view/routes.ts` finns inte** — den uteslöts uttryckligen i S3.1 på Davids beslut (byggjournal beslut-121, rad 26) och kommentaren i `routes.ts:1467-1468` bekräftar att den fortfarande saknas. Överlämningens story och acceptans kräver bara att "registret läses" ger åldern plus vitest-provet — det bärs av läsvägen `lasLeverabelregister` (tjänst + befintlig read-åtgärd `las_leverabelregister`), utan någon ny vy. Enligt Davids regel 1 byggs exakt överlämningen, inte mer. Övrigt verifierat: händelsetabellen finns i `0068:132-150` (append-only, SELECT+INSERT), importen skriver aldrig händelser (bara `uppdragStatus.ts` gör det) så fallbacken behövs, `uppdrag_leverabel.created_at` finns (`0068:122`), och schematestet mot `status_sedan` ligger redan i `uppdragsytan-schema.test.ts:92`.

---

MAL | Registerläsningen svarar med `dagar_i_laget` per leverabel — hela dagar sedan senaste raden i append-only-tabellen `uppdrag_leverabel_handelse` — så att den som läser registret ser hur länge en leverabel stått still (FR-37) utan att en muterbar kolumn någonsin kan drifta ifrån historiken (0068:131: "status utan historik är en gissning").
KALLA | Överlämning #131 (story S3.3 ur 1F, våg 5), CTO-underlaget med Davids ja 2026-09-06 (inkl. RISK-fallbacken till `created_at`), Davids analysregler 6/9 (regel 1: exakt överlämningen; regel 2: huset gäller), 1E Del 3 / `0068_uppdragsytan.sql:132-150`, PRD FR-37.
ARKITEKTUR | Enbart befintliga mönster: tjänstelagret (`client: PoolClient` + `companyId` under `withTenantTransaction`), den redan registrerade read-åtgärden `las_leverabelregister` (registry.ts:1640 — orörd, svaret följer tjänsten), RLS + sammansatt `company_id`-filter i varje join, vitest mot riktig Postgres via `test/env.ts`. Ingen ny lagring, inget nytt mönster.
KRAV-1 | `Leverabelrad` i `server/src/services/uppdragRegister.ts` får fältet `dagar_i_laget: number` (heltal ≥ 0, aldrig null), beräknat i SELECT:en med en subquery per rad: hela dagar (avrundat nedåt) mellan `now()` och `COALESCE(max(h.created_at), l.created_at)` ur `uppdrag_leverabel_handelse h` filtrerad på `h.leverabel_id = l.id AND h.company_id = l.company_id`.
KRAV-2 | Leverabel helt utan händelser (skapad av importen, aldrig statusbytt) räknar åldern från leverabelns egen `created_at` (0068:122) — aldrig NULL, aldrig krasch, aldrig ett vilseledande 0 som ser ut som "nyss bytt".
KRAV-3 | Nytt vitest-prov i `server/test/uppdragsytan-register.test.ts` (befintlig fil, riktig Postgres): en leverabel med två händelser med kända tidsstämplar (insatta med explicit `created_at`, t.ex. 10 resp. 3 dagar bakåt) ger åldern ur den SENASTE raden (3), inte den första.
KRAV-4 | Samma prov: en leverabel utan händelser ger åldern räknad från sin `created_at` (fallbackfallet ur RISK), och fältet finns i åtgärdens svar via tjänsten.
KRAV-5 | `docs/MCP_ACTIONS.md`: raden för `las_leverabelregister` (nu rad 923-925, under Uppdragsytan) utökas med fältet och härledningen; `docs/STATUS.md` får en sessionsrad. Bägge committas med koden.
ACCEPTANS | `npm test` och `npm run build` gröna med inklistrad, faktisk utdata; det nya provet visar båda fallen; `git diff` visar att `server/migrations/`, registry.ts, vylagret och alla skrivvägar är orörda; schematestet `uppdragsytan-schema.test.ts:92` (ingen `status_sedan`-kolumn) står kvar oförändrat och grönt — åldern läses bevisligen aldrig ur lagrad kolumn.
AVGRANSNING | Endast: SELECT:en + interfacet i `uppdragRegister.ts`, ett prov i befintlig testfil, rader i två docs-filer. Ingen migration, ingen schemaändring, ingen registry-ändring, ingen vyändring. Fältet följer med oförändrat till befintliga konsumenter av tjänsten (drive-köns `innehall` i `uppdragReferens.ts:427`, svepet) — ingen särbehandling där.
uteslutet: kolumn i en registervy i `http/view/routes.ts` — registervyn finns inte (uteslöts i S3.1 på Davids beslut, `routes.ts:1467`); överlämningens acceptans bärs av läsvägen, och en ny vy vore mer än källan kräver
uteslutet: `status_sedan`-kolumn (överlämningens ALTERNATIV) — förbjuden av acceptansen, fälls av befintligt schematest och `flerbolag.py`:s svep
uteslutet: initialhändelse i `uppdrag_leverabel_handelse` vid import/skapande — ingen ny lagring; fallbacken till `created_at` bär fallet
uteslutet: nytt schematest mot `status_sedan` — finns redan (`uppdragsytan-schema.test.ts:92`), källan kräver ingen dubblett
uteslutet: filtrering av fältet ur frysta kopian/svepet — källan kräver det inte
uteslutet: timmar, tidsstämpel eller finare granularitet i svaret — källan kräver dagar

---

Specen är 17 rader och självbärande: utvecklaren får subqueryns exakta semantik (senaste raden, COALESCE-fallback, sammansatt company_id-filter), fil- och radreferenser för allt som rörs, och gränsen mot vyn — den enda punkten där CTO-underlaget avvek från koden — är avgjord med Davids regel 1 och dokumenterad som uteslutet-rad.
```

## Utfall
Tester: 127 passed (127) · Granskning: GODKANT | Diffen bygger exakt KRAV-1–5 med husets mönster (subqueryn med sammansatt `company_id`-filter, COALESCE-fallback till `created_at`, `GREATEST(0,…)::int` för "heltal ≥ 0"), rör varken migrati · Byggforsok: 1

## Modellkedja (Davids krav 17/8)
Krav+granskning: claude-fable-5 · Utveckling: claude-opus-5 · Claude Code pa Davids abonnemang — inga API-tokens
