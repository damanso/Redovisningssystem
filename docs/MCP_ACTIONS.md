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

En action kan dessutom ha det valfria fältet `kravManniska: true`, som betyder att
bara en människa får köra den: ett agent-anrop avvisas i `executeAction` med
`403 human_required` innan något skrivs (till skillnad från `sensitive`, som köar
begäran för godkännande). Uppdragsytans mänskliga beslut och bedömningar använder fältet,
och sedan Davids beslut 26/11 även `approve_time_entries`. Samma beslut stänger
statusbytet i `update_time_entry` för agenter, men där i tjänsten och inte med
fältet, eftersom Hermes kompletterar sina förslag med den åtgärden.

Alla actions kör mot kärnans tjänster med samma serverpåtvingade regler: tenant
härleds från medlemskap (RLS), verifikat är oföränderliga, allt auditloggas.

## HTTP (och MCP-mappning)

| MCP-koncept | HTTP-endpoint |
|---|---|
| lista verktyg (`tools/list`) | `GET /api/companies/:companyId/actions` (manifest) |
| anropa verktyg (`tools/call`) | `POST /api/companies/:companyId/actions/:action` |
| godkännandekö | `GET /api/companies/:companyId/approvals` (varje köpost bär `ersatt_av`, Story 1.15: en `rejected` med `ersatt_av` är en ersatt post och inget nej) |
| godkänn / avslå | `POST .../approvals/:id/approve` \| `.../reject` (`reason` blir skälet för en åtgärd med `tvafas`; 202 när beslutet är mottaget men inte verkställt; köposten i svaret bär `ersatt_av`) |
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
- **Bokföringen har en brytpunkt: perioden `2026-09`** (LOC-355,
  `GROSS_METHOD_FROM_PERIOD` i `server/src/services/payroll.ts`). Perioden
  avgör metoden — utbetalningsdatumet gör det inte, och redan bokförda
  verifikat räknas aldrig om (mars–augusti 2026 är rättade en gång för hand
  via A53+A54).
  - **Från och med 2026-09 — bruttometoden.** `book_payslip` (sensitive)
    bokför HELA lönen i ett verifikat på utbetalningsdatumet:
    **7010 D** brutto · **7510 D** arbetsgivaravgift · **2710 K** avdragen
    skatt · **2731 K** arbetsgivaravgift · **1930 K** netto. Verifikatet
    balanserar per konstruktion (netto = brutto − skatt) och löneskulden
    ligger kvar i balansräkningen tills den betalas — det är hela poängen:
    utan skuldraderna saknades skulden vid ett bokslut (K2-fel).
    `book_payroll_tax` (sensitive) **tömmer exakt de kontona**: **2710 D** =
    periodens summerade `tax_ore` · **2731 D** = summerade
    `employer_contribution_ore` · **1930 K** = betalt belopp. Skattekontot
    betalas i hela kronor medan skulderna står i ören, så mellanskillnaden
    bokas mot **3740** (öres- och kronutjämning) — en öresrest hamnar aldrig
    på ett skuldkonto. Efter de två stegen är saldot på 2710 och 2731 exakt 0.
  - **Före 2026-09 — kontantmetoden, oförändrad.** `book_payslip`: 7010 D /
    1930 K = verkligt netto på utbetalningsdatumet. `book_payroll_tax`:
    2510 D / 1930 K = skatt + arbetsgivaravgift. 2510 används inte alls för
    perioder från brytpunkten.
  - Gemensamt för båda: beloppet på `book_payroll_tax` föreslås ur periodens
    lönebesked avrundat till hela kronor (`amount_ore` kan ange annat), och
    default för `payment_date` är den 12:e månaden efter med bankdagsregeln.
    Kontot 2731 (Avräkning lagstadgade sociala avgifter) läggs till i
    standardkontoplanen av migration `0067`.
  - **Dubbelbokningsspärren (FR-37, AD-14).** En andra `book_payroll_tax`
    för en period som redan har en rad i `payroll_tax_payments` avvisas vid
    godkännandet med 409 `already_booked` («skattebetalningen för perioden är
    redan bokförd»). Det sker före varje verifikat, också om räkenskapsåret
    har låsts efteråt. Förslaget står kvar som väntande, felet syns som notis
    på Att göra, och förslaget avvisas för hand. Två samtidiga godkännanden
    ger exakt en betalning: tjänsten tar ett transaktionslås per bolag och
    period före uppslaget, och det unika villkoret
    `payroll_tax_payments_period_uk` är sista linjen.
- `payroll_year_summary` (read) ger ackumulerat per kalenderår.
  `generate_payslip_pdf` (write) skapar lönespecifikationen enligt Locollabs
  mall och bilägger den på lönebeskedet. Specen bär blocket «Ackumulerat {år}»
  med bruttolön, skatt, nettolön, arbetsgivaravgift och semesterersättning för
  den anställdas lönebesked i kalenderåret till och med specens period.
  Beloppen räknas av samma funktion som `payroll_year_summary`, så att de två
  aldrig skiljer sig (FR-16).

### Dokument (K3)

- `attach_document` (write) — filnamn + base64 (pdf/png/jpg, max 10 MB) +
  koppling till payslip/faktura/kvitto/leverantörsfaktura/verifikat. Samma
  validering som uppladdning (ändelse + magic bytes, UUID-namn utanför
  webroten). En fil över 10 MB ger 400 `too_large`. Åtgärdsrutten tar emot
  en kompakt JSON-kropp upp till base64-storleken av 10 MB plus 16 KiB för
  kuvertet (`ATTACH_DOCUMENT_BODY_LIMIT_BYTES`, räknad ur
  `MAX_DOCUMENT_BYTES`), en större kropp ger 413, och den gränsen gäller
  först efter inloggning och bolagsåtkomst; alla andra rutter har kvar 1 MB
  för JSON (FR-18, AD-10).
- `list_documents` / `get_document` (read; `include_content` returnerar
  innehållet som base64). Webbvyn visar bilagor på raden och Dokument-flikens
  uppladdning kan koppla direkt.

### Reskontra-baklänkning och momsmetod (K6)

- `link_voucher` (write) — kopplar en befintlig registerpost till ett
  BEFINTLIGT verifikat (t.ex. importserien) utan att bokföra något nytt;
  status (bokförd) härleds ur länken. `mark_paid: true` avvisas med 400
  `payment_requires_approval` och `details.use_action: 'link_voucher_and_mark_paid'`.
  Betalmarkering är Davids bekräftelse (K5) och går genom kön.
- `unlink_voucher` (write) — ångrar en baklänkning (motsatsen till
  `link_voucher`). Bokför/raderar INGENTING — verifikatet står orört och
  posten återgår till utkastläge. Spärr: bara kopplingar som skapades via
  `link_voucher` kan ångras (verifieras mot auditloggen); verifikat skapade
  genom bokning rättas via rättelseverifikat. Avsedd för Ethos-rättelsen
  13–18: unlink fel koppling → link rätt verifikat. En kund- eller
  leverantörsfaktura med `paid_amount_ore` större än 0 avvisas med 409
  `payment_requires_approval` och `details.use_action: 'unlink_voucher_and_reset_payment'`.
- `suggest_voucher_links` (read) — halvautomatiska matchningsförslag
  (belopp + datum + text, poängsatta med skäl) som människan bekräftar per
  rad via `link_voucher`.
- `set_vat_method` (write) — faktura-/kontantmetod som bolagsinställning.
  Momsmetodvakten varnar (notis + audit, blockerar inte) när ett nytt
  verifikat bryter mot metoden; SIE-import och rättelser undantas.
- `vat_declaration` (read) — momsdeklarationens uppställning med rutorna
  05–49 för perioden `from`–`to`, ett beräknat underlag ur momskontona och
  ett fåtal försäljningskonton. Rutorna 06–08, 20–24, 37–38 och 40 räknas ur
  bolagets kontolista för momsrutorna (`set_vat_box_accounts`); ett konto i
  listan räknas i exakt en ruta och lämnar de fasta intervallen, och
  `box_accounts` visar listan. Utan kontolista räknas rutorna som förut, och
  utan konto i listan för rutorna 20–24 ligger det omvända underlaget som
  förut i ruta 21. `warnings` bär kompletthetsvaktens varning när ruta 48 är
  0 trots inköp på konton 5000–6999, oavsett belopp och med beloppet, och
  varningen när underlaget i ruta 20–24 inte stämmer med momsen i ruta
  30–32; varningarna stoppar ingenting (FR-19).
- `set_vat_box_accounts` (sensitive) — ersätter bolagets kontolista för
  momsrutorna: `accounts` är en lista med `account_number` och `box` (06,
  07, 08, 20–24, 37, 38 eller 40). Köas för mänskligt godkännande; varje
  konto ska finnas i bolagets kontoplan (`unknown_account` vid
  godkännandet), ett konto får stå en gång och momskonton 2600–2699
  avvisas. En tom lista tar bort listan. Auditloggas som
  `tax.vat_box_accounts_set` (FR-19).
- `accounts_payable_aging` (read) — leverantörsreskontran med åldersanalys
  per leverantör. Med `as_of` visar den vad bolaget var skyldigt den dagen:
  en leverantörsfaktura ingår när dess verifikat (bokföringen eller
  baklänkningen) är daterat senast `as_of`, och en betalning räknas från
  betalningsverifikatets datum, så en faktura som betalats efter `as_of`
  står med det som återstod den dagen. En betalmarkering via baklänkning
  räknas från det kopplade verifikatets datum. Åldern räknas från
  förfallodagen till `as_of`. Utan `as_of` räknas reskontran mot dagens
  datum med fakturornas betalda belopp som de står i dag (FR-29).

#### link_voucher_and_mark_paid

Åtgärden är `sensitive` och köas för en människas godkännande (202).
Ingenting ändras före godkännandet. Indata: `entity_type` (`invoice` eller
`supplier_invoice`), `entity_id` och `voucher_id` till ett befintligt verifikat.
Efter godkännandet är fakturan kopplad, har status `paid` och
`paid_amount_ore` lika med `total_ore`. Auditraden `<typ>.voucher_linked`
bär `mark_paid: true`. Vanliga skrivåtgärden `link_voucher` hänvisar hit med
400 `payment_requires_approval` och `details.use_action` när betalmarkering
begärs. Inget verifikat skapas eller raderas.

#### unlink_voucher_and_reset_payment

Åtgärden är `sensitive` och köas för en människas godkännande (202).
Ingenting ändras före godkännandet. Indata: `entity_type` (`invoice` eller
`supplier_invoice`) och `entity_id`. Efter godkännandet är `voucher_id` NULL,
status `draft` och `paid_amount_ore` 0, med auditraden `<typ>.voucher_unlinked`.
Vanliga skrivåtgärden `unlink_voucher` hänvisar hit med 409
`payment_requires_approval` och `details.use_action` för en betalmarkerad
faktura. En koppling som inte gjorts via `link_voucher` avvisas vid
godkännandet med 409 `not_unlinkable`; fakturan är oförändrad och förslaget
står kvar väntande. Inget verifikat skapas eller raderas.

### Kvittobilagor — tre steg, där steg 2 inte är ett MCP-anrop (beslut #178)

Underlaget bär avdraget: Skatteverket kräver originalkvittot. En kvittobild från
en telefon är ~1,3 MB, alltså ~1,7 miljoner tecken som base64 — det ryms inte i
ett verktygsargument. Därför går **bara metadata** genom MCP och bytesen direkt
till API:t:

1. `create_receipt_upload_url` (write) — `receipt_id`, `filename`, `mime_type`,
   `size_bytes` → `{ upload_url, file_id, expires_at }`. Signerad **engångs-PUT**,
   giltig 15 minuter. Tillåtet: `image/jpeg`, `image/png`, `image/heic`,
   `application/pdf`; tak 25 MB. Basen kommer ur `PUBLIC_API_URL` — saknas den
   ges ett tydligt fel, aldrig en localhost-URL som uppladdaren inte når.
2. **Utanför MCP:** `PUT <upload_url>` med filens råa bytes (t.ex. `curl -X PUT
   --data-binary @kvitto.jpg -H 'Content-Type: image/jpeg' "<upload_url>"`).
   Endpointen har ingen JWT — HMAC-signaturen i länken är behörigheten. Den
   prövar signatur, giltighetstid, mime, storlek och innehållets magic bytes,
   och vägrar både överskrivning och en återanvänd signatur.
3. `confirm_receipt_file` (write) — `file_id` (+ valfritt `ersatter_file_id`).
   Servern läser objektet, sparar `sha256` och aktiverar bilagan.

Läsvägen: `get_receipt_file_url` (write) ger en signerad GET med kort TTL (5
min) plus filnamn, mime-typ, storlek och sha256. `list_receipts` bär
`attachments`, `attachment_count` och `primary_attachment_id` per kvitto.

Lagringen: bilagorna ligger på lokal volym, och valet står uttryckligen i
`RECEIPT_STORAGE_DRIVER` (bara `lokal`; FR-15, Davids beslut 2026-10-16). Kan
lagringen inte användas svarar PUT, `confirm_receipt_file` och nedladdningen
503 `storage_unavailable` med `details.lagring` och `details.operation`. Efter
en sådan PUT eller bekräftelse förblir bilagan obekräftad och steget kan göras
om; en bilaga som redan är bekräftad förblir bekräftad när nedladdningen
svarar 503. Ett objekt som saknas ger 409 `object_missing` med
`details.lagring`, både vid bekräftelsen och vid nedladdningen, och ett objekt
som redan finns skrivs aldrig över (409 `object_exists`). Varje lagringsfel
ger också en rad i driftloggen med bara koder, aldrig lagringens sökväg.

Livscykeln: en bilaga får bifogas **både** före och efter `book_receipt`. På ett
BOKFÖRT kvitto är bilagan oföränderlig — den går varken att skriva över eller
radera (RLS-policy + trigger i migration 0075); en felaktig bilaga rättas genom
att ladda upp rätt och ange `ersatter_file_id`, varpå den gamla raden märks med
`superseded_by` och ligger kvar. `delete_draft_receipt` städar ett OBOKAT
utkasts bilagerader och objekt, om kvittot aldrig baklänkats (se Städning
(K7)). Varje bifogning auditloggas
(`receipt.file_attached`) med sha256, uppladdare och tid, i samma transaktion
som mutationen. Påbörjade men aldrig bekräftade uppladdningar städas lazily i
tjänstens egna anrop — redovisningen har ingen scheduler.

`receipts.file_id` är oförändrad och tillhör den äldre multipart-vägen
(`POST .../receipts/:id/file` → `files`); den primära bilagan **härleds** ur
`receipt_files` i stället för att dupliceras.

### Städning (K7)

`delete_draft_invoice` / `delete_draft_receipt` /
`delete_draft_supplier_invoice` / `delete_draft_payslip` (write) — raderar
OBOKADE utkast (RLS-policyn släpper aldrig igenom bokförda poster).
Auditloggas med snapshot; dokumentkopplingar städas, bilagda filer behålls.

En post som någon gång kopplats via `link_voucher` (händelsen
`<typ>.voucher_linked` i revisionsloggen) raderas aldrig, inte heller efter
`unlink_voucher` — den har nått huvudboken (FR-41). Båda avvisningarna ger 409
`not_deletable` med `details.reason` (`not_a_draft` för en bokförd post eller
en post som inte längre är ett utkast, `previously_linked` för en en gång
baklänkad post) och `details.use_action: 'reverse_voucher'`: rättelse sker via
rättelseverifikat. RLS-policyn i 0041 är den hårda garantin för bokförda
poster; spärren för tidigare baklänkade poster bor i tjänsten, under radlås
(AD-12), eftersom historiken bara finns i revisionsloggen.

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
- Samtidighet (FR-6): räknarflytten, kundnummertilldelningen och
  fakturaskapandet tar samma radlås på räknaren. Två samtidiga godkännanden,
  eller ett godkännande och ett fakturaskapande, läser därför aldrig samma
  gamla värde.
- `set_invoice_number_series` som skulle flytta räknaren bakåt avvisas vid
  godkännandet med 409 `series_cannot_move_backwards`, och ett nummer som
  redan är utställt avvisas med 409 `number_already_in_use`.
- `set_external_invoice_numbers` avvisar vid godkännandet, före första
  skrivningen, ett nummer som redan visas på en faktura i bolaget utanför
  batchen, med 409 `number_already_in_use`. Ett nummer får flytta mellan
  fakturor i samma batch, och ett nummer i ett annat bolag räknas inte.
- Ett avvisat godkännande rullas tillbaka helt. Förslaget står kvar som
  väntande, felet syns som notis på Att göra, och förslaget avvisas för hand
  (LOC-263).
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
- Ett anrop som inte når kärnan (anslutningen vägras, inget svar inom 60 s,
  eller svaret stannar eller bryts mitt i) ger felet
  «Kunde inte nå kärnan på {adress}: {orsak} — kör self_check» (FR-28). Ett
  HTTP-fel med kropp återges som «Fel (HTTP {status}): {kropp}».

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
  **En agent får bara komplettera ett förslag (Davids beslut 26/11).** Åtgärden
  saknar `kravManniska`, för Hermes kompletterar sina förslag här (Story 10.2).
  Tjänsten (`updateTimeEntry`) ger däremot en agent **403 `human_required`** när
  anropet byter status (även `forslag → godkand`) eller rör en post som inte är
  `forslag`, till exempel minuterna på godkänd tid. Bytena ovan gäller alltså
  bara en människa. Agentens anrop som stannar på `forslag` går som förut.
  Spärren prövas efter `expected` (se nedan) och före första skrivningen, så
  ingenting skrivs, inte heller någon auditrad.
  **Debiterbar tid skrivs aldrig tyst:** ändras `minutes` utan att
  `billable_minutes` skickas lämnas de debiterbara orörda, och skiljer de sig
  därefter måste posten uttryckligen sättas till `justerad` med skäl (400
  `adjustment_required`).
  - **Skydd vid komplettering:** valfritt `expected` bär postens fyra lästa
    värden: `{minutes, billable_minutes, adjustment_reason, status}`. Alla fyra
    krävs och inga andra nycklar får finnas (400 `validation_error`). Minuterna
    är heltal 0–1440, skälet text högst 300 tecken eller `null`, och statusen en
    av statusarna ovan. `adjustment_reason: null` är ett eget värde.
    Ordningen är först 409 `time_entry_locked` för fakturerad tid, sedan 409
    `time_entry_changed` om något värde skiljer sig från raden låst med
    `SELECT … FOR UPDATE`, sedan 403 `human_required` för en agent, sedan
    `invalid_status_transition` och övriga regler.
    Vid `time_entry_changed` skrivs ingenting, inte heller någon auditrad.
    Utan `expected` görs ingen jämförelse. `work_date`, `duration`,
    `description` och `contract_part_id` jämförs inte. Vyn skickar aldrig
    fältet; Hermes komplettering av obeslutade tidsförslag skickar postens
    listade värden (Story 10.2).
- `list_time_entries` (read) — filter `project_id`, `status`, `from`, `to`,
  `actor` (aktören som utförde arbetet); returnerar bl.a. `minutes`,
  `billable_minutes`, `status`, `source`, `source_ref`, `invoice_id`,
  `duration_hhmm`/`billable_duration_hhmm` (samma tal i hh:mm) och `links[]`
  (underlagslänkarna, se story 5 nedan), samt ärendekopplingen `arende_id`,
  `arende_nyckel` (fryst läsbar nyckel, t.ex. `LOC-316`) och `arende_kalla`.
  Kopplingen läses ur posten utan uppslag i ärendeplattformen (FR-24).
  Sedan 0078 kräver schemat nyckel och källa när ett ärende-id finns;
  båda måste vara satta och innehålla minst ett tecken som inte är blanktecken.
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
- `las_faktureringsunderlag` (read) — `project_id`. Faktureringsunderlaget ur
  leverabelregistret (Uppdragsytan FR-12, Story 4.4): per avtal i uppdraget
  listas bara leverabler i läget godkänd. En levererad leverabel är inte
  fakturerbar förrän godkännandet är registrerat. Varje rad bär kod, namn,
  acceptanskriterium, revision, överlämningsdatum och godkännandet (dag, kanal,
  mottagare ur händelsen), med källan registret. Varje avtals underlag bär
  läsningens lästid. Ett godkänt läge utan registrerat godkännande visas som
  ”Godkännandet saknas i historiken”, aldrig med ett påhittat datum.
  Läsningen skriver ingenting, skapar ingen faktura och bär inga belopp eller
  timmar. Modulen fakturerar aldrig; fakturan skapas med
  `create_invoice_from_time` av en människa och betalning registreras bara
  genom kön (K5). Fel: 404 för ett projekt utanför bolaget.
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
- `update_contract` (sensitive) — `contract_id` + samma fält. Köas för mänskligt
  godkännande. Baselineburna fält, bland annat `hourly_rate_ore`, ger **409
  `kraver_ny_version` före kön**, utan mutation. Gamla köposter prövas igen vid
  godkännandet. Namn, anteckning, kund och betalningsvillkor ändras som förut.
- `upsert_contract_part` (sensitive) — `contract_id`, `code` (t.ex. `2A`), `name`
  (krävs för varje ny version), valfria `description`, `parent_part_id`,
  `billable`, `hourly_rate_ore`, `cap_hours`, `cap_amount_ore`, `cap_confirmed`
  (default **false**), `valid_from` (utelämnad = avtalets `signed_date`; saknas
  det: 400 `valid_from_required`), `sort_order`, `active`, `change_reason`,
  `start_date`, `end_date`, `date_precision`. En ny rad skrivs genom
  `skrivBaselineversion`; samma (avtal, kod, `valid_from`) som en lagrad rad
  ger **409 `version_finns` vid godkännandet**. `change_reason` krävs med minst
  fem tecken efter trimning, också för en ny kod: annars **400
  `validation_error` före kön**. Undantaget är ren bekräftelse: bara
  `contract_id`, `code`, valfritt `valid_from` och `cap_confirmed: true`.
  `bekraftaTak` ändrar då bara bekräftelsen framåt och skriver
  `contract_part.confirmed`; redan bekräftat är en tyst no-op utan auditrad.
  `manually_edited` sätts vid INSERT, aldrig efteråt. En leverabelkod (`L1`–`L99`,
  parserns `LEVERABELKOD`) med `start_date`, `end_date` eller `date_precision`
  ger **400 `validation_error` före kön** (Story 2.2, FR-1): ett eget
  leverabeldatum sätts bara med `andra_baseline`.
- `list_contracts` (read) — filter `project_id`, `contract_id`. Varje avtal bär
  `parts` med förbrukning per del.
- `get_contract_usage` (read) — `contract_id`. Per del: `billable_minutes` och
  `amount_ore` ur poster med status `godkand`/`justerad`/`fakturerad` (ett
  `forslag` räknas inte — AI:ts gissning ska inte larma om ett avtalstak),
  `own_billable_minutes` (utan barnens), `cap_hours`/`cap_amount_ore`,
  `cap_status`, `share` och `versions`. **Föräldradelens förbrukning är summan
  över barnens**; saknar föräldern eget tak härleds det ur barnens
  (`cap_derived: true`) och är bekräftat bara om varje ingående tak är det.
  `versions` är baselinens versionshistorik: varje lagrad version av koden
  med `id`, `valid_from`, `change_reason`, `start_date`, `end_date` och
  `date_precision` (Story 2.2), taken, `cap_confirmed`, `manually_edited` och
  `active`. Ingen version skrivs över (B-7), så alla står kvar.
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
  via `createContract`/`skrivBaselineversion`; faller en del skapas ingenting.
  - `parent_code` slås upp mot koderna i samma anrop (föräldern skapas först);
    en kod utan motsvarighet ger 400 `unknown_parent_code`. Samma kod två gånger
    ger 400 `duplicate_part_code`.
  - Finns faser krävs `signed_date` (400 `signed_date_required`) — delarnas
    `valid_from` hämtas därifrån.
  - **`manually_edited = true` sätts på exakt de delar där det inskickade värdet
    avviker från utkastet** (namn, beskrivning, förälder, de två taken). En del
    utan motsvarighet i utkastet — eller ett formulär utan utkast alls — räknas
    som ändrad. Flaggan sätts redan i den enda INSERT-satsen, eftersom en
    lagrad rad aldrig ändras. `contract_part.created` är delens auditrad och
    `contract.created_from_draft` räknar upp de manuellt ändrade koderna.
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
- `approve_time_entries` (write, **`kravManniska: true`**, bara en människa) —
  `ids[]` (max 500), valfria `status`
  (`godkand`|`justerad`|`ignorerad`, default `godkand`) och
  `adjustment_reason` som gäller hela batchen, samt `per_id[]` med
  `{id, status?, billable_minutes?, adjustment_reason?, contract_part_id?,
  project_id?}` för raderna som avviker. Svar:
  `{processed, godkand, justerad, ignorerad, moved}`.
  - **Kräver en människa (Davids beslut 26/11).** Godkänd tid är det som
    faktureras. Ett agentanrop med giltigt indata, till exempel från Hermes
    MCP-nyckel, ger **403 `human_required`** i `executeAction` före varje
    skrivning. Ogiltigt indata ger 400 `validation_error` först, eftersom
    schemat prövas före spärren, som för övriga åtgärder med `kravManniska`.
    Spärren gäller alla tre statusarna. Den ger ingen köpost, ingen auditrad
    och ingen statusändring, så posten står kvar som `forslag`. Den andra vägen
    till samma statusbyte, `update_time_entry`, är stängd för agenter i
    tjänsten (se ovan). Tjänsten får också aktören från åtgärden, så den
    spärren gäller även här. Hermes föreslår tid med `propose_time_entries`,
    som saknar spärren, och David godkänner den i vyn under *Tidsförslag* eller
    med sin egen inloggning. MCP-verktygslistan visar ännu inte att åtgärden
    kräver en människa (`requires_approval` gäller bara `sensitive`). Agenten
    får veta det först när den får 403. Det gäller alla åtgärder med
    `kravManniska`.
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

## CRM: privat och företag (beställning 9/11, steg 1–3)

Davids order 9/11: allt han ska göra, som företagsledare och som privatperson,
i samma CRM. Varje organisation, person och åtagande hör till en **sfär**,
`foretag` eller `privat` (migration `0087_crm_sfar_och_roll.sql`). Alla rader som
fanns före migrationen är `foretag`. Steg 1 är data och MCP. Steg 2 stänger
granskningens fynd (personvägen, migration 0088) och lägger märkningen och
filterknapparna i vyn. Steg 3 gör gränsen färdig (en privat person ligger aldrig
hos en kund, migration 0089), lägger till `set_crm_sfar`, «Privat (<förnamn>)» och
migreringslistan (se *Steg 3* sist i avsnittet).

**Läsverktygen** tar `sfar: 'privat' | 'foretag' | 'alla'`, standard `alla`. Ett
anrop utan `sfar` ger samma rader som förut; svaren har fått fälten `sfar` (och
`roll` där organisationen visas).

| Verktyg | Vad filtret gäller |
|---|---|
| `list_crm_organizations` | organisationens sfär (kombineras med `status`) |
| `list_crm_commitments` | åtagandets egen sfär |
| `search_crm` | relationer och personer efter sin sfär; kund- och leverantörsregistret är bokföringens och alltid `foretag` |
| `crm_today` | båda högarna, FÖRE kapet: relationerna på organisationens sfär, löftena på sin egen |
| `get_party_crm` | parten är en kund eller leverantör och alltid `foretag`; `privat` ger samma form med tomma listor (`{sfar:'foretag', contacts:[], notes:[], tags:[]}`), en okänd part är fortfarande 404 |

