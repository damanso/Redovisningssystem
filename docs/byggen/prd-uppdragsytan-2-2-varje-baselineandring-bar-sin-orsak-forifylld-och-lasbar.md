# PRD-bygget uppdragsytan 2-2-varje-baselineandring-bar-sin-orsak-forifylld-och-lasbar — PRD uppdragsytan 2-2-varje-baselineandring-bar-sin-orsak-forifylld-och-lasbar: # Story 2.2: Varje ba

Datum: 2026-10-17 01:03 · Branch: cto/prd-uppdragsytan-2-2-varje-baselineandring-bar-sin-orsak-for-9221 · Kalla: 02-Områden/hermes/uppdragsytan-1c-prd.md (fryst 29/9, Davids beslut #194)

## Mal
PRD uppdragsytan 2-2-varje-baselineandring-bar-sin-orsak-forifylld-och-lasbar: # Story 2.2: Varje baselineändring bär sin orsak förifylld och läsbar Status: ready-for-dev <!-- Note: Validation is opt

## PRD-kravet (ordagrant ur den frysta PRD:n) och astras kodgranskning
```
# Story 2.2: Varje baselineändring bär sin orsak förifylld och läsbar

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

<!-- Kodbas: redovisning. Krav: FR-2 (förifylld orsak och läsbara versioner), FR-1 (leverabeldatum som baselineändring), FR-4. Beror på: Story 1.5, Story 2.1 (båda done, byggjournalerna finns i docs/byggen/). Berättelsen ändrar också kod som Story 1.6, 1.7, 1.9, 1.10 och 1.14 skrev. -->

## Story

As a David,
I want att varje ändring av planen kommer med sin orsak redan ifylld och att alla versioner går att läsa,
so that jag kan svara på vad som gällde när vi kom överens utan att skriva orsaken en gång till.

## Acceptance Criteria

Lydelsen i varje **Given/When/Then** är ordagrann ur `epics.md` (Story 2.2, rad 1639–1660). Raden **Mätbart** under varje kriterium är berättelsens tillägg. Den säger hur kriteriet görs sant (mekanismen) och vilka ändliga fall provet prövar. Kriteriet ändras inte av den. ”v3-fixturen” är `server/test/fixtures/leveranskontrakt-nvr-001-v3.ts` (Story 1.2). ”Provfilen” är den nya `server/test/uppdragsytan-baselineorsak.test.ts`. Fallens namn (N, F, S, H, L) står i uppgifterna.

1. **Given** versionsregeln ur Story 1.5
   **When** berättelsen byggs
   **Then** står den kvar oförändrad: ingen lagrad version, bekräftad eller obekräftad, skrivs över eller raderas, `andra_baseline` skapar alltid en ny rad och ett förslag utan orsak avvisas
   **And** inget undantag för rättning på plats under uppsättningen finns. Uppsättningens utkast är köposten.
   - **Mätbart:**
     - **Mekanism, oförändrad.** Ingen uppgift ändrar triggern i 0079 (`kraver_orsak_vid_ny_version`), `skrivBaselineversion` (`contracts.ts:659–714`, den enda INSERT i `contract_parts`, 409 `version_finns` vid samma nyckel), `bekraftaTak` (den enda UPDATE, bara `cap_confirmed` från false till true) eller `OrsakSchema` (`avtalsdelsfalt.ts:79–81`). Orsaken krävs i `andra_baseline` och i `upsert_contract_part` utom vid ren bekräftelse. `satt_baseline` får sin orsak av servern (`IMPORTORSAK`). Ett tillägg ur en signal bär antingen Davids ord eller orsaken ur frasen, och utan någondera avvisas det (uppgift 3). Ett tillägg ur en Övrigt-rad får alltid `ovrigtorsak` av svepet och prövas mot `AndraBaselineSchema` före kön (Story 1.14). Ett förslag skapas alltså bara av de här vägarna, och var och en bär en orsak eller avvisas.
     - **Fall:** H3 (a)–(c), S4 och S5 visar att ett förslag utan orsak avvisas utan köpost. L5 visar att koden har en INSERT-väg och en UPDATE-väg och att UPDATE bara rör `cap_confirmed`. Story 1.5:s prov `uppdragsytan-baselineversion.test.ts` står på raderna Körning 1, 4 och 5 och ändras inte.

2. **Given** ett förslag med en härledbar källa (signalens fras, Övrigt-radens text och datum, importens ”avtal”)
   **When** förslaget skapas
   **Then** är orsaken förifylld i förslaget, och David läser den där
   **And** vid godkännandet registreras orsaken utan ytterligare inmatning.
   - **Mätbart:**
     - **Källorna är en sluten lista med tre poster** (architecture.md B-7 punkt 6):
       - *Importen:* köpostens åtgärd `satt_baseline` bär orsaken genom konstanten `IMPORTORSAK = 'avtal'`, som `sattBaseline` skriver på varje version (Story 2.1). Köpostens indata är fortfarande exakt `{ contract_id, kontraktstext }`.
       - *Signalen:* `koaTillagget` skriver köpostens `change_reason`. Med Davids ord blir den `Tillägg: <orden>` (Story 1.9, oförändrat). Utan dem blir den `signalorsak(fras)`, alltså `Tillägg: signalfrasen ”<frasen>”`, ur den låsta signalraden. En fras som är tom efter trimning ger 400 `orsak_saknas` och ingen påhittad orsak.
       - *Övrigt-raden:* `byggTillaggsindata` skriver `ovrigtorsak(text, datum)` (Story 1.14, oförändrat).
     - **David läser orsaken i förslaget.** Den rena funktionen `versionsorsak(atgard, input)` ger orsaken som ett ja registrerar. `orsaksmening(orsak)` gör den till meningen `Versionen får orsaken ”<orsak>”.`, eller `Orsaken saknas i förslaget.` när den saknas. `beskrivBaselineandring` och `beskrivOvrigtBeslut` lägger meningen sist i `ja_registrerar`, före `BESLUTSRADEN`, för varje post vars ja skriver en ny version: `satt_baseline`, `andra_baseline` (båda slagen) och `upsert_contract_part` utom ren takbekräftelse. Posten visas i undantagsvyn i fältet ”Ditt svar registrerar” (`undantagsvyn.ts:372`), och samma text fryses i beslutsradens `underlag.ja_registrerar` (`uppdragBeslut.ts:129`).
     - **Ingen inmatning vid godkännandet.** `POST /approvals/:id/approve` tar bara `{}` (`http/routes/actions.ts:61`). `approveAction` har inget indatafält, och verkställigheten skriver köpostens `change_reason`, för importen `IMPORTORSAK`, genom `skrivBaselineversion`.
     - **Fall:**
       - N1–N4: de rena reglerna.
       - F1 och F2: importen.
       - F3: ett direkt förslag.
       - F4: en post utan ny version.
       - F5 och F6: Övrigt.
       - S1–S3, S5 och S6: signalen, i REST och i vyn.
       - H2: godkännandet tar inget indata.

3. **Given** tre godkända ändringar efter version 1
   **When** historiken läses
   **Then** finns fyra läsbara versioner, var och en med sin orsak.
   - **Mätbart:**
     - **Mekanism:** historiken är läsåtgärden `get_contract_usage`, i REST och MCP ur samma `getContractUsage` → `forbrukningForAvtal`. Svarets `parts[].versions[]` bär varje lagrad version av koden med `valid_from` och `change_reason`. Uppgift 4 lägger till `start_date`, `end_date` och `date_precision`, så att en version som ändrade ett datum också går att läsa i sak. B-7 gör att ingen version skrivs över, så alla står kvar. Visningen av historiken på kontraktsytan hör till Story 6.4.
     - **Fall H1:** på ett v3-uppdrag får L1 tre godkända ändringar ur tre källor: ett direkt förslag av människan, ett tillägg ur en signal utan egna ord och ett förslag med agentens token. `versions` för L1, sorterade på `valid_from`, är då exakt fyra. Orsakerna är `avtal`, människans text, `Tillägg: signalfrasen ”kan ni även lägga till en workshop”` och agentens text, ingen är `null`, och varje version bär sina egna datum.

4. **Given** ett avslag
   **When** det registreras
   **Then** är gällande baseline orörd, och avslaget syns i historiken med förslaget.
   - **Mätbart:**
     - **Mekanism, oförändrad (Story 1.7):** nej går `avboj_beslutsforslag` → `rejectApproval` → `avvisaGodkannande` → `vidAvslag` → `registreraNej`. Det skriver bara `uppdrag_beslut` med fryst underlag, alltså `forslagstext`, köpostens `indata` med `change_reason` och, efter uppgift 2, `ja_registrerar` med orsaken. `las_uppdragslage` läser raden (`beslut.registrerade`), och Lägets panel ”Beslut och utkast” visar Nej med förslagstexten.
     - **Fall H4:**
       - Ett förslag om eget datum för L1 avslås.
       - `contract_parts` är lika före och efter, och L1 har kvar en version.
       - Planen visar L1 med `data-arvd`.
       - Beslutsraden har `utfall = 'nej'`, Davids skäl, förslagets text med kod, datum och intervall, den föreslagna orsaken och `orsaksmening` av den.
       - Läget visar förslagstexten.

5. **Given** David vill sätta ett eget datum på en leverabel
   **When** det görs
   **Then** sker det bara genom `andra_baseline` via kön, och efter godkännandet bär leverabeln eget datum med precision medan den tidigare versionen är läsbar
   **And** det finns ingen annan skrivväg som sätter ett leverabeldatum.
   - **Mätbart:**
     - **Mekanism:**
       - (a) `contract_parts` har en enda INSERT, i `skrivBaselineversion`, och en enda UPDATE, `bekraftaTak`, som bara rör `cap_confirmed`. Triggern i 0079 fryser lagrade rader.
       - (b) `skrivBaselineversion` anropas från exakt fyra ställen. `andra_baseline` är vägen. `upsert_contract_part` fälls av zod-regeln `kravAndraBaselineForLeverabeldatum` före kön, med 400 `validation_error`, så snart koden är en leverabelkod och indatat bär `start_date`, `end_date` eller `date_precision`. `sattBaseline` ger leverablerna NULL 
```

## Utfall
Tester: 164 passed (164) · Granskning: GODKANT | Alla fem acceptanskriterier finns i koden och prövas av den nya provfilen och de omskrivna proven, och alla kryssade uppgifter är gjorda; det som återstår är tre LOW-fynd. · Byggforsok: 1

## Modellkedja (Davids krav 17/8, reservvag 7/9)

* krav: **claude-opus-5-5**
* utveckling: **claude-opus-5-5**
* granskning: **claude-opus-5-5 (Codex spärrat — Davids regel 12/10; Codex granskar i efterhand)**

Granskaren ar inte forfattaren: claude-opus-5-5 (Codex spärrat — Davids regel 12/10; Codex granskar i efterhand) granskade claude-opus-5-5s arbete.

Allt pa Davids abonnemang - inga API-tokens.
