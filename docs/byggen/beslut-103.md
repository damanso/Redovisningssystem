# Bygge beslut #103 — Snabbformulär och redigeringssida för tidposter i webbvyn (under tio sekunder, naturlig tidsinmatnin

Datum: 2026-09-02 11:06 · Branch: cto/snabbformul-r-och-redigeringssida-f-r-ti-103 · Overlamning: #96

## Mal
Snabbformulär och redigeringssida för tidposter i webbvyn (under tio sekunder, naturlig tidsinmatning via ny parser i lib/), plus underlag som https-länkar i ny tabell time_entry_links med attach/remove-actions.

## Kravspec (claude-fable-5) — sjalvbarande, med KALLA och ARKITEKTUR
```
Klart — jag har grävt igenom ARKITEKTUR.md, registry.ts (log_time/update_time_entry/list_time_entries finns, inget duration-fält ännu), services/projects.ts (takvarning + 409-lås finns), view/routes.ts (tid-sidan, executeAction-mönstret, auditläsningen) och RLS-mönstret i migration 0047. Kravspecen:

```
MAL | Tidposter kan registreras på under tio sekunder, redigeras fullt ut och förses med underlag som https-länkar — helt i webbvyn, så att vyn blir en fullständig reserv för rättelser utan AI (PRD §4 F1, §7 acceptans, §9.5).
KALLA | Överlämning #96; Davids ja 1/9 (parserregeln <10 = timmar, ≥10 = minuter godkänd med villkor: svaret visar tolkad tid i hh:mm, formuläret skriver ut regeln som hjälptext, migration 0065); rådslagets beslut 1/9 (underlag som länkar, aldrig filkopior — ILT §6).
ARKITEKTUR | Ett flöde, tre ingångar: vyns formulär kör executeAction med actor human (som kvittoflödet, view/routes.ts:4568); actions i registry.ts med zod .strict() ur lib/validation.ts; tjänstelogik i services/ inuti withTenantTransaction; RLS-mönstret ur 0047 (ENABLE+FORCE, app_has_company_access, komposit-FK, GRANT till app); tester med vitest mot riktig Postgres. Inga nya beroenden, ingen ny stil.
KRAV-1 | Parser i server/src/lib/ (ren funktion, exporterad): '1h'→60, '1,5' och '1.5'→90, '90m'→90, '45'→45, '1h30'→90, '1:30'→90; tal utan enhet <10 tolkas som timmar, ≥10 som minuter; resultatet måste bli heltal minuter; allt ogiltigt ger fel som blir 400 invalid_duration med exemplen i feltexten. Tabelltest över samtliga fall.
KRAV-2 | log_time och update_time_entry får valfritt fält duration (text) som alternativ till minutes — exakt ett av dem, annars 400; SAMMA parser för vy och AI-väg (inga parallella vägar, lärdom 5); svaret innehåller tolkad tid i hh:mm.
KRAV-3 | Migration 0065: tabell time_entry_links (id, company_id, time_entry_id, url text NOT NULL, label, created_by, created_at) med komposit-FK (time_entry_id, company_id) → time_entries och RLS + GRANT exakt enligt 0047-mönstret; idempotent i migrationskedjan.
KRAV-4 | Actions attach_time_entry_link och remove_time_entry_link (sensitivity write): url måste börja med https:// (400), tillåts bara på icke-fakturerad post (409), auditloggas i samma transaktion; list_time_entries-svaret inkluderar posternas länkar.
KRAV-5 | Snabbformulär överst på /app/c/:id/tid och på projektsidan: projekt (förvalt på projektsidan), avtalsdel (select ur projektets delar, obligatorisk när aktiva delar finns), tid (textfält), beskrivning, datum (default idag) — en rad, en knapp; hjälptext vid tidsfältet: "1,5 = 1 h 30 min · 45 = 45 min · 90m · 1h30"; svaret visar tolkad tid i hh:mm och takvarningen (warning ur createTimeEntry) som meddelande — ingen spärr.
KRAV-6 | Redigeringssida /app/c/:id/tid/:entryId via update_time_entry: datum, tid (parser), debiterbar tid, beskrivning, avtalsdel, status (endast tillåtna övergångar i select), justeringsorsak; fakturerad post renderas låst med tydlig 409-text.
KRAV-7 | Historik under redigeringsformuläret: auditloggens rader för posten (samma läsning som /audit-sidan, view/routes.ts:5199) — vem, vad, när (F7).
KRAV-8 | Länkar i vyn: på redigeringssidan fält för url + etikett (attach) och lista med klickbara länkar med ta bort-knapp (remove); på fakturerad post visas listan utan formulär.
KRAV-9 | docs/MCP_ACTIONS.md uppdaterad med nya/ändrade actions; STATUS.md-sessionslogg. Tester: parsertabellen, formuläret skapar post med rätt status/avtalsdel, redigering av icke-fakturerad post, 409 på fakturerad, länk läggs till/tas bort inkl. tenant-isolering, takvarningen renderas.
ACCEPTANS | npm test och npm run build gröna med inklistrad utdata; i vyn: '45' registrerar och svaret visar 00:45, '1,5' visar 01:30, '7' ger 400 med exempel — nej vänta, '7' är giltigt (7 h, 07:00); ogiltig text ger 400 med exemplen; fakturerad post låst; länk syns i list_time_entries; CSP script-src 'none' oförändrad.
AVGRANSNING | Rör inte faktureringsflödet, files/validateUpload/multer, befintliga statusövergångar och 409-lås i services/projects.ts (återanvänds orörda), designkontraktet eller stacklistan — minsta möjliga ändring.
uteslutet: filuppladdning av underlag via files/multer — källan kräver det inte
uteslutet: redigering av befintlig länk (bara attach/remove) — källan kräver det inte
uteslutet: spärr vid taköverskridande vid registrering — källan kräver det inte
uteslutet: extraktion ur avtal (story 6) — källan kräver det inte
uteslutet: kalender/mail-förslag och godkännandekö (story 7–8) — källan kräver det inte
uteslutet: flera personer (story 9) — källan kräver det inte
uteslutet: länkar i snabbformuläret (endast redigeringssidan) — källan kräver det inte
```

En anmärkning: i ACCEPTANS-raden lät jag rättelsen stå kvar med flit — "7" är giltig indata (7 timmar, 07:00) enligt den godkända regeln; om du vill ha raden renskriven byter du den mot "…'7' visar 07:00; ogiltig text ger 400 med exemplen…". Specen håller sig inom ARKITEKTUR.md (inga nya beroenden, executeAction-vägen, RLS-mönstret från 0047) och totalen är 20 rader.
```

## Utfall
Tester: 104 passed (104) · Granskning: GODKANT | Alla nio krav är uppfyllda enligt spec (parsern med exakt tabellen och heltalsaritmetik, samma parser för vy och AI-väg via tjänstelagret, migration 0065 exakt enligt 0047-mönstret inkl. vil · Byggforsok: 3

## Modellkedja (Davids krav 17/8)
Krav+granskning: claude-fable-5 · Utveckling: claude-opus-5 · Claude Code pa Davids abonnemang — inga API-tokens