**Skrivverktygen:**
- `upsert_crm_organization` tar `sfar` och `roll`
  (`kund | leverantor | partner | myndighet | intern`, valfri, skild från
  `status`). Utelämnad sfär: en ny rad blir `foretag`, en befintlig behåller sin.
  En privat organisation kräver **bara namn**, och slås aldrig upp mot
  kundregistret, inte ens om en kund heter likadant. Rollen kan bytas men inte
  nollas i steg 1.
- `upsert_crm_person` tar `sfar`. Utelämnad: ny person `foretag`, befintlig oförändrad.
- `record_crm_commitment` tar `sfar`. Utelämnad **ärver** ett nytt åtagande sin
  organisations sfär, annars personens, annars `foretag`; organisationen går före
  personen när de skiljer sig. Arvet sker när raden skrivs. Samma källa igen
  (`source_system` + `source_ref`) utan `sfar` behåller åtagandets sfär. Byter en
  organisation sfär senare följer redan skrivna åtaganden inte med.
- Sfär och roll bär ursprung som övriga fält (F4): en agent kan inte flytta en
  rad som en människa satt sfär på; fältet redovisas i `kept_human_fields`.
- **Sedan rättningsvarv 3b** byter en agent inte sfär eller roll på en
  **befintlig** post med de här verktygen alls: `upsert_crm_organization` (sfär
  eller roll), `upsert_crm_person` (sfär) och `record_crm_commitment` med samma
  källa igen och en annan `sfar` svarar 409 `byt_med_set_crm_sfar` med
  `details.atgard = 'set_crm_sfar'` och `details.skal`, och ingenting skrivs. Bytet
  görs med `set_crm_sfar`, som lägger det i Att göra (nedan). En **ny** post som
  privat går som förut, liksom samma sfär igen och en människas byte.
- `ingest_crm_events` tar ingen sfär. En händelse som träffar en privat
  organisation lämnar den privat och okopplad (den står i `unlinked_organizations`).

**Bokföringsgränsen.** En privat post når aldrig Locollabs bokföring. Relationsdatans
enda väg dit är kopplingen `crm.organizations.customer_id` mot kundregistret (kundkortet
läser åtagandena genom den), och den är stängd för det privata:

| Försök | Svar |
|---|---|
| privat organisation med `customer_id`, eller kundkopplad organisation till `privat` | 400 `privat_bokforingsgrans`, `details.regel = privat_organisation_kundkoppling` |
| privat organisation med `status: 'customer'` | 400 `privat_bokforingsgrans`, `details.regel = privat_organisation_kundstatus` |
| privat åtagande på en kundkopplad organisation (nytt eller flyttat) | 400 `privat_bokforingsgrans`, `details.regel = privat_atagande_kundkopplad_organisation` |
| privat åtagande på en **person** hos en kundkopplad organisation, med eller utan egen organisation (nytt eller flyttat; steg 2) | 400 `privat_bokforingsgrans`, `details.regel = privat_atagande_kundkopplad_person` |
| `customer_id` på en organisation med privata åtaganden, direkt eller på någon av dess personer | 400 `privat_bokforingsgrans`, `details.regel = privata_ataganden_kundkoppling` |
| `upsert_crm_person` som flyttar en person med privata åtaganden till en kundkopplad organisation (steg 2) | 400 `privat_bokforingsgrans`, `details.regel = privata_ataganden_kundkoppling` |
| `merge_crm_organizations` mellan privat och företag | 400 `sfar_conflict` vid godkännandet |
| `merge_crm_organizations` där resultatet blir kundkopplat med privata åtaganden, direkt eller via personerna | 400 `privat_bokforingsgrans` vid godkännandet |
| `merge_crm_people` mellan en privat och en företagsperson (steg 2) | 400 `sfar_conflict` vid godkännandet |
| `merge_crm_people` där den kvarvarande personen hamnar på en kundkopplad organisation med privata åtaganden (steg 2) | 400 `privat_bokforingsgrans` vid godkännandet |
| privat person på en kundkopplad organisation: ny, flyttad eller företagsperson hos kunden som byter till `privat` (steg 3) | 400 `privat_bokforingsgrans`, `details.regel = privat_person_kundkopplad_organisation` |
| kontaktpunkt eller åtagande (oavsett sfär) som bär en kundkopplad organisation och en privat person, och en person med sådana poster som byter till `privat` (steg 3) | 400 `privat_bokforingsgrans`, `details.regel = privat_person_kundkopplad_post` |
| `customer_id` på en organisation med privata personer, eller med poster som bär en privat person; `merge_crm_organizations` med samma utfall (steg 3) | 400 `privat_bokforingsgrans`, `details.regel = privat_person_kundkoppling` |

`details.skal` säger i klartext vad som slog till och vad man gör i stället
(meddelandet i övrigt stannar på servern). Synken fälls aldrig av gränsen: en
organisation med privata åtaganden kopplas helt enkelt inte och redovisas som okopplad.
En händelse som skulle flytta en person med privata åtaganden till en kundkopplad
organisation hoppas över och står i `skipped` med skälet; resten av batchen går igenom.
Databasen bär samma spärrar: CHECK-villkoret
`organizations_privat_utanfor_bokforingen_ck` och triggern
`crm.privat_utanfor_bokforingen()` på organisationer, åtaganden, personer (sedan
0088) och kontaktpunkter (sedan 0089) (P0001, 409 `rule_violation`). Triggern låser de rader den läser med
`FOR SHARE`, så att två samtidiga skrivningar inte tillsammans kan öppna vägen.

**Varför personen räknas (steg 2, migration `0088_crm_privat_via_personen.sql`).**
Kundrelationens kronologi (`get_crm_thread`) och GDPR-raderingen läser åtagandena
också via organisationens personer. Ett privat åtagande på en person hos kunden
hamnade därför bredvid kundens fakturor och betalningar, fast det inte bar
kundens organisation. Regeln är nu: ett privat åtagande ligger aldrig på en
kundkopplad organisation, varken direkt eller via sin person.

**Privata personer på en kundkopplad organisation** var tillåtna i steg 2 och är
förbjudna sedan steg 3 (leads beslut 18/11, migration 0089): se tabellen ovan.
Kundkortets filter mot privata personer står kvar som ett andra skydd.

**Proven.** `server/test/crm-sfar.test.ts`: B (gränsen), V (personvägen i tjänsten,
databasen och under samtidiga skrivningar) och S1, ett svep över varje tabell i
schemat `public` efter varje id som är privat när svepet körs. Påståendet som svepet
bär: *inget privat id finns i någon tabell i `public`, utom i godkännandekön
(`action_approvals`), och där bara i en begärd sammanslagning av CRM-poster
(`merge_crm_organizations`, `merge_crm_people`) eller, sedan rättningsvarv 3b, i en
agents begärda sfärbyte (`set_crm_sfar`, som bara bär id:n och låsta värden)*. Kön är Att göra, inte
räkenskapsinformation: inget verifikat, ingen faktura, rapport, momsunderlag,
K2-del eller export läser dess indata. SIE-exporten prövas separat (B9). B8 fäller
om en främmande nyckel mellan `crm` och bokföringen tillkommer.

**`crm_today` (steg 2).** En relations skäl räknar och citerar bara löften i
relationens egen sfär, med eller utan filter. Ett privat löfte på en
företagsorganisation står alltså inte som «vi lovade: …» under ett kort märkt
`foretag`; det står i löfteshögen med `sfar: 'privat'`. Varje kort i båda
högarna bär `sfar`, så att briefen kan skilja dem. `crm_relation_state`,
`crm_silence_report` och `crm_contact_suggestions` räknar som förut (alla löften
på organisationen).

**Auditloggen (steg 2).** `crm.organization_created` och `crm.organization_updated`
bär `sfar` och `roll`; `crm.person_created` och `crm.person_updated` bär `sfar`.
Båda är låsta värden, aldrig fritext.

**Vyn (steg 2).** Åtaganden (`/app/c/:id/commitments`) och Min sida
(`/app/c/:id/min-sida`) märker varje åtagande Privat eller Företag och har
filtret Alla / Företag / Privat (`?sfar=foretag|privat`, utelämnat = alla). På
Åtaganden kombineras det med statusen (`?status=open|done|dropped`); den valda
knappen i varje rad är ifylld (`btn--primary`) och bär `aria-current="page"`, och
varje länk behåller det andra filtret. Min sida kombinerar sfären med
organisationsfiltret på samma sätt (`.on` och `aria-current`).

**Kundkortet (steg 2).** Knappen *Inaktivera kund* / *Aktivera kund* sätter
`is_active` via `update_customer` (samma allowlista och revisionsspår,
`customer.updated` med `fields: ['is_active']`). En inaktiv kund erbjuds inte när
en faktura eller ett projekt skapas och står inte i `list_customers` utan
`include_inactive`; bokförda fakturor, reskontran och momsrapporten påverkas inte.
Sedan steg 3 visas knappen *Aktivera kund* inte för en kund som raderats enligt
GDPR, och `update_customer` / `update_supplier` med `is_active: true` för en part
med `gdpr.party_anonymized` i auditloggen svarar 409 `gdpr_raderad`.

### Steg 3: byta sfär, «Privat (<förnamn>)» och migreringslistan

**`set_crm_sfar`** (write). Exakt en av `organization_id`, `person_id` och
`commitment_id`, och `sfar: 'foretag' | 'privat'`. För en organisation finns
`cascade_open_commitments: true`: då följer organisationens **öppna** åtaganden
med. Utelämnad eller `false` betyder att åtagandena stannar i sin sfär. Klara och
avskrivna åtaganden rörs aldrig, varken av kaskaden eller direkt (ett klart eller
avskrivet åtagande ger 400 `atagandet_ar_stangt`); kaskaden låser de valda
åtagandena och prövar dem igen, så ett som stängs under tiden står kvar (3b). För en
organisation finns också `roll` (sedan 3b): rollen byts i samma beslut, utelämnad
= oförändrad. Bytet prövas mot hela gränsen ovan och vägras med samma
`privat_bokforingsgrans` och `details.regel`. En sfär eller roll som en människa
bestämt (ursprung `human`) byts inte av en agent: 409 `manniskans_beslut`. Svaret:
`{ mal, id, sfar_fran, sfar, andrad, foljde_med }`. Auditraden `crm.sfar_set`
(fran, till, cascade, foljde_med, source, och `roll: { fran, till }` när anropet
bar rollen) skrivs i samma transaktion, och bara när något ändrades. I vyn:
relationskortets *Rätta uppgifter* (sfär med kryssrutan *De öppna åtagandena följer
med*, och en rad per person och öppet åtagande), samma åtgärd som människa.

**En agents byte väntar på David (rättningsvarv 3b, krav 8).** När en agent anropar
`set_crm_sfar` och anropet skulle ändra sfären (eller rollen) på en befintlig post,
eller flytta något öppet åtagande, verkställs det inte: svaret är 202
`pending_approval` med köposten, och förslaget syns i Att göra med före → efter.
Posten är orörd tills en människa godkänner; då körs bytet som en människas beslut
(ursprung `human`, `crm.sfar_set` och `action.approved_executed`). Ett avvisat
förslag ändrar ingenting. Ett anrop som inte ändrar något körs direkt, och en
vägran (gränsen, `manniskans_beslut`) är fortfarande en vägran och köas inte. En
människa (vyn, en människas token) byter direkt som förut.

**«Privat (<förnamn>)»** är bolagets privata intern-organisation: sfär `privat`,
roll `intern`, status `partner`. Den känns igen på sfär och roll och skapas av
tjänsten första gången den behövs, inte av en migration: av
`record_crm_commitment` med `privat_intern: true` (i stället för `organization_id`,
i samma transaktion som åtagandet; snabbrutan på Min sida använder den, och där är
den förvald i Privat-läget) och av flytten nedan. Förnamnet är bolagsägarens
(den som blev ägare först). Heter redan en annan organisation så: 409
`privat_intern_namn_upptaget`, ingen gissning.

**`list_crm_privata_forslag`** (read). Förslaget på poster som ser privata ut,
räknat fram utan modellanrop, med skälet per rad: Svealands Elbolag (privat + roll
leverantör, öppna åtaganden följer med, den enda förkryssade raden),
organisationer utan kund- eller leverantörskoppling som anteckningen markerar som
privata (öppna åtaganden följer med), och öppna åtaganden under den interna
organisationen vars text pekar på hus, familj, hälsa eller privatekonomi (flyttas
till «Privat (<förnamn>)»). Svaret: `{ privat_intern: { id, namn }, rader: [{ nyckel,
slag, id, namn, organisation, regel, skal, forslag, oppna_ataganden, forkryssad,
hinder }] }`.

**Ingen åtgärd verkställer listan.** Flytten görs av David i vyn
(`/app/c/:id/relations/privata-forslag`, länkad från Relationer och Min sida): bara
kryssade rader, i en transaktion, med auditraden `crm.privat_flytt` per rad och ett
kvitto med en ångra-länk per rad. Vägen kräver en webbsession (ett agent-token når
aldrig vyns POST-vägar) och ägarrollen i bolaget. Ångra sätter tillbaka sfär, roll
och organisation enligt auditloggen, en gång, och bara om posten står som flytten
lämnade den. Ett åtagande som inte längre är öppet rörs inte av ångra (3b): de som
följde med en organisation och har stängts står kvar, och ett enskilt åtagande som
stängts ger 409 `atagandet_ar_stangt`. Ett fel på sidan och kvittot skickas som en
kod och en radnyckel i adressen (`?fel=forslaget_har_hinder&rad=atagande:<id>`),
aldrig som text; sidan ritar texten ur databasen.

**Dagsytan (steg 3).** En privat relation får aldrig skälen «ingen registrerad
kontakt alls» eller prospekt, i `crm_today` och `crm_contact_suggestions`; den kan
komma med för ett förfallet löfte eller för tystnad.

**`list_crm_commitments`** bär sedan steg 3 också `organization_roll` (rollen läses
ur organisationen). Min sida länkar ett privat ärende hos en organisation med roll
leverantör till hushållets budget på `/privat` (krav 9); inget kopieras dit.

## Uppdragsytan

Modulens första åtgärd (S1.3, våg 1) och stängningen av bakvägarna till
baselinen (S0.1, våg 2). Uppdragsytan är en **modul här** — ingen
egen tjänst, ingen fjärde databas. Den äger baselinen, leverabelregistret och
bedömningen; pengar, ärenden och filer läses ur sina källsystem och dupliceras
aldrig. Datalagret kom med migration **0068** (S1.1); det här är skrivvägen in
till baselinen.

**Varför den finns.** 0068 gav `contract_parts` en trigger,
`kraver_orsak_vid_ny_version()`, som kräver `change_reason` vid varje ny
version av samma (`contract_id`, `code`). Men `upsert_contract_part` hade inget
sådant fält — och därför kunde **ingen** skapa en ny version alls, inte ens
David med rätt skäl i huvudet. Ett tilläggsavtal fanns det ingen väg in för,
och ett tak som inte går att skriva in kan aldrig varna. Det är samma mening
som PRD §1 rad 6, ett varv senare.

**Fyra fält på `upsert_contract_part`** (åtgärden är `sensitive`). B-7 kräver
orsak för varje ny version, också en ny kod; periodfälten är valfria och blir
NULL när de inte skickas. Ren bekräftelse kräver ingen orsak:

- `change_reason` (text, ≤ 2000, minst fem tecken efter trimning) — varför
  just DEN HÄR versionen skrevs. Saknat skäl ger 400 före kön.
- `start_date` / `end_date` (ISO-datum) — avtalets period för delen.
- `date_precision` — `ar` | `halvar` | `kvartal` | `manad` | `dag`, exakt
  CHECK-villkorets värden i 0068. Avtalstexten skriver "hösten 2026" lika ofta
  som "2026-09-01"; precisionen finns för att en uppskattning aldrig ska läsas
  som ett åtagande på dagen. Ett värde utanför de fem ger 400
  `validation_error` (zod, före databasen).
- **Ett datum kräver sin precision (Story 2.1, FR-34).** `start_date` eller
  `end_date` utan `date_precision` ger 400 `validation_error` före kön
  (`kravPrecisionVidDatum` i `lib/avtalsdelsfalt.ts`). Samma regel gäller
  `andra_baseline` och `avgor_scopesignal`:s `tillagg`. Schemat bär den som
  andra försvarslinje: CHECK-villkoret `contract_parts_datum_kraver_precision`
  (migration 0085) fäller en rad med datum utan precision, också från en
  framtida skrivväg.

**`andra_baseline` (sensitive)** — "Ny baselineversion av en avtalsdel, med
orsak. Köas för godkännande." Samma fält som `upsert_contract_part`, men
`change_reason` (minst fem tecken efter trimning) och `valid_from` är
**obligatoriska**. Åtgärden går genom samma tjänstefunktion
(`skrivBaselineversion`) som `upsert_contract_part` använder för en ny version
— samma audit, samma triggrar, ingen egen SQL. En befintlig nyckel ger 409
`version_finns` före skrivningen; den gamla raden står alltid kvar. Ett
`start_date` eller `end_date` utan `date_precision` ger 400 `validation_error`
före kön, som för `upsert_contract_part` (Story 2.1, migration 0085).

- **Känslig av samma skäl som `book_invoice`:** en ändrad baseline flyttar vad
  kunden har lovats. Ett agentanrop svarar därför 202 `pending_approval` och
  skriver INGEN rad; posten hamnar i **Att göra** och exekveras först när en
  människa godkänt exakt det lagrade indatat. En agent kan aldrig godkänna sin
  egen begäran (403 `human_approval_required`).
- **Kraven är hela skillnaden.** En "ny version" utan eget `valid_from` vore en
  överskrivning av den befintliga raden, och en utan skäl vore en tyst sådan.
  Historiken består: den gamla raden ligger kvar, `get_contract_usage` visar
  den nya versionen från dess `valid_from` och summerar förbrukningen över
  alla versioner av koden.
- **`signal_id` (valfritt, S5.2, våg 4)** — scopesignalen tillägget kom ur.
  Bär posten den, sätts signalens `ledde_till_part_id` till den version
  (`contract_id`, `code`, `valid_from`) pekar ut — i SAMMA transaktion som
  godkännandet skriver raden, alltså aldrig före. Två kontroller före den
  skrivningen: signalen ska finnas i bolaget (annars **404 `not_found`**, som
  för ett grannbolags signal) och höra till samma avtal som tillägget (annars
  **400 `signal_annat_avtal`**). Faller någon av dem rullas hela godkännandet
  tillbaka — avtalsdelen skrivs då inte heller. Utelämnat fält = tillägget kom
  inte ur en fras någon sa, och ingenting länkas.
- **`kalla` (valfritt, Story 1.9)** — förslagets källreferens
  `{ typ: 'scopesignal', id }`. Med `kalla` krävs samma `signal_id`, annars
  **400 `validation_error`**. `avgor_scopesignal` sätter båda. Typen
  `anteckning` tillkommer med ILT-kedjan.

**Triggerfelen har ingen egen felkod.** P0001 ur
`kraver_orsak_vid_ny_version()` når klienten som **409 `rule_violation`** via
`errorHandler`, utan triggertext. Migration 0079 fryser innehåll och orsak
på varje lagrad rad, också obekräftade, och fäller varje DELETE. Bara
`cap_confirmed` från false till true och husets `updated_at` får ändras.
Tillåtelselistan fryser också framtida kolumner. INSERT av en andra version
utan orsak fälls som i 0068; action-schemat avvisar saknad orsak redan före
kön med 400 `validation_error`. Avtal utan projekt behåller 0068-regeln;
`contracts.project_id NOT NULL` gör den mängden tom i drift.

### Bakvägarna stängda (S0.1, våg 2)

`andra_baseline` var köad från dag ett — men taket gick att flytta BREDVID den
kön: `upsert_contract_part` och `update_contract` var `write` och kördes rakt
igenom, oavsett vem som anropade. En spärr som har en väg runt sig är ingen
spärr. Tre rader i registret, inget annat:

- **`upsert_contract_part` → `sensitive`.** Både agentens och människans anrop
  svarar nu 202 `pending_approval`; raden skrivs först vid godkännandet i **Att
  göra**. Kön (`action_approvals`) och auditraden `action.approval_requested`
  skrivs FÖRE godkännandet — det är spåret av att någon bad om ändringen, inte
  ändringen. Vid godkännandet kan 409 `version_finns`, `kraver_ny_version`
  eller triggerns `rule_violation` fälla skrivningen. Transaktionen rullas
  tillbaka och köposten står kvar som `pending`.
- **`update_contract` → `sensitive`.** Samma skäl: avtalets timtaxa och
  betalningsvillkor är vad kunden har lovats.
- **`set_project_status` → `kravManniska: true`** (känsligheten är oförändrad
  `write`). Ett avslut stänger ALL skrivning mot uppdraget, så det beslutet får
  en agent inte ens föreslå: agentanrop ger **403 `human_required`** utan
  köpost, utan auditrad och utan domänskrivning (S2.1-spärren i `executeAction`).

**Vyn är orörd.** Den har inget redigeringsformulär för avtalsdelar — avtal
skapas via `create_contract_from_draft`, som går direkt på tjänstelagret och
alltså inte påverkas. Skulle ett formulär ändå träffa en känslig åtgärd
redirectar vyns generiska `runFormAction` till `/app/c/:id/approvals` vid
`pending_approval`, precis som för kvitto- och fakturabokföring.
**`assign_contract_part` är oförändrat `write`:** klassificeringen av en tidpost
flyttar varken tak, belopp eller minuter, och tidvägen fungerar som förut.

### Uppdraget skapas, kontraktet importeras (S1.2, våg 2)

**Frysningen fick ingen egen åtgärd — den blev en följd.** Migration **0069**
lägger en trigger på `contracts`: står det ett `signed_date` på raden är
`kontrakt_tillstand` **`fryst`**, vid INSERT som vid UPDATE. Att signera ÄR att
frysa, så `create_contract`/`skapa_uppdrag` med datum föder avtalet fryst och
`update_contract` med `signed_date` fryser ett utkast. Vägen tillbaka är
stängd åt båda håll: `vagrar_avfrysning` (0068) vägrar `fryst` → `utkast`, och
0069 vägrar att NOLLA `signed_date` på ett fryst kontrakt (409
`rule_violation`, utan triggerns text som allt annat).

Följden för det som stod pinnat ovan: **ett bekräftat tak går nu att sätta på
ett nyskapat avtal — om avtalet är undertecknat.** Är det ett utkast fälls det
som förut, och det är hela ADR-8: en baseline på ett arbetsmaterial är en
anteckning.

**`skapa_uppdrag` (write, engångs)** — avtal på ett befintligt projekt.
Indata `project_id`, `name`, `signed_date` (valfri i schemat). Skapar bara
avtalet genom `createContract`. Rotdelen `UPPDRAG` föds med baseline version 1
först vid godkännandet av `satt_baseline`. Uppsättningens utkast är köposten;
ett nej lämnar inga avtalsdelar. Svaret har `contract_id`,
`kontrakt_tillstand` och avtalet med `parts: []`.

- **Utan `signed_date`** ges **400 `valid_from_required` före skrivningen**.
  Inget halvskapat avtal blir kvar och inget startdatum gissas.

**`importera_leveranskontrakt` (write, engångs)** — "Importera det frysta
leveranskontraktet som baseline". Indata `contract_id` + `kontraktstext`
(markdown), och valfritt `manifest` (Story 2.4). **Åtgärden läser aldrig Drive
eller en fil själv** (ADR-4/NFR-1):
den som har texten skickar in den. Tolkningen sker i den rena parsern
`server/src/lib/leveranskontrakt.ts` (ingen databas, ingen I/O), och skrivningen
går efter mänskligt godkännande genom `skrivBaselineversion` — ingen
parallell väg in till avtalsdelarna.

Importen köar `satt_baseline`, **en gång per källa** (Story 2.1, B-8). Källan
är trippeln (`contract_id`, `kontraktstext`, `manifest`). Finns redan en
`satt_baseline`-köpost
för trippeln, i valfri status (`pending`, `approved`, `rejected`, `executed`,
`failed`), köas ingen ny och ingen auditrad skrivs. Svaret bär då den
befintligas `approval_id`, `redan_koad: true` och `kostatus` (dess status). En
ny köpost ger `redan_koad: false`. Avtalets rad låses (`FOR UPDATE`) före
uppslaget, så två samtidiga importer av samma trippel ger en köpost, och
`contract_id` jämförs oberoende av skiftläge. En ny fryst text, eller samma text
mot ett annat avtal, eller ett annat manifest, är en ny källa. Manifestets
jsonb-innehåll jämförs, inte nyckelordningen. Har David sagt nej till källan
köas samma trippel inte igen; en direkt begärd `satt_baseline` köar alltid. Ur texten skrivs efter
godkännandet, allt i samma transaktion:

- rotdelen `UPPDRAG` som ny rad med ramens `cap_hours`/`cap_amount_ore` och
  `valid_from = signed_date`,
- strömmarna (Bilaga 1:s faser) som förälderdelar under `UPPDRAG` med
  `start_date`/`end_date` och `date_precision` läst ur datumets form
  (`2026-09` = `manad`, `2026-09-03` = `dag`),
- leverablerna under sin ström med sitt tak och **ärvt** intervall (NULL),
- `STYRNING` som del under `UPPDRAG` — **utan** rad i leverabelregistret,
- en rad per leverabel i `uppdrag_leverabel` (kod, klausul,
  acceptanskriterium, uppföljningsmått, läsväg, status `ej_paborjad`),
- `uppdrag_scopelinje` (innanför, utanför, signalfraser med klausul och
  åtgärden när en signal tänds; sorten är en av
  `'innanfor' | 'utanfor' | 'fras' | 'atgard'`, migration 0094, Story 2.6),
- parterna `contracts.godkannare`, `contracts.godkannare_eskalering`,
  `contracts.godkannandeform` och `contracts.godkannare_kalla` ur en enda källa
  (regeln nedan),
- uppföljningsmåtten ur del 3, en rad per mått i textens ordning i
  `uppdrag_matt.namn`, `uppdrag_matt.hur_ofta`, `uppdrag_matt.kallreferenser`,
  `uppdrag_matt.lasvag`, `uppdrag_matt.larmregel`, `uppdrag_matt.larmregel_lage`
  och `uppdrag_matt.utfall_lage` (kategori BASELINE, migration 0095, Story 2.3),
- rytmen ur del 4 på avtalet: `contracts.rytm_text`,
  `contracts.bedomning_intervall_dagar`, `contracts.bedomning_veckodag` och
  `contracts.rapport_mottagarkrets`. Manifestets ankare och källa skrivs först
  efter Davids ja i lägena `lagras` och `andras`. Texten själv ger aldrig ett ankare.

- **Utkastläget (Story 2.1, B-14).** En text med `kontrakt_tillstand: utkast`
  förhandsvisas, också utan `signed_date`: ingen baseline, inget register och
  ingen köpost. Det enda som skrivs är cachenyckeln `kontrakt_utkastfragor` i
  `uppdrag_svepvarde`, med exakt tre fält: `fragor` (`[{ rubrik }]`),
  `source_file_id` (avtalets befintliga dokumentpekare eller `null`) och
  `kontraktstext_sha256`. Rubrikerna läses ur ett avsnitt vars rubrik har ordet
  fråga, frågan, frågor eller frågorna som helt ord: ur den första tabellen med
  kolumnen `Fråga`/`Frågan`, annars ur punktlistan. Ett förslag eller ett svar i
  samma tabell läses aldrig, och texten själv sparas inte. Nyckeln har ett eget,
  reserverat omfång i `upsertSvepvarden`, så svepet varken skriver eller raderar
  den. Svaret bär `kontrakt_tillstand: 'utkast'`, `utkastfragor` (rubrikerna)
  och inget `approval_id`.
