/**
 * Unit tests for the server-side avatar compositing service: catalog load,
 * deterministic config hashing, PNG encode (full sheet + preview), the
 * ~2-files-per-user lifecycle and the feature flag. Pixel parity with the
 * Python reference is covered by the shared package's golden test.
 */
import os from 'os';
import path from 'path';
import fs from 'fs';
import { PNG } from 'pngjs';
import { describe, it, expect, afterEach } from 'vitest';
import { vi } from 'vitest';

vi.mock('../logger.js', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import {
  avatarEditorEnabled,
  composeAvatar,
  configHashHex,
  customAvatarDir,
  deleteCustomAvatarFiles,
  loadSpriteCatalog,
  writeCustomAvatarFiles,
} from './avatarComposer.js';
import type { AvatarConfig } from '@meetropolis/shared';

const catalog = loadSpriteCatalog();
const base: AvatarConfig = {
  skin: 'light',
  hair: 'messy',
  hair_color: 'braun',
  outfit: 'trousers',
  top: 'shirt_white',
  pants: 'dark',
  shoes: 'black',
};
const UUID = '11111111-2222-4333-8444-555555555555';

describe('loadSpriteCatalog', () => {
  it('loads and schema-asserts the v5 catalog', () => {
    expect(catalog.schema).toBe('meetropolis-sprite-catalog/v5');
  });
});

describe('configHashHex', () => {
  it('is deterministic and stable across equivalent (canonicalizable) configs', () => {
    const a = configHashHex(catalog, base);
    const b = configHashHex(catalog, { ...base });
    expect(a).toBe(b);
    // pants are ignored under a dress -> two dress configs differing only in
    // pants must hash the same.
    const dressA: AvatarConfig = { ...base, outfit: 'dress', pants: 'dark' };
    const dressB: AvatarConfig = { ...base, outfit: 'dress', pants: 'navy' };
    expect(configHashHex(catalog, dressA)).toBe(configHashHex(catalog, dressB));
  });
  it('changes when the visible appearance changes', () => {
    expect(configHashHex(catalog, base)).not.toBe(configHashHex(catalog, { ...base, hair: 'bald' }));
  });
});

describe('composeAvatar', () => {
  it('produces a 128x256 sheet PNG and a 32x32 preview PNG', () => {
    const { sheetPng, previewPng } = composeAvatar(catalog, base);
    const sheet = PNG.sync.read(sheetPng);
    const preview = PNG.sync.read(previewPng);
    expect([sheet.width, sheet.height]).toEqual([128, 256]);
    expect([preview.width, preview.height]).toEqual([32, 32]);
    // The front-idle preview is the top-left cell of the sheet.
    expect(Array.from(preview.data.subarray(0, 4))).toEqual(Array.from(sheet.data.subarray(0, 4)));
  });
});

describe('file lifecycle', () => {
  const packsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'meavatar-'));
  afterEach(() => fs.rmSync(packsDir, { recursive: true, force: true }));

  it('writes then deletes a custom avatar sprite + preview', async () => {
    const { sheetPng, previewPng } = composeAvatar(catalog, base);
    await writeCustomAvatarFiles(packsDir, UUID, sheetPng, previewPng);
    const dir = customAvatarDir(packsDir);
    expect(fs.existsSync(path.join(dir, `${UUID}.png`))).toBe(true);
    expect(fs.existsSync(path.join(dir, `${UUID}_p.png`))).toBe(true);
    await deleteCustomAvatarFiles(packsDir, UUID);
    expect(fs.existsSync(path.join(dir, `${UUID}.png`))).toBe(false);
    expect(fs.existsSync(path.join(dir, `${UUID}_p.png`))).toBe(false);
  });

  it('refuses to write a non-uuid filename (traversal guard)', async () => {
    await expect(writeCustomAvatarFiles(packsDir, '../evil', Buffer.from(''), Buffer.from(''))).rejects.toThrow();
  });
});

describe('avatarEditorEnabled', () => {
  const original = process.env.AVATAR_EDITOR_ENABLED;
  afterEach(() => {
    if (original === undefined) delete process.env.AVATAR_EDITOR_ENABLED;
    else process.env.AVATAR_EDITOR_ENABLED = original;
  });
  it('defaults OFF and accepts common truthy spellings', () => {
    delete process.env.AVATAR_EDITOR_ENABLED;
    expect(avatarEditorEnabled()).toBe(false);
    for (const v of ['true', '1', 'on', 'YES']) {
      process.env.AVATAR_EDITOR_ENABLED = v;
      expect(avatarEditorEnabled()).toBe(true);
    }
    process.env.AVATAR_EDITOR_ENABLED = 'false';
    expect(avatarEditorEnabled()).toBe(false);
  });
});
