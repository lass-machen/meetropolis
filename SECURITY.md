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

`npm audit` reports the following advisories that we have evaluated and
accepted as low-impact for production deployments:

### `elliptic` (6 low-severity advisories)

- Advisory: [GHSA-848j-6mx2-7j84](https://github.com/advisories/GHSA-848j-6mx2-7j84)
- Dependency chain: `@colyseus/playground` -> `@colyseus/auth` -> `grant`
  -> `jwk-to-pem` -> `elliptic`.
- Affected surface: the Colyseus Playground is a development-only debug UI
  that is not enabled in production builds. The production Colyseus server
  uses the core `colyseus` runtime, which does not load the playground or
  its auth helpers.
- No upstream fix is currently available; the advisory applies to all
  published versions of `elliptic`. `npm audit fix --force` would downgrade
  `colyseus` to 0.15.13, which is a breaking regression and is not safe to
  apply.
- Action: monitor for a non-vulnerable `elliptic` release or for
  `@colyseus/playground` to drop the `grant`/`jwk-to-pem` dependency.

### Already remediated

- `@hono/node-server` middleware bypass
  ([GHSA-92pp-h63x-v22m](https://github.com/advisories/GHSA-92pp-h63x-v22m))
  was pinned to `>= 1.19.14` via a nested `overrides` entry in the root
  `package.json` to force the patched version through the transitive
  `prisma -> @prisma/dev` chain.
