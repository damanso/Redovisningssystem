# PRD-bygget uppdragsytan 1-18-forsta-leveransens-kedja-provas-som-ett-forlopp — PRD uppdragsytan 1-18-forsta-leveransens-kedja-provas-som-ett-forlopp: # Story 1.18: Första leverans

Datum: 2026-10-16 04:58 · Branch: cto/prd-uppdragsytan-1-18-forsta-leveransens-kedja-provas-som-et-9217 · Kalla: 02-Områden/hermes/uppdragsytan-1c-prd.md (fryst 29/9, Davids beslut #194)

## Mal
PRD uppdragsytan 1-18-forsta-leveransens-kedja-provas-som-ett-forlopp: # Story 1.18: Första leveransens kedja provas som ett förlopp Status: ready-for-dev <!-- Note: Validation is optional. R

## PRD-kravet (ordagrant ur den frysta PRD:n) och astras kodgranskning
```
# Story 1.18: Första leveransens kedja provas som ett förlopp

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

<!-- Kodbas: redovisning. Epic 1 (Undantagsvyn), första leveransens slutprov. Beror på: Story 1.5, 1.8, 1.9, 1.10, 1.11, 1.13, 1.16 och 1.17 (epics.md rad 1500). Redovisningsberättelserna vars kod provet anropar är mergade enligt sina byggjournaler i docs/byggen/ (1.4–1.11 och 1.14–1.16). 1.13 och 1.17 är Hermes-berättelser: provet anropar inte deras kod, utan bygger på svepkontraktet ovrigt_forslag (Story 1.14), som 1.17 fyller, och på predikatet MOTTAGET_EJ_VERKSTALLT, som 1.13:s driftprov läser. Ingen migration, inget nytt paket, ingen ny env, ingen ny åtgärd och ingen ändring i server/src. Våg 13 i parallelization-analysis.md rad 431–438. -->
<!-- Story key: 1-18-forsta-leveransens-kedja-provas-som-ett-forlopp · Story ID: 1.18 · Skapad 2026-10-15 med BMAD create-story i autonomt läge (YOLO). Arbetskatalogen bar 1.16:s kod (byggjournalen för 1.16 och migration 0084 finns); radnumren i Dev Notes → ”Läget i dag” är lästa där. -->

## Story

As a David,
I want att hela vägen från min Övrigt-rad till ett registrerat ja eller nej provas som ett sammanhängande förlopp, tillsammans med första leveransens övriga beslutade posttyper,
so that första leveransen är bevisad och inte bara delvis byggd.

**Krav:** FR-41 (acceptanskedjan (1)–(5)), FR-40, FR-42, FR-4, FR-7 och FR-15 (första leveransens beslutade posttyper), NFR-3 och PRD avsnitt 6 (första leveransens acceptans). Källan är `epics.md` rad 1496–1560 (Story 1.18). PRD:ns lydelse står i FR-40 (`prd.md` rad 850–869, acceptansen rad 856–863), FR-41 (rad 871–885, kedjan (1)–(5) på rad 879), FR-42 (rad 887–897) och avsnitt 6 (rad 1035–1045, avgränsningen av första leveransen rad 1045).

Arkitekturens grund (`_bmad-output/planning-artifacts/architecture.md`):
- B-2 (rad 401–416): mottagandet skilt från verkställigheten, återförsöket och ”ersättning är inget beslut”;
- B-3 (rad 446–516): undantagsvyn, postslagen, tabellen över identitet, val, åtgärd, spärr och utfall (rad 470–476), och täckningen (rad 480–497);
- B-4 (rad 678–719): ILT-kedjans fyra led, särskilt punkt 4 ”Aldrig igen” (rad 715–719) med meningen ”Ett fel efter verkställigheten men före svaret till klienten ger 409 vid upprepning och exakt en handling”;
- B-5 (rad 721–738): utkastet i beslutsraden och utskicksgränsen;
- B-6 (rad 740–749): varje kostnadsbindning går genom kön, också till en ström;
- B-10 (rad 551–565): driftposten och `beslutsverkstallning.py`;
- genomförandeordningen punkt 10 (rad 780): ”Första leveransens acceptans är FR-41:s kedja (1)–(5) mot en verklig Övrigt-rad, tillsammans med de övriga beslutade posttyperna (1.14–1.18). Finns ingen verklig rad är utfallet KUNDE_INTE.”;
- besluten under Utvecklingsflödet om redovisningsberättelser i byggkedjan (rad 1361–1374), om ett förslag som svepet köar (rad 1385), om diffen (rad 1387) och om att beroendet ska vara mergat (rad 1388).

**Läget efter Story 1.16, i en mening.** Varje led i kedjan finns och är provat för sig — Övrigt-raden (0073, `skriv_uppdragsanteckning`), kandidaten och förslagssteget i svepet (1.14), undantagsvyn och dess formulär (1.11), ja på tillägg och ”ryms”, kompletteringen och ersättningen (1.15), nejet med utkastet (1.16), mottagandet och återförsöket (1.4, 1.7), spärren mot direktbindning (1.8), scopeavgörandet (1.9) och den begärda bedömningen (1.10) — men inget prov kör dem som ett förlopp genom vyn, och ett fel efter verkställigheten men före svaret till klienten är inte provat alls (P6 (d) och P9 (c)–(d) i `uppdragsytan-beslut.test.ts` prövar bara en upprepning efter ett lyckat svar).

**Vad berättelsen gör.** Den skriver första leveransens slutprov. Ingen fil i `server/src` ändras.
1. **Riggen (Task 1, 2, 3 och 5).** Den nya filen `server/test/kedjaRigg.ts` kör kedjan som David och Hermes gör: David skriver förfrågan genom vyn (Uppdrag → Uppdragens läge → ILT → Läget → panelen Övrigt), Hermes körning gör det första anropet, formulerar och gör det andra anropet, och David svarar i undantagsvyn. Riggen läser kedjans läge per källa.
2. **Kedjan (Task 1–3).** Nya describe-block P13–P18 sist i `server/test/uppdragsytan-beslut.test.ts` prövar steg (1)–(5), körningen, kompletteringen och felet mellan mottagandet och verkställigheten.
3. **Felet efter verkställigheten (Task 4).** P19 planterar ett tekniskt fel efter verkställigheten men före svaret. Det görs med husets mönster `vi.hoisted` och `vi.mock` med `importActual`, med `uppdragsytan-godkannandevag.test.ts` rad 18–52 som förlaga.
4. **Övriga posttyper och frånvaroprovet (Task 5).** P20 låter David avgöra en baselineändring, en kostnadsbindning till en ström, en tänd scopesignal och en begärd bedömning genom vyn. I samma bolag ger sedan ett rutinstatusbyte, en frisk period och ett tekniskt fel noll poster.
5. **Dokumentationen (Task 6).** En post i sessionsloggen i `docs/STATUS.md`. Den säger bland annat att acceptansen mot en verklig Övrigt-rad har utfallet KUNDE_INTE i kopian.

**Vad berättelsen inte gör:**
- ingen ändring i `server/src`, ingen migration, ingen ny åtgärd och inget nytt paket. Visar ett fall att ett led inte håller, är det ett fel i ledets berättelse och skäl för HALT, aldrig för en rättelse här (Dev Notes → ”Byggrinden”);
- ingen ändring i `hermes/` och ingen körning av Hermes kod: Hermes roll i kedjan spelas av riggen, i svepkontraktets form (Story 1.14 och 1.17);
- ingen verifiering mot driftens data. Kriterierna i `epics.md` om `/verify` mot en verklig Övrigt-rad är kontroller i drift och står ordagrant under Dev Notes → ”Kedjan kontrollerar i drift”;
- ingen Gmail-placering av utkastet (Davids svar 2026-10-07; ingen berättelse finns, Frågor till David).

**Bygge och grind.** Byggkedjan bygger berättelsen i en kopia, en gren i redovisningens repo, och driftsätter först efter godkänd code-review (Dev Notes → ”Byggkedjan”).
- Berättelsen bygger på kod ur 1.4–1.16. Förutsättningen före Task 1 prövar att den är mergad, belagt med byggjournalerna, och att kopian inte bär rester av ett tidigare bygge av den här berättelsen.
- Varje uppgift och varje acceptanskriterium prövas i kopian före driftsättningen, med fallen i Dev Notes → ”Prov och verifiering”.
- Varje uppgift skriver sina egna fall. Fallen beläggs röda innan riggens kod för uppgiften skrivs och gröna efteråt.
- Med skal görs det med vitest och inklistrad utdata. Utan skal skriver du ”inte kört i sessionen: <skälet>” och det förutsagda utfallet i Debug Log och lämnar uppgiften till granskning utan HALT (`architecture.md` rad 1361–1374, punkt 3).
- Grindarna `npm run typecheck` och `npm test` kör kedjan efter dig och före granskningen, och deployen kör bygget. Ingen ruta ber dig köra en grind.

## Acceptance Criteria

Kriterierna 1–8 är ordagranna ur `epics.md` (Story 1.18, rad 1506–1551). Raderna under *Mätbart* anger hur kriteriet prövas i den här kodbasen och lägger inte till några krav. Två slags rader förekommer:
- **Mekanism:** det som gör ett ”aldrig”, ett ”ingen”, ett ”exakt en” eller ett ”varje” sant genom konstruktion, till exempel en enda skrivväg, ett lås, ett unikt index eller en sluten lista.
- **Fallista:** den ändliga lista som provet prövar. Inget prov letar efter ”varje form” av ett fel i koden eller i fri text.

Epics-kriterierna om `/verify` mot en verklig Övrigt-rad (`epics.md` rad 1553–1560) är kontroller i drift. De står ordagrant under Dev Notes → ”Kedjan kontrollerar i drift” och är varken uppgifter eller kriterier för utvecklaren (uppdragets regel om kontroller i drift, med Story 1.12 rad 51–53 som förlaga).

Allt nedan prövas i kopian. Fallens namn (P13 (a) och så vidare) och filerna de står i finns i Dev Notes → ”Prov och verifiering”.

1. **Kedjan (1)–(3c) körs i ordning mot ett syntetiskt ILT-avtal.**
   **Given** provet `uppdragsytan-beslut.test.ts` med ett syntetiskt ILT-avtal, märkt syntetiskt
   **When** kedjan k
```

## Utfall
Tester: 161 passed (161) · Granskning: GODKANT | Alla åtta kriterier är implementerade och prövas i P13–P20, som ingår i kedjans gröna körning (161/161). Berättelsen har inget avsnitt «Review Follow-ups (AI)» från förra varvet att pröva. D · Byggforsok: 2

## Modellkedja (Davids krav 17/8, reservvag 7/9)

* krav: kordes inte
* utveckling: **claude-opus-5-5**
* granskning: **claude-opus-5-5 (Codex spärrat — Davids regel 12/10; Codex granskar i efterhand)**

Granskaren ar inte forfattaren: claude-opus-5-5 (Codex spärrat — Davids regel 12/10; Codex granskar i efterhand) granskade claude-opus-5-5s arbete.

Allt pa Davids abonnemang - inga API-tokens.
