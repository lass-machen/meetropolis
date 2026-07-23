// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useHashRoute, parseHashRoute, sanitizeTierKey } from './useHashRoute';

/**
 * Regression guard for the boot routing race that logged desktop / pure-OSS
 * (hasBrand=false) users out on every reload: useHashRoute used to start on a
 * hardcoded 'landing' and only correct to the real hash in an effect. The
 * brand-absent redirect effect fired against that stale 'landing' (a
 * BRAND_ONLY_ROUTE) before the correction ran and clobbered e.g. #/app with
 * #/login, so the world never mounted and /auth/me never ran. The first render
 * must already reflect the actual hash.
 */
describe('useHashRoute initial route', () => {
  afterEach(() => {
    window.location.hash = '';
  });

  it('derives the route from the current hash on the very first render', () => {
    window.location.hash = '#/app';
    const { result } = renderHook(() => useHashRoute());
    expect(result.current.route).toBe('app');
  });

  it('does not fall back to landing when reloading a non-landing route', () => {
    window.location.hash = '#/login';
    const { result } = renderHook(() => useHashRoute());
    expect(result.current.route).toBe('login');
  });

  it('treats an empty hash as landing', () => {
    window.location.hash = '';
    const { result } = renderHook(() => useHashRoute());
    expect(result.current.route).toBe('landing');
  });
});

/**
 * The landing pricing cards carry the clicked tier into the wizard via
 * `#/register?plan=<tierKey>`, which step 3 reads through `initialPlan` to
 * preselect the plan. Guards the parse of that query param.
 */
describe('parseHashRoute register plan param', () => {
  it('extracts the preselected tier from #/register?plan=team', () => {
    expect(parseHashRoute('/register?plan=team')).toEqual({ route: 'register', params: { plan: 'team' } });
  });

  it('leaves plan undefined for a bare #/register', () => {
    expect(parseHashRoute('/register')).toEqual({ route: 'register', params: {} });
  });

  it('ignores an empty plan value', () => {
    expect(parseHashRoute('/register?plan=')).toEqual({ route: 'register', params: {} });
  });
});

/**
 * A9: the hero CTA produced `#/register?plan=%5Bobject+Object%5D`. The brand
 * module wires its button as `onClick={onSignup}`, so React hands the handler a
 * click event where a tier key was expected and the object got stringified into
 * the URL. The tier is validated at the boundary now; these pin that down.
 */
describe('sanitizeTierKey', () => {
  it('rejects a React event object — the actual A9 cause', () => {
    const clickEvent = { type: 'click', target: {}, nativeEvent: {}, bubbles: true };
    expect(sanitizeTierKey(clickEvent)).toBeUndefined();
  });

  it('never lets a non-string stringify into the URL', () => {
    for (const value of [{}, [], 42, true, null, undefined, () => {}, Symbol('x')]) {
      expect(sanitizeTierKey(value)).toBeUndefined();
    }
  });

  it('passes a real tier key through unchanged', () => {
    expect(sanitizeTierKey('team')).toBe('team');
    expect(sanitizeTierKey('business_plus')).toBe('business_plus');
    expect(sanitizeTierKey('tier-2')).toBe('tier-2');
  });

  it('trims surrounding whitespace', () => {
    expect(sanitizeTierKey('  team  ')).toBe('team');
  });

  it('rejects empty, oversized and non-slug values', () => {
    expect(sanitizeTierKey('')).toBeUndefined();
    expect(sanitizeTierKey('   ')).toBeUndefined();
    expect(sanitizeTierKey('a'.repeat(65))).toBeUndefined();
    expect(sanitizeTierKey('[object Object]')).toBeUndefined();
    expect(sanitizeTierKey('team plan')).toBeUndefined();
    expect(sanitizeTierKey('-team')).toBeUndefined();
  });
});
