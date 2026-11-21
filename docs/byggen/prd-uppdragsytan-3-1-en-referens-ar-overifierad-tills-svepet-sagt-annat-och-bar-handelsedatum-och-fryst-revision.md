# PRD-bygget uppdragsytan 3-1-en-referens-ar-overifierad-tills-svepet-sagt-annat-och-bar-handelsedatum-och-fryst-revision — PRD uppdragsytan 3-1-en-referens-ar-overifierad-tills-svepet-sagt-annat-och-bar-handelsedatum-och-fr

Datum: 2026-11-21 12:03 · Branch: cto/prd-uppdragsytan-3-1-en-referens-ar-overifierad-tills-svepet-9315 · Kalla: 02-Områden/hermes/uppdragsytan-1c-prd.md (fryst 29/9, Davids beslut #194)

## Mal
PRD uppdragsytan 3-1-en-referens-ar-overifierad-tills-svepet-sagt-annat-och-bar-handelsedatum-och-fryst-revision: # Story 3.1: En referens är overifierad tills svepet sagt annat och bär händelsedatum och fryst revision Status: ready-f

## PRD-kravet (ordagrant ur den frysta PRD:n) och astras kodgranskning
```
# Story 3.1: En referens är overifierad tills svepet sagt annat och bär händelsedatum och fryst revision

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

<!-- Kodbas: redovisning. Krav: FR-10, FR-26, FR-36, NFR-5, NFR-6 (epics.md rad 2100–2160, uppmätt 2026-11-19). Beror på: Story 1.6 (done, byggjournalen finns i docs/byggen/). Berättelsen ändrar också kod som Story 1.7, 1.9, 1.11 och 1.14 skrev. Våg 20 i parallelization-analysis.md (rad 557). Migrationen har inget fast nummer: den tar nästa lediga nummer i server/migrations när bygget börjar (ingången C, beslut 24; uppmätt 2026-11-19 blev det 0090, och uppmätt 2026-11-21, när `main` har fått 0090–0092 ur CRM-sfären, blir det 0093). Story key: 3-1-en-referens-ar-overifierad-tills-svepet-sagt-annat-och-bar-handelsedatum-och-fryst-revision. Rättad av correct-course 2026-10-17 efter bygget 10:15 (sprint-change-proposal-3-1-…md): vyfallens inloggning, källprovet Y2 struket, inventeringen av befintliga prov gjord om över hela server/test, V3:s frånvaro preciserad, kantkontrollens villkor lika med rättelsens, och uppgift 6 uppdelad på 3.4 och 5.6–5.7. Rättad igen av correct-course 2026-10-18 efter bygge #9227, som stannade på förutsättningen B eftersom kedjans kopia bar rester ur ett avbrutet bygge: B prövar nu alla fyra skrivplatserna (också server/test och docs), och beslut 20 är nytt. Kriterierna, uppgifterna och fallen var då oförändrade. Rättad en tredje gång av correct-course 2026-10-18 efter bygge #9229, som stannade med HALT i ett omtag efter första varvet (härlett ur kedjans kod, inte observerat): kriterium 3, 4 och 8 säger nu, i epics.md och här, vad mekanismen ger (beslut 21). Omtaget har en egen ordning utan HALT för röda eller okörda prov (beslut 22). De rena fallen F1–F3 och Y1 ligger tillsammans med de nya R1–R6 i regelprovet, som inte rör databasen (beslut 23). Rättad en fjärde gång av correct-course 2026-11-19 efter leads besked samma dag: berättelsen stannade 18/10 på HALT för rester i kedjans kopia, och numret 0086 är sedan dess taget av 0086_vat_box_accounts.sql och 0087–0089 av CRM-sfären. Migrationen och migrationsprovet tar nu nästa lediga nummer vid bygget, och ingången kräver en färsk kopia ur main och behandlar rester som något som tas bort före bygget, aldrig som HALT (beslut 24 och arkitekturens tillägg 2026-11-19). Kriterierna, uppgifternas kod och fallen är i övrigt oförändrade. Validerad i ny kontext 2026-11-21: avsnittet Förkrav är nytt, numret mäts till 0093, `skapaReferens` mister sitt try/catch kring 23505 enligt project-context.md rad 158 (BP-D5), och radhänvisningarna till planeringsdokumenten är uppmätta igen; kriteriernas lydelse och fallen är oförändrade. -->

## Story

As a David,
I want att varje dokument, mejl och kalenderpost i uppdraget refereras med en identifierare som tål flytt och omdöpning och visar sitt verkliga läge,
so that jag kan öppna underlaget direkt och aldrig får en overifierad eller utbytt källa presenterad som säker.

## Förkrav

Blocket räknar upp allt bygget kräver: varje fil som berättelsen skriver, ändrar eller läser i redovisningens repo, Hermes prov som läser releasen, testdatabasen och filkontrakten mot Hermes prov. Det skrevs vid validate-create-story 2026-11-21 och prövades mot arbetskatalogens kopia av `main`: varje rad med läget `ändras` eller `läses` finns, och varje rad med läget `ny` saknas. Migrationens och migrationsprovets nummer står som `<NNNN>` och sätts i ingången C (beslut 24); uppmätt 2026-11-21 blir det 0093.

```förkrav
fil: server/src/lib/referens.ts ny
fil: server/migrations/<NNNN>_referens.sql ny
fil: server/test/uppdragsytan-referensregler.test.ts ny
fil: server/test/uppdragsytan-migration-<NNNN>.test.ts ny
fil: server/src/services/uppdragReferens.ts ändras
fil: server/src/services/uppdragSignal.ts ändras
fil: server/src/services/uppdragSvep.ts ändras
fil: server/src/services/uppdragUndantag.ts ändras
fil: server/src/services/uppdragLage.ts ändras
fil: server/src/services/uppdragKontrakt.ts ändras
fil: server/src/http/view/html.ts ändras
fil: server/src/http/view/undantagsvyn.ts ändras
fil: server/src/http/view/routes.ts ändras
fil: server/test/uppdragsytan-referens.test.ts ändras
fil: server/test/uppdragsytan-drive-ko.test.ts ändras
fil: server/test/uppdragsytan-svep.test.ts ändras
fil: server/test/uppdragsytan-ovrigt.test.ts ändras
fil: server/test/beslutsunderlagHelper.ts ändras
fil: server/test/undantagsvynHelper.ts ändras
fil: server/test/uppdragsytan-statusbyte.test.ts ändras
fil: server/test/uppdragsytan-kontraktsyta.test.ts ändras
fil: server/test/uppdragsytan-beslut.test.ts ändras
fil: docs/MCP_ACTIONS.md ändras
fil: docs/ARKITEKTUR.md ändras
fil: docs/STATUS.md ändras
fil: server/src/lib/lasvarde.ts läses
fil: server/src/services/uppdragOvrigt.ts läses
fil: server/src/services/uppdragStatus.ts läses
fil: server/src/services/uppdragDokument.ts läses
fil: server/src/services/uppdragBedomning.ts läses
fil: server/src/services/uppdragBeslut.ts läses
fil: server/src/actions/registry.ts läses
fil: server/src/actions/execute.ts läses
fil: server/src/http/view/auth.ts läses
fil: server/src/http/middleware/errorHandler.ts läses
fil: server/src/db/migrate.ts läses
fil: server/src/db/tx.ts läses
fil: server/migrations/0068_uppdragsytan.sql läses
fil: server/migrations/0071_registerkopiako.sql läses
fil: server/migrations/0085_datumprecision.sql läses
fil: server/migrations/0092_crm_organization_distinctions.sql läses
fil: server/vitest.config.ts läses
fil: server/tsconfig.test.json läses
fil: server/package.json läses
fil: server/test/globalSetup.ts läses
fil: server/test/setup.ts läses
fil: server/test/env.ts läses
fil: server/test/helpers.ts läses
fil: server/test/undantagsvynRigg.ts läses
fil: server/test/ovrigtRigg.ts läses
fil: server/test/statusetiketter.test.ts läses
fil: server/test/migrate.test.ts läses
fil: server/test/uppdragsytan-prognos.test.ts läses
fil: server/test/uppdragsytan-migration-0085.test.ts läses
fil: server/test/uppdragsytan-dokumenten.test.ts läses
fil: server/test/uppdragsytan-utskick.test.ts läses
fil: server/test/uppdragsytan-undantag.test.ts läses
fil: server/test/uppdragsytan-undantagsvyn.test.ts läses
fil: server/test/uppdragsytan-undantagsvyn-mobil.test.ts läses
fil: CLAUDE.md läses
fil: docs/project-context.md läses
fil: docs/DRIFT_VPS.md läses
fil: docs/byggen/prd-uppdragsytan-1-6-undantagsvyns-lasvag-visar-bara-mandatfragor-och-vet-vad-den-har-last.md läses
fil: docs/byggen/prd-uppdragsytan-1-7-ett-ja-eller-nej-blir-en-registrerad-handling-med-kallorna-kvar.md läses
fil: docs/byggen/prd-uppdragsytan-1-8-ingen-kostnad-binds-utan-davids-godkannande.md läses
fil: docs/byggen/prd-uppdragsytan-1-9-ett-scopeavgorande-blir-en-ny-rad-i-historiken.md läses
fil: docs/byggen/prd-uppdragsytan-1-11-undantagsvyn-ar-modulens-ingang-pa-dator-och-mobil.md läses
fil: docs/byggen/prd-uppdragsytan-1-14-ovrigt-raden-blir-en-fraga-med-fardig-berakning.md läses
fil: docs/byggen/prd-uppdragsytan-2-2-varje-baselineandring-bar-sin-orsak-forifylld-och-lasbar.md läses
prov: modulprov berörs GRÖN
prov: ovrigtforslag berörs GRÖN
prov: flerbolag berörs GRÖN
prov: svepet berörs GRÖN
prov: agandegrans berörs GRÖN
prov: svepfarskhet berörs GRÖN
prov: redovisning_audit_prov berörs GRÖN
prov: designparitet berörs GRÖN
prov: designsvep berörs GRÖN
tjanst: 127.0.0.1:5433 vitest kör proven mot testdatabasen i Postgres 16
kontrakt: uppdragsytan fil server/src/services/uppdragSvep.ts prov ovrigtforslag
kontrakt: uppdragsytan fil server/src/services/uppdragSignal.ts prov ovrigtforslag
kontrakt: uppdragsytan fil server/src/services/uppdragReferens.ts prov flerbolag
kontrakt: uppdragsytan fil server/src/http/view/routes.ts prov svepet
```

Berättelsens egna prov är vitest-filer i `server/test` och står som `fil:`-rader: de tre nya provfilerna, de omskrivna och de som körs som regression. `prov:`-raderna är Hermes prov, som läser releasen och körs 
```

## Utfall
Tester: 189 passed (189) · Granskning: GODKANT | Alla elva acceptanskriterier är implementerade; inga konkreta fynd kvarstår och kedjans typkontroll och testsvit är gröna. · Byggforsok: 2

## Modellkedja (Davids krav 17/8, reservvag 7/9)

* krav: kordes inte
* utveckling: **gpt-6.1-sol**
* granskning: **gpt-6-astra**

Granskaren ar inte forfattaren: gpt-6-astra granskade gpt-6.1-sols arbete.

effort (Davids beslut 20/10): validering high — planeringssteg
Allt pa Davids abonnemang - inga API-tokens.
