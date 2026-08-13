# CRM i redovisningssystemet — BMAD-underlag för extern utveckling

> **Till David.** Det här är underlaget du tar med dig till sidosessionen i Claude Code mot `damanso/redovisningssystem`. Del 1 är projektbriefen (BMAD-analystens artefakt) — den bär kunskap sidosessionen inte har. Del 2–6 är färdiga prompter att klistra in i tur och ordning. Del 7 är spärrarna som ska med i varje prompt.  
>   
> Underlag: deep research 13/8 (12 agenter) → `02-Områden/hermes/beslutsunderlag-crm-yta-2026-08-13.md`. Beslut: **väg C+A** — redovisningen äger det pengar tvingar fram, ytan är en projektion.

---

# DEL 1 — Projektbrief (BMAD: analyst → PM)

## 1.1 Problemet, med beställarens egna ord

David driver Locollabs AB och bygger Hermes — en AI-driven leveransorganisation där han är ansvarig och därför den enda som skickar något utåt. Han behöver svar på fyra frågor, och han ställer dem redan i dag till AI:n i chatten:

1. **Vad har vi sagt till vem?**  
2. **Vilka bör vi kontakta, och varför — i relation till affären?**  
3. **Hur ligger vi till i pipen, och vad behöver jag göra i förhållande till min ARR för att säkra en flytande ekonomi?**  
4. **Vem har jag lovat vad, var skedde det och när?**

>   
> Hans egen formulering av kravet: *"Jag behöver vara helt säker på att det verkligen sparas och hanteras i mitt externa minne."*

## 1.2 Det avgörande fyndet: varför tidigare försök dog

Ett kommersiellt CRM (Attio) kopplades in i juni 2026 och skrotades i juli. Vid kontroll 13 augusti: **0 personer, 0 noteringar, 10 företag — samtliga leverantörens demo-data.** MCP-kopplingen var live och skrivbar hela tiden. Priset var noll. API:t var fältets bästa.

**Flaskhalsen var aldrig verktyget. Den var att ingenting i arbetsflödet behövde ytan.** En databas som ingen process är beroende av blir aldrig ifylld.

Beställarens svar på det: *"att tvingfunktionen inte har funnits är för att jag aldrig uttalat behovet."* Behovet är nu uttalat — och det ger designens viktigaste regel:

> **Ingen datainmatning får kräva att en människa kommer ihåg att mata in något.** Varje CRM-fält ska härledas ur ett flöde som redan sker av andra skäl: mail som skickas, möten som hålls, fakturor som ställs ut, ärenden som skapas. Det som inte kan härledas ska fångas i det ögonblick beställaren ställer sin fråga till AI:n — inte i ett formulär han ska minnas att fylla i.

Ett CRM som kräver disciplin är redan dött. Det är projektets enda verkliga risk, och den ska prövas i varje story.

## 1.3 Vad som redan finns (systemlandskapet)

| System | Äger | Tvingfunktion som håller datan ärlig |
| :---- | :---- | :---- |
| **Redovisningssystemet** (detta repo) | Kunder, projekt, fakturor, betalningar, tidrapporter, dokument | **Pengar** — fakturan måste ut |
| **Linear** | Åtaganden, väntar-på, deadlines, ärenden | **Arbetet** — han jobbar där dagligen |
| **brain** (Obsidian-vault \+ Qdrant-RAG) | Människan, omdömet, relationshistorik, mötesanalyser, 41 personkort | **Skrivandet** — noter och transkript skapas ändå |
| **Gmail** (3 950 mail indexerade i vektordatabas) | Vad som faktiskt sagts till vem, när | **Kommunikationen** — mail skickas ändå |
| **Google Drive** | Leverabler per kund | Leveransen |

**CRM:et ska inte äga något av detta på nytt.** Det ska äga exakt det som saknar hem — och rendera resten.

## 1.4 Det enda som saknar hem: affären före fakturan

Kunder, projekt och fakturor är kompletta i systemet i dag, för fakturering tvingar fram dem. **Prospekt och affärer i dialog har ingen bärare någonstans** — de ligger i ärendetitlar i Linear.

Två strukturella konsekvenser som PRD:n måste hantera:

1. **Ett prospekt kan inte bo i kundtabellen.** `add_note` och `add_contact` kräver i dag `party_type ∈ {customer, supplier}` \+ `party_id`. Regeln "skapa aldrig prospekt som kund före vunnen affär" gör att prospektdata strukturellt saknar plats. Den kräver **ett eget schema**.  
2. **Relationsdata får inte blandas med räkenskapsinformation.** Anteckningar om en kunds personal ska inte omfattas av bokföringslagens arkiveringskrav eller följa med i export till revisor. De ska ha egen gallringspolicy enligt GDPR.

