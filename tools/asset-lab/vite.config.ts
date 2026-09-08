import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  server: {
    fs: {
      // Das Atelier benötigt nur den gemeinsamen Composer, Katalog und dessen Lizenzdateien.
      allow: [
        fileURLToPath(new URL('.', import.meta.url)),
        fileURLToPath(new URL('../../packages/shared', import.meta.url)),
      ],
    },
  },
  build: { target: 'es2022' },
  test: {
    include: ['tests/**/*.test.ts'],
    alias: {
      zod: fileURLToPath(new URL('./node_modules/zod/index.js', import.meta.url)),
    },
  },
});
