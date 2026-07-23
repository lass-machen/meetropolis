# Tool Development Guide

Reference for building standalone admin tools (Map Editor, Texture Pack Manager, etc.) that integrate with the Meetropolis server and frontend.

Based on the patterns established by the **Avatar Pack Manager** (`tools/avatar-pack-manager.html`).

---

## 1. Architecture Overview

### How Standalone HTML Tools Communicate with the Server

Admin tools are self-contained single-file HTML applications that live in the `tools/` directory. They communicate with the Meetropolis server via REST API calls, authenticating either through session cookies (same-origin) or Bearer tokens (cross-origin / external use).

### Full Data Flow

```
Tool HTML (tools/*.html)
  |  REST API (fetch with Bearer token or cookie credentials)
  v
Server API (apps/server/src/api/routes/*.ts)
  |  Prisma ORM
  v
Database (PostgreSQL)
  |  Also writes files to public/packs/ for static assets
  v
Frontend Registry (apps/web/src/game/*Registry.ts)
  |  Fetches pack data from API at startup
  v
Phaser Game (MainScene)
  |  Dynamically loads spritesheets, creates animations
  v
React UI (settings panels)
  |  Uses Bridge pattern for live updates
  v
Game Bridge (apps/web/src/game/bridge.ts)
```

Key points:
- The tool uploads binary assets (images) via multipart form data to a dedicated upload endpoint
- Metadata (pack definitions, avatar configs) is submitted as JSON to a CRUD endpoint
- The server stores metadata in PostgreSQL via Prisma and files on disk under `public/packs/`
- The frontend fetches metadata from the API and loads assets via static file URLs
- Live updates (e.g., avatar switching) flow through the Bridge pattern: React UI -> gameBridge -> SceneApi -> MainScene

---

## 2. Server-Side Patterns

### File Upload with Multer

Use multer with **memory storage** for file uploads. This keeps things simple (no temp files) and allows validation before writing to disk.

```ts
// apps/server/src/api/routes/avatarPacks.ts
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
});

app.post('/avatar-packs/upload-sprite', upload.single('file'), async (req, res) => {
  const file = (req as any).file;
  if (!file || !file.buffer || file.size <= 0) {
    return res.status(400).json({ error: 'file required' });
  }

  // Validate file magic bytes (PNG: 0x89 0x50 0x4E 0x47)
  const buf = file.buffer as Buffer;
  if (buf[0] !== 0x89 || buf[1] !== 0x50 || buf[2] !== 0x4e || buf[3] !== 0x47) {
    return res.status(400).json({ error: 'invalid png' });
  }

  // Content-hash for deduplication and cache-busting
  const hash = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 8);
  const filename = `${hash}.png`;
  // ...write to disk, return URL
});
```

### Packs Directory Structure

Assets are stored under a configurable directory:

```ts
const packsDir = process.env.ASSET_PACKS_DIR
  || path.resolve(__dirname, '../../../../../public/packs');
```

Directory layout:
```
public/packs/
  avatars/
    <packUuid>/
      <hash>.png          # Content-hashed sprite files
  textures/               # Future: texture packs
    <packUuid>/
      <hash>.png
```

### Static Serving with Immutable Cache Headers

In `apps/server/src/index.ts`, the packs directory is served with long-lived immutable cache headers. Since filenames are content-hashed, this is safe:

```ts
const packsDir = process.env.ASSET_PACKS_DIR
  || path.resolve(__dirname, '../../../public/packs');
fs.mkdirSync(packsDir, { recursive: true });
app.use('/packs', express.static(packsDir, { maxAge: '365d', immutable: true }));
```

### Delete Cascade (File Cleanup)

When a database record is deleted, clean up associated files on disk:

```ts
app.delete('/avatar-packs/:id', async (req, res) => {
  // ...auth check, find record...
  const packUuid = pack.uuid;
  await prisma.avatarPack.delete({ where: { id } });

  // Cascade: remove sprite directory
  try {
    const dir = path.resolve(packsDir, 'avatars', packUuid);
    await fs.promises.rm(dir, { recursive: true, force: true });
  } catch (cleanupErr) {
    logger.warn('[AvatarPacks] sprite cleanup failed (non-fatal)', { packUuid });
  }

  res.json({ ok: true });
});
```

