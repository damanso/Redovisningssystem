---
name: verify
description: Bygg, starta och kör API:t end-to-end mot en riktig Postgres för att verifiera ändringar i det här repot.
---

# Verifiera Redovisningssystem

Ytan är HTTP-API:t i `server/`. Verifiera genom att starta servern på riktigt
och driva flöden med curl — inte genom att köra testsviten (det gör CI).

## Databas

Kräver Postgres 16 med trust-auth på `127.0.0.1:5433` (t.ex. `docker compose up -d`,
eller ett lokalt kluster: `initdb --auth=trust` + `pg_ctl -o "-p 5433"`).
Rollen `app` skapas av migration 0001. Färsk databas + migrationer:

```bash
psql -p 5433 -U postgres -c "CREATE DATABASE verify_demo;"
cd server && DATABASE_ADMIN_URL="postgres://postgres@127.0.0.1:5433/verify_demo" npx tsx src/db/migrate.ts
```

## Starta servern

```bash
cd server
env -i PATH="$PATH" DOTENV_CONFIG_PATH=/nonexistent \
  DATABASE_URL="postgres://app@127.0.0.1:5433/verify_demo" \
  JWT_SECRET="$(openssl rand -hex 32)" PORT=3999 \
  npx tsx src/server.ts &
```

`env -i` + `DOTENV_CONFIG_PATH=/nonexistent` hindrar en lokal `.env` från att
smitta verifieringen. Servern loggar `API lyssnar på port ...` när den är uppe;
`GET /health` svarar `{"status":"ok"}` när databasen nås.

## Kärnflöde att driva

1. `POST /api/auth/register` `{email,password,name}` → 201 + token
2. `POST /api/companies` (Bearer) `{name,org_number?}` → 201
3. `GET/PATCH /api/companies/:id` (Bearer)
4. `POST /api/companies/:id/files` multipart `file=@x.png` → 201;
   `GET /api/companies/:id/files/:fileId` → nedladdning
5. `GET /api/companies/:id/audit` → revisionslogg

## Säkerhetsprober som alltid ska hålla

- Användare B mot A:s bolags-URL:er → **404, aldrig 200**
- Token signerad med `'your-secret'` → 401 (regression mot gamla bypassen)
- PATCH med okänd/skadlig nyckel → 400 `validation_error`
- Uppladdning med `../`-filnamn → 201 men lagras med UUID-namn under
  `server/data/uploads/<companyId>/`; inget hamnar utanför roten
- `.sh`/fel magic bytes → 400 `invalid_file`
- `psql`: `UPDATE audit_log ...` som postgres → `audit_log är append-only`

## Gotchas

- Processer startade med `&` lever kvar mellan skalanrop — döda dem via pid,
  inte `pkill -f tsx` (träffar även din egen nystartade process).
- `INSERT ... RETURNING` på RLS-tabeller kräver att raden är synlig enligt
  SELECT-policyn — vid bolagsskapande finns medlemskapet inte förrän efteråt.
