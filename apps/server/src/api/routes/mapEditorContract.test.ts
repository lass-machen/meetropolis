import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const editorPath = fileURLToPath(new URL('../../../../../tools/map-editor.html', import.meta.url));
const editor = readFileSync(editorPath, 'utf8');

function section(start: string, end: string): string {
  const startIndex = editor.indexOf(`function ${start}`);
  const endIndex = editor.indexOf(`function ${end}`, startIndex + 1);
  if (startIndex < 0 || endIndex < 0) throw new Error(`Missing map editor section ${start}..${end}`);
  return editor.slice(startIndex, endIndex);
}

describe('standalone map editor autotile contract', () => {
  it('paints walls by pack and autotile identity', () => {
    const paintWall = section('paintWall', 'eraseWall');

    expect(paintWall).toContain("layer: 'walls_auto'");
    expect(paintWall).toContain('autotile: { ...selectedAutotile }');
    expect(paintWall).not.toContain('tileRefId');
  });

  it('erases walls explicitly in both erase paths', () => {
    const selectionErase = section('eraseRect', 'paintWall');
    const wallErase = section('eraseWall', 'refreshCollisionChunks');

    expect(selectionErase).toMatch(/layer: 'walls_auto',[\s\S]*?erase: true/);
    expect(wallErase).toMatch(/layer: 'walls_auto',[\s\S]*?erase: true/);
    expect(wallErase).not.toContain('tileRefId');
  });
});