- **Datumen visas efter sin precision (Story 2.1, FR-34).** Ett månadsintervall
  lagras som första och sista dagen, men visas som `ÅÅÅÅ-MM` (`kvartal`
  `ÅÅÅÅ K1–K4`, `halvar` `ÅÅÅÅ H1/H2`, `ar` `ÅÅÅÅ`, `dag` `ÅÅÅÅ-MM-DD`): i Planens
  tabell och datumlista, i godkännandekortet, i undantagsvyns beskrivning av en
  föreslagen deländring och i dagslarmet på Läget och Pengarna. Dagslarmet i
  cachen `troskellarm` bär därför `precision` bredvid `slutdatum`. REST- och
  MCP-svarens råa datumfält är data med sin precision bredvid och ändras inte.
- **Saknat fält blir NULL, aldrig en gissning.** Ett värde parsern inte hittar
  skrivs inte, och redovisas i svarets `saknade_falt` — saknat ska synas som
  saknat.
- **Importen sätter ALDRIG `cap_confirmed`.** David gör en ren bekräftelse
  genom `upsert_contract_part` via kön (bara nyckelfält och
  `cap_confirmed: true`), och det kräver ett fryst kontrakt. Ett tak
  som en maskin bekräftat åt en människa är just det olästa tak som aldrig
  varnar.
- **Idempotent.** Delarna matchas på `code`, registret bärs av
  `UNIQUE (contract_id, kod)` och scopelinjerna läses innan de skrivs. En rad
  som redan står som importen vill ha den skrivs INTE om. Svaret säger
  `oforandrad: true`, `avtalsdelar_skrivna: 0`. En lagrad rad som skiljer sig
  ger **409 `version_finns`**: hela godkännandet rullas tillbaka, också register
  och scopelinjer. En rättelse efter lagring kräver en ny version med orsak.
- **Varje skriven del bär `change_reason = 'avtal'`** (Story 2.1; orsakerna
  är avtal, tillägg och utfall, DK-8). Före Story 2.1 skrev importen
  `'import ur leveranskontraktet v1'`; sådana rader är oföränderliga (0079), och
  jämförelsen `lika()` godtar fortfarande den orsaken för en redan lagrad rad som
  i övrigt är lika. Auditraden `uppdrag.leveranskontrakt_importerat` skrivs
  alltid: den är spåret av att importen kördes, inte av en ändring.
- **v3:s form läses som den står (Story 2.1).** Står ramens timmar bara
  ungefärligt (`**Timmar:** ca 430`) läses de ur timtabellens Summa-rad
  (`| | **Summa** | **430** | |`); ett exakt fält vinner alltid, och `ca 430`
  blir aldrig ett tal. Styrningen läses ur en leverabelcell `<namn> (STYRNING)`
  och dess timmar ur timtabellens `-`-rad med samma namn (`| - | <namn> | 15 |`).
  Utan koden i texten finns ingen styrning. Svaret bär den under
  `forslag.styrning` (`{ kod, namn, cap_hours }` eller `null`).
- **Del 5 i v3:s form (Story 2.6).** Scopelinjen läses bara ur avsnitt vars
  rubrik nämner scopelinje, omfattning, innanför, utanför eller signalfras.
  Innanför och utanför står som fetstilsstycken (`**Innanför, …:**`,
  `**Utanför, §2.3:**`); en ensam paragrafhänvisning i etiketten blir klausulen.
  Fraserna läses ur tabellens kolumn ”Det kunden säger” med klausulen ur
  kolumnen Klausul. Ett stycke vars etikett säger att en signal tänder eller
  tänds blir åtgärden, med styckebrytningen kvar och utan klausul; en annan
  etikett (”Delning …”) avslutar stycket före och blir ingen rad. Texten lagras
  som den står, och antalet fraser kommer ur tabellen. v1:s rubrikform ger
  samma rader som förut. Förhandsvisningen och de saknade fälten har samma form.
- **Del 3 och del 4 i v3:s form (Story 2.3, FR-19, FR-14).** Måtten läses bara
  ur avsnitt vars rubrik nämner uppföljning, ur en tabell med kolumnen ”Vad som
  mäts”: namnet, ”Hur ofta”, ”Var siffran läses” (lagrad som källreferens, en
  pekare i kontraktets ord) och ”Larmar när” lagras som de står. Läsvägen är en
  av `'redovisning' | 'arenden' | 'register' | 'kalender' | 'referens'` och läses
  ur källcellens första led genom en sluten lista av ord; en hänvisning som
  ”Sektion 5” löses mot dokumentets egna rubriker. Ingen läsväg gissas: en källa
  som ingen lista känner lagras med läsvägen NULL och redovisas i `saknade_falt[]`
  med nyckeln `uppfoljning.<namn>.lasvag`. Larmregelns och utfallets läge är ett
  av `'harleds' | 'harleds_ej'`. Importen skriver alltid larmregeln som
  HÄRLEDS EJ, och bara ”Nedlagd tid mot ram” på läsvägen redovisningen har ett
  utfall. Ingen andel klara leverabler räknas, och inget fält bär en
  beslutspunkts datum eller läge. Rytmen är den första raden i ett
  rapporteringsavsnitt (rubriken nämner rapportering eller rytm) vars ”Hur
  ofta” är en hel rytm, till exempel ”Varannan torsdag”: texten lagras som den
  står, intervallet i dagar och ISO-veckodagen ur den, och samma rads ”Till
  vem” som mottagarkrets. ”Månadsvis”, ”Vid behov” och en rytm med tillägg är
  ingen rytm. Svaret och auditraden bär `{ matt_skapade, rytm_andrad }`. Måtten
  bärs av `UNIQUE (contract_id, namn)`, och rytmen skrivs bara när den skiljer
  sig från avtalsraden, så en ny import av samma text lämnar avtalsraden helt
  orörd och svarar `oforandrad: true`.
- Uppsättning och import är `write`, men importen skriver planen först genom
  den känsliga köposten `satt_baseline`. Ingen lagrad version går att skriva
  över, bekräftad eller obekräftad: 0079 är sista försvarslinjen.

**Manifestet och kontraktsluckorna (Story 2.4, FR-27/FR-13/FR-14).**
`manifest` är strikt: obligatorisk `manifest.kalla` (högst 200 tecken) och valfria
`manifest.godkannare` (200), `manifest.godkannare_eskalering` (200),
`manifest.godkannandeform` (2000), `manifest.bedomning_ankare` (ISO-datum) och
`manifest.bedomning_ankare_kalla` (200).
Blanka texter, okända nycklar och ogiltiga datum ger `400 validation_error`.
Eskalering och godkännandeform kräver godkännare. Anger manifestet godkännare
kommer alla tre partsfält ur det; utelämnad eskalering eller form blir NULL,
inte kontraktstextens värde. Annars läses godkännare och eskalering ur textens
fältpar Godkännare (med Mottagarpart som reserv) och Eskalering, med källan
`leveranskontraktet`. Anger ingen källa en godkännare bevaras lagrade parter.
Fältet `manifest.kalla` sparas som `contracts.godkannare_kalla`
(för NVR-001 `projekt.yaml`).

Importens `forslag` bär nu `forslag.parter` (med skillnader mot texten),
`forslag.ankare: { lage, ankare, kalla, orsak }` och
`forslag.luckor[]: { falt, kod, vad, var, ja_innebar }`.
Godkännandets svar bär lagrade `result.parter`, `result.parter_skillnader`,
`result.ankare` och `result.luckor`. Den tekniska listan `forslag.saknade_falt`
är oförändrad.
Luckorna beräknas över namn, klausul, acceptanskriterium, uppföljningsmått och
mottagarpart; de blir aldrig egna poster. Tom mottagare, revision eller datum
före första överlämningen är giltig transmittal. Importen skriver ingenting
till transmittalen. Manifestet ligger också i köpostens
strikta indata, utan att ändra åtgärdens känslighet eller människospärren.
Åtgärdens form är `satt_baseline { contract_id, kontraktstext, manifest? }`.

Ankaret avgörs av `manifestankare` i åtta lägen:
`'ej_angivet' | 'utan_kalla' | 'kalla_utan_ankare' | 'rytm_saknas' | 'fel_veckodag' | 'lagras' | 'oforandrat' | 'andras'`.
Bara `lagras` och `andras` skriver, efter ja och under radlås.
Fel veckodag eller saknad källa redovisas i svaret utan att hindra resten av
importen. Ingen källa hittas på. `satt_bedomningsankare { contract_id, ankare, kalla }`
är fortsatt engångs; manifestets baselineförslag är vägen för ett ändrat ankare.

Ett tekniskt formfel ger `400 kontrakt_olasbart` med `details.olast` före
varje skrivning: `olast: ['kontrakt_tillstand']` betyder varken fryst eller utkast,
`leverabler` betyder fryst text utan leverabel. Ingen delvis import eller ny
köpost blir kvar. Svaret är signalen till driften, ingen fråga till David.

### Bedömningen (S4.1, våg 2)

**`satt_bedomning` (write, `kravManniska: true`)** — "Sätt bedömningen för en
period (på spår / risk / ur spår)". Ett handgrepp: åtgärden körs direkt, den
köas inte.

Indata: `contract_id`, `period_start`, `period_slut`, `lage`
(`pa_spar` | `risk` | `ur_spar`, exakt CHECK-villkorets värden i 0068), en
valfri `kommentar` (≤ 2000 tecken) och en valfri `begaran_id` (Story 1.10).
Svaret är den skrivna raden.

- **Bara en människa (FR-15).** `kravManniska` avvisar ett agentanrop med
  **403 `human_required`** i `executeAction` — före varje skrivning, utan
  köpost och utan auditrad. `satt_av_manniska` är därför INTE ett indatafält:
  tjänsten skriver `true`, och med spärren är det svaret per konstruktion. Ett
  fält hade återinfört exakt den lögn kolumnen finns för att utesluta. Inte
  heller `satt_av` (0082) är ett indatafält: det är den inloggade användaren.
- **`write`, inte `sensitive`.** Godkännandekön finns för beslut som ska LÄSAS
  av en människa innan de gäller. Här ÄR människan den som beslutar — att köa
  hennes bedömning för hennes eget godkännande vore ett handgrepp utan
  innehåll (1E Del 4).
- **Aldrig ändringsbar i efterhand (FR-17).** `uppdrag_bedomning` har SELECT +
  INSERT för rollen `app` och ingenting annat (0068): det finns ingen
  UPDATE-åtgärd att bygga och ingen DELETE. Rättar man sig sätter man en NY
  bedömning för samma period — båda raderna står kvar, och vad man trodde i
  september går att läsa i oktober. Ingen unik-spärr hindrar den andra raden;
  det är meningen.
- **Begäran besvaras (Story 1.10).** Med `begaran_id` besvarar raden den
  begäran, som måste gälla samma avtal (annars **409 `begaran_annat_avtal`**;
  okänd eller främmande ger 404 `not_found`). Samma avtal avgörs på id:t, inte
  på skiftläget: `contract_id` och `begaran_id` får skrivas med versaler, och
  svaret och auditraden bär id:na som databasen skriver dem (gemener). En redan
  besvarad begäran ger **409 `begaran_besvarad`**. Utan `begaran_id` besvarar raden avtalets öppna
  begäran, om det finns en, och svaret visar det i `begaran_id`. Raden bär
  `satt_av` (den inloggade användaren, aldrig indata) och svaret `satt_av_namn`.
  Auditraden `uppdrag.bedomning_satt` bär `contract_id`, `lage` och
  `begaran_id`, och `action.executed` skrivs som förut.
- **`handelse_ref_ids` och `frysta_siffror` fryses av SERVERN (S4.2, våg 6).**
  Tjänsten räknar om underlaget i SAMMA transaktion som INSERT:en och skriver
  det till raden: perioden, periodens timmar (`poster`, `minuter`,
  `fakturerbara_minuter` ur `list_time_entries`-läsvägen, ignorerade poster
  räknas aldrig), varje avtalsdel mot sitt tak ur `get_contract_usage` (alltså
  husets ENDA takberäkning — modulen summerar aldrig ekonomi själv, FR-25),
  periodens leverabelrörelser ur `uppdrag_leverabel_handelse` och antalet
  händelser. `handelse_ref_ids` är PEKARE mot `uppdrag_referens` (sort
  `kalender`/`mejl`, `created_at` i perioden) — aldrig kopior av mejlkropp eller
  kalendertext (FR-26). Fälten är INTE indata: `.strict()` fäller dem, av samma
  skäl som `satt_av_manniska`. En period helt utan tid och händelser fryser
  nollor och en TOM array (`{}`); NULL betyder därmed entydigt "satt före S4.2",
  och sådana rader renderas som förut, utan siffror (FR-16/FR-20/FR-32).
- **Perioden följer avtalets rytm (Story 2.3, FR-14, B-14).** Rytmen kommer ur
  leveranskontraktets del 4 genom importen och ankardatumet ur Davids egen
  uppgift. Varje period räknas av den rena regeln i
  `server/src/lib/bedomningsrytm.ts`: tillfällena är ankaret plus ett helt antal
  intervall, perioden börjar på det senaste tillfället som är i dag eller
  tidigare och är ett intervall lång, och nästa tillfälle är det första som är i
  dag eller senare. Någon husrytm finns inte, kalendermånaden föreslås aldrig och
  veckonumret läses aldrig. Rytmens läge är ett av
  `'raknad' | 'fore_forsta' | 'datum_saknas' | 'ankare_ur_rytm' | 'rytm_saknas'`,
  och bara en räknad period har gränser. Utan period säger Läget, Bedömning och
  undantagsvyn samma mening, ur en enda tabell, och ingen av dem påstår vad
  kontraktet innehåller:
  - före första tillfället: ingen period har börjat — första bedömningstillfället är ankardatumet
  - rytm men inget ankare: datum saknas — ankardatumet för rytmen är inte satt
  - ankaret faller utanför veckodagen: ankardatumet faller inte på rytmens veckodag — ingen period räknas förrän det ändras genom en baselineändring
  - ingen rytm inläst: datum saknas — ingen bedömningsrytm är inläst för avtalet, och den läses ur leveranskontraktets del 4 när baselinen godkänns

  Åtgärden spärrar fortfarande ingen dag: perioden kommer ur indata, och utan
  period anger David själv perioden han bedömer.

**`satt_bedomningsankare { contract_id, ankare, kalla }` (write,
`kravManniska: true`)** — "Sätt ankardatumet för avtalets bedömningsrytm (en
gång per avtal)" (Story 2.3, FR-14). Inget ankardatum står i kontraktet, så
David sätter det, med sin källa.

- **Källan är obligatorisk.** `kalla` är antingen
  `{ typ: 'davids_uppgift', datum }` eller `{ typ: 'kalender', referens_id }`;
  schemat är strikt och har ingen standardkälla, så ett datum utan källa ger
  400. En kalenderreferens måste vara en av avtalets kalenderposter i
  referenstabellen, och en trasig länk eller en post utanför spärrmappen är
  ingen källa — samma urval som ankarformuläret erbjuder, ur samma funktion, så
  API:t tar aldrig emot en källa som vyn inte visar (annars 400
  `error: 'okand_kalenderreferens'`). Har posten ett händelsedatum ska det vara
  ankaret (annars 400 `error: 'kalla_annat_datum'`). Källan lagras som text i
  `contracts.bedomning_ankare_kalla`: ”Davids uppgift <datum>” eller
  ”Kalenderreferens <id>”.
- **Ett avslutat uppdrag tar inte emot ankaret.** Ankaret är BASELINE, och på
  ett avslutat uppdrag avvisas skrivförsök mot baselinen (FR-8): 409
  `error: 'uppdrag_avslutat'`, före varje skrivning. Spärren bakom tjänsten är
  avslutstriggern på avtalets sex rytm- och ankarkolumner (0095), som fäller
  varje skrivning av dem på ett avslutat uppdrag, också importens.
- **En gång per avtal.** Avtalet låses, och skrivningen kräver att
  `contracts.bedomning_ankare` är NULL. Ett satt ankare ger 409
  `error: 'ankare_redan_satt'` med texten ”Ankardatumet är redan satt. Det
  ändras bara genom en baselineändring med orsak.” Varken update_contract eller
  importen kan skriva kolumnerna; ändringsvägen hör till baselineförslaget.
- **Rytmen först.** Ett avtal utan inläst rytm ger 409 `error: 'rytm_saknas'`,
  och ett ankare som inte faller på rytmens veckodag ger 400
  `error: 'fel_veckodag'`. Ett okänt eller främmande avtal ger 404
  `error: 'not_found'`.
- **Bara en människa.** `kravManniska` avvisar ett agentanrop med **403
  `error: 'human_required'`** före varje skrivning. Auditraden
  `uppdrag.bedomningsankare_satt` bär `{ contract_id, ankare, kalla_typ }` och
  ingen fritext. Svaret är
  `{ contract_id, bedomning_ankare, bedomning_ankare_kalla, nasta }`.

**Vyn:** `/app/c/:id/projects/:projectId/bedomning`, undersida till uppdraget
(knappen **Bedömning** bredvid *Läs in avtal*). Sidan är **förifylld** (S4.2):
panelen *Underlaget för perioden* står över formuläret med periodens timmar,
delarna mot sina tak, leverabelrörelserna, händelserna som referenser och
scopelinjen (innanför/utanför/fraser, levande ur `uppdrag_scopelinje` — den
fryses aldrig). Saknas händelser sägs det rakt ut i stället för att blockera
eller gissa. Formuläret sätter läget för en period — det enda obligatoriska
valet — och historiken visar varje rads FRYSTA tal, aldrig omräknade. Den
skriver genom `executeAction` med actor `human`, precis som resten av vyns
skrivvägar.

Sedan Story 2.3 står panelen *Bedömningsrytmen* först på sidan, för det avtal
formuläret har förvalt: rytmen som den står i kontraktet, ankaret med sin källa
och nästa bedömningstillfälle med perioden — eller meningen om varför ingen
period räknas. Perioden är formulärets förval och rapportens period. Utan
period ritas rapporten inte, och periodfälten är tomma och obligatoriska.
Har uppdraget flera avtal säger formuläret vilket avtals period förvalet är.
Ankarformuläret står i panelen (datumet och källan: Davids uppgift förvald, och
avtalets kalenderreferenser bredvid) bara där ett ja kan lyckas: uppdraget är
aktivt, avtalet är det som panelen gäller, rytmen är inläst och inget ankare är
satt. Samma regel styr länken dit från Läget, så ingen väg vidare leder till en
sida utan formulär. Formuläret postar till
`/app/c/:id/projects/:projectId/bedomning/ankare`, som kör åtgärden med actor
`human` och leder tillbaka till Bedömning, med `?fel=` vid fel.

### Leverabelregistret läses (S3.1, våg 3)

- `las_leverabelregister` (read) — `contract_id`. Avtalets rader ur
  `uppdrag_leverabel`, sorterade på `kod`: `contract_id`, `kod`, `namn`, `klausul`,
  `acceptanskriterium`, `uppfoljningsmatt`, `matt_lasvag`, `status` (FR-9),
  `revision`, `mottagare` och `overlamnad` (FR-13, Story 4.1) och `dagar_i_laget` (FR-37).
  `namn` läses ur avtalsdelens första version med samma kod; är namnet koden
  blir det NULL. Senare baselinebeslut ändrar inte kontraktets namn (Story 2.4).
  Importen (S1.2) fyllde registret, men ingen ingång kunde läsa det.
  **Radidentiteten är `(contract_id, kod)`** — aldrig `contract_part_id`:
  avtalsdelen versioneras vid ett tilläggsavtal, leverabeln L6 är samma
  leverabel före och efter. Ett avtal som inte finns eller tillhör ett annat
  bolag ger **404 `not_found`**; ett befintligt avtal utan registerrader ger en
  **tom lista** — avtalet kan vara skapat men inte importerat, och det är ett
  svar, inte ett fel.
- **`matt_lasvag` får vara NULL, och täckningen bärs av provet.** CHECK-villkoret
  i 0068 tillåter NULL med flit: ett fält som kontraktstexten inte angav ska
  skrivas som saknat, aldrig gissas fram. Alltså kan databasen aldrig säga "alla
  mått har en läsväg". FR-19:s täckningskontroll läser i stället åtgärdens svar
  (`server/test/uppdragsytan-register.test.ts`): fixturen NVR-001 saknar L6:s
  läsväg och kontrollen ska fälla exakt L6, medan samma text med läsvägen ifylld
  ger noll saknade. Åtgärden döljer aldrig en lucka och fyller den aldrig.
- **`dagar_i_laget` är HÄRLETT, aldrig lagrat (S3.3, våg 5 — FR-37).** Hela dagar
  (avrundat nedåt) sedan leverabelns senaste rad i append-only-tabellen
  `uppdrag_leverabel_handelse` — alltså hur länge den stått still i sitt
  nuvarande läge. Saknar leverabeln händelser (importen skapade den, ingen har
  statusbytt den) räknas åldern i stället från `uppdrag_leverabel.created_at`;
  fältet är därför alltid ett heltal ≥ 0 och aldrig NULL. Talet räknas fram i
  SELECT:en, med subqueryn filtrerad på både `leverabel_id` och `company_id`.
  **Ingen `status_sedan`-kolumn finns eller ska finnas** (`0068:131`: "status
  utan historik är en gissning") — en lagrad kolumn hade varit ett andra ställe
  där samma sanning står, och den driftar ifrån historiken första gången en
  skrivväg glömmer den. Ett schemaprov vaktar att kolumnen inte smyger tillbaka.
  Fältet hör till lästillfället och fryses inte i registerkopian (Story 3.3).

- **Transmittalfälten (Story 4.1).** `revision` och `mottagare` läses ur leverabelns
  senaste överlämning, den händelse som bär en revision. Returen och godkännandet
  bär ingen revision och räknas inte som överlämningar. Alla tre transmittalfält
  är NULL före första överlämningen. Mottagaren är transmittalens, aldrig avtalets
  godkännare; avtalets mottagarpart läses genom kontraktsytans läsåtgärd.
  `overlamnad` läses ur överlämningshandlingens händelsedatum och är NULL
  när handlingen saknar datum eller överlämningen saknar handling (Story 4.2). Bekräftelsens tid är aldrig överlämningsdatum.
  Registerkopian fryser samma sju fält som förut. Vyns bräda och tabell visar
  samma fält ur samma svar.

### Scopesignalen (S5.1, våg 3)

Kontraktet räknar upp sju **signalfraser** — "kan ni även…", "bara en snabb…" —
och avsnitt 5.4 säger vad som händer när någon säger dem. Tabellen fanns sedan
0068, men ingen kod kunde skriva en rad: linjen mellan innanför och utanför
uppdraget bevakades av ingenting. Två åtgärder, tre handgrepp på ytan (**Tänd**,
**Innanför**, **Utanför**) enligt 1E Del 4, och **båda `write` +
`kravManniska: true`** — det finns ingen kodväg där en signal tänds eller avgörs
utan människa (FR-6). Ett agentanrop ger **403 `human_required`** i
`executeAction`, före varje skrivning: ingen köpost, ingen auditrad, ingen rad.

Migration **0070** lägger den enda kolumn som saknades:
`uppdrag_scopesignal.eskalerad_nar timestamptz` (NULL = ej eskalerad). Additiv,
idempotent, ingen backfill.

**`tand_scopesignal`** — "Tänd en scopesignal ur kontraktets fraser". Indata:

- `contract_id`, `fras` (≤ 500 tecken) och valfri `klausul`. Vyn förifyller
  frasen ur `uppdrag_scopelinje` (`sort = 'fras'`); fältet är ändå fri text,
  eftersom det som sägs i verkligheten sällan följer avtalets stavning.
- `eskalera` (valfri boolean) — stämplar `eskalerad_nar = now()`. **Utan motiv
  med flit** (FR-7, 1E Del 7: `eskalera: true` med tomt motiv är giltigt). Det
  finns inget motivfält att skicka in, och 0070 har ingen motivkolumn: ett
  obligatoriskt motiv gör tröskeln till det som INTE eskaleras.
- `underlag` (valfritt objekt) — `sort` (`mejl` | `kalender`), `extern_id`,
  `extern_nyckel`, `extern_kalla`. Blir signalens `underlag_ref_id` via
  `skapaReferens` (S7.1). **Underlaget är en pekare, aldrig en kopia:** ett
  Message-ID eller Google Calendars händelse-id. Id:t prövas mot källans form;
  Message-ID lagras utan vinkelparenteser. En url, sökväg eller fel form fälls med **400
  `validation_error`** av spärren i `uppdragReferens.ts` — varvid ingen signal
  tänds heller. En befintlig referens med samma `(sort, extern_id)` på avtalet
  **återanvänds** (läsning före skrivning): samma mejl tänder ofta två fraser,
  och utan uppslaget hade den andra fallit på `uppdrag_referens_uk`.
- **`tand_av` är INTE ett indatafält.** Det härleds ur den inloggade användaren
  (profilnamn, annars e-post) — samma regel som `satt_av_manniska`: ett fält
  anroparen fyller i om sig själv är ett påstående, inte ett spår.
- Signalen föds utan avgörande: svaret har `avgjord: null` och `avgoranden: []`.
  Tystnad blir aldrig ett ja.

**`avgor_scopesignal`** — "Avgör en tänd scopesignal: innanför eller utanför
uppdraget". Indata `signal_id` + `avgjord` (`innanfor` | `utanfor`, exakt
CHECK-villkorets värden). Ett tredje värde ger 400 `validation_error`
(zod, före databasen) och fälls av villkoret om det ändå nådde fram. En okänd
signal — inklusive grannbolagets — ger **404 `not_found`**, som förut.

- **Varje avgörande är en ny rad (Story 1.9, B-8)** i `uppdrag_scopeavgorande`
  (migration 0081, append-only) med löpnummer per signal, vem (`avgjort_av`)
  och när (`avgjort_nar`), och signalens underlag (`underlag_ref_id`). Ett
  avgörande skriver aldrig över det förra. Ett annat val är en rättelse som
  läggs till. Samma val på samma underlag ger **409 `redan_avgjord`** utan ny
  rad eller köpost. Ett avslutat uppdrag ger **409 `rule_violation`**.
  Auditraden `uppdrag.scope_avgjort` bär id och koder (`signal_id`,
  `avgorande`, `lopnummer`, `tillagg_approval_id`, `tillagg_redan_koad`),
  aldrig fras eller namn.
- **Svaret** är signalen med `avgjord` (senaste avgörandet) och `avgoranden`
  (alla, i löpnummerordning), plus `avgorande` (raden som skrevs) och vid
  tillägg `tillagg_godkannande` med `redan_koad`.

