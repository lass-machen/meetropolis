# Meetropolis

An open-source virtual office platform for remote teams. Proximity-based
spatial audio/video, a live 2D world built on Phaser, and a real-time
multi-user engine powered by Colyseus.

[![CI](https://github.com/lass-machen/meetropolis/actions/workflows/ci.yml/badge.svg)](https://github.com/lass-machen/meetropolis/actions/workflows/ci.yml)
![License: AGPL-3.0-only](https://img.shields.io/badge/License-AGPL--3.0--only-blue.svg)
![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)
![Node](https://img.shields.io/badge/Node-24-green.svg)
![TypeScript](https://img.shields.io/badge/TypeScript-6.x-blue.svg)

## Quick Start

### Self-host (Linux Docker Engine)

```bash
git clone https://github.com/lass-machen/meetropolis.git
cd meetropolis
cp .env.example .env          # edit with your values
mkdir -p data/postgres data/packs
sudo chown -R 999:999 data/postgres   # Postgres in the container is UID 999; not needed on macOS/Windows with Docker Desktop

# Generate values and copy the printed assignments into .env before startup.
# Replace the template LiveKit and Postgres values as well as the empty secrets.
echo "JWT_SECRET=$(openssl rand -hex 32)"
echo "API_TOKEN_PEPPER=$(openssl rand -hex 16)"
echo "LIVEKIT_API_KEY=$(openssl rand -hex 12)"
echo "LIVEKIT_API_SECRET=$(openssl rand -hex 32)"
POSTGRES_PASSWORD=$(openssl rand -hex 32)
echo "POSTGRES_PASSWORD=$POSTGRES_PASSWORD"
echo "DATABASE_URL=postgresql://postgres:$POSTGRES_PASSWORD@db:5432/meetropolis?schema=public"
# Production-mode seeding also needs an explicit initial administrator.
echo "SEED_ADMIN_EMAIL=admin@example.com"
echo "SEED_ADMIN_PASSWORD=$(openssl rand -hex 32)"

docker compose up -d          # builds OSS images; starts db, server, web, livekit
```

LiveKit uses the Linux host network. Its signal and RTC ports listen directly
on the host; Docker does not publish them. The getting-started `--dev` command
binds signalling to all interfaces and receives your configured API key pair
through `LIVEKIT_KEYS`, matching the application's token signer.
Apply [production hardening](docs/livekit-production.md) before public use.
On a Linux host using UFW, also apply the guide's container-to-host signalling
rules for the app bridge: host networking needs INPUT permission even for the
getting-started server-to-LiveKit connection.

On **macOS / Windows with Docker Desktop**, use the bridge overlay instead:

For real browser calls, first set `HOST_IP` in `.env` to the host's LAN IPv4
reachable by the browser, including when that browser runs on the same Mac or
Windows host. The default `127.0.0.1` is only for the HTTP smoke test, not the
address to use for browser audio/video.

```bash
docker compose -f compose.yaml -f compose.docker-desktop.yaml up -d
```

Alternatively, add `COMPOSE_FILE=compose.yaml:compose.docker-desktop.yaml` to
`.env` on macOS/Linux and use `docker compose up -d`. On Windows, the default
separator is `;`: use `COMPOSE_FILE=compose.yaml;compose.docker-desktop.yaml`,
or explicitly set `COMPOSE_PATH_SEPARATOR=:` for the colon form. Repeated `-f`
flags work on all platforms. The overlay publishes only three ports,
keeps TURN disabled and sets LiveKit's `NODE_IP` from `HOST_IP` (default
`127.0.0.1`). It does not require Docker Desktop's optional host-network setting.

**Upgrade:** change existing `.env` entries from `LIVEKIT_URL=ws://livekit:7880`
to `LIVEKIT_URL=ws://host.docker.internal:7880`. The server maps that hostname
to Docker's host gateway. Keep browser-facing `LIVEKIT_EXTERNAL_URL` and
`VITE_LIVEKIT_URL` set to an address reachable by clients. Linux port changes
now belong in `livekit.yaml`. The Desktop overlay allows only
`LIVEKIT_SIGNAL_PORT` to change the signal publication; RTC publications stay
fixed at `7881/tcp` and `7882/udp` to match the listeners and ICE candidates.
Those RTC host ports must be available; remapping them alone would break media.

After startup:

| Service                  | URL                   |
| ------------------------ | --------------------- |
| Web app                  | http://localhost:5173 |
| Server (Colyseus + REST) | http://localhost:2567 |
| LiveKit signal           | http://localhost:7880 |

| LiveKit port | Linux host network       | Docker Desktop overlay |
| ------------ | ------------------------ | ---------------------- |
| 7880/tcp     | Signal listener on host  | Published signal port  |
| 7881/tcp     | RTC TCP listener on host | Published RTC TCP port |
| 7882/udp     | RTC UDP listener on host | Published RTC UDP port |

Required values: `JWT_SECRET`, `API_TOKEN_PEPPER`, `LIVEKIT_API_KEY`,
`LIVEKIT_API_SECRET`, `POSTGRES_PASSWORD` and the matching password in
`DATABASE_URL`. Initial seeding also requires `SEED_ADMIN_EMAIL` and
`SEED_ADMIN_PASSWORD`; replace the example email with your administrator's address.
The startup credential policy rejects the public `devkey`, `secret` and
`postgres` template values. Missing LiveKit keys are rejected by Compose with
their variable names; set all values **before** the first `docker compose up`.
The versioned `.env.example` retains those placeholders for reference, so
copying it alone is insufficient.

Optional NPC integrations require the same configured LiveKit credentials.
Public demo fallbacks are available only with an explicit `NODE_ENV=development`;
production, test and unspecified modes reject missing or public placeholder values.

Use the generated hexadecimal key and secret above. The Compose YAML mapping
does not accept double quotes, backslashes or line breaks inside either value.

The migration service currently allows a failed seed command to finish with
exit code 0. A healthy server therefore does not prove that the initial admin
or office map was created. Inspect `docker compose logs migrate` for seed errors.
After correcting the seed credentials, rerun the seed without suppressing its
exit status:

```bash
docker compose run --rm --no-deps migrate npx prisma db seed --schema /workspace/apps/server/prisma/schema.prisma
```

Confirm that it succeeds and that the configured initial administrator can log in.

Set `PUBLIC_BASE_URL` to the absolute public URL of the web app (for example `https://meet.example.com`). It is the only base for invitation, guest, email-verification, password-reset and welcome links. Without a usable value the server logs a warning at startup and refuses to create those links (`public_base_url_missing`) instead of handing out a broken one. A loopback or `*.localhost` base is accepted only with `PUBLIC_BASE_URL_ALLOW_LOOPBACK=true`, for a local try-out on `http://localhost:5173`; never set that flag in production.
**Breaking change:** earlier versions fell back to relative links, to `BILLING_PUBLIC_URL` or to the request origin or host. These fallbacks are gone, so set `PUBLIC_BASE_URL` before upgrading.

`compose.yaml` ships no reverse proxy and no TLS terminator — you are
expected to put your own (Traefik, Caddy, nginx, etc.) in front of the
server and web containers for production. See `## Production deployment`
below for the minimum env surface.

### Local development overrides

The shipped `compose.yaml` is the production-style self-host stack. For
hot-reload, bind-mounted source or extra services (Prometheus, Grafana,
load-test harness, NPC automation), add an uncommitted
`compose.override.yaml` next to it; Docker Compose picks the override up
automatically on `up`. The OSS repo ships the base stack and a Docker Desktop
overlay; extra dev tooling belongs in your own override. When using explicit
`-f` flags, include your override explicitly as well.

### Local development without Docker

Requires a running PostgreSQL instance. Configure `DATABASE_URL` in `.env`.
For a server running outside Docker, also set `LIVEKIT_URL` to the SFU address
reachable from that process (for example `ws://localhost:7880` for local LiveKit).

Set `NPC_MEDIA_DIR` to a writable directory (for example `./.data/npc-media`); its default `/data/npc-media` is meant for the Docker volume, and the server logs `npc_media.dir_unavailable` if it cannot create it.

```bash
npm install
npm run dev          # starts server + web concurrently
```

The server's `predev` script runs `prisma generate`, `db push` and `db seed`
automatically before the dev server boots.

To run workspaces individually:

```bash
npm run dev:server   # apps/server only
npm run dev:web      # apps/web only
```

## Asset Atelier

The [Asset Atelier](tools/asset-lab/README.md) provides a visual avatar editor,
a pixel editor, and three walkable office templates with prepared collisions.
It runs locally without a backend, and its original pixel templates and assets
are available under the MIT license. It is a local authoring tool only: it is
not connected to the production map or avatar APIs and does not import TMJ files.

```bash
cd tools/asset-lab
npm ci
npm run dev
```

## Requirements

| Requirement             | Version                                                  |
| ----------------------- | -------------------------------------------------------- |
| Node.js                 | `>=24.0.0 <25` (enforced by `engines` in `package.json`) |
| npm                     | `11.7.0` (pinned via `packageManager`)                   |
| Docker + Docker Compose | optional, for the full-stack local setup                 |
| PostgreSQL 16           | required for local dev without Docker                    |

> **macOS / Windows + Docker Desktop note:** Chrome filters loopback ICE
> candidates. With the Desktop overlay, use the host's reachable LAN IPv4 as
> `HOST_IP` for browser audio/video, including local browsers that filter
> loopback. Recreate LiveKit with the same Compose files. The default `127.0.0.1`
> supports an HTTP smoke test; verify real browser media separately. LiveKit
> reads `NODE_IP`; it does not read `LK_*` environment variables.

## Repo structure

```
meetropolis/
├── apps/
│   ├── server/              # Express + Colyseus + Prisma
│   │   └── prisma/          # schema + migrations
│   ├── web/                 # React + Vite + Phaser + i18next
│   │   └── src/locales/     # i18n catalog (en, de)
│   ├── npc-service/         # NPC automation service
│   └── loadtest/            # Load-testing harness
├── packages/
│   └── shared/              # Shared types and utilities
├── scripts/
│   ├── enforce-budgets.js   # LoC budget gate (runs via npm run lint)
│   └── lint-stats.cjs       # ESLint warning regression gate
├── docs/                    # Extended docs
├── AGENTS.md                # Dev guidelines and quality budgets
├── LIBRARY_BOUNDARIES.md    # Type-boundary patterns for unsafe library edges
├── TEST_STRATEGY.md         # Testing approach and coverage expectations
├── lint-stats.json          # Tracked lint warning baseline (committed)
├── eslint.config.mjs        # ESLint flat config
├── commitlint.config.mjs    # Conventional commits enforcement
├── compose.yaml             # Self-host stack (Postgres + server + web + LiveKit)
└── .env.example             # All available environment variables
```

The server and web app contain a small number of dynamic-import boundaries
(`apps/server/src/{tenancyLoader,billingLoader,adminLoader}.ts`,
`apps/web/src/lib/{enterpriseWebLoader,brandLoader,desktopLoader}.ts`,
`apps/web/optional-submodules.ts`) that resolve to `null` in this
distribution. Tiamat operates additional closed-source modules against these
boundaries; the OSS build runs fully without them.

## Development

### Root scripts (run from repo root)

| Script                      | What it does                                       |
| --------------------------- | -------------------------------------------------- |
| `npm run dev`               | Start server + web concurrently                    |
| `npm run dev:server`        | Server only                                        |
| `npm run dev:web`           | Web only                                           |
| `npm run build`             | Build web (Vite) and server (tsc)                  |
| `npm run typecheck`         | `tsc --noEmit` in all workspaces                   |
| `npm run lint`              | ESLint + budget gate + lint-stats regression check |
| `npm run lint:fix`          | ESLint with auto-fix                               |
| `npm run lint:stats:update` | Update the committed lint warning baseline         |
| `npm run format`            | Prettier write                                     |
| `npm run format:check`      | Prettier check (no write)                          |
| `npm run generate`          | Run `prisma generate` for the server workspace     |
| `npm run prisma:migrate`    | Create and apply a new migration                   |

### Environment variables

Copy `.env.example` to `.env`. Key variables:

| Variable             | Description                                                                              |
| -------------------- | ---------------------------------------------------------------------------------------- |
| `DATABASE_URL`       | PostgreSQL connection string                                                             |
| `JWT_SECRET`         | JWT signing secret (32+ chars in production)                                             |
| `LIVEKIT_URL`        | LiveKit server URL                                                                       |
| `LIVEKIT_API_KEY`    | LiveKit API key                                                                          |
| `LIVEKIT_API_SECRET` | LiveKit API secret                                                                       |
| `HOST_IP`            | Host LAN IP for LiveKit ICE (Docker Desktop on macOS)                                    |
| `CORS_ORIGIN`        | Exact list of allowed browser origins (required)                                         |
| `PUBLIC_BASE_URL`    | Absolute public web app URL used for shareable links                                     |
| `METRICS_PORT`       | Optional scrape listener; unset disables it                                              |
| `METRICS_HOST`       | Bind address for that listener (default loopback)                                        |
| `VITE_API_BASE`      | Server URL baked into the web bundle at _build_ time                                     |
| `VITE_LIVEKIT_URL`   | LiveKit URL baked into the web bundle at _build_ time                                    |
| `NPC_MEDIA_DIR`      | Storage directory for NPC media, shared with the npc service (default `/data/npc-media`) |

See `.env.example` for the full list including optional variables.

> **`VITE_*` variables are build-time, not runtime.** `compose.yaml`
> passes `VITE_API_BASE` and `VITE_LIVEKIT_URL` as Docker build args
> for the `web` image (default `http://localhost:2567` /
> `ws://localhost:7880`). Changing them in `.env` after the image is
> built has no effect — the values are compiled into the static
> bundle. For a domain / reverse-proxy setup, set both to your public
> URLs (`VITE_API_BASE=https://api.example.com`,
> `VITE_LIVEKIT_URL=wss://livekit.example.com`) and rebuild the `web`
> image: `docker compose build web`. Reverse-proxy labels alone do not
> fix this — the bundle still points at `localhost` until it is
> rebuilt. See
> [`compose.override.traefik.yaml.example`](compose.override.traefik.yaml.example)
> for a worked reverse-proxy setup.

## Testing

Tests use [Vitest](https://vitest.dev/).

```bash
# Web (apps/web)
npm --workspace=@meetropolis/web run test

# Server (apps/server)
npm --workspace=@meetropolis/server run test
```

See [TEST_STRATEGY.md](TEST_STRATEGY.md) for the project's testing
philosophy, coverage expectations, and guidance on where to place new tests.

## Linting and code style

### ESLint + Prettier

```bash
npm run lint           # full lint pipeline
npm run lint:fix       # auto-fix where possible
npm run format         # Prettier write
npm run format:check   # Prettier check
```

### Lint regression gate

`lint-stats.json` records the current warning count baseline. The
`lint:stats` script fails if the warning count exceeds the baseline. Before
accepting an intentional suppression or a temporary warning increase, update
the baseline:

```bash
npm run lint:stats:update
```

Commit the updated `lint-stats.json` alongside your change.

### LoC budget enforcement

`scripts/enforce-budgets.js` enforces file-size limits defined in
[AGENTS.md](AGENTS.md):

- React/TS/server files: target <= 400 LoC, hard limit 600 LoC
- Phaser scene files: target <= 300 LoC, hard limit 450 LoC (with documented exceptions)
- Utility modules: target <= 300 LoC, hard limit 450 LoC

Files exceeding the hard limit block the lint step. Refactor before merging.
Files that are intentional exceptions (Phaser scene classes, composite
hooks) are listed in `.budgetignore` with a written reason.

### Type-boundary patterns

Third-party libraries, runtime globals and optional submodule boundaries
require special handling to stay compatible with strict TypeScript and the
`@typescript-eslint/no-unsafe-*` rules. The project's four-tier approach
(wrapper types, module augmentation, file-scoped overrides, inline disables
with written justification) is documented in
[LIBRARY_BOUNDARIES.md](LIBRARY_BOUNDARIES.md). Read it before adding any
`as any` or ESLint disable.

### Commit style

Commits follow [Conventional Commits](https://www.conventionalcommits.org/).
`commitlint` enforces this via a Husky `commit-msg` hook. A `pre-commit`
hook runs `lint-staged`.

## Tiamat-managed instance

The Tiamat-managed instance at [meetropolis.me](https://meetropolis.me) runs
additional closed-source modules (Brand, Enterprise, Desktop) which are not
part of this open-source distribution.

**OSS user limit:** 25 concurrent users across the whole server. This is a
compile-time constant in `packages/shared/src/tenancy.ts` and there is no
env-var override - raising the cap is part of what the commercial edition
sells. The server still runs above 25 (nothing crashes), but the 26th
joining user is kicked with `oss_limit_reached`.

## Self-hosting a branded instance

Before deploying for your team or customers:

1. Replace brand assets in `apps/web/public/brand/` (logo, favicon).
2. Provide your own legal pages (`/privacy`, `/terms`, `/impressum`). The
   default build renders neutral placeholders.
3. Update the HTML title and meta description in `apps/web/index.html`.
4. Review and adjust source strings that reference "Meetropolis" if you
   intend to publish a derivative product (see [TRADEMARKS.md](TRADEMARKS.md)).

## API tokens

Control your presence remotely via personal API tokens:

1. Open "API Tokens and Docs" from the top-right menu.
2. Create a token and pick its level: `read` (default, only safe methods such as GET, HEAD and OPTIONS) or `write` (may also change data). It is shown only once, save it. Tokens created before levels existed keep full access (`write`).
3. Use a `write` token to control mic, camera, screenshare and DND status, since this changes state:

```bash
curl -X POST "http://localhost:2567/controls" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"mic": false, "dnd": true}'
```

No token, not even `write`, can change a password or email address, delete an account, manage sessions or tokens (`/api-tokens`), or reach `/auth`, `/me`, `/users/me`, `/admin`, `/debug` or platform administration (pack upload, archive and delete, and map import under `/admin`); those need a signed-in browser session.

## Production deployment

The bundled `compose.yaml` covers the minimum self-host case (Postgres

- Server + Web + LiveKit, no reverse proxy). For real production add
  your own TLS terminator (Traefik, Caddy, nginx), backups for the
  `./data/postgres` bind mount, a proper TURN/TLS LiveKit config, and
  rotate the default secrets:

| Variable           | Requirement                              |
| ------------------ | ---------------------------------------- |
| `NODE_ENV`         | `production`                             |
| `JWT_SECRET`       | Cryptographically random, 32+ characters |
| `API_TOKEN_PEPPER` | Random string for API token hashing      |
| `CORS_ORIGIN`      | Explicit list of allowed origins         |
| `COOKIE_SECURE`    | `true`                                   |

`CORS_ORIGIN` holds exact origins (`scheme://host[:port]`) and nothing else:
no wildcard, no suffix rule, no path, and `null` is not an origin. The server
refuses to start when the list is missing or malformed, in every mode. The
same list decides for the HTTP API, for the matchmaking route and for the
websocket upgrade: an origin that is not listed gets `403` and no CORS
headers, and `Origin: null` is refused as well. A request without an `Origin`
header is not a browser request: it stays possible for native clients,
webhooks and health checks, gets no CORS headers, and is decided by the
route's own auth.

The official desktop app reports `tauri://localhost` on macOS/Linux and
`http://tauri.localhost` on Windows. Both must be listed explicitly, older
builds included. The same applies to the API origin of an operator who uses
the `/tools` pages: it is an ordinary origin now, there is no same-origin
exception any more. See [`docs/origin-allowlist.md`](docs/origin-allowlist.md).

`GET`/`HEAD` `/metrics` on the public app port always returns 404.
Prometheus scrapes `METRICS_PORT` (compose default 9100) on the
container network. `compose.yaml` does not publish that port and does
not put a proxy route in front of it. Direct runs bind loopback unless
`METRICS_HOST` is set. See [`docs/metrics.md`](docs/metrics.md).

Websocket upgrades are budgeted per client address: every upgrade
attempt is counted before the origin check, and an exhausted budget
answers `429` with a `Retry-After` header instead of a handshake.
`WS_UPGRADE_RATE_LIMIT_MAX` (default 120) sets the budget,
`WS_UPGRADE_RATE_LIMIT_WINDOW_MS` (default 60000) the window. The mobile
gateway joins from inside the server process and the npc-service runs in
its own container: both share the budget of their source address.

Every production start path (server entrypoint, migration service, and
the server process itself) enforces the credential policy below before
any migration, seed, or listen work. A violation stops the start and
reports only the offending key name, never a value. `TOOLS_PASSWORD`
stays optional: unset or empty keeps the tools route disabled and the
start valid.

| Variable             | Production rule                            |
| -------------------- | ------------------------------------------ |
| `LIVEKIT_API_KEY`    | Present, non-blank, not the template value |
| `LIVEKIT_API_SECRET` | Present, non-blank, not the template value |
| `DATABASE_URL`       | Valid Postgres URL, password neither blank |
|                      | nor the template value                     |
| `POSTGRES_PASSWORD`  | When set, non-blank and not the template   |
|                      | value                                      |
| `TOOLS_PASSWORD`     | When set, non-blank and not the template   |
|                      | value                                      |

The seed program additionally enforces `SEED_ADMIN_EMAIL` and
`SEED_ADMIN_PASSWORD` before it opens a database connection. It uses
the same production mode detection as the start path and does not
require LiveKit or tools credentials.

| Variable              | Production rule                          |
| --------------------- | ---------------------------------------- |
| `SEED_ADMIN_EMAIL`    | Present and non-blank; an explicit       |
|                       | historical default address is allowed    |
| `SEED_ADMIN_PASSWORD` | Present, non-blank, and not the template |
|                       | value                                    |

Development keeps the previous fallbacks. A violation exits with
status 1 and prints only the offending key name.

See [`docs/livekit-production.md`](docs/livekit-production.md) for the
LiveKit-specific hardening walkthrough (replacing `--dev`, rotating
keys, ICE / NAT setup, verification).

> **Known asymmetry: `package-lock.json` reflects the OSS-only install
> state.** Internally, Tiamat builds the same Dockerfile with the
> closed-source sibling repos mounted via `additional_contexts`, which
> can cause `npm install` to re-resolve some workspace edges. The
> lockfile committed here is the OSS-only ground truth — Tiamat
> regenerates a private lockfile on its build host. Self-hosters never
> see this; the OSS image build is deterministic against the committed
> lockfile.

## Production Mail Setup

The OSS server can send transactional email (invites, guest magic links,
verify links, welcome emails, password reset links) over plain SMTP via
[nodemailer](https://nodemailer.com/). Password reset is self-service:
`POST /auth/forgot` mails a reset link to the account's address and
answers `{ ok: true }` without returning the link or token.

### Provider precedence

The mail loader resolves a single active provider at server boot:

1. **EE-Resend** — when the optional `@meetropolis/tenancy` module is
   installed and both `RESEND_API_KEY` + `RESEND_FROM` are set.
2. **OSS-SMTP (nodemailer)** — when `SMTP_HOST` + `SMTP_FROM` are set.
3. **Console fallback** — last resort when no provider is configured. It
   delivers nothing and logs only a redacted marker without recipient,
   subject, link or token; `send()` returns `false`. A one-time log entry
   `email.fallback_console` fires at boot (error level in production,
   warning otherwise). The console fallback does not count as delivery,
   see [Running without a mail provider](#running-without-a-mail-provider).

### Running without a mail provider

Self-hosting needs a mail provider to admit new users. Without
`SMTP_HOST` and `SMTP_FROM` (and without the enterprise mail module) the
server cannot confirm or register new accounts, except through
[manual account confirmation](#manual-account-confirmation):

- `POST /auth/verify/request` answers `503 EMAIL_DELIVERY_UNAVAILABLE`.
- `POST /auth/register` with an invitation code answers
  `503 EMAIL_DELIVERY_UNAVAILABLE`.
- `POST /invites/accept` by an account whose email address is not yet
  confirmed answers `503 EMAIL_DELIVERY_UNAVAILABLE`.
- `POST /auth/forgot` answers `{ ok: true }` but issues and sends nothing.

No API response contains a confirmation token.

What still works without mail:

- Creating an invitation returns its link (`inviteUrl`) with
  `emailSent: false`. Copy and share the link; accounts whose email
  address is already confirmed can accept it.
- Creating a guest returns the guest's magic link for copying.
- A super admin can create a password reset link with
  `POST /admin/users/:id/reset-token`; the response contains the link.
  For tenant admins the same route answers
  `503 EMAIL_DELIVERY_UNAVAILABLE` without a mail provider.

#### Manual account confirmation

When no mail provider is configured (no `SMTP_HOST` with `SMTP_FROM` and
no enterprise mail module), setting `MANUAL_ACCOUNT_CONFIRMATION=true`
lets a super admin confirm new accounts by hand. The switch has no effect
while a delivering mail route exists: with SMTP or the enterprise mail
module configured, email proof always applies, even when sending fails.

With the switch active, registration with an invitation code and
acceptance of an invitation by an unconfirmed account create a pending
confirmation instead of answering `503 EMAIL_DELIVERY_UNAVAILABLE`. Until
confirmation the account has no access and no membership.

Only a super admin (an owner of the internal tenant) can confirm: in the
admin overlay or with `GET /admin/pending-confirmations` and
`POST /admin/users/:id/confirm-email`. A pending confirmation expires
after 7 days, or earlier when the invitation itself expires; afterwards
the person needs a new invitation. Check the identity and the address of
the person through another channel before confirming. Confirmation sets `emailVerifiedAt`, and the server logs record
the confirmation with the account identifiers of the admin and the person.

### Recommended providers

Pick whichever fits your compliance and budget needs. All four below
work over plain SMTP and require no EE module:

| Provider    | SMTP host                           | Notes                                                  |
| ----------- | ----------------------------------- | ------------------------------------------------------ |
| Amazon SES  | `email-smtp.<region>.amazonaws.com` | Cheapest at scale; needs AWS account + verified domain |
| Brevo       | `smtp-relay.brevo.com`              | EU-resident option, generous free tier                 |
| Mailgun     | `smtp.mailgun.org`                  | Mature, good deliverability dashboards                 |
| Postmark    | `smtp.postmarkapp.com`              | Transactional-only, strict on quality                  |
| Resend SMTP | `smtp.resend.com`                   | Works without the EE module, modern API                |

### Minimal `.env` for SMTP

```env
SMTP_HOST=email-smtp.eu-central-1.amazonaws.com
SMTP_PORT=587
SMTP_SECURE=auto
SMTP_USER=AKIA...
SMTP_PASS=BO...
SMTP_FROM="Meetropolis <noreply@example.com>"
# Optional:
SMTP_REPLY_TO=support@example.com
MAIL_BRAND_NAME=Meetropolis
MAIL_DEFAULT_LOCALE=de
MAIL_SUPPORT_EMAIL=support@example.com
```

### Local development with Mailpit

[Mailpit](https://github.com/axllent/mailpit) is a Docker-friendly
local SMTP server with a web UI on port 8025. It does not require TLS:

```yaml
# in compose.override.yaml (next to compose.yaml, gitignored)
services:
  mailpit:
    image: axllent/mailpit
    ports:
      - '1025:1025' # SMTP
      - '8025:8025' # Web UI
```

```env
SMTP_HOST=mailpit
SMTP_PORT=1025
SMTP_SECURE=false
SMTP_FROM="Meetropolis <dev@local>"
SMTP_TLS_REJECT_UNAUTHORIZED=false
```

### Deliverability: DKIM, SPF, DMARC

Setting `SMTP_HOST` is not enough — without DKIM/SPF alignment, mails
land in spam or get bounced outright. Configure all three records on
the domain you put after `@` in `SMTP_FROM`:

**SPF (TXT record on `example.com`)**

```dns
example.com.   IN   TXT   "v=spf1 include:amazonses.com -all"
```

Adjust the `include:` for your provider:

| Provider | SPF include               |
| -------- | ------------------------- |
| SES      | `include:amazonses.com`   |
| Brevo    | `include:spf.brevo.com`   |
| Mailgun  | `include:mailgun.org`     |
| Postmark | `include:spf.mtasv.net`   |
| Resend   | `include:_spf.resend.com` |

**DKIM (CNAME records on selectors provided by your sender)**

Your provider's dashboard shows the exact CNAME targets. Example for SES:

```dns
abc123._domainkey.example.com.   IN   CNAME   abc123.dkim.amazonses.com.
def456._domainkey.example.com.   IN   CNAME   def456.dkim.amazonses.com.
xyz789._domainkey.example.com.   IN   CNAME   xyz789.dkim.amazonses.com.
```

**DMARC (TXT record on `_dmarc.example.com`)**

Start in monitor mode, then ratchet up:

```dns
_dmarc.example.com.   IN   TXT   "v=DMARC1; p=none; rua=mailto:dmarc@example.com; pct=100"
```

After verifying via aggregate reports for ≥ 1 week, switch `p=none` to
`p=quarantine`, then eventually `p=reject`.

### TLS hardening

`SMTP_TLS_REJECT_UNAUTHORIZED` defaults to `true`. **NEVER** set it to
`false` in production, except for internal relays with known
self-signed certificates. The server emits a WARN
(`email.smtp.tls_validation_disabled`) when it sees that combination
in production.

## LiveKit TURN Setup (optional, recommended for corporate users)

The OSS `compose.yaml` starts LiveKit with `--dev --bind 0.0.0.0` and TURN
disabled. Users behind symmetric NAT, carrier-grade NAT or strict corporate
firewalls may need a TURN relay. The Docker Desktop overlay is a local smoke
test setup, not a production TURN deployment.

If your users sit behind such networks — typical for remote teams on
VPN, mobile hotspots or restricted office wifi — enable LiveKit's
built-in TURN server. **No separate `coturn` container is required**;
the LiveKit binary ships TURN as a library.

### Prerequisites

- A public FQDN you control (e.g. `turn.example.com`).
- A valid TLS certificate for that FQDN. Easiest path: terminate TLS at
  Traefik / Caddy / nginx in front of LiveKit so Let's Encrypt handles
  the renewal automatically.
- Host firewall rules for `7881/tcp`, `7882/udp`, `3478/udp` and the configured
  TURN UDP relay range (the production template uses `30000–40000/udp`).
- Public `443/tcp` for TURN/TLS, with a TLS-terminating TCP proxy forwarding to
  host port `5349`. LiveKit advertises TURN/TLS on `443`; `5349` is the local
  backend port when `external_tls: true`.

### Enable via `compose.override.yaml`

Drop a file next to `compose.yaml` (gitignored, auto-merged by Docker
Compose):

```yaml
services:
  livekit:
    command:
      - --config
      - /etc/livekit.yaml
    volumes:
      - ./livekit.yaml:/etc/livekit.yaml:ro
```

Copy `docs/livekit.yaml.example` to `livekit.yaml`, replace the key and
host-gateway placeholders, and enable TURN in that file:

```yaml
turn:
  enabled: true
  domain: turn.example.com
  bind_addresses: ['0.0.0.0']
  tls_port: 5349
  udp_port: 3478
  external_tls: true
  relay_range_start: 30000
  relay_range_end: 40000
```

Keep `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` in `.env` consistent with the
config. Do not add `ports:` or `networks:` to host-network LiveKit. Relay
sockets use the host directly; publishing thousands of ports through Docker
can make startup very slow. Restrict signalling to loopback plus the Docker
host gateway and allow container-to-host access through the firewall, as
shown in [the production guide](docs/livekit-production.md).

### Reverse-proxy snippet (Traefik example)

If you front LiveKit's TURN-TLS port with Traefik, add a TCP router
that terminates TLS for `HostSNI(turn.example.com)` on public `:443` and
forwards plain TCP to host `:5349`. Traefik itself needs
`extra_hosts: ["host.docker.internal:host-gateway"]` for host-network service
discovery. See `compose.override.traefik.yaml.example` and the production
guide for the signalling route and firewall rules. The backend also listens
for authenticated plain TURN/TCP on `5349`; restrict it to proxy containers.

### Replacing `--dev` with a real LiveKit config

`--dev` keeps an in-memory key store and relaxes a couple of defaults.
For a production instance, move keys into a `livekit.yaml` and swap
the command to `--config /etc/livekit.yaml`. The LiveKit docs cover
the full file layout; the OSS stack stays out of the way as long as
`LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` in `.env` match whatever the
config file declares.

### When NOT to bother

Small in-house teams that all share the same office wifi, or a single
remote group on broadband at home, will rarely hit a NAT scenario that
TURN solves. STUN-only (the OSS default) is enough. Only invest in
TURN once a real user reports audio/video that never connects.

## Out of scope (not implemented yet)

These items are deliberately not part of the OSS-SMTP stack and would
require dedicated blocks:

- Reply-To per tenant (currently a single global `SMTP_REPLY_TO`).
- List-Unsubscribe / one-click unsubscribe headers (transactional mail
  generally exempt under CAN-SPAM, but consult counsel for marketing).
- Bounce handling. nodemailer does not parse bounces. Configure your
  provider's dashboard (SES SNS, Brevo webhook) or run a local Postfix
  relay with bounce logs.
- Per-tenant rate-limiting for guest invites. `express-rate-limit` is
  installed but not wired up — track as a follow-up.

## Contributing

Read [AGENTS.md](AGENTS.md) before opening a PR. It covers architecture
rules, quality budgets, naming conventions, commit workflow and PR
expectations. Most of these are enforced by tooling (Husky, commitlint,
ESLint, budget scripts).

Also read:

- [CONTRIBUTING.md](CONTRIBUTING.md) - general contribution process
- [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)
- [SECURITY.md](SECURITY.md) - responsible disclosure and known advisories

## License

Meetropolis is dual-licensed:

- **Server components** (`apps/server`, `apps/npc-service`, `apps/loadtest`,
  and the repository root) are licensed under [AGPL-3.0-only](LICENSE).
- **The web client** (`apps/web`) and the **shared types package**
  (`packages/shared`) are licensed under [MIT](apps/web/LICENSE).

A commercial license that removes the AGPL-3.0 obligations is available
from Tiamat UG. Contact **mail@meetropolis.me** for details.

See [LICENSING.md](LICENSING.md) for the rationale, per-component
breakdown, and our promises around license stability. See [NOTICE](NOTICE)
for third-party attributions.

The "Meetropolis" name and logo are trademarks of Tiamat UG and are not
granted by either license. See [TRADEMARKS.md](TRADEMARKS.md).
