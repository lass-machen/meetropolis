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

The server rate-limits `POST /matchmake/...` per client IP (120 per minute by
default), and every bot joins from the same address. A run that joins more than
that per minute needs `RATE_LIMIT_MATCHMAKE_MAX` raised on the server (or
`RATE_LIMIT_ENABLED=false` for a throwaway stack).
