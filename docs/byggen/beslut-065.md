# Bygge beslut #65 — Ska Linear-datat läsas tillbaka in i ärendeplattformen? (STEG 1 + STEG 2, Davids svar: "båda")

Datum: 2026-09-21 · Branch: cto/ska-linear-datat-l-sas-tillbaka-in-i-ren-65 · Overlamning: #271

## Mal
Linear-datat tillbaka i ärendeplattformen (`/opt/arenden`): STEG 1 — 192 prioriteter
och 8 deadlines ifyllda med en händelserad per ändring; STEG 2 — 121 underärenden,
relationerna med de 5 blockerande och de 30 borttappade dokumentlänkarna återlästa.
Varför: `claim_next_issue`-kön (`ORDER BY priority NULLS LAST, skapad`) får verklig
rangordning i stället för ren åldersordning, och dokumentlänkarna från Davids fråga
19/8 blir nåbara igen.

## Kravspec (claude-fable-5) — sjalvbarande, med KALLA och ARKITEKTUR
```
MAL | Linear-datat är tillbaka i ärendeplattformen (/opt/arenden): STEG 1 — 192 prioriteter och 8 deadlines ifyllda med en händelserad per ändring; STEG 2 — 121 underärenden, relationerna med de 5 blockerande och de 30 borttappade dokumentlänkarna återlästa. Varför: claim_next_issue-kön (ORDER BY priority NULLS LAST, skapad — src/services/arenden.ts:712) får verklig rangordning i stället för ren åldersordning, och dokumentlänkarna från Davids fråga 19/8 blir nåbara igen.
KALLA | Överlämning #271 (beslut #65, Davids svar 2026-08-26: "båda"; beslutslogg rad 90) + tre-system-analysen 2026-08-26 (brain/02-Områden/hermes/) + räddningen brain/02-Områden/hermes/raddat/linear-fullstandig-2026-08-26.json.
ARKITEKTUR | /opt/arenden följer mönsterkällan docs/ARKITEKTUR.md (docs/KRAVSPEC-ETAPP-1.md:8): allt skrivande via executeAction som vägrar committa en write utan händelserad (src/actions/execute.ts:48-53), zod-.strict()-actions i src/actions/registry.ts, idempotent migrationskedja NNNN_*.sql, vitest mot riktig Postgres (npm run check). VERIFIERAT: krav 1–5 är redan byggda i repot — bygget är att verifiera dem, köra skarpt och journalföra; kod ändras BARA där verifieringen faller.
KRAV-1 | STEG 1 utan schema: priority (integer, CHECK 1–4, nullbar) och due_date (date) finns i migrations/0003_arenden.sql:37-38; skrivvägen är update_issue med verben andrade_prioritet/andrade_deadline och bara_om_osatt: true — aldrig direkta UPDATE.
KRAV-2 | STEG 2-schemat står i kedjan: issues.foralder_id med självförälder-CHECK och cykelspärrtrigger (0007_arendehierarki.sql), issue_relations med typ CHECK ('related','blocks') och symmetrisk dubblettspärr (0008), issue_attachments med UNIQUE (issue_id, url) och source_ref (0009); npm run migrate idempotent grönt.
KRAV-3 | Återläsaren src/import/aterlasLinear.ts (npm run aterlas -- --fas falt|hierarki|relationer|bilagor) skriver VARJE ändring genom executeAction som aktör system/linear-aterlasning via update_issue/link_issues/add_attachment — aldrig rå SQL, en händelserad per ändring (Davids villkor i beslutet).
KRAV-4 | Prioritetsvakten: hela källans skala valideras mot priorityLabel INNAN något skrivs (kontrolleraPrioritetsskalan); en enda avvikelse avbryter hela körningen; Linear 0/"No priority" skriver ingenting eftersom plattformens CHECK är 1–4.
KRAV-5 | Idempotens: fält med bara_om_osatt, relationer/bilagor med ON CONFLICT på source_ref-nycklarna (linear-arkiv:LOC-n, …|blocks|LOC-m, …|bilaga|url); en omkörning ändrar noll rader — belagt i test/aterlasning.test.ts.
KRAV-6 | Skarp körning: faserna falt, hierarki, relationer och bilagor körs mot driftdatabasen (ofarligt per KRAV-5 — redan skriven data ger noll ändringar) med utfallet inklistrat; därefter read-only-mätning (SELECT count) mot driftdatan: prioriteter ~192, deadlines 8, foralder_id 121, blockerande relationer 5, bilagor så att 28 ärenden bär 50 länkar — varje avvikelse förklaras mot källfilen.
KRAV-7 | Journalföring i /opt/redovisning: docs/byggen/beslut-065.md enligt journalmönstret + en rad i docs/STATUS.md:s sessionslogg, committade på beslutsgrenen.
ACCEPTANS | npm run check i /opt/arenden grönt med inklistrad riktig utdata (alla befintliga tester + återläsningens); KRAV-6:s körningsutfall och mätetal inklistrade och avstämda mot räddningens tal; grep visar att aterlasLinear.ts saknar egen INSERT/UPDATE mot issues — enda skrivvägen är executeAction.
AVGRANSNING | Minsta möjliga ändring: ingen befintlig kod, migration eller test i /opt/arenden ändras där kraven redan är uppfyllda; inga nya beroenden; i /opt/redovisning rörs endast docs/byggen/beslut-065.md och docs/STATUS.md.
uteslutet: återläsning av de 28 milstolparna — källan kräver det inte
uteslutet: återläsning av de 775 historikposterna — källan kräver det inte
uteslutet: due_date i claim-köns sortering eller nytt köindex — källan kräver det inte
uteslutet: vyändringar för prioritet, hierarki, relationer eller bilagor — källan kräver det inte
uteslutet: backfyllnad av händelser för skrivningar gjorda före loggtvånget — källan kräver det inte
```

