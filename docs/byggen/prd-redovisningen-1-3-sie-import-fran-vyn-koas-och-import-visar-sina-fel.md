# PRD-bygget redovisningen 1-3-sie-import-fran-vyn-koas-och-import-visar-sina-fel — PRD redovisningen 1-3-sie-import-fran-vyn-koas-och-import-visar-sina-fel: # Story 1.3: SIE-import fr

Datum: 2026-11-20 21:40 · Branch: cto/prd-redovisningen-1-3-sie-import-fran-vyn-koas-och-import-vi-9306 · Kalla: 02-Områden/hermes/prd/redovisningen-1c-prd.md (fryst 29/9, Davids beslut #194)

## Mal
PRD redovisningen 1-3-sie-import-fran-vyn-koas-och-import-visar-sina-fel: # Story 1.3: SIE-import från vyn köas, och Import visar sina fel Status: ready-for-dev <!-- Note: Validation is optional

## PRD-kravet (ordagrant ur den frysta PRD:n) och astras kodgranskning
```
# Story 1.3: SIE-import från vyn köas, och Import visar sina fel

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

Som David,
vill jag att en hel bokföring som tas emot från vyn landar som ett förslag i Att göra, och att Import säger till när något går fel,
så att ingen kan föra in hundratals verifikat förbi min granskning och ingen import misslyckas i tysthet.

**Kodbas:** redovisning. **Krav:** FR-39 (hela lydelsen), FR-38. Arkitektur: AD-1 (vyns SIE-import via `runViewAction`, `importRedirect` slutar svälja fel) och UX K2. **Beror på:** inga. **Senare berättelser som bygger på den här:** 1.12 (det härledda provet byggs ut i `server/test/vy-kansliga-knappar.test.ts`, som skapas här, och importprovet förutsätter att `importSie` är borta ur vyns rutt) och 1.10 (korttexten "SIE-import · räkenskapsår {label} · …").

## Förkrav

```förkrav
fil: server/src/http/view/routes.ts ändras
fil: server/src/services/sieImport.ts ändras
fil: server/test/import.test.ts ändras
fil: server/test/vy-kansliga-knappar.test.ts ny
fil: docs/STATUS.md ändras
fil: server/src/actions/registry.ts läses
fil: server/src/actions/execute.ts läses
fil: server/src/services/approvals.ts läses
fil: server/src/services/bankImport.ts läses
fil: server/src/services/accounting/fiscalYears.ts läses
fil: server/src/services/accounting/accounts.ts läses
fil: server/src/services/accounting/vouchers.ts läses
fil: server/src/http/app.ts läses
fil: server/src/http/view/html.ts läses
fil: server/src/http/view/auth.ts läses
fil: server/src/http/routes/actions.ts läses
fil: server/src/http/routes/accounting.ts läses
fil: server/src/http/middleware/errorHandler.ts läses
fil: server/src/http/middleware/authenticate.ts läses
fil: server/src/services/approvalSummary.ts läses
fil: server/src/mcp/server.ts läses
fil: server/src/lib/errors.ts läses
fil: server/src/lib/validation.ts läses
fil: server/src/db/tx.ts läses
fil: server/migrations/0006_chart_of_accounts_and_fiscal_years.sql läses
fil: server/test/helpers.ts läses
fil: server/test/setup.ts läses
fil: server/test/bokslut.test.ts läses
fil: server/test/actions.test.ts läses
fil: server/test/k2-annual.test.ts läses
fil: server/test/forslagskort-klartext.test.ts läses
fil: server/test/entity-links.test.ts läses
fil: server/test/navigation.test.ts läses
fil: server/test/radlangd.test.ts läses
fil: server/test/documents.test.ts läses
fil: server/test/uppdragsytan-godkannandevag.test.ts läses
fil: server/test/uppdragsytan-beslut.test.ts läses
fil: server/test/uppdragsytan-utskick.test.ts läses
fil: server/test/crm-sandvag.test.ts läses
fil: server/kontrakt/navigation.v1.json läses
fil: server/vitest.config.ts läses
fil: server/tsconfig.json läses
fil: server/tsconfig.test.json läses
fil: server/package.json läses
fil: package.json läses
fil: package-lock.json läses
fil: CLAUDE.md läses
fil: docs/ARKITEKTUR.md läses
fil: docs/project-context.md läses
fil: docs/MCP_ACTIONS.md läses
prov: import ändras GRÖN
prov: vy-kansliga-knappar nytt GRÖN
prov: bokslut berörs GRÖN
prov: actions berörs GRÖN
prov: k2-annual berörs GRÖN
prov: forslagskort-klartext berörs GRÖN
prov: entity-links berörs GRÖN
prov: navigation berörs GRÖN
prov: radlangd berörs GRÖN
prov: documents berörs GRÖN
prov: view berörs GRÖN
prov: statusetiketter berörs GRÖN
prov: uppdragsytan-godkannandevag berörs GRÖN
prov: uppdragsytan-beslut berörs GRÖN
prov: uppdragsytan-utskick berörs GRÖN
prov: crm-sandvag berörs GRÖN
tjanst: 127.0.0.1:5433 vitest kör alla prov mot den stående testdatabasen redovisning-vitest-pg
```

Blocket deklarerar filerna i repot, vitest-sviterna och testdatabasen. Raderna för `server/tsconfig.json`, `server/tsconfig.test.json` och `package-lock.json` finns för att uppgift 2.2 och Senaste teknik bygger på dem (inget `noUnusedLocals`, express 5.2.1 och body-parser 2.3.0). `server/src/http/routes/accounting.ts` bär låset som F3.3 och K4.4 köar, `server/src/lib/validation.ts` bär `UuidSchema`, `server/src/http/middleware/authenticate.ts` bär `getUserId` och `server/src/services/approvalSummary.ts` bär den dolda nyckeln `sie_content`.

Sex slag av rader står medvetet inte i blocket. De fyra första har samma skäl som i Story 1.2, som godkändes med samma form:
- **Inga `beroende:`-rader.** I kedjan cto läser förkontrollens K5 bara rotens `package.json`, som saknar `dependencies`, så varje paketrad blir RÖD. Berättelsen lägger inte till något paket. Paketen den använder (express, zod, pg, vitest och supertest) står redan i `server/package.json`.
- **Inga `kommando:`-rader.** K7 godtar bara git-läsformer, och kedjans utvecklarroll har inget skal (Dev Notes → Körmiljön i kedjans bygge). Grindarnas körningar görs av kedjan efter utvecklaren.
- **Inga `kontrakt:`-rader.** K8 kräver ett Hermes-prov per kontrakt. Allt fallen förutsätter (rutter, funktioner och tabeller) finns i samma repo och prövas av vitest-sviterna ovan.
- **Inga Hermes-prov i baslinjen.** Fyra Hermes-prov nämner en modul som berättelsen ändrar och var inte GRÖNA i provvaktens senaste körning (Dev Notes → Baslinjen). I kedjan cto fäller K4 varje `prov:`-rad som inte är GRÖN, och K9 gäller inte där. Raderna skulle därför göra berättelsen oanvändbar utan att något prov blev mer pålitligt.
- **Inga `kraver:`-rader.** Bygget kräver ingen förmåga som kedjan cto saknar. Förmågan `kommando` är nej (underlaget kedjans-formagor.md), men ingen uppgift kräver den. En körning som inte kan göras skrivs som «inte kört — {skälet}», och kedjan kör grindarna efter utvecklaren.
- **Inga `namner:`-rader.** Inget av orden i ordregeln står i berättelsens text, och bygget rör varken schemaläggning, systemtjänster eller förhöjd behörighet.

Inget nytt paket, ingen migration, ingen ny rutt, ingen ny åtgärd och ingen ändring i registret. Den enda nya filen är provfilen `server/test/vy-kansliga-knappar.test.ts`.

## Acceptance Criteria

Kriterierna står ordagrant som i planeringens epics.md (Story 1.3). Raderna *Mätbart (berättelsen)* lägger till mekanismen och den ändliga fallistan för kriterier som lovar «inga», «aldrig» eller «samma krav som övriga». Ingen rad ändrar ett kriteriums innebörd.

1. **Given** en inloggad människa på Import med ett giltigt SIE-innehåll och ett valt räkenskapsår
   **When** "Importera SIE…" skickas (`POST /app/c/:companyId/import/sie`, fortsatt med `urlencoded({ limit: '5mb' })`)
   **Then** rutten kör `runViewAction('import_sie', { fiscal_year_id, sie_content })` och användaren skickas till Att göra
   **And** ett väntande förslag finns, och inga konton och inga verifikat har importerats före godkännandet (konto- och verifikatantalet är oförändrade)

   *Mätbart (berättelsen):* en enda väg in. Rutten anropar bara `runViewAction`, och `executeAction` köar varje `sensitive` åtgärd på rad 81 i `server/src/actions/execute.ts` utan att köra handlern. Importraden för `importSie` och `parseSie` (rad 94 i `server/src/http/view/routes.ts`) tas bort, så att rutten inte kan nå tjänsten. «Fortsatt med 5 mb» blir sant genom en tillåtelselista: den globala parsern på 16 kB (rad 115) släpper förbi exakt två POST-former, `import/sie` och `import/bank`, och deras egna parsrar på 5 mb läser kroppen först efter `viewAuth` (samma mönster som AD-10 för `attach_document`). Fallistan: S1.1 (giltig SIE-text), S1.2 (en SIE-text över 16 kB köas, och en lika stor kropp till en annan vy-POST ger fortfarande 413) och V1.1.

2. **Given** det väntande förslaget
   **When** en människa godkänner det
   **Then** konton och verifikat ur filen importeras som `import.test.ts` förväntar, och konton som redan finns hoppas över genom uppslag före INSERT (lärdom 2), utan att transaktionen förgiftas

   *Mätbart (berättelsen):* godkännandet går som i dag genom `approveAction` i en transaktion, och `importSie` slår upp bolagets befintliga konton med en SELECT före varje INSERT (`server/src/services/sieImport.ts` rad 123–134). Inget i den vägen ändras. Fallistan: S1.
```

## Utfall
Tester: 187 passed (187) · Granskning: GODKANT | Alla sju acceptanskriterier är implementerade, båda tidigare fynden är åtgärdade och inga nya belagda fel hittades. · Byggforsok: 2

## Modellkedja (Davids krav 17/8, reservvag 7/9)

* krav: kordes inte
* utveckling: **gpt-6.1-sol**
* granskning: **gpt-6-astra**

Granskaren ar inte forfattaren: gpt-6-astra granskade gpt-6.1-sols arbete.

effort (Davids beslut 20/10): validering high — planeringssteg
Allt pa Davids abonnemang - inga API-tokens.
