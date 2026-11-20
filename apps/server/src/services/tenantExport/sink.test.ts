import { createHash } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createExportSink, prepareExportDir, TenantExportError } from './sink.js';

let tmpDir = '';

async function makeTmpDir(): Promise<string> {
  tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'tenant-export-sink-'));
  return tmpDir;
}

afterEach(async () => {
  if (tmpDir.length > 0) {
    await fsp.rm(tmpDir, { recursive: true, force: true });
    tmpDir = '';
  }
});

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(TenantExportError);
    return (error as TenantExportError).code;
  }
  throw new Error('expected TenantExportError');
}

describe('prepareExportDir', () => {
  it('creates a missing directory with mode 0700', async () => {
    const root = path.join(await makeTmpDir(), 'out');
    await prepareExportDir(root);
    const stat = await fsp.stat(root);
    expect(stat.isDirectory()).toBe(true);
    expect(stat.mode & 0o777).toBe(0o700);
  });

  it('accepts an existing empty directory', async () => {
    const root = await makeTmpDir();
    await prepareExportDir(root);
  });

  it('rejects a non-empty directory with output_not_empty', async () => {
    const root = await makeTmpDir();
    await fsp.writeFile(path.join(root, 'old.txt'), 'old', 'utf8');
    await expect(prepareExportDir(root)).rejects.toBeInstanceOf(TenantExportError);
    expect(await codeOf(prepareExportDir(root))).toBe('output_not_empty');
  });
});