- **`tillagg` (valfritt objekt, S5.2, våg 4)** — tillägget som följde av ett
  "utanför". **Samma fält som `andra_baseline`** (obligatoriskt `valid_from`)
  — det ÄR den åtgärdens indata, och köposten valideras om mot just det schemat
  vid godkännandet. `change_reason` är valfritt (Story 2.2). Anges det ska det
  ha minst 5 och högst 1 991 tecken, och köpostens orsak blir
  `Tillägg: <texten>`. Utelämnat blir köpostens orsak
  `Tillägg: signalfrasen ”<frasen>”` ur signalraden, och en fras som är tom
  efter trimning ger **400 `orsak_saknas`** före varje skrivning, utan rad,
  köpost eller auditrad: en saknad orsak hittas aldrig på. Vyns orsaksfält
  visar den förifyllda orsaken som platshållare, och ett tomt fält skickas
  inte. Tillsammans med `innanfor` ger fältet
  **400 `validation_error`**: låg frasen innanför uppdraget finns det inget att
  lägga till avtalet. Valfritt med flit — alla utanför-signaler blir inte
  tilläggsavtal, och ett förifyllt tak vore ett förslag ingen läst i
  avtalshandlingen. Ett `start_date` eller `end_date` i tillägget utan
  `date_precision` ger **400 `validation_error`** före varje skrivning (Story
  2.1, FR-34, samma regel som `andra_baseline`).
- **Tilläggets avtal (Story 1.9).** `tillagg.contract_id` ska vara signalens
  avtal. Annars ger anropet **400 `signal_annat_avtal`** före varje skrivning,
  utan rad, köpost eller auditrad. Ett upprepat knapptryck med samma val på
  samma underlag ger ändå **409 `redan_avgjord`**, eftersom upprepningen prövas
  först. Köposten bär alltid signalens avtal ur signalraden.
- **Fältet skriver ingen avtalsdel.** Om ingen köpost för signalen finns skapar
  det en `andra_baseline`-post i **Att göra** (med signalens avtal, `signal_id`
  och `kalla: { typ: 'scopesignal', id }` ifyllda) plus auditraden
  `action.approval_requested`, i samma transaktion som avgörandet — aldrig via
  ett nytt `executeAction`-anrop. Svaret bär `tillagg_godkannande` med köpostens
  id och status och `redan_koad: false`. Först vid godkännandet föds versionen
  och signalens `ledde_till_part_id`; avslås posten står avgörandet kvar men
  avtalet är orört. **Inget femte handgrepp:** människans godkännande i kön är
  det andra greppet.
- **Ett förslag per signal (Story 1.9, AC 6).** Finns redan en `andra_baseline`
  för signalen, i någon status, köas ingen ny: avgörandet skrivs ändå, och
  svaret säger `redan_koad: true` med den befintliga köpostens id och status.
  Signalsidan visar samma sak i sin notis, så att ifyllda tilläggsfält aldrig
  kastas tyst.

**Vyn:** `/app/c/:id/projects/:projectId/signaler`, undersida till uppdraget
(knappen **Signaler** bredvid *Bedömning*). Öppna signaler ligger överst — en
obesvarad scopefråga som läses sist blir i praktiken ett ja — och *Innanför* och
*Utanför* är två likvärdiga knappar utan förval. Fraserna listas ur kontraktet
med var sin **Tänd**-knapp och underlaget ett klick bort per fras (`<details>`),
så att ett mejl aldrig kan fästas på fel fras. Nyckelrymden
(`rfc822#message-id` / `icalendar#uid`) fyller vyn själv; David anger sorten,
id:t och vilket konto det lästes ur. Inget `?ok=`: kvittot är den nya raden.
Undantaget är ett tillägg som inte köades därför att signalen redan har ett
förslag. Då står förslagets id och status i sidans notis (Story 1.9).

**Tillägget på ytan (S5.2, våg 4):** under varje öppen signal ligger
*Blev det ett tilläggsavtal?* (`<details>`) med fem fält — kod, namn, gäller
från, orsak och ett **valfritt** tak i timmar. Fälten hör till **Utanför**-
knappens formulär (kopplade med HTML:s eget `form`-attribut, alltså utan en rad
skript) och står FÖRE knapparna i dokumentet, så att den som tabbar sig fram
inte passerar svaret innan hon vet att fälten finns. Lämnas de tomma avgörs
signalen bara — det är normalfallet. Fylls de delvis i svarar zod 400 och
notisen står kvar på sidan; en tyst bortkastad ifyllnad hade varit värre.
*Innanför* bär inte fälten alls, så en ifyllnad kan aldrig råka följa med fel
svar. Texten under fälten säger var tillägget hamnar och länkar dit
(**Att göra**): den nya avtalsversionen skrivs först när David godkänt den där,
och den gamla ligger kvar. Den säger också att en signal får ett förslag, och
att sidan säger till när tillägget därför inte köades.

### Drive-kön för registrets frysta kopia (S7.2, våg 3)

Leverabelregistret ska finnas som en fryst kopia i kundens spärrmapp i Drive.
**Repot skriver den aldrig själv** (ADR-4: det här repot ringer aldrig ut, samma
enkelriktade hållning som `ingest_crm_events`). Vägen är därför: registret ändras
här, kopian **köas** här, och Hermes (S7.5) tömmer kön via två åtgärder — utan
handpåläggning, och därför **utan `kravManniska` på någondera**. Handgreppet som
kräver en människa är att ÄNDRA registret, och det ligger i skrivvägen före kön.

Migration **0071** (additiv, idempotent) gör två saker: CHECK-villkoret på
`uppdrag_referens.ko_status` utökas till `NULL | koad | skriven | fel`, och
kolumnen **`ko_fel text`** läggs till (NULL = inget fel). Ingen ny tabell, ingen
GRANT-ändring — **kön bor på referensen** (1E Del 3): en köad kopia ÄR en
oskriven referens, och en egen kötabell hade betytt två rader om samma sak.

**Köningen sitter i registrets skrivväg.** Import, statusbyte och överlämning
anropar `koaRegisterkopia` i samma transaktion som registerändringen. Varje
ändring fryser en ny registerversion med text, rader och registerhash och
skapar en egen köpost med `sort = 'drive'`, `extern_nyckel = 'registerkopia'`
och `extern_kalla = 'drive:sparrmapp'`. Nästa löpnummer sätts under avtalslås.
Köposten ärver avtalets befintliga Drive-id och dess eventuella spärrdom;
annars föds den overifierad. Saknas filen används platshållaren
`registerkopia:<contract_id>`. Tidigare versioner och deras feltext står kvar. En öppen köpost utan fryst version får i stället
`ko_status = 'ersatt'`. Rullas ändringen tillbaka finns varken versionen eller
köposten kvar.

- **`hamta_drive_ko` (read)** — inga fält. Bolagets öppna kö, avtal för avtal
  i stigande registerversion. Per post: `referens_id`, `contract_id`, `extern_id`,
  `ko_status`, `ko_fel`, `forsok`, registerkopia_id, `registerversion`,
  `registerhash`, `registertext` (versionens frysta text) och `innehall`
  (versionens frysta rader). Innehållet läses ur den lagrade versionen och
  renderas aldrig om vid hämtningen. En köpost utan version delas aldrig ut;
  svepet fryser en version för ett öppet avtal med en sådan köpost och ersätter
  den gamla. **`fel`-poster ingår med flit:** nästa svep hämtar dem igen.
  Försöksräknaren räknas upp per mottaget utfall och har inget tak.
- **`rapportera_drive_kopia` (write)** — `referens_id` + `utfall`, med valfria
  `registerversion` och `registerhash`. Skickas ett av dem måste båda finnas
  (`400 kvittens_ofullstandig`), och båda måste stämma med köposten
  (`409 kvittens_annan_version`). Uppslaget av en okänd referens ger först
  404 `not_found`. Utfallet är en diskriminerad union på `lage`:
  - `{ lage: 'skriven', drive_id }` → `ko_status = 'skriven'`, `extern_id` blir
    Drive-id:t, `ko_fel` nollställs och försöksräknaren räknas upp med ett.
    Avtalets andra oskrivna köposter med lägre version eller utan version blir
    `ersatt`; deras feltext och frysta innehåll står kvar. Högre versioner och
    redan skrivna poster ändras aldrig. En kvitterad köpost utan version
    ersätter bara andra köposter utan version.
    Id:t prövas med **samma spärr som varje annan referens**: aldrig en url,
    aldrig en sökväg (400 `validation_error`). Drive-formen är bokstäver,
    siffror, `_` och `-`. Ett känt utanför-utfall i samma avtal ger
    409 `utanfor_sparr`, och ett id som en vanlig referens redan har ger
    `409 referens_finns_redan`. Samma prövning gäller svepets `drive_kopior`:
    ett fel fäller hela svepet, utan att stänga kön.
  - `{ lage: 'fel', fel }` → `ko_status = 'fel'` med senaste felets egna ord i
    `ko_fel` och försöksräknaren ökad med ett. Posten står kvar i hämtningen.
  - **Idempotens:** upprepad `skriven` med samma Drive-id ger 200 utan ändring,
    om version och hash stämmer när de skickas. Båda utfallen mot en `ersatt`
    köpost ger 200 utan ändring, också med annan version och hash.
  - **409 `ingen_oppen_kopost`** gäller en rad utan köpost (`ko_status` NULL),
    `fel` mot en skriven post och `skriven` med ett annat Drive-id mot en
    skriven post. Version och hash prövas under avtalslåset före det skrivna
    läget; en felaktig versionskvittens ger därför versionsfelet först.

**Vyn:** projektsidan, Läget och undantagsvyn visar aldrig köstatus, köfel
eller Drive-fel. Ett tekniskt fel blir en driftpost på Hermes driftyta enligt
B-10. Uppdragsytan visar registrets gällande databaspost och referensens
verifieringsläge; en oskriven kopia framställs aldrig som färdig.

- **Versionsbunden kopia (Story 3.3).** Migration 0098 skapar tabellen uppdrag_registerkopia som FRYST HISTORIK, append-only med RLS och avslutsspärr. Varje registerversion har fryst text, rader och registerhash; köpostens registerkopia_id och hash binds med en sammansatt främmande nyckel. En gammal öppen köpost utan version blir ersatt, och en kvittens mot en ersatt post ger 200 utan ändring. Referenslistorna visar bara den senaste kopieposten per avtal. Verifieringens skrivväg håller oskrivna kopior overifierade även vid inskickade observationer för ett ärvt fil-id. En spärrdom gäller filidentiteten över versionerna; senaste spärrade kopian med verkligt fil-id finns i verifieringslistan så att en uttryckligt verifierad återflytt kan häva även äldre raders spärr. Återflytten färdigställer ingen oskriven version. Båda kvittensutfallen tar avtalslåset före tillståndsläsningen, så en väntande kvittens aldrig skriver över ersatt. Varje skrivning av ett Drive-id tar avtalslåset; en kvittens med ett id som en vanlig Drive-referens i avtalet redan har ger `409 referens_finns_redan`. Köstatus visas på Hermes driftyta och aldrig på projektsidan. Arbetslistan och den versionsbundna kvittensen beskrivs i punkten för Story 3.6 nedan.

- **Arbetslistan och kvittensen (Story 3.6).** Arbetslistans `registertext` och rader läses ur den frysta versionen, med hash, version och fil-id. `forsok` räknar mottagna utfall utan tak; senaste felet står kvar till en lyckad skrivning. Kvittensen kan bära version och hash och gäller bara sin köpost. Äldre oskrivna köposter blir `ersatt` när en senare version kvitteras, medan innehållet står kvar. Upprepad kvittens med samma fil-id ändrar ingenting. Story 3.4 börjar skicka version och hash; tills dess godtas båda utelämnade för Hermes i drift.

### Svepet (S7.3, våg 3)

Vyerna får **aldrig** anropa ett grannsystem under rendering (NFR-6). Alltså
måste någon ha läst källsystemen innan sidan öppnas och lagt resultatet där vyn
når det på en SELECT. Det är svepet.

**`kor_uppdragssvep` (write)** — "Kör uppdragssvepet: verifiera referenser,
kontrollera spärrmappen, räkna prognosen". Ingen `kravManniska` (1E Del 4):
svepet härleder och cachar, det beslutar ingenting. **Ingen migration, ingen vy,
ingen scheduler** — schemaläggningen och indatabygget bor hos Hermes (S7.5).

**Anropet går åt två håll.** Indatat är förra arbetslistans resultat, svaret är
nästa arbetslista. Repot ringer aldrig ut (ADR-4), så svepet har ingen egen
läsåtgärd mot Drive, kalendern eller mejlen — allt det inte kan räkna ut ur den
egna databasen kommer in som validerad indata:

- `uppdrag[]` — per uppdrag `contract_id`, `referenser[]`, `kalenderhandelser[]`
  och valfri `sparrmapp_id` (Drive-id, aldrig en sökväg).
  - `referenser[]`: `referens_id`, `lage` (samma union som S7.1:s verifiering),
    valfri `leverabel_kod`, valfri `revision`, valfritt `handelse_datum`
    (giltigt ISO-kalenderdatum från källhändelsen) och valfri `foralderkedja`
    (Drive-id:n, filens egen förälder först).
  - `kalenderhandelser[]`: `datum` + `minuter` som **heltal** — aldrig timmar som
    flyttal, samma regel som tidposternas `billable_minutes`.
  - **Ett uppdrag som inte står i listan rörs inte.** Cachen speglar det senaste
    svepet av just det uppdraget; ett tomt anrop är giltigt och hämtar bara nästa
    arbetslista.
- `drive_kopior[]` — utfallet av förra arbetslistans Drive-kö, samma form som
  `rapportera_drive_kopia` och genom **samma** tjänstefunktion. Utan den halvan
  hade svaret lämnat tillbaka en kö som redan var tömd.
- `ovrigt_forslag[]` (valfri, högst 200, Story 1.14) — Hermes formulering per
  Övrigt-kandidat: `{ anteckning_id, alternativ: 'tillagg' | 'ryms',
  avtalsdel_kod, timmar?, skal, kallreferenser? }`, strikt. `timmar` är positivt,
  högst 999 999,99 och med högst två decimaler; `skal` är 1–2 000 tecken och
  inte bara blanktecken; `kallreferenser` är högst tio
  `{ sort: 'mejl' | 'kalender', extern_id, extern_nyckel, extern_kalla,
  handelse_datum? }`. Fel form ger 400 `validation_error` för hela anropet. Varje
  förslag prövas sedan mot egna tabeller (se *Övrigt-raden blir en fråga*
  nedan), och ett förslag som inte håller avvisas med en orsak och fäller aldrig
  svepet.

**Referensens utfall (Story 3.1, B-15).** Nya referenser är `overifierad`.
Ett försvunnet mål ger `trasig`; ändrad titel, hash eller fryst revision ger
`drift`. En Drive-fil vars kedja ligger utanför spärrmappen får
`utanfor_sparr`, som består tills en dom `innanfor` kommer. Utanför-domen
har företräde framför drift. Cachevärdet `referenser:<sort>` bär de fem
räknarna `overifierad`, `levande`, `drift`, `trasig` och `utanfor_sparr` samt
`antal` och `avvikande`.

En referens med fryst `revision` i arbetslistan kräver revision i varje
observation. Saknas den bedöms raden inte: `uppdrag[].ej_bedomda` bär
`{ referens_id, orsak: 'revision_saknas' }`, och status och verifieringstid
står kvar. Den räknas inte i verifieringar, spärrmapp eller förslag. Den
lagrade revisionen ändras aldrig. Händelsedatum sätts bara ur observationen;
utelämnat datum lämnar det lagrade orört.

En referens som Hermes inte kunde verifiera skickas inte. Servern lämnar då status och `senast_verifierad` orörda.

Svaret bär alltid `uppdrag[].utanfor_sparr` (bedömda referensers id) och
`ej_bedomda`, också som tomma listor. `referenser_verifierade` räknar bara
bedömda referenser; nästa arbetslistas referenser bär även `revision`.
Utanför-utfallet är underlag till Hermes driftpost, aldrig en mandatfråga.

**Mottagna beslut först (Story 1.7, B-2):** efter bolagslåset verkställs redan mottagna mandat med en savepoint per köpost, före läsningen av öppna avtal. Svaret `svep_kort` får `mottagna_beslut: { verkstallda, kvar }` som antal; inga id eller fel förs ut. Auditraden anger verkställaren `svep`, medan beslutsfattaren förblir människan. `svep_avstod` är oförändrat.

**Ordningen efter beslutssteget är kravet:** (1) verifiera referenserna via S7.1, (2) kontrollera
spärrmappen på de kedjor indatat bär, (3) räkna prognosen ur kalenderhändelserna
— och därefter förslagen. Svarets `nycklar` står i **härledningsordning** (inte
sorterad), så ordningen går att pröva utan att läsa koden. Varje lagrat värde bär
`kalla` och `last_nar` (FR-35): `referenser:<drive|kalender|mejl>` (lägen och
avvikelser per källsystem), `sparrmapp` (`ok`, `provade`, `utanfor`),
`prognos` (`handelser`, `bokade_minuter`, `forsta`, `sista`, `ram_timmar`,
`ram_kronor`) och `troskellarm` (`trosklar`, `larm`, `utan_egen_ram: [{ kod, enhet }]`).

**Prognosens två ramdatum (S7.4, FR-5).** `ram_timmar` och `ram_kronor` säger när
uppdragets ram nås, härlett ur den registrerade tiden t.o.m. i dag (rotdelens
nod i `forbrukningForAvtal` — ingen andra takberäkning) plus de bokade
kalenderminuterna EFTER i dag, med taxan ur `gallandeTaxa` (avtalets, annars
uppdragets). Varje fält är **antingen** `{ "datum": "YYYY-MM-DD" }` **eller**
`{ "villkor": "..." }` — aldrig båda, och aldrig ett tal när underlaget saknas
(FR-5: vägrar gissa). Villkoren prövas i ordningen **`inget bekräftat tak`**
(rotens `cap_status` är `vet_ej`, eller ramens takfält är tomt) → **`ingen taxa`**
(bara `ram_kronor`) → **`ingen bokad framtid`** (ingen kalenderhändelse efter i
dag med minuter > 0). Är ramen redan nådd är datumet **i dag** — det är fakta,
inte en gissning. Räcker bokningarna inte fram till ramen förlängs de med sin
egen takt (resterande mängd ställd mot vad som bokats över spannet i dag→sista
bokningen, avrundat uppåt till hela dagar).

**Tröskellarmen (S6.2, FR-3).** `troskellarm` (källa `redovisning`) bär avtalets
`trosklar` och listan `larm` — och **ingen färdigställandegrad i procent**
(NFR-11). Ett belopps- eller timlarm tänder bara när avvikelsen mot ramen
**överstiger BÅDA** villkoren: `troskel_procent` av nivåns EGEN ram **och**
absolutgolvet (`troskel_golv_ore` respektive `troskel_golv_timmar`). Procenten
ensam larmar om ingenting — 30 % av en post på 8 000 kr är 2 400 kr — och golvet
ensamt tiger på ett litet uppdrag där 22 000 kr är halva ramen. En avvikelse som
är noll eller negativ tänder aldrig, och ett **obekräftat eller saknat tak**
larmar aldrig (samma regel som takvarningen: ett oläst tak varnar aldrig).
Procentbasen är alltid nivåns egen ram: en ram som summerats ur barnen är ingen
ram och prövas inte (Story 5.3). Värdet bär därför också
`utan_egen_ram: [{ kod, enhet }]`, en post för varje mätnivå och enhet
(`timmar` före `kronor`) utan egen ram, utan tal och utan procent. Ett värde
skrivet före Story 5.3 saknar listan tills nästa svep.

- **Nivåerna är uppdraget (rotdelen) och posterna (lövdelarna)**, lästa ur
  `forbrukningForAvtal` — modulen räknar aldrig om förbrukningen och har inga
  egna belopps- eller timkolumner (FR-25). Strömmarna däremellan mäts inte:
  deras ramandel finns inte förrän en baselineversion bär den.
- **Prognosen prövas mot samma funktion och samma trösklar som utfallet:**
  registrerat + bokat framåt (kalenderminuterna efter i dag, i ören genom
  `gallandeTaxa`/`timeEntryAmountOre`) − ram, på uppdragets nivå. Utan taxa
  finns ingen kronprognos, och utan bokad framtid ingen prognos alls — den vore
  utfallet en gång till.
- **Dagslarmet** är den tredje ramen — oberoende av beloppen och utan krav på
  ett tak. En daterad post tänder när förseningen mot sitt slutdatum **når**
  `troskel_dagar`, medan en leverabel med bara ärvt intervall tänder
  dagen efter intervallets slut, med `troskel_dagar` 1 i larmet (Story 5.3). Slutdatumet är
  delens eget, annars det **ärvda** enligt `byggPlan`:s regel, så en leverabel
  som bara har strömmens period aldrig kan larma före periodens slut (FR-3:s
  sista sats). Larmet bär `arvt_fran` när intervallet är ärvt.
- **Trösklarna läses per uppdrag** ur `contracts.troskel_*` och står i cachen,
  så att larmet går att läsa utan att slå upp avtalet. Ingen åtgärd skriver dem
  i den här storyn; standardvärdena kommer ur 0068 (5,00 %, 22 000 kr, 20 h,
  5 dagar).

- **Låset är transaktionsbundet:**
  `pg_try_advisory_xact_lock(hashtextextended(company_id::text, 0))`. Är det
  upptaget svarar åtgärden `{ "lage": "svep_avstod" }` och skriver ingenting —
  aldrig en tyst tom retur. Ingen frisläppning behövs: xact-varianten släpper vid
  commit **och** vid rollback, så ett kraschat svep kan inte lämna ett lås på en
  poolad anslutning (till skillnad från migratorns sessionslås). Ingen ny felkod:
  läget är ett resultat, och auditraden `action.executed:kor_uppdragssvep` skrivs
  av `executeAction` som för varje annan åtgärd.
- **Stängda uppdrag hoppas.** `projects.status` läses FÖRE varje skrivning, så
  0068:s `vagrar_skrivning_pa_avslutat()` aldrig träffas (FR-8) — annars hade ett
  uppdrag som avslutades i går fällt hela körningen. De listas i `hoppade`, och
  varken deras referenser eller deras köposter kommer med i arbetslistan.
  **Detsamma gäller `drive_kopior[]`:** kön delas bara ut för öppna uppdrag, men
  ett uppdrag kan stängas mellan två svep, och rapporten är en UPDATE på
  `uppdrag_referens` — samma trigger. En sådan rapport hoppas och redovisas i
  `hoppade_kopior[]` (`referens_id` + uppdraget). Köposten står kvar orörd, men
  delas aldrig ut igen så länge uppdraget är stängt.

**Förslagen är CACHE, aldrig en åtgärd.** De rör aldrig `uppdrag_leverabel` eller `receipts`. S3.2 bekräftar statusbytet, och bindningssteget nedan köar varje kostnadsbindning för en människas godkännande (Story 1.8).

- `statusforslag:<leverabel>` — skrivs när indatat rapporterar en **revision**
  för leverabelns handling. Repot avgör aldrig själv om en revision är "ny" (det
  ser inte Drive), och ett svep som gissade det ur sin egen cache hade slutat
  vara omräkningsbart. Koden prövas mot leverabelregistret; en kod som inte finns
  där ger inget förslag utan redovisas i `okanda_leverabelkoder`.
- `kostnadsforslag:<receipt_id>` — skrivs när ett **bokfört** kvitto utan
  avtalsdel har en leverantör vars namn står i en leverabelhandlings
  `titel_vid_lankning`. **Förslagets grövre nivå (`forslag_part_id`, `forslag_kod`) följer FR-33:** strömmen (avtalsdelen
  direkt under rotdelen) vars intervall täcker kvittots datum, annars rotdelen
  `UPPDRAG` — aldrig en leverabel, och aldrig en flytt: kvittots
  `contract_part_id` rörs inte. Täcker två strömmar samma datum vinner avtalets
  egen ordning (`sort_order`), så förslaget är detsamma vid varje körning.
- **Bindningssteget (S6.1)** körs efter förslagshärledningen, i samma
  transaktion, och verkar ENBART på körningens `kostnadsforslag:`-värden — se
  avsnittet nedan. Utfallet står per uppdrag i svarets `bindningar`
  (`koade` och `redan_koade`, plus `automatiska`, som är tom sedan Story 1.8 men står kvar eftersom svaret aldrig tappar fält).

**Övrigt-steget (Story 1.14, B-4)** står efter uppdragen (alltså efter
referenserna och spärrmappen) och före täckningen: först prövas och köas
`ovrigt_forslag[]`, därefter läses kandidaterna. En rad som just fått sin köpost
står alltså inte i arbetslistan, och täckningen ser körningens köposter. Ett
avstått svep prövar inga förslag.

**Svaret** bär `uppdrag[]` (per uppdrag `nycklar`, `skrivna`, `borttagna`,
`referenser_verifierade`, `okanda_leverabelkoder`), `hoppade[]`,
`hoppade_kopior[]`, `tackning[]`, `ovrigt` och `arbetslista`: `referenser` (`extern_id`, `extern_kalla`, `hash_vid_lankning`,
`status`, `senast_verifierad`), `drive_ko` ur `hamta_drive_ko`,
`ovrigt_kandidater` (Story 1.14) och `arbetslista.oppna_utkast[]` (Story 1.19).

- `arbetslista.ovrigt_kandidater[]` är `{ id, contract_id, text, datum }` för
  varje markerad Övrigt-rad i bolagets öppna avtal som saknar köpost (i någon
  status) och beslutsrad i radens eget avtal, också när avtalet inte står i
  indatat. `datum` är radens kalenderdag. Ordningen är avtalets och sedan radens
  skapandeordning.
- `arbetslista.oppna_utkast[]` är `{ utkast_typ, utkast_id, mottagare, amne, text, markor, byggd_nar }`
  för varje nej-utkast i bolaget, också i stängda uppdrag. Typen är
  `'beslut' | 'eskalering' | 'rapport'`, en sluten lista, och listan bär i dag bara
  nej-utkasten (typen beslut). Fälten kopieras ordagrant ur beslutsraden: utkastets
  id är beslutsradens id, mottagare, ämne och text är det frysta utkastet, markören
  är dess korrelationsmarkör, och mottagaren är null när kundkortet saknade en
  giltig adress när nejet registrerades. Tiden är när beslutsraden skrevs, i UTC med
  mikrosekunder (`YYYY-MM-DDTHH:MI:SS.ffffffZ`). Ordningen är radernas, och listan
  läses efter att mottagna beslut verkställts. Läsningen skriver ingenting, och
  svepets indata är oförändrat. Redovisningen skickar inget: Hermes lägger utkasten
  i Gmails utkastmapp (Story 1.20).
- `ovrigt` är `{ koade, redan_koade, avvisade }` och står alltid med, med tomma
  listor när inget förslag kom. `koade[]` är `{ anteckning_id, approval_id,
  atgard }`, `redan_koade[]` är radernas id (raden hade redan en köpost eller
  beslutsrad i sitt avtal), och `avvisade[]` är `{ anteckning_id, orsak }` med
  en av sju orsaker:
  - `anteckning_saknas` — raden finns inte i bolaget;
  - `inte_utanfor_avtal` — raden är inte markerad som utanför avtalet;
  - `uppdraget_stangt` — radens uppdrag är inte öppet;
  - `avtalsdel_saknas` — koden är ingen aktiv del i radens avtal;
  - `avtalsdel_upptagen` — vid tillägg: koden har en senare lagrad version, eller en baselineköpost för avtalet eller koden väntar eller är mottagen utan verkställighet;
  - `kallreferens_ogiltig` — en kallreferens håller inte referensens form (till exempel en url);
  - `underlag_ogiltigt` — underlaget eller köpostens indata går inte igenom åtgärdens schema (till exempel ett belopp som inte är ett säkert heltal).

  Ett avvisat förslag skriver ingenting, och raden står kvar som kandidat med
  täckningen `fel`. En **köad**
