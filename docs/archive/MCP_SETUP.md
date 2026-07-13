# 🤖 MCP (Model Context Protocol) Setup - Puppeteer Integration

## ✅ Installerat

Jag har nu installerat följande MCP-servrar:

1. **puppeteer-mcp-server** (v0.7.2)
   - Browser automation med Puppeteer
   - Screenshot, navigation, form filling
   - Lokation: `/Users/davidmancilla/.nvm/versions/node/v22.19.0/bin/mcp-server-puppeteer`

2. **chrome-devtools-mcp** (v0.8.1)
   - Nyare Chrome DevTools integration
   - Mer underhållen och stabil
   - Lokation: `/Users/davidmancilla/.nvm/versions/node/v22.19.0/bin/chrome-devtools-mcp`

## 📁 Konfigurationsfil

Skapad: `~/.config/claude-code/mcp.json`

```json
{
  "mcpServers": {
    "puppeteer": {
      "command": "/Users/davidmancilla/.nvm/versions/node/v22.19.0/bin/mcp-server-puppeteer",
      "args": [],
      "env": {}
    },
    "chrome-devtools": {
      "command": "/Users/davidmancilla/.nvm/versions/node/v22.19.0/bin/chrome-devtools-mcp",
      "args": [],
      "env": {}
    }
  }
}
```

## 🔄 Aktivera MCP i VS Code

### Steg 1: Starta om VS Code
MCP-konfigurationen laddas när VS Code/Claude Code startar.

```bash
# Stäng och öppna VS Code igen
# eller kör:
code --reuse-window .
```

### Steg 2: Verifiera att MCP är laddat
När du startar en ny konversation med Claude Code bör du se:
- MCP-servrar listade i statusfältet
- Nya verktyg tillgängliga för browser automation

### Steg 3: Testa MCP
Be Claude Code:
```
"Öppna http://localhost:5173 i webbläsaren och ta en screenshot"
```

eller

```
"Navigera till http://localhost:5173, registrera en användare och logga in"
```

## 🎯 Vad MCP-servrar kan göra

### Puppeteer MCP Server

**Tillgängliga funktioner:**
- `puppeteer_navigate` - Navigera till URL
- `puppeteer_screenshot` - Ta screenshot av sida
- `puppeteer_click` - Klicka på element
- `puppeteer_fill` - Fyll i formulär
- `puppeteer_evaluate` - Kör JavaScript på sidan
- `puppeteer_pdf` - Generera PDF av sida

**Exempel:**
```javascript
// Claude Code kan nu köra:
await puppeteer_navigate("http://localhost:5173")
await puppeteer_screenshot("screenshot.png")
await puppeteer_fill("input[name='email']", "test@example.com")
await puppeteer_click("button[type='submit']")
```

### Chrome DevTools MCP

**Tillgängliga funktioner:**
- Browser automation med Chrome DevTools Protocol
- Network monitoring
- Console logs
- Performance profiling
- Debugging

## 🧪 Exempel: Testa Redovisningssystemet

### 1. Automatisk registrering och inloggning

Be Claude Code:
```
"Använd Puppeteer för att:
1. Öppna http://localhost:5173
2. Registrera en användare med email test@example.com
3. Logga in
4. Ta screenshot av dashboard
5. Verifiera att användaren är inloggad"
```

### 2. Skapa faktura via UI

```
"Använd Puppeteer för att:
1. Navigera till /invoices/new
2. Fyll i kundinformation
3. Lägg till fakturarader
4. Klicka på 'Skapa faktura'
5. Verifiera att fakturan skapades"
```

### 3. End-to-End test av hela flödet

```
"Kör ett E2E-test med Puppeteer:
1. Registrera användare
2. Skapa företag
3. Lägg till kund
4. Skapa artikel
5. Skapa faktura
6. Generera PDF
7. Ta screenshots av varje steg"
```

## 🔍 Felsökning

### MCP-servrar laddas inte

**Problem:** VS Code hittar inte MCP-konfigurationen

**Lösning:**
```bash
# Kontrollera att filen finns
cat ~/.config/claude-code/mcp.json

# Kontrollera att binärerna finns
which mcp-server-puppeteer
which chrome-devtools-mcp

# Starta om VS Code helt
```

### Puppeteer hittar inte Chrome

**Problem:** `Error: Could not find Chrome (ver. 123.0.6312.58)`

**Lösning:**
```bash
# Installera Chrome om den saknas
# eller sätt PUPPETEER_EXECUTABLE_PATH:

# Uppdatera mcp.json:
{
  "puppeteer": {
    "command": "...",
    "env": {
      "PUPPETEER_EXECUTABLE_PATH": "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    }
  }
}
```

### Port 5173 är inte tillgänglig

**Problem:** Puppeteer kan inte nå localhost:5173

**Lösning:**
```bash
# Kontrollera att frontend körs
curl http://localhost:5173

# Starta om frontend om den inte körs
cd frontend && npm run dev
```

## 📚 Dokumentation

- **Puppeteer MCP:** https://github.com/merajmehrabi/puppeteer-mcp-server
- **Chrome DevTools MCP:** https://github.com/google/chrome-devtools-mcp
- **MCP Specification:** https://modelcontextprotocol.io/

## 🎓 Avancerad användning

### Skapa custom MCP server

Du kan skapa din egen MCP-server för specifika testfall:

```typescript
// custom-test-server.ts
import { Server } from '@modelcontextprotocol/sdk/server/index.js';

const server = new Server({
  name: 'redovisning-test-server',
  version: '1.0.0'
}, {
  capabilities: {
    tools: {}
  }
});

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'create_test_invoice',
      description: 'Creates a test invoice with dummy data',
      inputSchema: {
        type: 'object',
        properties: {
          customer_name: { type: 'string' },
          amount: { type: 'number' }
        }
      }
    }
  ]
}));

server.connect(new StdioServerTransport());
```

### Lägg till i mcp.json:
```json
{
  "mcpServers": {
    "custom-test": {
      "command": "tsx",
      "args": ["custom-test-server.ts"],
      "env": {}
    }
  }
}
```

## ✅ Status

- ✅ Puppeteer MCP Server installerad
- ✅ Chrome DevTools MCP installerad
- ✅ Konfigurationsfil skapad
- ⏳ Väntar på VS Code restart för att ladda MCP

## 🚀 Nästa steg

1. **Starta om VS Code** för att ladda MCP-konfigurationen
2. **Verifiera** att MCP-servrar är aktiva (se statusfält)
3. **Testa** genom att be Claude Code använda Puppeteer
4. **Automatisera** tester av hela redovisningssystemet

---

**Skapad:** 2025-01-16
**Status:** ✅ Redo att användas efter VS Code restart
