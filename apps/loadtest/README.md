# Loadtest (lokal)

Beispiel:

```bash
# Aus Repo-Root
npm -w @meetropolis/loadtest run dev
# oder mit Env-Overrides
API_BASE=http://localhost:2567 LIVEKIT_URL=ws://localhost:7880 USERS=30 RAMP=5 DURATION=90 npm -w @meetropolis/loadtest run dev
```

Voraussetzungen: Lokale `docker-compose.dev.yml` Umgebung läuft (db, server, web, livekit).
