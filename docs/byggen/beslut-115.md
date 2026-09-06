# Bygge beslut #115 — Ett sjätte valfritt fält `kravManniska` på ActionDef plus en spärr först i `executeAction` som avvis

Datum: 2026-09-06 12:33 · Branch: cto/ett-sj-tte-valfritt-f-lt-kravmanniska-p-115 · Overlamning: #116

## Mal
Ett sjätte valfritt fält `kravManniska` på ActionDef plus en spärr först i `executeAction` som avvisar agent-anrop med felkod `human_required` innan något skrivs, med vitest via REST-rutten och två dokumentationsrader.

## Kravspec (claude-fable-5) — sjalvbarande, med KALLA och ARKITEKTUR
```
Underlaget är verifierat mot koden: ActionDef har fem fält (`registry.ts:102–108`), avvisningar i lagret kastar `ForbiddenError(kod, svensk text)` utan auditrad (mönstret `contractor_not_permitted`, `execute.ts:25–29`), REST-rutten `/actions/:action` saknar `requireHuman` och testmönstret med agent-token finns i `fiscal-year-derivation.test.ts`. Registret saknar injektionspunkt för teståtgärder — det fångas i KRAV-3. Här är kravspecen:

```
MAL | En åtgärdsdefinition ska kunna kräva en människa: valfritt fält `kravManniska` på ActionDef och en spärr i executeAction som avvisar agent-anrop innan något skrivs. Syftet är en spärr som håller för alla tre transporterna (REST, vyn, MCP — vyn anropar executeAction direkt, MCP går via REST-rutten som saknar requireHuman); set_project_status ska kunna använda fältet i S0.1 (våg 2).
KALLA | Överlämning #116 (vd→sidoprojektet 2026-09-06, story S2.1 ur BMAD 1E ADR-7/1F, 1G GODKÄND 5/9), Davids ja 6/9 12:16 med mandat 3/9 och 5/9; Davids svar på analysfrågan: NEJ — ingen auditrad vid avvisning.
ARKITEKTUR | "Ett flöde, tre ingångar" (ARKITEKTUR.md): allt muterande går genom executeAction, därför sitter spärren där och inte i transportlagret. Felmönstret är befintligt: ForbiddenError(felkod, svensk text) som contractor_not_permitted i execute.ts:25–29 — avvisningar auditloggas inte i dag. actor ('human'|'agent') finns redan i params ur JWT-kontexten; ingen ny behörighetskod.
KRAV-1 | ActionDef (server/src/actions/registry.ts:102–108) får ett sjätte, valfritt fält `kravManniska?: boolean`. Namnet är medvetet INTE requireHuman. Ingen befintlig åtgärd sätter fältet.
KRAV-2 | I executeAction (server/src/actions/execute.ts), FÖRE sensitivity-grenen (rad 52) och före all transaktion: om `action.kravManniska && params.actor !== 'human'` kastas ForbiddenError med felkod 'human_required' och text 'åtgärden kräver en människa'. Ingenting skrivs: ingen godkännandepost, ingen domänskrivning, ingen auditrad.
KRAV-3 | Ny server/test/manniskosparr.test.ts via REST-rutten POST /companies/:id/actions/:action med agent-token (mönstret i test/fiscal-year-derivation.test.ts; agent-token via POST .../agent-tokens). Tre fall: (negativ) teståtgärd med kravManniska + agent-token → 403 med felkod 'human_required' och inget skrivet; (positiv) samma åtgärd som människa → körs; (kontroll) en åtgärd UTAN fältet är opåverkad av actor. Registret saknar testkrok — teståtgärden registreras enbart i testet (t.ex. mock av registry.getAction), ingen produktionsåtgärd sätter fältet. Provet ska räkna KUNDE_INTE (faila) om kontrollfallet inte kört.
KRAV-4 | En mening om fältet i docs/MCP_ACTIONS.md under åtgärdsdefinitionen; en rad i docs/STATUS.md (sessionslogg).
ACCEPTANS | npm run build och npm test gröna med faktisk, inklistrad utdata; alla tre fallen i manniskosparr.test.ts passerar; diffen visar exakt ett fält i registry.ts, ~5 rader i execute.ts, ny testfil och två dokrader — ingenting annat. Granskaren verifierar särskilt kontrollfallet (åtgärd utan fältet opåverkad) och att avvisningen sker före withTenantTransaction.
AVGRANSNING | Rör inte sensitivity-flödet (annan mekanism för annan sak), inte requireHuman (http/middleware/authenticate.ts:41) eller dess fem rutter, ingen migration, ingen befintlig åtgärd får fältet (set_project_status får det i S0.1), ingen ny inloggnings-, token- eller behörighetskod. Minsta möjliga ändring gäller.
uteslutet: auditrad vid avvisad human_required — kallan kraver det inte
uteslutet: requireHuman-middleware pa /actions/:action-rutten — kallan kraver det inte
uteslutet: satta kravManniska pa nagon befintlig atgard — kallan kraver det inte
uteslutet: sammanslagning av kravManniska med sensitivity eller requireHuman — kallan kraver det inte
uteslutet: exponera kravManniska i actionManifest/MCP-verktygslistan — kallan kraver det inte
```

Två avvikelser från överlämningens ordalydelse, båda förankrade: auditfrågan är låst till NEJ per Davids förtydligande 6/9 (överlämningens "enligt husets mönster" och koden pekar åt samma håll — lagret loggar inte avvisningar), och KRAV-3 flaggar att registret saknar testkrok, vilket överlämningen inte nämner men utvecklaren annars hade fastnat på.
```

## Utfall
Tester: 112 passed (112) · Granskning: GODKANT | Diffen uppfyller alla fyra kraven exakt (ett fält i registry.ts, spärren i execute.ts före sensitivity-grenen och före all `withTenantTransaction`, trefallstest via REST med agent-token plus · Byggforsok: 1

## Modellkedja (Davids krav 17/8)
Krav+granskning: claude-fable-5 · Utveckling: claude-opus-5 · Claude Code pa Davids abonnemang — inga API-tokens
