import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import type { ExcludedModel, ExportRow, TenantExportSink } from './types.js';

/** Failure of the tenant export with a stable machine-readable code. */
export class TenantExportError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'TenantExportError';
  }
}

const SEGMENT_PATTERN = /^[A-Za-z0-9._-]+$/;

/** Validates a POSIX relative path and resolves it below `root`. */
function resolveExportPath(root: string, relPath: string): string {
  if (relPath.length === 0 || relPath.startsWith('/')) {
    throw new TenantExportError('unsafe_path');
  }
  const segments = relPath.split('/');
  const valid = segments.every(
    (segment) => segment.length > 0 && segment !== '.' && segment !== '..' && SEGMENT_PATTERN.test(segment),
  );
  if (!valid) {
    throw new TenantExportError('unsafe_path');
  }
  const resolved = path.resolve(root, ...segments);
  const relative = path.relative(root, resolved);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new TenantExportError('unsafe_path');
  }
  return resolved;
}

/**
 * Creates the export directory with mode 0700. An existing directory must be
 * empty, otherwise the export aborts with `output_not_empty`.
 */
export async function prepareExportDir(outDir: string): Promise<void> {
  // Check before touching anything, so a mistyped path never changes an existing directory.
  try {
    const entries = await fsp.readdir(outDir);
    if (entries.length > 0) {
      throw new TenantExportError('output_not_empty');
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  await fsp.mkdir(outDir, { recursive: true, mode: 0o700 });
  await fsp.chmod(outDir, 0o700);
}

/** Tenant and map identities written into `manifest.json`. */
export interface ManifestHead {
  exportedAt: string;
  tenant: { id: string; slug: string; name: string };
  enterprise: boolean;
  maps: readonly { id: string; name: string; file: string }[];
  tilesetsNotFound: readonly string[];
}

/** Totals returned by `finalize`. */
export interface ExportTotals {
  tables: number;
  rows: number;
  files: number;
  missing: number;
}

interface TableEntry {
  model: string;
  file: string;
  rows: number;
  omittedFields: readonly string[];
}

/** Normalizes a stream failure into an Error for promise rejection. */
function asStreamError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

/** Streams rows as a JSON array without buffering them all in memory. */
async function streamJsonArray(target: string, rows: AsyncIterable<ExportRow> | Iterable<ExportRow>): Promise<number> {
  let count = 0;
  const stream = createWriteStream(target, { mode: 0o600 });
  const write = (chunk: string): Promise<void> => {
    if (stream.write(chunk)) return Promise.resolve();
    return new Promise((resolve, reject) => {
      stream.once('drain', () => resolve());
      stream.once('error', (error: unknown) => reject(asStreamError(error)));
    });
  };
  try {
    await write('[\n');
    for await (const row of rows) {
      if (count > 0) await write(',\n');
      await write(`${JSON.stringify(row)}\n`);
      count += 1;
    }
    await write(']\n');
  } catch (error) {
    stream.destroy();
    throw error;
  }
  await new Promise<void>((resolve, reject) => {
    stream.once('error', (error: unknown) => reject(asStreamError(error)));
    stream.end(() => resolve());
  });
  return count;
}

/** Hashes one file by streaming it, never loading it fully into memory. */
async function hashFile(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  const stream = createReadStream(filePath);
  await new Promise<void>((resolve, reject) => {
    stream.on('data', (chunk: Buffer | string) => hash.update(chunk));
    stream.once('error', (error: unknown) => reject(asStreamError(error)));
    stream.once('end', () => resolve());
  });
  return hash.digest('hex');
}

/** Mutable state behind one export sink. */
interface ExportSinkState {
  root: string;
  written: string[];
  missing: string[];
  tables: TableEntry[];
  excluded: Record<string, string>;
  copied: number;
}

async function ensureParentDir(resolved: string): Promise<void> {
  await fsp.mkdir(path.dirname(resolved), { recursive: true, mode: 0o700 });
}

async function writeJsonRowsInto(
  state: ExportSinkState,
  relPath: string,
  rows: AsyncIterable<ExportRow> | Iterable<ExportRow>,
): Promise<number> {
  const resolved = resolveExportPath(state.root, relPath);
  await ensureParentDir(resolved);
  const count = await streamJsonArray(resolved, rows);
  await fsp.chmod(resolved, 0o600);
  state.written.push(relPath);
  return count;
}

async function writeTextInto(state: ExportSinkState, relPath: string, content: string): Promise<void> {
  const resolved = resolveExportPath(state.root, relPath);
  await ensureParentDir(resolved);
  await fsp.writeFile(resolved, content, { encoding: 'utf8', mode: 0o600 });
  await fsp.chmod(resolved, 0o600);
  state.written.push(relPath);
}

async function copyFileInto(state: ExportSinkState, relPath: string, sourcePath: string): Promise<boolean> {
  const resolved = resolveExportPath(state.root, relPath);
  await ensureParentDir(resolved);
  try {
    await fsp.copyFile(sourcePath, resolved);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      state.missing.push(relPath);
      return false;
    }
    throw error;
  }
  await fsp.chmod(resolved, 0o600);
  state.copied += 1;
  state.written.push(relPath);
  return true;
}

function buildManifestDocument(state: ExportSinkState, head: ManifestHead): Record<string, unknown> {
  return {
    format: 'meetropolis-tenant-export',
    formatVersion: 1,
    exportedAt: head.exportedAt,
    tenant: { ...head.tenant },
    enterprise: head.enterprise,
    tables: state.tables.map((table) => ({ ...table, omittedFields: [...table.omittedFields] })),
    excludedModels: { ...state.excluded },
    maps: head.maps.map((map) => ({ ...map })),
    files: {
      copied: state.copied,
      missing: [...state.missing],
      tilesetsNotFound: [...head.tilesetsNotFound],
    },
  };
}

async function writeChecksumFile(root: string, written: readonly string[]): Promise<void> {
  const ordered = [...written].sort();
  const lines: string[] = [];
  for (const relPath of ordered) {
    const hex = await hashFile(path.resolve(root, ...relPath.split('/')));
    lines.push(`${hex}  ${relPath}\n`);
  }
  const sumsPath = path.resolve(root, 'SHA256SUMS');
  await fsp.mkdir(path.dirname(sumsPath), { recursive: true, mode: 0o700 });
  await fsp.writeFile(sumsPath, lines.join(''), { encoding: 'utf8', mode: 0o600 });
  await fsp.chmod(sumsPath, 0o600);
}

async function finalizeSink(state: ExportSinkState, sink: TenantExportSink, head: ManifestHead): Promise<ExportTotals> {
  const manifest = buildManifestDocument(state, head);
  await sink.writeText('manifest.json', `${JSON.stringify(manifest, null, 2)}\n`);
  await writeChecksumFile(state.root, state.written);
  return {
    tables: state.tables.length,
    rows: state.tables.reduce((total, table) => total + table.rows, 0),
    files: state.copied,
    missing: state.missing.length,
  };
}

/**
 * Creates a sink that writes the tenant export below `root`. The directory
 * must already exist (see `prepareExportDir`). `finalize` writes
 * `manifest.json` and then `SHA256SUMS` over every written file.
 */
export function createExportSink(root: string): {
  sink: TenantExportSink;
  finalize(head: ManifestHead): Promise<ExportTotals>;
} {
  const state: ExportSinkState = { root, written: [], missing: [], tables: [], excluded: {}, copied: 0 };
  const sink: TenantExportSink = {
    async writeJsonRows(relPath, rows) {
      return writeJsonRowsInto(state, relPath, rows);
    },
    async writeText(relPath, content) {
      await writeTextInto(state, relPath, content);
    },
    async copyFile(relPath, sourcePath) {
      return copyFileInto(state, relPath, sourcePath);
    },
    recordTable(entry) {
      state.tables.push({
        model: entry.model,
        file: entry.file,
        rows: entry.rows,
        omittedFields: [...entry.omittedFields],
      });
    },
    recordExcluded(models: readonly ExcludedModel[]) {
      for (const model of models) {
        state.excluded[model.model] = model.reason;
      }
    },
  };

  async function finalize(head: ManifestHead): Promise<ExportTotals> {
    return finalizeSink(state, sink, head);
  }

  return { sink, finalize };
}
