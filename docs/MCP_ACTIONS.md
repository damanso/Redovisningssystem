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

## K-serien (2026-07): payroll, betalningar och dokument utan workarounds

### Uppslag och härledning (K4)

Agenter ska aldrig behöva gå utanför action-manifestet:

- `list_fiscal_years` (read) — speglar REST-routen `/accounting/fiscal-years`.
- `list_vouchers` / `get_voucher` (read) — verifikat kan slås upp inför t.ex.
  `reverse_voucher` och `link_voucher`.
- `fiscal_year_id` är **valfri** i `book_invoice`, `book_receipt`,
  `book_supplier_invoice`, `register_invoice_payment`,
  `register_supplier_payment`, `book_payslip` och `book_payroll_tax` —
  utelämnad härleds året server-side ur verifikations-/betalningsdatumet
  (kräver ett olåst räkenskapsår; annars `400 no_fiscal_year` /
  `409 period_locked`).

### Beroendemedveten godkännandekö (K4)

En betalning som köas före sin fakturabokning får ett beräknat beroende —
i 202-svaret, i `GET .../approvals` och i Att göra-vyn: *"Fakturan X är inte
bokförd ännu — godkänn book_invoice först"* (med pekare till boknings-
förslaget om det redan ligger i kön). Ett misslyckat godkännande är aldrig
första gången beroendet upptäcks. För det vanligaste flödet finns composite-
actionen `book_invoice_and_register_payment` (sensitive) som köas som EN
godkännandepost och bokför + registrerar betalningen atomiskt.

### Lön (K1–K3)

- Preliminärskatten slås upp i **Skatteverkets tabell 30, kolumn 1**
  (årsversionerad, `server/src/domain/taxTable30.ts`); den anställdas platta
  `tax_rate` är fallback utanför tabellintervallet, `tax_ore` på
  `create_payslip` är manuell jämkning. `recalculate_draft_payslips` (write)
  räknar om obokade utkast — bokförda poster och jämkningar rörs aldrig.
  **Tillägg 1 (2026-07-21):** perioder som faktiskt betalades med ett äldre
  års tabellvärde (2026-03…06: skatt 13 360 / netto 43 140 på 56 500,
  verifierat mot bank + huvudbok) sätts till de historiska värdena
  (`tax_source = 'historical'`) — aldrig retroaktivt med ett senare års
  tabell. Uppslaget görs alltid med det som gällde vid utbetalningstillfället.
- `payment_date` sätts till den 25:e i perioden med svensk bankdagsregel
  (`server/src/domain/bankdays.ts`); semesterersättning via
  `include_vacation_pay` (12 %) eller `vacation_pay_ore`.
- `book_payslip` (sensitive) bokför enligt **kontantmetoden**: 7010 D /
  1930 K = verkligt netto på utbetalningsdatumet. `book_payroll_tax`
  (sensitive) bokför skattekontobetalningen (2510 D / 1930 K = skatt +
  arbetsgivaravgift, förslag avrundat till hela kronor, default den 12:e
  månaden efter). `payroll_year_summary` (read) ger ackumulerat per
  kalenderår. `generate_payslip_pdf` (write) skapar lönespecifikationen
  enligt Locollabs mall och bilägger den på lönebeskedet.

### Dokument (K3)

- `attach_document` (write) — filnamn + base64 (pdf/png/jpg, max 10 MB) +
  koppling till payslip/faktura/kvitto/leverantörsfaktura/verifikat. Samma
  validering som uppladdning (ändelse + magic bytes, UUID-namn utanför
  webroten).
- `list_documents` / `get_document` (read; `include_content` returnerar
  innehållet som base64). Webbvyn visar bilagor på raden och Dokument-flikens
  uppladdning kan koppla direkt.

### Reskontra-baklänkning och momsmetod (K6)

- `link_voucher` (write) — kopplar en befintlig registerpost till ett
  BEFINTLIGT verifikat (t.ex. importserien) utan att bokföra något nytt;
  status (bokförd/betald via `mark_paid`) härleds ur länken.
