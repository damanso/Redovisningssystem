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

### Ej avdragsgilla kostnader → INK2S automatiskt

Konton som är ej avdragsgilla till sin natur är flaggade i kontoplanen (6072
representation ej avdragsgill, 6992 övriga externa kostnader ej avdragsgilla).
Bokförs en kostnad där räknas beloppet fram till **INK2S ruta 4.3 c direkt ur
huvudboken** — återläggningen är en följd av konteringen och behöver inte matas
in för hand.

- `set_account_non_deductible` (write) — flaggar/avflaggar ett konto. Gäller
  bolagets egen kontoplan; för ett standardkonto skapas en bolagsspecifik
  skuggkopia med flaggan (RLS tillåter inte att standardplanen ändras).
- `ink2s_adjustments` (read) returnerar nu `derived_non_deductible_ore`
  (härlett), `manual_non_deductible_ore` (registrerat via `add_tax_adjustment`)
  och `derived_non_deductible` med belopp per konto. De redovisas som **separata
  rader** i INK2S så att inget dubbelräknas oupptäckt.
- Manuella justeringar behövs fortfarande för det som inte har eget konto —
  t.ex. den ej avdragsgilla delen av en blandad kostnad.

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

### Tidspostens livscykel (PRD_TIDSRAPPORTERING §9 steg 1)

Registrerad tid och fakturerad tid är inte samma sak. `minutes` betyder
fortfarande vad som HÄNDE; `billable_minutes` är vad kunden betalar, och
`status` säger var i loopen posten står:

| Status | Betydelse | Med på faktura? |
|---|---|---|
| `forslag` | AI:t har föreslagit posten | nej |
| `godkand` | godkänd, debiterbar tid fastställd | ja |
| `justerad` | godkänd med annan tid än registrerad (kräver skäl) | ja, justerad tid |
| `ignorerad` | ska aldrig faktureras (kräver skäl); raderas aldrig | nej |
| `fakturerad` | låst till en faktura (`invoice_id`) | redan fakturerad |

- `log_time` (write) har fått `billable_minutes` (utelämnad = `minutes`) och
  `adjustment_reason` — **skiljer de sig krävs skälet** (400
  `adjustment_reason_required`). Statusen sätts av VEM som skriver: en
  människas post blir `godkand` med godkännandespår (`approved_by`,
  `approved_at`), AI:ts blir `forslag` och kan aldrig hamna på en faktura utan
  att en människa först godkänt den. `billable: false` betyder `ignorerad`.
- `update_time_entry` (write) — ändrar `work_date`, `minutes`,
  `billable_minutes`, `description`, `status` och `adjustment_reason` på en post
  som **inte** är fakturerad (annars 409 `time_entry_locked`; en fakturerad post
  rättas med kreditering). Tillåtna byten: allt mellan `forslag`, `godkand`,
  `justerad` och `ignorerad` utom tillbaka till `forslag` — aldrig till eller
  från `fakturerad` (409 `invalid_status_transition`). `justerad`/`ignorerad`
  kräver `adjustment_reason`.
  **Debiterbar tid skrivs aldrig tyst:** ändras `minutes` utan att
  `billable_minutes` skickas lämnas de debiterbara orörda, och skiljer de sig
  därefter måste posten uttryckligen sättas till `justerad` med skäl (400
  `adjustment_required`).
- `list_time_entries` (read) — filter `project_id`, `status`, `from`, `to`,
  `actor` (aktören som utförde arbetet); returnerar bl.a. `minutes`,
  `billable_minutes`, `status`, `source`, `source_ref`, `invoice_id`,
  `duration_hhmm`/`billable_duration_hhmm` (samma tal i hh:mm) och `links[]`
  (underlagslänkarna, se story 5 nedan).
- `invoice_appendix_from_time_entries` väljer nu **godkänd/justerad tid utan
  faktura** (`SELECT … FOR UPDATE`), skriver bilagan med de DEBITERBARA
  minuterna och låser posterna till fakturan (`invoice_id` + `fakturerad`) i
  samma transaktion. Ändras urvalet av någon annan under tiden rullas allt
  tillbaka med 409 `time_entries_changed` — en halv fakturering, där bilagan
  skrivits men posterna inte låsts, är precis julifelet.
