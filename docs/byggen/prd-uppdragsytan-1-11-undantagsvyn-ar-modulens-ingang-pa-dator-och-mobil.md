# PRD-bygget uppdragsytan 1-11-undantagsvyn-ar-modulens-ingang-pa-dator-och-mobil — PRD uppdragsytan 1-11-undantagsvyn-ar-modulens-ingang-pa-dator-och-mobil: # Story 1.11: Undantagsvyn

Datum: 2026-10-13 12:57 · Branch: cto/prd-uppdragsytan-1-11-undantagsvyn-ar-modulens-ingang-pa-dat-9199 · Kalla: 02-Områden/hermes/uppdragsytan-1c-prd.md (fryst 29/9, Davids beslut #194)

## Mal
PRD uppdragsytan 1-11-undantagsvyn-ar-modulens-ingang-pa-dator-och-mobil: # Story 1.11: Undantagsvyn är modulens ingång, på dator och mobil Status: ready-for-dev <!-- Note: Validation is optiona

## PRD-kravet (ordagrant ur den frysta PRD:n) och astras kodgranskning
```
# Story 1.11: Undantagsvyn är modulens ingång, på dator och mobil

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

<!-- Kodbas: redovisning. Epic 1 (Undantagsvyn). Beror på: Story 1.6, 1.7, 1.9 och 1.10 (alla done enligt sprint-status.yaml, och deras kod finns i arbetskopian, 0077–0082). Byggvillkoren K-8 (1.1) och KRAV-13 (1.2) står i done. Ingen migration, ingen ny åtgärd och inget nytt paket. Våg 9 i parallelization-analysis.md rad 405–409 har bara den här berättelsen i redovisningen. -->
<!-- Story key: 1-11-undantagsvyn-ar-modulens-ingang-pa-dator-och-mobil · Story ID: 1.11 · Skapad 2026-10-13 med BMAD create-story i autonomt läge (YOLO). -->
<!-- Correct-course 2026-10-13 (sprint-change-proposal-1-11-undantagsvyn-ar-modulens-ingang-pa-dator-och-mobil.md): bygget stoppades i Task 1.1 vid varje försök, eftersom kopians navigationskontrakt saknar ingångens destination och generatorn ligger utanför bygget. Förutsättningen och dess HALT-rad är borttagna. Menyn markerar kontraktets ägare till rutten, och menyposten ”Uppdrag” syns när generatorn har körts. Det kontrollerar kedjan efter synken. Kriteriernas lydelse är oförändrad. -->

## Story

As a David,
I want öppna Uppdrag och direkt se mina mandatfrågor med underlag och kunna avgöra var och en på det sätt den kräver, också från telefonen, och att menyn visar sidan jag står på även inne i ett uppdrag,
so that jag avgör frågorna där de kommer färdiga i stället för att leta upp dem.

**Krav:** FR-40, FR-21 (rutten, posten sist i `.nav__quick` och markeringen enligt NFR-8), FR-22, FR-4 (regeln i klartext), FR-7 (scopevalet i vyn), FR-15 och FR-16 (bedömningsvalet i vyn), FR-23 (besluten från mobilen), FR-35, NFR-2 och NFR-8 (också kanonändringen för markeringen på modulens befintliga objektsidor, som Hermes paritetsprov kräver före första leveransens slutprov). Källan är `epics.md` rad 1028–1144, med raden *Mätbart* på rad 1134–1144. Arkitekturens grund är B-3 (`architecture.md` rad 446–516), åtgärdstabellen (rad 420–433), kommunikationsmönstren (rad 925–957), processmönstren för fel och tomhet (rad 959–973), filorganisationen (rad 1302–1307) och beslutet om grindarna i byggkedjan (rad 1361–1374). PRD:ns lydelse: FR-21 (`prd.md` rad 708–718), FR-22 (rad 720–726), FR-23 (rad 728–734), FR-35 (rad 736–742), FR-40 (rad 850–869), NFR-2 (rad 939–945) och NFR-8 (rad 995–1001). UX-specifikationen §4.0 (`ux-design-specification.md` rad 125–160) och Del 3 (rad 89–119).

**Läget i dag, i en mening.** Läsvägen `lasUndantag` finns med fem postslag och täckning (Story 1.6 och 1.10), men ingen sida visar den: `GET /app/c/:companyId/uppdrag` är uppdragslistan (`routes.ts` rad 4481–4514), ingen post kan avgöras från en vy, och kanons huvudmeny markerar modulens objektsidor med `aria-current="location"` (`html.ts` rad 1659–1664).

**Vad berättelsen gör.**
1. **Kanonens markering.** `layout()` i `html.ts` får det valfria valet `markering: 'page'`, och `pageFor` i `routes.ts` för det vidare. Varje sida som bär uppdragets `.subnav` sätter valet, liksom undantagsvyn och listan. Övriga produkter renderas som förut.
2. **Ingången.** `GET /app/c/:companyId/uppdrag` blir undantagsvyn, renderad ur `lasUndantag` av den nya modulen `http/view/undantagsvyn.ts`. Uppdragslistan flyttar oförändrad i sak till `/app/c/:companyId/uppdrag/lista`. Menyn markerar på båda sidorna den destination som kontraktet anger som ägare till `GET /c/:companyId/uppdrag`. Den läses med den nya funktionen `ruttensAgare` i `http/view/kontrakt.ts`, så ingen kortform skrivs in i koden.
3. **Tre läslägen.** Verifierat tomt och ofullständigt underlag renderas med `.tomt`-grammatiken, och poster med alla sina fält, källor (Drive-länkar ur file-id), `--ai`-märkning och färskhet. Regeln om godkännande står i klartext i alla tre lägena.
4. **Formulären.** Varje postslag får sitt formulär enligt tabellen i AC 7: Ja och Nej med skäl för köburna poster, Innanför och Utanför för scope, och tre likvärdiga lägen för en begärd bedömning. En enda ny POST-rutt, `POST /app/c/:companyId/uppdrag`, tar emot dem genom en tillåtelselista och går till `approveAction`, `avboj_beslutsforslag`, `avgor_scopesignal` respektive `satt_bedomning`. Därefter skickas David till beslutets plats på Läget.
5. **Mobilen.** Varje länk och knapp i vyns innehåll får träffytan 44 px. Allt prövas i en riktig webbläsare med JavaScript avstängt på 390 px.
6. **Agentens läsväg.** Agentens GET-läsväg i vyn utökas med exakt `/uppdrag` och `/uppdrag/lista`, så att Hermes kan mäta undantagsvyn (Story 1.12).
7. **Dokumentationen.** `docs/ARKITEKTUR.md`, kanons egen beskrivning av menygrammatiken och `docs/STATUS.md` följer med.

**Vad berättelsen inte gör:**
- **Inget Övrigt-beslut, ingen komplettering och inget ”ändrat sedan förslaget”.** Postslaget `ovrigt_beslut` och dess formulär är Story 1.14–1.15 (`architecture.md` rad 473 och 505).
- **Inget tillägg från undantagsvyn.** Utanför avgörs utan tillägg, och ett tillägg läggs fortfarande på Signaler-sidan (Story 1.9). Postens källor länkar dit.
- **Läget ändras inte, utom länken ”← Uppdragen”.** Bandet och kortet för köposter pekar fortfarande på Att göra, och mandatfrågorna ur undantagsvyns läsväg på Läget är Story 6.2.
- **Uppdragslistans tomlägen ändras inte.** `.empty` står kvar där, och modulens övriga tomlägen är Story 6.3.
- **Kanons krom (huvudmenyn, kontoraden och sökrutan) ändras inte i storlek.** 44 px gäller vyns eget innehåll i `<main>` (Beslutslogg punkt 15). Story 6.5 håller tillgängligheten på resten av modulen.
- **Ingen ny åtgärd, ingen migration, inget nytt paket och ingen ny env.** Inget under `hermes/`.
- **Navigationskontraktet redigeras aldrig, och bygget väntar inte på generatorn.** Filen kommer ur generatorn (se nästa stycke).

**Navigationskontraktet i kopian är ingen förutsättning (correct-course 2026-10-13).** Menyposten ”Uppdrag” kan bara komma ur `server/kontrakt/navigation.v1.json`, och den filen genereras i Davids valv (`server/kontrakt/README.md` rad 6–9 och 22–23). Du kan inte köra generatorn, och du får aldrig redigera filen eller något i valvet (`docs/project-context.md` rad 76, och kedjans husregel ”Ändra aldrig PRD:n eller andra dokument i valvet”, `hermes/skills/cto_utveckling.py` rad 1007). Bygget sker med kontraktet som det står i kopian. Det har ett av två tillåtna lägen (Dev Notes → ”Navigationskontraktet: två tillåtna lägen”):
- **före synken**, som i dag: ingen destination har mallen `/app/c/:companyId/uppdrag`, och `projects_list` äger rutten;
- **genererat**: generatorn har lagt in ingången enligt K-a–K-e.

Koden är riktig i båda lägena. Menyn renderas ur kontraktet som förut, och undantagsvyn och listan markerar kontraktets ägare till rutten. Proven läser kontraktet och prövar läget det står i. Ett tredje läge, till exempel en halv handredigering, fälls. Att posten ”Uppdrag” faktiskt står sist i menyn syns först när generatorn har körts och kontraktet har synkats in i repot. Det kontrollerar kedjan efter synken (Dev Notes → ”Kedjan kontrollerar i drift”), och ingen uppgift väntar på det. Task 1.1 stannar därför aldrig på kontraktet (Beslutslogg punkt 2 och 28).

**Bygge och grind.** Byggkedjan bygger berättelsen i en kopia, en gren i redovisningens repo, och driftsätter först efter godkänd code-review (Dev Notes → ”Byggkedjan”). Varje uppgift och varje acceptanskriterium prövas i kopian före driftsättningen, med fallen i Dev Notes → ”Prov och verifiering”. Varje uppgift skriver sina egna fall och belägger dem röda innan koden skrivs och gröna efteråt. Med skal görs det med vitest och inklistrad utdata. Utan skal skrivs ”inte kört i sessionen: <skälet>” och det förutsagda utfallet i Debug Log, och uppgiften lämnas till granskning utan HALT (`architecture.md` rad 1361–1374, punkt 3). Grindarna `npm run typecheck` och `npm test` kör kedjan efter dig och före granskningen, och deployen kör bygget. Ingen ruta ber dig köra en grind (Dev
```

## Utfall
Tester: 157 passed (157) · Granskning: GODKANT | Alla 17 kriterier är implementerade och kedjans grön körning (157/157) täcker proven; berättelsen hade inga «Review Follow-ups (AI)» att pröva, omtagets typrättning finns på `uppdragsytan-un · Byggforsok: 2

## Modellkedja (Davids krav 17/8, reservvag 7/9)

* krav: **claude-opus-5-5**
* utveckling: **claude-opus-5-5**
* granskning: **claude-opus-5-5 (Codex spärrat — Davids regel 12/10; Codex granskar i efterhand)**

Granskaren ar inte forfattaren: claude-opus-5-5 (Codex spärrat — Davids regel 12/10; Codex granskar i efterhand) granskade claude-opus-5-5s arbete.

Allt pa Davids abonnemang - inga API-tokens.
