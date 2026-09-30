# Security Policy

## Supported Versions

We release patches for security vulnerabilities in the following versions:

| Version | Supported          |
| ------- | ------------------ |
| 0.x.x   | :white_check_mark: |

## Reporting a Vulnerability

We take security issues seriously. We appreciate your efforts to responsibly
disclose your findings and will make every effort to acknowledge your
contributions.

### How to Report

Please report security vulnerabilities by emailing **mail@meetropolis.me**.

**Please do NOT:**

- Open a public GitHub issue for security vulnerabilities
- Disclose the vulnerability publicly before we have addressed it

### What to Include

To help us triage and prioritize, please include:

- Type of issue (e.g., buffer overflow, SQL injection, cross-site scripting)
- Full paths of source file(s) related to the issue
- Location of the affected source code (tag/branch/commit or direct URL)
- Step-by-step instructions to reproduce the issue
- Proof-of-concept or exploit code (if possible)
- Impact of the issue, including how an attacker might exploit it

### Response Timeline

- **Initial Response**: Within 48 hours, we will acknowledge receipt of your report
- **Status Update**: Within 7 days, we will provide an initial assessment
- **Resolution**: We aim to resolve critical issues within 30 days

### Safe Harbor

We consider security research conducted in accordance with this policy to be:

- Authorized concerning any applicable anti-hacking laws
- Authorized concerning any relevant anti-circumvention laws
- Exempt from restrictions in our Terms of Service that would interfere with
  conducting security research

We will not pursue civil action or initiate a complaint to law enforcement for
accidental, good-faith violations of this policy.

### Recognition

We believe in recognizing the work of security researchers who help us keep our
users safe. With your permission, we will publicly acknowledge your contribution
in our release notes.

## Security Best Practices for Contributors

When contributing to this project, please:

1. **Never commit secrets**: Use environment variables for sensitive data
2. **Validate all inputs**: Especially on public-facing endpoints
3. **Use parameterized queries**: Prevent SQL injection via Prisma
4. **Keep dependencies updated**: Run `npm audit` regularly
5. **Follow least privilege**: Request only necessary permissions

## Known Security Considerations

### Authentication

- JWT tokens are used for session management
- Passwords are hashed using bcrypt with appropriate cost factor
- API tokens are hashed before storage
- The Colyseus `world` room binds every non-NPC join to the identity
  carried by a server-verified JWT (`onAuth`, see
  `apps/server/src/rooms/lifecycle/onAuth.ts`), never to a client-supplied
  `identity` join option. This is the identity the H4 audio-zone privacy
  allow-lists are keyed on; guest and invite logins issue the same JWT
  shape and are covered by the same check. NPC identities authenticate via
  a separate shared secret (`NPC_SERVICE_SECRET`), not a per-user JWT.
- Joins additionally carry a client `zonePrivacyVersion`. The server
  rejects a `world` join, and separately downgrades a `/livekit/token`
  request to `canPublish: false`, when that version is missing or below
  the server's minimum (see `packages/shared/src/zonePrivacy.ts`). This is
  an honesty-based gate: it closes the vector of an outdated _official_
  client that never applied the H4 deny-all zone-privacy boundary on its
  own LiveKit tracks — it does **not** close the vector of a maliciously
  forked client with valid tenant credentials that reports a high version
  while never actually applying that boundary. Closing that fully would
  require one LiveKit room per audio zone with zone-scoped tokens, which
  is an architecture change, not something the current single-room-per-
  tenant model can enforce server-side. See
  `apps/server/src/rooms/audioZones/reconciler.ts`'s module doc for the
  related fail-open semantics of the server-side subscriber correction
  loop.

### Data Protection

- Database connections use TLS in production
- CORS is configured to allow only trusted origins
- Sensitive data is not logged

### Infrastructure

- Docker containers run as non-root users where possible
- Traefik handles TLS termination with Let's Encrypt
- Rate limiting should be enabled in production

## Known Dependency Advisories

`npm audit` reports four entries (`prisma`, `@prisma/config`, `deepmerge-ts`,
`mysql2`) that we have evaluated and accepted as low-impact for production
deployments. All of them come in through the `prisma` CLI, which the running
server does not use for database access:

### `mysql2` (2 advisories)

- Advisories: [GHSA-3f6p-5ww8-9rcr](https://github.com/advisories/GHSA-3f6p-5ww8-9rcr)
  (auth plugin downgrade leaks plaintext credentials, fixed in 3.22.0) and
  [GHSA-rgwj-5xj2-c3m3](https://github.com/advisories/GHSA-rgwj-5xj2-c3m3)
  (unbounded zlib inflate in the compressed protocol handler, fixed in 3.23.1).
- Dependency chain: `prisma` -> `mysql2`, pinned to 3.15.3 exactly by the
  `prisma` CLI.
- Affected surface: the MySQL driver is never loaded. The datasource is
  `postgresql` and the app connects via `@prisma/adapter-pg`. `prisma` is an
  optional peer of `@prisma/client`, so `npm prune --omit=dev` keeps it (and
  `mysql2`) in the runtime image, but the code path stays unreachable.
- No override: it would overrule an upstream exact pin without removing real
  exposure.
- Action: remove the Dependabot ignore for `mysql2` once `prisma` ships a
  patched release.

### `deepmerge-ts` (1 advisory, via `@prisma/config`)

- Advisory: [GHSA-ggr8-5vv4-36mx](https://github.com/advisories/GHSA-ggr8-5vv4-36mx)
  (stack exhaustion on self-referencing object graphs, fixed in 8.0.0).
- Dependency chain: `prisma` -> `@prisma/config` -> `deepmerge-ts`, pinned to
  7.1.5 exactly. It is only the `c12` merger for local configuration
  (`prisma.config.ts` and its defaults).
- Affected surface: like `mysql2` it ships in the runtime image with the
  `prisma` CLI and is not reachable with external input.
- Action: remove the Dependabot ignore for `deepmerge-ts` once
  `@prisma/config` moves to `deepmerge-ts` 8.

### Already remediated

- The `elliptic` advisory
  ([GHSA-848j-6mx2-7j84](https://github.com/advisories/GHSA-848j-6mx2-7j84))
  and the `grant`, `request-oauth` and `uuid` findings behind it came in
  through the `colyseus` meta package (`@colyseus/playground` and
  `@colyseus/auth`). The server now imports `@colyseus/core` and
  `@colyseus/ws-transport` directly, so none of these packages is installed.

- `@hono/node-server` middleware bypass
  ([GHSA-92pp-h63x-v22m](https://github.com/advisories/GHSA-92pp-h63x-v22m))
  was pinned to `>= 1.19.14` via a nested `overrides` entry in the root
  `package.json` to force the patched version through the transitive
  `prisma -> @prisma/dev` chain.
