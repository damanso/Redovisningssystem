# PRD-bygget crm 1-2-ratta-och-bekrafta-en-kontaktpunkt-eller-ett-lofte — PRD crm 1-2-ratta-och-bekrafta-en-kontaktpunkt-eller-ett-lofte: # Story 1.2: Rätta och bekräfta en k

Datum: 2026-11-20 02:42 · Branch: cto/prd-crm-1-2-ratta-och-bekrafta-en-kontaktpunkt-eller-ett-lof-9289 · Kalla: 02-Områden/hermes/prd/crm-1c-prd.md (fryst 29/9, Davids beslut #194)

## Mal
PRD crm 1-2-ratta-och-bekrafta-en-kontaktpunkt-eller-ett-lofte: # Story 1.2: Rätta och bekräfta en kontaktpunkt eller ett löfte Status: ready-for-dev <!-- Note: Validation is optional.

## PRD-kravet (ordagrant ur den frysta PRD:n) och astras kodgranskning
```
# Story 1.2: Rätta och bekräfta en kontaktpunkt eller ett löfte

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

Som David,
vill jag kunna rätta eller bekräfta en kontaktpunkt eller ett löfte direkt i tråden och i åtagandevyn,
så att det jag bestämt om en händelse räknas som mitt beslut och står kvar, medan fält jag inte rört fortsätter följa källan.

Kodbas: redovisning (kedjan cto) · Täcker: FR-8 (ett rättat fält på en kontaktpunkt eller ett löfte står kvar), FR-9 (en gissning på en händelse bekräftas med ett klick), FR-36 (människoskyddet gäller status, text, riktning och deadline var för sig) · Beror på: 1.1 och 1.3, båda inbyggda i main sedan 2026-11-19 (sammanslagningarna 061d98c och 71ac62a, leads besked 19/11 kl. 22:10; Uppgift 0 prövar dem på namn) · Arkitektur: K-7 (architecture.md, API & Communication Patterns), A-1 (ursprungsregeln) · UX: K1 (raderna för löfte och kontaktpunkt), K5 (tillägget *· rättad av dig*), K7 (*Rätta*) · Grund för: 3.3 (vaktens regel för ett uttryckligt `null`), 5.5 (AI-löften bekräftas med samma knapp).

## Förkrav

Bygget lägger två nya åtgärder och utökar en, ändrar fyra filer i `server/src` och lägger en ny ren hjälpmodul i `server/src/lib`, utökar två befintliga provfiler och lägger en ny för hjälpmodulens enhetsprov, och uppdaterar två dokument. Ingen migration: tabellen och målkolumnerna för händelsernas ursprung finns i main sedan 1.1, i migrationen `server/migrations/0090_crm_event_provenance.sql` (numren 0087–0089 bär CRM-sfären). Skulle bygget ändå behöva en migration tar den nästa lediga nummer vid bygget (högsta numret i kopian plus ett), aldrig ett nummer ur den här texten. En enda ny rutt, `POST /c/:companyId/commitments/:id/confirm`, bär *Stämmer* för ett löfte utan relation (kriterium 7); alla andra nya formulär postar till relationens befintliga rutter. Navigationskontraktet redigeras inte för hand (Dev Notes, «Rutterna»). Det kräver ingen förmåga utöver kedjans: inget kommando, inget nät, inget nytt beroende och ingen ny tjänst. Sökvägarna är relativa kedjans bas (repots översta katalog i /opt/redovisning).

```förkrav
fil: server/src/services/crmRelations.ts ändras
fil: server/src/services/crmProvenance.ts ändras
fil: server/src/actions/registry.ts ändras
fil: server/src/http/view/routes.ts ändras
fil: server/src/lib/crmRules.ts ny
fil: server/test/crm-event-provenance.test.ts ändras
fil: server/test/crm-views.test.ts ändras
fil: server/test/crm-rules.test.ts ny
fil: docs/MCP_ACTIONS.md ändras
fil: docs/STATUS.md ändras
fil: _bmad-output/implementation-artifacts/sprint-status.yaml ändras
fil: server/src/services/crmThread.ts läses
fil: server/src/services/crmIngest.ts läses
fil: server/src/services/parties.ts läses
fil: server/src/lib/updateBuilder.ts läses
fil: server/src/lib/validation.ts läses
fil: server/src/lib/errors.ts läses
fil: server/src/actions/execute.ts läses
fil: server/src/db/tx.ts läses
fil: server/src/http/view/html.ts läses
fil: server/src/http/view/auth.ts läses
fil: server/kontrakt/navigation.v1.json läses
fil: server/migrations/0052_crm_schema.sql läses
fil: server/migrations/0057_crm_provenance.sql läses
fil: server/migrations/0087_crm_sfar_och_roll.sql läses
fil: server/migrations/0088_crm_privat_via_personen.sql läses
fil: server/migrations/0089_crm_privat_person_utanfor_kunden.sql läses
fil: server/migrations/0090_crm_event_provenance.sql läses
fil: server/src/services/crmSfar.ts läses
fil: server/test/crm-sfar.test.ts läses
fil: server/test/crm-sfar-3.test.ts läses
fil: server/test/crm-sfar-yta.test.ts läses
fil: server/test/uppdragsytan-utskick.test.ts läses
fil: server/test/utskickHelper.ts läses
fil: server/test/kvittobilagor-lagring.test.ts läses
fil: server/test/vat-declaration.test.ts läses
fil: server/test/uppdragsytan-undantag.test.ts läses
fil: server/test/uppdragsytan-beslut.test.ts läses
fil: server/test/uppdragsytan-baselineorsak.test.ts läses
fil: server/test/uppdragsytan-godkannandevag.test.ts läses
fil: server/test/helpers.ts läses
fil: server/test/env.ts läses
fil: server/vitest.config.ts läses
fil: server/package.json läses
fil: server/test/crm-thread.test.ts läses
fil: server/test/crm-provenance.test.ts läses
fil: server/test/crm-design-parity.test.ts läses
fil: server/test/crm-review-fixes.test.ts läses
fil: server/test/crm-actions-ui.test.ts läses
fil: server/test/crm-today.test.ts läses
fil: server/test/crm-schema.test.ts läses
fil: server/test/crm-finish.test.ts läses
fil: server/test/crm-cadence-merge-search.test.ts läses
fil: server/test/crm-name-alias.test.ts läses
fil: server/test/entity-links.test.ts läses
fil: server/test/crm-stadning.test.ts läses
fil: server/test/statusetiketter.test.ts läses
fil: server/test/actions.test.ts läses
fil: server/test/payroll-tax-dublett.test.ts läses
fil: server/test/crm-sandvag.test.ts läses
fil: server/test/sandvagHelper.ts läses
fil: server/test/party-update.test.ts läses
fil: docs/project-context.md läses
fil: docs/ARKITEKTUR.md läses
fil: docs/crm/API_KONTRAKT.md läses
fil: CLAUDE.md läses
fil: _bmad-output/planning-artifacts/prd.md läses
fil: _bmad-output/planning-artifacts/epics.md läses
fil: _bmad-output/planning-artifacts/architecture.md läses
fil: _bmad-output/planning-artifacts/ux-design-specification.md läses
fil: _bmad-output/planning-artifacts/underlag/kodgranskning.md läses
fil: _bmad-output/planning-artifacts/underlag/davids-svar.md läses
fil: _bmad-output/planning-artifacts/underlag/kedjans-formagor.md läses
fil: _bmad-output/implementation-artifacts/1-1-ursprung-per-falt-for-kontaktpunkter-loften-och-personens-alla-falt.md läses
fil: _bmad-output/implementation-artifacts/1-3-ursprunget-syns-for-varje-uppgift-pa-relationssidan.md läses
fil: _bmad-output/planning-artifacts/sprint-change-proposal-1-2-ratta-och-bekrafta-en-kontaktpunkt-eller-ett-lofte.md läses
beroende: pg
beroende: express
beroende: zod
beroende: zod-to-json-schema
beroende: vitest
beroende: supertest
tjanst: 127.0.0.1:5433 vitest kör provfilerna mot den stående testdatabasen
prov: adresskontraktet berörs RÖD
prov: bmadglidning berörs RÖD
prov: crmintag berörs RÖD
prov: bakvag berörs GRÖN
prov: continuityvakt berörs GRÖN
prov: designsvep berörs GRÖN
prov: handgrepp berörs GRÖN
prov: hushallet_fr36 berörs GRÖN
prov: manniskosparr berörs GRÖN
prov: r5_soktjansten_fr6 berörs GRÖN
prov: redovisning_fortroende_prov berörs GRÖN
prov: registreringsurval berörs GRÖN
prov: rollpassen_fr41 berörs GRÖN
prov: rollpassen_fr43 berörs GRÖN
prov: svepet berörs GRÖN
```

- **Tjänsten** är testdatabasen som kedjan cto kör hela sviten mot (underlaget om kedjans förmågor: proven får nå just den adressen). Utvecklarens sandlåda når den ofta inte; det är aldrig ett HALT-skäl (Tasks, «Utan kommandon»).
- **Inga kommandon.** Kedjan cto kan inte köra kommandon åt byggaren. Den kör själv `npm ci`, typecheck, build och hela testsviten efter utvecklarens sista ändring, och ett rött test kommer tillbaka som fixrunda. Därför står inga kommandorader i blocket.
- **Beroendena** finns redan i `server/package.json` och används som de är: pg för tjänsternas satser, express för vyns två befintliga POST-rutter, zod för de två nya schemana och det utökade, zod-to-json-schema för åtgärdsmanifestet som fall B6 läser, vitest och supertest för proven. Inget nytt paket. Förkontrollens K5 läser beroendena ur manifestet i repots översta katalog, och det manifestet har inga beroenden (paketen står i arbetsytans manifest `server/package.json`). Körs förkontrollen ger raderna där RÖD med domen «david» fast inget paket är nytt; 1.1 och 1.3 har samma rader. Det är en gräns i förkontrollen och inget skäl att stanna: bygget lägger inget beroende.
- **Berörs-raderna** kommer ur provvaktens senaste bokförda körning (provvaktens statefil, körningen 2026-10-22 06.30), som gick att läsa då. Byggslingans urval är proven direkt under prov/ vars källtext nämner en ändrad modul som helt ord: `routes`, 
```

## Utfall
Tester: 181 passed (181) · Granskning: GODKANT | Alla åtta acceptanskriterier är implementerade, tidigare HIGH-fynd är åtgärdade och inga nya belagda fynd kvarstår. · Byggforsok: 3

## Modellkedja (Davids krav 17/8, reservvag 7/9)

* krav: kordes inte
* utveckling: **gpt-6.1-sol**
* granskning: **gpt-6-astra**

Granskaren ar inte forfattaren: gpt-6-astra granskade gpt-6.1-sols arbete.

effort (Davids beslut 20/10): validering high — planeringssteg
Allt pa Davids abonnemang - inga API-tokens.