kopia står bara i kön, aldrig bland referenserna: dess `extern_id` är ännu
platshållaren, och en verifiering av den hade rapporterat "borta" om en fil som
aldrig skrivits. En okänd referens eller ett avtal i ett annat bolag ger **404
`not_found`** och hela svepet rullas tillbaka — ingen halvskriven cache.

**Täckningssteget (Story 1.6, B-3)** körs sist och läser bara egna tabeller.
Det går över alla öppna avtal (projektstatus `active`), även dem som inte står
i Hermes indata. Cachenyckeln `tackning` bär `godkannandekon`, `ovrigt`,
`kostnader` och `baselineforslag`, vardera `{ lage: 'last' | 'fel', saknas: id[] }`.
Källa och lästid finns i radens `kalla` och `last_nar`. Svarets `tackning[]` har
fyra poster per öppet avtal: `{ contract_id, kalla, lage, saknas }`.
`upsertSvepvarden` skiljer omfången `svep` och `tackning`: uppdragsstegen kan
aldrig skriva eller radera täckningsnyckeln, och täckningssteget rör bara den.
Ett avstått svep skriver ingen täckning. Indatat är oförändrat.

### Statusbytet med transmittal (S3.2, våg 4)

- `bekrafta_statusbyte` (write, **`kravManniska: true`**) — `contract_id`,
  `leverabel_kod`, `utfall` (`bekraftad` | `retur`), valfria `handling` och
  `mottagare`. Människan registrerar överlämningen ur handlingen eller returen
  (FR-12/FR-13, NFR-4). Ett agentanrop ger **403 `human_required`** i
  `executeAction`, före varje skrivning. Målstatusen härleds ur `utfall`
  (`levererad` / `avvisad`); leverabeln måste stå i `pagar`, annars **409
  `leverabel_ej_pagaende`**. Inget svepförslag krävs (FR-13, ”Struket”).
- **Handlingen krävs för överlämningen**, annars 400 handling_saknas.
  Objektet är strikt: `sort` är mejl eller drive, extern_id är Message-ID eller
  Drive-id och extern_kalla anger vilket konto den lästes ur. Ingen url eller
  sökväg godtas. Handlingen blir en rad i referenslagret eller återanvänds för
  samma kanoniska pekare i avtalet. En referens utanför spärrmappen ger
  409 utanfor_sparr; registerkopians egna poster återanvänds aldrig som handling.
  Returen får bära en handling men kräver den inte.
- **Transmittalen har sin källa.** Överlämningsdatumet läses ur handlingens
  händelsedatum, aldrig ur bekräftelsens tid eller `now()`. Saknar handlingen
  datum står ”Datum saknas”. Mottagaren förifylls ur `contracts.godkannare`
  och kan anges i `mottagare` (trimmat, i övrigt ordagrant). Saknas både angiven
  mottagare och avtalets godkännare skrivs ingenting (409 `saknad_mottagare`).
  Ett blankt angivet värde, eller en mottagare på en retur, ger 400.
  `bekraftat_av` är den inloggade användaren ur åtgärdskontexten.
- **Revisionen är systemets egen uppräkning:** `1 + högsta revision` bland
  leverabelns rader i `uppdrag_leverabel_handelse` (första överlämningen = 1).
  Returen och godkännandet bär `revision` NULL och räknas inte. Godkännandet
  ändrar aldrig överlämningens datum, mottagare eller revision.
- **Retur är en post, inte en tyst flytt bakåt.** Samma spår (`bekraftat_av`,
  `bekraftat_nar`), status → `avvisad`, revision och mottagare NULL.
- **Registerkopian köas i samma transaktion** som statusbytet
  (`koaRegisterkopia`, FR-11). Överlämningen orsakar inget utskick och inget
  beslutsutkast. Historiken är append-only: `app` har SELECT + INSERT på
  `uppdrag_leverabel_handelse` och ingenting annat (0068).
- **Migration 0099** är additiv och idempotent: händelsens kolumn referens_id
  pekar på handlingen. Nyckeln (id, company_id, contract_id) på referensen och
  händelsens sammansatta främmande nyckel binder handlingen till samma bolag och
  avtal. Registret läser referensens handelse_datum; äldre överlämningar behåller
  NULL utan backfill. Rättigheterna är orörda.

**Vyn:** handgreppen står på leverabelns kort i Leveranserna. Pågår bär
**Registrera överlämning** och **Retur**. Handlingen anges och mottagaren är
förifylld ur kontraktet, med eskalering och en synlig saknastext när den saknas.
Båda formulären postar till uppdragets befintliga vyadress för statusbytet;
adressens namn står kvar eftersom navigationskontraktet är genererat. Ingen yta
visar längre svepets statusförslag som en väntande uppgift. Husets fält och
knappar, inget nytt JS eller CSS.

### Skalans två andra övergångar (S2.1, våg 1)

**Flödet i sin helhet:** `ej_paborjad → pagar → levererad → godkand`, plus
retur-grenen `pagar → avvisad`. `bekrafta_statusbyte` ovan äger mittensteget och
returen; de två åtgärderna här äger ändarna. Före dem kunde ingen leverabel bli
`godkand` — alltså kunde inget uppdrag avslutas med en **tom** öppna-lista (FR-8),
hur färdigt det än var.

- `paborja_leverabel` (write, **`kravManniska: true`**) — `contract_id`,
  `leverabel_kod`, `nar?`, `notering?`. Flyttar `ej_paborjad` → `pagar`. Annan
  status ger **409 `leverabel_ej_ej_paborjad`** (samma felform som
  `leverabel_ej_pagaende`). **Ingen kanal och ingen mottagare:** ett påbörjande är
  ingen överlämning, och ett ifyllt transmittalfält hade sagt att det var.
- `godkann_leverabel` (write, **`kravManniska: true`**) — samma indata plus
  **`kanal`** (`telefon` | `mejl` | `mote` | `protokoll`, obligatorisk). Flyttar
  `levererad` → `godkand`; annan status ger **409 `leverabel_ej_levererad`**.
  Mottagaren läses ur `contracts.godkannare` — är den NULL eller tom skrivs
  **ingenting alls** (409 `saknad_mottagare`), exakt som i `bekrafta_statusbyte`
  (FR-13). HUR beskedet kom är hela dess bevisvärde den dag någon frågar; därför
  är kanalen obligatorisk och noteringen inte.
- **Ingen maskin flyttar en status.** Båda är `write` + `kravManniska` av samma
  skäl som `bekrafta_statusbyte`: ett agentanrop fälls i `executeAction` med **403
  `human_required`** före varje skrivning. Inget svepförslag krävs, lika lite som
  för `bekrafta_statusbyte` — stegen har ingen maskinell iakttagelse bakom sig
  alls, det är en människa som gjorde eller fick något.
- **En rad i `uppdrag_leverabel_handelse` per steg**, i samma transaktion som
  statusuppdateringen: `fran`/`till`, `bekraftat_av` ur åtgärdskontexten (aldrig
  ur indata), `bekraftat_nar` = `nar` om angivet annars `now()`, `notering`, och
  för godkännandet `kanal` + `mottagare`. **`revision` är alltid NULL:**
  uppräkningen räknar ÖVERLÄMNINGAR, och varken ett påbörjande eller ett
  godkännande är en — ett godkännande med revisionsnummer hade räknats som en
  leverans nästa gång.
- **Bakåtdatering med tak och golv:** `nar` i framtiden ger **400
  `framtida_datum`**, `nar` före avtalets `signed_date` **400 `fore_avtalet`**.
  Dagen jämförs mot databasens `current_date`, samma klocka som `now()`.
- Leverabeln låses med `SELECT … FOR UPDATE` före statuskontrollen (samma
  race-skydd som `bekrafta_statusbyte`), och **registerkopian köas om**
  (`koaRegisterkopia`) i samma transaktion — statusen står i kopians innehåll.
  Ett **avslutat** uppdrag fälls av 0068:s `vagrar_skrivning_pa_avslutat()` (409
  `rule_violation`), inte av en kopia av regeln i koden.
- **Migration 0072** (additiv, idempotent): `uppdrag_leverabel_handelse` får
  `kanal` (text, nullbar, CHECK som speglar zod-enumen) och `notering` (text,
  nullbar). Inget befintligt ändras; append-only står orört (`app` har SELECT +
  INSERT och ingenting annat).
- **Vyn:** stegen görs på leverabelns kort i Leveranserna (S10.9). Godkänn
  visar avtalets godkännare och godkännandeform före kanalvalet.

### Rutinvägen (Story 14.1)

**registrera_rutinstatus** (write, utan människospärr och utan kö) är den
fjärde skrivvägen in i leverabelns historik (FR-13). Hermes anropar den med en
källhändelse, och den registrerar bara det rutinregeln medger. Regeln är
Davids svar 2026-10-07 («Det räcker enligt din rekommendation») och bor i
`server/src/lib/rutinregel.ts`. Tjänsten skriver aldrig om villkoret.

- **Indata (strikt):** avtalets id (contract_id), leverabelns kod
  (leverabel_kod) och källhändelsen (kallhandelse). Det finns inget fält för
  läge, status eller mål: målet läses ur regelns stegtabell. Tom indata, ett
  okänt fält, en annan typ (påbörjande, retur) eller en url eller sökväg som
  handling ger 400 validation_error.
- **Två källhändelser, och ingen bär ett målläge.**
  - `transmittal`: handlingen (mejl eller drive, Message-ID eller Drive-id och
    kontot den lästes ur) och dagen. Ger `pagar → levererad`. Mottagaren är
    avtalets godkännare; saknas den fälls källhändelsen, för mottagaren gissas
    aldrig.
  - `godkannande`: handlingen, dagen, kanalen (telefon, mejl, mote eller
    protokoll) och avsändaren. Ger `levererad → godkand`. Avsändaren medges bara
    när den efter normalisering (trimmad, blanktecken sammanslagna, gemener) är
    exakt avtalets godkännare eller eskalering. Ingen delsträng och ingen
    namnlikhet räknas, och ett avtal utan båda parterna fäller. Modellen kan
    aldrig själv godkänna en leverabel.
- **Regeln och dess sex skäl**, i den ordning de redovisas: fel utgångsläge
  (**fel_utgangslage**), saknad mottagare (**saknad_mottagare**), obehörig
  avsändare (**obehorig_godkannare**), en obesvarad scopesignal i avtalet
  (**signal_tand**), ett larm i avvikelseindikatorn för leverabeln eller en
  nivå över den (**indikator_tand**) och en indikator som inte är läst
  (**indikator_olast**). Signalen pekar inte på en leverabel och fäller därför
  varje leverabel i avtalet. Kedjan uppåt räknas ur avtalsdelarna, och ett
  saknat larmutfall i svepets cache är oläst, aldrig friskt. Påbörjandet och
  returen har ingen källhändelse och går alltid människovägen.
- **Svaret har tre utfall.** **registrerad** bär händelsens id, från, status,
  revision, mottagare, referensens id, källhändelsens typ och nyckel samt
  registerkopians köläge. **redan_registrerad** betyder att samma källhändelse
  redan fanns, och ingenting skrivs. `falld` bär skälen och människovägens
  åtgärd (bekrafta_statusbyte eller godkann_leverabel).
- **Raden är märkt system:** `registrerad_av = 'system'` och bekräftaren
  (bekraftat_av) NULL. Handlingen står som referens, och godkännandets
  avtalspart, den som faktiskt godkände och ordagrant som i avtalet, står i
  mottagaren. Källans aktör tillskrivs aldrig registreringen. Dagen i
  bekräftelsetiden är källhändelsens dag, och registreringens tid står i
  created_at. Transmittalen räknar upp revisionen; godkännandet bär revision
  NULL och kanalen.
- **Datumfönstret är människovägens:** en dag i framtiden ger 400
  framtida_datum, och en dag före avtalets signering ger 400 fore_avtalet. Det
  är fel i Hermes indata, aldrig förslag till David.
- **Idempotens:** källhändelsens nyckel är sort och kanoniskt id, till exempel
  `mejl:godkant-L2@nvr.se`. Samma nyckel för samma leverabel och typ ger
  redan_registrerad under leverabelns radlås, och det unika indexet är sista
  försvarslinjen.
- **Det fällda blir ett förslag, aldrig ett tyst byte.** En fälld källhändelse
  skriver ingen händelse, ingen status och ingen referens, bara ett förslag i
  svepcachens reserverade nyckel `rutinforslag`, i ett eget omfång som svepet
  aldrig skriver. Förslaget står förifyllt på leverabelns kort i Leveranserna:
  överlämningens formulär får handlingen, och Godkänn får kanalen och dagen,
  med skälen i klartext. Det blir ingen post i undantagsvyn, ingen köpost och
  ingen rad på förstasidan eller i Läget. Ett medgivet byte tar bort förslaget
  för samma leverabel och typ.
- **Skrivmängden för ett medgivet byte** är sluten: handlingens referens (om
  den är ny), en händelse, leverabelns status, registerkopians köpost och
  borttagningen av ett äldre förslag. Ingen bekräftelsefråga och ingen köpost
  till David.
- **Migration 0100** (additiv, idempotent): händelsetabellen får registrerad_av
  (manniska eller system, standardvärdet manniska), kallhandelse_typ
  (transmittal eller godkannande) och kallhandelse_ref. Villkoret tillåter NULL
  i bekräftaren bara för system och kräver där källhändelsen och referensen.
  Det unika indexet ligger på leverabel, typ och nyckel. Rättigheterna är
  orörda: app har fortfarande bara SELECT och INSERT.
- De tre människospärrade åtgärderna (påbörjandet, statusbytet och
  godkännandet ovan) står kvar oförändrade.

### Kostnaden bunden till avtalsdelen (S6.1, våg 4)

- `binda_kostnad` (**sensitive**) — `receipt_id`, `contract_part_id`, valfritt `forslagsunderlag` (bara svepet köar det; annars 409 `koas_av_svepet`). Binder ett
  kvitto till en avtalsdel och gör ingenting annat (mönstret
  `assign_contract_part`, `services/uppdragKostnad.ts`). **`contract_part_id` är
  obligatoriskt:** `receipts` har inget `project_id`, så delen är kvittots enda
  bindning till uppdraget — en kostnad binds aldrig "till uppdraget" i
  allmänhet. Okänt kvitto eller okänd del ger **404 `not_found`** vid
  godkännandet, och hela godkännandet rullas då tillbaka (posten står kvar
  obesvarad, omkörbar). Ett avslutat uppdrag stoppas av 0068:s
  `receipts_vagrar_avslutat` (409 `rule_violation`), inte av en kopia av regeln
  i koden.
- **Känslig, inte `kravManniska`:** förslaget kommer utifrån (svepet), och kön är
  det som gör att en människa LÄSER bindningen innan den gäller — samma skäl som
  `andra_baseline`. Ingenting skrivs före godkännandet; åtgärden körs inuti
  `approveAction`:s transaktion och auditloggar `receipt.contract_part_assigned`
  med `fran_contract_part_id` → `till_contract_part_id`. **En flytt är tillåten**
  — det är precis vad kön är till för: en kostnad som är bunden till ström eller uppdrag ska gå att flytta
  till rätt leverabel. En leverabelbindning sätter `oplanerad: true`, eftersom
  avtalets baseline saknar kostnadsplan. Ingen bindning tar bort märkningen.
  Svaret och `receipt.contract_part_assigned` bär den faktiska märkningen.

**Svepets bindningssteg** (i `kor_uppdragssvep`, samma transaktion som svepet):

- **En väg för varje kostnadsförslag (B-6, Story 5.1).** Svepet förifyller ur handlingens titel, tidigare bindningar för leverantören och verifikattexten (också kvittots beskrivning), med datum mot delarnas intervall. Datum ensamt ger ingen kandidat. `forifyllBindning` väljer en leverabel bara när signalerna pekar på en enda aktiv leverabel, annars strömmen eller uppdraget. Underlaget bär skäl, källor, lästid och `forslag_hash`, aldrig belopp eller leverantörsnamn. Det prövas mot samma `BindaKostnadSchema` som registret och läsvägen, och målet ska finnas bland avtalets delar. Ogiltiga underlag redovisas i `bindningar.avvisade` med `underlag_ogiltigt`, utan skrivning för kvittot. Varje giltigt förslag köas med `createApproval`, actor `agent`, och `action.approval_requested` med `action`, `actor`, `receipt_id`, `leverabel_kod` och `forslag_hash`. `koade[]` bär också `forslag_hash`. Svepet skriver aldrig i `receipts`; bara verkställigheten av ett mottaget ja binder kostnaden. Cachen bär varken belopp eller leverantörsnamn.
- **Idempotent per kvitto i alla statusar.** `nyttBindningsforslag` läser alla kvittots köposter före köningen. `pending`, `approved`, `failed` och mottagna men inte verkställda beslut spärrar oavsett hash. En äldre post utan hash spärrar också. Avgjorda poster (`executed`, `rejected`) tillåter ett nytt förslag bara när samtliga har en annan `forslag_hash`. Oförändrat avslag återkommer aldrig som ny fråga; spärrade kvitton står i `redan_koade`.
- **Skälet följer förslaget.** `las_undantag` visar underlagets skäl i ordning, med dess källor och lästid. Ja-texten beskriver också märkningen när den gäller. Äldre förslag utan underlag behåller cacheradens text. Samma underlag fryses i `uppdrag_beslut`, där beloppet läses levande ur redovisningen före frysningen.
- **Kvitton utan kostnadsförslag rörs aldrig.** Ett bokfört kvitto vars
  leverantör saknar titelträff och tidigare bindning i avtalet, och vars text
  inte nämner uppdraget, är en allmän bolagskostnad — svepet avgränsas till körningens
  `kostnadsforslag:`-värden.

**Vyn:** kvittolistan (`/app/c/:id/receipts`) visar `oplanerad` som en `chip` i
statuskolumnen med husets befintliga komponent och tokens (kind `warn`), plus en
rad under tabellen som säger vad märkningen betyder — och bara när något faktiskt
är märkt. Ingen ny yta, ingen ny CSS, inget JS: bindningskön ligger i **Att göra**
som varje annat förslag.

### Avslutet med öppna leverabler (S8.1, våg 4)

- `avsluta_uppdrag` (**sensitive**, ingen `kravManniska`) — `project_id`.
  Avslutar uppdraget: fryser listan över det som stod öppet i
  `contracts.avslutat_med_oppna` och stänger sedan projektet
  (`services/uppdragAvslut.ts`). **Förslaget får köas av vem som helst — bara en
  människa godkänner** (1E Del 4). Okänt uppdrag ger **404 `not_found`** och ett
  redan avslutat **409 `uppdrag_redan_avslutat`**: listan är fryst historik (1E
  §3.1) och skrivs aldrig om. Ingen migration (0068 bär både kolumnen och
  triggern), ingen ny felkodsfamilj.
- **Listan räknas VID GODKÄNNANDET, aldrig när förslaget läggs.** Det faller ut
  av huset självt: `approveAction` kör handlern i godkännandetransaktionen
  (`execute.ts`), så en leverabel som hinner bli `godkand` däremellan står inte i
  listan. Ingen egen mekanik, och ingen egen får byggas.
- **Ordningen är lista → stängning, i EN transaktion.** Per avtal på uppdraget
  sätts `avslutat_med_oppna` till leverabelkoderna med status `<> 'godkand'`
  (parametriserat, `ORDER BY kod`), med auditraden `uppdrag.avslutat_med_oppna`
  (listan i `details`) i samma transaktion. **Tom array när inget står öppet** —
  NULL betyder därmed "aldrig avslutad via åtgärden". Först därefter stängs
  projektet, och 0068:s `vagrar_skrivning_pa_avslutat()` hinner alltså aldrig se
  ett stängt uppdrag före kolumnifyllnaden. Faller något rullas hela avslutet
  tillbaka.
- **Stängningen delegeras till tjänstefunktionen** `setProjectStatus(…,
  'closed')` — aldrig till `executeAction('set_project_status')`. Samma regel som
  `andra_baseline` följer mot `skrivBaselineversion`: `set_project_status` behåller
  sin `kravManniska` orörd, och `project.set_status`-auditraden skrivs som
  vanligt av tjänsten. Efter avslutet fäller triggern alla fyra räckvidderna
  (modultabellerna, `contract_parts`, `receipts.contract_part_id`,
  `time_entries.contract_part_id`) medan SELECT fortsätter gå igenom.

