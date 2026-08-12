# Spårbarhetsmatris — dokumenterad funktion → status → bevis

Svar på: *"verifiera att alla funktioner som har dokumenterats är på plats."*
Genomgången täcker **alla** dokument som innehåller stories/krav:

- `KICKOFF_NYSESSION.md` — ombyggnadens acceptanskriterier (Fas 0–4). *(Se `docs/ACCEPTANS.md` för den detaljerade kriterie→test-matrisen; alla ✅.)*
- `GRANSKNING_OCH_OMSTARTSPLAN.md` — analys, arkitektur och **scope-reduktion**.
- `docs/KRAV_Claude.md` — **ursprunglig kravkälla** ("CLAUDE.md v2.0", 4 faser, 45+ moduler).
- `docs/archive/*_COMPLETE.md`, `E2E_TEST_REPORT.md`, `AUDIT_LOG_REVIEW.md`, `QUICK_START.md`, `MCP_SETUP.md` — den **gamla** (kasserade) implementationens funktionslistor.
- `CLAUDE.md`, `README.md` — invarianter och status.

## Om BMAD

Den första versionen uppges ha skapats med BMAD-metoden. Jag sökte hela arbetsträdet
**och hela git-historiken** — det finns **inga BMAD-artefakter** i repot (ingen
`prd.md`, `epics/`, `stories/`, `.bmad-core/`, inga "Acceptance Criteria"/"As a…"-
stories). Den enda kravbärande filen här är `docs/KRAV_Claude.md` (modul-/fas-baserad,
inte BMAD-story-format). **Om BMAD-PRD/epics/stories ligger i ett annat repo**, lägg
till det så verifierar jag mot dem också.

## Legend
✅ Finns (med testbevis) · 🔧 Lucka — nu byggd denna omgång · ⏸ Medvetet skjutet (planens scope-reduktion) · ⚠ Dokumenterat i gamla spec:en men ej krav i ombyggnaden

---

## Autentisering & användare

| Dokumenterad funktion | Källa | Status | Bevis / kommentar |
|---|---|---|---|
| Registrering, login, JWT | KRAV, arkiv | ✅ | `POST /api/auth/register\|login`; `failfast`, `review-fixes` |
| authenticate-middleware (Bearer, expiry) | KRAV, arkiv | ✅ | `authenticate.ts`; `tenant-isolation` |
| Roller & RBAC (admin/accountant/viewer/…) | KRAV, arkiv | ⏸ | Förenklat till `owner`/`member` + agent/human-actor + känslighetsnivå. Fler roller skjutna (team/multi-bolag). |
| Profil (GET/PUT /users/me), byt lösenord | KRAV, USER_MANAGEMENT | ⏸ | Ej byggt — självbetjänings-profil skjuten. |
| Admin: lista/hämta/aktivera/inaktivera användare | KRAV, USER_MANAGEMENT | ⏸ | Skjutet (team-administration). |
| 2FA, e-postverifiering, lösenordsåterställning | KRAV | ⏸ | Endast fält-/action-namn i gamla spec:en; ej byggt. |

## Företag / tenant & inställningar

| Dokumenterad funktion | Källa | Status | Bevis / kommentar |
|---|---|---|---|
| Skapa/lista/hämta/uppdatera bolag | KRAV, COMPANY_SETTINGS | ✅ | `companies.ts` (POST/GET/PATCH), allowlist; `business` |
| Bolagsuppgifter (org.nr, adress, e-post, tel, moms.nr, **Bankgiro/Plusgiro/bank_account/IBAN**, betalningsvillkor) | KRAV, arkiv | ✅ | migration `0009`; Bankgiro syns på PDF (`business`) |
| Bolagsfält: currency, accounting_method, fiscal_year_start, logo_url, website, country | KRAV, COMPANY_SETTINGS | ⚠ | Ej byggt. SEK + räkenskapsår via `fiscal_years` antas; kosmetik/valuta-config skjuten. |
| Bolagsmedlemmar: lägg till/ta bort/ändra roll | KRAV, COMPANY_SETTINGS | ⏸ | Endast skaparen blir `owner`. Medlemshantering skjuten (team/multi-bolag). |
| Multi-tenant-isolering | KRAV, plan | ✅ | RLS + medlemskap; `tenant-isolation` (11 tester) |
| Räkenskapsår + periodlås | KICKOFF, plan | ✅ | `fiscalYears.ts`; `accounting` |

## Kontoplan, verifikat, moms, SIE

