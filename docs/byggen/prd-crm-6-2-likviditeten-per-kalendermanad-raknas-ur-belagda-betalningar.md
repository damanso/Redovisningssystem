# PRD-bygget crm 6-2-likviditeten-per-kalendermanad-raknas-ur-belagda-betalningar — PRD crm 6-2-likviditeten-per-kalendermanad-raknas-ur-belagda-betalningar: # Story 6.2: Likviditeten 

Datum: 2026-11-20 09:11 · Branch: cto/prd-crm-6-2-likviditeten-per-kalendermanad-raknas-ur-belagda-9295 · Kalla: 02-Områden/hermes/prd/crm-1c-prd.md (fryst 29/9, Davids beslut #194)

## Mal
PRD crm 6-2-likviditeten-per-kalendermanad-raknas-ur-belagda-betalningar: # Story 6.2: Likviditeten per kalendermånad räknas ur belagda betalningar Status: ready-for-dev <!-- Skapad av create-st

## PRD-kravet (ordagrant ur den frysta PRD:n) och astras kodgranskning
```
# Story 6.2: Likviditeten per kalendermånad räknas ur belagda betalningar

Status: ready-for-dev

<!-- Skapad av create-story (BMAD v6.0.1) i autonomt läge 2026-11-20. Omskriven av correct-course 2026-11-20 (sprint-change-proposal-6-2-…): det obelagda, läsåtgärden och dokumentationen är utbrutna till Story 6.5. Korrigerad igen av correct-course 2026-11-20 efter bygge #9293: källfrågorna delas som frågetext, och `liquidityForecast`:s hinkning skrivs inte om (Dev Notes, «Förra bygget (#9293)»). Kodbas: redovisning. Täcker: FR-44 (beräkningen). Beror på: inget. Visningen i styrvyn är Story 6.3. -->

## Story

Som David,
vill jag att systemet räknar likviditeten månad för månad ur betalningar med belagda tidpunkter,
så att "vad som saknas för att hålla likviditeten" besvaras som likviditet och inte som kostnadstäckning.

Kodbas: redovisning (projektroten, `server/`). Berättelsen bygger beräkningen: den rena rullningen och tjänstefunktionen `liquidityByMonth`, med delade källfrågor och *okänt* med källa. Det obelagda (`not_counted`), läsåtgärden `liquidity_by_month` och avsnittet i `docs/MCP_ACTIONS.md` byggs i Story 6.5. Styrvyn rörs inte; den läser funktionen i Story 6.3.

## Förkrav

Blocket nedan är berättelsens hela yta. Fyra saker om formen:

- **Inga beroenderader.** Förkontrollens K5 läser för redovisningen bara manifestet i repots översta katalog, och där finns inga paket, bara arbetsytan `server/`. Varje `beroende:`-rad blir därför RÖD med vägen «david», och en enda RÖD kontroll gör hela förkontrollen RÖD. Det stoppade bygge #9291. Berättelsen lägger inget paket till: vitest, supertest, zod och pg finns redan i serverns manifest. Därför står ingen sådan rad i blocket.
- **Inga kontraktsrader.** `liquidityByMonth` finns inte förrän den här berättelsen byggt den, och förkontrollen prövar kontrakt mot det som finns i dag. Ett funktionskontrakt för delen crm ger KUNDE_INTE. Det nya provet håller i stället löftet, och Story 6.5 och 6.3 läser funktionen.
- **Inga kommandon.** Byggaren har bara Read, Glob, Grep, Write, Edit och TodoWrite. Kedjan kör typkontrollen, bygget och hela vitest-sviten efter utvecklarens sista ändring, och ett rött prov kommer tillbaka som fixrunda.
- **Proven.** Byggkedjan för redovisningen kör vitest-sviten. Hermes egna prov körs inte av den kedjan, och därför står inget sådant prov här. Berörsraderna är de befintliga vitest-filer som läser den ändrade tjänstefilen, och de nio källtextprov som läser varje fil under `server/src` och därför också läser den nya domänfilen och den ändrade tjänstefilen (Dev Notes, «Regressionsytan»).

```förkrav
fil: server/src/domain/liquidity.ts ny
fil: server/test/steering-liquidity.test.ts ny
fil: server/src/services/reports.ts ändras
fil: docs/STATUS.md ändras
fil: server/src/services/taxes.ts läses
fil: server/src/services/payroll.ts läses
fil: server/src/services/steering.ts läses
fil: server/src/domain/money.ts läses
fil: server/src/lib/validation.ts läses
fil: server/src/db/tx.ts läses
fil: server/src/db/pool.ts läses
fil: server/src/actions/registry.ts läses
fil: server/src/http/view/routes.ts läses
fil: server/test/helpers.ts läses
fil: server/test/setup.ts läses
fil: server/test/env.ts läses
fil: server/vitest.config.ts läses
fil: server/tsconfig.json läses
fil: server/tsconfig.test.json läses
fil: server/test/liquiditySources.test.ts läses
fil: server/test/cashflow.test.ts läses
fil: server/test/hem-landningar.test.ts läses
fil: server/test/liquidityGuard.test.ts läses
fil: server/test/vat-declaration.test.ts läses
fil: server/test/tid-rapporter.test.ts läses
fil: server/test/uppdragsytan-utskick.test.ts läses
fil: server/test/utskickHelper.ts läses
fil: server/test/crm-sandvag.test.ts läses
fil: server/test/sandvagHelper.ts läses
fil: docs/MCP_ACTIONS.md läses
fil: docs/project-context.md läses
prov: steering-liquidity nytt GRÖN
prov: liquiditySources berörs GRÖN
prov: liquidityGuard berörs GRÖN
prov: cashflow berörs GRÖN
prov: hem-landningar berörs GRÖN
prov: vat-declaration berörs GRÖN
prov: uppdragsytan-utskick berörs GRÖN
prov: crm-sandvag berörs GRÖN
prov: crm-sfar-3 berörs GRÖN
prov: kvittobilagor-lagring berörs GRÖN
prov: uppdragsytan-baselineorsak berörs GRÖN
prov: uppdragsytan-beslut berörs GRÖN
prov: uppdragsytan-godkannandevag berörs GRÖN
prov: uppdragsytan-undantag berörs GRÖN
tjanst: 127.0.0.1:5433 vitest-sviten återskapar testdatabasen ur mallen före varje fil och kör tjänsterna mot riktig Postgres
```

## Acceptance Criteria

Kriterierna står som i epics.md (Story 6.2). Två ändringar i formen, inte i innehållet: kortformerna av sökvägar är utskrivna från projektroten (förkontrollen fäller en kortform i kodformat), och varje kriterium som lovar *aldrig*, *alla* eller *exakt* bär raden **Mätbart** med mekanismen och den ändliga fallistan. Fallens id (U, G, A, O) står i Dev Notes, «Fall → uppgift».

1. **Given** en ren funktion i `server/src/domain/liquidity.ts` som tar `as_of`, ingående medel och daterade in- och utbetalningar
   **When** den rullar horisonten
   **Then** horisonten är tre kalendermånader — den första från `as_of` till månadens slut, de två följande hela — och per månad ges ingående medel, belagda inbetalningar, belagda utbetalningar och utgående saldo, där varje månads ingående är föregående månads utgående
   **And** belopp är heltal i ören och månader skrivs `YYYY-MM`.
   **Mätbart:** U1 (horisont, gränser, överföring), U5 (post efter horisonten), U8 (ogiltigt belopp eller datum kastar), U9 (`as_of` på månadens sista dag och februari i nästa år).

2. **Given** PRD:ns provfall: utgående saldo −10 den första månaden och −50 den andra
   **When** funktionen räknar
   **Then** första underskott är 10 (i den första månaden) och behovet under horisonten är 50
   **And** två bolag med samma betalningsflöden men olika ingående saldo får olika svar, och ett flöde som aldrig går under noll ger *inget underskott* och behov noll.
   **Mätbart:** U2 (provfallet ordagrant, i ören), U3 (samma flöde med ingående 0 och 100), A3 (samma flöde i två bolag med olika kassa, genom `liquidityByMonth`).

3. **Given** obetalda poster med förfallodag före `as_of`
   **When** horisonten rullas
   **Then** de läggs i första månaden och redovisas som *varav förfallet*.
   **Mätbart:** U4 (rent: en in- och en utbetalning före `as_of`, och en på `as_of` som inte är förfallen), A2 (genom `liquidityByMonth`: en kundfaktura och två lönebesked vars förfallodag passerat).

4. **Given** `liquidityByMonth(client, companyId, asOf)` i `server/src/services/reports.ts`
   **When** den hämtar underlaget
   **Then** den delar källfrågor med `liquidityForecast` genom interna hjälpare som returnerar daterade poster: ingående medel = bokfört saldo på 19xx per `as_of`; belagda inbetalningar = obetalda bokförda kundfakturor på förfallodatum (kundens del efter ROT/RUT-avdrag); belagda utbetalningar = obetalda leverantörsfakturor på förfallodatum och obetalda lönebesked på sin periods AGI-förfallodag
   **And** `liquidityForecast` svarar exakt som förut (provet jämför dess svar på samma testdata före och efter).
   **Mätbart:** A1 (månadsraderna ur kundfaktura, leverantörsfaktura och lönebesked), A4 (de räknade källorna är exakt tillåtelselistan `COUNTED_LIQUIDITY_SOURCES`), U10 (ett flöde ur en odeklarerad källa kastar). *Exakt som förut* — mekanism: källfrågorna delas som **frågetext**. CTE-kropparna för kassan, kundfakturorna och leverantörsfakturorna flyttas ordagrant till modulkonstanter, och `liquidityForecast`:s fråga byggs av samma konstanter med en oförändrad SELECT-lista (hinksummorna `in_now` … `out_later` och `ar_rows`/`ap_rows` räknas kvar i SQL). AGI-blocket flyttas ordagrant till en intern hjälpare som returnerar samma delar i samma ordning, med fältet `kind` tillagt. Inget annat i funktionen ändras: hinkningen, raderna som bygger `sources`, `status`, `note`, de statutära källornas loop, `nextDeadline`, `VAT_UNSETTLED_NOTE`, bolagsskatten, 2920, 289x, 2510 och avstämningen står kvar dä
```

## Utfall
Tester: 184 passed (184) · Granskning: GODKANT | Samtliga acceptanskriterier är implementerade, föreskrivna tester finns och inga konkreta fel har identifierats; kedjans typkontroll och testsvit är gröna. · Byggforsok: 1

## Modellkedja (Davids krav 17/8, reservvag 7/9)

* krav: kordes inte
* utveckling: **gpt-6.1-sol**
* granskning: **gpt-6-astra**

Granskaren ar inte forfattaren: gpt-6-astra granskade gpt-6.1-sols arbete.

effort (Davids beslut 20/10): validering high — planeringssteg
Allt pa Davids abonnemang - inga API-tokens.
