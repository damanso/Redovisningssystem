# Granskning och omstartsplan — Redovisningssystem

**Datum:** 2026-07-13
**Underlag:** Fullständig kodgranskning (backend, frontend, migrationer), körning av bygge/tester, live-API-test mot en riktig databas, samt extraktion av kravbilden ur `Claude.md`.

> Denna fil ersätter de tidigare `*_COMPLETE.md`- och `E2E_TEST_REPORT.md`-dokumenten som källa till projektets status. De rapporterna påstår "100 % pass" och "produktionsklart" — det stämmer inte (se nedan) och de bör arkiveras så att de inte vilseleder.

---

## 1. Beslut

**Börja om — men inte från ett tomt blad, och inte genom att laga den gamla koden på plats.**

Rätt strategi är **"skörda och bygg om"**: behåll kraven, domänkunskapen och de få självständiga delar som faktiskt fungerar, kasta implementationen och arkitekturen, och bygg en ny, mindre och korrekt kärna som är designad för AI-först-drift med säkerheten inbyggd från första raden.

### Varför inte "laga på plats"?

Den tekniska koden i sig är inte spaghetti — skiktningen (routes → controllers → services → pg) är konventionell och SQL:en är mestadels parametriserad. En ren kodbedömning landar därför i "60–70 % återanvändbart". Men det beslutet väger bara koden *isolerat*. När man lägger till dina faktiska mål ändras svaret:

1. **Säkerhetsmodellen saknas som *koncept*, inte bara som buggar.** Tenant-kontroll (att en användare bara ser sitt eget bolag) finns i exakt en av elva moduler. Alla andra litar blint på det `company_id` som skickas med anropet. Att retro-fitta in en säkerhetsmodell i elva moduler som alla skrevs fel-som-standard är riskabelt — du kan aldrig vara helt säker på att du täppt varje hål. För ett system som håller ett bolags bokföring räcker inte "förmodligen tätt".
2. **Ditt nya primärkrav ändrar formen.** Den gamla koden är en traditionell webbapp byggd för att klickas av en människa. Du vill nu ha AI som primärt gränssnitt plus en enkel läsbar vy. Det är en annan arkitektur — att laga den gamla vore att laga mot fel mål.
3. **Bara 3–4 av 11 moduler fungerar ärligt hela vägen** ens i utvecklingsläge; resten fungerar bara på "happy path". Frontend är ~10 % påbörjad och 0 % användbar.
4. **Bokföringskärnan saknar sina viktigaste egenskaper** — verifikationsnummerserier och oföränderlighet för bokförda poster. Det är arkitektur, inte buggfix.
5. **Datan går ändå inte att lita på.** Granskningen visar att OCR-nummer som systemet skrivit är ogiltiga och att verifikat kan ha dubbelbokats. Även vid en reparation måste du börja om med datan — vilket tar bort den största fördelen med att laga på plats.

De delar som är mest värda att behålla (PDF-generering, BAS-kontoplan, svensk formatering, e-postmallar, de mestadels korrekta kolumndefinitionerna) är också precis de delar som portar rent in i en omstart. Så du förlorar väldigt lite på att bygga om — och vinner en kärna du kan lita på till 100 %.

---

## 2. Nuläget — vad granskningen faktiskt visade

### Bygge och test
- **`npm run build` (backend) misslyckas** med 12 TypeScript-fel. I produktionsläge fungerar därför **0 av 11 moduler**; även med byggfelen åtgärdade kraschar fyra moduler vid start på ESM-importer utan `.js`-ändelse.
- **Alla 12 testsviter kan inte köras** (fel Jest/ESM-konfiguration, saknad `axios`). Rapporternas "100 % pass" är alltså inte verkligt — testerna har aldrig kunnat exekvera.
- Frontend bygger och typkollar rent, men innehåller nästan ingen funktionalitet.

### Kritiska säkerhetshål (verifierade live)
- **Autentiserings-bypass:** JWT-hemligheten faller alltid tillbaka på den publika strängen `'your-secret'` (env laddas efter importerna). Vem som helst kan signera en egen admin-token.
- **Ingen tenant-isolering:** i mitt live-test kunde användare B läsa användare A:s faktura, kundlista och omsättning — bara genom att ange A:s bolags-ID. HTTP 200 på allt.
- **SQL-injektion** via kolumnnamn i `PUT`-uppdateringar (kund/leverantör/artikel interpolerar `req.body`-nycklar rakt in i SQL).
- **Path traversal** vid kvittouppladdning (filändelse och bolags-ID joinas ovaliderat in i sökvägen på disk).

