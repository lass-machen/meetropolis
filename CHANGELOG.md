# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- **Breaking (enterprise integration):** The tenant deletion callback in
  `adminLoader` now requires `deletionProtocol: 'tenant-delete-v2'` with a
  managed prepare/cleanup pair and an explicit internal retention plan and
  deadline. Upgrade the host and enterprise module together; mismatched
  versions reject deletion before any database DELETE statement with
  `tenant_deletion_contract_required`. Without a valid internal plan the
  deletion is rejected with `retention_journal_unavailable` (HTTP 409).
- **Breaking (self-hosting):** NPC media now resolve from one directory. Without `NPC_MEDIA_DIR` the server uses `/data/npc-media`, the same default as the npc service; before, uploads defaulted to `<server working directory>/../../npc-media` and static serving to a directory next to the build output. If you did not set `NPC_MEDIA_DIR`, set it to your existing media directory or move its contents to `/data/npc-media`. When the directory cannot be created, the server logs `npc_media.dir_unavailable` at startup.
- **Breaking (self-hosting):** Node.js 24.15 or newer below 25 is now required (`engines.node`). `npm ci --engine-strict` refuses older Node versions; `.nvmrc` stays `24` and resolves to the latest 24.x.
- **Breaking (self-hosting):** invitation, guest, email-verification, password-reset and welcome links are built only from `PUBLIC_BASE_URL`. The fallbacks to relative links, `BILLING_PUBLIC_URL` and the request origin or host are gone, and loopback bases need `PUBLIC_BASE_URL_ALLOW_LOOPBACK=true`. A missing or unusable value is logged at startup, and link requests fail with `public_base_url_missing`. The web client copies invitation links from the server instead of building them from the window origin.
- **Breaking (self-hosting):** Without a mail provider (`SMTP_HOST` and `SMTP_FROM` unset, no enterprise mail module), the console fallback does not count as delivery: verification requests, acceptance of an invitation by an unverified account and registration with an invitation code answer `503 EMAIL_DELIVERY_UNAVAILABLE`, and `POST /auth/forgot` answers `ok` without sending anything. A configured provider that fails to deliver a verification email also answers `503 EMAIL_DELIVERY_UNAVAILABLE`. No confirmation token is returned by any verification response; a password reset without mail works only through a super admin's `POST /admin/users/:id/reset-token`, which returns the link. Invitations still return their link for copying with `emailSent: false`, and creating a guest returns its magic link. Configure `SMTP_HOST` and `SMTP_FROM` before inviting users.
- **Breaking (API):** invitation routes no longer carry the invitation code in the URL path, so request, rate-limit and error logs never contain a still-valid code. Revoking and resending address the invitation by its id (`DELETE /invites/:id`, `POST /invites/:id/resend`), the public preview and the acceptance by an existing account take the code in the JSON body (`POST /public/invites/preview`, `POST /invites/accept`), and `GET /invites` returns `id` and `url` instead of `code`. Listing, revoking and resending are limited to tenant admins and owners. Clients that still call `DELETE /invites/<code>`, such as older desktop builds that bundle the previous web client, receive `404 not found`, and the invitation link those builds copy ends in `?invite=undefined`; they need the updated client. Invitations now expire after 7 days; open invitations created before the upgrade get 7 days from the migration. `POST /auth/register` with an invitation code is bound to the invited address and answers `400 invite_unavailable`, `400 invite_expired` or `403 invite_email_mismatch` instead of the previous messages. Invitations without an email address can no longer be redeemed (403 `invite_email_mismatch`) and have to be issued again.
- Web client: a terminal connection error (guest expiry, session
  takeover, rejected authentication, outdated client, billing and limit
  errors, and with the transcription module a missing consent) now leaves
  LiveKit before the overlay appears. Before, the client kept publishing
  and subscribing behind the overlay. AV resumes with the next join the
  world accepts.
- Server: a world room now refuses a session of another tenant by default
  (close code 4401, `tenant_mismatch`). Before, this needed
  `ZONE_PRIVACY_TENANT_ENFORCE=true`; now only an explicit `false` admits
  such a join, with a warning.
- Web client: disposing the AV manager (unmount, or the reset of a join
  that failed after its room was set up) now leaves LiveKit before the
  teardown, which therefore runs up to 5 s later. A leave that exceeds
  this bound is cut short by disconnecting the room directly.