| Dokumenterad funktion | Källa | Status | Bevis |
|---|---|---|---|
| BAS-kontoplan (seedad) | KRAV, arkiv | ✅ | migration `0006` (full BAS, ej 17 konton) |
| Verifikat, debet=kredit, löpnummer, oföränderlighet | KICKOFF, KRAV | ✅ | `vouchers.ts`; `accounting`, `audit-immutability` |
| Belopp i **heltal ören** | CLAUDE.md-invariant | ✅ | `domain/money.ts`; `domain` (gamla spec:en använde DECIMAL — förbättrat) |
| Moms 0/6/12/25 %, momsrapport | KICKOFF, KRAV | ✅ | `vatReport.ts`; `autopost-vat-sie`, `domain` |
| Automatkontering: **faktura** | KICKOFF, KRAV | ✅ | `postCustomerInvoice`; `autopost-vat-sie` |
| Automatkontering: **kvitto/utgift** | KICKOFF, KRAV | ✅ | `postExpense`; `autopost-vat-sie` |
| Automatkontering: **betalning** (bank/kundfordran) | KICKOFF §1.4, KRAV | 🔧 | Konteringen fanns+testad men var **ej nåbar**; nu exponerad som `register_invoice_payment` (känslig action). `business` |
| Dubbelbokningsspärr | KICKOFF, KRAV | ✅ | `source_type`+`source_id` unik; `autopost-vat-sie`, `business` |
| SIE4-export | KICKOFF, plan | ✅ | `sie.ts`; `autopost-vat-sie` |
| OCR-nummer med Luhn | KICKOFF, KRAV | ✅ | `domain/ocr.ts` + oberoende Luhn-check; `domain` |

## Kunder / leverantörer / artiklar

| Dokumenterad funktion | Källa | Status | Bevis |
|---|---|---|---|
| Kund/leverantör/artikel — skapa, lista, hämta, uppdatera | KRAV, arkiv | ✅ | `parties.ts`; `business`, `business-review-fixes` |
| Standardlistning visar **aktiva** (regression) | KICKOFF | ✅ | `business-review-fixes` |
| Rik CRM: kontakter, anteckningar, taggar, statistik, sök/filter | KRAV, FAS2-arkiv | ⏸ | Ej byggt — grunddata finns; rik CRM skjuten. |
| Leverantörskategorier, artikel-SKU/streckkod/marginal/typ | KRAV, arkiv | ⏸ | Skjutet. |

## Fakturor & PDF

| Dokumenterad funktion | Källa | Status | Bevis |
|---|---|---|---|
| Skapa faktura med rader, totaler i ören, OCR, förfallodatum | KICKOFF, KRAV | ✅ | `invoices.ts`; `business` |
| Status draft/sent/paid/cancelled | KRAV | ✅ | migration `0010` (overdue härleds, lagras ej) |
| Bokför faktura → huvudbok | KICKOFF | ✅ | `bookInvoice`; `business` |
| Markera betald / registrera betalning | KRAV | 🔧 | via `register_invoice_payment` (se ovan) |
| PDF med Bankgiro/OCR, svensk layout | KICKOFF, KRAV | ✅ | `pdfService.ts`; `business` (läser PDF-texten) |
| Skicka faktura via e-post | KRAV | ⏸ | E-post ej byggt (se nedan). |
| Lagring S3/GCS | KRAV | ⏸ | Ersatt av lokalt dokumentarkiv utanför webroot (planens val). ✅ funktionellt |

## Kvitton / AI-OCR

| Dokumenterad funktion | Källa | Status | Bevis |
|---|---|---|---|
| Kvitto skapa/ladda upp/bokför | KICKOFF, KRAV | ✅ | `receipts.ts`; `business`, `upload` |
| AI-OCR (Claude Vision) → förslag, kräver mänsklig granskning | KICKOFF, KRAV | ✅ | `aiOcr.ts`; `actions` |
| Godkänn/avslå kvitto (workflow) | KRAV | ✅ | godkännandekö + vy-knappar; `actions`, `view` |
| Kategorier, kostnadsställe/projekt, bulk, thumbnails, multi-provider AI | KRAV | ⏸ | Skjutet (Claude-only, konto i stället för kategori). |

## Rapporter & dashboard

| Dokumenterad funktion | Källa | Status | Bevis |
|---|---|---|---|
| Resultaträkning, balansräkning, momsrapport | KICKOFF, KRAV | ✅ | `reports.ts`; `view` |
| Dashboard (nyckeltal) | KICKOFF, KRAV | ✅ | `dashboard()`; `view` (resultat, fordringar, skulder, bank, antal, att göra) |
| Kundrapport, 12-mån-diagram, Excel/PDF-export | KRAV | ⏸ | Skjutet (SIE4 täcker revisor/systembyte). |

