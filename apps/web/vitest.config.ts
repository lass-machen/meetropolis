import { defineConfig } from 'vitest/config';
import { resolve } from 'path';
import { optionalSubmodules } from './optional-submodules';

export default defineConfig({
  plugins: [
    // Same plugin as vite.config.ts so OSS-only test runs (without the
    // private submodules) resolve `@meetropolis/{enterprise-web,brand-web,
    // desktop}` to a null-export instead of failing to resolve.
    optionalSubmodules(),
  ],
  resolve: {
    alias: {
      '@app': resolve(__dirname, 'src'),
    }
  },
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
