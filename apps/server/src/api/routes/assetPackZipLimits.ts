import type { Readable } from 'node:stream';
import type { ZipEntry } from '../../types/assetPack.js';

export interface AssetPackZipLimits {
  maxEntries: number;
  maxUnpackedBytes: number;
}

export const ASSET_PACK_ZIP_LIMITS: AssetPackZipLimits = Object.freeze({
  maxEntries: 5000,
  maxUnpackedBytes: 200 * 1024 * 1024,
});

export class AssetPackTooLargeError extends Error {
  constructor() {
    super('asset_pack_too_large');
    this.name = 'AssetPackTooLargeError';
  }
}

/** Remaining unpacked bytes for one upload, shared by config.json and every asset. */
export interface UnpackBudget {
  remaining: number;
}

export function createUnpackBudget(limits: AssetPackZipLimits = ASSET_PACK_ZIP_LIMITS): UnpackBudget {
  return { remaining: limits.maxUnpackedBytes };
}

/** Checks entry count and declared unpacked size from the ZIP metadata, before anything is unpacked. */
export function checkDeclaredZipSize(entries: ZipEntry[], limits: AssetPackZipLimits = ASSET_PACK_ZIP_LIMITS): boolean {
  if (entries.length > limits.maxEntries) return false;
  let declared = 0;
  for (const entry of entries) {
    declared += Math.max(0, entry.uncompressedSize ?? 0);
    if (declared > limits.maxUnpackedBytes) return false;
  }
  return true;
}

/**
 * Unpacks one entry while counting the bytes it really produces, because the
 * declared sizes in the ZIP metadata can lie. Stops as soon as the shared
 * budget is exhausted.
 */
export async function readZipEntryBounded(entry: ZipEntry, budget: UnpackBudget): Promise<Buffer> {
  if (!entry.stream) {
    const content = await entry.buffer();
    if (content.length > budget.remaining) throw new AssetPackTooLargeError();
    budget.remaining -= content.length;
    return content;
  }
  const stream = entry.stream() as Readable;
  const chunks: Buffer[] = [];
  try {
    for await (const chunk of stream) {
      const bytes = typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer);
      if (bytes.length > budget.remaining) throw new AssetPackTooLargeError();
      budget.remaining -= bytes.length;
      chunks.push(bytes);
    }
  } catch (error) {
    stream.destroy();
    throw error;
  }
  return Buffer.concat(chunks);
}
