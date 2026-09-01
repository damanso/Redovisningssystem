# PRD — Tidsrapportering med avtalsstyrd struktur och daglig godkännandeloop

**Produkt:** Locollabs redovisningssystem, modul *Tid*
**Version:** 0.2 (uppdaterad efter Davids kommentarer)
**Datum:** 2026-09-01
**Ägare:** David Mancilla

---

## 1. Bakgrund

Tidsrapporteringen finns redan (`log_time`, projekt, timpris), men den är frånkopplad från både avtalet och faktureringen. Det har orsakat konkreta fel under juli–augusti 2026:

| # | Vad som hände | Konsekvens |
|---|---|---|
| 1 | Juli-fakturan skickades (43 202,50 kr, betald 1/9) men **ingen av de 20 registrerade tidsposterna markerades som fakturerade** | Posterna ligger kvar som `billable, invoiced=false` → risk för **dubbelfakturering** eller att de tappas |
| 2 | Två poster skulle inte faktureras (admin, supportmatris) | Det finns **ingen funktion för att omklassa eller exkludera** en registrerad post |
| 3 | Augustiarbetet var utfört men **aldrig registrerat** | Upptäcktes bara genom manuell granskning. Utan den hade intäkten uteblivit |
| 4 | Tiden rekonstruerades manuellt ur kalender, mail och sessionsloggar | Timmar av arbete per faktura — och resultatet blev ändå fel |
| 5 | Två parallella fakturanummerserier (systemets nr vs dokumentnr på PDF:en) | Nummer 27 användes av juli-fakturan; en ny faktura fick samma nummer och **skrev över originalfilen** |
| 6 | **Fas 2A passerade avtalets tak** (32 h / 35 200 kr) utan att någon varnade | Ackumulerat ~52 h ≈ 57 000 kr. Avtalet §4 kräver skriftligt besked om ändrad omfattning innan taket överskrids |

Två grundproblem:

**A. Registrerad tid och fakturerad tid är samma sak i systemet, men ska inte vara det.** Tid registreras löpande och ofullständigt; vad som faktiskt faktureras är ett aktivt beslut.

**B. Systemet känner inte till avtalet.** Faser, timpris och tak finns bara i en DOCX-fil och i huvudet på David. Därför kan varken kategorisering eller takvarning ske automatiskt.

---

## 2. Mål

1. **Nästan gratis att registrera tid** — manuellt på sekunder, ur kalendern, eller via AI.
2. **Flera personer ska kunna registrera tid samtidigt**, var och en på sina uppdrag.
3. **Projektets fakturerbara delar ska komma ur avtalet automatiskt** — och gå att ändra och utöka.
4. Systemet ska **föreslå** gårdagens tid, resonerat ur kalender och mail.
5. David ska **godkänna, justera eller förkasta** — inget går till faktura utan det.
6. En faktura ska byggas på **godkänd tid** utan manuell rekonstruktion.
7. Fakturerad tid ska **låsas**.
8. Systemet ska **varna innan ett fas-tak passeras**.

### Icke-mål
- Automatisk fakturering utan mänskligt godkännande.
- Ersätta kalendern eller mailen som primärkälla.
- Ett fullständigt avtalshanteringssystem (endast det som behövs för fakturering).

---

## 3. Kärnkoncept

### 3.1 Tidspostens livscykel

```
  FÖRSLAG  →  GODKÄND  →  FAKTURERAD  →  (LÅST)
     │           │
     │           └──→ JUSTERAD (godkänd med annan tid än registrerad)
     │
     └──→ IGNORERAD (räknas aldrig med, men sparas som spår)
```

| Status | Betydelse | Med på faktura? |
|---|---|---|
| `forslag` | Systemet har föreslagit posten ur kalender/mail | Nej |
| `godkand` | Godkänd, debiterbar tid fastställd | Ja |
| `justerad` | Godkänd med annan tid än registrerad | Ja, justerad tid |
| `ignorerad` | Ska aldrig faktureras (internt, egen admin, kulans, dubblett) | Nej |
| `fakturerad` | Kopplad till faktura. Låst | Redan fakturerad |

**Registrerad tid ≠ fakturerad tid.** Posten behåller alltid `registrerade_minuter` (vad som hände) *och* `debiterbara_minuter` (vad kunden betalar). Skillnaden är synlig och motiverad.

### 3.2 Avtalsstyrd projektstruktur

Avtalet är källan till vad som får faktureras. Ett projekt ärver sin struktur från avtalet:

