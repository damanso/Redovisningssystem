# PRD-bygget uppdragsytan 14-1-ett-rutinmassigt-statusbyte-registreras-ur-sin-kallhandelse-utan-fraga — PRD uppdragsytan 14-1-ett-rutinmassigt-statusbyte-registreras-ur-sin-kallhandelse-utan-fraga: # Stor

Datum: 2026-11-28 16:07 · Branch: cto/prd-uppdragsytan-14-1-ett-rutinmassigt-statusbyte-registrera-9383 · Kalla: 02-Områden/hermes/uppdragsytan-1c-prd.md (fryst 29/9, Davids beslut #194)

## Mal
PRD uppdragsytan 14-1-ett-rutinmassigt-statusbyte-registreras-ur-sin-kallhandelse-utan-fraga: # Story 14.1: Ett rutinmässigt statusbyte registreras ur sin källhändelse utan fråga Status: ready-for-dev <!-- Kodbas: 

## PRD-kravet (ordagrant ur den frysta PRD:n) och astras kodgranskning
```
# Story 14.1: Ett rutinmässigt statusbyte registreras ur sin källhändelse utan fråga

Status: ready-for-dev

<!-- Kodbas: redovisning (kedjan cto). Krav: FR-13 (rutinvägen enligt Davids svar 2026-10-07, «Det räcker enligt din rekommendation»), FR-12, NFR-4. Beror på: Story 4.2 (done, migration 0099, byggjournalen finns i kopian). Story key: 14-1-ett-rutinmassigt-statusbyte-registreras-ur-sin-kallhandelse-utan-fraga. Skapad av create-story 2026-11-27 i #yolo-läge, mot koden i arbetskatalogens kopia av redovisningen. Omarbetad av correct-course 2026-11-27 (andra gången) efter granskningens underkännande. Delad av correct-course 2026-11-28 (tredje gången): Davids beslut om en fälld källhändelse (förslaget, ja och nej) är Story 14.4 och byggs på husets beslutsmekanism (B-1, B-3). Här fälls källhändelsen med skälen i svaret, och ingenting skrivs (B7, B21). -->

## Story

Som David,
vill jag att ett statusbyte som följer av en källbelagd handling registreras utan att jag bekräftar det,
så att jag slipper registervård och bara får de byten som kräver mitt omdöme.

## Förkrav

Blocket räknar upp allt bygget kräver. Varje rad med läget `ändras` eller `läses` finns i arbetskatalogens kopia (kontrollerat med Glob och ls 2026-11-27, omprövat 2026-11-28). Berättelsen skapar tre nya filer: regeln, migrationen och provfilen. Migrationens nummer räknas i ingången (uppgift 0.2) och står därför som platshållare, som i Story 4.2. 0100 (Story 5.8) var högst 2026-11-28, så filen blir 0101 om inget tillkommit.

```förkrav
fil: server/src/lib/rutinregel.ts ny
fil: server/migrations/<NNNN>_rutinstatus.sql ny
fil: server/test/uppdragsytan-rutinstatus.test.ts ny
fil: server/src/services/uppdragStatus.ts ändras
fil: server/src/services/uppdragSvep.ts läses
fil: server/src/actions/registry.ts ändras
fil: server/test/uppdragsytan-leveranserna.test.ts ändras
fil: server/test/uppdragsytan-register.test.ts ändras
fil: server/test/uppdragsytan-bedomning.test.ts ändras
fil: server/test/uppdragsytan-bedomningsbegaran.test.ts ändras
fil: server/test/uppdragsytan-undantag.test.ts ändras
fil: server/test/uppdragsytan-schema.test.ts ändras
fil: server/test/uppdragsytan-sparrar.test.ts ändras
fil: server/test/uppdragsytan-overlamning.test.ts ändras
fil: server/test/uppdragsytan-faktureringsunderlag.test.ts ändras
fil: server/test/sandvagHelper.ts läses
fil: server/test/crm-sandvag.test.ts läses
fil: docs/ARKITEKTUR.md ändras
fil: docs/MCP_ACTIONS.md ändras
fil: docs/STATUS.md ändras
fil: docs/byggen/prd-uppdragsytan-4-2-overlamningen-registreras-ur-den-faktiska-handlingen.md läses
fil: server/migrations/0068_uppdragsytan.sql läses
fil: server/migrations/0072_leverabelhandelse_kanal_notering.sql läses
fil: server/migrations/0081_scopeavgorande.sql läses
fil: server/migrations/0093_referens.sql läses
fil: server/migrations/0098_registerkopia.sql läses
fil: server/migrations/0099_overlamningshandling.sql läses
fil: server/src/services/uppdragReferens.ts läses
fil: server/src/services/uppdragUndantag.ts läses
fil: server/src/services/uppdragKontrakt.ts läses
fil: server/src/services/uppdragRegister.ts läses
fil: server/src/services/uppdragLage.ts läses
fil: server/src/services/uppdragBedomning.ts läses
fil: server/src/services/invoiceFromTime.ts läses
fil: server/src/services/uppdragImport.ts läses
fil: server/src/lib/troskel.ts läses
fil: server/src/lib/referens.ts läses
fil: server/src/lib/validation.ts läses
fil: server/src/lib/errors.ts läses
fil: server/src/lib/leveranskontrakt.ts läses
fil: server/src/lib/kontraktsluckor.ts läses
fil: server/src/actions/execute.ts läses
fil: server/src/db/migrate.ts läses
fil: server/src/db/tx.ts läses
fil: server/src/mcp/server.ts läses
fil: server/kontrakt/navigation.v1.json läses
fil: server/test/helpers.ts läses
fil: server/test/env.ts läses
fil: server/test/setup.ts läses
fil: server/test/globalSetup.ts läses
fil: server/test/uppdragImportHelper.ts läses
fil: server/test/fixtures/leveranskontrakt-nvr-001.ts läses
fil: server/test/uppdragsytan-statusbyte.test.ts läses
fil: server/test/uppdragsytan-import-v3.test.ts läses
fil: server/test/uppdragsytan-agandegrans-cache.test.ts läses
fil: server/test/uppdragsytan-svep.test.ts läses
fil: server/test/uppdragsytan-kontraktsluckor.test.ts läses
fil: server/test/uppdragsytan-menyn.test.ts läses
fil: server/test/uppdragsytan-utskick.test.ts läses
fil: server/test/utskickHelper.ts läses
fil: server/test/mcp.test.ts läses
fil: server/test/steering-liquidity.test.ts läses
fil: server/test/party-update.test.ts läses
fil: server/test/vy-kansliga-knappar.test.ts läses
fil: server/test/uppdragsytan-registerkopia.test.ts läses
fil: server/test/uppdragsytan-ovrigt.test.ts läses
fil: server/test/uppdragsytan-troskelmandat.test.ts läses
fil: server/test/uppdragsytan-tillagg.test.ts läses
fil: server/test/uppdragsytan-matt-rytm.test.ts läses
fil: server/test/uppdragsytan-scopelinje.test.ts läses
fil: server/test/uppdragsytan-nasta-leverans.test.ts läses
fil: server/test/uppdragsytan-larmregel.test.ts läses
fil: server/test/uppdragsytan-prognosplats.test.ts läses
fil: server/src/config.ts läses
fil: server/vitest.config.ts läses
fil: server/tsconfig.json läses
fil: server/tsconfig.test.json läses
fil: server/package.json läses
fil: package.json läses
fil: docs/project-context.md läses
fil: CLAUDE.md läses
prov: agandegrans berörs GRÖN
prov: flerbolag berörs GRÖN
prov: handgrepp berörs GRÖN
prov: manniskosparr berörs GRÖN
prov: procentforbud berörs GRÖN
prov: svepet berörs GRÖN
tjanst: 127.0.0.1:5433 vitest kör proven mot testdatabasen i Postgres 16
```

Berättelsens egna prov är vitest-filer i `server/test` och står som `fil:`-rader: den nya provfilen har läget `ny`, de åtta provfiler där en riggning ändras och den fil där en befintlig assertion följer den fjärde skrivvägen (Dev Notes, «Befintliga assertioner som följer den fjärde vägen») har läget `ändras`, och regressionsfilerna har läget `läses`. `prov:`-raderna är Hermes prov. De läser releasen, källan eller driftens databas och körs av Hermes provvakt på dess eget schema, inte av kedjans `npm test` (Dev Notes, «Kedjan kontrollerar i drift»).

- **Baslinjen.** Provvaktens senaste bokförda körning (provvaktens tillståndsfil i Hermes hemkatalog, körningen 2026-11-27 06.30) lästes 2026-11-27 med fältet `lage` per prov. Källtexten i arbetskatalogens kopia av Hermes prov söktes efter berättelsens moduler som hela ord (uppdragStatus, uppdragSvep, registry, routes, rutinregel, MCP_ACTIONS, ARKITEKTUR, STATUS och händelsetabellens namn). Fyra icke-GRÖNA prov träffar: bmadglidning (RÖD, ordet routes), continuityvakt (KUNDE_INTE, orden registry och STATUS), overlamningsregister_fr6 (RÖD, ordet STATUS) och scope_grind (RÖD, ordet ARKITEKTUR i en provsträng). Dessutom är modulprov, som kör `npm test -- uppdragsytan` och alltså också den nya provfilen, KUNDE_INTE i samma körning.
- **De fem raderna står inte i blocket.** Kodbasen är redovisning, så kedjan cto bygger berättelsen, och förkontrollens K4 fäller varje `prov:`-rad som inte är GRÖN i en annan kedja än hermes (Hermes förkontroll, funktionen `_k4`: `slag == 'nytt' or u['kedja'] != 'hermes'` ger RÖD; underlaget kedjans-formagor, kedjan cto: nytt_prov_ej_gront nej). Samma val gjordes i Story 4.1–4.4, 5.1 och 5.2. Berättelsen gör inte proven röda och ska inte göra dem gröna: ingen av dem prövar rutinvägen.
- **De GRÖNA raderna** är prov som läser det berättelsen ändrar, alla GRÖNA i samma körning: agandegrans läser tabellkommentarerna ordagrant (migrationen ändrar ingen tabellkommentar); flerbolag läser rättigheterna på händelsetabellen och kräver `company_id` i varje mallsträng mot en `uppdrag_`-tabell i tjänstfilerna; handgrepp läser registret och kodspannen i avsnittet Uppdragsytan i `docs/MCP_ACTIONS.md` (båda proven läser åtgärdens block i registret med samma tolkare, som sätter flaggan när texten `kravManniska: true` står någonstans i blocket, också i en kommentar); manniskosparr kräver att `bekrafta_statusbyte` fort
```

## Utfall
Tester: 226 passed (226) · Granskning: GODKANT | Samtliga åtta acceptanskriterier är implementerade, förra varvets fyra fynd är åtgärdade och inga nya fynd kvarstår. · Byggforsok: 2

## Modellkedja (Davids krav 17/8, reservvag 7/9)

* krav: kordes inte
* utveckling: **claude-opus-5-5**
* granskning: **gpt-6-astra**

Granskaren ar inte forfattaren: gpt-6-astra granskade claude-opus-5-5s arbete.

effort (Davids beslut 20/10): bygg xhigh — delen okänd
Allt pa Davids abonnemang - inga API-tokens.
