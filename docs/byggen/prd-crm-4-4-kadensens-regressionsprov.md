# PRD-bygget crm 4-4-kadensens-regressionsprov — PRD crm 4-4-kadensens-regressionsprov: # Story 4.4: Kadensens regressionsprov Status: ready-for-dev 

Datum: 2026-10-22 18:46 · Branch: cto/prd-crm-4-4-kadensens-regressionsprov-9266 · Kalla: 02-Områden/hermes/prd/crm-1c-prd.md (fryst 29/9, Davids beslut #194)

## Mal
PRD crm 4-4-kadensens-regressionsprov: # Story 4.4: Kadensens regressionsprov Status: ready-for-dev <!-- Note: Validation is optional. Run validate-create-stor

## PRD-kravet (ordagrant ur den frysta PRD:n) och astras kodgranskning
```
# Story 4.4: Kadensens regressionsprov

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

Som David,
vill jag ha ett prov som visar att en ändrad kadens aldrig ändrar senaste kontakt,
så att klockan bara nollställs av kontakt.

Kodbas: redovisning (kedjan cto) · Täcker: FR-19 · Beror på: — · Arkitektur: kravkartan «FR-18, 19 — Grund — Byggt; frågorna 5 och 6 ändrar en flagga resp. en konstant» · Davids besked 2026-10-16 (PRD fråga 6): standardgränsen 30 dagar är bekräftad.

## Förkrav

Bygget utökar en befintlig provfil och skriver en rad i sessionsloggen. Ingen källfil i `server/src` ändras, ingen migration, ingen ny åtgärd, inget ändrat schema och ingen ny rutt. Det kräver ingen förmåga utöver kedjans: inget kommando, inget nät, inget nytt beroende och ingen ny tjänst. Sökvägarna är relativa kedjans bas (repots rot i /opt/redovisning).

```förkrav
fil: server/test/crm-cadence-merge-search.test.ts ändras
fil: docs/STATUS.md ändras
fil: server/src/services/crmRelations.ts läses
fil: server/src/services/crmDerivations.ts läses
fil: server/src/http/view/routes.ts läses
fil: server/src/http/view/auth.ts läses
fil: server/src/actions/registry.ts läses
fil: server/src/actions/execute.ts läses
fil: server/src/db/tx.ts läses
fil: server/src/http/middleware/companyAccess.ts läses
fil: server/test/crm-stadning.test.ts läses
fil: server/test/helpers.ts läses
fil: server/test/env.ts läses
fil: server/vitest.config.ts läses
fil: server/test/crm-review-fixes.test.ts läses
fil: server/test/uppdragsytan-agandegrans-cache.test.ts läses
fil: docs/project-context.md läses
fil: docs/ARKITEKTUR.md läses
fil: docs/MCP_ACTIONS.md läses
fil: CLAUDE.md läses
fil: _bmad-output/planning-artifacts/prd.md läses
fil: _bmad-output/planning-artifacts/epics.md läses
fil: _bmad-output/planning-artifacts/architecture.md läses
fil: _bmad-output/planning-artifacts/ux-design-specification.md läses
fil: _bmad-output/planning-artifacts/underlag/kodgranskning.md läses
fil: _bmad-output/planning-artifacts/underlag/davids-svar.md läses
fil: _bmad-output/planning-artifacts/underlag/kedjans-formagor.md läses
fil: _bmad-output/implementation-artifacts/1-3-ursprunget-syns-for-varje-uppgift-pa-relationssidan.md läses
beroende: vitest
beroende: supertest
beroende: zod
tjanst: 127.0.0.1:5433 vitest kör provfilen mot den stående testdatabasen
```

- **Tjänsten** är testdatabasen som kedjan cto kör hela sviten mot (underlaget om kedjans förmågor: proven får nå just den adressen). Utvecklarens sandlåda når den ofta inte; det är aldrig ett HALT-skäl (Tasks, «Utan kommandon»).
- **Inga kommandon.** Kedjan cto har ingen kommandoförmåga för byggaren (verktygen är Read, Glob, Grep, Write, Edit och TodoWrite). Kedjan kör själv `npm ci`, typecheck, build och hela testsviten efter din sista ändring, och ett rött test kommer tillbaka som fixrunda. Därför står inga kommandorader i blocket.
- **Inga berörs-rader.** Provvaktens statefil gick att läsa (senaste bokförda körningen 2026-10-22 06.30). Byggslingans urval är proven direkt under prov/ vars källtext nämner en ändrad eller ny modul som helt ord. Den enda ändrade kodfilen är provfilen `server/test/crm-cadence-merge-search.test.ts`; inget prov under hermes/prov nämner `crm-cadence-merge-search` (Grep 2026-10-22: noll träffar). `docs/STATUS.md` är dokumentation och ingen modul, samma bedömning som berättelse 1.3 gjorde för samma fil. Urvalet räknar dessutom bara Python-moduler som moduler, och ingen fil här är en sådan. Inte heller berättelsens text pekar ut något prov: inget namn i kodformat motsvarar en fil under hermes/prov. Inget prov är alltså berört, och ingen rad `prov:` står i blocket.
- **Läsfilerna:** `server/src/services/crmRelations.ts` (`setRelationNudge`, den enda skrivvägen för kadensen, och `logContact`, som den negativa kontrollen planterar med), `server/src/services/crmDerivations.ts` (`relationState`, `DEFAULT_SILENCE_DAYS`, `silenceReport`, `contactSuggestions`), `server/src/http/view/routes.ts` (kadensformuläret, POST-rutten `/relations/:id/cadence`, `runViewAction`, `felNotis`), `server/src/http/view/auth.ts` (`page()`, som gör ett `NotFoundError` till en 404-sida), `server/src/actions/registry.ts` (schemat för `set_crm_relation_nudge` och läsåtgärderna), `server/src/actions/execute.ts` (schemat prövas före transaktionen), `server/src/http/middleware/companyAccess.ts` (`requireCompanyAccess`: API-anrop under ett bolag utan medlemskap ger 404) och `server/src/db/tx.ts` (tenanttransaktionen prövar medlemskapet igen och ger `NotFoundError('company')`). `server/test/crm-stadning.test.ts` är förlagan för att importera en tjänstekonstant i ett prov. `server/test/crm-review-fixes.test.ts` har två befintliga kadensfall som hör till regressionsytan. `server/test/uppdragsytan-agandegrans-cache.test.ts` är förlagan för kontrollvakten (ett fall som kräver att den negativa kontrollen kördes).
- **Inget kontrakt.** Berättelsen läser ingen annan dels rutt, fil eller funktion.

## Acceptance Criteria

Lydelsen är epics.md:s (Story 4.4), ordagrant och numrerad; enda skillnaden är att provfilen i kriterium 3 står med full sökväg. Under varje kriterium står raden *Mätbart*: mekanismen som gör kriteriet sant genom konstruktion och den ändliga listan av fall i `server/test/crm-cadence-merge-search.test.ts` som visar det. Varje fall har sitt namn först i titeln (K1, S1, O1, T1 …). Facit står i fallen som literaler, aldrig hämtat ur koden som prövas. Alla läsningar av relationsläget, förslagen och tystnadsrapporten görs med provdagen `as_of: '2026-09-30'` och kontaktpunkter kl. 12:00 UTC, så att tystnaden i dagar är ett fast tal och inte beror på klockan när provet körs.

1. **Given** en relation med en känd senaste kontakt för 40 dagar sedan
   **When** kadensen sätts — med `set_crm_relation_nudge` och via vyns POST — och sedan nollställs till tomt
   **Then** `last_contact_at` och tystnaden i dagar är identiska före och efter varje steg, och antalet rader i `crm.interactions` för relationen är oförändrat
   **And** en relation med kadens `null` använder bolagets standard 30 dagar: tystnad 31 dagar ger ett kontaktförslag med kadensen som skäl, tystnad 29 dagar ger inget
   - *Mätbart (Then):* Mekanismen är en enda skrivväg och ett härlett värde. Båda ingångarna — åtgärden och vyns POST `/app/c/:companyId/relations/:id/cadence` — går genom `set_crm_relation_nudge` till `setRelationNudge`, vars enda sats är en UPDATE av `crm.organizations` med kolumnerna `snoozed_until`, `muted` och `cadence_days`. Senaste kontakt lagras inte: `relationState` räknar fram den vid läsning som största `occurred_at` i `crm.interactions` för organisationen och dess personer, och tystnaden som provdagen minus det datumet. Bara en ny kontaktpunkt kan alltså flytta klockan. Provet jämför en ögonblicksbild med exakt tre fält — `last_contact_at`, `days_silent` och antalet kontaktpunkter för relationen — före och efter varje steg, med en ren jämförelsefunktion över just den fasta listan. Stegen är en sluten lista om tre: **K1** (åtgärden sätter 20), **K2** (vyns POST sätter 90), **K3** (vyns POST med tomt fält nollställer till `null`). **K4** kräver att ögonblicksbilden efter K3 är lika med den före K1, med facit `2026-08-21T12:00:00.000Z`, 40 och 1, och att relationen har exakt tre auditrader `crm.relation_nudge_set` med kadenserna 20, 90 och `null` (stegen kördes verkligen). **K5** är den negativa kontrollen: ett planterat felaktigt steg som sätter kadensen OCH loggar en kontakt ger avvikelse på alla tre fälten. **KV** kräver att K5 kördes till slut.
   - *Mätbart (And):* Mekanismen är en enda gräns per rad: `contactSuggestions` och `silenceReport` tar gränsen som `cadence_days ?? DEFAULT_SILENCE_DAYS`, och `DEFAULT_SILENCE_DAYS` är 30. Skälet för en relation utan egen kadens är tystnadsskälet `tyst i N dagar`; texten `— kadensen är N` skrivs bara för en egen kadens (beslutslogg, «Kadensen som skäl»).
```

## Utfall
Tester: 173 passed (173) · Granskning: GODKANT | Samtliga acceptanskriterier och kryssade uppgifter är uppfyllda; inga konkreta fel hittades och kedjans kontroller är gröna. · Byggforsok: 1

## Modellkedja (Davids krav 17/8, reservvag 7/9)

* krav: kordes inte
* utveckling: **gpt-6.1-sol**
* granskning: **gpt-6-astra**

Granskaren ar inte forfattaren: gpt-6-astra granskade gpt-6.1-sols arbete.

effort (Davids beslut 20/10): create-story high · validering high — planeringssteg
Allt pa Davids abonnemang - inga API-tokens.