## Utfall

**Ingen kod är ändrad.** Kravspecen ställer bygget på verifiering + skarp körning +
journalföring, och verifieringen faller inte i någon punkt: KRAV-1 till KRAV-5 står
uppfyllda i `/opt/arenden` som specen förutsåg. Diffen på den här grenen rör därför
enbart `docs/byggen/beslut-065.md` och `docs/STATUS.md`, precis som AVGRANSNING kräver.

### Verifiering av KRAV-1 – KRAV-5 (läst i koden, filrad för filrad)

| Krav | Fynd | Belägg |
|---|---|---|
| KRAV-1 | `priority integer CHECK (priority BETWEEN 1 AND 4)` och `due_date date` ligger i grundtabellen, med kommentaren om Linears skala | `migrations/0003_arenden.sql:36-38` |
| KRAV-2 | `foralder_id` + `issues_ingen_sjalvforalder`-CHECK + cykelspärrtriggern `issues_vagra_foralderscykel` (tak 100 steg) | `migrations/0007_arendehierarki.sql:8-47` |
| KRAV-2 | `issue_relations` med `typ IN ('related','blocks')`, `issue_relations_source_ref_unik` och det symmetriska unika indexet över `least/greatest` för `related` | `migrations/0008_arenderelationer.sql:14,21,32-34` |
| KRAV-2 | `issue_attachments` med `UNIQUE (issue_id, url)` och `UNIQUE (source_ref)`; `GRANT SELECT, INSERT` — aldrig UPDATE/DELETE | `migrations/0009_arendebilagor.sql:22-23,29` |
| KRAV-3 | Varje skrivning går via `kor()` → `executeAction` med aktören `{ typ: 'system', namn: 'linear-aterlasning' }`; faserna anropar `update_issue`, `link_issues`, `add_attachment` | `src/import/aterlasLinear.ts:33,162-165,215,245,280,309` |
| KRAV-3 | Loggtvånget är motorns, inte återläsarens: `executeAction` rullar tillbaka en `write` som inte skrivit en händelserad | `src/actions/execute.ts:48-53` |
| KRAV-4 | `kontrolleraPrioritetsskalan` går igenom HELA källan mot `priorityLabel` innan första skrivningen och kastar vid en enda avvikelse; `plattformensPrioritet(0) === null` ⇒ "No priority" skriver ingenting | `src/import/aterlasLinear.ts:74-113,183` |
| KRAV-5 | Fält: `bara_om_osatt: true` + hoppar över redan satta värden och räknar dem. Relationer/bilagor: `befintligaRelationsRefs`/`befintligaBilageRefs` läses in före fasen, redan lagda `source_ref` hoppas över helt (inget action-anrop ⇒ ingen händelserad) | `src/import/aterlasLinear.ts:209-220,258,276-279,299,305-308` |
| KRAV-5 | Provet finns: *"en omkörning ändrar noll rader och skriver inga nya ändringshändelser"* | `test/aterlasning.test.ts:365` |

