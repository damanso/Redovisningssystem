# Bygge beslut #178 — Kvittobilagor: bygg receipt_files + signerad uppladdning utanför MCP (create_receipt_upload_url, con

Datum: 2026-09-22 22:54 · Branch: cto/kvittobilagor-bygg-receipt-files-signera-178 · Overlamning: #272

## Mal
Kvittobilagor: bygg receipt_files + signerad uppladdning utanför MCP (create_receipt_upload_url, confirm_receipt_file, get_receipt_file_url) i API:t och action-katalogen, lokal objektlagring bakom ett lagringsgränssnitt, write-once på bokförda kvitton

## Kravspec (claude-fable-5) — sjalvbarande, med KALLA och ARKITEKTUR
```
Underlaget är verifierat mot koden: `files`-tabellen (migration 0004) och `fileStorage.ts` finns redan med magic bytes/sha256/UUID-namn, `attachReceiptFile` finns bara som multipart-väg via HTTP, MCP-fetcharna saknar timeout, `PUBLIC_API_URL` saknas i `config.ts`, och migrationskedjan står på 0074. Kravspecen:

---

MAL | Kvitton kan bära bilagor: tabell `receipt_files` + tre actions (`create_receipt_upload_url`, `confirm_receipt_file`, `get_receipt_file_url`) så att agenten bifogar Davids kvittobild utan att filbytes passerar MCP. Idag har alla 60+ bokförda kvitton `file_id` null och underlaget bär avdraget (Skatteverket kräver originalkvittot).
KALLA | Överlämning #272 (beslut #178), Davids ja 22/9 23:20; hela utvecklingsprompten: `/home/hermes/brain/02-Områden/hermes/byggen/underlag-kvittobilagor-2026-09-22.md` — läs den vid oklarhet, gissa inte.
ARKITEKTUR | Endast befintliga mönster: actions-registret `def({name,title,sensitivity,inputSchema,handler})` med zod-strict + tjänst i `services/`; `withTenantTransaction` med RLS + audit i samma transaktion; `fileStorage.ts`-mönstren (magic bytes, UUID-lagringsnamn, `wx`-flagga, sha256, katalog ur `config.ts`); migration `0075_...` i kedjan; endast `config.ts` läser env; ingen scheduler i redovisningen; inga nya npm-paket (HMAC via `node:crypto`).
KRAV-1 | Migration: `receipt_files` (id, receipt_id FK, company_id, filename, mime_type, size_bytes, sha256, storage_key, status, uploaded_at, uploaded_by, superseded_by) med RLS-policyer efter samma mönster som `files` (0004). Flera rader per kvitto. `receipts.file_id` kvar nullbar som "primär bilaga", skriven ur `receipt_files` — sanningen dupliceras inte.
KRAV-2 | Objektlagring bakom ETT gränssnitt i servicelagret; enda drivern i detta bygge är lokal katalog konfigurerad via `config.ts` (i drift under `/opt/redovisning-app/shared/`). Gränssnittet lämnas redo för fler drivrutiner utan att någon annan byggs.
KRAV-3 | `create_receipt_upload_url(receipt_id, filename, mime_type, size_bytes)` → `{upload_url, file_id, expires_at}`: signerad engångs-PUT, 15 min TTL, bas ur ny env `PUBLIC_API_URL` i `config.ts`; saknas den → tydligt fel, aldrig en localhost-URL. Tillåtna typer: image/jpeg, image/png, image/heic, application/pdf; tak 25 MB.
KRAV-4 | PUT-endpointen tar rå bytes utan JWT — HMAC-signaturen (nyckel ur befintlig hemlighetshantering i `config.ts`) är behörigheten. Den validerar signatur + TTL, mime/size mot det begärda, innehållets magic bytes (heic läggs till i allowlisten), och avvisar återanvänd signatur. Skrivning sker via lagringsgränssnittet med vägrad överskrivning.
KRAV-5 | `confirm_receipt_file(file_id)`: verifierar att objektet finns, läser storlek, beräknar och sparar sha256, aktiverar raden. Obekräftade rader vars TTL gått ut städas lazily i tjänstens anrop (rad + objekt) — ingen cron, redovisningen har ingen scheduler.
KRAV-6 | Livscykel: bilaga får bifogas till både utkast och bokfört kvitto. På bokfört kvitto är bilagan write-once — överskrivning och radering ger fel; rättelse = lägg till rätt bilaga och sätt `superseded_by`. `delete_draft_receipt` städar obokat utkasts bilagerader och objekt. Varje bifogning auditloggas (sha256, uppladdare, tid) i samma transaktion som mutationen.
KRAV-7 | `get_receipt_file_url(file_id)` → signerad GET med kort TTL mot `PUBLIC_API_URL`; nedladdat innehåll matchar sparad sha256. `list_receipts` returnerar bilageantal + bilagemetadata per kvitto.
KRAV-8 | Alla tre actions registreras med `sensitivity: 'write'` (körs direkt utan godkännande, som `create_receipt`); beskrivningarna förklarar trestegssekvensen och att steg 2 är en PUT utanför MCP.
KRAV-9 | MCP-serverns fetch-anrop i `server/src/mcp` får hård timeout (≈60 s) och ett begripligt fel i stället för att hänga.
KRAV-10 | Vitest genom hela stacken (supertest, riktig Postgres): uppladdning/bekräftelse/nedladdning, före+efter `book_receipt`, write-once ger fel, flera bilagor, sha256-match, tenant-isolering (bolag A når inte bolag B:s file_id — varken metadata eller URL), utgången/återanvänd signatur avvisas, saknad `PUBLIC_API_URL` ger fel. Inget befintligt test försvagas.
ACCEPTANS | Klart-när-listan ur överlämningen körd med faktisk inklistrad utdata: 1,3 MB JPEG bifogas utan att filbytes passerar ett MCP-anrop; bilaga före OCH efter `book_receipt`; bokförd bilaga kan inte skrivas över/raderas (testat, ger fel); sha256 sparas och matchar vid nedladdning; flera bilagor per kvitto; RLS håller; signerad URL dör efter TTL; `npm test` + `npm run build` gröna; deployat via redovisning-deploy. Kvitto 65–67 end-to-end via MCP är Davids egen kontroll efteråt.
AVGRANSNING | Rör inte befintlig multipart-väg (`routes/files.ts`) eller `files`-tabellen, inte bokföringslogiken i `book_receipt`, inte godkännandeflödet, inga nya beroenden, inga andra schemaändringar än `receipt_files`. Minsta möjliga ändring gäller.
uteslutet: S3-/Hetzner-driver — källan kräver det inte
uteslutet: miniatyrer i webbens verifikatvy — källan kräver det inte
uteslutet: base64-uppladdning genom MCP — källan kräver det inte
uteslutet: uppladdnings-UI i webbvyn — källan kräver det inte
uteslutet: cronbaserad städning av obekräftade rader — källan kräver det inte
uteslutet: migrering av befintliga 60+ kvitton — källan kräver det inte
```

## Utfall
Tester: 141 passed (141) · Granskning: GODKANT | Alla tio krav är uppfyllda med belagd täckning: migration 0075 följer husmönstret (RLS/GRANT/trigger, enkel FK med samma motivering som 0074), tjänsten kör tenant+audit i samma transaktion ä · Byggforsok: ateruppning

## Modellkedja (Davids krav 17/8, reservvag 7/9)

* krav: kordes inte
* utveckling: kordes inte
* granskning: **claude-fable-5**


Allt pa Davids abonnemang - inga API-tokens.
