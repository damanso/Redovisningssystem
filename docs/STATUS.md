# PROJEKTSTATUS — läs detta FÖRST i varje ny session

> **Syfte:** kontinuitet mellan AI-sessioner (BMAD-liknande). En ny session ska
> kunna fortsätta exakt där den förra slutade utan att fråga om historiken.
> **Regel:** uppdatera "Sessionslogg" nederst INNAN du avslutar en session som
> ändrat något, och committa+pusha den med övriga ändringar.

## Vad projektet är

Svenskt redovisningssystem för AB (K2), byggt AI-först: ett action-lager (144
actions) som drivs av antingen **Claude Desktop via MCP** eller **REST-API:t**
eller **den serverrenderade webbvyn** (`/app`, JS-fri HTML). Känsliga åtgärder
(bokföra, betala, låsa period) kräver alltid mänskligt godkännande i **Att göra**
— oavsett vem som föreslog dem. Arkitekturinvarianter: se `CLAUDE.md` (rot).

## Driftläge just nu (juli 2026)

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

## Byggt och verifierat (allt grönt: `npm test` = 701 tester i 83 sviter, `npm run build` ren)

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

## Sessionslogg (nyaste överst — FYLL PÅ HÄR)

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
