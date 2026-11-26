import path from 'node:path';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { npcMediaDir } from '../api/routes/npcMedia.js';
import { removeTenantFiles, tenantNpcMediaDir } from './tenantFiles.js';

describe('tenant file cleanup resolves the NPC media directory like the NPC media routes', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('uses the routes default when NPC_MEDIA_DIR is not set', () => {
    vi.stubEnv('NPC_MEDIA_DIR', '');
    expect(tenantNpcMediaDir('acme')).toBe(path.join(npcMediaDir(), 'acme'));
  });

  it('uses NPC_MEDIA_DIR when it is set', () => {
    vi.stubEnv('NPC_MEDIA_DIR', '/tmp/npc-media-case');
    expect(npcMediaDir()).toBe('/tmp/npc-media-case');
    expect(tenantNpcMediaDir('acme')).toBe(path.join('/tmp/npc-media-case', 'acme'));
  });

  it('refuses a slug that leaves the directory', () => {
    vi.stubEnv('NPC_MEDIA_DIR', '/tmp/npc-media-case');
    expect(tenantNpcMediaDir('../decoy-case')).toBeNull();
  });
});

describe('tenant file cleanup removes avatar-pack sprites, not catalogue packs', () => {
  const avatarPackUuid = '123e4567-e89b-12d3-a456-426614174000';

  it('removes packs/avatars/<uuid> for a deleted tenant avatar pack', async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'tenant-avatar-case-'));
    const packsDir = path.join(root, 'packs');
    const spriteDir = path.join(packsDir, 'avatars', avatarPackUuid);
    const foreignDir = path.join(packsDir, avatarPackUuid);
    await fsp.mkdir(spriteDir, { recursive: true });
    await fsp.writeFile(path.join(spriteDir, 'sprite.png'), 'sprite-bytes');
    await fsp.mkdir(foreignDir, { recursive: true });
    await fsp.writeFile(path.join(foreignDir, 'global-asset.txt'), 'global');
    vi.stubEnv('ASSET_PACKS_DIR', packsDir);
    vi.stubEnv('NPC_MEDIA_DIR', path.join(root, 'npc-media'));
    try {
      await removeTenantFiles({
        tenantSlug: 'acme-fixture',
        assetPackUuids: [],
        avatarPackUuids: [avatarPackUuid],
        customAvatarUuids: [],
        npcIds: [],
      });
      await expect(fsp.stat(spriteDir)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      vi.unstubAllEnvs();
      if (root.startsWith(os.tmpdir() + path.sep)) {
        await fsp.rm(root, { recursive: true, force: true });
      }
    }
  });

  it('keeps packs/<uuid> catalogue assets untouched by avatar-pack cleanup', async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'tenant-catalogue-case-'));
    const packsDir = path.join(root, 'packs');
    const spriteDir = path.join(packsDir, 'avatars', avatarPackUuid);
    const foreignDir = path.join(packsDir, avatarPackUuid);
    await fsp.mkdir(spriteDir, { recursive: true });
    await fsp.writeFile(path.join(spriteDir, 'sprite.png'), 'sprite-bytes');
    await fsp.mkdir(foreignDir, { recursive: true });
    await fsp.writeFile(path.join(foreignDir, 'global-asset.txt'), 'global');
    vi.stubEnv('ASSET_PACKS_DIR', packsDir);
    vi.stubEnv('NPC_MEDIA_DIR', path.join(root, 'npc-media'));
    try {
      await removeTenantFiles({
        tenantSlug: 'acme-fixture',
        assetPackUuids: [],
        avatarPackUuids: [avatarPackUuid],
        customAvatarUuids: [],
        npcIds: [],
      });
      await expect(fsp.stat(foreignDir).then((s) => s.isDirectory())).resolves.toBe(true);
      await expect(fsp.readFile(path.join(foreignDir, 'global-asset.txt'), 'utf8')).resolves.toBe('global');
    } finally {
      vi.unstubAllEnvs();
      if (root.startsWith(os.tmpdir() + path.sep)) {
        await fsp.rm(root, { recursive: true, force: true });
      }
    }
  });
});
