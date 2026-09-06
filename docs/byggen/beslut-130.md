# Bygge beslut #130 — En sensitive-åtgärd `avsluta_uppdrag` som vid godkännande fyller `avslutat_med_oppna` med alla lever

Datum: 2026-09-06 21:44 · Branch: cto/en-sensitive-tg-rd-avsluta-uppdrag-som-v-130 · Overlamning: #130

## Mal
En sensitive-åtgärd `avsluta_uppdrag` som vid godkännande fyller `avslutat_med_oppna` med alla leverabler som inte står i `godkand` och stänger uppdraget via tjänstefunktionen `setProjectStatus('closed')`, plus en avslutsvy som visar de öppna, plus vitest-prov att 0068-triggern därefter fäller alla fyra räckvidderna.

## Kravspec (claude-fable-5) — sjalvbarande, med KALLA och ARKITEKTUR
```
Underlaget är verifierat mot repot: `avslutat_med_oppna text[]` ligger på `contracts` (0068 rad 61), triggern `vagrar_skrivning_pa_avslutat()` täcker de fyra räckvidderna (0068 rad 353–439), `setProjectStatus` finns i `services/projects.ts:187`, `approveAction` kör handlern i godkännandetransaktionen (`execute.ts:124`) — vilket är exakt det riskhanteringen kräver — och 1E Del 4-tabellen ger `avsluta_uppdrag` sensitivity `sensitive` utan `kravManniska`, med delegering till tjänstefunktionen (samma regel som `andra_baseline`). Uppdragsytans vyer bor på projektsidan i `view/routes.ts`, ingen egen `/uppdrag`-rutt finns i repot.

Kravspecen:

```
MAL | Ett uppdrag kan avslutas trots ogodkända leverabler utan att det öppna tystas: sensitive-åtgärden `avsluta_uppdrag` fryser listan över det som stod öppet i `contracts.avslutat_med_oppna`, stänger projektet via tjänstefunktionen `setProjectStatus('closed')`, vyn visar vilka — och därefter håller 0068-triggern all skrivning borta medan historiken förblir läsbar (FR-8, story S8.1).
KALLA | Överlämning #130 (vd 2026-09-06, S8.1 ur 1F, våg 4) + Davids ja 6/9; 1E Del 4-tabellen (`avsluta_uppdrag`: sensitive, ingen kravManniska, engångs resa 5, delegerar till `set_project_status('closed')`), Del 3 §3.1 (`avslutat_med_oppna` = fryst historik, ÄGD), Del 6 (avslutsskydd-provet); mandat 3/9 och 5/9, 1G GODKÄND 5/9.
ARKITEKTUR | Befintliga mönster: mutation via `executeAction` → `ACTIONS`-registret → tjänstelagret i `withTenantTransaction`; `sensitive` köas via `createApproval` och exekveras av `approveAction`, som kör handlern i GODKÄNNANDETRANSAKTIONEN (`execute.ts:124`) — riskens "beräkna vid godkännandet" faller ut av huset självt; tjänstemönstret `bekraftaStatusbyte` (`uppdragStatus.ts`: FOR UPDATE, `NotFoundError`/`ConflictError` ur `lib/errors.ts`, audit i samma transaktion); zod-strict ur `lib/validation.ts`; JS-fri serverrenderad vy med kanons tokens/komponentklasser ur `html.ts`; vitest mot riktig Postgres.
KRAV-1 | Ny action `avsluta_uppdrag` i `actions/registry.ts`: `sensitivity: 'sensitive'`, ingen `kravManniska` (exakt 1E Del 4 — förslaget får köas av vem som helst, bara en människa godkänner), strict indata `{ project_id: UuidSchema }`; handlern anropar ENBART tjänstefunktionen, aldrig `executeAction('set_project_status')` (1E:s `andra_baseline`-regel — `set_project_status` behåller sin `kravManniska` orörd). Dokumenteras under Uppdragsytan i `docs/MCP_ACTIONS.md`.
KRAV-2 | Ny tjänstefil `server/src/services/uppdragAvslut.ts` med `avslutaUppdrag(client, companyId, userId, projectId)`: låser projektraden `FOR UPDATE`, fäller okänt projekt med `NotFoundError` och ett redan stängt med `ConflictError` — listan är fryst historik (1E §3.1) och skrivs aldrig om.
KRAV-3 | I godkännandetransaktionen, FÖRE `setProjectStatus(..., 'closed')`: för varje avtal på projektet sätts `contracts.avslutat_med_oppna` till avtalets leverabelkoder med status != 'godkand' (parametriserat, ORDER BY kod; tom array när inget står öppet — NULL betyder därmed "aldrig avslutad via åtgärden"), plus auditrad med listan i details i samma transaktion (husets invariant; `project.set_status`-raden skrivs redan av tjänsten).
KRAV-4 | Avslutsvyn: uppdragets förstasida (`/app/c/:companyId/projects/:projectId`, `view/routes.ts`) visar för ett stängt projekt med satt `avslutat_med_oppna` en panel med de öppna leverabelkoderna (per avtal när uppdraget har flera) — JS-fritt, befintliga komponentklasser och tokens ur `html.ts`, ingen ny stil, ingen ny yta.
KRAV-5 | Ny vitest-fil `server/test/uppdragsytan-avslut.test.ts` genom stacken: (a) förslaget skriver INGENTING — `projects.status` kvar `active`, kolumnen NULL; (b) godkännandet stänger projektet och fyller listan rätt; (c) en leverabel som når `godkand` MELLAN förslag och godkännande står INTE i listan (beräknad vid godkännandet — riskens kärna); (d) alla godkända ⇒ tom array och avslutet TILLÅTS; (e) redan stängt fälls med Conflict och listan står orörd; (f) vyn visar de öppna koderna.
KRAV-6 | Samma fil provar att 0068-triggern TRÄFFAR efter ett avslut via åtgärden, alla fyra räckvidder mot just det uppdraget: modultabell-INSERT, ny `contract_parts`-rad, `receipts.contract_part_id`-koppling och `time_entries`-ompekning fälls alla — och SELECT mot samma tabeller går igenom (historiken läsbar). Provet att triggern finns bor kvar i `uppdragsytan-sparrar.test.ts` och rörs inte.
KRAV-7 | `npm run build` och `npm test` gröna med inklistrad utdata; `docs/STATUS.md` får sin sessionsrad.
ACCEPTANS | Granskaren kör `npm test` + `npm run build` och prickar av KRAV-5/6:s beteenden mot faktisk testutdata, samt läser KRAV-4:s panel mot designkontraktet; `avslutsskydd.py`/`handgrepp.py` körs av Hermes utanför repot — repots bevis är vitest-sviten och auditraderna.
AVGRANSNING | Ingen migration (0068 bär kolumnen och triggern — Davids fällda 0069-alternativ), inget nytt beroende, ingen scheduler, ingen sensitivity-ändring på någon annan åtgärd, `bekraftaStatusbyte`/svepet/leverabelregistret/`setProjectStatus` ändras inte utöver anropet.
uteslutet: avslutsknapp eller formulär i vyn som köar förslaget — kallan kraver det inte
uteslutet: återöppning eller tömning av `avslutat_med_oppna` — kallan kraver det inte
uteslutet: `koaRegisterkopia` vid avslutet — kallan kraver det inte
uteslutet: egen rutt eller subnav-post för avslutsvyn — kallan kraver det inte
uteslutet: status eller tidsstämpel i listan utöver koderna — kallan kraver det inte
uteslutet: notifiering/eskalering när avslutet köas eller godkänns — kallan kraver det inte
```

Två läsanvisningar till utvecklaren som specen bygger på: listberäkningen vid godkännandet kräver ingen egen mekanik — `approveAction` kör åtgärdens handler i godkännandetransaktionen, så hela `avslutaUppdrag` (lista + stängning) hamnar rätt av sig själv; och ordningen lista-före-stängning i KRAV-3 spelar roll eftersom hela avslutet ska vara en atomär transaktion där triggern aldrig hinner se ett stängt uppdrag före kolumnifyllnaden.
```

## Utfall
Tester: 127 passed (127) · Granskning: GODKANT | Bygget följer kravspecen punkt för punkt — `sensitive` utan `kravManniska` med strikt indata, tjänstefunktionen låser `FOR UPDATE` och skriver listan per avtal (parametriserat, `ORDER BY kod · Byggforsok: 1

## Modellkedja (Davids krav 17/8)
Krav+granskning: claude-fable-5 · Utveckling: claude-opus-5 · Claude Code pa Davids abonnemang — inga API-tokens
