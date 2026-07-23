<p align="center">
  <img src="docs/assets/banner.png" alt="Meetropolis — the office that stays. Self-hosted virtual office with spatial audio, video and a 2D world for remote teams." width="100%">
</p>

# Meetropolis

An open-source virtual office platform for remote teams. Proximity-based
spatial audio/video, a live 2D world built on Phaser, and a real-time
multi-user engine powered by Colyseus.

[![CI](https://github.com/lass-machen/meetropolis/actions/workflows/ci.yml/badge.svg)](https://github.com/lass-machen/meetropolis/actions/workflows/ci.yml)
![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)
![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)
![Node](https://img.shields.io/badge/Node-24-green.svg)
![TypeScript](https://img.shields.io/badge/TypeScript-6.x-blue.svg)

## Quick Start

### Self-host (production-style)

```bash
git clone https://github.com/lass-machen/meetropolis.git
cd meetropolis
cp .env.example .env          # edit with your values
mkdir -p data/postgres data/packs
sudo chown -R 999:999 data/postgres   # Postgres in the container is UID 999; not needed on macOS/Windows with Docker Desktop

# JWT_SECRET and API_TOKEN_PEPPER ship EMPTY in .env.example — generate
# both and set them in .env before the first `docker compose up`:
echo "JWT_SECRET=$(openssl rand -hex 32)"
echo "API_TOKEN_PEPPER=$(openssl rand -hex 16)"

docker compose up -d          # builds OSS images; starts db, server, web, livekit
```

After startup:

| Service                  | URL                   |
| ------------------------ | --------------------- |
| Web app                  | http://localhost:5173 |
| Server (Colyseus + REST) | http://localhost:2567 |
| LiveKit signal           | http://localhost:7880 |

Required env values: `JWT_SECRET`, `API_TOKEN_PEPPER`. Both are empty
in `.env.example` on purpose — `compose.yaml` refuses to start
(`:?required`) until you set them, so generate and fill them in
**before** the first `docker compose up`, not after a failed start.

`compose.yaml` ships no reverse proxy and no TLS terminator — you are
expected to put your own (Traefik, Caddy, nginx, etc.) in front of the
server and web containers for production. See `## Production deployment`
below for the minimum env surface.

### Local development overrides

The shipped `compose.yaml` is the production-style self-host stack. For
hot-reload, bind-mounted source or extra services (Prometheus, Grafana,
load-test harness, NPC automation), add an uncommitted
`compose.override.yaml` next to it; Docker Compose picks the override up
automatically on `up`. The OSS repo intentionally ships only the single
production-style compose file — extra dev tooling lives in your own
override or in the (private) deploy repo.

### Local development without Docker

Requires a running PostgreSQL instance. Configure `DATABASE_URL` in `.env`.

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

## Requirements

| Requirement             | Version                                                  |
| ----------------------- | -------------------------------------------------------- |
| Node.js                 | `>=24.0.0 <25` (enforced by `engines` in `package.json`) |
| npm                     | `11.7.0` (pinned via `packageManager`)                   |
| Docker + Docker Compose | optional, for the full-stack local setup                 |
| PostgreSQL 16           | required for local dev without Docker                    |

> **macOS / Windows + Docker Desktop note:** Chrome filters loopback ICE
> candidates. For the self-host stack (`compose.yaml`) set `LK_NODE_IP`
> and / or `LK_NAT_1_TO_1_IPS` to your public IP (or LAN IP for local
> testing) and restart LiveKit:
> `docker compose restart livekit`.

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

| Variable             | Description                                           |
| -------------------- | ----------------------------------------------------- |
| `DATABASE_URL`       | PostgreSQL connection string                          |
| `JWT_SECRET`         | JWT signing secret (32+ chars in production)          |
| `LIVEKIT_URL`        | LiveKit server URL                                    |
| `LIVEKIT_API_KEY`    | LiveKit API key                                       |
| `LIVEKIT_API_SECRET` | LiveKit API secret                                    |
| `HOST_IP`            | Host LAN IP for LiveKit ICE (Docker Desktop on macOS) |
| `CORS_ORIGIN`        | Allowed CORS origins (required in production)         |
| `VITE_API_BASE`      | Server URL baked into the web bundle at _build_ time  |
| `VITE_LIVEKIT_URL`   | LiveKit URL baked into the web bundle at _build_ time |

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
4. Configure your own analytics tracking (`VITE_META_PIXEL_ID`) or leave it
   disabled.
5. Review and adjust source strings that reference "Meetropolis" if you
   intend to publish a derivative product (see [TRADEMARKS.md](TRADEMARKS.md)).

## API tokens

Control your presence remotely via personal API tokens:

1. Open "API Tokens and Docs" from the top-right menu.
2. Create a token. It is shown only once, save it.
3. Use it to control mic, camera, screenshare and DND status:

```bash
curl -X POST "http://localhost:2567/controls" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"mic": false, "dnd": true}'
```

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
verify links, welcome emails) over plain SMTP via
[nodemailer](https://nodemailer.com/). Sensitive tokens (password reset)
are NEVER sent by email — the admin generates them via the admin UI.

### Provider precedence

The mail loader resolves a single active provider at server boot:

1. **EE-Resend** — when the optional `@meetropolis/tenancy` module is
   installed and both `RESEND_API_KEY` + `RESEND_FROM` are set.
2. **OSS-SMTP (nodemailer)** — when `SMTP_HOST` + `SMTP_FROM` are set.
3. **Console fallback** — last-resort, logs subject + recipient domain
   only (no body in production), returns `false` from `send()` so
   verify-requests keep surfacing tokens via the API response. A
   one-time WARN log fires at boot: `email.fallback_console`.

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

The OSS `compose.yaml` starts LiveKit with `--dev --bind 0.0.0.0` and
no TURN flags. WebRTC then negotiates connections via STUN only, which
covers ~80–90 % of home-internet setups. The remaining 10–20 %
(symmetric NAT, carrier-grade NAT, strict corporate firewalls that
block UDP) cannot establish audio/video without a TURN relay.

If your users sit behind such networks — typical for remote teams on
VPN, mobile hotspots or restricted office wifi — enable LiveKit's
built-in TURN server. **No separate `coturn` container is required**;
the LiveKit binary ships TURN as a library.

### Prerequisites

- A public FQDN you control (e.g. `turn.example.com`).
- A valid TLS certificate for that FQDN. Easiest path: terminate TLS at
  Traefik / Caddy / nginx in front of LiveKit so Let's Encrypt handles
  the renewal automatically.
- Open ports on the host:
  - `5349/tcp` (TURN over TLS)
  - `3478/tcp` and `3478/udp` (TURN/STUN)
  - `7882/udp` (LiveKit RTC UDP, already exposed by the OSS compose)

### Enable via `compose.override.yaml`

Drop a file next to `compose.yaml` (gitignored, auto-merged by Docker
Compose):

```yaml
services:
  livekit:
    command:
      - --dev
      - --bind
      - 0.0.0.0
      - --turn.enabled=true
      - --turn.domain=${TURN_HOST}
      - --turn.tls_port=5349
      - --turn.external_tls=true
    ports:
      # Add the TURN ports on top of the OSS defaults.
      - '5349:5349/tcp'
      - '3478:3478/tcp'
      - '3478:3478/udp'
```

Then set `TURN_HOST` in your `.env`:

```env
TURN_HOST=turn.example.com
```

### Reverse-proxy snippet (Traefik example)

If you front LiveKit's TURN-TLS port with Traefik, add a TCP router
that forwards `HostSNI(TURN_HOST):5349` to the `livekit` container.
Caddy / nginx work analogously with TLS passthrough on port 5349.

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

## Out of scope (not implemented in Block C)

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
- Self-service password reset via email. Block C is invite/verify/guest
  only; password reset remains admin-triggered with token-in-UI.

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
