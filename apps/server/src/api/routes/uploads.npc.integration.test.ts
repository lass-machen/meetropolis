import crypto from 'node:crypto';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createHttpFixture } from '../../../test/fixtures/httpFixture.js';
import { uploadTransport, writeBytes } from '../../../test/fixtures/uploadFixture.js';
import { registerNpcMediaRoutes } from './npcMedia.js';
import { errorHandler } from '../errorHandler.js';

const fixture = createHttpFixture();
const app = fixture.app();
let directory = '';
const previous = process.env.NPC_MEDIA_DIR;
beforeAll(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'npc-media-upload-fixture-'));
  process.env.NPC_MEDIA_DIR = directory;
  registerNpcMediaRoutes(app, fixture.prisma);
  app.use(errorHandler);
});
afterAll(async () => {
  await fixture.close();
  if (directory) await rm(directory, { recursive: true, force: true });
  if (previous === undefined) delete process.env.NPC_MEDIA_DIR;
  else process.env.NPC_MEDIA_DIR = previous;
});

it('detects audio with forged headers and split magic bytes before the 25 MiB limit', async () => {
  const { tenant } = await fixture.tenant();
  const owner = await fixture.caller(tenant, 'owner');
  const npc = await fixture.prisma.npc.create({
    data: { tenantId: tenant.id, identity: crypto.randomUUID(), name: 'Upload fixture' },
  });
  const transport = await uploadTransport(app);
  const { req, result } = transport.open(`/npcs/${npc.id}/media`, {
    'X-Tenant': tenant.slug,
    Authorization: `Bearer ${owner.apiToken}`,
    'Content-Type': 'multipart/form-data; boundary=fixture-npc',
  });
  try {
    await transport.ready(1);
    req.write(
      '--fixture-npc\r\nContent-Disposition: form-data; name="file"; filename="audio.wav"\r\nContent-Type: video/mp4\r\n\r\n',
    );
    req.write('R');
    req.write('IFF');
    await writeBytes(req, 25 * 1024 * 1024 - 4 + 1, 0);
    req.end('\r\n--fixture-npc--\r\n');
    expect((await result).status).toBe(413);
    expect(await fixture.prisma.npcMediaFile.count({ where: { npcId: npc.id } })).toBe(0);
    expect(await readdir(directory)).toHaveLength(0);
  } finally {
    req.destroy();
    await transport.close();
  }
}, 60_000);
