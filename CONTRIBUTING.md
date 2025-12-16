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

- Node.js 20+
- Docker & Docker Compose
- Git

### Local Setup

```bash
# Clone the repository
git clone https://github.com/lass-machen/meetropolis.git
cd meetropolis

# Copy environment file
cp .env.example .env

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

## License

By contributing, you agree that your contributions will be licensed under the Apache-2.0 License.

## Questions?

- Open a [Discussion](https://github.com/lass-machen/meetropolis/discussions) for questions
- Check existing issues and discussions first
- Be patient and respectful

---

Thank you for contributing!
