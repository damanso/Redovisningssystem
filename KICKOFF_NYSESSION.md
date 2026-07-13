# Kickoff-brief — bygg om Redovisningssystem (för ny session)

> **Så här använder du filen:** öppna en ny Claude Code-session i det här repot och klistra in avsnittet **"1. Klistra in detta"** som ditt första meddelande. Resten av filen är reglerna som den sessionen ska följa — den läser dem själv ur repot.

---

## 1. Klistra in detta i den nya sessionen

```
Läs GRANSKNING_OCH_OMSTARTSPLAN.md och KICKOFF_NYSESSION.md i det här repot. De är din
källa till sanning: den första är analysen och omstartsplanen, den andra är reglerna
för hur bygget ska gå till.

Bygg om systemet enligt planen — men FAS FÖR FAS med verifieringsgrindar, inte allt i
ett svep. Efter varje fas ska du köra /verify, /code-review och /security-review och
klistra in den faktiska utdatan. Gå inte vidare till nästa fas förrän grinden är grön
MED bevis, och stanna för mitt godkännande vid de kontrollpunkter som är markerade i
KICKOFF_NYSESSION.md (Fas 0 och Fas 1).

Du får ALDRIG skriva att något är klart, testat eller "produktionsklart" utan att först
ha kört testerna/kontrollerna och visat den riktiga utdatan i chatten. Detta projekt
blev en gång trasigt av just den anledningen — läs avsnitt 2 innan du börjar.

Starta med Fas 0. Använd gärna /loop för att driva arbetet framåt, men respektera
grindarna och kontrollpunkterna.
```

---

## 2. Varför de här reglerna finns (läs först)

Den förra versionen av det här projektet byggdes autonomt och rapporterade *"100 % pass, 12/12 moduler, produktionsklart"* — samtidigt som:

- tenant-isoleringen var helt bruten (vilken användare som helst kunde läsa ett annat bolags bokföring),
- alla OCR-nummer var ogiltiga (fel Luhn-beräkning),
- `npm run build` misslyckades med 12 fel,
- **inte en enda testsvit ens kunde köra.**

Rapporterna var alltså fiktion. Hela poängen med den här briefen är att göra det omöjligt att upprepa: **inget påstående om status utan körd, inklistrad bevisning.**

---

## 3. Regler för bygget (icke förhandlingsbara)

1. **Fas för fas.** Bygg inte modul två förrän modul ett passerat sin grind. Ordningen i planen (Fas 0 → 4) är avsiktlig.
2. **Verifieringsgrind efter varje fas:** kör `/verify`, `/code-review` och `/security-review`, och klistra in den **faktiska** utdatan i chatten. Ingen sammanfattning ersätter utdatan.
3. **Definition av "klart" (per fas):** koden bygger (`npm run build` utan fel), testerna **kör och passerar på riktigt** (visa kommandot och utdatan), och fasens acceptanskriterier (avsnitt 4) är uppfyllda och demonstrerade.
4. **Inga falska statusrapporter.** Skriv aldrig "klart/testat/fungerar/produktionsklart" utan att först ha kört det och visat resultatet. Skapa inga `*_COMPLETE.md`-filer som påstår framgång utan bevis.
5. **Kontrollpunkter för mänskligt godkännande:** stanna och vänta på mitt "kör vidare" efter **Fas 0** (förtroendegränsen) och **Fas 1** (bokföringskärnan). Fortsätt inte förbi dem på egen hand.
6. **Säkerhet är en grind, inte en efterhandsfix.** Tenant-isolering, env/JWT-hantering och immutabel revisionslogg ska finnas *innan* affärsobjekt byggs — inte bättras på efteråt.
7. **Commit ofta, små steg.** En logisk enhet per commit, tydliga meddelanden. Pusha till arbetsbranchen.
8. **Fråga vid vägval.** Om ett arkitektur- eller regelbeslut är oklart (t.ex. momskonton, periodlås, SIE-format), fråga i stället för att gissa.

---

## 4. Acceptanskriterier per fas (så här bevisas "klart")

### Fas 0 — Fundament & förtroendegräns  ⛔ KONTROLLPUNKT (vänta på godkännande)
- [ ] En migrationsrunner med versionstabell kör hela kedjan på en **tom** databas utan fel; extensions (`uuid-ossp`, `pg_trgm`) skapas i första migrationen. **Bevis:** kör runnern mot en färsk databas, visa utdatan.
- [ ] Env laddas före alla imports; appen **vägrar starta** (fail-fast) om `JWT_SECRET` saknas. **Bevis:** starta utan `JWT_SECRET` → tydligt fel; starta med → ok.
- [ ] **Tenant-isolering bevisad:** ett automatiskt test där användare B försöker läsa användare A:s data via A:s `company_id` returnerar **403/404, aldrig 200**. **Bevis:** visa testet och att det passerar. (Detta är exakt det som var trasigt förut.)
- [ ] Uppdateringar använder allowlist (ingen kolumninterpolation); ett test bevisar att en skadlig body-nyckel inte kan injicera SQL.
- [ ] Immutabel, append-only revisionslogg finns och skrivs vid en skrivoperation. **Bevis:** utför en åtgärd, visa loggraden; visa att ett `UPDATE`/`DELETE` på loggen avvisas.
- [ ] Filuppladdning validerar ändelse och lagrar med UUID-namn utanför webroot; ett test bevisar att `../`-namn inte kan skriva utanför uppladdningskatalogen.

