# Meetropolis — Licensing Model

This document explains the dual-license model of the Meetropolis open source
project. It is meant to be useful for self-hosters, contributors, and anyone
considering Meetropolis for commercial integration.

If you only need a one-line summary:

> The Meetropolis server is **AGPL-3.0-only**. The Meetropolis web client
> (`apps/web`) and the shared types package (`packages/shared`) are **MIT**.
> Commercial licensing of the server component is available from Tiamat UG.

## Why a dual license?

Meetropolis is built on the open core model. The server is the heart of the
product — its source must remain available for everyone who modifies and runs
it on a network. The client is a thin presentation layer that runs in end
users' browsers; subjecting browsers to a network-distribution clause would
be both technically nonsensical and harmful to adoption.

This split follows the model successfully used by [Plausible
Analytics](https://plausible.io/) and others: a copyleft license on the
server, a permissive license on the client/tracker that gets shipped into
third-party contexts.

## Per-component breakdown

| Path                                          | License       | Why                                                                                                                                                           |
| --------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Root (`/LICENSE`)                             | AGPL-3.0-only | Default for everything in the repo that is not explicitly relicensed below                                                                                    |
| `apps/server`                                 | AGPL-3.0-only | Network server. Anyone modifying and hosting must publish their changes.                                                                                      |
| `apps/npc-service`                            | AGPL-3.0-only | Network service. Same trigger as the server.                                                                                                                  |
| `apps/loadtest`                               | AGPL-3.0-only | Operational tooling, server-adjacent.                                                                                                                         |
| `apps/web` (`apps/web/LICENSE`)               | MIT           | Browser client. Runs on end-user machines; we do not want to impose AGPL-like obligations on operators of unrelated web properties that may embed components. |
| `packages/shared` (`packages/shared/LICENSE`) | MIT           | Types and small utilities consumed by both the AGPL server and the MIT client. Must be permissive to avoid infecting the client.                              |

The optional private submodules under `packages/brand`, `packages/desktop`,
and `packages/tenancy-enterprise` are not part of this OSS distribution and
carry their own commercial licenses; see those repositories for details.

Third-party dependencies are listed and attributed in [`NOTICE`](NOTICE).

## What AGPL-3.0-only means for self-hosters

If you run an unmodified copy of Meetropolis for your team, you have no
publication obligation. AGPL-3.0 imposes obligations only when you both
**modify** the server code **and** make the modified version available to
others over a network.

If you modify the server (custom routes, new integrations, patched behavior),
AGPL-3.0 section 13 requires you to offer the corresponding source code to
your users — for example, via a link in your application's footer or admin
panel. The classic way to satisfy this is publishing your fork on a public
git host.

If you do not want to publish your modifications, a commercial license is
available (see below).

## What MIT means for the client and shared package

You can fork, modify, embed, and redistribute `apps/web` and
`packages/shared` under MIT terms. You must keep the copyright notice in
distributions, but you have no obligation to publish your changes.

This is intentional: the web client is the natural place for downstream
customization (theming, widgets, embedded views) and we do not want to
discourage that.

## Commercial license

A commercial license for the AGPL-licensed components is available from
Tiamat UG. It removes the AGPL-3.0 obligations (including the
network-distribution clause and the inbound source-availability requirement)
in exchange for a fee. Typical buyers:

- Companies that want to integrate Meetropolis into a closed-source product
- Resellers building managed Meetropolis offerings on top of the OSS code
- Enterprises whose internal policies prohibit using AGPL-licensed software

Contact: **mail@meetropolis.me** (subject: `Commercial License`).

## OSS edition concurrency cap

The OSS edition is hard-capped at **25 concurrent users** across the entire
server. The cap is enforced inside `apps/server/src/rooms/lifecycle/onJoin.limiter.ts`:
the 26th joining user is rejected with `oss_limit_reached` until somebody
leaves. Existing sessions are never dropped.

The cap is a compile-time constant in
[`packages/shared/src/tenancy.ts`](packages/shared/src/tenancy.ts) and is
intentionally **not** configurable via env, config file or admin API. The
only sanctioned way to run past 25 concurrent users is to install the
proprietary tenancy module, which exposes a `bypassOssLimit()` hook and
is part of the commercial edition.

We are not naive: anyone who reads the code can fork it, patch the constant
to a higher number, and run their fork. AGPL-3.0 permits exactly that, and
section 13 then requires them to share their fork with their users. The cap
exists so the commercial boundary is visible in the source instead of hidden
behind a license-server phone-home, and so that operators who genuinely run
past it have made an informed, traceable choice rather than flipping an env
var.

## Our promises (read these — they are the point of dual licensing)

1. **License never changes for existing users.** Code that has been released
   under AGPL-3.0-only or MIT will remain under that license for the version
   it was released in. Future versions may be released under different terms,
   but existing tags stay as they are. We will not pull a Cal.com 2026.
2. **Security fixes always land in OSS.** Patches for security issues are
   committed to the public AGPL/MIT repository and made available to all
   users at the same time as paying customers. We do not embargo fixes for
   the commercial edition.
3. **One codebase.** The commercial edition is the OSS codebase plus a
   license file. We do not maintain a forked "premium" tree with hidden
   features in the AGPL components. Functional differences between editions
   live in the optional private submodules and are loaded at runtime.

## Contributor inbound license

Contributions to this repository are licensed under the same license as the
file or directory you are contributing to. To support the commercial license
above, contributors additionally grant Tiamat UG the right to relicense their
contributions commercially. See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the
exact wording and the Developer Certificate of Origin sign-off requirement.

## Trademarks

The "Meetropolis" name and any associated logos are trademarks of Tiamat UG
and are **not** covered by AGPL-3.0 or MIT. Permitted and prohibited uses are
documented in [`TRADEMARKS.md`](TRADEMARKS.md).

## Questions

For licensing questions that this document does not answer, write to
**mail@meetropolis.me**.
