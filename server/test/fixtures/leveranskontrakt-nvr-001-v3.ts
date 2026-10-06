// ORDAGRANN fixtur: NVR-001:s frysta leveranskontrakt v3 (KRAV-13, Story 1.2).
//
// Källa: Drive `01_Kunder/Nordic Vision Retail/Fas 2/Leveranskontrakt-NVR-001-FRYST-v3-2026-09-07.md`
//   Drive-id 1NeHDvs26pipOSACQJAwgYdkbm1xcp-9- · andrad 2026-09-07 18:23 · metod ren text (text/markdown)
// Läst ur: ~/brain/03-Resurser/kunddokument/Nordic Vision Retail/
//   Leveranskontrakt-NVR-001-FRYST-v3-2026-09-07.md, rad 14 till slutet
//   (rad 1–13 är speglingens huvud, inte kontraktets text; dokument_index.py skriv()).
// Frysningsdatum: 2026-09-07
// sha256 (texten nedan som UTF-8): 4daaea5f30ad8738a9d11e7ad51739f0cda684720641d5f695cb08c74bfe29d8
//
// Texten är inläst mekaniskt ur källfilen, tecken för tecken, och ändras aldrig för
// hand. Template-literalen escapar bara \ ` och ${ (och CR som \r): skrivsätt, inte
// värde. Ett nytt kontrakt blir en ny fixtur, aldrig en ändring här.
// uppdragsytan-v3-fixtur.test.ts fäller varje ändring.
export const LEVERANSKONTRAKT_NVR001_V3_SHA256 = '4daaea5f30ad8738a9d11e7ad51739f0cda684720641d5f695cb08c74bfe29d8';

