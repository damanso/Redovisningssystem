# Kom igång — två sätt att använda systemet

Du kan sköta bokföringen på **två sätt**, och växla fritt mellan dem:

1. **Via AI (Claude Desktop)** — du pratar med bokföringen: *"skapa faktura", "bokför
   kvitto X", "hur ser momsen ut?"*. AI:t föreslår och begär; känsliga saker
   (bokföra, låsa period) måste **du godkänna** i webbvyn under **Att göra**.
2. **Direkt i appen** (`http://localhost:3000/app`) — logga in och klicka: skapa
   bolag, räkenskapsår, kunder, fakturor, kvitton, rapporter, bokslut, deklarationer.
   Detta fungerar helt utan AI (t.ex. om dina AI-tokens tar slut).

Samma kärna, samma regler, samma data bakom båda. Börja alltid med att starta appen:
`bash start-lokalt.sh` (se README) och logga in.

---

## 1. Använda direkt i appen

1. Logga in på `http://localhost:3000/app` (eller **Skapa konto** på inloggningssidan).
2. **Skapa bolag** på startsidan (namn + ev. org.nr).
3. Öppna bolaget → **Skapa räkenskapsår** (kom-igång-kortet på översikten).
4. Bygg upp registret och bokför — allt i webbläsaren:
   - **Kunder / Leverantörer** → formulär "Ny kund"/"Ny leverantör" under listan.
   - **Fakturor** → "Ny faktura" (kund, datum, upp till tre rader med à-pris i kr).
     Klicka **Bokför…** på ett utkast, och **Registrera betalning…** när pengarna kommit.
   - **Kvitton** → "Nytt kvitto" (datum, beskrivning, netto, moms, konton) + **Bokför…**.
5. **Viktigt:** allt som rör pengar (bokföra, betala) blir ett förslag under
   **Att göra** — där bekräftar du med ett klick innan något skrivs i huvudboken.
   Det är samma skyddsräcke som när AI:t föreslår saker.

## 2. Använda via Claude Desktop (AI)

Allt sker via en **MCP-server** som pratar med din lokala app med ett **agent-token**.

### a) Skapa AI-token i appen (ingen terminal)
1. Öppna ditt bolag → **Anslut AI** i menyn.
2. Klicka **Skapa AI-token**. Du får ett token (visas **en gång**) och en färdig
   konfig att klistra in. Kopiera direkt.

### b) Bygg MCP-servern en gång
I terminalen, i projektmappen:
```bash
npm run build
```

### c) Klistra in i Claude Desktop
Öppna (skapa om den saknas):
`~/Library/Application Support/Claude/claude_desktop_config.json`

Klistra in konfigen från **Anslut AI**-sidan. Den ser ut så här (byt
`<SÖKVÄG-TILL-REPOT>` mot din projektmapp, t.ex. `/Users/dittnamn/redovisningssystem`):

```json
{
  "mcpServers": {
    "redovisning": {
      "command": "node",
      "args": ["<SÖKVÄG-TILL-REPOT>/server/dist/mcp/server.js"],
      "env": {
        "REDOVISNING_API_URL": "http://127.0.0.1:3000",
        "REDOVISNING_COMPANY_ID": "<ditt-bolags-id>",
        "REDOVISNING_AGENT_TOKEN": "<ditt-token>"
      }
    }
  }
}
```
(Bolags-id och token är redan ifyllda i konfigen du kopierar från appen.)

### d) Starta om Claude Desktop
Se till att din lokala app körs (`bash start-lokalt.sh`). Starta om Claude Desktop.
Nu kan du säga t.ex. *"lista mina kunder"* eller *"skapa en faktura på 10 000 kr
till Kund AB"*. Känsliga steg dyker upp i **Att göra** i webbvyn för din godkännande.

> **Förtroendegräns:** agent-tokenet är låst till ETT bolag, giltigt i 30 dagar,
> och kan aldrig godkänna sina egna förslag. Bara du (inloggad människa) godkänner.

---

## 3. Ta med din tidigare ekonomi (import)

Öppna bolaget → **Import** i menyn. Två format stöds:

- **SIE (.se)** — standardexportfilen från nästan alla svenska bokföringsprogram
  (Fortnox, Visma, Bokio m.fl.). Exportera året som SIE4 därifrån och importera här
  → verifikat, konton och saldon läses in.
- **Bank-CSV** — kontoutdrag som CSV läses in som banktransaktioner att stämma av mot.

Du kan också be AI:t: *"importera den här SIE-filen"* om du kör via Claude Desktop.

> Tips: exportera hela det senaste avslutade räkenskapsåret som SIE4 från ditt gamla
> program, importera det, och stäm sedan av ingående balanser mot din senaste
> årsredovisning innan du börjar bokföra nytt.

---

## Vad som INTE ingår (viktigt)

- **Ingen digital inlämning** till Skatteverket/Bolagsverket och **ingen BankID** —
  deklarations- och årsredovisningsfiler genereras som *underlag* du lämnar manuellt.
- Se README för fullständig statuslista.
