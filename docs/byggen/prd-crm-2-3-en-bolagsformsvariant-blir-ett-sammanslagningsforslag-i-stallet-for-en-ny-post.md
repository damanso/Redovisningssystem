# PRD-bygget crm 2-3-en-bolagsformsvariant-blir-ett-sammanslagningsforslag-i-stallet-for-en-ny-post — PRD crm 2-3-en-bolagsformsvariant-blir-ett-sammanslagningsforslag-i-stallet-for-en-ny-post: # Story 

Datum: 2026-11-21 10:37 · Branch: cto/prd-crm-2-3-en-bolagsformsvariant-blir-ett-sammanslagningsfo-9314 · Kalla: 02-Områden/hermes/prd/crm-1c-prd.md (fryst 29/9, Davids beslut #194)

## Mal
PRD crm 2-3-en-bolagsformsvariant-blir-ett-sammanslagningsforslag-i-stallet-for-en-ny-post: # Story 2.3: En bolagsformsvariant blir ett sammanslagningsförslag i stället för en ny post Status: ready-for-dev <!-- V

## PRD-kravet (ordagrant ur den frysta PRD:n) och astras kodgranskning
```
# Story 2.3: En bolagsformsvariant blir ett sammanslagningsförslag i stället för en ny post

Status: ready-for-dev

<!-- Validerad 2026-11-21 i ny kontext (validate-create-story); rapporten står i 2-3-en-bolagsformsvariant-blir-ett-sammanslagningsforslag-i-stallet-for-en-ny-post.validering.md bredvid den här filen. -->

## Story

Som David,
vill jag att synken lägger ett sammanslagningsförslag i Att göra när den möter "Alliance Optikk AS" och "Alliance Optikk" redan finns — utan att skapa en andra relation innan jag avgjort saken,
så att två relationer för samma bolag aldrig uppstår och två olika bolag aldrig slås ihop på en gissning.

Kodbas: redovisning (kedjan cto) · Täcker: FR-14 (synkens skrivning med bolagsformsvariant ger ett sammanslagningsförslag i stället för en ny post; den handskapade varianten är berättelse 2.5), NFR-3 (förslaget är känsligt och avgörs i Att göra) · Beror på: 2.2 (`crm.normalize_org_name` och `name_norm`, migration 0091, finns i basen). 2.1 finns också i basen: namnkrocken `name_taken` med `details`, `nameTakenOrganization`, `mergeCandidate` och notisen på relationssidan. Berättelsen bygger vidare på dem och ändrar inget av det de byggde utöver det som står här · Arkitektur: A-4 (bolagsformsvariant vid skrivning), åtgärdstabellen (`ingest_crm_events`, `upsert_crm_organization`, `merge_crm_name_variant`), «Audit för förslag ur intaget (A-4)», migrationsträdet (raden NNNN_crm_organization_distinctions, här `server/migrations/0092_crm_organization_distinctions.sql`), strukturtabellen (`server/src/services/approvalSummary.ts` A-4, `server/test/crm-org-name-norm.test.ts` A-4) · UX: K13 (godkännandekortet för sammanslagning).

Berättelsen skrevs 2026-11-21 ur epics.md (Story 2.3, kriterierna ordagrant), PRD:ns FR-14, arkitekturens A-4, UX-specifikationens K13, kodgranskningens rad för FR-14 och koden i arbetskopian. Correct-course 2026-11-21 delade den: bygget stoppade utan att bli done, och berättelsen spände över tre lager (tjänst och intag, kö och kort, vyn i `server/src/http/view/routes.ts` på 11 194 rader) med 36 fall och nitton regressionsfiler. Den handskapade varianten (tidigare kriterium 7: 400 `name_variant_of` för människa och agent, `distinct_from` och vyns notis med *Öppna {X}* och *Det är ett annat bolag*) är nu berättelse 2.5, som bygger på den här. En andra correct-course samma dag (07.30) gällde två försök som stannade på «tester röda» i förgrinden. Vilka prov som föll gick inte att läsa, varken för lead eller i arbetskopian. Den omprövade koden gav inget fel i berättelsens sak. Kriterierna och fallen står därför kvar. Det som tillkom är en sluten regel för röda prov i en fixrunda (Dev Notes, «Röda prov i en fixrunda») och deluppgift 0.3. En tredje correct-course samma dag (08.40) gällde bygget 9313, som startade 08.01 och stoppade utan att bli done. Stoppskälet fanns inte heller nu i arbetskopian. Basen och föreskrifterna omprövades och var oförändrade. Det som tillkom är klass 0 i samma regel: en fixrunda vars text inte namnger något prov. Kedjans text i en fixrunda är de sista 4 000 tecknen av svitens utdata, och felströmmen står sist. Därför saknas provnamnen ofta. Klass 0 ändrar ingen kod och är aldrig ett HALT-skäl, inte heller enligt kedjans omtagsregel (Dev Notes, «Förgrindens röda prov» och «Röda prov i en fixrunda»). Bygget gör sex saker:

- en ny migration med tabellen `crm.organization_distinctions`;
- två rena funktioner i lib;
- bolagsformsregeln i `upsertOrganization` för synken (`origin.source === 'sync'`), och den enda skrivvägen till tabellen;
- den nya känsliga tvåfasåtgärden `merge_crm_name_variant` med verkställighet och avslag;
- intagets kö för förslaget och den nya svarslistan `merge_proposals`;
- kortets texter i Att göra.

Två dokument och sessionsloggen skrivs också. `server/src/http/view/routes.ts` ändras inte. Ingen ny rutt tillkommer, och inget beroende, ingen miljövariabel och ingen CSS-klass. En människa eller en agent som skapar en variant för hand gör det som i dag tills 2.5 är byggd. Dataprovet i Hermes (2.4) byggs inte här.

## Förkrav

Blocket nedan är berättelsens hela yta. Fyra saker om formen:

- **Inga beroenderader.** Inget paket läggs till. Förkontrollens K5 läser för redovisningen bara manifestet i repots översta katalog, som saknar beroenden, och en `beroende:`-rad blir där RÖD (lärdom ur 6.2, 2.2 och 2.1). Bygget använder express, zod, pg, vitest och supertest som de redan används.
- **Inga kontraktsrader.** Berättelsen läser ingen annan dels rutt, fil eller funktion. Ingen rutt tillkommer och ingen befintlig rutt ändras; förslaget syns i Att göra, som redan ritar varje köpost.
- **Inga kommandon.** Byggaren har bara Read, Glob, Grep, Write, Edit och TodoWrite. Efter utvecklarens sista ändring kör kedjan `npm ci`, typkontrollen, bygget, migrationskedjan och hela vitest-sviten.
- **Proven.** Kedjan cto kör vitest-sviten. Den kör inte Hermes egna prov, och därför står inget sådant prov här (Dev Notes, «Baslinjen»). Berörsraderna är de befintliga vitest-filer som läser beteendet, källtexten eller dokumenten som bygget ändrar (Dev Notes, «Regressionsytan»).

```förkrav
fil: server/migrations/0092_crm_organization_distinctions.sql ny
fil: server/src/lib/crmRules.ts ändras
fil: server/src/services/crmRelations.ts ändras
fil: server/src/services/crmIngest.ts ändras
fil: server/src/services/crmMerge.ts ändras
fil: server/src/services/approvalSummary.ts ändras
fil: server/src/actions/registry.ts ändras
fil: server/test/crm-org-name-norm.test.ts ändras
fil: server/test/crm-rules.test.ts ändras
fil: server/test/vy-kansliga-knappar.test.ts ändras
fil: server/test/forslagskort-klartext.test.ts ändras
fil: server/test/uppdragsytan-mandat.test.ts ändras
fil: docs/MCP_ACTIONS.md ändras
fil: docs/crm/API_KONTRAKT.md ändras
fil: docs/STATUS.md ändras
fil: server/migrations/0059_crm_name_aliases.sql läses
fil: server/migrations/0061_crm_person_distinctions.sql läses
fil: server/migrations/0091_crm_org_name_norm.sql läses
fil: server/src/lib/errors.ts läses
fil: server/src/lib/validation.ts läses
fil: server/src/services/approvals.ts läses
fil: server/src/services/auditService.ts läses
fil: server/src/services/crmProvenance.ts läses
fil: server/src/services/crmStadning.ts läses
fil: server/src/services/crmPrivat.ts läses
fil: server/src/services/gdpr.ts läses
fil: server/src/services/uppdragBeslut.ts läses
fil: server/src/actions/execute.ts läses
fil: server/src/http/view/routes.ts läses
fil: server/src/http/routes/actions.ts läses
fil: server/src/http/middleware/errorHandler.ts läses
fil: server/src/http/middleware/authenticate.ts läses
fil: server/src/mcp/server.ts läses
fil: server/src/db/tx.ts läses
fil: server/src/db/migrate.ts läses
fil: server/test/helpers.ts läses
fil: server/test/env.ts läses
fil: server/test/setup.ts läses
fil: server/test/globalSetup.ts läses
fil: server/test/sandvagHelper.ts läses
fil: server/test/crm-name-alias.test.ts läses
fil: server/test/crm-cadence-merge-search.test.ts läses
fil: server/test/crm-views.test.ts läses
fil: server/test/crm-finish.test.ts läses
fil: server/test/crm-review-fixes.test.ts läses
fil: server/test/crm-provenance.test.ts läses
fil: server/test/crm-status-link.test.ts läses
fil: server/test/crm-event-provenance.test.ts läses
fil: server/test/crm-stadning.test.ts läses
fil: server/test/crm-design-parity.test.ts läses
fil: server/test/crm-sfar-yta.test.ts läses
fil: server/test/crm-actions-ui.test.ts läses
fil: server/test/crm-sandvag.test.ts läses
fil: server/test/crm-derivations.test.ts läses
fil: server/test/crm-gdpr-replay.test.ts läses
fil: server/test/crm-schema.test.ts läses
fil: server/test/crm-sfar.test.ts läses
fil: server/test/crm-sfar-3.test.ts läses
fil: server/test/crm-thread.test.ts läses
fil: server/test/rls-katalog.test.ts läses
fil: server/test/uppdragsytan-godkannandevag.test.ts läses
fil: server/test/uppdragsytan-beslut.test.ts läses
fil: server/test/voucher-links.test.ts läses
fil: server/test/uppdragsytan-ut
```

## Utfall
Tester: 187 passed (187) · Granskning: GODKANT | Alla acceptanskriterier inom berättelsens omfång är implementerade, tidigare fynd är åtgärdade och inga nya belagda fel har hittats. · Byggforsok: 3

## Modellkedja (Davids krav 17/8, reservvag 7/9)

* krav: kordes inte
* utveckling: **gpt-6.1-sol**
* granskning: **gpt-6-astra**

Granskaren ar inte forfattaren: gpt-6-astra granskade gpt-6.1-sols arbete.

effort (Davids beslut 20/10): validering high — planeringssteg
Allt pa Davids abonnemang - inga API-tokens.
