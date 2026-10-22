# PRD-bygget redovisningen 7-2-kvittobilagorna-kan-lagras-i-s3-kompatibel-objektlagring — PRD redovisningen 7-2-kvittobilagorna-kan-lagras-i-s3-kompatibel-objektlagring: # Story 7.2: Kvittob

Datum: 2026-10-22 07:20 · Branch: cto/prd-redovisningen-7-2-kvittobilagorna-kan-lagras-i-s3-kompat-9261 · Kalla: 02-Områden/hermes/prd/redovisningen-1c-prd.md (fryst 29/9, Davids beslut #194)

## Mal
PRD redovisningen 7-2-kvittobilagorna-kan-lagras-i-s3-kompatibel-objektlagring: # Story 7.2: Kvittobilagorna kan lagras i S3-kompatibel objektlagring Status: ready-for-dev <!-- Note: Validation is opt

## PRD-kravet (ordagrant ur den frysta PRD:n) och astras kodgranskning
```
# Story 7.2: Kvittobilagorna kan lagras i S3-kompatibel objektlagring

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

Som David,
vill jag att kvittobilagornas lagring är ett uttryckligt val bakom ett gränssnitt, där lokal volym är det enda byggda valet och varje lagringsfel namnger lagringen,
så att bilagorna ligger kvar på servern som jag har beslutat, ingen kan tro att de ligger någon annanstans, och en extern lagring kan läggas bakom samma gränssnitt den dag jag vill det.

**Kodbas:** redovisning. **Krav:** FR-15 (med FR-12:s acceptans mot gränssnittet). **Beror på:** inga. **Beslut:** Davids svar 2026-10-16 12:43 (`_bmad-output/planning-artifacts/underlag/davids-svar.md` rad 40–43): bilagorna ligger kvar på servern, med kopian som hämtas till Davids Mac två gånger om dagen. Inget nytt konto, inga nya nycklar och inget nytt beroende. Bygget behöver inget mer svar från David.

**Varför berättelsen inte bygger någon S3-driver** (beslutet står i Dev Notes → Davids beslut och epikens kriterier):
- Epikens fyra kriterier (`_bmad-output/planning-artifacts/epics.md` rad 1942–1958) skrevs medan PRD fråga 5 var öppen, och de förutsätter alternativet «flytta till Hetzner Object Storage». David valde det andra alternativet: lagringen stannar lokal (PRD rad 467: «Båda uppfyller FR-12»).
- En S3-driver behöver en S3-klient. Det är ett nytt beroende eller en egen klient i stället för ett. Den behöver också konto och nycklar, och den ger redovisningens första utgående anrop (arkitekturen rad 187 och 685: «ett beslut för David»). David har sagt nej till alla tre.
- Koden säger samma sak (`server/src/services/objektlagring.ts` rad 7–9): «En drivrutin som ingen kan köra är en drivrutin ingen testar — nästa drivrutin byggs när den behövs, mot det här gränssnittet.»
- Bygget gör därför det av FR-15 som håller under beslutet. Valet av lagring blir uttryckligt och fail-fast i `server/src/config.ts`. Gränsen «bakom samma gränssnitt» blir bevisad: FR-12:s acceptans prövas genom gränssnittet, och bara två filer känner lagringsroten. Lagringens fel blir tydliga och namnger lagringen. Epikens kriterium 3 (flyttkommandot) utgår, eftersom det inte finns någon annan lagring att flytta till.

**Läget i dag** (läst 2026-10-22 i kopian av main):
- `server/src/services/objektlagring.ts` har gränssnittet `Objektlagring` (rad 20–29) med en drivrutin, den lokala katalogen (rad 64–88). Fabriken `objektlagring()` returnerar den alltid (rad 90–93), och inget i konfigurationen säger vilken lagring som körs.
- Den lokala drivrutinen släpper filsystemets fel rakt igenom. En skrivning som misslyckas, ett objekt som saknas och en läsning av en katalog blir alla 500 `internal_error` (`server/src/http/middleware/errorHandler.ts` rad 55–56). `storlek` gör varje fel till «finns inte» (rad 73–79), så ett objekt som inte går att läsa ger beskedet att objektet saknas.
- Testsviten `server/test/kvittobilagor.test.ts` prövar objektens existens med sökvägar i filsystemet (`process.env.RECEIPT_FILES_DIR`, rad 247, 268, 304 och 444), inte genom gränssnittet. Den laddar inte upp någon PNG eller PDF och prövar inte taket på exakt 25 MB.
- Inget i server/src kastar ett fel med status 503 genom felklasserna. `server/src/lib/errors.ts` har subklasserna för 400, 401, 403, 404 och 409 (rad 29–58), och projektets regel är att fel kastas som subklasser ur den filen (docs/project-context.md rad 43). Lagringens 503 får därför en egen subklass där.

## Förkrav

```förkrav
fil: server/src/services/objektlagring.ts ändras
fil: server/src/config.ts ändras
fil: server/src/lib/errors.ts ändras
fil: server/test/kvittobilagor.test.ts ändras
fil: server/test/kvittobilagor-lagring.test.ts ny
fil: server/test/failfast.test.ts ändras
fil: docs/MCP_ACTIONS.md ändras
fil: docs/STATUS.md ändras
fil: server/src/services/receiptFiles.ts läses
fil: server/src/http/routes/receiptFiles.ts läses
fil: server/src/http/middleware/errorHandler.ts läses
fil: server/src/lib/bilagesignatur.ts läses
fil: server/src/services/fileStorage.ts läses
fil: server/src/actions/registry.ts läses
fil: server/src/http/app.ts läses
fil: server/src/server.ts läses
fil: server/src/db/tx.ts läses
fil: server/test/helpers.ts läses
fil: server/test/env.ts läses
fil: server/test/setup.ts läses
fil: server/test/globalSetup.ts läses
fil: server/test/voucherLinkHelper.ts läses
fil: server/test/utskickHelper.ts läses
fil: server/test/uppdragsytan-utskick.test.ts läses
fil: server/test/documents.test.ts läses
fil: server/test/uppdragsytan-beslut.test.ts läses
fil: server/test/fakturanummer-samtidighet.test.ts läses
fil: server/test/payroll-tax-dublett.test.ts läses
fil: server/vitest.config.ts läses
fil: server/tsconfig.json läses
fil: server/tsconfig.test.json läses
fil: server/package.json läses
fil: package.json läses
fil: CLAUDE.md läses
fil: docs/ARKITEKTUR.md läses
fil: docs/project-context.md läses
fil: _bmad-output/planning-artifacts/epics.md läses
fil: _bmad-output/planning-artifacts/prd.md läses
fil: _bmad-output/planning-artifacts/architecture.md läses
fil: _bmad-output/planning-artifacts/underlag/kodgranskning.md läses
fil: _bmad-output/planning-artifacts/underlag/davids-svar.md läses
fil: _bmad-output/planning-artifacts/underlag/kedjans-formagor.md läses
fil: _bmad-output/implementation-artifacts/sprint-status.yaml läses
fil: _bmad-output/implementation-artifacts/7-1-kvittobilagor-i-gmail-blir-kvittobilagor-i-systemet.md läses
fil: _bmad-output/implementation-artifacts/4-3-agenten-kan-bifoga-dokument-upp-till-10-mb.md läses
fil: _bmad/bmm/workflows/4-implementation/create-story/checklist.md läses
fil: hermes/skills/gmail_kvitton.py läses
fil: hermes/skills/cto_utveckling.py läses
fil: hermes/skills/bmad_story.py läses
prov: kvittobilagor ändras GRÖN
prov: kvittobilagor-lagring nytt GRÖN
prov: failfast ändras GRÖN
prov: uppdragsytan-utskick berörs GRÖN
prov: uppdragsytan-undantag berörs GRÖN
prov: uppdragsytan-baselineorsak berörs GRÖN
prov: uppdragsytan-godkannandevag berörs GRÖN
prov: vat-declaration berörs GRÖN
prov: documents berörs GRÖN
prov: draft-delete berörs GRÖN
prov: uppdragsytan-beslut berörs GRÖN
prov: fakturanummer-samtidighet berörs GRÖN
prov: payroll-tax-dublett berörs GRÖN
prov: continuityvakt berörs KUNDE_INTE
prov: redovisning_fortroende berörs KUNDE_INTE
beroende: zod
beroende: express
beroende: pg
beroende: vitest
beroende: supertest
beroende: tsx
tjanst: 127.0.0.1:5433 vitest kör alla prov mot den stående testdatabasen redovisning-vitest-pg
kontrakt: redovisningen rutt PUT /api/receipt-files/:fileId/content prov kvittobilagor
kontrakt: redovisningen rutt GET /api/receipt-files/:fileId/content prov kvittobilagor
kontrakt: redovisningen rutt POST /api/companies/:companyId/actions/create_receipt prov kvittobilagor
kontrakt: redovisningen rutt POST /api/companies/:companyId/actions/create_receipt_upload_url prov kvittobilagor
kontrakt: redovisningen rutt POST /api/companies/:companyId/actions/confirm_receipt_file prov kvittobilagor
kontrakt: redovisningen rutt POST /api/companies/:companyId/actions/get_receipt_file_url prov kvittobilagor
kontrakt: redovisningen rutt POST /api/companies/:companyId/actions/list_receipts prov kvittobilagor
kontrakt: redovisningen rutt POST /api/companies/:companyId/actions/delete_draft_receipt prov kvittobilagor
kontrakt: redovisningen rutt POST /api/companies/:companyId/actions/book_receipt prov kvittobilagor
kontrakt: redovisningen rutt POST /api/companies/:companyId/approvals/:id/approve prov kvittobilagor
kontrakt: redovisningen funktion objektlagring nytt kvittobilagor-lagring
kontrakt: redovisningen funktion ServiceUnavailableError nytt kvittobilagor-lagring
kontrakt: redovisningen funktion lagringsrot prov kvittobilagor-lagring
kontrakt: redovisningen funktion nyLagringsnyckel prov kvittobilagor
kontrakt: redovisningen funktion taEmotBilageUppladdning prov kvittobilagor
kontrakt: redovisningen funktion bekrafta
```

## Utfall
Tester: 172 passed (172) · Granskning: GODKANT | Alla sex fynd från förra varvet är åtgärdade i koden (`objektlagring.ts`:129–149, 152, 173–176, 184, 195; `receiptFiles.ts`:229; `MCP_ACTIONS.md`:286–292; L1, L2 och L8). Alla fyra kriterier · Byggforsok: 2

## Modellkedja (Davids krav 17/8, reservvag 7/9)

* krav: **claude-opus-5-5**
* utveckling: **claude-opus-5-5**
* granskning: **claude-opus-5-5 (Codex spärrat — Davids regel 12/10; Codex granskar i efterhand)**

Granskaren ar inte forfattaren: claude-opus-5-5 (Codex spärrat — Davids regel 12/10; Codex granskar i efterhand) granskade claude-opus-5-5s arbete.

effort (Davids beslut 20/10): validering high · bygg xhigh · granskning xhigh — riskdel redovisningen
Allt pa Davids abonnemang - inga API-tokens.