export const LEVERANSKONTRAKT_NVR001_V3 = `---
typ: leveranskontrakt
projekt: NVR-001
kund: Nordic Vision Retail AB
version: 3 (fryst)
foregaende: Leveranskontrakt-NVR-001-FRYST-v2-2026-09-07.md (fryst 2026-09-07)
datum: 2026-09-01
fryst: 2026-09-07 (v3)
status: FRYST v3 - strömmarna heter STEG, inte FAS (Davids beslut 2026-09-07); allt annat är v2
kontrakt_tillstand: fryst
underlag: Konsultavtal_NVR_Locollabs_Fas2_Del1_SIGNERAT_2026-08-31.pdf
bmad_steg: "grinden steg 2 - uppdragsdialogen"
---

# Leveranskontrakt NVR-001, Fas 2 Del 1 - version 3

> Davids karta över uppdraget, inte kundens avtalstext. Härledd ur det signerade konsultavtalet med klausulhänvisning på varje rad. Det avtalet inte svarar på står som obesvarat, aldrig ifyllt på gissning.
>
>    ✅ **FRYST 2026-09-03.** Davids sex svar är inkomna och inarbetade. Kontraktet gäller nu som referens för Uppdragsytans import, och \`kontrakt_tillstand\` är \`fryst\` - modulen får sätta baseline version 1.
>
> Ändringar härifrån sker som **ny version med orsak**, aldrig genom att skriva om den här. Den frysta texten är det som mäts mot.
>
> **Version 2, 2026-09-07:** sektion 8 lägger till Bilaga 1:s fyra faser som strömmar med kod och datum, och placerar varje leverabel i sin ström (L3 i STEG2, Davids val). Sektion 1-7 är version 1 ordagrant.
> **Version 3, 2026-09-07:** strömmarna heter STEG1-STEG4, inte STEG1-STEG4 - se sektion 9. Inget annat ändras.

**Kund:** Nordic Vision Retail AB · **Period:** 1 sep till 31 dec 2026 · **Ram:** 473 000 SEK exkl moms · **Timmar:** ca 430 · **Beläggning:** ca 60 % · **Underlag:** signerat 31 aug 2026

## 1. Uppdragsbriefen

NVR har köpt att David **leder upphandlingen och avtalsförhandlingen** med de leverantörer som kvalificerade sig i förstudien, fram till ett färdigförhandlat avtal klart för signering mellan NVR och vald leverantör. Inte att avtalet blir signerat: signering kräver deras och leverantörens namnteckningar, inte hans.

De köpte det för att de saknar intern IT-funktion och står inför att välja ett gemensamt verksamhetssystem för 200-plus butiker i fyra länder. Förstudien gav beslutsunderlaget. Det här är steget där någon sitter i förhandlingsrummet med deras intresse i ryggen.

Källa: avtalets §2.1 och §3.4. Motivet är härlett ur förstudiens uppdragsram, inte ur avtalet självt.

## 2. Leveranskartan

Sex leverabler, alla spårade till §2.2. **Acceptanskriterierna finns inte i avtalet** - det säger vad som ska levereras, inte när det är godkänt. Kriterierna nedan var förslag och är **godkända av David 2026-09-03, svar 1**. De gäller.

| Id | Leverabel | Klausul | Acceptanskriterium (förslag) | Uppföljningsmått |
|---|---|---|---|---|
| L1 | Förhandlingsstrategi och BAFO-upplägg | §2.2 strecksats 1 | Styrgruppen har godkänt upplägget och de två parallella spåren är startade med båda leverantörerna informerade om formatet | Datum för styrgruppens godkännande, binärt |
| L2 | Due diligence-rapport, teknisk kommersiell och finansiell | §2.2 strecksats 2 | En rapport per kvarvarande leverantör, alla tre dimensionerna täckta, levererad till styrgruppen före down-select | Antal rapporter klara av antal leverantörer i spåret |
| L3 | Förhandlat leverantörsavtal klart för signering | §2.2 strecksats 3 | Avtalstexten är färdigförhandlad med vald leverantör och samtliga fyra delar finns i den: SLA, vitesmodell, exit- och datavillkor, IP | Fyra kryss, delvis förhandlat SLA är inte ett kryss |
| L4 | Integrations- och migreringskrav som avtalsbilaga | §2.2 strecksats 4 | Kraven ligger som bilaga i leverantörsavtalet, och leverantörens egen migreringsplan är granskad och kommenterad skriftligt | Bilagan finns i avtalsutkastet, granskningen är daterad och avsänd |
| L5 | Per-land-villkor i avtalet | §2.2 strecksats 5 | Avtalet har landsspecifika villkor för alla fyra länderna, och Finlands är formulerat så att Valvira-registrering är en förutsättning för leverantörens leverans där | Fyra länder, fyra villkorsavsnitt, Finland dessutom med Valvira-klausulen |
| L6 | Överlämningsunderlag till Del 2 | §2.2 strecksats 6 | Ett dokument som gör att någon annan kan ta vid: förhandlingshistorik, vad som gavs och togs, öppna punkter, kontaktvägar, vad Del 2 behöver besluta först | Levererat före 31 december, kopplar till §10.5 |

**Gränsfall L4:** David kravställer migreringen. Han planerar den inte. Se scopelinjen.

### Timfördelning per leverabel (svar 4: ja, dekomponera nu)

Bilaga 1 dekomponerar de 430 timmarna **per fas**, inte per leverabel. Fassiffrorna nedan är kontraktets; leverabelsplitten är **härledd ur fasernas egna aktivitetslistor och är Davids att ändra**.

| Fas (Bilaga 1) | Veckor | Timmar | Andel | Går till |
|---|---|---|---|---|
| 1 Uppstart & strategi | v.36-37 | ~40 | 9 % | L1 |
| 2 Upphandling & förhandling | v.37-44 | ~185 | 43 % | L2 och L3 |
| 3 Avtal & signering | v.44-51 | ~170 | 40 % | L3, L4, L5 |
| 4 Styrning & överlämning | löpande | ~35 | 8 % | L6 och löpande styrning |

**Härledd split per leverabel** - summerar till 415 h, plus 15 h löpande styrgruppsrapportering som inte är en leverabel:

| Id | Leverabel | Timmar | Härledd ur |
|---|---|---|---|
| L1 | Förhandlingsstrategi och BAFO-upplägg | 40 | hela fas 1 |
| L2 | Due diligence-rapport | 70 | fas 2, DD-delen |
| L3 | Förhandlat leverantörsavtal | 205 | fas 2 (BAFO, kommersiell förhandling, down-select: 115) + fas 3 (avtalsutkast, SLA/vite, exit/data/IP, slutförhandling: 90) |
| L4 | Integrations- och migreringskrav | 40 | fas 3 |
| L5 | Per-land-villkor inkl. Valvira | 40 | fas 3 |
| L6 | Överlämningsunderlag till Del 2 | 20 | fas 4 |
| - | Löpande styrgruppsrapportering | 15 | fas 4, ej leverabel |
| | **Summa** | **430** | |

Uppdragsytan använder de här talen som **ram per leverabel** enligt FR-3, så tröskeln kan mätas på postnivå och inte bara mot uppdragets 473 000.

**Täckningsprovet, kört i båda riktningarna.** Alla sex rader har klausulhänvisning, ingen påhittad. §2.2 listar exakt sex strecksatser, alla sex har en rad, ingen glömd. Noll av sex acceptanskriterier finns i avtalet. §2.3 har fyra undantag, alla fyra har rad i sektion 5.

## 3. Uppföljningen

| Vad som mäts | Hur ofta | Var siffran läses | Larmar när |
|---|---|---|---|
| Nedlagd tid mot ram | Varje vecka | Redovisningen, projekt \`NVR - förstudie & projektledning\` | Förbrukad andel timmar överstiger andel klara leverabler |
| Leverabler klara | Varje vecka | Den här kartan, L1 till L6 | Ingen rad rört sig på tre veckor |
| Kundens beslutspunkter | Varje vecka | Styrgruppsprotokoll och mejl | En beslutspunkt passerat sitt datum, då aktiveras §3.6 |
| Fakturering | Månadsvis | Redovisningen | Faktura inte ute inom tre dagar efter månadsskifte |
| Scopesignaler | Löpande | Sektion 5 | En signalfras tänder |

430 timmar över fyra månader är ungefär 27 timmar i veckan. Ligger förbrukningen på 40 procent med en leverabel klar av sex i mitten av oktober är det inte en känsla, det är en siffra, och §3.6 finns för precis det.

## 4. Rapporteringen

| Till vem | Vad | Hur ofta | Form |
|---|---|---|---|
| Styrgruppen, hela | Läge per leverabel, öppna beslut, risker | **Varannan torsdag** | Kort underlag före mötet, protokoll efter |
| Enskilda styrgruppsmedlemmar | Per land, plus eventuella intressegrupper | **Varannan torsdag, växelvis med ovan** | Enskilda avstämningar |
| Eva Larsson, projektägare | Det som inte kan vänta till mötet | Vid behov | Mejl eller telefon |
| NVR:s styrelse | Leverantörsinriktning | Vid beslutspunkt | Beslutsunderlag, §3.5 ger styrelsen det bindande beslutet |
| Fakturaunderlag | Nedlagd tid med beskrivning | Månadsvis i efterskott | Bilaga till fakturan, §6.2 kräver det uttryckligen |

Avtalets §3.5 säger löpande rapportering enligt fast mötesrytm men definierar den inte. **Rytmen är satt av David 2026-09-03 (svar 3): torsdag varje vecka, växelvis hela styrgruppen och enskilda medlemmar per land och intressegrupp.** Bedömningstillfällena i Uppdragsytan följer den fulla styrgruppens torsdagar.

### Vem som godkänner en leverabel (svar 2)

Avtalets §4.2 kräver att kunden utser en representant med beslutsbefogenhet men namnger ingen. **Davids svar 2026-09-03:**

> **Styrgruppen som helhet godkänner först. Vid skilda åsikter inom gruppen har Eva Larsson sista ordet i egenskap av VD på NVR.**

Uppdragsytans transmittalfält \`mottagare\` fylls därför med **Styrgruppen**, med \`eskalering: Eva Larsson (VD)\`. Fältet är inte längre saknat - FR-13:s och FR-27:s blockering är upphävd.

**Formen för godkännande (svar 9, 2026-09-03):** ett godkännande från Eva per telefon eller mejl är tillräckligt och räknas. Det behöver inte vara protokollfört för att gälla som godkännande - men det ska loggas med datum och kanal.

## 5. Scopelinjen

**Innanför, det David får betalt för:** leda förhandlingen som NVR:s part inom styrgruppens ramar · due diligence i tre dimensioner · kravställa integration och migrering som avtalsbilaga · granska leverantörens migreringsplan · skriva och förhandla avtalstexten fram till signeringsklar · per-land-villkor inklusive Valvira · överlämning till Del 2.

**Utanför, §2.3:** leverantörens egen utveckling och implementering · licens- och systemkostnader · pilot och bred utrullning · detaljerad genomförande- och utrullningsplanering samt acceptanskriterier för pilot. Plus §6.5: resor utanför Stockholm och specialiststöd ligger utanför arvodet och kräver godkännande i förväg.

### Signalfraserna

| Det kunden säger | Vad det betyder | Klausul |
|---|---|---|
| "Kan du bara skissa hur migreringen skulle gå till rent praktiskt?" | David kravställer migreringen. Att planera genomförandet är Del 2 | §2.3 |
| "Vi behöver en tidplan för utrullningen i Norge" | Bred utrullning är uttryckligen undantagen | §2.3 |
| "Vad ska vi ha för acceptanskriterier i piloten?" | Nämns ordagrant som undantag i avtalet | §2.3 |
| "Kan du sitta med när leverantören sätter upp testmiljön?" | Leverantörens egen implementering | §2.3 |
| "Kan du åka till Helsingfors och träffa dem?" | Resa utanför Stockholm, separat fakturering, godkänns i förväg | §6.5 |
| "Kan du ta ett pass med vår jurist på avtalstexten?" | Fördjupat specialiststöd, prissätts separat efter styrgruppens godkännande | §6.5 |
| "Down-select drar en månad till, men december ligger fast" | Kundens beslutspunkt glider utan att ramen justeras. Exakt vad §3.6 skrevs för | §3.6 |

**Vad David gör när en tänder.** Inte säga nej. Säga vad det är: *"Det ligger i Del 2 enligt avtalets 2.3. Jag kan göra det, och då lägger vi det som ett tillägg. Vill du att jag prisar det?"* Undantagen är säljbara, de är bara inte gratis. Det som kostar pengar är att göra dem utan att någon räknade dem.

För §3.6-signalen: begär skriftlig justering av tidsplan och vid behov ram, samma vecka som grinden glider.

**Hanteringen när en signal tänder (svar 5, 2026-09-03):** signalerna **samlas till veckan** och tas på torsdagsmötet - men de ska kunna användas för **direkt kommunikation med styrgruppen när behovet finns**. Alltså: veckotakt som normalläge, direkt eskalering som möjlighet, inte som undantag som kräver motivering.

**Delning (svar 6, 2026-09-03): scopelinjen delas med Eva.** Den blir därmed ett gemensamt språk mellan Locollabs och NVR, och undantagen lättare att prissätta i stället för att bli tysta förväntningar.

## 6. Davids svar 2026-09-03 - kontraktet fryst

| # | Frågan | Svaret |
|---|---|---|
| 1 | Godkänner David de sex acceptanskriterierna? | **Ja.** Alla sex gäller som de står i sektion 2. |
| 2 | Vem hos NVR godkänner en leverabel? | **Styrgruppen som helhet först. Vid skilda åsikter har Eva Larsson sista ordet som VD på NVR.** |
| 3 | Mötesrytm mot styrgruppen? | **Torsdag varje vecka, växelvis: varannan med hela styrgruppen, varannan med enskilda medlemmar per land och intressegrupp.** |
| 4 | Ska de 430 timmarna dekomponeras per leverabel nu? | **Ja.** Fassiffrorna ur Bilaga 1, leverabelsplitten härledd - se sektion 2. |
| 5 | När en signalfras tänder, vad ska hända? | **Samla till veckan**, med möjlighet till direkt kommunikation med styrgruppen vid behov. |
| 6 | Ska scopelinjen delas med Eva? | **Ja.** |

**Kontraktet är därmed fryst.** Ändringar sker som ny version med orsak, enligt samma mönster som Uppdragsytans baselineversioner.

## 7. Vad frysningen låser upp

- Uppdragsytan får sätta **baseline version 1** - \`kontrakt_tillstand\` går från \`utkast\` till \`fryst\`.
- Leverabelregistrets **mottagarfält** fylls med Styrgruppen och eskalering Eva Larsson; det står inte längre som saknat.
- **Bedömningsrytmen** är satt: den fulla styrgruppens torsdagar.
- **Ram per leverabel** finns, så FR-3:s tröskel kan mätas på postnivå.
- **Scopelinjen** kan delas med Eva och blir ett gemensamt instrument.

## 8. Version 2 (2026-09-07) - faserna ur Bilaga 1 som strömmar

**Orsak:** Davids beslut 2026-09-07 (svar 2 i chatten: alternativ 2, L3 i STEG2). Planen i Uppdragsytan ska visa tidslinjen, och det kräver att Bilaga 1:s fyra faser finns som strömmar - avtalsdelar under UPPDRAG med kod och datum. Version 1 gav faserna i veckor utan kod, och L3 spänner över fas 2 och 3. Inget annat i version 1 ändras.

| Kod | Ström | Veckor (Bilaga 1) | Start | Slut |
|---|---|---|---|---|
| STEG1 | Uppstart & strategi | v.36-37 | 2026-08-31 | 2026-09-13 |
| STEG2 | Upphandling & förhandling | v.37-44 | 2026-09-07 | 2026-11-01 |
| STEG3 | Avtal & signering | v.44-51 | 2026-10-26 | 2026-12-20 |
| STEG4 | Styrning & överlämning | löpande | 2026-09-01 | 2026-12-31 |

Datumen är ISO-veckornas måndag och söndag (v.36 börjar 2026-08-31) - en omräkning, inte en gissning. STEG4 "löpande" är avtalsperioden 1 sep-31 dec. Faserna överlappar i v.37 och v.44, precis som i Bilaga 1.

| Leverabel | Ström | Skäl |
|---|---|---|
| L1 | STEG1 | hela fas 1 |
| L2 | STEG2 | fas 2, DD-delen |
| L3 | STEG2 | fas 2 + fas 3 i version 1 - Davids val 2026-09-07: STEG2 |
| L4 | STEG3 | fas 3 |
| L5 | STEG3 | fas 3 |
| L6 | STEG4 | fas 4 |
| Löpande styrgruppsrapportering (STYRNING) | - | inte en leverabel; ligger under UPPDRAG som i version 1 |

## 9. Version 3 (2026-09-07) - strömmarna heter STEG, inte FAS

**Orsak:** Davids beslut 2026-09-07. "Fas" är upptaget hos kunden: Fas 1 (förstudien, avslutad
2026-06-29) och Fas 2 Del 1 (det här uppdraget) är två skilda uppdrag under Nordic Vision Retail.
Att Bilaga 1:s interna faser också hette FAS1-FAS4 gjorde ordet tvetydigt i varje mening och i
varje vy. Koderna byter därför till STEG1-STEG4. **Ingenting annat ändras** - samma namn, samma
datum, samma tak, samma leverabler i samma strömmar. Dom fyra gamla FAS-delarna inaktiveras genom
beslutskön (\`upsert_contract_part\`, \`active: false\`) i stället för att raderas: en avtalsdel som
funnits ska gå att läsa i historiken.

| Gammal kod | Ny kod | Ström |
|---|---|---|
| FAS1 | STEG1 | Uppstart & strategi |
| FAS2 | STEG2 | Upphandling & förhandling |
| FAS3 | STEG3 | Avtal & signering |
| FAS4 | STEG4 | Styrning & överlämning |
`;
