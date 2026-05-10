// @ts-check
import tseslint from 'typescript-eslint';
import prettierConfig from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import globals from 'globals';

export default tseslint.config(
  // 1) Globale Ignores: NUR Files, die wirklich nicht zum Source-Code gehören.
  //    Tests, Configs (vite/vitest/playwright), e2e und Build-Scripts werden
  //    via tsconfig.lint.json pro Workspace lintbar gemacht — sie landen
  //    bewusst NICHT hier.
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
      // Migrations sind SQL/Meta, kein TS.
      'apps/server/prisma/migrations/**',
      // Static Assets, Vendor-Bundles, Tauri-Build-Output.
      'apps/web/public/**',
      'apps/web/src-tauri/**',
      'public/**',
      // Standalone HTML-Editoren mit eigenem inline-JS-Format.
      'tools/**',
      // Sandkasten / Konfig-Verzeichnisse.
      'scratch/**',
      'prometheus/**',
      // Submodule mit eigenen Toolchains.
      'packages/desktop/**',
      'packages/brand/**',
      'packages/tenancy-enterprise/**',
      // Selbst-Referenzen (eslint kümmert sich nicht um eigene Config-Files).
      'eslint.config.mjs',
      'commitlint.config.mjs',
    ],
  },

  // 2) typescript-eslint Baseline: recommendedTypeChecked.
  //    Ziel: stufenweise auf strictTypeChecked + stylisticTypeChecked anheben,
  //    sobald die untypisierten Pfade (Phaser-Bridge, Colyseus-State) typisiert
  //    sind und die `(x as any)`-Casts abgebaut wurden.
  //    Tracking dafür siehe project_oss_release_blockers.md.
  ...tseslint.configs.recommendedTypeChecked,

  // 3) Sprache + Project-Setup für typed Linting.
  //    Die `tsconfig.lint.json` jedes Workspaces erweitert das jeweilige
  //    Build-tsconfig.json um Tests/Config-Files/Scripts, sodass typed
  //    Linting auch dort greift, ohne die Build-Settings zu ändern.
  //    Wir nutzen die explizite `project`-Liste statt `projectService`,
  //    weil `projectService.defaultProject` nur eine Single-Top-Level-Datei
  //    akzeptiert — bei Multi-Workspace-Setups ist die explizite Liste
  //    sauberer und deterministischer.
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

  // 3a) Stufenweise-Übergang: die `no-unsafe-*`-Familie und `no-explicit-any`
  //     produzieren in der aktuellen Codebase ~9.500 Treffer, fast alle an
  //     untyped Library-Boundaries (Phaser-Bridge `(scene as any).player`,
  //     Colyseus-State, raw fetch). Sie bleiben aktiv, aber als `warn`.
  //     ZIEL: Diese Regeln zurück auf `error` setzen, sobald die
  //     untyped Boundaries typisiert sind. Tracking: project_oss_release_blockers.md.
  {
    rules: {
      '@typescript-eslint/no-unsafe-member-access': 'warn',
      '@typescript-eslint/no-unsafe-assignment': 'warn',
      '@typescript-eslint/no-unsafe-call': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      '@typescript-eslint/no-unsafe-return': 'warn',
      '@typescript-eslint/no-explicit-any': 'warn',
      // no-unnecessary-type-assertion meldet aktuell ~340 Treffer, fast alle
      // von `prisma as any` bzw. `(scene as any).x`-Casts an den untyped
      // Boundaries (Phaser-Bridge, Colyseus-State, Enterprise-Submodule).
      // Auto-fix ist UNGEFÄHRLICH NICHT zu nutzen: typescript-eslint v8 hat
      // einen bekannten Auto-Fix-Bug, der valide Casts wie
      // `querySelector(...) as HTMLAudioElement | null` mit-entfernt und
      // damit Type-Errors einführt. ZIEL: zurück auf 'error', sobald die
      // Phaser-Bridge typisiert ist (Task #9) und no-unsafe-* erhöht wird.
      '@typescript-eslint/no-unnecessary-type-assertion': 'warn',
      // no-redundant-type-constituents meldet aktuell ~20 Treffer, alle
      // mit dem Pattern `Phaser.Scene & any` bzw. `LiveKitRoom | any`.
      // Das `& any` / `| any` ist redundant (any subsumiert alle Types),
      // aber semantisch markiert es bewusst untyped Boundaries. Wenn die
      // Phaser-Scene und der LiveKit-Room richtig typisiert sind (Tasks #9, #10),
      // entfällt das Pattern komplett. Bis dahin als 'warn'.
      '@typescript-eslint/no-redundant-type-constituents': 'warn',
      // Konvention: führender Underscore = absichtlich ungenutzt
      // (Funktionssignaturen, Discards in Destructuring, catch-Clauses).
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

  // 4) Server-Workspaces (Node-Umgebung).
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

  // 6) Test-Files: relax bestimmte Regeln, die im Test-Kontext stören
  //    (Mocks, Test-Helper, expect-Patterns).
  {
    files: ['**/*.test.{ts,tsx}', '**/*.spec.{ts,tsx}', '**/__tests__/**', '**/test/**', 'apps/web/e2e/**'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/unbound-method': 'off',
    },
  },

  // 7) Skripte (Build/Tools/Migrations) und Config-Files dürfen `console`
  //    nutzen und sind oft pragmatischer formuliert.
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
    },
  },

  // 8) Plain-JS Files (kein Type-Linting möglich): typed-Linting deaktivieren,
  //    sonst wirft typescript-eslint Parsing-Errors.
  {
    files: ['**/*.{js,cjs,mjs}'],
    extends: [tseslint.configs.disableTypeChecked],
  },

  // 8a) CommonJS-Files (.cjs): `require()` ist hier semantisch korrekt
  //     (CJS-by-design), nicht zu verwechseln mit ESM-Migration-Schulden.
  //     Die `no-require-imports`-Regel ist eine ESM-Empfehlung und greift
  //     bei .cjs nicht sinnvoll.
  {
    files: ['**/*.cjs'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },

  // 8b) Declaration-Files (.d.ts): Type-Augmentation via `interface X extends Y {}`
  //     ist ein etabliertes Pattern (declaration merging), das in den meisten
  //     `@types/*`-Paketen genutzt wird. `no-empty-object-type` ist hier ein
  //     False-Positive — wir können declare-module-Augmentation nicht über
  //     type-aliase machen.
  {
    files: ['**/*.d.ts'],
    rules: {
      '@typescript-eslint/no-empty-object-type': 'off',
    },
  },

  // 9) Prettier MUSS letzte Config sein: deaktiviert ESLint-Format-Regeln,
  //    die mit Prettier kollidieren würden.
  prettierConfig,
);
