# PRD-bygget crm 5-4-lova-nagot-med-loftestid — PRD crm 5-4-lova-nagot-med-loftestid: # Story 5.4: *Lova något* med löftestid Status: ready-for-dev 

Datum: 2026-11-22 21:43 · Branch: cto/prd-crm-5-4-lova-nagot-med-loftestid-9335 · Kalla: 02-Områden/hermes/prd/crm-1c-prd.md (fryst 29/9, Davids beslut #194)

## Mal
PRD crm 5-4-lova-nagot-med-loftestid: # Story 5.4: *Lova något* med löftestid Status: ready-for-dev <!-- Note: Validation is optional. Run validate-create-sto

## PRD-kravet (ordagrant ur den frysta PRD:n) och astras kodgranskning
```
# Story 5.4: *Lova något* med löftestid

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

Som David,
vill jag kunna ange när ett löfte gavs när jag registrerar det efter ett samtal,
så att löftestiden är sann även när jag skriver in det dagen efter.

Kodbas: redovisning (kedjan cto) · Täcker: FR-32 (ett löfte registreras för hand från relationssidan med riktning, text, valfri löftestid och valfritt förfallodatum; registreringstiden sätts av databasen och källan blir `manual`) · Beror på: 5.1 (done; hinten i *Lova något* läses ur `CAPTURE_TEXTS` och rörs inte här). 5.2 är också done, och dess rad *Lovat* i tråden och kolumn *Lovat* i åtagandevyn används av fallet S2 för att visa att datumet «visas som samma datum» · Arkitektur: tabellen över åtgärder (`record_crm_commitment` tar valfri `occurred_at` från vyn, FR-32), «Ett flöde, tre ingångar» och vyns POST-mönster · UX: K8 (*Lova något*, utökat), Resa 5 och «Formulär» (datumfält med `max` där framtid är ogiltig, felet i notisen före första formuläret) · Kodgranskningen: FR-32 DELVIS («Lägg till valfri löftestid i formuläret och skicka den som `occurred_at`; använd anropstiden bara när fältet utelämnas»).

## Förkrav

Bygget lägger en ren funktion i `server/src/lib/crmRules.ts`, ett datumfält i formuläret *Lova något* och några rader i vy-POST:en `/relations/:id/commit` i `server/src/http/view/routes.ts`, två nya provfiler och en sessionsrad i `docs/STATUS.md`. Ingen migration, ingen ny åtgärd, inget ändrat schema, ingen ny rutt och ingen ny CSS. Bygget kräver ingen förmåga utöver kedjans: inget kommando, inget nät, inget nytt beroende och ingen ny tjänst. Sökvägarna är relativa kedjans bas (repots rot i /opt/redovisning).

```förkrav
fil: server/src/lib/crmRules.ts ändras
fil: server/src/http/view/routes.ts ändras
fil: server/test/crm-commitment-form.test.ts ny
fil: server/test/crm-commitment-form-mock.test.ts ny
fil: docs/STATUS.md ändras
fil: server/src/actions/registry.ts läses
fil: server/src/actions/execute.ts läses
fil: server/src/db/tx.ts läses
fil: server/src/services/crmRelations.ts läses
fil: server/src/lib/validation.ts läses
fil: server/src/http/view/auth.ts läses
fil: server/src/http/view/html.ts läses
fil: server/migrations/0052_crm_schema.sql läses
fil: server/test/helpers.ts läses
fil: server/test/env.ts läses
fil: server/test/setup.ts läses
fil: server/vitest.config.ts läses
fil: server/tsconfig.json läses
fil: server/tsconfig.test.json läses
fil: server/test/crm-rules.test.ts läses
fil: server/test/crm-design-parity.test.ts läses
fil: server/test/crm-views.test.ts läses
fil: server/test/crm-commitment-times.test.ts läses
fil: server/test/crm-commitment-lifecycle.test.ts läses
fil: server/test/crm-capture-paths.test.ts läses
fil: server/test/crm-capture-paths-mock.test.ts läses
fil: server/test/crm-event-provenance.test.ts läses
fil: docs/MCP_ACTIONS.md läses
fil: docs/crm/API_KONTRAKT.md läses
fil: docs/project-context.md läses
fil: docs/ARKITEKTUR.md läses
fil: CLAUDE.md läses
tjanst: 127.0.0.1:5433 vitest kör provfilerna mot den stående testdatabasen
```

- **Tjänsten** är testdatabasen som kedjan cto kör hela sviten mot. Underlaget om kedjans förmågor säger att proven får nå just den adressen. Utvecklarens sandlåda når den ofta inte, och det är aldrig ett HALT-skäl (Tasks, «Utan kommandon»).
- **Inga kommandon.** Kedjan cto ger byggaren verktygen Read, Glob, Grep, Write, Edit och TodoWrite och ingen kommandoförmåga. Kedjan kör själv `npm ci`, typecheck, build och hela testsviten efter din sista ändring. Därför står inga kommandorader i blocket.
- **Inga beroenderader.** Provfilerna använder vitest och supertest, som server-arbetsytan redan har. Bygget lägger inget paket.
- **Inga prov-rader, och baslinjen.** Provvaktens senaste bokförda körning (provvakt.json under ~/.hermes/state, läst 2026-11-22, körning 597256cf6e12) lästes för de Hermes-prov direkt under prov/ vars källtext nämner en ändrad modul som helt ord. De ändrade modulerna är `routes` och `crmRules` (Grep 2026-11-22). Åtta prov träffar. Sex är GRÖNA: designsvep, hushallet_fr36, rollpassen_fr41, rollpassen_fr43, r5_soktjansten_fr6 och redovisning_fortroende_prov. Två är RÖDA: adresskontraktet, som läser vyns rutter mot navigationskontraktet, och bmadglidning, som nämner routes i en kommentar. Raderna för de två står ändå inte i blocket. Förkontrollens K4 (forkontroll.py under hermes/skills, rad 1186–1191) fäller i varje kedja utom hermes varje prov-rad som inte är GRÖN. K9, som jämför med baslinjen, gäller inte i kedjan cto, eftersom kedjan prövar baslinjen i själva bygget (underlaget om kedjans förmågor). Samma val gjordes i 5.1 och 5.2 och höll genom validering och granskning. Bygget påverkar ingen av de två: ingen rutt läggs till eller byter sökväg, ingen ny knappklass tillkommer och ingen berättelsefil ändras.
- **Planeringsfilerna står inte i blocket.** Berättelsen läser epics.md, prd.md, architecture.md, ux-design-specification.md, underlagen kodgranskning.md, davids-svar.md och kedjans-formagor.md och 5.2:s berättelse, alla under _bmad-output/. Någon lärdomsfil för 5.4 finns inte i implementation-artifacts (ls 2026-11-22), så ingen sådan rad står i blocket. Den katalogen finns inte i kedjans bas, så en läses-rad för den blir RÖD i förkontrollens K3. Sökvägarna står därför utan kodformat i References.
- **Läsfilerna:** `server/src/actions/registry.ts` (`record_crm_commitment` rad 2887–2926: `occurred_at` är obligatorisk `IsoDateTimeSchema` rad 2898, `body` är `safeText(2000)` rad 2896, handlern anropar `recordCommitment` med `sourceForActor(ctx.actor)`), `server/src/actions/execute.ts` och `server/src/db/tx.ts` (`withTenantTransaction` rad 95 ger `NotFoundError` vid saknat medlemskap rad 103, alltså 404 för ett annat bolag), `server/src/services/crmRelations.ts` (`provenanceFor` rad 142 skriver ursprung för varje ifyllt fält; `COMMITMENT_PROVENANCE_FIELDS` rad 105; `assertTarget` rad 1187 ger `NotFoundError` för en relation i ett annat bolag; `recordCommitment` rad 1338 rörs inte; `updateCommitment` rad 1495–1497 är förlagan för texten «Ett löfte kan inte ha getts i framtiden.»), `server/src/lib/validation.ts` (`safeText` rad 17 med `min(1)`, `IsoDateSchema` rad 78, `IsoDateTimeSchema` rad 90 kräver zon), `server/src/http/view/auth.ts` (`page` rad 278 renderar en `AppError` med sin status, alltså 404 som HTML-sida), `server/src/http/view/html.ts` (formulärets stil rad 1198–1207; `.loftesform__rad label { flex: 1 1 160px; }` radbryter tre fält utan ny CSS), `server/migrations/0052_crm_schema.sql` (`occurred_at` rad 165, `created_at` med `DEFAULT now()` rad 170), provhjälparna och förlagorna bland proven (Dev Notes, «Testerna i den här kodbasen»), `docs/MCP_ACTIONS.md` och `docs/crm/API_KONTRAKT.md` (rörs inte: åtgärden och kontraktet är oförändrade).
- **Inget kontrakt.** Berättelsen läser ingen annan dels rutt, fil eller funktion.

## Acceptance Criteria

Lydelsen är epics.md:s (Story 5.4), ordagrant och numrerad. Under varje kriterium står raden *Mätbart* med mekanismen som gör kriteriet sant genom konstruktion och den ändliga listan av fall som visar det. Fallen L1–L6, F1–F2 och S1–S7 ligger i den nya provfilen `server/test/crm-commitment-form.test.ts`, och N0–N3 i `server/test/crm-commitment-form-mock.test.ts`, med namnet först i titeln. Facit står som literaler i fallen, aldrig hämtat ur koden som prövas.

1. **Given** formuläret *Lova något* på relationssidan
   **When** det renderas
   **Then** det har *Vad*, *Vem lovar*, *Senast* och det nya, valfria fältet **Lovades** (`type="date"`, `max` = i dag) med synlig etikett
   - *Mätbart:* Formuläret finns på ett enda ställe, i relationssidans renderare (GET `/c/:companyId/relations/:orgId`). Fältet *Lovades* läggs i raden `loftesform__rad` efter *Senast*, med etiketten som omsluter fältet, som husets andra formulärfält. Det heter `occurred_at`, saknar `required` och `value`, 
```

## Utfall
Tester: 199 passed (199) · Granskning: GODKANT | Alla fyra acceptanskriterier är byggda och prövade genom hela stacken, med en negativ kontroll, och de kvarvarande fynden är två LOW. · Byggforsok: 1

## Modellkedja (Davids krav 17/8, reservvag 7/9)

* krav: **claude-opus-5-5**
* utveckling: **claude-opus-5-5**
* granskning: **claude-opus-5-5 (Codex spärrat — Davids regel 12/10; Codex granskar i efterhand)**

Granskaren ar inte forfattaren: claude-opus-5-5 (Codex spärrat — Davids regel 12/10; Codex granskar i efterhand) granskade claude-opus-5-5s arbete.

effort (Davids beslut 20/10): create-story high · validering high · bygg xhigh · granskning xhigh — riskdel crm
Allt pa Davids abonnemang - inga API-tokens.
