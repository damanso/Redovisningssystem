# Redovisningssystem

Svenskt redovisningssystem under **ombyggnad** enligt en fas-för-fas-plan med
verifieringsgrindar.

## Status

| Fas | Innehåll | Status |
|---|---|---|
| 0 | Fundament & förtroendegräns (migrationsrunner, fail-fast-env, tenant-isolering + RLS, append-only auditlogg, säkra uppladdningar) | Pågår |
| 1 | Korrekt bokföringskärna (verifikationsserier, debet=kredit i ören, oföränderlighet, moms, SIE4, OCR/Luhn) | Ej påbörjad |
| 2 | Affärsobjekt (kunder, leverantörer, artiklar, fakturor, kvitton, dokumentarkiv) | Ej påbörjad |
| 3 | AI-först-gränssnitt (MCP-/action-lager) | Ej påbörjad |
| 4 | Läsbar webbvy (read-only) | Ej påbörjad |

Statuspåståenden i det här repot ska alltid backas av körd, visad bevisning —
se `KICKOFF_NYSESSION.md` (regler) och `GRANSKNING_OCH_OMSTARTSPLAN.md` (analys & plan).

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