**Vyn:** uppdragets förstasida (`/app/c/:id/projects/:projectId`) visar för ett
STÄNGT uppdrag med satt `avslutat_med_oppna` en panel **Öppet vid avslutet**
högst upp — husets `.panel` (inte `.ai-card`: ockran betyder "väntar på en
människa", och här finns inget att svara på), med ett chip som bär färg, glyf och
tal, och koderna i klartext per avtal när uppdraget har flera. Ingen ny CSS,
ingen ny rutt, inget JS, ingen avslutsknapp: avslutet köas som varje annan
känslig åtgärd och godkänns i **Att göra**.

### Kontraktsytan (S10.6, våg 5)

- `las_kontraktsyta` (read, ingen `kravManniska`) — `contract_id`. Avtalets hela
  livscykel ur EN definition (FR-23, FR-38): `contract` (namn, uppdrag, kund,
  `kontrakt_tillstand`, `signed_date`), `dokument` (`source_file_id` +
  Drive-pekarna ur `uppdrag_referens` med `sort = 'drive'`), `gallande` (den
  version per delkod som GÄLLER, med `valid_from`, `change_reason`, taket och
  `cap_status`), `tillagg` (varje version utöver den första, i tidsordning, med
  `valid_from` och orsaken) och `scopelinje` (avtalets egna innanför/utanför/
  fraser/åtgärd i `ordning`). Okänt eller främmande avtal ger **404 `not_found`** —
  aldrig en tom yta, som hade sett ut som "avtalet är tomt".
- **Parterna och luckorna (Story 2.4).** `parter` bär `parter.godkannare`,
  `parter.godkannare_eskalering`, `parter.godkannandeform`, `parter.kalla` och
  `parter.lage` (`'angiven' | 'saknas' | 'ej_inlast'`), lästa genom `lasKontraktsparter`.
  `luckor` är samma beräkning och textkälla som importens svar. Utan register
  är kontraktet oläst och listan tom; ytan påstår då inget saknat i kontraktet.
  Leveranserna visar samma namn och lucktexter samt mottagarparten per avtal.
- **Scopelinjens läge (Story 2.6, FR-6 och FR-27).** Svaret bär också
  `scopelinje_lage: { markning, lage, saknade }`, räknat av den rena funktionen
  `scopelinjelage` i `server/src/lib/leveranskontrakt.ts`. `markning` är
  `'utkast' | 'gallande'` och härleds bara ur `contracts.kontrakt_tillstand`
  (fryst ger gällande). `lage` är `'inlast' | 'ej_inlast'`: utan en enda rad är
  scopelinjen inte inläst, och då är `saknade` tom i stället för att påstå fyra
  saknade delar. Annars är `saknade` de sorter ur
  `'innanfor' | 'utanfor' | 'fras' | 'atgard'` som saknar rad, i den ordningen.
  Ett utkast får aldrig scopelinjer genom importen, eftersom baselinen bara skrivs
  för ett fryst avtal efter Davids ja.
- **Ytan är vägen till dokumentet och registret över dess läge — aldrig en
  kopia** (NFR-12). Svaret bär `source_file_id` och Drive-referensernas
  `extern_id` och ingenting mer om handlingen; `includeContent` anropas aldrig
  härifrån, och `las_kontraktsyta` har med flit **ingen `include_content`-flagga**.
  Behöver anroparen själva handlingen finns `get_document` sedan K-serien, och
  den vägen byggs inte om. Ett kopietest i
  `server/test/uppdragsytan-kontraktsyta.test.ts` letar efter rader som står i
  handlingen men inte i baselinen (partsraden, rapporteringstakten,
  bilagerubriken, fältnamnen `content_base64`/`kontraktstext`) i både svaret och
  vyns HTML — och prövas åt båda hållen: sökaren ska FÄLLA ett svar där en
  kontraktsrad smugits in, annars mäter provet ingenting.
- **Ingen fjärde datamängd, ingen omräkning.** Avtalet och delarna kommer ur
  `listContracts`, alltså ur husets enda takberäkning: den gällande versionen är
  `Delforbrukning.part_id` och ingen egen regel. `services/contracts.ts` utökades
  bara additivt — `c.kontrakt_tillstand` i avtalsraden och `change_reason` i
  `Takversion` — utan migration (båda kolumnerna finns i 0064/0068).
- **Ett tillägg är en version utöver den första.** Delen är koden, raderna är
  dess versioner: den tidigaste `valid_from` är avtalet som det skrevs, varje rad
  efter den är ett tillägg och bär det `change_reason` som 0068:s trigger kräver.
  `gallande: true` markerar den version som gäller i dag — en version med
  framtida `valid_from` är skriven men gäller inte än, och tigs inte ihjäl.

**Referensfält (Story 3.1).** `dokument.referenser[]` bär även
`handelse_datum` (null = datum saknas). Drive-referenser i `utanfor_sparr`
utesluts ur registerdokumenten och redovisas med sina id i
`dokument.utanfor_sparr`, också som tom lista.

**Vyn:** `/app/c/:id/projects/:projectId/kontraktet`, undersida till uppdraget
(knappen **Kontraktet** sist i knappbandet, efter *Planen* — husets ruttmönster,
ingen `.subnav`: menyn ägs av S10.7). Fyra paneler per avtal, i läsarens
frågeordning: **Vägen till dokumentet** (länk till husets dokumentarkiv för
`source_file_id`, och Drive-pekarna med härledd öppningslänk, id, nyckelrymd,
källa, status, verifieringstid och händelsedatum), **Det som gäller nu**, **Tilläggen** med orsaken i den
bredaste kolumnen, och **Vad som ingår**. Ett avtal i `kontrakt_tillstand =
'utkast'` byter rubrik till **Utkastets delar** och säger rakt ut att ingenting
där gäller; utkastets obesvarade frågor hänvisas till handlingen och återges
aldrig. JS-fri serverrenderad HTML, inga externa anrop under rendering (NFR-6),
ingen ny CSS och inga nya komponenter.

**Vad som ingår (Story 2.6).** Panelen ritas av en enda funktion,
`scopelinjepanel` i `server/src/http/view/routes.ts`, på Kontraktet och sist på
Läget (en panel per avtal, efter **Beslut och utkast**, med egen färskhetsrad).
Huvudets märke är markeringen ur svaret: *Gällande* (✓) för ett fryst avtal,
*Utkast* (◔, samma ockra som sidhuvudet) för ett utkast. Inläst scopelinje
visas i fyra grupper: *Innanför uppdraget*, *Utanför uppdraget*, *Fraser att
lyssna efter* och *När en signal tänds*, där åtgärdens styckebrytning står kvar.
En saknad del står kvar som grupp med märket *Saknas* och meningen ”Saknas i
kontraktet. Det gissas inte här — en ny kontraktsversion fyller det.” Utan en
enda rad säger panelen att scopelinjen inte är inläst, för ett utkast att den
står i handlingen tills kontraktet är fryst. Panelens enda länk går till
uppdragets Signaler. Ingen ny rutt, ingen delningsvy och ingen yta utan
inloggning visar scopelinjen (NFR-9).

### Läget (S10.1, våg 6)

- `las_uppdragslage` (read, ingen `kravManniska`) — `project_id`. Uppdragets läge
  ur EN definition (FR-18, FR-23): `uppdrag` (nummer, namn, status, kund),
  `avtal[]` med **`forbrukning`** (rotdelens upprullade minuter och ören, taket i
  hela minuter/ören, `tak_status`, plus tidsunderlaget `tidposter` och
  `registrerade_minuter`), **`troskellarm`** (S6.2:s redan härledda larm ur
  svepets cache, `null` = svepet har inte kört), **`leverabler`** (alla fem lägen
  i skalans ordning med antal — uppräknade tillstånd, aldrig procent),
  **`bedomning`** (senaste raden plus `forsta_meningen` ur kommentaren, med
  `satt_av_namn` och `begaran_id` sedan Story 1.10), **`oppen_begaran`**
  (avtalets obesvarade begäran eller `null`) och
  **`oppna_signaler`/`signalhistorik`/`avgjorda_signaler`** (`signalhistorik`
  är de avgjorda signalerna med alla sina avgöranden, Story 1.9; tilläggets
  version nås genom avgörandets `tillagg_approval_id` och
  `beslut.registrerade[].approval_id`), **`scopelinje`** (samma rader som
  kontraktsytan, ur `lasScopelinjer`) och
  `scopelinje_lage: { markning, lage, saknade }` (samma funktion som
  kontraktsytan, med avtalets `contracts.kontrakt_tillstand`; Story 2.6), samt uppdragets **`koposter`** och
  **`beslut`** (Story 1.7: `registrerade` med val, fryst underlag, handling, källreferenser och beslutsfattare/tid, och sedan Story 1.16 `utkast` (`{ mottagare, amne, text }` eller `null`) och `utkast_markor` (sträng eller `null`); `mottagna` med bara `approval_id`, `atgard`, `utfall`, `beslutad_nar`) och **`farskhet`** (en post per innehållsdel, även `beslut`). Lägets panel **Beslut och utkast** visar mottagna mandat utan ny kvittens och registrerade beslut med skäl, källa och handling, och under ett registrerat nej på en kundförfrågan ur Övrigt svarsutkastet med en `mailto:`-länk som David själv skickar från. Ett upprepat svar på Att göra leder till beslutets ankare; vanliga lyckade svar leder tillbaka till Att göra. Okänt eller främmande `project_id` —
  och ett projekt UTAN avtal — ger **404 `not_found`**: ett projekt utan avtal är
  ett projekt, inte ett uppdrag, och en tom yta hade sagt att uppdraget saknade
  sina delar i stället för att det saknades.
- **Måtten och rytmen (Story 2.3, FR-19, FR-14, FR-35):** varje avtal bär
  `matt[]` och `rytm`. Ett mått är raden ur del 3
  (`{ namn, hur_ofta, kallreferenser, lasvag, larmregel, larmregel_lage, utfall_lage, ordning }`)
  med `varde`: `null` när utfallet inte härleds, annars ett `Lasvarde` med
  källa och lästid. ”Nedlagd tid mot ram” bär avtalets förbrukning som
  `{ minuter, tak_minuter, tak_status }` — två tal, aldrig en kvot, och takets
  status — med samma källa, lästid och läge som förbrukningen, så att en källa
  som inte kunde läsas visas som oläst och aldrig som noll, och ett obekräftat
  tak aldrig visas som en ram. `rytm` är rytmkolumnerna, ankaret och dess källa
  plus `{ lage, period, nasta }` ur rytmregeln för läsvägens UTC-dag. Färskheten
  får `farskhet.matt` och `farskhet.rytm`, båda direktlästa ur redovisningen.
- **Nästa leverans (Story 4.3, FR-45):** varje avtal bär
  `avtal[].nasta_leverans`, ett `Lasvarde` med källan redovisningen och
  läsvägens lästid. Värdet är antingen ”ingen” (tomt register, eller varje
  leverabel överlämnad eller godkänd) eller ”nasta” med kod, läge, namn,
  acceptanskriterium, datum, mottagare och revision. Varje värde bär sin
  källa: registret, baselinen, kontraktet eller överlämningen. Regeln står i
  `nastaLeverans` i `server/src/lib/nastaLeverans.ts`: bara ej påbörjad,
  pågår och avvisad kan stå i tur. Ordningen är tidigaste slut av eget eller
  ärvt intervall ur `byggPlan`, därefter L-numret räknat som tal; odaterade
  står sist med ”datum saknas”. Före första överlämningen är mottagaren
  avtalets mottagarpart, märkt ”ur kontraktet, ingen överlämning ännu”, och
  beskedet säger ”nästa överlämning blir revision 1”. Efter en överlämning
  visas transmittalens mottagare och revision, och nästa revision är den
  registrerade plus ett. Ingenting lagras, inget statusfält eller kolumn
  tillkommer, och ordningen är ingen prioritering. Beskedet visas i Lägets
  kort Leverabler per läge med dess befintliga färskhetsrad.
- **Beslutens referenser (Story 3.1):** `beslut.registrerade[].referenser[]`
  bär `status`, `senast_verifierad` och `handelse_datum` ur referensraden.
  Det frysta underlaget och `forslag_hash` ändras inte; källorna fryses som id.
- **Ingenting räknas om (FR-25).** Förbrukningen kommer ur `getContractUsage`
  (husets enda takberäkning — samma tal som takvarningen och faktureringsspärren
  läser), tidsunderlaget ur `listTimeEntries` med husets eget `arIgnorerad`,
  registret ur `lasLeverabelregister`, bedömningen ur `listaBedomningar`,
  signalerna ur `listaSignaler` och kön ur `listApprovals`. Tröskeln HÄMTAS ur
  `uppdrag_svepvarde` — att utvärdera FR-3:s dubbelvillkor en andra gång hade
  gett två svar på "larmar det?".
- **Färskhet per källa, aldrig en sidstämpel (FR-35).** De direktlästa
  delarna, sedan Story 2.6 också `farskhet.scopelinje` och sedan Story 4.3
  `farskhet.nasta_leverans`, bär
  `kalla: 'redovisning'` och läsningens tidpunkt; tröskeln bär den
  `last_nar` som står på svepets egen `troskellarm`-rad. `farskhet.troskel = null`
  betyder "svepet har inte kört" — inte "inga larm", och ytan skriver ut
  skillnaden i stället för att visa ett gammalt värde som färskt.
- **Köfiltret ligger i tjänsten.** Kön är hela bolagets; en post hör till
  uppdraget när dess indata namnger `project_id`, ett av avtalen (`contract_id`)
  eller en av avtalsdelarnas versioner (`contract_part_id`, vägen `binda_kostnad`
  tar). En post som namnger inget av dem gissas aldrig hit.

**Vyerna:** `/app/c/:id/projects/:projectId/laget` (knappen **Läget** först i
uppdragets knappband) och listan `/app/c/:id/uppdrag`. Läget bär
handgreppsbandet överst — köposter, öppna signaler och svepets statusförslag,
byggt med husets `.ai-card`, chip och knappband, med en rad per handgrepp som
leder dit svaret ges — och därunder FR-18:s fem faktakort, alltid alla fem, var
och ett med sin `.farskhet`-rad. Saknar ett kort sin innehållsdel renderas det
ändå, med en mening om vad tomheten betyder och en väg vidare (FR-22) — aldrig en
naken nolla. Tomt band byter från `.ai-card` till `.panel`: ockran betyder
"väntar på en människa". Sidan bär `.subnav` till uppdragets undersidor
(`aria-current="page"` på exakt en post). Listan visar ett uppdrag per rad
(projekt med minst ett avtal, härlett ur `listContracts`) med läge ur den
senaste bedömningen — saknas den står *Saknad*, aldrig grönt — och färskheten ur
uppdragets svepvärden. Två nya klasser i `html.ts`: `.farskhet` och `.subnav`.
Ingen migration, inget nytt beroende, JS-fri HTML, inga externa anrop under
rendering (NFR-6).

Sist på Läget står sedan Story 2.3 panelen *Uppföljning och rytm*, en per
avtal med sin egen `.farskhet`-rad. Varje mått visas med namnet, läsvägen som
chip (en saknad läsväg i rött), hur ofta, var siffran läses och larmregeln
ordagrant. Utfallet är tiden mot ramen med sin färskhet och takets status med
samma chip som kortet Förbrukning mot ram (ett tak som inte är läst står med
husets ord, aldrig som något kontraktet skulle sakna), ett oläst värde i
`.tomt` med källan och senaste lästid, eller ”utfall HÄRLEDS EJ”. Ett tomt fält
står som inte inläst. En larmregel
som inte härleds märks ”larmregel HÄRLEDS EJ”, och ”— kräver Davids svar” läggs
till när regeln kräver en andel. Rytmen visar texten, mottagarkretsen, ankaret
med sin källa och nästa bedömningstillfälle, eller i `.tomt` samma mening som
Bedömning och undantagsvyn visar. Länken till Bedömning, där ankaret sätts,
står bara där Bedömning har ankarformuläret (samma regel: aktivt uppdrag, det
avtal Bedömning visar, rytm men inget ankare); ett avslutat uppdrag och ett
avtal som Bedömning inte visar har meningen men ingen länk. Panelen har inget
formulär och inget inmatningsfält.

### Övrigt — anteckningsloggen (överlämning #268)

- `skriv_uppdragsanteckning` (write, **`kravManniska: true`**) — `contract_id`,
  `text` (1–2 000 tecken) och `utanfor_avtal` (valfri, default `false`). Skriver
  EN rad i uppdragets anteckningslogg (`uppdrag_anteckning`, migration 0073) och
  svarar med raden: `id`, `contract_id`, `text`, `utanfor_avtal`, `skriven_av`,
  `skriven_av_namn` och `created_at`. Ett agentanrop (MCP) fälls i
  `executeAction` med **403 `human_required`** före varje skrivning: raden är
  människans egna ord (0072:s princip), och en AI-skriven anteckning i en
  append-only logg är en gissning som inte går att ta tillbaka.
- **Aldrig en tyst tom rad.** Tom text fälls av zod-schemat (400
  `validation_error`), blanktecken av tjänsten (400 `tom_anteckning`) och båda av
  0073:s CHECK för kod som inte går genom tjänstelagret. Ett okänt eller
  främmande `contract_id` ger **404 `not_found`**.
- **Append-only i rättigheterna, inte i en konvention.** `app` har SELECT +
  INSERT på `uppdrag_anteckning` och ingenting annat — samma tre försvarslinjer
  som `audit_log` (0003) och `uppdrag_bedomning` (0068). Raden går alltså varken
  att ändra eller ta bort; nästa rad rättar. `skriven_av` läses ur den inloggade
  användaren och kan inte skickas in (`.strict()`).
- **Ingen automatik.** Bocken *utanför avtalet* är en markering att läsa, aldrig
  en trigger: ingen rad blir ett tillägg eller en scopesignal av sig själv, och
  någon "behandlad"-status finns inte. En markerad rad står i svepets
  arbetslista (`ovrigt_kandidater`), och ett förslag som servern prövat blir en
  fråga i undantagsvyn (Story 1.14). `contracts.notes` (avtalsformulärets
  *Anteckningar*) och `projects.notes` är orörda — de är en annan sak.

**Vyn:** panelen **Övrigt** sist på Läget
(`/app/c/:id/projects/:projectId/laget`), i full bredd under FR-18:s fem kort.
Raderna nyast överst i husets `.log` — datum i mono-axeln, avsändare och
markeringen *Utanför avtalet* (chip med färg, glyf och ord) på flaggade rader,
och orden själva som postens huvudtext. Panelhuvudet räknar de flaggade raderna
i klartext ("2 rader gäller arbete utanför avtalet"); är ingen bockad sägs det.
Under listan ett formulär med textarea, kryssrutan *Gäller arbete utanför
avtalet* och knappen *Lägg till* — fälten och meningen om att raden inte går att
ändra står FÖRE knappen. Posten går genom `executeAction` (actor `human`, lärdom
5) och landar tillbaka på Läget med raden synlig; en tom rad kommer tillbaka som
`?fel=` i sidans notis. Ingen ny CSS-klass, ingen JS.


### Övrigt-raden blir en fråga (Story 1.14, B-4)

**Kandidaten och prövningen.** Svepet lämnar varje markerad Övrigt-rad utan
köpost och beslutsrad i arbetslistan (`ovrigt_kandidater`). Hermes formulerar
ett förslag per kandidat och skickar det i `ovrigt_forslag[]`. Servern prövar
förslaget mot egna tabeller, i svepets transaktion efter bolagslåset: raden finns
i bolaget, är markerad och saknar köpost och beslutsrad i sitt avtal, uppdraget
är öppet, och koden är en aktiv del i **radens** avtal. Avtalet tas alltid ur
raden, aldrig ur förslaget. Radens text väljer aldrig åtgärd, avtalsdel eller
alternativ.

**Beräkningen** (`lib/beslutsunderlag.ts`) görs av servern och aldrig av Hermes.
Taxan är `contracts.hourly_rate_ore`, förbrukningen och taket den valda delens
post i `get_contract_usage` (den gällande versionen, med barnen upprullade).
Beloppet är timmar × taxa i ören, räknat i hundradelar av timmar och avrundat
med `roundOre`. Tiden räknas i hela minuter. Vid ryms räknas återstående utrymme
mot delens tak, och vid tillägg mot det nya taket (delens eget tak plus
timmarna). Saknade timmar eller taxa ger `null`, aldrig 0 kr. Underlaget fryses i
köpostens `beslutsunderlag`: `anteckning_id`, `anteckning_datum`, `alternativ`,
`avtal_namn`, `avtal_signerat`, `avtalsdel_kod`, `avtalsdel_namn`,
`avtalsdelar[]` (`kod`, `namn`, `tak_minuter`, `forbrukade_minuter`,
`tak_bekraftat`), `taxa_ore`, `tak_minuter`, `tak_bekraftat`,
`forbrukade_minuter`, `timmar`, `minuter`, `belopp_ore`, `nytt_tak_minuter`,
`giltig_fran`, `kvar_fore_minuter`, `kvar_efter_minuter`,
`scopelinjer_innanfor[]`, `scopelinjer_utanfor[]`, `forslagstext`, `skal`,
`kallor[]` (först Övrigt-raden, sedan en `referens` per unik kallreferens, med
`handelse_datum` när det fanns) och `last_nar`.

**Köposten per alternativ**, köad med `actor: agent`, en gång per rad:
- `tillagg` → `andra_baseline` med en fullständig ny version av den gällande
  avtalsdelen: dess fält kopieras, `cap_hours` blir det nya taket (står kvar när
  timmarna eller det egna taket saknas), `cap_amount_ore` ökas med beloppet när
  båda finns, `change_reason` är `Tillägg: <radens text> (Övrigt-raden <datum>)`
  och `valid_from` är radens datum, eller dagen efter den gällande versionen när
  den är lika ny eller nyare. Tillägget köas bara när den gällande versionen är
  kodens senaste och ingen `satt_baseline` för avtalet eller `andra_baseline`/
  `upsert_contract_part` för koden väntar eller är mottagen utan verkställighet;
  annars `avtalsdel_upptagen`.
- `ryms` → `registrera_uppdragsbeslut` med `{ contract_id, kalla, beslutsunderlag }`.

Indatat prövas mot åtgärdens eget schema före kön, så ett ja och ett nej alltid
tas emot. Kallreferenserna blir pekare i `uppdrag_referens`; mejlets innehåll når
aldrig redovisningen. Auditraden `action.approval_requested` bär
`{ action, actor: 'agent', anteckning_id, alternativ }`, aldrig text.

**`registrera_uppdragsbeslut` (sensitive, `tvafas`)** — "Registrera att en
förfrågan ur Övrigt ryms i avtalet". Indata `{ contract_id, kalla: { typ:
'anteckning', id }, beslutsunderlag }`, strikt, med underlagets `alternativ:
'ryms'` och samma rad som källan. Ett ja registrerar beslutsraden (`alternativ:
'ryms'`, handlingen `{ typ: 'ryms', anteckning_id, avtalsdel_kod }`) och ändrar
ingen avtalsdel. Ett nej med skäl går genom `avboj_beslutsforslag`.
Verkställigheten prövar att raden hör till avtalet och är markerad, annars 409
`kalla_annat_avtal` och mandatet står kvar för återförsök. Fel: 400
`validation_error`, 403 `human_approval_required` (ja av en agent) och
`human_required` (nej av en agent), 409 `not_pending`.

**En väg in.** `registrera_uppdragsbeslut` och `andra_baseline` med
`kalla.typ = 'anteckning'` ger **409 `koas_av_svepet`** när någon anropar dem
direkt, genom REST eller MCP, människa som agent: förslaget räknas av servern
och köas bara av svepet. Ingen köpost, auditrad eller domänskrivning uppstår.

**`andra_baseline`** har två nya fält: `kalla` får typen `anteckning`, och
`beslutsunderlag` (det frysta underlaget) krävs med den och bara med den. Källan
anteckning tillsammans med `signal_id` ger 400. Underlagets `alternativ` är
`tillagg`, dess rad är källans, dess kod är `code` och dess `giltig_fran` är
`valid_from`. Verkställigheten av ett sådant tillägg prövar raden som ryms gör.
Auditraden `contract_part.created` för en ny avtalsdelsversion bär inte längre
`change_reason`; orsaken står kvar i `contract_parts.change_reason`.

Hermes formulering finns sedan Story 1.17 (`uppdragssvep.py`, förslagen i körningens
andra anrop). Nej-utkastet finns sedan Story 1.16 (nedan).

### Kompletteringen och ersättningen (Story 1.15, B-2)

**`komplettera_beslutsforslag` (write, `kravManniska: true`)** — "Fyll i timmar i
en fråga ur Övrigt och få förslaget omräknat". Indata `{ approval_id, timmar }`,
strikt: `approval_id` är en väntande Övrigt-köpost i bolaget, och `timmar` är ett
tal större än noll med högst två decimaler, högst 999 999,99. Svaret är
`{ approval_id, ersatt_av }`. Kompletteringen gäller varje väntande Övrigt-fråga,
också en som redan har timmar.

**Ersättaren.** I en transaktion låses den väntande köposten, och en ersättare köas
med samma källa, alternativ, avtalsdel, skäl och källor, Davids timmar och en
beräkning som servern räknat om ur egna tabeller med samma byggare och samma
schema som svepets förslagssteg. Ersättaren köas med den gamla postens begärare.
Den gamla posten blir `rejected` med `ersatt_av` lika med ersättarens id och utan
beslutsfält (`decided_by`, `decided_at`, `beslut_hash` och `beslut_skal` är tomma).
Den är **inget nej**: läs `ersatt_av`, aldrig `rejected` ensamt. Ingen beslutsrad,
inget nej-utkast och ingen domänhandling skapas förrän David svarar ja eller nej på
ersättaren, och ja godkänner alltid den lagrade ersättaren.

**Fel:** 400 `validation_error`, 403 `human_required` (agentens nyckel), 404 för en
köpost som saknas i bolaget, och 409 `not_pending`, `inte_ovrigtforslag`,
`kalla_annat_avtal` (också när raden saknas eller inte är markerad),
`uppdraget_stangt`, `avtalsdel_saknas`, `avtalsdel_upptagen` (en annan
baselineändring för koden väntar, eller en version börjar senare) och
`underlag_ogiltigt`. Ett prövningsfel skriver ingenting.

**En ersatt post går inte att avgöra igen.** Godkänn (`approvals/:id/approve`),
avvisa (`approvals/:id/reject`), `avboj_beslutsforslag` och
`komplettera_beslutsforslag` ger 409 `not_pending`. Återförsöket och Läget utesluter
den, och undantagsvyn visar bara ersättaren.

**Auditraden** `uppdrag.forslag_kompletterat` har `entity_type = 'approval'`,
`entity_id` lika med den gamla postens id och `details = { approval_id, ersatt_av,
atgard }`, utan fritext och utan timmar.

### Nej-utkastet (Story 1.16, B-5)

**När.** Ett mottaget nej på en köpost vars källa är en Övrigt-rad (en kundförfrågan)
ger ett svarsutkast i beslutsraden. Utkastet skrivs i verkställigheten, i samma
INSERT som nej-raden (`uppdrag_beslut.utkast` och `utkast_markor`, migration 0084),
genom alla ingångar till nejet: `avboj_beslutsforslag`, `approvals/:id/reject`, Att
göras avvisa och undantagsvyns nej. En ersatt köpost (Story 1.15) eller ett avslag
utan `beslut_hash` får aldrig något utkast, och ett nej på någon annan källa
(köförslag, kvitto, scopesignal, baselineförslag, avslut) får inget.

**Markören** är `[ref U<uppdragsnummer>-B<löpnummer>]`, till exempel `[ref U12-B17]`:
uppdragets nummer, `B` för beslut och ett löpnummer ur bolagets nummerserie
`uppdrag_beslutsutkast` (`number_sequences`, luckfri och tillbakarullad med
transaktionen). Den är unik per bolag (`UNIQUE (company_id, utkast_markor)`), har en
CHECK på formen och sätts bara på en rad med utkast.

**Utkastet** är `{ mottagare, amne, text }`:
- `amne` är `Svar på förfrågan den <datum>, uppdrag <nummer> <markör>`, där datumet
  är Övrigt-radens;
- `text` är en fast mall (hälsningen, meningen om förfrågan, ”Vårt svar är nej.”,
  ”Skäl:” och avslutningen) med förfrågan och Davids skäl som enda insatta värden;
- `mottagare` är e-postadressen på kundkortet, för avtalets kund och annars
  uppdragets, prövad som e-postadress, och `null` när den saknas eller inte är en
  giltig adress. Förfrågans text styr aldrig mottagaren.

Utkastet är fryst i beslutsraden och räknas aldrig om. Hör Övrigt-raden inte till
förslagets avtal, eller är den inte markerad, ger verkställigheten 409
`kalla_annat_avtal`; nejet står då kvar som mottaget beslut utan verkställighet och
syns som driftpost.

**Utskicksgränsen.** Redovisningen skickar inget. David läser utkastet i Lägets panel
**Beslut och utkast** och skickar själv genom `mailto:`-länken ”Öppna utkastet i din
e-post”, som öppnar hans egen e-postklient. Referensen i ämnet är det som gör att
utskicket känns igen. Hermes kan läsa utkastet genom `las_uppdragslage`
(`beslut.registrerade[].utkast` och `utkast_markor`) och sedan Story 1.19 i svepets
arbetslista (`arbetslista.oppna_utkast[]`). Länken i panelen är reserv sedan Davids
svar 2026-10-07 om Gmails utkastmapp: Hermes lägger utkastet där (Story 1.20), och
David skickar själv. Provet ”Davids utskick”
(`uppdragsytan-utskick.test.ts`) håller tillåtelselistor över nätets utgångar,
paketlistan och e-postköns importörer i hela `server/src`.


### Undantagsvyns läsväg (Story 1.6, B-3)

- `las_undantag` (read, ingen `kravManniska`) — utan indatafält; schemat är
  strikt tomt. REST, MCP och den kommande vyn använder samma `lasUndantag`.
- Svaret bär `utfall`, `poster[]`, `tackning[]`, `ofullstandig_tackning[]`,
  `aldsta_tackning`, `hoppade[]` och `last_nar`. Posterna bär `slag`, `id`,
  `identitet`, `atgard`, `foreslagen_av`, `skapad_nar`, `uppdrag`, `val`,
  `varfor_mandat`, `forslag`, `skal`, `kallor` och `ja_registrerar`, och
  posten `ny_bedomning` dessutom det valfria fältet `bedomning`. Posten
  `ovrigt_beslut` bär det valfria fältet `ovrigt`: `forfragan` (Övrigt-raden:
  `id`, `text`, `datum`, `utanfor_avtal`) och `underlag` (det frysta
  underlaget), båda som `Lasvarde` (Story 1.14).
- `ovrigt.andrat` (Story 1.15) är det frysta förslaget jämfört med aktuella
  källor, som `Lasvarde<{ delen_finns, upptagen, andringar[] }>`. En ändring är
  `{ falt, forslag, nu }`, och `falt` är ett av sju i fast ordning: `taxa_ore`,
  `tak_minuter`, `forbrukade_minuter`, `belopp_ore`, `nytt_tak_minuter`,
  `kvar_fore_minuter` och `kvar_efter_minuter`. En ändring står bara när värdena
  skiljer sig. `delen_finns` är falskt när koden inte längre är en aktiv del i
  avtalet, och `upptagen` är sant när ett tillägg inte kan räknas om eftersom en
  annan baselineändring för koden väntar eller en version börjar senare (samma
  villkor som svepets förslagssteg). Kunde beräkningen inte göras är läget
  `olast`. Ja godkänner alltid det lagrade förslaget; den som vill ha nya värden
  kompletterar. Vyn visar inte kompletteringen när `delen_finns` är falskt eller
  `upptagen` sant.
- **Källreferenser (Story 3.1):** objekt med `typ: 'referens'` i `kallor`
  bär `status`, `senast_verifierad` och `handelse_datum`. Null visas som
  ”aldrig verifierad” respektive ”datum saknas”. Statusen föds `overifierad`;
  en referens är en källa till posten och skapar aldrig ett eget postslag.
- Den stängda listan har sex postslag. `baselineandring` kommer ur väntande
  `satt_baseline`, `andra_baseline`, `upsert_contract_part` eller
  `update_contract`; `kostnadsbindning` ur väntande `binda_kostnad`;
  `ovrigt_beslut` ur väntande `registrera_uppdragsbeslut` eller `andra_baseline`
  med Övrigt-raden som källa (Story 1.14); `avslut`
  ur väntande `avsluta_uppdrag`; `scopeavgorande` ur en tänd signal utan
  rad i `uppdrag_scopeavgorande`; `ny_bedomning` ur en obesvarad rad i
  `uppdrag_bedomningsbegaran` (Story 1.10). Rutin, drift, tröskellarm och referensfel blir inga poster.
- Kön läses utan `LIMIT`, i ordningen `created_at, id`. Signalposterna står
  därefter i `tand_nar, id`. Inget belopp filtrerar, inget tak eller urval kan
  skickas in. `listApprovals` behåller Att göras fönster.
- `Lasvarde<T>` är `{ varde, kalla, last_nar, lage }`. Lägena är `last`,
  `olast` (källan kunde inte läsas) och `saknas` (värdet finns inte i
  underlaget). De två senare har `varde: null`. Postens lästa fält är
  `uppdrag`, `forslag`, `skal` och `kallor`; täckningspostens är `tackning`.
  Skäl och referenser ur cache behåller cacheradens källa och lästid.
- När ett baselineförslag byter kund, avtalshandling eller föräldradel har
  `forslag.varde.mal` respektive `customer_id`, `source_file_id` eller
  `parent_part_id` som `Lasvarde`. Värdet identifierar kunden (id, kundnummer,
  namn, organisationsnummer), filen (id, originalnamn, SHA-256, byteantal)
  eller delen (id, kod, namn, versionsdatum). Uppslag sker bara i bolaget;
  en föräldradel måste också höra till samma avtal. Saknat mål har
  `lage: 'saknas', varde: null`. Texten beskriver det föreslagna målet;
  kundens sida och den föreslagna handlingens nedladdning finns i `kallor`.
- Versionsförslag beskriver alla angivna verksamhetsfält, även `description`,
  `billable`, `active` och `sort_order`, med särskiljande värden. Datumprecision
  skrivs på svenska och angiven start/slut visas var för sig.
  `ja_registrerar` skiljer en ren `upsert_contract_part`-takbekräftelse på
  **befintlig version** från en **ny version**. Effektivt versionsdatum är
  explicit `valid_from`, annars avtalets lästa `signed_date`; saknas båda
  anges datum som saknat, utan att härledas ur kötid eller klocka.
- Story 2.2 (B-7 punkt 6, FR-2): för en post vars ja skriver en ny version
  (`satt_baseline`, `andra_baseline` i båda slagen och `upsert_contract_part`
  utom ren takbekräftelse) slutar `ja_registrerar` med
  `Versionen får orsaken ”<orsak>”.` före beslutsraden, och med
  `Orsaken saknas i förslaget.` när köposten saknar orsak. Orsaken är den som
  ett ja registrerar: importens `avtal`, köpostens `change_reason` (signalens
  eller Davids ord, Övrigt-radens text och datum). Samma text fryses i
  beslutsradens `underlag.ja_registrerar`, också vid ett nej.
- **Förslagets underlag (Story 2.8).** Baselineförslagets förklaring räknar
  parter, ankare och luckor med samma funktion, `forslagsunderlag`, som
  importens svar. `skal.varde` får en mening per skillnad mellan textens och
  manifestets parter, med båda värdena och att manifestets värde gäller,
  samt ankarets orsak när manifestet anger ett ankare. Efter ”Luckor i
  kontraktet:” följer en rad per lucka med vad som saknas, var och vad ett ja
  innebär; luckorna blir inga egna ärenden. Med manifest visar
  `forslag.varde.fran` och `forslag.varde.till` den mottagarpart,
  godkännandeform och det ankardatum som ändras. Ett avtal utan register
  visas aldrig som saknat på från-sidan. Utan manifest och luckor är posten
  oförändrad. Att göra visar samma text, med samma befintliga godkännande.
- `tackning[]` är alla öppna avtal gånger de fyra mandatkällorna. Varje rad
  namnger avtal, projekt och källa, med `tackning`, `farsk` och `orsak`.
  Saknad cacherad ger `saknas`; oläsbar källa ger `olast`; regelbrott ger
  `fel`; en rad äldre än **60 minuter** ger `gammal`. Gränsen är inkluderande
  och prövas med samma Postgres-klocka som skrev cachen.
- `verifierat_tomt` kräver noll poster och färsk täckning för varje källa i
  varje öppet avtal. `aldsta_tackning` är äldsta cachetid, eller null om
  någon tid saknas (också null om inga avtal är öppna; då finns `last_nar`).
  Annars ger läsvägen `poster` eller `ofullstandigt`. **Ofullständigt vinner
  över poster**, som ändå returneras i sin helhet tillsammans med
  `ofullstandig_tackning`, läsvägens egen delmängd av täckningen.
- En nyupptäckt Övrigt-rad utanför avtalet, utan färdigt köbundet förslag
  eller mottaget beslut, gör `ovrigt` ofullständig redan efter första svepet.
  Ingen ny fråga eller kvittering skapas för den här.
- `hoppade[]` redovisar köposter, signaler och begäranden som lästs men inte
  blivit poster: `id`, `identitet` (`kopost`, `signal` eller `begaran`),
  `atgard`, `orsak` (`uppdrag_saknas`, `uppdrag_avslutat` eller
  `underlag_ogiltigt`). `underlag_ogiltigt` är en Övrigt-köpost vars indata inte
  går igenom åtgärdens schema, eller vars rad inte är markerad i postens avtal
  (Story 1.14). Där finns bara id:n och koder. Främmande id:n slås
  aldrig upp över bolagsgränsen; ogiltiga uuid förgiftar ingen transaktion.
- Läsvägen skriver inget och gör inga externa anrop; bara Postgres läses
  genom anroparens tenant-transaktion. Källorna är appvägar under det egna
  bolaget eller stabila `uppdrag_referens`-pekare, aldrig externa URL:er.

Ingen migration, inget nytt beroende och ingen vy. Vyn kommer i Story 1.11.


### Beslutsraden och nej med skäl (Story 1.7, B-1)

`avboj_beslutsforslag` är write med **`kravManniska: true`**. Indata är `approval_id` (uuid) och `skal` (1–300 tecken). Svaret är `{ approval_id, status, verkstalld }`. Skälet får inte bestå av blanksteg. Fel: 400 `validation_error`/`skal_kravs`, 403 `human_required`, 404 för saknad köpost i bolaget, 409 `not_pending` eller `inte_mandatforslag`.

`MANDATATGARDER` i `services/uppdragBeslut.ts` omfattar `satt_baseline`, `andra_baseline`, `upsert_contract_part`, `update_contract`, `binda_kostnad`, `avsluta_uppdrag` och `registrera_uppdragsbeslut` (Story 1.14). Beslutsraden bär `alternativ` (`tillagg` eller `ryms`) för Övrigt-frågor, också vid nej. Alla har `tvafas`: mottagandet bevaras före verkställigheten. Även `/approvals/:id/reject` kräver `reason` för dem. `uppdrag_beslut` fryser förslaget, utfallet, skälet vid nej, källorna och den faktiskt registrerade handlingen vid ja. Ingen domänhandling visas genomförd förrän verkställigheten lyckats. Ett upprepat beslut ger 409 `not_pending`. Ett nej på en kundförfrågan ur Övrigt ger dessutom ett svarsutkast i raden (Story 1.16).

### Den begärda bedömningen (Story 1.10, B-3)

**`begar_ny_bedomning` (write, `kravManniska: true`)** — "Begär en ny
bedömning av ett avtal". Ett handgrepp: åtgärden körs direkt, den köas inte.

- **Indata:** `contract_id` (uuid) och `kommentar` (valfri, högst 2 000 tecken,
  lagras trimmad; bara blanktecken ger **400 `validation_error`**). Den som inte
  vill skriva något utelämnar fältet, och raden får NULL. `begard_av` är inget
  fält: det är den inloggade användaren, och `.strict()` fäller det.
- **Svaret** är begäran: `id`, `contract_id`, `begard_av`, `begard_av_namn`,
  `begard_nar` (ISO 8601), `kommentar` och `befintlig`. En obesvarad begäran per
  avtal räcker: finns den redan blir svaret 200 med **`befintlig: true`** och
  pekar på den, och ingenting skrivs. Annars skrivs en rad i
  `uppdrag_bedomningsbegaran` (migration 0082, ÄGD, append-only) och
  `befintlig` är `false`.
- **Auditraden** `uppdrag.bedomning_begard` skrivs bara när en rad skrivs, med
  `entity_type = 'uppdrag_bedomningsbegaran'`, radens id och `details`
  `{ contract_id, kommentar_finns }` — ingen fritext. `contract_id` är avtalets
  id som databasen skriver det, också när indatat har versaler.
  `action.executed` skrivs av `executeAction` som förut.
- **Fel:** 400 `validation_error`, **403 `human_required`** för en agent (före
  varje skrivning; MCP går samma REST-väg), 404 `not_found` för ett okänt eller
  främmande avtal och **409 `rule_violation`** på ett avslutat uppdrag (triggern
  `vagrar_skrivning_pa_avslutat`). Var en begäran öppen när uppdraget stängdes
  ger ett nytt anrop 200 med `befintlig: true`, och ingenting skrivs.
- **Obesvarad** betyder att ingen rad i `uppdrag_bedomning` bär begärans id.
  Begäran besvaras genom `satt_bedomning` (se *Bedömningen*), med eller utan
  `begaran_id`. Båda åtgärderna tar radlåset på avtalet, så två samtidiga
  begäranden blir en, och samma begäran besvaras en gång.

**Posten `ny_bedomning` i `las_undantag`.** En obesvarad begäran på ett aktivt
uppdrag blir en post med begärans id som `id`, `identitet: 'begaran'`,
`atgard: null`, `foreslagen_av: 'human'` och `skapad_nar` = `begard_nar`.
`val` är `{ kod: 'bedomningslage', text }` med ● På spår, ▲ Risk och ■ Ur spår;
**inget läge är förvalt**, och ingen maskin föreslår ett. `forslag.varde.till`
är det sammanställda underlaget i text, aldrig ett läge. Fältet `bedomning` bär:

- `begaran` (`id`, `begard_av_namn`, `begard_nar`, `kommentar`);
- `senaste` (`Lasvarde`): senaste mänskliga bedömning med `id`, `lage`,
  `period_start`, `period_slut`, `satt_nar`, `satt_av_namn` (NULL för rader
  från före 0082) och `kommentar`, eller `saknas` när ingen finns;
- `andringar` (`Lasvarde`): `sedan` (bedömningens `created_at`, NULL utan
  bedömning), `forbrukning[]` per avtalsdel med `fore` ur bedömningens frysta
  tal och `nu` ur `get_contract_usage` (två tal, aldrig en andel, och `andrad`),
  `leverabelrorelser[]`, `signaler[]` (tända efter bedömningen, med `oppen`) och
  `baselineandringar[]` (beslutsrader med ja för en baselineåtgärd efter
  bedömningen) — allt ur egna tabeller, inget räknas om;
- `period`: `{ lage, start, slut }`, perioden ur avtalets rytm och ankare för
  läsdagens UTC-datum (Story 2.3, samma regel som Bedömning-sidan). Med en
  räknad period är `lage` `'raknad'` och gränserna datum; utan period är `start`
  och `slut` NULL och `lage` säger varför (se *Perioden följer avtalets rytm*
  under Bedömningen). Kalendermånaden föreslås aldrig. Utan period visar posten
  meningen i fältet Perioden och två synliga obligatoriska datumfält, där David
  själv anger perioden han bedömer.

`ja_registrerar` säger att läget blir en ny rad i bedömningshistoriken och att
begäran räknas som besvarad. Posten försvinner när en bedömning besvarar
begäran. En begäran på ett avslutat uppdrag blir ingen post; den står i
`hoppade[]` med `identitet: 'begaran'` och `orsak: 'uppdrag_avslutat'`. Ingen
regel skapar en begäran av sig själv; automatisk upptäckt av bedömningsbehov
är Story 14.3.

**`oppen_begaran` i `las_uppdragslage`.** Varje avtal bär sin obesvarade
begäran (samma fält som svaret ovan, utan `befintlig`) eller `null`. Fältet
visar också en begäran som aldrig besvarades innan uppdraget stängdes.

**Vyn.** På Läget har kortet *Senaste bedömning* knappen **Begär ny
bedömning** med ett valfritt fält *Varför*, på ett aktivt uppdrag utan öppen
begäran. Formuläret postar `handling=begar_bedomning` till Lägets befintliga
POST-rutt, som kör `begar_ny_bedomning` med actor `human`; en begäran som redan
väntade sägs i notisen. Med en öppen begäran säger kortet när och av vem den
begärdes, och bandet *Väntar på dig* får raden *Ny bedömning begärd* med
**Bedöm** (bara på ett aktivt uppdrag). På ett stängt uppdrag säger kortet att
begäran inte längre kan besvaras, utan knapp. Bedömning-sidan säger före
formuläret att bedömningen besvarar begäran.

### Dokumentförteckningen (S10.10, FR-43)

Samma hållning som svepet: Hermes läser Drive och valvet och pushar in hela
projektets förteckning, och appen lagrar den som **CACHE** och ritar den.
Migration **0076** ger två CACHE-tabeller. `uppdrag_dokument` bär projektets
icke-raderade dokument som Hermes läste dem ur Drive och valvet: namn, länk,
datum och storlek, aldrig innehåll. `uppdrag_dokumentrot` bär projektets
rotmapp i Drive: namnet, länken och lästidpunkten. Varje rad går att räkna om
ur källsystemen, och tabellerna får tömmas utan att något förloras utom fart.

**Repot öppnar aldrig Drive eller valvet själv** (ADR-4). Tjänsten
(`services/uppdragDokument.ts`) har ingen Drive-klient och inget utgående
anrop: förteckningen kommer in som validerad indata genom
`skriv_dokumentforteckning`. Det som skriver är Hermes skill
`dokumentforteckning.py`, varje timme.

**`skriv_dokumentforteckning` (write)** — "Skriv projektets
dokumentförteckning (ersätter hela förteckningen)". Ingen `kravManniska`, av
samma skäl som `kor_uppdragssvep`: det är källsystemets fakta om vilka filer
som finns, inte ett omdöme. En människa i vägen hade betytt att förteckningen
aldrig uppdaterades av sig själv. Schemat `DokumentforteckningSchema` bor i
tjänsten (prejudikat `SvepIndataSchema`): det är samma strikta form som
funktionen parsar. Indata, strikt:

- `project_id` (uuid) — projektet. Det ska finnas i bolaget.
- `rot` — `{ namn, lank }`, strikt: rotmappens namn (1–300 tecken) och länk
  (1–2 000 tecken, `https://`).
