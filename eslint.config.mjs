// @ts-check
import tseslint from 'typescript-eslint';
import prettierConfig from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import eslintComments from '@eslint-community/eslint-plugin-eslint-comments';
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

  // 3) eslint-comments: Pflicht-Begruendung fuer disable-Direktiven.
  //    Wer `eslint-disable-next-line @typescript-eslint/no-explicit-any`
  //    schreibt, muss `-- <Grund>` daran haengen. Stilles Stummschalten ist
  //    nicht erlaubt; das macht Boundary-Annahmen im Review-Diff sichtbar.
  //    Siehe LIBRARY_BOUNDARIES.md.
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

  // 3a) Library-Boundary-Regeln: `no-unsafe-*` und `no-explicit-any` bleiben
  //     als `warn` aktiv. Echte Library-Boundaries sind als File-Level-Override
  //     unten in Sektion 3b dokumentiert. Ein neuer `as any` an einer Stelle,
  //     die NICHT in einem Adapter-File liegt, soll als Warning erscheinen,
  //     damit es im Review auffaellt. Wer wirklich keine Wrapper-Loesung hat,
  //     muss `eslint-disable-next-line` mit Pflicht-Begruendung schreiben
  //     (siehe `eslint-comments/require-description` weiter unten).
  //
  //     Siehe LIBRARY_BOUNDARIES.md fuer die vier Pattern-Optionen und wann
  //     welche.
  {
    rules: {
      '@typescript-eslint/no-unsafe-member-access': 'warn',
      '@typescript-eslint/no-unsafe-assignment': 'warn',
      '@typescript-eslint/no-unsafe-call': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      '@typescript-eslint/no-unsafe-return': 'warn',
      '@typescript-eslint/no-explicit-any': 'warn',
      // Konvention: fuehrender Underscore = absichtlich ungenutzt
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

  // 3b) Echte Library-Boundaries: Files, deren einziger Zweck die Uebersetzung
  //     zwischen einer untypisierten Vendor-Schnittstelle und unserem
  //     getypten Code-Universum ist. Hier sind `no-unsafe-*` und
  //     `no-explicit-any` abgeschaltet, weil die Boundary-Logik per
  //     Definition mit `any` arbeiten muss.
  //
  //     Hinzunahme nur, wenn:
  //     1. Die untypisierte Schnittstelle ist ein Third-Party-Library-Internal
  //        oder ein Browser-Global (kein eigener Code, der nur untypisiert
  //        ist).
  //     2. Die saubere Loesung (Wrapper, declare module, Helper) ist nicht
  //        moeglich oder unangemessen aufwendig.
  //     3. Der File-Inhalt ist auf die Boundary-Logik beschraenkt; kein
  //        Mischmasch aus Business-Code + Boundary.
  //
  //     Siehe LIBRARY_BOUNDARIES.md fuer den Kontext.
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
  //    (Mocks, Test-Helper, expect-Patterns). Wir wollen Tests pragmatisch
  //    halten — die Type-Strenge wird im Production-Code erzwungen, nicht
  //    bei jedem Mock-Setup.
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

  // 7) Skripte (Build/Tools/Migrations) und Config-Files dürfen `console`
  //    nutzen und sind oft pragmatischer formuliert. Type-Strenge ist bei
  //    diesen Files weniger relevant: sie laufen einmalig (Build, Seed,
  //    Playwright-Konfig), nicht im Production-Pfad, und müssen oft mit
  //    Vendor-Configs (Vite, Vitest, Playwright, Prisma) umgehen, deren
  //    Typen lose oder bewusst offen sind.
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
