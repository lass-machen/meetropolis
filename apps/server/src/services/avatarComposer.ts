import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { PNG } from 'pngjs';
import {
  assertSpriteCatalog,
  canonicalConfigString,
  composeSheet,
  type AvatarConfig,
  type RgbaImage,
  type SheetFormat,
  type SpriteCatalog,
} from '@meetropolis/shared';
import { logger } from '../logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Phase-2 feature gate (default OFF). Gates BOTH the editor endpoints
 * (compose/resolve) and — via the web loader — the editor UI, so nothing is
 * exposed before the Phase-3 gating decision. Set AVATAR_EDITOR_ENABLED=true to
 * turn it on.
 */
export function avatarEditorEnabled(): boolean {
  const raw = (process.env.AVATAR_EDITOR_ENABLED ?? '').trim().toLowerCase();
  return raw === 'true' || raw === '1' || raw === 'on' || raw === 'yes';
}

/**
 * Candidate locations for the canonical v5 sprite catalog, most specific first:
 *   1. an explicit SPRITE_CATALOG_PATH override;
 *   2. the copy placed next to the built server bundle by copy-catalog.mjs
 *      (deploy-robust — independent of the surrounding monorepo layout);
 *   3. the workspace source (used in dev, where the server runs from src/).
 */
function catalogCandidates(): string[] {
  const fromEnv = process.env.SPRITE_CATALOG_PATH;
  const candidates = [
    path.resolve(__dirname, '../sprite-catalog.json'),
    path.resolve(__dirname, '../../../../packages/shared/sprite/catalog.json'),
  ];
  return fromEnv ? [fromEnv, ...candidates] : candidates;
}

let cachedCatalog: SpriteCatalog | null = null;

/** Load + schema-assert the sprite catalog once. Throws loudly if unavailable. */
export function loadSpriteCatalog(): SpriteCatalog {
  if (cachedCatalog) return cachedCatalog;
  for (const candidate of catalogCandidates()) {
    if (!fs.existsSync(candidate)) continue;
    const raw = fs.readFileSync(candidate, 'utf8');
    cachedCatalog = assertSpriteCatalog(JSON.parse(raw));
    logger.info('[AvatarComposer] loaded sprite catalog', { path: candidate, schema: cachedCatalog.schema });
    return cachedCatalog;
  }
  throw new Error(`sprite catalog not found; looked in: ${catalogCandidates().join(', ')}`);
}

function encodePng(image: RgbaImage): Buffer {
  const png = new PNG({ width: image.width, height: image.height });
  png.data.set(image.data);
  // Deterministic within this runtime: fixed deflate level, no tIME/tEXt chunks
  // (pngjs writes none by default). Byte identity is NOT the dedup anchor — the
  // canonical config hash is — so cross-runtime deflate differences are benign.
  return PNG.sync.write(png, { colorType: 6, deflateLevel: 9 });
}

/** Crop one FWxFH cell out of a composed sheet (col, row are in frame units). */
function cropCell(image: RgbaImage, col: number, row: number, fw: number, fh: number): RgbaImage {
  const out = new Uint8ClampedArray(fw * fh * 4);
  const ox = col * fw;
  const oy = row * fh;
  for (let y = 0; y < fh; y++) {
    for (let x = 0; x < fw; x++) {
      const src = ((oy + y) * image.width + (ox + x)) * 4;
      const dst = (y * fw + x) * 4;
      out[dst] = image.data[src];
      out[dst + 1] = image.data[src + 1];
      out[dst + 2] = image.data[src + 2];
      out[dst + 3] = image.data[src + 3];
    }
  }
  return { width: fw, height: fh, data: out };
}

/** Canonical-config dedup anchor (NOT the PNG bytes): stable across runtimes. */
export function configHashHex(catalog: SpriteCatalog, config: AvatarConfig): string {
  return crypto.createHash('sha256').update(canonicalConfigString(catalog, config)).digest('hex').slice(0, 16);
}

export interface ComposedAvatar {
  sheetPng: Buffer;
  previewPng: Buffer;
}

/** Composite the full sheet + a front-idle preview from a (validated) config. */
export function composeAvatar(catalog: SpriteCatalog, config: AvatarConfig): ComposedAvatar {
  const sheet = composeSheet(catalog, config);
  const preview = cropCell(sheet, 0, 0, catalog.format.frame_w, catalog.format.frame_h);
  return { sheetPng: encodePng(sheet), previewPng: encodePng(preview) };
}

// --- file lifecycle -------------------------------------------------------
// Custom sprites live under a FIXED subdirectory keyed by a server-generated
// uuid — never a client-supplied path — so this route is structurally free of
// the path-traversal edge in the admin sprite-upload handler.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The asset-packs root, resolved the same way as the avatar-pack routes. */
export function customAvatarPacksDir(): string {
  return process.env.ASSET_PACKS_DIR || path.resolve(__dirname, '../../../../public/packs');
}

export function customAvatarDir(packsDir: string): string {
  return path.resolve(packsDir, 'avatars', 'custom');
}

