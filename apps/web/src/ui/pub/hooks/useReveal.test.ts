// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useReveal } from './useReveal';

/**
 * Minimal IntersectionObserver stand-in: jsdom does not implement
 * IntersectionObserver. Captures the callback per instance so a test can
 * simulate an intersection event by calling `trigger` directly, and tracks
 * `observed` targets so tests can assert observe/unobserve calls without
 * reaching into the hook's internals.
 */
class MockIntersectionObserver {
  static instances: MockIntersectionObserver[] = [];
  callback: IntersectionObserverCallback;
  observed: Element[] = [];

  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
    MockIntersectionObserver.instances.push(this);
  }

  observe(target: Element) {
    this.observed.push(target);
  }

  unobserve(target: Element) {
    this.observed = this.observed.filter((el) => el !== target);
  }

  disconnect() {
    this.observed = [];
  }

  trigger(target: Element, isIntersecting: boolean) {
    this.callback([{ target, isIntersecting } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
  }
}

beforeEach(() => {
  MockIntersectionObserver.instances = [];
  // @ts-expect-error test-only global stub; jsdom has no native implementation
  window.IntersectionObserver = MockIntersectionObserver;
});

describe('useReveal', () => {
  it('observes the element on mount and adds pub-reveal--visible on intersection (default deps)', () => {
    const el = document.createElement('section');
    const ref = { current: el };

    renderHook(() => useReveal(ref));

    expect(MockIntersectionObserver.instances).toHaveLength(1);
    const observer = MockIntersectionObserver.instances[0];
    expect(observer.observed).toContain(el);

    observer.trigger(el, true);
    expect(el.classList.contains('pub-reveal--visible')).toBe(true);
  });

  it('does not create an observer when the ref is null on mount', () => {
    const ref: { current: HTMLElement | null } = { current: null };

    renderHook(() => useReveal(ref));

    expect(MockIntersectionObserver.instances).toHaveLength(0);
  });

  /**
   * Regression guard for the pricing-section bug: a section that renders
   * `null` until async data arrives has `ref.current === null` on the first
   * render, and the effect used to depend on `[ref]` only. Since `ref` (the
   * object identity from useRef) never changes, the effect never re-ran once
   * the section actually mounted, so it was never observed and stayed at
   * `opacity: 0` forever. Passing a `deps` entry that changes when the async
   * data lands (e.g. `[plans.length]`) must make the effect re-run and
   * observe the now-mounted element.
   */
  it('re-observes and reveals a late-mounting element once deps change', () => {
    const ref: { current: HTMLElement | null } = { current: null };

    const { rerender } = renderHook(({ deps }: { deps: unknown[] }) => useReveal(ref, deps), {
      initialProps: { deps: [0] },
    });

    // Mirrors PricingSection before plans have loaded: the section (and
    // therefore sectionRef.current) is not in the DOM yet.
    expect(MockIntersectionObserver.instances).toHaveLength(0);

    // Plans finish loading: the section mounts, sectionRef.current is set by
    // React, and the caller's deps array changes (`[plans.length]` goes from
    // `[0]` to `[1]`), which re-runs the effect.
    const el = document.createElement('section');
    ref.current = el;
    rerender({ deps: [1] });

    expect(MockIntersectionObserver.instances).toHaveLength(1);
    const observer = MockIntersectionObserver.instances[0];
    expect(observer.observed).toContain(el);

    observer.trigger(el, true);
    expect(el.classList.contains('pub-reveal--visible')).toBe(true);
  });

  it('unobserves once revealed and disconnects on unmount', () => {
    const el = document.createElement('section');
    const ref = { current: el };

    const { unmount } = renderHook(() => useReveal(ref));
    const observer = MockIntersectionObserver.instances[0];

    observer.trigger(el, true);
    expect(observer.observed).not.toContain(el);

    const disconnectSpy = vi.spyOn(observer, 'disconnect');
    unmount();
    expect(disconnectSpy).toHaveBeenCalledTimes(1);
  });
});
