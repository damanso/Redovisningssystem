# PRD-bygget uppdragsytan FR-1 — PRD uppdragsytan FR-1: FR-1 | Systemet lagrar ett uppdrag som rad kopplad till redovisningens `proje

Datum: 2026-10-06 07:25 · Branch: cto/prd-uppdragsytan-fr-1-9161 · Kalla: 02-Områden/hermes/uppdragsytan-1c-prd.md (fryst 29/9, Davids beslut #194)

## Mal
PRD uppdragsytan FR-1: FR-1 | Systemet lagrar ett uppdrag som rad kopplad till redovisningens `projects`-entitet, med baseline härledd ur lever

## PRD-kravet (ordagrant ur den frysta PRD:n) och astras kodgranskning
```
MAL | `importera_leveranskontrakt` läser det frysta v3-kontraktet ordagrant: period, ram, fyra steg och sex leverabler med placering. Med `kontrakt_tillstand: fryst` läggs baseline version 1 som ETT förslag i godkännandekön. Ett utkast ger bara en förhandsvisning och skriver ingenting. När David godkänner skrivs baselinen: UPPDRAG med ytterdatum, STEG1–STEG4 med sina intervall och L1–L6 under sitt steg utan eget datum.
KALLA | PRD uppdragsytan (`02-Områden/hermes/uppdragsytan-1c-prd.md`, fryst 29/9, beslut #194) FR-1, med PRD-resan steg 4 (FR-1/FR-2/FR-4/FR-40) och DK-9. Astras kodgranskning gav FR-1 utfallet DELVIS (`server/src/services/uppdragImport.ts` rad 78–101, 240–274, 296–348; `server/src/lib/leveranskontrakt.ts` rad 297–405).
ARKITEKTUR | Ren parser i `lib/leveranskontrakt.ts`: texten är indata, ingen fil eller Drive läses, och saknat blir NULL i `saknade_falt`. Tjänsten i `services/uppdragImport.ts` körs under `withTenantTransaction`. Avtalsdelar skrivs bara via `upsertContractPart`. Köposten skapas från tjänsten med `createApproval` och auditraden `action.approval_requested`, som i `avgorSignal` (uppdragSignal.ts) och `bindSvepetsForslag` (uppdragKostnad.ts). Åtgärden är `def({ sensitivity: 'sensitive', inputSchema: z.object(...).strict() })` i `actions/registry.ts` och körs av `approveAction`. Att göra-kortet byggs via `explainApproval` (services/approvalSummary.ts). Belopp lagras i ören som heltal. Tester körs med vitest och supertest mot riktig Postgres.
KRAV-1 | `parseLeveranskontrakt` returnerar `kontrakt_tillstand` ('fryst' \| 'utkast' \| null) ur textens fältpar `kontrakt_tillstand:`. Bara exakt `fryst` räknas som fryst.
KRAV-2 | `faltkarta` (lib/leveranskontrakt.ts) delar en rad med flera `**Etikett:** värde` åtskilda av `·` i ett fältpar per led. `Ram` läses som takbelopp via `oren()` (v3 ger 47 300 000 öre). `Timmar` läses som takvolym via `timmar()`. De befintliga `Takbelopp`/`Takvolym` gäller fortfarande. Ett värde som inte går att tolka blir NULL och står i `saknade_falt`.
KRAV-3 | En ny ren funktion i lib/leveranskontrakt.ts läser fältet `Period` i svensk form (`1 sep till 31 dec 2026`; saknar startledet år gäller slutledets år) till `ram.start_date`, `ram.end_date` och `ram.date_precision` ('dag'). v3 ger 2026-09-01 och 2026-12-31. Går perioden inte att tolka blir fälten NULL och står i `saknade_falt`.
KRAV-4 | `parseLeveranskontrakt` läser leverabler också ur tabeller, utan att texten formateras om. En rad räknas när `Id`-cellen, eller annars `Leverabel`-cellen, är en kod `L1`–`L99`. Namnet tas ur `Leverabel` när cellen inte är en kod. I leverabeltabellerna matchas `Klausul`, `Acceptanskriterium` och `Uppföljningsmått` på en normaliserad rubrik som BÖRJAR med nyckeln, så att `Acceptanskriterium (förslag)` träffar. Raderna slås ihop per kod över tabellerna, och första förekomsten per fält vinner.
KRAV-5 | Kolumnen `Timmar` i en leverabeltabell ger `cap_hours`, eftersom rubriken bär enheten (`40` → 40). Rader utan leverabelkod (`-`, Summa) ignoreras.
KRAV-6 | Placeringstabellen (`Leverabel` = kod, `Ström` = stegkod) ger `strom_kod`. v3 ger L1 STEG1, L2 och L3 STEG2, L4 och L5 STEG3, L6 STEG4. Rubrikleverablerna (`### L1 — …` med fältpar) och fixturen `test/fixtures/leveranskontrakt-nvr-001.ts` läses som i dag.
KRAV-7 | `importeraLeveranskontrakt` parsar först. Är `kontrakt_tillstand` inte `fryst` returneras en förhandsvisning: `kontrakt_tillstand` och `forslag` med uppdragets datum och ram, stegen med intervall, leverablerna med `strom_kod` och `saknade_falt`. Då skrivs INGEN rad i contract_parts, uppdrag_leverabel, uppdrag_scopelinje, contracts eller action_approvals, inte heller via `koaRegisterkopia`, och det gäller också när avtalet saknar `signed_date`.
KRAV-8 | Är texten `fryst` och avtalet har `signed_date` skriver `importeraLeveranskontrakt` ingen avtalsdel. Den köar ETT förslag med `createApproval(…, actor, 'satt_baseline', { contract_id, kontraktstext })` och auditraden `action.approval_requested`, och returnerar `forslag` plus `approval_id`. Saknas `signed_date` gäller befintliga 400 `valid_from_required`. Registerhandlern skickar med `ctx.actor`.
KRAV-9 | Ny åtgärd `satt_baseline` i actions/registry.ts: `sensitive`, med `.strict()`-schemat `{ contract_id: UuidSchema, kontraktstext: safeText(200_000) }`. Handlern anropar `sattBaseline` i uppdragImport.ts, som är dagens skrivväg (a)–(g) inklusive `koaRegisterkopia` och auditraden `uppdrag.leveranskontrakt_importerat`, utbruten oförändrad. Åtgärden vägrar med 400 när textens `kontrakt_tillstand` inte är `fryst`.
KRAV-10 | I `sattBaseline` steg (a) får UPPDRAG `start_date`, `end_date` och `date_precision` ur `kontrakt.ram`, i stället för hårdkodat `null`. `lika()` och `saknadeFalt()` tar med de tre fälten.
KRAV-11 | Leverablerna skrivs under sitt stegs avtalsdel med `start_date`/`end_date` NULL, alltså med ärvt intervall som i dag. Varken importen eller `sattBaseline` sätter något leverabeldatum. Det görs bara via de redan känsliga `andra_baseline` och `upsert_contract_part`, och ett prov visar att en leverabels datum bara ändras efter godkännande.
KRAV-12 | `explainApproval` (services/approvalSummary.ts) beskriver `satt_baseline` ur `parseLeveranskontrakt(input.kontraktstext)`. `change` går från ”ingen baseline ur kontraktet” till uppdragets datum, stegen med intervall och varje leverabels steg. `why` säger att avtalets datum blir baseline v1 och att leverablerna ärver sitt stegs intervall. `source` är avtalet, med länk till `/projects/:projectId/kontraktet`.
KRAV-13 | Prov i `server/test/uppdragsytan-import.test.ts` med en ny fixtur, `server/test/fixtures/leveranskontrakt-nvr-001-v3.ts`. Fixturen är Drive-originalets v3-text ordagrant: speglingen `03-Resurser/kunddokument/Nordic Vision Retail/Leveranskontrakt-NVR-001-FRYST-v3-2026-09-07.md` från rad 14 till slutet. Provet går hela kedjan: `skapa_uppdrag` på befintligt projekt, `importera_leveranskontrakt` och godkännande via supertest. Dessutom ett utkastprov där samma text har `kontrakt_tillstand: utkast` och ingen rad skrivs.
KRAV-14 | Sviter som i dag sår baselinen genom `importera_leveranskontrakt` sår den i stället via förslaget och `approveAction`; en testhjälpare får samla det. v1-fixturen får raden `kontrakt_tillstand: fryst`. Produktionskoden får ingen genväg runt kön.
ACCEPTANS | NVR-001 kan skapas mot befintlig `projects`-post. Baseline version 1 bär uppdragets start- och slutdatum och det gällande kontraktets fyra steg med sina intervall — v3, fryst 2026-09-07: STEG1 31/8–13/9, STEG2 7/9–1/11, STEG3 26/10–20/12 och STEG4 1/9–31/12. Kontraktets sex leverabler ärver sitt stegs intervall: L1 STEG1, L2 och L3 STEG2, L4 och L5 STEG3, L6 STEG4. Stegens namn och intervall läses ur det frysta kontraktet; datumen ovan är provdata för NVR-001. Inget leverabeldatum finns som inte satts av David genom baselinebeslutet. Kontraktsuppgifter har inte matats in manuellt en andra gång.
AVGRANSNING | Bygget rör bara `lib/leveranskontrakt.ts`, `services/uppdragImport.ts`, `services/approvalSummary.ts`, `actions/registry.ts` (en ny def och `ctx.actor` till importen) samt testerna och fixturerna ovan. Inga migrationer och inga nya beroenden. Ingen ändring i `upsertContractPart`, triggrarna, `executeAction`/`approveAction`, Att göra-sidans markup, PRD:n eller valvets dokument (beslut #194). `.env` rörs inte.
uteslutet: härledd `matt_lasvag` (importformens `register`) — kallan kraver det inte
uteslutet: STYRNING-delen ur v3:s timtabell — kallan kraver det inte
uteslutet: scopelinjer och signalfraser ur v3:s sektion 5 — kallan kraver det inte
uteslutet: godkännare och eskalering ur v3:s prosa — kallan kraver det inte
uteslutet: en egen undantagsvy-sida (FR-40 läser befintlig godkännandekö) — kallan kraver det inte
uteslutet: förhandsvisning i webbvyn utöver åtgärdssvaret — kallan kraver det inte
uteslutet: spärr mot dubbla väntande `satt_baseline`-förslag — kallan kraver det inte
uteslutet: orsakstexten ”avtal” i stället för `
```

## Utfall
Tester: 143 passed (143) · Granskning: DELVIS | Bygget stöder utkast utan baselineskrivning, godkännandeförslag i Att göra och ärvda leverabelintervall, men acceptansen mot det verkliga NVR-001 v3-kontraktet är inte styrkt. · Byggforsok: 3

## Modellkedja (Davids krav 17/8, reservvag 7/9)

* krav: **claude-opus-5-5**
* utveckling: **gpt-6.1-sol**
* granskning: **gpt-6-astra**

Granskaren ar inte forfattaren: gpt-6-astra granskade gpt-6.1-sols arbete.

Allt pa Davids abonnemang - inga API-tokens.
