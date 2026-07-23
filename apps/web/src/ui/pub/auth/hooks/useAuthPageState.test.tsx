// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useAuthPageState } from './useAuthPageState';

describe('useAuthPageState — plan default (deep-link channel invariant)', () => {
  it('starts with an EMPTY plan so the wizard default cannot masquerade as a deep-link', () => {
    // Regression guard: a non-empty default (e.g. 'team') would be passed to
    // step 3 as initialTier and override the team-size recommendation as the
    // preselected plan. It must stay empty absent a real landing deep-link.
    const { result } = renderHook(() => useAuthPageState('register', undefined, undefined));
    expect(result.current.regData.plan).toBe('');
  });

  it('seeds the plan from a real landing deep-link', () => {
    const { result } = renderHook(() => useAuthPageState('register', undefined, 'business'));
    expect(result.current.regData.plan).toBe('business');
  });
});
