# Bygge beslut #116 — Två registerrader höjs från `write` till `sensitive` (`upsert_contract_part`, `update_contract`) och

Datum: 2026-09-06 13:17 · Branch: cto/tv-registerrader-h-js-fr-n-write-till-se-116 · Overlamning: #117

## Mal
Två registerrader höjs från `write` till `sensitive` (`upsert_contract_part`, `update_contract`) och `set_project_status` får `kravManniska: true`, plus ett vaktprov i vitest med tre kontroller och negativ regression — därmed passerar varje tak-/baselineändring och varje avslut en människa.

## Kravspec (claude-fable-5) — sjalvbarande, med KALLA och ARKITEKTUR
```
Jag har läst registret, `execute.ts`, mallprovet `manniskosparr.test.ts`, ARKITEKTUR.md:s registerregler och MCP_ACTIONS.md:s Uppdragsytan-sektion. Allt CTO-underlaget påstår stämmer mot koden: de tre åtgärderna är `write` i dag (registry.ts:1223, 1441, 1459), spärren och kön finns generiskt i execute.ts:52–85, och `andra_baseline` är `sensitive` och delar tjänstefunktion med `upsert_contract_part`. Här är kravspecen:

---

MAL | Ingen väg till baselinen (avtalstak) eller till ett projektavslut som inte passerar en människa: takändringar via `upsert_contract_part`/`update_contract` köas i Att göra, agentinitierat avslut avvisas helt — stänger hålet som gör FR-4 tomt (en agent kan i dag ändra ILT:s och NVR:s avtalstak utan godkännande).
KALLA | Överlämning #117 (story S0.1 ur 1F, våg 2), beslut #108 (Davids ja 2026-09-03), Davids ja på #117 2026-09-06; beroenden S2.1 (`kravManniska`, beslut #115) och S1.3 (`andra_baseline`, beslut #113/114) ligger på main.
ARKITEKTUR | Befintliga mönster, inga nya: registrets `sensitivity: 'sensitive'` ⇒ godkännandekö + audit i samma transaktion (`execute.ts` rad 60–85); `kravManniska`-spärren i `executeAction` (rad 52–58, `ForbiddenError('human_required')`); ett flöde/tre ingångar; vyns generiska `runFormAction`-redirect till approvals vid `pending_approval`.
KRAV-1 | `server/src/actions/registry.ts`: `upsert_contract_part` och `update_contract` byter `sensitivity` från `'write'` till `'sensitive'`; inga andra fältändringar på dem.
KRAV-2 | `server/src/actions/registry.ts`: `set_project_status` får `kravManniska: true`; `sensitivity` förblir `'write'`.
KRAV-3 | Ny testfil `server/test/bakvag.test.ts` (vaktprovet, mall: `manniskosparr.test.ts`) med tre registerkontroller som fäller om: en `foresla_*`-åtgärd finns i registret; `andra_baseline` inte är `sensitive`; `upsert_contract_part` eller `update_contract` inte är `sensitive`.
KRAV-4 | Negativ regression i samma prov: samma kontrollogik körd mot en registerkopia där `upsert_contract_part` sänkts till `'write'` (mocka som i mallen) måste fälla — bevisar att provet fångar en framtida sänkning.
KRAV-5 | Beteendeprov i samma fil: agentanrop (agent-token, REST) mot `upsert_contract_part` ger `pending_approval` med köpost i `action_approvals` och auditrad `action.approval_requested` men INGEN domänskrivning (kö+audit före godkännande är rätt och fälls inte); agentanrop mot `set_project_status` ger 403 `human_required` utan köpost och utan auditrad.
KRAV-6 | Godkännandevägen bevisas i action-lagret (vyn saknar redigeringsformulär för avtalsdelar): mänskligt anrop mot `upsert_contract_part` ger `pending_approval`, godkännandet i kön skriver raden, `get_contract_usage` visar det nya taket.
KRAV-7 | Dokumentation: sensitivity-ändringarna och `kravManniska` på `set_project_status` skrivs in under modulsektionen Uppdragsytan i `docs/MCP_ACTIONS.md`; `docs/STATUS.md` får en sessionsrad.
ACCEPTANS | `npm run build` och `npm test` gröna med faktisk inklistrad utdata; det nya provets fyra kontroller (KRAV-3/4) och beteendeproven (KRAV-5/6) passerar; `assign_contract_part` är oförändrat `write` och tidvägen fungerar som förut; kodytan i `registry.ts` är ~3 rader.
AVGRANSNING | Rör inte `assign_contract_part` (kopplar tidpost, ändrar inget tak); ingen migration, ingen vykod, ingen ny stil; inga nya felkoder eller mappningar i `errorHandler.ts`; ingen sensitivity-ändring på någon annan åtgärd; ingen ny infrastruktur eller beroende.
uteslutet: nytt redigeringsformulär för avtalsdelar i vyn — kallan kraver det inte
uteslutet: `foresla_*`-förslagsåtgärder i registret — kallan kraver det inte
uteslutet: `bakvag.py` hos Hermes — kallan kraver det inte
uteslutet: auditrad vid `human_required`-avvisning — kallan kraver det inte
uteslutet: `kravManniska` på fler åtgärder än `set_project_status` — kallan kraver det inte

---

Två läsnoteringar till utvecklaren som får specen: provet döps `bakvag.test.ts` eftersom överlämningens provnamn är "bakvag" (ADR-6b/ADR-10) men villkoret säger vitest i `server/test/`, inte .py; och KRAV-6 ersätter acceptansraden "formuläret ger en köpost" — Davids svar på beslutsfrågan bekräftar att action-lagret räcker eftersom vyn i dag bara skapar avtalsdelar via `create_contract_from_draft`.
```

## Utfall
Tester: 113 passed (113) · Granskning: GODKANT | Alla sju krav uppfylls med befintliga mönster (tre funktionella rader i registret, vaktprov + beteendeprov genom hela stacken, godkännandevägen människospärrad i båda försvarslinjerna, avgrä · Byggforsok: 1

## Modellkedja (Davids krav 17/8)
Krav+granskning: claude-fable-5 · Utveckling: claude-opus-5 · Claude Code pa Davids abonnemang — inga API-tokens