### Funktionella fel
- **Alla OCR-nummer är ogiltiga** — Luhn-checksiffran beräknas med fel paritet (empiriskt verifierat). Bankgirot avvisar dem.
- **Kund-/leverantörslistan visar bara *inaktiva* poster** som standard (`is_active === 'true'` blir `false` när parametern utelämnas).
- **"Transaktioner" är inte atomära** — `BEGIN/COMMIT` körs mot poolen, inte en utcheckad klient, så satserna kan hamna på olika anslutningar.
- **Bokföringens balanskontroll är en no-op** — den summerar NUMERIC som strängar → `NaN`, och `NaN > 0.01` är `false`, så obalanserade verifikat släpps igenom.
- **Ingen dubbelbokningsspärr** — samma faktura/kvitto kan bokas obegränsat → dubblerade intäkter.
- **`bank_account` finns inte i schemat** → Bankgiro/betalinfo blir alltid tomt på faktura-PDF och i mejl.
- **Uppladdade filer kan aldrig hämtas** (ingen fil-endpoint), **AI-OCR får aldrig en giltig nyckel** och använder en pensionerad modellversion, **e-postutskick ger alltid 500** (SMTP-creds läses före env laddats).

### Migrationer
- **Går inte att köra på en färsk databas** — `006_articles.sql` kräver `pg_trgm` som aldrig skapas.
- **Dubblettfiler:** två `002_*`-filer och `004_customers.sql` som dubblerar `002_customers.sql` med olika kolumntyper → odefinierad körordning och schema-drift.
- **Ingen migrationsrunner, ingen versionstabell.** Migrationerna körs manuellt.
- **Saknar redovisningsfundamenten:** verifikationsnummerserier och oföränderlighet/periodlås för bokförda poster.

---

## 3. Vad som behålls, skördas respektive kastas

| Behåll (kravkälla) | Skörda (kod att återanvända) | Kasta |
|---|---|---|
| Domänkraven i `Claude.md` (fakturor, kvitton, bokföring, moms, rapporter, CRM) | `pdfService` (fungerar — genererar riktig A4-PDF) | All controller-/route-kod skriven utan säkerhetsmodell |
| Svenska/regulatoriska kraven (BAS, moms 0/6/12/25, OCR/Luhn, Bankgiro, org.nr, räkenskapsår) | BAS-kontoplanens seed + kategori→konto-mappning | Migrationerna (bygg en ren, körbar kedja med runner) |
| Ditt nya primärkrav: AI-först + läsbar vy | Kolumndefinitionerna (mestadels korrekta) som schema-referens | Frontend (~10 %, 0 % användbar — börja om) |
| Lärdomarna om vad som gick fel (denna fil) | E-postmallens HTML, svensk sv-SE-formatering | De missvisande `*_COMPLETE.md`-rapporterna (arkivera) |

**Ompröva, ärv inte:** arkitekturen. `Claude.md` föreskriver React + Express + PostgreSQL + MongoDB + Redis och 45+ moduler — byggt för en Fortnox-klon med stort webb-UI. MongoDB och Redis används inte ens i koden. Med AI-först behövs inte den stora handbyggda SPA:n.

---

## 4. Rekommenderad arkitektur för AI-först

Kärnidén som gör **båda** dina gränssnittsönskemål möjliga samtidigt:

> Bygg systemet som en **huvudlös kärna** (korrekt bokföringsmotor + databas + dokumentarkiv) som exponeras genom ett **väldefinierat verktygs-/action-lager (MCP-server)**, med en **tunn, i huvudsak läsbar webbvy** för dig som människa.

Då blir "vem som styr" utbytbart — samma kärna, olika förare:

