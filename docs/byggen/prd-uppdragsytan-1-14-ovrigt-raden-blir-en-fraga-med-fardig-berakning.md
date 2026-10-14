# PRD-bygget uppdragsytan 1-14-ovrigt-raden-blir-en-fraga-med-fardig-berakning — PRD uppdragsytan 1-14-ovrigt-raden-blir-en-fraga-med-fardig-berakning: # Story 1.14: Övrigt-raden bl

Datum: 2026-10-14 22:39 · Branch: cto/prd-uppdragsytan-1-14-ovrigt-raden-blir-en-fraga-med-fardig--9210 · Kalla: 02-Områden/hermes/uppdragsytan-1c-prd.md (fryst 29/9, Davids beslut #194)

## Mal
PRD uppdragsytan 1-14-ovrigt-raden-blir-en-fraga-med-fardig-berakning: # Story 1.14: Övrigt-raden blir en fråga med färdig beräkning Status: ready-for-dev <!-- Note: Validation is optional. R

## PRD-kravet (ordagrant ur den frysta PRD:n) och astras kodgranskning
```
# Story 1.14: Övrigt-raden blir en fråga med färdig beräkning

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

<!-- Kodbas: redovisning. Epic 1 (Undantagsvyn). Beror på: Story 1.7 och 1.11 (båda done i sprint-status.yaml, och deras kod finns i arbetskopian: 0080 och http/view/undantagsvyn.ts). Byggvillkoren K-8 (1.1) och KRAV-13 (1.2) står i done. Ingen migration, inget nytt paket och ingen ny env. Våg 10 i parallelization-analysis.md rad 410–414. -->
<!-- Story key: 1-14-ovrigt-raden-blir-en-fraga-med-fardig-berakning · Story ID: 1.14 · Skapad 2026-10-13 med BMAD create-story i autonomt läge (YOLO). Rättad 2026-10-13 med correct-course efter två byggförsök utan godkänd code-review, och rättad igen samma dag efter bygge #9202, som utvecklaren stoppade med HALT. Rättad en tredje gång 2026-10-14 efter andra granskningen i drift (post 64): berättelsen stod done efter bygge #9204, men ingen av dess filer fanns i main eller i drift. Förslaget: _bmad-output/planning-artifacts/sprint-change-proposal-1-14-ovrigt-raden-blir-en-fraga-med-fardig-berakning.md. -->

## Story

As a David,
I want att en förfrågan jag skrivit i Övrigt och markerat som utanför avtalet kommer tillbaka som en enda fråga med avtalsdelar, taxa, förbrukning och belopp uträknade,
so that jag inte sorterar rader, letar villkor eller räknar själv.

**Krav:** FR-41 punkt (1), (2) och (4), FR-40, FR-22 (ofullständigt, aldrig falskt tomt), FR-26 och FR-4. Källan är `epics.md` rad 1226–1293 och raden *Mätbart* under Story 1.14.

Arkitekturens grund:
- B-4 (`architecture.md` rad 678–720: ”Kandidat”, ”Förslag, i samma körning”, ”Beslut” och ”Aldrig igen”);
- B-1 och B-2 (rad 274–417), åtgärdstabellen (rad 418–433) och B-3:s två tabeller (rad 446–475);
- formatmönstren för källreferens och fryst underlag (rad 886–921), kommunikationsmönstren (rad 923–957) och processmönstret för validering (rad 991);
- besluten om grindarna i byggkedjan (rad 1361–1374) och om förslag som svepet köar (”Redovisningsberättelser: ett förslag som svepet köar går alltid att avgöra”, Utvecklingsflödet).

PRD:ns lydelse finns i FR-40 (`prd.md` rad 850–869) och FR-41 (rad 871–885), särskilt kedjans punkt (1), (2) och (4) på rad 879.

**Läget i dag, i en mening.** En Övrigt-rad med `utanfor_avtal = true` gör redan svepets täckning för `ovrigt` till `fel` och undantagsvyn ofullständig (Story 1.6 och 1.7). Men ingenting gör raden till en fråga:
- svepet tar inte emot något förslag;
- arbetslistan nämner inte raden;
- `POSTSLAG` saknar slaget;
- `andra_baseline` godtar bara källan `scopesignal`;
- åtgärden `registrera_uppdragsbeslut` finns inte.

**Vad berättelsen gör.**
1. **Beräkningen som ren regel.** `lib/beslutsunderlag.ts` får Övrigt-förslagets regler:
   - timmar × taxa i ören med `domain/money.ts`;
   - återstående utrymme mot delens tak eller det nya taket;
   - orsaken till ett tillägg och den nya versionens startdatum (`giltigFran`);
   - förslagstexten och det frysta underlagets schema (`OvrigtUnderlagSchema`).

   Byggaren `byggOvrigtUnderlag` kastar aldrig, eftersom hela kroppen står i en `try` som ger `{ ok: false }`. Ett underlag som inte går att bygga ger alltså `{ ok: false }`. Inget i filen läser databasen.
2. **Kandidaterna i arbetslistan.** Svepet läser varje markerad Övrigt-rad i bolagets öppna avtal som saknar köpost och beslutsrad, också när avtalet saknas i Hermes indata. Raderna lämnas i `arbetslista.ovrigt_kandidater` (id, avtal, text, datum). Köposten och beslutsraden räknas bara när de hör till radens eget avtal.
3. **Postslaget `ovrigt_beslut`.** Läsvägen `lasUndantag` får slaget, som är en väntande `registrera_uppdragsbeslut` eller en väntande `andra_baseline` med `kalla.typ = anteckning`.
   - Posten beskrivs ur köpostens frysta underlag och Övrigt-raden. Den är en fråga med beräkning, inte en rå rad.
   - En köpost blir ingen post när dess indata inte går igenom åtgärdens eget schemaobjekt (`OVRIGT_SCHEMA`) eller när Övrigt-raden inte är en markerad rad i postens avtal. Den står då i `hoppade` med orsaken `underlag_ogiltigt`.
4. **Åtgärderna.**
   - `andra_baseline` godtar källan `{typ: 'anteckning', id}` och fältet `beslutsunderlag`.
   - Den nya åtgärden `registrera_uppdragsbeslut` (`sensitive`, `tvafas`) registrerar ”ryms” utan att röra avtalet. Den står i `MANDATATGARDER` med beslutsradens kontrakt från Story 1.7 (Beslutslogg punkt 3).
   - Båda åtgärdernas indatascheman och tabellen `OVRIGT_SCHEMA` över dem bor i den nya rena filen `lib/avtalsdelsfalt.ts`. Registret, läsvägen och svepet prövar därmed mot samma schemaobjekt.
5. **Skydden runt köposten.**
   - `executeAction` avvisar båda formerna med 409 `koas_av_svepet` före kön, med den deklarativa kontrollen `koasAvSvepet`, som är byggd i samma form som `kraverNyVersion`.
   - Tilläggets verkställighet prövar Övrigt-raden, som ryms gör.
   - Auditraden för en ny avtalsdelsversion bär inte längre `change_reason` (lärdom 10).
6. **Förslagssteget i svepet.** Svepet tar emot det valfria fältet `ovrigt_forslag[]`.
   - Varje förslag prövas mot egna tabeller, och underlaget räknas.
   - Köpostens indata prövas mot åtgärdens eget schema.
   - Därefter köas `andra_baseline` (tillägg) eller `registrera_uppdragsbeslut` (ryms) med `createApproval` och `actor: agent`, en gång per Övrigt-rad.
   - Avvisade förslag redovisas i svaret med en orsak ur en sluten lista. Raden står då kvar som kandidat med täckningen `fel`.
7. **Vyn.** Undantagsvyns post visar förfrågan, avtalsdelarna, timpriset, förbrukningen, timmarna eller det tomma timfältet, beräkningen, det återstående utrymmet och scopelinjerna. Den har Ja och Nej med skäl, som de andra köburna posterna. Mobilprovet omfattar slaget.
8. **Dokumentationen.** `docs/MCP_ACTIONS.md`, `docs/ARKITEKTUR.md` (också tabellen över postslag) och `docs/STATUS.md` följer med, liksom Lägets mening om vad markeringen leder till.

**Vad berättelsen inte gör** (gränsen står i Dev Notes → ”Gränsen mot Story 1.15–1.18”):
- **Ingen komplettering och inget ”ändrat sedan förslaget”.** `komplettera_beslutsforslag`, kolumnen `ersatt_av` (migration) och omräkningen vid visningen hör till Story 1.15.
- **Inget nej-utkast.** `utkast`, `utkast_markor` på beslutsraden och `mailto:`-länken hör till Story 1.16. Ett nej i den här berättelsen skriver nej-raden med skäl och fryst ekonomi genom den befintliga vägen från Story 1.7, utan utkast.
- **Inget löfte om läget efter kön.** Berättelsen prövar avtalsdelen, versionen och raden när förslaget köas. Om en annan version av samma kod godkänns medan tillägget väntar gäller husets befintliga regel:
  - ja godkänner det lagrade förslaget;
  - skillnaden visas som ”ändrat sedan förslaget” i Story 1.15;
  - ett fel i verkställigheten efter mottagandet står kvar för återförsök och blir en driftpost (`architecture.md` B-4 punkt 4, Story 1.4 och 1.13).

  Dev Notes → ”Gränsen efter kön” har detaljerna.
- **Ingen formulering.** Hermes formulerar förslaget i Story 1.17. Redovisningen tar emot det och räknar själv belopp och taxa.
- **Ingen ändring i `hermes/`.** Ett bygge, en kodbas.
- **Ingen migration, ingen ny tabell, inget nytt paket och ingen ny env.** Köposten är förslaget (ADR-6b), och `uppdrag_beslut.alternativ` finns sedan 0080.
- **Kärnan ändras bara på en punkt.** `executeAction` får kontrollen `koasAvSvepet` före kön, i samma form som `kraverNyVersion` (Task 4). `approveAction`, `rejectApproval`, `verkstallBeslut`, `verkstallMottagnaBeslut`, `createApproval`, `listApprovals` och `listaVantandeKoposter` står som de är.
- **`services/contracts.ts` ändras bara på en rad.** Auditraden i `skrivBaselineversion` slutar bära `change_reason` (Task 4).

**Bygge och grind.** Byggkedjan bygger berättelsen i en kopia, en gren i redovisningens repo, och driftsätter först efter godkänd code-review (Dev Notes → ”Byggkedjan”).
- Varje uppgift och varje acceptanskriterium prövas i kopian före driftsättningen, med fallen i D
```

## Utfall
Tester: 158 passed (158) · Granskning: GODKANT | Alla tretton acceptanskriterier och alla 30 kryssade uppgifter är gjorda och har prov i kedjans gröna körning (158 av 158); det som återstår är tre LOW-fynd. Diffen var klippt efter `lib/avt · Byggforsok: 1

## Modellkedja (Davids krav 17/8, reservvag 7/9)

* krav: kordes inte
* utveckling: **claude-opus-5-5**
* granskning: **claude-opus-5-5 (Codex spärrat — Davids regel 12/10; Codex granskar i efterhand)**

Granskaren ar inte forfattaren: claude-opus-5-5 (Codex spärrat — Davids regel 12/10; Codex granskar i efterhand) granskade claude-opus-5-5s arbete.

Allt pa Davids abonnemang - inga API-tokens.
