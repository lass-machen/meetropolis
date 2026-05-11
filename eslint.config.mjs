// @ts-check
import tseslint from 'typescript-eslint';
import prettierConfig from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import eslintComments from '@eslint-community/eslint-plugin-eslint-comments';
import globals from 'globals';

export default tseslint.config(
  // 1) Global ignores: ONLY files that truly do not belong to the source code.
  //    Tests, configs (vite/vitest/playwright), e2e and build scripts are
  //    made lintable per workspace via tsconfig.lint.json, so they
  //    intentionally do NOT belong here.
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/.git/**',
      '**/coverage/**',
      '**/build/**',
      '**/target/**',
      '**/.vite/**',
      // Generated code (Prisma).
      'apps/server/src/generated/**',
      // Migrations are SQL/meta, not TS.
      'apps/server/prisma/migrations/**',
      // Static assets, vendor bundles, Tauri build output.
      'apps/web/public/**',
      'apps/web/src-tauri/**',
      'public/**',
      // Standalone HTML editors with their own inline-JS format.
      'tools/**',
      // Sandbox / config directories.
      'scratch/**',
      'prometheus/**',
      // Submodules with their own toolchains.
      'packages/desktop/**',
      'packages/brand/**',
      'packages/tenancy-enterprise/**',
      // Self-references (eslint does not lint its own config files).
      'eslint.config.mjs',
      'commitlint.config.mjs',
    ],
  },

  // 2) typescript-eslint baseline: recommendedTypeChecked.
  //    Goal: gradually move up to strictTypeChecked + stylisticTypeChecked
  //    once the untyped paths (Phaser bridge, Colyseus state) are typed
  //    and the `(x as any)` casts have been removed.
  //    Tracking for this lives in project_oss_release_blockers.md.
  ...tseslint.configs.recommendedTypeChecked,

  // 3) Language + project setup for typed linting.
  //    Each workspace's `tsconfig.lint.json` extends the corresponding
  //    build `tsconfig.json` to include tests/config files/scripts, so
  //    typed linting also applies there without changing the build settings.
  //    We use the explicit `project` list instead of `projectService` because
  //    `projectService.defaultProject` only accepts a single top-level file;
  //    for multi-workspace setups the explicit list is cleaner and more
  //    deterministic.
  {
    languageOptions: {
      parserOptions: {
        project: [
          './apps/server/tsconfig.lint.json',
          './apps/web/tsconfig.lint.json',
          './apps/npc-service/tsconfig.lint.json',
          './apps/loadtest/tsconfig.lint.json',
          './packages/shared/tsconfig.lint.json',
        ],
        tsconfigRootDir: import.meta.dirname,
      },
      globals: {
        ...globals.es2024,
      },
    },
  },

  // 3) eslint-comments: mandatory justification for disable directives.
  //    Whoever writes `eslint-disable-next-line @typescript-eslint/no-explicit-any`
  //    must append `-- <reason>` to it. Silent muting is not allowed;
  //    this surfaces boundary assumptions in the review diff.
  //    See LIBRARY_BOUNDARIES.md.
  {
    plugins: {
      '@eslint-community/eslint-comments': eslintComments,
    },
    rules: {
      '@eslint-community/eslint-comments/require-description': ['error', { ignore: ['eslint-enable'] }],
      '@eslint-community/eslint-comments/no-unused-disable': 'error',
      '@eslint-community/eslint-comments/no-duplicate-disable': 'error',
      '@eslint-community/eslint-comments/no-aggregating-enable': 'error',
    },
  },

  // 3a) Library boundary rules: `no-unsafe-*` and `no-explicit-any` stay
  //     active as `warn`. Genuine library boundaries are documented as
  //     file-level overrides in section 3b below. A new `as any` in a place
  //     that is NOT inside an adapter file should appear as a warning so it
  //     stands out in review. Anyone who really has no wrapper solution must
  //     write `eslint-disable-next-line` with a mandatory justification
  //     (see `eslint-comments/require-description` further below).
  //
  //     See LIBRARY_BOUNDARIES.md for the four pattern options and when to
  //     use which one.
  {
    rules: {
      '@typescript-eslint/no-unsafe-member-access': 'warn',
      '@typescript-eslint/no-unsafe-assignment': 'warn',
      '@typescript-eslint/no-unsafe-call': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      '@typescript-eslint/no-unsafe-return': 'warn',
      '@typescript-eslint/no-explicit-any': 'warn',
      // Convention: leading underscore = intentionally unused
      // (function signatures, discards in destructuring, catch clauses).
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
        },
      ],
    },
  },

  // 3b) Genuine library boundaries: files whose sole purpose is the
  //     translation between an untyped vendor interface and our typed code
  //     universe. Here `no-unsafe-*` and `no-explicit-any` are switched off
  //     because the boundary logic must, by definition, work with `any`.
  //
  //     Add to this list only if:
  //     1. The untyped interface is a third-party library internal or a
  //        browser global (not your own code that just happens to be
  //        untyped).
  //     2. The clean solution (wrapper, declare module, helper) is not
  //        possible or disproportionately expensive.
  //     3. The file content is limited to the boundary logic; no mix of
  //        business code + boundary.
  //
  //     See LIBRARY_BOUNDARIES.md for context.
  {
    files: [
      // LiveKit private engine internals (connectionState, signalClient.ws).
      // Public API exposes none of these; the heuristic depends on them.
      'apps/web/src/av/core/SignalMonitor.ts',

      // Monkey-patches globalThis.WebSocket to work around a WKWebView bug.
      // The constructor swap is intrinsically loose (returning a value via
      // `as any` is the documented pattern for this kind of polyfill).
      'apps/web/src/lib/patchWebSocket.ts',

      // AudioWorklet processors run in AudioWorkletGlobalScope, not in the
      // standard DOM lib. `sampleRate` and `AudioWorkletProcessor` come from
      // the worklet runtime and require ambient `declare` plus `any`-shaped
      // globals access.
      'apps/web/src/av/audio/worklets/rnnoise-processor.ts',
    ],
    rules: {
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },

  // 4) Server workspaces (Node environment).
  {
    files: [
      'apps/server/**/*.{ts,tsx,mjs}',
      'apps/npc-service/**/*.{ts,tsx,mjs}',
      'apps/loadtest/**/*.{ts,tsx,mjs}',
      'packages/shared/**/*.{ts,tsx,mjs}',
    ],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },

  // 5) Web (Browser + React).
  {
    files: ['apps/web/**/*.{ts,tsx,mjs}'],
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
    plugins: {
      'react-hooks': reactHooks,
      'jsx-a11y': jsxA11y,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...jsxA11y.configs.recommended.rules,
    },
  },

  // 6) Test files: relax certain rules that get in the way in a test context
  //    (mocks, test helpers, expect patterns). We want tests to stay
  //    pragmatic; type strictness is enforced in production code, not at
  //    every mock setup.
  {
    files: ['**/*.test.{ts,tsx}', '**/*.spec.{ts,tsx}', '**/__tests__/**', '**/test/**', 'apps/web/e2e/**'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/unbound-method': 'off',
    },
  },

  // 7) Scripts (build/tools/migrations) and config files may use `console`
  //    and are often written more pragmatically. Type strictness matters
  //    less for these files: they run one-shot (build, seed, Playwright
  //    config), not on the production path, and frequently need to deal
  //    with vendor configs (Vite, Vitest, Playwright, Prisma) whose types
  //    are loose or deliberately open.
  {
    files: [
      'scripts/**/*.{js,mjs,cjs,ts}',
      'apps/*/scripts/**/*.{js,mjs,cjs,ts}',
      'apps/server/prisma/seed.ts',
      'apps/server/prisma/compose-schema.cjs',
      'apps/server/prisma.config.ts',
      'apps/web/optional-submodules.ts',
      '**/*.config.{js,mjs,cjs,ts}',
    ],
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
    },
  },

  // 8) Plain-JS files (no type linting possible): disable typed linting,
  //    otherwise typescript-eslint throws parsing errors.
  {
    files: ['**/*.{js,cjs,mjs}'],
    extends: [tseslint.configs.disableTypeChecked],
  },

  // 8a) CommonJS files (.cjs): `require()` is semantically correct here
  //     (CJS by design), not to be confused with ESM migration debt.
  //     The `no-require-imports` rule is an ESM recommendation and does
  //     not apply meaningfully to .cjs.
  {
    files: ['**/*.cjs'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },

  // 8b) Declaration-Files (.d.ts): Type-Augmentation via `interface X extends Y {}`
  //     is an established pattern (declaration merging) used by most
  //     `@types/*` packages. `no-empty-object-type` is a false positive
  //     here; we cannot do declare-module augmentation via type aliases.
  {
    files: ['**/*.d.ts'],
    rules: {
      '@typescript-eslint/no-empty-object-type': 'off',
    },
  },

  // 9) Prettier MUST be the last config: disables ESLint formatting rules
  //    that would conflict with Prettier.
  prettierConfig,
);
