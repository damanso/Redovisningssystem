#!/usr/bin/env bash
# Skapar en klickbar Mac-app "Redovisning" på Skrivbordet som startar systemet
# (Docker + databas + server) och öppnar webbläsaren. Dra den till Dockan om du
# vill ha den där. Kör EN gång:   bash skapa-macapp.sh
set -euo pipefail
cd "$(dirname "$0")"
REPO="$(pwd)"

if ! command -v osacompile >/dev/null 2>&1; then
  echo "FEL: det här skriptet ska köras på din Mac (osacompile saknas)." >&2
  exit 1
fi

APP="$HOME/Desktop/Redovisning.app"
rm -rf "$APP"

# AppleScript-app: öppnar Terminal och kör startskriptet i projektmappen.
# Terminalfönstret visar loggarna; startskriptet öppnar själv webbläsaren
# (och gör inget dubbelt om systemet redan är igång).
osacompile -o "$APP" <<APPLESCRIPT
tell application "Terminal"
  activate
  do script "cd '$REPO' && bash start-lokalt.sh"
end tell
APPLESCRIPT

echo ""
echo "Klart! En app-ikon 'Redovisning' ligger nu på Skrivbordet."
echo "  • Dubbelklicka på den för att starta bokföringen."
echo "  • Vill du ha den i Dockan: dra ikonen till Dockan (till höger om strecket)."
echo "  • Första gången kan macOS fråga om Terminal får styras — svara Tillåt/OK."
