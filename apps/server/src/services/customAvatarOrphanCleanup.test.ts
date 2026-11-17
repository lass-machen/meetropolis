/**
 * Unit tests for D-517 custom-avatar orphan retirement + bounded cleanup.
 * Real temp files and a real express.static HTTP check; DB refs are injected.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CUSTOM_AVATAR_CLEANUP_BATCH_LIMIT,
  CUSTOM_AVATAR_RETENTION_MS,
  customAvatarRetirementsDir,
  registerRetiredCustomAvatar,
  runCustomAvatarOrphanCleanup,
  type CustomAvatarOrphanRefs,
} from './customAvatarOrphanCleanup.js';
import { customAvatarDir } from './avatarComposer.js';

const DAY_MS = 24 * 60 * 60 * 1000;

let packsDir: string;

beforeEach(async () => {
  packsDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'avatar-orphan-'));
  await fsp.mkdir(customAvatarDir(packsDir), { recursive: true });
});

afterEach(async () => {
  await fsp.rm(packsDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

async function writePair(uuid: string, contents = 'png'): Promise<void> {
  const dir = customAvatarDir(packsDir);
  await fsp.writeFile(path.join(dir, `${uuid}.png`), contents);
  await fsp.writeFile(path.join(dir, `${uuid}_p.png`), contents);
}

function pairExists(uuid: string): boolean {
  const dir = customAvatarDir(packsDir);
  return fs.existsSync(path.join(dir, `${uuid}.png`)) && fs.existsSync(path.join(dir, `${uuid}_p.png`));
}

function markerPath(uuid: string): string {
  return path.join(customAvatarRetirementsDir(packsDir), `${uuid}.json`);
}

async function readMarker(uuid: string): Promise<{ uuid: string; retiredAt: string }> {
  return JSON.parse(await fsp.readFile(markerPath(uuid), 'utf8')) as {
    uuid: string;
    retiredAt: string;
  };
}

function refs(opts: { present?: Iterable<string>; active?: Iterable<string> }): CustomAvatarOrphanRefs {
  const present = new Set(opts.present ?? []);
  const active = new Set(opts.active ?? []);
  return {
    listPresentCustomAvatarUuids: vi.fn((uuids: string[]) => {
      const out = new Set<string>();
      for (const u of uuids) if (present.has(u)) out.add(u);
      return Promise.resolve(out);
    }),
    isActivelyReferenced: vi.fn((uuid: string) => Promise.resolve(active.has(uuid))),
  };
}

describe('registerRetiredCustomAvatar', () => {
  it('writes uuid + retiredAt only and keeps the first retirement time', async () => {
    const uuid = '11111111-1111-4111-8111-111111111111';
    const t0 = new Date('2024-01-01T00:00:00.000Z');
    const t1 = new Date('2024-06-01T00:00:00.000Z');
    await registerRetiredCustomAvatar(packsDir, uuid, () => t0);
    const first = await readMarker(uuid);
    expect(first).toEqual({ uuid, retiredAt: t0.toISOString() });
    expect(Object.keys(first).sort()).toEqual(['retiredAt', 'uuid']);

    await registerRetiredCustomAvatar(packsDir, uuid, () => t1);
    expect(await readMarker(uuid)).toEqual(first);
  });

  it('ignores non-uuid names', async () => {
    await registerRetiredCustomAvatar(packsDir, '../etc/passwd', () => new Date());
    expect(fs.existsSync(customAvatarRetirementsDir(packsDir))).toBe(false);
  });
});

describe('runCustomAvatarOrphanCleanup', () => {
  it('removes both PNG files and the marker at the 365-day boundary', async () => {
    const uuid = '22222222-2222-4222-8222-222222222222';
    await writePair(uuid);
    const retiredAt = new Date('2023-01-01T00:00:00.000Z');
    await registerRetiredCustomAvatar(packsDir, uuid, () => retiredAt);
    const now = new Date(retiredAt.getTime() + CUSTOM_AVATAR_RETENTION_MS);
    const r = refs({ present: [], active: [] });
    const result = await runCustomAvatarOrphanCleanup({ packsDir, refs: r, now: () => now });
    expect(result.removed).toEqual([uuid]);
    expect(pairExists(uuid)).toBe(false);
    expect(fs.existsSync(markerPath(uuid))).toBe(false);
    expect(r.isActivelyReferenced).toHaveBeenCalledWith(uuid);
  });

  it('keeps files strictly under the 365-day window', async () => {
    const uuid = '33333333-3333-4333-8333-333333333333';
    await writePair(uuid);
    const retiredAt = new Date('2023-01-01T00:00:00.000Z');
    await registerRetiredCustomAvatar(packsDir, uuid, () => retiredAt);
    const now = new Date(retiredAt.getTime() + CUSTOM_AVATAR_RETENTION_MS - 1);
    const r = refs({ present: [], active: [] });
    const result = await runCustomAvatarOrphanCleanup({ packsDir, refs: r, now: () => now });
    expect(result.removed).toEqual([]);
    expect(pairExists(uuid)).toBe(true);
    expect(fs.existsSync(markerPath(uuid))).toBe(true);
    expect(r.isActivelyReferenced).not.toHaveBeenCalled();
  });

  it('keeps a due UUID that is still an active CustomAvatar', async () => {
    const uuid = '44444444-4444-4444-8444-444444444444';
    await writePair(uuid);
    const retiredAt = new Date('2022-01-01T00:00:00.000Z');
    await registerRetiredCustomAvatar(packsDir, uuid, () => retiredAt);
    const now = new Date(retiredAt.getTime() + CUSTOM_AVATAR_RETENTION_MS + DAY_MS);
    const r = refs({ present: [uuid], active: [uuid] });
    const result = await runCustomAvatarOrphanCleanup({ packsDir, refs: r, now: () => now });
    expect(result.removed).toEqual([]);
    expect(pairExists(uuid)).toBe(true);
    expect(fs.existsSync(markerPath(uuid))).toBe(true);
  });

  it('keeps a due UUID still referenced by User.avatarId', async () => {
    const uuid = '55555555-5555-4555-8555-555555555555';
    await writePair(uuid);
    const retiredAt = new Date('2022-01-01T00:00:00.000Z');
    await registerRetiredCustomAvatar(packsDir, uuid, () => retiredAt);
    const now = new Date(retiredAt.getTime() + CUSTOM_AVATAR_RETENTION_MS + DAY_MS);
    // present empty (no CustomAvatar row) but User.avatarId still points at it
    const r = refs({ present: [], active: [uuid] });
    const result = await runCustomAvatarOrphanCleanup({ packsDir, refs: r, now: () => now });
    expect(result.removed).toEqual([]);
    expect(pairExists(uuid)).toBe(true);
  });

  it('registers a legacy orphan with now and does not delete it in the same pass', async () => {
    const uuid = '66666666-6666-4666-8666-666666666666';
    await writePair(uuid);
    // Old mtime must not drive retention.
    const old = new Date('2015-01-01T00:00:00.000Z');
    const sheet = path.join(customAvatarDir(packsDir), `${uuid}.png`);
    const preview = path.join(customAvatarDir(packsDir), `${uuid}_p.png`);
    fs.utimesSync(sheet, old, old);
    fs.utimesSync(preview, old, old);

    const now = new Date('2024-06-01T12:00:00.000Z');
    const r = refs({ present: [], active: [] });
    const result = await runCustomAvatarOrphanCleanup({ packsDir, refs: r, now: () => now });
    expect(result.removed).toEqual([]);
    expect(pairExists(uuid)).toBe(true);
    const marker = await readMarker(uuid);
    expect(marker.retiredAt).toBe(now.toISOString());
    expect(r.isActivelyReferenced).not.toHaveBeenCalled();
  });

  it('does not re-register an active CustomAvatar as an orphan', async () => {
    const uuid = '77777777-7777-4777-8777-777777777777';
    await writePair(uuid);
    const now = new Date('2024-06-01T12:00:00.000Z');
    const r = refs({ present: [uuid], active: [uuid] });
    await runCustomAvatarOrphanCleanup({ packsDir, refs: r, now: () => now });
    expect(fs.existsSync(markerPath(uuid))).toBe(false);
  });

  it('caps removals at the batch limit per run', async () => {
    const retiredAt = new Date('2020-01-01T00:00:00.000Z');
    const now = new Date(retiredAt.getTime() + CUSTOM_AVATAR_RETENTION_MS + DAY_MS);
    const uuids: string[] = [];
    for (let i = 0; i < CUSTOM_AVATAR_CLEANUP_BATCH_LIMIT + 5; i++) {
      const uuid = `88888888-8888-4888-8888-${String(i).padStart(12, '0')}`;
      uuids.push(uuid);
      await writePair(uuid);
      await registerRetiredCustomAvatar(packsDir, uuid, () => retiredAt);
    }
    const r = refs({ present: [], active: [] });
    const result = await runCustomAvatarOrphanCleanup({ packsDir, refs: r, now: () => now });
    expect(result.removed).toHaveLength(CUSTOM_AVATAR_CLEANUP_BATCH_LIMIT);
    const remainingMarkers = (await fsp.readdir(customAvatarRetirementsDir(packsDir))).filter((n) =>
      n.endsWith('.json'),
    );
    expect(remainingMarkers).toHaveLength(5);
  }, 20_000);

  it('never deletes invalid names or symlinked avatar files', async () => {
    const uuid = '99999999-9999-4999-8999-999999999999';
    const dir = customAvatarDir(packsDir);
    const target = path.join(packsDir, 'outside.png');
    await fsp.writeFile(target, 'secret');
    await fsp.symlink(target, path.join(dir, `${uuid}.png`));
    await fsp.writeFile(path.join(dir, `${uuid}_p.png`), 'preview');
    const retiredAt = new Date('2020-01-01T00:00:00.000Z');
    await registerRetiredCustomAvatar(packsDir, uuid, () => retiredAt);

    const evilDir = customAvatarRetirementsDir(packsDir);
    await fsp.mkdir(evilDir, { recursive: true });
    await fsp.writeFile(path.join(evilDir, 'not-a-uuid.json'), '{"uuid":"x","retiredAt":"2020-01-01T00:00:00.000Z"}');
    await fsp.writeFile(path.join(dir, 'nope.png'), 'x');
    await fsp.writeFile(path.join(dir, 'nope_p.png'), 'x');

    const now = new Date(retiredAt.getTime() + CUSTOM_AVATAR_RETENTION_MS + DAY_MS);
    const r = refs({ present: [], active: [] });
    await runCustomAvatarOrphanCleanup({ packsDir, refs: r, now: () => now });

    expect(fs.existsSync(target)).toBe(true);
    expect(fs.lstatSync(path.join(dir, `${uuid}.png`)).isSymbolicLink()).toBe(true);
    expect(fs.existsSync(path.join(dir, `${uuid}_p.png`))).toBe(true);
    expect(fs.existsSync(markerPath(uuid))).toBe(true);
    expect(fs.existsSync(path.join(evilDir, 'not-a-uuid.json'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'nope.png'))).toBe(true);
  });
});

describe('express.static retirement metadata', () => {
  it('serves a normal PNG with 200 and rejects the dot retirement file with 404', async () => {
    const uuid = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    await writePair(uuid, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString('binary'));
    await registerRetiredCustomAvatar(packsDir, uuid, () => new Date('2024-01-01T00:00:00.000Z'));

    const app = express();
    app.use(
      '/packs',
      express.static(packsDir, {
        maxAge: '365d',
        immutable: true,
      }),
    );

    await request(app).get(`/packs/avatars/custom/${uuid}.png`).expect(200);
    await request(app).get(`/packs/.custom-avatar-retirements/${uuid}.json`).expect(404);
  });
});