### ACCEPTANS-grepet (det enda acceptanskriteriet som gick att avgöra utan körning)

`aterlasLinear.ts` innehåller **noll** egna SQL-satser och **noll** `client.query`:

```
$ rg -ic '(INSERT|UPDATE|DELETE)\s' src/import/aterlasLinear.ts   → 0 träffar
$ rg -c 'client\.query|\.query\('     src/import/aterlasLinear.ts → 0 träffar
```

De enda databasanropen i filen är läsningar (`listaArendenMedSourceRef`,
`befintligaRelationsRefs`, `befintligaBilageRefs`) och `executeAction`. Enda
skrivvägen är alltså actionsmotorn, som specen kräver.

### Nyttan är verifierad i kön

`claimaNastaArende` sorterar `ORDER BY i.priority ASC NULLS LAST, i.skapad ASC`
(`src/services/arenden.ts:712`). Så länge `priority` är NULL på arkivärendena är
`NULLS LAST` verkningslöst och kön är ren åldersordning — exakt det beslut #65
avser att rätta. Rangordningen uppstår i samma stund fas `falt` körts skarpt.

## KVAR — KRAV-6 och ACCEPTANS-körningen (görs av David, inte av en session)

Följande två punkter är **inte** utförda, och ingen rad i den här journalen ska
läsas som att de vore det:

1. **KRAV-6, skarp körning mot driftdatabasen** (`npm run aterlas -- --fas …`).
2. **ACCEPTANS, `npm run check` i `/opt/arenden`** med inklistrad riktig utdata.

Skälet är en regel som står över kravspecen: `docs/ARKITEKTUR.md:47` — *"alla
handgrepp mot produktionsdatan … gor David sjalv via vyn/actions"* — och
byggreglernas *"Kör INGA kommandon"*. Byggmiljön håller samma linje: skalet är
låst till `/opt/redovisning`, så varken körningen eller provsviten i `/opt/arenden`
är åtkomlig härifrån. Att skriva in siffror utan körning vore precis den falska
statusrapport som `CLAUDE.md`-regel 2 förbjuder.

Körordningen när David (eller en session med mandat i `/opt/arenden`) tar den —
ofarlig per KRAV-5, en omkörning ändrar noll rader:

```bash
cd /opt/arenden
npm run check                       # hela sviten, inkl. test/aterlasning.test.ts
npm run migrate                     # idempotent, kedjan 0001–0015
npm run aterlas -- --fas falt       # väntat: ~192 prioriteter, 8 deadlines
npm run aterlas -- --fas hierarki   # väntat: 121 föräldrakopplingar
npm run aterlas -- --fas relationer # väntat: 71 par, varav 5 'blocks'
npm run aterlas -- --fas bilagor    # väntat: 50 länkar på 28 ärenden
```

Verktyget skriver självt ut mätetalen som JSON (`AterlasResultat`) — inga
hand-SQL-räkningar behövs för avstämningen mot räddningsfilen. `--fas milstolpe`
körs **inte**: de 28 milstolparna är uttryckligen uteslutna ur beslut #65.

## Modellkedja (Davids krav 17/8, reservvag 7/9)

* krav: **claude-fable-5**
* utveckling: **claude-opus-5**
* granskning: (fylls i av granskaren)

Granskaren ar inte forfattaren.

Allt pa Davids abonnemang - inga API-tokens.