/**
 * URL of a custom avatar's sprite sheet / preview.
 *
 * THESE BYTES ARE PUBLIC. `/packs` is a `TENANT_BYPASS_PREFIXES` entry
 * (tenancy.ts) served by `express.static` with `Access-Control-Allow-Origin: *`
 * (index.ts), so anyone who knows the uuid can GET the PNG with no session at
 * all. The only thing protecting it is that the uuid is an unguessable v4 —
 * this is a capability URL, not an authorisation check, and no code in this
 * repo should claim otherwise.
 *
 * That is a deliberate decision, not an oversight, because a gate here cannot
 * work with how the file is fetched:
 *  - the game loads the sheet through Phaser (`avatarRegistry.preloadAvatar` ->
 *    `scene.load.spritesheet`), whose XHR default is `withCredentials: false`
 *    and is not overridden in `phaserGame.ts`;
 *  - the UI loads the preview through a plain `<img src>` (AvatarSprite.tsx,
 *    AvatarSettings.tsx) with no `crossOrigin`/credentials;
 *  - web and API are separate origins in production (meetropolis.me vs.
 *    api.meetropolis.me) and the static handler answers `ACAO: *` while
 *    explicitly removing `Access-Control-Allow-Credentials`, so the browser
 *    would reject a credentialed cross-origin load even if we sent one.
 * A cookie gate would therefore not close a hole, it would blank out every
 * peer's avatar. Making it real needs signed, expiring URLs (or an
 * authenticated proxy route) — a design change, not a filter, and one that
 * fights the `immutable, max-age=365d` caching these URLs rely on.
 *
 * What DID change: the uuid is no longer handed out ACROSS THE TENANT BOUNDARY.
 * `POST /avatars/resolve` is tenant-scoped (api/routes/meAvatar.ts), so a
 * foreign tenant can no longer ask for the manifest that carries this URL, and
 * the room state only syncs a player to same-tenant clients
 * (rooms/lifecycle/tenantView.ts). The one channel that crosses tenants is the
 * NPC player, which that StateView deliberately exempts — hence NPCs may not
 * carry a `custom:` id at all (api/routes/npcs.ts, rooms/handlers/
 * avatarHandler.ts, rooms/lifecycle/onJoin.completion.ts). Enumerate the
 * channels before claiming a uuid is unreachable; the unguessable uuid is the
 * whole boundary rather than a fig leaf over an open endpoint — still weaker
 * than the DB-level isolation, and worth stating plainly.
 */
export function customSpriteUrl(uuid: string): string {
  return `/packs/avatars/custom/${uuid}.png`;
}

/** Preview URL for a custom avatar. Public, same caveat as `customSpriteUrl`. */
export function customPreviewUrl(uuid: string): string {
  return `/packs/avatars/custom/${uuid}_p.png`;
}

export async function writeCustomAvatarFiles(
  packsDir: string,
  uuid: string,
  sheetPng: Buffer,
  previewPng: Buffer,
): Promise<void> {
  if (!UUID_RE.test(uuid)) throw new Error('refusing to write custom avatar with non-uuid name');
  const dir = customAvatarDir(packsDir);
  await fs.promises.mkdir(dir, { recursive: true });
  await fs.promises.writeFile(path.resolve(dir, `${uuid}.png`), sheetPng);
  await fs.promises.writeFile(path.resolve(dir, `${uuid}_p.png`), previewPng);
}

/** Delete a custom avatar's sprite + preview (bounds disk use to ~2 files/user). */
export async function deleteCustomAvatarFiles(packsDir: string, uuid: string): Promise<void> {
  if (!UUID_RE.test(uuid)) return;
  const dir = customAvatarDir(packsDir);
  for (const name of [`${uuid}.png`, `${uuid}_p.png`]) {
    try {
      await fs.promises.rm(path.resolve(dir, name), { force: true });
    } catch (err) {
      logger.warn('[AvatarComposer] file cleanup failed (non-fatal)', { uuid, name, error: String(err) });
    }
  }
}

export interface CustomAvatarManifest {
  id: string;
  packUuid: 'custom';
  avatarKey: string;
  displayName: string;
  type: 'full';
  spriteUrl: string;
  frameWidth: number;
  frameHeight: number;
  states: Record<string, { directions: string[]; frameCount: number; frameRate: number; row: number }>;
  previewUrl: string;
}

/** Build the client-facing manifest for a stored custom avatar. */
export function buildCustomManifest(
  uuid: string,
  spriteUrl: string,
  previewUrl: string | null,
  format: SheetFormat,
  displayName: string,
): CustomAvatarManifest {
  const directions = ['down', 'left', 'right', 'up'];
  return {
    id: `custom:${uuid}`,
    packUuid: 'custom',
    avatarKey: uuid,
    displayName,
    type: 'full',
    spriteUrl,
    frameWidth: format.frame_w,
    frameHeight: format.frame_h,
    states: {
      idle: { directions, frameCount: 1, frameRate: 1, row: 0 },
      walk: { directions, frameCount: 4, frameRate: 8, row: 4 },
    },
    previewUrl: previewUrl ?? customPreviewUrl(uuid),
  };
}
