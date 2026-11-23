# PRD-bygget crm 3-13-mottagaren-kanner-igen-kontaktpunkten-och-gravstenen-oavsett-domansuffixet — PRD crm 3-13-mottagaren-kanner-igen-kontaktpunkten-och-gravstenen-oavsett-domansuffixet: # Story 3.1

Datum: 2026-11-23 01:44 · Branch: cto/prd-crm-3-13-mottagaren-kanner-igen-kontaktpunkten-och-gravs-9337 · Kalla: 02-Områden/hermes/prd/crm-1c-prd.md (fryst 29/9, Davids beslut #194)

## Mal
PRD crm 3-13-mottagaren-kanner-igen-kontaktpunkten-och-gravstenen-oavsett-domansuffixet: # Story 3.13: Mottagaren känner igen kontaktpunkten och gravstenen oavsett domänsuffixet Status: ready-for-dev <!-- Skap

## PRD-kravet (ordagrant ur den frysta PRD:n) och astras kodgranskning
```
# Story 3.13: Mottagaren känner igen kontaktpunkten och gravstenen oavsett domänsuffixet

Status: ready-for-dev

<!-- Skapad av create-story (BMAD v6.0.1) i autonomt läge 2026-11-22. Kodbas: redovisning. Täcker: FR-4 (samma händelse ger en post också när källnyckeln skiftar mellan <grund> och <grund>#<domän>), FR-43 (gravstenen spärrar nyckeln med och utan domänsuffix), förutsättningen för FR-1 och FR-3 i 3.10. Beror på: 8.3 (done). Utbruten ur 3.10 genom correct-course 2026-11-22. -->

## Story

Som David,
vill jag att ett mail eller möte som blir en kontaktpunkt per kund aldrig dubblerar en befintlig kontaktpunkt och aldrig väcker en GDPR-raderad kund till liv,
så att Hermes kan skicka en kontaktpunkt per berörd kund (3.10) utan att relationsdatan glider.

Kodbas: redovisning (projektroten, `server/`). Berättelsen bygger mottagarens del av Davids besked 2026-10-16 (en kontaktpunkt per berörd organisation). Avsändaren, Hermes intag, bygger nycklarna `<grund>` och `<grund>#<domän>` i 3.10 och kan varken se mottagarens nycklar eller gravstenarna. Därför stängs formskiftet här, på den enda plats som ser båda. Bygget lägger ingen migration, inget index, ingen åtgärd, ingen rutt och ingen tabell. Det lägger en ren modul, `server/src/lib/crmSourceRef.ts`, ett andra uppslag i `recordInteraction`, domänsyskon i raderingens gravstenar och en spärr som prövar dem, och kontraktets regel 2 och 4 beskriver det.

## Förkrav

Blocket nedan är berättelsens hela yta. Fem saker om formen, samma som i 3.3 och 6.5, som har passerat förkontrollen:

- **Inga beroenderader.** Förkontrollens K5 läser för redovisningen bara manifestet i repots översta katalog, och där står bara arbetsytorna. En `beroende:`-rad hade därför blivit RÖD fast inget paket är nytt. vitest, supertest och pg finns redan i serverns manifest.
- **Inga kontraktsrader.** Berättelsen läser ingen annan dels rutt, fil eller funktion. `ingest_crm_events`, gravstenarna och `docs/crm/API_KONTRAKT.md` ägs av redovisningen. Hermes intag är konsumenten och ändras i 3.10, som utdelaren släpper först när den här berättelsen är done. Kontraktets form ändras inte, bara texten i regel 2 och 4.
- **Inga kommandon och inga förmågor.** Byggaren i kedjan cto har Read, Glob, Grep, Write, Edit och TodoWrite och ingen kommandoförmåga (förteckningen över kedjans förmågor i planeringens underlag: kommando nej). Kedjan kör `npm ci`, typkontrollen, bygget och hela vitest-sviten efter utvecklarens sista ändring.
- **Proven.** Varje `prov:`-rad är GRÖN: kedjan cto kan inte lämna ett nytt prov ogrönt (nytt_prov_ej_gront nej), och förkontrollens K4 fäller i kedjan cto varje `prov:`-rad som inte är GRÖN. Berörsraderna är de befintliga provfilerna som når `recordInteraction`, `assertNotErased` eller raderingen, läser `docs/crm/API_KONTRAKT.md` eller söker igenom serverns källträd (Dev Notes, «Regressionsytan»). Hermes prov i provvaktens baslinje som läser `docs/STATUS.md` och inte är GRÖNA står därför inte i blocket, utan med sina lägen i Dev Notes, «Baslinjen». Kedjan cto kör dem inte.
- **Läsfilerna** förklaras under blocket.

```förkrav
fil: server/src/lib/crmSourceRef.ts ny
fil: server/src/services/crmRelations.ts ändras
fil: server/src/services/gdpr.ts ändras
fil: server/test/crm-source-ref.test.ts ny
fil: server/test/crm-ingest-grundnyckel.test.ts ny
fil: server/test/crm-gdpr-replay.test.ts ändras
fil: docs/crm/API_KONTRAKT.md ändras
fil: docs/STATUS.md ändras
fil: server/src/services/crmIngest.ts läses
fil: server/src/services/crmDeals.ts läses
fil: server/src/services/crmSfar.ts läses
fil: server/src/services/payroll.ts läses
fil: server/src/lib/crmRules.ts läses
fil: server/src/lib/errors.ts läses
fil: server/src/lib/updateBuilder.ts läses
fil: server/src/db/tx.ts läses
fil: server/src/db/pool.ts läses
fil: server/src/actions/registry.ts läses
fil: server/migrations/0052_crm_schema.sql läses
fil: server/migrations/0054_crm_review_fixes.sql läses
fil: server/test/helpers.ts läses
fil: server/test/setup.ts läses
fil: server/test/env.ts läses
fil: server/test/payroll-tax-dublett.test.ts läses
fil: server/test/crm-commitment-lifecycle.test.ts läses
fil: server/test/sandvagHelper.ts läses
fil: server/test/utskickHelper.ts läses
fil: docs/project-context.md läses
fil: CLAUDE.md läses
fil: _bmad-output/planning-artifacts/prd.md läses
fil: _bmad-output/planning-artifacts/epics.md läses
fil: _bmad-output/planning-artifacts/architecture.md läses
fil: _bmad-output/planning-artifacts/sprint-change-proposal-3-10-mail-och-moten-med-flera-kunddomaner-enligt-davids-besked.md läses
fil: _bmad-output/planning-artifacts/underlag/davids-svar.md läses
fil: _bmad-output/implementation-artifacts/3-3-mottagaren-tar-emot-loftets-avslut-och-en-borttagen-deadline.md läses
fil: _bmad-output/implementation-artifacts/3-10-mail-och-moten-med-flera-kunddomaner-enligt-davids-besked.md läses
prov: crm-source-ref nytt GRÖN
prov: crm-ingest-grundnyckel nytt GRÖN
prov: crm-gdpr-replay ändras GRÖN
prov: crm-commitment-lifecycle berörs GRÖN
prov: crm-deals berörs GRÖN
prov: gdpr berörs GRÖN
prov: crm-event-provenance berörs GRÖN
prov: crm-name-alias berörs GRÖN
prov: crm-sandvag berörs GRÖN
prov: crm-thread-paging berörs GRÖN
prov: crm-design-parity berörs GRÖN
prov: crm-thread berörs GRÖN
prov: crm-status-link berörs GRÖN
prov: crm-views berörs GRÖN
prov: crm-sfar berörs GRÖN
prov: crm-sfar-3 berörs GRÖN
prov: crm-cadence-merge-search berörs GRÖN
prov: crm-provenance berörs GRÖN
prov: crm-stadning berörs GRÖN
prov: crm-schema berörs GRÖN
prov: crm-derivations berörs GRÖN
prov: crm-commitment-times berörs GRÖN
prov: crm-review-fixes berörs GRÖN
prov: crm-org-name-norm berörs GRÖN
prov: crm-retention-ui berörs GRÖN
prov: vy-kansliga-knappar berörs GRÖN
prov: forslagskort-klartext berörs GRÖN
prov: uppdragsytan-utskick berörs GRÖN
prov: uppdragsytan-baselineorsak berörs GRÖN
prov: uppdragsytan-beslut berörs GRÖN
prov: uppdragsytan-godkannandevag berörs GRÖN
prov: uppdragsytan-undantag berörs GRÖN
prov: kvittobilagor-lagring berörs GRÖN
prov: vat-declaration berörs GRÖN
tjanst: 127.0.0.1:5433 vitest kör provfilerna mot den stående testdatabasen, som setup.ts återskapar ur mallen före varje fil
```

- **Tjänsten** är testdatabasen som kedjan cto kör hela sviten mot. Enligt förteckningen över kedjans förmågor (härledd 2026-11-22) är den den enda adress proven får nå. Utvecklarens sandlåda når den ofta inte, och det är aldrig ett HALT-skäl (Tasks, «Utan kommandon»).
- **Läsfilerna** utöver de ändrade:
  - `server/src/services/crmIngest.ts`: batchslingan med en savepoint per händelse (rad 150–250). Organisationen och personen skrivs före `recordInteraction` (rad 169–213), så en händelse som spärras av gravstenen rullas tillbaka helt, också personen. Filen ändras inte.
  - `server/src/services/crmDeals.ts` rad 153: affärscachen anropar `assertNotErased` med källsystemet `linear`. Anropet ändras inte och ska pröva exakt nyckel som i dag.
  - `server/src/services/crmSfar.ts` rad 89–97: `lasOrganisationer` (FOR SHARE), som inte serialiserar två skrivare och därför inte räcker som lås för grundnyckeln.
  - `server/src/services/payroll.ts` rad 348: förebilden för ett transaktionsbundet lås, `pg_advisory_xact_lock(hashtextextended($1::text, 0))` med en textnyckel.
  - `server/src/lib/errors.ts` ger `BadRequestError`. `server/src/lib/updateBuilder.ts` ger `buildAllowlistedUpdate`. Omsändningens UPDATE rör aldrig `source_ref`, så en träff på grundnyckeln behåller sin källnyckel.
  - `server/src/db/tx.ts` ger `setTenantContext` och `withTenantTransaction`. `server/src/db/pool.ts` ger poolen för samtidighetsfallet.
  - `server/src/actions/registry.ts` rad 3150–3180: händelsens schema i `ingest_crm_events` (`source_ref: safeText(300)`, `source_system` i fyra värden). Det ändras inte.
  - `server/migrations/0052_crm_schema.sql` rad 121–148: `crm.interactions` med `created_at` och det unika indexet `interactions_source_uk` på `(company_id, source_system, source_ref)`, plus `interac
```

## Utfall
Tester: 201 passed (201) · Granskning: GODKANT | Alla fyra fynd från förra varvet är åtgärdade, båda acceptanskriterierna är implementerade och prövade i kedjans gröna svit, och bara två LOW-fynd återstår. · Byggforsok: 3

## Modellkedja (Davids krav 17/8, reservvag 7/9)

* krav: **claude-opus-5-5**
* utveckling: **claude-opus-5-5**
* granskning: **claude-opus-5-5 (Codex spärrat — Davids regel 12/10; Codex granskar i efterhand)**

Granskaren ar inte forfattaren: claude-opus-5-5 (Codex spärrat — Davids regel 12/10; Codex granskar i efterhand) granskade claude-opus-5-5s arbete.

effort (Davids beslut 20/10): create-story high · validering high · bygg xhigh · granskning xhigh — riskdel crm
Allt pa Davids abonnemang - inga API-tokens.
