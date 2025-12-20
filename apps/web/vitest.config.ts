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
      reporter: ['text', 'html', 'lcov'],
      exclude: [
        'node_modules/',
        'dist/',
        'e2e/',
        '**/*.d.ts',
        'src/test/**',
        '**/*.config.*',
        'src-tauri/**',
      ],
      thresholds: {
        lines: 60,
        functions: 60,
        branches: 50,
        statements: 60
      }
    },
  },
});