## Dokumentarkiv & revisionslogg

| Dokumenterad funktion | Källa | Status | Bevis |
|---|---|---|---|
| Auth-skyddat dokumentarkiv (ladda upp → hämta) | KICKOFF, KRAV | ✅ | `fileStorage.ts`; `upload`, `view` |
| Oföränderlig, append-only revisionslogg | KICKOFF, plan | ✅ | Postgres (ej MongoDB); `audit-immutability` |
| Loggen visas i vyn | KICKOFF | ✅ | `view` |
| IP-adress & user-agent i loggen | KRAV, AUDIT_LOG_REVIEW | ⚠ | Ej fångat (loggen har `details` jsonb). KICKOFF kräver ej detta; forensisk enhancement, kan läggas till vid behov. |
| Rika audit-endpoints (entity history, stats) | KRAV | ⏸ | Filtrering i vyn räcker; separata endpoints skjutna. |

## AI-först / MCP / godkännanden

| Dokumenterad funktion | Källa | Status | Bevis |
|---|---|---|---|
| Action-/MCP-lager mot samma kärna | KICKOFF, plan | ✅ | `registry.ts` + `mcp/server.ts`; `actions`, `mcp` |
| Mänskligt godkännande på pengaflyttande/periodlås | KICKOFF, plan | ✅ | godkännandekö + vy; `actions`, `view` |
| Prompt-injection-skydd | KICKOFF, plan | ✅ | strikt zod-schema, data≠instruktion; `actions` |
| AI-chatbot-assistent (svenska, bolagskontext) | KRAV | ✅ | Realiseras av MCP-servern + Cowork/claude.ai |

## E-post, integrationer, avancerat (Fas 3–4 i gamla spec:en)

| Dokumenterad funktion | Källa | Status | Kommentar |
|---|---|---|---|
| E-post/notifieringar (nodemailer/SMTP), påminnelser | KRAV, QUICK_START | ⏸ | Ej byggt (gamla mailen gav alltid 500). Skjutet. |
| Återkommande fakturor | KRAV Fas 3 | ⏸ | Skjutet. |
| Projekt/tid/budget, lön, lager | KRAV Fas 3–4 | ⏸ | Skjutet (planens scope-reduktion). |
| Bank/Open Banking, avstämning, Swish | KRAV Fas 4 | ⏸ | Skjutet. |
| Skatteverket, Peppol/e-faktura, ROT/RUT, omvänd moms, BankID | KRAV, plan §6 | ⏸ | Skjutet — medvetna kravluckor att besluta om. |
| Multi-bolag/koncern, mobilapp, avancerad analys | KRAV Fas 4 | ⏸ | Skjutet (responsiv webbvy i stället för mobilapp). |
| MongoDB, Redis | KRAV, arkiv | ⏸ | Medvetet **borttagna** (oanvända) enligt plan. |

---

## Sammanfattning

- **Alla KICKOFF-acceptanskriterier (Fas 0–4): ✅** med testbevis (`docs/ACCEPTANS.md`), 489 tester gröna.
- **Kärnan i den ursprungliga kravkällan** (auth, bolag+betaluppgifter, BAS, verifikat, moms, SIE, fakturor+OCR+PDF, kvitton+AI-OCR, register, rapporter, dokumentarkiv, revisionslogg, AI/MCP + godkännanden): **✅ på plats**.
- **Äkta lucka funnen och åtgärdad denna omgång:** automatkontering av **betalning** var byggd men onåbar → nu exponerad (`register_invoice_payment`). 🔧
- **Allt övrigt som saknas är medvetet skjutet** enligt planens scope-reduktion (`GRANSKNING §5–6`) — team/roller, rik CRM, e-post/påminnelser, projekt/tid, lön, lager, bank/Open Banking, Skatteverket/Peppol/ROT-RUT, BankID/Swish, mobilapp, multi-bolag, MongoDB/Redis.
- **Två små ⚠-noteringar** (dokumenterade men ej krav i ombyggnaden): audit-logg saknar IP/user-agent-fält; bolag saknar currency/accounting_method-config. Kan byggas på begäran.

Inga andra dolda "byggd men onåbar"-funktioner hittades vid genomgång av service-,
action-, endpoint- och migrationsinventeringen.
