import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      if (entry.isDirectory()) {
        if (entry.name === 'generated') return [];
        return sourceFiles(path.join(directory, entry.name));
      }
      if (entry.name.endsWith('.test.ts')) return [];
      return [path.join(directory, entry.name)];
    }),
  );
  return nested.flat();
}

describe('public link source guard', () => {
  it('keeps PUBLIC_BASE_URL and hash-link construction inside one resolver', async () => {
    const srcRoot = path.resolve(process.cwd(), 'src');
    const files = await sourceFiles(srcRoot);
    const matches = await Promise.all(
      files.map(async (file) => {
        const content = await readFile(file, 'utf8');
        return /process\.env\.PUBLIC_BASE_URL|\/#\//.test(content)
          ? path.relative(srcRoot, file).split(path.sep).join('/')
          : null;
      }),
    );

    expect(matches.filter((file): file is string => file !== null).sort()).toEqual(['api/utils/publicLinks.ts']);
  });
});
