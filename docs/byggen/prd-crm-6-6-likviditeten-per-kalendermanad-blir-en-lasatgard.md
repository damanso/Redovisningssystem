# PRD-bygget crm 6-6-likviditeten-per-kalendermanad-blir-en-lasatgard — PRD crm 6-6-likviditeten-per-kalendermanad-blir-en-lasatgard: # Story 6.6: Likviditeten per kalender

Datum: 2026-11-24 00:30 · Branch: cto/prd-crm-6-6-likviditeten-per-kalendermanad-blir-en-lasatgard-9355 · Kalla: 02-Områden/hermes/prd/crm-1c-prd.md (fryst 29/9, Davids beslut #194)

## Mal
PRD crm 6-6-likviditeten-per-kalendermanad-blir-en-lasatgard: # Story 6.6: Likviditeten per kalendermånad blir en läsåtgärd Status: ready-for-dev <!-- Skapad av create-story (BMAD v6

## PRD-kravet (ordagrant ur den frysta PRD:n) och astras kodgranskning
```
# Story 6.6: Likviditeten per kalendermånad blir en läsåtgärd

Status: ready-for-dev

<!-- Skapad av create-story (BMAD v6.0.1) i autonomt läge 2026-11-23. Kodbas: redovisning. Täcker: FR-44 (läsåtgärden, utbruten ur 6.5 vid correct-course 2026-11-23). Beror på: 6.5 (done, koden finns i arbetskopian). Validering är frivillig: kör validate-create-story före dev-story för en kvalitetskontroll. -->

## Story

Som David,
vill jag att likviditeten per månad, med det obelagda för sig, går att läsa som en åtgärd,
så att styrvyn och AI:n läser samma svar.

Kodbas: redovisning (projektroten, `server/` och `docs/`). Berättelsen lägger till en enda läsåtgärd, `liquidity_by_month`, i registret. Handlern anropar den `liquidityByMonth` som 6.2 och 6.5 byggt och som styrvyn ska läsa i Story 6.3. Ingen beräkning ändras. Dessutom får `docs/MCP_ACTIONS.md` ett eget avsnitt om åtgärden, och talet i rubrikstycket i `docs/STATUS.md` rättas till registrets antal. Läsåtgärden var tidigare 6.5:s andra kriterium. Den bröts ut hit när 6.5 delades (correct-course 2026-11-23, andra varvet), eftersom 6.5 hade vuxit till fyra byggen utan done.

## Förkrav

Blocket nedan är berättelsens hela yta. Formen är samma som i 6.5, som passerat förkontrollen:

- **Inga beroenderader.** Förkontrollens K5 läser för redovisningen bara rotens manifest, och där finns bara arbetsytor, så varje `beroende:`-rad blir RÖD. Berättelsen lägger inte till något paket. vitest, supertest, zod och pg finns redan i serverns manifest.
- **Inga kontraktsrader.** Ett funktionskontrakt för en kodbas som inte är hermes ger KUNDE_INTE. Fallen T1–T3 och D1–D2 i provfilen håller löftena i stället.
- **Inga kommandon och inga förmågor.** Byggaren har bara Read, Glob, Grep, Write, Edit och TodoWrite (kedjans förmågor i underlaget: kommando nej). Kedjan kör typkontrollen (serverns och provens tsconfig) och hela vitest-sviten efter utvecklarens sista ändring. Byggsteget kör den inte, så ingen uppgift lutar sig mot det.
- **Proven.** Varje `prov:`-rad är ett vitest-prov och GRÖN. Kedjan cto kan inte lämna ett prov ogrönt, och förkontrollens K4 fäller i den kedjan varje rad som inte är GRÖN. Berörsraderna är de befintliga proven som läser en fil som ändras här: registret (direkt, genom manifestet eller som källtext), `docs/MCP_ACTIONS.md` och källtextproven som läser varje fil under `server/src` (Dev Notes, «Regressionsytan»). Hermes egna prov körs inte av den här kedjan. Baslinjen för dem står i Dev Notes, «Baslinjen».

```förkrav
fil: server/src/actions/registry.ts ändras
fil: server/test/steering-liquidity.test.ts ändras
fil: docs/MCP_ACTIONS.md ändras
fil: docs/STATUS.md ändras
fil: server/src/services/reports.ts läses
fil: server/src/domain/liquidity.ts läses
fil: server/src/services/steering.ts läses
fil: server/src/actions/execute.ts läses
fil: server/src/http/routes/actions.ts läses
fil: server/src/http/middleware/companyAccess.ts läses
fil: server/src/http/middleware/errorHandler.ts läses
fil: server/src/http/view/routes.ts läses
fil: server/src/mcp/server.ts läses
fil: server/src/lib/validation.ts läses
fil: server/src/lib/errors.ts läses
fil: server/src/db/pool.ts läses
fil: server/src/db/tx.ts läses
fil: server/test/helpers.ts läses
fil: server/test/setup.ts läses
fil: server/test/env.ts läses
fil: server/test/sandvagHelper.ts läses
fil: server/test/utskickHelper.ts läses
fil: server/test/crm-deals.test.ts läses
fil: server/test/crm-read-scope.test.ts läses
fil: server/test/crm-ai-commitments.test.ts läses
fil: server/test/crm-person-provenance.test.ts läses
fil: server/test/crm-calendar-capture.test.ts läses
fil: server/test/forslagskort-beslut.test.ts läses
fil: docs/project-context.md läses
prov: steering-liquidity ändras GRÖN
prov: actions berörs GRÖN
prov: bakvag berörs GRÖN
prov: bankgiro-validering berörs GRÖN
prov: bilaga-kategori berörs GRÖN
prov: crm-ai-commitments berörs GRÖN
prov: crm-calendar-capture berörs GRÖN
prov: crm-commitment-lifecycle berörs GRÖN
prov: crm-commitment-times berörs GRÖN
prov: crm-deals berörs GRÖN
prov: crm-event-provenance berörs GRÖN
prov: crm-org-name-norm berörs GRÖN
prov: crm-person-provenance berörs GRÖN
prov: crm-read-scope berörs GRÖN
prov: crm-sandvag berörs GRÖN
prov: crm-schema berörs GRÖN
prov: crm-sfar-3 berörs GRÖN
prov: crm-status-link berörs GRÖN
prov: crm-thread-paging berörs GRÖN
prov: crm-views berörs GRÖN
prov: draft-delete berörs GRÖN
prov: fakturanummer-samtidighet berörs GRÖN
prov: fiscal-year-derivation berörs GRÖN
prov: forslagskort-beslut berörs GRÖN
prov: forslagskort-klartext berörs GRÖN
prov: kvittobilagor berörs GRÖN
prov: kvittobilagor-lagring berörs GRÖN
prov: manniskosparr berörs GRÖN
prov: mcp berörs GRÖN
prov: mcp-felomslag berörs GRÖN
prov: mcp-lifecycle berörs GRÖN
prov: party-update berörs GRÖN
prov: payroll-tax-dublett berörs GRÖN
prov: tidpost-livscykel berörs GRÖN
prov: uppdragsytan-anteckning berörs GRÖN
prov: uppdragsytan-baselineorsak berörs GRÖN
prov: uppdragsytan-bedomningsbegaran berörs GRÖN
prov: uppdragsytan-beslut berörs GRÖN
prov: uppdragsytan-bindning berörs GRÖN
prov: uppdragsytan-dokumenten berörs GRÖN
prov: uppdragsytan-drive-ko berörs GRÖN
prov: uppdragsytan-godkannandevag berörs GRÖN
prov: uppdragsytan-komplettering berörs GRÖN
prov: uppdragsytan-kontraktsyta berörs GRÖN
prov: uppdragsytan-kostnadssparr berörs GRÖN
prov: uppdragsytan-laget berörs GRÖN
prov: uppdragsytan-mandat berörs GRÖN
prov: uppdragsytan-matt-rytm berörs GRÖN
prov: uppdragsytan-ovrigt berörs GRÖN
prov: uppdragsytan-register berörs GRÖN
prov: uppdragsytan-scopeavgorande berörs GRÖN
prov: uppdragsytan-scopelinje berörs GRÖN
prov: uppdragsytan-svep berörs GRÖN
prov: uppdragsytan-tillagg berörs GRÖN
prov: uppdragsytan-undantag berörs GRÖN
prov: uppdragsytan-utskick berörs GRÖN
prov: vat-declaration berörs GRÖN
prov: voucher-links berörs GRÖN
prov: vy-kansliga-knappar berörs GRÖN
tjanst: 127.0.0.1:5433 vitest-sviten återskapar testdatabasen ur mallen före varje fil och kör åtgärden och tjänsten mot riktig Postgres
```

## Acceptance Criteria

Kriterierna står som i epics.md (Story 6.6). Formen skiljer sig på två punkter, men innehållet är detsamma: provfilens kortform är utskriven från projektroten, och varje kriterium som lovar *samma*, *aldrig* eller *alla* bär raden **Mätbart** med mekanismen och den ändliga fallistan. Fallens id (T, D) står i Dev Notes, «Fallen» och «Fall → uppgift».

1. **Given** den nya läsåtgärden `liquidity_by_month` (`read`, `{ as_of? }`, `.strict()`)
   **When** den anropas
   **Then** den returnerar samma resultat som styrvyn kommer att läsa (samma funktion, `liquidityByMonth`, med `not_counted`), med tenant-isolering
   **And** provet `server/test/steering-liquidity.test.ts` visar att åtgärdens svar är lika med funktionens svar för samma dag, att grannbolagets användare får 404 medan ägaren får svaret, och att ett ogiltigt datum och en okänd nyckel ger 400.
   **Mätbart — mekanism:** *Samma resultat* bärs av en enda väg in. Handlern för `liquidity_by_month` gör exakt ett anrop, `liquidityByMonth(ctx.client, ctx.companyId, i.as_of)`, och returnerar svaret orört. Den räknar inget, filtrerar inget och lägger inget till. Registret får exakt ett nytt importnamn, `liquidityByMonth`, i den befintliga importen ur reports-tjänsten. Inget annat i registret ändras (Uppgift 1.3 jämför, läst). Styrvyn (Story 6.3) anropar samma funktion, så åtgärden och vyn kan inte glida isär. *Tenant-isolering* bärs av husets två lager. Bolaget kommer ur rutten och medlemskapet (`requireCompanyAccess` före varje handler, `withTenantTransaction` och RLS i `executeAction`), och indata kan aldrig bära ett bolag, eftersom schemat är `z.object({ as_of: IsoDateSchema.optional() }).strict()`: ett fält till ger 400. **Fallista:**
   - T1: Åtgärd AB med `as_of` `2026-11-20`. Ägarens token och ett AI-token för bolaget ger båda ett svar som är `toStrictEqual` med funktionens svar efter JSON-transporten.
   - T1, positiv kontroll: svaret har elva obelagda rader o
```

## Utfall
Tester: 208 passed (208) · Granskning: GODKANT | Båda acceptanskriterierna är implementerade och varje [x]-uppgift är gjord enligt koden, och granskningen gav bara två LOW-fynd. · Byggforsok: 1

## Modellkedja (Davids krav 17/8, reservvag 7/9)

* krav: **claude-opus-5-5**
* utveckling: **claude-opus-5-5**
* granskning: **claude-opus-5-5 (Codex spärrat — Davids regel 12/10; Codex granskar i efterhand)**

Granskaren ar inte forfattaren: claude-opus-5-5 (Codex spärrat — Davids regel 12/10; Codex granskar i efterhand) granskade claude-opus-5-5s arbete.

effort (Davids beslut 20/10): create-story high · validering high · bygg xhigh · granskning xhigh — riskdel crm
Allt pa Davids abonnemang - inga API-tokens.
