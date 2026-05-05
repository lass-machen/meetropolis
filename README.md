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

## Desktop App (Tauri)

Meetropolis includes a native desktop app for macOS, Windows, and Linux built with [Tauri v2](https://v2.tauri.app/).

### Prerequisites

- **Rust 1.70+** ([Install Rust](https://www.rust-lang.org/tools/install))
- **Node.js 20+**
- Platform-specific dependencies:
  - **macOS**: Xcode Command Line Tools (`xcode-select --install`)
  - **Windows**: Microsoft Visual Studio C++ Build Tools
  - **Linux**: See [Tauri Linux Prerequisites](https://v2.tauri.app/start/prerequisites/#linux)

### Development

```bash
# Ensure backend is running (Docker or local)
docker compose up -d

# Start the desktop app in development mode
cd apps/web
npm run tauri dev
```

This will:
1. Start the Vite dev server with hot-reload
2. Compile the Rust backend
3. Launch the native window pointing to `http://localhost:5173`

### Building for Production

```bash
cd apps/web
npm run tauri build
```

Build outputs are in `apps/web/src-tauri/target/release/bundle/`:
- **macOS**: `Meetropolis.app` and `.dmg`
- **Windows**: `Meetropolis.exe` and `.msi`
- **Linux**: `.deb`, `.AppImage`, `.rpm`

### Configuration

The desktop app needs to connect to your Meetropolis server. Configure via:

1. **First Launch**: Enter API URL in the setup screen
2. **Menu**: `Meetropolis → Einstellungen` (or `Cmd+,` / `Ctrl+,`)
3. **Config File**:
   - macOS: `~/Library/Application Support/com.meetropolis.desktop/config.json`
   - Windows: `%APPDATA%\com.meetropolis.desktop\config.json`
   - Linux: `~/.config/com.meetropolis.desktop/config.json`

Example `config.json`:
```json
{
  "api_base": "https://api.your-domain.com",
  "web_base": "https://your-domain.com"
}
```

### Desktop App Features

- **Native Performance**: Lightweight WebView with minimal resource usage
- **Mini Mode**: Floating always-on-top window (`Cmd+M` / `Ctrl+M`)
- **System Integration**: Native menus, keyboard shortcuts, fullscreen
- **AV Sync**: Mic, camera, screen share status synced with mini window

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

## Troubleshooting

### LiveKit Connection Issues

If audio/video doesn't connect in Docker Desktop (macOS/Windows):

1. **Check your host IP** (not 127.0.0.1):
   ```bash
   # macOS
   ipconfig getifaddr en0

   # Linux
   hostname -I | awk '{print $1}'
   ```

2. **Update `.env`** with your actual host IP:
   ```bash
   LK_NODE_IP=192.168.x.x  # Your IP from step 1
   ```

3. **Restart LiveKit**:
   ```bash
   docker compose restart livekit
   ```

This is needed because Chrome filters loopback ICE candidates, and Docker Desktop uses a virtual network.

### Port Already in Use

If port 5173 or 2567 is busy:
```bash
# Find what's using the port
lsof -i :5173

# Kill the process or use different ports via .env
```

## OSS Edition Limits

The open source edition includes a **25 concurrent user limit** per instance
by default (configurable via `OSS_USER_LIMIT` env var). This limit ensures
fair use while keeping the core platform freely available.

For unlimited users and multi-tenant features, see [Enterprise Edition](docs/enterprise.md).

## Self-Hosting Your Own Branded Instance

The OSS edition contains **no** Meetropolis-specific marketing, legal pages,
brand assets, or tracking pixels. Before deploying for your team or customers,
you must:

1. **Replace branding assets** in `apps/web/public/brand/` (logo, favicon).
2. **Provide your own legal pages** (Privacy, Terms, Imprint). The OSS routes
   `/privacy`, `/terms`, `/impressum` show a placeholder when the brand
   submodule is not installed.
3. **Update the HTML title and meta description** in `apps/web/index.html`.
4. **Configure your own marketing tracking** (set `VITE_META_PIXEL_ID`) or
   leave tracking disabled.
5. **Adjust source-code strings** that still reference "Meetropolis" if you
   intend to publish a derivative product (see [TRADEMARKS.md](TRADEMARKS.md)).

## Editions & Architecture

The codebase is split across three repositories that are pulled together at
build time:

| Edition | Repo / Submodule | License | Contents |
|---|---|---|---|
| **Open Source** | `meetropolis` (this repo) | Apache-2.0 | Single-tenant virtual office, spatial AV, map editor, generic OSS landing |
| **Enterprise** | `packages/tenancy-enterprise` (private submodule) | Commercial | Multi-tenancy, Stripe billing, pricing-plan & tenant CRUD, pack marketplace, billing audit log, admin/billing/audit UI |
| **Brand** | `packages/brand` (private submodule) | Commercial | Meetropolis marketing landing, legal pages, brand assets, Meta-Pixel tracking |

Optional submodules are loaded at runtime via dynamic imports
(`apps/server/src/{tenancyLoader,billingLoader,adminLoader}.ts` on the server
and `apps/web/src/lib/{enterpriseWebLoader,brandLoader,desktopLoader}.ts` on
the web). Without the private submodules, the OSS edition runs single-tenant
and shows a generic, unbranded landing.

See [docs/enterprise.md](docs/enterprise.md) and [docs/brand.md](docs/brand.md)
for the integration details.

## Contributing

We welcome contributions! Please read our [Contributing Guide](CONTRIBUTING.md) before submitting PRs.

- [Code of Conduct](CODE_OF_CONDUCT.md)
- [Security Policy](SECURITY.md)

## License & Editions

- **Open Source**: Apache 2.0 (see [LICENSE](LICENSE), [NOTICE](NOTICE))
- **Enterprise / Brand**: Commercial license, separate private submodules
- **Trademarks**: See [TRADEMARKS.md](TRADEMARKS.md) — Apache 2.0 does **not**
  grant rights to use the Meetropolis name or logo.

### What's Included (OSS)

- Full virtual office functionality (spatial audio/video, 2D world, map editor)
- Spatial audio/video with LiveKit
- Map editor and custom worlds
- Single-tenant deployment
- 25 concurrent user limit (configurable via `OSS_USER_LIMIT`)
- Generic, unbranded landing page

### Enterprise Features (separate submodule)

- Multi-tenant architecture
- Stripe billing integration (subscriptions, trials, dunning, invoices)
- Pricing-plan and pack-marketplace CRUD with admin UI
- Tenant-scoped billing audit log
- Unlimited concurrent users

### Brand Features (separate submodule)

- Meetropolis-specific marketing landing page (Hero, Comparison, Social Proof, Pricing CTA)
- Legal pages (Privacy, Terms of Service, Impressum)
- Meta-Pixel marketing tracking + cookie-consent banner
- Brand logos, wordmark, screenshots, editor showcase video

For commercial licensing, contact us at [info@meetropolis.de](mailto:info@meetropolis.de).