### Auth Pattern (Session + API Token Dual Auth)

Every mutating endpoint supports two authentication methods. This allows both browser-based (cookie) and tool-based (token) access:

```ts
import { requireAuth, requireApiToken } from '../utils/authHelpers.js';

app.post('/your-endpoint', async (req, res) => {
  const sessionAuth = requireAuth(req);         // JWT from cookie or Authorization header
  const tokenAuth = await requireApiToken(req, prisma);  // Hashed API token lookup
  const auth = sessionAuth || tokenAuth;
  if (!auth) return res.status(401).json({ error: 'unauthorized' });
  // ...proceed
});
```

- `requireAuth()` checks the `auth_token` cookie or `Authorization: Bearer <JWT>` header
- `requireApiToken()` checks `Authorization: Bearer <opaque-token>` against hashed tokens in DB
- Read-only endpoints (GET list, GET by id) can be public (no auth required)

### Route Registration

Routes are registered via a function exported from the route file, called in `apps/server/src/api.ts`:

```ts
// apps/server/src/api.ts
import { registerAvatarPackRoutes } from './api/routes/avatarPacks.js';
// ...
registerAvatarPackRoutes(app, prisma);
```

### Input Validation with Zod

Use Zod schemas for request body validation:

```ts
const AvatarPackCreateSchema = z.object({
  uuid: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  author: z.string().min(1),
  version: z.string().min(1),
  type: z.string().default('full'),
  avatars: z.array(z.record(z.unknown())).min(1),
});

const parsed = AvatarPackCreateSchema.safeParse(req.body);
if (!parsed.success) {
  return res.status(400).json({ error: 'invalid body', details: parsed.error.errors });
}
```

---

## 3. Standalone HTML Tool Patterns

### Self-Contained Single-File HTML

Each tool is a single `.html` file with embedded CSS and JS. No build step, no dependencies. Just open it in a browser.

```
tools/
  avatar-pack-manager.html    # Existing
  map-editor.html             # Future example
  texture-pack-manager.html   # Future example
```

### apiFetch() Helper

The core API communication function handles both auth modes and CORS correctly:

```js
async function apiFetch(path, opts = {}) {
  const base = document.getElementById('apiUrl').value.replace(/\/+$/, '');
  const token = document.getElementById('authToken').value.trim();
  const headers = { ...(opts.headers || {}) };

  // Add Bearer token if provided
  if (token) {
    headers['Authorization'] = token.startsWith('Bearer ') ? token : `Bearer ${token}`;
  }

  // Set Content-Type for JSON bodies (but NOT for FormData -- browser sets boundary)
  if (opts.body && typeof opts.body === 'string') {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(`${base}${path}`, {
    ...opts,
    headers,
    // Only include credentials (cookies) when no token is set.
    // When a token IS set, skip credentials to avoid CORS preflight issues.
    ...(token ? {} : { credentials: 'include' }),
  });
  return res;
}
```

Important: When uploading files via `FormData`, do NOT set the `Content-Type` header manually. The browser sets it automatically with the correct multipart boundary.

### Connection Testing and Status Display

Provide a connection panel with API URL input, optional auth token, and a test button:

```html
<div class="field">
  <label>API Base URL</label>
  <input type="text" id="apiUrl" value="http://localhost:2567">
</div>
<div class="field">
  <label>Auth Token (optional)</label>
  <input type="text" id="authToken" placeholder="Bearer token or leave empty for cookies">
</div>
<button onclick="testConnection()">Test Connection</button>
```

Show connection status with a colored dot indicator:

```js
async function testConnection() {
  try {
    const res = await apiFetch('/avatar-packs');
    if (res.ok) {
      // Update UI: green dot, "Connected"
      dot.className = 'conn-dot ok';
    } else {
      dot.className = 'conn-dot err';
    }
  } catch (e) {
    dot.className = 'conn-dot err';
  }
}
```

