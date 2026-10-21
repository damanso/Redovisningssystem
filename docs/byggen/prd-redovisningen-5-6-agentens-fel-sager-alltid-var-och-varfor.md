# PRD-bygget redovisningen 5-6-agentens-fel-sager-alltid-var-och-varfor — PRD redovisningen 5-6-agentens-fel-sager-alltid-var-och-varfor: # Story 5.6: Agentens fel säger allt

Datum: 2026-10-21 10:56 · Branch: cto/prd-redovisningen-5-6-agentens-fel-sager-alltid-var-och-varf-9255 · Kalla: 02-Områden/hermes/prd/redovisningen-1c-prd.md (fryst 29/9, Davids beslut #194)

## Mal
PRD redovisningen 5-6-agentens-fel-sager-alltid-var-och-varfor: # Story 5.6: Agentens fel säger alltid var och varför Status: ready-for-dev <!-- Note: Validation is optional. Run valid

## PRD-kravet (ordagrant ur den frysta PRD:n) och astras kodgranskning
```
# Story 5.6: Agentens fel säger alltid var och varför

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

Som David,
vill jag att agenten alltid får ett begripligt fel inom en minut när kärnan inte kan nås, vad som än går fel på vägen,
så att chatten aldrig hänger och jag får veta vad jag ska göra.

**Kodbas:** redovisning. **Krav:** FR-28 (hela lydelsen). **Arkitektur:** AD-11 (MCP-klientens hela anrop omfattas av samma felomslag). **Beror på:** inga. Bygget behöver inget svar från David.

**Läget i dag, i tre meningar** (läst 2026-10-21 i kopian av main):
- MCP-servern `server/src/mcp/server.ts` (237 rader, sha256 fbc79e6be153…) har en hård timeout, `TIMEOUT_MS = 60_000` på rad 124, och funktionen `hamta` (rad 126–138) ger ett eget meddelande bara när `fetch` självt avbryts av tidsgränsen; ett anslutningsfel (till exempel vägrad anslutning) kastas vidare som det är, utan adress och utan hänvisning till self_check.
- Svarskroppen läses i `api` (rad 140–149) med `res.text()` **utanför** `hamta` och dess `try`, så en kropp som stannar mitt i eller ett avbrott under läsningen ger ett rått fel, och verktygshanterarens fångst (rad 220–222) skriver bara «Kunde inte nå kärnan: {meddelande}» utan adress.
- Bygget lägger hela utgående anropet, alltså anslutningen och läsningen av kroppen, i en ny funktion `anropaKarnan` i en ny modul `server/src/mcp/karnanrop.ts` under en och samma tidsgräns och i ett och samma `try`, med en enda konstruktör för felet (`karnfel`); `hamta` i `server/src/mcp/server.ts` blir en enda rad som lämnar över till den. HTTP-fel med kropp (400, 409) är inga nätverksfel och återges som i dag.

## Förkrav

```förkrav
fil: server/src/mcp/karnanrop.ts ny
fil: server/src/mcp/server.ts ändras
fil: server/test/mcp-felomslag.test.ts ny
fil: docs/MCP_ACTIONS.md ändras
fil: docs/STATUS.md ändras
fil: server/test/mcp.test.ts läses
fil: server/test/mcp-lifecycle.test.ts läses
fil: server/test/utskickHelper.ts läses
fil: server/test/uppdragsytan-utskick.test.ts läses
fil: server/test/env.ts läses
fil: server/test/setup.ts läses
fil: server/test/globalSetup.ts läses
fil: server/vitest.config.ts läses
fil: server/tsconfig.json läses
fil: server/tsconfig.test.json läses
fil: server/package.json läses
fil: package.json läses
fil: scripts/mcp-install.mjs läses
fil: scripts/mcp-token.mjs läses
fil: scripts/mcp-config.mjs läses
fil: server/src/config.ts läses
fil: docs/KOM_IGANG.md läses
fil: docs/ACCEPTANS.md läses
fil: CLAUDE.md läses
fil: docs/ARKITEKTUR.md läses
fil: docs/project-context.md läses
fil: _bmad-output/planning-artifacts/epics.md läses
fil: _bmad-output/planning-artifacts/prd.md läses
fil: _bmad-output/planning-artifacts/architecture.md läses
fil: _bmad-output/planning-artifacts/ux-design-specification.md läses
fil: _bmad-output/planning-artifacts/parallelization-analysis.md läses
fil: _bmad-output/planning-artifacts/implementation-readiness-report-2026-10-13.md läses
fil: _bmad-output/planning-artifacts/underlag/kodgranskning.md läses
fil: _bmad-output/planning-artifacts/underlag/davids-svar.md läses
fil: _bmad-output/planning-artifacts/underlag/kedjans-formagor.md läses
fil: _bmad-output/implementation-artifacts/sprint-status.yaml läses
fil: _bmad-output/implementation-artifacts/5-6-agentens-fel-sager-alltid-var-och-varfor.lardomar.md läses
fil: _bmad-output/implementation-artifacts/5-4-varje-tabell-bevisas-ha-rls-med-force.md läses
fil: _bmad/bmm/workflows/4-implementation/create-story/checklist.md läses
fil: hermes/skills/cto_utveckling.py läses
fil: hermes/skills/bmad_story.py läses
prov: mcp-felomslag nytt GRÖN
prov: mcp berörs GRÖN
prov: mcp-lifecycle berörs GRÖN
prov: uppdragsytan-utskick berörs GRÖN
prov: continuityvakt berörs KUNDE_INTE
prov: beslutsslutet berörs RÖD
prov: startsida_prov berörs KUNDE_INTE
prov: modulprov berörs KUNDE_INTE
prov: adresskontraktet berörs RÖD
beroende: vitest
beroende: tsx
beroende: @modelcontextprotocol/sdk
beroende: node:http
beroende: node:child_process
beroende: node:events
beroende: node:net
beroende: node:crypto
beroende: node:path
beroende: node:url
beroende: node:fs
tjanst: 127.0.0.1:5433 vitest återskapar testdatabasen ur mallen före varje testfil; fallen i mcp-felomslag läser den inte men körs i samma svit
kontrakt: redovisningen funktion anropaKarnan nytt mcp-felomslag
kontrakt: redovisningen funktion karnfel nytt mcp-felomslag
kontrakt: redovisningen funktion KarnanNasInte nytt mcp-felomslag
kontrakt: redovisningen funktion hamta prov mcp
kontrakt: redovisningen fil server/src/mcp/server.ts prov mcp-felomslag
kontrakt: redovisningen funktion selfCheck prov mcp
kontrakt: redovisningen funktion utgangsbrister prov uppdragsytan-utskick
kontrakt: redovisningen funktion paketbrister prov uppdragsytan-utskick
kontrakt: redovisningen rutt GET /api/companies/:companyId/actions prov mcp-felomslag
kontrakt: redovisningen rutt POST /api/companies/:companyId/actions/:action prov mcp-felomslag
kontrakt: redovisningen rutt GET /health prov mcp
kommando: git status --porcelain -- server/src/mcp/karnanrop.ts server/src/mcp/server.ts server/test/mcp-felomslag.test.ts docs/MCP_ACTIONS.md docs/STATUS.md
kommando: npm run typecheck
kommando: npm run build
kommando: npm test
kommando: npm run test -w server -- test/mcp-felomslag.test.ts
kommando: npm run test -w server -- test/uppdragsytan-utskick.test.ts
kommando: npm run test -w server -- test/mcp.test.ts test/mcp-lifecycle.test.ts
```

## Acceptance Criteria

Kriterierna står ordagrant som i `_bmad-output/planning-artifacts/epics.md` (Story 5.6, rad 1564–1584). Raderna *Mätbart (berättelsen)* säger hur kriteriet uppfylls och visas: mekanismen som gör det sant genom konstruktion och den ändliga listan av fall som proven prövar. Ingen rad ändrar ett kriteriums innebörd. Alla nya fall står i den nya filen `server/test/mcp-felomslag.test.ts`, och varje fall har sitt id först i titeln: P0–P6 (felets form, ren funktion), F1–F6 (hela anropet mot en stubbe på riktigt nätverk i testprocessen), E0 (källtexten i MCP-serverns fil) och E1–E3 (MCP-servern som barnprocess över stdio). Väntade utfall står i Dev Notes → Fallistor. Radnummer gäller filerna **före bygget** (sha256 i Dev Notes); ankaret är funktionens namn eller fallets titel.

1. **Given** MCP-servern mot en adress där ingen lyssnar (anslutning vägras)
   **When** ett verktyg som `create_receipt` anropas
   **Then** felet kommer omedelbart och lyder "Kunde inte nå kärnan på {adress}: {orsak} — kör self_check"

   *Mätbart (berättelsen):*
   - **Mekanismen är en enda väg ut och en enda konstruktör.** Varje utgående anrop från MCP-servern går genom `hamta` i `server/src/mcp/server.ts`, som är det enda stället i filen där `fetch` står; `hamta` lämnar över till `anropaKarnan` i `server/src/mcp/karnanrop.ts` och returnerar ett färdigläst svar (`Karnsvar`: `status`, `ok`, `text`), aldrig ett `Response`. Alla fel inne i `anropaKarnan` fångas av ett enda `catch` och blir `karnfel(url, …)`, som är den enda platsen där texten «Kunde inte nå kärnan på …» byggs. Verktygshanterarens `catch` i `server/src/mcp/server.ts` lämnar ett `KarnanNasInte` vidare med dess `message` oförändrat och gör varje annat fel till `karnfel(API_URL, …)`, så ingen text med annan form kan nå agenten från den grenen.
   - **{adress}** är hela adressen anropet gick till (bas plus sökväg), alltså den adress som föll. **{orsak}** kommer ur en sluten avbildning i `karnfel` (Dev Notes → Orsaken): tidsgränsen, felets `cause.code` med `cause.message`, felets eget meddelande eller felets namn, och aldrig en tom text.
   - **«Omedelbart»** prövas som under 5 sekunder, med en tidsgräns i anropet som är längre än så, så att utfallet inte kan vara tidsgränsen.
   - **Fallistan:** P1–P6 (formen och orsaken för varje gren i avbildningen), F1 (vägrad anslutning mot en port som just stängts, orsaken bär `ECONNREFUSED`, under 5 s), E0 (den enda vägen ut: ordet `fetch` står exak
```

## Utfall
Tester: 171 passed (171) · Granskning: GODKANT | Alla fem acceptanskriterier är implementerade och provade i `server/test/mcp-felomslag.test.ts`, alla kryssade uppgifter finns i koden, File List stämmer med diffen, och bara tre LOW-fynd åt · Byggforsok: 1

## Modellkedja (Davids krav 17/8, reservvag 7/9)

* krav: **claude-opus-5-5**
* utveckling: **claude-opus-5-5**
* granskning: **claude-opus-5-5 (Codex spärrat — Davids regel 12/10; Codex granskar i efterhand)**

Granskaren ar inte forfattaren: claude-opus-5-5 (Codex spärrat — Davids regel 12/10; Codex granskar i efterhand) granskade claude-opus-5-5s arbete.

effort (Davids beslut 20/10): create-story high · validering high · bygg xhigh · granskning xhigh — riskdel redovisningen
Allt pa Davids abonnemang - inga API-tokens.