- `unlink_voucher` (write) — ångrar en baklänkning (motsatsen till
  `link_voucher`). Bokför/raderar INGENTING — verifikatet står orört och
  posten återgår till utkastläge. Spärr: bara kopplingar som skapades via
  `link_voucher` kan ångras (verifieras mot auditloggen); verifikat skapade
  genom bokning rättas via rättelseverifikat. Avsedd för Ethos-rättelsen
  13–18: unlink fel koppling → link rätt verifikat.
- `suggest_voucher_links` (read) — halvautomatiska matchningsförslag
  (belopp + datum + text, poängsatta med skäl) som människan bekräftar per
  rad via `link_voucher`.
- `set_vat_method` (write) — faktura-/kontantmetod som bolagsinställning.
  Momsmetodvakten varnar (notis + audit, blockerar inte) när ett nytt
  verifikat bryter mot metoden; SIE-import och rättelser undantas.

### Städning (K7)

`delete_draft_invoice` / `delete_draft_receipt` /
`delete_draft_supplier_invoice` / `delete_draft_payslip` (write) — raderar
OBOKADE utkast (RLS-policyn släpper aldrig igenom bokförda poster).
Auditloggas med snapshot; dokumentkopplingar städas, bilagda filer behålls.

### Fakturamallen (Locollabs riktiga mall)

Faktura-PDF:en (nedladdning i vyn, `POST /invoices/:id/pdf` i API:t) följer
**Locollabs riktiga, skickade faktura** (porterad 1:1 från faktura 0000024,
juni 2026) — inte gamla systemets layout: logotyp uppe till höger,
"Från"- och "Fakturaadress"-block, stor Faktura-rubrik, metadatakolumn
(OCR-nummer, fakturadatum, förfallodatum med "(N dagar)", Leveranstidpunkt,
"Betalas till: Bankgiro …", 7-siffrigt fakturanummer, Vår/Er referens, IBAN,
BIC/Swift), radtabell Kvantitet/Beskrivning/Pris/Totalt (timpris som
"1 100,00 SEK/h"), summering Exklusive moms/Moms (NN%)/Att betala samt
sidfot i fyra kolumner (bolag, momsreg.nr + F-skatt, telefon/e-post,
hemsida/bankgiro). ROT/RUT-specifikationen och hänvisningen vid omvänd
skattskyldighet är lagkrav och ligger kvar under summeringen.

- `update_company_settings` (write) — bolagsuppgifterna som mallen använder
  (adress, kontakt, momsreg.nr, bankgiro/plusgiro/bankkonto, IBAN, **bic**,
  **website**) via allowlist. Namn/org.nr ingår medvetet inte.
- `set_company_logo` (write) — logotyp som base64 (png/jpg, samma validering
  som all uppladdning); lagras i dokumentarkivet och kopplas via en
  tenant-säker komposit-FK (kan aldrig peka på ett annat bolags fil).
- `create_invoice` har fått `our_reference` ("Vår referens" — `reference` är
  "Er referens") och `delivery_period` ("Leveranstidpunkt", fritext).
- Vyns fakturadetaljsida har **Generera om PDF** — ny fil med senaste mallen
  arkiveras och blir fakturans PDF; den gamla filen ligger kvar i arkivet.

### Fakturaserien och bilagan (LOC-263)

**Seriesynk.** Systemets interna fakturaräknare kan ha glidit isär från den
externa kundserien (numren kunderna faktiskt fått). Modellen är **EN serie
framåt**: räknaren flyttas fram, och gamla avvikande fakturor får kundnumret i
ett eget fält. Bokförd historik numreras aldrig om.

- `get_invoice_number_series` (read) — nästa nummer, högsta utställda och en
  `out_of_sync`-flagga.
- `set_invoice_number_series` (**sensitive**) — flyttar räknaren, **endast
  framåt** (att backa skulle ge dubbla fakturanummer). Auditloggas med gammalt
  och nytt värde.
- `set_external_invoice_numbers` (**sensitive**) — registrerar kundens nummer på
  befintliga fakturor, som en batch i en transaktion med unikhetskontrollen
  uppskjuten (ordningen i listan spelar ingen roll). Flyttar samtidigt räknaren
  förbi det högsta registrerade numret.
