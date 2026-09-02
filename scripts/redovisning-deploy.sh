#!/usr/bin/env bash
# Deploy av redovisningssystemet: oföränderliga releaser + atomisk symlänk.
#
# Varför. Driften läste tidigare direkt ur arbetskopian /opt/redovisning — samma
# katalog som CTO-motorn checkar ut grenar i. Två gånger 2026-09-01/02 stod den
# på en cto/…-gren i stället för main. Så länge systemd pekar på en föränderlig
# arbetskopia avgörs vilken kod som körs vid nästa omstart av vem som råkade
# checka ut något sist, och `git pull` vid deploy kan misslyckas på att någon
# annan bytt gren. En release ska vara ett beslut, inte en bieffekt.
#
# Modellen (standard för enkelservern: Capistrano-mönstret):
#   /opt/redovisning                     arbetskopia — motorn får göra vad den vill här
#   /opt/redovisning-app/shared/.env     konfiguration, ligger ALDRIG i en release
#   /opt/redovisning-app/releases/…      oföränderliga byggen, ett per deploy
#   /opt/redovisning-app/current         symlänk som systemd läser
#
# Hela app-katalogen ägs av hermes med flit: release-bytet ska inte behöva sudo.
# Det enda som kräver root är `systemctl restart`.
#
# Bytet är ett `mv -T` av symlänken: antingen gäller gamla releasen eller den
# nya, aldrig ett halvskrivet mellanläge. Går hälsokollen fel pekas länken
# tillbaka och tjänsten startas om på den release som bevisligen fungerade.
#
# Användning:  redovisning-deploy [git-ref]      (default: origin/main)
#              redovisning-deploy --rollback     (till föregående release)
set -Eeuo pipefail

WORK=/opt/redovisning
APP=/opt/redovisning-app
SHARED=$APP/shared
RELEASES=$APP/releases
CURRENT=$APP/current
SERVICE=redovisning
HEALTH=http://127.0.0.1:3001/health
BEHALL=5

log() { printf '%s  %s\n' "$(date +%H:%M:%S)" "$*"; }
dog() { printf '\n=== %s ===\n' "$*"; }

halsa() {
  # Hälsokollen ska utöva funktionen den vakar över (ADR-0003): den frågar inte
  # bara systemd om processen lever, den kräver ett svar från API:t.
  for i in $(seq 1 20); do
    if curl -fsS -o /dev/null --max-time 3 "$HEALTH"; then return 0; fi
    sleep 1
  done
  return 1
}

peka_om() {
  # Atomiskt byte: ln skapar en temporär länk, mv -T byter ut den befintliga i
  # ett enda steg. `ln -sfn` direkt mot en existerande symlänk är INTE atomiskt.
  ln -sfn "$1" "$CURRENT.ny"
  mv -Tf "$CURRENT.ny" "$CURRENT"
}

if [[ "${1:-}" == "--rollback" ]]; then
  FOREG=$(ls -1d "$RELEASES"/*/ 2>/dev/null | sort | tail -2 | head -1)
  [[ -n "$FOREG" ]] || { echo "ingen tidigare release att gå tillbaka till" >&2; exit 1; }
  log "rullar tillbaka till $(basename "$FOREG")"
  peka_om "${FOREG%/}"
  sudo systemctl restart "$SERVICE"
  halsa && { log "rollback klar och frisk"; exit 0; } || { echo "rollback svarar inte" >&2; exit 1; }
fi

REF="${1:-origin/main}"

dog "hämtar $REF"
# Bara objekten hämtas — arbetskopians gren och filer rörs aldrig.
git -C "$WORK" fetch origin --quiet
SHA=$(git -C "$WORK" rev-parse --verify "$REF^{commit}")
KORT=${SHA:0:7}
REL="$RELEASES/$(date -u +%Y%m%dT%H%M%SZ)-$KORT"
log "$REF = $SHA"
log "release: $REL"

dog "exporterar trädet"
mkdir -p "$REL"
# git archive skriver ut ett träd utan att checka ut det — arbetskopian står
# kvar på den gren motorn lämnade den på.
git -C "$WORK" archive "$SHA" | tar -x -C "$REL"

dog "installerar beroenden"
cd "$REL"
npm ci --silent

dog "bygger"
npm run build

dog "migrerar"
set -a; . "$SHARED/.env"; set +a
npm run migrate

dog "byter release"
FORE=""
[[ -L "$CURRENT" ]] && FORE=$(readlink -f "$CURRENT") || true
peka_om "$REL"
sudo systemctl restart "$SERVICE"

if halsa; then
  dog "frisk"
  systemctl show "$SERVICE" -p MainPID -p ActiveState --no-pager
  git -C "$WORK" log -1 --format='deployad commit: %h %s' "$SHA"
else
  dog "HÄLSOKOLLEN MISSLYCKADES — rullar tillbaka"
  if [[ -n "$FORE" ]]; then
    peka_om "$FORE"
    sudo systemctl restart "$SERVICE"
    halsa && log "tillbaka på $(basename "$FORE"), frisk" || log "VARNING: även föregående release svarar inte"
  fi
  journalctl -u "$SERVICE" -n 30 --no-pager
  exit 1
fi

dog "städar gamla releaser (behåller $BEHALL)"
# Den release som är utpekad just nu raderas aldrig, oavsett ålder.
NU=$(readlink -f "$CURRENT")
ls -1d "$RELEASES"/*/ | sort | head -n -"$BEHALL" | while read -r g; do
  [[ "$(readlink -f "$g")" == "$NU" ]] && continue
  log "tar bort $(basename "$g")"
  rm -rf "$g"
done

dog "klart"
