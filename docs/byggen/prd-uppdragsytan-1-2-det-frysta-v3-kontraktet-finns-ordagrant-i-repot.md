# PRD-bygget uppdragsytan 1-2-det-frysta-v3-kontraktet-finns-ordagrant-i-repot — PRD uppdragsytan 1-2-det-frysta-v3-kontraktet-finns-ordagrant-i-repot: # Story 1.2: Det frysta v3-ko

Datum: 2026-10-06 14:15 · Branch: cto/prd-uppdragsytan-1-2-det-frysta-v3-kontraktet-finns-ordagran-9163 · Kalla: 02-Områden/hermes/uppdragsytan-1c-prd.md (fryst 29/9, Davids beslut #194)

## Mal
PRD uppdragsytan 1-2-det-frysta-v3-kontraktet-finns-ordagrant-i-repot: # Story 1.2: Det frysta v3-kontraktet finns ordagrant i repot Status: ready-for-dev <!-- Note: Validation is optional. R

## PRD-kravet (ordagrant ur den frysta PRD:n) och astras kodgranskning
```
# Story 1.2: Det frysta v3-kontraktet finns ordagrant i repot

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

<!-- Kodbas: redovisning. Epic 1 (Undantagsvyn). Beror på: Story 1.1 (done). Byggvillkor 2 av 2: KRAV-13 (K-8 är 1 av 2). Ensam i våg 2 (parallelization-analysis.md rad 344–350). Varje senare berättelse väntar på den här (PA rad 19–22, regel 7 rad 663). -->
<!-- Story key: 1-2-det-frysta-v3-kontraktet-finns-ordagrant-i-repot · Story ID: 1.2 · Skapad 2026-10-06 med BMAD create-story i autonomt läge (YOLO). -->

## Story

As a David,
I want att det frysta kontraktet för NVR-001 finns ordagrant som provdata,
so that importen prövas mot det avtal som faktiskt gäller och inte mot en efterbildning.

**Krav:** PRD avsnitt 8 (det frysta kontraktet, `prd.md` rad 1116) och KRAV-13 (`docs/byggen/prd-uppdragsytan-fr-1.md` rad 25 och `docs/STATUS.md` rad 169–171). Berättelsen är grunden för proven i FR-1, FR-6, FR-9, FR-19 och FR-27 (`epics.md` rad 497).

**Vad berättelsen gör:**
- lägger den frysta v3-texten i repot som fixtur;
- låser texten vid källfilens sha256;
- märker den gamla formfixturen som syntetisk.

Ingen produktionskod ändras. Det som bygger på texten kommer i senare berättelser: importen mot v3 i Story 2.1, Hermes importsteg i 2.5, scopelinjen i 2.6 och täckningsprovet i 2.7 (`epics.md` rad 1537–1597 och 1745–1864).

**Bygge och grind:** CTO-kedjan bygger berättelsen på en gren i redovisningens repo och prövar den där. Den driftsätts först efter godkänd code-review (Dev Notes → ”Byggkedjan”). Varje uppgift och varje acceptanskriterium prövas i kopian, alltså grenen, före driftsättningen.

## Acceptance Criteria

Kriterierna 1–5 är ordagranna ur `epics.md` (Story 1.2, rad 506–526). Raderna under ”Mätbart” anger hur kriteriet prövas i den här kodbasen och lägger inte till några krav. Allt prövas i kopian före driftsättningen.

1. **Texten tecken för tecken.**
   **Given** filen `Leveranskontrakt-NVR-001-FRYST-v3-2026-09-07.md` i NVR-001:s projektmapp
   **When** fixturen `server/test/fixtures/leveranskontrakt-nvr-001-v3.ts` skapas
   **Then** bär den texten tecken för tecken, och en kommentar anger källans sökväg, frysningsdatum och sha256
   **And** ingen rad är omformaterad, förkortad, kompletterad eller skriven ur minnet.
   - *Mätbart:* fixturen exporterar `LEVERANSKONTRAKT_NVR001_V3`, som är hela källtexten, och `LEVERANSKONTRAKT_NVR001_V3_SHA256`, som är 64 hextecken i gemener. Vilken fil som är källa och hur texten avgränsas står i Dev Notes → ”Källan”.
   - *Mätbart:* värdet av `LEVERANSKONTRAKT_NVR001_V3` är identiskt med källtexten. Jämförelsen `===` mot källtexten, läst direkt ur källfilen, ger `true`. sha256 på värdet är samma summa som `sha256sum` ger på källtexten (Task 1.4 och 3.3).
   - *Mätbart:* kommentaren före första `export` har raderna `Frysningsdatum: 2026-09-07` och `sha256 (texten nedan som UTF-8): <summan>`, och den anger källans sökväg. För speglingen är sökvägen tre uppgifter: Drive-sökvägen ordagrant ur speglingens rad 12, `drive_id` och speglingens sökväg i valvet. Formen står i Dev Notes → ”Fixturens form”.
   - *Mätbart:* ett skript framställer fixturen mekaniskt ur källfilen (Task 3.1). Texten skrivs aldrig för hand, med ett redigeringsverktyg eller ur minnet. Källkoden skiljer sig från källtexten bara genom template-literalens escapning av `\`, `` ` `` och `${`, och av `\r` om källan har CR. Escapningen ändrar inget tecken i värdet.

2. **Summan låser texten.**
   **Given** fixturen
   **When** ett prov räknar sha256 på texten
   **Then** stämmer summan med den angivna, och varje ändring i fixturen fäller provet.
   - *Mätbart:* `server/test/uppdragsytan-v3-fixtur.test.ts` (ny) räknar `createHash('sha256').update(LEVERANSKONTRAKT_NVR001_V3, 'utf8').digest('hex')`. Den jämförs med provets egen konstant, som klistras in ur utdatan i Task 1.4 och inte importeras ur fixturen. Provet fäller också när fixturens konstant eller summan i kommentaren avviker från provets konstant.
   - *Mätbart:* provet har en negativ kontroll i minnet. Varje planterad ändring av texten ger en annan summa: ett tecken utbytt, ett tecken tillagt och den sista radbrytningen borttagen.
   - *Mätbart:* rött först. En planterad ändring av ett tecken i fixturfilen ger rött i `npx vitest run test/uppdragsytan-v3-fixtur.test.ts`, och fixturen som skriptet skrivit om ger grönt (Task 5.2). Nekar sandlådan testdatabasen visas samma rött och grönt med `npx tsx` utan databas, och kedjans `npm test` belägger vitest-körningen (Dev Notes → ”Om testdatabasen inte nås”).

3. **Den syntetiska formfixturen.**
   **Given** den befintliga syntetiska formfixturen
   **When** den ligger kvar
   **Then** är den uttryckligen märkt syntetisk och används bara för formprov, aldrig som belägg för NVR-001:s innehåll.
   - *Mätbart:* huvudkommentaren i `server/test/fixtures/leveranskontrakt-nvr-001.ts` börjar med `// SYNTETISK`. Den säger att texten inte är NVR-001:s kontrakt och inte belägger kontraktets innehåll, och den pekar på `leveranskontrakt-nvr-001-v3.ts`. Provet i AC 2 läser huvudet och fäller när markeringen eller pekaren saknas. Före Task 4 är just det provet rött (Task 3.4).
   - *Mätbart:* exporten `LEVERANSKONTRAKT_NVR001` och dess text är oförändrade tecken för tecken. Belägget är samma sha256 före och efter ändringen i Debug Log (Task 4.1 och 4.3).
   - *Mätbart:* de tretton testfiler som använder fixturen som formprov ändras inte. Provet visar att den syntetiska texten aldrig är den ordagranna: både texten och sha256 skiljer sig.

4. **Om texten inte kan hämtas.**
   **Given** att den ordagranna texten inte kan hämtas
   **When** berättelsen inte kan slutföras
   **Then** skrivs ingen text av eller rekonstrueras, och berättelsen står öppen med skälet i STATUS.md
   **And** ingen berättelse som prövar NVR-001:s verkliga kontrakt markeras klar.
   - *Mätbart:* villkoren står i Task 6.1. När något av dem gäller:
     - `git status` visar ingen ny eller ändrad fil under `server/`;
     - `docs/STATUS.md` har en ny post i sessionsloggen med skälet ordagrant och raden att KRAV-13 står öppen;
     - utvecklarens svar slutar med raden `HALT | KRAV-13: <skälet>`.
   - *Mätbart:* ingen annan rad i `sprint-status.yaml` och ingen annan berättelsefil ändras. Berättelsen sätts inte till `review`, och kedjan för tillbaka den till `ready-for-dev` (Dev Notes → ”Byggkedjan”).

5. **KRAV-13 stängd.**
   **Given** att fixturen är på plats
   **When** STATUS.md uppdateras
   **Then** står KRAV-13 som stängd med datum.
   - *Mätbart:* en ny post står överst i `docs/STATUS.md` → ”Sessionslogg”. Den anger `**KRAV-13 stängd <ÅÅÅÅ-MM-DD>**`, fixturens sökväg, källan, `andrad` och `metod`, sha256 och provfilen. Den säger också att formfixturen är märkt syntetisk, vilka kommandon som körts med sina utfall och vad som inte körts. Formen står i Dev Notes → ”STATUS.md-posten”.
   - *Mätbart:* posten skrivs i grenen och följer med i samma ändring (Dev Notes → ”Byggkedjan”). Äldre poster ändras inte, och FR-1-postens ”KRAV-13 återstår” står kvar som historik.

## Tasks / Subtasks

- [ ] **Task 1: Hitta och mät källan, utan att skriva något (AC: 1, 4)**
  - [ ] 1.1 Pröva bara de två källorna i Dev Notes → ”Källan”. Använd `$HOME` och inte `~`, eftersom `~` inte expanderas inom citattecken.
    - A: `find "$HOME/brain/01-Projekt/NVR-001" -name 'Leveranskontrakt-NVR-001-FRYST-v3-2026-09-07.md'`.
    - B: `test -f "$HOME/brain/03-Resurser/kunddokument/Nordic Vision Retail/Leveranskontrakt-NVR-001-FRYST-v3-2026-09-07.md"`.

    Öppna ingen annan fil i valvet. Skriv i Debug Log vilka träffar du fick.
  - [ ] 1.2 Gäller B: kontrollera rad 1–13 mot Dev Notes → ”Speglingens form”. Klistra in rad 2–7 och rad 12 ordagrant i Debug Log. Följande ska gälla:
    - rad 2 är `typ: kunddokument`, rad 3 `kund: Nordic Vision Retail` och rad 4 `kalla: drive`;
    - rad 5–7 har `drive_id`, `andrad` och `metod`, och `metod` b
```

## Utfall
Tester: 144 passed (144) · Granskning: GODKANT | Alla acceptanskriterier är implementerade och samtliga tillämpliga kryssade uppgifter har belägg; inga konkreta fynd kvarstår. · Byggforsok: 1

## Modellkedja (Davids krav 17/8, reservvag 7/9)

* krav: kordes inte
* utveckling: **gpt-6.1-sol**
* granskning: **gpt-6-astra**

Granskaren ar inte forfattaren: gpt-6-astra granskade gpt-6.1-sols arbete.

Allt pa Davids abonnemang - inga API-tokens.
