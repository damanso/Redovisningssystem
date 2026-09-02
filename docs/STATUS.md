# PROJEKTSTATUS — läs detta FÖRST i varje ny session

> **Syfte:** kontinuitet mellan AI-sessioner (BMAD-liknande). En ny session ska
> kunna fortsätta exakt där den förra slutade utan att fråga om historiken.
> **Regel:** uppdatera "Sessionslogg" nederst INNAN du avslutar en session som
> ändrat något, och committa+pusha den med övriga ändringar.

## Vad projektet är

Svenskt redovisningssystem för AB (K2), byggt AI-först: ett action-lager (157
actions) som drivs av antingen **Claude Desktop via MCP** eller **REST-API:t**
eller **den serverrenderade webbvyn** (`/app`, JS-fri HTML). Känsliga åtgärder
(bokföra, betala, låsa period) kräver alltid mänskligt godkännande i **Att göra**
— oavsett vem som föreslog dem. Arkitekturinvarianter: se `CLAUDE.md` (rot).

## Driftläge just nu (uppdaterat 2026-08-25)

- **Användaren (David Mancilla, oteknisk) kör systemet SKARPT lokalt på sin Mac**
  för bolaget **Locollabs AB**: `bash start-lokalt.sh` (Docker-Postgres på 5433,
  API på `localhost:3000`, webbvyn på `/app`). Backup: `bash backup.sh` → `backups/`.
- Mac-appikon: `bash skapa-macapp.sh` skapar "Redovisning.app" (dubbelklick-start).
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

## Byggt och verifierat (allt grönt: `npm test` = 870 tester i 101 sviter, `npm run build` ren)

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
