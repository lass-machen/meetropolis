# Contributing to Meetropolis

Thank you for your interest in contributing to Meetropolis! This document provides guidelines and information for contributors.

## Code of Conduct

By participating in this project, you agree to abide by our [Code of Conduct](CODE_OF_CONDUCT.md). Please read it before contributing.

## How to Contribute

### Reporting Bugs

Before creating a bug report, please check the existing issues to avoid duplicates.

When filing a bug report, include:

- A clear and descriptive title
- Steps to reproduce the issue
- Expected vs. actual behavior
- Your environment (OS, browser, Node.js version)
- Screenshots or logs if applicable

### Suggesting Features

Feature requests are welcome! Please:

- Check if the feature has already been suggested
- Provide a clear description of the feature
- Explain why it would be useful
- Consider whether it fits the project's scope

### Pull Requests

1. **Fork the repository** and create your branch from `main`
2. **Follow the code style** defined in `AGENTS.md`
3. **Write tests** for new functionality
4. **Update documentation** if needed
5. **Ensure all tests pass** before submitting

#### Branch Naming

- `feature/<slug>` - New features
- `fix/<slug>` - Bug fixes
- `chore/<slug>` - Maintenance tasks

#### Commit Messages

- Use the imperative mood ("Add feature" not "Added feature")
- Keep commits focused on a single change
- Reference issues when relevant (`Fix #123`)

## Development Setup

### Prerequisites

- Node.js 24 (see `.nvmrc`; `nvm use` picks it up automatically)
- npm 11.7.0+ (pinned via `package.json` `packageManager` field; activate with `corepack enable` — see below)
- Docker & Docker Compose
- Git

### Local Setup

```bash
# Clone the repository
git clone https://github.com/lass-machen/meetropolis.git
cd meetropolis

# Copy environment file
cp .env.example .env

# Activate the pinned npm version once (Node 24 ships corepack).
# This makes every `npm` call in this repo use the npm version
# declared in package.json's packageManager field, regardless of
# which global npm your system has. Without this, lockfile drift
# can occur across platforms because different npm versions write
# slightly different lockfile shapes.
corepack enable

# Install dependencies
npm install

# Generate Prisma client and run migrations
npm run generate
npm run prisma:migrate

# Start development servers
docker compose up --build
# Or without Docker:
npm run dev
```

### Project Structure

```
apps/
  server/     # Express + Colyseus + Prisma backend
  web/        # React + Vite + Phaser frontend
packages/
  shared/     # Shared types and utilities
```

### Running Tests

```bash
# Run all tests
npm -w @meetropolis/server run test
npm -w @meetropolis/web run test

# Run specific test file
npm -w @meetropolis/web run test -- src/lib/geom.test.ts
```

### Code Quality

Before submitting a PR:

```bash
# Build everything
npm run build

# Run linter
npm run lint

# Verify tests pass
npm -w @meetropolis/web run test
npm -w @meetropolis/server run test
```

## Quality Standards

Please read `AGENTS.md` for detailed quality guidelines. Key points:

- **File size limits**: React/TS files ≤ 400 LoC (target), ≤ 600 LoC (absolute max)
- **Function size**: ≤ 50 LoC (target), ≤ 80 LoC (absolute max)
- **TypeScript**: Strict mode, no `any` types
- **Testing**: New logic requires tests
- **No secrets**: Never commit credentials or API keys

## Architecture Guidelines

- **Shared code** goes in `packages/shared`
- **State management**: Zustand for global state
- **Communication**: Colyseus for realtime, LiveKit for AV
- **UI/Game separation**: React and Phaser communicate via bridge events

## Review Process

1. All PRs require at least one review
2. CI must pass (build, lint, tests)
3. Documentation must be updated if applicable
4. Screenshots/recordings for UI changes

## Licensing of contributions

Meetropolis uses a dual-license model. Contributions inherit the license of
the file or directory they land in:

- Contributions to `apps/server`, `apps/npc-service`, `apps/loadtest`, or to
  files in the repository root → **AGPL-3.0-only**
- Contributions to `apps/web` or `packages/shared` → **MIT**

The full per-component breakdown is in [LICENSING.md](LICENSING.md). If you
are unsure where your change belongs, ask in the PR description and a
maintainer will clarify before merge.

### Developer Certificate of Origin (DCO)

Every commit on a pull request must be signed off under the [Developer
Certificate of Origin](https://developercertificate.org/). The DCO is a
simple statement that you wrote the contribution yourself, or that you have
the right to submit it under the project's licenses. It is **not** a
copyright assignment — you keep the copyright on your work.

Add the sign-off line to your commits via:

```bash
git commit --signoff -m "feat(web): add zone capacity badges"
# or shorter:
git commit -s -m "..."
```

This appends a trailer to the commit message:

```
Signed-off-by: Jane Doe <jane@example.com>
```

The name and email must match the git author on the commit. If you forget
the sign-off, you can amend with:

```bash
git commit --amend --signoff       # last commit
git rebase --signoff <base-branch> # whole PR branch
```

PRs without sign-offs are blocked from merging by an automated check.

### Inbound license grant (commercial relicensing)

In addition to the open-source license that applies to your contribution,
you grant Tiamat UG (the maintainer behind Meetropolis) a perpetual,
worldwide, non-exclusive, royalty-free, irrevocable license to also use,
reproduce, modify, sublicense, and distribute your contribution under the
**Meetropolis Commercial License** offered by Tiamat UG.

This grant exists so that Tiamat can sustainably operate the project and
offer a commercial license to customers whose internal policies prevent
them from using AGPL-3.0 software. It does **not** transfer your copyright,
does **not** restrict your ability to use your own contribution elsewhere,
and does **not** affect the open-source license under which the rest of the
community will continue to receive the contribution.

By submitting a pull request and signing off with DCO, you confirm that
this inbound grant applies to your contribution.

If you cannot agree to the inbound grant (for example because your employer
has policies that restrict commercial relicensing), please say so in the
pull request before review and we will discuss an exception. The default
for accepted PRs is grant included.

### Dependencies

If your PR depends on adding a new runtime dependency, call this out
explicitly in the PR description and justify the choice. New dependencies
need a license that is compatible with both AGPL-3.0 and MIT (so MIT,
Apache-2.0, BSD, ISC, MPL, LGPL, CC0, or similar permissive licenses are
fine; GPL-only or AGPL-only dependencies need maintainer agreement first).

### Trademarks

The "Meetropolis" name and any associated logos are trademarks of Tiamat UG
and are **not** granted by AGPL-3.0 or MIT (AGPL-3.0 §7e and MIT both stay
silent on marks). Forks that intend to commercialize the codebase must
replace all branding with their own. See [TRADEMARKS.md](TRADEMARKS.md) for
the full policy and the "Powered by Meetropolis" attribution rules.

## Questions?

- Open a [Discussion](https://github.com/lass-machen/meetropolis/discussions) for questions
- Check existing issues and discussions first
- Be patient and respectful

---

Thank you for contributing!
