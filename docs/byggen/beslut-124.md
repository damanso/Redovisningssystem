# Bygge beslut #124 — Åtgärden `kor_uppdragssvep` (S7.3): en vanlig write-åtgärd som i ordning verifierar referenser, kont

Datum: 2026-09-06 17:35 · Branch: cto/tg-rden-kor-uppdragssvep-s7-3-en-vanlig-124 · Overlamning: #124

## Mal
Åtgärden `kor_uppdragssvep` (S7.3): en vanlig write-åtgärd som i ordning verifierar referenser, kontrollerar spärrmappen och räknar prognosen, lagrar allt med källa+lästidpunkt i `uppdrag_svepvarde` och skriver förslagsrader (`statusforslag:<leverabel>`, `kostnadsforslag:<receipt_id>`) som ren cache — grunden (0068-tabellen, `upsertSvepvarden`, `verifieraReferens`, `tillhorSparrmapp`, `hamtaDriveKo`) finns redan från S7.1/vågorna 1–2.

## Kravspec (claude-fable-5) — sjalvbarande, med KALLA och ARKITEKTUR
```
Kravspecen är klar. Den bygger på överlämning #124, storyn S7.3 ur 1F, 1E Del 3/4 (0068-tabellen, åtgärdstabellen med `kor_uppdragssvep` som write utan kravManniska) och den befintliga koden: `upsertSvepvarden` i `server/src/services/uppdragSvep.ts`, `verifieraReferens`/`tillhorSparrmapp`/`hamtaDriveKo` i `uppdragReferens.ts`, samt husets auditmönster i `actions/execute.ts` (varje åtgärd auditloggas automatiskt — därför kräver upptaget-läget bara ett uttryckligt resultat, ingen ny loggmekanism).

```
MAL | Åtgärden `kor_uppdragssvep` finns så att vyerna aldrig behöver ringa ett grannsystem (NFR-6): Hermes skickar in förra arbetslistans resultat, svepet härleder och cachar allt i `uppdrag_svepvarde` med källa+lästidpunkt (FR-5, FR-10, FR-35, FR-36) och svarar med nästa arbetslista. Sista repobiten i våg 3.
KALLA | Överlämning #124 (story S7.3 ur 1F, våg 3 enligt 1H), 1E Del 3 (0068) och Del 4 (åtgärdstabellen: write, ingen kravManniska, FR-33-bindning), Davids ja 2026-09-06 via vågköraren, mandat 3/9+5/9, 1G GODKÄND 2026-09-05.
ARKITEKTUR | Actions-registret: `def({name, title, sensitivity, inputSchema: zod .strict(), handler})`, ingen SQL i registret. Tjänstelagret: funktion som tar `client: PoolClient`+`companyId`, körs i `withTenantTransaction` (RLS som rollen `app`, audit i samma transaktion via `executeAction`). Enkelriktat som `ingest_crm_events`: repot ringer ALDRIG ut. Skrivning enbart via befintliga `upsertSvepvarden`. Zodschemat bor i tjänsten (prejudikat: `DriveRapportSchema`).
KRAV-1 | Ny funktion `korUppdragssvep` i `server/src/services/uppdragSvep.ts`: all indata (verifierade referenser, skrivna Drive-kopior med id, kalenderhändelser, spärrmappsläge) kommer zod-validerad i anropet — inga externa anrop, inga egna läsåtgärder för indatat.
KRAV-2 | Först i transaktionen tas `pg_try_advisory_xact_lock(hashtextextended(company_id::text, 0))`. Vid upptaget returneras uttryckligt läge `svep_avstod` (auditloggat via husets `executeAction`-mönster) — aldrig tyst tom retur. Ingen manuell frisläppning: xact-varianten släpper sig själv vid commit/rollback.
KRAV-3 | Svepet läser `projects.status` först och hoppar stängda uppdrag, så FR-8:s trigger aldrig träffas.
KRAV-4 | Per öppet uppdrag, i denna ordning: (1) verifiera referenser via `verifieraReferens`, (2) kontrollera spärrmappen via `tillhorSparrmapp`, (3) räkna prognosen ur indatans kalenderhändelser. Varje lagrat värde bär `kalla` och lästidpunkt (`last_nar`) och skrivs ENBART via `upsertSvepvarden` mot `uppdrag_svepvarde`.
KRAV-5 | Förslagsrader skrivs som ren cache i samma svep: `statusforslag:<leverabel>` när en leverabels handling fått ny revision i Drive enligt indatat, `kostnadsforslag:<receipt_id>` när ett bokfört kvittos leverantör matchar en leverabels referens. Förslaget är ingen åtgärd och rör ingen ägd tabell.
KRAV-6 | Kostnadsförslagets bindningsmål följer FR-33 (1E Del 4): strömmen vars intervall täcker datumet, annars rotdelen `UPPDRAG` — bara när `contract_part_id` är NULL, aldrig en leverabel, aldrig en flytt.
KRAV-7 | Svaret är nästa arbetslista: referenser att verifiera med `extern_id`/`extern_kalla`/`hash_vid_lankning` samt Drive-kön via befintliga `hamtaDriveKo`.
KRAV-8 | Registrering i `server/src/actions/registry.ts` under Uppdragsytan-sektionen: `kor_uppdragssvep`, `sensitivity: 'write'`, ingen `kravManniska`, handlern delegerar till tjänsten.
KRAV-9 | Vitest i `server/test/`: ordningen, låset (två samtidiga svep → ett `svep_avstod`), stängda uppdrag hoppas, båda förslagsraderna uppstår ur riggat indata, samma indata två gånger ger samma rader, samt negativa kontroller: svepet skriver aldrig i `uppdrag_leverabel` eller `receipts` och gör inga nätverksanrop.
KRAV-10 | Dokrader: åtgärden under modulsektionen Uppdragsytan i `docs/MCP_ACTIONS.md`; en sessionsrad i `docs/STATUS.md`.
ACCEPTANS | `npm run build` och `npm test` gröna med inklistrad utdata; KRAV-9:s prov finns och är gröna, inklusive negativa kontrollerna; git-diffen rör bara `uppdragSvep.ts`, `registry.ts`, `server/test/` och de två dokfilerna. `svepet.py`/`agandegrans.py` och drift väntar in S7.5 hos Hermes (Davids ja på #124:s fråga).
AVGRANSNING | Ingen migration, inget nytt beroende, ingen scheduler/cron i repot (S7.5 hos Hermes). Inga skrivningar utanför `uppdrag_svepvarde`, inga vyändringar, ingen sensitivity-ändring på befintliga åtgärder, `.env` och produktionsdata rörs aldrig.
uteslutet: sessionslåset pg_advisory_lock enligt migratorprejudikatet — kallan kraver det inte
uteslutet: egen läsåtgärd eller utringning för svepets indata — kallan kraver det inte
uteslutet: ny vy eller ändring i .farskhet — kallan kraver det inte
uteslutet: ny felkod eller errorHandler-mappning för svep_avstod — kallan kraver det inte
uteslutet: egen auditrad utöver executeActions automatiska — kallan kraver det inte
uteslutet: schemaläggning, indatabygge eller Drive-kötömmare i repot — kallan kraver det inte
```

Två val värda att motivera: `svep_avstod` kräver ingen ny loggmekanism eftersom `executeAction` redan auditloggar varje åtgärd — kravet blir därför ett uttryckligt resultatläge (Davids regel 3: husets mönster vid val). KRAV-6 (FR-33-bindningen) står med trots att överlämningens acceptans inte nämner den, eftersom överlämningen uttryckligen pekar på 1E Del 4 som detaljbärare och `bakvag.py` fäller ett svep som binder till ett löv.
```

## Utfall
Tester: 120 passed (120) · Granskning: GODKANT | Alla tio krav är uppfyllda med husets mönster (def-post utan SQL, zod-strict i tjänsten enligt `DriveRapportSchema`-prejudikatet, exakt det föreskrivna xact-låset, skrivning enbart via `upse · Byggforsok: 2

## Modellkedja (Davids krav 17/8)
Krav+granskning: claude-fable-5 · Utveckling: claude-opus-5 · Claude Code pa Davids abonnemang — inga API-tokens
