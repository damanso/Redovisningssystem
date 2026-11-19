# PRD-bygget crm 1-1-ursprung-per-falt-for-kontaktpunkter-loften-och-personens-alla-falt — PRD crm 1-1-ursprung-per-falt-for-kontaktpunkter-loften-och-personens-alla-falt: # Story 1.1: Urspru

Datum: 2026-11-19 20:49 · Branch: cto/prd-crm-1-1-ursprung-per-falt-for-kontaktpunkter-loften-och--9287 · Kalla: 02-Områden/hermes/prd/crm-1c-prd.md (fryst 29/9, Davids beslut #194)

## Mal
PRD crm 1-1-ursprung-per-falt-for-kontaktpunkter-loften-och-personens-alla-falt: # Story 1.1: Ursprung per fält för kontaktpunkter, löften och personens alla fält Status: ready-for-dev <!-- Note: Valid

## PRD-kravet (ordagrant ur den frysta PRD:n) och astras kodgranskning
```
# Story 1.1: Ursprung per fält för kontaktpunkter, löften och personens alla fält

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

Som David,
vill jag att varje fält på en kontaktpunkt och ett löfte bär sitt ursprung och skyddas när jag satt det,
så att en rättelse jag gjort aldrig skrivs över av nästa nattsynk med samma källnyckel.

Kodbas: redovisning (kedjan cto) · Täcker: FR-8 (avsteg 3 och 4), FR-26 (agentskrivningar har proveniens) · Beror på: — · Arkitektur: A-1 med tillägget «Samspel med sfären och migrationsnumret» (2026-11-19) · Grund för: 1.2 (rätta och bekräfta händelser), 1.9 (personens `external_ref` och `notes`), 3.3 (löftets livscykel hos mottagaren), 5.5 (AI-löften märks) och vyns K1/K7 på händelser.

**Skriven på nytt 2026-11-19 (create-story efter correct-course samma dag).** Berättelsen byggdes 2026-10-22 och godkändes, men koden kom aldrig in i main. Sedan 18/11 har main CRM-sfären i migrationerna 0087–0089. Berättelsen prövar därför först vad som redan finns i basen (Uppgift 0) och bygger bara det som saknas. Den nya migrationen tar nästa lediga nummer när den byggs, och provet hittar den på namnet `crm_event_provenance`. Koden går ihop med sfärfälten och bokföringsgränsen i 0087–0089 utan att ändra dem. Kriterierna är epics.md:s, ordagrant, och PRD:n rörs inte.

**Avgränsad 2026-11-19 (andra correct-course, efter att bygget #9286 stoppats).** Personens del, FR-8 avsteg 1 (`external_ref` och `notes` i `PERSON_PROVENANCE_FIELDS` och radlåset i `upsertPerson`), är utbruten till berättelse 1.9 med sitt kriterium ordagrant. Den här berättelsen rör inte `upsertPerson`. Titeln står kvar, eftersom berättelsens nyckel bildas av den. M7 prövar nu migrationen med en tillåtelselista över katalogens ändringar i stället för en lista över förbjudna ord. Skälen står i Dev Notes, «Beslutslogg (correct-course, andra varvet)».

## Förkrav

Bygget lägger en migration och en provfil, ändrar fyra källfiler i `server/src` och skriver i tre dokument. Det kräver ingen förmåga utöver kedjans: inget kommando, inget nät, inget nytt beroende och ingen ny tjänst. Sökvägarna är relativa kedjans bas (repots rot i /opt/redovisning). `<NNNN>` i migrationens namn är platshållaren som Uppgift 0 räknar fram: det högsta numret i `server/migrations/` plus ett (0090 i kopian 2026-11-19).

```förkrav
fil: server/migrations/<NNNN>_crm_event_provenance.sql ny
fil: server/test/crm-event-provenance.test.ts ny
fil: server/src/services/crmProvenance.ts ändras
fil: server/src/services/crmRelations.ts ändras
fil: server/src/services/crmIngest.ts ändras
fil: server/src/actions/registry.ts ändras
fil: docs/crm/API_KONTRAKT.md ändras
fil: docs/MCP_ACTIONS.md ändras
fil: docs/STATUS.md ändras
fil: server/migrations/0052_crm_schema.sql läses
fil: server/migrations/0057_crm_provenance.sql läses
fil: server/migrations/0087_crm_sfar_och_roll.sql läses
fil: server/migrations/0088_crm_privat_via_personen.sql läses
fil: server/migrations/0089_crm_privat_person_utanfor_kunden.sql läses
fil: server/src/services/crmSfar.ts läses
fil: server/src/services/crmSfarByte.ts läses
fil: server/src/services/crmPrivat.ts läses
fil: server/src/services/crmMerge.ts läses
fil: server/src/services/crmStadning.ts läses
fil: server/src/services/gdpr.ts läses
fil: server/src/lib/updateBuilder.ts läses
fil: server/src/lib/validation.ts läses
fil: server/src/lib/errors.ts läses
fil: server/src/http/view/routes.ts läses
fil: server/kontrakt/navigation.v1.json läses
fil: server/src/db/migrate.ts läses
fil: server/src/db/tx.ts läses
fil: server/src/actions/execute.ts läses
fil: server/test/helpers.ts läses
fil: server/test/env.ts läses
fil: server/vitest.config.ts läses
fil: server/test/uppdragsytan-migration-0082.test.ts läses
fil: server/test/crm-sfar.test.ts läses
fil: server/test/crm-sfar-3.test.ts läses
fil: server/test/crm-sfar-yta.test.ts läses
fil: server/test/crm-sandvag.test.ts läses
fil: server/test/sandvagHelper.ts läses
fil: server/test/crm-provenance.test.ts läses
fil: server/test/crm-review-fixes.test.ts läses
fil: server/test/crm-schema.test.ts läses
fil: server/test/crm-derivations.test.ts läses
fil: server/test/crm-gdpr-replay.test.ts läses
fil: server/test/crm-actions-ui.test.ts läses
fil: server/test/crm-thread.test.ts läses
fil: server/test/crm-today.test.ts läses
fil: server/test/min-sida.test.ts läses
fil: server/test/crm-name-alias.test.ts läses
fil: server/test/arende-projektkoppling.test.ts läses
fil: server/test/uppdragsytan-utskick.test.ts läses
fil: server/test/migrate.test.ts läses
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
prov: crmintag berörs GRÖN
prov: registreringsurval berörs GRÖN
prov: bakvag berörs GRÖN
prov: svepet berörs GRÖN
prov: manniskosparr berörs GRÖN
prov: handgrepp berörs GRÖN
prov: continuityvakt berörs GRÖN
```

- **Tjänsten** är testdatabasen som kedjan cto kör hela sviten mot. Enligt förteckningen över kedjans förmågor (härledd 2026-11-19 15.05) är det den enda adressen proven får nå. Utvecklarens sandlåda når den ofta inte, och det är aldrig ett HALT-skäl (Tasks, «Utan kommandon»).
- **Inga kommandon.** Enligt samma förteckning har byggaren bara verktygen Read, Glob, Grep, Write, Edit och TodoWrite, och kedjan cto kan varken köra kommandon, nå nätet eller lägga ett nytt beroende. Kedjan kör `npm ci`, typecheck, build och hela testsviten efter utvecklarens sista ändring, och ett rött test kommer tillbaka som fixrunda. Därför står inga kommandorader i blocket.
- **Berörs-raderna (baslinjen).** Byggslingans urval är proven direkt under prov/ vars källtext nämner en ändrad eller ny modul som helt ord: `crmProvenance`, `crmRelations`, `crmIngest`, `registry` eller migrationens och provfilens namn. I kopian 2026-11-19 gör sju prov det: crmintag (`crmRelations` och `registry`) samt registreringsurval, bakvag, svepet, manniskosparr, handgrepp och continuityvakt (`registry`). Provvaktens bokförda körning 2026-11-19 06.30 ger alla sju läget GRON, så inget av dem är rött eller okänt i baslinjen. De står i blocket som `berörs GRÖN` för att urvalet ska synas. Dokumentens namn (STATUS, API_KONTRAKT, MCP_ACTIONS) räknas inte som moduler, på samma sätt som i berättelse 1.3. Kedjan cto kör inga Hermes-prov, och bygget rör ingen Hermes-fil.
- **Läsfilerna** utöver de ändrade:
  - Migrationerna 0052 och 0057 ger händelsetabellernas kolumner och tabellen `crm.field_provenance` med dess CHECK, partiella unika index och RLS. 0052 saknar `UNIQUE (id, company_id)` på `crm.interactions` och `crm.commitments`, så migrationen måste lägga till dem före de sammansatta främmande nycklarna.
  - Migrationerna 0087–0089 och `server/src/services/crmSfar.ts`, `server/src/services/crmSfarByte.ts` och `server/src/services/crmPrivat.ts` är sfären och bokföringsgränsen. Bygget läser dem för att gå ihop med dem utan att ändra dem (Dev Notes, «Sfären och gränserna»).
  - `server/src/services/crmMerge.ts`, `server/src/services/crmStadning.ts` och `server/src/services/gdpr.ts` är de andra skrivarna av händelse- och persontabellerna. De läses för tabellen «Den enda vägen in» och ändras inte.
  - `server/src/lib/updateBuilder.ts` ger `buildAllowlistedUpdate`, `server/src/db/migrate.ts` ger `loadMigrations` och typen `MigrationFile`, och `server/src/db/tx.ts` ger `withTenantTransaction` för fallen som körs som rollen `app`.
  - Provfilerna under `server/test` är förebilder (`server/test/uppdragsytan-migration-0082.test.ts` för en migration prövad som migration, `server/test/crm-sfar-3.test.ts` för två samtidiga transaktioner) o
```

## Utfall
Tester: 180 passed (180) · Granskning: GODKANT | Samtliga acceptanskriterier och kryssade uppgifter är uppfyllda; inga konkreta fynd identifierades, och kedjans typecheck och testsvit är gröna. · Byggforsok: 1

## Modellkedja (Davids krav 17/8, reservvag 7/9)

* krav: kordes inte
* utveckling: **gpt-6.1-sol**
* granskning: **gpt-6-astra**

Granskaren ar inte forfattaren: gpt-6-astra granskade gpt-6.1-sols arbete.

effort (Davids beslut 20/10): validering high — planeringssteg
Allt pa Davids abonnemang - inga API-tokens.