```
Avtal (ILT-konsultavtal 2026-05-04)
 ├── Fas 1A – Ambassadörsprogram          tak: ingår i Fas 1
 ├── Fas 1B – AI-policyramverk            tak: ingår i Fas 1
 ├── Fas 1C – Organisationsutbildning     tak: ingår i Fas 1   (Fas 1 totalt: 168 300 kr)
 ├── Fas 2A – Strategiska AI-projekt      tak: 32 h / 35 200 kr
 └── Fas 2B – CTO-stöd mätramverk         tak: 12 h / 13 200 kr
     timpris 1 100 kr/h · betalningsvillkor 30 dagar netto
```

Varje tidspost bokförs på en **avtalsdel**, och det är avtalsdelen som blir kategori på fakturabilagan.

---

## 4. Funktionskrav

### F0 — Avtalsinläsning och projektstruktur
- Läs in ett avtal (PDF/DOCX) och **extrahera automatiskt**: parter, timpris, betalningsvillkor, faser/deluppdrag, timförslag och tak per fas.
- Skapa projektstrukturen ur detta.
- **Allt extraherat ska gå att redigera manuellt** — extraktionen är ett utkast, inte ett facit.
- David ska kunna **lägga till egna deluppdrag** som inte står i avtalet (t.ex. löpande support), och markera dem som debiterbara eller ej.
- Tilläggsavtal och ändrad omfattning ska kunna registreras med datum, så historiken består.
- **Takbevakning:** löpande summering per fas mot taket. Varning vid 80 % och spärr/bekräftelse vid överskridande, med påminnelse om att avtalet kräver skriftligt besked till kunden.

### F1 — Registrering av tid (manuell, snabb, redigerbar)
- Minimum: **projekt + avtalsdel + tid + beskrivning**. Datum defaultar till idag.
- Tid skrivs naturligt: `1h`, `90m`, `1,5`, `45`.
- **Manuell redigering är förstklassig.** Både siffror och text ska gå att ändra i efterhand så länge posten inte är fakturerad — AI är den primära vägen in, men aldrig den enda.
- **Underlag ska kunna bifogas** en tidspost: filer, länkar (Doc, mötesanteckning, leverans) som stöd för vad som gjorts.
- Ska gå att göra på under 10 sekunder från valfri yta (CLI, chatt, webb).

### F2 — Flera personer
- Systemet ska hantera **flera registrerande personer samtidigt** på samma projekt.
- Per person: egen timkostnad och eventuellt eget debiterbart timpris.
- Var och en ser och registrerar sin egen tid; projekt-/bolagsägaren ser allt.
- Godkännandet kan konfigureras: personen godkänner själv, eller ägaren godkänner allas.
- Fakturabilagan summerar per avtalsdel — inte per person — om inte annat väljs.

### F3 — Kalenderinläsning
- Läs kalendern för ett datumintervall.
- Filtrera fram kunddebiterbara händelser: externa deltagare matchade mot kundens maildomäner.
- Föreslå projekt **och avtalsdel** utifrån deltagardomän och historik.
- Mötets längd = utgångsvärde för registrerad tid.
- Hoppa över egna rutinblock enligt konfigurerbar blocklista.

### F4 — Daglig sammanställning (kalender + mail), dagen efter
Schemalagt jobb varje vardagsmorgon för **gårdagen**:
1. Hämta gårdagens kalenderhändelser.
2. Hämta gårdagens skickade och mottagna mail.
3. **Resonera** fram förslag per kund och avtalsdel: vilka möten hölls, vilket arbete syns i mailen, uppskattad tid.
4. Varje förslag ska ha **härkomst** (kalenderhändelse-id / mail-id) så David kan bedöma utan att gräva.
5. Osäkerhet märks ut, gissas inte bort.

### F5 — Godkännandeloop
- Daglig lista: *förslag för gårdagen*.
- Per rad: **Godkänn** · **Justera tid** · **Ignorera** (med orsak) · **Byt avtalsdel**.
- Massgodkännande ska finnas men aldrig som default.
- Obesvarade dagar ligger kvar i kön — de förfaller inte och går aldrig vidare av sig själva.
- Kön visar antal obehandlade dagar så det syns när det glidit.

### F6 — Från godkänd tid till faktura
- Vid fakturering väljs **projekt + period**; systemet plockar godkänd, ofakturerad tid.
- Fakturabilagan visar **avtalsdelar som kategorier** — inte enskilda poster, inte datum.
- David kan exkludera enskilda poster i fakturasteget utan att ändra deras status permanent.
- När fakturan skapas sätts posterna till `fakturerad` med `faktura_id` — **atomärt med fakturan**.
- Dokumentnumret på PDF:en ska ägas och valideras av systemet (se öppen fråga 1).

### F7 — Låsning, spårbarhet och korrigering
- `fakturerad` är låst; ändring kräver kreditering.
- Historik per post: källa, vem som godkände, vad som justerades och varför.
- Rapport: **ofakturerad godkänd tid per kund** och **förbrukat mot tak per fas**.
- Status kan ändras bakåt så länge posten inte är fakturerad. Ignorerade poster raderas aldrig.

