import '@testing-library/jest-dom/vitest';

// Polyfill matchMedia for jsdom
if (typeof window !== 'undefined' && !('matchMedia' in window)) {
  // @ts-expect-error jsdom polyfill
  window.matchMedia = (query: string) => {
    const mql: MediaQueryList = {
      media: query,
      matches: false,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    } as any;
    return mql;
  };
}


