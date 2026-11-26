# PRD-bygget uppdragsytan 2-8-forslagets-underlag-visar-luckorna-parterna-och-ankaret — PRD uppdragsytan 2-8-forslagets-underlag-visar-luckorna-parterna-och-ankaret: # Story 2.8: Förslaget

Datum: 2026-11-26 21:08 · Branch: cto/prd-uppdragsytan-2-8-forslagets-underlag-visar-luckorna-part-9358 · Kalla: 02-Områden/hermes/uppdragsytan-1c-prd.md (fryst 29/9, Davids beslut #194)

## Mal
PRD uppdragsytan 2-8-forslagets-underlag-visar-luckorna-parterna-och-ankaret: # Story 2.8: Förslagets underlag visar luckorna, parterna och ankaret Status: ready-for-dev <!-- Note: Validation is opt

## PRD-kravet (ordagrant ur den frysta PRD:n) och astras kodgranskning
```
# Story 2.8: Förslagets underlag visar luckorna, parterna och ankaret

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

<!-- Kodbas: redovisning (kedjan cto). Krav: FR-27 (luckan i förslagets underlag), FR-13 (godkännaren och godkännandeformen ur manifestet), FR-14 (ankardatumet som del av baselineförslaget), NFR-4 (epics.md rad 2095–2130). Beror på: Story 2.4 (done 2026-11-26). Story key: 2-8-forslagets-underlag-visar-luckorna-parterna-och-ankaret. Skapad av create-story 2026-11-26 i #yolo-läge. Utformningen bygger på avsnitt 4 i sprint-change-proposal-filen för Story 2.4 (”Utformningen för Story 2.8”), avstämd mot koden som 2.4 lämnade i main. Ingen migration. -->

## Story

As a David,
I want att baselineförslaget i undantagsvyn visar luckorna, parterna och ankardatumet som mitt ja gäller,
so that ingenting skrivs över i tysthet och ingen lucka upptäcks först vid leveransen.

## Förkrav

Blocket räknar upp allt bygget kräver. Varje rad med läget `ändras` eller `läses` finns i arbetskatalogens kopia (kontrollerat med Glob 2026-11-26), och de två raderna med läget `ny` saknas där. Ingen migration tillkommer, så `server/migrations/0097_kontraktsparter.sql` står bara som ingångens belägg för att Story 2.4 finns i kopian (uppgift 0).

```förkrav
fil: server/src/lib/forslagsunderlag.ts ny
fil: server/test/uppdragsytan-luckunderlag.test.ts ny
fil: server/src/services/uppdragImport.ts ändras
fil: server/src/services/approvalSummary.ts ändras
fil: server/src/services/uppdragUndantag.ts ändras
fil: docs/MCP_ACTIONS.md ändras
fil: docs/ARKITEKTUR.md ändras
fil: docs/STATUS.md ändras
fil: server/src/lib/kontraktsluckor.ts läses
fil: server/src/lib/leveranskontrakt.ts läses
fil: server/src/lib/validation.ts läses
fil: server/src/lib/bedomningsrytm.ts läses
fil: server/src/services/uppdragKontrakt.ts läses
fil: server/src/services/uppdragRegister.ts läses
fil: server/src/services/uppdragReferens.ts läses
fil: server/src/services/contracts.ts läses
fil: server/src/services/approvals.ts läses
fil: server/src/actions/registry.ts läses
fil: server/src/db/tx.ts läses
fil: server/migrations/0097_kontraktsparter.sql läses
fil: server/test/uppdragsytan-kontraktsluckor.test.ts läses
fil: server/test/uppdragImportHelper.ts läses
fil: server/test/helpers.ts läses
fil: server/test/env.ts läses
fil: server/test/setup.ts läses
fil: server/test/globalSetup.ts läses
fil: server/vitest.config.ts läses
fil: server/tsconfig.test.json läses
fil: server/package.json läses
fil: server/test/fixtures/leveranskontrakt-nvr-001.ts läses
fil: server/test/fixtures/leveranskontrakt-nvr-001-v3.ts läses
fil: server/test/fixtures/leveranskontrakt-syntetisk-v3form.ts läses
fil: server/test/uppdragsytan-undantag.test.ts läses
fil: server/test/uppdragsytan-undantagsvyn.test.ts läses
fil: server/test/uppdragsytan-import.test.ts läses
fil: server/test/uppdragsytan-import-v3.test.ts läses
fil: server/test/uppdragsytan-plan.test.ts läses
fil: server/test/uppdragsytan-beslut.test.ts läses
fil: server/test/uppdragsytan-mandat.test.ts läses
fil: server/test/uppdragsytan-baselineorsak.test.ts läses
fil: server/test/uppdragsytan-baselineversion.test.ts läses
fil: server/test/uppdragsytan-kontraktsyta.test.ts läses
fil: server/test/uppdragsytan-matt-rytm.test.ts läses
fil: server/test/uppdragsytan-scopelinje.test.ts läses
fil: server/test/uppdragsytan-utskick.test.ts läses
fil: server/test/uppdragsytan-godkannandevag.test.ts läses
fil: server/test/forslagskort-klartext.test.ts läses
fil: server/test/forslagskort-beslut.test.ts läses
fil: server/test/vy-kansliga-knappar.test.ts läses
fil: server/test/crm-sandvag.test.ts läses
fil: server/test/sandvagHelper.ts läses
fil: CLAUDE.md läses
fil: docs/project-context.md läses
prov: flerbolag berörs GRÖN
prov: procentforbud berörs GRÖN
prov: handgrepp berörs GRÖN
prov: modulprov berörs GRÖN
prov: kontrollytan berörs GRÖN
prov: uppdragstackning berörs GRÖN
prov: beslutsverkstallning berörs GRÖN
prov: ovrigtforslag berörs GRÖN
tjanst: 127.0.0.1:5433 vitest kör proven mot testdatabasen i Postgres 16
kontrakt: uppdragsytan fil server/src/services/uppdragUndantag.ts prov kontrollytan
kontrakt: uppdragsytan fil server/src/services/uppdragUndantag.ts prov uppdragstackning
kontrakt: uppdragsytan fil server/src/services/uppdragImport.ts prov flerbolag
kontrakt: uppdragsytan fil docs/MCP_ACTIONS.md prov handgrepp
```

Berättelsens egna prov är vitest-filer i `server/test` och står som `fil:`-rader: den nya provfilen med läget `ny`, regressionsfilerna med läget `läses`. Ingen befintlig provfil ändras. `prov:`-raderna är Hermes prov. De läser releasen och körs av Hermes provvakt på dess eget schema, inte av kedjans `npm test` (Dev Notes, ”Kedjan kontrollerar i drift”).

- **Baslinjen.** Provvaktens senaste bokförda körning (provvaktens state-fil i Hermes hemkatalog, läst 2026-11-26, körningen 06.30 samma dag) lästes med fältet `lage` per prov. Sjutton prov stod inte GRÖNA. Sökningen gällde provens källtext i arbetskatalogens kopia av Hermes prov och de moduler som berättelsen ändrar eller skapar (approvalSummary, uppdragUndantag, uppdragImport, forslagsunderlag, uppdragsytan-luckunderlag, MCP_ACTIONS, ARKITEKTUR och STATUS) som helt ord. Ett av de sjutton nämner en sådan modul: overlamningsregister_fr6, RÖD (STATUS, som sökväg i en egen fixtur). Raden står ändå inte i blocket, av samma skäl som i Story 2.3, 2.4 och 2.6: kodbasen är redovisning, så kedjan cto bygger berättelsen, och förkontrollens K4 fäller varje `prov:`-rad som inte är GRÖN med ”provet kräver nytt_prov_ej_gront” när kedjan inte är hermes. Kedjornas förmågor (underlaget kedjans-formagor) säger att cto saknar den förmågan. Berättelsen gör inte provet rött och ska inte göra det grönt. De sexton andra icke-GRÖNA proven nämner ingen modul som berättelsen ändrar.
- **De GRÖNA raderna** är prov som läser det berättelsen ändrar: flerbolag läser SQL i mallsträngar i `server/src/services/uppdrag*` (berättelsen lägger ingen ny SQL-sats, men `uppdragImport.ts` och `uppdragUndantag.ts` ändras); procentforbud läser tjänst- och vyfilerna vars namn börjar med uppdrag; handgrepp och ovrigtforslag läser `docs/MCP_ACTIONS.md`; modulprov kör `npm test -- uppdragsytan`, alltså också den nya provfilen; kontrollytan, uppdragstackning och beslutsverkstallning läser konstanterna `MANDATKALLOR` och `TACKNING_MAX_ALDER_MIN` i `server/src/services/uppdragUndantag.ts`, som inte ändras. Lägena är provvaktens, alltså läget före bygget.
- **Kontrakten** är filkontrakt, som i Story 2.4: undantagsvyns fil binds till kontrollytan och uppdragstackning, importens fil till flerbolag och dokumentet till handgrepp. Alla fyra proven är GRÖNA.
- **Inga `beroende:`-rader**, eftersom inget paket tillkommer. **Inga `kommando:`-rader**, eftersom kedjan cto inte ger byggaren förmågan att köra kommandon som grind (kedjans förmågor, kommando nej). **Inga `kraver:`- eller `namner:`-rader**, eftersom bygget bara skriver filer i kopian och ordregelns fyra ord inte förekommer i berättelsen.

## Acceptance Criteria

Lydelsen i varje **Given/When/Then** är ordagrann ur epics.md (Story 2.8, rad 2109–2130). Raden **Mätbart** under ett kriterium är berättelsens tillägg. Den anger mekanismen som gör ett ”aldrig”, ”inget” eller ”samma” sant genom konstruktion och den ändliga fallistan som provet prövar. Kriteriet ändras inte av den. Alla nya fall bor i `server/test/uppdragsytan-luckunderlag.test.ts`, och varje fall har sitt id (F, U, D) först i titeln. Fallens innehåll står i Dev Notes, ”Fallen”.

1. **Given** att kontraktstexten och manifestet anger olika godkännare
   **When** baselineförslaget visas i undantagsvyn
   **Then** står skillnaden i förslagets underlag med kontraktstextens och manifestets värden och att manifestets värde gäller. Den skrivs aldrig över i tysthet.

   **Mätbart:** en enda lista bär skillnaderna: `skillnader` ur den rena `kontraktsparter` (Story 2.4), över den slu
```

## Utfall
Tester: 210 passed (210) · Granskning: GODKANT | Alla fem acceptanskriterier och kryssade implementationsuppgifter är uppfyllda; inga belagda fynd, och kedjans typkontroll och 210 tester har passerat. · Byggforsok: 1

## Modellkedja (Davids krav 17/8, reservvag 7/9)

* krav: kordes inte
* utveckling: **gpt-6.1-sol**
* granskning: **gpt-6-astra**

Granskaren ar inte forfattaren: gpt-6-astra granskade gpt-6.1-sols arbete.

effort (Davids beslut 20/10): create-story high · validering high — planeringssteg
Allt pa Davids abonnemang - inga API-tokens.
