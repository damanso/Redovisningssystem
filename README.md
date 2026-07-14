# Redovisningssystem

Svenskt redovisningssystem under **ombyggnad** enligt en fas-för-fas-plan med
verifieringsgrindar.

## Status

Grundfaserna 0–4, utökningsfaserna A1–A14 samt bokslut/skatt-faserna B1–B4 är
byggda och passerade sina grindar (`npm run build` rent + acceptanstester gröna).
Bevis: **`npm test` → 235 tester passerar** i 37 sviter mot en riktig Postgres
(`server/test/`), och `npm run build` (tsc) utan fel.

### Grundfaser

| Fas | Innehåll | Status | Bevis (testsvit) |
|---|---|---|---|
| 0 | Fundament & förtroendegräns (migrationsrunner, fail-fast-env, tenant-isolering + RLS, append-only auditlogg, säkra uppladdningar) | Klar | `migrate`, `failfast`, `tenant-isolation`, `allowlist`, `audit-immutability`, `upload` |
| 1 | Korrekt bokföringskärna (verifikationsserier, debet=kredit i ören, oföränderlighet, moms, SIE4, OCR/Luhn) | Klar | `domain`, `accounting`, `autopost-vat-sie`, `accounting-review-fixes` |
| 2 | Affärsobjekt (kunder, leverantörer, artiklar, fakturor, kvitton, dokumentarkiv) | Klar | `business`, `business-review-fixes`, `upload` |
| 3 | AI-först-gränssnitt (action-lager + godkännandekö, AI-OCR, prompt-injection-skydd) | Klar | `actions` |
| 4 | Läsbar webbvy (read-only) + designsystem + människa-i-loopen (godkänn/avvisa) | Klar | `view` |

### Utökningsfaser (A-serien)

| Fas | Innehåll | Status | Bevis (testsvit) |
|---|---|---|---|
| A1 | Dashboard 12-mån intäktsdiagram (JS-fri SVG) | Klar | `dashboard-chart` |
| A2 | Rich CRM — kontaktpersoner, anteckningar, taggar | Klar | `crm` |
| A3 | Riktiga delbetalningar (FOR UPDATE-serialisering) | Klar | `partial-payments` |
| A4 | Leverantörsfakturor + AP-åldersanalys | Klar | `supplier-invoices` |
| A5 | Återkommande fakturor (mall + generering) | Klar | `recurring-invoices` |
| A6 | Projekt & tidrapportering | Klar | `projects-time` |
| A7 | Kassaflöde & likviditetsprognos | Klar | `cashflow` |
| A8 | Multi-bolag konsoliderad översikt | Klar | `consolidated` |
| A9 | Avancerad analys (nyckeltal, toppkunder, kostnader) | Klar | `analytics` |
| A10 | Team & roller (owner/admin/member) | Klar | `team` |
| A11 | Användarkonto — profil, lösenord, 2FA (TOTP) | Klar | `account-totp` |
| A12 | In-app-notiser + e-post-outbox (bakom SMTP) | Klar | `notifications` |
| A13 | Migration/import — SIE-import + CSV-bankimport | Klar | `import` |
| A14 | Lön & HR (utan AGI/KU-10 till Skatteverket) | Klar | `payroll` |

### Bokslut & skatt (B-serien)

| Fas | Innehåll | Status | Bevis (testsvit) |
|---|---|---|---|
| B1 | K2-årsredovisning — resultat- & balansräkning i K2-uppställning + noter, jämförelseår, CSV-export | Klar | `k2-annual` |
| B2 | Skatteskuld & skattekonto — moms, AGI (skatt + arbetsgivaravgift), uppskattad bolagsskatt + vägledande deadlines, konfigurerbar momsperiod | Klar | `taxes` |
| B3 | Skattestöd — underskottsavdrag, periodiseringsfond, optimerad vs baslinje-skatt, momsavdrag-genomgång, avdragschecklista | Klar | `tax-planning` |
| B4 | Skattepåminnelser — deadlines → notiser + (SMTP-gated) e-post, idempotent | Klar | `tax-reminders` |