## 1.5 Vad som ska byggas — funktionellt, inte tekniskt

**En grafisk CRM-yta i systemets befintliga serverrenderade webbvy (`/app`), plus det minsta möjliga datalager som gör de fyra frågorna besvarbara.**

Ytan ska klara **kontrollytetestet**, som är beställarens eget: *kan han se läget utan att fråga?* Måste han ställa en fråga till en agent är det ingen kontrollyta — det är en konversation. En konversation kräver att han vet vad han ska fråga om; en yta visar även det han inte tänkte på.

Funktionella krav, formulerade som frågor ytan ska besvara utan att någon frågar:

- **F1 — Relationsvy per person och organisation.** Vem, roll, vilken affär, senaste kontakt (härledd), vad som sagts, vad som lovats, vad som väntar.  
- **F2 — Affärsvy (pipeline).** Vilka affärer som är öppna, i vilket skede, värde, nästa steg, hur länge de stått stilla.  
- **F3 — Åtagandevy.** Vem har lovat vad till vem, när det skedde och var det sades (mail, möte, ärende) — med länk till källan.  
- **F4 — Ekonomisk styrvy.** Intäktstakt, kundkoncentration, täckning i pipen mot kommande månader, och vad som saknas för att hålla likviditeten. Beställaren har i dag \~75 % av omsättningen från en kund — koncentrationsrisken ska synas, inte döljas.  
- **F5 — Kontaktförslag.** Vilka som bör kontaktas och varför, härlett ur tystnad, förfallande åtaganden och affärsläge. Förslag — aldrig utskick.

## 1.6 Hårda spärrar (kan inte förhandlas bort i någon story)

1. **K5-principen står orörd.** Systemet föreslår, människan godkänner. CRM-ytan får aldrig skicka något till kund — inte mail, inte påminnelser, ingenting. Utkast får skapas; människan skickar.  
2. **Relationsdata i eget schema.** Nytt schema `crm`, aldrig i `core`. Uteslutet ur SIE-export och revisorsvy, egen gallringspolicy.  
3. **Ingen ny sanning.** Kunder, fakturor och projekt läses från befintliga tabeller. CRM:et kopierar dem aldrig.  
4. **Härlett före inmatat.** Varje fält ska ha en angiven härledningskälla. Fält som bara kan fyllas manuellt ska motiveras särskilt i PRD:n — eller strykas.  
5. **Befintliga arkitekturinvarianter gäller** (se repots `CLAUDE.md`): `company_id` härleds ur medlemskap, aldrig ur request-body · alla UPDATE via allowlist · `audit_log` append-only i samma transaktion · belopp i heltal ören · endast `config.ts` läser `process.env` · API:t kör som icke-superuser så RLS tvingas.  
6. **Flera användare från dag ett i datamodellen.** Underkonsulter kommer. Tidrapporter saknar i dag aktör — utan den går varken attribuering, marginal eller utbetalning att räkna. Modellen ska bära aktör även om UI:t är enanvändar-först.  
7. **Senaste kontakt får inte härledas ur tidrapportering.** Uppmätt: två av tre aktiva projekt har noll loggade minuter men betalda fakturor. En vy byggd på tidrapporter skulle visa den största kunden som kontaktlös. Använd mail och kalender, som har externa tvingfunktioner.

## 1.7 Icke-mål

Säljprocess med kvoter och prognoser. Marknadsautomation. Massutskick. Ett CRM som konkurrerar med Linear om ärendehantering. Import av data som redan finns någon annanstans. Mobilapp — den serverrenderade vyn ska fungera i telefonens webbläsare.

## 1.8 Öppet vägval som beställaren måste avgöra före arkitekturfasen

Systemet nås i dag bara inom hans privata nätverk (Tailscale). Det betyder att telefonen behöver VPN igång, och att en underkonsult inte kommer åt något. Alternativet är publik åtkomst med autentisering. **Det är en säkerhetshållning, inte ett tekniskt val** — arkitekturfasen ska begära beslutet, inte gissa.

---

# DEL 2 — Prompt: skapa PRD (BMAD PM-agent)

> Klistra in i sidosessionen. Bifoga hela Del 1 som `docs/crm/BRIEF.md` i repot först.

