# PRD-bygget crm 3-3-mottagaren-tar-emot-loftets-avslut-och-en-borttagen-deadline — PRD crm 3-3-mottagaren-tar-emot-loftets-avslut-och-en-borttagen-deadline: # Story 3.3: Mottagaren ta

Datum: 2026-11-21 19:03 · Branch: cto/prd-crm-3-3-mottagaren-tar-emot-loftets-avslut-och-en-bortta-9319 · Kalla: 02-Områden/hermes/prd/crm-1c-prd.md (fryst 29/9, Davids beslut #194)

## Mal
PRD crm 3-3-mottagaren-tar-emot-loftets-avslut-och-en-borttagen-deadline: # Story 3.3: Mottagaren tar emot löftets avslut och en borttagen deadline Status: ready-for-dev <!-- Skapad av create-st

## PRD-kravet (ordagrant ur den frysta PRD:n) och astras kodgranskning
```
# Story 3.3: Mottagaren tar emot löftets avslut och en borttagen deadline

Status: ready-for-dev

<!-- Skapad av create-story 2026-11-21 i autonomt läge och validerad i ny kontext samma dag; rapporten står bredvid berättelsen (.validering.md). -->

## Story

Som David,
vill jag att ett löfte stängs i relationsdelen när ärendet stängs och att en borttagen deadline försvinner — utan att något jag själv satt ändras,
så att kön och åtagandevyn inte visar löften som är avslutade med deadlines som inte gäller.

Kodbas: redovisning (kedjan cto) · Täcker: FR-36 (mottagarsidan), FR-8 (fältregeln för status och deadline) · Beror på: 1.1 (ursprung per fält för löften, migrationen `server/migrations/0090_crm_event_provenance.sql`, done och i basen) och 1.2 (`update_crm_commitment` med `due_date: null` och `nullIsWrite` i människovakten, done och i basen) · Avsändarsidan, att Hermes faktiskt skickar `status` och `due_date: null`, är berättelse 3.4 och beror på den här · Arkitektur: A-2 (löftets livscykel över kontraktet), A-1 (skyddade löftesfält och undantaget för en stängd status utan ursprungsrad), «Ett flöde, tre ingångar», «Tysta fel förbjudna» och antimönstret `due_date = COALESCE($7, due_date)`.

Berättelsen skrevs 2026-11-21 ur epics.md (Story 3.3, kriterierna ordagrant), PRD:ns FR-36 och FR-8, Davids svar 2026-10-16 på fråga 13 a (fältregeln behålls), arkitekturens A-1 och A-2, kodgranskningen av FR-36 och koden i arbetskopian. Bygget lägger ingen migration, ingen ny åtgärd, ingen ny rutt och ingen ny tabell: kolumnerna `status`, `completed_at` och `due_date` finns sedan 0052, och ursprungets löftesmål finns sedan 0090. Kontraktet `ingest_crm_events` får två fält (`status` och ett nullbart `due_date`), mottagaren `recordCommitment` skickar statusen genom samma människovakt som övriga fält, avgör A-2:s undantag med en ren regel, skriver statusen och `completed_at` i omsändningens enda UPDATE och skyddar ett människosatt förfallodatum också mot `null`, och dokumenten beskriver det. Provet är en ny fil, `server/test/crm-commitment-lifecycle.test.ts`, plus en ny `describe` i `server/test/crm-rules.test.ts`.

## Förkrav

Blocket nedan är berättelsens hela yta. Fem saker om formen:

- **Inga beroenderader.** Bygget lägger inte till något paket. Förkontrollens K5 läser för redovisningen manifestet i repots översta katalog, där bara arbetsytorna står, och en `beroende:`-rad hade därför blivit RÖD fast inget är nytt. Berättelse 2.3 validerades utan sådana rader av samma skäl.
- **Inga kontraktsrader.** Berättelsen läser ingen annan dels rutt, fil eller funktion. `ingest_crm_events` och `docs/crm/API_KONTRAKT.md` ägs av redovisningen. Hermes intag (avsändaren) är konsumenten och ändras först i 3.4; dess nuvarande körning skickar varken `status` eller `null`, så ett tillagt valfritt fält ändrar inget för den.
- **Inga kommandon och inga förmågor.** Byggaren har Read, Glob, Grep, Write, Edit och TodoWrite. Kedjan kör `npm ci`, typkontrollen, bygget och hela vitest-sviten efter utvecklarens sista ändring.
- **Proven.** Kedjan cto kör vitest-sviten. Det nya provet `crm-commitment-lifecycle` och det ändrade `crm-rules` ska vara GRÖNA. Berörsraderna är de befintliga vitest-filerna som anropar `ingest_crm_events` eller `record_crm_commitment` (båda når `recordCommitment`), läser `docs/crm/API_KONTRAKT.md` eller `docs/MCP_ACTIONS.md`, söker igenom serverns källträd eller listar åtgärdernas scheman (Dev Notes, «Regressionsytan»). Deras läge är kedjans senaste gröna svit. Hermes egna prov körs inte av kedjan cto (Dev Notes, «Baslinjen»).
- **Läsfilerna** förklaras under blocket.

```förkrav
fil: server/src/actions/registry.ts ändras
fil: server/src/services/crmIngest.ts ändras
fil: server/src/services/crmRelations.ts ändras
fil: server/src/lib/crmRules.ts ändras
fil: server/test/crm-commitment-lifecycle.test.ts ny
fil: server/test/crm-rules.test.ts ändras
fil: docs/crm/API_KONTRAKT.md ändras
fil: docs/MCP_ACTIONS.md ändras
fil: docs/STATUS.md ändras
fil: server/src/services/crmProvenance.ts läses
fil: server/src/lib/updateBuilder.ts läses
fil: server/src/lib/validation.ts läses
fil: server/src/lib/errors.ts läses
fil: server/src/actions/execute.ts läses
fil: server/src/http/middleware/errorHandler.ts läses
fil: server/src/db/tx.ts läses
fil: server/migrations/0052_crm_schema.sql läses
fil: server/migrations/0054_crm_review_fixes.sql läses
fil: server/migrations/0090_crm_event_provenance.sql läses
fil: server/test/helpers.ts läses
fil: server/test/setup.ts läses
fil: server/test/env.ts läses
fil: server/test/sandvagHelper.ts läses
fil: server/test/crm-event-provenance.test.ts läses
fil: server/test/crm-gdpr-replay.test.ts läses
fil: server/test/crm-status-link.test.ts läses
fil: server/test/crm-name-alias.test.ts läses
fil: server/test/crm-sandvag.test.ts läses
fil: server/test/crm-provenance.test.ts läses
fil: server/test/crm-sfar.test.ts läses
fil: server/test/crm-sfar-3.test.ts läses
fil: server/test/crm-sfar-yta.test.ts läses
fil: server/test/crm-views.test.ts läses
fil: server/test/crm-design-parity.test.ts läses
fil: server/test/crm-thread.test.ts läses
fil: server/test/crm-org-name-norm.test.ts läses
fil: server/test/crm-review-fixes.test.ts läses
fil: server/test/crm-derivations.test.ts läses
fil: server/test/crm-schema.test.ts läses
fil: server/test/crm-today.test.ts läses
fil: server/test/crm-actions-ui.test.ts läses
fil: server/test/crm-stadning.test.ts läses
fil: server/test/entity-links.test.ts läses
fil: server/test/min-sida.test.ts läses
fil: server/test/mcp.test.ts läses
fil: server/test/draft-delete.test.ts läses
fil: server/test/fakturanummer-samtidighet.test.ts läses
fil: server/test/payroll-tax-dublett.test.ts läses
fil: server/test/voucher-links.test.ts läses
fil: server/test/uppdragsytan-utskick.test.ts läses
fil: server/test/uppdragsytan-scopelinje.test.ts läses
fil: server/test/uppdragsytan-beslut.test.ts läses
fil: server/test/uppdragsytan-undantag.test.ts läses
fil: server/test/uppdragsytan-godkannandevag.test.ts läses
fil: server/test/uppdragsytan-baselineorsak.test.ts läses
fil: server/test/vat-declaration.test.ts läses
fil: server/test/kvittobilagor-lagring.test.ts läses
fil: docs/project-context.md läses
fil: CLAUDE.md läses
fil: _bmad-output/planning-artifacts/prd.md läses
fil: _bmad-output/planning-artifacts/epics.md läses
fil: _bmad-output/planning-artifacts/architecture.md läses
fil: _bmad-output/planning-artifacts/underlag/davids-svar.md läses
fil: _bmad-output/implementation-artifacts/1-2-ratta-och-bekrafta-en-kontaktpunkt-eller-ett-lofte.md läses
prov: crm-commitment-lifecycle nytt GRÖN
prov: crm-rules ändras GRÖN
prov: crm-event-provenance berörs GRÖN
prov: crm-gdpr-replay berörs GRÖN
prov: crm-status-link berörs GRÖN
prov: crm-name-alias berörs GRÖN
prov: crm-sandvag berörs GRÖN
prov: crm-provenance berörs GRÖN
prov: crm-sfar berörs GRÖN
prov: crm-sfar-3 berörs GRÖN
prov: crm-sfar-yta berörs GRÖN
prov: crm-views berörs GRÖN
prov: crm-design-parity berörs GRÖN
prov: crm-thread berörs GRÖN
prov: crm-org-name-norm berörs GRÖN
prov: crm-review-fixes berörs GRÖN
prov: crm-derivations berörs GRÖN
prov: crm-schema berörs GRÖN
prov: crm-today berörs GRÖN
prov: crm-actions-ui berörs GRÖN
prov: crm-stadning berörs GRÖN
prov: entity-links berörs GRÖN
prov: min-sida berörs GRÖN
prov: mcp berörs GRÖN
prov: draft-delete berörs GRÖN
prov: fakturanummer-samtidighet berörs GRÖN
prov: payroll-tax-dublett berörs GRÖN
prov: voucher-links berörs GRÖN
prov: uppdragsytan-utskick berörs GRÖN
prov: uppdragsytan-scopelinje berörs GRÖN
prov: uppdragsytan-beslut berörs GRÖN
prov: uppdragsytan-undantag berörs GRÖN
prov: uppdragsytan-godkannandevag berörs GRÖN
prov: uppdragsytan-baselineorsak berörs GRÖN
prov: vat-declaration berörs GRÖN
prov: kvittobilagor-lagring berörs GRÖN
tjanst: 127.0.0.1:5433 vitest kör provfilerna mot den stående testdatabasen
```

- **Tjänsten** är testdatabasen som kedjan cto kör hela sviten mot. Enligt förteckningen över kedjans förmågo
```

## Utfall
Tester: 191 passed (191) · Granskning: GODKANT | Alla åtta acceptanskriterier är implementerade och prövade genom hela stacken, varje kryssad uppgift finns i koden, och det enda fyndet är LOW. · Byggforsok: 1

## Modellkedja (Davids krav 17/8, reservvag 7/9)

* krav: **claude-opus-5-5**
* utveckling: **claude-opus-5-5**
* granskning: **claude-opus-5-5 (Codex spärrat — Davids regel 12/10; Codex granskar i efterhand)**

Granskaren ar inte forfattaren: claude-opus-5-5 (Codex spärrat — Davids regel 12/10; Codex granskar i efterhand) granskade claude-opus-5-5s arbete.

effort (Davids beslut 20/10): create-story high · validering high · bygg xhigh · granskning xhigh — riskdel crm
Allt pa Davids abonnemang - inga API-tokens.
