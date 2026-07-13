# Redovisningssystem

Svenskt redovisningssystem under **ombyggnad** enligt en fas-för-fas-plan med
verifieringsgrindar.

## Status

Alla fem faser är byggda och passerade sin grind (`npm run build` rent +
acceptanstester gröna). Bevis: **`npm test` → 141 tester passerar** i 16 sviter
mot en riktig Postgres (`server/test/`), och `npm run build` (tsc) utan fel.

| Fas | Innehåll | Status | Bevis (testsvit) |
|---|---|---|---|
| 0 | Fundament & förtroendegräns (migrationsrunner, fail-fast-env, tenant-isolering + RLS, append-only auditlogg, säkra uppladdningar) | Klar | `migrate`, `failfast`, `tenant-isolation`, `allowlist`, `audit-immutability`, `upload` |
| 1 | Korrekt bokföringskärna (verifikationsserier, debet=kredit i ören, oföränderlighet, moms, SIE4, OCR/Luhn) | Klar | `domain`, `accounting`, `autopost-vat-sie`, `accounting-review-fixes` |
| 2 | Affärsobjekt (kunder, leverantörer, artiklar, fakturor, kvitton, dokumentarkiv) | Klar | `business`, `business-review-fixes`, `upload` |
| 3 | AI-först-gränssnitt (action-lager + godkännandekö, AI-OCR, prompt-injection-skydd) | Klar | `actions` |
| 4 | Läsbar webbvy (read-only) + designsystem + människa-i-loopen (godkänn/avvisa) | Klar | `view` |

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
