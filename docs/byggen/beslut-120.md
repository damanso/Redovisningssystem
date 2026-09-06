# Bygge beslut #120 — Referenslagrets skrivväg: en tjänst (`uppdragReferens.ts`, mönstret från `uppdragSvep.ts`) som skapa

Datum: 2026-09-06 15:06 · Branch: cto/referenslagrets-skrivv-g-en-tj-nst-uppdr-120 · Overlamning: #120

## Mal
Referenslagrets skrivväg: en tjänst (`uppdragReferens.ts`, mönstret från `uppdragSvep.ts`) som skapar/verifierar pekare i befintliga `uppdrag_referens` (0068) som `extern_id`+`extern_nyckel`+`extern_kalla`, validerar bort url/sökväg, skiljer drift från trasig och modellerar spärrmappstillhörighet som förälderkedja av Drive-id:n.

## Kravspec (claude-fable-5) — sjalvbarande, med KALLA och ARKITEKTUR
```
Underlaget är på plats — jag har läst 0068:s `uppdrag_referens`-definition (statustokens `levande`/`drift`/`trasig` finns redan i `html.ts:192-194`, GRANT ger `app` SELECT/INSERT/UPDATE men inte DELETE), tjänstemönstret i `uppdragSvep.ts` och ARKITEKTUR.md:s regler. Här är kravspecen:

---

MAL | En skrivväg till referenslagret: `server/src/services/uppdragReferens.ts` som skapar och verifierar pekare i `uppdrag_referens` (0068) så att dokument, kalenderposter och mejl länkas som stabila id:n — aldrig url/sökväg — och drift skiljs från trasig; utan den blockeras S7.2/S7.3 i våg 3 (S7.1, FR-10/FR-24/FR-36).
KALLA | Överlämning #120 (vd 2026-09-06), CTO-underlag med Davids ja 6/9 14:42 inkl. JA på analysfrågan (nyckel+källa krävs i appvalideringen), 1F story S7.1, 1E Del 3 (0068), Davids mandat 3/9 och 5/9.
ARKITEKTUR | Tjänstelagret: fil per domänkoncept som tar `client: PoolClient` + `companyId`, körs inuti anroparens `withTenantTransaction` (mönstret `uppdragSvep.ts`); zod-strict för all indata via delarna i `lib/validation.ts`; alla värden parametriserade; company_id ur medlemskapet; inga externa anrop (ADR-4). Inga nya mönster.
KRAV-1 | Ny fil `server/src/services/uppdragReferens.ts` med exporterade funktioner för att skapa och verifiera referenser; all SQL mot `uppdrag_referens` bor i tjänsten, ingen härledning och inga nätverksanrop där (mönstret `uppdragSvep.ts`).
KRAV-2 | Skapa referens: zod-strict-schema kräver `sort` (`drive`|`kalender`|`mejl`), `extern_id`, `extern_nyckel` OCH `extern_kalla` (Davids svar på analysfrågan — FR-24: en referens ÄR id+nyckel+källa); `titel_vid_lankning`/`hash_vid_lankning` valfria; raden skapas med status `levande`; dubblett fälls av `uppdrag_referens_uk` med begripligt fel.
KRAV-3 | Valideringen fäller allt som ser ut som url eller sökväg i `extern_id` och `extern_nyckel`: värden som innehåller `://`, börjar med `http`, eller innehåller `/` eller `\` avvisas med tydligt fel — ingen sådan rad når databasen via tjänsten.
KRAV-4 | Verifiera referens: tjänsten tar aktuellt läge som anroparen (svepet, S7.3/S7.5) levererar — saknas/titel/hash — och sätter status: saknad ände → `trasig`, ändrad titel/hash mot `*_vid_lankning` → `drift`, oförändrad → `levande`; `senast_verifierad` sätts; UPDATE med fasta kolumnnamn och parametriserade värden.
KRAV-5 | Spärrmappstillhörighet: en funktion som avgör tillhörighet ur en förälderkedja av Drive-id:n (id-lista levererad av anroparen) genom id-likhet mot spärrmappens id — aldrig strängprefix- eller sökvägsjämförelse, aldrig eget Drive-anrop.
KRAV-6 | Vitest i `server/test/` (mönstret från befintliga uppdragsytan-tester): negativkontroller där `http://…` och `/mapp/fil` MÅSTE fällas, saknad `extern_nyckel`/`extern_kalla` fälls, drift respektive trasig sätts rätt vid verifiering, kedjekontrollen ger tillhör/tillhör-inte på id-listor och en flyttad fil (samma id, ny kedja) bedöms om korrekt.
KRAV-7 | `docs/STATUS.md` får en rad i sessionsloggen.
ACCEPTANS | `npm test` och `npm run build` gröna med faktisk inklistrad utdata; testerna i KRAV-6 finns och är gröna; granskaren kan inte via tjänsten skapa en referens som är url/sökväg eller saknar nyckel/källa; drift och trasig är åtskilda lägen i både kod och test; inga nya beroenden.
AVGRANSNING | Ingen migration (0068:s NULL-tillåtelse lämnas för befintliga rader och backfill); ingen ny åtgärd i actions-registret; ingen vy, rutt eller ändring i `html.ts` (statustokens finns på rad 192–194); `time_entry_links` rörs inte; ingen scheduler, ingen ny infrastruktur.
uteslutet: backfill av `extern_nyckel`/`extern_kalla` för befintliga rader — kallan kraver det inte
uteslutet: ny åtgärd `lanka_*` i 13-åtgärdstabellen — kallan kraver det inte
uteslutet: radering av referenser (app saknar DELETE på tabellen i 0068) — kallan kraver det inte
uteslutet: hantering av `ko_status` (koad/skriven) — kallan kraver det inte
uteslutet: eget Drive-anrop för att hämta förälderkedjan — kallan kraver det inte
uteslutet: vy eller subnav-yta för referenslistan — kallan kraver det inte
```

## Utfall
Tester: 116 passed (116) · Granskning: GODKANT | Kraven 1–7 är uppfyllda med belagd täckning (url/sökvägsspärr, id+nyckel+källa, drift≠trasig med orörd baslinje, id-likhet i kedjan, tenantgräns), avgränsningarna respekterade (ingen migrati · Byggforsok: 1

## Modellkedja (Davids krav 17/8)
Krav+granskning: claude-fable-5 · Utveckling: claude-opus-5 · Claude Code pa Davids abonnemang — inga API-tokens
