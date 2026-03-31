import { useEffect, type RefObject } from 'react';

/**
 * Adds `pub-reveal--visible` class when the element enters the viewport.
 * Pairs with the `.pub-reveal` / `.pub-reveal--visible` CSS classes
 * defined in public.css.
 */
export function useReveal(ref: RefObject<HTMLElement | null>) {
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
  }, [ref]);
}
