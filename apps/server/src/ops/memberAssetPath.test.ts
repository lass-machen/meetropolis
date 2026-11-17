/**
 * Path checks for member-served files: shape only, no authorization.
 *
 * Covers parseMemberAssetPath (URL remainder after the namespace) and
 * resolveFileInRoot (realpath containment inside a root directory).
 */
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseMemberAssetPath, resolveFileInRoot } from './memberAssetPath.js';

const PACK_UUID = '123e4567-e89b-12d3-a456-426614174000';
const AVATAR_UUID = '123e4567-e89b-12d3-a456-426614174001';

let dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.map((dir) => fs.rm(dir, { recursive: true, force: true })));
  dirs = [];
});

async function makeRoot(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(tmpdir(), 'member-asset-'));
  dirs.push(dir);
  return dir;
}

describe('parseMemberAssetPath packs', () => {
  it('parses an asset-pack file', () => {
    expect(parseMemberAssetPath('packs', `${PACK_UUID}/tiles/grass.ab12.png`)).toEqual({
      kind: 'asset-pack',
      packUuid: PACK_UUID,
      relativePath: `${PACK_UUID}/tiles/grass.ab12.png`,
    });
  });

  it('parses a nested generation file and scopes it by the first pack segment', () => {
    const generation = '123e4567-e89b-12d3-a456-426614174002';
    expect(parseMemberAssetPath('packs', `${PACK_UUID}/generations/${generation}/tiles/grass.png`)).toEqual({
      kind: 'asset-pack',
      packUuid: PACK_UUID,
      relativePath: `${PACK_UUID}/generations/${generation}/tiles/grass.png`,
    });
  });

  it('rejects traversal out of a generation directory', () => {
    for (const raw of [
      `${PACK_UUID}/generations/../other.png`,
      `${PACK_UUID}/generations/%2e%2e/other.png`,
      `${PACK_UUID}/generations/..%2fother.png`,
      `${PACK_UUID}/generations/%252e%252e/other.png`,
      `${PACK_UUID}/%2e%2e/123e4567-e89b-12d3-a456-426614174009/file.png`,
      `${PACK_UUID}/generations/%2E/file.png`,
      `${PACK_UUID}/%2ehidden/file.png`,
    ]) {
      expect(parseMemberAssetPath('packs', raw)).toBeNull();
    }
  });

  it('parses an avatar-pack sprite', () => {
    expect(parseMemberAssetPath('packs', `avatars/${PACK_UUID}/ab12cd34.png`)).toEqual({
      kind: 'avatar-pack',
      packUuid: PACK_UUID,
      relativePath: `avatars/${PACK_UUID}/ab12cd34.png`,
    });
  });

  it('parses custom-avatar sprite and preview variants', () => {
    expect(parseMemberAssetPath('packs', `avatars/custom/${AVATAR_UUID}.png`)).toEqual({
      kind: 'custom-avatar',
      avatarUuid: AVATAR_UUID,
      variant: 'sprite',
      relativePath: `avatars/custom/${AVATAR_UUID}.png`,
    });
    expect(parseMemberAssetPath('packs', `avatars/custom/${AVATAR_UUID}_p.png`)).toEqual({
      kind: 'custom-avatar',
      avatarUuid: AVATAR_UUID,
      variant: 'preview',
      relativePath: `avatars/custom/${AVATAR_UUID}_p.png`,
    });
  });

  it('parses an avatar-pack key with the upload charset', () => {
    expect(parseMemberAssetPath('packs', 'avatars/my-pack_01/x.png')).toEqual({
      kind: 'avatar-pack',
      packUuid: 'my-pack_01',
      relativePath: 'avatars/my-pack_01/x.png',
    });
  });

  it('rejects malformed packs paths', () => {
    const bad = [
      '',
      '../x',
      'a/../b',
      '%2e%2e/x',
      '%252e%252e/x',
      'a%2Fb/c',
      '.hidden/x',
      'x\\y',
      '%00',
      'avatars/custom/notauuid.png',
      `avatars/${PACK_UUID}`,
      'notauuid/file.png',
      'avatars/bad.key/x.png',
      '%E0%A4%A',
    ];
    for (const raw of bad) {
      expect(parseMemberAssetPath('packs', raw), raw).toBeNull();
    }
  });
});

describe('parseMemberAssetPath npc-media', () => {
  it('parses a three-segment storage path', () => {
    expect(parseMemberAssetPath('npc-media', 'tenant-slug/npc-id/ab12cd34ef56.png')).toEqual({
      kind: 'npc-media',
      storagePath: 'tenant-slug/npc-id/ab12cd34ef56.png',
      relativePath: 'tenant-slug/npc-id/ab12cd34ef56.png',
    });
  });

  it('rejects wrong segment counts and traversal', () => {
    const bad = ['a/b', 'a/b/c/d', '', '../x'];
    for (const raw of bad) {
      expect(parseMemberAssetPath('npc-media', raw), raw).toBeNull();
    }
  });
});

describe('resolveFileInRoot', () => {
  it('resolves an existing file to its real path', async () => {
    const root = await makeRoot();
    await fs.mkdir(path.join(root, 'sub'), { recursive: true });
    await fs.writeFile(path.join(root, 'sub', 'f.png'), 'png');
    const resolved = await resolveFileInRoot(root, 'sub/f.png');
    expect(resolved).toBe(path.join(root, 'sub', 'f.png'));
  });

  it('returns null for a missing file', async () => {
    const root = await makeRoot();
    expect(await resolveFileInRoot(root, 'nope.png')).toBeNull();
  });

  it('returns null for a directory', async () => {
    const root = await makeRoot();
    await fs.mkdir(path.join(root, 'sub'));
    expect(await resolveFileInRoot(root, 'sub')).toBeNull();
  });

  it('returns null for a symlink escaping the root', async () => {
    const root = await makeRoot();
    const outside = await makeRoot();
    await fs.writeFile(path.join(outside, 'secret.png'), 'png');
    await fs.symlink(path.join(outside, 'secret.png'), path.join(root, 'link.png'));
    expect(await resolveFileInRoot(root, 'link.png')).toBeNull();
  });

  it('resolves a symlink pointing inside the root', async () => {
    const root = await makeRoot();
    await fs.writeFile(path.join(root, 'real.png'), 'png');
    await fs.symlink(path.join(root, 'real.png'), path.join(root, 'link.png'));
    expect(await resolveFileInRoot(root, 'link.png')).toBe(path.join(root, 'real.png'));
  });
});
