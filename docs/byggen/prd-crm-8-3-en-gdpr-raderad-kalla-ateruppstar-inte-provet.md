# PRD-bygget crm 8-3-en-gdpr-raderad-kalla-ateruppstar-inte-provet — PRD crm 8-3-en-gdpr-raderad-kalla-ateruppstar-inte-provet: # Story 8.3: En GDPR-raderad källa återup

Datum: 2026-10-22 19:35 · Branch: cto/prd-crm-8-3-en-gdpr-raderad-kalla-ateruppstar-inte-provet-9267 · Kalla: 02-Områden/hermes/prd/crm-1c-prd.md (fryst 29/9, Davids beslut #194)

## Mal
PRD crm 8-3-en-gdpr-raderad-kalla-ateruppstar-inte-provet: # Story 8.3: En GDPR-raderad källa återuppstår inte — provet Status: ready-for-dev <!-- Note: Validation is optional. Ru

## PRD-kravet (ordagrant ur den frysta PRD:n) och astras kodgranskning
```
# Story 8.3: En GDPR-raderad källa återuppstår inte — provet

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

Som David,
vill jag ha ett prov som visar att en kund som raderats enligt GDPR inte återskapas av nästa synk,
så att en rättsligt utförd radering inte görs ogjord i tysthet.

Kodbas: redovisning (kedjan cto) · Täcker: FR-43 (och NFR-4, återuppspelningsprovet; NFR-5, rätten till radering med gravstenar) · Beror på: — · Arkitektur: P-3 «Återuppspelningsprovet `server/test/crm-gdpr-replay.test.ts` (FR-43)» och kravkartan «FR-43 | P-3 | Täckt (spärren byggd, provet beslutat)».

## Förkrav

Bygget skriver en ny provfil och en rad i sessionsloggen. Ingen källfil i `server/src` ändras, ingen migration, ingen ny åtgärd, inget ändrat schema och ingen ny rutt. Bygget kräver ingen förmåga utöver kedjans: inget kommando, inget nät, inget nytt beroende och ingen ny tjänst. Sökvägarna är relativa kedjans bas (repots rot i /opt/redovisning).

```förkrav
fil: server/test/crm-gdpr-replay.test.ts ny
fil: docs/STATUS.md ändras
fil: server/src/services/gdpr.ts läses
fil: server/src/services/crmRelations.ts läses
fil: server/src/services/crmIngest.ts läses
fil: server/src/actions/registry.ts läses
fil: server/src/actions/execute.ts läses
fil: server/src/http/routes/actions.ts läses
fil: server/src/http/middleware/companyAccess.ts läses
fil: server/src/db/pool.ts läses
fil: server/src/db/tx.ts läses
fil: server/migrations/0054_crm_review_fixes.sql läses
fil: server/test/helpers.ts läses
fil: server/test/env.ts läses
fil: server/test/setup.ts läses
fil: server/vitest.config.ts läses
fil: server/tsconfig.test.json läses
fil: server/test/gdpr.test.ts läses
fil: server/test/crm-schema.test.ts läses
fil: server/test/crm-review-fixes.test.ts läses
fil: server/test/crm-contractor-role.test.ts läses
fil: server/test/tenant-isolation.test.ts läses
fil: docs/project-context.md läses
fil: docs/crm/API_KONTRAKT.md läses
fil: docs/MCP_ACTIONS.md läses
fil: docs/ARKITEKTUR.md läses
fil: CLAUDE.md läses
fil: _bmad-output/planning-artifacts/prd.md läses
fil: _bmad-output/planning-artifacts/epics.md läses
fil: _bmad-output/planning-artifacts/architecture.md läses
fil: _bmad-output/planning-artifacts/underlag/kodgranskning.md läses
fil: _bmad-output/planning-artifacts/underlag/davids-svar.md läses
fil: _bmad-output/planning-artifacts/underlag/kedjans-formagor.md läses
fil: _bmad-output/implementation-artifacts/4-4-kadensens-regressionsprov.md läses
beroende: vitest
beroende: supertest
beroende: pg
tjanst: 127.0.0.1:5433 vitest kör provfilen mot den stående testdatabasen
```

- **Tjänsten** är testdatabasen som kedjan cto kör hela sviten mot (underlaget om kedjans förmågor: proven får nå just den adressen). Utvecklarens sandlåda når den ofta inte; det är aldrig ett HALT-skäl (Tasks, «Utan kommandon»).
- **Inga kommandon.** Kedjan cto har ingen kommandoförmåga för byggaren (verktygen är Read, Glob, Grep, Write, Edit och TodoWrite). Kedjan kör själv `npm ci`, typecheck, build och hela testsviten efter din sista ändring, och ett rött test kommer tillbaka som fixrunda. Därför står inga kommandorader i blocket.
- **Inga berörs-rader.** Provvaktens statefil gick att läsa (senaste bokförda körningen 2026-10-22 06.30). Byggslingans urval är proven direkt under prov/ vars källtext nämner en ändrad eller ny modul som helt ord. Den enda nya kodfilen är provfilen `server/test/crm-gdpr-replay.test.ts`; inget prov i kopians hermes/prov nämner `crm-gdpr-replay` eller `gdpr-replay` (grep 2026-10-22: noll träffar). Driftens provkatalog gick inte att söka härifrån (sökningen utanför arbetskatalogen nekades), men kopians hermes/prov är driftens prov kopierade 2026-10-22 17.44. `docs/STATUS.md` är dokumentation och ingen modul, samma bedömning som berättelserna 1.3 och 4.4 gjorde för samma fil. Urvalet räknar dessutom bara Python-moduler som moduler, och ingen fil här är en sådan. Inte heller berättelsens text pekar ut något prov: inget namn i kodformat motsvarar en fil under hermes/prov. Inget prov är alltså berört, och ingen rad `prov:` står i blocket.
- **Läsfilerna:** `server/src/services/gdpr.ts` (`anonymizeParty` och `purgeCrmRelationData`, som skriver gravstenarna före raderingen), `server/src/services/crmRelations.ts` (`assertNotErased`, `recordInteraction`, `recordCommitment`, `upsertOrganization` och `matchCustomer`), `server/src/services/crmIngest.ts` (`ingestCrmEvents`: savepointen per händelse och `skipped`), `server/src/actions/registry.ts` (`anonymize_party` är `sensitive`, `ingest_crm_events` är `write`), `server/src/actions/execute.ts` och `server/src/http/routes/actions.ts` (godkännandet: bara en människa, 200 när åtgärden körts), `server/src/http/middleware/companyAccess.ts` (grannens anrop under vårt bolag ger 404), `server/src/db/pool.ts` (`pool` ansluter som rollen `app`), `server/src/db/tx.ts` (RLS-kontexten med `set_config`), `server/migrations/0054_crm_review_fixes.sql` (tabellen `crm.erased_sources`: kolumnerna, RLS och `GRANT SELECT, INSERT` utan UPDATE och DELETE). Förlagorna för provet är `server/test/gdpr.test.ts` (raderingen genom godkännandekön), `server/test/crm-schema.test.ts` (det befintliga enstaka återuppspelningsfallet), `server/test/crm-contractor-role.test.ts` (`asUser`: en fråga som rollen `app` med en användares RLS-kontext), `server/test/tenant-isolation.test.ts` (forcerat bolag utan medlemskap ger 0 rader) och `_bmad-output/implementation-artifacts/4-4-kadensens-regressionsprov.md` (berättelseformen för ett rent provbygge i samma kedja).
- **Inget kontrakt.** Berättelsen läser ingen annan dels rutt, fil eller funktion. Kontraktsregeln som provas (`docs/crm/API_KONTRAKT.md`, regel 4) är redovisningens egen.

## Acceptance Criteria

Lydelsen är epics.md:s (Story 8.3), ordagrant och numrerad; enda skillnaden är att provfilen i kriterium 4 står med full sökväg. Under varje kriterium står raden *Mätbart*: mekanismen som gör kriteriet sant genom konstruktion och den ändliga listan av fall i `server/test/crm-gdpr-replay.test.ts` som visar det. Varje fall har sitt namn först i titeln (R0, R1, G1, N1, K, KV, T1 …). Facit står i fallen som literaler ur fixturerna, aldrig hämtat ur koden som prövas; skälstexten skrivs in som en literal i provfilen och importeras inte ur `server/src/services/crmRelations.ts`.

1. **Given** en kund med kopplad organisation, en person, en kontaktpunkt och ett löfte, skapade genom `ingest_crm_events`
   **When** `anonymize_party` körs genom godkännandeflödet (`sensitive`) och samma batch sänds om
   **Then** varje händelse ligger i `skipped` med kontraktets textskäl om GDPR (*"källan är raderad enligt GDPR och får inte återskapas"*), och inga nya rader finns i `crm.people`, `crm.interactions` eller `crm.commitments` — läst både som rollen `app` och som ägare
   **And** felkoden `erased_source` står inte i batchsvaret
   - *Mätbart (Then):* Mekanismen är en enda väg in. Varje händelse i en batch har `kind` `interaction` eller `commitment` (schemats slutna lista i `ingest_crm_events`), och `ingestCrmEvents` skickar den förra till `recordInteraction` och den senare till `recordCommitment`. Båda börjar med `assertNotErased`, som kastar när paret `(source_system, source_ref)` finns i `crm.erased_sources` för bolaget. Organisationen och personen upsertas före det anropet, men inom händelsens savepoint, och `ROLLBACK TO SAVEPOINT crm_event` tar bort dem igen. Ingen rad överlever alltså en avvisad händelse. Fallistan är sluten, en händelse per sort: kontaktpunkten (`gdpr-r1`) och löftet (`gdpr-r2`). **R0** visar fixturen (kopplad organisation, en person, en kontaktpunkt, ett löfte; raderingen 202 i kön och 200 efter godkännandet med 1/1/1 borttagna). **R1** kräver att `skipped` är exakt två poster med index 0 och 1 och skälet ordagrant, och att alla räknare för skapat och oförändrat är 0. **R3** jämför ägarens radantal för bolaget (organisationer, personer, kon
```

## Utfall
Tester: 174 passed (174) · Granskning: GODKANT | Alla acceptanskriterier och kryssade uppgifter är uppfyllda; inga konkreta fel hittades och kedjans verifierade testutfall är grönt. · Byggforsok: 1

## Modellkedja (Davids krav 17/8, reservvag 7/9)

* krav: kordes inte
* utveckling: **gpt-6.1-sol**
* granskning: **gpt-6-astra**

Granskaren ar inte forfattaren: gpt-6-astra granskade gpt-6.1-sols arbete.

effort (Davids beslut 20/10): create-story high · validering high — planeringssteg
Allt pa Davids abonnemang - inga API-tokens.
