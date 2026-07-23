# Loadtest (local)

Example:

```bash
# From repo root
npm -w @meetropolis/loadtest run dev

# Or with environment overrides
API_BASE=http://localhost:2567 \
  LIVEKIT_URL=ws://localhost:7880 \
  USERS=30 \
  RAMP=5 \
  DURATION=90 \
  npm -w @meetropolis/loadtest run dev
```

Prerequisites: a local self-host stack (db, server, web, livekit) is
running, for example via `docker compose up` from the repository root.
