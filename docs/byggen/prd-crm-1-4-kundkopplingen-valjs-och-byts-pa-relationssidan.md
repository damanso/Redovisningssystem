# PRD-bygget crm 1-4-kundkopplingen-valjs-och-byts-pa-relationssidan — PRD crm 1-4-kundkopplingen-valjs-och-byts-pa-relationssidan: # Story 1.4: Kundkopplingen väljs och b

Datum: 2026-11-20 04:36 · Branch: cto/prd-crm-1-4-kundkopplingen-valjs-och-byts-pa-relationssidan-9290 · Kalla: 02-Områden/hermes/prd/crm-1c-prd.md (fryst 29/9, Davids beslut #194)

## Mal
PRD crm 1-4-kundkopplingen-valjs-och-byts-pa-relationssidan: # Story 1.4: Kundkopplingen väljs och byts på relationssidan Status: ready-for-dev <!-- Note: Validation is optional. Ru

## PRD-kravet (ordagrant ur den frysta PRD:n) och astras kodgranskning
```
# Story 1.4: Kundkopplingen väljs och byts på relationssidan

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

Som David,
vill jag välja eller byta kund i registret från *Rätta uppgifter*,
så att kopplingen blir rätt utan att jag öppnar kundkortet.

Kodbas: redovisning (kedjan cto) · Täcker: FR-10 (kundkopplingen väljs, byts och bekräftas från relationssidan), FR-8 (bara ändrade fält blir människobeslut) · Beror på: 1.3 (done; `ursprungsfalt`, statusraden och vyprovet finns i basen) · Arkitektur: Format Patterns («utelämnat fält i en skrivning betyder oförändrat»), Process Patterns (validering med `Object.hasOwn`-vakt, «en krock fångas aldrig med try/catch — SELECT först»), Navigation («Öppna ett hopfällt formulär via adress», `?oppna=`) och UX K2 (*Kund i registret* i *Rätta uppgifter*, *Ej i kundregistret* som länk) · Grund för: 1.6 (statusen vid kundkoppling), 1.8 (org.nr för en kopplad relation) och 2.1 (`?oppna=` för sammanslagningen).

Berättelsen skrevs 2026-11-20 ur epics.md (Story 1.4, ordagrant), PRD:ns FR-10 och FR-8, arkitekturen, UX-specifikationen (K2 och «Öppna formulär via adress»), föregående berättelser 1.2 och 1.3 och koden i arbetskopian. Bygget lägger ingen migration, ingen ny rutt, ingen ny åtgärd och ingen ny CSS-klass. Det ändrar en åtgärds schema på ett bakåtkompatibelt sätt (`name` får utelämnas när `organization_id` anges); skälet står i Dev Notes, «Åtgärdens schema».

## Förkrav

Bygget ändrar fyra källfiler i `server/src`, två provfiler och tre dokument. Det kräver ingen förmåga utöver kedjans: inget kommando, inget nät, inget nytt beroende och ingen ny tjänst. Sökvägarna är relativa kedjans bas (repots översta katalog, /opt/redovisning).

```förkrav
fil: server/src/lib/crmRules.ts ändras
fil: server/src/services/crmRelations.ts ändras
fil: server/src/actions/registry.ts ändras
fil: server/src/http/view/routes.ts ändras
fil: server/test/crm-rules.test.ts ändras
fil: server/test/crm-views.test.ts ändras
fil: docs/MCP_ACTIONS.md ändras
fil: docs/crm/API_KONTRAKT.md ändras
fil: docs/STATUS.md ändras
fil: server/src/services/parties.ts läses
fil: server/src/services/crmProvenance.ts läses
fil: server/src/services/crmSfar.ts läses
fil: server/src/services/crmIngest.ts läses
fil: server/src/actions/execute.ts läses
fil: server/src/http/view/html.ts läses
fil: server/src/http/view/auth.ts läses
fil: server/src/http/middleware/errorHandler.ts läses
fil: server/src/db/tx.ts läses
fil: server/src/lib/errors.ts läses
fil: server/src/lib/validation.ts läses
fil: server/migrations/0052_crm_schema.sql läses
fil: server/migrations/0057_crm_provenance.sql läses
fil: server/migrations/0087_crm_sfar_och_roll.sql läses
fil: server/kontrakt/navigation.v1.json läses
fil: server/test/helpers.ts läses
fil: server/test/env.ts läses
fil: server/test/crm-provenance.test.ts läses
fil: server/test/crm-design-parity.test.ts läses
fil: server/test/crm-sfar.test.ts läses
fil: server/test/crm-sfar-3.test.ts läses
fil: server/test/crm-sfar-yta.test.ts läses
fil: server/test/crm-schema.test.ts läses
fil: server/test/crm-cadence-merge-search.test.ts läses
fil: server/test/crm-name-alias.test.ts läses
fil: server/test/crm-event-provenance.test.ts läses
fil: server/test/crm-review-fixes.test.ts läses
fil: server/test/entity-links.test.ts läses
fil: server/test/mcp.test.ts läses
fil: server/test/crm-sandvag.test.ts läses
fil: server/test/sandvagHelper.ts läses
fil: server/test/uppdragsytan-utskick.test.ts läses
fil: server/test/utskickHelper.ts läses
fil: server/test/uppdragsytan-beslut.test.ts läses
fil: server/test/uppdragsytan-godkannandevag.test.ts läses
fil: server/test/radlangd.test.ts läses
fil: server/test/crm-finish.test.ts läses
fil: server/test/kvittobilagor-lagring.test.ts läses
fil: server/test/vat-declaration.test.ts läses
fil: server/test/uppdragsytan-undantag.test.ts läses
fil: server/test/uppdragsytan-baselineorsak.test.ts läses
fil: docs/project-context.md läses
fil: docs/ARKITEKTUR.md läses
fil: CLAUDE.md läses
fil: _bmad-output/planning-artifacts/prd.md läses
fil: _bmad-output/planning-artifacts/epics.md läses
fil: _bmad-output/planning-artifacts/architecture.md läses
fil: _bmad-output/planning-artifacts/ux-design-specification.md läses
fil: _bmad-output/planning-artifacts/underlag/davids-svar.md läses
beroende: pg
beroende: express
beroende: zod
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
prov: bakvag berörs GRÖN
prov: continuityvakt berörs GRÖN
prov: handgrepp berörs GRÖN
prov: manniskosparr berörs GRÖN
prov: registreringsurval berörs GRÖN
prov: svepet berörs GRÖN
prov: ovrigtforslag berörs GRÖN
```

- **Tjänsten** är testdatabasen som kedjan cto kör hela sviten mot. Enligt förteckningen över kedjans förmågor (härledd 2026-11-20 02.45) är det den enda adressen proven får nå. Utvecklarens sandlåda når den ofta inte, och det är aldrig ett HALT-skäl (Tasks, «Utan kommandon»).
- **Inga kommandon.** Byggaren har bara Read, Glob, Grep, Write, Edit och TodoWrite, och kedjan cto kan varken köra kommandon åt byggaren, nå nätet eller lägga ett nytt beroende. Kedjan kör `npm ci`, typecheck, build och hela testsviten efter utvecklarens sista ändring, och ett rött test kommer tillbaka som fixrunda. Därför står inga kommandorader i blocket.
- **Beroendena** finns redan i serverns paketmanifest; inget paket läggs till. Förkontrollens K5 läser beroendena ur manifestet i repots översta katalog, som bara har arbetsytorna och inga beroenden. Körs förkontrollen kan raderna därför bli RÖDA med domen «david», fast inget paket är nytt; 1.1, 1.2 och 1.3 har samma rader. Det är en gräns i förkontrollen och inget skäl att stanna.
- **Berörs-raderna (baslinjen).** Byggslingans urval är proven direkt under prov/ vars källtext nämner en ändrad modul som helt ord: `routes` (adresskontraktet, bmadglidning, designsvep, hushallet_fr36, r5_soktjansten_fr6, redovisning_fortroende_prov, rollpassen_fr41, rollpassen_fr43), `crmRelations` (crmintag) och `registry` (bakvag, continuityvakt, crmintag, handgrepp, manniskosparr, registreringsurval, svepet). `crmRules` nämns inte av något prov. Dokumentet MCP_ACTIONS nämns dessutom av handgrepp och ovrigtforslag; ovrigtforslag står med för säkerhets skull, fast dokument inte räknas som moduler. Provvaktens statefil (provvakt.json i Hermes state-katalog) gick att läsa: i den senaste bokförda körningen (814cb50e524f, 2026-11-19 06.30) är adresskontraktet RÖD sedan 2026-11-10 och bmadglidning RÖD sedan 2026-10-13. Båda var röda före bygget och av skäl utanför det: bygget lägger ingen rutt och rör inte navigationskontraktet. De övriga fjorton är GRÖNA och står i blocket för att urvalet ska synas. Kedjan cto kör inga Hermes-prov under bygget, och bygget rör ingen Hermes-fil.
- **Läsfilerna** utöver de ändrade:
  - `server/src/services/parties.ts` ger `listCustomers` (aktiva kunder i kundnummerordning; `includeInactive` tar med de inaktiva) och kundens kolumner (`customer_number`, `is_active`). `server/src/services/crmProvenance.ts` ger `guardHumanFields` och `recordProvenance`. `server/src/services/crmSfar.ts` ger `privatGransFel` (ett `BadRequestError` med koden `privat_bokforingsgrans`). `server/src/services/crmIngest.ts` anropar `upsertOrganization` med namn och utan `customer_id`.
  - `server/src/actions/execute.ts` ger `executeAction`, som parsar schemat före transaktionen och rullar tillbaka allt vid ett fel. `server/src/http/middleware/errorHandler.ts` gör ett `AppError` till `{ error, details }` och pg-koden 23505 till 409 `conflict` (det dagens kundkrock ger).
  - `server/src
```

## Utfall
Tester: 181 passed (181) · Granskning: GODKANT | Samtliga acceptanskriterier är implementerade, tidigare fynd är åtgärdade och inga nya belagda fel hittades. · Byggforsok: 3

## Modellkedja (Davids krav 17/8, reservvag 7/9)

* krav: kordes inte
* utveckling: **gpt-6.1-sol**
* granskning: **gpt-6-astra**

Granskaren ar inte forfattaren: gpt-6-astra granskade gpt-6.1-sols arbete.

effort (Davids beslut 20/10): create-story high · validering high — planeringssteg
Allt pa Davids abonnemang - inga API-tokens.