- `billable`/`invoiced` finns kvar som speglingar av statusen och skrivs i
  samma transaktion (`invoiced` = statusen är fakturerad, `billable` = statusen
  är inte ignorerad), så projektvyn, styrvyn, kundkortet och RLS-policyn i 0053
  läser oförändrat.

### Faktura ur godkänd tid (PRD_TIDSRAPPORTERING §4 F6+F7, story 2)

Julifelet var inte att bilagan saknades utan att fakturan kunde existera UTAN
att tidposterna stängdes. Vägen dit gick i tre steg (skapa faktura → fyll bilaga
→ hoppas att någon körde steg två), och ett steg som kan hoppas över blir förr
eller senare överhoppat. Nu är de tre stegen ETT.

- `create_invoice_from_time` (write) — `customer_id`, `project_id`, `from`,
  `to`, `invoice_date`, valfria `due_date`, `reference`, `our_reference`,
  `title`, `preamble`, `exclude_entry_ids`, `appendix_layout` och
  `confirm_over_cap`. I EN transaktion: urvalet (godkänd/justerad tid utan
  faktura i perioden, minus `exclude_entry_ids`) väljs och låses `FOR UPDATE`,
  fakturan skapas med **en rad per avtalsdel och taxa** (beskrivning = delens
  `code` + `name`, taxan i ordningen post → del → avtal → uppdrag; antal =
  debiterbara minuter/60 med två decimaler; moms 25 % och konto 3001 när inget
  annat anges), bilagan skrivs ur samma rader och posterna låses till fakturan.
  Svar: `invoice`, `time_entries`, `billable_minutes`, `appendix_layout`.
  Fel: 400 `no_time_entries` (inget att fakturera), 409 `time_entries_changed`
  (någon annan hann före), 400 `missing_hourly_rate` (**aldrig ett tyst
  nollpris**), 409 `cap_exceeded` (bekräftat avtalstak passerat — se story 3).
  Uppdraget sätts på fakturahuvudet (`invoices.project_id`).
  De undantagna posterna rörs **inte alls** och ligger kvar som godkänd,
  ofakturerad tid.
- `set_invoice_appendix` med `kind: 'time'` kräver nu `bypass_time_entries:
  true` **och** `reason` — annars 409 `use_create_invoice_from_time`. En
  handskriven tidsbilaga låser ingen tidpost, så samma timmar kan faktureras
  igen i morgon; skälet skrivs i auditloggen (`invoice.appendix_time_bypass`).
  `kind: 'expense'` och `kind: 'category'` är oförändrade.
- `delete_draft_invoice` **återöppnar** utkastets tidsposter i samma transaktion
  som raderingen: `justerad` när debiterbar tid skiljer sig från registrerad,
  annars `godkand`, med `invoice_id = NULL` och `invoiced = false`
  (`reopened_time_entries` i svaret, auditlogg
  `invoice.time_entries_reopened`). Utan det vore raderingen en fälla: timmarna
  låsta till en faktura som inte finns.
- Faktura-PDF:en vägrar med 409 `pdf_number_collision` om en annan faktura i
  bolaget redan har en PDF med samma `effective_invoice_number`. Databasens
  unika nyckel (0046) är förstahandsgarantin; kontrollen är den andra, så att
  två dokument aldrig kan utge sig för att vara samma faktura.

### Avtal och avtalsdelar (PRD_TIDSRAPPORTERING §3.2, story 3)

ILT-avtalets Fas 2A har ett tak på 32 h / 35 200 kr. Taket passerades utan att
någon sa något — inte för att ingen läste, utan för att systemet inte hade
någonstans att SKRIVA det (PRD §1 rad 6). `projects` bär en timtaxa och en
budget; ett uppdrag är inte ett avtal. Migration 0064 ger avtalet och dess
faser egna tabeller (`contracts`, `contract_parts`) och tidsposten en koppling
(`time_entries.contract_part_id`, nullbar).

Tre regler bär hela funktionen:

1. **Registrering spärras aldrig.** Tid som är arbetad ska alltid gå att skriva
   ner; ett system som vägrar ta emot verkligheten får tillbaka den i ett
   kalkylark. Taket VARNAR vid registreringen och SPÄRRAR först vid
   faktureringen, där pengarna flyttar sig.
2. **Ett oläst tak varnar aldrig.** `cap_confirmed` betyder att en människa läst
   talet i avtalshandlingen. Ett obekräftat eller saknat tak redovisas som
   `cap_status: 'vet_ej'` med förbrukningen bredvid och `share: null`.