### Alternativ A — Cowork / claude.ai som gränssnitt
- Du pratar med systemet direkt i Cowork/claude.ai. Kärnan exponeras som en **MCP-server** (eller connector) med tydliga actions: *skapa faktura*, *boka kvitto*, *kör momsrapport*, *visa saldo för konto X*, *ladda upp kvitto och föreslå kontering* osv.
- **Fördelar:** lägst uppsättning — du använder redan kanalen. Interaktivt och konversationellt. Ingen egen VM att drifta.
- **Nackdelar:** kräver att du initierar (ingen autonom drift); körs i sessioner snarare än dygnet runt; begränsat av vad Cowork/connector-lagret tillåter.
- **Bäst för:** den löpande, handpåläggande bokföringen — "här är månadens kvitton, bokför dem", "hur ser momsen ut inför deklarationen?".

### Alternativ B — Extern Hermes-harness på egen VM
- En agent-harness (Hermes) på en VM som du styr, med åtkomst till dina system (bank, mejl, Drive) och som pratar mot **samma** MCP-/API-lager som i A.
- **Fördelar:** kan köra autonomt och schemalagt (importera banktransaktioner nattetid, matcha mot fakturor, påminna om förfallna); kan koppla ihop flera av dina system; alltid igång.
- **Nackdelar:** du måste drifta och säkra en VM; större attackyta; kräver mer disciplin kring behörigheter och loggning eftersom den agerar självständigt.
- **Bäst för:** automation och integrationer — det som ska hända utan att du sitter och ber om det.

### Rekommendation
**Bygg det gemensamma fundamentet först — den huvudlösa kärnan + MCP-/action-lagret — så är du inte inlåst.** Börja använda **Alternativ A (Cowork)** direkt eftersom det har lägst tröskel och du redan är där. Lägg till **Alternativ B (Hermes på VM)** senare för automation, riktad mot samma API. De är inte ett vägval — B är A plus en autonom förare på samma kärna.

Oavsett förare gäller: **din läsbara vy (avsnitt 5, Fas 4) är fristående och kräver aldrig AI.** Det är där du "går in och ser allt som rör bolagets ekonomi" och kan lita på det till 100 %.

### Säkerhet när en AI styr ekonomin (icke förhandlingsbart)
När Cowork/Hermes kan skapa, ändra och boka måste kärnan behandla indata som *icke betrott* och tvinga fram reglerna på servern:
- **Serverpåtvingad behörighet:** `company_id` härleds från användarens medlemskap — tas **aldrig** från anropet. Postgres RLS som andra försvarslinje.
- **Oföränderlig, append-only revisionslogg** över allt AI:n gör — så historiken går att lita på.
- **Mänskligt godkännande** krävs för det som flyttar pengar eller låser en period.
- **Skydd mot prompt injection:** innehåll i ett kvitto eller mejl som AI:n läser är *data*, aldrig instruktioner eller behörighet. Ett kvitto får inte kunna "be" systemet boka om sig självt eller höja en behörighet.
- **Scoped åtkomst per action:** varje verktyg har minsta möjliga behörighet; känsliga operationer loggas extra.

---

## 5. Omstartsplan — listan över vad jag skulle göra

Sekvensen är avsiktlig: förtroendegränsen och den korrekta bokföringskärnan **först**, affärsobjekt och gränssnitt sedan. Bygg inte modul två förrän modul ett är rätt.

### Fas 0 — Fundament & förtroendegräns *(måste vara på plats innan något annat)*
1. Ren monorepo med **en migrationsrunner + versionstabell**; extensions (`uuid-ossp`, `pg_trgm`) skapas i första migrationen; **en** uppsättning migrationer utan dubbelnumrering.
2. Env laddas **innan** någon modul importeras; **fail-fast** om `JWT_SECRET`/nycklar saknas (aldrig en publik fallback).
3. **Tenant-isolering som arkitektur:** en `requireCompanyAccess`-middleware; `company_id` härleds från medlemskap. **RLS i Postgres** som andra lager.
4. **Immutabel, append-only revisionslogg** från dag ett (i Postgres — droppa MongoDB).
5. **Allowlist-baserade uppdateringar** (ingen kolumninterpolation), **zod-validering** på varje endpoint, **säkra filuppladdningar** (UUID-namn, validerad ändelse, lagring utanför webroot med auth-skyddad hämtning).
6. En `withTransaction(client)`-helper som checkar ut en klient — riktig atomicitet.

