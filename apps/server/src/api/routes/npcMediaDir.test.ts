import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { npcMediaDir, npcMediaFilePath, registerNpcMediaStatic } from './npcMedia.js';

describe('one npc media directory for upload, serving and deletion', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    vi.unstubAllEnvs();
    for (const dir of tempDirs.splice(0)) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('defaults to the directory shared with the npc service', () => {
    vi.stubEnv('NPC_MEDIA_DIR', '');
    expect(npcMediaDir()).toBe('/data/npc-media');
  });

  it('serves npc media from the configured directory', async () => {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), 'npc-serve-case-'));
    tempDirs.push(base);
    vi.stubEnv('NPC_MEDIA_DIR', base);
    await fs.mkdir(path.join(base, 'acme', 'npc1'), { recursive: true });
    await fs.writeFile(path.join(base, 'acme', 'npc1', 'a.png'), 'sample');

    const app = express();
    registerNpcMediaStatic(app);
    const res = await request(app).get('/npc-media/acme/npc1/a.png');
    expect(res.status).toBe(200);
    expect(Buffer.isBuffer(res.body)).toBe(true);
    expect((res.body as Buffer).toString('utf8')).toBe('sample');
  });

  it('resolves npc media files below the same directory', async () => {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), 'npc-resolve-case-'));
    tempDirs.push(base);
    vi.stubEnv('NPC_MEDIA_DIR', base);
    expect(npcMediaFilePath('acme/npc1/a.png')).toBe(path.join(base, 'acme/npc1/a.png'));

    vi.stubEnv('NPC_MEDIA_DIR', '');
    expect(npcMediaDir()).toBe('/data/npc-media');
    expect(npcMediaFilePath('acme/npc1/a.png')).toBe(path.join(npcMediaDir(), 'acme/npc1/a.png'));
  });
});
