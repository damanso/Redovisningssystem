# Bygge beslut #106 — Villkoret `contract_part_required` i `updateTimeEntry` flyttas så det bara prövas när målstatus är g

Datum: 2026-09-02 21:23 · Branch: cto/villkoret-contract-part-required-i-updat-106 · Overlamning: #99

## Mal
Villkoret `contract_part_required` i `updateTimeEntry` flyttas så det bara prövas när målstatus är godkand/justerad, plus samma regel i vyn /tid/forslag och fyra tester.

## Kravspec (claude-fable-5) — sjalvbarande, med KALLA och ARKITEKTUR
```
Jag har grävt klart — villkoret sitter i `updateTimeEntry` (projects.ts:501–503, felkastet i `avtalsdelForTidpost`:299–304), och både MCP-anropen och vyns Ignorera-knapp (`/tid/forslag/rad` → `approve_time_entries` → `updateTimeEntry`) går genom samma kodväg, så rättelsen bär i tjänstelagret. Här är kravspecen:

```
MAL | Ett tidsförslag utan avtalsdel på ett uppdrag med aktiva avtalsdelar kan ignoreras och textredigeras utan att först klassas — avtalsdelskravet prövas enbart när tiden blir debiterbar (målstatus 'godkand'/'justerad'). Syfte: godkännandekön i /tid/forslag får aldrig låsa sig på skräpförslag (0-minuters mailmarkeringar), samtidigt som oklassad tid aldrig kan bli fakturerbar.
KALLA | Överlämning #99 (rättelse 7b, LOC-384) + Davids ja 2/9 ("avtalsdelskravet prövas enbart vid övergång till godkand/justerad; ignorera och textändring går alltid", delegering 1/9); PRD F5 och beslut #104 ("Ignorera går alltid"); driftfelet reproducerat 2/9 21:05 UTC.
ARKITEKTUR | Ett flöde, tre ingångar: regeln ändras ENBART i tjänstelagret — `updateTimeEntry` i `server/src/services/projects.ts` (villkoret rad 501–503). `approve_time_entries` (timeProposals.ts:384–394) och vyns /tid/forslag (routes.ts:2719–2767) går redan genom den, så en fix täcker MCP, REST och vyn. Oförändrat: `buildAllowlistedUpdate`, `withTenantTransaction`, audit i samma transaktion, zod-strict-scheman, tester i vitest mot riktig Postgres.
KRAV-1 | `updateTimeEntry` kastar 400 `contract_part_required` ENDAST när målstatus (`input.status ?? rad.status`) är 'godkand' eller 'justerad', posten saknar avtalsdel (varken på raden eller i indata) och uppdraget har aktiva avtalsdelar. En MEDSKICKAD `contract_part_id` valideras alltid mot uppdraget via `avtalsdelForTidpost`, oavsett status.
KRAV-2 | Övergång till 'ignorerad' (via `update_time_entry` och `approve_time_entries`) kräver aldrig avtalsdel; kravet på `adjustment_reason` kvarstår oförändrat.
KRAV-3 | Ändring av `description`/`work_date`/`minutes`/länkar på en post i status 'forslag' eller 'ignorerad' kräver aldrig avtalsdel; att SÄTTA `contract_part_id` är alltid tillåtet.
KRAV-4 | I vyn /tid/forslag går knappen "Faktureras ej" igenom utan vald avtalsdel (med orsak ifylld); "Godkänn" utan avtalsdel ger som idag felnotisen med tjänstens befintliga text ("uppdraget har avtalsdelar — ange contract_part_id …").
KRAV-5 | Fyra tester i `tidsforslag.test.ts`/`avtalsdelar.test.ts`, alla på förslag utan avtalsdel på uppdrag med aktiva delar: (a) ignorera → ok; (b) ändra description → ok; (c) godkänna utan avtalsdel → 400 `contract_part_required`; (d) godkänna med `contract_part_id` i samma anrop → ok.
KRAV-6 | `docs/MCP_ACTIONS.md` beskriver för `update_time_entry`/`approve_time_entries` när `contract_part_required` kastas; sessionsloggen i `docs/STATUS.md` uppdateras.
ACCEPTANS | `npm test` och `npm run build` gröna med inklistrad utdata; reprofallet ur överlämning #99 (ignorera resp. description-ändring på oklassat förslag → tidigare 400) går igenom; övergång till 'godkand'/'justerad' utan avtalsdel ger fortfarande 400 — lättnaden får aldrig göra oklassad tid debiterbar (riskhanteringen i CTO-underlaget).
AVGRANSNING | Minsta möjliga ändring: ~10 rader kring villkoret i `updateTimeEntry` + tester + två docfiler. Ingen migration, inga schemaändringar, inga nya/ändrade action-scheman, ingen ändring av `TILLATNA_BYTEN`, `createTimeEntry` (kravet vid registrering kvarstår), takvarningslogiken eller batchens allt-eller-inget.
uteslutet: required-markering eller omgjord avtalsdelsväljare i vyns förslagskort — källan kräver det inte
uteslutet: script/åtgärd som retroaktivt rättar redan fastnade poster i drift — källan kräver det inte
uteslutet: ny feltext eller ny felkod utöver befintliga `contract_part_required` — källan kräver det inte
uteslutet: särskild regel för av-ignorering (ignorerad → forslag) — källan kräver det inte (målstatusregeln i KRAV-1 täcker den)
```

En läsanmärkning från grävandet, utanför specen: vyns avtalsdelsväljare i förslagskortet (`delval`, routes.ts:2592) har redan ingen `required`-markering, så KRAV-4 faller ut ur tjänstefixen utan egen vykodändring — CTO-underlagets pekare "~2232" avser snabbformulärets väljare, som inte berörs.
```

## Utfall
Tester: 106 passed (106) · Granskning: GODKANT | Villkoret prövas exakt mot målstatus (`input.status ?? rad.status`) via befintliga `arGodkannande`, medskickad del valideras alltid, `del ?? undefined` skriver aldrig över radens klassning,  · Byggforsok: 1

## Modellkedja (Davids krav 17/8)
Krav+granskning: claude-fable-5 · Utveckling: claude-opus-5 · Claude Code pa Davids abonnemang — inga API-tokens
