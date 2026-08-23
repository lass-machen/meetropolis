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
    // Mirror vite.config.ts: sibling submodule sources (e.g. @meetropolis/desktop)
    // import bare deps like `react` that must resolve to this app's single copy
    // rather than relative to the sibling repo (which has its own node_modules
    // when it is checked out as a working repo). The list is kept identical to
    // the build's on purpose — a duplicate that only the test run resolves away
    // is a duplicate the build still ships.
    dedupe: ['react', 'react-dom', 'i18next', 'react-i18next', 'livekit-client'],
    alias: {
      '@app': resolve(__dirname, 'src'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    exclude: ['e2e/**', 'dist/**', 'src-tauri/**', '**/src-tauri/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      // Vitest 4 removed `coverage.all`; default is now only covered files.
      // Explicit `include` keeps reports comprehensive across all source files.
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['node_modules/', 'dist/', 'e2e/', '**/*.d.ts', 'src/test/**', '**/*.config.*', 'src-tauri/**'],
      thresholds: {
        lines: 60,
        functions: 60,
        branches: 50,
        statements: 60,
      },
    },
  },
});
