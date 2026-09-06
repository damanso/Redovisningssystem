# Bygge beslut #128 — En sensitive-action `binda_kostnad` (kräver `contract_part_id`, köas via `createApproval` idempotent

Datum: 2026-09-06 20:41 · Branch: cto/en-sensitive-action-binda-kostnad-kr-ver-128 · Overlamning: #128

## Mal
En sensitive-action `binda_kostnad` (kräver `contract_part_id`, köas via `createApproval` idempotent per kvitto när svepets `kostnadsforslag:` finns) plus svepets automatbindning av förslagslösa kvitton till ström-per-datum, annars rotdelen `UPPDRAG` — bara när fältet är NULL, aldrig till löv, med auditrad `bindning: automatisk` och oplanerad-märkning.

## Kravspec (claude-fable-5) — sjalvbarande, med KALLA och ARKITEKTUR
```
MAL | Varje kostnad som hör till uppdraget får en avtalsdel utan ett femte återkommande handgrepp: svepets kostnadsförslag med löv köas till mänskligt godkännande (`binda_kostnad`), förslag utan löv automatbinds omdömesfritt till ström/rot, och kvitton utan kostnadsförslag (allmänna bolagskostnader) rörs aldrig.
KALLA | Överlämning #128 (vd 2026-09-06, story S6.1 ur 1F, PRD FR-33) + Davids ja 6/9 och NEJ på analysfrågan (förtydligat 20:02: automatiken avgränsas till kvitton med `kostnadsforslag:` i `uppdrag_svepvarde`); mandat 3/9 och 5/9, 1G GODKÄND.
ARKITEKTUR | Befintliga mönster: mutation via `executeAction` → `ACTIONS`-registret → tjänstelagret i `withTenantTransaction`; `sensitive` går genom godkännandekön (`createApproval`, `services/approvals.ts`); köning + audit i samma transaktion som i `avgorSignal` (`uppdragSignal.ts:242`); bindnings-UPDATE + audit som `assignContractPart` (`contracts.ts:773`); zod-strict ur `lib/validation.ts`; 0068:s triggrar/FK på `receipts.contract_part_id`; JS-fri serverrenderad vy; vitest mot riktig Postgres.
KRAV-1 | Ny action `binda_kostnad` i `actions/registry.ts`: `sensitivity: 'sensitive'`, strict indata `{ receipt_id: UuidSchema, contract_part_id: UuidSchema }` — `contract_part_id` obligatoriskt (kvitton har inget `project_id`; delen är enda bindningen); dokumenteras under Uppdragsytan i `docs/MCP_ACTIONS.md`.
KRAV-2 | Handlern är en tjänstefunktion (mönster `assignContractPart`): läser kvittot `FOR UPDATE`, fäller okänt kvitto/okänd del med NotFound, sätter `receipts.contract_part_id` parametriserat (flytt tillåten — även automatiskt bunden kostnad → löv, det är kravet "flyttbar via kön"), auditloggar från/till i samma transaktion; 0068:s `receipts_vagrar_avslutat` står kvar som spärr.
KRAV-3 | `korUppdragssvep`/`svepEttUppdrag` får ett bindningssteg efter förslagshärledningen, i samma transaktion, som verkar ENBART på körningens `kostnadsforslag:`-värden — kvitton utan kostnadsförslag lämnas obundna.
KRAV-4 | Gren 1 (förslaget bär `leverabel_kod` med befintlig lövdel — senaste aktiva `contract_parts`-versionen av koden, samma versionsregel som `bindningsmal`): svepet köar `createApproval('binda_kostnad', { receipt_id, contract_part_id: lövet })` + auditrad `action.approval_requested` (mönstret i `avgorSignal`), idempotent per kvitto — ingen ny köpost när en pending `binda_kostnad` för samma `receipt_id` finns; kvittot skrivs inte.
KRAV-5 | Gren 2 (förslaget saknar `leverabel_kod`/lövdel — inget löv kan föreslås): svepet sätter `receipts.contract_part_id` till strömmen vars intervall täcker kvittodatumet, annars rotdelen `UPPDRAG`, och `oplanerad = true` — bara `WHERE contract_part_id IS NULL`, aldrig en flytt, ingen köpost, auditrad med `bindning: automatisk`.
KRAV-6 | Automatbindningen kan aldrig sätta ett löv: en vakt i bindningssteget fäller varje automatmål som inte är rotdelen eller en ström direkt under den — vitest-motsvarigheten till `bakvag.py`:s fjärde kontroll.
KRAV-7 | Kvittolistan `/app/c/:companyId/receipts` (`view/routes.ts:6777`) visar oplanerad-märkning på märkta kvitton med befintliga komponentklasser/tokens ur `html.ts` — JS-fritt, ingen ny stil, ingen ny yta.
KRAV-8 | Nya vitest-filer i `server/test/` genom hela stacken: sensitive-flödet (inget skrivs före godkännande, efter godkännande är delen satt + audit), avvisad indata utan `contract_part_id`, gren 1-köning + idempotens vid dubbelsvep, gren 2 (ström per datum, rot som reserv, bara-NULL, `oplanerad`, auditraden, ingen köpost), lövvakten, samt att kvitton utan förslag står obundna efter svep.
KRAV-9 | `npm run build` och `npm test` gröna med inklistrad utdata; `docs/STATUS.md` får sin sessionsrad.
ACCEPTANS | Granskaren kör `npm test` + `npm run build` och prickar av KRAV-8:s beteenden mot faktisk testutdata; `handgrepp.py`-räkningen (fortsatt fyra) och `bakvag.py` prövas av Hermes-sessionen utanför repot — repots bevis är vitest-sviten och auditraderna.
AVGRANSNING | Ingen ny migration (0068 bär kolumnerna/triggrarna), inget nytt beroende, ingen scheduler, ingen sensitivity-ändring på andra åtgärder, inga belopp lagrade i modulen, inga .py-prov i repot; `obundnaKvitton`/`bindningsmal`/förslagshärledningen i S7.3 ändras inte utöver bindningsstegets anrop.
uteslutet: automatbindning av kvitton utan kostnadsförslag (allmänna bolagskostnader) — kallan kraver det inte
uteslutet: köpost för förslagslösa kvitton (köa-allt-alternativet) — kallan kraver det inte
uteslutet: att `binda_kostnad` sätter eller nollställer `oplanerad` — kallan kraver det inte
uteslutet: avbindning (`contract_part_id` → NULL) via `binda_kostnad` — kallan kraver det inte
uteslutet: egen vy/subnav-yta för bindningskön utöver Att göra — kallan kraver det inte
uteslutet: notifiering/eskalering när en bindning köas — kallan kraver det inte
```

## Utfall
Tester: 125 passed (125) · Granskning: GODKANT | Bygget följer kravspecen punkt för punkt (sensitive `binda_kostnad`, grenarna, idempotensen, lövvakten i skrivvägen, bara-NULL-spärren, chip-märkningen) med husets etablerade mönster (`assig · Byggforsok: 2

## Modellkedja (Davids krav 17/8)
Krav+granskning: claude-fable-5 · Utveckling: claude-opus-5 · Claude Code pa Davids abonnemang — inga API-tokens
