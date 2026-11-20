# PRD-bygget redovisningen 1-1-forslagskortet-visar-posten-i-klartext-utan-uuid-n — PRD redovisningen 1-1-forslagskortet-visar-posten-i-klartext-utan-uuid-n: # Story 1.1: Förslagskorte

Datum: 2026-11-20 13:46 · Branch: cto/prd-redovisningen-1-1-forslagskortet-visar-posten-i-klartext-9298 · Kalla: 02-Områden/hermes/prd/redovisningen-1c-prd.md (fryst 29/9, Davids beslut #194)

## Mal
PRD redovisningen 1-1-forslagskortet-visar-posten-i-klartext-utan-uuid-n: # Story 1.1: Förslagskortet visar posten i klartext, utan UUID:n Status: ready-for-dev <!-- Note: Validation is optional

## PRD-kravet (ordagrant ur den frysta PRD:n) och astras kodgranskning
```
# Story 1.1: Förslagskortet visar posten i klartext, utan UUID:n

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

Som David,
vill jag att varje förslag i Att göra säger vad det gäller, för vem, hur mycket, vad som ändras och vad som måste godkännas först, på svenska och utan tekniska id:n,
så att jag kan fatta ett säkert beslut på några sekunder utan att klicka vidare.

**Kodbas:** redovisning. **Krav:** FR-27 (kortets text och beroendet i vyn), med AD-8 inklusive «Kortmodellen» och UX K1. **Beror på:** inga. **Utdelat 2026-11-20 (correct-course):** kriteriet om bokslutets, SIE-importens och betalningsmottagarens postbeteckningar bärs av Story 1.10, och de fyra regressionskriterierna om kön och besluten bärs av Story 1.11. Båda bygger på kortmodellen härifrån. **Senare berättelser som bygger på kortet:** 1.10, 1.11, 1.5, 2.1 och 1.6. Det härledda etikettprovet i den här berättelsen fäller 1.5, 2.1 och 1.6 tills deras etiketter och uppslag finns.

## Förkrav

```förkrav
fil: server/src/services/approvalSummary.ts ändras
fil: server/src/http/view/routes.ts ändras
fil: server/src/http/view/html.ts ändras
fil: server/test/forslagskort-klartext.test.ts ny
fil: server/test/view-create-flows.test.ts ändras
fil: docs/STATUS.md ändras
fil: server/src/actions/registry.ts läses
fil: server/src/actions/dependencies.ts läses
fil: server/src/actions/execute.ts läses
fil: server/src/services/approvals.ts läses
fil: server/src/services/uppdragBeslut.ts läses
fil: server/src/services/uppdragUndantag.ts läses
fil: server/src/services/uppdragImport.ts läses
fil: server/src/services/vatDeclaration.ts läses
fil: server/src/services/crmSfar.ts läses
fil: server/src/services/sieImport.ts läses
fil: server/src/services/bokslut.ts läses
fil: server/src/http/routes/actions.ts läses
fil: server/src/mcp/server.ts läses
fil: server/src/lib/validation.ts läses
fil: server/src/lib/avtalsdelsfalt.ts läses
fil: server/src/lib/beslutsunderlag.ts läses
fil: server/src/db/tx.ts läses
fil: server/src/domain/money.ts läses
fil: server/kontrakt/navigation.v1.json läses
fil: server/test/helpers.ts läses
fil: server/vitest.config.ts läses
fil: server/package.json läses
fil: package.json läses
fil: CLAUDE.md läses
fil: docs/ARKITEKTUR.md läses
fil: docs/project-context.md läses
fil: docs/MCP_ACTIONS.md läses
prov: forslagskort-klartext nytt GRÖN
prov: view-create-flows ändras GRÖN
prov: ai-markning berörs GRÖN
prov: approval-dependencies berörs GRÖN
prov: usability-fixes berörs GRÖN
prov: view berörs GRÖN
prov: actions berörs GRÖN
prov: mcp berörs GRÖN
prov: bakvag berörs GRÖN
prov: import berörs GRÖN
prov: crm-provenance berörs GRÖN
prov: crm-design-parity berörs GRÖN
prov: crm-finish berörs GRÖN
prov: crm-status-link berörs GRÖN
prov: crm-sfar-3 berörs GRÖN
prov: crm-sandvag berörs GRÖN
prov: vat-declaration berörs GRÖN
prov: entity-links berörs GRÖN
prov: navigation berörs GRÖN
prov: hem-landningar berörs GRÖN
prov: typsnitt berörs GRÖN
prov: uppdragsytan-import berörs GRÖN
prov: uppdragsytan-import-v3 berörs GRÖN
prov: uppdragsytan-plan berörs GRÖN
prov: uppdragsytan-tillagg berörs GRÖN
prov: uppdragsytan-godkannandevag berörs GRÖN
prov: uppdragsytan-undantag berörs GRÖN
prov: uppdragsytan-undantagsvyn berörs GRÖN
prov: uppdragsytan-beslut berörs GRÖN
prov: uppdragsytan-utskick berörs GRÖN
prov: uppdragsytan-baselineorsak berörs GRÖN
prov: uppdragsytan-menyn berörs GRÖN
tjanst: 127.0.0.1:5433 vitest kör alla prov mot den stående testdatabasen redovisning-vitest-pg
```

Blocket deklarerar bara filer i repot och vitest-prov, alla GRÖNA. Varför raderna `beroende:`, `kraver:`, `kontrakt:`, `kommando:`, Hermes-proven och planeringsdokumenten saknas står i Dev Notes → Förkravsblocket och kedjan cto. Inget nytt paket tillkommer. Stacken (zod, pg, vitest, supertest och express) finns redan i `server/package.json`.

## Acceptance Criteria

Kriterierna står ordagrant som i planeringens epics.md (Story 1.1). Numreringen här är berättelsens egen. Kriterium 4 här var kriterium 5 före delningen 2026-11-20, och kriterium 5 här var kriterium 6. Raderna *Mätbart (berättelsen)* lägger till mekanismen och fallistan för de kriterier som lovar «aldrig» eller «alla». Raden *Mätbart (correct-course 2026-10-18 …)* under kriterium 2 står ordagrant i epics.md. Ingen rad ändrar ett kriteriums innebörd.

1. **Given** registret i `server/src/actions/registry.ts`
   **When** det härledda provet (`server/test/forslagskort-klartext.test.ts`) läser varje åtgärd med `sensitivity: 'sensitive'` direkt ur registret, utan handskriven lista
   **Then** varje nyckel i åtgärdens `inputSchema`, även nästlade nycklar som verifikatrader, har en svensk etikett i `server/src/services/approvalSummary.ts`, och varje nyckel som slutar på `_id` har ett uppslag till en postbeteckning
   **And** `describeApproval` ger en icke-tom postbeteckning för ett förslag av varje känslig åtgärd
   **And** provet har en negativ kontroll: en planterad känslig åtgärd med en nyckel utan etikett, eller ett `_id` utan uppslag, fäller provet

   *Mätbart (berättelsen):* mekanismen är tre tillåtelselistor i `approvalSummary`, och `describeFields` hämtar etiketter och uppslag bara därifrån:
   - `FIELD_LABELS` ger en svensk etikett per nyckelnamn;
   - `VALUE_LABELS` ger en svensk text per enum- och literalvärde;
   - `ID_LOOKUPS` ger ett uppslag per id-nyckel, och `id` räknas som id-nyckel.

   Provet läser `ACTIONS` och vandrar genom varje `inputSchema` med en egen vandring, så listan över nycklar är härledd. Urvalet är varje åtgärd med `sensitivity: 'sensitive'` och dessutom varje åtgärd med `koasForAgent: true`. Den senare sorten når Att göra när en agent anropar den (`server/src/actions/execute.ts` rad 105), och FR-27 gäller varje förslag i kön (AD-8, «Härledningens räckvidd»).

   Fallistan är ändlig och inventerad 2026-11-20 (Dev Notes → Registrets åtgärder i kön):
   - 36 åtgärder: 35 känsliga och `set_crm_sfar`;
   - 100 nyckelnamn och 25 id-nycklar;
   - 32 enumvärden under åtta nycklar;
   - en planterad åtgärd som ger exakt fem fynd (T1.4).

   Har main fler åtgärder när bygget startar gäller registret. Provet härleder listan, och nya nycklar får etiketter enligt regeln i Dev Notes → Etiketterna. Postbeteckningen prövas för de 36 åtgärderna med indatat i `EXEMPEL_INDATA` (T2.2).

2. **Given** ett bolag med minst ett väntande förslag per känslig åtgärd i registret, köade både av agent och av människa
   **When** Att göra renderas
   **Then** sidans synliga text (allt utom attributvärden som `action`, `href` och fragment) innehåller inget UUID-mönster, ingen rå JSON och inget engelskt nyckelnamn ur något `inputSchema`
   **And** en negativ kontroll där ett förslags id-fält renderas rått fäller provet

   *Mätbart (correct-course 2026-10-18, efter flera byggvarv utan done):* kortets text når vyn bara genom kortmodellen i `approvalSummary.ts` (`forslagskort()` för väntande kort och `avgjordRad()` för "Nyss avgjort"). Modellen kör varje textfält genom `utanUuid()`, som byter varje träff av UUID-mönstret mot "(dold referens)". Det gäller också fritext, namn och filnamn ur databasen och okända nycklar i äldre köposter. Attributvärden (`href`, fragment) passerar orörda. Sidans övriga text är en sluten lista: rutens ramtexter, åtgärdsnamnet efter "Teknisk åtgärd", datumet under "Nyss avgjort" och felnotisen, som bara ritas med `?fel=`. Rå JSON och nyckelnamn hålls borta av konstruktionen. Inget värde serialiseras som JSON, och etiketterna kommer bara ur `FIELD_LABELS`. Fritext som någon själv skrivit visas som den skrevs, utom UUID-masken, och provets fixtur har fritext utan JSON-teckenföljder och nyckelord. Fallistan och de tre negativa kontrollerna (rått id-fält, JSON-bit, nyckelnamn) står i berättelsen.

   *Mätbart (berättelsen):* fallistan är sidfixturen i T4.2, med 76 väntande kort.
   - Alla 36 åtgärder i urvalet är köade två gånger, av agent och av människa.
 
```

## Utfall
Tester: 185 passed (185) · Granskning: GODKANT | Alla fem acceptanskriterier är implementerade, tidigare fynd är åtgärdade och inga nya belagda fel hittades. · Byggforsok: 2

## Modellkedja (Davids krav 17/8, reservvag 7/9)

* krav: kordes inte
* utveckling: **gpt-6.1-sol**
* granskning: **gpt-6-astra**

Granskaren ar inte forfattaren: gpt-6-astra granskade gpt-6.1-sols arbete.

effort (Davids beslut 20/10): validering high — planeringssteg
Allt pa Davids abonnemang - inga API-tokens.
