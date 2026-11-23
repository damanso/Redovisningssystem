# PRD-bygget crm 5-9-kalendern-blir-en-fangstvag-i-ytan — PRD crm 5-9-kalendern-blir-en-fangstvag-i-ytan: # Story 5.9: Kalendern blir en fångstväg i ytan Stat

Datum: 2026-11-23 14:20 · Branch: cto/prd-crm-5-9-kalendern-blir-en-fangstvag-i-ytan-9348 · Kalla: 02-Områden/hermes/prd/crm-1c-prd.md (fryst 29/9, Davids beslut #194)

## Mal
PRD crm 5-9-kalendern-blir-en-fangstvag-i-ytan: # Story 5.9: Kalendern blir en fångstväg i ytan Status: ready-for-dev <!-- Note: Validation is optional. Run validate-cr

## PRD-kravet (ordagrant ur den frysta PRD:n) och astras kodgranskning
```
# Story 5.9: Kalendern blir en fångstväg i ytan

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

Som David,
vill jag att ett möte som intaget registrerat syns i tråden som en kontakt och nollställer klockan, och att ytan säger att möten fångas,
så att jag ser att kalendern arbetar åt mig.

Kodbas: redovisning (kedjan cto) · Täcker: FR-3 (ett kundmöte syns som kontakt och nollställer tystnadsklockan), FR-17 och FR-31 (kalenderraden har länk till källan; texterna nämner kalendern när den är i drift) · Beror på: 5.1, 3.9 och 4.2, alla done (och 3.10 och 3.13, done, för nyckelns suffix) · Arkitektur: K-3 (kalenderspåret: `calendar:<eid>`, «mottagaren är redan redo»), «Fångstvägarna på ett ställe», mönsterregeln «Tomlägen och utfästelser», «Vyn → externa sidor» (bara länkar, `target="_blank" rel="noopener"`) · UX: K5 (källraden med länk; raden `calendar` i tabellen över länkens form) och tabellen «Texter som behöver rättas» (raderna Idag och Relationer: «möten först när FR-3 är i drift»).

## Förkrav

Bygget har ingen ingång som väntar på något utanför kopian: Davids prov av kalenderlänkens form mot en verklig händelse är raden *Driftsättning* i epics.md och görs efter 5.9:s driftsättning (correct-course 2026-11-23, samma form som 4.2). Bygget lägger kalendern i konstanten för fångstvägar, ger källraden en tredje länkform (mötet i Google Kalender), skriver två nya provfiler, uppdaterar facit i tre befintliga provfiler och en kommentar i en fjärde, där texten beskriver läget före den här berättelsen, rättar ett stycke i `docs/MCP_ACTIONS.md` och skriver en sessionsrad i `docs/STATUS.md`. Ingen migration, ingen ny rutt, ingen ny åtgärd, inget ändrat schema, ingen ny CSS-klass, ingen ny import och inget nytt beroende. Bygget kräver ingen förmåga utöver kedjans: inget kommando, inget nät och ingen ny tjänst. Sökvägarna är relativa kedjans bas (repots katalog /opt/redovisning).

```förkrav
fil: server/src/services/crmDerivations.ts ändras
fil: server/src/http/view/routes.ts ändras
fil: server/test/crm-calendar-capture.test.ts ny
fil: server/test/crm-calendar-capture-mock.test.ts ny
fil: server/test/crm-capture-paths.test.ts ändras
fil: server/test/crm-capture-paths-mock.test.ts ändras
fil: server/test/crm-ai-commitments.test.ts ändras
fil: server/test/crm-views.test.ts ändras
fil: docs/MCP_ACTIONS.md ändras
fil: docs/STATUS.md ändras
fil: server/src/lib/crmRules.ts läses
fil: server/src/lib/crmSourceRef.ts läses
fil: server/src/lib/validation.ts läses
fil: server/src/lib/referens.ts läses
fil: server/src/services/crmIngest.ts läses
fil: server/src/services/crmRelations.ts läses
fil: server/src/actions/registry.ts läses
fil: server/src/http/view/html.ts läses
fil: server/test/helpers.ts läses
fil: server/test/env.ts läses
fil: server/vitest.config.ts läses
fil: server/tsconfig.test.json läses
fil: server/test/crm-derivations.test.ts läses
fil: server/test/crm-ingest-grundnyckel.test.ts läses
fil: server/test/crm-gdpr-replay.test.ts läses
fil: server/test/crm-today.test.ts läses
fil: server/test/crm-finish.test.ts läses
fil: server/test/crm-design-parity.test.ts läses
fil: server/test/crm-commitment-times.test.ts läses
fil: server/test/crm-sandvag.test.ts läses
fil: server/test/uppdragsytan-utskick.test.ts läses
fil: server/test/uppdragsytan-referensregler.test.ts läses
fil: server/test/crm-sfar-3.test.ts läses
fil: server/test/vy-kansliga-knappar.test.ts läses
fil: server/test/kvittobilagor-lagring.test.ts läses
fil: server/test/vat-declaration.test.ts läses
fil: server/test/uppdragsytan-baselineorsak.test.ts läses
fil: server/test/uppdragsytan-beslut.test.ts läses
fil: server/test/uppdragsytan-godkannandevag.test.ts läses
fil: server/test/uppdragsytan-undantag.test.ts läses
fil: server/test/crm-deals.test.ts läses
fil: docs/crm/API_KONTRAKT.md läses
fil: docs/project-context.md läses
fil: CLAUDE.md läses
tjanst: 127.0.0.1:5433 vitest kör provfilerna mot den stående testdatabasen
```

- **Tjänsten** är testdatabasen som kedjan cto kör hela sviten mot. Underlaget om kedjans förmågor säger att proven får nå just den adressen. Utvecklarens sandlåda når den ofta inte, och det är aldrig ett HALT-skäl (Tasks, «Utan kommandon»).
- **Inga kommandon.** Kedjan cto ger byggaren verktygen Read, Glob, Grep, Write, Edit och TodoWrite och ingen kommandoförmåga. Kedjan kör själv `npm ci`, typkontrollen (båda tsconfig-filerna) och hela testsviten efter din sista ändring.
- **Inga beroenderader.** Provfilerna använder vitest och supertest, som server-arbetsytan redan har. Bygget lägger inget paket.
- **Inga prov-rader, och baslinjen.** Raderna saknas med samma skäl som i 5.1, 5.5 och 5.7: förkontrollens K4 (forkontroll.py under hermes/skills, rad 1186–1191, läst 2026-11-23) fäller i varje kedja utom hermes varje prov-rad som inte är GRÖN, och K9 gäller inte i kedjan cto, som prövar baslinjen i själva bygget. Baslinjen är ändå läst ur provvaktens senaste bokförda körning och antecknad under Dev Notes, «Baslinjen».
- **Planeringsfilerna står inte i blocket.** Berättelsen läser epics.md, prd.md, architecture.md, ux-design-specification.md, underlagen kodgranskning.md, davids-svar.md och kedjans-formagor.md, lärdomsfilen för 5.9 och berättelserna 4.2, 5.1, 3.9 och 3.10, alla under _bmad-output/. Den katalogen finns inte i kedjans bas, så en läses-rad för den blir RÖD i förkontrollens K3. De står därför utan kodformat under References. Samma gäller Hermes intag crm_ingest.py under hermes/skills (nyckelns form, läst för grammatiken): den hör till en annan kodbas och står utan kodformat.
- **Inget kontrakt.** Berättelsen läser ingen annan dels rutt, fil eller funktion. Intagets kontrakt (`docs/crm/API_KONTRAKT.md`) är oförändrat: `calendar` är redan en giltig källa och `calendar:<eid>` redan nyckelns form.

## Acceptance Criteria

Lydelsen är epics.md:s (Story 5.9, kriterium 2:s Givet-led rättat av correct-course 2026-11-23), ordagrant och numrerad, också epics.md:s *Mätbart*-tillägg sist i kriterium 2:s och 3:s And-led. I tilläggen betyder «fallen L1–L6» de fall som prövar länken (här L1–L6, och L7 prövar dokumentet), och «C1 och C2» 5.5:s fall i `server/test/crm-ai-commitments.test.ts`. Under varje kriterium står raden *Mätbart*: mekanismen som gör kriteriet sant genom konstruktion och den ändliga listan av fall som visar det. Fallen F1–F4, L1–L7 och K1–K6 ligger i den nya `server/test/crm-calendar-capture.test.ts` och N0–N2 i den nya `server/test/crm-calendar-capture-mock.test.ts`, med namnet först i titeln. De uppdaterade fallen i 5.1:s, 5.5:s och 4.2:s provfiler står under varje kriterium. Facit står som literaler i fallen, aldrig hämtat ur koden som prövas.

1. **Given** en kontaktpunkt med `source_system: 'calendar'`, `channel: 'meeting'` och en tidpunkt i dag, skickad genom `ingest_crm_events`
   **When** relationssidan och Idag läses
   **Then** mötet står i tråden med källan *Kalender* och nyckeln, relationens senaste kontakt är i dag och tystnaden 0 dagar, och relationen lämnar kontaktförslagen för tystnad
   **And** samma möte skickat igen ger `interactions_unchanged`
   - *Mätbart (Then):* Mekanismen finns redan och ändras inte: **en enda väg in** (`ingest_crm_events` → `recordInteraction`, arkitekturens K-3: «Mottagaren är redan redo») och **ett härlett värde utan filter på kanal eller källa**. Senaste kontakt är `max(occurred_at)` över relationens och dess personers kontaktpunkter i `relationState` (`server/src/services/crmDerivations.ts`), och tystnaden är skillnaden i dagar mot dagens datum. `contactSuggestions` ger skälet *tyst i N dagar* bara när tystnaden är minst gränsen (kadensen, annars 30), och en relation utan skäl tas inte med. Källraden i tråden byggs av `kallrad()` med namnet ur `KALLNAMN` (`calendar` → *Kalender*). Fall: **K1** (före mötet: relationen står i Idags förslag med skälet *tyst i N dagar* och i `crm_contact_suggestions` — den positiva kontrollen för läget för
```

## Utfall
Tester: 208 passed (208) · Granskning: GODKANT | Alla tre acceptanskriterier och alla 14 kryssade deluppgifter finns i koden och prövas av kedjans gröna körning (208 av 208); diffen avviker inte från File List, och kvar finns bara tre LOW- · Byggforsok: 1

## Modellkedja (Davids krav 17/8, reservvag 7/9)

* krav: **claude-opus-5-5**
* utveckling: **claude-opus-5-5**
* granskning: **claude-opus-5-5 (Codex spärrat — Davids regel 12/10; Codex granskar i efterhand)**

Granskaren ar inte forfattaren: claude-opus-5-5 (Codex spärrat — Davids regel 12/10; Codex granskar i efterhand) granskade claude-opus-5-5s arbete.

effort (Davids beslut 20/10): validering high · bygg xhigh · granskning xhigh — riskdel crm
Allt pa Davids abonnemang - inga API-tokens.
