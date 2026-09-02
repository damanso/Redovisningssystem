# Bygge beslut #102 — Två läs-rapporter (ofakturerad godkänd tid per kund med betalnings- och stillhetsdimension, samt avt

Datum: 2026-09-02 10:13 · Branch: cto/tv-l-s-rapporter-ofakturerad-godk-nd-tid-102 · Overlamning: #94

## Mal
Två läs-rapporter (ofakturerad godkänd tid per kund med betalnings- och stillhetsdimension, samt avtalsförbrukning mot tak) byggs som actions plus en JS-fri vysida `/tid`, med samma tjänstefunktioner bakom alla ingångar.

## Kravspec (claude-fable-5) — sjalvbarande, med KALLA och ARKITEKTUR
```
Jag har grävt klart: verifierat `gallandeTaxa`/`forbrukningForAvtal`/`getContractUsage` i contracts.ts, `accountsReceivableAging` (reports.ts:377), den äldre formeln i steering.ts:79–84, betalningsverifikaten (`source_type='payment'`, invoices.ts:305), statuslivscykeln (0062: forslag/godkand/justerad/ignorerad/fakturerad), `pageFor`-mönstret för lässidor och `NAV_GROUPS` i html.ts (gruppen "Lön & projekt", html.ts:270). Här är kravspecen:

```
MAL | Två läsrapporter — ofakturerad godkänd tid per kund (med betalnings- och stillhetsdimension) och avtalsförbrukning mot tak — som read-actions OCH JS-fri vysida /tid ur samma tjänstefunktioner, så att juli-/augustifelet (godkänd tid som aldrig fakturerats) syns utan att någon frågar; samtidigt får systemet EN enda definition av ofakturerad tid (steering-ytans äldre formel byts ut).
KALLA | Överlämning #94 (vd 2026-09-02) + Davids svar 1/9 (delegerat; byt steering.ts:79–84 till nya tjänstefunktionen i samma bygge — ingen andra sanning) + rådslag 1/9 (CFO: betalningskolumnerna; CHRO: stillhetsbevakning) + PRD_TIDSRAPPORTERING §4 F7, §7 acceptans 10, §9.4 + story 1–3 (docs/byggen/ beslut-095/100/101).
ARKITEKTUR | Enbart befintliga mönster: read-actions via def med zod .strict() i registry.ts; tjänstefunktioner som tar client + companyId; vysida via pageFor i view/routes.ts som anropar tjänsten direkt (som receivables rad 1309 och steering rad 2762); menypost i NAV_GROUPS (html.ts); belopp i ören-heltal via timeEntryAmountOre; taxaordning ENBART via gallandeTaxa (contracts.ts:456); förbrukning via listContracts/getContractUsage; öppna fakturor via accountsReceivableAging. Ingen migration, inga nya beroenden.
KRAV-1 | Ny tjänstefil server/src/services/timeReports.ts med unbilledTimeReport(client, companyId, { customer_id?, project_id?, to? default idag }): per kund → projekt → avtalsdel: antal poster, registrerade minuter, debiterbara minuter, belopp = Σ timeEntryAmountOre(billable_minutes, gallandeTaxa(postens taxa, delens, avtalets, projektets)), äldsta work_date. Beloppsurval: status IN ('godkand','justerad') AND invoice_id IS NULL AND work_date <= to — samma urval som fakturadraget (TIDPOSTURVAL-villkoren), aldrig den äldre billable/NOT invoiced-formeln.
KRAV-2 | Poster i status 'ignorerad' (ofakturerade) räknas in i kolumnen registrerade minuter men ALDRIG i debiterbara minuter eller belopp (Davids svar på öppen fråga 4: nedlagd tid ska synas). Antal poster i status 'forslag' per projekt returneras som egen räknare — ingår aldrig i beloppet.
KRAV-3 | Betalningsdimensionen per kund i samma svar: tre kolumner bredvid varandra — ofakturerat belopp (KRAV-1), fakturerat men obetalt (radens total_ore + förfallo-buckets ur befintliga accountsReceivableAging(to), ingen ny beräkning), betald i perioden = summa inbetalningsverifikat (vouchers med source_type='payment' kopplade till kundens fakturor) med verifikatdatum från första dagen i to:s kalendermånad t.o.m. to.
KRAV-4 | idleProjectsReport(client, companyId, { days? default 7 }): projekt med status 'active' utan tidpost i NÅGON status med work_date de senaste N dagarna; returnerar projekt, kund och senaste work_date (eller null). Rapporterar ATT det ligger still, aldrig varför. Ingår i unbilled_time_report-svaret som idle[].
KRAV-5 | Tre read-actions i registry.ts: unbilled_time_report (customer_id?/project_id?/to?, alla optional), idle_projects_report (days? heltal ≥1), contract_usage_report (utan input): alla bolagets avtal med delar och fasföräldrar via befintliga listContracts/forbrukningForAvtal — förbrukade timmar/belopp (godkand+justerad+fakturerad), tak, andel, status 'under 80 %'/'80–100 %'/'över tak' (härledd ur share/cap_status), samt ofakturerat inom delen ur KRAV-1-urvalet. Ingen ny förbrukningsberäkning.
KRAV-6 | steering.ts rad 79–84 ersätts: coverage.unbilled_time_ore hämtas ur nya tjänstefunktionens totalsumma (KRAV-1-urvalet med gallandeTaxa); den äldre SQL-formeln (billable AND NOT invoiced, utan avtalstaxa) raderas; fältnamn och svarform i SteeringOverview är oförändrade.
KRAV-7 | Vysida via pageFor('tid', …) på '/c:companyId/tid' i view/routes.ts: tabeller för ofakturerad tid per kund (med betalningskolumnerna), stillastående projekt och avtalsförbrukning — ur exakt samma tjänstefunktioner som actions, länk per rad till projektsidan, 'N förslag väntar'-rad med länk till projektet (godkännandeytan kommer i story 8), tomt läge med mänsklig copy som övriga sidor, ingen JS. Menypost ['tid', 'Tid'] i NAV_GROUPS-gruppen 'Lön & projekt' (html.ts:270).
KRAV-8 | docs/MCP_ACTIONS.md dokumenterar de tre nya actionsen; docs/STATUS.md sessionslogg uppdateras.
KRAV-9 | Tester (vitest + supertest mot riktig Postgres): rapporten visar noll för en period som just fakturerats via create_invoice_from_time (acceptans 10); ignorerad post syns i registrerade minuter men aldrig i beloppet; forslag räknas som antal men inte i beloppet; taxaordningen i rapporten = fakturans (post→del→avtal→projekt); fasförälderns andel i contract_usage_report; idle-rapporten träffar stilla aktiva projekt men varken nyligen bemannade eller stängda; steering-svarets unbilled_time_ore = nya funktionens summa (en billable-post i status 'forslag' räknas inte längre); vysidan svarar 200 med tabellrubrikerna.
ACCEPTANS | npm run build och npm test gröna med faktisk inklistrad utdata; samtliga testfall i KRAV-9 finns och passerar; grep visar att den äldre formeln i steering.ts är borta och att beloppet överallt går genom gallandeTaxa + timeEntryAmountOre — en definition av ofakturerad tid, tre ingångar (action, vy, steering).
AVGRANSNING | Rör ENDAST: ny timeReports.ts, registry.ts, view/routes.ts, html.ts (menyposten), steering.ts (rad 79–84 + importen), docs och tester. Ingen migration; contracts.ts, reports.ts, projects.ts, invoiceFromTime.ts och invoiceAppendix.ts oförändrade; inga nya beroenden.
uteslutet: godkännande/statusändring av förslag från vyn (story 8) — kallan kraver det inte
uteslutet: redigering av tidposter och bilagor i vyn (story 5) — kallan kraver det inte
uteslutet: CSV-export för /tid — kallan kraver det inte
uteslutet: notifiering/mejl vid stillastående projekt — kallan kraver det inte
uteslutet: orsaksfält eller analys av VARFÖR ett projekt ligger still — kallan kraver det inte
uteslutet: placering under Projekt i stället för egen menypost — kallan kraver det inte
uteslutet: ny aging- eller betalningsberäkning bredvid de befintliga fakturafunktionerna — kallan kraver det inte
```

Tre saker i specen som är medvetna val: "betald i perioden" saknar befintlig funktion, så KRAV-3 definierar perioden exakt (to:s kalendermånad) och bygger på befintliga betalningsverifikat i stället för en ny betalningsmodell; KRAV-6 behåller fältnamnet `unbilled_time_ore` så steering-vyn och dess konsumenter inte bryts trots att siffrans definition skärps; och contract_usage_report tar inget input alls eftersom listContracts redan bär hela svaret. Davids OBS om deployen (använd `/usr/local/bin/redovisning-deploy`, inte redovisning_update.sh) är en driftinstruktion till motorn, inte ett krav i bygget — den ligger därför utanför specen.
```

## Utfall
Tester: 103 passed (103) · Granskning: GODKANT | Urvalet finns på ETT ställe (URVAL i timeReports.ts) och beloppet går överallt genom gallandeTaxa + timeEntryAmountOre, steering-formeln rad 79–84 är raderad med oförändrad svarform, de tre  · Byggforsok: 1

## Modellkedja (Davids krav 17/8)
Krav+granskning: claude-fable-5 · Utveckling: claude-opus-5 · Claude Code pa Davids abonnemang — inga API-tokens