### Fas 1 — Korrekt bokföringskärna  ⛔ KONTROLLPUNKT (vänta på godkännande)
- [ ] Verifikationer: serier per bolag/räkenskapsår, löpnummer via DB-sekvens, **debet = kredit i heltal/ören** framtvingat. **Bevis:** test som visar att ett obalanserat verifikat avvisas.
- [ ] Oföränderlighet: ett bokfört verifikat kan inte ändras/raderas; rättelse sker via nytt verifikat; periodlås fungerar. **Bevis:** test.
- [ ] Moms 0/6/12/25 % per rad bokas på rätt konton; momsrapport (utgående − ingående) stämmer på ett känt exempel. **Bevis:** test med förväntade siffror.
- [ ] Automatkontering (faktura/betalning/kvitto) har **dubbelbokningsspärr** och statuskontroll. **Bevis:** test som visar att samma faktura inte kan bokas två gånger.
- [ ] **Luhn/OCR verifierat:** ett test genererar OCR och validerar checksiffran med en oberoende Luhn-kontroll. (Den gamla koden gav ogiltiga nummer — bevisa att din är giltig.)
- [ ] **SIE4-export** producerar en fil som validerar mot formatet på ett känt exempel.

### Fas 2 — Affärsobjekt
- [ ] Kunder/leverantörer/artiklar/fakturor/kvitton fungerar hela vägen **bakom** förtroendegränsen (varje endpoint går genom `requireCompanyAccess`).
- [ ] Standardlistning visar **aktiva** poster (regressionstest mot den gamla `is_active`-buggen).
- [ ] PDF-tjänsten återanvänds och Bankgiro/`bank_account` finns i schemat och syns på PDF:en. **Bevis:** generera en PDF, visa att betalinfon finns.
- [ ] Uppladdade filer kan hämtas via en auth-skyddad endpoint. **Bevis:** ladda upp → hämta.

### Fas 3 — AI-först-gränssnittet
- [ ] MCP-/action-lager exponerar tydliga actions mot samma kärna, med serverpåtvingade regler + audit + mänskligt godkännande på pengaflyttande/periodlåsande operationer.
- [ ] Prompt-injection-skydd: ett test visar att instruktionstext inbäddad i ett kvitto/mejl **inte** kan ändra behörighet eller utlösa en oavsiktlig bokning.
- [ ] AI-OCR använder giltig nyckel och aktuell modellversion, stöder PDF, och kräver mänsklig granskning innan bokföring.

### Fas 4 — Läsbar vy
- [ ] I huvudsak read-only webbvy: dashboard, huvudbok/verifikationslista, rapporter (resultat, balans, moms), register, dokumentarkiv, hela revisionsloggen. Inloggning fungerar och bolagskontext härleds korrekt (regressionstest mot den gamla `currentCompanyId`-buggen).

### Löpande
- [ ] Enhetstester på kärnlogiken (moms, Luhn, balans, tenant-isolering) körs i CI. **Bevis:** CI-körning grön med testantal > 0.
- [ ] De gamla `*_COMPLETE.md`- och `E2E_TEST_REPORT.md`-filerna arkiveras/tas bort så de inte vilseleder.

---

## 5. Arkitekturriktning (från planen — sammanfattning)

Bygg en **huvudlös kärna** (korrekt bokföringsmotor + Postgres + dokumentarkiv) som exponeras genom ett **MCP-/action-lager**, plus en **tunn, i huvudsak read-only webbvy** för människan. Då kan både **Cowork/claude.ai** (interaktivt, börja här) och en framtida **Hermes-harness på VM** (autonomt, senare) styra samma kärna. Släpp MongoDB och Redis (oanvända). Full detalj och motivering finns i `GRANSKNING_OCH_OMSTARTSPLAN.md`, avsnitt 4–5.

**Scope-reduktion:** skjut på Skatteverket-integration, bank/Open Banking, projekt/tid, mobilapp, multi-bolag och fristående chatbot tills kärnan är korrekt och betrodd. Ett litet system som stämmer slår ett stort som nästan fungerar.