---

## 5. Datamodell (tillägg)

**Tidspost**

| Fält | Typ | Kommentar |
|---|---|---|
| `status` | enum | `forslag`, `godkand`, `justerad`, `ignorerad`, `fakturerad` |
| `registrerade_minuter` | int | Vad som hände |
| `debiterbara_minuter` | int | Vad som faktureras (kan vara 0) |
| `avtalsdel_id` | fk | Styr kategori på bilagan och takbevakning |
| `actor_id` | fk | Vem som utfört arbetet |
| `kalla` | enum | `manuell`, `kalender`, `mail`, `harledd` |
| `kalla_ref` | string | Kalenderhändelse-id / mail-id |
| `bilagor` | lista | Filer/länkar som underlag |
| `godkand_av` / `godkand_at` | | Godkännandespår |
| `justering_orsak` | text | Varför debiterbar ≠ registrerad |
| `faktura_id` | fk | Låser posten |

**Avtal / avtalsdel**

| Fält | Kommentar |
|---|---|
| `avtal_id`, `kund_id`, `signerat_datum`, `betalningsvillkor` | |
| `timpris_ore` | kan överstyras per avtalsdel eller person |
| `avtalsdel`: `namn`, `beskrivning`, `tak_timmar`, `tak_belopp_ore`, `ingar_i` | `ingar_i` för hierarki (1A/1B/1C → Fas 1) |
| `kalla_dokument` | referens till avtalsfilen extraktionen kom ur |
| `manuellt_andrad` | flagga när fältet redigerats efter extraktion |

---

## 6. Integrationer
- **Google Calendar** — händelser, deltagare, längd.
- **Gmail** — gårdagens skickade/mottagna mail.
- **Avtalsfiler** — PDF/DOCX, lokalt eller i Drive.
- **Redovisningssystemet** — projekt, kund, faktura.
- **Schemaläggning** — dagligt förslagsjobb.

---

## 7. Acceptanskriterier

1. Ett inläst avtal ger en projektstruktur med rätt faser, timpris och tak — och allt går att redigera.
2. David kan lägga till en egen avtalsdel som inte finns i avtalet.
3. Systemet varnar när en fas passerar 80 % av taket och kräver bekräftelse vid överskridande.
4. Två personer kan registrera tid på samma projekt samma dag utan konflikt.
5. En dag med två kundmöten ger nästa morgon två förslag med rätt projekt, rätt avtalsdel och rätt längd, med länk till källan.
6. David kan godkänna en dag på under 30 sekunder.
7. Siffror och text på en icke-fakturerad post går att ändra manuellt, och underlag går att bifoga.
8. En ignorerad post syns aldrig i ett fakturaunderlag men går att hitta i efterhand med orsak.
9. En faktura skapad ur godkänd tid sätter samtliga ingående poster till `fakturerad` i samma transaktion — det ska vara **omöjligt** att skapa fakturan utan att posterna stängs.
10. Rapporten "ofakturerad godkänd tid" visar noll för en fakturerad period.
11. Fakturabilagan visar avtalsdelar som kategorier, utan datum.

---

## 8. Öppna frågor

1. **Fakturanummerserien** — systemets interna nummer och dokumentnumret på PDF:en är i dag två olika serier, vilket orsakade att en fakturafil skrevs över. Slås de ihop, eller blir dokumentnumret ett fält som systemet äger och validerar mot befintliga filer?
2. Ska mail-resonemanget föreslå tid även när **inget möte** finns (rent skrivbordsarbete), eller bara komplettera kalenderposter?
3. Hur långt bakåt får förslagskön växa innan systemet flaggar aktivt?
4. Ska ignorerad tid ändå synas i projektets lönsamhetsvy (nedlagd vs fakturerad tid)?
5. När flera personer registrerar: ska godkännandet vara per person eller alltid hos ägaren?

---

## 9. Först att bygga (förslag på ordning)

1. `status` + `debiterbara_minuter` skilt från `registrerade_minuter` — löser juli-problemet direkt.
2. Atomär fakturering som låser posterna (F6 + F7).
3. Avtalsdel på tidsposten + takbevakning med varning (F0, minimal version: manuellt inlagda faser).
4. Rapport: ofakturerad godkänd tid + förbrukat mot tak.
5. Manuell redigering och bifogade underlag (F1).
6. Avtalsinläsning med automatisk extraktion (F0, full version).
7. Kalenderinläsning (F3).
8. Daglig sammanställning med mail-resonemang + godkännandekö (F4 + F5).
9. Flera personer (F2).
