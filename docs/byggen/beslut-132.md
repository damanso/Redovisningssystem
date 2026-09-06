# Bygge beslut #132 — En tröskelutvärderare som tänder larm endast när avvikelsen passerar både `troskel_procent` och abso

Datum: 2026-09-06 22:52 · Branch: cto/en-tr-skelutv-rderare-som-t-nder-larm-en-132 · Overlamning: #132

## Mal
En tröskelutvärderare som tänder larm endast när avvikelsen passerar både `troskel_procent` och absolutgolvet (kr/timmar/dagar ur `contracts.troskel_*`), lika för utfall och prognos, med ärvt-intervall-regeln för leverabler.

## Kravspec (claude-fable-5) — sjalvbarande, med KALLA och ARKITEKTUR
```
Underlaget stämmer mot koden med två verifierade undantag som Davids analysregler avgör: **(a) registervyn i `http/view/routes.ts` finns inte** — den uteslöts på Davids beslut i S3.1 (byggjournal beslut-121, bekräftat i beslut-131 rad 24 och kommentaren `routes.ts:1467`), så inkopplingspunkten är svepets cache, inte en vy; **(b) `uppdragSignal.ts` är scopesignalerna (FR-6/FR-7, människotända)** — tröskellarmet är FR-3 och hör hemma i svepet, som redan bär både utfallet (`forbrukningForAvtal`, rotdel + lövdelar) och prognosunderlaget (`harledPrognosramar`). Kolumnerna finns i `0068:64-67`, ärvt-intervall-regeln finns färdig i `lib/uppdragsplan.ts`, och CTO:ns analysfråga (lägga om `takvarningEfterSparad`) besvaras av Davids regel 1: nej.

---

MAL | En ren tröskelutvärderare som tänder larm ENDAST när avvikelsen mot ram passerar både `troskel_procent` och absolutgolvet (kr/timmar/dagar ur `contracts.troskel_*`), lika för utfall och prognos, skriven i svepets cache — så att en småpost (8 000-kronorsfallet) aldrig larmar falskt på ren procent och ett larm alltid betyder något (FR-3), utan att modulen räknar om eller lagrar förbrukning (FR-25).
KALLA | Överlämning #132 (story S6.2 ur 1F, våg 5), CTO-underlag med Davids ja 2026-09-06, Davids analysregler 6/9 (regel 1, 2, 3), PRD FR-3 (rad 101–102) + FR-25 + NFR-11, 1E Del 3/`0068_uppdragsytan.sql:62-74`, byggjournal beslut-121/-131 (registervyn finns inte).
ARKITEKTUR | Enbart befintliga mönster: ren lib-funktion utan klocka/db (`lib/uppdragsplan.ts`, `harledPrognosramar`), husets enda takberäkning `forbrukningForAvtal`/`getContractUsage` (`services/contracts.ts`), taxeordningen `gallandeTaxa` + `timeEntryAmountOre`, intervallärvningen i `byggPlan` (eget intervall, annars närmaste aktiva förälder med båda ändar), svepets `upsertSvepvarden` i `withTenantTransaction`, ören/minuter som heltal (aldrig float som mellanled), vitest mot riktig Postgres.
KRAV-1 | Ny ren funktion i `server/src/lib/troskel.ts`: belopps- och timlarm tänder ⇔ avvikelsen ÖVERSTIGER (>) BÅDE `troskel_procent` av nivåns egen ram OCH golvet (`troskel_golv_ore` i ören resp. `troskel_golv_timmar` omräknad till minuter EN gång, mönstret `Math.round(cap_hours * 60)`); avvikelse ≤ 0 tänder aldrig; heltalsaritmetik för ören/minuter, procenten skalas en gång ur numeric(5,2).
KRAV-2 | Dagslarmet i samma fil: tänder ⇔ förseningen (dagnummer(idag) − dagnummer(slutdatum)) ≥ `troskel_dagar`, oberoende av beloppen och bara för poster med datum; slutdatumet är delens EGET intervall, annars det ÄRVDA enligt `byggPlan`:s regel — en leverabel med enbart ärvt intervall kan därmed aldrig larma före intervallets slut (FR-3:s sista sats).
KRAV-3 | Utfallsavvikelsen läses ur `forbrukningForAvtal` (FR-25: inga egna belopps-/timkolumner): per nivå med `cap_status = 'bekraftat'` (rotdelen = uppdraget, lövdelarna = posterna) är avvikelsen förbrukat − ram; obekräftat eller saknat tak larmar aldrig ("ett oläst tak varnar aldrig").
KRAV-4 | Prognosavvikelsen = registrerat + framtida bokat (samma indata som `harledPrognosramar`: minuter; ören via `timeEntryAmountOre` med `gallandeTaxa`) − ram, prövad mot SAMMA funktion och trösklar som utfallet; utan bekräftat tak, eller utan taxa för kronsidan, tänds inget prognoslarm — vägrar gissa, aldrig ett larm ur ett hittat tal.
KRAV-5 | Inkoppling: `svepEttUppdrag` i `uppdragSvep.ts` skriver per uppdrag svepvärdet `troskellarm` (kalla `redovisning`) i samma `upsertSvepvarden` som övriga värden — trösklarna lästa ur avtalets `contracts.troskel_*`-kolumner; värdet bär vilka larm som tänt (nivå, ram kr/timmar/dagar, utfall/prognos, avvikelse och tröskel) och ALDRIG någon färdigställandegrad i procent (NFR-11).
KRAV-6 | Storyns sex provfall som vitest i ny fil `server/test/uppdragsytan-troskel.test.ts` mot lib-funktionen: (1) 30 000 kr mot ram 473 000 kr tänder (passerar 23 650 och 22 000), (2) 2 400 kr (30 %) mot post 8 000 kr tänder INTE (golvet slår), (3) prognostiserad avvikelse tänder på samma tröskel, (4) 30 h mot 430 h tänder och 18 h inte, (5) fem kalenderdagars försening mot daterad post tänder, (6) enbart ärvt intervall: inget larm inom intervallet, larm först när slutet passerats.
KRAV-7 | Integrationsprov i samma fil (riktig Postgres): svepet skriver `troskellarm` ur `contracts.troskel_*`, och ett ÄNDRAT tröskelvärde på avtalet ändrar larmutfallet vid nästa svep — trösklarna är bevisligen per uppdrag, inte hårdkodade.
KRAV-8 | `docs/MCP_ACTIONS.md`: `kor_uppdragssvep`-avsnittet (rad 1096) får det nya svepvärdet med dubbelvillkoret beskrivet; `docs/STATUS.md` får en sessionsrad; bägge committas med koden.
ACCEPTANS | `npm test` och `npm run build` gröna med inklistrad faktisk utdata; de sex provfallen läser som storyns lista och integrationsprovet visar ändringsbarheten; `git diff` visar ingen migration, ingen registry-/vy-/schemändring, inga egna beloppskolumner, och att `takvarningEfterSparad`/`VARNINGSGRANS` (KRAV-8) samt fakturaspärren (KRAV-11) i `contracts.ts` är orörda.
AVGRANSNING | Endast: `lib/troskel.ts`, inkopplingen i `uppdragSvep.ts`, en testfil, två docs-rader. Ingen migration (kolumnerna finns i 0068), inga nya beroenden, ingen ny åtgärd, ingen scheduler, ingen sensitivity-ändring; befintliga varningar och spärrar lämnas exakt som de är.
uteslutet: larmkolumn/vy i `http/view/routes.ts` — registervyn finns inte (uteslöts i S3.1 på Davids beslut, beslut-121/-131); källan kräver det inte
uteslutet: inkoppling i `uppdragSignal.ts` — scopesignaler tänds av människor (FR-6), inte av trösklar; källan kräver det inte
uteslutet: omläggning av `takvarningEfterSparad` (KRAV-8) till dubbelvillkoret — CTO:ns analysfråga; Davids ja gällde bygget och regel 1 säger nej; källan kräver det inte
uteslutet: larm på strömnivå — FR-3: strömmens ramandel finns inte förrän en baselineversion bär den; källan kräver det inte
uteslutet: statusfilter på dagslarmet (undanta levererade/bekräftade) — extra kontroll utöver överlämningen, regel 1; källan kräver det inte
uteslutet: notifiering/eskalering via `godkannare_eskalering` — källan kräver det inte

---

Specen är 20 rader och självbärande: utvecklaren får dubbelvillkorets exakta semantik (strikt `>` för kr/timmar, `≥ troskel_dagar` för dagar, avvikelse ≤ 0 aldrig), återbrukskedjan med fil- och funktionsnamn, och de två punkter där CTO-underlaget avvek från koden (vyn, signalfilen) är avgjorda med Davids regler och dokumenterade som uteslutet-rader.
```

## Utfall
Tester: 128 passed (128) · Granskning: GODKANT | Dubbelvillkoret (strikt `>` via `bindandeTroskel`/golvad procent, `≥` för dagar), FR-25-återbruket av `forbrukningForAvtal`/`harledPrognosramar`/`byggPlan`, inkopplingen i svepets enda `upse · Byggforsok: 1

## Modellkedja (Davids krav 17/8)
Krav+granskning: claude-fable-5 · Utveckling: claude-opus-5 · Claude Code pa Davids abonnemang — inga API-tokens
