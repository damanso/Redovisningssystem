# Bygge beslut #118 — Migration 0069 (signed_date ⇒ fryst som trigger) plus två engångs-åtgärder: `skapa_uppdrag` (rotdel 

Datum: 2026-09-06 14:05 · Branch: cto/migration-0069-signed-date-fryst-som-tri-118 · Overlamning: #118

## Mal
Migration 0069 (signed_date ⇒ fryst som trigger) plus två engångs-åtgärder: `skapa_uppdrag` (rotdel UPPDRAG) och `importera_leveranskontrakt` (parser i lib/ som lägger strömmar, L1–L6, STYRNING, sex registerrader, scopelinjer och godkännare ur den frysta kontraktstexten — NULL i stället för gissning).

## Kravspec (claude-fable-5) — sjalvbarande, med KALLA och ARKITEKTUR
```
Kravspecen är destillerad ur överlämning #118, Davids svar, migration 0068, `uppdragsytan-sparrar.test.ts`, actions-registret och `services/contracts.ts`. Två verklighetsfynd som bakats in: registrets `AvtalsdelFalt`/`upsertContractPart` finns och återbrukas, och testhjälparen `nyttAvtal` sätter `signed_date` — efter 0069-triggern föds de avtalen frysta, så proven som förutsätter utkast måste justeras (KRAV-8).

---

MAL | Att signera ÄR att frysa (vägen 0068 medvetet stängde öppnas som trigger, inte som ny åtgärdsyta), och NVR-001:s frysta leveranskontrakt kan sås som baseline i två grepp: `skapa_uppdrag` föder avtalet med rotdelen UPPDRAG, `importera_leveranskontrakt` lägger strömmar, L1–L6, STYRNING, register, scopelinjer och godkännare ur kontraktstexten — saknat fält blir NULL, aldrig en gissning.
KALLA | Överlämning #118 (`docs/inkorg/118-...md`); Davids ja + svar 6/9 13:28 (`skapa_uppdrag` förblir write per 1E Del 4); story S1.2 ur 1F, ADR-8, PRD FR-1/FR-9/FR-27; kontraktstexten: Drive `Min enhet/01_Kunder/Nordic Vision Retail/Fas 2/Leveranskontrakt-NVR-001-FRYST-v1-2026-09-03.md` (skickas som indata av Hermes/sessionen); byggjournal beslut #111 (`docs/byggen/beslut-111.md`).
ARKITEKTUR | Mutation via actions-registret (`def` + zod-strict ur `lib/validation.ts`: `UuidSchema`, `safeText`, `IsoDateSchema`, `OreSchema`) → tjänstelagret (`services/contracts.ts`: `createContract`, `upsertContractPart` — inga parallella skrivvägar) → Postgres i `withTenantTransaction` med auditlogg; spärrar som Postgres-triggrar i idempotent numrerad migration (0068-mönstret); pengar i ören-heltal; ren hjälpare utan I/O i `server/src/lib/`; vitest mot riktig Postgres.
KRAV-1 | Migration `0069` (additiv, ingen ny tabell): BEFORE INSERT OR UPDATE-trigger på `contracts` sätter `NEW.kontrakt_tillstand := 'fryst'` när `NEW.signed_date IS NOT NULL`; en UPDATE som nollar `signed_date` på ett fryst kontrakt fälls med RAISE (samma mönster som `vagrar_avfrysning`); `npm run migrate` körbar två gånger.
KRAV-2 | Ny action `skapa_uppdrag` (write, engångs) i `registry.ts`: indata `project_id` (befintligt projekt) + kontraktsnamn + `signed_date` (valfri); delegerar till `createContract` och skapar ALLTID rotdelen `code='UPPDRAG'` (parent NULL); returnerar `contract_id`; med `signed_date` är avtalet fryst från födseln.
KRAV-3 | Ny action `importera_leveranskontrakt` (write, engångs): indata `contract_id` + kontraktstexten som markdown-sträng — åtgärden läser ALDRIG Drive eller filer själv (ADR-4/NFR-1); all skrivning går via `upsertContractPart` och parametriserad SQL i samma transaktion.
KRAV-4 | Ren parser i `lib/` (text → struktur, ingen databas, ingen I/O) över kontraktets kända form: ramen 430 h / 47 300 000 öre; Bilaga 1:s faser som strömmar med start/slut och `date_precision 'manad'`; rubrikerna "L1"–"L6" med cap_hours 40/70/205/40/40/20 under sin ström (ärvt intervall = NULL); STYRNING 15 h; tabellfälten klausul/acceptanskriterium/uppfoljningsmatt/matt_lasvag; del 5:s innanför-/utanför-rader och sju signalfraser med klausul; rapporteringens godkännare 'Styrgruppen' + eskalering 'Eva Larsson'. Fält som inte hittas = NULL — aldrig gissning eller default.
KRAV-5 | Importen skriver: rotdelen UPPDRAG får cap_hours/cap_amount_ore och `valid_from = signed_date`; strömmarna som förälderdelar under UPPDRAG; L1–L6 som delar under sin ström; STYRNING som del under UPPDRAG UTAN registerrad; exakt sex rader `uppdrag_leverabel` (status 'ej_paborjad'); `uppdrag_scopelinje`-raderna; `contracts.godkannare`/`godkannare_eskalering`; varje skapad del bär `change_reason = 'import ur leveranskontraktet v1'`; importen sätter ALDRIG `cap_confirmed` (det gör David, och det kräver fryst kontrakt via 0068:s trigger).
KRAV-6 | Idempotens: en andra import mot samma `contract_id` med samma text ändrar ingenting — delar matchas på `code`, registret bärs av `UNIQUE (contract_id, kod)`.
KRAV-7 | Vitest: fixtur i `server/test/` som kopierar leveranskontraktets struktur; parsertabell av fall inklusive saknat fält → NULL; `skapa_uppdrag` skapar roten; importen ger exakt sex registerrader + UPPDRAG + strömmar + STYRNING utan registerrad; `get_contract_usage` visar roten med 430 h; bekräftat tak i utkast fälls fortfarande (409 `rule_violation`); godkännare fylld; `change_reason` satt; andra importen idempotent; `signed_date` satt → fryst; nollad `signed_date` på fryst → fälls.
KRAV-8 | Uppdatera provet "vad 0068 stänger tills S1.2" i `uppdragsytan-sparrar.test.ts` till nya läget (bekräftat tak på nyskapat SIGNERAT avtal går igenom); OBS: hjälparen `nyttAvtal` sätter i dag `signed_date: '2026-01-01'` — efter 0069 föds de avtalen frysta, så prov som förutsätter utkast (t.ex. `vagrar_baseline_i_utkast`) ska skapa avtal utan `signed_date`.
KRAV-9 | Docs: de två åtgärderna som rader under `## Uppdragsytan` i `docs/MCP_ACTIONS.md` (rad 718); en rad i `docs/STATUS.md`:s sessionslogg. Ingen vy.
ACCEPTANS | `npm run build` och `npm test` gröna med faktisk inklistrad utdata; granskaren verifierar: 0069 innehåller bara triggern (ingen ny tabell/backfill), båda åtgärderna är `write` och delegerar till befintliga tjänster, parsern ligger i `lib/` utan I/O och utan gissningsdefaults, importens sex registerrader + NULL-beteende + idempotens är bevisade i test, `cap_confirmed` rörs aldrig av importen, spärrproven speglar nya läget.
AVGRANSNING | Ingen vy (Epic 10), ingen bedömning, inga signaler, inget svep, ingen Drive-läsning i redovisningen, ingen sensitivity-ändring på någon befintlig åtgärd, `assign_contract_part` orörd, ingen ny tabell, inga nya beroenden, `.env` orörd.
uteslutet: egen frys-åtgärd i registret — kallan kraver det inte
uteslutet: sensitive-nivå på skapa_uppdrag — kallan kraver det inte
uteslutet: registerrad i uppdrag_leverabel för STYRNING — kallan kraver det inte
uteslutet: gissade/föreslagna värden i parsern vid avvikande kontraktstext — kallan kraver det inte
uteslutet: uppdrag_referens-pekare till kontraktsfilen i Drive — kallan kraver det inte
uteslutet: att importen sätter cap_confirmed på roten — kallan kraver det inte

---

En notering utanför specen: jag försökte hämta det frysta leveranskontraktet ur Drive för att verifiera parserns kända form mot originaltexten, men Drive-anslutningen saknar behörighet i den här sessionen (godkänns i claude.ai-anslutningsinställningarna). Specens värden kommer därför ur överlämning #118 och vault-pekaren `01-Projekt/NVR-001/leveranskontrakt.md`; fixturen i KRAV-7 bör byggas från den faktiska kontraktstexten när Hermes/sessionen skickar in den.
```

## Utfall
Tester: 114 passed (114) · Granskning: GODKANT | Migration 0069 är exakt triggern (idempotent, RAISE vid nollat datum), båda åtgärderna är write och delegerar till createContract/upsertContractPart utan parallell skrivväg, parsern är ren i · Byggforsok: 1

## Modellkedja (Davids krav 17/8)
Krav+granskning: claude-fable-5 · Utveckling: claude-opus-5 · Claude Code pa Davids abonnemang — inga API-tokens
