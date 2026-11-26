# Loadtest (local)

Example:

```bash
# From repo root
LOADTEST_TENANT=throwaway \
  LOADTEST_ACCOUNTS_FILE=./accounts.json \
  API_BASE=http://localhost:2567 \
  USERS=30 \
  RAMP=5 \
  DURATION=90 \
  npm -w @meetropolis/loadtest run dev
```

`accounts.json` is a JSON array, kept outside the repository:

```json
[{ "email": "person@example.com", "password": "replace-me" }]
```

## Accounts and tenant

`LOADTEST_ACCOUNTS_FILE` points at that array. Each object needs `email`
and `password`. `LOADTEST_TENANT` is the tenant slug, sent as `X-Tenant`.
Each simulated user takes one account. The run stops when there are fewer
accounts than `USERS`. The file contents are never printed.

Use only test accounts that are members of a disposable tenant. Do not point
this tool at production, and do not reuse production passwords. Keep the
file out of the repository and out of logs.

The world client signs in with `POST /auth/login` and joins with that
session. The LiveKit client calls `POST /livekit/token` with the same
session. `SKIP_LIVEKIT=true` skips the LiveKit client. `LIVEKIT_URL` is an
optional websocket override; otherwise the client reads `GET /livekit/url`.

Prerequisites: a local self-host stack (db, server, web, livekit) is
running, for example via `docker compose up` from the repository root.

The server rate-limits `POST /matchmake/...` per client IP (120 per minute by
default), and every client joins from the same address. A run that joins more
than that per minute needs `RATE_LIMIT_MATCHMAKE_MAX` raised on the server (or
`RATE_LIMIT_ENABLED=false` for a throwaway stack).