### File Upload via FormData

```js
async function uploadSprite() {
  // Convert data URL to blob
  const resp = await fetch(spriteDataUrl);
  const blob = await resp.blob();

  const formData = new FormData();
  formData.append('file', blob, filename);
  formData.append('packUuid', packUuid);

  // Note: no Content-Type header -- FormData sets it with boundary
  const res = await apiFetch('/avatar-packs/upload-sprite', {
    method: 'POST',
    body: formData,
  });
}
```

### Dark Theme Design System

Use CSS custom properties for consistent dark theme styling across tools:

```css
:root {
  --bg-deep: #0a0b0f;
  --bg: #12131a;
  --bg-raised: #1a1b25;
  --bg-surface: #22232f;
  --border: #2a2c3a;
  --border-active: #3d3f52;
  --border-accent: #5865f2;
  --fg: #d4d5db;
  --fg-dim: #7a7c8a;
  --fg-muted: #4a4c58;
  --accent: #5865f2;
  --green: #3ba55d;
  --red: #ed4245;
  --orange: #f0a020;
  --radius: 6px;
  --font-mono: 'JetBrains Mono', monospace;
  --font-sans: 'Space Grotesk', sans-serif;
}
```

Recommended Google Fonts: `JetBrains Mono` (code/labels) and `Space Grotesk` (UI text).

### Toast Notifications

```js
function toast(type, text) {
  const container = document.getElementById('toast');
  const div = document.createElement('div');
  div.className = `toast-item ${type}`;  // 'ok' or 'err'
  div.textContent = text;
  container.appendChild(div);
  setTimeout(() => {
    div.style.opacity = '0';
    div.style.transition = 'opacity 0.3s';
    setTimeout(() => div.remove(), 300);
  }, 3000);
}
```

---

## 4. Frontend Integration Patterns

### Registry Pattern (Singleton)

Each asset type gets a singleton registry that loads data from the API and provides lookup methods:

```ts
// apps/web/src/game/avatarRegistry.ts
class AvatarRegistry {
  private manifests = new Map<string, AvatarManifest>();
  private loadedTextures = new Set<string>();

  async loadPacks(apiBase?: string): Promise<void> {
    const res = await fetch(`${base}/avatar-packs`, { credentials: 'include' });
    const packs = await res.json();
    for (const pack of packs) {
      for (const avatar of pack.avatars) {
        const id = `${pack.uuid}:${avatar.key}`;
        this.manifests.set(id, { /* ... */ });
      }
    }
    this.ensureDefault(); // Always guarantee a fallback
  }

  getManifest(avatarId: string): AvatarManifest | null { /* ... */ }
  getAllAvatars(): AvatarManifest[] { /* ... */ }
}

export const avatarRegistry = new AvatarRegistry();
```

Key pattern: The registry is a class instance exported as a singleton. It provides:
- `loadPacks()` - async initialization from API
- `getManifest(id)` - lookup by composite ID (`packUuid:key`)
- `ensureDefault()` - guaranteed fallback when no packs exist

### Loading Packs Before Game Boot

In `useGameInitialization`, packs are loaded before creating the Phaser game:

```ts
// apps/web/src/app/routes/hooks/useGameInitialization.ts
const initGame = async () => {
  await avatarRegistry.loadPacks(apiBase);  // Load packs FIRST
  if (!containerRef.current) return;
  game = createPhaserGame(containerRef.current);  // Then create game
};
initGame();
```

This ensures all manifest data is available when the game scene initializes.

### Dynamic Spritesheet Loading in Running Phaser Scenes

When a new texture is needed at runtime (e.g., avatar change), use Phaser's loader with a completion callback:

```ts
// apps/web/src/game/scenes/MainScene.ts
changeHeroAvatar(avatarId: string) {
  const textureKey = avatarRegistry.getTextureKey(avatarId);

  if (this.textures.exists(textureKey)) {
    // Texture already loaded, switch immediately
    this.playerManager.changeAvatar(avatarId);
  } else {
    // Load texture dynamically, then switch
    avatarRegistry.preloadAvatar(this, avatarId);
    this.load.once('complete', () => {
      this.playerManager.changeAvatar(avatarId);
    });
    this.load.start();  // Must call start() to trigger loading
  }
}
```

