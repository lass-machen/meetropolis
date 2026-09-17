/**
 * Re-render stored custom avatars into the active catalog/renderer generation.
 * Dry-run is the default. Pass --apply only after deploying the matching code.
 *
 *   npm -w @meetropolis/server run avatar:rerender
 *   npm -w @meetropolis/server run avatar:rerender -- --apply
 */
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import { canonicalConfig, validateConfig, type AvatarConfig } from '@meetropolis/shared';
import { createPrismaClient } from '../db.js';
import type { PrismaClient } from '../generated/prisma/index.js';
import {
  composeAvatar,
  configHashHex,
  customAvatarPacksDir,
  customPreviewUrl,
  customSpriteUrl,
  loadSpriteCatalog,
  writeCustomAvatarFiles,
} from '../services/avatarComposer.js';

export interface RerenderSummary {
  unchanged: number;
  pending: number;
  updated: number;
  invalid: number;
}

function jsonConfig(config: AvatarConfig): Record<string, string> {
  return Object.fromEntries(
    Object.entries(config).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
}

export async function rerenderCustomAvatars(
  prisma: PrismaClient,
  packsDir: string,
  apply: boolean,
  log: (message: string) => void = console.log,
): Promise<RerenderSummary> {
  const catalog = loadSpriteCatalog();
  const rows = await prisma.customAvatar.findMany({ orderBy: { id: 'asc' } });
  const summary: RerenderSummary = { unchanged: 0, pending: 0, updated: 0, invalid: 0 };

  for (const row of rows) {
    const config = row.config as AvatarConfig;
    const canonical = canonicalConfig(catalog, config);
    const validation = validateConfig(catalog, canonical);
    if (!validation.ok) {
      summary.invalid++;
      log(`${row.userId}: INVALID (${validation.errors.join(', ')})`);
      continue;
    }
    const configHash = configHashHex(catalog, canonical);
    if (row.configHash === configHash) {
      summary.unchanged++;
      log(`${row.userId}: unchanged`);
      continue;
    }
    summary.pending++;
    if (!apply) {
      log(`${row.userId}: would render ${row.uuid} -> new uuid`);
      continue;
    }

    const uuid = crypto.randomUUID();
    const { sheetPng, previewPng } = composeAvatar(catalog, canonical);
    await writeCustomAvatarFiles(packsDir, uuid, sheetPng, previewPng);
    const spriteUrl = customSpriteUrl(uuid);
    const previewUrl = customPreviewUrl(uuid);
    await prisma.$transaction([
      prisma.customAvatar.update({
        where: { id: row.id },
        data: {
          uuid,
          config: jsonConfig(canonical),
          configHash,
          spriteUrl,
          previewUrl,
        },
      }),
      prisma.user.update({ where: { id: row.userId }, data: { avatarId: `custom:${uuid}` } }),
    ]);
    summary.updated++;
    log(`${row.userId}: rendered ${row.uuid} -> ${uuid}`);
  }
  return summary;
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const prisma = createPrismaClient();
  try {
    console.log(`Custom avatar rerender: ${apply ? 'APPLY' : 'DRY-RUN'}.`);
    const summary = await rerenderCustomAvatars(prisma, customAvatarPacksDir(), apply);
    console.log(JSON.stringify(summary));
    if (summary.invalid > 0) process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) await main();
