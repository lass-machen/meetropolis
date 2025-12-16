# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- GitHub Actions CI/CD pipeline
- Issue and PR templates
- Dependabot configuration for automated dependency updates
- Security scanning with CodeQL
- Rate limiting middleware for API protection
- Sentry integration for error tracking
- Landing page with signup flow
- Pricing page component
- Email verification flow

### Changed
- Updated `.env.example` with production-ready configuration
- Enhanced README with badges and clearer documentation

### Security
- Added rate limiting to prevent abuse
- Implemented proper CORS configuration for production

## [0.1.0] - 2025-01-XX

### Added
- Initial open source release
- Monorepo structure with `apps/web`, `apps/server`, `packages/shared`
- Real-time communication with Colyseus
- Audio/Video with LiveKit integration
- Phaser-based game world with Tiled map support
- Multi-tenant architecture with Stripe billing
- User authentication (email/password, OAuth ready)
- API token support for remote control
- Map editor for creating custom worlds
- Zone-based audio proximity
- Follow mode for users
- Do Not Disturb mode
- Desktop app support via Tauri

### Infrastructure
- Docker Compose for development and production
- Traefik reverse proxy with automatic SSL
- PostgreSQL database with Prisma ORM
- LiveKit server integration

[Unreleased]: https://github.com/lass-machen/meetropolis/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/lass-machen/meetropolis/releases/tag/v0.1.0