The registry's `preloadAvatar()` method queues the spritesheet load:

```ts
preloadAvatar(scene: Phaser.Scene, avatarId: string): void {
  const manifest = this.getManifest(avatarId);
  if (!manifest) return;
  const textureKey = this.getTextureKey(avatarId);
  if (this.loadedTextures.has(textureKey)) return;
  scene.load.spritesheet(textureKey, manifest.spriteUrl, {
    frameWidth: manifest.frameWidth,
    frameHeight: manifest.frameHeight,
  });
  this.loadedTextures.add(textureKey);
}
```

### Bridge Pattern for UI -> Game Communication

The bridge connects React UI to the Phaser game scene. Adding a new capability requires changes in four places:

**1. Bridge type** (`apps/web/src/game/bridge.ts`): Add method signature to `Bridge` type.
```ts
type Bridge = {
  // ...existing methods...
  changeHeroAvatar: (avatarId: string) => void;
};
```

**2. SceneApi type** (`apps/web/src/game/bridge.ts`): Add optional method to `SceneApi` type.
```ts
export type SceneApi = {
  // ...existing methods...
  changeHeroAvatar?: (avatarId: string) => void;
};
```

**3. gameBridge object** (`apps/web/src/game/bridge.ts`): Implement the bridge method that delegates to sceneApi.
```ts
export const gameBridge: Bridge = {
  // ...
  changeHeroAvatar: (avatarId) => {
    sceneApi?.changeHeroAvatar?.(avatarId);
  },
};
```

**4. MainScene** (`apps/web/src/game/scenes/MainScene.ts`): Implement the actual logic.
```ts
changeHeroAvatar(avatarId: string) {
  // ...actual Phaser logic...
}
```

The scene registers itself as the sceneApi on creation and unregisters on shutdown:

```ts
// In MainScene.create():
gameBridge.setSceneApi(this);
this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => gameBridge.setSceneApi(null));
```

### Preview Rendering with Canvas API

To render avatar previews in React, extract specific frames from spritesheets using the Canvas API:

```tsx
// apps/web/src/ui/settings/AvatarSettings.tsx
function AvatarPreview({ spriteUrl, frameWidth, frameHeight, idleRow }) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);

  React.useEffect(() => {
    const img = new Image();
    img.onload = () => {
      const ctx = canvasRef.current.getContext('2d');
      ctx.imageSmoothingEnabled = false;  // Pixel art must stay crisp
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      // Draw first frame of idle row: srcX=0, srcY=idleRow*frameHeight
      ctx.drawImage(img, 0, idleRow * frameHeight, frameWidth, frameHeight,
                    0, 0, canvas.width, canvas.height);
    };
    img.src = spriteUrl;
  }, [spriteUrl, frameWidth, frameHeight, idleRow]);

  return <canvas ref={canvasRef} width={64} height={96}
                 style={{ imageRendering: 'pixelated' }} />;
}
```

The `idleRow` offset is critical -- it comes from `avatar.states.idle.row` in the pack manifest and determines which row of the spritesheet contains the idle-down frame.

### Live Avatar Changes from UI

The full flow for a user changing their avatar:

```tsx
// apps/web/src/ui/settings/ProfileSettings.tsx
const handleAvatarChange = async (newAvatarId: string) => {
  // 1. Persist to server
  await fetch(`${apiBase}/me/avatar`, {
    method: 'PATCH', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ avatarId: newAvatarId }),
  });
  // 2. Update local state
  localStorage.setItem('avatarId', newAvatarId);
  // 3. Live-update the game via bridge
  gameBridge.changeHeroAvatar(newAvatarId);
};
```

---

## 5. Key Files Reference