### Fas 1 — Korrekt bokföringskärna *(systemets hjärta)*
7. **Fullständig BAS-kontoplan** (inte 19 konton), med möjlighet till företagsspecifika konton.
8. **Verifikationer:** verifikationsserier per bolag/räkenskapsår, löpnummer via **DB-sekvens**, tvingad debet = kredit **i heltal/ören** (inte float-strängar), **oföränderlighet + rättelseverifikat + periodlås**.
9. **Korrekt moms:** 0/6/12/25 % per rad, rätt konton (2610/2611/2612 utgående, 1630 ingående), momsrapport (utgående − ingående).
10. **Automatkontering** (faktura, betalning, kvitto) med korrekt momssats-mappning, **dubbelbokningsspärr** och statuskontroll.
11. **SIE-export (SIE4)** — kritiskt för svensk redovisning, revisor och systembyte. *Saknades helt i den ursprungliga planen.*
12. **Korrekt Luhn/OCR** och fakturanummer via DB-sekvens — med enhetstester som verifierar checksiffran.

### Fas 2 — Affärsobjekt *(skörda från gamla koden, bakom förtroendegränsen)*
13. Kunder, leverantörer, artiklar, fakturor, kvitton — portas bakom `requireCompanyAccess`. **PDF-tjänsten återanvänds** (fungerar), nu med `bank_account`/Bankgiro i schemat.
14. **Dokumentarkiv** med auth-skyddad hämtnings-endpoint (S3 eller lokal disk) — kvitton och faktura-PDF:er ska gå att öppna.

### Fas 3 — AI-först-gränssnittet *(det nya)*
15. **MCP-/verktygslager:** väldefinierade actions som Cowork/claude.ai och en framtida Hermes-harness anropar mot **samma** kärna, med serverpåtvingade regler + audit + mänskligt godkännande på pengaflyttande/periodlåsande operationer.
16. **Prompt-injection-skydd** enligt avsnitt 4.
17. **AI-OCR:** giltig nyckel, aktuell modellversion, PDF-stöd, och alltid mänsklig granskning innan bokföring.

### Fas 4 — Din läsbara vy *(förtroende, ingen AI krävs)*
18. En enkel, **i huvudsak read-only** webbvy: dashboard, verifikationslista/huvudbok, rapporter (resultat, balans, moms), kund-/leverantörsregister, dokumentarkiv och **hela revisionsloggen**. Read-only = mycket mindre att bygga och nästan inget att gå sönder. Det är här du ser och litar på allt historiskt.

### Löpande — förtroende & test
19. **Riktiga enhetstester** på kärnlogiken (moms, Luhn, balans, tenant-isolering) som faktiskt körs i **CI** (Jest korrekt konfigurerat för ESM).
20. **Arkivera de missvisande `*_COMPLETE.md`-rapporterna** så de inte vilseleder om status.

### Scope-reduktion (viktigt)
Skjut på det tunga i `Claude.md` Fas 3–4 — Skatteverket-integration, bank/Open Banking, projekt/tid, mobilapp, multi-bolag, fristående chatbot — tills kärnan är korrekt och betrodd. Med AI-först behöver du inte bygga den stora handgjorda SPA:n, vilket sparar merparten av arbetet. Ett litet system som stämmer slår ett stort som nästan fungerar.

---

## 6. Kravluckor att ta ställning till (fanns inte i `Claude.md`)

Dessa nämns aldrig i den ursprungliga planen men hör hemma i ett svenskt redovisningssystem — besluta medvetet om de ska in nu, senare eller inte alls:

- **SIE-export/import** (systembyte, revisor) — rekommenderas redan i Fas 1.
- **Bokföringslagens krav** på verifikationsordning och oföränderlighet — täcks av Fas 1 ovan.
- **GDPR** (personuppgifter om kunder/kontaktpersoner, rätt till radering vs bokföringslagens bevarandekrav).
- **Peppol / e-faktura**, **omvänd skattskyldighet (bygg)**, **ROT/RUT**, **F-skatt** på fakturor.
- **BankID** för inloggning, **Swish** som betalsätt.
- **Årsredovisning (K2/K3)** — troligen utanför scope, men bör beslutas.