3. **Ett tilläggsavtal är en ny rad**, aldrig en överskrivning: samma `code` med
   senare `valid_from`. Förbrukningen summeras över alla versioner, taket
   hämtas ur den version som gäller i dag (framtida versioner gäller inte än).

- `create_contract` (write) — `project_id` (krävs), `name`, valfria
  `customer_id` (utelämnad = uppdragets kund), `signed_date`,
  `payment_terms_days`, `hourly_rate_ore`, `source_file_id` (avtalshandlingen)
  och `notes`.
- `update_contract` (write) — `contract_id` + samma fält.
- `upsert_contract_part` (write) — `contract_id`, `code` (t.ex. `2A`), `name`
  (krävs bara när delen skapas), valfria `description`, `parent_part_id`,
  `billable`, `hourly_rate_ore`, `cap_hours`, `cap_amount_ore`,
  `cap_confirmed` (default **false**), `valid_from` (utelämnad = avtalets
  `signed_date`; saknas det: 400 `valid_from_required`), `sort_order`,
  `active`. Nyckeln är (avtal, kod, `valid_from`): samma `valid_from` ändrar
  raden och sätter `manually_edited = true`, ett senare lägger en ny version
  bredvid den gamla.
- `list_contracts` (read) — filter `project_id`, `contract_id`. Varje avtal bär
  `parts` med förbrukning per del.
- `get_contract_usage` (read) — `contract_id`. Per del: `billable_minutes` och
  `amount_ore` ur poster med status `godkand`/`justerad`/`fakturerad` (ett
  `forslag` räknas inte — AI:ts gissning ska inte larma om ett avtalstak),
  `own_billable_minutes` (utan barnens), `cap_hours`/`cap_amount_ore`,
  `cap_status`, `share` och `versions`. **Föräldradelens förbrukning är summan
  över barnens**; saknar föräldern eget tak härleds det ur barnens
  (`cap_derived: true`) och är bekräftat bara om varje ingående tak är det.
- `assign_contract_part` (write) — `time_entry_id`, `contract_part_id`. Sätter
  **enbart** klassificeringen och är därför tillåten även på en `fakturerad`
  post: den ändrar varken belopp, minuter eller låset till fakturan. Allt annat
  på en fakturerad post är fortsatt låst (`update_time_entry` ger 409
  `time_entry_locked`). Utan undantaget hade juliposterna aldrig gått att
  hänföra till en avtalsdel.
- `log_time`/`update_time_entry` tar `contract_part_id`. Har uppdraget aktiva
  avtalsdelar **krävs** den (400 `contract_part_required`); hör delen till ett
  annat uppdrag blir det 400 `contract_part_project_mismatch`. Taxan gäller i
  ordningen **post → avtalsdel → avtal → uppdrag** (den gamla botten post →
  uppdrag är oförändrad för tid utan avtalsdel).
  - **När kravet prövas i `update_time_entry`** (rättelse 7b): bara när
    målstatus (`status` i anropet, annars postens nuvarande) är `godkand`
    eller `justerad` — alltså när tiden blir debiterbar — och posten saknar
    del både på raden och i indata. Övergång till `ignorerad`, och ändring av
    `description`/`work_date`/`minutes`/länkar på en post i status `forslag`
    eller `ignorerad`, kräver **aldrig** avtalsdel; att SÄTTA
    `contract_part_id` är alltid tillåtet, och en medskickad del prövas alltid
    mot uppdraget. `log_time` är oförändrad: vid registreringen krävs delen.
    Utan lättnaden låste sig godkännandekön på det som aldrig ska bli pengar —
    ett skräpförslag gick varken att ignorera eller texträtta utan att först
    klassas mot ett tak det inte förbrukar.
- **Takutfallet efter en sparad post:** är taket bekräftat och förbrukningen
  ≥ 80 % bär svaret `warning { part, used_minutes, used_amount_ore, cap_hours,
  cap_amount_ore, share, over_cap, message }`. Över 100 % säger meddelandet att
  avtalet kräver skriftligt besked till kunden om ändrad omfattning, och
  överskridandet skrivs i auditloggen (`contract_part.cap_exceeded`). Posten
  sparas ALLTID. Föräldrakedjan räknas med: en post på Fas 2A förbrukar också
  Fas 2:s tak.
