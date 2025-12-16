![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)
![Node](https://img.shields.io/badge/Node-20%2B-green.svg)
![TypeScript](https://img.shields.io/badge/TypeScript-5.5-blue.svg)

# Meetropolis

A virtual office platform for remote teams - like Gather.town, but open source.

## Features

- **Spatial Audio/Video** - Proximity-based conversations powered by LiveKit
- **2D Game World** - Interactive maps with Phaser and Tiled editor support
- **Zone-based Audio** - Isolated conversation areas and meeting rooms
- **Multi-tenant Architecture** - SaaS-ready with Stripe billing integration
- **Desktop App** - Native support via Tauri (macOS, Windows, Linux)
- **GDPR Compliant** - Data export, account deletion, cookie consent

## Quick Start

### Prerequisites

- Node.js 20+
- Docker & Docker Compose

### Setup

1. **Clone and install dependencies:**
   ```bash
   git clone https://github.com/lass-machen/meetropolis.git
   cd meetropolis
   npm install
   ```

2. **Create environment file:**
   ```bash
   cp .env.example .env
   ```

3. **Start development environment:**
   ```bash
   docker compose up --build
   ```

4. **Access the application:**
   - Web: http://localhost:5173
   - API: http://localhost:2567
   - LiveKit: http://localhost:7880

### Alternative: Local Development (without Docker)

```bash
# Generate Prisma client
npm run generate

# Run database migrations
npm run prisma:migrate

# Start web and server in parallel
npm run dev
```

## Project Structure

```
meetropolis/
├── apps/
│   ├── server/          # Express + Colyseus + Prisma backend
│   │   └── prisma/      # Database schema and migrations
│   └── web/             # React + Vite + Phaser frontend
│       └── src-tauri/   # Tauri desktop app config
├── packages/
│   └── shared/          # Shared types and utilities
├── docker-compose.yml   # Development environment
└── docker-compose.prod.yml  # Production deployment
```

## Configuration

See `.env.example` for all available configuration options. Key variables:

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | Secret for JWT signing (32+ chars in production) |
| `LIVEKIT_URL` | LiveKit server URL |
| `LIVEKIT_API_KEY` | LiveKit API key |
| `LIVEKIT_API_SECRET` | LiveKit API secret |
| `CORS_ORIGIN` | Allowed origins (required in production) |
| `STRIPE_SECRET_KEY` | Stripe API key (for billing) |

## API Tokens

Control your presence remotely with personal API tokens:

1. Open **API Tokens & Docs** from the top-right menu
2. Create a new token (shown only once - save securely)
3. Use the token to control mic, camera, screenshare, and DND status:

```bash
curl -X POST "http://localhost:2567/controls" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "mic": false, "dnd": true }'
```

## Production Deployment

### Docker Compose (Recommended)

```bash
# Configure production environment
cp .env.example .env
# Edit .env with production values

# Deploy with Traefik reverse proxy
docker compose -f docker-compose.prod.yml up -d
```

### Required Production Configuration

- `NODE_ENV=production`
- `JWT_SECRET` - Cryptographically random, 32+ characters
- `API_TOKEN_PEPPER` - Random string for API token hashing
- `CORS_ORIGIN` - Explicit list of allowed origins
- `COOKIE_SECURE=true` - Enable secure cookies

## OSS Edition Limits

The open source edition includes a **25 concurrent user limit** per instance. This limit ensures fair use while keeping the core platform freely available.

For unlimited users and multi-tenant features, see [Enterprise Edition](docs/enterprise.md).

## Contributing

We welcome contributions! Please read our [Contributing Guide](CONTRIBUTING.md) before submitting PRs.

- [Code of Conduct](CODE_OF_CONDUCT.md)
- [Security Policy](SECURITY.md)

## License & Editions

- **Open Source**: Apache 2.0 (see [LICENSE](LICENSE), [NOTICE](NOTICE))
- **Enterprise**: Multi-tenant features available separately
- **Trademarks**: See [TRADEMARKS.md](TRADEMARKS.md)

### What's Included (OSS)

- Full virtual office functionality
- Spatial audio/video with LiveKit
- Map editor and custom worlds
- Single-tenant deployment
- 25 concurrent user limit

### Enterprise Features

- Multi-tenant architecture
- Stripe billing integration
- Unlimited concurrent users
- Priority support

For commercial licensing, contact us at [info@meetropolis.de](mailto:info@meetropolis.de).
