# PRD-bygget crm 1-3-ursprunget-syns-for-varje-uppgift-pa-relationssidan — PRD crm 1-3-ursprunget-syns-for-varje-uppgift-pa-relationssidan: # Story 1.3: Ursprunget syns för va

Datum: 2026-11-19 21:48 · Branch: cto/prd-crm-1-3-ursprunget-syns-for-varje-uppgift-pa-relationssi-9288 · Kalla: 02-Områden/hermes/prd/crm-1c-prd.md (fryst 29/9, Davids beslut #194)

## Mal
PRD crm 1-3-ursprunget-syns-for-varje-uppgift-pa-relationssidan: # Story 1.3: Ursprunget syns för varje uppgift på relationssidan Status: ready-for-dev <!-- Note: Validation is optional

## PRD-kravet (ordagrant ur den frysta PRD:n) och astras kodgranskning
```
# Story 1.3: Ursprunget syns för varje uppgift på relationssidan

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

Som David,
vill jag se på varje uppgift om den är mitt beslut, ett faktum ur bokföringen, en gissning eller av okänt ursprung — och kunna bekräfta den med ett klick,
så att en gissning aldrig ser ut som något jag bestämt.

Kodbas: redovisning (kedjan cto) · Täcker: FR-9 (status, personernas fält och värden utan ursprungsrad), FR-10 (status rättas och bekräftas; vyprovet), FR-8 (avsteg 2 synliggjort, utan bakåtfyllnad) · Beror på: — · Arkitektur: Frontend Architecture («`ursprungsMark` utökas», K1) och strukturtabellen («Gemensam vyform (K1, K5): en funktion i `server/src/http/view/routes.ts` bredvid `ursprungsMark`») · Grund för: 1.2 (söker på `assertPersonInOrganization` och på hjälpfunktionen som anropar `ursprungsMark` och `behoverBekraftas`), 1.4, 1.5, 1.8 och 4.3.

**Skriven på nytt 2026-11-19 (create-story efter correct-course samma dag).** Berättelsen byggdes 2026-10-22 och godkändes, men koden kom aldrig in i main, och berättelsefilen finns inte längre i arbetskopian. Den här texten är skriven från grunden ur epics.md (Story 1.3, med correct-course-raden 2026-11-19), correct-course-förslaget för 1.3, valideringen 2026-10-22 och koden i arbetskopian. Sedan 18/11 har main CRM-sfären (migrationerna 0087–0089), och kortet *Uppgifter* har raderna Sfär och Roll. Sedan 19/11 har main också berättelse 1.1 (migrationen 0090, ursprung för kontaktpunkter och löften). Bygget prövar först vad som redan finns i basen (Uppgift 0) och bygger bara det som saknas. Det lägger ingen migration, ingen ny rutt, ingen ny åtgärd och inget nytt schema. Sfären ändras inte. Kriterierna är epics.md:s, ordagrant, och PRD:n rörs inte.

## Förkrav

Bygget ändrar två källfiler i `server/src`, en provfil och sessionsloggen. Det kräver ingen förmåga utöver kedjans: inget kommando, inget nät, inget nytt beroende och ingen ny tjänst. Sökvägarna är relativa kedjans bas (repots rot i /opt/redovisning).

```förkrav
fil: server/src/http/view/routes.ts ändras
fil: server/src/services/crmRelations.ts ändras
fil: server/test/crm-views.test.ts ändras
fil: docs/STATUS.md ändras
fil: server/src/services/crmProvenance.ts läses
fil: server/src/actions/registry.ts läses
fil: server/src/actions/execute.ts läses
fil: server/src/http/view/html.ts läses
fil: server/src/http/view/auth.ts läses
fil: server/src/db/tx.ts läses
fil: server/src/lib/errors.ts läses
fil: server/src/lib/validation.ts läses
fil: server/src/services/crmSfar.ts läses
fil: server/src/services/crmSfarByte.ts läses
fil: server/src/services/crmPrivat.ts läses
fil: server/migrations/0052_crm_schema.sql läses
fil: server/migrations/0057_crm_provenance.sql läses
fil: server/migrations/0087_crm_sfar_och_roll.sql läses
fil: server/migrations/0088_crm_privat_via_personen.sql läses
fil: server/migrations/0089_crm_privat_person_utanfor_kunden.sql läses
fil: server/migrations/0090_crm_event_provenance.sql läses
fil: server/kontrakt/navigation.v1.json läses
fil: server/test/helpers.ts läses
fil: server/test/env.ts läses
fil: server/test/crm-provenance.test.ts läses
fil: server/test/crm-design-parity.test.ts läses
fil: server/test/statusetiketter.test.ts läses
fil: server/test/crm-thread.test.ts läses
fil: server/test/crm-cadence-merge-search.test.ts läses
fil: server/test/crm-name-alias.test.ts läses
fil: server/test/crm-review-fixes.test.ts läses
fil: server/test/entity-links.test.ts läses
fil: server/test/crm-sfar-3.test.ts läses
fil: server/test/crm-event-provenance.test.ts läses
fil: server/test/crm-sandvag.test.ts läses
fil: server/test/sandvagHelper.ts läses
fil: server/test/uppdragsytan-utskick.test.ts läses
fil: server/test/utskickHelper.ts läses
fil: server/test/uppdragsytan-beslut.test.ts läses
fil: server/test/uppdragsytan-godkannandevag.test.ts läses
fil: server/test/radlangd.test.ts läses
fil: server/test/crm-finish.test.ts läses
fil: docs/MCP_ACTIONS.md läses
fil: docs/project-context.md läses
fil: docs/ARKITEKTUR.md läses
fil: CLAUDE.md läses
fil: _bmad-output/planning-artifacts/prd.md läses
fil: _bmad-output/planning-artifacts/epics.md läses
fil: _bmad-output/planning-artifacts/architecture.md läses
fil: _bmad-output/planning-artifacts/underlag/davids-svar.md läses
beroende: pg
beroende: vitest
beroende: supertest
tjanst: 127.0.0.1:5433 vitest kör provfilerna mot den stående testdatabasen
prov: adresskontraktet berörs RÖD
prov: bmadglidning berörs RÖD
prov: designsvep berörs GRÖN
prov: hushallet_fr36 berörs GRÖN
prov: r5_soktjansten_fr6 berörs GRÖN
prov: redovisning_fortroende_prov berörs GRÖN
prov: rollpassen_fr41 berörs GRÖN
prov: rollpassen_fr43 berörs GRÖN
prov: crmintag berörs GRÖN
```

- **Tjänsten** är testdatabasen som kedjan cto kör hela sviten mot. Enligt förteckningen över kedjans förmågor (härledd 2026-11-19 20.55) är det den enda adressen proven får nå. Utvecklarens sandlåda når den ofta inte, och det är aldrig ett HALT-skäl (Tasks, «Utan kommandon»).
- **Inga kommandon.** Byggaren har bara Read, Glob, Grep, Write, Edit och TodoWrite, och kedjan cto kan varken köra kommandon åt byggaren, nå nätet eller lägga ett nytt beroende. Kedjan kör `npm ci`, typecheck, build och hela testsviten efter utvecklarens sista ändring, och ett rött test kommer tillbaka som fixrunda. Därför står inga kommandorader i blocket.
- **Berörs-raderna (baslinjen).** Byggslingans urval är proven direkt under prov/ vars källtext nämner en ändrad modul som helt ord: `routes` eller `crmRelations` (provfilen och sessionsloggen räknas inte som moduler). I kopian 2026-11-19 gör nio prov det: adresskontraktet, bmadglidning, designsvep, hushallet_fr36, r5_soktjansten_fr6, redovisning_fortroende_prov, rollpassen_fr41 och rollpassen_fr43 (`routes`) samt crmintag (`crmRelations`). Provvaktens bokförda körning 2026-11-19 (körningen 814cb50e524f) ger adresskontraktet RÖD sedan 2026-11-10 («ägare saknas») och bmadglidning RÖD sedan 2026-10-13. Båda var röda före bygget och av skäl utanför det: bygget lägger ingen rutt och rör inte navigationskontraktet. De sju andra är GRÖNA och står i blocket för att urvalet ska synas. Kedjan cto kör inga Hermes-prov, och bygget rör ingen Hermes-fil.
- **Läsfilerna** utöver de ändrade:
  - `server/src/services/crmProvenance.ts` ger typen `ProvenanceSource`, `confirmValue` och `guardHumanFields`. `server/src/actions/registry.ts` ger schemat för `confirm_crm_value` och `upsert_crm_organization`. `server/src/actions/execute.ts` ger `executeAction`, som parsar schemat före transaktionen.
  - `server/src/http/view/html.ts` ger `chip`, `html`, `Raw` och klasserna `.uppgift`, `.person`, `.person__n`, `.person__r`, `.person__e`, `.prov`, `.prov--guess` och `.prov--fact`. Inga nya klasser behövs. `server/src/http/view/auth.ts` ger `page()`, som gör ett `AppError` till sin status och allt annat till 500.
  - `server/src/db/tx.ts` ger `withTenantTransaction`. `server/src/lib/errors.ts` ger `NotFoundError`, och `server/src/lib/validation.ts` ger `UuidSchema`.
  - Migrationen 0052 ger CHECK-villkoret för intagets källsystem (den slutna listan som `kanalKalla` översätter). Migrationerna 0057 och 0090 ger `crm.field_provenance` med dess partiella unika index, som provets planteringar går mot; kolumnen `field` har inget CHECK, så `sfar` går att plantera (Y1). Migrationerna 0087–0089 och `server/src/services/crmSfar.ts`, `server/src/services/crmSfarByte.ts` och `server/src/services/crmPrivat.ts` är sfären. Bygget läser dem för att gå ihop med dem utan att ändra dem.
  - `server/kontrakt/navigation.v1.json` bär redan rutten `POST /c/:companyId/relations/:id/confirm` (ägare `relations`). Bygget lägger ingen ny rutt och ändrar inte filen.
  - Provfilerna under `server/test` är förebilder och regressionsytan (Dev Notes, «Regressionsytan»).
- **Inget kontrakt.** Berättelsen läser ingen annan dels rutt, fil eller funktion, och den ändrar in
```

## Utfall
Tester: 180 passed (180) · Granskning: GODKANT | Alla sex acceptanskriterier är implementerade, de kryssade uppgifterna har belägg och inga konkreta fel har identifierats. · Byggforsok: 1

## Modellkedja (Davids krav 17/8, reservvag 7/9)

* krav: kordes inte
* utveckling: **gpt-6.1-sol**
* granskning: **gpt-6-astra**

Granskaren ar inte forfattaren: gpt-6-astra granskade gpt-6.1-sols arbete.

effort (Davids beslut 20/10): create-story high · validering high — planeringssteg
Allt pa Davids abonnemang - inga API-tokens.