B-serien producerar **beräknat underlag ur bokföringen** (för manuell inmatning i
t.ex. deklarationsprogram) med tydliga förbehåll i vyerna. Ingen digital inlämning,
och skattestödet är ett förenklat beslutsstöd (utan skattemässiga justeringar) — inte
skatterådgivning.

### Utanför scope / integrationsgränser

Följande är medvetet **inte** byggt (eller byggt fram till en tydligt flaggad
gräns), enligt uppdraget:

- **BankID** och **Skatteverket** (AGI/arbetsgivardeklaration, KU-10, moms-/inkomstdeklaration): ej digitalt inlämnat — B-serien beräknar underlag för manuell inmatning.
- **Bolagsverket**: ingen digital inlämning av årsredovisning (iXBRL/taxonomi) — B1 ger K2-underlaget.
- **PSD2 / live bankkoppling**: ej byggt — bankimport sker via manuell CSV-fil.
- **SMTP-utskick**: e-post läggs i en outbox men skickas bara om SMTP konfigureras;
  utan config markeras raderna `skipped_no_smtp` (ingen fejkad leverans).
- **Automatiska skattepåminnelser**: `run_tax_reminders` skapar notiser/e-post, men automatisk avfyrning kräver en extern schemaläggare (cron).
- **Inbjudningslänk till nya (oregistrerade) användare**: kräver e-postutskick (SMTP) — flaggad.

Statuspåståenden i det här repot ska alltid backas av körd, visad bevisning —
se `KICKOFF_NYSESSION.md` (regler) och `GRANSKNING_OCH_OMSTARTSPLAN.md` (analys & plan).
Kör `npm test -w server` för att reproducera bevisen ovan.

## Struktur

```
server/          API + bokföringskärna (TypeScript, Express, Postgres)
  migrations/    SQL-migrationer, körs av server/src/db/migrate.ts
docs/
  KRAV_Claude.md Ursprunglig kravkälla (domänkrav)
  archive/       Arkiverade, vilseledande statusrapporter från den gamla koden
```

Den gamla implementationen är borttagen ur trädet men finns i git-historiken
(SHA:n för det sista trädet med legacy-koden står i commit-meddelandet som tog bort den).

## Kom igång (utveckling)

Krav: Node ≥ 22, PostgreSQL 16.

```bash
# Starta Postgres (t.ex. via docker compose up -d)
cp .env.example .env       # fyll i JWT_SECRET (openssl rand -hex 32)
npm install
npm run migrate            # kör migrationskedjan
npm run dev                # startar API:t
npm test                   # kör testerna (kräver Postgres)
```

API:t ansluter som den lågprivilegierade rollen `app` (Row Level Security tvingas),
migrationsrunnern som ägarrollen via `DATABASE_ADMIN_URL`.

## Använda live

Två gränssnitt mot samma kärna:

1. **AI-först (Cowork/claude.ai)** — kör MCP-servern (`npm run mcp -w server`) och
   koppla in den i din MCP-klient. Då kan du prata med bokföringen: *"lista kunder"*,
   *"skapa faktura"*, *"bokför faktura X"*. Känsliga åtgärder (bokföra, låsa period)
   utförs aldrig av AI:t direkt — de hamnar i en godkännandekö. Se `docs/MCP_ACTIONS.md`.
2. **Läsbar webbvy (`/app`)** — logga in och se allt: översikt, huvudbok, rapporter,
   register, dokument och hela revisionsloggen. Här godkänner/avvisar du (som människa)
   AI:ts förslag under **Att göra** — det är människa-i-loopen.

Kom igång: registrera en användare (`POST /api/auth/register`), skapa ett bolag och
ett räkenskapsår, minta ett agent-token för MCP-servern, och börja bokföra.