- **Spärren vid fakturering:** tar urvalet en del (eller dess förälder) över ett
  BEKRÄFTAT tak svarar `create_invoice_from_time` 409 `cap_exceeded`. Med
  `confirm_over_cap: true` skapas fakturan och forceringen skrivs i auditloggen
  (`invoice.cap_override`, även i svarets `cap_override`). Ett obekräftat eller
  saknat tak spärrar aldrig.
- **Bilagan:** `appendix_layout: 'per_datum'` (default) ger tidsbilagan per
  datum, formatet från faktura 0000027. `'per_avtalsdel'` ger kategoribilagan
  ur 0063: kind `category`, en rad per avtalsdel med delens namn och summerade
  minuter — **inga datum**, ur exakt samma låsta urval som fakturaraderna. Tid
  utan avtalsdel hamnar under `Övrigt` när fakturan har klassad tid att stå
  bredvid; är ingen post klassad står uppdragets namn kvar som förut.

## Läs in avtalet ur avtalsfilen (story 6)

Avtalet bodde i en DOCX och i Davids huvud. Story 3 gav taket en plats att bo
på; det som saknades var vägen från handlingen dit — och ett tak som aldrig
skrivs in kan aldrig varna. Två actions, med Davids formulär emellan: den
första LÄSER och skapar ingenting, den andra skriver.

- `extract_contract_draft` (write) — `filename`, `content_base64` (samma form
  som `attach_document`: pdf/png/jpg, validerat mot ändelse **och** magic
  bytes). Filen lagras i dokumentarkivet och svaret är
  `{ draft, file_id, customer_id, customer_matched_on }`. **Inget avtal skapas.**
  Utkastet bär `requires_human_review: true` och `model`, och parsas genom ett
  strikt schema som kastar okända fält (`auto_approve`, `role`, `action`) —
  även inne i `parts[]`. Belopp är heltal i ören.
  - **DOCX ger 400 `unsupported_media`** med texten att avtalet ska sparas som
    PDF. Ett zip-/docx-bibliotek vore ett nytt beroende (rådslaget 1/9).
  - **Utan `ANTHROPIC_API_KEY`: 409 `ai_disabled`.** Mediatypen prövas FÖRE
    nyckeln — en DOCX är fel oavsett. (`ai_ocr` svarar 400 för samma kod;
    skillnaden är avsiktlig och rör bara den här vägen.)
  - Kunden slås upp ur utkastets kundpart med **samma regel som crm-ingesten**:
    org.nr på siffror, annars exakt namn. Tvetydigt räknas som ingen träff, och
    `customer_matched_on` redovisar utfallet.
