# PRD-bygget redovisningen 1-12-ingen-vyknapp-eller-transportrutt-kor-en-kanslig-atgard-forbi-kon — PRD redovisningen 1-12-ingen-vyknapp-eller-transportrutt-kor-en-kanslig-atgard-forbi-kon: # Story 1.

Datum: 2026-11-20 22:50 · Branch: cto/prd-redovisningen-1-12-ingen-vyknapp-eller-transportrutt-kor-9307 · Kalla: 02-Områden/hermes/prd/redovisningen-1c-prd.md (fryst 29/9, Davids beslut #194)

## Mal
PRD redovisningen 1-12-ingen-vyknapp-eller-transportrutt-kor-en-kanslig-atgard-forbi-kon: # Story 1.12: Ingen vyknapp eller transportrutt kör en känslig åtgärd förbi kön Status: ready-for-dev <!-- Skapad av cre

## PRD-kravet (ordagrant ur den frysta PRD:n) och astras kodgranskning
```
# Story 1.12: Ingen vyknapp eller transportrutt kör en känslig åtgärd förbi kön

Status: ready-for-dev

<!-- Skapad av create-story (BMAD v6.0.1, #yolo) 2026-11-20. Validering: checklistan kördes för hand i steg 6, se Dev Notes «Validering». -->

Kodbas: redovisning. Krav: FR-38 (spärren bor i åtgärdslagret och gäller vyns alla ingångar; regeln på exakt ett ställe; utdelat ur Story 1.2 2026-11-20). Beror på: 1.2 (done) och 1.3 (done). Arkitektur: AD-1 och dess «Regel framåt». Underlag: correct-course-förslaget för Story 1.2 (2026-11-20), bilaga A, avstämd mot koden i kopian 2026-11-20.

## Story

As a David (ägare av Locollabs AB och den enda som säger ja eller nej i Att göra),
I want att ett prov som läser koden själv visar att ingen knapp i vyn och ingen transportrutt kör en känslig åtgärd utan mitt ja,
so that en ny knapp som bokför direkt fälls innan den når drift, också när ingen kommer ihåg att skriva ett prov för den.

## Förkrav

```förkrav
fil: server/test/vy-kansliga-knappar.test.ts ändras
fil: docs/STATUS.md ändras
fil: server/src/actions/registry.ts läses
fil: server/src/actions/execute.ts läses
fil: server/src/http/view/routes.ts läses
fil: server/src/http/view/auth.ts läses
fil: server/src/http/view/html.ts läses
fil: server/src/http/view/kontrakt.ts läses
fil: server/src/http/view/undantagsvyn.ts läses
fil: server/src/http/routes/invoices.ts läses
fil: server/src/http/routes/receipts.ts läses
fil: server/src/http/routes/accounting.ts läses
fil: server/src/http/routes/parties.ts läses
fil: server/src/http/routes/companies.ts läses
fil: server/src/http/routes/receiptFiles.ts läses
fil: server/src/http/middleware/authenticate.ts läses
fil: server/src/mcp/server.ts läses
fil: server/src/services/bokslut.ts läses
fil: server/src/services/voucherLinks.ts läses
fil: server/src/services/parties.ts läses
fil: server/src/services/accounting/vouchers.ts läses
fil: server/src/services/approvals.ts läses
fil: server/src/actions/dependencies.ts läses
fil: server/migrations/0006_chart_of_accounts_and_fiscal_years.sql läses
fil: server/src/db/tx.ts läses
fil: server/test/helpers.ts läses
fil: server/test/setup.ts läses
fil: server/test/globalSetup.ts läses
fil: server/test/bokslut.test.ts läses
fil: server/test/actions.test.ts läses
fil: server/test/uppdragsytan-godkannandevag.test.ts läses
fil: server/test/crm-cadence-merge-search.test.ts läses
fil: server/vitest.config.ts läses
fil: server/tsconfig.test.json läses
fil: server/package.json läses
fil: CLAUDE.md läses
fil: docs/ARKITEKTUR.md läses
fil: docs/project-context.md läses
fil: docs/MCP_ACTIONS.md läses
prov: vy-kansliga-knappar ändras GRÖN
tjanst: 127.0.0.1:5433 vitest kör alla prov mot den stående testdatabasen redovisning-vitest-pg
```

Blocket deklarerar filerna i repot, den enda vitest-sviten som ändras och testdatabasen. Berättelsen ändrar ingen produktionskod: den bygger ut provfilen som Story 1.3 skapade och skriver en post i sessionsloggen. Ingen migration, ingen rutt, ingen åtgärd och inget paket tillkommer.

Fem slag av rader står medvetet inte i blocket, med samma skäl som i Story 1.3 och 1.11, som båda blev done i den formen:
- **Inga `beroende:`-rader.** I kedjan cto läser förkontrollens K5 bara rotens manifest, som saknar `dependencies`, så varje paketrad blir RÖD. Paketen provet använder (vitest, supertest, express och pg) står redan i `server/package.json`.
- **Inga `kommando:`-rader.** K7 godtar bara git-läsformer, och kedjans utvecklarroll har inget skal (kedjans förmågor: `kommando` nej). Grindarnas körningar görs av kedjan efter utvecklaren.
- **Inga `kontrakt:`-rader.** K8 kräver ett Hermes-prov per kontrakt. Allt fallen förutsätter (rutter, funktioner, registret och tabellerna) finns i samma repo och prövas av sviten ovan.
- **Inga `kraver:`-rader.** Bygget kräver ingen förmåga som kedjan cto saknar. Ingen uppgift och ingen grind kräver `kommando`: en körning som inte kan göras skrivs «inte kört — {skälet}» och räknas aldrig som grön (Arbetsreglerna och Dev Notes, «Testkrav»).
- **Inga `namner:`-rader.** Inget av ordregelns fyra ord står i berättelsens text.

Baslinjen ur provvakten och skälet till att inga `prov: … berörs`-rader för Hermes-prov står i blocket finns i Dev Notes under «Baslinjen (provvakten)».

## Acceptance Criteria

Kriterierna står ordagrant som i epics.md (Story 1.12). Raderna *Mätbart (correct-course 2026-11-20)* är epics.md:s. Raderna *Mätbart (berättelsen)* säger vilken mekanism som gör kriteriet sant och vilken ändlig fallista provet prövar. Ingen rad ändrar ett kriteriums innebörd. Fallen heter VK1.1–VK4.2 och står alla i `server/test/vy-kansliga-knappar.test.ts`. Prefixet VK skiljer dem från Story 1.3:s fall V1.1 i samma fil.

Kriterium 1–4 delar epics.md:s första Given/When:

**Given** vy-POST-rutterna under `server/src/http/view/`
**When** provet `server/test/vy-kansliga-knappar.test.ts` hittar varje anrop till `runViewAction` eller `executeAction` under `server/src/http/view/`, slår upp åtgärdens känslighet i registret och postar som människa till varje rutt vars åtgärd är `sensitive`

1. **Then** svaret är en redirect till Att göra, ett väntande förslag finns och ingen verkan har uppstått i bokföringen före godkännandet

   *Mätbart (correct-course 2026-11-20):* **Verkan före godkännandet** mäts lika för varje rutt i falltabellen: redirect till exakt `/app/c/{bolag}/approvals`, exakt en ny väntande köpost av rätt åtgärd, oförändrat antal verifikat och exakt en ny auditrad för bolaget, `action.approval_requested`.

   *Mätbart (berättelsen):*
   - **Mekanismen** är en enda väg in. Varje vyrutt med en känslig åtgärd anropar `runViewAction` eller `executeAction`. Där köar `executeAction` varje åtgärd med `sensitivity === 'sensitive'` på rad 81 i `server/src/actions/execute.ts` utan att köra handlern, och importprovet (kriterium 3) visar att ingen fil under `server/src/http/` kan nå tjänstefunktionen direkt.
   - **Måttet** är hjälparen `provaKansligRutt`. Den mäter också antalet konton i bolaget, eftersom SIE-importens verkan är konton och verifikat (samma mått som Story 1.3:s V1.1).
   - **Svaret** är 302 eller 303. GDPR-rutterna svarar 303, alla andra 302.
   - **Fallistan:** de tretton rutterna i falltabellen `POSTFALL` (tolv nycklar, där `gdprAnonymizeRoute` har två rutter), i fallet VK4.2. Motprovet VK4.1 är en planterad express-rutt som bokför direkt.

2. **And** listan över rutter härleds ur källkoden och registret, inte ur en handskriven lista, och provet har en negativ kontroll: en planterad vyrutt som kör en känslig åtgärd direkt fälls

   *Mätbart (correct-course 2026-11-20):* **Härledningen** läser källtexten i varje .ts-fil under `server/src/http/view/` och registret `ACTIONS`. Enheten är ett anropsställe för `runViewAction(`, `executeAction(` eller `korTidsAction(`. Åtgärderna på stället är de citerade litteraler i argumenten som är namn i registret, annars litteralerna i det omslutande `viewRouter.post(`-blocket eller den omslutande namngivna funktionen. Anropsställen inuti vidarebefordrarna `runViewAction` och `korTidsAction` hoppas över. **Sluten form:** varje annan förekomst av de tre namnen är tillåten bara på en importrad, i en funktionsdefinition eller på en kommentarsrad (`//` eller `*` först); allt annat, till exempel ett alias, är ett fynd «okänd form». Mängden nycklar med en känslig åtgärd ska vara lika med provets falltabell.

   *Mätbart (berättelsen):*
   - **Mekanismen** är en sluten form. Varje förekomst av de tre namnen i en vykälla är antingen ett anropsställe, en importrad, en funktionsdefinition eller en kommentarsrad. Allt annat är ett fynd, så provet behöver aldrig känna igen en otillåten form.
   - **Falltabellen** `POSTFALL` är handskriven bara i sina formulär. Dess nycklar och åtgärder jämförs med härledningen (VK3.2), så en ny känslig vyknapp utan rad i tabellen fäller provet.
   - **Fallistan:** VK3.1 (ett planterat alias), VK3.2 (dagens vykällor, inga fynd och nycklarna lika med `POSTFALL`), VK3.3 (et
```

## Utfall
Tester: 187 passed (187) · Granskning: GODKANT | Alla sex acceptanskriterier är implementerade enligt berättelsens avgränsningar; inga fynd, och kedjans 187 tester är godkända. · Byggforsok: 1

## Modellkedja (Davids krav 17/8, reservvag 7/9)

* krav: kordes inte
* utveckling: **gpt-6.1-sol**
* granskning: **gpt-6-astra**

Granskaren ar inte forfattaren: gpt-6-astra granskade gpt-6.1-sols arbete.

effort (Davids beslut 20/10): create-story high · validering high — planeringssteg
Allt pa Davids abonnemang - inga API-tokens.
