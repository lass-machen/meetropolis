// jest-dom@6.9's `/vitest` entry does `import { expect } from 'vitest'`, which
// fails in npm-workspace setups where vitest is hoisted to a workspace package
// (apps/web/node_modules/vitest) rather than the repo root, while jest-dom is
// hoisted to the root. Vitest 4's stricter resolution surfaces this; vitest 3
// silently let it through. Wire the matchers ourselves via the framework-
// neutral `/matchers` entry to side-step the resolution mismatch.
import * as jestDomMatchers from '@testing-library/jest-dom/matchers';
import { expect } from 'vitest';

expect.extend(jestDomMatchers);

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
    };
    return mql;
  };
}

// Minimal canvas 2D context stub for Phaser/device checks under jsdom.
if (typeof window !== 'undefined' && typeof window.HTMLCanvasElement !== 'undefined') {
  const proto = window.HTMLCanvasElement.prototype as any;
  const existingGetContext = proto.getContext;

  proto.getContext = function getContext(type: string) {
    if (type === '2d') {
      const data = new Uint8ClampedArray([255, 0, 0, 255]);
      return {
        fillStyle: '',
        globalCompositeOperation: 'source-over',
        fillRect: () => {},
        clearRect: () => {},
        drawImage: () => {},
        getImageData: () => ({ data }),
        putImageData: () => {},
      } as any;
    }
    return existingGetContext ? existingGetContext.call(this, type) : null;
  };
}
