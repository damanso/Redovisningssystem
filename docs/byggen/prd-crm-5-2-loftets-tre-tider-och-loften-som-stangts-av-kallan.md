# PRD-bygget crm 5-2-loftets-tre-tider-och-loften-som-stangts-av-kallan — PRD crm 5-2-loftets-tre-tider-och-loften-som-stangts-av-kallan: # Story 5.2: Löftets tre tider, och 

Datum: 2026-11-22 19:24 · Branch: cto/prd-crm-5-2-loftets-tre-tider-och-loften-som-stangts-av-kall-9333 · Kalla: 02-Områden/hermes/prd/crm-1c-prd.md (fryst 29/9, Davids beslut #194)

## Mal
PRD crm 5-2-loftets-tre-tider-och-loften-som-stangts-av-kallan: # Story 5.2: Löftets tre tider, och löften som stängts av källan Status: ready-for-dev <!-- Note: Validation is optional

## PRD-kravet (ordagrant ur den frysta PRD:n) och astras kodgranskning
```
# Story 5.2: Löftets tre tider, och löften som stängts av källan

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

Som David,
vill jag se när ett löfte gavs, när det registrerades och när det förfaller — och om det var källan eller jag som stängde det,
så att jag kan styrka löftet och inte blandar ihop tre tider.

Kodbas: redovisning (kedjan cto) · Täcker: FR-31 (löftestid, registreringstid och förfallodatum var för sig), FR-2 (mellanläget för ärendelöftenas löftestid), FR-36 (ett löfte stängt av källan står inte kvar som öppet och ser inte ut som Davids handgrepp) · Beror på: 3.3 och 4.2 (båda done; deras kod finns i kopian: statusens ursprung skrivs av `recordCommitment`, och `kallrad` med `KALLNYCKEL` finns i `server/src/http/view/routes.ts`) · Arkitektur: «Frontend Architecture» (en hjälpfunktion per återkommande form, `kallrad()`), A-1 och A-2 (statusens ursprung), tabellen över åtgärder (`list_crm_commitments` returnerar `occurred_at` och `created_at`) · UX: K9 (åtagandevyns rad), Resa 7 och «Siffror, datum och tid» (löftets tre tider har tre namn överallt).

## Förkrav

Bygget lägger en kolumn till i en SELECT, en konstant och tre små hjälpfunktioner i webbvyn, en kolumn i åtagandevyn, en rad i tråden och två ordbyten på Idag, ett avsnitt i `docs/MCP_ACTIONS.md`, en ny provfil och en ändrad ankarrad i ett befintligt prov. Ingen migration, ingen ny åtgärd, inget ändrat schema och ingen ny rutt. Det kräver ingen förmåga utöver kedjans: inget kommando, inget nät, inget nytt beroende och ingen ny tjänst. Sökvägarna är relativa kedjans bas (repots rot i /opt/redovisning).

```förkrav
fil: server/src/services/crmRelations.ts ändras
fil: server/src/http/view/routes.ts ändras
fil: server/test/crm-commitment-times.test.ts ny
fil: server/test/crm-views.test.ts ändras
fil: docs/MCP_ACTIONS.md ändras
fil: docs/STATUS.md ändras
fil: server/src/actions/registry.ts läses
fil: server/src/http/view/html.ts läses
fil: server/src/services/crmThread.ts läses
fil: server/src/services/crmDerivations.ts läses
fil: server/src/services/crmProvenance.ts läses
fil: server/src/services/crmIngest.ts läses
fil: server/src/lib/crmRules.ts läses
fil: server/migrations/0052_crm_schema.sql läses
fil: server/test/helpers.ts läses
fil: server/test/env.ts läses
fil: server/vitest.config.ts läses
fil: server/tsconfig.json läses
fil: server/tsconfig.test.json läses
fil: server/test/crm-capture-paths.test.ts läses
fil: server/test/crm-commitment-lifecycle.test.ts läses
fil: server/test/crm-actions-ui.test.ts läses
fil: server/test/crm-thread-paging.test.ts läses
fil: server/test/crm-today.test.ts läses
fil: server/test/crm-finish.test.ts läses
fil: server/test/crm-sfar-yta.test.ts läses
fil: server/test/crm-design-parity.test.ts läses
fil: server/test/radlangd.test.ts läses
fil: docs/crm/API_KONTRAKT.md läses
fil: docs/project-context.md läses
fil: docs/ARKITEKTUR.md läses
fil: CLAUDE.md läses
fil: _bmad-output/planning-artifacts/prd.md läses
fil: _bmad-output/planning-artifacts/epics.md läses
fil: _bmad-output/planning-artifacts/architecture.md läses
fil: _bmad-output/planning-artifacts/ux-design-specification.md läses
fil: _bmad-output/planning-artifacts/underlag/kodgranskning.md läses
fil: _bmad-output/planning-artifacts/underlag/davids-svar.md läses
fil: _bmad-output/planning-artifacts/underlag/kedjans-formagor.md läses
fil: _bmad-output/implementation-artifacts/5-1-fangstvagarna-pa-ett-stalle-och-tomlagen-som-bara-lovar-det-som-finns.md läses
fil: _bmad-output/implementation-artifacts/sprint-status.yaml läses
tjanst: 127.0.0.1:5433 vitest kör provfilerna mot den stående testdatabasen
```

- **Tjänsten** är testdatabasen som kedjan cto kör hela sviten mot (underlaget om kedjans förmågor: proven får nå just den adressen). Utvecklarens sandlåda når den ofta inte; det är aldrig ett HALT-skäl (Tasks, «Utan kommandon»).
- **Inga kommandon.** Kedjan cto har ingen kommandoförmåga för byggaren (verktygen är Read, Glob, Grep, Write, Edit och TodoWrite). Kedjan kör själv `npm ci`, typecheck, build och hela testsviten efter din sista ändring. Därför står inga kommandorader i blocket.
- **Inga beroenderader.** Provfilen använder vitest och supertest, som server-arbetsytan redan har. Bygget lägger inget paket.
- **Inga prov-rader, och baslinjen.** Provvaktens senaste bokförda körning (provvakt.json under ~/.hermes/state, läst 2026-11-22, körning 597256cf6e12) lästes för de Hermes-prov direkt under prov/ vars källtext nämner en ändrad modul som helt ord (`routes` eller `crmRelations`; Grep 2026-11-22): nio prov. Sju är GRÖNA (designsvep, hushallet_fr36, rollpassen_fr41, rollpassen_fr43, r5_soktjansten_fr6, redovisning_fortroende_prov, crmintag). Två är RÖDA: adresskontraktet (läser vyns rutter i routes.ts mot navigationskontraktet) och bmadglidning (nämner routes.ts i en kommentar). Raderna för dem står ändå inte i blocket: förkontrollens K4 (forkontroll.py under hermes/skills, rad 1186–1191) fäller i varje kedja utom hermes varje prov-rad som inte är GRÖN, och K9, som jämför med baslinjen, gäller inte i kedjan cto eftersom kedjan prövar baslinjen i själva bygget (underlaget om kedjans förmågor). Samma val gjordes i 5.1 och höll genom validering och granskning. Bygget påverkar ingen av de två: ingen rutt läggs till eller byter sökväg, ingen ny knappklass tillkommer och ingen berättelsefil ändras.
- **Läsfilerna:** `server/src/actions/registry.ts` (`list_crm_commitments` returnerar `listCommitments` rakt av, rad 3061–3072; `record_crm_commitment` rad 2887; `set_crm_commitment_status` rad 2953; `ingest_crm_events` rad 3141), `server/src/http/view/html.ts` (`staplabaraTabeller` rad 1617, stylesheetens staplingsregler rad 1341–1374, `layout` kör staplingen på varje sida rad 1876), `server/src/services/crmThread.ts` (`relationThread`: löftets rad har `at` = `occurred_at` och `source_system`; stängningsraden har inget källsystem), `server/src/services/crmDerivations.ts` (`todayView`: horisont 7 dagar, högst fem löften), `server/src/services/crmProvenance.ts` (`ProvenanceSource`), `server/src/services/crmIngest.ts` (intagets ursprung är `{ source: 'sync', source_system, source_ref }` med hela nyckeln `linear:LOC-NNN`, rad 215; det är den statusens ursprungsrad som `stangdAvKallan` läser), `server/src/lib/crmRules.ts` (`syncedCommitmentStatus` rad 162: en stängd status utan ursprungsrad räknas som en människas, vilket är skälet till fallet S7), `server/migrations/0052_crm_schema.sql` (kolumnen `created_at` med `DEFAULT now()`), förlagorna bland proven (Dev Notes, «Testerna i den här kodbasen»), `docs/crm/API_KONTRAKT.md` (rörs inte; 5.3 antecknar beslutet där).
- **Inget kontrakt.** Berättelsen läser ingen annan dels rutt, fil eller funktion.

## Acceptance Criteria

Lydelsen är epics.md:s (Story 5.2), ordagrant och numrerad. Under varje kriterium står raden *Mätbart*: mekanismen som gör kriteriet sant genom konstruktion och den ändliga listan av fall som visar det. Alla fall ligger i den nya provfilen `server/test/crm-commitment-times.test.ts`, med namnet först i titeln, utom ankarraden i `server/test/crm-views.test.ts` (uppgift 3.2). Facit står som literaler i fallen, aldrig hämtat ur koden som prövas. Fixturerna står i Dev Notes, «Fixturerna».

1. **Given** `listCommitments` och `list_crm_commitments`
   **When** de läser löften
   **Then** varje rad bär `occurred_at` (löftestid), `created_at` (registreringstid) och `due_date` (förfallodatum)
   **And** svaret är bakåtkompatibelt (befintliga fält oförändrade) och `docs/MCP_ACTIONS.md` beskriver fälten
   - *Mätbart:* Mekanismen är **en enda väg in**: `list_crm_commitments` returnerar `listCommitments` rakt av, och `listCommitments` i `server/src/services/crmRelations.ts` har en enda SELECT. I den läggs kolumnen `c.created_at` till; ingen kolumn tas bort eller byter namn, och filter och ordning är oförändrade. Bakåtkompatibiliteten visas med radens exakta nyckel
```

## Utfall
Tester: 197 passed (197) · Granskning: GODKANT | Alla tre uppföljningarna från varv 1 är åtgärdade: märket läser löftesdagens eget ursprung på båda ytorna och prövas av U1–U5, texterna är rättade och provets klocka läses en gång. Varje kri · Byggforsok: 2

## Modellkedja (Davids krav 17/8, reservvag 7/9)

* krav: **claude-opus-5-5**
* utveckling: **claude-opus-5-5**
* granskning: **claude-opus-5-5 (Codex spärrat — Davids regel 12/10; Codex granskar i efterhand)**

Granskaren ar inte forfattaren: claude-opus-5-5 (Codex spärrat — Davids regel 12/10; Codex granskar i efterhand) granskade claude-opus-5-5s arbete.

effort (Davids beslut 20/10): create-story high · validering high · bygg xhigh · granskning xhigh — riskdel crm
Allt pa Davids abonnemang - inga API-tokens.
