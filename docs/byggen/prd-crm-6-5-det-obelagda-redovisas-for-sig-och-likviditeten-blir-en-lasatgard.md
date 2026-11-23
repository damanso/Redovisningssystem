# PRD-bygget crm 6-5-det-obelagda-redovisas-for-sig-och-likviditeten-blir-en-lasatgard — PRD crm 6-5-det-obelagda-redovisas-for-sig-och-likviditeten-blir-en-lasatgard: # Story 6.5: Det obel

Datum: 2026-11-23 06:08 · Branch: cto/prd-crm-6-5-det-obelagda-redovisas-for-sig-och-likviditeten--9340 · Kalla: 02-Områden/hermes/prd/crm-1c-prd.md (fryst 29/9, Davids beslut #194)

## Mal
PRD crm 6-5-det-obelagda-redovisas-for-sig-och-likviditeten-blir-en-lasatgard: # Story 6.5: Det obelagda redovisas för sig, och likviditeten blir en läsåtgärd Status: ready-for-dev <!-- Skapad av cre

## PRD-kravet (ordagrant ur den frysta PRD:n) och astras kodgranskning
```
# Story 6.5: Det obelagda redovisas för sig, och likviditeten blir en läsåtgärd

Status: ready-for-dev

<!-- Skapad av create-story (BMAD v6.0.1) i autonomt läge 2026-11-22. Kodbas: redovisning. Täcker: FR-44 (obelagt för sig och läsåtgärden). Beror på: 6.2 (done, koden finns i arbetskopian). Visningen i styrvyn är Story 6.3, som läser fältet not_counted härifrån. -->
<!-- correct-course 2026-11-22: regel 4 gäller bara en skuld (belopp > 0), restsaldot räknas ur 6.2:s AGI-delar utan egen kontoläsning, läsningarna per anrop är en sluten lista, och CRM-löftet bärs av importlistan. Se Dev Notes, «Tidigare byggen». -->
<!-- correct-course 2026-11-23: fordringar och kostnader utan datum var en urvalslista av konton. Nu bär en sluten kontoindelning över 1500–1699 och 2400–2999 dem, med en restrad per sida, så att varje krona där står räknad eller obelagd. Se Dev Notes, «Kontoindelningen» och «Tidigare byggen», punkt 3. -->
<!-- correct-course 2026-11-23 (andra varvet, efter bygget #9339): berättelsen är delad. Läsåtgärden `liquidity_by_month`, avsnittet i docs/MCP_ACTIONS.md, fallen T1–T3 och D1 och talet i STATUS.md:s rubrikstycke ligger i Story 6.6, som beror på den här. Titeln står kvar eftersom nyckeln bärs av den. Se Dev Notes, «Tidigare byggen», punkt 4. -->

## Story

Som David,
vill jag att det som saknar belagd betalningstidpunkt redovisas för sig med belopp och skäl,
så att inget obelagt kallas likviditet.

Kodbas: redovisning (projektroten, `server/`). Berättelsen bygger vidare på 6.2:s `liquidityByMonth`. Den lägger till fältet `not_counted` med en sluten lista av obelagda poster och gör abonnemangens månadsvärde till en enda definition som både styrvyn och likviditeten läser. Styrvyns rendering rörs inte; den kommer i Story 6.3. Läsåtgärden `liquidity_by_month` och dess avsnitt i `docs/MCP_ACTIONS.md` byggs i Story 6.6, som anropar samma `liquidityByMonth`. Titelns andra led hör alltså till 6.6. Titeln står kvar oförändrad, eftersom berättelsens nyckel bildas av den.

## Förkrav

Blocket nedan är berättelsens hela yta. Fyra saker om formen, samma som i 6.2, som passerat förkontrollen:

- **Inga beroenderader.** Förkontrollens K5 läser för redovisningen bara rotens manifest, som bara har arbetsytor, och ger varje `beroende:`-rad RÖD. Berättelsen lägger inget paket till; vitest, supertest, zod och pg finns redan i serverns manifest.
- **Inga kontraktsrader.** Ett funktionskontrakt för en kodbas som inte är hermes ger KUNDE_INTE, och fältet `not_counted` finns inte förrän berättelsen byggt det. Provet `steering-liquidity` håller löftet i stället.
- **Inga kommandon.** Byggaren har bara Read, Glob, Grep, Write, Edit och TodoWrite (kedjans förmågor i underlaget: kommando nej). Kedjan kör typkontrollen, som prövar både serverns och provens tsconfig, och hela vitest-sviten efter utvecklarens sista ändring. Byggsteget kör kedjan inte, så ingen uppgift lutar sig mot det.
- **Proven.** Varje `prov:`-rad är ett vitest-prov och GRÖN: kedjan cto kan inte lämna ett prov ogrönt, och K4 fäller varje rad som inte är GRÖN. Berörsraderna är de befintliga proven som läser en fil i blocket: en ändrad fil, eller registret och `docs/MCP_ACTIONS.md`, som här bara läses (Dev Notes, «Regressionsytan»). Hermes egna prov körs inte av den här kedjan; baslinjen för dem står i Dev Notes, «Baslinjen».

```förkrav
fil: server/src/services/reports.ts ändras
fil: server/src/services/steering.ts ändras
fil: server/src/domain/liquidity.ts ändras
fil: server/test/steering-liquidity.test.ts ändras
fil: docs/STATUS.md ändras
fil: server/src/actions/registry.ts läses
fil: docs/MCP_ACTIONS.md läses
fil: server/src/services/taxes.ts läses
fil: server/src/services/timeReports.ts läses
fil: server/src/services/payroll.ts läses
fil: server/src/services/housework.ts läses
fil: server/src/services/receipts.ts läses
fil: server/src/services/accounting/autopost.ts läses
fil: server/migrations/0006_chart_of_accounts_and_fiscal_years.sql läses
fil: server/migrations/0036_housework_deduction.sql läses
fil: server/migrations/0067_konto_2731.sql läses
fil: server/src/services/invoices.ts läses
fil: server/src/services/gdpr.ts läses
fil: server/src/domain/vat.ts läses
fil: server/src/services/recurringInvoices.ts läses
fil: server/src/services/projects.ts läses
fil: server/src/services/crmDeals.ts läses
fil: server/src/domain/money.ts läses
fil: server/src/lib/validation.ts läses
fil: server/src/db/pool.ts läses
fil: server/src/db/tx.ts läses
fil: server/src/http/view/routes.ts läses
fil: server/src/http/routes/actions.ts läses
fil: server/src/http/middleware/companyAccess.ts läses
fil: server/src/http/middleware/errorHandler.ts läses
fil: server/src/actions/execute.ts läses
fil: server/src/mcp/server.ts läses
fil: server/test/helpers.ts läses
fil: server/test/setup.ts läses
fil: server/test/env.ts läses
fil: server/test/sandvagHelper.ts läses
fil: server/test/utskickHelper.ts läses
fil: server/test/liquiditySources.test.ts läses
fil: server/test/tid-rapporter.test.ts läses
fil: server/test/crm-deals.test.ts läses
fil: server/test/crm-derivations.test.ts läses
fil: docs/project-context.md läses
prov: steering-liquidity ändras GRÖN
prov: liquiditySources berörs GRÖN
prov: liquidityGuard berörs GRÖN
prov: cashflow berörs GRÖN
prov: hem-landningar berörs GRÖN
prov: vat-declaration berörs GRÖN
prov: tid-rapporter berörs GRÖN
prov: entity-links berörs GRÖN
prov: crm-contractor-role berörs GRÖN
prov: crm-derivations berörs GRÖN
prov: crm-sandvag berörs GRÖN
prov: uppdragsytan-utskick berörs GRÖN
prov: crm-sfar-3 berörs GRÖN
prov: kvittobilagor-lagring berörs GRÖN
prov: uppdragsytan-baselineorsak berörs GRÖN
prov: uppdragsytan-beslut berörs GRÖN
prov: uppdragsytan-godkannandevag berörs GRÖN
prov: uppdragsytan-undantag berörs GRÖN
prov: forslagskort-beslut berörs GRÖN
prov: forslagskort-klartext berörs GRÖN
prov: bakvag berörs GRÖN
prov: crm-schema berörs GRÖN
prov: mcp berörs GRÖN
prov: party-update berörs GRÖN
prov: uppdragsytan-mandat berörs GRÖN
prov: uppdragsytan-tillagg berörs GRÖN
prov: uppdragsytan-komplettering berörs GRÖN
prov: vy-kansliga-knappar berörs GRÖN
prov: crm-status-link berörs GRÖN
prov: crm-event-provenance berörs GRÖN
prov: crm-commitment-times berörs GRÖN
prov: crm-commitment-lifecycle berörs GRÖN
prov: crm-thread-paging berörs GRÖN
prov: crm-org-name-norm berörs GRÖN
prov: crm-deals berörs GRÖN
prov: crm-views berörs GRÖN
prov: voucher-links berörs GRÖN
prov: uppdragsytan-matt-rytm berörs GRÖN
prov: uppdragsytan-scopelinje berörs GRÖN
prov: fakturanummer-samtidighet berörs GRÖN
prov: payroll-tax-dublett berörs GRÖN
prov: draft-delete berörs GRÖN
tjanst: 127.0.0.1:5433 vitest-sviten återskapar testdatabasen ur mallen före varje fil och kör tjänsterna och åtgärderna mot riktig Postgres
```

## Acceptance Criteria

Kriterierna står som i epics.md (Story 6.5). Två ändringar i formen, inte i innehållet: kortformen av provfilens sökväg är utskriven från projektroten, och varje kriterium som lovar *aldrig* eller gäller *alla* fall bär raden **Mätbart** med mekanismen och den ändliga fallistan. Fallens id (R, E, N) står i Dev Notes, «Fallen» och «Fall → uppgift». Läsåtgärdens kriterium (epics.md, Story 6.6) och dess fall T1–T3 och D1 hör inte hit.

1. **Given** poster utan belagd tidpunkt
   **When** likviditeten räknas
   **Then** abonnemang utan ställd faktura, ofakturerad tid, fordringar utan förfallodatum, kostnader utan betalningsdatum, momsnettot på 26xx och restsaldot på 2710/2730 räknas aldrig in i månaderna utan redovisas för sig med belopp och skäl — de periodlösa skatteskulderna med nästa förfallodag och underlagets egen reservation utskriven
   **And** öppna affärer ingår aldrig.
   **Mätbart — mekanism:** två slutna listor, en sluten kontoindelning och ett fält som aldrig förs in i rullningen. (a) Rullningen får bara `COUNTED_LIQUIDITY_SOURCES` (6.2), och `rollLiquidity` kastar på ett flöde ur en odeklarerad källa (6.2:s U10). (b) Det obelagda byggs *efter* rullningen av den
```

## Utfall
Tester: 201 passed (201) · Granskning: GODKANT | Båda kriterierna och alla kryssade uppgifter finns i koden, kedjans svit är grön (201 av 201) och det enda som återstår är tre LOW-fynd. · Byggforsok: 1

## Modellkedja (Davids krav 17/8, reservvag 7/9)

* krav: **claude-opus-5-5**
* utveckling: **claude-opus-5-5**
* granskning: **claude-opus-5-5 (Codex spärrat — Davids regel 12/10; Codex granskar i efterhand)**

Granskaren ar inte forfattaren: claude-opus-5-5 (Codex spärrat — Davids regel 12/10; Codex granskar i efterhand) granskade claude-opus-5-5s arbete.

effort (Davids beslut 20/10): validering high · bygg xhigh · granskning xhigh — riskdel crm
Allt pa Davids abonnemang - inga API-tokens.
