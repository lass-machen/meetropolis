# The origin allowlist

One list, `CORS_ORIGIN`, decides which browser origins may talk to the
server. It is read once at start and used by every entry point:

- the HTTP API (Express),
- the matchmaking route (Colyseus), which answers before Express runs,
- the websocket upgrade.

There is no second rule anywhere. A request cannot be allowed on one path and
refused on another.

## What an entry looks like

An entry is an exact origin: `scheme://host` or `scheme://host:port`.

- `https://app.example` - the web client on that host.
- `tauri://localhost` - the desktop app on macOS and Linux.
- `http://tauri.localhost` - the desktop app on Windows (WebView2).

Refused at start, because they are not exact origins:

- `*` and `https://*.example` - a wildcard or a suffix rule,
- `https://example/app` - a path, an origin never has one,
- `null` - the value a browser sends for a sandboxed document,
- `https://example:0` and `https://example:99999` - a port out of range,
- `HTTPS://example` - the scheme is lowercase in an origin.

A list with one bad entry refuses the whole start: a typo must not silently
narrow the allowlist.

## What the server does with a request

- An allowed origin is served. The answer carries
  `Access-Control-Allow-Origin` with exactly that origin,
  `Access-Control-Allow-Credentials: true`, the fixed list of request
  headers the server needs (never the headers the caller asked for) and a
  `Vary: Origin` that is added to the existing one, not written over.
- An origin that is not listed gets `403` and no CORS headers at all.
- `Origin: null` gets `403` and no CORS headers at all.
- A request without an `Origin` header is not a browser request. It stays
  possible for native clients, webhooks and health checks, gets no CORS
  headers, and is decided by the route's own auth.
- A websocket upgrade with a listed origin proceeds.
- A websocket upgrade with a foreign origin is refused before the `101`.
- A websocket upgrade without an origin proceeds; the matchmaking auth and
  the seat reservation decide whether it reaches a room.

## The start refuses a missing list

`CORS_ORIGIN` is required in every mode, development included. Without a
valid list the server writes a message that names the key to stderr and exits
with status 1 before it serves anything. The value is never printed. The
Compose file refuses to start the stack when the key is not set at all.

Development therefore needs an explicit local list, for example the web dev
server of the Vite setup:

```
CORS_ORIGIN=http://localhost:5173,http://localhost:5174,tauri://localhost,http://tauri.localhost
```

## The public assets keep their own contract

`/packs`, `/assets` and `/npc-media` are public static files and answer with
`Access-Control-Allow-Origin: *` of their own. The allowlist does not apply
to them.

## The operator tools

The `/tools` pages are served from the origin of the deployment itself. There
is no same-origin exception any more: a browser sends an `Origin` header with
every non-simple request, so an operator who uses the tools lists the API
origin of the deployment in `CORS_ORIGIN` as well.
