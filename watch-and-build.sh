#!/usr/bin/env bash
# watch-and-build.sh
# Überwacht das Git-Repo, triggert bei Updates einen Build
# und verwendet --no-cache, falls requirements.txt oder package.json geändert wurden.
# Nach erfolgreichem (Re)Start sendet es eine Slack-Nachricht.

set -u -o pipefail

COMPOSE_FILE="docker-compose.prod.yml"
SLACK_WEBHOOK_URL="https://hooks.slack.com/services/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"
SLACK_MESSAGE="Meetropolis ist auf dem neuesten Stand."

log() { printf "[%s] %s\n" "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }

notify_slack() {
  # Sende eine einfache Textnachricht an Slack
  # Hinweis: Für echte Mentions lieber <@UXXXXXXX> verwenden (User-ID)
  curl -s -X POST -H 'Content-type: application/json' \
    --data "{\"text\":\"${SLACK_MESSAGE}\"}" \
    "${SLACK_WEBHOOK_URL}" >/dev/null 2>&1 || true
}

while true; do
  # Sicherstellen, dass ein Upstream gesetzt ist
  if ! git rev-parse --abbrev-ref @{u} >/dev/null 2>&1; then
    log "Kein Upstream-Branch gesetzt. Bitte 'git push -u origin <branch>' ausführen."
    sleep 60
    continue
  fi

  # Aktuelle Stände ermitteln
  git fetch --quiet origin || log "Warnung: 'git fetch' fehlgeschlagen."
  LOCAL="$(git rev-parse @ 2>/dev/null || echo "")"
  REMOTE="$(git rev-parse @{u} 2>/dev/null || echo "")"
  BASE="$(git merge-base @ @{u} 2>/dev/null || echo "")"

  if [[ -z "$LOCAL" || -z "$REMOTE" || -z "$BASE" ]]; then
    log "Konnte Git-Status nicht ermitteln."
    sleep 60
    continue
  fi

  if [[ "$LOCAL" == "$REMOTE" ]]; then
    log "Repo ist aktuell. Kein Build nötig."
  elif [[ "$LOCAL" == "$BASE" ]]; then
    log "Remote ist voraus. Ziehe Änderungen…"
    BEFORE_SHA="$(git rev-parse HEAD)"
    if ! git pull --ff-only --quiet; then
      log "Fast-Forward nicht möglich, versuche Rebase…"
      if ! git pull --rebase --quiet; then
        log "git pull fehlgeschlagen. Überspringe diesen Zyklus."
        sleep 60
        continue
      fi
    fi
    AFTER_SHA="$(git rev-parse HEAD)"

    CHANGED_FILES="$(git diff --name-only "$BEFORE_SHA" "$AFTER_SHA" || true)"

    if echo "$CHANGED_FILES" | grep -E -q '(^|/)(requirements\.txt|package\.json)$'; then
      NOCACHE="--no-cache"
      log "Änderung an requirements.txt oder package.json erkannt → baue mit --no-cache."
    else
      NOCACHE=""
      log "Änderungen erkannt → baue regulär (mit Cache)."
    fi

    if docker compose -f "$COMPOSE_FILE" build $NOCACHE; then
      log "Build erfolgreich. Starte Services neu…"
      if docker compose -f "$COMPOSE_FILE" down && docker compose -f "$COMPOSE_FILE" up -d; then
        log "Services laufen im Hintergrund. Sende Slack-Nachricht…"
        notify_slack
      else
        log "Fehler beim Neustart der Services."
      fi
    else
      log "Build fehlgeschlagen."
    fi
  else
    log "Lokaler Branch ist voraus oder divergiert. Manuelles Eingreifen empfohlen."
  fi

  # Die Schleife endet immer mit 1 Minute Sleep
  sleep 60
done