- Databasgaranti: `effective_invoice_number` (genererad kolumn = externt när det
  finns, annars internt) med en DEFERRABLE unik nyckel per bolag → **två
  fakturor kan aldrig visa samma nummer för en kund**. PDF, vy och filnamn
  använder alltid det numret; internnumret syns kvar på detaljsidan.
- **OCR:** systemets Luhn-giltiga OCR gäller framåt. Husmallens 12-siffriga
  variant (t.ex. `202626010027`) är **inte** Luhn-giltig och riskerar avvisad
  betalning om bankgiroavtalets OCR-kontroll är påslagen.

**Bilagan (sida 2).** Två varianter ur Locollabs verkliga fakturor: `time`
(tidsspecifikation per datum, kolumn Timmar, "Summa fakturerbar tid") och
`expense` (utläggsspecifikation, kolumn SEK, summering exkl./moms/inkl. moms).
Tid lagras som **heltal minuter** (0,42 h = 25 min), utlägg som **heltal ören**.

- `set_invoice_appendix` (write) — sätter bilagan explicit; ersätter hela
  bilagan (idempotent). Endast på obokade utkast — en bokförd fakturas underlag
  är oföränderligt.
- `get_invoice_appendix` (read).
- `invoice_appendix_from_time_entries` (write) — fyller tidsbilagan ur systemets
  **egen tidrapportering** (fakturerbar, ofakturerad tid i perioden) och
  markerar posterna som fakturerade, så samma timmar inte kan faktureras igen.

### K10 / 3:12 — nya modellen 2026+ och autofyll (Tillägg 2)

- Inkomstår **2026+** beräknas enligt **grundbeloppsmodellen** (riksdagsbeslut
  2025-12-03, källverifierad mot Skatteverkets vägledning inför deklarationen
  2027): grundbelopp = 4 IBB på **året före** beskattningsåret (2026:
  4 × 80 600 = 322 400 kr) fördelat efter ägarandel; lönebaserat utrymme =
  (löneunderlag × andel − 8 IBB) × 0,5 utan löneuttags-/kapitalandelskrav, med
  50×-taket kvar (`spouse_salary_ore` för makar); sparat utrymme förs över
  **utan uppräkning**; omkostnadsbelopp räknas upp endast över 100 000 kr
  (SLR 2,55 % + 9 pp). Inkomstår ≤ 2025 beräknas oförändrat (förenkling/
  huvudregel; `rule` krävs då). SRU-generering för 2026+ vägras tills
  blankettens fältkoder är fastställda.
- `save_k10_computation` (write) — persisterar årets beräkning per inkomstår;
  `set_k10_opening_allowance` (write) — engångsinmatning av historiskt sparat
  utrymme per 2025-12-31; `list_k10_computations` (read).
- `k10_prefill` (read) — autofyll ur systemdata med källa per fält: ägarandel +
  aktiekapital (bolagsinställningarna: `owner_share_permille`,
  `share_capital_ore` via PATCH company), ägarlön ur lönekörningen för
  underlagsåret, faktisk utdelning ur bokföringen (2898), sparat utrymme ur
  föregående års persisterade beräkning, plus utdelningsbarhetsvarning när
  utdelningen överstiger fritt eget kapital (2091–2099) — beslutsstöd, inget
  hinder. K10-sidan i vyn förifyller fälten (redigerbara) och visar
  modellbyte-notisen för 2026+.

### MCP-livscykel (K5)

- `npm run mcp:install` — skriver/reparerar redovisning-blocket i
  `claude_desktop_config.json` idempotent och verifierar med testanrop
  (`/health` + manifestet). Kör efter varje appuppdatering.
- `npm run mcp:token` — förnyar agent-tokenet efter ägarinloggning
  (människan i loopen), uppdaterar configen och skriver ut utgångsdatumet.
  Agent-tokens kan mintas med upp till 90 dagars giltighet (`ttl_days` på
  `POST .../agent-tokens`) — de kan bara begära, aldrig godkänna.
- MCP-verktyget `self_check` rapporterar API-nåbarhet, tokengiltighet och
  tokenutgång (+ varning vid start när < 14 dagar återstår).
