# PRD-bygget uppdragsytan 5-8-larmregeln-for-nedlagd-tid-mot-ram-enligt-davids-beslut — PRD uppdragsytan 5-8-larmregeln-for-nedlagd-tid-mot-ram-enligt-davids-beslut: # Story 5.8: Larmregel

Datum: 2026-11-28 04:55 · Branch: cto/prd-uppdragsytan-5-8-larmregeln-for-nedlagd-tid-mot-ram-enli-9377 · Kalla: 02-Områden/hermes/uppdragsytan-1c-prd.md (fryst 29/9, Davids beslut #194)

## Mal
PRD uppdragsytan 5-8-larmregeln-for-nedlagd-tid-mot-ram-enligt-davids-beslut: # Story 5.8: Larmregeln för ”Nedlagd tid mot ram” enligt Davids beslut Status: ready-for-dev <!-- Validering är frivilli

## PRD-kravet (ordagrant ur den frysta PRD:n) och astras kodgranskning
```
# Story 5.8: Larmregeln för ”Nedlagd tid mot ram” enligt Davids beslut

Status: ready-for-dev

<!-- Validering är frivillig. Kör validate-create-story för kvalitetskontroll före dev-story. -->

## Story

Som David
vill jag att måttet ”Nedlagd tid mot ram” larmar på FR-3:s avvikelsetröskel, som jag beslutat,
så att måttet varnar mig utan den förbjudna andelen klara leverabler.

Kodbas: redovisning (kedjan cto). Krav: FR-19 (larmregeln), FR-3, NFR-11. Davids svar 2026-10-07 15.39 (underlag/davids-svar.md, rad 29–31) på frågan om kontraktets larmregel ska ersättas av FR-3:s avvikelsetröskel eller skrivas om i en ny kontraktsversion, ordagrant: «Ersätt, skriv inte om». Beror på: Story 2.3 (måtten och rytmen, done) och Story 5.3 (tröskeln, done), samt Story 5.7 (golvet beslutat, done).

## Förkrav

Blocket räknar upp allt bygget kräver. Varje rad med läget `ändras` eller `läses` finns i arbetskatalogens kopia (kontrollerat med Glob och ls 2026-11-28). Provfilerna med läget `läses` är regressionsfilerna och de grannprov som läser källtexten eller dokumenten (Dev Notes, «Grannprov som läser källtexten» och «Grannprov som läser dokumenten»). Berättelsen skapar två nya filer: migrationen 0100 och provfilen för larmregeln. Ingen rutt, ingen åtgärd, ingen ny kolumn och inget beroende tillkommer.

```förkrav
fil: server/src/lib/troskel.ts ändras
fil: server/src/lib/leveranskontrakt.ts ändras
fil: server/src/services/uppdragLage.ts ändras
fil: server/src/http/view/uppdragUppfoljning.ts ändras
fil: server/src/http/view/uppdragTroskel.ts ändras
fil: server/migrations/0100_larmregel_enligt_beslut.sql ny
fil: server/test/uppdragsytan-larmregel.test.ts ny
fil: server/test/uppdragsytan-matt-rytm.test.ts ändras
fil: docs/ARKITEKTUR.md ändras
fil: docs/MCP_ACTIONS.md ändras
fil: docs/STATUS.md ändras
fil: server/src/lib/lasvarde.ts läses
fil: server/src/lib/duration.ts läses
fil: server/src/lib/uppdragsplan.ts läses
fil: server/src/services/uppdragImport.ts läses
fil: server/src/services/uppdragSvep.ts läses
fil: server/src/services/uppdragUndantag.ts läses
fil: server/src/services/uppdragPengar.ts läses
fil: server/src/services/contracts.ts läses
fil: server/src/http/view/routes.ts läses
fil: server/src/http/view/html.ts läses
fil: server/src/http/view/uppdragForbrukning.ts läses
fil: server/src/actions/registry.ts läses
fil: server/src/db/migrate.ts läses
fil: server/src/db/tx.ts läses
fil: server/migrations/0068_uppdragsytan.sql läses
fil: server/migrations/0093_referens.sql läses
fil: server/migrations/0095_matt_och_rytm.sql läses
fil: server/migrations/0099_overlamningshandling.sql läses
fil: server/test/fixtures/leveranskontrakt-nvr-001-v3.ts läses
fil: server/test/troskelHelper.ts läses
fil: server/test/uppdragImportHelper.ts läses
fil: server/test/helpers.ts läses
fil: server/test/env.ts läses
fil: server/test/setup.ts läses
fil: server/test/globalSetup.ts läses
fil: server/test/uppdragsytan-troskel.test.ts läses
fil: server/test/uppdragsytan-troskelmandat.test.ts läses
fil: server/test/uppdragsytan-stromniva.test.ts läses
fil: server/test/uppdragsytan-laget.test.ts läses
fil: server/test/uppdragsytan-import-v3.test.ts läses
fil: server/test/uppdragsytan-sparrar.test.ts läses
fil: server/test/uppdragsytan-svep.test.ts läses
fil: server/test/uppdragsytan-undantag.test.ts läses
fil: server/test/uppdragsytan-pengarna.test.ts läses
fil: server/test/uppdragsytan-utskick.test.ts läses
fil: server/test/uppdragsytan-overlamning.test.ts läses
fil: server/test/uppdragsytan-faktureringsunderlag.test.ts läses
fil: server/test/uppdragsytan-prognosplats.test.ts läses
fil: server/test/uppdragsytan-forbrukning.test.ts läses
fil: server/test/uppdragsytan-luckunderlag.test.ts läses
fil: server/test/uppdragsytan-kontraktsluckor.test.ts läses
fil: server/test/uppdragsytan-registerkopia.test.ts läses
fil: server/test/crm-read-scope.test.ts läses
fil: server/vitest.config.ts läses
fil: server/package.json läses
fil: package.json läses
fil: docs/project-context.md läses
fil: CLAUDE.md läses
prov: agandegrans berörs GRÖN
prov: cronvakter_nfr8 berörs GRÖN
prov: flerbolag berörs GRÖN
prov: gitvakt_filkontrakt_nfr8 berörs GRÖN
prov: handgrepp berörs GRÖN
prov: kraschslut_prov berörs GRÖN
prov: leveranskontrakt_tackning berörs GRÖN
prov: ovrigtforslag berörs GRÖN
prov: procentforbud berörs GRÖN
prov: resonemangsunderlag berörs GRÖN
prov: svepet berörs GRÖN
tjanst: 127.0.0.1:5433 vitest kör proven mot testdatabasen i Postgres 16
```

Berättelsens egna prov är vitest-filer i `server/test` och står som `fil:`-rader: den nya provfilen har läget `ny`, provfilen vars påståenden berättelsen skriver om har läget `ändras` (Dev Notes, «Befintliga prov som ändras»), och regressionsfilerna har läget `läses`. `prov:`-raderna är Hermes prov i hermes/prov. De körs av byggslingan och provvakten, inte av kedjans `npm test` (Dev Notes, «Kedjan kontrollerar i drift»).

- **Baslinjen** är provvaktens tillståndsfil under ~/.hermes/state, senaste bokförda körningen 2026-11-27 06.30–07.27 (filen gick att läsa).
- **De GRÖNA raderna som nämner en ändrad kodmodul som helt ord** (Grep i hermes/prov 2026-11-28): `troskel` ger cronvakter_nfr8, kraschslut_prov och resonemangsunderlag; `leveranskontrakt` ger gitvakt_filkontrakt_nfr8 (ordet står i provets egna texter om ett annat leveranskontrakt). `uppdragLage`, `uppdragUppfoljning` och `uppdragTroskel` nämns av inget prov. Alla fyra var GRÖNA i körningen.
- **Prov som läser en fil eller tabell som berättelsen ändrar står också i blocket**, fast de inte nämner en ändrad modul som helt ord: procentforbud (K1 läser kolumnnamnen i `uppdrag_*`, K2 vy- och tjänstefilerna vars namn börjar på uppdrag), svepet (läser varje ts-fil under vykatalogen), handgrepp och ovrigtforslag (läser avsnittet Uppdragsytan i `docs/MCP_ACTIONS.md`) och leveranskontrakt_tackning (läser `namn` och `lasvag` ur `uppdrag_matt`, som berättelsen får en ny CHECK och nya lägen i men inga nya kolumner). Därtill flerbolag (läser varje tjänstefil vars namn börjar på uppdrag, alltså `server/src/services/uppdragLage.ts`, efter satser mot `uppdrag_`-tabeller utan `company_id`, och prövar rättigheterna på `uppdrag_*` i drift) och agandegrans (läser tabellkommentarens kategori och kolumnerna i varje `uppdrag_*`-tabell, alltså också `uppdrag_matt`). Alla sju var GRÖNA i samma körning; för flerbolag och agandegrans är läget det som Story 4.3 och 14.1 läste ur samma körning 2026-11-27 06.30.
- **Prov som läser det berättelsen ändrar men står i prosan:** modulprov kör `npm test -- uppdragsytan` och tar alltså med den nya provfilen och `server/test/uppdragsytan-matt-rytm.test.ts`. Det stod som KUNDE_INTE i samma körning (Story 4.3, Förkrav), och förkontrollens K4 fäller en `prov:`-rad som inte är GRÖN i kedjan cto. redovisning_audit_prov migrerar driftens migrationskatalog genom psql i en mall efter driftsättningen och läser alltså migrationen 0100. Dess läge i körningen gick inte att belägga här (tillståndsfilen ligger utanför arbetskopian), och förkontrollens K9 tar inte med det: byggslingans urval läser bara ändrade .py-moduler. Migrationen håller det ändå (Dev Notes, «Migrationen 0100», punkt 4).
- **Icke-GRÖNA prov.** Inget prov som nämner en ändrad kodmodul är RÖTT eller KUNDE_INTE. Som i Story 5.7 räknas dokumentens namn inte som moduler här: scope_grind (RÖD) bär ordet ARKITEKTUR bara i en provsträng, och continuityvakt (KUNDE_INTE) läser rubrikstyckets antal åtgärder i `docs/STATUS.md`, som berättelsen inte ändrar. Kedjan cto:s förkontroll (K4) fäller varje `prov:`-rad som inte är GRÖN, och berättelsen varken gör proven röda eller ska göra dem gröna. bmadglidning (RÖD) nämner `routes`, och därför ändras inte `server/src/http/view/routes.ts` (Beslutslogg 9).
- **Inga `beroende:`-, `kontrakt:`-, `kommando:`-, `kraver:`- eller `namner:`-rader.** Inget paket tillkommer. Ingen åtgärd, ingen rutt och inget svar byter form utöver två nya fält på varje mått i `las_uppdragslage` (Dev Notes, «Läsvägen»). Kedjans för
```

## Utfall
Tester: 223 passed (223) · Granskning: GODKANT | Båda acceptanskriterierna är implementerade; inga belagda fel hittades och kedjans typkontroll och hela testsvit är gröna. · Byggforsok: 1

## Modellkedja (Davids krav 17/8, reservvag 7/9)

* krav: kordes inte
* utveckling: **claude-opus-5-5**
* granskning: **gpt-6-astra**

Granskaren ar inte forfattaren: gpt-6-astra granskade claude-opus-5-5s arbete.

effort (Davids beslut 20/10): validering high · bygg xhigh — delen okänd
Allt pa Davids abonnemang - inga API-tokens.
