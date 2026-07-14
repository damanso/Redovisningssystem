#!/bin/sh
# Produktionsstart (körs av Dockerfile CMD, t.ex. på Railway).
# Ordning: migrera (som admin) → provisionera app-rollen → släpp root → starta API:t.
set -e

: "${DATABASE_ADMIN_URL:?DATABASE_ADMIN_URL måste vara satt (Railway: referera Postgres-tjänstens DATABASE_URL)}"
: "${JWT_SECRET:?JWT_SECRET måste vara satt (minst 32 tecken; openssl rand -hex 32)}"

# Beständig uppladdningsvolym: rätta ägarskapet så den icke-root-användaren kan skriva.
mkdir -p "${UPLOAD_DIR:-/data/uploads}"
chown -R app:app /data 2>/dev/null || true

# 1. Migrera schemat som ägar-/adminrollen. Skapar bl.a. den lågprivilegierade rollen `app`.
echo "[start] kör migreringar…"
node dist/db/migrate.js

# 2. Sätt lösenord + minimala rättigheter på app-rollen (idempotent).
if [ -n "$APP_DB_PASSWORD" ]; then
  echo "[start] provisionerar app-rollen…"
  node dist/db/provisionAppRole.js
fi

# 3. Härled app-anslutningen om den inte satts explicit (samma värd/db som admin,
#    men användaren `app` + APP_DB_PASSWORD). Så slipper du klistra ihop URL:en själv.
if [ -z "$DATABASE_URL" ]; then
  if [ -z "$APP_DB_PASSWORD" ]; then
    echo "FATAL: sätt DATABASE_URL, eller APP_DB_PASSWORD så den kan härledas ur DATABASE_ADMIN_URL" >&2
    exit 1
  fi
  DATABASE_URL="$(node -e 'const u=new URL(process.env.DATABASE_ADMIN_URL);u.username="app";u.password=process.env.APP_DB_PASSWORD;process.stdout.write(u.toString())')"
  export DATABASE_URL
fi

# 4. Starta API:t som den icke-privilegierade användaren (gosu = signal-säkert exec).
#    Servern ansluter som `app` → RLS tvingas (assertAppRoleEnforcesRls vägrar annars starta).
echo "[start] startar API:t…"
exec gosu app node dist/server.js
