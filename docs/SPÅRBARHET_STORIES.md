# Story-nivå spårbarhet — BMAD-stories → ombyggd kärna

Verifiering av **varje BMAD-story** i `damanso/redovisningssystem1` (BMAD-projektet:
PRD `docs/PRD-Fas3-Fas4.md`, `docs/epics.md`, och **93 storyfiler** i `docs/stories/`
— 89 unika stories + arbetsartefakter) mot den **ombyggda kärnan**
`damanso/redovisningssystem` (469 tester gröna).

Klassning per story: **✅ BUILT** (kärnan täcker mål + acceptanskriterier) ·
**🟡 PARTIAL** (kärnkapaciteten finns, vissa AC/tillägg saknas) ·
**⏸ DEFERRED** (medvetet utanför ombyggd scope enligt `GRANSKNING §5–6`) ·
**❌ MISSING** (borde rimligen finnas men saknas).

> **Ramverk:** BMAD-projektet är den *fullständiga enterprise-ambitionen* (project_level 4,
> "enterprise, brownfield"). Ombyggnaden är en **medvetet bantad, korrekt kärna** (MVP) —
> så att merparten av breddstories är ⏸ DEFERRED är *förväntat och planenligt*, inte ett fel.

## Sammanställning

| | Stories | ✅ | 🟡 | ⏸ | ❌ |
|---|---|---|---|---|---|
| **Totalt (89)** | | **11** | **15** | **63** | **0** |

**Slutsats:** Kärnepicsen (auth, redovisning, fakturor, kvitton, rapporter, AI/MCP) är
byggda; de 15 🟡 är byggda grundfunktioner där enterprise-tillägg (åldersanalys, diagram,
rapportexport, multi-provider-OCR, in-app-chattwidget) saknas. De 63 ⏸ är breddscope
(rich CRM, migration, kassaflöde, lön, återkommande/projekt/integrationer, enterprise/bank/
mobil). **Noll stories är oavsiktligt saknade** — allt är byggt, delvis byggt, eller medvetet skjutet.

---

## Epic 0 — Authentication & Security · 3 ✅ / 1 🟡 / 7 ⏸

| Story | Titel | Status |
|---|---|---|
| 0-1 | Database Migrations | ✅ |
| 0-2 | MongoDB Audit Logging | ✅ (ersatt av Postgres append-only) |
| 0-3 | User Service Methods (lösenordsbyte, aktivering) | ⏸ |
| 0-4 | Customer Endpoints (kontakter/anteckningar) | ⏸ (rich CRM) |
| 0-5 | Swedish Validation Utils | 🟡 (Luhn/OCR finns; dedikerade org/tel-validatorer ej fulla) |
| 0-6 | Frontend Auth Services (React) | ⏸ (ersatt av JS-fri vy) |
| 0-7 | Error Handling Middleware | ✅ |
| 0-9 | Two-Factor Authentication | ⏸ |
| 0-10 | Email Verification | ⏸ |
| 0-11 | Password Reset Flow | ⏸ |
| 0-12 | Token Refresh Endpoint | ⏸ |

## Epic 2 — VAT / Accounting Services · 3 ✅ / 1 🟡

| Story | Titel | Status |
|---|---|---|
| 2-1 | VAT Configuration Service | ✅ |
| 2-2 | Sequence Number Service | 🟡 (gap-fri numrering finns; generisk konfig-sekvens ej) |
| 2-3 | File Storage Service | ✅ (S3 → lokal disk medvetet) |
| 2-4 | Article Management UI | ✅ (via JS-fri vy) |

## Epic 3 — Contacts / Notes / Tags / Validation · 0 ✅ / 1 🟡 / 3 ⏸

| Story | Titel | Status |
|---|---|---|
| 3-1 | Contact Person Management | ⏸ (rich CRM) |
| 3-2 | Notes System | ⏸ (rich CRM) |
| 3-3 | Tags & Categories | ⏸ (rich CRM) |
| 3-4 | Enhanced Swedish Validation | 🟡 (grundvalidering finns; personnr/clearing ej) |

## Epic 4 — Payments / PDF / OCR / AR / Journal · 2 ✅ / 3 🟡

| Story | Titel | Status |
|---|---|---|
| 4-1 | Payment Tracking & Registration | 🟡 (register_invoice_payment finns; delbetalning/påminnelser ej) |
| 4-2 | PDF Invoice Generation | ✅ |
| 4-3 | Real OCR Integration | 🟡 (Claude Vision finns; multi-provider/kostnadsspårning ej) |
| 4-4 | Accounts Receivable Management | 🟡 (fordran spåras/nollställs; AR-åldersanalys ej) |
| 4-5 | Automated Journal Entry Creation | ✅ |

## Epic 5 — Reports / Dashboard · 3 ✅ / 3 🟡

| Story | Titel | Status |
|---|---|---|
| 5-1 | Income Statement (Resultaträkning) | ✅ |
| 5-2 | Balance Sheet (Balansräkning) | ✅ |
| 5-3 | VAT Report (Momsrapport) | ✅ |
| 5-4 | Accounts Payable Report | 🟡 (skuld visas; dedikerad AP-rapport/åldersanalys ej) |
| 5-5 | Main Dashboard | 🟡 (KPI:er finns; diagram/aviseringar ej) |
| 5-6 | Reports Navigation | 🟡 (grundnavigering finns; favoriter/sök/fler rapporter ej) |

