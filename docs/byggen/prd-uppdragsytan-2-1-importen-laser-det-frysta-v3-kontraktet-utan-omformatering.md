# PRD-bygget uppdragsytan 2-1-importen-laser-det-frysta-v3-kontraktet-utan-omformatering — PRD uppdragsytan 2-1-importen-laser-det-frysta-v3-kontraktet-utan-omformatering: # Story 2.1: Import

Datum: 2026-10-16 20:05 · Branch: cto/prd-uppdragsytan-2-1-importen-laser-det-frysta-v3-kontraktet-9220 · Kalla: 02-Områden/hermes/uppdragsytan-1c-prd.md (fryst 29/9, Davids beslut #194)

## Mal
PRD uppdragsytan 2-1-importen-laser-det-frysta-v3-kontraktet-utan-omformatering: # Story 2.1: Importen läser det frysta v3-kontraktet utan omformatering Status: ready-for-dev <!-- Note: Validation is o

## PRD-kravet (ordagrant ur den frysta PRD:n) och astras kodgranskning
```
# Story 2.1: Importen läser det frysta v3-kontraktet utan omformatering

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

<!-- Kodbas: redovisning. Krav: FR-1, FR-9, FR-3 (uppdragets och leverablernas ramar), FR-34, FR-4 (baselineförslaget via kön), NFR-11. Beror på: Story 1.2, Story 1.7 (båda done, byggjournalerna finns i docs/byggen/). -->

## Story

As a David,
I want att det frysta kontraktet blir baseline, register och ramar utan att jag matar in något,
so that avtalets plan är läsbar på den nivå avtalet faktiskt daterar.

## Acceptance Criteria

Lydelsen i varje **Given/When/Then** är ordagrann ur `epics.md` (Story 2.1). Raden **Mätbart** under varje kriterium är berättelsens tillägg: den säger hur kriteriet görs sant (mekanismen) och vilka ändliga fall provet prövar. Kriteriet ändras inte av den. "v3-fixturen" är `server/test/fixtures/leveranskontrakt-nvr-001-v3.ts` (Story 1.2, KRAV-13). "Den syntetiska v3-formfixturen" är den nya fixturen i uppgift 1.

1. **Given** v3-fixturen
   **When** importen tolkar texten
   **Then** läser den sex leverabler, L1–L6, med namn, klausulhänvisning, acceptanskriterium och uppföljningsmått ordagrant ur leverabeltabellen
   **And** den läser uppdragets ram (473 000 kr och 430 h), leverabelramarna (L1 40 h, L2 70 h, L3 205 h, L4 40 h, L5 40 h, L6 20 h), de 15 h löpande styrningen som inte är en leverabel, placeringarna (L1 STEG1, L2 och L3 STEG2, L4 och L5 STEG3, L6 STEG4), stegens intervall (STEG1 31/8–13/9, STEG2 7/9–1/11, STEG3 26/10–20/12, STEG4 1/9–31/12) och uppdragets ytterdatum ur tidsplansparagrafen.
   - **Mätbart:** `parseLeveranskontrakt(LEVERANSKONTRAKT_NVR001_V3)` ger:
     - **Ordagrant:** för varje Lx bygger provet raden `| Lx | <namn> | <klausul> | <acceptanskriterium> | <uppföljningsmått> |` ur parserns fält och kräver att den finns som en hel rad i fixturen. Provet skriver alltså inte av texten för hand. Dessutom står två literaler: L1:s namn `Förhandlingsstrategi och BAFO-upplägg` och L2:s fulla namn `Due diligence-rapport, teknisk kommersiell och finansiell`. Det senare fäller att den kortare formen ur timtabellen vinner.
     - **Ram:** `cap_amount_ore = 47_300_000` ur `**Ram:** 473 000 SEK exkl moms`. `cap_hours = 430` ur timtabellens rad `| | **Summa** | **430** | |`, eftersom fältet `**Timmar:** ca 430` är ungefärligt och `timmar('ca 40 h')` ska förbli `null`. Beslutet och skälet står i Dev Notes, ”Ramen i timmar”.
     - **Leverabelramar och placering:** `[kod, cap_hours, strom_kod]` blir exakt `[['L1',40,'STEG1'],['L2',70,'STEG2'],['L3',205,'STEG2'],['L4',40,'STEG3'],['L5',40,'STEG3'],['L6',20,'STEG4']]`.
     - **Styrningen:** `{ kod: 'STYRNING', namn: 'Löpande styrgruppsrapportering', cap_hours: 15 }`. Den läses ur placeringstabellens rad `Löpande styrgruppsrapportering (STYRNING)` och timtabellens rad `| - | Löpande styrgruppsrapportering | 15 | … |`. Summan av leverablernas ramar plus styrningen är lika med ramens timmar, 415 + 15 = 430.
     - **Stegen:** STEG1 `2026-08-31`–`2026-09-13`, STEG2 `2026-09-07`–`2026-11-01`, STEG3 `2026-10-26`–`2026-12-20` och STEG4 `2026-09-01`–`2026-12-31`, alla med `date_precision = 'dag'` och namnen ur kolumnen `Ström`.
     - **Ytterdatum:** `2026-09-01`–`2026-12-31` med `dag`, ur `**Period:** 1 sep till 31 dec 2026`. Det är det enda ställe där v3 daterar uppdraget, alltså v3:s tidsplansparagraf.
     - **Tillstånd:** `kontrakt_tillstand = 'fryst'`.

2. **Given** ett syntetiskt kontrakt med andra steg, intervall och leverabler
   **When** det importeras
   **Then** blir resultatet dess egna värden. Inga NVR-värden är hårdkodade.
   - **Mätbart:**
     - **Mekanism:** parsern är en ren funktion av texten. Varje värde läses ur en cell eller ett fält som hittas genom tillåtelselistan av kolumn- och etikettnamn (`kolumn()` och `faltkarta()` i `lib/leveranskontrakt.ts`). Inget värde har någon annan källa.
     - **Fall:** den syntetiska v3-formfixturen har samma markdownform som v3 men andra koder, månadsintervall, fyra leverabler, en annan ram och en annan styrning. Den ger exakt sina egna värden: `toEqual` på hela parserns utdata utom `scopelinjer`, mot ett förväntat objekt som står i provet. Provet söker inte efter NVR-literaler i källkoden.

3. **Given** ett fryst kontrakt (`kontrakt_tillstand = fryst`)
   **When** importen körs
   **Then** köas ett `satt_baseline`-förslag med anroparens aktör, och ingenting skrivs till baselinen eller registret före godkännandet
   **And** förslaget syns i undantagsvyn som `baselineandring` med förifyllt underlag: intervall, placering, ramar och länk till avtalet.
   - **Mätbart:**
     - **Mekanism:** i fryst läge skriver `importeraLeveranskontrakt` bara köposten (`createApproval`) och dess auditrad `action.approval_requested`, och ingenting alls när köposten för källan redan finns (kriterium 4). Varje domänskrivning ligger i `sattBaseline`, som bara körs genom `approveAction`/`verkstallBeslut`.
     - **Fall (a), människa, och (b), agent-token, med v3-fixturen mot var sitt nytt avtal:** ögonblicksbilden av `contract_parts`, `uppdrag_leverabel`, `uppdrag_leverabel_handelse`, `uppdrag_scopelinje`, `uppdrag_beslut`, `contracts` och `uppdrag_referens` är lika före och efter. `action_approvals` har exakt en ny rad med `action = 'satt_baseline'`, `status = 'pending'` och `requested_actor` lika med anroparens (`human` respektive `agent`).
     - **Fall (c):** `las_undantag` ger exakt en post med slaget `baselineandring` för avtalet. Dess `forslag.till` innehåller `UPPDRAG 2026-09-01 till 2026-12-31`, `tak 430 h` och `tak 473 000,00 kr`, de fyra stegen med intervallen ur kriterium 1, `L1 under STEG1` … `L6 under STEG4` med var sin `tak <N> h` och `STYRNING` med `tak 15 h`. Postens källa (`kallor`) pekar på `/app/c/<bolag>/projects/<projekt>/kontraktet`.

4. **Given** samma kontrakt och samma text
   **When** importen körs igen, en gång eller många gånger
   **Then** köas inget nytt förslag, eftersom det redan finns en köpost för källan i någon status
   **And** en ny fryst version med annan text ger ett nytt förslag.
   - **Mätbart:**
     - **Mekanism:** källans identitet är paret (`contract_id`, `kontraktstext`). Det finns en enda kontroll, i `importeraLeveranskontrakt` före `createApproval`. Den tar ett transaktionslås per avtal och söker sedan en `satt_baseline`-köpost för samma par i valfri status. Låset och sökningen står i uppgift 4. Finns en sådan post skapas ingen ny, och svaret bär den befintligas `approval_id` och `redan_koad: true`.
     - **Fall:** statusvärdena tas ur CHECK-villkoret i 0012 (`pending`, `approved`, `rejected`, `executed`, `failed`), och provet jämför sin lista med villkoret i databasen. För vart och ett gäller: med en köpost i den statusen för paret ger tre nya importer fortfarande exakt en köpost för avtalet. Dessutom provas produktvägen import → godkänn (`executed`) → samma import (`redan_koad`). En text där en rad ändrats ger en ny köpost, och samma text mot ett annat avtal ger en ny köpost. Varje fall har ett eget avtal.

5. **Given** att David godkänner förslaget
   **When** handlern körs
   **Then** skrivs baseline version 1 med orsaken ”avtal”: UPPDRAG med ytterdatumen och precisionen `dag`, och stegen med sina intervall och precisionen `dag`
   **And** leverablerna saknar egna datum och ärver sitt stegs intervall och precision
   **And** registret får de sex leverablerna med status `ej_paborjad` och tomma transmittalfält, och `uppdrag_beslut` får ett ja.
   - **Mätbart:** efter godkännandet av v3-förslaget gäller följande.
     - **Avtalsdelarna:** `contract_parts` har exakt 12 rader: UPPDRAG, STEG1–STEG4, L1–L6 och STYRNING. Alla har `change_reason = 'avtal'`, `valid_from = signed_date` och `cap_confirmed = false`.
     - **Leverablerna:** L1–L6 har `start_date`, `end_date` och `date_precision` NULL och föräldern STEGy enligt placeringen. STYRNING ligger under UPPDRAG med 15 h.
     - **Planen:** `byggPl
```

## Utfall
Tester: 163 passed (163) · Granskning: GODKANT | Alla elva kriterier är implementerade och provade i kedjans gröna körning. Berättelsen har inga «Review Follow-ups (AI)» från förra varvet att pröva, och bara tre LOW-fynd återstår. · Byggforsok: 3

## Modellkedja (Davids krav 17/8, reservvag 7/9)

* krav: kordes inte
* utveckling: **claude-opus-5-5**
* granskning: **claude-opus-5-5 (Codex spärrat — Davids regel 12/10; Codex granskar i efterhand)**

Granskaren ar inte forfattaren: claude-opus-5-5 (Codex spärrat — Davids regel 12/10; Codex granskar i efterhand) granskade claude-opus-5-5s arbete.

Allt pa Davids abonnemang - inga API-tokens.
