#!/usr/bin/env bash
# Starta hela systemet lokalt på din egen dator med ETT kommando.
# Endast för dig själv: allt lyssnar på localhost, inget exponeras mot internet.
#
#   bash start-lokalt.sh
#
# Krav: Node >= 22, Docker (för Postgres). Öppnar sedan http://localhost:3000/app
set -euo pipefail
cd "$(dirname "$0")"

DB_NAME="redovisning"
APP_URL="http://localhost:3000/app"

# Redan igång? Öppna bara webbläsaren och var klar (gör app-ikonen idempotent).
if curl -s -m 2 http://127.0.0.1:3000/health >/dev/null 2>&1; then
  echo "Systemet är redan igång — öppnar $APP_URL"
  command -v open >/dev/null 2>&1 && open "$APP_URL"
  exit 0
fi

# Docker Desktop måste vara igång; starta den åt användaren på macOS.
if ! docker info >/dev/null 2>&1; then
  if command -v open >/dev/null 2>&1; then
    echo "==> Startar Docker Desktop…"
    open -a Docker || true
    for _ in $(seq 1 90); do
      docker info >/dev/null 2>&1 && break
      sleep 2
    done
  fi
  if ! docker info >/dev/null 2>&1; then
    echo "FEL: Docker svarar inte. Starta Docker Desktop och försök igen." >&2
    exit 1
  fi
fi

# Docker Compose v2 ("docker compose") eller v1 ("docker-compose")?
if docker compose version >/dev/null 2>&1; then
  DC="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
  DC="docker-compose"
else
  echo "FEL: Docker (compose) hittades inte. Installera Docker Desktop först." >&2
  exit 1
fi

echo "==> Startar Postgres…"
$DC up -d

echo "==> Väntar på att Postgres är REDO (inte bara att porten öppnats)…"
# pg_isready inne i containern kollar faktisk databas-redo — första starten kör
# initdb, vilket tar några sekunder efter att Docker redan öppnat porten.
for _ in $(seq 1 90); do
  if $DC exec -T postgres pg_isready -U postgres -q >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

echo "==> Ser till att databasen '$DB_NAME' finns…"
if ! $DC exec -T postgres psql -U postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" | grep -q 1; then
  $DC exec -T postgres createdb -U postgres "$DB_NAME"
  echo "    skapade databasen $DB_NAME"
fi

if [ ! -f .env ]; then
  echo "==> Skapar .env med en genererad JWT_SECRET…"
  cp .env.example .env
  SECRET="$(openssl rand -hex 32)"
  # Ersätt den tomma JWT_SECRET-raden (funkar på både GNU och BSD/macOS sed).
  if sed --version >/dev/null 2>&1; then
    sed -i "s|^JWT_SECRET=.*|JWT_SECRET=$SECRET|" .env
  else
    sed -i '' "s|^JWT_SECRET=.*|JWT_SECRET=$SECRET|" .env
  fi
fi

if [ ! -d node_modules ]; then
  echo "==> Installerar beroenden (första gången)…"
  npm install
fi

# Ladda .env in i skriptets miljö och exportera. npm-skripten körs i server/-mappen,
# så dotemv skulle annars leta efter server/.env och missa roten. Env-variabler som
# redan är satta här vinner (dotenv skriver inte över dem).
echo "==> Laddar miljövariabler från .env…"
set -a
# shellcheck disable=SC1091
. ./.env
set +a

echo "==> Kör migreringar…"
npm run migrate

echo ""
echo "======================================================================"
echo "  Startar API:t — webbläsaren öppnas automatiskt när allt är uppe:"
echo "      $APP_URL"
echo "  Avsluta med Ctrl+C. Kör 'bash backup.sh' regelbundet för säkerhetskopia."
echo "======================================================================"
echo ""
# Öppna webbläsaren när servern svarar (bakgrundsvakt; endast macOS har `open`).
if command -v open >/dev/null 2>&1; then
  ( for _ in $(seq 1 60); do
      if curl -s -m 2 http://127.0.0.1:3000/health >/dev/null 2>&1; then open "$APP_URL"; exit 0; fi
      sleep 1
    done ) &
fi
npm run dev