## Epic 6 — Migration & Data Import · 0 ✅ / 1 🟡 / 12 ⏸

Migreringssessioner, bulk-uppladdning, multi-provider-OCR-batch, Excel-export,
**bankfilsimport**, fuzzy-matchning, dubblettdetektering — allt ⏸ (planens scope
skjuter upp migration/import). Undantag: **6-10 Opening Balance Import 🟡** (kärnan
kan skapa ett ingående balans-verifikat manuellt; Excel-import + legacy→BAS-mappning ej).

## Epic 7 — Cash Flow & Liquidity · 0 ✅ / 1 🟡 / 9 ⏸

PSD2-bankkoppling, kontoutdragsimport, lönslider, köp-scenariovalidator,
30-dagars kassaflödesprognos, likviditetsvarningar, återkommande utgifter,
löneworkflow, rekommendationsmotor — allt ⏸. Undantag: **7-4 Available Funds 🟡**
(dashboard visar bank/fordran/skuld; "tillgängligt nu"-beräkning med reservationer ej).

## Epic 8 — Payroll & HR · 0 ✅ / 0 🟡 / 15 ⏸

Anställda, löneuppsättning, skattetabeller, pension, semester, löneberäkning,
tidregistrering, sjukfrånvaro, lönespecar, lönekörning, **AGI**, **KU-10**,
lönedashboard — **hela epicen ⏸** (lön/HR uttryckligen uppskjutet).

## Epic 9 — Intelligent Automation · 0 ✅ / 3 🟡 / 9 ⏸

| Story | Titel | Status |
|---|---|---|
| 9-1 | AI Chatbot - Core Infrastructure | 🟡 (levereras som MCP-server, ej in-app-widget) |
| 9-2 | AI Chatbot - Data Query | 🟡 (läsverktyg via MCP; widget-UX ej) |
| 9-3 | AI Chatbot - Action Execution | 🟡 (MCP + human-in-the-loop-godkännande motsvarar "bekräfta före utförande") |
| 9-4 | Recurring Invoices - Templates | ⏸ |
| 9-5 | Recurring Invoices - Auto Generation | ⏸ (ingen scheduler) |
| 9-6 | Project & Time - Management | ⏸ (projekt/tid uppskjutet, §5) |
| 9-7 | Project & Time - Entry Logging | ⏸ |
| 9-8 | Project & Time - Reporting | ⏸ |
| 9-9 | Google Drive Integration | ⏸ (integrationer uppskjutna) |
| 9-10 | Google Calendar Integration | ⏸ |
| 9-11 | Skatteverket AGI Reporting | ⏸ (Skatteverket uppskjutet, §6) |
| 9-12 | Skatteverket KU-10 | ⏸ |

*(Granskaren märkte 9-6…9-12 som ❌; korrigerat till ⏸ eftersom planen uttryckligen
skjuter upp projekt/tid, Skatteverket och integrationer.)*

## Epic 10 — Enterprise & Advanced · 0 ✅ / 1 🟡 / 8 ⏸

| Story | Titel | Status |
|---|---|---|
| 10-2 | Multi-Company Consolidated Reporting | ⏸ |
| 10-3 | Multi-Company User Access Control | 🟡 (multi-tenant medlemskap finns; inbjudan/rolladmin-UI ej) |
| 10-4 | Bank Integration (PSD2) - Setup | ⏸ |
| 10-5 | Bank Integration - Transaction Import | ⏸ |
| 10-6 | Bank Integration - Smart Matching | ⏸ |
| 10-7 | Mobile App - Auth & Navigation | ⏸ (responsiv webbvy, ej native app) |
| 10-8 | Mobile App - Receipt Scanning | ⏸ |
| 10-9 | Advanced Analytics - Revenue Forecasting | ⏸ |
| 10-10 | Advanced Analytics - Customer Segmentation | ⏸ |

---

## Vad detta betyder för dig

- **Kärnan du kan använda live idag** motsvarar epics 0/2/4/5 + AI-delen av 9 (bokföring,
  moms, fakturor med OCR/PDF, kvitton med AI-OCR, rapporter, dokument, revisionslogg,
  AI/MCP med mänskligt godkännande).
- **De 15 🟡** är rimliga *nästa steg* ovanpå byggd funktionalitet: AR/AP-åldersanalys,
  dashboard-diagram, rapportexport (PDF/Excel), delbetalningar, multi-provider-OCR,
  en in-app-chattwidget, samt inbjudan/rolladministration för team.
- **De 63 ⏸** är hela moduler (rich CRM, migration/bankimport, kassaflöde, **lön/HR**,
  återkommande fakturor, projekt/tid, Google/Skatteverket-integrationer, multi-bolag,
  bank/PSD2, mobilapp, avancerad analys) — medvetet uppskjutna tills kärnan är betrodd.
- **Inga oavsiktliga luckor.** Den enda "byggd men onåbar"-lucka som fanns (betalnings-
  kontering) åtgärdades tidigare (`register_invoice_payment`).