- `dokument[]` — högst 5 000 rader. Taket är avsiktligt högt men ändligt: en
  push är HELA sanningen, så ett tak som klipper hade tystat bort dokument i
  stället för att fälla anropet. Varje rad är strikt:
  - `kalla` — `drive` eller `valv`, en sluten uppräkning som 0076:s CHECK;
  - `extern_id` — källsystemets eget id (Drive-id, valvets sökväg), 1–300
    tecken;
  - `namn` — 1–500 tecken;
  - `mime` (valfri) — 1–200 tecken;
  - `andrad` (valfri) — källsystemets ändringstidpunkt, ISO 8601 med tidszon.
    Saknas den sorteras raden SIST, aldrig som om den var nyast;
  - `lank` — 1–2 000 tecken, `https://` och inget annat;
  - `sokvag` (valfri) — mappvägen relativt roten. `''` är roten själv, och det
    är också värdet när fältet saknas;
  - `storlek` (valfri) — ett heltal, noll eller större.

**Skrivningen ERSÄTTER projektets hela förteckning, den växer inte.** En push
är hela projektets sanning. Raderna som kom upsertas på (`company_id`,
`project_id`, `kalla`, `extern_id`), 0076:s `uppdrag_dokument_uk`, projektets
övriga rader tas bort och roten upsertas, i SAMMA transaktion. Det som inte
kommer med tas alltså bort, och en tom `dokument[]` tömmer projektets
förteckning: det är det svaret källsystemet gav, och en tom mapp ska visas som
tom. Det är så "inte raderad" hålls sann; en tabell som bara kunde växa hade
visat papperskorgen som om den var Drive. Därför skickar
`dokumentforteckning.py` aldrig en källa som inte gick att läsa: en tom lista
efter ett Drive-fel hade raderat hela förteckningen i ytan. Projektet hoppas
då över och körningen blir RÖD. Samma indata två gånger ger samma rader och
`borttagna: 0`.

**Fel.** Samma dokument (`kalla` och `extern_id`) två gånger i en push ger 400
`dubblerat_dokument`: upserten hade tagit det sista och svarat med ett `antal`
som inte stämmer med raderna. En länk som inte börjar med `https://`, på roten
eller på en rad, ger 400 `invalid_link_url`. Kontrollen står i tjänsten och som
CHECK i 0076. Fel form, också fler än 5 000 rader, ger 400 `validation_error`.
Ett okänt projekt, eller ett projekt i ett annat bolag, ger 404 `not_found`,
aldrig en tyst tom förteckning.

**Svaret** är `{ project_id, antal, borttagna, last_nar }`: antalet rader som
kom, hur många som togs bort och när förteckningen lästes. `last_nar` är den
enda kolumn som ändras av en oförändrad push, och den säger NÄR förteckningen
lästes, inte vad den innehåller.

**`las_dokumentforteckning` (read, ingen `kravManniska`)** — "Projektets
dokument grupperade per mapp, senaste versionen först". Indata är bara
`project_id`, strikt, och ett okänt projekt ger 404 `not_found` som vid
skrivningen. Grupperingen görs i tjänsten, så vyn, REST och MCP får exakt samma
familjer i samma ordning (FR-23).

- Svaret är `rot` (`{ namn, lank }` eller `null`), `last_nar` (eller `null`),
  `antal` och grupperingen: `mappar[]` med Drive-raderna, en post
  `{ sokvag, familjer[] }` per mapp i bokstavsordning med roten först, och
  `valv[]` med valvets familjer utan mappindelning.
- En familj är `{ nyckel, senaste, tidigare[] }`. Samma `kalla`, samma
  `sokvag` och samma nyckel ur `familjenyckel` är en familj. Nyckeln tar bort
  led som BARA säger vilken version av samma sak raden är (version, datum,
  status, kopia, löpnummer), och bara när de står som egna led.
- Nyast först inom en familj: störst `andrad`, sedan högst versionsnummer,
  sedan namnet.

**"Aldrig läst" är inte en tom mapp.** `rot` som är `null` och `antal` 0
betyder att förteckningen aldrig lästs. En rot utan rader betyder att mappen
var tom när den lästes. Rotens närvaro i `uppdrag_dokumentrot` är svaret på om
förteckningen HAR lästs, och `last_nar` är `null` bara när den aldrig lästs.
Saknas roten men inte raderna, dateras förteckningen med radernas senaste
läsning. "Vi vet inte" och "det finns inget" är två olika besked, och en
gemensam nolla hade sagt det senare om det första.

## Händelsernas ursprung (crm 1.1)

`record_crm_interaction`, `record_crm_commitment` och `log_contact` skriver
ursprung per fält i samma transaktion som händelsen: `human` för en människa,
`ai` för en agent. Aktören hämtas ur sessionen eller agent-tokenet.
`set_crm_commitment_status` skriver motsvarande ursprung för `status`.

En agents skrivning ändrar inte ett fält som en människa satt eller bekräftat.
Svaret redovisar de blockerade fältnamnen i `kept_human_fields`, till exempel
`["body"]` eller `["status"]`; övriga inskickade fält skrivs som vanligt.
Människans egen skrivning går igenom även när hon tidigare satt fältet.

Kontaktpunkten bär ursprung för `occurred_at`, `channel`, `direction` och
`summary`. Löftet bär ursprung för skrivna `direction`, `body`, `due_date` och
`occurred_at`, och för `status` när statusåtgärden används. Löftets `sfar` är
metadata och får inget ursprung här. Utelämnade fält får inget påhittat ursprung.

## Rätta och bekräfta händelser (crm 1.2)

`update_crm_interaction` (write) tar `interaction_id` och valfria `summary`,
`channel`, `direction`, `occurred_at`. `update_crm_commitment` (write) tar
`commitment_id` och valfria `body`, `direction`, `due_date`, `occurred_at`.
Bara skickade fält ändras; utelämnat betyder oförändrat. `due_date: null` tar
uttryckligen bort förfallodatumet. `status` sätts separat genom
`set_crm_commitment_status`. Mål, sfär och källmetadata kan inte rättas med dessa
åtgärder; okända fält och blank text avvisas av strikta scheman.

En rättelse utan fält ger 400 `nothing_to_update` (”Inget att rätta: inget fält
ändrades.”). En löftestid efter nuet ger 400 `occurred_at_in_future` (”Ett löfte
kan inte ha getts i framtiden.”). Ett mål utanför bolaget ger 404.

En människas rättelse får ursprunget `human`, ett agent-tokens rättelse `ai`,
per skickat fält. Raden låses före människovakten; en agents försök att ändra
ett människosatt fält stoppas och redovisas i `kept_human_fields`, också när
försöket är `due_date: null`. Övriga fält fortsätter följa källan. Ursprunget
och auditraden (`crm.interaction_corrected` respektive
`crm.commitment_corrected`, med bara fältnamn) skrivs i samma transaktion.

`confirm_crm_value` tar nu också `interaction_id` med `field` ur
`occurred_at`, `channel`, `direction`, `summary`, eller `commitment_id` med
`field` ur `direction`, `body`, `due_date`, `status`, `occurred_at`. Exakt ett
av de fyra målen `organization_id`, `person_id`, `interaction_id`,
`commitment_id` ska anges. Organisationens och personens fältlistor är
oförändrade. Bekräftelsen ändrar bara ursprunget till `human` med skälet
”bekräftad av människa”, aldrig värdet. Agent-token ger 403
`human_confirmation_required`. MCP-schemat är fortsatt ett objekt på toppnivån.
För händelser tas samma radlås som vid rättelse och omsändning före
bekräftelsen och hålls till transaktionens slut, så att en samtidig agent eller
synk prövar människoskyddet först efter att bekräftelsen committats.

I tråden och åtagandevyn finns hopfälld *Rätta* för kontaktpunkter och löften
med relation. Tomma och oförändrade formulärfält lämnas orörda; *Inget
förfallodatum* är det uttryckliga beslutet att ta bort datumet. ✦ och *Stämmer*
visas per `ai`-/`import`-fält, även för ett borttaget datum. Synkade händelser
och händelser utan ursprungsrad får inget gissningsmärke. En rättad källhändelse
visar *· rättad av dig*. Sidan återgår till samma filter och visar fel i notisen.

Ett löfte utan relation har *Stämmer* genom sin egen rutt
`POST /app/c/:companyId/commitments/:id/confirm`. Det har ännu ingen *Rätta*
i åtagandevyn; det kan rättas genom `update_crm_commitment`.


## Kundkopplingen på relationssidan (crm 1.4)

`upsert_crm_organization` med `organization_id` tar bara de fält som ska ändras.
`name` får utelämnas: utelämnat betyder oförändrat och ger inget nytt ursprung.
Utan `organization_id` krävs `name`; saknat eller blankt namn ger 400
`invalid_name`. Ett anrop med `organization_id` utan ändringsfält ger 400
`nothing_to_update` (”Inget att rätta: inget fält ändrades.”), utan skrivning.

En människas rättelse med `organization_id` gör inget automatiskt kunduppslag.
Utelämnat `customer_id` lämnar kopplingen och dess ursprung orörda, även om ett
ändrat namn eller org.nr matchar en kund. Synkens kunduppslag är oförändrat.

Ett uttryckligt `customer_id` slås aldrig upp i kundregistret och får skrivarens
ursprung: `human` för en människa och `ai` för en agent. En kund som redan är
kopplad till en annan relation ger 409 `customer_already_linked` med
`details.organization_id`; ingenting skrivs. Varje ny koppling, även en automatiskt
matchad, tar samma lås på kundens rad före krockprövningen. För befintliga
relationer låses relationen först, sedan kunden. Krockprövningen läser på nytt
efter eventuell väntan, så en samtidig synk också ger kundkrocksnotisen.
Förlorar intagets automatiska matchning redovisas händelsen i `skipped` med
kundkrockens text via den befintliga savepointen; en omsändning ser då kunden
som upptagen och redovisar relationen i `unlinked_organizations`.
Ett byte av kund behandlar statusen som en ny koppling.

Relationssidans *Rätta uppgifter* skickar bara ändrade fält, jämförda mot det
visade värdet i de dolda `fore_`-fälten. Formuläret öppnas med
`?oppna=uppgifter` från sidhuvudets *Ej i kundregistret*.

## Statusen vid kundkoppling och sammanslagning (crm 1.6)

En kundkoppling som tillkommer gör `prospect` till `customer` bara när statusens
ursprung inte är `human`. En status som en människa satt eller bekräftat står kvar.
Regeln gäller `upsert_crm_organization` med uttryckligt `customer_id` från människa
eller agent, intagets kunduppslag i `ingest_crm_events` och
`merge_crm_organizations` när kopplingen flyttas från den inslagna relationen.
Ett uttryckligt `status` i samma anrop gäller före regeln.

Ett stoppat statusbyte redovisas i `kept_human_fields`: `upsert_crm_organization`
med `"status"`, intaget med `"<organisation>: status"`, och
`merge_crm_organizations` med `kept_human_fields: ["status"]`, som annars är `[]`.
När kopplingen byter status i `upsert_crm_organization` eller intaget får statusen
kopplingens ursprung: `accounting` med uppslagets skäl vid kunduppslag, annars
skrivarens ursprung. Sammanslagningen ändrar inte statusens ursprung.

Att göra-kortet för `merge_crm_organizations` använder samma regel som körningen
och säger om statusen står kvar eller ändras. Påståendet ”ifyllda rörs inte”
står bara när statusen står kvar.

## Projektkoder och normaliserat namn (crm 2.2)

Ett organisationsnamn som efter trimning matchar `^[A-ZÅÄÖ]{2,6}-\d{3}$`
(till exempel NVR-001) avvisas. `upsert_crm_organization` svarar 400
`project_code_as_name` från både människa och agent. `ingest_crm_events`
lägger händelsen i `skipped` med sitt index och skälet att namnet är en
projektkod; ingenting skrivs för den, och övriga händelser skrivs som vanligt.
Avvisningen gäller före namngravstenen, så ett alias styr inte om projektkoden.
Vyn visar den svenska feltexten i sin befintliga notis.

Ett anrop med `organization_id` utan namn rör inte namnet. En befintlig rad
med projektkodsnamn kan därför rättas i andra fält och döpas om till bolagets
namn; ett nytt projektkodsnamn avvisas alltid. Befintliga rader ändras inte
automatiskt.

Varje organisation bär `name_norm`, genererad av `crm.normalize_org_name`:
gemener, trimmade och hopslagna blanktecken och en avslutande bolagsform ur
den slutna listan. Kolumnen syns inte i åtgärdernas svar; den är
jämförelsenyckeln för bolagsformsvarianterna i 2.3 och dataprovet. Uppslaget
på namn är fortfarande skiftlägesokänsligt på hela namnet.

## Kundnumret på relationssidan (crm 1.7)

`update_customer` tar ett valfritt `customer_number`, ett heltal från 1 till
2 147 483 645. Ett nummer som en annan kund i bolaget bär ger 409
`customer_number_taken` med svensk text: ”Kundnummer {N} används redan av en
annan kund i bolaget. Inget sparades.” Ingenting skrivs vid avvisningen.
Samma nummer i ett annat bolag är fritt.

I samma transaktion låses bolagets kundserie i `number_sequences`
(`kind = 'customer'`) före ändringen. Stod serien på eller under numret flyttas
den till numret + 1, med auditraden `customer.number_series_set` och detaljerna
`from_next_value`, `to_next_value`, `customer_id`, `customer_number`.
Serien flyttas aldrig bakåt. `customer.updated` bär fältnamnet i `fields`.
Fakturorna bär inte kundnumret, så en redan ställd faktura ändras inte.

Relationssidans *Rätta fakturauppgifter* har fältet Kundnummer; ett tomt eller
oförändrat nummer skickas inte. Kundkortets formulär och REST-vägen för kunder
tar inte fältet.

## Kundkortets org.nr för en kopplad relation (crm 1.8)

`upsert_crm_organization` med `org_number` för en organisation vars
`customer_id` är satt svarar 400 `org_number_on_customer`, för både människa
och agent. Felet bär `details: { customer_id, update_action: 'update_customer' }`
och svensk text som hänvisar till kundkortet; API:t skickar kod och detaljer,
och vyn visar texten. Ingenting skrivs. Rätta kundens org.nr med
`update_customer` och `customer_id` ur detaljerna; `update_action` anger vägen.

För en okopplad organisation skrivs `org_number` som förut. En ny organisation
som skapas med org.nr och kopplas i samma anrop får också värdet som förut.
`ingest_crm_events` lämnar org.nr orört för en kopplad organisation utan att
händelsen avvisas. Fältet redovisas i svarets `kept_customer_fields`
(`"<organisation>: org_number"`), inte i `kept_human_fields`.

Relationssidans rad *Org.nr* visar kundkortets värde med hinten *Sparas i
kundregistret*. *Rätta uppgifter* har ett eget org.nr-formulär som sparar via
`update_customer`.

