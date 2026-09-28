# Bygge beslut #189 — Uppdragsytan S10.10: Dokumenten — projektets alla icke-raderade dokument som egen sida i undermenyn,

Datum: 2026-09-28 19:27 · Branch: cto/uppdragsytan-s10-10-dokumenten-projektet-189 · Overlamning: #302

## Mal
Uppdragsytan S10.10: Dokumenten — projektets alla icke-raderade dokument som egen sida i undermenyn, senaste versionen som direktlänk och tidigare versioner infällda (FR-43)

## Kravspec (claude-fable-5) — sjalvbarande, med KALLA och ARKITEKTUR
```
Alla radreferenser verifierade mot koden: `UPPDRAGSSIDOR` med tio poster slutar på Kontraktet (`routes.ts:3711`), 0068:s RLS/GRANT-block för `uppdrag_svepvarde` (rad 470–487), `kor_uppdragssvep` registrerad som `write` utan `kravManniska` med schemat i tjänsten (`registry.ts:1824`), och mönstren `tomtIKort`/`farskhetsrad`/`farskhetstid` finns (`routes.ts:3753–3772`). Migrationskedjan slutar i dag på 0075, så 0076 är nästa. Här är kravspecen:

---

MAL | Sidan Dokumenten på uppdragsytan: projektets alla icke-raderade dokument grupperade per mapp, senaste versionen som direktlänk och tidigare versioner infällda — David når varje underlag ur ytan utan att leta i Drive (FR-43).
KALLA | Överlämning #302 (beslut #189, Davids ja ordagrant 28/9 i Cowork); styrande story `02-Områden/hermes/uppdragsytan-s10-10-dokumenten.md`; FR-43/FR-22/FR-23/FR-35 i 1C-PRD:n.
ARKITEKTUR | Enbart befintliga mönster: `executeAction`→registret→tjänst→Postgres; zod-strict med schema i tjänsten (prejudikat `SvepIndataSchema`); CACHE-tabell med RLS/GRANT som `uppdrag_svepvarde` (0068); Hermes pushar in, appen ringer aldrig ut (ADR-4); JS-fri serverrenderad vy via `pageFor`.
KRAV-1 | Migration `0076_uppdrag_dokument.sql`: tabell `uppdrag_dokument` (kolumner enligt storyns punkt 1, `unique (company_id, project_id, kalla, extern_id)`, `kalla` check `'drive'|'valv'`) och `uppdrag_dokumentrot` (pk `(company_id, project_id)`); COMMENT ON TABLE med kategori CACHE; RLS-policies och `GRANT SELECT/INSERT/UPDATE/DELETE` till `app` exakt som `uppdrag_svepvarde` i 0068 rad 470–487; `npm run migrate` idempotent.
KRAV-2 | Åtgärd `skriv_dokumentforteckning` i `registry.ts`: `sensitivity: 'write'`, utan `kravManniska` (källsystemets fakta — samma skäl som `kor_uppdragssvep`); zod-schemat bor i `services/uppdragDokument.ts` med formen ur storyns punkt 2 (rot: namn 1..300 + länk-url ≤2000; högst 5000 dokumentrader).
KRAV-3 | Skrivsemantik: ersätter projektets hela förteckning i EN transaktion — upsert av inkomna rader, DELETE av projektets rader som inte kom, roten upsertas; svar `{ project_id, antal, borttagna, last_nar }`; okänt eller annat bolags projekt ger fel och ingenting skrivs; idempotent (samma push igen ger samma rader och `borttagna: 0`).
KRAV-4 | Åtgärd `las_dokumentforteckning`: `sensitivity: 'read'`, input `{ project_id }`, svar `{ rot|null, last_nar|null, antal, mappar: [{ sokvag, familjer: [{ nyckel, senaste, tidigare[] }] }], valv: [...] }`; grupperingen görs i tjänsten så att vy, REST och MCP får samma svar; båda åtgärderna faller ut som REST och MCP via registret (FR-23).
KRAV-5 | Familjeregeln som rena, enhetstestade funktioner `familjenyckel(namn)` och `grupperaDokument(rader)` i tjänsten: samma `kalla`+`sokvag`+nyckel = en familj; nyckeln enligt storyns punkt 4 (gemener, ändelse bort, versions-, datum-, status-, kopie- och löpnummerled bort endast som egna led — allt annat hör till namnet); senaste = störst `andrad`, sedan högst versionsnummer, sedan namn; `andrad` saknas → sist; familjer per mapp nyast först, mappar i `sv`-bokstavsordning med roten först.
KRAV-6 | Sidan `/c/:companyId/projects/:projectId/dokumenten` via `pageFor('projects', 'Dokumenten', …)`; `UPPDRAGSSIDOR` (`routes.ts:3711`) får `['dokumenten', 'Dokumenten']` SIST, efter `['kontraktet', 'Kontraktet']` — elva poster på alla uppdragssidor, `aria-current="page"` på exakt en.
KRAV-7 | Sidinnehåll: överst "N dokument i M mappar", länken "Öppna mappen i Drive" till roten och `.farskhet`-raden via `farskhetsrad`/`farskhetstid` — "läst ur Drive <tid>" med datum framför när det inte är i dag (FR-35); per mapp `<h2>` med mappvägen (roten heter "Mappens rot") och en lista; varje familj en rad med senaste versionen som länk (`target="_blank" rel="noopener"`) och datum i `sv-SE`; tidigare versioner i `<details><summary>N tidigare versioner</summary>` med samma radform; valvets dokument i eget avsnitt "I valvet"; ingen JavaScript (CSP `script-src 'none'`).
KRAV-8 | Tomheten via `tomtIKort` (FR-22): ingen förteckning ännu → "Förteckningen har inte lästs än — Hermes läser projektets mappar varje timme." · förteckning utan rader → "Mappen är tom i Drive."
KRAV-9 | Prov: `server/test/uppdragsytan-dokumenten.test.ts` med fallen (a)–(g) exakt enligt storyns punkt 6; menytestets förväntningar i `server/test/uppdragsytan-menyn.test.ts` uppdateras till elva poster i SAMMA bygge.
ACCEPTANS | `npm run build` och hela `npm test` gröna med inklistrad utdata (inkl. (a)–(g) och menytestet), `designparitet.py` grön; granskaren ser i (f)-provet undermenyns elfte post, `rel="noopener"` på länkarna, `<details>`-strukturen, `.farskhet`-raden och tomhetens två texter.
AVGRANSNING | Endast: migration 0076, `services/uppdragDokument.ts`, två registerposter, ny vy-route + `UPPDRAGSSIDOR`-raden, de två testfilerna. Inga nya CSS-klasser, ingen JS, inga ändringar på Kontraktet eller övriga sidor utöver undermenyns nya post, inga nya beroenden.
uteslutet: Hermes-skillen `dokumentforteckning.py` (byggs av Cowork mot kontraktet i KRAV-2) — källan kräver det inte i det här bygget
uteslutet: Drive-/valvåtkomst, delning eller uppladdning från appen (ADR-4) — källan kräver det inte
uteslutet: lagring av dokumentinnehåll (bara namn, länk, datum, storlek) — källan kräver det inte
uteslutet: koppling dokument→leverabel med statusförslag (S3.2) — källan kräver det inte
uteslutet: sök, filtrering eller paginering på sidan — källan kräver det inte
```

## Utfall
Tester: 143 passed (143) · Granskning: GODKANT | Alla nio krav uppfyllda med enbart befintliga mönster (0068:s RLS/GRANT, SvepIndataSchema-prejudikatet, pageFor, central auditlogg i executeAction), inga nya beroenden eller CSS-klasser, kor · Byggforsok: 1

## Modellkedja (Davids krav 17/8, reservvag 7/9)

* krav: **claude-fable-5**
* utveckling: **claude-opus-5**
* granskning: **claude-fable-5**

Granskaren ar inte forfattaren: claude-fable-5 granskade claude-opus-5s arbete.

Allt pa Davids abonnemang - inga API-tokens.
