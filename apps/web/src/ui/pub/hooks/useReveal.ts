import { useEffect, type RefObject } from 'react';

/**
 * Adds `pub-reveal--visible` class when the element enters the viewport.
 * Pairs with the `.pub-reveal` / `.pub-reveal--visible` CSS classes
 * defined in public.css.
 *
 * `deps` is an optional extra dependency list for the effect, on top of
 * `ref` itself. Most callers render their section synchronously and don't
 * need it (defaults to `[]`, matching the previous `[ref]`-only behaviour).
 * Callers whose section only mounts after async data arrives (e.g. a
 * pricing list fetched over the network) must pass a dependency that
 * changes once that data is in — the `[ref]`-only effect never re-runs on
 * a plain re-render, so a `ref.current` that was `null` on mount (because
 * the section itself wasn't in the DOM yet) would otherwise never get
 * observed, and the element would stay at `opacity: 0` forever.
 */
export function useReveal(ref: RefObject<HTMLElement | null>, deps: unknown[] = []) {
  useEffect(() => {
    if (!ref.current) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('pub-reveal--visible');
          observer.unobserve(entry.target);
        }
      },
      { threshold: 0.1 },
    );
    observer.observe(ref.current);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: `deps` is a caller-supplied array spread by design; `ref` is a stable object across renders, so the spread is the correct dependency list even though the linter can't statically verify it.
  }, [ref, ...deps]);
}