| File | Role |
|------|------|
| `tools/avatar-pack-manager.html` | Standalone HTML admin tool for managing avatar packs |
| `apps/server/src/api/routes/avatarPacks.ts` | Server API: upload, CRUD, delete cascade for avatar packs |
| `apps/server/src/api/utils/authHelpers.ts` | Dual auth (session cookie + API token) helper functions |
| `apps/server/src/api.ts` | Route registration hub -- imports and calls all `register*Routes()` |
| `apps/server/src/index.ts` | Express setup, CORS, static serving for `/packs` with immutable cache |
| `apps/web/src/game/avatarRegistry.ts` | Frontend singleton registry: loads packs from API, provides manifests |
| `apps/web/src/game/bridge.ts` | Bridge pattern: `Bridge` type, `SceneApi` type, `gameBridge` object |
| `apps/web/src/game/scenes/MainScene.ts` | Phaser scene: dynamic texture loading, implements SceneApi methods |
| `apps/web/src/ui/settings/AvatarSettings.tsx` | React component: avatar grid with Canvas-based preview rendering |
| `apps/web/src/ui/settings/ProfileSettings.tsx` | React component: triggers live avatar changes via bridge |
| `apps/web/src/app/routes/hooks/useGameInitialization.ts` | Game boot: calls `avatarRegistry.loadPacks()` before `createPhaserGame()` |

---

## 6. Checklist: Adding a New Tool

### Server Side

- [ ] **Create route file** at `apps/server/src/api/routes/<yourFeature>.ts`
- [ ] **Define Zod schema** for request body validation
- [ ] **Add CRUD endpoints**: GET list (public), GET by id (public), POST create (auth), DELETE (auth + cascade)
- [ ] **Add file upload endpoint** if needed (multer, memory storage, magic byte validation, content hashing)
- [ ] **Implement delete cascade**: clean up uploaded files when DB record is deleted
- [ ] **Use dual auth** pattern: `requireAuth(req) || await requireApiToken(req, prisma)`
- [ ] **Register routes** in `apps/server/src/api.ts`: import and call `registerYourRoutes(app, prisma)`
- [ ] **Add Prisma model** if needed (schema, migration)
- [ ] **Verify static serving**: ensure `packsDir` structure and `/packs` route cover your asset subdirectory

### Standalone HTML Tool

- [ ] **Create tool file** at `tools/<your-tool>.html`
- [ ] **Implement `apiFetch()` helper** with Bearer token + cookie credential handling
- [ ] **Add connection panel** with API URL input, auth token input, and test button
- [ ] **Add connection status indicator** (colored dot + label)
- [ ] **Implement file upload** via FormData (no Content-Type header for multipart)
- [ ] **Implement CRUD operations**: list existing items, create/update, delete with confirmation
- [ ] **Add toast notifications** for success/error feedback
- [ ] **Follow dark theme** design system with CSS custom properties
- [ ] **Keep it self-contained**: single HTML file, embedded CSS + JS, no build step

### Frontend Integration

- [ ] **Create registry** singleton class in `apps/web/src/game/<feature>Registry.ts`
  - `loadPacks(apiBase)` -- fetches data from API
  - `getManifest(id)` -- lookup by composite ID
  - `ensureDefault()` -- fallback when no data exists
- [ ] **Load before game boot** in `useGameInitialization.ts`: `await yourRegistry.loadPacks(apiBase)`
- [ ] **Add bridge methods** if live updates are needed:
  1. Add to `Bridge` type in `bridge.ts`
  2. Add to `SceneApi` type in `bridge.ts`
  3. Implement in `gameBridge` object
  4. Implement in `MainScene.ts`
- [ ] **Add dynamic Phaser loading** if textures need to be loaded at runtime:
  - Check `this.textures.exists(key)` first
  - Call `registry.preload(scene, id)` + `this.load.start()` + `this.load.once('complete', ...)`
- [ ] **Build UI components** in `apps/web/src/ui/settings/`
  - Use Canvas API for sprite previews with `imageSmoothingEnabled = false`
  - Use `idleRow` (or equivalent) offset for correct frame extraction
  - Call `gameBridge.yourMethod()` for live updates