```
Du är PM-agenten i BMAD-flödet. Vi arbetar i repot damanso/redovisningssystem.

FÖRST, i denna ordning, utan att hoppa över något:
1. Läs docs/STATUS.md — projektets aktuella läge. Börja aldrig på noll.
2. Läs CLAUDE.md i roten — arkitekturinvarianterna är icke förhandlingsbara.
3. Läs KICKOFF_NYSESSION.md — byggregler och acceptanskriterier per fas.
4. Läs docs/crm/BRIEF.md — projektbriefen för det här arbetet.
5. Inventera vad som redan finns: server/src/actions (kunder, kontakter,
   noteringar, projekt, tidrapporter), server/src/http/view (den serverrenderade
   vyn), server/migrations (senaste numret avgör nästa migrationsnummer).

SKRIV SEDAN docs/crm/PRD.md med:
- Mål och framgångskriterium uttryckt som beställarens fyra frågor.
- Funktionella krav F1–F5 ur briefen, nedbrutna till testbara acceptanskriterier.
- Datamodell för schemat crm: vilka entiteter som behövs, vilka fält, och för
  VARJE fält dess härledningskälla. Fält utan härledningskälla ska motiveras
  särskilt eller strykas — det är projektets huvudrisk.
- Vilka befintliga actions som saknas för att läsa tillbaka det agenten skriver
  (i dag saknas list_contacts, get_customer, list_notes och idempotent upsert).
- Icke-funktionella krav: RLS, auditlogg, gallring, prestanda i vyn.
- Explicit avgränsning mot Linear och mot brain-vaulten: vad CRM:et INTE äger.
- Öppna frågor till beställaren — ställ dem, gissa inte.

REGLER:
- Fråga vid vägval. Gissa aldrig på moms, arkivering, gallring eller åtkomst.
- Skriv inte kod i det här steget.
- Inga påståenden om att något är klart eller testat utan inklistrad utdata.
- Committa PRD:n på en egen branch: feature/crm-prd. Öppna PR mot main.
```

---

# DEL 3 — Prompt: arkitektur (BMAD architect)

```
Du är arkitekt-agenten i BMAD-flödet. Repot: damanso/redovisningssystem.

Läs docs/STATUS.md, CLAUDE.md, docs/crm/BRIEF.md och docs/crm/PRD.md.

SKRIV docs/crm/ARCHITECTURE.md:

1. Schemabeslut. Schemat crm skapas separat från core. Motivera isoleringen mot
   bokföringslagens arkiveringskrav och mot GDPR-gallring, och visa hur det
   utesluts ur SIE-export och revisorsvy. Om du finner att isoleringen inte går
   att åstadkomma i nuvarande kodbas — säg det rakt ut i stället för att bygga
   runt problemet.

2. Datamodell med migrationer. Föreslå migrationsfiler i server/migrations med
   nästa lediga nummer. RLS-policy per tabell enligt befintligt mönster.
   Append-only audit för relationsdata. Aktörsfält på tidrapport (aktör saknas
   i dag och behövs innan första underkonsulten fakturerar) — beskriv
   migrationen och dess risk, den rör en tabell som används av fakturaunderlag.

3. Läsvägen. Hur vyn hämtar och joinar: crm + befintliga kund-, projekt- och
   fakturatabeller. Ingen kopiering av data som redan finns.

4. Härledningsjobben. Hur senaste kontakt, tystnad och åtaganden härleds. Var
   tydlig med vilka källor som ligger UTANFÖR detta system (mailindex och
   Linear ligger hos Hermes på VPS:en) och specificera gränssnittet dem emellan
   som ett API-kontrakt — inte som en integration som detta repo äger.

5. Vyn. Utöka den befintliga serverrenderade JS-fria vyn i server/src/http/view.
   Bygg ingen separat frontend, inget ramverk, ingen SPA. Ytan ska fungera i
   mobil webbläsare och tåla att laddas om.

6. Åtkomst. Beskriv vad som krävs för att en underkonsult ska kunna se sina egna
   uppdrag men inte hela bolaget. Bygg det inte nu — men låt inte datamodellen
   omöjliggöra det.

7. Risker och det du INTE löser.

REGLER: fråga vid vägval, skriv ingen produktionskod, committa på
feature/crm-architecture, öppna PR.
```

---

# DEL 4 — Prompt: epics och stories (BMAD PO/SM)