## Namnkrocken leder till sammanslagningen (crm 2.1)

`upsert_crm_organization` som döper om en organisation till ett namn som en annan
organisation i samma bolag redan bär (skiftlägesokänsligt) svarar fortfarande
400 `name_taken`. Ingenting skrivs, och feltexten finns kvar. Fältet `details`
bär `details: { organization_id, merge_action: 'merge_crm_organizations' }`:
`organization_id` är relationen som redan bär namnet, och `merge_action` anger
vägen vidare. Inga andra fel bär `merge_action`. MCP-verktyget får samma kropp
som JSON i sin feltext.

Vägen vidare är `merge_crm_organizations` med de två relationernas id som
`keep_id` (den som behålls) och `merge_id` (den som försvinner). Åtgärden är
`sensitive` och hamnar i Att göra för mänskligt godkännande innan något slås ihop.

Relationssidan visar namnkrocken som en notis med en länk till relationen och
knappen *Slå ihop {relation} hit…*. Den öppnar *Dubblett?* med relationen förvald
via `?oppna=slaihop&med=<id>`; *Slå ihop* köar samma förslag i Att göra.

## Bolagsformsvarianten blir ett sammanslagningsförslag (crm 2.3)

Ett nytt organisationsnamn som bara skiljer sig i bolagsform från exakt en
befintlig relation skapas inte av `ingest_crm_events`, om paret inte redan har
sparats som olika bolag. Händelsen hamnar i `skipped` med skälet
«bolagsformsvariant av Alliance Optikk — väntar på ditt beslut i Att göra».
Förslaget `merge_crm_name_variant` med relationens `organization_id` och
variantens `name` köas en gång per namnpar. `merge_proposals` redovisar det som
«Alliance Optikk AS → Alliance Optikk (bolagsform)», också när förslaget redan
väntar. Mottagna beslut som väntar på verkställighet räknas också som väntande.

Finns flera möjliga relationer skapas varken relation eller förslag. `skipped`
säger «bolagsformsvariant av flera relationer — slå ihop dem först», och
förslagslistan visar «<namn> (flera möjliga)».

Åtgärden är `sensitive` med `tvafas`: bara en människa får godkänna eller
avvisa den. Ett ja lägger namnet som alias för relationen, och nästa synk
styr om de överhoppade händelserna dit (`redirected_organizations`). Ett nej
kräver ett skäl som sparas med beslutet och lagrar paret i
`crm.organization_distinctions`. Nästa synk får då skapa den egna relationen
utan nytt förslag mot samma relation.

Kortet jämför de aktuella normaliserade namnen. Om förslaget gäller olika
namn eller relationen har döpts om säger kortet att namnen inte bara skiljer
sig i bolagsform och ber dig kontrollera dem före beslutet. Ett ja kan då
lägga namnet som alias om det är ledigt; ett nej sparar namnen som olika bolag.

Godkänt svarar med `outcome`: `alias_added`, `already_alias`, `name_exists`,
`alias_elsewhere` eller `organization_missing`. Avvisat svarar under
`approval.result.vid_avslag` med `distinction_saved`, `already_distinct` eller
`organization_missing`. Dessa affärslägen avslutar beslutet utan återförsök.
Aliaset och det sparade beskedet auditeras med antal, aldrig namn; intagets
förslag och dess auditrad sparas i samma savepoint.

Regeln gäller synkens skrivningar. En relation som skapas för hand prövas
inte av den i denna version.

## Löftets avslut och borttagen deadline i intaget (crm 3.3)

`ingest_crm_events` tar för löften två valfria fält: `status` (`open`, `done`
eller `dropped`) och `due_date` som datum eller `null`. Utelämnat betyder
oförändrat, och `due_date: null` tar bort förfallodatumet. Ett okänt
statusvärde ger 400 `validation_error` för hela anropet, och ingenting skrivs.

Ett statusbyte sätter `completed_at`, tomt vid `open`. En omsändning med samma
status ändrar det inte och räknas som `commitments_unchanged`. En
stängningshändelse för en okänd källnyckel skapar löftet stängt, med
`completed_at` satt.

En status eller ett förfallodatum som en människa satt eller bekräftat står
kvar och redovisas i `kept_human_fields` som
`"<organisation>: <källnyckel> status"` respektive `due_date`. En stängd status
utan ursprungsrad skyddas på samma sätt, eftersom intaget inte skrev status
förut. Övriga fält följer källan, och ingenting fryser hela löftet.

`set_crm_commitment_status`, `update_crm_commitment` och
`record_crm_commitment` är oförändrade.

## Källan på varje rad (crm 4.2)

Varje rad i `get_crm_thread` bär fältet `invoice_id`. Det är fakturans id för
raderna `invoice` och `payment` och annars `null`. `ref_id` är oförändrat: för
`payment` är det fortfarande betalningsverifikatets id, unikt per betalning,
och för `invoice` fakturans id. Svaret är fortfarande en lista, inget fält har
försvunnit, och åtgärdens indata är oförändrade.

I vyn har tråden, åtagandevyns kolumn Källa och Idags löfteskort samma källrad
för samma händelse: källsystemets namn (Gmail, Ärende, Kalender eller För hand,
och Faktura eller Betalning i tråden), nyckeln i maskinstil och länken
«Öppna ↗», som öppnas i en ny flik. En nyckel `gmail:<id>` leder till
meddelandet i Gmail, en nyckel `linear:<ärende>` till ärendet under
`/vy/arende/`, och fakturans och betalningens rad till fakturans sida. Länken
byggs bara ur nyckelns id och bara när hela nyckeln har källsystemets form; en
nyckel som inte har den väntade formen visas som text utan länk. Sedan crm 5.9
leder en nyckel `calendar:<eid>` till mötet i Google Kalender, med en adress
som byggs bara ur `eid` och aldrig ur suffixet efter `#`. Handvägen får ingen
länk. Servern läser aldrig Gmail: adressen är en sträng i länken, och mallen
provas mot ett verkligt meddelande efter driftsättningen.

## Trådens läsväg bakåt (crm 4.1)

`get_crm_thread` tar ett valfritt `before` med fälten `at`, `kind` och
`ref_id`, tagna ur sista raden på föregående sida. Svaret är raderna strikt
efter den raden i trådens totala ordning: `at`, sedan `kind`, sedan `ref_id`,
alla fallande. Händelser med samma tidpunkt hamnar därför på exakt en sida, och
ingen sida läses med offset, så en ny händelse flyttar inte gränsen mellan
äldre sidor.

`limit` är som förut högst 200, och standard är 60. `at` returneras avrundat
till millisekunder, samma värde som ordningen och jämförelsen använder; svaret
bar redan millisekunder. Svaret är fortfarande en lista, och en tom lista
betyder att det inte finns något äldre. `at` i `before` skickas exakt som
radens `at`, till exempel `2026-03-02T09:00:00.000Z`: tre decimaler, `Z` och ett
år från 0001 till 9999. En annan zon, ett datum som inte finns och ett år
utanför det spannet ger 400 `validation_error`, liksom ett okänt slag i
`kind`, en extra nyckel i `before`, ett `ref_id` som inte är en uuid eller ett
`limit` över 200. En relation i ett annat bolag ger 404, också med ett giltigt
`before`.

I vyn har relationssidans tråd länkarna «Äldre händelser →» och «← Nyaste» i
en navigering under listan, och adressen bär läspositionen som
`?fore=<at>|<kind>|<ref_id>`. En ogiltig läsposition ger en 400-sida i
klartext, aldrig 500. Har den äldsta visade händelsen en tidpunkt utanför åren
1–9999 går ingen läsposition att bygga; sidan säger då att det finns äldre
händelser som läsvägen inte når, i stället för att påstå att tråden börjar där.

## Personperspektivet i tråden (crm 4.3)

`get_crm_thread` tar ett valfritt `person_id`. Då visas bara kontaktpunkter och
löften (med sin stängning) där personen är part, i samma ordning och med samma
`before` och `limit` som relationens tråd. Pengar ingår inte i personläget,
eftersom en faktura gäller relationen och inte en person: filtret `pengar` ger
en tom lista. Personen måste höra till `organization_id`, annars 404; ett
`person_id` som inte är en uuid ger 400 `validation_error`. Svaret är
fortfarande en lista.

`upsert_crm_person` tar ett valfritt `person_id`. Då slås personen upp på id i
bolaget (404 annars) och aldrig på namn eller e-post, så att en rättelse av
namnet ändrar samma rad i stället för att lägga en ny person bredvid. `name`
behövs då inte, och bara de fält som skickas ändras och får ursprung efter
anroparen. Utan `person_id` krävs `name` som förut, och ett anrop utan båda ger
400 `validation_error`. Auditraden säger att personen matchades på id.

Varje löfte i `list_crm_commitments` och i `crm_today` bär `person_id` och
`person_organization_id`: personens id och hennes organisation, eller `null`
när löftet saknar person eller personen saknar organisation. Övriga fält är
oförändrade.

I vyn tar relationssidan `?person=<id>`. Namnen i kortet Personer väljer
personen, och den valda personens huvud står först i tråden med roll, e-post,
telefon, senaste kontakt och «Rätta personen». Flikarna och läsvägen behåller
`?person=`, och «← Hela relationen» lämnar personläget. Ett ogiltigt värde ger
en 400-sida i klartext och en person utanför relationen 404, aldrig 500.
Åtagandevyns Vem, sökträffen på en person och Idags personnamn leder till
personläget i personens relation; en person utan organisation står som text.

## Affärscachen och kontraktet för affärer (crm 7.1)

De öppna affärerna bor i ärendeplattformen. Redovisningen ringer aldrig ut:
Hermes skickar en ögonblicksbild av dem varje natt med `sync_crm_deals`
(`write`), och relationsdelen läser den med `crm_open_deals` (`read`). Cachen
är en spegel av ärendena, ingen sanning, och affärsobjektet i schemat används
inte.

`sync_crm_deals` tar `observed_at` (ögonblicksbildens tidpunkt, ISO 8601 med
zon) och `deals`, högst 500 affärer. Varje affär har `source_ref` (ärendets
källnyckel i husets form `<system>:<id>`, som `linear:LOC-412`, unik per
bolag), `title` (högst 200 tecken), `organization` med `name`,
`last_activity_at` (ISO 8601 med zon) och de valfria `stage` (`idea`,
`dialogue`, `proposal` eller `negotiation`), `value_ore` (heltal i ören) och
`next_step` (högst 200 tecken), som också får vara `null`. En okänd nyckel på
någon nivå ger 400 `validation_error`, och då skrivs ingenting. Mottagaren
jämför hela nyckeln: ärendet har samma nyckel som i händelserna, och en nyckel
utan systemet är en annan nyckel. `source_ref` trimmas på ett ställe i
tjänsten, så dubblettkontrollen, gravstenen och cachen ser samma nyckel.
Ingen tidpunkt får ligga mer än fem minuter före mottagarens klocka: ett
`observed_at` längre fram ger 400 `observed_at_in_future` och skriver
ingenting, och en affär vars `last_activity_at` ligger längre fram hoppas över.
Grinden i läsningen ger `unknown` för samma framtida tidpunkt.

Hela mängden ersätter bolagets cache i en transaktion: en affär som inte finns
i den nya mängden försvinner ur `crm.deal_snapshots`. En tom mängd är ett
giltigt besked och tömmer cachen. Tidpunkten och antalet sparas i
`crm.deal_snapshot_observations`, också när mängden var tom.

Organisationen slås upp eller skapas ur sitt namn med samma regler som
`ingest_crm_events`: projektkodsspärren, aliaset efter en sammanslagning,
bolagsformsregeln och kundkopplingen. En bolagsformsvariant hoppas över med
intagets skäl och köar samma `merge_crm_name_variant`, ett förslag per namnpar.
En titel eller en `source_ref` av bara blanktecken och en upprepad `source_ref`
hoppas också över. En trasig rad stoppar inte resten.

Svaret redovisar `observed_at`, `received` (antalet Hermes skickade),
`cached`, `organizations_created`, `organizations_linked`,
`unlinked_organizations`, `redirected_organizations`, `merge_proposals` och
`skipped` med index och skäl, i samma former som intagets svar. Auditraden
`crm.deals_synced` bär bara antal, aldrig titlar eller namn.

`crm_open_deals` tar `{}` och svarar med `status`, `observed_at`, `received`
och `deals`, med ett av tre utfall. `observed_at` och `received` är den senaste
ögonblicksbildens tidpunkt och antal, och `null` när ingen ögonblicksbild har
kommit. `ok`: den senaste ögonblicksbilden är högst 26 timmar gammal och Hermes
skickade minst en affär. `deals` listar då affärerna med relationens
`organization_id` och `organization_name`, `stage`, `value_ore`, `next_step`
(`null` när affären saknar dem), `last_activity_at` och `idle_days` (hela dygn
sedan senaste aktivitet), längst stillestånd först. `empty`: den senaste
ögonblicksbilden var tom. `unknown`: ingen ögonblicksbild finns, eller den är
äldre än 26 timmar, och då är `deals` alltid tom. En ögonblicksbild där varje
affär hoppades över är `ok` utan affärer, aldrig `empty`.

En relation som raderas tar sina rader i cachen med sig, och GDPR-raderingen av
en kund tar dem uttryckligen, också när kundens identitet behålls. Raderingen
sparar först radernas källnycklar som gravstenar i `crm.erased_sources`
(källsystemet `linear`), och `sync_crm_deals` prövar gravstenen före
organisationen: skickar Hermes samma `source_ref` igen hoppas affären över med
skälet att källan är raderad enligt GDPR, och ingen relation skapas. Gravstenen
är paret källsystem och nyckel, så ett löfte eller en kontaktpunkt ur samma
ärende som raderats med kunden spärrar också affären. En ny `source_ref`
släpps igenom, som för händelserna.

## Löftets tre tider (crm 5.2)

Varje rad i `list_crm_commitments` bär tre tider. `occurred_at` är löftestiden,
när löftet gavs; för ett löfte ur ärendeplattformen är det ärendets
skapad-datum, tills någon rättar det. `created_at` är registreringstiden, när
raden skrevs, satt av databasen. `due_date` är förfallodatumet, ett datum eller
`null`. `created_at` är nytt. Övriga fält och åtgärdens indata är oförändrade,
och svaret är fortfarande en lista.

I vyn heter tiderna Lovat, Senast och registrerat på fyra ytor: åtagandevyns
kolumner Lovat och Senast, med «registrerat {datum}» under löftesdagen när
registreringsdagen är en annan, trådens rad Lovat, gissningsraden och Idags
löfteskort. Min sida och skälraden på Idags relationskort visar
förfallodatumet utan namnet, som «förföll {datum}» eller bara datumet.
Datumen är UTC-dagar.

Märket «ärendet skapat» står efter Lovat i åtagandevyn och tråden när dagen är
ärendets skapad-datum: löftet kommer ur ärendeplattformen och löftesdagens
ursprung är synken, eller så saknar dagen ursprungsrad (ett löfte från innan
ursprunget sparades). Har David rättat Lovades, eller har AI:t skrivit dagen,
står dagen utan märket. Synken skriver inte över en dag som David rättat.

Ett löfte som synken stängt för att ärendet stängdes visas under Klara eller
Avskrivna med «Ärendet {id} stängdes» i kolumnen Källa. Texten kräver att
statusens ursprung är synken ur ärendeplattformen och att källnyckeln har
ärendets form `linear:<ärende>`. Ett löfte en människa stängt får inte den
texten, och inte heller ett löfte som stängdes innan statusens ursprung började
sparas.

## Affärsskälet i kontaktförslagen (crm 7.4)

`crm_contact_suggestions` och `crm_today` har fått förslagens tredje grund,
efter förfallna löften och tystnad: skälet *affären {titel} ({skede}) har
stått stilla i {N} dagar*. Idag och förslagstabellen på relationssidan läser
samma funktion och visar samma skäl. Det ges när en öppen affär i
ärendeplattformen har stått stilla minst relationens tystnadsgräns, samma gräns
som tystnadsskälet: kadensen när relationen har en egen, annars bolagets
standard eller `silence_days`. Skedet står med svensk etikett (Idé, Dialog,
Offert eller Förhandling) och som «skede okänt» när affären saknar skede. Står
flera affärer stilla för samma relation nämns den som stått stilla längst, med
«(och N till)» efter. Stilleståndet väger som tystnaden i förslagens ordning,
högst 365.

Affärerna läses genom samma läsning som `crm_open_deals` och bara när den säger
`ok`. En ögonblicksbild som saknas, är äldre än 26 timmar eller var tom ger
inget affärsskäl, och inget annat i förslagen ändras: samma relationer, samma
skäl och samma prioritet. Ögonblicksbilden beskriver nuläget, så ett `as_of` en
annan dag än i dag ger aldrig affärsskäl. Tystade och uppskjutna relationer
föreslås fortfarande inte. Indata och svarsform är oförändrade: skälet står i
`reasons` som de andra skälen.

## Löften som AI:n fångar i samtalet (crm 5.5)

Manifestet (`GET /api/companies/:id/actions`) har fått ett valfritt fält
`description` som säger agenten när en åtgärd ska anropas. Det står bara på
poster vars åtgärd har en beskrivning; alla andra poster är oförändrade.
Verktygets beskrivning i MCP byggs som titeln, en punkt och, när fältet finns,
ett blanksteg och beskrivningen, och sist märkningen för känsliga åtgärder som
förut. I dag har bara `record_crm_commitment` en beskrivning, ordagrant:
«Anropa när David i samtalet nämner ett löfte han gett eller fått. Löftestiden
(occurred_at) är den tid han anger, annars samtalets tidpunkt. Källan
(source_system) är manual.» Titeln, schemat och handlern är oförändrade, och
agentens löfte får ursprunget `ai` per fält som förut.

Varje rad i `list_crm_commitments` bär `unconfirmed_ai`, sant när löftets text
har ursprunget `ai` (ett obekräftat AI-löfte). När David bekräftat texten med
Stämmer eller rättat den är ursprunget `human` och fältet falskt; synkens
löften har ursprunget `sync`. Åtgärden tar ett valfritt `include_unconfirmed_ai`
(boolean). Utelämnat gäller brytaren `INCLUDE_UNCONFIRMED_AI_COMMITMENTS` i
`crmDerivations.ts`, och samma brytare styr `crm_today` och Idag, som inte tar
något eget val. Åtagandevyn och Min sida visar alltid alla öppna löften, med ✦
på ett obekräftat AI-löfte i åtagandevyn. Brytarens värde är
Davids besked 2026-10-16 (PRD fråga 13 b): *direkt*, så obekräftade AI-löften
ingår som standard. `false` är mellanläget *först efter bekräftelse*, då de
utesluts ur Idag, `crm_today` och listan utan val. Ingen annan åtgärd ändras.

Beskrivningen är en instruktion till agenten och visas inte på någon yta.
Löften fångas i samtalet när chattagenten anropar åtgärden (berättelse 5.10).
Sedan berättelse 5.11 är samtalet en fångstväg i ytans texter: åtagandevyns
tomläge, hinten i Lova något och kundkortets tomma Åtaganden säger att löften
kommer in när du nämner det för AI:n. Idag och Relationer nämner det inte,
eftersom AI-samtalet fångar löften och inte kontakter. ✦ och Stämmer på Idags
löfteskort återstår (berättelse 5.6).

## Läsnyckeln (crm 5.7)

*Anslut AI* i webbvyn har valet *Läsnyckel — kan bara läsa* bredvid det vanliga
AI-tokenet. Bara en inloggad ägare kan göra valet. Nyckeln signeras med
`{ actor: 'agent', company_id, scope: 'read' }` och samma livslängd som ett
AI-token (`AI_AGENT_TOKEN_TTL_SECONDS`), och auditraden `agent_token.minted` bär
då `scope: 'read'`. `POST /api/companies/:companyId/agent-tokens` tar inget
scope: fältet avvisas av det strikta schemat med 400 `validation_error`. Ett
token med något annat scopevärde än `read`, eller ett människotoken med scope,
avvisas med 401 `unauthenticated`.

Varje åtgärd med `sensitivity` `write` eller `sensitive` avvisas med **403
`read_only_token`** i `executeAction` innan något skrivs, också före schemat:
ingen kontaktpunkt, ingen godkännandepost, ingen auditrad och ingen
domänskrivning. Svaret beror alltså inte på indata, och samma spärr gäller för
MCP-verktygen, som går genom REST. Läsåtgärderna, till exempel
`list_crm_commitments` och `get_crm_retention`, fungerar som med ett AI-token,
och auditraden `action.executed` bär då `scope: 'read'` i `details`.

De direkta REST-rutterna under `/api/companies` tar bara GET och HEAD med
läsnyckeln, utom `POST /api/companies/:companyId/actions/:action`, där
`executeAction` avgör. Allt annat, också en rutt som inte finns, ger 403
`read_only_token`. Nyckeln är bolagsscopad som ett AI-token: ett annat bolag ger
404 `not_found` för en läsning, och en skrivning mot ett annat bolag fälls redan
av 403 `read_only_token`.

Nyckeln är till för Hermes kö, som ska läsa löftena med den (berättelse 5.8).
POST-rutter som bara läser, som en fakturas PDF och AI-OCR:n, är stängda för
läsnyckeln. Den kan inte återkallas före utgången, precis som ett AI-token.

## Personens kortlänk och anteckning (crm 1.9)

`upsert_crm_person` skriver ursprung också för `external_ref` (länken till
personkortet) och `notes`: `human` för en människa och `ai` för en agent.
`ingest_crm_events` skriver `sync` med källsystem och källnyckel. En agents
eller synkens skrivning ändrar inte fält som en människa satt eller bekräftat.
Svaret från `upsert_crm_person` redovisar de blockerade fältnamnen i
`kept_human_fields`, till exempel `["external_ref", "notes"]`, och intagets
svar redovisar dem som `"<personens namn>: external_ref"`. Människans egen
skrivning går igenom.

En skrivning på en befintlig person låser först organisationerna (den i indata
och personens nuvarande), sedan personens rad, och prövar ursprunget först
därefter. Har personen bytt organisation medan skrivningen väntade svarar
åtgärden 409 `person_flyttad_samtidigt` utan `details`, och ingenting skrivs;
skicka ändringen igen. I `ingest_crm_events` hamnar händelsen i `skipped` med
skälet, och nästa synk gör om den. En agents sfärbyte på en befintlig person
avvisas som förut med 409 `byt_med_set_crm_sfar`. `confirm_crm_value` tar inte
`external_ref` eller `notes`.

## Likviditeten per kalendermånad som läsåtgärd (crm 6.6)

`liquidity_by_month` (`read`) returnerar likviditeten per kalendermånad för de
kommande tre månaderna. Åtgärden anropar `liquidityByMonth` i reports-tjänsten,
samma funktion som styrvyn ska läsa när likviditeten visas där (berättelse 6.3),
och räknar inget eget: svaret är funktionens, orört. Indata är `{ as_of? }` med
datumet som `YYYY-MM-DD`; utelämnat gäller databasens dag. Schemat är strikt:
ett ogiltigt datum eller en okänd nyckel ger 400 `validation_error`. Bolaget
kommer ur anropets bolag och användarens medlemskap, aldrig ur indata, och ett
bolag användaren inte är medlem i ger 404 `not_found`.

Svaret har `as_of` och `horizon_end`, och `months` med tre rader: den första
från `as_of` till månadens slut och de två följande hela. Varje rad har `ym`,
`from`, `to`, `opening_ore`, `inflow_ore`, `outflow_ore`, `closing_ore`,
`overdue_inflow_ore` och `overdue_outflow_ore`, och varje månads ingående medel
är föregående månads utgående saldo. `outcome` är `deficit`, `no_deficit` eller
`unknown`, och `first_deficit` och `need_ore` är första underskottet och
behovet under horisonten. `unknown` har en rad per källa som saknas, med
`source` och `reason`, till exempel kassan på 19xx eller
leverantörsfakturorna. Då är `complete` falskt och `first_deficit` och
`need_ore` `null`, aldrig noll. `counted` är de tre räknade källorna
`kundfakturor`, `leverantorsfakturor` och `agi_lonebesked` med belopp och
förfallet, och `beyond_horizon` är det som förfaller efter horisonten. Belopp
är heltal i ören.

`not_counted` är det som saknar belagd betalningstidpunkt. Fältet har alltid
elva rader i den här ordningen, också när beloppet är 0: `abonnemang`,
`ofakturerad_tid`, `rot_rut_1513`, `ovriga_fordringar_15_16`, `moms_26xx`,
`agi_rest_2710_2730`, `bolagsskatt`, `skatteskulder_25xx`,
`semesterloner_2920`, `ovriga_kortfristiga_2890` och `ovriga_skulder_24_29`.
Varje rad har `id`, `side` (`in` eller `out`), `amount_ore`, `next_due_date`,
`reason` och `reservation`. Bara `moms_26xx` och `agi_rest_2710_2730` kan få
nästa förfallodag och underlagets reservation, och bara när beloppet är en
skuld. Det obelagda räknas aldrig in i månaderna, och öppna affärer räknas
aldrig in: de står varken i `counted` eller i `not_counted`.

`liquidity_forecast` är oförändrad och svarar fortfarande i
trettiodagarshinkar, inte per kalendermånad.

## Översiktens tal och Likvida medel per i dag (`dashboard`, 27/11)

`dashboard` (`read`, indata `{}` strikt) ger samma tal som Översikten på
`/app/c/:id`. Den anropar `dashboard()` i reports-tjänsten, och konsoliderade
vyn läser samma funktion. Svaret har `as_of`, `period`, `scope` och talen.
`as_of` är dagens datum i Sverige (Europe/Stockholm), inte UTC.

`bank_ore` är bokföringens saldo på 1910, 1920, 1930 och 1940, räknat på
verifikat daterade till och med `bank_as_of`. Talet är bokföringens, inte
bankens. Före 27/11 räknades alla verifikationsdatum, också verifikat daterade
efter i dag. Fälten kring talet:

| Fält | Innehåll |
|---|---|
| `bank_as_of` | dagens datum i Sverige; gränsen för `bank_ore` |
| `bank_last_voucher_date` | senaste verifikatdatum till och med `bank_as_of` med en rad på 1910–1940, annars `null` |
| `bank_future_ore` | summan på 1910–1940 för verifikat daterade efter `bank_as_of`, 0 om inga. Ingår inte i `bank_ore` |
| `bank_import_date` | senaste `booking_date` i `bank_transactions`, `null` utan bankimport |
| `bank_statement_date` | dagen `bank_statement_ore` gäller, `null` utan importerad rad med saldo |
| `bank_statement_ore` | bankens saldo enligt kontoutdraget, `null` utan importerad rad med saldo |
| `bank_diff_ore` | bokfört på 1910–1940 per `bank_statement_date` minus `bank_statement_ore`, `null` när banken saknar saldo |

Bankens saldo tas från den senaste dagen som har en rad med saldo, och från
dagens sista rad. Raderna saknar ordningstal, så dagens sista rad är den som
ingen annan rad samma dag fortsätter från (en rads saldo minus belopp är den
föregående radens saldo). Datumet för saldot kan alltså vara äldre än
`bank_import_date`, när de senaste raderna saknar saldo. `bank_transactions`
har ingen kontokolumn, så skillnaden jämför bankens saldo med summan av alla
fyra kontona.

`receivables_ore` och `payables_ore` räknar fortfarande alla
verifikationsdatum, och `result_ore` räkenskapsårets period.
