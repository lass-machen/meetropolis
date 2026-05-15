# Meetropolis Governance

Meetropolis is an open-source project sponsored and led by **Tiamat UG
(haftungsbeschränkt)**. This document explains who makes decisions, how
contributors can become maintainers, and how disagreements get resolved.

It is intentionally short. Governance documents tend to ossify; we would
rather update this file when reality demands it than write a
constitution-length document up front.

## Stewardship

Tiamat UG is the steward of the Meetropolis trademark and the holder of the
commercial license offered under [LICENSING.md](LICENSING.md). The
open-source code itself is owned by its individual contributors under their
respective AGPL-3.0 / MIT terms.

Stewardship means Tiamat is ultimately accountable for:

- Maintaining the public infrastructure (GitHub organization, npm scope,
  Docker registry namespace, the meetropolis.de domain).
- Coordinating releases and security advisories.
- Defending the trademark and enforcing the commercial license.
- Ensuring contributor guidelines, the code of conduct, and the licensing
  model stay coherent.

Stewardship does **not** mean Tiamat unilaterally decides every PR or every
feature. Day-to-day technical decisions are delegated to maintainers (see
below).

## Roles

### Contributor

Anyone who opens an issue or pull request. No nomination needed; just file
something useful. Contributors are bound by the [Code of
Conduct](CODE_OF_CONDUCT.md) and the contributor inbound license grant
described in [CONTRIBUTING.md](CONTRIBUTING.md).

### Triager

A trusted community member with `triage` permission on the GitHub
repository. Triagers can:

- Label and reassign issues.
- Close obvious duplicates and off-topic reports.
- Mark good-first-issues.

Triagers cannot merge PRs. The path from active contributor to triager is
informal: keep showing up, demonstrate sound judgement on existing issues,
and an existing maintainer will nominate you.

### Maintainer

A contributor with `write` permission on the repository. Maintainers can:

- Review and merge pull requests.
- Cut releases (in coordination with Tiamat).
- Land breaking changes after a documented heads-up period.
- Add new maintainers (see below).

Maintainers are listed in [`.github/CODEOWNERS`](.github/CODEOWNERS) and
in the GitHub team `@tiamatlabs/maintainers`.

### Lead maintainer

A specific maintainer who acts as the technical tie-breaker when consensus
cannot be reached. Currently Tiamat UG (represented by **Ansgar
Holtmann**). The lead-maintainer role is held by Tiamat for as long as
Tiamat funds the project; it is not transferred per-PR.

## Initial maintainers (2026)

This list will grow over time. Add yourself via a PR after a maintainer
nominates you.

| Name            | GitHub | Affiliation | Area                        |
| --------------- | ------ | ----------- | --------------------------- |
| Ansgar Holtmann | `@TBD` | Tiamat UG   | Lead maintainer — all areas |

(Placeholder rows for future maintainers go here.)

## How decisions are made

Most decisions follow **lazy consensus**: a maintainer proposes a change,
posts it as a PR or Discussion, and merges or executes after no objection
for a reasonable time (typically 48–72 hours for non-trivial PRs; same-day
for tooling/dependency bumps).

Disagreements escalate in this order:

1. **PR review.** The disagreeing reviewer leaves a `requested changes`
   review with their reasoning. The author addresses, defers, or rebuts.
2. **Discussion.** If a single PR conversation cannot resolve it, the
   topic moves to a GitHub Discussion so more people can weigh in.
3. **Lead-maintainer call.** If consensus still does not form, the lead
   maintainer makes a decision and documents the reasoning in the
   originating PR or Discussion.

The lead-maintainer call is binding but appealable in a follow-up — the
project is a living thing, not a courtroom.

## Adding a new maintainer

1. An existing maintainer opens a Discussion proposing the candidate.
   The post lists what the candidate has contributed (issues, PRs,
   reviews, Discussion answers) over the last 3+ months.
2. Existing maintainers leave a 👍 or 👎 reaction within 7 days.
3. With at least two 👍 and no unaddressed 👎 from active maintainers, the
   candidate is added to the GitHub team and the CODEOWNERS file via PR.

Maintainers who become inactive (no reviews or contributions for 6+
months) may be moved to an emeritus list via the same process. This is
not a punishment — it is just keeping the team list honest.

## Releases

Releases follow [Semantic Versioning 2.0](https://semver.org/). The
release cadence and patch policy are documented in
[`CHANGELOG.md`](CHANGELOG.md) and (where applicable) on the
[`ROADMAP.md`](ROADMAP.md). Security patches are an exception and ship
immediately on every supported branch.

## Security disclosure

See [`SECURITY.md`](SECURITY.md). Vulnerability reports go to the GitHub
private advisory channel or `security@meetropolis.de`. Coordinated
disclosure happens with affected downstream users before a public patch.

## Changes to this document

Anyone can propose a change to this file via PR. Changes are subject to
the standard review process; substantive changes (anything affecting
roles, decision-making, or stewardship) require an explicit ✅ from the
lead maintainer before merge.
