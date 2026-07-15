#!/usr/bin/env bash
# Säkerhetskopiera hela databasen till backups/ (kör regelbundet — din disk är
# enda kopian när du kör lokalt). Använder pg_dump inne i Postgres-containern,
# så du behöver inga Postgres-verktyg installerade.
#
#   bash backup.sh
set -euo pipefail
cd "$(dirname "$0")"

DB_NAME="redovisning"

if docker compose version >/dev/null 2>&1; then
  DC="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
  DC="docker-compose"
else
  echo "FEL: Docker (compose) hittades inte." >&2
  exit 1
fi

mkdir -p backups
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="backups/backup-$STAMP.dump"

echo "==> Dumpar databasen '$DB_NAME'…"
$DC exec -T postgres pg_dump -U postgres -Fc "$DB_NAME" > "$OUT"

echo "==> Klart: $OUT ($(du -h "$OUT" | cut -f1))"
echo ""
echo "Återläsning vid behov (skriver över databasen):"
echo "  $DC exec -T postgres pg_restore -U postgres -d $DB_NAME --clean --if-exists < $OUT"
