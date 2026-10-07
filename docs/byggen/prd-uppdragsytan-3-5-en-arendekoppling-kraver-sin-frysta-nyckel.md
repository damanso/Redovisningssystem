# PRD-bygget uppdragsytan 3-5-en-arendekoppling-kraver-sin-frysta-nyckel — PRD uppdragsytan 3-5-en-arendekoppling-kraver-sin-frysta-nyckel: # Story 3.5: En ärendekoppling kräv

Datum: 2026-10-07 10:37 · Branch: cto/prd-uppdragsytan-3-5-en-arendekoppling-kraver-sin-frysta-nyc-9166 · Kalla: 02-Områden/hermes/uppdragsytan-1c-prd.md (fryst 29/9, Davids beslut #194)

## Mal
PRD uppdragsytan 3-5-en-arendekoppling-kraver-sin-frysta-nyckel: # Story 3.5: En ärendekoppling kräver sin frysta nyckel Status: ready-for-dev <!-- Note: Validation is optional. Run val

## PRD-kravet (ordagrant ur den frysta PRD:n) och astras kodgranskning
```
# Story 3.5: En ärendekoppling kräver sin frysta nyckel

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

<!-- Kodbas: redovisning. Epic 3 (Referenserna och registerkopian sköts utan David). Beror på: Story 1.2 (done). Byggvillkoren K-8 (1.1) och KRAV-13 (1.2) står i done. Våg 3 i parallelization-analysis.md (rad 352–360) tillsammans med 1.3, 1.4, 10.1 och 11.1. Migrationsnumret 0078 är reserverat för berättelsen (rad 358; regel 5, rad 654). -->
<!-- Story key: 3-5-en-arendekoppling-kraver-sin-frysta-nyckel · Story ID: 3.5 · Skapad 2026-10-07 med BMAD create-story i autonomt läge (YOLO). -->

## Story

As a David,
I want att varje koppling till ärendeplattformen bär sin frysta nyckel och källa,
so that en kopplad post går att läsa också när grannsystemet är nere.

**Krav:** FR-24, med det sammanslagna NFR-10 (`prd.md` rad 768–772 och 1011–1015, `epics.md` rad 2090–2118). NFR-5 säger att frysta nycklar bär läsbarheten under ett avbrott (`prd.md` rad 971). Arkitekturens grund är ADR-3 (`architecture.md` rad 222) och B-16, punkten FR-24 (rad 347–352). Kodgranskningen gav FR-24 utfallet DELVIS: ”Schemakontrollen tillåter `arende_id` och `arende_kalla` med tom `arende_nyckel`” (`underlag/kodgranskning.md` rad 41).

**Läget i dag, i en mening.** Migration 0060 kräver källan när ett ärende-id finns men inte den frysta nyckeln (`server/migrations/0060_arende_och_projektkoppling.sql` rad 27–33). Ingen läsväg i koden lämnar ut nyckeln, så en kopplad tidpost går i dag bara att läsa med rå SQL.

**Vad berättelsen gör:**
1. **Migrationen `server/migrations/0078_arendenyckel.sql`.** Den gör tre saker i tur och ordning:
   - En kantkontroll prövar befintliga rader och fäller migrationen med en driftbeskrivning om någon bryter mot regeln.
   - CHECK-villkoret `time_entries_arende_nyckel_kravs` läggs `NOT VALID`.
   - Villkoret valideras i samma migration.

   Villkoret från 0060 står kvar orört.
2. **Läsvägen.** `listTimeEntries` i `server/src/services/projects.ts` läser `arende_id`, `arende_nyckel` och `arende_kalla` ur raden. Därmed bär `list_time_entries` (REST och MCP ur samma definition) och svaret från `update_time_entry` den frysta nyckeln och källan, utan något uppslag.
3. **Provet** utökas i `server/test/arende-projektkoppling.test.ts`. Det prövar:
   - migrationen som migration, mot en databas på 0077;
   - villkoret som rollen `app`;
   - avvisningen i REST;
   - schemagranskningen av `pg_constraint`, med en negativ kontroll;
   - läsningen utan uppslag.
4. **Dokumentationen:** `docs/MCP_ACTIONS.md` (raden om `list_time_entries`) och en post i `docs/STATUS.md`.

**Vad berättelsen inte gör:**
- **Ingen ny skrivväg för ärendekopplingen.** Ingen åtgärd tar i dag emot `arende_*`, och alla tidpostscheman är `.strict()`. Regeln ligger i schemat, så den gäller också för varje framtida skrivväg (`docs/project-context.md` rad 88).
- **Ingen ändring i webbvyn.** `server/src/http/view/routes.ts` rörs inte (Beslutslogg, punkt 4).
- **Inget om `invoice_appendix_rows.arende_nyckel`.** Kolumnen (0060 rad 40) skrivs inte av någon kod i dag. FR-24:s mönster gäller `time_entries`.
- **Inget om referenserna i `uppdrag_referens`.** De hör till Story 3.1.
- **Ingen körd migration ändras.** Det gäller 0001–0077, också 0060.

**Bygge och grind.** Byggkedjan bygger berättelsen i en kopia och driftsätter först efter godkänd code-review (Dev Notes → ”Byggkedjan”). Varje uppgift och varje acceptanskriterium prövas i kopian, före driftsättningen, med provfilen `server/test/arende-projektkoppling.test.ts`.

## Acceptance Criteria

Kriterierna 1–4 är ordagranna ur `epics.md` (Story 3.5, rad 2100–2118). Raderna under *Mätbart* anger hur kriteriet prövas i den här kodbasen och lägger inte till några krav. Allt prövas i kopian med `server/test/arende-projektkoppling.test.ts`. P-numren står i Dev Notes → ”Prov och verifiering”.

1. **Kantkontrollen före villkoret.**
   **Given** nästa lediga migration
   **When** CHECK-villkoret ”`arende_id` kräver `arende_nyckel` och `arende_kalla`” införs på `time_entries`
   **Then** prövar migrationen först befintliga rader
   **And** bryter någon mot regeln fäller migrationen med en driftbeskrivning, samma kantkontroll som i 0068, och ingen fråga går till David
   **And** villkoret läggs `NOT VALID` och valideras i samma migration.
   - *Mätbart:* migrationen heter `server/migrations/0078_arendenyckel.sql`. Numret är reserverat i vågplanen.
   - *Mätbart:* filen har den här ordningen:
     1. huvudkommentaren;
     2. kantkontrollen i ett `DO $$`-block, i samma form som 0068 rad 495–506;
     3. `ADD CONSTRAINT time_entries_arende_nyckel_kravs … NOT VALID`, idempotent genom en uppslagning i `pg_constraint`;
     4. `ALTER TABLE time_entries VALIDATE CONSTRAINT time_entries_arende_nyckel_kravs`;
     5. `COMMENT ON CONSTRAINT`.

     Provet läser filen, tar bort `--`-kommentarerna och prövar sedan den återstående koden (P2), så att huvudkommentarens ord inte räknas:
     - `ADD CONSTRAINT time_entries_arende_nyckel_kravs … CHECK (…) NOT VALID;` och `VALIDATE CONSTRAINT time_entries_arende_nyckel_kravs` finns;
     - `RAISE EXCEPTION` står före `ADD CONSTRAINT`.
   - *Mätbart:* provet kör migrationsfilen från disk mot en databas som står på 0077 (P3).
     - För var och en av de fem regelbrotten i `BROTT` fäller filen med SQLSTATE `P0001`. Meddelandet innehåller `driftfel fore 0078: 1 tidpost(er) har arende_id utan fryst arende_nyckel eller arende_kalla` och radens id.
       - Pröva med `toContain`, aldrig med ett oescapat reguljärt uttryck, eftersom `(er)` i ett regex är en grupp.
       - Felet är kantkontrollens och inte 23514 från valideringen, så prövningen kom först.
     - Efter felet finns inget villkor med namnet i `pg_constraint`, och raden är oförändrad.
     - Med fem rader som bryter samtidigt innehåller meddelandet `5 tidpost(er)` och alla fem id.
   - *Mätbart:* när raderna har lagats (nyckel och källa satta, som drift gör) går samma fil igenom (P3).
     - `pg_constraint` visar `time_entries_arende_nyckel_kravs` med `contype = 'c'` och `convalidated = true`.
     - Rader med komplett trippel och rader med tre NULL är oförändrade.
     - En andra körning av filen ger inget fel och inget andra villkor.
     - `time_entries_arende_komplett_check` har samma `pg_get_constraintdef` före och efter.
   - *Mätbart:* felet når aldrig David. Meddelandet riktar sig till drift. Migrationens kod, utan kommentarer, innehåller varken `INSERT`, `UPDATE` eller `action_approvals`, så den kan inte lägga någon post i kön eller undantagsvyn (P2).

2. **Skrivningen avvisas.**
   **Given** en skrivning med `arende_id` men utan nyckel eller källa
   **When** den görs
   **Then** avvisas den.
   - *Mätbart:* rollen `app` skriver genom `withTenantTransaction` ur `server/src/db/tx.ts` (P4).
     - `UPDATE` och `INSERT` på `time_entries` fälls med SQLSTATE `23514` och villkoret `time_entries_arende_nyckel_kravs` för varje fall i `BROTT`:
       - nyckeln NULL, tom eller bara blanktecken (mellanslag eller tabb);
       - källan tom eller bara blanktecken.
     - Id utan källa fälls med `23514` och `constraint === 'time_entries_arende_komplett_check'`, både `{ nyckel: null, kalla: null }` och `{ nyckel: 'LOC-316', kalla: null }`. Postgres prövar CHECK-villkor i namnordning, och `…_komplett_check` kommer före `…_nyckel_kravs`.
     - Raden är oförändrad efter varje försök.
     - Den positiva kontrollen: en komplett trippel går in, och att sätta alla tre till NULL (kopplingen tas bort) går in.
   - *Mätbart:* REST avvisar också (P5).
     - `log_time` och `update_time_entry` med `arende_id`, med eller utan nyckel, ger 400 `validation_error`, eftersom schemana är `.strict()`.
     - Antalet tidposter och den befintliga postens värden är oförändrade.

     Ingen väg genom API:t kan alltså skriva ett halvt par.

3. **Ingen främmande nyckel över gränsen.**
   **Given** schemagranskningen
   **W
```

## Utfall
Tester: 145 passed (145) · Granskning: GODKANT | Samtliga acceptanskriterier och kryssade uppgifter är belagda, utan identifierade fynd; kedjans verifierade testutfall är grönt. · Byggforsok: 1

## Modellkedja (Davids krav 17/8, reservvag 7/9)

* krav: kordes inte
* utveckling: **gpt-6.1-sol**
* granskning: **gpt-6-astra**

Granskaren ar inte forfattaren: gpt-6-astra granskade gpt-6.1-sols arbete.

Allt pa Davids abonnemang - inga API-tokens.
