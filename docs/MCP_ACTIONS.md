# AI-först-gränssnittet — action-/MCP-lagret (Fas 3)

Kärnan exponeras genom ett **transport-agnostiskt action-lager** (`server/src/actions/`).
Samma register driver både HTTP-API:t och en (framtida) MCP-server/connector — en
MCP-server är en tunn transport ovanpå exakt samma actions och regler.

## Actions

Varje action (`server/src/actions/registry.ts`) har namn, titel, strikt
zod-schema och en känslighetsnivå:

| Nivå | Betydelse | Körning |
|---|---|---|
| `read` | ingen mutation (listor, momsrapport) | direkt |
| `write` | skapar utkast/register, ej pengaflyttande (skapa kund/faktura/kvitto) | direkt |
| `sensitive` | pengaflyttande eller periodlåsande (bokför faktura/kvitto/verifikat, rättelse, periodlås) | **kräver mänskligt godkännande** |

Alla actions kör mot kärnans tjänster med samma serverpåtvingade regler: tenant
härleds från medlemskap (RLS), verifikat är oföränderliga, allt auditloggas.

## HTTP (och MCP-mappning)

| MCP-koncept | HTTP-endpoint |
|---|---|
| lista verktyg (`tools/list`) | `GET /api/companies/:companyId/actions` (manifest) |
| anropa verktyg (`tools/call`) | `POST /api/companies/:companyId/actions/:action` |
| godkännandekö | `GET /api/companies/:companyId/approvals` |
| godkänn / avslå | `POST .../approvals/:id/approve` \| `.../reject` |
| AI-OCR (förslag) | `POST .../ocr/receipt` |

En MCP-server ansluter med ett **agent-token** (se nedan) och mappar
`tools/list` → manifestet och `tools/call` → action-anropet. Känsliga verktyg
returnerar `202 pending_approval` — de körs aldrig förrän en människa godkänt.

## Förtroendegräns: människa vs agent

- **Agent-token** (`actor: 'agent'`) mintas av en ägare
  (`POST /api/companies/:companyId/agent-tokens`), är låst till ett bolag och
  kan begära actions men **aldrig godkänna** — inte ens sina egna.
- **Människo-token** (vanlig inloggning) godkänner känsliga operationer.

Detta är människa-i-loopen: en AI (Cowork/Hermes) kan föreslå och begära, men en
människa måste godkänna allt som flyttar pengar eller låser en period.

## Prompt-injection-skydd (plan §4)

All auktoritet kommer från `companyId` + `userId` (förtroendegränsen) — **aldrig**
från indata eller dokumentinnehåll. Konkret:

1. Action-indata schemavalideras strikt (`.strict()`), så ett kvitto/mejl kan inte
   "be" systemet köra en annan action eller höja behörighet.
2. AI-OCR (`server/src/services/aiOcr.ts`) behandlar dokumenttext som **data**:
   systemprompten säger åt modellen att ignorera instruktioner i dokumentet, och
   svaret parsas genom ett strikt schema som kastar bort okända fält
   (`auto_approve`, `action`, `role` …). `requires_human_review` tvingas alltid
   till `true`. AI-OCR bokför aldrig — den föreslår, en människa granskar, och
   bokföring sker via en känslig action som kräver godkännande.

## AI-OCR

`POST .../ocr/receipt` (bild/PDF) returnerar ett strukturerat förslag. Kräver
`ANTHROPIC_API_KEY` (annars `400 ai_disabled` — funktionen är frivillig och
fail-fastar inte vid start). Modell via `AI_MODEL` (aktuell, konfigurerbar).

## Köra MCP-servern (live via Cowork/claude.ai)

Servern `server/src/mcp/server.ts` (bygg med `npm run build -w server`, kör med
`npm run mcp -w server`) är en **tunn stdio-transport**: den har ingen egen
databas- eller behörighetslogik utan ringer HTTP-action-API:t med ett
agent-token. Alla regler tvingas på servern (tenant/RLS, oföränderlighet, audit,
mänskligt godkännande). En känslig action returnerar aldrig ett utfört resultat —
den läggs i godkännandekön och en människa godkänner i webbvyn under **Att göra**.

`tools/list` speglar action-manifestet (varje action blir ett native, typat
verktyg via medskickat JSON-schema) plus `list_pending_approvals`. `tools/call`
mappar till `POST .../actions/:name`.

**Env för servern:**

| Variabel | Betydelse |
|---|---|
| `REDOVISNING_API_URL` | bas-URL till API:t (default `http://127.0.0.1:3000`) |
| `REDOVISNING_AGENT_TOKEN` | agent-token (minta via `POST /api/companies/:id/agent-tokens` som ägare) |
| `REDOVISNING_COMPANY_ID` | bolagets UUID verktygen verkar mot |

**Koppla in i en MCP-klient** (Claude Desktop / Cowork-connector) — exempel:

```json
{
  "mcpServers": {
    "redovisning": {
      "command": "node",
      "args": ["/absolut/väg/till/server/dist/mcp/server.js"],
      "env": {
        "REDOVISNING_API_URL": "https://din-api-host",
        "REDOVISNING_AGENT_TOKEN": "<agent-token>",
        "REDOVISNING_COMPANY_ID": "<bolags-uuid>"
      }
    }
  }
}
```

Därefter kan du i Cowork/claude.ai säga t.ex. *"lista kunder"*, *"skapa en
faktura till …"*, *"bokför faktura X"* — den sista blir ett förslag du godkänner
i webbvyn. Rök-/integrationstestet `server/test/mcp.test.ts` startar den byggda
servern och bevisar hela kedjan (inkl. att en känslig action hamnar i kön).
