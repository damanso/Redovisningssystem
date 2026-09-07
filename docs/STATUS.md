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
