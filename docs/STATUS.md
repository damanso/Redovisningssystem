# PROJEKTSTATUS — läs detta FÖRST i varje ny session

> **Syfte:** kontinuitet mellan AI-sessioner (BMAD-liknande). En ny session ska
> kunna fortsätta exakt där den förra slutade utan att fråga om historiken.
> **Regel:** uppdatera "Sessionslogg" nederst INNAN du avslutar en session som
> ändrat något, och committa+pusha den med övriga ändringar.

## Vad projektet är

Svenskt redovisningssystem för AB (K2), byggt AI-först: ett action-lager (218
actions) som drivs av antingen **Claude Desktop via MCP** eller **REST-API:t**
eller **den serverrenderade webbvyn** (`/app`, JS-fri HTML). Känsliga åtgärder
(bokföra, betala, låsa period) kräver alltid mänskligt godkännande i **Att göra**
— oavsett vem som föreslog dem. Arkitekturinvarianter: se `CLAUDE.md` (rot).

## Driftläge just nu (uppdaterat 2026-09-21)

- **Skarp drift körs på VPS:en david-brain** för **Locollabs AB**: oföränderliga
  releaser under `/opt/redovisning-app/releases`, symlänken `current` läses av
  systemd-tjänsten `redovisning` (API på 127.0.0.1:3001 bakom ytan, Postgres i
  containern `redovisning-postgres` på 5434). Byte sker ENBART via
  `redovisning-deploy`. Se `docs/DRIFT_VPS.md`. Belägg 2026-09-21: löner
  2026-03–2026-08 bokförda där (beslut #49 för augusti), senaste verifikat
  2026-09-01.
- Den lokala Mac-installationen (`~/redovisningssystem`, `Redovisning.app`,
  Docker-Postgres 5433, `localhost:3000/app`, backup via `bash backup.sh`) finns
  kvar men är **inte drift**: senast uppdaterad 2026-09-02, 132 commits efter
  main, utan LOC-355. Startas den kör `start-lokalt.sh` migreringarna
  automatiskt och utan backup — uppdatera den inte i förbifarten.
- **Claude Desktop är anslutet via MCP** (token mintas i vyn under **Anslut AI**;
  konfig i `~/Library/Application Support/Claude/claude_desktop_config.json`).
  Claude fyller register/bokföring; användaren godkänner i Att göra.
- Historisk bokföring 2026 (79 verifikat) importerad via SIE (`import_sie`-action).
  OBS: SIE-importen tar **inte** in #IB (ingående balanser) — IB läggs som manuellt
  verifikat per 1 jan om det behövs.
- Railway-deploy är FÖRBEREDD (Dockerfile, railway.json, docs/DEPLOY_RAILWAY.md)
  men INTE aktiverad — användaren valde lokal drift.
- Branch: **`main`** är sedan 2026-07-21 den kanoniska branchen (innehåller
  ombyggnaden + K-serien). Utveckling sker på arbetsbrancher som mergas till main.

## Byggt och verifierat (allt grönt: `npm test` = 3991 tester i 208 sviter, `npm run build` ren)

> Senast körd 2026-09-02: 869 gröna, 1 rött — `fixed-assets.test.ts` föll på
> `Error: socket hang up`. Omkörning av filen ensam: 10/10 gröna på 2,9 s. Alltså
> en tappad anslutning, inte en regression. Samma körning bevisade
> migrationskedjan mot ett tomt schema: 63 migrationer, inklusive 0063.

- **Fas 0–4:** kärna (RLS/tenant, öre-heltal, gap-fria oföränderliga verifikat,
  periodlås, auditlogg append-only), API, action-lager+godkännandekö, webbvy.
- **A-serien:** dashboard-diagram, CRM, delbetalningar, leverantörsfakturor,
  abonnemang, projekt/tid, kassaflöde, multi-bolag, analys, team/roller, 2FA,
  notiser+e-postoutbox (kräver SMTP-env), SIE/CSV-import, lön (utan AGI-inlämning).
- **B/C/D-serien:** K2-årsredovisning (förvaltningsberättelse, noter, iXBRL),
  skattekonto, INK2R/INK2S + SRU-filer, momsdeklaration (rutor 05–49), AGI-fil,
  K10, KU10, periodisk sammanställning (EU-moms).
- **E-serien:** GDPR-anonymisering, F-skatt/omvänd byggmoms, ROT/RUT.
- **V-serien (vyn som fullständig reserv utan AI):** registrering + skapa
  bolag/räkenskapsår/kund/leverantör/faktura/kvitto i webbläsaren; Bokför…/
  Registrera betalning…-knappar via godkännandekön; kvittofoto/PDF-uppladdning
  med 📎-länk; "Anslut AI"-sida som mintar MCP-token + färdig konfig.
- **MCP-server:** `server/src/mcp/server.ts` (env REDOVISNING_API_URL/_COMPANY_ID/
  _AGENT_TOKEN), speglar action-manifestet; agent-token kan aldrig godkänna.
- **K-serien (2026-07-21, payroll utan workarounds):** tabell 30-skatt
  (årsversionerad + historiska H1-värden 13 360/43 140 per Tillägg 1),
  payment_date med bankdagsregel, semesterersättning, kontantmetodsbokföring
  7010/1930 + book_payroll_tax 2510/1930, lönespec-PDF + dokumentkoppling
  (attach/list/get_document), list_fiscal_years/list_vouchers + härlett
  räkenskapsår, beroendemedveten godkännandekö + composite bokning-och-
  betalning, link_voucher-baklänkning + momsmetodvakt, draft-delete,
  mcp:install/mcp:token/self_check. Se docs/MCP_ACTIONS.md + ACCEPTANS.md.
- **CRM E-serien + Relationsytan F1–F6 (2026-08-14):** eget schema `crm` med RLS
  och egen gallring (relationsdata är inte räkenskapsinformation), rollen
  `contractor`, API-kontraktet för mail/kalender/ärenden (docs/crm/API_KONTRAKT.md),
  härledda nyckeltal, dagsyta, tråd med pengahändelser, ursprung per fält med
  regeln att människan vinner, kadens, sammanslagning och sökning.

## Viktiga buggfixar (lärdomar — återinför inte)

1. **Referrer-Policy:** helmet-default `no-referrer` fick webbläsare att skicka
   `Origin: null` → CSRF-403 på egna formulär. Nu `strict-origin-when-cross-origin`.
   Försvaga ALDRIG assertSameOrigin i stället.
2. **SIE-import 25P02:** hoppa-över-befintligt-konto får inte ske via fångad
   INSERT-krock — den förgiftar transaktionen. Befintliga konton hämtas med
   SELECT först (sieImport.ts).
3. **Räkenskapsår väljs från DOKUMENTETS datum** (fiscalYearForDate), aldrig
   "senaste året" — annars går fjolårsdokument inte att bokföra.
4. **Godkännandefel måste synas:** endast ConflictError `not_pending` är tyst
   idempotent; alla andra verksamhetsfel visas som ?fel=-notis på Att göra.
5. **Vyns skapa-flöden går genom executeAction (actor human)** — samma
   validering/audit som AI-vägen. Bygg aldrig parallella vägar.
6. Bolagsskapande delas via `services/companies.ts` (API+vy). Org.nr normaliseras
   till NNNNNN-NNNN. Kronparsning via `domain/money.ts` (aldrig egen flyttalsvariant).
7. **Ingest-vägen måste sätta kopplingen till kundregistret.** `ingest_crm_events`
   rörde aldrig `customer_id`, så NVR och ILT låg som prospekt med NULL — och
   läsvyerna som hämtar omsättning via just den kopplingen räknade tyst noll för
   bolagets största kund. Raden fanns, namnet stämde, inget fel returnerades.
   Uppslaget sker nu i tjänstelagret (org.nr, annars namn) och utfallet redovisas
   i `unlinked_organizations`. Samma felklass som localhost-fallbacken.
8. **En människas rättelse ska överleva nästa synk** (F4). Utan regeln "människan
   vinner" är ursprungsmärkningen dekoration: man rättar org.numret, nästa
   körning sätter tillbaka gissningen, i tysthet. Och filtreringen måste
   redovisas — en synk som tyst kastar bort en del av sin egen skrivning ser ut
   som en synk som lyckades helt.
9. **`in` är inte `Object.hasOwn`.** `?visa=constructor` passerade en
   `v in OBJEKT`-vakt, plockade ut Object-konstruktorn och gav 500. Vakter mot
   objektnycklar ska alltid använda `Object.hasOwn`.
10. **Ursprunget måste dö med det det pekar på.** GDPR-raderingen behåller
    organisationsraden (bokföringslagen) men `crm.field_provenance` bar
    `source_ref` till de raderade mailen. Både raderingen och gallringen rensar
    nu pekarna. Samma regel som `crm.audit_log.details`: aldrig fritext eller
    namn i något som överlever gallringen.

11. **En sammanslagning måste överleva nästa nattkörning.** Källorna utanför
    systemet vet inte att två rader slagits ihop, och `ingestCrmEvents` slår upp
    organisationen på NAMN innan `source_ref` konsulteras — så det gamla namnet
    skapade raden igen varje natt. Det som återuppstod var värre än dubbletten:
    ett TOMT skal (åtagandena låg kvar på rätt rad) som ändå syntes i
    tystnadslistan. Samma familj som lärdom 8: ett människobeslut som synken gör
    ogjort i tysthet. Gravstenen (`crm.organization_name_aliases`, 0059) styr om
    namnet — men bara för `source: 'sync'`, aldrig för en människas upsert, och
    varje omstyrning redovisas (`redirected_organizations`). Till skillnad från
    GDPR-gravstenen FÅR den tas bort: en sammanslagning är ett omdöme.

## INTE byggt (utanför scope / kvarstår)

- Digital inlämning till Skatteverket/Bolagsverket, BankID, PSD2-bankkoppling —
  alla filer (SRU, iXBRL, AGI, KU10) är underlag som lämnas manuellt.
- SIE-importens #IB-sektion (ingående balanser) läses inte.
- E-postutskick kräver SMTP_*-env (annars stannar det i outbox/notiser).
- Anställd/lönekörning har ingen skapa-UI i vyn (görs via MCP/API-actions).
- Kvarstår i PRODUKTIONSDATAN (körs av David via actions efter merge):
  `recalculate_draft_payslips` (H1→13 360, juli→12 943),
  `suggest_voucher_links`+`link_voucher` (2025/H1-baklänkningen),
  `delete_draft_invoice` för fakturaregister 13–18 (efter Davids OK).

## Sandbox-fallgropar (för AI-sessioner i denna repo-miljö)

- Kör ALDRIG `pkill -f tsx` (dödar eget skal). Skriv ALDRIG till `/tmp` (ej
  skrivbart) — använd sessionens scratchpad. tsx-binären ligger i ROT-
  `node_modules/.bin/`. Lokal Postgres: port 5433, kan behöva startas om:
  `su pguser -c '/usr/lib/postgresql/16/bin/pg_ctl -D /home/pguser/pgdata -o "-p 5433 -k /tmp" -l /tmp/pg5433.log start'`.
- Användaren är helt oteknisk: alla instruktioner till honom ska vara
  steg-för-steg på svenska (kopierbara kommandon, förklara varje begrepp).
- **Kör ALDRIG `docker compose up -d` i repo-roten.** Den ospårade
  `docker-compose.vps.yml` startar containern `redovisning-postgres` (port 5434)
  i SAMMA compose-projekt (`redovisning`) som `docker-compose.yml`. Ett blankt
  `docker compose up -d` stoppar och ersätter den alltså. Behöver du en
  testdatabas på 5433: starta en FRISTÅENDE container utanför compose-projektet,
  `docker run -d --name redovisning-vitest-pg -p 127.0.0.1:5433:5432
  -e POSTGRES_USER=postgres -e POSTGRES_HOST_AUTH_METHOD=trust postgres:16`.
- Beroendena kan saknas i en färsk sandbox (`tsc: not found`). Kör `npm install`
  i roten först — binärerna hamnar i ROT-`node_modules/.bin/`.

## Sessionslogg (nyaste överst — FYLL PÅ HÄR)

- **2026-11-28 — Bygge: 6-1-varje-varde-i-ytorna-bar-sin-kalla-och-lastid.**
  Varje värde i uppdragsytan bär sin källa och lästid vid värdet (FR-35, FR-23,
  FR-22). `lasUppdragslage` och `lasKontraktsyta` får det additiva fältet
  `varden` (byggt av `avtalsvarden` respektive i `lasKontraktsyta`, slutna
  listor), och varje rad ur `lasLeverabelregister` är själv ett läsvärde genom
  `registerrad`; alla befintliga nycklar står kvar för Hermes läsare.
  Cachevärden byggs av `cachevarde` i `lib/lasvarde.ts` med radens egen lästid
  per avtal, och Lägets kort skriver tröskelns färskhet per avtal
  (`troskelnsFarskhet`); den sammanslagna `farskhet.troskel` ritas inte längre.
  Drive-pekare som aldrig verifierats är olästa (`pekarvarde`). Planens fråga
  flyttades till `lasPlandelar`. Varje värdeblock med ett tal på Läget, Planen,
  Leveranserna, Pengarna, Rapporterna och Kontraktet bär en färskhetsrad.
  Pengarnas kostnader och Planens avtalsdelar står nu i husets `.panel`. Ingen
  migration, ingen rutt och ingen åtgärd tillkom (talet i rubrikstycket är
  oförändrat), och inga `RESTER` hittades. Täcks av LV1–LV12, F0–F6 och N0–N4 i
  `server/test/uppdragsytan-lasvarde.test.ts`, de omskrivna påståendena i
  laget-provet (tio färskhetsrader) och registerprovet (de fyra läsvärdesnycklarna,
  jämförelsen utan lästid) samt leveransprovets 4.1-B2. Det sista står inte i
  berättelsens lista och är omskrivet på samma sätt som registerprovets
  nyckellista, eftersom kriterium 1 kräver nycklarna på raden. Körningar
  2026-11-28: typkontrollen utan fel efter varje uppgift; Körning 1, 2, 4, 5
  och 6 gröna (101, 475, 256, 318 och 65 fall); Körning 3 gav 280 av 281 med
  4.1-B2 rött, och efter omskrivningen var leveransprovet 28 av 28.
  `npm run build` inte kört (nekas i kedjan). Designskillsen gick inte att ladda
  i sessionen; markupen följer husets befintliga klasser. Rött utanför repot före
  bygget, orört av det: bmadglidning och scope_grind (RÖDA), modulprov och
  continuityvakt (KUNDE_INTE) i provvaktens körning 2026-11-27.
- **2026-11-28 — Bygge: 5-8-larmregeln-for-nedlagd-tid-mot-ram-enligt-davids-beslut.**
  Måttet ”Nedlagd tid mot ram” larmar nu på FR-3:s avvikelsetröskel enligt
  Davids beslut 2026-10-07 («Ersätt, skriv inte om»), med källan
  `LARMREGELNS_KALLA` i `lib/leveranskontrakt.ts`. Läget avgörs bara av
  `larmregelLage` (härleds exakt där utfallet härleds, läsaren tid mot ram),
  och parsern sätter det genom den. Den rena `uppdragsnivansTimlage` i
  `lib/troskel.ts` väljer uppdragsnivåns timlarm (utfall och prognos) ur
  svepets lagrade `troskellarm` och jämför inget tal; `harledTroskellarm` är
  orörd. Läsvägen bär `larmregel_kalla` och `larm` på varje mått genom den
  rena `mattlarm` (cacheradens källa och lästid, oläst när svepet inte kört),
  utan nytt SQL. Panelen Uppföljning och rytm visar den ersatta regeln
  ordagrant och dämpad med chipet ”larmregel ersatt”, källraden och
  tröskelns läge med svepets färskhet; en larmregel som inte härleds ritas
  som förut. Migrationen 0100 sätter bara läget på öppna uppdrags befintliga
  rader och lägger villkoret `uppdrag_matt_larmregel_kraver_utfall` — ingen
  kolumn, ingen rättighet, ingen policy och ingen trigger; kontraktets
  larmregel står kvar ordagrant. Ingen rutt och ingen åtgärd tillkom (talet
  över antalet åtgärder i rubrikstycket är oförändrat). `docs/ARKITEKTUR.md`
  har stycket «Larmregeln», och `docs/MCP_ACTIONS.md` beskriver fälten och
  panelen. Prov: nya `uppdragsytan-larmregel` (LR1–LR8, 30 fall) och de
  omskrivna L2, V2, V7, P1 och V1 i `uppdragsytan-matt-rytm`. Körningar mot
  testdatabasen 127.0.0.1:5433: delkörningarna 1–3 gröna (99, 254 och 257
  prov) och typkontrollen exit 0 efter varje uppgift; grinden (körning 4):
  `uppdragsytan-larmregel` och `uppdragsytan-matt-rytm` 89/89, `npm run
  typecheck` exit 0 och hela `npm test` 223 filer och 4430 prov gröna
  (1130 s). `npm run build` är inte kört (kedjan nekar det). Inga RESTER.
  Måttets larm visas först efter nästa svep efter driftsättningen; till dess
  säger raden att tröskeln inte är prövad. Rött utanför repot före bygget,
  orört av berättelsen: continuityvakt (KUNDE_INTE), bmadglidning och
  scope_grind (RÖDA) i provvaktens körning 2026-11-27.

- **2026-11-28 — Story 6.1 (crm): kostnadstäckningen som schablon, med täckningsgapet (FR-20, FR-41):**
  `steeringOverview` bär `coverage.gap_ore` ur den nya rena `coverageGapOre`
  i steering-tjänsten (schablonen minus tre gånger snittkostnaden, i ören med
  tecken), och gapet är `null` utan bokförda kostnader, i samma fall som
  `months_covered`; övriga fält är orörda. Styrvyn ritar tabellen
  «Kostnadstäckning (schablon)» i den nya vymodulen
  `server/src/http/view/kostnadstackning.ts`, i två kolumner med förklaringen
  under radnamnet, så att den ryms på telefonbredd utan att staplas. De gamla
  formuleringarna och hänvisningen till Linear är borta ur rutten, och den enda
  meningen om öppna affärer är «Öppna affärer räknas inte in i täckningen.».
  Jämförelsegrunden är tre månaders kostnad enligt Davids svar 2026-10-16 (PRD
  fråga 16), så 6.4 behöver ingen tabell och ingen åtgärd. Prov:
  `server/test/steering-liquidity.test.ts` (K1–K5 tjänsten och gapets tecken,
  V1–V6 renderaren och tvåspaltsformen, S1–S3 styrvyns sida, var och en med
  negativ kontroll) och `server/test/crm-views.test.ts` (rubriken och titeln
  uppdaterade). Ingen migration, åtgärd, tabell, rutt eller miljövariabel.
  Kört i sessionen: `npm run typecheck` (båda tsconfig) och `npm test` per
  berörd fil mot testdatabasen, och till sist hela `npm test`: 222 filer,
  4400 prov gröna. **Inte kört:** `npm run build`.

- **2026-11-28 — Bygge: 5-7-stromnivan-och-absolutgolvet-enligt-davids-beslut.**
  Strömnivån mäts nu mot summan av stegets leverabelramar (Davids svar
  2026-10-07). Ny ren regel `stromramar` i `lib/troskel.ts` med källan i
  `STROMRAMENS_KALLA`: en ström är en aktiv del direkt under rotdelen med
  aktiva barn, ramen är summan av barnens `egenRam`, strömmens egna takfält
  (fasramen, det summerade taket) läses aldrig, och saknar en leverabel egen
  ram i en enhet saknar strömmen ram där, aldrig en delsumma. Styrningen är
  ingen ström. `harledTroskellarm` prövar rotdelen, strömmarna och posterna
  med samma regel (strömmen bara när varje leverabels tak är bekräftat, utan
  dagslarm), och `utan_egen_ram` omfattar strömmarna. Förbrukningspanelen bär
  `strommar` i stället för `strom`, en rad per ström i samma tabell och
  tomläget «Avtalet har inga strömmar.»; texten «strömnivån härleds inte förrän
  ramen är vald» och konstanten är borttagna. `GOLVETS_MARKNING` är «beslutat
  av David 2026-10-07», och tröskelregelns mening säger strömmens ram och
  källa. Golvets värde ligger kvar bara i 0068:s kolumner. Ingen migration,
  ingen rutt, ingen åtgärd och inget beroende; talet över antalet åtgärder i
  rubrikstycket är oförändrat. `docs/ARKITEKTUR.md` har stycket «Stromnivan»,
  och `docs/MCP_ACTIONS.md` beskriver nivåerna och golvets beslut. Prov: nya
  `uppdragsytan-stromniva` (SR0, SB0, SN0, riggen S med SG1 a–d och SB1 a,
  SD; hjälpfil `stromnivaHelper.ts`) och SA0 a–g i `uppdragsytan-troskel`,
  plus omskrivna fall i 5.2:s och 5.3:s prov (T0 c, T0 h, F2 a, W1 a, W1 c,
  W1 d, KRAV-6 (2), N0 c, N0 j, N0 l, V0 c, F1 c, V1 c). Körningar mot
  testdatabasen 127.0.0.1:5433: delkörningarna 1–4 gröna (73, 161, 187 och 198
  prov) och typkontrollen exit 0 efter varje uppgift; grinden (körning 5):
  `uppdragsytan-stromniva` 19/19, `npm run typecheck` exit 0 och hela `npm
  test` 222 filer och 4386 prov gröna (1136 s). `npm run build` är inte kört
  (kedjan nekar det). Inga RESTER. Efter driftsättningen får cachens
  tröskelvärden strömnivån vid nästa svep; Pengarnas panel Förbrukning per
  nivå visar strömraderna direkt. Designskillen `impeccable` gick inte att
  köra (Skill-felet «Execute skill: impeccable»); `accessibility` tillämpades,
  och raderna använder husets `nivarad` utan nya klasser. Rött utanför repot,
  orört av berättelsen: continuityvakt (KUNDE_INTE), overlamningsregister_fr6
  och scope_grind (RÖDA) i provvaktens körning 2026-11-27.

- **2026-11-27 — Bygge: 5-4-inget-prognosdatum-visas-utan-beslutad-regel.**
  Svepet förlänger inte längre ramdatumet bortom den sista bokningen:
  bokningar som inte når ramen ger villkoret «ingen bokad framtid» (Davids
  svar 2026-10-23). Cachevärdet `prognos` bär nu `kalender` (`last`/`olast`)
  och `framtida_handelser`, skrivet av den rena `prognosvarde` i
  `uppdragSvep.ts`; en utelämnad lista `kalenderhandelser` är en oläst kalender
  («underlaget kunde inte läsas»), aldrig en tom. Ny ren regel `prognosplats`
  i `lib/prognosplats.ts` med `PROGNOSREGEL` (beslutad men inte införd; Story
  5.5 och 5.6 inför den) och ny ren vyfil `uppdragPrognos.ts` med husets
  härledningsrad. Pengarna och Läget bär `prognos` som `Lasvarde` ur samma
  anrop och samma cacherad, och `las_uppdragslage` lämnar fältet. Pengarna
  ritar ingen kurva och inget ramdatum; Lägets kort Förbrukning mot ram visar
  platsen per avtal. Kurvfunktionen i html-modulen står kvar utan anropare
  till Story 5.6. Ingen migration, ingen rutt, ingen åtgärd, inget
  indatafält och inget beroende. `docs/MCP_ACTIONS.md` beskriver värdenas nya
  form och `docs/ARKITEKTUR.md` har stycket «Prognosplatsen». Prov:
  `uppdragsytan-prognosplats` (PF0–PF6, 37 prov, hjälpfil
  `prognosplatsHelper.ts`) och omskrivna fall i prognos-, svep- och
  pengaprovet. Körningar mot testdatabasen: delkörningarna 1–4 gröna (9, 333,
  22 och 377 prov), `uppdragsytan-prognosplats` 37/37, `npm run typecheck`
  utan fel enligt den tidigare byggloggen. Fortsättning med Codex 2026-11-27:
  `npm run typecheck` exit 0; riktat `npm test -w server --
  uppdragsytan-prognosplats` och hela `npm test` stoppas före testfallen,
  exit 1: `Error: connect EPERM 127.0.0.1:5433 - Local (undefined:undefined)`.
  Testfallen är inte körda i fortsättningen; kedjan verifierar dem enligt
  databasundantaget. Även steg 9:s upprepade fullsvit stoppas före fallen
  med samma EPERM; förnyad typkontroll exit 0 och git diff --check exit 0.
  DoD prövad punkt för punkt i berättelsens Dev Agent Record; överlämning
  till review med databasgrinden kvar hos kedjan. Inga RESTER enligt tidigare bygglogg. Designskillsen
  gick inte att läsa (utanför arbetskatalogen); vyn granskades för hand mot
  husets tokens. Efter driftsättningen får cachens prognosvärden den nya
  formen vid nästa svep; till dess visar platsen «underlaget kunde inte
  läsas» med radens lästid. Därefter visar ett uppdrag med bokad framtid
  «slutdatum härleds inte: prognosregeln är beslutad men ännu inte införd»
  och ett utan bokad framtid «ingen bokad framtid»; ingen köpost, fråga eller
  post i undantagsvyn uppstår. CRM-kontraktet berörs inte. Inga tjänster,
  webbläsarprov eller driftprov startade. bmadglidning står RÖD enligt
  berättelsens tidigare baslinje; Hermes-proven körs av kedjan.

- **2026-11-27 — Bygge: 5-3-trosklarna-indikerar-avvikelse-men-filtrerar-aldrig-ett-mandat.**
  Tröskelregeln i `lib/troskel.ts` prövar nu nivåns egen ram genom
  `egenRam` (ett tak summerat ur barnen, `cap_derived`, är ingen ram), skriver
  `utan_egen_ram` (kod och enhet, inga tal) för varje mätnivå utan egen ram,
  tänder ett ärvt intervall dagen efter slutet (`ARVT_INTERVALL_DAGAR`) i
  stället för efter avtalets fem dagar, och bär golvets märkning
  `GOLVETS_MARKNING` («förslag, ej beslutat av David», Story 5.7 byter den)
  med `golvetBinder`. `forbrukningsnivaer` läser samma `egenRam`. Pengarnas
  läsväg ger `Troskelvarde`; ett cachevärde utan ramläget läses som `null`.
  Panelen Tröskeln visar tröskelregeln och «<kod>: <enhet> — ram saknas»
  (ny ren vyfil `uppdragTroskel.ts`), och tim- och kronlarm där golvet binder
  bär märkningen på Pengarna och i Lägets kort. Undantagsvyn är orörd:
  `lasUndantag` läser aldrig tröskeln, vaktat av MA1 (riktig tänd indikator,
  100 öre-bindning och baselineändring över sänkta och höjda trösklar) och
  MA2 (tillåtelselista över filer, negativ kontroll). Ingen migration, ingen
  rutt, ingen åtgärd, inget beroende. `docs/MCP_ACTIONS.md` beskriver
  värdets nya form (`utan_egen_ram` och dagsregeln för ärvt intervall), och
  `docs/ARKITEKTUR.md` har stycket «Troskeln indikerar, aldrig ett mandat».
  Tröskelprovets ärvda dagslarm och grannavtalets värde skrivna om enligt
  berättelsens Task 1.2. Körningar mot testdatabasen: delkörningarna 1–3
  gröna (126, 75 och 257 prov), `uppdragsytan-troskelmandat` 37/37 grönt,
  `npm run typecheck` utan fel och hela `npm test` grönt: 220 filer, 4323
  prov, exit 0. Inga RESTER. Efter driftsättningen får
  cachens tröskelvärden den nya formen vid nästa svep; till dess visar
  panelen «Ramläget per nivå står här efter nästa svep». Ett uppdrag vars
  leverabler bara ärver ett passerat stegintervall får dagslarmet direkt vid
  det svepet, utan köpost eller post i undantagsvyn.

- **2026-11-27 — Omtag: 5-2-forbrukningen-mot-ram-tar-med-det-som-inte-ar-fordelat.**
  Granskningsfyndet om saknad taxa vid flera avtal rättat i
  `uppdragForbrukning.ts`: uppdragets ofördelade tid visar nu hur mycket tid
  som saknar taxa och att kronorna för den tiden inte kan härledas.
  Beskedet delas med avtalspanelens befintliga text. Båda återgivningarna
  av ofördelade belopp har kontrollerats; beräkning och fördelning följer
  samma regel. V0 i täcker helt och delvis saknad taxa i båda panelerna,
  full taxa, giltig nolltaxa och tomt. V1 g täcker riktiga sidan med två
  respektive tre avtal, känt belopp, luckans minuter, egen färskhet och
  oförändrade tidposter. Husets paneler, Public Sans, skala och färger
  används för att hålla beskedet nära beloppet och läsbart utan nya
  kontroller. Tomt och oläst följer befintliga lägen; laddning och sidfel
  följer serverrenderingen. Ingen migration, rutt, åtgärd eller beroende
  tillkom; CRM-kontraktet berörs inte. Testförsök före och efter rättelsen,
  riktade regressioner och fullsviten stoppas före fallen: exit 1,
  `Error: connect EPERM 127.0.0.1:5433 - Local (undefined:undefined)`.
  Fallen är inte körda; kedjan verifierar dem enligt databasundantaget.
  Typkontroll före och efter rättelsen: exit 0.
  Även steg 9:s upprepade fullsvit stoppas före fallen med samma EPERM.
  DoD prövad punkt för punkt i Dev Agent Record; Status åter review med
  databasundantaget öppet. git diff --check utan fel.
  Inga tjänster, visuella webbläsarprov, byggen eller driftprov startade.
  bmadglidning står RÖD enligt tidigare baslinje. Läget saknar fortsatt
  ofördelad tid tills Story 6.1 och 6.2 läser samma regel.

- **2026-11-27 — 5-2-forbrukningen-mot-ram-tar-med-det-som-inte-ar-fordelat.**
  Pengarna läser ofördelad förbrukande tid en gång per uppdrag, med husets
  taxeordning och öresregel. Den rena nivåregeln räknar totalen med ofördelat
  vid ett avtal, visar egen ram per nivå och gissar ingen leverabel eller
  strömram. Flera avtal visar ofördelat en gång före avtalen. Förbrukningens
  läsningar skyddas med savepoint och blir olästa vid fel. Kostnaderna bär
  källa och lästid per avtal och rad. Husets Public Sans, tokens, numeriska
  tabeller, statuschip och tomgrammatik följs; befintlig mobilstapling och
  fokusordning används utan nya kontroller, CSS eller skript. Laddning och
  sidfel följer den befintliga serverrenderingen. Ingen migration, rutt,
  åtgärd eller nytt beroende tillkom; CRM-kontraktet oförändrat. Inga RESTER.
  N0 a–l, N1, F1 a–i, V0 a–h, V1 a–f, A1 a–c och D1 är skrivna i
  uppdragsytan-forbrukning och dess rena hjälpfil. Befintliga prov ändras
  endast enligt Task 2.5 och 3.5. Typkontrollen har passerat efter Task 1–4.
  Riktade och fulla testförsök före/efter kodstegen gav exit 1 före fallen:
  `Error: connect EPERM 127.0.0.1:5433 - Local (undefined:undefined)`.
  Fallen är inte körda här och kallas inte gröna; kedjan kör typkontrollen
  och hela sviten före granskningen. Slutgrinden: typkontroll exit 0,
  riktat och fullt npm test exit 1 före fallen med samma EPERM; även den
  upprepade fullsviten i steg 9 stoppas före fallen. git diff --check exit 0.
  Definition-of-done prövad i berättelsens Dev Agent Record punkt för punkt,
  med testgrinden uttryckligen öppen enligt databasundantaget. Status review.
  Ingen tjänst eller visuell webbläsarkontroll startad, inget bygge eller
  Hermes driftprov kört. bmadglidning står RÖD sedan tidigare enligt
  berättelsens baslinje. Läget visar ännu förbrukningen utan ofördelad tid
  tills Story 6.1 och 6.2 läser samma regel. Kedjan granskar, mergar och
  driftsätter; ingen driftåtgärd utförd här.

- **2026-11-27 — Omtag: 5-1-varje-kostnadsbindning-nar-david-som-forifyllt-forslag.**
  Granskningsfyndet om sex saknade provfiler prövat mot git, inte bara
  arbetskopian. Alla sex finns redan i `main...HEAD`, commit `0747ec0`:
  `server/test/kostnadsforslagHelper.ts` (+110),
  `server/test/uppdragsytan-kostnadsforslag.test.ts` (+363),
  `server/test/uppdragsytan-kostnadssparr.test.ts` (+24/-20),
  `server/test/uppdragsytan-svep-bindning.test.ts` (+9/-7),
  `server/test/uppdragsytan-svep.test.ts` (+3/-2) och
  `server/test/uppdragsytan-bindning.test.ts` (+3/-5).
  Hela File List kontrollerad: 19/19 kod-, prov- och dokumentpatchar finns;
  19 negativa kontroller upptäcker varje utelämnad patch. Diffen har
  122 428 tecken och första provpatchen börjar vid index 63 959. En
  simulerad kapning vid 60 000 tecken döljer exakt fyndets sex provfiler;
  faktisk kapning i kedjan är inte bevisad. Belägget är fullständig
  `git diff main...HEAD --numstat -- server/test` och filvisa patchar.
  Ingen produktionskod eller provassertion ändrad, ingen migration,
  rutt eller nytt beroende; CRM-kontraktet oförändrat. Stilvalet står kvar:
  husets Public Sans, skala, tabeller och Oplanerad-chip gör kostnadsraderna
  igenkännbara. Typkontroll exit 0. Riktad och full `npm test` gav exit 1
  före fallen: `connect EPERM 127.0.0.1:5433`. Databasfallen är inte körda
  i omtaget; tidigare grönt utfall nedan är historiskt. Kedjan kör sviten
  före granskningen enligt databasundantaget. Bygge och Hermes driftprov
  inte körda här, inget nytt driftutfall påstås.

- **2026-11-27 — 5-1-varje-kostnadsbindning-nar-david-som-forifyllt-forslag.**
  Svepet förifyller bindningsförslag ur titel, tidigare leverantörsbindning
  och uppdragets namn i bokföringstext, med skäl, källor och stabil hash.
  Delat strikt schema prövas före kön och av läsvägen. Öppna mandat och
  äldre förslag spärrar alltid; ändrat underlag kan köas efter avgörande.
  Verkställigheten märker leverabelbindningar Oplanerad och tar aldrig bort
  märkningen. Cachen och förslaget bär inga belopp eller leverantörsnamn.
  Pengadelen visar bokförd total inklusive obundet, och rapporten läser
  periodens oplanerade kostnader levande. Ej bokfört visas utan belopp.
  Husets Public Sans, skala, tabeller, chip och fokusram används; inga nya
  kontroller ändrar fokusordningen. Tomt och oläst underlag har egna besked,
  och serverrenderingen använder befintlig laddning och felsida.
  Ingen migration, rutt eller nytt beroende tillkom; CRM-kontraktet berörs
  inte. Inga RESTER. 40 nya fall F0–F5 samt föreskrivna uppdateringar av
  kostnadsspärrs- och svepproven. Typkontroll exit 0. Sandlådans testförsök
  före/efter varje uppgift gav EPERM på 127.0.0.1:5433 före fallen; med
  utökad verktygsbehörighet nåddes samma stående testdatabas. Första riktade
  körningen gav 39 gröna och ett riggfel (blanksteg i testmejladressen), som
  rättades. Slutgrind: `npm run typecheck` exit 0, hela `npm test` exit 0:
  `Test Files 217 passed (217)`, `Tests 4233 passed (4233)`, inklusive
  alla 40 nya. `git diff --check` exit 0. DoD prövad punkt för punkt och
  berättelsen/sprintposten står review. Bygge och Hermes driftprov är inte
  körda här enligt uppdraget; inget nytt driftutfall påstås.

- **2026-11-27 — Likvida medel (Davids fynd 27/11):** `bank_ore` räknas t.o.m. i dag (Europe/Stockholm); `dashboard` ger datum-, framtids- och bankavstämningsfält; kortet säger «Bokfört … per <datum>» och om banken är inläst. Prov: `server/test/likvida-medel.test.ts`.
- **2026-11-27 — Story 5.11 (crm).**
  AI-samtalet tillagt bland löftesvägarna i `CAPTURE_PATHS_IN_OPERATION`;
  hintens form skiljer källor från tillfällen enligt UX K8. De befintliga tre
  löftesytorna läser fortsatt samma textbyggare. Husets Public Sans, textskala,
  färgtokens, hintar, tomlägen och fokusram används; markup och fokusordning
  är oförändrade. Två nya provfiler: S1–S6 täcker konstant, exakta texter,
  slutna typer och hintformer; Y1–Y4 läser de renderade ytorna; U0–U3 tar bort
  AI-samtalet ur konstanten. Y5 prövar stycket i `docs/MCP_ACTIONS.md`.
  Exakta facit uppdaterade i fem befintliga provfiler. Faktiskt rött före kod:
  hintassertionen, S1/S2/S5 och Y5. Typkontroll och bygge exit 0; S1–S6,
  P1–P8 och Y5 gav `Tests 15 passed | 13 skipped (28)` i kompletterande
  Vitest-körning utan databasuppstart. Hela `npm test` har anropats före och
  efter varje uppgift men stannar före fallnivå med
  `connect EPERM 127.0.0.1:5433`; vyprov och full regression är därmed inte
  körda här. Kedjans testgrind återstår enligt databasundantaget.
  Inget API-kontrakt ändrat. Texterna lovar fångsten i AI-samtalet:
  driftsättningen förutsätter att 5.10:s avsnitt står i valvets CLAUDE.md och
  att provet loftesfangst säger *avsnittet finns*. Det är inte verifierat här.

- **2026-11-27 — Omtag: 4-3-uppdragsvyn-visar-nasta-leverans.**
  Rättat D1:s Markdown-avgränsning i
  `server/test/uppdragsytan-nasta-leverans.test.ts`: ett borttaget `#` gjorde
  öppningsrubriken till en falsk slutrubrik. Båda utdragen använder nu samma
  radbaserade hjälpare. D1 täcker 14 kombinationer av rubriknivåer, LF/CRLF,
  underrubriker, grannavsnitt och filslut, med rubrikomnämnanden och lika
  prefix före öppningsraden. Innehållskraven och negativa kontrollerna behålls.
  Kedjans bifogade D1-FAIL är det körda röda belägget. Lokal typkontroll
  före/efter rättelsen och bygge efter rättelsen exit 0; git diff --check exit 0.
  Riktad körning före rättelsen och hela `npm test` efter rättelsen inte körda
  på fallnivå: globalSetup ger `connect EPERM 127.0.0.1:5433`, exit 1.
  Kedjans testgrind återstår enligt databasundantaget; inga lokala PASS eller
  nya driftutfall påstås. Husets textskala, Public Sans, statuschip och
  fokusram ger fortsatt samma läsrytm och tangentbordsstöd som Lägets kort.
  Ingen migration, rutt, åtgärd eller nytt beroende tillkom; CRM-kontraktet berörs inte.

- **2026-11-27 — 4-3-uppdragsvyn-visar-nasta-leverans.**
  Regeln i `server/src/lib/nastaLeverans.ts` väljer nästa leverans ur registret
  och `byggPlan`: kandidatlägen, tidigaste eget eller ärvt slut, numeriskt
  L-nummer och odaterade sist. `server/src/services/uppdragLage.ts` bär beskedet
  med källa och lästid per avtal. Lägets befintliga leverabelkort visar datum,
  acceptanskriterium, kontraktsmottagare före överlämning och transmittal efter,
  samt registrerad och nästa revision. Husets textskala, typografi, statuschip,
  färskhetsrad, tomgrammatik och tangentbordets fokusram används. Inga RESTER
  hittades. Ingen migration, rutt, åtgärd eller nytt beroende tillkom;
  CRM-kontraktet berörs inte. 22 nya fall i
  `server/test/uppdragsytan-nasta-leverans.test.ts`, skrivna före respektive kod.
  Typkontrollen var röd före regelmodulen (TS2307) och läsvägsfältet (TS2339),
  sedan grön efter uppgift 1–3. Riktade tester och hela `npm test` inte körda
  på fallnivå: globalSetup ger `connect EPERM 127.0.0.1:5433`, exit 1.
  Slutgrind: `npm run typecheck` och `npm run build` exit 0; hela `npm test`
  exit 1 före fallen med samma EPERM. Kedjans typkontroll och hela testsvit
  återstår som exekverande belägg; inga nya driftutfall påstås.

- **2026-11-27 — Omtag: 4-4-faktureringsflodet-laser-godkanda-leverabler-som-underlag.**
  Rättat läsordningen i `server/src/services/invoiceFromTime.ts`: samtliga
  avtals register läses före den gemensamma godkännandehistoriken. Med
  READ COMMITTED kunde ett godkännande annars committa mellan frågorna och
  ge en falsk saknasvarning i både åtgärdssvaret och projektsidan.
  A8 i `server/test/uppdragsytan-faktureringsunderlag.test.ts` skrevs före
  rättelsen: fyra samtidighetsförlopp med ett/flera avtal, commit efter
  historiken, före sista registret och efter sista registret. Riktiga
  HTTP-godkännanden mellan riktiga Postgres-frågor; inga databassvar mockas.
  Befintliga A2/V4 behåller varningen när historiken faktiskt saknas.
  Husets befintliga tabell, typografi, tomläge och fokusram passar fortsatt
  projektsidan. Läsfel följer befintlig felsida och laddning serverrenderas.
  Inget kontrakt, beroende, schema eller rutt ändras; 218 actions kvar.
  Typkontroll före/efter rättelsen exit 0. Riktade tester och hela `npm test`
  ej körda på fallnivå: globalSetup ger `connect EPERM 127.0.0.1:5433`, exit 1.
  Kedjans exekverande grind återstår enligt databasundantaget; inga gröna
  databasutfall eller nya driftutfall påstås. CRM-kontraktet berörs inte.

- **2026-11-27 — 4-4-faktureringsflodet-laser-godkanda-leverabler-som-underlag.**
  Faktureringsflödet läser godkända leverabler ur registret genom regeln och
  den gemensamma läsningen i `server/src/services/invoiceFromTime.ts`.
  Läsåtgärden `las_faktureringsunderlag` och projektsidans block visar samma
  underlag med registerfält, godkännandets händelse, källa och lästid per avtal.
  Saknat godkännande varnas; ett tomt underlag förklaras. Husets tabell,
  textskala, färskhetsrad och varningschip används för att följa projektsidan.
  Tabellens rullningsyta kan fokuseras med tangentbord och får husets fokusram;
  kolumnrubriker har scope. Serverrenderat utan separat klientladdning;
  befintlig felsida hanterar läsfel utan att visa ett falskt tomläge.
  Ingen migration och ingen rutt tillkom; rubrikstycket anger nu 218 actions.
  21 nya fall R1–R6, S1–S2, A1–A7, V1–V4 och D1–D2 skrevs före respektive
  implementation. Avslutsprovets fyra panelkontroller avgränsas till panelen.
  Typkontroll efter uppgift 1–4 samt före dokumentändringen: exit 0. Rött för
  uppgift 1 och 2 belagt med saknade exporter i typkontrollen. Databasprov
  inte körda på fallnivå: rött/grönt-försök och fulla regressioner stoppades
  i globalSetup med `connect EPERM 127.0.0.1:5433`, exit 1. Kedjan kör den
  exekverande grinden enligt uppdragets databasundantag. Inga gröna databas-
  eller visuella webbläsarutfall påstås. Inga RESTER; minnet är inte installerat.
  Steg 9:s fulla regression stoppades också före fallen med samma EPERM.
  DoD:s 26 punkter prövade; berättelsen och sprintstatus står review med
  det uttryckliga databasundantaget. Diffkontroll exit 0.
  CRM-kontraktet berörs inte. Inget nytt driftutfall verifierat.

- **2026-11-27 — Omtag 2: 4-2-overlamningen-registreras-ur-den-faktiska-handlingen.**
  Omtagets U4/O4 och kontrollvakter körda före någon kodändring tillsammans
  med överlämningsfilen: 45/45 gröna i två filer, exit 0. Typkontroll exit 0.
  Första sandlådeförsöket nekades med EPERM på testdatabasen; därefter kunde
  det godkända testkommandot ansluta till den stående databasen. Full regression
  körd ensam: 4131/4131 tester i 212 filer gröna, exit 0, 1083.55 s.
  De rapporterade U4/O4-felen och anslutningsexceptionen kunde inte återskapas;
  avbrottsorsaken i den tidigare körningen är inte fastställd. Ingen belagd
  kodorsak funnen vid genomgång av hela berättelsens ändring. Inga kod- eller
  provändringar; migration `0099_overlamningshandling.sql` och husets formspråk
  bevarade. Vid slutverifieringen åter grönt: typkontroll exit 0 och riktat
  45/45 i två filer, exit 0 (25.75 s, start 07:00:09). Även detta försök
  behövde godkänd databasåtkomst efter sandlådans EPERM. Steg 9:s slutliga
  fullregression körd ensam: 4131/4131 tester i 212 filer gröna, exit 0,
  start 07:00:42, 1049.33 s. Utskicksfilens 20 och CRM-proveniensfilens 81
  gröna i samma körning, inga ohanterade fel. Diffkontroll exit 0. Slutlig
  DoD prövad punktvis före review; inget databasförbehåll behövs för slututfallet.
  Inga nya visuella webbläsarprov eller driftutfall; CRM-kontraktet oförändrat.

- **2026-11-27 — Omtag: 4-2-overlamningen-registreras-ur-den-faktiska-handlingen.**
  Kedjans S7-fel kom av testets antagande att `/approvals` är tom efter en
  kontraktsimport; läsvägen visar också verkställd historik. Testet i
  `server/test/uppdragsytan-overlamning.test.ts` jämför nu hela kön före och
  efter vart och ett av de tre spärrade agentanropen. Två varianter täcker
  importhistorik respektive importhistorik med ett väntande förslag; en legitim
  köskrivning visar att jämförelsen upptäcker ändringar. Händelser, statusar,
  referenser och audit jämförs också efter varje anrop. Samma felklass sökt i
  alla tre berörda provfiler: övriga kökontroller kräver ingen rättelse.
  Produktionskoden och migration `0099_overlamningshandling.sql` ändras inte
  i omtaget; gränssnittets befintliga tokens, fält och fokusordning bevaras.
  `npm run typecheck` exit 0 före och efter rättelsen. Rött/grönt-försök och
  full regression med `npm test` stoppade i globalSetup med
  `connect EPERM 127.0.0.1:5433`, exit 1; inte körda på fallnivå, inga gröna
  databasutfall påstås. `git diff --check` exit 0. Dev Agent Record uppdaterad
  och DoD:s 26 punkter prövade före återgång till review enligt det uttryckliga
  databasundantaget; även steg 9:s fulla regression stoppades före fallen.
  CRM-kontraktet och driftutfallet berörs inte.

- **2026-11-27 — 4-2-overlamningen-registreras-ur-den-faktiska-handlingen.**
  Överlämningen registreras med mejlet eller dokumentet som referens, mottagaren
  förifylld ur kontraktet och ändringsbar. Migration `0099_overlamningshandling.sql`
  binder händelsens referens till samma bolag och avtal. Datumet läses enbart ur
  handlingen, revisionen räknas per överlämning och godkännandet bevarar transmittalen.
  Statusförslag visas inte längre som uppgifter på förstasidan eller Läget;
  Registrera överlämning och Retur står på Pågår-kortet i Leveranserna, med
  befintlig POST-adress och samtliga tre människospärrar bevarade. Godkänn visar
  parterna och godkännandeformen. Husets fält, knappar, textskala och fokusmarkering
  används; synligt obligatoriskt fält, etiketter och unika knappnamn ger tangentbordets
  ordning. Befintliga tomlägen och felnotiser används, saknad mottagarpart visas.
  De 24 specificerade fall-id:na U1–U4, S1–S7, R1–R4, G1, V1–V6 och D1–D2
  ligger i ny provfil, före respektive kodändring; fyra utpekade gamla vyfall
  borttagna och bara berättelsens påståendegrupper uppdaterade. Berättelsens
  löptext säger 25, men dess ändliga lista räknar 24; inget nytt fallkrav antas.
  Typkontroller för uppgift 1–5 och slutlig kodstädning exit 0 efter två rättade typfel (literaltyper i
  nya testkonstanter och saknad LUCKTEXT-import). Databastester inte körda på
  fallnivå: alla rött/grönt-försök och fulla regressioner stoppades i globalSetup
  med `connect EPERM 127.0.0.1:5433`, exit 1; kedjan kör den exekverande grinden.
  Inga gröna databasutfall eller visuella webbläsarprov påstås. Inga RESTER;
  CRM-kontraktet berörs inte. Inget nytt driftutfall verifierat. DoD:s 26 punkter
  prövade och berättelse/sprintstatus review med det uttryckliga databasundantaget;
  även steg 9:s slutliga fulla regression stoppades av EPERM före fallen.
- **2026-11-27 — Tidsgodkännandet kräver en människa (Davids beslut 26/11 22:03, «ja»).**
  `approve_time_entries` bär `kravManniska: true` i registret, med en kommentar
  om skälet: godkänd tid är det som faktureras. Ett agentanrop, till exempel
  Hermes MCP-nyckel, får 403 `human_required` före varje skrivning, oavsett
  status. Det ger ingen köpost, ingen auditrad och ingen statusändring.
  Andra varvet stängde den andra vägen: `update_time_entry` lät en agent byta
  `forslag → godkand` och ändra minuterna på godkänd tid. `updateTimeEntry`
  (och `approveTimeEntries`, som anropar den) tar nu aktören som
  `createTimeEntry`. En agent får 403 `human_required` för varje statusbyte och
  för varje post som inte är `forslag`. Spärren prövas efter `expected` och före
  första skrivningen. Hermes komplettering med `status: 'forslag'` (Story 10.2)
  går som förut. Tolkningen är att beslutet 26/11 gäller båda vägarna. Ska
  agenten få röra beslutad tid igen, ändras villkoret i `updateTimeEntry`.
  `propose_time_entries` är orörd, och vyns godkännande (`korTidsAction`, actor
  `human`) går igenom som förut. Testerna i `tidsforslag.test.ts`: deklarationen,
  agentens avvisade godkännande i båda åtgärderna, agenten mot godkänd tid och
  människans godkännande. Agentens förslag prövas redan i intagstestet. I
  `tidpost-livscykel.test.ts` (P8) anropas `updateTimeEntry` direkt med aktör.
  Körningarna gjordes med `TEST_DB_NAME=redovisning_test_tidgodk`, eftersom en
  hel svit körde i `/opt/redovisning/server` mot `redovisning_test`. Grön
  körning: båda filerna gav 86/86. Typecheck och build gav exit 0. Röd
  kontroll: utan båda spärrarna fälls 5 av 43 i `tidsforslag`, och utan
  tjänstespärren fälls 2 av 43. Utan bara flaggan fälls 1 av 43
  (deklarationen), eftersom tjänsten stoppar agenten ändå. **Obs:** två tidiga
  körningar mot standardnamnet hann starta globalSetup (`DROP DATABASE … WITH
  (FORCE)`) medan den hela sviten körde. Den sviten kan ha fått fel som inte är
  kodfel. Hela sviten är inte körd här. Öppet (lågt, gäller alla
  `kravManniska`): MCP-verktygslistan säger inte att åtgärden kräver en
  människa. MCP_ACTIONS är uppdaterad. Ingen migration och inga nya beroenden.

- **2026-11-27 — 4-1-bradan-och-tabellen-visar-samma-falt.**
  Registret läser revision och mottagare ur senaste överlämningen med bolagsfilter.
  Brädan och tabellen renderar samma elva fält ur en ren lista och cellrenderare,
  med gemensamma saknastexter och samma härledda ålderstext. Ingen migration;
  överlämningsdatumet står som saknat tills Story 4.2 ger det handlingens datum.
  Femton nya fall R1–R5, F1–F3, B1–B6 och D1 samt fem föreskrivna gamla
  påståenden ändrade. Typkontroll efter uppgift 1–4 och slutlig kontroll exit 0. Rött före kod
  belagt med saknade fält (TS7053/TS2339) och modul (TS2307).
  Databastester inte körda på fallnivå: samtliga rött/grönt-försök och fulla
  regressioner hittills stoppas i globalSetup med `connect EPERM 127.0.0.1:5433`,
  exit 1. Även steg 9:s fulla regression stoppades före fallen. DoD:s 26 punkter
  prövade; berättelsen och sprintstatus står review med EPERM-undantaget.
  Kedjan kör den exekverande grinden före granskningen. Inga gröna databasutfall påstås.
  Inga RESTER hittades; inget nytt driftutfall verifierat. CRM:s intagskontrakt
  berörs inte. Husets kort, statuschip, typografi och tokens bevaras; listan
  följer kontraktsytans skala och radbryter i brädans smala kolumner. Befintliga
  formulär och fokusordning, tomlägen och felvägar bevaras; inga klientladdningar
  tillkommer i den serverrenderade ytan. Inga beroenden eller tjänster tillkom.

- **2026-11-27 (Story 3.6, 3-6-kopians-kopost-bar-sin-frysta-version-och-kvitteras-bara-for-den):**
  Arbetslistan läser versionens frysta text och rader med version, hash och
  fil-id i en fråga. Svepet fryser öppna avtals äldre köposter utan version
  under avtalslåset. Kvittensen prövar version/hash, är idempotent, ersätter
  bara äldre oskrivna poster och räknar mottagna försök utan tak. Ingen
  migration, vy, rutt eller nytt beroende. H1–H4, H7, H9, Q1–Q8 och D3 tillagda
  i 3.3:s provfil; drive-ko-provets typ och kommentar följer frysta rader.
  Typkontroller för uppgift 1–4 passerade (exit 0). Databastester **inte körda**:
  varje försökt röd/grön körning stoppades i globalSetup med
  `connect EPERM 127.0.0.1:5433`. Körning 4:s hela svit stoppades likadant;
  steg 9:s omkörning stoppades också före fallen. Inga gröna databastestutfall
  påstås. DoD prövad punktvis, berättelsen står review med miljöundantaget;
  kedjan kör den exekverande grinden.
  Inga RESTER-träffar vid ingången. Driftproven körs av kedjan efter leverans;
  inga nya driftutfall är verifierade här. MCP_ACTIONS beskriver kontraktet;
  CRM-kontraktet berörs inte. Befintligt formspråk behålls eftersom berättelsen
  uttryckligen förbjuder nya användarytor och teknisk köstatus för David.

- **2026-11-27 — Omtag: 3-3-registerkopian-ar-versionsbunden-har-fryst-underlag-och-syns-aldrig-som-kostatus-for-david.**
  Fyra AI-granskningspunkter rättade som tre felklasser: verifieringens
  skrivväg håller oskrivna kopior overifierade, spärrdomen följer fil-id:t
  över versionerna med verifierad återhämtning, och båda kvittensutfallen
  läser tillstånd först under avtalslåset. Även verifieringen delar låset,
  så spärrdom och ny köpost ser varandra. 20 nya fall F1–F7 i
  `server/test/uppdragsytan-registerkopia.test.ts` täcker oskrivna lägen,
  äldre poster utan köläge, ärvda id:n, HTTP-förlopp, fortsatt spärr och
  återflytt, byte av filidentitet och åtta samtidighetsfall.
  Befintliga huskomponenter och statusetiketter används; tokens, typografi,
  fokus och tangentbordsordning följer befintliga ytor. Ingen ny kontroll
  eller vy införs. Migration 0098 står oförändrad; arbetslistans frysta
  innehåll och versionsbundna kvittens byggs i Story 3.6.
  Typkontroll före/efter varje rättning och i slutkontrollen exit 0.
  Vitest (rött/grönt-försök och full regression) inte kört på fallnivå:
  `connect EPERM 127.0.0.1:5433` i globalSetup, exit 1. Kedjan kör grinden
  enligt uppdragets nätverksundantag. Inget nytt beroende eller CRM-kontrakt,
  ingen tjänststart eller driftsättning. Minnet är inte installerat.

- **2026-11-27 — 3-3-registerkopian-ar-versionsbunden-har-fryst-underlag-och-syns-aldrig-som-kostatus-for-david.**
  Migration 0098 fryser registerkopians text, rader, version och sha256 som
  FRYST HISTORIK med RLS, append-only-rättigheter och sammansatt hashkoppling.
  Varje registerändring ger en ny köpost under avtalslås, med ärvt Drive-id;
  öppna poster utan version ersätts och gamla kvittenser lämnar dem orörda.
  Referenslistorna visar senaste kopieposten. Drive-id skyddas mot vanliga
  referenser under samma avtalslås i båda riktningarna. Köraden är borttagen
  ur projektsidan; befintliga tokens, typografi, kontrast och fokusordning
  bevaras. Inga nya kontroller eller tillstånd införs. Arbetslistan och den
  versionsbundna kvittensen byggs i Story 3.6. 23 nya fall R1–D1 i
  `server/test/uppdragsytan-registerkopia.test.ts`; KRAV-2 vänt och KRAV-7
  ersatt enligt berättelsen. Typkontroll efter uppgift 1–5 exit 0; det
  förväntat röda exportfelet före uppgift 1 belagt med TS2305 (exit 2).
  Rött/grönt-försök, körning 1–5 och fullsviten: inte kört på fallnivå,
  `connect EPERM 127.0.0.1:5433` i globalSetup (exit 1). Kedjan verifierar
  enligt nätverksundantaget. Slutgrinden: typkontroll exit 0, hela npm test
  exit 1 i globalSetup av samma nätverksskäl; inga testfall körda.
  Inga RESTER. CRM:s intagskontrakt är oförändrat. Inget nytt beroende,
  ingen tjänststart eller driftsättning. Hermes driftprov har inte omprövats.

- **2026-11-26 — 2-8-forslagets-underlag-visar-luckorna-parterna-och-ankaret.**
  Gemensam ren beräkning av parter, ankare och luckor i importens svar och
  baselineförslagets förklaring. Undantagsvyn för vidare manifestet; samma
  från/till och skäl visas på Att göra, med skillnader och konsekvensen av
  ett ja trots luckor. Husets befintliga kort, tokens, typografi, fokusordning
  och tom-/fellägen används. Tolv nya fall (F1–F4, U1–U7, D1) i
  `server/test/uppdragsytan-luckunderlag.test.ts`. Typkontroll efter uppgift
  1–4 och slutgrinden exit 0; förväntat röda typfel för saknad modul/läsning
  belagda före kod.
  Rött/grönt-försöken, körning 1–4 och fullsviten: inte kört på fallnivå,
  `connect EPERM 127.0.0.1:5433` i globalSetup (exit 1). Kedjan kör grindarna
  enligt uppdragets nätverksundantag. Inga RESTER och inga baslinjefel rättade.
  CRM:s intagskontrakt oförändrat. Ingen migration eller nytt beroende.

- **2026-11-26 — Omtag Story 2.4: vyassertioner och dokumentationens kodspann.**
  I `server/test/uppdragsytan-kontraktsluckor.test.ts` läses nu rubrikernas
  innehåll och koder med husets tillgänglighetsattribut. V1 kräver åtta
  kolumner i ordning och har ett rent läsarprov över flera markupformer
  med negativa kontroller. D1 prövar hela dokumentationstilläggen mot
  ensamma snake_case-spann; flera fält, lägen och ett framtida ord planteras
  som negativa kontroller. `docs/MCP_ACTIONS.md` använder kvalificerade fält,
  samlade lägesvärden och åtgärdssignaturer. Samma felklass sökt i hela diffen:
  inga nytillkomna ensamma snake_case-spann, och matt-rytm-/scopelinje-/
  utskicksprovens kodspannssökning ger [] för alla tre. Båda felklasserna
  visades röda före rättelserna, sedan **11 rena fall gröna** (25 överhoppade).
  **Typecheck och build exit 0.** Full `npm test` försökt före och efter:
  `connect EPERM 127.0.0.1:5433` i globalSetup, inga databasfall körda.
  Kedjan verifierar fullsviten enligt uppdragets nätverksundantag.
  Ingen produktionskod ändrad i omtaget; husets stil och tillgänglighet
  bevaras. CRM:s intagskontrakt oförändrat. Inget nytt beroende eller tjänst,
  ingen driftsättning. Hermes-provens tidigare lägen har inte omprövats.

- **2026-11-26 — Story 2.4 (uppdragsytan): kontraktsluckor, parter och manifestankare.**
  Migration `0097_kontraktsparter.sql` lägger till nullbara `godkannandeform`
  och `godkannare_kalla`, BASELINE-kommentarer och egen avslutsspärr för de
  fyra partskolumnerna. `lib/kontraktsluckor.ts` är enda regel- och textkälla
  för luckor, parter och manifestets ankare. Importen tar ett valfritt strikt
  manifest, köar per trippel (avtal, text, manifest) och avvisar oläsbar form
  med 400 `kontrakt_olasbart` före skrivning. Godkännandet skriver parter ur
  en källa och ankaret under radlås efter rytmen, bara i `lagras`/`andras`.
  Båda svaren redovisar luckor, parter, skillnader och ankare; audit bär inga
  nya namn eller källtexter. Registret läser kontraktsnamnet ur första
  avtalsdelsversionen. Leveranserna visar namn och gemensamma lucktexter samt
  mottagarparten per avtal; Kontraktet får panelen Parterna och luckorna.
  Husets paneler, tokens och typografi används; sidhuvud och lägesväxel är
  tecken för tecken oförändrade, liksom befintliga handgrepps fokusordning.
  Oinläst, saknat och ifyllt har skilda texter. Manifesttext HTML-escapas.
  Dokument: MCP_ACTIONS och ARKITEKTUR, utan ändrade arkitekturprinciper.
  **Prov:** 35 nya namngivna fall i `uppdragsytan-kontraktsluckor.test.ts`
  (R0–R7, M1–M3, I1–I8, G1–G7, L1–L3, S1, V1–V4, D1); de två befintliga
  import-/registerassertionerna uppdaterade. Rena regler, etiketter och
  dokumentspegling (10 fall), samt CRM:s sändvägsgraf (10 fall):
  `Test Files 2 passed (2)`, `Tests 20 passed | 27 skipped (47)` i isolerad
  vitest med temporär konfiguration utan databas-setup. **Typecheck och build
  exit 0.** Ordinarie `npm test` försökt före/efter varje uppgift och i grinden:
  `Error: connect EPERM 127.0.0.1:5433 - Local (undefined:undefined)` i
  globalSetup. Databas-, vy- och fulla regressionsfallen är därför **inte
  körda**; kedjans körning återstår enligt uppdragets nätverksundantag.
  Ett bredare urval i den isolerade körningen valde också S1 och nekades
  `listen EPERM: operation not permitted 0.0.0.0`; slutligt urval omfattade
  bara rena fall. Ingången: 0096 finns, inga RESTER. Inga baslinjetypfel
  behövde rättas. Ingen ny tjänst, rutt, åtgärd eller beroende. Ingen tjänst
  startad, inget driftprov eller driftsättning utförd. Egna tillfälliga
  verifieringsfiler som först hamnade i /tmp flyttades in i repot och
  kopiorna därifrån städades bort. Förslagets underlag
  kvarstår i Story 2.8; Hermes-provens fyra tidigare icke-GRÖNA lägen i
  berättelsens baslinje är inte omprövade här.

- **2026-11-24 — Story 6.6 (crm): likviditeten per kalendermånad blir en läsåtgärd (FR-44):**
  den nya läsåtgärden `liquidity_by_month` (`read`, `{ as_of? }`, strikt
  schema) står i registret direkt efter `liquidity_forecast`, och handlern
  anropar bara `liquidityByMonth` i reports-tjänsten och returnerar svaret
  orört, så åtgärden och styrvyn läser samma funktion. Åtgärden blir REST och
  MCP genom manifestet. Dokument: avsnittet «Likviditeten per kalendermånad som
  läsåtgärd (crm 6.6)» sist i `docs/MCP_ACTIONS.md`, och talet i rubrikstycket
  här är rättat till registrets antal poster (det stod fyra för lågt). Prov:
  `server/test/steering-liquidity.test.ts` (T1 ägaren och ett AI-token får
  funktionens svar efter JSON-transporten, med negativ kontroll utan
  `not_counted`; T2 grannbolagets användare får 404 och ägaren 200; T3 fyra
  ogiltiga indata ger 400; D1 avsnittet med tre planterade kopior; D2
  rubrikstyckets tal mot registret och källtexten, med tre planterade texter).
  D2 fäller från och med nu varje bygge som ändrar registrets antal utan att
  rätta talet här. Ingen migration, rutt, tabell, vy eller miljövariabel;
  visningen i styrvyn kommer i Story 6.3. **Inte kört:** byggaren har inte
  kört något kommando — sandlådan kräver godkännande för typkontroll och svit.
  Kedjans typkontroll och svit avgör.
- **2026-11-23 — Story 5.9 (crm): kalendern blir en fångstväg i ytan (FR-3,
  FR-17, FR-31):** `CAPTURE_PATHS_IN_OPERATION` i `crmDerivations.ts` har
  kalendern bland kontaktvägarna (`['mail', 'calendar', 'issues']`;
  löftesvägarna orörda), så Idag säger «Kommer något in via mail, möten eller
  ärenden dyker det upp av sig självt.» och Relationer «härlett ur mail, möten,
  ärenden och bokförda fakturor». Källraden har en tredje länkform:
  `kalenderAdress(eid)` bredvid `gmailAdress` i `routes.ts` är det enda stället
  med mallen, raden `calendar` i `KALLNYCKEL` prövar hela nyckeln (`calendar:`,
  ett `eid` av 1–291 tecken base64url och Gmail-radens valfria `#`-suffix, som
  aldrig går in i adressen), och `kallLank` ger etiketten «Öppna mötet i Google
  Kalender (ny flik)». Tråden, åtagandevyn och Idag får länken genom `kallrad`.
  Mottagaren och härledningen är orörda: ett möte räknades redan som kontakt
  (K-3). Dokument: stycket i «Källan på varje rad (crm 4.2)» i
  `docs/MCP_ACTIONS.md`. Prov: `server/test/crm-calendar-capture.test.ts` (F1–F4
  konstanten och texterna, L1–L7 länken med tre giltiga och nio planterade
  nycklar i slutna facitlistor per yta, mallen en gång i koden och dokumentet,
  K1–K6 mötet genom intaget: tråden, «0 d sedan», «0 dagar», avbetad Idag,
  kontaktförslagen och idempotensen) och
  `server/test/crm-calendar-capture-mock.test.ts` (N0–N2: konstanten utan
  kalendern ger Idag och Relationer de gamla meningarna). Uppdaterade facit:
  `crm-capture-paths.test.ts` (`I_DRIFT`, P1, P3, D1, R1, R2),
  `crm-ai-commitments.test.ts` (C1, C2) och `crm-views.test.ts` (4.2:s C4 och
  KL4:s titel), och kommentaren över `I_DRIFT` i
  `crm-capture-paths-mock.test.ts`. Ingen migration, rutt, åtgärd, CSS-klass,
  import eller beroende. **Inte kört i sandlådan:** typecheck och vitest kräver
  godkännande som luckan inte har; kedjan kör typecheck, build och hela sviten.
  **Inte provat:** kalenderlänkens form mot en verklig händelse. Det är Davids
  steg efter driftsättningen (raden *Driftsättning* för 5.9 i epics.md): öppna
  «Öppna ↗» på en mötesrad i en relations tråd (en kontaktpunkt ur nattintaget
  med nyckeln `calendar:<eid>`), för ett avslutat kundmöte och för en instans av
  ett återkommande möte, och anteckna utfallet här. Leder adressen fel ändras
  bara `kalenderAdress`, och nyckeln går att söka på under tiden. Rött utanför
  repot, senast kända läge (provvaktens körning 2026-11-23 kl. 06.30) och av
  skäl utanför berättelsen: Hermes-proven adresskontraktet och bmadglidning.
- **2026-11-23 — Story 1.9 (crm): personens kortlänk och anteckning skyddas när David satt dem (FR-8):**
  `external_ref` (länken till personkortet) och `notes` står nu i
  `PERSON_PROVENANCE_FIELDS` i `crmRelations.ts`, så `upsertPerson` skriver
  ursprung för dem (`human`, `ai` eller `sync` med källa) och vakten skyddar
  dem som personens andra fält; intaget redovisar
  `"<personens namn>: external_ref"` i `kept_human_fields`. Uppdateringsgrenen i `upsertPerson` har
  fått låsordningen ur A-1 (3) och (5): organisationerna (indatats och
  personens nuvarande, vid byte till privat även posternas) för delning,
  sedan personens rad, och vakten först därefter. Har personen bytt
  organisation medan skrivningen väntade svarar den 409
  `person_flyttad_samtidigt` (i intaget: `skipped` med skälet). Dokument:
  stycket i «Människan vinner» i `docs/crm/API_KONTRAKT.md` och avsnittet
  «Personens kortlänk och anteckning (crm 1.9)» sist i `docs/MCP_ACTIONS.md`.
  Prov: `server/test/crm-person-provenance.test.ts` (PP1–PP6 ursprunget och
  skyddet, PL1–PL5 låsordningen med fyra kapplöpningar, PD1–PD2 dokumenten).
  Ingen rutt, migration, åtgärd, tabell eller beroende. **Inte kört i
  sandlådan:** typecheck och vitest (utvecklarluckan har inga kommandon);
  kedjan kör typecheck, build och hela sviten. Ingen bakåtfyllnad: kortlänkar
  och anteckningar skrivna före bygget skyddas först när en människa skriver
  dem igen. Rött utanför repot, senast kända läge och av skäl utanför
  berättelsen: Hermes-proven overlamningsregister_fr6 och provvakt_fr24
  (RÖTT) och continuityvakt (KUNDE_INTE).
  **Omtag efter kodgranskningen (två fynd):** personens rad läses nu hel
  under låset (samma kolumner som uppslaget), och efter låset läses personen
  bara ur den låsta raden; uppslaget före väntan används bara för att se om
  personen flyttats. Därmed skriver en väntande synk, agent eller människa
  inte längre tillbaka det gamla namnet över Davids samtidiga namnbyte (namnet
  är det enda fältet utan COALESCE i UPDATE-satsen). Nya fall i samma fil:
  PL6–PL8 (namnbytet mot intaget, människan utan namn och agenten), PL9–PL10
  (personen raderad eller sammanslagen bort medan skrivningen väntar på
  organisationen respektive personens rad: 404, i intaget `skipped`, inget
  skrivet) och PL11 (personen får en organisation medan skrivningen väntar på
  personens rad: 409). **Inte kört i sandlådan:** typecheck och vitest kräver
  godkännande som luckan inte har; kedjan kör hela sviten.
- **2026-11-23 — Story 5.7 (crm): en nyckel som bara kan läsa (FR-24, NFR-6,
  beslut #156, S-1):** `authenticate` läser claimen `scope` genom
  tillåtelselistan `readOnlyFromScope` (människa och agent utan scope, agent med
  `scope: 'read'`; allt annat 401) och sätter alltid `AuthContext.readOnly`.
  `executeAction` avvisar varje åtgärd som inte är `read` med 403
  `read_only_token` direkt efter uppslaget, före schemat, `kravManniska` och
  varje transaktion; felkoden konstrueras bara i `assertNotReadOnly`, och bara
  åtgärdsrutten skickar flaggan. Den andra försvarslinjen `rejectReadOnlyWrites`
  står direkt efter `authenticate` på `/api/companies` och släpper med
  läsnyckeln bara GET, HEAD och `POST …/actions/:name` (`isActionCall`). *Anslut
  AI* har valet *Läsnyckel — kan bara läsa* (vyns enda mintning, samma
  livslängd, ingen ny miljövariabel; okänt val 400 `invalid_input`); REST-vägen
  för agent-token tar inget scope. Auditraderna `action.executed` och
  `agent_token.minted` bär `scope: 'read'` för läsnyckeln. Ingen migration, rutt,
  åtgärd, CSS-klass eller beroende. Prov: `server/test/crm-read-scope.test.ts`
  (A1–A3 tillåtelselistan och `authenticate`, S1–S5 spärren med svep över
  manifestets alla skrivande åtgärder, R1–R4 den andra linjen, B1–B2
  bolagsgränsen, T1–T6 mintningen, D1–D3 dokumenten) och
  `server/test/crm-read-scope-mock.test.ts` (N0–N2, spärren borttagen:
  `log_contact` lyckas, den andra linjen står kvar). Dokument:
  `docs/ARKITEKTUR.md` (punkten om läsnyckeln, migrationsintervallet 0001–0096)
  och `docs/MCP_ACTIONS.md` (avsnittet för crm 5.7). **Inte kört i sandlådan:**
  typecheck och vitest nekades (kräver godkännande); kedjan kör typecheck, build
  och hela sviten. Återstår (5.8): David mintar läsnyckeln under *Anslut AI*
  efter driftsättningen, och Hermes `loften()` läser med den.
- **2026-11-23 — Story 5.5 (crm): löften som AI:n fångar märks tills David
  bekräftat dem (FR-39, FR-24):** åtgärdsdefinitionen har fått ett valfritt
  fält `description` som manifestet för vidare bara när det finns, och MCP:s
  `toolFor` bygger verktygets text som titeln, en punkt och beskrivningen.
  `record_crm_commitment` säger nu när den ska anropas (titel, schema och
  handler orörda). `list_crm_commitments` bär `unconfirmed_ai` per rad (textens
  ursprung är `ai`, en enda definition `UNCONFIRMED_AI_COMMITMENT_SQL` i
  crmRelations) och tar `include_unconfirmed_ai`, med brytaren
  `INCLUDE_UNCONFIRMED_AI_COMMITMENTS` i crmDerivations som standard. Värdet är
  Davids besked 2026-10-16 (*direkt*, `true`); `false` är mellanläget *först
  efter bekräftelse*. `listCommitments` och `todayView` kräver valet, och
  konstanten läses av anroparna: Idag och `crm_today` genom konstanten,
  åtagandevyn och Min sida med `true`. Ingen migration, rutt, CSS eller ny
  åtgärd. Prov: `server/test/crm-ai-commitments.test.ts` (M1–M3 manifestet,
  A1–A4 agentens löfte med ursprung, 400 och 404, V1–V6 ✦/Stämmer/Rätta och
  vakten för agentens rättelse, omsändning och intaget, B1–B6 fältet och valet,
  I1 Idag och `crm_today`, C1–C2 fångstvägarna orörda, D1 dokumentet),
  `server/test/crm-ai-commitments-mock.test.ts` (N0–N6, konstanten vänd till
  mellanläget utesluter löftet ur både Idag, `crm_today` och listan), M4 i
  `server/test/mcp.test.ts` och 5.2:s nyckellista (A2, 18 nycklar).
  `docs/MCP_ACTIONS.md` har avsnittet «Löften som AI:n fångar i samtalet (crm
  5.5)». INTE kört i sandlådan: `npm run typecheck` och `npm test` (vitest)
  krävde godkännande som inte kunde ges; kedjan kör båda. Återstår: ✦ och
  Stämmer på Idags löfteskort (5.6), chattagentens anrop (5.10) och fångstvägen
  i ytan (5.11).
- **2026-11-23 — Story 6.5 (crm): det obelagda redovisas för sig (FR-44):**
  `liquidityByMonth` returnerar nu `LiquidityByMonth`: rullningen och fältet
  `not_counted`, elva obelagda rader i en sluten lista med belopp och skäl
  (abonnemang, ofakturerad tid, ROT/RUT-fordran, restraden för fordringar
  1500–1699, momsnettot, restsaldot på 2710/2730, bolagsskatten, 25xx, 2920,
  289x och restraden för skulder 2400–2999). Den rena `notCountedRows` i
  `domain/liquidity.ts` räknar kontobeloppen ur huvudboken genom en sluten
  kontoindelning och drar av reskontrans öppna fakturor; listan förs aldrig in
  i rullningen. Momsen och restsaldot får nästa förfallodag och reservation
  bara när de är en skuld. Restsaldot räknas ur 6.2:s AGI-delar utan
  bruttometodens dubbelräkning. Abonnemangsfrågan är flyttad ordagrant till
  `recurringMonthOre` i `services/reports.ts`, som styrvyn nu anropar (samma
  svar), och momsens reservation bor i domänen och delas med prognosen. Prov:
  `steering-liquidity` R1, E1–E7 och N1–N10 (N6 negativ kontroll, N7 öppen
  affär). Ingen migration, rutt, åtgärd, tabell eller miljövariabel. Visningen
  i styrvyn kommer i Story 6.3 och läsåtgärden `liquidity_by_month` i Story
  6.6. **Inte kört:** byggaren har inte kört något kommando — sandlådan
  kräver godkännande för typkontroll och svit. Kedjans typkontroll och svit
  avgör.
- **2026-11-23 — Story 3.13 (crm), omtag 2: spärrens uppslag bärs av primärnyckeln (FR-43):**
  Kedjans svit fällde GP1 och GP2: planen för spärrens första fråga hade
  bara `company_id` och `source_system` i indexvillkoret. Orsaken är
  Postgres 16: `source_ref = ANY(...)` på primärnyckelns tredje kolumn ger
  planeraren också en väg där listan är ett filter, och på en liten tabell
  väljs den, så bolagets och källsystemets alla gravstenar lästes. Mekanismen
  är bytt: `assertNotErased` slår upp varje nyckel (källnyckeln, syskonet och
  grunden, högst tre) med en egen likhet i en `UNION ALL`-fråga. En likhet på
  alla tre kolumner hamnar alltid i indexvillkoret. Frågetexten byggs bara ur
  antalet nycklar, och alla värden är parametrar. GP1 och GP2 fäller nu hela
  klassen: varje uppslag på `erased_sources_pkey` ska bära `source_ref`, ingen
  nod får ha `source_ref` som filter, och fallen täcker en, två och tre
  nycklar, med och utan spärr. Syskonfrågan, som bara körs när den bara
  grunden är gravsten, är oförändrad och fortfarande en känd gräns. Ingen
  migration, rutt, åtgärd, tabell eller miljövariabel. **Inte kört:**
  sandlådan nekade provkörningen (kräver godkännande). Kedjans svit avgör.
- **2026-11-23 — Story 3.13 (crm), omtag efter kodgranskningen (FR-4, FR-43):**
  Fyra fynd åtgärdade. (1) `recordInteraction`: uppslaget på hela nyckeln
  gäller hela bolaget. Träffar det en rad i en annan organisation görs
  uppslaget på grundnyckeln inom den egna organisationen ändå, och dess rad
  vinner. Annars flyttade uppdateringen den andra organisationens rad hit,
  och organisationen fick två rader med samma grund (sekvensen {A} → {A,B} →
  {B}). Saknar organisationen grunden flyttas raden som förut. Prov: G10
  (gmail och calendar), G11 (nyckel med suffix i en annan organisation) och
  G12 (flytten när grunden saknas, positiv kontroll). (3) `assertNotErased`
  slår nu upp de exakta nycklarna och grunden på primärnyckeln (`= ANY`).
  Syskonen läses i en fråga till bara när den bara grunden själv är en
  gravsten, eftersom ett prefixintervall inte är säkert i en språklig
  sortering. Prov: GP1 och GP2 (spelar in spärrens frågor och kräver
  `source_ref` i indexvillkoret på `erased_sources_pkey`). (2) och (4) Regel 2
  och 4 i `docs/crm/API_KONTRAKT.md` anger nu mekanismens villkor: att flytten bara
  sker när grunden saknas, att formen `<grund>` beror på personens domän, att
  den bara nyckeln är en exakt gravsten för andra organisationer, och att ett
  syskon från en annan kunds radering stänger av regeln för bara gravstenar.
  Prov: K6 (gränserna i de rena funktionerna) och D2 (kontraktets villkor).
  Ingen migration, rutt, åtgärd, tabell eller miljövariabel. **Inte kört:**
  sandlådan nekade `npm run typecheck` (kräver godkännande). Kedjans
  typkontroll och svit avgör.
- **2026-11-23 — Story 3.13 (crm), mottagaren känner igen kontaktpunkten och gravstenen oavsett domänsuffixet (FR-4, FR-43):**
  Den nya rena modulen `server/src/lib/crmSourceRef.ts` (inga importer) bär
  tillåtelselistan `GRUNDNYCKEL_SYSTEM` (`gmail`, `calendar`), `sourceRefBase`
  (delen före första `#`), `emailDomain`, `suffixDomain`, `erasureKeys`,
  `erasureCheckKeys` (samma interna regel, så att skrivningen och prövningen
  inte glider isär) och `erasureBlocks`. `recordInteraction` tar ett
  transaktionsbundet lås per bolag, källsystem, organisation och grundnyckel
  (`pg_advisory_xact_lock`, samma form som payroll.ts) och gör ett andra
  uppslag på grundnyckeln inom organisationen när hela nyckeln inte träffar:
  `<grund>` och `<grund>#<domän>` i samma organisation är samma kontaktpunkt
  (`interactions_unchanged`, raden behåller sin första nyckel), en annan
  organisation får egen rad, löften och `linear`/`manual` jämförs på hela
  nyckeln. GDPR-raderingen (`purgeCrmRelationData`) skriver för kontaktpunkter
  också domänsyskonet `<grund>#<domän>` (suffixet, annars personens
  e-postdomän), före alla DELETE; löftenas och affärernas gravstenar är
  oförändrade. `assertNotErased` har en valfri femte parameter som bara
  `recordInteraction` skickar: spärren prövar nyckeln och syskonet, och en bar
  gravsten utan domänsyskon spärrar alla domäner. `recordCommitment` och
  affärscachen prövar exakt nyckel som förut. Regel 2 och 4 i
  `docs/crm/API_KONTRAKT.md` beskriver grundnyckeln och gravstenen per domän.
  Prov: `server/test/crm-source-ref.test.ts` (K1–K5),
  `server/test/crm-ingest-grundnyckel.test.ts` (G1–G9 med samtidighetsfallet
  G9, negativa kontrollen GN och GV) och `server/test/crm-gdpr-replay.test.ts`
  (G2, G3 och K uppdaterade till domänsyskonen; GD1–GD6, GDN, GDV och D1 nya).
  Ingen migration, rutt, åtgärd, tabell eller miljövariabel tillkom. 3.10 i
  Hermes (avsändarens nycklar) kan nu byggas. **Inte kört:** sandlådan nekade
  `npm run typecheck` och `npm test` (kräver godkännande). Kedjans typkontroll
  och svit avgör.
- **2026-11-22 — Story 5.4 (crm), *Lova något* med löftestid (FR-32):**
  Formuläret *Lova något* på relationssidan har nu det valfria fältet
  *Lovades* (`<input type="date" name="occurred_at" max="{UTC-dagen}">`) sist i
  raden efter *Senast*, utan ny CSS. Den rena funktionen `promisedAtFromForm`
  (och typen `PromisedAt`) i `server/src/lib/crmRules.ts` ger löftestiden.
  Tomt eller utelämnat ger anropstillfället. Ett datum bakåt blir kl. 12.00 UTC
  genom `dateToTimestamp`, samma regel som Rätta, och dagens datum ger nuet.
  En tid efter nuet ger felet «Ett löfte kan inte ha getts i framtiden.».
  Jämförelsen gäller varje sträng som går att tolka som en tid, också en
  handskriven tidpunkt med zon. Vy-POST:en `/c/:companyId/relations/:id/commit`
  läser fältet bara genom funktionen (exakt ett anrop och en läsning av
  `b.occurred_at`). Vid fel omdirigerar den till `back` med notisen innan
  `runViewAction`, så att ingen åtgärd körs. Annars skickar den funktionens
  `occurred_at` till `record_crm_commitment`. Åtgärden, tjänsten, *Min sida* och
  `docs/MCP_ACTIONS.md` är orörda, och spärren mot framtiden gäller bara det här
  formuläret. Nya provfiler: `server/test/crm-commitment-form.test.ts`
  (L1–L6 regeln med fasta klockor, F1–F2 formuläret, S1–S7 genom hela stacken:
  löftestiden, *Lovat* i tråden och åtagandevyn, tomt fält, framtida datum med
  notisen före formuläret, tom text, ursprunget `human` och tenantgränsen med
  404) och `server/test/crm-commitment-form-mock.test.ts` (N0–N3, negativ
  kontroll: en server som ignorerar *Lovades* fäller S1:s och S4:s facit, och
  anropsloggen visar en enda väg in). **Inte kört:** sandlådan nekade
  `npm test` och `npm run typecheck` (kräver godkännande). Kedjans typkontroll
  och svit avgör.
- **2026-11-22 — Story 7.4 (crm), en affär som stått stilla blir ett skäl i
  kontaktförslagen (FR-22):** Regeln `stalledDealReason` i
  `server/src/lib/crmRules.ts` (ren, med den slutna etikettabellen
  `DEAL_STAGE_LABELS`) ger *affären {titel} ({skede}) har stått stilla i {N}
  dagar* för den affär som stått stilla längst, när stilleståndet är minst
  relationens tystnadsgräns (kadensen, annars bolagets standard), med *skede
  okänt* för allt utanför tabellen och *(och N till)* när fler står stilla.
  `contactSuggestions` i `server/src/services/crmDerivations.ts` läser
  affärerna bara genom `openDeals` och bara när `as_of` är dagens datum, lägger
  skälet efter tystnaden och väger stilleståndet som tystnaden (högst 365);
  tystade och uppskjutna relationer lämnas som förut före varje skäl.
  `todayView` för sin klocka (`now`) vidare, så Idag, relationsvyn, `crm_today`
  och `crm_contact_suggestions` ger samma skäl ur samma funktion; ingen rutt,
  handler eller markup är ändrad. Nytt avsnitt sist i `docs/MCP_ACTIONS.md`.
  Nya fall sist i `server/test/crm-deals.test.ts` (19): R1–R5 regeln, N1–N3
  negativa kontroller (gammal ögonblicksbild, skäl utan skede), A1–A6
  förslagen (skälet, gränsen och kadensen, *skede okänt*, dämpningen,
  tenantgränsen), F1–F3 färskheten (saknad, 27 timmar, framtida tidpunkt, tom,
  `as_of` i går), I1 samma svar på Idag, i `crm_today`, i
  `crm_contact_suggestions` och i relationsvyn, och D5 dokumentet; 7.1:s fall
  är orörda. **Inte kört:** sandlådan nekade `npm run typecheck` (kräver
  godkännande), så byggaren har inte kört något kommando; kedjans typkontroll
  och svit avgör. I drift syns affärsskälen först när Hermes skickar färska
  ögonblicksbilder (Story 7.2); tills dess säger läsningen okänt och
  förslagen är oförändrade.
- **2026-11-22 — Story 5.2 (crm), omtaget efter code-review (tre fynd,
  lagade som felklasser):** (1) Märket *ärendet skapat* läste radens
  källsystem i stället för löftesdagens eget ursprung, så en dag som David
  rättat i Rätta stod märkt som ärendets skapad-datum. `lovatVarde` tar nu
  löftesdagens ursprungsrad som obligatorisk parameter och märker bara när
  källsystemet är `linear` och ursprunget är synken eller saknas. Åtagandevyn
  och tråden skickar `falt?.provenance.occurred_at`. Nya fall U1–U5 prövar
  båda ytorna för varje sort: David rättade Lovades, också efter en ny synk
  (U1, inget märke), AI:t skrev dagen (U2, inget märke), David rättade bara
  Senast (U3, märket står), ingen ursprungsrad (U4, märket står) och synkens
  dag (U5, märket står). (2) Texter som påstod mer än koden: rättat här
  («Formuläret Rätta behåller *Lovades*»; Lova något har inget sådant fält),
  i Completion Notes och i `docs/MCP_ACTIONS.md`, där «överallt där de visas»
  nu är de fyra ytorna, och där Min sida och Idags relationskort står
  uttryckligen som ytor utan namnen. (3) Provets datum: klockan läses en gång
  för hela provfilen (`NU`), och förfallodatumen är konstanter som fixtur och
  facit delar, så att en körning över UTC-midnatt inte fäller A1, V5, V7 eller
  I1. Provfilen har nu 31 fall. **Inte kört:** sandlådan nekade `npm test`
  och `npm run typecheck` (kräver godkännande). Kedjans typkontroll och svit
  avgör.
- **2026-11-22 — Story 5.2 (crm), löftets tre tider och löften som stängts
  av källan (FR-31, FR-2, FR-36):** `listCommitments` väljer `c.created_at`, så
  varje rad i `list_crm_commitments` bär `occurred_at` (Lovat), `created_at`
  (registrerat) och `due_date` (Senast); inget fält borttaget. Åtagandevyn har
  kolumnen *Lovat* mellan *Vem* och *Senast*, med *registrerat {datum}* som
  andra rad när registreringsdagen är en annan UTC-dag, och märket *ärendet
  skapat* efter löftesdagen när den är ärendets skapad-datum (`lovatVarde`:
  källsystemet `linear` och löftesdagens ursprung synken eller ingen
  ursprungsrad; villkoret kom i omtaget ovan). De tre namnen står i
  konstanten `LOFTETS_TIDER` i `server/src/http/view/routes.ts` och skrivs
  därifrån i åtagandevyn, i
  trådens nya rad *Lovat* för ett löfte, i gissningsraden (i dag *Lovades*,
  nu *Lovat*) och på Idags löfteskort (i dag «· sades», nu «· Lovat»).
  Formuläret Rätta behåller *Lovades*. Under Klara och
  Avskrivna säger kolumnen Källa «Ärendet {id} stängdes» när synken stängde
  löftet (`stangdAvKallan`: status klar eller avskriven, statusens ursprung
  `sync`, källsystemet `linear` och nyckeln i `KALLNYCKEL.linear`s form);
  `kallrad` är orörd. Nytt avsnitt sist i `docs/MCP_ACTIONS.md`. Ny provfil
  `server/test/crm-commitment-times.test.ts` (26 fall): A1–A3 och D1 listan
  och dokumentet, V1–V7 och N1 kolumnen, staplingen på telefonbredd och en
  negativ kontroll, T1–T4 och I1 namnen i tråden och på Idag, S1–S9 texten
  «stängdes» med ett fall per villkor. Ankarraden för Idag i `kl42Kallrader`
  i `server/test/crm-views.test.ts` söker nu «· Lovat 2026-09-02 via»
  (facit oförändrat). **Inte kört:** sandlådan nekade `npm test` och
  `npm run typecheck` (kräver godkännande), så inget prov är kört här;
  kedjans typkontroll och svit är belägget. Utanför bygget: 5.3 lägger märket
  på Idag och antecknar beslutet i `docs/crm/API_KONTRAKT.md`.
- **2026-11-22 — Story 7.1 (crm), andra omtaget efter code-review (två fynd,
  lagade som felklasser):** (1) Källnyckelns form: förra omtaget hade bytt
  exemplets `linear:LOC-412` mot `LOC-412`. Exemplet är återställt, och båda
  dokumentavsnitten säger nu att `source_ref` har husets form `<system>:<id>`
  (arkitekturen), samma som i händelserna, att mottagaren jämför hela nyckeln
  och att en gravsten för ärendet därför spärrar affären. Kommentarerna om
  nyckeln i `server/src/services/crmDeals.ts` och `server/src/actions/registry.ts`
  säger detsamma. (2) Null i läsningen: kontraktet lovade «alltid
  `observed_at`». Båda avsnitten säger nu att `observed_at` och `received` är
  `null` när ingen ögonblicksbild har kommit, och att `stage`, `value_ore` och
  `next_step` är `null` när affären saknar dem. Nya fall i
  `server/test/crm-deals.test.ts` (47): D1 och D2 prövar nyckelns form med
  `nyckelbrister`, D3 jämför läsningens verkliga null-fält med en literal och
  kräver att båda avsnitten säger när vart och ett är null (`nullbrister`), D4
  är den negativa kontrollen för båda hjälparna, och G4 visar att ett löftes
  gravsten för `linear:LOC-7201` spärrar affären med samma nyckel. Ingen
  ändring i beteendet. **Inte kört:** byggaren har inga kommandon i den här
  körningen; kedjans körning av typkontrollen och sviten är belägget.
- **2026-11-22 — Story 7.1 (crm), omtag efter code-review (fem fynd, lagade
  som felklasser):** (1) GDPR-raderingen skriver gravstenar
  `('linear', source_ref)` för kundens cacherader i samma sats som de övriga
  gravstenarna, före varje radering (`purgeCrmRelationData`), och
  `syncDealSnapshot` prövar `assertNotErased` först i varje rads sparpunkt,
  före organisationen: samma `source_ref` hoppas över med husets skäl och skapar
  ingen relation, en ny släpps igenom (FR-43, kontraktets regel 4). (2) Regeln
  `aheadOfClock` med `DEAL_CLOCK_SKEW_MINUTES` = 5 i `server/src/lib/crmRules.ts`
  gäller båda avsändartiderna: ett `observed_at` längre fram ger 400
  `observed_at_in_future` före varje skrivning, en affär med `last_activity_at`
  längre fram hoppas över, och grinden `dealSnapshotStatus` ger `unknown` för
  samma tid. (3) O1 räknar stilleståndets facit ur klockan före och efter
  anropet, så fallet håller över midnatt UTC. (4) `source_ref` trimmas på ett
  ställe i tjänsten och råvärdet förs inte vidare; en tom nyckel hoppas över.
  (5) Avsnittet «Affärerna» i API-kontraktet skriver ärendeplattformen, inte
  Linear, och båda dokumentavsnitten beskriver gravstenen, klockmarginalen och
  nyckeln. Nya fall i `server/test/crm-deals.test.ts`: S9, S10, P7, O7 och G3
  (44 fall), och D1/D2 kräver de nya termerna och att avsnitten inte nämner
  Linear. **Inte kört:** `npm test` och `npm run typecheck` — sandlådan svarade
  ”This command requires approval”; kedjans körning är belägget.
- **2026-11-22 — Story 7.1 (crm), affärscachen och kontraktet för affärer
  (FR-25, mottagarsidan):** Migrationen `server/migrations/0096_crm_deal_snapshots.sql`
  med två CACHE-tabeller: `crm.deal_snapshots` (en rad per öppen affär,
  primärnyckel `(company_id, source_ref)`, sammansatt FK mot relationen med
  `ON DELETE CASCADE`, fem CHECK-villkor, app har SELECT, INSERT och DELETE men
  aldrig UPDATE) och `crm.deal_snapshot_observations` (tidpunkt och antal för
  bolagets senaste ögonblicksbild, också när den var tom). Båda med ENABLE +
  FORCE RLS. Tjänsten `server/src/services/crmDeals.ts`: `syncDealSnapshot`
  skriver observationsraden först, raderar hela bolagets cache och lägger in
  varje rad i en egen sparpunkt; organisationen går genom `upsertOrganization`
  och en bolagsformsvariant genom `queueNameVariantProposal`, som intaget.
  `openDeals` läser affärerna bara när grinden `dealSnapshotStatus` säger `ok`
  (`DEAL_SNAPSHOT_MAX_AGE_HOURS` = 26 och `idleDays` i
  `server/src/lib/crmRules.ts`). Två åtgärder i registret efter
  `ingest_crm_events`: `sync_crm_deals` (`write`) och `crm_open_deals` (`read`).
  Skedenas etiketter *Idé*, *Dialog*, *Offert* och *Förhandling* i `STATUS` i
  `server/src/http/view/html.ts`. `purgeCrmRelationData` i
  `server/src/services/gdpr.ts` raderar relationens cacherader uttryckligen,
  eftersom organisationsraden behålls och kaskaden aldrig når dit. E3-fallet i
  `server/test/crm-schema.test.ts` kräver nu exakt `crm_open_deals` och
  `sync_crm_deals` bland åtgärderna med `deal` i namnet, och affärsobjektet
  står fortfarande tomt. Avsnitten «Affärerna» i `docs/crm/API_KONTRAKT.md` och
  «Affärscachen och kontraktet för affärer (crm 7.1)» i `docs/MCP_ACTIONS.md`.
  Prov i `server/test/crm-deals.test.ts`, 39 fall: M1–M7 (katalogen, kedjan
  igen, etiketterna härledda ur CHECK-villkoret, kaskaden, RLS som app), S1–S8
  och O0 (ersättningen fält för fält, S2 negativ kontroll med A ∪ B, tom mängd,
  ogiltigt indata, trasiga rader, kundkoppling, audit med bara antal,
  grannbolaget), V1–V5 (bolagsformsvarianten, ett förslag per par, intaget
  återanvänder förslaget, flera möjliga, aliaset), P1–P6 (grinden och
  stilleståndet), O1–O6 (*OK*, *TOMT*, *OKÄNT*, 25 och 27 timmar, överhoppade
  rader, grannbolaget), G1–G2 (GDPR-raderingen och sammanslagningen), E1–E2
  (bara två filer nämner cachen, ingen av dem affärsobjektet; negativ kontroll)
  och D1–D2 (dokumenten). Ingen ny rutt, vy, CSS-klass eller beroende.
  **Inte kört i den här sessionen:** `npm run typecheck` och `npm test` —
  sandlådan svarade ”This command requires approval”; kedjans körning är
  belägget. **I drift:** Hermes skickar ingen ögonblicksbild förrän Story 7.2
  är driftsatt; tills dess svarar `crm_open_deals` ärligt *OKÄNT* för varje
  bolag. **Rött utanför repot:** som i raden nedan; inget av de icke-gröna
  Hermes-proven gäller den här berättelsen.
- **2026-11-22 — Story 5.1 (crm), fångstvägarna på ett ställe och ärliga
  tomlägen (FR-31, PRD lucka 21):** Konstanten `CAPTURE_PATHS_IN_OPERATION` i
  `server/src/services/crmDerivations.ts` (fryst; kontakter `mail`, `issues`,
  löften `issues_waiting_external`, `promise_form`). Den rena textbyggaren
  `captureTexts(paths)` i `server/src/lib/crmRules.ts` med två slutna
  frastabeller (`Record` över nyckeltyperna, kalendern och AI-samtalet finns
  redan som rader) och sex fält. I `server/src/http/view/routes.ts` en enda
  modulkonstant `CAPTURE_TEXTS`, som fem ytor läser: åtagandevyns tomläge (nu
  tre grenar: «Inga öppna löften.» med fångstmeningen, «Inga klara löften.»,
  «Inga avskrivna löften.»; ordet «avbetad» är borta), hinten i *Lova något*,
  kundkortets tomma *Åtaganden* (kund; leverantörens text orörd), Idags
  avbetade läge («Avbetat för i dag» står kvar) och Relationers ingress och
  tomläge. Ingen yta nämner längre kalendern eller möten som fångstväg. En
  ändrad assertion: `server/test/crm-finish.test.ts` kräver «Inga öppna
  löften.» i stället för «Inga åtaganden här». Prov: P1–P8 (rena),
  A1–A4, H1, C1, D1, R1, R2 (ytorna genom hela stacken) i
  `server/test/crm-capture-paths.test.ts`; M0–M5 (negativ kontroll: `vi.mock`
  byter konstanten mot en utökad och alla fem ytor följer med) i
  `server/test/crm-capture-paths-mock.test.ts`. Berättelserna 5.9 (kalendern)
  och 5.11 (AI-samtalet) ändrar bara konstanten. Personregistrets ingress och
  kundkortets rad under *Kontaktpersoner* nämner fortfarande möten; de ligger
  utanför 5.1:s fem ytor och är en fråga till David. Ingen migration, rutt,
  åtgärd, tabell, CSS-klass eller beroende. **Inte kört i den här sessionen:**
  `npm run typecheck` och `npm test` — sandlådan svarade ”This command requires
  approval”; kedjans körning är belägget. **Rött utanför repot:** som i raden
  nedan; inget av de icke-gröna Hermes-proven gäller den här berättelsen.
- **2026-11-22 — Story 4.3 (crm), personperspektivet i relationens tråd (FR-40):**
  Rena funktioner i `server/src/lib/crmRules.ts`: `parsePersonParam` (tolkar
  `?person=` som tillåtelselista som aldrig kastar; uuid med gemener eller
  null), den fasta texten `PERSON_PARAM_ERROR`, `correctedPersonFields`
  (namn, roll och telefon som ändrats mot det visade; tomt är oförändrat;
  e-post tas aldrig med), `daysSince` och grenvalet `person` i `EDIT_TARGETS`.
  `relationThread` i `server/src/services/crmThread.ts` och `get_crm_thread` tar
  ett valfritt `person_id`: bara kontaktpunkter och löften där personen är part,
  samma ordning och läsväg som 4.1, inga pengar, och 404 för en person utanför
  organisationen. `upsertPerson` och `upsert_crm_person` tar ett valfritt
  `person_id` som slår upp raden på id och aldrig på namn eller e-post (`name`
  krävs bara utan det; auditraden säger `matched_on: 'id'`).
  `list_crm_commitments` och löftena i `crm_today` bär `person_id` och
  `person_organization_id`. I `server/src/http/view/routes.ts`: personvalet i
  kortet Personer (`aria-current="true"` och flikarnas valform), personhuvudet
  först i trådkolumnen (roll, e-post och telefon med ursprung och Stämmer,
  senaste kontakt, «Rätta personen», «← Hela relationen»), personlägets tre
  tomlägen, `?person=` i flikar, läsväg och formulär (`lageHref`), 400-sida för
  en ogiltig adress, och vägarna in (`personLank`) från åtagandevyns Vem,
  sökträffen och Idag; en person utan organisation står som text. Två
  assertioner skrevs om eftersom de krävde det avskaffade beteendet:
  crm-review-fixes (sökträffen fick inte bära `?person=`, nu krävs adressen med
  personens id) och crm-design-parity (kontaktpersonen på Idag är nu en länk).
  Avsnittet «Personperspektivet i tråden (crm 4.3)» sist i
  `docs/MCP_ACTIONS.md`. Prov: PC1–PC4 i `server/test/crm-rules.test.ts`;
  PP1–PP4, PA1–PA2, PV1–PV7, PR1–PR4, PL1–PL3 och PD1 i
  `server/test/crm-thread-paging.test.ts`. Ingen migration, rutt, åtgärd,
  tabell, CSS-klass, importsats i källträdet eller beroende. **Inte kört i den
  här sessionen:** `npm run typecheck` och `npm test` — sandlådan svarade
  ”This command requires approval”; kedjans körning är belägget. **Rött utanför
  repot:** som i raden nedan; inget av de icke-gröna Hermes-proven gäller den
  här berättelsen.
  **Omtag 1:** kedjans svit fällde PL1. Provets radmönster `<tr>` träffade
  aldrig åtagandevyns rader, eftersom `layout()` via `staplabaraTabeller`
  (html.ts) skriver varje tbody-rad som `<tr role="row">`; källan var rätt.
  `delMed` i provfilen tar nu taggen och en valfri klass, tål vilka attribut
  som helst och fäller provet när elementet saknas, så att ingen negativ
  assertion prövas mot en tom sträng; PL1–PL3 går genom den. Ingen källfil
  ändrad. Inte kört i sandlådan (inga kommandon); kedjans körning avgör.
- **2026-11-22 — Story 4.1 (crm), omtag efter kodgranskningen (tre fynd):**
  (1) `get_crm_thread`:s `before.at` prövas nu med `isThreadTime` i
  `server/src/services/crmThread.ts` (exakt `toISOString`-form, år 0001–9999,
  datumet finns) i stället för bara `IsoDateTimeSchema`, så zonen +16:00 (som
  Postgres avvisar med 22009 och som gav 500) ger 400 `validation_error`; vyns
  `parseThreadCursor` har samma regel, och crm-rules TC6 kräver att de två svarar
  lika över en lista med 20 tidpunkter. (2) `tradensSidor` i
  `server/src/http/view/routes.ts` läser början ur `harAldre`, inte ur att
  markören saknas: en äldre rad vars tidpunkt markören inte bär (år före 1 eller
  efter 9999) ger en fast text om att läsvägen inte når längre, i stället för en
  länk som försvinner tyst eller ett falskt «första registrerade händelse».
  (3) Filtret `pengar` sidas nu över samma ögonblick. Prov: TC6–TC7 i
  `server/test/crm-rules.test.ts`; TP2 (elva tidpunkter), TP4b (två fakturor,
  en betalning, kontakter och löften i samma ögonblick, alla fyra filtren vid
  varje sidstorlek, med negativ kontroll) och TP8b (relationer med år före 1 och
  efter 9999) i `server/test/crm-thread-paging.test.ts`. Avsnittet i
  `docs/MCP_ACTIONS.md` säger formen för `before.at`. Ingen migration, rutt,
  åtgärd, tabell, CSS-klass, importsats eller beroende. **Inte kört i den här
  sessionen:** `npm run typecheck` och `npm test` — sandlådan svarade ”This
  command requires approval”; kedjans körning är belägget. **Rött utanför
  repot:** som i raden nedan; inget av de icke-gröna Hermes-proven gäller den
  här berättelsen.
- **2026-11-22 — Story 4.1 (crm), trådens läsväg till det äldsta (FR-17):**
  Markören är en ren funktion: `parseThreadCursor` (tillåtelselista som aldrig
  kastar: tidpunkt i exakt `toISOString`-form som går fram och tillbaka, år från
  0001, slag ur den frysta `THREAD_CURSOR_KINDS` med `Object.hasOwn`, uuid) och
  `formatThreadCursor`, plus den fasta texten `THREAD_CURSOR_ERROR`, i
  `server/src/lib/crmRules.ts`. `relationThread` i
  `server/src/services/crmThread.ts` har total ordning
  `at DESC, kind DESC, ref_id DESC`, markören `before` som radjämförelse (ingen
  offset), `at` avrundat till millisekunder i frågan och `THREAD_PAGE_SIZE` (60).
  `get_crm_thread` tar `before` (strikt objekt; svaret är fortfarande en lista).
  Relationssidan läser en rad extra och visar «Äldre händelser →» och
  «← Nyaste» i en `nav` med `aria-label="Trådens sidor"`, intervalltexten, texten
  om den första händelsen och ett eget tomläge för en läsposition utan äldre; en
  ogiltig `?fore=` ger husets 400-sida med den fasta texten innan databasen
  läses. Avsnittet «Trådens läsväg bakåt (crm 4.1)» i `docs/MCP_ACTIONS.md`.
  Prov: TC1–TC5 i `server/test/crm-rules.test.ts` och TP1–TP13 i
  `server/test/crm-thread-paging.test.ts`. Ingen migration, rutt, åtgärd,
  tabell, CSS-klass, importsats eller beroende. **Inte kört i den här
  sessionen:** `npm run typecheck` och `npm test` — sandlådan svarade ”This
  command requires approval”; kedjans körning är belägget. **Rött utanför
  repot:** enligt berättelsens baslinje (provvaktens körning 597256cf6e12) är 23
  Hermes-prov inte gröna, och inget av dem gäller den här berättelsen.
- **2026-11-22 — Story 4.2 (crm), källan på varje rad är en länk (FR-17, FR-31):**
  En källrad i en funktion: `kallrad()` i `server/src/http/view/routes.ts`, med
  den slutna namntabellen `KALLNAMN` (Gmail, Ärende, Kalender, För hand),
  tillåtelselistan `KALLNYCKEL` (hela nyckeln mot källsystemets grammatik) och
  `gmailAdress`, det enda stället där Gmail-mallen står. Tråden, åtagandevyns
  kolumn Källa och Idags löfteskort använder den: namnet, nyckeln i maskinstil,
  «Öppna ↗» (`target="_blank" rel="noopener"` och `aria-label`) till Gmail, till
  ärendet under `/vy/arende/` eller till fakturans sida, och tillägget «rättad av
  dig». En nyckel utan formen visas som escapad text utan länk. Ärendeplattformen
  heter Ärende också i ursprungsmärkets titel. Trådens rader bär `invoice_id`
  (`server/src/services/crmThread.ts`), så att fakturans och betalningens rad
  leder till fakturan; `ref_id` är oförändrat. Idag läser löftenas fält i en
  samlad fråga för tillägget. Min sidas mejlänk byggs genom `gmailAdress`, med
  oförändrad utdata. Avsnittet «Källan på varje rad (crm 4.2)» i
  `docs/MCP_ACTIONS.md`. Prov: KL1–KL13 i `server/test/crm-views.test.ts`
  (egen fixtur i eget bolag). Ingen migration, rutt, åtgärd, tabell, CSS-klass,
  import eller beroende. **Inte kört i den här sessionen:** `npm run typecheck`
  och `npm test` — sandlådan svarade ”This command requires approval”; kedjans
  körning är belägget. **Rött utanför repot:** enligt berättelsens baslinje
  (provvaktens körning c7affc90486e) är 19 Hermes-prov inte gröna, och inget av
  dem gäller den här berättelsen. **Gmail-mallen är ännu inte provad mot ett
  verkligt meddelande:** efter driftsättningen öppnar David «Öppna ↗» på en
  mailrad i en relations tråd (en kontaktpunkt ur nattintaget, nyckel
  `gmail:<id>`) i sin inloggade webbläsare och antecknar här om meddelandet
  visas. Leder mallen fel ändras bara `gmailAdress` i en egen ändring.
- **2026-11-21 — Story 2.3, omtag efter code-review (fem fynd, lagade som klasser):**
  (1) Ankaret och rytmen är BASELINE och tas inte emot på ett avslutat uppdrag:
  `satt_bedomningsankare` läser projektets status i den låsta frågan och svarar
  409 `uppdrag_avslutat`, och `0095_matt_och_rytm.sql` (ännu inte i drift) får
  avslutstriggern `contracts_rytm_vagrar_avslutat` på de sex kolumnerna, så att
  också importens rytmskrivning fälls. (2) En regel, `ankaretKanSattas` i
  `http/view/uppdragUppfoljning.ts`, styr både Lägets länk och Bedömningens
  ankarformulär: aktivt uppdrag, det avtal Bedömning visar, rytm men inget
  ankare — ingen länk till en sida utan formulär. Med flera avtal säger
  bedömningsformuläret vilket avtals period förvalet är. (3) Kalenderkällan
  prövas mot samma `kalenderreferenser` som formuläret listar (trasig och utanför
  spärrmappen är ingen källa). (4–5) Måttets tak har husets ord ”ett tak som inte
  är läst” och samma takstatus-chip som kortet Förbrukning mot ram
  (`takstatusChipYta` och `TAK_INTE_LAST` flyttade till uppdragUppfoljning.ts),
  och `Tidmotram` bär `tak_status`; tomma fält står som ”inte inläst”. Nya fall
  M6, A9, A10, V7 och B8 i `server/test/uppdragsytan-matt-rytm.test.ts`; L1, L2,
  V2 och kontraktspåståendets kontroll skärpta. **Inte kört i den här
  sessionen:** `npm run typecheck` och `npm test` — sandlådan svarade ”This
  command requires approval”; kedjans körning är belägget.
- **2026-11-21 — Story 2.3 (uppdragsytan), måtten och rytmen ur kontraktets del 3 och del 4 (FR-19, FR-14, FR-26, FR-35, NFR-11):**
  Migration `0095_matt_och_rytm.sql`: tabellen `uppdrag_matt` (kategori
  BASELINE, RLS, sammansatt FK, SELECT + INSERT för `app`, avslutstriggern) och
  rytmkolumnerna på `contracts` (rytmen, intervallet, veckodagen, ankaret med
  källa och mottagarkretsen, med namngivna villkor). Parsern läser del 3 och 4
  genom slutna listor (`mattlasvag`, `mattlasare`, `rytmregel`,
  `larmregelKraverAndel`), och importen skriver måtten och rytmen först efter
  Davids ja; ett mått utan läsväg står i saknade fält. Den rena rytmregeln
  `lib/bedomningsrytm.ts` räknar varje period ur ankare och intervall, med fem
  lägen och en enda tabell `INGEN_PERIOD` för varför ingen period räknas;
  kalendermånaden har ingen anropare i produktionen längre. Ny åtgärd
  `satt_bedomningsankare` (write, `kravManniska`, källa obligatorisk, en gång
  per avtal). Läget får panelen Uppföljning och rytm, Bedömning rytmpanelen med
  ankarformuläret, och undantagsvyns begärda bedömning perioden ur rytmen —
  utan period synliga obligatoriska periodfält. Prov:
  `server/test/uppdragsytan-matt-rytm.test.ts` (M, P, I, R, A, L, V, N, B, T,
  D) och omskrivna rigg/assertioner i bedömnings-, begärans-, undantagsvyns-,
  mobil-, besluts-, referens-, import-v3-, laget-, spärr- och undantagsproven
  (hjälparen `server/test/bedomningsrytmHelper.ts`). **Inte kört i den här
  sessionen:** `npm run typecheck`, `npm test` och `npm run build` — sandlådan
  svarade ”This command requires approval”; kedjans körning är belägget.
  **I drift:** migrationen skapar en tabell och nullbara kolumner, inga rader
  ändras. Måtten och rytmen syns först när ett `satt_baseline`-förslag
  godkänns; Davids ankare (8 oktober) sätts sedan på Bedömning. **Ny rutt under
  `/app`:** POST `/c/:companyId/projects/:projectId/bedomning/ankare`.
  `server/kontrakt/navigation.v1.json` redigeras inte för hand, och Hermes prov
  adresskontraktet står RÖTT (K2) tills Davids generator har synkat kontraktet.

- **2026-11-21 — Story 3.3 (crm), mottagaren tar emot löftets avslut och en borttagen deadline (FR-36, FR-8):**
  `ingest_crm_events` tar för löften `status` (`open`/`done`/`dropped`) och ett
  nullbart `due_date`; utelämnat är oförändrat och `null` tar bort datumet.
  Intaget för vidare fälten oförändrade. I `recordCommitment` går statusen genom
  `guardHumanFields` med innehållet, nu med `nullIsWrite`, och den rena regeln
  `syncedCommitmentStatus` (`lib/crmRules.ts`) skyddar en stängd status utan
  ursprungsrad (A-2). Omsändningens enda UPDATE byggs med
  `COMMITMENT_SYNC_FIELDS` och sätter `completed_at` bara vid ett verkligt
  statusbyte mot den låsta raden; ursprunget skrivs med `provenanceForKeys`.
  En stängningshändelse för en okänd källnyckel skapar löftet stängt, med
  statusens ursprung `sync` och `status` i `crm.commitment_recorded`.
  Docs: regel 9 och den rättade meningen under «Människan vinner» i
  `docs/crm/API_KONTRAKT.md`, avsnittet crm 3.3 sist i `docs/MCP_ACTIONS.md`.
  Prov: ny `server/test/crm-commitment-lifecycle.test.ts` (LK1–LK3, LD1–LD4,
  LA1–LA3, LB1–LB4, LM1–LM2, LN1–LN2, LT1–LT2) och en ny `describe` i
  `server/test/crm-rules.test.ts` (LR1–LR2). INTE KÖRT i sandlådan: Bash
  nekades, så varken typkontroll, bygge eller vitest kördes av utvecklaren;
  kedjan kör dem efter sista ändringen. Avsändaren (Hermes skickar `status` och
  `due_date: null`) är berättelse 3.4. Ingen migration, rutt, åtgärd eller tabell
  har tillkommit.
- **2026-11-21 — Story 2.6, scopelinjen med åtgärd ur del 5 (FR-6, FR-7, FR-27, NFR-9):**
  Migration `0094_scopelinje_atgard.sql` vidgar CHECK-villkoret
  `uppdrag_scopelinje_sort_check` med `atgard`. Inga rader ändras, och
  tabellkommentaren, rättigheterna och policyerna är orörda. Parsern
  (`lib/leveranskontrakt.ts`) läser del 5 bara ur avsnitt vars rubrik står i en
  sluten lista, och ur dem tabellrader (ny kolumn ”Det kunden säger”) och
  fetstilsstycken. Innanför och utanför står där med klausul ur etiketten, och
  åtgärden är ett stycke vars etikett säger att en signal tänder eller tänds.
  v3 ger nu elva rader i stället för noll, och v1-formen ger samma 4/4/7 som förut.
  `SCOPELINJESORTER` och den rena `scopelinjelage` ger `scopelinje_lage`
  (`markning` utkast/gallande bara ur `kontrakt_tillstand`, `lage`, `saknade`)
  i `las_kontraktsyta` och per avtal i `las_uppdragslage`, plus
  `farskhet.scopelinje`. Vyn: `scopelinjepanel` ersätter `scopepanel` på
  Kontraktet och står sist på Läget, en per avtal och med egen färskhetsrad.
  Panelen bär märket Gällande eller Utkast, en fjärde grupp ”När en signal
  tänds” (pre-wrap), Saknas per saknad del och en egen mening när inget är
  inläst. Husets `.panel`, chip och `.muted` används; ingen ny CSS, rutt eller skript.
  Rapporten på Bedömning är oförändrad (bara li-markupens blanktecken).
  Prov: ny `server/test/uppdragsytan-scopelinje.test.ts` med M1–M3, P1–P7,
  I1–I2, L1–L4, V1–V6, R1–R7 och D1. I `uppdragsytan-laget.test.ts` räknas
  färskhetsraderna på Läget nu exakt till 7 (fem kort, Beslut och scopelinjen).
  Docs: MCP_ACTIONS (import, Kontraktsytan, Läget, vyerna) och ARKITEKTUR rad 36.
  **Inte kört:** `npm run typecheck` och `npm test` gav båda ”This command
  requires approval” i sandlådan. Varken typecheck, build eller något prov är
  alltså kört här, och kedjans körning är belägget. Externa Hermes-prov och
  webbläsarkontroll är inte körda. **Följd i drift:** driftsättningen kör 0094.
  NVR-001 i drift får scopelinjen först vid en ny godkänd import (en
  `redan_koad` text skriver inget). handgrepp ska stå kvar GRÖNT: inga ensamma
  kodspann med understreck har tillkommit i avsnittet Uppdragsytan.

- **2026-11-21 — Story 3.1, omtag Y6 (uppgift 5):**
  Kedjans röda vyprov delade HTML på ett taggslut som inte finns: Källornas
  befintliga dd har ett style-attribut efter data-falt. Provet återanvänder nu
  artikeln/falt ur undantagsvynHelper och väljer postens id först. Y6 prövar
  två köposter med olika mejlkällor samt kalenderunderlag, och kräver länk,
  verkligt läge, saknad lästid/datum och frånvaro av grannpostens källa.
  Y5 använder samma hjälpares block och kräver att beslutspanelen finns.
  Kriteriernas kärna står kvar; produktens markup, tokens, typografi och
  fokusordning bevaras. Inga beroenden eller API-/CRM-kontrakt ändras.
  `npm run typecheck` före/efter: exit 0, `tsc --noEmit && tsc --noEmit -p
  tsconfig.test.json`. Hela `npm test` före/efter: exit 1 i globalSetup,
  `connect EPERM 127.0.0.1:5433 - Local (undefined:undefined)` före fallen.
  Vyfallen och regressionen är inte körda; deras nästa belägg kommer från
  kedjan enligt nätundantaget. Externa Hermes-prov och webbläsarkontroll
  är inte körda här. Kedjan hanterar granskning, merge och driftsättning.

- **2026-11-21 — Story 3.1, referensernas verkliga läge (B-15, FR-10/26/36):**
  Migration `0093_referens.sql` ger overifierat utgångsläge, utanför-status,
  händelsedatum och fryst Drive-revision. Den rättar aldrig verifierade levande
  rader och kanoniska mejl-id:n i öppna uppdrag; avslutad historik står kvar.
  Kantkontrollen stoppar mejlkrockar före ändring. Formregeln, skrivvägen och
  signaluppslaget delar kanoniskt id; känd utanför-fil avvisas före skrivning.
  Svepets dom består tills en innanför-dom kommer. Saknad fryst revision
  redovisas som ej bedömd utan ny verifieringstid. De sex befintliga vyerna
  använder en gemensam referensvisning med härledda länkar och källa/tid/datum.
  Husets statuspiller, tokens, Public Sans, kodtypografi och länkfokus används;
  tomma värden är vanlig text. Ingen CSS, rutt eller tjänst tillkommer.
  Prov: F1–F3, M1–M7, W1–W10, D1, R1–R6, V1–V8 och Y1/Y3–Y9 samt
  angivna regressioner; Y8 ligger i statusbytesprovet. Testerna skrevs före kod.
  `npm run typecheck`: exit 0; `npm run build`: exit 0.
  `git diff --check`: exit 0. Källkontroller för avgränsning och SQL utan fynd.
  `npm test` före/efter varje uppgift: exit 1 i globalSetup,
  `connect EPERM 127.0.0.1:5433` före fallen. Databas- och vyfallen samt
  helsviten är därför inte körda; kedjans nästa körning är belägget enligt
  nätundantaget. Inga tjänster startade eller migrationer körda manuellt.
  Efter godkänd granskning hanterar kedjan merge, deploy och hälsokontroll.
  Kantkontrollfel blir driftens arbete. Krock eller ett lägre migrationsnummer
  än driftens kedja kräver nästa lediga nummer före merge/deploy. Före 3.2
  förblir händelsedatum null; kalenderlänk kräver namngiven kalender eller datum.
  Utanför-id lämnas till Hermes driftpost, aldrig som fråga i undantagsvyn.
  Externa Hermes-prov och interaktiv webbläsarkontroll är inte körda.
  Story/sprint: review efter alla 26 DoD-punkter med uttryckligt nätundantag.
  Slutstegets hela `npm test` försökt igen: samma EPERM före fallen.


- **2026-11-21 — Story 2.3, kontrollomtag efter röda CRM-regressioner (FR-14):**
  Aliasomläsningen i `crmRelations.ts` låste även aliasraden med FOR UPDATE,
  trots att migration 0059 avsiktligt inte ger app-rollen UPDATE på alias.
  Frågan nekades även utan träff; intaget hoppade över nya organisationer och
  deras följdrader. Låset omfattar nu bara målorganisationen, enligt det
  befintliga aliasuppslaget. Inga utökade rättigheter eller migrationsändringar.
  Nya BS6 i `crm-org-name-norm.test.ts`: tre namnformer i två bolag, verklig
  app-roll med SELECT men utan UPDATE på alias, skapande och exakt omkörning.
  Fem namngivna fel i crm-provenance, crm-review-fixes, crm-schema och
  crm-sfar-3 härledda till samma skrivväg; deras assertioner och fixturer bevarade.
  `npm run typecheck` före/efter och `npm run build`: exit 0.
  Separat Vitest utan databashakar:
  `Test Files 1 passed (1)`, `Tests 94 passed (94)`, exit 0 (crm-rules).
  `npm test` före/efter: exit 1 i globalSetup före fallen,
  `connect EPERM 127.0.0.1:5433`. BS6, de rapporterade regressionerna och
  helsviten måste därför verifieras av kedjan enligt nätundantaget.
  Mekanismkontroller 8.3 a–g och BD1:s dokumentkontroller: PASS;
  `git diff --check` utan fynd. API-kontraktet ändras inte av denna rättning.
  Befintliga ai-card, tokens, typografi och tangentbordsfokus följer husets stil.
  Fullsviten även försökt i slutgrinden: samma EPERM före fallen.
  Story/sprint åter till review efter punktvis DoD med nätundantag.
  Externa prov och interaktiv webbläsarkontroll ej körda. Ingen tjänst startad.

- **2026-11-21 — Story 2.3, omtag efter fem Review Follow-ups (crm, FR-14):**
  Dubblettspärren i `crmIngest` normaliserar även äldre direktköade UUID och
  namn med Unicode-blanksteg, i pending och mottagna beslut; andra namn för
  samma mål förblir egna par. `crmRelations` låser kandidatunderlaget först
  och läser sedan alias och sparade besked på nytt; nytillkomna kandidater
  kräver också lås före beslut. Ett samtidigt ja eller nej följs därmed av
  samma skrivväg. `approvalSummary` påstår bara bolagsformsrelation när de
  aktuella SQL-nycklarna är lika; olika och omdöpta namn får korrekt underlag.
  15 nya parametriserade provinstanser i `crm-org-name-norm.test.ts` täcker
  19 scenarier, inklusive verklig låsväntan med `pg_blocking_pids`, verkställt
  nej, äldre köposter och renderade kort. Kontrakt och MCP_ACTIONS förtydligade.
  Faktisk utdata: `npm run typecheck` exit 0, `npm run build` exit 0;
  separat Vitest utan databashakar: `94 passed (94)` och
  `13 passed | 22 skipped (35)`, båda exit 0. BD1:s dokumentkontroller och
  mekanismkontroller 8.3 a–g PASS; `git diff --check` utan fynd.
  `npm test` körd före/efter lagningarna och i slutgrinden: exit 1,
  `connect EPERM 127.0.0.1:5433` i globalSetup före fallen. Nya databas-/vyprov
  och full regression är därför inte verifierade här; kedjan kör dem enligt
  nätundantaget. Inget nytt paket, migrationssteg, tjänst, rutt eller CSS.
  Kortet använder husets ockra, tokens, typografi, synliga skälfält och fokus.
  Story/sprint lämnas till review efter punktvis DoD med nätundantag.
  Ingen commit, push, driftsättning eller tjänstestart utförd.

- **2026-11-21 — Story 2.3, en bolagsformsvariant blir ett sammanslagningsförslag (crm, FR-14):**
  Migration 0092 ger parvisa besked med sammansatt FK, FORCE RLS och bara
  SELECT/INSERT. Synkens regel i `upsertOrganization` kastar före skrivning;
  `saveOrganizationDistinction` är enda skrivvägen. Den känsliga tvåfasåtgärden
  `merge_crm_name_variant` lägger alias vid ja och sparar besked vid nej med skäl.
  Intaget köar med radlås i händelsens savepoint och redovisar `merge_proposals`;
  audit bär antal och fasta nycklar, aldrig namn. Kortet visar skälet och båda
  beslutsföljderna i husets befintliga ai-card, med dess typografi, knappar,
  synliga skälfält och fokusmarkering. Kontraktet och MCP_ACTIONS är utökade.
  Fall: BM1–BM3, BR1–BR2, BS1–BS5, BG1–BG4, BI1–BI9, BK1–BK2 och BD1.
  Registerrader i vy-kansliga-knappar (båda känsliga handlers),
  forslagskort-klartext (exempelindata) och uppdragsytan-mandat (uttrycklig
  tvåfaslista med likhetskontroll). Inga befintliga assertioner försvagade.
  Den handskapade varianten, notisen och `distinct_from` är berättelse 2.5.
  Rött–grönt per uppgift: `npm run typecheck` körd; senaste avslutade exit 0.
  Rena crm-rules: före 2 failed | 92 passed, efter 94 passed (94), exit 0.
  Separata VK1–VK3 och sändspärrskontroller: 13 passed, exit 0.
  Slutligt rent/statiskt urval: 107 passed | 22 skipped, exit 0. Bygge exit 0.
  Story och sprintstatus: review efter punktvis DoD med nätundantag.
  `npm test` körd i båda faserna per uppgift men stoppas i globalSetup med
  «connect EPERM 127.0.0.1:5433», exit 1. Databasfallen, full regression och
  interaktiv webbläsarkontroll är därför inte verifierade i sandlådan; kedjan
  kör dem enligt nätundantaget. Inget påstående om grön helsvit.
  Ingen rutt, CSS-klass, miljövariabel eller beroende tillkom. Den kända
  GDPR-gränsen för sparade besked följer AC1 och kräver senare beslut.

- **2026-11-21 — Story 2.1, namnkrocken leder till sammanslagningen (crm, FR-29), granskningsomtag:**
  Båda High-fynden gäller UUID-identitet: kandidatlistan jämför nu relationens
  hämtade `o.id` med databasens id, så den egna relationen utesluts även när
  sidans adress har versaler eller blandat skiftläge. Samma lista styr notis,
  förval och formulärets alternativ. V7/V8 utökar vyproven med tre relationer,
  tre stavningar av både sidans och kandidatens id, eget id i båda parametrarna
  och giltiga andra relationer i båda riktningar (72 GET totalt).
  Testerna skrevs före källändringen. Ren kontroll av källans faktiska filter
  och riktiga mergeCandidate: före «8 felaktiga självval av 12 fall», exit 1;
  efter «0 felaktiga självval av 12 fall», exit 0; andra kandidater fungerade.
  `npm run typecheck` och `npm run build`: exit 0. Rena crm-rules körda separat
  utan databashakar: «Tests 92 passed (92)». Full `npm test` vid rött och grönt:
  exit 1 före fallen, «connect EPERM 127.0.0.1:5433» i globalSetup. V7/V8 och
  databasregressionen inväntar därför kedjan enligt föreskrivet undantag;
  ingen grön fullsvit eller interaktiv webbläsarkontroll påstås.
  Husets befintliga notice, rattaform, Public Sans, färgtokens och synliga
  fokusmarkering består, liksom naturlig tangentbordsordning. Eget id ger
  platshållaren eller vanlig felnotis; annan kandidat ger laddat förval.
  Ingen kontraktsändring. Externa prov ej körda; tidigare baslinjes röda
  adresskontrakt och bmadglidning har inte omprövats i detta omtag.

- **2026-11-21 — Story 2.1, namnkrocken leder till sammanslagningen (crm, FR-29):**
  `name_taken` behåller 400 och sin text men får `details` med krockens relations-id
  och sammanslagningsväg. De rena funktionerna `nameTakenOrganization` och
  `mergeCandidate` samt formulärnamnet `slaihop` validerar adressens värden.
  `runViewAction`:s valfria `felParametrar` bär id:t till relationssidans notis,
  som länkar till relationen och öppnar Dubblett? med säkert förval; Slå ihop
  köar samma känsliga förslag i Att göra. Dokumentavsnittet i `docs/MCP_ACTIONS.md`
  och meningen om details i `docs/crm/API_KONTRAKT.md` beskriver kontraktet.
  K1–K7, NK1–NK3, V1–V6 och D2 är tillagda utan ändringar i gamla assertioner.
  `npm run typecheck` passerade vid varje grön fas. Den rena regelprovfilen
  kördes separat utan databashakar: före kod 3 failed, 89 passed; efteråt
  92 passed. D2 kördes separat med samma provkod: 1 failed före dokumenten,
  1 passed efteråt (Vitest-transform i minnet, inga filer ändrade för isoleringen).
  Första försöket att isolera D2 använde fel parameterplats och nådde i stället
  filens HTTP-setup, som nekades med listen EPERM; korrekt isolering kör bara D2.
  Full `npm test` vid rött och grönt: **inte körd förbi globalSetup —
  connect EPERM 127.0.0.1:5433**, exit 1 före fallen. Databas- och genomgående
  vyprov har inga påstådda gröna utfall; kedjan kör hela sviten efter bygget.
  Slutlig typkontroll, `npm run build` och `git diff --check`: exit 0.
  Befintliga VK1–VK3 kördes separat utan databashakar: 9 passed, 14 övriga
  databasfall skipped; härledningen VK3.2 passerade. DoD prövad punkt för punkt
  med det föreskrivna databasundantaget inför review.
  Mekanismkontrollerna och läsningen av regressionsytan håller; inga rutter,
  åtgärder, migrationer eller schemaändringar för indata tillkom.
  Husets notice, små ghost-knappar och rattaform bevarar tokens, Public Sans,
  skala och synlig fokusmarkering. Länkar, summary och select följer naturlig
  tangentbordsordning; utan kandidat står Välj relation… kvar och vanlig felnotis
  används. Laddat läge är serverrenderat enligt arkitekturen, utan klientkod.
  Externa prov har inte körts: berättelsens baslinje anger adresskontraktet och
  bmadglidning RÖDA sedan tidigare, av skäl utanför uppdraget.

- **2026-11-20 — Story 1.8, kundkortets org.nr gäller för en kopplad relation (crm, FR-11, FR-10):**
  `upsertOrganization` avvisar org.nr på en redan kopplad relation för människa
  och agent med 400 `org_number_on_customer` och hänvisning till `update_customer`.
  Intaget lämnar värdet och ursprunget orörda och redovisar `kept_customer_fields`
  i svaret och audit; händelsen skrivs i övrigt. Kundkortets tillåtelselista har
  `org_number`. Relationssidan visar kundkortets org.nr med hinten *Sparas i
  kundregistret* och ett eget org.nr-formulär i *Rätta uppgifter*. Prospektens
  fält och kunduppslaget består. Regel 7 och svarsexemplet i
  `docs/crm/API_KONTRAKT.md` samt avsnittet i `docs/MCP_ACTIONS.md` beskriver regeln.
  OA1–OA9, ON1–ON3, OR1–OR3 och OV1–OV4 täcker beteendet, inklusive negativ
  kontroll av en felskrivning i crm; FK2:s avskaffade främmande org.nr-nyckel ströks.
  Den rena `crm-rules.test.ts` kördes separat utan databashakar: före kodändringen
  3 failed (ON1–ON3), 86 passed; efteråt 89 passed. Typkontrollerna för uppgift 1–2
  och före uppgift 3 passerade. Källträdets åtta sändvägs-/importkontroller och
  deras negativa kontroller passerade separat med node:assert.
  Full `npm test` vid rött och grönt: **inte kört — globalSetup stoppas med
  connect EPERM 127.0.0.1:5433**, exit 1 före fallen. Databasfallen har därför
  inga påstådda gröna utfall; kedjan kör hela sviten enligt databasundantaget.
  Slutlig `npm run typecheck`: exit 0; `npm run build`: exit 0;
  `git diff --check`: exit 0.
  Senast kända externa läge ur berättelsens baslinje: Hermes adresskontraktet
  och bmadglidning RÖDA, continuityvakt KUNDE_INTE och overlamningsregister_fr6
  RÖTT, av skäl utanför berättelsen; de har inte körts här.
  Husets befintliga faktakort, hint, formulär och primärknapp ger samma tokens,
  skala, Public Sans och synligt tangentbordsfokus. Saknat värde är —, fel visas
  i befintlig notis och laddat värde serverrenderas utan separat laddningsläge.
  Ingen rutt, migration, ny åtgärd, tabell, CSS-klass eller dependency tillkom.

- **2026-11-20 — Story 1.12, härledda vakter för känsliga vyknappar (FR-38, AD-1):**
  Endast `server/test/vy-kansliga-knappar.test.ts` har byggts ut. VK1.1–VK1.3
  jämför 37 känsliga åtgärder med funktionstabellen och bevakar tjänsteimporter
  under http med tre filbundna requireHuman-undantag. VK2.1–VK2.2 bevakar de
  två tillåtna grenraderna. VK3.1–VK3.4 härleder vyns anropsställen och kräver
  samma tolv känsliga par som POSTFALL. Kontrollerna fäller planterade fel.
  VK4.1 har en avsiktlig direktbokning i en lokal testapp; VK4.2 har tolv fall
  över tretton riktiga vägar och mäter redirect, köpost, verifikat, konton och
  audit före godkännandet. Story 1.3:s del är bevarad utom två tillåtna kommentarer.
  Fallen skrevs före hjälparna; saknade hjälpare gav TS2304 i de röda stegen.
  VK4.2 skrevs först med tom rigg och utan inloggning, därefter med full rigg.
  `npm run typecheck` efter varje hjälpare och riggen: exit 0;
  `npm run build`: exit 0; `git diff --check`: exit 0.
  Kompletterande isolerad Node/TypeScript-kontroll med node:assert: nio rena
  VK1–VK3-fall utan avvikelse. Det är ingen vitest- eller databaskörning.
  Samtliga fokuserade vitestförsök och full `npm test` vid rött/grönt/grindarna:
  **inte kört — globalSetup: `connect EPERM 127.0.0.1:5433`**, exit 1 före fallen.
  Inga databasfall påstås röda eller gröna; kedjan kör hela sviten efteråt enligt
  berättelsens uttryckliga grindundantag. Formspråket bevaras: ingen yta, token,
  typografi, fokusordning, tomläge, felläge eller laddningshantering ändras.
  Ingen produktionskod, rutt, åtgärd, migration, kontraktsändring eller beroende.
  Inget nytt rött utanför repot orsakas av berättelsen; externa prov är inte ommätta.

- **2026-11-20 — Story 1.3, omtag efter code-review (AC 6):**
  Båda High-fynden gäller samma felklass: Imports väntande SIE-förslag kunde
  ligga utanför Att göras 200 senaste poster, så kortlänken saknade mål.
  Att göra kompletterar nu med bolagets hela väntande SIE-kö via samma
  `listaVantandeKoposter` som Import, med unika id:n och stabil sortering.
  R5.1 följer båda årens verkliga länkar med 198/199/200/240 nyare poster.
  R5.2 kräver alla 207 SIE-kort och täcker dubbletter, främmande bolag,
  avvisning och utebliven import-/auditmutation vid läsning.
  Samma Daglig liggare-kort och fokuserbara ankare återanvänds för igenkänning;
  befintliga tokens, typografi, knappar, fokusmarkering, tomläge och felnotis.
  Sidorna renderas färdiga på servern; inget nytt laddningsläge tillkommer.
  Proven skrevs före koden. `npm run typecheck` före/efter: exit 0;
  `npm run build`: exit 0; `git diff --check`: exit 0.
  Full `npm test` före/efter: **inte kört — `Error: connect EPERM
  127.0.0.1:5433 - Local (undefined:undefined)`**, exit 1 i globalSetup.
  Inga databasfall påstås gröna; kedjan kör dem efteråt enligt uppdraget.
  Vyns SIE-import köas fortsatt; REST-listans fönster och CRM-kontraktet är
  oförändrade. Ingen ny rutt, SQL i transporten, tjänst, CSS eller beroende.
  Externa provstatusar (adresskontraktet, bmadglidning,
  overlamningsregister_fr6, continuityvakt) är inte ommätta här.

- **2026-11-20 — Story 1.3, SIE-import från vyn köas och Import visar sina fel (FR-39, FR-38, AD-1):**
  Vyns SIE-import går nu genom `runViewAction` till Att göra före varje konto
  och verifikat. Endast POST import/sie och import/bank undantas från den
  globala parsern på 16 kB; deras egna 5mb-parsrar ligger efter `viewAuth`.
  Bankimport och avstämning använder samma åtgärdslager med `action.executed`.
  `importRedirect` visar formulär-/verksamhetsfel via `?fel=` och `felNotis`;
  SIE:s år och innehåll kontrolleras före kön utan mutation. SIE-panelen har
  årsväljare, "Importera SIE…" och "kräver godkännande"; väntande förslag
  ersätter formuläret med kortlänk, låst år med lås-chip. Bankytan är kvar.
  Daglig liggare behålls för igenkänning: samma tokens, typografi, knappskala,
  kontrast och synlig fokusring. Native länkar, etiketter och knappar ger
  fokusordning år → SIE-text → import → bank. Tomt läge, väntande/låst läge,
  laddad sida och felnotis är ritade; SSR har ingen separat laddningsvy.
  S1.1–S1.5, V1.1, B2.1–B2.3, F3.1–F3.6 och K4.1–K4.4 är skrivna genom
  session, vy, åtgärd och riktig databas; formregeln har även enhetsassertioner.
  Röd- och grönförsöken med `npm test` samt delgrindarnas vitest-körningar:
  **inte kört — `Error: connect EPERM 127.0.0.1:5433`**, exit 1 i globalSetup
  före testfallen. Inget databasprov påstås grönt; kedjan kör hela sviten.
  `npm run typecheck`: exit 0 (`tsc --noEmit && tsc --noEmit -p tsconfig.test.json`).
  `npm run build`: exit 0 (`tsc`); `git diff --check`: exit 0.
  Ren SIE-formkontroll utan databas:
  `Ren SIE-formkontroll: 9/9 gröna (3 giltiga, 5 tomma/ogiltiga, 1 datumfel)`.
  Ingen ny rutt, migration, åtgärd, CSS-klass eller beroende; inget kontrakt
  mot CRM ändrat. Inget nytt känt rött utanför repot; baslinjens externa
  provläge är inte ommätt här (adresskontraktet, bmadglidning,
  overlamningsregister_fr6, continuityvakt).

- **2026-11-20 — Story 1.7, kundnumret går att rätta från relationssidan (crm, FR-10):**
  `update_customer` tar valfritt `customer_number` med delat `CustomerNumberSchema`
  (1–2 147 483 645). `updateCustomer` låser kundserien före krockuppslaget och
  UPDATE; upptaget nummer ger 409 `customer_number_taken` utan sparande.
  Serien flyttas bara framåt med `customer.number_series_set` i samma transaktion.
  `correctedCustomerFields` tolkar numret och utelämnar blankt/oförändrat; fältet
  Kundnummer ligger först i *Rätta fakturauppgifter* med en förklarande hint.
  Husets Daglig liggare behålls för igenkänning: samma etiketter, typografi,
  tokens och synlig fokusring; native number-fält följer befintliga villkoret.
  Okopplad relation behåller tomläget utan kundkort; fel visas i befintlig notis,
  laddad sida visar registrets nummer. Serverrenderingen har inget nytt laddläge.
  Nytt avsnitt i `docs/MCP_ACTIONS.md`; CRM-kontraktet är oförändrat.
  KA1–KA7, KN1–KN3 och KR1–KR7 täcker åtgärd, serie, audit, tenantgräns,
  oförändrat CRM/fakturaunderlag och formulär. FK2 och KV3 justeras enbart för
  kundnumret som nu är tillåtet. Rött före kod per uppgift; rena KN1–KN3 föll
  uppmätt före tolkningen, sedan 86/86 gröna i hela crm-rules utan DB-hookar.
  `npm run typecheck` och `npm run build` passerar. Hela `npm test` i varje röd/grön fas stoppas före
  testfall av `connect EPERM 127.0.0.1:5433`; databasfallen är inte uppmätt gröna
  och körs av kedjan efteråt enligt uppdraget. Ingen tjänst startad, ingen ny
  rutt, migration, åtgärd, tabell, CSS-klass eller beroende. Inget nytt känt rött
  utanför repot; tidigare externa provstatusar är inte ommätta.

- **2026-11-20 — Story 1.13, förtroendegränsen för agent, contractor och bokförda verifikat (FR-2, FR-3, FR-38):**
  Nio nya fall i `server/test/actions.test.ts`, i fem bolagsisolerade `describe`
  med lokal rigg. Ingen produktionskod ändrad. R1.1–R1.5 prövar beroende och
  audit vid köandet, ingen verkan före ja, mätbar verkan efter ja samt avvisade
  agent-/contractor-anrop utan nya rader i någon public-/crm-tabell och utan
  ändrad projektstatus. A1.1–A1.2 prövar alla fem requireHuman-rutter för
  agent och människa. R2.1–R2.2 prövar action.executed vid genomförd skrivning
  och dess frånvaro vid ett tjänstefel. Motproven skrevs först per uppgift;
  röd typkontroll visade saknade rigghjälpare innan de implementerades.
  Läskontroll bekräftar befintliga fall i actions (nu rad 159),
  audit-immutability (30/47/53/59/63), annual-management (77),
  accounting (110/116/125/141/158/181) och k2-annual (131).
  Inte kört: samtliga `npm test` och `npm run test -w server -- test/actions.test.ts`
  i motprovs- och grönfaserna samt slutgrindarna stoppas i globalSetup av
  `connect EPERM 127.0.0.1:5433`; inga databasfall kallas gröna. Kedjan kör dem
  efter bygget enligt uppdraget; körningsrader och statiska resultat finns i
  berättelsens Dev Agent Record. `npm run typecheck` och `npm run build`
  passerade utan fel. Inget nytt rött utanför repot. Totalsiffran
  för npm test i huvudet är inte uppdaterad med de nio fallen eftersom den
  bara får ändras efter en verklig körning. Husets Daglig liggare behålls;
  detta testbygge ändrar inga ytor, tokens, typografi eller fokusordning.

- **2026-11-20 — Story 1.11, kön och besluten efter kortbytet (FR-27):**
  Ny regressionssvit `server/test/forslagskort-beslut.test.ts` med 14 fall,
  B1.1–B4.2, i sju isolerade bolagsriggar: åtgärdsrutt och MCP-kö,
  exakt verktygslista med planterat motprov, agentens beslutsförbud i MCP,
  REST och direktanrop, människans ja/nej, audit och verifikatkoppling,
  tillbakarullning med synlig felnotis samt tyst `not_pending`.
  Motproven skrevs först per uppgift enligt berättelsens regressionsregel.
  Ingen produktionskod ändrad. Husets Daglig liggare behålls: befintliga
  kort, kvittorader och notiser med samma tokens, typografi och fokusordning.
  Alla vitest-försök i motprovs- och regressionsfaserna, den nya filen och
  hela `npm test`: **inte kört — connect EPERM 127.0.0.1:5433** i globalSetup,
  innan några fall kördes. Kedjan måste pröva databastesterna; inget av dem
  kallas grönt här. `npm run typecheck`: exit 0 (`tsc --noEmit && tsc --noEmit
  -p tsconfig.test.json`). `npm run build`: exit 0 (`tsc`). DoD genomgången
  punkt för punkt med berättelsens «inte kört»-undantag för databasproven.
  Inget nytt står rött utanför repot; ingen rutt eller något kontrakt ändrat.

- **2026-11-20 — Story 1.2, bokslutets bokningar som förslag (FR-22, FR-38, AD-1):**
  Bokslutets avsättning, skatt och resultat går genom `runViewAction` till Att göra
  före bokföringen. Alla fem formulär har en gemensam felredirect; låsta år och
  nollavsättning ger synlig notis. Verksamhetsbeskrivningen använder samma
  åtgärdsväg och audit som övriga skrivningar. Väntande åtgärd för valt år
  ersätter sin knapp med länkat `statusChip('pending')`; knapparna har ellips
  och sektionen hinten "kräver godkännande". Husets typografi, skala, ockra,
  fokusmarkering och formulär återanvänds; beloppsfälten har tillgängliga namn.
  Tomt läge, laddad sida och felnotis ligger i samma serverrenderade yta.
  Täckning skriven: B1.1–B1.5, B2.1–B2.4 och B3.1–B3.3 i `bokslut.test.ts`.
  Befintliga `fixed-assets`, `ink2`, `k2-annual`, `annual-management` och
  `bokslut` läskontrollerade utan omskrivning av tidigare fall.
  `npm run typecheck`: exit 0 (`tsc --noEmit && tsc --noEmit -p tsconfig.test.json`).
  `npm run build`: exit 0 (`tsc`). `git diff --check`: exit 0.
  Röd- och grönkörningar samt hela `npm test` har försökts men inga databasfall
  har körts: globalSetup ger `Error: connect EPERM 127.0.0.1:5433`, exit 1
  (Vitest skriver även "No test files found" när globalSetup avbryts).
  Inga databasprov påstås gröna; kedjan verifierar dem enligt nätundantaget.
  Vyns SIE-import anropar fortfarande tjänsten direkt tills Story 1.3 är byggd.
  Inget nytt känt rött utanför repot; provvakten har inte körts här och
  baslinjens externa provläge är oförändrat. CRM-kontraktet ändras inte.

- **2026-11-20 — Story 1.5, betalfakta via baklänkning (FR-35, FR-8, FR-29, AD-2):**
  Två nya känsliga åtgärder, `link_voucher_and_mark_paid` och
  `unlink_voucher_and_reset_payment`, köas före all verkan. `link_voucher`
  avvisar `mark_paid: true` med 400 och `unlink_voucher` en betalmarkerad
  faktura med 409; båda ger `payment_requires_approval` och `details.use_action`.
  Återställningens kontroll ligger under radlåset efter ursprungskontrollen.
  Förslagskortets text visar faktura, motpart, verifikat och före → efter.
  Husets AI-ockra, typografi, knappar och fokusordning återanvänds. Inga nya
  CSS-klasser eller rutter; tomt läge och felnotis återanvänds i samma SSR-yta.
  Täckning skriven: R1–R7, S1–S6, M1, P1–P6, T6.1–T6.4 och D1.
  `npm run typecheck` har passerat varje delgrind. `npm test` har försökt
  före och efter kodändringarna men stoppas i globalSetup med
  `connect EPERM 127.0.0.1:5433`; inga databasfall har körts och inga påstås
  gröna. Kedjan måste verifiera hela sviten enligt uppdragets nätundantag.
  Slutgrind: `npm run typecheck` exit 0, `npm run build` exit 0 och
  `git diff --check` exit 0; full `npm test` försökt igen med samma EPERM.
  Den rena betalspärren körd separat utan databas med exit 0 för true,
  false och utelämnad flagga. DoD prövad punktvis med nätundantaget;
  berättelsen överlämnas till review för kedjans kontroller.
  Baslinjens röda/KUNDE_INTE-prov (adresskontraktet, chattvag_fr1,
  continuityvakt, overlamningsregister_fr6) står oförändrade; provvakten har
  inte körts här. Antalet registerposter är räknat till 212. Ingen migration
  tillkommer. Agenter som skickar `mark_paid: true` till `link_voucher` får
  400 och ska använda `link_voucher_and_mark_paid`. CRM-kontraktet ändras inte.

- **2026-11-20 — Story 1.1, omtag efter fyra High-fynd (FR-27):**
  Två felklasser rättade i Att göra: bolagsnamn och felnotis går genom samma
  UUID-mask före HTML-escaping; sidan kompletterar de 200 senaste köposterna
  med hänvisade väntande bokningskort via befintlig getApproval i samma
  tenant-transaktion. Delade mål ritas en gång; ett försvunnet eller avgjort
  mål mellan läsningarna ger vägledning utan trasig länk. API-köns fönster,
  beroendets val och kortmodellens textväg bevaras. T4.2 har två UUID i
  bolagsnamnet; R1.1 täcker tomt läge/felnotis, versaler, flera träffar,
  escaping och adresser. R2.1 prövar båda fakturatyperna över 200-gränsen,
  delade mål, avvisade bokningar och ett mål inom fönstret; varje fragment
  härleds ur HTML och ska ha exakt ett fokuserbart mål. Totalt 33 fall i
  forslagskort-klartext. Husets AI-ockra, tokens och fokusmarkeringar behålls
  för ett enhetligt gränssnitt; ingen separat laddningsvy i serverrenderingen.
  Faktisk utdata före/efter respektive rättning: npm run typecheck exit 0.
  Slutgrind: npm run typecheck exit 0, npm run build exit 0 och
  git diff --check exit 0. npm test försökt före/efter båda felklasserna
  och i slutgrinden: exit 1, connect EPERM 127.0.0.1:5433 i globalSetup.
  Inga databasfall körda; kedjan måste verifiera hela sviten. DoD omprövad
  punktvis med det uttryckliga nätundantaget; fyra review-kryss avklarade.
  Ingen migration, rutt, åtgärd eller nytt beroende tillkom; navigations-
  och externa kontrakt orörda. view-create-flows behåller ursprungsbyggets
  skärpta prov. Story 1.10 och 1.11 bär fortsatt de utdelade kriterierna.
  Ingen browser-/driftkontroll utförd och inga tjänster startade.


- **2026-11-20 — Story 1.1, förslagskort i klartext (FR-27):**
  approvalSummary samlar svenska etiketter, värdetexter, bolagsavgränsade
  id-/kontouppslag och kortmodellen med UUID-maskpass. Att göra visar alla
  nästlade fält och svenska titlar, med teknisk åtgärd sist i detaljerna.
  Beroenden pekar på bokningskortet och ersätter godkännandet med en länk;
  saknas bokningen visas vägledning och Avvisa. Husets AI-ockra, typografi,
  skala och fokusmarkering återanvänds. Tomt läge och felnotis bevaras;
  sidan är serverrenderad utan separat laddningsvy. 31 nya fall T1.1–T5.3
  i forslagskort-klartext täcker registret, tjänsten och vyn.
  view-create-flows rad 248–250 läser nu id ur avvisningsformuläret och
  prövar vägledningen före direkt POST, eftersom kortet i läge 3 saknar
  godkännandeformulär. approveLatest och konflikt-/idempotensprovet kvarstår.
  Slutgrind: npm run typecheck exit 0 och npm run build exit 0.
  Databasfri kontroll grön: 36 åtgärder, 100 etiketter, 25 id-uppslag,
  noll etikett-/schemafel; den planterade åtgärden ger exakt fem fynd.
  UUID-masken och mätarens tre negativa kontroller är också godkända.
  Vitest har inte kunnat köras: globalSetup nekas connect EPERM på
  127.0.0.1:5433. Kedjan måste köra databasproven och hela regressionssviten.
  Ingen migration, rutt, åtgärd eller nytt beroende tillkom; navigationskontraktet
  är orört. Inget externt kontrakt ändrat. Story 1.10 och 1.11 bär de utdelade
  kriterierna. Ingen driftsättning gjord.


- **2026-11-20 — Story 1.5, omtag efter röda auditprov (crm, FR-10, FR-11):**
  Både v15Audit och v15Anrop i crm-views sorterar nu på audit_log:s verkliga
  tidskolumn occurred_at och id. Rotorsaken var antaget created_at i två
  testfrågor; övriga tillagda frågor genomgångna mot schemat. KP2 utökat med
  postnummer, telefon och adress i följd: varje sparande kräver senaste
  auditrad, exakt en ny rad i båda loggarna och oförändrat CRM. Befintliga
  vyprov är oförändrade. Faktisk utdata: typecheck exit 0 före/efter, build
  exit 0, rena crm-rules: Test Files 1 passed (1), Tests 83 passed (83).
  npm test före/efter: exit 1, connect EPERM 127.0.0.1:5433 i globalSetup;
  inga databasfall körda här. Kedjan måste verifiera KP-fallen och hela sviten.
  Tillfällig konfiguration för de rena proven borttagen. DoD omprövad punkt
  för punkt med nätundantaget; Status review. Husets befintliga kort,
  typografi och fokusmarkeringar behålls. Inget API-kontrakt ändrat, ingen
  ny produktkod, migration, rutt, åtgärd eller beroende. Ingen driftkontroll
  utförd; adresskontraktet.py och bmadglidning är fortsatt baslinjens externa
  röda enligt berättelsen, inte omkörda i detta omtag.

- **2026-11-20 — Story 1.5, kundkortets fakturauppgifter rättas från relationssidan (crm, FR-10, FR-11):**
  Faktakortet *Kundkortet* läser kundregistret vid varje sidladdning och har
  *Rätta fakturauppgifter* med sju fält. Befintliga factcard/uppgift/rattaform
  bevarar sidans typografi, textbrytning, tokens och fokusmarkeringar; tomma
  värden visas som — och fel som sidans vanliga notis. Grenen
  `?handgrepp=kundkort` i befintliga rättelserutten hämtar kundmålet ur
  relationen och stoppar gamla flikar. `correctedCustomerFields` skickar bara
  ändrade fält och prövar mejl/villkor; `parseEditTarget` stänger grenvalet.
  FK1–FK6/GV1 körda rött (7 failed, 76 passed) före implementation och grönt
  (83 passed) efter, med tillfällig vitest-konfiguration utan databassetup.
  KV1–KV4 och KP1–KP11 skrivna genom hela stacken med CRM-ögonblicksbilder,
  dubbla auditräknare och negativa kontroller. `npm test` före och efter
  uppgifterna stoppas av `connect EPERM 127.0.0.1:5433` i globalSetup, exit 1;
  databasfallen och full regression är därför inte körda i sandlådan.
  Kedjan verifierar dem enligt uppdragets nätundantag. Rena sändvägs- och
  importkontroller över källträdet: åtta kontroller med 0 brister samt U0 och
  N1–N4 godkända. Ingen ny rutt, migration, åtgärd eller schemaändring;
  `update_customer`, åtgärdsdokumentationen och CRM-kontraktet är oförändrade.
  Slutgrind: typecheck, build och diffkontroll exit 0. Renderarens fyllda och
  tomma värden samt escaping kontrollerade; Chromium stoppades av sandlådan
  före visuell kontroll/tangentbordsprov. DoD prövad punkt för punkt med
  nätundantaget dokumenterat; berättelsen och sprintstatusen står i review.
  Inga tjänster startade och ingen driftsättning gjord.

- **2026-11-20 — Story 6.2, likviditet per kalendermånad (FR-44):**
  Ren rullning i `domain/liquidity.ts` och `liquidityByMonth` i reports-tjänsten:
  tre kalendermånader, överfört saldo, förfallet, första underskott och behov,
  okänt med källa vid saknad kassa eller aldrig bokförd leverantörsfaktura.
  Fyra delade SQL-konstanter och AGI-hjälparen behåller prognosens beteende;
  den interpolerade frågan och den återinsatta funktionen jämfördes med basen.
  Nya U1–U10, G0/G1, A1–A4 och O1/O2 i `steering-liquidity.test.ts`.
  U1–U10 och G0 har körts gröna utan databassetup, liksom den befintliga
  dubbelräkningsvakten (14 rena fall totalt). G0 föll först med stubben.
  Typkontrollen kördes röd före nya exporter och grön efter uppgift 1–4.
  `npm test` före/efter varje uppgift stoppas av `connect EPERM 127.0.0.1:5433`
  i globalSetup, exit 1. Databasfallen och full regression är inte körda här;
  kedjan verifierar dem enligt användarens nätundantag. S1 och U1/U2/U3:s
  rena import- och nätkontroller körda över hela källträdet utan brister.
  Kommandon har alltså körts enligt uppdraget, trots berättelsens äldre
  antagande om en byggare utan körverktyg. Inget gränssnitt ändras: befintligt
  formspråk bevaras. Det obelagda och läsåtgärden kommer i Story 6.5,
  visningen i Story 6.3. Inget CRM-kontrakt ändras, inga tjänster startas och
  ingen driftsättning görs. Slutgrind: typecheck, build och diffkontroll exit 0;
  DoD prövad punkt för punkt (24 uppfyllda, två nätundantag). Berättelsen och
  sprint-status står i review; full databasregression väntar på kedjan.

- **2026-11-20 — Story 2.2, projektkoder blir aldrig organisationer och namnen normaliseras på ett ställe (FR-14, FR-30 b):**
  Migration 0091 lägger `crm.normalize_org_name`, genererad `name_norm` och
  ett icke-unikt index per bolag. Bolagsformslistan finns bara där.
  `isProjectCode` och spärren överst i `upsertOrganization` avvisar med
  `project_code_as_name` före databasfrågor och namnalias. Intaget använder
  sin befintliga savepoint och redovisar index och svensk text i `skipped`;
  vyn visar texten i sin notis. Äldre rader kan rättas och döpas om.
  Aliasprovets fixtur NVR-001 är nu NVR-piloten; assertionerna behåller sin
  innebörd. MCP_ACTIONS och API_KONTRAKT beskriver det ändrade kontraktet.
  P1/P2, M1–M5, N1–N6, S1–S6 och D1 täcker beteendet; varje ny del fick
  sina fall före implementationen. Befintliga P-fall och regel behölls vid
  omtaget. Typecheck exit 0 före/efter uppgift 1–3 och före uppgift 4.
  `npm test` före/efter varje uppgiftsgrind stoppas i globalSetup med
  `connect EPERM 127.0.0.1:5433` (exit 1). Inga databasfall har körts eller
  grönrapporterats; kedjan verifierar hela sviten enligt nätundantaget.
  Fristående Vitest-körning utan databassetup: crm-rules 76/76 gröna.
  D1:s första dokumentkontroll föll före ändringen och samtliga dess
  dokumentkontroller passerar efteråt i fristående körning.
  Regressionsytan läskontrollerad; skrivpunkterna är oförändrade.
  Daglig liggares befintliga notis, Public Sans/IBM Plex Mono, petrolaccent,
  tokens, fokusmarkering och tangentbordsordning används, liksom dess tomma
  och laddade lägen. Ingen ny rutt, åtgärd, indata-schemaändring, CSS-klass
  eller beroende tillkom. Ingen tjänstestart, webbläsarprovning eller drift.
  Slutgrind: typecheck, build och diffkontroll exit 0. DoD:s 26 punkter
  prövade; 24 uppfyllda och två hanterade med nätundantaget. Berättelsen och
  sprintstatus står i review; kedjans databasverifiering återstår.
  Externa prov körs av kedjan; inga nya externa resultat påstås här.

- **2026-11-20 — Story 1.6, en människosatt status står kvar när kundkopplingen tillkommer eller flyttas (FR-12, FR-8):**
  `statusAfterLink`, `linkStatusOutcome` och `mergeStatusOutcome` samlar regeln
  i lib. `upsertOrganization` och `mergeOrganizations` skriver räknad status
  utan CASE. Upserten ger en bytt status kopplingens ursprung och redovisar
  stoppet; bekräftelsen låser organisationen före ursprunget. Sammanslagningens
  svar har alltid `kept_human_fields`, och dess auditlogg bär listan vid stopp.
  Att göra-kortets statusmening räknas med samma funktion som körningen;
  relationssidans hint hänvisar dit. MCP_ACTIONS och API_KONTRAKT uppdaterade.
  S1, S2, L1, M1, I1–I6, G1–G5, C1–C3 och D1 skrevs före respektive kod.
  Typecheck före/efter uppgift 1: TS2305 respektive exit 0; därefter exit 0
  vid varje uppgiftsgrind. npm test före/efter varje uppgift: exit 1 i
  globalSetup, connect EPERM 127.0.0.1:5433. Inga databasfall har körts eller
  grönrapporterats; kedjan kör hela sviten enligt användarens nätundantag.
  Regressionerna läskontrollerade utan ändrade befintliga assertioner.
  Slutgrind: build och diffkontroll exit 0; 50 rena regelfall, D1:s
  dokumentkontroller och CRM:s rena sändvägskontroller passerar utan databas.
  DoD:s 26 punkter prövade; berättelse och sprintstatus review med nätundantaget.
  Daglig liggare behålls: befintliga tokens, Public Sans/IBM Plex Mono,
  petrolaccent, tangentbordsordning och fokusmarkering; befintliga tom-/fel-
  och serverrenderade laddade lägen används. Ingen ny CSS-klass eller yta.
  Ingen rutt, migration, åtgärd, schemaändring eller beroende tillkom.
  Ingen tjänstestart, webbläsarprovning eller driftsättning gjordes här.
  Extern baslinje enligt berättelsen: adresskontraktet/bmadglidning kvarstår.


- **2026-11-20 — Story 1.4, tre High-fynd om samtidiga kundkopplingar (AC2/AC3):**
  Gemensam rotorsak: bara uttryckligt kundval tog kundlåset; synkens FK-lås
  tillät en manuell förkontroll mot ett gammalt läge och sedan 500 från indexet.
  Låset ligger nu i den gemensamma krockprövningen för både explicit och
  automatisk koppling, i både INSERT- och UPDATE-grenen. Befintlig relation
  låses före kunden i båda vägarna; en separat SELECT efter väntan ser vinnaren.
  Synkens förlorande händelse redovisas genom befintligt skipped/savepoint,
  och omsändningen redovisar okopplad relation. Kontraktsformen är oförändrad;
  MCP_ACTIONS.md och API_KONTRAKT.md beskriver samtidighetsutfallet.
  Först skrevs S1 (åtta fall: namn/nummer × ny/befintlig synkrelation ×
  nykoppling/byte i vyn) och S2 (fyra fall i omvänd ordning med omsändning).
  Riktiga transaktioner, grind, pg_blocking_pids och finally; inga databasmockar.
  Befintliga fixturer och assertioner är oförändrade. Typecheck före/efter:
  exit 0. npm test före/efter: exit 1 i globalSetup, connect EPERM mot
  127.0.0.1:5433; inga databasfall körda eller grönrapporterade. Kedjan kör
  hela sviten enligt användarens uttryckliga nätundantag.
  Slutgrind: build och diffkontroll exit 0; fullsviten åter blockerad av EPERM.
  Alla 26 DoD-punkter omprövade, tre fynd kryssade enligt nätundantaget;
  berättelse och sprintstatus åter review.
  Husets Daglig liggare med Public Sans/IBM Plex Mono, petrolaccent, native
  select, fokusmarkering och befintliga tom-/fel-/laddade lägen följs.
  Ingen ny yta, CSS-klass, rutt, åtgärd, migration, beroende eller statusregel.
  Ingen tjänstestart, webbläsarprovning, drift eller Hermes-körning;
  adresskontraktet/bmadglidning kvarstår som extern baslinje enligt berättelsen.

- **2026-11-20 — Story 1.4, två High-fynd efter code-review (AC4/FR-8):**
  Båda fynden har samma rotorsak: kunduppslaget i tjänsten kunde lägga till
  utelämnad kundkoppling och därmed ändra status efter formulärets filtrering.
  En gemensam vakt i `crmRelations.ts` hindrar automatiskt uppslag vid en
  människas rättelse med `organization_id`, oavsett vilket fält som rättas.
  Synkens uppslag på namn/org.nr och uttryckligt kundval behåller sin väg.
  Först skrevs A9:s fem parameterfall (namn, org.nr, webbplats, status, roll),
  A10:s fyra synkfall (namn/nummer × ny/befintlig relation) och K6 kompletterades
  med en ledig kund med det nya namnet. Befintliga assertioner bevarade.
  `npm run typecheck` före/efter kod: exit 0. `npm run build`: exit 0.
  `git diff --check`: exit 0. `npm test` före/efter kod: exit 1 i globalSetup,
  `Error: connect EPERM 127.0.0.1:5433`; inga databasfall körda här och inget
  observerat rött/grönt påstås för dem. Kedjan kör hela sviten enligt uppdragets
  uttryckliga undantag. Båda fynden kryssas efter läskontroll av hela felklassen.
  MCP_ACTIONS.md och API_KONTRAKT.md förtydligar utelämnade fält vid rättelse.
  Ingen ny rutt, migration, åtgärd, beroende eller ändring av statusregeln.
  Alla 26 DoD-punkter omprövade med databasundantaget; berättelse och sprintstatus review.
  Befintlig Daglig liggare, typografi, tokens, tangentbordsfokus och formulärlägen
  följs. Hermes-prov, webbläsarprovning, tjänstestart och driftsättning ej körda;
  adresskontraktet/bmadglidning är fortsatt extern baslinje enligt berättelsen.

- **2026-11-20 — Story 1.4, kundkopplingen väljs och byts på relationssidan (FR-10, FR-8):**
  *Rätta uppgifter* har kundval med aktiva kunder i nummerordning och nuvarande
  inaktiva kund kvar som förval. Sex dolda `fore_`-fält gör att bara ändringar
  mot det visade får människans ursprung. `name` får utelämnas med
  `organization_id`; tom rättelse ger `nothing_to_update` utan skrivning.
  Ett uttryckligt kundval slås inte upp och får skrivarens ursprung.
  Kundraden låses före prövningen av en upptagen kund, som ger
  `customer_already_linked` med relationens id och synlig notis.
  Byten går genom samma befintliga statusväg som en ny koppling.
  Sidhuvudets *Ej i kundregistret* länkar till `?oppna=uppgifter`; tillåtelselistan
  ignorerar okända värden. R1–R5, A1–A8, K1–K9 och O1–O3 täcker beteendet.
  Befintliga prov och fixturer är bytevis bevarade. Husets Daglig liggare,
  Public Sans/IBM Plex Mono, petrolaccent, select, fokusmarkering och
  etiketter återanvänds utan nya klasser. Tomt val visar *Ingen koppling*,
  fel visas i befintlig notis, och det laddade läget serverrenderas utan JS.
  Slutgrind: `npm run typecheck`, `npm run build` och `git diff --check`:
  exit 0. Alla 26 DoD-punkter prövade med databasundantaget i 14 och 24;
  berättelsen och sprintstatus är review. Rött i uppgift 1 observerades
  som TS2305 före implementation. Separat Vitest av crm-rules.test.ts utan
  databassetup: `Test Files 1 passed (1)`, `Tests 9 passed (9)`.
  Rena sändvägs-/utskickskontroller inklusive N1–N4 och U0: `PASS`, 0 brister.
  `npm test` försökt före/efter varje uppgift: exit 1 i globalSetup,
  `Error: connect EPERM 127.0.0.1:5433`; inga databasfall kördes och ingen
  grön fullsvit påstås. Kedjan kör databasproven enligt uppdragets undantag.
  Ingen ny rutt, migration, åtgärd eller beroende. MCP_ACTIONS.md och
  API_KONTRAKT.md beskriver schemaändringen. Adresskontraktet och bmadglidning
  var röda före bygget av andra skäl enligt berättelsens baslinje.
  Hermes-prov, tjänstestart, webbläsarprovning och driftsättning har inte körts.

- **2026-11-20 — Story 1.2, två High-fynd efter code-review (AC3/FR-8):**
  Gemensam rotorsak: händelsens bekräftelse skrev human utan samma radlås som
  rättelse och synk. Båda händelsegrenarna i `confirmCrmValue` tar nu
  `FOR UPDATE` före `confirmValue` och behåller låset till commit. Därmed kan
  ingen konkurrerande skrivare läsa gammalt ursprung före vakten. Människospärr,
  bolagsfilter, 404 och audit i samma transaktion står kvar. Inga nya mönster,
  beroenden, migrationer eller sfärändringar. API_KONTRAKT.md berörs inte;
  MCP_ACTIONS.md beskriver låsningen. Två granskningspunkter kryssade med
  berättelsens uttryckliga läskontrollundantag; Status återförs till review.
  Först skrevs 22 nya parameterfall i crm-event-provenance.test.ts: B7 väntan
  på en pågående skrivning (2), B8 alla nio bekräftelsefält från två baslägen
  inklusive null/status och obekräftade fält som negativ kontroll (18), B9
  samtidiga omsändningar för båda händelseslagen (2). Grind och finally håller
  transaktionerna under kontroll. Konkurrerande anrop går genom HTTP/actions;
  ingen databas mockas. Alla äldre fixturer/assertioner är bytevis oförändrade.
  `npm run typecheck` före/efter kod: exit 0. `npm run build`: exit 0.
  `git diff --check`: exit 0. `npm test` före/efter: exit 1 i globalSetup,
  `Error: connect EPERM 127.0.0.1:5433`; inga testfall körda här. Observerat
  rött/grönt och full regression återstår för kedjan, inga gröna databasprov
  påstås. Dev Agent Record och samtliga 26 DoD-punkter omprövade.
  Befintliga Rätta/Stämmer-ytor och Daglig liggares typografi, tokens, fokus,
  etiketter, fel-/tomlägen och serverrenderade laddade läge är lästa och
  behålls; ändringen ligger bakom knappen. Ingen tjänst, webbläsarkontroll,
  driftsättning eller Hermes-körning. Adresskontraktets generatorsynk och
  de tidigare röda baslinjeproven kvarstår enligt föregående sessionsrad.

- **2026-11-20 — Story 1.2, omtag efter fyra röda vyprov (K3/K6/K8/F2):**
  Gemensam felklass i nya provhjälparen `v12TableRow`: exakt `<tr>` missade
  husets befintliga `<tr role="row">` från `staplabaraTabeller`. Matchningen
  accepterar nu radattribut och behåller gränsen vid radens slut. Fyra nya
  parameterfall prövar två olika löften med/utan role, class och data-id,
  före och efter riktig tabellrendering, samt kräver fel för en saknad rad.
  Kärnassertionerna i de fyra rapporterade fallen är bevarade. Provhjälparen
  och de nya fallen kördes isolerat i Vitest: `Tests 4 failed (4)` före
  rättningen, `Tests 4 passed (4)` efter. Tillfälliga provfiler är borttagna.
  Slutlig `npm run typecheck`, `npm run build` och `git diff --check`: exit 0.
  `npm test` försökt före/efter rättningen, exit 1 i globalSetup med
  `Error: connect EPERM 127.0.0.1:5433`; inga databastestfall körda här.
  Kedjans omkörning av K3/K6/K8/F2 och hela sviten återstår enligt undantaget.
  Husets tabellroller och formspråk bevaras för tillgänglighet och mobilvy.
  Berättelsens Dev Agent Record, DoD och Change Log uppdaterade; Status review.
  Adresskontraktet väntar fortsatt på generatorns synk enligt föregående rad;
  Hermes-prov, driftsättning och visuell webbläsarkontroll har inte körts.

- **2026-11-20 — Story 1.2, rätta och bekräfta kontaktpunkter och löften (FR-8, FR-9, FR-36):**
  Två nya write-åtgärder `update_crm_interaction` och `update_crm_commitment`,
  händelsemål i `confirm_crm_value`, radlås före människovakten, ursprung per
  skickat fält och audit med bara fältnamn i samma transaktion. Vaktens valfria
  `nullIsWrite` skyddar ett människosatt datum mot agentens uttryckliga null.
  Tråden och åtagandevyn har *Rätta*, ✦ och *Stämmer* per gissat händelsefält,
  även ett borttaget datum, samt *· rättad av dig* på rättade källhändelser.
  Formulärets rena tolkning finns i `server/src/lib/crmRules.ts`: dolda fore-fält
  håller oförändrade uppgifter utanför rättelsen; kalenderdatum valideras före
  tidsomvandling och dagens löftestid blir Node-klockans nu. Befintligt formspråk,
  etiketter, fokusmarkering, knappar, felnotis och tomlägen återanvänds utan nya
  stilar eller JavaScript. Den laddade sidan är serverrenderad; ingen separat
  laddningsvy införs. Ingen tjänst har startats eller visuell webbläsarprovning körts.
  Ett relationslöst löfte bekräftas genom den enda nya rutten
  `POST /app/c/:companyId/commitments/:id/confirm` men saknar ännu *Rätta* i
  åtagandevyn; action-vägen kan rätta det. Navigationskontraktet är orört.
  `adresskontraktet` står rött tills rutten synkats med generatorn i Davids valv.
  Hermes-proven adresskontraktet, bmadglidning och crmintag var röda i baslinjen
  av andra skäl enligt berättelsen; Hermes-prov har inte körts här.
  Två motiverade avvikelser enligt berättelsen: vaktens nya valfria parameter
  mot A-1:s ”oförändrat” behövs eftersom null i en rättelse är ett beslut;
  standardbeteendet för befintliga anrop är bevarat. `assertEventInOrganization`
  körs i egen tenant-transaktion före `runViewAction` i relationens confirm/edit,
  som persongrenen redan gör; åtgärden prövar alltid bolaget igen i sin egen
  transaktion, och mellanrummet kan bara flytta posten inom bolagets relationer.
  Rättelserna skriver aldrig `sfar`, `organization_id` eller `person_id` och når
  därför inte sfärens UPDATE OF-triggrar (A-1 punkt 6); ingen sfärlogik ändras.
  42 nya fall: R1–R6, L1–L7, B1–B6, D1 i crm-event-provenance.test.ts,
  K1–K8/F1–F10 i crm-views.test.ts och E1–E4 i crm-rules.test.ts. Befintliga
  assertioner och fixturer är bevarade. Typecheck exit 0 efter kodstegen;
  `npm test` försökt före och efter varje uppgift men stoppas i globalSetup av
  `Error: connect EPERM 127.0.0.1:5433` (exit 1), så inga databastester
  grönrapporteras. Separat Vitest-körning av rena regeln: `Test Files 1 passed (1)`,
  `Tests 4 passed (4)`. Rena sändvägs-/utskickskontroller S1–S4/D3/U1–U3
  och negativa kontroller N1–N4/U0: exit 0, `PASS, 0 brister`.
  Extra kontroll av de faktiska vyhjälparnas rendering samt dokumentets D1-ord:
  `PASS`. Slutlig `npm run build` och `git diff --check`: exit 0.
  Berättelse och sprintstatus är `review`, med databastesterna uttryckligen
  okörda enligt uppdragets undantag. Kedjan kör standardsviten efter bygget och
  sköter drift efter godkänd granskning.


- **2026-11-19 — Story 1.3, ursprunget syns för varje uppgift på relationssidan (FR-9, FR-10):**
  Ursprungsmärket har `role="img"`, tillgänglig etikett och källans svenska namn
  följt av nyckeln. Värden utan ursprungsrad visar *ursprung okänt* och kan bekräftas;
  tomma värden får varken märke eller knapp. Status är en egen rad med svensk etikett.
  Personernas namn, roll, e-post och telefon använder samma vyform med *Stämmer*.
  Persongrenen i den befintliga bekräftelserutten använder `assertPersonInOrganization`
  i tenant-transaktion; fel relation/bolag och ogiltigt/tomt person-id ger 404.
  23 nya fall i `server/test/crm-views.test.ts`: U1–U8, Y1, S1–S4, V1–V2,
  P1–P6 och A1–A2. Befintliga prov/fixturer och assertioner är bevarade.
  Typecheck körd med exit 0 efter kodstegen. Hela `npm test` försökt före och efter
  varje kodsteg men hindras före testerna av `connect EPERM 127.0.0.1:5433` i
  globalSetup; inga databastester grönrapporteras. Befintliga rena sändvägs- och
  paketkontroller, inklusive negativa N1–N4/U0, körda med exit 0 och 0 brister.
  Slutlig typecheck, `npm run build` och `git diff --check` exit 0.
  Ingen tjänst startad och ingen visuell webbläsarkontroll körd i sandlådan.
  Ingen rutt, migration, åtgärd eller kontraktsändring tillkom. Sfär och Roll står
  kvar utan *Stämmer* (fråga till David). Inga nya stilar, tokens eller beroenden.
  Enligt berättelsens baslinje står adresskontraktet och bmadglidning röda utanför
  repot sedan tidigare; Hermes-prov inte körda här. Kedjan kör hela sviten före
  granskning och sköter drift efter godkänd granskning; ingen driftåtgärd utförd.

- **2026-11-19 — Story 1.1, ursprung per fält för kontaktpunkter och löften (FR-8, FR-26):**
  Migration `0090_crm_event_provenance.sql` utökar ursprungstabellen till fyra mål,
  med bolagssäkra FK, kaskad och partiella unika index, utan bakåtfyllnad.
  Händelsernas skrivvägar skriver ursprung i samma transaktion; omsändningar tar
  radlås före människovakten och bygger UPDATE med allowlist. Aktörens ursprung
  följer record-åtgärderna, Logga kontakt och statusbytet. Intagets blockerade
  händelsefält redovisas som organisation/person, källnyckel och fält.
  39 nya fall i `server/test/crm-event-provenance.test.ts`: M1–M7, K1–K3,
  P1–P6, H1–H15, E1–E2, S1–S2 och I1–I4. Typecheck körd grön efter varje kodsteg;
  slutligt `npm run build` och `git diff --check` exit 0.
  Hela `npm test` försökt i rött och grönt men stoppas före testerna av
  `connect EPERM 127.0.0.1:5433` i globalSetup; inga databastester grönrapporteras.
  Kedjan kör typecheck, build och hela sviten efter bygget. Sfären i 0087–0089
  och vyn är oförändrade; personens `external_ref` och `notes` byggs i 1.9.
  Inga nya paket, tjänster, åtgärder eller rutter. Ingen driftåtgärd utförd.

- **2026-11-18 (CRM privat och företag, rättningsvarv 3b — uppdrag crmsfar3b, leads beslut 18/11 efter
  `crmsfar3_granskning1.ut`, samma gren `crm-sfar` ovanpå main `fe99c4c`, ej committad):**
  Krav 8: en agents `set_crm_sfar` som skulle ändra sfär (eller roll) på en befintlig organisation,
  person eller ett åtagande verkställs inte utan läggs i Att göra (`action_approvals`; nytt
  `koasForAgent` i `ActionDef`, tjänsten kastar `KraverGodkannandeError` före första skrivningen,
  `executeAction` köar). En människa byter direkt; godkänt verkställs med ursprung `human` och auditrad.
  Omvägarna vägras med 409 `byt_med_set_crm_sfar` och hänvisning dit: `upsert_crm_organization` (sfär,
  roll), `upsert_crm_person` (sfär) och ett omsänt `record_crm_commitment` med annan sfär. `set_crm_sfar`
  tar `roll` för en organisation. Förslagssidan och kvittot skickar bara felkod och radnyckel i adressen
  och ritar texten ur databasen. Kaskaden och ångra låser de valda åtagandena och skriver bara öppna
  (statusvillkor i satsen). Rapportens påståenden om låsordningen och svepet är omskrivna efter koden.
  Ingen migration, inga nya åtgärder (208). Prov: 9 nya i `crm-sfar-3.test.ts` (45), B5/D6–D9/S1
  ändrade. Hela `npm test`: 179 filer, 2895 tester gröna, exitkod 0; `npm run build` ren. Inte gjort:
  grindarna, läsfrågan mot driften. Detaljer: avsnittet «Rättningsvarv 3b» i `BYGGRAPPORT-crm-sfar-3.md`.

- **2026-11-18 (CRM privat och företag, steg 3 av 3: gränsen färdig, byta sfär, «Privat (David)»,
  migreringslistan — uppdrag crmsfar3, leads beslut 18/11, gren `crm-sfar` ovanpå main `fe99c4c`,
  ej committad):**
  Migration `0089_crm_privat_person_utanfor_kunden.sql` (additiv, ingen DROP, `SET LOCAL lock_timeout =
  '5s'`): en privat person ligger aldrig på en kundkopplad organisation (P1) och står aldrig på en
  kontaktpunkt eller ett åtagande där (P2); nya triggrar på `crm.people` (INSERT, UPDATE OF sfar) och
  `crm.interactions`. Låsordningen är nu organisation före person, samma som `mergeOrganizations`
  (granskningens fynd om 0088). Tjänsten har samma regler (`privat_person_kundkopplad_organisation`,
  `_post`, `privat_person_kundkoppling`), också för synken och båda sammanslagningarna. Kundkortet
  visar inte Aktivera för en GDPR-raderad kund, och `update_customer`/`update_supplier` vägrar (409
  `gdpr_raderad`). Nya åtgärder: `set_crm_sfar` (öppna åtaganden följer en organisation bara med
  `cascade_open_commitments: true`, klara och avskrivna rörs aldrig, gränsen gäller) och
  `list_crm_privata_forslag` (läsning); `record_crm_commitment` tar `privat_intern: true`. 206 → 208
  åtgärder. «Privat (<förnamn>)» (privat, roll intern) skapas av tjänsten första gången den behövs och är
  förvald på Min sida i Privat-läget. Förslagssidan `/relations/privata-forslag`: bara kryssade rader
  flyttas, i en transaktion med auditrad per rad, bara av ägaren i en webbsession; kvitto med ångra per
  rad; ingen åtgärd flyttar listan. Dagsytan ger aldrig en privat relation prospektskäl eller «ingen
  registrerad kontakt alls». Krav 9: privat ärende hos en leverantör länkar till `/privat` på Min sida;
  det som återstår i Hermes-ytan står i rapporten. Prov: nya `crm-sfar-3.test.ts` (36), steg 1/2-filerna
  följer beslutet (V-blocket, F4, B8, M1, Y1). Hela `npm test`: 179 filer, 2886 tester gröna,
  exitkod 0; `npm run build` ren. Inte gjort: läsfrågan mot driften före driftsättning, grindarna
  `/code-review` och `/security-review`, krav 9 i Hermes-ytan, ommätning av huvudets siffror. Detaljer,
  vägval, röda kontroller, läsfrågan och öppna punkter: `BYGGRAPPORT-crm-sfar-3.md` i arbetskopians rot.

- **2026-11-18 (CRM privat och företag, steg 2: granskningens fynd, ytan, kundregistret —
  uppdrag crmsfar2, gren `crm-sfar` ovanpå main `d70d649`, ej committad):**
  Migration `0088_crm_privat_via_personen.sql` (additiv, inga data): triggern
  `crm.privat_utanfor_bokforingen()` prövar nu också åtagandets person (ett privat
  åtagande ligger aldrig på en kundkopplad organisation, varken direkt eller via sin
  person), organisationens personer vid kundkoppling, och personflytt (ny trigger
  `people_privat_utanfor_bokforingen`). Raderna läses med `FOR SHARE`, låsta på id,
  så att två samtidiga skrivningar inte tillsammans öppnar vägen. Tjänstelagret har samma
  regler (ny regel `privat_atagande_kundkopplad_person`; `privata_ataganden_kundkoppling`
  också för personflytt och sammanslagningar), `mergePeople` får `sfar_conflict`.
  Kundkortets relationsdel döljer privata personer; `crm_today` räknar och citerar bara
  löften i relationens egen sfär; auditloggen bär `roll` och personens `sfar`.
  Vyn: märket Privat/Företag och filtret Alla/Företag/Privat på Åtaganden och Min sida;
  vald filterknapp är ifylld och bär `aria-current` (Davids fel 18/11); kundkortet har
  Inaktivera/Aktivera via `update_customer`. Prov: `crm-sfar.test.ts` (40, nya V, R, S,
  där S1 sveper varje privat id i varje tabell i `public`; enda tillåtna träff är
  godkännandekön, och där bara CRM-sammanslagningar) och nya `crm-sfar-yta.test.ts` (13).
  Hela `npm test`: 178 filer, 2850 tester gröna, exitkod 0; `npm run build` ren.
  Inte gjort: steg 3 (migreringslistan, Svealand, «Privat (David)»), grindarna
  `/code-review` och `/security-review`, ommätning av huvudets siffror. Detaljer, vägval,
  röda prov och öppna punkter: `BYGGRAPPORT-crm-sfar-2.md` i arbetskopians rot.

- **2026-11-18 (CRM privat och företag, steg 1: data och MCP — Davids order 9/11,
  leads beslut 18/11, gren `crm-sfar`, ej committad):**
  Migration `0087_crm_sfar_och_roll.sql`: `sfar` (`foretag`|`privat`, NOT NULL,
  standard `foretag`) på `crm.organizations`, `crm.people` och `crm.commitments`,
  och `roll` (`kund`|`leverantor`|`partner`|`myndighet`|`intern`, valfri) på
  organisationer. Befintliga rader blir `foretag`. Bokföringsgränsen i databasen:
  CHECK `organizations_privat_utanfor_bokforingen_ck` (privat = ingen
  `customer_id`, aldrig status `customer`) och triggern
  `crm.privat_utanfor_bokforingen()` (privat åtagande aldrig på kundkopplad
  organisation, åt båda hållen). Ny lövmodul `services/crmSfar.ts` (typer, filter,
  felet `privat_bokforingsgrans` med `details.regel`/`details.skal`).
  `list_crm_organizations`, `list_crm_commitments`, `search_crm`, `crm_today`,
  `get_party_crm` tar `sfar` (`privat|foretag|alla`, standard `alla`);
  `upsert_crm_organization` (`sfar`, `roll`), `upsert_crm_person` och
  `record_crm_commitment` (`sfar`, annars arv: organisationen, personen,
  `foretag`). Sfär och roll bär ursprung (människan vinner). Privata
  organisationer slås aldrig upp mot kundregistret; korsande sammanslagning ger
  `sfar_conflict`. Prov: `server/test/crm-sfar.test.ts` (29 fall: M migrationen
  spelas upp mot befintliga rader, F filtret på de fem verktygen, A arvet, P bara
  namn, B gränsen inkl. svep över varje tabell i `public` och SIE-exporten).
  Dokumentation: `docs/MCP_ACTIONS.md`, avsnittet *CRM: privat och företag*.
  Ingen ny åtgärd (fortfarande 206). Inte gjort: steg 2 och 3, sfär på
  kontaktpunkter, byte av sfär på ett befintligt åtagande utan `source_ref`.
  Detaljer, vägval och testutdata: `BYGGRAPPORT-crm-sfar-1.md` i arbetskopians rot.
  Driftnotis: ett outmergat utkast (`cto/prd-crm-8-4-…-9268`, commit `7a531a0`)
  bär också en `0087_…`; den som mergar sist numrerar om.

- **2026-10-25 (Story 1.19, varje nej-utkast når Hermes med mottagare, ämne och text, FR-42):**
  `server/src/services/uppdragSvep.ts` får den slutna listan `UTKAST_TYPER`,
  typen `Utkasttyp`, gränssnittet `Oppetutkast` och läsningen
  `listaOppnaUtkast`, en SELECT ur de frysta beslutsraderna, och
  `kor_uppdragssvep` lägger listan sist i arbetslistan som `oppna_utkast`.
  `server/test/uppdragsytan-utskick.test.ts` får fallen O1–O6, A1 och A2 i
  tre nya block efter U-blocket, som står orört.
  `server/test/uppdragsytan-ovrigt.test.ts`: K7 kräver nu fyra nycklar i
  arbetslistan. `docs/MCP_ACTIONS.md` (Svaret, punkten om fältet och
  Utskicksgränsen) och `docs/ARKITEKTUR.md` (svepets hemvist) beskriver fältet.
  Proven:
  - O1–O6 (a): funktionen direkt (ordagranna fält, nej utan utkast, ja och
    ersatt köpost utanför, mottagare null, grannbolaget och RLS, utgångarna);
  - O1–O5 (b): svepets svar (samma lista, två svep skriver ingenting och
    lämnar panelen orörd, grannen, indatat oförändrat);
  - A2: avsnittet Uppdragsytan har fältets tre kodspann och inga ensamma.
  Inte kört i sessionen: sandlådan nekade `npx vitest run` och
  `npm run typecheck` (`This command requires approval`), så rött och grönt
  är förutsagt, inte observerat. Kedjan kör typecheck och hela `npm test`.
  Driftnotiser:
  1. Ingen migration och ingen åtgärd. Huvudet säger fortfarande 206 actions.
  2. Hermes svepskript sparar arbetslistan i sin tillståndsfil utan
     `ovrigt_kandidater` men med alla andra nycklar. Tills Story 1.20 är
     driftsatt står därför nej-utkastens mottagare och text också i Hermes
     tillståndsfil för svepet, på samma server. Inget skickas. Story 1.20
     (G9) tar bort fältet ur tillståndet.
  3. Davids svar 2026-10-07 om Gmails utkastmapp: redovisningens halva finns
     nu. Gmail-steget är Story 1.20, och till dess är `mailto:`-länken på
     Läget Davids skickväg.

- **2026-10-22 (Story 8.4, sändvägsprovet vaktar kundspärren, FR-23):**
  Nya `server/test/crm-sandvag.test.ts` med tolv fall (N1–N4, S1–S4,
  D1–D3, KV) och `server/test/sandvagHelper.ts` med rena kontroller över
  källtext, återanvända importläsare och 21 föreskrivna planteringar samt
  fem extra (v–z) för import- och deklarationsformer. AC1 vaktas av
  N1/S1/S2 och N4/S4 (importgraf samt SQL utan import), AC2 av N2/S3
  och N3:s direkta köanrop, AC3 av N1–N4/KV, AC4 av N3/D1–D3.
  Sändvägslistan har 36 moduler, kölistan tre filer; CRM-svepet hämtar
  namnen ur ACTIONS (27 i trädet). Ingen produktionskod ändrad.
  Rött/grönt observerat för N1, S1, N4, N2 och N3 via rena Node-körningar;
  de tio kontroller som bara kräver källtext går grönt där. Typecheck
  och build går grönt. Hela `npm test` försökt i varje fas men stoppas före fallen
  i globalSetup: `connect EPERM 127.0.0.1:5433`; HTTP-fallet D1,
  kontrollvakten KV och regressionerna är därför inte körda i sandlådan.
  Kedjan kör ordinarie svit. Continuityvakt/bakvag var GRÖNA enligt
  berättelsens baslinje, har inte körts här; huvudets tal och S0.1-raden
  är orörda. API-kontraktet och dagsytans formspråk är oförändrade.

- **2026-10-22 (Story 7.2, omtag efter kodgranskningen: sex fynd, FR-15):**
  1. **En väg till varje lagringsfel:** `lagringsfel` i
     `server/src/services/objektlagring.ts` bygger nu varje
     `storage_unavailable`, `object_missing` och `object_exists`, också
     bekräftelsens saknade objekt i `server/src/services/receiptFiles.ts`
     (som därför ändrats på en rad). Felet namnger lagringen ur gränssnittets
     `namn`, och samma funktion skriver driftloggens rad
     `[objektlagring] lagringsfel <lagring> <operation> <kod> <Node-kod>`
     med bara koder. errorHandler loggar inte ett AppError, så utan raden
     lämnade full disk eller ett försvunnet objekt inget spår. Node-koden
     släpps bara igenom i formen av en felkod, annars `okänd`.
  2. **Ingen halv fil:** ett skrivfel efter att `wx` skapat filen tar bort
     filen innan 503 kastas, så att samma länk fungerar igen i stället för
     att ge `object_exists` tills TTL-städningen.
  3. **Samma läge, samma svar:** `las` och `storlek` klassar «saknas» med
     samma lista (ENOENT, ENOTDIR). Gränssnittets JSDoc anger exakt vilka
     lägen som är «saknas» och vilka som är lagringsfel. Kvar står ett
     medvetet undantag: en katalog på objektets plats ger null i `storlek`
     men 503 i `las` (berättelsens L2 och L3).
  4. **Prov:** L1–L7 i `server/test/kvittobilagor-lagring.test.ts`
     prövar driftloggens rad (exakt en, utan lagringsroten); L1 prövar
     ENOTDIR i `storlek` och `las`; L2 prövar `details.lagring`; nya L8
     planterar ett skrivfel mitt i skrivningen, med en felkod och med en
     kod som bär en sökväg.
  5. **Dokumentet:** stycket «Lagringen:» i `docs/MCP_ACTIONS.md` kopplar
     «förblir obekräftad» bara till PUT och bekräftelsen, och nämner
     `details.lagring` och driftloggen.
  6. **Inte kört:** typecheck och vitest. npm och tsc krävde godkännande i
     sessionen, och det gick inte att ge; kedjan kör dem efteråt.

- **2026-10-22 (Story 7.2, kvittobilagornas lagring är ett uttryckligt val och felen namnger lagringen, FR-15):**
  1. **Ändrat:** `RECEIPT_STORAGE_DRIVER` (bara `lokal`; tomt eller inget
     värde ger `lokal`, allt annat stoppar starten) i `server/src/config.ts`;
     namnet (`namn`, `Lagringsnamn`), valet i `objektlagring()` och
     felöversättningen i `server/src/services/objektlagring.ts` (503
     `storage_unavailable` med `details` `{ lagring, operation }`, 409
     `object_missing` och 409 `object_exists`; aldrig Node-felets
     `message`, som bär sökvägen); subklassen `ServiceUnavailableError` (503)
     i `server/src/lib/errors.ts`; stycket «Lagringen:» under Kvittobilagor i
     `docs/MCP_ACTIONS.md`. `server/src/services/receiptFiles.ts` är orörd.
  2. **Beslutet:** ingen S3-driver och inget flyttkommando, eftersom Davids
     svar 2026-10-16 låter bilagorna ligga kvar på servern (inget konto, inga
     nycklar och inget beroende). Epikens kriterier för 7.2 i
     `_bmad-output/planning-artifacts/epics.md` förutsätter S3 och behöver en
     correct-course i planen.
  3. **Prov:** R1 och den gränssnittsbundna existensprövningen
     (`objektFinns`) i `server/test/kvittobilagor.test.ts`; G1, V1, V2 och
     L1–L7 i `server/test/kvittobilagor-lagring.test.ts`; K1–K4 i
     `server/test/failfast.test.ts`.
  4. **Inte kört:** typecheck, build och vitest (Körning 1b, 2a, 2b, 3a och
     3b) — sessionen hade inget skal: varje kommando, också `git status`,
     krävde godkännande, och det gick inte att ge. Att de nya fallen var röda
     före koden och är gröna efter den är alltså inte uppmätt i den här
     sessionen; fallistan är genomgången statiskt mot koden. Kedjan kör
     `npm ci`, typecheck och hela sviten efteråt.
  5. **Baslinjen:** provvaktens continuityvakt och redovisning_fortroende
     stod KUNDE_INTE före bygget; bygget rör inget de mäter. Punkten står
     under rubriken och rör inte huvudet som continuityvakt läser.
  6. **Ingen migration**, ingen ny åtgärd, ingen ny rutt och inget nytt
     beroende. `RECEIPT_STORAGE_DRIVER` är ny, så en miljöfil utan den
     startar appen med lokal lagring som i dag.

- **2026-10-22 (Story 4.5, omtag efter kodgranskningen: fyra fynd, FR-19):**
  1. **Ändrat:** förslagskortet för `set_vat_box_accounts` i
     `server/src/services/approvalSummary.ts` tar vad varje ruta blir ur den
     nya regeln `vatBoxSources` i `server/src/services/vatDeclaration.ts`,
     som deklarationen också läser för ruta 21. Utan konto för 20–24 säger
     kortet att ruta 21 räknas ur den utgående momsen, inte att den förblir
     0, och en ruta som går till 0 från ett belopp «blir 0».
     `setVatBoxAccounts` tar ett transaktionslås per bolag före DELETE, så
     att två samtidiga godkännanden varken ger en union av listorna eller en
     krock i primärnyckeln. Registrets schema och kortets läsning av
     kontonumret använder `AccountNumberSchema`. Filhuvudet och kommentarerna
     i `vatDeclaration.ts` beskriver beräkningen med kontolistan.
  2. **Prov:** M10, L9a–L9d, L10 och L11 i
     `server/test/vat-declaration.test.ts`.
  3. **Inte kört:** typecheck, build och vitest — sessionens skal krävde
     godkännande för npm, och det gick inte att ge. Kedjan kör `npm ci`,
     typecheck och hela sviten efteråt.
  4. **Baslinjen:** oförändrad sedan punkten nedan; omtaget rör inte
     provvaktens källor eller huvudet i `docs/STATUS.md`.

- **2026-10-22 (Story 4.5, momsdeklarationens nollsatta rutor räknas ur bokföringen, FR-19):**
  1. **Ändrat:** migration 0086 (`vat_box_accounts`, bolagets kontolista för
     momsrutorna, med RLS och FORCE; app har SELECT, INSERT och DELETE),
     den känsliga åtgärden `set_vat_box_accounts` i registret, reglerna
     (`MAPPABLE_VAT_BOX_CODES`, `mappedBoxAmounts`, `withoutMappedAccounts`,
     `reverseIsDistributed`, `reverseBaseWarning`, `vatDisclaimer`) och
     läsningen och skrivningen i `server/src/services/vatDeclaration.ts`.
     `vatDeclaration` räknar nu rutorna 06–08, 20–24, 37–38 och 40 ur listan,
     drar 06–08 från ruta 05, varnar när underlaget i 20–24 inte stämmer med
     momsen i 30–32 och svarar med `box_accounts`. Förslagskortets gren står i
     `server/src/services/approvalSummary.ts`, och punkterna om
     `vat_declaration` och `set_vat_box_accounts` i `docs/MCP_ACTIONS.md`.
  2. **Prov:** M1–M9, L1–L8, S1 och D1–D4 i
     `server/test/vat-declaration.test.ts`.
  3. **Inte kört:** typecheck, build och vitest (Körning 1a, 1b, 2a, 2b, 3a
     och 3b) — sessionens skal krävde godkännande för npm och git, och det
     gick inte att ge. Att de nya fallen var röda före koden och är gröna
     efter den är alltså inte uppmätt i den här sessionen; fallistan är
     genomgången statiskt mot koden. Kedjan kör `npm ci`, typecheck och hela
     sviten efteråt, med 0086 i testdatabasens migrationskedja.
  4. **Efter driftsättningen** (inte gjort i bygget): Locollabs har ingen
     kontolista, så deklarationen räknas som förut tills Hermes lagt
     förslaget med `set_vat_box_accounts` och David godkänt det i Att göra
     (Davids svar 2026-10-16).
  5. **Baslinjen:** provvaktens crmintag står RÖD och continuityvakt
     KUNDE_INTE sedan före bygget. Bygget rör inte deras källor, och punkten
     rör inte huvudet i `docs/STATUS.md`.

- **2026-10-21 (Story 5.6, agentens fel säger alltid var och varför, FR-28):**
  1. **Ändrat:** ny modul `server/src/mcp/karnanrop.ts` (AD-11) med
     `TIMEOUT_MS`, `anropaKarnan` (nätanropet och läsningen av kroppen under
     en tidsgräns och i ett omslag) och `karnfel` (felets enda form,
     «Kunde inte nå kärnan på {adress}: {orsak} — kör self_check»). `hamta`,
     `api` och verktygshanterarens fångst i `server/src/mcp/server.ts`
     använder den; ett HTTP-fel med kropp återges som förut. Ny punkt i
     `docs/MCP_ACTIONS.md`.
  2. **Prov:** P0–P6 (felets form), F1–F6 (hela anropet mot en stubbe:
     vägrad anslutning, inget svar, kroppen stannar, kroppen bryts, 400 och
     409) och E0–E3 (källtexten och MCP-servern som barnprocess) i
     `server/test/mcp-felomslag.test.ts`.
  3. **Inte kört:** typecheck, build och vitest (Körning 1a, 1b, 2a, 2b, 3a
     och 3b) — sessionens skal krävde godkännande för npm, och det gick inte
     att ge. Att de nya fallen var röda före koden och är gröna efter den är
     alltså inte uppmätt i den här sessionen; fallistan är genomgången
     statiskt mot avbildningen och anropet. Kedjan kör `npm ci`, typecheck
     och hela sviten efteråt.
  4. **Står rött utanför bygget:** Hermes prov som redan stod rött eller
     KUNDE_INTE i provvaktens senaste körning före bygget (beslutsslutet och
     adresskontraktet RÖD; continuityvakt, startsida_prov och modulprov
     KUNDE_INTE). Bygget rör inget som de mäter, och punkten rör inte huvudet
     i `docs/STATUS.md`.
  5. **Nästa:** David når den nya felformen i sin Claude Desktop först när
     hans lokala kopia är uppdaterad och byggd (`npm run build`), eftersom
     konfigurationen pekar på serverns byggda fil (`docs/KOM_IGANG.md`,
     avsnittet «Bygg MCP-servern en gång»).

- **2026-10-21 (Story 5.4, varje tabell bevisas ha RLS med FORCE, FR-26):**
  1. **Ändrat:** nytt katalogprov `server/test/rls-katalog.test.ts` (AD-13)
     över varje tabell i `public` och `crm`: en enda läsning av `pg_class`
     och en sluten regel A1–A7, med listan över övriga tabeller (policy och
     skäl: `companies`, `email_outbox`) och listan «saknar RLS och FORCE —
     åtgärdas i Story 5.5» (`users`, `schema_migrations`). Nytt block sist i
     `server/test/tenant-isolation.test.ts` för varje bolagsrutt och
     appens roll. Ingen ändring i `server/src/` eller `server/migrations/`.
  2. **Prov:** K1–K3 och N1–N5 i katalogprovet (planterade tabeller i
     transaktioner som rullas tillbaka, och ändrade kopior av listorna), T0–T3
     i `tenant-isolation` (B får 403 eller 404 på varje monteringspunkt för
     läsning och skrivning, A:s eget anrop är kontrollen, ingen rad skrivs).
  3. **Inte kört:** typecheck, build och vitest (Körning 1a, 1b, 2a, 2b, 3a
     och 3b) — sessionens skal krävde godkännande för npm och för git. Att
     N1–N5 var röda före regeln och att alla fall är gröna efter den är alltså
     inte uppmätt i den här sessionen; fallistan är genomgången statiskt mot
     reglerna och routerfilen. Kedjan kör `npm ci`, typecheck och hela sviten
     efteråt.
  4. **Står rött utanför bygget:** inget, utom provvaktens continuityvakt,
     som står KUNDE_INTE sedan före bygget; punkten står under rubriken och
     rör inte huvudet, som det provet läser.
  5. **Nästa:** Story 5.5 tömmer listan; när den är tom gäller kravets «varje
     tabell» utan undantag.

- **2026-10-21 (Story 4.7, leverantörsreskontran stämmer för ett historiskt datum, FR-29):**
  1. **Ändrat:** `accountsPayableAging` i `server/src/services/reports.ts`
     avgränsar med `as_of` både fakturorna (verifikatets datum, bokföringen
     eller baklänkningen, senast `as_of`) och betalningarna
     (betalningsverifikat daterade efter `as_of` läggs tillbaka på
     återstoden); utan `as_of` är urval och belopp som förut. Ny punkt om
     `accounts_payable_aging` i `docs/MCP_ACTIONS.md`.
  2. **Prov:** H1–H4 och P1–P5 i `server/test/supplier-invoices.test.ts`, i
     ett eget block med eget bolag; P5 visar att reskontran är lika med
     saldot på 2440 på två datum, och H4 jämför utan `as_of` med dagens
     definition ur databasen. De befintliga fallen i filen står oförändrade.
  3. **Inte kört:** typecheck, build och vitest (Körning 1a, 1b, 2a och 2b) —
     sessionens skal krävde godkännande för npm, tsc och git. Att de nya
     fallen var röda före koden och är gröna efter den är alltså inte
     uppmätt i den här sessionen; fallistan är genomgången statiskt mot
     frågan. Kedjan kör `npm ci`, typecheck och hela sviten efteråt.
  4. **Baslinjen:** provvaktens continuityvakt står KUNDE_INTE sedan före
     bygget; punkten står under rubriken och rör inte huvudet, som det
     provet läser.
  5. **Ingen migration**, ingen ny åtgärd, ingen ny rutt och ingen ändrad vy;
     vyn och CSV-exporten läser reskontran utan datum som förut.

- **2026-10-21 (Story 4.4, momsvakten varnar för varje inköp utan ingående moms, FR-19):**
  1. **Ändrat:** den rena, exporterade regeln `inputVatCompletenessWarning` i
     `server/src/services/vatDeclaration.ts` ger varningen när ruta 48 är 0
     och inköpen på 5000–6999 är större än 0, med beloppet i kronor och ören
     via `formatOre`, och annars null. `vatDeclaration` anropar den en gång,
     och tröskeln på 5 000 kr är borttagen utan ersättare. Textens början
     «Ingående moms (ruta 48) är 0» står kvar. Ny punkt om `vat_declaration`
     i `docs/MCP_ACTIONS.md`, som säger att de nollsatta rutorna i dag är 0.
  2. **Prov:** F1–F6 (regeln utan databas), V1–V4 (genom hela stacken, ett
     eget bolag med inköp på 100 kr och på ett öre), K1 (konstantens namn
     borta ur källtexten, med planterat namn som negativ kontroll) och R1
     (auditraden `tax.vat_method_set`, som inget prov läste förut) i
     `server/test/vat-declaration.test.ts`. De befintliga fallen i samma fil
     och i `server/test/voucher-links.test.ts` står oförändrade.
  3. **Inte kört:** typecheck, build och vitest (Körning 1a, 1b, 2a och 2b) —
     sessionens skal krävde godkännande för npm-kommandon och för git. Att
     de nya fallen var röda före koden och är gröna efter den är alltså inte
     uppmätt i den här sessionen. Kedjan kör `npm ci`, typecheck och hela
     sviten efteråt.
  4. **Baslinjen:** provvaktens continuityvakt står KUNDE_INTE sedan före
     bygget; punkten står under rubriken och rör inte huvudet, som det
     provet läser.
  5. **Ingen migration**, ingen ny åtgärd, ingen ny rutt och ingen ändrad vy;
     vyns ruta «att kontrollera» visar samma `warnings` som förut.

- **2026-10-21 (Story 4.3, agenten kan bifoga dokument upp till 10 MB, FR-18):**
  1. **Ändrat:** `server/src/services/documents.ts` exporterar bredvid
     `MAX_DOCUMENT_BYTES` tre konstanter: `MAX_DOCUMENT_BASE64_CHARS`,
     `DOCUMENT_JSON_ENVELOPE_MARGIN_BYTES` (16 KiB) och
     `ATTACH_DOCUMENT_BODY_LIMIT_BYTES` (13 997 400 byte), den enda källan
     för kroppsgränsen. `server/src/http/routes/actions.ts` har
     tillåtelselistan `isAttachDocumentRequest` och den stora parsern, som
     körs som mellanvara på `POST /actions/:action` bara för
     `attach_document`, alltså först efter `authenticate` och
     `requireCompanyAccess`. `server/src/http/app.ts` hoppar över den globala
     parsern på 1 MB bara när `isAttachDocumentRequest` är sann; allt annat
     har kvar 1 MB. Punkten om `attach_document` i `docs/MCP_ACTIONS.md`
     säger detsamma.
  2. **Prov:** R2, K1, F1 och A1–A5 i `server/test/documents.test.ts`. R2
     bilägger PDF, PNG och JPG på alla fem posttyper, K1 binder gränsen till
     `MAX_DOCUMENT_BYTES`, F1 prövar tillåtelselistan, A1 en PDF på 9,9 MB,
     A2 och A3 gränserna med lagerläget före och efter, A4 att kroppen inte
     tolkas före autentisering och bolagsåtkomst och A5 att andra rutter har
     kvar 1 MB. De befintliga fallen i samma fil står oförändrade.
  3. **Inte kört:** typecheck, build och vitest (Körning 1b, 2a, 2b, 3a och
     3b) — sessionens skal krävde godkännande för npm-kommandon och för git.
     Att de nya fallen var röda före koden och är gröna efter den är alltså
     inte uppmätt i den här sessionen. Kedjan kör `npm ci`, typecheck och
     hela sviten efteråt.
     **Omtag (kedjans typecheck föll):** `actions.ts(64,5)`, `req.params.action`
     var `string | string[]` i handlern. Mellanvaran var typad med `Request`
     utan parametrar, och en mellanvara på en rutt avgör `req.params` också
     för handlern efter den (`ParamsDictionary` i Express 5-typerna). Lagat
     genom att mellanvaran typas med rutten `/actions/:action`
     (`Request<{ action: string }>`); handlern är orörd. Lärdom: en typad
     mellanvara på en rutt med parametrar ska bära ruttens parametertyp.
  4. **Baslinjen:** provvaktens adresskontraktet och crmintag står RÖD och
     brieflankar, continuityvakt, kartan, redovisning_fortroende och
     startsida_prov står KUNDE_INTE sedan före bygget; bygget rör inget de
     mäter. Punkten står under rubriken och rör inte huvudet.
  5. **Ingen migration**, ingen ny åtgärd, ingen ny rutt och ingen ändrad vy.
  6. **Driftnot:** en omvänd proxy framför API:t, om en sådan finns, måste
     släppa igenom kroppar upp till `ATTACH_DOCUMENT_BODY_LIMIT_BYTES`
     (13 997 400 byte) för attach_document; annars ger den 413 innan appen
     nås. Det prövas inte i repot.

- **2026-10-20 (Story 4.2, lönespecen visar alla fem ackumulerade belopp, FR-16/FR-18):**
  1. **Ändrat:** `payrollYearSummary` i `server/src/services/payroll.ts` fick
     den valfria gränsen `through_period` och det typade svaret
     `PayrollYearSummary`. Åtgärden `payroll_year_summary` sätter aldrig
     gränsen och svarar som förut. Lönespecen
     (`server/src/services/payslipPdf.ts`) har ingen egen summering längre:
     den läser sina fem belopp ur samma funktion och visar blocket
     «Ackumulerat {år}» med bruttolön, skatt, nettolön, arbetsgivaravgift och
     semesterersättning, till och med specens period. «Ack. Förmån» med 0
     står kvar. Punkten om `payroll_year_summary` i `docs/MCP_ACTIONS.md`
     säger detsamma.
  2. **Prov:** P1, A1, A2, A3 och B1 i den nya
     `server/test/payslip-ackumulerat.test.ts`. P1 anropar renderaren direkt
     och bär den negativa kontrollen (andra tal och ett annat år), A2 binder
     åtgärdens svar och specens text rad för rad, A3 prövar gränsen till och
     med specens period och B1 årsgränsen. `documents`, `agi` och
     lönesviterna står oförändrade.
  3. **Inte kört:** typecheck, build och vitest (Körning 1b, 2a och 2b) —
     sessionens skal krävde godkännande för npm-kommandon och för git. Att
     de nya fallen var röda före koden och är gröna efter den är alltså inte
     uppmätt i den här sessionen. Kedjan kör `npm ci`, typecheck och hela
     sviten efteråt.
  4. **Baslinjen:** provvaktens `continuityvakt` står oförändrad på
     KUNDE_INTE; punkten står under rubriken och rör inte huvudet.
  5. **Ingen migration**, ingen ny åtgärd och ingen ändrad vy.
  6. **Driftnot:** redan genererade lönespecar ändras inte. En ny spec för
     ett befintligt lönebesked genereras med `generate_payslip_pdf` och
     kopplas bredvid den gamla.

- **2026-10-20 (Story 3.4, menyn mäts vid de fastställda fönsterstorlekarna, NFR-9):**
  1. **Ändrat:** det nya provet `server/test/menyn-fonsterstorlekar.test.ts`
     med riggen `server/test/menymatningRigg.ts`, och skriptet `test:meny` i
     `server/package.json` och i rotens `package.json` (`npm run test:meny`
     kör bara provfilen; provet ingår också i `npm test`). Ingen fil under
     `server/src` är ändrad, och inga beroenden.
  2. **Vad provet mäter:** Chromium vid 1280 × 800, 1440 × 900 och
     2560 × 1440 i zoom 100 % kräver `scrollHeight − clientHeight = 0` på
     `.navmenu__panel`, ingen vågrät rullning och `overflow-y: auto` som
     skyddsnät. Vid 390 × 844 får panelen rulla inuti, men sidan får inte
     rulla i sidled. Två negativa kontroller planterar innehåll (40 extra
     menyposter vid 1280 × 800 och ett 2 000 px brett element vid 390 × 844)
     och måste ge ett fynd. Utan webbläsare blir varje webbläsarfall rött
     med «kunde inte köras: {orsak}», aldrig grönt och aldrig överhoppat.
  3. **Bakgrund:** punkten för 2026-09-24 (#182) sa att repot inte fick
     någon egen mätrigg, eftersom Hermes rigg mätte efter deploy. Nu mäts
     mätvillkoret ur UX-specifikationen också i repots egen svit, före
     driftsättningen. `server/test/appmenyn-hel.test.ts` vaktar fortfarande
     reglerna, och det nya provet mäter följden.
  4. **Inte kört:** typecheck, build, `npm run test:meny` och vitest —
     sessionens skal krävde godkännande för npm-kommandon och för `tsc`
     direkt. Att menyn har 0 px dolt i kedjans Chromium är alltså inte
     uppmätt i den här sessionen. Kedjan kör `npm ci`, typecheck och hela
     sviten efteråt.
  5. **Baslinjen:** provvaktens `continuityvakt` står oförändrad på
     KUNDE_INTE; punkten står under rubriken och rör inte huvudet.

- **2026-10-20 (Story 2.5, kravfilen säger bruttometod från september 2026, FR-17):**
  1. **Ändrat:** K2-raden i `docs/ACCEPTANS.md` säger bruttometod med
     skuldkontona 2710/2731 för perioder från och med 2026-09 och kontantmetod
     (7010 D / 1930 K = verkligt netto, skattekontot 2510 D / 1930 K) för
     tidigare perioder, med beslut #107 som källa, och pekar på testfallet B1.
     Inga andra rader i ACCEPTANS är ändrade; testantalet på rad 8 är orört
     (det skrivs av Hermes skript `hermes/skills/statussiffror.py`).
  2. **Prov:** B1 («K2 brytpunkten: 2026-08 bokförs med kontantmetoden och
     2026-09 med bruttometoden», eget bolag, fyra verifikat med exakta rader)
     i `server/test/payroll-payment.test.ts`; A1–A3 i den nya
     `server/test/acceptans-k2.test.ts`, där A2 är den negativa kontrollen med
     den gamla radtexten.
  3. **Inte kört:** typecheck och vitest — sessionens skal nekade
     npm-kommandon. Kedjan kör `npm ci`, typecheck och hela sviten efteråt.
  4. **Baslinjen:** provvaktens `continuityvakt` stod på KUNDE_INTE i
     baslinjen vid create-story (körning `897455058fe4`). Bygget ändrar inget
     som provet mäter: talen före «tester», «sviter» och «actions» i
     STATUS-huvudet och i ACCEPTANS.
  5. **Ingen produktionskod och ingen migration** ändras.

- **2026-10-20 (Story 1.8, dubbel skattebetalning ger rätt besked, FR-37, AD-14):**
  1. **Ändrat:** `bookPayrollTax` i `server/src/services/payroll.ts` tar först
     ett transaktionslås per bolag och period (`lockPayrollTaxPeriod`,
     `pg_advisory_xact_lock`) och slår sedan upp periodens rad i
     `payroll_tax_payments`, före summeringen, räkenskapsåret och
     `postVoucher`. En andra `book_payroll_tax` för en betald period ger
     därför 409 `already_booked` i stället för `already_posted` eller
     `period_locked`, och inget verifikat skapas. Fångsten av 23505 kring
     INSERT är borttagen; det unika villkoret är sista linjen. Punkten om
     spärren står under «Lön (K1–K3)» i `docs/MCP_ACTIONS.md`.
  2. **Prov:** R1, R2, D1–D4, V1, K1, G1 och M1 i den nya
     `test/payroll-tax-dublett.test.ts`; P1 i `test/payroll-payment.test.ts`;
     R3 i `test/autopost-vat-sie.test.ts`; R4 i `test/business.test.ts`.
  3. **Inte kört:** typecheck, build och vitest — sessionens skal krävde
     godkännande för npm-kommandon. Kedjan kör `npm ci`, typecheck och hela
     sviten efteråt.
  4. **Baslinjen:** provvaktens `continuityvakt` står oförändrad på KUNDE_INTE;
     punkten står under rubriken och rör inte det provet mäter.
  5. **Ingen migration** tillkommer.
  6. **Bakgrund:** bygge 9243 markerade berättelsen done utan ändring i koden,
     och bygge 9245 stannade med HALT. Det här bygget är ändringen.
  7. **Driftnot:** i drift märks ändringen först när ett andra förslag för en
     redan betald period godkänns.

- **2026-10-20 (Story 1.9, två fakturor kan aldrig visa samma nummer, FR-6, LOC-263):**
  1. **Ändrat:** fyra punkter under «Seriesynk» i `docs/MCP_ACTIONS.md`
     (Fakturaserien och bilagan (LOC-263)): samma radlås för räknarflytten,
     kundnummertilldelningen och fakturaskapandet; 409
     `series_cannot_move_backwards` och `number_already_in_use`; avslaget före
     första skrivningen i `set_external_invoice_numbers`; notisen på Att göra.
  2. **Bakgrund:** serverdelen gick i drift i commit `d70954573069` 2026-10-20
     (uppslaget i `setExternalInvoiceNumbers`, `test/fakturanummer-samtidighet.test.ts`
     och S1 i `test/invoice-series-appendix.test.ts`). MCP_ACTIONS och STATUS kom
     inte med, eftersom filerna redan var ändrade i arbetskopian när bygget
     började, och kedjan checkar bara in filer som ändras under bygget. M1 var
     därför rött mot main fram till det här bygget. Andra granskningen efter
     drift (post 233) fann det.
  3. **Prov:** R1, G1–G4, B1, E1, V1 och M1 i `test/fakturanummer-samtidighet.test.ts`
     och S1 i `test/invoice-series-appendix.test.ts`. Inget prov är ändrat i det
     här bygget.
  4. **Inte kört:** typecheck, build och vitest — sessionens skal nekade
     npm-kommandon. Kedjan kör `npm ci`, typecheck och hela sviten efteråt.
  5. **Baslinjen:** provvaktens `continuityvakt` står oförändrad på KUNDE_INTE;
     punkten står under rubriken och rör inte huvudet som provet mäter.
  6. **Ingen migration** tillkommer, och ingen fil under `server/` ändras.
  7. **Driftnot:** i drift märks ändringen i koden först när ett förslag med ett
     redan upptaget kundnummer godkänns. Dokumentet beskriver nu det beteendet.

- **2026-10-19 (Story 1.7, en gång baklänkad post kan aldrig raderas, FR-41/FR-12, AD-12):**
  1. **Ändrat:** `services/draftDelete.ts` har predikatet `hasBeenVoucherLinked`
     (läser `<typ>.voucher_linked` i `audit_log`, samma filter som `unlinkVoucher`
     utan villkoret på verifikat-id) och en ny gren efter radlåset och före första
     sidoeffekten: 409 `not_deletable` med `details: { reason: 'previously_linked',
     use_action: 'reverse_voucher' }`. Dagens gren bär nu `details.reason:
     'not_a_draft'` med oförändrad text. `DraftKind` är `LinkableEntityType`.
     `ConflictError` tar valfria `details` (som `BadRequestError`). Fakturadetaljen
     visar ingen raderingsknapp för en en gång baklänkad faktura och säger varför.
     `docs/MCP_ACTIONS.md` (Städning (K7) och kvittobilagorna) beskriver spärren.
  2. **Prov:** R1–R3, H1 och B1–B6 (ett fall per typ där det gäller) och D1 i
     `test/draft-delete.test.ts`; K1 och K2 i `test/kvittobilagor.test.ts`; V1 i
     `test/invoice-detail.test.ts`; hjälpfilen `test/voucherLinkHelper.ts` (ny).
  3. **Inte kört:** typecheck, build och vitest — sessionens skal nekade
     npm-kommandon. Kedjan kör `npm ci`, typecheck och hela sviten efteråt.
  4. **Baslinjen:** provvaktens röda prov (adresskontraktet, bmadglidning,
     gitlas_prov, gmail_kvitton_farskhet, projektstyrning, proxysvep,
     reindexfarskhet, skattepaminnelse_farskhet) och continuityvakt (KUNDE_INTE)
     står oförändrade; bygget rör inte det de mäter.
  5. **Ingen migration** tillkommer (AD-12, «utan migration»). En rå DELETE som
     `app` i det egna bolaget på ett lossat utkast släpps fortfarande igenom av RLS;
     ingen väg i `server/src` gör en sådan DELETE utanför `deleteDraft`.
  6. **Driftnot:** `delete_draft_invoice` för fakturaregister 13–18 (se «Kvarstår i
     produktionsdatan» ovan) vägras om fakturorna någon gång baklänkats. Frågan till David står i
     berättelsen (Frågor till David).

- **2026-10-17 (Story 2.2, varje baselineändring bär sin orsak förifylld och läsbar):**
  1. **Orsaken på en plats** (`lib/avtalsdelsfalt.ts`): `IMPORTORSAK = 'avtal'`
     flyttad hit (återexporterad ur `services/uppdragImport.ts`), de rena
     `versionsorsak(atgard, input)` och `orsaksmening(orsak)`. `signalorsak(fras)`
     i `lib/scopeavgorande.ts`: `Tillägg: signalfrasen ”<frasen>”`, null för tom fras.
  2. **Orsaken i postens ja-text** (`services/uppdragUndantag.ts`):
     `beskrivBaselineandring` och `beskrivOvrigtBeslut` lägger
     `Versionen får orsaken ”…”.` (eller `Orsaken saknas i förslaget.`) före
     beslutsraden för varje post som skriver en ny version. Texten fryses i
     beslutsradens `underlag.ja_registrerar`, också vid nej.
  3. **Signalens fras som orsak**: `avgor_scopesignal`:s `tillagg.change_reason`
     är valfritt; utan Davids ord blir köpostens orsak `signalorsak(fras)` ur den
     låsta signalraden, och en tom fras ger 400 `orsak_saknas` före varje
     skrivning. Vyns orsaksfält visar den förifyllda orsaken som platshållare,
     och ett tomt fält skickas inte.
  4. **Datum i `versions`**: `get_contract_usage` bär `start_date`, `end_date`
     och `date_precision` per version (`DEL_KOLUMNER`, `AvtalsdelRad`, `Takversion`).
  5. **Leverabeldatumets enda väg**: `LEVERABELKOD` exporteras ur
     `lib/leveranskontrakt.ts`; zod-regeln `kravAndraBaselineForLeverabeldatum` i
     `upsert_contract_part` fäller en leverabelkod med datumfält med 400 före kön.
  6. **Prov**: nya `uppdragsytan-baselineorsak.test.ts` (N1–N4, F1–F6, S1–S7,
     H1–H4, L1–L5 med planterade brott och vaktfall). Omskrivna: T2 och T8 i
     `uppdragsytan-ovrigt`, L6 i `uppdragsytan-import` (rad 721–), P16:s lista
     för `lib/avtalsdelsfalt.ts` i `uppdragsytan-undantag`, och fallet ”ett
     halvfyllt tillägg fälls av zod” i `uppdragsytan-tillagg` (saknar nu
     `valid_from` i stället för orsaken, som inte längre krävs).
  7. **Inte kört:** sandlådan nekade `npm run typecheck` ("This command requires
     approval"), så varken typecheck eller vitest kördes. Inget prov är observerat
     grönt eller rött i sessionen; kedjans `npm run typecheck` och `npm test` är
     belägget.
  8. **Ingen migration** tillkommer.
  9. **Drift:** en väntande `upsert_contract_part` med leverabelkod och datumfält
     går efter driftsättningen varken att godkänna eller avvisa (schemat parsas
     om). Driften hittar sådana med `SELECT id FROM action_approvals WHERE action =
     'upsert_contract_part' AND status = 'pending' AND input->>'code' ~*
     '^L[1-9][0-9]?$' AND (input ? 'start_date' OR input ? 'end_date' OR input ?
     'date_precision')`; förslaget görs om som `andra_baseline`. Det är en
     driftpost, ingen fråga till David. Väntande signaltillägg har redan en orsak
     och påverkas inte, och redan registrerade beslutsrader behåller sin frysta
     ja-text.

- **2026-10-16 (Story 2.1, importen läser det frysta v3-kontraktet utan omformatering):**
  1. **Parsern** (`lib/leveranskontrakt.ts`) läser v3:s egen form: ramens timmar
     ur timtabellens Summa-rad när `**Timmar:**` bara är ungefärligt (`ca 430`
     förblir NULL i `timmar()`), och styrningen ur `<namn> (STYRNING)` med
     timmarna från timtabellens `-`-rad. Ny ren funktion `lasUtkastfragor`.
  2. **Migration 0085** (`0085_datumprecision.sql`): CHECK
     `contract_parts_datum_kraver_precision` — ett datum kräver `date_precision`.
     Kantkontroll först (`driftfel fore 0085: …`), `NOT VALID` och `VALIDATE` i
     samma fil. Zod-regeln `kravPrecisionVidDatum` (`lib/avtalsdelsfalt.ts`) i
     `upsert_contract_part`, `andra_baseline` och `avgor_scopesignal`:s `tillagg`.
  3. **Importen** (`services/uppdragImport.ts`): `IMPORTORSAK = 'avtal'`;
     `lika()` godtar den tidigare orsaken `'import ur leveranskontraktet v1'`
     (`TIDIGARE_IMPORTORSAK`) för redan lagrade rader. Svaret bär
     `forslag.styrning`. En köpost per källa (`contract_id`, `kontraktstext`) i
     valfri status: radlås på avtalet, uppslag före `createApproval`, svaret
     `redan_koad`/`kostatus`. Utkastläget skriver bara cachenyckeln
     `kontrakt_utkastfragor` (rubriker, `source_file_id`, sha256) i ett eget,
     reserverat omfång i `upsertSvepvarden` (`services/uppdragSvep.ts`).
  4. **Datum efter precision**: `visaDatum`/`visaIntervall` (`lib/uppdragsplan.ts`)
     på fem visningsställen — Planens tabell och datumlista, kortet i
     `explainApproval`, `delandringar` och dagslarmets `larmtext`. Dagslarmet
     (`lib/troskel.ts`) bär `precision`.
  5. **Prov**: nya `uppdragsytan-import-v3.test.ts` (P1–P5, I1–I9, K1–K6, U1–U6),
     `uppdragsytan-migration-0085.test.ts` (M1–M5) och fixturen
     `fixtures/leveranskontrakt-syntetisk-v3form.ts`. Ändrade: `uppdragsytan-plan`
     (V1–V4, V6, månadsformen i två befintliga led), `uppdragsytan-troskel` (V5,
     `precision` i tre `toEqual`), `uppdragsytan-import`, `-baselineversion` och
     `-drive-ko` (återimport av samma text går via `sattBaselineDirekt` i
     `uppdragImportHelper.ts`), `uppdragsytan-svep-bindning` (S2 för med
     precisionen) och `undantagBeskrivningHelper.ts` (datum med precision, plus
     ett negativt led).
  6. **Inte kört:** sandlådan nekade `node`, `npx vitest` och `npm run typecheck`
     ("This command requires approval"). Inget prov är observerat grönt i
     sessionen; kedjans `npm run typecheck` och `npm test` är belägget.
  7. **Drift:** `0085` körs vid nästa driftsättning. Finns en avtalsdel med datum
     utan precision fäller kantkontrollen deployen med `driftfel fore 0085: …
     (id: …)`; rättelsen görs av ägarrollen med triggern
     `contract_parts_kraver_orsak` avstängd i samma transaktion (som provet M3),
     och är en driftpost, ingen fråga till David.
  8. **Omtag (typecheck rött):** M5:s datumvarianter i
     `uppdragsytan-migration-0085.test.ts` infererades som en union med
     `?: undefined`, och den kan inte tilldelas `Record<string, string>` (TS2345).
     Varianterna har nu en uttrycklig typ, `Datum` (`Partial<Record<…, string>>`).
     Ingen fler förekomst av felklassen finns i ändringen. Inte kört i sandlådan.
  9. **Omtag 2 (två prov röda):** V2 i `uppdragsytan-plan` sökte den literala
     taggen `<td class="code">DEL1</td>`. Efterbehandlingen `staplabaraTabeller`
     (`html.ts`) ger varje cell `role` och `data-etikett`, så `indexOf` gav −1 och
     utdraget blev tyst `''`. Proven läser nu raden med `tabellrad` (på
     strukturen) och `mellan`, och båda fäller provet när en markör saknas.
     **Lärdom:** sök aldrig en `<td>`/`<tr>` som literal i en renderad sida. P16 i
     `uppdragsytan-undantag` fick `../lib/uppdragsplan.js` i listan för
     `uppdragUndantag.ts`, och `uppdragsplan.ts`/`leveranskontrakt.ts` fick egna
     importlistor. Ingen produktkod är ändrad. Inte kört i sandlådan.

- **2026-10-16 (Story 1.18, första leveransens kedja provas som ett förlopp):**
  Första leveransens slutprov. Kedjan från Davids Övrigt-rad till ett registrerat
  ja eller nej körs som ett förlopp genom vyn och en körning i svepkontraktets
  form, tillsammans med första leveransens övriga beslutade posttyper och
  frånvaroprovet. Inget i produktionskoden ändras.
  1. `server/test/kedjaRigg.ts` (ny): riggen för kedjan, alltså Davids väg genom
     vyn (Uppdrag → Uppdragens läge → ILT → Läget → panelen Övrigt, och svaren i
     undantagsvyn), Hermes körning med två anrop till `kor_uppdragssvep` och
     läsarna för kedjans läge per källa.
  2. `server/test/uppdragsytan-beslut.test.ts`: blocken P13–P20 och en krok som
     mockar `../src/actions/execute.js` (`vi.hoisted` och `vi.mock` med
     `importActual`, förlagan är `uppdragsytan-godkannandevag.test.ts`).
  3. Inget i `server/src`, ingen migration, ingen åtgärd och inget paket.

  **Prov** (alla i `uppdragsytan-beslut.test.ts`, syntetiska och märkta
  ”(syntetiskt prov)”):
  - P13: steg (1) och (2). Raden skrivs genom vyn, är oföränderlig och kan inte
    skrivas av en agent, och en körning ger frågan med beräkningen i ören. Saknade
    timmar eller saknat timpris ger inget belopp.
  - P14: en körning ger frågan före körningens slut. Ett formuleringsfel, ett
    källfel eller ett uteblivet andra anrop ger ofullständigt underlag och
    `ovrigt.lage = 'fel'`, aldrig ett förslag. Nästa körning tar om kandidaten.
  - P15: steg (3a)–(3c) genom vyn, alltså ja till tillägg, ja till ”ryms” och nej
    med utkastet.
  - P16: kompletteringen, svepet och omstarten avgör ingenting, och ersättaren är
    den enda frågan.
  - P17: steg (4) och (5). Upprepade svep och knapptryck ger ingenting nytt,
    agentnyckeln får 403, och ”inte nu” finns inte.
  - P18: ett fel mellan mottagandet och verkställigheten. Mandatet står kvar som
    mottaget och verkställs en gång av återförsöket utan nytt ja eller nej.
  - P19: ett fel efter verkställigheten men före svaret. Klienten får 500, och
    upprepningen ger 409 `not_pending` (i vyn den tysta omdirigeringen) och exakt
    en handling.
  - P20: baselineändringen, kostnadsbindningen till strömmen S2, scopesignalen
    och den begärda bedömningen avgörs genom vyn över höjda trösklar. I samma
    bolag ger sedan ett rutinstatusbyte, en frisk period och två tekniska fel noll
    poster.

  **Inte kört i sessionen:** `npm run typecheck`, `npm run build`, `npm test` och
  `npx vitest run test/uppdragsytan-beslut.test.ts`. Sandlådan nekade kommandona
  (”This command requires approval”). Utfallet är förutsagt, inte observerat, och
  kedjans körning är belägget.

  **Driftnotiser:**
  1. Ingen kod, migration eller åtgärd ändras. Releasens beteende är detsamma.
  2. Första leveransens acceptans mot en verklig Övrigt-rad: KUNDE_INTE i kopian.
     Kopians databas har ingen verklig rad, bara provets syntetiska. Acceptansen
     är en läsande kontroll i drift mot Davids egen rad, och den trycker aldrig ja
     eller nej åt honom.
  3. Davids svar 2026-10-07 om Gmails utkastmapp är fortfarande inte byggt.
     Utkastet ligger i panelen ”Beslut och utkast” med en `mailto:`-länk.
  4. Huvudet säger fortfarande 205 actions, eftersom ingen åtgärd tillkommit.
  5. Provfilen mockar `../src/actions/execute.js` med en krok som bara P19 sätter.
     Med kroken på 0 släpper mocken igenom kärnans funktioner oförändrade.
     Omtag samma dag: kedjans körning fällde P19 (c) och (d), alltså nej i vyn och
     genom REST. Nejet når `rejectApproval` genom registrets dynamiska
     `import('./execute.js')`, och den importen får inte mocken. Kroken sitter nu
     på varje funktion som koden utanför `actions/` importerar ur `execute.js`
     (`approveAction`, `executeAction`, `rejectApproval`, listan
     `krok.ingangar`). En kontrollvakt i P19 fäller en ny ingång som går förbi
     kroken. Lärdom: `vi.mock` når inte en dynamisk `import()` i `src`, så en krok
     ska sitta där transporten anropar kärnan. Omtaget är inte kört i sessionen
     (sandlådan), och kedjans körning är belägget.
  6. Riggens `begarBedomningIVyn` ordnar begärandena på `begard_nar`. Berättelsen
     skrev `created_at`, men 0082 har ingen sådan kolumn.

- **2026-10-15 (Story 1.16, nej ger ett svarsutkast som David själv skickar):**
  Ett nej på en kundförfrågan ur Övrigt sparar skälet och ekonomin som förut och
  ger dessutom ett fryst svarsutkast med mottagare, ämne med referens och text.
  David läser det i Lägets panel ”Beslut och utkast” och skickar själv genom en
  `mailto:`-länk. Redovisningen skickar ingenting.
  1. `server/migrations/0084_utkast_markor.sql` (ny): kolumnen
     `uppdrag_beslut.utkast_markor`, det unika indexet per bolag och fyra CHECK
     (utkast och markör följs åt, markörens form, utkastets tre nycklar och att
     ämnet bär markören).
  2. `server/src/lib/utkast.ts` (ny, ren): markören `[ref U<nummer>-B<löpnummer>]`,
     ämnet, textens fasta mall, mottagaren ur kundkortet med `EmailSchema` och
     `mailtoLank` (RFC 6068).
  3. `server/src/services/uppdragBeslut.ts`: `registreraNej` bygger utkastet när
     källan är en Övrigt-rad (`nejutkast`: först `provaOvrigtKalla`, sedan
     förfrågan, uppdragets nummer och kundkortet, sist löpnumret ur
     `uppdrag_beslutsutkast`), och `skrivBeslut` skriver det i samma INSERT som
     raden.
  4. `server/src/services/uppdragLage.ts`: `Beslutsrad` och `registreradeBeslut`
     bär `utkast` och `utkast_markor`.
  5. `server/src/http/view/routes.ts`: panelen heter ”Beslut och utkast”, och
     `utkastblock` står under ett registrerat nej med utkast, i husets klasser.
  6. `docs/MCP_ACTIONS.md` (Läget, Övrigt-raden, nytt avsnitt ”Nej-utkastet”,
     Beslutsraden) och `docs/ARKITEKTUR.md` (migrationskedjan, Beslutsraden och
     tabellraden `ovrigt_beslut`). Huvudet säger fortfarande 205 actions, räknat
     ur registret; ingen åtgärd tillkom.

  **Prov:** `uppdragsytan-utkast.test.ts` (ny, de rena fallen M1–M11; i vitest
  återskapar `setup.ts` ändå databasen före filen, och utan databas körs fallen
  genom `utkastHelper.ts`), `utkastHelper.ts` (ny), `utkastRigg.ts` (ny),
  `uppdragsytan-utskick.test.ts` (ny, provet ”Davids utskick”, U0–U4),
  `utskickHelper.ts` (ny, U0 körbar utan databas), P10–P12 i
  `uppdragsytan-beslut.test.ts`. Ändrade: P2 i `uppdragsytan-beslut.test.ts`
  (nio nya CHECK-fall, 13 villkor, 32 negativa), S3 i
  `uppdragsytan-komplettering.test.ts` och optionen `kundId` i `ovrigtRigg.ts`.

  **Inte kört i sessionen:** `npm run typecheck`, `npm run build`, `npm test`,
  `npx vitest` och `node --import tsx` — sandlådan nekade kommandona ("This
  command requires approval"). Utfallet är förutsagt, inte observerat; kedjans
  körning är belägget.

  **Driftnotiser:**
  1. Migration 0084 lägger `utkast_markor` och fyra CHECK på `uppdrag_beslut`.
     De står kvar vid en återställning, och den äldre koden skriver inga utkast.
  2. Ett nej på en kundförfrågan ur Övrigt ger ett utkast med mottagare ur
     kundkortet. Saknas e-postadressen där är mottagaren tom i utkastet.
  3. Davids svar 2026-10-07 om Gmails utkastmapp är inte byggt. Det kräver en
     Hermes-berättelse med skrivbehörighet mot Gmail, och Hermes
     `davids_utskick.py` fäller i dag `/drafts` (R4).
  4. Huvudet säger fortfarande lika många actions som registret, eftersom ingen
     åtgärd tillkommit.
  5. Provet ”Davids utskick” klassar beroendena i `server/package.json` och
     listar nätets utgångar i hela `server/src`. Ett nytt beroende, en ny
     nätmodul eller ordet `fetch` i en ny fil fäller provet tills listan ändras i
     samma ändring.

- **2026-10-15 (Story 1.15, ja till tillägg eller till ”ryms” registreras utan en
  andra kvittens):** David kan fylla i timmar i en väntande Övrigt-fråga och få
  förslaget omräknat. Den gamla köposten ersätts och är inget beslut, och
  undantagsvyn visar när källorna ändrats sedan förslaget.
  1. `server/migrations/0083_forslag_ersatt.sql` (ny): kolumnen
     `action_approvals.ersatt_av` med sammansatt FK, UNIQUE, två CHECK och två
     regler till i 1.4:s triggerfunktion (0077:s kropp ordagrant).
  2. `server/src/services/approvals.ts`: `ersatt_av` i `APPROVAL_COLUMNS` och
     `Approval`, villkoret `ersatt_av IS NULL` i `MOTTAGET_EJ_VERKSTALLT` och
     `ersattGodkannande`, den enda skrivningen av kolumnen.
  3. `server/src/lib/beslutsunderlag.ts`: `delunderlag`, `egetTakTimmar`,
     `ANDRINGSFALT` och den rena `andratSedanForslaget` (kastar aldrig).
  4. `server/src/services/uppdragOvrigt.ts`: 1.14:s förslagssteg delat i
     `lasOvrigtrad`, `provaOvrigtForslag` och `byggOvrigtForslag` utan ändrat
     beteende; `koaOvrigtForslag` anropar dem.
  5. `server/src/services/uppdragUndantag.ts`: `avtalsdelUpptagen` (1.14:s steg
     6 på en plats) och läsvägens jämförelse `markeraAndrat` (`ovrigt.andrat`).
  6. `server/src/services/uppdragBeslut.ts`: `KOMPLETTERINGSFEL` och
     `kompletteraForslag` (låset, ersättaren, `ersattGodkannande` och auditraden
     `uppdrag.forslag_kompletterat` i en transaktion).
  7. `server/src/actions/registry.ts`: åtgärden `komplettera_beslutsforslag`
     (write, `kravManniska`).
  8. `server/src/http/view/undantagsvyn.ts` och `routes.ts`: kompletteringens
     JS-fria formulär (”Räkna om”), fältet ”Ändrat sedan förslaget” och grenen
     `komplettera` i `UNDANTAGSHANDLINGAR`, med husets befintliga mönster.
  9. `docs/MCP_ACTIONS.md` och `docs/ARKITEKTUR.md`. Huvudet säger 205 actions,
     räknat ur registret.

  **Prov:** `uppdragsytan-komplettering.test.ts` (ny: E, J, K, S, T),
  `kompletteringRigg.ts` (ny), `kompletteringHelper.ts` (ny, körbar utan
  databas), P8 och P9 i `uppdragsytan-beslut.test.ts`. Ändrade:
  `uppdragsytan-undantag.test.ts` (P3, P16), `undantagsvynHelper.ts` (R8),
  `uppdragsytan-undantagsvyn.test.ts` (R8, V9) och
  `uppdragsytan-undantagsvyn-mobil.test.ts` (B (11)).

  **Inte kört i sessionen:** `npm run typecheck`, `npm run build`, `npm test`
  och `npx vitest` — sandlådan nekade kommandona ("This command requires
  approval"). Utfallet är förutsagt, inte observerat; kedjans körning är
  belägget.

  **Omtag (kedjans `npm test`):** `tidsforslag.test.ts` ”grupperar per dag,
  nyaste överst …” föll den 15/10. Provet sökte datumen i hela sidan, och
  ramens stilblad har en kommentar med `2026-09-14` (`html.ts:611`), som är
  just `dagarSedan(31)` den dagen. Ordningen läses nu på dagrubrikerna
  (`>${dag}</span>`) inuti `<main>`, och varje rubrik måste finnas. Lärdom: ett
  prov söker aldrig ett datum eller en ordning i hela sidan. Avgränsa till
  `<main>` och kräv träffen innan positionerna jämförs. Inte heller detta är
  kört i sessionen.

  **Driftnotiser:**
  1. Migration 0083 lägger `ersatt_av` på `action_approvals`. Kolumnen står kvar
     vid en återställning, och den äldre koden skriver eller läser den inte.
  2. En ersatt köpost är `rejected` med `ersatt_av` och utan `beslut_hash`. Den
     är inget nej, och klienter läser `ersatt_av`.
  3. `beslutsverkstallning.py` påverkas inte, eftersom en ersatt post saknar
     `beslut_hash`.
  4. Huvudet säger lika många actions som registret har efter bygget (205).
  5. Undantagsvyn har ett tredje formulär på Övrigt-frågor (`handling=komplettera`,
     `approval_id` och `<input type="number" name="timmar">`), i den form
     `kontrollytan.py`:s fall b9 godtar.

- **2026-10-14 (Story 1.14, Övrigt-raden blir en fråga med färdig beräkning):**
  En markerad Övrigt-rad blir en fråga i undantagsvyn med avtalsdelar, taxa,
  förbrukning och belopp uträknade av servern.
  1. `server/src/lib/beslutsunderlag.ts`: de rena reglerna — `TimmarSchema`,
     `OvrigtUnderlagSchema`, `beraknaOvrigt` (timmar × taxa i ören med
     `roundOre`), `nyttTakTimmar`, `giltigFran`, `ovrigtorsak`,
     `forslagstextOvrigt`, `byggOvrigtUnderlag` (kastar aldrig) och byggarna av
     köpostens indata.
  2. `server/src/lib/avtalsdelsfalt.ts` (ny): avtalsdelens fält flyttade
     oförändrade ur registret, `AndraBaselineSchema`,
     `RegistreraUppdragsbeslutSchema` och `OVRIGT_SCHEMA`, så att registret,
     läsvägen och svepet prövar mot samma schemaobjekt.
  3. `server/src/services/uppdragOvrigt.ts` (ny): kandidaterna
     (`listaOvrigtKandidater`), förslagssteget (`koaOvrigtForslag`, sju
     avvisningsorsaker, köar med actor `agent`), `provaOvrigtKalla` och
     `registreraRyms`.
  4. `server/src/services/uppdragSvep.ts`: indatat `ovrigt_forslag[]`, svaret
     `ovrigt` och `arbetslista.ovrigt_kandidater` (additivt), förslagen och
     kandidaterna före täckningen.
  5. `server/src/services/uppdragUndantag.ts`: postslaget `ovrigt_beslut`
     (`koburetSlag`, `beskrivOvrigtBeslut`, fältet `ovrigt`), orsaken
     `underlag_ogiltigt` i `hoppade` och de delade predikaten
     `KOPOST_FOR_ANTECKNING`/`BESLUT_FOR_ANTECKNING`, bundna till radens avtal.
  6. `server/src/services/uppdragBeslut.ts`: `registrera_uppdragsbeslut` i
     `MANDATATGARDER` (på en rad), `KALLA`, `AVTAL`, `HANDLING`, `alternativFor`;
     beslutsraden skriver `alternativ`.
  7. `server/src/actions/registry.ts`: åtgärden `registrera_uppdragsbeslut`,
     `andra_baseline` med `AndraBaselineSchema`, fältet `koasAvSvepet` och
     radprövningen i tilläggets verkställighet. `server/src/actions/execute.ts`:
     den enda nya kontrollen, 409 `koas_av_svepet` före kön.
     `server/src/services/contracts.ts`: en rad — auditraden
     `contract_part.created` bär inte längre `change_reason`.
     `server/src/services/uppdragSignal.ts`: `underlagsreferens` exporterad.
  8. `server/src/http/view/undantagsvyn.ts`: etiketten, formuläret och blocket
     `ovrigtdel` (förfrågan, avtalsdelar, timpris, förbrukning, timmar,
     beräkning, återstående utrymme, scopelinjer) med husets fält, listor och
     `amount()`, utan nya klasser. `routes.ts`: bara Övrigt-bockens ledtext.
  9. `docs/MCP_ACTIONS.md` och `docs/ARKITEKTUR.md` (svepet, nytt avsnitt,
     läsvägen, beslutsraden och tabellen över postslag). Huvudet säger 204
     actions.

  **Prov:** `uppdragsytan-ovrigt.test.ts` (ny: U, K, T, A, F),
  `ovrigtHelper.ts` (de rena fallen, körbara utan databas), `ovrigtRigg.ts`
  (riggen). Ändrade: `uppdragsytan-undantag.test.ts` (beforeAll, P3, P4, P8 med
  tre nya vakter, P16), `uppdragsytan-mandat.test.ts` (raden
  `registrera_uppdragsbeslut`), `undantagBeskrivningHelper.ts`,
  `undantagsvynHelper.ts` (R7), `uppdragsytan-undantagsvyn.test.ts` (R7, V8),
  `uppdragsytan-undantagsvyn-mobil.test.ts` (B (1)–(2) med en Övrigt-fråga,
  B (9)–(10)) och `uppdragsytan-anteckning.test.ts` (D3).

  **Inte kört i sessionen:** `npm run typecheck`, `npm run build`, `npm test`
  och `npx vitest` — sandlådan nekade kommandona ("This command requires
  approval"). Utfallet är förutsagt, inte observerat; kedjans körning är
  belägget. `hermes/skills/uppdragssvep.py` bär redan kontraktet sedan Story
  1.17 och ändras inte; `ovrigtforslag.py` går över till läget *med Story 1.14*
  när releasen bär bygget.

  **Driftnotiser:**
  1. Fram till driftsättningen står varje markerad Övrigt-rad med `ovrigt` som
     `fel`, och undantagsvyn är ofullständig för sitt avtal. Efter
     driftsättningen formulerar Hermes förslagen i nästa körning (var 15:e
     minut), alltid som tillägg utan timmar tills kompletteringen finns (Story
     1.15). Ett köat förslag blir en fråga och gör `ovrigt` till `last`. En rad
     vars förslag avvisas står kvar som kandidat med `ovrigt` som `fel`, och
     `uppdragstackning.py` är rött för det avtalet, som före bygget.
  2. `MANDATATGARDER` har `registrera_uppdragsbeslut`; `beslutsverkstallning.py`
     läser listan ur releasen.
  3. `registrera_uppdragsbeslut` och `andra_baseline` med källan anteckning ger
     409 `koas_av_svepet` genom REST och MCP.
  4. Auditraden `contract_part.created` bär inte längre `change_reason`.
  5. Huvudet säger registrets antal actions efter bygget (204).
  6. Ingen migration. En återställning till föregående release efter att
     Övrigt-köposter skapats lämnar dem väntande; ett ja på en
     `registrera_uppdragsbeslut` ger då 404 för en okänd åtgärd tills bygget är
     tillbaka, och inget skrivs.

- **2026-10-13 (Story 1.11, undantagsvyn som ingång):**
  Uppdragsytans ingång är nu undantagsvyn, på dator och mobil.
  1. `server/src/http/view/html.ts`: `layout()` har valet `markering?: 'page'`.
     `link()` skriver `location` bara när sidan har `objekt` och inte valt
     `page`. Kanon fick `.tomt` (designkontraktets tomhetsgrammatik) och
     `[data-traffyta] a, [data-traffyta] button` (44 px via `--traff`).
     `farskhetstid`, `farskhetsrad` och `direktFarskhet` flyttade oförändrade
     hit från `routes.ts`.
  2. `server/src/http/view/routes.ts`: `pageFor` har fjärde parametern
     `sidan` (`objekt`, `markering`). `uppdragsmarkering(medUndermeny)` sätter
     valet på de tretton sidorna med `.subnav` (nio `layout()`, fyra `pageFor`).
     `GET /uppdrag` är undantagsvyn, och listan ligger på `/uppdrag/lista`
     (oförändrad i sak, nu i `<div data-traffyta>`). `INGANGEN` läses ur
     kontraktets ägare till `GET /c/:companyId/uppdrag`. En ny `POST /uppdrag`
     väljer gren ur `UNDANTAGSHANDLINGAR` (`ja` → `approveAction`, `nej` →
     `avboj_beslutsforslag`, `scope` → `avgor_scopesignal`, `bedomning` →
     `satt_bedomning` med `begaran_id`). `decideApproval` och `runViewAction`
     fick den valfria parametern `lyckat`. Lägets "← Uppdragen" leder till
     `/uppdrag/lista`.
  3. `server/src/http/view/undantagsvyn.ts` (ny): vyn som ren funktion av
     `lasUndantag`-svaret: regeln, de tre utfallen, posterna med fält, källor
     (Drive-länk ur file-id), `--ai`-märkning och färskhet per värde, och
     `FORMULAR` per postslag.
  4. `server/src/http/view/kontrakt.ts`: typen har `routes`, och den nya
     exporten `ruttensAgare` läser ruttägarskapet. `modell()` är oförändrad.
  5. `server/src/http/view/auth.ts`: agentens GET-läsväg omfattar också exakt
     `/c/<bolag>/uppdrag` och `/c/<bolag>/uppdrag/lista`.
  6. `docs/ARKITEKTUR.md`: ingången, valet `markering` och tabellen över
     postslag (B-3).

  **Prov:** `uppdragsytan-markering.test.ts` (M0–M4, ny),
  `uppdragsytan-undantagsvyn.test.ts` (R2–R6 och V2–V7, ny),
  `uppdragsytan-undantagsvyn-mobil.test.ts` (B (1)–(8), playwright, ny),
  `undantagsvynHelper.ts` (de rena fallen, körbara utan databas) och
  `undantagsvynRigg.ts` (den delade riggen). I `uppdragsytan-menyn.test.ts`
  kom N0 (`kontraktsbrister`), N0 (k1)–(k8) (`generatorsForm`), N1 och N2,
  som ersätter kravet på `location` på Läget. `uppdragsytan-laget.test.ts`
  öppnar listan på `/uppdrag/lista`.

  **Inte kört i sessionen:** vitest, `npm run typecheck`, `npm run build` och
  `npm test`. Sandlådan nekade varje körande kommando (`This command requires
  approval`). Rött och grönt per uppgift står som förutsagt, inte observerat, i
  berättelsens Debug Log. Kedjans typecheck och `npm test` är belägget.

  **Omtag (kedjans typecheck röd):** `uppdragsytan-undantagsvyn-mobil.test.ts`
  rad 358, TS2339. En spridning av `Record<string, string>` med en känd nyckel
  i en objektliteral tappar indexsignaturen, så `handling` fanns inte på
  typen. `form` har nu typen `Record<string, string>` uttryckligen. Ingen
  produktionskod ändrad. Inte kört i sessionen (sandlådan nekade).

  **Kontraktets läge i kopian:** *före synken*. Ingen destination har mallen
  `/app/c/:companyId/uppdrag`, och `projects_list` äger `GET /c/:companyId/uppdrag`.
  Undantagsvyn och listan markerar därför "Projekt". Filen
  `server/kontrakt/navigation.v1.json` är generatorns och rördes inte.

  **Driftnotiser:**
  1. `adresskontraktet.py` står rött tills Hermes egen kopia av kontraktet
     (`~/.hermes/kontrakt/navigation.v1.json`) har synkats med generatorn (Story 1.12).
  2. **Utanför repot, står rött tills det synkas:** generatorn i Davids valv
     ska köras med K-a–K-e (berättelse 1.11, Dev Notes → "Navigationskontraktet:
     två tillåtna lägen"): destinationen "Uppdrag" (mallen
     `/app/c/:companyId/uppdrag`, `active_match` subtree, rekommendation
     `group_id: projects`, `order: 60`) sist i både `accounting_quick_yes` och
     `accounting_quick_pending_or_no`, mallen borttagen ur `projects_list`, och
     de tre rutterna `GET /c/:companyId/uppdrag`, `GET /c/:companyId/uppdrag/lista`
     och `POST /c/:companyId/uppdrag` med den som ägare. Därefter sprids
     kontraktet till repot. Till dess står `adresskontraktet.py` rött för K2
     (`GET /c/:companyId/uppdrag/lista` och `POST /c/:companyId/uppdrag`), och
     menyn har ingen post "Uppdrag". Undantagsvyn nås på `/uppdrag` och
     markerar "Projekt". Efter synken följer markeringen med utan kodändring,
     och N0 i `uppdragsytan-menyn.test.ts` prövar då läget *genererat*.
  3. Modulens objektsidor markerar nu menyn med `page` i stället för
     `location`; `designparitet.py` godtar redan båda värdena.
  4. Hermes saknar mätpunkten för undantagsvyn och `kontrollytan.py` (Story 1.12).
  5. Ingen migration. En återställning till föregående release ger tillbaka
     listan på `/uppdrag`.

- **2026-10-13 (Story 1.10, omtag efter andra granskningen i drift):**
  Task 8: avtalets id tas ur låsraden.
  1. `lasAvtalet` (`server/src/services/uppdragBedomning.ts`) läser avtalets
     `id` och `name` ur den låsta raden. `begarNyBedomning` och `sattBedomning`
     för det id:t vidare efter låset: till de öppna begärandena, prövningen av
     begäran, underlaget, INSERT:en och auditraden. Indatats avtal står bara
     som argument till `lasAvtalet`.
  2. Jämförelsen i `besvaradBegaran` (parametern heter nu `avtalId`) och
     `details.contract_id` i auditraderna `uppdrag.bedomning_begard` och
     `uppdrag.bedomning_satt` använder samma id. Ett `contract_id` med versaler
     på samma avtal gav förut 409 `begaran_annat_avtal`; nu 200 och en rad.
  3. `MCP_ACTIONS.md`: en mening under `satt_bedomning` (samma avtal avgörs på
     id:t, inte skiftläget) och en under `begar_ny_bedomning` (auditradens
     `contract_id` är databasens).
  4. Prov: K3 (k) och K4 (l) 1–4 i `uppdragsytan-bedomningsbegaran.test.ts`
     (versaler och blandat skiftläge i `contract_id`, versaler i `begaran_id`,
     vägen utan `begaran_id`, ett annat avtal i versaler), räknaren
     `skiftlage` och `expect(korda.skiftlage).toBe(5)` i kontrollvakten.

  **Inte kört i sessionen:** vitest, `npm run typecheck`, `npm run build` och
  `npm test`. Sandlådan svarade `This command requires approval` på
  `npx vitest run test/uppdragsytan-bedomningsbegaran.test.ts` (och
  `This Bash command contains multiple operations. The following part requires
  approval: …` på samma körning med `cd`). Förutsagt, inte observerat: mot
  koden före ändringen fälls K3 (k) på auditradens `details` (versaler i
  `contract_id`), K4 (l) i del 1 (409 `begaran_annat_avtal` i stället för 200)
  och kontrollvakten (`skiftlage` 0 i stället för 5); med ändringen är K3 (k),
  K4 (l) 1–4 och kontrollvakten gröna. Kedjan kör typecheck och test efter
  sessionen, och deployen bygger före bytet.

  **Driftnotis:** ingen migration. Auditrader som skrivits i drift före bygget
  med versaler i `details.contract_id` står kvar, eftersom `audit_log` är
  append-only. Efter bygget bär ingen auditrad som åtgärderna skriver ett id ur
  indata: domänraderna tar avtalets id ur låsraden och begärans id ur
  begäransraden, och `action.executed` bär bara `sensitivity` och `actor`
  (`execute.ts` rad 108–115).

- **2026-10-13 (Story 1.10, den begärda bedömningen):**
  David kan begära en ny bedömning av ett avtal, och frågan står i
  undantagsvyns läsväg med underlaget sammanställt tills en bedömning besvarar
  den. Ändrat, fil för fil:
  1. `server/migrations/0082_bedomningsbegaran.sql` (ny): tabellen
     `uppdrag_bedomningsbegaran` (ÄGD, append-only, RLS, sammansatt FK,
     avslutstriggern), och på `uppdrag_bedomning` de nullbara kolumnerna
     `begaran_id` (FK till begäran i samma avtal, `UNIQUE`) och `satt_av`, med
     två CHECK mot `satt_av_manniska`.
  2. `server/src/lib/bedomningsbegaran.ts` (ny): `kalendermanad`,
     `forbrukningsandringar`, `sammanfattaAndringar` och `LEVERABELORD`, rena.
  3. `server/src/services/uppdragBedomning.ts`: `OBESVARAD`,
     `listaObesvaradeBegaranden`, `begarNyBedomning`, `lasAvtalet` (radlås på
     avtalet, ersätter `avtalsnamn`), `sattBedomning` med `userId`, `begaran_id`,
     `satt_av` och auditraden `uppdrag.bedomning_satt`, `delsiffror` och
     `lasDelsiffror`.
  4. `server/src/actions/registry.ts`: `begar_ny_bedomning` (write,
     `kravManniska`) och `begaran_id` på `satt_bedomning`. 203 actions.
  5. `server/src/services/uppdragUndantag.ts`: postslaget `ny_bedomning`
     (`beskrivNyBedomning`, `andringarSedan`, `bedomningsposter`).
  6. `server/src/services/uppdragLage.ts`: `oppen_begaran` per avtal.
  7. `server/src/http/view/routes.ts`: kortet *Senaste bedömning* (formuläret
     *Begär ny bedömning*, och texten för en öppen begäran på aktivt och stängt
     uppdrag), bandets rad, Lägets POST med `handling=begar_bedomning`,
     Bedömning-sidans rad och `kalendermanad` i stället för `standardperiod`.
  8. `docs/MCP_ACTIONS.md`, `docs/ARKITEKTUR.md` och det här huvudet.
  Prov: K0–K6 i `server/test/uppdragsytan-bedomningsbegaran.test.ts` (rena
  fall i `bedomningsbegaranHelper.ts`), K2 i
  `server/test/uppdragsytan-migration-0082.test.ts`, och P2, P3, P4, P6, P8
  (tretton vakter), P16 och kontrollvakten i `uppdragsytan-undantag.test.ts`.
  **Inte kört i sessionen:** sandlådan nekade varje körande kommando
  (`npx vitest run …` → ”This command requires approval”; `npm run typecheck`
  → ”… requires approval: npm run typecheck”). Rött och grönt per uppgift står
  som förutsagt, inte observerat, i berättelsens Debug Log. `npm run
  typecheck`, `npm run build` och `npm test`: inte kört i sessionen, samma
  skäl. Kedjan kör typecheck och test efter bygget, och deployen bygger före
  bytet. Driftnotiser:
  1. 0082 är additiv och bakåtkompatibel. En återställning till föregående
     release lämnar begäranstabellen oanvänd; den gamla `sattBedomning`
     skriver NULL i de nya kolumnerna, vilket villkoren tillåter.
  2. Bedömningar satta före 0082 saknar `satt_av`. Posten visar
     `satt_av_namn: null`, och Lägets kort visar fortfarande bara att en
     människa satte raden.
  3. Hermes listor känner inte den nya åtgärden och tabellen: `flerbolag.py`
     (`GRANTS`), `manniskosparr.py` (`SKA_KRAVA`) och `uppdrag_gemensamt.py`
     (`MODULATGARDER`, som `handgrepp.py` läser). En Hermes-berättelse kan
     lägga till dem.

- **2026-10-13 (Story 1.9, omtag efter andra granskningen i drift):**
  Task 8: tillägget hör till signalens avtal.
  1. `avgorSignal` (`server/src/services/uppdragSignal.ts`) prövar
     `tillagg.contract_id` i gemener mot den låsta signalradens avtal, efter
     409-prövningen (`arUpprepatAvgorande`) och före köningen. Skiljer de sig
     blir svaret 400 `signal_annat_avtal`, utan rad, köpost eller auditrad.
     Ett upprepat knapptryck ger alltså 409 `redan_avgjord` också med ett
     annat avtal (AC 7).
  2. `koaTillagget` tar den låsta raden (`signal: { id, contract_id }`) och
     sätter `contract_id: signal.contract_id` efter `...tillagg`, så indatats
     avtal förs aldrig vidare till köposten.
  3. Kommentaren vid det dolda fältet `tillagg_contract_id` i signalsidans POST
     (`routes.ts`) säger nu var avtalet kommer ifrån och att tjänsten prövar
     det. Ingen markup eller logik ändrad.
  4. Prov: K5 (j) 1–6 i `uppdragsytan-scopeavgorande.test.ts` (annat avtal,
     okänt avtal, versaler, signalen efteråt, vyn med ändrat dolt fält,
     upprepat knapptryck med annat avtal), räknaren `k5avtal` och
     `expect(korda.k5avtal).toBe(4)` i kontrollvakten.
  5. `MCP_ACTIONS.md`: ny punkt ”Tilläggets avtal” under `avgor_scopesignal`,
     och köposten bär ”signalens avtal”.

  **Inte kört i sessionen:** vitest, `npm run typecheck`, `npm run build` och
  `npm test`. Sandlådan svarade `This command requires approval` på
  `npm run typecheck` och på `npx vitest run test/uppdragsytan-scopeavgorande.test.ts`.
  Förutsagt, inte observerat: mot koden före ändringen fälls K5 (j) i del 1
  (200 i stället för 400) och kontrollvakten (`k5avtal` 0); med ändringen är
  K5 (j) 1–6 och kontrollvakten gröna. Kedjan kör typecheck och test efter
  sessionen, och deployen bygger före bytet.

  **Driftnotis:** ingen migration. Bygget rättar ingen köpost som redan står
  i drift på ett annat avtal än sin signal; efter bygget kan avgörandet inte
  skapa fler.

- **2026-10-13 (Story 1.9, omtag efter code-review, fem fynd):**
  1. Signalsidan kastade `tillagg_godkannande.redan_koad` tyst. `runViewAction`
     tar nu en valfri `avvikelse`, som läser ett lyckat svar och ger notistext
     när utfallet inte blev det formuläret lovade. Signalsidan visar då
     förslagets id och status. Texten vid tilläggsfälten säger att en signal
     får ett förslag. Nytt vyprov K5 (i): väntande förslag, avvisat förslag och
     en kontroll utan tilläggsfält. K5 (h) kräver att ett köat tillägg ger en
     redirect utan notis.
  2. K3 (i) kräver nu `redan_avgjord` på 409-svaret, i tre fall (innanför,
     utanför och utanför med tillägg). K3 (k) kräver upprepningens notistext.
  3. `MCP_ACTIONS.md`: köposten är villkorad ("om ingen köpost för signalen
     finns") och nämner `kalla`. `redan_koad` har en egen punkt.
  4. 0081:s huvudkommentar räknar upp båda triggrarna, funktionen och indexet.
  5. Driftnotis 3 under Story 1.9-posten: 0081 är inte bakåtkompatibel.

  **Inte kört:** vitest, typecheck och build. Sandlådan svarade
  `This command requires approval` på `npm run typecheck`. Kedjans körning
  är första körningen.

- **2026-10-13 (Story 1.9, scopeavgörandet som ny rad):**
  Migration `0081_scopeavgorande.sql`: kantkontroll (signal med underlag som
  inte finns i bolaget stoppar filen), nycklarna för sammansatta FK, tabellen
  `uppdrag_scopeavgorande` (BASELINE, append-only, löpnummer per signal, RLS,
  `GRANT SELECT, INSERT`), överföringen av gamla `avgjord`-värden som
  `overford = true` utan vem och när, avslutstriggern och frysningen av
  kolumnen med triggern `uppdrag_scopesignal_fryser_avgjord`.
  `lib/scopeavgorande.ts`: `tillaggsorsak` (”Tillägg: ” + Davids ord) och
  `arUpprepatAvgorande`. `avgorSignal` låser signalen, räknar löpnumret,
  ger 409 `redan_avgjord` för samma val på samma underlag och skriver raden
  med auditraden `uppdrag.scope_avgjort` (id och koder). Tillägget köas som
  `andra_baseline` med `kalla` och bara om ingen köpost för signalen finns i
  någon status; annars `redan_koad: true`. Läsvägarna i `uppdragSignal.ts`,
  `uppdragUndantag.ts` och `uppdragLage.ts` (`signalhistorik`) läser tabellen.
  `andra_baseline` fick `kalla`. Signalsidans tabell ”Avgjorda” visar vem och
  när och de tidigare avgörandena, med husets klasser; Lägets markup är orörd.
  `docs/MCP_ACTIONS.md` och `docs/ARKITEKTUR.md` uppdaterade.

  Prov: K0–K6 i `server/test/uppdragsytan-scopeavgorande.test.ts`,
  `uppdragsytan-migration-0081.test.ts` och `scopeavgorandeHelper.ts`.
  Hjälparna i `uppdragsytan-signaler.test.ts` och `uppdragsytan-tillagg.test.ts`
  läser avgörandet ur tabellen, och `provaScheman` känner `kalla`.

  **Inte kört:** varken vitest, typecheck eller build. Sandlådan nekade varje
  körande kommando:
  ```text
  $ npx vitest run test/uppdragsytan-migration-0068.test.ts
  This command requires approval
  $ npm run typecheck
  This command requires approval
  ```
  Ingen röd eller grön utdata finns därför, och inget prov kallas grönt.
  Kedjans `npm ci`, `npm run typecheck` och `npm test` är första körningen.
  Ingen migration, tjänstestart, commit eller driftsättning gjord.

  Driftnotiser:
  1. Avgöranden från före bygget står som överförda rader utan vem och när;
     signalsidan säger ”Överfört ur den äldre kolumnen”.
  2. Hermes `flerbolag.py` prövar inte rättigheterna för
     `uppdrag_scopeavgorande`, eftersom tabellen inte står i dess `GRANTS`. En
     Hermes-berättelse kan lägga till den med `SELECT, INSERT`.
  3. **0081 är inte bakåtkompatibel.** Återställs bygget till föregående release
     efter att 0081 körts, fäller frysningstriggern den gamla `avgorSignal`:s
     `UPDATE uppdrag_scopesignal SET avgjord` (409 `rule_violation`), och den
     gamla `listaSignaler` läser den frysta kolumnen, så att avgöranden gjorda
     efter driftsättningen visas som öppna igen. En återställning görs därför
     med en framåträttning, inte med föregående release.

- **2026-10-11 (Story 1.8, spärren mot direktbindning av kostnader):**
  `server/src/lib/bindningsmal.ts` samlar den rena målregeln för löv, ström
  och uppdrag; `uppdragSvep.ts` använder den också för cachens grövre nivå.
  `uppdragKostnad.ts` köar varje förslag med actor `agent`, med en
  listfråga per körning för idempotens i alla statusar och uuid-versaler.
  Gren 2 och dess vakt är borttagna; bara verkställigheten av ett mottaget
  mänskligt ja skriver kvittots avtalsdel. Registrets kommentarer följer med.
  `uppdragUndantag.ts`: samma beskrivare ger skälet till ström/rot i läsvyn
  och fryst beslutsunderlag. `uppdragPengar.ts` läser obundna kvitton efter
  senaste bindningsköposten, med Lasvarde/källa/lästid. Pengar-delen av
  `routes.ts` visar Obunden utan föreslagen kod, med färskhetsrad och tomläge.
  Husets tabell, typografi och tokens följs; länken får befintlig focus-visible.
  Tomt, laddat, saknad leverantör, obokfört och escaping prövades isolerat.
  Serverrenderingens sidbyte och befintliga felhantering används.
  Ingen browserkörning eller databasverifiering påstås utförd.

  Nya K0–K7 ligger i `server/test/uppdragsytan-kostnadssparr.test.ts` och
  `kostnadssparrHelper.ts`. K1–K4 prövar köning/audit/människospärr/statusar/
  avslag/belopp; K5 skälet och frysta källor; K6/K7 ja/nej, obundna kostnader,
  senaste avtal, tenant och markup. Svep-bindning, bindning, svep och pengarna
  följer det ändrade beteendet. Pengarnas chipmärkning planteras efter ja,
  eftersom svepet inte längre sätter oplanerad. Dokumentationen uppdaterad i
  `docs/MCP_ACTIONS.md` och `docs/ARKITEKTUR.md`; CRM-kontraktet berörs inte.

  Röda belägg före respektive implementation:
  ```text
  test/kostnadssparrHelper.ts(3,34): error TS2307: Cannot find module '../src/lib/bindningsmal.js' or its corresponding type declarations.
  test/uppdragsytan-kostnadssparr.test.ts(271,89): error TS2554: Expected 6 arguments, but got 5.
  AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
  +   varde: 'Svepet kopplade kvittot till L4 genom handlingens titel.'
  -   varde: 'Svepet kopplade kvittot till L4 genom handlingens titel. En leverabel föreslås bara när den har en aktiv avtalsdel, och därför gäller förslaget S2: strömmen vars intervall täcker kvittots datum 2026-11-20, annars uppdraget.'
  test/uppdragsytan-kostnadssparr.test.ts(367,12): error TS2339: Property 'obundna_kostnader' does not exist on type 'Avtalspengar'.
  ```
  Typecheck exit 2 för Task 1/2/4, ren K5 exit 1 för Task 3.
  Gröna lokala grindar efter varje uppgift och vid slutet:
  ```text
  > tsc --noEmit && tsc --noEmit -p tsconfig.test.json
  exit 0
  > tsc
  exit 0
  grön: provaAnnatMal
  grön: provaCachemal
  grön: provaDatumSaknas
  grön: provaLov
  grön: provaLovskal
  grön: provaOverlapp
  grön: provaRot
  grön: provaRotskal
  grön: provaSaknatSkal
  grön: provaStrom
  grön: provaStromskal
  grön: isolerad kostnadspanel, tom/laddad/saknad leverantör/obokförd/escaping/färskhet
  exit 0
  > vitest run
  RUN  v3.2.7 /opt/redovisning/server
  No test files found, exiting with code 1
  Error: connect EPERM 127.0.0.1:5433 - Local (undefined:undefined)
  exit 1 före insamling
  ```
  Vitest inte kört i sandlådan: anslutningen nekas. Riktade sviter, modulsviten
  och hela sviten försöktes; kedjans `npm test` belägger integration/regression
  enligt berättelsens uttryckliga undantag. Inget DB-prov kallas grönt.
  Ingen migration, tjänstestart eller driftsättning utförd.

  Driftnotiser:
  1. Kostnader som gren 2 bundit före bygget står kvar bundna med
     `oplanerad = true` och `bindning: automatisk`. David avgör eventuell
     efterhandsprövning; inga historiska kvitton ändras här.
  2. `hermes/prov/bakvag.py`:s fjärde kontroll mäter nu bara historiska rader.
     En Hermes-berättelse kan byta den mot ”ingen ny automatbindning efter
     driftsättningen”. Hermes är orörd.
  3. `bindningar.automatiska` är alltid tom och står kvar för att
     svepkontraktet bara växer.


- **2026-10-11 (Story 1.7, omtag 2: CHECK-regler och mottaget avslut):**
  Rättat två provmekanismer i `server/test/uppdragsytan-beslut.test.ts`,
  `beslutsunderlagHelper.ts` och `uppdragsytan-avslut.test.ts`.
  P2 utvärderar alla verkliga CHECK-uttryck mot samma rad som INSERT och
  kräver att den namngivna regeln fäller raden. INSERT:s 23514 får rapportera
  vilken faktiskt bruten regel som helst. Nio regler, 15 fall inklusive
  kanske/JA/tomt utfall, båda riktningarna och negativa kontroller täcks.
  Kontrollvakten höjs 21 → 23; 20/21 var följdfelet efter första assertionen.
  Andra avslutet prövas med tom och öppen fryst lista: jat bevaras mottaget,
  saknas i pending och nya ja/nej ger not_pending utan ändrad köpost/lista.
  Sökning i berättelsens övriga prov fann inga fler felaktiga pending- eller
  CHECK-assertioner av samma slag. Produktionskod, migration och kontrakt
  är orörda i detta omtag; inget nytt beroende. Lägets befintliga panel/logg,
  typsnitt och tokens behålls för samma läsrytm och fokus som resten av ytan.

  Rött före rättning, ren CHECK-kontroll, exit 1:
  ```text
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
  + 'uppdrag_beslut_skal_vid_nej'
  - 'uppdrag_beslut_utfall'
  ```
  Avslutsprovets röda belägg är kedjans `expected [] to include <köpostens id>`;
  lokal DB-körning nekades även efter att provet utökats före rättningen.
  Slutgrindar från roten:
  ```text
  > tsc --noEmit && tsc --noEmit -p tsconfig.test.json
  exit 0
  > tsc
  exit 0
  > vitest run
  RUN v3.2.7 /opt/redovisning/server
  No test files found, exiting with code 1
  Error: connect EPERM 127.0.0.1:5433 - Local (undefined:undefined)
  exit 1 före insamling
  Slutprov: 10 rena kontroller gröna utan DB, inklusive CHECK-felklassens negativa kontroller
  exit 0
  git diff --check
  exit 0
  ```
  Typecheck/build och rena kontroller passerar. Vitest inte kört i sandlådan;
  kedjans `npm test` belägger integration och regression enligt berättelsens
  uttryckliga undantag. Inget DB-prov påstås grönt. DoD prövas före review.
  Hermes är orörd; svepets svar är fortfarande additivt. Ett affärsfel efter
  mottagandet lämnar mandatet mottaget med driftlogg och återförsök i svepet,
  enligt den befintliga regeln. Ingen tjänst, migration eller driftåtgärd körd.

- **2026-10-11 (Story 1.7, omtag efter röda kontroller):**
  Rättat provmekanismerna i `server/test/beslutsunderlagHelper.ts`,
  `uppdragsytan-mandat.test.ts` och `uppdragsytan-beslut.test.ts`.
  Takbekräftelsen tillåter exakt målradens flagga och ändringstid, och
  prövar varje övrig lagrad kolumn, oförändrat radantal och övrigt sakläge.
  Två delar, explicit/härlett datum och upprepad bekräftelse täcks.
  Scopeunderlagen härleds ur den befintliga tillåtelselistan, typade som
  Signalunderlag: mejl och kalender prövas genom verkliga lager för människa
  och agent. Drive är fortsatt otillåtet som scopehändelse.
  HTML-kontrollen följer hela div-raden; negativa kontroller vid flera djup
  ser även sena knappar, formulär och fel. Mottaget ja och nej prövas.
  Kontrollvakterna behålls. Produktionskod, beroenden och kontrakt orörda
  i omtaget. Lägets panel/logg, Public Sans/IBM Plex Mono, OKLCH-tokens och
  fokusregler bevarar formspråket; inget nytt interaktivt element.

  Rött först: ren takkontroll exit 1 (den gamla likhetskontrollen fäller
  tillåten flagga/tid), rent HTML-prov exit 1 (datum i stället för hela
  raden), typat underlagsprov exit 2 (`TS2322`, drive är inte mejl/kalender).
  Rena gröna slutprov, exit 0:
  ```text
  Slutprov: nio rena kontroller gröna utan DB
  Slutprov utan DB: P1 6/6 + tre klasskontroller + verklig Beslut-rendering för mottaget ja/nej och tomläge gröna
  ```
  P9-B från roten:
  ```text
  > redovisningssystem@0.1.0 typecheck
  > npm run typecheck -w server
  > server@0.1.0 typecheck
  > tsc --noEmit && tsc --noEmit -p tsconfig.test.json
  exit 0
  > redovisningssystem@0.1.0 build
  > npm run build -w server
  > server@0.1.0 build
  > tsc
  exit 0
  > redovisningssystem@0.1.0 test
  > npm run test -w server
  > server@0.1.0 test
  > vitest run
  RUN v3.2.7 /opt/redovisning/server
  No test files found, exiting with code 1
  Error: connect EPERM 127.0.0.1:5433 - Local (undefined:undefined)
  exit 1 före insamling
  ```
  Vitest inte kört i sandlådan; kedjans `npm test` belägger provet enligt
  berättelsens uttryckliga undantag. DB-sviten kallas inte grön.
  `git diff --check`, exit 0; berättelsens tillåtna områden kontrollerade.
  Dev Agent Record/Change Log och 26 DoD-punkter uppdaterade, Status review.
  Ingen migration, tjänstestart eller driftsättning. Inget kallat klart
  utan körd utdata.

- **2026-10-11 (Story 1.7 — ja och nej blir fryst beslutshistorik):**
  `0080_uppdrag_beslut.sql` skapar append-only FRYST HISTORIK med RLS,
  sammansatta tenant-FK, CHECK och två unika nycklar. `uppdragBeslut.ts`
  fryser samma underlag som undantagsvyn före domänhandlingen och skriver
  beslut och audit i verkställighetens transaktion. Beslutsfattare och tid
  läses i INSERT SELECT ur kön, utan millisekundavkortning. Hashregeln finns
  i `lib/beslutsunderlag.ts`. De sex mandaten i registret har tvåfas och
  avslagsregistrering; `avboj_beslutsforslag` kräver människa och skäl.
  `execute.ts` och `uppdragSvep.ts` tar om mottagna beslut först, med delat
  urval och verkställaren `svep`. `uppdragLage.ts` och `view/routes.ts`
  visar mottagna och registrerade beslut i panelen Beslut. Övrigts täckning
  läser även beslutsraden. MCP_ACTIONS och ARKITEKTUR beskriver kontraktet.

  P1–P8 är skrivna i `server/test/uppdragsytan-mandat.test.ts`,
  `uppdragsytan-beslut.test.ts`, `beslutsunderlagHelper.ts` och
  `uppdragsytan-agandegrans-cache.test.ts`. Befintliga regressioner prövar
  mottaget ja med hash, orört sakläge, ingen beslutsrad, exakt loggkod och
  återförsökets kvar-lista vid verkställighetsfel. Inga saklägesassertioner
  har tagits bort. Detaljer, radnummer och full File List står i berättelsen.
  Panelen återanvänder husets panel/logg, typografi, chips, färskhetsrad och
  fokusregler; inga nya CSS-regler. Tomt, mottaget och registrerat läge samt
  saknat underlag har egna texter. Verklig HTML-rendering, escaping och
  färskhet har prövats utan DB. Browserkontroll inte körd: browsern stängdes
  vid launch (`browserType.launch: Target page, context or browser has been closed`).

  Slutgrindarna P9-B från roten:
  ```text
  > redovisningssystem@0.1.0 typecheck
  > npm run typecheck -w server
  > server@0.1.0 typecheck
  > tsc --noEmit && tsc --noEmit -p tsconfig.test.json
  exit 0
  > redovisningssystem@0.1.0 build
  > npm run build -w server
  > server@0.1.0 build
  > tsc
  exit 0
  > redovisningssystem@0.1.0 test
  > npm run test -w server
  > server@0.1.0 test
  > vitest run
   RUN  v3.2.7 /opt/redovisning/server
  No test files found, exiting with code 1
  Error: connect EPERM 127.0.0.1:5433 - Local (undefined:undefined)
  exit 1 före provkörning
  ```
  Vitest/P9-A/P9-B och P8:s negativa DB-kontroller **inte körda** i sandlådan:
  anslutningen nekas före insamling. Kedjans `npm test` belägger dem enligt
  berättelsens uttryckliga undantag. Databasproven kallas inte gröna.
  Databasfria slutkontroller, exit 0:
  ```text
  P1 6/6; P3 källfrysning/schema/handling; registerkontrakt och sex rena regressionsprov: gröna utan DB
  Beslutspanel: verklig HTML-rendering för tomt, mottaget och registrerat nej, escaping och färskhet gröna utan DB
  Arkitekturgrind: ingen parallell verkställighet, ingen catch, inga externa anrop, svepets stegordning OK
  ```
  Migrationen är jämförd ordagrant med berättelsen; bara tillåtna
  berättelsefält är ändrade. DoD prövas punkt för punkt i Dev Agent Record.
  Inget kallat klart utan körd utdata.

  Efter kedjans godkända code-review och driftsättning går även redan väntande
  köposter för de sex mandaten genom tvåfasvägen. Svepet tar om mottagna beslut
  var 15:e minut. Ett mottaget ja som inte kan verkställas av affärsskäl
  (`version_finns` eller avslutat uppdrag) står kvar som Mottaget med loggrad
  tills Davids svar på frågan sist i berättelsen finns. Hermes är inte rörd;
  svepets svar är additivt. 0080 lägger `action_approvals_id_company_uk` på
  `(id, company_id)`; Story 1.15:s `ersatt_av` kan använda den.

- **2026-10-11 (Story 10.5 — en tidpost ändras bara om den står som anroparen läste den):**
  `update_time_entry` tar valfritt strict `expected` med exakt minutes,
  billable_minutes, adjustment_reason och status. Den rena `avvikandeFalt`
  jämför med posten under befintligt FOR UPDATE, efter faktureringsspärren
  och före övriga regler. Avvikelse ger 409 time_entry_changed före UPDATE
  och audit; utan expected fortsätter samma väg. Inga nya beroenden,
  migrationer, tjänster eller arkitekturmönster.
  Provfilen tidpost-livscykel har ett nytt block: P1 samma svar/audit som
  tvilling utan expected, P2–P5 en skillnad i taget utan skrivning, P6 lås
  före jämförelse, P7 strict/required/manifest, P8 faktisk låsväntan på B:s
  backend och människans commit, P9 agenttoken. Renhetsprovet täcker lika
  värden, null i båda riktningar och fältordning. Befintliga block är orörda.
  MCP_ACTIONS och API_KONTRAKT:s tidsförslagsdel beskriver kompletteringen;
  ingest/propose_time_entries ändras inte. Berättelsen och sprinten dokumenteras.
  Befintliga ytor granskade i html.ts och routes.ts: Public Sans, IBM Plex
  Mono, OKLCH-tokens och synligt fokus bevarar husets läsrytm. Berättelsen
  förbjuder vyändring; inga nya interaktiva element eller tillstånd införs.

  Rött först per uppgift: typecheck exit 2 för saknade JAMFORDA_FALT/
  ForvantadTidpost (Task 1) respektive avvikandeFalt (Task 2). Den rena
  negativa kontrollen i Task 2 gav TypeError: avvikandeFalt is not a function,
  exit 1. Riktad Vitest och npm test försöktes i varje röd/grön fas,
  exit 1 före insamling på grund av EPERM. Inga databasfall observerat gröna.
  Databasfria kontroller efter kod, exit 0:
  ```text
  P7 schema/manifest: exakt fyra obligatoriska fält, optional, null, 0/1440 och ogiltiga värden OK
  P2–P5 ren jämförelse: lika värden, varje fält, null i båda riktningar, fast ordning och frysta indata OK
  ```
  Grindarna efter Task 2:
  `npm run typecheck`, exit 0:
  ```text
  > redovisningssystem@0.1.0 typecheck
  > npm run typecheck -w server
  > server@0.1.0 typecheck
  > tsc --noEmit && tsc --noEmit -p tsconfig.test.json
  ```
  `npm run build`, exit 0:
  ```text
  > redovisningssystem@0.1.0 build
  > npm run build -w server
  > server@0.1.0 build
  > tsc
  ```
  `npm test`, exit 1:
  ```text
  > redovisningssystem@0.1.0 test
  > npm run test -w server
  > server@0.1.0 test
  > vitest run
  RUN  v3.2.7 /opt/redovisning/server
  No test files found, exiting with code 1
  Error: connect EPERM 127.0.0.1:5433 - Local (undefined:undefined)
  Serialized Error: { errno: -1, code: 'EPERM', syscall: 'connect', address: '127.0.0.1', port: 5433 }
  npm error Lifecycle script `test` failed with error:
  npm error code 1
  npm error path /opt/redovisning/server
  npm error workspace server@0.1.0
  npm error location /opt/redovisning/server
  npm error command failed
  npm error command sh -c vitest run
  ```
  **Inte kört:** Vitest P1–P9, renhetsprovet i Vitest och befintliga regressioner:
  globalSetup nekades databasen före insamling. vitest inte kört i sandlådan:
  Error: connect EPERM 127.0.0.1:5433 - Local (undefined:undefined);
  kedjans npm test belägger provet enligt uppdragets uttryckliga undantag.
  `git diff --check` exit 0. Ingen tjänststart eller driftsättning.


- **2026-10-07 (Story 1.6, omtag — fem High-granskningsfynd rättade):**
  Baselineförslagen beskriver samtliga angivna verksamhetsfält, även beskrivning,
  debiterbar/ej debiterbar, aktiv/inaktiv och sorteringsordning. Precision har
  svenska etiketter; start och slut beskrivs var för sig. Schemajämförelsen kräver
  prov för varje verksamhetsfält på update_contract och båda versionsvägarna.
  Kund, avtalshandling och föräldraversion läses i klump inom bolaget och bär
  identifierande Lasvarde i forslag.mal. Saknat/främmande/ogiltigt mål anges som
  saknat; förälder kräver samma avtal. Befintliga kund- och dokumentytor länkas.
  Ren upsert-takbekräftelse beskriver befintlig version, andra ändringar ny version.
  Effektivt datum följer skrivvägen: explicit valid_from, annars läst signed_date.
  Saknas båda visas datum saknas. Inga nya beroenden, skrivvägar, migrationer eller
  UI-ytor. Befintliga Public Sans/IBM Plex Mono och OKLCH-tokens bevarar formspråket;
  berättelsen levererar läsunderlag, själva undantagsvyn hör till Story 1.11.
  MCP_ACTIONS och berättelsens uppföljningar/Dev Agent Record/File List/Change Log
  uppdaterade. CRM/ingestkontraktet och arkitekturens principer är oförändrade.

  Rött först per felklass: rena assertions föll för precision: år, description
  (1 !== 2), målidentitet, ren takbekräftelse och ärvt datum. Efter respektive kod
  passerade samma assertions. Alla scalarfält har flera värden inklusive false/noll;
  mål med lika namn behåller skilda identiteter. Klassificeringen jämförs med
  skrivvägens arRenBekraftelse för varje schemafält med definierat/utelämnat värde.
  Integrationsprov läser olika egna/främmande/saknade mål och godkänner både
  takbekräftelser och versioner samt jämför lagrade rader/datum med beskriven verkan.
  Typecheck exit 0 i slutgrinden (ett testtypfel under R3 korrigerades). Build exit 0.
  Rena slutprov, exit 0:
  ```text
  R1–R5 rena prov och fullständig schemajämförelse: OK
  Rena P2/P6/P11/P13: fyra beskrivare, Lasvarde, täckning, färskhetsgräns och tre utfall OK
  P2/P13/P16: ensamma deklarationer, importtillåtelselista och negativ importkontroll OK
  ```
  Riktad Vitest och föreskriven P17-grupp försöktes från server/, exit 1 före
  insamling. npm test försöktes före/efter varje rättning och i slutgrinden.
  Inga databasfall är körda eller observerat gröna. Uppdragets uttryckliga EPERM-
  undantag används; kedjans hela npm test måste belägga dem efter denna överlämning.
  Slutligt npm test, exit 1, ordagrann utdata:

  ```text

  > redovisningssystem@0.1.0 test
  > npm run test -w server


  > server@0.1.0 test
  > vitest run


   RUN  v3.2.7 /opt/redovisning/server

  No test files found, exiting with code 1

  include: **/*.{test,spec}.?(c|m)[jt]s?(x)
  exclude:  **/node_modules/**, **/dist/**, **/cypress/**, **/.{idea,git,cache,output,temp}/**, **/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build,eslint,prettier}.config.*


  ⎯⎯⎯⎯⎯⎯ Unhandled Error ⎯⎯⎯⎯⎯⎯⎯
  Error: connect EPERM 127.0.0.1:5433 - Local (undefined:undefined)
   ❯ internalConnect node:net:1110:16
   ❯ defaultTriggerAsyncIdScope node:internal/async_hooks:472:18
   ❯ node:net:1356:9
   ❯ process.processTicksAndRejections node:internal/process/task_queues:84:11

  ⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯
  Serialized Error: { errno: -1, code: 'EPERM', syscall: 'connect', address: '127.0.0.1', port: 5433 }



  npm error Lifecycle script `test` failed with error:
  npm error code 1
  npm error path /opt/redovisning/server
  npm error workspace server@0.1.0
  npm error location /opt/redovisning/server
  npm error command failed
  npm error command sh -c vitest run
  ```


- **2026-10-07 (Story 1.6, B-3 — undantagsvyns läsväg och svepets täckning):**
  `lib/lasvarde.ts` bär källa, lästid och last/olast/saknas. `services/uppdragUndantag.ts`
  samlar fyra mandatpostslag, med rena beskrivare och täckningsregler. `las_undantag`
  är read utan människospärr, via samma register för REST/MCP. Kön hämtas utan LIMIT
  genom `listaVantandeKoposter`; `listApprovals` är orörd. `upsertSvepvarden` har
  omfången svep/tackning, och svepets sista steg skriver tackning för alla öppna
  avtal, även utanför indatat. Inga nya beroenden, migrationer eller vyer.
  MCP_ACTIONS och arkitekturdokumentets beskrivning följer fastställda B-3;
  CRM/ingestkontraktet är oförändrat. Ingen tjänststart eller driftsättning.

  `uppdragsytan-undantag.test.ts`: P2–P4 läsvärden/ingångar/urval, P5 230 poster,
  P6 underlag och saknat, P7 belopp, P8 tio frånvarofall med kontrollvakt, P9 skala,
  P10–P12 täckning och tretton regler/Övrigt, P13–P14 färskhet och sju ofullständiga
  lägen, P15 bolagsgränsen och ogiltiga uuid, P16 inga anrop ut. P17 omfattar de
  befintliga regressionssviterna. I svepprovet är endast kommentaren och nyckellistan
  (tidigare rader 380/382) ändrade till att ta med tackning; inga assertioner försvagade.

  Rött först: typecheck exit 2 med saknade importer/exporter före koden.
  Vitest och npm test nekades databasen i både röd och grön fas; inga databasfall
  har körts eller observerats gröna. Berättelsens uttryckliga databasundantag används:
  kedjans npm test belägger dem. Rena kontroller körda med tsx utan dotenv-fil:
  `Rena P2/P6/P11/P13: Lasvarde, fyra beskrivningar, kalltackning, 60 min färskt / 60 min 1 s gammalt, bedomUndantag OK` (exit 0).
  Omfångsvakterna och registrets read/schema/manifestkontroll passerar också (exit 0).
  P2(a): deklarationssökningen rättad efter ett observerat falskt rött från en
  typimport (exit 1 före, exit 0 efter). Ensam ålderskonstant och tillåtna importer
  prövade utan databas, exit 0. Slutlig typecheck efter provrättningen exit 0;
  npm test åter försökt och stoppat av samma EPERM.
  Slutgrindarnas ordagranna utdata:

  npm run typecheck (exit 0):
  ```text

  > redovisningssystem@0.1.0 typecheck
  > npm run typecheck -w server


  > server@0.1.0 typecheck
  > tsc --noEmit && tsc --noEmit -p tsconfig.test.json
  ```

  npm run build (exit 0):
  ```text

  > redovisningssystem@0.1.0 build
  > npm run build -w server


  > server@0.1.0 build
  > tsc
  ```

  npm test (exit 1):
  ```text

  > redovisningssystem@0.1.0 test
  > npm run test -w server


  > server@0.1.0 test
  > vitest run


   RUN  v3.2.7 /opt/redovisning/server

  No test files found, exiting with code 1

  include: **/*.{test,spec}.?(c|m)[jt]s?(x)
  exclude:  **/node_modules/**, **/dist/**, **/cypress/**, **/.{idea,git,cache,output,temp}/**, **/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build,eslint,prettier}.config.*


  ⎯⎯⎯⎯⎯⎯ Unhandled Error ⎯⎯⎯⎯⎯⎯⎯
  Error: connect EPERM 127.0.0.1:5433 - Local (undefined:undefined)
   ❯ internalConnect node:net:1110:16
   ❯ defaultTriggerAsyncIdScope node:internal/async_hooks:472:18
   ❯ node:net:1356:9
   ❯ process.processTicksAndRejections node:internal/process/task_queues:84:11

  ⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯
  Serialized Error: { errno: -1, code: 'EPERM', syscall: 'connect', address: '127.0.0.1', port: 5433 }



  npm error Lifecycle script `test` failed with error:
  npm error code 1
  npm error path /opt/redovisning/server
  npm error workspace server@0.1.0
  npm error location /opt/redovisning/server
  npm error command failed
  npm error command sh -c vitest run
  ```

  Riktad Vitest och P17: exit 1, samma EPERM före insamling; full utdata i berättelsens
  Debug Log. Befintliga ytor lästa: Public Sans, IBM Plex Mono, OKLCH och synligt
  fokus behålls för samma läsrytm. Själva undantagsvyn hör till Story 1.11.
  Efter driftsättningen saknas täckningen fram till första svepet. Avtal med
  markerade Övrigt-rader är ofullständiga tills Story 1.14 och 1.17 finns.

- **2026-10-07 (Story 1.5, omtag — tvetydig SQL-sortering):**
  Task 9:s SELECT * plus textkast gav dubbla kolumnnamn och tvetydig
  ORDER BY valid_from. Samma felklass hittades och rättades i
  server/test/uppdragsytan-baseline.test.ts och -tillagg.test.ts:
  sorteringen använder nu p.valid_from, p.code och p.id. Hela lagrade
  rader och textkonverteringar bevaras. Fyra nya prov skrevs före
  rättningen: flera datum/koder, saknat/decimalt tak, oförändrad hel
  ursprungsrad och upprepad läsning.

  Röd fas: npm run typecheck exit 0; npm test exit 1 med EPERM före
  insamling. Kedjans ORDER BY-fel belägger det röda SQL-beteendet;
  inga nya databastester observerat röda eller gröna i sandlådan.
  Efter rättningen gav grindarna följande ordagranna utdata:

  npm run typecheck (exit 0):
  ```text
  > redovisningssystem@0.1.0 typecheck
  > npm run typecheck -w server


  > server@0.1.0 typecheck
  > tsc --noEmit && tsc --noEmit -p tsconfig.test.json
  ```

  npm run build (exit 0):
  ```text
  > redovisningssystem@0.1.0 build
  > npm run build -w server


  > server@0.1.0 build
  > tsc
  ```

  npm test (exit 1):
  ```text
  > redovisningssystem@0.1.0 test
  > npm run test -w server


  > server@0.1.0 test
  > vitest run


   RUN  v3.2.7 /opt/redovisning/server

  No test files found, exiting with code 1

  include: **/*.{test,spec}.?(c|m)[jt]s?(x)
  exclude:  **/node_modules/**, **/dist/**, **/cypress/**, **/.{idea,git,cache,output,temp}/**, **/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build,eslint,prettier}.config.*


  ⎯⎯⎯⎯⎯⎯ Unhandled Error ⎯⎯⎯⎯⎯⎯⎯
  Error: connect EPERM 127.0.0.1:5433 - Local (undefined:undefined)
   ❯ internalConnect node:net:1110:16
   ❯ defaultTriggerAsyncIdScope node:internal/async_hooks:472:18
   ❯ node:net:1356:9
   ❯ process.processTicksAndRejections node:internal/process/task_queues:84:11

  ⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯
  Serialized Error: { errno: -1, code: 'EPERM', syscall: 'connect', address: '127.0.0.1', port: 5433 }



  npm error Lifecycle script `test` failed with error:
  npm error code 1
  npm error path /opt/redovisning/server
  npm error workspace server@0.1.0
  npm error location /opt/redovisning/server
  npm error command failed
  npm error command sh -c vitest run
  ```

  Riktad Vitest för baselineversion, baseline och tillägg: samma EPERM,
  exit 1 före insamling. Databasfri P9 exit 0:
  `P9: ["cap_hours","cap_amount_ore","cap_confirmed","valid_from","hourly_rate_ore"] [true,false,false,false] OK`.
  git diff --check exit 0. Kedjan belägger databastesterna enligt undantaget.
  Migration 0079 och produktionskoden ändras inte i omtaget. Inget nytt
  beroende, ändrat CRM-kontrakt, tjänstestart eller driftsättning.
  Befintliga ytor lästa; Public Sans, IBM Plex Mono, OKLCH och synligt
  fokus ger samma läsrytm och formspråk. Inga vyfiler ändras.


- **2026-10-07 (Story 1.5, omtag — versionsurval och lagrad orsak):**
  Kedjans regressioner kom av att svepet filtrerade active före versionsvalet:
  äldre aktiva rader återkom efter inaktivering med en ny baselineversion.
  `server/src/services/uppdragSvep.ts` väljer nu senaste version först och
  prövar sedan active. Förälderns kod läses via den lagrade länken, så
  strömmar fortfarande hittas efter en ny rotversion utan att barnrader skrivs
  om. Kommentaren i uppdragKostnad.ts följer regeln.
  Första versionens NULL-förväntan rättad även i baselineprovet, utöver
  tilläggsprovet; båda använder två olika orsaker och jämför hela den lagrade
  raden före/efter ja. Svep-bindningsprovet täcker L1, L4, S2 och UPPDRAG med
  inaktiv andra och aktiv tredje version. Provhjälparen hämtar aktuella id:n
  via get_contract_usage. Pengarnas befintliga regressionsprov behålls.

  Omtaget hör till Task 9; migration 0079 och skrivmekanismen är oförändrade.
  Orsakskravet gäller också första förslaget, medan NULL fortfarande tillåts
  på äldre rader och första direkta inläsningen ur utkast. Ingen ny migration,
  inget beroende, ingen tjänstestart eller driftsättning. Inget ändrat
  CRM/API-kontrakt. Husets Public Sans, IBM Plex Mono, OKLCH-tokens och
  synliga fokus behålls för samma läsrytm; inga vyfiler ändras.

  Utökade prov före rättningen; npm test gav EPERM innan insamling även då.
  Slutgrindarnas faktiska utdata:

  `npm run typecheck` (exit 0):
  ```text
  > redovisningssystem@0.1.0 typecheck
  > npm run typecheck -w server


  > server@0.1.0 typecheck
  > tsc --noEmit && tsc --noEmit -p tsconfig.test.json
  ```

  `npm run build` (exit 0):
  ```text
  > redovisningssystem@0.1.0 build
  > npm run build -w server


  > server@0.1.0 build
  > tsc
  ```

  `npm test` (exit 1):
  ```text
  > redovisningssystem@0.1.0 test
  > npm run test -w server


  > server@0.1.0 test
  > vitest run


   RUN  v3.2.7 /opt/redovisning/server

  No test files found, exiting with code 1

  include: **/*.{test,spec}.?(c|m)[jt]s?(x)
  exclude:  **/node_modules/**, **/dist/**, **/cypress/**, **/.{idea,git,cache,output,temp}/**, **/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build,eslint,prettier}.config.*


  ⎯⎯⎯⎯⎯⎯ Unhandled Error ⎯⎯⎯⎯⎯⎯⎯
  Error: connect EPERM 127.0.0.1:5433 - Local (undefined:undefined)
   ❯ internalConnect node:net:1110:16
   ❯ defaultTriggerAsyncIdScope node:internal/async_hooks:472:18
   ❯ node:net:1356:9
   ❯ process.processTicksAndRejections node:internal/process/task_queues:84:11

  ⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯
  Serialized Error: { errno: -1, code: 'EPERM', syscall: 'connect', address: '127.0.0.1', port: 5433 }



  npm error Lifecycle script `test` failed with error:
  npm error code 1
  npm error path /opt/redovisning/server
  npm error workspace server@0.1.0
  npm error location /opt/redovisning/server
  npm error command failed
  npm error command sh -c vitest run
  ```

  Riktad Vitest för baselineversion, baseline, tillägg, svep-bindning och
  pengarna gav samma EPERM och exit 1 före insamling. Inga tester observerat
  gröna; kedjan belägger dem enligt berättelsens databasundantag.
  `git diff --check` exit 0. File List och DoD uppdaterade inför review.


- **2026-10-07 (Story 1.5, B-7 — en lagrad baselineversion skrivs aldrig över):**
  Migration `server/migrations/0079_baselineversion.sql` fryser hela lagrade
  baselineversioner, även obekräftade, och fäller DELETE. Bara bekräftelse
  framåt och updated_at får skilja. `services/contracts.ts` delar INSERT
  (`skrivBaselineversion`) från bekräftelse (`bekraftaTak`); befintlig nyckel
  ger 409 version_finns. Gemensam lista i `lib/baselinekolumner.ts` och
  `ActionDef.kraverNyVersion` avvisar baselinefält före kön och vid godkännande
  av gamla köposter. Registret kräver orsak för varje nytt förslag.
  `skapa_uppdrag` lagrar ingen rotdel: utkastet är köposten och baseline v1
  föds efter ja. Importen skriver aldrig över. `contractExtraction.ts` sätter
  redigeringsflaggan redan vid INSERT. Arkitektur och MCP_ACTIONS är speglade;
  CRM-ingestkontraktet berörs inte.

  Nytt prov `uppdragsytan-baselineversion.test.ts` täcker P2–P14 med
  kontrollvakt, fullständiga ögonblicksbilder, båda databasrollerna, köutkast,
  orsakskrav, bekräftelse/audit och bolagsisolering. Omskrivna sviter:
  avtalsdelar, bakvag, tid-rapporter, tid-snabbregistrering, tidsforslag samt
  uppdragsytan-avslut, -baseline, -bedomning, -import, -kontraktsyta, -laget,
  -pengarna, -rapporterna, -sparrar, -svep-bindning, -svep, -tillagg och -troskel.
  Förslag har orsak, rättelser blir nya versioner och direkt SQL kräver
  P0001 med oförändrade rader. Befintliga vyer granskade: Public Sans,
  IBM Plex Mono, OKLCH och synligt fokus. Berättelsen ändrar inga vyfiler.

  Rött först: saknade exporter i typecheck (exit 2), orsaksschemat accepterade
  saknat skäl och databasfria köspärrprovet gav EPERM i stället för
  kraver_ny_version (exit 1). De rena kontrollerna passerar efter ändringen
  (exit 0); P9 skriver ut listan och true/false/false/false. Migrationsläsaren
  godtar 79 filer, sist 0079_baselineversion.sql (exit 0).
  Slutgrindarnas ordagranna utdata:

  `npx --no-install vitest run test/uppdragsytan-baselineversion.test.ts (server/)`
  ```text

   RUN  v3.2.7 /opt/redovisning/server

  No test files found, exiting with code 1

  filter: test/uppdragsytan-baselineversion.test.ts
  include: **/*.{test,spec}.?(c|m)[jt]s?(x)
  exclude:  **/node_modules/**, **/dist/**, **/cypress/**, **/.{idea,git,cache,output,temp}/**, **/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build,eslint,prettier}.config.*


  ⎯⎯⎯⎯⎯⎯ Unhandled Error ⎯⎯⎯⎯⎯⎯⎯
  Error: connect EPERM 127.0.0.1:5433 - Local (undefined:undefined)
   ❯ internalConnect node:net:1110:16
   ❯ defaultTriggerAsyncIdScope node:internal/async_hooks:472:18
   ❯ node:net:1356:9
   ❯ process.processTicksAndRejections node:internal/process/task_queues:84:11

  ⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯
  Serialized Error: { errno: -1, code: 'EPERM', syscall: 'connect', address: '127.0.0.1', port: 5433 }




  Exitkod: 1
  ```

  `npm run typecheck`
  ```text

  > redovisningssystem@0.1.0 typecheck
  > npm run typecheck -w server


  > server@0.1.0 typecheck
  > tsc --noEmit && tsc --noEmit -p tsconfig.test.json


  Exitkod: 0
  ```

  `npm run build`
  ```text

  > redovisningssystem@0.1.0 build
  > npm run build -w server


  > server@0.1.0 build
  > tsc

  Exitkod: 0
  ```

  `npm test`
  ```text

  > redovisningssystem@0.1.0 test
  > npm run test -w server


  > server@0.1.0 test
  > vitest run


   RUN  v3.2.7 /opt/redovisning/server

  No test files found, exiting with code 1

  include: **/*.{test,spec}.?(c|m)[jt]s?(x)
  exclude:  **/node_modules/**, **/dist/**, **/cypress/**, **/.{idea,git,cache,output,temp}/**, **/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build,eslint,prettier}.config.*


  ⎯⎯⎯⎯⎯⎯ Unhandled Error ⎯⎯⎯⎯⎯⎯⎯
  Error: connect EPERM 127.0.0.1:5433 - Local (undefined:undefined)
   ❯ internalConnect node:net:1110:16
   ❯ defaultTriggerAsyncIdScope node:internal/async_hooks:472:18
   ❯ node:net:1356:9
   ❯ process.processTicksAndRejections node:internal/process/task_queues:84:11

  ⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯
  Serialized Error: { errno: -1, code: 'EPERM', syscall: 'connect', address: '127.0.0.1', port: 5433 }



  npm error Lifecycle script `test` failed with error:
  npm error code 1
  npm error path /opt/redovisning/server
  npm error workspace server@0.1.0
  npm error location /opt/redovisning/server
  npm error command failed
  npm error command sh -c vitest run

  Exitkod: 1
  ```

  **Inte kört:** Vitest P2–P14 och regressionerna: globalSetup nekades
  anslutningen före insamling. vitest inte kört i sandlådan: Error: connect
  EPERM 127.0.0.1:5433 - Local (undefined:undefined); kedjans npm test belägger
  provet. Dessa prov kallas inte gröna. Ett riktat anrop från fel katalog
  stoppades av listen EPERM före HTTP-anropet; arbetskatalogen rättades.
  Ett typfel i planjämförelsens provhjälpare rättades före slutgrinden.
  git diff --check exit 0. Inga nya beroenden, inga körda migrationer ändrade.
  Ingen tjänst har startats och ingen driftsättning gjorts.

- **2026-10-07 (Story 3.5, B-16 — en ärendekoppling kräver sin frysta nyckel):**
  Ny migration `server/migrations/0078_arendenyckel.sql` prövar befintliga
  tidposter före ett idempotent CHECK NOT VALID och validerar villkoret i
  samma fil. Ärende-id kräver en satt nyckel och källa med minst ett tecken
  som inte är blanktecken. Driftfelet bär bara antal och högst fem uuid.
  Migrationer 0001–0077, särskilt 0060:s villkor, är oförändrade.
  `server/src/services/projects.ts` väljer nu `arende_id`, `arende_nyckel`
  och `arende_kalla` i listTimeEntries, utan uppslag. REST/MCP:s
  list_time_entries och update_time_entry:s svar delar därmed läsbarheten.
  `server/test/arende-projektkoppling.test.ts` utökas med P2–P8:
  migrationen på 0077, fem kantfall, app-skrivningar, REST-avvisning,
  schemagranskning med tre planterade FK, avbrottsstubbe och bolagsisolering.
  Befintliga K-5/K-6-prov står kvar. `docs/MCP_ACTIONS.md` speglar lässvaret.
  CRM-ingestkontraktet ändras inte. Befintlig tidpostvy och html.ts har
  granskats: Public Sans, IBM Plex Mono, OKLCH och synligt tangentbordsfokus.
  Berättelsens ändring ligger i läsvägen; det befintliga formspråket består.

  Rött före koden: databasfri kontroll gav exit 1 för saknad 0078 och saknade
  ärendefält. Typkontroll exit 0. Röd fasens npm test och riktat Vitest gav
  EPERM före insamling, så databasbeteendet i röd fas är inte observerat.
  Dokumentationskontrollen var röd före ändringen och grön efter.
  Slutgrindarnas ordagranna utdata följer:

  `npx --no-install vitest run test/arende-projektkoppling.test.ts (server/)`
  ```text

   RUN  v3.2.7 /opt/redovisning/server

  No test files found, exiting with code 1

  filter: test/arende-projektkoppling.test.ts
  include: **/*.{test,spec}.?(c|m)[jt]s?(x)
  exclude:  **/node_modules/**, **/dist/**, **/cypress/**, **/.{idea,git,cache,output,temp}/**, **/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build,eslint,prettier}.config.*


  ⎯⎯⎯⎯⎯⎯ Unhandled Error ⎯⎯⎯⎯⎯⎯⎯
  Error: connect EPERM 127.0.0.1:5433 - Local (undefined:undefined)
   ❯ internalConnect node:net:1110:16
   ❯ defaultTriggerAsyncIdScope node:internal/async_hooks:472:18
   ❯ node:net:1356:9
   ❯ process.processTicksAndRejections node:internal/process/task_queues:84:11

  ⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯
  Serialized Error: { errno: -1, code: 'EPERM', syscall: 'connect', address: '127.0.0.1', port: 5433 }
  Exitkod: 1
  ```

  `npm run typecheck`
  ```text

  > redovisningssystem@0.1.0 typecheck
  > npm run typecheck -w server


  > server@0.1.0 typecheck
  > tsc --noEmit && tsc --noEmit -p tsconfig.test.json
  Exitkod: 0
  ```

  `npm run build`
  ```text

  > redovisningssystem@0.1.0 build
  > npm run build -w server


  > server@0.1.0 build
  > tsc
  Exitkod: 0
  ```

  `npm test`
  ```text

  > redovisningssystem@0.1.0 test
  > npm run test -w server


  > server@0.1.0 test
  > vitest run


   RUN  v3.2.7 /opt/redovisning/server

  No test files found, exiting with code 1

  include: **/*.{test,spec}.?(c|m)[jt]s?(x)
  exclude:  **/node_modules/**, **/dist/**, **/cypress/**, **/.{idea,git,cache,output,temp}/**, **/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build,eslint,prettier}.config.*


  ⎯⎯⎯⎯⎯⎯ Unhandled Error ⎯⎯⎯⎯⎯⎯⎯
  Error: connect EPERM 127.0.0.1:5433 - Local (undefined:undefined)
   ❯ internalConnect node:net:1110:16
   ❯ defaultTriggerAsyncIdScope node:internal/async_hooks:472:18
   ❯ node:net:1356:9
   ❯ process.processTicksAndRejections node:internal/process/task_queues:84:11

  ⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯
  Serialized Error: { errno: -1, code: 'EPERM', syscall: 'connect', address: '127.0.0.1', port: 5433 }



  npm error Lifecycle script `test` failed with error:
  npm error code 1
  npm error path /opt/redovisning/server
  npm error workspace server@0.1.0
  npm error location /opt/redovisning/server
  npm error command failed
  npm error command sh -c vitest run
  Exitkod: 1
  ```

  `TSX_DISABLE_CACHE=1 DOTENV_CONFIG_PATH=/nonexistent node --import tsx (server/)`
  ```text
  P2: loadMigrations godtar kedjan: 78 filer; sist 0078_arendenyckel.sql
  P2: CHECK NOT VALID, VALIDATE, RAISE före ADD, inga INSERT/UPDATE/action_approvals: OK
  P7: arende_id, arende_nyckel och arende_kalla väljs; inga förbjudna nätverksanrop: OK
  P3–P8 och regressioner: inte körda i sandlådan (EPERM 127.0.0.1:5433); kedjans npm test belägger dem
  Exitkod: 0
  ```

  **Inte kört:** Vitest P2–P8 och regressionerna, inklusive tidpost-livscykel,
  tidsforslag, tid-snabbregistrering, faktura-ur-tid, avtalsdelar,
  uppdragsytan-laget och migrate. Anslutningen nekades i globalSetup.
  vitest inte kört i sandlådan: Error: connect EPERM 127.0.0.1:5433 - Local (undefined:undefined); kedjans npm test belägger provet.
  Typecheck/build och de databasfria kontrollerna passerar; databasproven
  kallas inte gröna. Berättelsens Dev Agent Record innehåller logg och
  punktvis DoD med detta uttryckliga undantag. Ingen tjänst har startats,
  ingen installation, commit, push eller driftsättning har gjorts.
  Kantkontrollen körs mot driftdatan först vid kedjans driftsättning.

- **2026-10-07 (Story 1.4, omtag AI-Review — verkställighetsfel utan fritext i driftloggen):**
  Granskarens High-fynd åtgärdat i `server/src/actions/execute.ts`: den gemensamma
  loggfunktionen skickar bara köpost-id, åtgärdskod och validerad felkod till
  console.error, aldrig felobjekt, message, detail, stack eller andra feldata.
  `server/test/uppdragsytan-godkannandevag.test.ts` har regression för direkt
  ja/nej och återförsök, med sju felvärden, exakt logginnehåll och bevarat beslut.
  Rött först: den faktiska loggfunktionen föll databasfritt (exit 1).
  Efter ändringen passerade samma funktion 14 kontroller (exit 0).
  Migration 0077, opt-in tvåfas och befintligt gränssnitt berörs inte av omtaget;
  ingen produktionsåtgärd har tvafas ännu. Husets tokens, typografi, fält,
  knappar, statuschip och fokusregler bär fortsatt Att göra. Inget CRM-kontrakt
  ändras. Berättelsens Dev Agent Record har full utdata och punktvis DoD.

  `npm run typecheck`
  ```text

  > redovisningssystem@0.1.0 typecheck
  > npm run typecheck -w server


  > server@0.1.0 typecheck
  > tsc --noEmit && tsc --noEmit -p tsconfig.test.json
  Exitkod: 0
  ```

  `npm run build`
  ```text

  > redovisningssystem@0.1.0 build
  > npm run build -w server


  > server@0.1.0 build
  > tsc
  Exitkod: 0
  ```

  `npm test`
  ```text

  > redovisningssystem@0.1.0 test
  > npm run test -w server


  > server@0.1.0 test
  > vitest run


   RUN  v3.2.7 /opt/redovisning/server

  No test files found, exiting with code 1

  include: **/*.{test,spec}.?(c|m)[jt]s?(x)
  exclude:  **/node_modules/**, **/dist/**, **/cypress/**, **/.{idea,git,cache,output,temp}/**, **/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build,eslint,prettier}.config.*


  ⎯⎯⎯⎯⎯⎯ Unhandled Error ⎯⎯⎯⎯⎯⎯⎯
  Error: connect EPERM 127.0.0.1:5433 - Local (undefined:undefined)
   ❯ internalConnect node:net:1110:16
   ❯ defaultTriggerAsyncIdScope node:internal/async_hooks:472:18
   ❯ node:net:1356:9
   ❯ process.processTicksAndRejections node:internal/process/task_queues:84:11

  ⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯
  Serialized Error: { errno: -1, code: 'EPERM', syscall: 'connect', address: '127.0.0.1', port: 5433 }



  npm error Lifecycle script `test` failed with error:
  npm error code 1
  npm error path /opt/redovisning/server
  npm error workspace server@0.1.0
  npm error location /opt/redovisning/server
  npm error command failed
  npm error command sh -c vitest run
  Exitkod: 1
  ```

  Rött fasens npm test och det riktade Vitest-anropet gav också exit 1 före
  insamling, med samma EPERM. **Inte kört:** databasproven och regressionerna;
  kedjans npm test belägger dem enligt berättelsens uttryckliga undantag.
  `git diff --check`: exit 0. Ingen tjänst startad, ingen installation,
  commit, push eller driftsättning utförd.

- **2026-10-07 (Story 1.4, B-2 — godkännandevägen bevarar ett mottaget beslut):**
  Godkännandekärnan får valfria `approvalId`, `tvafas` och `vidAvslag` i
  `server/src/actions/registry.ts`. `services/approvals.ts` delar kolumnlistan,
  härleder sorterad sha256 och tar emot nej med skäl via `avvisaGodkannande`.
  `actions/execute.ts` bevarar tvåfasbeslut före separat verkställighet,
  håller radlås och isolerar återförsök med savepoint per köpost.
  **Migration 0077** lägger till nullbara beslutsfält, CHECK-villkor och
  oföränderlighetstrigger. Ingen produktionsåtgärd har `tvafas` ännu (Story 1.7).
  REST:s reason sparas för tvåfas och 202 skiljer mottaget från verkställt.
  Att göra har ett märkt obligatoriskt skälfält och chipet Mottaget.
  Befintliga field/textarea/btn/chip-klasser, tokens och fokusregler används;
  naturlig fokusordning, tomläge och felnotis följer samma JS-fria SSR-yta.
  `server/test/uppdragsytan-godkannandevag.test.ts` innehåller P2–P12 med
  ja/nej, krascher före/efter mottagandet, idempotens, samtidighet, savepoint
  vid SQL-fel, agentspärr, RLS/bolagsisolering, book_invoice och källkontroll.
  `docs/ARKITEKTUR.md` speglar B-2:s additiva ändring och `docs/MCP_ACTIONS.md`
  beskriver reason/202. CRM-ingestkontraktet är oförändrat.
  Rött först: typkontrollen gav exit 2 på de saknade fälten/funktionerna.
  Efter uppgifterna: följande ordagranna utdata från slutgrindarna:

  `npm run typecheck`
  ```text
  > redovisningssystem@0.1.0 typecheck
  > npm run typecheck -w server


  > server@0.1.0 typecheck
  > tsc --noEmit && tsc --noEmit -p tsconfig.test.json
  Exitkod: 0
  ```

  `npm run build`
  ```text
  > redovisningssystem@0.1.0 build
  > npm run build -w server


  > server@0.1.0 build
  > tsc
  Exitkod: 0
  ```

  `npm test`
  ```text
  > redovisningssystem@0.1.0 test
  > npm run test -w server


  > server@0.1.0 test
  > vitest run


   RUN  v3.2.7 /opt/redovisning/server

  No test files found, exiting with code 1

  include: **/*.{test,spec}.?(c|m)[jt]s?(x)
  exclude:  **/node_modules/**, **/dist/**, **/cypress/**, **/.{idea,git,cache,output,temp}/**, **/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build,eslint,prettier}.config.*


  ⎯⎯⎯⎯⎯⎯ Unhandled Error ⎯⎯⎯⎯⎯⎯⎯
  Error: connect EPERM 127.0.0.1:5433 - Local (undefined:undefined)
   ❯ internalConnect node:net:1110:16
   ❯ defaultTriggerAsyncIdScope node:internal/async_hooks:472:18
   ❯ node:net:1356:9
   ❯ process.processTicksAndRejections node:internal/process/task_queues:84:11

  ⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯
  Serialized Error: { errno: -1, code: 'EPERM', syscall: 'connect', address: '127.0.0.1', port: 5433 }



  npm error Lifecycle script `test` failed with error:
  npm error code 1
  npm error path /opt/redovisning/server
  npm error workspace server@0.1.0
  npm error location /opt/redovisning/server
  npm error command failed
  npm error command sh -c vitest run
  Exitkod: 1
  ```

  `npx vitest run test/uppdragsytan-godkannandevag.test.ts` (server/): exit 1
  före insamling med `Error: connect EPERM 127.0.0.1:5433 - Local (undefined:undefined)`.
  **Inte kört:** Vitest P2–P12 och befintliga tester, eftersom sandlådan nekar
  testdatabasen. Kedjans npm test belägger proven; inget databasprov kallas grönt.
  Databasfri hashkontroll via `TSX_DISABLE_CACHE=1 node --import tsx`:
  ```text
  true
  false
  Exitkod: 0
  ```
  Samma rena P12-funktion körd utan databas:
  ```text
  P12, riktig källa: []
  P12, planterad källa: ["services/planterad.ts: UPDATE action_approvals"]
  Exitkod: 0
  ```
  Ingen tjänst startad, ingen installation, commit, push eller driftsättning utförd.


- **2026-10-06 (Story 1.2, KRAV-13 — det frysta v3-kontraktet ordagrant i repot):**
  `server/test/fixtures/leveranskontrakt-nvr-001-v3.ts` bär NVR-001:s frysta
  leveranskontrakt v3 (2026-09-07) tecken för tecken, framställt mekaniskt ur
  `$HOME/brain/03-Resurser/kunddokument/Nordic Vision Retail/Leveranskontrakt-NVR-001-FRYST-v3-2026-09-07.md`,
  rad 14 till slutet. Källa i Drive:
  `01_Kunder/Nordic Vision Retail/Fas 2/Leveranskontrakt-NVR-001-FRYST-v3-2026-09-07.md`;
  Drive-id `1NeHDvs26pipOSACQJAwgYdkbm1xcp-9-`, andrad `2026-09-07 18:23`,
  metod `ren text (text/markdown)`.
  sha256 `4daaea5f30ad8738a9d11e7ad51739f0cda684720641d5f695cb08c74bfe29d8`.
  Provet `server/test/uppdragsytan-v3-fixtur.test.ts` låser text, konstant och
  kommentar vid källans summa. Tre negativa kontroller finns. Formfixturen
  `leveranskontrakt-nvr-001.ts` är märkt SYNTETISK och dess text oförändrad:
  sha256 `763bca31183af6d74dff79edff647c73695745353e51ef5fa4676f2ce847b608`
  både före och efter. **KRAV-13 stängd 2026-10-06.** Kört: `sha256sum` och
  UTF-8-skript gav lika summor; identitetskontroll gav `true`. En planterad
  teckenändring gav rött, mekanisk återställning gav grönt och samma filsumma.
  `npm run typecheck` och `npm run build`: exit 0. `npm test` och
  `npx vitest run test/uppdragsytan-v3-fixtur.test.ts`: exit 1 före insamling,
  `Error: connect EPERM 127.0.0.1:5433 - Local (undefined:undefined)`.
  `npx tsx --no-cache` nekades också IPC-socket; samma installerade tsx-loader
  kördes med `TSX_DISABLE_CACHE=1 node --import tsx`, utan cache och databas:
  sex motsvarande kontroller godkända (exit 0). Inte kört: vitest-proven,
  inklusive befintliga tretton formprov; kedjan kör hela sviten efter sessionen.
  Ingen tjänst startad eller driftsättning utförd. Speglingen tar bort
  blanktecken i textens kanter (`dokument_index.py` skriv()); jämförelsen mot
  Drive-filens egen summa görs i Hermes importsteg (Story 2.5).

- **2026-10-06 (FR-1, beslut #194 — kontraktets baseline via godkännandekön):**
  `leveranskontrakt.ts` läser textens tillstånd, svensk Period, Ram/Timmar
  och leverabeltabeller förenade per kod med placering. Importtjänsten ger
  utkast en förhandsvisning utan domänskrivning, även utan signed_date, och
  köar fryst text som ett `satt_baseline`-förslag med actor och auditrad.
  Den tidigare skrivvägen (a)–(g) körs vid godkännandet; UPPDRAG får ramens
  ytterdatum och leverablerna behåller egna datum NULL med ärvt stegintervall.
  `explainApproval` fyller befintliga Att göra-kort med intervall, placering
  och avtalslänk; husets markup, tokens och fokusregler används oförändrade.
  Befintliga importsådder i testerna går nu via förslag + HTTP-godkännande.
  Nya prov i `uppdragsytan-import.test.ts` omfattar tabellformen, utkast utan
  skrivning, en köpost före baseline, agentspärr, auditrader och godkända
  leverabeldatum. API-kontraktet är uppdaterat. Ingen migration eller nya
  beroenden. **KRAV-13 återstår:** den angivna v3-speglingen finns inte i
  repot; originaltexten har begärts från uppdragsgivaren. Formprovet är
  uttryckligen syntetiskt och ersätter inte den ordagranna v3-fixturen.
  Typecheck och tester har inte körts i sessionen enligt uppdragets förbud;
  verifieringen lämnas till byggskriptet. Ingen commit eller deploy utförd.

- **2026-09-29 (FR-6, beslut #194 — fakturaräknarens flytt serialiserad):**
  astras fynd: `setInvoiceNumberSeries` läste räknaren utan lås, så två
  godkännanden kunde läsa samma gamla värde och en lägre flytt skriva över en
  högre, och en flytt kunde missa numret en pågående faktura just fått.
  `invoiceNumbering.ts` låser nu räknarraden (`lockSequence`: skapa-om-saknas +
  `SELECT … FOR UPDATE`) före kontroll och uppdatering — samma radlås som
  `nextDocumentNumber` tar vid fakturaskapande — och läser högsta nummer efter
  låset. `setExternalInvoiceNumbers` tar samma lås först. Ingen migration,
  inget kontrakt eller markup ändrat. Två kapplöpningsprov i
  `invoice-series-appendix.test.ts` (flytt mot flytt, flytt mot ny faktura).
  Kommandon kördes inte i sessionen — typecheck och tester körs av byggskriptet.

- **2026-09-29 (FR-3, beslut #194 — verksamhetsbeskrivningen auditloggas):**
  astras fynd: vyns `POST /app/c/:companyId/annual/description` gjorde en direkt
  `UPDATE companies` utan auditrad. Rutten kör nu `executeAction`
  (`set_business_description`, actor `human`) → `action.executed` i samma
  transaktion. Actionens schema tar `null` (tömmer beskrivningen) så vyns
  tomma fält behåller sitt beteende; vyn rensar även DEL (0x7f) som `safeText`
  avvisar. Ingen migration, ingen markup ändrad. Test i
  `annual-management.test.ts` (auditrad vid spara och vid tömning). Kommandon
  kördes inte i sessionen — typecheck och tester körs av byggskriptet.

- **2026-09-29 (FR-2 steg 2, beslut #194 — REST-API:ts lås och återföring via
  godkännandekön, FR-38):** astras återstående fynd efter steg 1: `PATCH
  /api/companies/:id/accounting/fiscal-years/:fyId` anropade `setFiscalYearLock`
  direkt och `POST …/accounting/vouchers/:id/reverse` anropade `reverseVoucher`
  direkt. Båda rutterna kör nu `executeAction` med `lock_period` resp.
  `reverse_voucher` (samma sensitive-actions som vyn/MCP) och svarar **202**
  `{ status: 'pending_approval', approval }` i stället för 200/201 — verkan
  uppstår först vid godkännande i Att göra; `already_reversed` (409) kommer
  därmed vid godkännandet av andra återföringen. `requireHuman` står kvar
  (agent får fortfarande 403, `actions.test.ts`). Ingen migration, ingen markup,
  inget nytt mönster. Tester: `accounting.test.ts` (återföring via kön, uppskjuten
  återföring — inget rättelseverifikat före godkännande, andra återföringen 409
  vid godkännande, uppskjuten låsning — året olåst och bokningsbart tills
  godkännande) och `bokslut.test.ts` (låset godkänns innan periodlåsprovet).
  Ej körd i sessionen (skriptet kör typecheck och tester efteråt).

- **2026-09-29 (FR-2 ur den frysta PRD:n, beslut #194 — bokslutsvyns lås via
  godkännandekön, FR-38):** astras kodgranskning gav FR-2 DELVIS: `POST
  /app/c/:companyId/annual/lock` anropade `setFiscalYearLock` direkt och gick
  förbi Att göra. Rutten kör nu `runViewAction(... 'lock_period', { fiscal_year_id,
  locked: true })` — samma sensitive-action som REST/MCP, köas och låser först
  när en människa godkänt; användaren skickas till Att göra. Oanvänd import av
  `setFiscalYearLock` borttagen ur vyroutern. Ingen migration, inget nytt
  mönster, ingen markup ändrad (knappen "Lås bokslut" står kvar). Test:
  `k2-annual.test.ts` — vy-POST ger redirect till approvals, året är olåst,
  pending `lock_period` med rätt input finns, godkännande låser. Ej körd i
  sessionen (skriptet kör typecheck och tester efteråt).

- **2026-09-28 (överlämning #302 / beslut #189 — S10.10: sidan Dokumenten på
  uppdragsytan, FR-43):** Davids ord 28/9: senaste versionen av varje underlag
  ska vara direkt tillgänglig ur projektytan, och all dokumentation som inte är
  raderad ska gå att se. Byggt: **migration 0076** med två CACHE-tabeller
  (`uppdrag_dokument` med `unique (company_id, project_id, kalla, extern_id)`,
  `kalla`-CHECK `'drive'|'valv'` och https-CHECK på länken enligt 0065:s mönster;
  `uppdrag_dokumentrot` med pk `(company_id, project_id)`), RLS/policyer och
  `GRANT SELECT/INSERT/UPDATE/DELETE` till `app` exakt som `uppdrag_svepvarde` i
  0068 — DELETE är kategorins innebörd och det som gör att "inte raderad" kan
  hållas sann. **`services/uppdragDokument.ts`**: zod-strict-schemat (bor i
  tjänsten, prejudikat `SvepIndataSchema`), `skrivDokumentforteckning` som
  ERSÄTTER projektets hela förteckning i en transaktion (upsert + DELETE av det
  som inte kom + upsert av roten; svar `{ project_id, antal, borttagna, last_nar }`;
  idempotent), `lasDokumentforteckning`, och familjeregeln som två rena funktioner
  (`familjenyckel`, `grupperaDokument`) — versions-, datum-, status-, kopie- och
  löpnummerled faller bara som EGNA led, allt annat hör till namnet. **Två
  registerposter:** `skriv_dokumentforteckning` (`write`, INTE `kravManniska` —
  källsystemets fakta, samma skäl som `kor_uppdragssvep`) och
  `las_dokumentforteckning` (`read`); båda faller ut som REST och MCP (FR-23).
  **Sidan** `/c/:companyId/projects/:projectId/dokumenten` via `pageFor`, och
  `UPPDRAGSSIDOR` fick `['dokumenten', 'Dokumenten']` sist efter Kontraktet —
  **elva** poster på alla uppdragssidor. Sidan bär husets `.panel`, `.log`,
  `.log-when`, `.log-what`, `.chip`, `.muted` och `.farskhet`; inga nya
  CSS-klasser, ingen JS (tidigare versioner i `<details>`), `target="_blank"
  rel="noopener"` på varje länk ut. Tomhetens två texter är skilda med flit:
  oläst förteckning ≠ tom mapp. Prov: `server/test/uppdragsytan-dokumenten.test.ts`
  ((a)–(g)) och menytestets förväntningar uppdaterade till elva poster i SAMMA
  bygge. **Verifiering:** sessionen körde inga kommandon själv (bygget kör
  typecheck och `npm test` efter sessionen) — utdatan i överlämningen är
  byggskriptets, inte en egen mätning. **Utanför repot, står rött tills det
  synkas:** den nya GET-rutten måste in i adresskontraktet (`navigation.v1.json`,
  kategori `c`, ägare `projects_list`) via generatorn i Davids valv — filen här är
  genererad och rördes inte. Hermes-skillen `dokumentforteckning.py` byggs av
  Cowork mot kontraktet i registret. `docs/MCP_ACTIONS.md` beskriver ännu inte de
  två nya åtgärderna — det låg utanför storyns avgränsning och bör läggas till.

- **2026-09-28 (överlämning #300 / beslut #188 — S10.9: handgreppen Påbörja och
  Godkänn på Leveranserna, LOC-419):** S3.4 byggde `paborja_leverabel` och
  `godkann_leverabel`, men båda bär `kravManniska` — en agent fälls med 403
  `human_required` före varje skrivning — så utan knappar i vyn kunde ingen
  utföra dem. Nu finns två POST-rutter i vyroutern,
  `…/projects/:projectId/leverabel/paborja` och `…/leverabel/godkann`, byggda
  exakt som `statusforslag`-rutten: `assertSameOrigin`, `parseCompanyId`/
  `parseApprovalId`, och `runViewAction` (actor `human`) — ingen egen SQL, ingen
  egen felhantering. Tomma valfria fält (`nar`, `notering`) UTELÄMNAS ur indatat;
  `kanal` skickas alltid, så ett tomt val fälls av åtgärdens enum i stället för
  att tystas. Båda leder tillbaka till uppdragets förstasida, som bär `felNotis`
  (Leveranserna har ingen och fick ingen). Knapparna bor på brädans
  leverabelkort: `ej_paborjad` får Påbörja, `levererad` får Godkänn med
  kanalvalet synligt och obligatoriskt (ett obligatoriskt fält i en hopfälld
  `<details>` går inte att fokusera) och tomt förstaval; `pagar`, `godkand` och
  `avvisad` får ingenting — en knapp som ger 409 är en knapp som ljuger.
  Datum/notering ligger i en hopfälld `<details>`; ingen ny CSS-klass, ingen JS.
  Sidtexten som sa *"Statusen flyttas aldrig på den här sidan"* var inte längre
  sann och säger nu var vart och ett av stegen görs. Provet
  `uppdragsytan-leveranserna.test.ts`: det gamla fallet "(d) sidan skriver
  ingenting" mäter numera rätt knapp per läge (förbudet mot `<form>`/`<button>`
  står kvar för tabelläget), och en ny svit (f) prövar de fem fallen ur storyn.
  **Utanför repot:** de två nya POST-rutterna måste in i adresskontraktet
  (`navigation.v1.json`, kategori `c`, ägare `projects_list`) via generatorn i
  Davids valv — filen här är genererad och rördes inte, så
  `~/.hermes/prov/adresskontraktet.py` står rött tills den synkats.

- **2026-09-24 (överlämning #291 / beslut #184 — privatekonomin som egen yta
  `/privat`; INGEN kod i detta repo):** Bygget bor helt i Hermes enligt
  `docs/ARKITEKTUR.md` (samma hemvist som svepet och provvakten) och var redan
  genomfört och driftsatt av Hermes byggslinga (`~/.hermes/privat-bygge/`, varv
  1–2) när sessionen började: `ytor_server.py` bär `/privat` som egen
  sidfunktion utan produktmeny, utan länk ut och utan JavaScript, plus
  manifestet och de två ikonrutterna; `brief_underlag.py` har linsen
  `privatekonomi` och avsnittet `## Hushållet`, `morgonbrief.py` tar in det
  ordagrant — allt bakom `HERMES_PRIVATEKONOMI=1`; `~/.hermes/prov/privatgransen.py`
  vaktar gränsen. Driftsättningens egen utdata 21:19:45: *"/privat skarp, 27 prov
  + privatgransen (GRON …) + briefproven gröna"*. **Sessionen ändrade en (1)
  rad kommentar** i `morgonbrief.py` vid `PRIVATA`: den påstod att
  hushållsfilen ligger i `FORBJUDET`. Det gör den inte — den ligger i
  `EJ_I_YTOR`. Skillnaden är inte kosmetisk: `FORBJUDET` **är** R5-gränsen,
  David avgjorde 2026-08-24 att privatekonomin inte är R5, och `r5_yta_acceptans.py`
  och `startsida_prov.py` härleder skyddade strängar ur listan — i varv 1
  fällde just den flytten en grön startsida, eftersom "privat" är fyra tecken
  och står legitimt på Hem ("privatekonomi"). Kommentaren var kvar som en
  inbjudan till nästa läsare att göra om felet; den pekar nu på rätt lista och
  på skälet. Varv 2:s andra fynd (köp utan budgetpost visar rått kategori-id)
  lämnades — kravet säger att de ska listas men inte räknas in, och det gör de.
  **I detta repo:** `server/kontrakt/navigation.v1.json` bar redan de fyra
  `/privat`-rutterna (kategori `e`, ingen ägare) sedan `bf782ce`, synkade av
  kravställaren; ingen annan fil i `/opt/redovisning` rördes och inga tester
  behövde skrivas — repot har ingen kod i bygget. Sessionen körde inga prov
  själv; siffrorna ovan är byggslingans egen loggade utdata, inte en egen
  mätning.

- **2026-09-24 (överlämning #289 / beslut #183 — de sista pixlarna i produktmenyn;
  följdbygge inom #182, endast `server/src/http/view/html.ts` + provet):** #182 gav
  menypanelen rätt FORM men inte hela höjdbudgeten: Hermes mätte efter release
  `20260924T195938Z-9eea6ae` 13 px dolt innehåll på 1440×900 och 26 px på
  1280×800 (2560×1440 låg redan på 0). Kanon fick därför samma tre mått som
  kopiorna (Hermes-ytan, ärendevyn `f7b26da`) där de bevisat ger 0 px:
  `.navmenu__link` får **egen** `line-height: 1.3` — den ärvda 1.55 från
  `body { font: 15px/1.55 }` gav 21 px text och 33 px rad för en länk som aldrig
  bryts (tre spalter à ~364 px), alltså luft INUTI raden där paddingen redan
  står; nu 30 px rad, långt över WCAG 2.5.8:s 24 px träffyta.
  `.navmenu__grp` går från `margin: 0 0 17px` till `0 0 11px` (nio grupper = åtta
  mellanrum, så varje sänkning betalar sig åtta gånger) och till **9 px** i
  `@media (min-width:1100px) and (max-height:880px)`, där hint-döljningen står
  kvar. `.navmenu__hint` får `margin: 0 0 4px` och `line-height: 1.35`. Allt från
  #182 står orört: taket `calc(100vh - 100% - 24px)`, bredden
  `min(1180px, calc(100vw - 48px))`, spalterna 3/2/1, 12-postersvillkoret,
  `background: var(--surface)`, navrise; `.navmenu` förblir opositionerad, ingen
  JavaScript, inga andra selektorer eller sidor.

  **Prov:** `server/test/appmenyn-hel.test.ts` — medieblockets fall SKÄRPTES från
  `margin-bottom: 11px` till `9px` (det var det enda provet som annars hade fällt
  bygget), och tre nya fall vaktar de nya värdena så att de inte kan falla
  tillbaka tyst: att länken har en EGEN `line-height` (utan den ärver den 1.55) och
  att radhöjden räknad ur reglernas egna `font-size`/`padding`/`line-height` är
  ≤ 34 px, att gruppluften är 11 px på hög skärm och 9 px på låg, och att hinten
  bär `margin: 0 0 4px` + `line-height: 1.35`. `oskarpa.test.ts` och
  `navigation.test.ts` asserterar inget av måtten och står orörda. Den
  geometriska mätningen (0 px dolt på 1280×800, 1440×900, 2560×1440, ljust och
  mörkt) görs som förut av Hermes rigg (`~/.hermes/ytor-gui/matvy.js`) efter
  deploy — provet vaktar reglerna, riggen mäter följden.

- **2026-09-24 (överlämning #288 / beslut #182 — produktmenyn i `/app` visar hela
  sitt innehåll; endast `server/src/http/view/html.ts`):** Menyn bär 50 länkar i
  nio grupper, och panelens tak var `min(72vh, 640px)`. På varje bärbar skärm
  betydde det inre rullning med hälften av valen under kanten. Kanon (html.ts)
  får nu samma utfall som Hermes-ytan och ärendevyn fick 24/9 (`f7b26da` där), och
  kanon är facit för kopiorna. Ändrat i CSS:en: taket är avståndet ner till
  skärmens nederkant, `max-height: calc(100vh - 100% - 24px)` — `100%` är
  **topbarens** höjd, eftersom `.navmenu` med flit är opositionerad och `.topbar`
  (sticky) därmed är panelens containing block; panelen är 1180 px bred
  (48 px-headroomen för rullisten behållen) och **helt täckande**
  (`background: var(--surface)`, alfa 1 i båda lägena) medan sidhuvudet behåller
  sina 97 %; rutnätet är `columns: 3` med två spalter under 1100 px och en vid
  ≤640 px; `@keyframes navrise` animerar bara transform (opaciteten togs bort —
  den gjorde panelen genomskinlig medan den steg); vid `min-width:1100px` och
  `max-height:880px` göms hintarna och gruppmarginalerna dras åt så att 1280×800
  räcker; vid ≤640 px tar panelen skärmens bredd (`margin: 0 8px; width:
  calc(100vw - 16px)`). I `layout()` får en grupp med **minst 12 poster** klassen
  `navmenu__grp--spalter` (två spalter inuti gruppen, eyebrow och hint
  `column-span: all`) — villkoret är antalet poster, aldrig ett gruppnamn, så
  nästa grupp som växer förbi gränsen får formen av sig själv. Inga nya
  tokenvärden, ingen JavaScript, snabbraden/grannmodulerna/`.nav__here`/
  brödsmulan orörda.

  **Prov:** nytt `server/test/appmenyn-hel.test.ts` (19 fall) mäter kontraktet i
  den CSS och den markup som faktiskt levereras — taket, att `.navmenu` förblir
  opositionerad (hela måttet vilar på det), bredden, spalterna per brytpunkt,
  täckningen, att navrise saknar opacity, reduced-motion, telefonläget, och
  **härlett** att formen följer antalet poster i varje grupp, med negativa
  kontroller som visar att granskaren ser fyndet när det finns.
  `server/test/oskarpa.test.ts` uppdaterad, inte försvagad: panelens fall
  förväntar nu alfa 1 i stället för 97 %, och granskaren räknar en bakgrund utan
  `color-mix` som 100 % opak — annars hade vägen runt regeln varit att ta bort
  genomskinligheten och behålla filtret. Ny negativ kontroll för just den vägen.

  **Kört i sessionen:** inga kommandon (byggskriptet kör typecheck + tester efter
  bygget) — **inga siffror påstås här**. Mätningen av utfallet (0 px dolt innehåll
  i 1280×800, 1440×900, 2560×1440; en spalt och rullbar till sista länken i
  390×844) görs av Hermes egen rigg `~/.hermes/ytor-gui/matvy.js` efter deploy via
  `redovisning_update.sh`, och `~/.hermes/prov/designparitet.py` ska vara grön
  efter deploy. Repot fick medvetet ingen egen mätrigg — den fanns redan.

- **2026-09-23 (överlämning #286 / beslut #177 + #179 — stängning av #268 via
  beslut #174: VERIFIERING + journal, ingen kod ändrad):** Beslut #177 innehåller
  **inget nytt bygge**. Frågan i #177 var om överlämning #268 kunde stängas som
  klar via beslut #174; CTO-svaret i beslutsloggen (23/9 13:36) var *"Stäng …
  inget ytterligare bygge"*, och Davids "Ja" i #179 svarar på metafrågan (ska
  bygget köras) så att byggvakten släpper ärendet — det är inte en beställning av
  ny funktion. Verifieringen mot main faller inte i någon punkt: merge `2916d1b`
  är förfader till HEAD, migration `0073_uppdrag_anteckning.sql` (append-only:
  ENABLE + FORCE RLS, endast SELECT/INSERT-policy, `GRANT SELECT, INSERT` rad 78,
  sammansatt FK mot `contracts (id, company_id)`), tjänsten
  `services/uppdragAnteckning.ts:76,113`, åtgärden `skriv_uppdragsanteckning`
  med `kravManniska: true` (`actions/registry.ts:2015,2025`, spärren i
  `execute.ts:57`), panelen **Övrigt** på Läget
  (`http/view/routes.ts:4145,4194,4223`) och 17 prov i
  `test/uppdragsytan-anteckning.test.ts`. Minsta-ändring-regeln gör därmed att
  ingen rad kod rörs: diffen mot main rör bara `docs/byggen/beslut-177.md` och
  den här filen — noll ändringar under `server/`.

  **Värt att veta för nästa session:** panelen Övrigt är byggd och stängd. En ny
  funktion där (redigering, notiser, automatik som gör en rad till tillägg eller
  scopesignal) är uttryckligen utesluten ur #174 och kräver ett eget beslut av
  David. Byggvakten ändras inte för att tolka fritext-svar — det var också
  uteslutet.

  `npm run migrate`/`npm test`/`npm run build` kördes INTE i sessionen
  (byggskriptet kör dem, och 0073 migrerades redan i #174) — **inga siffror
  påstås här**. Blir någon körning röd gäller ACCEPTANS-linjen: stängningen av
  #268 står kvar som inte klar tills det är utrett som ett eget beslut.

- **2026-09-22 (överlämning #272 / beslut #178 — kvittobilagor: `receipt_files`
  + tre åtgärder + signerad PUT utanför MCP):** Alla 60+ bokförda kvitton hade
  `file_id: null` — inte av slarv, utan för att ingen väg in fanns: base64 genom
  MCP är omöjligt (1,3 MB bild ≈ 1,7 M tecken) och MCP-servern ser inte filerna
  som ligger i Anthropics container. Byggt: migration **0075** (`receipt_files`,
  flera rader per kvitto, RLS + GRANT enligt husmönstret, DELETE-policy som
  aldrig släpper en AKTIV bilaga på ett bokfört kvitto, trigger
  `receipt_files_write_once` som bara tillåter att `superseded_by` sätts en
  gång); lagringsgränssnittet `services/objektlagring.ts` med **en** drivrutin
  (lokal katalog ur `config.RECEIPT_FILES_DIR`); HMAC-signerade engångslänkar
  (`lib/bilagesignatur.ts`, nyckel härledd ur `JWT_SECRET`, node:crypto, inga
  nya paket); tjänsten `services/receiptFiles.ts`; de osignerade byte-vägarna
  `PUT|GET /api/receipt-files/:fileId/content` (utanför `authenticate` —
  signaturen ÄR behörigheten, tenant/RLS/audit gäller ändå); åtgärderna
  `create_receipt_upload_url`, `confirm_receipt_file` (valfritt
  `ersatter_file_id` = rättelsevägen), `get_receipt_file_url`, alla `write` som
  `create_receipt`; `list_receipts` bär `attachments`/`attachment_count`/
  `primary_attachment_id`; `delete_draft_receipt` städar utkastets bilagerader
  och objekt; lat städning av obekräftade rader i tjänstens egna anrop (ingen
  scheduler i redovisningen); hård 60 s-timeout på MCP-serverns fetch-anrop med
  begripligt fel. Prov: `server/test/kvittobilagor.test.ts`.

  **Värt att veta för nästa session:** byte-vägen är den enda muterande
  HTTP-vägen i systemet UTAN JWT. Den vilar på beslut #178:s KRAV-4 (bytesen kan
  inte gå genom `executeAction` — det är hela poängen med bygget) och följer
  samma undantag som den äldre multipart-uppladdningen, som inte heller går via
  action-lagret. Den är INTE fri prejudikat för nya ytor: en ny osignerad väg
  kräver ett eget beslut av David. `docs/ARKITEKTUR.md` är orörd — säger David
  att undantaget ska stå skrivet där är det hans beslut att fatta, inte
  sessionens.

  **Två saker David måste göra för att det ska fungera skarpt:** sätta
  `PUBLIC_API_URL` (publikt nåbar bas-URL) och `RECEIPT_FILES_DIR`
  (`/opt/redovisning-app/shared/receipt-files`) i shared/.env, samt köra
  `npm run migrate` via `redovisning-deploy`. Utan `PUBLIC_API_URL` ger
  `create_receipt_upload_url` ett tydligt fel — aldrig en localhost-URL som tyst
  inte går att nå.

  **Medvetna avsteg, båda av kravbilden själv:** (1) `receipts.file_id` ligger
  KVAR orörd och pekar fortfarande in i `files` (FK) — en `receipt_files`-rad
  kan inte skrivas dit utan en schemaändring på `receipts`, som avgränsningen
  förbjuder. Den "primära bilagan" HÄRLEDS därför i läsvägen
  (`primary_attachment_id`) i stället för att dupliceras i en kolumn. (2) Vyns
  kolumn *Underlag* på `/app/c/:id/receipts` läser fortfarande bara `file_id`
  (multipart-vägen) — uppladdnings-UI och miniatyrer i verifikatvyn är
  uttryckligen uteslutna ur beslut #178 och är ett eget bygge.
  `npm test`/`npm run build` kördes INTE i sessionen (byggskriptet kör dem) —
  inga siffror påstås här.

- **2026-09-21 (överlämning #271 / beslut #65 — Linear-datat tillbaka i
  ärendeplattformen: VERIFIERING + journal, ingen kod ändrad):** Kravspecen
  gäller ett annat repo (`/opt/arenden`) och står på verifiering + skarp körning
  + journalföring. **Verifieringen faller inte i någon punkt** — KRAV-1 till
  KRAV-5 är redan byggda där: `priority` (CHECK 1–4) och `due_date` i
  `migrations/0003_arenden.sql:36-38`; `foralder_id` med självförälder-CHECK och
  cykelspärrtrigger i `0007`; `issue_relations` med typ-CHECK och symmetriskt
  unikt index i `0008`; `issue_attachments` med `UNIQUE (issue_id, url)` och
  `GRANT SELECT, INSERT` i `0009`; återläsaren `src/import/aterlasLinear.ts` som
  skriver ENBART via `executeAction` (aktör `system/linear-aterlasning`),
  validerar hela prioritetsskalan mot `priorityLabel` före första skrivningen och
  är idempotent via `bara_om_osatt` + `source_ref`-uppslag. Grepet i ACCEPTANS
  bekräftat: **noll** `INSERT/UPDATE/DELETE` och **noll** `client.query` i
  `aterlasLinear.ts`. Minsta-ändring-regeln gör därmed att ingen kod rörs; diffen
  rör bara `docs/byggen/beslut-065.md` och den här filen.

  **KVAR, och görs av David — inte av en session:** KRAV-6:s skarpa körning
  (`npm run aterlas -- --fas falt|hierarki|relationer|bilagor`) och ACCEPTANS
  `npm run check` i `/opt/arenden`. `docs/ARKITEKTUR.md:47` lägger handgrepp mot
  produktionsdatan hos David, byggreglerna säger "kör inga kommandon", och skalet
  i den här miljön är låst till `/opt/redovisning` — siffror utan körning vore
  just den falska statusrapport CLAUDE.md-regel 2 förbjuder. Körordningen och de
  väntade talen (192 prioriteter / 8 deadlines / 121 föräldrar / 71 relationer
  varav 5 `blocks` / 50 länkar på 28 ärenden) står i byggjournalen. Körningen är
  ofarlig att upprepa: omkörning ändrar noll rader. `--fas milstolpe` ska INTE
  köras — de 28 milstolparna är uttryckligen uteslutna ur beslut #65.

- **2026-09-21 (överlämning #270 / beslut #62 — typsnittsparet: VERIFIERING av
  ett redan mergat bygge, plus byggjournalen som aldrig skrevs):** Kravspecen
  beskriver ett bygge som **redan är gjort och mergat till main** — commit
  `e047a05` (2026-08-26, "R-1, D-4, D-5, H-2"), som är förfader till HEAD. Den
  la de fem woff2-filerna, de två OFL-licenserna, vitlisterouten i `app.ts`,
  `@font-face`-blocken och de tre variablerna i `html.ts`, samt provet
  `server/test/typsnitt.test.ts`. **Ingen kod är ändrad i den här sessionen:**
  varje KRAV står uppfyllt i HEAD, och minsta-ändring-regeln gör att ett bygge
  ovanpå ett uppfyllt krav vore ett bygge utöver källan. Diffen rör ENBART den
  här filen.

  **Det som faktiskt saknades var journalen.** `e047a05` rörde `docs/STATUS.md`
  med **en** rad (provräknaren 743/89 → 780/94) och skrev ingen sessionsloggspost
  alls. Avsteget från Davids ordagranna svar levde därmed bara i
  commit-meddelandet och i en CSS-kommentar — inte där en ny session läser.
  Kravspecens KALLA säger uttryckligen att tolkningen "ska stå i byggjournalen";
  det är den meningen den här posten infriar.

  1. **Avsteget, öppet: Roboto valdes BORT.** Davids ord (#270/#62) var *"Roboto
     och skrivmaskinsstil"*. Skrivmaskinsstilen blev **IBM Plex Mono** (IBM
     Selectric-släkten). Men **Roboto står namngiven i antimönster 1** i
     `brain/03-Resurser/kunskap/impeccable-design-skills.md`, och ersattes av
     **Public Sans** (US Web Design System, byggd för tät data) som lugn brödtext.
     Det är ett tolkningsval gjort MOT bokstaven i Davids svar — se
     "Kvarstår för David" nedan.
  2. **Självvärdat betyder noll externa anrop.** Filerna ligger i
     `server/assets/typsnitt/` och serveras på `GET /typsnitt/<fil>` bakom en
     **uppräknad** vitlista (sju namn i en `Set`) — aldrig en regex över filnamn,
     som är ett skydd som går att lura. Katalogen ligger bredvid `dist/`, inte i
     den: `tsc` kopierar inte binärfiler, och en katalog som försvinner vid bygge
     hade gjort ytan typsnittslös utan att något sa något.
  3. **CSP:n är orörd, med flit.** `defaultSrc 'self'` och ingen egen `font-src`
     ⇒ `font-src` **ärver** `'self'`. Att lägga till en rad hade varit att ändra
     säkerhetsläget för att lösa ett problem som inte fanns.
  4. **En laddad familj är inte en använd familj.** Det är felet som går sönder
     tyst: en `@font-face` som hämtas men aldrig refereras ser identisk ut i
     koden, i allt utom på skärmen. Därför mäter provet att `h1`–`h3` bär
     `var(--display)` och brödtexten `font: 15px/1.55 var(--sans)` — inte bara
     att variablerna är deklarerade.
  5. **Fallbacken är kvar med flit.** `--sans`/`--mono`/`--display` slutar alla
     på `sans-serif`/`monospace`: går woff2-hämtningen fel ska ytan bli **ful,
     inte oläslig**.

  **Grind:** `npm test` och `npm run build` kördes INTE i den här sessionen
  (körs av körskriptet efteråt) — utfallet ska klistras in här innan bygget
  stängs. Kontrollen här var statisk läsning av HEAD, KRAV för KRAV: fem woff2
  på plats (magiskt byte `wOF2` verifierat på filerna, 14,5–15,6 kB styck) och
  båda licensfilerna med strängen *SIL Open Font License* (KRAV-1, KRAV-2);
  `font-display: swap` på alla fem `@font-face`, och **samtliga** `url()` i
  hela stilmallen pekar inåt — fem `/typsnitt/…` plus en `data:`-URI, noll
  `http(s)://` (KRAV-3); de tre variablerna på `html.ts:437–439` och deras
  användning på `:518` och `:755–757` (KRAV-4); förstanamnen är "Public Sans"
  respektive "IBM Plex Mono", alltså ingen av de sex förbjudna (KRAV-5). Inget
  `express.static` finns i `server/src/` — vitlisterouten är enda vägen till en
  statisk fil. `e047a05` själv redovisar körd bevisning: *"Svit: 94 filer, 780
  prov, exit 0"* och okulärt *"Mätt i webbläsare: båda familjerna laddade,
  svenska tecken renderas i dem (ä har samma teckenbredd som a i Plex Mono,
  24.0 px monospace)"* — det är den körningen ACCEPTANS okulära led vilar på,
  inte en körning i den här sessionen.

  **Kvarstår för David — ett smakbeslut, inte en bugg:** vill du ha **bokstavligt
  Roboto** trots att den står i antimönster 1, så är det `--sans` (och provets
  antimönsterlista) som ska ändras — alltså KRAV-4 och KRAV-5, ingenting annat.
  Säger du inget står Public Sans kvar. Preload-/prestandahintar, kursiva eller
  variabla vikter, typsnittsval per sida eller tema och de tre förslagen att
  välja mellan är medvetet uteslutna — källan kräver dem inte. Inget att migrera
  och ingenting att köra.

- **2026-09-21 (överlämning #269 / beslut #58 — bilageradens väg TILLBAKA till
  tidposten):** Ledet tidpost → faktura fanns redan (`time_entries.invoice_id`,
  migration 0062, satt av `lasTidposterTillFaktura`). **Motriktningen saknades:
  en rad på en tidsbilaga var en kopia av en tidpost — datum, beskrivning,
  debiterbara minuter — utan pekare tillbaka till raden den kopierades ur, så
  kedjan kund → projekt → tidpost → faktura bara gick att sluta genom att gissa
  på kund+datum.** Byggt: **migration 0074** (additiv, idempotent —
  `invoice_appendix_rows.time_entry_id uuid REFERENCES time_entries(id) ON
  DELETE SET NULL`, nullbar, ingen backfill, `COMMENT ON COLUMN` som säger vad
  NULL betyder), **`time_entry_id` i `AppendixRowInput` + i den enda
  INSERT-satsen** (`services/invoiceAppendix.ts`), och **ifyllnaden ur de LÅSTA
  posternas egna id:n** i båda per-datum-mappningarna. **Ingen ny tabell, ingen
  ny åtgärd, ingen ny tjänstefil, inget nytt beroende, inget ändrat
  action-schema, ingen ändrad vy, inget ändrat API/MCP-svar, ingen ändrad
  auditlogg, ingen backfill.** Diffen rör `migrations/0074_bilagerad_tidpost.sql`
  (ny), `services/invoiceAppendix.ts`, `services/invoiceFromTime.ts`,
  `server/test/faktura-ur-tid.test.ts` och den här filen.

  1. **Enkel FK, inte husets komposit-FK (0047/0062/0065) — med skäl.**
     `ON DELETE SET NULL` på `(time_entry_id, company_id)` hade nollställt även
     `company_id`, som är NOT NULL: raderingen av en tidpost hade fällt hela
     satsen. Tenant-säkerheten bärs i stället av RLS på båda tabellerna plus av
     att värdet ALDRIG kan komma någon annanstans ifrån än
     `valjOchLasTidposter`-resultatet inuti samma tenant-transaktion.
  2. **Fältet är aldrig indata (KRAV-3).** Inget zod-schema i registret ändrades,
     så `.strict()` fäller ett inskickat `time_entry_id` med 400
     `validation_error`. En handskriven bilaga (`bypass_time_entries` med skäl),
     en utläggsbilaga och en kategoribilaga ger alla rader med NULL — en bilaga
     som inte låst en tidpost får inte kunna PÅSTÅ att den gjort det.
  3. **Kategoriraden får NULL med flit.** `per_avtalsdel`-bilagan är en summa
     över flera poster; att peka på den första hade varit en gissning som ser ut
     som ett faktum.
  4. **Öppet redovisat — kravspecen har fel på en punkt.** KRAV-2 säger att
     `create_invoice_from_time` får ifyllnaden "gratis via den enda funktionen".
     Det stämmer för INSERT-satsen (`setInvoiceAppendix` är enda skrivstället),
     men rad-mappningen finns på TVÅ ställen: `appendixFromTimeEntries`
     (`invoiceAppendix.ts`) och `createInvoiceFromTime` (`invoiceFromTime.ts:230`,
     per_datum-läget) — den senare anropar `setInvoiceAppendix` direkt och går
     inte via `appendixFromTimeEntries`. KRAV-4 mäter uttryckligen
     `create_invoice_from_time`, så båda mappningarna fick fältet. Det är en rad
     i `invoiceFromTime.ts` utöver avgränsningens uppräkning, och utan den hade
     KRAV-4 varit ogenomförbart.
  5. **Vyerna är orörda (avgränsningen).** `fakturalankSaknas()` i
     `http/view/routes.ts` står kvar ordagrant, inklusive sin kommentar från
     25/8 som numera är delvis förlegad (den skriver att
     `appendixFromTimeEntries` inte sparar vilken faktura det blev — 0062 gjorde
     det). R-2:s sista led är ett senare bygge; att skriva om texten nu vore en
     ändring källan inte kräver.

  **Grind:** `npm run migrate`, `npm test` och `npm run build` kördes INTE i den
  här sessionen (körs av körskriptet efteråt) — utfallet ska klistras in här
  innan bygget stängs. `server/test/faktura-ur-tid.test.ts` utökades (ingen ny
  fil, husets mönster) med sex prov: **(a)** kolumnens form läst ur katalogen
  (nullbar, uuid, FK mot `time_entries`, `confdeltype = 'n'`) OCH beteendet —
  raderas tidposten står bilageraden kvar med NULL i stället för att dra
  fakturans underlag med sig; **(b)** KRAV-4 åt båda håll på samma rader:
  varje bilagerad bär EXAKT den post dess minuter kom ur, och just den posten
  bär fakturans id, medan den `exclude_entry_ids`-undantagna posten finns på
  ingen rad och bär ingen faktura; **(c)** samma koppling på den andra
  anropsvägen (`invoice_appendix_from_time_entries` mot ett befintligt utkast);
  **(d)** handskriven tidsbilaga → NULL på varje rad; **(e)** utlägg, kategori
  och `per_avtalsdel`-bilagan → NULL, med låsningen oförändrad; **(f)** ett
  inskickat `time_entry_id` fälls av strict-schemat (400 `validation_error`) och
  varken bilagerad eller låsning uppstår. Fältet läses med ägarrollen —
  `get_invoice_appendix` exponerar det inte, och API-svaret står orört.

  **Kvarstår för David:** kör `npm run migrate` en gång (0074). Backfill av
  historiska bilagerader, visningen av länken faktura → tidpost i vyerna (R-2:s
  sista led), `time_entry_id` i `getInvoiceAppendix`/API-svaret, komposit-FK,
  index på kolumnen och härledning ur kund+datum för gamla rader är medvetet
  uteslutna — källan kräver dem inte.

- **2026-09-21 (uppdragsytan, överlämning #268 — panelen Övrigt: anteckningsloggen
  per uppdrag):** Småuppdragen (ILT) sägs i förbifarten, görs samma dag och levde
  sedan i mejl och i huvudet. **Det som inte har en plats i systemet finns inte
  den dag ett tillägg ska skrivas** — och då är frågan "gjorde vi det här innanför
  eller utanför avtalet?" en minnesövning. Byggt: **migration 0073** (additiv,
  idempotent — tabellen `uppdrag_anteckning` med sammansatt FK mot
  `contracts(id, company_id)`, CHECK mot tom text och 2 000-teckenstaket,
  `utanfor_avtal boolean NOT NULL DEFAULT false`, `skriven_av` → `users`,
  tabellkommentar ÄGD, index `(company_id, contract_id, created_at)`, RLS
  SELECT/INSERT via `app_has_company_access` och `GRANT SELECT, INSERT` till
  `app` — aldrig UPDATE, aldrig DELETE), **tjänsten
  `services/uppdragAnteckning.ts`** (`skrivUppdragsanteckning` +
  `listaUppdragsanteckningar`), **åtgärden `skriv_uppdragsanteckning`** (`write` +
  `kravManniska`, strict zod) och **panelen Övrigt på Läget** med sin POST-rutt.
  **Ingen ny CSS-klass, ingen ny vy eller rutt utöver panelens POST, inget nytt
  beroende, ingen JS, ingen ändrad känslighet, ingen befintlig tabell, åtgärd
  eller yta ändrad.** Diffen rör `migrations/0073`, `uppdragAnteckning.ts` (ny),
  `actions/registry.ts`, `http/view/routes.ts`, `server/test/uppdragsytan-anteckning.test.ts`
  (ny), `docs/MCP_ACTIONS.md` och den här filen.

  1. **Människans egna ord, aldrig systemets** (0072:s princip). Åtgärden bär
     `kravManniska`, så ett agentanrop fälls med 403 `human_required` FÖRE varje
     skrivning. Underlagets ord var "kraver_manniska"; kodens konstant heter
     `human_required` (`execute.ts:57`) och det är den som gäller — samma spärr,
     rätt namn. Ingen AI-rad, ingen svepobservation, ingen kö: `write` och inte
     `sensitive`, för att köa Davids egen anteckning för Davids eget godkännande
     vore ett handgrepp utan innehåll (samma skäl som `satt_bedomning`).
  2. **Append-only i rättigheterna, inte i en konvention.** `app` har SELECT +
     INSERT och ingenting annat — samma tre försvarslinjer som `audit_log` (0003)
     och `uppdrag_bedomning` (0068). En anteckning som är underlag för ett tillägg
     är värdelös om den kan putsas i efterhand; nästa rad rättar.
  3. **Aldrig en tyst tom rad, i tre lager.** Tom text fälls av zod (400
     `validation_error`), blanktecken av tjänsten (400 `tom_anteckning`, med ett
     begripligt svenskt besked) och båda av 0073:s CHECK för kod som inte går
     genom tjänstelagret. Vyn skickar texten OTRIMMAD med flit, så en blank ruta
     möts av tjänstens egna ord i stället för den generella formulärtexten.
  4. **Räkningen avser flaggade rader TOTALT**, som överlämningens exempel, och
     står i klartext i panelhuvudet ("2 rader gäller arbete utanför avtalet") —
     aldrig en naken siffra. Någon "behandlad"-status finns inte och ska inte
     finnas: loggen är append-only och ingenting i den drivs vidare automatiskt.
     Är ingen rad bockad sägs DET; ett tomt chip hade sett ut som ett svar ingen
     gett.
  5. **Full bredd under de fem korten, i husets `.log`.** En logg är löpande text
     och läses inte i en 298px-kolumn, så panelen ligger under rutnätet och stjäl
     ingen plats från FR-18:s fem delar. Kronologikomponenten är den som redan bär
     revisionsloggen, notiserna, CRM-anteckningarna och Rapporterna — noll ny CSS.
     Markeringen bär färg, form OCH ord (`.chip--info`, glyf, *Utanför avtalet*),
     och `white-space:pre-wrap` behåller radbrytningarna människan själv skrev.
  6. **Fälten före knappen** (KRAV-3): texten, bocken och meningen om att raden
     inte går att ändra står alla ovanför *Lägg till*. Läget fick dessutom sin
     `felNotis(req)` — utan den hade en avvisad rad varit en tyst omladdning.
  7. **Öppet redovisat:** `docs/ARKITEKTUR.md` är INTE ändrad (kravspecens
     avgränsning). Modulsektionens uppräkningar där är dock redan efter kedjan —
     den skriver "migrationerna 0068–0071" och saknar `paborja_leverabel`/
     `godkann_leverabel` sedan S2.1, och nu även 0073 och
     `skriv_uppdragsanteckning`. Bygget ryms i namnrymden (`uppdrag_*`,
     `services/uppdrag*.ts`, åtgärd i registret), så ingen invariant bryts — men
     att rätta uppräkningen är en ändring i det styrande dokumentet och hör till
     beslutskön enligt ändringsregeln, inte till ett enskilt bygge.

  **Grind:** `npm run migrate`, `npm test` och `npm run build` kördes INTE i den
  här sessionen (körs av körskriptet efteråt) — utfallet ska klistras in här innan
  bygget stängs. Ny svit `server/test/uppdragsytan-anteckning.test.ts`: **(a)**
  registret (`write` + `kravManniska`), agentanropet → 403 `human_required` med
  auditloggen, tabellen och kön ORÖRDA, samma anrop som människa igenom, schemat
  strikt åt båda hållen (`skriven_av`, ett okänt fält och en saknad text fälls),
  tom och blank text, och `contracts.notes` oförändrat efter en skrivning;
  **(b)** UPDATE (text och bock) och DELETE som rollen `app` → `permission
  denied` med raden kvar byte för byte, plus CHECK:en prövad förbi tjänstelagret;
  **(c)** grannbolaget — åtgärden 404, RLS fäller den råa INSERT:en, listan tom,
  vyns GET och POST 404 medan grannen når sitt eget uppdrag; **(d)** rundturen ur
  #268:s "Klart när" — formuläret → 302 tillbaka till Läget → raden synlig med
  datum, avsändare och markering, och panelen BYTE FÖR BYTE identisk efter
  omladdning — nyast överst, räkningen på två av tre flaggade, en ensam obockad
  rad utan markering och utan räkning, tomläget med vad tomheten betyder och
  formuläret kvar, fältordningen (textarea → bock → varningen → knappen), ingen
  `<script>`, avtalsväljaren på uppdraget med två avtal mot dolt fält på det med
  ett, och en blank rad i formuläret som ger en SYNLIG notis och ingen rad.

  **Kvarstår för David:** kör `npm run migrate` en gång (0073). Panelen ligger
  sist på Läget. Redigering och radering av rader, automatik som gör en rad till
  tillägg eller scopesignal, AI- eller agentskrivna rader, godkännandekö för
  anteckningar, notiser på utanför-avtalet-rader, återanvändning av CRM:s
  `party_notes` (0033 har DELETE för GDPR och är nycklad på part) och ett nytt
  fält på avtalsdelarna är medvetet uteslutna — källan kräver dem inte.

- **2026-09-21 (LOC-355 verifierad i DRIFT; navmenyfixen från 14/9 portad till
  main; beslut #163 stängt):** Davids fråga 18/9 var inte "är buggen behandlad"
  utan "finns fixen i min drift och inte bara i repot". Kontroll 2026-09-21
  10:46 UTC på david-brain: tjänsten `redovisning` (MainPID 2688865, startad
  2026-09-14 08:58 UTC, `WorkingDirectory=/opt/redovisning-app/current/server`,
  `current -> releases/20260913T115626Z-aef30fc`, `/health` på 127.0.0.1:3001 =
  `{"status":"ok"}`). aef30fc har merge 4b004f9 (beslut #107, LOC-355) som
  förfader; releasens `payroll.ts` bär `GROSS_METHOD_FROM_PERIOD = '2026-09'`.
  Driftdatabasen (5434) har 72 migrationer applicerade, inklusive `konto_2731`
  (0067). Septemberlönen (~25/9) bokförs alltså med bruttometoden. **Macens
  lokala installation är INTE drift:** HEAD a3e51fe, senast pullad 2026-09-02,
  132 commits efter origin/main, 4b004f9 saknas, ingen 0067. Driftläget ovan är
  rättat — det sade sedan 25/8 att David kör skarpt på Macen, och det var den
  premissen som fick #163 att peka på fel maskin. Två fynd på vägen:
  (1) **Navmenyns klippningsfix från 14/9 låg enbart i releasekatalogen**
  (`current/server/src/http/view/html.ts` patchad på plats 14/9 08:58, backup
  `.fore-navmeny`) och i #163:s UTKAST-gren — inte på main. Nästa deploy hade
  återinfört klippningen. Portad till main i commit före denna, byte för byte
  identisk med releasen; typecheck grönt, `webbmeny` + `hem-landningar` 21/21.
  (2) **Driftdatabasen bär testrester:** 2 717 bolag och 2 652 användare
  skapade 7/9 (14:57–18:37) och 10/9 (14:26–20:29) med vitest-fixturernas namn
  (Grannbolaget AB, Främmande AB, Tomma Holding AB, Utan orgnr AB …) i
  databasen `redovisning` på 5434 — inte i `redovisning_test` på 5433 dit
  `test/env.ts` pekar. Källan är inte funnen: ingen `TEST_DATABASE_URL` i
  någon konfiguration, crontab eller skill. Locollabs riktiga data (c1ef13b6,
  217 verifikat, löner 2026-03–2026-08) är orörd. Städning är en radering i
  produktionsdata och görs inte utan Davids ja; backup tas först. #163:s gren
  `cto/r-tta-verl-mning-103-till-25-9-och-kompl-163` raderas: UTKASTET bar 30
  ovidkommande filer ur den delade arbetskopian och `// @ts-nocheck` i två
  prov, och dess enda egna innehåll (datumrättelsen i #103) är gjord här.

- **2026-09-07 (uppdragsytan S2.1, våg 1 — skalans två saknade övergångar):**
  `bekrafta_statusbyte` (S3.2) var enda skrivvägen till
  `uppdrag_leverabel.status` och flyttade bara `pagar` vidare. **`ej_paborjad →
  pagar` och `levererad → godkand` hade alltså ingen kodväg alls — och utan den
  sista kunde ingen leverabel bli `godkand`, alltså kunde inget uppdrag avslutas
  med en TOM öppna-lista (FR-8), hur färdigt det än var.** Byggt: **migration
  0072** (additiv, idempotent — `kanal` med CHECK som speglar zod-enumen, och
  `notering`, båda nullbara på `uppdrag_leverabel_handelse`), **två åtgärder
  `paborja_leverabel` och `godkann_leverabel`** (`write` + `kravManniska`) och
  **`paborjaLeverabel`/`godkannLeverabel` i `services/uppdragStatus.ts`** efter
  `bekraftaStatusbyte`-mönstret: `FOR UPDATE` före statuskontrollen, EN händelse
  + statusen + `koaRegisterkopia` i samma transaktion. `revision` är alltid NULL
  (varken påbörjande eller godkännande är en överlämning), mottagaren läses ur
  avtalets `godkannare` (409 `saknad_mottagare`, FR-13) och `nar` får
  bakåtdateras men aldrig till framtiden (400 `framtida_datum`) eller före
  avtalets `signed_date` (400 `fore_avtalet`). **Ingen ny tjänstefil, ingen ny
  vy, ingen ny CSS, inget nytt beroende, ingen ändring i `bekrafta_statusbyte`,
  `avsluta_uppdrag`, svepet eller schemat i övrigt.** Diffen rör
  `services/uppdragStatus.ts`, `actions/registry.ts`, `migrations/0072`,
  `test/uppdragsytan-statusbyte.test.ts`, `docs/MCP_ACTIONS.md` och den här filen.
  **Öppet redovisat:** KRAV-8(a) skriver "fyra händelserader", men kedjan i samma
  mening (`ej_paborjad→pagar→levererad→godkand`) har TRE övergångar och ger tre
  rader — provet kräver tre, och en fjärde hade krävt ett steg källan inte
  namnger. **Grind:** `npm run migrate`, `npm test` och `npm run build` kördes
  INTE i den här sessionen (körs av körskriptet efteråt) — utfallet ska klistras
  in här innan bygget stängs. Provfilen utökades (ingen ny fil) med 0072:s form
  och idempotens, agentspärren på båda åtgärderna, `.strict()` åt båda hållen
  (inget statusfält, ingen mottagare, ingen kanal på påbörjandet, obligatorisk
  kanal på godkännandet), hela skalan i tre steg med transmittalfälten rad för
  rad, båda 409-lägena, saknad mottagare (även blanktecken), tenantgränsen,
  bakåtdateringens tak och golv, triggern på ett avslutat uppdrag, och till sist
  storyns bevis: alla leverabler genom hela skalan ⇒ `avslutat_med_oppna` är TOM
  (`{}`), inte NULL. **Kvarstår för David:** kör `npm run migrate` en gång (0072).
  Knappar eller vyändringar för de två stegen, automatisk statussättning ur tid/
  svep/Drive, ångra-övergångar från `godkand`/`avvisad` och revisionsräkning i de
  nya händelserna är medvetet uteslutna — källan kräver dem inte.

- **2026-09-07 (uppdragsytan S10.8 — undermenyn på projektsidan och de äldre
  sidorna; rättelse av S10.7):** S10.7 gav `.subnav` till **fyra** sidor — Läget,
  Leveranserna, Pengarna och Rapporterna. Kvar utan meny stod ingången —
  projektsidan, dit Projekt-listan länkar — samt Avtal, Bedömning och Signaler
  (byggda före menyn fanns) och Planen och Kontraktet, som stod som poster i
  menyn utan att själva bära den. På telefon (≤700 px döljer `.nav__quick`)
  betydde det ingen väg vidare alls: man kom in i uppdraget och kunde bara backa.
  Davids ord 7/9: "Undermenyn är inte implementerad". `UPPDRAGSSIDOR` fick en
  **första** post **Projektet** med tom slug (de nio står oflyttade efter), och
  alla tio sidorna renderar nu husets befintliga `subnav()` — ingen kopia, ingen
  ny klass, ingen ny CSS. Planen och Kontraktet bär den villkorslöst som övriga
  S10-sidor. För projektsidan, Avtal, Bedömning och Signaler är villkoret
  "projektet har minst ett avtal", härlett ur husets
  `listContracts(client, companyId, { project_id })` i sidans egen transaktion
  (Bedömning och Signaler bar redan `avtal` i sitt underlag); ett projekt utan
  avtal får ingen meny — nio av tio poster hade svarat "inget avtal ännu" — och
  behåller knappband och innehåll oförändrade. `aria-current="page"` sitter
  fortsatt på exakt EN post per navigation (WCAG 2.4.8), på projektsidan på
  Projektet. **Öppet redovisat:** `uppdragsytan-signaler.test.ts` krävde
  `not.toContain('class="subnav"')` — den raden kodifierade S5.1:s läge och är
  vänd till att kräva menyn, för annars hade provet varit en spärr mot
  rättelsen. `uppdragsytan-menyn.test.ts` utökades (ingen ny fil) med de tio
  posternas ordning, tomläget utan meny på projektsidan, och ett prov som går
  igenom **var och en** av de tio rutterna och kräver 200, `class="subnav"` med
  tio länkar och exakt EN `aria-current` på just den sidans post — mäts menyn
  bara på ett urval passerar nästa lucka grönt. Diffen rör
  `server/src/http/view/routes.ts`, de två testfilerna och den här filen;
  `docs/MCP_ACTIONS.md` orörd.

- **2026-09-07 (uppdragsytan S11.2, våg 9 — modulsektionen i ARKITEKTUR.md
  införd genom beslut #140):** Modulen var byggd (S0.1–S10.7) men lagen nämnde
  den inte, och punkten Migrationer påstod "just nu 0001–0059" när kedjan går
  0001–0071. `docs/ARKITEKTUR.md` fick sektionen **"## Uppdragsytan (modul)"**
  mellan Arkitekturmonster och Granser — namnrymden `uppdrag_*`, ägandegränsen
  (två datamängder ägda helt, en tredje utvidgad) och svepets hemvist hos
  Hermes — och migrationsraden rättades till 0001–0071. Ändringsregeln kräver
  att en arkitekturändring beslutas av David i beslutskön: beslut #140 **är**
  den mekanismen, inte ett bygge som ändrar dokumentet i förbifarten. **Ingen
  kod, ingen migration, inga tester, inga nya åtgärder eller beroenden**;
  Granser och Andringsregel står ordagrant kvar. Diffen rör `docs/ARKITEKTUR.md`
  och den här filen.

- **2026-09-07 (uppdragsytan S10.7, våg 7 — mätpunkten: menyn, klassnamnen och
  agentens läsväg):** Sex ytor var byggda (S10.1–S10.6), men ingen av dem gick
  att MÄTA. **Uppdragsytan saknades i huvudmenyn, sju av 1D:s elva
  komponentklasser fanns inte som CSS-regler alls — brädan i Leveranserna var
  byggd med inline-stil utan klassnamn — och provvakten kunde inte läsa en enda
  sida, för vyn avvisade agent-tokenet.** En yta ingen hittar till och ingen kan
  mäta är byggd men inte levererad.

  Byggt: `'projects'` **sist i `NAV_QUICK`** (html.ts), **sju nya CSS-regler**
  (`.handgrepp`, `.stapel--baseline`, `.milstolpe`, `.brada`, `.brada__kol`,
  `.leverabelkort`, `.harledning`) i samma stilmall och med husets egna tokens,
  **namnen inlagda på vyernas befintliga element** i `http/view/routes.ts`, och
  **en läsande agent-väg i `http/view/auth.ts`**. **Ingen migration, ingen ny
  åtgärd, ingen ny tjänst, ingen ny vy, ingen ny rutt, inga nya beroenden, ingen
  JS, ingen ändrad känslighet**; `authenticate.ts`, `docs/MCP_ACTIONS.md` och
  husets gemensamma tokens är **orörda**. Diffen rör `html.ts`, `routes.ts`,
  `view/auth.ts`, `server/test/` och den här filen.

  1. **Sist, inte först (KRAV-1).** Snabbradens ordning är dagens ordning
     (översikt, i dag, det som väntar, pengarna in, pengarna ut) och uppdraget är
     det man går till EFTER dem. De fem befintliga posterna står orörda: en
     snabbrad som flyttar sig under fötterna på den som lärt sig var något ligger
     är ingen snabbrad. Etiketten är `NAV_GROUPS` egen ("Projekt") — två namn på
     samma sida är två sidor för läsaren. Raden växer inte fritt: den rullar i
     sidled och viker undan helt under 700 px, så nästa post kräver samma sorts
     beslut som den här.
  2. **`aria-current` mäts PER navigation (KRAV-2).** Markeringen betyder "den
     här posten är sidan du står på" och är en egenskap hos en meny, inte hos
     dokumentet. Snabbraden och undermenyn markerar därför var sin post, och
     provet mäter dem var för sig — precis som designparitet.py. Ingen av
     menyerna byggdes om.
  3. **Riktiga regler, aldrig tomma alias (KRAV-3).** Varje nytt namn bär en
     regel med deklarationer ur kanons tokens. `.stapel` blev geometrin i
     rutnätet och `.stapel--baseline` påståendet "det här är baselinen"
     (`.stapel[data-arvd]` har högre specificitet och står därför oförändrad
     streckad). Provet fäller en tom alias-regel: ett namn utan komponent bakom
     sig är precis det designkontraktet finns för att hindra.
  4. **`.brada`-familjen är ett FÖRSTAGÅNGSNAMN, inte ett namnbyte.** Brädan var
     byggd med inline-stil utan klass alls. Samma flytt gjordes för
     handgreppsbandet och härledningsraden — reglerna är de som redan gällde, nu
     med ett namn någon kan peka på. `.leverabelkort + .leverabelkort` ersatte
     dessutom kortets `linje`-argument: ett kort ska inte behöva veta var i
     kolumnen det står för att se rätt ut.
  5. **Agentens läsväg är minsta möjliga (KRAV-5).** `viewAuth` accepterar ett
     agent-token ENDAST för GET, ENDAST under `/c/:companyId/projects/...`, och
     ENDAST när tokenets `scopedCompanyId` (gemener) är URL:ens bolag. Fel bolag
     → **404, aldrig 403**: huset läcker inte existens (`companyAccess.ts`), och
     att den ena vägen svarade 403 och den andra 404 hade varit två svar på samma
     fråga. Ingen cookie sätts någonsin — tokenet gäller anropet, inte tiden
     efter det — och POST-vägarna kan inte nås som agent, inte för att en handler
     kontrollerar det utan för att autentiseringen aldrig inträffar. Ogiltigt
     eller saknat token ger inloggningsomdirigeringen exakt som förut.
     **Vägvalet:** API:ts `authenticate` återanvändes INTE. Den svarar JSON på
     ett fel där vyn måste svara HTML, och den bär ingen tenantkoppling — den
     ligger före `requireCompanyAccess`, som vyn inte använder. En rak
     återanvändning hade alltså krävt att vyn fick API:ts felformat och att
     bolagsspärren byggdes en tredje gång.
  6. **Att den öppnar rätt yta är halva kravet.** Att den inte öppnar något annat
     — inte ett annat bolag (inte ens ett den egna människan är medlem i), inte
     en POST, inte resten av vyn, inte med en människas Bearer-token — är den
     andra halvan, och den som går sönder tyst. Provet mäter båda sidor.
  7. **Två prov utanför sviten fick följa med.** `navigation.test.ts` slog fast
     "snabbraden växer inte: fem poster" och `uppdragsytan-plan.test.ts` räknade
     `class="stapel"`. Båda är nu uppdaterade MED sitt skäl i kommentaren —
     beslut #139 respektive modifierarens namn — i stället för att tystas.

  **Grind:** typecheck och svit kördes INTE i den här sessionen (körs av
  körskriptet efteråt) — utfallet ska klistras in här innan bygget stängs. Ny
  svit `server/test/uppdragsytan-menyn.test.ts`: **(a)** snabbradens sex poster i
  exakt ordning med uppdragsytan sist, etiketten "Projekt", ingen emoji, och en
  aktuell post per meny — mätt i snabbraden och i undermenyn var för sig, med de
  sex S10-sidorna i 1E:s ordning och de tre övriga posterna kvar; **(b)** alla
  elva selektorerna i den LEVERERADE stilmallen, var och en med minst en
  deklaration, plus sökaren prövad åt båda hållen (den måste fälla
  `.stapel--baseline` som svar på `.stapel` och fälla en tom alias-regel), tokens
  i stället för hexfärger, och namnen faktiskt använda i alla fyra vyerna utan
  kvarlämnad inline-stil; **(c)** agent-token → 200 med `<nav class="nav"` och
  `<nav class="subnav"` utan `Set-Cookie`, utan token → `/app/login`, annat
  bolags id → 404 (både grannbolaget och människans EGET andra bolag), och
  POST/övriga vysidor/människans Bearer/ett trasigt token → inloggningen.

  **Kvarstår för David:** inget att migrera och ingenting att köra. **KRAV-7
  ligger utanför repot och är alltså INTE gjort här:** mätpunkten med agent-token
  och de elva klassnamnen ska in i `~/.hermes/prov/designparitet.py`, och
  klassnamnen i designkontraktet i vaulten. Att krympa undermenyn till sex
  poster, en auditrad för agent-läsning i vyn, agent-läsning av andra vysidor än
  uppdragsytans och 403 vid fel bolag är medvetet uteslutna — källan kräver dem
  inte.

- **2026-09-07 (uppdragsytan S10.5, våg 7 — Rapporterna: bedömningen som post):**
  S4.1 gav bedömningen sin skrivväg och S4.2 sitt frysta underlag. Men
  historiken bodde bara i en sexkolumnstabell UNDER formuläret som sätter nästa.
  **Uppdragets berättelse lästes alltså på den sida där man ändrar den, i en form
  byggd för att jämföra rad mot rad — och FR-20:s frysta tal låg i en kolumn man
  scrollade förbi.**

  Byggt: **en ny undersida `/app/c/:id/projects/:projectId/rapporterna`** i
  `http/view/routes.ts`, posten `['rapporterna', 'Rapporterna']` i
  `UPPDRAGSSIDOR` mellan *Pengarna* och *Kontraktet* (1E Del 5:s ruttlista), och
  en ny svit. Den enda ändringen i befintlig kod är att `bedomningsunderlag`
  delats i två: `bedomningshistorik` (uppdrag + avtal + historik) som båda
  sidorna läser, och den gamla funktionen som bygger vidare på den. **Ingen
  migration, ingen ny eller ändrad åtgärd, ingen ny tjänst, ingen ny CSS-klass,
  ingen JS, ingen ändring av formulärets beteende** — `uppdragBedomning.ts`,
  `registry.ts` och `docs/MCP_ACTIONS.md` är **orörda**. Diffen rör `routes.ts`,
  `server/test/` och den här filen.

  1. **En läsväg, inte två (KRAV-4).** Posterna kommer ur `bedomningshistorik` —
     exakt den funktion Bedömningssidan läser — och de frysta talen renderas av
     samma `frystCell`. Två hem för samma historik är precis den konstruktion som
     glider isär i tysthet; här finns bara EN kod att glida med, och provet
     jämför de två sidornas HTML på samma sex bitar.
  2. **Bedömningssidans historiktabell står kvar.** Underlagets analysfråga ("får
     Rapporterna bli historikens enda hem?") faller på Davids svarsregel 1: att
     ta bort tabellen vore en ändring utöver överlämningen. Dubbleringen hanteras
     därför av delad kod, inte av att den ena ytan tas bort.
  3. **Post, inte tabellrad (KRAV-3).** Perioden står i husets `.log-when` — en
     mono-axel ögat löper nedför — och omdömet till höger: läget först,
     människans egna ord näst, de frysta talen under dem, tidpunkten sist. En
     tabell tvingar fram jämförelse mellan rader; ett omdöme läses ett i taget.
     `.log` ÄR husets kronologikomponent (revisionsloggen, notiserna, CRM-
     anteckningarna) — återanvänd, inte uppfunnen, och därmed noll ny CSS.
  4. **Talen är radens, aldrig dagens (FR-20).** Provet loggar 4 h EFTER att båda
     bedömningarna satts och läser om sidan: posterna ska vara BYTE FÖR BYTE
     identiska med före. En sida som råkat räkna live hade sett likadan ut ända
     tills någon loggade mer tid — det är exakt det felet provet finns för.
  5. **FR-17 mäts på markupen, inte på en ny knapp.** Friktionen bor i
     `bedomningsformular`, som redan byggs ur `BEDOMNINGSLAGEN.map`. Provet
     normaliserar bort exakt det som SKA skilja lägena (kod, chip, innebördstext)
     och kräver att resten är byte för byte lika — plus tre radioknappar, EN
     submitknapp, ingen `<dialog>`, ingen `onclick`, inget `confirm`. Ett rött
     läge med ett extra steg är en tyst uppmaning att svara grönt.
  6. **Tomhetens grammatik i två lägen (KRAV-6).** Utan avtal sägs DET (och vägen
     går till `/avtal`); med avtal men utan bedömning står vad tomheten betyder —
     *ingen har svarat på om uppdraget håller, inte att det gör det* — och vägen
     går till Bedömningssidan. Aldrig en naken tom lista.
  7. **Ren läsvy.** Inget formulär, ingen knapp, inget skript på Rapporterna:
     bedömningen sätts där den alltid satts, och friktionen kan därmed inte
     skilja sig mellan de två ytorna.

  **Grind:** typecheck och svit kördes INTE i den här sessionen (körs av
  körskriptet efteråt) — utfallet ska klistras in här innan bygget stängs. Ny
  svit `server/test/uppdragsytan-rapporterna.test.ts`: **(a)** rutten med husets
  sidhuvud, undermenyn med *Rapporterna* mellan *Pengarna* och *Kontraktet*,
  `aria-current` på exakt en post, och posten synlig — men inte aktuell — också
  från Läget; **(b)** tre poster i kronologisk ordning (februari, maj, juni) med
  period, läges-chip i sin exakta markup, kommentar och satt-tidpunkt,
  tomkommentaren som säger sig själv, varningschipet på den rad som inte sattes
  av en människa och bara där, avtalsnamnet på uppdraget med TVÅ avtal men inte
  på det med ett — plus att Bedömningssidan visar samma sex bitar och behåller
  *Underlaget då*; **(c)** majpostens 1 h 30 min mot junipostens 2 h 30 min i
  perioden och 4 h 00 min mot taket, FR-20-provet med 4 h loggade i efterhand
  (posterna oförändrade, ingen 8 h någonstans), och S4.1-raden utan siffror med
  *Satt innan underlaget frystes*; **(d)** friktionsprovet — normaliseringen
  prövas åt båda hållen innan de tre alternativen jämförs — plus formulärets tre
  radios/en knapp och Rapporterna helt utan `<form>`, `<button>`, `<input>` och
  `<script>`; **(e)** båda tomlägena och tenantgränsen: grannbolagets uppdrag och
  ett okänt id ger 404 medan grannen når sitt eget på sin egen väg utan att en
  rad ur Locollabs historik läcker in.

  **Kvarstår för David:** inget att migrera och ingenting att köra. Sidan nås via
  undermenyn på uppdragets sidor. Att flytta historiken hit från Bedömningssidan,
  ett formulär på Rapporterna, en egen läsåtgärd `las_rapporter`, filtrering/
  paginering/periodval, en `.farskhet`-rad (talen är frysta, inte lästa nu) och
  en egen postklass är medvetet uteslutna — källan kräver dem inte.

- **2026-09-07 (uppdragsytan S10.4, våg 6 — Pengarna: kurvan mot ramen):**
  S7.4 la de två ramdatumen i svepets cache, S6.2 la tröskellarmet där, 0068 gav
  kvittot sin `contract_part_id` och sin `oplanerad`-märkning, och husets
  takberäkning kunde redan säga hur mycket som var förbrukat. **Men 1D:s fråga —
  "hur ligger vi mot ram, i timmar, kronor och enskilda kostnader?" — gick bara
  att besvara genom att öppna tre olika ställen och lägga ihop dem i huvudet.**

  Byggt: **ny tjänstefil `services/uppdragPengar.ts`** (`lasUppdragspengar`), **en
  ren SVG-kurvhelper `ramkurva` + klassen `.pengarad` i `http/view/html.ts`**, **en
  ny undersida `/app/c/:id/projects/:projectId/pengarna`** i `http/view/routes.ts`
  med posten `['pengarna', 'Pengarna']` i `UPPDRAGSSIDOR` mellan *Leveranserna*
  och *Kontraktet*, och en ny svit. **Ingen migration, ingen ny eller ändrad
  åtgärd** (1E Del 4 listar ingen läsåtgärd för Pengarna — vyn läser tjänsten
  direkt, som Leveranserna), **ingen ändrad känslighet, inga nya beroenden**;
  `uppdragSvep.ts`, `uppdragKostnad.ts`, `contracts.ts` och `receipts.ts` är
  **orörda**. Diffen rör `uppdragPengar.ts` (ny), `html.ts`, `routes.ts`,
  `server/test/` och den här filen.

  1. **Seriens slutsumma KAN inte avvika från takberäkningen.** Att den stämmer
     är inte en avsikt utan en konstruktion: gruppnyckeln är
     `forbrukningPerRad`:s egen (delens rad + de fyra taxekällorna), och det
     kumulativa beloppet räknas ur den ackumulerade MINUTSUMMAN per grupp — inte
     som en summa av dagsbelopp. Vid sista punkten är gruppens minutsumma hela
     dess minutsumma, alltså exakt samma avrundning som rotdelens `amount_ore`.
     En serie som summerade till något annat än ramkortet hade varit ett andra
     svar på "hur mycket är förbrukat?", och då vet ingen vilket som gäller.
  2. **Statuspredikatet härleddes, det kopierades inte.**
     `contracts.FORBRUKANDE_STATUSAR` är privat i den fil S7.4/S6.2 äger, och en
     kopierad lista glider isär den dag livscykeln ändras. `arGodkannande ||
     arFakturerad` ÄR husets tre statusar, och provet fäller listan om den
     upphör att vara det.
  3. **Kurvan ritas ENDAST när cachen bär ett datum.** Bär den ett villkor —
     'inget bekräftat tak', 'ingen taxa', 'ingen bokad framtid' — ritas ingen
     kurva, ingen ramlinje och inget datum; villkorets egna ord står i klartext i
     stället. En bild som slutade i en gissning hade gjort svepets vägran till
     ett svar, och det är precis vad FR-5 finns för att hindra.
  4. **Heldraget är mätning, streckat är prognos** — och skillnaden bärs också av
     texten under bilden. SVG:n har `role="img"` + `aria-label`, och ramdatumen
     står som text UTANFÖR den: bilden är aldrig ensam bärare (WCAG 1.1.1).
  5. **Ingen procent, ingen progressbar (NFR-11).** Två tal bredvid varandra
     säger vilket av dem som rörde sig; "72 %" säger det aldrig, och en
     `<progress>` påstår dessutom att någon vet hur långt kvar det är.
  6. **Ett oläst svep är inte ett lugnt svep.** Saknas prognosen eller
     tröskellarmet i cachen säger sidan DET, med svepets egen färskhet per värde
     (FR-35) — ett tomt larm renderas aldrig som "ingen tröskel passerad".
  7. **En enda ny klass.** `.pengarad` enligt 1D:s klasstabell (tal i `--mono`,
     högerställda, "ej bokförd" i `--muted`); resten bärs av `.panel`, `.chip`,
     `.table-wrap`, `.subnav`, `.farskhet`, `.empty` och `.code`. Kurvan
     återanvänder `.chart`/`.ch-base`/`.ch-lbl` från `monthlyChart` och färgar
     med inline-stil mot husets tokens — ingen ny CSS-klass för bilden.

  **Grind:** typecheck och svit kördes INTE i den här sessionen (körs av
  körskriptet efteråt) — utfallet ska klistras in här innan bygget stängs. Ny
  svit `server/test/uppdragsytan-pengarna.test.ts`: **(a)** tjänstelagret —
  predikatet är husets tre statusar, seriens sista punkt är EXAKT rotdelens
  `billable_minutes`/`amount_ore` ur `get_contract_usage`, dagens eget tillskott
  står bredvid summan, ramen är rotdelens tak i hela minuter med sin takstatus,
  och svepvärdena bär var sin källa (`kalender` resp. `redovisning`) medan ett
  osvept uppdrag ger `null`; **(b)** undermenyn med *Pengarna* mellan
  *Leveranserna* och *Kontraktet*, `aria-current` på exakt en post, och posten
  synlig också från Läget; **(c)** två kurvor med streckad förlängning och
  `role="img"`, och de TVÅ ramdatumen i klartext — riggade så att timramen och
  kronramen nås OLIKA dagar (taken står med flit inte i taxans förhållande), så
  att en sida som räknat själv inte kan råka svara rätt; **(d)** alla tre
  villkorsfallen var för sig plus det fjärde som inte är ett villkor — svepet har
  inte kört — var och en utan kurva och utan datum; **(e)** båda kvittona i
  datumordning, `Oplanerad`-chipet på den svepbundna raden med kvittolistans egen
  förklaring, det obokförda kvittot som *ej bokförd* utan tal, och tom-texten på
  ett avtal utan bunden kostnad; **(f)** varken `<progress>`, `<script>`,
  `<form>`, `<button>`, `<input>` eller ett procenttal i det som SYNS, på
  samtliga fyra sidor; **(g)** grannbolagets uppdrag, ett okänt id och ett
  projekt utan avtal ger alla 404 medan grannen når sitt eget på sin egen väg.
  Proven är daterade RELATIVT dagens datum: prognosen mäts mot `idag`, och ett
  hårdkodat framtidsdatum hade tyst blivit ett förflutet datum en dag i
  framtiden — och då provat något annat än det står att det provar.

  **Kvarstår för David:** inget att migrera och ingenting att köra. Sidan nås via
  undermenyn på uppdragets sidor; kurvan syns så fort svepet kört. 1D:s mening
  "sista bokade aktivitet den Y", tabellkolumnerna Aktivitet/Typ/Debiterbar/
  Verifikat, obundna kvitton, `.harledning`-klassen, en egen läsåtgärd
  `las_pengarna` och tröskelmarkörer inritade i kurvan är medvetet uteslutna —
  källan kräver dem inte.

- **2026-09-07 (uppdragsytan S10.3, våg 6 — Leveranserna: brädan och tabellen):**
  Registret fick sin läsväg i S3.1 och sin ålder i S3.3, men bara som svaret på
  en åtgärd. **Frågan "vad ska levereras, var står varje leverabel, och hur länge
  har den stått där?" gick alltså att STÄLLA men inte att se.**

  Byggt: **en ny undersida `/app/c/:id/projects/:projectId/leveranserna`** i
  `http/view/routes.ts`, med två JS-fria lägen — brädan (en `.panel` per
  statusläge, default) och tabellen (`?lage=tabell`, samtliga fält) — plus
  posten `['leveranserna', 'Leveranserna']` i `UPPDRAGSSIDOR` mellan *Planen*
  och *Kontraktet*, och en ny svit. **Ingen migration, ingen ny eller ändrad
  åtgärd eller tjänst** (`lasLeverabelregister` och `registry.ts` är orörda),
  **ingen ny CSS-klass, ingen ny rutt utöver vyn, inga nya beroenden, ingen
  ändrad känslighet.** Diffen rör `routes.ts`, `server/test/` och den här filen.

  1. **Två lägen, ETT svar (FR-23).** Båda lägena renderas ur samma
     `lasLeverabelregister`-svar per avtal — kolumnen är radens egen `status`,
     åldern radens egen `dagar_i_laget`. Vyn räknar och härleder ingenting. Två
     lägen som räknade var för sig hade kunnat säga emot varandra, och då vet
     ingen vilket som gäller.
  2. **Likvärdiga, inte huvudsak och sammanfattning.** Brädan svarar på "var står
     det?" med formen; tabellen bär alla fält och är den som läses upp och skrivs
     ut. En dold sr-only-tabell bakom brädan hade gjort skärmläsarens väg till en
     andrahandsversion — här är den en adress man kan bokmärka och skicka.
  3. **Växeln är en serverlänk.** `?lage=tabell`, ingen JavaScript i något läge.
     Utan parametern — eller med ett värde ingen känner igen — visas brädan: en
     felskriven parameter ska landa i default-läget, aldrig i en tom sida.
  4. **Färg, form och ord, alltid alla tre (FR-12).** Lägena bärs av husets
     `statusChip`: färgen i `chip--*`, formen i glyfen, ordet i etiketten. Ingen
     ny etikett och ingen ny färg — en bräda som bara färgkodar är obrukbar i
     svartvitt och för den som inte skiljer färgerna.
  5. **En tom kolumn står kvar, ett tomt register säger varför.** En kolumn som
     försvinner lär läsaren att brädan är ofullständig och gör kolumnernas ordning
     olika för varje avtal. Ett tomt REGISTER är något annat: då står 1D:s
     förklaring (registret fylls när kontraktet läses in) i stället för en tom
     bräda som ser färdig ut.
  6. **Ren läsvy (NFR-4).** Inget `draggable`, inget formulär, ingen knapp:
     statusbytet ägs av `bekrafta_statusbyte` (S3.2) och går genom kön där en
     människa läser transmittalen. Ett drag i en kolumn hade varit en andra
     skrivväg förbi hela den ordningen.
  7. **Grupperingen kan inte svälja en rad.** De fem lägena skapas före raderna
     läggs in, och ett läge utanför skalan hamnar sist i stället för att tyst
     försvinna. Kolumnerna är en PLACERING av tjänstens rader, aldrig ett urval.

  **Grind:** typecheck och svit kördes INTE i den här sessionen (körs av
  körskriptet efteråt) — utfallet ska klistras in här innan bygget stängs. Ny
  svit `server/test/uppdragsytan-leveranserna.test.ts`: **(a)** undermenyn med
  *Leveranserna* mellan *Planen* och *Kontraktet*, `aria-current` på exakt en
  post, och posten synlig också från Läget; **(b)** kodsökaren prövad åt båda
  hållen, och därefter SAMMA sex leverabelkoder i brädan, i tabellen och i
  tjänstesvaret — plus att okänt `?lage`-värde ger brädan och att varje läge bär
  en synlig serverlänk till det andra; **(c)** alla fem kolumnerna i FR-12:s
  ordning inklusive den tomma `godkand`, tre bärare (färg, glyf, ord) per läge i
  båda lägena, samtliga sju kolumner i tabellen, L6:s saknade läsväg redovisad
  som saknad, och åldern renderad ur tjänstens `dagar_i_laget` (12 dagar
  respektive "Mindre än ett dygn i läget"); **(d)** varken `draggable`,
  `<script>`, `<form>`, `<button>` eller `<input>` i sidans egen markup;
  **(e)** tomt register i båda lägena, ett projekt utan avtal, och tenantgränsen
  — grannbolagets uppdrag och ett okänt id ger 404 medan grannen når sitt eget
  uppdrag på sin egen väg. Statusarna riggas som ägarrollen (leverabelns enda
  skrivväg är `bekrafta_statusbyte`, som bara flyttar `pagar` vidare) — riggning
  av utgångsläge, inte en andra skrivväg.

  **Kvarstår för David:** inget att migrera och ingenting att köra. Sidan nås via
  undermenyn på uppdragets sidor. Drag-and-drop, kortknappen *Bekräfta byte →*
  (1D 4.3, ägs av S3.2), 1D:s tabellfält Namn/Rev/Mottagare/Överlämnad (de finns
  inte i tjänstesvaret), filtrering/sortering/paginering och en egen `.brada`-klass
  är medvetet uteslutna — källan kräver dem inte.

- **2026-09-07 (uppdragsytan S10.1, våg 6 — Läget och uppdragslistan):** Alla
  fem delarna av FR-18 fanns redan i databasen, men i fem läsvägar och på fyra
  undersidor. **Kontrollytetestet — "kan David se läget utan att fråga?" — kunde
  alltså bara besvaras med nej: en fråga man måste ställa fem gånger ställer man
  till slut noll gånger.** Två fynd styrde bygget: `.farskhet` och `.subnav`
  fanns inte i `html.ts` (1C runda 2 punkt D), och husets modulundersidor ligger
  under `/c/:id/projects/:projectId/*` — inte på 1E:s `/uppdrag/:kod`.

  Byggt: **ny tjänstefil `services/uppdragLage.ts`** (`lasUppdragslage` +
  `lasSvepfarskhet`), **EN ny åtgärd `las_uppdragslage` (`read`, ingen
  `kravManniska`)**, **två vyer i `http/view/routes.ts`** (`/projects/:id/laget`
  och listan `/c/:id/uppdrag`), **två nya klasser i `html.ts`** (`.farskhet`,
  `.subnav`) och en ny svit. **Ingen migration**, inget nytt beroende, ingen
  ändrad känslighet, ingen ändring i någon befintlig tjänst eller åtgärd — den
  enda ändringen i en befintlig vy är knappen *Läget* först i uppdragets
  knappband (utan den vore ytan en url ingen hittar till).

  1. **Ingen sjätte läsväg och ingen andra beräkning (FR-25).** Förbrukningen
     kommer ur `getContractUsage` — husets ENDA takberäkning, samma tal som
     takvarningen och faktureringsspärren läser — och tidsunderlaget ur
     `listTimeEntries` med husets eget `arIgnorerad`. Registret, bedömningen,
     signalerna och kön kommer ur sina egna tjänster. Vyn räknar ingenting alls:
     den läser samma svar som MCP och REST, så de två kan aldrig svara olika.
  2. **Tröskeln HÄMTAS, den härleds inte om.** S6.2 la larmet i svepets cache;
     att utvärdera FR-3:s dubbelvillkor en andra gång här hade gett två svar på
     "larmar det?". Larmet är därmed också det enda SVEPTA värdet på sidan — och
     det är precis därför det bär svepets `last_nar` och inte sidans.
  3. **Färskhet per källa, aldrig en sidstämpel (FR-35).** `.farskhet` står sist
     i det kort vars tal den daterar. Har svepet aldrig kört säger raden DET
     (`farskhet.troskel = null`) i stället för att låta ett tomt larm se ut som
     lugn — och listvyns färskhetskolumn skriver "Svepet har inte kört" i stället
     för ett tomt fält som ser ut som "nyss".
  4. **Alla fem korten finns ALLTID i sidan (FR-22, lärdom 7).** Ett kort som
     försvinner när det saknar data lär läsaren att ytan är ofullständig, och en
     tyst nolla ser ut som ett sant svar. Saknas innehållsdelen skrivs vad
     tomheten BETYDER plus en väg vidare. En saknad bedömning renderas som
     *Saknad* i ockra — aldrig grön, för ett läge ingen satt är inte ett bra läge.
  5. **Ockran är bandets, aldrig kortens.** `.ai-card` betyder "väntar på en
     människa" i huset (S8.1). Väntar ingenting byter bandet till `.panel`:
     färgskiftet säger det innan orden gör det. Statusförslagsraderna — och bara
     de — bär `aiMarkning()`; en köpost en människa själv begärt är ingen
     maskinobservation.
  6. **Två klasser, inte tio.** Överlämningen namnger `.farskhet` och `.subnav`;
     `.handgrepp` och 1D:s åtta övriga klasser byggdes INTE. Bandet och korten
     bärs av husets `.ai-card`, `.panel`, `.kpi`, chip och knappband, och
     kortrutnätet av en inline-stil — samma teknik som resten av modulens ytor.
  7. **Husets ruttmönster, inte 1E:s.** `/projects/:id/laget` och `.subnav` till
     uppdragets befintliga undersidor, med `aria-current="page"` på exakt en post
     (WCAG 2.4.8). Ingen post i `.nav__quick` (FR-21 ägs av S10.7), och `.subnav`
     lades inte retroaktivt på de andra undersidorna.

  **Grind:** typecheck och svit kördes INTE i den här sessionen (körs av
  körskriptet efteråt) — utfallet ska klistras in här innan bygget stängs. Ny
  svit `server/test/uppdragsytan-laget.test.ts`: registret (`read`, ingen
  `kravManniska`, `.strict()` som fäller ett medskickat `contract_id`); **(a)**
  ett riggat uppdrag (importerat NVR-001, 2 h på rotdelen à 1 100 kr, bedömning
  `risk`, en tänd signal, ett svep och två köposter — en som namnger avtalet, en
  som namnger uppdraget) → alla fem delarna med rätt tal, alla fem
  leverabellägena i skalans ordning, kommentarens FÖRSTA mening, och färskhet per
  del där tröskeln bär svepets tidpunkt; **(b)** grannbolagets `project_id`, ett
  okänt och ett projekt UTAN avtal ger alla 404 genom hela stacken — i åtgärden
  och i vyn — medan grannen når sitt eget uppdrag på sin egen väg; **(c)**
  TOMFALLET med en nollsökare som prövas åt BÅDA hållen (den måste fälla en
  insmugen `<strong>0</strong>` och ett "0 kr", och släppa igenom "09:04" och
  "10 h 30 min av 430 h"): fem kort, var sin tomtext med väg vidare, ingen naken
  nolla i något kort, och ett tomt band som förklarar tomheten utan ockra;
  **(d)** listvyn tom (`.tomt`-grammatik i ett eget bolag utan avtal) respektive
  med rader — projektet utan avtal står INTE där, läget är *Risk* respektive
  *Saknad*, färskheten en klockslagstid respektive "Svepet har inte kört";
  **(e)** exakt fem `.farskhet`-rader, tröskelraden daterad av svepet på det
  svepta uppdraget och "svepet har inte kört" på det osvepta, ingen procentsats i
  ramkortet, `.subnav` med `aria-current` på exakt EN post och alla sex
  undersidorna, ingen `<script>`, och knappen till Läget på uppdragssidan.

  **Kvarstår för David:** inget att migrera och ingenting att köra. Läget nås via
  knappen på uppdragssidan; listan ligger på `/app/c/<bolag>/uppdrag`. En post i
  huvudmenyn för listan (FR-21, ägs av S10.7), prognoskortet "Nästa datum"
  (FR-5), rytm-mekaniken och bedömningens förfallodatum i bandet (FR-14 saknar
  lagring och läsare i repot), en egen `.handgrepp`-klass, `.subnav` retroaktivt
  på modulens övriga undersidor och 1D:s åtta andra komponentklasser är medvetet
  uteslutna — källan kräver dem inte.

- **2026-09-06 (uppdragsytan S4.2, våg 6 — den förifyllda bedömningsrapporten):**
  S4.1 gav bedömningen sin skrivväg, och 0068 hade burit `frysta_siffror` och
  `handelse_ref_ids` sedan dag ett — men tjänsten lämnade dem med flit NULL, och
  formuläret var en tom ruta med tre knappar. **Bedömningen var alltså ett
  omdöme utan underlag: talen den vilade på gick inte att läsa i efterhand, och
  den som skulle sätta den fick leta rätt på dem i fyra andra vyer först.**

  Byggt: **en underlagsbyggare `byggRapportunderlag` + `lasScopelinjer` i
  `services/uppdragBedomning.ts`**, **frysningen inuti `sattBedomning`** (samma
  transaktion som INSERT:en), **panelen *Underlaget för perioden* över
  formuläret** och **kolumnen *Underlaget då* i historiken** i
  `http/view/routes.ts`, plus fyra nya provblock. **Ingen migration** (0068:s
  kolumner finns), inget nytt beroende, ingen ny åtgärd, ingen ny rutt, ingen ny
  CSS-klass, inga nya indatafält, ingen ändrad känslighet — `satt_bedomning` är
  fortfarande `write` + `kravManniska` med oförändrat schema.

  1. **Ingen andra förbrukningsberäkning (FR-25).** Delarna mot sina tak kommer
     ur `getContractUsage`, alltså ur husets ENDA takberäkning — samma tal som
     takvarningen och faktureringsspärren läser. Periodens timmar härleds ur
     `listTimeEntries`-utdatan med husets egna predikat (`arIgnorerad`,
     `arGodkannande`, `arFakturerad`), inte ur en egen SUM(): en andra
     tolkning av vilka poster som räknas hade blivit ett andra svar på
     "hur mycket är förbrukat?".
  2. **En byggare, två användare.** Samma funktion bygger vyns förhandsvisning
     och de tal som fryses vid INSERT:en. Två byggare hade betytt att sidan
     visade ett tal och raden bar ett annat — och den skillnaden hade ingen
     upptäckt förrän någon läste bedömningen ett halvår senare.
  3. **Periodens tid, avtalets tak.** Timmarna är periodens; förbrukningen mot
     taket är avtalets hela livslängd, för ett tak mäts aldrig per månad.
     Provet riggar därför en tidpost UTANFÖR perioden: den syns i delens
     förbrukning och får aldrig synas i periodens timmar.
  4. **Pekare, aldrig kopior (FR-26).** `handelse_ref_ids` är id:n i
     `uppdrag_referens`; mejlkroppen och kalendertexten ligger kvar i sitt
     källsystem. Perioden mäts på `created_at` — raden bär inget annat datum
     (`uppdragReferens.ts`) — och bara `kalender`/`mejl` räknas: `drive`-pekarna
     pekar på avtalshandlingen, inte på något som hände.
  5. **Tom array är inte NULL.** En period utan tid och händelser fryser nollor
     och `{}`; lägesvalet förblir det enda obligatoriska (ett giltigt svar
     spärras aldrig). NULL betyder därmed entydigt "satt före S4.2", och sådana
     rader renderas som förut — utan siffror, med texten *Satt innan underlaget
     frystes*. En nolla där hade sett ut som ett underlag.
  6. **Scopelinjen fryses inte.** Acceptansen säger att rapporten BÄR den;
     avtalets ord står redan i `uppdrag_scopelinje` och läses levande i vyn med
     samma `scopegrupp`-komponent som kontraktsytan (S10.6) använder. En kopia
     hade gjort bedömningen till en fjärde datamängd.
  7. **Ytan: rapporten först, genvägen i huvudet.** Man läser innan man dömer,
     så panelen står över formuläret — men *Sätt bedömningen ↓* ligger i
     sidhuvudets knappband, så den som redan bestämt sig (och den som tabbar)
     aldrig behöver passera hela underlaget för att svara. Inga nya klasser:
     `.panel`, `.kpi-grid`, `.table-wrap`, `.chip`, `.code` och `<details>` bär
     ytan, och sidan är fortsatt helt JS-fri.

  **Grind:** typecheck och svit kördes INTE i den här sessionen (körs av
  körskriptet efteråt) — utfallet ska klistras in här innan bygget stängs.
  `server/test/uppdragsytan-bedomning.test.ts` utökad: **(a)** ett riggat
  uppdrag (bekräftat tak 10 h/12 000 kr, taxa 1 200 kr/h, 2 h i perioden och 1 h
  efter den, två referenser i perioden plus en utanför och en `drive` inuti, två
  leverabelrörelser varav en i perioden) → frysta timmar 120 min/1 post, delen
  180 min/360 000 öre mot taket med andel 0,30 och status `bekraftat`, EN
  leverabelrörelse och `handelse_ref_ids` exakt de två — och efter att 4 h lagts
  till i efterhand ger en NY bedömning 360 min medan den första raden står
  oförändrad (FR-20); **(b)** `frysta_siffror` och `handelse_ref_ids` som indata
  ger 400 `validation_error` utan rad, och agentanropet fortsatt 403
  `human_required`; **(c)** tom period → nollor, `{}` (inte NULL) och en
  lyckad insert; **(d)** vyn med rapporten för innevarande månad (timmar, delen
  mot taket, rörelsen, händelsen som referens, alla tre scopegrupperna),
  formulärets förval kvar, ingen `<script>`, historikens frysta tal och en
  admin-skriven S4.1-rad som renderas utan siffror — plus ett uppdrag utan
  länkade händelser som säger det rakt ut utan att blockera formuläret.

  **Kvarstår för David:** inget att migrera och ingenting att köra. Bedömningen
  sätts som förut på uppdragets **Bedömning**-sida, nu med underlaget ifyllt.
  Retroaktiv frysning av äldre S4.1-rader, en periodväljare som räknar om
  rapporten utan att sätta bedömningen, delningslogg/Drive-kopia (S7.5) och
  rytm-mekanik för bedömningstillfället är medvetet uteslutna — källan kräver
  dem inte.

- **2026-09-06 (uppdragsytan S10.6, våg 5 — Kontraktet: en JS-fri läsyta per
  uppdrag):** Avtalets livscykel låg i fyra tabeller och fyra frågor som ingen
  kunde ställa på en gång: var är dokumentet, vad gäller nu, vilka tillägg har
  gjorts och varför, och vad ingår? Var för sig fanns svaren — `contracts`,
  `contract_parts` med sina versioner, `uppdrag_referens`, `uppdrag_scopelinje`.
  **Tillsammans fanns de bara i den DOCX ingen läser förrän det är för sent.**
  Två fynd styrde bygget: `listContracts` returnerade varken `kontrakt_tillstand`
  eller versionernas `change_reason`, så ett utkast gick inte att skilja från en
  baseline och ett tillägg inte från ett datum.

  Byggt: **ny åtgärd `las_kontraktsyta` (`read`, ingen `kravManniska`)** i
  `actions/registry.ts`, **ny tjänstefil `services/uppdragKontrakt.ts`**
  (`lasKontraktsyta`), **två additiva rader i `services/contracts.ts`**
  (`c.kontrakt_tillstand` i `AVTAL_KOLUMNER`, `change_reason` i `Takversion` +
  versionsfrågan), **vyn `/app/c/:id/projects/:projectId/kontraktet`** med
  knappen sist i uppdragssidans knappband, och en ny svit. **Ingen migration**
  (kolumnerna finns i 0064/0068), inget nytt beroende, ingen ny felkod, ingen ny
  CSS-klass, ingen skrivväg, ingen ändrad känslighet på någon befintlig åtgärd.

  1. **Ytan är VÄGEN till dokumentet och REGISTRET över dess läge — aldrig en
     kopia.** Svaret bär `source_file_id` och Drive-referensernas `extern_id`,
     och ingenting mer om handlingen; `getDocument`:s `includeContent` anropas
     aldrig härifrån och åtgärden har med flit ingen `include_content`-flagga.
     Det är hela FR-38: en fjärde datamängd uppstår inte, för varje fält i
     svaret står redan i en tabell som någon annan story äger.
  2. **Kopietestet prövas åt BÅDA hållen.** En regel som säger "det här får inte
     finnas" går inte att prova genom att räkna fält. Sökaren letar efter rader
     som står i HANDLINGEN men inte i baselinen (partsraden, rapporteringstakten,
     bilagerubriken, fältnamnen `content_base64`/`kontraktstext`) — och provet
     visar först att sökaren FÄLLER ett svar där en kontraktsrad smugits in.
     Utan den kontrollen vore den andra bara ett prov på att en sträng råkar
     saknas. Scopelinjerna och leverabelkoderna SKA däremot stå på ytan: det är
     skillnaden mellan ett register och en kopia.
  3. **Ingen andra takberäkning och ingen andra gällande-regel.** Avtalet och
     delarna kommer ur `listContracts`, alltså ur husets enda takberäkning; den
     gällande versionen ÄR `Delforbrukning.part_id`. Två svar på "vilken version
     gäller?" i samma hus är ett fel, inte en nyans — och Planen, takvarningen,
     faktureringsspärren och den här ytan svarar nu bevisligen likadant.
  4. **Ett tillägg är en version utöver den första, och det bär sitt skäl.** Den
     tidigaste `valid_from` är avtalet som det skrevs och behöver inget skäl
     (den ändrar ingenting); varje rad efter den är ett tillägg med det
     `change_reason` 0068:s trigger kräver. Orsaken får den sista och bredaste
     kolumnen — en tilläggslista utan den säger bara ATT något ändrades. En
     version med framtida `valid_from` bär `gallande: false` i stället för att
     tigas ihjäl: den är skriven men gäller inte än.
  5. **Ett utkast renderas SOM utkast.** Rubriken byter från "Det som gäller nu"
     till "Utkastets delar" och notisen säger rakt ut att ingenting där gäller.
     Det som står obesvarat i utkastet står i HANDLINGEN — sidan pekar dit och
     återger det aldrig (NFR-12, KRAV-5). Ett utkast som ser ut som en baseline
     är värre än inget utkast alls.
  6. **Pekaren är ett id, aldrig en länk till ett grannsystem.** Ingen
     `drive.google.com`-url konstrueras: S7.1:s regel är att id:t överlever att
     filen döps om och flyttas, och en url gjord av koden hade varit precis den
     ruttnande länk regeln finns för att slippa. Den enda länken går till husets
     EGET dokumentarkiv (`/documents/:fileId/download`), där handlingen faktiskt
     ligger. Nyckelrymden står under titeln i tabellen — utan den går den frysta
     registerkopian (`extern_nyckel = 'registerkopia'`, ett platshållar-id tills
     svepet skrivit filen) inte att skilja från avtalshandlingen.
  7. **Husets ruttmönster, inte 1E:s.** `/projects/:id/kontraktet` med knappen
     sist i knappbandet efter *Planen* — ingen `.subnav` och ingen
     `/uppdrag/:kod`-rutt (Davids analysregel 3; menyn ägs av S10.7). Ingen ny
     CSS: `.panel`, `.chip`, `.empty`, `.code` och husets tabeller bär ytan.

  **Grind:** typecheck och svit kördes INTE i den här sessionen (körs av
  körskriptet efteråt) — utfallet ska klistras in här innan bygget stängs. Ny
  svit `server/test/uppdragsytan-kontraktsyta.test.ts`: registret (`read`, ingen
  `kravManniska`, och `.strict()` som fäller ett medskickat `include_content`);
  **(a)** det frysta NVR-001 med tillstånd, pekare vars id varken är url eller
  sökväg, strömmarna S1–S3 med obekräftade tak och scopelinjens 4/4/7 rader,
  medan grannbolagets `contract_id` — och ett okänt — ger 404 genom hela stacken
  och grannen ändå når sitt eget avtal på sin egen väg; **(b)** `andra_baseline`
  som ger EN tilläggsrad med `change_reason`, taket 130 h och `gallande: true`,
  med `gallande`-listan fortsatt EN rad per kod, plus vyn som skriver ut orsaken
  och inte bara datumet; **(c)** kopietestet i tre led — sökaren fäller en
  smugglad kontraktsrad och ett `content_base64`, åtgärdssvaret läcker inget
  (och `dokument` har exakt två nycklar), vyns HTML läcker inget och bär ingen
  `<script>` medan scopelinjens rader står kvar synliga; **(d)** utkastet med
  "Utkastets delar", "Avtalet är inte signerat" och utan rubriken "Det som
  gäller nu", det frysta avtalet med alla tre scopegrupperna och klausulen,
  knappen på uppdragssidan, tomläget för ett uppdrag utan avtal, och 404 på
  grannbolagets uppdrag i vyn.

  **Kvarstår för David:** inget att migrera och ingenting att köra. Kontraktet
  nås via knappen på uppdragssidan. Menyn/`.subnav` (S10.7), rendering av
  utkastets frågetexter, leveranskartan och rytmen på ytan, Drive-verifiering
  vid rendering och en `include_content`-flagga är medvetet uteslutna — källan
  kräver dem inte.

- **2026-09-06 (uppdragsytan S6.2, våg 5 — tröskeln på tre nivåer):** 0068 hade
  burit `contracts.troskel_procent`, `troskel_golv_ore`, `troskel_golv_timmar`
  och `troskel_dagar` sedan dag ett, och S7.4 hade gett svepet både utfallet
  (`forbrukningForAvtal`) och prognosunderlaget (`harledPrognosramar`). Men
  **ingen kodväg läste en enda av de fyra kolumnerna.** FR-3 var alltså fyra
  trösklar utan utvärderare: takvarningen (`takvarningEfterSparad`) tänder på
  ren andel (`VARNINGSGRANS` 0,8) och vet ingenting om ett golv, så en småpost
  kunde larma på ren procent och ett stort uppdrag tiga.

  Byggt: **en ny ren fil `server/src/lib/troskel.ts`** (`harledTroskellarm` +
  `bindandeTroskel`/`passerarTroskel`/`heltalstrosklar` — ingen databas, ingen
  klocka, `idag` som argument), **inkopplingen i `services/uppdragSvep.ts`**
  (nytt svepvärde `troskellarm`, källa `redovisning`, i samma
  `upsertSvepvarden` som övriga värden), en ny svit och två docs-rader.
  **Ingen migration** (kolumnerna finns i 0068), ingen ny åtgärd, ingen
  scheduler, ingen vy, inga nya beroenden, inga egna belopps- eller
  timkolumner; `takvarningEfterSparad`/`VARNINGSGRANS` och fakturaspärren
  (`delarOverBekraftatTak`) i `contracts.ts` är **orörda**.

  1. **Dubbelvillkoret är hela kravet, och det går sönder åt två håll.** Utan
     golvet larmar 30 % av en post på 8 000 kr — 2 400 kr — och den dagen larmen
     väcker någon för 2 400 kr har de slutat betyda något. Utan procenten tiger
     ett litet uppdrag där 22 000 kr är halva ramen. Larmet tänder därför bara
     när avvikelsen ÖVERSTIGER båda, och `>` är avsiktligt strikt: att passera
     en tröskel är att gå förbi den, inte att stå på den. Dagslarmet är
     motsatsen (`≥ troskel_dagar`) — femte dagens försening ÄR fem dagar.
  2. **Modulen räknar aldrig om förbrukningen** (FR-25). Utfallet kommer ur
     husets enda takberäkning och prognosen ur svepets egen, redan befintliga
     härledning; filen JÄMFÖR, den mäter inte. Ett obekräftat tak larmar aldrig
     — samma regel som varningen och spärren: ett oläst tak varnar aldrig.
  3. **Heltal hela vägen, och omräkningen sker EN gång.** Procenten skalas ur
     numeric(5,2) till hundradelar, timgolvet till minuter (mönstret
     `Math.round(cap_hours * 60)`). Procentandelen GOLVAS när den redovisas:
     för ett heltal är `a > floor(x)` exakt samma sak som `a > x`, så tröskeln
     i larmet är det tal en läsare kan pröva jämförelsen mot för hand — utan ett
     flyttal någonstans.
  4. **Nivåerna är uppdraget och posterna, aldrig strömmen.** Rotdelen och
     lövdelarna mäts; strömmarna däremellan är med flit utelämnade — deras
     ramandel finns inte förrän en baselineversion bär den (FR-3), och ett larm
     på en ram som ingen skrivit under är ett larm utan avsändare.
  5. **Ärvt intervall lånas, det skrivs inte igen.** Dagslarmets slutdatum är
     delens eget, annars det ärvda enligt `byggPlan` i `lib/uppdragsplan.ts` —
     samma regel Planen ritar med. En andra kopia av arvsregeln hade gett en
     leverabel ett larmdatum och en stapel som pekade på var sitt håll. Larmet
     bär `arvt_fran`, för ett larm på ett datum som inte står på posten självt
     är obegripligt utan den upplysningen.
  6. **Ingen prognos utan bokad framtid.** Utan bokningar framåt vore
     prognostalet utfallet en gång till, och ett andra identiskt larm är brus —
     samma hållning som `harledPrognosramar`:s villkor `ingen bokad framtid`.
     Utan taxa finns ingen kronprognos alls: hellre tyst än ett larm ur ett
     hittat tal.
  7. **Registervyn byggdes inte, och `uppdragSignal.ts` rördes inte.**
     CTO-underlaget nämnde en larmkolumn i en registervy — den vyn finns inte
     (utesluten i S3.1, byggjournal beslut-121/-131, kommentaren
     `routes.ts:1467`), så inkopplingspunkten är svepets cache. Och
     scopesignalerna (FR-6/FR-7) tänds av människor, inte av trösklar. CTO:ns
     analysfråga om att lägga om `takvarningEfterSparad` till dubbelvillkoret
     besvaras av Davids regel 1: nej — källan kräver det inte.

  **Grind:** typecheck och svit kördes INTE i den här sessionen (körs av
  körskriptet efteråt) — utfallet ska klistras in här innan bygget stängs. Ny
  svit `server/test/uppdragsytan-troskel.test.ts` i två lager. **(a) Den rena
  funktionen** med storyns sex provfall: 30 000 kr mot 473 000 kr tänder
  (tröskeln 23 650 binder, golvet 22 000 passeras) medan 23 000 kr — över golvet,
  under procenten — tiger, och exakt på tröskeln tänder inte; 2 400 kr mot en
  post på 8 000 kr tänder INTE (golvet binder) men 22 001 kr gör det, och
  strömmen som ligger 40 000 kr över sitt tak mäts inte alls; den
  prognostiserade avvikelsen tänder på exakt samma tröskeltal som utfallet, utan
  taxa bara på timsidan, utan bekräftat tak inte alls; 30 h mot 430 h tänder
  medan 18 h och 21 h (över golvet, under procenten) inte gör det, plus
  golvningens exakthet på 1 354/1 355 minuter; fem dagars försening mot en
  daterad post tänder medan fyra dagar och slutdagen själv inte gör det, och
  dagslarmet tänder utan tak och tystnar inte av ett; och en leverabel med
  ENBART ärvt intervall tiger den 6/9, den 30/9 och den 4/10 men larmar den 5/10
  med `arvt_fran: 'S1'` — medan ett eget intervall vinner över det ärvda. Plus
  att samma förbrukning tänder eller tiger enbart beroende på trösklarna, och
  att inget larmobjekt bär ett fält som liknar en färdigställandegrad (NFR-11).
  **(b) Kopplingen genom stacken** på ett riktigt avtal: bekräftat tak 10 h/
  11 000 kr, 15 h registrerade, en ström med period t.o.m. 31/1 och en
  leverabel utan egna datum under den. Med 0068:s standardtrösklar tiger
  beloppen (300 min och 5 500 kr under golven) och kvar står dagslarmet på det
  ÄRVDA intervallet; efter en ändring av avtalets trösklar (golv 4 h/5 000 kr,
  `troskel_dagar` 10 000) tänder samma förbrukning två beloppslarm och
  dagslarmet tystnar — bevis för att talen är avtalets och inte kodens. En bokad
  dag framåt ger dessutom två prognoslarm bredvid utfallets, och grannuppdragets
  trösklar står kvar orörda. Trösklarna sätts i provet som ägarrollen (de har
  med flit ingen skrivväg) — riggning av indata, inte en andra skrivväg.

  **Kvarstår för David:** inget att migrera och ingenting i vyn. Larmen ligger i
  svepets cache under `troskellarm` så fort svepet körts. En åtgärd för att
  ändra trösklarna, larm på strömnivå, notifiering via `godkannare_eskalering`,
  en larmkolumn i en registervy och en omläggning av `takvarningEfterSparad` är
  medvetet uteslutna — källan kräver dem inte.

- **2026-09-06 (uppdragsytan S3.3, våg 5 — ålder i läget):** S3.1 gav
  leverabelregistret sin läsväg och S3.2 gav statusbytet sin händelserad. Men
  **registret svarade bara VILKEN status en leverabel står i, aldrig HUR LÄNGE.**
  En leverabel som stått i `pagar` sedan i maj såg i svaret exakt likadan ut som
  en som bytte läge i morse. FR-37 var alltså ett krav vars enda underlag —
  historiken i `uppdrag_leverabel_handelse` — ingen läsare rörde.

  Byggt: **fältet `dagar_i_laget` på `Leverabelrad`**, härlett i SELECT:en i
  `services/uppdragRegister.ts`, plus ett provblock i den befintliga sviten och
  två docs-rader. **Ingen migration, ingen schemaändring, ingen ändring i
  `actions/registry.ts`, ingen vy, ingen skrivväg, inga nya beroenden** — den
  redan registrerade read-åtgärden `las_leverabelregister` bär det nya fältet av
  sig själv, eftersom svaret ÄR tjänstens.

  1. **Härlett, aldrig lagrat — och det är hela poängen.** Överlämningens
     alternativ var en `status_sedan`-kolumn. En sådan är ett andra ställe där
     samma sanning står: den dag en skrivväg glömmer att uppdatera den driftar
     den ifrån historiken utan att någon ser det, och läsaren får en säker siffra
     som är fel. Ett härlett tal kan per definition inte drifta. `0068:131` sa
     det redan: "status utan historik är en gissning". Schemaprovet i
     `uppdragsytan-schema.test.ts:92` (ingen `status_sedan`-kolumn) står därför
     kvar orört — det är nu också beviset för att åldern aldrig kan läsas ur en
     lagrad kolumn.
  2. **Fallbacken till `created_at` är inte ett kantfall.** Importen (S1.2)
     skriver ALDRIG en händelse — bara `uppdragStatus.ts` gör det — så varje
     nyimporterat register består uteslutande av leverabler utan historik. Utan
     `COALESCE(max(h.created_at), l.created_at)` hade normalfallet gett NULL.
     Och ett hårdkodat 0 där hade varit värre än NULL: det ser ut som "bytte läge
     nyss", vilket är motsatsen till sanningen om en leverabel som legat
     orörd sedan importen.
  3. **`max()`, inte "den senaste raden vi råkar läsa".** Provet skriver därför
     den NYASTE händelsen först och den äldre efteråt: hade svaret kommit ur
     insättningsordningen eller ur en `ORDER BY … LIMIT 1` utan sortering hade
     det passerat ett prov med raderna i kronologisk ordning.
  4. **Subqueryn filtrerar på båda leden** (`h.leverabel_id = l.id AND
     h.company_id = l.company_id`) — husets sammansatta `company_id`-filter i
     varje join, samma nyckel som 0068:s främmande nyckel bär. RLS räcker; men
     ett filter som bara matchar på id vore ett ställe där en avstängd RLS blir
     en tyst läcka i stället för ett fel.
  5. **Dagar, inte timmar.** Källan frågar hur länge något stått still, och det
     svaret ändras inte av att klockan går. Fältet följer med oförändrat till den
     frysta registerkopian (`uppdragReferens.ts:427`) och svepet — ingen
     särbehandling, ingen filtrering.
  6. **Registervyn byggdes inte.** CTO-underlaget nämnde en kolumn i en registervy
     i `http/view/routes.ts` — men den vyn finns inte: den uteslöts uttryckligen i
     S3.1 på Davids beslut (byggjournal beslut-121), och kommentaren i
     `routes.ts:1467` bekräftar det. Överlämningens acceptans bärs av läsvägen,
     så en ny vy hade varit mer än källan kräver (Davids analysregel 1).

  **Grind:** typecheck och svit kördes INTE i den här sessionen (körs av
  körskriptet efteråt) — utfallet ska klistras in här innan bygget stängs. Nytt
  block i `server/test/uppdragsytan-register.test.ts`: två händelser 10 resp. 3
  dagar bakåt (den nyaste insatt först) → **3**; en leverabel utan händelser med
  bakåtdaterad `created_at` → **7**; en nyimporterad rad utan händelser → **0**
  (sant här, till skillnad från NULL-krockens vilseledande nolla); fältet på
  varje rad som heltal ≥ 0; och grannleverablernas historik som inte smittar
  (exakt en rad står på 3). Sviten skriver händelserna som ägarrollen — tabellen
  är append-only för `app` — vilket är riggning av historik, inte en andra
  skrivväg. Nyckellistan i S3.1:s befintliga prov utökades med fältet.

  **Kvarstår för David:** inget att migrera och ingenting i vyn. Registret läses
  som förut via `las_leverabelregister`, nu med åldern. Timmar eller finare
  granularitet, en initialhändelse vid importen och en registervy är medvetet
  uteslutna — källan kräver dem inte.

- **2026-09-06 (uppdragsytan S8.1, våg 4 — avslut med öppna leverabler):** 0068
  hade burit `contracts.avslutat_med_oppna` och `vagrar_skrivning_pa_avslutat()`
  sedan dag ett, men **ingen kodväg skrev kolumnen.** Följden: ett uppdrag som
  stängdes med `set_project_status` låste all skrivning mot sig i samma sekund —
  och det som stod ogodkänt just då gick därefter inte att skriva ner någonstans.
  FR-8 var alltså en kolumn utan ifyllare, och ett avslut var i praktiken ett
  tyst avslut.

  Byggt: **ny åtgärd `avsluta_uppdrag` (`sensitive`, ingen `kravManniska`)** i
  `actions/registry.ts`, **ny tjänstefil `services/uppdragAvslut.ts`**
  (`avslutaUppdrag` + läsfunktionen `lasAvslutslista`), **en panel på uppdragets
  förstasida** och ett nytt prov. Ingen migration (0068 bär både kolumnen och
  triggern — Davids fällda 0069-alternativ), inget nytt beroende, ingen
  scheduler, ingen ny CSS-klass, ingen ny rutt, ingen ändrad känslighet på någon
  annan åtgärd; `bekraftaStatusbyte`, svepet, leverabelregistret och
  `setProjectStatus` är orörda utöver anropet.

  1. **Beräkningen vid godkännandet krävde ingen egen mekanik.** `approveAction`
     kör åtgärdens handler i GODKÄNNANDETRANSAKTIONEN (`execute.ts:124`), så hela
     `avslutaUppdrag` — lista och stängning — hamnar rätt av sig självt. En
     leverabel som hinner bli `godkand` mellan förslag och godkännande står
     därför inte i listan. Att bygga en egen "beräkna vid godkännandet"-väg hade
     varit ett andra mönster för något huset redan gör.
  2. **Ordningen lista-före-stängning är hela atomiciteten.** Kolumnen skrivs per
     avtal FÖRE `setProjectStatus(…, 'closed')`, i samma transaktion: triggern
     hinner aldrig se ett stängt uppdrag före ifyllnaden, och faller något rullas
     hela avslutet tillbaka. Ett stängt uppdrag utan lista vore precis det tysta
     avslut kravet finns för att hindra.
  3. **Stängningen delegeras till tjänstefunktionen, aldrig till en andra
     åtgärd.** `set_project_status` behåller sin `kravManniska` orörd (samma
     regel som `andra_baseline` följer mot `upsertContractPart`), och dess egen
     `project.set_status`-auditrad skrivs som vanligt vid sidan om listans.
  4. **Tom array är inte NULL.** `{}` betyder "avslutad, och ingenting stod
     öppet"; NULL betyder "aldrig avslutad via åtgärden". Ett fält som betyder
     två saker är ett fält man inte kan lita på — och allt-godkänt-fallet ska
     TILLÅTAS avslutas, inte behandlas som ett specialfall.
  5. **Ett andra avslut fälls med 409 `uppdrag_redan_avslutat`**, med
     projektraden läst `FOR UPDATE`: listan är fryst historik (1E §3.1), och en
     omräkning mot dagens statusar hade skrivit över vad som faktiskt stod öppet
     vid avslutet.
  6. **Ytan: `.panel`, inte `.ai-card`.** Ockran betyder "väntar på en
     människa"; här finns inget att svara på — uppdraget är stängt och listan
     fryst. Panelen står högst upp på ett avslutat uppdrag (den enda frågan som
     är kvar är "vad blev inte klart?"), chipet bär färg OCH glyf OCH tal, och
     listan bär koderna och ingenting annat. Ingen avslutsknapp i vyn: avslutet
     köas som varje annan känslig åtgärd och godkänns i **Att göra**.

  **Grind:** typecheck och svit kördes INTE i den här sessionen (körs av
  körskriptet efteråt) — utfallet ska klistras in här innan bygget stängs. Ny
  svit `server/test/uppdragsytan-avslut.test.ts`: registret (okänt fält 400,
  okänt uppdrag 404 utan att stänga något); **(a)** agenten FÅR köa men skriver
  ingenting och kan inte godkänna, människans begäran lämnar `active` + NULL och
  ingen listrad i loggen; **(b)** godkännandet ger `['L2','L4']` (den godkända
  L1 utelämnad), status `closed`, listraden `uppdrag.avslutat_med_oppna` med
  listan i `details` och tjänstens `project.set_status` bredvid; **(c)** en
  leverabel som godkänns MELLAN förslag och godkännande står inte i listan;
  **(d)** allt godkänt → tom array (inte NULL) och avslutet tillåts; **(e)** ett
  andra avslut ger 409 med listan orörd och köposten kvar som `pending`; **(f)**
  vyn med koderna, "2 leverabler stod öppna", det rena avslutets "Inget stod
  öppet", ingen `<script>` och ingenting alls på ett pågående uppdrag. Plus
  KRAV-6: efter ett avslut GENOM ÅTGÄRDEN fälls alla fyra räckvidder mot just
  det uppdraget (modultabell-INSERT, ny `contract_parts`-rad,
  `receipts.contract_part_id` och `time_entries`-ompekningen i båda riktningar),
  medan SELECT mot samma tabeller — och uppdragssidan — fortsätter gå igenom.
  Provet att triggern FINNS ligger kvar orört i `uppdragsytan-sparrar.test.ts`.

  **Kvarstår för David:** inget att migrera. Avslutet köas via
  `avsluta_uppdrag` och godkänns i **Att göra**; listan läses därefter på
  uppdragssidan. Återöppning, tömning av listan, en avslutsknapp i vyn och
  `koaRegisterkopia` vid avslutet är medvetet uteslutna — källan kräver dem inte.

- **2026-09-06 (uppdragsytan S7.4, våg 4 — prognosen som vägrar gissa):** S7.3
  gav svepets steg 3 en cachenyckel `prognos` — men innehållet var en
  RÅSUMMERING av indatat (antal, minuter, första och sista datum). FR-5 frågar
  något annat: NÄR nås uppdragets ram, i timmar och i kronor? Det talet fanns
  ingenstans, och S10.4 hade alltså ingen kurva att rita.

  Byggt: **en ny ren, exporterad funktion `harledPrognosramar` i befintliga
  `services/uppdragSvep.ts`**, steg 3 omskrivet så att det läser underlaget,
  **en `export`-rad på `forbrukningForAvtal` i `contracts.ts`**, en ny svit och
  två docs-rader. Ingen migration, ingen ny åtgärd, ingen ny felkod, ingen vy,
  ingen ändring av svepets indata-schema, låset, hoppen eller bindningslogiken,
  inga nya beroenden.

  1. **Ren funktion, `idag` som argument.** Samma hållning som `byggForbrukning`
     i `contracts.ts`: ingen databas, ingen klocka, inga anrop. Samma indata ger
     samma utdata, vilket ÄR ADR-2:s omräkningsbarhet — en prognos som läser
     klockan inuti sig går inte att räkna om till samma rad i morgon.
  2. **Ingen andra takberäkning och ingen andra taxeordning.** Registrerad tid
     och tak kommer ur rotdelens nod i `forbrukningForAvtal` (`code === UPPDRAG`,
     `parent_code === null` — barnens tid är redan upprullad där), taxan ur
     `gallandeTaxa` utan post-/delled: en kalenderbokning bär ingen avtalsdel,
     och att välja en åt den hade varit en gissning. Davids beslutsregel 3 —
     husets mönster vinner över FRAGA:ns "projektets timtaxa".
  3. **Ett fält är ETT datum eller ETT villkor, aldrig ett tal utan underlag.**
     Villkoren prövas i ordning: `inget bekräftat tak` (oläst tak varnar aldrig
     — samma regel som `cap_status`) → `ingen taxa` (bara kronramen) → `ingen
     bokad framtid`. Men fakta går före villkor: är ramen redan nådd är datumet
     **i dag**, även utan en enda bokning framåt. Att svara "ingen bokad
     framtid" där hade dolt det enda som var säkert känt.
  4. **Bara bokningar EFTER i dag räknas.** Registrerad tid t.o.m. i dag bär det
     förflutna; utan gränsen hade en bokad och redan rapporterad dag räknats två
     gånger. Råsummeringens fyra fält står kvar oförändrade — de beskriver
     indatat, och ändringen mot befintliga prov skulle vara minsta möjliga.
  5. **Taktförlängningen är heltalsaritmetik.** Räcker bokningarna inte fram
     till ramen förlängs de med sin egen takt: `sista bokade datumet + ceil(
     resterande × spanndagar ÷ bokat totalt framåt)`, ceil via heltalsdivision.
     Aldrig ett flyttal som mellanled för ören. Det enda stället ett decimaltal
     blir heltal är `cap_hours` (numeric(8,2)) → hela minuter, en gång.
  6. **Svarets `hoppade`/`hoppade_kopior` byggs nu uttryckligen ur raden.**
     Uppdragsraden bär två nya taxekolumner, och ett spread av hela raden hade
     lagt avtalets prissättning i ett meddelande om att ett uppdrag är stängt.

  **Grind:** typecheck och svit kördes INTE i den här sessionen (körs av
  körskriptet efteråt) — utfallet ska klistras in här innan bygget stängs. Ny
  svit `server/test/uppdragsytan-prognos.test.ts` fryser den rena funktionen:
  känt indata → två olika kända datum (timramen 14/9, kronramen 21/9), exakt
  träff på en bokad dag, indataordningen som inte spelar roll, taktförlängningen
  (2 880 minuter över tre veckobokningar → 6/10) med avrundning UPPÅT (2 881 →
  7/10) och kronramens egen takt (26/10), redan nådd och passerad ram → i dag
  (även utan bokad framtid), bokningar t.o.m. i dag som inte flyttar något, samt
  alla tre villkorsnamnen — inklusive taket som prövas före taxan, takfälten var
  för sig (timdatum + kronvillkor och tvärtom) och en svepning över sex fall som
  visar att inget fält bär både datum och villkor eller ett tal. I
  `uppdragsytan-svep.test.ts` är prognosförväntningarna omskrivna till den nya
  formen (NVR-001:s tak är importerat men obekräftat → båda ramarna svarar
  `inget bekräftat tak`), och en ny beskrivning kör KOPPLINGEN genom hela
  stacken: bekräftat tak 20 h/33 000 kr, 10 registrerade timmar på rotdelen,
  taxan ur uppdraget, tre bokningar framåt → två olika datum, tom kalender →
  villkoret, och samma indata två gånger → identisk rad.

  **Kvarstår för David:** inget att migrera och ingenting i vyn. Renderingen av
  kurvan (S10.4), prognos per avtalsdel, varning när datumet närmar sig och
  lagrad prognoshistorik är medvetet uteslutna — källan kräver dem inte.

- **2026-09-06 (uppdragsytan S6.1, våg 4 — kostnad bunden till leverabel):**
  0068 gav `receipts` sitt `contract_part_id` och sin `oplanerad`, och S7.3 gav
  svepet sitt `kostnadsforslag:<receipt_id>`. Men **förslaget tog slut i
  cachen**: ingen kodväg satte kolumnen, så varje kostnad som hörde till
  uppdraget krävde en handpåläggning som inte fanns — eller blev aldrig bunden.
  FR-33 var alltså skriven men inte gången.

  Byggt: **ny åtgärd `binda_kostnad` (`sensitive`)** i `actions/registry.ts`,
  **ny tjänst `services/uppdragKostnad.ts`** (åtgärdens handler efter mönstret
  `assignContractPart`, svepets bindningssteg och lövvakten), **bindningssteget
  inkopplat i `korUppdragssvep`/`svepEttUppdrag`** och **en `oplanerad`-chip i
  kvittolistan**. Ingen migration, inget nytt beroende, ingen scheduler, ingen
  ny CSS-klass, ingen ny yta; `execute.ts`, `approvals.ts`, `obundnaKvitton`,
  `bindningsmal` och förslagshärledningen är oförändrade utöver det nya anropet.
  **Handgreppen är fortsatt fyra.**

  1. **Två grenar, ett kriterium: är målet ett omdöme?** Bär förslaget en
     `leverabel_kod` med en aktiv avtalsdel är målet ett LÖV — vilket löv en
     kostnad hör till kan bara en människa svara på, så svepet köar
     `binda_kostnad` genom `createApproval` (samma funktion som
     `executeAction`:s sensitive-gren, i svepets egen transaktion — mönstret
     från `avgorSignal`) och rör inte kvittot. Kan inget löv föreslås finns
     ingen fråga att ställa: kostnaden binds till strömmen vars intervall täcker
     datumet, annars rotdelen `UPPDRAG`, med `oplanerad = true` och auditraden
     `bindning: automatisk`. En köpost också där hade varit det femte
     återkommande handgreppet — en fråga vars enda svar är "ja, förstås".
  2. **Idempotensen mäts på det som kan bli en dubblett.** Ingen ny köpost när en
     *pending* `binda_kostnad` för samma `receipt_id` finns. Ett AVSLAGET
     förslag får däremot föreslås igen (ett nej är inte ett permanent nej), och
     ett utfört har satt kolumnen — då finns inget kostnadsförslag längre, för
     svepet föreslår bara obundna kvitton.
  3. **Automatbindningen är en bindning, aldrig en flytt.** `WHERE
     contract_part_id IS NULL` står i UPDATE-satsen, och en vakt i skrivvägen
     (inte bara i valet ovanför den) fäller varje automatmål som inte är
     rotdelen eller en ström direkt under den. Flytten finns — men bara genom
     kön: `binda_kostnad` flyttar gärna en automatbunden kostnad till rätt
     leverabel, och rör aldrig `oplanerad` (märkningen säger något om baselinen,
     och det blir inte osant för att någon flyttar kostnaden).
  4. **Kvitton utan kostnadsförslag rörs inte alls.** Bolagets allmänna
     kostnader hör inte till uppdraget; automatiken avgränsas till körningens
     `kostnadsforslag:`-värden (Davids förtydligande 6/9, 20:02).
  5. **Två nya provfiler:** `uppdragsytan-bindning.test.ts` (sensitive-flödet,
     det obligatoriska `contract_part_id`, flytten, `oplanerad` orörd, okända
     rader och tenantgränsen) och `uppdragsytan-svep-bindning.test.ts` (gren 1 +
     idempotens, gren 2 per datum med rot som reserv, ingen köpost, auditraden,
     bara-NULL-spärren, lövvakten och kvittot utan förslag). `korUppdragssvep`
     tog samtidigt `userId`/`actor` som argument — köposten ska visa vem som bad
     om bindningen — vilket ändrade fyra anrop i `uppdragsytan-svep.test.ts`.

- **2026-09-06 (uppdragsytan S5.2, våg 4 — signalen som blir tillägg):** S5.1 gav
  scopesignalen sin skrivväg och S1.3 gav `andra_baseline` sin, men **kedjan
  mellan dem fanns inte**. `uppdrag_scopesignal.ledde_till_part_id` hade legat i
  0068 sedan dag ett utan en enda kodväg som skrev den: ett "utanför" var ett
  avgörande som tog slut i sin egen rad. Följden var att FR-2/FR-4 saknade det
  led som gör dem läsbara — man kunde se att en fras avgjorts utanför uppdraget,
  och man kunde se att en ny avtalsversion fanns, men aldrig att det var SAMMA
  händelse.

  Byggt: **två valfria fält i `actions/registry.ts`** (`tillagg` på
  `avgor_scopesignal`, `signal_id` på `andra_baseline`), **två funktioner i
  befintliga `services/uppdragSignal.ts`** (köningen inuti `avgorSignal`,
  `lankaTillaggetTillSignal`) och **ett tilläggsformulär på signalsidan**. Ingen
  migration, ingen ny åtgärd, ingen ny CSS-klass, ingen ny felkodsfamilj utöver
  `signal_annat_avtal`, inga nya beroenden; `execute.ts`, `approvals.ts`,
  `upsertContractPart`:s skrivväg, känsligheten på varenda åtgärd och alla andra
  vyer är orörda. **Handgreppen är fyra och förblir fyra.**

  1. **Tillägget köas INUTI avgörandet — Davids korrigering, inte CTO:ns
     förslag.** 1E Del 4:s tabellrad säger att `avgor_scopesignal` "skapar
     tillägg via `andra_baseline` när 'utanför'", och människans godkännande i
     kön ÄR det andra handgreppet. En egen skapa-tillägg-åtgärd hade varit ett
     femte grepp framför ett grepp som redan finns. Köposten skapas därför med
     `createApproval` direkt i handlerns transaktion — aldrig via ett nytt
     `executeAction`-anrop (två anrop = två transaktioner = ett avgörande utan
     sitt tillägg den dag det andra faller).
  2. **`tillagg` är `andra_baseline`:s indata, inte en egen fältuppsättning.**
     Samma `AvtalsdelFalt` + samma krav (orsak ≥ 5 tecken, `valid_from`), och
     köposten valideras om mot just det schemat vid godkännandet. Två listor
     hade bara varit två ställen där samma sak kan sluta stämma.
  3. **Valfritt, aldrig obligatoriskt, och aldrig med gissat tak.** Alla
     utanför-signaler blir inte tilläggsavtal. Ett förifyllt tak vore ett
     fabricerat förslag — och ett tak som ingen läst i avtalshandlingen varnar
     ändå aldrig (`cap_confirmed` false = 'vet ej').
  4. **`innanfor` + `tillagg` är 400, inte en tyst bortsortering.** Låg frasen
     innanför uppdraget finns det inget att lägga till avtalet; en `superRefine`
     på det strikta objektet fäller kombinationen före varje skrivning. Samma
     grepp som `confirm_crm_value` redan använder.
  5. **Länken skrivs uteslutande i `andra_baseline`-handlern**, som per
     kömekaniken aldrig kör före `approveAction`. Det är hela acceptansen
     "inget skrivs förrän godkännandet": den bärs av BEFINTLIG sensitive-mekanik,
     och ingen ny spärrkod finns att kringgå. Två kontroller före UPDATE:n —
     signalen ska finnas i bolaget (404, jfr `kravAvtal`) och höra till samma
     avtal som tillägget (400 `signal_annat_avtal`) — och faller någon rullas
     HELA godkännandet tillbaka, alltså skrivs inte avtalsdelen heller. En
     signal på avtal A som pekar på en del i avtal B är ett fel spår, vilket är
     värre än inget spår.
  6. **Versionen hittas på (contract_id, code, valid_from)** — samma nyckel som
     `upsertContractPart` själv skriver på. Ett radsurrogat ur tjänsten hade
     krävt att skrivvägen ändrades, och den är avgränsad bort med flit.
  7. **Ytan: fälten hör till Utanför, och står före knapparna.** Kopplingen görs
     med HTML:s eget `form`-attribut (samma hållning som `popover` i radmenyn:
     noll skript), så de två svaren förblir två likvärdiga knappar utan förval
     och utan en tredje "Utanför + tillägg". Fälten ligger FÖRE knapparna i
     dokumentet: läggs de efter passerar den som tabbar sig fram svaret innan
     hon vet att de finns. *Innanför*-formuläret bär dem inte alls, så en
     ifyllnad kan aldrig råka följa med fel svar. Tomma fält = bara ett
     avgörande; halvfyllda = 400 och notisen står kvar på sidan, aldrig en tyst
     bortkastad ifyllnad. Texten under fälten säger var tillägget hamnar och
     länkar till **Att göra** — huset gör likadant vid varje annan köad åtgärd,
     och S5.1:s regel "inget `?ok=`, kvittot är den nya raden" står kvar.

  **Grind:** typecheck och svit kördes INTE i den här sessionen (körs av
  körskriptet efteråt) — utfallet ska klistras in här innan bygget stängs. Ny
  svit `server/test/uppdragsytan-tillagg.test.ts`: registret (ingen
  `*tillagg*`-åtgärd finns, känsligheterna oförändrade); **(a)** avgörandet med
  tillägg ger EN ny köpost med `signal_id`, auditraden
  `action.approval_requested` på köpostens id, och **noll** nya
  `contract_parts`-rader med `ledde_till_part_id` NULL — plus att ett anrop utan
  `tillagg` inte köar något alls och ett halvfyllt fälls av zod utan att ens
  avgöra signalen; **(b)** godkännandet skriver version 2, sätter länken till
  den NYA raden och lämnar januariversionen läsbar med sitt tak (samt en ny kod
  som blir en egen del, och `andra_baseline` utan `signal_id` som beter sig
  exakt som före bygget); **(c)** avslaget lämnar varken rad eller länk, men
  avgörandet står kvar — det var tillägget som avslogs; **(d)** signal mot ANNAT
  avtal ger 400 `signal_annat_avtal` med avtalsdelen tillbakarullad, okänd
  signal ger 404; **(e)** grannbolagets försök att låna vår signal ger 404 och
  lämnar deras egen avtalsdel oskriven; **(f)** `innanfor` + `tillagg` ger 400
  utan köpost och utan avgörande. Plus vyn: `form`-attributet och de fem fälten
  på utanför-formuläret utan en rad `<script>`, POST som köar genom
  action-lagret (timmarna parsade med husets komma-form, 8,5 → 8.5) utan att
  skriva en avtalsdel, tomma fält som bara avgör, Innanför utan fälten, och ett
  halvfyllt tillägg som blir en `?fel=`-notis i stället för en felsida.

  **Kvarstår för David:** inget att migrera. Tillägget fylls i under **Signaler**
  på uppdragssidan och godkänns i **Att göra**. Visning av `ledde_till_part_id`
  på signalsidan, spärr mot omavgörande och ett förifyllt tak är medvetet
  uteslutna — källan kräver dem inte.

- **2026-09-06 (uppdragsytan S3.2, våg 4 — statusbytet med transmittal):**
  Svepet (S7.3) hade börjat lägga `statusforslag:<kod>` i cachen, och 0068 hade
  gett `uppdrag_leverabel` sin status-CHECK med `avvisad` och
  `uppdrag_leverabel_handelse` sina transmittalkolumner. Men **ingen kodväg alls
  skrev `uppdrag_leverabel.status`.** Det var rätt så länge ingen behövde flytta
  en leverabel — och fel i det ögonblick svepet började observera: ett förslag
  som ingen kan besvara är en observation som ruttnar, och FR-12/FR-13 var två
  krav utan skrivväg.

  Byggt: **en ny tjänstefil `server/src/services/uppdragStatus.ts`**
  (`bekraftaStatusbyte`), **en def-post i `actions/registry.ts`**
  (`bekrafta_statusbyte`, `write` + `kravManniska: true`), **en vy-bit på
  uppdragets förstasida** (kort + POST-rutt `…/statusforslag`) och **ett nytt
  prov**. Ingen migration, ingen ny CSS-klass, ingen ny felkodsfamilj, inga nya
  beroenden; `uppdragSvep.ts`:s skrivvägar, `execute.ts`, `errorHandler.ts`,
  godkännandekön och känsligheten på alla befintliga åtgärder är orörda.

  1. **En enda skrivväg, och målstatusen är härledd.** Indata bär `utfall`
     (`bekraftad`/`retur`), aldrig ett fritt statusfält: ett sådant hade varit en
     ANDRA skrivväg — vilken status som helst på vilken leverabel som helst, med
     handgreppet bara som ett klick framför. En sökning i `server/src` ger nu
     exakt en `UPDATE uppdrag_leverabel`, och den står i den här filen.
  2. **Transmittalfälten fylls av systemet, aldrig av handen.** Mottagaren läses
     ur `contracts.godkannare`; är den NULL eller bara blanktecken skrivs
     **ingenting** (409 `saknad_mottagare`) — varken händelse eller status. Ett
     tomt mottagarfält i en append-only historik hade sett ut som en överlämning
     utan mottagare, en påhittad hade varit värre (FR-13). Inget redigerbart
     mottagarfält på ytan: det hade gjort spärren till en textruta.
  3. **Revisionen räknas ur historiken, aldrig ur Drive.** `1 + högsta revision`
     bland leverabelns händelser; första överlämningen = 1. Förslagets
     Drive-revision räknar filens versioner, inte våra överlämningar, och de två
     talen har ingen anledning att följas åt — provet sätter dem därför medvetet
     olika (Drive 12, överlämning 2). Returer bär NULL och räknas inte.
  4. **Retur är en post, inte en tyst flytt bakåt.** Samma spår
     (`bekraftat_av`/`bekraftat_nar`), status → `avvisad`, ingen revision och
     ingen mottagare — mottagarspärren gäller bara överlämningen.
  5. **`FOR UPDATE` på leverabelraden.** Utan låset kan två samtidiga
     bekräftelser båda läsa `pagar`, båda skriva revision 1 och båda sätta
     `levererad` — två överlämningar i en historik som inte går att rätta. Samma
     grepp som `lockPendingApproval`, inget nytt mönster.
  6. **Registerkopian köas i samma transaktion.** `koaRegisterkopia` har sitt
     eget kodkontrakt ("anropas i SAMMA transaktion som registerändringen"), och
     ett statusbyte ÄR en registerändring: statusen står i kopians innehåll via
     `lasLeverabelregister`. Det kravet är huset, inte ett tillägg.
  7. **Ytan följer S4.1/S5.1, inte en registervy.** Registervyn finns inte ännu
     (utesluten i S3.1), så kortet ligger på uppdragets förstasida under
     **Väntar på ditt svar** — före tidrapporteringen, eftersom en obesvarad
     leverans som läses sist blir i praktiken ett ja. Husets `.ai-card` med
     `aiMarkning()` (art. 50), underlaget i klartext (kod, Drive-revision,
     handlingens id), och **Bekräfta/Retur som två likvärdiga `btn--ghost` utan
     förval**: till skillnad från tidsförslagets *Godkänn/Justera* är det här två
     olika sanna svar på "tog kunden emot den?", och svaret kommer utifrån — görs
     den ena tyngre svarar man med handen i stället för med omdömet.
     Oåterkalleligheten står före knappen. Finns inget öppet förslag står
     ingenting alls (S7.2:s regel: brus lär läsaren att sluta titta).

  **Grind:** typecheck och svit kördes INTE i den här sessionen (körs av
  körskriptet efteråt) — utfallet ska klistras in här innan bygget stängs. Ny
  svit `server/test/uppdragsytan-statusbyte.test.ts` med de åtta fallen:
  **(e)** agenten fälls med 403 `human_required` på båda utfallen, med oförändrad
  auditlogg, noll händelser, orörd status och tom godkännandekö — plus ett
  medskickat `status`-fält och ett tredje utfall som båda ger 400 av `.strict()`;
  **(a)** bekräftelsen ger revision 1, mottagaren ur kontraktet, `bekraftat_av` =
  den inloggade och en riktig tidsstämpel, status `levererad`, grannleverablerna
  orörda, auditrad skriven och **registerkopian `koad`** (KRAV-5); **(b)** andra
  överlämningen ger revision 2 fast förslaget bär Drive-revision 12, med den
  första raden orörd, och räkningen är per leverabel (L3 får sin egen etta);
  **(c)** kontrakt utan godkännare → 409 `saknad_mottagare` med status orörd och
  noll händelser, detsamma för en godkännare som bara är blanktecken, medan
  returen på samma kontrakt går igenom; **(d)** returen skriver `avvisad` med
  spår men utan revision och mottagare, köar kopian, och räknas inte — nästa
  bekräftelse får revision 1; **(f)** saknat förslag → 404 för både bekräftelse
  och retur (returen är ingen bakdörr förbi underlaget); **(g)** grannbolagets
  användare → 404 med händelserna oförändrade och RLS på tabellen; **(h)** UPDATE
  och DELETE på `uppdrag_leverabel_handelse` som rollen `app` → `permission
  denied` med raden orörd. Plus vyn: kortet med AI-märkning och underlag, en
  besvarad leverabel som försvinner, POST som skriver genom action-lagret och
  auditloggas, `saknad mottagare` som notis i stället för felsida, tomt läge utan
  en rad markup, och 404 på grannbolagets uppdrag.

  **Kvarstår för David:** inget att migrera. Statusförslagen besvaras på
  uppdragssidan så fort svepet lagt ett. Bytena `ej_paborjad → pagar` och
  `levererad → godkand`, registervyn (FR-39) och avvikelseloggen system- kontra
  Drive-revision är medvetet uteslutna — källan kräver dem inte.

- **2026-09-06 (uppdragsytan S10.2, våg 3 — Planen: en JS-fri tidslinjevy):**
  0068 gav avtalsdelarna `start_date`/`end_date`/`date_precision` och S1.2:s
  import fyllde dem för NVR-001:s tre strömmar. Men **ingen yta läste dem.**
  Perioderna låg som datum i kolumner: att tre leverabler landade i samma
  vecka gick inte att SE förrän veckan var här, och FR-34 var ett krav utan
  läsare.

  Byggt: **en ny ren fil `server/src/lib/uppdragsplan.ts`** (`byggPlan` +
  `grupperaEfterSlut` — inga I/O, ingen klocka, indata in och tal ut), vysidan
  `/app/c/:id/projects/:projectId/planen` med knappen **Planen** i uppdragets
  knappband, **två CSS-klasser i `html.ts`** (`.tidslinje`, `.stapel`) och ett
  nytt prov. **Ingen migration, ingen ny åtgärd, ingen ändrad känslighet, ingen
  tjänstemutation, ingen ny felkod, inga nya beroenden**; `MCP_ACTIONS.md`,
  `designparitet.py` och designkontraktet är orörda (paritetsfönstret
  S10.2→S10.7 är byggregel, dokumenterad i 1G), och befintliga vyer och rutter
  är orörda utom knappen.

  1. **Rutnätet räknas i HELA MÅNADER, serverside.** CSS får tre tal —
     `--kolumner`, `--start`, `--span` — och inget datum. Räknades rutnätet i
     dagar måste ett kvartal få ett dagdatum, och då hade grafiken visat en
     exakthet som avtalet inte har. En stapel går från startdatumets månad till
     slutdatumets, båda inklusive: ett kvartal blir exakt sina tre månader.
     Precisionen följer med som `data-precision`, aldrig som geometri.
  2. **Tabellen bär ensam sanningen.** Hela grafiken har `aria-hidden="true"`
     (på varje rad, inte bara på behållaren) och innehåller inte ett värde som
     inte står i tabellen under — därför också en tidslinjerad per tabellrad, i
     samma ordning, även för de delar som saknar period. Går renderingen fel
     står datumen kvar i klartext.
  3. **Arvet är normalfallet, inte kantfallet.** Grävfyndet: `uppdragImport.ts`
     ger leverabler NULL i sina datum med flit (steg c — strömmens period
     gäller) och lämnar roten utan datum. En del ärver därför närmaste förälder
     med period, ritas streckad (`.stapel[data-arvd]`, 1D:s grammatik — ingen
     ny klass) och **tabellen skriver ut vilken del perioden kom ifrån**.
     Streckningen ensam hade varit information som bara finns i det lager som
     bär `aria-hidden`. Saknar hela kedjan datum ritas ingen stapel alls.
  4. **Ett intervall är BÅDA ändarna.** En del med bara startdatum ärver, precis
     som en helt datumlös — den andra änden hittas aldrig på. Det den faktiskt
     vet står kvar i tabellen, som saknat där det saknas.
  5. **Gällande version med SAMMA regel som takberäkningen** (`gallandeVersion`
     i `services/contracts.ts`): senaste ikraftträdda per delkod, annars den
     tidigaste. Planen och taket får aldrig visa var sin version av samma del.
  6. **Ytan följer huset, inte 1E:s vyplan.** 1E ritade `.subnav` och en egen
     stilmall; klassen finns inte i huset, och S4.1/S5.1 har redan lagt sina
     ingångar i uppdragets knappband. Per Davids beslutsregel 2 vinner huset:
     knapp i bandet, kanons tokens i `html.ts` (`--line`, `--accent`, `--mono`),
     ingen egen stilmall. På smal skärm byts tidslinjen mot 1D §4.2:s
     datumlista (försenat / denna vecka / senare) via en mediefråga — samma
     serverrenderade sida, ingen andra rutt, inget skript, ingen rullning i
     sidled.

  **Grind:** typecheck och svit kördes INTE i den här sessionen (körs av
  körskriptet efteråt) — utfallet ska klistras in här innan bygget stängs. Ny
  svit `server/test/uppdragsytan-plan.test.ts` i två lager: **(a) rutnätet som
  ren funktion** — blandade precisioner (dag/månad/kvartal/år) som alla ger
  hela månader, spannets kanter (första stapeln på 1, sista slutar på sista
  kolumnen), årsskiftet, ett slutdatum före startdatumet som ger en månad och
  inte ett negativt spann, arvet (närmaste förälder, hopp över datumlös
  mellandel, delens egna kolumner som står kvar tomma), saknad kedja → ingen
  stapel, en ände → arv respektive ingen stapel, gällande version före och
  efter ett tilläggsavtal, bara framtida versioner, inaktiv del vars aktiva
  barn INTE försvinner med den, trädordningen, en cyklisk kedja som ger ett
  svar i stället för en hängning, och datumlistans tre gränser (−1, 0, +6, +7)
  plus den periodlösa delen som inte hamnar i någon grupp; **(b) vyn genom
  stacken** på NVR-001:s riktiga fixtur — 200, knappen på uppdragssidan, ingen
  `<script>`, elva tidslinjerader med `aria-hidden` och nio staplar,
  stapelplaceringen (S1 1/2, S2 2/5, S3 6/2 över sju månader) verifierad mot
  gridtesterna och inte mot ögat, sex ärvda staplar med arvet i klartext i
  tabellen, tabellens koder och datum med saknat som saknat, CSS-kontraktet
  (`repeat(var(--kolumner),1fr)`, `var(--start)/span var(--span)`, mediefrågan
  som byter tidslinje mot datumlista), datumlistan på samma sida, uppdrag utan
  avtal, samt tenantgränsen (grannbolagets uppdrag 404, okänt uppdrag 404).

  **Kvarstår för David:** inget att migrera. Planen ligger under **Planen** på
  uppdragssidan. Baseline-skuggstapel, dagens-linje, milstolpar och
  beroendepilar är medvetet uteslutna — källan kräver dem inte, och 1D
  förbjuder rullning i sidled.

- **2026-09-06 (uppdragsytan S7.3 — granskningsfynd åtgärdat: KRAV-3 höll inte i
  Drive-vägen):** Granskaren underkände bygget nedan. KRAV-3:s löfte att 0068:s
  `vagrar_skrivning_pa_avslutat()` aldrig träffas gällde bara uppdragsloopen —
  `drive_kopior[]` gick rakt in i `rapporteraDriveKopia`, som gör en UPDATE på
  `uppdrag_referens` utan att projektstatusen prövades. Kön delas visserligen
  bara ut för öppna uppdrag, men uppdraget kan stängas MELLAN två svep: då kom
  Hermes rapport tillbaka mot ett stängt uppdrag → trigger-exception → 500 och
  rollback av HELA bolagets svep. Felet var dessutom fastnande: köposten stod
  kvar som `koad`, samma rapport kom tillbaka i varje svep, och bolagets svep var
  kilat tills någon handgrep. Precis det scenario KRAV-3 påstod var omöjligt.

  Åtgärdat: rapporterna slås först upp mot `uppdrag_referens` (en SELECT) och
  prövas mot SAMMA statusläsning som uppdragsloopen redan gjort (`per`-mappen).
  En rapport vars uppdrag inte är `active` hoppas och **redovisas** i svarets nya
  `hoppade_kopior[]` (`referens_id` + uppdraget) — ett tyst hopp hade sett ut som
  en tömd kö. En referens som inte hittas går som förut vidare till tjänsten och
  fälls där som 404. Nytt prov i KRAV-3-sviten: uppdrag med importerad kopia i
  kön → stängs → rapport skickas in; svepet svarar `svep_kort`, rapporten står i
  `hoppade_kopior`, det öppna uppdragets cache skrevs, och köposten står orörd
  (`koad`, platshållar-id kvar) utan att delas ut igen. Rört: `uppdragSvep.ts`,
  `uppdragsytan-svep.test.ts`, `MCP_ACTIONS.md`, den här raden.

- **2026-09-06 (uppdragsytan S7.3, våg 3 — svepet; sista repobiten i våg 3):**
  S7.1 gav referenserna sin skrivväg, S7.2 gav kopian sin kö och 0068 gav cachen
  sin tabell — men **ingen körde något av det.** `uppdrag_svepvarde` skrevs bara
  av ett prov, referenserna verifierades aldrig, spärrmappen kontrollerades
  aldrig och prognosen fanns inte. Följden: NFR-6:s krav att vyerna aldrig ringer
  ett grannsystem var uppfyllt på det billiga sättet — genom att ingen hade läst
  grannsystemen alls.

  Byggt: **en enda ny funktion, `korUppdragssvep` i befintliga
  `services/uppdragSvep.ts`** (med sitt strikta zod-schema), **en def-post i
  `actions/registry.ts`** (`kor_uppdragssvep`, `write`, ingen `kravManniska`) och
  **ett nytt prov**. Ingen migration, ingen vy, ingen rutt, ingen scheduler, inga
  nya beroenden, ingen ny felkod, ingen ändrad känslighet; `uppdragReferens.ts`,
  `uppdragRegister.ts`, `execute.ts`, `html.ts` och alla migrationer är orörda.

  1. **Anropet går åt två håll — och det är hela ADR-4.** Indatat ÄR förra
     arbetslistans resultat (vad Hermes SÅG i Drive, kalendern och mejlen), och
     svaret är NÄSTA arbetslista (referenser att verifiera + Drive-kön ur
     `hamtaDriveKo`). Svepet har därför ingen egen läsåtgärd mot ett grannsystem
     och behöver ingen. Även de skrivna Drive-kopiorna tas emot här — genom S7.2:s
     `rapporteraDriveKopia`, samma enda skrivväg, aldrig en andra — eftersom ett
     svar som lämnar tillbaka en redan tömd kö sluter loopen fel.
  2. **Låset är `pg_try_advisory_xact_lock`, inte sessionsvarianten.** Migratorns
     prejudikat kör på en egen anslutning och släpper med `client.end()`; svepet
     kör på en poolad, och där hade ett kraschat svep lämnat låset kvar för
     nästa användare av samma anslutning. Upptaget ger ett uttryckligt
     `svep_avstod` — auditrad får det ändå av `executeAction`, så ingen ny
     loggmekanism och ingen ny felkod behövdes.
  3. **`projects.status` läses FÖRE varje skrivning.** 0068:s
     `vagrar_skrivning_pa_avslutat()` hade annars fällt HELA körningen — för alla
     uppdrag — för att ett uppdrag avslutades i går. De hoppade redovisas, och
     varken deras referenser eller deras köposter kommer med i arbetslistan.
  4. **Ordningen står i svaret.** `nycklar` är härledningsordningen
     (`referenser:*` → `sparrmapp` → `prognos` → förslagen), inte den sorterade
     skrivordningen: ett ordningskrav som bara syns i koden går inte att pröva.
     Varje värde bär `kalla` (en rad per källsystem, så källan är sann) och
     `last_nar`.
  5. **Förslagen är cache och rör ingen ägd tabell.** `statusforslag:<kod>` föds
     ur indatans `revision` — repot avgör aldrig själv om en revision är "ny"
     (det ser inte Drive), och ett svep som gissade det ur sin egen cache hade
     slutat vara omräkningsbart. `kostnadsforslag:<receipt_id>` binder enligt
     **FR-33**: strömmen vars intervall täcker datumet, annars rotdelen
     `UPPDRAG`, bara när `contract_part_id` är NULL — aldrig en leverabel
     (`bakvag.py` fäller ett svep som binder till ett löv) och aldrig en flytt.
     Överlappar två strömmar vinner avtalets egen `sort_order`, så förslaget är
     detsamma vid varje körning.
  6. **Kopplingen leverabel↔handling kommer med indatat** (`leverabel_kod`).
     Den finns inte i schemat — en referens hänger på AVTALET — och gissas därför
     aldrig här; en kod utanför leverabelregistret ger inget förslag utan
     redovisas som `okanda_leverabelkoder`. Matchningen kvitto↔leverabel går på
     leverantörsnamnet i handlingens `titel_vid_lankning`, den enda tråd som
     finns mellan en kostnad i redovisningen och ett dokument i Drive.

  **Grind:** typecheck och svit kördes INTE i den här sessionen (körs av
  körskriptet efteråt) — utfallet ska klistras in här innan bygget stängs. Ny
  svit `server/test/uppdragsytan-svep.test.ts`: registret (`write`, ingen
  `kravManniska`, okänt fält 400, tomt anrop giltigt, agenten kör); ordningen
  (`nycklar` i härledningsordning, källa och lästidpunkt på varje rad, prognosen
  ur kalendern, och **cachen som bär läget EFTER verifieringen** — en drift kan
  inte ha varit känd före); låset (två samtidiga svep → ett `svep_avstod` som
  inte skrev något, och ett grannbolag som INTE hindras); stängda uppdrag (ingen
  cache, ingen verifiering, utanför arbetslistan); båda förslagsraderna ur
  riggat indata med FR-33:s tre fall (ström som täcker, rotdel när ingen gör det,
  och oktoberöverlappet som måste ge samma svar varje gång); samma indata två
  gånger → identiska rader; **negativa kontroller** (`uppdrag_leverabel` och
  `receipts` rad för rad oförändrade, `contract_part_id` fortfarande NULL, ingen
  `fetch(`/`node:http` i källan OCH en spärrad `globalThis.fetch` under
  körningen, obokat kvitto och omatchad leverantör utan förslag, okänd
  leverabelkod utan förslag, referens under fel uppdrag → 404 utan halvskriven
  cache); arbetslistan (id/källa/hash, köad kopia bara i kön, rapporterad kopia
  som flyttar från kön till referenslistan) och tenantgränsen.

  **Kvarstår för David:** inget att migrera och ingenting i vyn. Svepet körs
  utifrån av Hermes (S7.5) — schemaläggning, indatabygge och Drive-köns tömmare
  ligger där, inte här. `svepet.py`/`agandegrans.py` och drift väntar in S7.5.

- **2026-09-06 (uppdragsytan S7.2, våg 3 — Drive-kön för registrets frysta
  kopia):** S1.2:s import fyller leverabelregistret och S3.1 läser det, men
  **kopian till kundens spärrmapp hade ingen kö.** `uppdrag_referens.ko_status`
  fanns sedan 0068 med två lägen (`koad`/`skriven`) och ingen kod som satte
  dem — så en registerändring lämnade inget spår av att kopian var inaktuell,
  och S7.5 hade ingenting att tömma. Värre: fanns inget `fel`-läge var enda
  utvägen vid ett misslyckat försök att lämna posten som `koad`, alltså ett fel
  som ser ut som "väntar" — exakt det tysta fel NFR-3 förbjuder.

  Byggt: **additiv migration `0071_registerkopiako.sql`** (utökat CHECK-villkor
  + EN kolumn `ko_fel`, ingen GRANT-ändring, ingen backfill), tre funktioner i
  befintliga `services/uppdragReferens.ts` (`koaRegisterkopia`, `hamtaDriveKo`,
  `rapporteraDriveKopia`), **ett anrop i importens skrivväg** (steg e2 i
  `uppdragImport.ts`), **två def-poster** i `actions/registry.ts`
  (`hamta_drive_ko` read, `rapportera_drive_kopia` write) och en köpostrad på
  uppdragets projektsida. Ingen ny tabell, ingen scheduler, inga externa anrop,
  inga nya beroenden, ingen ny CSS-klass; `uppdragSignal.ts`,
  `uppdragBedomning.ts`, `uppdragRegister.ts`, `execute.ts` och befintliga
  migrationer är orörda.

  1. **Kön bor på referensen** (1E Del 3/ADR-4). En köad kopia ÄR en oskriven
     referens — samma rad som sedan bär Drive-id:t. En egen kötabell hade
     betytt två rader om samma sak och därmed en fråga om vilken som gäller.
  2. **Registerändringen går alltid igenom lokalt.** Köningen är en UPDATE i
     SAMMA transaktion som registerraderna; repot ringer aldrig Drive, så
     ingenting utanför huset kan hindra att registret skrivs. Anropet är
     ovillkorligt även när importen inte ändrade en rad: en identisk omskrivning
     kostar ingenting hos Hermes, medan en ändring som INTE köades är en tyst
     avvikelse mellan registret och kundens mapp.
  3. **Platshållar-id:t är radens identitet innan filen finns.** Kopian känns
     igen på `(sort, extern_nyckel) = ('drive', 'registerkopia')`, aldrig på
     `extern_id` — som föds som `registerkopia:<contract_id>` och byts mot
     Drive-id:t vid `skriven`. Därför tappar en omkö efter `skriven` inte
     pekaren: filen ska skrivas OM, inte skapas på nytt.
  4. **`fel` är ett lagrat, synligt tillstånd — och ingår i hämtningen.**
     Uteslöts det kunde kön aldrig "tömmas automatiskt när Drive svarar";
     en fastnad post hade krävt ett handgrepp för att ens komma tillbaka i kön.
     Ingen omprovning, backoff eller försöksräknare i repot (ingen scheduler);
     åldern bevakas av provvakten vid S7.5. Ingen ny felkod utöver
     `ingen_oppen_kopost` (409) för en rapport mot en rad utan öppen köpost.
  5. **Ingen `kravManniska` på någon av åtgärderna.** Kön ska tömmas utan
     handpåläggning (FR-11); en kö som kräver ett knapptryck per fil står full.
     Handgreppet som kräver en människa är att ÄNDRA registret, och det ligger i
     skrivvägen före kön (S0.1/S1.2). Rapportvägen fungerar därför med
     actor `agent`.
  6. **Ytan: raden syns bara när det finns något att veta.** Är kopian skriven
     står ingenting — en evig "allt är skrivet"-rad är brus, och brus lär
     läsaren att inte titta den dag det står något annat. `fel` visar
     `ko_fel`-texten i klartext på uppdragets förstasida, med chip som bär färg
     OCH glyf OCH text (färgen är aldrig ensam bärare). Ingen ny CSS, inget JS,
     ingen animation: statusraden läses många gånger om dagen, och rörelse på
     något så frekvent gör bara gränssnittet långsammare.

  **Grind:** typecheck och svit kördes INTE i den här sessionen (körs av
  körskriptet efteråt) — utfallet ska klistras in här innan bygget stängs. Ny
  svit `server/test/uppdragsytan-drive-ko.test.ts`: 0071 (kolumnen, villkorets
  fyra lägen, ett femte läge som fälls av databasen, migrationsfilen körd TVÅ
  gånger); åtgärdernas känslighet och strikta scheman inklusive fyra url-/
  sökvägsformer på `drive_id` som fälls **utan att röra köposten**; importen som
  lämnar en köad kopia med platshållar-id (och en fälld import som inte lämnar
  någon); hämtningen med registrets sex rader som innehåll och `fel` som står
  kvar i kön; tillståndsmaskinen `koad→skriven`, `koad→fel`, `fel→skriven`, samt
  **negativ kontroll** (andra rapport 409, referens utan kö 409, okänd referens
  404); agenten som tömmer kön; omkö efter `skriven` (Drive-id:t behålls) och
  efter `fel` (felet nollställs, fortfarande EN kopiereferens); vyn (köad syns,
  skriven försvinner, fel visar texten); och tenantgränsen (tom kö, 404 på
  rapporten, RLS, vår post orörd).

  **Kvarstår för David:** kör `npm run migrate` (0071). Därefter köas kopian av
  sig själv vid varje import, och köposten syns på uppdragssidan. Själva
  skrivningen till Drive görs av Hermes (S7.5) — repot skriver aldrig ut.

- **2026-09-06 (uppdragsytan S5.1, våg 3 — signalerna: kontraktets fraser får
  en människa som lyssnar):** 0068 gav `uppdrag_scopesignal` sin tabell, och
  S1.2:s import fyllde `uppdrag_scopelinje` med NVR-001:s sju signalfraser. Men
  **ingen kod kunde tända en signal och ingen kunde avgöra en** — fraserna låg i
  en tabell som ingen ingång läste, och scopelinjen mellan innanför och utanför
  uppdraget bevakades därmed av ingenting. Dessutom saknade `eskalera: true`
  (giltigt enligt 1E Del 7) helt lagring: eskaleringen hade blivit en knapp utan
  spår.

  Byggt: **additiv migration `0070_eskaleringsstampel.sql`** (EN kolumn,
  `eskalerad_nar timestamptz`, ingen backfill), tjänsten
  `server/src/services/uppdragSignal.ts`, **två def-poster** i
  `actions/registry.ts` (`tand_scopesignal`, `avgor_scopesignal` — båda `write`
  + `kravManniska: true`), vysidan
  `/app/c/:id/projects/:projectId/signaler` med knappen **Signaler** i
  uppdragets knappband, och ett nytt prov. Ingen ny felkod, inga nya beroenden,
  ingen ny CSS-klass, ingen scheduler; `uppdragReferens.ts`,
  `uppdragBedomning.ts`, `execute.ts`, `errorHandler.ts`, `html.ts` och
  befintliga migrationer är orörda.

  1. **Storyns Then är en NEGATIV mening**, och den kan bara bevisas negativt:
     ingen kodväg tänder eller avgör utan människa. Båda åtgärderna bär
     `kravManniska` (S2.1) och avvisar agenten med 403 `human_required` FÖRE
     varje skrivning — ingen köpost, ingen auditrad, ingen rad, och heller
     ingen referensrad (underlaget löses inuti tjänsten, som aldrig nås).
     `write` + `kravManniska` och inte `sensitive`, av exakt samma skäl som
     `satt_bedomning`: att köa människans eget beslut för hennes eget
     godkännande vore ett handgrepp utan innehåll.
  2. **`tand_av` härleds ur den inloggade användaren, aldrig ur indata.** Samma
     regel som `satt_av_manniska`. Kolumnen är `text` och inte en främmande
     nyckel till `users`: spåret ska gå att läsa i en rapport hos kunden långt
     efter att ett konto avslutats.
  3. **Underlaget är en referens, och samma mejl ger EN rad.** Ett Message-ID
     eller event-uid går genom `skapaReferens` (S7.1) — där url- och
     sökvägsspärren sitter, och den görs inte om här. Men ett längre mejl tänder
     ofta två fraser, så tjänsten LÄSER `(sort, extern_id)` innan den skriver
     (S1.2-mönstret); utan det hade den andra signalen fallit på
     `uppdrag_referens_uk` mitt i ett flöde där ingenting är fel. Id:t trimmas
     före uppslaget av samma skäl som `skapaReferens` trimmar det.
  4. **Eskaleringen är en tidsstämpel utan motiv.** FR-7 säger *utan*
     motivering, så det finns varken fält eller kolumn för ett — en tom
     motivkolumn hade sett ut som ett underlag ingen fyllde i. Tidsstämpel och
     inte boolean: NULL/NOT NULL bär samma ja/nej, men tidpunkten svarar också
     på "hur länge har det legat hos Eva?".
  5. **Ytan: öppna signaler överst, och två likvärdiga knappar.** En obesvarad
     scopefråga som läses sist blir i praktiken ett ja, så de öppna ligger före
     fraslistan. *Innanför* och *Utanför* är båda `btn--ghost`, ingen förvald —
     görs den ena tyngre svarar man med handen i stället för med omdömet.
     Underlaget ligger ett klick bort **per fras** (`<details>`) och inte i en
     gemensam ruta ovanför sju knappar: en delad ruta hade tyst kunnat fästa
     fel mejl på fel fras. Ingen `.subnav` (klassen finns inte i huset; S10.7
     äger menyn) — sidan följer S4.1:s knapp-på-uppdragssidan-mönster.
     Nyckelrymden (`rfc822#message-id`/`icalendar#uid`) fyller vyn själv; ett
     tredje textfält hade bara varit ett sätt att stava fel på en konstant.

  **Grind:** typecheck och svit kördes INTE i den här sessionen (körs av
  körskriptet efteråt) — utfallet ska klistras in här innan bygget stängs. Ny
  svit `server/test/uppdragsytan-signaler.test.ts` (mall `manniskosparr.test.ts`
  / `uppdragsytan-bedomning.test.ts`): 0070:s kolumn (timestamptz, nullbar, och
  0068:s elva kolumner kvar); **(a)** agenten kan varken tända eller avgöra —
  403 med oförändrad auditlogg, tom kö, noll signalrader och noll referensrader,
  medan samma anrop som människa ger 200, `tand_av` exakt profilnamnet och
  okända fält (`tand_av`, `avgjord`, `eskalerad_nar`) 400 av `.strict()`;
  **(b)** underlaget — Message-ID ger referensrad med id + nyckel + källa och
  signalens `underlag_ref_id`, andra frasen på samma mejl återanvänder raden,
  id:t trimmas, fyra url-/sökvägsformer fälls med 400 **och lämnar ingen tänd
  signal efter sig**, och en signal utan underlag är fortfarande en signal;
  avgörandets två värden plus ett tredje fällt av zod OCH av CHECK-villkoret,
  och en okänd signal som 404; eskaleringen (stämpel med `eskalera: true`, NULL
  utan, och inget motivfält att skicka in); **(c)** vyn — knappen på
  uppdragssidan, sju fraser förifyllda ur `uppdrag_scopelinje`, ingen `.subnav`,
  tomma lägen för avtal-utan-fraser och uppdrag-utan-avtal, POST som tänder med
  underlag + eskalering och auditloggas, POST utan underlag, och POST som avgör
  varvid signalen flyttar från Öppna till Avgjorda; samt tenantgränsen (404 på
  båda åtgärderna, RLS på tabellen, 404 på vysidan).

  **Kvarstår för David:** kör `npm run migrate` (0070). Därefter tänds och
  avgörs signaler i vyn under **Signaler** på uppdragssidan. Tilläggsskapandet
  (`ledde_till_part_id` via `andra_baseline`) är S5.2, våg 4;
  rapportrenderingen och delningsloggen bevisas i S4.2/S7.5.

- **2026-09-06 (uppdragsytan S3.1, våg 3 — leverabelregistret läses, och FR-19
  får sitt täckningsprov):** S1.2:s import fyller `uppdrag_leverabel` med
  klausul, acceptanskriterium, uppföljningsmått och läsväg (steg e), men
  **ingen ingång kunde läsa registret** — raderna fanns bara i tabellen. Och
  eftersom CHECK-villkoret i 0068 tillåter `matt_lasvag IS NULL` med flit kunde
  **ett mått utan läsväg passera tyst**: databasen kan aldrig säga "alla mått
  har en läsväg".

  Byggt: **en ny tjänstefil `server/src/services/uppdragRegister.ts`**
  (`lasLeverabelregister` — en SELECT och en avtalskontroll), **en def-post i
  `actions/registry.ts`** (`las_leverabelregister`, `read`, ingen
  `kravManniska`, `.strict()` med enbart `contract_id`) och **ett nytt prov**.
  Ingen migration, ingen vy, ingen rutt, inga nya beroenden, ingen ny felkod;
  `uppdragImport.ts`, parsern, alla skrivvägar och schema 0068 är orörda.

  1. **Radidentiteten är `(contract_id, kod)`** — samma nyckel som
     `uppdrag_leverabel_kod_uk`, och samma kod som står i kontraktstexten.
     Aldrig `contract_part_id`: avtalsdelen versioneras vid ett tilläggsavtal
     (ny rad i `contract_parts`), men L6 är samma leverabel före och efter.
  2. **Tomt är inte fel, okänt är 404.** Ett befintligt avtal utan
     registerrader ger en tom lista — avtalet kan vara skapat men inte
     importerat. Ett avtal som inte finns eller tillhör ett grannbolag ger
     `NotFoundError('contract')` som `hamtaAvtal`: RLS ger ändå noll rader, men
     en tom lista där hade varit ett svar som ser ut som "registret är tomt".
  3. **Täckningen bärs av provet, inte av schemat.** Att skärpa kolumnen till
     NOT NULL hade gjort saknat omöjligt att skriva — och saknat ska synas som
     saknat (S1.2 punkt 3). Kravet ligger därför i FR-19-provet, som läser
     **åtgärdens svar** och inte tabellen: det är den vägen modulen använder.
  4. **Ingen registervy och inget flaggfält i svaret.** Davids svar 6/9: enbart
     action-lagret tills registervyn får en egen story. Svaret bär raderna, och
     täckningskontrollen är anroparens — en `saknar_lasvag`-lista i svaret
     hade varit en andra sanning om samma sak.

  **Grind:** typecheck och svit kördes INTE i den här sessionen (körs av
  körskriptet efteråt) — utfallet ska klistras in här innan bygget stängs. Ny
  svit `server/test/uppdragsytan-register.test.ts` (mönster
  `uppdragsytan-import.test.ts`, riktig Postgres): åtgärden är `read` utan
  `kravManniska` och schemat fäller okänt fält och saknat `contract_id` (400);
  efter import av `LEVERANSKONTRAKT_NVR001` sex rader sorterade på kod utan
  STYRNING, fixturens fyra kontraktsburna fält (FR-9), svarets nycklar utan
  `contract_part_id`, **negativ kontroll: täckningen fäller EXAKT L6** med
  `matt_lasvag` null men med klausul, kriterium och mått kvar, samt
  grannbolagets 404; **positiv kontroll: samma text med L6:s läsväg ifylld**
  (den enda skillnaden pinnas i ett eget prov, så en misslyckad ersättning inte
  kan göra kontrollen tom) ger noll saknade; och tomt register → tom lista,
  okänt avtal → 404.

  **Kvarstår för David:** inget att migrera och ingenting i vyn — registret läses
  via MCP/API:t tills registervyn får sin story.

- **2026-09-06 (uppdragsytan S7.1, våg 3 — skrivvägen till referenslagret):**
  0068 gav `uppdrag_referens` sin tabell, sina tre lägen och sina rättigheter
  (SELECT/INSERT/UPDATE för `app`, ingen DELETE) — men **ingen kod kunde skriva
  en rad, och ingenting hindrade att raden blev en länk.** Kolumnerna
  `extern_nyckel` och `extern_kalla` tillåter NULL för de rader som fanns före
  tjänsten, så utan en spärr i skrivvägen hade en referens kunnat vara ett id
  utan nyckelrymd — eller en `https://drive.google.com/…` som slutar fungera
  den dag filen delas om. S7.2/S7.3 i våg 3 var blockerade av det.

  Byggt: **en enda ny fil, `server/src/services/uppdragReferens.ts`** —
  `skapaReferens`, `verifieraReferens`, `listaReferenser`, den rena
  `tillhorSparrmapp` och formprövningen `urlEllerSokvag`. **Ingen migration,
  ingen ny åtgärd i registret, ingen vy, ingen rutt, ingen ändring i `html.ts`
  (statustokens finns på rad 192–194), inga nya beroenden.** Mönstret är
  `uppdragSvep.ts`: `client: PoolClient` + `companyId`, körs inuti anroparens
  `withTenantTransaction`, inga externa anrop (ADR-4) — svepet läser den andra
  änden och lämnar resultatet hit.

  1. **En referens ÄR id + nyckel + källa** (FR-24, Davids ja 6/9 14:42 på
     analysfrågan). Alla tre krävs av det strikta zod-schemat. Ett id utan att
     veta vilken nyckelrymd det tillhör och vilket konto det lästes ur är inte
     en pekare, det är en sträng som råkar se ut som en. 0068:s NULL-tillåtelse
     rörs inte — den är till för de befintliga raderna, inte för nya.
  2. **Aldrig en url, aldrig en sökväg.** `://`, inledande `http` samt `/` och
     `\` avvisas i `extern_id` och `extern_nyckel`, med ett fel som säger vad
     man ska ange i stället. `extern_kalla` prövas INTE så: den namnger
     nyckelrymden (`drive:locollabs`), den pekar inte ut något. Id:t trimmas
     före prövningen — `" abc"` och `"abc"` är samma pekare, och utan
     trimningen hade `uppdrag_referens_uk` släppt igenom dem som två rader.
  3. **Drift är inte trasig.** En ände som ändrats kan fortfarande läsas; en
     som försvunnit kan inte det. Slås de ihop blir varje omdöpt fil ett larm,
     och då slutar man titta på larmen — och då syns inte den försvunna filen
     heller. `titel_vid_lankning`/`hash_vid_lankning` skrivs ALDRIG om vid en
     verifiering: gjorde de det skulle drift bara kunna upptäckas en gång.
  4. **Utelämnat är inte tomt.** Anroparens läge skiljer `undefined` (fältet
     lästes inte → jämförs inte) från `null` (fältet lästes och saknades →
     avvikelse). Ett svep som bara läser hashen får inte råka nolla
     titeljämförelsen. Saknas baslinjen (NULL vid länkningen) blir det aldrig
     drift — en drift räknad mot ingenting är en gissning som ser ut som ett
     fynd.
  5. **Spärrmappen avgörs på ID-likhet i en förälderkedja anroparen levererar**
     — aldrig prefix, aldrig sökväg, aldrig ett eget Drive-anrop. Två mappar
     kan heta samma sak, och `0AKx…NVR` är ett prefix av `0AKx…NVR-gammalt`.
     Kedjan valideras med samma spärr som id:t: en sökväg som smugit sig in där
     hade annars bara gett ett tyst nej, och ett tyst nej på en
     spärrmappskontroll är den farligaste sortens fel. Att en flyttad fil
     bedöms om följer av att kedjan är indata — samma id, ny kedja, nytt svar.
  6. **Ingen ny felkod utöver dubbletten.** `uppdrag_referens_uk` fångas som
     409 `referens_finns_redan` (mönstret `already_posted`/`article_exists`),
     zod ger 400 `validation_error` via befintliga `errorHandler.ts`, och ett
     grannbolags avtal svarar 404 — inte ett databasfel ur den sammansatta
     främmande nyckeln.

  **Grind:** typecheck och svit kördes INTE i den här sessionen (körs av
  körskriptet efteråt) — utfallet ska klistras in här innan bygget stängs. Ny
  svit `server/test/uppdragsytan-referens.test.ts`: negativkontrollerna (sju
  url- och sökvägsformer × `extern_id` och `extern_nyckel` MÅSTE fällas, plus
  raden att noll sådana rader nått databasen), FR-24 (saknad `extern_nyckel`
  respektive `extern_kalla` fälls, okänt fält fälls av `.strict()` så att
  `status` aldrig kan sättas utifrån, raden föds `levande` och overifierad,
  samma id under annan sort är en annan referens, dubbletten ger 409,
  grannbolagets avtal ger 404 och får ingen rad), lägena (oförändrad →
  `levande` med `senast_verifierad` satt, ändrad titel → `drift` med baslinjen
  orörd, ändrad hash → `drift`, båda → båda avvikelserna, saknad ände →
  `trasig`, återkomsten → `levande` igen, ett oläst fält som inte jämförs, en
  titel som försvunnit ur källan, ingen baslinje → ingen drift, samt
  tenantgränsen) och kedjekontrollen (tillhör/tillhör-inte, prefixfallet som
  MÅSTE ge nej, den flyttade filen med samma id och ny kedja, och sökvägen i
  kedjan som fälls).

  **Kvarstår för David:** inget att migrera och ingenting att göra i vyn —
  tjänsten har ännu ingen åtgärd och ingen yta. Den anropas först av S7.2/S7.3
  (referenslistan och svepet). Backfill av `extern_nyckel`/`extern_kalla` för
  befintliga rader ingår inte.

- **2026-09-06 (uppdragsytan S4.1, våg 2 — bedömningen sätts av en människa):**
  0068 gav bedömningen en tabell med tre lägen och rättigheterna SELECT + INSERT,
  och S2.1 gav lagret `kravManniska`. Men **ingen kunde sätta en bedömning:** det
  fanns ingen åtgärd och ingen yta. Uppdragets enda subjektiva tal — håller det
  som lovats? — bodde alltså ingenstans, och FR-14/15/17 var tre krav utan
  skrivväg.

  Byggt: åtgärden **`satt_bedomning`** (`write` + `kravManniska: true`,
  ett handgrepp) i `actions/registry.ts`, tjänsten
  `server/src/services/uppdragBedomning.ts` (EN INSERT + en läsfunktion) och
  vysidan `/app/c/:id/projects/:projectId/bedomning` med knappen **Bedömning**
  på uppdragssidan. **Ingen migration, inga nya beroenden, ingen ny felkod,
  ingen ändrad känslighet på någon annan åtgärd, ingen ny CSS.**

  1. **`satt_av_manniska` hårdkodas till `true` — det är aldrig indata.**
     Kolumnen är svaret på "satte en människa den?", och med `kravManniska` är
     svaret per konstruktion ja. Ett indatafält hade återinfört exakt den
     lögnmöjlighet kolumnen finns för att utesluta: en agent som intygar om sig
     själv. Provet skickar in fältet ändå och får 400 av det strikta schemat.
  2. **`write` + `kravManniska`, inte `sensitive`.** Kön finns för beslut som
     ska LÄSAS av en människa innan de gäller. Här är människan redan den som
     beslutar; att köa hennes bedömning för hennes eget godkännande vore ett
     handgrepp utan innehåll (1E Del 4). Spärren är i stället att ingen ANNAN
     kan sätta den — 403 `human_required`, före varje skrivning.
  3. **Oföränderligheten är en rättighet, inte en konvention.** Tjänsten har
     ingen UPDATE och ingen DELETE därför att rollen `app` inte har dem (0068).
     Provet skriver därför UPDATE och DELETE rakt mot tabellen som `app` och
     kräver `permission denied` — regeln ska gälla även för kod som inte går
     genom tjänstelagret. Rättar man sig sätter man en NY bedömning; ingen
     unik-spärr hindrar två om samma period, och den första står orörd (FR-17).
  4. **CTO:ns analysfråga besvarad: ingen datumspärr, ingen rytm-visning.**
     1E Del 7 lämnar FR-14:s rytm utan både lagring och läsare i v1 — den bärs
     av styrgruppsmötena i Davids kalender. Med Davids regler (1) och (2) faller
     därmed både spärren mot "fel dag" och rutan "nästa bedömningstillfälle"
     bort. Att bedömningen kan sättas vilken dag som helst är avsiktligt.
  5. **Ytan: tre synliga val, inget förvalt, och oåterkalleligheten före
     knappen.** En dropdown har ett värde redan innan man bestämt sig, och det
     värdet går inte att ta tillbaka efteråt — därför radioknappar i en
     `fieldset` med `required` och varje läges innebörd utskriven bredvid
     chippen (ok/warn/neg, husets färgspråk plus glyf, aldrig färg ensam).
     Historiken står på SAMMA sida: bedömningen görs mot det man sa förra
     gången, och ligger den bakom ett klick till sätts varje bedömning från
     noll. Kvittot efter en skrivning är den nya raden och läget i sidhuvudet —
     inget `?ok=`, som annars hade blivit kvar bredvid `runViewAction`:s `&fel=`
     och gett en sida som säger både "klart" och "gick inte".

  **Grind:** typecheck och svit kördes INTE i den här sessionen (körs av
  körskriptet efteråt) — utfallet ska klistras in här innan bygget stängs. Ny
  svit `server/test/uppdragsytan-bedomning.test.ts`, de tre lagren ur risken
  (mall `manniskosparr.test.ts`): (a) agent-token via REST → 403
  `human_required` med oförändrad auditlogg, noll rader och tom godkännandekö,
  samma anrop som människa → 200, och `satt_av_manniska` som indata → 400;
  (b) UPDATE och DELETE som `app` → `permission denied` med raden orörd;
  (c) vyns POST → raden med `satt_av_manniska = true`, NULL i
  `handelse_ref_ids`/`frysta_siffror`, audit `action.executed:satt_bedomning`
  och den nya raden synlig på sidan. Plus KRAV-5: alla tre lägena med och utan
  kommentar, ett fjärde läge fällt av zod (400) OCH av CHECK-villkoret, en
  andra bedömning för samma period bredvid en oförändrad första, och
  tenantgränsen (404 på åtgärden, RLS på tabellen, 404 på vysidan).

  **Kvarstår för David:** inget att migrera. Bedömningen sätts i vyn under
  **Bedömning** på uppdragssidan. Svepets kolumner (`handelse_ref_ids`,
  `frysta_siffror`) fylls först av senare stories.

- **2026-09-06 (uppdragsytan S1.2, våg 2 — uppdraget skapas, kontraktet
  importeras):** 0068 gav kontraktet sitt tillstånd men ingen dörr in i det:
  `create_contract` skapar alltid ett utkast, ingen åtgärd frös något, och
  därför gick **ett bekräftat tak inte att sätta på ett nyskapat avtal — inte
  ens ett undertecknat.** Baselinespärren var rätt och samtidigt omöjlig att
  använda. Samtidigt fanns NVR-001:s frysta leveranskontrakt bara som text i
  Drive: 430 h och 473 000 kr som ingen kolumn kände till.

  Byggt: **migration `0069_signering_fryser.sql`** (EN triggerfunktion, ingen
  ny tabell, ingen kolumn, ingen backfill), den rena parsern
  `server/src/lib/leveranskontrakt.ts`, tjänsten
  `server/src/services/uppdragImport.ts` och de två åtgärderna **`skapa_uppdrag`**
  och **`importera_leveranskontrakt`** (båda `write`, engångs). Ingen vy, inga
  nya beroenden, ingen ändrad känslighet, `assign_contract_part` orörd.

  1. **Att signera ÄR att frysa.** Triggern härleder `kontrakt_tillstand` ur
     `signed_date` i stället för att låta någon sätta det: två fält som kan
     stå i strid med varandra kommer att göra det. Ingen egen frys-åtgärd
     behövdes därmed — `update_contract` med datum räcker — och regeln gäller
     för alla tre skrivvägarna eftersom den sitter i Postgres.
  2. **`BEFORE INSERT OR UPDATE OF signed_date`, inte ett rent UPDATE.** En
     UPDATE som bara rör `kontrakt_tillstand` ska fortsätta falla på
     `vagrar_avfrysning` (0068) med dess RAISE. BEFORE-triggrar körs i
     bokstavsordning, så en trigger på ALLA uppdateringar hade hunnit skriva
     tillbaka 'fryst' innan `contracts_vagrar_avfrysning` läste raden — en
     spärr som tyst rättar i stället för att säga nej är ingen spärr.
     Invarianten består ändå: varje skrivning av `signed_date` passerar här.
  3. **Parsern gissar aldrig.** Hittas inte ett fält blir det NULL och räknas
     upp i svarets `saknade_falt`. Precisionen på ett datum läses ur formen
     (`2026-09` = månad, med månadens sista dag som slut) — den antas inte.
     Beloppet räknas i heltalsören hela vägen. Fixturen `server/test/fixtures/`
     kopierar kontraktets struktur, och `L6` saknar sin läsväg MED FLIT så att
     luckan följs hela vägen ner i kolumnen.
  4. **Importen bekräftar aldrig ett tak.** `cap_confirmed` är Davids, och
     kräver ett fryst kontrakt (0068). Ett tak som en maskin bekräftat åt en
     människa är exakt det olästa tak som aldrig varnar.
  5. **Idempotensen är en LÄSNING, inte en överskrivning.** En del som redan
     står som importen vill ha den skrivs inte om: `upsertContractPart` sätter
     `manually_edited` vid varje ändring, så en blind andra körning hade lagt
     ett ändringsspår efter en körning som inte ändrade något. Registret bärs
     av `UNIQUE (contract_id, kod)` (DO NOTHING — en människas `status` nollas
     aldrig av en import) och scopelinjerna läses innan de skrivs, eftersom
     `app` saknar DELETE på den tabellen.
  6. **`skapa_uppdrag` utan `signed_date` svarar 400 `valid_from_required`.**
     Rotdelens `valid_from` går inte att härleda ur ett avtal ingen skrivit
     under, och ett gissat startdatum flyttar tyst ett tak i tiden
     (contracts.ts rad 620). Fältet är alltså valfritt i schemat men krävs i
     praktiken för att uppdraget ska kunna skapas — det står i MCP_ACTIONS.md.
     **Öppen fråga till David:** ska åtgärden i stället ta ett eget
     `valid_from` för det osignerade fallet?

  **Grind:** typecheck och svit kördes INTE i den här sessionen (körs av
  körskriptet efteråt) — utfallet ska klistras in här innan bygget stängs. Ny
  svit `server/test/uppdragsytan-import.test.ts`: parsern som ren funktion
  (tabell av fall för timmar/ören/datum/läsväg, hela fixturen, och en text utan
  fält som ger NULL rakt igenom), `skapa_uppdrag` (fryst avtal + rotdel; utan
  datum 400 och NOLL halvskapade avtal), importen (rotens 430 h/47 300 000 ören
  med `valid_from = signed_date`, strömmarnas period och precision, L1–L6 under
  sin ström med ärvt intervall, STYRNING utan registerrad, exakt sex
  registerrader, femton scopelinjer, godkännarna, `change_reason` på varje del,
  inget bekräftat tak, `get_contract_usage` med 430 h som `vet_ej`, den andra
  importen som inte ändrar en rad, och tenantgränsen), samt 0069 (fryst vid
  födseln, utkast som fryses av `update_contract`, nollad `signed_date` som
  fälls, bekräftat tak som går igenom på signerat men fälls på utkast).
  **KRAV-8:** `uppdragsytan-sparrar.test.ts` speglar nya läget — `nyttAvtal`
  sätter `signed_date` och föder alltså frysta avtal, så de prov som behöver ett
  UTKAST använder nya hjälparen `nyttUtkastavtal`, och blocket "vad 0068
  stänger" heter nu "vad 0068 stängde, och vad S1.2/S1.3 öppnade".

  **Kvarstår för David:** kör `npm run migrate` (0069). Därefter: `skapa_uppdrag`
  för NVR-001 och `importera_leveranskontrakt` med kontraktstexten (den skickas
  in som indata — systemet läser aldrig Drive). Att bekräfta taken
  (`cap_confirmed`) är hans eget steg via **Att göra**.

- **2026-09-06 (uppdragsytan S0.1, våg 2 — sensitive på avtalsåtgärderna,
  människokrav på uppdragsavslutet):** FR-4 säger att en ändrad baseline ska
  passera en människa. `andra_baseline` (S1.3) var köad från dag ett — men
  **taket gick att flytta bredvid den kön:** `upsert_contract_part` och
  `update_contract` var `write` och kördes rakt igenom, och en agent kunde
  stänga ett helt uppdrag med `set_project_status`. En spärr som har en väg
  runt sig är ingen spärr, och FR-4 var därmed tom — för ILT:s och NVR:s
  riktiga avtalstak, i dag.

  **Kodytan är tre rader i `actions/registry.ts`:** `upsert_contract_part` och
  `update_contract` `write` → `sensitive`, och `kravManniska: true` på
  `set_project_status` (vars `sensitivity` förblir `write`). Ingen migration,
  ingen vykod, ingen ny felkod, ingen ändring i `errorHandler.ts`, inga nya
  beroenden. `assign_contract_part` är oförändrat `write`.

  1. **Två mekanismer, två olika sorters beslut.** Ett tak är en ändring som
     ska LÄSAS innan den gäller → godkännandekön (`sensitive`). Ett avslut
     stänger all skrivning mot uppdraget (0068) och är inget en agent ens ska
     kunna föreslå → `kravManniska` (403 `human_required`, ingen köpost, ingen
     auditrad, ingenting skrivet).
  2. **Kö + audit FÖRE godkännandet är rätt och fälls inte.** Raden
     `action.approval_requested` är spåret av att någon bad om ändringen, inte
     ändringen. Domänskrivningen sker först vid godkännandet.
  3. **Triggerfelen flyttade tidpunkt, inte utfall.** 0068:s P0001 når klienten
     som 409 `rule_violation` som förut — men nu från godkännandet, varvid
     transaktionen rullas tillbaka och köposten står kvar som `pending`.
  4. **Vyn behövde ingen rad.** Den har inget redigeringsformulär för
     avtalsdelar (avtal skapas via `create_contract_from_draft`, som går direkt
     på tjänstelagret), och `runFormAction` redirectar redan generiskt till
     `/app/c/:id/approvals` vid `pending_approval`. KRAV-6 bevisas därför i
     action-lagret — Davids svar 6/9 på beslutsfrågan.

  **Grind:** typecheck och svit kördes INTE i den här sessionen (körs av
  körskriptet efteråt) — utfallet ska klistras in här innan bygget stängs. Ny
  svit `server/test/bakvag.test.ts` (vaktprovet, mall `manniskosparr.test.ts`):
  tre registerkontroller (ingen `foresla_*`-åtgärd i registret; `andra_baseline`
  sensitive; `upsert_contract_part`/`update_contract` sensitive), den negativa
  regressionen (samma kontrollogik mot en registerKOPIA där
  `upsert_contract_part` sänkts till `write` MÅSTE fälla — kopia i minnet i
  stället för mallens modulmock, som hade gällt hela filen och slagit ut
  beteendeproven), avgränsningsraden att `assign_contract_part` är kvar `write`,
  samt beteendet: agentens `upsert_contract_part` → 202 med köpost i
  `action_approvals` + auditrad `action.approval_requested` men INGEN
  avtalsdelsrad; agentens `set_project_status` → 403 `human_required` med
  oförändrad kö, oförändrad auditlogg och uppdraget kvar `active`; människans
  samma avslut → 200; och människans `upsert_contract_part` → 202, raden skrivs
  först vid godkännandet, `get_contract_usage` visar det nya taket.

  **Sex befintliga sviter följer efter höjningen** (samma anrop, nu genom kön
  via en `godkannAction`/`koaOchGodkann`-hjälpare i respektive fil):
  `avtalsdelar`, `uppdragsytan-baseline`, `uppdragsytan-sparrar`,
  `tid-rapporter`, `tidsforslag`, `tid-snabbregistrering` och
  `avtal-inlasning`. Zod-felen (400) prövas fortfarande på BEGÄRAN — schemat
  parsas före sensitivity-grenen i `executeAction`.

  **Kvarstår för David:** inget att migrera. Efter merge går varje ändring av
  ett avtalstak — hans egen med — via **Att göra**: två handgrepp i stället för
  ett. Frysning av ett nyskapat kontrakt har fortfarande ingen åtgärd.

- **2026-09-06 (uppdragsytan S2.1, våg 1 — `kravManniska` i åtgärdslagret):**
  Ett sjätte, VALFRITT fält `kravManniska?: boolean` på `ActionDef`
  (`actions/registry.ts`) och en spärr i `executeAction` (`actions/execute.ts`):
  `kravManniska && actor !== 'human'` → `ForbiddenError('human_required',
  'åtgärden kräver en människa')` FÖRE sensitivity-grenen och före all
  transaktion — ingen godkännandepost, ingen domänskrivning, ingen auditrad
  (lagret loggar inte avvisningar i dag, jfr `contractor_not_permitted`; Davids
  svar 6/9 på analysfrågan: NEJ till auditrad). Spärren sitter i action-lagret,
  inte i transportlagret, så den håller för alla tre ingångarna — vyn anropar
  `executeAction` direkt och MCP går via REST-rutten `/actions/:action`, som
  saknar `requireHuman`. Namnet är medvetet inte `requireHuman`: två mekanismer
  på två lager ska inte heta samma sak. **Ingen migration, inga nya beroenden,
  ingen ny behörighetskod, och ingen befintlig åtgärd sätter fältet**
  (`set_project_status` får det i S0.1, våg 2). Ny svit
  `server/test/manniskosparr.test.ts` via REST-rutten med agent-token: (negativ)
  teståtgärd med fältet → 403 `human_required` med oförändrad auditlogg, tom
  godkännandekö och ingen skriven rad; (positiv) samma åtgärd som människa →
  200; (kontroll) åtgärd UTAN fältet opåverkad av actor, plus en rad som fäller
  provet om kontrollfallet inte kört. Teståtgärderna finns bara i testet (mock
  av `registry.getAction`) — registret har ingen injektionspunkt.
  **Grind:** typecheck och svit kördes INTE i den här sessionen (körs av
  körskriptet efteråt) — utfallet ska klistras in här innan bygget stängs.

- **2026-09-06 (uppdragsytan S1.3, våg 1 — orsakens skrivväg och
  `andra_baseline`):** 0068 stängde en väg som fungerade före den:
  `kraver_orsak_vid_ny_version()` kräver `change_reason` vid varje ny version
  av samma (contract_id, code), men `upsert_contract_part` hade inget sådant
  fält. **Följden var att ingen ny version gick att skapa alls — inte ens av
  David, inte ens med rätt skäl i huvudet.** Ett tilläggsavtal fanns det ingen
  väg in för, och ett tak som inte går att skriva in kan aldrig varna: samma
  mening som PRD §1 rad 6, ett varv senare.

  Byggt: fyra VALFRIA fält (`change_reason`, `start_date`, `end_date`,
  `date_precision`) på `upsert_contract_part`-schemat, i
  `UpsertContractPartInput`, i allowlisten `CONTRACT_PART_UPDATE` (elva → femton
  nycklar) och i INSERT-satsen (fjorton → arton kolumner), samt den nya
  åtgärden **`andra_baseline`** (`sensitive`). **Ingen migration, ingen ny
  tabell, ingen vy, inga nya beroenden, ingen ändring i `errorHandler.ts`;**
  `assign_contract_part`, `update_contract`, `get_contract_usage`,
  `contractExtraction.ts` och känsligheten på befintliga åtgärder är orörda.
  Rörda filer: `services/contracts.ts`, `actions/registry.ts`, en ny testfil,
  `docs/MCP_ACTIONS.md`, `docs/STATUS.md`.

  1. **Fälten är valfria, och det är villkoret för att de fick läggas till.**
     Den FÖRSTA versionen av en kod ändrar ingenting och behöver inget skäl.
     Hade `change_reason` varit obligatoriskt i den vanliga skrivvägen hade
     Davids skarpa flöde — vyns avtalsformulär och `create_contract_from_draft`
     — slutat fungera samma dag. Utelämnat fält skrivs som NULL; prov (f) och
     inläsningsprovet pinnar att anrop utan de fyra fälten beter sig exakt som
     före bygget.
  2. **`andra_baseline` är känslig av samma skäl som `book_invoice`.** En
     ändrad baseline flyttar vad kunden har lovats. Ett agentanrop svarar 202
     `pending_approval` och skriver INGEN rad; posten hamnar i Att göra och
     körs först när en människa godkänt exakt det lagrade indatat. Handlern
     anropar `upsertContractPart` direkt — ingen egen SQL, inte `executeAction`
     mot en annan action: två skrivvägar till samma tabell betyder två
     uppsättningar regler, och då är minst en fel utan att någon vet vilken.
  3. **Skillnaden mot `upsert_contract_part` är bara vad som KRÄVS**
     (`change_reason` ≥ 5 tecken efter trimning, `valid_from`). En "ny version"
     utan eget `valid_from` vore en överskrivning av den befintliga raden, och
     en utan skäl vore en tyst sådan. Fältuppsättningen delas därför som EN
     const (`AvtalsdelFalt`) i registret; två handskrivna kopior hade glidit
     isär vid nästa kolumn.
  4. **Ingen ny felkod, ingen textmatchning mot triggerns meddelande.** P0001
     ur `kraver_orsak_vid_ny_version()` når klienten som **409
     `rule_violation`** via befintliga `errorHandler.ts` (rad 95) — utan
     triggerns text, aldrig som 500. Schemat (zod, 400 `validation_error`) är
     primärkontrollen; triggern är backstoppet, precis som periodlåset.
     Överlämningens 400-koder `change_reason_required`/`baseline_frozen` ströks
     av David 6/9 11:45 med husregeln som skäl.

  **Grind:** typecheck och svit kördes INTE i den här sessionen (körs av
  körskriptet efteråt) — utfallet ska klistras in här innan bygget stängs. Ny
  svit: `server/test/uppdragsytan-baseline.test.ts` med de sex fallen
  (a)–(f): (a) `andra_baseline` som agent → 202 `pending_approval`, noll nya
  rader, en post i kön, och efter mänskligt godkännande version 2 med sitt
  skäl och sin period, som `get_contract_usage` visar från dess `valid_from`
  (plus att agenten inte kan godkänna sig själv, att en orsak under fem tecken
  och ett saknat `valid_from` fälls av schemat); (b) `upsert_contract_part` med
  skäl + nytt `valid_from` på en bekräftad del → version 2 bredvid den gamla;
  (c) samma anrop utan skäl (och med blanktext) → 409 `rule_violation` genom
  hela HTTP-stacken, utan triggerns text och utan halvskrivna rader; (d)
  in-place-ändring av `cap_hours` på en bekräftad rad → 409 `rule_violation`
  med taket orört; (e) `date_precision: 'vecka'` → 400 `validation_error`, och
  de fem tillåtna värdena hela vägen ner i kolumnen; (f) anrop utan de fyra
  fälten skapar och ändrar en obekräftad rad precis som förut, med kolumnerna
  NULL — och `create_contract_from_draft` likaså.

  **Kvarstår för David:** inget att migrera. Frysning av ett nyskapat kontrakt
  (`utkast` → `fryst`) har fortfarande ingen åtgärd, och känsligheten på
  `upsert_contract_part` är S0.1 (våg 2).

- **2026-09-05 (uppdragsytan våg 1 — migration 0068, hela modulens datalager):**
  Uppdragsytans S1.1 enligt 1E §3.1–3.4 och överlämning #109. **Migrationen
  `server/migrations/0068_uppdragsytan.sql` + fyra testsviter + upsert-hjälparen
  `server/src/services/uppdragSvep.ts`** (den enda services-ändringen, som #109:s
  UTANFÖR uttryckligen tillåter: enda skrivvägen till `uppdrag_svepvarde`, byggd
  för cacheprovet) plus sju statusetiketter (punkt 5). Inga actions, inga routes,
  ingen vysida, ingen MCP-ändring, inga nya beroenden, inga ändringar i
  befintliga migrationer eller `db/migrate.ts`.

  Byggt: fjorton kolumner i tre befintliga tabeller (`contract_parts` +4,
  `contracts` +8, `receipts` +2 med sammansatt FK mot `contract_parts
  (id, company_id)`), sju modultabeller (`uppdrag_leverabel`,
  `uppdrag_leverabel_handelse`, `uppdrag_bedomning`, `uppdrag_scopelinje`,
  `uppdrag_scopesignal`, `uppdrag_referens`, `uppdrag_svepvarde`) med RLS-policy
  `app_has_company_access` och GRANT per tabell, fyra triggerfunktioner, en
  kantkontroll och EN backfill.

  1. **Spärrarna sitter i Postgres, inte i tjänstelagret.** Tre skrivvägar (API,
     MCP, vy) plus framtida kod delar tabellerna; en regel som bara finns i en
     applikationskontroll gäller inte för raden nästa väg in skriver. Samma
     filosofi som `cap_confirmed` (0064) och append-only-auditloggen (0003).
  2. **Rättigheterna är formen på regeln.** `uppdrag_bedomning` och
     `uppdrag_leverabel_handelse` har SELECT + INSERT och inget annat — en
     bedömning eller en historik som går att skriva om i efterhand är ingen
     bedömning och ingen historik. `uppdrag_svepvarde` är det ENDA som har
     DELETE, och det är precis därför den är märkt CACHE: varje värde går att
     räkna om ur källsystemen. Provet kontrollerar rättigheterna åt BÅDA hållen.
  3. **Kantkontrollen före backfillen.** Ett osignerat avtal med bekräftade tak
     går inte att härleda — backfillen skulle lämna ett utkast med en bekräftad
     baseline hängande på sig, alltså exakt det läge `vagrar_baseline_i_utkast()`
     finns för att omöjliggöra. Migrationen vägrar då köra, och eftersom
     `db/migrate.ts` kör BEGIN/COMMIT per fil finns ingenting halvgjort kvar.
  4. **`vagrar_skrivning_pa_avslutat()` i fyra räckvidder** (TG_TABLE_NAME
     avgör vägen till `projects.status`): de sju modultabellerna och
     `contract_parts` via `contract_id`, `receipts` och `time_entries` via
     `contract_part_id`. På de två sista prövas vid UPDATE BÅDA kopplingarna —
     den gamla och den nya — och skrivningen fälls om någon av dem når ett
     avslutat uppdrag, så att en post varken kan föras IN i eller lyftas BORT
     från ett avslutat uppdrag i tysthet. (Granskningen 2026-09-05 fällde en
     första version som bara prövade den nya kopplingen när den fanns: en post
     gick då att peka om från avslutat till öppet, och därmed lyfta bort.
     Rättat i funktionen, pinnat med prov i `uppdragsytan-sparrar.test.ts`.)
     `assignContractPart` läser aldrig `projects.status`; därför sitter spärren
     här.
  5. **Sju nya statusetiketter i `view/html.ts`.** Ingen vy visar dem ännu, men
     `test/statusetiketter.test.ts` härleder kravet ur CHECK-villkoren i
     schemat, och `uppdrag_leverabel.status`/`uppdrag_referens.status` är just
     sådana villkor. Det är repots egen grind, inte en vyändring.

  **VIKTIGT — 0068 STÄNGER två vägar som fungerade före den. De måste öppnas i
  S1.2, och tills dess svarar båda `409 rule_violation` — utan triggerns text:
  `errorHandler.ts` mappar triggrarnas P0001 till statuskoden men skickar bara
  `{ error: rule_violation }`, meddelandet stannar i serverloggen, och
  `uppdragsytan-sparrar.test.ts` asserterar status + kod, aldrig texten. Om
  användaren ska se en förklaring eller en stum kod är ett S1.2-beslut):**
  - ~~**Ett bekräftat tak går inte att sätta på ett nyskapat avtal.**~~
    **ÖPPNAD 2026-09-06 (S1.2, migration 0069):** ett `signed_date` fryser
    kontraktet (trigger), så `create_contract`/`skapa_uppdrag`/
    `create_contract_from_draft` med undertecknandedatum ger ett FRYST avtal som
    tar emot ett bekräftat tak direkt. Kvar som spärr: ett avtal som ingen
    undertecknat är ett utkast, och där fälls det bekräftade taket som förut.
  - ~~**Ett tilläggsavtal går inte att lägga in.**~~ **ÖPPNAD 2026-09-06 (S1.3):**
    `upsert_contract_part` tar nu `change_reason` (+ `start_date`/`end_date`/
    `date_precision`), och den nya sensitive-åtgärden `andra_baseline` skriver
    en ny baselineversion via godkännandekön. Se sessionsloggen nedan.

  Båda är pinnade som prov i `server/test/uppdragsytan-sparrar.test.ts`
  ("vad 0068 stänger tills S1.2") så att de inte kan bli en tyst överraskning.
  Fyra befintliga sviter är anpassade efter den nya ordningen — de fryser
  avtalet med samma sats som backfillen innan taket bekräftas
  (`avtalsdelar`, `tid-rapporter`, `tid-snabbregistrering`, `avtal-inlasning`);
  varje ändring bär en `0068:`-kommentar som säger vad som flyttades och varför.

  **Grind (KRAV-14), körd på branchens SLUTLÄGE (commit efter rättelse 2, med
  fjärde sviten och hjälparen) 2026-09-05, inklistrad ordagrant:**
  `npm run build` → ren (exit 0).
  `npm test` → `Test Files  110 passed (110)` · `Tests  1081 passed (1081)` · `Duration  282.32s`.
  (En tidigare inklistring sade 109/1077 — den var körd FÖRE fjärde sviten
  lades till; granskningen fällde det, och utdatan ovan är från slutläget.)
  Fyra nya sviter: `uppdragsytan-migration-0068.test.ts` (kantkontrollen fäller och
  lämnar varken kolumner eller tabeller efter sig, backfillen fryser signerat
  och lämnar osignerat, andra körningen ändrar inget, spärrarna gäller efteråt),
  `uppdragsytan-sparrar.test.ts` (alla fyra triggrar, RAISE-fall och tillåtna
  fall, inkl. att `upsertContractPart`-flödets in-place-uppdatering av en
  obekräftad rad överlever, och att en post inte kan lyftas bort från ett
  avslutat uppdrag genom omkoppling — granskningens fynd i försök 2),
  `uppdragsytan-schema.test.ts` (de sju tabellernas form, RLS-policyer,
  rättigheter åt båda hållen, de unika nycklarna, ingen `status_sedan`, och
  tenantgränsen mot ett grannbolag) och `uppdragsytan-agandegrans-cache.test.ts`
  (1E ADR-2 påstående 3: frys ett svepindata, skriv cachen via `upsertSvepvarden`,
  töm, skriv om ur samma indata, jämför per nyckel utan `last_nar` — identiskt;
  negativ kontroll: en insmugen rad som inte kan räknas om syns som skillnad;
  nycklar som försvinner ur indata tas bort; grannbolag ser inget). Den fjärde
  byggdes efter granskningens tredje försök, som fällde att överlämningens
  punkt 7 saknades utan att loggen sa det.

  **Förgrinden** `~/.hermes/forgrind/111.sh` körs av CTO-motorn på branchen före
  merge (0068 mot en återläst kopia av dagens dump, kantkontrollen mot ILT:s
  riktiga avtal); utfallet står i `~/.hermes/logg/forgrind-111.log`. Ingen
  åtgärd, ingen vy och ingen import ingår här (S1.2). Frysningen av ett
  nyskapat avtal (signed_date → fryst) öppnades i S1.2, migration 0069 — se
  sessionsloggens översta post.


- **2026-09-03 (lönen bokförs med bruttometod från september — LOC-355):**
  `book_payslip` bokförde bara **nettolönen** (7010 D / 1930 K) och
  `book_payroll_tax` bara betalningen (2510 D / 1930 K). Följden: **löneskulden
  fanns aldrig i balansräkningen.** Mellan utbetalningen och skattekonto-
  betalningen ~18 dagar senare var bolaget skyldigt Skatteverket pengar som
  inget konto visade — och över ett årsskifte blir det ett K2-fel, inte en
  tidsfråga. Historiken mars–augusti är redan rättad för hand (A53+A54 mot
  2440); det här bygget rör inga bokförda verifikat.

  Byggt: **migration 0067** (standardkontot `2731 Avräkning lagstadgade sociala
  avgifter` — 2710, 7510, 2510, 1930 och 3740 fanns redan i 0006), brytpunkten
  `GROSS_METHOD_FROM_PERIOD = '2026-09'` i `services/payroll.ts`, båda
  bokföringsfunktionerna och de två registry-titlarna. Ingen ny arkitektur,
  inga nya beroenden, ingen vykod: `computePayroll`/`computePayslipTax`/tabell
  30, `createPayslip` och godkännandeflödet är orörda.

  1. **Brytpunkten är perioden, inte datumet.** `period >= '2026-09'` (ren
     textjämförelse på YYYY-MM) avgör metoden. Ett utbetalningsdatum kan
     flyttas av bankdagsregeln; perioden är den bokföringshändelsen hör till.
     Äldre perioder bokförs EXAKT som förut — det är villkoret för att den här
     ändringen ska gå att göra utan att röra historiken.
  2. **Bruttometoden i ett verifikat:** 7010 D brutto · 7510 D avgift ·
     2710 K skatt · 2731 K avgift · 1930 K netto. Det balanserar per
     konstruktion (netto = brutto − skatt) — ingen ny beräkning behövs, all
     data står redan på lönebeskedsraden.
  3. **Betalningen tömmer exakt de konton bokningen satte** (2710 D + 2731 D /
     1930 K). Det är hela poängen: två funktioner som skriver mot olika konton
     lämnar en skuld som växer i tysthet. Efter de två stegen är saldot på
     2710 och 2731 exakt 0 — och det är vad KRAV-5-provet mäter.
  4. **Öresdifferensen mot 3740, aldrig kvar på ett skuldkonto.** Skattekontot
     betalas i hela kronor medan skulderna står i ören; för september blir
     resten 42 öre. Utan raden går verifikatet inte ihop, och lades resten kvar
     på 2710/2731 skulle skulden aldrig nå noll — då vore avstämningen omöjlig
     av samma skäl som felet uppstod. 3740 finns i 0006; inget nytt konto.
  5. **Nollrader skrivs inte.** `postVoucher` kräver att exakt en av
     debet/kredit är positiv per rad, så en jämkning till 0 kr skatt (eller en
     öresdifferens på 0) skulle annars ge 400 i stället för ett verifikat.
  6. **2731, inte 2730.** 2730 finns i 0006 som samlingskonto; 2731 är BAS
     underkonto för just de lagstadgade avgifterna. Att blanda hade lagt två
     metoders skuld på samma rad. Kontot är `liability`, så det hamnar av sig
     självt på rätt sida i balansräkningen (rapporterna grupperar på
     `account_type`, inte på kontonummerintervall).

  **Grind:** typecheck och svit kördes INTE i den här sessionen (körs av
  körskriptet efteråt) — utfallet ska klistras in här innan bygget stängs.
  Fyra sviter uppdaterade: `payroll-payment.test.ts` har det nya blocket
  "brytpunkten 2026-09" (augusti 2026 bokförd oförändrat med kontantmetodens
  två rader och orörda 2710/2731/7510; septemberverifikatets **fem rader
  radexakt**; skattekontobetalningen 2710 D 16 343 + 2731 D 19 882,58 /
  1930 K 36 226 + 3740 D 0,42 den 2026-10-12; och saldokontrollen 2710 = 0,
  2731 = 0, 3740 = 42, 2510 = bara julibetalningen), och `payroll.test.ts`
  (2025-06), `payroll-tax.test.ts` (2026-07) och `payroll-historical.test.ts`
  (2026-03) hävdar nu sina kontantmetodsverifikat radexakt — bevis för att
  perioder före brytpunkten är orörda. `payroll-historical` har ingen
  logikändring.

  **Kvarstår för David:** kör `npm run migrate` (0067) före septemberlönen.
  Avstämningen av restsaldona på 2440/2510 efter körningen ~20/9 är ett
  manuellt driftsteg — ingen kod ingår för den.

- **2026-09-02 (rättelse 7b: avtalsdelskravet prövas vid övergången till
  debiterbar tid):** Driftfel, reproducerat 21:05 UTC. Ett förslag ur
  `propose_time_entries` utan `contract_part_id` på ILT — ett uppdrag med
  aktiva avtalsdelar — gick **varken att ignorera eller texträtta**: både
  `approve_time_entries {status:'ignorerad'}` och `update_time_entry
  {description}` svarade 400 `contract_part_required`. Kravet från story 3 låg
  i `updateTimeEntry` generellt, medan PRD F5 och beslut #104 säger att det
  gäller först när tiden blir DEBITERBAR. Följden: godkännandekön låste sig på
  0-minuters mailmarkeringar — skräp man måste klassa mot ett tak det aldrig
  kommer att förbruka, bara för att få bort det. En kö som inte går att tömma
  slutar man titta i, och då är den ingen kö.

  **Ändringen är ett villkor** (`projects.ts` rad 497–510): kravet prövas mot
  MÅLSTATUS (`input.status ?? rad.status`) och bara när den är
  `godkand`/`justerad`. En medskickad `contract_part_id` prövas som förut alltid
  mot uppdraget. Inget annat är rört: `createTimeEntry` kräver delen vid
  registreringen precis som förr, `TILLATNA_BYTEN`, takvarningen, batchens
  allt-eller-inget och samtliga scheman är oförändrade. Ingen migration.

  1. **Ett flöde, tre ingångar — därför EN rad.** MCP:s `update_time_entry`,
     `approve_time_entries` och vyns knapp *Faktureras ej* går alla genom
     `updateTimeEntry`, så rättelsen bor i tjänstelagret. Vykoden är orörd:
     förslagskortets avtalsdelsväljare (`routes.ts` rad 2592) var aldrig
     `required`, så KRAV-4 faller ut ur tjänstefixen.
  2. **Lättnaden gör inte oklassad tid debiterbar.** Vägen runt
     klassificeringen — skapa posten före avtalet, ändra den efteråt — stängs
     av exakt samma villkor, för den vägen slutar alltid i ett godkännande.
     Att en post som redan ÄR `godkand` utan del kräver klassificering även för
     en ren textändring är alltså följdriktigt och avsiktligt: målstatus är då
     `godkand`.

  **Grind:** typecheck och svit kördes INTE i den här sessionen (körs av
  körskriptet efteråt) — utfallet ska klistras in här innan bygget stängs. Fyra
  nya prov: i `tidsforslag.test.ts` att ett oklassat förslag går att ignorera
  och att få sin beskrivning rättad (reprofallet ur överlämning #99), plus
  vyprovet att *Faktureras ej* går igenom utan vald del medan *Godkänn* svarar
  med tjänstens befintliga text; i `avtalsdelar.test.ts` att en post utan del
  går att lägga undan men **inte** att göra debiterbar igen (400
  `contract_part_required`), och att delen i SAMMA anrop som godkännandet
  räcker. Det befintliga provet "avtalsdel krävs när uppdraget har aktiva
  delar" är oförändrat och ska fortsätta vara grönt.

  **Kvarstår för David:** inget att migrera. Poster som redan fastnat i drift
  rättas genom att ignorera eller klassa dem i kön — ingen retroaktiv körning
  ingår i den här rättelsen.

- **2026-09-02 (läs in avtalet ur avtals-PDF:en — PRD_TIDSRAPPORTERING story 6):**
  Story 3 gav avtalet och taket en plats att BO på, men vägen dit gick bara
  genom `create_contract` + ett `upsert_contract_part` per fas. Avtalet självt
  låg kvar i en DOCX och i Davids huvud — och **ett tak som aldrig skrivs in kan
  aldrig varna.** Det är hela PRD §1 rad 6 i en mening.

  Byggt: ny tjänstefil `services/contractExtraction.ts`, actionsen
  `extract_contract_draft` och `create_contract_from_draft`, samt vysidan
  `/app/c/:id/projects/:projectId/avtal` med menyvägen **Läs in avtal** på
  uppdragssidan. **Ingen migration, inga nya beroenden, ingen ny CSS**;
  `aiOcr.ts`, `contracts.ts`, `config.ts`, faktureringen och godkännandeflödet
  är orörda.

  1. **Två actions med Davids formulär emellan.** Den första LÄSER (lagrar filen
     i dokumentarkivet, returnerar utkast + `file_id`) och skapar ingenting; den
     andra SKRIVER. Inget extraherat värde kan nå faktureringen utan att ha
     passerat formuläret — det är därför steget inte går att slå ihop till ett.
  2. **Tvålagersskyddet är kopierat med flit, inte uppfunnet igen**
     (`aiOcr.ts` rad 9–16): systemprompten säger att dokumentets text är DATA,
     och svaret parsas genom ett strikt zod-schema som kastar okända fält — även
     inne i `parts[]`. `requires_human_review` tvingas till true oavsett vad
     modellen svarade. VisionClient injiceras, så provet kör aldrig en modell.
  3. **DOCX avvisas, och svaret säger vad man gör i stället** ("spara avtalet
     som PDF"). Ett zip-/docx-bibliotek vore ett nytt beroende, och stacklistan
     i `docs/ARKITEKTUR.md` är sluten. Mediatypen prövas FÖRE nyckeln: en DOCX
     är fel oavsett om AI:n är påslagen, och att svara "AI avstängd" på en
     Word-fil hade skickat David på fel felsökning.
  4. **409 `ai_disabled` här, 400 i `aiOcr.ts`.** Överlämningen och Davids ja 2/9
     nämner uttryckligen 409. Skillnaden är inringad i den nya tjänsten;
     `aiOcr.ts` är orörd (avgränsningen). Det står i både koden och
     `MCP_ACTIONS.md` så att skillnaden aldrig ser ut som ett slarvfel.
  5. **`manually_edited` sätts genom contracts.ts EGEN semantik.** Flaggan sätts
     "vid ändring, inte vid skapande" (contracts.ts rad 590) — alltså skapas
     delen ur utkastet, och avviker det inskickade värdet görs en ANDRA
     `upsertContractPart` på samma (avtal, kod, `valid_from`). Ingen ny väg in
     till kolumnen, och auditloggen visar det som faktiskt hände: utkastet
     skapade raden, människan ändrade den. Ett formulär utan utkast (AI:n
     avstängd) räknas som ändrat rakt igenom — det är just de raderna flaggan
     finns för att skydda.
  6. **Kundmatchningen är crm-ingestens regel** (LOC-318, lärdom 7): org.nr på
     siffror, annars exakt namn, och **tvetydigt räknas som ingen träff**. Utan
     träff lämnas `customer_id` tomt och vyn ber om ett val (`createContract`
     ärver då uppdragets kund). En gissning hade lagt avtalet — och därmed
     arbetet — på fel kunds faktura utan att något i svaret sagt det.
  7. **Ytan:** utkastet ligger i husets `.ai-card` med `aiMarkning()`
     (AI-förordningen art. 50), samma komponent som tidsförslagen — samma sorts
     sak ska se likadan ut. Utan utkast är det EXAKT samma formulär i en vanlig
     `.panel`; att märka ett handifyllt formulär som AI-genererat vore lika fel
     som att inte märka ett som är det. Faserna är rader utan JavaScript: varje
     rad börjar med en **select** "Ta med / Utelämna" (en okryssad kryssruta
     skickas inte alls och raderna hade glidit ur fas med varandra) och tre
     tomma rader ligger sist. `cap_confirmed` är EN kryssruta för hela
     formuläret med regeln utskriven: ett tak ingen läst varnar aldrig.
  8. **Ingenting kapas tyst.** Max 12 inlästa faser och 240 tecken beskrivning
     per rad — gränserna finns för att vyns kropp är 16 kB (`urlencoded`), och
     båda står utskrivna på sidan när de slår till. `suggested_hours` har ingen
     kolumn att bo i (ingen migration) och visas därför som text på raden, med
     beskedet att en uppskattning inte är ett tak.
  9. **Ett fel kostar aldrig det ifyllda.** Formuläret renderas om med Davids
     värden i stället för en redirect — och utkastet som följer med tillbaka i
     det dolda fältet är jämförelsegrunden, inte en kopia av allt modellen sa.

  **Grind:** typecheck och svit kördes INTE i den här sessionen (körs av
  körskriptet efteråt) — utfallet ska klistras in här innan bygget stängs. Ny
  svit: `server/test/avtal-inlasning.test.ts` (injicerade fält strippade uppe
  och inne i `parts[]`, DOCX → 400 `unsupported_media` före nyckelkontrollen,
  PDF utan nyckel → 409 `ai_disabled`, hela kedjan fil → utkast → avtal med
  `source_file_id` och hierarkin `2A` under `2`, `manually_edited` på exakt den
  ändrade raden, org.nr-matchningen utan bindestreck, den obefintliga kunden som
  inte gissas fram, `unknown_parent_code`/`signed_date_required` som lämnar
  NOLL halvskapade avtal, samt vyn: länken på uppdragssidan, det tomma
  formuläret med "AI-extraktion avstängd — fyll i manuellt", uppladdningen som
  inte tappar formuläret, avtalet skapat ur det tomma formuläret med bekräftat
  tak och utelämnad rad, felet som behåller de ifyllda fälten, och
  tenant-gränsen).

  **Kvarstår för David:** inget att migrera. Vill han ha AI-förifyllningen krävs
  `ANTHROPIC_API_KEY` i miljön; utan den fungerar sidan som ett vanligt
  formulär. Story 8 (kalender/mail) och story 9 (flera personer) är INTE byggda
  här.

- **2026-09-02 (förslagsintaget och förslagskön — PRD_TIDSRAPPORTERING story 7):**
  Story 1–5 gav tidposten en livscykel, fakturan atomicitet, avtalet ett tak,
  rapporterna en yta och vyn en skrivväg. Kvar stod mottagarsidan för det som
  kommer UTIFRÅN: kalendern och mailen. Kontraktet är skrivet FÖRE
  Hermes-skillen (story 8) med flit — ett intag vars form uppfinns av
  avsändaren ändras varje gång avsändaren ändrar sig.

  Byggt: **migration 0066** (unikt partiellt index på
  `(company_id, source_ref)`, kolumnerna `uncertainty`/`reasoning`/
  `overlaps_manual`, och 0017:s `minutes > 0` ersatt), ny tjänstefil
  `services/timeProposals.ts`, actionsen `propose_time_entries` och
  `approve_time_entries`, samt vysidan `/app/c/:id/tid/forslag` (menyposten
  **Tidsförslag**). Ingen ny CSS, inga nya beroenden; `projects.ts`
  (utom tre kolumner i `listTimeEntries`:s SELECT), `contracts.ts`,
  `timeReports.ts` och faktureringsflödet (utom `reasoning = NULL`) är orörda.

  1. **Idempotensen är hela intaget.** Kalendern läses om varje natt. En
     dubblerad kontaktpunkt är brus; en **dubblerad tidpost är pengar** på
     nästa faktura. Ett redan sett `source_ref` hoppas över och räknas som
     `duplicates` — det UPPDATERAS aldrig, för ett förslag är ett påstående vid
     en tidpunkt, inte ett fält synken äger. Uppslaget sker före skrivningen och
     det unika indexet är andra försvarslinjen (två samtidiga batchar hinner
     annars båda göra sitt uppslag); en 23505 räknas som den dubblett den är,
     inte som ett fel avsändaren ska försöka laga.
  2. **Ingen post tappas — men en oplacerad post kan inte bli pengar.** En hint
     utan ENTYDIG träff landar på uppdraget `Osorterat` (skapas en gång per
     bolag, via `createProject` så numret och auditraden blir husets) och
     redovisas i `unresolved`. Tvetydigt räknas som ingen träff: en gissning
     hade lagt arbetet på fel kunds faktura utan att något i svaret sagt det
     (samma felklass som lärdom 7). Priset står i 409 `unsorted_project`:
     `godkand`/`justerad` går inte förrän någon sagt vems arbetet var —
     `project_id` i samma anrop flyttar och godkänner i ett svep.
  3. **Nollan är en riktig uppgift.** Ett mailspår har ingen varaktighet.
     `minutes = 0` tas emot, men CHECK-villkoret släpper bara igenom nollan för
     `forslag` **och `ignorerad`** — de två statusar som ligger utanför
     fakturan. Kravtexten skrev "endast forslag"; `ignorerad` måste rymmas där
     också, annars stänger schemat den enda väg KRAV-6 pekar ut för en
     mailmarkering som inte ska få tid ("få tid satt ELLER ignoreras").
     `godkand`/`justerad` kräver `minutes > 0` (400 `minutes_required`).
  4. **Godkännandet äger inga egna regler.** Statusbytet går genom
     `updateTimeEntry` och därmed genom `TILLATNA_BYTEN`, kravet på skäl,
     `contract_part_required` och låset mot fakturerade poster. Två
     uppsättningar regler för samma övergång betyder att minst en är fel utan
     att någon vet vilken. Batchen är allt eller inget: ett tyst överhopp hade
     lämnat kön till synes tömd med en post kvar.
  5. **Kön är husets `.ai-card`, inte en ny komponent.** Ett tidsförslag är
     samma sorts sak som ett förslag i Att göra, så det bär samma kort, samma
     `aiMarkning()` (AI-förordningen art. 50), samma `.andring` för
     registrerat → debiterbart och samma `.ai-actions`. Noll ny CSS. En rad är
     ETT formulär med fyra namngivna submit-knappar, så uppdragsbyte och
     godkännande blir ett anrop utan sidbyte. Det som inte går att godkänna
     säger varför PÅ raden, och "Godkänn hela dagen" räknar bara de poster som
     verkligen går igenom — en knapp som lovar något systemet kommer att neka
     är en fälla. Kön grindar aldrig fakturan och förfaller aldrig.
  6. **Motiveringen gallras, spåret behålls.** `reasoning` nollställs i samma
     sats som posten låses till fakturan, och efter 90 dagar för `ignorerad`
     via `purge_crm_data` (som nu svarar `time_entry_reasoning_cleared`).
     `source_ref` står kvar — samma hållning som `crm.field_provenance`.

  **Grind:** typecheck och svit kördes INTE i den här sessionen (körs av
  körskriptet efteråt) — utfallet ska klistras in här innan bygget stängs. Ny
  svit: `server/test/tidsforslag.test.ts` (samma batch två gånger = idel
  duplicates, dubbletten inom EN batch, den trasiga raden som inte stoppar
  batchen, entydig ledtråd på kundnamn och domän, tvetydig ledtråd → Osorterat,
  engångsskapandet, förslag utan avtalsdel, part_hint med och utan träff,
  `overlaps_manual`, batchgodkännande med justering, `ignorerad` kräver orsak,
  `contract_part_required`, minutes 0 som tas emot men aldrig godkänns,
  409 `unsorted_project` + flytt i samma anrop, hela batchen som rullas
  tillbaka, ignorerad tid utanför beloppet men listbar, reasoning-gallringen
  vid fakturering och efter 90 dagar, kösidans dagräknare och gruppering,
  AI-märkningen, dagen som klaras med två klick, "Godkänn hela dagen",
  Osorterat-raden i vyn, och tenant-gränsen mot bolag B).

  **Kvarstår för David:** kör `npm run migrate` (0066). Story 8 (Hermes-skillen
  som läser kalender och mail) och story 9 (flera personer) är INTE byggda här.

- **2026-09-02 (snabbformulär och redigeringssida för tid — PRD_TIDSRAPPORTERING
  story 5):** Story 1–4 gav tidsposten en livscykel, fakturan atomicitet, avtalet
  ett tak och rapporterna en yta. Kvar stod PRD §4 F1: **tid gick att SE i vyn
  men inte att skriva eller rätta där.** En felskriven post krävde en action, och
  underlag gick inte att koppla alls. En vy som visar men inte kan rätta är ingen
  reserv — den är en rapport.

  Byggt: `server/src/lib/duration.ts` (parsern + `hhmm`), **migration 0065**
  (`time_entry_links`), `duration` på `log_time`/`update_time_entry`, actionsen
  `attach_time_entry_link`/`remove_time_entry_link`, snabbformuläret överst på
  `/tid` och på uppdragssidan, och tidpostens egen sida
  `/app/c/:id/tid/:entryId`. Ingen ny CSS, inga nya beroenden; `files`/multer,
  faktureringsflödet och statusövergångarna i `projects.ts` är orörda.

  1. **En parser, aldrig två.** Texten går ORÖRD från formuläret till actionen
     och tolkas i tjänstelagret — vyn tolkar aldrig tiden på egen hand (lärdom
     5). `1h`→60, `1,5`/`1.5`→90, `90m`→90, `45`→45, `1h30`/`1:30`→90; ett tal
     utan enhet **under tio är timmar, från tio minuter** (Davids regel 1/9), så
     `7` är 07:00. Allt annat ger 400 `invalid_duration` med exemplen i texten.
     Aritmetiken är heltal hela vägen: 0,1 · 60 är 6.000000000000001 i IEEE 754,
     och en tidpost ska inte bli sex minuter och en biljondel.
  2. **Regeln är aldrig osynlig** — villkoret för att den fick gälla. Hjälptexten
     står vid fältet (kopplad med `aria-describedby`, inte bara placerad under),
     och kvittot efter varje registrering visar den TOLKADE tiden i hh:mm. En
     tolkning användaren inte kan förutsäga är en fälla, inte en genväg; den
     upptäcks annars först på fakturan.
  3. **Underlag är länkar, aldrig filkopior** (rådslaget 1/9, ILT §6). En kopia
     blir en andra sanning som åldras i tysthet och drar in kundens material i
     vår räkenskapsinformation. `https://` krävs i BÅDE tjänsten och schemat —
     en regel som bara finns i koden gäller inte för raden som skrevs innan
     koden fanns. DELETE-policyn i 0065 är 0047:s: underlaget till en fakturerad
     post går inte att ändra ens förbi tjänstelagret.
  4. **Den fakturerade posten renderas låst** med 409-texten utskriven och utan
     formulär — samma lås som `update_time_entry` redan hade, men SYNLIGT. Och
     statusväljaren erbjuder bara de byten `TILLATNA_BYTEN` släpper igenom
     (tabellen exporteras nu i stället för att kopieras in i vyn): en select som
     erbjuder ett otillåtet byte lovar något systemet kommer att neka.
  5. **Historiken under formuläret** är samma läsning som `/audit`, filtrerad på
     posten: vem, vad, när (F7). Frågan "vem ändrade det här?" ska besvaras där
     den ställs, inte genom att man letar i 200 rader på en annan sida.
     Uppslaget mot etiketterna använder `Object.hasOwn` (lärdom 9).

  **Grind:** typecheck och svit kördes INTE i den här sessionen (körs av
  körskriptet efteråt) — utfallet ska klistras in här innan bygget stängs. Ny
  svit: `server/test/tid-snabbregistrering.test.ts` (parsertabellen med 16
  giltiga och 13 ogiltiga fall inkl. `7` = 07:00, `duration` vs `minutes` som
  400 `minutes_or_duration`, formuläret som skapar godkänd post med rätt
  avtalsdel, kravet på avtalsdel, takvarningen som syns UTAN att spärra,
  rättelsen inkl. "justerad kräver skäl", ogiltig text som inte sparar något,
  historiken med namn och före→efter, länk till/från med tenant-gräns, och den
  fakturerade postens låsta sida + 409).

  **Ett befintligt testfall ändrat, utanför den här byggets avgränsning:**
  `server/test/invoice-pdf-mall.test.ts` väntade sig `(20 dagar)` på
  förfallodatum, men Davids commit `a3e51fe` på main ändrade `pdfService.ts`
  till `(N dagar netto)` utan att uppdatera testet — sviten var alltså röd på
  main innan den här grenen fanns. Testet är anpassat till den nya texten
  (`(20 dagar netto)`, samt kommentarraden överst i filen). Ingen produktions-
  kod i faktureringsflödet är rörd; ändringen är enbart testets förväntan som
  följer efter mallbeslutet.

  **Kvarstår för David:** kör `npm run migrate` (0065).

- **2026-09-02 (rapporterna: ofakturerad godkänd tid — PRD_TIDSRAPPORTERING
  story 4):** Story 1 gav tidsposten en livscykel, story 2 gjorde fakturan
  atomär, story 3 gav avtalet ett tak. Kvar stod juli- och augustifelet i sin
  enklaste form: **godkänd tid som aldrig fakturerades syntes ingenstans om
  ingen frågade.** Ett fel som bara går att upptäcka genom att ställa rätt
  fråga upptäcks av kunden.

  Ny tjänstefil `services/timeReports.ts` med `unbilledTimeReport`,
  `idleProjectsReport` och `contractUsageReport`, tre read-actions
  (`unbilled_time_report`, `idle_projects_report`, `contract_usage_report`) och
  vysidan `/app/c/:id/tid` (menypost **Tid** under "Lön & projekt"). Ingen
  migration, inga nya beroenden; `contracts.ts`, `reports.ts`, `projects.ts`,
  `invoiceFromTime.ts` och `invoiceAppendix.ts` är orörda.

  1. **EN definition av ofakturerad tid, tre ingångar.** Urvalet står i
     `URVAL` och ingen annanstans, och beloppet går alltid genom
     `gallandeTaxa` (post → avtalsdel → avtal → uppdrag) + `timeEntryAmountOre`
     — samma tal som fakturan tar ut. **Styrytans äldre formel är borta:**
     `steering.ts` rad 79–84 räknade `billable AND NOT invoiced` utan
     avtalstaxa och utan livscykeln, så ett AI-förslag ingen godkänt räknades
     som intjänade pengar och en post på en avtalsdel med egen taxa värderades
     till uppdragets. `coverage.unbilled_time_ore` hämtas nu ur rapportens
     totalsumma; fältnamn och svarform i `SteeringOverview` är oförändrade, men
     talets innebörd är skärpt. Två formler för samma fråga ger två tal, och då
     är minst ett fel utan att någon vet vilket.
  2. **Nedlagd tid syns, men debiteras inte** (Davids svar på öppen fråga 4).
     En `ignorerad` post räknas i REGISTRERADE minuter och aldrig i debiterbara
     eller i beloppet. Ett `forslag` är en egen räknare (`proposal_entries`)
     bredvid — aldrig minuter, aldrig pengar. Alternativet, att utelämna dem,
     hade gjort rapporten till en lista över det som redan är i ordning.
  3. **Betalningsdimensionen ur befintliga funktioner** (CFO:ns tre kolumner):
     ofakturerat, fakturerat men obetalt (`accountsReceivableAging(to)` med
     dess förfallo-buckets) och betalt i perioden = inbetalningsverifikaten
     (`source_type='payment'`) från första dagen i `to`:s kalendermånad t.o.m.
     `to`. Ingen ny aging-, ingen ny betalningsberäkning — perioden är
     definierad i koden i stället för att en ny betalningsmodell byggs bredvid
     den som finns.
  4. **Stillhetsbevakningen** (CHRO:s punkt) rapporterar **ATT** ett aktivt
     uppdrag saknar tidpost de senaste sju dagarna, aldrig varför. Ett
     orsaksfält hade bara blivit en gissning med auktoritet.
  5. **Vysidan leder med två tal, inte fyra:** hur mycket ligger ofakturerat,
     och hur gammalt är det äldsta. Åldern är det som gör beloppet till ett
     problem, och över 30 dagar säger sidan det med ord. Tabellen är EN tabell
     i tre nivåer (kund → uppdrag → avtalsdel) därför att sammanhanget mellan
     dem ÄR svaret; betalningskolumnerna hänger på kundraden och står som
     tankstreck på nivåerna under — aldrig en nolla som ser ut som ett
     mätvärde. Sidan säger uttryckligen att kunder utan ofakturerad tid inte
     står där, och länkar till kundreskontran (lärdom 7: en tyst nolla är
     värre än ett tomt svar). Ingen ny CSS, inga nya komponenter: husets
     befintliga `page-head`/`kpi-grid`/`table-wrap`/`chip`/`empty`. De breda
     tabellerna är fokuserbara scrollytor (`tabindex`/`role="region"`) så att
     de går att nå med tangentbord.

  **Grind:** typecheck och svit kördes INTE i den här sessionen (körs av
  körskriptet efteråt) — utfallet ska klistras in här innan bygget stängs. Ny
  svit: `server/test/tid-rapporter.test.ts` (rapporten står på noll direkt
  efter `create_invoice_from_time` = acceptans 10; ignorerad post i minuter men
  aldrig i beloppet; förslaget som antal och inte som pengar; taxaordningen i
  fyra steg och att rapportens summa = fakturans subtotal; betalningarnas tre
  kolumner inklusive en inbetalning FÖRE perioden som inte får räknas;
  idle-rapporten mot stilla, nyligen bemannat och stängt uppdrag;
  fasförälderns andel och upprullade ofakturerade belopp; det obekräftade taket
  som redovisas som "vet ej"; styrvyns tal = rapportens summa i ett eget bolag;
  och vysidan med sina tre tabeller). Ett befintligt prov utökat:
  länkrevisionen i `entity-links.test.ts` renderar nu även `/tid`.

- **2026-09-02 (avtal och avtalsdelar som egna tabeller — PRD_TIDSRAPPORTERING
  story 3):** Story 1 gav tidsposten en livscykel, story 2 gjorde fakturan
  atomär. Kvar stod PRD §1 rad 6: **ILT-avtalets Fas 2A har ett tak på 32 h /
  35 200 kr, och taket passerades utan att någon sa något.** Ingen hade slarvat
  — systemet hade ingenstans att SKRIVA taket. `projects` bär en timtaxa och en
  budget (0017); ett uppdrag är inte ett avtal, och ett avtal har faser med
  varsitt tak och tilläggsavtal som ändrar taket utan att radera det gamla.

  **Migration 0064** ger `contracts` och `contract_parts` (RLS + GRANT som
  0017, komposit-FK:er så att ett avtal aldrig kan hänga på ett projekt eller en
  fil i ett annat bolag; `files` fick den nyckel 0011 gav kunder och
  leverantörer) samt `time_entries.contract_part_id`, nullbar. **Ingen befintlig
  post kopplas i migrationen** — klassificeringen är ett omdöme och fattas av en
  människa via `assign_contract_part`, inte av en UPDATE som gissar på en
  beskrivningstext.

  Tre beslut ur rådslaget 1/9 sitter i schemat, inte bara i koden:
  1. **Registrering spärras aldrig.** Tid som ÄR arbetad ska alltid gå att
     skriva ner; ett system som vägrar ta emot verkligheten får tillbaka den i
     ett kalkylark. Taket varnar vid registreringen (≥ 80 % → `warning` i
     svaret, > 100 % → texten att avtalet kräver skriftligt besked till kunden
     om ändrad omfattning + rad i auditloggen) och SPÄRRAR först i
     faktureringen: 409 `cap_exceeded`, forcerbart med `confirm_over_cap: true`
     som skrivs som ett eget beslut i loggen.
  2. **Ett oläst tak varnar aldrig** (`cap_confirmed`, default false). En
     varning på ett tal ingen bekräftat lär mottagaren att strunta i varningar,
     och då är nästa varning också död. Obekräftat eller NULL redovisas som
     `cap_status: 'vet_ej'` med förbrukningen bredvid och `share: null`.
  3. **Ett tilläggsavtal är en ny rad**, aldrig en överskrivning: unik
     (contract_id, code, valid_from). Förbrukningen summeras över ALLA
     versioner av koden, taket hämtas ur den som gäller i dag. Utan det hade
     ett tilläggsavtal nollställt historiken i tysthet.

  Ny tjänstefil `services/contracts.ts` + sex actions (`create_contract`,
  `update_contract`, `upsert_contract_part`, `list_contracts`,
  `get_contract_usage`, `assign_contract_part`). `log_time`/`update_time_entry`
  tar `contract_part_id` och KRÄVER den när uppdraget har aktiva avtalsdelar
  (400 `contract_part_required`); taxan gäller i ordningen **post → del → avtal
  → uppdrag**, med den gamla botten post → uppdrag orörd för tid utan del.
  Föräldradelens förbrukning är summan över barnens, så Fas 2:s tak slår in även
  när tiden ligger på 2A och 2B.

  **`assign_contract_part` är tillåten på en FAKTURERAD post** — den sätter
  enbart `contract_part_id` och ändrar varken belopp, minuter eller låset till
  fakturan. Alternativet hade varit att de 25 juliposterna aldrig gick att
  hänföra till en avtalsdel, och då börjar takbevakningen räkna från noll mitt i
  ett avtal. Allt annat på en fakturerad post är fortsatt låst (TRANSITIONS i
  projects.ts är orörd).

  **`create_invoice_from_time`:** avvisandet av `per_avtalsdel` (rad 66) är
  ersatt. Raderna grupperas per avtalsdel (beskrivning = delens `code` +
  `name`, olika taxor inom en del ger som förut skilda rader),
  `appendix_layout: 'per_avtalsdel'` ger kategoribilagan ur 0063 — kind
  `category`, en rad per del, **inga datum** — ur exakt samma låsta urval som
  fakturaraderna. Bilagemotorn i `invoiceAppendix.ts` är oförändrad. En faktura
  där INGEN post är klassad står kvar med uppdragets namn på raden: 'Övrigt'
  skrivs bara ut när det finns avtalsdelar att stå bredvid, annars hade en
  oförändrad faktura plötsligt haft en enda rad som hette "Övrigt".

  **Grind:** typecheck och svit kördes INTE i den här sessionen (körs av
  körskriptet efteråt) — utfallet ska klistras in här innan bygget stängs. Ny
  svit: `server/test/avtalsdelar.test.ts` (avtalsdel krävs när delar finns,
  taxaordningen i fyra steg, 80 %-varningen, det obekräftade taket som aldrig
  varnar, spärren utan/med `confirm_over_cap`, föräldratak över barn, historik
  via `valid_from` inklusive en framtida version som inte gäller än, bilagan per
  del utan datum, och `assign_contract_part` på en fakturerad post där allt
  annat förblir låst). Ett befintligt fall ändrat: story 2:s prov på att
  `per_avtalsdel` avvisades är nu provet på att den ger en kategoribilaga utan
  datum. **Inget test visar att registrering spärras av ett tak** — det är
  avsiktligt, och det är regeln.

  **Kvarstår för David:** kör `npm run migrate` och lägg in ILT-avtalets
  struktur (Fas 2A m.fl.) via `create_contract`/`upsert_contract_part`, med
  `cap_confirmed: true` först för de tak han läst i avtalshandlingen. Därefter
  kan juliposterna klassas med `assign_contract_part`.

- **2026-09-02 (faktura ur godkänd tid, atomärt — PRD_TIDSRAPPORTERING story 2):**
  Story 1 gav tidsposten en livscykel och ett lås. Kvar stod ändå julifelets
  form: fakturan kunde skapas i ett steg och tiden stängas i ett annat, och ett
  steg som går att hoppa över blir förr eller senare överhoppat.

  **`create_invoice_from_time` (write) gör de tre stegen till ETT.** I en och
  samma transaktion väljs och låses urvalet (`FOR UPDATE`), fakturan skapas ur
  exakt de raderna, tidsbilagan skrivs ur samma rader och posterna låses till
  fakturan. Faller något steg finns varken faktura, bilaga eller låst tid kvar
  — det bevisas i provet genom att bilagesteget medvetet fälls mitt i kedjan,
  alltså precis i det läge julifelet bestod av. Fakturaraderna är **en per
  taxa** (postens `hourly_rate_ore`, annars uppdragets), antal = debiterbara
  minuter/60 med två decimaler, moms 25 % och konto 3001. Saknas taxa på både
  post och uppdrag blir det 400 `missing_hourly_rate` — **aldrig ett tyst
  nollpris**, samma felklass som lärdom 7. `exclude_entry_ids` rör de undantagna
  posterna inte alls; undantaget ligger i urvalspredikatet och ingen annanstans,
  eftersom en bortfiltrering efter urvalet hade låst poster som aldrig hamnade
  på fakturan.

  Story 1-mönstret (räkning före lås → `FOR UPDATE` → radantal = urval) bor nu i
  `valjOchLasTidposter`/`lasTidposterTillFaktura` i `invoiceAppendix.ts` och
  används av båda vägarna. Två snarlika kopior av samma predikat hade gjort
  skillnaden mellan dem till ett falskt 409.

  Tre luckor stängda i samma andetag:
  1. **`set_invoice_appendix` med `kind: 'time'`** kräver nu
     `bypass_time_entries: true` + `reason` (409 `use_create_invoice_from_time`).
     En handskriven tidsbilaga låser ingen tidpost — det ÄR julifelet, utfört
     med handen. Skälet hamnar i auditloggen. `expense`/`category` orörda.
  2. **`delete_draft_invoice` återöppnar tiden** (`justerad` när debiterbar tid
     skiljer sig från registrerad, annars `godkand`; `invoice_id = NULL`,
     `invoiced = false`) i samma transaktion som raderingen. Utan det vore
     raderingen en fälla: timmarna låsta till en faktura som inte finns, omöjliga
     att både fakturera och rätta.
  3. **PDF:en vägrar** (409 `pdf_number_collision`) om en annan faktura i
     bolaget redan har en PDF med samma `effective_invoice_number`. Den unika
     nyckeln i 0046 är förstahandsgarantin och gör läget onåbart genom systemet;
     provet river den tillfälligt för att pröva andra försvarslinjen mot det den
     finns för — en kontroll som aldrig körts mot sitt eget fall är skriven, inte
     prövad.

  `appendix_layout` finns i schemat (Davids svar 1/9) men bara `per_datum` är
  byggt: `per_avtalsdel` ger 400 tills avtalsdelarna finns (story 3). Inga
  migrationer, inga nya beroenden. Ny svit:
  `server/test/faktura-ur-tid.test.ts` (11 fall: atomicitet, exclude-listan, tom
  period, andra anropet, olika taxa, taxa saknas, återöppning + omtag, bypassens
  tre utfall, PDF-kollisionen). Två anrop i
  `invoice-series-appendix.test.ts` skriver nu sin handskrivna tidsbilaga med
  `bypass_time_entries` + skäl — samma prov, uttalad väg.

  **Grind:** typecheck och svit kördes INTE i den här sessionen (körs av
  körskriptet efteråt) — utfallet ska klistras in här innan bygget stängs.

- **2026-09-01 (tidsposten får livscykel — PRD_TIDSRAPPORTERING §9 steg 1):**
  Bakgrunden är julifelet, mätt i PRD §1: fakturan skickades och betalades, men
  **ingen av de 20 tidsposterna markerades som fakturerad** — de låg kvar som
  `billable, invoiced = false`, alltså som ofakturerad tid redo att faktureras
  en gång till. Två poster (egen administration, supportmatris) skulle aldrig
  ha fakturerats, och det fanns ingen väg i systemet att säga det: `billable`
  är ett ja/nej satt vid registreringen, utan skäl och utan spår.

  Byggt, minsta möjliga: **migration 0062** ger `time_entries` `status`
  (forslag/godkand/justerad/ignorerad/fakturerad), `billable_minutes`,
  `source`/`source_ref`, `adjustment_reason`, `approved_by`/`approved_at` och
  `invoice_id` med komposit-FK `(invoice_id, company_id)` som 0047. `minutes`
  byter varken namn eller innebörd — den är REGISTRERAD tid — och
  `billable`/`invoiced` behålls som **speglingar** av statusen, skrivna i samma
  transaktion, så de sex befintliga läsarna (projektvyn, styrvyn, kundkortet,
  crmDerivations, bilagan, RLS 0053) är helt orörda.

  1. **`update_time_entry`** (write) — omklassning och rättelse på en post som
     inte är fakturerad; en fakturerad post är låst (409 `time_entry_locked`).
     **Debiterbar tid skrivs aldrig tyst:** ändras `minutes` utan att
     `billable_minutes` skickas lämnas de debiterbara orörda, och skiljer de sig
     därefter krävs status `justerad` med skäl. Alternativet — att låta
     debiterbar tid följa med automatiskt — hade gjort en rättelse av det som
     hände till en tyst ändring av vad kunden betalar.
  2. **`list_time_entries`** (read) och `log_time` med `billable_minutes` +
     `adjustment_reason`. Statusen vid registreringen avgörs av AKTÖREN: en
     människas post är godkänd, AI:ts är ett `forslag` som aldrig kan hamna på
     en faktura utan att en människa godkänt den.
  3. **Bilagan** väljer nu godkänd/justerad tid utan faktura med
     `SELECT … FOR UPDATE`, skriver DEBITERBARA minuter och låser posterna till
     fakturan i samma transaktion. Antalet uppdaterade rader måste vara lika
     med antalet valda, annars 409 `time_entries_changed` och rollback — en
     halv fakturering (bilaga skriven, poster olåsta) ÄR julifelet.
     Räkningen görs dessutom på ögonblicksbilden före låset, så att en förlorad
     kapplöpning svarar 409 i stället för "ingen tid i perioden": en tyst nolla
     som ser ut som ett tomt resultat är samma felklass som lärdom 7.
  4. **Datafixen ligger i 0062 som ett datajobb, inte som en lista med id:n**
     (Davids villkor): fakturan hittas på `effective_invoice_number = 27` inom
     juli–augusti 2026, uppdraget på fakturans `project_id` (annars kundens
     projekt), perioden på juli 2026 — och de två icke debiterbara på sina
     beskrivningar. Varje ändrad rad får en EGEN rad i auditloggen
     (`time_entry.migrated_0062`) med före- och eftervärden och `user_id = NULL`
     (det var migrationen, inte en människa). Filen är idempotent rakt igenom.

  **Grind:** typecheck och svit kördes INTE i den här sessionen (körs av
  körskriptet efteråt) — utfallet ska klistras in här innan bygget stängs.
  Nya sviter: `server/test/tidpost-livscykel.test.ts` (livscykel, varje tillåtet
  och otillåtet statusbyte, låset, urvalet, och TVÅ SAMTIDIGA faktureringar av
  samma period där exakt en lyckas) och
  `server/test/tidpost-migration-0062.test.ts` (kedjan körs till 0061, data i
  gammal form, sedan migrationsfilen från disk — backfillens tre klasser,
  julifixens 20 + 2 poster, och en andra körning som varken ändrar ett värde
  eller lägger en auditrad). Ett befintligt fixturanrop ändrat
  (`arende-projektkoppling.test.ts` sätter status/billable_minutes i sin råa
  INSERT — kolumnerna är NOT NULL).

  **Kvarstår för David i produktionsdatan:** kör `npm run migrate` — datafixen
  körs som en del av 0062 och rör exakt juliposterna. Nästa steg i PRD:n är
  story 2 (atomär fakturaskapning ur tid) och story 3 (avtalsdel + takvarning);
  ingen av dem är byggd här.

- **2026-09-01/02 (session: fakturan som gick iväg utan betalningsuppgifter):**
  En logotyp dödade API:t, och jakten på varför avslöjade ett större fel.

  **Kraschen.** En palett-PNG med transparens sattes som bolagslogotyp. pdfkit
  avkodar PNG med png-js, som kastade `Z_DATA_ERROR: invalid distance too far
  back` ur zlib — **asynkront, ur en callback**. `try/catch` runt `doc.image()`
  fanns redan, med kommentaren att en trasig bild aldrig får stoppa fakturan,
  men den fångade ingenting: felet blev ett ohanterat undantag som dödade hela
  node-processen. Varje försök att generera en faktura gav 502 och systemd
  startade om tjänsten — fyra gånger på en halvtimme. Akut löst genom att byta
  till JPEG (pdfkit läser JPEG direkt, utan png-js). Permanent löst med
  `assertRenderableImage()` i `companyLogo.ts`: kontrollen sker vid
  **uppladdning**, där felet går att fånga synkront, inte vid rendering.
  Lärdomen: ett `try/catch` skyddar bara mot synkrona fel — mot ett bibliotek
  som kastar ur en callback måste indata avvisas innan det når biblioteket.

  **Det större felet.** En faktura hann gå iväg till kund utan bankgiro och
  utan momsregistreringsnummer. Första diagnosen — "mallen är ofullständig" —
  var fel. `pdfService.ts` renderar kundadress, momsreg.nr, bankgiro, IBAN, BIC
  och hela sidfoten, korrekt porterad ur faktura 0000024. Men varje fält skrivs
  **villkorat på att värdet finns**, och registret var tomt: `companies` saknade
  vat_number, bankgiro, iban, bic, email, phone och website och hade
  `approved_for_f_tax = false`; **samtliga sex kunder** saknade adress,
  postnummer, ort och org.nr. Mallen hoppade tyst över raderna. Det såg ut som
  en trasig mall men var en tom databas — och det gällde varje faktura systemet
  kunde producera, inte bara ILT:s. Locollabs och ILT är nu ifyllda; övriga fem
  kunder kvarstår.

  Lärdomen är att **ett villkorat fält är en tyst spärr**. En faktura utan
  bankgiro ska inte kunna genereras — den ska vägra. Tills den vägran finns i
  koden är `scripts/faktura-regress.mjs` provet: den genererar en riktig
  faktura-PDF och kontrollerar med `pdftotext` att uppgifterna momslagen kräver
  **faktiskt står i dokumentet**. Att generering inte kraschar är inte samma sak
  som att handlingen är giltig; det var precis den skillnaden som gjorde att
  fakturan gick iväg. (Två tidigare försök att läsa PDF:en genom att regexa råa
  bytes gav falska svar — logotypens JPEG-data innehåller både parenteser och
  sekvensen `BT`, så en egen parser hittar text som inte finns.)

  **Vid deploy:** `/opt/redovisning` stod på en lokal gren
  `cto/tidsposten-f-r-livscykelstatus-f-rslag-g-95` utan upstream, utan egna
  commits och utan lokala ändringar — en etikett på den gamla main-spetsen.
  Växlad till `main`; grenen är kvar orörd.

  **Bilagan (löst i 0063).** Den krävde `entry_date` (NOT NULL) och tillät
  `minutes` XOR `amount_ore`, så en tidsbilaga kunde varken utelämna datum eller
  visa belopp per rad — därför fick ILT-bilagan fakturadatumet upprepat på varje
  rad. Ny sort `'category'`: inga datum, timmar och valfritt belopp per rad.
  Avsiktligt smal — 'time' och 'expense' är specifikationer PER DATUM och kräver
  fortfarande datum. Ingen teckenkodningsbugg fanns; titel och ingress lagrades
  hela tiden med korrekt svenska.

  **Kollision med CTO-motorn.** Mitt bygge och motorns beslut #95 (tidspostens
  livscykel) landade samtidigt och tog båda numret 0062. Min migration
  omnumrerades till 0063; rebasen gick rent. Två saker att veta:
  (1) `/opt/redovisning` var BÅDE driftkatalogen och motorns arbetskatalog — den
  stod två gånger under sessionen på en `cto/...`-gren i stället för main. Värre
  än den misslyckade `git pull`: vilken kod som kördes efter nästa omstart
  avgjordes av vem som råkade checka ut något sist, och systemd startar om vid
  krasch. **Åtgärdat samma kväll** — oföränderliga releaser under
  `/opt/redovisning-app/releases` med symlänken `current` som systemd läser, och
  `redovisning-deploy` som enda vägen att byta. Se `docs/DRIFT_VPS.md`. Prov:
  arbetskopian checkades ut tre commits bakåt på en annan gren och tjänsten
  startades om — den kom upp på exakt samma release.
  (2) Motorns datafix för juli skulle märka två poster som 'ignorerad' med
  motiveringen att de aldrig borde ha fakturerats. Den premissen kom ur en
  anteckning jag själv skrev och senare motbevisade: summan av juli
  billable-poster är 1 885 min = 31,42 h = exakt faktura 0000027. De ÄR
  fakturerade. Efter körningen är läget rätt (25 'fakturerad', 1 'ignorerad' —
  den enda som verkligen var icke-debiterbar), men premissen står kvar i
  migrationens kommentar.

- **2026-08-31 (session: städytan omgjord efter Davids dom):** Första utförandet
  föll på sitt eget prov. Davids ord: *"ui ux är snyggt, men katastrofalt dåligt
  exekverat, jag kan inte städa då det inte finns något för mig att städa här...
  jag vet inte vad som ska kopplas om det är namnet som ska ändra på personen
  med fel mailadress, eller om namnet ska ändras eller vad det är som förväntas
  kopplas samman."* Sidan visade felen men sa inte per rad vad som var fel, vad
  handgreppet gjorde eller vad som förväntades — och namnformulären låg i ett
  eget block under tabellen, frånkopplade från raderna.

  Omgjort: (1) **förslag ur adressen, förifyllt** — `namnforslag()` härleder
  "alexandra.blomberg@…" → "Alexandra Blomberg" (punkt→mellanslag, versaler;
  å/ä/ö går inte att härleda och det STÅR på raden), etikett "Förslag ur
  adressen — bekräfta eller rätta"; alltid ett förslag i ett redigerbart fält,
  aldrig en automatisk skrivning. (2) **Varje åtgärd bär sin innebörd i ord,
  inuti formuläret**: "Namnet byts — adressen, kontaktpunkterna och historiken
  behålls." / "Namnet byts och adressen flyttas till e-postfältet — ingenting
  går förlorat." / "Raderna slås ihop till den du behåller … Det går inte att
  ångra." (3) **Grupper med olika adresser** (ILT-formen) får diagnosen per
  rad: "Adressen tillhör troligen X — namnet pekar på fel person. Bekräfta
  eller rätta." (4) Ny regel `namnetAvviker()`: rätta-högen omfattar nu även
  namn som motsäger sin adress — medvetet försiktig: en ensam adressdel
  ("charlotte@", "steve@") flaggar aldrig, delmängd i ordning är samstämmig,
  å/ä/ö viks. Alla formulär bor PÅ sina rader.

  Provet är domen inverterad: strukturgranskaren `granska()` i
  `crm-stadning.test.ts` kräver på den renderade sidan att varje namnfält är
  förifyllt och varje åtgärd bär sin klartextrad — med NEGATIVA kontroller
  (en sida där texten eller förifyllningen strukits måste falla). `npx tsc
  --noEmit` ren; `npm test` = **799 tester i 96 sviter** (före omgörningen 795).

  Läget i datat (mätt: auditloggen + crm.field_provenance): David körde själv
  ytan 31/8 13:43–13:45 — 4 ihopslagningar (Geir ×2, Eva, Zeynep) och 5
  namnrättningar av e-postnamn. De fem bär ursprung **human** och STÅR KVAR
  genom synk efter synk. De 12 ILT-namnen rättades i stället via chatt/agent
  (upsert_crm_person, ursprung 'ai') och **skrevs över av synken 13:50:27** —
  de är tillbaka som "david mancilla". Det är beviset för hela
  ursprungsmodellen: bara människans väg håller, och ytan ÄR människans väg.
  Sidan visar nu de 12 med varsitt förifyllt förslag ("Adressen tillhör
  troligen Alexandra Blomberg …") — bekräftade där får de ursprung human och
  ligger fast. Kvar för Davids klick: de 12 bekräftelserna, därefter
  Alexandra Blomberg ×2 (paret återuppstår när raden bekräftas; ena raden
  saknar e-post och bär 1 åtagande — ytan visar båda hållens konsekvens) samt
  admin@synologen.se (delad brevlåda). Inga skrivningar av agenten i skarp
  data.

- **2026-08-29 (session: städytan för crm.people — `/c/:id/crm/personer`):**
  Bakgrunden var Davids invändning, ordagrant: *"hur ska jag städa och svara på
  k7 och k12, finns inte en kanal att svara på där denna fråga tolkas korrekt
  eller där jag kan se vad som ska ändras."* Han hade fått frågan "vilka av
  raderna i `crm.people` är samma person?" i en beslutskö — om data som INTE
  gick att se någonstans i systemet, med en åtgärd som inte gick att utföra
  någonstans i systemet. Kunder hade vy med skrivväg; personerna hade ingen vy.

  Byggt: en sida med tre högar som tillsammans är hela tabellen (delade namn,
  namn som är e-postadresser, resten) plus tre JS-fria POST-vägar —
  sammanslagning, "det här är olika personer", namnrättning. Alla med
  `assertSameOrigin`, 303 tillbaka, och spår i `crm.audit_log`.

  **Det viktigaste fyndet är att frågan var fel ställd.** Frågan lät som
  "~35 namn att gå igenom". Mätt i skarp databas 2026-08-29: 48 rader, fyra
  namngrupper (19 rader) och sex e-postnamn. Och den största gruppen —
  13 rader som heter "david mancilla" — är **inte** en dubblett: de bär
  13 OLIKA e-postadresser, alltså 13 personer med fel namn. `mergePeople`
  vägrar dem (`email_conflict`), och det är rätt av den. Sidan säger därför med
  ord vilket av de två fallen varje grupp är, och erbjuder bara knappen där
  den kan lyckas. Talen räknas fram vid varje sidladdning — aldrig ur frågan.

  Följden står skriven FÖRE klicket (antal rader, kontaktpunkter, åtaganden,
  vilka fält som fylls), eftersom sammanslagningen inte går att ångra. Ny
  tabell: `crm.person_distinctions` (migration 0061), parvis och med DELETE men
  utan UPDATE — samma resonemang som namnaliaset i 0059: ett omdöme, inte en
  rättslig radering.

  Ett befintligt prov justerat: `crm-design-parity` sneglade på första
  förekomsten av strängen `factcard`, som står i den inbyggda stilmallen — så
  "railen" råkade omfatta hela navigationen. Fönstret börjar nu vid
  `class="factcard"`, vilket är vad provet hela tiden påstått sig mäta.

  `npx tsc --noEmit` ren. `npm test` = **795 tester i 96 sviter, alla gröna**
  (före: 784 i 95). Sidan öppnad mot den SKARPA databasen och avläst — före och
  efter oförändrat (48 personer, 643 kontaktpunkter, 6 åtaganden, 15
  organisationer, 0 distinktioner). **Inga sammanslagningar gjorda:** besluten
  är Davids.

- **2026-08-20 (`fix/likviditet-kallor`: utflödessidan stod på noll — svaret bär
  nu sin egen källredovisning):** Davids order (flaggad 13/8) var "utflödessidan
  står på noll i samtliga fem hinkar". SQL:en i `liquidityForecast` var korrekt,
  men hela utflödessidan hämtades ur `supplier_invoices` — och den tabellen är
  tom i Locollabs. Kända skulder ur bokföringen syntes aldrig, och **nollan gick
  inte att skilja från "det finns inget att betala"**. Det är samma felklass som
  lärdom 7 (den tysta nollan): raden fanns, inget fel returnerades.

  1. **`sources` i svaret är hela poängen.** Varje känd in-/utflödeskälla listas
     med `id`/`side`/`status`/`amount_ore`/`due_date`/`note` — även när den är
     tom. Status sätts UTESLUTANDE av kod ur frågeresultat (linsprincipen från
     `brief_underlag.py`), aldrig av en modell: `MODELLERAD`, `TOM`,
     `KAND_EJ_MODELLERAD`, `KAND_EJ_DATERAD`, `AVVIKELSE`. Frågan "räknar ni
     med det här?" ska aldrig behöva ställas till koden.
  2. **Statutära skulder bucketas nu — varje period mot SIN EGEN förfallodag.**
     Momsnetto (26xx) och AGI (2710/2730 + obetalda lönebesked) läggs i hinkarna.
     AGI:n delas per löneperiod (`payslips.period` + `payroll_tax_payments`, unik
     per period), så en period vars förfallodag passerat hamnar i **"Förfallet /
     nu"** — inte mot nästa gemensamma förfallodag. Endast positiva netton — ett
     negativt momsnetto är en fordran och läggs INTE som inflöde (Skatteverket
     bestämmer tidpunkten). Momsen kan INTE delas per period: 26xx är löpande
     konton och repot bokför ingen avräkning per momsperiod (inget 2650), så
     "vilken period är oredovisad" är inte mätbart — skälet står i koden.
  3. **Dubbelräkningsregeln står i koden, inte bara i ett test.**
     `CLAIMED_BY_TAX_LIABILITY` + `unclaimedCreditBalance()` kastar direkt om en
     ny källa läser ett konto som redan ingår i ett bucketat taxLiability-belopp.
     Ett belopp som räknas två gånger ger en prognos som är fel åt fel håll, och
     den sortens fel upptäcks först när någon lutar ett beslut mot talet.
  4. **Odaterat läggs aldrig i "Senare".** 2920/289x redovisas som
     `KAND_EJ_DATERAD` med belopp. "Senare" betyder daterad > 90 dagar; ett
     odaterat belopp där vore falsk precision — värre än inget belopp.
     Uppskattad bolagsskatt och 2510:s debetsaldo är `KAND_EJ_MODELLERAD` (att
     bucketa den redan inbetalda preliminärskatten vore dubbelräkning).
  5. **Den del av skatteskulden som inte ligger i någon hink.** Skiljer sig
     `taxLiability.total_ore` från komponentsumman med > 1 000 kr syns det som
     källan `skatteskuld_jamforelse` med status `AVVIKELSE` och BÅDA talen i
     noten. Noten säger vad differensen MÄTER (skulden minus det som faktiskt
     modellerats) — inte att talen skulle vara felräknade: ett känt men odaterat
     belopp ger fullt utslag fast båda talen stämmer. Att tyst välja ett av
     talen är fel.
  6. **Vyn:** egen tabell "Källredovisning" under prognosen på `/cashflow`, där
     varje rad med status ≠ MODELLERAD är märkt i SJÄLVA raden ("EJ MODELLERAD",
     "ODATERAD", "AVVIKELSE", "TOM — INGEN DATA") — inte i en tooltip.

  `liquidity_forecast` behåller namn, `sensitivity: 'read'` och inputschema
  `{ as_of? }`; inget nytt verktyg, ingen migration, inget nytt beroende.

  **Davids faktiska tal per 2026-08-20**, mätta genom att prognosen kördes mot en
  KOPIA av produktionsdatan (`pg_dump` ur prod-containern → egen databas i
  testcontainern på 5433; prod är enbart läst, aldrig skriven):

  | Hink | Väntade utbetalningar |
  |---|---|
  | Förfallet / nu | **124 032,20 kr** (AGI, perioderna 2026-03/04/05/07) |
  | Inom 30 dagar | 0 kr (in: 43 202,50 kr, en öppen kundfaktura) |
  | 61–90 dagar | 26 007,45 kr (moms, förfaller 2026-11-12) |

  Utflödet gick alltså från **0 kr till 150 039,65 kr** modellerat. Utöver det
  redovisas **82 416,53 kr** kända men odaterade (2920: 58 750,00 + 289x:
  23 666,53), **64 307,42 kr** uppskattad bolagsskatt och 2510:s debetsaldo
  −155 145,00 kr — alla utanför hinkarna, med skäl. `taxLiability.total_ore` =
  21 434 707 ören = moms 2 600 745 + AGI 12 403 220 + bolagsskatt 6 430 742,
  exakt kravspecens oberoende angivna 214 347,07 kr, ingen `AVVIKELSE`.

  ⚠️ **Rättelse (samma dag, granskningens fynd 2).** Den första versionen av den
  här loggen påstod "0 → 26 007 kr" och "188 340,07 kr bolagsskatt". Talen kom ur
  en REKONSTRUKTION i testdatabasen som antog AGI = 0 och som validerade sig själv
  cirkulärt: bolagsskatteunderlaget (3041) hade satts så att 20,6 %-beräkningen
  träffade residualen mot specens totalsumma — en residual som i verkligheten är
  AGI + bolagsskatt. Att totalen stämde bevisade därför ingenting. Produktionen
  har fyra obetalda löneperioder och ett resultat före skatt på 312 171,94 kr, inte
  914 272,18 kr. **Lärdom: ett tal som stämmer mot ett antaget underlag är inte
  verifierat — mät mot en kopia av verkligheten, inte mot din egen modell.**

  `npm run build` ren, `npm test` = **731 tester i 86 sviter, alla gröna**.
  Inget befintligt testfall ändrat. Sviter: `server/test/liquiditySources.test.ts`
  (9 fall; verifierad genom körning mot koden FÖRE ändringen) och
  `server/test/liquidityGuard.test.ts` (dubbelräkningsvakten prövad direkt).
  Grenen är INTE mergad och INTE pushad. Full rapport:
  `/tmp/bygg-likviditet-rapport.md`, fixrundan i samma fil.

- **2026-08-20 (`design/entiteter-1`: entitetslänkar — namn är vägar, inte
  strängar):** Davids order var att namn ska leda vidare och att sidor med
  kopplad information ska sluta vara isolerade händelser. Fyra entitetstyper
  gjordes helt navigerbara — kund, leverantör, relation, projekt — hellre än
  alla halvvägs. Endast vylagret + fyra tillagda id-kolumner i befintliga
  SELECT:ar. Inga nya rutter (60 GET-rutter före och efter), inga migrationer.

  1. **`entityLink()` i `html.ts` är enda sättet att skriva ut ett entitetsnamn.**
     Sökvägssegmentet bor på ett ställe. Saknas id renderas ren TEXT — en länk
     som ser klickbar ut och inte är det är värre än ingen länk. Det gör
     undantagen (person utan organisation, fri motpartstext) explicita i koden.
  2. **25 ställen bytta.** Bl.a. fakturalistans kundnamn, som gick till
     FAKTURAN — samma mål som numret och "Öppna"-knappen på samma rad. Tre
     länkar till samma ställe, och kunden gick inte att nå därifrån.
  3. **Bakåtreferenser på partsidan** (`partyBackrefs`): fakturor, öppna
     reskontraposter, åtaganden och (för kund) projekt — placerade FÖRE taggar
     och kontakter, för den som öppnar ett kundkort frågar "vad har vi gjort och
     vad är utestående". Tomma sektioner döljs aldrig; de säger sitt skäl.
     Leverantörens åtagandesektion skriver ut varför den aldrig kan innehålla
     något (relationer kopplas till kundregistret, inte till leverantörer).
  4. **Underlag är länkar:** fakturans verifikat-id → `ledger#v-{id}`, och
     huvudbokens verifikatkort bär ankaret. `:target { scroll-margin-top }` så
     att fragmentet inte landar under det klistrade sidhuvudet (WCAG 2.4.11) —
     samma fix som `/opt/arenden` redan gör.
  5. **Länkrevision i test** (`server/test/entity-links.test.ts`): läser
     vyrouterns egen stack, renderar 34 sidor, kräver att VARJE
     `href^="/app/c/"` matchar en registrerad GET-rutt. Verifierad genom att en
     medvetet trasig länk injicerades och fick testet att falla. Noll trasiga
     länkar. Det är det enda som håller över tid.

  `npm run build` ren, `npm test` = **716 tester i 84 sviter, alla gröna**.
  Ett befintligt test uppdaterat (fakturarubrikens kundnamn är nu en länk).
  Grenen är INTE mergad och INTE pushad. Full rapport: `/tmp/bygg-ent-rapport.md`.

- **2026-08-14 (designjämförelse: "ser det verkligen ut som designen?"):**
  Davids fråga var befogad. Sviten bevisade att koden FUNGERAR — aldrig att den
  ser ut som underlaget. Två olika saker. Jag startade appen, seedade data som
  motsvarar designens exempel och fotograferade skärmarna (1280 px och 390 px).
  Sju avvikelser, alla åtgärdade, ett test per punkt i
  `server/test/crm-design-parity.test.ts`:

  1. **Två av sex nyckeltal var fel — och just de två var poängen.** Designen:
     Obetalt och Ofakturerad tid. Byggt: "Tyst i" och "Personer" (det senare en
     dubblering av kortet under). De två saknade är de tal inget renodlat CRM
     kan visa: Attio måste fråga vad affären är värd, vi vet. Nu härledda ur
     reskontran respektive tidrapporterna, med länk vidare.
  2. **Granskningsraden följde inte §5.** Designen krävde fyra saker för ett
     tiosekundersbeslut: före → efter, varför, varifrån, två knappar. Byggt var
     en rå fältlista. Nu `explainApproval` för alla känsliga åtgärder; fältlistan
     kvar men hopfälld.
  3. **"Lova något" saknades helt** — man kunde stänga löften men inte skapa
     dem. Samma felklass som hela ombyggnaden handlade om.
  4. **Skälet var maskinformulerat.** "1 förfallet åtagande" → "vi lovade:
     Skicka tidplan för fas 2. — förföll 2026-08-10". Skälet ska gå att läsa som
     en öppningsreplik.
  5. Belopp på kort i hela kronor (`kronor()`), inte ören.
  6. Telefon: ⋯ blev en fullbred stapel — container query träffade för brett.
  7. Org.nr normaliseras till NNNNNN-NNNN som i kundregistret; källsystemet
     skrivs som namn ("Gmail") och nyckeln i maskinstil.

  Dessutom: godkännandesidan körde parallella frågor på EN anslutning
  (pg-varning) — nu sekventiellt, samma regel som i crmRelations.

  **Medvetet AVSTEG från designen:** §5 visade AI-förslag på enskilda FÄLT i
  granskningskön ("Eva Larsson → Eva Larsson, Ekonomichef"). Så byggdes det
  inte. CRM-skrivningar är `write` och körs direkt; skyddet är i stället F4:s
  ursprungsmärkning plus regeln att människan vinner. Skälet: varje synkat mail
  med en titel hade blivit ett köobjekt, och en kö med 40 fältförslag är exakt
  den anklagelse dagsytans kap finns för att undvika. Vill vi ha designens
  bokstavliga beteende är det en ändring av sensitivity — med den kostnaden.

  `npx vitest run` → **82 filer, 691 tester gröna**, `npm run build` ren.

- **2026-08-17 (LOC-322, gravstenen efter en sammanslagning):** Sista biten av
  överlämningen "CRM saknar sätt att slå ihop eller döpa om en organisation".
  Sammanslagningen (`merge_crm_organizations`) och namnbytet
  (`upsert_crm_organization` med `organization_id`) byggdes i F5; det som saknades
  var att beslutet inte överlevde natten. Diagnosen är mätt i koden:
  `ingestCrmEvents` slår upp organisationen på **namn** innan `source_ref` ens
  konsulteras, så Hermes/ILT-Education/NVR-001 skapades på nytt vid varje
  körning — och eftersom de sex åtagandena redan låg rätt efter sammanslagningen
  var det som återuppstod ett **tomt skal** som förorenade tystnadslistan och
  dagsytan. David hade fått göra om samma sammanslagning efter varje nattkörning.
  - **Migration 0059** `crm.organization_name_aliases` (nyckel
    `company_id + lower(name)`, RLS, SELECT/INSERT/**DELETE** men ingen UPDATE —
    ett alias skrivs aldrig om). CASCADE på organisationen: aliaset lever med
    raden, inte med händelserna, och gallras därför inte på tid.
  - `crmMerge.ts` skriver gravstenen för den inslagna radens namn och **ärver
    dess egna alias** (A→B, B→C ⇒ "A" leder hela vägen till C). Flytten sker som
    DELETE+INSERT eftersom tabellen medvetet saknar UPDATE-rättighet.
  - `upsertOrganization` slår upp aliaset först när den riktiga organisationen
    INTE finns, och bara för `source: 'sync'`. Det gamla namnet får aldrig döpa
    om den kvarvarande raden (`writeName`) — då hade gravstenen gjort tvärtom
    mot vad den finns för.
  - **Redovisat, inte tyst:** `redirected_organizations` i ingest-svaret
    (`"Hermes → Hermes Bevakning AB"`), samma regel som `unlinked_organizations`
    och `kept_human_fields`. Loggen bär bara antal — aldrig namnet.
  - **Ångerknapp:** `remove_crm_name_alias` (write, ingen godkännandekö — en
    ångerknapp bakom en kö är ingen ångerknapp) + "Tidigare namn" med knapp på
    relationssidan. Risken aliaset bär är att det tyst kapar ett riktigt bolag
    med samma namn 2027; den bärs av tre spärrar (riktig rad först, bara synken,
    allt redovisas) och av att en människa kan lyfta det. GDPR-raderingen tar
    bort aliasen — ett tidigare namn har ingen bevarandegrund.
  - Tester: `server/test/crm-name-alias.test.ts` (slå ihop → kör om ingesten →
    ingen ny rad; nya mail landar rätt; kedjan; människans upsert styrs aldrig
    om; borttaget alias ger egen rad igen; loggen namnfri; vyns handgrepp;
    GDPR). Dokumentation: `docs/crm/API_KONTRAKT.md` ("Ett hopslaget namn
    återuppstår inte").
  - **Grind:** typecheck och svit kördes INTE i den här sessionen (kördes av
    körskriptet efteråt) — utfallet ska klistras in här innan LOC-322 stängs.

- **2026-08-14 (Relationsytan F1–F6, branch `feature/crm-ux`):**
  Ombyggnaden av CRM-ytan från funktionell till färdig, efter Davids
  deep-research-underlag. Diagnosen mätt i koden: vyn hade **47 POST-rutter för
  fakturor/kvitton/lön och NOLL för relationer** — alla tre CRM-sidorna var rena
  läsytor, så varje handgrepp krävde AI eller API. Det var den strukturella
  orsaken till att ytan kändes död, inte en saknad knapp.

  Bärande tes: bygg inte ett CRM till, bygg det enda CRM som redan VET vad
  relationen är värd. Pengarna är ett faktum här och en gissning överallt annars.

  - **F1 Handgreppen** — POST-rutter för klar/öppna/skjut upp/avskriv, hörde av
    mig, tysta; popover-överflödsmeny (noll JS); snabbregistrering av kontakt.
    Migration 0056: `snoozed_until` + `muted`. Uppskjutning rör ALDRIG
    förfallodatumet — löftet är löftet.
  - **F2 Dagsytan** (`/idag`) — kapad lista (5) som KAN bli tom, aldrig totalen.
    Varje kort bär sitt skäl; skälet är både rangordning och öppningsreplik.
  - **F3 Tråden** — en kronologi per relation i EN `UNION ALL`-fråga, med
    fakturan och betalningen bredvid mailet. Filterflikar som länkar.
  - **F4 Ursprung** — migration 0057 `crm.field_provenance`: ursprung PER FÄLT.
    **Människan vinner:** en synk skriver aldrig över ett människobeslut, och
    filtreringen redovisas (`kept_human_fields`). `ActionContext` bär nu `actor`.
    "Stämmer" = ett klick gör gissningen till ett beslut. Kvitton på Att göra.
  - **F5 Kadens/sammanslagning/sökning** — migration 0058 `cadence_days` per
    relation; `merge_crm_organizations`/`merge_crm_people` (känsliga, ingenting
    kastas, tomma fält fylls); `search_crm` över fyra register i navraden.
  - **F6 Finputs** — cross-document view transitions (två rader CSS, noll JS),
    container queries på innehållsytan, tomma tillstånd med nästa steg + ett
    riktigt "Ny relation"-formulär.

  Grind: `npx vitest run` → **80 filer, 672 tester gröna**, `npm run build` ren.
  `/code-review` gav 15 fynd — ALLA åtgärdade, med test per fynd i
  `server/test/crm-review-fixes.test.ts`. De fem viktigaste:
  1. `confirm_crm_value` satte alltid `human` oavsett aktör → en agent kunde
     stämpla sin EGEN gissning som människobeslut och låsa den mot rättelse.
     Nu 403 för `actor='agent'`.
  2. GDPR-raderingen tog inte bort `crm.field_provenance` för organisationen
     (raden behålls enligt bokföringslagen) → pekare till raderade mail levde
     kvar. Gallringen nollar nu också `source_ref` till det som gallrats bort.
  3. `isThreadFilter` använde `in` → `?visa=constructor` gav 500.
  4. Dagsytans löfteshög var INTE kapad — bara relationerna. 120 rader under en
     rubrik är exakt den anklagelse kapet finns för att undvika.
  5. Sammanslagning av två organisationer med samma e-postlösa person fällde
     hela transaktionen på `people_name_uk` — i exakt det läge sammanslagningen
     finns för. Kolliderande namnlösa personer slås nu ihop först.
  Dessutom: `?fel=`-notiser renderades inte på relations-/åtagandesidorna (tyst
  misslyckande), en orimlig kadens raderade den som fanns, arkiverade relationer
  visade tomma nyckeltal, och "Föreslå aldrig" gick inte att ångra i vyn.
  Ny läsåtgärd `crm_today` — vyn har haft dagsytan sedan F2 men AI:t kunde inte
  ställa frågan.

  **Gallringsperioden är BESVARAD:** David valde **7 år (84 månader)**.
  Flaggat för honom att 7 år är bokföringslagens arkiveringstid och att
  relationsdata medvetet INTE är räkenskapsinformation — det var hela skälet
  till ett eget schema. Här styr GDPR:s lagringsminimering, så perioden är hans
  verksamhetsbeslut, inte en följd av lagen. Han stod fast, och inställningen
  finns nu som handgrepp i vyn (Relationer → Gallring av relationsdata) i
  stället för att bara gå via AI/API — samma brist som resten av F1–F6 rättade.
  Perioden visas som "84 månader (7 år)"; ett tal i månader säger en människa
  ingenting. Gallringen läser policyn vid körning (inte ett formulärfält) och
  hamnar i Att göra — ett klick raderar ingenting.

- **2026-08-14 (David i drift: personerna syntes inte på kundkortet):**
  Följdfynd till kopplingsbuggen. En människa kan nu finnas på TVÅ ställen:
  `party_contacts` (kundregistret, ifyllt för hand) och `crm.people`
  (relationen, ifylld av synken). Kundkortet läste bara det första, så alla som
  kommit in via API-kontraktet var osynliga på precis den sida man öppnar när
  man undrar vem man pratar med hos kunden. **Fix:** kortet JOINar nu in
  relationens personer (kopierar dem inte — det finns fortfarande en sanning per
  person) och visar dem i samma tabell men märkta "Från relationen", med
  senaste kontakt, öppna åtaganden och en länk vidare till relationssidan. De
  hålls åtskilda med flit: registren har olika ursprung och olika gallring
  (relationsdata får raderas, kundregistret styrs av bokföringslagen), och en
  hopslagning hade dolt var en uppgift kommer ifrån. GDPR-texten på kortet säger
  nu också att relationens personer, kontaktpunkter och åtaganden raderas.
  **586 tester i 73 sviter gröna.**
  *Kvarstår som designskuld:* två personregister är ett glapp, inte en design.
  Nästa naturliga steg är att låta kundkortets kontaktformulär skriva till
  relationen i stället — men det rör E1:s befintliga data och tas som ett eget
  pass, inte som en sidoeffekt av en buggfix.

- **2026-08-13 (bugg funnen av David i drift: ingesten kopplade aldrig kunden):**
  `ingest_crm_events` — API-kontraktets PRIMÄRA producent — satte aldrig
  `customer_id`. Kolumnen fanns, `upsert_crm_organization` stödde den, men
  ingest-vägen kunde inte skicka den eftersom avsändaren (Hermes) inte känner
  systemets uuid:n. NVR och ILT, som finns i kundregistret med exakt matchande
  namn, landade som prospekt med tom koppling. Eftersom omsättningen hämtas via
  just den kopplingen räknade styr- och relationsvyerna NOLL för de största
  kunderna — och det såg ut att fungera: raden fanns, namnet stämde, inget fel
  returnerades. Samma felklass som localhost-fallbacken och de tysta nollorna.
  **Fix:** kunden slås nu upp i tjänstelagret (alla skrivvägar) med samma sorts
  naturliga nyckel som resten av kontraktet — organisationsnummer först (jämfört
  på siffror), annars exakt namn. Två fall länkas ALDRIG automatiskt: flera
  matchande kunder, och en kund som redan hör till en annan organisation. De
  rapporteras i stället i `unlinked_organizations` i ingest-svaret, och märks ut
  med "Ej i kundregistret" i relationsvyn — annars vore en tom koppling återigen
  ett tyst nollresultat. Migration 0055 gör samma uppslag en gång för det som
  redan ligger inne. **Lärdom:** testet maskerade buggen genom att kalla
  `upsert_crm_organization` med `customer_id` direkt efter ingesten, alltså göra
  något ingest-vägen aldrig kan göra. Den raden är borttagen; testet kräver nu
  att kopplingen uppstår av sig själv. **584 tester i 73 sviter gröna.**
  Uppgraderingsvägen körd mot data i Davids form: prospekt med tomma kopplingar
  → 0055 → NVR/ILT kopplade och status satt till kund, tvetydiga namn och äkta
  prospekt orörda, omkörning applicerar 0.

- **2026-08-13 (session: granskningspass på hela CRM-bygget före produktion):**
  En full kodgranskning av `3f45cd8..main` gav 13 fynd, alla åtgärdade. De fyra
  tyngsta var verkliga fel, inte stilfrågor:
  (1) **GDPR-raderingen kraschade på andra kunden** — organisationen döptes om
  till exakt "Raderad (GDPR)", som krockade med unik-indexet. En raderingsbegäran
  som inte gick att uppfylla. Nu bär namnet radens egen id-prefix.
  (2) **En radering kunde återuppstå.** Raderingen tog bort kontaktpunkterna —
  och därmed nycklarna som gör synken idempotent — så nästa nattkörning
  återskapade personen, e-posten och mailsammanfattningarna. Nu skrivs
  gravstenar (`crm.erased_sources`, migration 0054) INNAN raderingen, och
  återuppspelning avvisas. Nya händelser släpps fortfarande igenom.
  (3) **Underkonsulten var bara spärrad i action-lagret och vyn.** De äldre
  REST-rutterna svarade 200 med tom lista (som en agent läser som "det finns
  inga kunder") och skrivningar blev 500 ur RLS. Spärren ligger nu i
  förtroendegränsen (`requireCompanyAccess`), och 42501 mappas till 403.
  (4) **Personmatchningen var bolagsbred**, så två personer med samma namn på
  olika företag slogs ihop och den ena flyttades med hela sin historik. Namnet är
  nu unikt inom ORGANISATIONEN (index bytt i 0054), och en händelse utan e-post
  matchar en person som redan har en — annars lade varje kalenderevent en dubblett.
  Övriga: artikelprissatta abonnemang räknades som noll i styrvyns täckning;
  `set_work_actor_user`/`assign_project_actor`/`unassign_project_actor` är nu
  KÄNSLIGA (de ÄR behörigheten, en AI ska inte kunna flytta åtkomst utan
  godkännande); inaktiverad aktör stoppas nu även på den härledda vägen;
  uppdateringar i synken auditloggas; ingest-räknarna ljuger inte längre vid
  rollback; relationsvyn kör inte samma tunga fråga två gånger; `get_party_crm`
  gör en existenskontroll i stället för tre; inbjudan säger inte längre "medlem"
  till en underkonsult. **579 tester i 73 sviter gröna.** Uppgraderingsvägen körd
  mot databas med data: 0053 → 0054, inga rader tappade i indexbytet, dubblett
  inom samma organisation fälls, samma namn hos annan organisation tillåts,
  omkörning applicerar 0.

- **2026-08-13 (session: CRM-bygget på sidogrenen `feature/crm`, E1 + E7a):**
  Underlaget är `docs/bmadcrmunderlag.md` (Davids BMAD-brief). Arbetet sker på en
  sidogren och mergas till main först när hela lösningen är prövad.
  **E1 (läs-tillbaka-primitiver):** agenten kunde SKRIVA kontakter och
  anteckningar men inte läsa tillbaka dem, och ingen unik-spärr fanns — en
  nattlig synk som kördes om lade dubbletter för alltid. Nya actions
  `list_contacts`, `list_notes`, `get_party_crm`, `get_customer`,
  `get_supplier` samt idempotent `upsert_contact`. Nyckel: e-post när den finns,
  annars namn inom samma part; uppslaget sker i TVÅ steg, annars blev "samma
  person, nu med e-post" en dubblett (testet fångade det i bygget). Migration
  0050 slår ihop befintliga dubbletter utan informationsförlust och lägger två
  partiella unika index som yttersta garanti. Läsvägarna fick `assertParty` —
  utan den svarade en främmande part `200 []`, vilket agenten läser som "inga
  kontakter finns".
  **E7a (aktör + inköpskostnad på tidrapport):** flyttad tidigt i byggordningen
  av beslut B3 — underkonsulter inom sex månader, och migreringen rör
  fakturaunderlaget. Ny tabell `work_actors` (intern/underkonsult, valfri
  koppling till användare/anställd/leverantör, standardtaxa för INKÖPSKOSTNAD),
  `time_entries.performed_by_actor_id` + `cost_rate_ore` (migration 0051).
  Två skillnader som lätt slarvas bort och därför är låsta med tester:
  `hourly_rate_ore` är PRISET mot kund, `cost_rate_ore` är vad timmen kostar
  OSS; `created_by` betyder fortfarande vem som REGISTRERADE posten, aktören är
  vem som UTFÖRDE arbetet. Härledningskälla: aktören sätts automatiskt till den
  inloggades — som skapas vid första tidposten — så ingen behöver komma ihåg att
  fylla i den. Kostnaden fryses vid registreringen (en höjd taxa i morgon ska
  inte skriva om gårdagens marginal). Marginal räknas som fakturerbar intäkt
  minus kostnad för ALL tid, även ofakturerbar. Projektvyn visar utförare,
  inköpskostnad och marginal per person. `user_id` går medvetet inte att sätta
  utifrån: kopplingen ska styra åtkomst (E7b) och app-rollen kan enligt RLS bara
  se sitt EGET medlemskap — den kan alltså inte verifiera ett inskickat
  användar-id.
  Uppgraderingsvägen är körd, inte påstådd: databas på 0050 med data (1 985
  minuter, samma storleksordning som produktionen) → 0051 → varje historisk
  tidpost med registrerare fick en aktör, två likanamniga användare fick var sin
  (den andra via e-post), en post utan registrerare lämnades utan aktör, och en
  omkörning applicerade 0 migrationer utan dubbletter.
  **525 tester i 69 sviter gröna, `npm run build` ren** vid den punkten.
  **E2 (schemat crm + RLS + audit + rollmodell):** relationsdata fick ett eget
  schema `crm` (migration 0052) med organisationer, personer, kontaktpunkter,
  åtaganden, egen append-only auditlogg och gallringspolicy. Två skäl, båda
  strukturella: ett prospekt kan inte bo i kundtabellen (regeln "aldrig kund före
  vunnen affär" gjorde att affären före fakturan saknade plats), och relationsdata
  är inte räkenskapsinformation — den ska varken följa med i SIE-exporten till
  revisorn eller omfattas av sjuårig arkivering. Schemat gör den gränsen till en
  namnrymd i databasen i stället för en regel någon ska minnas. `crm.deals`
  skapas men står TOM: beslut B2 säger att affärsobjektet inte byggs nu, bara att
  modellen ska ha plats för det. Tidrapportering är medvetet ingen giltig källa
  för kontaktpunkter (spärr 7) — CHECK-villkoret i databasen är spärren.
  **Rollmodellen (migration 0053)** var det som kunde blivit farligt: alla
  befintliga RLS-policyer frågar `app_has_company_access`, så en ny roll hade
  fått läsa fakturor, löner och bokföring från dag ett. I stället utesluts
  `contractor` ur den funktionen — en rad som stänger varje tabell — och åtkomst
  öppnas explicit, en tabell i taget: sitt tilldelade projekt och sin egen tid,
  inget annat. Nya `project_assignments`, `set_work_actor_user` (kräver ägare/
  admin OCH att målanvändaren är medlem) och 403 `contractor_not_permitted` på
  hela action-lagret. Mätt i databasen med rollens egen identitet i
  RLS-kontexten, inte bara genom API:t.
  **549 tester i 71 sviter gröna, `npm run build` ren.** Uppgraderingsvägen körd:
  databas på 0051 med data → 0052+0053 → ägaren har kvar åtkomst till bolag,
  kunder, projekt och tid, kan skriva i `crm`, och omkörning applicerar 0.
  **E4 (API-kontrakt + härledningsjobb):** källorna (mailindex, kalender, Linear)
  ligger utanför systemet, hos Hermes. Kontraktet är enkelriktat med flit — det
  här repot ringer aldrig Hermes, det tar emot. `ingest_crm_events` tar en batch
  med NATURLIGA nycklar (organisationsnamn, e-post) eftersom avsändaren inte
  känner våra uuid:n, kör varje händelse i en egen savepoint så en trasig rad
  inte rullar tillbaka de 399 andra, och är idempotent på
  `source_system + source_ref`. Härledningarna räknas fram vid LÄSNING i stället
  för att lagras — en materialiserad härledd sanning blir gammal i tysthet:
  `crm_relation_state`, `crm_silence_report` (30 dagar som standard, parameter)
  och `crm_contact_suggestions` (förfallet löfte väger tyngst, koncentrationen
  syns). Senaste kontakt räknas nu på organisationen OCH dess personer — ett mail
  till kundens beställare är kontakt med kunden. `docs/crm/API_KONTRAKT.md`
  beskriver gränssnittet för andra sidan.
  **E5+E6 (vyerna):** tre nya sidor i den JS-fria vyn — **Relationer** (förslag
  överst med skäl, sedan alla relationer med tystnad, löften och värde),
  **Åtaganden** (vem lovade vad, när, och VAR det sades, med källhänvisning) och
  **Styrning** (intäktstakt, kundkoncentration med varning vid ≥50 %, känd
  täckning framåt = obetalda fakturor + ofakturerad tid + abonnemang, uttryckt i
  antal månaders kostnader). Öppna affärer räknas inte som täckning — de bor i
  Linear enligt B2. Ingen av sidorna kan skicka något till en kund.
  **Slutgranskning mot Del 6-checklistan** fann en verklig regression:
  `anonymize_party` (GDPR) kände inte till det nya schemat, så en
  raderingsbegäran hade lämnat kvar personer, mailsammanfattningar och löften i
  `crm`. Åtgärdat — relationsdatan har ingen bevarandegrund alls och tas nu
  ALLTID bort i sin helhet, med antalen redovisade i svaret. Att datan ligger i
  ett eget schema är skälet till att den GÅR att radera, inte en ursäkt för att
  låta bli. Övriga punkter kontrollerade: inga nya env-läsare, inga dynamiska
  kolumnnamn, ören som heltal, allt bakom RLS, inget skickas till kund,
  migrationerna körbara två gånger.
  **571 tester i 73 sviter gröna, `npm run build` ren.**
  **Öppen fråga till David:** gallringsperiod för relationsdata (`set_crm_retention`)
  — systemet gissar aldrig, så tills du säger ett antal månader gallras ingenting.

- **2026-08-13 (session: granskningspass på navigationen före produktion):**
  Kodgranskning av 999fe5b gav 7 fynd, alla åtgärdade före release:
  (1) "du är här"-pillen spillde SIDAN i sidled på telefonbredd när grupp +
  sidnamn var långa (Leverantörsreskontra) — flex:none → 0 1 auto + ellips på
  sidnamnet, och på ≤480px viker gruppdelen undan; (2) menypanelens bredd var
  100vw-baserad, som INKLUDERAR en klassisk rullist (~17px på Windows/Linux) →
  vågrät rullist så fort menyn öppnades där; headless Chromium (overlay-
  rullister) kunde aldrig se det — nu 48px headroom och verifierat med
  clientWidth−17-matte; (3) aria-label="Visa alla sidor" skrev över synliga
  "Meny" (WCAG 2.5.3, röststyrning bryts) — borttagen; (4) heltäckningstestet
  läste hela sidan i stället för nav-markupen, så en tappad menypost kunde
  maskeras av en länk i sidinnehållet — skärpt till navMarkup(); (5) tre
  sessionsloggposter var feldaterade 2026-07-31 (committade 2026-08-12/13) —
  rättade; (6) flatMap per rendering → modulnivå-Map; (7) dubblerad
  reduced-motion-regel borttagen (global kill switch finns). Ommätt på VÄRSTA
  sidan (payables) i 1440/900/560/390/380/320 px, stängd + öppen meny: noll
  sidledsspill, panelen klarar klassiska rullister. 503 tester i 67 sviter.

- **2026-08-13 (session: navigationen omgjord):** 28 länkar låg på EN rad i
  byggordning — omöjlig att överblicka och obrukbar i ett smalt fönster. Nu:
  en **snabbrad** med de vanligaste sidorna (Översikt, Att göra, Fakturor,
  Kvitton, Lön) + en **Meny-knapp** som fäller ut en grupperad panel, ordnad
  efter hur ofta sidorna används: Dagligen → Kunder & leverantörer → Lön &
  projekt → Moms, skatt & bokslut → Rapporter & arkiv → System. Varje grupp har
  en förklarande underrubrik ("Det du öppnar oftast", "Ställs in sällan").
  **Helt JS-fritt** — `<details>/<summary>` enligt husets mönster (CSP:n
  förbjuder skript); ingen `onclick`, inget bibliotek. Panelen använder
  KOLUMNFLÖDE (`columns`), inte grid: grid lämnade stora döda hål under de
  korta grupperna. Höjden är kapad (72vh) med intern scroll. **Var man är**
  syns alltid: aktiv sida får pill + prick + `aria-current="page"` i menyn, och
  ligger sidan utanför snabbraden visas en pill i navraden med BÅDE grupp och
  sidnamn ("Moms, skatt & bokslut · Skatt"). Sidhuvudet (appbar + nav) är nu en
  gemensam sticky enhet med suddig bakgrund. Mätt i Chromium på 1440/900/560/380
  px: ingen sidledsscroll, panelen får plats i alla bredder (appbaren radbröt
  förut — bolagsnamnet och sedan varumärkestexten viker undan i stället).
  Testerna vaktar att INGEN av de 28 sidorna tappas bort i grupperingen.
  503 tester i 67 sviter gröna.

- **2026-08-13 (session: ej avdragsgilla kostnader härleds automatiskt):**
  Uppföljning på F3 ovan — den noten sa att kopplingen till deklarationen var
  manuell; det gäller inte längre. Konton som är ej avdragsgilla till sin natur
  har nu en flagga (`accounts.is_non_deductible`, satt för 6072 och 6992 i
  migration 0049). INK2S räknar fram beloppet till ruta 4.3 c direkt ur
  huvudboken — bokför man en förseningsavgift på 6992 hamnar återläggningen där
  utan handpåläggning. Härlett och manuellt registrerat redovisas som SEPARATA
  rader (med kontonummer och belopp per konto i `derived_non_deductible`) så att
  inget dubbelräknas oupptäckt; manuella justeringar finns kvar för det som inte
  har eget konto (t.ex. ej avdragsgill del av en blandad kostnad). Egna konton
  kan flaggas via `set_account_non_deductible` (skapar en bolagsspecifik
  skuggkopia av standardkontot, eftersom RLS inte tillåter bolaget att ändra
  standardplanen). Förbehållet i INK2S är uppdaterat. 496 tester i 66 sviter.

- **2026-08-12 (session: tre flaggade förbättringar):** Låg bara som
  anteckningar i systemnoten, nu byggda med test (`usability-fixes`).
  **F1 — okänt konto föreslår närmaste giltiga.** `assertAccountsExist` avvisade
  bara ("okända konton: 6892"). Nu föreslås närmaste giltiga konton ur bolagets
  EGEN kontoplan, begränsat till SAMMA kontoklass (ett kostnadskonto föreslås
  aldrig för ett intäktskonto — det skulle ge en felaktig men "godkänd"
  kontering). Upptäckt under bygget: API:t returnerade medvetet BARA felkoden,
  så förslaget hade aldrig nått fram. `AppError` fick därför ett frivilligt,
  strukturerat `details`-fält som errorHandler skickar med (samma mönster som
  zod-felen redan använde) — `message` stannar fortfarande på servern. Nu ser
  både människan (notis i vyn) och AI:n via MCP (`details.suggestions`) vilket
  konto som menades. OBS: känsliga åtgärder validerar kontot när de UTFÖRS, så
  för t.ex. post_voucher syns förslaget vid godkännandet, inte vid förslaget.
  **F2 — Att göra visar vilken post förslaget gäller.** Kortet visade råa
  UUID:n, så den som skulle godkänna inte såg vilken faktura/lön det gällde.
  `describeApproval` löser upp ID:n till "Faktura 27 · ILT Inläsningstjänst AB ·
  43 202,50 kr", "Lön 2026-07 · David Mancilla · netto …", "Verifikat A12 · …".
  Felsäker: en post som inte kan läsas utelämnas — kön ska alltid gå att visa.
  **F3 — konto 6992** (övriga externa kostnader, ej avdragsgilla) saknades i
  standardkontoplanen trots att 6991 och 6072 fanns; ej avdragsgilla kostnader
  hamnade därför på ett avdragsgillt konto. Migration 0048. OBS: kontot bokför
  bara kostnaden — återläggningen i INK2S (ruta 4.3 c) registreras fortfarande
  separat via `tax_adjustments`, systemet härleder den inte ur kontonumret.
  489 tester i 65 sviter gröna.

- **2026-07-31 (session: LOC-263 fakturadesign + seriesynk):** Del 1 av LOC-263
  (husmallen på sida 1) var redan gjord 2026-07-22; denna session byggde
  resten. **Bilagan (sida 2)** porterad ur Davids verkliga fakturor: tidsvariant
  (facit faktura 0000027 — Datum/Beskrivning/Timmar, "Summa fakturerbar tid
  31,42 h") och utläggsvariant (facit 0000024 — SEK + exkl./moms/inkl. moms +
  fotnoter). Tid lagras som HELTAL MINUTER (0,42 h = 25 min; totalen 1885 min),
  utlägg som ören — aldrig flyttal. Sida 2 har ingen logga (mallen släppte den
  i den nyare varianten 27). Bilagan kan fyllas explicit ELLER hämtas ur
  systemets egen tidrapportering (`invoice_appendix_from_time_entries`, som
  markerar tidsposterna fakturerade så de inte kan dubbelfaktureras).
  **Seriesynk** (vägval David): EN serie framåt — `set_invoice_number_series`
  flyttar räknaren (endast FRAMÅT, auditloggat) och `set_external_invoice_numbers`
  registrerar kundens nummer på gamla avvikande fakturor (internt 14 = externt
  26, internt 26 = externt 27). Båda är `sensitive` → mänskligt godkännande.
  DB-garanti: genererad kolumn `effective_invoice_number` + DEFERRABLE unik
  nyckel per bolag → två fakturor kan ALDRIG visa samma nummer för kunden, och
  en batchomnumrering funkar i valfri ordning. Registrering av kundnummer
  flyttar räknaren förbi det (annars krockade nästa nya faktura — fångades av
  testet). **OCR (vägval David): systemets Luhn-giltiga OCR gäller framåt** —
  husmallens 12-siffriga (202626010027) är INTE Luhn-giltigt och riskerar
  avvisad betalning om bankgiroavtalets OCR-kontroll är på; värt att stämma av
  med banken. Bokförd historik numreras aldrig om; originalen finns arkiverade
  som bilagda dokument. Testhjälparen `pdfText` fixad: PDFKit skriver WinAnsi,
  där 0x80–0x9F är typografiska tecken — tankstreck (–) blev tidigare ett
  osynligt kontrolltecken och gav falskt röda PDF-assertions. 482 tester i 64
  sviter gröna. KVAR: `locollabs-fakturamall.md` har jag inte sett — mallen är
  porterad ur de två verkliga PDF:erna, så stäm av mot referensdokumentet.

- **2026-07-24 (session: testisolering, T3):** Sviten var ORDNINGSBEROENDE —
  den delade Postgres-databasen skapades färsk en gång men nollställdes
  ALDRIG mellan testfiler, så en fil kunde läcka tillstånd in i nästa
  (symptom: k10:s `beforeAll` föll i full svit men passerade isolerat, med det
  kryptiska `Cannot read properties of undefined (reading 'id')`). Fix:
  **(T3.1)** `createFiscalYear`-hjälpare i `test/helpers.ts` som asserterar
  HTTP-status (201) med hela svarskroppen — blinda `fy.body.fiscal_year.id`
  ersatta i k10 + 18 andra filers setup, så framtida setup-fel namnger
  verklig orsak i stället för "undefined.id". **(T3.2, rotfix)** `globalSetup`
  migrerar en gång och tar en MALL-databas (`redovisning_test_template`);
  `test/setup.ts` återskapar `redovisning_test` FRÅN mallen i ett `beforeAll`
  före varje fil (DROP … WITH FORCE + CREATE … TEMPLATE) → varje fil startar
  mot en pristin, seedad databas och sviten blir oberoende av filordning.
  `fileParallelism:false` gör att bara en fil kör i taget (ingen DROP/CREATE-
  kapplöpning). **(T3.3)** Läckan visade sig vara STRUKTURELL, inte en enskild
  fil: varje dat* skapande fil läckte bolag/användare till nästa (direkt
  bevisat med en temporär bevisfil: utan resetten såg nästa fil `expected 1
  to be 0`, med resetten `0`). Verifierat: full svit grön deterministiskt
  (default-ordning) + grön under `--sequence.shuffle.files`. 469 tester i 63
  sviter, `npm run build` ren. OBS: `--sequence.shuffle.files` (FILordning) —
  tester INOM en fil körs medvetet i definitionsordning (många delar
  describe-tillstånd), vilket är avsiktligt och inte ändrat.

- **2026-07-22 (session: payroll-system-workarounds, forts.):** Livefeedback:
  fakturadetaljsida i vyn (öppna utkast med rader/totaler/OCR, ladda ner PDF
  för mail till kund — återanvänder arkivets fil, radera obokat utkast;
  bokfört kan aldrig raderas). K10-fältens hoppande layout fixad (källtexten
  in i etikettblocket — input ska vara sista barnet i `.field`); en parallell
  session landade samma fix på main (57402d1), versionerna sammanfogade.
  `unlink_voucher` (Davids/parallellsessionens 88b98ba) fick sitt utlovade
  dedikerade test (4 st) + dokumentation i MCP_ACTIONS.md.
  **Fakturamallen porterad från Davids RIKTIGA skickade faktura (0000024)**
  — inte gamla systemets layout: logotyp uppe till höger (companies.
  logo_file_id, tenant-säker komposit-FK i 0045, sätts via set_company_logo),
  Från/Fakturaadress-block, metadatakolumn (OCR, förfallodatum "(N dagar)",
  Leveranstidpunkt, Betalas till, 7-siffrigt fakturanummer, Vår/Er referens,
  IBAN, BIC/Swift), tabell Kvantitet/Beskrivning/Pris/Totalt (timpris
  "SEK/h"), sidfot i fyra kolumner (momsreg/F-skatt, kontakt, hemsida,
  bankgiro). Nya bolagsfält bic/website + invoices.our_reference/
  delivery_period; update_company_settings-action (MCP-väg för bolags-
  uppgifter); "Generera om PDF" på fakturadetaljsidan (ny fil, arkivet
  behålls). ROT/RUT- och omvänd skattskyldighet-texterna (lagkrav) behållna.
  464 tester gröna i 63 sviter.

- **2026-07-21 (session: payroll-system-workarounds, forts.):** Tillägg 2 —
  nya 3:12-modellen för K10 (inkomstår 2026+): grundbelopp 4 IBB (322 400 kr
  2026, källverifierat mot Skatteverket inkl. årslänkningen IBB året före),
  lönebaserat utrymme (8 IBB-avdrag, 50 %, 50×-tak, inga löneuttags-/4 %-krav),
  sparat utrymme utan uppräkning, persisterade K10-beräkningar (autofyll av
  sparat f.å.), k10_prefill ur systemdata + utdelningsbarhetsvarning (ABL),
  ägarandel/aktiekapital i bolagsinställningarna. ≤2025 oförändrat (regression
  på öret). SRU 2026+ vägras tills fältkoder fastställts. main uppdaterad.

- **2026-07-21 (session: payroll-system-workarounds):** Hela K-serien byggd
  (K1–K7 + Tillägg 1, se ovan) på branchen
  `claude/payroll-system-workarounds-lctd41` (ombaserad på awesome-edison).
  Rött CI (LOC-236) fixat. Davids merge av branchen in i awesome-edison
  (2e5b300) låg röd — ett strict-null-fel i det nya Godkänn-knapp-testet —
  rättat i d5447a6 som innehåller ALLT (bägge brancherna). main är ännu INTE
  uppdaterad (pekar på gamla legacy-koden). 433 tester gröna.

- **2026-07-17 (session: awesome-edison):** Fixat "död" Godkänn-knapp (konflikter
  syns nu som notis; rotorsak: betalning föreslagen på obokförd faktura).
  Designsystem: select/textarea/filväljare i samma formspråk + bottenjusterade
  fält. Kvittofoto/PDF-uppladdning i vyn. SIE-import-krasch (25P02) fixad och
  verifierad mot användarens riktiga fil. Skapat detta STATUS-dokument.
- **2026-07-15/16:** V-serien (vyn som fullständig reserv) byggd + grindad
  (8 bekräftade fynd fixade, bl.a. FY-från-datum). Anslut AI-sida. KOM_IGANG.md.
  Mac-appikon + lokal enkommandostart + backup-skript. Registrering i vyn +
  Referrer-Policy-fixen. Railway-deployfiler (ej aktiverade).
- **Tidigare:** Fas 0–E3 + slutgrind (se docs/ACCEPTANS.md, docs/SPÅRBARHET*.md).
