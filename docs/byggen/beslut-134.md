# Bygge beslut #134 — En förifylld bedömningsrapport: när bedömningen öppnas fylls period, timmar (list_time_entries), kos

Datum: 2026-09-07 00:26 · Branch: cto/en-f-rifylld-bed-mningsrapport-n-r-bed-m-134 · Overlamning: #134

## Mal
En förifylld bedömningsrapport: när bedömningen öppnas fylls period, timmar (list_time_entries), kostnader/förbrukning (get_contract_usage), leverabelrörelser och periodens händelser i automatiskt, siffrorna fryses i `frysta_siffror`/`handelse_ref_ids` (kolumnerna finns redan i 0068 och lämnas NULL av S4.1), scopelinjen bärs med, och lägesvalet är enda obligatoriska fältet.

## Kravspec (claude-fable-5) — sjalvbarande, med KALLA och ARKITEKTUR
```
Kravspecen är klar — jag har grävt igenom S4.1-koden (`uppdragBedomning.ts`, bedömningssidan i `routes.ts`, `satt_bedomning` i registret), 0068:s kolumner, återbrukstjänsterna (`getContractUsage`, `listTimeEntries`, `listaReferenser`, `lasLeverabelregister`, `uppdrag_leverabel_handelse`), 1E Del 3/5/7 och PRD FR-16/20/25/26/32. Ett bärande fynd: `Referensrad` bär inget händelsedatum utöver `created_at`, så periodens händelser filtreras på det; och `handelse_ref_ids uuid[]` ger en naturlig skillnad mellan tom array (fryst, inget hände) och NULL (rad satt före bygget).

```
MAL | När bedömningen öppnas är rapporten redan ifylld — period, timmar, kostnader mot tak, leverabelrörelser, periodens händelser och scopelinjen — och lägesvalet är enda obligatoriska inmatningen; vid INSERT fryser servern siffrorna i `frysta_siffror`/`handelse_ref_ids` (0068, lämnas NULL av S4.1) så att bedömningen blir ett underlag som i efterhand visar vad den grundades på, inte en magkänsla (FR-16/FR-20/FR-32).
KALLA | Överlämning #134 (story S4.2 ur 1F, våg 6 i 1H); Davids ja 6/9 med svarsregler (1)–(7); 1E Del 3 (0068: `frysta_siffror`, `handelse_ref_ids` → `uppdrag_referens`), Del 7 (FR-16/20/25/26/32-bärarna), Del 8 ("ingen egen förbrukningsberäkning — `get_contract_usage` gör det"); PRD FR-16, FR-20, FR-25, FR-26, FR-32; CTO-underlagets riskrad (samma felklass som lärdom 7 i STATUS.md).
ARKITEKTUR | Ett flöde, tre ingångar: mutationen går via `executeAction` → `satt_bedomning` i `actions/registry.ts` → `services/uppdragBedomning.ts`, inuti `withTenantTransaction` (RLS + auditlogg i SAMMA transaktion); zod-`.strict()`-schema ur `lib/validation.ts`; återbruk av `getContractUsage`/`listTimeEntries`; JS-fri serverrenderad vy med kanons tokens och befintliga komponentklasser; vitest mot riktig Postgres. Inga nya mönster.
KRAV-1 | `uppdragBedomning.ts` får en underlagsbyggare som för (contract_id, period_start, period_slut) bygger rapportunderlaget ur BEFINTLIGA läsvägar: förbrukning/kostnader per del mot tak ur `getContractUsage`, periodens timmar härledda ur `listTimeEntries`-utdatan (filter from/to + projekt), leverabelrörelser ur `uppdrag_leverabel_handelse` i perioden, och händelser som id:n ur `uppdrag_referens` (sort `kalender`/`mejl`, `created_at` i perioden). Ingen parallell SQL-summering av ekonomidata (FR-25).
KRAV-2 | `sattBedomning` utökas: underlaget räknas om i SAMMA transaktion som INSERT och skrivs till `frysta_siffror` (jsonb) och `handelse_ref_ids` (uuid[], pekare mot `uppdrag_referens`, aldrig kopior — FR-26). Fälten tas ALDRIG som indata: `satt_bedomning`:s inputSchema är oförändrat och `.strict()` fäller dem.
KRAV-3 | En period helt utan tid och händelser fryser nollor och tom händelselista (`{}`::uuid[], inte NULL) och insertningen lyckas — lägesvalet förblir enda obligatoriska fältet (storyns Then-sats); NULL i kolumnerna betyder därmed entydigt "satt före S4.2".
KRAV-4 | `satt_bedomning` behåller `sensitivity: 'write'` + `kravManniska: true`; ett agentanrop avvisas fortsatt med 403 `human_required` före varje skrivning (FR-15). Ingen sensitivity-ändring, ingen ny åtgärd.
KRAV-5 | GET-bedömningssidan i `http/view/routes.ts` förifyller rapporten ovanför/vid formuläret: period (dagens förval kvar), timmar, kostnader mot tak, leverabelrörelser, periodens händelser som referenser samt scopelinjen — innanför, utanför, samtliga fraser ur `uppdrag_scopelinje` (FR-6, Davids svar c 5/9). Saknas händelser/läsväg renderas händelsedelen som saknad med förklarande text i stället för att blockera eller gissa (FR-32). Befintliga komponentklasser och tokens, JS-fritt, ingen ny stil.
KRAV-6 | Historiken visar den frysta postens siffror ur `frysta_siffror` — aldrig omräknade ur källorna, och en post fälls aldrig för att källvärdena senare ändrats (FR-20); rader med NULL (S4.1-rader) renderas som i dag, utan siffror.
KRAV-7 | Vitest i `server/test/` (befintlig `uppdragsytan-bedomning.test.ts` uppdateras — den förväntar i dag NULL på raderna 256–257): (a) frysta siffror stämmer mot husets tal vid tillfället och står kvar oförändrade när en tidpost läggs till efteråt; (b) `handelse_ref_ids` pekar exakt på periodens `uppdrag_referens`-id, händelser utanför perioden ingår inte; (c) `frysta_siffror`/`handelse_ref_ids` som indata avvisas av strict-schemat; (d) tom period ger nollor + tom lista och lyckas; (e) agentanrop ger fortsatt 403 `human_required`.
KRAV-8 | Docs: `satt_bedomning`-posten under modulsektionen Uppdragsytan i `docs/MCP_ACTIONS.md` uppdateras med frysningen; `docs/STATUS.md` får en rad + sessionslogg, committas med övriga ändringar.
ACCEPTANS | `npm run build` och `npm test` gröna med inklistrad riktig utdata; en bedömning satt efter bygget bär `frysta_siffror`/`handelse_ref_ids` ur serverns egen omräkning i insert-transaktionen (verifierat i test a–b); diffen rör inga andra filer än AVGRANSNING:s lista, innehåller ingen migration, inget nytt beroende, ingen ny stilklass och inga nya indatafält på åtgärden.
AVGRANSNING | Endast `server/src/services/uppdragBedomning.ts`, `server/src/actions/registry.ts` (befintlig `satt_bedomning`-def), bedömningssidan i `server/src/http/view/routes.ts`, `server/test/`, `docs/MCP_ACTIONS.md`, `docs/STATUS.md`. Ingen migration (0068:s kolumner finns), inget nytt beroende, ingen scheduler, inga nya felkoder eller mappningar, inga ändringar i `executeAction`, svepet eller andra åtgärder.
uteslutet: kopiering av händelseinnehåll (mejlkropp, kalendertext) in i rapporten — kallan kraver det inte
uteslutet: frysning av scopelinjen i frysta_siffror (den bärs levande i vyn) — kallan kraver det inte
uteslutet: delningslogg och Drive-kopia av rapporten (S7.5:s ansvar) — kallan kraver det inte
uteslutet: rytm-/påminnelsemekanik för bedömningstillfället (FR-14 bärs av kalendern) — kallan kraver det inte
uteslutet: ny åtgärd, ny rutt eller ny vy för underlaget (befintlig sida och åtgärd utökas) — kallan kraver det inte
uteslutet: retroaktiv frysning av äldre S4.1-rader — kallan kraver det inte
```

Två vägval i specen som förtjänar en rad: periodens händelser filtreras på `uppdrag_referens.created_at` eftersom raden inte bär något annat datum (verifierat i `uppdragReferens.ts:100–112`), och tom period tillåts med frysta nollor — det följer direkt av storyns "lägesvalet är enda obligatoriska inmatningen" och Davids regel 3 (husets mönster: ett giltigt svar spärras inte). Scopelinjen fryses inte — acceptansen säger bara att rapporten *bär* den, och regel 1 förbjuder tillägg utöver överlämningen.
```

## Utfall
Tester: 129 passed (129) · Granskning: GODKANT | Alla åtta krav är uppfyllda inom AVGRANSNING:s filer — frysningen sker i insert-transaktionen ur husets egna läsvägar (`getContractUsage`/`listTimeEntries`/`listaReferenser`, verifierat mot  · Byggforsok: 2

## Modellkedja (Davids krav 17/8)
Krav+granskning: claude-fable-5 · Utveckling: claude-opus-5 · Claude Code pa Davids abonnemang — inga API-tokens
