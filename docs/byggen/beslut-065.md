# Bygge beslut #65 — Ska Linear-datat läsas tillbaka in i ärendeplattformen? Det kräver tre nya kolumner och två nya tabe

Datum: 2026-09-21 14:05 · Branch: cto/ska-linear-datat-l-sas-tillbaka-in-i-ren-65 · Overlamning: #271

## Mal
Ska Linear-datat läsas tillbaka in i ärendeplattformen? Det kräver tre nya kolumner och två nya tabeller.

## Kravspec (claude-fable-5) — sjalvbarande, med KALLA och ARKITEKTUR
```
Kravspecen är klar. Det avgörande fyndet under grävningen: **beslut #65 är redan till största delen byggt i `/opt/arenden`** — STEG 1-kolumnerna fanns från start (`0003_arenden.sql:37-38`), STEG 2-schemat finns som migration 0007–0009, och återläsaren `src/import/aterlasLinear.ts` med prioritetsvakt, idempotens och tester finns redan. Specen står därför på verifiering + skarp körning + journalföring, inte på nybygge — kod ändras bara om verifieringen faller.

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

Underlag för specen, spårbart: Davids "båda" står i beslutsloggen (rad 90, 2026-08-26). Talen (192/8/121/76 varav 5/50 på 28/30 borta) kommer ur tre-system-analysen som jag läst i sin helhet. Kodverifieringen gjordes mot `/opt/arenden` direkt: migrationskedjan slutar på 0015, återläsaren använder exakt `update_issue`/`link_issues`/`add_attachment` med `bara_om_osatt` (aterlasLinear.ts:215-334), och kön sorterar `priority NULLS LAST, skapad` (arenden.ts:712). Observera att överlämningens fråga ("tre nya kolumner och två nya tabeller") är överspelad av rekommendationen och av repots verklighet — endast `foralder_id` var ny kolumn, och allt schema finns redan.
```

## Utfall
Tester: 140 passed (140) · Granskning: GODKANT | KRAV-1–5 och ACCEPTANS-grepet verifierade av mig direkt mot /opt/arenden (0003:37-38, 0007, 0008, 0009, aterlasLinear.ts helt utan egen SQL/client.query, test aterlasning.test.ts:365; talen  · Byggforsok: 1

## Modellkedja (Davids krav 17/8, reservvag 7/9)

* krav: **claude-fable-5**
* utveckling: **claude-opus-5**
* granskning: **claude-fable-5**

Granskaren ar inte forfattaren: claude-fable-5 granskade claude-opus-5s arbete.

Allt pa Davids abonnemang - inga API-tokens.