describe('createExportSink', () => {
  it('streams JSON rows that parse back to the same rows', async () => {
    const root = await makeTmpDir();
    const { sink } = createExportSink(root);
    const rows = [
      { id: 'a', count: 1 },
      { id: 'b', count: 2 },
    ];
    async function* source(): AsyncGenerator<Record<string, unknown>> {
      for (const row of rows) {
        yield await Promise.resolve(row);
      }
    }
    const count = await sink.writeJsonRows('db/Thing.json', source());
    expect(count).toBe(2);
    const parsed = JSON.parse(await fsp.readFile(path.join(root, 'db/Thing.json'), 'utf8'));
    expect(parsed).toEqual(rows);
  });

  it('writes an empty row stream as an empty JSON array', async () => {
    const root = await makeTmpDir();
    const { sink } = createExportSink(root);
    const count = await sink.writeJsonRows('db/Empty.json', []);
    expect(count).toBe(0);
    const parsed = JSON.parse(await fsp.readFile(path.join(root, 'db/Empty.json'), 'utf8'));
    expect(parsed).toEqual([]);
  });

  it('rejects unsafe relative paths with unsafe_path', async () => {
    const root = await makeTmpDir();
    const { sink } = createExportSink(root);
    for (const relPath of ['../x', '/abs', 'a//b', 'a/./b']) {
      await expect(sink.writeText(relPath, 'x')).rejects.toBeInstanceOf(TenantExportError);
      expect(await codeOf(sink.writeText(relPath, 'x'))).toBe('unsafe_path');
    }
    await expect(sink.copyFile('../x', path.join(root, 'nope'))).rejects.toBeInstanceOf(TenantExportError);
    expect(await codeOf(sink.copyFile('../x', path.join(root, 'nope')))).toBe('unsafe_path');
  });

  it('leaves no file behind for a rejected path', async () => {
    const root = await makeTmpDir();
    const { sink } = createExportSink(root);
    await expect(sink.writeText('../escape', 'x')).rejects.toBeInstanceOf(TenantExportError);
    expect(await fsp.readdir(root)).toEqual([]);
  });

  it('copies an existing file and records a missing source', async () => {
    const root = await makeTmpDir();
    const { sink, finalize } = createExportSink(root);
    const source = path.join(root, 'source.bin');
    await fsp.writeFile(source, 'bytes', 'utf8');
    expect(await sink.copyFile('files/packs/a.bin', source)).toBe(true);
    expect(await sink.copyFile('files/packs/gone.bin', path.join(root, 'absent.bin'))).toBe(false);
    const totals = await finalize({
      exportedAt: '2026-01-01T00:00:00.000Z',
      tenant: { id: 't1', slug: 'acme', name: 'Acme' },
      enterprise: false,
      maps: [],
      tilesetsNotFound: [],
    });
    expect(totals.files).toBe(1);
    expect(totals.missing).toBe(1);
    expect(await fsp.readFile(path.join(root, 'files/packs/a.bin'), 'utf8')).toBe('bytes');
    const manifest = JSON.parse(await fsp.readFile(path.join(root, 'manifest.json'), 'utf8'));
    expect(manifest.files.missing).toEqual(['files/packs/gone.bin']);
  });

  it('writes files with mode 0600', async () => {
    const root = await makeTmpDir();
    const { sink } = createExportSink(root);
    await sink.writeText('db/Note.txt', 'hello');
    await sink.writeJsonRows('db/Note.json', [{ id: 'n1' }]);
    for (const relPath of ['db/Note.txt', 'db/Note.json']) {
      const stat = await fsp.stat(path.join(root, relPath));
      expect(stat.mode & 0o777).toBe(0o600);
    }
  });

  it('finalizes a manifest with tables, excluded models, maps and files', async () => {
    const root = await makeTmpDir();
    const { sink, finalize } = createExportSink(root);
    await sink.writeJsonRows('db/Map.json', [{ id: 'm1', name: 'Plaza' }]);
    sink.recordTable({ model: 'Map', file: 'db/Map.json', rows: 1, omittedFields: [] });
    sink.recordTable({ model: 'User', file: 'db/User.json', rows: 0, omittedFields: ['passwordHash'] });
    sink.recordExcluded([{ model: 'Session', reason: 'account-wide access material' }]);
    const totals = await finalize({
      exportedAt: '2026-02-02T03:04:05.000Z',
      tenant: { id: 't1', slug: 'acme', name: 'Acme' },
      enterprise: false,
      maps: [{ id: 'm1', name: 'Plaza', file: 'maps/m1.tmj' }],
      tilesetsNotFound: ['grass.png'],
    });
    expect(totals).toEqual({ tables: 2, rows: 1, files: 0, missing: 0 });
    const manifest = JSON.parse(await fsp.readFile(path.join(root, 'manifest.json'), 'utf8'));
    expect(manifest).toEqual({
      format: 'meetropolis-tenant-export',
      formatVersion: 1,
      exportedAt: '2026-02-02T03:04:05.000Z',
      tenant: { id: 't1', slug: 'acme', name: 'Acme' },
      enterprise: false,
      tables: [
        { model: 'Map', file: 'db/Map.json', rows: 1, omittedFields: [] },
        { model: 'User', file: 'db/User.json', rows: 0, omittedFields: ['passwordHash'] },
      ],
      excludedModels: { Session: 'account-wide access material' },
      maps: [{ id: 'm1', name: 'Plaza', file: 'maps/m1.tmj' }],
      files: { copied: 0, missing: [], tilesetsNotFound: ['grass.png'] },
    });
  });

  it('writes sorted SHA256SUMS over every file except itself', async () => {
    const root = await makeTmpDir();
    const { sink, finalize } = createExportSink(root);
    await sink.writeText('db/B.txt', 'bravo');
    await sink.writeJsonRows('db/A.json', [{ id: 1 }]);
    await finalize({
      exportedAt: '2026-01-01T00:00:00.000Z',
      tenant: { id: 't1', slug: 'acme', name: 'Acme' },
      enterprise: false,
      maps: [],
      tilesetsNotFound: [],
    });
    const sums = await fsp.readFile(path.join(root, 'SHA256SUMS'), 'utf8');
    const files = ['db/A.json', 'db/B.txt', 'manifest.json'];
    const expected = (
      await Promise.all(
        files.map(async (relPath) => {
          const data = await fsp.readFile(path.join(root, relPath));
          return `${createHash('sha256').update(data).digest('hex')}  ${relPath}\n`;
        }),
      )
    ).sort();
    expect(sums).toBe(expected.join(''));
    expect(sums).not.toContain('SHA256SUMS');
    const listed = sums
      .split('\n')
      .filter((line) => line.length > 0)
      .map((line) => line.split('  ')[1]);
    expect(listed).toEqual([...listed].sort());
  });
});
