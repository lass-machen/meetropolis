import fsp from 'node:fs/promises';
import path from 'node:path';

const PACK_UUID_PATTERN = /^[a-zA-Z0-9_-]+$/;
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type GenerationRef = { kind: 'keep'; id: string } | { kind: 'ignore' } | { kind: 'unsafe' };

function assertSafePackUuid(packUuid: string): void {
  if (!PACK_UUID_PATTERN.test(packUuid)) {
    throw new Error('invalid asset pack uuid');
  }
}

function isUuidV4(value: string): boolean {
  return UUID_V4_PATTERN.test(value);
}

function hasDotOrTraversal(segments: string[]): boolean {
  return segments.some((segment) => segment === '.' || segment === '..');
}

function pathnameOfReference(rawUrl: string): string | null {
  try {
    if (/^https?:\/\//i.test(rawUrl)) {
      return new URL(rawUrl).pathname;
    }
    return rawUrl;
  } catch {
    return null;
  }
}

/** Interpret one reference URL for this pack (fail-closed on unsafe pack-owned paths). */
function interpretReferencedGeneration(packUuid: string, rawUrl: string): GenerationRef {
  const pathname = pathnameOfReference(rawUrl);
  if (pathname === null || !pathname.startsWith('/')) {
    return { kind: 'ignore' };
  }

  const rawSegments = pathname.split('/');
  const looksPackOwned = rawSegments.length >= 3 && rawSegments[1] === 'packs' && rawSegments[2] === packUuid;
  if (looksPackOwned && hasDotOrTraversal(rawSegments)) {
    return rawSegments.includes('generations') ? { kind: 'unsafe' } : { kind: 'ignore' };
  }

  const segments = rawSegments.filter((part) => part !== '');
  if (segments.length < 3 || segments[0] !== 'packs' || segments[1] !== packUuid) {
    return { kind: 'ignore' };
  }
  if (segments[2] !== 'generations') {
    return { kind: 'ignore' };
  }
  if (segments.length < 4 || !isUuidV4(segments[3])) {
    return { kind: 'unsafe' };
  }
  return { kind: 'keep', id: segments[3] };
}

function collectKeepGenerations(
  packUuid: string,
  currentGeneration: string | null,
  referencedUrls: Iterable<string>,
): Set<string> | null {
  const keep = new Set<string>();
  if (currentGeneration !== null && isUuidV4(currentGeneration)) {
    keep.add(currentGeneration);
  }
  for (const url of referencedUrls) {
    const interpreted = interpretReferencedGeneration(packUuid, url);
    if (interpreted.kind === 'unsafe') {
      return null;
    }
    if (interpreted.kind === 'keep') {
      keep.add(interpreted.id);
    }
  }
  return keep;
}

async function readGenerationsEntries(generationsDir: string): Promise<string[] | null> {
  let generationsStat;
  try {
    generationsStat = await fsp.lstat(generationsDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
  if (generationsStat.isSymbolicLink() || !generationsStat.isDirectory()) {
    return null;
  }
  try {
    return await fsp.readdir(generationsDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

async function removeGenerationDir(packsDir: string, generationsDir: string, name: string): Promise<boolean> {
  const candidate = path.resolve(generationsDir, name);
  if (!candidate.startsWith(generationsDir + path.sep)) {
    return false;
  }
  let candidateStat;
  try {
    candidateStat = await fsp.lstat(candidate);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false;
    }
    throw error;
  }
  if (candidateStat.isSymbolicLink() || !candidateStat.isDirectory()) {
    return false;
  }
  if (path.dirname(candidate) !== generationsDir) {
    return false;
  }
  const resolvedPacksDir = path.resolve(packsDir);
  if (!generationsDir.startsWith(resolvedPacksDir + path.sep)) {
    return false;
  }
  try {
    await fsp.rm(candidate, { recursive: true, force: false });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false;
    }
    throw error;
  }
  return true;
}

export async function cleanupAssetPackGenerations(
  packsDir: string,
  packUuid: string,
  currentGeneration: string | null,
  referencedUrls: Iterable<string>,
): Promise<string[]> {
  assertSafePackUuid(packUuid);

  const keep = collectKeepGenerations(packUuid, currentGeneration, referencedUrls);
  if (keep === null) {
    return [];
  }

  const generationsDir = path.resolve(packsDir, packUuid, 'generations');
  const entries = await readGenerationsEntries(generationsDir);
  if (entries === null) {
    return [];
  }

  const removed: string[] = [];
  for (const name of entries) {
    if (!isUuidV4(name) || keep.has(name)) {
      continue;
    }
    if (await removeGenerationDir(packsDir, generationsDir, name)) {
      removed.push(name);
    }
  }
  return removed;
}