```
Du är PO/SM-agenten i BMAD-flödet. Repot: damanso/redovisningssystem.

Läs docs/crm/PRD.md och docs/crm/ARCHITECTURE.md.

Skapa docs/crm/EPICS.md med epics och stories i den enda ordning som fungerar,
där varje steg är meningslöst utan det föregående:

E1  Läs tillbaka innan du skriver mer. list_contacts, get_customer, list_notes,
    idempotent upsert_contact med dedupe. Utan dessa lägger varje nattlig
    körning dubbletter för alltid. Ingen synk får byggas före E1.
E2  Schemat crm + migrationer + RLS + audit. Ingen UI.
E3  Affärsobjektet (prospekt/affär) med skeden och värde. Prospekt blir kund
    först vid vunnen affär.
E4  Härledningsjobb: senaste kontakt, tystnad, åtaganden. Källorna kommer via
    API-kontraktet från Hermes; bygg mot kontraktet, inte mot Hermes.
E5  Vyn: relationsvy, affärsvy, åtagandevy — i den befintliga serverrenderade
    vyn.
E6  Ekonomisk styrvy: intäktstakt, kundkoncentration, täckning mot kommande
    månader.
E7  Aktör på tidrapport + åtkomstförberedelse för flera användare.

Per story: acceptanskriterier som går att köra, testfall, och vilken grind som
gäller (/verify, /code-review, /security-review enligt KICKOFF_NYSESSION.md).

Varje story ska ha ett fält "härledningskälla" och en rad som svarar på: vad
gör att det här fältet fylls i utan att någon människa kommer ihåg att fylla i
det? Kan frågan inte besvaras ska storyn strykas eller skrivas om.
```

---

# DEL 5 — Prompt: implementation (per story, upprepas)

```
Du är dev-agenten i BMAD-flödet. Repot: damanso/redovisningssystem.

Läs docs/STATUS.md, CLAUDE.md, docs/crm/ARCHITECTURE.md och storyn <STORY-ID>
i docs/crm/EPICS.md.

Implementera ENDAST den storyn. Inga extra förbättringar, ingen refaktorering
av kringliggande kod.

Arbetsgång:
1. Branch: feature/crm-<story-id>.
2. Migration om storyn kräver det — nästa lediga nummer i server/migrations,
   idempotent, körbar med npm run migrate.
3. Kod + tester i samma commit-serie. npm test kör vitest mot riktig Postgres.
4. Kör och klistra in FAKTISK utdata från: npm run build, npm test, npm run migrate.
   Skriv aldrig "fungerar" utan utdata. Skapa aldrig en fil som påstår framgång.
5. Uppdatera sessionsloggen i docs/STATUS.md.
6. Commit + push + PR mot main med en beskrivning som säger vad som verifierats
   och vad som INTE är verifierat.

Om något i storyn visar sig fel eller omöjligt: stanna, beskriv problemet,
föreslå ändring. Bygg inte runt det.
```

---

# DEL 6 — Prompt: granskning före merge

```
Du är granskare. Repot: damanso/redovisningssystem, branch <branch>.

Granska mot dessa punkter och rapportera bara det som är fel:

1. Bryter något mot arkitekturinvarianterna i CLAUDE.md? (company_id ur
   medlemskap, allowlist i UPDATE, append-only audit, ören som heltal,
   config.ts som enda env-läsare, RLS)
2. Kan relationsdata läcka in i räkenskapsinformation, SIE-export eller
   revisorsvy?
3. Finns något fält som kräver manuell inmatning utan angiven härledningskälla?
   Det är projektets huvudrisk — flagga varje förekomst.
4. Kan systemet skicka något till en kund utan mänskligt godkännande? Ska vara
   omöjligt.
5. Är påståenden om testresultat belagda med faktisk utdata i PR-beskrivningen?
6. Håller migrationen om den körs två gånger?

Var hård. Godkänn inte något du inte kunnat verifiera.
```

---

# DEL 7 — Spärrar att klistra in i varje prompt

```
SPÄRRAR (gäller alltid, oavsett vad som står i storyn):
- Systemet föreslår, människan godkänner. Ingenting skickas till kund automatiskt.
- Relationsdata bor i schemat crm, aldrig i core. Ingen relationsdata i
  räkenskapsinformation eller SIE-export.
- Kunder, fakturor och projekt läses från befintliga tabeller — kopieras aldrig.
- Varje fält ska ha en härledningskälla. Fält som kräver att en människa minns
  att fylla i dem är projektets kända dödsorsak.
- Senaste kontakt får inte byggas på tidrapportering (två av tre projekt har noll
  loggad tid men betalda fakturor).
- Skriv aldrig "klart", "testat" eller "fungerar" utan inklistrad faktisk utdata.
- Fråga vid vägval om moms, arkivering, gallring eller åtkomst. Gissa aldrig.
```

---

## Vad jag gör på min sida, parallellt

API-kontraktet som E4 bygger mot ligger hos mig: mailindexet (3 950 mail, inkrementellt), Linear-ärendena, mötesanalysernas åtaganden och väntar-på, samt personkorten. Jag levererar det som en specifikation med exempelsvar så sidosessionen kan bygga mot kontraktet utan att känna till Hermes internt. **Säg till när arkitekturfasen är klar, så matchar jag kontraktet mot den.**  