- Server logging: Error arguments are logged under `err` in pino's
  standard format (`type`, `message` and `stack` with causes, plus the
  error's enumerable fields) instead of being spread into the record,
  which lost message and stack. Fields the spread put at the top level,
  such as Prisma's `code`, `meta` and `clientVersion`, now sit under
  `err`; log queries on them need adjusting.
- Web client: confirmations (revoking a session or all other sessions,
  deleting an invite, removing a member, deleting an asset pack) use an
  in-app dialog instead of `window.confirm`, which the desktop app does
  not support. Removing a member no longer asks twice, and logging out all
  other devices reports its result inline instead of with `alert()`. ESLint
  now rejects native `confirm`, `alert` and `prompt` in `apps/web`.
- World server: joining the world always requires a valid session, also
  with `ZONE_PRIVACY_AUTH_ENFORCE` unset. A join without a session token
  (desktop builds that predate the join token) is refused with 4401
  `unauthorized`; the identity the client names is no longer accepted in
  its place. `ZONE_PRIVACY_AUTH_ENFORCE` now only gates the client
  zone-privacy version check.
- World server: a join whose verified tenant has no resolvable slug is
  refused with 4401 `tenant_unresolved` instead of falling back to the
  tenant slug the client sent.
- Server: access revocations use one presence channel, `access_revoked`
  with `{ userId, origin }`, instead of one `access_revoked:<slug>`
  channel per tenant, and each world room checks the user's sessions
  against the tenant each session was verified for.
  `broadcastAccessRevoked(userId)` no longer takes a tenant slug,
  `accessRevokedChannel` and `disconnectPlayers` are removed, and
  `revokeAccountAccess(userId, tenantSlugs)` is new.
- World server: `WorldRoom.onCreate` is async and waits for the
  revocation subscription; when subscribing fails, the room is not
  created.
- World server: open world sessions hold an access lease. The periodic
  access check runs every 30 s (was 60 s) and renews it. A session that
  cannot be re-verified ends after at most 120 s with the new code 4503
  `access_unverified`, which the web client treats as a reconnect; native
  clients should do the same. A guest ends exactly at its stored expiry.
  `WORLD_ACCESS_SWEEP_MS` (default 30000) and `WORLD_ACCESS_LEASE_MS`
  (default 120000, at least twice the sweep) tune both intervals.
- World server: a world session ends once its database session is gone
  (logout, password reset, revoked sessions, or removal from another
  tenant, which signs the user out everywhere), with 4401
  `session_revoked`: at once on a revocation, otherwise at the next
  access check.
- Server: HTTP log fields and metric labels now use route templates
  instead of concrete request paths. Early `http.request` logs no longer
  include a `path` field; unmatched requests use `<unmatched>`. This
  changes values consumed by dashboards and log parsers.

### Fixed

- Web client: the personal API tokens overlay is reachable. The user menu
  has an "API tokens" entry for every signed-in member except guests;
  before, the overlay existed but nothing opened it. The overlay also now
  loads its list through one request and reports a failed load, create or
  delete instead of crashing or failing silently, asks for an inline second
  click before deleting a token, ignores double clicks, forgets the secret
  and the list when closed (and drops responses that arrive after that), and
  states that a token does not expire and carries all permissions of the
  account. Its helper text no longer claims that tokens act on other
  participants; `POST /controls` only reaches your own sessions.

## [0.1.0]

### Initial open-source release of Meetropolis

Meetropolis is an open-source virtual office platform for remote teams.
It combines proximity-based spatial audio and video with a live 2D world
built on Phaser and a real-time multi-user engine powered by Colyseus.

#### Added

- Self-hostable server (Express + Colyseus + Prisma) under AGPL-3.0-only
- Browser client (React + Vite + Phaser) under MIT
- Shared types and utilities package (`@meetropolis/shared`) under MIT
- Procedural character sprite generator (`tools/sprite-generator/`) and
  six built-in office characters
- Default office map built from MIT-licensed
  [pixel-agents](https://github.com/pablodelucca/pixel-agents) tiles
  via `tools/map-builder/`
- LiveKit-based spatial audio with zone-aware proximity falloff
- Single-tenant deployment via `docker compose`
- Optional dynamic-import boundaries (`*Loader.ts`) for closed-source
  enterprise modules; OSS build resolves them to `null` and degrades
  gracefully

#### Edition boundary

The OSS edition is capped at **25 concurrent users** across the entire
server. The cap is enforced in code (`packages/shared/src/tenancy.ts`,
`apps/server/src/rooms/lifecycle/onJoin.limiter.ts`) and is intentionally
not configurable via environment variable. Raising the cap requires the
commercial edition; see [`LICENSING.md`](LICENSING.md).

#### Licensing

- Server, NPC service, load-test harness, repository root:
  **AGPL-3.0-only**
- Browser client (`apps/web`) and shared package (`packages/shared`):
  **MIT**
- A commercial license is available from Tiamat UG for organisations
  that cannot meet the AGPL-3.0 source-availability obligations. See
  [`LICENSING.md`](LICENSING.md).
- Contributor inbound license: contributions are accepted under the same
  license as the file they touch, plus a grant to Tiamat UG to relicense
  contributions commercially. See [`CONTRIBUTING.md`](CONTRIBUTING.md).

[Unreleased]: https://github.com/lass-machen/meetropolis/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/lass-machen/meetropolis/releases/tag/v0.1.0