- `create_contract_from_draft` (write) — `project_id`, `name`, valfria
  `customer_id`, `source_file_id`, `signed_date`, `payment_terms_days`,
  `hourly_rate_ore`, `notes`, `parts[]` (`code`, `name`, valfria `description`,
  `parent_code`, `cap_hours`, `cap_amount_ore`, `cap_confirmed`) och `draft`
  (utkastet ovan). Avtalet och SAMTLIGA avtalsdelar skapas i **en** transaktion
  via `createContract`/`upsertContractPart`; faller en del skapas ingenting.
  - `parent_code` slås upp mot koderna i samma anrop (föräldern skapas först);
    en kod utan motsvarighet ger 400 `unknown_parent_code`. Samma kod två gånger
    ger 400 `duplicate_part_code`.
  - Finns faser krävs `signed_date` (400 `signed_date_required`) — delarnas
    `valid_from` hämtas därifrån.
  - **`manually_edited = true` sätts på exakt de delar där det inskickade värdet
    avviker från utkastet** (namn, beskrivning, förälder, de två taken). En del
    utan motsvarighet i utkastet — eller ett formulär utan utkast alls — räknas
    som ändrad. Flaggan sätts genom contracts.ts egen semantik ("vid ändring,
    inte vid skapande"), så auditloggen visar både `contract_part.created` och
    `contract_part.updated`.
  - `cap_confirmed` är fortsatt default **false**: ett tak AI:n läst men ingen
    människa bekräftat varnar aldrig.
- **Vyn:** "Läs in avtal" på uppdragssidan
  (`/app/c/:id/projects/:projectId/avtal`) → uppladdning → förifyllt, fullt
  redigerbart formulär → "Skapa avtal". Utan API-nyckel visas samma formulär
  tomt med "AI-extraktion avstängd — fyll i manuellt", och det fungerar hela
  vägen.

## Rapporterna: ofakturerad tid, stillhet och avtalsförbrukning (story 4)

Juli- och augustifelet var inte en felräkning — det var att godkänd, ännu
ofakturerad tid inte syntes någonstans om ingen frågade. Tre lässvar och vysidan
`/tid` läser ur SAMMA tjänstefunktioner (`services/timeReports.ts`), och
styrvyns `coverage.unbilled_time_ore` räknas numera likadant: den äldre formeln
i `steering.ts` (`billable AND NOT invoiced`, utan avtalstaxa och utan
livscykeln) är borttagen. **En definition, tre ingångar.**

- `unbilled_time_report` (read) — valfria `customer_id`, `project_id`, `to`
  (default idag). Svarar per **kund → uppdrag → avtalsdel** med `entries`,
  `minutes` (REGISTRERAD tid), `billable_minutes`, `amount_ore` och
  `oldest_work_date`. Urvalet är fakturadragets: `status IN
  ('godkand','justerad')`, `invoice_id IS NULL`, `work_date <= to`, och beloppet
  går genom `gallandeTaxa` (post → avtalsdel → avtal → uppdrag) +
  `timeEntryAmountOre` — samma tal som fakturan tar ut.
  - En **`ignorerad`** post räknas i `minutes` men aldrig i `billable_minutes`
    eller `amount_ore`: nedlagd tid ska synas, inte debiteras.
  - Ett **`forslag`** räknas som `proposal_entries` per uppdrag och kund, och
    ligger utanför både minuter och belopp — AI:ts gissning är inte intjänade
    pengar.
  - **Betalningsdimensionen per kund:** `unbilled_ore`, `invoiced_unpaid_ore`
    (+ `invoiced_unpaid_buckets` ur `accountsReceivableAging(to)`, ingen ny
    beräkning) och `paid_in_period_ore` = inbetalningsverifikaten
    (`source_type='payment'`) med verifikatdatum från `period_from` (första
    dagen i `to`:s kalendermånad) t.o.m. `to`.
  - Kunder **utan** ofakturerad tid står inte i svaret; deras obetalda fakturor
    finns i kundreskontran. Svaret bär också `idle[]` (nedan).
- `idle_projects_report` (read) — valfritt `days` (heltal ≥ 1, default 7).
  Uppdrag med status `active` utan en enda tidpost — i NÅGON status — de
  senaste `days` dagarna: `project_id`, `project_number`, `project_name`,
  `customer_id`/`customer_name`, `last_work_date` (null = ingen tid alls) och
  `days_idle`. Rapporterar **ATT** det ligger still, aldrig varför.
- `contract_usage_report` (read) — **utan indata**: `listContracts` bär redan
  hela svaret, och ett filter ingen bett om är ett sätt att missa den del som
  spruckit. En rad per avtalsdel med `billable_minutes`/`used_hours`,
  `amount_ore` (godkänd + justerad + fakturerad, ur `getContractUsage`),
  `cap_hours`/`cap_amount_ore`, `cap_derived`, `cap_status`, `share`,
  `parent_code` och `unbilled_amount_ore`/`unbilled_billable_minutes` ur
  urvalet ovan. `status` härleds ur `share`/`cap_status`: `'under 80 %'`,
  `'80–100 %'`, `'över tak'` — eller **`'vet ej'`** när taket saknas eller är
  obekräftat, för ett oläst tak varnar aldrig. Både förbrukningen och det
  ofakturerade rullas upp i fasföräldern.
- **Vysidan `/app/c/:companyId/tid`** (menyposten *Tid* under "Lön & projekt")
  visar exakt samma tal, JS-fritt: ofakturerad tid per kund med
  betalningskolumnerna, stillastående uppdrag och avtalsförbrukningen, med länk
  per rad till uppdraget och en rad "N förslag väntar" (godkännandeytan kommer
  i story 8).

## Registrera, rätta och belägga tid i vyn (story 5)

Rapporterna gjorde tiden synlig; det som saknades var att SKRIVA och RÄTTA den
utan AI. Tidsfältet tar emot det man ändå skriver, och tolkningen sker på ETT
ställe (`server/src/lib/duration.ts`) för både vyn och AI-vägen.

- **Tidsparsern** (`parseDuration`, ren funktion): `1h` → 60, `1,5`/`1.5` → 90,
  `90m` → 90, `45` → 45, `1h30` → 90, `1:30` → 90. Ett tal **utan enhet under
  10 är timmar, från 10 och uppåt minuter** (Davids beslut 1/9) — `7` är alltså
  7 h (`07:00`). Resultatet är alltid HELA minuter, 1–1440; allt annat ger 400
  `invalid_duration` med exemplen i feltexten. Villkoret för regeln: svaret
  visar den tolkade tiden i hh:mm och formuläret skriver ut regeln vid fältet.
- `log_time` och `update_time_entry` tar valfritt **`duration`** (text) som
  alternativ till `minutes`. Exakt ett av dem — båda (eller, för `log_time`,
  inget) ger 400 `minutes_or_duration`. Svaret bär `duration_hhmm` och
  `billable_duration_hhmm`.
- `attach_time_entry_link` (write) — `time_entry_id`, `url`, valfri `label`.
  **Underlag är LÄNKAR, aldrig filkopior** (rådslaget 1/9, ILT §6): adressen
  säger var underlaget finns, den är inte underlaget. `url` måste börja med
  `https://` (400 `invalid_link_url`, och samma villkor i schemat), och posten
  får inte ligga på en faktura (409 `time_entry_locked`). Auditloggas i samma
  transaktion (`time_entry.link_attached`).
- `remove_time_entry_link` (write) — `link_id`. Samma lås och samma auditrad
  (`time_entry.link_removed`). Migration **0065** ger tabellen
  `time_entry_links` (RLS + GRANT som 0047, komposit-FK till `time_entries`).
- **Vyn:** snabbformuläret ligger överst på `/tid` och på uppdragssidan
  (uppdrag, avtalsdel, tid, beskrivning, datum — en rad, en knapp), och varje
  tidpost har en egen sida `/app/c/:companyId/tid/:entryId` med rättelse
  (datum, tid, debiterbar tid, beskrivning, avtalsdel, status, justeringsorsak),
  underlagslänkarna och postens egen historik ur revisionsloggen. En fakturerad
  post renderas **låst**, med 409-texten utskriven och utan formulär.

## Tidsförslag: batchintag, kö och batchgodkännande (story 7)

Mottagarsidan för AI-föreslagen tid. Skriven FÖRE Hermes-skillen (story 8) med
flit: ett intag vars form uppfinns av avsändaren ändras varje gång avsändaren
ändrar sig. Skillen blir konfiguration mot ett färdigt kontrakt.
Avsändarens hela kontrakt — med exempel och regeln för `reasoning` — står i
`docs/crm/API_KONTRAKT.md`, avsnittet *Tidsförslag*.

- `propose_time_entries` (write, agent- eller människotoken) — `events[]`, max
  500. Per händelse: `project_id` **eller** `project_hint`, valfritt
  `contract_part_id`/`part_hint`, `work_date`, `minutes` (**0–1440**, noll
  tillåtet), `description`, `source` (`kalender`|`mail`|`harledd`),
  `source_ref`, `uncertainty` (`lag`|`medel`|`hog`) och `reasoning` (max 500
  tecken). Skapar `time_entries` med status **`forslag`**,
  `billable_minutes = minutes` och speglingarna ur `speglingar()`. Svar:
  `{received, created, duplicates, unresolved[], unsorted, overlaps_manual,
  skipped[]}`. **Savepoint per händelse** som `ingest_crm_events` — en trasig
  rad stoppar inte batchen, den hamnar i `skipped`.
- **Idempotens (migration 0066):** unikt partiellt index på
  `time_entries (company_id, source_ref) WHERE source_ref IS NOT NULL`. Ett
  källid som redan finns hoppas över och räknas i `duplicates` — aldrig en
  uppdatering, aldrig en andra rad. Samma batch två gånger ger idel
  `duplicates` och noll nya rader; det är kvittot på att nattjobbet tål att
  köras om.
- **`project_hint` utan träff → uppdraget `Osorterat`** (skapas vid behov,
  exakt en gång per bolag) och hinten redovisas i `unresolved`
  (`"kund: Acme AB"`). Uppslaget är entydigt eller inget: uppdragets namn,
  kundens namn, kundens e-postdomän eller relationsytans webbplats — träffar
  ledtråden två aktiva uppdrag blir det `Osorterat`, för en gissning hade lagt
  arbetet på fel kunds faktura. `part_hint` utan träff lämnar avtalsdelen tom
  och redovisas som `"avtalsdel: Fas 2A"`. Ett förslag **får** sakna avtalsdel
  även när uppdraget har delar — kravet ställs först vid godkännandet.
- **Dubblettskydd mot människans rad:** finns redan en post med
  `source = 'manuell'` på samma uppdrag och samma dag sätts `overlaps_manual`
  på förslaget, och kön frågar *"redan registrerad?"*. Vi vägrar inte — det kan
  vara två olika arbeten — men en tyst andra rad är hur samma timme faktureras
  två gånger.
- `approve_time_entries` (write) — `ids[]` (max 500), valfria `status`
  (`godkand`|`justerad`|`ignorerad`, default `godkand`) och
  `adjustment_reason` som gäller hela batchen, samt `per_id[]` med
  `{id, status?, billable_minutes?, adjustment_reason?, contract_part_id?,
  project_id?}` för raderna som avviker. Svar:
  `{processed, godkand, justerad, ignorerad, moved}`.
  - Statusbytet går genom **`updateTimeEntry`** och därmed genom
    `TILLATNA_BYTEN`, kravet på skäl för `justerad`/`ignorerad`, kravet på
    avtalsdel (400 `contract_part_required`) och låset mot fakturerade poster
    (409 `time_entry_locked`). Inga egna kopior av reglerna.
  - **Avtalsdelen krävs bara för `godkand`/`justerad`** (rättelse 7b): det är
    där tiden blir debiterbar. `ignorerad` går alltid, även på ett förslag utan
    del på ett uppdrag med aktiva delar — annars låser sig kön på det som
    aldrig ska bli pengar. `contract_part_id` i samma anrop som godkännandet
    räcker; inget mellansteg krävs.
  - **`godkand`/`justerad` kräver `minutes > 0`** (400 `minutes_required`): en
    0-minuters mailmarkering måste få tid satt på postens egen sida — eller
    ignoreras. Schemats CHECK bär samma regel: noll minuter tillåts bara för
    `forslag` och `ignorerad`.
  - **Osorterat-spärren:** `godkand`/`justerad` på en post vars uppdrag är
    `Osorterat` ger **409 `unsorted_project`**. `project_id` i samma anrop
    flyttar posten till rätt uppdrag (avtalsdelen nollas, auditrad
    `time_entry.moved_project`) och godkänner sedan. `ignorerad` går alltid.
  - **Batchen är allt eller inget.** Faller en rad rullas hela anropet
    tillbaka. Ett tyst överhopp hade lämnat kön till synes tömd med en post
    kvar — samma familj som julifelet.
- **Gallring av `reasoning` (KRAV-10):** motiveringen nollställs i SAMMA
  transaktion som posten blir `fakturerad` (`lasTidposterTillFaktura`), och för
  `ignorerad`-poster äldre än **90 dagar** via `purge_crm_data`, som nu också
  svarar `time_entry_reasoning_cleared`. `source_ref` behålls som spår.
- **Vysidan `/app/c/:companyId/tid/forslag`** (menyposten *Tidsförslag*):
  förslagen grupperade per dag, nyaste dagen överst, äldre ligger kvar — ingen
  ålderströskel, inget förfallodatum. Rubriken (och bara den) visar antalet
  obehandlade dagar. Per rad: uppdrag och avtalsdel som `select`, registrerad
  tid → debiterbar tid, beskrivning, `source_ref` + `reasoning` bakom en
  `details`, osäkerhetsmarkering och knapparna **Godkänn · Justera · Faktureras
  ej · Byt avtalsdel** i ETT formulär, så att ett uppdragsbyte och ett
  godkännande blir ett enda anrop utan sidbyte. *Godkänn hela dagen* finns per
  dag, är aldrig förvald, kräver sitt eget bekräftande klick och räknar bara de
  poster som verkligen går igenom — resten står kvar med sitt villkor utskrivet
  på raden. Villkoret gäller **godkännandet**: *Faktureras ej* går igenom även
  utan vald avtalsdel (orsak krävs som förut). Kön grindar aldrig fakturan.
