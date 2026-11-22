# PRD-bygget crm 7-4-en-affar-som-statt-stilla-blir-ett-skal-i-kontaktforslagen — PRD crm 7-4-en-affar-som-statt-stilla-blir-ett-skal-i-kontaktforslagen: # Story 7.4: En affär som st

Datum: 2026-11-22 20:38 · Branch: cto/prd-crm-7-4-en-affar-som-statt-stilla-blir-ett-skal-i-kontak-9334 · Kalla: 02-Områden/hermes/prd/crm-1c-prd.md (fryst 29/9, Davids beslut #194)

## Mal
PRD crm 7-4-en-affar-som-statt-stilla-blir-ett-skal-i-kontaktforslagen: # Story 7.4: En affär som stått stilla blir ett skäl i kontaktförslagen Status: ready-for-dev <!-- Note: Validation is o

## PRD-kravet (ordagrant ur den frysta PRD:n) och astras kodgranskning
```
# Story 7.4: En affär som stått stilla blir ett skäl i kontaktförslagen

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

Kodbas: redovisning · Täcker: FR-22 (F5:s tredje grund, affärsläget — skede och stillestånd för en faktisk affär; samma funktioner för vyn och AI:n) · Beror på: 7.1 (affärscachen), `done` och byggd i kopian (Uppgift 0 prövar det).

## Story

Som David
vill jag att en relation vars affär stått stilla dyker upp bland kontaktförslagen med affärens skede och hur länge den stått stilla,
så att förslagen bygger på affärsläget och inte bara på tystnad och omsättning.

## Förkrav

Blocket nedan är berättelsens hela yta. Sökvägarna är relativa kedjans bas (redovisningens repo). Fem saker om formen:

- **Inga beroenderader.** Förkontrollens K5 läser för redovisningen bara manifestet i repots översta katalog, där inga paket står, så varje `beroende:`-rad blir RÖD (lärdom ur 6.2 och 7.1). Berättelsen lägger inget paket till: vitest och supertest finns redan i serverns manifest.
- **Inga kontraktsrader.** Berättelsen läser ingen annan dels rutt, fil eller funktion. Den läser affärscachen genom `openDeals` i den egna kodbasen, och den ändrar ingen åtgärds indata.
- **Inga kommandon.** Byggaren har bara Read, Glob, Grep, Write, Edit och TodoWrite (underlaget om kedjans förmågor: kedjan cto kan inte köra kommandon). Kedjan kör typkontrollen och hela vitest-sviten efter utvecklarens sista ändring, och ett rött prov kommer tillbaka som fixrunda.
- **Proven.** Raderna `prov:` är vitest-filer i `server/test/`. Berättelsens fall läggs sist i den befintliga provfilen crm-deals, som arkitekturen pekar ut för FR-22:s affärsskäl (Beslutslogg, punkt 8); den står därför som `ändras` och ska vara GRÖN med sina 7.1-fall orörda. De berörda läser en ändrad fil, anropar förslagen eller Idag, läser källtext under `server/src` eller läser åtgärdsdokumentet (Dev Notes, «Regressionsytan»). Inga berörs-rader för Hermes prov (Dev Notes, «Baslinjen»).
- **Tjänsten** är testdatabasen som kedjan cto kör sviten mot; proven får nå just den adressen.

```förkrav
fil: server/src/lib/crmRules.ts ändras
fil: server/src/services/crmDerivations.ts ändras
fil: server/test/crm-deals.test.ts ändras
fil: docs/MCP_ACTIONS.md ändras
fil: docs/STATUS.md ändras
fil: server/src/services/crmDeals.ts läses
fil: server/src/actions/registry.ts läses
fil: server/src/http/view/routes.ts läses
fil: server/src/http/view/html.ts läses
fil: server/test/helpers.ts läses
fil: server/test/env.ts läses
fil: server/test/setup.ts läses
fil: server/test/globalSetup.ts läses
fil: server/vitest.config.ts läses
fil: server/test/crm-derivations.test.ts läses
fil: server/test/crm-rules.test.ts läses
fil: server/test/crm-sandvag.test.ts läses
fil: server/test/sandvagHelper.ts läses
fil: server/test/utskickHelper.ts läses
fil: server/test/uppdragsytan-utskick.test.ts läses
fil: server/test/vy-kansliga-knappar.test.ts läses
fil: server/test/crm-capture-paths-mock.test.ts läses
fil: server/test/crm-commitment-times.test.ts läses
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
fil: _bmad-output/implementation-artifacts/7-1-affarscachen-och-kontraktet-for-affarer.md läses
prov: crm-deals ändras GRÖN
prov: crm-rules berörs GRÖN
prov: crm-derivations berörs GRÖN
prov: crm-cadence-merge-search berörs GRÖN
prov: crm-capture-paths berörs GRÖN
prov: crm-capture-paths-mock berörs GRÖN
prov: crm-commitment-times berörs GRÖN
prov: crm-design-parity berörs GRÖN
prov: crm-finish berörs GRÖN
prov: crm-retention-ui berörs GRÖN
prov: crm-review-fixes berörs GRÖN
prov: crm-sfar berörs GRÖN
prov: crm-sfar-3 berörs GRÖN
prov: crm-thread-paging berörs GRÖN
prov: crm-today berörs GRÖN
prov: crm-views berörs GRÖN
prov: entity-links berörs GRÖN
prov: crm-sandvag berörs GRÖN
prov: crm-event-provenance berörs GRÖN
prov: crm-status-link berörs GRÖN
prov: crm-commitment-lifecycle berörs GRÖN
prov: crm-org-name-norm berörs GRÖN
prov: fakturanummer-samtidighet berörs GRÖN
prov: draft-delete berörs GRÖN
prov: payroll-tax-dublett berörs GRÖN
prov: voucher-links berörs GRÖN
prov: uppdragsytan-matt-rytm berörs GRÖN
prov: uppdragsytan-scopelinje berörs GRÖN
prov: uppdragsytan-utskick berörs GRÖN
prov: vy-kansliga-knappar berörs GRÖN
prov: kvittobilagor-lagring berörs GRÖN
prov: uppdragsytan-baselineorsak berörs GRÖN
prov: uppdragsytan-beslut berörs GRÖN
prov: uppdragsytan-godkannandevag berörs GRÖN
prov: uppdragsytan-undantag berörs GRÖN
prov: vat-declaration berörs GRÖN
tjanst: 127.0.0.1:5433 vitest-sviten återskapar testdatabasen ur mallen före varje fil och kör åtgärderna, vyerna och tjänsterna mot riktig Postgres
```

## Acceptance Criteria

Lydelsen är epics.md:s (Story 7.4), ordagrant och numrerad. Under varje kriterium står raden *Mätbart*: mekanismen som gör kriteriet sant genom konstruktion och den ändliga listan av fall i `server/test/crm-deals.test.ts` som visar det, i berättelsens egna `describe` vars titlar slutar på *(7.4 …)*. Fallens namn står först i titeln (R1, A1, F1 …) och krockar inte med 7.1:s fall i samma fil (D1–D4, E, G, M, O, P, S och V1–V5 finns redan; därför heter Idag-fallet I1 och dokumentfallet D5); Dev Notes, «Fallen», beskriver varje fall. Facit står i fallen som literaler eller räknas ur provets egen klocka, aldrig importerat ur koden som prövas.

1. **Given** en relation med en öppen affär vars stillestånd är minst relationens tystnadsgräns (kadensen, annars bolagets standard) och en färsk ögonblicksbild
   **When** `contactSuggestions` räknar
   **Then** relationen får skälet *"affären {titel} ({skede}) har stått stilla i {N} dagar"* i samma form som de andra skälen, med skedets svenska etikett (*Idé*, *Dialog*, *Offert*, *Förhandling*) och *skede okänt* när affären saknar skede
   **And** en affär med kortare stillestånd ger inget skäl, och tystade eller uppskjutna relationer föreslås fortfarande inte
   - *Mätbart (Then):* Mekanismen är en enda regel och en tillåtelselista. Skälet byggs på ett ställe, den rena funktionen `stalledDealReason` i `server/src/lib/crmRules.ts`, som får relationens affärer och relationens gräns (`grans` i `contactSuggestions`, alltså `cadence_days ?? silence_days`, samma värde som tystnadsskälet redan använder) och returnerar skälet och stilleståndet för den affär som stått stilla längst, eller `null`. Etiketten slås upp i en sluten tabell med de fyra skedena (`Object.hasOwn`), och allt annat — `null`, ett okänt värde, `constructor` — ger *skede okänt*. Gränsen jämförs med `>=`, som tystnaden. Fall: **R1** (en affär, 40 dagar, gräns 30, skedet `proposal`: skälet ordagrant och stilleståndet 40), **R2** (gränsen: 30 mot 30 ger skäl, 29 mot 30 och en tom lista ger `null`), **R3** (de fyra skedena ger *Idé*, *Dialog*, *Offert* och *Förhandling* ur provets literal, och varje etikett står också i `statusChip(kod).value`), **R4** (`null`, `won` och `constructor` ger *skede okänt*), **R5** (tre affärer, två stillastående: den längsta ger skälet med tillägget *(och 1 till)*; vid lika stillestånd vinner den som står först), **A1** (genom `crm_contact_suggestions`: relationen med en offert som stått stilla i 40 dagar och kontakt för två dagar sedan har exakt det skälet och prioriteten 40), **A3** (egen kadens 14 och en affär som stått stilla i 20 dagar ger skälet; egen kadens 60 och 40 dagar ger inget; med `silence_days` 50 faller relationen utan kadens bort men den med kadens 14 står kvar), **A4** (en affär utan s
```

## Utfall
Tester: 197 passed (197) · Granskning: GODKANT | Alla tre acceptanskriterier är implementerade och testade, och kedjans svit är grön; de fem fynden är alla LOW. · Byggforsok: 1

## Modellkedja (Davids krav 17/8, reservvag 7/9)

* krav: **claude-opus-5-5**
* utveckling: **claude-opus-5-5**
* granskning: **claude-opus-5-5 (Codex spärrat — Davids regel 12/10; Codex granskar i efterhand)**

Granskaren ar inte forfattaren: claude-opus-5-5 (Codex spärrat — Davids regel 12/10; Codex granskar i efterhand) granskade claude-opus-5-5s arbete.

effort (Davids beslut 20/10): create-story high · validering high · bygg xhigh · granskning xhigh — riskdel crm
Allt pa Davids abonnemang - inga API-tokens.
