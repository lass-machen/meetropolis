import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    exclude: [
      'e2e/**',
      'dist/**',
      'src-tauri/**',
      '**/src-tauri/**',
    ],
    coverage: {
      provider: 'v8',
    },
  },
});

