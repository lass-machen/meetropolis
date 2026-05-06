/**
 * Type-only shim for jest-dom + vitest 4.
 *
 * Vitest 4 moved the `Assertion` and `AsymmetricMatchersContaining` interfaces
 * from `vitest` to `@vitest/expect` (the former is now a type re-export).
 * `@testing-library/jest-dom@6.9.x`'s `vitest.d.ts` only augments the `vitest`
 * module — which no longer carries the local interface — so matchers like
 * `toBeInTheDocument()` are not picked up by tsc.
 *
 * This file augments `@vitest/expect` directly, where the interfaces actually
 * live in vitest 4. Remove once jest-dom ships first-class vitest 4 support.
 */
import 'vitest';
import type { TestingLibraryMatchers } from '@testing-library/jest-dom/matchers';

declare module '@vitest/expect' {
  interface Assertion<T = unknown> extends TestingLibraryMatchers<unknown, T> {}
  interface AsymmetricMatchersContaining extends TestingLibraryMatchers<unknown, unknown> {}
}
