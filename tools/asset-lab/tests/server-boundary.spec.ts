import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';

test('die Vorschau liefert gemeinsame Avatar-Dateien, aber keine übrigen Repository-Dateien aus', async ({
  request,
}) => {
  const allowed = [
    '/src/avatar.ts',
    '/LICENSE?raw',
    `/@fs/${fileURLToPath(new URL('../../../packages/shared/sprite/catalog.json', import.meta.url))}`,
    `/@fs/${fileURLToPath(new URL('../../../packages/shared/LICENSE', import.meta.url))}?raw`,
  ];
  for (const path of allowed) expect((await request.head(path)).status(), path).toBe(200);
  // Nur harmlose, vorhandene Dateien prüfen; keine Geheimnisse zur Reproduktion abrufen.
  for (const relative of ['../../../README.md', '../../../compose.yaml']) {
    const path = `/@fs/${fileURLToPath(new URL(relative, import.meta.url))}`;
    expect((await request.head(path)).status(), path).toBe(403);
  }
});
